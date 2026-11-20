import { admin, isCronRequest, json, siteUrl } from '../../../../lib/server';
import { sendEmail } from '../../../../lib/email';

const DAY = 24 * 60 * 60 * 1000;
const MAX_NUDGES = 3;

function monthsAgo(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d.getTime() <= Date.now();
}

// Runs daily (see vercel.json). Sends two kinds of quiet email:
//  1. Planners: a check-in, as often as they chose in Settings.
//  2. Invited executors who have not set up their account yet: up to three
//     gentle reminders, two weeks apart.
export async function GET(req) {
  if (!isCronRequest(req)) return json({ error: 'Not allowed' }, 401);
  const db = admin();
  const site = siteUrl(req);
  const { data: vaults, error } = await db.from('vaults')
    .select('id, owner_id, owner_name, created_at, reminder_months, last_reminded_at, executor_email, executor_id, executor_invited_at, executor_nudged_at, executor_nudges');
  if (error) return json({ error: error.message }, 500);

  let planners = 0;
  let executors = 0;
  for (const v of vaults || []) {
    try {
      if (v.reminder_months > 0 && monthsAgo(v.last_reminded_at || v.created_at, v.reminder_months)) {
        const { data } = await db.auth.admin.getUserById(v.owner_id);
        if (data?.user?.email) {
          const { count } = await db.from('entries').select('id', { count: 'exact', head: true }).eq('vault_id', v.id);
          const r = await sendEmail({
            to: data.user.email,
            subject: 'A gentle check-in from Cairn',
            text: [
              `Hello${v.owner_name ? ` ${v.owner_name}` : ''},`,
              '',
              `This is your ${v.reminder_months === 12 ? 'yearly' : `${v.reminder_months}-monthly`} reminder to look over your Cairn vault. It has ${count ?? 0} ${count === 1 ? 'service' : 'services'} in it.`,
              'Passwords change, subscriptions come and go, and a note written a while ago may need a fresh line. A few minutes now can save your executor a lot of trouble later.',
              !v.executor_email ? '\nYou have not chosen an executor yet. You can invite one from Settings.' : '',
              '',
              `${site}/vault`,
              '',
              'You can change how often we remind you, or turn this off, in Settings.',
              '',
              'Cairn',
            ].filter((l) => l !== null).join('\n'),
          });
          if (r.ok) {
            await db.from('vaults').update({ last_reminded_at: new Date().toISOString() }).eq('id', v.id);
            planners++;
          }
        }
      }

      const waiting = v.executor_email && !v.executor_id && v.executor_invited_at;
      if (waiting && v.executor_nudges < MAX_NUDGES
        && Date.now() - new Date(v.executor_invited_at).getTime() > 7 * DAY
        && (!v.executor_nudged_at || Date.now() - new Date(v.executor_nudged_at).getTime() > 14 * DAY)) {
        const who = v.owner_name || 'Someone you know';
        const r = await sendEmail({
          to: v.executor_email,
          subject: `A reminder: ${who} asked you to be their executor on Cairn`,
          text: [
            `${who} asked you to be their executor on Cairn, which helps look after everyday online accounts one day.`,
            '',
            'Your account is not set up yet. It only takes a minute, using this email address:',
            `${site}/`,
            '',
            'Cairn',
          ].join('\n'),
        });
        if (r.ok) {
          await db.from('vaults').update({
            executor_nudged_at: new Date().toISOString(), executor_nudges: v.executor_nudges + 1,
          }).eq('id', v.id);
          executors++;
        }
      }
    } catch (err) {
      console.error('[reminders] vault failed', v.id, err?.message);
    }
  }
  return json({ ok: true, planners, executors });
}

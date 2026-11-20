import { admin, currentUser, json, siteUrl, EMAIL_RE } from '../../../lib/server';
import { sendEmail } from '../../../lib/email';

// The planner invites (or replaces) their executor.
export async function POST(req) {
  const user = await currentUser();
  if (!user) return json({ error: 'Please sign in again.' }, 401);
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: 'Please check the email address.' }, 400);
  if (email === (user.email || '').toLowerCase()) return json({ error: 'Your executor needs to be someone else, with their own email address.' }, 400);

  const db = admin();
  const { data: vault } = await db.from('vaults').select('id, owner_name, executor_email, executor_invited_at').eq('owner_id', user.id).maybeSingle();
  if (!vault) return json({ error: 'Please set up your vault first.' }, 404);

  const recentSame = vault.executor_email === email && vault.executor_invited_at
    && Date.now() - new Date(vault.executor_invited_at).getTime() < 10 * 60 * 1000;

  const { error } = await db.from('vaults').update({
    executor_email: email,
    executor_id: null,               // a new invitation always needs a fresh claim
    executor_invited_at: new Date().toISOString(),
    executor_nudged_at: null,
    executor_nudges: 0,
    executor_opened_at: null,
    updated_at: new Date().toISOString(),
  }).eq('id', vault.id);
  if (error) return json({ error: 'Something went wrong. Please try again.' }, 500);

  if (!recentSame) {
    const who = vault.owner_name || 'Someone you know';
    await sendEmail({
      to: email,
      subject: `${who} has asked you to be their executor on Cairn`,
      text: [
        `${who} has chosen you to help look after their everyday online accounts one day, such as streaming services and home logins.`,
        '',
        'There is nothing to do now except create a Cairn account with this email address, so you are ready:',
        `${siteUrl(req)}/`,
        '',
        'If you already have a Cairn account, just sign in.',
        '',
        `${who} will give you a recovery key separately, on paper or in person. Please keep it somewhere safe. We will never send it by email.`,
        '',
        'Cairn',
      ].join('\n'),
    });
  }
  return json({ ok: true });
}

// The planner removes their executor.
export async function DELETE() {
  const user = await currentUser();
  if (!user) return json({ error: 'Please sign in again.' }, 401);
  const { error } = await admin().from('vaults').update({
    executor_email: null, executor_id: null, executor_invited_at: null,
    executor_nudged_at: null, executor_nudges: 0, executor_opened_at: null,
    updated_at: new Date().toISOString(),
  }).eq('owner_id', user.id);
  if (error) return json({ error: 'Something went wrong.' }, 500);
  return json({ ok: true });
}

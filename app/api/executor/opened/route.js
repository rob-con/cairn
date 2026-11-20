import { admin, currentUser, json } from '../../../../lib/server';
import { sendEmail } from '../../../../lib/email';

// Called after an executor unlocks a vault. Records it and tells the owner, so
// an unexpected opening never goes unnoticed. At most one email per 12 hours.
export async function POST() {
  const user = await currentUser();
  if (!user) return json({ error: 'Please sign in.' }, 401);
  const db = admin();
  const { data: vault } = await db.from('vaults').select('id, owner_id, executor_email, executor_opened_at')
    .eq('executor_id', user.id).maybeSingle();
  if (!vault) return json({ ok: true });

  const last = vault.executor_opened_at ? new Date(vault.executor_opened_at).getTime() : 0;
  await db.from('vaults').update({ executor_opened_at: new Date().toISOString() }).eq('id', vault.id);
  if (Date.now() - last > 12 * 60 * 60 * 1000) {
    const { data } = await db.auth.admin.getUserById(vault.owner_id);
    const ownerEmail = data?.user?.email;
    if (ownerEmail) {
      await sendEmail({
        to: ownerEmail,
        subject: 'Your Cairn vault was opened by your executor',
        text: [
          `Your executor (${vault.executor_email}) has just opened your Cairn vault with the recovery key.`,
          '',
          'If you expected this, there is nothing to do.',
          'If you did not, please sign in to Cairn, make a new recovery key in Settings (the old one stops working straight away), and consider choosing a different executor.',
          '',
          'Cairn',
        ].join('\n'),
      });
    }
  }
  return json({ ok: true });
}

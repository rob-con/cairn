import { admin, currentUser, json } from '../../../lib/server';

// Links a signed-in executor to any vault that invited their email address.
// Only a confirmed email counts, so nobody can claim an invitation by signing
// up with someone else's address.
export async function POST() {
  const user = await currentUser();
  if (!user) return json({ error: 'Please sign in.' }, 401);
  if (!user.email || !user.email_confirmed_at) return json({ ok: true, claimed: 0 });
  const { data, error } = await admin().from('vaults')
    .update({ executor_id: user.id })
    .eq('executor_email', user.email.toLowerCase())
    .is('executor_id', null)
    .neq('owner_id', user.id)
    .select('id');
  if (error) return json({ error: 'Something went wrong.' }, 500);
  return json({ ok: true, claimed: (data || []).length });
}

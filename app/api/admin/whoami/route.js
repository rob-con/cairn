import { currentUser, isAdminUser, json } from '../../../../lib/server';

export async function GET() {
  const user = await currentUser();
  return json({ admin: isAdminUser(user) });
}

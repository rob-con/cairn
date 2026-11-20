import { requireAdmin, json } from '../../../../../lib/server';
import { runGuideCheck } from '../../../../../lib/guides-job';

export const maxDuration = 300;

// Lets the administrator run the monthly check now, for one service or all.
export async function POST(req) {
  if (!(await requireAdmin())) return json({ error: 'Not allowed' }, 403);
  const body = await req.json().catch(() => ({}));
  try {
    return json(await runGuideCheck({ only: body.service || undefined }));
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

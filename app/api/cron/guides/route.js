import { isCronRequest, json } from '../../../../lib/server';
import { runGuideCheck } from '../../../../lib/guides-job';

export const maxDuration = 300;

// Runs on the first of each month (see vercel.json). Vercel sends CRON_SECRET.
export async function GET(req) {
  if (!isCronRequest(req)) return json({ error: 'Not allowed' }, 401);
  try {
    return json(await runGuideCheck());
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

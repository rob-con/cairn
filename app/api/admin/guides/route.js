import { admin, requireAdmin, json } from '../../../../lib/server';

// Only the administrator (ADMIN_EMAIL) may list drafts and approve or reject them.
export async function GET() {
  if (!(await requireAdmin())) return json({ error: 'Not allowed' }, 403);
  const db = admin();
  const [{ data: drafts }, { data: guides }] = await Promise.all([
    db.from('guide_drafts').select('*').eq('status', 'pending').order('created_at'),
    db.from('guides').select('*').order('priority'),
  ]);
  return json({ drafts: drafts || [], guides: guides || [] });
}

const list = (a) => (Array.isArray(a) ? a.map((s) => String(s).trim()).filter(Boolean).slice(0, 25) : null);

export async function POST(req) {
  if (!(await requireAdmin())) return json({ error: 'Not allowed' }, 403);
  const body = await req.json().catch(() => ({}));
  const { draftId, action } = body;
  const db = admin();
  const { data: d } = await db.from('guide_drafts').select('*').eq('id', draftId).eq('status', 'pending').maybeSingle();
  if (!d) return json({ error: 'That draft is no longer waiting.' }, 404);
  const now = new Date().toISOString();

  if (action === 'reject') {
    await db.from('guide_drafts').update({ status: 'rejected', decided_at: now }).eq('id', draftId);
    // Rejecting still counts as a check: the published steps stand.
    await db.from('guides').update({ checked_at: now }).eq('service_key', d.service_key).not('approved_at', 'is', null);
    return json({ ok: true });
  }
  if (action !== 'approve') return json({ error: 'Unknown action' }, 400);

  let helpUrl = d.help_url;
  if (typeof body.help_url === 'string') {
    try { helpUrl = body.help_url.trim() ? new URL(body.help_url.trim()).toString() : null; }
    catch { return json({ error: 'The help page address does not look right.' }, 400); }
  }
  const { error } = await db.from('guides').update({
    steps_keep: list(body.keep) ?? d.steps_keep,
    steps_transfer: list(body.transfer) ?? d.steps_transfer,
    steps_close: list(body.close) ?? d.steps_close,
    help_url: helpUrl,
    checked_at: now,
    approved_at: now,
  }).eq('service_key', d.service_key);
  if (error) return json({ error: error.message }, 500);
  await db.from('guide_drafts').update({ status: 'approved', decided_at: now }).eq('id', draftId);
  return json({ ok: true });
}

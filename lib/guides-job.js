import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { admin } from './server';

// The monthly guide check. For each service in the library it asks Claude, with
// web search, for the company's current steps, then saves a draft only when
// something actually changed. Nothing goes live until it is approved on /review.
//
// Privacy: the only thing ever sent to the AI is a public service name such as
// "Netflix". No vault contents, and nothing a user has typed, ever reach it.

const MODEL = process.env.GUIDES_MODEL || 'claude-opus-5-5';

const STEPS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['help_url', 'keep', 'transfer', 'close', 'sources'],
  properties: {
    help_url: { type: 'string', description: "The single best official help page on the company's own website, or an empty string." },
    keep: { type: 'array', items: { type: 'string' }, description: 'Steps to keep the account running for the family.' },
    transfer: { type: 'array', items: { type: 'string' }, description: 'Steps to transfer the account or its contents to another person.' },
    close: { type: 'array', items: { type: 'string' }, description: 'Steps to close or memorialise the account.' },
    sources: { type: 'array', items: { type: 'string' }, description: 'URLs the steps were based on.' },
  },
};

const RESEARCH_PROMPT = (name) => `I help families deal with the everyday online accounts of someone who has died. Please search the web for ${name}'s current, official process, using ${name}'s own help or support pages wherever possible (not third-party blogs).

Find out, as it stands today:
1. How the family can keep the account running (for example, take over billing or keep using a shared plan).
2. How the account, or what is in it (photos, purchases, files), can be transferred to another person.
3. How to close the account, or memorialise it if that is what ${name} offers.

Note any documents ${name} asks for (such as a death certificate or proof of authority) and any official request forms. If ${name} offers no way to do one of the three, say so plainly. Finish with a short summary of what you found and list the URLs of the pages you relied on.`;

const STRUCTURE_PROMPT = (name, research) => `Below are research notes about how to handle a deceased person's ${name} account. Turn them into three short numbered lists of steps for a grieving family member who is not technical.

Rules:
- Each step is one short, plain sentence. No jargon, no exclamation marks.
- Use only what the notes support. Do not invent forms, links, phone numbers or timescales.
- Mention required documents in the step where they are needed.
- Never ask for, or tell the reader to share, a password or recovery key with anyone.
- If the notes say there is no way to do one of the three, give an empty list for it.
- help_url is the best official ${name} help page from the notes (empty string if none). sources are the URLs the notes relied on.

<research_notes>
${research}
</research_notes>`;

function textOf(message) {
  return message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

async function research(client, name) {
  const messages = [{ role: 'user', content: RESEARCH_PROMPT(name) }];
  let message;
  // Server-side web search may pause a long turn; resend to let it continue.
  for (let i = 0; i < 4; i++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }],
      messages,
    });
    message = await stream.finalMessage();
    if (message.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: message.content });
  }
  if (message.stop_reason === 'refusal') throw new Error('The model declined the research request');
  const notes = textOf(message);
  if (!notes) throw new Error('No research notes came back');
  return notes;
}

async function structure(client, name, notes) {
  const message = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: STEPS_SCHEMA } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content: STRUCTURE_PROMPT(name, notes) }],
  });
  if (message.stop_reason === 'refusal') throw new Error('The model declined to structure the steps');
  if (message.stop_reason === 'max_tokens') throw new Error('The structured answer was cut short');
  return validate(JSON.parse(textOf(message)));
}

const cleanList = (a) => (Array.isArray(a) ? a.map((s) => String(s).trim()).filter(Boolean).slice(0, 15) : []);
const cleanUrl = (u) => {
  try {
    const url = new URL(String(u || ''));
    return url.protocol === 'https:' ? url.toString() : '';
  } catch { return ''; }
};

export function validate(j) {
  const out = {
    help_url: cleanUrl(j.help_url),
    keep: cleanList(j.keep),
    transfer: cleanList(j.transfer),
    close: cleanList(j.close),
    sources: cleanList(j.sources).map(cleanUrl).filter(Boolean).slice(0, 10),
  };
  if (!out.keep.length && !out.transfer.length && !out.close.length) throw new Error('No steps at all came back');
  return out;
}

const norm = (a) => JSON.stringify((a || []).map((s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ')));

export function sameSteps(a, guide) {
  return norm(a.keep) === norm(guide.steps_keep)
    && norm(a.transfer) === norm(guide.steps_transfer)
    && norm(a.close) === norm(guide.steps_close);
}

export async function checkService(client, guide) {
  const db = admin();
  const notes = await research(client, guide.service_name);
  const j = await structure(client, guide.service_name, notes);
  const now = new Date().toISOString();
  if (guide.approved_at && sameSteps(j, guide)) {
    await db.from('guides').update({ checked_at: now }).eq('service_key', guide.service_key);
    return 'unchanged';
  }
  // Only the newest draft per service waits for review.
  await db.from('guide_drafts').update({ status: 'replaced', decided_at: now })
    .eq('service_key', guide.service_key).eq('status', 'pending');
  const { error } = await db.from('guide_drafts').insert({
    service_key: guide.service_key,
    steps_keep: j.keep, steps_transfer: j.transfer, steps_close: j.close,
    help_url: j.help_url || null, sources: j.sources,
  });
  if (error) throw new Error(`Could not save the draft: ${error.message}`);
  return 'draft saved';
}

export async function runGuideCheck({ only } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) return { results: [{ service: '*', result: 'skipped: ANTHROPIC_API_KEY is not set' }] };
  const client = new Anthropic({ timeout: 280_000, maxRetries: 2 });
  const db = admin();
  let q = db.from('guides').select('*').order('priority');
  if (only) q = q.eq('service_key', only);
  const { data: guides, error } = await q;
  if (error) throw new Error(error.message);

  // Services run side by side so the whole check fits in one function call.
  const results = await Promise.all((guides || []).map(async (g) => {
    try {
      return { service: g.service_key, result: await checkService(client, g) };
    } catch (err) {
      console.error(`[guides] ${g.service_key} failed:`, err?.message);
      return { service: g.service_key, result: `failed: ${err?.message || 'unknown error'}` };
    }
  }));
  return { results };
}

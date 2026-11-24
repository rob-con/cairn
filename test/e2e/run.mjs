// End-to-end test: drives the real Cairn app in a browser against a local
// Postgres (real schema and row level security) through the stand-in server.
//
// Needs: Postgres on localhost:5433 (or DATABASE_URL), and a production build
// made with the same env (the runner builds it unless SKIP_BUILD=1).
//   npm run test:e2e
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import pg from 'pg';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const DB = process.env.DATABASE_URL || 'postgres://postgres@localhost:5433/cairn_test';
const ADMIN_DB = DB.replace(/\/[^/]+$/, '/postgres');
const SHOTS = path.join(root, 'test/e2e/screenshots');
mkdirSync(SHOTS, { recursive: true });

// ---------------------------------------------------------------- database
{
  const c = new pg.Client(ADMIN_DB);
  await c.connect();
  await c.query('drop database if exists cairn_test with (force)');
  await c.query('create database cairn_test');
  await c.end();
  const d = new pg.Client(DB);
  await d.connect();
  await d.query(readFileSync(path.join(root, 'test/local-supabase/auth-stub.sql'), 'utf8'));
  await d.query(readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8'));
  await d.end();
}
const db = new pg.Pool({ connectionString: DB });
const q = async (sql, params) => (await db.query(sql, params)).rows;

// ---------------------------------------------------------------- servers
process.env.DATABASE_URL = DB;
const fake = await import('../local-supabase/server.mjs');
await new Promise((r) => fake.server.listen(54321, r));

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const SUPA = 'http://localhost:54321';
const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: SUPA,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: fake.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: fake.SERVICE_KEY,
  RESEND_API_KEY: 'test', RESEND_API_URL: `${SUPA}/resend`,
  ANTHROPIC_API_KEY: 'test', ANTHROPIC_BASE_URL: `${SUPA}/anthropic`,
  CRON_SECRET: 'test-cron-secret', ADMIN_EMAIL: 'robert@example.com',
  PORT: String(PORT),
};
if (process.env.SKIP_BUILD !== '1') execSync('npx next build', { cwd: root, env, stdio: 'inherit' });
const app = spawn('npx', ['next', 'start', '-p', String(PORT)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let appLog = '';
app.stdout.on('data', (d) => { appLog += d; });
app.stderr.on('data', (d) => { appLog += d; });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch();

// ---------------------------------------------------------------- helpers
const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name} (${Date.now() - t}ms)`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  ✗ ${name}\n    ${err.stack?.split('\n').slice(0, 4).join('\n    ')}`);
    throw err;
  }
}
const emails = async () => (await fetch(`${SUPA}/__emails`)).json();
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

async function signUp(page, email, password) {
  await page.goto(`${BASE}/signin`);
  await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
  if (email === 'robert@example.com') await shot(page, '00-welcome');
  await page.getByRole('button', { name: 'New here? Create an account', exact: true }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
}
async function signIn(page, email, password) {
  await page.goto(`${BASE}/signin`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
async function token(email, password) {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: fake.ANON_KEY }, body: JSON.stringify({ email, password }) });
  return (await r.json()).access_token;
}
async function rest(tok, method, pathAndQuery, body, extra = {}) {
  const r = await fetch(`${SUPA}/rest/v1/${pathAndQuery}`, {
    method, headers: { apikey: fake.ANON_KEY, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

const PLANNER = { email: 'robert@example.com', password: 'planner-password-1', pass: 'the lantern by the old stone wall' };
const EXEC = { email: 'sam@example.com', password: 'executor-password-1' };
let recoveryKey;

const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const planner = await desktop.newPage();
planner.on('pageerror', (e) => console.log('    [planner page error]', e.message));

try {
  console.log('\nFront page');
  await step('visitors see a one-page summary before signing in', async () => {
    await planner.goto(BASE);
    await planner.getByRole('heading', { name: 'A calm place to leave things in order.' }).waitFor();
    await planner.getByRole('heading', { name: 'How it works' }).waitFor();
    await planner.getByRole('heading', { name: 'We cannot read your vault' }).waitFor();
    await shot(planner, '00a-landing');
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await phone.goto(BASE);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'no sideways scrolling');
    await shot(phone, '00b-landing-phone');
    await phone.close();
    await planner.getByRole('link', { name: 'Get started', exact: true }).first().click();
    await planner.getByRole('heading', { name: 'Create your account' }).waitFor();
    await planner.goto(BASE);
    await planner.getByRole('link', { name: 'Sign in', exact: true }).first().click();
    await planner.getByRole('heading', { name: 'Welcome back' }).waitFor();
  });

  console.log('\nPlanner');
  await step('signs up and is sent to vault setup', async () => {
    await signUp(planner, PLANNER.email, PLANNER.password);
    await planner.waitForURL('**/setup');
    await shot(planner, '01-setup');
  });

  await step('creates a vault; recovery key is required before continuing', async () => {
    await planner.getByLabel('Your first name').fill('Robert');
    await planner.getByLabel('Choose a passphrase').fill('short');
    await planner.getByLabel('Type it again').fill('short');
    await planner.getByRole('button', { name: 'Create my vault', exact: true }).click();
    await planner.getByText('at least 12 characters').waitFor();
    await planner.getByLabel('Choose a passphrase').fill(PLANNER.pass);
    await planner.getByLabel('Type it again').fill(PLANNER.pass);
    await planner.getByRole('button', { name: 'Create my vault', exact: true }).click();
    recoveryKey = (await planner.getByTestId('recovery-key').textContent()).trim();
    assert.match(recoveryKey, /^([A-Z2-9]{4}-){5}[A-Z2-9]{4}$/);
    const cont = planner.getByRole('button', { name: 'Continue to my vault', exact: true });
    assert.equal(await cont.isDisabled(), true);
    await shot(planner, '02-recovery-key');
    await planner.getByLabel('I have saved my recovery key somewhere safe.').check();
    await cont.click();
    await planner.waitForURL('**/vault?welcome=1');
    await planner.getByText('Nothing here yet').waitFor();
    await shot(planner, '03-empty-vault');
  });

  await step('adds Netflix from the popular list', async () => {
    await planner.getByRole('button', { name: 'Add your first service', exact: true }).click();
    await planner.getByRole('button', { name: /^Netflix/ }).click();
    await planner.getByLabel('Username or email').fill('family@example.com');
    await planner.getByLabel('Password or code').fill('Netfl1x-secret!');
    await planner.getByLabel('A note for your executor').fill('This is on the family plan, cancel it last.');
    await planner.getByText('Close it', { exact: true }).click();
    await planner.getByRole('button', { name: 'Save', exact: true }).click();
    await planner.getByRole('heading', { name: 'Netflix', level: 1 }).waitFor();
  });

  await step('adds a custom service with the step editor (add, reorder, remove)', async () => {
    await planner.getByRole('button', { name: '+ Add a service', exact: true }).click();
    await planner.getByRole('button', { name: /^Home Wi-Fi router/ }).click();
    await planner.getByLabel('Password or code').fill('router-admin-4471');
    await planner.getByLabel(/^Website or where to find it/).fill('Sticker under the router');
    await planner.getByRole('button', { name: 'Add a step', exact: true }).click();
    await planner.getByLabel('Step 1', { exact: true }).fill('Second step');
    await planner.getByLabel('Step 1', { exact: true }).press('Enter');
    await planner.getByLabel('Step 2', { exact: true }).fill('First step');
    await planner.getByRole('button', { name: 'Add a step', exact: true }).click();
    await planner.getByLabel('Step 3', { exact: true }).fill('Throwaway');
    await planner.getByRole('button', { name: 'Move step 2 up', exact: true }).click();
    await planner.getByRole('button', { name: 'Remove step 3', exact: true }).click();
    assert.equal(await planner.getByLabel('Step 1', { exact: true }).inputValue(), 'First step');
    assert.equal(await planner.getByLabel('Step 2', { exact: true }).inputValue(), 'Second step');
    await shot(planner, '04-add-custom');
    await planner.getByRole('button', { name: 'Save', exact: true }).click();
    await planner.getByRole('heading', { name: 'Home Wi-Fi router', level: 1 }).waitFor();
    await shot(planner, '05-entry-view');
  });

  await step('warns when something looks financial', async () => {
    await planner.getByRole('button', { name: '+ Add a service', exact: true }).click();
    await planner.getByRole('button', { name: /^Something else/ }).click();
    await planner.getByLabel(/^Name/).fill('Chase bank');
    await planner.getByText('This looks like it might be a bank').waitFor();
    await planner.getByLabel(/^Name/).fill('Garage door');
    await planner.getByLabel('Password or code').fill('abandon ability able about above absent absorb abstract absurd abuse access accident');
    await planner.getByText('This looks like it might be a bank').waitFor();
    await planner.getByRole('button', { name: 'Cancel', exact: true }).click();
  });

  await step('the server only ever holds scrambled data', async () => {
    const rows = await q('select payload from entries');
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.match(r.payload, /^v1\./);
      for (const word of ['Netflix', 'family', 'router', 'secret', 'Sticker']) assert.ok(!r.payload.includes(word));
    }
    const cols = await q("select column_name from information_schema.columns where table_name = 'entries'");
    assert.ok(!cols.some((c) => c.column_name === 'service_key'), 'no plaintext service names');
  });

  await step('locks, refuses a wrong passphrase, unlocks with the right one', async () => {
    await planner.getByRole('button', { name: 'Lock', exact: true }).click();
    await planner.getByRole('heading', { name: 'Open your vault' }).waitFor();
    await planner.getByLabel('Passphrase').fill('not my passphrase');
    await planner.getByRole('button', { name: 'Open', exact: true }).click();
    await planner.getByText('That did not work. Please check your passphrase').waitFor();
    await planner.getByLabel('Passphrase').fill(PLANNER.pass);
    await planner.getByRole('button', { name: 'Open', exact: true }).click();
    await planner.getByText('2 services', { exact: true }).waitFor();
    await shot(planner, '06-vault-overview');
    await planner.goto(BASE);
    await planner.waitForURL('**/vault');
  });

  await step('invites an executor (email sent, recovery key never emailed)', async () => {
    await planner.getByRole('link', { name: 'Settings', exact: true }).click();
    await planner.getByLabel('Their email address').fill(EXEC.email);
    await planner.getByRole('button', { name: 'Send invitation', exact: true }).click();
    await planner.getByText('account not set up yet').waitFor();
    const mail = (await emails()).find((m) => m.to === EXEC.email);
    assert.ok(mail, 'invite email sent');
    assert.match(mail.subject, /Robert has asked you/);
    assert.ok(!mail.text.includes(recoveryKey) && !mail.text.includes(recoveryKey.replace(/-/g, '')));
    await planner.getByLabel('Remind me').selectOption('3');
    await planner.getByText('Reminder setting saved').waitFor();
    assert.equal((await q('select reminder_months from vaults'))[0].reminder_months, 3);
    await shot(planner, '07-settings');
  });

  console.log('\nGuide library and review');
  await step('a non-admin cannot reach the review API or run the job', async () => {
    const r = await fetch(`${BASE}/api/admin/guides`);
    assert.equal(r.status, 403);
    assert.equal((await fetch(`${BASE}/api/cron/guides`)).status, 401);
    assert.equal((await fetch(`${BASE}/api/cron/guides`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  });

  await step('monthly job saves drafts; only the public service name reaches the AI', async () => {
    const r = await fetch(`${BASE}/api/cron/guides`, { headers: { Authorization: 'Bearer test-cron-secret' } });
    const d = await r.json();
    assert.equal(r.status, 200, JSON.stringify(d));
    assert.deepEqual(d.results.map((x) => x.result), ['draft saved', 'draft saved', 'draft saved', 'draft saved']);
    const calls = await (await fetch(`${SUPA}/__anthropic`)).json();
    const sent = JSON.stringify(calls);
    for (const secret of ['Netfl1x-secret!', 'family@example.com', 'cancel it last', 'router-admin', PLANNER.email]) assert.ok(!sent.includes(secret));
    assert.ok(calls.every((c) => c.model === 'claude-opus-5-5'));
    assert.ok(calls.some((c) => c.tools?.[0]?.type === 'web_search_20260209'));
    assert.ok(calls.some((c) => c.output_config?.format?.type === 'json_schema'));
  });

  await step('executors cannot see unapproved guides', async () => {
    const tok = await token(PLANNER.email, PLANNER.password);
    const r = await rest(tok, 'GET', 'guides?select=*');
    assert.equal(r.body.length, 0);
  });

  await step('Robert reviews, edits and approves drafts (Apple and Google first)', async () => {
    await planner.getByRole('link', { name: 'Guide review', exact: true }).click();
    await planner.getByRole('heading', { name: 'Guide review' }).waitFor();
    const order = await planner.locator('section.card h2').allTextContents();
    assert.deepEqual(order, ['Apple', 'Google', 'Netflix', 'Spotify']);
    await shot(planner, '08-review');
    const netflix = planner.getByRole('region', { name: 'Netflix draft' });
    await netflix.getByLabel('Step 2', { exact: true }).first().fill('Choose a new payment card in Account settings.');
    for (const s of ['Apple', 'Google', 'Netflix', 'Spotify']) {
      await planner.getByRole('region', { name: `${s} draft` }).getByRole('button', { name: 'Approve and publish', exact: true }).click();
      await planner.getByText('Approved. Executors now see these steps.').waitFor();
    }
    await planner.getByText('Nothing is waiting. Every guide is up to date.').waitFor();
    const g = await q("select steps_keep from guides where service_key = 'netflix'");
    assert.equal(g[0].steps_keep[1], 'Choose a new payment card in Account settings.');
  });

  await step('next month: unchanged services are only re-dated, changes become drafts', async () => {
    let d = await (await fetch(`${BASE}/api/cron/guides`, { headers: { Authorization: 'Bearer test-cron-secret' } })).json();
    // Netflix was edited on approval, so the fresh research differs from it; the rest match.
    assert.deepEqual(Object.fromEntries(d.results.map((x) => [x.service, x.result])), { apple: 'unchanged', google: 'unchanged', netflix: 'draft saved', spotify: 'unchanged' });
    process.env.FAKE_GUIDE_VERSION = '2';
    d = await (await fetch(`${BASE}/api/cron/guides`, { headers: { Authorization: 'Bearer test-cron-secret' } })).json();
    assert.ok(d.results.every((x) => x.result === 'draft saved'));
    assert.equal((await q("select count(*)::int n from guide_drafts where status = 'pending'"))[0].n, 4);
    assert.equal((await q("select count(*)::int n from guide_drafts where status = 'replaced'"))[0].n, 1);
    await planner.reload();
    await planner.locator('.changed').first().waitFor();
    await shot(planner, '09-review-changes');
    // Reject Spotify's change: executors keep the approved version.
    await planner.getByRole('region', { name: 'Spotify draft' }).getByRole('button', { name: 'Reject', exact: true }).click();
    await planner.getByText('Rejected.').waitFor();
    const s = await q("select steps_transfer from guides where service_key = 'spotify'");
    assert.match(s[0].steps_transfer[0], /Contact Spotify support/);
    process.env.FAKE_GUIDE_VERSION = '1';
  });

  console.log('\nExecutor');
  const execCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const exec = await execCtx.newPage();
  exec.on('pageerror', (e) => console.log('    [executor page error]', e.message));

  await step('signs up with the invited email and is linked to the vault', async () => {
    await signUp(exec, EXEC.email, EXEC.password);
    await exec.waitForURL('**/executor');
    await exec.getByRole('heading', { name: "Robert's vault" }).waitFor();
    const v = await q('select executor_id from vaults');
    assert.ok(v[0].executor_id);
    await shot(exec, '10-executor-landing');
  });

  await step('row level security holds for the executor', async () => {
    const tok = await token(EXEC.email, EXEC.password);
    const vaults = await rest(tok, 'GET', 'vaults?select=*');
    assert.equal(vaults.body.length, 1);
    const vid = vaults.body[0].id;
    const ins = await rest(tok, 'POST', 'entries', { vault_id: vid, payload: 'v1.x.y' });
    assert.equal(ins.status, 403, 'executor cannot add entries');
    const upd = await rest(tok, 'PATCH', `vaults?id=eq.${vid}`, { owner_name: 'Mallory' });
    assert.ok(upd.status >= 400 || upd.body.length === 0, 'executor cannot change the vault');
    const del = await rest(tok, 'DELETE', `entries?vault_id=eq.${vid}`);
    assert.equal(del.body.length, 0, 'executor cannot delete entries');
    assert.equal((await q('select count(*)::int n from entries'))[0].n, 2);
  });

  await step('row level security holds for the planner and strangers', async () => {
    const tok = await token(PLANNER.email, PLANNER.password);
    const [v] = (await rest(tok, 'GET', 'vaults?select=id')).body;
    const sneaky = await rest(tok, 'PATCH', `vaults?id=eq.${v.id}`, { executor_id: (await q('select id from auth.users where email = $1', [PLANNER.email]))[0].id });
    assert.ok(sneaky.status >= 400, 'planner cannot set executor_id directly');
    const second = await rest(tok, 'POST', 'vaults', { owner_id: '00000000-0000-0000-0000-000000000000', wrapped_key_passphrase: 'x', passphrase_salt: 'x', wrapped_key_recovery: 'x', recovery_salt: 'x' });
    assert.ok(second.status >= 400, 'cannot create a vault for someone else');
    await fetch(`${SUPA}/auth/v1/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'stranger@example.com', password: 'stranger-password' }) });
    const st = await token('stranger@example.com', 'stranger-password');
    assert.equal((await rest(st, 'GET', 'vaults?select=*')).body.length, 0);
    assert.equal((await rest(st, 'GET', 'entries?select=*')).body.length, 0);
    assert.equal((await rest(st, 'GET', 'executor_progress?select=*')).body.length, 0);
    assert.ok((await rest(st, 'GET', 'guide_drafts?select=*')).status >= 400);
    const anon = await fetch(`${SUPA}/rest/v1/entries?select=*`, { headers: { apikey: fake.ANON_KEY, Authorization: `Bearer ${fake.ANON_KEY}` } });
    assert.ok(anon.status >= 400);
  });

  await step('a wrong or mistyped recovery key is gently refused', async () => {
    await exec.getByRole('button', { name: 'Open the vault', exact: true }).click();
    await exec.getByLabel(/^Recovery key/).fill('ABCD-EFGH');
    await exec.getByRole('button', { name: 'Open', exact: true }).click();
    await exec.getByText('does not look quite like a recovery key').waitFor();
    await exec.getByLabel(/^Recovery key/).fill('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF');
    await exec.getByRole('button', { name: 'Open', exact: true }).click();
    await exec.getByText('That did not work. Please check the key').waitFor({ timeout: 15000 });
  });

  await step('opens with the key typed loosely, and the owner is told', async () => {
    const before = (await emails()).length;
    await exec.getByLabel(/^Recovery key/).fill(recoveryKey.toLowerCase().replace(/-/g, ' '));
    await exec.getByRole('button', { name: 'Open', exact: true }).click();
    await exec.getByRole('heading', { name: 'Before you begin' }).waitFor({ timeout: 15000 });
    await exec.getByText('0 of 2 services done').waitFor();
    await shot(exec, '11-executor-intro');
    for (let i = 0; i < 20 && (await emails()).length === before; i++) await new Promise((r) => setTimeout(r, 100));
    const m = (await emails()).slice(before).find((x) => x.to === PLANNER.email);
    assert.ok(m && /opened by your executor/.test(m.subject));
  });

  await step('walks through Netflix: note first, approved steps for their wish, secret hidden', async () => {
    await exec.getByRole('button', { name: 'Begin', exact: true }).click();
    await exec.getByRole('heading', { name: 'Netflix', level: 1 }).waitFor();
    await exec.getByText('This is on the family plan, cancel it last.').waitFor();
    await exec.getByText('Close it', { exact: true }).waitFor();
    await exec.getByText("Open Netflix's request form for a deceased user's account.").waitFor();
    assert.equal(await exec.getByText('Netfl1x-secret!').count(), 0, 'secret hidden by default');
    await exec.getByRole('button', { name: 'Show', exact: true }).click();
    await exec.getByText('Netfl1x-secret!').waitFor();
    await exec.getByRole('button', { name: /^Keep/ }).click();
    await exec.getByText('Choose a new payment card in Account settings.').waitFor();
    await exec.getByRole('link', { name: "Netflix's own help page" }).waitFor();
    await shot(exec, '12-executor-service');
    await exec.getByRole('button', { name: 'Mark this as done', exact: true }).click();
    await exec.getByText('1 of 2 services done').waitFor();
    await exec.getByRole('heading', { name: 'Home Wi-Fi router', level: 1 }).waitFor();
    await exec.getByText('First step').waitFor();
    await shot(exec, '13-executor-custom');
    await exec.getByRole('button', { name: 'Mark this as done', exact: true }).click();
    await exec.getByText('2 of 2 services done').waitFor();
    await exec.getByRole('button', { name: 'Before you begin', exact: true }).click();
    await exec.getByRole('heading', { name: 'Every service is done' }).waitFor();
    await shot(exec, '14-executor-done');
  });

  await step('progress survives a reload; the layout holds on tablet and phone', async () => {
    await exec.reload();
    await exec.getByRole('button', { name: 'Open the vault', exact: true }).click();
    await exec.getByLabel(/^Recovery key/).fill(recoveryKey);
    await exec.getByRole('button', { name: 'Open', exact: true }).click();
    await exec.getByText('2 of 2 services done').waitFor({ timeout: 15000 });
    await exec.setViewportSize({ width: 820, height: 1180 });
    await exec.getByRole('button', { name: /^Netflix/ }).click();
    await shot(exec, '15-executor-tablet');
    await exec.setViewportSize({ width: 390, height: 844 });
    const overflow = await exec.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, 'no sideways scrolling on a phone');
    await shot(exec, '16-executor-phone');
  });

  console.log('\nKeys, reminders and two-step sign-in');
  await step('planner changes passphrase; old one stops working, entries still open', async () => {
    await planner.goto(`${BASE}/settings`);
    await planner.getByRole('button', { name: 'Change passphrase', exact: true }).click();
    await planner.getByLabel('Current passphrase').fill('wrong one entirely');
    await planner.getByLabel('New passphrase').fill('a brand new passphrase here');
    await planner.getByLabel('Type the new one again').fill('a brand new passphrase here');
    await planner.getByRole('button', { name: 'Change passphrase', exact: true }).click();
    await planner.getByText('Your current passphrase did not match').waitFor({ timeout: 15000 });
    await planner.getByLabel('Current passphrase').fill(PLANNER.pass);
    await planner.getByRole('button', { name: 'Change passphrase', exact: true }).click();
    await planner.getByText('Passphrase changed').waitFor({ timeout: 15000 });
    PLANNER.pass = 'a brand new passphrase here';
    await planner.goto(`${BASE}/vault`);
    await planner.getByLabel('Passphrase').fill(PLANNER.pass);
    await planner.getByRole('button', { name: 'Open', exact: true }).click();
    await planner.getByText('2 services', { exact: true }).waitFor({ timeout: 15000 });
  });

  await step('a new recovery key replaces the old one', async () => {
    await planner.goto(`${BASE}/settings`);
    await planner.getByRole('button', { name: 'Make a new recovery key', exact: true }).click();
    await planner.getByLabel('Your passphrase').fill(PLANNER.pass);
    await planner.getByRole('button', { name: 'Make the new key', exact: true }).click();
    const fresh = (await planner.getByTestId('recovery-key').textContent({ timeout: 15000 })).trim();
    assert.notEqual(fresh, recoveryKey);
    await planner.getByLabel('I have saved the new key and will give my executor a copy.').check();
    await planner.getByRole('button', { name: 'Use the new key', exact: true }).click();
    await planner.getByText('New recovery key saved').waitFor();
    await exec.setViewportSize({ width: 1280, height: 860 });
    await exec.getByRole('button', { name: 'Lock', exact: true }).click();
    await exec.reload();
    await exec.getByRole('button', { name: 'Open the vault', exact: true }).click();
    await exec.getByLabel(/^Recovery key/).fill(recoveryKey);
    await exec.getByRole('button', { name: 'Open', exact: true }).click();
    await exec.getByText('That did not work. Please check the key').waitFor({ timeout: 15000 });
    await exec.getByLabel(/^Recovery key/).fill(fresh);
    await exec.getByRole('button', { name: 'Open', exact: true }).click();
    await exec.getByText('2 of 2 services done').waitFor({ timeout: 15000 });
    recoveryKey = fresh;
  });

  await step('reminder job emails the planner when due, and nudges unset-up executors', async () => {
    await q("update vaults set last_reminded_at = now() - interval '4 months'");
    await fetch(`${SUPA}/auth/v1/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'lee@example.com', password: 'lee-password-123' }) });
    const before = (await emails()).length;
    let r = await (await fetch(`${BASE}/api/cron/reminders`, { headers: { Authorization: 'Bearer test-cron-secret' } })).json();
    assert.equal(r.planners, 1);
    const sent = (await emails()).slice(before);
    assert.ok(sent.some((m) => m.to === PLANNER.email && /check-in/.test(m.subject)));
    r = await (await fetch(`${BASE}/api/cron/reminders`, { headers: { Authorization: 'Bearer test-cron-secret' } })).json();
    assert.equal(r.planners, 0, 'not twice');
    // An invited executor who has not signed up gets a nudge after a week.
    const leeId = (await q("select id from auth.users where email = 'lee@example.com'"))[0].id;
    await q("insert into vaults (owner_id, owner_name, wrapped_key_passphrase, passphrase_salt, wrapped_key_recovery, recovery_salt, executor_email, executor_invited_at, reminder_months) values ($1, 'Lee', 'x', 'x', 'x', 'x', 'pat@example.com', now() - interval '8 days', 0)", [leeId]);
    r = await (await fetch(`${BASE}/api/cron/reminders`, { headers: { Authorization: 'Bearer test-cron-secret' } })).json();
    assert.equal(r.executors, 1);
    r = await (await fetch(`${BASE}/api/cron/reminders`, { headers: { Authorization: 'Bearer test-cron-secret' } })).json();
    assert.equal(r.executors, 0, 'waits two weeks before the next nudge');
  });

  await step('two-step sign-in: enrol, then password alone no longer reaches the data', async () => {
    await planner.goto(`${BASE}/settings`);
    await planner.getByRole('button', { name: 'Set up two-step sign-in', exact: true }).click();
    const secret = (await planner.locator('code').last().textContent()).trim();
    await planner.getByLabel('Code', { exact: true }).fill(fake.totp(secret));
    await planner.getByRole('button', { name: 'Turn on', exact: true }).click();
    await planner.getByText('Two-step sign-in is on').waitFor();
    const aal1 = await token(PLANNER.email, PLANNER.password);
    assert.equal((await rest(aal1, 'GET', 'vaults?select=*')).body.length, 0, 'aal1 session sees nothing');
    assert.equal((await rest(aal1, 'GET', 'entries?select=*')).body.length, 0);
    await planner.getByRole('button', { name: 'Sign out', exact: true }).click();
    await planner.waitForURL(BASE + '/');
    await signIn(planner, PLANNER.email, PLANNER.password);
    await planner.getByRole('heading', { name: 'One more step' }).waitFor();
    await shot(planner, '17-mfa');
    await planner.getByLabel('Code from your authenticator app').fill('000000');
    await planner.getByRole('button', { name: 'Continue', exact: true }).click();
    await planner.getByText('That code did not work').waitFor();
    await planner.getByLabel('Code from your authenticator app').fill(fake.totp(secret));
    await planner.getByRole('button', { name: 'Continue', exact: true }).click();
    await planner.waitForURL('**/vault');
    await planner.getByRole('heading', { name: 'Open your vault' }).waitFor();
  });

  await step('choosing a different executor cuts off the old one', async () => {
    await planner.goto(`${BASE}/settings`);
    await planner.getByRole('button', { name: 'Choose someone else', exact: true }).click();
    await planner.getByLabel('Their email address').fill('alex@example.com');
    await planner.getByRole('button', { name: 'Send invitation', exact: true }).click();
    await planner.getByText('alex@example.com').waitFor();
    const tok = await token(EXEC.email, EXEC.password);
    assert.equal((await rest(tok, 'GET', 'vaults?select=*')).body.length, 0);
    assert.equal((await rest(tok, 'GET', 'entries?select=*')).body.length, 0);
  });
} catch {
  // reported above
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length) console.log('\n--- app log (tail) ---\n' + appLog.split('\n').slice(-40).join('\n'));
  await browser.close();
  try { process.kill(-app.pid, 'SIGTERM'); } catch {}
  fake.server.close();
  await db.end();
  process.exit(failed.length ? 1 : 0);
}

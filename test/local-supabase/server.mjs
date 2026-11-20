// A small stand-in for Supabase (auth + PostgREST), plus fake Anthropic and
// Resend endpoints, backed by a real local Postgres. It exists only so the
// end-to-end tests can drive the real app against the real schema and row
// level security policies. Not for production use.
//
//   DATABASE_URL=postgres://postgres@localhost:5433/cairn_test node server.mjs
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

const PORT = Number(process.env.PORT || 54321);
const JWT_SECRET = process.env.JWT_SECRET || 'local-test-secret-local-test-secret';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres@localhost:5433/cairn_test' });

// ---------------------------------------------------------------- JWT helpers
const b64u = (b) => Buffer.from(b).toString('base64url');
export function signJwt(payload) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verifyJwt(token) {
  const [h, b, s] = String(token || '').split('.');
  if (!h || !b || !s) return null;
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url');
  if (sig.length !== s.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(s))) return null;
  const p = JSON.parse(Buffer.from(b, 'base64url').toString());
  if (p.exp && p.exp < Date.now() / 1000) return null;
  return p;
}
export const ANON_KEY = signJwt({ role: 'anon', iss: 'local' });
export const SERVICE_KEY = signJwt({ role: 'service_role', iss: 'local' });

// ---------------------------------------------------------------- TOTP
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32decode(s) {
  let bits = '';
  for (const c of s.replace(/=+$/, '')) bits += B32.indexOf(c).toString(2).padStart(5, '0');
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
export function totp(secret, t = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}

// ---------------------------------------------------------------- state
const refreshTokens = new Map(); // token -> { userId, aal }
const challenges = new Map();
export const sentEmails = [];
const anthropicCalls = [];

const hash = (p) => crypto.createHash('sha256').update(`salt:${p}`).digest('hex');

async function userJson(id) {
  const { rows } = await pool.query('select * from auth.users where id = $1', [id]);
  const u = rows[0];
  if (!u) return null;
  const { rows: factors } = await pool.query('select * from auth.mfa_factors where user_id = $1 order by created_at', [id]);
  return {
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
    email_confirmed_at: u.email_confirmed_at, confirmed_at: u.email_confirmed_at,
    created_at: u.created_at, updated_at: u.updated_at,
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [],
    factors: factors.map((f) => ({ id: f.id, friendly_name: f.friendly_name, factor_type: f.factor_type, status: f.status, created_at: f.created_at, updated_at: f.updated_at })),
  };
}

async function session(userId, aal = 'aal1') {
  const user = await userJson(userId);
  const now = Math.floor(Date.now() / 1000);
  const amr = [{ method: 'password', timestamp: now }];
  if (aal === 'aal2') amr.push({ method: 'totp', timestamp: now });
  const access_token = signJwt({ sub: userId, email: user.email, role: 'authenticated', aud: 'authenticated', aal, amr, iat: now, exp: now + 3600, session_id: crypto.randomUUID() });
  const refresh_token = crypto.randomBytes(16).toString('hex');
  refreshTokens.set(refresh_token, { userId, aal });
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token, user };
}

// ---------------------------------------------------------------- http utils
function send(res, status, body, headers = {}) {
  const h = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...headers };
  res.writeHead(status, h);
  res.end(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body));
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString();
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
function bearer(req) {
  const a = req.headers.authorization || '';
  return a.startsWith('Bearer ') ? a.slice(7) : null;
}
const authErr = (res, msg, status = 400, code = 'validation_failed') => send(res, status, { code, error_code: code, msg, message: msg, error: code, error_description: msg });

// ---------------------------------------------------------------- auth
async function handleAuth(req, res, path, url) {
  const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
  const claims = verifyJwt(bearer(req));

  if (path === '/signup' && req.method === 'POST') {
    const email = String(body.email || '').toLowerCase();
    if (!email || !body.password) return authErr(res, 'Missing email or password');
    const exists = await pool.query('select id from auth.users where email = $1', [email]);
    if (exists.rows.length) return authErr(res, 'User already registered', 422, 'user_already_exists');
    const confirmed = process.env.AUTOCONFIRM !== 'false';
    const { rows } = await pool.query('insert into auth.users (email, encrypted_password, email_confirmed_at) values ($1, $2, $3) returning id',
      [email, hash(body.password), confirmed ? new Date() : null]);
    if (!confirmed) return send(res, 200, await userJson(rows[0].id));
    return send(res, 200, await session(rows[0].id));
  }

  if (path === '/token' && req.method === 'POST') {
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password') {
      const { rows } = await pool.query('select * from auth.users where email = $1', [String(body.email || '').toLowerCase()]);
      const u = rows[0];
      if (!u || u.encrypted_password !== hash(body.password)) return authErr(res, 'Invalid login credentials', 400, 'invalid_credentials');
      if (!u.email_confirmed_at) return authErr(res, 'Email not confirmed', 400, 'email_not_confirmed');
      return send(res, 200, await session(u.id));
    }
    if (grant === 'refresh_token') {
      const t = refreshTokens.get(body.refresh_token);
      if (!t) return authErr(res, 'Invalid Refresh Token', 400, 'refresh_token_not_found');
      refreshTokens.delete(body.refresh_token);
      return send(res, 200, await session(t.userId, t.aal));
    }
    return authErr(res, 'unsupported grant');
  }

  if (path === '/logout') return send(res, 204);
  if (path === '/recover') return send(res, 200, {});

  if (path.startsWith('/admin/users/') && req.method === 'GET') {
    if (claims?.role !== 'service_role') return authErr(res, 'Not admin', 403, 'not_admin');
    const u = await userJson(path.split('/')[3]);
    return u ? send(res, 200, u) : authErr(res, 'User not found', 404, 'user_not_found');
  }

  if (!claims?.sub) return authErr(res, 'Invalid JWT', 401, 'bad_jwt');

  if (path === '/user' && req.method === 'GET') {
    const u = await userJson(claims.sub);
    return u ? send(res, 200, u) : authErr(res, 'User not found', 404, 'user_not_found');
  }
  if (path === '/user' && req.method === 'PUT') {
    if (body.password) await pool.query('update auth.users set encrypted_password = $1, updated_at = now() where id = $2', [hash(body.password), claims.sub]);
    return send(res, 200, await userJson(claims.sub));
  }

  if (path === '/factors' && req.method === 'POST') {
    const secret = Array.from(crypto.randomBytes(20), (b) => B32[b % 32]).join('');
    const { rows } = await pool.query('insert into auth.mfa_factors (user_id, friendly_name, secret) values ($1, $2, $3) returning id',
      [claims.sub, body.friendly_name || null, secret]);
    const uri = `otpauth://totp/Cairn:${claims.email}?secret=${secret}&issuer=Cairn`;
    const qr = `data:image/svg+xml;utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#eee"/><text x="20" y="85" font-size="14">QR (test)</text></svg>')}`;
    return send(res, 200, { id: rows[0].id, type: 'totp', friendly_name: body.friendly_name, totp: { qr_code: qr, secret, uri } });
  }
  let m = path.match(/^\/factors\/([^/]+)\/challenge$/);
  if (m && req.method === 'POST') {
    const id = crypto.randomUUID();
    challenges.set(id, m[1]);
    return send(res, 200, { id, type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 });
  }
  m = path.match(/^\/factors\/([^/]+)\/verify$/);
  if (m && req.method === 'POST') {
    if (challenges.get(body.challenge_id) !== m[1]) return authErr(res, 'Challenge not found', 404, 'mfa_challenge_not_found');
    const { rows } = await pool.query('select * from auth.mfa_factors where id = $1 and user_id = $2', [m[1], claims.sub]);
    const f = rows[0];
    const ok = f && [-30000, 0, 30000].some((d) => totp(f.secret, Date.now() + d) === String(body.code));
    if (!ok) return authErr(res, 'Invalid TOTP code entered', 422, 'mfa_verification_failed');
    await pool.query("update auth.mfa_factors set status = 'verified', updated_at = now() where id = $1", [f.id]);
    challenges.delete(body.challenge_id);
    return send(res, 200, await session(claims.sub, 'aal2'));
  }
  m = path.match(/^\/factors\/([^/]+)$/);
  if (m && req.method === 'DELETE') {
    const { rows } = await pool.query('select status from auth.mfa_factors where id = $1 and user_id = $2', [m[1], claims.sub]);
    if (rows[0]?.status === 'verified' && claims.aal !== 'aal2') return authErr(res, 'AAL2 required', 403, 'insufficient_aal');
    await pool.query('delete from auth.mfa_factors where id = $1 and user_id = $2', [m[1], claims.sub]);
    return send(res, 200, { id: m[1] });
  }
  return authErr(res, `No route ${req.method} ${path}`, 404, 'not_found');
}

// ---------------------------------------------------------------- PostgREST subset
const IDENT = /^[a-z_][a-z0-9_]*$/;
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict']);

function buildWhere(url, params) {
  const clauses = [];
  for (const [key, raw] of url.searchParams) {
    if (RESERVED.has(key)) continue;
    if (!IDENT.test(key)) throw Object.assign(new Error(`bad column ${key}`), { code: 'PGRST100' });
    let v = raw;
    let neg = false;
    if (v.startsWith('not.')) { neg = true; v = v.slice(4); }
    const dot = v.indexOf('.');
    const op = v.slice(0, dot);
    const val = v.slice(dot + 1);
    let sql;
    if (op === 'is') {
      const lit = { null: 'null', true: 'true', false: 'false' }[val];
      if (!lit) throw new Error(`bad is value ${val}`);
      sql = `"${key}" is ${lit}`;
    } else if (op === 'in') {
      const items = val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''));
      const ph = items.map((it) => { params.push(it); return `$${params.length}`; });
      sql = ph.length ? `"${key}" in (${ph.join(',')})` : 'false';
    } else {
      const ops = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
      if (!ops[op]) throw new Error(`unsupported operator ${op}`);
      params.push(val);
      sql = `"${key}" ${ops[op]} $${params.length}`;
    }
    clauses.push(neg ? `not (${sql})` : sql);
  }
  return clauses.length ? ` where ${clauses.join(' and ')}` : '';
}

function selectList(url) {
  const s = url.searchParams.get('select') || '*';
  if (s === '*') return '*';
  const cols = s.split(',').map((c) => c.trim());
  if (!cols.every((c) => IDENT.test(c))) throw new Error('unsupported select');
  return cols.map((c) => `"${c}"`).join(', ');
}

function orderBy(url) {
  const o = url.searchParams.get('order');
  if (!o) return '';
  return ' order by ' + o.split(',').map((part) => {
    const [col, dir = 'asc', nulls] = part.split('.');
    if (!IDENT.test(col)) throw new Error('bad order');
    return `"${col}" ${dir === 'desc' ? 'desc' : 'asc'}${nulls === 'nullsfirst' ? ' nulls first' : nulls === 'nullslast' ? ' nulls last' : ''}`;
  }).join(', ');
}

const toParam = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

async function handleRest(req, res, table, url) {
  if (!IDENT.test(table)) return send(res, 404, { code: '42P01', message: 'not found' });
  const claims = verifyJwt(bearer(req) || req.headers.apikey);
  if (!claims) return send(res, 401, { code: 'PGRST301', message: 'JWT invalid' });
  const role = ['anon', 'authenticated', 'service_role'].includes(claims.role) ? claims.role : 'anon';
  const prefer = String(req.headers.prefer || '');
  const wantsRows = prefer.includes('return=representation');
  const wantsCount = prefer.includes('count=exact');
  const single = String(req.headers.accept || '').includes('vnd.pgrst.object');

  const params = [];
  let sql;
  try {
    if (req.method === 'GET' || req.method === 'HEAD') {
      sql = `select ${selectList(url)} from public."${table}"${buildWhere(url, params)}${orderBy(url)}`;
      const limit = url.searchParams.get('limit');
      if (limit) sql += ` limit ${Number(limit) | 0}`;
    } else if (req.method === 'POST') {
      const body = await readBody(req);
      const rows = Array.isArray(body) ? body : [body];
      const cols = Object.keys(rows[0] || {});
      if (!cols.every((c) => IDENT.test(c))) throw new Error('bad column');
      const values = rows.map((r) => `(${cols.map((c) => { params.push(toParam(r[c] ?? null)); return `$${params.length}`; }).join(', ')})`);
      sql = cols.length
        ? `insert into public."${table}" (${cols.map((c) => `"${c}"`).join(', ')}) values ${values.join(', ')}`
        : `insert into public."${table}" default values`;
      sql += ` returning ${wantsRows ? selectList(url) : '1'}`;
    } else if (req.method === 'PATCH') {
      const body = await readBody(req);
      const cols = Object.keys(body);
      if (!cols.length || !cols.every((c) => IDENT.test(c))) throw new Error('bad update');
      const sets = cols.map((c) => { params.push(toParam(body[c])); return `"${c}" = $${params.length}`; });
      sql = `update public."${table}" set ${sets.join(', ')}${buildWhere(url, params)} returning ${wantsRows ? selectList(url) : '1'}`;
    } else if (req.method === 'DELETE') {
      sql = `delete from public."${table}"${buildWhere(url, params)} returning ${wantsRows ? selectList(url) : '1'}`;
    } else {
      return send(res, 405, { message: 'method' });
    }
  } catch (err) {
    return send(res, 400, { code: err.code || 'PGRST100', message: err.message, details: null, hint: null });
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const result = await client.query(sql, params);
    await client.query('commit');
    const rows = result.rows;
    const headers = {};
    if (wantsCount) headers['Content-Range'] = `0-${Math.max(rows.length - 1, 0)}/${rows.length}`;
    if (req.method === 'HEAD') return send(res, 200, undefined, headers);
    if (req.method !== 'GET' && !wantsRows) return send(res, req.method === 'POST' ? 201 : 204, undefined, headers);
    if (single) {
      if (rows.length !== 1) {
        return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null });
      }
      return send(res, 200, rows[0], headers);
    }
    return send(res, req.method === 'POST' ? 201 : 200, rows, headers);
  } catch (err) {
    await client.query('rollback').catch(() => {});
    const status = err.code === '42501' ? (role === 'anon' ? 401 : 403) : err.code === '23505' ? 409 : 400;
    return send(res, status, { code: err.code, message: err.message, details: err.detail || null, hint: null });
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------- fake Anthropic
function fakeResearch(name) {
  return `Notes for ${name}. Official help page: https://support.${name.toLowerCase()}.example/deceased . To keep: the family can take over billing. To transfer: request a transfer with a death certificate. To close: submit the official form.`;
}
function fakeSteps(name) {
  const version = Number(process.env.FAKE_GUIDE_VERSION || 1);
  return {
    help_url: `https://support.${name.toLowerCase()}.example/deceased`,
    keep: [`Sign in to ${name} with the details above.`, 'Update the payment card to your own.'],
    transfer: version > 1
      ? [`Fill in ${name}'s new online transfer form.`, 'Upload a copy of the death certificate.']
      : [`Contact ${name} support and ask to transfer the account.`, 'Have a copy of the death certificate ready.'],
    close: [`Open ${name}'s request form for a deceased user's account.`, 'Attach the death certificate and submit it.'],
    sources: [`https://support.${name.toLowerCase()}.example/deceased`],
  };
}
async function handleAnthropic(req, res) {
  const body = await readBody(req);
  anthropicCalls.push(body);
  const prompt = JSON.stringify(body.messages);
  const name = (prompt.match(/deceased person's (\w+)|search the web for (\w+)'s/i) || []).slice(1).find(Boolean) || 'Service';
  const isStructure = !!body.output_config?.format;
  const text = isStructure ? JSON.stringify(fakeSteps(name)) : fakeResearch(name);
  const message = {
    id: `msg_${crypto.randomUUID()}`, type: 'message', role: 'assistant', model: body.model,
    content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
  if (!body.stream) return send(res, 200, message);
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev('message_start', { message: { ...message, content: [], stop_reason: null } });
  ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
  ev('content_block_stop', { index: 0 });
  ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } });
  ev('message_stop', {});
  res.end();
}

// ---------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS',
      'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': 'Content-Range',
    });
    return res.end();
  }
  try {
    if (url.pathname.startsWith('/auth/v1')) return await handleAuth(req, res, url.pathname.slice(8), url);
    if (url.pathname.startsWith('/rest/v1/')) return await handleRest(req, res, url.pathname.slice(9), url);
    if (url.pathname === '/anthropic/v1/messages') return await handleAnthropic(req, res);
    if (url.pathname === '/resend/emails') {
      const body = await readBody(req);
      sentEmails.push(body);
      return send(res, 200, { id: crypto.randomUUID() });
    }
    if (url.pathname === '/__emails') return send(res, 200, sentEmails);
    if (url.pathname === '/__anthropic') return send(res, 200, anthropicCalls);
    if (url.pathname === '/__totp') {
      const { rows } = await pool.query('select secret from auth.mfa_factors where id = $1', [url.searchParams.get('factor')]);
      return send(res, 200, { code: rows[0] ? totp(rows[0].secret) : null });
    }
    return send(res, 404, { message: 'not found' });
  } catch (err) {
    console.error(err);
    return send(res, 500, { message: err.message });
  }
});

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  server.listen(PORT, () => {
    console.log(`local supabase on :${PORT}`);
    console.log(`ANON_KEY=${ANON_KEY}`);
    console.log(`SERVICE_KEY=${SERVICE_KEY}`);
  });
}
export { server };

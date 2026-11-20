import 'server-only';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

// Full-access database connection for server code only. It bypasses row level
// security, so every route that uses it checks who is calling first.
let adminClient;
export function admin() {
  if (!adminClient) {
    adminClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}

export async function userClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch {}
      },
    },
  });
}

// The signed-in user, verified with Supabase (not just read from the cookie).
export async function currentUser() {
  const client = await userClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
}

export function isAdminUser(user) {
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  return !!user && !!adminEmail && (user.email || '').toLowerCase() === adminEmail;
}

export async function requireAdmin() {
  const user = await currentUser();
  return isAdminUser(user) ? user : null;
}

export function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function isCronRequest(req) {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`;
}

export function siteUrl(req) {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  if (req) return new URL(req.url).origin;
  return process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '';
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

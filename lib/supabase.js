import { createBrowserClient } from '@supabase/ssr';

// One browser connection for the whole app. The session lives in cookies so
// the server routes (invite, claim, review) can tell who is calling.
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

-- Cairn database schema.
-- Run this once in the Supabase SQL editor (Project > SQL Editor > New query).
--
-- Design rule: the server never sees anything readable about a vault's contents.
-- Every service name, username, password, code, note and step lives inside the
-- encrypted `payload` text, sealed in the planner's browser.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.vaults (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  owner_name text not null default '',          -- first name shown to the executor
  executor_id uuid references auth.users(id) on delete set null,
  executor_email text,
  executor_invited_at timestamptz,
  executor_nudged_at timestamptz,
  executor_nudges int not null default 0,
  executor_opened_at timestamptz,
  wrapped_key_passphrase text not null,         -- vault key, locked with the passphrase
  passphrase_salt text not null,
  wrapped_key_recovery text not null,           -- vault key, locked with the recovery key
  recovery_salt text not null,
  recovery_created_at timestamptz not null default now(),
  reminder_months int not null default 6 check (reminder_months in (0, 3, 6, 12)),
  last_reminded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint executor_not_owner check (executor_id is null or executor_id <> owner_id)
);

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.vaults(id) on delete cascade,
  payload text not null,                        -- encrypted JSON, see lib/crypto.js
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists entries_vault_idx on public.entries(vault_id);

create table if not exists public.executor_progress (
  entry_id uuid primary key references public.entries(id) on delete cascade,
  done_at timestamptz not null default now()
);

-- The guide library holds only public information: a service name and the
-- company's published steps. Nothing a user types ever goes here.
create table if not exists public.guides (
  service_key text primary key,
  service_name text not null,
  help_url text,
  steps_keep jsonb not null default '[]'::jsonb,
  steps_transfer jsonb not null default '[]'::jsonb,
  steps_close jsonb not null default '[]'::jsonb,
  checked_at timestamptz,
  approved_at timestamptz,
  priority int not null default 100              -- lower = reviewed first
);

create table if not exists public.guide_drafts (
  id bigint generated always as identity primary key,
  service_key text not null references public.guides(service_key) on delete cascade,
  steps_keep jsonb not null default '[]'::jsonb,
  steps_transfer jsonb not null default '[]'::jsonb,
  steps_close jsonb not null default '[]'::jsonb,
  help_url text,
  sources jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'replaced')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Column-level privileges
-- Signed-in users may create their own vault and change only their own keys and
-- settings. Executor fields are set only by the server (invite / claim routes).
-- ---------------------------------------------------------------------------

revoke all on public.vaults, public.entries, public.executor_progress,
  public.guides, public.guide_drafts from anon;
revoke insert, update on public.vaults from authenticated;
grant select, delete on public.vaults to authenticated;
grant insert (owner_id, owner_name, wrapped_key_passphrase, passphrase_salt,
  wrapped_key_recovery, recovery_salt) on public.vaults to authenticated;
grant update (owner_name, wrapped_key_passphrase, passphrase_salt, wrapped_key_recovery,
  recovery_salt, recovery_created_at, reminder_months, updated_at) on public.vaults to authenticated;

revoke all on public.guides, public.guide_drafts from authenticated;
grant select on public.guides to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.vaults enable row level security;
alter table public.entries enable row level security;
alter table public.executor_progress enable row level security;
alter table public.guides enable row level security;
alter table public.guide_drafts enable row level security;   -- no policy: server only

drop policy if exists vault_read on public.vaults;
create policy vault_read on public.vaults for select to authenticated
  using ((select auth.uid()) = owner_id or (select auth.uid()) = executor_id);

drop policy if exists vault_insert on public.vaults;
create policy vault_insert on public.vaults for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists vault_update on public.vaults;
create policy vault_update on public.vaults for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

drop policy if exists vault_delete on public.vaults;
create policy vault_delete on public.vaults for delete to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists entry_owner on public.entries;
create policy entry_owner on public.entries for all to authenticated
  using (exists (select 1 from public.vaults v where v.id = vault_id and v.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.vaults v where v.id = vault_id and v.owner_id = (select auth.uid())));

drop policy if exists entry_executor_read on public.entries;
create policy entry_executor_read on public.entries for select to authenticated
  using (exists (select 1 from public.vaults v where v.id = vault_id and v.executor_id = (select auth.uid())));

drop policy if exists progress_read on public.executor_progress;
create policy progress_read on public.executor_progress for select to authenticated
  using (exists (select 1 from public.entries e join public.vaults v on v.id = e.vault_id
    where e.id = entry_id and (v.executor_id = (select auth.uid()) or v.owner_id = (select auth.uid()))));

drop policy if exists progress_write on public.executor_progress;
create policy progress_write on public.executor_progress for insert to authenticated
  with check (exists (select 1 from public.entries e join public.vaults v on v.id = e.vault_id
    where e.id = entry_id and v.executor_id = (select auth.uid())));

drop policy if exists progress_delete on public.executor_progress;
create policy progress_delete on public.executor_progress for delete to authenticated
  using (exists (select 1 from public.entries e join public.vaults v on v.id = e.vault_id
    where e.id = entry_id and v.executor_id = (select auth.uid())));

-- Executors only ever see guides that Robert has approved.
drop policy if exists guides_read on public.guides;
create policy guides_read on public.guides for select to authenticated
  using (approved_at is not null);

-- Two-factor: once someone has turned on an authenticator app, their data can
-- only be reached from a session that has passed the second step.
-- Runs with the owner's rights so it can check auth.mfa_factors without
-- giving signed-in users direct access to that table.
create or replace function public.mfa_satisfied() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    or not exists (select 1 from auth.mfa_factors f
      where f.user_id = auth.uid() and f.status = 'verified')
$$;
revoke all on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated;

drop policy if exists mfa_vaults on public.vaults;
create policy mfa_vaults on public.vaults as restrictive to authenticated
  using ((select public.mfa_satisfied()));

drop policy if exists mfa_entries on public.entries;
create policy mfa_entries on public.entries as restrictive to authenticated
  using ((select public.mfa_satisfied()));

-- ---------------------------------------------------------------------------
-- Starting guide library. Hidden from executors until approved on /review.
-- ---------------------------------------------------------------------------

insert into public.guides (service_key, service_name, priority) values
  ('apple', 'Apple', 1),
  ('google', 'Google', 2),
  ('netflix', 'Netflix', 3),
  ('spotify', 'Spotify', 4)
on conflict (service_key) do nothing;

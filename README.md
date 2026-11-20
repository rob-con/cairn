# Cairn

A calm place to leave things in order. A planner records the everyday services their household relies on (streaming, the home router, the garage door code) with a personal note and a wish for each: keep it, transfer it, or close it. Later, their executor opens the vault with a recovery key and is guided through each service one at a time.

Built with Next.js 16 (App Router, JavaScript), Supabase (accounts and encrypted data), Resend (email) and the Anthropic API (monthly guide check). Hosted on Vercel.

## How the security works

Everything sensitive is encrypted in the browser before it is saved. The server stores scrambled text it cannot read.

- When the vault is created, the browser makes a random 256-bit **vault key**. Every entry is encrypted with it (AES-GCM).
- The vault key is stored twice, each copy locked: once with the planner's **passphrase**, once with the **recovery key** (both stretched with PBKDF2, 600,000 rounds). Either one opens the vault, so losing one does not lock out the other.
- **The server sees:** encrypted text, account emails, the planner's first name, timestamps. **It cannot see:** service names, usernames, passwords, codes, notes or steps.
- **If both the passphrase and the recovery key are lost, the data is gone.** Nobody can reset it, including us. The app says this plainly at setup.
- The recovery key is shown once, never emailed, and can be printed as a one-page letter for the executor. The planner can replace it at any time (the old one stops working straight away).
- The unlocked key lives only in memory and locks itself after 15 quiet minutes.
- Row level security in Supabase means each person can reach only their own vault, and an executor only the vault they were invited to, read-only. Executor links are set only by the server, and only for a confirmed email address.
- The planner is emailed whenever their executor opens the vault, so an unexpected opening never goes unnoticed.
- Optional two-step sign-in (authenticator app). Once it is on, the database refuses that account's data to any session that has not passed the second step.
- No financial credentials: the app says so on every entry screen and gently warns if something looks like a bank, investment or crypto account (checked in the browser).

**An honest limit:** if someone steals the planner's device while the vault is unlocked, or gets both the executor's Cairn sign-in and the recovery key, they get access. The design protects against server breaches, not against a lost key. An independent security review is planned before any public launch.

## AI-maintained guides

Users never see an AI button. Once a month a scheduled job takes each service in the guide library (starting with Apple, Google, Netflix and Spotify), asks Claude with web search for the company's current official steps, and saves a draft **only if something changed**. Drafts wait on `/review`, where the administrator (`ADMIN_EMAIL`) sees the published and new steps side by side, edits them, and approves or rejects. Executors only ever see approved steps, read from the database, with a last-checked date and a link to the company's own help page.

The AI only ever receives a public service name. No vault contents, and nothing a user typed, ever reach it. Planner-written steps are never changed by it. Cost grows with the size of the library, not the number of users (with four services, expect a few dollars a month at most).

## What's where

| Path | What it does |
| --- | --- |
| `lib/crypto.js` | The encryption core (browser only) |
| `supabase/schema.sql` | Tables, column privileges, row level security, starter guides |
| `app/page.js` | Sign in, sign up, forgotten password, two-step code |
| `app/setup` | Creates the vault and shows the recovery key once |
| `app/vault` | The planner's services: list on the left, details on the right |
| `app/settings` | Executor, reminders, passphrase, recovery key, two-step sign-in, delete |
| `app/executor` | The executor's guided walk-through with progress |
| `app/review` | Guide approval screen (administrator only) |
| `app/api/executor`, `app/api/claim` | Invite / replace / remove an executor; link them on sign-in |
| `app/api/cron/guides` | Monthly guide check (also runnable from `/review`) |
| `app/api/cron/reminders` | Daily: planner check-in emails and executor setup nudges |
| `test/` | Unit tests for the crypto, and an end-to-end browser test |

## Setting it up

### 1. Supabase
1. Create a new project at supabase.com.
2. Open **SQL Editor**, paste in all of `supabase/schema.sql`, and run it.
3. **Authentication > Sign In / Providers**: make sure Email is on and **Confirm email** is on.
4. **Authentication > URL Configuration**: set the Site URL to your Vercel address, and add `https://<your-address>/auth/callback` to the redirect URLs.
5. **Authentication > Multi-Factor**: make sure TOTP (authenticator app) is enabled.
6. From **Project Settings > API**, copy the project URL, the anon key and the service role key.

### 2. Resend
Create an API key at resend.com. Until you verify a sending domain, Resend only delivers to your own address, so verify a domain and set `EMAIL_FROM` before inviting anyone else. For sign-up and password emails, consider pointing Supabase's SMTP settings at Resend too.

### 3. Anthropic
Create an API key at platform.claude.com and add a few dollars of credit. The job uses `claude-opus-5-5` with web search and automatic refusal fallback.

### 4. Vercel
1. Import this repository into Vercel.
2. Add the environment variables from `.env.example` (the seven required ones: the three Supabase values, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `CRON_SECRET` and `ADMIN_EMAIL`, plus `EMAIL_FROM`). Generate `CRON_SECRET` with `openssl rand -hex 32`.
3. Deploy. `vercel.json` schedules the guide check (09:17 UTC on the 1st of each month) and the reminders (daily, 15:41 UTC).
4. Sign up with your `ADMIN_EMAIL`, open `/review`, press **Check every service now**, then approve the first drafts.

## Running locally

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev
```

## Tests

```bash
npm test            # encryption round-trips, wrong keys, key rotation
npm run test:e2e    # full browser run against a local Postgres
```

The end-to-end test needs PostgreSQL 16 on `localhost:5433` (or set `DATABASE_URL`). It loads the real `supabase/schema.sql` into a fresh database, runs a small stand-in for Supabase's auth and REST API (`test/local-supabase/`) so the real row level security policies are exercised, fakes the Anthropic and Resend endpoints, and drives the production build in Chromium through 25 checks: planner setup, adding services, the step editor, the financial warning, scrambled storage, lock and unlock, invitations, the monthly job and review, row level security for planners, executors and strangers, the executor walk-through, progress, phone and tablet layouts, passphrase and recovery key changes, reminders, two-step sign-in, and replacing an executor.

## Before anyone else uses it

Use it for your own household first, and test with throwaway entries before adding anything real. The plan calls for an independent security review before a public launch, plus terms, privacy wording, and a support process for people who are locked out.

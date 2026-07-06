-- ─────────────────────────────────────────────────────────────────────────────
-- 0005_error_log.sql  ·  Ref-viewable client error telemetry
--
-- The client keeps a small on-device error ring buffer (localStorage
-- `aurelia_errlog`, via pushErr in js/00-core-data.js). This table lets those
-- errors ALSO reach the database so the referee can read recent client failures
-- in the Supabase dashboard (Table editor → error_log) and paste rows into
-- Claude, instead of asking each player to read them off their phone.
--
-- Write-only for clients, exactly like the app's other player-writable state
-- (reveal flags / journal in aurelia_state authorise anon INSERTs; the anon
-- publishable key is used for the write). There is deliberately NO select policy,
-- so the anon key CANNOT read the table back — a client can report its own errors
-- but can never enumerate anyone else's. The referee reads it in the dashboard
-- (the service role bypasses RLS), mirroring how campaign secrets are only ever
-- read server-side. This preserves the deny-by-default baseline: RLS is enabled
-- and the only grant added is a narrow INSERT.
--
-- The client truncates `stack` to 2KB before insert; this table itself keeps no
-- length cap (a defensive belt-and-braces truncate also lives in the uploader).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.error_log (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  player       text,          -- viewer identity if known (display name), else null
  app_version  text,          -- build tag the client was running (e.g. 'v33')
  ua           text,          -- navigator.userAgent
  message      text,          -- error message
  stack        text,          -- stack trace, truncated to ~2KB client-side
  context      jsonb not null default '{}'::jsonb  -- {src,line,col,kind,…}
);

create index if not exists error_log_created_at_idx on public.error_log (created_at desc);

-- ── Row-Level Security: deny by default, INSERT-only for clients ──────────────
-- RLS on + a single INSERT policy for anon/authenticated (mirrors how the app's
-- other player-writable rows are written with the publishable key). NO select /
-- update / delete policy is granted, so clients can post errors but never read,
-- alter, or remove them. The referee reads via the dashboard / service role.
alter table public.error_log enable row level security;

drop policy if exists "error_log_anon_insert" on public.error_log;

create policy "error_log_anon_insert" on public.error_log
  for insert to anon, authenticated
  with check (true);

-- (Intentionally no SELECT/UPDATE/DELETE policy — the anon key gets zero read
--  access. Do not add one: it would let any player read every device's errors.)

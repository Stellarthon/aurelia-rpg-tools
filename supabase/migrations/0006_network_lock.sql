-- ─────────────────────────────────────────────────────────────────────────────
-- 0006_network_lock.sql  ·  "Same network only" access lock (TASK 6)
--
-- Server-side state for the referee's optional venue-network lock. When enabled,
-- the get-content Edge Function compares each caller's public IP to the pinned
-- referee IP and 403s mismatches (players on mobile data / VPN). Browsers cannot
-- read Wi-Fi/SSID, so this is public-IP pinning enforced server-side — never a
-- client-side flag.
--
-- Single row (id is pinned to 1). Ships DISABLED, so applying this migration
-- changes nothing until the referee turns it on. Deny-by-default RLS like the
-- rest of the redaction schema (players / campaign_content): RLS is enabled and
-- NO anon/authenticated policy is granted, so the publishable key can neither
-- read nor write it. Only the get-content Edge Function (service role, which
-- bypasses RLS) touches this table, and only after it has verified the caller's
-- bearer token resolves to role='referee' — that is the "ref-write only" rule.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.network_lock (
  id          smallint primary key default 1,
  enabled     boolean not null default false,   -- deployed OFF
  pinned_ip   text,                              -- referee's public IP as seen by the edge function
  pinned_at   timestamptz,                       -- when it was pinned; the lock auto-expires 12h later (break-glass)
  updated_at  timestamptz not null default now(),
  constraint network_lock_singleton check (id = 1)
);

-- Seed the single disabled row so the edge function always has something to read.
insert into public.network_lock (id, enabled) values (1, false)
  on conflict (id) do nothing;

alter table public.network_lock enable row level security;

-- (Intentionally NO policy for anon/authenticated — deny-all. The get-content
--  Edge Function reads/writes with the service role, gated on the referee token.
--  Do not add a client policy: the lock must never be a client-trusted flag.)

-- ─────────────────────────────────────────────────────────────────────────────
-- 0001_per_player_redaction.sql  ·  Stage 0 of the per-player redaction plan
-- See docs/per-player-redaction-plan.md
--
-- Additive and non-breaking: creates two new tables and locks them down with
-- RLS so the anon/publishable key CANNOT read them. Only the `get-content` Edge
-- Function (service role, which bypasses RLS) ever reads campaign secrets.
-- Nothing here touches the existing `aurelia_state` table or the live app.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Players / tokens ─────────────────────────────────────────────────────────
-- One row per person at the table. `token` is the bearer credential the client
-- sends; `audiences` are the identity labels this token may see (the referee
-- token gets role='referee' and sees everything). Generate tokens with
-- gen_random_uuid() or any high-entropy string; hand them out once per player.
create table if not exists public.players (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,
  identity    text not null,                       -- display name, e.g. 'Rhett Calder'
  role        text not null default 'player'
                check (role in ('player','referee')),
  audiences   jsonb not null default '[]'::jsonb,  -- e.g. ["Rhett Calder"]; ignored when role='referee'
  created_at  timestamptz not null default now()
);

-- ── Campaign content fragments ───────────────────────────────────────────────
-- Seeded from supabase/seed/campaign_content.json (see tools/extract-content.mjs).
-- Each row is one audience-tagged fragment at a dotted path. A `referee`
-- fragment is filtered out atomically server-side, so it can never partially
-- leak. audience is "all" | "referee" | ["Name", ...].
create table if not exists public.campaign_content (
  id          uuid primary key default gen_random_uuid(),
  path        text not null,
  audience    jsonb not null default '"all"'::jsonb,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  unique (path, audience)
);

create index if not exists campaign_content_path_idx on public.campaign_content (path);

-- ── Row-Level Security: deny by default, no anon policies ─────────────────────
-- With RLS enabled and NO policy granted to anon/authenticated, the publishable
-- key gets zero rows. The Edge Function uses the service-role key, which bypasses
-- RLS entirely, and does the audience filtering itself.
alter table public.players          enable row level security;
alter table public.campaign_content enable row level security;

-- (Intentionally no CREATE POLICY for anon. Add a referee-token-gated write
--  policy in Stage 4 if you want the referee app to edit content directly;
--  until then, edits go through the service role / SQL.)

-- ── Optional: lock down the existing reveal-flag store ───────────────────────
-- aurelia_state holds reveal-status/clock/etc. These are NOT secret (they only
-- say which area IDs are revealed), so anon SELECT can remain. Tightening WRITES
-- to the referee token is Stage 4 and intentionally NOT done here to avoid
-- breaking the live app before the referee app sends a token.

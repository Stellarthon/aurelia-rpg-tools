-- ─────────────────────────────────────────────────────────────────────────────
-- 0010_private_notes.sql  ·  Finding 4b — private notes store (deny-by-default)
--
-- Backing table for the `private-notes` edge function. Private notes used to live
-- in aurelia_state under `note-private-<identity>-<area>`, which is world-readable
-- with the publishable key. They move here, to a table with NO anon policy — only
-- the edge function (service role, which bypasses RLS) reads/writes it, and it
-- derives the owner identity from the caller's token, so a player can only ever
-- touch their own notes.
--
-- SAFE TO APPLY IMMEDIATELY: additive, deny-by-default, touches nothing existing.
-- Apply it together with deploying the private-notes function; the client keeps
-- using the old aurelia_state path until a token is present (see js/50-supabase.js).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.private_notes (
  identity    text not null,
  note_key    text not null,
  value       text,
  updated_at  timestamptz not null default now(),
  primary key (identity, note_key)
);

alter table public.private_notes enable row level security;

-- (Intentionally NO policy for anon/authenticated — deny-all. The private-notes
--  Edge Function uses the service role. Do not add a client policy: the whole point
--  is that private notes are not readable with the publishable key.)

-- OPTIONAL CLEANUP (run once, after clients have migrated): purge the legacy
-- world-readable copies from aurelia_state so old notes stop leaking. Left
-- commented so applying this migration never destroys data unexpectedly.
--   delete from public.aurelia_state where key like 'note-private-%' or key like 'camp:%:note-private-%';

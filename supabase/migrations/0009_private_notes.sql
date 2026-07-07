-- ─────────────────────────────────────────────────────────────────────────────
-- 0009_private_notes.sql  ·  repo record of the live `private_notes` table
--
-- ⚠ ALREADY APPLIED to production (observed live on 2026-07-07, created by the
-- 2026-07-06 session that deployed the private-notes Edge Function). This file
-- back-fills the repo's numbered-migration record so the schema's source of
-- truth stays in git; it is idempotent and safe to (re-)run.
--
-- One row per (identity, note_key): device-private notes stored server-side so
-- they survive a device wipe, readable/writable ONLY through the private-notes
-- Edge Function (service role). RLS is enabled with NO policies — the anon /
-- publishable key gets zero rows, same deny-by-default posture as `players`
-- and `campaign_content` (migration 0001).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.private_notes (
  identity    text not null,           -- matches players.identity
  note_key    text not null,           -- client note key, e.g. 'note-private-…'
  value       text,
  updated_at  timestamptz not null default now(),
  primary key (identity, note_key)
);

alter table public.private_notes enable row level security;

-- (Intentionally no CREATE POLICY: only the service role — i.e. the
--  private-notes Edge Function, which authenticates our own bearer tokens —
--  can read or write.)

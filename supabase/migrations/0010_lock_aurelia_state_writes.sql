-- ─────────────────────────────────────────────────────────────────────────────
-- 0010_lock_aurelia_state_writes.sql  ·  Stage 4 of the per-player redaction plan
--
-- ⚠ GO-LIVE SWITCH — apply DELIBERATELY, not automatically.
-- Prerequisites (see docs/per-player-redaction-plan.md §8):
--   1. The Stage 4 client (js/50-supabase.js routing writes through put-state)
--      is deployed and every device at the table has reloaded it (sw cache
--      orion-shell-v14+) AND has a token stored (Settings → Secure Content).
--   2. The expanded put-state Edge Function is deployed.
-- Until both hold, tokenless/stale devices will queue writes indefinitely
-- after this runs (recoverable: entering a token + reload flushes the queue,
-- but mid-session that is disruptive).
--
-- What it does: drops the anonymous INSERT/UPDATE policies on aurelia_state,
-- making the token-checking put-state function (service role) the only write
-- path. Public SELECT stays — reveal flags etc. remain readable (the read-side
-- redaction of referee-authored keys is a separate, documented follow-up).
--
-- Rollback (instant): re-create the two policies —
--   create policy "Allow public write"  on public.aurelia_state for insert with check (true);
--   create policy "Allow public update" on public.aurelia_state for update using (true);
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "Allow public write"  on public.aurelia_state;
drop policy if exists "Allow public update" on public.aurelia_state;

-- "Allow public read" is intentionally kept.

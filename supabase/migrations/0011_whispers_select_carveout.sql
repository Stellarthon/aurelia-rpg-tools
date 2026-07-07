-- ─────────────────────────────────────────────────────────────────────────────
-- 0011_whispers_select_carveout.sql  ·  Phase 5 (whisper notes),
-- docs/table-presentation-plan.md §8
--
-- Whisper notes live in the aurelia_state KV under the single key `whispers`
-- (written only through the token-checking put-state append/resolve ops — the
-- Stage 4 write lock, migration 0010, already refuses anonymous writes). But
-- aurelia_state deliberately kept "Allow public read": reveal flags, clocks
-- etc. are not secret. Secret notes are — so this carve-out excludes the
-- whispers row (and any campaign-namespaced variant) from the public SELECT.
-- After this, whisper text reaches a device ONLY through get-content, which
-- verifies the caller's token and returns each identity exactly their own
-- thread (referee: all threads).
--
-- Safe to apply BEFORE the v43 client ships: no live client reads the
-- `whispers` key anonymously (the key is new in v43, and v43 reads it through
-- get-content). Everything else in aurelia_state stays publicly readable,
-- exactly as before.
--
-- Rollback (instant):
--   drop policy if exists "Allow public read" on public.aurelia_state;
--   create policy "Allow public read" on public.aurelia_state
--     for select using (true);
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "Allow public read" on public.aurelia_state;

create policy "Allow public read" on public.aurelia_state
  for select
  using (key <> 'whispers' and key not like 'camp:%:whispers');

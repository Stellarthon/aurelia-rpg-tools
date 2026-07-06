-- ─────────────────────────────────────────────────────────────────────────────
-- 0011_lock_state_writes.sql  ·  Findings 4 & 5 — THE FLIP (writes → token-gated)
--
-- Drops the anon INSERT/UPDATE policies on aurelia_state so the publishable key can
-- no longer tamper with or wipe shared state. After this, the ONLY write path is the
-- put-state edge function (service role, token-verified, referee-only keys enforced).
-- This is what clears the two remaining `rls_policy_always_true` advisories.
--
-- ⚠️  DO NOT APPLY THIS UNTIL THE ROLLOUT PRECONDITIONS ARE MET — applying it early
--    BREAKS the live app for anyone whose device has not yet obtained a token.
--    Ordered rollout (see docs/security-hardening-rollout.md):
--      1. deploy the put-state edge function,
--      2. ship the client build that routes writes through it when a token is present,
--      3. provision a token for EVERY participant device (referee issues them; the
--         join flow stores each device's token),
--      4. THEN apply this migration.
--
-- READS stay anon (Finding 4c): the `Allow public read` SELECT policy is deliberately
-- left in place so the poll loop and offline reads keep working with the anon key.
-- Idempotent: drop-if-exists only.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "Allow public write"  on public.aurelia_state;  -- anon INSERT
drop policy if exists "Allow public update" on public.aurelia_state;  -- anon UPDATE

-- (Keep "Allow public read" — non-secret reveal flags / quest log / journal remain
--  anon-readable by design. Private notes are NOT here anymore; they live in
--  public.private_notes with no anon policy, per migration 0010.)

-- ─────────────────────────────────────────────────────────────────────────────
-- 0012_lock_storage_writes.sql  ·  Finding 2c — THE FLIP (uploads → token-gated)
--
-- Drops the anon INSERT/UPDATE policies on the four asset buckets so the publishable
-- key can no longer upload or overwrite objects. After this, the ONLY write path is
-- the upload-object edge function (service role; token-verified; per-identity path,
-- mime and size constraints).
--
-- ⚠️  DO NOT APPLY THIS UNTIL THE ROLLOUT PRECONDITIONS ARE MET — applying it early
--    breaks portrait/handout/rulebook/session-doc uploads for any device without a
--    token. Ordered rollout (see docs/security-hardening-rollout.md):
--      1. deploy the upload-object edge function,
--      2. ship the client build that routes uploadPortraitBlob / uploadHandoutBlob /
--         uploadRulebookBlob / uploadPlannerDocBlob through it when a token is present,
--      3. provision tokens for every uploader (players who set a portrait; referee),
--      4. THEN apply this migration.
--
-- VIEWING is unaffected — these buckets stay public=true here, so /object/public/…
-- keeps serving. (Real privatization of the sensitive buckets — Finding 2b: set
-- them public=false + serve via signed URLs — is the documented residual in
-- docs/security-hardening-rollout.md, scoped out of this pass.) Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "portraits_anon_insert"    on storage.objects;
drop policy if exists "portraits_anon_update"    on storage.objects;
drop policy if exists "handouts_anon_insert"     on storage.objects;
drop policy if exists "handouts_anon_update"     on storage.objects;
drop policy if exists "rulebooks_anon_insert"    on storage.objects;
drop policy if exists "rulebooks_anon_update"    on storage.objects;
drop policy if exists "session_docs_anon_insert" on storage.objects;
drop policy if exists "session_docs_anon_update" on storage.objects;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0009_storage_stop_enumeration.sql  ·  Finding 2a — kill bucket listing
--
-- The portraits / handouts / rulebooks / session-docs buckets each granted anon
-- SELECT on storage.objects scoped by bucket_id (migrations 0002-0004, 0007).
-- That SELECT is what powers `POST /storage/v1/object/list/<bucket>` enumeration:
-- an anon caller could list every object key in each bucket. For a PUBLIC bucket,
-- the SELECT policy is NOT needed to VIEW a file — `/object/public/<bucket>/<key>`
-- serves without any RLS check — so dropping it closes enumeration while leaving
-- viewing (portraits, handouts, rulebooks, session docs) fully working.
--
-- The 'globes' texture bucket is handled the same way: the client now ships a
-- static texture manifest (js/50-supabase.js · TEXTURE_MANIFEST) instead of
-- listing the bucket at runtime, so its list policy can go too — clearing the
-- `public_bucket_allows_listing` advisory for every bucket.
--
-- This migration is NON-BREAKING and safe to apply immediately (it does not touch
-- INSERT/UPDATE — that is Finding 2c, sequenced separately once the upload edge
-- function is live). Idempotent: drop-if-exists only.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "portraits_anon_read"    on storage.objects;
drop policy if exists "handouts_anon_read"      on storage.objects;
drop policy if exists "rulebooks_anon_read"     on storage.objects;
drop policy if exists "session_docs_anon_read"  on storage.objects;

-- globes: viewing stays public via /object/public/globes/<file>; the runtime list
-- is replaced by the committed manifest, so the list policy is no longer needed.
drop policy if exists "anon_list_globes"         on storage.objects;

-- NOTE: viewing is unaffected — these four buckets remain public=true for now, so
-- /object/public/<bucket>/<key> still returns the file. Real privatization of the
-- sensitive buckets (portraits/handouts/session-docs → public=false + signed URLs)
-- is Finding 2b and is sequenced with the upload/token edge function so the app is
-- never left unable to load an image mid-rollout.

-- Restore the anon SELECT (list/read) policy for the public 'globes' texture
-- bucket — another instance of the live-drift the audit flagged ("migrations
-- defining RLS ≠ RLS applied"). Migration 0002 references this bucket's
-- "allow_anon_list policy" as an existing model, but the policy was MISSING from
-- the live project, and migration 0008 — which restored the read policies for
-- portraits/rulebooks/handouts/session-docs — overlooked globes.
--
-- Storage marks the bucket public, so individual /object/public/globes/<file>
-- GETs work without a policy; but LISTING the bucket still needs an anon SELECT
-- policy. Without it loadTextureCatalog() (js/50-supabase.js) gets an empty list,
-- so defaultTextureFile() finds no match and every AUTO-matched planet-surface
-- texture (terran worlds like Aurelia, plus desert/ice/gaseous/volcanic) silently
-- falls back to the procedural disc — the "planet surface texture doesn't load"
-- report. The app only ever reads this bucket, so read/list is all it needs.
--
-- Applied to live 2026-07-13 via MCP ('restore_globes_read_policy'); this file
-- mirrors it into the repo's migration history. Idempotent.

drop policy if exists "globes_anon_read" on storage.objects;
create policy "globes_anon_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'globes');

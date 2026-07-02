-- BYO rulebook (feature-gap analysis §5.6, Layer 3).
--
-- A Storage bucket for the referee's OWN, legally-owned rulebook PDF so their
-- group can pull up a page on any device. The PDF is USER-SUPPLIED content — it
-- is never shipped in the repo/bundle, so the codebase stays copyright-clean and
-- open-source ready. One object per campaign: rulebooks/<campaignId>.pdf,
-- overwritten on re-upload; a version stamp in the shared 'rulebook-config' key
-- cache-busts the public URL across devices.
--
-- Follows the same honour-system / anon-key model as the 'portraits' and
-- 'globes' buckets (migration 0002): anon read/insert/update SCOPED to this
-- bucket, gated client-side (referee-only upload). NOTE ON PRIVACY: like
-- portraits, this bucket is public-read (private-by-obscurity — the URL is a
-- per-campaign slug, not listable without the key). That matches the app's
-- existing model. If you need TRUE per-player privacy for the book, route it
-- through the token-gated get-content path (docs/per-player-redaction-plan.md)
-- instead of a public bucket. 80 MB limit; PDF only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rulebooks', 'rulebooks', true, 83886080, array['application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "rulebooks_anon_read"   on storage.objects;
drop policy if exists "rulebooks_anon_insert" on storage.objects;
drop policy if exists "rulebooks_anon_update" on storage.objects;

create policy "rulebooks_anon_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'rulebooks');

create policy "rulebooks_anon_insert" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'rulebooks');

create policy "rulebooks_anon_update" on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'rulebooks')
  with check (bucket_id = 'rulebooks');

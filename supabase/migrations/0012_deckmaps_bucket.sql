-- Deck-plan floorplan underlays (deck editor, js/41-deck-editor.js).
--
-- A dedicated Storage bucket for the images a referee uploads as a floorplan to
-- trace deck plans over. Previously these piggy-backed on the 'handouts' bucket
-- (migration 0004); this gives them their own home so the two features don't
-- share a namespace. Same honour-system / anon-key model as the 'portraits',
-- 'rulebooks' and 'handouts' buckets: anon read/insert/update SCOPED to this
-- bucket, gated client-side (referee-only upload). Objects are keyed per
-- campaign: deck-maps/<campaignSlug>/<id>.jpg. The client downscales to
-- <=1600px JPEG before upload, so real floorplans land well under the limit.
-- 6 MB cap; images only. Public-read (the image is not a referee secret — it's
-- the map the party is looking at).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('deck-maps', 'deck-maps', true, 6291456, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "deckmaps_anon_read"   on storage.objects;
drop policy if exists "deckmaps_anon_insert" on storage.objects;
drop policy if exists "deckmaps_anon_update" on storage.objects;

create policy "deckmaps_anon_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'deck-maps');

create policy "deckmaps_anon_insert" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'deck-maps');

create policy "deckmaps_anon_update" on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'deck-maps')
  with check (bucket_id = 'deck-maps');

-- Location / scene imagery (design mode — js/30 body locations, js/40 station
-- areas).
--
-- A dedicated Storage bucket for the establishing "scene" images a referee
-- attaches to a place: a landscape banner shown at the top of a location's
-- detail (players see it where the location is revealed). Same honour-system /
-- anon-key model as the 'portraits', 'handouts' and 'deck-maps' buckets: anon
-- read/insert/update SCOPED to this bucket, gated client-side (referee-only
-- upload). Objects are keyed per campaign: scenes/<campaignSlug>/<key>.jpg. The
-- client downscales to <=1400px JPEG before upload. 6 MB cap; images only.
-- Public-read (the image is not a referee secret — it's what the party sees).
--
-- The version stamps live in the shared 'scene-images' KV key (referee-write via
-- put-state, public-read), so the client can cache-bust the public URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scenes', 'scenes', true, 6291456, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "scenes_anon_read"   on storage.objects;
drop policy if exists "scenes_anon_insert" on storage.objects;
drop policy if exists "scenes_anon_update" on storage.objects;

create policy "scenes_anon_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'scenes');

create policy "scenes_anon_insert" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'scenes');

create policy "scenes_anon_update" on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'scenes')
  with check (bucket_id = 'scenes');

-- Character portraits (Phase 6, §4.7).
--
-- A public Storage bucket for the five player characters' portraits, following
-- the same honour-system / anon-key model the rest of the app already uses (cf.
-- the 'globes' texture bucket + its allow_anon_list policy). Read/insert/update
-- are granted to the anon (publishable) key but SCOPED to this bucket only, so
-- players can upload their own portrait and the referee any — gating is
-- client-side, exactly like sheet/inventory/funds writes. 2 MB limit; images
-- only. The client center-crops + resizes to 512² JPEG before upload, so real
-- uploads land far under the limit.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portraits', 'portraits', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "portraits_anon_read"   on storage.objects;
drop policy if exists "portraits_anon_insert" on storage.objects;
drop policy if exists "portraits_anon_update" on storage.objects;

create policy "portraits_anon_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'portraits');

create policy "portraits_anon_insert" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'portraits');

create policy "portraits_anon_update" on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'portraits')
  with check (bucket_id = 'portraits');

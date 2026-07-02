-- Handouts / evidence push (feature-gap analysis §5.8).
--
-- A Storage bucket for referee-pushed handouts — a map, a clue, a photo, a
-- document scan — that players view on their own devices. Same honour-system /
-- anon-key model as the 'portraits' and 'rulebooks' buckets (migrations 0002 /
-- 0003): anon read/insert/update SCOPED to this bucket, gated client-side
-- (referee-only push). Per-handout audience is enforced client-side via
-- canSee(visibleTo) on the shared 'handouts' metadata key, exactly like the
-- rest of the app's spoiler gating. Objects are keyed per campaign:
-- handouts/<campaignSlug>/<id>.jpg. Client downscales to <=1600px JPEG before
-- upload, so real handouts land well under the limit. 6 MB cap; images only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('handouts', 'handouts', true, 6291456, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "handouts_anon_read"   on storage.objects;
drop policy if exists "handouts_anon_insert" on storage.objects;
drop policy if exists "handouts_anon_update" on storage.objects;

create policy "handouts_anon_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'handouts');

create policy "handouts_anon_insert" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'handouts');

create policy "handouts_anon_update" on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'handouts')
  with check (bucket_id = 'handouts');

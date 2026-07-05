-- Session-planner reference documents (referee prep PDFs).
--
-- A Storage bucket for PDFs the referee attaches to a session plan (js/97
-- session-planner) — adventure modules, printed maps, notes, anything they want
-- on hand while prepping or running a session. USER-SUPPLIED content, never
-- shipped in the repo/bundle, so the codebase stays copyright-clean. One object
-- per uploaded doc: session-docs/<campaignSlug>/<id>.pdf, overwritten on
-- re-upload; a per-doc version stamp on the referee's 'session-plans' key
-- cache-busts the public URL across the referee's own devices.
--
-- Follows the same honour-system / anon-key model as the 'rulebooks' and
-- 'handouts' buckets (migrations 0003/0004): anon read/insert/update SCOPED to
-- this bucket, gated client-side (referee-only upload). Session plans themselves
-- are referee-only (never fetched by players), so these docs are effectively
-- referee-only too — but NOTE the bucket is public-read (private-by-obscurity:
-- the path is a random per-doc id, not listable without the key), matching the
-- app's existing model. 80 MB limit; PDF only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('session-docs', 'session-docs', true, 83886080, array['application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "session_docs_anon_read"   on storage.objects;
drop policy if exists "session_docs_anon_insert" on storage.objects;
drop policy if exists "session_docs_anon_update" on storage.objects;

create policy "session_docs_anon_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'session-docs');

create policy "session_docs_anon_insert" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'session-docs');

create policy "session_docs_anon_update" on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'session-docs')
  with check (bucket_id = 'session-docs');

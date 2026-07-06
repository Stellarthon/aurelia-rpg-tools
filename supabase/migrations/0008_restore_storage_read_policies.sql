-- Restore the anon SELECT policies defined in migrations 0002/0003/0004/0007
-- but found MISSING from the live project (live drift — the "migrations
-- defining RLS ≠ RLS applied" gap the audit flagged). Supabase Storage's
-- x-upsert path now requires the caller to be able to SELECT existing rows,
-- so their absence broke every client upload (portraits, rulebooks, handouts,
-- session docs) with "new row violates row-level security policy"; plain
-- inserts still worked, which is why the breakage went unnoticed until the
-- Rulebook Library shipped. Applied to live 2026-07-06 via MCP
-- ('restore_storage_read_policies'); this file mirrors it into the repo's
-- migration history. Idempotent.

drop policy if exists "portraits_anon_read" on storage.objects;
create policy "portraits_anon_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'portraits');

drop policy if exists "rulebooks_anon_read" on storage.objects;
create policy "rulebooks_anon_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'rulebooks');

drop policy if exists "handouts_anon_read" on storage.objects;
create policy "handouts_anon_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'handouts');

drop policy if exists "session_docs_anon_read" on storage.objects;
create policy "session_docs_anon_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'session-docs');

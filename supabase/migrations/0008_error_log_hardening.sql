-- ─────────────────────────────────────────────────────────────────────────────
-- 0008_error_log_hardening.sql  ·  Finding 7 — bound error_log abuse
--
-- error_log accepts unauthenticated anon INSERTs (migration 0005). That is fine
-- for write-only telemetry, but the columns are client-supplied and unbounded,
-- so a hostile client could flood the table with huge rows to grow storage/cost.
-- This migration keeps the exact same feature (client telemetry uploader:
-- batched, 10s throttle, 50/session cap, no SELECT policy) and just hardens the
-- server:
--   1. length caps via CHECK constraints (belt to the client's own truncation);
--   2. a size/retention bound so flooding can't grow the table without limit.
-- Idempotent: constraints/trigger are dropped-if-exists then recreated.
--
-- NOTE: `player` is client-supplied and therefore untrusted. It is display-only
-- in the referee's dashboard (which escapes) and must never be rendered
-- unescaped in-app.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Length caps. Added NOT VALID so the migration never fails on any legacy row;
--    every NEW insert/update is still fully checked (which is what bounds abuse).
--    Caps: message ≤ 4KB, stack ≤ 2KB, player/app_version/ua ≤ 512.
alter table public.error_log drop constraint if exists error_log_message_len;
alter table public.error_log drop constraint if exists error_log_stack_len;
alter table public.error_log drop constraint if exists error_log_player_len;
alter table public.error_log drop constraint if exists error_log_appver_len;
alter table public.error_log drop constraint if exists error_log_ua_len;

alter table public.error_log add constraint error_log_message_len check (message     is null or char_length(message)     <= 4096) not valid;
alter table public.error_log add constraint error_log_stack_len   check (stack       is null or char_length(stack)       <= 2048) not valid;
alter table public.error_log add constraint error_log_player_len  check (player      is null or char_length(player)      <= 512)  not valid;
alter table public.error_log add constraint error_log_appver_len  check (app_version is null or char_length(app_version) <= 512)  not valid;
alter table public.error_log add constraint error_log_ua_len      check (ua          is null or char_length(ua)          <= 512)  not valid;

-- 2. Retention / row cap. A per-STATEMENT AFTER INSERT trigger prunes (a) rows
--    older than 30 days and (b) everything beyond the newest 10,000 rows. Runs
--    once per INSERT statement (the uploader posts a whole batch in one), not per
--    row, and both deletes use the existing created_at index, so overhead is
--    negligible at telemetry volume. No pg_cron / extension dependency — the
--    bound is self-contained in the table itself.
create or replace function public.error_log_prune() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  delete from public.error_log where created_at < now() - interval '30 days';
  delete from public.error_log
   where id in (
     select id from public.error_log order by created_at desc offset 10000
   );
  return null;
end;
$$;

drop trigger if exists error_log_prune_trg on public.error_log;
create trigger error_log_prune_trg
  after insert on public.error_log
  for each statement
  execute function public.error_log_prune();

-- The prune function is only ever meant to run as a trigger. As a SECURITY DEFINER
-- function it is otherwise callable by anon/authenticated via /rest/v1/rpc — revoke
-- EXECUTE so it can't be invoked directly. (Trigger execution does not require the
-- inserting role to hold EXECUTE, so pruning still works.)
revoke execute on function public.error_log_prune() from public;
revoke execute on function public.error_log_prune() from anon;
revoke execute on function public.error_log_prune() from authenticated;

-- 3. Make the anon INSERT policy non-trivial: enforce the same caps in WITH CHECK
--    instead of `true`. Keeps anon telemetry writes working (Finding 7 says direct
--    anon insert is acceptable if hardened) while clearing the rls_policy_always_true
--    advisory for this table. The CHECK constraints above are belt-and-braces.
drop policy if exists "error_log_anon_insert" on public.error_log;
create policy "error_log_anon_insert" on public.error_log
  for insert to anon, authenticated
  with check (
    (message     is null or char_length(message)     <= 4096) and
    (stack       is null or char_length(stack)       <= 2048) and
    (player      is null or char_length(player)      <= 512)  and
    (app_version is null or char_length(app_version) <= 512)  and
    (ua          is null or char_length(ua)          <= 512)
  );

-- (Write-only property preserved: still no SELECT/UPDATE/DELETE policy for anon.
--  The prune trigger runs as SECURITY DEFINER so it can delete without a client
--  DELETE policy — clients still cannot read, alter, or remove rows themselves.)

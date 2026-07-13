-- ─────────────────────────────────────────────────────────────────────────────
-- 0013_error_log_retention.sql  ·  Bound error_log growth (audit finding B1)
--
-- error_log (migration 0005) takes anon INSERTs with `with check (true)` and is
-- written on every client error. It had NO retention — it grows unbounded, and
-- because the INSERT policy is open to anon it is also a spam vector. This adds a
-- 30-day retention prune.
--
-- HOW IT WORKS
--   * prune_error_log() is SECURITY DEFINER (runs as its owner), so it can DELETE
--     despite error_log having no DELETE policy — the deny-by-default baseline
--     from 0005 is preserved for clients; only this owned function can prune.
--   * EXECUTE is revoked from anon/authenticated so no client can invoke it.
--   * A daily pg_cron job calls it. If pg_cron cannot be enabled here (permissions
--     / plan), the DO block degrades to a NOTICE — the function is still created,
--     and you can either enable pg_cron in the dashboard and re-run this file, or
--     call `select public.prune_error_log();` from your own scheduler.
--
-- NOT YET APPLIED. This is a proposed migration from the 2026-07-13 codebase
-- audit. Review, then run it in the Supabase SQL editor (or via `supabase db
-- push`) like the other migrations. Adjust the 30-day window to taste.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.prune_error_log()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.error_log where created_at < now() - interval '30 days';
$$;

-- Clients must never call this directly.
revoke all on function public.prune_error_log() from public;
revoke all on function public.prune_error_log() from anon, authenticated;

-- Schedule a daily prune via pg_cron when available; otherwise leave a NOTICE.
do $do$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'error_log_retention: could not enable pg_cron (%). Enable it in the dashboard and re-run this migration, or schedule "select public.prune_error_log();" from your own runner.', sqlerrm;
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'prune_error_log') then
      perform cron.unschedule('prune_error_log');
    end if;
    perform cron.schedule('prune_error_log', '17 4 * * *', $cron$select public.prune_error_log();$cron$);
    raise notice 'error_log_retention: scheduled daily prune (job "prune_error_log", 04:17 UTC, 30-day window).';
  end if;
end
$do$;

-- Rollback:
--   select cron.unschedule('prune_error_log');   -- if pg_cron scheduled it
--   drop function if exists public.prune_error_log();

-- ─────────────────────────────────────────────────────────────────────────────
-- 0014_overlay_ref_carveout.sql  ·  Design-Mode redaction
-- See docs/design-mode-redaction.md
--
-- The referee's Design-Mode edits live in overlay blobs in aurelia_state
-- (body-*, location-*, system-*, station-additions, content-*). Those blobs
-- carry referee-only fields (refNote, hook, npcs, checks, events, Referee
-- Context) that the shipped-content de-bake + get-content redaction otherwise
-- keep off player devices. As of the redaction change each such store is written
-- in TWO copies: a REDACTED copy under the public key (players read that) and the
-- FULL copy under "<key>-ref". This carve-out excludes every "-ref" row (and its
-- campaign-namespaced variant) from the public SELECT policy, so the full,
-- unredacted blobs reach a device ONLY through get-content, which verifies the
-- caller is a referee. It also keeps the existing whispers carve-out (0011).
--
-- ORDER OF DEPLOY (see the doc): deploy the get-content + put-state functions and
-- ship the client FIRST, then apply this migration. Before it is applied the
-- "-ref" rows are still publicly readable (a residual, non-default leak); after
-- it, referees read them via get-content and players cannot read them at all.
-- Reserved suffix: application code must not use a bare "-ref" key for any
-- player-readable value.
--
-- Rollback (instant — re-opens the "-ref" rows to public read):
--   drop policy if exists "Allow public read" on public.aurelia_state;
--   create policy "Allow public read" on public.aurelia_state
--     for select using (key <> 'whispers' and key not like 'camp:%:whispers');
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "Allow public read" on public.aurelia_state;

create policy "Allow public read" on public.aurelia_state
  for select
  using (
    key <> 'whispers'
    and key not like 'camp:%:whispers'
    and key not like '%-ref'
  );

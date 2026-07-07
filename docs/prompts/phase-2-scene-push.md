# Implementation prompt — Phase 2: Scene push (handout scenes + pings)

> Paste everything below this line into a fresh session on a new feature
> branch. **Prerequisite: Phase 1 (Table Display Mode) is merged** — this
> phase extends the `aurelia-table-display` BroadcastChannel protocol and the
> `js/93-display.js` module that Phase 1 created. If Phase 1 is not on the
> default branch yet, stop and say so instead of re-implementing it.

---

Implement **Phase 2 (Scene push)** of `docs/table-presentation-plan.md` §4.
Read plan §2 (Architecture, especially the §2.3 message protocol) and §4 in
full first. Re-verify every `js/NN:line` anchor before editing — they were
checked 2026-07-07 and Phase 1 has since touched some of these files.

## Objective

The deliberate **non-VTT battle-map answer**: the referee pushes any handout
image full-screen to the table TV and can "ping" a point on it to direct
attention. No grid, no tokens, no movement rules, no line-of-sight —
positioning stays theater-of-the-mind. Do not add any of those even as
options; they are anti-feature #1 in `docs/feature-gap-analysis.md` §7.

## Hard requirements

1. **Protocol additions** (same channel, same `v:1` envelope): `handout`
   `{url, name}`, `handout-close`, `ping` `{nx, ny}` — exactly as specified
   in plan §2.3. Handout payloads carry the **resolved URL** from
   `handoutUrlFor(campaignId, id, ver)` (`js/50-supabase.js:143`), never an
   id — the display window must need no `handouts` state and no KV read.
2. **"→ Table" button** on each handout row in `renderHandoutsPanel()`
   (`js/85-records.js:1782`), and a second one inside the referee's own
   lightbox (`openHandout`, `js/85:1773`). Referee-only (they already are —
   confirm the panel is gated).
3. **Display scene element:** a dedicated full-screen `<figure>` in display
   mode — letterboxed on a black background, name caption togglable. Reuse
   the lightbox *styling*, not the `#handout-lightbox` element itself.
4. **Ping:** referee clicks anywhere in their lightbox or on a pushed scene
   → compute normalized (0–1) coordinates relative to the *image*, not the
   viewport → broadcast `ping` → the display renders a ~2 s pulse animation
   at the same relative position. Pings are transient: no persistence, no
   list, no colors-per-player.
5. **Visibility guard:** the TV is physically public. Pushing a handout whose
   `visibleTo` is not `'all'` (item shape `{id, name, ver, visibleTo, date}`,
   `js/85:1692`) must first confirm: "This handout is private to X — show on
   the shared table display anyway?". No confirm for `'all'` handouts.
6. **Close/Blank wiring:** `handout-close` is sent by the referee close
   affordance and also by the Phase 1 **Blank** control (blank implies
   closing the scene).
7. **Aspect-ratio correctness:** the normalized ping coordinates must land on
   the same image point on both screens regardless of window aspect ratio
   (account for letterboxing offsets on both ends).

## Shell invariants

This phase should need **no new files** (extend `js/93-display.js` and
`js/85-records.js`; CSS in `css/app.css`). If you do add a file, follow the
full checklist in plan §7 (index.html script order, `sw.js` SHELL + `CACHE`
bump). Either way, **bump `CACHE` in `sw.js:8`** for the release so installed
PWAs pick up the changed modules, and run:
- `node tools/build-local.mjs` — no count warning
- `node tools/strip-secrets.mjs --check` — exit 0

## Acceptance criteria (plan §4 — verify each manually)

- Push → image visible on the TV in under ~100 ms; close and Blank both
  clear it.
- Ping lands at the same relative point on both screens with the two windows
  at deliberately different aspect ratios.
- A `visibleTo`-restricted handout never reaches the TV without the confirm;
  an `'all'` handout pushes with no friction.
- Ground-combat rehearsal: upload a location image via the existing
  `onHandoutFile` flow (`js/85:1745`), push it, ping three positions —
  confirm no combat UI, grid, or token appears anywhere.
- Phase 1 regressions: Follow/Hold, camera mirror, and player-safety checks
  from `docs/prompts/phase-1-table-display-mode.md` still pass.

Manual verification: serve over HTTP, two windows, walk every item above and
report what you observed. When done, update the status tables in
`docs/feature-gap-analysis.md` §2 and `docs/table-presentation-plan.md`.

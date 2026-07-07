# Implementation prompt — Phase 1: Table Display Mode

> Paste everything below this line into a fresh session on a new feature
> branch. Prerequisites: none (this is the first phase).

---

Implement **Phase 1 (Table Display Mode)** of `docs/table-presentation-plan.md`.
Read that document's §2 (Architecture) and §3 (Phase 1) in full before writing
any code, and read `docs/ARCHITECTURE.md` for the module/load-order rules. The
plan's `js/NN:line` anchors were verified 2026-07-07 — re-verify each one
before editing; if an anchor has drifted, find the function by name and note
it in your PR description.

## Objective

The referee's laptop is connected to the table TV over HDMI. Clicking "Open
table display" opens a second window (`index.html?display=1`) that the referee
drags to the TV. The TV window is a chromeless, view-only, **player-safe**
render of the current map view, driven live from the referee window over
`BroadcastChannel('aurelia-table-display')`. No network involvement — this
must work fully offline.

## Hard requirements

1. **`DISPLAY_MODE` flag** — `const DISPLAY_MODE = new URLSearchParams(location.search).has('display');`
   declared in `js/00-core-data.js` (first module, so every later module can
   branch on it). This is the app's first boot query param; keep it the only
   one.
2. **Player-safe at the gate, not per feature** — `isReferee()`
   (`js/55-auth-gating.js:204`) must return `false` when `DISPLAY_MODE` is
   set. Do not add per-panel display checks; the whole point is that the
   existing `isReferee()`/`canSee()` choke point excludes every referee-only
   element from the TV.
3. **Zero shared-state writes from the display window.** It shares
   `localStorage` with the referee window (same origin). In `DISPLAY_MODE`:
   never write `aurelia_pm`, never write `aurelia_identity`, skip the
   identity prompt (`checkIdentity()`, `js/55:1190`), and guard
   `supaStorage.set` (`js/50-supabase.js`) to a no-op. Opening the TV must
   not be able to flip the referee's own session into player mode.
4. **No polling in display mode** — do not start `startPolling()`
   (`js/55:956`) or the alert/combat pollers (`js/30-system-body.js:38`).
   The BroadcastChannel is the display's only input. (The access gate passes
   automatically via the shared `aurelia_access` key — verify, don't re-gate.)
5. **Message protocol v1** exactly as specified in plan §2.3 (`hello`,
   `scene`, `view`, `camera`, `blank`; every message carries `v:1`).
6. **Follow/Hold** (plan §2.4): referee-side toggle, default **Hold**.
   Follow broadcasts view switches and galaxy camera live; Hold freezes the
   TV; an explicit "Send to table" works in either mode.
7. **New module `js/93-display.js`** containing both halves (referee half +
   display half, branched on `DISPLAY_MODE`). Follow-mode hooks **wrap** the
   global view functions at load time (`goGalaxy` `js/10:2699`, `enterSystem`
   `js/10:2721`, `goSystemOverview` `js/30:703`, `goSystem` `js/30:1689`,
   `enterStation` `js/30:1675`, `goBack` `js/30:1722`, body path via
   `selectBody` `js/30:1061`) — do not edit those functions in place. Add a
   boot-time assert that console-errors if any expected global is missing.
8. **The only edits inside `js/10-galaxy.js`:** the HX camera closure
   (`let view={x:0,y:0,scale:1}` at `:1713`) needs (a) one line in
   `applyTransform()` (`:1755`): `if (window.onHXCameraChanged) onHXCameraChanged(view);`
   and (b) exported `HX.getCamera()` / `HX.setCamera({x,y,scale})` (setter
   assigns then calls `applyTransform()`). Camera broadcasts are
   rAF-throttled in the referee half.
9. **Display chrome:** `display-mode` class on `<body>`; CSS in `css/app.css`
   hides all chrome (top bar, panels, toggles). Click-anywhere-to-fullscreen
   overlay until fullscreen is entered (fullscreen needs a user gesture).
   Show a subtle "waiting for referee…" state if no `scene` arrives within
   2 s of sending `hello`.
10. **Referee control cluster** in the tools/settings area (`js/60`):
    "Open display" (`window.open(location.pathname + '?display=1', 'aurelia-display')`
    — always from a direct click, never programmatic), Follow/Hold toggle,
    Blank toggle, connection dot lit on `hello`. Register a keyboard
    shortcut alongside the existing ones in `js/98-trackers-boot.js`.
11. **Resync:** the referee answers every `hello` with a full `scene`
    snapshot (`currentView` global `js/30:4` + `HX.getCamera()`), so
    reloading either window self-heals.
12. **Graceful degradation:** hide the control cluster when
    `location.protocol === 'file:'` or `BroadcastChannel` is undefined
    (`index.local.html` cannot host the display link).

## PWA / shell invariants (same commit as the new file — non-negotiable)

- Add `<script src="js/93-display.js">` in `index.html` (script block at
  `:1093-1114`) **after `92`, before `96`** — it must load after `10`/`30`
  (it wraps their globals) and before `98` (boot).
- Add the file to `SHELL` in `sw.js` (`:9-21`) **and bump `CACHE`**
  (`sw.js:8`, `orion-shell-v12` → `orion-shell-v13`).
- Run `node tools/build-local.mjs` — no count warning.
- Run `node tools/strip-secrets.mjs --check` — exit 0.

## Acceptance criteria (verify each before finishing; plan §3)

- TV window shows no referee-only element in any of the four views
  (spot-check design mode, codex reveal stamps, region overlays, records).
- `aurelia_pm` and `aurelia_identity` in `localStorage` are byte-identical
  before and after a display session.
- Follow: laptop pan/zoom mirrors on the TV within a frame. Hold: TV does
  not move while the referee browses. Blank: black screen both directions.
- Reloading either window converges to the referee's current view.
- Works offline (serve locally, disconnect network, verify all of the above).

Manual verification: serve the folder over HTTP, open two windows side by
side (one with `?display=1`), and walk every acceptance item. Describe what
you observed in the PR/commit description — do not claim untested behavior.
When done, update the Phase 1 row in `docs/feature-gap-analysis.md` §2 and
the status header of `docs/table-presentation-plan.md`.

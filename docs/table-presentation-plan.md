# Table Presentation Suite — implementation plan

**Scope:** Table Display Mode (TV second screen), Scene Push (maps + handout
scenes + pings), Scene Ambience Beats, and their sequencing against the
per-player-secrecy migration. Optional follow-on: Whisper Notes.

**Status:** Phases 1–3 (ambience at MVP scope) are **implemented** — shipped
as `js/93-display.js` + the small gate/hook edits listed per phase, shell
`orion-shell-v13` / build v41. Phase 3 Full items (planner links, per-beat
display cut) and Phase 5 remain open; Phase 4 stays plan-first per its own
doc. The display figure ships without the name caption (a handout's name can
itself be a spoiler) — the `name` still rides the message for a future toggle.
**Relationship to other docs:** extends `docs/feature-gap-analysis.md` (this
plan details and supersedes its open Tier-3 items 15 "Scene ambience presets"
and slots around 16 "Complete per-player secrecy"); Phase 4 below *is*
`docs/per-player-redaction-plan.md`, referenced not duplicated.
**Verified against:** the current `js/` split, `sw.js` (`orion-shell-v12` at
planning time; bumped to `v13` when Phase 1 shipped). All `js/NN:line`
anchors checked 2026-07-07 (pre-implementation positions).

---

## 1. Summary and goals

The physical setup this plan serves: the referee's laptop is connected to the
table TV over HDMI. The TV becomes a **shared, player-safe display** showing
the current map or scene; the laptop keeps the full referee UI (session
planner, records, secrets) — the "presenter view". This is the strongest
possible expression of the project's first principle (*the app accompanies
the game; it must never become the game*, `docs/ARCHITECTURE.md`): the TV
pulls eyes **up** to the table, not down into devices.

**Goals**
1. A chromeless, view-only **display mode** of the app, driven live from the
   referee window with zero network dependency (Phase 1).
2. **Scene push**: any map view or handout image can be sent to the TV with
   one click; a lightweight referee "ping" marker for pointing at things
   (Phase 2). This is the deliberate, non-VTT answer to "battle maps for
   ground combat".
3. **Ambience beats**: named scene presets that play referee-supplied audio
   on the laptop (which feeds the TV speakers) and optionally cut the display
   to a matching scene (Phase 3).
4. Keep the **per-player secrecy migration** (Phase 4) on the roadmap ahead
   of any new secrecy-adjacent feature and ahead of open-sourcing.

**Non-goals — decided and closed** (rationale mirrors the §7 anti-feature
list in `docs/feature-gap-analysis.md`):
- **Spotify SDK integration** — the Web Playback SDK needs OAuth (PKCE), a
  Premium account, and a heavyweight embedded player; for an in-person table
  a deep link that opens the Spotify app (existing `window.open` pattern,
  `js/92:355`) delivers the same outcome for ~1% of the work.
- **Grid + token tactical battle maps** — anti-feature #1 (pulls eyes down;
  position is theater-of-the-mind). Phase 2's image-on-TV + ping is the
  ceiling.
- **General player↔referee chat** — the group shares a room; talking is
  faster. The narrow secret-note case is Phase 5, optional.
- **Web Push notifications** — needs a push server + subscription management;
  the toast system (`js/92:740`), connection pill, and "since last session"
  digest already cover the real needs of a fixed in-person group.
- **Audio mixing console** — anti-feature; one track at a time.

---

## 2. Architecture

### 2.1 The display is a second window, not a second device

The TV is an HDMI monitor on the referee's laptop, so the display link needs
no server round-trip. The design:

- The referee window opens `index.html?display=1` via `window.open()` and the
  referee drags it to the TV (or uses the fullscreen button in the display).
- The two windows talk over a **`BroadcastChannel('aurelia-table-display')`**
  — same-origin, same-machine, zero latency, works offline. There was
  no BroadcastChannel/postMessage usage anywhere in `js/` before this, so the
  channel name and protocol are ours to define cleanly.
- **Rejected alternative:** syncing the TV through the Supabase KV poll like
  a player device. It works, but adds 4–30 s latency (`POLL_MS`/backoff,
  `js/55:501-503`), requires network at the table, and makes the TV another
  polling client. If a networked display is ever wanted (TV with its own
  stick/Chromecast), the message protocol below can later be bridged through
  a KV key without redesign — explicitly out of scope now.

### 2.2 `DISPLAY_MODE` flag and safety model

A single boot-time constant, declared in `js/00-core-data.js` (first module,
so every later module can branch on it):

```js
const DISPLAY_MODE = new URLSearchParams(location.search).has('display');
```

Note: before this the app parsed no boot query params — the only
`location.search` touch was the token-strip `history.replaceState`
(`js/55:278`) — so `?display=1` introduces the pattern; keep it to this one
flag.

Safety rules the flag enforces:

1. **Player-safe rendering, guaranteed at the gate.** `isReferee()`
   (`js/55:204`) returns `false` when `DISPLAY_MODE` is set. Everything
   referee-only already flows through `isReferee()`/`canSee()` (`js/55:219`),
   so referee overlays, design mode, and records can never render on the TV
   — this is one line at the choke point, not per-feature auditing.
2. **No shared-state writes.** The display window shares `localStorage` with
   the referee window (same origin). It must therefore never write
   `aurelia_pm` (`js/30:15`), `aurelia_identity` (`js/55:1217`), or any KV
   key — otherwise opening the TV would silently flip the referee's own
   session into player mode on next boot. In `DISPLAY_MODE`: skip the
   identity prompt (`checkIdentity()`, `js/55:1190`), skip the player-mode
   checkbox restore, and make `supaStorage.set` a no-op (implemented as
   `set` + `cacheSet` + `flushQueue` guards in `js/50`, so the read-mirror
   cache writes are suppressed too).
3. **No polling.** The display does not call `startPolling()` (`js/55:956`)
   or the alert/combat pollers (`js/75`/`js/80`). The BroadcastChannel is its
   only input. (The access gate passes automatically: `aurelia_access` is
   already set in the shared `localStorage`, `js/55:163`.)
4. **Read-only surface.** `display-mode` body class hides all chrome (top
   bar, panels, toggles) via CSS; `#root` goes pointer-inert; pointer events
   are limited to the fullscreen affordance.

### 2.3 Message protocol

Channel `aurelia-table-display`. Messages are small JSON objects with a `t`
discriminator. Version field `v:1` on every message so the protocol can
evolve.

| Direction | Message | Payload | Meaning |
|---|---|---|---|
| display → referee | `hello` | — | display booted; referee replies with full `scene` |
| referee → display | `scene` | `{spec, camera?, handout?, blank}` | full state sync (boot / resync / explicit send) |
| referee → display | `view` | `{spec}` — `spec = {view, systemId, bodyId, locId}` (the `applyViewSpec` shape, `js/55`) | switch view |
| referee → display | `camera` | `{x, y, scale}` | galaxy pan/zoom mirror (rAF-throttled) |
| referee → display | `handout` | `{url, name}` | show image full-screen |
| referee → display | `handout-close` | — | dismiss image |
| referee → display | `ping` | `{nx, ny, target}` | pulse marker at normalized (0–1) coords; `target:'handout'` maps into the letterboxed image box |
| referee → display | `blank` | `{on:boolean}` | blackout toggle (scene changes, secrets on referee screen) |

Handout payloads carry the **resolved URL** (`handoutUrlFor`, `js/50:143`),
not an id — the display then needs no `handouts` state of its own and no KV
read.

### 2.4 Follow vs Hold

The referee must be able to browse privately (check a referee overlay, peek
at another system) without the TV mirroring every move. Two referee-side
modes, defaulting to **Hold**:

- **Follow** — view switches and galaxy camera moves broadcast live. For
  jump-planning and "everyone look here" navigation beats.
- **Hold** — the TV freezes on the last sent scene; nothing auto-broadcasts.
  Explicit "Send to table" always works in either mode.

### 2.5 Where the code lives

One new module: **`js/93-display.js`** (the 93 slot was free; must load after
`js/85` and before `js/96` — see §7 invariants). It contains both halves,
branched on `DISPLAY_MODE`:

- **Referee half:** channel setup, the control cluster UI, Follow-mode
  broadcasting, `hello` handling.
- **Display half:** channel listener, command dispatch to the existing view
  functions, scene/ping/blank rendering, fullscreen affordance.

Follow-mode hooks **wrap** the existing global view functions at load time
rather than editing them, keeping the feature contained in one module:

```js
const _goGalaxy = goGalaxy;
goGalaxy = function(...a){ _goGalaxy(...a); displayFollowCast(); };
```

This works because the app is one hoisted global scope with late-bound
inline `on*=` handlers (`docs/ARCHITECTURE.md`), and `js/93` loads before the
boot module `js/98` triggers any view restore. Functions wrapped: `goGalaxy`,
`enterSystem` (`js/10`), `goSystemOverview`, `goSystem`, `enterStation`,
`navBack`, `goBodyView`, `selectBody`, `selectBodyLocation` (`js/30`), and
`goAurelia` (`js/40`). A boot-time check logs a console error for any
expected global that has gone missing (§9 drift risk).

**The one place wrapping can't reach:** the galaxy camera lives inside the HX
engine's closure (`let view={x:0,y:0,scale:1}`, applied by `applyTransform()`
in `js/10`). Two small edits inside `js/10` were required:
1. In `applyTransform()`, one line:
   `if (window.onHXCameraChanged) onHXCameraChanged(view);`
2. Export `HX.getCamera()` / `HX.setCamera({x,y,scale})` (setter assigns and
   calls `applyTransform()`), so the display can apply mirrored cameras and
   the referee can snapshot for `scene` sync. `setCamera` also locks out
   `fitView`'s auto-fit (and debounces the full grid-retile render), so a
   mirrored camera is never stomped by the deferred fit or a window resize.

Camera broadcasts are rAF-throttled (≤1 msg/frame) in the referee half.

---

## 3. Phase 1 — Table Display Mode  ·  M effort  ·  ✅ implemented

**Deliverable:** referee clicks "Open table display", drags the window to the
TV, and the TV live-follows (or holds) the referee's map view, player-safe.

### Work items

1. `DISPLAY_MODE` constant in `js/00-core-data.js` (§2.2).
2. Gate changes in `js/55-auth-gating.js`: `isReferee()` returns false under
   `DISPLAY_MODE`; skip `checkIdentity()` prompt; do not start pollers
   (guards in `js/55`/`js/75`/`js/80`); `supaStorage` write no-ops in `js/50`.
3. HX camera hooks in `js/10-galaxy.js` (§2.5 — the only view-engine edits
   outside the new module).
4. New `js/93-display.js`: channel, protocol v1 (`hello`, `scene`, `view`,
   `camera`, `blank`), function wrapping, dispatch, Follow/Hold state.
5. Display chrome: `display-mode` class on `<body>` (plus `pm-active` on
   `#root` so the player-view CSS gating applies wholesale), CSS in
   `css/app.css` hiding all chrome; click-anywhere-to-fullscreen overlay
   shown until fullscreen is entered (fullscreen requires a user gesture);
   subtle "Waiting for the referee window…" state if no `scene` arrives
   within 2 s of `hello`.
6. Referee control cluster (Settings menu section, `js/60` hook, plus
   keyboard shortcuts registered alongside the existing ones in `js/98`:
   D open display · F Follow/Hold · T send view · B blank):
   **Open display** (`window.open(location.pathname + '?display=1', 'aurelia-display')`),
   **Follow/Hold** toggle, **Send this view**, **Blank** toggle, connection
   dot (lit on `hello`, MVP: no heartbeat).
7. Resync semantics: referee answers every `hello` with a full `scene`
   snapshot (`currentView` global + `HX.getCamera()` + pushed handout +
   blank state), so reloading either window self-heals.
8. Shell plumbing (§7): `index.html` script tag, `sw.js` SHELL + cache bump
   (`orion-shell-v13`).

### Acceptance criteria

- TV window shows no referee-only element in any view (spot-check: design
  mode, codex reveal stamps, region overlays, records panels).
- Opening/closing the display never alters referee-window state; in
  particular `aurelia_pm` and `aurelia_identity` in `localStorage` are
  byte-identical before and after a display session.
- Follow mode: pan/zoom on the laptop mirrors on the TV within one frame;
  Hold mode: TV does not move while the referee browses.
- Reload of either window converges to the referee's current view without
  manual steps.
- Works fully offline (airplane-mode laptop, installed PWA).

---

## 4. Phase 2 — Scene push: handout scenes + pings  ·  S effort  ·  ✅ implemented

**Deliverable:** the non-VTT "battle map": any handout image full-screen on
the TV, with a referee ping to point at things. Composes with Phase 1's
"send this map view" (already covered by Follow/Hold + explicit send).

### Work items

1. **"📺 → Table" button** per handout row in `renderHandoutsPanel()`
   (`js/85`), broadcasting `handout` with the `handoutUrlFor(...)` URL
   (`js/50:143`). A second button appears in the referee's own lightbox
   ("📺 Show on table", shown only when a display can be driven).
2. **Display scene element**: a dedicated full-screen `<figure>` in display
   mode (letterboxed, black background; the name caption is present in the
   DOM but hidden — a handout's *name* can be a spoiler) — reuses the
   lightbox styling approach, not the lightbox element.
3. **Ping**: referee clicks the pushed handout in their lightbox (or
   Alt-clicks anywhere over a map view) → normalized coords → `ping` message
   → 2 s pulse animation on the TV at the same relative position, plus a
   local echo pulse on the referee screen. No persistence, no tokens, no
   grid — deliberately.
4. **Visibility guard**: pushing a handout whose `visibleTo` (item shape at
   `js/85`) is not `'all'` prompts "This handout is private to X — show
   on the shared table display anyway?". The TV is physically public; the
   confirm keeps the referee's secrecy model honest.
5. `handout-close` wired to the existing close affordance (closing the
   referee lightbox on the handout that is on the TV clears the TV too), to
   a **Clear handout** button in the control cluster, and the Blank control
   covers the panic case.

### Acceptance criteria

- Push → visible on TV in <100 ms; close and blank work; ping lands at the
  same relative point on both screens regardless of aspect ratio.
- A `visibleTo`-restricted handout never reaches the TV without the confirm.
- Ground-combat rehearsal: referee sketches/photographs a location, uploads
  via the existing `onHandoutFile` flow (`js/85`), pushes to TV, pings
  positions — no new combat UI anywhere.

---

## 5. Phase 3 — Scene ambience beats  ·  S/M effort  ·  ✅ MVP implemented

**Deliverable:** named scene presets ("Startown bar", "Ship idle", "Alarm")
that start referee-supplied audio on the laptop and optionally cut the TV to
a matching scene — Alchemy-style scene beats, the "tasteful ceiling"
identified in the gap analysis (§4), and its open Tier-3 item 15.

**Audio decision (per gap-analysis Q5/Q6):** no copyrighted audio in the
repo, no Spotify SDK. A beat's audio source is either (a) a referee-supplied
URL (self-hosted file, tabletopaudio.com, etc.) played in a single hidden
`<audio id="ambience-player">` element — the app previously had **no**
`<audio>` element anywhere; the only sound is the combat WebAudio synth
(`js/80`), which stays untouched — or (b) an external deep link
(Spotify/YouTube playlist) opened via the existing `window.open` pattern.
Audio plays in the **referee window**; with HDMI the OS routes it to the TV
speakers. One track at a time; play/stop with a ~1.5 s linear volume fade.
Browsers require a user gesture before audio — every play is button-driven,
so this is satisfied by construction.

### Work items

1. Beat model, synced KV key **`scene-beats`** (referee-edited; contents are
   just labels + URLs, so world-readability is acceptable pre-Phase-4):
   `{id, name, audioUrl?, loop, volume, externalUrl?}` (MVP; `handoutId?`,
   `view?` reserved for the Full-scope display cut).
2. **Scenes strip**: a compact referee panel (one row of named buttons +
   stop) following the floating-panel pattern (`js/70`); editor rows for
   CRUD. Lives in `js/93` as a sibling section (decided at build time —
   the beats and the display share the "table presentation" seam).
3. Beat firing: fade out current → fade in new. *(MVP ships audio-only
   beats; per-beat display cut is Full scope.)*
4. Session-planner link (Full, not MVP): a beat picker per planned scene in
   the planner detail view (`openSessionPlanner`, `js/97`), so prep and
   at-table firing meet.

**MVP (shipped):** panel + URL beats + external deep-link beats + fades +
stop. **Full (open):** planner links, per-beat display cut.

### Acceptance criteria

- Firing a beat during any view never interrupts referee interaction; stop
  always stops within the fade time.
- No audio element or autoplay attempt in display mode.
- With HDMI connected, audio audibly plays through the TV (manual check).

---

## 6. Phase 4 — Per-player secrecy migration (existing plan, sequenced here)

This is `docs/per-player-redaction-plan.md`, Stages 0–4 (foundations → edge
function → referee cutover → player cutover → harden). Status there (verified
2026-07-07): **Stages 0–3 shipped; Stage 4 remains** — see that doc's status
header. It stays the most important engineering item on
the roadmap because (a) every secrecy-adjacent feature added before it
widens the honour-system surface, and (b) the gap analysis flags it as a
precondition for open-sourcing (§7 item 16).

Two sequencing notes added by this plan:
- **Phases 1–3 above do not deepen the secrecy debt** — the display is
  player-safe by the `isReferee()` gate, and `scene-beats` holds no secrets —
  so shipping them first is safe.
- **Phase 5 (whispers) must not ship before Stage 4** of the redaction plan
  (or must ship with an explicit honour-system caveat) — see §8.
- Maintenance: the redaction plan's `index.html:NNNN` anchors predated the
  22-module split; ✅ refreshed 2026-07-07 as part of the Stage 0 verification.

---

## 7. Cross-cutting invariants and release checklist

Every phase that adds or renames a `css/js` file must, in the same commit
(the PWA-offline invariant, `docs/pwa-offline.md` / `docs/ARCHITECTURE.md`):

1. Add the `<script>` tag in dependency order in `index.html` —
   `js/93-display.js` goes after `92`, before `96`; it must stay after
   `10`/`30`/`85` (it wraps their globals) and before `98` (boot).
2. Add the file to `sw.js` `SHELL` **and bump `CACHE`**
   (`orion-shell-v12` → `v13` at Phase 1; bump again each released phase —
   Phases 1–3 shipped together in one release, one bump).
3. `node tools/build-local.mjs` — the css/js count check derives counts
   dynamically but warns on mismatch; confirm no warning.
4. `node tools/strip-secrets.mjs --check` → exit 0 (verified passing; none
   of these phases bake new campaign literals, so no new REDACT
   classifications were needed).
5. `node tools/verify-split.mjs` untouched by these phases (no edits to the
   original monolith mapping).

**Known limitation documented in-app:** `BroadcastChannel` requires an
http(s) origin. The double-clickable `index.local.html` build (`file://`)
cannot host the display link — the referee control cluster hides itself when
`location.protocol === 'file:'` or `BroadcastChannel` is undefined
(`displaySupported()`, `js/93`).

---

## 8. Phase 5 (optional) — Whisper notes  ·  S effort  ·  not scheduled

The one in-person use for "chat": a player passes the referee a secret note
("I pocket the data crystal") without the table seeing. Not scheduled;
build only if the table actually hits this, and **after Phase 4 Stage 4**
(before that, whispers ride the world-readable `aurelia_state` KV and are
honour-system private — acceptable for ambience URLs, not for secret notes).

Sketch when its time comes: KV key `whispers`
(`{id, from, ts, text, resolved}`); a one-line composer in the player tools;
referee panel with unread badge; referee is notified by the existing player
poll cycle diffing the key (`pollRevealState`, `js/55:505`) plus a
`showToast` (`js/92:740`). Referee replies become items with
`visibleTo: [sender]` — same audience mechanics as contacts/wiki.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Wrapped globals drift (a future refactor renames `goGalaxy` etc.) | Wrapping is centralized in `js/93`; a boot-time assert logs a console error listing any expected global that is missing. |
| Two referee windows both broadcasting | Documented single-referee-window assumption; the display honors the most recent sender. Full: referee windows claim the channel with a nonce and yield to the newest. |
| Popup blocker eats the display window | Open is always from a direct click on "Open table display" (user gesture) or a direct keypress, never programmatic. |
| Fullscreen/autoplay gesture policies | Both are behind explicit clicks by design (§3.5, §5). |
| Referee accidentally exposes a secret on the TV | `isReferee()===false` in display mode kills the whole class of leaks; the Phase 2 `visibleTo` confirm covers the one referee-initiated path; **Blank** is the panic button. |
| HDMI audio routing surprises (OS outputs to laptop speakers) | Out of app control; note in the Scenes panel help text ("check system output device"). |
| Service worker serves a stale display shell after a release | Cache bump per §7; the display window is the same origin/scope, so one refresh updates both. |

---

## 10. Schedule (cadence: ~1 dev-week/month, per gap-analysis Q7)

| Cycle | Work | Exit test |
|---|---|---|
| Month 1 | **Phase 1** Table Display Mode (M) — ✅ built | Acceptance §3; one real session with the TV |
| Month 2 | **Phase 2** Scene push (S) + **Phase 3** ambience MVP (S) — ✅ built | Acceptance §4/§5; run a ground-combat scene and a scene-beat cut at the table |
| Month 3+ | **Phase 4** redaction Stages 0–2 (plan-first, per its own doc) | `get-content` parity proven on referee device |
| Following | **Phase 4** Stages 3–4; then Phase 3 Full / Phase 5 if wanted | Security advisors clear; open-sourcing unblocked |

After each phase: update the status tables in `docs/feature-gap-analysis.md`
(§2) and this document's header.

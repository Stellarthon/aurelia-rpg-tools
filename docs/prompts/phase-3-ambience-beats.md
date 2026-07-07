# Implementation prompt — Phase 3: Scene ambience beats (MVP)

> Paste everything below this line into a fresh session on a new feature
> branch. **Prerequisite: none for the audio core.** The optional
> "beat also cuts the display" wiring requires Phases 1–2; if they are not
> merged yet, ship the audio MVP and leave the display hooks stubbed behind a
> capability check, noting it in the PR.

---

Implement **Phase 3 (Scene ambience beats)** of
`docs/table-presentation-plan.md` §5 — the MVP scope. Read plan §5 and the
gap analysis decisions it encodes (`docs/feature-gap-analysis.md` Q5/Q6 and
the anti-feature list) before coding. Re-verify all `js/NN:line` anchors.

## Objective

Named scene presets ("Startown bar", "Ship idle", "Alarm") the referee fires
with one click during play. A beat plays referee-supplied audio on the
laptop (HDMI routes it to the TV speakers) and — Full scope, only if
Phases 1–2 are present — optionally cuts the table display to a matching
handout or view. Alchemy-style scene beats; nothing more.

## Hard constraints (decided — do not relitigate)

- **No copyrighted audio in the repo.** Beats reference referee-supplied
  URLs (self-hosted files, tabletopaudio.com, etc.) or external deep links.
- **No Spotify/YouTube SDK, no OAuth.** External sources are plain deep
  links opened with the existing `window.open(url, '_blank', 'noopener')`
  pattern (see `js/92-tools-misc.js:355`).
- **No mixing console.** Exactly one track at a time, play/stop, loop
  toggle, per-beat volume, ~1.5 s linear fade in/out. Nothing else.
- **Leave the combat WebAudio synth untouched** (`js/80-combat.js:1759-1763`).
  This feature must not share code or state with it.

## Hard requirements

1. **Beat model**, synced KV key **`scene-beats`** via the `supaStorage`
   façade (`js/50-supabase.js`):
   `{id, name, audioUrl?, loop, volume, externalUrl?, handoutId?, view?}`.
   Referee-edited; contents are labels + URLs, so world-readability of the
   KV is acceptable (per plan §5 — do not build extra secrecy here).
2. **Audio element:** a single hidden `<audio id="ambience-player">` in
   `index.html` — the app currently has no `<audio>` element anywhere; keep
   it that way except this one. It must never be created, played, or
   preloaded in `DISPLAY_MODE`. Every play/stop is button-driven (satisfies
   autoplay policies by construction).
3. **Scenes strip:** a compact referee-only panel — one row of named beat
   buttons plus a Stop button — following the floating-panel pattern in
   `js/70-panels-quest.js`. Editor mode for CRUD (add/rename/URL/loop/
   volume/delete). Place the code with the misc tools (`js/92`) or as a new
   sibling module — decide by resulting size; if a new file, follow the full
   plan §7 shell checklist (index.html script order, `sw.js` SHELL +
   `CACHE` bump, `build-local` count).
4. **Firing semantics:** fire beat B while beat A plays → fade A out, then
   fade B in. Stop always silences within the fade time. Firing an
   `externalUrl` beat opens the deep link and stops any playing track.
5. **Referee-only:** the panel and all beat firing are gated by
   `isReferee()` (`js/55-auth-gating.js:204`) — players and the display
   window never see or hear it.
6. **Help text:** one line in the panel — "Audio plays from this device;
   check your system output is the TV/speakers." (HDMI routing is an OS
   concern, out of app control.)

## Out of MVP scope (do not build now)

Session-planner beat links (plan §5 item 4), audio upload to a Supabase
bucket, crossfade curves, playlists. Note them as follow-ups instead.

## Acceptance criteria (plan §5 — verify manually)

- Firing a beat during any view never blocks or interrupts referee
  interaction; Stop silences within the fade window.
- Two rapid beat switches in a row end with only the last beat playing.
- No `<audio>` element exists and no play is attempted in `?display=1` mode.
- Beats persist across reload and appear on a second referee device (KV
  sync via `supaStorage`).
- `node tools/build-local.mjs` clean; `node tools/strip-secrets.mjs --check`
  exits 0; `CACHE` bumped in `sw.js:8` for the release.

Report exactly what you verified. When done, update the Tier-3 ambience row
in `docs/feature-gap-analysis.md` §2 and the status header of
`docs/table-presentation-plan.md`.

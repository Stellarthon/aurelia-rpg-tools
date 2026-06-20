# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A referee/player toolkit for a tabletop RPG campaign (Traveller 2E, "Archon Gambit" / Aurelia campaign). Not a buildable software project — there is no package.json, build step, test suite, or linter. Each file is a single self-contained HTML document (inline `<style>` and `<script>`, no external JS dependencies except a direct `fetch()` to Supabase's REST API). "Development" means editing these files directly and opening them in a browser to check the result.

- [aurelia_combined_v31__17_ (1).html](<aurelia_combined_v31__17_ (1).html>) — the main tool. A multi-view referee/player console: solar system orrery, station map, Aurelia surface map, NPC/combat tracker, character sheets, notes, search, and a morality ("Archon") tracker.
- [orion_arm_map_v4.html](orion_arm_map_v4.html) — a companion galaxy-scale starmap (systems, jump lanes, factions) in the same visual style, standalone from the main tool.

## Running / testing changes

There is no dev server or test command. Open the HTML file directly in a browser (or use a local static file server) and click through the affected view. Since both files are single static documents, a plain double-click/`file://` open works for most things; Supabase-backed features (shared state sync) require the file to actually fetch from the network, which works fine over `file://` too since it's a plain `fetch()` call.

## Architecture (per file)

Both files follow the same overall shape: a big chunk of hand-authored **data** constants, followed by **render/state functions** that mutate the DOM directly (no framework, no virtual DOM, direct `document.getElementById`/`innerHTML` calls), wired up by inline `onclick="..."` handlers in the generated HTML strings.

### Data → render pipeline
- Static campaign data (systems, bodies, NPCs, locations, factions, jump lanes, timed events) is declared as top-level `const` objects/arrays near the top of the `<script>` block (e.g. `SYSTEMS`, `MAIN`, `FACTIONS`, `AURELIA_LOCS`, `TIMED_EVENTS`, `ARCHON_AXES`).
- Mutable session state (current location, revealed areas, NPC health, initiative order, notes, flags) lives in plain top-level `let`/`const` variables, not a state-management library.
- `render*()` functions (`renderDetail`, `renderInit`, `renderHealthPanel`, `renderSystems`, `renderLanes`, etc.) regenerate `innerHTML` for a panel from current state whenever it changes. There's no diffing — call the relevant `render*()` after any state mutation.

### Content override / design mode layer
Both files support **runtime content editing** without a build step: a `DESIGN_MODE_CODE`-gated "design mode" lets the referee edit any piece of static text/data in place. Edits are stored as overlay objects (`contentOverrides`, `contentHistory`, `laneAdditions`/`laneDeletions`, body additions/deletions in the main tool) that are layered on top of the original `const` data via `resolveContent(key, original)` / `effectiveBodies()`-style merge functions, then persisted (see Persistence below). When reading "what does the UI show for X," check whether an override exists before trusting the original data constant.

### Persistence: localStorage vs Supabase
- `orion_arm_map_v4.html` persists everything to **`localStorage` only** (`galaxy_location`, `galaxy_flags`, `galaxy_content_overrides`, etc.) — single-device, no sync.
- The main combined tool additionally syncs shared/cross-device state (revealed map areas, station clock, NPC notes, character sheets) through a `supaStorage` wrapper that does plain `fetch()` calls against a Supabase REST endpoint (`SUPABASE_URL`/`SUPABASE_REST`, table `aurelia_state`, simple key/value rows with `Prefer: resolution=merge-duplicates` upserts). Players poll this endpoint on an interval (`POLL_MS`, `pollRevealState`) since there's no websocket/realtime subscription — keep this polling model in mind if extending shared state.

### Access gating
Both files gate the UI behind a hardcoded passphrase checked client-side (`ACCESS_CODE` in the main tool, `DESIGN_MODE_CODE` for design-mode editing in both files) and remember the unlock in `localStorage`. This is explicitly documented in-file as a casual deterrent against stray link clicks, not real security — anyone viewing page source gets the code. Don't "fix" this by trying to add real auth unless asked; it's intentional.

### View/navigation model
Navigation is a manual view-stack pattern, not routing: functions like `selectSystem`, `enterStation`, `goSystem`, `goAurelia`, `goBack`, `setBreadcrumb` toggle which top-level panel `<div>` is visible and push/pop a breadcrumb trail rendered by `renderHeader`. Look for `display`/`hidden` class toggles on the major panel containers rather than any router.

## Editing conventions to preserve

- Section dividers in the JS use `// ── Title ──...` banner comments — match this style when adding new sections rather than introducing a different comment convention.
- CSS custom properties (`--bg0`, `--tx0`, `--accentGold`, etc., defined on `:root`) implement the dark theme and a `#root.light-mode` override block for light mode. Some panels (orrery, station map, Aurelia surface) are deliberately pinned to the dark background in both themes — see the comment block above `#root.light-mode #orrery-panel` in the main tool. Don't make those panels follow light-mode without checking that comment's reasoning first.
- `orion_arm_map_v4.html`'s CSS variables and panel layout are deliberately copied to match the main tool's theme exactly (see comments like "CSS variables matching the main tool's dark theme exactly" and "exactly like sys-wrap") — if the main tool's theme changes, mirror the change here too.

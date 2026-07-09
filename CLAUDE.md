# CLAUDE.md — Aurelia RPG Tools (a.k.a. "Archon Gambit")

> **Persistent project memory.** Claude Code auto-loads this file at the start of
> every session in this repo. It exists so I don't have to re-analyse the codebase
> each time. Keep it current: when a change alters the module map, the shared-state
> contract, the build/deploy rules, or adds a feature system, update the relevant
> section here in the same commit. This is a living map, not a changelog — record
> *what exists and how it fits*, not every tweak (git log is the changelog).

## What this project is

A single-page, offline-capable **PWA referee/GM toolkit for running tabletop RPG
campaigns** — built around **Mongoose Traveller 2nd Edition (MgT2e)** rules and set
in the **Orion Arm** of a ~180-system galaxy. It began life as one specific
campaign, **"Archon Gambit"**, and was later generalised into a
**franchise-agnostic engine** where the whole universe (systems, taxonomy, world
schema, dice/resolution, attributes, meters, terminology, module toggles, theme) is
portable, referee-owned **Campaign Pack data** rather than hard-coded. Archon Gambit
is now simply the *default* pack (`DEFAULT_CAMPAIGN_ID = 'archon-gambit'`).

- **Deployment:** static site on **GitHub Pages** (repo `Stellarthon/aurelia-rpg-tools`,
  `.nojekyll` present). No build step to run the app — it's plain classic-script HTML/JS/CSS.
- **Backend:** **Supabase** (Postgres KV table `aurelia_state` + Storage buckets +
  Edge Functions). Publishable anon key is baked into `js/50-supabase.js` (RLS-gated,
  intentional). Project ref: `rarxefzcqvgqvxutprcq`.
- **Runtime model:** one referee laptop drives the campaign; players view on phones
  (locked to player view) and a table TV/HDMI second window. Roles + spoilers are
  server-enforced (see Security below).
- **Local dev:** `.claude/launch.json` serves the folder at `http://localhost:8777`
  via `python -m http.server 8777`. Just open `index.html` over HTTP (not `file://`).
- **Version marker:** `#build-version` span in `index.html` (currently **v47**);
  the service-worker cache is `orion-shell-vNN` in `sw.js` (currently **v30**).
  These two version lines advance independently.

## The one architectural fact that governs everything

The app is **one giant hoisted global scope**, physically split into ordered
classic `<script src>` files (NOT ES modules). ~900 globally-hoisted symbols with
forward references spanning thousands of lines; hundreds of inline `on*=` handlers.
`index.html` (~72KB now; was a ~17.4k-line monolith) is the markup + ordered script
tags; the logic lives in `js/NN-*.js`, loaded in numeric-prefix order.

**The load-order rule (do not break it):** load order == original source order.
A top-level *synchronous* statement may only reference symbols defined **earlier in
load order**. Forward references are fine only inside deferred callbacks (`.then`,
`addEventListener`, `setTimeout`/`setInterval`) or behind `typeof` guards. If you add
a top-level synchronous call to a function defined in a later file, **move that
statement into the last-loaded file** (`js/98-trackers-boot.js`) — that's the only
sanctioned reordering — and declare it in `RELOCATIONS` in `tools/verify-split.mjs`.
There is exactly one such relocation today (`start*Polling`, moved `30`→`98`).

Full rationale + the three verification gates are in **`docs/ARCHITECTURE.md`** —
read it before any structural change. `tools/verify-split.mjs` proves the split
reassembles byte-for-byte to the pre-split monolith.

## Module map (`js/`, in load order)

Numeric prefix = load order. `docs/ARCHITECTURE.md` has the original-line ranges for
the files that predate the pack refactor; the summaries below are current.

| File | Holds |
|------|-------|
| `00-core-data.js` | `BASE_BODIES_AUROS`, `SYSTEMS`, the system/body data model. Secret-bearing literal (de-baked). |
| `05-campaign-pack.js` | **Campaign Pack engine.** `PACK_DEFAULTS`, registry (`_campaignRegistry`, `_activePack`, `activeCampaignId`), lifecycle (`buildDefaultPack`, `assembleActivePack`, `initCampaignPacks`, `createCampaign`/`switchCampaign`/`duplicateCampaign`), accessors (`activePackConfig`, `TERM`, `pkTaxonomy`, `pkMeters`, `pkModules`, `moduleOn`, `pkResolution`, `applyPackToUI`, `rollCampaignDice`). LS keys `CAMPAIGN_REGISTRY_LS`/`CAMPAIGN_ACTIVE_LS`. |
| `10-galaxy.js` | **Galaxy map** (see Engines below). `GALAXY_FACTIONS`/`GALAXY_NODES` (+`*_BASE` snapshots), legacy `gx*` engine, `WGEN` (MgT2e UWP/trade-code worldgen), `HX` hex-jump engine. `GALAXY_NODES` is a de-baked secret literal. |
| `20-station-data.js` | `MAIN` station data object. De-baked secret literal. |
| `30-system-body.js` | Shared state & player mode, system map, orrery, body close-up, location layer, view switching. |
| `40-station.js` | Station view, station clock, `BASE_LOCATIONS`, `TIMED_EVENTS` (both de-baked), event log, Aurelia navigation. |
| `45-initiative.js` | Initiative / health tracker (referee). |
| `50-supabase.js` | **DATA LAYER (owner).** `supaStorage` façade, KV contract, offline write-through cache + outbound queue, texture catalog. Holds publishable `SUPABASE_KEY`. Nothing else talks to the REST endpoint directly. |
| `55-auth-gating.js` | **ROLE GATING (owner).** access gate, `isReferee()`/`canSee()`/`viewerKey`/`secureRole`, `get-content` token path, `hydrateSecureContent`, shared-state poll, splash config. |
| `60-tools-settings.js` | Character sheets, settings menu, search, **Archon Morality Tracker** (`ARCHON_AXES`/`ARCHON_BANDS`, now a default-pack meter), campaign export/reset, box-type registry. |
| `62-campaign-studio.js` | **Campaign Studio** — the referee control-room modal to edit every pack setting (tabs: Campaigns, Terminology, Meters, Modules, Dice, Theme, Worlds, Layers, Types). `openCampaignStudio`, `renderCampaignStudio`, `studioCommit`. |
| `65-design-mode.js` | Design-Mode stage-1 overrides, body/location stores, structured editors. |
| `70-panels-quest.js` | Draggable/resizable floating panels, quest log. |
| `75-ship.js` | Ship data file, red-alert state. |
| `80-combat.js` | Space combat phases 1–5 (incl. §7.1: heads-up guardrail, per-stat fog, quick-resolve). |
| `85-records.js` | Imperial calendar, discovery log, reputation, party funds, oracle, **the main boot/init block** + secure-content wiring. |
| `90-economy.js` | **Living Economy engine** `window.ECON` (see Engines below). Largest file. |
| `91-trade.js` | **Trade Run** — referee Station Trade desk + diegetic Starport Board (freight/passengers/mail). Recording tool, not auto-resolver. Writes `funds` ledger, `trade-cargo` manifest, `starport-board` key. `toggleTradePanel`, `renderTradePanel`. |
| `92-tools-misc.js` | Quick-reference sidebar, session tools, `showToast`. |
| `93-display.js` | **Table Presentation Suite** — player-facing TV window (`index.html?display=1`), `BroadcastChannel` (`DISPLAY_CHANNEL`) versioned protocol (hello/scene/view/camera/handout/ping/blank). Display window never writes shared state. `displayCast`. |
| `96-creators.js` | NPC creator, body creator (Design Mode). |
| `97-session-planner.js` | **Session Planner** — referee prep workspace (scenes/beats linked to NPCs, missions, Oracle draws). Referee-only shared key `session-plans`. `SCENE_TYPES`, `PLAN_STATUS`, `openPlanner`. |
| `98-trackers-boot.js` | Grab-bag: NPC Location Tracker (`aurelia_npc_locations`, `checkNpcSchedules`), keyboard shortcuts (`KBD_DEFAULTS`, `kbdDispatch`), tracker layout, a11y pass (`a11yEnhance`), starfield boot, **+ the one relocated `start*Polling` boot tail**. |

## The two dominant engines

### `window.ECON` — Living Economy (`js/90-economy.js`)
A stocks/flows/lead-times sim: goods graph (bill-of-materials recipes, conservation),
per-world stockpiles with safety thresholds, trade that moves goods producer→consumer
with lead time = jump distance (shocks ripple, don't teleport). Tick = one Imperial
week. Hooks into prices only via `HX.mktPressure()` → `ECON.pressure()` (full sim) or
`simplePressure()` (default static model); if the engine throws, prices don't change.
Worlds are curated (`DEF`), overridden, or procedurally derived from MgT2e trade
codes/pop/starport via `HX.worldFacts()`.
- **Subsystems:** goods graph incl. a fuel chain mirroring the ship planner; procedural
  profile derivation; **independent trader agents** (MgT2e merchant hulls, per-ship fuel,
  milk-runs); **Corporations** (pooled-capital houses, treasuries, monopolies, player
  shareholding, contract opportunities); world status/boom-bust + **contraband/black
  market**; **Event Director** (emergent shocks); **Faction AI** (major powers as
  strategy actors — treasuries, relations, embargoes/tariffs, **government cabinets**);
  **GalNet** rolling news; **Pirate bands** (rules-legal hulls, raids, player base-storming);
  and the referee console UI + Design-Mode production/consumption editors.
- **Key API:** `ensure`, `advance`, `syncToDate`, `pressure`, `priceOverlay`,
  `effectiveProfile`/`setProfile`, `intel`, `applyRun`, `fire`, `news`, `relOf`/`setRelation`,
  `cabinetOf`, plus `GOODS`/`SIM_GOODS`/`PRESETS`.

### Galaxy map (`js/10-galaxy.js`)
Data + registry + two render engines for the Orion Arm (~180 systems).
- **`WGEN`** — seeded, deterministic MgT2e UWP + trade-code world generator; the single
  source of truth shared by the map and the ship tools (`genUWP`, `tradeCodes`, `uwpStr`…).
- **`HX`** — current hex-jump engine: axial hex grid, transform-only pan/zoom (rAF-throttled,
  broadcast to other views), **level-of-detail + viewport culling** to stay smooth at ~180
  systems, faction-coloured territory regions, zoom-gated star labels, a trade/economy
  overlay (produces/needs badges, price heatmap, referee "best run" optimizer, fog-of-war on
  unvisited markets), dual route graphs (rendered jump lanes vs. invisible authored ECONOMY
  lore-route graph), and hex-jump/fuel routing. API: `enter`, `refresh`, `moveSystem`,
  `worldFacts`, `localMarket`, `getCamera`/`setCamera`.
- **`gx*`** — legacy free functions (ported from `orion_arm_map_v4`): lane management,
  route blocking, region/faction editing, star info panels.
- **Design Mode** (referee-only): drag stars to nearest hex, add/close jump lanes, paint
  regions — all as restorable overlays on the authored `*_BASE` snapshots.

## Shared-state & security contract (do not break)

- **Data ownership:** all reads/writes go through `supaStorage.get/set` in
  `js/50-supabase.js`. One KV table `aurelia_state` (key → JSON value). Offline
  cache + outbound queue live here.
- **Writes are token-gated (Stage 4, live):** anon INSERT/UPDATE on `aurelia_state`
  is dropped (migration `0010`); every write routes through the `put-state` edge
  function, which requires a valid token and the **referee** token for the ~46
  referee-only keys. Tokenless devices are read-only + local queue.
- **Gating ownership:** `isReferee()`, `canSee()`, `secureRole`, and the
  `get-content` token path live only in `js/55-auth-gating.js`.
- **Per-player redaction (live, Stages 0–4):** referee secrets are NOT in the shipped
  bundle. `tools/strip-secrets.mjs` de-bakes 5 literals at deploy time
  (`BASE_BODIES_AUROS`→`00`, `GALAXY_NODES`→`10`, `MAIN`→`20`,
  `BASE_LOCATIONS`/`TIMED_EVENTS`→`40`). Secrets live in the `campaign_content`
  table, served per-identity by the `get-content` edge function (JWT verification
  **off** — we use our own opaque tokens). A referee must load a referee token
  (Settings → Secure Content) to see secret content; players get 0 bytes of it.
- **Whispers (v43):** secret player→referee notes in the `whispers` key; anon SELECT
  carve-out (migration `0011`) means whisper text is never readable with the anon key.
- **Runbook + verification curl/SQL:** `supabase/README.md` (authoritative). Redeploy
  edge functions from repo files only — never hand-edit in the dashboard.
- **Known open item:** `aurelia_state` still allows public SELECT; some referee-only
  keys hold prose (`npc-roster`, `session-plans`, unrevealed `clocks`, raw
  `combat-encounter`, `campaign-events`). Closing needs a staged read cutover through
  `get-content` (plan doc §8). Don't just drop the SELECT policy — it would break reads.

## PWA / offline (must maintain)

`sw.js` is **network-first** (republished often — must not trap users on a stale
build) and precaches the *entire* app shell. **If you add / rename / remove any
`css/` or `js/` file you MUST update the `SHELL` list in `sw.js` AND bump the
`CACHE` version (`orion-shell-vNN`)** — otherwise installed PWAs break offline. The
service worker leaves cross-origin (Supabase / edge-function / API) requests alone.

## Tooling (`tools/`)

- `verify-split.mjs` — the 3 verification gates (partition-equivalence, load-order audit, boot smoke). Run after structural edits.
- `strip-secrets.mjs` — de-bakes referee literals at deploy (aborts if any secret structure is uncovered — no partial strips).
- `build-local.mjs` — builds the self-contained `index.local.html` (gitignored) for offline single-file viewing; `index.html` is the source of truth.
- `gen-galaxy.mjs`, `mark-uninhabited.mjs` — galaxy data generation/curation.
- `gen-icons.mjs` — PWA icon generation.
- `extract-content.mjs` — reads `index.html`/modules → `supabase/seed/*` (audience-tagged fragments + classification report).
- `econ-corp-harness.cjs` — economy/corp sim harness.

## Docs worth knowing (`docs/`)

`ARCHITECTURE.md` (the split, invariants, gates — read first for structural work),
`per-player-redaction-plan.md` (the security staging plan), `table-presentation-plan.md`
(TV/display + whispers), `feature-gap-analysis.md`, `orion-arm-map-assessment.md`,
`phase-2-feasibility-study.md`, `phase-3-combat-audit.md`, `inventory-phase-0-audit.md`,
`pwa-offline.md`.

## Working conventions in this repo

- **Style:** match surrounding code. Terse, purpose-first header comments on each module
  and non-obvious block; British-ish spelling in prose ("colour", "behaviour"). Feature
  commits read like `Area: what changed (vNN, orion-shell-vNN)`.
- **Testing caution:** the bundle carries the live `SUPABASE_KEY` and reads/writes the
  live `aurelia_state` table. Keep browser testing **read-only** — don't toggle reveals,
  clock, combat, or any referee state. Boot itself is read-only (GETs + the economy
  engine's deterministic self-seed of `econ-state`/`econ-profiles`).
- **Private rules reference:** `.claude/skills/traveller-2e-rules/` (gitignored — extracted
  from the referee's own rulebooks, never publish).
- **Branch for this workstream:** `claude/archon-gambit-memory-u2xrcp`. Push with
  `git push -u origin <branch>`. Don't open a PR unless asked.

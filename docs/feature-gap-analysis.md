# Aurelia RPG Tools — Comparative Feature-Gap Analysis & Roadmap

## Context — why this document exists

The request was a companion-vs-VTT feature-gap analysis for **Aurelia RPG Tools**, the
private companion suite for the in-person Mongoose Traveller 2e campaign *Archon Gambit*.
The governing constraint is **"the app accompanies the game; it must never become the
game"** — table-first, heads-up, no in-app combat/dice/roleplay resolution.

The mandatory first step (read the repo, build a *verified* inventory before calling
anything "missing") produced a surprise that reshapes the whole exercise:

> **Aurelia is already a mature product, and much of the "typical VTT gap list" is
> already built.** It is not a monolithic `index.html` (it is 18 ordered `js/` modules),
> not a 3-person tool (`KNOWN_CHARACTERS` has five), and it already ships a Codex
> fog-of-knowledge engine, reputation, funds ledger, quest log, NPC dossiers, an
> Oracle, a UWP-faithful world generator, a full jump/fuel route planner, a
> living-economy sim, PWA offline, and a franchise-agnostic Campaign-Pack engine.

The single most important finding is a **philosophy tension, not a gap**: a
**full referee-authoritative space-combat rules engine already ships** (`js/80-combat.js`
— 2D attack rolls, damage→hull→structure→crits, phases 1–5, radar, FX, WebAudio) —
exactly the class of feature this brief lists as an anti-feature. Resolving *that*
(contain vs. expand) matters more than any single missing feature.

This document is a **strategy deliverable** (analysis + roadmap), with an
implementation-ready spec for the Tier-1 quick wins at the end. Everything is grounded
in verified code; assumptions are flagged with ⚠️.

---

## Implementation status — branch `claude/aurelia-feature-gaps-taksg8`

Tier-1 progress (each commit syntax-checked + driven through a headless-Chromium boot
smoke test with zero uncaught exceptions; live referee→player sync not exercised to avoid
mutating the production `aurelia_state`):

| Item | Status |
|---|---|
| `strip-secrets.mjs` de-bake guard fix (§7 Tier-1.6) | ✅ shipped — `--check` exits 0 |
| Saved session journal (§5.4) | ✅ shipped |
| Codex player-submitted rumours / `pending` (§5.3) | ✅ shipped |
| Shared turn-order board, redacted + referee-gated (§5.1) | ✅ shipped |
| Rules & gear page references — Layer 2 (§5.6) | ✅ shipped (`rules-index` key, in the Rules panel) |
| Ship's log (§6) | ✅ **already present** — the "Captain's Log" section renders `shipState.jumpLog` in the galaxy panel (`js/10:2100`); not a gap |
| Finish route-blocking (§5.2) | ✅ shipped — referee block-mode + kill-switch, dashed-red 🔒 for nav crew; ⚠️ SVG rendering needs an on-device visual check (headless can't build the gated map) |
| Rules & gear catalogue seed — Layer 1 (§5.6) | ⏳ content task (referee-entered gear; nothing generic to ship) |

**Tier-1 is functionally complete.** Everything code-buildable is shipped; the only
open Tier-1 line is Layer-1 catalogue *content* (referee-entered gear, by design).

Tier-2 progress:

| Item | Status |
|---|---|
| BYO-rulebook PDF upload — Layer 3 (§5.6) | ✅ shipped — referee uploads own PDF to a private `rulebooks` bucket; page references deep-link the native viewer via `#page=N`. Migration `0003_rulebooks_bucket.sql` **applied to production** (bucket + policies verified) |
| "Since last session" digest (§6) | ✅ shipped — returning players see a one-shot summary of what changed (date/funds/codex/missions/journal); JS-only overlay, no index.html/css footprint |
| Printable character sheet (§5.7) | ✅ shipped — native print / save-as-PDF from a clean self-contained doc; js/60-only, no index.html/css footprint. Ship-sheet print still to do |
| Referee-facilitated trade helper (§5.5) | ⏳ not yet — will touch index.html/css + js/90 |
| Handout / evidence push (§5.8) | ⏳ not yet — will touch index.html/css + a storage bucket |

---

## 1. Clarifying questions & answers

Answers confirmed with the referee on 2026-07-02. Each recommendation that depends on one
is tagged with its question number.

| # | Question | Answer |
|---|---|---|
| Q1 | Where does the campaign lose the most time now? | **Both** between-session continuity **and** at-table gear/rules lookups (prep is well-tooled) → both tracks are top priority. |
| Q2 | At-table hardware? | Referee laptop **or iPad** + players on phones/tablets. **No dedicated shared TV** → design shared read-outs to land on each player's own device, not one big screen. |
| Q3 | Session mode? | (Unstated) Assumed strictly in-person; occasional remote a nice-to-have. |
| Q4 | Player self-service vs. referee-primary? | **Balanced**: targeted player tools; referee still owns the world. |
| Q5 | Content licensing? | Private home use now; possible **open-source later**. Preferred model: **no copyrighted content in the repo** — ship page-citations/"where to look", and let each referee **upload their own rulebook PDF for private use**. |
| Q6 | Audio/ambience? | Welcome but low priority → Tier 3. |
| Q7 | Dev budget? | **~1 week/month.** Generous → Tier 2 mediums are readily reachable; sequence ~2–4 features/month. |

---

## 2. Verified current-state inventory (from the repo)

"Present/Partial/Missing" are verified in code; key evidence cited. Full KV data model =
46 shared keys through the single `supaStorage.get/set` façade on `aurelia_state`
(`js/50-supabase.js`), player-polled with backoff in `js/55-auth-gating.js`.

| Category | Status | Verified detail (evidence) |
|---|---|---|
| Layered maps (Galaxy/System/Body/Station) | **Present** | 4 real views + orrery + location layer; "Aurelia Combined" = the rich body close-up (`js/30`, `js/40`). |
| Jump / travel / fuel nav | **Present (strong)** | HX engine: parsec distances, Dijkstra routes, weeks, fuel/refuel/stranding, executable jumps → `shipState` + calendar (`js/10:1329-2239`). |
| World data (UWP) | **Present** | Canon MgT2e UWP, trade codes, TL, random gen (`WGEN`, `js/10:1253-1326`). |
| Design-Mode CRUD | **Present (broad)** | Systems, lanes, regions/factions, bodies, locations, station content, splashes, economy, weapons; tombstone-restore (`js/10`,`js/65`,`js/96`). |
| Character sheets + grid inventory | **Present** | Stats, `charDM`, status chips, portraits, full grid inventory (containers, equip slots, drag, advisory encumbrance "never blocks" `js/60:1971-2004`). |
| Ship operations | **Present** | Ship sheet, crew skills, crits, fuel/jump math, Red Alert (auto <25% hull), `ship-roster` (`js/75`). |
| Initiative / health tracker | **Partial** | Referee 2D6+mod + NPC health, but **localStorage-only, not synced** (`js/45`). |
| Space combat engine | **Present (⚠️ philosophy)** | Full MgT2e engine, referee-authoritative, redacted player view, rolls dice (`js/80:446 resolveAttack`). |
| Codex / fog-of-knowledge | **Present** | hidden→rumoured→known + audience gating + reveal stamps (`js/85`). **`pending` (player rumour submission) not shipped.** |
| Reputation / factions | **Present** | Traveller −6…+6 scale + dated milestones (`js/85:483-702`). |
| Party funds ledger | **Present** | Party fund + per-char purses, dated log (`js/85:503-583`). |
| Quest log | **Present** | Status, player vs ref notes, objectives (`js/70`,`js/85`). |
| NPC roster / contact dossier | **Present (ref-only)** | Browsable NPC library + placed-NPC index (`js/85:382-470`). |
| Oracle (rumour/encounter/contract gen) | **Present (ref-only)** | State-seeded generators; push to Codex/Quest (`js/85:717-1050`). |
| Living economy | **Present (ref sim)** | UWP-driven stocks/flows, traders, corps, shocks; players see prices only (`js/90`). |
| Session recap | **Present** | Deterministic narrative recap + log export from event timeline (`js/92:174-334`). |
| Quick-reference | **Partial** | Rules cards only (task/effect, DMs, reactions, ranges); **no gear compendium** (`js/92:5-170`). |
| Search | **Present** | Visibility-aware entity search (`js/60:247-399`). |
| Offline / PWA | **Present (strong)** | Network-first SW, write-through cache, offline queue, backoff poll, conn pill (`js/50`,`sw.js` v3). |
| Data portability | **Partial** | Full JSON export/import + reset + pack export; **no app-generated printable/PDF** (`js/60:993-1070`). |
| Campaign-pack engine | **Present** | Franchise-agnostic packs + 9-tab Studio, multi-campaign (`js/05`,`js/62`). |
| Per-player secrecy | **Partial** | `get-content` edge fn + `players`/`campaign_content` migrations + de-baked bundle exist, but client path is **flag-gated/default-off**; live deploy unverifiable from source (`js/55:230-383`, `supabase/`). |
| Wiki / encyclopedia | **Missing** | Codex + roster partially cover it; no free-form page tree / no `wiki` key. |
| Route-blocking | **Missing (scaffolded)** | State synced (`route-blocks`), but **no UI, no rendering, no routing enforcement** (`js/10:1236-1245`). |
| Player speculative-trade planner | **Missing** | Only reserved `cargoHold`/`broker` fields (`js/75:66-67`). |
| Handouts / media push | **Missing** | Only splash text + portraits; no image/document/clue push. |
| Audio / ambience | **Missing** | Combat WebAudio synth only; no ambient music/soundboard. |
| Scheduling / attendance / downtime | **Missing** | None. |
| Player personal journal | **Missing** | `note-private-*` exists as generic notes, but no journal UI. |

**Maintenance flag (verified):** `node tools/strip-secrets.mjs --check` currently
**aborts (exit 2)** — its fail-closed coverage guard trips on `PACK_DEFAULTS`
(a `refNote:` *label* key, false positive) and `CORP_CONTRACT` (`js/85:769`). The
de-bake can't be safely re-run until the REDACT/NON_SECRET classification is extended.
This blocks any future content re-strip and is a latent secrecy risk.

---

## 3. Comparator landscape (brief)

Grouped by what problem each solves; closest philosophical relatives first.

- **D&D Beyond (companion-first):** character builder/leveling, searchable rules+gear
  **compendium**, homebrew builder, campaign linking, encounter/initiative tracker,
  digital dice as an *optional* aid. Lesson: the compendium + character continuity are
  its spine; dice are opt-in, not the point.
- **Owlbear Rodeo (table-first VTT):** dead-simple shared map + tokens + fog + measure,
  handout/asset push, minimal automation. Lesson: a *shared glanceable surface* with
  almost no rules engine — the model for a shared initiative/red-alert board.
- **World Anvil / Kanka / LegendKeeper (campaign wikis):** article trees, timelines,
  relationship maps, **secret/GM-only layers**, cross-links. Lesson: lore continuity +
  per-audience secrecy — Aurelia's Codex is a narrower, better-integrated version.
- **Traveller Map (travellermap.com):** sector data, UWP, **jump-route plotting**.
  Lesson: Aurelia's HX planner already matches/exceeds this for the campaign's bespoke
  space (fuel, stranding, executable jumps) — a genuine strength.
- **Fantasy Grounds (has an official MgT2e ruleset):** full ship-combat + trade
  automation + char-gen lifepath. Lesson: mine for *Traveller data shapes* (trade
  DMs, ship stats), but its automation-first stance is the opposite of this brief.
- **Roll20 / Foundry (full VTTs):** grid tactical combat, LoS/fog, dynamic lighting,
  dice macros, audio mixers, marketplace. Mine carefully; most is anti-feature here.
- **Demiplane / Alchemy RPG:** Nexus rules content (Demiplane) and cinematic
  scene/handout + ambience presentation (Alchemy). Lesson: Alchemy's *scene presets*
  (background + ambience as one referee-triggered beat) is the tasteful ceiling for
  in-app atmosphere.

---

## 4. Gap-analysis table

Philosophy fit: **Core** = fits companion model as-is · **Adapt** = valuable only if
reshaped to support (not replace) table play · **Reject** = pulls the game onto the screen.

| Feature | Common in | Status in Aurelia (verified) | Fit | Value | Effort |
|---|---|---|---|---|---|
| Shared/synced initiative & health board | DDB, Owlbear, all VTTs | **Partial** (referee-local, unsynced `js/45`) | **Adapt** (glanceable shared display, manual) | H | S |
| Route-blocking (nav intel) | Traveller Map, Foundry | **Missing (scaffolded)** `js/10:1236` | **Core** | M | S |
| Player-submitted rumours (Codex `pending`) | World Anvil, Kanka | **Missing** (3 states only) | **Core** | M | S |
| Saved session journal (persist recaps) | DDB, World Anvil, Kanka | **Partial** (ephemeral recap `js/92`) | **Core** | H | S–M |
| Referee-facilitated trade helper | Fantasy Grounds, TravellerMap tools | **Missing** (`js/75:66` reserved) | **Adapt** (referee suggests, table rolls) | H | M |
| Equipment / gear reference (seed catalogue) | DDB, Demiplane, FG | **Missing** (catalogue ships empty `js/60`) | **Adapt** (reference cards, licensing-gated) | H | M |
| App-generated printable char/ship sheet | DDB, all VTTs | **Missing** (static PDF only) | **Core** | M | M |
| Handout / evidence push to players | Owlbear, Roll20, Foundry | **Missing** (splash+portraits only) | **Adapt** (per-player-gated push) | M | M |
| Referee-curated wiki / lore pages | World Anvil, Kanka, LK | **Missing** (Codex partial) | **Adapt** (ref-only V2) | M | M |
| Downtime / between-jump actions log | DDB, PF2e tools | **Missing** | **Adapt** (log→referee resolves) | M | M |
| Relationship / faction map | World Anvil, Kanka | **Partial** (reputation, no graph) | **Adapt** | M | M |
| Character creation / term-history | DDB, FG | **Missing** | **Adapt** (record terms, not auto-gen) | M | L |
| Scene ambience presets | Alchemy, Foundry, Roll20 | **Missing** (combat synth only) | **Adapt** (simple room-speaker beats) | L | M |
| Scheduling / attendance | DDB, most VTTs | **Missing** | **Reject** (fixed in-person group) | L | S |
| Character sheets | DDB, all | **Present** `js/60` | Core | — | — |
| Grid inventory + encumbrance | DDB, FG | **Present** `js/60` | Core | — | — |
| Jump/fuel route planner | Traveller Map | **Present (strong)** `js/10` | Core | — | — |
| Codex fog-of-knowledge + secrets | World Anvil, Kanka | **Present** `js/85` | Core | — | — |
| Reputation / funds / quests / NPC dossiers | World Anvil, DDB | **Present** `js/85` | Core | — | — |
| Living economy sim | (unique) | **Present** `js/90` | Core (ref-side) | — | — |
| Offline / PWA resilience | few | **Present (strong)** `js/50`,`sw.js` | Core | — | — |
| Space **ship-combat** rules engine | FG, Foundry, Roll20 | **Present** `js/80` | **Adapt/Contain** (see §7) | — | — |
| Grid+token tactical combat, LoS, fog | Roll20, Foundry, FG | **Missing** | **Reject** | — | — |
| Dice macros / default player dice roller | all VTTs | **Missing** | **Reject** (in-person; fallback only) | — | — |
| Built-in voice/video | Roll20, Foundry | **Missing** | **Reject** | — | — |

---

## 5. Feature recommendation briefs (top 10, ranked)

Each brief: problem → who/when → companion-mode design → Traveller fidelity →
implementation sketch (existing stack) → MVP vs full → risks. All sketches obey the
**house rules**: append to an existing `js/` module (never add a css/js file — that
forces `sw.js` `SHELL[]` + `CACHE` bump + `build-local.mjs` count edits); one shared
`supaStorage` key; player poll wired in `js/55`; honour-gate with
`isReferee()`/`canSee()`/`myIdentity`; reuse UI idioms (`makePanelDraggable`, `sf-*`
ship fields, `cat-*` catalogue fields, `.rep-meter`/`.fund-card`/`.quest-status-badge`,
`css/tokens.css`); avoid reserved literal keys (`npcs/checks/refnotes/refNote/rsr/
events/hook`) so `strip-secrets.mjs` doesn't fail closed.

### 5.1 Shared, synced Initiative & Health board  ·  Tier 1  ·  H value / S effort
- **Problem:** at-table — the initiative tracker is referee-local (`aurelia_combatants`
  in localStorage, `js/45`), so players can't glance at turn order or their own damage;
  the referee is the only one who can see the board. (Q1/Q2)
- **Who/when:** all three, every combat/skill-challenge scene.
- **Companion design:** promote the board to a **shared, synced** view that lands on
  **each player's own phone/tablet** (Q2 — no single TV) plus the referee's laptop/iPad
  — order + condition + who's up, driven **manually by the referee**. No roll automation
  added; the existing 2D6 initiative roll stays a referee convenience. A player glances
  at their own device for "am I up / my condition," then eyes go back to the table.
- **Traveller fidelity:** keep the DEX/INT initiative DM and the STR-0=dead /
  DEX+END-0=downed health model already coded (`js/45:126-174`).
- **Sketch:** move `combatants` from localStorage to shared KV key **`initiative`**
  via `supaStorage.set('initiative',…,true)`; add a `res.ok`-gated read to the poll
  block in `js/55` (mirror `quest-log` at `js/55:541-552`); gate writes to
  `isReferee()`. Reuse the panel chrome and health-bar CSS already in `js/45`. Add a
  read-only "presentation" size toggle for the shared screen.
- **MVP:** shared read-only board + referee edits sync. **Full:** per-player highlight
  when it's their turn (reuse `.as-rhett`/`.as-cass` body-class path), unread pulse.
- **Risks:** low. Last-write-wins is fine (referee is sole writer). Don't let it grow
  toward token movement — order/condition only.

### 5.2 Finish Route-Blocking  ·  Tier 1  ·  M value / S effort
- **Problem:** prep + at-table nav — `route-blocks` state already syncs but nothing
  reads it: no create UI, no lane rendering, no routing effect (`js/10:1236-1245`). A
  half-built feature is dead weight.
- **Who/when:** referee sets; Rhett/Cass (nav crew) see it during jump planning.
- **Companion design:** referee toggles a lane closed (hard/story) with an optional
  reason; auto-advisory (amber) derives from `shipState.jumpRating`/`fuel` with no
  stored state. A `enabled` kill-switch neutralizes all blocks instantly. Exactly the
  model in `docs/phase-2-feasibility-study.md §5`.
- **Traveller fidelity:** reasons map to interdiction / jump-rating / fuel; nav-crew
  audience = `SHIP_NAV_AUDIENCE` (`js/75:16`).
- **Sketch:** the storage/poll already exist. Add (a) a referee toggle in the existing
  "Design — Jump Lanes" panel (`js/10:2035-2040`) keyed by `gxLaneKey(a,b)`;
  (b) dashed-red/amber rendering in `gxRenderLanes()`; (c) an optional advisory read in
  `bestRoute()`/`fuelPlan()` (advisory only — never hard-block the planner). All in
  `js/10`.
- **MVP:** manual hard blocks + rendering + kill-switch. **Full:** amber auto-advisory
  + `explain:false` fog lever.
- **Risks:** low. Keep advisory blocks non-authoritative so the planner never lies.

### 5.3 Player-submitted rumours — Codex `pending` state  ·  Tier 1  ·  M value / S effort
- **Problem:** between-session + player agency — players can't feed the Codex; only the
  referee authors entries. The feasibility study calls this "the only genuinely new
  sub-feature" (`docs/phase-2-feasibility-study.md §3`). (Q4)
- **Who/when:** Rhett/Cass submit; referee approves/rejects. Low frequency, high buy-in.
- **Companion design:** a "+ Submit rumour" affordance (title/body/category, no
  visibility controls). Author sees "Awaiting Referee"; others see nothing; referee
  gets ✓/✕. Approve = set `state:'hidden'|'rumoured'`; reject = delete.
- **Traveller fidelity:** reveal stamps continue to use `imperialNow()`.
- **Sketch:** add one enum value `pending` + `submittedBy: myIdentity` to the existing
  `discovery-log` entries (`js/85:216-355`). No new key. Extend `discViewerStage` and
  `renderDiscCard` for the pending case; reuse the existing CRUD path.
- **MVP:** submit + approve/reject. **Full:** reveal-beat pulse on state rise (reuse
  `is-revealed` palette) + Codex unread count.
- **Risks:** low; honour-system submission is acceptable (same as notes).

### 5.4 Saved session journal (persist the recaps)  ·  Tier 1–2  ·  H value / S–M effort
- **Problem:** between-session continuity — `generateSessionRecap()` builds a great
  narrative recap but it is **ephemeral** (rendered, exported to clipboard, then gone
  `js/92:288-334`). Nothing carries "what happened last time" into the next session for
  Rhett/Cass. (Q1)
- **Who/when:** referee saves at end of session; all read before the next.
- **Companion design:** a dated, browsable, **player-visible** session log. Referee
  clicks "Save recap" → stores the generated text (editable) as a dated entry; players
  see a "Previously on Archon Gambit…" list on load. Keeps continuity off the referee's
  memory and out of a separate doc.
- **Traveller fidelity:** date each entry with the Imperial calendar (`imperialNow()`).
- **Sketch:** new shared key **`session-log`** (array of `{id, date, imperialDate,
  title, body, visibleTo}`); write in `js/92` next to `generateSessionRecap`; add a
  poll read in `js/55`; render in a floating panel (reuse `makePanelDraggable`).
  Optionally seed each entry from the recap generator so it's one click.
- **MVP:** save + list + read. **Full:** per-player "since last session" digest
  (see §6 original features), edit history like the wiki's `history[]`.
- **Risks:** low. Watch scope — it's a journal, not a wiki.

### 5.5 Referee-facilitated trade helper  ·  Tier 2  ·  H value / M effort
- **Problem:** at-table + between-jumps — Traveller trade is a core loop you play, and it
  is **facilitated by the referee** (confirmed). The economy sim is already referee-side;
  what's missing is a fast referee-facing "what's the trade here" readout plus a shared
  **cargo manifest** everyone can see. Reserved `cargoHold`/`broker` fields
  (`js/75:66-67`) show the intent. (Q1)
- **Who/when:** referee runs it (players participate through the referee), at trade stops
  and jump planning.
- **Companion design:** a **referee helper, not a resolver.** In the referee's economy
  console, for the party's current/destination world it surfaces live prices plus
  *suggested* MgT2e Speculative-Trade DMs and lot sizes; the referee reads out the options
  and the **actual broker/streetwise/admin checks are rolled at the table.** A small
  **shared cargo manifest** (what the party hauls, bought-at price, tonnage) is
  player-visible so everyone tracks the speculative position — but only the referee edits
  it. Output is "here's the play + here's your hold," never "you earned Cr X."
- **Traveller fidelity:** MgT2e Speculative Trade — purchase/sale DMs from trade codes,
  supplier/broker DMs, lot tonnage in dtons; reads live prices from `ECON`
  (`mktPressure`/`pressure` `js/90:6-9`) and world trade codes from `HX.worldFacts()`.
- **Sketch:** extend the **referee** economy console (`js/90`) with a per-world
  trade-suggestion readout (it already computes prices + has the `econApplyRun` nudge
  `js/90:1579`). Add one shared key **`trade-cargo`** (`{lots:[{good, tons, boughtAt,
  world, imperialDate}]}`) written by the referee, **read-only** to players via the poll
  (`js/55`), surfaced next to Funds (reuse `.fund-card`). No player write surface needed —
  simpler than a self-service planner.
- **MVP:** referee per-world price + suggested DMs + shared read-only manifest. **Full:**
  a completed sale calls `econApplyRun` so the party's haul actually moves the market.
- **Risks:** keep dice on the table (the app suggests, the referee adjudicates); don't
  auto-credit funds.

### 5.6 Rules & gear reference — page-citations + BYO-rulebook (licensing-safe)  ·  Tier 1–2  ·  H value / M–L effort
- **Problem:** at-table lookups (a confirmed top pain, Q1) — the item catalogue ships
  **empty**, quick-ref has **no gear** (`js/60`,`js/92`), so gear stats and rules are a
  book flip mid-scene.
- **Who/when:** all, constantly (shopping, combat prep, salvage, "how does X work?").
- **Licensing frame (Q5):** the repo must stay **free of copyrighted Mongoose content**
  so it can go open source. So content is layered by sensitivity, and the *book itself*
  is brought by the referee, never shipped:
  1. **Structured gear catalogue (data).** Each group hand-enters (or imports) the gear
     it uses → feeds the existing inventory add-from-catalogue. User data = clean; repo
     ships empty. *(Tier 1 — content only.)*
  2. **Page-citation / "where to look" index.** A map from rules topics & gear
     categories → **book + page** ("Autopistol → Core Rulebook p.116"). Page refs are
     facts, not copyrightable expression → open-source-safe. Shown as searchable cards
     next to quick-ref; deep-links into an uploaded PDF when present. *(Tier 1–2.)*
  3. **BYO-rulebook upload (private).** The referee uploads their **legally-owned PDF**;
     stored **privately, per-campaign**, viewable/searchable in-app on any device, and a
     citation can **jump to the page**. Content is user-supplied and never redistributed
     → clean for private use *and* an open-source codebase. *(Tier 2–3.)*
- **Companion design:** reference-first and fast — look up, then eyes back to the table.
  The BYO PDF is "your book, on the device already in your hand." Shopping/buying is still
  narrated at the table; the app only informs.
- **Traveller fidelity:** MgT2e equipment fields already modeled in the catalogue schema
  (`docs/inventory-phase-0-audit.md §3.1`); the citation index is **per Campaign Pack**
  (each pack cites its own book), fitting the franchise-agnostic engine.
- **Sketch:**
  - Layer 1: seed `item-catalogue` (schema+CRUD+add-from-catalogue already in `js/60`);
    optional CSV/paste import.
  - Layer 2: store the citation map in the **Campaign Pack config** (authored in Campaign
    Studio, `js/62`) or a shared `rules-index` key; render searchable cards in `js/92`
    beside the existing quick-ref.
  - Layer 3: a **private Storage bucket** for rulebook PDFs (mirror the `portraits`
    bucket + a bucket-scoped policy migration like `0002`), gated to the campaign; a
    PDF.js viewer panel; wire upload into the **setup wizard / Campaign Studio** — the
    natural "new referee onboards their book" moment (connects to the unwired
    `setup_prototype.html`). ⚠️ Keep uploaded books strictly out of the public shell and
    the open-source repo.
- **MVP:** Layer 1 + Layer 2 (hand-entered gear + page-citation cards + link-out).
  **Full:** Layer 3 (BYO PDF upload, in-app viewer, citation → jump-to-page).
- **Risks:** PDF storage size/perf; **privacy** (uploaded books must never reach a
  non-campaign device or the repo); scope — Layer 3 is the big piece, so ship 1–2 first.

### 5.7 App-generated printable character & ship sheet  ·  Tier 2  ·  M value / M effort
- **Problem:** data portability + table backup — there is **no app-generated print
  path** (`window.print`/`@media print` absent; only a static `Ship Sheet…pdf`). Players
  can't take a paper sheet or print for a wifi-out session.
- **Who/when:** all, occasionally (new sheet, backup, wifi failure).
- **Companion design:** a "Print" button that opens a clean `@media print` layout of the
  sheet/ship from live state. Pure output; heads-up (it's paper).
- **Traveller fidelity:** mirror the printed MgT2e sheet layout the app already imitates
  (`sf-*`).
- **Sketch:** add a `@media print` block to `css/app.css` (editing existing css is fine)
  + a print-view builder in `js/60` (sheet) / `js/75` (ship). No new files.
- **MVP:** character sheet print. **Full:** ship sheet + party summary.
- **Risks:** low; CSS print quirks only.

### 5.8 Handout / evidence push to players  ·  Tier 2  ·  M value / M effort
- **Problem:** at-table — the referee can't push an image/clue/document to player
  devices or the shared screen; only splash text + portraits exist.
- **Who/when:** referee reveals; players receive. Per scene.
- **Companion design:** referee uploads/selects a handout and pushes it to `all`, the
  shared screen, or a single player (per-player secret). Reuses audience gating so a
  clue can go to one PC. Owlbear-style, minimal.
- **Traveller fidelity:** n/a (presentation).
- **Sketch:** reuse the **`portraits`** Storage bucket pattern (`js/50:82-99`, migration
  `0002`) for a `handouts` bucket (⚠️ needs a bucket-scoped anon policy migration like
  `0002`), or store small images as data-URLs in a `handouts` KV entry with
  `visibleTo`. Poll-synced; render in a lightbox panel. Lives in `js/85`/`js/92`.
- **MVP:** referee push one image to all + lightbox. **Full:** per-player targeting,
  a small "evidence board" grid.
- **Risks:** storage/policy migration; keep image sizes bounded (reuse the 512px resize
  from portraits).

### 5.9 Referee-curated wiki / lore pages  ·  Tier 3  ·  M value / M effort
- **Problem:** between-session — lore lives in the Codex (entry cards) and NPC roster,
  but there's no long-form, cross-linked article space (World Anvil/Kanka niche).
- **Companion design:** **referee-only V2** (per `docs/phase-2-feasibility-study.md §4`):
  markdown-lite articles, `visibleTo` gating, first-class links to systems (`GALAXY_NODES`
  ids) and Codex entries, versioned-lite (`history[]` of `{at,by,summary}`). Player
  editing deferred to V3 (reuse the Codex pending pattern, not live editing).
- **Sketch:** new shared key **`wiki`**; render/edit in a panel; link resolver reuses
  `HX.selectById` + Codex open. Append to `js/85`.
- **MVP:** ref-only articles + links + read gating. **Full:** player-pending contributions.
- **Risks:** scope creep (moderation/abuse) — that's exactly why it's ref-only first.

### 5.10 Downtime / between-jump actions log  ·  Tier 3  ·  M value / M effort
- **Problem:** between-session — jumps take ~1 week (the calendar already advances), but
  there's no place for players to declare downtime (training, repairs, contacts, cargo)
  and for the referee to resolve it.
- **Companion design:** players log an intended downtime action per jump; referee marks
  outcomes. Log→resolve, **never auto-resolved** (Traveller training is time-based, not
  XP — model *weeks studied*, not points).
- **Traveller fidelity:** tie to the imperial calendar + jump events; skills improve via
  study/training time (MgT2e), so track weeks, not XP.
- **Sketch:** new shared key **`downtime`** keyed by identity + jump date; render in the
  ship/records area; honour-gate players to their own. Append to `js/85`.
- **MVP:** log + referee resolve. **Full:** training-week counters per skill.
- **Risks:** low; keep it a ledger, not a rules engine.

---

## 6. Original features worth considering (comparators lack these)

Tailored to a Traveller, star-map-centric, small-group, dark-sci-fi campaign. Evaluate,
don't auto-adopt.

- **Ship's Log / in-fiction travel log (Tier 1–2, S):** `executeJump` already appends a
  `jumpLog` entry (`js/10:1876-1889`). Surface it as a shared, narrative, dated **ship's
  log** on the map — origin→destination, fuel burned, weeks elapsed, events fired. Near-
  free continuity artifact unique to this app's jump engine.
- **"Since last session" digest (Tier 2, M):** the poll already diffs shared state. On
  load, show each player a personalized digest of what changed since they last opened
  (new reveals, funds, quest updates, calendar advance). Turns the sync layer into a
  continuity feature no comparator has this cheaply.
- **Rumor/Job board (Tier 2, S–M):** the Oracle already drafts rumours + corp contracts
  and can push to Codex/Quest (`js/85:863-910`). Add a lightweight, player-readable
  **board** the referee seeds — bridges Oracle→player-facing hooks without new engine.
- **Contact/faction dossier with referee-secret layers (Tier 3, M):** extend `npc-roster`
  with per-identity secret layers (what each PC knows about a contact) + relationship
  links to factions/reputation. A Traveller-flavored, secrecy-aware relationship map.
- **Nav-crew saved flight plan (Tier 1, S):** the HX planner computes routes but doesn't
  persist a chosen plan for the nav players to consult between sessions. Save the current
  plan to `shipState` and show it read-only to `SHIP_NAV_AUDIENCE`.

---

## 7. Prioritized roadmap + anti-feature list

**Cadence (Q7 ~1 week/month → ~2–4 features/cycle; both pains confirmed, so pair a
continuity item with a lookup item each cycle).**

### Tier 1 — first cycle (hours each; high value; reuse shipped patterns)
1. **Shared/synced initiative & health board** (§5.1) — move `js/45` to shared KV + poll;
   lands on each player's own device (Q2).
2. **Saved session journal** (§5.4) — persist the existing recap *(continuity, Q1)*.
3. **Rules & gear reference, Layers 1–2** (§5.6) — seed `item-catalogue` + page-citation
   cards *(lookups, Q1)*.
4. **Player-submitted rumours** (§5.3) — one `pending` enum in the Codex.
5. **Finish route-blocking** (§5.2) — wire the shipped `route-blocks` scaffolding.
6. **Ship's log + saved flight plan** (§6); **fix `strip-secrets.mjs`** coverage guard
   (`PACK_DEFAULTS` label + `CORP_CONTRACT`) — unblocks safe de-bake / open-sourcing.

### Tier 2 — next cycles (a few days each; well within a week/month)
7. **Rules reference Layer 3 — BYO-rulebook upload + PDF viewer** (§5.6) — *the headline
   lookup feature; wire into the setup wizard / Campaign Studio.*
8. **"Since last session" digest** (§6) *(continuity)*.
9. **Referee-facilitated trade helper** (§5.5) — reads ECON; suggests, never resolves.
10. **Printable char/ship sheet** (§5.7) — `@media print`.
11. **Handout/evidence push** (§5.8) — reuse the portraits-bucket pattern.

### Tier 3 — later / conditional
12. **Referee-curated wiki** (§5.9) — if lore outgrows the Codex.
13. **Downtime actions log** (§5.10) — if downtime is part of play.
14. **Contact/faction dossier secret layers + relationship map** (§6).
15. **Scene ambience presets** (Q6) — low priority.
16. **Complete per-player secrecy** (deploy/verify `get-content`; enable the flag-gated
    client path) — a documented multi-day migration (`docs/per-player-redaction-plan.md`).
    **The open-source path makes this more urgent:** an open repo publishes the
    honour-system bypass, so real secrecy should land before/with open-sourcing.

### Anti-features — deliberately excluded (one-line rationale each)
- **Grid+token tactical combat, movement, line-of-sight** — pulls eyes down; position is
  theater-of-the-mind at the table.
- **Fog of war on tactical maps** — same; the Codex is the app's "fog," for *knowledge*.
- **Default player dice roller / rules-engine macros** — dice happen on the table; only a
  narrow **absent-player fallback** roller (Q3) is ever justified, never the default.
- **Automated personal combat resolution** — resolved in person.
- **Built-in voice/video** — the group is in the same room.
- **Full audio mixing console** — overkill; at most simple scene-ambience beats (Tier 3).
- **Scheduling/attendance/calendar invites** — a fixed 3-person in-person game doesn't
  need it.
- **⚠️ Contain (don't expand) the existing space-combat engine (~90% done — kept):** it
  is the one shipped feature that crosses the "don't automate rules" line, in its
  least-bad form (referee-authoritative, players read-only). **Keep it referee-driven; do
  NOT extend it into per-player tactical control, personal/ground combat, or player
  dice.** Treat future work as presentation polish + the finishing 10%, not deeper
  automation. Specific reconsiderations are in §7.1.

---

### 7.1 Space-combat reconsiderations (deferred — after the roadmap phases)

The engine is ~90% done and stays. These are containment/refinement, ranked; none is a
rebuild:

1. **Per-stat fog** (the audit's own open item, `docs/phase-3-combat-audit.md §6`). Reveal
   is whole-ship today; add "reveal that a contact exists but hide its loadout/stats," so
   the referee can show a blip without leaking capabilities. Small, high narrative value.
2. **Heads-up guardrail on player devices (Q2 — no shared TV).** Radar + FX shine on the
   *referee's* screen, but on each player's phone they pull eyes down mid-scene. Default
   players to a **minimal glanceable state** (whose turn · range band · my hull/alert)
   with radar/FX **off or opt-in**; keep the full spectacle on the referee's screen so
   drama stays in narration.
3. **Hold the line at ship combat.** Keep personal/ground combat theatre-of-the-mind — no
   tokens/grid/personal-initiative automation beyond the existing referee tracker. Make
   the boundary explicit in code/docs so scope doesn't creep.
4. **Tunables confirmation pass (part of the last 10%).** The engine flags
   interpretation-dependent DMs in `MGT2E.tunables` + `COMBAT_HAZARDS` for referee
   confirmation (`js/80:207-238`); do a one-time "make these numbers yours" settings pass.
5. **Optional quick-resolve path.** For minor skirmishes, let the referee set an outcome +
   damage without stepping every phase, so a small fight isn't a 20-minute screen session.
6. **Preserve referee-only mutation / no player dice.** If an absent player's gunner ever
   needs covering, make it an explicit fallback, never the default.

---

## 8. Open questions & suggested next steps

**Open questions (Q1–Q7 + combat + trade now answered; these remain):**
- **Open-source split:** when you open-source, the plan for (a) the live `SUPABASE_KEY`
  baked in the bundle, (b) Archon Gambit *setting* content vs. an empty starter pack, and
  (c) keeping uploaded rulebooks out of the repo. (The Campaign-Pack engine already makes
  an "empty starter pack" clean.)
- **Rulebook PDFs (§5.6 L3):** acceptable storage size/host — Supabase Storage bucket vs.
  device-local IndexedDB? Per-campaign privacy policy?
- **Is `get-content` deployed live today?** (Unverifiable from source; sets whether
  secrecy is honour-system or enforced right now.)

**Build order (Tier-1 first cycle):** saved session journal (continuity) and rules & gear
reference Layers 1–2 (lookups) first, then synced initiative and route-blocking, plus the
`strip-secrets.mjs` guard fix — one commit each, verified per §9.

---

## 9. Implementation notes & verification (for the Tier-1 slice)

**Critical files (Tier 1):**
- `js/45-initiative.js` — swap localStorage `combatants` for shared KV `initiative`.
- `js/55-auth-gating.js` — add poll reads for `initiative` and `session-log` (mirror the
  `quest-log` block at `js/55:541-552`).
- `js/10-galaxy.js` — route-block toggle UI (near `:2035-2040`), lane rendering in
  `gxRenderLanes()`, advisory read in `bestRoute()`/`fuelPlan()`.
- `js/85-records.js` — Codex `pending` state in `discViewerStage`/`renderDiscCard`
  (`:233-355`); ship's-log panel.
- `js/92-tools-misc.js` — "Save recap" → `session-log` next to `generateSessionRecap`
  (`:288-334`).
- `tools/strip-secrets.mjs` — extend REDACT/NON_SECRET classification (guard `:106-131`).

**House rules to honor (from `docs/ARCHITECTURE.md`):**
- Do **not** add a new `js`/`css` file (append to existing modules) — else update
  `sw.js` `SHELL[]` + bump `CACHE`, and the count assert in `tools/build-local.mjs`.
- One `supaStorage` key per feature; writes gated by `isReferee()` (or `myIdentity` for
  player-owned), reads `res.ok`-gated in the poll so a failed fetch never wipes UI.
- Avoid reserved literal keys (`npcs/checks/refnotes/refNote/rsr/events/hook`) in any
  new top-level data literal, or `strip-secrets.mjs` fails closed.

**Verification (end-to-end; the bundle carries a live key and writes the live
`aurelia_state`, so test on a scratch campaign or player-mode device — do not mutate live
referee state):**
1. `node --check` each edited `js/` file; run `node tools/verify-split.mjs` gates if the
   split invariants are touched.
2. Serve the folder over HTTP; boot to the access gate with no console errors / no 404s.
3. **Initiative board:** referee edits order/health on one device → appears on a second
   (player-mode) device within one poll (~4s). Player sees read-only; referee edits sync.
4. **Route-blocking:** referee closes a lane → dashed-red renders for nav-crew on poll;
   kill-switch off → blocks vanish; planner still routes (advisory, non-blocking).
5. **Codex pending:** player submits a rumour → author sees "Awaiting Referee," referee
   sees ✓/✕, others see nothing; approve → normal fog cycle resumes.
6. **Session journal:** referee saves a recap → dated entry appears; second device sees it
   on poll; visibility gating respected.
7. Run `node tools/strip-secrets.mjs --check` → exits 0 (no longer aborts) after the
   classification fix.

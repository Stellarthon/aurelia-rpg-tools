# Archon Gambit — Phase 2 Feasibility Study & Design Brief

> **Historical — point-in-time study.** Feasibility brief for work that has since largely shipped; references to a single ~12k-line `index.html` predate the css/js split. See [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`codebase-audit-2026-07-13.md`](codebase-audit-2026-07-13.md) for current state.

> Companion app for a Traveller campaign set in the Orion Arm. Single-file
> build (`index.html`, ~12k lines), Supabase-backed shared state
> (`aurelia_state` key/value rows), 4-second player poll loop.
>
> This study assesses the **remaining unbuilt features** against what the
> codebase *actually* contains today. Several features assumed to be greenfield
> are already partly or fully built — that materially changes the roadmap.

---

## 1. Executive Summary

The remaining feature set is **lower risk than the brief implies**, because the
two hardest pieces of plumbing already exist and are battle-tested in
production code:

1. **A working three-tier permission model.** `isReferee()` + `myIdentity`
   (free-text, honor-system identity such as `"Rhett Calder"`) +
   `canSee(audience)` already gate content by `all` / `referee` /
   `[identity…]`. Audiences are mirrored onto `#root` as body-classes
   (`.as-rhett`, `.as-cass`, `.pm-active` → `.ref-only`). **No new permission
   primitive is required** for any Phase 2 feature; route blocking, inventory,
   search and wiki all compose from `canSee()`.

2. **A working "fog of knowledge" engine.** The Discovery Log / Codex
   (`discovery-log` shared key) already implements the exact
   hidden → rumoured → known state machine the brief asks us to design, with
   audience gating, Imperial-date reveal stamps, redacted bodies, and live
   poll propagation. The only genuinely new sub-feature is **player-submitted
   pending rumours**.

Against that backdrop, the outstanding work splits cleanly:

| Tier | Features |
|------|----------|
| **MVP-ready** (build now, no blockers) | Ship inventory panel, System search bar, Discovery Log player-rumour submission |
| **Near-term** (1 new shared key + UI, contained) | Route blocking, Referee-only wiki |
| **Long-term / separate phase** | Player-editable wiki, Space Combat branch |
| **Audit, not a feature** | Traveller alignment (largely cosmetic — the data model is already canon-faithful) |

Overall complexity is **moderate and front-loadable**. The single genuine
design risk is the wiki's scope if player editing is allowed early; the
recommendation is a Referee-only V2 wiki with player contribution deferred to
V3. Space combat must **not** be designed now, but the inventory schema we ship
in V2 must be combat-aware so it is not rearchitected later.

---

## 2. Feature Feasibility Table

| Feature | Complexity | Role-gate required | Traveller dependency | Phase | Key open questions |
|---|---|---|---|---|---|
| **Ship inventory panel** | Near-term (M) | Referee + Pilot (`SHIP_PILOT`) edit; nav crew (`SHIP_NAV_AUDIENCE`) view; ship vs. personal split | Cargo in **tons (dtons)**, not generic "qty"; TL on equipment | **V2** | Who can *modify* vs *view*? Does cargo mass feed the existing jump-fuel math? |
| **System search bar** | MVP-ready (S–M) | Inherits `canSee()` per result; referee sees all | None (reads existing data) | **V2** | Do fog entries appear as redacted stubs or stay invisible? (Ruling below) |
| **Discovery Log — reveal/fog core** | ✅ **Already built** | `canSee()` + `state` machine | Reveal stamps use Imperial calendar | Shipped | — |
| **Discovery Log — player rumour submission** | MVP-ready (S) | New `pending` state, author = `myIdentity`, referee approves | None | **V2** | Can any player submit, or nav-crew only? Auto-expire stale rumours? |
| **Route blocking** | Near-term (M) | **View: Rhett + Cass only**; set: Referee (+ optional auto-derive) | Block reasons map to jump rating / fuel / interdiction | **V2** | Manual vs. automatic? What explanation do players get? (Model below) |
| **Wiki — Referee-only** | Near-term (M) | Read: `canSee()`; create/edit: Referee | Articles can link to UWP systems & Codex entries | **V2** | Versioned or overwrite? (Ruling below) |
| **Wiki — player-editable** | Long-term (L) | Per-article edit ACL + moderation queue | — | **V3** | Moderation model; conflict resolution; abuse surface |
| **Space combat** | Separate phase (XL) | New combat-session role state | Deep: ship stats, crits, crew roles, range bands | **V3+** | Entire design (see checklist below) |
| **Traveller alignment audit** | Refactor (S, mostly cosmetic) | None | The point of the exercise | **V2 (rolling)** | Where do labels lie vs. where does schema lie? (Scope below) |

Complexity key: S ≈ <½ day, M ≈ 1–2 days, L ≈ multi-day, XL ≈ own project.

---

## 3. Discovery Log — Full "Fog of Knowledge" Specification

### 3.1 What already exists (do not rebuild)

The Codex panel (`discovery-log` shared key, 4s poll) stores entries:

```js
{ id, title, category, body, state, visibleTo, createdAt, revealedAt }
//   state ∈ 'hidden' | 'rumoured' | 'known'
//   visibleTo: 'all' | 'referee' | ['Rhett Calder', …]   (parsed by parseCalVis)
//   category ∈ lore | faction | location | tech | person
```

`discViewerStage(e)` resolves what the current viewer sees; the referee always
sees `known`. State transitions cycle `hidden → rumoured → known → hidden`
(`cycleDiscState`), and the **first** lift out of `hidden` stamps
`revealedAt = imperialNow()` so reveals plot on the campaign timeline.

### 3.2 The complete state machine (with the new `pending` state)

```
                 ┌──────────────────────────────── referee rejects ──────────┐
                 ▼                                                            │
 (player submit) PENDING ──referee approves──▶ HIDDEN ──▶ RUMOURED ──▶ KNOWN  │
                 │                              ▲           │            │    │
                 └──────────────────────────────┴───────────┴────────────┘────┘
                              (referee freely cycles these three)
```

| State | Who can create / move it | What the **Referee** sees | What a **gated player** sees |
|---|---|---|---|
| **pending** *(new)* | Player creates; referee approves/rejects | Highlighted "📥 Submitted by *Rhett Calder*" card with ✓ Approve / ✕ Reject | Author sees their own pending card marked "Awaiting Referee"; other players see nothing |
| **hidden** | Referee | Full entry, dimmed, `Hidden` badge | Nothing (filtered out entirely) |
| **rumoured** | Referee | Full entry, `Rumoured` badge | Title + category tag; **body redacted**: `▓▓▓ UNCONFIRMED — details unknown ▓▓▓` |
| **known** | Referee | Full entry, `Known` badge | Full title + body + `revealedAt` date |

Within `rumoured`/`known`, `canSee(visibleTo)` still applies — a known entry
scoped to `['Rhett Calder']` is invisible to Cass.

### 3.3 The reveal moment (UX)

Players already poll every 4s and re-render the Codex when `discovery-log`
changes. To make the reveal *feel* like a beat rather than a silent diff:

- On poll, diff incoming entries against the local copy. For any entry whose
  viewer-stage rose (`hidden→rumoured`, `rumoured→known`, or first-visible),
  flash the card (e.g. a one-shot gold border pulse, reuse the reveal-toggle
  green/`is-revealed` palette already in CSS) and bump the 🗂 Codex button's
  unread count.
- A known reveal scoped to a single player ("Rhett, you now recall…") lands
  only on that device — the body-class machinery already supports per-identity
  styling if we want a distinct treatment.

### 3.4 Player rumour submission — design

- A non-referee with an identity set gets a **"+ Submit rumour"** affordance in
  the Codex (title + body + category; no visibility/state controls).
- Submission writes `{ state:'pending', submittedBy: myIdentity, … }` to the
  shared key. **Open question to resolve before build:** *any* player vs.
  nav-crew only. Recommendation: any identified player may submit; referee is
  the sole approver.
- Referee approval simply sets `state:'hidden'` (or straight to `rumoured`) and
  clears `submittedBy`; rejection deletes the row. This reuses the existing CRUD
  path — no new storage key, only one new enum value and a submit form.

---

## 4. Wiki / Encyclopedia — Editorial Model & Permission Matrix

New shared key `wiki` (array of articles). Recommended V2 schema, designed so
player-editing in V3 is additive, not a migration:

```js
{
  id, title, slug, category, body /* markdown-lite */,
  visibleTo,                 // reuses canSee(): 'all' | 'referee' | [identity…]
  links: {                   // first-class cross-refs
    systems:  ['aurelia', …],      // GALAXY_NODES ids
    codex:    ['disc_…'],          // Discovery Log entry ids
  },
  editable: 'referee',       // V3: 'all' | [identity…]  (per-article ACL)
  history: [ { at, by, summary } ],   // append-only edit log
  updatedAt, updatedBy
}
```

### 4.1 Permission matrix

| Action | Referee | Player (identified) | Player (no identity) |
|---|---|---|---|
| **Read** article (`visibleTo:'all'`) | ✓ | ✓ | ✓ |
| **Read** article (`visibleTo:[Rhett]`) | ✓ | ✓ only if matches `myIdentity` | ✗ |
| **Create** article | ✓ | **V3 only** | ✗ |
| **Edit** article | ✓ | **V3 only**, if `editable` allows | ✗ |
| **Delete** article | ✓ | ✗ | ✗ |
| **Link** to system / Codex | ✓ | V3 (own edits) | ✗ |

### 4.2 Versioning ruling

**Versioned-lite, not full revision history.** The body is **overwritten in
place**, but every save appends a compact `{at, by, summary}` record to
`history`. Rationale: a TTRPG wiki needs an audit trail ("who changed the
Hegemony article and when") far more than it needs full document diffs, and
append-only metadata keeps the Supabase row small. Full per-revision snapshots
are a V3 concern that rides in if/when player editing arrives.

### 4.3 Scope guard

Player editing is the feature most likely to balloon (moderation, conflicts,
abuse, vandalism of revealed lore). **Ship V2 Referee-only.** This keeps the
wiki a curated "Referee's published canon" surface and lets us watch real usage
before opening authorship. Player contribution in V3 reuses the Codex's
already-proven *pending → approved* pattern rather than live editing.

---

## 5. Route Blocking — Trigger Model

**Audience: Rhett and Cass only** (this is navigation-crew intel — it reuses the
existing `SHIP_NAV_AUDIENCE = ['Rhett Calder','Cassia Velen']`). The galaxy map
already builds an undirected lane set (`GX_LANES`) from each node's
`connections[]`, rendered read-only by `gxRenderLanes()`.

### 5.1 Trigger model: **both — manual primary, automatic advisory**

| Mode | Source | Authority | Example |
|---|---|---|---|
| **Manual block** *(primary)* | Referee toggles a lane closed | Referee, mid-session | Hegemony interdiction, blockade, story gate |
| **Automatic advisory** *(derived, non-authoritative)* | Computed from `shipState` | System | Jump exceeds installed `jumpRating`; insufficient `fuel` for the hop |

The two are visually distinguished. Manual blocks are **hard** (story truth).
Automatic advisories are **soft** (the lane is reachable in principle but the
ship currently can't make it) — they read off existing `shipState.jumpRating`
and `shipState.fuel` and require no stored state at all.

### 5.2 Storage + kill-switch

New shared key `route-blocks`:

```js
{
  enabled: true,                      // ← the kill-switch
  blocks: {
    'aurelia|sol': { reason: 'Hegemony interdiction', explain: true },
    …                                 // keyed by gxLaneKey(a,b)
  }
}
```

- **Kill-switch** is `enabled`. Toggling it off makes every manual block
  inert instantly. Because players already poll `aurelia_state` every 4s and
  re-render, this satisfies "toggle mid-session without a page reload" with the
  existing machinery — no new mechanism needed.
- Keying by `gxLaneKey(a,b)` reuses the map's existing canonical lane key.

### 5.3 Rendering

- **Manual block:** lane drawn dashed red (reuse the `#d45050` "hidden/danger"
  colour already in the palette) with a small ✕/lock glyph at the midpoint.
- **Automatic advisory:** lane drawn dashed amber, no lock — "out of range on
  current fuel/jump."
- **Referee view:** every lane shows a click-to-toggle control + reason field.
- **Rhett/Cass view:** see the blocked styling. If `explain:true`, a tooltip
  shows the reason ("Hegemony interdiction"); if `explain:false`, they see only
  that the route is closed ("Route unavailable") with no cause — a deliberate
  fog lever for the referee.
- **All other players:** the route renders normally (blocking is nav-crew
  intel; non-nav players never knew the lane status either way).

---

## 6. Search Bar — Entity Scope & Fog-of-Knowledge Ruling

A single client-side search box on the galaxy map. All data already lives in
memory on every device, so search is **purely a render/filter problem** — no
backend.

### 6.1 Searchable entity types

| Entity | Source | Result action |
|---|---|---|
| Star systems / worlds | `GALAXY_NODES`, `SYSTEMS`, body UWP data | Select + centre node on map |
| Factions | `GALAXY_FACTIONS` | Highlight all member systems |
| NPCs | `npcs[]` on bodies/locations | Jump to containing location |
| Discovery Log entries | `discoveryLog` | Open Codex to entry |
| Wiki articles (when built) | `wiki` | Open article |

### 6.2 Fog-of-knowledge ruling

**Search is a *view*, so it obeys exactly the same `canSee()` / fog rules as the
panels it draws from. Search must never become a side-channel that leaks hidden
content.** Concretely:

| Underlying state | Appears in player search? |
|---|---|
| `hidden` Codex entry / unrevealed system / referee-scoped item | **No — fully invisible.** Not even a stub. |
| `rumoured` Codex entry | **Yes, as a redacted stub** — matches on **title only**, body is not indexed, result shows the same `▓▓▓ UNCONFIRMED` treatment. Searching a word that only appears in the hidden body returns nothing. |
| `known` / revealed / `all` | Yes, fully — title and body indexed. |
| Referee | Sees everything, always. |

This is the single most important interaction in Phase 2: **the search index for
players is built from the same filtered list the Codex/​map already render, not
from the raw arrays.** Build the Codex player-rumour work first (Section 3) so
search has a stable, fog-correct source to read from.

---

## 7. Space Combat — Dependency Checklist & Open Questions

**Not designed in this phase.** This is the groundwork only.

### 7.1 Dependency checklist (what combat would consume)

- [x] **Ship stats** — `shipState` exists (tonnage, `jumpRating`, `hullPoints`/`hullPointsMax`, fuel).
- [x] **Critical-hit model** — `shipState.crits` (per-system severity 0–6) and the hex-pip UI already exist.
- [x] **Crew roles** — `SHIP_PILOT`, `SHIP_NAV_AUDIENCE`; identity model in place. *(Combat needs Gunner / Engineer roles added.)*
- [ ] **Ship inventory** — **must be built first (V2)** and must carry weapon/ammo/mount data (see §9 combat-readiness).
- [x] **Route / position state** — flight plan (`origin`, `destination`, `jumpParsecs`) exists; map position derivable.
- [ ] **Weapon/turret loadout** — does not exist; depends on inventory schema.
- [ ] **Initiative / turn structure** — an initiative tracker exists for personal combat; ship combat ordering is unscoped.
- [ ] **Range bands & movement** — no spatial combat model exists.
- [ ] **Opponent/NPC ship statblocks** — no enemy-ship data structure exists.

### 7.2 Open design questions (answer before a combat feasibility study)

1. **Fidelity target:** full Traveller *High Guard* / *Mongoose 2e* ship combat,
   or an abstracted narrative resolution? This decides everything downstream.
2. **Spatial model:** range bands (Adjacent…Distant) vs. hex grid vs. abstract?
3. **Turn economy:** who acts when — per-crew-role actions per round, or one
   ship action? How does it map onto the identity/role model?
4. **Shared combat state:** combat is high-frequency; is the 4s poll fast
   enough, or does combat need a faster channel / referee-driven step-through?
5. **Damage → existing crits:** does combat damage write directly into
   `shipState.crits`, making combat the producer for the crit UI that today is
   only referee-set?
6. **Enemy ships:** authored statblocks, generated, or referee-improvised?
7. **Inventory coupling:** ammo/missile consumption — does it decrement ship
   inventory live?

---

## 8. Traveller Alignment — Audit Scope & Approach

**Headline finding: the data model is already substantially canon-faithful.**
This is an audit and a few relabels, **not** a schema rebuild.

### 8.1 Already canonical (leave alone)

- **World profiles use UWP** (`uwpString`, e.g. `B867976-C`) — the correct
  Traveller term and format, with starport class, size/atmo/hydro/pop/gov/law,
  and TL. Trade codes are derived and displayed (`.body-uwp-trade`). Random
  UWP generation exists.
- **Character profiles use the UPP characteristics** STR/DEX/END/INT/EDU/SOC.
- **Jump / drives:** `jumpRating`, `jumpParsecs`, tonnage in tons, fuel in tons
  — all canon.
- **Reputation** uses the Traveller reaction scale (−6…+6).
- **Ship critical-hit systems** match the standard system list.

### 8.2 Watch-outs (the audit's real job)

1. **UPP vs. UWP terminology.** The brief asks to align to "UPP, jump
   classifications, trade codes, world profiles." Note **UPP = Universal
   *Personality* Profile (characters)**; **UWP = Universal *World* Profile
   (worlds)**. The app already uses UWP correctly for worlds — *do not* rename
   it to UPP. Flagging because the brief conflates the two.
2. **Cosmetic relabels (cheap):** any in-fiction faction/term that shadows a
   canonical Traveller label should be checked for consistency, but the
   campaign is a bespoke Orion-Arm setting — invented faction names (Hegemony,
   Sanhedrin, Archon Collective) are *intentional fiction*, not alignment
   debt. **Do not "correct" deliberate setting fiction toward canon.**
3. **Schema-touching (rare):** the only place alignment could force a schema
   change is if combat (V3) demands canonical ship weapon/USP notation — which
   is why the inventory schema (§9) should leave room for it now.

### 8.3 Approach

Treat alignment as a **rolling checklist applied during each V2 feature build**,
not a standalone milestone: when building inventory, use dtons; when building
search, index by UWP fields; when building the wiki, link to systems by their
canonical ids. Reserve actual schema changes for cases where a *mechanic* (not a
label) is wrong — none are currently identified outside future combat.

---

## 9. Phased Roadmap (V2 / V3)

### V2 — "Operations" (build now; no blockers, composes from existing primitives)

Recommended build order (dependency-sorted):

1. **Discovery Log — player rumour submission** *(+`pending` state)*. Smallest,
   and it stabilises the fog source that search will read.
2. **Ship inventory panel.** Combat-aware schema (below). Referee + Pilot edit;
   nav crew view.
3. **System search bar.** Reads the now-stable fog-filtered lists; enforces the
   §6 ruling.
4. **Route blocking.** New `route-blocks` key + kill-switch; nav-crew audience;
   manual + auto-advisory.
5. **Referee-only wiki.** New `wiki` key; linkable to systems & Codex; versioned-lite.
6. **Traveller alignment** — applied as a checklist *within* 1–5, not as a
   separate task.

**Ship vs. personal inventory ruling:** *personal* inventory already lives on
character sheets (`equipment`, `weapons` fields). *Ship* inventory is new shared
state (`ship-inventory` key) covering three categories:

```js
{ id, name,
  category: 'cargo' | 'equipment' | 'consumable',
  qtyTons,           // cargo in displacement tons (canon)
  qty,               // discrete count for equipment/consumables
  tl,                // tech level where relevant
  location,          // hold / locker / mounted
  notes,
  // ── combat-ready, dormant until V3 ──
  combat: { mount, weaponType, ammo } | null
}
```

The `combat` sub-object is the deliberate hook so Space Combat (V3) does **not**
require rearchitecting inventory. Cargo `qtyTons` can also feed the existing
jump-fuel/mass math.

### V3 — "Escalation" (deferred; needs its own scoping)

- **Player-editable wiki** (per-article ACL + pending/approve moderation reusing
  the Codex pattern; optional full revision history).
- **Space Combat branch** — its own feasibility study, gated on the §7 open
  questions and consuming the V2 inventory/ship/route foundations.

---

### Appendix — Grounding references (in `index.html`)

| System | Location |
|---|---|
| Permission model (`canSee`, `currentRole`, identity body-classes) | ~L6655–6683 |
| Discovery Log fog engine | ~L9740–9900 |
| Ship state schema + edit gating (`SHIP_PILOT`, `SHIP_NAV_AUDIENCE`) | ~L9147–9300 |
| Galaxy nodes, `connections[]`, `GX_LANES`, `gxRenderLanes()` | ~L2943–3360 |
| World UWP data + trade-code derivation | ~L172–189, L2851+ |
| Reputation (Traveller reaction scale) | ~L9902–9936 |
| Shared-state pattern + 4s poll | ~L6636–6822 |

# Archon Gambit — Phase 3: Space Combat (MgT2e core)

> Audit, decisions, and build plan for the space-combat module. Companion to
> `phase-2-feasibility-study.md`. Single-file build (`index.html`), Supabase
> single-key/value backend (`aurelia_state`), honour-system client-side gating.

---

## 1. Feasibility verdict

Faithful **MgT2e core** space combat is feasible on the current architecture,
with **one load-bearing caveat**:

The acceptance criterion *"role-gating … enforced at the data layer, not just
the UI"* is **not achievable** as written. "Supabase" here is a single
key/value table hit with one publishable key embedded in the page
(`index.html` ~L6525). RLS is blanket `USING (true)` / `WITH CHECK (true)` for
the public role — anyone with the page source can read/write every row. The app
already documents this: gating is spoiler control, not security. DB-enforced
secrecy with live sync would require Supabase Auth + per-identity JWTs + new
RLS — a re-architecture of the whole app, not the combat module.

**Resolution (decided):** combat is **referee-authoritative** with
**render-side fog**. Only the referee writes the `combat-encounter` row, and
the full encounter (including unrevealed ships) is stored there; the **player
client redacts on read** (`redactEncounterForPlayer`) so unrevealed ships, their
stats, ranges, in-flight missiles, and log lines never reach the player UI. This
is the *same honour-system exposure as the rest of the app* — a determined player
reading the raw row could see hidden data — not DB-enforced secrecy. True
secrecy (referee writes a redacted row + keeps full state in referee-local
storage) was considered and deliberately **not** implemented, to stay consistent
with the existing design pillar. (Audit decision, 2026-06-23.)

## 2. System audit (as found in code)

| System | Location | Notes |
|---|---|---|
| Shared state / sync | `index.html` ~L6620–6710 | One JSON blob per key; optimistic write + offline queue; last-write-wins; 4s poll. |
| Permission model | ~L6796–6828 | `isReferee()`, `myIdentity` (honour-system), `canSee(audience)` where audience ∈ `all`\|`referee`\|`[identity…]`. Render gating only. |
| Ship model (singleton) | ~L9363 (`shipState`) | One ship ("Archon Gambit"). Had: tonnage, jumpRating, hull pts, fuel, free-text armour, `crits{}` (11 systems, sev 0–6). **Not** a multi-instance template. |
| Red Alert | ~L9645–9775 | Shared `ship-alert-state`; auto-raises <25% hull; 1.5s fast poll. Combat damage feeds this. |
| Personal initiative tracker | ~L6125 (`combatants`) | 2D6+mod, DEX/INT tiebreak — but **localStorage-only**, not synced. Pattern to borrow, not extend. |
| Ship edit flow | `sfTextField`/`sfNumField` ~L9444 | Referee inline inputs / player static text. Reuse for enemy-ship editing. |
| UI tokens / panels | CSS `:root` ~L11; `makePanelDraggable/Resizable` | Floating, collapsible panels; danger `--txD`, gold accent, `--rad:6px`. |

**Combat stats that were missing** (added in Phase 1): numeric M-Drive Thrust,
power/powerMax, numeric armourRating, sensorDM, per-role crew-skill DMs, and a
weapons/turret loadout. (MgT2e core only — bay/spinal = High Guard, flagged.)

## 3. Locked decisions

| Topic | Decision |
|---|---|
| Fog & sync | **Referee-authoritative, render-side fog.** Referee is sole writer/source of truth; players poll read-only. Full encounter is stored; the player client redacts on read (not DB-enforced — same honour-system as the rest of the app). |
| Range model | **Per-pair range bands** (`ranges{}` keyed by canonical pair key). |
| Fidelity | **Faithful MgT2e core.** High Guard extras flagged, not faked. |
| Enemy ships | **Referee-authored** via the existing inline ship-edit flow; one shared schema (`makeShipStats`). |
| Combat → crits | Combat writes into the existing `shipState.crits` and trips Red Alert. |
| Step model | Referee-driven step-through; players read via a 1.5s combat poll. |
| Concurrency | Referee-only mutation → no conflicting writes to resolve. |
| Ship migration | Additive + lazy default (merged on load); no destructive migration. |

## 4. Data model

New shared key **`combat-encounter`** (single active encounter):

```
encounter = {
  id, status:'setup'|'active'|'ended', round, phase:'manoeuvre'|'attack'|'action',
  activeShipId, initiative:[shipId…],
  ships:[ combatShip ], ranges:{ pairKey: bandIndex }, hazards:[…], log:[…], createdAt
}
combatShip = {
  id, ref:'player'|null, name, side, stats:makeShipStats()|null /* player reads shipState */,
  thrustAllocated, dodge, sensorLocks:{}, pointDefenceUsed, initiativeScore,
  status:'active'|'disabled'|'destroyed', revealed, visibleTo
}
```

The player ship is `ref:'player'` and reads live from `shipState` (never
duplicated). Enemies hold a full `makeShipStats()` block. `redactEncounterForPlayer()`
is the read boundary: it drops unrevealed/unauthorised ships and prunes any
range/initiative/hazard referencing them.

## 5. Phased plan & acceptance criteria

- **Phase 1 — Data & state foundation ✅ (this commit).** Extended ship schema +
  `makeShipStats()` factory; `combat-encounter` key with persistence, redaction,
  battle log, referee lifecycle (create/end), and player poll wired into boot.
  *No combat UI/logic yet.* — AC: enemies are instances of the shared model;
  state persists & survives refresh; redaction verified.
- **Phase 2 — Core loop ✅ (this commit).** Engine only (no visuals): initiative
  (2D + Tactics(Naval); Leadership adjust), Manoeuvre/Attack/Action phase &
  round sequencing, per-pair range bands + Thrust allocation/dodge, 2D attack
  with an inspectable DM breakdown + sensor lock, damage → armour → Hull →
  Structure, Sustained-Damage (10% Hull) + Effect-6 criticals with escalation
  into the existing `crits` model, point defence with cumulative penalty,
  missile travel-time by band, append-only battle log. Player damage wires into
  the existing Red Alert + crit-pip UI. 20 engine unit tests pass.

  **Rules provenance.** Fixed numbers are in the `MGT2E` constant with their
  table reference: Thrust (Table 207 — Adjacent/Close 1, Short 2, Medium 5,
  Long 10, Very Long 25, Distant 50), the 2D Critical Hits Location table
  (matches the app's 11 crit systems), missile travel-time by band, the
  Sustained-Damage 10% rule, Effect-6 crit trigger, and the severity-6 cap
  (→ 6D extra damage). Interpretation-dependent values are isolated in
  `MGT2E.tunables` and **flagged for referee confirmation**: attack difficulty
  (8+), sensor-lock DM (+1; some tables read +2/Boon), per-range attack DM
  (0 — core is flat 8+), point-defence step (−1), dodge-per-Thrust (−1), and the
  target-size DM. Weapon damage is never guessed — it is a referee-entered dice
  expression per mount. Sources: Traveller SRD + Core Rulebook tables.
- **Phase 3 — Player & combat UI ✅ (this commit).** Floating combat console
  (`#combat-wrap`, launcher `⚔ Combat`) cloned from the existing panel chrome —
  draggable/resizable/collapsible. Referee gets the full board plus
  phase-appropriate action controls wired to the Phase-2 engine (thrust/range/
  dodge in Manoeuvre; target+weapon Fire, point defence, sensor lock in Attack;
  sensor lock + Leadership adjust in Action; add/remove/reveal ships; Next ▸).
  Players get a read-only, fog-redacted view of the same shared state via the
  poll. Ship cards show Hull/Structure bars + active crits; a per-pair range
  grid; and a battle log where every attack carries an inspectable `[DM ±n]`
  breakdown. Fog hardening: the player redactor now also strips log entries that
  reference a hidden ship by id OR by name. Render smoke-tests pass (referee +
  player views, DM breakdown, fog).
- **Phase 4 — Referee tooling ✅ (this commit).** Full ship stat + weapon
  editing for enemies AND the player ship via one modal that reuses the
  ship-data-file sheet layout (`sf-*` classes) and writes through a single
  generic updater (`updateCombatShipStat`/weapon CRUD) — one ship model, one
  edit idiom. Reachable from each enemy card and from the Ship panel ("⚔ Edit
  combat loadout"), the latter working even with no active encounter. Mid-combat
  reinforcements (add ship while active). Referee per-pair range setter (fiat,
  no Thrust). Environmental hazards: a preset list (asteroid field, nebula,
  gravity well, debris, dust/glare) the referee adds/toggles/removes live; their
  DMs fold into the engine's attack and sensor resolution and (gravity)
  effective Thrust, with no reload — players pick them up on poll and see
  read-only hazard chips. Hazard DMs are FLAGGED tunables in `COMBAT_HAZARDS`.
  13 Phase-4 tests pass.
- **Phase 5 — Animation & feedback ✅ (this commit).** Abstract/diagrammatic FX
  driven entirely off the battle log, so they fire identically for the referee
  (on action) and players (on poll) — one path. A cursor stops a freshly opened
  panel replaying the backlog. Beams between ship cards coloured by weapon type
  (beam/pulse/plasma/sandcaster), travelling missile projectiles, hit/crit card
  flash + shake, floating damage numbers, point-defence and sensor-lock pulses.
  All in a pointer-events:none overlay that self-removes (never blocks the loop);
  motion honours prefers-reduced-motion (falls back to opacity flashes). Audio is
  a tiny WebAudio synth (no asset files) behind a per-device 🔊/🔇 mute. 7 FX
  tests pass.
  - **Radar scope (CRT flair):** a green-phosphor, player-centric PPI at the top
    of the console — concentric rings = range bands (Adjacent centre → Distant
    edge), ship blips plotted by range-to-player on stable per-ship bearings,
    rotating sweep + scanlines (sweep disabled under reduced-motion). Hostile
    blips are click-to-target (prefills the action selects); fog-safe (players
    only ever plot revealed ships). 10 radar tests pass.

## 6. Open questions (non-blocking for Phase 1/2)

- **Phase 4 (answered, but confirm DMs):** hazard set shipped as asteroid /
  nebula / gravity well / debris / dust-glare. Default DMs in `COMBAT_HAZARDS`
  are best-effort and flagged — confirm/adjust against your table.
- **Phase 5 (answered):** abstract/diagrammatic chosen and shipped.
- **Phase 3 refinement (still open):** per-stat fog (e.g. reveal a ship but hide
  its weapon loadout) — needed, or is whole-ship reveal enough? Currently reveal
  is whole-ship.

# Phase 0 — Grid Inventory & Equipment: Audit, Decisions & Design

Status: **Phase 0 complete. Phases 1–4 SHIPPED** (this doc is historical — see the
note below). Original wording is preserved as the Phase-0 record.

> **Build status (updated):** Phases 1–4 are implemented and wired in
> `js/60-tools-settings.js` — structured render + free-text migration (Phase 1),
> the referee-authored item catalogue with honour-based add/remove (Phase 2),
> equip slots + advisory encumbrance (Phase 3), and container tabs + the footprint
> drag grid (Phase 4). Reachable via 🎒 Item Catalogue and the ＋ Add item button on
> each sheet. Phase 6 (portraits) also shipped. What remains is Phase 5 (referee
> edit-any / grant-item — verify what's already covered by add-from-catalogue) and
> Phase 7 (polish). The "no feature code written yet" and per-phase "will build"
> wording below is the Phase-0 snapshot, not current state.

Scope: adds a grid-based inventory + equipment system to the character sheet of
*Archon Gambit* (Mongoose Traveller 2e companion). This document is the read-before-write
audit required by the build brief §0/§7, the record of the Referee's Phase-0 decisions,
and the concrete data/UX design that Phase 1+ will build to. **No feature code has been
written yet.** *(← Phase-0 snapshot; superseded — see the build-status note above.)*

---

## 1. Audit — how the app actually works (verified in-repo + live Supabase)

### 1.1 Runtime architecture
- **Single global scope, not ES modules.** `index.html` loads `css/tokens.css` + `css/app.css`
  and **18 ordered classic `<script>` files** `js/00…98` (numeric prefix = load order). Every
  symbol is a hoisted global; hundreds of inline `on*=` handlers. New inventory code is plain
  global functions appended to existing modules — never `import`/`export`. See
  `docs/ARCHITECTURE.md`.
- **Load-order rule:** a top-level *synchronous* statement may only reference symbols defined in
  an earlier-or-same load-position file. `supaStorage` is in `js/50`; `isReferee`/`canSee`/
  `myIdentity`/`KNOWN_CHARACTERS` in `js/55`. Inventory logic must therefore live at load
  position **≥ 55** (we will use `js/60` and `js/85`).

### 1.2 Data layer — a KV façade, not per-feature tables
- All shared campaign state is JSON-stringified into **one public table `aurelia_state(key,value)`**
  via the single façade **`supaStorage.get(key,shared)` / `.set(key,value,shared)`**
  (`js/50-supabase.js:106-170`). `.get` returns `{ok,value}`; `.set` upserts. Offline
  write-through cache + outbound queue are built in.
- The table is read/written with a **publishable anon key**. Live RLS on `aurelia_state` is
  `SELECT/INSERT/UPDATE = true` for `public` — i.e. **world read/write**. Player-editable shared
  state is therefore an **honour system with client-side gating**, exactly as the brief assumes.
- A **separate token-gated path exists only for referee *secrets*:** `players` + `campaign_content`
  + the `get-content` edge function (service-role, deny-by-default RLS,
  `supabase/functions/get-content/index.ts`). It is **read-only redaction** — no player write path —
  so it is the wrong tool for player-editable inventory, and right only if we ever need hidden loot.

### 1.3 The character sheet already is the target surface
`js/60-tools-settings.js:1-160, 1071-1160`:
- One JSON blob per character under KV key **`sheet-${characterName}`**, stored **`shared:true`**
  precisely so the **referee can read/write any** character's sheet while client-side gating limits
  players to their own — the honour model the brief describes, already shipped.
- Sheet shape already carries **`str, dex, end, intl, edu, soc`** + free-text `weapons`/`equipment`
  textareas. `charDM()` (`:26-35`) already implements the MgT2e characteristic-DM table
  (0→−3, 1-2→−2, 3-5→−1, 6-8→0, 9-11→+1, 12-14→+2, 15+→+3) — reusable for encumbrance DM.
- Canonical roster: **`KNOWN_CHARACTERS = ['Rhett Calder','Cassia Velen','Dr Curculion','Riley','Riven Dahl']`**
  (`js/55-auth-gating.js:714`). The code uses **full names** (Cass = *Cassia Velen*); inventory keys
  off these exact strings, not the brief's short names.
- "Which character am I on this device" = **`myIdentity`** (device-local `localStorage('aurelia_identity')`,
  `js/55-auth-gating.js:44,716-744`). Free-text/swappable — honour-system, same as notes.
- Render/save entry points to extend: `renderSheetForm()` (`:1090`), `saveCurrentSheet()` (`:1140`),
  `emptySheet()` (`:18`). The modal is `#sheet-modal` (`index.html:357-372`), opened from the
  header 📋 button. Portraits were *previously* deliberately scoped out (`:11-13`) — the brief reverses that.

### 1.4 Reuse templates (so nothing is invented)
| Brief need | Existing template to copy | Location |
|---|---|---|
| §4.8 catalogue authoring **+** §4.5 add-from-catalogue | **Weapon catalogue** — referee-authored, reference-only library; `wpnAdd`/`wpnEditField`/`wpnRemove`/`restoreDeletedWeapon` (CRUD + soft-delete/restore); `addCombatWeaponFromCatalog()` clones a template into an owner's list (= one-tap add) | `js/80-combat.js:1049-1174` |
| §4.2/§5 stat block; §4.3 slots | **Ship sheet** — `sfTextField`/`sfNumField` (referee-input vs player-read span), `renderShipPanel` sections, `.sf-crit-grid/.sf-hex` fixed-slot grid | `js/75-ship.js:160-332` |
| Per-character honour state + live sync | **Funds** — `funds.purses[myIdentity]`, player-edits-own/referee-edits-all, one shared KV key, live-polled | `js/85-records.js:503-551`; poll block `js/55-auth-gating.js` |
| §4.7 portraits | **globes bucket** — public bucket + `loadTextureCatalog`/`textureUrlFor` | `js/50-supabase.js:18-74` |
| Theme | **tokens only** — `--bg0/1/2`, `--bd0/1/2`, `--tx0/1`, `--txS/bgS`/`--txW/bgW`/`--txD/bgD`, `--accentGold`; reuse `.quest-status-badge` (pill), `.rep-meter` (load bar), `.fund-card` (tile), `.sheet-*` | `css/tokens.css`, `css/app.css` |

### 1.5 Storage / portraits reality (live-verified)
- Only **one** policy exists on `storage.objects`: `anon_list_globes` (**SELECT** where `bucket_id='globes'`).
  There is **no anon INSERT/UPDATE/DELETE** anywhere. Globes were uploaded by the referee out-of-band.
- ⇒ Player portrait upload needs a **new `portraits` bucket + a new anon INSERT/UPDATE (+SELECT) policy
  scoped to that bucket** (a migration; honour-system, cannot touch `globes`). Enforce a bucket
  `file_size_limit` (~2 MB) and `allowed_mime_types` (jpeg/png/webp); client resizes/crops to a
  square (~512px) on a canvas before upload. Fallback = inline default silhouette.

### 1.6 Build / PWA guardrails
- Adding a **new** css/js file requires three coordinated edits or offline breaks: `sw.js` `SHELL[]`
  list **and** `CACHE` bump, plus the `css!==2 || js!==18` assert in `tools/build-local.mjs`.
  **Decision: append to existing modules** (`js/60` sheet logic, `js/85` boot/panel wiring, `css/app.css`
  Inventory section) to avoid all of it.
- Avoid the reserved field names `npcs/checks/refnotes/refNote/rsr/events/hook` as literal keys in any
  top-level data literal — `tools/strip-secrets.mjs` fail-closes on them.
- The only remaining net-new interaction with no in-repo precedent is **item-level drag-and-drop**
  (the grid layer, Phase 4).

---

## 2. Referee decisions (Phase 0 gate)

| # | Question | **Decision** |
|---|---|---|
| 1 | Data model (§3 relational tables+RLS vs KV) | **Extend the existing KV pattern** — no new tables, no second state model; honour-system client-side gating like the sheet/funds. |
| 2 | Item footprint (§9.1) | **Auto-suggest W×H from Mass on item creation, referee-editable** per item. |
| 3 | Containers (§9.2) | **Carried/Stowed flag first** (Carried vs Ship's Locker → correct encumbrance); full custom containers + grid arrive Phase 4–5. |
| 4 | Existing free-text `Weapons`/`Equipment` | **Replace with structured inventory.** Phase 1 does a **safe one-time migration** first (each line → a structured item, raw text preserved in the item's notes) so no typed gear is lost, then removes the free-text boxes. |

**Baselines adopted for the remaining §9 items (change any before Phase 1 if you disagree):**
- **§9.3 Cross-player visibility → own-only** (matches current sheet gating; referee sees all). Trivial to open up later.
- **§9.4 Portrait limits → ≤2 MB, JPG/PNG/WebP, client-cropped to ~512² square; referee may replace any; no external moderation.**
- **§9.5 Catalogue import → manual per-item authoring** is the baseline; optional CSV/paste import can be added later.
- **UI home → the existing `#sheet-modal`** (expanded as needed) — the brief's "character sheet screen" is this modal; there is no separate screen.

**Deferred to the Phase 3 gate (encumbrance), and NOT assumed from memory:**
- The **exact MgT2e STR/END encumbrance threshold + DM/fatigue values** (§4.4/§5) will be confirmed
  against the Core Rulebook with the Referee at Phase 3 — flagged *unverified* until then.
- The **worn-armour nuance** (does worn armour count in full / reduced / exempt) is a Referee ruling,
  taken at the same gate.

---

## 3. Proposed data design (KV, extends `supaStorage`)

All keys live in `aurelia_state` via `supaStorage`, `shared:true`, honour-gated client-side.

### 3.1 Item catalogue (referee-authored, **ships empty**) — key `item-catalogue`
Array of definitions (no seed data — nothing pre-loaded, per §5):
```js
{
  id: 'itm_<base36>', name: '', category: 'weapon'|'armour'|'gear'|'augment'|'consumable',
  tl: 0, mass: 0, cost: 0,          // TL, kg, Cr
  w: 1, h: 1,                        // footprint; auto-suggested from mass on create, editable
  desc: '', notes: '',
  // category-specific (form adapts to `category`):
  weapon: { range:'', damage:'', magazine:'', magazineCost:'', traits:'', skill:'' },
  armour: { protection:'', rad:'', reqStr:'' }
  // gear/augment/consumable: desc/effect only
}
```
CRUD mirrors the weapon catalogue: `catAdd` / `catEditField` / `catDuplicate` / `catRemove`
(referee-gated via `isReferee()`), rendered with the ship sheet's `sf-input`/`cbt-sel` field idiom.

### 3.2 Per-character inventory — key `inventory` (funds-style single object)
Single object so the **referee sees all five in one fetch** (§4.6) and one poll key keeps everyone live:
```js
{ byChar: { 'Rhett Calder': { items: [ {
  iid: 'inv_<base36>', defId: 'itm_…'|null,
  snapshot: { name, category, tl, mass, cost, w, h, ...stats }, // frozen at add-time so catalogue
                                                                // edits/deletes never corrupt instances
  qty: 1, stowed: false, equipped: false, slot: null,
  state: { ammo: null, charge: null, damaged: false, customName: '' }
  // grid (Phase 4): container, x, y, rotation
} ] }, /* …other characters… */ } }
```
Mutators: `addMyItem`/`removeMyItem` (gated to `myIdentity`), `refEditItem`/`grantItem`
(gated to `isReferee()`). Same last-write-wins tradeoff funds already accepts; if the blob grows we
can split to `inventory-<identity>` later (noted, not needed now).

### 3.3 Equipment slots — fixed list constant + per-instance `equipped`/`slot`
```js
const EQUIP_SLOTS = [['armour','Armour'],['primary','Primary Weapon'],
                     ['secondary','Sidearm'],['aug','Augment'],['misc','Other']];
```
Rendered `.sf-crit-grid`-style; equipping sets `equipped=true, slot=<key>`.

### 3.4 Portrait — `portrait` field on the `sheet-<name>` blob + `portraits` Storage bucket
Filename stored per character; resolved via a `portraitUrlFor(name)` mirroring `textureUrlFor`.
New migration adds the `portraits` bucket + anon SELECT/INSERT/UPDATE policy (bucket-scoped).

### 3.5 Encumbrance (Phase 3, advisory only, never blocks)
`carriedMass = Σ snapshot.mass × qty` over instances with `stowed===false` (worn-armour handling per
the Referee's ruling). Threshold from STR/END per the **rulebook value confirmed at Phase 3**. Status
pill unencumbered/encumbered/overloaded + current DM, mapped to `--txS/--txW/--txD`; load bar reuses
`.rep-meter`.

---

## 4. Phased plan (maps to brief §7; sign-off at each gate)

- **Phase 0 — Audit + decisions.** *(this document)*
- **Phase 1 — KV schema + read-only inventory.** `inventory` load/save + a read-only structured
  render inside `#sheet-modal`; **safe migration** of existing free-text `weapons`/`equipment` into
  instances (raw text kept in notes); then remove the free-text boxes.
- **Phase 2 — Catalogue authoring + player add/remove.** Referee `item-catalogue` form (category-adaptive)
  + one-tap search-and-add / remove for players.
- **Phase 3 — Equip + encumbrance.** Slots (§4.3) + advisory encumbrance indicator — **confirm the exact
  MgT2e threshold + worn-armour ruling at this gate.**
- **Phase 4 — Grid layer.** Drag/drop/rotate, containers, footprint-from-mass, persistence.
- **Phase 5 — Referee edit-any + grant-item.**
- **Phase 6 — Portraits.** `portraits` bucket migration + player/referee upload.
- **Phase 7 — Polish.** Theme/responsiveness/performance/edge cases.

---

## 5. Acceptance-criteria traceability (from brief §8)
Every §8 checkbox maps to a phase above; the hybrid (grid visual + Traveller advisory mass-encumbrance),
empty catalogue, honour-based add/remove, referee edit-all, five portraits, KV persistence via
`supaStorage`, and "no parallel styling/state/auth" are all satisfied by reusing the templates in §1.4
rather than introducing new systems.

# Max Stars in the Map — and What the Economy Does at Scale

> **Question:** "Now that we've added more features, what's the maximum number of
> stars we could add to the map — and what happens if we add them all with jump
> lanes and run the realistic economy?"
> **Method:** Static read of `js/10-galaxy.js` (map + hex placement) and
> `js/90-economy.js` (the `window.ECON` sim), plus two empirical harnesses:
> a standalone port of the hex-placement logic, and the real `ECON` engine loaded
> into a Node VM (same technique as `tools/econ-corp-harness.cjs`) with synthetic
> connected worlds injected to measure per-step time and persisted-state size.
> **Date:** 2026-07-14. Baseline galaxy: **183 systems** (53 curated + 130 generated).

---

## TL;DR

- **No hard-coded star cap exists** — there is no `MAX_STARS`. The map renders
  whatever is in `GALAXY_NODES`.
- **Map geometry** tops out around **~1,600 systems clean / ~3,000 packed** (hex
  collisions begin past ~1,600; the cluster spirals saturate near ~3,000).
- **The living economy is the real ceiling, and it bites far sooner.** The step
  cost is ~O(V²) and runs synchronously on the main thread. Smooth to a few hundred
  worlds; sluggish by ~1,000; effectively broken past ~2,000–2,500 (multi-second
  steps, minutes-long UI freezes, and the shared state silently exceeds the 1 MB
  persistence cap).
- **Practical wall for "add everything and simulate it": ~1,000–1,500 systems.**
  The engine is explicitly tuned for **~180 worlds** (see code comments cited below).

---

## 1. Two ways to add stars, two different limits

| Path | Where it lands | Binding limit |
|---|---|---|
| **Build-time generator** `tools/gen-galaxy.mjs` | Bakes nodes into `GALAXY_NODES` (`js/10-galaxy.js`); ships with the app | Hex packing (§2), then economy (§3) |
| **Runtime Design Mode** ("＋ Add new system") | `systemAdditions`, persisted to Supabase key `system-additions` | `put-state` `MAX_VALUE = 1,000,000` bytes → ~4,000 systems at ~250 B each (`supabase/functions/put-state/index.ts:69`, `js/10-galaxy.js:426`) |

Name uniqueness is **not** a binding limit: `catalogName()` draws from 15 catalog
prefixes × ~9,800 numbers ≈ **147,000** unique designations
(`tools/gen-galaxy.mjs:48-50`). Rendering is **not** the limit either — only
in-viewport hexes draw (`scheduleViewportRender`, `js/10-galaxy.js:1391`).

---

## 2. Map geometry — the hex-packing ceiling

Systems are auto-placed at runtime into faction-clustered hex spirals: radius-18
per faction (~1,027 hexes each) plus 10 independent "pockets" of radius-7 (~169
each), all sharing one global `occupied` set, with `HEX_SPACING = 2`
(`js/10-galaxy.js:966-1002`). Ported the placement into a standalone sim and swept
the count:

| Added | Total systems | Overlapping stars |
|---:|---:|---:|
| 1,400 | ~1,583 | **0 (clean)** |
| 1,500 | ~1,683 | 8 |
| 3,000 | ~3,183 | 693 |
| 6,000 | ~6,183 | 3,100 |

- **~1,400 added (~1,600 total)** pack in cleanly — one star per hex.
- The union of all cluster spirals **saturates near ~3,100 distinct hexes**. Past
  that, every extra star is forced onto an occupied hex and `BY_KEY[q+','+r]`
  silently overwrites (`js/10-galaxy.js:1058`) — stars stack and some become
  unclickable/hidden. That is the geometric hard ceiling.

Levers to raise it: the spiral radii (`clusterFaction(..., 18)`), pocket radius
(`placeSpread(..., 7)`), anchor spacing (`FACTION_ANCHOR` / `IND_POCKETS`), or
`HEX_SPACING`.

---

## 3. The economy at scale — measured

Loaded the real `ECON` engine, injected N connected worlds, warmed one step, then
timed 40 weekly steps and stringified the exact `save()` payload
(`js/90-economy.js:1788`):

| Total systems | Market worlds | **ms / weekly step** | econ-state bytes | transit |
|---:|---:|---:|---:|---:|
| 183 (today) | 165 | 20 | 142,378 | 356 |
| 483 | 399 | 40 | 221,142 | 288 |
| 983 | 788 | 154 | 363,021 | 314 |
| 1,583 | 1,255 | **462** | 538,646 | 361 |
| 2,983 | 2,343 | **2,332** | **926,833** | 281 |

Step cost scales **~O(V²)** — each weekly step runs a BFS out from every producer
world to route replenishment (`distC` / the replenishment pass, `js/90-economy.js:1610-1631`).
183 → 3,000 systems ≈ **114× slower per week (20 ms → 2.3 s)**. It runs
**synchronously on the main thread** — no worker, no chunking — so every ms is a
frozen tab. (Note: the injected worlds are food-negative stubs with thin stock
tables; real UWP-derived worlds carry fuller stock → the byte crossover comes
*earlier* than the table shows.)

### Three failure modes, all before the ~3,000 hex ceiling

1. **Catch-up freezes.** The sim catches the calendar up week-by-week, capped at
   `MAX_CATCHUP = 260` steps (`js/90-economy.js:1650, 1676-1685`). Worst-case
   catch-up ≈ 260 × step: **~2 min** frozen at 1,600 systems, **~10 min** at 3,000.
   Even a routine 52-week advance ≈ 24 s at 1,600. Gaps > 260 weeks snap to a
   re-settled baseline instead (`reseedTo` → `settleBaseline`, 16 weeks) — still
   ~7 s at 1,600, ~37 s at 3,000.
2. **Every jump-lane edit re-settles the economy.** A Design-Mode lane add/delete
   calls `syncLanes → recomputeBase → settleBaseline` synchronously
   (`js/90-economy.js:245`, `js/10-galaxy.js:368`) — ~7 s/edit at 1,600 worlds,
   ~37 s at 3,000. Wiring lanes for thousands of systems becomes near-unusable.
3. **Persistence silently breaks.** `econ-state` saves as one JSON blob under the
   same 1 MB `put-state` cap. It crosses 1 MB around **~2,500 market worlds /
   ~3,000 systems** (earlier with real data), and `save()` swallows the failure
   (`catch(e){}`, `js/90-economy.js:1787`): the economy keeps running in memory but
   **never persists** — players never receive it, and it's lost on reload. The
   worst failure, because it's invisible.

### The engine is tuned for ~180 worlds (from the code itself)

- Memoised BFS: *"the difference between ~150ms and a few ms/step at ~180 worlds"*
  (`js/90-economy.js:280-284`).
- Producer index: *"Critical now the galaxy is ~180 worlds (was O(n²) → tens of
  ms/step)"* (`js/90-economy.js:1604-1607`).
- `MAX_CATCHUP` guard: added because *"a real saved row hit 179,197 … froze the tab
  for tens of seconds"* (`js/90-economy.js:1645-1650`).
- Trader cap: *"~10ms/weekly-step at 150; stays smooth (see bench)"*
  (`js/90-economy.js:434`).

---

## 4. Verdict

| Total systems | Economy behaviour |
|---:|---|
| ≤ ~400 | Smooth (sub-40 ms steps); no real change from today. |
| ~1,000 | Sluggish; ~150 ms steps, noticeable catch-up / lane-edit freezes. |
| ~1,600 (clean-pack max) | Usable but painful: ~0.5 s steps, up-to-2-min catch-up freezes, ~7 s/lane-edit. |
| ~2,500–3,000 (hex ceiling) | Effectively broken: multi-second steps, up-to-10-min freezes, shared state silently stops saving. |

**The map can hold ~3,000 systems; a simulated economy over them cannot.** The
practical ceiling for "add everything and run the economy" is **~1,000–1,500
systems**, past which the sim — not the map — is what breaks.

### Headroom (not built — where the ceiling would move)

- **Async / worker stepping** — move `step()` off the main thread or yield between
  weeks; kills the freezes without changing behaviour.
- **Shard the persisted state** — split `econ-state` (e.g. per-region stock rows)
  so no single value approaches the 1 MB cap, and surface `save()` failures instead
  of swallowing them.
- **Active-world cap** — only simulate the N worlds near the party / of interest;
  keep the rest at their settled baseline. Bounds step cost regardless of map size.

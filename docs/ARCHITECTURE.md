# Architecture — the `index.html` light split

Aurelia RPG Tools shipped as a single ~17.4k-line `index.html` (one `<style>`, one
main `<script>`, one tiny trailing service-worker `<script>`). It was physically
split into ordered CSS/JS files **without changing how the app runs**. It is a
*partition* — code was **moved, not rewritten** — plus **one declared load-order
relocation** (the player-mode polling start, see below). Reversing that single
relocation reassembles the files into the original byte-for-byte;
`tools/verify-split.mjs` proves exactly that.

It is deliberately **not** an ES-module conversion. The app has hundreds of inline
`on*=` handlers and ~900 globally-hoisted symbols with forward references spanning
thousands of lines (e.g. `showToast` is *called* ~12k lines before it is defined).
That only works because everything lives in one hoisted global scope. Classic
`<script src>` tags (no `type="module"`) preserve exactly that scope. ES modules
would break every inline handler and every forward reference.

## Layout

```
index.html        markup + <link> (css) + 18 ordered <script src> (js) + trailing SW <script>
css/  tokens.css  the :root design tokens
      app.css     the rest of the stylesheet
js/   00-core-data … 98-trackers-boot   (numeric prefix = load order, see below)
```

### Module map (js/, in load order)

| File | Orig lines | Holds |
|------|-----------|-------|
| `00-core-data.js` | 3349–3558 | `BASE_BODIES_AUROS`, `SYSTEMS`, system/body data model |
| `10-galaxy.js` | 3559–5922 | Galaxy data + registry, `gx*` engine, system/region/route overlays, `WGEN`, the `HX` hex-jump engine, system-overview helpers |
| `20-station-data.js` | 5923–6121 | `MAIN` station data object |
| `30-system-body.js` | 6122–7615 | Shared state & player mode, system map, orrery, body close-up view, location layer, view switching |
| `40-station.js` | 7616–8263 | Station view, station clock, RSR found state, event log, `BASE_LOCATIONS`, `TIMED_EVENTS`, Aurelia navigation |
| `45-initiative.js` | 8264–8652 | Initiative / health tracker (referee) |
| `50-supabase.js` | 8653–8900 | **Data layer** — `supaStorage` façade, KV contract, offline write-through cache + outbound queue, texture catalog. Holds `SUPABASE_KEY`. |
| `55-auth-gating.js` | 8901–9691 | **Role gating** — access gate, reveal/visibility, `isReferee` / `canSee` / `viewerKey` / `secureRole`, `get-content` token path, shared-state poll |
| `60-tools-settings.js` | 9692–10852 | Character sheets, settings, search, settings menu (Archon morality, design toggle, campaign export/reset, box-type registry) |
| `65-design-mode.js` | 10853–11619 | Design-Mode stage-1 overrides, body stores, location stores, structured editors |
| `70-panels-quest.js` | 11620–11894 | Draggable/resizable floating panels, quest log |
| `75-ship.js` | 11895–12359 | Ship data file, red-alert state |
| `80-combat.js` | 12360–13646 | Space combat phases 1–5 |
| `85-records.js` | 13647–14701 | Imperial calendar, discovery log, reputation, party funds, oracle, **the main boot/init block** + secure-content wiring |
| `90-economy.js` | 14702–15704 | `window.ECON` living-economy engine + economy design editors |
| `92-tools-misc.js` | 15705–16068 | Quick-reference sidebar, session tools, `showToast` |
| `96-creators.js` | 16069–16833 | NPC creator, body creator (Design Mode) |
| `98-trackers-boot.js` | 16834–17369 (+1 reloc) | NPC location tracker, keyboard shortcuts, a11y init (final boot tail), **+ relocated player-mode polling start** (`start*Polling`, moved from `30`) |

## The load-order rule (the one rule that makes the split safe)

**Load order == original source order.** Numeric prefixes increase monotonically
with a section's position in the original file. They do **not** group by theme
across the file, because that would require reordering and break byte-equivalence.

Why it matters: the original is one script, so *all* function declarations are
hoisted before *any* top-level statement runs — a top-level call can reach a
function defined 10k lines later. Split into N sequential classic scripts, each
file runs to completion before the next loads, so a hoist no longer crosses a file
boundary. A top-level **synchronous** statement may therefore only reference
symbols defined **earlier in load order**.

This holds here with **exactly one relocation**. Every other top-level synchronous
call resolves to an earlier-or-same load position; the remaining forward references
to later modules occur only inside **deferred** callbacks (`.then(…)`,
`addEventListener`, `setTimeout`/`setInterval`) or behind `typeof` guards, which run
after every script has loaded. The app's main boot block lives in `85-records.js`
and only calls loaders/renderers from files `00`–`85`.

**The one relocation:** the `30-system-body.js` boot block restored player mode
(`aurelia_pm`) and then synchronously called `startPolling()` / `startAlertPolling()`
/ `startCombatPolling()` — function declarations that live in files `55`/`75`/`80`.
In the original single hoisted script those calls actually threw (the polling
functions touch `let`/`const` interval state declared later, still in its temporal
dead zone at that point) and the surrounding `catch(e){}` swallowed it, so polling
never started at boot for returning player-mode devices. Splitting turned the throw
into a `startPolling is not defined` ReferenceError — same swallowed no-op. The fix:
the **UI-restore** half stays in `30` (it references only `30`'s own globals, so
pm-active is still applied early — no flash), and the **three polling calls** were
moved to the tail of `98-trackers-boot.js`, where their definitions exist. This both
removes the forward reference *and* makes player-mode polling actually start on boot.

There is still **no separate `99-boot.js`** — only this one statement needed to move,
into the existing last file. **If a future edit adds a top-level synchronous call to
a function defined in a later-loaded module, move that executed statement into the
last-loaded file** (the only sanctioned reordering), and declare it in the
`RELOCATIONS` list of `tools/verify-split.mjs` so Gate 1 still proves byte-equivalence.

## Two shared-core ownership rules

* **Data is owned by `js/50-supabase.js`.** The single `supaStorage.get/set` façade,
  its KV keys + dynamic key patterns, and the offline cache/queue live here and
  nowhere else. Other modules call `supaStorage`; they never talk to the REST
  endpoint directly.
* **Gating is owned by `js/55-auth-gating.js`.** `isReferee()`, `canSee()`,
  `secureRole`, and the `get-content` edge-function/token path were moved verbatim
  and live only here. Spoiler/visibility decisions go through these.

## Hard invariants (must not break)

1. **Behaviour-preserving / partition + one declared relocation.** No logic
   rewrites, no renaming. The split files reassemble to the original byte-for-byte
   after reversing the single declared load-order relocation (the `start*Polling`
   calls, `30`→`98`); `tools/verify-split.mjs` Gate 1 proves it.
2. **Role-gating** (`50`/`55` ownership above) moved verbatim.
3. **Supabase contract** — one `supaStorage` façade, identical KV keys + patterns.
4. **PWA offline** — `sw.js` precaches *every* css/js file and its cache version is
   bumped (`orion-shell-v1` → `v2`). Adding/renaming/removing a css/js file means
   updating the `SHELL` list **and** bumping `CACHE`, or installed PWAs break offline.
5. **De-bake** — `tools/strip-secrets.mjs` removes referee fields from the campaign
   literals at deploy time. Those literals moved out of `index.html` into js modules,
   so the tool was repointed (`LITERAL_FILE` map): `BASE_BODIES_AUROS`→`00`,
   `GALAXY_NODES`→`10`, `MAIN`→`20`, `BASE_LOCATIONS`/`TIMED_EVENTS`→`40`. It now
   reads/writes those modules; the deploy must ship the stripped js files. NB:
   `SUPABASE_KEY` (`js/50-supabase.js`) is a **publishable** anon key (RLS-gated),
   not a de-baked secret, and is intentionally left in place.

## Verification (three gates — all must be green)

1. **Partition-equivalence (gold standard).** Concatenate the split css files in
   load order → byte-identical to the original `<style>` inner content. The js files,
   concatenated in load order *then with the declared `RELOCATIONS` reversed* →
   byte-identical to the original `<script>` inner content. *(css inner = 160 585 B /
   158 740 UTF-16 code units; js inner = 784 049 B / 755 538 code units — the verifier
   compares decoded-string length, hence the smaller "char" figures.)*
2. **Load-order audit (scope-aware).** No statement that runs synchronously at load
   — top level, *including inside top-level `if`/`try`/`for` blocks and IIFE bodies*,
   not just column-0 lines — references a symbol defined in a later-loaded file.
   typeof-guarded and deferred-callback references are exempt. *(0 forward references
   after the one relocation.)* NB: the original column-0-only scan was blind to the
   `30`→`98` case; the current scan is depth/scope-aware.
3. **Boot smoke test over HTTP.** Serve the folder, load the page: no css/js 404s,
   no `ReferenceError`/console errors on boot, app reaches its password gate.

Plus `node --check` on each js file (catches a cut that split a statement).

Re-run gates 1 & 2 with `node tools/verify-split.mjs <path-to-pre-split-index.html>`.
**Caution on Windows/`autocrlf`:** `git show <commit>:index.html` emits **LF**, which
diffs falsely against the **CRLF** working tree — capture the original through the same
smudge filter instead (e.g. a temporary `git worktree` at the pre-split commit). The
boot test is manual/browser. **Testing caution:** the bundle carries the live `SUPABASE_KEY` and
reads/writes the live `aurelia_state` table — keep browser testing read-only (don't
toggle reveals, clock, combat, or any referee state). Boot itself is read-only for
campaign state (GETs + the economy engine's deterministic self-seed of
`econ-state`/`econ-profiles`, unchanged from the original).

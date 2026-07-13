# Orion Arm Map — Comprehensive Program Assessment

> **Historical — point-in-time assessment.** Written against the pre-split single-`index.html` architecture; structural details below (file layout, module counts) are superseded. See [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`codebase-audit-2026-07-13.md`](codebase-audit-2026-07-13.md) for current state.

> **Scope:** Durability, Accessibility, Scalability, Resilience, and Cross-Platform
> behaviour (iPad + laptop), plus security/privacy and future potential.
> **Method:** Static evidence-based audit of the shipped artifact (`index.html`,
> 14,080 lines) and `docs/`. All findings cite `file:line`. Live device profiling
> (frame rate, VoiceOver, memory) is flagged where it is the necessary next step —
> those numbers cannot be produced from source alone and should be measured before
> sign-off.
> **Date:** 2026-06-25.

---

## 0. Confirmed Stack (the brief asked us to verify)

| Aspect | Finding | Evidence |
|---|---|---|
| Architecture | **Single self-contained `index.html`**, ~14k lines, ~11k of which is one `<script>`. No framework (React/Vue/Svelte matches were false positives — "Reaction"/"Reactor"). No build step, no bundler, no `package.json`. | `index.html:3092` (sole `<script>`); repo root has only `index.html` + `docs/` |
| Rendering | **DOM + inline SVG built by `innerHTML` string concatenation.** No `<canvas>`, no virtual DOM, no diffing. 104 `innerHTML` assignments; full-subtree rebuilds. | `buildOrrery()` `index.html:4479`; `getContext` count = 0 |
| State / backend | **Supabase REST** as a key/value store (`aurelia_state`), with a **~4-second player poll loop** for shared state. Publishable key embedded client-side. | `index.html:6883-6885`; `docs/phase-2-feasibility-study.md` |
| Offline / cache | Hand-rolled **offline sync queue + cache** in `localStorage`, with a `connState` of `live / offline / reconnecting`. | `index.html:6966-7034`, `:6971` |
| AI feature | Direct client `fetch` to `api.anthropic.com` for NPC generation (`claude-sonnet-4-6`). | `index.html:12970` |
| Auth model | **Honor-system, free-text identity**; `isReferee()` is a local checkbox. No server-enforced authorization. | `index.html:7155`; `docs/phase-2-feasibility-study.md` |
| Distribution | Web app with iOS web-app `<meta>` hints, but **no service worker and no manifest** — not an installable/offline PWA today. | `index.html:6-7`; no `serviceWorker` registration |
| Persistence | `localStorage` only (68 operations). **No IndexedDB.** | grep: `indexedDB` = 0 |

The single-file, dependency-free design is a genuine strength for this product:
trivial to host (any static server), trivial to back up (one file), and immune to
the npm dependency-rot that dominates the durability risk of most web apps. The
findings below are mostly about what that simplicity costs at scale and on assistive
tech — not a recommendation to abandon it.

---

## 1. Executive Summary

The Orion Arm Map is a **mature, feature-dense, and surprisingly robust single-file
application**. It already implements much of what the brief treats as aspirational:
a working search index, an offline sync queue with reconnection, reduced-motion
handling, a light/dark theme, a UI-scale control, and a three-tier
visibility model. Defensive programming is real, not cosmetic — **221 `try/catch`
blocks** wrap storage and network access (`index.html` passim).

The five findings that matter most:

1. **🔴 Critical — The player/referee secrecy boundary is cosmetic.** "Hidden"
   referee content is delivered to every client and merely hidden with CSS
   (`#root.pm-active .ref-only{display:none}` `index.html:389`). `isReferee()` is a
   local checkbox (`index.html:7155`). Any player on their own device can reveal all
   secrets by un-checking a box or reading the DOM. *Acceptable if the GM owns the
   only device; a confidentiality breach the moment players load the same Supabase
   state on their own devices* — which the 4-second player poll implies they do.

2. **🔴 Critical (a11y) — Pinch-zoom is disabled.** `maximum-scale=1`
   (`index.html:5`) blocks zoom on iPad, a direct **WCAG 2.2 1.4.4 / 1.4.10**
   failure and a daily pain point on a tablet-first product.

3. **🟠 High — Accessibility is largely absent under the hood.** 231 `<button>`s but
   only **5 `aria-*`, 4 `role=`, 5 `tabindex`, and 0 `alt`** attributes. Heavy use of
   `<div onclick>` and `innerHTML`-built controls means VoiceOver and keyboard users
   get an incomplete experience. The bones for fixing it (focus styles, reduced
   motion, scale control) are already present.

4. **🟠 High — The renderer rebuilds everything, every time, with no culling.**
   `buildOrrery()` regenerates the entire SVG via string concatenation on each of
   its 12 call sites, emits a `<radialGradient>` *per body*, and draws asteroid belts
   as up to **600 individually-animated SVG circles each** (`index.html:4479`+).
   There is **no virtualisation, no diffing, and zero debounce/throttle**
   (grep = 0). At 500+ objects this is the primary scalability risk, and it bites
   constrained iPad hardware first.

5. **🟡 Medium — Single points of data loss.** All local state lives in
   `localStorage` (~5 MB cap, synchronous, throws on quota; no IndexedDB), and the AI
   NPC `fetch` carries **no `x-api-key`/auth header** (`index.html:12970`) — so that
   feature either silently 401s in a real browser or depends on an injected key that
   would then be exposed. Neither is fatal; both are predictable failure modes worth
   closing.

**Overall health: B / Good-and-shippable, with two Critical items to close before
the next campaign with players-on-their-own-devices.** The architecture is sound for
its size; the gaps are concentrated and fixable, and several are quick wins.

---

## 2. Dimension-by-Dimension Findings

### 2.1 Durability & Maintainability — **B+**

**Strengths**
- **Defensive I/O.** 221 `try/catch` blocks; storage and network access are
  consistently guarded (`cacheGet`/`cacheSet` swallow exceptions, `index.html:6975-6979`).
- **State persistence works and is granular.** Toggle states persist under stable,
  namespaced keys: `aurelia_pm`, `aurelia_rings_off`, `aurelia_anim_off`,
  `aurelia_ui_scale`, `aurelia_theme`, panel positions, etc., each restored on load
  (`index.html:4427`, `:8440-8441`). This directly satisfies the brief's
  "survive session restarts" requirement.
- **Retroactive design changes** compose from data, not hard-coded special cases —
  per-body gradients and controls are generated generically for referee-added bodies
  as well as originals (`buildOrrery()` comments, `index.html:4540`+), so edits apply
  to existing data by construction.
- **Destructive actions are guarded** — 14 `confirm()` gates exist.

**Weaknesses**
| Sev | Finding | Evidence / Impact |
|---|---|---|
| 🟠 High | **XSS / render-corruption via `innerHTML` + interpolated campaign text.** 104 `innerHTML` sinks interpolate body names, descriptions, NPC text, and AI output directly into markup. A description containing `<` or markup can break the SVG/DOM ("malformed celestial objects") or inject script. | `buildOrrery()` `:4498`+, AI path `:12986` |
| 🟡 Med | **One 14k-line file = high cognitive load and merge-conflict surface.** No module boundaries; everything shares one global scope. Sustainable solo, painful for a second contributor. | whole file |
| 🟡 Med | **No automated tests, no CI.** No test runner, no lint, no GitHub Actions. Regressions are caught only by manual play. | repo has no `.github/`, no test files |
| 🟢 Low | **No dependency health risk** — there are no third-party runtime dependencies. This is a deliberate, defensible trade. | no `package.json` |

**Recommendation:** introduce a single `esc(str)` helper and route all
interpolated campaign/AI text through it (mechanical, high-value). Add a minimal
smoke test (load page in headless Chromium, assert no console errors, navigate
Galaxy→Station) wired to GitHub Actions — disproportionate safety for ~half a day.

### 2.2 Accessibility — **D+ (the most under-served dimension)**

**Strengths**
- **Reduced motion is genuinely handled** — 10 `prefers-reduced-motion` rules, and a
  user-facing animation toggle persisted to `aurelia_anim_off` (`index.html:8429`).
- **User-controlled UI scale** (`aurelia_ui_scale`, `index.html`) — a partial
  Dynamic-Type substitute.
- **Light/dark themes** give users a contrast choice; some `:focus` styling exists
  (15 occurrences).

**Weaknesses**
| Sev | Finding | Evidence / WCAG |
|---|---|---|
| 🔴 Critical | **Pinch-zoom disabled** via `maximum-scale=1`. | `index.html:5` — WCAG 1.4.4 Resize Text, 1.4.10 Reflow |
| 🟠 High | **Sparse semantics for AT.** 231 buttons / 5 `aria-*` / 4 `role` / 0 `alt`. SVG celestial objects, table rows used as buttons (`tr.onclick`, `:4505`), and icon-only controls (🛡 ✎, `:2421-2422`) are unlabelled for VoiceOver. | WCAG 1.1.1, 4.1.2 |
| 🟠 High | **Keyboard operability gaps.** Click handlers (320) vastly outnumber keyboard-reachable controls; `tr.onclick` rows and many `<div onclick>` patterns aren't focusable or Enter/Space-activatable. | WCAG 2.1.1 |
| 🟡 Med | **Touch-target sizing not systematic.** Only 2 references to a 44px sizing; clock `+1/+5` buttons and icon puffs are visually small (`:2406-2412`). | WCAG 2.5.8 / Apple HIG 44pt |
| 🟡 Med | **Low-contrast controls** — the brief calls out the Session button; the `--tx1` (`#8b91a8` on `#181c27`) muted text used widely is ~3.5:1, below 4.5:1 for normal text. | WCAG 1.4.3 |
| 🟡 Med | **Focus order in `innerHTML`-rebuilt panels** is not managed; rebuilding a panel mid-interaction drops focus to `<body>`. | WCAG 2.4.3 |

**Recommendation:** This is the highest *value-per-effort* cluster. Removing
`maximum-scale=1` is a one-line fix. Adding `aria-label` to icon buttons, `role`/`tabindex`/keydown
to the `tr.onclick` body rows, and bumping `--tx1` contrast are mechanical and could
land in 1–2 days. VoiceOver/keyboard pass on a real iPad is the verification step.

### 2.3 Scalability — **C+ (works today, will not absorb 500+ gracefully)**

**Strengths**
- **A search index already exists** (`buildSearchIndex()` `:7883`,
  `renderSearchResults()` `:7998`) — jump-to-object is built, which is exactly what
  large maps need.
- **Lazy-by-navigation** — System/body detail is built only when entered
  (`buildBodyView(id)` `:5128`), so not everything renders at once.

**Weaknesses**
| Sev | Finding | Evidence / Impact |
|---|---|---|
| 🟠 High | **Full SVG rebuild on every change, no diffing.** `buildOrrery()` re-stringifies the entire scene (12 call sites). Editing one body re-creates all of them. | `:4479`+ |
| 🟠 High | **No virtualisation / off-screen culling.** Every body emits a `<radialGradient>` def whether visible or not; belts render up to **600 circles each** (`density` clamp `:4587`), each carrying a CSS twinkle/vibe animation. Several belts + hundreds of bodies = thousands of animated nodes. | `:4540`, `:4587`+ |
| 🟠 High | **Zero debounce/throttle.** Text edits, toggles, and poll-driven refreshes each trigger immediate full rebuilds; no `requestAnimationFrame` coalescing (only 2 `rAF` in the whole file). | grep: `debounce`/`throttle` = 0 |
| 🟡 Med | **Full-document poll every ~4s.** Re-pulls and re-applies shared state on a timer regardless of change size. | `docs/phase-2-feasibility-study.md` |
| 🟡 Med | **`localStorage` ceiling.** Large campaigns serialised to a ~5 MB synchronous store risk `QuotaExceededError`; writes block the main thread. | 68 `localStorage` ops; no IndexedDB |

**Recommendation (in impact order):** (a) debounce the rebuild path and route it
through `requestAnimationFrame`; (b) cap/virtualise belt density by zoom level and
skip off-screen bodies; (c) diff or memoise the orrery so an edit touches one node,
not all. Then **measure** frame rate and interaction latency with a synthetic
500-object campaign on a mid-range iPad — that benchmark is the acceptance gate, and
it does not exist yet.

### 2.4 Resilience & Fault Tolerance — **B**

**Strengths**
- **Genuine offline story.** Sync queue (`SYNC_QUEUE_KEY`), cache layer
  (`CACHE_PREFIX`), and a tracked `connState` (`live/offline/reconnecting`) with
  `navigator.onLine` handling (`:6966-7078`) — well-suited to flaky table Wi-Fi.
- **Idempotent restore.** Toggle/design state restores deterministically from
  namespaced keys on load (§2.1), so a crash/restart returns to the prior view.
- **Guarded teardown** — 14 `confirm()` gates around deletes.

**Weaknesses**
| Sev | Finding | Evidence / Impact |
|---|---|---|
| 🟡 Med | **No undo/redo.** In-place Design Mode editing + delete is destructive; `confirm()` is the only safety net. A mis-edit to a description is unrecoverable. | no undo stack present |
| 🟡 Med | **`localStorage` quota = silent data loss.** `cacheSet` swallows the throw (`:6978`), so a full quota fails silently rather than warning the referee. | `:6975-6979` |
| 🟡 Med | **No logging/telemetry.** No structured error capture; field failures are invisible. Acceptable for a solo tool, a gap if it grows. | none found |
| 🟢 Low | **Last-write-wins on the shared key** can clobber concurrent referee edits across devices (no merge). | poll model |

**Recommendation:** surface quota/sync-queue failures to the referee (a small
banner), and add a bounded undo stack for Design Mode deletes — the highest-anxiety
operation in the product.

### 2.5 Security & Privacy — **C+**

| Sev | Finding | Evidence |
|---|---|---|
| 🔴 Critical | **Client-side-only trust boundary** (see §1.1). Secrecy and "referee-only" are CSS, not authorization. | `:389`, `:7155` |
| 🟠 High | **AI `fetch` has no auth header.** It will 401 in a real browser as written, or — if a key is injected to make it work — that key is exposed to every client. Either way the feature is mis-wired for production. | `:12970-12975` |
| 🟡 Med | **Supabase publishable key in client is fine *iff* Row-Level Security is enforced** on `aurelia_state` and the `globes` bucket. With an anon SELECT policy and a shared key/value row, anyone with the URL can read/write campaign state. **Verify RLS server-side.** | `:6883-6885`, `:6900` |
| 🟡 Med | **No CSP / no `X-Content-Type-Options`** on the document; inline-everything makes a strict CSP harder but a baseline is still worth adding at the host. | document `<head>` |

**Recommendation:** Decide the threat model explicitly. If players use their own
devices and secrets must hold, the redaction must move server-side (a Supabase Edge
Function / RLS-gated view that returns *only* the audience-appropriate payload). If
the GM owns the only screen, document that assumption and downgrade the finding —
but do not leave it ambiguous. Move the Anthropic call behind a server proxy
regardless.

---

## 3. Cross-Platform Notes (iPad vs. Laptop)

| Area | iPad (Safari/WebKit) | Laptop | Discrepancy / Risk |
|---|---|---|---|
| Zoom | **Pinch-zoom blocked** (`maximum-scale=1`) | Ctrl/⌘-+ still works | 🔴 iPad users cannot magnify — worst on the primary device |
| Input | 7 touch + 10 pointer handlers vs **320 click** | Mouse/keyboard first-class | 🟠 Drag-to-reposition panels (pointer) is fine; many controls are click-centric, and hover-only affordances have no touch equivalent |
| Animation perf | Hundreds of CSS-animated SVG circles tax the WebKit compositor first | Desktop GPU absorbs it | 🟠 Frame-rate gap will appear on older iPads with large belts (§2.3) |
| Install/offline | iOS web-app `<meta>` present but **no SW/manifest** → "Add to Home Screen" gives a fragile shell, no offline document caching | Same | 🟡 The offline *data* queue works; the offline *app shell* does not |
| Storage | iOS evicts `localStorage` for web-app-mode sites under storage pressure / inactivity | More durable | 🟡 Long-gap campaigns risk losing local state on iPad specifically |
| Orientation / Split View / Stage Manager | Layout is responsive (`width=device-width`) but untested under Split View narrow widths and Stage Manager resize | N/A | 🟡 Needs live verification; reflow behaviour with zoom disabled is a concern |
| Apple Pencil | No pen-specific affordances; treated as touch | N/A | 🟢 Acceptable; an opportunity, not a defect |

**The cross-platform gaps converge on iPad** — the very platform the brief
prioritises. The zoom block, the compositor load, and storage eviction are all
iPad-first problems.

---

## 4. Optimisation Table

| # | Issue | Fix | Expected Impact | Effort |
|---|---|---|---|---|
| 1 | Pinch-zoom disabled | Drop `maximum-scale=1` from viewport (`:5`) | Removes a Critical a11y blocker; instant iPad usability win | **XS** (1 line) |
| 2 | XSS / render corruption from `innerHTML` | Add `esc()` and wrap interpolated campaign/AI text | Kills "malformed object" class of bugs + injection | **S–M** |
| 3 | Full orrery rebuild on every change | Debounce + `requestAnimationFrame` the rebuild path | Eliminates redundant redraws; smoother editing | **S** |
| 4 | 600-circle animated belts, no culling | Cap density by zoom; skip off-screen bodies/defs | Largest FPS/memory win at 500+ objects, iPad-first | **M** |
| 5 | Per-body `<radialGradient>` defs always emitted | Emit only for on-screen bodies; or one shared gradient | Fewer SVG nodes, lower memory | **S** |
| 6 | Icon buttons/rows unlabelled for AT | `aria-label` + `role`/`tabindex`/keydown on `tr.onclick` | Unblocks VoiceOver + keyboard | **S–M** |
| 7 | `--tx1` low contrast (~3.5:1) | Darken/lighten muted text token to ≥4.5:1 | WCAG 1.4.3 pass across whole UI in one token edit | **XS** |
| 8 | AI call mis-wired / keyless | Route via server proxy with the key server-side | Feature actually works *and* key isn't exposed | **M** |
| 9 | `localStorage` quota silent failure | Detect `QuotaExceededError`, warn referee; plan IndexedDB | Prevents silent campaign data loss | **S** (warn) / **L** (migrate) |
| 10 | No offline app shell | Add service worker + manifest | True installable PWA, offline-first on iPad | **M** |

---

## 5. Prioritised Roadmap

**Quick wins (this week — hours to ~2 days, high value):**
1. Remove `maximum-scale=1` (#1) — Critical a11y, one line.
2. Raise `--tx1` contrast (#7) — Critical-adjacent, one token.
3. `esc()` everywhere (#2) — closes XSS + malformed-render class.
4. Debounce + rAF the rebuild (#3) — immediate perceived smoothness.
5. `aria-label`s + keyboard-activate the row/icon controls (#6).

**Near-term (this month — the secrecy decision + scale gate):**
6. **Resolve the trust-model question (§2.5)** — server-side redaction if players
   are on their own devices; otherwise document the single-device assumption.
7. Belt culling/virtualisation + on-screen-only defs (#4, #5), then **benchmark a
   500-object campaign on a real iPad** and set a target FPS as the acceptance gate.
8. Proxy the Anthropic call (#8); surface quota/sync failures (#9-warn).
9. Add a headless smoke test + GitHub Actions CI (§2.1).

**Strategic investments (next quarter):**
10. Service worker + manifest for true offline PWA (#10).
11. Bounded undo/redo for Design Mode.
12. Migrate large-campaign local state to IndexedDB.
13. Consider extracting the file into a few modules behind a tiny build step *only
    if* a second contributor joins — otherwise the single-file simplicity is a feature.

---

## 6. Future Opportunities (ranked by value × feasibility)

1. **Server-enforced reveals + real-time push** (high value, medium effort). The
   Supabase poll already syncs state; moving redaction server-side and switching the
   4s poll to Supabase Realtime channels delivers *both* genuine secrecy **and**
   instant referee-controlled reveals — solving a Critical finding and the
   multiplayer ambition in one stroke.
2. **Cross-device sync** (high value, low marginal effort) — already 80% there via
   the shared `aurelia_state` key; needs identity/session hardening to be trustworthy.
3. **Undo/redo + bulk edit + templates** (high value, medium) — the search index
   exists; pairing it with multi-select and an undo stack makes Design Mode safe for
   large maps.
4. **Export / import / sharing of campaigns** (high value, low) — state is already a
   serialisable blob; a download/upload pair is small and unlocks backup + sharing.
5. **Accessibility-as-a-feature** (medium-high value, low–medium) — high-contrast
   theme and voice control build directly on the existing theme + scale + reduced-motion
   infrastructure.
6. **Lore/codex/timeline tooling** (medium value, medium) — the Discovery Log /
   Codex state machine already exists per the feasibility study; extending it to
   linked wiki entries and faction tracking is incremental, not greenfield.
7. **VTT/API integrations** (medium value, high effort) — defer until the data model
   and trust boundary are server-authoritative.

---

## 7. Success Metrics (so improvements are verifiable)

| Dimension | Metric | Target |
|---|---|---|
| Accessibility | Axe/WCAG 2.2 AA automated pass; VoiceOver task completion (Galaxy→Station) | 0 critical violations; 100% task completion |
| Accessibility | Min text contrast | ≥ 4.5:1 normal text |
| Scalability | Orrery interaction frame rate, 500-object campaign, mid-range iPad | ≥ 50 fps; edit-to-paint < 100 ms |
| Scalability | Animated-node count at default zoom | bounded (culled), not O(bodies × density) |
| Resilience | State restore after forced restart | 100% of toggle/design state |
| Resilience | Quota/sync failure | surfaced to referee, never silent |
| Security | Referee-only content reachable by a player device | 0 (after server-side redaction) |
| Cross-platform | Feature/input parity touch vs. pointer/keyboard | 100% of Design + Referee actions |

---

### Methodological note / limits of this assessment

This is a **static** audit of the shipped source. Three things still require live
measurement before sign-off and were intentionally not asserted as numbers here:
(1) actual frame rate/memory under a 500-object load on real iPad hardware;
(2) VoiceOver/keyboard task completion on iPadOS and macOS; and (3) whether Supabase
**RLS** is configured server-side (which determines whether the publishable key is
benign or a data-exposure risk). The §1 Critical findings hold regardless of those
measurements; the §2.3 severities should be confirmed against the benchmark.

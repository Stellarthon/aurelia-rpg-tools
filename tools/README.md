# `tools/` — build & maintenance scripts

No `package.json`; run each with `node` from the repo root. Grouped by role.

## Load-bearing (part of the build / verification contract)

| Script | Run | What it does |
|--------|-----|--------------|
| `strip-secrets.mjs` | `node tools/strip-secrets.mjs` (or `--check`) | The **de-bake**: strips referee-only fields (`npcs`, `checks`, `refNote`, `rsr`, `events`, `hook`) out of the campaign literals in `js/00`,`js/10`,`js/20`,`js/40` at deploy time. Fail-closed coverage guard (exit 2 if an uncovered structure still holds secrets); `--check` is CI-usable. See `docs/ARCHITECTURE.md` invariant #5. |
| `verify-split.mjs` | `node tools/verify-split.mjs <pre-split-index.html>` | Proves the css/js partition reassembles **byte-for-byte** into the original monolithic `index.html` (Gate 1) and audits load-order forward references (Gate 2). Needs the pre-split `index.html` as an argument. Editing any `js/*.js` or `css/*.css` invalidates Gate 1 until re-baselined. |
| `build-local.mjs` | `node tools/build-local.mjs` | Inlines `css/` + `js/` into a single self-contained `index.local.html` (gitignored) for offline/local viewing. The modular `index.html` remains the source of truth. |
| `gen-icons.mjs` | `node tools/gen-icons.mjs` | Regenerates the PWA icons (`icons/icon-192.png`, `icon-512.png`, `apple-touch-180.png`) with no image libraries. Re-runnable. |

## Content pipeline (Supabase seed)

| Script | Run | What it does |
|--------|-----|--------------|
| `extract-content.mjs` | `node tools/extract-content.mjs` | Extracts campaign fragments and writes `supabase/seed/campaign_content.json` (inspection) + `campaign_content.seed.sql` (the file actually run in the SQL editor). ⚠️ Both outputs contain referee secrets in cleartext — see the audit note on repo visibility before committing them to a public repo. |

## Dev test harnesses (not wired to any CI — run manually)

| Script | Run | What it does |
|--------|-----|--------------|
| `deck-harness.mjs` | `node tools/deck-harness.mjs` | Headless logic checks for the deck editor (`js/41`). Self-reports if a checked function name no longer exists. Currently 67/67. |
| `econ-corp-harness.cjs` | `node tools/econ-corp-harness.cjs` | Loads the `window.ECON` IIFE out of `js/90` and exercises the corp-investment model. The IIFE close (`})();`) is located dynamically. |

## Spent one-offs (output already committed — kept for reproducibility)

| Script | Run | What it does |
|--------|-----|--------------|
| `gen-galaxy.mjs` | `node tools/gen-galaxy.mjs` | Deterministically generated the procedural galaxy nodes now baked into `js/10-galaxy.js`. Re-runnable but not needed unless regenerating the galaxy. |
| `mark-uninhabited.mjs` | `node tools/mark-uninhabited.mjs` | One-shot migration that stamped `uninhabited` flags onto `GALAXY_NODES` in `js/10-galaxy.js` (already applied). Idempotent. |

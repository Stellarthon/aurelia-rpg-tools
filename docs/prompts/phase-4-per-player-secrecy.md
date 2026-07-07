# Implementation prompt — Phase 4: Per-player secrecy migration

> This phase is different from the others: it is **security-critical,
> touches the production Supabase project, and is already fully designed**
> in `docs/per-player-redaction-plan.md`. It must be executed
> **stage-by-stage across separate sessions/PRs**, not in one pass. The
> prompt below is for **Stage 0 only**; §"Later stages" tells you how to
> prompt the rest. Do not hand a single session the whole migration.

---

## Session prompt — Stage 0 (Foundations)

Execute **Stage 0 of `docs/per-player-redaction-plan.md`** ("Foundations":
`players` + `campaign_content` tables, RLS, referee token, seed). Work
plan-first: read that entire document, then `docs/table-presentation-plan.md`
§6 for how this phase is sequenced, then present your concrete migration
plan before touching the Supabase project.

**First task (mandated by the plan §6):** the redaction plan's line anchors
predate the split of the monolithic `index.html` into the 22 `js/NN-*.js`
modules and are stale (e.g. it cites `index.html:7168` for `isReferee`, which
now lives at `js/55-auth-gating.js:204`). Re-locate every cited anchor in the
current tree and update the document in the same PR, so later stages execute
against accurate references.

Hard rules for this and every later stage:

1. **Never reorder the stages.** The ordering *is* the safety mechanism:
   the bundle is stripped of referee content (Stage 3) only after the
   authenticated `get-content` path is proven (Stage 2). A mis-sequenced
   Stage 3 breaks the live app for everyone.
2. **Each stage is independently shippable and independently verified.**
   Finish, verify, and merge one stage before starting the next.
3. **Production caution:** schema changes go through numbered files in
   `supabase/migrations/` (current numbering `0001–0008` — continue it),
   never ad-hoc SQL against production. Check `supabase/README.md` and the
   existing `get-content` edge function
   (`supabase/functions/get-content/index.ts`) before writing anything —
   parts of the secure path already exist; extend, don't duplicate.
4. **After any schema/RLS change:** run the Supabase advisors and report
   findings; the migration is not done while security advisors flag the new
   objects.
5. **No client behavior change in Stage 0.** Players and referee must be
   able to use the app identically before and after this stage ships.

Deliverables for Stage 0: migration file(s), seed path, refreshed anchors in
`docs/per-player-redaction-plan.md`, a verification report (what you ran,
what the advisors say), and an updated status header in that document
marking Stage 0 complete.

---

## Later stages — how to prompt them

Run each as its own session, in order, each time saying:

> Execute Stage N of `docs/per-player-redaction-plan.md`. Stages 0..N−1 are
> merged and verified (confirm this in the document's status header before
> starting — stop if it doesn't say so). Follow the hard rules recorded in
> `docs/prompts/phase-4-per-player-secrecy.md`. Plan first, then implement,
> then verify, then update the status header.

Stage-specific cautions to include when you get there:

- **Stage 1 (Edge function):** build/deploy `get-content`; the client must
  not use it yet. Deny-by-default; verify with direct curl-style calls, not
  through the app.
- **Stage 2 (Referee cutover):** referee loads full content via
  `get-content`; the exit test is **parity** — the referee view is
  byte-equivalent to the pre-cutover view. Keep the old path behind a flag
  for instant rollback.
- **Stage 3 (Player cutover + strip):** the only high-risk stage. Players
  switch to token + `get-content` first; only then strip referee content
  from the shipped bundle. `node tools/strip-secrets.mjs --check` must exit
  0 before and after; test a real player device end-to-end before merging.
- **Stage 4 (Harden):** move `aurelia_state` writes behind the referee
  token; clear all remaining security advisors. This is the stage that
  retires the honour-system — after it merges, Phase 5 (whisper notes) and
  open-sourcing are unblocked.

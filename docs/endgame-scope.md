# Archon Gambit — Endgame Scope ("what's left to call it done")

## Why this document exists

The feature roadmap (`docs/feature-gap-analysis.md`) is effectively **exhausted**:
Tier 1 and Tier 2 are complete, most of Tier 3 shipped, and a whole unplanned epic
(the deck-plan editor, the setup wizard, the referee/player onboarding tours) landed
on top of it. The governing constraint — *"the app accompanies the game; it must never
become the game"* — is a deliberate ceiling, and we've reached it. Everything past this
point is either an **anti-feature** (see §5) or **finishing work**, not new capability.

This document scopes that finishing work: the small, bounded set of items that stand
between "mature companion app" and a **1.0 you could open-source without a secrecy
leak**. It is grounded in the verified current state (branch in sync with `origin/main`
as of 2026-07-15), not the older status snapshots in the roadmap docs.

**Recommendation in one line:** the endgame is not more features — it's **closing the
last secrecy leak (§1) and making the repo open-sourceable (§2)**. Do those two and
draw the 1.0 line; §3–§4 are optional/content.

---

## Verified current state (reconciled 2026-07-15)

| Area | State | Evidence |
|---|---|---|
| Write-side secrecy | ✅ **Done & live** | `put-state` v2 + migration `0010_lock_aurelia_state_writes.sql` applied; anon INSERT/UPDATE on `aurelia_state` dropped, SELECT kept. Client routes token writes through `put-state` (`js/50-supabase.js`). Honour system retired **for writes**. |
| Read-side secrecy | ⏳ **Open — the one real code item** | Referee-only keys still live in `aurelia_state` with public SELECT: `npc-roster`, `session-plans`, raw `combat-encounter`, unrevealed `clocks`, referee-visibility `campaign-events`. Anyone with the shipped anon key can read them; the client redacts *after* download. (`docs/per-player-redaction-plan.md` §8 "New finding".) |
| Secure-content path | ✅ Wired | `get-content` edge fn + `hydrateSecureContent` + token tools present (`js/55-auth-gating.js:438`). Whisper notes already use the target pattern (migration `0011`, per-identity redaction server-side). |
| Bundle content strip | ⚠️ **Not applied on current main** | `node tools/strip-secrets.mjs --check` exits **1** — the shipped `js/` modules carry the full reference campaign (`GALAXY_NODES`, `MAIN`, `BASE_BODIES_AUROS`, `BASE_LOCATIONS`). The coverage-guard false-positive (old exit-2 abort) is gone; the bundle simply ships content by design of the canonical deploy. Whether to re-strip is an **open decision tied to §2**. |
| Route-blocking | ✅ Shipped | Toggle + kill-switch + lane render (`js/10-galaxy.js:715-790`). |
| Printable sheets | ◐ Partial | Character-sheet print shipped (`js/60-tools-settings.js:1659`); **ship-sheet print still absent**. |
| Open PRs / issues | none | Nothing in flight; scope is unconstrained by pending work. |

**Honest headline:** because the bundle ships full content *and* several referee keys
leak on read, the redaction plan's success metric — *0 bytes of referee content on a
player device* — is **not met today**, even though the write-lock is done. §1 + §2 are
what actually close it.

---

## 1. Close the last secrecy leak — Stage 4.5 read cutover  ·  **P0**  ·  ~2–3 focused days

The only remaining *code-level* security item. Move the referee-only keys currently
readable from `aurelia_state` behind `get-content`, then drop their public SELECT —
using the **exact staged pattern** already proven by whisper notes so nothing breaks.

**Keys to cut over** (`docs/per-player-redaction-plan.md` §8): `npc-roster`,
`session-plans`, `combat-encounter`, unrevealed `clocks`, referee-visibility
`campaign-events`.

**Sequence (client-first, the ordering IS the safety mechanism):**
1. Serve these keys through `get-content` (it already returns `reveals`; extend it to
   return the referee-only keys redacted per token). Client reads them from the
   hydrated response instead of the public KV.
2. Verify end-to-end on a scratch/player-mode device: referee sees full, player sees
   nothing, offline cache still works.
3. **Only then** ship a `0014`-style migration that carves these rows out of the public
   SELECT policy (mirror `0011_whispers_select_carveout.sql`). Do **not** drop SELECT
   wholesale — every device reads shared keys anonymously today and would break.
4. Re-run `get_advisors(security)` → 0 new findings.

**Risk:** medium (production, mid-campaign) — but each step is independently shippable
and reversible (re-add the SELECT policy to roll back instantly). **Plan-first before
touching production**; deliver SQL + edge source as repo files, owner applies stage by
stage. *(I cannot deploy to the live project unattended.)*

**Definition of done:** a player's network payload contains **0 bytes** of any referee
key above; token tampering yields 401/filtered; advisors clean.

---

## 2. Open-source readiness  ·  **P1**  ·  ~1–2 days + one owner decision

The stated long-term goal (Q5). An open repo *publishes the honour-system bypass*, so
this is why §1 is urgent, not merely nice. Three sub-items:

### 2a. Content model — DECIDED: separate public repo, generic sample
Resolved 2026-07-15. Rather than strip this repo in place, the agnostic build ships
to a **separate public repo, [`Stellarthon/SciFiVTT`](https://github.com/Stellarthon/SciFiVTT)**,
carrying a **generic sample sector** (no Archon Gambit lore or data) and keeping the
Mongoose Traveller mechanics (campaign/setting scrub only). This private repo keeps
the reference campaign untouched.

The Campaign-Pack engine already makes this clean — Archon Gambit is just the default
pack; the engine renders through generic pack accessors.

### 2b. `tools/build-agnostic.mjs` — SHIPPED
A reproducible build tool generates the SciFiVTT distribution from this codebase, so
the public repo stays in sync as features land here. It:
- copies the deployable engine + generic assets (omits `config.js`, `docs/`,
  `supabase/`, `tools/`, `.github/`, the reference-campaign PDF);
- injects a **generic sample sector** — a deterministic ~29-system galaxy with a
  generic faction set, one sample station, home-system bodies/locations, and pregen
  crew — replacing the Archon Gambit data literals;
- applies transforms: `aurelia_`→`vtt_` storage prefix, and neutralised
  branding / terminology / factions / morality-tracker / crew identities;
- writes an agnostic README, MIT LICENSE, `config.example.js`, `.gitignore`;
- runs a **lore leak-guard** (`--check`) that fails if any Archon Gambit token
  survives, plus `node --check` on every emitted module.

Verified: leak-guard clean, all modules parse, and a headless boot test confirms the
generic content wires into the app (galaxy/station/crew/factions/pack) with no console
errors, and the unconfigured→setup-wizard redirect works.

**Anchor-id note (v1 limitation):** three structural ids the engine pins at boot
(`auros`, `aurelia`, `aurelia-station`) are kept as opaque internal keys — never
shown to a user, never in data prose. Renaming them to generic slugs is a clean
follow-up.

**Delivery:** SciFiVTT is not in this session's GitHub scope, so the build output is
handed off as an artifact for the owner to push (or grant repo access in a later
session). Re-run `node tools/build-agnostic.mjs` any time to regenerate.

### 2c. Publishing hygiene (independent of 2a)
- **Baked anon key + access/design codes** (`config.js`): documented safe-to-publish
  (publishable key, RLS-gated; codes are casual deterrents). For OSS, ensure a fork
  gets the *empty* config path (delete `config.js` → setup wizard launches) rather than
  inheriting the reference campaign's codes. Add a one-line note to the README's OSS
  section.
- **Uploaded rulebook PDFs / handouts / deck maps** — already in private buckets; add an
  explicit "never commit user uploads" line to `.gitignore` + README so a fork can't
  leak a copyrighted book.
- **License file** — add one (none present). MIT/Apache-2.0 for the code; a separate
  note that *setting content* (if any ships) is not licensed for reuse.

---

## 3. Referee content, not code  ·  **P2**  ·  the referee's own time, not a build

These are "enter your own numbers" tasks the app already supports; nothing to build.
- **Layer-1 gear catalogue seed** — referee hand-enters (or CSV-imports) the gear the
  group uses into the existing `item-catalogue` CRUD (`js/60`). Repo ships empty by design.
- **Combat tunables confirmation pass** — a one-time settings walk through the
  interpretation-dependent DMs the engine flags (`MGT2E.tunables`, `js/80:207`) to
  "make these numbers yours." Optional; only matters if a specific ruling bites.

---

## 4. Finishing polish  ·  **P3**  ·  hours each; do if/when they annoy you

- **Ship-sheet print** — the char sheet prints; add the same `@media print` path for the
  ship sheet + a party summary (`js/75`). Rounds out the "wifi-out backup" story.
- **On-device visual checks** the harness can't do headless: route-block SVG rendering
  on a real gated map; deck-plan editor edge cases on a tablet.
- **Deck-plan editor** — appears feature-complete (angled/chamfered rooms, custom props,
  live damage map, wiki links). No scoped work remains; treat as done unless a real table
  session surfaces a gap.

---

## 5. Out of scope — the hard boundary that makes "done" real

"Done" only means something if the boundary is explicit. These are **deliberately never
built**, restating the roadmap's anti-feature list:
- Grid/token tactical combat, movement, line-of-sight, fog-of-war on tactical maps.
- Default player dice roller / rules-engine macros (dice happen on the table; only a
  narrow absent-player fallback is ever justified).
- Automated personal/ground combat resolution.
- Built-in voice/video; full audio mixing console.
- Scheduling / attendance / calendar invites.
- **Do not extend the space-combat engine** into per-player tactical control or player
  dice. It stays referee-authoritative + players read-only. Future work there is
  presentation polish only (`docs/feature-gap-analysis.md` §7.1).

---

## 6. Suggested sequence & the 1.0 line

| Order | Item | Type | Effort | Gate to 1.0? |
|---|---|---|---|---|
| 1 | §1 Stage 4.5 read cutover | code + migration | 2–3 d | **Yes** |
| 2 | §2a content-model decision | decision | minutes | **Yes** (unblocks everything) |
| 3 | §2b agnostic build → SciFiVTT | ✅ tool shipped; owner pushes | — | **Yes** for public repo |
| 4 | §2c license + hygiene | docs/config | 0.5 d | **Yes** for public repo |
| 5 | §3 gear catalogue / tunables | content | referee's time | No |
| 6 | §4 ship-sheet print + on-device checks | polish | hours | No |

**Call it 1.0 when:** items 1–4 are done — the read leak is closed, advisors are clean,
the repo is publishable with a chosen content model, and a fork gets a clean empty-pack
path. At that point Archon Gambit's tooling is **feature-complete by design**, and the
project shifts from building to maintenance (dependency bumps, real-table bug fixes,
per-campaign content the referee authors).

**First move I'd recommend:** answer §2a (empty starter pack vs. public sample), because
it's a one-line decision that determines whether §1 and §2b are "close the leak" or
"close the leak *and* strip the bundle." Everything downstream sequences off it.

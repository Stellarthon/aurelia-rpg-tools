# Stage 4.5 — Read-Side Cutover (Complete Per-Player Secrecy)

> **Goal:** close the *read* half of the redaction boundary. Stage 4 locked
> **writes** to `aurelia_state` behind `put-state`; but several referee-only
> keys still store referee **prose/stats** in a row that keeps **public
> `SELECT`**, so anyone with the shipped anon key can read them directly. This
> is the open item behind roadmap §7 Tier-3.16 ("Complete per-player secrecy")
> and the follow-up finding in `per-player-redaction-plan.md` §8.
>
> **Status:** Stage 4.5.1 **built (repo artifact, not deployed)**; the rest is
> planned. **No production change** — the get-content extension is additive and
> unused by any shipped client (same posture as Stage 1). Deployment
> (edge-function redeploy + the later migration) is the owner's, applied stage by
> stage exactly like Stages 2–4.
>
> | Sub-stage | State |
> |---|---|
> | 4.5.0 Confirm audit | ⏳ ⚠️-keys pending read-site confirmation |
> | **4.5.1 Extend `get-content`** | ✅ **Built** — `state` (Group-B redacted: combat-encounter, clocks, campaign-events, handouts) + referee `refState`; server redactors parity-tested against the client `redactEncounterForPlayer`. **Redeploy required** (`supabase functions deploy get-content --no-verify-jwt`); additive, safe to deploy anytime. |
> | 4.5.2 Referee read cutover + parity | ⏳ not started |
> | 4.5.3 Player read cutover | ⏳ not started |
> | 4.5.4 Lock rows (migration 0012) | ⏳ not started |
> | 4.5.5 Group D | ⏳ not started |

---

## 1. The precedent this copies

The whisper-notes feature already ships the target shape (2026-07-07):

- the raw `whispers` row is **excluded from the public `SELECT` policy**
  (migration `0011_whispers_select_carveout.sql`),
- reads reach a device **only through `get-content`** — token-checked, redacted
  per identity (`get-content/index.ts` §3b),
- writes go **only through `put-state`** ops that stamp identity server-side.

Stage 4.5 applies that exact pattern to the *pre-existing* secret-bearing keys.
Nothing here is novel infrastructure; it is a per-key cutover using machinery
that is already in production.

## 2. Why it can't be a one-line `DROP POLICY`

Every device — including players — reads shared keys **anonymously** today via
`supaStorage.get()` (the player poll `pollRevealState` in `js/55`, the combat
poll in `js/80`, boot loaders across modules). Dropping `SELECT` on
`aurelia_state` wholesale would blank every player's screen. So the ordering is
the safety mechanism, identical to Stages 2–3:

> **client cutover first → verify parity end-to-end → *then* lock the row.**

And it must be **per-key**, because most of `aurelia_state` is *not* secret
(reveal flags, the clock, the calendar) and must stay anon-readable.

## 3. Two redaction strategies already in the codebase

| Strategy | Example | Row is safe to be public? |
|---|---|---|
| **Redact-at-write** — referee writes only a redacted row; full data stays on the referee device | `initiative` (`pushSharedInitiative`, `js/45`) writes `{id,name,down}` only | **Yes** — already safe, no cutover needed |
| **Redact-at-read (client)** — referee writes the *full* row; every device downloads it and strips locally | `combat-encounter` (`redactEncounterForPlayer` runs *after* `supaStorage.get`, `js/80:96`) | **No** — the secret is on the wire before the strip. This is the leak. |

Stage 4.5 converts every **redact-at-read** key to **server-side redaction**
(the whisper model): the full row loses public `SELECT`, and `get-content`
returns the audience-appropriate projection per token. Where a key already has a
client redactor (e.g. `redactEncounterForPlayer`), that logic is **ported into
`get-content`** so client and server agree — exactly as `canSee()` was mirrored.

## 4. Verified audit — all 46 `REFEREE_ONLY` keys

Source of truth for "referee-only": the `REFEREE_ONLY` set in
`put-state/index.ts` (the audited write list). "Read by players" = reached by a
non-referee code path (`pollRevealState` js/55, combat poll js/80, boot loaders)
— verified by grepping every `supaStorage.get` site. "Secret" = the row holds
referee prose/stats/structure a player must not see.

⚠️ = classification inferred from the key's role; **confirm at the read site
before dropping its `SELECT`** (Stage 4.5.0). A wrong call here is either a leak
(secret left public) or a blank player screen (needed key locked).

### Group A — Safe-public (flags / player-facing). **No change.**
`reveal-status`, `station-clock`, `imperial-date`, `forced-view`,
`rules-index`, `rulebook-config`, `item-catalogue`, `starport-board`,
`hex-paint`, `econ-state`, `econ-priceadj`.
These carry no secret prose; players legitimately read them. `reveal-status` is
already passed through `get-content.reveals`.

### Already-safe — Redact-at-write. **No change.**
`initiative` — the shared row is redacted before it is written (`js/45`).

### Group B — Dual-audience leak → **server-side redaction in `get-content`.**
Players read a *subset*; today the full row ships and is filtered client-side.

| Key | The leak | Redacted projection to serve players |
|---|---|---|
| `combat-encounter` | raw encounter downloaded; `redactEncounterForPlayer` strips *after* | port `redactEncounterForPlayer` (js/80) into `get-content` |
| `clocks` | hidden progress clocks ship alongside revealed ones | return only clocks flagged visible/revealed |
| `handouts` | full metadata incl. per-player-targeted items, filtered by `canSee` after download | filter by `visibleTo` server-side (whisper model) |
| `campaign-events` | referee-visibility events mixed with player-visible | filter by each event's audience |
| `route-blocks` | referee reason/notes on a block | return block geometry + status to nav crew; withhold notes |
| `faction-hidden` | the *list of hidden factions* itself is intel | never send to players; apply hide server-side to faction data |
| `galaxy-lanes` ⚠️ | referee-only lanes present in the row | strip referee-only lanes for players |
| `splash-config` ⚠️ | unrevealed splash prose | return only revealed splashes |
| `ship-roster` ⚠️ | enemy/NPC ship stat blocks read during combat | redact to what the player-side combat view needs |

### Group C — Referee-only reads (players never read). **Exclude from `SELECT`; referee reads via `get-content`.** Lowest risk.
`npc-roster`, `session-plans`, `content-history`, `enc-settings` ⚠️,
`scene-beats` ⚠️, `econ-profiles` ⚠️, `recap-point` ⚠️.
Confirm no non-referee read path, then carve out of `SELECT` and return each to
the referee token in a new `get-content` `refState` block.

### Group D — Design-mode content edits (the hard sub-project).
`content-overrides`, `content-additions`, `content-deletions`,
`body-additions/deletions/prop-overrides`,
`location-additions/deletions/prop-overrides`,
`system-additions/deletions/prop-overrides`,
`faction-additions/deletions/prop-overrides`,
`weapon-additions/deletions/prop-overrides`.

These apply referee edits to campaign data on **every** device, so an *added
secret* (a new hidden NPC, a referee-only body) leaks in full. Unlike Groups
B/C they have **no per-fragment audience** today — a single blob mixes public
and secret edits — so they can't just be filtered. Options, cheapest first:

1. **Tag-on-write.** Extend the design-mode editors (`js/65`, `js/96`) to attach
   an `audience` to each override/addition (reusing the `all`/`referee`/`[names]`
   vocabulary). `get-content` then filters fragments like it already does for
   `campaign_content`. Highest fidelity; most editor work.
2. **Referee-authored content joins `campaign_content`.** Route design-mode
   additions into the same audience-tagged table the base content already uses,
   so they inherit redaction for free. Cleanest long-term; a data-model change.
3. **Interim: treat the whole design-mode delta as `referee` for players** and
   re-fetch the *effective* content server-side. Safe (no leak) but players stop
   seeing referee edits until (1)/(2) lands — a regression, so interim only.

**Recommendation:** Groups B and C first (they close the named leaks —
`npc-roster`, `combat-encounter`, `campaign-events`, `clocks`, `session-plans`
— with existing machinery). Group D is a follow-on with its own mini-plan; until
then it stays honour-system for design-mode edits, explicitly logged, and is the
last thing to gate before declaring §7 Tier-3.16 fully done.

## 5. Staged migration (per key-group, client-first)

Mirrors Stages 2–4. Each stage ships independently and leaves the app working.

- **4.5.0 — Confirm the audit.** Grep every `supaStorage.get` site for each ⚠️
  key; settle Group membership. Output: the final carve-out key list. *(No prod
  change.)*
- **4.5.1 — Extend `get-content` (additive, safe).** Add the Group-B redacted
  projections and a referee-only `refState` block for Group C. Deploy. **Nothing
  reads it yet** → zero risk (same as Stage 1). Port `redactEncounterForPlayer`
  and the `clocks`/`campaign-events`/`handouts` filters server-side.
- **4.5.2 — Referee read cutover + parity.** Referee app hydrates Group-B/C keys
  from `get-content.refState` and compares against the current anonymous read to
  prove byte parity (the Stage-2 discipline). *(No player impact.)*
- **4.5.3 — Player read cutover.** Player poll (`js/55`, `js/80`) reads the
  Group-B redacted projections from `get-content` instead of the raw key.
  Verify end-to-end on a real player token: turn order, combat view, clocks,
  handouts, events all still render — redacted.
- **4.5.4 — Lock the rows.** Migration `0012_carveout_referee_reads.sql`:
  exclude the confirmed keys from the `Allow public read` policy on
  `aurelia_state` (the `whispers`/0011 pattern, generalised to a key list).
  Re-run `get_advisors(security)` until clean. **Rollback:** restore the prior
  `SELECT` policy (SQL in the migration header), exactly like 0010.
- **4.5.5 — Group D.** Its own mini-plan (tag-on-write or table-join per §4).

**Ordering invariant:** a key's `SELECT` is dropped in 4.5.4 **only after** both
referee (4.5.2) and player (4.5.3) reads are proven off `get-content`. There is
never a window where a device needs a key it can no longer read.

## 6. Success metrics (extends `per-player-redaction-plan.md` §6)

| Metric | Target |
|---|---|
| Referee prose readable via anon `SELECT` on `aurelia_state` (npc-roster, session-plans, raw combat-encounter, hidden clocks, referee campaign-events, …) | **0 keys** |
| Player poll still renders after cutover (turn order, combat, clocks, handouts, events) | 100% |
| `get_advisors(security)` findings | 0 critical; no new `rls_policy_always_true` |
| Design-mode secret additions leaking to players (Group D) | 0 — after 4.5.5; until then, logged as known honour-system |

## 7. Effort & caveats

- **Effort:** Groups B+C ≈ **2–3 focused days** (get-content projections + client
  cutover + parity checks + one migration). Group D is a **separate** 2–3 days.
- **Deployment is the owner's.** The Supabase MCP needs per-call approval on a
  live mid-campaign project. This plan ships as repo artifacts (function source +
  migration SQL + client diff) with exact run steps; the owner applies each
  stage deliberately and watches advisors between stages.
- **Poll cost.** `get-content` already carries `whispersOnly` light mode for the
  4 s loop; fold the Group-B projections into the same light response so the poll
  doesn't drag full content every tick.
- **Correctness-critical step = the audit (4.5.0).** One mis-tagged key is a
  silent leak or a blank screen. The 4.5.2 referee-parity check is the backstop.

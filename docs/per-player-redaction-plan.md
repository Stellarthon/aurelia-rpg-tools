# Per-Player Redaction — Design & Implementation Plan

> **Goal:** Make the referee/player information boundary *real*. Today it is
> cosmetic: secrets are delivered to every device and merely hidden with CSS.
> The referee picked **full per-player redaction** (each viewer receives exactly
> their audience, preserving the per-identity reveals such as `.as-rhett` /
> `.as-cass`).
>
> **Status (verified against production 2026-07-07):**
>
> | Stage | State |
> |---|---|
> | **0. Foundations** | ✅ **Complete & verified.** `players` + `campaign_content` live with deny-by-default RLS (0 rows visible to `anon`); 6 tokens issued (1 referee, 5 players); seed at exact parity with `supabase/seed/campaign_content.json` (128 fragments, matching path/audience digest). See §7 verification report. |
> | **1. Edge Function** | ✅ Deployed (`get-content` v4, active, JWT gate off). |
> | **2. Referee cutover** | ✅ Shipped — secure client in `js/55-auth-gating.js` (`hydrateSecureContent`). |
> | **3. Player cutover + strip** | ✅ Shipped — bundle carries no referee literals (`node tools/strip-secrets.mjs --check` exits 0). |
> | **4. Harden** | ⚠️ **In flight, with repo/production drift.** A `put-state` Edge Function (referee-gated `aurelia_state` writes) was deployed 2026-07-06 but the committed client does not call it, and `aurelia_state` still carries public INSERT/UPDATE RLS policies (advisor WARNs). `private-notes` + `upload-object` functions and the `private_notes` table are also live; their sources/migration were back-filled into the repo on 2026-07-07 (`supabase/functions/*`, `migrations/0009`). Stage 4 is **not done** until the client sends state writes through `put-state` and the public write policies on `aurelia_state` are dropped. |
>
> Line anchors below were refreshed 2026-07-07 for the 22-module `js/` split
> (the original `index.html:NNNN` anchors predated it). This doc remains the
> contract for the remaining Stage 4 work.

---

## 1. The actual exposure (corrected)

An earlier sketch assumed an Edge Function filtering the shared `aurelia_state`
store would close the hole. **It would not.** Evidence from the codebase:

| Where secrets actually live | Evidence | Reaches players? |
|---|---|---|
| **Hardcoded JS literals in the shipped bundle** — 35 NPC stat blocks, 46 `checks:`/`degrees:` resolution tables, hidden `rows` (e.g. `["Hidden", …]`), ref notes. Post-split these lived in `js/00-core-data.js` (`BASE_BODIES_AUROS`, :13), `js/20-station-data.js` (`MAIN`, :4), `js/10-galaxy.js` (`GALAXY_NODES`), `js/40-station.js` (`BASE_LOCATIONS`, `TIMED_EVENTS` :503) | historic `index.html:4284`/`:4286`, grep counts | **Was: yes — in full.** Closed by Stage 3: the referee values are stripped from the bundle (`tools/strip-secrets.mjs`) and live only in `campaign_content`. |
| **Shared `aurelia_state` store** | `supaStorage.get/set` (`js/50-supabase.js:222`), keys: `reveal-status`, `station-clock`, `content-overrides`, `discovery-log`, notes | Holds **flags/overlays only** — *not* the secret prose/stats. The module header comment (`js/50-supabase.js:1-10`) confirms this is deliberate: only reveal-status + notes are shared. |
| **Identity** | `myIdentity` is free-text (`js/55-auth-gating.js:195`); `isReferee()` falls back to `!pmCheck.checked` when no token is stored (`js/55-auth-gating.js:207`) | Honor-system — a player can *claim* to be the referee. Closed for content by the token path (`secureRole`); write-path hardening is Stage 4. |

**Conclusion:** redacting `aurelia_state` is necessary-but-insufficient. The
primary leak is the bundle itself. True redaction requires the secret content to
**never be sent** to a player's browser.

## 2. Target architecture

```
                         ┌─────────────────────────────┐
   player device         │  Supabase                   │
  ┌───────────────┐      │                             │
  │ index.html    │      │  ┌───────────────────────┐  │
  │ (PUBLIC shell │─────▶│  │ Edge Fn: get-content  │  │
  │  + player-safe│ token│  │  - verifies token     │  │
  │  content only)│◀─────│  │  - resolves identity  │  │
  └───────────────┘ JSON │  │  - redacts by audience│  │
                         │  └──────────┬────────────┘  │
   referee device        │             │ service role  │
  ┌───────────────┐      │  ┌──────────▼────────────┐  │
  │ index.html    │─────▶│  │ campaign_content      │  │
  │ + ref token   │◀─────│  │  (RLS: no anon SELECT)│  │
  │  → full data  │ JSON │  │ players(token,aud[])  │  │
  └───────────────┘      │  └───────────────────────┘  │
                         └─────────────────────────────┘
```

Four pieces:

1. **Content extracted out of the bundle.** Move the hardcoded campaign data
   (bodies, NPCs, checks, hooks, notes) into a server table `campaign_content`,
   each *field-or-record tagged with an audience* (`all` / `referee` /
   `["Rhett Calder", …]`) — the same vocabulary `canSee()` already uses
   (`js/55-auth-gating.js:222`). The shipped bundle keeps only `audience:'all'` content as a
   fallback/offline shell; everything else loads at runtime.

2. **Per-player auth.** A `players` table maps an opaque token → identity →
   allowed audiences. The referee gets a distinct referee token. Tokens are
   generated by the referee and handed to each player once (QR/link). This
   replaces free-text `myIdentity` as the *gating* key (it can still display the
   friendly name).

3. **`get-content` Edge Function.** Runs with the service role, reads the full
   `campaign_content`, and returns **only** the records/fields whose audience the
   caller's token permits. Port `canSee()`'s logic verbatim so client and server
   agree. Same function backs the poll loop (returns reveal-state filtered too).

4. **RLS lockdown.** Revoke anon `SELECT` on `campaign_content` and `players`;
   only the Edge Function (service role) reads them. `aurelia_state` reveal-flags
   may stay anon-readable (they're not secret), but writes should require the
   referee token.

### Edge Function contract

```
POST /functions/v1/get-content
  headers: { Authorization: "Bearer <player-or-referee-token>" }
  body:    { since?: <timestamp> }          // for incremental poll
  →  200 { identity, role, content, reveals } // redacted to this token
     401 if token invalid
```

`content` is the audience-filtered campaign data the client renders. A player
**never receives** a record tagged `referee` or tagged for another identity.

## 3. Client changes (shipped bundle — now the `js/` modules)

- Replace the hardcoded `MAIN` / body / NPC / check literals with an empty-then-
  hydrated store populated from `get-content` on load.
- Add a one-time token entry (paste link / scan) → stored locally; sent on every
  request. Remove the honor-system identity text field as the *trust* mechanism
  (keep it only as a display label derived from the token).
- Repoint `pollRevealState()` (`js/55-auth-gating.js:508`) and the load* functions at `get-content`.
- Keep `canSee()` for *rendering* convenience, but it is now defence-in-depth —
  the server has already removed anything the viewer may not see.

## 4. Staged, non-breaking migration

Each stage is independently shippable and leaves the app working:

| Stage | Work | Risk | Breaks live app? |
|---|---|---|---|
| **0. Foundations** | Create `players` + `campaign_content` tables, RLS policies, referee token. Seed `campaign_content` from an extraction script. | Low | No — additive |
| **1. Edge Function** | Build & deploy `get-content`; verify it redacts correctly with test tokens. Client does **not** use it yet. | Low | No |
| **2. Referee cutover** | Referee app loads full content from `get-content` (with referee token); compare against hardcoded to prove parity. | Med | No (players unchanged) |
| **3. Player cutover** | Players switch to token + `get-content`; **then** strip referee content from the shipped `index.html`. | **High** | Yes if mis-sequenced — strip the bundle **only after** player fetch is verified end-to-end. |
| **4. Harden** | Move `aurelia_state` writes behind referee token; run `get_advisors` (security) until clean. | Low | No |

**The ordering is the safety mechanism.** Secrets are removed from the bundle
(Stage 3) only once the authenticated path is proven, so there is never a window
where players both lack the data *and* can't load the game.

## 5. Effort & honest caveats

- **Effort:** realistically **3–5 focused days**, dominated by (a) the content
  extraction script that correctly lifts every audience-tagged field out of the
  ~25k-line codebase (now split across the `js/` modules) without dropping or
  mis-tagging anything, and (b) the Stage-3 client rewrite + verification.
- **I cannot deploy this for you.** The Supabase MCP requires per-call approval
  and this is your production project mid-campaign. I will deliver the migration
  SQL, the Edge Function source, and the extraction script as repo files with
  exact run steps; **you** apply them deliberately, stage by stage.
- **Extraction is the correctness-critical step.** A field that the script fails
  to tag as `referee` and leaves in the public shell is a silent leak. Stage 2's
  referee-vs-hardcoded parity check exists to catch exactly this.
- **Tokens are the new secret.** Their security now rests on token secrecy and
  RLS; document token rotation and treat a leaked referee token as a full breach.

## 6. Success metrics

| Metric | Target |
|---|---|
| Referee-only content present in a player's downloaded HTML/network payload | **0 bytes** |
| Player can read another identity's gated content via token tampering | No (401 / filtered) |
| Referee content parity after Stage 2 (server vs. old hardcoded) | 100% |
| `get_advisors` security findings on the project | 0 critical |

## 7. Stage 0 verification report (2026-07-07)

Read-only audit of the production project (`rarxefzcqvgqvxutprcq`) against this
plan; **no schema or data changes were made** — Stage 0 was found already
applied and was verified in place.

**What was run**

| Check | Method | Result |
|---|---|---|
| Tables exist with RLS enabled | `list_tables` | `players` (6 rows) and `campaign_content` (128 rows) present, RLS **on** for both |
| Deny-by-default (no policies) | `pg_policies` | **Zero** policies on `players` / `campaign_content` — matches migration 0001 exactly |
| Anon key really gets nothing | `SET LOCAL ROLE anon` row counts | `players` 0 · `campaign_content` 0 · `private_notes` 0 · `aurelia_state` 47 (reveal flags — intentionally readable until Stage 4) |
| Seed parity repo ↔ production | md5 over sorted `path\|audience` pairs | **Identical** — 128 fragments, 91 distinct paths, digest `6dbf5c…db6c` both sides |
| Tokens issued | `players` (identities/roles only — token values never selected) | 1 referee + 5 players (Rhett Calder, Cassia Velen, Riven Dahl, Dr Curculion, Riley), each with a matching single-identity audience list |
| Edge function state | `list_edge_functions` | `get-content` v4 ACTIVE, `verify_jwt=false` (required — see `supabase/README.md`) |
| Bundle strip | `node tools/strip-secrets.mjs --check` | exit 0 — no referee literals in the shipped bundle |
| Security advisors | `get_advisors(security)` | **0 critical/error.** 4× INFO `rls_enabled_no_policy` on `players`/`campaign_content`/`network_lock`/`private_notes` — this is the *intended* deny-by-default design (service-role-only access). 2× WARN `rls_policy_always_true` on `aurelia_state` public INSERT/UPDATE — **that is precisely the Stage 4 work item**, expected to remain until Stage 4 lands. 4× WARN `public_bucket_allows_listing` on the storage buckets — out of this plan's scope (see migration 0008, a deliberate restore). |

**Drift found and captured (repo was behind production)**

The 2026-07-06 session(s) deployed changes that were never committed. This PR
back-fills the repo so a redeploy from git cannot regress production:

- `get-content` v4 source (adds the Finding-6 fix: rightmost-entry
  `x-forwarded-for` parsing so a player cannot spoof the referee's IP past the
  venue network lock) → `supabase/functions/get-content/index.ts` updated.
- `put-state`, `private-notes`, `upload-object` function sources committed
  (`supabase/functions/…`), with `verify_jwt = false` entries in `config.toml`.
- `private_notes` table recorded as `migrations/0009_private_notes.sql`
  (already applied in production; file is the git record, idempotent).

**Remaining before Stage 4 can be called done:** wire the client's shared-state
writes through `put-state`, then drop the public INSERT/UPDATE policies on
`aurelia_state`, then re-run the advisors (the two WARNs must clear).

# Supabase — per-player redaction (server-side pieces)

Server-side pieces for the per-player redaction plan
(`../docs/per-player-redaction-plan.md`). **Deployment state (verified
2026-07-07):** Stages 0–3 are live in production — the tables exist and are
seeded, `get-content` is deployed, and the shipped bundle is stripped. The
steps below are kept as the runbook for re-applying/re-seeding and for the
remaining Stage 4 work. The repo is the source of truth: **redeploy functions
from these files only**, never hand-edit in the dashboard (the 2026-07-06
session's dashboard-side deploys had to be back-filled into git).

```
supabase/
  migrations/0001_per_player_redaction.sql   players + campaign_content tables, RLS
  migrations/0009_private_notes.sql          private_notes table (record of live schema)
  functions/get-content/index.ts             authenticated, per-identity content API
  functions/put-state/index.ts               referee-gated aurelia_state writes (Stage 4)
  functions/private-notes/index.ts           per-identity private notes (token-gated)
  functions/upload-object/index.ts           token-gated storage uploads
  seed/                                       generated — DO regenerate, don't hand-edit
    campaign_content.json                     the audience-tagged fragments
    campaign_content.seed.sql                 ready-to-run seed (SQL editor)
    classification-report.md                  ← REVIEW THIS FIRST
```

## Step 1 — Regenerate & review the content (Stage 0)

```bash
node tools/extract-content.mjs        # reads index.html → supabase/seed/*
```

Open `seed/classification-report.md` and confirm:
- **0 fail-closed defaults** (or review any that appear).
- The "current-render leaks this migration fixes" section — e.g. `MAIN.*.desc`
  used to leak to players from the baked-in literals (historic `index.html:5954`,
  now `js/20-station-data.js`); redaction closed it.
- Spot-check the player-visible (`all`) list: nothing secret should be there.

> The report is the human gate. Don't seed until the `all` list looks right.

## Step 2 — Create the tables (Stage 0)

Run `migrations/0001_per_player_redaction.sql` in the Supabase SQL editor (or
`supabase db push`). It enables RLS with **no anon policies**, so the publishable
key cannot read either new table.

## Step 3 — Seed the content (Stage 0)

Run `seed/campaign_content.seed.sql` in the SQL editor. Idempotent — re-running
refreshes values. Then create tokens:

```sql
-- Referee: sees everything.
insert into public.players (token, identity, role)
values (gen_random_uuid()::text, 'Referee', 'referee');

-- One per player; audiences must match the identity strings used in canSee().
insert into public.players (token, identity, role, audiences)
values (gen_random_uuid()::text, 'Rhett Calder', 'player', '["Rhett Calder"]'::jsonb),
       (gen_random_uuid()::text, 'Cassia Velen', 'player', '["Cassia Velen"]'::jsonb);

select identity, role, token from public.players;  -- hand each token out once
```

## Step 4 — Deploy the Edge Function (Stage 1)

```bash
supabase functions deploy get-content --no-verify-jwt
```

**⚠ JWT verification MUST be off for this function.** Our bearer token is our own
opaque player/referee token, not a Supabase JWT — with the platform's JWT gate on,
the gateway returns 401 *before* the function runs (the cause of the
"Secure content unavailable" toast). `config.toml` sets `verify_jwt = false` for
CLI deploys; if you deployed via the **dashboard**, open the function → **Details/
Settings** and turn **OFF** "Verify JWT" / "Enforce JWT verification", then
redeploy the (updated) source.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform — no
manual key handling, and the service-role key never leaves the server.

## Step 5 — Verify redaction (Stage 1 acceptance gate)

```bash
URL=https://rarxefzcqvgqvxutprcq.supabase.co/functions/v1/get-content

# Player token: must contain ZERO referee fragments.
curl -s -X POST $URL -H "Authorization: Bearer <PLAYER_TOKEN>" \
  | grep -c '"audience":"referee"'        # expect: not present in any value

# Referee token: returns everything.
curl -s -X POST $URL -H "Authorization: Bearer <REFEREE_TOKEN>" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(len(d["content"]),"fragments")'

# Bad token: 401.
curl -s -o /dev/null -w "%{http_code}\n" -X POST $URL -H "Authorization: Bearer nope"
```

Acceptance: a player payload contains **0 bytes** of referee content (the
function only ever returns `{path, value}` for fragments the token may see); a
bad token gets `401`; referee parity matches the old hardcoded data.

Once this passes, proceed to the client cutover (Stages 2–3 in the plan) — and
strip the referee content from `index.html` **only after** the player path is
verified end to end.

## Step 6 — Stage 2 client (already in index.html, default OFF)

`js/55-auth-gating.js` contains the secure-content client (`hydrateSecureContent`
et al.). **It is a no-op until a token is stored**, so the live app is unchanged.
To test the per-player path in a browser:

```js
// In the browser devtools console, on the deployed map:
setContentToken('<RHETT_TOKEN>'); location.reload();   // load as a player
```

On reload the client strips the baked-in referee fields, fetches `get-content`,
and applies only this token's fragments. Verify:
- Referee-only content (NPC stat blocks, checks, "Referee Context", RSR tags) is
  **gone** from station/body views.
- Player-safe content (read-aloud, body names, descriptions) is intact.

```js
setContentToken('<REFEREE_TOKEN>'); location.reload();  // load as referee → secrets return
setContentToken(''); location.reload();                 // disable secure mode → hardcoded data
```

> **Stage 2 fails to *usability*** (a fetch error keeps the hardcoded data and
> shows a toast) so a bad token can't brick the map mid-session. **Stage 3** makes
> secure mode the default, strips the referee literals from the shipped file, and
> switches to fail-*closed* — do that only after the above is confirmed on-device.

## Step 7 — Stage 3: de-bake the secrets (`tools/strip-secrets.mjs`)

**Coverage is now complete.** The extractor and strip cover all five
secret-bearing structures: `BASE_BODIES_AUROS`, `MAIN`, `GALAXY_NODES`,
`BASE_LOCATIONS`, and `TIMED_EVENTS` (the GM-only event log). Generic GM tooling
(`ARCHON_BANDS`, `NPC_GEN`, the `ORACLE_*` / rumour / encounter tables) is
intentionally kept in the bundle as non-secret.

**Order matters — the server must have the content before the bundle loses it:**

1. **Re-seed** with the expanded content (it now includes locations + the
   timeline): re-run `seed/campaign_content.seed.sql` in the SQL editor.
2. **Re-verify** redaction (the §Step 5 SQL/curl checks) — a player must still
   get `0` referee fragments; a referee now gets the full **128** fragments.
3. **De-bake the bundle:** `node tools/strip-secrets.mjs` rewrites `index.html`,
   removing all referee literals (a player's downloaded HTML → 0 bytes of
   secrets). The tool **aborts** if any secret structure isn't covered, so it
   can't produce a partial strip. Re-runnable / idempotent.
4. After this, a referee **must** load a referee token (Settings → Secure
   Content) to see referee content — it's no longer in the file. Secure-by-
   default and fail-closed then come for free (no secrets remain to fall back to).

Publish the stripped `index.html` only after steps 1–2 pass.

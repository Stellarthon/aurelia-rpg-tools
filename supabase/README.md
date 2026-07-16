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

## Step 8 — Stage 4: lock `aurelia_state` writes ✅ DONE (2026-07-07)

Applied on the owner's go-ahead: migration 0010 dropped the anonymous
INSERT/UPDATE policies (`Allow public read` kept); `put-state` v2 requires a
valid token for every write and the referee token for the 46 referee-only
keys; the v42 client routes all writes through it. Post-apply advisors: both
`aurelia_state` `rls_policy_always_true` WARNs cleared.

- **Publish v42 promptly** — v41 devices' writes queue locally against the
  locked table and only flush (via `put-state`) once the device reloads v42
  with a token stored.
- Every device needs a token (Settings → Secure Content) for writes now —
  tokenless devices are read-only + local queue.
- Rollback if the table stalls (instant): re-create the two policies — SQL is
  in the migration's header comment.

> **Known follow-up (read side):** `aurelia_state` still allows public SELECT,
> and some referee-only keys hold referee prose (`npc-roster`,
> `session-plans`, raw `combat-encounter`, unrevealed `clocks`,
> `campaign-events`). Closing that needs a staged read cutover through
> `get-content` — see the plan doc §8. Do NOT just drop the SELECT policy;
> today every device reads shared keys anonymously and would break.

## Step 9 — Whisper notes (table plan §8) — deploy for build v43

Whisper notes (secret player→referee notes, `docs/table-presentation-plan.md`
§8) need three server-side pieces, all committed here. Order doesn't matter
much — nothing live touches the `whispers` key until the v43 client is
published — but do all three **before publishing v43**:

1. **Redeploy both functions from the repo files** (never the dashboard copy):

   ```bash
   supabase functions deploy put-state  --no-verify-jwt   # adds whisper append/resolve ops
   supabase functions deploy get-content --no-verify-jwt  # adds whispers + {whispersOnly:true} poll mode
   ```

2. **Apply `migrations/0011_whispers_select_carveout.sql`** (SQL editor). It
   re-creates `Allow public read` on `aurelia_state` excluding only the
   `whispers` row, so whisper text can never be read with the shipped anon
   key. Everything else keeps today's reads; instant rollback SQL is in the
   migration header.

3. **Verify** (mirrors the E2E suite's server checks):

   ```bash
   URL=https://rarxefzcqvgqvxutprcq.supabase.co/functions/v1

   # Player appends a whisper — the server stamps from/visibleTo itself.
   curl -s -X POST $URL/put-state -H "Authorization: Bearer <PLAYER_TOKEN>" \
     -H 'Content-Type: application/json' \
     -d '{"key":"whispers","append":{"text":"deploy check — ignore"}}'

   # That player's poll returns their item; ANOTHER player's poll returns [].
   curl -s -X POST $URL/get-content -H "Authorization: Bearer <PLAYER_TOKEN>" -d '{"whispersOnly":true}'
   curl -s -X POST $URL/get-content -H "Authorization: Bearer <OTHER_PLAYER>" -d '{"whispersOnly":true}'

   # Raw anon read of the row is refused (migration 0011): expect []
   curl -s "https://rarxefzcqvgqvxutprcq.supabase.co/rest/v1/aurelia_state?key=eq.whispers&select=value" \
     -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"

   # Whole-array forgery is refused for every role: expect 403
   curl -s -o /dev/null -w '%{http_code}\n' -X POST $URL/put-state \
     -H "Authorization: Bearer <PLAYER_TOKEN>" -H 'Content-Type: application/json' \
     -d '{"key":"whispers","value":"[]"}'
   ```

   Clean up the deploy-check item afterwards: referee opens ⋯ More →
   Whispers and resolves it (or `delete from aurelia_state where
   key='whispers';` to reset the thread entirely).

   Then run the acceptance pass from the plan §8 on two real devices, and
   `get_advisors` (security) — expect no new findings (the carve-out narrows
   an existing public policy; it grants nothing).

## Step 10 — Design-Mode overlays & media (build v114)

Design Mode grew a large set of referee overlays (reference tables, generators,
economy flavour, UI theme/panels) and a **media layer** (portraits + scene art).
Two server-side pieces:

**1. Redeploy `put-state`** so its referee-only key list covers every new overlay.
`supabase functions deploy put-state --no-verify-jwt`. The list now also gates:
`content-*`, `body-*`, `location-*`, `system-*`, `faction-*`, `weapon-*`,
`galaxy-lanes`, `hex-paint`, `route-blocks`, `trade-good-*`, `generator-overrides`,
`rules-overrides`, `contract-overrides`, `theme-overrides`, `panel-flags`,
`npc-portraits`, `scene-images`, and any `<key>-ref` suffix. These are
public-**read** (they're the shared campaign look/data, not secrets — unlike the
`-ref` blobs), referee-**write** only. Also redeploy `get-content` and apply
migration `0014` per `../docs/design-mode-redaction.md` (the redaction split).

**2. Apply `migrations/0015_scenes_bucket.sql`** (SQL editor) — a public `scenes`
Storage bucket for the establishing images a referee attaches to a place. It backs
scene art across **body locations, station areas, star systems, and regions**
(same overlay, keyed `bl-*` / `sa-*` / `sys-*` / `region-*` in the shared
`scene-images` version key). Public-read, referee-only upload gated client-side —
the same honour-system model as the `portraits`/`handouts`/`deck-maps` buckets.
Instant rollback is `delete from storage.buckets where id='scenes';`.

**NPC portraits need no new migration** — they reuse the existing `portraits`
bucket (migration 0002) under an `npc/` sub-path.

Until 0015 is applied, scene-art uploads toast "is the scenes bucket set up?
(migration 0015)" and missing images hide themselves; every other overlay
(including NPC portraits) works from the `put-state` redeploy alone.

Verify (referee token):

```bash
URL=https://rarxefzcqvgqvxutprcq.supabase.co
# Upload a system scene image, then confirm the public object resolves.
# (Easiest end-to-end: in the app, Design Mode → select a system → 🖼 Add scene
#  image; a reload on a player device shows it under the system panel.)
curl -s -o /dev/null -w '%{http_code}\n' \
  "$URL/storage/v1/object/public/scenes/<campaignSlug>/sys-<slug>.jpg"   # expect 200

# A player token still cannot write the referee-only keys: expect 403.
curl -s -o /dev/null -w '%{http_code}\n' -X POST $URL/functions/v1/put-state \
  -H "Authorization: Bearer <PLAYER_TOKEN>" -H 'Content-Type: application/json' \
  -d '{"key":"scene-images","value":"{}"}'
```

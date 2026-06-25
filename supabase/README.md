# Supabase — per-player redaction (Stages 0 & 1)

Server-side pieces for the per-player redaction plan
(`../docs/per-player-redaction-plan.md`). **Nothing here is deployed** — these
are reviewable files you apply deliberately, in order. Stages 0 and 1 are
**additive and cannot break the live app**: the client still uses its hardcoded
data until the Stage 2/3 client cutover (not in this changeset).

```
supabase/
  migrations/0001_per_player_redaction.sql   players + campaign_content tables, RLS
  functions/get-content/index.ts             authenticated, per-identity content API
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
  currently leaks to players (`index.html:5954`); redaction closes it.
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
supabase functions deploy get-content
```

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

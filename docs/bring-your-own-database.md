# Bring your own database

By default the app talks to one shared Supabase project (the canonical Aurelia
campaign). Any referee can instead point the app at **their own Supabase
project**, so their campaign's state lives in a database they control. This is a
per-device setting — nothing about the shared default changes for anyone else.

## What gets swapped (and what doesn't)

| Data | Source when you use your own DB |
| --- | --- |
| Campaign state — reveals, clock, quests, ship, notes, sheets, combat, etc. (the `aurelia_state` table) | **Your project** |
| Planet-surface globe textures (the public `globes` storage bucket) | Always the canonical project — nothing to re-host |

Only the data table moves. Texture assets stay shared, so your players still get
the full globe library for free.

## Setup (about 5 minutes)

1. Create a free project at [supabase.com](https://supabase.com).
2. Open the project's **SQL Editor**, paste the snippet below, and click **Run**:

   ```sql
   -- Aurelia RPG Tools — campaign data table
   create table if not exists aurelia_state (
     key        text primary key,
     value      text,
     updated_at timestamptz default now()
   );

   alter table aurelia_state enable row level security;

   -- Same honour-system posture as the shared DB: the publishable key may read
   -- and write campaign state. (Spoiler control is client-side, not enforced here.)
   create policy "aurelia_state read"   on aurelia_state for select using (true);
   create policy "aurelia_state write"  on aurelia_state for insert with check (true);
   create policy "aurelia_state update" on aurelia_state for update using (true) with check (true);
   ```

3. In **Project Settings ▸ API**, copy your **Project URL** and your
   **publishable (anon) key**.
4. In the app, open **Database settings** — click the sync pill in the header
   (top of the screen), or use the *"Use your own database"* link on the access
   screen.
5. Paste the URL and key, click **Test connection** to confirm the table is
   reachable, then **Save & reload**.

The same two values (URL + key) are what your players enter on their devices so
everyone shares your campaign's database.

## Switching back

Open Database settings again and click **Reset to shared DB**. Switching projects
(either direction) clears this device's local sync cache and outbound queue so the
new project loads clean — one campaign's state never bleeds into another's. Your
local identity and private notes are left untouched.

## Security note

This mirrors the shared database's posture: the publishable key is visible in the
page and the row-level policies allow anyone with it to read and write the table.
Audience/spoiler gating happens in the UI, not in the database. Using your own
project gives you **isolation** (a separate database per campaign), not
cryptographic access control. Don't store anything in `aurelia_state` that would
be damaging for a determined player to read.

## How it works (for maintainers)

- Config lives in `localStorage` under `aurelia_db_config` as `{url, key}`.
  Absent or malformed → the canonical `DEFAULT_SUPABASE_URL` / `DEFAULT_SUPABASE_KEY`.
- `applyDbConfig()` derives the live `SUPABASE_URL` / `SUPABASE_KEY` /
  `SUPABASE_REST` endpoints at startup; the `supaStorage` adapter reads those at
  call time, so the offline cache/queue/poll machinery is unchanged.
- `TEXTURE_BASE` and `loadTextureCatalog()` are pinned to the canonical project
  regardless of override.
- Saving writes the override, clears DB-scoped local state, and reloads so every
  boot loader re-reads from the new project.

See `index.html` — search for `DB_CONFIG_KEY` and `openDbSettings`.

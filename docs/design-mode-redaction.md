# Design-Mode overlay redaction

## The leak this closes

The shipped campaign data is redacted two ways: referee-only fields are **de-baked**
out of the JS bundle (`tools/strip-secrets.mjs`) and served per-audience through the
`get-content` edge function. But a referee's **Design-Mode edits** don't live in the
bundle — they live in overlay blobs in the public `aurelia_state` KV table:

- `content-overrides`, `content-additions`, `content-deletions`, `content-history`
- `body-additions`, `body-prop-overrides`, `body-deletions`
- `location-additions`, `location-prop-overrides`, `location-deletions`
- `system-additions`, `system-prop-overrides`, `system-deletions`
- `station-additions`

Every one of those can carry a referee-only field — `refNote`, `hook`, `npcs`,
`checks`, `events`, `rsr`, station-area `desc` (Referee Context), `refnotes` — and the
table has a public SELECT policy, so an edited/added secret reached player devices
unredacted (and the live-sync poll actively fetched `body-*`/`location-*`). Editing a
secret re-exposed exactly what de-bake had stripped.

## The mechanism (two copies + a carve-out)

Each store that can carry a secret is a **split store**. On save the referee writes:

- **`<key>`** — a copy with referee-only fields stripped (`stripOverlayForPlayers`),
  which players read exactly as before.
- **`<key>-ref`** — the FULL copy, carved out of public read (migration 0014) and
  writable only by a referee token (`put-state`).

Referees read the full data back from `<key>-ref` through `get-content` (which runs
with the service role and verifies the caller is a referee). Players never receive a
`-ref` row and never receive an unstripped overlay.

| Piece | File | Role |
|-------|------|------|
| Field lists | `js/55` `REDACT_FIELDS` | the referee-only fields (shared with de-bake) |
| Stripper + key classifier | `js/55` `stripOverlayForPlayers`, `isRefOnlyContentKey`, `_OVERLAY_STRIP`, `isSplitStore` | produce the player-safe copy |
| Split save | `js/50` `mergedSaveStore` | write stripped→`<key>`, full→`<key>-ref` |
| Role-aware read | `js/50` `getOverlayStore`, `_refOverlays` | referee→full, player→stripped |
| Referee delivery | `supabase/functions/get-content` | returns `designRef` (full blobs) to referees |
| Write gate | `supabase/functions/put-state` | `-ref` suffix ⇒ referee-only write |
| Read carve-out | `supabase/migrations/0014_overlay_ref_carveout.sql` | `-ref` rows excluded from public SELECT |
| Boot re-load | `js/55` `reloadDesignOverlays` | referee loaders re-run once `_refOverlays` is populated |

`content-overrides` mixes player-visible text (read-aloud, body/location Overview) and
referee-only text, so it's classified **per key** (`isRefOnlyContentKey`); the other
stores are stripped **per field**. `content-additions/-deletions/-history` are wholly
referee-only (checks/events/NPC rows), so their public copy is empty.

## Deploy order (important)

The `-ref` rows are publicly readable **until** migration 0014 is applied, so ship in
this order to avoid either a gap or a referee outage:

1. **Deploy the edge functions** — `get-content` (returns `designRef`) and `put-state`
   (`-ref` write gate). `supabase functions deploy get-content put-state --no-verify-jwt`.
2. **Ship the client** (this commit). From now on every referee save writes the stripped
   public copy + the `-ref` copy; players immediately stop receiving secrets through the
   default read path. Referees read `-ref` via get-content (falling back to a direct read
   for rows not yet migrated).
3. **Apply migration 0014** — carves `-ref` out of public read, closing the residual
   "a player manually fetches `<key>-ref`" gap. After this, referees rely on get-content
   for `-ref` (the direct-read fallback stops working, which is why step 1 comes first).

Between steps 2 and 3 the default player path is already redacted; only a hand-crafted
fetch of a `-ref` key could still read a secret. Existing edits become safe the first
time the referee re-saves each store (or you can re-save all from **My Design Edits**).

## Verification checklist (run against the deployed project)

- [ ] As a **player** token, `POST get-content` → response has no `designRef`; a direct
      `GET aurelia_state?key=eq.body-additions-ref` returns `[]` (carved out).
- [ ] As a **player**, fetch `aurelia_state?key=eq.body-additions` → the blob contains no
      `refNote`/`hook`/`npcs`/`checks`/`events` and no Referee Context.
- [ ] As a **referee**, edit a Referee Note / add an NPC / retexture a world, reload →
      the edit is still there (read back from `-ref` via get-content).
- [ ] As a **player** token, `POST put-state {key:"body-additions-ref", value:"{}"}` → 403.
- [ ] Two devices with the same identity: a referee still sees their secrets; a player
      never does.

## Known trade-offs

- **Merge degrades to last-write-wins for `-ref` stores after migration 0014.**
  `mergedSaveStore` re-reads `<key>-ref` directly for its 3-way merge; once that row is
  carved out of public read the re-read returns empty and the save falls back to
  last-write-wins (the pre-merge baseline). The public copy is always correct because it
  is derived from the referee's full in-memory state. Multi-referee field-level merge for
  these stores would require routing the merge re-read through get-content too — a later
  refinement.
- **Reserved suffix.** `-ref` is now a reserved key suffix for referee-only full blobs;
  application code must not use a bare `-ref` key for any player-readable value.
- **Offline referee boot** uses the cached get-content payload, which does not persist
  `designRef`; such a boot falls back to the direct `-ref` read (fine pre-migration) or
  the redacted public copy until the next live fetch.

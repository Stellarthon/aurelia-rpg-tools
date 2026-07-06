# Archon Gambit — security hardening rollout

This branch (`claude/archon-gambit-pentest-ord98j`) fixes the pentest findings. Some
fixes are **live now**; the write/upload lockdown is **staged** because it can only
be enforced once every device holds a token, or the live app breaks for anyone
without one. This file is the ordered runbook for the staged part.

## Already applied to the live project (`rarxefzcqvgqvxutprcq`)

| Finding | What | Where |
|--------|------|-------|
| 1 (CRITICAL) stored XSS | escape/sanitise every anon-writable sink + CSP meta | client only — ships with the build |
| 6 (MED) network-lock IP spoof | `get-content` uses the trusted (rightmost) XFF hop | edge function **deployed** (v4) |
| 7 (MED) error_log abuse | length CHECKs + prune trigger + non-trivial INSERT policy + revoke prune EXECUTE | migration **0008 applied** |
| 2a (HIGH) bucket enumeration | dropped anon list/SELECT on portraits/handouts/rulebooks/session-docs + globes; shipped static texture manifest | migration **0009 applied** + client |

After the above, the security advisors show only two `rls_policy_always_true`
warnings, both on `aurelia_state` writes — cleared by step 4 below.

## Staged: token-gated writes & uploads (Findings 4, 5, 2c)

Everything for this is committed — three edge functions, the client wiring
(token-present → edge function, no token → legacy direct path, so nothing changes
until you flip), and the flip migrations. **Do the steps in order.** Do not apply
`0011`/`0012` early.

1. **Apply the additive table migration** (safe, non-breaking):
   - `0010_private_notes.sql` — creates `private_notes` (deny-by-default RLS).
2. **Deploy the edge functions** (all with `--no-verify-jwt`, like get-content —
   the bearer is our `players` token, not a Supabase JWT):
   - `put-state`, `private-notes`, `upload-object`.
3. **Ship the client build** on this branch. With no token stored, every new path
   falls back to the existing direct anon path, so this is safe to ship before the
   flip. Verify sync/offline/upload still work for a tokenless device.
4. **Provision a token for every participant device.** Tokens already exist in the
   `players` table and are handed out via the referee's token vault / invite links
   (`#token=…`). Each device must load its token (stored as `aurelia_token`) so its
   writes route through `put-state`/`upload-object`. Confirm each device shows its
   identity from the token.
5. **Flip enforcement** (this is what closes Findings 4/5/2c and the last advisories):
   - `0011_lock_state_writes.sql` — drop anon INSERT/UPDATE on `aurelia_state`.
   - `0012_lock_storage_writes.sql` — drop anon INSERT/UPDATE on the four buckets.
6. **(Optional) purge legacy leaks:** delete `note-private-%` rows from
   `aurelia_state` (see the commented statement in `0010`) so old private notes stop
   being anon-readable. New private notes already go to `private_notes`.

Reads stay anon throughout (Finding 4c): `aurelia_state` keeps its SELECT policy so
the poll loop and offline reads keep working; public buckets keep serving
`/object/public/…` for viewing.

### Rollback

Each flip is just dropped policies — re-create them from `0002`–`0007` / the
original `aurelia_state` policies to revert. The client's direct-path fallback then
takes over again automatically for tokenless devices.

## Documented residual — Finding 2b (real privacy for sensitive buckets)

`handouts` / `session-docs` / `portraits` are still `public=true`, so anyone with a
direct object URL can view them (enumeration is closed, but the URL is guessable for
handouts/session-docs since the path is a per-doc id, and portraits are a name slug).
Full privatization = set those buckets `public=false` and serve via short-lived
**signed URLs** minted by a token-gated function, with the client resolvers
(`handoutUrlFor` / `plannerDocUrlFor` / `portraitUrlFor`) requesting a signed URL
instead of building a public one. That function + resolver change is the remaining
piece; it was scoped out of this pass (the prompt allows 2a + 2c minimum with 2b
documented). Until then the residual exposure is: **viewable-if-URL-known**, not
listable and not overwritable (once step 5 lands).

## Note on `<meta>` CSP limits

`frame-ancestors` and `X-Content-Type-Options` are header-only and ignored in a
`<meta>` CSP. Setting them (clickjacking / MIME-sniff protection) requires fronting
GitHub Pages with a CDN that can add response headers.

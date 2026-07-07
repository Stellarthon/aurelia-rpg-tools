# Implementation prompt — Phase 5 (optional): Whisper notes

> Paste everything below this line into a fresh session on a new feature
> branch. **Hard prerequisite: Phase 4 Stage 4 (hardening) of
> `docs/per-player-redaction-plan.md` is merged and verified.** Before that,
> whispers would ride the world-readable `aurelia_state` KV and be
> honour-system "private" — unacceptable for secret notes. If Stage 4 is not
> done, stop and say so. Also confirm with the referee that the table
> actually wants this — the plan marks it build-only-if-needed.

---

Implement **Phase 5 (Whisper notes)** of `docs/table-presentation-plan.md`
§8. Read plan §8 and §1's non-goals first. Re-verify all `js/NN:line`
anchors against the current tree — several phases have landed since they
were recorded (2026-07-07).

## Objective

The one in-person use case for "chat": a player passes the referee a secret
note ("I pocket the data crystal") without the table seeing, and the referee
can reply privately. **This is not a chat system** — no player↔player
messages, no group channel, no typing indicators, no history browser beyond
a simple list. The group shares a physical room; talking is faster for
everything else.

## Hard requirements

1. **Data:** KV key **`whispers`** via the `supaStorage` façade — an array of
   `{id, from, ts, text, resolved}`. Referee replies are items with
   `visibleTo: [sender]`, reusing the same audience mechanics as the
   contacts/wiki features (`canSee(audience)`, `js/55-auth-gating.js:219`).
   Post-Stage-4 this key must fall under the hardened write path like every
   other KV key — verify it does, don't special-case it.
2. **Player side:** a one-line composer in the player tools area — text
   field, send, and a short list of their own whispers with the referee's
   replies. A player sees **only** their own thread (`canSee` gating +
   server-side redaction via the Stage 3/4 content path — confirm which
   applies to this key and state it in the PR).
3. **Referee side:** a compact panel listing whispers newest-first with an
   unread badge, inline reply, and a "resolved" toggle that collapses the
   item. Referee-only via `isReferee()` (`js/55:204`).
4. **Notification, existing plumbing only:** the referee learns of a new
   whisper through the existing player-poll cycle diffing the key
   (`pollRevealState`, `js/55:505`) plus a `showToast`
   (`js/92-tools-misc.js:740`). Players learn of replies the same way on
   their next poll. **No Web Push, no service-worker notifications, no new
   polling loop** — those are recorded non-goals.
5. **Table discretion:** no sound on whisper arrival (a chime at a quiet
   table defeats the purpose); the toast alone is enough. Nothing
   whisper-related may render in `?display=1` display mode — verify.
6. **Size discipline:** this is an S-effort feature. If the diff grows past
   a few hundred lines, you are building chat — stop and cut scope.

## Shell invariants

Prefer extending an existing module (the records hub `js/85` or tools
`js/60`) over a new file. If a new file is unavoidable, follow the full
checklist in `docs/table-presentation-plan.md` §7. Either way bump `CACHE`
in `sw.js:8` for the release, and run `node tools/build-local.mjs` (no count
warning) and `node tools/strip-secrets.mjs --check` (exit 0).

## Acceptance criteria (verify with two browsers/devices)

- Player A sends a whisper → referee gets a toast within one poll cycle and
  sees it with an unread badge; player B never sees it (check as B, and
  check the network payloads B receives under the hardened content path).
- Referee reply is visible to player A only; `resolved` hides the item from
  the referee's default list without deleting it.
- Nothing whisper-related appears in display mode or to non-referee roles
  beyond their own thread.
- Offline queueing: a whisper composed offline sends when the connection
  returns (the `supaStorage` outbound queue — verify, don't reimplement).

Report exactly what you verified on which devices. When done, update
`docs/feature-gap-analysis.md` §2 and the status header of
`docs/table-presentation-plan.md`.

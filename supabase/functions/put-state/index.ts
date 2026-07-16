// ─────────────────────────────────────────────────────────────────────────────
// put-state  ·  Stage 4 of the per-player redaction plan
// See docs/per-player-redaction-plan.md
//
// Token-gated writes to aurelia_state. EVERY write needs a valid player or
// referee token; keys in REFEREE_ONLY additionally need the referee token.
// Once migration 0010 drops the public INSERT/UPDATE policies on
// aurelia_state, this function is the ONLY write path — an anonymous caller
// (or a player forging a referee key) gets 401/403 instead of a write.
//
//   POST /functions/v1/put-state
//   Authorization: Bearer <token>
//   Body: { "key": "...", "value": "..." }
//     or  { "key": "whispers", "append":  { "text": "...", "to"?: "<identity>", "re"?: "<id>" } }
//     or  { "key": "whispers", "resolve": { "id": "...", "resolved": true|false } }
//   → 200 { ok:true } · 401 bad token · 403 referee-only key with player token
//
// Whisper notes (table-presentation plan §8) are the one key clients may not
// whole-array write: a player only ever RECEIVES their own redacted thread
// (get-content), so a whole-array write from a player device would clobber
// every other thread — and accepting one would let any valid token forge or
// erase other players' whispers. Instead the server owns the array: `append`
// builds the item here (id/from/ts/audience are STAMPED from the token, never
// trusted from the body), `resolve` is the referee's done-toggle. Plain `set`
// of the whispers key is refused for every role.
//
// Deploy with the JWT gate OFF (config.toml / --no-verify-jwt) — same opaque
// token scheme as get-content.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Keys only the referee may write. Compiled from an audit of every
// supaStorage.set() call site (2026-07-07): each key here is written solely
// from isReferee()-gated code paths (reveals, design mode, referee panels,
// display push). Keys NOT listed — party records like notes, sheets,
// inventory, funds, ship state, logs — stay writable by any VALID token, so
// no legitimate player write regresses. If a key is ever misclassified the
// client surfaces the 403 as a "Referee-only change rejected" toast naming
// the action, and this list is a one-line redeploy to fix.
const REFEREE_ONLY = new Set([
  // reveals / table control
  "reveal-status", "forced-view", "scene-beats", "station-clock",
  // referee content & session tooling
  "handouts", "session-plans", "splash-config", "recap-point",
  "rulebook-config", "rules-index", "item-catalogue", "enc-settings",
  // referee records
  "npc-roster", "clocks", "imperial-date", "campaign-events",
  "combat-encounter", "initiative", "ship-roster",
  // referee economy desk
  "econ-state", "econ-profiles", "econ-priceadj", "starport-board",
  // design mode / creator (all referee-gated)
  "content-overrides", "content-additions", "content-deletions", "content-history",
  "body-additions", "body-deletions", "body-prop-overrides",
  "location-additions", "location-deletions", "location-prop-overrides",
  "system-additions", "system-deletions", "system-prop-overrides",
  "faction-additions", "faction-deletions", "faction-prop-overrides", "faction-hidden",
  "weapon-additions", "weapon-deletions", "weapon-prop-overrides",
  "galaxy-lanes", "hex-paint", "route-blocks",
]);
const MAX_KEY = 256;
const MAX_VALUE = 1_000_000;
const MAX_WHISPER_TEXT = 2_000;   // one passed note, not an essay
const MAX_WHISPERS = 400;         // hard cap on the array; oldest fall off

// Authored campaigns namespace their keys as camp:<id>:<key>; the referee-only
// rule applies to the base key in every campaign.
function baseKey(key: string): string {
  const m = key.match(/^camp:[^:]+:(.*)$/);
  return m ? m[1] : key;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return json({ error: "missing token" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const key = typeof body.key === "string" ? body.key : "";
  const value = body.value == null ? "" : String(body.value);
  if (!key || key.length > MAX_KEY) return json({ error: "bad key" }, 400);
  if (value.length > MAX_VALUE) return json({ error: "value too large" }, 413);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: player, error: pErr } = await supabase
    .from("players").select("identity, role").eq("token", token).maybeSingle();
  if (pErr) return json({ error: "lookup failed" }, 500);
  if (!player) return json({ error: "invalid token" }, 401);

  // ── Whisper ops — the server owns this array; see header comment ──────────
  if (baseKey(key) === "whispers") {
    // Whispers are table-level, campaign-agnostic state (like the network
    // lock): always the bare key, so get-content and both ops agree on the row
    // whatever campaign a device has active.
    const row = async () => {
      const { data, error } = await supabase
        .from("aurelia_state").select("value").eq("key", "whispers").maybeSingle();
      if (error) throw error;
      let arr: any[] = [];
      try { arr = JSON.parse(data?.value ?? "[]"); } catch { arr = []; }
      return Array.isArray(arr) ? arr : [];
    };
    const save = async (arr: any[]) => {
      // NB: read-modify-write without a transaction — two simultaneous appends
      // can lose one. At a 5-seat physical table the window is a few ms once
      // per session; accepted for S scope (same class of race as every other
      // shared key in the app, which are whole-array last-write-wins anyway).
      const { error } = await supabase
        .from("aurelia_state")
        .upsert({ key: "whispers", value: JSON.stringify(arr.slice(-MAX_WHISPERS)) }, { onConflict: "key" });
      if (error) throw error;
    };

    try {
      if (body.append && typeof body.append === "object") {
        const text = typeof body.append.text === "string" ? body.append.text.trim() : "";
        if (!text) return json({ error: "empty whisper" }, 400);
        if (text.length > MAX_WHISPER_TEXT) return json({ error: "whisper too long" }, 413);
        const re = typeof body.append.re === "string" ? body.append.re.slice(0, 64) : null;
        const item: Record<string, unknown> = {
          id: crypto.randomUUID(),
          from: player.identity,                       // stamped, never client-supplied
          ts: new Date().toISOString(),
          text,
          resolved: false,
        };
        if (player.role === "referee") {
          // Referee reply: visible to exactly one player. `visibleTo` is the
          // audience vocabulary the client's canSee() already speaks.
          const to = typeof body.append.to === "string" ? body.append.to.trim() : "";
          if (!to) return json({ error: "reply needs a recipient" }, 400);
          item.visibleTo = [to];
          item.ref = true;
          if (re) item.re = re;
        } else {
          // Player whisper: visible to its sender (and the referee by role).
          item.visibleTo = [player.identity];
        }
        const arr = await row();
        arr.push(item);
        await save(arr);
        return json({ ok: true, id: item.id });
      }

      if (body.resolve && typeof body.resolve === "object") {
        if (player.role !== "referee") return json({ error: "forbidden", message: "Referee only." }, 403);
        const id = typeof body.resolve.id === "string" ? body.resolve.id : "";
        const arr = await row();
        const it = arr.find((w) => w && w.id === id);
        if (!it) return json({ error: "no such whisper" }, 404);
        it.resolved = !!body.resolve.resolved;
        await save(arr);
        return json({ ok: true });
      }
    } catch {
      return json({ error: "write failed" }, 500);
    }

    return json({ error: "forbidden", message: "Whispers accept append/resolve only — never a whole-array write." }, 403);
  }

  // Referee-only keys, plus every "<store>-ref" blob (the unredacted full copies
  // of Design-Mode overlays — see get-content / migration 0014). A "-ref" suffix
  // is a reserved marker for referee-only content, so a player token can never
  // write one even though the base store isn't individually listed above.
  if ((REFEREE_ONLY.has(baseKey(key)) || baseKey(key).endsWith("-ref")) && player.role !== "referee") {
    return json({ error: "forbidden", message: "This is a referee-only key." }, 403);
  }

  const { error: wErr } = await supabase
    .from("aurelia_state")
    .upsert({ key, value }, { onConflict: "key" });
  if (wErr) return json({ error: "write failed" }, 500);

  return json({ ok: true });
});

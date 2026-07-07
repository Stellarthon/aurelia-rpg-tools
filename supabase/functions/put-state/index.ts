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
//   → 200 { ok:true } · 401 bad token · 403 referee-only key with player token
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
    .from("players").select("role").eq("token", token).maybeSingle();
  if (pErr) return json({ error: "lookup failed" }, 500);
  if (!player) return json({ error: "invalid token" }, 401);

  if (REFEREE_ONLY.has(baseKey(key)) && player.role !== "referee") {
    return json({ error: "forbidden", message: "This is a referee-only key." }, 403);
  }

  const { error: wErr } = await supabase
    .from("aurelia_state")
    .upsert({ key, value }, { onConflict: "key" });
  if (wErr) return json({ error: "write failed" }, 500);

  return json({ ok: true });
});

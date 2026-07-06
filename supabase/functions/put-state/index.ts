// ─────────────────────────────────────────────────────────────────────────────
// put-state  ·  Findings 4 & 5 — token-gated writes to aurelia_state
//
// aurelia_state is the shared sync table (reveal flags, quest log, journal, cargo,
// party notes, …). Today anon INSERT/UPDATE are `true`, so anyone with the
// publishable key can tamper with or wipe all shared state, and the referee gate
// is only a client-side checkbox. This function moves the write authority to the
// server: it verifies the caller's `players` token (same token model as
// get-content) and, for REFEREE-ONLY keys, requires role='referee' — enforcing
// Finding 5 where it belongs. It writes with the SERVICE ROLE, so once the anon
// INSERT/UPDATE policies are dropped (migration 0011) this is the ONLY write path.
//
//   POST /functions/v1/put-state
//   Authorization: Bearer <token>
//   Body: { "key": "<state key>", "value": "<string>" }
//   → 200 { ok:true }
//     401 invalid/missing token · 403 referee-only key from a non-referee
//     400 malformed key/value · 413 value too large
//
// Non-secret READS stay anon (Finding 4c): the poll loop / offline read still hit
// the REST table directly with the publishable key. Only WRITES route here.
//
// Deploy with verify_jwt OFF (our bearer is not a Supabase JWT), same as
// get-content: supabase functions deploy put-state --no-verify-jwt
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Keys only the referee may write (Finding 5). Kept deliberately minimal so no
// legitimate player write regresses — everything NOT in this set stays writable by
// any valid token (players collaboratively edit journal/party notes/cargo/etc.).
// Campaign-namespaced keys (`camp:<id>:<base>`) are matched on their base name.
const REFEREE_ONLY = new Set([
  "reveal-status",   // spoiler reveal flags
  "handouts",        // handouts metadata (audience, order)
  "session-plans",   // session-planner state
]);
const MAX_KEY = 256;
const MAX_VALUE = 1_000_000; // 1 MB — journal/quest-log JSON fit comfortably

function baseKey(key: string): string {
  const m = key.match(/^camp:[^:]+:(.*)$/); // strip the campaign namespace prefix
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

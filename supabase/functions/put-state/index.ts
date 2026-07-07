import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Keys only the referee may write (Finding 5). Minimal so no player write regresses.
const REFEREE_ONLY = new Set([
  "reveal-status",
  "handouts",
  "session-plans",
]);
const MAX_KEY = 256;
const MAX_VALUE = 1_000_000;

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

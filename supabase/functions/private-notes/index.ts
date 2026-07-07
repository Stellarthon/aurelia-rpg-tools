import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MAX_KEY = 512;
const MAX_VALUE = 200_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return json({ error: "missing token" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const op = body.op === "set" ? "set" : "get";
  const key = typeof body.key === "string" ? body.key : "";
  if (!key || key.length > MAX_KEY) return json({ error: "bad key" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: player, error: pErr } = await supabase
    .from("players").select("identity").eq("token", token).maybeSingle();
  if (pErr) return json({ error: "lookup failed" }, 500);
  if (!player) return json({ error: "invalid token" }, 401);
  const identity = String(player.identity);

  if (op === "set") {
    const value = body.value == null ? "" : String(body.value);
    if (value.length > MAX_VALUE) return json({ error: "value too large" }, 413);
    const { error: wErr } = await supabase
      .from("private_notes")
      .upsert({ identity, note_key: key, value, updated_at: new Date().toISOString() },
              { onConflict: "identity,note_key" });
    if (wErr) return json({ error: "write failed" }, 500);
    return json({ ok: true });
  }

  const { data, error: rErr } = await supabase
    .from("private_notes").select("value")
    .eq("identity", identity).eq("note_key", key).maybeSingle();
  if (rErr) return json({ error: "read failed" }, 500);
  return json({ ok: true, value: data?.value ?? null });
});

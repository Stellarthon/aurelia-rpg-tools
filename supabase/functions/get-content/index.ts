// ─────────────────────────────────────────────────────────────────────────────
// get-content  ·  Stage 1 of the per-player redaction plan
// See docs/per-player-redaction-plan.md
//
// Authenticated, per-identity content endpoint. The browser sends a bearer token
// (per-player or referee); this function — running with the SERVICE ROLE, which
// bypasses RLS — reads the full campaign_content, returns ONLY the fragments the
// caller's audience permits, plus the (non-secret) reveal flags. A player NEVER
// receives a `referee` fragment or another identity's fragment.
//
//   POST /functions/v1/get-content
//   Authorization: Bearer <token>
//   → 200 { identity, role, content: [{path, value}], reveals }
//     401 { error } on a bad/missing token
//
// Deploy:  supabase functions deploy get-content --no-verify-jwt
//          (or toggle OFF "Verify JWT" / "Enforce JWT" for this function in the
//           dashboard). REQUIRED: our bearer token is NOT a Supabase JWT, so with
//           JWT verification ON the gateway 401s before this code runs.
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically
//          by the platform; no manual key handling.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  // Must list every header the browser sends, or the preflight blocks the call.
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// Server-side mirror of the client's canSee() (index.html:7183). The two MUST
// agree; the server is authoritative (it has already withheld anything hidden).
function canSee(audience: unknown, role: string, audiences: string[]): boolean {
  if (audience == null || audience === "all") return true;
  if (role === "referee") return true;          // referee sees everything
  if (audience === "referee") return false;
  if (Array.isArray(audience)) return audience.some((a) => audiences.includes(a));
  return audiences.includes(audience as string);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return json({ error: "missing token" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, // service role → bypasses RLS
    { auth: { persistSession: false } },
  );

  // 1. Resolve the token to an identity / role / audience set.
  const { data: player, error: pErr } = await supabase
    .from("players")
    .select("identity, role, audiences")
    .eq("token", token)
    .maybeSingle();
  if (pErr) return json({ error: "lookup failed" }, 500);
  if (!player) return json({ error: "invalid token" }, 401);

  const role: string = player.role;
  const audiences: string[] = Array.isArray(player.audiences) ? player.audiences : [];

  // 2. Read all fragments, then redact in memory. (Content is small — a few
  //    hundred rows — so a full read + filter is simplest and avoids trusting
  //    jsonb query predicates with the secret data.)
  const { data: rows, error: cErr } = await supabase
    .from("campaign_content")
    .select("path, audience, value");
  if (cErr) return json({ error: "content read failed" }, 500);

  const content = (rows ?? [])
    .filter((r) => canSee(r.audience, role, audiences))
    .map((r) => ({ path: r.path, value: r.value }));

  // 3. Reveal flags are not secret; pass them through so the poll loop keeps
  //    working off this one endpoint.
  let reveals: unknown = {};
  const { data: rev } = await supabase
    .from("aurelia_state")
    .select("value")
    .eq("key", "reveal-status")
    .maybeSingle();
  if (rev?.value != null) {
    try { reveals = JSON.parse(rev.value); } catch { /* leave {} */ }
  }

  return json({ identity: player.identity, role, content, reveals });
});

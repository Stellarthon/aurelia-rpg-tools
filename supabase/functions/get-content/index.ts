// ─────────────────────────────────────────────────────────────────────────────
// get-content  ·  Stage 1 of the per-player redaction plan (+ TASK 6 / TASK 7)
// See docs/per-player-redaction-plan.md
//
// Authenticated, per-identity content endpoint. The browser sends a bearer token
// (per-player or referee); this function — running with the SERVICE ROLE, which
// bypasses RLS — reads the full campaign_content, returns ONLY the fragments the
// caller's audience permits, plus the (non-secret) reveal flags. A player NEVER
// receives a `referee` fragment or another identity's fragment.
//
// It also now:
//   · TASK 6 — enforces the referee's optional "same network only" lock. When the
//     lock is enabled, a NON-referee caller whose public IP ≠ the pinned referee
//     IP gets a 403. Enforcement lives ONLY here. The referee can enable/disable
//     the lock (pinning their current public IP) and is re-pinned automatically if
//     their IP later changes. The lock auto-expires 12h after it was pinned
//     (break-glass) so a mistake can never permanently lock the campaign out.
//   · TASK 7 — returns the player roster + access tokens, but ONLY to a caller the
//     token proves is a referee. Tokens never appear in a player's response.
//
//   POST /functions/v1/get-content
//   Authorization: Bearer <token>
//   Body (optional): { "networkLock": { "set": true|false } }  // referee only
//                    { "whispersOnly": true }   // light mode for the 4s poll
//   → 200 { identity, role, content:[{path,value}], reveals, whispers,
//           networkLock?, players? }            // networkLock/players: referee only
//     with whispersOnly: { identity, role, whispers } and nothing else — the
//     poll loop must not drag the full campaign content over the wire every 4s.
//     401 { error } on a bad/missing token
//     403 { error:"network-locked", message } when the venue-network lock blocks you
//
// Deploy:  supabase functions deploy get-content --no-verify-jwt
//          (or toggle OFF "Verify JWT" / "Enforce JWT" for this function in the
//           dashboard). REQUIRED: our bearer token is NOT a Supabase JWT, so with
//           JWT verification ON the gateway 401s before this code runs.
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically
//          by the platform; no manual key handling.
// NB: TASK 6 needs migration 0006_network_lock.sql applied. If the table is
//     absent the lock simply stays inactive (fails OPEN for the lock feature) so
//     content delivery is never broken by a missing migration.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  // Must list every header the browser sends, or the preflight blocks the call.
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-debug-ipchain",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// Server-side mirror of the client's canSee() (js/55-auth-gating.js). The two MUST
// agree; the server is authoritative (it has already withheld anything hidden).
function canSee(audience: unknown, role: string, audiences: string[]): boolean {
  if (audience == null || audience === "all") return true;
  if (role === "referee") return true;          // referee sees everything
  if (audience === "referee") return false;
  if (Array.isArray(audience)) return audience.some((a) => audiences.includes(a));
  return audiences.includes(audience as string);
}

// TASK 6 — break-glass: the lock auto-expires 12h after it was pinned.
const LOCK_TTL_MS = 12 * 60 * 60 * 1000;

// The caller's public IP as a TRUSTED hop sees it.
//
// SECURITY (Finding 6): `x-forwarded-for` is a list the CLIENT can seed. Anything
// the client sends is prepended on the LEFT; each trusted proxy appends the real
// observed peer IP on the RIGHT. So the LEFTMOST entry is attacker-controlled —
// reading it (as this used to) let a player spoof the referee's IP and defeat the
// venue lock by simply sending `X-Forwarded-For: <referee ip>`. We now take the
// RIGHTMOST entry, which is the IP the closest trusted proxy actually saw, and
// which the client cannot forge (their forged values stay to the left of it).
// `x-real-ip` (platform-set) is only a fallback for when XFF is unexpectedly empty.
//
// This is PUBLIC-IP pinning, not network attestation: browsers can't read Wi-Fi/
// SSID, so "same network" is approximated by "same public IP". Two devices behind
// the same NAT share a public IP; a VPN/mobile-data device does not.
//
// CONFIRMING THE CHAIN: if the deployed platform ever fronts this function with an
// extra hop (so the rightmost entry becomes an internal proxy IP), send a request
// with header `x-debug-ipchain: 1` from a known client and read the logged chain
// to pick the correct trusted index. Left as the last-entry default per the
// standard reverse-proxy convention until such a hop is observed.
function clientIp(req: Request): string {
  if (req.headers.get("x-debug-ipchain")) {
    console.log("ipchain", JSON.stringify({
      xff: req.headers.get("x-forwarded-for"),
      xRealIp: req.headers.get("x-real-ip"),
    }));
  }
  const xff = req.headers.get("x-forwarded-for") || "";
  const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length) return parts[parts.length - 1];   // rightmost = trusted hop's observed peer
  return (req.headers.get("x-real-ip") || "").trim();
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

  // Optional referee command body (normal boot sends "{}").
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }

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
  const ip = clientIp(req);

  // 2. Network lock (TASK 6). Load the single row; fail OPEN if the table/migration
  //    isn't present so content delivery is never broken by a missing migration.
  let lock: { enabled: boolean; pinned_ip: string | null; pinned_at: string | null } | null = null;
  try {
    const { data } = await supabase
      .from("network_lock")
      .select("enabled, pinned_ip, pinned_at")
      .eq("id", 1)
      .maybeSingle();
    lock = (data as any) || null;
  } catch { lock = null; }

  let repinned = false;
  const nowIso = () => new Date().toISOString();
  if (role === "referee") {
    const cmd = body && body.networkLock;
    if (cmd && typeof cmd.set === "boolean") {
      // Referee toggled the lock. Enabling pins THIS request's public IP.
      const row = cmd.set
        ? { id: 1, enabled: true, pinned_ip: ip, pinned_at: nowIso(), updated_at: nowIso() }
        : { id: 1, enabled: false, updated_at: nowIso() };
      try {
        await supabase.from("network_lock").upsert(row);
        lock = cmd.set
          ? { enabled: true, pinned_ip: ip, pinned_at: row.pinned_at as string }
          : { enabled: false, pinned_ip: lock?.pinned_ip ?? null, pinned_at: lock?.pinned_at ?? null };
      } catch { /* leave lock as-is */ }
    } else if (lock && lock.enabled && lock.pinned_ip && ip && lock.pinned_ip !== ip) {
      // The referee's IP changed → re-pin on this authorised request (TASK 6d),
      // reporting it back so the app can show a visible confirmation.
      try {
        const at = nowIso();
        await supabase.from("network_lock").upsert({ id: 1, enabled: true, pinned_ip: ip, pinned_at: at, updated_at: at });
        lock = { enabled: true, pinned_ip: ip, pinned_at: at };
        repinned = true;
      } catch { /* leave lock as-is */ }
    }
  }

  // Is the lock currently biting? (enabled, pinned, and inside the 12h window.)
  const lockActive = !!(
    lock && lock.enabled && lock.pinned_at &&
    (Date.now() - new Date(lock.pinned_at).getTime() <= LOCK_TTL_MS)
  );

  // 3. Enforcement — the referee is NEVER blocked; a non-referee off-network is.
  if (role !== "referee" && lockActive && lock!.pinned_ip && ip && lock!.pinned_ip !== ip) {
    return json({
      error: "network-locked",
      message: "The referee has locked this campaign to the venue network. Join the same Wi-Fi as the referee — mobile data and VPNs are blocked.",
    }, 403);
  }

  // 3b. Whisper notes (table-presentation plan §8). The raw `whispers` row is
  //     excluded from the public SELECT policy (migration 0011), so this
  //     token-checked, per-identity filter is the ONLY way whisper text reaches
  //     a device: the referee gets every item, a player gets exactly the items
  //     whose `visibleTo` names them (their own notes + replies addressed to
  //     them). Items without a well-formed `visibleTo` are dropped for players
  //     — fail CLOSED, never "malformed means public".
  const who = [player.identity, ...audiences];
  let whispers: any[] = [];
  try {
    const { data: wRow } = await supabase
      .from("aurelia_state").select("value").eq("key", "whispers").maybeSingle();
    const all = wRow?.value != null ? JSON.parse(wRow.value) : [];
    if (Array.isArray(all)) {
      whispers = role === "referee"
        ? all
        : all.filter((it) => it && Array.isArray(it.visibleTo) && canSee(it.visibleTo, role, who));
    }
  } catch { whispers = []; }

  if (body && body.whispersOnly === true) {
    return json({ identity: player.identity, role, whispers });
  }

  // 4. Read all fragments, then redact in memory. (Content is small — a few
  //    hundred rows — so a full read + filter is simplest and avoids trusting
  //    jsonb query predicates with the secret data.)
  const { data: rows, error: cErr } = await supabase
    .from("campaign_content")
    .select("path, audience, value");
  if (cErr) return json({ error: "content read failed" }, 500);

  const content = (rows ?? [])
    .filter((r) => canSee(r.audience, role, audiences))
    .map((r) => ({ path: r.path, value: r.value }));

  // 5. Reveal flags are not secret; pass them through so the poll loop keeps
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

  const out: any = { identity: player.identity, role, content, reveals, whispers };

  // 6. Referee-only extras. These are NEVER added to a player's response, so
  //    tokens and lock internals never leave the service-role boundary for a
  //    non-referee.
  if (role === "referee") {
    // TASK 6 — lock status for the referee's settings toggle.
    out.networkLock = lock
      ? {
          enabled: !!lock.enabled,
          pinned_ip: lock.pinned_ip ?? null,
          pinned_at: lock.pinned_at ?? null,
          active: lockActive,
          expired: !!(lock.enabled && lock.pinned_at && !lockActive), // enabled but past the 12h break-glass
          repinned,
          current_ip: ip,
        }
      : { enabled: false, active: false, current_ip: ip };
    // TASK 7 — player roster + access tokens, served ONLY to a referee.
    try {
      const { data: roster } = await supabase
        .from("players")
        .select("identity, token, role")
        .order("role", { ascending: true });
      out.players = roster ?? [];
    } catch { out.players = []; }
  }

  return json(out);
});

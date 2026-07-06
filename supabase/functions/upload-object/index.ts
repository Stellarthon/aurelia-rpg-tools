// ─────────────────────────────────────────────────────────────────────────────
// upload-object  ·  Finding 2c — token-gated storage uploads
//
// The portraits/handouts/rulebooks/session-docs buckets granted anon INSERT/UPDATE
// scoped only by bucket_id, so anyone with the publishable key could overwrite any
// object (e.g. replace another character's portrait, or a handout). This function
// authorises uploads against the `players` token model and writes with the SERVICE
// ROLE, so once the anon INSERT/UPDATE policies are dropped (migration 0012) it is
// the only write path. It enforces, per target:
//   · portraits    — ANY valid token; path constrained to portraits/<slug>.jpg
//   · handouts      — referee only; handouts/<campaign>/<id>.jpg
//   · rulebooks     — referee only; rulebooks/<slug>.pdf
//   · session-docs  — referee only; session-docs/<campaign>/<id>.pdf
// plus content-type + size limits mirroring the buckets (2MB / 6MB / 80MB).
//
//   POST /functions/v1/upload-object?bucket=<b>&path=<object path>
//   Authorization: Bearer <token>
//   Content-Type: <the object's mime>
//   Body: raw bytes
//   → 200 { ok:true, path } · 401 · 403 · 400 bad target · 413 too large · 415 mime
//
// NB: portraits are "any token" because the honour-system UX lets any player upload
// their own portrait; the path is still constrained so they can only write a
// portrait object, not a handout/rulebook. Tightening portraits to "the caller's
// own character slug" needs a token→character mapping; left as ANY-token-portrait
// to preserve the current honour-system behaviour (documented residual).
//
// Deploy with verify_jwt OFF: supabase functions deploy upload-object --no-verify-jwt
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Rule = { refereeOnly: boolean; mimes: string[]; maxBytes: number; ext: string; nested: boolean };
const RULES: Record<string, Rule> = {
  "portraits":    { refereeOnly: false, mimes: ["image/jpeg","image/png","image/webp"], maxBytes: 2_097_152,  ext: "jpg", nested: false },
  "handouts":     { refereeOnly: true,  mimes: ["image/jpeg","image/png","image/webp"], maxBytes: 6_291_456,  ext: "jpg", nested: true  },
  "rulebooks":    { refereeOnly: true,  mimes: ["application/pdf"],                       maxBytes: 83_886_080, ext: "pdf", nested: false },
  "session-docs": { refereeOnly: true,  mimes: ["application/pdf"],                       maxBytes: 83_886_080, ext: "pdf", nested: true  },
};

// A safe path segment: lower-case slug characters only. Rejects traversal / quoting.
const SEG = /^[a-z0-9_-]+$/i;
function validPath(bucket: string, path: string, rule: Rule): boolean {
  const parts = path.split("/");
  if (rule.nested) { if (parts.length !== 2) return false; }
  else { if (parts.length !== 1) return false; }
  const file = parts[parts.length - 1];
  if (!file.toLowerCase().endsWith("." + rule.ext)) return false;
  const stem = file.slice(0, -(rule.ext.length + 1));
  if (rule.nested && !SEG.test(parts[0])) return false;
  return SEG.test(stem);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return json({ error: "missing token" }, 401);

  const url = new URL(req.url);
  const bucket = url.searchParams.get("bucket") || "";
  const path = url.searchParams.get("path") || "";
  const rule = RULES[bucket];
  if (!rule) return json({ error: "unknown bucket" }, 400);
  if (!validPath(bucket, path, rule)) return json({ error: "bad path" }, 400);

  const mime = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!rule.mimes.includes(mime)) return json({ error: "unsupported content-type" }, 415);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: player, error: pErr } = await supabase
    .from("players").select("role").eq("token", token).maybeSingle();
  if (pErr) return json({ error: "lookup failed" }, 500);
  if (!player) return json({ error: "invalid token" }, 401);
  if (rule.refereeOnly && player.role !== "referee") {
    return json({ error: "forbidden", message: "Referee-only upload." }, 403);
  }

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength === 0) return json({ error: "empty body" }, 400);
  if (bytes.byteLength > rule.maxBytes) return json({ error: "too large" }, 413);

  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(path, bytes, { contentType: mime, upsert: true });
  if (upErr) return json({ error: "upload failed", detail: upErr.message }, 500);

  return json({ ok: true, path });
});

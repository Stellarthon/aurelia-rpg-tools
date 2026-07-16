// ═══════════════════════════════════════════════════════════════════════════
// SUPABASE ADAPTER — drop-in replacement for window.storage
// ═══════════════════════════════════════════════════════════════════════════
// Mimics supaStorage.get(key, shared) / .set(key, value, shared) shape
// so the rest of the app's storage calls don't need to change.
// Table: aurelia_state(key text primary key, value text, updated_at timestamptz)
// Private (per-device) keys already bake the device identity into the key
// string itself (e.g. note-private-Cass-elevator), so "shared" doesn't need
// its own column — every row in this table is technically readable by anyone
// with the anon key, exactly like window.storage's shared=true behaviour.
// This is acceptable here since the table only ever holds reveal flags and
// notes text — never referee-only content (see note above).

// Backend endpoint + publishable key. Resolved from the deployed campaign
// config (config.js → window.AURELIA_CONFIG) or a per-device setup, falling
// back to the reference campaign's values. See aureliaCfg() in index.html.
const SUPABASE_URL = (typeof aureliaCfg === 'function' && aureliaCfg('supabaseUrl')) || 'https://rarxefzcqvgqvxutprcq.supabase.co';
const SUPABASE_KEY = (typeof aureliaCfg === 'function' && aureliaCfg('supabaseKey')) || 'sb_publishable_KZ773h9ML7-e2jfyH2a9Lg_v-sREJIM';
const SUPABASE_REST = SUPABASE_URL + '/rest/v1/aurelia_state';

// ── Hosted planet-surface globe textures ────────────────────────────────────
// Pre-rendered lit globe PNGs in the public Supabase Storage bucket "globes".
// The catalog SELF-POPULATES at runtime by listing the bucket (an anon SELECT
// policy on the globes bucket allows this), so uploading/removing textures needs
// no code change. A body picks one by filename (body.texture); textureUrlFor()
// resolves it to the encoded public URL. Resolution order:
//   body.textureUrl (full URL escape hatch) > '__none__' (force procedural) >
//   body.texture (explicit catalog file) > auto-match by planet type.
const TEXTURE_BASE = SUPABASE_URL + '/storage/v1/object/public/globes/';
let textureCatalog = []; // filenames in the globes bucket, loaded at runtime

async function loadTextureCatalog(){
  try {
    const res = await fetch(SUPABASE_URL + '/storage/v1/object/list/globes', {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: 1000, sortBy: { column: 'name', order: 'asc' } })
    });
    if(!res.ok) return;
    const list = await res.json();
    textureCatalog = (Array.isArray(list) ? list : [])
      .filter(o => o && o.id && /\.(png|jpe?g|webp)$/i.test(o.name))  // real image files only (skip folders/placeholders)
      .map(o => o.name);
  } catch(e){ /* offline / blocked — leave empty; bodies with an explicit texture still resolve */ }
}

// Which texture category best fits a body, from its type keywords / disc style.
function defaultTextureCategory(body){
  const t = (body.type || '').toLowerCase();
  const style = bodyDiscStyle(body);
  if(style === 'star' || style === 'belt' || style === 'moon') return null; // keep procedural
  if(style === 'gasgiant' || /gas giant|ice giant/.test(t)) return 'gaseous';
  if(/volcan|scorch|lava|molten/.test(t)) return 'volcanic';
  if(/desert|arid|dune|barren/.test(t)) return 'desert';
  if(/ocean|jewel|garden|terran|earth|temperate/.test(t)) return 'terran';
  if(style === 'ice' || /ice|frozen|glacial|tundra/.test(t)) return 'ice';
  if(style === 'ocean') return 'terran';
  if(style === 'rock') return 'desert';
  return null;
}
// Pick a catalog file for a body's auto-category, deterministically varied by id
// so two same-type worlds don't always get the identical globe.
function defaultTextureFile(body){
  const cat = defaultTextureCategory(body);
  if(!cat) return null;
  const matches = textureCatalog.filter(f => f.toLowerCase().startsWith(cat));
  if(!matches.length) return null;
  const seed = (typeof seedFromString === 'function') ? Math.abs(seedFromString(body.id)) : 0;
  return matches[seed % matches.length];
}
function textureUrlFor(body){
  if(body.textureUrl) return body.textureUrl;                  // explicit full URL wins
  if(body.texture === '__none__') return null;                 // forced procedural
  if(body.texture) return TEXTURE_BASE + encodeURIComponent(body.texture); // explicit catalog file
  const auto = defaultTextureFile(body);                       // auto-match by type
  return auto ? TEXTURE_BASE + encodeURIComponent(auto) : null;
}

// ── Character portraits (Supabase Storage 'portraits' bucket) ────────────────
// Honour-system, mirroring the globes texture bucket + the app's anon-key model:
// a public bucket with anon read/insert/update scoped to it (migration
// 0002_portraits_bucket.sql). Each character has ONE deterministic object
// (portraits/<slug>.jpg) overwritten on upload; a version stamp stored on the
// sheet blob (portraitVer) cache-busts the shared public URL across devices.
const PORTRAIT_BASE = SUPABASE_URL + '/storage/v1/object/public/portraits/';
function portraitSlug(characterName){
  return String(characterName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'character';
}
function portraitPath(characterName){ return portraitSlug(characterName) + '.jpg'; }
function portraitUrlFor(characterName, ver){
  const url = PORTRAIT_BASE + encodeURIComponent(portraitPath(characterName));
  return ver ? (url + '?v=' + ver) : url;
}
async function uploadPortraitBlob(characterName, blob){
  const res = await fetch(SUPABASE_URL + '/storage/v1/object/portraits/' + encodeURIComponent(portraitPath(characterName)), {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'x-upsert': 'true', 'Content-Type': 'image/jpeg' },
    body: blob
  });
  if(!res.ok) throw new Error('Portrait upload failed: HTTP ' + res.status + ' ' + (await res.text().catch(() => '')));
  return true;
}
// NPC portraits share the same public 'portraits' bucket under an npc/ sub-path,
// so no new migration is needed — the bucket's anon read/insert/update policies
// (migration 0002) already cover it. Keyed by the NPC's stable id; a portraitVer
// stamp on the roster entry cache-busts the shared public URL across devices.
function npcPortraitPath(id){ return 'npc/' + portraitSlug(id) + '.jpg'; }
function npcPortraitUrlFor(id, ver){
  const url = PORTRAIT_BASE + 'npc/' + encodeURIComponent(portraitSlug(id)) + '.jpg';
  return ver ? (url + '?v=' + ver) : url;
}
async function uploadNpcPortraitBlob(id, blob){
  const res = await fetch(SUPABASE_URL + '/storage/v1/object/portraits/npc/' + encodeURIComponent(portraitSlug(id)) + '.jpg', {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'x-upsert': 'true', 'Content-Type': 'image/jpeg' },
    body: blob
  });
  if(!res.ok) throw new Error('NPC portrait upload failed: HTTP ' + res.status + ' ' + (await res.text().catch(() => '')));
  return true;
}

// ── BYO rulebook library (Supabase Storage 'rulebooks' bucket) ───────────────
// The referee's OWN, legally-owned rulebook PDFs — one object per book per
// campaign, overwritten on re-upload; migration 0003_rulebooks_bucket.sql.
// USER-SUPPLIED, never shipped in the repo, so the codebase stays
// copyright-clean. Version stamps in the shared 'rulebook-config' key
// cache-bust the public URLs across devices. Opened in the browser's native
// PDF viewer (no PDF.js dependency); '#page=N' jumps to a cited page.
// bookId 'core' (or omitted) keeps the original <campaign>.pdf path so a
// pre-library upload stays valid; supplements land at <campaign>-<bookId>.pdf.
const RULEBOOK_BASE = SUPABASE_URL + '/storage/v1/object/public/rulebooks/';
function rulebookSlug(campaignId){
  return String(campaignId || 'default').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'default';
}
function rulebookPath(campaignId, bookId){
  const slug = rulebookSlug(campaignId);
  const b = String(bookId || 'core').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (!b || b === 'core') ? slug + '.pdf' : slug + '-' + b + '.pdf';
}
function rulebookUrlFor(campaignId, ver, bookId){
  const url = RULEBOOK_BASE + encodeURIComponent(rulebookPath(campaignId, bookId));
  return ver ? (url + '?v=' + ver) : url;
}
async function uploadRulebookBlob(campaignId, file, bookId){
  const res = await fetch(SUPABASE_URL + '/storage/v1/object/rulebooks/' + encodeURIComponent(rulebookPath(campaignId, bookId)), {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'x-upsert': 'true', 'Content-Type': 'application/pdf' },
    body: file
  });
  if(!res.ok) throw new Error('Rulebook upload failed: HTTP ' + res.status + ' ' + (await res.text().catch(() => '')));
  return true;
}

// ── Handouts (Supabase Storage 'handouts' bucket) ────────────────────────────
// Referee-pushed images (map / clue / photo / doc scan) players view on their
// own devices. One object per handout, keyed per campaign:
// handouts/<campaignSlug>/<id>.jpg. Migration 0004. Public-read like portraits;
// per-handout audience is enforced client-side via canSee() on the shared
// 'handouts' metadata key.
const HANDOUT_BASE = SUPABASE_URL + '/storage/v1/object/public/handouts/';
function handoutObjectPath(campaignId, id){
  return rulebookSlug(campaignId) + '/' + String(id || '').replace(/[^a-z0-9_-]/gi, '') + '.jpg';
}
function handoutUrlFor(campaignId, id, ver){
  const url = HANDOUT_BASE + handoutObjectPath(campaignId, id).split('/').map(encodeURIComponent).join('/');
  return ver ? (url + '?v=' + ver) : url;
}
async function uploadHandoutBlob(campaignId, id, blob){
  const path = handoutObjectPath(campaignId, id).split('/').map(encodeURIComponent).join('/');
  const res = await fetch(SUPABASE_URL + '/storage/v1/object/handouts/' + path, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'x-upsert': 'true', 'Content-Type': 'image/jpeg' },
    body: blob
  });
  if(!res.ok) throw new Error('Handout upload failed: HTTP ' + res.status + ' ' + (await res.text().catch(() => '')));
  return true;
}

// ── Deck-plan floorplan underlays (Supabase Storage 'deck-maps' bucket) ───────
// The images a referee uploads to trace a deck plan over. Own bucket (migration
// 0012) so they don't share the handouts namespace; same public-read / anon-key
// model, referee-only upload gated client-side. One object per image, keyed per
// campaign: deck-maps/<campaignSlug>/<id>.jpg. (Deck data stores just {id,ver};
// js/41 builds the URL. Legacy images uploaded before 0012 still resolve via
// handoutUrlFor — see dkeDeckImgUrl.)
const DECKMAP_BASE = SUPABASE_URL + '/storage/v1/object/public/deck-maps/';
function deckMapObjectPath(campaignId, id){
  return rulebookSlug(campaignId) + '/' + String(id || '').replace(/[^a-z0-9_-]/gi, '') + '.jpg';
}
function deckMapUrlFor(campaignId, id, ver){
  const url = DECKMAP_BASE + deckMapObjectPath(campaignId, id).split('/').map(encodeURIComponent).join('/');
  return ver ? (url + '?v=' + ver) : url;
}
async function uploadDeckMapBlob(campaignId, id, blob){
  const path = deckMapObjectPath(campaignId, id).split('/').map(encodeURIComponent).join('/');
  const res = await fetch(SUPABASE_URL + '/storage/v1/object/deck-maps/' + path, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'x-upsert': 'true', 'Content-Type': 'image/jpeg' },
    body: blob
  });
  if(!res.ok) throw new Error('Deck map upload failed: HTTP ' + res.status + ' ' + (await res.text().catch(() => '')));
  return true;
}

// ── Session-planner reference docs (Supabase Storage 'session-docs' bucket) ───
// Referee-only prep PDFs attached to a session plan (js/97). One object per
// uploaded doc: session-docs/<campaignSlug>/<id>.pdf, overwritten on re-upload;
// migration 0007. Public-read like rulebooks (private-by-obscurity — the path is
// a random per-doc id). Opened in the browser's native PDF viewer, no PDF.js.
const PLANNER_DOC_BASE = SUPABASE_URL + '/storage/v1/object/public/session-docs/';
function plannerDocObjectPath(campaignId, id){
  return rulebookSlug(campaignId) + '/' + String(id || '').replace(/[^a-z0-9_-]/gi, '') + '.pdf';
}
function plannerDocUrlFor(campaignId, id, ver){
  const url = PLANNER_DOC_BASE + plannerDocObjectPath(campaignId, id).split('/').map(encodeURIComponent).join('/');
  return ver ? (url + '?v=' + ver) : url;
}
async function uploadPlannerDocBlob(campaignId, id, file){
  const path = plannerDocObjectPath(campaignId, id).split('/').map(encodeURIComponent).join('/');
  const res = await fetch(SUPABASE_URL + '/storage/v1/object/session-docs/' + path, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'x-upsert': 'true', 'Content-Type': 'application/pdf' },
    body: file
  });
  if(!res.ok) throw new Error('Session doc upload failed: HTTP ' + res.status + ' ' + (await res.text().catch(() => '')));
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// OFFLINE RESILIENCE  —  write-through cache · outbound queue · connectivity
// ───────────────────────────────────────────────────────────────────────────
// Shared state lives in Supabase, but the network isn't guaranteed at the table
// (a player on a phone, a referee on hotel wifi). Three layers keep the app
// usable through a drop:
//   1. write-through CACHE — every successful read is mirrored to localStorage,
//      and every write is cached *before* it's sent, so a reload while offline
//      still renders last-known shared state instead of blank defaults.
//   2. outbound QUEUE — a write that can't reach Supabase is parked in
//      localStorage (last-write-wins per key) and flushed on reconnect, so a
//      referee can keep revealing / advancing the clock through an outage.
//   3. CONNECTIVITY signal — get/set outcomes plus the browser online/offline
//      events drive the status pill (#conn-pill) and the player poll's backoff.
// IMPORTANT for callers: supaStorage.get now returns { ok, value }.
//   ok:false  → the request FAILED (value may be a cached fallback, or null).
//   ok:true, value===null → the row genuinely doesn't exist.
// Startup loaders read res.value (so the cache fills them in offline); pollers
// must gate on res.ok (so a failed fetch is a no-op, never an empty-state wipe).
// ═══════════════════════════════════════════════════════════════════════════

const CACHE_PREFIX = 'aurelia_cache_';
const SYNC_QUEUE_KEY = 'aurelia_sync_queue';

// 'live' = last network op succeeded · 'reconnecting' = online but Supabase
// unreachable · 'offline' = browser reports no connection.
let connState = (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'offline' : 'live';
let lastSyncTs = null;
let _quotaWarned = false; // gate so the "storage full" warning shows at most once

// ── Campaign namespace (multi-campaign isolation) ────────────────────────────
// Every shared key is prefixed with the active campaign id so a second referee's
// universe never overwrites the first. The BUILT-IN Archon Gambit campaign is
// deliberately kept UN-prefixed, so the existing live Supabase rows keep working
// with zero migration — only authored campaigns are isolated under camp:<id>:.
function campaignKeyPrefix(){
  const id = (typeof activeCampaignId !== 'undefined') ? activeCampaignId : 'archon-gambit';
  return (id === 'archon-gambit') ? '' : ('camp:' + id + ':');
}

const supaStorage = {
  _nk(key){ return campaignKeyPrefix() + key; },   // namespaced key for the active campaign
  cacheGet(key){ try { return localStorage.getItem(CACHE_PREFIX + key); } catch(e){ return null; } },
  cacheSet(key, value){
    if(DISPLAY_MODE) return;   // the table TV shares localStorage with the referee window — never write it
    try {
      if(value == null) localStorage.removeItem(CACHE_PREFIX + key);
      else localStorage.setItem(CACHE_PREFIX + key, value);
    } catch(e){
      /* quota / disabled — non-fatal, sync still works in-memory, but warn
         the referee once so a full store doesn't lose changes silently. */
      const quota = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
      if(quota && !_quotaWarned){
        _quotaWarned = true;
        if(typeof showToast === 'function') showToast('Storage full — recent changes may not persist. Export your campaign to be safe.');
      }
    }
  },
  async get(key, shared){
    key = this._nk(key);   // isolate by active campaign (built-in stays un-prefixed)
    try {
      const res = await fetch(`${SUPABASE_REST}?key=eq.${encodeURIComponent(key)}&select=value`, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY
        }
      });
      if(!res.ok) throw new Error('HTTP ' + res.status);
      const rows = await res.json();
      const value = rows.length ? rows[0].value : null;
      this.cacheSet(key, value);            // mirror authoritative server state
      markOnline();
      return { ok: true, value, fromCache: false };
    } catch(e){
      markOffline();
      return { ok: false, value: this.cacheGet(key), fromCache: true };
    }
  },
  // Raw upsert — throws on any failure. Used by both set() and the queue flush.
  // Stage 4 (per-player redaction plan): when this device holds an access token,
  // the write goes through the put-state Edge Function, which validates the
  // token and rejects referee-only keys from a player token. The direct anon
  // REST path remains only for tokenless devices, and dies the day migration
  // 0010 drops the public write policies on aurelia_state.
  // A 401/403 from put-state is an AUTH verdict, not an outage: the server was
  // reached and said no. Throwing it as `permanent` stops set()/flushQueue()
  // from parking it in the retry queue, where it would loop forever.
  async _post(key, value){
    const token = (typeof getContentToken === 'function') ? getContentToken() : '';
    if(token){
      // Whisper appends ride the SAME queue/flush machinery but need their own
      // wire shape: each queued whisper is parked under a unique synthetic key
      // 'whisper#<id>' (so two offline whispers never last-write-wins each
      // other away) and is sent as a put-state `append`, not a value upsert.
      const wire = key.startsWith('whisper#')
        ? { key: 'whispers', append: JSON.parse(value) }
        : { key, value: String(value) };
      const res = await fetch(SUPABASE_URL + '/functions/v1/put-state', {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(wire)
      });
      if(res.status === 401 || res.status === 403){
        const err = new Error('put-state ' + res.status);
        err.permanent = true;
        err.userMessage = (res.status === 403)
          ? 'Referee-only change rejected by the server.'
          : 'Access token rejected — re-enter it in Settings → Secure Content.';
        throw err;
      }
      if(!res.ok) throw new Error('put-state HTTP ' + res.status);
      return true;
    }
    if(key.startsWith('whisper#')){
      // No token → no whisper. put-state is the only path that can stamp the
      // sender identity, so this can never legitimately succeed anonymously.
      const err = new Error('whisper without token');
      err.permanent = true;
      err.userMessage = 'Whispers need an access token — set one in Settings → Secure Content.';
      throw err;
    }
    const res = await fetch(SUPABASE_REST, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({ key, value: String(value) })
    });
    if(!res.ok) throw new Error(await res.text());
    return true;
  },
  // Whisper note send (table-presentation plan §8). payload: {text} from a
  // player, {text, to, re?} from the referee. Success semantics mirror set():
  // {ok:true} landed · {ok:false} parked in the outbound queue (sends on
  // reconnect) · {ok:false, rejected:true} the server refused (bad token).
  // No cacheSet: whisper threads are never mirrored to localStorage — the
  // device only ever holds its own outbound text (in the queue) plus whatever
  // get-content returned in memory.
  async sendWhisper(payload){
    if(DISPLAY_MODE) return { ok: false, rejected: true }; // the table TV never composes
    const str = JSON.stringify(payload || {});
    const qkey = 'whisper#' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    try {
      await this._post(qkey, str);
      markOnline();
      flushQueue();
      return { ok: true };
    } catch(e){
      if(e && e.permanent){
        markOnline();
        if(typeof showToast === 'function') showToast(e.userMessage || 'Whisper rejected by the server.', 'error');
        return { ok: false, rejected: true };
      }
      markOffline();
      queueWrite(qkey, str);               // unique key per whisper — nothing supersedes it
      return { ok: false };
    }
  },
  async set(key, value, shared){
    if(DISPLAY_MODE) return { ok: true };  // table TV is strictly read-only — a write here would corrupt the referee's own session
    key = this._nk(key);                   // isolate by active campaign (built-in stays un-prefixed)
    const str = String(value);
    this.cacheSet(key, str);               // optimistic: survives a reload even if the POST never lands
    try {
      await this._post(key, str);
      markOnline();
      flushQueue();                        // we're online — drain any backlog behind this write
      return { ok: true };
    } catch(e){
      if(e && e.permanent){
        // The server answered and REFUSED (bad token / referee-only key).
        // Retrying can never succeed, so don't queue — surface it instead.
        markOnline();
        if(typeof showToast === 'function') showToast(e.userMessage || 'Change rejected by the server.', 'error');
        return { ok: false, rejected: true };
      }
      markOffline();
      queueWrite(key, str);                // park it; reconnect (or the heartbeat) retries
      return { ok: false };
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// DESIGN-STORE MERGE  —  field-level read-modify-write for Design-Mode edits
// ───────────────────────────────────────────────────────────────────────────
// Every Design-Mode store (content-overrides, body/location/system/faction/
// weapon overlays, …) is one JSON blob in one aurelia_state row. A plain
// supaStorage.set() is last-write-wins on that whole blob, so two referees (or
// one referee on two devices, or an offline edit flushed late) editing DIFFERENT
// fields silently clobbered each other's entire store.
//
// mergedSaveStore() does a 3-way merge before writing: it re-reads the current
// remote blob and reconciles it against a BASELINE (the value this device last
// loaded or saved) so that only the fields THIS device actually changed are
// applied on top of whatever a co-editor committed meanwhile. Deletions are
// honoured (a key present in the baseline but gone locally is removed); a key a
// co-editor added is preserved. Object nodes merge recursively; arrays and
// primitives are leaves (the side that changed wins — so two referees appending
// to the SAME list still last-write-wins, but everything keyed by id/field
// merges cleanly). If the pre-read fails (offline) it falls back to a plain
// write — identical to the old behaviour, never worse.
function _isPlainObj(v){ return !!v && typeof v === 'object' && !Array.isArray(v); }
function _deepEq(a, b){
  if(a === b) return true;
  if(_isPlainObj(a) && _isPlainObj(b)){
    const ka = Object.keys(a), kb = Object.keys(b);
    if(ka.length !== kb.length) return false;
    return ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && _deepEq(a[k], b[k]));
  }
  if(Array.isArray(a) && Array.isArray(b)){
    if(a.length !== b.length) return false;
    return a.every((x, i) => _deepEq(x, b[i]));
  }
  return false;
}
// base = value at last sync · mine = this device's current value · theirs = the
// freshly-read remote value. Returns the reconciled value.
function threeWayMerge(base, mine, theirs){
  // Leaf (array / primitive) or a type change: my edit wins if I changed it,
  // otherwise defer to theirs.
  if(!_isPlainObj(base) || !_isPlainObj(mine) || !_isPlainObj(theirs)){
    return _deepEq(base, mine) ? theirs : mine;
  }
  const out = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)]);
  keys.forEach(k => {
    const inBase = Object.prototype.hasOwnProperty.call(base, k);
    const inMine = Object.prototype.hasOwnProperty.call(mine, k);
    const inTheirs = Object.prototype.hasOwnProperty.call(theirs, k);
    if(!inMine){
      if(inBase) return;                 // I deleted it → stay deleted (local intent wins)
      if(inTheirs) out[k] = theirs[k];   // a co-editor added it → keep theirs
      return;
    }
    const locallyChanged = !inBase || !_deepEq(base[k], mine[k]);
    if(locallyChanged){
      out[k] = (_isPlainObj(base[k]) && _isPlainObj(mine[k]) && _isPlainObj(theirs[k]))
        ? threeWayMerge(base[k], mine[k], theirs[k])
        : mine[k];                       // my change wins at the leaf
    } else if(inTheirs){
      out[k] = theirs[k];                // untouched locally → take theirs (their edit / unchanged)
    }
    // untouched locally AND gone from theirs → a co-editor deleted it → honour that (omit)
  });
  return out;
}
// Per-key baseline of the last-synced value, so a save knows which fields this
// device changed. Snapshotted on load and after every successful merged save.
const _designBaselines = {};
function snapshotBaseline(key, val){
  try { _designBaselines[key] = JSON.parse(JSON.stringify(val == null ? {} : val)); }
  catch(e){ _designBaselines[key] = Array.isArray(val) ? [] : {}; }
}
async function mergedSaveStore(key, current){
  // A referee-only-bearing store keeps its FULL data under "<key>-ref" (carved
  // out of public read) and a REDACTED copy under the public key that players
  // read. The merge re-reads the full ref blob; single-copy stores use the key.
  const split = (typeof isSplitStore === 'function') && isSplitStore(key);
  const fullKey = split ? (key + '-ref') : key;
  let merged = current;
  try {
    const res = await supaStorage.get(fullKey, true);   // re-read the authoritative FULL remote blob
    // Merge only against a remote blob that actually EXISTS. An absent row
    // (value === null) is "no co-editor state to preserve", not "everything was
    // deleted" — merging against {} there would wrongly drop unchanged keys of a
    // store with a non-empty default (e.g. route-blocks {enabled:true}).
    if(res.ok && res.value != null){
      const empty = Array.isArray(current) ? [] : {};
      let remote = empty;
      try { remote = JSON.parse(res.value); } catch(e){ remote = empty; }
      const base = Object.prototype.hasOwnProperty.call(_designBaselines, key) ? _designBaselines[key] : empty;
      merged = threeWayMerge(base, current, remote);
    }
  } catch(e){ merged = current; /* offline / parse fail → plain write, no worse than before */ }
  if(split && typeof stripOverlayForPlayers === 'function'){
    await supaStorage.set(fullKey, JSON.stringify(merged), true);                            // full → referee-only "<key>-ref"
    await supaStorage.set(key, JSON.stringify(stripOverlayForPlayers(key, merged)), true);   // redacted → public "<key>"
  } else {
    await supaStorage.set(key, JSON.stringify(merged), true);
  }
  snapshotBaseline(key, merged);
  return merged;
}

// Read an overlay store for the CURRENT role. A referee reads the full data from
// "<key>-ref": preferring the copy get-content delivered over the token boundary
// (populated in _refOverlays), then a direct read (works until the migration
// carves "<key>-ref" out of public read), then the public key as a pre-migration
// / pre-first-save fallback. A player always reads the public (redacted) key.
// Returns the same { ok, value } shape as supaStorage.get.
let _refOverlays = {};   // {key: rawJsonString} delivered to referees by get-content
async function getOverlayStore(key){
  // Use the REAL role: a referee previewing-as-player must still read their full
  // "-ref" data, not the redacted public copy.
  const isRef = (typeof isRefereeReal === 'function') ? isRefereeReal() : ((typeof isReferee === 'function') && isReferee());
  const split = (typeof isSplitStore === 'function') && isSplitStore(key);
  if(isRef && split){
    if(Object.prototype.hasOwnProperty.call(_refOverlays, key) && _refOverlays[key] != null){
      return { ok: true, value: _refOverlays[key], fromCache: false };
    }
    const r = await supaStorage.get(key + '-ref', true);
    if(r.ok && r.value != null) return r;
    // else fall through to the public key (no ref blob yet / not migrated)
  }
  return supaStorage.get(key, true);
}

// ── Outbound write queue (last-write-wins per key) ───────────────────────────
function loadQueue(){ try { return JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '{}') || {}; } catch(e){ return {}; } }
function saveQueue(q){ try { localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(q)); } catch(e){} }
function queueLength(){ return Object.keys(loadQueue()).length; }
function queueWrite(key, value){
  const q = loadQueue();
  q[key] = { value, ts: Date.now() };      // a newer write for a key supersedes the older one
  saveQueue(q);
  updateConnPill();
}
let flushing = false;
async function flushQueue(){
  if(DISPLAY_MODE) return; // never race the referee window over its own outbound queue
  if(flushing) return;
  const keys = Object.keys(loadQueue());
  if(!keys.length) return;
  flushing = true;
  try {
    for(const key of keys){
      const entry = loadQueue()[key];
      if(!entry) continue;
      try {
        await supaStorage._post(key, entry.value);
        const cur = loadQueue();           // re-read: the key may have been re-queued while awaiting
        if(cur[key] && cur[key].ts === entry.ts){ delete cur[key]; saveQueue(cur); }
        markOnline();
      } catch(e){
        if(e && e.permanent){
          // Auth refusal, not an outage: drop the entry (it can never land) and
          // keep draining the rest of the queue.
          const cur = loadQueue();
          if(cur[key] && cur[key].ts === entry.ts){ delete cur[key]; saveQueue(cur); }
          if(typeof showToast === 'function') showToast(e.userMessage || 'A queued change was rejected by the server.', 'error');
          markOnline();
          continue;
        }
        markOffline();
        break;                             // still down — stop; the next trigger retries
      }
    }
  } finally {
    flushing = false;
    updateConnPill();
  }
}

// ── Connectivity state → status pill + poll backoff ──────────────────────────
function markOnline(){
  const recovered = connState !== 'live';
  connState = 'live';
  lastSyncTs = Date.now();
  pollBackoff = POLL_MS;                    // recovered — snap polling back to the fast cadence
  if(recovered && queueLength()) flushQueue();
  updateConnPill();
}
function markOffline(){
  connState = (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'offline' : 'reconnecting';
  updateConnPill();
}
function syncAgoLabel(){
  if(!lastSyncTs) return 'not yet';
  const s = Math.round((Date.now() - lastSyncTs) / 1000);
  if(s < 60) return s + 's ago';
  const m = Math.round(s / 60);
  if(m < 60) return m + 'm ago';
  return Math.round(m / 60) + 'h ago';
}
function updateConnPill(){
  const pill = document.getElementById('conn-pill');
  if(!pill) return;
  const q = queueLength();
  pill.classList.remove('cp-live','cp-reconnecting','cp-offline');
  let icon, text;
  if(connState === 'live'){
    pill.classList.add('cp-live');
    icon = '●'; text = q ? `Syncing ${q}…` : 'Live';
  } else if(connState === 'reconnecting'){
    pill.classList.add('cp-reconnecting');
    icon = '◐'; text = 'Reconnecting';
  } else {
    pill.classList.add('cp-offline');
    icon = '○'; text = 'Offline';
  }
  pill.innerHTML = `<span class="cp-dot">${icon}</span><span class="cp-txt">${text}</span>`;
  pill.title = `Shared sync — ${text}${q ? ` · ${q} change${q>1?'s':''} queued` : ''} · last synced ${syncAgoLabel()}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// ERROR TELEMETRY UPLOADER  —  drains the aurelia_err_upload queue → error_log
// ───────────────────────────────────────────────────────────────────────────
// js/00-core-data.js parks client errors on a localStorage queue (it can't reach
// this data layer at load time). We drain that queue to the error_log table
// (migration 0005) here, where SUPABASE_URL/KEY already live. Rules:
//   · batched     — at most one flush per 10s, all queued rows in one POST;
//   · session cap — never more than 50 uploads per page load, so a runaway error
//                   loop can't flood the table;
//   · fire-and-forget — every path is wrapped in try/catch. If the upload fails
//                   (offline, blocked, RLS) the queue is simply left for the next
//                   tick and the app is entirely unaffected — exactly as today.
// There is NO select policy on error_log, so this key can only ever write.
const ERR_LOG_REST = SUPABASE_URL + '/rest/v1/error_log';
let _errUploadedThisSession = 0;   // hard session cap counter
let _errLastFlush = 0;             // throttle: at most one flush per 10s
let _errFlushBusy = false;
async function flushErrorQueue(){
  try {
    if(_errFlushBusy) return;
    if(_errUploadedThisSession >= 50) return;                 // session hard cap reached
    const now = Date.now();
    if(now - _errLastFlush < 10000) return;                   // ≤ one flush per 10s
    let q;
    try { q = JSON.parse(localStorage.getItem('aurelia_err_upload') || '[]'); } catch(e){ q = []; }
    if(!Array.isArray(q) || !q.length) return;
    _errFlushBusy = true;
    _errLastFlush = now;                                       // a mere attempt still counts against the 10s window
    const batch = q.slice(0, 50 - _errUploadedThisSession);   // fill remaining session budget
    const rows = batch.map(e => ({
      created_at:  e && e.created_at || new Date().toISOString(),
      player:      e && e.player != null ? e.player : null,
      app_version: e && e.app_version != null ? e.app_version : null,
      ua:          e && e.ua != null ? e.ua : null,
      message:     e && e.message != null ? e.message : null,
      stack:       e && e.stack != null ? String(e.stack).slice(0, 2048) : null,   // belt-and-braces 2KB cap
      context:     e && e.context != null ? e.context : {}
    }));
    const res = await fetch(ERR_LOG_REST, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify(rows)
    });
    if(res.ok){
      _errUploadedThisSession += batch.length;
      const rest = q.slice(batch.length);
      try { localStorage.setItem('aurelia_err_upload', JSON.stringify(rest)); } catch(e){}
    }
  } catch(e){ /* offline / blocked — leave the queue; the next tick retries (capped) */ }
  finally { _errFlushBusy = false; }
}
// Drain shortly after boot settles, then poll every 10s. Both are deferred
// callbacks (load-order safe) and no-op when the queue is empty.
try {
  if(typeof setTimeout === 'function')  setTimeout(function(){ try { flushErrorQueue(); } catch(e){} }, 4000);
  if(typeof setInterval === 'function') setInterval(function(){ try { flushErrorQueue(); } catch(e){} }, 10000);
} catch(e){}


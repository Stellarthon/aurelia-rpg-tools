// ═══════════════════════════════════════════════════════════════════════════
// SPLASH OVERLAY — reusable welcome screen
// ═══════════════════════════════════════════════════════════════════════════
// A brief full-screen welcome that fades in over the app, auto-dismisses after
// a few seconds, and can be skipped with a tap or any key. Two callers drive
// it: showIntroSplash() on app entry, and maybeSystemWelcome() the first time
// a traveller visits a system (see 10-galaxy.js). Purely cosmetic — the app
// boots underneath regardless, so this can never block access.

// ── Splash config (referee-editable, shared) ────────────────────────────────
// The built-in copy lives in SPLASH_DEFAULTS. The referee can edit the text and
// turn either splash on/off from Design Mode (see openSplashEditor in
// 65-design-mode.js); those edits are shared campaign state (Supabase key
// 'splash-config') so every player picks them up, exactly like reveal-status.
// getSplashConfig() always merges saved values over the defaults, so a missing
// or partial override never leaves a field blank.
const SPLASH_DEFAULTS = {
  intro: { enabled:true, kicker:'Aurelian System', title:'WELCOME TRAVELLER',
           sub:'May the stars ever be full of wonder.', hint:'Tap anywhere to begin' },
  system:{ enabled:true, kicker:'', sub:'Welcome Traveller', hint:'Tap anywhere to continue' },
};
let splashConfig = null;   // raw saved overrides; null until first load
function getSplashConfig(){
  const o = splashConfig || {};
  return {
    intro:  Object.assign({}, SPLASH_DEFAULTS.intro,  o.intro  || {}),
    system: Object.assign({}, SPLASH_DEFAULTS.system, o.system || {}),
  };
}
async function loadSplashConfig(){
  try { const r = await supaStorage.get('splash-config', true); splashConfig = (r && r.value != null) ? JSON.parse(r.value) : {}; }
  catch(e){ splashConfig = {}; }   // offline / first run → fall back to defaults
}
async function saveSplashConfig(){
  try { await supaStorage.set('splash-config', JSON.stringify(splashConfig || {}), true); }
  catch(e){ console.error('Splash config save failed', e); }
}

let _splashTimer = null, _splashArm = null;
function _splashEnd(){ dismissSplash(); }

// Arm the auto-dismiss + skip-to-dismiss. Skip is armed only after the entrance
// settles, so the click/key that opened the splash doesn't instantly close it.
// Shared by showSplash() and the pre-boot adopt path (see showIntroSplash).
function armSplashDismissal(duration){
  const el = document.getElementById('app-splash');
  if(!el) return;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  clearTimeout(_splashTimer); clearTimeout(_splashArm);
  _splashTimer = setTimeout(dismissSplash, reduce ? 1400 : (duration || 3800));
  _splashArm = setTimeout(() => {
    if(el.classList.contains('show')){
      document.addEventListener('keydown', _splashEnd);
      el.addEventListener('click', _splashEnd);
    }
  }, 500);
}

// opts: { kicker, title, sub, hint, italicSub, duration }
function showSplash(opts){
  opts = opts || {};
  const el = document.getElementById('app-splash');
  if(!el) return;
  const setLine = (sel, text) => {
    const n = el.querySelector(sel);
    if(!n) return;
    n.textContent = text || '';
    n.style.display = text ? '' : 'none';   // collapse empty lines (e.g. no kicker)
  };
  setLine('.splash-kicker', opts.kicker);
  setLine('.splash-title',  opts.title);
  setLine('.splash-sub',    opts.sub);
  setLine('.splash-hint',   opts.hint);
  const sub = el.querySelector('.splash-sub');
  if(sub) sub.classList.toggle('italic', !!opts.italicSub);
  el.setAttribute('aria-label', opts.title || 'Welcome');

  // Restart cleanly if a previous splash is still up (e.g. system after intro),
  // and drop any pre-boot cover so this show fades in normally.
  document.removeEventListener('keydown', _splashEnd);
  el.removeEventListener('click', _splashEnd);
  el.classList.remove('show', 'preboot');
  void el.offsetWidth;                       // reflow, so the entrance replays
  el.setAttribute('aria-hidden', 'false');
  if(opts.instant){
    // Cover on THIS frame, opaque, with no opacity fade-IN — so a view rendered
    // underneath in the same task (e.g. the system view behind a per-system
    // welcome, or the app behind the app-entry intro) is never briefly visible
    // before the splash appears. The inner rise animations still play, and
    // dismissSplash restores the fade-OUT. Mirrors the pre-boot cover.
    el.classList.add('preboot', 'show');
  } else {
    requestAnimationFrame(() => el.classList.add('show'));
  }
  armSplashDismissal(opts.duration);
}
function dismissSplash(){
  const el = document.getElementById('app-splash');
  if(!el || !el.classList.contains('show')) return;
  clearTimeout(_splashTimer); clearTimeout(_splashArm);
  try { clearTimeout(window.__introPrebootSafety); } catch(e){}
  if(el.classList.contains('preboot')){
    el.classList.remove('preboot');          // restore the transition...
    void el.offsetWidth;                      // ...and reflow so removing .show fades out
  }
  el.classList.remove('show');               // fades out via the CSS transition
  el.setAttribute('aria-hidden', 'true');
  document.removeEventListener('keydown', _splashEnd);
  el.removeEventListener('click', _splashEnd);
}

// Prime splashConfig synchronously from the last-synced value in the local
// cache, so the intro can honour the referee's on/off + text without waiting on
// a network round-trip. The async loadSplashConfig()/poll refresh it afterward.
function primeSplashConfigFromCache(){
  if(splashConfig !== null) return;
  try {
    const raw = (typeof supaStorage !== 'undefined' && supaStorage.cacheGet) ? supaStorage.cacheGet('splash-config') : null;
    if(raw != null) splashConfig = JSON.parse(raw);
  } catch(e){ /* leave null → getSplashConfig() falls back to defaults */ }
}

// App-entry welcome — shown once the access gate clears (players + referee),
// using the referee's shared config. For a returning viewer the splash is
// already painted by the inline pre-boot cover (see index.html) so the app
// never "pops" in visibly; in that case we adopt the live cover instead of
// re-showing it (which would flash the app for a frame).
let _introShown = false;
function showIntroSplash(){
  if(_introShown) return;                     // only ever once per page load
  _introShown = true;
  primeSplashConfigFromCache();
  const c = getSplashConfig().intro;
  const prebooted = (typeof window !== 'undefined' && window.__introPreboot);
  if(!c.enabled){
    if(prebooted) dismissSplash();             // stale cover from an old cached config → drop it
    return;                                     // referee turned the intro off
  }
  if(prebooted){
    window.__introPreboot = false;
    try { clearTimeout(window.__introPrebootSafety); } catch(e){}
    armSplashDismissal(3800);                   // cover is already up with this content — just time it out
  } else {
    // Fresh login (no pre-boot cover ran): show the intro on this same frame,
    // opaque, so the just-revealed app underneath never flashes before it.
    showSplash({ kicker:c.kicker, title:c.title, sub:c.sub, italicSub:true, hint:c.hint, instant:true });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ACCESS GATE
// ═══════════════════════════════════════════════════════════════════════════
// NOTE: this is a casual deterrent, not real security. Anyone who views the
// page source can find the code below. It exists to stop a stray link click
// or idle curiosity from landing someone in the middle of an active
// campaign — not to protect genuinely sensitive information.
// Resolved from the deployed campaign config (config.js → window.AURELIA_CONFIG)
// or a per-device setup, falling back to the reference campaign's code.
const ACCESS_CODE = (typeof aureliaCfg === 'function' && aureliaCfg('accessCode')) || 'Traveller2E!';

function checkPassword(){
  const input = document.getElementById('pw-input');
  const err = document.getElementById('pw-error');
  if(input.value === ACCESS_CODE){
    try { localStorage.setItem('aurelia_access', '1'); } catch(e){}
    document.getElementById('pw-gate').classList.add('hidden');
    showIntroSplash();
  } else {
    input.classList.add('wrong');
    err.textContent = 'Incorrect code — try again.';
    setTimeout(() => input.classList.remove('wrong'), 300);
  }
}

(function initAccessGate(){
  try {
    if(localStorage.getItem('aurelia_access') === '1'){
      document.getElementById('pw-gate').classList.add('hidden');
      showIntroSplash();
    }
  } catch(e){}
})();

// ═══════════════════════════════════════════════════════════════════════════
// SHARED STATE (via Supabase) — reveal status, player notes, party notes
// ═══════════════════════════════════════════════════════════════════════════
// IMPORTANT: only reveal-status flags and notes ever go into shared storage.
// Referee-only content (NPCs, checks, ref notes, the data itself) stays in
// the hardcoded JS exactly as before — never written to storage — so a
// player inspecting storage directly can only see which area IDs are
// "revealed", never the hidden content.

const REVEALABLE_STATION_AREAS = ['elevator','docking','concourse','security','medical','maintenance'];
const REVEALABLE_AURELIA_LOCS  = ['station','capitol','cradle','hegemony-base','spire-range','omnisynth','underdeck'];

let revealedAreas = {}; // {areaId: true/false} — shared
let myIdentity = null;  // local to this device — "Rhett Calder", "Cassia Velen", etc.
let notesViewMode = 'private'; // 'private' | 'party'
let secureRole = null;  // set from the get-content token response; overrides pmCheck when present
let secureNetworkLock = null;   // TASK 6: referee's view of the network-lock state (from get-content; referee only)
let securePlayers = null;       // TASK 7: player roster + tokens (referee only, from get-content)
let networkLockMessage = '';    // TASK 6: 403 lock-out message to surface to a blocked device

// With a secure token, the SERVER's role is authoritative for the whole UI
// (chrome + content). Without one, fall back to the local player-mode checkbox.
// The table display window (js/93) is NEVER a referee, whatever the shared
// localStorage says — this one line at the choke point keeps every
// referee-only surface (overlays, design mode, records) off the table TV.
// previewAs: a real referee "Preview as player" state. null = not previewing;
// '' = generic player; a name = as that identity. While set, isReferee() reports
// false so ALL render/visibility gates (canSee, .ref-only, redaction) behave as
// that player — but isRefereeReal() still reports true, and NETWORK/poll guards
// use it so the referee never polls (which would overwrite their full in-memory
// design data with the redacted public copies). Enter/exit below.
let previewAs = null;
function isReferee(){ if(DISPLAY_MODE) return false; if(previewAs !== null) return false; if(phonePlayerLock()) return false; return secureRole ? (secureRole === 'referee') : !pmCheck.checked; }
// The device's REAL referee status, ignoring an active preview. Poll/load/write
// guards use this; render gates use isReferee().
function isRefereeReal(){ return (previewAs !== null) ? true : isReferee(); }

// ── Permission model (V1) ────────────────────────────────────────────────
// Per-viewer information gating. This is spoiler/visibility control, NOT
// security — the data still ships to every device (see CLAUDE.md). canSee()
// decides whether the UI *renders* a piece of content for the current viewer.
// Audiences:
//   'all' (or null) → everyone
//   'referee'       → referee only
//   ['Rhett Calder', …] (or a single name string) → those identities
// The referee always sees everything. Identity is honor-system (free-text,
// swappable) — promoting myIdentity from a notes-key into the gating key.
function currentRole(){
  return isReferee() ? 'referee' : (myIdentity || null);
}
function canSee(audience){
  if(audience == null || audience === 'all') return true;
  if(isReferee()) return true;            // referee sees everything
  if(audience === 'referee') return false;
  if(Array.isArray(audience)) return audience.includes(myIdentity);
  return audience === myIdentity;
}
// Reflect the current identity onto #root as a body-class, so visibility can
// also be driven in pure CSS (mirrors how .pm-active gates .ref-only) for
// future per-player styling without per-render JS branching.
function applyIdentityClass(){
  if(!rootEl) return;
  rootEl.classList.remove('as-rhett','as-cass','as-other');
  if(isReferee()){ refreshRoleGatedViews(); return; }
  if(myIdentity === 'Rhett Calder')      rootEl.classList.add('as-rhett');
  else if(myIdentity === 'Cassia Velen') rootEl.classList.add('as-cass');
  else if(myIdentity)                    rootEl.classList.add('as-other');
  refreshRoleGatedViews();
}
// Re-render the surfaces whose content depends on role/identity (galaxy route
// styling) when the viewer's role or identity changes.
function refreshRoleGatedViews(){
  if(currentView === 'galaxy' && typeof HX!=='undefined') HX.refresh();
}

// ── Preview as player (referee) ─────────────────────────────────────────────
// Lets a referee see the map exactly as a chosen player does — reveals,
// per-player redaction, spoiler regions and referee-only content all applied —
// without changing their token, role or data. It flips isReferee() (render
// gates) while leaving isRefereeReal() true (network guards), so nothing is
// fetched or overwritten; the view is rebuilt from the referee's own in-memory
// data through the same canSee()/.ref-only gates a player's device uses.
let _previewSaved = null;
function _previewRerender(){
  try {
    if(currentView === 'station' && typeof renderDetail === 'function' && typeof cur !== 'undefined' && cur){ renderDetail(); if(typeof updateStationLocks === 'function') updateStationLocks(); }
    else if(currentView === 'system'){ if(typeof selectedBody !== 'undefined' && selectedBody && typeof selectBody === 'function') selectBody(selectedBody); else if(typeof renderSystemOverview === 'function') renderSystemOverview(); }
    else if(currentView === 'body' && typeof selectedBody !== 'undefined' && selectedBody){ if(typeof selectedBodyLoc !== 'undefined' && selectedBodyLoc && typeof selectBodyLocation === 'function') selectBodyLocation(selectedBodyLoc); else if(typeof buildBodyView === 'function') buildBodyView(selectedBody); }
    else if(currentView === 'galaxy' && typeof HX !== 'undefined') HX.refresh();
  } catch(e){ if(typeof pushErr === 'function') pushErr('preview rerender failed', e && e.stack); }
  if(typeof refreshSecureViews === 'function') refreshSecureViews();
  if(typeof renderWhoAmI === 'function') renderWhoAmI();
}
function showPreviewBanner(identity){
  let b = document.getElementById('preview-banner');
  if(!b){
    b = document.createElement('div');
    b.id = 'preview-banner';
    b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:9999;display:flex;align-items:center;gap:12px;background:#2A1A3B;color:#fff;border:1px solid #9B59B6;border-radius:8px;padding:8px 14px;font-family:monospace;font-size:12px;box-shadow:0 6px 22px rgba(0,0,0,.55)';
    document.body.appendChild(b);
  }
  const who = identity ? escHtml(identity) : 'a generic player';
  b.innerHTML = `<span>👁 Previewing as <b style="color:#C9A0FF">${who}</b></span>
    <button onclick="exitPlayerPreview()" style="background:#9B59B6;border:none;border-radius:5px;color:#fff;font-family:monospace;font-size:11px;padding:5px 12px;cursor:pointer">Exit preview</button>`;
  b.style.display = 'flex';
}
function hidePreviewBanner(){ const b = document.getElementById('preview-banner'); if(b) b.style.display = 'none'; }
function enterPlayerPreview(identity){
  if(!isRefereeReal()) return;                 // real referees only
  const fp = document.getElementById('float-panels');
  if(previewAs === null){
    _previewSaved = {
      identity: myIdentity,
      pmChecked: pmCheck ? pmCheck.checked : false,
      pmActive: rootEl ? rootEl.classList.contains('pm-active') : false,
      fpPmActive: fp ? fp.classList.contains('pm-active') : false,
    };
  }
  previewAs = identity || '';
  myIdentity = identity || null;
  if(typeof designModeOn !== 'undefined' && designModeOn && typeof forceDesignModeOff === 'function') forceDesignModeOff();
  if(pmCheck) pmCheck.checked = true;
  if(rootEl) rootEl.classList.add('pm-active');
  if(fp) fp.classList.add('pm-active');
  if(typeof applyIdentityClass === 'function') applyIdentityClass();
  showPreviewBanner(identity);
  if(typeof refreshOpenMenus === 'function') refreshOpenMenus();
  _previewRerender();
}
function exitPlayerPreview(){
  if(previewAs === null) return;
  const s = _previewSaved || {};
  const fp = document.getElementById('float-panels');
  previewAs = null;
  myIdentity = (s.identity != null) ? s.identity : null;
  if(pmCheck) pmCheck.checked = !!s.pmChecked;
  if(rootEl) rootEl.classList.toggle('pm-active', !!s.pmActive);
  if(fp) fp.classList.toggle('pm-active', !!s.fpPmActive);
  _previewSaved = null;
  hidePreviewBanner();
  if(typeof applyIdentityClass === 'function') applyIdentityClass();
  if(typeof refreshOpenMenus === 'function') refreshOpenMenus();
  _previewRerender();
}

// ── Secure content (per-player redaction client · Stage 2) ───────────────────
// FLAG-GATED, DEFAULT OFF. With no token stored, every function here is a no-op
// and the app renders the hardcoded data exactly as before. When the referee
// hands a player a token (stored via setContentToken), we (1) strip the baked-in
// referee fields from the in-memory data, then (2) apply only the fragments the
// server returns for that token — so an unauthorised viewer cannot see secrets
// even though the shipped file still contains them (Stage 3 removes them for
// real). Server is authoritative; this is the client half of get-content.
// See docs/per-player-redaction-plan.md and supabase/functions/get-content.
const CONTENT_API = SUPABASE_URL + '/functions/v1/get-content';
function getContentToken(){ try { return localStorage.getItem('aurelia_token') || ''; } catch(e){ return ''; } }
function setContentToken(t){ try { t ? localStorage.setItem('aurelia_token', String(t).trim()) : localStorage.removeItem('aurelia_token'); } catch(e){} }
function secureContentOn(){ return !!getContentToken(); }
// Settings-tab token tools. Both reload so hydrateSecureContent re-runs cleanly
// (it mutates the data structures at boot), or returns to local referee mode.
function applyContentTokenFromInput(){
  const el = document.getElementById('content-token-input');
  setContentToken(el ? el.value : '');
  location.reload();
}
function clearContentToken(){
  const t = getContentToken();
  if(t){ try { localStorage.removeItem(_contentCacheKey(t)); } catch(e){} } // wipe cached content on sign-out
  setContentToken(''); location.reload();
}
// Invite links: the referee shares <app-url>#token=<TOKEN>; a player opening it
// has the token applied automatically. The token rides in the URL *fragment*, so
// it is never sent to the host/server (stays out of access logs); we also strip
// it from the address bar right after applying so it doesn't linger.
function ingestTokenFromUrl(){
  try {
    const m = (location.hash || '').match(/[#&]token=([^&]+)/);
    if(m && m[1]){
      setContentToken(decodeURIComponent(m[1]));
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch(e){}
}
function copyInviteLink(){
  const el = document.getElementById('content-token-input');
  const t = (el ? el.value : '').trim();
  if(!t){ if(typeof showToast === 'function') showToast('Paste a player token first.'); return; }
  const link = location.origin + location.pathname + '#token=' + encodeURIComponent(t);
  const done = () => { if(typeof showToast === 'function') showToast('Invite link copied — send it to the player.'); };
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, () => prompt('Copy this invite link:', link));
  else prompt('Copy this invite link:', link);
}

// ── TASK 6: venue-network lock (referee) ─────────────────────────────────────
// Enable/disable the "same network only" lock through the SAME edge-function path
// that gates ref notes — the lock lives server-side (network_lock table) and is
// pinned to the referee's public IP AS THE EDGE FUNCTION SEES IT. Never a client
// flag. Both enabling and disabling confirm first (the referee asked for the
// warning). Requires a referee token (secureRole==='referee').
async function setNetworkLock(enable){
  const token = getContentToken();
  if(!token || secureRole !== 'referee'){ if(typeof showToast === 'function') showToast('Apply your referee token first.', 'error'); return; }
  const warn = enable
    ? 'Lock this campaign to your current network?\n\nAnyone NOT on the same public IP as you — players on mobile data or a VPN — will be blocked until you turn this off. It auto-unlocks 12 hours after it is pinned (break-glass).'
    : 'Unlock the campaign?\n\nAnyone with a valid token will be able to connect from any network again.';
  if(typeof confirm === 'function' && !confirm(warn)) return;
  try {
    const res = await fetch(CONTENT_API, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ networkLock: { set: !!enable } }),
    });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    secureNetworkLock = data.networkLock || null;
    if(data.players) securePlayers = data.players;
    if(typeof showToast === 'function') showToast(enable
      ? ('Network lock ON — pinned to ' + ((secureNetworkLock && secureNetworkLock.pinned_ip) || 'your IP') + '. Auto-unlocks in 12h.')
      : 'Network lock OFF — players may connect from any network.');
    const menu = document.getElementById('settings-menu');
    if(menu && !menu.classList.contains('hidden') && typeof renderSettingsMenu === 'function') renderSettingsMenu();
  } catch(e){
    if(typeof showToast === 'function') showToast('Could not change the network lock — check your connection.', 'error');
  }
}

// ── TASK 7: referee token vault helpers ──────────────────────────────────────
// Tokens arrive ONLY in the referee's get-content response (securePlayers) — never
// in a player bundle/row. The settings list masks them; these reveal / copy /
// share a single token on demand at the table.
function revealPlayerToken(i){
  const p = (securePlayers || [])[i]; const cell = document.getElementById('pv-tok-' + i);
  if(p && cell){ cell.textContent = p.token; cell.dataset.revealed = '1'; }
}
function copyPlayerToken(i){
  const p = (securePlayers || [])[i]; if(!p) return;
  const done = () => { if(typeof showToast === 'function') showToast('Token copied — hand it to ' + (p.identity || 'the player') + '.'); };
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(p.token).then(done, () => prompt('Copy this token:', p.token));
  else prompt('Copy this token:', p.token);
}
function sharePlayerToken(i){
  const p = (securePlayers || [])[i]; if(!p) return;
  const link = location.origin + location.pathname + '#token=' + encodeURIComponent(p.token);
  if(navigator.share){ navigator.share({ title: 'Aurelia access', text: 'Your access token for ' + (p.identity || 'the campaign'), url: link }).catch(() => {}); }
  else copyPlayerToken(i);
}
// Mirror of the server/extractor classification: fields stripped locally before
// server fragments are applied. MUST stay in sync with tools/extract-content.mjs.
const REDACT_FIELDS = {
  body: ['refNote','hook','npcs','checks','events','rsr','refnotes'],
  area: ['desc','rsr','npcs','checks','events','refnotes','refNote','hook'],
  node: ['refNote','refnotes','npcs','checks','hook'],
  location: ['refNote','hook'],
};
function stripLocalSecrets(){
  try {
    BASE_BODIES_AUROS.forEach(b => REDACT_FIELDS.body.forEach(f => { delete b[f]; }));
    Object.values(MAIN).forEach(a => {
      REDACT_FIELDS.area.forEach(f => delete a[f]);
      if(a.subs) Object.values(a.subs).forEach(s => REDACT_FIELDS.area.forEach(f => delete s[f]));
    });
    if(typeof GALAXY_NODES !== 'undefined') GALAXY_NODES.forEach(n => REDACT_FIELDS.node.forEach(f => { delete n[f]; }));
    if(typeof BASE_LOCATIONS !== 'undefined') Object.values(BASE_LOCATIONS).forEach(bodies =>
      Object.values(bodies).forEach(locs => locs.forEach(l => REDACT_FIELDS.location.forEach(f => { delete l[f]; }))));
    if(typeof TIMED_EVENTS !== 'undefined') TIMED_EVENTS.length = 0; // whole GM timeline
  } catch(e){ console.error('stripLocalSecrets failed', e); }
}

// ── Design-Mode overlay redaction ───────────────────────────────────────────
// stripLocalSecrets() above redacts the SHIPPED campaign data. But a referee's
// Design-Mode edits live in overlay blobs in aurelia_state (body-*, location-*,
// system-*, station-additions, content-*), which are publicly readable — so an
// edited or added refNote / hook / Referee Context / NPC / check / event would
// reach player devices unredacted. stripOverlayForPlayers() removes the SAME
// fields (REDACT_FIELDS) from an overlay blob before it is exposed to players,
// so the player-readable copy of every overlay carries no referee-only content.
// Runs on the referee's device (which has full context incl. the box registry),
// producing the player-safe blob written to the public key; the full blob is
// written to a carved-out "<key>-ref" the referee reads back via get-content.
function _stripFieldsFrom(obj, fields){ if(obj && typeof obj === 'object') fields.forEach(f => { delete obj[f]; }); return obj; }

// Is a content-overrides KEY a referee-only field? content-overrides mixes
// player-visible text (read-aloud, body/location Overview) and referee-only text
// (Referee Context/Notes, refNote, check/event/NPC-row edits), keyed by content
// key, so it must be classified per key rather than per field.
function isRefOnlyContentKey(key){
  if(typeof key !== 'string') return false;
  if(/(^|[-_])refnotes$/i.test(key)) return true;                 // Referee Notes
  if(/[-_]refNote$/.test(key)) return true;                       // body/location Referee Note box
  if(/[-_](check|checks|event|events)([-_]|$)/i.test(key)) return true;  // skill checks / timed events
  if(/[-_](row|rows)([-_]|$)/i.test(key)) return true;            // NPC detail rows (NPCs are referee-only)
  if(/[-_]npc$/.test(key)) return true;                           // whole-NPC edit (name/role/skills/stats)
  // Station "Referee Context" is an area `desc`; body/location `desc` is the
  // player-visible Overview — so only a `-desc` that is NOT a body-/loc- key.
  if(/[-_]desc$/.test(key) && !/^body-/.test(key) && !/^loc-/.test(key)) return true;
  // Custom boxes: `…-box-<btKey>` is referee-only iff its box type is refOnly.
  const bm = key.match(/[-_]box[-_](.+)$/);
  if(bm && typeof getBoxTypes === 'function'){
    const bt = getBoxTypes().find(t => t && t.key === bm[1]);
    if(bt && bt.refOnly) return true;
  }
  return false;
}

// Per-store shape + the REDACT_FIELDS set to strip from each object it holds.
// Stores NOT listed (faction-*, galaxy-lanes, route-blocks, hex-paint) carry no
// referee-only fields, so they pass through unchanged.
const _OVERLAY_STRIP = {
  'body-additions':         { shape: 'sysArray',     fields: REDACT_FIELDS.body },
  'body-prop-overrides':    { shape: 'sysIdMap',     fields: REDACT_FIELDS.body },
  'body-deletions':         { shape: 'sysIdDel',     fields: REDACT_FIELDS.body,     sub: 'body' },
  'location-additions':     { shape: 'sysBodyArray', fields: REDACT_FIELDS.location },
  'location-prop-overrides':{ shape: 'sysIdMap',     fields: REDACT_FIELDS.location },
  'location-deletions':     { shape: 'sysIdDel',     fields: REDACT_FIELDS.location, sub: 'loc' },
  'system-additions':       { shape: 'array',        fields: REDACT_FIELDS.node },
  'system-prop-overrides':  { shape: 'idMap',        fields: REDACT_FIELDS.node },
  'system-deletions':       { shape: 'idDel',        fields: REDACT_FIELDS.node,     sub: 'node' },
  'station-additions':      { shape: 'stations',     fields: REDACT_FIELDS.area },
  'content-overrides':      { shape: 'contentOv' },
  'content-additions':      { shape: 'wholesale' },
  'content-deletions':      { shape: 'wholesale' },
  'content-history':        { shape: 'wholesale' },
};
// Return a deep copy of an overlay store value with referee-only content removed.
// Never mutates the input (the referee keeps the full data in memory).
function stripOverlayForPlayers(storeName, value){
  const spec = _OVERLAY_STRIP[storeName];
  if(!spec) return value;                                   // secret-free store
  if(spec.shape === 'wholesale') return Array.isArray(value) ? [] : {};
  let v; try { v = JSON.parse(JSON.stringify(value == null ? (Array.isArray(value) ? [] : {}) : value)); }
  catch(e){ return Array.isArray(value) ? [] : {}; }        // unparseable → fail closed (empty)
  const F = spec.fields;
  const each = o => _stripFieldsFrom(o, F);
  switch(spec.shape){
    case 'array':        if(Array.isArray(v)) v.forEach(each); break;
    case 'idMap':        if(v) Object.keys(v).forEach(id => each(v[id])); break;
    case 'sysArray':     if(v) Object.keys(v).forEach(s => { if(Array.isArray(v[s])) v[s].forEach(each); }); break;
    case 'sysIdMap':     if(v) Object.keys(v).forEach(s => { const inner = v[s] || {}; Object.keys(inner).forEach(id => each(inner[id])); }); break;
    case 'sysBodyArray': if(v) Object.keys(v).forEach(s => { const inner = v[s] || {}; Object.keys(inner).forEach(b => { if(Array.isArray(inner[b])) inner[b].forEach(each); }); }); break;
    // Deletion tombstones carry the FULL removed object under .body/.loc/.node.
    case 'sysIdDel':     if(v) Object.keys(v).forEach(s => { const inner = v[s] || {}; Object.keys(inner).forEach(id => { if(inner[id]) _stripFieldsFrom(inner[id][spec.sub], F); }); }); break;
    case 'idDel':        if(v) Object.keys(v).forEach(id => { if(v[id]) _stripFieldsFrom(v[id][spec.sub], F); }); break;
    case 'stations':     if(v) Object.keys(v).forEach(sid => { const st = v[sid] || {}; const areas = st.areas || {}; Object.keys(areas).forEach(ak => { const a = areas[ak]; each(a); if(a && a.subs) Object.keys(a.subs).forEach(sk => each(a.subs[sk])); }); }); break;
    case 'contentOv':    if(v && typeof v === 'object') Object.keys(v).forEach(k => { if(isRefOnlyContentKey(k)) delete v[k]; }); break;
  }
  return v;
}
// A "split" store carries referee-only fields, so the referee writes a stripped
// copy to the public key (players read that) and the FULL copy to "<key>-ref"
// (referees read that back). Consulted by the data layer's mergedSaveStore /
// getOverlayStore. Stores not listed here are secret-free and stay single-copy.
function isSplitStore(key){ return Object.prototype.hasOwnProperty.call(_OVERLAY_STRIP, key); }
function applySecureFragments(content){
  for(const frag of (content || [])){
    const p = String(frag.path || '').split('.'); const v = frag.value || {};
    if(p[0] === 'body'){ const b = BASE_BODIES_AUROS.find(x => x.id === p[1]); if(b) Object.assign(b, v); }
    else if(p[0] === 'node' && typeof GALAXY_NODES !== 'undefined'){ const n = GALAXY_NODES.find(x => x.id === p[1]); if(n) Object.assign(n, v); }
    else if(p[0] === 'area' && MAIN[p[1]]){
      if(p[2] === 'sub'){ MAIN[p[1]].subs = MAIN[p[1]].subs || {}; MAIN[p[1]].subs[p[3]] = Object.assign(MAIN[p[1]].subs[p[3]] || {}, v); }
      else Object.assign(MAIN[p[1]], v);
    }
    else if(p[0] === 'loc' && typeof BASE_LOCATIONS !== 'undefined'){
      // loc.<sys>.<body>.<locId> → merge into that location record
      const arr = BASE_LOCATIONS[p[1]] && BASE_LOCATIONS[p[1]][p[2]];
      const rec = Array.isArray(arr) && arr.find(l => l.id === p[3]);
      if(rec) Object.assign(rec, v);
    }
    else if(frag.path === 'timed_events' && typeof TIMED_EVENTS !== 'undefined' && Array.isArray(v)){
      TIMED_EVENTS.length = 0; v.forEach(e => TIMED_EVENTS.push(e)); // restore GM timeline
    }
  }
}
function refreshSecureViews(){
  try {
    if(currentView === 'galaxy' && typeof HX!=='undefined') HX.refresh();
    else if(currentView === 'system'){ buildOrrery(); if(selectedBody) selectBody(selectedBody); }
    else if(currentView === 'body' && selectedBody){ if(selectedBodyLoc) selectBodyLocation(selectedBodyLoc); else buildBodyView(selectedBody); }
    else if(currentView === 'station' && cur){ renderTabs(); renderDetail(); }
  } catch(e){ console.error('refreshSecureViews failed', e); }
}
// Offline cache (Stage 3.1): the device keeps its OWN token's last get-content
// response so a mid-session dropout falls back to last-known content instead of
// failing closed. It only ever caches content the token is authorised to see, on
// that user's own device, and clearContentToken() wipes it on sign-out.
function _contentCacheKey(token){ return 'aurelia_content_' + token; }
function cacheSecureContent(token, data){
  try { localStorage.setItem(_contentCacheKey(token), JSON.stringify(
    { identity: data.identity, role: data.role, content: data.content, reveals: data.reveals })); }
  catch(e){ /* quota / disabled — non-fatal, the live fetch already worked */ }
}
function getCachedSecureContent(token){
  try { const raw = localStorage.getItem(_contentCacheKey(token)); return raw ? JSON.parse(raw) : null; }
  catch(e){ return null; }
}
// Strip baked-in secrets, apply this token's fragments, and bind its role to the UI.
function applyHydratedData(data){
  stripLocalSecrets();
  applySecureFragments(data.content);
  // A player token enters player mode so referee CHROME (Oracle, referee/design
  // menus, clock controls — all .ref-only) hides too, not just the content.
  secureRole = (data.role === 'referee') ? 'referee' : 'player';
  if(data.identity) myIdentity = data.identity;
  const fp = document.getElementById('float-panels');
  // A referee token on a player-locked phone still shows the player view.
  const playerMode = secureRole !== 'referee' || phonePlayerLock();
  if(pmCheck) pmCheck.checked = playerMode;
  if(rootEl) rootEl.classList.toggle('pm-active', playerMode);
  if(fp) fp.classList.toggle('pm-active', playerMode);
  if(typeof applyIdentityClass === 'function') applyIdentityClass();
  // Refresh the header identity chip now that role + identity are known from the
  // token, so a referee token relabels "Playing as" → "Viewing as" (and shows
  // the token's identity) instead of keeping the pre-hydration text.
  if(typeof renderWhoAmI === 'function') renderWhoAmI();
  refreshSecureViews();
  // Whisper notes ride the same response on boot (absent from CACHED data —
  // cacheSecureContent deliberately doesn't persist them — so offline boots
  // simply start with no thread until the first live poll).
  if(Array.isArray(data.whispers)) applyWhispers(data.whispers);
}
// After a referee's get-content response populates _refOverlays, re-run the
// Design-Mode overlay loaders so they pick up the FULL blobs. The boot loaders
// race hydrate (which is not awaited), so they may have read the redacted public
// copies — or a direct "<key>-ref" read that migration 0014's carve-out blocks.
// Players never reach this (referee-gated).
async function reloadDesignOverlays(){
  if(typeof isRefereeReal === 'function' && !isRefereeReal()) return;
  for(const fn of ['loadContentOverrides','loadBodyStores','loadLocationStores','loadSystemStores','loadAuthoredStations']){
    if(typeof window[fn] === 'function'){ try { await window[fn](); } catch(e){} }
  }
  if(typeof refreshDesignAffordances === 'function') refreshDesignAffordances();
  else if(typeof currentView !== 'undefined' && currentView === 'station' && typeof renderDetail === 'function') renderDetail();
}
async function hydrateSecureContent(){
  const token = getContentToken();
  if(!token) return false;                 // secure mode off → keep hardcoded data
  let data;
  try {
    const res = await fetch(CONTENT_API, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      // designPrefix lets get-content return this campaign's "<store>-ref" overlay
      // blobs (referee only) keyed by bare store name for getOverlayStore().
      body: JSON.stringify({ designPrefix: (typeof campaignKeyPrefix === 'function' ? campaignKeyPrefix() : '') }),
    });
    if(res.status === 403){
      // TASK 6: the venue-network lock blocked this device. Surface the referee's
      // message and fail CLOSED (player-safe shell) — do NOT use cached content.
      let msg = 'The referee has locked this campaign to the venue network.';
      try { const b = await res.json(); if(b && b.message) msg = b.message; } catch(e2){}
      networkLockMessage = msg;
      if(typeof showToast === 'function') showToast(msg, 'error');
      return false;
    }
    if(!res.ok) throw new Error('get-content ' + res.status);
    data = await res.json();
    cacheSecureContent(token, data);       // refresh the offline fallback on every success
    if(data.role === 'referee'){           // TASK 6/7: capture referee-only extras (never present for players)
      secureNetworkLock = data.networkLock || null;
      securePlayers = data.players || null;
      // Full (unredacted) Design-Mode overlay blobs, delivered only to a referee
      // over the token boundary. getOverlayStore() reads these back so the
      // referee still sees their own refNotes/hooks/NPCs after the public copies
      // are redacted and the "-ref" rows are carved out of public read.
      if(typeof _refOverlays !== 'undefined') _refOverlays = data.designRef || {};
      if(secureNetworkLock && secureNetworkLock.repinned && typeof showToast === 'function')
        showToast('Network lock re-pinned to your current IP (' + (secureNetworkLock.pinned_ip || '?') + ').');
    }
  } catch(e){
    // Offline / unreachable: fall back to this token's last cached content so a
    // referee doesn't lose their NPCs/checks mid-session. No cache → fail CLOSED
    // (the bundle holds no secrets), leaving the player-safe shell.
    console.error('Secure content fetch failed', e);
    data = getCachedSecureContent(token);
    if(!data){
      if(typeof showToast === 'function') showToast('Secure content unavailable — check token/connection.');
      return false;
    }
    if(typeof showToast === 'function') showToast('Offline — using last saved content.');
  }
  applyHydratedData(data);
  // Referee: now that _refOverlays holds the full overlay blobs, re-run the
  // overlay loaders so any that raced this fetch swap their redacted reads for
  // the full data. (Fire-and-forget; the loaders re-render on completion.)
  if(data && data.role === 'referee') reloadDesignOverlays();
  return true;
}

async function loadRevealState(){
  try {
    const res = await supaStorage.get('reveal-status', true);
    revealedAreas = res.value != null ? JSON.parse(res.value) : {};
  } catch(e){ revealedAreas = {}; }
}

// ── Shared station clock ─────────────────────────────────────────────
// The clock is now shared campaign state, not a per-device value — only
// the referee can change it (advance, reset, or set directly), and that
// change pushes to Supabase immediately so every player's screen picks
// it up on their next poll, the same way reveal-status already works.
async function loadClockState(){
  try {
    const res = await supaStorage.get('station-clock', true);
    if(res.value != null){ clockMinutes = JSON.parse(res.value).minutes || 0; }
  } catch(e){ /* keep whatever's already in memory */ }
}

async function saveClockState(){
  try { await supaStorage.set('station-clock', JSON.stringify({minutes: clockMinutes}), true); }
  catch(e){ console.error('Clock save failed', e); }
}

// ── Live polling for players ──────────────────────────────────────────
// Referees don't need this (they're the source of truth and update
// optimistically). Players poll every few seconds so reveals/hides show
// up without a manual refresh.
let pollIntervalId = null;
const POLL_MS = 4000;          // fast cadence while connected
const POLL_MAX_MS = 30000;     // ceiling once we back off during an outage
let pollBackoff = POLL_MS;     // current interval — grows when offline, snaps back on markOnline()

async function pollRevealState(){
  if(DISPLAY_MODE) return; // the table TV's only input is the BroadcastChannel (js/93)
  if(isRefereeReal()) return; // real referee never polls (preview reuses in-memory data)
  // Every block gates on res.ok: a failed fetch is a no-op (leaves in-memory
  // state intact), never an overwrite-with-empty-defaults that wipes the screen.
  try {
    const res = await supaStorage.get('reveal-status', true);
    if(res.ok){
      const fresh = res.value != null ? JSON.parse(res.value) : {};
      if(JSON.stringify(fresh) !== JSON.stringify(revealedAreas)){
        revealedAreas = fresh;
        if(currentView === 'station') { renderDetail(); updateStationLocks(); }
        if(currentView === 'body' && selectedBody){ if(selectedBodyLoc) selectBodyLocation(selectedBodyLoc); else buildBodyView(selectedBody); }
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Pick up the referee's station clock changes
  try {
    const resClock = await supaStorage.get('station-clock', true);
    if(resClock.ok && resClock.value != null){
      const freshMinutes = JSON.parse(resClock.value).minutes || 0;
      if(freshMinutes !== clockMinutes){
        clockMinutes = freshMinutes;
        renderClock();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Pick up the referee's splash-screen edits (text / on-off). No re-render
  // needed — the new config is read live the next time a splash is shown.
  try {
    const resSplash = await supaStorage.get('splash-config', true);
    if(resSplash.ok){ splashConfig = resSplash.value != null ? JSON.parse(resSplash.value) : {}; }
  } catch(e){ /* silent — next poll will retry */ }

  // Also pick up any Design Mode content edits the referee has made
  try {
    const res2 = await supaStorage.get('content-overrides', true);
    if(res2.ok){
      const freshOverrides = res2.value != null ? JSON.parse(res2.value) : {};
      if(JSON.stringify(freshOverrides) !== JSON.stringify(contentOverrides)){
        contentOverrides = freshOverrides;
        if(currentView === 'station' && cur) renderDetail();
        if(currentView === 'system' && selectedBody) selectBody(selectedBody);
        if(currentView === 'body' && selectedBody){ if(selectedBodyLoc) selectBodyLocation(selectedBodyLoc); else buildBodyView(selectedBody); }
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // And any added/removed checks, events, or NPC rows
  try {
    const res3 = await supaStorage.get('content-additions', true);
    const res4 = await supaStorage.get('content-deletions', true);
    if(res3.ok && res4.ok){
      const freshAdditions = res3.value != null ? JSON.parse(res3.value) : {};
      const freshDeletions = res4.value != null ? JSON.parse(res4.value) : {};
      const addDelChanged = JSON.stringify(freshAdditions) !== JSON.stringify(contentAdditions)
        || JSON.stringify(freshDeletions) !== JSON.stringify(contentDeletions);
      if(addDelChanged){
        contentAdditions = freshAdditions;
        contentDeletions = freshDeletions;
        if(currentView === 'station' && cur) renderDetail();
        if(currentView === 'system' && selectedBody) selectBody(selectedBody);
        if(currentView === 'body' && selectedBody){ if(selectedBodyLoc) selectBodyLocation(selectedBodyLoc); else buildBodyView(selectedBody); }
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Galaxy regions — players see referee region renames / recolours / changes
  try {
    const ra = await supaStorage.get('faction-additions', true);
    const rd = await supaStorage.get('faction-deletions', true);
    const rp = await supaStorage.get('faction-prop-overrides', true);
    if(ra.ok && rd.ok && rp.ok){
      const fa = ra.value != null ? JSON.parse(ra.value) : {};
      const fd = rd.value != null ? JSON.parse(rd.value) : {};
      const fp = rp.value != null ? JSON.parse(rp.value) : {};
      const facChanged = JSON.stringify(fa) !== JSON.stringify(factionAdditions)
        || JSON.stringify(fd) !== JSON.stringify(factionDeletions)
        || JSON.stringify(fp) !== JSON.stringify(factionPropertyOverrides);
      if(facChanged){
        factionAdditions = fa; factionDeletions = fd; factionPropertyOverrides = fp;
        if(typeof rebuildFactionsFromOverlay === 'function') rebuildFactionsFromOverlay();
        if(currentView === 'galaxy' && typeof HX !== 'undefined') HX.refresh();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Faction visibility — players see the referee hide/reveal spoiler regions
  try {
    const rfh = await supaStorage.get('faction-hidden', true);
    if(rfh.ok){
      // No stored value yet → fall back to the spoilers-hidden default, never {}.
      const fresh = rfh.value != null ? JSON.parse(rfh.value)
        : (typeof FACTION_HIDDEN_DEFAULT !== 'undefined' ? { ...FACTION_HIDDEN_DEFAULT } : {});
      if(typeof factionHidden !== 'undefined' && JSON.stringify(fresh) !== JSON.stringify(factionHidden)){
        factionHidden = fresh;
        if(currentView === 'galaxy' && typeof HX !== 'undefined') HX.refresh();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Galaxy systems — players see referee-added / edited / removed star systems
  try {
    const rsa = await supaStorage.get('system-additions', true);
    const rsd = await supaStorage.get('system-deletions', true);
    const rsp = await supaStorage.get('system-prop-overrides', true);
    if(rsa.ok && rsd.ok && rsp.ok){
      const fa = rsa.value != null ? JSON.parse(rsa.value) : [];
      const fd = rsd.value != null ? JSON.parse(rsd.value) : {};
      const fp = rsp.value != null ? JSON.parse(rsp.value) : {};
      const sysChanged = JSON.stringify(fa) !== JSON.stringify(systemAdditions)
        || JSON.stringify(fd) !== JSON.stringify(systemDeletions)
        || JSON.stringify(fp) !== JSON.stringify(systemPropertyOverrides);
      if(sysChanged){
        systemAdditions = Array.isArray(fa) ? fa : [];
        systemDeletions = fd; systemPropertyOverrides = fp;
        if(typeof rebuildSystemsFromOverlay === 'function') rebuildSystemsFromOverlay();
        if(currentView === 'galaxy' && typeof HX !== 'undefined') HX.refresh();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Trade-goods catalogue — players see referee edits to the Station Trade desk
  // (base prices, DMs, added/removed goods). Public overlay, like the map layers.
  try {
    if(typeof tradeGoodOverrides !== 'undefined'){
      const [rto, rta, rtd] = await Promise.all([
        supaStorage.get('trade-good-overrides', true), supaStorage.get('trade-good-additions', true), supaStorage.get('trade-good-deletions', true),
      ]);
      if(rto.ok && rta.ok && rtd.ok){
        const no = rto.value != null ? JSON.parse(rto.value) : {};
        const na = rta.value != null ? JSON.parse(rta.value) : [];
        const nd = rtd.value != null ? JSON.parse(rtd.value) : {};
        const changed = JSON.stringify(no) !== JSON.stringify(tradeGoodOverrides)
          || JSON.stringify(na) !== JSON.stringify(tradeGoodAdditions)
          || JSON.stringify(nd) !== JSON.stringify(tradeGoodDeletions);
        if(changed){
          tradeGoodOverrides = no; tradeGoodAdditions = Array.isArray(na) ? na : []; tradeGoodDeletions = nd;
          if(typeof HX !== 'undefined' && HX.refresh) HX.refresh();
          if(typeof renderTradePanel === 'function' && typeof tradePanelOpen !== 'undefined' && tradePanelOpen) renderTradePanel();
        }
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Worlds & locations — players see referee-added / edited / removed bodies and
  // locations live, the same way they already get system and content edits.
  // Fetched ONLY while a system or body is on screen (the only views that render
  // them), so the galaxy / station / combat polls stay lean; a fresh navigation
  // into a system catches up on the next tick (≤4s). The six keys are fetched in
  // parallel so this adds one round-trip, not six, to those ticks.
  if(currentView === 'system' || currentView === 'body'){
    try {
      const [rba, rbd, rbp, rla, rld, rlp] = await Promise.all([
        supaStorage.get('body-additions', true),      supaStorage.get('body-deletions', true),      supaStorage.get('body-prop-overrides', true),
        supaStorage.get('location-additions', true),  supaStorage.get('location-deletions', true),  supaStorage.get('location-prop-overrides', true),
      ]);
      if(rba.ok && rbd.ok && rbp.ok && rla.ok && rld.ok && rlp.ok){
        const nba = rba.value != null ? JSON.parse(rba.value) : {};
        const nbd = rbd.value != null ? JSON.parse(rbd.value) : {};
        const nbp = rbp.value != null ? JSON.parse(rbp.value) : {};
        const nla = rla.value != null ? JSON.parse(rla.value) : {};
        const nld = rld.value != null ? JSON.parse(rld.value) : {};
        const nlp = rlp.value != null ? JSON.parse(rlp.value) : {};
        const bodyChanged = JSON.stringify(nba) !== JSON.stringify(bodyAdditions)
          || JSON.stringify(nbd) !== JSON.stringify(bodyDeletions)
          || JSON.stringify(nbp) !== JSON.stringify(bodyPropertyOverrides);
        const locChanged = JSON.stringify(nla) !== JSON.stringify(locationAdditions)
          || JSON.stringify(nld) !== JSON.stringify(locationDeletions)
          || JSON.stringify(nlp) !== JSON.stringify(locationPropertyOverrides);
        if(bodyChanged){ bodyAdditions = nba; bodyDeletions = nbd; bodyPropertyOverrides = nbp; }
        if(locChanged){ locationAdditions = nla; locationDeletions = nld; locationPropertyOverrides = nlp; }
        if(bodyChanged || locChanged){
          // Rebuild whichever view is on screen; if the body the player was
          // looking at was removed under them, fall back a level rather than
          // render a hole (mirrors the referee's own restoreDesign path).
          if(currentView === 'system'){
            if(typeof buildOrrery === 'function') buildOrrery();
            if(selectedBody && typeof getBodies === 'function' && getBodies().find(b => b.id === selectedBody)){
              if(typeof selectBody === 'function') selectBody(selectedBody);
            } else if(typeof goSystemOverview === 'function') goSystemOverview();
          } else if(currentView === 'body' && selectedBody){
            if(typeof getBodies === 'function' && getBodies().find(b => b.id === selectedBody)){
              if(selectedBodyLoc && typeof selectBodyLocation === 'function') selectBodyLocation(selectedBodyLoc);
              else if(typeof buildBodyView === 'function') buildBodyView(selectedBody);
            } else if(typeof goSystem === 'function') goSystem();
          }
        }
      }
    } catch(e){ /* silent — next poll will retry */ }
  }

  // Authored station deck maps — players receive referee-authored interiors
  // (and live edits to them) the same way they receive galaxy edits.
  try {
    if(typeof stationAdditions !== 'undefined'){
      const rst = await supaStorage.get('station-additions', true);
      if(rst.ok){
        const fresh = (rst.value != null ? JSON.parse(rst.value) : {}) || {};
        if(JSON.stringify(fresh) !== JSON.stringify(stationAdditions)){
          stationAdditions = fresh;
          if(currentView === 'station' && typeof currentStationId !== 'undefined' && currentStationId !== 'aurelia'){
            if(typeof stationDef === 'function' && !stationDef()){ if(typeof navBack === 'function') navBack(); } // station deleted under us
            else if(typeof renderStationMap === 'function'){
              renderStationMap(); updateNodes(); renderHeader(); renderTabs(); renderDetail(); renderFooter();
            }
          }
        }
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Quest log — players see live updates as referee changes quest status,
  // adds objectives, or marks things done during a session
  try {
    const resQ = await supaStorage.get('quest-log', true);
    if(resQ.ok){
      const freshQuests = resQ.value != null ? JSON.parse(resQ.value) || [] : [];
      if(JSON.stringify(freshQuests) !== JSON.stringify(questLog)){
        questLog = freshQuests;
        if(questPanelOpen) renderQuestPanel();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // GalNet — players get the living galaxy's news feed live from the shared econ-state
  // row (the referee writes it as they advance the sim). We pull only the small `news`
  // array out of the row and hand it to the panel; the heavy sim state is left untouched.
  try {
    const resN = await supaStorage.get('econ-state', true);
    if(resN.ok && resN.value != null){
      const parsed = JSON.parse(resN.value);
      if(parsed && Array.isArray(parsed.news) && typeof galnetSyncFeed === 'function') galnetSyncFeed(parsed.news);
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Shared turn order — players get the referee's redacted initiative board live,
  // and the panel auto-opens the moment the referee shares one.
  try {
    const resTO = await supaStorage.get('initiative', true);
    if(resTO.ok){
      const freshTO = resTO.value != null ? (JSON.parse(resTO.value) || {shared:false,turnId:null,rows:[]}) : {shared:false,turnId:null,rows:[]};
      if(JSON.stringify(freshTO) !== JSON.stringify(playerInit)){
        const wasShared = playerInit.shared;
        playerInit = freshTO;
        if(typeof updateTurnOrderBtn === 'function') updateTurnOrderBtn();
        if(typeof dkeInitChanged === 'function') dkeInitChanged();   // deck-plan token overlays
        if(playerInit.shared && !wasShared && !turnOrderPanelOpen){
          toggleTurnOrderPanel();      // reveal the board when combat begins
        } else if(turnOrderPanelOpen){
          renderTurnOrder();
        }
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Session journal — players see new saved recaps ("Previously on…") appear live
  try {
    const resJ = await supaStorage.get('session-log', true);
    if(resJ.ok){
      const freshJ = resJ.value != null ? JSON.parse(resJ.value) || [] : [];
      if(JSON.stringify(freshJ) !== JSON.stringify(sessionLog)){
        sessionLog = freshJ;
        if(journalPanelOpen) renderJournalPanel();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Cargo manifest — players see the party's speculative-trade hold update live
  try {
    const resTC = await supaStorage.get('trade-cargo', true);
    if(resTC.ok){
      const freshTC = resTC.value != null ? (JSON.parse(resTC.value) || {lots:[]}) : {lots:[]};
      if(JSON.stringify(freshTC) !== JSON.stringify(tradeCargo)){
        tradeCargo = freshTC;
        if(cargoPanelOpen) renderCargoPanel();
        if(typeof tradePanelOpen !== 'undefined' && tradePanelOpen) renderTradePanel();
        if(typeof boardPanelOpen !== 'undefined' && boardPanelOpen) renderBoardPanel();
        if(shipPanelOpen) renderShipPanel();   // sheet manifest lists contracted freight/mail
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Recurring ship costs — other referee devices see accruals/approvals live
  try {
    const resSC = await supaStorage.get('ship-costs', true);
    if(resSC.ok && resSC.value != null){
      const freshSC = JSON.parse(resSC.value);
      if(typeof shipCosts !== 'undefined' && freshSC && JSON.stringify(freshSC) !== JSON.stringify(shipCosts)){
        shipCosts = freshSC;
        if(typeof shipCostsEnsure === 'function') shipCostsEnsure();
        if(fundsPanelOpen) renderFundsPanel();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Starport board — players see fresh postings and taken lots live
  try {
    const resSB = await supaStorage.get('starport-board', true);
    if(resSB.ok){
      const freshSB = resSB.value != null ? (JSON.parse(resSB.value) || { world:'', entries:[] }) : { world:'', entries:[] };
      if(typeof starBoard !== 'undefined' && JSON.stringify(freshSB) !== JSON.stringify(starBoard)){
        starBoard = freshSB;
        if(typeof boardPanelOpen !== 'undefined' && boardPanelOpen) renderBoardPanel();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Handouts — players learn of (and get nudged about) newly-pushed handouts
  try {
    const resHO = await supaStorage.get('handouts', true);
    if(resHO.ok){
      const freshHO = resHO.value != null ? JSON.parse(resHO.value) || [] : [];
      if(JSON.stringify(freshHO) !== JSON.stringify(handouts)){
        const oldIds = new Set(handouts.map(h => h.id));
        handouts = freshHO;
        const fresh = freshHO.filter(h => !oldIds.has(h.id) && (typeof canSee === 'function' ? canSee(h.visibleTo) : true));
        if(fresh.length && typeof showToast === 'function' && !isReferee())
          showToast('🖼 The referee shared ' + (fresh.length === 1 ? 'a handout' : fresh.length + ' handouts'));
        if(handoutsPanelOpen) renderHandoutsPanel();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Downtime — players see the referee resolve their between-jump actions live
  try {
    const resDT = await supaStorage.get('downtime', true);
    if(resDT.ok){
      const freshDT = resDT.value != null ? JSON.parse(resDT.value) || [] : [];
      if(JSON.stringify(freshDT) !== JSON.stringify(downtime)){
        downtime = freshDT;
        if(downtimePanelOpen) renderDowntimePanel();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Wiki — players see referee-published lore articles update live
  try {
    const resWK = await supaStorage.get('wiki', true);
    if(resWK.ok){
      const freshWK = resWK.value != null ? JSON.parse(resWK.value) || [] : [];
      if(JSON.stringify(freshWK) !== JSON.stringify(wikiArticles)){
        wikiArticles = freshWK;
        if(wikiPanelOpen) renderWikiPanel();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Contacts — players see referee-published contacts (and their own layer) live
  try {
    const resCON = await supaStorage.get('contacts', true);
    if(resCON.ok){
      const freshCON = resCON.value != null ? JSON.parse(resCON.value) || [] : [];
      if(JSON.stringify(freshCON) !== JSON.stringify(contacts)){
        contacts = freshCON;
        if(contactsPanelOpen) renderContactsPanel();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Rules & gear page references — players see referee-authored citations live
  try {
    const resRR = await supaStorage.get('rules-index', true);
    if(resRR.ok){
      const freshRR = resRR.value != null ? JSON.parse(resRR.value) || [] : [];
      if(JSON.stringify(freshRR) !== JSON.stringify(rulesIndex)){
        rulesIndex = freshRR; _rulesLoaded = true;
        if(qrefOpen) renderQref();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // BYO rulebook config — players learn a rulebook is available (and its version)
  try {
    const resRBk = await supaStorage.get('rulebook-config', true);
    if(resRBk.ok){
      const freshRBk = resRBk.value != null ? JSON.parse(resRBk.value) || {} : {};
      if(JSON.stringify(freshRBk) !== JSON.stringify(rulebookConfig)){
        rulebookConfig = freshRBk; _rbLoaded = true;
        if(qrefOpen) renderQref();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Ship status — players see live fuel/route/destination changes the referee makes
  try {
    const resShip = await supaStorage.get('ship-state', true);
    if(resShip.ok && resShip.value != null){
      const freshShip = Object.assign({}, shipState, JSON.parse(resShip.value));
      if(JSON.stringify(freshShip) !== JSON.stringify(shipState)){
        shipState = freshShip;
        if(shipPanelOpen) renderShipPanel();
        if(typeof tradePanelOpen !== 'undefined' && tradePanelOpen) renderTradePanel();
        if(typeof boardPanelOpen !== 'undefined' && boardPanelOpen) renderBoardPanel();
        // Fuel/jump changes can flip the out-of-range advisory — refresh lanes.
        if(currentView === 'galaxy' && typeof HX!=='undefined') HX.refresh();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Route blocks — nav crew see the referee arm/disarm lanes mid-session
  try {
    const resRB = await supaStorage.get('route-blocks', true);
    if(resRB.ok){
      const freshRB = resRB.value != null ? JSON.parse(resRB.value) : { enabled:true, blocks:{} };
      const normRB = { enabled: freshRB.enabled !== false, blocks: freshRB.blocks || {} };
      if(JSON.stringify(normRB) !== JSON.stringify(routeBlocks)){
        routeBlocks = normRB;
        if(currentView === 'galaxy' && typeof HX!=='undefined') HX.refresh();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Territory paint — players see the referee paint/erase border hexes live
  try {
    const resHP = await supaStorage.get('hex-paint', true);
    if(resHP.ok){
      const freshHP = resHP.value != null ? (JSON.parse(resHP.value) || {}) : {};
      if(typeof hexPaint !== 'undefined' && JSON.stringify(freshHP) !== JSON.stringify(hexPaint)){
        hexPaint = freshHP;
        if(currentView === 'galaxy' && typeof HX!=='undefined') HX.refresh();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Imperial date — players see the referee advance the campaign date
  try {
    const resDate = await supaStorage.get('imperial-date', true);
    if(resDate.ok && resDate.value != null){
      const fresh = JSON.parse(resDate.value);
      if(fresh.day !== imperialDate.day || fresh.year !== imperialDate.year){
        imperialDate = fresh;
        renderImperialDate();
        if(calPanelOpen) renderCalendarPanel();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Campaign timeline — players see new/revealed dated events
  try {
    const resEv = await supaStorage.get('campaign-events', true);
    if(resEv.ok){
      const freshEv = resEv.value != null ? JSON.parse(resEv.value) || [] : [];
      if(JSON.stringify(freshEv) !== JSON.stringify(campaignEvents)){
        campaignEvents = freshEv;
        if(calPanelOpen) renderCalendarPanel();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Discovery log — players see entries the referee reveals (rumoured/known)
  try {
    const resDisc = await supaStorage.get('discovery-log', true);
    if(resDisc.ok){
      const freshDisc = resDisc.value != null ? JSON.parse(resDisc.value) || [] : [];
      if(JSON.stringify(freshDisc) !== JSON.stringify(discoveryLog)){
        discoveryLog = freshDisc;
        if(discPanelOpen) renderDiscoveryPanel();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Party funds — players see deposits / withdrawals / referee grants live
  try {
    const resFunds = await supaStorage.get('funds', true);
    if(resFunds.ok && resFunds.value != null){
      const freshFunds = JSON.parse(resFunds.value);
      if(JSON.stringify(freshFunds) !== JSON.stringify(funds)){
        funds = freshFunds;
        if(fundsPanelOpen) renderFundsPanel();
        if(typeof tradePanelOpen !== 'undefined' && tradePanelOpen) renderTradePanel();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Reputation — players see standing shifts and revealed milestones
  try {
    const resRep = await supaStorage.get('reputation', true);
    if(resRep.ok && resRep.value != null){
      const freshRep = JSON.parse(resRep.value);
      if(JSON.stringify(freshRep) !== JSON.stringify(reputation)){
        reputation = freshRep;
        if(repPanelOpen) renderReputationPanel();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Clocks — players see revealed faction/countdown clocks fill up live
  try {
    const resClk = await supaStorage.get('clocks', true);
    if(resClk.ok){
      const freshClk = resClk.value != null ? JSON.parse(resClk.value) || [] : [];
      if(typeof clocks !== 'undefined' && JSON.stringify(freshClk) !== JSON.stringify(clocks)){
        clocks = freshClk;
        if(typeof clocksPanelOpen !== 'undefined' && clocksPanelOpen) renderClocksPanel();
      }
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Forced view — the referee is "presenting"; offer a dismissible soft-follow banner
  try {
    const resFV = await supaStorage.get('forced-view', true);
    if(resFV.ok){
      const fv = resFV.value != null ? (JSON.parse(resFV.value) || null) : null;
      handleForcedView(fv);
    }
  } catch(e){ /* silent — next poll will retry */ }

  // Whisper notes — referee replies land without a manual refresh. Token
  // holders only; goes to get-content (whispersOnly), not the public KV.
  await pollWhispers();
}

// ── Whisper notes (table-presentation plan §8) ──────────────────────────────
// Secret player↔referee notes. The text lives under the aurelia_state key
// 'whispers' but is NEVER readable anonymously: migration 0011 excludes that
// row from the public SELECT policy, so the only read path is get-content's
// token-checked {whispersOnly:true} mode, which returns each identity exactly
// their own thread (referee: all threads) — redaction happens server-side,
// not in CSS. Writes go through put-state append/resolve (supaStorage.
// sendWhisper, js/50). No new timers: players piggyback the 4s pollRevealState
// cycle, the referee piggybacks the existing 8s heartbeat below — and the
// table TV (DISPLAY_MODE) never fetches, renders, or composes whispers.
let whisperItems = null;          // null = never loaded (suppresses arrival toasts on the first fill)
let whisperKnownIds = null;       // ids already seen in-memory, for arrival detection

function whisperSeenTs(){ try { return parseInt(localStorage.getItem('whisper-seen') || '0', 10) || 0; } catch(e){ return 0; } }
function whisperMarkSeen(){
  try { localStorage.setItem('whisper-seen', String(Date.now())); } catch(e){}
  if(typeof updateWhisperBadge === 'function') updateWhisperBadge();
}
// ── Player standing rides the whisper channel ────────────────────────────────
// A "standing" is a referee-authored, per-player-PRIVATE reputation entry, delivered
// as a whisper whose text is tagged with STANDING_TAG + JSON. It reuses the whisper
// plumbing wholesale (put-state stamps visibleTo:[player]+ref:true; get-content returns
// each identity only their own), so it inherits the same real privacy with no new
// backend. These tagged items are NOT chat, so they're kept OUT of the whisper/notes
// panel, its unread count, and its arrival toasts — the Standing panel owns them.
const STANDING_TAG = '§STANDING§';
function isStandingNote(it){ return !!(it && it.ref && typeof it.text === 'string' && it.text.indexOf(STANDING_TAG) === 0); }
// An item is "incoming" if the other side wrote it: referee replies carry
// ref:true (stamped by put-state — never client-supplied), player notes don't.
function whisperIncoming(it){ return isReferee() ? !it.ref : !!it.ref; }
function whisperUnreadCount(){
  if(!Array.isArray(whisperItems)) return 0;
  const seen = whisperSeenTs();
  return whisperItems.filter(it => it && !isStandingNote(it) && whisperIncoming(it) && !it.resolved && (Date.parse(it.ts) || 0) > seen).length;
}

async function pollWhispers(){
  if(DISPLAY_MODE) return;                     // the TV shares the referee's localStorage token — never let it fetch threads
  const token = (typeof getContentToken === 'function') ? getContentToken() : '';
  if(!token) return;                           // whispers exist only for token holders
  try {
    const res = await fetch(CONTENT_API, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ whispersOnly: true }),
    });
    if(!res.ok) return;                        // incl. a 403 network lock — silent; the next tick retries
    const data = await res.json();
    applyWhispers(Array.isArray(data.whispers) ? data.whispers : []);
  } catch(e){ /* silent — next tick retries */ }
}

function applyWhispers(fresh){
  if(DISPLAY_MODE) return;  // boot hydrate also carries whispers — the TV keeps NO whisper state, not even in memory
  const first = (whisperItems === null);
  const known = whisperKnownIds || new Set();
  const freshNew = first ? [] : fresh.filter(it => it && it.id && !known.has(it.id) && whisperIncoming(it));
  const news = freshNew.filter(it => !isStandingNote(it));            // real whispers only (standing has its own channel)
  const standingNew = freshNew.filter(isStandingNote);                // a player's standing was set/changed
  whisperItems = fresh;
  whisperKnownIds = new Set(fresh.map(it => it && it.id).filter(Boolean));
  if(news.length && typeof showToast === 'function'){
    // The toast is the WHOLE notification — deliberately no sound (a chime at
    // a quiet table defeats the point of a silently passed note).
    const msg = isReferee()
      ? '🤫 Whisper from ' + (news[news.length - 1].from || 'a player') + (news.length > 1 ? ' (+' + (news.length - 1) + ' more)' : '')
      : '🤫 The referee answered your whisper.';
    showToast(msg);
  }
  if(standingNew.length && !isReferee() && typeof showToast === 'function') showToast('🎖 Your standing has changed — check the Standing panel.');
  if(typeof updateWhisperBadge === 'function') updateWhisperBadge();
  if(typeof whispersPanelOpen !== 'undefined' && whispersPanelOpen && typeof renderWhispersPanel === 'function') renderWhispersPanel();
  if(typeof updateStandingBadge === 'function') updateStandingBadge();
  if(typeof standingPanelOpen !== 'undefined' && standingPanelOpen && typeof renderStandingPanel === 'function') renderStandingPanel();
}

// ── Forced view (player side) ────────────────────────────────────────────────
// Rides the existing poll (no new timer). A NEW ts shows the soft-follow banner;
// {cleared:true} hides it; the ts guard means a dismissed push never re-yanks the
// player on the next poll. Follow routes through applyViewSpec(); dismiss just hides.
let lastForcedViewTs = 0;
let forcedViewPending = null;
function handleForcedView(fv){
  if(isReferee()) return;                                     // referee never follows their own push
  if(!fv || !fv.ts || fv.ts === lastForcedViewTs) return;     // nothing new
  lastForcedViewTs = fv.ts;
  if(fv.cleared){ forcedViewHideBanner(); forcedViewPending = null; return; }
  forcedViewPending = fv;
  forcedViewShowBanner(fv.label || 'a location');
}
function forcedViewShowBanner(label){
  const b = document.getElementById('forced-view-banner'); if(!b) return;
  const t = document.getElementById('forced-view-banner-txt');
  if(t) t.textContent = 'The referee is showing: ' + label;
  b.classList.remove('hidden');
}
function forcedViewHideBanner(){ const b = document.getElementById('forced-view-banner'); if(b) b.classList.add('hidden'); }
function forcedViewFollow(){ const fv = forcedViewPending; forcedViewHideBanner(); if(fv) applyViewSpec(fv); }
function forcedViewDismiss(){ forcedViewHideBanner(); }

// Navigate the local view to a spec {view, systemId, bodyId, locId}. Shared by the
// player soft-follow AND the referee's own "Go there" from a planner location link.
// Every hop is typeof-guarded so a missing nav module just no-ops.
function applyViewSpec(spec){
  if(!spec) return;
  try {
    if(spec.view === 'galaxy'){ if(typeof goGalaxy === 'function') goGalaxy(); return; }
    if(spec.systemId && typeof enterSystem === 'function') enterSystem(spec.systemId);
    if(spec.view === 'station'){ if(typeof enterStation === 'function') enterStation(spec.stationId); return; }
    if(spec.view === 'system') return;
    if(spec.bodyId && typeof goBodyView === 'function') goBodyView(spec.bodyId);
    if(spec.locId && typeof selectBodyLocation === 'function') selectBodyLocation(spec.locId);
  } catch(e){ if(typeof pushErr === 'function') pushErr('applyViewSpec failed', e && e.stack, { spec }); }
}

// Self-scheduling poll (setTimeout, not setInterval) so the interval can grow
// during an outage — markOnline() resets pollBackoff to POLL_MS the moment a
// fetch succeeds, so recovery is immediate while a dead connection isn't
// hammered every 4s.
function startPolling(){
  stopPolling();
  if(DISPLAY_MODE) return; // table TV: no polling, ever (js/93 drives it)
  if(isRefereeReal()) return;
  pollBackoff = POLL_MS;
  const tick = async () => {
    await pollRevealState();
    pollBackoff = (connState === 'live') ? POLL_MS : Math.min(Math.round(pollBackoff * 1.5), POLL_MAX_MS);
    pollIntervalId = setTimeout(tick, pollBackoff);
  };
  pollIntervalId = setTimeout(tick, pollBackoff);
}

// iOS suspends timers for backgrounded/home-screen apps, but visibilitychange/
// focus events reliably fire when the app comes back — so this catches the gap
// even without the player tapping Refresh.
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible' && !isRefereeReal()) pollRevealState();
});
window.addEventListener('focus', () => {
  if(!isRefereeReal()) pollRevealState();
});

// Reconnect plumbing (referee included — the referee never runs the 4s player
// poll, so this is their only path back). The browser 'online' event and an 8s
// heartbeat both drain the outbound queue; the heartbeat also keeps the pill's
// clock honest — and carries the referee's ONE poll-like need: incoming
// whisper notes (players get theirs on the faster pollRevealState cycle, so
// pollWhispers no-ops the heartbeat copy for them via the isReferee() gate).
window.addEventListener('online', () => {
  markOnline();
  flushQueue();
  if(!isRefereeReal()) pollRevealState(); else pollWhispers();
});
window.addEventListener('offline', () => { markOffline(); });
setInterval(() => {
  if(queueLength()) flushQueue();
  if(isRefereeReal()) pollWhispers();  // no-op on the TV (DISPLAY_MODE guard) and without a token
  updateConnPill(); // refresh the "last synced … ago" label
}, 8000);

function stopPolling(){
  if(pollIntervalId){ clearTimeout(pollIntervalId); pollIntervalId = null; }
}

// Players don't need a manual refresh button: the 4s poll covers active use, and
// the visibilitychange/focus re-poll below covers the iOS timer-suspension gap
// when a backgrounded home-screen app returns to the foreground.

async function saveRevealState(){
  try { await supaStorage.set('reveal-status', JSON.stringify(revealedAreas), true); }
  catch(e){ console.error('Reveal save failed', e); }
}

function isRevealed(areaId){
  return !!revealedAreas[areaId];
}

// Shared referee "player visibility" control — a keyboard-accessible switch
// (reusing .theme-toggle) wired to toggleReveal. Used by both the station and
// Aurelia detail panels so the affordance is identical in both places.
function revealToggleRowHTML(id){
  const rev = isRevealed(id);
  return `<div class="reveal-toggle-row">
      <span class="reveal-toggle-lbl">👁 Player visibility — ${rev ? '<b style="color:#4CAF50">revealed</b>' : '<b style="color:#d45050">hidden</b>'}</span>
      <div style="display:flex;gap:8px;align-items:center">
        <div class="theme-toggle ${rev?'on':''}" role="switch" tabindex="0" aria-checked="${rev}"
             title="${rev ? 'Revealed to players — tap to hide' : 'Hidden from players — tap to reveal'}"
             onclick="toggleReveal('${id}')"
             onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleReveal('${id}');}"><div class="theme-toggle-knob"></div></div>
        <button class="reveal-btn" style="background:transparent;color:var(--tx1);border-color:var(--bd0)" onclick="hideAllAreas()" title="Reset all areas to hidden, for testing">Hide All</button>
      </div>
    </div>`;
}

function toggleReveal(areaId){
  if(!isReferee()) return; // safety — only referee can toggle
  revealedAreas[areaId] = !revealedAreas[areaId];
  // Render IMMEDIATELY using the in-memory state — don't wait on the network.
  // The save happens in the background; if it fails, the button still
  // reflects local intent and a retry happens on the next poll cycle.
  if(currentView === 'station') { renderHeader(); renderDetail(); updateStationLocks(); }
  if(currentView === 'body' && selectedBody){ if(selectedBodyLoc) selectBodyLocation(selectedBodyLoc); else buildBodyView(selectedBody); }
  saveRevealState(); // fire-and-forget
}

function hideAllAreas(){
  if(!isReferee()) return;
  if(!confirm('Hide all areas and locations from players? This resets the reveal state for testing.')) return;
  revealedAreas = {};
  if(currentView === 'station') { renderHeader(); renderDetail(); updateStationLocks(); }
  if(currentView === 'body' && selectedBody){ if(selectedBodyLoc) selectBodyLocation(selectedBodyLoc); else buildBodyView(selectedBody); }
  saveRevealState();
}

// ── Full campaign reset (referee only) ──────────────────────────────────
// Wipes: reveal status (shared, via Supabase), RSR markers, event log,
// fired-timed-events tracking, station clock, and the initiative tracker.
// Deliberately leaves alone: access code unlock, player identity, and
// floating-panel positions — those are device/person preferences, not
// campaign state, and re-asking for them every reset would be annoying.
function resetCampaign(){
  if(!isReferee()) return;
  if(!confirm('Reset the whole campaign?\n\nThis wipes reveal status, RSR markers, the event log, the station clock, the initiative tracker, AND any Design Mode edits — including added/removed/edited bodies, checks, events, and NPC rows — for EVERYONE. This cannot be undone.')) return;

  // Local-only state
  try {
    localStorage.removeItem('aurelia_clock');
    localStorage.removeItem('aurelia_rsr');
    localStorage.removeItem('aurelia_evlog');
    localStorage.removeItem('aurelia_fired');
    localStorage.removeItem('aurelia_combatants');
  } catch(e){}

  // In-memory state
  clockMinutes = 0;
  Object.keys(rsrFound).forEach(k => rsrFound[k] = false);
  eventLog = [];
  firedEvents = new Set();
  combatants = [];
  currentTurnIdx = -1;
  revealedAreas = {};
  contentOverrides = {};
  contentHistory = {};
  contentAdditions = {};
  contentDeletions = {};
  bodyAdditions = {};
  bodyDeletions = {};
  bodyPropertyOverrides = {};
  locationAdditions = {};
  locationDeletions = {};
  locationPropertyOverrides = {};
  systemAdditions = [];
  systemDeletions = {};
  systemPropertyOverrides = {};
  factionAdditions = {};
  factionDeletions = {};
  factionPropertyOverrides = {};
  factionHidden = { archon:true, vast:true };   // back to spoilers-hidden default
  weaponAdditions = [];
  weaponDeletions = {};
  weaponPropertyOverrides = {};
  shipRoster = { ships: [], fleets: [] };
  npcRoster = [];
  selectedBodyLoc = null;
  questLog = [];
  sessionPlans = [];

  // Shared state (Supabase) — fire and forget, same pattern as toggleReveal
  saveRevealState();
  saveClockState();
  saveContentOverrides();
  saveContentHistory();
  saveContentAdditions();
  saveContentDeletions();
  saveBodyAdditions();
  saveBodyDeletions();
  saveBodyPropertyOverrides();
  saveLocationAdditions();
  saveLocationDeletions();
  saveLocationPropertyOverrides();
  saveSystemAdditions();
  saveSystemDeletions();
  saveSystemPropertyOverrides();
  saveFactionAdditions();
  saveFactionDeletions();
  saveFactionPropertyOverrides();
  saveFactionHidden();
  saveWeaponAdditions();
  saveWeaponDeletions();
  saveWeaponPropertyOverrides();
  saveShipRoster();
  saveNpcRoster();
  saveQuestLog();
  saveSessionPlans();

  // Galaxy is back to the authored regions + systems — fold the now-empty overlays in.
  if(typeof rebuildFactionsFromOverlay === 'function') rebuildFactionsFromOverlay();
  if(typeof rebuildSystemsFromOverlay === 'function') rebuildSystemsFromOverlay();

  // Re-render everything currently visible
  renderClock();
  renderRsrMarkers();
  renderEventLog();
  renderInit();
  if(questPanelOpen) renderQuestPanel();
  if(currentView === 'station') { renderHeader(); renderDetail(); updateStationLocks(); }
  if(currentView === 'system'){ buildOrrery(); if(selectedBody && getBodies().find(b=>b.id===selectedBody)) selectBody(selectedBody); else goSystemOverview(); }
  if(currentView === 'body'){ if(selectedBody && getBodies().find(b=>b.id===selectedBody)) buildBodyView(selectedBody); else goSystem(); }
  if(currentView === 'galaxy' && typeof HX !== 'undefined') HX.refresh();

  alert('Campaign reset.');
}

// Node positions on the static station SVG, for lock-badge placement
const STATION_NODE_RECTS = {
  elevator:    {x:155, y:20,  w:90},
  docking:     {x:8,   y:188, w:122},
  concourse:   {x:148, y:88,  w:104},
  security:    {x:270, y:188, w:122},
  medical:     {x:274, y:298, w:118},
  maintenance: {x:14,  y:298, w:118}
};

function updateStationLocks(){
  // Remove any existing lock badges first
  document.querySelectorAll('.station-lock-badge').forEach(el => el.remove());
  // Lock badges belong to the built-in Aurelia map's fixed geometry — an
  // authored station is gated as a whole by its host location's reveal.
  if(typeof currentStationId !== 'undefined' && currentStationId !== 'aurelia') return;
  if(isReferee()) return; // referee always sees everything, no badges needed
  const svg = document.getElementById('mapsvg');
  if(!svg) return;
  REVEALABLE_STATION_AREAS.forEach(areaId => {
    if(isRevealed(areaId)) return;
    const r = STATION_NODE_RECTS[areaId];
    if(!r) return;
    const ns = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(ns,'g');
    g.setAttribute('class','station-lock-badge');
    g.setAttribute('pointer-events','none');
    const circle = document.createElementNS(ns,'circle');
    circle.setAttribute('cx', r.x + r.w - 10);
    circle.setAttribute('cy', r.y + 10);
    circle.setAttribute('r', 8);
    circle.setAttribute('fill', '#0a0c12');
    circle.setAttribute('stroke', '#555570');
    circle.setAttribute('stroke-width', '1');
    const text = document.createElementNS(ns,'text');
    text.setAttribute('x', r.x + r.w - 10);
    text.setAttribute('y', r.y + 13);
    text.setAttribute('text-anchor','middle');
    text.setAttribute('font-size','9');
    text.textContent = '🔒';
    g.appendChild(circle); g.appendChild(text);
    svg.appendChild(g);
  });
}

// ── Player identity ────────────────────────────────────────────────────
// The Archon Gambit crew — the DEFAULT Campaign Pack's source of truth only.
// Consumers read crewRoster() (js/05), which serves the active pack's crew;
// authored campaigns define their own in Studio ▸ Crew & Ship.
const KNOWN_CHARACTERS = ['Rhett Calder','Cassia Velen','Dr Curculion','Riley','Riven Dahl'];

function checkIdentity(){
  if(DISPLAY_MODE) return; // table TV never prompts for (or shows) an identity
  try {
    myIdentity = localStorage.getItem('aurelia_identity');
  } catch(e){}
  if(isReferee()){
    // Referee is never *forced* to pick a character, but if one was chosen we
    // restore it and surface the "Playing as" control so they can keep
    // switching which character they view as (and Sheets opens it directly).
    if(myIdentity) renderWhoAmI();
    return;
  }
  if(!myIdentity){
    showIdentityModal();
  } else {
    renderWhoAmI();
  }
}

function showIdentityModal(){
  const modal = document.getElementById('identity-modal');
  const quick = document.getElementById('identity-quick');
  quick.innerHTML = crewRoster().map(n =>
    `<button class="identity-quick-btn" onclick="document.getElementById('identity-input').value='${n}'">${n}</button>`
  ).join('');
  modal.classList.remove('hidden');
}

function confirmIdentity(){
  const val = document.getElementById('identity-input').value.trim();
  if(!val) return;
  myIdentity = val;
  try { localStorage.setItem('aurelia_identity', val); } catch(e){}
  document.getElementById('identity-modal').classList.add('hidden');
  renderWhoAmI();
}

function renderWhoAmI(){
  applyIdentityClass();
  if(shipPanelOpen) renderShipPanel(); // gated readouts depend on identity
  // A referee isn't *playing* a character — this control is how they PREVIEW the
  // game as a given player (spoiler-gating, per-player views). Label it
  // "Viewing as" for the referee, "Playing as" for a player, so a referee with
  // a character selected is never mislabelled as playing them.
  const ref = (typeof isReferee === 'function') && isReferee();
  const verb = ref ? 'Viewing as' : 'Playing as';
  const strip = document.getElementById('whoami-strip');
  if(strip) strip.innerHTML = `${verb} <span onclick="changeIdentity()">${myIdentity}</span>`;
  const headerBtn = document.getElementById('header-whoami-btn');
  const headerName = document.getElementById('header-whoami-name');
  const headerPrefix = document.getElementById('header-whoami-prefix');
  if(headerPrefix) headerPrefix.textContent = verb;
  if(headerBtn){
    headerBtn.title = ref ? 'Tap to preview the game as another player' : 'Tap to switch character';
    // Show the chip whenever a character is selected — for the referee too, so
    // they can switch which player they're previewing as.
    if(myIdentity){
      headerName.textContent = myIdentity;
      headerBtn.classList.remove('hidden');
    } else {
      headerBtn.classList.add('hidden');
    }
  }
}

function changeIdentity(){
  try { localStorage.removeItem('aurelia_identity'); } catch(e){}
  myIdentity = null;
  renderWhoAmI();
  showIdentityModal();
}

// ── Private + party notes (shared storage) ───────────────────────────────
async function loadPrivateNote(key){
  if(!myIdentity) return '';
  try {
    const res = await supaStorage.get(`note-private-${myIdentity}-${key}`, false);
    return res.value != null ? res.value : '';
  } catch(e){ return ''; }
}

async function savePrivateNote(key, text){
  if(!myIdentity) return;
  try { await supaStorage.set(`note-private-${myIdentity}-${key}`, text, false); }
  catch(e){ console.error('Private note save failed', e); }
}

async function loadPartyNotes(key){
  try {
    const res = await supaStorage.get(`note-party-${key}`, true);
    return res.value != null ? JSON.parse(res.value) : [];
  } catch(e){ return []; }
}

async function addPartyNote(key, text){
  if(!text.trim()) return;
  const author = isReferee() ? 'Referee' : (myIdentity || 'Unknown');
  const list = await loadPartyNotes(key);
  list.push({author, text: text.trim(), t: Date.now()});
  try { await supaStorage.set(`note-party-${key}`, JSON.stringify(list), true); }
  catch(e){ console.error('Party note save failed', e); }
  return list;
}


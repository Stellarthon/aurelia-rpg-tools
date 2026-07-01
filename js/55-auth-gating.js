// ═══════════════════════════════════════════════════════════════════════════
// SPLASH OVERLAY — reusable welcome screen
// ═══════════════════════════════════════════════════════════════════════════
// A brief full-screen welcome that fades in over the app, auto-dismisses after
// a few seconds, and can be skipped with a tap or any key. Two callers drive
// it: showIntroSplash() on app entry, and maybeSystemWelcome() the first time
// a traveller visits a system (see 10-galaxy.js). Purely cosmetic — the app
// boots underneath regardless, so this can never block access.
let _splashTimer = null, _splashArm = null;
function _splashEnd(){ dismissSplash(); }
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

  // Restart cleanly if a previous splash is still up (e.g. system after intro).
  clearTimeout(_splashTimer); clearTimeout(_splashArm);
  document.removeEventListener('keydown', _splashEnd);
  el.removeEventListener('click', _splashEnd);
  el.classList.remove('show');
  void el.offsetWidth;                       // reflow, so the entrance replays
  el.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => el.classList.add('show'));

  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  _splashTimer = setTimeout(dismissSplash, reduce ? 1400 : (opts.duration || 3800));
  // Arm skip-to-dismiss only after the entrance settles, so the click or key
  // that triggered the splash doesn't instantly close it.
  _splashArm = setTimeout(() => {
    if(el.classList.contains('show')){
      document.addEventListener('keydown', _splashEnd);
      el.addEventListener('click', _splashEnd);
    }
  }, 500);
}
function dismissSplash(){
  const el = document.getElementById('app-splash');
  if(!el || !el.classList.contains('show')) return;
  clearTimeout(_splashTimer); clearTimeout(_splashArm);
  el.classList.remove('show');               // fades out via the CSS transition
  el.setAttribute('aria-hidden', 'true');
  document.removeEventListener('keydown', _splashEnd);
  el.removeEventListener('click', _splashEnd);
}

// App-entry welcome — shown once the access gate clears (players + referee).
let _introShown = false;
function showIntroSplash(){
  if(_introShown) return;                     // only ever once per page load
  _introShown = true;
  showSplash({
    kicker: 'Aurelian System',
    title:  'WELCOME TRAVELLER',
    sub:    'May the stars ever be full of wonder.',
    italicSub: true,
    hint:   'Tap anywhere to begin',
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ACCESS GATE
// ═══════════════════════════════════════════════════════════════════════════
// NOTE: this is a casual deterrent, not real security. Anyone who views the
// page source can find the code below. It exists to stop a stray link click
// or idle curiosity from landing someone in the middle of an active
// campaign — not to protect genuinely sensitive information.
const ACCESS_CODE = 'Traveller2E!';

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

// With a secure token, the SERVER's role is authoritative for the whole UI
// (chrome + content). Without one, fall back to the local player-mode checkbox.
function isReferee(){ return secureRole ? (secureRole === 'referee') : !pmCheck.checked; }

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
  const playerMode = secureRole !== 'referee';
  if(pmCheck) pmCheck.checked = playerMode;
  if(rootEl) rootEl.classList.toggle('pm-active', playerMode);
  if(fp) fp.classList.toggle('pm-active', playerMode);
  if(typeof applyIdentityClass === 'function') applyIdentityClass();
  refreshSecureViews();
}
async function hydrateSecureContent(){
  const token = getContentToken();
  if(!token) return false;                 // secure mode off → keep hardcoded data
  let data;
  try {
    const res = await fetch(CONTENT_API, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if(!res.ok) throw new Error('get-content ' + res.status);
    data = await res.json();
    cacheSecureContent(token, data);       // refresh the offline fallback on every success
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
  if(isReferee()) return; // referee never polls — would be pointless and noisy
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

  // Ship status — players see live fuel/route/destination changes the referee makes
  try {
    const resShip = await supaStorage.get('ship-state', true);
    if(resShip.ok && resShip.value != null){
      const freshShip = Object.assign({}, shipState, JSON.parse(resShip.value));
      if(JSON.stringify(freshShip) !== JSON.stringify(shipState)){
        shipState = freshShip;
        if(shipPanelOpen) renderShipPanel();
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
}

// Self-scheduling poll (setTimeout, not setInterval) so the interval can grow
// during an outage — markOnline() resets pollBackoff to POLL_MS the moment a
// fetch succeeds, so recovery is immediate while a dead connection isn't
// hammered every 4s.
function startPolling(){
  stopPolling();
  if(isReferee()) return;
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
  if(document.visibilityState === 'visible' && !isReferee()) pollRevealState();
});
window.addEventListener('focus', () => {
  if(!isReferee()) pollRevealState();
});

// Reconnect plumbing (referee included — the referee never polls, so this is
// their only path back). The browser 'online' event and an 8s heartbeat both
// drain the outbound queue; the heartbeat also keeps the pill's clock honest.
window.addEventListener('online', () => {
  markOnline();
  flushQueue();
  if(!isReferee()) pollRevealState();
});
window.addEventListener('offline', () => { markOffline(); });
setInterval(() => {
  if(queueLength()) flushQueue();
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
  weaponAdditions = [];
  weaponDeletions = {};
  weaponPropertyOverrides = {};
  shipRoster = { ships: [], fleets: [] };
  npcRoster = [];
  selectedBodyLoc = null;
  questLog = [];

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
  saveWeaponAdditions();
  saveWeaponDeletions();
  saveWeaponPropertyOverrides();
  saveShipRoster();
  saveNpcRoster();
  saveQuestLog();

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
const KNOWN_CHARACTERS = ['Rhett Calder','Cassia Velen','Dr Curculion','Riley','Riven Dahl'];

function checkIdentity(){
  if(isReferee()) return; // referee never needs an identity
  try {
    myIdentity = localStorage.getItem('aurelia_identity');
  } catch(e){}
  if(!myIdentity){
    showIdentityModal();
  } else {
    renderWhoAmI();
  }
}

function showIdentityModal(){
  const modal = document.getElementById('identity-modal');
  const quick = document.getElementById('identity-quick');
  quick.innerHTML = KNOWN_CHARACTERS.map(n =>
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
  const strip = document.getElementById('whoami-strip');
  if(strip) strip.innerHTML = `Playing as <span onclick="changeIdentity()">${myIdentity}</span>`;
  const headerBtn = document.getElementById('header-whoami-btn');
  const headerName = document.getElementById('header-whoami-name');
  if(headerBtn){
    if(myIdentity && !isReferee()){
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


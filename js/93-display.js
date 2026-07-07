// ═══════════════════════════════════════════════════════════════════════════
// TABLE PRESENTATION SUITE — display window, scene push, ambience beats
// ═══════════════════════════════════════════════════════════════════════════
// The referee's laptop drives the table TV over HDMI: "Open table display"
// spawns index.html?display=1 (a chromeless, player-safe, read-only window the
// referee drags to the TV) and the two windows talk over a BroadcastChannel —
// same-origin, same-machine, zero latency, works fully offline. The TV is
// NEVER a referee (isReferee() hard-returns false under DISPLAY_MODE, js/55)
// and never writes shared state (supaStorage guards, js/50).
// See docs/table-presentation-plan.md.
//
// Message protocol — channel 'aurelia-table-display', every message {v:1, t}:
//   display → referee   hello                       display booted; referee replies with a full scene
//   referee → display   scene   {spec, camera?, handout?, blank}   full state sync (boot / resync / explicit send)
//   referee → display   view    {spec}              switch view; spec = {view, systemId, bodyId, locId} (applyViewSpec shape, js/55)
//   referee → display   camera  {x, y, scale}       galaxy pan/zoom mirror (rAF-throttled sender side)
//   referee → display   handout {url, name}         show image full-screen (resolved URL — the display holds no handout state)
//   referee → display   handout-close               dismiss the image
//   referee → display   ping    {nx, ny, target}    2s pulse at normalized coords; target 'handout' maps into the image box
//   referee → display   blank   {on}                blackout toggle (the panic button)
//
// Known limitation: BroadcastChannel needs an http(s) origin, so the
// double-clickable index.local.html (file://) build can't host the display
// link — the referee controls hide themselves there (displaySupported()).

const DISPLAY_CHANNEL = 'aurelia-table-display';

function displaySupported(){
  return typeof BroadcastChannel !== 'undefined' && location.protocol !== 'file:';
}
function escTD(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// 2s pulse marker at a fixed screen position — used by BOTH windows (the
// referee sees a local echo of the ping they just sent).
function tablePulseAt(x, y){
  const p = document.createElement('div');
  p.className = 'table-ping';
  p.style.left = x + 'px'; p.style.top = y + 'px';
  document.body.appendChild(p);
  setTimeout(() => p.remove(), 2100);
}

// ═══════════════════════════════════════════════════════════════════════════
// REFEREE HALF — channel, Follow/Hold, controls, scene push, pings
// ═══════════════════════════════════════════════════════════════════════════

let displayChan = null;        // BroadcastChannel (both halves)
let displayFollow = false;     // Follow vs Hold — HOLD by default (§2.4): the referee browses privately unless they opt in
let displayBlank = false;      // referee's blackout toggle state
let displayConnected = false;  // lit on the first hello from a display window (MVP: no heartbeat)
let tvHandout = null;          // {id, url, name} currently pushed to the TV, or null

function displayCast(msg){
  if(!displayChan || DISPLAY_MODE) return;
  if(typeof isReferee === 'function' && !isReferee()) return;
  msg.v = 1;
  try { displayChan.postMessage(msg); } catch(e){}
}

// The spec the display navigates by — same shape applyViewSpec (js/55) consumes.
function tableViewSpec(){
  return {
    view: (typeof currentView !== 'undefined') ? currentView : 'galaxy',
    systemId: (typeof currentSystemId !== 'undefined') ? currentSystemId : null,
    bodyId: (typeof selectedBody !== 'undefined') ? selectedBody : null,
    locId: (typeof selectedBodyLoc !== 'undefined') ? selectedBodyLoc : null
  };
}
function tableSceneSnapshot(){
  const spec = tableViewSpec();
  let camera = null;
  try { if(spec.view === 'galaxy' && typeof HX !== 'undefined' && HX.getCamera) camera = HX.getCamera(); } catch(e){}
  return { t:'scene', spec, camera, handout: tvHandout, blank: displayBlank };
}

// ── Follow mode: wrap the existing global view functions at load time ────────
// The app is one hoisted global scope with late-bound inline on*= handlers
// (docs/ARCHITECTURE.md), and this module loads after js/10/30/85 but before
// boot (js/98), so reassigning the globals here catches every caller. A
// missing global is logged loudly — that's the drift alarm if a refactor
// renames one of these (table-presentation-plan §9).
const DISPLAY_WRAPPED_FNS = ['goGalaxy','enterSystem','goSystemOverview','goSystem','enterStation','navBack','goBodyView','goAurelia','selectBody','selectBodyLocation'];

let _tdViewCastT = null;
function displayFollowCast(){
  if(!displayFollow) return;
  // Coalesce: one nav action can pass through several wrapped functions
  // (e.g. navBack → goSystem) — broadcast only the settled state.
  clearTimeout(_tdViewCastT);
  _tdViewCastT = setTimeout(() => displayCast({ t:'view', spec: tableViewSpec() }), 0);
}

function displayOpenWindow(){
  if(DISPLAY_MODE) return;
  if(!displaySupported()){ if(typeof showToast === 'function') showToast('Table display needs the hosted (http) app', 'error'); return; }
  // Always from a direct click/keypress (user gesture) so popup blockers stay quiet.
  try { window.open(location.pathname + '?display=1', 'aurelia-display'); } catch(e){}
}
function displayToggleFollow(){
  displayFollow = !displayFollow;
  if(displayFollow) displayCast(tableSceneSnapshot());   // converge the TV the moment Follow turns on
  if(typeof showToast === 'function') showToast(displayFollow ? '📺 Follow — the table display mirrors you' : '📺 Hold — the table display is frozen', 'info');
  tableDisplayRerenderSettings();
}
function displaySendView(){
  displayCast(tableSceneSnapshot());                     // explicit "Send to table" works in either mode
  if(typeof showToast === 'function') showToast('📺 Sent this view to the table', 'success');
}
function displayToggleBlank(){
  displayBlank = !displayBlank;
  displayCast({ t:'blank', on: displayBlank });
  if(typeof showToast === 'function') showToast(displayBlank ? '📺 Table display blanked' : '📺 Table display restored', 'info');
  tableDisplayRerenderSettings();
}

// ── Phase 2: scene push (handout → TV) + referee ping ────────────────────────
function displayCanSend(){
  return !DISPLAY_MODE && displaySupported() && (typeof isReferee !== 'function' || isReferee());
}
function sendHandoutToTable(id){
  if(!displayCanSend()) return;
  const h = (typeof handouts !== 'undefined' ? handouts : []).find(x => x.id === id);
  if(!h) return;
  // The TV is physically public — pushing a private handout gets an explicit confirm.
  if(h.visibleTo && h.visibleTo !== 'all'){
    const who = Array.isArray(h.visibleTo) ? h.visibleTo.join(', ') : h.visibleTo;
    if(!confirm('This handout is private to ' + who + ' — show it on the shared table display anyway?')) return;
  }
  tvHandout = { id: h.id, url: handoutUrlFor(hoCampaign(), h.id, h.ver), name: h.name || 'Handout' };
  displayCast({ t:'handout', url: tvHandout.url, name: tvHandout.name });
  if(typeof showToast === 'function') showToast('📺 On the table: ' + tvHandout.name, 'success');
  tableDisplayRerenderSettings();
}
function sendLightboxHandoutToTable(){
  const box = document.getElementById('handout-lightbox');
  if(box && box.dataset.hid) sendHandoutToTable(box.dataset.hid);
}
function clearTableHandout(){
  if(!tvHandout) return;
  tvHandout = null;
  displayCast({ t:'handout-close' });
  tableDisplayRerenderSettings();
}

// ── Referee control cluster (rendered into the Settings menu by js/60) ───────
function tableDisplaySettingsHTML(){
  if(DISPLAY_MODE || !displaySupported()) return '';
  if(typeof isReferee === 'function' && !isReferee()) return '';
  const btn = 'flex:1;padding:8px;border-radius:var(--rad);font-size:12px;cursor:pointer;font-weight:700';
  const off = 'background:var(--bg2);border:1px solid var(--bd0);color:var(--tx0)';
  const on  = 'background:var(--accentGoldBg);border:1px solid var(--accentGold);color:var(--accentGold)';
  const dot = displayConnected
    ? '<span style="color:var(--accentGold)">●</span> Display connected'
    : '<span style="color:var(--tx1)">○</span> No display yet';
  return `
    <div class="settings-section-lbl">Table Display</div>
    <div class="settings-row">
      <span class="settings-row-label">${dot}</span>
      <button onclick="displayOpenWindow()" style="${btn};${on};flex:0 0 auto;padding:8px 12px">📺 Open table display</button>
    </div>
    <div class="settings-row" style="gap:8px">
      <button onclick="displayToggleFollow()" style="${btn};${displayFollow ? on : off}">${displayFollow ? '🔗 Follow: ON' : '✋ Hold (frozen)'}</button>
      <button onclick="displaySendView()" style="${btn};${off}">📡 Send this view</button>
    </div>
    <div class="settings-row" style="gap:8px">
      <button onclick="displayToggleBlank()" style="${btn};${displayBlank ? on : off}">${displayBlank ? '⬛ Blanked — tap to restore' : '⬛ Blank the display'}</button>
      ${tvHandout ? `<button onclick="clearTableHandout()" style="${btn};${off}">🖼 Clear handout</button>` : ''}
    </div>
    <div class="settings-row" style="font-size:11px;color:var(--tx1)">Drag the new window to the TV, then click it once for fullscreen. Follow mirrors your map live; Hold freezes it while you browse privately. Alt-click the map (or click a pushed handout in its lightbox) to ping the table.</div>`;
}
function tableDisplayRerenderSettings(){
  const menu = document.getElementById('settings-menu');
  if(menu && !menu.classList.contains('hidden') && typeof renderSettingsMenu === 'function') renderSettingsMenu(isReferee());
}

function initTableDisplayReferee(){
  if(!displaySupported()) return;
  try { displayChan = new BroadcastChannel(DISPLAY_CHANNEL); } catch(e){ return; }
  // Every hello gets a full scene snapshot, so reloading either window self-heals.
  displayChan.onmessage = (e) => {
    const msg = e && e.data;
    if(!msg || msg.v !== 1 || msg.t !== 'hello') return;
    if(typeof isReferee === 'function' && !isReferee()) return;
    displayConnected = true;
    displayCast(tableSceneSnapshot());
    tableDisplayRerenderSettings();
  };

  // Follow-mode wrapping (see comment above DISPLAY_WRAPPED_FNS).
  DISPLAY_WRAPPED_FNS.forEach(name => {
    const orig = window[name];
    if(typeof orig !== 'function'){
      console.error('[table-display] expected global is missing, Follow mode will not track it: ' + name);
      return;
    }
    window[name] = function(...a){ const r = orig.apply(this, a); displayFollowCast(); return r; };
  });

  // Galaxy camera mirror — js/10's applyTransform() calls this hook on every
  // pan/zoom frame; throttle to ≤1 message per animation frame.
  let camPending = null, camQueued = false;
  window.onHXCameraChanged = function(cam){
    if(!displayFollow || (typeof currentView !== 'undefined' && currentView !== 'galaxy')) return;
    if(typeof isReferee === 'function' && !isReferee()) return;
    camPending = { x: cam.x, y: cam.y, scale: cam.scale };
    if(camQueued) return;
    camQueued = true;
    requestAnimationFrame(() => {
      camQueued = false;
      if(camPending) displayCast({ t:'camera', x: camPending.x, y: camPending.y, scale: camPending.scale });
      camPending = null;
    });
  };

  // Referee lightbox: stamp the open handout id (for "→ Table" + close wiring)
  // and surface the send button only when a display can actually be driven.
  const _openHandout = openHandout;
  openHandout = function(id){
    _openHandout(id);
    const box = document.getElementById('handout-lightbox');
    if(box) box.dataset.hid = id;
    const send = document.getElementById('handout-lightbox-send');
    if(send) send.classList.toggle('hidden', !displayCanSend());
  };
  // Closing the lightbox on the handout that's on the TV also clears the TV
  // (the close affordance drives both, table-presentation-plan §4.5).
  const _closeHandout = closeHandout;
  closeHandout = function(){
    const box = document.getElementById('handout-lightbox');
    const hid = box ? box.dataset.hid : null;
    _closeHandout();
    if(tvHandout && hid && tvHandout.id === hid) clearTableHandout();
  };

  // Pings: click the pushed handout in the referee lightbox, or Alt-click
  // anywhere over a map view. Local echo pulses on the referee screen too.
  document.addEventListener('click', (e) => {
    if(!displayConnected) return;
    if(typeof isReferee === 'function' && !isReferee()) return;
    const img = document.getElementById('handout-lightbox-img');
    if(img && e.target === img && tvHandout){
      const r = img.getBoundingClientRect();
      if(r.width && r.height){
        displayCast({ t:'ping', nx:(e.clientX - r.left) / r.width, ny:(e.clientY - r.top) / r.height, target:'handout' });
        tablePulseAt(e.clientX, e.clientY);
      }
      return;
    }
    if(e.altKey){
      displayCast({ t:'ping', nx: e.clientX / window.innerWidth, ny: e.clientY / window.innerHeight, target:'view' });
      tablePulseAt(e.clientX, e.clientY);
    }
  }, true);
}

// ═══════════════════════════════════════════════════════════════════════════
// DISPLAY HALF — the chromeless window on the TV
// ═══════════════════════════════════════════════════════════════════════════

function initTableDisplayWindow(){
  document.body.classList.add('display-mode');
  // Adopt the full player-view CSS gating (.ref-only etc.) without touching
  // the checkbox or localStorage — isReferee() is already false (js/55).
  if(typeof rootEl !== 'undefined' && rootEl) rootEl.classList.add('pm-active');
  const fp = document.getElementById('float-panels');
  if(fp) fp.classList.add('pm-active');
  document.title = 'Aurelia — Table Display';

  // Overlay furniture, built here so index.html stays lean. Stacking:
  // handout figure (380) < ping (385) < blank (390) < wait pill (396) < fullscreen affordance (400).
  const fig = document.createElement('figure');
  fig.id = 'display-fig'; fig.className = 'hidden';
  // Deliberately no visible caption: a handout's name can itself be a spoiler
  // ("Ambush site"). The name still arrives for a future toggle.
  fig.innerHTML = '<img alt=""><figcaption class="hidden"></figcaption>';
  document.body.appendChild(fig);

  const blank = document.createElement('div');
  blank.id = 'display-blank'; blank.className = 'hidden';
  document.body.appendChild(blank);

  const wait = document.createElement('div');
  wait.id = 'display-wait'; wait.className = 'hidden';
  wait.textContent = 'Waiting for the referee window…';
  document.body.appendChild(wait);

  // Fullscreen needs a user gesture — a one-click overlay, gone once used.
  const fs = document.createElement('div');
  fs.id = 'display-fs';
  fs.innerHTML = '<span>📺 Click to go fullscreen</span>';
  fs.addEventListener('click', () => {
    try { const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); if(p && p.catch) p.catch(() => {}); } catch(e){}
    fs.remove();
  });
  document.body.appendChild(fs);

  if(!displaySupported()) { wait.textContent = 'Table display needs the hosted (http) app.'; wait.classList.remove('hidden'); return; }
  try { displayChan = new BroadcastChannel(DISPLAY_CHANNEL); } catch(e){ return; }

  let waitTimer = setTimeout(() => wait.classList.remove('hidden'), 2000);
  const gotSignal = () => { clearTimeout(waitTimer); wait.classList.add('hidden'); };

  function setHandout(h){
    const img = fig.querySelector('img');
    if(!h || !h.url){ fig.classList.add('hidden'); img.removeAttribute('src'); return; }
    img.src = h.url;
    fig.classList.remove('hidden');
  }
  function setBlank(on){ blank.classList.toggle('hidden', !on); }
  function applySpec(spec){
    if(!spec) return;
    try {
      if(typeof applyViewSpec === 'function') applyViewSpec(spec);
      // applyViewSpec stops at the system overview; mirror a selected body too.
      if(spec.view === 'system' && spec.bodyId && typeof selectBody === 'function') selectBody(spec.bodyId);
    } catch(e){ console.error('[table-display] view apply failed', e); }
  }
  function applyCamera(c){
    if(!c) return;
    if(typeof currentView !== 'undefined' && currentView !== 'galaxy') return;
    try { if(typeof HX !== 'undefined' && HX.setCamera) HX.setCamera(c); } catch(e){}
  }
  function renderPing(msg){
    let x, y;
    const img = fig.querySelector('img');
    if(msg.target === 'handout' && !fig.classList.contains('hidden') && img){
      const r = img.getBoundingClientRect();
      x = r.left + msg.nx * r.width; y = r.top + msg.ny * r.height;
    } else {
      x = msg.nx * window.innerWidth; y = msg.ny * window.innerHeight;
    }
    tablePulseAt(x, y);
  }

  displayChan.onmessage = (e) => {
    const msg = e && e.data;
    if(!msg || msg.v !== 1) return;
    gotSignal();
    switch(msg.t){
      case 'scene':
        applySpec(msg.spec); applyCamera(msg.camera);
        setHandout(msg.handout); setBlank(!!msg.blank);
        break;
      case 'view':          applySpec(msg.spec); break;
      case 'camera':        applyCamera(msg); break;
      case 'handout':       setHandout(msg); break;
      case 'handout-close': setHandout(null); break;
      case 'ping':          renderPing(msg); break;
      case 'blank':         setBlank(!!msg.on); break;
    }
  };

  displayChan.postMessage({ v:1, t:'hello' });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3 — SCENE AMBIENCE BEATS (referee window only)
// ═══════════════════════════════════════════════════════════════════════════
// Named scene presets ("Startown bar", "Alarm") that play referee-supplied
// audio in a single hidden <audio> on the laptop — with HDMI the OS routes it
// to the TV speakers — or open an external deep link (Spotify/YouTube). One
// track at a time, ~1.5s linear fades, every play button-driven (autoplay
// policies satisfied by construction). No copyrighted audio ships in the
// repo; the synced 'scene-beats' key holds only labels + URLs, so its
// world-readability is acceptable pre-redaction-migration.
//   beat = { id, name, audioUrl?, loop, volume (0–1), externalUrl? }

let sceneBeats = [];
let beatPlayingId = null;
let scenesPanelOpen = false, scenesCollapsed = false;
let _beatEditingId = null;   // beat id loaded into the editor form, or null = adding

async function loadSceneBeats(){
  try { const r = await supaStorage.get('scene-beats', true); if(r.value != null) sceneBeats = JSON.parse(r.value) || []; }
  catch(e){ sceneBeats = []; }
}
async function saveSceneBeats(){
  try { await supaStorage.set('scene-beats', JSON.stringify(sceneBeats), true); }
  catch(e){ console.error('Scene beats save failed:', e); }
}

let _ambEl = null, _ambFadeT = null;
function ambienceEl(){
  if(DISPLAY_MODE) return null;              // the display window never plays or holds audio
  if(!_ambEl){
    _ambEl = document.createElement('audio');
    _ambEl.id = 'ambience-player';
    _ambEl.preload = 'none';
    _ambEl.addEventListener('error', () => {
      if(beatPlayingId && typeof showToast === 'function') showToast('Ambience stream failed — check the audio URL', 'error');
      beatPlayingId = null; renderScenesPanelIfOpen();
    });
    document.body.appendChild(_ambEl);
  }
  return _ambEl;
}
function ambienceFadeTo(el, target, ms, done){
  clearInterval(_ambFadeT);
  const start = el.volume, steps = Math.max(1, Math.round(ms / 50));
  let i = 0;
  _ambFadeT = setInterval(() => {
    i++;
    el.volume = Math.min(1, Math.max(0, start + (target - start) * (i / steps)));
    if(i >= steps){ clearInterval(_ambFadeT); if(done) done(); }
  }, 50);
}

function fireBeat(id){
  if(DISPLAY_MODE || (typeof isReferee === 'function' && !isReferee())) return;
  const b = sceneBeats.find(x => x.id === id); if(!b) return;
  if(!b.audioUrl){
    // Deep-link beat: hand off to the external app (existing window.open pattern)
    // and fade out whatever is playing here — one source of sound at a time.
    if(b.externalUrl){ try { window.open(b.externalUrl, '_blank', 'noopener'); } catch(e){ location.href = b.externalUrl; } stopBeat(); }
    else if(typeof showToast === 'function') showToast('This beat has no audio URL yet — edit it below', 'info');
    return;
  }
  const el = ambienceEl(); if(!el) return;
  const target = Math.min(1, Math.max(0, b.volume != null ? Number(b.volume) : 0.8));
  const start = () => {
    el.src = b.audioUrl;
    el.loop = b.loop !== false;
    el.volume = 0;
    const p = el.play();
    if(p && p.then) p.then(() => {
      beatPlayingId = b.id;
      ambienceFadeTo(el, target, 1500);
      renderScenesPanelIfOpen();
    }).catch(() => { if(typeof showToast === 'function') showToast('Could not play — check the audio URL (CORS/https?)', 'error'); });
  };
  if(!el.paused && el.src) ambienceFadeTo(el, 0, 700, () => { el.pause(); start(); });   // cross-beat: quick fade out, then fade the new one in
  else start();
}
function stopBeat(){
  const el = _ambEl;
  if(!el || el.paused){ beatPlayingId = null; renderScenesPanelIfOpen(); return; }
  ambienceFadeTo(el, 0, 1500, () => { el.pause(); beatPlayingId = null; renderScenesPanelIfOpen(); });
}

// ── Scenes strip panel (floating-panel pattern, js/70) ───────────────────────
function toggleScenesPanel(){
  scenesPanelOpen = !scenesPanelOpen;
  const w = document.getElementById('scenes-wrap'), b = document.getElementById('scenes-btn');
  if(!w) return;
  w.classList.toggle('hidden', !scenesPanelOpen);
  if(b) b.classList.toggle('panel-open', scenesPanelOpen);
  if(scenesPanelOpen) renderScenesPanel();
}
function toggleScenesCollapse(){
  const h = document.getElementById('scenes-header');
  if(h && h.dataset.suppressClick === '1') return;
  scenesCollapsed = !scenesCollapsed;
  document.getElementById('scenes-toggle').textContent = scenesCollapsed ? '▲' : '▼';
  document.getElementById('scenes-body').classList.toggle('collapsed', scenesCollapsed);
  document.getElementById('scenes-wrap').classList.toggle('panel-collapsed', scenesCollapsed);
}
function renderScenesPanelIfOpen(){ if(scenesPanelOpen) renderScenesPanel(); }
function renderScenesPanel(){
  const body = document.getElementById('scenes-body'); if(!body) return;
  if(typeof isReferee === 'function' && !isReferee()){ body.innerHTML = ''; return; }
  const countEl = document.getElementById('scenes-count'); if(countEl) countEl.textContent = sceneBeats.length;

  let strip;
  if(!sceneBeats.length){
    strip = '<div class="handout-empty">No scene beats yet. Name one below and give it an audio URL (your own file, tabletopaudio.com, …) or an external playlist link.</div>';
  } else {
    strip = '<div class="beat-strip">' + sceneBeats.map(b => {
      const playing = b.id === beatPlayingId;
      const icon = b.audioUrl ? (playing ? '■' : '▶') : '↗';
      return `<button class="beat-btn${playing ? ' playing' : ''}" onclick="${playing ? 'stopBeat()' : `fireBeat('${b.id}')`}" title="${escTD(b.audioUrl || b.externalUrl || '')}">${icon} ${escTD(b.name || 'Beat')}</button>`;
    }).join('') + `<button class="beat-btn beat-stop" onclick="stopBeat()" ${beatPlayingId ? '' : 'disabled'}>◼ Stop</button></div>`;
  }

  const editRows = sceneBeats.map(b => `
    <div class="beat-edit-row">
      <span class="beat-edit-name">${escTD(b.name || 'Beat')}</span>
      <button class="beat-mini" onclick="beatEdit('${b.id}')" title="Edit">✎</button>
      <button class="beat-mini beat-mini-del" onclick="beatDelete('${b.id}')" title="Remove">✕</button>
    </div>`).join('');

  const editing = _beatEditingId ? sceneBeats.find(x => x.id === _beatEditingId) : null;
  const form = `
    <div class="beat-add">
      <div class="s-sec-lbl" style="margin:0">${editing ? 'Edit beat' : 'Add a beat'}</div>
      <input id="beat-f-name" placeholder="Name (e.g. Startown bar)" maxlength="40" value="${editing ? escTD(editing.name) : ''}">
      <input id="beat-f-audio" placeholder="Audio URL (mp3/ogg stream — plays here, TV speakers via HDMI)" value="${editing ? escTD(editing.audioUrl || '') : ''}">
      <input id="beat-f-ext" placeholder="…or external link (Spotify/YouTube — opens the app)" value="${editing ? escTD(editing.externalUrl || '') : ''}">
      <div class="beat-form-row">
        <label><input type="checkbox" id="beat-f-loop" ${!editing || editing.loop !== false ? 'checked' : ''}> Loop</label>
        <label style="flex:1">Vol <input type="range" id="beat-f-vol" min="0" max="100" value="${editing && editing.volume != null ? Math.round(editing.volume * 100) : 80}"></label>
      </div>
      <div style="display:flex;gap:6px">
        <button class="cal-add-btn" style="flex:1" onclick="beatSaveFromForm()">${editing ? 'Save beat' : '+ Add beat'}</button>
        ${editing ? '<button class="cal-add-btn" style="flex:0 0 auto" onclick="beatEdit(null)">Cancel</button>' : ''}
      </div>
      <div class="cargo-hint">One track at a time, ~1.5s fades. Audio plays in THIS window — if the TV is silent, check the OS sound-output device (HDMI). No files ship with the app; bring your own legally-owned audio.</div>
    </div>`;

  body.innerHTML = strip + (editRows ? `<div class="beat-edit-list">${editRows}</div>` : '') + form;
}
function beatEdit(id){ _beatEditingId = id; renderScenesPanel(); }
function beatDelete(id){
  if(typeof isReferee === 'function' && !isReferee()) return;
  if(id === beatPlayingId) stopBeat();
  sceneBeats = sceneBeats.filter(b => b.id !== id);
  if(_beatEditingId === id) _beatEditingId = null;
  saveSceneBeats(); renderScenesPanel();
}
function beatSaveFromForm(){
  if(typeof isReferee === 'function' && !isReferee()) return;
  const val = (fid) => { const el = document.getElementById(fid); return el ? el.value.trim() : ''; };
  const name = val('beat-f-name');
  if(!name){ if(typeof showToast === 'function') showToast('Give the beat a name', 'error'); return; }
  const beat = {
    id: _beatEditingId || ('beat_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    name,
    audioUrl: val('beat-f-audio'),
    externalUrl: val('beat-f-ext'),
    loop: !!(document.getElementById('beat-f-loop') || {}).checked,
    volume: Math.min(1, Math.max(0, Number((document.getElementById('beat-f-vol') || {}).value || 80) / 100))
  };
  const i = sceneBeats.findIndex(b => b.id === beat.id);
  if(i >= 0) sceneBeats[i] = beat; else sceneBeats.push(beat);
  _beatEditingId = null;
  saveSceneBeats(); renderScenesPanel();
  if(typeof showToast === 'function') showToast('Scene beat saved');
}

// ═══════════════════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════════════════
if(DISPLAY_MODE){
  initTableDisplayWindow();
} else {
  initTableDisplayReferee();
  loadSceneBeats();  // labels + URLs only; renders on-demand when the panel opens
  if(typeof makePanelDraggable === 'function') makePanelDraggable('scenes-wrap', 'scenes-header');
}

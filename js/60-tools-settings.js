// ═══════════════════════════════════════════════════════════════════════════
// CHARACTER SHEETS
// ═══════════════════════════════════════════════════════════════════════════
// One sheet per known character (Rhett Calder, Cassia Velen, etc.), stored
// as a single JSON blob under key `sheet-${characterName}`. Stored shared
// (like party notes) rather than under the private-note pattern, because
// the referee needs read/write access to ANY character's sheet, not just
// their own — shared:true plus client-side gating (only the matching
// player's own identity, or the referee, can ever open a given sheet in
// the UI) gives us that without a second storage scheme. Fields cover
// stats, skills, equipment, weapons, and notes — finances, augments,
// background terms, and portrait are deliberately omitted per the
// referee's scoping (those matter at character creation, not at the table).

let sheetCurrentCharacter = null; // which character's sheet is currently open in the modal
let sheetIsReadOnlyView = false;  // true if referee is viewing but hasn't selected edit... (sheets are always editable by whoever can open them)
let sheetStatus = [];             // active Traveller 2e status-effect ids for the open sheet
let sheetCurrentData = null;      // the loaded sheet blob for the open character — lets saveCurrentSheet preserve fields not shown as inputs (weapons/equipment legacy, invMigrated, portrait)

// Characteristics come from the active Campaign Pack (UPP by default). Falls
// back to the Traveller six before the pack engine loads.
function sheetAttrKeys(){
  return (typeof pkAttributes === 'function' && pkAttributes().length) ? pkAttributes() : [
    {key:'str',label:'STR'},{key:'dex',label:'DEX'},{key:'end',label:'END'},
    {key:'intl',label:'INT'},{key:'edu',label:'EDU'},{key:'soc',label:'SOC'}];
}
function emptySheet(){
  const s = { name:'', age:'', skills:'', equipment:'', weapons:'', notes:'', status:[] };
  sheetAttrKeys().forEach(a => s[a.key] = 7);
  return s;
}

// Curated Traveller 2e conditions the character sheet can flag. `harm:true`
// tints the active chip red (a genuine detriment); situational ones stay gold.
const TRAVELLER_STATUS_FX = [
  { id:'stunned',      ico:'💫', name:'Stunned',        harm:true,  desc:'Reduced actions; DM− until it wears off' },
  { id:'wounded',      ico:'🩸', name:'Wounded',        harm:true,  desc:'A physical characteristic driven to/near 0' },
  { id:'unconscious',  ico:'😵', name:'Unconscious',    harm:true,  desc:'Out of the fight — cannot take actions' },
  { id:'fatigued',     ico:'🥵', name:'Fatigued',       harm:true,  desc:'DM−1 to all checks until you rest' },
  { id:'diseased',     ico:'🦠', name:'Diseased',       harm:true,  desc:'Ongoing characteristic damage' },
  { id:'poisoned',     ico:'☠️', name:'Poisoned',       harm:true,  desc:'Toxin effect in progress' },
  { id:'drugged',      ico:'💊', name:'Drugged',        harm:false, desc:'Under a stim/drug effect' },
  { id:'prone',        ico:'🤕', name:'Prone',          harm:false, desc:'Knocked down — DM− melee, harder to hit at range' },
  { id:'encumbered',   ico:'🎒', name:'Encumbered',     harm:false, desc:'Heavy load — DM− to physical tasks' },
  { id:'lowg',         ico:'🌌', name:'Low / Zero-G',   harm:false, desc:'Untrained: DM−2 to physical tasks' },
  { id:'highg',        ico:'⬇️', name:'High-G',         harm:false, desc:'DM− and faster fatigue' },
  { id:'vacuum',       ico:'🌬️', name:'Vacuum',         harm:true,  desc:'Suffocation / exposure damage each round' },
  { id:'radiation',    ico:'☢️', name:'Radiation',      harm:true,  desc:'Accumulating rads — END/characteristic risk' },
  { id:'onfire',       ico:'🔥', name:'On Fire',        harm:true,  desc:'3D damage per round until extinguished' }
];

function charDM(score){
  // Route through the campaign's modifier ladder (Traveller by default).
  if(typeof dmForScore === 'function') return dmForScore(score);
  const n = parseInt(score) || 0;
  if(n <= 0) return -3;
  if(n <= 2) return -2;
  if(n <= 5) return -1;
  if(n <= 8) return 0;
  if(n <= 11) return 1;
  if(n <= 14) return 2;
  return 3;
}

async function loadSheet(characterName){
  try {
    const res = await supaStorage.get(`sheet-${characterName}`, true);
    if(res.value == null) return emptySheet();
    return Object.assign(emptySheet(), JSON.parse(res.value));
  } catch(e){ return emptySheet(); }
}

async function saveSheet(characterName, data){
  try { await supaStorage.set(`sheet-${characterName}`, JSON.stringify(data), true); }
  catch(e){ console.error('Sheet save failed', e); }
}

// ── Sheet menu (small popover from the header button) ──────────────────
function openSheetMenu(){
  const menu = document.getElementById('sheet-menu');
  const card = document.getElementById('sheet-menu-card');
  let html = '';
  if(isReferee()){
    html += '<div class="sheet-menu-label">View / edit a sheet</div>';
    html += KNOWN_CHARACTERS.map(n =>
      `<button class="sheet-menu-item" onclick="closeSheetMenu();openSheet('${n.replace(/'/g,"\\\\'")}')">${n}</button>`
    ).join('');
  } else {
    if(!myIdentity){
      html += '<div class="sheet-menu-label">Pick a character first</div>';
      html += '<button class="sheet-menu-item" onclick="closeSheetMenu();showIdentityModal()">Choose my character</button>';
    } else {
      html += `<button class="sheet-menu-item" onclick="closeSheetMenu();openSheet('${myIdentity.replace(/'/g,"\\\\'")}')">My Sheet (${myIdentity})</button>`;
      html += `<button class="sheet-menu-item" style="color:var(--tx1);font-size:10px" onclick="closeSheetMenu();changeIdentity()">Not ${myIdentity}? Switch character</button>`;
    }
  }
  card.innerHTML = html;
  menu.classList.remove('hidden');
}

function closeSheetMenu(){
  document.getElementById('sheet-menu').classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════
// A small, extensible menu off the gear icon in the header. Currently
// holds just the light/dark theme toggle, but built as a container so
// more device-level preferences can be added here later without needing
// a new menu. Theme choice is a personal device preference (like panel
// positions or the access code), not campaign state, so it's stored in
// localStorage only — never written to Supabase, and never shared
// between devices or between referee and players.
let lightModeOn = false;

// ── UI Scale ──────────────────────────────────────────────────────────────
// Scales the entire #root element via CSS font-size on <html>, which
// cascades through all rem-based sizing. Stored in localStorage so it
// persists across sessions on the same device.
const UI_SCALE_STEPS = [75, 85, 100, 115, 130, 150];
const UI_SCALE_DEFAULT = 100;

// Cached so the hot path (pointermove during drag, ~60Hz) doesn't hit
// localStorage on every call. Invalidated whenever the scale is changed.
let _uiScaleCache = null;
function getUIScale(){
  if(_uiScaleCache !== null) return _uiScaleCache;
  try {
    const v = parseInt(localStorage.getItem('aurelia_ui_scale'), 10);
    if(UI_SCALE_STEPS.includes(v)){ _uiScaleCache = v; return v; }
  } catch(e){}
  _uiScaleCache = UI_SCALE_DEFAULT;
  return UI_SCALE_DEFAULT;
}

function applyUIScale(pct){
  const scale = pct / 100;
  // Use transform:scale on #root with inverse-sized dimensions.
  // Setting width/height to (100/s)vw/(100/s)vh means the layout box
  // is logically larger than the viewport, but after scale(s) it renders
  // at exactly 100vw x 100vh — no clipping, no black space at any scale.
  //
  // The floating panels (event-log, init, health, quest, etc.) are now
  // children of #float-panels, which is a sibling of #root and NOT
  // inside the transform, so they always render at viewport scale.
  //
  // Pointer event compensation: e.clientX/Y are in screen (scaled) space;
  // CSS layout coords are in logical (pre-scale) space. Divide by scale
  // everywhere we convert pointer coords to layout coords.
  document.documentElement.style.zoom = '';
  const root = document.getElementById('root');
  if(!root) return;
  root.style.zoom = '';
  if(scale === 1){
    root.style.transform = '';
    root.style.width = '';
    root.style.height = '';
    root.style.transformOrigin = '';
  } else {
    root.style.transformOrigin = 'top left';
    root.style.transform = 'scale(' + scale + ')';
    root.style.width  = (100 / scale) + 'vw';
    root.style.height = (100 / scale) + 'vh';
  }
}

function onUIScaleInput(idx){
  // Live preview as thumb drags — update fill bar and value label without full re-render
  const pct = UI_SCALE_STEPS[parseInt(idx, 10)] || UI_SCALE_DEFAULT;
  _uiScaleCache = pct;  // keep cache in sync
  applyUIScale(pct);
  const fill = document.getElementById('ui-scale-fill');
  if(fill) fill.style.width = (parseInt(idx,10) / (UI_SCALE_STEPS.length-1) * 100) + '%';
  const valEl = document.querySelector('.ui-scale-value');
  if(valEl) valEl.textContent = pct + '%';
}

function onUIScaleCommit(idx){
  const pct = UI_SCALE_STEPS[parseInt(idx, 10)] || UI_SCALE_DEFAULT;
  _uiScaleCache = pct;  // keep cache in sync
  applyUIScale(pct);
  try { localStorage.setItem('aurelia_ui_scale', pct); } catch(e){}
  // Re-render the menu so step labels update their highlight
  const showArchon = isReferee();
  renderSettingsMenu(showArchon);
}

// Apply saved scale on load
applyUIScale(getUIScale());

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════════════════════
// Names-only search across station areas/subs, Aurelia locations, system
// bodies, and their NPCs/skill checks — not full description/event text,
// by design, to keep results short and fast to scan. Respects Design Mode
// overrides so a referee-renamed or newly-added NPC/check is searchable,
// and respects referee-vs-player visibility: players only ever see areas
// that are actually revealed to them, never referee-only NPCs/checks.
//
// Each result also has its own resolveContent() lookup for its name, since
// names themselves can be edited via Design Mode stage 1 just like any
// other text field — a renamed NPC should be findable by its NEW name.

function searchResolvedName(key, fallback){
  const ov = contentOverrides[key];
  if(ov === undefined) return fallback;
  // Some override types (checks) store an object with a .skill field
  // rather than a plain string — handle both shapes.
  if(typeof ov === 'string') return ov;
  if(ov && typeof ov === 'object' && ov.skill) return ov.skill;
  if(ov && typeof ov === 'object' && ov.name) return ov.name;
  return fallback;
}

function buildSearchIndex(){
  const idx = [];
  const ref = isReferee();

  // ── Station areas + subs ──
  Object.keys(MAIN).forEach(areaId => {
    const a = MAIN[areaId];
    if(!ref && !revealedAreas[areaId]) return; // players only see revealed areas
    idx.push({type:'Station Area', name:a.label, sub:a.sub||'', nav:{view:'station', areaId, subId:null}});
    if(a.npcs && ref){ // NPCs are referee-only content
      a.npcs.forEach((n,i) => {
        const nkey = 'sta-npc-'+areaId+i; // matches the nid pattern used at render time (no sub)
        idx.push({type:'NPC', name:n.name, sub:a.label, nav:{view:'station', areaId, subId:null}});
      });
    }
    if(a.checks && ref){
      const chkBaseKey = areaId+'-check-';
      a.checks.forEach((c,i) => {
        const name = searchResolvedName(chkBaseKey+i, c.skill);
        idx.push({type:'Skill Check', name, sub:a.label, nav:{view:'station', areaId, subId:null}});
      });
    }
    if(a.subs){
      Object.keys(a.subs).forEach(subId => {
        const s = a.subs[subId];
        idx.push({type:'Station Area', name:s.label, sub:a.label+' →', nav:{view:'station', areaId, subId}});
        if(s.npcs && ref){
          s.npcs.forEach(n => idx.push({type:'NPC', name:n.name, sub:s.label, nav:{view:'station', areaId, subId}}));
        }
        if(s.checks && ref){
          const chkBaseKey = areaId+'_'+subId+'-check-';
          s.checks.forEach((c,i) => {
            const name = searchResolvedName(chkBaseKey+i, c.skill);
            idx.push({type:'Skill Check', name, sub:s.label, nav:{view:'station', areaId, subId}});
          });
        }
      });
    }
  });

  // ── Locations on/around every body (generic — any world can own them) ──
  getBodies().forEach(b => {
    effectiveLocations(currentSystemId, b.id).forEach(loc => {
      idx.push({type:'Location', name:loc.name, sub:b.name, nav:{view:'body', bodyId:b.id, locId:loc.id}});
    });
  });

  // ── System bodies (includes moons like Pallor) ──
  getBodies().forEach(b => {
    idx.push({type:'System Body', name:b.name, sub:b.type||'', nav:{view:'system', bodyId:b.id}});
    if(b.npcs && ref){
      b.npcs.forEach((n,i) => {
        idx.push({type:'NPC', name:n.name, sub:b.name, nav:{view:'system', bodyId:b.id}});
      });
    }
    if(b.checks && ref){
      const chkBaseKey = b.id+'-check-'; // matches the body-detail check key pattern... approximate, name itself is what's searched
      b.checks.forEach((c,i) => {
        idx.push({type:'Skill Check', name:c.skill, sub:b.name, nav:{view:'system', bodyId:b.id}});
      });
    }
  });

  // ── Galaxy systems (Orion Arm starmap) — public to everyone, referee or
  // player, since the map itself is the app's landing view. Matchable by the
  // in-world label, the real star designation (alt), and the faction name. A
  // hit jumps to the galaxy view and selects that node's detail panel. ──
  GALAXY_NODES.forEach(sys => {
    const label = (sys.label || sys.name).replace(' ★','').trim();
    const f = GALAXY_FACTIONS[sys.faction] || {name:'Independent'};
    idx.push({
      type:'System', name:label, alt:sys.name, sub:sys.name + ' · ' + f.name,
      nav:{view:'galaxy', galaxyId:sys.id}
    });
  });

  return idx;
}

function navigateToSearchResult(nav){
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').classList.remove('open');
  // playViewTransition() (used by enterStation/goAurelia/goSystem) updates
  // currentView asynchronously, 175ms into its fade animation — not
  // synchronously on call. So we capture whether a view switch is needed
  // BEFORE triggering it, rather than re-checking currentView right after
  // calling the switch function, which would still read the OLD value at
  // that point and silently always take the "switching" branch's timing.
  const needsSwitch = currentView !== nav.view;
  if(nav.view === 'station'){
    if(needsSwitch) enterStation();
    setTimeout(() => {
      selArea(nav.areaId);
      if(nav.subId) setTimeout(() => selSub(nav.subId), 60);
    }, needsSwitch ? 220 : 0);
  } else if(nav.view === 'body'){
    // Locations now live in the generic body close-up. Switch to the body view
    // (with a transition if we're elsewhere), then open the location if given.
    if(currentView !== 'body'){
      goBodyView(nav.bodyId);
      if(nav.locId) setTimeout(() => selectBodyLocation(nav.locId), 220);
    } else {
      buildBodyView(nav.bodyId);
      if(nav.locId) selectBodyLocation(nav.locId);
    }
  } else if(nav.view === 'system'){
    if(needsSwitch) goSystem();
    setTimeout(() => selectBody(nav.bodyId), needsSwitch ? 220 : 0);
  } else if(nav.view === 'galaxy'){
    // Jump to the Orion Arm starmap and open the matched system's detail panel.
    if(needsSwitch) goGalaxy();
    setTimeout(() => { if(typeof HX!=='undefined'){ HX.ensure(); HX.selectById(nav.galaxyId); } }, needsSwitch ? 240 : 0);
  }
}

function renderSearchResults(){
  const q = document.getElementById('search-input').value.trim().toLowerCase();
  const box = document.getElementById('search-results');
  if(!q){ box.classList.remove('open'); box.innerHTML = ''; return; }

  const idx = buildSearchIndex();
  const matches = idx.filter(item =>
    item.name.toLowerCase().includes(q) ||
    (item.alt && item.alt.toLowerCase().includes(q))
  ).slice(0, 30);

  if(!matches.length){
    box.innerHTML = '<div class="search-empty">No matches.</div>';
    box.classList.add('open');
    return;
  }

  // Store the actual nav objects in an array rather than inlining them into
  // the onclick attribute string — sidesteps any quote-escaping risk if a
  // future area/sub id ever contains an apostrophe, and is simpler than
  // hand-escaping JSON for HTML attribute context.
  window._searchResultNavs = matches.map(m => m.nav);

  const groups = {};
  matches.forEach((m, i) => { (groups[m.type] = groups[m.type] || []).push({...m, idx:i}); });

  const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  let html = '';
  Object.keys(groups).forEach(type => {
    html += `<div class="search-group-lbl">${esc(type)}</div>`;
    html += groups[type].map(m =>
      `<button class="search-result-item" onclick="navigateToSearchResult(window._searchResultNavs[${m.idx}])">${esc(m.name)}<span class="search-result-sub">${esc(m.sub)}</span></button>`
    ).join('');
  });
  box.innerHTML = html;
  box.classList.add('open');
}

// Close search results when clicking outside the search box
document.addEventListener('click', function(e){
  const wrap = document.getElementById('search-wrap');
  if(wrap && !wrap.contains(e.target)){
    document.getElementById('search-results').classList.remove('open');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS MENU (expanded — Display + Archon Morality Tracker)
// ═══════════════════════════════════════════════════════════════════════════

// ── Archon Morality Tracker data ─────────────────────────────────────────
// Stored as 'archon-morality' in localStorage only — this is purely a
// referee tool, never synced to Supabase or shown to players.
// Each action entry: { id, action, axes:{coop,comp,wisd,inno}, total, ts }

const ARCHON_AXES = [
  { key:'coop', label:'Cooperation' },
  { key:'comp', label:'Compassion'  },
  { key:'wisd', label:'Wisdom'      },
  { key:'inno', label:'Innovation'  },
];

const ARCHON_BANDS = [
  { min:15,  max:Infinity, cls:'worthy',      label:'Worthy of Active Support',  desc:'May offer direct assistance, share data, or provide protection.' },
  { min:10,  max:14,       cls:'mercy',       label:'Worthy of Mercy',           desc:'Will not intervene against the party. Deemed salvageable.' },
  { min:5,   max:9,        cls:'promising',   label:'Promising',                  desc:'Observation continues with slight favor. Right trajectory.' },
  { min:0,   max:4,        cls:'inconclusive',label:'Inconclusive',              desc:'The Collective waits. No judgment rendered. The experiment continues.' },
  { min:-5,  max:-1,       cls:'concerning',  label:'Concerning',                 desc:'Patterns of failure detected. May subtly obstruct.' },
  { min:-10, max:-6,       cls:'alarming',    label:'Alarming',                   desc:'Active deterrence: disabling weapons, draining fuel, blocking jump routes.' },
  { min:-Infinity, max:-11,cls:'unworthy',    label:'Unworthy',                   desc:'Experiment declared a failure. The Collective intervenes directly.' },
];

// ── Generic meter engine (pack-driven) ─────────────────────────────────────
// The morality tracker is now one instance of a GENERAL meter defined by the
// active Campaign Pack (pkMeters()). Each meter carries its own axes, bands,
// colours, visibility and storage key, so a referee can rename it (e.g.
// "Light / Dark Side"), re-axis it, recolour it, run several at once, or remove
// it entirely — all as pack data. The built-in Archon meter behaves exactly as
// before (same axes/bands and the 'aurelia_archon' storage key). ARCHON_AXES /
// ARCHON_BANDS above remain the seed the default pack folds into meters[0].
let currentMeterId = null;        // which meter's entry form is active in the menu
let meterDrafts = {};             // { meterId: {axisKey: val} }
let meterLogs = {};               // { storageKey: [entries] }

function getMeters(){ return (typeof pkMeters === 'function') ? pkMeters() : []; }
function getCurrentMeter(){ const ms = getMeters(); return ms.find(m => m.id === currentMeterId) || ms[0] || null; }
function meterAxes(m){ return (m && m.axes) || []; }
function meterBandsNorm(m){
  return ((m && m.bands) || []).map(b => ({ ...b,
    min: (b.min == null ? -Infinity : b.min), max: (b.max == null ? Infinity : b.max) }));
}
function meterRange(m){ return (m && m.axisRange) || 5; }
function meterStoreKey(m){ return (m && m.storageKey) || ('meter-' + ((m && m.id) || 'x')); }
function meterColors(m){ return (m && m.colors) || { pos:'#4caf82', neg:'#d45050' }; }
function blankMeterDraft(m){ const d = {}; meterAxes(m).forEach(a => d[a.key] = 0); return d; }
function getMeterDraft(m){ if(!m) return {}; if(!meterDrafts[m.id]) meterDrafts[m.id] = blankMeterDraft(m); return meterDrafts[m.id]; }

// Per-meter log persistence (localStorage; the Archon meter keeps its old key).
function loadArchonLog(){
  meterLogs = {};
  getMeters().forEach(m => {
    try { const raw = localStorage.getItem(meterStoreKey(m)); meterLogs[meterStoreKey(m)] = raw ? JSON.parse(raw) : []; }
    catch(e){ meterLogs[meterStoreKey(m)] = []; }
  });
}
function meterLog(m){
  const k = meterStoreKey(m);
  if(!meterLogs[k]){ try { const raw = localStorage.getItem(k); meterLogs[k] = raw ? JSON.parse(raw) : []; } catch(e){ meterLogs[k] = []; } }
  return meterLogs[k];
}
function saveMeterLog(m){ try { localStorage.setItem(meterStoreKey(m), JSON.stringify(meterLog(m))); } catch(e){} }
// Kept for the boot call site; the per-meter saves happen inline now.
function saveArchonLog(){ const m = getCurrentMeter(); if(m) saveMeterLog(m); }

function archonAxisTotals(m){
  m = m || getCurrentMeter();
  const totals = {};
  meterAxes(m).forEach(a => totals[a.key] = 0);
  meterLog(m).forEach(e => { meterAxes(m).forEach(a => { totals[a.key] += (e.axes[a.key]||0); }); });
  return totals;
}

function archonGrandTotal(totals){
  return Object.values(totals).reduce((s,v) => s+v, 0);
}

function archonClassification(total, m){
  const bands = meterBandsNorm(m || getCurrentMeter());
  return bands.find(b => total >= b.min && total <= b.max) || bands[bands.length-1] || { cls:'', label:'', desc:'' };
}

function archonScoreLabel(n){
  if(n > 0) return `+${n}`;
  return `${n}`;
}

function archonAxisBarHTML(key, val, maxAbsTotal, colors){
  // Bar centred at 50% — left half is negative, right half is positive
  colors = colors || { pos:'#4caf82', neg:'#d45050' };
  const clamp = maxAbsTotal || 1;
  const pct = Math.min(Math.abs(val) / clamp * 50, 50);
  const isPos = val >= 0;
  const colour = val > 0 ? colors.pos : val < 0 ? colors.neg : 'transparent';
  const left = isPos ? '50%' : `${50 - pct}%`;
  const width = `${pct}%`;
  return `
    <div class="archon-axis-bar-wrap">
      <div style="position:absolute;top:0;left:50%;width:.5px;height:100%;background:var(--bd0)"></div>
      <div class="archon-axis-bar-fill" style="left:${left};width:${width};background:${colour}"></div>
    </div>`;
}

// ── Render ────────────────────────────────────────────────────────────────

function openSettingsMenu(){
  if(!isReferee()) {
    // Players only see the display section
    renderSettingsMenu(false);
  } else {
    renderSettingsMenu(true);
  }
  document.getElementById('settings-menu').classList.remove('hidden');
}

function renderSettingsMenu(showArchon){
  const card = document.getElementById('settings-menu-card');

  // ── Display section ──
  const scaleSteps = [75, 85, 100, 115, 130, 150];
  const curScale = getUIScale();
  const scaleIdx = scaleSteps.indexOf(curScale);
  const fillPct = scaleIdx < 0 ? 40 : (scaleIdx / (scaleSteps.length - 1)) * 100;
  let html = `
    <div class="settings-section-lbl">Display</div>
    <div class="settings-row">
      <span class="settings-row-label">${lightModeOn ? '☀ Light Mode' : '🌙 Dark Mode'}</span>
      <div class="theme-toggle" onclick="toggleLightMode()"><div class="theme-toggle-knob">${lightModeOn ? '☀' : '🌙'}</div></div>
    </div>
    <div class="ui-scale-row">
      <div class="ui-scale-labels">
        <span class="ui-scale-label">🔡 Text Size</span>
        <span class="ui-scale-value">${curScale}%</span>
      </div>
      <div class="ui-scale-track">
        <div class="ui-scale-fill" id="ui-scale-fill" style="width:${fillPct}%"></div>
        <input id="ui-scale-range" type="range" min="0" max="${scaleSteps.length - 1}"
          value="${scaleIdx < 0 ? 2 : scaleIdx}"
          oninput="onUIScaleInput(this.value)"
          onchange="onUIScaleCommit(this.value)">
      </div>
      <div class="ui-scale-steps">
        ${scaleSteps.map(s => `<span class="ui-scale-step"${s===curScale?' style="color:var(--accentGold);font-weight:700"':''}>${s}%</span>`).join('')}
      </div>
    </div>`;

  // Settings is configuration-only now: Display + keyboard shortcuts for
  // everyone. Referee tools (design mode), morality, and the animation /
  // orbital-ring toggles live in the Referee menu; campaign-editing tools
  // live in the Design menu. The showArchon arg is kept for back-compat.
  // ── Secure Content (per-player token) ──
  const tok = getContentToken();
  const roleLabel = !tok ? 'Local mode (no token)'
    : (secureRole ? (secureRole === 'referee' ? 'Referee' : (myIdentity || 'Player')) : 'connecting…');
  html += `
    <div class="settings-section-lbl">Secure Content</div>
    <div class="settings-row">
      <span class="settings-row-label">Acting as</span>
      <span style="color:var(--accentGold);font-weight:700">${escHtml(roleLabel)}</span>
    </div>
    <div class="settings-row">
      <input id="content-token-input" type="text" placeholder="Paste access token…" value="${escHtml(tok)}"
        style="flex:1;min-width:0;background:var(--bg2);border:1px solid var(--bd0);border-radius:var(--rad);color:var(--tx0);padding:7px 9px;font-family:monospace;font-size:12px">
    </div>
    <div class="settings-row" style="gap:8px">
      <button onclick="applyContentTokenFromInput()" style="flex:1;padding:8px;background:var(--accentGoldBg);border:1px solid var(--accentGold);color:var(--accentGold);border-radius:var(--rad);font-weight:700;font-size:12px;cursor:pointer">Apply token</button>
      <button onclick="clearContentToken()" style="flex:1;padding:8px;background:var(--bg2);border:1px solid var(--bd0);color:var(--tx0);border-radius:var(--rad);font-size:12px;cursor:pointer"${tok ? '' : ' disabled'}>Clear token</button>
    </div>
    <div class="settings-row">
      <button onclick="copyInviteLink()" style="flex:1;padding:8px;background:var(--bg2);border:1px solid var(--bd0);color:var(--tx0);border-radius:var(--rad);font-size:12px;cursor:pointer" title="Build a shareable link that applies the token in the box above">🔗 Copy invite link</button>
    </div>`;

  html += kbdSettingsHTML();
  card.innerHTML = html;
}

// Builds the Archon morality block (totals, axes, log, draft form). Extracted
// so the Referee menu renders the same widget that used to live in Settings.
function renderArchonSectionHTML(){
  // Pack-driven: renders whichever meter(s) the active Campaign Pack defines.
  if(typeof moduleOn === 'function' && !moduleOn('morality')) return '';
  const meters = getMeters();
  if(!meters.length){
    return `<div class="settings-section-lbl">Meters</div>
      <div class="archon-empty">No meters in this campaign. Add one in Design ▸ Campaign ▸ Campaign Settings ▸ Meters.</div>`;
  }
  const m      = getCurrentMeter();
  const colors = meterColors(m);
  const axes   = meterAxes(m);
  const totals = archonAxisTotals(m);
  const grand  = archonGrandTotal(totals);
  const band   = archonClassification(grand, m);
  const maxAbs = Math.max(...Object.values(totals).map(Math.abs), 1);
  const draft  = getMeterDraft(m);
  const log    = meterLog(m);

  const selector = meters.length > 1 ? `
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">
      ${meters.map(mm => `<button onclick="selectMeter('${mm.id}')" style="font-size:10px;font-family:monospace;padding:3px 8px;border-radius:4px;cursor:pointer;border:.5px solid var(--bd0);background:${mm.id===m.id?'var(--accentGoldBg)':'transparent'};color:${mm.id===m.id?'var(--accentGold)':'var(--tx1)'}">${escArchon(mm.label)}</button>`).join('')}
    </div>` : '';

  const axesHTML = axes.map(a => {
    const v = totals[a.key] || 0;
    const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero';
    return `
      <div class="archon-axis-row">
        <span class="archon-axis-name">${escArchon(a.label)}</span>
        ${archonAxisBarHTML(a.key, v, maxAbs, colors)}
        <span class="archon-axis-score ${cls}">${archonScoreLabel(v)}</span>
      </div>`;
  }).join('');

  const logHTML = log.length
    ? [...log].reverse().map(e => {
        const axisDesc = axes
          .filter(a => e.axes[a.key] !== 0 && e.axes[a.key] !== undefined)
          .map(a => `${a.label} (${archonScoreLabel(e.axes[a.key])})`)
          .join(', ');
        const scoreCls = e.total >= 0 ? 'pos' : 'neg';
        return `
          <div class="archon-log-entry">
            <div class="archon-log-top">
              <span class="archon-log-action">${escArchon(e.action)}</span>
              <span class="archon-log-score ${scoreCls}">${archonScoreLabel(e.total)}</span>
              <button class="archon-log-delete" onclick="deleteArchonEntry('${e.id}')" title="Remove">✕</button>
            </div>
            ${axisDesc ? `<div class="archon-log-axes">${escArchon(axisDesc)}</div>` : ''}
          </div>`;
      }).join('')
    : `<div class="archon-empty">No actions logged yet.</div>`;

  const steppers = axes.map(a => {
    const v = draft[a.key] || 0;
    const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero';
    return `
      <div class="archon-axis-input-row">
        <span class="archon-axis-input-lbl">${escArchon(a.label)}</span>
        <div class="archon-axis-stepper">
          <button onclick="archonStep('${a.key}',-1)">−</button>
          <span class="archon-axis-score ${cls}">${archonScoreLabel(v)}</span>
          <button onclick="archonStep('${a.key}',+1)">+</button>
        </div>
      </div>`;
  }).join('');

  const draftTotal = Object.values(draft).reduce((s,v)=>s+v,0);
  const draftCls = draftTotal > 0 ? 'pos' : draftTotal < 0 ? 'neg' : 'zero';

  return `
    <div class="settings-section-lbl">${escArchon(m.label)}</div>
    ${selector}
    <div class="archon-total-row">
      <span class="archon-total-score">${archonScoreLabel(grand)}</span>
      <span class="archon-classification archon-class-${band.cls}">
        ${band.label}<br>
        <span style="font-weight:400;font-size:8px;opacity:.8">${band.desc}</span>
      </span>
    </div>

    <div class="archon-axes">${axesHTML}</div>
    <div class="archon-divider"></div>

    <div class="archon-add-form">
      <textarea class="archon-add-action-input" id="archon-action-input"
        placeholder="Describe the action (e.g. Spared the scavenger ships)..."></textarea>
      <div class="archon-axis-inputs">${steppers}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:2px 0">
        <span style="font-size:10px;font-family:monospace;color:var(--tx1)">
          Entry total: <span class="archon-axis-score ${draftCls}">${archonScoreLabel(draftTotal)}</span>
        </span>
        <button onclick="archonResetDraft()" style="font-size:9px;font-family:monospace;background:transparent;border:.5px solid var(--bd0);border-radius:4px;padding:3px 8px;color:var(--tx1);cursor:pointer">Reset</button>
      </div>
      <button class="archon-submit-btn" onclick="submitArchonEntry()">Log Action</button>
    </div>

    <div class="archon-divider"></div>
    <div class="archon-log-section">${logHTML}</div>`;
}

function escArchon(s){
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Stepper ───────────────────────────────────────────────────────────────

function selectMeter(id){ currentMeterId = id; renderRefereeMenu(); }

function archonStep(key, delta){
  const m = getCurrentMeter(); if(!m) return;
  const draft = getMeterDraft(m);
  const rng = meterRange(m);
  draft[key] = Math.max(-rng, Math.min(rng, (draft[key]||0) + delta));
  // Partial update: only refresh the stepper spans and draft total —
  // avoids full card re-render which changes card height and loses textarea
  meterAxes(m).forEach(a => {
    const v = draft[a.key] || 0;
    const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero';
    const steppers = document.querySelectorAll('.archon-axis-stepper');
    steppers.forEach(s => {
      const lbl = s.closest('.archon-axis-input-row')?.querySelector('.archon-axis-input-lbl');
      if(lbl && lbl.textContent.trim() === a.label){
        const span = s.querySelector('span');
        if(span){
          span.textContent = archonScoreLabel(v);
          span.className = 'archon-axis-score ' + cls;
        }
      }
    });
  });
  const draftTotal = Object.values(draft).reduce((s,v)=>s+v,0);
  const draftCls = draftTotal > 0 ? 'pos' : draftTotal < 0 ? 'neg' : 'zero';
  const totalSpan = document.querySelector('.archon-add-form .archon-axis-score');
  if(totalSpan){
    totalSpan.textContent = archonScoreLabel(draftTotal);
    totalSpan.className = 'archon-axis-score ' + draftCls;
  }
}

function archonResetDraft(){
  const m = getCurrentMeter(); if(m) meterDrafts[m.id] = blankMeterDraft(m);
  renderRefereeMenu();
  // textarea is intentionally cleared on reset
}

// ── Submit / delete ───────────────────────────────────────────────────────

function submitArchonEntry(){
  const m = getCurrentMeter(); if(!m) return;
  const actionEl = document.getElementById('archon-action-input');
  const action = actionEl ? actionEl.value.trim() : '';
  if(!action){
    actionEl && (actionEl.style.borderColor = '#d45050');
    return;
  }
  const axes = { ...getMeterDraft(m) };
  const total = Object.values(axes).reduce((s,v)=>s+v,0);
  meterLog(m).push({ id:'a'+Date.now(), action, axes, total, ts: Date.now() });
  saveMeterLog(m);
  meterDrafts[m.id] = blankMeterDraft(m);
  renderRefereeMenu();
  showToast('Logged to ' + m.label);
}

function deleteArchonEntry(id){
  const m = getCurrentMeter(); if(!m) return;
  meterLogs[meterStoreKey(m)] = meterLog(m).filter(e => e.id !== id);
  saveMeterLog(m);
  renderRefereeMenu();
}

function closeSettingsMenu(){
  document.getElementById('settings-menu').classList.add('hidden');
}

// ── Referee menu (always available to referee) ────────────────────────────
// Houses the Design-Mode toggle, ambient-animation + orbital-ring toggles,
// and the Archon morality tracker — all moved out of Settings so Settings
// stays configuration-only.
function openRefereeMenu(){
  if(!isReferee()) return;
  renderRefereeMenu();
  document.getElementById('referee-menu').classList.remove('hidden');
}
function closeRefereeMenu(){
  document.getElementById('referee-menu').classList.add('hidden');
}
// Inline Design-Mode passcode state. We can't use prompt()/alert() — they're
// silently suppressed inside sandboxed preview iframes — so the passcode is
// entered through a field rendered inline in the Referee menu instead.
let designPasscodePrompt = false, designPasscodeError = false;

function renderRefereeMenu(){
  const card = document.getElementById('referee-menu-card');
  if(!card) return;
  const dmOn = designModeOn;
  const animOn = animationsOn();
  const ringsShown = ringsOn();
  const passField = (designPasscodePrompt && !dmOn) ? `
    <div class="settings-row" style="flex-direction:column;align-items:stretch;gap:6px;padding-top:0">
      <input id="design-pass-input" type="password" placeholder="Design Mode passcode" autocomplete="off"
        style="width:100%;font-size:12px;font-family:monospace;background:var(--bg0);color:var(--tx0);border:.5px solid ${designPasscodeError?'#d45050':'var(--bd0)'};border-radius:5px;padding:6px 9px;outline:none"
        onkeydown="if(event.key==='Enter'){event.preventDefault();submitDesignPasscode();}else if(event.key==='Escape'){cancelDesignPasscode();}">
      ${designPasscodeError ? '<span style="font-size:10px;color:#d45050;font-family:monospace">Incorrect passcode.</span>' : ''}
      <div style="display:flex;gap:6px;justify-content:flex-end">
        <button onclick="cancelDesignPasscode()" style="font-size:10px;font-family:monospace;background:transparent;border:.5px solid var(--bd0);border-radius:4px;padding:4px 10px;color:var(--tx1);cursor:pointer">Cancel</button>
        <button onclick="submitDesignPasscode()" style="font-size:10px;font-family:monospace;background:#9B59B6;border:none;border-radius:4px;padding:4px 10px;color:#fff;cursor:pointer">Unlock</button>
      </div>
    </div>` : '';
  card.innerHTML = `
    <div class="settings-section-lbl">${(typeof TERM==='function'?TERM('referee'):'Referee')} Tools</div>
    <div class="settings-row" style="cursor:pointer" onclick="toggleDesignMode()">
      <span class="settings-row-label" style="${dmOn ? 'color:#9B59B6;font-weight:700' : ''}">✏ Design Mode${dmOn ? ' — ON' : ''}</span>
      <div class="theme-toggle ${dmOn?'on':''}" style="${dmOn ? 'background:#2A1A3B;border-color:#9B59B6' : ''}"><div class="theme-toggle-knob" style="${dmOn ? 'transform:translateX(28px);background:#9B59B6' : ''}"></div></div>
    </div>
    ${passField}
    <div class="settings-row" role="switch" tabindex="0" aria-checked="${animOn}" style="cursor:pointer" onclick="toggleAnim()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleAnim();}">
      <span class="settings-row-label">✨ Animations${animOn ? '' : ' — off'}</span>
      <div class="theme-toggle ${animOn?'on':''}"><div class="theme-toggle-knob"></div></div>
    </div>
    <div class="settings-row" role="switch" tabindex="0" aria-checked="${ringsShown}" style="cursor:pointer" onclick="toggleRings()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleRings();}">
      <span class="settings-row-label">🪐 Orbital Rings${ringsShown ? '' : ' — hidden'}</span>
      <div class="theme-toggle ${ringsShown?'on':''}"><div class="theme-toggle-knob"></div></div>
    </div>
    <div class="archon-divider"></div>
    <div class="settings-section-lbl">Campaign Backup</div>
    <div class="settings-row" style="cursor:pointer" onclick="closeRefereeMenu();exportCampaign()">
      <span class="settings-row-label">⬇ Export Campaign</span>
      <span style="font-size:9px;color:var(--tx1);font-family:monospace">JSON →</span>
    </div>
    <div class="settings-row" style="cursor:pointer" onclick="closeRefereeMenu();importCampaign()">
      <span class="settings-row-label">⬆ Import Campaign</span>
      <span style="font-size:9px;color:var(--tx1);font-family:monospace">← JSON</span>
    </div>
    <div class="archon-divider"></div>
    ${renderArchonSectionHTML()}`;
}

// ── Design menu (shown only while Design Mode is ON) ───────────────────────
// Campaign-editing tools: removed items, full reset, and the dynamic
// referee-box manager.
function openDesignMenu(){
  if(!isReferee() || !designModeOn) return;
  renderDesignMenu();
  document.getElementById('design-menu').classList.remove('hidden');
}
function closeDesignMenu(){
  document.getElementById('design-menu').classList.add('hidden');
}
function renderDesignMenu(){
  const card = document.getElementById('design-menu-card');
  if(!card) return;
  const undoN = designUndoStack.length, redoN = designRedoStack.length;
  const lastUndo = undoN ? designUndoStack[undoN-1].label : '';
  const lastRedo = redoN ? designRedoStack[redoN-1].label : '';
  const campTitle = (typeof _activePack !== 'undefined' && _activePack) ? _activePack.title : 'Archon Gambit';
  card.innerHTML = `
    <div class="settings-section-lbl">Campaign</div>
    <div class="settings-row" style="cursor:pointer" onclick="closeDesignMenu();openCampaignStudio('campaigns')">
      <span class="settings-row-label">🌐 Campaign Studio</span>
      <span style="font-size:9px;color:var(--accentGold);font-family:monospace">${escHtml(campTitle)} →</span>
    </div>
    <div class="archon-divider"></div>
    <div class="settings-section-lbl">Design Tools</div>
    <div class="settings-row" style="cursor:${undoN?'pointer':'default'};opacity:${undoN?1:0.45}" ${undoN?'onclick="designUndo()"':''}>
      <span class="settings-row-label">↶ Undo${undoN?' — '+escHtml(lastUndo):''}</span>
      <span style="font-size:9px;color:var(--tx1);font-family:monospace">${undoN}/${DESIGN_UNDO_LIMIT}</span>
    </div>
    <div class="settings-row" style="cursor:${redoN?'pointer':'default'};opacity:${redoN?1:0.45}" ${redoN?'onclick="designRedo()"':''}>
      <span class="settings-row-label">↷ Redo${redoN?' — '+escHtml(lastRedo):''}</span>
      <span style="font-size:9px;color:var(--tx1);font-family:monospace">${redoN}</span>
    </div>
    <div class="archon-divider"></div>
    <div class="settings-row" style="cursor:pointer" onclick="closeDesignMenu();openCatalogue(null)">
      <span class="settings-row-label">🎒 Item Catalogue</span>
      <span style="font-size:9px;color:var(--tx1);font-family:monospace">→</span>
    </div>
    <div class="settings-row" style="cursor:pointer" onclick="closeDesignMenu();openSplashEditor()">
      <span class="settings-row-label">🌠 Splash Screens</span>
      <span style="font-size:9px;color:var(--tx1);font-family:monospace">→</span>
    </div>
    <div class="settings-row" style="cursor:pointer" onclick="closeDesignMenu();openRemovedItemsPanel()">
      <span class="settings-row-label">🗑 Show Removed Items</span>
      <span style="font-size:9px;color:var(--tx1);font-family:monospace">→</span>
    </div>
    <div class="settings-row" style="cursor:pointer" onclick="closeDesignMenu();resetCampaign()">
      <span class="settings-row-label" style="color:#d45050">⟲ Reset Campaign</span>
      <span style="font-size:9px;color:#d45050;font-family:monospace">→</span>
    </div>
    <div class="archon-divider"></div>
    <div class="settings-section-lbl">${(typeof TERM==='function'?TERM('referee'):'Referee')} Boxes</div>
    ${renderBoxManagerHTML()}`;
}

// Re-render whichever menus are open (after a state change that affects them).
function refreshOpenMenus(){
  if(!document.getElementById('settings-menu').classList.contains('hidden')) renderSettingsMenu(isReferee());
  if(!document.getElementById('referee-menu').classList.contains('hidden')) renderRefereeMenu();
  if(!document.getElementById('design-menu').classList.contains('hidden')) renderDesignMenu();
}

// ── Bounded undo / redo for Design Mode ─────────────────────────────────────
// Design edits/deletes (bodies, locations, economy profiles) mutate in-memory
// state that's mirrored to Supabase. Rather than invert each op, we SNAPSHOT the
// whole design state before a change and restore it on undo (redo re-applies the
// later state). Bounded to DESIGN_UNDO_LIMIT steps and in-memory only (not persisted).
const DESIGN_UNDO_LIMIT = 20;
let designUndoStack = [], designRedoStack = [];
function snapshotDesign(){
  const clone = o => JSON.parse(JSON.stringify(o||{}));
  return {
    bodyAdditions: clone(bodyAdditions), bodyDeletions: clone(bodyDeletions), bodyPropertyOverrides: clone(bodyPropertyOverrides),
    locationAdditions: clone(locationAdditions), locationDeletions: clone(locationDeletions), locationPropertyOverrides: clone(locationPropertyOverrides),
    econProfiles: (typeof ECON!=='undefined' && ECON.exportProfiles) ? ECON.exportProfiles() : null,
  };
}
async function restoreDesign(snap){
  bodyAdditions = snap.bodyAdditions; bodyDeletions = snap.bodyDeletions; bodyPropertyOverrides = snap.bodyPropertyOverrides;
  locationAdditions = snap.locationAdditions; locationDeletions = snap.locationDeletions; locationPropertyOverrides = snap.locationPropertyOverrides;
  await saveBodyAdditions(); await saveBodyDeletions(); await saveBodyPropertyOverrides();
  await saveLocationAdditions(); await saveLocationDeletions(); await saveLocationPropertyOverrides();
  if(snap.econProfiles!=null && typeof ECON!=='undefined' && ECON.importProfiles) ECON.importProfiles(snap.econProfiles);
  // Re-render whatever view is on screen so the restored state shows immediately.
  if(currentView === 'system'){ buildOrrery(); if(selectedBody && getBodies().find(b=>b.id===selectedBody)) selectBody(selectedBody); else goSystemOverview(); }
  else if(currentView === 'body' && selectedBody){ if(getBodies().find(b=>b.id===selectedBody)) buildBodyView(selectedBody); else goSystem(); }
  else if(currentView === 'galaxy' && typeof HX!=='undefined') HX.refresh();
  if(typeof econPanelOpen!=='undefined' && econPanelOpen && typeof renderEconPanel==='function') renderEconPanel();
  refreshOpenMenus();
}
// Call BEFORE a design mutation, capturing the pre-change state under a label.
function recordDesignUndo(label){
  designUndoStack.push({ label: label || 'change', snap: snapshotDesign() });
  if(designUndoStack.length > DESIGN_UNDO_LIMIT) designUndoStack.shift();
  designRedoStack = [];                 // a fresh edit invalidates the redo branch
  refreshOpenMenus();
}
async function designUndo(){
  if(!isReferee()) return;
  if(!designUndoStack.length){ if(typeof showToast==='function') showToast('Nothing to undo','info'); return; }
  const entry = designUndoStack.pop();
  designRedoStack.push({ label: entry.label, snap: snapshotDesign() });
  if(designRedoStack.length > DESIGN_UNDO_LIMIT) designRedoStack.shift();
  await restoreDesign(entry.snap);
  if(typeof showToast==='function') showToast('Undid: ' + entry.label);
}
async function designRedo(){
  if(!isReferee()) return;
  if(!designRedoStack.length){ if(typeof showToast==='function') showToast('Nothing to redo','info'); return; }
  const entry = designRedoStack.pop();
  designUndoStack.push({ label: entry.label, snap: snapshotDesign() });
  if(designUndoStack.length > DESIGN_UNDO_LIMIT) designUndoStack.shift();
  await restoreDesign(entry.snap);
  if(typeof showToast==='function') showToast('Redid: ' + entry.label);
}

// ── Campaign export / import (referee-only backup & sharing) ─────────────────
// The whole campaign is just key/value rows in the shared Supabase table, so a
// backup is a JSON dump of those rows. Export pulls every campaign row (skipping
// per-device private notes + local cache keys); import writes them back through
// supaStorage.set and reloads so every loader re-reads the restored state.
const CAMPAIGN_EXPORT_VERSION = 2;

// Campaign-local state that lives in localStorage (not the shared KV store) and
// so would otherwise NOT travel with an export: the referee box-type registry
// and every meter's logged history. Bundled into the export and restored on
// import so a shared campaign carries its meters and boxes too.
function collectCampaignLocalState(){
  const out = { boxTypes:null, meterLogs:{} };
  try { out.boxTypes = JSON.parse(localStorage.getItem('aurelia_box_types') || 'null'); } catch(e){}
  try {
    (typeof getMeters === 'function' ? getMeters() : []).forEach(m => {
      const k = meterStoreKey(m); const raw = localStorage.getItem(k); if(raw) out.meterLogs[k] = raw;
    });
  } catch(e){}
  return out;
}
function restoreCampaignLocalState(ls){
  if(!ls) return;
  try { if(ls.boxTypes) localStorage.setItem('aurelia_box_types', JSON.stringify(ls.boxTypes)); } catch(e){}
  try { if(ls.meterLogs) Object.keys(ls.meterLogs).forEach(k => localStorage.setItem(k, ls.meterLogs[k])); } catch(e){}
}
async function exportCampaign(){
  if(!isReferee()){ if(typeof showToast==='function') showToast('Referee only','error'); return; }
  if(typeof showToast==='function') showToast('Exporting campaign…','info');
  let rows;
  try {
    const res = await fetch(`${SUPABASE_REST}?select=key,value&limit=10000`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
    });
    if(!res.ok) throw new Error('HTTP '+res.status);
    rows = await res.json();
  } catch(e){
    if(typeof showToast==='function') showToast('Export failed — could not reach the campaign store ('+(e.message||'offline')+')','error');
    return;
  }
  // Only export the ACTIVE campaign's rows. The built-in campaign is un-prefixed
  // (skip any camp:* rows belonging to other campaigns); authored campaigns keep
  // only their camp:<id>: rows, prefix-stripped so the file is campaign-portable.
  const prefix = (typeof campaignKeyPrefix === 'function') ? campaignKeyPrefix() : '';
  const keys = {};
  (Array.isArray(rows)?rows:[]).forEach(r => {
    if(!r || r.key==null) return;
    let k = r.key;
    if(prefix){ if(k.indexOf(prefix) !== 0) return; k = k.slice(prefix.length); }
    else if(k.indexOf('camp:') === 0) return;
    if(/^note-private-/.test(k)) return;           // per-device personal notes — not shared campaign state
    keys[k] = r.value;
  });
  const blob = { app:'archon-gambit', kind:'campaign', version:CAMPAIGN_EXPORT_VERSION,
    exportedAt:new Date().toISOString(),
    campaignId: (typeof activeCampaignId !== 'undefined' ? activeCampaignId : 'archon-gambit'),
    pack: (typeof exportPackObject === 'function' ? exportPackObject() : null),
    localState: collectCampaignLocalState(),
    count:Object.keys(keys).length, keys };
  const json = JSON.stringify(blob, null, 2);
  const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], {type:'application/json'}));
  a.download = `archon-gambit-campaign-${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>{ try{ URL.revokeObjectURL(a.href); }catch(e){} }, 4000);
  if(typeof showToast==='function') showToast(`Exported ${blob.count} campaign key${blob.count===1?'':'s'}`);
}
function importCampaign(){
  if(!isReferee()){ if(typeof showToast==='function') showToast('Referee only','error'); return; }
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files && input.files[0]; if(!file) return;
    let blob;
    try { blob = JSON.parse(await file.text()); }
    catch(e){ if(typeof showToast==='function') showToast('Import failed — not valid JSON','error'); return; }
    const keys = blob && blob.keys;
    if(!keys || typeof keys!=='object' || Array.isArray(keys)){
      if(typeof showToast==='function') showToast('Import failed — no campaign keys in this file','error'); return; }
    const names = Object.keys(keys);
    if(!names.length){ if(typeof showToast==='function') showToast('Import failed — file has no keys','error'); return; }
    if(!confirm(`Import ${names.length} campaign key${names.length===1?'':'s'} from "${file.name}"?\n\nThis OVERWRITES the current shared campaign — galaxy edits, codex, funds, economy, ship state, quests, and more. It cannot be undone. Continue?`)) return;
    if(typeof showToast==='function') showToast('Importing campaign…','info');
    let ok=0, fail=0;
    for(const k of names){
      const v = keys[k];
      const r = await supaStorage.set(k, v==null?'':String(v), true);   // set() namespaces to the active campaign
      if(r && r.ok) ok++; else fail++;
    }
    // Restore the bundled pack config + campaign-local state (meters / boxes).
    if(blob.pack && typeof validateAndMigratePack === 'function'){
      const res = validateAndMigratePack(blob.pack);
      if(res.ok && typeof _activePack !== 'undefined' && _activePack){
        _activePack.config = res.pack.config;
        if(typeof saveActivePackConfig === 'function') saveActivePackConfig();
      }
    }
    if(blob.localState) restoreCampaignLocalState(blob.localState);
    if(typeof showToast==='function') showToast(`Imported ${ok} key${ok===1?'':'s'}${fail?` (${fail} queued offline)`:''} — reloading…`);
    setTimeout(()=>location.reload(), 900);
  };
  input.click();
}

// ── Ambient-animation + orbital-ring toggles ──────────────────────────────
// Implemented as classes on #root so they apply to every existing AND future
// element via CSS selectors (no per-node bookkeeping). Persisted per device.
function animationsOn(){ return !rootEl.classList.contains('anim-off'); }
function ringsOn(){ return !rootEl.classList.contains('rings-off'); }
function toggleAnim(){
  const turnOff = animationsOn();
  rootEl.classList.toggle('anim-off', turnOff);
  try{ localStorage.setItem('aurelia_anim_off', turnOff ? '1' : '0'); }catch(e){}
  renderRefereeMenu();
}
function toggleRings(){
  const turnOff = ringsOn();
  rootEl.classList.toggle('rings-off', turnOff);
  try{ localStorage.setItem('aurelia_rings_off', turnOff ? '1' : '0'); }catch(e){}
  renderRefereeMenu();
}
function applyRefereePrefs(){
  try{
    if(localStorage.getItem('aurelia_anim_off') === '1') rootEl.classList.add('anim-off');
    if(localStorage.getItem('aurelia_rings_off') === '1') rootEl.classList.add('rings-off');
  }catch(e){}
}
applyRefereePrefs();

// ── Dynamic referee-box registry (Task 4) ─────────────────────────────────
// A box "type" (Read Aloud, Referee Note, or any custom box) renders across
// every celestial body and station area. Built-ins keep their original
// content keys (body-<id>-readAloud / -refNote) for back-compat; custom boxes
// store per-object content under body-<id>-box-<key> via the same
// resolveContent/contentOverrides layer. Removed types are kept (restorable)
// and their content is preserved.
const BOX_TYPES_LS = 'aurelia_box_types';
const DEFAULT_BOX_TYPES = [
  { key:'readAloud', label:'Read Aloud',   cls:'read', refOnly:false, builtin:true },
  { key:'refNote',   label:'Referee Note', cls:'ref',  refOnly:true,  builtin:true }
];
let boxTypesStore = null;
function loadBoxTypes(){
  if(boxTypesStore) return boxTypesStore;
  let stored = null;
  try{ stored = JSON.parse(localStorage.getItem(BOX_TYPES_LS) || 'null'); }catch(e){}
  if(stored && Array.isArray(stored.active) && Array.isArray(stored.removed)){
    boxTypesStore = stored;
  } else {
    boxTypesStore = { active: DEFAULT_BOX_TYPES.map(b => ({...b})), removed: [] };
  }
  return boxTypesStore;
}
function saveBoxTypes(){
  try{ localStorage.setItem(BOX_TYPES_LS, JSON.stringify(boxTypesStore)); }catch(e){}
}
function getBoxTypes(){ return loadBoxTypes().active; }
function getRemovedBoxTypes(){ return loadBoxTypes().removed; }
function slugifyBox(label){
  const base = (label||'box').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'box';
  const st = loadBoxTypes();
  const taken = k => st.active.some(b=>b.key===k) || st.removed.some(b=>b.key===k) || k==='readAloud' || k==='refNote';
  let s = base, n = 2;
  while(taken(s)){ s = base + '-' + n; n++; }
  return s;
}
function addBoxType(){
  const label = (prompt('New box name (e.g. "Tactics", "Lore", "Hooks"):', 'Custom Box') || '').trim();
  if(!label) return;
  const refOnly = !confirm('Should players see this box?\n\nOK = visible to players.\nCancel = referee-only.');
  const st = loadBoxTypes();
  st.active.push({ key: slugifyBox(label), label, cls: refOnly ? 'ref' : 'read', refOnly, builtin:false });
  saveBoxTypes();
  renderDesignMenu();
  rerenderCurrentDetail();
}
function renameBoxType(key, val){
  const b = getBoxTypes().find(x => x.key === key);
  if(!b) return;
  b.label = (val||'').trim() || b.label;
  saveBoxTypes();
  rerenderCurrentDetail();
}
function deleteBoxType(key){
  const st = loadBoxTypes();
  const idx = st.active.findIndex(b => b.key === key);
  if(idx < 0) return;
  if(!confirm('Remove this box from every location? You can restore it later from Removed Items — saved content is kept.')) return;
  const [removed] = st.active.splice(idx, 1);
  removed._removedAt = Date.now();
  st.removed.push(removed);
  saveBoxTypes();
  renderDesignMenu();
  rerenderCurrentDetail();
}
function restoreBoxType(key){
  const st = loadBoxTypes();
  const idx = st.removed.findIndex(b => b.key === key);
  if(idx < 0) return;
  const [b] = st.removed.splice(idx, 1);
  delete b._removedAt;
  st.active.push(b);
  saveBoxTypes();
  if(!document.getElementById('design-menu').classList.contains('hidden')) renderDesignMenu();
  // If the user restored from the Removed Items panel, refresh it in place.
  const dep = document.getElementById('design-edit-panel');
  if(dep && !dep.classList.contains('hidden') && document.getElementById('design-edit-title').textContent === 'REMOVED ITEMS'){
    openRemovedItemsPanel();
  }
  rerenderCurrentDetail();
}
function rerenderCurrentDetail(){
  if(currentView === 'station' && cur) renderDetail();
  if(currentView === 'system' && selectedBody) selectBody(selectedBody);
  if(currentView === 'body' && selectedBody){ if(selectedBodyLoc) selectBodyLocation(selectedBodyLoc); else buildBodyView(selectedBody); }
}
function renderBoxManagerHTML(){
  const st = loadBoxTypes();
  const rows = st.active.map(b => `
    <div class="boxmgr-row">
      <input class="boxmgr-name" value="${(b.label||'').replace(/"/g,'&quot;')}" onchange="renameBoxType('${b.key}',this.value)">
      <span class="boxmgr-vis">${b.refOnly ? 'ref-only' : 'players'}</span>
      <button class="boxmgr-del" onclick="deleteBoxType('${b.key}')" title="Remove box type">🗑</button>
    </div>`).join('');
  const removed = st.removed.length ? `
    <div style="font-size:9px;color:var(--tx1);margin:10px 0 2px;font-family:monospace;letter-spacing:1px">REMOVED — TAP TO RESTORE</div>
    ${st.removed.map(b => `<div class="boxmgr-row"><span style="flex:1;font-size:11px;color:var(--tx1)">${b.label||''}</span><button class="boxmgr-del" style="color:#4CAF50;border-color:#4CAF50" onclick="restoreBoxType('${b.key}')" title="Restore">↺</button></div>`).join('')}` : '';
  return `
    <div style="font-size:10px;color:var(--tx1);margin-bottom:6px;line-height:1.5">Boxes appear on every planet, moon, and station area. Rename inline; remove to hide everywhere (saved text is preserved).</div>
    ${rows}
    <button class="design-add-btn" style="width:100%;margin-top:8px" onclick="addBoxType()">+ Add Box Type</button>
    ${removed}`;
}

// Renders the registry's box types for one object. `keyFor(box)` maps a box to
// its content-override key; `builtinValue(boxKey)` returns the object's
// hardcoded value for built-in boxes. When onlyCustom is true the built-in
// Read Aloud / Referee Note are skipped (station + Aurelia panels render those
// in their own bespoke layout and only want the custom boxes appended). In
// design mode empty boxes still render (with a placeholder) so the referee can
// fill them in; in play mode empty boxes are hidden.
function renderBoxTypesHTML(keyFor, builtinValue, pm, onlyCustom){
  let html = '';
  getBoxTypes().forEach(bt => {
    if(onlyCustom && bt.builtin) return;
    if(bt.refOnly && pm) return; // ref-only boxes are hidden from players
    const key = keyFor(bt);
    const original = bt.builtin ? ((builtinValue ? builtinValue(bt.key) : '') || '') : '';
    designOriginalRegistry[key] = original;
    const text = resolveContent(key, original);
    const hasContent = (text || '').trim() !== '';
    if(!hasContent && !designModeOn) return;
    const cls = bt.cls === 'ref' ? 's-blk ref ref-only' : 's-blk read';
    const disp = hasContent
      ? (text || '').replace(/\n/g, '<br>')
      : '<span style="opacity:.45;font-style:italic">(empty — tap ✎ to add)</span>';
    html += `<div class="${cls}"><div class="s-blk-lbl">${escHtml(bt.label)}</div>${designWrap(key, original, disp)}</div>`;
  });
  return html;
}

function toggleLightMode(){
  lightModeOn = !lightModeOn;
  rootEl.classList.toggle('light-mode', lightModeOn);
  document.body.classList.toggle('light-mode-body', lightModeOn);
  const fp = document.getElementById('float-panels');
  if(fp) fp.classList.toggle('light-mode', lightModeOn);
  try {
    if(lightModeOn) localStorage.setItem('aurelia_theme', 'light');
    else localStorage.removeItem('aurelia_theme');
  } catch(e){}
  openSettingsMenu(); // re-render so the toggle's label/icon updates immediately
}

try {
  if(localStorage.getItem('aurelia_theme') === 'light'){
    lightModeOn = true;
    rootEl.classList.add('light-mode');
    document.body.classList.add('light-mode-body');
    const fp = document.getElementById('float-panels');
    if(fp) fp.classList.add('light-mode');
  }
} catch(e){}

// ── Sheet modal ──────────────────────────────────────────────────────────
async function openSheet(characterName){
  sheetCurrentCharacter = characterName;
  const modal = document.getElementById('sheet-modal');
  const title = document.getElementById('sheet-card-title');
  const notice = document.getElementById('sheet-readonly-notice');
  title.textContent = characterName.toUpperCase();
  notice.textContent = isReferee() ? 'Referee view — editable' : '';
  document.getElementById('sheet-card-body').innerHTML = '<div class="init-empty">Loading…</div>';
  modal.classList.remove('hidden');

  const data = await loadSheet(characterName);
  sheetStatus = Array.isArray(data.status) ? data.status.slice() : [];
  await loadInventory();
  await loadEncSettings();
  await loadContainers();
  migrateSheetGear(characterName, data);   // one-time free-text → structured items (safe: raw text preserved)
  sheetCurrentData = data;
  renderSheetForm(data);
  renderSheetFundsAside(characterName);
  renderSheetStatusAside();
}

function closeSheet(){
  document.getElementById('sheet-modal').classList.add('hidden');
  if(typeof closeInvItemModal === 'function') closeInvItemModal();  // don't orphan child modals over a closed sheet
  if(typeof closeCatalogue === 'function') closeCatalogue();
  sheetCurrentCharacter = null;
  sheetCurrentData = null;
}

// ── Funds box (left aside) — reads the live funds system (85-records.js) ──
function renderSheetFundsAside(characterName){
  const el = document.getElementById('sheet-funds-body'); if(!el) return;
  const fmt = (typeof fmtCr === 'function') ? fmtCr : (n => 'Cr' + (n||0));
  const party = (typeof funds !== 'undefined' && funds) ? (Number(funds.party)||0) : 0;
  const purse = (typeof purseOf === 'function') ? purseOf(characterName) : 0;
  el.innerHTML = `
    <div class="csheet-fund"><div class="lbl">${escHtml(characterName)} · purse</div><div class="val">${fmt(purse)}</div></div>
    <div class="csheet-fund party"><div class="lbl">Party fund · shared</div><div class="val">${fmt(party)}</div></div>
    <button class="csheet-fund-link" onclick="closeSheet(); if(typeof toggleFundsPanel==='function' && !fundsPanelOpen) toggleFundsPanel();">Open funds ledger →</button>`;
}

// ── Status effects (right aside) — toggleable Traveller 2e conditions ──
function renderSheetStatusAside(){
  const el = document.getElementById('sheet-status-body'); if(!el) return;
  const active = new Set(sheetStatus);
  const statusFx = (typeof pkStatusFx === 'function') ? pkStatusFx() : TRAVELLER_STATUS_FX;
  const chips = statusFx.map(fx => {
    const on = active.has(fx.id);
    return `<button class="status-fx-chip${on?' on':''}${fx.harm?' harm':''}" onclick="toggleSheetStatus('${fx.id}')" title="${escHtml(fx.desc)}">
        <span class="ico">${fx.ico}</span>
        <span class="txt"><span class="nm">${escHtml(fx.name)}</span><span class="ds">${escHtml(fx.desc)}</span></span>
      </button>`;
  }).join('');
  const activeCount = sheetStatus.length;
  el.innerHTML = `<div class="status-fx">${chips}</div>
    <div class="status-fx-note">${activeCount ? activeCount + ' effect' + (activeCount>1?'s':'') + ' active. Tap to clear.' : 'No conditions applied. Tap one to apply it.'}</div>`;
}

function toggleSheetStatus(id){
  if(!sheetCurrentCharacter) return;
  const i = sheetStatus.indexOf(id);
  if(i >= 0) sheetStatus.splice(i, 1); else sheetStatus.push(id);
  renderSheetStatusAside();
  // Persist immediately alongside the current form values so a status change
  // never depends on the player also clicking Save.
  saveSheet(sheetCurrentCharacter, collectSheetData());
}

function renderSheetForm(data){
  const body = document.getElementById('sheet-card-body');
  const chars = sheetAttrKeys().map(a => [a.label, a.key]);
  body.innerHTML = `
    ${renderPortrait(sheetCurrentCharacter, data)}
    <div class="sheet-name-row">
      <input type="text" class="sheet-name-input" id="sheet-f-name" placeholder="Character name" value="${(data.name||'').replace(/"/g,'&quot;')}">
      <input type="text" class="sheet-name-input" id="sheet-f-age" placeholder="Age" style="flex:0 0 80px" value="${(data.age||'').replace(/"/g,'&quot;')}">
    </div>
    <div class="sheet-section">
      <div class="sheet-section-lbl">Characteristics</div>
      <div class="sheet-char-grid">
        ${chars.map(([label,key]) => { const v = (data[key]!=null?data[key]:7); return `
          <div class="sheet-char-box">
            <div class="sheet-char-label">${label}</div>
            <input type="number" class="sheet-char-input" id="sheet-f-${key}" value="${v}" oninput="updateSheetDM('${key}')">
            <div class="sheet-char-dm" id="sheet-dm-${key}">DM ${charDM(v)>=0?'+':''}${charDM(v)}</div>
          </div>
        `; }).join('')}
      </div>
    </div>
    <div class="sheet-section">
      <div class="sheet-section-lbl">Skills</div>
      <textarea class="sheet-textarea" id="sheet-f-skills" placeholder="e.g. Pilot (Spacecraft) 2, Gun Combat (Slug) 1, Streetwise 1...">${data.skills||''}</textarea>
    </div>
    ${renderInventorySection(sheetCurrentCharacter)}
    <div class="sheet-section">
      <div class="sheet-section-lbl">Notes</div>
      <textarea class="sheet-textarea" id="sheet-f-notes" placeholder="Anything else worth tracking...">${data.notes||''}</textarea>
    </div>
  `;
}

function updateSheetDM(key){
  const input = document.getElementById('sheet-f-' + key);
  const dmEl = document.getElementById('sheet-dm-' + key);
  if(!input || !dmEl) return;
  const dm = charDM(input.value);
  dmEl.textContent = `DM ${dm>=0?'+':''}${dm}`;
  if(key === 'str' || key === 'end') updateEncIndicator();  // live encumbrance as STR/END are edited
}

// Merge the current form inputs over the loaded blob, preserving any fields with
// no input (legacy gear text, invMigrated flag, portraitVer, status). Attributes
// come from the active Campaign Pack (sheetAttrKeys) so a custom pack's
// characteristics save too. Shared by the Save button, the status-effect toggles
// and the portrait upload so none clobbers the others' changes.
function collectSheetData(){
  const data = Object.assign({}, sheetCurrentData || {});
  const g = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
  if(document.getElementById('sheet-f-name') != null){
    data.name = g('sheet-f-name'); data.age = g('sheet-f-age');
    sheetAttrKeys().forEach(a => { data[a.key] = parseInt(g('sheet-f-' + a.key)) || 0; });
    data.skills = g('sheet-f-skills'); data.notes = g('sheet-f-notes');
  }
  data.status = sheetStatus.slice();
  return data;
}
async function saveCurrentSheet(){
  if(!sheetCurrentCharacter) return;
  const data = collectSheetData();
  sheetCurrentData = data;
  await saveSheet(sheetCurrentCharacter, data);
  const msg = document.getElementById('sheet-save-msg');
  msg.style.display = 'inline';
  setTimeout(() => { msg.style.display = 'none'; }, 1500);
}

// ═══════════════════════════════════════════════════════════════════════════
// INVENTORY  (Phase 1 — read-only structured render + safe free-text migration)
// ───────────────────────────────────────────────────────────────────────────
// Per-character gear, stored exactly like the character sheet: one shared JSON
// blob in aurelia_state under key 'inventory', keyed by character (funds-style)
// so the referee sees all five in one fetch and can edit any, while players
// see/edit only their own — honour system, client-side gated, the same model
// as sheet-${name} and funds. No new table, no RLS (see docs/inventory-phase-0-
// audit.md §1.2/§3). Phase 1 is READ-ONLY: it renders items and performs a
// one-time migration of the old free-text Weapons/Equipment fields into
// structured instances (raw text preserved, so nothing typed is ever lost).
// Add/remove + the referee catalogue land in Phase 2, equip + advisory
// encumbrance in Phase 3, the drag grid in Phase 4.

// Worn/wielded slots — single source of truth (used from Phase 3).
const EQUIP_SLOTS = [
  ['armour','Armour'], ['primary','Primary Weapon'], ['secondary','Sidearm'],
  ['aug','Augment'], ['misc','Other']
];
function slotLabel(key){ const s = EQUIP_SLOTS.find(x => x[0] === key); return s ? s[1] : key; }

let INVENTORY = { byChar: {} };
let _invIdSeq = 0;

async function loadInventory(){
  try {
    const res = await supaStorage.get('inventory', true);
    const v = res.value != null ? JSON.parse(res.value) : null;
    INVENTORY = (v && typeof v === 'object' && v.byChar && typeof v.byChar === 'object') ? v : { byChar: {} };
  } catch(e){ INVENTORY = { byChar: {} }; }
}
async function saveInventory(){
  try { await supaStorage.set('inventory', JSON.stringify(INVENTORY), true); }
  catch(e){ console.error('Inventory save failed', e); }
}

function invBucket(characterName){
  if(!INVENTORY.byChar) INVENTORY.byChar = {};
  const b = INVENTORY.byChar[characterName] || (INVENTORY.byChar[characterName] = { items: [] });
  if(!Array.isArray(b.items)) b.items = [];
  return b;
}
function invItemsFor(characterName){
  const b = INVENTORY.byChar && INVENTORY.byChar[characterName];
  return (b && Array.isArray(b.items)) ? b.items : [];
}
function invNewId(){ return 'inv_' + Date.now().toString(36) + '_' + (_invIdSeq++).toString(36); }

// Homebrew footprint auto-suggest from Mass (kg) — referee-editable per item
// once the catalogue authoring UI lands (Phase 2). Deliberately coarse: a hint
// that keeps the grid layout roughly consistent with mass, not a rule.
function footprintFromMass(kg){
  const m = Number(kg) || 0;
  if(m <= 2)  return { w:1, h:1 };
  if(m <= 4)  return { w:1, h:2 };
  if(m <= 8)  return { w:2, h:2 };
  if(m <= 15) return { w:2, h:3 };
  return { w:3, h:3 };
}

// Total mass contributed by one instance (mass × qty) — the Phase-3 encumbrance
// engine sums this over the carried (non-stowed) items.
function invItemMass(it){
  const m = (it && it.snapshot && Number(it.snapshot.mass)) || 0;
  const q = (it && Number(it.qty)) || 1;
  return m * q;
}

// Build a structured instance from a snapshot (a catalogue def in Phase 2, or a
// one-off here). Snapshot is frozen at add-time so later catalogue edits/deletes
// never corrupt an owned item.
function makeInvItem(snapshot, overrides){
  const snap = Object.assign({ name:'', category:'gear', tl:'', mass:0, cost:0 }, snapshot || {});
  if(snap.w == null || snap.h == null){ const f = footprintFromMass(snap.mass); snap.w = f.w; snap.h = f.h; }
  return Object.assign({
    iid: invNewId(), defId: null, snapshot: snap,
    qty: 1, stowed: false, equipped: false, slot: null,
    state: { ammo: null, charge: null, damaged: false, customName: '' }
  }, overrides || {});
}

// ── One-time free-text → structured migration (safe: raw text preserved) ──────
// Runs once per character (guarded by data.invMigrated + only when there is text
// to migrate). Splits the legacy Weapons/Equipment textareas into instances,
// keeps the FULL originals in data._legacyGear AND each item's snapshot.notes,
// then clears the free-text fields. Called from openSheet after both blobs load.
function _splitGearLines(text, splitCommas){
  if(!text) return [];
  let parts = String(text).split(/[\n;]+/);
  if(splitCommas) parts = parts.reduce((acc, p) => acc.concat(p.split(/,(?![^(]*\))/)), []); // split on top-level commas only — keep "(form-fitting, 6kg)" intact
  return parts.map(s => s.trim()).filter(Boolean);
}
function _gearLabel(line){
  let name = String(line).split(/[,(]/)[0].trim() || String(line).trim();
  return name.length > 48 ? name.slice(0, 47) + '…' : name;
}
function _gearMassKg(line){
  const m = String(line).match(/(\d+(?:\.\d+)?)\s*kg\b/i);
  return m ? Number(m[1]) : 0;
}
function migrateSheetGear(characterName, data){
  if(!data || data.invMigrated) return;
  const weaponsTxt = (data.weapons || '').trim();
  const equipTxt   = (data.equipment || '').trim();
  data.invMigrated = true;                 // don't reprocess this character again
  if(!weaponsTxt && !equipTxt) return;     // nothing to migrate — leave blob unwritten
  const bucket = invBucket(characterName);
  _splitGearLines(weaponsTxt, false).forEach(line =>
    bucket.items.push(makeInvItem({ name:_gearLabel(line), category:'weapon', mass:_gearMassKg(line), notes:line })));
  _splitGearLines(equipTxt, true).forEach(line =>
    bucket.items.push(makeInvItem({ name:_gearLabel(line), category:'gear', mass:_gearMassKg(line), notes:line })));
  data._legacyGear = { weapons: data.weapons || '', equipment: data.equipment || '' }; // verbatim safety net
  data.weapons = '';
  data.equipment = '';
  saveSheet(characterName, data);          // persist cleared fields + invMigrated flag
  saveInventory();                          // commit the new instances
}

// ── Read-only render (inside the character-sheet modal) ───────────────────────
function _catLabel(cat){
  return ({ weapon:'Weapon', armour:'Armour', gear:'Gear', augment:'Augment', consumable:'Consumable' })[cat] || 'Gear';
}
function renderInventorySection(characterName){
  const ea = (typeof escQH === 'function') ? escQH : (x => String(x == null ? '' : x));
  const items = invItemsFor(characterName);
  const editable = canEditInv(characterName);
  const cname = String(characterName || '').replace(/'/g, "\\'");
  const addBtn = editable ? `<button class="inv-add-btn" onclick="openCatalogue('${cname}')">＋ Add item</button>` : '';
  const rulesRow = isReferee() ? `<div class="enc-rules-row"><button class="enc-rules-toggle" onclick="toggleEncRules()">⚙ Encumbrance rules</button></div>` : '';
  if(!items.length){
    return `<div class="sheet-section" id="sheet-inv-section">
      <div class="sheet-section-lbl">Inventory</div>
      ${renderEncIndicator(characterName)}${rulesRow}${renderEncRulesEditor()}
      <div class="inv-empty">No items yet.${editable ? ' Tap “＋ Add item” to add from the catalogue.' : ''}</div>
      ${addBtn}
    </div>`;
  }
  const active = invGetActiveContainer(characterName);
  const tabs = CONTAINERS.map(c => {
    const n = items.filter(it => itemContainer(it) === c.id).length;
    return `<button class="inv-tab${c.id === active ? ' on' : ''}${c.carried ? '' : ' stowed'}" data-container="${c.id}"
        onclick="invSetContainer('${cname}','${c.id}')">${ea(c.name)}<span class="inv-tab-n">${n}</span></button>`;
  }).join('');
  const contToggle = isReferee() ? `<button class="inv-tab inv-tab-cfg" title="Manage containers" onclick="toggleContainersEditor()">⚙</button>` : '';
  const inContainer = items.filter(it => itemContainer(it) === active);
  const grid = inContainer.length
    ? `<div class="inv-grid">${inContainer.map(it => renderInvTile(it, characterName, editable)).join('')}</div>`
    : `<div class="inv-empty">This container is empty.</div>`;
  return `<div class="sheet-section" id="sheet-inv-section">
    <div class="sheet-section-lbl">Inventory</div>
    ${renderEncIndicator(characterName)}
    ${rulesRow}
    ${renderEncRulesEditor()}
    ${renderEquipSlots(characterName)}
    <div class="inv-tabs">${tabs}${contToggle}</div>
    ${renderContainersEditor()}
    <div class="inv-hint">${editable ? 'Tap a tile for stats &amp; actions · drag a tile onto a tab to move it' : 'Read-only · tap a tile for its stat block'}</div>
    ${grid}
    ${addBtn}
  </div>`;
}
// A footprint-sized tile in the container grid. Tap opens the item modal
// (stats + actions, §4.2); drag onto a container tab moves it (§4.1).
function renderInvTile(it, characterName, editable){
  const ea = (typeof escQH === 'function') ? escQH : (x => String(x == null ? '' : x));
  const eatt = (typeof escAttr === 'function') ? escAttr : (x => String(x == null ? '' : x));
  const s = it.snapshot || {};
  const cat = s.category || 'gear';
  const rawName = (it.state && it.state.customName) || s.name || 'Item';
  const rot = it.rot ? 1 : 0;
  const w = rot ? (s.h || 1) : (s.w || 1);
  const h = rot ? (s.w || 1) : (s.h || 1);
  const q = Number(it.qty) || 1;
  const cname = String(characterName || '').replace(/'/g, "\\'");
  return `<div class="inv-tile inv-cat-${cat}${it.equipped ? ' is-equipped' : ''}" style="grid-column:span ${w};grid-row:span ${h}"
      data-name="${eatt(rawName)}" title="${eatt(rawName)}"
      onpointerdown="invTilePointerDown(event,'${cname}','${it.iid}')">
    <div class="inv-tile-name">${ea(rawName)}${q > 1 ? ` <span class="inv-tile-q">×${q}</span>` : ''}</div>
    <div class="inv-tile-foot"><span>${(Number(s.mass) || 0)}kg</span>${it.equipped ? '<span class="inv-tile-eq" title="Equipped">▣</span>' : ''}</div>
  </div>`;
}
function renderInvItemDetail(it, extraHtml){
  const ea = (typeof escQH === 'function') ? escQH : (x => String(x == null ? '' : x));
  const s = it.snapshot || {};
  const rows = [];
  const add = (k, v) => { if(v !== '' && v != null) rows.push(
    `<div class="inv-d-row"><span class="inv-d-k">${k}</span><span class="inv-d-v">${ea(String(v))}</span></div>`); };
  add('Category', _catLabel(s.category));
  add('TL', s.tl);
  add('Mass', (Number(s.mass) || 0) + ' kg');
  if(s.cost !== '' && s.cost != null) add('Cost', 'Cr' + (Number(s.cost) || 0).toLocaleString());
  add('Footprint', (s.w || 1) + '×' + (s.h || 1) + ' cells');
  if(s.category === 'weapon'){ add('Range', s.range); add('Damage', s.damage); add('Magazine', s.magazine); add('Traits', s.traits); add('Skill', s.skill); }
  if(s.category === 'armour'){ add('Protection', s.protection); add('Rad', s.rad); add('Req STR', s.reqStr); }
  const q = Number(it.qty) || 1; if(q > 1) add('Quantity', q);
  if(it.state){
    if(it.state.ammo != null)   add('Ammo', it.state.ammo);
    if(it.state.charge != null) add('Charge', it.state.charge);
    if(it.state.damaged)        add('Condition', 'Damaged');
  }
  add('Notes', s.notes || s.desc);
  return `<div class="inv-item-detail">${rows.join('') || '<div class="inv-d-row"><span class="inv-d-v">No further details.</span></div>'}${extraHtml || ''}</div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// INVENTORY — editing (Phase 2: honour-based add / remove)
// ───────────────────────────────────────────────────────────────────────────
// Who may edit a character's inventory: the referee (any), or the player whose
// device identity matches (their own) — the same honour gate as the sheet. The
// KV table is not RLS-enforced; this mirrors funds/notes exactly (Phase 0 §1.2).
function canEditInv(characterName){ return canEditChar(characterName); }

// Re-render just the inventory <section> in the open sheet, so add/remove leave
// the rest of the form (and any unsaved characteristic edits) untouched.
function refreshSheetInventory(){
  if(!sheetCurrentCharacter) return;
  const el = document.getElementById('sheet-inv-section');
  if(el) el.outerHTML = renderInventorySection(sheetCurrentCharacter);
}

async function invAddFromCatalogue(characterName, defId){
  if(!canEditInv(characterName)) return;
  const def = catById(defId); if(!def) return;
  // Freeze a snapshot so later catalogue edits/deletes never mutate an owned item.
  const snap = {
    name:def.name, category:def.category || 'gear', tl:def.tl, mass:Number(def.mass) || 0, cost:Number(def.cost) || 0,
    w:def.w || 1, h:def.h || 1, desc:def.desc || '', notes:def.notes || '',
    range:def.range || '', damage:def.damage || '', magazine:def.magazine || '', magazineCost:def.magazineCost || '',
    traits:def.traits || '', skill:def.skill || '', protection:def.protection || '', rad:def.rad || '', reqStr:def.reqStr || ''
  };
  invBucket(characterName).items.push(makeInvItem(snap, { defId: def.id }));
  await saveInventory();
  refreshInvViews();
  if(typeof showToast === 'function') showToast('Added ' + (def.name || 'item') + (characterName !== myIdentity ? (' → ' + characterName) : ''));
}

async function invRemoveItem(characterName, iid){
  if(!canEditInv(characterName)) return;
  const b = INVENTORY.byChar && INVENTORY.byChar[characterName];
  if(!b || !Array.isArray(b.items)) return;
  const it = b.items.find(x => x.iid === iid);
  b.items = b.items.filter(x => x.iid !== iid);
  await saveInventory();
  refreshInvViews();
  if(it && typeof showToast === 'function') showToast('Removed ' + ((it.snapshot && it.snapshot.name) || 'item'));
}

// ═══════════════════════════════════════════════════════════════════════════
// ITEM CATALOGUE  (referee-authored library — SHIPS EMPTY; §4.8)
// ───────────────────────────────────────────────────────────────────────────
// A reusable library of item definitions the referee authors once and players
// add to their sheets (§4.5). Stored as a plain array under the shared KV key
// 'item-catalogue' — no seed, no pre-loaded rulebook data. Same façade + honour
// model as everything else. The picker is shared: players get search + one-tap
// Add; referees also get New/Edit/Duplicate/Delete via a category-adaptive form.
// Modelled on the ship weapon catalogue (js/80-combat.js).
const ITEM_CATEGORIES = ['weapon','armour','gear','augment','consumable'];
let ITEM_CATALOGUE = [];

async function loadItemCatalogue(){
  try {
    const r = await supaStorage.get('item-catalogue', true);
    const v = r.value != null ? JSON.parse(r.value) : null;
    ITEM_CATALOGUE = Array.isArray(v) ? v : [];
  } catch(e){ ITEM_CATALOGUE = []; }
}
async function saveItemCatalogue(){
  try { await supaStorage.set('item-catalogue', JSON.stringify(ITEM_CATALOGUE), true); }
  catch(e){ console.error('Catalogue save failed', e); }
}
function catById(id){ return ITEM_CATALOGUE.find(d => d.id === id) || null; }
function catNewId(){ return 'itm_' + Date.now().toString(36) + '_' + (_invIdSeq++).toString(36); }
function emptyItemDef(){
  return { id:catNewId(), name:'', category:'gear', tl:'', mass:0, cost:0, w:1, h:1, fpManual:false,
    desc:'', notes:'', range:'', damage:'', magazine:'', magazineCost:'', traits:'', skill:'',
    protection:'', rad:'', reqStr:'' };
}

function catAdd(){
  if(!isReferee()) return;
  const d = emptyItemDef();
  ITEM_CATALOGUE.push(d);
  catalogueEditingId = d.id;
  saveItemCatalogue();
  renderCatalogueModal();
}
function catDuplicate(id){
  if(!isReferee()) return;
  const s = catById(id); if(!s) return;
  const d = Object.assign(JSON.parse(JSON.stringify(s)), { id:catNewId(), name:((s.name || 'Item') + ' (copy)') });
  ITEM_CATALOGUE.push(d);
  catalogueEditingId = d.id;
  saveItemCatalogue();
  renderCatalogueModal();
}
function catRemove(id){
  if(!isReferee()) return;
  const d = catById(id); if(!d) return;
  if(!confirm('Delete "' + (d.name || 'item') + '" from the catalogue?\n\nItems already on characters keep their own copy.')) return;
  ITEM_CATALOGUE = ITEM_CATALOGUE.filter(x => x.id !== id);
  if(catalogueEditingId === id) catalogueEditingId = null;
  saveItemCatalogue();
  renderCatalogueModal();
}
function catEditField(id, field, value){
  if(!isReferee()) return;
  const d = catById(id); if(!d) return;
  if(field === 'mass'){ d.mass = Number(value) || 0; if(!d.fpManual){ const f = footprintFromMass(d.mass); d.w = f.w; d.h = f.h; } }
  else if(field === 'cost'){ d.cost = Number(value) || 0; }
  else if(field === 'tl'){ d.tl = (value === '' ? '' : (Number(value) || 0)); }
  else if(field === 'w' || field === 'h'){ d[field] = Math.max(1, Number(value) || 1); d.fpManual = true; }
  else { d[field] = value; }
  saveItemCatalogue();
  if(field === 'category' || field === 'mass') renderCatalogueModal(); // category swaps the specific fields; mass re-derives footprint
}
function catAutoFootprint(id){
  if(!isReferee()) return;
  const d = catById(id); if(!d) return;
  const f = footprintFromMass(d.mass); d.w = f.w; d.h = f.h; d.fpManual = false;
  saveItemCatalogue();
  renderCatalogueModal();
}

// ── Catalogue modal (shared: add picker + referee authoring) ──────────────────
let catalogueTargetChar = null;   // character to add to (null = referee manage / author)
let catalogueSearch = '';
let catalogueCatFilter = 'all';
let catalogueEditingId = null;

function openCatalogue(targetChar){
  catalogueTargetChar = targetChar || null;
  catalogueEditingId = null;
  catalogueSearch = '';
  catalogueCatFilter = 'all';
  const m = document.getElementById('catalogue-modal');
  if(m) m.classList.add('open');
  const body = document.getElementById('catalogue-body');
  if(body) body.innerHTML = '<div class="cat-empty">Loading…</div>';
  loadItemCatalogue().then(renderCatalogueModal);
}
function closeCatalogue(){
  const m = document.getElementById('catalogue-modal');
  if(m) m.classList.remove('open');
  catalogueEditingId = null;
}
function catSetFilter(c){ catalogueCatFilter = c; renderCatalogueModal(); }
function catSetSearch(v){
  catalogueSearch = v;
  const list = document.getElementById('catalogue-list');
  if(list) list.innerHTML = renderCatalogueList();   // list-only refresh keeps the search box focused
}
function catOpenEditor(id){ if(!isReferee()) return; catalogueEditingId = id; renderCatalogueModal(); }
function catBackToList(){ catalogueEditingId = null; renderCatalogueModal(); }
function catAddToChar(defId){ if(catalogueTargetChar) invAddFromCatalogue(catalogueTargetChar, defId); }

function renderCatalogueModal(){
  const body = document.getElementById('catalogue-body');
  if(!body) return;
  body.innerHTML = (catalogueEditingId && isReferee())
    ? renderCatalogueEditor(catById(catalogueEditingId))
    : renderCatalogueBrowser();
}
function renderCatalogueBrowser(){
  const eatt = (typeof escAttr === 'function') ? escAttr : (x => String(x == null ? '' : x));
  const ea = (typeof escQH === 'function') ? escQH : (x => String(x == null ? '' : x));
  const ref = isReferee();
  let note;
  if(catalogueTargetChar){
    note = `<div class="cat-target">Adding to <b>${ea(catalogueTargetChar)}</b> — tap ＋ Add${ref ? ` · <button class="cat-link" onclick="catSetTarget('')">done</button>` : ''}</div>`;
  } else if(ref){
    const opts = (typeof KNOWN_CHARACTERS !== 'undefined' ? KNOWN_CHARACTERS : []).map(n => `<option value="${eatt(n)}">${ea(n)}</option>`).join('');
    note = `<div class="cat-target">Authoring the shared library · <label>grant to <select class="cat-grant" onchange="if(this.value)catSetTarget(this.value)"><option value="">—</option>${opts}</select></label></div>`;
  } else { note = ''; }
  const chips = ['all'].concat(ITEM_CATEGORIES).map(c =>
    `<button class="cat-chip${catalogueCatFilter === c ? ' on' : ''}" onclick="catSetFilter('${c}')">${c === 'all' ? 'All' : ea(_catLabel(c))}</button>`).join('');
  const newBtn = ref ? `<button class="cat-new-btn" onclick="catAdd()">＋ New item</button>` : '';
  return `${note}
    <div class="cat-controls">
      <input id="cat-search" class="cat-search" placeholder="Search items…" value="${eatt(catalogueSearch)}" oninput="catSetSearch(this.value)">
      ${newBtn}
    </div>
    <div class="cat-chips">${chips}</div>
    <div id="catalogue-list">${renderCatalogueList()}</div>`;
}
function renderCatalogueList(){
  const ea = (typeof escQH === 'function') ? escQH : (x => String(x == null ? '' : x));
  const ref = isReferee();
  if(!ITEM_CATALOGUE.length){
    return `<div class="cat-empty">${ref
      ? 'The catalogue is empty — nothing is pre-loaded. Tap “＋ New item” to author your first entry.'
      : 'No items in the catalogue yet. Ask your referee to add some.'}</div>`;
  }
  const q = catalogueSearch.trim().toLowerCase();
  let list = ITEM_CATALOGUE.slice();
  if(catalogueCatFilter !== 'all') list = list.filter(d => (d.category || 'gear') === catalogueCatFilter);
  if(q) list = list.filter(d =>
    (d.name || '').toLowerCase().includes(q) ||
    (d.category || '').toLowerCase().includes(q) ||
    (d.traits || '').toLowerCase().includes(q));
  list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if(!list.length) return `<div class="cat-empty">No matches.</div>`;
  return list.map(d => {
    const meta = [];
    if(d.tl !== '' && d.tl != null) meta.push('TL' + ea(String(d.tl)));
    meta.push((Number(d.mass) || 0) + 'kg');
    if(Number(d.cost)) meta.push('Cr' + Number(d.cost).toLocaleString());
    meta.push((d.w || 1) + '×' + (d.h || 1));
    const addBtn = catalogueTargetChar ? `<button class="cat-add-btn" onclick="catAddToChar('${d.id}')">＋ Add</button>` : '';
    const refBtns = ref
      ? `<button class="cat-icon-btn" title="Edit" onclick="catOpenEditor('${d.id}')">✎</button><button class="cat-icon-btn" title="Duplicate" onclick="catDuplicate('${d.id}')">⧉</button><button class="cat-icon-btn danger" title="Delete" onclick="catRemove('${d.id}')">🗑</button>`
      : '';
    return `<div class="cat-row inv-cat-${d.category || 'gear'}">
      <div class="cat-row-main">
        <div class="cat-row-name">${ea(d.name || '(unnamed)')}<span class="inv-badge inv-badge-cat">${ea(_catLabel(d.category))}</span></div>
        <div class="cat-row-meta">${meta.join(' · ')}</div>
      </div>
      <div class="cat-row-actions">${addBtn}${refBtns}</div>
    </div>`;
  }).join('');
}
function renderCatalogueEditor(d){
  if(!d){ catalogueEditingId = null; return renderCatalogueBrowser(); }
  const eatt = (typeof escAttr === 'function') ? escAttr : (x => String(x == null ? '' : x));
  const ea = (typeof escQH === 'function') ? escQH : (x => String(x == null ? '' : x));
  const cat = d.category || 'gear';
  const catOpts = ITEM_CATEGORIES.map(c => `<option value="${c}"${c === cat ? ' selected' : ''}>${_catLabel(c)}</option>`).join('');
  const fld = (label, key, val, opts) => { opts = opts || {}; return `<label class="cat-f">
      <span class="cat-f-lbl">${label}</span>
      <input class="cat-input"${opts.type ? ` type="${opts.type}"` : ''} value="${eatt(val == null ? '' : val)}"${opts.ph ? ` placeholder="${eatt(opts.ph)}"` : ''} onchange="catEditField('${d.id}','${key}',this.value)">
    </label>`; };
  let specific = '';
  if(cat === 'weapon'){
    specific = `<div class="cat-sub-lbl">Weapon</div><div class="cat-f-grid">
      ${fld('Range','range',d.range,{ph:'e.g. Ranged'})}
      ${fld('Damage','damage',d.damage,{ph:'e.g. 3D-3'})}
      ${fld('Magazine','magazine',d.magazine,{ph:'rounds'})}
      ${fld('Mag. cost (Cr)','magazineCost',d.magazineCost,{type:'number'})}
      ${fld('Traits','traits',d.traits,{ph:'e.g. Auto 2'})}
      ${fld('Skill','skill',d.skill,{ph:'e.g. Gun Combat (slug)'})}
    </div>`;
  } else if(cat === 'armour'){
    specific = `<div class="cat-sub-lbl">Armour</div><div class="cat-f-grid">
      ${fld('Protection','protection',d.protection,{ph:'e.g. 8'})}
      ${fld('Rad protection','rad',d.rad)}
      ${fld('Required STR','reqStr',d.reqStr)}
    </div>`;
  }
  return `<div class="cat-editor">
    <button class="cat-back-btn" onclick="catBackToList()">← Catalogue</button>
    <label class="cat-f"><span class="cat-f-lbl">Name</span>
      <input class="cat-input" value="${eatt(d.name)}" placeholder="Item name" onchange="catEditField('${d.id}','name',this.value)"></label>
    <label class="cat-f"><span class="cat-f-lbl">Category</span>
      <select class="cat-input" onchange="catEditField('${d.id}','category',this.value)">${catOpts}</select></label>
    <div class="cat-f-grid">
      ${fld('TL','tl',d.tl,{type:'number'})}
      ${fld('Mass (kg)','mass',d.mass,{type:'number'})}
      ${fld('Cost (Cr)','cost',d.cost,{type:'number'})}
    </div>
    <div class="cat-f-grid cat-fp-grid">
      ${fld('Footprint W','w',d.w,{type:'number'})}
      ${fld('Footprint H','h',d.h,{type:'number'})}
      <div class="cat-fp-hint">${d.fpManual ? 'manual' : 'auto from mass'}<button class="cat-mini-btn" onclick="catAutoFootprint('${d.id}')">↻ from mass</button></div>
    </div>
    ${specific}
    <label class="cat-f"><span class="cat-f-lbl">Description / effect</span>
      <textarea class="cat-input cat-textarea" onchange="catEditField('${d.id}','desc',this.value)">${ea(d.desc || '')}</textarea></label>
    <label class="cat-f"><span class="cat-f-lbl">Notes</span>
      <textarea class="cat-input cat-textarea" onchange="catEditField('${d.id}','notes',this.value)">${ea(d.notes || '')}</textarea></label>
    <div class="cat-editor-actions">
      <button class="cat-icon-btn danger" onclick="catRemove('${d.id}')">🗑 Delete</button>
      <button class="cat-new-btn" onclick="catBackToList()">Done</button>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// INVENTORY — equip / stow (Phase 3, §4.3)
// ───────────────────────────────────────────────────────────────────────────
// One item per slot; equipping implies carried (clears stowed) and bumps any
// current occupant. Stowing clears equipped (stowed gear isn't worn/wielded).
function invSlotOccupant(characterName, slotKey){
  return invItemsFor(characterName).find(it => it.equipped && it.slot === slotKey) || null;
}
function invDefaultSlot(characterName, it){
  const cat = (it.snapshot && it.snapshot.category) || 'gear';
  if(cat === 'armour')  return 'armour';
  if(cat === 'augment') return 'aug';
  if(cat === 'weapon')  return invSlotOccupant(characterName, 'primary') ? 'secondary' : 'primary';
  return 'misc';
}
async function invEquip(characterName, iid, slotKey){
  if(!canEditInv(characterName)) return;
  const items = invItemsFor(characterName);
  const it = items.find(x => x.iid === iid); if(!it) return;
  const slot = slotKey || invDefaultSlot(characterName, it);
  items.forEach(x => { if(x.slot === slot && x.iid !== iid){ x.equipped = false; x.slot = null; } });
  it.equipped = true; it.slot = slot;
  if(itemStowed(it)) it.container = firstCarriedContainerId();  // a worn item is carried, not stowed
  await saveInventory(); refreshInvViews();
}
async function invUnequip(characterName, iid){
  if(!canEditInv(characterName)) return;
  const it = invItemsFor(characterName).find(x => x.iid === iid); if(!it) return;
  it.equipped = false; it.slot = null;
  await saveInventory(); refreshInvViews();
}
async function invMoveToContainer(characterName, iid, containerId){
  if(!canEditInv(characterName)) return;
  if(!containerById(containerId)) return;
  const it = invItemsFor(characterName).find(x => x.iid === iid); if(!it) return;
  it.container = containerId;
  if(!containerCarried(containerId)){ it.equipped = false; it.slot = null; }  // stowed gear can't be worn/wielded
  await saveInventory(); refreshInvViews();
}
async function invRotate(characterName, iid){
  if(!canEditInv(characterName)) return;
  const it = invItemsFor(characterName).find(x => x.iid === iid); if(!it) return;
  it.rot = it.rot ? 0 : 1;
  await saveInventory(); refreshInvViews();
}
// Refresh the sheet's inventory section AND the item modal (if open).
function refreshInvViews(){
  refreshSheetInventory();
  const m = document.getElementById('inv-item-modal');
  if(m && m.classList.contains('open')) renderInvItemModal();
}
function renderEquipSlots(characterName){
  const ea = (typeof escQH === 'function') ? escQH : (x => String(x == null ? '' : x));
  const rows = EQUIP_SLOTS.map(([key, label]) => {
    const occ = invSlotOccupant(characterName, key);
    const val = occ
      ? `<span class="eq-slot-item">${ea((occ.state && occ.state.customName) || (occ.snapshot && occ.snapshot.name) || 'Item')}</span>`
      : `<span class="eq-slot-empty">— empty —</span>`;
    return `<div class="eq-slot${occ ? ' filled' : ''}"><span class="eq-slot-lbl">${label}</span>${val}</div>`;
  }).join('');
  return `<div class="eq-slots">${rows}</div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// INVENTORY — encumbrance engine (Phase 3, §4.4 — advisory, configurable)
// ───────────────────────────────────────────────────────────────────────────
// Traveller-faithful in SHAPE, referee-CONFIGURABLE in values (Referee decision).
// capacity = perSTR·STR + perEND·END + base (kg); carried = Σ non-stowed mass×qty
// (worn armour counts in FULL, per the Referee's ruling — so no special-case).
// unencumbered ≤ capacity < encumbered ≤ capacity·heavyMult < overloaded. A DM is
// SURFACED, never blocking. Defaults are PLACEHOLDERS — set via the ⚙ editor to
// your Core Rulebook values; nothing rulebook-specific is hard-coded.
const ENC_DEFAULTS = { perStr:1, perEnd:1, base:0, heavyMult:2, encDM:-1, overDM:-2 };
let ENC_SETTINGS = Object.assign({}, ENC_DEFAULTS);
let encRulesOpen = false;

async function loadEncSettings(){
  try {
    const r = await supaStorage.get('enc-settings', true);
    const v = r.value != null ? JSON.parse(r.value) : null;
    ENC_SETTINGS = Object.assign({}, ENC_DEFAULTS, (v && typeof v === 'object') ? v : {});
  } catch(e){ ENC_SETTINGS = Object.assign({}, ENC_DEFAULTS); }
}
async function saveEncSettings(){
  try { await supaStorage.set('enc-settings', JSON.stringify(ENC_SETTINGS), true); }
  catch(e){ console.error('Encumbrance settings save failed', e); }
}
function encEditField(field, value){
  if(!isReferee()) return;
  ENC_SETTINGS[field] = Number(value) || 0;
  saveEncSettings();
  refreshSheetInventory();
}
function toggleEncRules(){ encRulesOpen = !encRulesOpen; refreshSheetInventory(); }

function carriedMass(characterName){
  return invItemsFor(characterName).reduce((sum, it) => sum + (itemStowed(it) ? 0 : invItemMass(it)), 0);
}
function currentSheetStats(){
  const s = sheetCurrentData || {};
  const g = (id, fb) => { const el = document.getElementById(id); return el ? el.value : fb; };
  return { str: parseInt(g('sheet-f-str', s.str)) || 0, end: parseInt(g('sheet-f-end', s.end)) || 0 };
}
function encCapacity(stats){
  return (ENC_SETTINGS.perStr * stats.str) + (ENC_SETTINGS.perEnd * stats.end) + ENC_SETTINGS.base;
}
function encStatus(characterName){
  const stats = currentSheetStats();
  const carried = carriedMass(characterName);
  const cap = Math.max(0, encCapacity(stats));
  const heavy = cap * (ENC_SETTINGS.heavyMult || 2);
  let level = 'unencumbered', dm = 0;
  if(cap > 0 && carried > heavy){ level = 'overloaded'; dm = ENC_SETTINGS.overDM; }
  else if(cap > 0 && carried > cap){ level = 'encumbered'; dm = ENC_SETTINGS.encDM; }
  return { carried, cap, heavy, level, dm, stats };
}
function fmtKg(n){ return (Math.round(n * 100) / 100) + ''; }
function renderEncIndicator(characterName){
  const st = encStatus(characterName);
  const label = { unencumbered:'Unencumbered', encumbered:'Encumbered', overloaded:'Overloaded' }[st.level];
  const pct = st.heavy > 0 ? Math.min(100, (st.carried / st.heavy) * 100) : (st.carried > 0 ? 100 : 0);
  const capPct = st.heavy > 0 ? Math.min(100, (st.cap / st.heavy) * 100) : 0;
  const dmTxt = 'DM ' + (st.dm >= 0 ? '+' : '') + st.dm;
  const note = st.cap > 0
    ? `${fmtKg(st.carried)} / ${fmtKg(st.cap)} kg · overload &gt; ${fmtKg(st.heavy)} kg`
    : `${fmtKg(st.carried)} kg carried · set STR/END + rules for a threshold`;
  return `<div class="enc-bar enc-${st.level}" id="enc-indicator">
    <div class="enc-line"><span class="enc-badge">${label}</span><span class="enc-dm">${dmTxt}</span></div>
    <div class="enc-meter"><div class="enc-meter-fill" style="width:${pct}%"></div><div class="enc-cap-mark" style="left:${capPct}%"></div></div>
    <div class="enc-nums">${note}</div>
  </div>`;
}
function renderEncRulesEditor(){
  if(!isReferee() || !encRulesOpen) return '';
  const num = (label, field, step) => `<label class="cat-f">
      <span class="cat-f-lbl">${label}</span>
      <input class="cat-input" type="number"${step ? ` step="${step}"` : ''} value="${ENC_SETTINGS[field]}" onchange="encEditField('${field}',this.value)">
    </label>`;
  return `<div class="enc-rules">
    <div class="enc-rules-note">Placeholders — set to your Core Rulebook values. Capacity = perSTR·STR + perEND·END + base (kg); overloaded above capacity × the overload factor. Advisory only — never blocks.</div>
    <div class="cat-f-grid">
      ${num('kg / STR','perStr','0.1')}
      ${num('kg / END','perEnd','0.1')}
      ${num('base kg','base','0.1')}
    </div>
    <div class="cat-f-grid">
      ${num('overload ×','heavyMult','0.1')}
      ${num('encumbered DM','encDM','1')}
      ${num('overloaded DM','overDM','1')}
    </div>
  </div>`;
}
function updateEncIndicator(){
  if(!sheetCurrentCharacter) return;
  const el = document.getElementById('enc-indicator');
  if(el) el.outerHTML = renderEncIndicator(sheetCurrentCharacter);
}

// ═══════════════════════════════════════════════════════════════════════════
// INVENTORY — containers + grid (Phase 4, §4.1)
// ───────────────────────────────────────────────────────────────────────────
// Container tabs + footprint-sized tiles (Referee decision). Containers are a
// shared, referee-editable set (default Backpack/Belt/Ship's Locker); carried
// containers encumber, the locker is stowed (excluded). Each item instance
// carries a `container` id; legacy items without one derive from the old stowed
// flag. Move by dragging a tile onto a tab OR via the item modal's picker; tap a
// tile for its stat block + actions (§4.2).
const DEFAULT_CONTAINERS = [
  { id:'backpack', name:'Backpack',      carried:true  },
  { id:'belt',     name:'Belt',          carried:true  },
  { id:'locker',   name:"Ship's Locker", carried:false }
];
let CONTAINERS = DEFAULT_CONTAINERS.map(c => Object.assign({}, c));

async function loadContainers(){
  try {
    const r = await supaStorage.get('containers', true);
    const v = r.value != null ? JSON.parse(r.value) : null;
    CONTAINERS = (Array.isArray(v) && v.length) ? v : DEFAULT_CONTAINERS.map(c => Object.assign({}, c));
  } catch(e){ CONTAINERS = DEFAULT_CONTAINERS.map(c => Object.assign({}, c)); }
}
async function saveContainers(){
  try { await supaStorage.set('containers', JSON.stringify(CONTAINERS), true); }
  catch(e){ console.error('Containers save failed', e); }
}
function containerById(id){ return CONTAINERS.find(c => c.id === id) || null; }
function containerCarried(id){ const c = containerById(id); return c ? !!c.carried : true; }
function firstCarriedContainerId(){ const c = CONTAINERS.find(x => x.carried) || CONTAINERS[0]; return c ? c.id : 'backpack'; }
function firstStowedContainerId(){ const c = CONTAINERS.find(x => !x.carried); return c ? c.id : (CONTAINERS[0] ? CONTAINERS[0].id : 'locker'); }
function itemContainer(it){
  if(it.container && containerById(it.container)) return it.container;
  if(it.container) return firstCarriedContainerId();                       // referenced container was deleted
  return it.stowed ? firstStowedContainerId() : firstCarriedContainerId(); // legacy pre-Phase-4 item
}
function itemStowed(it){ return !containerCarried(itemContainer(it)); }

let invActiveContainer = {};   // characterName → active container id (session only)
function invGetActiveContainer(characterName){
  const cur = invActiveContainer[characterName];
  if(cur && containerById(cur)) return cur;
  return CONTAINERS[0] ? CONTAINERS[0].id : 'backpack';
}
function invSetContainer(characterName, containerId){ invActiveContainer[characterName] = containerId; refreshSheetInventory(); }

// ── Referee container manager ─────────────────────────────────────────────────
let containersEditorOpen = false;
function toggleContainersEditor(){ containersEditorOpen = !containersEditorOpen; refreshSheetInventory(); }
function containerAdd(){
  if(!isReferee()) return;
  CONTAINERS.push({ id:'cont_' + Date.now().toString(36) + '_' + (_invIdSeq++).toString(36), name:'New Container', carried:true });
  saveContainers(); refreshSheetInventory();
}
function containerEditField(id, field, value){
  if(!isReferee()) return;
  const c = containerById(id); if(!c) return;
  if(field === 'carried') c.carried = !!value; else c[field] = value;
  saveContainers(); refreshSheetInventory();
}
function containerRemove(id){
  if(!isReferee()) return;
  if(CONTAINERS.length <= 1) return;
  const c = containerById(id); if(!c) return;
  if(!confirm('Delete container "' + (c.name || '') + '"? Items in it move to the first container.')) return;
  CONTAINERS = CONTAINERS.filter(x => x.id !== id);
  saveContainers(); refreshSheetInventory();
}
function renderContainersEditor(){
  if(!isReferee() || !containersEditorOpen) return '';
  const eatt = (typeof escAttr === 'function') ? escAttr : (x => String(x == null ? '' : x));
  const rows = CONTAINERS.map(c => `<div class="cont-row">
      <input class="cat-input" value="${eatt(c.name)}" onchange="containerEditField('${c.id}','name',this.value)">
      <label class="cont-carried"><input type="checkbox" ${c.carried ? 'checked' : ''} onchange="containerEditField('${c.id}','carried',this.checked)"> carried</label>
      <button class="cat-icon-btn danger" title="Delete" onclick="containerRemove('${c.id}')">🗑</button>
    </div>`).join('');
  return `<div class="enc-rules">
    <div class="enc-rules-note">Containers — carried ones count toward encumbrance; unchecked = stowed (e.g. the ship's locker, excluded).</div>
    ${rows}
    <button class="cat-new-btn" style="align-self:flex-start" onclick="containerAdd()">＋ Container</button>
  </div>`;
}

// ── Item detail modal (tap a tile) — stat block + actions ─────────────────────
let invModalChar = null, invModalIid = null;
function openInvItemModal(characterName, iid){
  invModalChar = characterName; invModalIid = iid;
  const m = document.getElementById('inv-item-modal'); if(!m) return;
  m.classList.add('open');
  renderInvItemModal();
}
function closeInvItemModal(){
  const m = document.getElementById('inv-item-modal'); if(m) m.classList.remove('open');
  invModalChar = null; invModalIid = null;
}
function renderInvItemModal(){
  const body = document.getElementById('inv-item-modal-body'); if(!body) return;
  const it = (invModalChar != null) ? invItemsFor(invModalChar).find(x => x.iid === invModalIid) : null;
  if(!it){ closeInvItemModal(); return; }
  const ea = (typeof escQH === 'function') ? escQH : (x => String(x == null ? '' : x));
  const s = it.snapshot || {};
  const editable = canEditInv(invModalChar);
  const cname = String(invModalChar || '').replace(/'/g, "\\'");
  const title = document.getElementById('inv-item-modal-title');
  if(title) title.textContent = ((it.state && it.state.customName) || s.name || 'Item');
  const rot = it.rot ? 1 : 0, w = rot ? (s.h || 1) : (s.w || 1), h = rot ? (s.w || 1) : (s.h || 1);
  const contSelect = editable ? `<label class="cat-f"><span class="cat-f-lbl">Container</span>
      <select class="cat-input" onchange="invMoveToContainer('${cname}','${it.iid}',this.value)">
        ${CONTAINERS.map(c => `<option value="${c.id}"${itemContainer(it) === c.id ? ' selected' : ''}>${ea(c.name)}${c.carried ? '' : ' (stowed)'}</option>`).join('')}
      </select></label>` : '';
  const actions = editable ? `<div class="inv-modal-actions">
      <button class="inv-act-btn${it.equipped ? ' on' : ''}" onclick="${it.equipped ? `invUnequip('${cname}','${it.iid}')` : `invEquip('${cname}','${it.iid}','')`}">${it.equipped ? '✓ Equipped — unequip' : 'Equip'}</button>
      <button class="inv-act-btn" onclick="invRotate('${cname}','${it.iid}')">↻ Rotate · ${w}×${h}</button>
      <button class="inv-act-btn danger" onclick="invRemoveItem('${cname}','${it.iid}')">✕ Remove</button>
    </div>` : '';
  body.innerHTML = `${renderInvItemDetail(it)}${contSelect}${actions}`;
}

// ── Drag-or-tap: tap opens the modal; drag (mouse threshold / touch long-press)
//    onto a container tab moves the item. Works on touch + mouse. ─────────────
let _invDrag = null;
function cleanupInvDragListeners(){
  window.removeEventListener('pointermove', invTilePointerMove);
  window.removeEventListener('pointerup', invTilePointerUp);
  window.removeEventListener('pointercancel', invTilePointerUp);
}
function invTilePointerDown(e, characterName, iid){
  if(e.pointerType === 'mouse' && e.button !== 0) return;
  const d = { characterName, iid, el: e.currentTarget, x0: e.clientX, y0: e.clientY, pointerId: e.pointerId, dragging: false, ghost: null, timer: null };
  _invDrag = d;
  if(e.pointerType !== 'mouse') d.timer = setTimeout(() => { if(_invDrag === d && !d.dragging) invBeginDrag(); }, 240); // touch/pen long-press → drag (mouse uses the move threshold)
  window.addEventListener('pointermove', invTilePointerMove);
  window.addEventListener('pointerup', invTilePointerUp);
  window.addEventListener('pointercancel', invTilePointerUp);
}
function invBeginDrag(){
  const d = _invDrag; if(!d || d.dragging) return;
  clearTimeout(d.timer);
  if(!canEditInv(d.characterName)) return;   // read-only viewers can tap (open modal) but not move
  d.dragging = true;
  if(d.el) d.el.classList.add('inv-tile-dragging');
  const g = document.createElement('div');
  g.className = 'inv-drag-ghost';
  g.textContent = (d.el && d.el.getAttribute('data-name')) || 'Item';
  document.body.appendChild(g);
  d.ghost = g;
  try { d.el.setPointerCapture(d.pointerId); } catch(err){}
}
function invTilePointerMove(e){
  const d = _invDrag; if(!d) return;
  if(!d.dragging){
    const dist = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
    if(e.pointerType === 'mouse'){ if(dist > 6) invBeginDrag(); }
    else if(dist > 12){ clearTimeout(d.timer); _invDrag = null; cleanupInvDragListeners(); return; } // touch move before long-press = scroll
    if(!_invDrag || !_invDrag.dragging) return;
  }
  e.preventDefault();
  if(d.ghost){ d.ghost.style.left = e.clientX + 'px'; d.ghost.style.top = e.clientY + 'px'; }
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const tab = el && el.closest ? el.closest('.inv-tab[data-container]') : null;
  document.querySelectorAll('.inv-tab.drop-hot').forEach(t => t.classList.remove('drop-hot'));
  if(tab) tab.classList.add('drop-hot');
}
function invTilePointerUp(e){
  const d = _invDrag;
  cleanupInvDragListeners();
  _invDrag = null;
  if(!d) return;
  clearTimeout(d.timer);
  if(d.ghost) d.ghost.remove();
  if(d.el) d.el.classList.remove('inv-tile-dragging');
  document.querySelectorAll('.inv-tab.drop-hot').forEach(t => t.classList.remove('drop-hot'));
  if(!d.dragging){ openInvItemModal(d.characterName, d.iid); return; }   // it was a tap
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const tab = el && el.closest ? el.closest('.inv-tab[data-container]') : null;
  if(tab){ const cid = tab.getAttribute('data-container'); if(cid) invMoveToContainer(d.characterName, d.iid, cid); }
}
function catSetTarget(name){ catalogueTargetChar = name || null; renderCatalogueModal(); }

// ═══════════════════════════════════════════════════════════════════════════
// CHARACTER PORTRAIT  (Phase 6, §4.7 — Supabase Storage 'portraits' bucket)
// ───────────────────────────────────────────────────────────────────────────
// Players upload their own character's portrait, the referee any — same honour
// gate as the sheet/inventory. The client center-crops + resizes to a 512² JPEG
// before upload (well under the 2 MB bucket limit); a version stamp on the sheet
// blob (portraitVer) makes every device load the latest via the shared public
// URL. Storage plumbing lives in js/50-supabase.js (portraitUrlFor /
// uploadPortraitBlob), per the data-layer ownership rule.
function canEditChar(characterName){ return isReferee() || (!!myIdentity && myIdentity === characterName); }
function portraitInitials(name){
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (((parts[0] || '')[0] || '') + ((parts[1] || '')[0] || '')).toUpperCase() || '?';
}
function renderPortrait(characterName, data){
  const eatt = (typeof escAttr === 'function') ? escAttr : (x => String(x == null ? '' : x));
  const ea = (typeof escQH === 'function') ? escQH : (x => String(x == null ? '' : x));
  const editable = canEditChar(characterName);
  const ver = data && data.portraitVer;
  const img = ver
    ? `<img class="sheet-portrait-img" src="${portraitUrlFor(characterName, ver)}" alt="${eatt(characterName)}" onerror="this.remove();var p=document.getElementById('sheet-portrait');if(p)p.classList.add('no-img')">`
    : '';
  return `<div class="sheet-portrait-row" id="sheet-portrait-row">
    <div class="sheet-portrait${ver ? '' : ' no-img'}" id="sheet-portrait">
      ${img}<span class="sheet-portrait-fallback">${ea(portraitInitials(characterName))}</span>
    </div>
    ${editable ? `<div class="sheet-portrait-actions">
      <button class="sheet-portrait-btn" onclick="triggerPortraitUpload()">${ver ? 'Change photo' : 'Upload photo'}</button>
      <input type="file" id="portrait-file" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="onPortraitFile(event)">
      <div class="sheet-portrait-hint" id="portrait-hint">JPG / PNG / WebP · cropped square</div>
    </div>` : ''}
  </div>`;
}
function refreshPortrait(){
  if(!sheetCurrentCharacter) return;
  const el = document.getElementById('sheet-portrait-row');
  if(el) el.outerHTML = renderPortrait(sheetCurrentCharacter, sheetCurrentData || {});
}
function triggerPortraitUpload(){ const f = document.getElementById('portrait-file'); if(f) f.click(); }
function resizePortrait(file, size){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const s = Math.min(img.width, img.height);
      const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
}
async function onPortraitFile(e){
  const file = e && e.target && e.target.files && e.target.files[0];
  if(e && e.target) e.target.value = '';           // allow re-picking the same file later
  if(!file || !sheetCurrentCharacter) return;
  if(!canEditChar(sheetCurrentCharacter)) return;
  const hint = document.getElementById('portrait-hint');
  const setHint = t => { if(hint) hint.textContent = t; };
  if(file.size > 12 * 1024 * 1024){ setHint('Source image too large (max 12 MB).'); return; }
  try {
    setHint('Processing…');
    const blob = await resizePortrait(file, 512);
    setHint('Uploading…');
    await uploadPortraitBlob(sheetCurrentCharacter, blob);
    const data = collectSheetData();               // keep any in-progress form edits
    data.portraitVer = Date.now();
    sheetCurrentData = data;
    await saveSheet(sheetCurrentCharacter, data);
    refreshPortrait();
    if(typeof showToast === 'function') showToast('Portrait updated');
  } catch(err){
    console.error('Portrait upload failed', err);
    setHint('Upload failed — try again.');
    if(typeof showToast === 'function') showToast('Portrait upload failed');
  }
}


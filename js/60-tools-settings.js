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
// The Sheets button jumps straight to the active character's sheet. Choosing
// *which* character you are is the job of the "Playing as" control
// (changeIdentity → showIdentityModal), so Sheets no longer shows its own
// character picker. With no character selected yet, hand off to that chooser.
function openSheetMenu(){
  // Referee: open a sheet straight away with the character picker at the top,
  // so they can flip between any character's sheet from the dropdown. Default to
  // whoever they're viewing as, else the first known character.
  if(isReferee()){
    const first = (typeof crewRoster === 'function' && crewRoster().length) ? crewRoster()[0] : null;
    const target = myIdentity || first;
    if(target){ openSheet(target); return; }
  }
  if(myIdentity){ openSheet(myIdentity); return; }
  showIdentityModal();
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

  // ── Help — replay the walkthrough (role-aware: referee or player) ──
  html += `
    <div class="settings-section-lbl">Help</div>
    <div class="settings-row" style="cursor:pointer" onclick="closeSettingsMenu();startWalkthrough()">
      <span class="settings-row-label">🧭 Take the tour</span>
      <span style="font-size:9px;color:var(--tx1);font-family:monospace">walkthrough →</span>
    </div>`;

  // Phone-only: re-enable referee mode on this handset. Phones default to the
  // player view (the map lives on the table display, referee chrome is hidden).
  if(document.documentElement.classList.contains('is-phone')){
    const phoneRefOn = phoneRefereeEnabled();
    html += `
    <div class="settings-row">
      <span class="settings-row-label">🎲 Referee mode on this phone</span>
      <div class="theme-toggle${phoneRefOn ? ' on' : ''}" onclick="togglePhoneReferee()"><div class="theme-toggle-knob"></div></div>
    </div>
    <div class="settings-row" style="font-size:11px;color:var(--tx1)">Off by default — phones show the player view and the galaxy map is on the table display. Turn on to use the full referee tools on this device.</div>`;
  }

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

  // ── Network Lock + Player Access (TASK 6 / TASK 7) — referee token required ──
  // These are served through the referee-only get-content path (secureNetworkLock
  // / securePlayers), so they render ONLY for a token-authenticated referee. A
  // local-mode referee is prompted to apply their token.
  if(secureRole === 'referee'){
    const nl = (typeof secureNetworkLock !== 'undefined') ? secureNetworkLock : null;
    const on = !!(nl && nl.enabled && nl.active);
    const btnBase = 'width:100%;padding:8px;border-radius:var(--rad);font-size:12px;cursor:pointer;font-weight:700';
    html += `<div class="settings-section-lbl">Network Lock</div>
      <div class="settings-row">
        <button onclick="setNetworkLock(${on ? 'false' : 'true'})" style="${btnBase};background:${on ? 'var(--accentGoldBg)' : 'var(--bg2)'};border:1px solid ${on ? 'var(--accentGold)' : 'var(--bd0)'};color:${on ? 'var(--accentGold)' : 'var(--tx0)'}">${on ? '🔒 Locked to this network — tap to unlock' : '🔓 Off — tap to lock to this network'}</button>
      </div>`;
    if(nl && nl.enabled && nl.active){
      html += `<div class="settings-row" style="font-size:11px;color:var(--tx1)">Locked to <b style="color:var(--tx0)">${escHtml(nl.pinned_ip || '?')}</b> · auto-unlocks 12h after pinning. Players off this network are blocked.</div>`;
    } else if(nl && nl.enabled && !nl.active){
      html += `<div class="settings-row" style="font-size:11px;color:#e8a0a0">Lock expired (12h break-glass) — no one is blocked now. Tap to re-pin to your current network.</div>`;
    } else {
      html += `<div class="settings-row" style="font-size:11px;color:var(--tx1)">Off — anyone with a token connects from any network. Enabling pins your current public IP${nl && nl.current_ip ? ' (<b style="color:var(--tx0)">' + escHtml(nl.current_ip) + '</b>)' : ''}; mobile-data / VPN players get blocked.</div>`;
    }

    html += `<div class="settings-section-lbl">Player access</div>`;
    const players = (typeof securePlayers !== 'undefined') ? securePlayers : null;
    if(!players){
      html += `<div class="settings-row" style="font-size:11px;color:var(--tx1)">Player tokens load with your referee content — reconnect your referee token to list them.</div>`;
    } else if(!players.length){
      html += `<div class="settings-row" style="font-size:11px;color:var(--tx1)">No players registered yet.</div>`;
    } else {
      const chip = 'flex:1;padding:6px;background:var(--bg2);border:1px solid var(--bd0);color:var(--tx0);border-radius:var(--rad);font-size:11px;cursor:pointer';
      players.forEach((p, i) => {
        const roleTag = p.role === 'referee' ? ' <span style="color:var(--accentGold);font-size:10px">(referee)</span>' : '';
        const shareBtn = (typeof navigator !== 'undefined' && navigator.share) ? `<button onclick="sharePlayerToken(${i})" style="${chip}">Share</button>` : '';
        html += `<div class="settings-row" style="flex-direction:column;align-items:stretch;gap:5px;border-top:1px solid var(--bd0);padding-top:7px">
          <div style="font-weight:700;color:var(--tx0);font-size:12px">${escHtml(p.identity || '—')}${roleTag}</div>
          <div id="pv-tok-${i}" style="font-family:monospace;font-size:11px;color:var(--tx1);word-break:break-all">••••••••••••</div>
          <div style="display:flex;gap:6px">
            <button onclick="revealPlayerToken(${i})" style="${chip}">Reveal</button>
            <button onclick="copyPlayerToken(${i})" style="${chip}">Copy</button>
            ${shareBtn}
          </div>
        </div>`;
      });
    }
  } else if(typeof isReferee === 'function' && isReferee()){
    html += `<div class="settings-section-lbl">Network Lock &amp; Player Access</div>
      <div class="settings-row" style="font-size:11px;color:var(--tx1)">Apply your <b>referee token</b> above to lock the campaign to your network and hand out player tokens.</div>`;
  }

  // ── Rulebook Library (referee) — BYO PDFs for page-reference deep links.
  // Defined in js/92 (loads later); menus render at open time, so guard only.
  if(typeof rulebookLibraryHTML === 'function') html += rulebookLibraryHTML();

  // ── Table Display control cluster (referee) — defined in js/93 (loads later);
  // renders '' for players, in display mode, and on file:// builds.
  if(typeof tableDisplaySettingsHTML === 'function') html += tableDisplaySettingsHTML();

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
// ── "More" overflow menu (Library Data · Wiki · Contacts · Standing ·
//    Downtime · Imperial Calendar, plus ref-only Economy & Session) ──────────
// Now holds player-facing tools too, so it's open to everyone. The ref-only
// items inside auto-hide for players via the .ref-only / #root.pm-active rules.
function openMoreMenu(){
  const m = document.getElementById('more-menu');
  if(m) m.classList.remove('hidden');
}
function closeMoreMenu(){
  const m = document.getElementById('more-menu');
  if(m) m.classList.add('hidden');
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
  // Referee handle from setup (per-device, never shared) — shown for orientation.
  let refName = ''; try { refName = localStorage.getItem('aurelia_referee_name') || ''; } catch(e){}
  const refNameRow = refName ? `
    <div class="settings-row" style="pointer-events:none;padding-bottom:2px">
      <span class="settings-row-label" style="color:var(--tx1);font-weight:400">Signed in as <b style="color:var(--accentGold)">${escHtml(refName)}</b></span>
    </div>` : '';
  // Preview-as-player: identities come from the token roster (players only) when
  // available, else the known campaign characters. Entering exits Design Mode and
  // renders the whole app through that player's visibility (reveals + redaction).
  const previewNames = (typeof securePlayers !== 'undefined' && Array.isArray(securePlayers) && securePlayers.length)
    ? securePlayers.filter(p => p && p.role !== 'referee' && p.identity).map(p => p.identity)
    : ((typeof KNOWN_CHARACTERS !== 'undefined') ? KNOWN_CHARACTERS.slice() : []);
  const previewSection = `
    <div class="archon-divider"></div>
    <div class="settings-section-lbl">👁 Preview as player</div>
    <div class="se-note" style="padding:0 2px 6px">See the map exactly as a player does — reveals, redaction and spoiler regions applied. Design Mode turns off; exit from the banner.</div>
    ${previewNames.map(nm => `
    <div class="settings-row" style="cursor:pointer" onclick="closeRefereeMenu();enterPlayerPreview('${String(nm).replace(/'/g,"\\'")}')">
      <span class="settings-row-label">As ${escHtml(nm)}</span>
      <span style="font-size:9px;color:var(--tx1);font-family:monospace">preview →</span>
    </div>`).join('')}
    <div class="settings-row" style="cursor:pointer" onclick="closeRefereeMenu();enterPlayerPreview('')">
      <span class="settings-row-label">As a generic player</span>
      <span style="font-size:9px;color:var(--tx1);font-family:monospace">preview →</span>
    </div>`;
  card.innerHTML = `
    <div class="settings-section-lbl">${(typeof TERM==='function'?TERM('referee'):'Referee')} Tools</div>
    ${refNameRow}
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
    ${previewSection}
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
    <div class="settings-section-lbl">Setup &amp; Help</div>
    <div class="settings-row" style="cursor:pointer" onclick="closeRefereeMenu();openSetupWizard()">
      <span class="settings-row-label">⚙ Campaign Setup</span>
      <span style="font-size:9px;color:var(--tx1);font-family:monospace">wizard →</span>
    </div>
    <div class="settings-row" style="cursor:pointer" onclick="closeRefereeMenu();openSetupHealth()">
      <span class="settings-row-label">🩺 Setup health</span>
      <span style="font-size:9px;color:var(--tx1);font-family:monospace">check →</span>
    </div>
    <div class="settings-row" style="cursor:pointer" onclick="closeRefereeMenu();startRefereeWelcome()">
      <span class="settings-row-label">🧭 Take the tour</span>
      <span style="font-size:9px;color:var(--tx1);font-family:monospace">walkthrough →</span>
    </div>
    <div class="settings-row" style="cursor:pointer" onclick="closeRefereeMenu();openHelpTopics()">
      <span class="settings-row-label">📖 Referee guide</span>
      <span style="font-size:9px;color:var(--tx1);font-family:monospace">deep dives →</span>
    </div>
    <div class="archon-divider"></div>
    ${renderArchonSectionHTML()}`;
}

// Re-run the first-run setup wizard (setup.html) to edit this campaign's backend,
// access codes, players and the deployable config.js. A deliberate full navigation
// — the wizard's "Enter the app" button returns here. Non-destructive: the wizard
// pre-loads saved answers (and, on a deployed device, seeds from config.js).
function openSetupWizard(){ location.href = 'setup.html'; }

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
    <div class="settings-row" style="cursor:pointer" onclick="closeDesignMenu();openDesignEditsIndex()">
      <span class="settings-row-label">🧭 My Design Edits</span>
      <span style="font-size:9px;color:var(--tx1);font-family:monospace">→</span>
    </div>
    <div class="settings-row" style="cursor:pointer" onclick="closeDesignMenu();openRemovedItemsPanel()">
      <span class="settings-row-label">🗑 Show Removed Items</span>
      <span style="font-size:9px;color:var(--tx1);font-family:monospace">→</span>
    </div>
    <div class="settings-row" style="cursor:pointer" onclick="closeDesignMenu();exportDesignLayer()">
      <span class="settings-row-label">⬇ Export Design Layer</span>
      <span style="font-size:9px;color:var(--tx1);font-family:monospace">JSON →</span>
    </div>
    <div class="settings-row" style="cursor:pointer" onclick="closeDesignMenu();importDesignLayer()">
      <span class="settings-row-label">⬆ Import Design Layer</span>
      <span style="font-size:9px;color:var(--tx1);font-family:monospace">← JSON</span>
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
      ? escHtmlBr(text)
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

// Toggle referee mode on this phone (per-device, stored in aurelia_phone_ref).
// Reloads so role gating — isReferee(), the pm-active CSS lock, and the baked
// referee views — re-applies cleanly at boot (same pattern as token apply/clear).
function togglePhoneReferee(){
  const on = !phoneRefereeEnabled();
  try {
    if(on) localStorage.setItem('aurelia_phone_ref', '1');
    else localStorage.removeItem('aurelia_phone_ref');
  } catch(e){}
  location.reload();
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
  // Referee sheet picker: swap the static title for a dropdown of every known
  // character so the referee can jump between sheets without closing the modal.
  // Players only ever see their own sheet, so the picker stays hidden for them.
  const picker = document.getElementById('sheet-char-picker');
  if(picker){
    if(isReferee()){
      const eatt = (typeof escAttr === 'function') ? escAttr : (x => String(x == null ? '' : x));
      const ea = (typeof escHtml === 'function') ? escHtml : (x => String(x == null ? '' : x));
      const names = (typeof crewRoster === 'function' ? crewRoster().slice() : []);
      if(characterName && !names.includes(characterName)) names.unshift(characterName);   // include a one-off (e.g. an NPC) name
      picker.innerHTML = names.map(n => `<option value="${eatt(n)}"${n === characterName ? ' selected' : ''}>${ea(n)}</option>`).join('');
      picker.value = characterName;
      picker.classList.remove('hidden');
      title.classList.add('hidden');
    } else {
      picker.classList.add('hidden');
      title.classList.remove('hidden');
    }
  }
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

// ── Injury & recovery (MgT2e healing rules — bookkeeping & display only) ────
// Tracks characteristic damage per character and shows the RAW recovery maths
// against the Imperial calendar. The app never rolls: Medic checks and their
// Effects happen at the table and the referee applies the points by hand via
// the steppers. Stored inside the character's sheet blob as `injury`, so it
// syncs with the sheet and needs no new keys.
//   injury = { dmg:{str,dex,end}, mode:'none'|'natural'|'medcare',
//              doctorMedic, needSurgery, notes }
function emptyInjury(){ return { dmg:{ str:0, dex:0, end:0 }, mode:'none', doctorMedic:0, needSurgery:false, notes:'' }; }
function sheetInjury(data){
  const inj = (data && data.injury) || {};
  return {
    dmg: Object.assign({ str:0, dex:0, end:0 }, inj.dmg || {}),
    mode: (inj.mode === 'natural' || inj.mode === 'medcare') ? inj.mode : 'none',
    doctorMedic: parseInt(inj.doctorMedic) || 0,
    needSurgery: !!inj.needSurgery,
    notes: inj.notes || ''
  };
}
// All the RAW-derived numbers in one place (Core 2022 pp. 82–83):
//  • damage applies END-first at the table; here we just track per-stat totals
//  • STR or DEX at 0 → unconscious; all three physical at 0 → dead
//  • natural healing: 1D + END DM per day (avg 3.5); if surgery is still
//    required, END DM only per day — may never heal, or worsen
//  • medical care: 3 + patient END DM + doctor's Medic per day, split evenly
//  • DMs recalculate while damaged — rates use the CURRENT (damaged) END DM
function injuryCalc(data){
  const inj = sheetInjury(data);
  const cur = {}, max = {};
  ['str','dex','end'].forEach(k => {
    max[k] = parseInt(data[k]) || 0;
    inj.dmg[k] = Math.max(0, Math.min(parseInt(inj.dmg[k]) || 0, max[k]));
    cur[k] = max[k] - inj.dmg[k];
  });
  const totalDmg = inj.dmg.str + inj.dmg.dex + inj.dmg.end;
  const endDM = charDM(cur.end);
  const dead = totalDmg > 0 && cur.str <= 0 && cur.dex <= 0 && cur.end <= 0;
  const unconscious = !dead && totalDmg > 0 && (cur.str <= 0 || cur.dex <= 0);
  const allThree = inj.dmg.str > 0 && inj.dmg.dex > 0 && inj.dmg.end > 0;
  let rate = 0, rateLbl = '';
  if(inj.mode === 'natural'){
    if(inj.needSurgery){ rate = endDM; rateLbl = `END DM only (surgery still required): ${endDM >= 0 ? '+' : ''}${endDM}/day`; }
    else { rate = 3.5 + endDM; rateLbl = `1D + END DM (${endDM >= 0 ? '+' : ''}${endDM}) ≈ ${rate.toFixed(1)}/day — roll the 1D at the table`; }
  } else if(inj.mode === 'medcare'){
    rate = 3 + endDM + inj.doctorMedic;
    rateLbl = `3 + END DM (${endDM >= 0 ? '+' : ''}${endDM}) + Medic ${inj.doctorMedic} = ${rate}/day, split evenly`;
  }
  let expected = null, expectedDays = 0, never = false;
  if(totalDmg > 0 && inj.mode !== 'none'){
    if(rate <= 0) never = true;
    else { expectedDays = Math.ceil(totalDmg / rate); try { expected = addImperialDays(imperialDate, expectedDays); } catch(e){} }
  }
  return { inj, cur, max, totalDmg, endDM, dead, unconscious, allThree, rate, rateLbl, expected, expectedDays, never };
}
function injurySectionHTML(data){
  const c = injuryCalc(data);
  const eh = (typeof escHtml === 'function') ? escHtml : (x => String(x == null ? '' : x));
  const bar = (typeof healthBarHTML === 'function') ? healthBarHTML : (() => '');
  const COLS = { str:'#C0392B', dex:'#4A90D9', end:'#4CAF50' };   // matches the NPC damage bars (js/45)
  const rows = ['str','dex','end'].map(k => `
    <div class="inj-row">
      ${bar(k.toUpperCase(), c.cur[k], c.max[k], COLS[k])}
      <span class="inj-dm">DM ${charDM(c.cur[k]) >= 0 ? '+' : ''}${charDM(c.cur[k])}</span>
      <button class="init-btn" onclick="injuryAdjust('${k}',1)" title="Take 1 more ${k.toUpperCase()} damage">−1</button>
      <button class="init-btn" onclick="injuryAdjust('${k}',-1)" title="Heal 1 ${k.toUpperCase()} (points from a table-rolled Medic check or daily care)">+1</button>
    </div>`).join('');
  let banner = '';
  if(c.dead) banner = '<div class="hp-status-banner dead" style="position:static;margin-bottom:6px">DEAD — all three physical characteristics at 0</div>';
  else if(c.unconscious) banner = '<div class="hp-status-banner downed" style="position:static;margin-bottom:6px">UNCONSCIOUS — STR or DEX at 0 · END check each minute to wake (cumulative +1 per failure)</div>';
  let recovery = '';
  if(c.totalDmg > 0){
    const modeSel = `<select class="inj-sel" onchange="injurySet('mode', this.value)">
      <option value="none"${c.inj.mode === 'none' ? ' selected' : ''}>No care set</option>
      <option value="natural"${c.inj.mode === 'natural' ? ' selected' : ''}>Natural healing (full rest)</option>
      <option value="medcare"${c.inj.mode === 'medcare' ? ' selected' : ''}>Medical care (hospital/sickbay + bed rest)</option>
    </select>`;
    const medicIn = c.inj.mode === 'medcare' ? `<label class="inj-lbl">Doctor's Medic <input type="number" inputmode="numeric" value="${c.inj.doctorMedic}" onchange="injurySet('doctorMedic', this.value)"></label>` : '';
    const surgery = `<label class="inj-lbl inj-chk"><input type="checkbox"${c.inj.needSurgery ? ' checked' : ''} onchange="injurySet('needSurgery', this.checked)"> Surgery still required</label>`;
    let eta = '';
    if(c.inj.mode === 'none') eta = '<div class="inj-hint">Set a recovery regime to see the expected date.</div>';
    else if(c.never) eta = `<div class="inj-hint" style="color:#e08040">⚠ No recovery at ${c.rate >= 0 ? '+' : ''}${(+c.rate.toFixed(1))}/day — ${c.inj.needSurgery ? 'surgery is needed first' : 'needs better care'}${c.rate < 0 ? ' (worsens daily)' : ''}.</div>`;
    else if(c.expected) eta = `<div class="inj-eta">Expected recovered by <b>${eh(formatImperial(c.expected))}</b> (~${c.expectedDays} day${c.expectedDays === 1 ? '' : 's'})</div>`;
    let checks = '<div class="inj-hint">First aid (once, within 1 min, medikit): Medic (EDU) — restores Effect points, min 1, split as desired.</div>';
    if(c.allThree) checks += '<div class="inj-hint" style="color:#e08040">All three characteristics damaged — surgery before medical care: Medic (EDU) in a hospital/sickbay; a failed check costs 3 + Effect more points.</div>';
    checks += '<div class="inj-hint">Augments: Medic checks take −(facility TL − implant TL). Mental (INT/EDU) damage heals 1 point/day each. All checks roll at the table.</div>';
    recovery = `<div class="inj-recover">
      <div class="inj-ctl-row">${modeSel}${medicIn}${surgery}</div>
      <div class="inj-rate">${c.inj.mode !== 'none' ? eh(c.rateLbl) : ''}</div>
      ${eta}${checks}
      <textarea class="sheet-textarea" rows="2" placeholder="Surgery / augment / treatment notes…" onchange="injurySet('notes', this.value)">${eh(c.inj.notes)}</textarea>
    </div>`;
  } else {
    recovery = '<div class="inj-hint">Uninjured. Damage applies to END first, overflow to STR or DEX (character’s choice) — use −1 on the stat that takes it.</div>';
  }
  return `<div class="sheet-section-lbl">Injury &amp; Recovery${c.totalDmg > 0 ? ` <span class="inj-count">−${c.totalDmg}</span>` : ''}</div>${banner}${rows}${recovery}`;
}
function renderInjurySection(){
  const el = document.getElementById('sheet-injury-sec');
  if(el) el.innerHTML = injurySectionHTML(collectSheetData());
}
function injuryAdjust(stat, delta){
  if(!sheetCurrentCharacter || !sheetCurrentData) return;
  const data = collectSheetData();
  const inj = sheetInjury(data);
  const max = parseInt(data[stat]) || 0;
  inj.dmg[stat] = Math.max(0, Math.min(max, (parseInt(inj.dmg[stat]) || 0) + delta));
  data.injury = inj; sheetCurrentData = data;
  saveSheet(sheetCurrentCharacter, data);
  renderInjurySection();
}
function injurySet(field, value){
  if(!sheetCurrentCharacter || !sheetCurrentData) return;
  const data = collectSheetData();
  const inj = sheetInjury(data);
  if(field === 'mode') inj.mode = value;
  else if(field === 'doctorMedic') inj.doctorMedic = parseInt(value) || 0;
  else if(field === 'needSurgery') inj.needSurgery = !!value;
  else if(field === 'notes') inj.notes = value;
  data.injury = inj; sheetCurrentData = data;
  saveSheet(sheetCurrentCharacter, data);
  renderInjurySection();
}

// ── Task-check cheat card (display only — no roller, nothing resolves) ─────
// One row per skill on the sheet, precomputing skill level + characteristic DM
// for EVERY characteristic (2e leaves the pairing to the referee per task, so
// showing all six covers Pilot+DEX just as well as Pilot+INT), plus an
// unskilled row (DM−3, reduced by Jack-of-All-Trades per RAW) and the
// difficulty ladder. "Roll Pilot" never involves arithmetic again.
const TASK_LADDER = [['Simple','2+'],['Easy','4+'],['Routine','6+'],['Average','8+'],['Difficult','10+'],['Very Difficult','12+'],['Formidable','14+'],['Impossible','16+']];   // Core 2022 p. 59
// Free-text skills → [{name, level}]. Accepts "Pilot (Spacecraft) 2, Streetwise 1"
// and newline lists; a skill with no number is level 0.
function parseSheetSkills(text){
  return String(text || '').split(/[,\n;]+/).map(s => s.trim()).filter(Boolean).map(s => {
    const m = s.match(/^(.*?)[\s:]*(\d+)$/);
    return m ? { name: m[1].trim(), level: parseInt(m[2], 10) } : { name: s, level: 0 };
  }).filter(x => x.name);
}
function taskCardHTML(data){
  const eh = (typeof escHtml === 'function') ? escHtml : (x => String(x == null ? '' : x));
  const attrs = sheetAttrKeys();
  const dms = attrs.map(a => charDM(parseInt(data[a.key]) || 0));
  const skills = parseSheetSkills(data.skills);
  const fmt = n => (n >= 0 ? '+' : '−') + Math.abs(n);
  const jot = skills.find(s => /^jack[\s-]?of[\s-]?all[\s-]?trades/i.test(s.name));
  const unskilled = Math.min(0, -3 + (jot ? jot.level : 0));
  const head = `<tr><th></th>${attrs.map(a => `<th>${eh(a.label)}</th>`).join('')}</tr>`;
  const rows = skills.map(s =>
    `<tr><td>${eh(s.name)} <span class="tc-lvl">${s.level}</span></td>${dms.map(dm => `<td>${fmt(s.level + dm)}</td>`).join('')}</tr>`).join('');
  const unskilledRow = `<tr class="tc-unskilled"><td>Unskilled <span class="tc-lvl">${fmt(unskilled)}</span>${jot ? ' <span class="tc-lvl">(JoT)</span>' : ''}</td>${dms.map(dm => `<td>${fmt(unskilled + dm)}</td>`).join('')}</tr>`;
  const ladder = TASK_LADDER.map(([n, t]) => `<span class="tc-diff${n === 'Average' ? ' avg' : ''}">${n} <b>${t}</b></span>`).join('');
  return `
    <div class="tc-note">2D + the number below ≥ target. The referee picks which characteristic fits the task — dice stay at the table.</div>
    ${skills.length
      ? `<table class="tc-table"><thead>${head}</thead><tbody>${rows}${unskilledRow}</tbody></table>`
      : '<div class="tc-note">List skills above (e.g. “Pilot (Spacecraft) 2, Streetwise 1”) and the card fills itself in.</div>'}
    <div class="tc-ladder">${ladder}</div>`;
}
function renderTaskCard(){
  const el = document.getElementById('sheet-taskcard');
  if(el) el.innerHTML = taskCardHTML(collectSheetData());
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
    <div class="sheet-section" id="sheet-injury-sec">${injurySectionHTML(data)}</div>
    <div class="sheet-section">
      <div class="sheet-section-lbl">Skills</div>
      <textarea class="sheet-textarea" id="sheet-f-skills" oninput="renderTaskCard()" placeholder="e.g. Pilot (Spacecraft) 2, Gun Combat (Slug) 1, Streetwise 1...">${data.skills||''}</textarea>
    </div>
    <div class="sheet-section">
      <div class="sheet-section-lbl">Task-check card</div>
      <div id="sheet-taskcard">${taskCardHTML(data)}</div>
    </div>
    ${renderInventorySection(sheetCurrentCharacter)}
    <div class="sheet-section">
      <div class="sheet-section-lbl">Notes</div>
      <textarea class="sheet-textarea" id="sheet-f-notes" placeholder="Anything else worth tracking...">${data.notes||''}</textarea>
    </div>
    <div class="sheet-section" style="text-align:right">
      <button class="cal-add-btn" style="width:auto;display:inline-block;padding:7px 14px" onclick="printCharacterSheet()">🖨 Print / save as PDF</button>
    </div>
  `;
}

// ── Printable character sheet ────────────────────────────────────────────────
// Builds a clean, self-contained print document (own inline styles) and opens it
// in a new window for the browser's native Print / "Save as PDF". A paper backup
// + player takeaway + wifi-out fallback. Pure builder so it's testable without a
// window; no index.html / css/app.css footprint.
function buildCharacterSheetHTML(name, data){
  data = data || {};
  const _escRaw = (typeof escHtml === 'function') ? escHtml : null;   // escHtml expects a string
  const esc = x => { const str = String(x == null ? '' : x); return _escRaw ? _escRaw(str) : str.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); };
  const fmt = (typeof fmtCr === 'function') ? fmtCr : (n => 'Cr' + (n || 0));
  const chars = sheetAttrKeys().map(a => {
    const v = (data[a.key] != null ? data[a.key] : '');
    const dm = charDM(v);
    return `<tr><td>${esc(a.label)}</td><td class="c">${esc(v)}</td><td class="c">${dm >= 0 ? '+' : ''}${dm}</td></tr>`;
  }).join('');
  const statusFx = (typeof pkStatusFx === 'function') ? pkStatusFx() : TRAVELLER_STATUS_FX;
  const activeIds = Array.isArray(data.status) ? data.status : [];
  const statusNames = activeIds.map(id => { const fx = statusFx.find(f => f.id === id); return fx ? (fx.ico + ' ' + fx.name) : id; });
  const items = (typeof invItemsFor === 'function') ? invItemsFor(name) : [];
  const invRows = items.map(it => {
    const s = it.snapshot || {};
    const nm = (it.state && it.state.customName) || s.name || 'Item';
    const q = Number(it.qty) || 1, mass = Number(s.mass) || 0;
    const tags = [it.equipped ? 'worn/equipped' : '', it.stowed ? 'stowed' : ''].filter(Boolean).join(', ');
    return `<tr><td>${esc(nm)}${q > 1 ? ' ×' + q : ''}</td><td>${esc(s.category || 'gear')}</td><td class="c">${mass}kg</td><td>${esc(tags)}</td></tr>`;
  }).join('');
  let enc = null; try { if(typeof encStatus === 'function') enc = encStatus(name); } catch(e){}
  const purse = (typeof purseOf === 'function') ? purseOf(name) : 0;
  const party = (typeof funds !== 'undefined' && funds) ? (Number(funds.party) || 0) : 0;
  const portrait = (typeof portraitUrlFor === 'function' && data.portraitVer) ? portraitUrlFor(name, data.portraitVer) : '';
  const encTxt = enc ? ` — ${enc.carried}${enc.cap ? ('/' + enc.cap) : ''} kg · ${enc.level}` + (enc.dm ? ` (DM ${enc.dm >= 0 ? '+' : ''}${enc.dm})` : '') : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)} — Character Sheet</title>
<style>
  *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:24px;font-size:12px}
  h1{font-size:20px;margin:0 0 2px} .sub{color:#666;margin:0 0 14px;font-size:12px}
  .row{display:flex;gap:20px;align-items:flex-start} .col{flex:1}
  h2{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#333;border-bottom:1.5px solid #333;padding-bottom:3px;margin:16px 0 8px}
  table{width:100%;border-collapse:collapse;font-size:12px} td,th{padding:3px 6px;border-bottom:1px solid #ddd;text-align:left} td.c,th.c{text-align:center}
  .chars td:first-child{font-weight:600} .pill{display:inline-block;border:1px solid #999;border-radius:10px;padding:1px 8px;margin:2px 3px 2px 0;font-size:11px}
  .muted{color:#666} .wrap{white-space:pre-wrap} .port{width:88px;height:88px;object-fit:cover;border:1px solid #999;border-radius:6px}
  @media print{ body{margin:0} }
</style></head><body onload="try{window.focus();setTimeout(function(){window.print();},300);}catch(e){}">
  <div class="row">
    ${portrait ? `<img class="port" src="${esc(portrait)}" alt="">` : ''}
    <div class="col"><h1>${esc(name)}</h1><p class="sub">${data.age ? ('Age ' + esc(data.age) + ' · ') : ''}Traveller · Archon Gambit</p></div>
  </div>
  <div class="row">
    <div class="col">
      <h2>Characteristics</h2>
      <table class="chars"><thead><tr><th>Stat</th><th class="c">Score</th><th class="c">DM</th></tr></thead><tbody>${chars}</tbody></table>
      <h2>Funds</h2>
      <table><tbody><tr><td>${esc(name)} · purse</td><td class="c">${fmt(purse)}</td></tr><tr><td>Party fund</td><td class="c">${fmt(party)}</td></tr></tbody></table>
    </div>
    <div class="col">
      <h2>Skills</h2>
      <div class="wrap">${esc(data.skills || '—')}</div>
      <h2>Conditions</h2>
      <div>${statusNames.length ? statusNames.map(n => `<span class="pill">${esc(n)}</span>`).join('') : '<span class="muted">None</span>'}</div>
    </div>
  </div>
  <h2>Inventory<span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">${encTxt}</span></h2>
  ${invRows ? `<table><thead><tr><th>Item</th><th>Category</th><th class="c">Mass</th><th>Worn/Stowed</th></tr></thead><tbody>${invRows}</tbody></table>` : '<div class="muted">No items.</div>'}
  <h2>Notes</h2>
  <div class="wrap">${esc(data.notes || '—')}</div>
</body></html>`;
}
function printCharacterSheet(){
  const name = (typeof sheetCurrentCharacter !== 'undefined') ? sheetCurrentCharacter : null;
  if(!name){ if(typeof showToast === 'function') showToast('Open a character sheet first', 'error'); return; }
  const data = (typeof collectSheetData === 'function') ? collectSheetData() : (sheetCurrentData || {});
  const html = buildCharacterSheetHTML(name, data);
  const w = window.open('', '_blank');
  if(!w){ if(typeof showToast === 'function') showToast('Allow pop-ups to print the sheet', 'error'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

function updateSheetDM(key){
  const input = document.getElementById('sheet-f-' + key);
  const dmEl = document.getElementById('sheet-dm-' + key);
  if(!input || !dmEl) return;
  const dm = charDM(input.value);
  dmEl.textContent = `DM ${dm>=0?'+':''}${dm}`;
  if(key === 'str' || key === 'end') updateEncIndicator();  // live encumbrance as STR/END are edited
  renderTaskCard();          // characteristic DMs feed the task-check card totals
  renderInjurySection();     // and the injury bars' maxima / recovery rates
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
  impView = null;
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
  if(impView && isReferee()){ body.innerHTML = renderImpView(); return; }
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
    const opts = (typeof crewRoster === 'function' ? crewRoster() : []).map(n => `<option value="${eatt(n)}">${ea(n)}</option>`).join('');
    note = `<div class="cat-target">Authoring the shared library · <label>grant to <select class="cat-grant" onchange="if(this.value)catSetTarget(this.value)"><option value="">—</option>${opts}</select></label></div>`;
  } else { note = ''; }
  const chips = ['all'].concat(ITEM_CATEGORIES).map(c =>
    `<button class="cat-chip${catalogueCatFilter === c ? ' on' : ''}" onclick="catSetFilter('${c}')">${c === 'all' ? 'All' : ea(_catLabel(c))}</button>`).join('');
  const newBtn = ref ? `<button class="cat-new-btn" onclick="catAdd()">＋ New item</button>` : '';
  const impBtn = (ref && !catalogueTargetChar) ? `<button class="cat-new-btn" onclick="impOpenImport()">📥 Import</button>` : '';
  return `${note}
    <div class="cat-controls">
      <input id="cat-search" class="cat-search" placeholder="Search items…" value="${eatt(catalogueSearch)}" oninput="catSetSearch(this.value)">
      ${newBtn}${impBtn}
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


// ═══════════════════════════════════════════════════════════════════════════
// RULEBOOK PDF IMPORT  (referee-only; populates the item catalogue)
// ───────────────────────────────────────────────────────────────────────────
// The referee uploads their OWN Mongoose 2e rulebook PDFs (Core Rulebook
// Update 2022, Central Supply Catalogue) and the equipment tables are parsed
// on-device into item-catalogue definitions, previewed, then merged into the
// shared 'item-catalogue' key. Nothing here contains rulebook data: the code
// only knows the *shape* of the stat tables (their column headers) — the
// catalogue still ships empty, and no book content or PDF ever leaves the
// device (pdf.js runs locally; only the referee-approved item stats are saved
// to the campaign's own store, like hand-typed entries).
//
// pdf.js (vendor/pdfjs/, Apache-2.0) is lazy-loaded only when the referee
// opens the importer — it is deliberately NOT in the sw.js SHELL precache.
//
// Parser input page shape: { num: 1-based pdf page, items: [{ str, x, y }] }
// ═══════════════════════════════════════════════════════════════════════════

// Column-header vocabulary → catalogue field. Keys are lower-cased header cells.
const IMP_COLMAP = {
  'tl':'tl', 'cost':'cost', 'kg':'mass', 'mass':'mass', 'tons':'tons',
  'range':'range', 'damage':'damage', 'protection':'protection', 'rad':'rad',
  'magazine':'magazine', 'magazine cost':'magazineCost',
  'power pack cost':'magazineCost', 'pack cost':'magazineCost',
  'traits':'traits', 'improvements':'traits', 'required skill':'skill',
  'processing':'processing', 'slots':'slots', 'str':'reqStr', 'dex':'dex',
  'bandwidth':'bandwidth', 'pistol':'ammoPistol', 'rifle':'ammoRifle',
  'shotgun':'ammoShotgun', 'heavy':'ammoHeavy'
};

// Book profiles keyed on page count — only structural facts (which PDF pages
// belong to which chapter), used to categorise items the headers alone can't.
const IMP_BOOKS = [
  { id:'csc', label:'Central Supply Catalogue', pages:152, itemPages:[11,147],
    skipPages:[[71,77]],            // robot stat blocks, not personal equipment
    augment:[[87,94]], consumable:[[82,86],[139,142]] },
  { id:'crb', label:'Core Rulebook Update 2022', pages:266, itemPages:[98,136],
    augment:[[107,107]], consumable:[] }
];

function impBookFor(numPages){
  return IMP_BOOKS.find(b => b.pages === numPages) || null;
}
function impInRanges(ranges, p){
  return !!(ranges || []).find(r => p >= r[0] && p <= r[1]);
}

// Group raw positioned items into visual lines (y within 2.5pt), x-sorted.
function impLines(rawItems){
  const its = rawItems.filter(i => i.str && i.str.trim() !== '')
    .map(i => ({ str: i.str.trim(), x: i.x, y: i.y }));
  its.sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const lines = [];
  for (const it of its){
    const ln = lines.length && Math.abs(lines[lines.length - 1].y - it.y) < 2.5
      ? lines[lines.length - 1] : null;
    if (ln) ln.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const ln of lines) ln.items.sort((a, b) => a.x - b.x);
  return lines;
}

// Find a table header in a line: the longest contiguous run of IMP_COLMAP
// tokens (must include Cost). The cell just before the run is the name column
// if it reads like a short label rather than prose or a stray value.
function impFindHeader(line){
  let best = null;
  for (let s = 0; s < line.items.length; s++){
    let e = s;
    while (e < line.items.length && IMP_COLMAP[line.items[e].str.toLowerCase()] !== undefined){
      // keep the run x-contiguous: columns in one table sit < 240pt apart
      if (e > s && line.items[e].x - line.items[e - 1].x > 240) break;
      e++;
    }
    const run = line.items.slice(s, e);
    if (run.length >= 2 && run.some(i => i.str.toLowerCase() === 'cost')){
      if (!best || run.length > best.run.length) best = { s, run };
    }
    if (e > s) s = e - 1;
  }
  if (!best) return null;
  const cols = best.run.map(i => ({ x: i.x, field: IMP_COLMAP[i.str.toLowerCase()] }));
  let nameCol = null;
  if (best.s > 0){
    const prev = line.items[best.s - 1];
    const txt = prev.str;
    if (cols[0].x - prev.x < 250 && txt.length <= 26 && !/[.:;]$/.test(txt) &&
        !/^\d\d\/\d+/.test(txt) && /[a-zA-Z]/.test(txt) &&
        !/^(m?cr|kcr)?[\d.,]+m?$/i.test(txt)){
      nameCol = { x: prev.x, field: 'name' };
    }
  }
  // a 2-column stat run is only a header when a name column fronts it
  // (Item | TL | Cost — the augment tables); ≥3 stat columns stand alone
  if (cols.length < 3 && (!nameCol || !cols.some(c => c.field === 'tl'))) return null;
  const nameLabel = nameCol ? line.items[best.s - 1].str.toLowerCase() : '';
  return { y: line.y, cols, nameCol, nameLabel };
}

// Assign a line's items to header columns by x alignment (left-aligned tables).
function impAssign(line, hdr){
  const cols = hdr.nameCol ? [hdr.nameCol].concat(hdr.cols) : hdr.cols;
  const cells = {}; let matched = 0;
  for (const it of line.items){
    let bestC = null, bestD = 3.5;
    for (const c of cols){
      const d = Math.abs(it.x - c.x);
      if (d < bestD){ bestD = d; bestC = c; }
    }
    if (bestC){
      cells[bestC.field] = (cells[bestC.field] ? cells[bestC.field] + ' ' : '') + it.str;
      matched++;
    }
  }
  return { cells, matched };
}

// Extract every table on a page: header + data rows, with wrapped-name,
// subsection-label and TL-variant handling (the Mongoose layouts).
function impTablesOnPage(lines){
  const tables = [];
  for (let li = 0; li < lines.length; li++){
    const hdr = impFindHeader(lines[li]);
    if (!hdr) continue;
    const rows = [];
    let lastY = hdr.y, misses = 0;
    for (let j = li + 1; j < lines.length; j++){
      const ln = lines[j];
      if (impFindHeader(ln)) { if (rows.length) break; else continue; }
      const { cells, matched } = impAssign(ln, hdr);
      const statCount = Object.keys(cells).filter(k => k !== 'name').length;
      const gap = lastY - ln.y;
      if (!matched){
        if (gap > 20) break;
        misses++; if (misses > 6) break;
        continue;
      }
      // subsection labels (PISTOLS, RIFLES …) sit between rows: allow a
      // matched row past the 26pt limit if only a line or two intervened
      if (gap > 26 && !(misses > 0 && gap <= 44 && statCount >= 2)) break;
      if (cells.name !== undefined && statCount >= 2){
        rows.push(cells);
      } else if (cells.name === undefined && statCount >= 3 && rows.length){
        cells.name = rows[rows.length - 1].name;   // TL-variant row of same item
        cells._variant = true;
        rows.push(cells);
      } else if (rows.length){
        const prev = rows[rows.length - 1];        // wrapped name / traits line
        for (const k in cells){
          // guard against two-column prose bleeding into a wrapped name
          if (k === 'name' && (cells[k].length > 32 || /[.:]/.test(cells[k]))) continue;
          const joiner = (k === 'name' && prev[k] && /-$/.test(prev[k])) ? '' : ' ';
          prev[k] = (prev[k] ? prev[k] + joiner : '') + cells[k];
        }
      } else if (cells.name !== undefined && statCount === 0){
        continue;                                   // stray label before data
      } else {
        continue;
      }
      lastY = ln.y; misses = 0;
    }
    if (rows.length) tables.push({ hdr, rows, headerIndex: li });
  }
  return tables;
}

// Nearest ALL-CAPS title line above the header in the same column, plus the
// description prose between them (per-item layout of the CSC).
function impTitleAbove(lines, table){
  const hdr = table.hdr;
  const x0 = (hdr.nameCol || hdr.cols[0]).x;
  let title = null, titleIdx = -1;
  for (let j = table.headerIndex - 1; j >= 0; j--){
    const ln = lines[j];
    if (ln.y - hdr.y > 260) break;
    const first = ln.items[0];
    if (first.x < x0 - 60 || first.x > x0 + 200) continue;
    const txt = ln.items.map(i => i.str).join(' ').trim();
    if (/^\d\d\/\d+/.test(txt)) continue;
    const alpha = txt.replace(/[^a-zA-Z]/g, '');
    if (alpha.length >= 3 && alpha === alpha.toUpperCase()){
      title = txt; titleIdx = j; break;
    }
  }
  if (!title) return { title: null, desc: '' };
  const descLines = [];
  for (let j = titleIdx + 1; j < table.headerIndex; j++){
    const ln = lines[j];
    if (Math.abs(ln.items[0].x - x0) > 32) continue;
    descLines.push(ln.items.filter(i => i.x < x0 + 300).map(i => i.str).join(' '));
  }
  let desc = descLines.join(' ').replace(/\s+/g, ' ').trim();
  if (desc.length > 300) desc = desc.slice(0, 300).replace(/\s+\S*$/, '') + '…';
  return { title, desc };
}

function impTitleCase(s){
  return s.toLowerCase().replace(/(^|[\s\-–—(/])([a-z])/g, (m, p, c) => p + c.toUpperCase());
}
function impParseTL(v){
  if (v == null) return '';
  const m = String(v).match(/(\d+)/);
  return m ? Number(m[1]) : '';
}
function impParseCost(v){
  if (v == null) return { cost: 0, raw: '' };
  const s = String(v).replace(/,/g, '').trim();
  let m = s.match(/^MCr\s*([\d.]+)$/i);
  if (m) return { cost: Math.round(Number(m[1]) * 1e6), raw: '' };
  m = s.match(/^K?Cr\s*([\d.]+)$/i);
  if (m) return { cost: Math.round(Number(m[1]) * (/^k/i.test(s) ? 1000 : 1)), raw: '' };
  if (/^[—–-]$/.test(s) || s === '') return { cost: 0, raw: '' };
  return { cost: 0, raw: s };                       // e.g. 'x3', '+100% of augment'
}
function impParseMass(v, isTons){
  if (v == null) return 0;
  const s = String(v).replace(/,/g, '');
  const m = s.match(/([\d.]+)/);
  if (!m) return 0;
  let kg = Number(m[1]);
  if (isTons || /ton/i.test(s)) kg *= 1000;
  return kg;
}

// One parsed row + context → an item-catalogue definition (matches
// emptyItemDef()'s shape; ids are assigned at confirm time).
function impRowToDef(row, table, pageNum, book, title, desc){
  const h = table.hdr;
  const fields = h.cols.map(c => c.field);
  const isAmmo = fields.indexOf('ammoPistol') !== -1;
  let category = 'gear';
  if (fields.indexOf('protection') !== -1) category = 'armour';
  else if (isAmmo) category = 'consumable';
  else if (fields.indexOf('damage') !== -1) category = 'weapon';
  else if (book && impInRanges(book.augment, pageNum)) category = 'augment';
  if (category === 'gear' && book && impInRanges(book.consumable, pageNum)) category = 'consumable';

  let name = (row.name || '').replace(/\s+/g, ' ').trim();
  if (!name && title) name = impTitleCase(title);
  if (!name) return null;
  if (h.nameLabel === 'toolkits' && !/toolkit/i.test(name)) name += ' Toolkit';
  let tlVal = impParseTL(row.tl);
  // some tables name their rows by TL alone (radio transceivers) — fold the
  // table label back in so the item reads 'Radio Transceivers TL9', not 'TL9'
  const mTL = name.match(/^TL(\d+)\b/);
  if (mTL){
    if (tlVal === '') tlVal = Number(mTL[1]);
    if (h.nameLabel && ['item', 'weapon', 'armour type'].indexOf(h.nameLabel) === -1){
      name = impTitleCase(h.nameLabel) + ' ' + name;
    }
  }
  if (/^[\d.\s]*$/.test(name) || name.length < 2) return null;
  if (row._variant || row._dupName){
    if (tlVal !== '' && !/\bTL\d/.test(name)) name += ' (TL' + tlVal + ')';
  }

  const costP = impParseCost(row.cost);
  const noteBits = [];
  if (book) noteBits.push(book.label + ', p.' + (pageNum - 1));
  if (costP.raw) noteBits.push('Cost: ' + costP.raw);
  if (row.processing) noteBits.push('Processing: ' + row.processing);
  if (row.bandwidth) noteBits.push('Bandwidth: ' + row.bandwidth);
  if (row.slots) noteBits.push('Slots: ' + row.slots);
  if (row.dex) noteBits.push('DEX: ' + row.dex);
  if (isAmmo){
    const per = ['ammoPistol', 'ammoRifle', 'ammoShotgun', 'ammoHeavy']
      .map((k, i) => row[k] && row[k] !== '—' && row[k] !== '-'
        ? ['Pistol', 'Rifle', 'Shotgun', 'Heavy'][i] + ': ' + row[k] : null)
      .filter(Boolean);
    if (per.length) noteBits.push(per.join(' · '));
  }

  const mass = impParseMass(row.mass !== undefined ? row.mass : row.tons,
    row.tons !== undefined);
  const clean = v => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
  return {
    name, category,
    tl: tlVal,
    mass, cost: costP.cost,
    desc: desc || '',
    notes: noteBits.join(' · '),
    range: clean(row.range), damage: clean(row.damage),
    magazine: clean(row.magazine), magazineCost: clean(row.magazineCost),
    traits: clean(row.traits), skill: clean(row.skill),
    protection: clean(row.protection), rad: clean(row.rad),
    reqStr: clean(row.reqStr)
  };
}

// Whole-document parse: pages → deduped item definitions.
function impParseDoc(pages, numPages){
  const book = impBookFor(numPages);
  const out = [];
  const seen = {};                                   // name|tl|category → true
  for (const page of pages){
    if (book && book.itemPages &&
        (page.num < book.itemPages[0] || page.num > book.itemPages[1])) continue;
    if (book && impInRanges(book.skipPages, page.num)) continue;
    const lines = impLines(page.items);
    const tables = impTablesOnPage(lines);
    for (const table of tables){
      // duplicate names inside one table are TL variants — mark them
      const counts = {};
      for (const r of table.rows){
        const n = (r.name || '').trim().toLowerCase();
        if (n) counts[n] = (counts[n] || 0) + 1;
      }
      for (const r of table.rows){
        const n = (r.name || '').trim().toLowerCase();
        if (n && counts[n] > 1) r._dupName = true;
      }
      const needTitle = !table.hdr.nameCol || table.rows.length <= 3;
      const t = needTitle ? impTitleAbove(lines, table) : { title: null, desc: '' };
      for (const row of table.rows){
        const def = impRowToDef(row, table, page.num, book, t.title,
          table.hdr.nameCol && table.rows.length > 3 ? '' : t.desc);
        if (!def) continue;
        const key = def.name.toLowerCase() + '|' + def.tl + '|' + def.category;
        if (seen[key]) continue;
        seen[key] = true;
        out.push(def);
      }
    }
  }
  return { book, items: out };
}

// ── pdf.js lazy loader (vendored; not in the SHELL precache) ────────────────
let impPdfJsPromise = null;
function impEnsurePdfJs(){
  if (typeof pdfjsLib !== 'undefined') return Promise.resolve();
  if (impPdfJsPromise) return impPdfJsPromise;
  impPdfJsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/pdfjs/pdf.min.js';
    s.onload = () => {
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
        resolve();
      } catch(e){ impPdfJsPromise = null; reject(e); }
    };
    s.onerror = () => {
      impPdfJsPromise = null;
      reject(new Error('Could not load the PDF engine — it downloads once, so check your connection and try again.'));
    };
    document.head.appendChild(s);
  });
  return impPdfJsPromise;
}

async function impParsePdfFile(file, onProgress){
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++){
    const pg = await doc.getPage(p);
    const tc = await pg.getTextContent();
    pages.push({ num: p, items: tc.items.map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5] })) });
    if (onProgress && (p % 10 === 0 || p === doc.numPages)) onProgress(p, doc.numPages);
  }
  const res = impParseDoc(pages, doc.numPages);
  try { doc.destroy(); } catch(e){}
  return res;
}

// ── Import UI (rendered inside #catalogue-body) ─────────────────────────────
// impView: null | { phase:'pick'|'parsing'|'preview', err, items, srcLabels }
let impView = null;

function impOpenImport(){
  if(!isReferee()) return;
  impView = { phase:'pick' };
  renderCatalogueModal();
}
function impCancel(){
  impView = null;
  renderCatalogueModal();
}

function renderImpView(){
  const ea = (typeof escQH === 'function') ? escQH : (x => String(x == null ? '' : x));
  if(impView.phase === 'pick'){
    const err = impView.err ? `<div class="cat-empty" style="border-color:var(--txD);color:var(--txD)">${ea(impView.err)}</div>` : '';
    return `${err}
      <div class="imp-intro">Import equipment from your own rulebook PDFs. The book is read
        entirely on this device — the PDF itself is never uploaded or stored, and the catalogue
        only receives the item entries you approve on the next screen.<br><br>
        Tuned for the <b>Core Rulebook Update 2022</b> and the <b>Central Supply Catalogue</b> (2016);
        other Mongoose 2e books with standard stat tables will import on a best-effort basis.</div>
      <div class="imp-file"><input type="file" accept=".pdf,application/pdf" multiple onchange="impFilesPicked(this)"></div>
      <div class="cat-controls"><button class="cat-new-btn" onclick="impCancel()">‹ Back to catalogue</button></div>`;
  }
  if(impView.phase === 'parsing'){
    return `<div class="imp-progress" id="imp-progress">Loading PDF engine…</div>`;
  }
  // preview
  const items = impView.items || [];
  const groups = {};
  items.forEach((it, i) => {
    const c = it.def.category || 'gear';
    (groups[c] = groups[c] || []).push(i);
  });
  const order = ['weapon', 'armour', 'gear', 'augment', 'consumable'];
  const selCount = items.filter(it => it.sel).length;
  const src = (impView.srcLabels || []).join(' + ');
  let html = `<div class="imp-intro">Found <b>${items.length}</b> items${src ? ' in ' + ea(src) : ''}.
    Untick anything you don't want; entries already in the catalogue start unticked.
    Everything stays editable in the catalogue afterwards.</div>`;
  for(const cat of order){
    const idxs = groups[cat]; if(!idxs) continue;
    html += `<div class="imp-group"><b>${ea(_catLabel(cat))} (${idxs.length})</b>
      <button class="imp-mini" onclick="impSelectCat('${cat}',true)">all</button>
      <button class="imp-mini" onclick="impSelectCat('${cat}',false)">none</button></div>`;
    html += idxs.map(i => {
      const it = items[i]; const d = it.def;
      const meta = [];
      if(d.tl !== '' && d.tl != null) meta.push('TL' + ea(String(d.tl)));
      meta.push((Number(d.mass) || 0) + 'kg');
      if(Number(d.cost)) meta.push('Cr' + Number(d.cost).toLocaleString());
      if(d.damage) meta.push(ea(d.damage));
      if(d.protection) meta.push('Prot ' + ea(d.protection));
      const exists = it.exists ? ` <span class="imp-exists">already in catalogue</span>` : '';
      return `<label class="imp-row${it.sel ? '' : ' off'}" id="imp-row-${i}">
        <input type="checkbox" ${it.sel ? 'checked' : ''} onchange="impToggle(${i},this.checked)">
        <span><b>${ea(d.name)}</b>${exists}<br><span class="imp-meta">${meta.join(' · ')}</span></span>
      </label>`;
    }).join('');
  }
  html += `<div class="imp-foot">
    <button class="cat-new-btn" id="imp-add-btn" onclick="impConfirmImport()">Add ${selCount} items</button>
    <button class="cat-new-btn" onclick="impCancel()">Cancel</button>
  </div>`;
  return html;
}

function impToggle(i, on){
  if(!impView || !impView.items || !impView.items[i]) return;
  impView.items[i].sel = !!on;
  const row = document.getElementById('imp-row-' + i);
  if(row) row.classList.toggle('off', !on);
  impUpdateCount();
}
function impSelectCat(cat, on){
  if(!impView || !impView.items) return;
  impView.items.forEach((it, i) => {
    if((it.def.category || 'gear') !== cat) return;
    it.sel = !!on;
    const row = document.getElementById('imp-row-' + i);
    if(row){
      row.classList.toggle('off', !on);
      const cb = row.querySelector('input'); if(cb) cb.checked = !!on;
    }
  });
  impUpdateCount();
}
function impUpdateCount(){
  const btn = document.getElementById('imp-add-btn');
  if(btn && impView && impView.items)
    btn.textContent = 'Add ' + impView.items.filter(it => it.sel).length + ' items';
}

async function impFilesPicked(input){
  const files = Array.prototype.slice.call((input && input.files) || []);
  if(input) input.value = '';
  if(!files.length || !impView) return;
  impView = { phase:'parsing' };
  renderCatalogueModal();
  const prog = t => { const el = document.getElementById('imp-progress'); if(el) el.textContent = t; };
  try {
    await impEnsurePdfJs();
    const all = []; const srcLabels = []; const seen = {};
    for(const f of files){
      prog('Reading ' + f.name + '…');
      const res = await impParsePdfFile(f, (p, n) => prog('Scanning ' + f.name + ' — page ' + p + ' of ' + n));
      srcLabels.push(res.book ? res.book.label : f.name);
      for(const def of res.items){
        const key = def.name.toLowerCase() + '|' + def.tl + '|' + def.category;
        if(seen[key]) continue;
        seen[key] = true;
        all.push(def);
      }
    }
    await loadItemCatalogue();      // freshest copy for the already-there check
    const have = {};
    ITEM_CATALOGUE.forEach(d => { have[(d.name || '').trim().toLowerCase()] = true; });
    const items = all.map(def => {
      const exists = !!have[def.name.trim().toLowerCase()];
      return { def, exists, sel: !exists };
    });
    if(!items.length){
      impView = { phase:'pick', err:'No stat tables found in that PDF — is it a text-based (not scanned) copy of a Mongoose 2e book?' };
    } else {
      impView = { phase:'preview', items, srcLabels };
    }
  } catch(e){
    if(typeof pushErr === 'function') pushErr('PDF import failed: ' + (e && e.message), e && e.stack, { feature:'pdf-import' });
    impView = { phase:'pick', err: (e && e.message) ? e.message : 'Import failed — try again.' };
  }
  renderCatalogueModal();
}

async function impConfirmImport(){
  if(!isReferee() || !impView || impView.phase !== 'preview') return;
  const chosen = impView.items.filter(it => it.sel).map(it => it.def);
  if(!chosen.length){ impCancel(); return; }
  for(const def of chosen){
    const f = footprintFromMass(def.mass);
    ITEM_CATALOGUE.push(Object.assign({}, emptyItemDef(), def, { w:f.w, h:f.h, fpManual:false }));
  }
  await saveItemCatalogue();
  impView = null;
  if(typeof showToast === 'function') showToast('Imported ' + chosen.length + ' items into the catalogue');
  renderCatalogueModal();
}

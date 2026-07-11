// ═══════════════════════════════════════════════════════════════════════════
// CAMPAIGN PACK — the franchise-agnostic engine spine
// ═══════════════════════════════════════════════════════════════════════════
// The app used to BE Archon Gambit: its universe (systems, bodies, meters,
// terminology, world schema, dice) lived in JS constants, and only the
// referee's *edits* were data. This module inverts that. A "Campaign Pack" is
// the portable, referee-owned description of a universe:
//
//   config  — taxonomy, object types, world schema, resolution (dice), the
//             attribute list, meters, terminology map, enabled modules, theme.
//   content — the systems / bodies / locations / stations themselves.
//
// The engine (rendering, Design Mode, panels) is generic code; the pack is
// data. Archon Gambit is now simply the DEFAULT pack — one universe among
// many, not the app. A second referee ships a pack instead of forking code.
//
// LOAD-ORDER CONTRACT (see docs/ARCHITECTURE.md): this file loads right after
// 00-core-data.js. Its TOP-LEVEL statements therefore reference only file 00
// symbols (or none). Every reference to a later-loaded symbol (GALAXY_NODES,
// MAIN, BASE_LOCATIONS, ARCHON_*, TRAVELLER_STATUS_FX, emptySheet…) lives
// inside a function body that is only *called* at boot (initCampaignPacks(),
// invoked from the 85-records.js boot block after all modules have loaded).
//
// Everything reads through pack ACCESSORS (TERM, pkMeters, pkModules, …) that
// fall back to PACK_DEFAULTS until the pack is assembled, so a call during
// early load is always safe and an un-customised deploy behaves identically.

// ── Built-in defaults (the "Traveller / Archon Gambit" profile) ─────────────
// Pure data, safe at top level. buildDefaultPack() later folds in the larger
// tables (meters, status effects) pulled from their existing constants so
// there is still a single source of truth for those.
const PACK_DEFAULTS = {
  // Navigation layers, outermost → innermost. Each tier is a view in the stack.
  taxonomy: [
    { id:'galaxy',  label:'The Orion Arm', short:'Galaxy',  icon:'✦', renderer:'hexMap' },
    { id:'system',  label:'System',        short:'System',  icon:'☉', renderer:'orrery' },
    { id:'body',    label:'World',         short:'World',   icon:'🪐', renderer:'disc'   },
    { id:'station', label:'Station',       short:'Station', icon:'⬡', renderer:'svgMap' },
  ],
  // Object-type registry. `disc` selects one of the built-in disc renderers;
  // a referee-defined type may instead carry `svg` (raw markup) for a custom
  // look. `behaviours` are capability flags the engine understands.
  objectTypes: [
    { id:'star',     label:'Star',            disc:'star',    behaviours:['primary'] },
    { id:'world',    label:'World',           disc:'ocean',   behaviours:['landable','locations'] },
    { id:'ice',      label:'Ice World',       disc:'ice',     behaviours:['landable','locations'] },
    { id:'rock',     label:'Rock World',      disc:'rock',    behaviours:['landable','locations'] },
    { id:'moon',     label:'Moon',            disc:'moon',    behaviours:['landable','locations'] },
    { id:'gasgiant', label:'Gas / Ice Giant', disc:'gasgiant',behaviours:['skimmable'] },
    { id:'belt',     label:'Asteroid Belt',   disc:'belt',    behaviours:['mineable'] },
  ],
  // World-data schema. provider drives the "Random" generator in the body
  // creator: 'traveller-uwp' → WGEN; 'none' → no generation (schema fields are
  // filled by hand). fields describe how a world's stats are shown/edited.
  worldSchema: {
    provider: 'traveller-uwp',
    fields: [
      { key:'port',  label:'Starport',     type:'ehex' },
      { key:'size',  label:'Size',         type:'ehex' },
      { key:'atmo',  label:'Atmosphere',   type:'ehex' },
      { key:'hydro', label:'Hydrographics',type:'ehex' },
      { key:'pop',   label:'Population',   type:'ehex' },
      { key:'gov',   label:'Government',   type:'ehex' },
      { key:'law',   label:'Law Level',    type:'ehex' },
      { key:'tl',    label:'Tech Level',   type:'ehex' },
    ],
  },
  // Resolution engine. A profile the whole app rolls through. 2d6 is the
  // Traveller default; d20 / d6-pool ship as alternative built-ins.
  resolution: { profile:'2d6', dice:'2d6', dmLadder:'traveller', target:8 },
  // Character characteristics (UPP by default).
  attributes: [
    { key:'str',  label:'STR' }, { key:'dex',  label:'DEX' }, { key:'end',  label:'END' },
    { key:'intl', label:'INT' }, { key:'edu',  label:'EDU' }, { key:'soc',  label:'SOC' },
  ],
  // Meters / trackers. 0-to-many. The Archon morality meter is folded in at
  // boot from its existing definition (buildDefaultPack) so it stays single-source.
  meters: [],
  // Crew & ship. null = folded in at boot (built-in pack: KNOWN_CHARACTERS /
  // SHIP_PILOT / SHIP_NAV_AUDIENCE / the shipState literal stay single-source);
  // authored packs are seeded empty so no Archon identity ever leaks into a
  // new universe. roster drives the identity picker, sheets, whisper/visibleTo
  // audiences; pilot gets the fuel readout foregrounded; nav sees jump
  // distances and closed-lane locks.
  crew: null,   // { roster:[names…], pilot:'name', nav:[names…] }
  ship: null,   // { name:'…', startLocationId:'…' } — defaults for a fresh campaign's shipState
  // Calendar PRESENTATION. The date spine stays {day 1–365, year} everywhere
  // (jump weeks, recovery dates, ledger stamps all count days on it); the pack
  // decides how a date READS. format tokens: {ddd} zero-padded day-of-year,
  // {dd}, {d}, {yyyy}, {yy}. chip = the little header badge; era = the word
  // after the year in long-form readouts ("Day 123, 1105 Imperial"); weekdays =
  // optional 7 names replacing the Imperial week (day 1 stays the holiday).
  calendar: { format:'{ddd}-{yyyy}', chip:'IMP', era:'Imperial', weekdays:null },
  // Terminology map — every user-facing noun the engine can override.
  terminology: {
    referee:'Referee', player:'Traveller', playerView:'Traveller View',
    jumpLane:'Jump lane', date:'Imperial date', calendar:'Imperial Calendar',
    morality:'Morality', readAloud:'Read Aloud', refNote:'Referee Note',
    station:'Station', missions:'Missions', libraryData:'Library Data',
    oracle:'Oracle', standing:'Standing', funds:'Funds', ship:'Ship',
    combat:'Combat', economy:'Economy', npcs:'NPCs', rules:'Rules', sheets:'Sheets',
    trade:'Station Trade', board:'Starport Board',
  },
  // Per-campaign feature switches. false hides the subsystem entirely.
  modules: { economy:true, combat:true, morality:true, generation:true, oracle:true, calendar:true },
  // Theme tokens applied to :root. Empty = the stylesheet's own defaults win.
  theme: { tokens:{} },
};

// The default status-effect list is large and already lives in 60-tools-settings.js
// (TRAVELLER_STATUS_FX); buildDefaultPack folds it in rather than duplicating it.

// ── Registry state (top-level, file-00-safe) ────────────────────────────────
const CAMPAIGN_REGISTRY_LS = 'aurelia_campaigns';       // { activeId, list:[{id,title,builtin}] }
const CAMPAIGN_ACTIVE_LS   = 'aurelia_active_campaign'; // fast path read before the registry loads
const DEFAULT_CAMPAIGN_ID  = 'archon-gambit';

let activeCampaignId = (function(){
  try { return localStorage.getItem(CAMPAIGN_ACTIVE_LS) || DEFAULT_CAMPAIGN_ID; }
  catch(e){ return DEFAULT_CAMPAIGN_ID; }
})();
let _campaignRegistry = null;   // {activeId, list:[…]}
let _activePack = null;         // assembled pack: { id, title, builtin, config, content }

// ── Pack config persistence ─────────────────────────────────────────────────
// A pack's *config* (taxonomy, meters, terminology, theme…) is small and lives
// in localStorage keyed by campaign id. Its *content* for the built-in campaign
// comes from the code constants; for referee-authored campaigns, content is the
// referee's overlay data in the (namespaced) shared store, so only config and a
// small content seed need persisting here.
function packConfigLS(id){ return 'aurelia_pack_config_' + id; }

function loadCampaignRegistry(){
  if(_campaignRegistry) return _campaignRegistry;
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(CAMPAIGN_REGISTRY_LS) || 'null'); } catch(e){}
  if(stored && Array.isArray(stored.list)){
    _campaignRegistry = stored;
  } else {
    _campaignRegistry = { activeId: activeCampaignId, list: [
      { id: DEFAULT_CAMPAIGN_ID, title: 'Archon Gambit', builtin: true }
    ]};
  }
  // Guarantee the built-in is always present and the active id is valid.
  if(!_campaignRegistry.list.some(c => c.id === DEFAULT_CAMPAIGN_ID))
    _campaignRegistry.list.unshift({ id: DEFAULT_CAMPAIGN_ID, title:'Archon Gambit', builtin:true });
  if(!_campaignRegistry.list.some(c => c.id === activeCampaignId))
    activeCampaignId = DEFAULT_CAMPAIGN_ID;
  _campaignRegistry.activeId = activeCampaignId;
  return _campaignRegistry;
}
function saveCampaignRegistry(){
  try { localStorage.setItem(CAMPAIGN_REGISTRY_LS, JSON.stringify(loadCampaignRegistry())); } catch(e){}
}
function listCampaigns(){ return loadCampaignRegistry().list.slice(); }

// Deep-ish clone helper for pack config (JSON-safe data only).
function _clone(o){ try { return JSON.parse(JSON.stringify(o)); } catch(e){ return o; } }

// Merge a stored/partial config over the defaults so new default keys added in
// later app versions appear even in older saved packs (forward-migration).
function _mergeConfig(base, over){
  const out = _clone(base);
  if(!over || typeof over !== 'object') return out;
  Object.keys(over).forEach(k => { out[k] = over[k]; });
  return out;
}

// ── The built-in pack, assembled at boot from the code constants ────────────
// Runs from initCampaignPacks() (boot), so every later-file symbol it reads is
// already defined. For the DEFAULT campaign, content references the live
// constants by identity → byte-identical behaviour, no data copied.
function buildDefaultPack(){
  const config = _clone(PACK_DEFAULTS);

  // Fold the Archon morality meter in from its existing constants so the meter
  // definition has a single home. It becomes meters[0]; its axes/bands/log
  // storage key stay exactly as before.
  if(typeof ARCHON_AXES !== 'undefined' && typeof ARCHON_BANDS !== 'undefined'){
    config.meters = [{
      id:'archon', label:'Archon Collective — Morality', visible:'referee',
      storageKey:'aurelia_archon', axisRange:5,
      colors:{ pos:'#4caf82', neg:'#d45050' },
      axes: _clone(ARCHON_AXES),
      bands: ARCHON_BANDS.map(b => ({ ...b, max: b.max===Infinity?null:b.max, min: b.min===-Infinity?null:b.min })),
    }];
  }
  // Status-effect catalog for character sheets.
  if(typeof TRAVELLER_STATUS_FX !== 'undefined') config.statusFx = _clone(TRAVELLER_STATUS_FX);
  // Crew & ship — folded from the code constants (single source of truth).
  config.crew = {
    roster: (typeof KNOWN_CHARACTERS !== 'undefined') ? KNOWN_CHARACTERS.slice() : [],
    pilot:  (typeof SHIP_PILOT !== 'undefined') ? SHIP_PILOT : '',
    nav:    (typeof SHIP_NAV_AUDIENCE !== 'undefined') ? SHIP_NAV_AUDIENCE.slice() : [],
  };
  config.ship = { name: 'Archon Gambit', startLocationId: 'aurelia' };

  // Content references the live constants (default campaign only).
  const content = {
    systems:      (typeof SYSTEMS !== 'undefined') ? SYSTEMS : {},
    galaxyNodes:  (typeof GALAXY_NODES !== 'undefined') ? GALAXY_NODES : [],
    factions:     (typeof GALAXY_FACTIONS !== 'undefined') ? GALAXY_FACTIONS : {},
    locations:    (typeof BASE_LOCATIONS !== 'undefined') ? BASE_LOCATIONS : {},
    timedEvents:  (typeof TIMED_EVENTS !== 'undefined') ? TIMED_EVENTS : [],
    stations:     (typeof MAIN !== 'undefined') ? { aurelia: MAIN } : {},
  };

  // Fold in any referee CONFIG overrides for the built-in campaign (terminology,
  // meters, theme, dice…). Content stays code-owned; only config is overlaid, so
  // the edit is retroactive and "Reset to defaults" just clears this layer.
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(packConfigLS(DEFAULT_CAMPAIGN_ID)) || 'null'); } catch(e){}
  const mergedConfig = (saved && saved.config) ? _mergeConfig(config, saved.config) : config;
  if(saved && saved.statusFx) mergedConfig.statusFx = saved.statusFx;

  return { id: DEFAULT_CAMPAIGN_ID, title:'Archon Gambit', builtin:true, config: mergedConfig, content };
}

// Build (or load) a referee-authored pack: config from localStorage, content
// starts empty (the referee fills it via Design Mode, stored as namespaced
// overlay data in the shared store).
function buildAuthoredPack(id, title){
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(packConfigLS(id)) || 'null'); } catch(e){}
  const config = _mergeConfig(PACK_DEFAULTS, saved && saved.config);
  if(saved && saved.statusFx) config.statusFx = saved.statusFx;
  else if(typeof TRAVELLER_STATUS_FX !== 'undefined') config.statusFx = _clone(TRAVELLER_STATUS_FX);
  if(!config.meters || !config.meters.length){
    // A fresh authored pack still gets a starter meter so the tracker isn't empty;
    // referees rename/replace/remove it freely.
    config.meters = [];
  }
  // Authored packs must NEVER fall back to the Archon crew/ship constants —
  // seed them empty; the referee fills them in Studio ▸ Crew & Ship.
  if(!config.crew || typeof config.crew !== 'object') config.crew = { roster:[], pilot:'', nav:[] };
  if(!config.ship || typeof config.ship !== 'object') config.ship = { name:'', startLocationId:'' };
  // …and the galaxy layer starts neutrally named, not "The Orion Arm" (the
  // referee renames it in Studio ▸ Layers).
  if(!saved || !saved.config || !saved.config.taxonomy){
    const g = (config.taxonomy || []).find(l => l.id === 'galaxy');
    if(g) g.label = 'The Galaxy';
  }
  // …and the calendar reads neutrally (same format, no Imperial badge/era).
  if(!saved || !saved.config || !saved.config.calendar){
    config.calendar = { format:'{ddd}-{yyyy}', chip:'DATE', era:'', weekdays:null };
  }
  const content = (saved && saved.content) || { systems:{}, galaxyNodes:[], factions:{}, locations:{}, timedEvents:[], stations:{} };
  return { id, title: title || (saved && saved.title) || id, builtin:false, config, content };
}

function assembleActivePack(){
  if(activeCampaignId === DEFAULT_CAMPAIGN_ID){
    _activePack = buildDefaultPack();
  } else {
    const reg = loadCampaignRegistry().list.find(c => c.id === activeCampaignId);
    _activePack = buildAuthoredPack(activeCampaignId, reg && reg.title);
  }
  return _activePack;
}

// Persist the active pack's config. For the built-in campaign we save ONLY the
// config overlay (content stays code-owned); authored packs save config+content.
function saveActivePackConfig(){
  if(!_activePack) return;
  try {
    const payload = { title: _activePack.title, config: _activePack.config, statusFx: _activePack.config.statusFx };
    if(!_activePack.builtin) payload.content = _activePack.content;
    localStorage.setItem(packConfigLS(_activePack.id), JSON.stringify(payload));
  } catch(e){}
}
// Clear the active campaign's config overlay → back to code / pack defaults.
function resetActivePackConfig(){
  if(!_activePack) return;
  try { localStorage.removeItem(packConfigLS(_activePack.id)); } catch(e){}
  assembleActivePack();
  applyPackToUI();
}

// ── Accessors (safe before assembly — fall back to PACK_DEFAULTS) ───────────
function activePackConfig(){ return (_activePack && _activePack.config) || PACK_DEFAULTS; }
function activePackContent(){ return _activePack && _activePack.content; }

// True when the active campaign is referee-authored (not the built-in Archon
// Gambit pack). Safe at any point after js/05 loads — used by later modules to
// skip Archon-flavoured seeds (econ corps, faction AIs, oracle place lists).
function isAuthoredCampaign(){ return activeCampaignId !== DEFAULT_CAMPAIGN_ID; }

// Terminology lookup. Named TERM (not t) to avoid clashing with the hundreds of
// local `const t = …` in the render code.
function TERM(key){
  const term = activePackConfig().terminology;
  return (term && term[key] != null) ? term[key] : (PACK_DEFAULTS.terminology[key] != null ? PACK_DEFAULTS.terminology[key] : key);
}
function pkTaxonomy(){ return activePackConfig().taxonomy || PACK_DEFAULTS.taxonomy; }
function pkLayer(id){ return pkTaxonomy().find(l => l.id === id) || null; }
// Label for a navigation layer, with an optional literal fallback for the many
// call sites that still hardcode the Archon-Gambit wording.
function layerLabel(id, fallback){ const l = pkLayer(id); return (l && l.label) ? l.label : (fallback || id); }
function layerShort(id, fallback){ const l = pkLayer(id); return (l && (l.short||l.label)) ? (l.short||l.label) : (fallback || id); }
function pkObjectTypes(){ return activePackConfig().objectTypes || PACK_DEFAULTS.objectTypes; }
function pkWorldSchema(){ return activePackConfig().worldSchema || PACK_DEFAULTS.worldSchema; }
function pkResolution(){ return activePackConfig().resolution || PACK_DEFAULTS.resolution; }
function pkAttributes(){ return activePackConfig().attributes || PACK_DEFAULTS.attributes; }
function pkMeters(){ return activePackConfig().meters || []; }
function pkStatusFx(){ return activePackConfig().statusFx || (typeof TRAVELLER_STATUS_FX!=='undefined'?TRAVELLER_STATUS_FX:[]); }
function pkModules(){ return activePackConfig().modules || PACK_DEFAULTS.modules; }
// Crew & ship. Fallback to the code constants covers exactly two cases — the
// built-in pack before its boot fold, and a call during early load — so the
// default campaign behaves identically; authored packs always carry their own
// (seeded empty in buildAuthoredPack / validateAndMigratePack).
function pkCrew(){
  const c = activePackConfig().crew;
  if(c && typeof c === 'object') return c;
  return {
    roster: (typeof KNOWN_CHARACTERS !== 'undefined') ? KNOWN_CHARACTERS : [],
    pilot:  (typeof SHIP_PILOT !== 'undefined') ? SHIP_PILOT : '',
    nav:    (typeof SHIP_NAV_AUDIENCE !== 'undefined') ? SHIP_NAV_AUDIENCE : [],
  };
}
function crewRoster(){ return pkCrew().roster || []; }
function crewPilot(){ return pkCrew().pilot || ''; }
function crewNav(){ return pkCrew().nav || []; }
function pkShip(){ return activePackConfig().ship || { name:'', startLocationId:'' }; }
function pkCalendar(){ return activePackConfig().calendar || PACK_DEFAULTS.calendar; }
function moduleOn(key){ const m = pkModules(); return m[key] !== false; }
function pkTheme(){ return activePackConfig().theme || PACK_DEFAULTS.theme; }

// Content accessors used by the base-data layer (see baseBodiesFor / baseLocationsFor).
function pkGalaxyNodes(){ const c = activePackContent(); return c ? (c.galaxyNodes || []) : (typeof GALAXY_NODES!=='undefined'?GALAXY_NODES:[]); }

// ── Resolution engine (G10) ─────────────────────────────────────────────────
// A tiny dice layer the app rolls through. Built-in profiles: 2d6 (Traveller),
// d20, d6-pool. rng defaults to Math.random; pass a seeded rng for repeatable
// output (WGEN does this for world generation).
const DM_LADDERS = {
  // score → modifier. Traveller characteristic DM ladder.
  traveller: function(score){ const n=parseInt(score)||0;
    if(n<=0) return -3; if(n<=2) return -2; if(n<=5) return -1; if(n<=8) return 0;
    if(n<=11) return 1; if(n<=14) return 2; return 3; },
  // linear (d20-style): (score-10)/2 rounded down.
  linear: function(score){ return Math.floor(((parseInt(score)||0) - 10) / 2); },
  none: function(){ return 0; },
};
function dmForScore(score){ const p = pkResolution(); return (DM_LADDERS[p.dmLadder] || DM_LADDERS.traveller)(score); }
function rollProfile(profileName, rng){
  rng = rng || Math.random;
  const d = n => 1 + Math.floor(rng()*n);
  const prof = profileName || pkResolution().dice || '2d6';
  const m = String(prof).match(/^(\d*)d(\d+)(?:\+(\d+))?$/i);
  if(!m) return d(6)+d(6);
  const count = parseInt(m[1]||'1'), sides = parseInt(m[2]), plus = parseInt(m[3]||'0');
  let sum = plus; for(let i=0;i<count;i++) sum += d(sides);
  return sum;
}
// Roll the campaign's default dice (e.g. 2d6). Kept as the app-wide primitive.
function rollCampaignDice(rng){ return rollProfile(pkResolution().dice, rng); }

// ── Applying config to the running UI ───────────────────────────────────────
// Theme: set only the tokens the pack overrides on :root; untouched tokens keep
// the stylesheet defaults. Reversible by clearing (re-apply with empty tokens).
let _appliedThemeKeys = [];
function applyPackTheme(){
  const root = document.documentElement;
  _appliedThemeKeys.forEach(k => root.style.removeProperty(k));
  _appliedThemeKeys = [];
  const tokens = (pkTheme().tokens) || {};
  Object.keys(tokens).forEach(k => {
    const prop = k.startsWith('--') ? k : ('--' + k);
    root.style.setProperty(prop, tokens[k]);
    _appliedThemeKeys.push(prop);
  });
}

// Feature flags: hide the header/nav entry points for disabled subsystems. Maps
// a module key to the DOM ids it governs. Default (all true) hides nothing.
const MODULE_DOM = {
  economy:  ['econ-btn', 'trade-btn', 'board-btn'],
  combat:   ['combat-btn'],
  calendar: ['cal-btn'],
  oracle:   ['gen-btn'],
  // morality + generation gate in-panel controls, handled in their renderers.
};
function applyModuleFlags(){
  Object.keys(MODULE_DOM).forEach(mod => {
    const on = moduleOn(mod);
    MODULE_DOM[mod].forEach(id => { const el = document.getElementById(id); if(el) el.style.display = on ? '' : 'none'; });
  });
}

// Terminology: patch the curated set of STATIC strings in index.html by id.
// Dynamically-rendered strings route through TERM() at render time instead.
function applyTerminology(){
  const set = (id, txt) => { const el = document.getElementById(id); if(el) el.textContent = txt; };
  const pm = document.querySelector('.pm-label'); if(pm) pm.textContent = TERM('playerView');
  // Header buttons keep their glyph; swap the trailing label word.
  const btnLabel = (id, glyph, term) => { const el = document.getElementById(id); if(el && el.firstChild) el.textContent = glyph + ' ' + term; };
  btnLabel('qref-btn', '📖', TERM('rules'));
  btnLabel('quest-btn', '📜', TERM('missions'));
  btnLabel('ship-btn', '🚀', TERM('ship'));
  btnLabel('combat-btn', '⚔', TERM('combat'));
  btnLabel('cal-btn', '📅', TERM('calendar'));
  btnLabel('econ-btn', '📈', TERM('economy'));
  btnLabel('trade-btn', '🛒', TERM('trade'));
  btnLabel('board-btn', '📦', TERM('board'));
  btnLabel('disc-btn', '🗂', TERM('libraryData'));
  btnLabel('npc-btn', '👥', TERM('npcs'));
  btnLabel('rep-btn', '⚖', TERM('standing'));
  btnLabel('funds-btn', '💰', TERM('funds'));
  btnLabel('gen-btn', '🎲', TERM('oracle'));
  btnLabel('sheet-trigger-btn', '📋', TERM('sheets'));
  // Galaxy legend jump-lane wording.
  const lane = document.getElementById('hx-leg-lane');
  if(lane && lane.lastChild && lane.lastChild.nodeType === 3) lane.lastChild.textContent = TERM('jumpLane') + ' (−15% fuel)';
  // Calendar panel header follows the calendar terminology.
  const calT = document.getElementById('cal-title');
  if(calT) calT.textContent = '📅 ' + TERM('calendar').toUpperCase();
}

function applyPackToUI(){
  try { applyPackTheme(); } catch(e){}
  try { applyModuleFlags(); } catch(e){}
  try { applyTerminology(); } catch(e){}
}

// ── Boot entry point (called from the 85-records.js boot block) ─────────────
function initCampaignPacks(){
  loadCampaignRegistry();
  assembleActivePack();
  applyPackToUI();
  return _activePack;
}

// ── Campaign lifecycle (new / switch / duplicate / delete) ──────────────────
function _slugCampaign(title){
  const base = (title||'campaign').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'campaign';
  const reg = loadCampaignRegistry();
  let s = base, n = 2;
  while(reg.list.some(c => c.id === s) || s === DEFAULT_CAMPAIGN_ID){ s = base + '-' + n; n++; }
  return s;
}
// Create a blank universe (or seed from PACK_DEFAULTS). Does NOT switch to it.
function createCampaign(title){
  const reg = loadCampaignRegistry();
  const id = _slugCampaign(title || 'New Campaign');
  reg.list.push({ id, title: title || 'New Campaign', builtin:false });
  saveCampaignRegistry();
  // Seed its config so it exists on disk immediately.
  const pack = buildAuthoredPack(id, title);
  try { localStorage.setItem(packConfigLS(id), JSON.stringify({ title: pack.title, config: pack.config, statusFx: pack.config.statusFx, content: pack.content })); } catch(e){}
  return id;
}
function switchCampaign(id){
  const reg = loadCampaignRegistry();
  if(!reg.list.some(c => c.id === id)) return false;
  activeCampaignId = id; reg.activeId = id;
  try { localStorage.setItem(CAMPAIGN_ACTIVE_LS, id); } catch(e){}
  saveCampaignRegistry();
  return true;
}
function duplicateCampaign(srcId, newTitle){
  const reg = loadCampaignRegistry();
  const src = reg.list.find(c => c.id === srcId); if(!src) return null;
  const id = _slugCampaign(newTitle || (src.title + ' copy'));
  reg.list.push({ id, title: newTitle || (src.title + ' copy'), builtin:false });
  saveCampaignRegistry();
  // Copy config. (Content overlay data lives in the namespaced shared store and
  // is copied separately by the export/import path when the referee chooses to.)
  const srcPack = (srcId === DEFAULT_CAMPAIGN_ID) ? buildDefaultPack() : buildAuthoredPack(srcId);
  try { localStorage.setItem(packConfigLS(id), JSON.stringify({ title:newTitle||(src.title+' copy'), config:srcPack.config, statusFx:srcPack.config.statusFx, content: srcPack.builtin ? {systems:{},galaxyNodes:[],factions:{},locations:{},timedEvents:[],stations:{}} : srcPack.content })); } catch(e){}
  return id;
}
function deleteCampaign(id){
  if(id === DEFAULT_CAMPAIGN_ID) return false; // the built-in can't be deleted
  const reg = loadCampaignRegistry();
  reg.list = reg.list.filter(c => c.id !== id);
  if(activeCampaignId === id){ activeCampaignId = DEFAULT_CAMPAIGN_ID; reg.activeId = DEFAULT_CAMPAIGN_ID; try{ localStorage.setItem(CAMPAIGN_ACTIVE_LS, DEFAULT_CAMPAIGN_ID); }catch(e){} }
  saveCampaignRegistry();
  try { localStorage.removeItem(packConfigLS(id)); } catch(e){}
  return true;
}

// ── Pack export / import (config + content description) ──────────────────────
// This is the *universe definition* (config + built-in content snapshot). The
// referee's live overlay edits are exported separately by exportCampaign()
// (namespaced KV rows). A full share = pack.json + campaign-keys.json, or the
// combined bundle produced by exportCampaignBundle() (see 60-tools-settings.js).
const PACK_EXPORT_SCHEMA = 2;
function exportPackObject(){
  const p = _activePack || assembleActivePack();
  return {
    app:'archon-gambit', kind:'campaign-pack', schema: PACK_EXPORT_SCHEMA,
    exportedAt: new Date().toISOString(),
    id: p.id, title: p.title, config: p.config, content: p.content,
  };
}
// Validate an imported pack object. Returns {ok, error, migrated}. Never trusts
// the blob: checks shape + schema, migrates older schemas forward.
function validateAndMigratePack(obj){
  if(!obj || typeof obj !== 'object') return { ok:false, error:'Not a pack file.' };
  if(obj.kind !== 'campaign-pack') return { ok:false, error:'Not a campaign pack (kind mismatch).' };
  let schema = obj.schema|0;
  const migrated = schema < PACK_EXPORT_SCHEMA;
  // Forward-migration hook: schema 1 had no objectTypes/worldSchema — fill from defaults.
  const config = _mergeConfig(PACK_DEFAULTS, obj.config);
  if(obj.statusFx) config.statusFx = obj.statusFx;
  // Packs exported before crew/ship existed must not inherit the Archon crew.
  if(!config.crew || typeof config.crew !== 'object') config.crew = { roster:[], pilot:'', nav:[] };
  if(!config.ship || typeof config.ship !== 'object') config.ship = { name:'', startLocationId:'' };
  const content = (obj.content && typeof obj.content === 'object') ? obj.content
    : { systems:{}, galaxyNodes:[], factions:{}, locations:{}, timedEvents:[], stations:{} };
  return { ok:true, migrated, pack:{ id: obj.id || _slugCampaign(obj.title||'imported'), title: obj.title || 'Imported Campaign', builtin:false, config, content } };
}
// Install a validated pack as a new campaign (does not switch).
function installImportedPack(pack){
  const reg = loadCampaignRegistry();
  let id = pack.id;
  if(id === DEFAULT_CAMPAIGN_ID || reg.list.some(c => c.id === id)) id = _slugCampaign(pack.title);
  reg.list.push({ id, title: pack.title, builtin:false });
  saveCampaignRegistry();
  try { localStorage.setItem(packConfigLS(id), JSON.stringify({ title:pack.title, config:pack.config, statusFx:pack.config.statusFx, content:pack.content })); } catch(e){}
  return id;
}

// ═══════════════════════════════════════════════════════════════════════════
// SHIP — styled as the Mongoose Traveller 2E ship data file (page-1 core)
// ───────────────────────────────────────────────────────────────────────────
// Shared campaign state in aurelia_state (key 'ship-state'), synced the same
// way reveal-status / quest-log are. The object is deliberately keyed by plain
// system NAMES so the Orion Arm starmap can read the same state once it's
// folded into this file. Most fields are static referee-editable sheet data;
// the live FLIGHT STATUS readouts are gated per-viewer by canSee():
//   • Fuel        → everyone, but FOREGROUNDED for the pilot (Rhett)
//   • Jump dist.  → Rhett + Cass only (other identities don't see it)
//   • Travel time → everyone
// Gating is spoiler/visibility control, not security (see CLAUDE.md).
// ═══════════════════════════════════════════════════════════════════════════

const SHIP_PILOT = 'Rhett Calder';
const SHIP_NAV_AUDIENCE = ['Rhett Calder', 'Cassia Velen']; // jump-distance readout

// Critical-hit systems, laid out to fill the 2-col grid left→right exactly like
// the printed sheet (left column: Armour…Hull, right column: J-Drive…Weapons).
const SHIP_CRIT_SYSTEMS = [
  ['armour','Armour'],     ['jdrive','J-Drive'],
  ['bridge','Bridge'],     ['mdrive','M-Drive'],
  ['cargo','Cargo'],       ['powerplant','Power Plant'],
  ['crew','Crew'],         ['sensors','Sensors'],
  ['fuel','Fuel'],         ['weapons','Weapons'],
  ['hull','Hull']
];

let shipPanelOpen = false;
let shipCollapsed = false;
let shipState = {
  // ── Ship Data File ──
  name: 'Archon Gambit',
  shipClass: '',
  configuration: '',
  hullOptions: '',
  armour: '',
  // ── Engineering (numeric — drive the live math) ──
  tonnage: 200,        // hull displacement (tons) → "Size" + jump-fuel math
  jumpRating: 2,       // installed J-drive rating
  hullPoints: 80,      // current hull points
  hullPointsMax: 80,   // hull points at full
  structurePoints: 80,    // current Structure points (damage flows here once Hull is breached)
  structurePointsMax: 80, // Structure points at full
  // ── Drive output (display strings, as written on the sheet) ──
  driveReaction: '',
  driveManoeuvre: '',
  // ── Fuel ──
  fuel: 24,            // current fuel (tons)
  fuelMax: 80,         // fuel tankage (tons)
  fuelProcessor: '',
  // ── Costs ──
  purchaseCost: '',
  mortgage: '',
  maintenance: '',
  runningCost: '',
  // ── Flight plan (drives FLIGHT STATUS readouts) ──
  origin: 'Aurelia',
  destination: '',
  jumpParsecs: 0,      // distance to destination, parsecs
  // ── Hex-jump navigation (shared with the galaxy layer) ──
  // Single source of truth for cross-layer travel state. The hex galaxy map
  // reads these and writes them back on a jump; players see the change via the
  // ship-state poll. (The Imperial date lives in `imperialDate`, advanced on jump.)
  locationId: 'aurelia', // current galaxy-node id the party occupies (drives `origin`)
  cargoHold: 30,         // speculative-cargo capacity (tons) for the trade planner
  broker: 2,             // Broker skill for trade price estimates (0–6)
  jumpLog: [],           // captain's log: [{date,from,to,weeks,burn,refuels,events}]
  visited: [],           // galaxy-node ids the party has physically called at — gates market/trade intel from players until they've been there
  // ── Combat stats (Phase 1 — additive; lazy-default merged on load) ─────────
  // These extend the sheet with the numerics MgT2e *core* space combat needs.
  // They are dormant until the combat module reads them; existing rows simply
  // pick up the defaults below via the Object.assign merge in loadShipState().
  // The SAME field set is produced by makeShipStats() for enemy/NPC ships, so
  // there is one ship model, not a parallel one (per the Phase-1 ruling).
  thrust: 2,           // M-Drive Thrust rating (number) — drives range-band Thrust allocation
  power: 0,            // current power points available to systems
  powerMax: 0,         // power plant output
  armourRating: 0,     // numeric armour (subtracted from rolled damage); `armour` stays the sheet text
  sensorDM: 0,         // Electronics (Sensors) DM for locks / EW
  crewSkills: { pilot:0, gunnery:0, engineer:0, sensors:0, tactics:0, leadership:0 },
  // Weapon mounts. type ∈ 'beam-laser'|'pulse-laser'|'missile'|'sandcaster'|'plasma'
  // mount ∈ 'turret'|'fixed'|'barbette'. ammo/ammoMax only meaningful for missiles/sandcasters.
  // Bay/spinal mounts are High Guard scope — flagged, not modelled here.
  weapons: [],         // [{ id, name, type, mount, damage:'2D', range:'Very Long', count, ammo, ammoMax, notes }]
                       // `damage` is the referee-entered dice expr the engine rolls (never guessed).
  // ── Critical hits — severity 0..6 per system ──
  crits: { armour:0,bridge:0,cargo:0,crew:0,fuel:0,hull:0,jdrive:0,mdrive:0,powerplant:0,sensors:0,weapons:0 }
};

// ── Shared ship-stat factory ───────────────────────────────────────────────
// Produces the canonical ship-stat shape used for BOTH the player ship and
// enemy/NPC ships, so combat never forks into a second model. Referee-authored
// enemies are just makeShipStats({...}) objects living inside the encounter.
function makeShipStats(overrides){
  return Object.assign({
    name: '', shipClass: '', configuration: '', hullOptions: '',
    armour: '', armourRating: 0,
    tonnage: 100, jumpRating: 1,
    hullPoints: 40, hullPointsMax: 40,
    structurePoints: 40, structurePointsMax: 40,
    driveReaction: '', driveManoeuvre: '',
    thrust: 1, power: 0, powerMax: 0, sensorDM: 0,
    fuel: 0, fuelMax: 0, fuelProcessor: '',
    crewSkills: { pilot:0, gunnery:0, engineer:0, sensors:0, tactics:0, leadership:0 },
    weapons: [],
    crits: { armour:0,bridge:0,cargo:0,crew:0,fuel:0,hull:0,jdrive:0,mdrive:0,powerplant:0,sensors:0,weapons:0 }
  }, overrides || {});
}

async function loadShipState(){
  try {
    const res = await supaStorage.get('ship-state', true);
    if(res.value != null) shipState = Object.assign(shipState, JSON.parse(res.value));
  } catch(e){ /* keep defaults */ }
}

async function saveShipState(){
  try { await supaStorage.set('ship-state', JSON.stringify(shipState), true); }
  catch(e){ console.error('Ship save failed:', e); }
}

// ── Traveller 2E math ──
// Jump fuel for one jump = 10% of hull tonnage × parsecs jumped (FUEL_RULES,
// js/00-core-data.js). A trip needs ceil(parsecs / jumpRating) jumps; each jump
// takes ≈ 1 week (7 days). Crossing `p` parsecs total burns 10% × hull × p in
// jump fuel regardless of how the jumps are split, so shipFuelForTrip uses the
// whole-trip parsec count directly (exact tons — no house rounding).
function shipJumpsNeeded(){
  const p = Number(shipState.jumpParsecs) || 0;
  const r = Number(shipState.jumpRating) || 1;
  return p > 0 ? Math.ceil(p / r) : 0;
}
function shipFuelForTrip(){
  const p = Number(shipState.jumpParsecs) || 0;
  if(p <= 0) return 0;
  const t = shipState.tonnage;
  const weeks = shipJumpsNeeded() * (FUEL_RULES.operatingFuel.weeksPerJump || 1);
  return jumpFuel(t, p) + operatingFuel(t, weeks);   // operating term is 0 unless FUEL_RULES.operatingFuel.enabled
}
function shipTravelDays(){ return shipJumpsNeeded() * 7; }

function toggleShipPanel(){
  shipPanelOpen = !shipPanelOpen;
  const wrap = document.getElementById('ship-wrap');
  const btn = document.getElementById('ship-btn');
  wrap.classList.toggle('hidden', !shipPanelOpen);
  if(btn) btn.classList.toggle('panel-open', shipPanelOpen);
  if(shipPanelOpen) renderShipPanel();
}

function toggleShipCollapse(){
  if(document.getElementById('ship-header').dataset.suppressClick === '1') return;
  shipCollapsed = !shipCollapsed;
  document.getElementById('ship-toggle').textContent = shipCollapsed ? '▲' : '▼';
  document.getElementById('ship-body').classList.toggle('collapsed', shipCollapsed);
  const foot = document.getElementById('ship-foot');
  if(foot) foot.classList.toggle('collapsed', shipCollapsed);
  document.getElementById('ship-wrap').classList.toggle('panel-collapsed', shipCollapsed);
}

// ── Field helpers: referee gets an inline fill-in input, players read text ──
// (mirrors the printed sheet's blank-line fields). `sfTextField` for strings,
// `sfNumField` for the numeric/engineering values.
function sfTextField(field, placeholder){
  if(isReferee()){
    return `<input class="sf-input" type="text" value="${escAttr(shipState[field])}" placeholder="${escAttr(placeholder||'')}" onchange="updateShipField('${field}', this.value)">`;
  }
  const v = String(shipState[field] || '');
  return `<span class="sf-val">${v ? escQH(v) : '—'}</span>`;
}
function sfNumField(field, suffix){
  const sfx = suffix ? ` ${escQH(suffix)}` : '';
  if(isReferee()){
    return `<input class="sf-input" type="number" inputmode="numeric" step="any" value="${shipState[field]}" onchange="updateShipField('${field}', this.value)">`;
  }
  return `<span class="sf-val">${shipState[field]}${sfx}</span>`;
}
// Compact inline numeric — for paired values (e.g. "52 / 80") that must stay on
// one line, so the referee's input doesn't expand to full width and stack.
function sfNumSm(field){
  if(isReferee()){
    return `<input class="sf-input sm" type="number" inputmode="numeric" step="any" value="${shipState[field]}" onchange="updateShipField('${field}', this.value)">`;
  }
  return `${shipState[field]}`;
}

// One Critical-Hits row: a system label + six hex pips, filled up to severity.
function shipCritRow(key, label, ref){
  const sev = (shipState.crits && Number(shipState.crits[key])) || 0;
  let hexes = '';
  for(let i = 1; i <= 6; i++){
    hexes += `<div class="sf-hex${i <= sev ? ' on' : ''}"${ref ? ` onclick="setShipCrit('${key}',${i})" title="Set ${label} damage to ${i}"` : ''}></div>`;
  }
  return `<div class="sf-crit-row"><span class="sf-crit-name">${label}</span><div class="sf-hexes">${hexes}</div></div>`;
}

function renderShipPanel(){
  const body = document.getElementById('ship-body');
  if(!body) return;
  const ref = isReferee();
  body.classList.toggle('ship-ref', ref); // enables hex-pip click cursor

  const nameBadge = document.getElementById('ship-name-badge');
  if(nameBadge) nameBadge.textContent = shipState.name || '';

  const isPilot = !ref && myIdentity === SHIP_PILOT;
  const sec = [];

  // ── SHIP DATA FILE ──
  sec.push(`<div class="sf-sec">
    <div class="sf-tab">Ship Data File</div>
    <div class="sf-card">
      <div class="sf-row"><span class="sf-lbl">Name</span><span class="sf-fld">${sfTextField('name')}</span></div>
      <div class="sf-row"><span class="sf-lbl">Class</span><span class="sf-fld">${sfTextField('shipClass')}</span></div>
      <div class="sf-row"><span class="sf-lbl">Config</span><span class="sf-fld">${sfTextField('configuration')}</span></div>
      <div class="sf-row"><span class="sf-lbl">Size</span><span class="sf-fld">${sfNumField('tonnage','tons')}</span></div>
      <div class="sf-row"><span class="sf-lbl">Hull Options</span><span class="sf-fld">${sfTextField('hullOptions')}</span></div>
      <div class="sf-row"><span class="sf-lbl">Armour</span><span class="sf-fld">${sfTextField('armour')}</span></div>
    </div>
  </div>`);

  // ── HULL POINTS ──
  {
    const hp = Number(shipState.hullPoints) || 0, hpMax = Number(shipState.hullPointsMax) || 0;
    const pct = hpMax > 0 ? Math.max(0, Math.min(100, (hp / hpMax) * 100)) : 0;
    const low = hpMax > 0 && hp / hpMax < 0.34;
    sec.push(`<div class="sf-sec">
      <div class="sf-tab">Hull Points</div>
      <div class="sf-card">
        <div class="ship-readout-val">${ref ? `${sfNumSm('hullPoints')} <span style="font-size:12px;color:#5a5f6b">/</span> ${sfNumSm('hullPointsMax')}` : `${hp} <span style="font-size:11px;color:#5a5f6b">/ ${hpMax}</span>`}</div>
        <div class="ship-fuel-bar"><div class="ship-fuel-bar-fill${low ? ' low' : ''}" style="width:${pct}%"></div></div>
      </div>
    </div>`);
  }

  // ── DRIVES / DRIVE OUTPUT ──
  sec.push(`<div class="sf-sec">
    <div class="sf-tab">Drives</div>
    <div class="sf-drives">
      <div class="dh">Drive</div><div class="dh">Output</div>
      <div class="dl">Reaction</div><div class="dv">${sfTextField('driveReaction')}</div>
      <div class="dl">Manoeuvre</div><div class="dv">${sfTextField('driveManoeuvre')}</div>
      <div class="dl">Jump</div><div class="dv">${ref ? sfNumField('jumpRating') : 'J-' + (Number(shipState.jumpRating) || 0)}</div>
    </div>
  </div>`);

  // ── FLIGHT STATUS — preserved live, gated readouts ──
  const status = [];
  // Fuel — visible to all, foregrounded for the pilot (Rhett)
  {
    const fuel = Number(shipState.fuel) || 0, max = Number(shipState.fuelMax) || 0;
    const pct  = max > 0 ? Math.max(0, Math.min(100, (fuel / max) * 100)) : 0;
    const need = shipFuelForTrip();
    const low  = need > 0 ? fuel < need : pct < 20;
    const tag  = isPilot ? '<span class="ship-readout-tag pilot">Pilot</span>' : '';
    const valHTML = ref
      ? `${sfNumSm('fuel')} <span style="font-size:12px;color:#5a5f6b">/</span> ${sfNumSm('fuelMax')} <span style="font-size:11px;color:#5a5f6b">t</span>`
      : `${fuel} <span style="font-size:10px;color:#5a5f6b">/ ${max} t</span>`;
    const needLine = need > 0
      ? `<div class="ship-readout-sub${fuel < need ? ' ship-warn' : ''}">Planned jump needs ${need} t — ${fuel < need ? 'INSUFFICIENT' : 'sufficient'}</div>`
      : '';
    status.push(`<div class="ship-readout${isPilot ? ' pilot' : ''}">
      <div class="ship-readout-lbl"><span>⛽ Fuel</span>${tag}</div>
      <div class="ship-readout-val">${valHTML}</div>
      <div class="ship-fuel-bar"><div class="ship-fuel-bar-fill${low ? ' low' : ''}" style="width:${pct}%"></div></div>
      ${needLine}
    </div>`);
  }
  // Jump distance — Rhett + Cass only (canSee filters other identities)
  if(canSee(SHIP_NAV_AUDIENCE)){
    const p = Number(shipState.jumpParsecs) || 0, r = Number(shipState.jumpRating) || 1;
    const jumps = shipJumpsNeeded(), dest = shipState.destination || '—';
    const feas = p > 0 ? (p <= r ? `Reachable in one J-${r} jump` : `${jumps} jumps at J-${r}`) : 'No destination plotted';
    const valHTML = ref ? `${sfNumSm('jumpParsecs')} <span style="font-size:11px;color:#5a5f6b">pc</span>` : (p > 0 ? p + ' pc' : '—');
    const route = ref
      ? `<div class="ship-readout-sub" style="display:flex;gap:6px;align-items:baseline">${sfTextField('origin','Origin')} → ${sfTextField('destination','Destination')}</div><div class="ship-readout-sub">${feas}</div>`
      : `<div class="ship-readout-sub">${escQH(shipState.origin || '?')} → ${escQH(dest)} · ${feas}</div>`;
    status.push(`<div class="ship-readout">
      <div class="ship-readout-lbl"><span>🧭 Jump Distance</span><span class="ship-readout-tag">Nav</span></div>
      <div class="ship-readout-val">${valHTML}</div>
      ${route}
    </div>`);
  }
  // Travel time — everyone
  {
    const days = shipTravelDays(), jumps = shipJumpsNeeded();
    const val  = days > 0 ? (days % 7 === 0 ? `${days / 7} wk` : `${days} d`) : '—';
    const sub  = jumps > 0 ? `${jumps} jump${jumps > 1 ? 's' : ''} · ~1 week each` : 'No jump plotted';
    status.push(`<div class="ship-readout">
      <div class="ship-readout-lbl"><span>⏱ Est. Travel Time</span></div>
      <div class="ship-readout-val">${val}</div>
      <div class="ship-readout-sub">${sub}</div>
    </div>`);
  }
  sec.push(`<div class="sf-sec">
    <div class="sf-tab">Flight Status</div>
    <div class="sf-card" style="padding:8px 9px"><div class="sf-status">${status.join('')}</div></div>
  </div>`);

  // ── FUEL CAPACITY ──
  sec.push(`<div class="sf-sec">
    <div class="sf-tab">Fuel Capacity</div>
    <div class="sf-card">
      <div class="sf-row"><span class="sf-lbl">Tank (full)</span><span class="sf-fld">${sfNumField('fuelMax','tons')}</span></div>
      <div class="sf-row"><span class="sf-lbl">On hand</span><span class="sf-fld">${sfNumField('fuel','tons')}</span></div>
      <div class="sf-row"><span class="sf-lbl">Fuel Processor</span><span class="sf-fld">${sfTextField('fuelProcessor')}</span></div>
    </div>
  </div>`);

  // ── COST BARS ──
  const costRow = (field, label) => `<div class="sf-cost"><span class="sf-cost-lbl">${label}</span><span class="sf-cost-fld">${sfTextField(field)}</span></div>`;
  sec.push(`<div class="sf-costs">
    ${costRow('purchaseCost','Purchase Cost')}
    ${costRow('mortgage','Mortgage')}
    ${costRow('maintenance','Maintenance')}
    ${costRow('runningCost','Running Cost')}
  </div>`);

  // ── CRITICAL HITS ──
  sec.push(`<div class="sf-sec">
    <div class="sf-tab">Critical Hits</div>
    <div class="sf-card">
      <div class="sf-crit-grid">${SHIP_CRIT_SYSTEMS.map(([k,l]) => shipCritRow(k, l, ref)).join('')}</div>
    </div>
  </div>`);

  // Combat loadout — referee opens the shared ship editor on this ship (sets
  // Thrust, power, armour rating, sensor DM, crew-skill DMs, Structure, weapons).
  if(ref){
    sec.push(`<div class="sf-sec"><div class="sf-card" style="background:#dfe6df">
      <button class="cbt-btn" style="width:100%" onclick="openShipEditor('player')">⚔ Edit combat loadout</button>
    </div></div>`);
  }

  body.innerHTML = sec.join('');
}

function updateShipField(field, value){
  if(!isReferee()) return;
  const numeric = ['fuel','fuelMax','tonnage','jumpRating','hullPoints','hullPointsMax','jumpParsecs'];
  shipState[field] = numeric.includes(field) ? (Number(value) || 0) : value;
  saveShipState();
  renderShipPanel();
  // Hull damage drives the Red Alert state
  if(field === 'hullPoints' || field === 'hullPointsMax'){
    checkHullAutoAlert();
    renderAlertCtl(); // keep the puck's HULL % live
  }
}

function setShipCrit(system, n){
  if(!isReferee()) return;
  if(!shipState.crits) shipState.crits = {};
  const cur = Number(shipState.crits[system]) || 0;
  shipState.crits[system] = (cur === n) ? n - 1 : n; // click filled pip again to step down
  saveShipState();
  renderShipPanel();
}

// ═══════════════════════════════════════════════════════════════════════════
// RED ALERT  (dramatic ship state, driven by Hull Points)
// ───────────────────────────────────────────────────────────────────────────
// Shared state in aurelia_state (key 'ship-alert-state'). The referee raises /
// stands down the alert; it also auto-raises when hull points fall below 25%.
// Players pick it up on a dedicated FAST poll (1.5s) — a dependency-free stand-
// in for Supabase Realtime that still feels instant at the table, while the
// rest of the app keeps its 4s poll. Red alert is non-blocking (the overlay is
// pointer-events:none, so the UI stays usable); it respects prefers-reduced-
// motion and offers a referee Stand Down plus a per-device ✕ mute as
// accessibility kill-switches. Structured to allow an 'ai-takeover' tier later.
// ═══════════════════════════════════════════════════════════════════════════

let alertState = { mode:'normal', message:'', since:0, killSwitch:false };
let hullAutoArmed = false;   // stops the auto-alert re-firing until hull recovers
let lastAlertSince = 0;      // detects a *new* alert, to clear a per-device mute
let alertPollId = null;
const ALERT_POLL_MS = 1500;

async function loadAlertState(){
  try {
    const res = await supaStorage.get('ship-alert-state', true);
    if(res.value != null) alertState = Object.assign(alertState, JSON.parse(res.value));
  } catch(e){ /* keep default normal */ }
}
async function saveAlertState(){
  try { await supaStorage.set('ship-alert-state', JSON.stringify(alertState), true); }
  catch(e){ console.error('Alert save failed:', e); }
}

function setAlertMode(mode, message){
  if(!isReferee()) return;
  if(mode === 'normal'){
    // If we stand down while the hull is still critical, stay "armed" so the
    // auto-trigger doesn't immediately re-fire until the hull is repaired.
    const max = Number(shipState.hullPointsMax) || 0, hp = Number(shipState.hullPoints) || 0;
    hullAutoArmed = (max > 0 && hp / max < 0.25);
  }
  alertState = { mode, message: message || '', since: Date.now(), killSwitch:false };
  applyAlertState();
  saveAlertState();
}

// Called whenever hull points change — escalates to red alert at <25% hull.
function checkHullAutoAlert(){
  if(!isReferee()) return;
  const max = Number(shipState.hullPointsMax) || 0, hp = Number(shipState.hullPoints) || 0;
  const ratio = max > 0 ? hp / max : 1;
  if(ratio < 0.25){
    if(!hullAutoArmed && alertState.mode === 'normal'){
      hullAutoArmed = true;
      setAlertMode('red-alert', 'Hull integrity critical');
    }
  } else {
    hullAutoArmed = false; // recovered — allow it to fire again next time
  }
}

function applyAlertState(){
  // Toggle on <body> (ancestor of both #root and the sibling #float-panels that
  // contains the overlay/banner) so the CSS can reach those nodes.
  const bodyEl = document.body;
  const active = alertState.mode === 'red-alert' || alertState.mode === 'ai-takeover';
  if(active && alertState.since !== lastAlertSince){
    bodyEl.classList.remove('alert-local-muted'); // a fresh alert un-mutes this device
  }
  lastAlertSince = alertState.since;
  bodyEl.classList.toggle('red-alert', alertState.mode === 'red-alert');
  bodyEl.classList.toggle('ai-takeover', alertState.mode === 'ai-takeover');
  const msg = document.getElementById('ship-alert-msg');
  if(msg) msg.textContent = alertState.message ? '— ' + alertState.message : '';
  const aim = document.getElementById('ai-takeover-msg');
  if(aim && alertState.mode === 'ai-takeover'){
    aim.textContent = alertState.message || 'CORE INTELLIGENCE ASSUMING DIRECT CONTROL';
  }
  renderAlertCtl();
}

function renderAlertCtl(){
  const ctl = document.getElementById('ship-alert-ctl');
  if(!ctl) return;
  const max = Number(shipState.hullPointsMax) || 0, hp = Number(shipState.hullPoints) || 0;
  const pct = max > 0 ? Math.round(hp / max * 100) : 100;
  const takeoverBtn = `<button class="sac-btn takeover" onclick="setAlertMode('ai-takeover','CORE INTELLIGENCE ASSUMING DIRECT CONTROL')">👁 AI Takeover</button>`;
  if(alertState.mode === 'ai-takeover'){
    ctl.innerHTML = `<span class="sac-ai">👁 AI IN CONTROL</span><button class="sac-btn standdown" onclick="setAlertMode('normal')">■ Restore Control</button>`;
  } else if(alertState.mode === 'red-alert'){
    ctl.innerHTML = `<span class="sac-hull">HULL ${pct}%</span>${takeoverBtn}<button class="sac-btn standdown" onclick="setAlertMode('normal')">■ Stand Down</button>`;
  } else {
    ctl.innerHTML = `<button class="sac-btn raise" onclick="setAlertMode('red-alert','Red alert')">⚠ Red Alert</button>${takeoverBtn}`;
  }
}

function muteAlertLocal(){ document.body.classList.add('alert-local-muted'); }

function startAlertPolling(){ stopAlertPolling(); if(isReferee()) return; alertPollId = setInterval(pollAlertState, ALERT_POLL_MS); }
function stopAlertPolling(){ if(alertPollId){ clearInterval(alertPollId); alertPollId = null; } }
async function pollAlertState(){
  try {
    const res = await supaStorage.get('ship-alert-state', true);
    if(res.ok){
      const fresh = res.value != null ? JSON.parse(res.value) : { mode:'normal', message:'', since:0 };
      if(JSON.stringify(fresh) !== JSON.stringify(alertState)){
        alertState = fresh;
        applyAlertState();
      }
    }
  } catch(e){ /* silent — next poll retries */ }
}


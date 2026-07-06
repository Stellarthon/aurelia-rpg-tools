// ═══════════════════════════════════════════════════════════════════════════
// INITIATIVE TRACKER (referee-only)
// ═══════════════════════════════════════════════════════════════════════════
let combatants = []; // {id, name, score, dex, int, ambush:null|'atk'|'def', down:false, notes:''}
let currentTurnIdx = -1; // -1 = no active turn pointer
// Collapsed by default (remembered per device) so the tracker sits as a compact
// bar until the referee needs it — see tidyTrackers() in 98-trackers-boot.js.
let initCollapsed = (()=>{ try { const v = localStorage.getItem('aurelia_init_collapsed'); return v==null ? true : v==='1'; } catch(e){ return true; } })();
let combatantIdSeed = 1;
let initShared = false; // referee: is a redacted turn-order pushed to players' devices?

try {
  const saved = JSON.parse(localStorage.getItem('aurelia_combatants')||'null');
  if(saved && Array.isArray(saved.list)){
    combatants = saved.list;
    currentTurnIdx = saved.turnIdx ?? -1;
    combatantIdSeed = saved.seed || (combatants.length+1);
    initShared = !!saved.shared;
  }
} catch(e){}

function saveCombatants(){
  try {
    localStorage.setItem('aurelia_combatants', JSON.stringify({
      list: combatants, turnIdx: currentTurnIdx, seed: combatantIdSeed, shared: initShared
    }));
  } catch(e){}
  pushSharedInitiative(); // referee-only inside; mirrors a REDACTED board to players
}

// Initiative rolls the campaign's resolution dice (2d6 by default; a pack can
// switch to d20, 3d6, etc). Falls back to 2d6 before the pack engine loads.
function roll2d6(){ return (typeof rollCampaignDice === 'function') ? rollCampaignDice() : ((1+Math.floor(Math.random()*6)) + (1+Math.floor(Math.random()*6))); }

function addCombatant(){
  const nameEl = document.getElementById('init-name-input');
  const scoreEl = document.getElementById('init-score-input');
  const dexEl = document.getElementById('init-dex-input');
  const intEl = document.getElementById('init-int-input');
  const rollMode = document.getElementById('init-roll-mode').checked;

  const name = nameEl.value.trim();
  if(!name) { nameEl.focus(); return; }

  const dex = parseInt(dexEl.value)||0;
  const intl = parseInt(intEl.value)||0;
  const mod = Math.max(dex, intl); // DEX or INT roll, whichever the referee tracks — use higher modifier field filled in

  let score;
  if(rollMode){
    score = roll2d6() + mod;
  } else {
    score = scoreEl.value !== '' ? (parseInt(scoreEl.value)||0) : (roll2d6()+mod);
  }

  combatants.push({
    id: combatantIdSeed++,
    name, score, dex, int: intl,
    ambush: null, down: false, notes: '',
    healthMode: 'none', // 'none' | 'simple' | 'detailed'
    hp: 10, maxHp: 10,
    cStr: 8, maxCStr: 8, cDex: 8, maxCDex: 8, cEnd: 8, maxCEnd: 8
  });

  nameEl.value=''; scoreEl.value=''; dexEl.value=''; intEl.value='';
  sortInitiative();
  nameEl.focus();
}

function quickAddNPC(name, dex, intl){
  const rollMode = document.getElementById('init-roll-mode').checked;
  const mod = Math.max(dex||0, intl||0);
  const score = roll2d6() + mod;
  combatants.push({
    id: combatantIdSeed++,
    name, score, dex: dex||0, int: intl||0,
    ambush: null, down: false, notes: '',
    healthMode: 'none',
    hp: 10, maxHp: 10,
    cStr: 8, maxCStr: 8, cDex: 8, maxCDex: 8, cEnd: 8, maxCEnd: 8
  });
  sortInitiative();
}

function removeCombatant(id){
  const idx = combatants.findIndex(c=>c.id===id);
  if(idx===-1) return;
  if(currentTurnIdx > idx) currentTurnIdx--;
  else if(currentTurnIdx === idx) currentTurnIdx = -1;
  combatants.splice(idx,1);
  renderInit();
  saveCombatants();
}

function moveCombatant(id, dir){
  const idx = combatants.findIndex(c=>c.id===id);
  if(idx===-1) return;
  const newIdx = idx + dir;
  if(newIdx<0 || newIdx>=combatants.length) return;
  const wasCurrentId = currentTurnIdx>=0 ? combatants[currentTurnIdx].id : null;
  const tmp = combatants[idx];
  combatants[idx] = combatants[newIdx];
  combatants[newIdx] = tmp;
  if(wasCurrentId !== null) currentTurnIdx = combatants.findIndex(c=>c.id===wasCurrentId);
  renderInit();
  saveCombatants();
}

function toggleAmbush(id, type){
  const c = combatants.find(c=>c.id===id);
  if(!c) return;
  c.ambush = (c.ambush === type) ? null : type;
  renderInit();
  saveCombatants();
}

function toggleDown(id){
  const c = combatants.find(c=>c.id===id);
  if(!c) return;
  c.down = !c.down;
  renderInit();
  saveCombatants();
}

// ── NPC health tracking ──────────────────────────────────────────────────
// Traveller doesn't use a single HP pool — damage is split across STR,
// DEX, and END, and a character is taken out when two of the three hit
// zero. "Simple" mode collapses this into one bar for minor NPCs where
// the distinction doesn't matter at the table. "Detailed" mode tracks
// all three separately for NPCs where it might come up.
function cycleHealthMode(id){
  const c = combatants.find(c=>c.id===id);
  if(!c) return;
  c.healthMode = c.healthMode === 'none' ? 'simple' : c.healthMode === 'simple' ? 'detailed' : 'none';
  renderInit();
  saveCombatants();
}

function adjustHealth(id, stat, delta){
  const c = combatants.find(c=>c.id===id);
  if(!c) return;
  if(stat === 'hp'){
    c.hp = Math.max(0, Math.min(c.maxHp, c.hp + delta));
  } else {
    const cur = 'c' + stat, max = 'maxC' + stat;
    c[cur] = Math.max(0, Math.min(c[max], c[cur] + delta));
  }
  renderInit();
  saveCombatants();
}

function setMaxHealth(id, stat, val){
  const c = combatants.find(c=>c.id===id);
  if(!c) return;
  const n = Math.max(1, parseInt(val)||1);
  if(stat === 'hp'){ c.maxHp = n; c.hp = Math.min(c.hp, n); }
  else { const max='maxC'+stat, cur='c'+stat; c[max]=n; c[cur]=Math.min(c[cur], n); }
  renderInit();
  saveCombatants();
}

function healthBarHTML(label, cur, max, color){
  const pct = max > 0 ? Math.round((cur/max)*100) : 0;
  const barColor = pct <= 25 ? '#C0392B' : pct <= 50 ? '#D4913A' : color;
  return `<div class="hp-row">
    <span class="hp-label">${label}</span>
    <div class="hp-bar-track"><div class="hp-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
    <span class="hp-value">${cur}/${max}</span>
  </div>`;
}

// Detailed-mode status banner: STR at 0 reads DEAD (red), DEX and END both
// at 0 (with STR still above 0) reads DOWNED (yellow). Drawn as a large
// translucent overlay behind the bars so the numbers stay legible.
function healthStatusBannerHTML(c){
  if(c.cStr === 0) return '<div class="hp-status-banner dead">DEAD</div>';
  if(c.cDex === 0 && c.cEnd === 0) return '<div class="hp-status-banner downed">DOWNED</div>';
  return '';
}

function updateNotes(id, val){
  const c = combatants.find(c=>c.id===id);
  if(!c) return;
  c.notes = val;
  saveCombatants();
}

function rerollScore(id){
  const c = combatants.find(c=>c.id===id);
  if(!c) return;
  const mod = Math.max(c.dex||0, c.int||0);
  c.score = roll2d6() + mod;
  sortInitiative();
}

function sortInitiative(){
  const wasCurrentId = currentTurnIdx>=0 && combatants[currentTurnIdx] ? combatants[currentTurnIdx].id : null;
  // Sort descending by score; on tie, highest DEX wins (per cheat sheet)
  combatants.sort((a,b) => {
    if(b.score !== a.score) return b.score - a.score;
    return (b.dex||0) - (a.dex||0);
  });
  if(wasCurrentId !== null) currentTurnIdx = combatants.findIndex(c=>c.id===wasCurrentId);
  renderInit();
  saveCombatants();
}

function nextTurn(){
  if(combatants.length === 0) return;
  // Skip down combatants
  let tries = 0;
  do {
    currentTurnIdx = (currentTurnIdx + 1) % combatants.length;
    tries++;
  } while(combatants[currentTurnIdx].down && tries <= combatants.length);
  renderInit();
  saveCombatants();
}

function clearInitiative(){
  if(combatants.length && !confirm('Clear all combatants from the initiative tracker?')) return;
  combatants = [];
  currentTurnIdx = -1;
  renderInit();
  saveCombatants();
}

function persistCollapse(key, val){ try { localStorage.setItem(key, val ? '1' : '0'); } catch(e){} }
function toggleInitPanel(){
  if(document.getElementById('init-header').dataset.suppressClick === '1') return;
  initCollapsed = !initCollapsed;
  persistCollapse('aurelia_init_collapsed', initCollapsed);
  document.getElementById('init-toggle').textContent = initCollapsed ? '▲' : '▼';
  document.getElementById('init-body').classList.toggle('collapsed', initCollapsed);
  document.getElementById('init-foot').classList.toggle('collapsed', initCollapsed);
  document.getElementById('init-wrap').classList.toggle('panel-collapsed', initCollapsed);
}

function renderInit(){
  const body = document.getElementById('init-body');
  const count = document.getElementById('init-count');
  if(!body) return;
  count.textContent = combatants.length;
  const shareCb = document.getElementById('init-share-players');
  if(shareCb) shareCb.checked = initShared;

  if(!combatants.length){
    body.innerHTML = '<div class="init-empty">No combatants yet. Add by name or use a quick-add button below.</div>';
    return;
  }

  body.innerHTML = combatants.map((c,i) => {
    const isCurrent = i === currentTurnIdx;
    const ambushTag = c.ambush==='atk' ? '<span class="init-ambush-tag atk">AMBUSH +6</span>'
                     : c.ambush==='def' ? '<span class="init-ambush-tag def">AMBUSHED −6</span>' : '';

    let healthHTML = '';
    if(c.healthMode === 'simple'){
      healthHTML = `<div class="hp-block">
        ${healthBarHTML('Hits', c.hp, c.maxHp, '#4CAF50')}
        <div class="hp-adjust-row">
          <button class="init-btn" onclick="adjustHealth(${c.id},'hp',-1)">−1</button>
          <button class="init-btn" onclick="adjustHealth(${c.id},'hp',-5)">−5</button>
          <button class="init-btn" onclick="adjustHealth(${c.id},'hp',1)">+1</button>
          <input type="number" inputmode="numeric" class="hp-max-input" value="${c.maxHp}" onchange="setMaxHealth(${c.id},'hp',this.value)" title="Max hits">
        </div>
      </div>`;
    } else if(c.healthMode === 'detailed'){
      healthHTML = `<div class="hp-block">
        ${healthStatusBannerHTML(c)}
        ${healthBarHTML('STR', c.cStr, c.maxCStr, '#C0392B')}
        ${healthBarHTML('DEX', c.cDex, c.maxCDex, '#4A90D9')}
        ${healthBarHTML('END', c.cEnd, c.maxCEnd, '#4CAF50')}
        <div class="hp-adjust-row">
          <span style="font-size:9px;color:var(--tx1)">STR</span>
          <button class="init-btn" onclick="adjustHealth(${c.id},'Str',-1)">−</button>
          <button class="init-btn" onclick="adjustHealth(${c.id},'Str',1)">+</button>
          <span style="font-size:9px;color:var(--tx1);margin-left:6px">DEX</span>
          <button class="init-btn" onclick="adjustHealth(${c.id},'Dex',-1)">−</button>
          <button class="init-btn" onclick="adjustHealth(${c.id},'Dex',1)">+</button>
          <span style="font-size:9px;color:var(--tx1);margin-left:6px">END</span>
          <button class="init-btn" onclick="adjustHealth(${c.id},'End',-1)">−</button>
          <button class="init-btn" onclick="adjustHealth(${c.id},'End',1)">+</button>
        </div>
      </div>`;
    }

    return `<div class="init-row ${isCurrent?'current':''} ${c.down?'down':''}">
      <div class="init-row-top">
        <span class="init-score" title="Click to reroll" onclick="rerollScore(${c.id})" style="cursor:pointer">${c.score}</span>
        <span class="init-name">${c.name}</span>
        ${ambushTag}
      </div>
      ${healthHTML}
      <div class="init-row-controls" style="margin-top:4px;flex-wrap:wrap">
        <button class="init-btn" onclick="moveCombatant(${c.id},-1)" title="Move up">▲</button>
        <button class="init-btn" onclick="moveCombatant(${c.id},1)" title="Move down">▼</button>
        <button class="init-btn ${c.ambush==='atk'?'danger':''}" onclick="toggleAmbush(${c.id},'atk')" title="Ambushing (+6)">AMB+</button>
        <button class="init-btn ${c.ambush==='def'?'danger':''}" onclick="toggleAmbush(${c.id},'def')" title="Ambushed (−6)">AMB−</button>
        <button class="init-btn" onclick="cycleHealthMode(${c.id})" title="Cycle damage tracking: off → simple → detailed">${c.healthMode==='none'?'+ Damage':c.healthMode==='simple'?'Dmg: Simple':'Dmg: Detailed'}</button>
        <button class="init-btn" onclick="toggleDown(${c.id})" title="Toggle down/out">${c.down?'Revive':'Down'}</button>
        <button class="init-btn danger" onclick="removeCombatant(${c.id})" title="Remove">✕</button>
      </div>
      <textarea class="init-notes" placeholder="Notes (wounds, conditions...)" oninput="updateNotes(${c.id}, this.value)">${c.notes||''}</textarea>
    </div>`;
  }).join('');

  renderHealthPanel();
}

// ── Standalone NPC Health Panel ──────────────────────────────────────────
// Reuses the same `combatants` array and health functions as the
// initiative tracker — this is just a filtered, more compact view focused
// purely on health, so referees don't have to scroll through full
// initiative rows (ambush flags, notes, move buttons) just to check HP.
// Both panels stay in sync automatically since they share the same data.
let healthPanelCollapsed = (()=>{ try { const v = localStorage.getItem('aurelia_health_collapsed'); return v==null ? true : v==='1'; } catch(e){ return true; } })();

function toggleHealthPanel(){
  if(document.getElementById('health-header').dataset.suppressClick === '1') return;
  healthPanelCollapsed = !healthPanelCollapsed;
  persistCollapse('aurelia_health_collapsed', healthPanelCollapsed);
  document.getElementById('health-toggle').textContent = healthPanelCollapsed ? '▲' : '▼';
  document.getElementById('health-body').classList.toggle('collapsed', healthPanelCollapsed);
  document.getElementById('health-wrap').classList.toggle('panel-collapsed', healthPanelCollapsed);
}

function renderHealthPanel(){
  const body = document.getElementById('health-body');
  const count = document.getElementById('health-count');
  if(!body) return;

  const tracked = combatants.filter(c => c.healthMode !== 'none');
  count.textContent = tracked.length;

  if(!tracked.length){
    body.innerHTML = '<div class="init-empty">No NPCs being tracked yet. Use the "+ Damage" button on a combatant in the Initiative panel to start tracking them here.</div>';
    return;
  }

  body.innerHTML = tracked.map(c => {
    let healthHTML = '';
    if(c.healthMode === 'simple'){
      healthHTML = `${healthBarHTML('Hits', c.hp, c.maxHp, '#4CAF50')}
        <div class="hp-adjust-row">
          <button class="init-btn" onclick="adjustHealth(${c.id},'hp',-1)">−1</button>
          <button class="init-btn" onclick="adjustHealth(${c.id},'hp',-5)">−5</button>
          <button class="init-btn" onclick="adjustHealth(${c.id},'hp',1)">+1</button>
          <input type="number" inputmode="numeric" class="hp-max-input" value="${c.maxHp}" onchange="setMaxHealth(${c.id},'hp',this.value)" title="Max hits">
        </div>`;
    } else {
      healthHTML = `<div style="position:relative">
        ${healthStatusBannerHTML(c)}
        ${healthBarHTML('STR', c.cStr, c.maxCStr, '#C0392B')}
        ${healthBarHTML('DEX', c.cDex, c.maxCDex, '#4A90D9')}
        ${healthBarHTML('END', c.cEnd, c.maxCEnd, '#4CAF50')}
        <div class="hp-adjust-row">
          <span style="font-size:9px;color:var(--tx1)">STR</span>
          <button class="init-btn" onclick="adjustHealth(${c.id},'Str',-1)">−</button>
          <button class="init-btn" onclick="adjustHealth(${c.id},'Str',1)">+</button>
          <span style="font-size:9px;color:var(--tx1);margin-left:6px">DEX</span>
          <button class="init-btn" onclick="adjustHealth(${c.id},'Dex',-1)">−</button>
          <button class="init-btn" onclick="adjustHealth(${c.id},'Dex',1)">+</button>
          <span style="font-size:9px;color:var(--tx1);margin-left:6px">END</span>
          <button class="init-btn" onclick="adjustHealth(${c.id},'End',-1)">−</button>
          <button class="init-btn" onclick="adjustHealth(${c.id},'End',1)">+</button>
        </div>
      </div>`;
    }
    return `<div class="health-card ${c.down?'down':''}">
      <div class="health-card-name">${c.name}</div>
      ${healthHTML}
    </div>`;
  }).join('');
}

function buildQuickAddList(){
  // Gather unique NPCs from MAIN (station) and BODIES (system) data
  const seen = new Set();
  const list = [];
  function consider(npc){
    if(!npc || !npc.name || seen.has(npc.name)) return;
    seen.add(npc.name);
    const dex = npc.stats ? (npc.stats.DEX||0) : 0;
    const intl = npc.stats ? (npc.stats.INT||0) : 0;
    list.push({name:npc.name, dex, int:intl});
  }
  Object.values(MAIN).forEach(area => {
    (area.npcs||[]).forEach(consider);
    if(area.subs) Object.values(area.subs).forEach(sub => (sub.npcs||[]).forEach(consider));
  });
  getBodies().forEach(b => (b.npcs||[]).forEach(consider));

  const wrap = document.getElementById('init-quickadd');
  if(!wrap) return;
  wrap.innerHTML = list.map(n =>
    `<button class="init-quick-btn" onclick="quickAddNPC('${n.name.replace(/'/g,"\\\\'")}',${n.dex},${n.int})">+ ${n.name}</button>`
  ).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED TURN ORDER — a redacted, read-only board on players' devices
// ═══════════════════════════════════════════════════════════════════════════
// The referee tracker above stays referee-only. When the referee flips "Share
// turn order with players", saveCombatants() mirrors a REDACTED payload to the
// shared 'initiative' key: names, order, whose turn, and down/active — but NEVER
// health, notes, scores, or DEX/INT (those stay on the referee's device). Players
// poll it (js/55) into playerInit and render a glanceable read-only "Turn Order"
// panel. Ambush setups and NPC HP never leave the table; the default-off toggle
// is the safety — nothing is shared until the referee chooses.

let _lastSharedInit = null;   // last redacted JSON written, to skip redundant writes
let playerInit = { shared:false, turnId:null, rows:[] };
let turnOrderPanelOpen = false;
let turnOrderCollapsed = false;

// Referee: toggle sharing on/off (called from the init-foot checkbox).
function toggleInitShare(on){
  initShared = !!on;
  saveCombatants();   // persists the flag + pushes (or clears) the shared board
}

// Referee: write the redacted board to the shared key (or clear it when off).
function pushSharedInitiative(){
  if(typeof supaStorage === 'undefined') return;
  if(typeof isReferee !== 'function' || !isReferee()) return;
  const payload = initShared ? {
    shared: true,
    turnId: (currentTurnIdx >= 0 && combatants[currentTurnIdx]) ? combatants[currentTurnIdx].id : null,
    rows: combatants.map(c => ({ id: c.id, name: c.name, down: !!c.down }))
  } : { shared: false, turnId: null, rows: [] };
  const js = JSON.stringify(payload);
  if(js === _lastSharedInit) return;   // nothing player-visible changed → skip write
  _lastSharedInit = js;
  try { supaStorage.set('initiative', js, true); } catch(e){}
}

// Player: hydrate the shared board at boot.
async function loadTurnOrder(){
  try {
    const r = await supaStorage.get('initiative', true);
    if(r.value != null) playerInit = JSON.parse(r.value) || playerInit;
  } catch(e){}
  updateTurnOrderBtn();
}
// The "🎯 Turns" header launcher is hidden until the referee shares a board, so
// it never clutters the (decluttered) header — it only appears for players
// during combat, giving them a way to reopen the panel if they close it.
function updateTurnOrderBtn(){
  const b = document.getElementById('turnorder-btn');
  if(!b) return;
  const show = !!(playerInit && playerInit.shared) && !(typeof isReferee === 'function' && isReferee());
  b.classList.toggle('hidden', !show);
}

function toggleTurnOrderPanel(){
  turnOrderPanelOpen = !turnOrderPanelOpen;
  const w = document.getElementById('turnorder-wrap');
  const b = document.getElementById('turnorder-btn');
  if(!w) return;
  w.classList.toggle('hidden', !turnOrderPanelOpen);
  if(b) b.classList.toggle('panel-open', turnOrderPanelOpen);
  if(turnOrderPanelOpen) renderTurnOrder();
}
function toggleTurnOrderCollapse(){
  const hdr = document.getElementById('turnorder-header');
  if(hdr && hdr.dataset.suppressClick === '1') return;
  turnOrderCollapsed = !turnOrderCollapsed;
  document.getElementById('turnorder-toggle').textContent = turnOrderCollapsed ? '▲' : '▼';
  document.getElementById('turnorder-body').classList.toggle('collapsed', turnOrderCollapsed);
  document.getElementById('turnorder-wrap').classList.toggle('panel-collapsed', turnOrderCollapsed);
}

function renderTurnOrder(){
  const body = document.getElementById('turnorder-body');
  if(!body) return;
  const rows = (playerInit && playerInit.shared && Array.isArray(playerInit.rows)) ? playerInit.rows : [];
  const countEl = document.getElementById('turnorder-count');
  if(countEl) countEl.textContent = rows.length;
  if(!rows.length){
    body.innerHTML = '<div class="to-empty">No active turn order. The referee shares it when combat begins.</div>';
    return;
  }
  body.innerHTML = rows.map((r, i) => {
    const cur = (playerInit.turnId != null && r.id === playerInit.turnId);
    const nm = (typeof escQH === 'function') ? escQH(r.name || '') : (r.name || '');
    return `<div class="to-row${cur ? ' current' : ''}${r.down ? ' down' : ''}">
      <span class="to-ord">${i + 1}</span>
      <span class="to-name">${nm}</span>
      ${cur ? '<span class="to-turn">◄ turn</span>' : ''}
      ${r.down ? '<span class="to-downtag">down</span>' : ''}
    </div>`;
  }).join('');
}



// ═══════════════════════════════════════════════════════════════════════════
// SESSION PLANNER  (referee prep + run workspace)
// ═══════════════════════════════════════════════════════════════════════════
// A OneNote / Foundry / World Anvil-style workspace where the referee builds a
// session ahead of time, breaks it into scenes/beats, and links each scene to
// the tools this app already ships — so prep and play happen in ONE place:
//
//   • NPC roster   (js/85 npcRoster)   — attach recurring NPCs to a scene, or
//                                         create a new roster NPC by name.
//   • Missions     (js/70,85 questLog) — attach an existing mission, or create a
//                                         (hidden) mission from a scene and reveal
//                                         it to players when the scene lands.
//   • Oracle       (js/85 generate*)   — pre-roll rumours / market whispers /
//                                         encounters and pin them to a scene;
//                                         promote a pinned draw to the Quest Log
//                                         or Library Data.
//
// Persistence mirrors the NPC roster exactly: one shared aurelia_state key
// ('session-plans'), loaded REFEREE-ONLY (loadSessionPlans() returns early for
// players, so a player device never fetches or holds the referee's prep). All
// writes are isReferee()-guarded. No player poll — this is a referee tool.
//
// Load order: this file (97) loads AFTER 50 (supaStorage), 55 (isReferee),
// 70 (escQH), 85 (npcRoster/questLog/oracle helpers) and 96 (escAttr/emptyNpc),
// so every symbol it references is already defined. Its only top-level call is
// the referee preload at the tail, which touches earlier-file globals only.

let sessionPlans = [];
let _plansLoaded = false;
let plannerOpen = false;
let plannerSelId = null;          // id of the session shown in the detail pane
let plannerPicker = null;         // {planId, sceneId, type:'npc'|'mission', q} for chip picker; {mode:'link', linkType, q} for rich-text link picker
let plannerView = 'list';         // 'list' | 'board' — detail pane mode
let plannerLinkCtx = null;        // {planId, sceneId, field, range, selText} captured while inserting a rich-text link
let _richTimer = null;            // debounce timer for rich-field autosave
let _pendingLoc = null;           // {ref, label} while a location-link action popover is open

const SCENE_TYPES = [
  ['scene',   '🎬 Scene'],
  ['social',  '💬 Social'],
  ['combat',  '⚔ Combat'],
  ['travel',  '🚀 Travel'],
  ['explore', '🧭 Explore'],
  ['downtime','⏳ Downtime'],
];
const PLAN_STATUS = [['planned','Planned'], ['active','Running'], ['done','Done']];
const CHECK_OUTCOMES = [['pending','Pending'], ['success','Success'], ['partial','Partial'], ['failure','Failure']];

function _pid(pfx){ return pfx + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
function sesc(s){ return (typeof escQH === 'function') ? escQH(s) : String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function sattr(s){ return (typeof escAttr === 'function') ? escAttr(s == null ? '' : String(s)) : String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

// ── Data helpers ────────────────────────────────────────────────────────────

function emptyScene(){
  return { id: _pid('sc_'), title: '', type: 'scene', readAloud: '', refNotes: '',
           done: false, npcIds: [], missionIds: [], oracle: [], checks: [] };
}
function emptyCheck(){ return { id: _pid('ck_'), label: '', target: '', who: '', roll: '', outcome: 'pending', notes: '' }; }
function emptyPlan(){
  return { id: _pid('sp_'), title: 'New Session', inGameDate: '', status: 'planned',
           premise: '', prep: '', scenes: [], docs: [], createdAt: Date.now() };
}
function planById(id){ return sessionPlans.find(p => p.id === id) || null; }
function sceneById(plan, sid){ return plan ? (plan.scenes || []).find(s => s.id === sid) || null : null; }
function selPlan(){ return planById(plannerSelId); }

// Normalise a stored blob so older / partial writes can't break the render.
function normalizePlans(){
  if(!Array.isArray(sessionPlans)) sessionPlans = [];
  sessionPlans.forEach(p => {
    if(!Array.isArray(p.docs)) p.docs = [];
    if(!Array.isArray(p.scenes)) p.scenes = [];
    p.scenes.forEach(s => {
      if(!Array.isArray(s.npcIds)) s.npcIds = [];
      if(!Array.isArray(s.missionIds)) s.missionIds = [];
      if(!Array.isArray(s.oracle)) s.oracle = [];
      if(!Array.isArray(s.checks)) s.checks = [];
    });
  });
}

// ── Persistence (referee-only, same contract as npc-roster) ─────────────────

async function loadSessionPlans(){
  if(typeof isReferee === 'function' && !isReferee()){ sessionPlans = []; _plansLoaded = true; return; }  // never populate player memory
  try {
    const r = await supaStorage.get('session-plans', true);
    sessionPlans = (r && r.value != null) ? (JSON.parse(r.value) || []) : [];
  } catch(e){ sessionPlans = []; }
  normalizePlans();
  _plansLoaded = true;
}
async function saveSessionPlans(){
  if(typeof isReferee === 'function' && !isReferee()) return;
  try { await supaStorage.set('session-plans', JSON.stringify(sessionPlans), true); }
  catch(e){ console.error('Session plans save failed:', e); }
}

// ── Open / close ────────────────────────────────────────────────────────────

function openSessionPlanner(){
  if(typeof isReferee === 'function' && !isReferee()){ if(typeof showToast === 'function') showToast('Referee only', 'info'); return; }
  plannerOpen = true;
  const m = document.getElementById('planner-modal');
  if(m) m.classList.add('open');
  const paint = () => {
    if(!plannerSelId && sessionPlans.length) plannerSelId = sessionPlans[0].id;
    renderPlanner();
  };
  if(!_plansLoaded){ loadSessionPlans().then(paint); } else { paint(); }
}
function closeSessionPlanner(){
  commitAllRich();          // flush any in-progress rich-text edit before we tear the pane down
  closePlannerPopover();
  plannerOpen = false;
  plannerPicker = null;
  plannerLinkCtx = null;
  const m = document.getElementById('planner-modal');
  if(m) m.classList.remove('open');
}
// Hop to the existing recap / export tool (js/92) without leaving the workflow.
function plannerOpenRecap(){ if(typeof openSessionTools === 'function') openSessionTools(); }

// ── Session CRUD ────────────────────────────────────────────────────────────

function plannerNewSession(){
  if(!isReferee()) return;
  const p = emptyPlan();
  p.scenes.push(emptyScene());
  sessionPlans.unshift(p);
  plannerSelId = p.id;
  saveSessionPlans();
  renderPlanner();
}
function plannerSelect(id){
  plannerSelId = id;
  const card = document.getElementById('planner-card');
  if(card) card.classList.add('mobile-detail');   // narrow layout → show the detail pane
  renderPlanner();
}
function plannerBackToList(){
  const card = document.getElementById('planner-card');
  if(card) card.classList.remove('mobile-detail');
  renderPlanner();
}
function plannerDuplicateSession(id){
  if(!isReferee()) return;
  const p = planById(id); if(!p) return;
  const c = JSON.parse(JSON.stringify(p));
  c.id = _pid('sp_'); c.title = (p.title || 'Session') + ' (copy)'; c.status = 'planned'; c.createdAt = Date.now();
  (c.scenes || []).forEach(s => { s.id = _pid('sc_'); s.done = false; (s.oracle || []).forEach(o => o.id = _pid('or_')); });
  const idx = sessionPlans.findIndex(x => x.id === id);
  sessionPlans.splice(idx < 0 ? sessionPlans.length : idx + 1, 0, c);
  plannerSelId = c.id;
  saveSessionPlans();
  renderPlanner();
}
function plannerDeleteSession(id){
  if(!isReferee()) return;
  const p = planById(id);
  if(!confirm('Delete "' + ((p && p.title) || 'this session') + '"? This cannot be undone. (Linked NPCs and missions are NOT deleted.)')) return;
  sessionPlans = sessionPlans.filter(x => x.id !== id);
  if(plannerSelId === id) plannerSelId = sessionPlans.length ? sessionPlans[0].id : null;
  saveSessionPlans();
  renderPlanner();
}
function plannerEditField(id, field, value){
  if(!isReferee()) return;
  const p = planById(id); if(!p) return;
  p[field] = value;
  saveSessionPlans();
  if(field === 'title' || field === 'status') renderPlannerList();   // keep the rail label / pill in sync
  if(field === 'status') renderPlannerDetail();
}
function plannerSetStatus(id, status){ plannerEditField(id, 'status', status); }

// ── Scene CRUD ──────────────────────────────────────────────────────────────

function sceneAdd(planId){
  if(!isReferee()) return;
  const p = planById(planId); if(!p) return;
  p.scenes.push(emptyScene());
  saveSessionPlans();
  renderPlannerDetail();
  renderPlannerList();   // rail shows the scene count
}
function sceneEditField(planId, sceneId, field, value){
  if(!isReferee()) return;
  const s = sceneById(planById(planId), sceneId); if(!s) return;
  s[field] = value;
  saveSessionPlans();
  if(field === 'title' || field === 'type') renderPlannerDetail();
}
function sceneDelete(planId, sceneId){
  if(!isReferee()) return;
  const p = planById(planId); if(!p) return;
  if(!confirm('Delete this scene?')) return;
  p.scenes = p.scenes.filter(s => s.id !== sceneId);
  saveSessionPlans();
  renderPlannerDetail();
  renderPlannerList();   // rail shows the scene count
}
function sceneMove(planId, sceneId, dir){
  if(!isReferee()) return;
  const p = planById(planId); if(!p) return;
  const i = p.scenes.findIndex(s => s.id === sceneId);
  const j = i + dir;
  if(i < 0 || j < 0 || j >= p.scenes.length) return;
  const tmp = p.scenes[i]; p.scenes[i] = p.scenes[j]; p.scenes[j] = tmp;
  saveSessionPlans();
  renderPlannerDetail();
}
function sceneToggleDone(planId, sceneId){
  if(!isReferee()) return;
  const s = sceneById(planById(planId), sceneId); if(!s) return;
  s.done = !s.done;
  saveSessionPlans();
  renderPlannerDetail();
  renderPlannerList();   // rail shows the played/total count
}

// ── Link picker (NPCs / Missions) ───────────────────────────────────────────

function openLinkPicker(planId, sceneId, type){
  if(!isReferee()) return;
  plannerPicker = { planId, sceneId, type, q: '' };
  // The NPC roster / quest log preload at boot, but open the picker defensively.
  if(type === 'npc' && typeof npcRoster !== 'undefined' && !npcRoster.length && typeof loadNpcRoster === 'function'){
    loadNpcRoster().then(() => { if(plannerPicker) renderLinkPicker(); });
  }
  renderLinkPicker();
  setTimeout(() => { const s = document.getElementById('planner-pick-search'); if(s) s.focus(); }, 60);
}
function closeLinkPicker(){ plannerPicker = null; const el = document.getElementById('planner-picker'); if(el) el.classList.add('hidden'); }
function plannerPickerSearch(v){ if(plannerPicker){ plannerPicker.q = v; renderLinkPicker(); } }

// NPC linking
function sceneLinkNpc(planId, sceneId, npcId){
  if(!isReferee()) return;
  const s = sceneById(planById(planId), sceneId); if(!s) return;
  if(!s.npcIds.includes(npcId)) s.npcIds.push(npcId);
  saveSessionPlans();
  closeLinkPicker();
  renderPlannerDetail();
}
function sceneUnlinkNpc(planId, sceneId, npcId){
  if(!isReferee()) return;
  const s = sceneById(planById(planId), sceneId); if(!s) return;
  s.npcIds = s.npcIds.filter(x => x !== npcId);
  saveSessionPlans();
  renderPlannerDetail();
}
// Create a brand-new roster NPC by name and link it. Returns nothing; refines in the NPC panel.
function sceneNewNpc(planId, sceneId, name){
  if(!isReferee() || typeof npcRoster === 'undefined' || typeof emptyNpc !== 'function') return;
  const n = emptyNpc();
  n.name = (name || '').trim() || 'New NPC';
  npcRoster.push(n);
  if(typeof saveNpcRoster === 'function') saveNpcRoster();
  if(typeof npcPanelOpen !== 'undefined' && npcPanelOpen && typeof renderNpcPanel === 'function') renderNpcPanel();
  sceneLinkNpc(planId, sceneId, n.id);
  if(typeof showToast === 'function') showToast('NPC "' + n.name + '" added to roster');
}

// Mission linking (questLog)
function sceneLinkMission(planId, sceneId, qId){
  if(!isReferee()) return;
  const s = sceneById(planById(planId), sceneId); if(!s) return;
  if(!s.missionIds.includes(qId)) s.missionIds.push(qId);
  saveSessionPlans();
  closeLinkPicker();
  renderPlannerDetail();
}
function sceneUnlinkMission(planId, sceneId, qId){
  if(!isReferee()) return;
  const s = sceneById(planById(planId), sceneId); if(!s) return;
  s.missionIds = s.missionIds.filter(x => x !== qId);
  saveSessionPlans();
  renderPlannerDetail();
}
// Create a mission from a scene. Defaults to HIDDEN so it doesn't reach players
// until the referee reveals it (a scene is prep, after all).
function sceneNewMission(planId, sceneId, title){
  if(!isReferee() || typeof questLog === 'undefined') return;
  const q = { id: _pid('q_'), title: (title || '').trim() || 'New Mission', status: 'hidden',
              playerDesc: '', refNote: '', objectives: [] };
  questLog.push(q);
  if(typeof saveQuestLog === 'function') saveQuestLog();
  if(typeof questPanelOpen !== 'undefined' && questPanelOpen && typeof renderQuestPanel === 'function') renderQuestPanel();
  sceneLinkMission(planId, sceneId, q.id);
  if(typeof showToast === 'function') showToast('Mission created (hidden — reveal it when the scene lands)');
}
// Flip a linked mission's visibility so players see it live (existing quest poll picks it up).
function missionReveal(qId){
  if(!isReferee() || typeof questLog === 'undefined') return;
  const q = questLog.find(x => x.id === qId); if(!q) return;
  q.status = (q.status === 'active') ? 'hidden' : 'active';
  if(typeof saveQuestLog === 'function') saveQuestLog();
  if(typeof questPanelOpen !== 'undefined' && questPanelOpen && typeof renderQuestPanel === 'function') renderQuestPanel();
  renderPlannerDetail();
  if(typeof showToast === 'function') showToast(q.status === 'active' ? 'Mission revealed to players' : 'Mission hidden from players', 'info');
}

// ── Oracle integration ──────────────────────────────────────────────────────
// Reuse the existing generators (js/85). They write the global `oracleResult`
// and harmlessly re-render the oracle panel if it happens to be open; we then
// snapshot a plain copy and pin it to the scene so it survives re-rolls.

function _snapshotOracle(){
  if(typeof oracleResult === 'undefined' || !oracleResult) return null;
  const o = oracleResult;
  return { id: _pid('or_'), kind: o.kind, text: o.text || '', faction: o.faction || null,
           reliability: o.reliability || '', difficulty: o.difficulty || '', diffIdx: (o.diffIdx == null ? null : o.diffIdx),
           source: o.source || null, contract: o.contract ? JSON.parse(JSON.stringify(o.contract)) : null };
}
function sceneRollOracle(planId, sceneId, kind){
  if(!isReferee()) return;
  const s = sceneById(planById(planId), sceneId); if(!s) return;
  try {
    if(kind === 'rumour' && typeof generateRumour === 'function') generateRumour();
    else if(kind === 'market' && typeof generateMarketRumour === 'function') generateMarketRumour();
    else if(kind === 'encounter' && typeof generateEncounter === 'function') generateEncounter();
    else return;
  } catch(e){ if(typeof showToast === 'function') showToast('Oracle unavailable', 'error'); return; }
  const snap = _snapshotOracle();
  if(snap){ s.oracle.unshift(snap); saveSessionPlans(); renderPlannerDetail(); }
}
function sceneOracleRemove(planId, sceneId, oid){
  if(!isReferee()) return;
  const s = sceneById(planById(planId), sceneId); if(!s) return;
  s.oracle = s.oracle.filter(o => o.id !== oid);
  saveSessionPlans();
  renderPlannerDetail();
}
// Promote a pinned CONTRACT rumour to the shared Quest Log (players can track it).
function sceneOracleToQuest(planId, sceneId, oid){
  if(!isReferee()) return;
  const s = sceneById(planById(planId), sceneId); if(!s) return;
  const o = (s.oracle || []).find(x => x.id === oid); if(!o) return;
  let ok = false;
  if(o.contract && typeof spawnContractQuest === 'function'){ ok = spawnContractQuest(o.contract); }
  else if(typeof questLog !== 'undefined'){
    questLog.push({ id: _pid('q_'), title: (o.text || 'Rumour').slice(0, 60), status: 'active',
                    playerDesc: o.text || '', refNote: o.faction ? ('Attributed to ' + o.faction) : (o.reliability || ''), objectives: [] });
    if(typeof saveQuestLog === 'function') saveQuestLog();
    if(typeof questPanelOpen !== 'undefined' && questPanelOpen && typeof renderQuestPanel === 'function') renderQuestPanel();
    ok = true;
  }
  if(typeof showToast === 'function') showToast(ok ? 'Posted to the Quest Log' : 'Could not post', ok ? 'success' : 'error');
}
// Promote a pinned rumour to Library Data as something players can overhear.
function sceneOracleToLibrary(planId, sceneId, oid){
  if(!isReferee()) return;
  const s = sceneById(planById(planId), sceneId); if(!s) return;
  const o = (s.oracle || []).find(x => x.id === oid); if(!o) return;
  if(typeof discoveryLog === 'undefined' || typeof saveDiscoveryLog !== 'function'){ if(typeof showToast === 'function') showToast('Library unavailable', 'error'); return; }
  const now = (typeof imperialNow === 'function') ? imperialNow() : null;
  discoveryLog.push({ id: 'disc_' + Date.now().toString(36), title: o.text, category: 'lore',
    body: o.faction ? ('Attributed to ' + o.faction + ' · ' + (o.reliability || '')) : (o.reliability || ''),
    state: 'rumoured', visibleTo: 'all', createdAt: now, revealedAt: now });
  saveDiscoveryLog();
  if(typeof discPanelOpen !== 'undefined' && discPanelOpen && typeof renderDiscoveryPanel === 'function') renderDiscoveryPanel();
  if(typeof showToast === 'function') showToast('Sent to Library Data');
}

// ── Dice checks ─────────────────────────────────────────────────────────────
// The referee preps a check (what it's for + target number) and, at the table,
// records who rolled, the result, an outcome, and the consequence. Resolved
// checks flow into the session recap (js/92 buildSessionLogText / generateSessionRecap).

function checkAdd(planId, sceneId){
  if(!isReferee()) return;
  const s = sceneById(planById(planId), sceneId); if(!s) return;
  if(!Array.isArray(s.checks)) s.checks = [];
  s.checks.push(emptyCheck());
  saveSessionPlans();
  renderPlannerDetail();
}
function checkEditField(planId, sceneId, checkId, field, value){
  if(!isReferee()) return;
  const s = sceneById(planById(planId), sceneId); if(!s) return;
  const c = (s.checks || []).find(x => x.id === checkId); if(!c) return;
  c[field] = value;
  saveSessionPlans();   // text inputs use onchange (blur) — no re-render, so focus survives
}
function checkSetOutcome(planId, sceneId, checkId, outcome){
  if(!isReferee()) return;
  const s = sceneById(planById(planId), sceneId); if(!s) return;
  const c = (s.checks || []).find(x => x.id === checkId); if(!c) return;
  c.outcome = outcome;
  saveSessionPlans();
  renderPlannerDetail();   // recolour the card + selected segment
}
function checkDelete(planId, sceneId, checkId){
  if(!isReferee()) return;
  const s = sceneById(planById(planId), sceneId); if(!s) return;
  s.checks = (s.checks || []).filter(x => x.id !== checkId);
  saveSessionPlans();
  renderPlannerDetail();
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════════════════

function renderPlanner(){ renderPlannerList(); if(plannerView === 'board') renderPlannerBoard(); else renderPlannerDetail(); syncPlannerViewToggle(); }
function plannerToggleView(){ plannerView = (plannerView === 'board') ? 'list' : 'board'; closePlannerPopover(); renderPlanner(); }
function syncPlannerViewToggle(){ const b = document.getElementById('planner-view-toggle'); if(b) b.textContent = (plannerView === 'board') ? '📋 List' : '🗺 Board'; }

function planStatusPill(status){
  const label = (PLAN_STATUS.find(x => x[0] === status) || [null, 'Planned'])[1];
  return `<span class="planner-pill st-${status || 'planned'}">${label}</span>`;
}

function renderPlannerList(){
  const rail = document.getElementById('planner-list'); if(!rail) return;
  if(!sessionPlans.length){
    rail.innerHTML = `<div class="planner-empty">No sessions yet.<br>Start one below.</div>`;
    return;
  }
  rail.innerHTML = sessionPlans.map(p => {
    const sc = (p.scenes || []).length;
    const done = (p.scenes || []).filter(s => s.done).length;
    const sub = [p.inGameDate, sc ? (done + '/' + sc + ' scenes') : 'no scenes'].filter(Boolean).join(' · ');
    return `<button class="planner-li${p.id === plannerSelId ? ' sel' : ''}" onclick="plannerSelect('${p.id}')">
      <span class="planner-li-top">${planStatusPill(p.status)}<span class="planner-li-title">${sesc(p.title || 'Untitled')}</span></span>
      <span class="planner-li-sub">${sesc(sub)}</span>
    </button>`;
  }).join('');
}

function renderPlannerDetail(){
  const el = document.getElementById('planner-detail'); if(!el) return;
  const p = selPlan();
  if(!p){
    el.innerHTML = `<div class="planner-detail-empty">
      <div class="planner-detail-empty-ic">🗓</div>
      <div>Pick a session on the left, or create one, to start prepping.</div>
      <div class="planner-hint" style="margin-top:10px">Break a session into scenes, then link each scene to the NPCs, missions and oracle rolls you'll need — all in one place.</div>
    </div>`;
    return;
  }
  const statusOpts = PLAN_STATUS.map(([v, l]) =>
    `<button class="planner-status-opt${p.status === v ? ' on' : ''}" onclick="plannerSetStatus('${p.id}','${v}')">${l}</button>`).join('');

  const scenes = (p.scenes || []).map((s, i) => renderSceneCard(p, s, i, (p.scenes || []).length)).join('');

  el.innerHTML = `
    <div class="planner-back-row"><button class="planner-back" onclick="plannerBackToList()">‹ Sessions</button></div>
    <div class="planner-sess-head">
      <input class="planner-title-input" value="${sattr(p.title)}" placeholder="Session title"
             onchange="plannerEditField('${p.id}','title',this.value)">
      <div class="planner-sess-actions">
        <button class="disc-mini" onclick="plannerDuplicateSession('${p.id}')" title="Duplicate session">⧉</button>
        <button class="disc-mini del" onclick="plannerDeleteSession('${p.id}')" title="Delete session">✕</button>
      </div>
    </div>
    <div class="planner-meta-row">
      <input class="planner-date-input" value="${sattr(p.inGameDate)}" placeholder="In-game date / when"
             onchange="plannerEditField('${p.id}','inGameDate',this.value)">
      <div class="planner-status-seg">${statusOpts}</div>
    </div>
    <div class="planner-sec-hd"><span>Premise</span></div>
    ${renderRichField('premise', p.premise, 'Premise — the one-line hook for this session', p.id, '')}

    <div class="planner-sec-hd"><span>Scenes &amp; Beats</span><span class="planner-count">${(p.scenes || []).length}</span></div>
    <div class="planner-scenes">${scenes || '<div class="planner-hint">No scenes yet.</div>'}</div>
    <button class="cal-add-btn planner-add-scene" onclick="sceneAdd('${p.id}')">+ Add scene</button>

    <div class="planner-sec-hd" style="margin-top:16px"><span>Prep Notes</span></div>
    ${renderRichField('prep', p.prep, 'Loose prep notes, reminders, a checklist…', p.id, '')}

    <div class="planner-sec-hd" style="margin-top:16px"><span>Reference Documents</span><span class="planner-count">${(p.docs || []).length}</span></div>
    <div class="planner-docs">${renderPlannerDocs(p) || '<div class="planner-hint">No PDFs attached. Upload adventure modules, maps or notes to keep them on hand.</div>'}</div>
    <label class="cal-add-btn planner-add-doc">+ Upload PDF<input type="file" accept="application/pdf" style="display:none" onchange="onPlannerDocFile(this,'${p.id}')"></label>

    <div class="planner-foot">
      <button class="planner-foot-btn" onclick="plannerOpenRecap()" title="Open the recap & export tool">🎬 Recap &amp; export</button>
    </div>`;
  wirePlannerRich();
}

function renderSceneCard(p, s, idx, total){
  const typeIcon = (SCENE_TYPES.find(t => t[0] === s.type) || SCENE_TYPES[0])[1];
  const typeOpts = SCENE_TYPES.map(([v, l]) =>
    `<option value="${v}"${s.type === v ? ' selected' : ''}>${l}</option>`).join('');

  // Linked NPCs
  const npcChips = (s.npcIds || []).map(id => {
    const n = (typeof npcById === 'function') ? npcById(id) : null;
    const label = n ? (n.name || 'NPC') + (n.role ? ' · ' + n.role : '') : '(deleted NPC)';
    return `<span class="planner-chip npc${n ? '' : ' missing'}">${sesc(label)}
      <button class="planner-chip-x" onclick="sceneUnlinkNpc('${p.id}','${s.id}','${id}')" title="Unlink">✕</button></span>`;
  }).join('');

  // Linked missions
  const mChips = (s.missionIds || []).map(id => {
    const q = (typeof questLog !== 'undefined') ? questLog.find(x => x.id === id) : null;
    if(!q) return `<span class="planner-chip mission missing">(deleted mission)
      <button class="planner-chip-x" onclick="sceneUnlinkMission('${p.id}','${s.id}','${id}')" title="Unlink">✕</button></span>`;
    const revealed = q.status === 'active';
    const stCls = q.status === 'active' ? 'live' : (q.status === 'complete' ? 'done' : 'hidden');
    return `<span class="planner-chip mission ${stCls}">${sesc(q.title || 'Mission')}
      <button class="planner-chip-act" onclick="missionReveal('${id}')" title="${revealed ? 'Hide from players' : 'Reveal to players'}">${revealed ? '👁 live' : '⦿ reveal'}</button>
      <button class="planner-chip-x" onclick="sceneUnlinkMission('${p.id}','${s.id}','${id}')" title="Unlink">✕</button></span>`;
  }).join('');

  // Pinned oracle draws
  const oracle = (s.oracle || []).map(o => {
    const meta = o.kind === 'encounter'
      ? `<span class="planner-or-tag enc">${sesc(o.difficulty || 'Encounter')}</span>${o.faction ? `<span class="planner-or-tag">${sesc(o.faction)}</span>` : ''}`
      : `${o.source === 'market' ? '<span class="planner-or-tag mkt">📈 market</span>' : ''}${o.source === 'contract' ? '<span class="planner-or-tag con">📋 contract</span>' : ''}${o.faction ? `<span class="planner-or-tag">${sesc(o.faction)}</span>` : ''}${o.reliability ? `<span class="planner-or-tag">${sesc(o.reliability)}</span>` : ''}`;
    const promote = o.kind === 'rumour'
      ? `<button class="disc-mini" onclick="sceneOracleToLibrary('${p.id}','${s.id}','${o.id}')" title="Send to Library Data as a rumour players can overhear">→ Library</button>` +
        (o.contract ? `<button class="disc-mini" onclick="sceneOracleToQuest('${p.id}','${s.id}','${o.id}')" title="Post this contract to the Quest Log">→ Quest Log</button>` : '')
      : '';
    return `<div class="planner-or">
      <div class="planner-or-text">${o.kind === 'rumour' ? '“' + sesc(o.text) + '”' : sesc(o.text)}</div>
      <div class="planner-or-meta">${meta}${promote}
        <button class="disc-mini del" onclick="sceneOracleRemove('${p.id}','${s.id}','${o.id}')" title="Remove">✕</button></div>
    </div>`;
  }).join('');

  // Dice checks — prep the check, record the roll + outcome at the table
  const checks = (s.checks || []).map(c => {
    const outSeg = CHECK_OUTCOMES.map(([v, l]) =>
      `<button class="planner-ck-out o-${v}${(c.outcome || 'pending') === v ? ' on' : ''}" onclick="checkSetOutcome('${p.id}','${s.id}','${c.id}','${v}')">${l}</button>`).join('');
    return `<div class="planner-check outcome-${c.outcome || 'pending'}">
      <div class="planner-check-top">
        <input class="planner-ck-label" value="${sattr(c.label)}" placeholder="Check — e.g. Recon to spot the ambush" onchange="checkEditField('${p.id}','${s.id}','${c.id}','label',this.value)">
        <input class="planner-ck-target" value="${sattr(c.target)}" placeholder="8+" onchange="checkEditField('${p.id}','${s.id}','${c.id}','target',this.value)">
        <button class="disc-mini del" onclick="checkDelete('${p.id}','${s.id}','${c.id}')" title="Delete check">✕</button>
      </div>
      <div class="planner-check-mid">
        <input class="planner-ck-who" value="${sattr(c.who)}" placeholder="Who rolled" onchange="checkEditField('${p.id}','${s.id}','${c.id}','who',this.value)">
        <input class="planner-ck-roll" value="${sattr(c.roll)}" placeholder="Result — e.g. 10 (Effect +2)" onchange="checkEditField('${p.id}','${s.id}','${c.id}','roll',this.value)">
      </div>
      <div class="planner-ck-outrow">${outSeg}</div>
      <input class="planner-ck-notes" value="${sattr(c.notes)}" placeholder="Outcome — what happened as a result" onchange="checkEditField('${p.id}','${s.id}','${c.id}','notes',this.value)">
    </div>`;
  }).join('');

  return `<div class="planner-scene${s.done ? ' done' : ''}" id="scene-card-${s.id}">
    <div class="planner-scene-hd">
      <button class="planner-scene-check${s.done ? ' on' : ''}" onclick="sceneToggleDone('${p.id}','${s.id}')" title="Mark scene played">${s.done ? '✓' : ''}</button>
      <input class="planner-scene-title" value="${sattr(s.title)}" placeholder="Scene ${idx + 1} title"
             onchange="sceneEditField('${p.id}','${s.id}','title',this.value)">
      <select class="planner-scene-type" onchange="sceneEditField('${p.id}','${s.id}','type',this.value)">${typeOpts}</select>
      <span class="planner-scene-move">
        <button class="disc-mini" onclick="sceneMove('${p.id}','${s.id}',-1)" title="Move up"${idx === 0 ? ' disabled' : ''}>↑</button>
        <button class="disc-mini" onclick="sceneMove('${p.id}','${s.id}',1)" title="Move down"${idx === total - 1 ? ' disabled' : ''}>↓</button>
        <button class="disc-mini del" onclick="sceneDelete('${p.id}','${s.id}')" title="Delete scene">✕</button>
      </span>
    </div>

    <div class="planner-rich-lbl">📖 Read-aloud / boxed text</div>
    ${renderRichField('readAloud', s.readAloud, '📖 Read-aloud / boxed text', p.id, s.id)}
    <div class="planner-rich-lbl">🗒 Referee notes</div>
    ${renderRichField('refNotes', s.refNotes, "Referee notes — what's really going on, checks, outcomes", p.id, s.id)}

    <div class="planner-link-block">
      <div class="planner-link-lbl">👥 NPCs</div>
      <div class="planner-chips">${npcChips}<button class="planner-link-add" onclick="openLinkPicker('${p.id}','${s.id}','npc')">+ Link NPC</button></div>
    </div>
    <div class="planner-link-block">
      <div class="planner-link-lbl">🎯 Missions</div>
      <div class="planner-chips">${mChips}<button class="planner-link-add" onclick="openLinkPicker('${p.id}','${s.id}','mission')">+ Link mission</button></div>
    </div>
    <div class="planner-link-block">
      <div class="planner-link-lbl">⚄ Checks &amp; outcomes</div>
      <div class="planner-check-list">${checks}</div>
      <button class="cal-add-btn planner-add-check" onclick="checkAdd('${p.id}','${s.id}')">+ Add dice check</button>
    </div>
    <div class="planner-link-block">
      <div class="planner-link-lbl">🎲 Oracle</div>
      <div class="planner-or-list">${oracle}</div>
      <div class="planner-or-btns">
        <button class="planner-or-roll" onclick="sceneRollOracle('${p.id}','${s.id}','rumour')">🎲 Rumour</button>
        <button class="planner-or-roll" onclick="sceneRollOracle('${p.id}','${s.id}','market')" title="Pull a true rumour from the living economy">📈 Market</button>
        <button class="planner-or-roll" onclick="sceneRollOracle('${p.id}','${s.id}','encounter')">⚔ Encounter</button>
      </div>
    </div>
  </div>`;
}

function renderLinkPicker(){
  if(plannerPicker && plannerPicker.mode === 'link'){ renderRichLinkPicker(); return; }
  const wrap = document.getElementById('planner-picker');
  const card = document.getElementById('planner-picker-card');
  if(!wrap || !card || !plannerPicker){ if(wrap) wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  const { planId, sceneId, type, q } = plannerPicker;
  const scene = sceneById(planById(planId), sceneId);
  const query = (q || '').trim().toLowerCase();
  let rows = '', createBtn = '', title = '';

  if(type === 'npc'){
    title = 'Link an NPC';
    const roster = (typeof npcRoster !== 'undefined') ? npcRoster : [];
    const linked = scene ? scene.npcIds : [];
    const matches = roster.filter(n => !query || [n.name, n.role, n.faction, n.location].some(x => (x || '').toLowerCase().includes(query)));
    rows = matches.length ? matches.map(n => {
      const on = linked.includes(n.id);
      const meta = [n.role, n.faction].filter(Boolean).map(sesc).join(' · ');
      return `<button class="planner-pick-row${on ? ' on' : ''}" ${on ? 'disabled' : `onclick="sceneLinkNpc('${planId}','${sceneId}','${n.id}')"`}>
        <span class="planner-pick-name">${sesc(n.name || '(unnamed)')}</span>${meta ? `<span class="planner-pick-meta">${meta}</span>` : ''}${on ? '<span class="planner-pick-on">linked</span>' : ''}</button>`;
    }).join('') : `<div class="planner-hint" style="padding:8px 4px">${roster.length ? 'No roster NPCs match.' : 'No NPCs in the roster yet.'}</div>`;
    createBtn = `<button class="cal-add-btn planner-pick-create" onclick="sceneNewNpc('${planId}','${sceneId}', document.getElementById('planner-pick-search').value)">+ Create NPC "${sesc(q || '') || '…'}" &amp; link</button>`;
  } else {
    title = 'Link a mission';
    const log = (typeof questLog !== 'undefined') ? questLog : [];
    const linked = scene ? scene.missionIds : [];
    const matches = log.filter(m => !query || (m.title || '').toLowerCase().includes(query));
    rows = matches.length ? matches.map(m => {
      const on = linked.includes(m.id);
      const stCls = m.status === 'active' ? 'live' : (m.status === 'complete' ? 'done' : 'hidden');
      return `<button class="planner-pick-row${on ? ' on' : ''}" ${on ? 'disabled' : `onclick="sceneLinkMission('${planId}','${sceneId}','${m.id}')"`}>
        <span class="planner-pick-name">${sesc(m.title || 'Mission')}</span><span class="planner-pick-meta ${stCls}">${m.status}</span>${on ? '<span class="planner-pick-on">linked</span>' : ''}</button>`;
    }).join('') : `<div class="planner-hint" style="padding:8px 4px">${log.length ? 'No missions match.' : 'No missions yet.'}</div>`;
    createBtn = `<button class="cal-add-btn planner-pick-create" onclick="sceneNewMission('${planId}','${sceneId}', document.getElementById('planner-pick-search').value)">+ Create mission "${sesc(q || '') || '…'}" (hidden) &amp; link</button>`;
  }

  card.innerHTML = `
    <div class="planner-pick-hd"><span>${title}</span><button class="planner-pick-close" onclick="closeLinkPicker()">✕</button></div>
    <input id="planner-pick-search" class="planner-pick-search" placeholder="🔍 Search or type a new name…" value="${sattr(q || '')}" oninput="plannerPickerSearch(this.value)">
    <div class="planner-pick-list">${rows}</div>
    ${createBtn}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// RICH TEXT  —  contenteditable prose fields (read-aloud / notes / premise / prep)
// ═══════════════════════════════════════════════════════════════════════════
// The four prose fields are lightweight WYSIWYG editors: a small toolbar drives
// document.execCommand (semantic tags only — styleWithCSS is forced OFF so we get
// <b>/<i>/<u>, which sanitizeRich() keeps). Content commits on blur (and a debounced
// input) through the existing sceneEditField()/plannerEditField(), always via
// sanitizeRich() so nothing but the whitelist is ever stored. The 🔗 button opens
// the link picker (scene / quest / location / PDF / URL).

function plTrunc(s, n){ s = String(s == null ? '' : s); return s.length > n ? (s.slice(0, n - 1).replace(/\s+$/, '') + '…') : s; }

function renderRichField(field, html, ph, planId, sceneId){
  const btns = [
    ['bold', '<b>B</b>', 'Bold'], ['italic', '<i>I</i>', 'Italic'], ['underline', '<u>U</u>', 'Underline'],
    ['sep'],
    ['insertUnorderedList', '•', 'Bulleted list'], ['insertOrderedList', '1.', 'Numbered list'], ['heading', 'H', 'Heading'],
    ['sep'],
    ['link', '🔗', 'Insert a link to a scene, quest, location, PDF or URL'], ['unlink', '⛓', 'Remove link']
  ].map(t => t[0] === 'sep'
    ? '<span class="pr-tb-sep"></span>'
    : `<button type="button" class="pr-tb" title="${sattr(t[2])}" onmousedown="return plannerRichCmd(event,this,'${t[0]}')">${t[1]}</button>`).join('');
  return `<div class="planner-rich-wrap">
    <div class="planner-rich-tb">${btns}</div>
    <div class="planner-rich" contenteditable="true" data-field="${sattr(field)}" data-plan="${sattr(planId)}" data-scene="${sattr(sceneId || '')}" data-ph="${sattr(ph || '')}">${sanitizeRich(html || '')}</div>
  </div>`;
}

// Toolbar handler — mousedown (not click) so the editable keeps its selection.
function plannerRichCmd(ev, btn, cmd){
  if(ev) ev.preventDefault();
  const wrap = btn.closest('.planner-rich-wrap');
  const ed = wrap ? wrap.querySelector('.planner-rich') : null;
  if(!ed) return false;
  ed.focus();
  if(cmd === 'link'){ openRichLink(ed); return false; }
  try {
    try { document.execCommand('styleWithCSS', false, false); } catch(e){}   // semantic tags, not inline styles
    if(cmd === 'heading'){
      let cur = ''; try { cur = String(document.queryCommandValue('formatBlock') || '').toLowerCase(); } catch(e){}
      document.execCommand('formatBlock', false, (cur === 'h4' || cur === '<h4>') ? 'p' : 'h4');
    } else {
      document.execCommand(cmd, false, null);
    }
  } catch(e){}
  scheduleRichCommit(ed);
  return false;
}

function scheduleRichCommit(ed){
  if(_richTimer) clearTimeout(_richTimer);
  _richTimer = setTimeout(() => { _richTimer = null; commitRich(ed); }, 800);
}
// Sanitise + persist a rich field, but only if it actually changed (no redundant writes).
function commitRich(ed){
  if(!ed) return;
  if(_richTimer){ clearTimeout(_richTimer); _richTimer = null; }
  const field = ed.getAttribute('data-field');
  const planId = ed.getAttribute('data-plan');
  const sceneId = ed.getAttribute('data-scene') || '';
  if(!field || !planId) return;
  const clean = sanitizeRich(ed.innerHTML);
  const cur = sceneId ? ((sceneById(planById(planId), sceneId) || {})[field]) : ((planById(planId) || {})[field]);
  if((cur || '') === clean) return;
  if(sceneId) sceneEditField(planId, sceneId, field, clean);
  else plannerEditField(planId, field, clean);
}
function commitAllRich(){
  try { document.querySelectorAll('#planner-detail .planner-rich').forEach(ed => commitRich(ed)); } catch(e){}
}
// Attach commit + link-follow listeners to the freshly-rendered editors.
function wirePlannerRich(){
  try {
    document.querySelectorAll('#planner-detail .planner-rich').forEach(ed => {
      if(ed._wired) return;
      ed._wired = true;
      ed.addEventListener('blur', () => commitRich(ed));
      ed.addEventListener('input', () => scheduleRichCommit(ed));
      ed.addEventListener('click', plannerRichLinkClick);
    });
  } catch(e){}
}
// Click a link inside an editable → follow it instead of just placing the caret.
function plannerRichLinkClick(ev){
  const a = ev.target && ev.target.closest ? ev.target.closest('a[data-link], a[href]') : null;
  if(!a) return;
  ev.preventDefault();
  const dl = a.getAttribute('data-link');
  if(dl){ dispatchPlannerLink(dl, a); return; }
  const href = a.getAttribute('href');
  if(href && /^(https?:|mailto:)/i.test(href)) window.open(href, '_blank', 'noopener');
}

// ═══════════════════════════════════════════════════════════════════════════
// LINK PICKER  —  insert an inline hyperlink into the focused editor
// ═══════════════════════════════════════════════════════════════════════════

function openRichLink(ed){
  const sel = window.getSelection();
  let range = null;
  try { if(sel && sel.rangeCount) range = sel.getRangeAt(0).cloneRange(); } catch(e){}
  plannerLinkCtx = {
    planId: ed.getAttribute('data-plan'),
    sceneId: ed.getAttribute('data-scene') || '',
    field: ed.getAttribute('data-field'),
    range: range,
    selText: sel ? String(sel).trim() : ''
  };
  plannerPicker = { mode: 'link', linkType: 'scene', q: '' };
  renderLinkPicker();
  setTimeout(() => { const s = document.getElementById('planner-pick-search'); if(s) s.focus(); }, 60);
}
function plannerLinkType(t){
  if(!plannerPicker) return;
  plannerPicker.linkType = t; plannerPicker.q = '';
  renderLinkPicker();
  setTimeout(() => { const s = document.getElementById('planner-pick-search'); if(s) s.focus(); }, 40);
}

function renderRichLinkPicker(){
  const wrap = document.getElementById('planner-picker');
  const card = document.getElementById('planner-picker-card');
  if(!wrap || !card || !plannerLinkCtx){ if(wrap) wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  const lt = plannerPicker.linkType || 'scene';
  const q = (plannerPicker.q || '').trim().toLowerCase();
  const tabs = [['scene', '🎬 Scene'], ['quest', '🎯 Quest'], ['location', '📍 Location'], ['pdf', '📄 PDF'], ['url', '🔗 URL']]
    .map(([v, l]) => `<button class="planner-linktab${lt === v ? ' on' : ''}" onclick="plannerLinkType('${v}')">${l}</button>`).join('');

  let body = '';
  if(lt === 'url'){
    body = `<div class="planner-link-url">
      <input id="planner-link-url-in" class="planner-pick-search" placeholder="https://…  or  mailto:…">
      <input id="planner-link-url-lbl" class="planner-pick-search" placeholder="Link text (optional)" value="${sattr(plannerLinkCtx.selText || '')}">
      <button class="cal-add-btn" onclick="insertRichUrl()">Insert link</button>
    </div>`;
  } else {
    let rows = [];
    if(lt === 'scene'){
      const p = selPlan(); const scenes = (p && p.scenes) || [];
      rows = scenes.filter(s => s.id !== plannerLinkCtx.sceneId).map(s => ({ ref: 'scene:' + s.id, label: (s.title || 'Untitled scene'), meta: (SCENE_TYPES.find(t => t[0] === s.type) || SCENE_TYPES[0])[1] }));
    } else if(lt === 'quest'){
      const log = (typeof questLog !== 'undefined') ? questLog : [];
      rows = log.map(m => ({ ref: 'quest:' + m.id, label: (m.title || 'Mission'), meta: m.status || '' }));
    } else if(lt === 'location'){
      rows = buildLocationTargets().map(t => ({ ref: t.ref, label: t.icon + ' ' + t.label, meta: t.meta }));
    } else if(lt === 'pdf'){
      const p = selPlan(); const docs = (p && p.docs) || [];
      rows = docs.map(d => ({ ref: 'pdf:' + d.id, label: (d.name || 'Document.pdf'), meta: 'PDF' }));
    }
    const filtered = rows.filter(r => !q || (r.label + ' ' + (r.meta || '')).toLowerCase().includes(q));
    body = `<input id="planner-pick-search" class="planner-pick-search" placeholder="🔍 Search…" value="${sattr(plannerPicker.q || '')}" oninput="plannerPickerSearch(this.value)">
      <div class="planner-pick-list">${filtered.length
        ? filtered.map(r => `<button class="planner-pick-row" onclick="insertRichLink('${sattr(r.ref)}')">
            <span class="planner-pick-name">${sesc(r.label)}</span>${r.meta ? `<span class="planner-pick-meta">${sesc(r.meta)}</span>` : ''}</button>`).join('')
        : `<div class="planner-hint" style="padding:8px 4px">Nothing to link here yet.</div>`}</div>`;
  }
  card.innerHTML = `<div class="planner-pick-hd"><span>Insert link</span><button class="planner-pick-close" onclick="closeLinkPicker()">✕</button></div>
    <div class="planner-linktabs">${tabs}</div>
    ${body}`;
}

// Enumerate linkable in-world places: galaxy systems/nodes, worlds, and their locations.
function buildLocationTargets(){
  const out = [];
  try {
    if(typeof GALAXY_NODES !== 'undefined' && Array.isArray(GALAXY_NODES)){
      GALAXY_NODES.forEach(n => {
        if(!n || !n.id) return;
        if(n.systemId && typeof SYSTEMS !== 'undefined' && SYSTEMS[n.systemId])
          out.push({ ref: 'location:system:' + n.systemId, label: n.name || n.id, icon: '🌌', meta: 'system' });
        else
          out.push({ ref: 'location:node:' + n.id, label: n.name || n.id, icon: '✦', meta: 'star' });
      });
    }
  } catch(e){}
  try {
    if(typeof SYSTEMS !== 'undefined'){
      Object.keys(SYSTEMS).forEach(sysId => {
        let bodies = [];
        try { bodies = (typeof getBodies === 'function') ? (getBodies(sysId) || []) : ((SYSTEMS[sysId] && SYSTEMS[sysId].base) || []); } catch(e){ bodies = (SYSTEMS[sysId] && SYSTEMS[sysId].base) || []; }
        bodies.forEach(b => {
          if(!b || !b.id) return;
          out.push({ ref: 'location:body:' + sysId + ':' + b.id, label: b.name || b.id, icon: '🪐', meta: 'world' });
          let locs = [];
          try {
            if(typeof effectiveLocations === 'function') locs = effectiveLocations(sysId, b.id) || [];
            else if(typeof BASE_LOCATIONS !== 'undefined' && BASE_LOCATIONS[sysId]) locs = BASE_LOCATIONS[sysId][b.id] || [];
          } catch(e){ locs = []; }
          locs.forEach(l => { if(l && l.id) out.push({ ref: 'location:loc:' + sysId + ':' + b.id + ':' + l.id, label: l.name || l.id, icon: '📍', meta: (b.name || b.id) }); });
        });
      });
    }
  } catch(e){}
  return out;
}
function refDefaultLabel(ref){
  const ci = ref.indexOf(':'); const kind = ci < 0 ? ref : ref.slice(0, ci); const rest = ci < 0 ? '' : ref.slice(ci + 1);
  if(kind === 'scene'){ const p = selPlan(); const s = p && sceneById(p, rest); return s ? (s.title || 'Scene') : 'Scene'; }
  if(kind === 'quest'){ const m = (typeof questLog !== 'undefined') ? questLog.find(x => x.id === rest) : null; return m ? (m.title || 'Mission') : 'Mission'; }
  if(kind === 'pdf'){ const p = selPlan(); const d = p && (p.docs || []).find(x => x.id === rest); return d ? (d.name || 'Document') : 'Document'; }
  if(kind === 'location'){ const t = buildLocationTargets().find(x => x.ref === ref); return t ? t.label : 'Location'; }
  return 'link';
}
function _findRichEditor(ctx){
  const eds = document.querySelectorAll('#planner-detail .planner-rich');
  for(let i = 0; i < eds.length; i++){
    const ed = eds[i];
    if(ed.getAttribute('data-field') === ctx.field && (ed.getAttribute('data-scene') || '') === ctx.sceneId && ed.getAttribute('data-plan') === ctx.planId) return ed;
  }
  return null;
}
function _insertLinkFrag(ctx, frag){
  const ed = _findRichEditor(ctx);
  closeLinkPicker();
  if(!ed) return;
  ed.focus();
  try { if(ctx.range){ const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(ctx.range); } } catch(e){}
  try { document.execCommand('insertHTML', false, frag); } catch(e){ ed.insertAdjacentHTML('beforeend', frag); }
  commitRich(ed);
}
function insertRichLink(ref){
  const ctx = plannerLinkCtx; if(!ctx){ closeLinkPicker(); return; }
  const label = ctx.selText || refDefaultLabel(ref);
  _insertLinkFrag(ctx, `<a data-link="${sattr(ref)}">${sesc(label)}</a>&nbsp;`);
}
function insertRichUrl(){
  const ctx = plannerLinkCtx; if(!ctx){ closeLinkPicker(); return; }
  const raw = (document.getElementById('planner-link-url-in') || {}).value || '';
  const u = raw.trim();
  if(!/^(https?:|mailto:)/i.test(u)){ if(typeof showToast === 'function') showToast('Enter a http(s):// or mailto: link', 'error'); return; }
  let label = (document.getElementById('planner-link-url-lbl') || {}).value || '';
  label = label.trim() || ctx.selText || u;
  _insertLinkFrag(ctx, `<a href="${sattr(u)}" target="_blank" rel="noopener noreferrer">${sesc(label)}</a>&nbsp;`);
}

// ═══════════════════════════════════════════════════════════════════════════
// LINK DISPATCH  —  what happens when the referee clicks an inline link
// ═══════════════════════════════════════════════════════════════════════════

function dispatchPlannerLink(ref, anchorEl){
  if(!ref) return;
  const ci = ref.indexOf(':'); const kind = ci < 0 ? ref : ref.slice(0, ci); const rest = ci < 0 ? '' : ref.slice(ci + 1);
  if(kind === 'scene') plannerJumpToScene(rest);
  else if(kind === 'quest') plannerOpenQuest(rest);
  else if(kind === 'location') plannerLocationAction(ref, anchorEl);
  else if(kind === 'pdf') plannerDocOpen(rest);
}
function plannerJumpToScene(sceneId){
  const p = selPlan(); if(!p) return;
  if(!sceneById(p, sceneId)){ if(typeof showToast === 'function') showToast('That scene is in another session', 'info'); return; }
  if(plannerView !== 'list'){ plannerView = 'list'; renderPlanner(); }
  const card = document.getElementById('scene-card-' + sceneId);
  if(card){ card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1200); }
}
function plannerOpenQuest(qId){
  const q = (typeof questLog !== 'undefined') ? questLog.find(x => x.id === qId) : null;
  if(typeof toggleQuestPanel === 'function'){
    if(typeof questPanelOpen !== 'undefined' && !questPanelOpen) toggleQuestPanel();
    else if(typeof renderQuestPanel === 'function') renderQuestPanel();
  }
  if(typeof showToast === 'function') showToast(q ? ('Quest: ' + (q.title || 'Mission')) : 'Quest not found', q ? 'info' : 'error');
}
function parseLocationRef(rest){
  const parts = String(rest || '').split(':'); const sub = parts[0];
  if(sub === 'node') return { sub, nodeId: parts[1] };
  if(sub === 'system') return { sub, systemId: parts[1] };
  if(sub === 'body') return { sub, systemId: parts[1], bodyId: parts[2] };
  if(sub === 'loc') return { sub, systemId: parts[1], bodyId: parts[2], locId: parts[3] };
  return { sub: 'unknown' };
}
function locSpecFromRef(loc){
  if(!loc) return null;
  if(loc.sub === 'node') return { view: 'galaxy' };
  if(loc.sub === 'system') return { view: 'system', systemId: loc.systemId };
  if(loc.sub === 'body') return { view: 'body', systemId: loc.systemId, bodyId: loc.bodyId };
  if(loc.sub === 'loc') return { view: 'body', systemId: loc.systemId, bodyId: loc.bodyId, locId: loc.locId };
  return null;
}
// A location link offers two actions: go there yourself, or present it to the table.
function plannerLocationAction(fullRef, anchorEl){
  _pendingLoc = { ref: fullRef, label: (anchorEl && anchorEl.textContent) ? anchorEl.textContent.trim() : 'location' };
  const rect = anchorEl ? anchorEl.getBoundingClientRect() : { left: 200, bottom: 200 };
  const html = `<div class="pp-title">${sesc(_pendingLoc.label)}</div>
    <button class="pp-act" onclick="plannerGoLocation()">🧭 Go there</button>
    <button class="pp-act" onclick="plannerSendPlayersToLocation()">📡 Send players here</button>`;
  plannerPopover(html, rect.left, rect.bottom + 4);
}
function plannerGoLocation(){
  const pl = _pendingLoc; closePlannerPopover(); if(!pl) return;
  const spec = locSpecFromRef(parseLocationRef(pl.ref.replace(/^location:/, '')));
  if(spec && typeof applyViewSpec === 'function'){ applyViewSpec(spec); closeSessionPlanner(); }
}
function plannerSendPlayersToLocation(){
  const pl = _pendingLoc; closePlannerPopover(); if(!pl) return;
  const spec = locSpecFromRef(parseLocationRef(pl.ref.replace(/^location:/, '')));
  if(spec) forcedViewSet(spec, pl.label);
}

// ═══════════════════════════════════════════════════════════════════════════
// FORCE VIEW (referee side)  —  push a "come look at this" to player devices
// ═══════════════════════════════════════════════════════════════════════════
// Writes the shared 'forced-view' key; the player poll (js/55) surfaces a
// dismissible soft-follow banner. Release clears it. All referee-gated.

async function forcedViewSet(spec, label){
  if(typeof isReferee === 'function' && !isReferee()) return;
  const payload = Object.assign({}, spec, { label: label || '', ts: Date.now() });
  try {
    await supaStorage.set('forced-view', JSON.stringify(payload), true);
    if(typeof showToast === 'function') showToast('📡 Players invited to ' + (label || 'this view'), 'success');
  } catch(e){
    if(typeof pushErr === 'function') pushErr('forcedViewSet failed', e && e.stack);
    if(typeof showToast === 'function') showToast('Could not send view', 'error');
  }
}
async function forcedViewRelease(){
  if(typeof isReferee === 'function' && !isReferee()) return;
  try {
    await supaStorage.set('forced-view', JSON.stringify({ cleared: true, ts: Date.now() }), true);
    if(typeof showToast === 'function') showToast('🔓 Players are free to navigate', 'info');
  } catch(e){
    if(typeof showToast === 'function') showToast('Could not release players', 'error');
  }
}
// Snapshot the referee's CURRENT view and present it (More-menu entry point).
function plannerSendCurrentView(){
  if(typeof isReferee === 'function' && !isReferee()) return;
  const spec = {
    view: (typeof currentView !== 'undefined') ? currentView : 'galaxy',
    systemId: (typeof currentSystemId !== 'undefined') ? currentSystemId : null,
    bodyId: (typeof selectedBody !== 'undefined') ? selectedBody : null,
    locId: (typeof selectedBodyLoc !== 'undefined') ? selectedBodyLoc : null,
    // Carry the station id so "Send current view" lands players on the authored
    // station's deck plan too — applyViewSpec (js/55) re-enters it by id.
    stationId: (typeof currentStationId !== 'undefined') ? currentStationId : null
  };
  forcedViewSet(spec, currentViewLabel(spec));
}
function currentViewLabel(spec){
  spec = spec || {};
  if(spec.view === 'galaxy') return 'the galaxy map';
  if(spec.view === 'station') return 'the station';
  const nameOf = (id) => {
    try {
      const sys = SYSTEMS[spec.systemId] || SYSTEMS[currentSystemId];
      const bodies = (typeof getBodies === 'function') ? getBodies(spec.systemId || currentSystemId) : (sys && sys.base);
      const b = (bodies || []).find(x => x.id === id);
      return b ? b.name : id;
    } catch(e){ return id; }
  };
  if(spec.locId) return nameOf(spec.bodyId) + ' · ' + spec.locId;
  if(spec.bodyId) return nameOf(spec.bodyId);
  return spec.view || 'this view';
}

// ═══════════════════════════════════════════════════════════════════════════
// POPOVER  —  small floating panel (location actions + board scene preview)
// ═══════════════════════════════════════════════════════════════════════════

function plannerPopover(html, x, y){
  closePlannerPopover();
  const div = document.createElement('div');
  div.id = 'planner-popover';
  div.innerHTML = html;
  document.body.appendChild(div);
  const w = div.offsetWidth || 240, h = div.offsetHeight || 120;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = Math.min(Math.max(8, x), vw - w - 8);
  let top = Math.min(Math.max(8, y), vh - h - 8);
  div.style.left = left + 'px';
  div.style.top = top + 'px';
  setTimeout(() => document.addEventListener('mousedown', _popoverOutside), 0);
}
function closePlannerPopover(){
  const el = document.getElementById('planner-popover');
  if(el) el.remove();
  document.removeEventListener('mousedown', _popoverOutside);
}
function _popoverOutside(e){
  const el = document.getElementById('planner-popover');
  if(el && !el.contains(e.target)) closePlannerPopover();
}

// ═══════════════════════════════════════════════════════════════════════════
// REFERENCE DOCUMENTS  —  attach PDFs to a session plan (Supabase 'session-docs')
// ═══════════════════════════════════════════════════════════════════════════

function plannerDocCampaign(){
  if(typeof hoCampaign === 'function') return hoCampaign();
  if(typeof activeCampaignId === 'function') return activeCampaignId();
  return 'default';
}
function renderPlannerDocs(p){
  return ((p && p.docs) || []).map(d => `<div class="planner-doc">
    <button class="planner-doc-open" onclick="plannerDocOpen('${d.id}')" title="Open in the browser's PDF viewer">📄 ${sesc(d.name || 'Document.pdf')}</button>
    <button class="disc-mini del" onclick="plannerDocRemove('${d.id}')" title="Remove from this session">✕</button>
  </div>`).join('');
}
async function onPlannerDocFile(input, planId){
  if(typeof isReferee === 'function' && !isReferee()) return;
  const file = input && input.files && input.files[0];
  if(input) input.value = '';
  if(!file) return;
  if(file.type !== 'application/pdf'){ if(typeof showToast === 'function') showToast('PDF files only', 'error'); return; }
  if(file.size > 83886080){ if(typeof showToast === 'function') showToast('PDF too large (80 MB max)', 'error'); return; }
  const p = planById(planId); if(!p) return;
  if(!Array.isArray(p.docs)) p.docs = [];
  const id = _pid('doc_'); const ver = Date.now();
  if(typeof showToast === 'function') showToast('Uploading PDF…', 'info');
  try {
    await uploadPlannerDocBlob(plannerDocCampaign(), id, file);
    p.docs.push({ id, name: (file.name || 'Document.pdf').slice(0, 120), ver, uploadedAt: ver });
    saveSessionPlans();
    renderPlannerDetail();
    if(typeof showToast === 'function') showToast('PDF attached', 'success');
  } catch(e){
    if(typeof pushErr === 'function') pushErr('Planner PDF upload failed', e && e.stack);
    if(typeof showToast === 'function') showToast('Upload failed — is the session-docs bucket set up?', 'error');
  }
}
function plannerDocOpen(id){
  const p = selPlan(); const d = p && (p.docs || []).find(x => x.id === id);
  if(!d){ if(typeof showToast === 'function') showToast('Document not found', 'error'); return; }
  const url = plannerDocUrlFor(plannerDocCampaign(), d.id, d.ver);
  window.open(url, '_blank', 'noopener');
}
function plannerDocRemove(id){
  if(typeof isReferee === 'function' && !isReferee()) return;
  const p = selPlan(); if(!p) return;
  if(!confirm('Remove this PDF from the session? (The file itself stays in storage.)')) return;
  p.docs = (p.docs || []).filter(x => x.id !== id);
  saveSessionPlans();
  renderPlannerDetail();
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE BOARD  —  visualise the session outline; click a box for scene info
// ═══════════════════════════════════════════════════════════════════════════

const SCENE_TYPE_COLOR = { scene: 'var(--txI)', social: 'var(--txS)', combat: 'var(--txD)', travel: 'var(--accentGold)', explore: 'var(--txW)', downtime: 'var(--tx1)' };
function sceneTypeColor(t){ return SCENE_TYPE_COLOR[t] || 'var(--bd0)'; }
// Scene→scene edges are derived from inline links the referee placed in the prose.
function sceneLinkTargets(s){
  const out = []; const html = ((s.readAloud || '') + ' ' + (s.refNotes || ''));
  const re = /data-link\s*=\s*"scene:([^"]+)"/gi; let m;
  while((m = re.exec(html))) out.push(m[1]);
  return out;
}
function renderPlannerBoard(){
  const el = document.getElementById('planner-detail'); if(!el) return;
  const p = selPlan();
  if(!p){
    el.innerHTML = `<div class="planner-detail-empty"><div class="planner-detail-empty-ic">🗺</div><div>Pick a session to see its scene board.</div></div>`;
    return;
  }
  const scenes = (p.scenes || []);
  el.innerHTML = `<div class="planner-back-row">
      <button class="planner-back" onclick="plannerBackToList()">‹ Sessions</button>
      <span class="planner-board-title">${sesc(p.title || 'Untitled')} · scene board</span>
    </div>
    <div id="planner-board-scroll" class="planner-board-scroll"></div>`;
  const host = document.getElementById('planner-board-scroll');
  if(!scenes.length){ host.innerHTML = `<div class="planner-hint" style="padding:16px">No scenes yet — add some in the list view.</div>`; return; }

  const BW = 300, BH = 66, GAP = 30, PADX = 24, PADY = 16, GUTTER = 96;
  const W = PADX * 2 + BW + GUTTER;
  const H = PADY * 2 + scenes.length * BH + (scenes.length - 1) * GAP;
  const yOf = i => PADY + i * (BH + GAP);
  const idxOf = id => scenes.findIndex(s => s.id === id);
  const edges = [];
  scenes.forEach((s, i) => sceneLinkTargets(s).forEach(tid => { const j = idxOf(tid); if(j >= 0 && j !== i) edges.push([i, j]); }));

  let svg = `<svg class="planner-board-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<defs>
    <marker id="pbArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--txI)"/></marker>
    <marker id="pbSeq" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--bd0)"/></marker>
  </defs>`;
  for(let i = 0; i < scenes.length - 1; i++){
    const x = PADX + BW / 2, y1 = yOf(i) + BH, y2 = yOf(i + 1);
    svg += `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2 - 2}" stroke="var(--bd0)" stroke-width="2" marker-end="url(#pbSeq)"/>`;
  }
  edges.forEach(([i, j]) => {
    const x = PADX + BW, y1 = yOf(i) + BH / 2, y2 = yOf(j) + BH / 2, cx = x + GUTTER * 0.7;
    svg += `<path d="M ${x} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x} ${y2}" fill="none" stroke="var(--txI)" stroke-width="1.6" stroke-dasharray="4 3" marker-end="url(#pbArrow)"/>`;
  });
  scenes.forEach((s, i) => {
    const y = yOf(i), col = sceneTypeColor(s.type);
    const typeLbl = (SCENE_TYPES.find(t => t[0] === s.type) || SCENE_TYPES[0])[1];
    const icon = typeLbl.split(' ')[0];
    const title = richToPlain(s.title) || ('Scene ' + (i + 1));
    const badges = [];
    if((s.npcIds || []).length) badges.push('👥' + s.npcIds.length);
    if((s.missionIds || []).length) badges.push('🎯' + s.missionIds.length);
    if((s.checks || []).length) badges.push('⚄' + s.checks.length);
    if((s.oracle || []).length) badges.push('🎲' + s.oracle.length);
    const sub = typeLbl.split(' ').slice(1).join(' ') + (badges.length ? ('   ' + badges.join('  ')) : '');
    svg += `<g class="pb-node" onclick="openSceneBoardPopover('${s.id}',event)" style="cursor:pointer">
      <rect x="${PADX}" y="${y}" rx="8" width="${BW}" height="${BH}" fill="var(--bg2)" stroke="${s.done ? 'var(--txS)' : col}" stroke-width="${s.done ? 2 : 1.5}"/>
      <rect x="${PADX}" y="${y}" rx="4" width="5" height="${BH}" fill="${col}"/>
      <text x="${PADX + 16}" y="${y + 25}" fill="var(--tx0)" font-size="13" font-weight="600">${sesc(icon)} ${sesc(plTrunc(title, 32))}</text>
      <text x="${PADX + 16}" y="${y + 46}" fill="var(--tx1)" font-size="11">${sesc(sub)}</text>
      ${s.done ? `<text x="${PADX + BW - 20}" y="${y + 24}" fill="var(--txS)" font-size="15">✓</text>` : ''}
    </g>`;
  });
  svg += `</svg>`;
  host.innerHTML = svg;
}
function openSceneBoardPopover(sceneId, ev){
  const p = selPlan(); const s = p && sceneById(p, sceneId); if(!s) return;
  const typeLbl = (SCENE_TYPES.find(t => t[0] === s.type) || SCENE_TYPES[0])[1];
  const ra = richToPlain(s.readAloud), rn = richToPlain(s.refNotes);
  const meta = [
    (s.npcIds || []).length ? ('👥 ' + s.npcIds.length) : '',
    (s.missionIds || []).length ? ('🎯 ' + s.missionIds.length) : '',
    (s.checks || []).length ? ('⚄ ' + s.checks.length) : '',
    (s.oracle || []).length ? ('🎲 ' + s.oracle.length) : ''
  ].filter(Boolean).join('   ');
  const html = `<div class="pp-title">${sesc(s.title || 'Untitled scene')}</div>
    <div class="pp-sub">${sesc(typeLbl)}${s.done ? ' · ✓ played' : ''}</div>
    ${ra ? `<div class="pp-para"><b>Read-aloud:</b> ${sesc(plTrunc(ra, 180))}</div>` : ''}
    ${rn ? `<div class="pp-para"><b>Notes:</b> ${sesc(plTrunc(rn, 180))}</div>` : ''}
    <div class="pp-meta">${meta || 'No links yet'}</div>
    <button class="pp-act" onclick="openSceneFromBoard('${s.id}')">Open card ›</button>`;
  const x = ev ? ev.clientX : 200, y = ev ? ev.clientY : 200;
  plannerPopover(html, x, y);
}
function openSceneFromBoard(sceneId){
  closePlannerPopover();
  plannerView = 'list';
  renderPlanner();
  setTimeout(() => plannerJumpToScene(sceneId), 40);
}

// ═══════════════════════════════════════════════════════════════════════════
// RECAP INTEGRATION — resolved dice checks feed the Session Tools recap (js/92)
// ═══════════════════════════════════════════════════════════════════════════
// buildSessionLogText()/generateSessionRecap() call these via typeof guards, so
// the recap tool stays the owner of the output and this module just contributes.

function _checkResolved(c){ return !!(c && (((c.roll || '').trim()) || (c.outcome && c.outcome !== 'pending') || ((c.notes || '').trim()))); }
function _outcomeLabel(o){ return (CHECK_OUTCOMES.find(x => x[0] === o) || [null, ''])[1] || ''; }

// One human-readable line for a resolved check, e.g.
// "Recon to spot the ambush (8+) — Rhett rolled 10 → Success. Spotted the trail."
function _checkOneLine(c, scene){
  let head = (c.label || '').trim() || (scene && scene.title || '').trim() || 'Check';
  if((c.target || '').trim()) head += ' (' + c.target.trim() + ')';
  const roll = [];
  if((c.who || '').trim()) roll.push(c.who.trim());
  if((c.roll || '').trim()) roll.push('rolled ' + c.roll.trim());
  const oc = _outcomeLabel(c.outcome);
  let result = roll.join(' ');
  if(oc) result = result ? (result + ' → ' + oc) : oc;
  let line = head;
  if(result) line += ' — ' + result;
  if((c.notes || '').trim()) line += '. ' + c.notes.trim();
  return line;
}

// Resolved checks grouped by session. Scoped to Running sessions if any are
// Running, else all sessions; only sessions with ≥1 resolved check appear,
// newest session first. So marking a session "Running" focuses the recap on it.
function plannerResolvedCheckGroups(){
  if(!Array.isArray(sessionPlans)) return [];
  const running = sessionPlans.filter(p => p.status === 'active');
  const pool = running.length ? running : sessionPlans;
  const groups = [];
  pool.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).forEach(p => {
    const items = [];
    (p.scenes || []).forEach(s => (s.checks || []).forEach(c => { if(_checkResolved(c)) items.push({ scene: s, check: c }); }));
    if(items.length) groups.push({ title: p.title || 'Untitled session', items });
  });
  return groups;
}
function plannerResolvedCheckCount(){ return plannerResolvedCheckGroups().reduce((n, g) => n + g.items.length, 0); }

// Plain-text section for the exported/copied session log (js/92 buildSessionLogText).
function plannerChecksRecapLines(){
  const groups = plannerResolvedCheckGroups();
  if(!groups.length) return [];
  const lines = ['KEY ROLLS & CHECKS', '-'.repeat(48)];
  groups.forEach(g => {
    if(groups.length > 1) lines.push('· ' + g.title);
    g.items.forEach(({ scene, check }) => lines.push((groups.length > 1 ? '  ' : '') + _checkOneLine(check, scene)));
  });
  lines.push('');
  return lines;
}
// Prose lines for the generated narrative recap (js/92 generateSessionRecap).
function plannerChecksRecapProse(){
  const groups = plannerResolvedCheckGroups();
  if(!groups.length) return [];
  const parts = ['', 'Key rolls:'];
  groups.forEach(g => g.items.forEach(({ scene, check }) => parts.push('• ' + _checkOneLine(check, scene))));
  return parts;
}

// ── Referee preload (mirrors js/85 loadNpcRoster boot preload) ──────────────
// Self-contained: touches only earlier-file globals (supaStorage, isReferee),
// gated referee-only inside, so a player device never fetches session-plans.
loadSessionPlans().then(() => { if(plannerOpen) renderPlanner(); }).catch(() => {});

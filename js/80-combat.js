// ═══════════════════════════════════════════════════════════════════════════
// SPACE COMBAT — Phase 1: data & state foundation  (MgT2e core)
// ───────────────────────────────────────────────────────────────────────────
// Architecture (decided in the Phase-3 audit):
//   • REFEREE-AUTHORITATIVE. The referee's device is the single source of truth
//     and the only writer of combat state. Players are read-only and poll for
//     updates (mirrors the Red Alert fast-poll pattern). This is what makes
//     enemy secrecy work on the existing single-key/honour-system backend:
//     hidden ships/stats simply are NOT written to shared storage until the
//     referee reveals them — consistent with how every other secret in the app
//     stays referee-side rather than relying on (non-existent) row-level DB
//     security. See CLAUDE.md / the shared-state note above.
//   • ONE SHIP MODEL. Player ship = shipState; enemies = makeShipStats(...).
//   • PER-PAIR RANGE BANDS. ranges{} is keyed by a canonical ship-pair key.
//
// Shared state in aurelia_state, key 'combat-encounter'. Phase 1 establishes
// the schema, persistence, the redaction/reveal boundary, and the player poll.
// The combat *resolution* loop (initiative, attacks, damage, criticals) is
// Phase 2 and is intentionally NOT implemented here yet.
// ═══════════════════════════════════════════════════════════════════════════

// Abstract range bands, ordered Adjacent → Distant (MgT2e core).
const COMBAT_RANGE_BANDS = ['Adjacent','Close','Short','Medium','Long','Very Long','Distant'];
const COMBAT_PHASES = ['manoeuvre','attack','action']; // round = 6 min, three sequential phases

// The active encounter. `null` = no combat in progress. Only the referee mutates
// this; players receive it (already redacted) via the poll.
let combatEncounter = null;
let combatPollId = null;
const COMBAT_POLL_MS = 1500; // combat is dynamic — match the Red Alert cadence

// A fresh, empty encounter skeleton. The player ship is seeded as the first
// combatant, referencing shipState (ref:'player') so it stays the one model.
function makeEncounter(){
  return {
    id: 'enc_' + Math.random().toString(36).slice(2, 10),
    status: 'setup',           // 'setup' | 'active' | 'ended'
    round: 0,
    phase: 'manoeuvre',        // COMBAT_PHASES
    activeShipId: null,        // whose turn within the current phase
    initiative: [],            // ordered array of ship ids
    ships: [ makeCombatShip({ id:'player', ref:'player', revealed:true, name: shipState.name }) ],
    ranges: {},                // { pairKey(aId,bId): bandIndex }
    hazards: [],               // [{ id, kind, name, dm, note, active }] — Phase 4
    pendingMissiles: [],       // [{ attackerId, targetId, weapon, effect, impactRound, name }] — in flight
    log: [],                   // append-only battle log (Phase 2 fills it)
    createdAt: Date.now()
  };
}

// One combatant's per-encounter state. For enemies, `stats` is a full
// makeShipStats() object; for the player ship, stats is read live from
// shipState at render time and `ref:'player'` marks that, so we never duplicate
// the player's authoritative sheet into the encounter blob.
function makeCombatShip(o){
  o = o || {};
  return {
    id: o.id || 'shp_' + Math.random().toString(36).slice(2, 8),
    ref: o.ref || null,                 // 'player' → read stats from shipState; else null
    name: o.name || 'Unknown Contact',
    side: o.side || (o.ref === 'player' ? 'allied' : 'hostile'),
    stats: o.ref === 'player' ? null : makeShipStats(o.stats || {}),
    // live combat state
    thrustAllocated: 0,
    dodge: false,
    sensorLocks: {},                    // { targetShipId: true }
    pointDefenceUsed: 0,                // cumulative PD penalty counter this round
    initiativeScore: 0,
    pendingInitiativeAdj: 0,            // Leadership adjustment, applied at next round start
    status: 'active',                   // 'active' | 'disabled' | 'destroyed'
    // fog-of-war: until revealed, the player redactor strips this ship entirely
    revealed: o.revealed || false,
    visibleTo: o.visibleTo || 'all'     // canSee() audience once revealed
  };
}

// Canonical, order-independent key for a pair of ships (per-pair range bands).
function combatPairKey(a, b){ return [a, b].sort().join('|'); }
function getRangeBand(aId, bId){
  if(!combatEncounter) return null;
  const idx = combatEncounter.ranges[combatPairKey(aId, bId)];
  return (idx == null) ? null : COMBAT_RANGE_BANDS[idx];
}

// ── Persistence (referee writes; players read) ─────────────────────────────
async function loadCombatEncounter(){
  try {
    const res = await supaStorage.get('combat-encounter', true);
    const raw = res.value != null ? JSON.parse(res.value) : null;
    // Players only ever hold the redacted view; the referee holds the full one.
    combatEncounter = (raw && !isReferee()) ? redactEncounterForPlayer(raw) : raw;
  } catch(e){ combatEncounter = null; }
}

async function saveCombatEncounter(){
  if(!isReferee()) return;                 // referee-authoritative: only the ref writes
  try { await supaStorage.set('combat-encounter', JSON.stringify(combatEncounter), true); }
  catch(e){ console.error('Combat save failed:', e); }
}

// The redaction boundary. Even though the full blob technically reaches every
// device (single-key backend), we redact on read so the player UI cannot render
// unrevealed ships or hidden enemy stats — the same honour-system gating the
// rest of the app uses, applied at the combat layer.
function redactEncounterForPlayer(enc){
  const copy = JSON.parse(JSON.stringify(enc));
  copy.ships = (copy.ships || [])
    .filter(s => s.ref === 'player' || (s.revealed && canSee(s.visibleTo)))
    .map(s => {
      if(s.ref === 'player') return s;     // player reads own stats from shipState
      // Revealed enemy: keep combat-visible state, drop nothing extra for now.
      // (Per-stat fog — e.g. hidden weapons — is a Phase-3 refinement.)
      return s;
    });
  // Drop range pairs that reference a now-hidden ship.
  const visibleIds = new Set(copy.ships.map(s => s.id));
  const prunedRanges = {};
  for(const k of Object.keys(copy.ranges || {})){
    const [a, b] = k.split('|');
    if(visibleIds.has(a) && visibleIds.has(b)) prunedRanges[k] = copy.ranges[k];
  }
  copy.ranges = prunedRanges;
  copy.initiative = (copy.initiative || []).filter(id => visibleIds.has(id));
  copy.hazards = (copy.hazards || []).filter(h => h.active);
  // In-flight missiles that involve a hidden ship must not leak to players.
  copy.pendingMissiles = (copy.pendingMissiles || []).filter(m => visibleIds.has(m.attackerId) && visibleIds.has(m.targetId));
  // Battle log: drop any entry that references a ship the player can't see —
  // by meta id OR by the hidden ship's NAME appearing in the free text — so the
  // log itself never betrays an unrevealed contact's existence.
  const hiddenNames = (enc.ships || [])
    .filter(s => !visibleIds.has(s.id) && s.name)
    .map(s => s.name);
  copy.log = (copy.log || []).filter(e => {
    const m = e.meta || {};
    const refs = [m.shipId, m.targetId, m.attackerId, m.operatorId, m.defenderId, m.aId, m.bId].filter(Boolean);
    if(!refs.every(id => visibleIds.has(id))) return false;
    const text = e.text || '';
    return !hiddenNames.some(n => text.indexOf(n) !== -1);
  });
  return copy;
}

// ── Battle log (append-only; supports later undo/recovery) ──────────────────
const COMBAT_LOG_CAP = 200; // keep the shared encounter row (and poll payload) bounded
function combatLog(kind, text, meta){
  if(!combatEncounter) return;
  combatEncounter.log.push({
    id: 'lg_' + Math.random().toString(36).slice(2, 8),
    at: Date.now(), round: combatEncounter.round, phase: combatEncounter.phase,
    kind: kind || 'note', text: text || '', meta: meta || null
  });
  if(combatEncounter.log.length > COMBAT_LOG_CAP) combatEncounter.log.splice(0, combatEncounter.log.length - COMBAT_LOG_CAP);
}

// ── Referee lifecycle (Phase 1: create / end / persist only) ────────────────
function startEncounter(){
  if(!isReferee()) return;
  combatEncounter = makeEncounter();
  combatLog('system', 'Encounter created (setup).');
  saveCombatEncounter();
}
function endEncounter(){
  if(!isReferee() || !combatEncounter) return;
  combatEncounter.status = 'ended';
  combatLog('system', 'Encounter ended.');
  saveCombatEncounter();
  combatEncounter = null;
  saveCombatEncounter();                    // clear the shared row
}

// ── Player poll (referee never polls — they are the source of truth) ────────
function startCombatPolling(){ stopCombatPolling(); if(isReferee()) return; combatPollId = setInterval(pollCombatEncounter, COMBAT_POLL_MS); }
function stopCombatPolling(){ if(combatPollId){ clearInterval(combatPollId); combatPollId = null; } }
async function pollCombatEncounter(){
  if(isReferee()) return;
  try {
    const res = await supaStorage.get('combat-encounter', true);
    if(res.ok){
      const raw = res.value != null ? JSON.parse(res.value) : null;
      const fresh = raw ? redactEncounterForPlayer(raw) : null;
      if(JSON.stringify(fresh) !== JSON.stringify(combatEncounter)){
        combatEncounter = fresh;
        if(typeof renderCombat === 'function') renderCombat(); // Phase 3 UI hook (defined later)
      }
    }
  } catch(e){ /* silent — next poll retries */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// SPACE COMBAT — Phase 2: the core combat loop  (MgT2e core, rules-faithful)
// ───────────────────────────────────────────────────────────────────────────
// Read-only correctness first: this implements round/phase/initiative
// sequencing, per-pair range bands + Thrust allocation, 2D attack resolution
// with an INSPECTABLE DM breakdown, damage → Hull → Structure → criticals, and
// point defence — all referee-driven and written to the shared encounter so the
// battle log is the authoritative record. No combat visuals yet (Phase 3).
//
// Rules provenance: every fixed number MgT2e core states is in MGT2E below, with
// the Table reference. A few values are interpretation-dependent across the 2016
// / 2022 printings (sensor-lock DM, per-range attack DM, dodge/PD magnitudes) —
// those are isolated in MGT2E.tunables and flagged so the referee can correct
// one place rather than hunt through logic. Sources verified against the
// Traveller SRD and Core Rulebook tables (Table 207 Thrust; Sustained Damage;
// Critical Hits Location 2D table; missile travel-time by band).
// ═══════════════════════════════════════════════════════════════════════════

const MGT2E = {
  // Table 207 — Thrust required to change to a range band (verified).
  // Band index → its own thrust value. A transition between two adjacent bands
  // costs the OUTER band's value (the documented, common reading of the table;
  // the rule text is famously ambiguous, hence keeping it explicit here).
  bandThrust: { Adjacent:1, Close:1, Short:2, Medium:5, Long:10, 'Very Long':25, Distant:50 },

  // 2D Critical Hits Location table (verified — matches the app's crit systems).
  critLocation: { 2:'sensors', 3:'powerplant', 4:'fuel', 5:'weapons', 6:'armour',
                  7:'hull', 8:'mdrive', 9:'cargo', 10:'jdrive', 11:'crew', 12:'bridge' },

  // Missile travel time (rounds to impact) by the range band at launch (verified).
  // Outside Close, missiles gain the Smart trait. Listed = rounds AFTER launch.
  missileTravel: { Adjacent:0, Close:0, Short:0, Medium:0, Long:1, 'Very Long':4, Distant:10 },

  // Sustained Damage: each time cumulative damage crosses a 10%-of-max-Hull
  // threshold, a Severity-1 critical strikes a rolled location (verified, 2022).
  sustainedThresholdPct: 0.10,
  // An attack whose Effect ≥ 6 also scores a critical (verified).
  critEffectThreshold: 6,

  // ── Interpretation-dependent tunables (FLAGGED — confirm against your printing)
  tunables: {
    attackDifficulty: 8,        // Average (8+) task — the core space-attack target number
    sensorLockDM: 1,            // DM to attacks vs a locked target (some tables read +2 / a Boon)
    rangeAttackDM: {            // core uses a flat 8+; left at 0 unless your table applies range DMs
      Adjacent:0, Close:0, Short:0, Medium:0, Long:0, 'Very Long':0, Distant:0
    },
    pointDefenceStep: -1,       // cumulative DM per extra PD attempt this round (1st = 0)
    dodgePerThrust: -1          // attacker DM per Thrust the target spends dodging (cap = pilot skill)
  }
};

const COMBAT_SHIP_SIZE_DM = (tonnage) => {
  // Target-size DM (larger ships are easier to hit). Approximate MgT2e scaling —
  // FLAGGED as a tunable-class value; referee can disable by returning 0.
  const t = Number(tonnage) || 0;
  if(t >= 100000) return 6;
  if(t >= 25000)  return 4;
  if(t >= 5000)   return 2;
  if(t >= 1000)   return 1;
  if(t < 100)     return -1; // small craft / fighters are harder to hit
  return 0;
};

function combatRoll2D(){ const a=1+Math.floor(Math.random()*6), b=1+Math.floor(Math.random()*6); return {a,b,sum:a+b}; }

// Resolve a combatant's effective stats. The player ship always reads its live
// authoritative sheet (shipState); enemies carry their own stats block.
function combatStatsOf(ship){
  if(!ship) return null;
  return ship.ref === 'player' ? shipState : ship.stats;
}
function combatShipById(id){ return combatEncounter ? combatEncounter.ships.find(s => s.id === id) : null; }

// ── Referee: roster ────────────────────────────────────────────────────────
function addCombatShip(stats, opts){
  if(!isReferee() || !combatEncounter) return null;
  const ship = makeCombatShip(Object.assign({ stats: stats || {}, name: (stats && stats.name) || 'Hostile Contact' }, opts || {}));
  combatEncounter.ships.push(ship);
  // Seed an unknown range (Long) between the newcomer and every existing ship.
  combatEncounter.ships.forEach(other => {
    if(other.id !== ship.id) combatEncounter.ranges[combatPairKey(ship.id, other.id)] = COMBAT_RANGE_BANDS.indexOf('Long');
  });
  combatLog('system', `${ship.name} entered the engagement.`, { shipId: ship.id });
  saveCombatEncounter();
  return ship.id;
}
function removeCombatShip(id){
  if(!isReferee() || !combatEncounter) return;
  const s = combatShipById(id); if(!s) return;
  combatEncounter.ships = combatEncounter.ships.filter(x => x.id !== id);
  combatEncounter.initiative = combatEncounter.initiative.filter(x => x !== id);
  Object.keys(combatEncounter.ranges).forEach(k => { if(k.split('|').includes(id)) delete combatEncounter.ranges[k]; });
  combatLog('system', `${s.name} left the engagement.`, { shipId: id });
  saveCombatEncounter();
}

// ── Referee: initiative & round/phase sequencing ────────────────────────────
// Initiative = 2D + Commander's Tactics (Naval) skill (verified). The Commander
// may, in the Action phase, attempt a Leadership check to adjust NEXT round's
// initiative — exposed as adjustInitiative() for the referee to apply that Effect.
function rollInitiative(){
  if(!isReferee() || !combatEncounter) return;
  combatEncounter.ships.forEach(s => {
    const st = combatStatsOf(s);
    const tactics = (st && st.crewSkills && Number(st.crewSkills.tactics)) || 0;
    const r = combatRoll2D();
    s.initiativeScore = r.sum + tactics;
    combatLog('initiative', `${s.name} initiative ${s.initiativeScore} (2D ${r.sum} + Tactics ${tactics}).`,
      { shipId: s.id, roll: r.sum, tactics, total: s.initiativeScore });
  });
  combatEncounter.initiative = combatEncounter.ships.slice()
    .sort((a, b) => b.initiativeScore - a.initiativeScore).map(s => s.id);
  combatEncounter.status = 'active';
  combatEncounter.round = 1;
  combatEncounter.phase = 'manoeuvre';
  combatEncounter.activeShipId = combatEncounter.initiative[0] || null;
  combatLog('system', `Round 1 — Manoeuvre phase. Initiative: ${combatEncounter.initiative.map(id => (combatShipById(id)||{}).name).join(' → ')}.`);
  saveCombatEncounter();
}
function adjustInitiative(shipId, effect){
  if(!isReferee() || !combatEncounter) return;
  const s = combatShipById(shipId); if(!s) return;
  // MgT2e: a Leadership check adjusts NEXT round's initiative. Stash it and
  // apply at round rollover so the current round's turn order is untouched.
  s.pendingInitiativeAdj = (Number(s.pendingInitiativeAdj) || 0) + (Number(effect) || 0);
  combatLog('action', `${s.name} will adjust initiative by ${effect} (Leadership) next round.`, { shipId });
  saveCombatEncounter();
}

// Advance the acting ship; wrap → next phase; after Action → new round.
function advanceCombatTurn(){
  if(!isReferee() || !combatEncounter || combatEncounter.status !== 'active') return;
  const order = combatEncounter.initiative.filter(id => { const s = combatShipById(id); return s && s.status !== 'destroyed'; });
  if(!order.length) return;
  const idx = order.indexOf(combatEncounter.activeShipId);
  if(idx < order.length - 1){
    combatEncounter.activeShipId = order[idx + 1];
  } else {
    const pi = COMBAT_PHASES.indexOf(combatEncounter.phase);
    if(pi < COMBAT_PHASES.length - 1){
      combatEncounter.phase = COMBAT_PHASES[pi + 1];
      combatEncounter.activeShipId = order[0];
      combatLog('system', `${combatEncounter.phase[0].toUpperCase() + combatEncounter.phase.slice(1)} phase.`);
    } else {
      newCombatRound();
      return;
    }
  }
  saveCombatEncounter();
}
function newCombatRound(){
  combatEncounter.round += 1;
  combatEncounter.phase = 'manoeuvre';
  // Apply any deferred Leadership initiative adjustments, then re-sort.
  let reSorted = false;
  combatEncounter.ships.forEach(s => {
    if(s.pendingInitiativeAdj){ s.initiativeScore += s.pendingInitiativeAdj; s.pendingInitiativeAdj = 0; reSorted = true; }
  });
  if(reSorted){
    combatEncounter.initiative = combatEncounter.ships.slice()
      .sort((a, b) => b.initiativeScore - a.initiativeScore).map(s => s.id);
  }
  // Reset per-round state.
  combatEncounter.ships.forEach(s => { s.thrustAllocated = 0; s.dodge = false; s.pointDefenceUsed = 0; });
  combatLog('system', `Round ${combatEncounter.round} — Manoeuvre phase.`);
  // Resolve any missiles arriving this round (impact happens before actions).
  resolvePendingMissiles();
  const order = combatEncounter.initiative.filter(id => { const s = combatShipById(id); return s && s.status !== 'destroyed'; });
  combatEncounter.activeShipId = order[0] || null;
  saveCombatEncounter();
}

// Resolve in-flight missiles whose impact round has arrived (Long+ launches).
function resolvePendingMissiles(){
  if(!combatEncounter || !combatEncounter.pendingMissiles) return;
  const due = combatEncounter.pendingMissiles.filter(m => m.impactRound <= combatEncounter.round);
  combatEncounter.pendingMissiles = combatEncounter.pendingMissiles.filter(m => m.impactRound > combatEncounter.round);
  due.forEach(m => {
    const tgt = combatShipById(m.targetId);
    if(!tgt || tgt.status === 'destroyed') return; // target gone — missile is wasted
    const dmgInfo = applyCombatDamage(m.targetId, m.weapon, m.effect);
    combatLog('attack', `${m.name || 'Missile'} from ${(combatShipById(m.attackerId)||{}).name || '?'} impacts ${tgt.name}${dmgInfo ? `, ${dmgInfo.summary}` : ''}.`,
      { attackerId: m.attackerId, targetId: m.targetId, weapon: m.name, hit: true, travel: 0, damage: dmgInfo });
  });
}

// ── Referee: Manoeuvre phase — Thrust, range bands, dodge ────────────────────
function rangeTransitionCost(fromIdx, toIdx){
  // Cost to step one band = the OUTER band's Table-207 value, summed across steps.
  let cost = 0, lo = Math.min(fromIdx, toIdx), hi = Math.max(fromIdx, toIdx);
  for(let i = lo; i < hi; i++){ cost += MGT2E.bandThrust[COMBAT_RANGE_BANDS[i + 1]]; }
  return cost;
}
function changeRange(aId, bId, deltaBands){
  if(!isReferee() || !combatEncounter) return { ok:false, reason:'no encounter' };
  const key = combatPairKey(aId, bId);
  const cur = combatEncounter.ranges[key]; if(cur == null) return { ok:false, reason:'no range set' };
  const target = Math.max(0, Math.min(COMBAT_RANGE_BANDS.length - 1, cur + deltaBands));
  if(target === cur) return { ok:false, reason:'no change' };
  // Closing/opening combines BOTH ships' allocated Thrust (verified).
  const a = combatShipById(aId), b = combatShipById(bId);
  const pool = (a ? a.thrustAllocated : 0) + (b ? b.thrustAllocated : 0);
  const cost = rangeTransitionCost(cur, target);
  if(cost > pool) return { ok:false, reason:`needs ${cost} Thrust, have ${pool}` };
  combatEncounter.ranges[key] = target;
  // Consume the spent Thrust from the two ships (initiator first), so a phase's
  // allocation can't be reused for unlimited band changes.
  let remaining = cost;
  [a, b].forEach(ship => { if(ship && remaining > 0){ const t = Math.min(ship.thrustAllocated || 0, remaining); ship.thrustAllocated -= t; remaining -= t; } });
  combatLog('manoeuvre', `${a?a.name:aId}/${b?b.name:bId} range → ${COMBAT_RANGE_BANDS[target]} (spent ${cost}/${pool} Thrust).`,
    { aId, bId, from: COMBAT_RANGE_BANDS[cur], to: COMBAT_RANGE_BANDS[target], cost });
  saveCombatEncounter();
  return { ok:true, cost };
}
function allocateThrust(shipId, n){
  if(!isReferee() || !combatEncounter) return;
  const s = combatShipById(shipId); if(!s) return;
  const st = combatStatsOf(s);
  // Gravity wells etc. reduce effective Thrust available to manoeuvre.
  const maxThrust = Math.max(0, ((st && Number(st.thrust)) || 0) - combatHazardThrustPenalty());
  s.thrustAllocated = Math.max(0, Math.min(maxThrust, Number(n) || 0));
  saveCombatEncounter();
}
function setDodge(shipId, thrustSpent){
  if(!isReferee() || !combatEncounter) return;
  const s = combatShipById(shipId); if(!s) return;
  const st = combatStatsOf(s);
  const pilot = (st && st.crewSkills && Number(st.crewSkills.pilot)) || 0;
  s.dodge = Math.max(0, Math.min(pilot, Number(thrustSpent) || 0)); // dodge DM capped at Pilot skill
  if(s.dodge > 0) combatLog('manoeuvre', `${s.name} evades (dodge ${s.dodge}).`, { shipId });
  saveCombatEncounter();
}

// ── Referee: Attack phase — resolution with inspectable DM breakdown ─────────
// Builds the full breakdown first (so the UI can show it BEFORE/with the roll),
// then rolls 2D, computes Effect, and applies damage on a hit.
function buildAttackDM(attackerId, targetId, weapon){
  const atk = combatShipById(attackerId), tgt = combatShipById(targetId);
  const aSt = combatStatsOf(atk), tSt = combatStatsOf(tgt);
  const band = getRangeBand(attackerId, targetId) || 'Long';
  const gunnery = (aSt && aSt.crewSkills && Number(aSt.crewSkills.gunnery)) || 0;
  const locked = !!(atk && atk.sensorLocks && atk.sensorLocks[targetId]);
  const dm = [];
  dm.push({ label: 'Gunnery', value: gunnery });
  if(locked) dm.push({ label: 'Sensor lock', value: MGT2E.tunables.sensorLockDM });
  const rdm = MGT2E.tunables.rangeAttackDM[band] || 0;
  if(rdm) dm.push({ label: `Range (${band})`, value: rdm });
  const sizeDM = COMBAT_SHIP_SIZE_DM(tSt && tSt.tonnage);
  if(sizeDM) dm.push({ label: 'Target size', value: sizeDM });
  if(tgt && tgt.dodge) dm.push({ label: 'Target dodging', value: MGT2E.tunables.dodgePerThrust * tgt.dodge });
  const wcrit = (aSt && aSt.crits && Number(aSt.crits.weapons)) || 0; // weapons-system damage degrades fire
  if(wcrit) dm.push({ label: 'Weapon crit', value: -wcrit });
  const hazDM = combatHazardAttackDM();
  if(hazDM) dm.push({ label: 'Environment', value: hazDM });
  const total = dm.reduce((s, d) => s + d.value, 0);
  return { band, locked, weapon, difficulty: MGT2E.tunables.attackDifficulty, dm, total };
}
function resolveAttack(attackerId, targetId, weaponId){
  if(!isReferee() || !combatEncounter) return null;
  const atk = combatShipById(attackerId), tgt = combatShipById(targetId);
  if(!atk || !tgt) return null;
  const aSt = combatStatsOf(atk);
  const weapon = (aSt.weapons || []).find(w => w.id === weaponId) || (aSt.weapons || [])[0] || { name:'Weapon', type:'beam-laser', damage:'1D' };
  const bd = buildAttackDM(attackerId, targetId, weapon);
  const r = combatRoll2D();
  const roll = r.sum + bd.total;
  const effect = roll - bd.difficulty;
  const hit = effect >= 0;
  // Missile timing (Smart outside Close); core impact is immediate at short ranges.
  const travel = (weapon.type === 'missile') ? (MGT2E.missileTravel[bd.band] || 0) : 0;
  let dmgInfo = null;
  if(hit && travel === 0){
    dmgInfo = applyCombatDamage(targetId, weapon, effect);
  } else if(hit && travel > 0){
    // Long-range missile: schedule the impact for a later round (resolved at
    // round start) rather than dropping it.
    combatEncounter.pendingMissiles = combatEncounter.pendingMissiles || [];
    combatEncounter.pendingMissiles.push({ attackerId, targetId, weapon, effect, impactRound: combatEncounter.round + travel, name: weapon.name });
  }
  combatLog('attack',
    `${atk.name} fires ${weapon.name} at ${tgt.name}: 2D ${r.sum} ${bd.total>=0?'+':''}${bd.total} = ${roll} vs ${bd.difficulty} → ${hit?'HIT':'miss'}${hit?` (Effect ${effect})`:''}${travel?` — missile impacts in ${travel} round(s)`:''}${dmgInfo?`, ${dmgInfo.summary}`:''}.`,
    { attackerId, targetId, weapon: weapon.name, dice: r, breakdown: bd, roll, effect, hit, travel, damage: dmgInfo });
  saveCombatEncounter();
  return { roll, effect, hit, breakdown: bd, travel, damage: dmgInfo };
}

// ── Damage → Hull → Structure → criticals (verified mechanics) ───────────────
function rollDamage(weapon, effect){
  // Weapon damage is an editable dice expression on the mount (e.g. '2D', '3D6').
  // Effect of the attack is added to damage (verified). No guessing on weapon
  // damage values — they come from the referee-entered weapon stat.
  const expr = String((weapon && weapon.damage) || '1D').toLowerCase();
  const m = expr.match(/(\d+)\s*d(?:6)?\s*([+-]\s*\d+)?/);
  let total = 0, dice = 1, mod = 0;
  if(m){ dice = parseInt(m[1], 10) || 1; mod = m[2] ? parseInt(m[2].replace(/\s/g,''), 10) : 0; }
  for(let i = 0; i < dice; i++) total += 1 + Math.floor(Math.random() * 6);
  total += mod + (Number(effect) || 0);
  return Math.max(0, total);
}
function applyCombatDamage(targetId, weapon, effect){
  const tgt = combatShipById(targetId); if(!tgt) return null;
  const st = combatStatsOf(tgt);
  const armour = Number(st.armourRating) || 0;
  const raw = rollDamage(weapon, effect);
  const dmg = Math.max(0, raw - armour);            // armour subtracts from rolled damage (verified)
  // Apply to Hull first, overflow to Structure (verified: Hull breached → Structure).
  const beforeHull = Number(st.hullPoints) || 0;
  let remaining = dmg;
  let hull = beforeHull - remaining;
  let struct = Number(st.structurePoints) || 0;
  if(hull < 0){ struct += hull; hull = 0; }          // overflow eats Structure
  st.hullPoints = hull;
  st.structurePoints = Math.max(0, struct);
  const crits = [];
  // Sustained Damage: one Severity-1 crit per 10%-of-max-Hull threshold crossed.
  const maxHull = Number(st.hullPointsMax) || 0;
  if(maxHull > 0){
    const step = MGT2E.sustainedThresholdPct * maxHull;
    const crossedBefore = Math.floor((maxHull - beforeHull) / step);
    const crossedAfter  = Math.floor((maxHull - Math.max(0, hull)) / step);
    for(let i = crossedBefore; i < crossedAfter; i++){ crits.push(applyCrit(targetId, rollCritLocation(), 1)); }
  }
  // Effect ≥ 6 also scores a critical (verified).
  if((Number(effect) || 0) >= MGT2E.critEffectThreshold){ crits.push(applyCrit(targetId, rollCritLocation(), 1)); }
  // Destruction check. Use Structure if the ship has any; otherwise fall back to
  // Hull, so a ship with no Structure defined can still be destroyed (and one
  // with Structure isn't killed merely by Hull reaching 0).
  const maxStruct = Number(st.structurePointsMax) || 0;
  const maxHullCap = Number(st.hullPointsMax) || 0;
  const dead = maxStruct > 0 ? (st.structurePoints <= 0)
             : (maxHullCap > 0 && (Number(st.hullPoints) || 0) <= 0);
  if(dead && tgt.status !== 'destroyed'){
    tgt.status = 'destroyed';
    combatLog('system', `${tgt.name} is destroyed.`, { targetId });
  }
  // Wire the player ship's damage into the existing Red Alert + crit UI.
  if(tgt.ref === 'player'){
    saveShipState();
    if(typeof checkHullAutoAlert === 'function') checkHullAutoAlert();
    if(shipPanelOpen && typeof renderShipPanel === 'function') renderShipPanel();
  }
  const critTxt = crits.filter(Boolean).length ? ` + ${crits.filter(Boolean).length} critical(s): ${crits.filter(Boolean).map(c=>`${c.location} sev ${c.severity}`).join(', ')}` : '';
  return { raw, armour, dmg, hull: st.hullPoints, structure: st.structurePoints, crits,
           summary: `${dmg} damage (rolled ${raw} − ${armour} armour) → Hull ${st.hullPoints}/${maxHull}${critTxt}` };
}
function rollCritLocation(){ return MGT2E.critLocation[combatRoll2D().sum]; }
function applyCrit(targetId, location, severity){
  const tgt = combatShipById(targetId); if(!tgt || !location) return null;
  const st = combatStatsOf(tgt);
  if(!st.crits) st.crits = {};
  const cur = Number(st.crits[location]) || 0;
  if(cur >= 6){
    // Severity capped — further crits deal 6D extra damage instead (verified).
    // Route it through Hull→Structure overflow so it can actually destroy a ship.
    let extra = 0; for(let i=0;i<6;i++) extra += 1 + Math.floor(Math.random()*6);
    let hull = (Number(st.hullPoints)||0) - extra, struct = Number(st.structurePoints)||0;
    if(hull < 0){ struct += hull; hull = 0; }
    st.hullPoints = hull; st.structurePoints = Math.max(0, struct);
    combatLog('critical', `${tgt.name}: ${location} already at Severity 6 — ${extra} extra damage.`, { targetId, location, extra });
    return { location, severity: 6, extra };
  }
  // Repeat to a hit location: new severity or old+1, whichever higher (verified).
  const sev = Math.min(6, Math.max(cur + 1, Number(severity) || 1));
  st.crits[location] = sev;
  combatLog('critical', `${tgt.name}: critical to ${location} — Severity ${sev}.`, { targetId, location, severity: sev });
  return { location, severity: sev };
}

// ── Sensors / EW (Action or Attack phase) ────────────────────────────────────
function attemptSensorLock(operatorId, targetId){
  if(!isReferee() || !combatEncounter) return null;
  const op = combatShipById(operatorId), tgt = combatShipById(targetId); if(!op || !tgt) return null;
  const st = combatStatsOf(op);
  const sensors = (st && st.crewSkills && Number(st.crewSkills.sensors)) || 0;
  const sensorDM = (st && Number(st.sensorDM)) || 0;
  const hazDM = combatHazardSensorDM();
  const r = combatRoll2D();
  const total = r.sum + sensors + sensorDM + hazDM;
  const ok = total >= 8;
  if(ok){ op.sensorLocks = op.sensorLocks || {}; op.sensorLocks[targetId] = true; }
  combatLog('action', `${op.name} ${ok?'gains':'fails'} sensor lock on ${tgt.name} (2D ${r.sum} + Sensors ${sensors} + DM ${sensorDM}${hazDM?` ${hazDM>=0?'+':''}${hazDM} env`:''} = ${total} vs 8).`,
    { operatorId, targetId, total, ok });
  saveCombatEncounter();
  return { ok, total };
}
function breakSensorLock(operatorId, targetId){
  if(!isReferee() || !combatEncounter) return;
  const op = combatShipById(operatorId); if(!op || !op.sensorLocks) return;
  delete op.sensorLocks[targetId];
  saveCombatEncounter();
}

// ── Point defence vs incoming missiles (cumulative penalty per attempt) ──────
function pointDefence(defenderId, weaponId){
  if(!isReferee() || !combatEncounter) return null;
  const def = combatShipById(defenderId); if(!def) return null;
  const st = combatStatsOf(def);
  const gunnery = (st && st.crewSkills && Number(st.crewSkills.gunnery)) || 0;
  const penalty = (def.pointDefenceUsed || 0) * MGT2E.tunables.pointDefenceStep; // 1st attempt = 0
  const r = combatRoll2D();
  const total = r.sum + gunnery + penalty;
  const ok = total >= 8;
  def.pointDefenceUsed = (def.pointDefenceUsed || 0) + 1;
  combatLog('action', `${def.name} point defence (attempt ${def.pointDefenceUsed}): 2D ${r.sum} + Gunnery ${gunnery} ${penalty} = ${total} vs 8 → ${ok?'missile destroyed':'miss'}.`,
    { defenderId, total, ok, penalty });
  saveCombatEncounter();
  return { ok, total, penalty };
}

// ═══════════════════════════════════════════════════════════════════════════
// SPACE COMBAT — Phase 3: player & combat UI
// ───────────────────────────────────────────────────────────────────────────
// The combat console. Referee gets the full board + phase-appropriate action
// controls (wired to the Phase-2 engine); players get a read-only, fog-redacted
// view of the same shared state. Reuses the app's dark panel chrome and the
// crit/hull readout idioms. Every attack carries an inspectable DM breakdown.
// Re-renders are driven by referee actions and by the player poll.
// ═══════════════════════════════════════════════════════════════════════════

let combatPanelOpen = false;
let combatSelTarget = null; // radar/blip-selected target id, prefills the action selects
let combatCollapsed = false;

function toggleCombatPanel(){
  combatPanelOpen = !combatPanelOpen;
  const wrap = document.getElementById('combat-wrap');
  const btn = document.getElementById('combat-btn');
  wrap.classList.toggle('hidden', !combatPanelOpen);
  if(btn) btn.classList.toggle('panel-open', combatPanelOpen);
  if(combatPanelOpen) renderCombat();
}
function toggleCombatCollapse(){
  if(document.getElementById('combat-header').dataset.suppressClick === '1') return;
  combatCollapsed = !combatCollapsed;
  document.getElementById('combat-toggle').textContent = combatCollapsed ? '▲' : '▼';
  document.getElementById('combat-body').classList.toggle('collapsed', combatCollapsed);
  document.getElementById('combat-wrap').classList.toggle('panel-collapsed', combatCollapsed);
}

// Keep the launcher button reflecting "engagement in progress" even when closed.
function updateCombatBtn(){
  const btn = document.getElementById('combat-btn');
  if(!btn) return;
  btn.classList.toggle('engaged', !!(combatEncounter && combatEncounter.status === 'active'));
}

function combatActiveShip(){ return combatEncounter ? combatShipById(combatEncounter.activeShipId) : null; }
function combatLiveShips(){ return combatEncounter ? combatEncounter.ships.filter(s => s.status !== 'destroyed') : []; }

// ── Main render ─────────────────────────────────────────────────────────────
function renderCombat(){
  updateCombatBtn();
  const body = document.getElementById('combat-body');
  const badge = document.getElementById('combat-phase-badge');
  if(!body) return;
  const ref = isReferee();

  if(!combatEncounter){
    if(badge) badge.textContent = '';
    body.innerHTML = ref
      ? `<div class="cbt-empty">No active engagement.<br><br><button class="cbt-btn primary" onclick="uiStartEncounter()">⚔ Begin Encounter</button></div>` + renderShipRoster(false)
      : `<div class="cbt-empty">No active engagement.<br>The referee will start combat when it begins.</div>`;
    return;
  }

  const enc = combatEncounter;
  if(badge) badge.textContent = enc.status === 'active'
    ? `R${enc.round} · ${enc.phase.toUpperCase()}` : enc.status.toUpperCase();

  const out = [];

  // Status bar
  if(enc.status === 'active'){
    const act = combatActiveShip();
    out.push(`<div class="cbt-statusbar">
      <span class="cbt-chip live">Round <b>${enc.round}</b></span>
      <span class="cbt-chip">Phase <b>${escQH(enc.phase)}</b></span>
      <span class="cbt-chip">Active <b>${act ? escQH(redactedShipName(act)) : '—'}</b></span>
    </div>`);
  }

  // Tactical radar scope (player-centric)
  out.push(renderCombatRadar(ref));

  // Ships
  out.push(`<div class="cbt-sec-tab">Ships</div>`);
  out.push(enc.ships.map(s => renderCombatShip(s, ref)).join(''));

  // Active environmental hazards — visible to everyone (read-only chips).
  const hazChips = combatHazardChips();
  if(hazChips) out.push(hazChips);

  // Range grid (referee gets a per-pair band setter — referee fiat, no Thrust).
  const pairs = combatRangePairs();
  if(pairs.length){
    out.push(`<div class="cbt-sec-tab">Range</div>`);
    out.push(`<div class="cbt-range-grid">${pairs.map(p => `
      <div class="cbt-range-row"><span>${escQH(p.a)} ↔ ${escQH(p.b)}</span>${
        ref
          ? `<select class="cbt-sel" onchange="setRangeDirect('${p.aId}','${p.bId}',this.value);renderCombat()">${COMBAT_RANGE_BANDS.map((b,i)=>`<option value="${i}"${i===p.idx?' selected':''}>${b}</option>`).join('')}</select>`
          : `<span class="cbt-range-band">${escQH(p.band)}</span>`
      }</div>
    `).join('')}</div>`);
  }

  // Referee controls + hazard tooling + roster/fleet deployment
  if(ref){ out.push(renderCombatControls(enc)); out.push(renderHazardControls()); out.push(renderShipRoster(true)); }

  // Battle log
  out.push(`<div class="cbt-sec-tab">Battle Log</div>`);
  out.push(renderCombatLog(enc));

  body.innerHTML = out.join('');
  combatFXScan(); // replay any new battle-log events as abstract FX (Phase 5)
}

// Players never hold an unrevealed enemy, but guard the name anyway.
function redactedShipName(s){ return s.name || (s.ref === 'player' ? 'Our ship' : 'Contact'); }

function renderCombatShip(s, ref){
  const st = combatStatsOf(s);
  const destroyed = s.status === 'destroyed';
  const hull = st ? (Number(st.hullPoints) || 0) : 0, hullMax = st ? (Number(st.hullPointsMax) || 0) : 0;
  const str = st ? (Number(st.structurePoints) || 0) : 0, strMax = st ? (Number(st.structurePointsMax) || 0) : 0;
  const hullPct = hullMax > 0 ? Math.max(0, Math.min(100, hull / hullMax * 100)) : 0;
  const strPct = strMax > 0 ? Math.max(0, Math.min(100, str / strMax * 100)) : 0;
  const crits = st && st.crits ? Object.entries(st.crits).filter(([k, v]) => Number(v) > 0) : [];
  const tags = [];
  tags.push(`<span class="cbt-tag ${s.side === 'hostile' ? 'hostile' : 'allied'}">${s.side === 'hostile' ? 'Hostile' : 'Allied'}</span>`);
  if(ref && s.ref !== 'player' && !s.revealed) tags.push(`<span class="cbt-tag hidden">Hidden</span>`);
  if(destroyed) tags.push(`<span class="cbt-tag destroyed">Destroyed</span>`);
  const refCtl = (ref && s.ref !== 'player') ? `
    <div class="cbt-ctl-row" style="margin-top:2px">
      <button class="cbt-btn" onclick="openShipEditor('${s.id}')">✏ Edit</button>
      <button class="cbt-btn" onclick="uiToggleReveal('${s.id}')">${s.revealed ? '🙈 Hide from players' : '👁 Reveal to players'}</button>
      <button class="cbt-btn danger" onclick="uiRemoveShip('${s.id}')">Remove</button>
    </div>` : (ref && s.ref === 'player') ? `
    <div class="cbt-ctl-row" style="margin-top:2px">
      <button class="cbt-btn" onclick="openShipEditor('player')">✏ Edit combat stats</button>
    </div>` : '';
  return `<div class="cbt-ship side-${s.side === 'hostile' ? 'hostile' : 'allied'}${s.id === (combatEncounter && combatEncounter.activeShipId) ? ' is-active' : ''}${destroyed ? ' is-destroyed' : ''}" id="cbtship-${s.id}">
    <div class="cbt-ship-top">
      <span class="cbt-ship-name">${escQH(redactedShipName(s))}</span>
      <span class="cbt-ship-tags">${tags.join('')}</span>
    </div>
    <div class="cbt-bar-row"><span class="lbl">Hull</span><div class="cbt-bar"><div class="cbt-bar-fill hull${hullPct < 34 ? ' low' : ''}" style="width:${hullPct}%"></div></div><span>${hull}/${hullMax}</span></div>
    <div class="cbt-bar-row"><span class="lbl">Struct</span><div class="cbt-bar"><div class="cbt-bar-fill struct${strPct < 34 ? ' low' : ''}" style="width:${strPct}%"></div></div><span>${str}/${strMax}</span></div>
    ${crits.length ? `<div class="cbt-crits">${crits.map(([k, v]) => `<span class="cbt-crit">${escQH(k)} ${v}</span>`).join('')}</div>` : ''}
    ${refCtl}
  </div>`;
}

// Range pairs to display (names already fog-safe — redacted encounter is pruned).
function combatRangePairs(){
  if(!combatEncounter) return [];
  const out = [];
  Object.keys(combatEncounter.ranges).forEach(k => {
    const [a, b] = k.split('|');
    const sa = combatShipById(a), sb = combatShipById(b);
    if(!sa || !sb) return;
    const idx = combatEncounter.ranges[k];
    out.push({ aId: a, bId: b, a: redactedShipName(sa), b: redactedShipName(sb), idx, band: COMBAT_RANGE_BANDS[idx] || '—' });
  });
  return out;
}

// ── Tactical radar scope (CRT, player-centric) ──────────────────────────────
// Concentric rings are the range bands (Adjacent ~centre → Distant ~edge);
// each non-player ship is a blip at its range-to-player, on a stable bearing
// derived from its id so it doesn't jump around between renders. Hostile blips
// are clickable to pick the action target. Fog-safe: players only ever hold
// revealed ships, so only those reach this render.
function combatBearingDeg(id){ let h = 2166136261; for(let i = 0; i < id.length; i++){ h ^= id.charCodeAt(i); h = (h * 16777619) >>> 0; } return h % 360; }
function combatBandRadiusFrac(idx){ return 0.16 + (Math.max(0, idx) / (COMBAT_RANGE_BANDS.length - 1)) * 0.80; } // 0.16 (Adjacent) → 0.96 (Distant)

function renderCombatRadar(ref){
  if(!combatEncounter) return '';
  const player = combatEncounter.ships.find(s => s.ref === 'player');
  const others = combatEncounter.ships.filter(s => s.ref !== 'player');
  if(!player || !others.length) return ''; // nothing to plot yet

  // Range rings + their labels (skip Adjacent's ring to keep the centre clean).
  let rings = '<div class="cbt-radar-cross h"></div><div class="cbt-radar-cross v"></div>';
  COMBAT_RANGE_BANDS.forEach((band, i) => {
    const f = combatBandRadiusFrac(i);
    rings += `<div class="cbt-radar-ring" style="width:${(f * 100).toFixed(1)}%;height:${(f * 100).toFixed(1)}%"></div>`;
    rings += `<div class="cbt-radar-lbl" style="left:50%;top:${(50 - f * 50).toFixed(1)}%">${escQH(band)}</div>`;
  });

  // Blips
  let blips = `<div class="cbt-blip player" style="left:50%;top:50%" title="${escQH(redactedShipName(player))}">◊<span class="cbt-blip-lbl">${escQH(redactedShipName(player))}</span></div>`;
  others.forEach(s => {
    const idx = combatEncounter.ranges[combatPairKey(player.id, s.id)];
    const f = combatBandRadiusFrac(idx == null ? COMBAT_RANGE_BANDS.length - 1 : idx);
    const ang = combatBearingDeg(s.id) * Math.PI / 180;
    const x = 50 + f * 50 * Math.cos(ang), y = 50 + f * 50 * Math.sin(ang);
    const destroyed = s.status === 'destroyed';
    const cls = [ 'cbt-blip', s.side === 'hostile' ? 'hostile' : 'allied',
      destroyed ? 'destroyed' : '', (combatEncounter.activeShipId === s.id && !destroyed) ? 'active' : '',
      combatSelTarget === s.id ? 'sel' : '' ].filter(Boolean).join(' ');
    const glyph = destroyed ? '✕' : (s.side === 'hostile' ? '▲' : '◆');
    const click = (ref && !destroyed) ? ` onclick="uiSelectTarget('${s.id}')"` : '';
    blips += `<div class="${cls}" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%"${click} title="${escQH(redactedShipName(s))} — ${escQH(COMBAT_RANGE_BANDS[idx] || '?')}">${glyph}<span class="cbt-blip-lbl">${escQH(redactedShipName(s))}</span></div>`;
  });

  return `<div class="cbt-radar-wrap"><div class="cbt-radar">
    ${rings}<div class="cbt-radar-sweep"></div>${blips}
  </div></div>`;
}
function uiSelectTarget(id){ combatSelTarget = (combatSelTarget === id) ? null : id; renderCombat(); }

// ── Referee action controls (phase-appropriate) ─────────────────────────────
function renderCombatControls(enc){
  if(enc.status === 'setup'){
    return `<div class="cbt-sec-tab">Setup</div>
      <div class="cbt-controls">
        <div class="cbt-ctl-row">
          <input class="cbt-sel" id="cbt-new-name" placeholder="Enemy ship name" style="flex:1;min-width:120px">
          <button class="cbt-btn" onclick="uiAddEnemy()">+ Add ship</button>
        </div>
        <div class="cbt-ctl-row">
          <button class="cbt-btn primary" onclick="uiRollInit()" ${enc.ships.length < 2 ? 'disabled title="Add at least one enemy"' : ''}>🎲 Roll Initiative &amp; Begin</button>
          <button class="cbt-btn danger" onclick="uiEndEncounter()">End</button>
        </div>
        <div style="font-size:9px;color:var(--tx1)">Tip: add ships, then edit their full stats in the Ship panel flow (Phase 4). Enemies start at Long range, hidden until revealed.</div>
      </div>`;
  }
  if(enc.status !== 'active') {
    return `<div class="cbt-controls"><div class="cbt-ctl-row"><button class="cbt-btn primary" onclick="uiStartEncounter()">⚔ New Encounter</button></div></div>`;
  }

  const act = combatActiveShip();
  const others = combatLiveShips().filter(s => act && s.id !== act.id);
  const shipOpts = (sel) => combatLiveShips().map(s => `<option value="${s.id}"${s.id === sel ? ' selected' : ''}>${escQH(redactedShipName(s))}</option>`).join('');
  const targetOpts = others.map(s => `<option value="${s.id}"${s.id === combatSelTarget ? ' selected' : ''}>${escQH(redactedShipName(s))}</option>`).join('');
  let phaseCtl = '';

  if(enc.phase === 'manoeuvre'){
    const st = act ? combatStatsOf(act) : null;
    const maxThrust = st ? (Number(st.thrust) || 0) : 0;
    phaseCtl = `
      <div class="cbt-ctl-row">
        <span style="font-size:9px;color:var(--tx1)">Thrust (max ${maxThrust})</span>
        <input class="cbt-num" type="number" id="cbt-thrust" min="0" max="${maxThrust}" value="${act ? act.thrustAllocated : 0}">
        <button class="cbt-btn" onclick="uiAllocThrust()">Allocate</button>
        <span style="font-size:9px;color:var(--tx1)">Dodge</span>
        <input class="cbt-num" type="number" id="cbt-dodge" min="0" value="${act ? act.dodge : 0}">
        <button class="cbt-btn" onclick="uiDodge()">Evade</button>
      </div>
      ${others.length ? `<div class="cbt-ctl-row">
        <select class="cbt-sel" id="cbt-range-target">${targetOpts}</select>
        <button class="cbt-btn" onclick="uiChangeRange(-1)">▸ Close</button>
        <button class="cbt-btn" onclick="uiChangeRange(1)">◂ Open</button>
      </div>` : ''}`;
  } else if(enc.phase === 'attack'){
    const st = act ? combatStatsOf(act) : null;
    const weapons = st && st.weapons ? st.weapons : [];
    const wOpts = weapons.length ? weapons.map(w => `<option value="${w.id}">${escQH(w.name)} (${escQH(w.type)}${w.damage ? ', ' + escQH(w.damage) : ''})</option>`).join('') : `<option value="">— no weapons on sheet —</option>`;
    phaseCtl = `
      <div class="cbt-ctl-row">
        <select class="cbt-sel" id="cbt-atk-target" style="flex:1;min-width:90px">${targetOpts}</select>
        <select class="cbt-sel" id="cbt-atk-weapon" style="flex:1;min-width:90px">${wOpts}</select>
      </div>
      <div class="cbt-ctl-row">
        <button class="cbt-btn fire" onclick="uiFire()">🔥 Fire</button>
        <button class="cbt-btn" onclick="uiPointDefence()" title="Turret lasers vs incoming missiles">🛡 Point Defence</button>
        <button class="cbt-btn" onclick="uiSensorLock()" title="Electronics (Sensors) lock">📡 Lock</button>
      </div>`;
  } else { // action
    phaseCtl = `
      <div class="cbt-ctl-row">
        <select class="cbt-sel" id="cbt-act-target">${targetOpts}</select>
        <button class="cbt-btn" onclick="uiSensorLock()">📡 Sensor Lock</button>
      </div>
      <div class="cbt-ctl-row">
        <span style="font-size:9px;color:var(--tx1)">Leadership Effect</span>
        <input class="cbt-num" type="number" id="cbt-lead" value="0">
        <button class="cbt-btn" onclick="uiAdjustInit()" title="Adjust next round's initiative">Apply</button>
      </div>`;
  }

  return `<div class="cbt-sec-tab">Acting: ${act ? escQH(redactedShipName(act)) : '—'} — ${escQH(enc.phase)} phase</div>
    <div class="cbt-controls">
      ${phaseCtl}
      <div class="cbt-ctl-row" style="border-top:.5px solid var(--bd0);padding-top:6px;margin-top:2px">
        <button class="cbt-btn primary" onclick="uiAdvance()">Next ▸</button>
        <input class="cbt-sel" id="cbt-add-name" placeholder="Reinforcement" style="flex:1;min-width:90px">
        <button class="cbt-btn" onclick="uiAddEnemy()">+ Ship</button>
        <button class="cbt-btn danger" onclick="uiEndEncounter()">End</button>
      </div>
    </div>`;
}

function renderCombatLog(enc){
  const entries = (enc.log || []).slice(-60).reverse();
  if(!entries.length) return `<div class="cbt-log"><div style="font-size:10px;color:var(--tx1);font-style:italic">No actions yet.</div></div>`;
  return `<div class="cbt-log">${entries.map(e => {
    const bd = e.meta && e.meta.breakdown;
    let dmHTML = '';
    if(bd && Array.isArray(bd.dm)){
      const rows = bd.dm.map(d => `<div><span class="${d.value >= 0 ? 'pos' : 'neg'}">${d.value >= 0 ? '+' : ''}${d.value}</span> ${escQH(d.label)}</div>`).join('');
      dmHTML = `<span class="cbt-dm-toggle" onclick="toggleDMBreak('${e.id}')">[DM ${bd.total >= 0 ? '+' : ''}${bd.total}]</span>
        <div class="cbt-dm-break" id="dm-${e.id}">${rows}<div style="margin-top:3px;border-top:.5px solid var(--bd0);padding-top:3px">Target ${bd.difficulty}+ · range ${escQH(bd.band)}</div></div>`;
    }
    return `<div class="cbt-log-entry kind-${escQH(e.kind)}">${escQH(e.text)}${dmHTML}</div>`;
  }).join('')}</div>`;
}
function toggleDMBreak(id){ const el = document.getElementById('dm-' + id); if(el) el.classList.toggle('open'); }

// ── UI action wrappers (read DOM → call engine → re-render) ──────────────────
function uiStartEncounter(){ startEncounter(); renderCombat(); }
function uiEndEncounter(){ if(confirm('End this encounter? The battle log will be cleared.')){ endEncounter(); renderCombat(); } }
function uiRollInit(){ rollInitiative(); renderCombat(); }
function uiAdvance(){ advanceCombatTurn(); renderCombat(); }
function uiToggleReveal(id){
  const s = combatShipById(id); if(!s) return;
  s.revealed = !s.revealed;
  combatLog('system', `${s.name} ${s.revealed ? 'revealed to' : 'hidden from'} the players.`, { shipId: id });
  saveCombatEncounter(); renderCombat();
}
function uiRemoveShip(id){ if(confirm('Remove this ship from combat?')){ removeCombatShip(id); renderCombat(); } }
function uiAddEnemy(){
  const el = document.getElementById('cbt-new-name') || document.getElementById('cbt-add-name');
  const name = (el && el.value.trim()) || 'Hostile Contact';
  addCombatShip(makeShipStats({ name }), { name, side: 'hostile', revealed: false });
  renderCombat();
}
function uiAllocThrust(){ const act = combatActiveShip(); const v = document.getElementById('cbt-thrust'); if(act && v){ allocateThrust(act.id, v.value); renderCombat(); } }
function uiDodge(){ const act = combatActiveShip(); const v = document.getElementById('cbt-dodge'); if(act && v){ setDodge(act.id, v.value); renderCombat(); } }
function uiChangeRange(delta){
  const act = combatActiveShip(); const t = document.getElementById('cbt-range-target');
  if(!act || !t) return;
  const r = changeRange(act.id, t.value, delta);
  if(!r.ok && r.reason) combatLog('manoeuvre', `Manoeuvre failed: ${r.reason}.`);
  saveCombatEncounter(); renderCombat();
}
function uiFire(){
  const act = combatActiveShip(); const t = document.getElementById('cbt-atk-target'); const w = document.getElementById('cbt-atk-weapon');
  if(!act || !t || !t.value) return;
  resolveAttack(act.id, t.value, w ? w.value : null);
  renderCombat();
}
function uiPointDefence(){ const act = combatActiveShip(); if(act){ pointDefence(act.id, null); renderCombat(); } }
function uiSensorLock(){
  const act = combatActiveShip();
  const t = document.getElementById('cbt-atk-target') || document.getElementById('cbt-act-target');
  if(act && t && t.value){ attemptSensorLock(act.id, t.value); renderCombat(); }
}
function uiAdjustInit(){ const act = combatActiveShip(); const v = document.getElementById('cbt-lead'); if(act && v){ adjustInitiative(act.id, Number(v.value) || 0); renderCombat(); } }

// ═══════════════════════════════════════════════════════════════════════════
// SPACE COMBAT — Phase 4: referee tooling (ship editor, hazards, setup)
// ───────────────────────────────────────────────────────────────────────────
// Enemy/NPC ships are edited with the SAME ship-data-file layout as the player
// ship (sf-* sheet classes), via generic field helpers that write to the ship's
// stats block — one ship model, one edit idiom. Environmental hazards are a
// referee-toggleable list stored on the encounter; their DMs fold live into the
// engine's attack/sensor resolution (no reload — players pick them up on poll).
// ═══════════════════════════════════════════════════════════════════════════

const COMBAT_WEAPON_TYPES = ['beam-laser','pulse-laser','missile','sandcaster','plasma'];

// Hazard presets. DMs are FLAGGED tunables (referee can edit per-instance): they
// reflect the spirit of MgT2e environmental effects, not a quoted table.
const COMBAT_HAZARDS = {
  asteroid: { kind:'asteroid', name:'Asteroid Field', attackDM:-1, sensorDM:-2, thrustPenalty:0,
              note:'Cover & collision risk — attacks and sensors hampered.' },
  nebula:   { kind:'nebula', name:'Nebula / Interference', attackDM:0, sensorDM:-4, thrustPenalty:0,
              note:'Sensors badly degraded; locks hard to gain.' },
  gravity:  { kind:'gravity', name:'Gravity Well', attackDM:0, sensorDM:0, thrustPenalty:2,
              note:'Manoeuvring fights the well — effective Thrust reduced.' },
  debris:   { kind:'debris', name:'Debris Field', attackDM:-1, sensorDM:-1, thrustPenalty:1,
              note:'Scattered wreckage — minor penalties all round.' },
  dust:     { kind:'dust', name:'Dust / Solar Glare', attackDM:-2, sensorDM:0, thrustPenalty:0,
              note:'Visual obscuration — gunnery hampered.' }
};

function combatActiveHazards(){ return combatEncounter ? (combatEncounter.hazards || []).filter(h => h.active) : []; }
function combatHazardAttackDM(){ return combatActiveHazards().reduce((s, h) => s + (Number(h.attackDM) || 0), 0); }
function combatHazardSensorDM(){ return combatActiveHazards().reduce((s, h) => s + (Number(h.sensorDM) || 0), 0); }
function combatHazardThrustPenalty(){ return combatActiveHazards().reduce((s, h) => s + (Number(h.thrustPenalty) || 0), 0); }

function addHazard(kind){
  if(!isReferee() || !combatEncounter) return;
  const p = COMBAT_HAZARDS[kind]; if(!p) return;
  combatEncounter.hazards = combatEncounter.hazards || [];
  combatEncounter.hazards.push(Object.assign({ id: 'hz_' + Math.random().toString(36).slice(2, 8), active: true }, p));
  combatLog('system', `Environmental hazard added: ${p.name} (active).`);
  saveCombatEncounter();
}
function toggleHazard(id){
  if(!isReferee() || !combatEncounter) return;
  const h = (combatEncounter.hazards || []).find(x => x.id === id); if(!h) return;
  h.active = !h.active;
  combatLog('system', `${h.name} ${h.active ? 'activated' : 'cleared'}.`);
  saveCombatEncounter();
}
function removeHazard(id){
  if(!isReferee() || !combatEncounter) return;
  combatEncounter.hazards = (combatEncounter.hazards || []).filter(x => x.id !== id);
  saveCombatEncounter();
}

// Referee fiat: set a pair's range band directly (setup, ambush, or correction)
// — no Thrust cost, since this is the referee placing ships, not a manoeuvre.
function setRangeDirect(aId, bId, bandIdx){
  if(!isReferee() || !combatEncounter) return;
  combatEncounter.ranges[combatPairKey(aId, bId)] = Math.max(0, Math.min(COMBAT_RANGE_BANDS.length - 1, Number(bandIdx) || 0));
  saveCombatEncounter();
}

// ── Generic stat editor (works for enemy stats AND the player's shipState) ───
// The player ship is editable as id 'player' even with no active encounter
// (it reads/writes shipState directly); enemies resolve through the encounter.
function combatEditIsPlayer(shipId){ return shipId === 'player' || (combatShipById(shipId) || {}).ref === 'player'; }
function combatEditStats(shipId){
  if(combatEditIsPlayer(shipId)) return shipState;
  const rs = (typeof rosterShipById === 'function') ? rosterShipById(shipId) : null;
  if(rs) return rs.stats;
  const s = combatShipById(shipId); return s ? combatStatsOf(s) : null;
}
function persistShipStat(shipId){
  if(combatEditIsPlayer(shipId)){ saveShipState(); if(typeof checkHullAutoAlert === 'function') checkHullAutoAlert(); if(shipPanelOpen && typeof renderShipPanel === 'function') renderShipPanel(); }
  else if(typeof rosterShipById === 'function' && rosterShipById(shipId)){ saveShipRoster(); if(typeof combatPanelOpen !== 'undefined' && combatPanelOpen && typeof renderCombat === 'function') renderCombat(); }
  else if(combatEncounter){ saveCombatEncounter(); }
}
function updateCombatShipStat(shipId, path, value){
  if(!isReferee()) return;
  const st = combatEditStats(shipId); if(!st) return;
  const numericFlat = ['tonnage','jumpRating','hullPoints','hullPointsMax','structurePoints','structurePointsMax','thrust','power','powerMax','armourRating','sensorDM','fuel','fuelMax'];
  if(path.indexOf('crewSkills.') === 0){
    const k = path.split('.')[1];
    st.crewSkills = st.crewSkills || {};
    st.crewSkills[k] = Number(value) || 0;
  } else {
    st[path] = numericFlat.includes(path) ? (Number(value) || 0) : value;
  }
  persistShipStat(shipId); renderShipEditor(); renderCombat();
}
function addCombatWeapon(shipId){
  if(!isReferee()) return;
  const st = combatEditStats(shipId); if(!st) return;
  st.weapons = st.weapons || [];
  st.weapons.push({ id: 'w_' + Math.random().toString(36).slice(2, 7), name: 'New Weapon', type: 'beam-laser', mount: 'turret', damage: '2D', range: 'Very Long', ammo: 0, ammoMax: 0, notes: '' });
  persistShipStat(shipId); renderShipEditor();
}
function updateCombatWeapon(shipId, wid, field, value){
  if(!isReferee()) return;
  const st = combatEditStats(shipId); if(!st || !st.weapons) return;
  const w = st.weapons.find(x => x.id === wid); if(!w) return;
  w[field] = (field === 'ammo' || field === 'ammoMax') ? (Number(value) || 0) : value;
  persistShipStat(shipId); renderShipEditor(); renderCombat();
}
function removeCombatWeapon(shipId, wid){
  if(!isReferee()) return;
  const st = combatEditStats(shipId); if(!st || !st.weapons) return;
  st.weapons = st.weapons.filter(x => x.id !== wid);
  persistShipStat(shipId); renderShipEditor();
}

// ═══════════════════════════════════════════════════════════════════════════
// WEAPONS CATALOG  (Design Mode · reusable MgT2e weapon templates)
// ───────────────────────────────────────────────────────────────────────────
// A referee-authored library of weapons that can be picked into ANY ship's
// combat loadout (the ship editor), so stats are entered once and reused. This
// is reference/bookkeeping only — it never resolves combat. Net-new entity: a
// WEAPONS_BASE seed of the standard turret/bay weapons + the same add/edit/
// remove overlay the other Design-Mode entities use (weaponAdditions/Deletions/
// PropertyOverrides), read on demand via effectiveWeapons(). A template carries
// the ship-weapon fields (name/type/mount/damage/range/ammoMax) plus reference
// traits + TL that fold into the attached weapon's notes.
const WEAPONS_BASE = [
  { id:'wb-beam',    name:'Beam Laser',      type:'beam-laser',  mount:'turret',   damage:'1D',      range:'Very Long', ammoMax:0,  traits:'',          tl:10, notes:'' },
  { id:'wb-pulse',   name:'Pulse Laser',     type:'pulse-laser', mount:'turret',   damage:'2D',      range:'Long',      ammoMax:0,  traits:'',          tl:10, notes:'' },
  { id:'wb-missile', name:'Missile Rack',    type:'missile',     mount:'turret',   damage:'4D',      range:'Very Long', ammoMax:12, traits:'Smart',     tl:9,  notes:'Missiles travel over rounds at longer ranges.' },
  { id:'wb-sand',    name:'Sandcaster',      type:'sandcaster',  mount:'turret',   damage:'special', range:'—',         ammoMax:20, traits:'Defensive', tl:9,  notes:'Point defence — reduces incoming laser damage.' },
  { id:'wb-plasma',  name:'Plasma Barbette', type:'plasma',      mount:'barbette', damage:'',        range:'Medium',    ammoMax:0,  traits:'',          tl:12, notes:'Set damage to your High Guard build.' },
];
let weaponAdditions = [];
let weaponDeletions = {};
let weaponPropertyOverrides = {};

async function loadWeaponCatalog(){
  try { const r = await supaStorage.get('weapon-additions', true);      weaponAdditions = (r.value!=null ? JSON.parse(r.value) : []); if(!Array.isArray(weaponAdditions)) weaponAdditions = []; } catch(e){ weaponAdditions = []; }
  try { const r = await supaStorage.get('weapon-deletions', true);      weaponDeletions = (r.value!=null ? JSON.parse(r.value) : {}); } catch(e){ weaponDeletions = {}; }
  try { const r = await supaStorage.get('weapon-prop-overrides', true); weaponPropertyOverrides = (r.value!=null ? JSON.parse(r.value) : {}); } catch(e){ weaponPropertyOverrides = {}; }
}
async function saveWeaponAdditions(){ try { await supaStorage.set('weapon-additions', JSON.stringify(weaponAdditions), true); } catch(e){ console.error('Weapon additions save failed', e); } }
async function saveWeaponDeletions(){ try { await supaStorage.set('weapon-deletions', JSON.stringify(weaponDeletions), true); } catch(e){ console.error('Weapon deletions save failed', e); } }
async function saveWeaponPropertyOverrides(){ try { await supaStorage.set('weapon-prop-overrides', JSON.stringify(weaponPropertyOverrides), true); } catch(e){ console.error('Weapon prop overrides save failed', e); } }

// Effective catalog = seed (minus tombstoned, with overrides) + referee additions.
function effectiveWeapons(){
  const out = [];
  WEAPONS_BASE.forEach(w => {
    if(weaponDeletions[w.id]) return;
    const ov = weaponPropertyOverrides[w.id];
    out.push(ov ? Object.assign(JSON.parse(JSON.stringify(w)), ov) : JSON.parse(JSON.stringify(w)));
  });
  weaponAdditions.forEach(w => { if(!weaponDeletions[w.id]) out.push(JSON.parse(JSON.stringify(w))); });
  return out;
}
function isBaseWeapon(id){ return WEAPONS_BASE.some(w => w.id === id); }
function reRenderShipEditorIfOpen(){ if(typeof shipEditorId!=='undefined' && shipEditorId && typeof renderShipEditor==='function') renderShipEditor(); }

function wpnAdd(){
  if(!isReferee()) return;
  let id = 'wpn' + Date.now().toString(36), bump = 1;
  while(effectiveWeapons().some(w=>w.id===id) || weaponDeletions[id]) id = 'wpn' + (Date.now()+bump++).toString(36);
  weaponAdditions.push({ id, name:'New Weapon', type:'beam-laser', mount:'turret', damage:'1D', range:'Very Long', ammoMax:0, traits:'', tl:'', notes:'' });
  saveWeaponAdditions();
  reRenderShipEditorIfOpen();
}
function wpnEditField(id, field, value){
  if(!isReferee()) return;
  if(field==='ammoMax') value = Number(value)||0;
  const add = weaponAdditions.find(w=>w.id===id);
  if(add){ add[field]=value; saveWeaponAdditions(); }
  else if(isBaseWeapon(id)){ if(!weaponPropertyOverrides[id]) weaponPropertyOverrides[id]={}; weaponPropertyOverrides[id][field]=value; saveWeaponPropertyOverrides(); }
  else return;
  reRenderShipEditorIfOpen();
}
async function wpnRemove(id){
  if(!isReferee()) return;
  const w = effectiveWeapons().find(x=>x.id===id); if(!w) return;
  if(!confirm('Remove "'+(w.name||'weapon')+'" from the catalog?\n\nShips already carrying it keep their copy. Restorable from "Show Removed Items".')) return;
  const add = weaponAdditions.find(x=>x.id===id);
  weaponDeletions[id] = { w: add || JSON.parse(JSON.stringify(w)), t: Date.now(), wasAddition: !!add };
  if(add) weaponAdditions = weaponAdditions.filter(x=>x.id!==id);
  await saveWeaponDeletions(); if(add) await saveWeaponAdditions();
  reRenderShipEditorIfOpen();
  showToast('Weapon removed from catalog', 'info');
}
async function restoreDeletedWeapon(id){
  const entry = weaponDeletions[id]; if(!entry) return;
  if(entry.wasAddition && entry.w){ if(!weaponAdditions.some(x=>x.id===id)) weaponAdditions.push(entry.w); await saveWeaponAdditions(); }
  delete weaponDeletions[id]; await saveWeaponDeletions();
  if(typeof closeRemovedItemsPanel==='function') closeRemovedItemsPanel();
  reRenderShipEditorIfOpen();
  showToast('Weapon restored');
}

// Attach a catalog template to a ship's loadout — pre-fills a new weapon row the
// referee can still tweak per-ship. Reference traits + TL fold into its notes.
function addCombatWeaponFromCatalog(shipId, weaponId){
  if(!isReferee()) return;
  if(!weaponId) return;
  const st = (typeof combatEditStats==='function') ? combatEditStats(shipId) : null; if(!st) return;
  const tpl = effectiveWeapons().find(w=>w.id===weaponId); if(!tpl) return;
  st.weapons = st.weapons || [];
  const notes = [tpl.notes, tpl.traits?('Traits: '+tpl.traits):'', (tpl.tl!=='' && tpl.tl!=null)?('TL'+tpl.tl):''].filter(Boolean).join(' · ');
  st.weapons.push({ id:'w_'+Math.random().toString(36).slice(2,7), name:tpl.name, type:tpl.type, mount:tpl.mount||'turret', damage:tpl.damage||'', range:tpl.range||'Very Long', ammo:tpl.ammoMax||0, ammoMax:tpl.ammoMax||0, notes });
  if(typeof persistShipStat==='function') persistShipStat(shipId);
  reRenderShipEditorIfOpen();
  showToast('Added ' + (tpl.name||'weapon') + ' from catalog');
}

// ── Catalog manager (inline in the ship editor, referee only) ────────────────
let weaponCatalogOpen = false;
function toggleWeaponCatalog(){ weaponCatalogOpen = !weaponCatalogOpen; reRenderShipEditorIfOpen(); }
function renderWeaponCatalogManager(){
  if(!isReferee()) return '';
  const cat = effectiveWeapons();
  const ea = (typeof escAttr==='function') ? (v=>escAttr(v==null?'':String(v))) : (v=>String(v==null?'':v));   // coerce — tl/ammo may be numbers
  const mounts = ['turret','fixed','barbette','bay'];
  const rows = cat.map(w => {
    const typeOpts = COMBAT_WEAPON_TYPES.map(t=>`<option value="${t}"${t===w.type?' selected':''}>${t}</option>`).join('');
    const mountOpts = mounts.map(m=>`<option value="${m}"${m===w.mount?' selected':''}>${m}</option>`).join('');
    return `<div class="cbt-weap-row" style="flex-wrap:wrap;gap:4px">
      <input class="sf-input" style="flex:2;min-width:88px" value="${ea(w.name||'')}" title="Name" onchange="wpnEditField('${w.id}','name',this.value)">
      <select class="cbt-sel" title="Type" onchange="wpnEditField('${w.id}','type',this.value)">${typeOpts}</select>
      <select class="cbt-sel" title="Mount" onchange="wpnEditField('${w.id}','mount',this.value)">${mountOpts}</select>
      <input class="sf-input" style="width:48px" value="${ea(w.damage||'')}" placeholder="dmg" title="Damage dice, e.g. 2D" onchange="wpnEditField('${w.id}','damage',this.value)">
      <input class="sf-input" style="width:74px" value="${ea(w.range||'')}" placeholder="range" title="Range band" onchange="wpnEditField('${w.id}','range',this.value)">
      <input class="sf-input" style="width:54px" type="number" value="${Number(w.ammoMax)||0}" title="Ammo capacity (missiles/sandcaster)" onchange="wpnEditField('${w.id}','ammoMax',this.value)">
      <input class="sf-input" style="flex:1;min-width:66px" value="${ea(w.traits||'')}" placeholder="traits" title="Traits, e.g. Smart, Scatter" onchange="wpnEditField('${w.id}','traits',this.value)">
      <input class="sf-input" style="width:40px" value="${ea((w.tl===0||w.tl)?w.tl:'')}" placeholder="TL" title="Tech level" onchange="wpnEditField('${w.id}','tl',this.value)">
      <button class="cbt-btn danger" title="Remove from catalog" onclick="wpnRemove('${w.id}')">✕</button>
    </div>`;
  }).join('');
  return `<div style="margin-top:8px;padding:8px;border:1px dashed #b9c0b9;border-radius:6px;background:#f3f6f3">
    <div style="font-size:10px;color:#6a6f6a;margin-bottom:6px">Weapon catalog — author reusable templates, then add them to any ship above.</div>
    ${rows || '<div style="font-size:11px;color:#7a7a7a">Catalog is empty.</div>'}
    <button class="cbt-btn" style="margin-top:6px" onclick="wpnAdd()">+ New catalog weapon</button>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// SHIP ROSTER + FLEETS  (Design Mode · author NPC/enemy ships, group, deploy)
// ───────────────────────────────────────────────────────────────────────────
// A persistent referee library of ships built off the SAME combat-ship stat
// block (makeShipStats) the encounter uses — authored ahead of time, edited
// through the existing ship editor (openShipEditor), grouped into fleets, and
// dropped into an encounter via addCombatShip. Plus a generate-then-edit ship
// builder (genShipStats) like the UWP world generator. This is authoring +
// organisation only: the referee and the dice run the fight, exactly as before.
// Stored in aurelia_state 'ship-roster' = { ships:[{id,name,side,stats}], fleets:[{id,name,shipIds[]}] }.
let shipRoster = { ships: [], fleets: [] };

async function loadShipRoster(){
  // Referee tool — don't pull enemy prep into a player's memory.
  if(typeof isReferee === 'function' && !isReferee()){ shipRoster = { ships: [], fleets: [] }; return; }
  try {
    const r = await supaStorage.get('ship-roster', true);
    const v = r.value != null ? JSON.parse(r.value) : null;
    shipRoster = (v && typeof v === 'object')
      ? { ships: Array.isArray(v.ships) ? v.ships : [], fleets: Array.isArray(v.fleets) ? v.fleets : [] }
      : { ships: [], fleets: [] };
  } catch(e){ shipRoster = { ships: [], fleets: [] }; }
}
async function saveShipRoster(){ try { await supaStorage.set('ship-roster', JSON.stringify(shipRoster), true); } catch(e){ console.error('Ship roster save failed', e); } }
function rosterShipById(id){ return ((shipRoster && shipRoster.ships) || []).find(s => s.id === id) || null; }

// ── Generate-then-edit ship builder (reuses the weapons catalog for loadouts) ──
function genShipStats(opts){
  opts = opts || {};
  const tonnage = Math.max(10, Number(opts.tonnage) || 100);
  const tl = Math.max(7, Math.min(15, Number(opts.tl) || 12));
  const role = opts.role || 'patrol';
  const ROLE = {
    fighter: { thrust:6, jump:0, armour:2, gun:2, pilot:2, tac:0, weps:['pulse-laser'] },
    escort:  { thrust:4, jump:1, armour:4, gun:2, pilot:1, tac:1, weps:['beam-laser','beam-laser'] },
    patrol:  { thrust:3, jump:2, armour:4, gun:1, pilot:1, tac:1, weps:['beam-laser','missile'] },
    raider:  { thrust:5, jump:1, armour:3, gun:2, pilot:2, tac:1, weps:['pulse-laser','missile'] },
    trader:  { thrust:1, jump:2, armour:0, gun:0, pilot:1, tac:0, weps:['sandcaster'] },
    capital: { thrust:2, jump:1, armour:6, gun:3, pilot:1, tac:3, weps:['plasma','beam-laser','missile'] },
  };
  const r = ROLE[role] || ROLE.patrol;
  const hp = Math.max(1, Math.round(tonnage * 0.4));   // matches the player ship default (100t → 40 HP)
  const pwr = Math.max(1, Math.round(tonnage * 0.6));
  const cat = (typeof effectiveWeapons === 'function') ? effectiveWeapons() : [];
  const fromCatalog = t => {
    const tpl = cat.find(w => w.type === t);
    if(tpl){
      const notes = [tpl.notes, tpl.traits ? ('Traits: ' + tpl.traits) : '', (tpl.tl !== '' && tpl.tl != null) ? ('TL' + tpl.tl) : ''].filter(Boolean).join(' · ');
      return { id:'w_'+Math.random().toString(36).slice(2,7), name:tpl.name, type:tpl.type, mount:tpl.mount||'turret', damage:tpl.damage||'', range:tpl.range||'Very Long', ammo:tpl.ammoMax||0, ammoMax:tpl.ammoMax||0, notes };
    }
    return { id:'w_'+Math.random().toString(36).slice(2,7), name:t, type:t, mount:'turret', damage:'2D', range:'Very Long', ammo:0, ammoMax:0, notes:'' };
  };
  return makeShipStats({
    name: opts.name || ('TL' + tl + ' ' + role.charAt(0).toUpperCase() + role.slice(1)),
    tonnage, jumpRating: r.jump, armourRating: r.armour,
    hullPoints: hp, hullPointsMax: hp, structurePoints: hp, structurePointsMax: hp,
    thrust: r.thrust, power: pwr, powerMax: pwr, sensorDM: (tl>=14?2:(tl>=12?1:0)),
    crewSkills: { pilot:r.pilot, gunnery:r.gun, engineer:1, sensors:1, tactics:r.tac, leadership:Math.max(0,r.tac-1) },
    weapons: (r.weps || []).map(fromCatalog)
  });
}

// ── Roster CRUD + fleets (referee) ──
function rosterAddShip(stats){
  if(!isReferee()) return null;
  const id = 'rsh_' + Math.random().toString(36).slice(2,8);
  shipRoster.ships = shipRoster.ships || [];
  shipRoster.ships.push({ id, name: (stats && stats.name) || 'New Ship', side: 'hostile', stats: makeShipStats(stats || {}) });
  saveShipRoster();
  return id;
}
function rosterDuplicate(id){
  if(!isReferee()) return;
  const s = rosterShipById(id); if(!s) return;
  const copy = JSON.parse(JSON.stringify(s));
  copy.id = 'rsh_' + Math.random().toString(36).slice(2,8);
  copy.name = (s.name || 'Ship') + ' (copy)';
  (copy.stats.weapons || []).forEach(w => { w.id = 'w_' + Math.random().toString(36).slice(2,7); });
  shipRoster.ships.push(copy); saveShipRoster();
}
function rosterRemove(id){
  if(!isReferee()) return;
  shipRoster.ships = (shipRoster.ships || []).filter(s => s.id !== id);
  (shipRoster.fleets || []).forEach(f => { f.shipIds = (f.shipIds || []).filter(x => x !== id); });
  saveShipRoster();
}
function rosterDeployShip(id){
  if(!isReferee() || !combatEncounter) return null;
  const s = rosterShipById(id); if(!s) return null;
  // Deploy a COPY so the encounter ship is independent of the roster template.
  return addCombatShip(JSON.parse(JSON.stringify(s.stats)), { name: s.name, side: s.side || 'hostile', revealed: false });
}
function fleetCreate(name){ if(!isReferee()) return; shipRoster.fleets = shipRoster.fleets || []; shipRoster.fleets.push({ id:'flt_'+Math.random().toString(36).slice(2,8), name: name || 'Fleet', shipIds: [] }); saveShipRoster(); }
function fleetRemove(id){ if(!isReferee()) return; shipRoster.fleets = (shipRoster.fleets || []).filter(f => f.id !== id); saveShipRoster(); }
function fleetAddShip(fid, sid){ if(!isReferee()) return; const f = (shipRoster.fleets || []).find(x => x.id === fid); if(!f || !rosterShipById(sid)) return; f.shipIds = f.shipIds || []; f.shipIds.push(sid); saveShipRoster(); }   // duplicates allowed (e.g. Corsair ×3)
function fleetDeploy(fid){ if(!isReferee() || !combatEncounter) return; const f = (shipRoster.fleets || []).find(x => x.id === fid); if(!f) return; (f.shipIds || []).forEach(sid => rosterDeployShip(sid)); }

// ── Combat-panel section: roster + fleets + generator (referee only) ──
function renderShipRoster(hasEncounter){
  if(!isReferee()) return '';
  const R = shipRoster || { ships:[], fleets:[] };
  const ships = R.ships || [], fleets = R.fleets || [];
  const ea = (typeof escQH === 'function') ? escQH : (x => String(x==null?'':x));
  const shipRows = ships.map(s => {
    const st = s.stats || {}; const wc = (st.weapons || []).length;
    const deploy = hasEncounter ? `<button class="cbt-btn" title="Add a copy to the current encounter" onclick="uiRosterDeploy('${s.id}')">→ enc</button>` : '';
    return `<div class="cbt-haz-row">
      <span class="cbt-haz-name">${ea(s.name || 'Ship')}</span>
      <span class="cbt-haz-dm">${Number(st.tonnage)||0}t · hull ${Number(st.hullPointsMax)||0} · ${wc} wpn</span>
      <button class="cbt-btn" title="Edit stats" onclick="openShipEditor('${s.id}')">✎</button>
      <button class="cbt-btn" title="Duplicate" onclick="uiRosterDuplicate('${s.id}')">⧉</button>
      ${deploy}
      <button class="cbt-btn danger" title="Remove from roster" onclick="uiRosterRemove('${s.id}')">✕</button>
    </div>`;
  }).join('');
  const fleetRows = fleets.map(f => {
    const names = (f.shipIds || []).map(id => { const s = ships.find(x => x.id === id); return s ? ea(s.name) : '?'; }).join(', ');
    const opts = ships.map(s => `<option value="${s.id}">${ea(s.name)}</option>`).join('');
    const deploy = hasEncounter ? `<button class="cbt-btn" title="Add the whole fleet" onclick="uiFleetDeploy('${f.id}')">→ enc</button>` : '';
    return `<div class="cbt-haz-row" style="flex-wrap:wrap">
      <span class="cbt-haz-name">${ea(f.name || 'Fleet')} <span style="color:var(--tx1)">(${(f.shipIds||[]).length})</span></span>
      ${deploy}
      <button class="cbt-btn danger" title="Disband fleet (ships stay)" onclick="uiFleetRemove('${f.id}')">✕</button>
      <div style="flex-basis:100%;font-size:9px;color:var(--tx1);margin-top:2px">${names || 'empty'}</div>
      ${ships.length ? `<div style="flex-basis:100%;display:flex;gap:4px;margin-top:3px"><select class="cbt-sel" id="flt-add-${f.id}" style="flex:1">${opts}</select><button class="cbt-btn" onclick="uiFleetAddShip('${f.id}')">+ add</button></div>` : ''}
    </div>`;
  }).join('');
  const roleOpts = ['escort','patrol','raider','trader','fighter','capital'].map(r => `<option value="${r}">${r}</option>`).join('');
  return `<div class="cbt-sec-tab">Ship Roster &amp; Fleets</div>
    <div class="cbt-controls">
      ${shipRows || '<div style="font-size:10px;color:var(--tx1)">No ships in the roster yet — add a blank one or generate one below.</div>'}
      <div class="cbt-ctl-row" style="border-top:.5px solid var(--bd0);padding-top:6px;margin-top:2px">
        <button class="cbt-btn" onclick="uiRosterAddBlank()">+ Blank ship</button>
      </div>
      <div class="cbt-ctl-row">
        <span style="font-size:9px;color:var(--tx1)">Generate</span>
        <input class="cbt-num" id="gen-tonnage" type="number" min="10" step="10" value="200" title="Tonnage" style="width:62px">
        <input class="cbt-num" id="gen-tl" type="number" min="7" max="15" value="12" title="Tech level" style="width:46px">
        <select class="cbt-sel" id="gen-role" title="Role">${roleOpts}</select>
        <button class="cbt-btn primary" onclick="uiRosterGenerate()">⚙ Generate</button>
      </div>
      ${(fleets.length || ships.length) ? `<div class="cbt-sec-tab" style="margin-top:6px">Fleets</div>${fleetRows}` : ''}
      <div class="cbt-ctl-row"><button class="cbt-btn" onclick="uiFleetCreate()">+ New fleet</button></div>
    </div>`;
}

// UI wrappers (referee)
function uiRosterAddBlank(){ const id = rosterAddShip(makeShipStats({ name:'New Ship' })); if(id) openShipEditor(id); }
function uiRosterGenerate(){
  const t = document.getElementById('gen-tonnage'), tl = document.getElementById('gen-tl'), role = document.getElementById('gen-role');
  const stats = genShipStats({ tonnage: t ? t.value : 200, tl: tl ? tl.value : 12, role: role ? role.value : 'patrol' });
  const id = rosterAddShip(stats); if(id) openShipEditor(id);
}
function uiRosterDuplicate(id){ rosterDuplicate(id); renderCombat(); }
function uiRosterRemove(id){ if(confirm('Remove this ship from the roster?')){ if(typeof shipEditorId!=='undefined' && shipEditorId===id && typeof closeShipEditor==='function') closeShipEditor(); rosterRemove(id); renderCombat(); } }
function uiRosterDeploy(id){ const did = rosterDeployShip(id); if(did) renderCombat(); else showToast('Start an encounter first', 'info'); }
function uiFleetCreate(){ const n = prompt('Fleet name:'); if(n){ fleetCreate(n); renderCombat(); } }
function uiFleetRemove(id){ if(confirm('Disband this fleet? (Its ships stay in the roster.)')){ fleetRemove(id); renderCombat(); } }
function uiFleetAddShip(fid){ const sel = document.getElementById('flt-add-' + fid); if(sel && sel.value){ fleetAddShip(fid, sel.value); renderCombat(); } }
function uiFleetDeploy(fid){ fleetDeploy(fid); renderCombat(); }

// ── Enemy ship editor modal (reuses the ship-data-file sheet layout) ─────────
let shipEditorId = null;
function openShipEditor(shipId){ shipEditorId = shipId; document.getElementById('combat-edit-modal').classList.remove('hidden'); renderShipEditor(); }
function closeShipEditor(){ shipEditorId = null; const m = document.getElementById('combat-edit-modal'); if(m) m.classList.add('hidden'); }

// Field helpers — mirror sfTextField/sfNumField but target a combat ship's stats.
function efText(shipId, field, ph){ const st = combatEditStats(shipId); return `<input class="sf-input" type="text" value="${escAttr(st ? st[field] : '')}" placeholder="${escAttr(ph||'')}" onchange="updateCombatShipStat('${shipId}','${field}',this.value)">`; }
function efNum(shipId, field, sfx){ const st = combatEditStats(shipId); return `<input class="sf-input" type="number" step="any" value="${st ? st[field] : 0}" onchange="updateCombatShipStat('${shipId}','${field}',this.value)">${sfx ? ` ${escQH(sfx)}` : ''}`; }
function efSkill(shipId, skill){ const st = combatEditStats(shipId); const v = st && st.crewSkills ? (st.crewSkills[skill] || 0) : 0; return `<input class="sf-input sm" type="number" step="1" value="${v}" onchange="updateCombatShipStat('${shipId}','crewSkills.${skill}',this.value)">`; }

function renderShipEditor(){
  const card = document.getElementById('combat-edit-card');
  if(!card || !shipEditorId) return;
  const isPlayer = combatEditIsPlayer(shipEditorId);
  const ship = isPlayer ? { id: 'player', ref: 'player', name: shipState.name }
    : (combatShipById(shipEditorId) || ((typeof rosterShipById === 'function') ? rosterShipById(shipEditorId) : null));
  if(!ship){ closeShipEditor(); return; }
  const st = combatEditStats(shipEditorId);
  const wRows = (st.weapons || []).map(w => `
    <div class="cbt-weap-row">
      <input class="sf-input" style="flex:2" value="${escAttr(w.name)}" onchange="updateCombatWeapon('${ship.id}','${w.id}','name',this.value)">
      <select class="cbt-sel" onchange="updateCombatWeapon('${ship.id}','${w.id}','type',this.value)">${COMBAT_WEAPON_TYPES.map(t => `<option value="${t}"${t === w.type ? ' selected' : ''}>${t}</option>`).join('')}</select>
      <input class="sf-input" style="width:56px" value="${escAttr(w.damage || '')}" placeholder="dmg" title="Damage dice, e.g. 2D" onchange="updateCombatWeapon('${ship.id}','${w.id}','damage',this.value)">
      <button class="cbt-btn danger" onclick="removeCombatWeapon('${ship.id}','${w.id}')">✕</button>
    </div>`).join('');
  const catItems = (typeof effectiveWeapons==='function') ? effectiveWeapons() : [];
  const catOpts = catItems.map(w => `<option value="${w.id}">${escQH(w.name)}${w.damage?(' · '+escQH(w.damage)):''}${w.mount?(' · '+escQH(w.mount)):''}</option>`).join('');
  card.innerHTML = `
    <div class="cbt-edit-hdr">
      <span>✏ ${escQH(ship.ref === 'player' ? 'Edit Player Ship' : 'Edit Ship')}</span>
      <button class="cbt-btn" onclick="closeShipEditor()">✕ Close</button>
    </div>
    <div class="cbt-edit-body">
      <div class="sf-sec"><div class="sf-tab">Ship Data File</div><div class="sf-card">
        <div class="sf-row"><span class="sf-lbl">Name</span><span class="sf-fld">${efText(ship.id,'name','Ship name')}</span></div>
        <div class="sf-row"><span class="sf-lbl">Class</span><span class="sf-fld">${efText(ship.id,'shipClass')}</span></div>
        <div class="sf-row"><span class="sf-lbl">Size</span><span class="sf-fld">${efNum(ship.id,'tonnage','tons')}</span></div>
        <div class="sf-row"><span class="sf-lbl">Armour</span><span class="sf-fld">${efNum(ship.id,'armourRating')}</span></div>
      </div></div>
      <div class="sf-sec"><div class="sf-tab">Hull / Structure</div><div class="sf-card">
        <div class="sf-row"><span class="sf-lbl">Hull</span><span class="sf-fld">${efNum(ship.id,'hullPoints')} / ${efNum(ship.id,'hullPointsMax')}</span></div>
        <div class="sf-row"><span class="sf-lbl">Structure</span><span class="sf-fld">${efNum(ship.id,'structurePoints')} / ${efNum(ship.id,'structurePointsMax')}</span></div>
      </div></div>
      <div class="sf-sec"><div class="sf-tab">Drives / Sensors</div><div class="sf-card">
        <div class="sf-row"><span class="sf-lbl">Thrust</span><span class="sf-fld">${efNum(ship.id,'thrust')}</span></div>
        <div class="sf-row"><span class="sf-lbl">Jump</span><span class="sf-fld">${efNum(ship.id,'jumpRating')}</span></div>
        <div class="sf-row"><span class="sf-lbl">Power</span><span class="sf-fld">${efNum(ship.id,'power')} / ${efNum(ship.id,'powerMax')}</span></div>
        <div class="sf-row"><span class="sf-lbl">Sensor DM</span><span class="sf-fld">${efNum(ship.id,'sensorDM')}</span></div>
      </div></div>
      <div class="sf-sec"><div class="sf-tab">Crew Skills (DM)</div><div class="sf-card">
        <div class="sf-skill-grid">
          <span>Pilot</span>${efSkill(ship.id,'pilot')}<span>Gunnery</span>${efSkill(ship.id,'gunnery')}
          <span>Engineer</span>${efSkill(ship.id,'engineer')}<span>Sensors</span>${efSkill(ship.id,'sensors')}
          <span>Tactics</span>${efSkill(ship.id,'tactics')}<span>Leadership</span>${efSkill(ship.id,'leadership')}
        </div>
      </div></div>
      <div class="sf-sec"><div class="sf-tab">Weapons</div><div class="sf-card">
        ${wRows || '<div style="font-size:11px;color:#7a7a7a">No weapons. Add one below or pick from the catalog.</div>'}
        <div class="cbt-weap-row" style="margin-top:6px">
          <button class="cbt-btn" onclick="addCombatWeapon('${ship.id}')">+ Add blank</button>
          ${catItems.length ? `<select class="cbt-sel" id="cbt-wpn-cat" style="flex:2"><option value="">— add from catalog —</option>${catOpts}</select><button class="cbt-btn" onclick="addCombatWeaponFromCatalog('${ship.id}',(document.getElementById('cbt-wpn-cat')||{}).value)">＋</button>` : ''}
        </div>
        <button class="cbt-btn" style="margin-top:6px;width:100%;text-align:left" onclick="toggleWeaponCatalog()">${weaponCatalogOpen?'▾':'▸'} Manage weapon catalog (${catItems.length})</button>
        ${weaponCatalogOpen ? renderWeaponCatalogManager() : ''}
      </div></div>
    </div>`;
}

// ── Hazard control block (referee) + read-only hazard chips (everyone) ───────
function renderHazardControls(){
  const haz = combatEncounter ? (combatEncounter.hazards || []) : [];
  const active = haz.map(h => `
    <div class="cbt-haz-row">
      <span class="cbt-haz-name${h.active ? ' on' : ''}">${escQH(h.name)}</span>
      <span class="cbt-haz-dm">${h.attackDM ? `atk ${h.attackDM}` : ''} ${h.sensorDM ? `sen ${h.sensorDM}` : ''} ${h.thrustPenalty ? `thr -${h.thrustPenalty}` : ''}</span>
      <button class="cbt-btn" onclick="toggleHazard('${h.id}');renderCombat()">${h.active ? 'Clear' : 'Set'}</button>
      <button class="cbt-btn danger" onclick="removeHazard('${h.id}');renderCombat()">✕</button>
    </div>`).join('');
  return `<div class="cbt-sec-tab">Environment</div>
    <div class="cbt-controls">
      ${active || '<div style="font-size:9px;color:var(--tx1)">No hazards.</div>'}
      <div class="cbt-ctl-row" style="border-top:.5px solid var(--bd0);padding-top:6px;margin-top:2px">
        ${Object.values(COMBAT_HAZARDS).map(p => `<button class="cbt-btn" onclick="addHazard('${p.kind}');renderCombat()" title="${escAttr(p.note)}">+ ${escQH(p.name)}</button>`).join('')}
      </div>
    </div>`;
}
function combatHazardChips(){
  const active = combatActiveHazards();
  if(!active.length) return '';
  return `<div class="cbt-ctl-row" style="margin-top:2px">${active.map(h => `<span class="cbt-chip" title="${escAttr(h.note)}">⚠ ${escQH(h.name)}</span>`).join('')}</div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// SPACE COMBAT — Phase 5: animation & feedback (abstract / diagrammatic)
// ───────────────────────────────────────────────────────────────────────────
// Effects are driven entirely off the battle log, so they fire identically for
// the referee (who appends entries by acting) and for players (who receive them
// on poll) — one code path, no duplication. A cursor tracks the last entry
// already animated so a freshly opened panel never replays the backlog. All FX
// live in a pointer-events:none overlay and self-remove, so they never block
// the combat loop; motion honours prefers-reduced-motion, and audio is a tiny
// WebAudio synth (no asset files) behind a per-device mute.
// ═══════════════════════════════════════════════════════════════════════════

let combatFXLastId = null;     // last log id animated (null = not yet primed)
let combatSfxEnabled = true;
try { combatSfxEnabled = localStorage.getItem('aurelia_combat_sfx') !== '0'; } catch(e){}
const combatReducedMotion = (typeof matchMedia === 'function') && matchMedia('(prefers-reduced-motion: reduce)').matches;

function toggleCombatSfx(){
  combatSfxEnabled = !combatSfxEnabled;
  try { localStorage.setItem('aurelia_combat_sfx', combatSfxEnabled ? '1' : '0'); } catch(e){}
  const b = document.getElementById('combat-sfx-btn');
  if(b){ b.classList.toggle('muted', !combatSfxEnabled); b.textContent = combatSfxEnabled ? '🔊' : '🔇'; }
}

// Walk the log for entries newer than the cursor and animate each.
function combatFXScan(){
  const log = (combatEncounter && combatEncounter.log) || [];
  if(combatFXLastId === null){ combatFXLastId = log.length ? log[log.length - 1].id : null; return; } // prime, no backlog
  const idx = log.findIndex(e => e.id === combatFXLastId);
  if(idx < 0){ combatFXLastId = log.length ? log[log.length - 1].id : null; return; } // log reset/trimmed — re-prime quietly
  const fresh = log.slice(idx + 1);
  if(!fresh.length) return;
  combatFXLastId = fresh[fresh.length - 1].id;
  // Only animate while the panel is actually visible.
  const wrap = document.getElementById('combat-wrap');
  if(!wrap || wrap.classList.contains('hidden') || combatCollapsed) return;
  fresh.forEach((e, i) => setTimeout(() => playCombatFX(e), i * 220)); // small stagger if several land at once
}

function fxLayer(){ return document.getElementById('combat-fx'); }
function fxCardCenter(shipId){
  const card = document.getElementById('cbtship-' + shipId), layer = fxLayer();
  if(!card || !layer) return null;
  const cr = card.getBoundingClientRect(), lr = layer.getBoundingClientRect();
  return { x: cr.left - lr.left + cr.width / 2, y: cr.top - lr.top + cr.height / 2, card };
}
function fxFlashCard(shipId, cls){
  const card = document.getElementById('cbtship-' + shipId);
  if(!card) return;
  card.classList.remove(cls); void card.offsetWidth; card.classList.add(cls);
  setTimeout(() => card.classList.remove(cls), 700);
}
function fxFloatText(shipId, text, cls){
  const c = fxCardCenter(shipId), layer = fxLayer();
  if(!c || !layer) return;
  const el = document.createElement('div');
  el.className = 'fx-float ' + (cls || '');
  el.textContent = text;
  el.style.left = c.x + 'px'; el.style.top = (c.y - 6) + 'px';
  el.style.transform = 'translateX(-50%)';
  layer.appendChild(el);
  void el.offsetWidth; el.classList.add('go');
  setTimeout(() => el.remove(), 1100);
}
function fxBeam(fromId, toId, type, miss){
  const a = fxCardCenter(fromId), b = fxCardCenter(toId), layer = fxLayer();
  if(!a || !b || !layer) return;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.max(6, Math.hypot(dx, dy)), ang = Math.atan2(dy, dx) * 180 / Math.PI;
  const el = document.createElement('div');
  el.className = `fx-beam t-${type || 'beam-laser'} ${miss ? 'miss' : 'fire'}`;
  el.style.left = a.x + 'px'; el.style.top = a.y + 'px';
  el.style.width = len + 'px';
  el.style.transform = `rotate(${ang}deg)`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 600);
}
function fxProjectile(fromId, toId, onArrive){
  const a = fxCardCenter(fromId), b = fxCardCenter(toId), layer = fxLayer();
  if(!a || !b || !layer){ if(onArrive) onArrive(); return; }
  if(combatReducedMotion){ // no travel — just flash arrival
    if(onArrive) setTimeout(onArrive, 120); return;
  }
  const el = document.createElement('div');
  el.className = 'fx-proj fire';
  el.style.left = a.x + 'px'; el.style.top = a.y + 'px';
  el.style.transition = 'left .56s linear, top .56s linear';
  layer.appendChild(el);
  void el.offsetWidth;
  el.style.left = b.x + 'px'; el.style.top = b.y + 'px';
  setTimeout(() => { el.remove(); if(onArrive) onArrive(); }, 580);
}

// Map a battle-log entry → an abstract effect + sound.
function playCombatFX(e){
  if(!e) return;
  const m = e.meta || {};
  if(e.kind === 'attack'){
    const type = (m.breakdown && m.breakdown.weapon && m.breakdown.weapon.type) || 'beam-laser';
    const isMissile = type === 'missile';
    const impact = () => {
      if(m.hit){
        fxFlashCard(m.targetId, (m.damage && m.damage.crits && m.damage.crits.filter(Boolean).length) ? 'fx-crit' : 'fx-hit');
        const dmg = m.damage && typeof m.damage.dmg === 'number' ? m.damage.dmg : null;
        if(dmg != null) fxFloatText(m.targetId, '−' + dmg, dmg === 0 ? 'miss' : '');
        combatSfx('impact');
      } else {
        fxFloatText(m.targetId, 'miss', 'miss');
      }
    };
    if(isMissile && m.hit && (m.travel === 0)){
      combatSfx('missile');
      fxProjectile(m.attackerId, m.targetId, impact);
    } else {
      fxBeam(m.attackerId, m.targetId, type, !m.hit);
      combatSfx(type === 'plasma' ? 'plasma' : 'laser');
      setTimeout(impact, combatReducedMotion ? 60 : 240);
    }
  } else if(e.kind === 'critical'){
    if(m.targetId){ fxFlashCard(m.targetId, 'fx-crit'); fxFloatText(m.targetId, '✦ ' + (m.location || 'crit'), 'crit'); combatSfx('crit'); }
  } else if(e.kind === 'action'){
    if(m.defenderId){ fxFlashCard(m.defenderId, 'fx-pd'); combatSfx('pd'); }          // point defence
    else if(m.operatorId && m.ok){ fxFlashCard(m.operatorId, 'fx-lock'); combatSfx('lock'); } // sensor lock gained
  }
}

// ── Tiny WebAudio synth — short, quiet cues; no external assets ──────────────
let _combatAudioCtx = null;
function combatSfx(kind){
  if(!combatSfxEnabled) return;
  try {
    _combatAudioCtx = _combatAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _combatAudioCtx; if(ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const beep = (type, f0, f1, dur, vol) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, now);
      if(f1 != null) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(vol, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(g); g.connect(ctx.destination); o.start(now); o.stop(now + dur + 0.02);
    };
    const noise = (dur, vol) => {
      const n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      for(let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf; g.gain.value = vol; src.connect(g); g.connect(ctx.destination); src.start(now);
    };
    if(kind === 'laser')        beep('square', 880, 220, 0.14, 0.05);
    else if(kind === 'plasma')  beep('sawtooth', 320, 90, 0.22, 0.06);
    else if(kind === 'missile') beep('sine', 200, 520, 0.3, 0.04);
    else if(kind === 'impact'){ noise(0.18, 0.07); beep('triangle', 160, 60, 0.18, 0.05); }
    else if(kind === 'crit'){   noise(0.28, 0.09); beep('sawtooth', 240, 50, 0.3, 0.07); }
    else if(kind === 'pd')      beep('square', 1200, 1200, 0.05, 0.03);
    else if(kind === 'lock')    beep('sine', 660, 990, 0.12, 0.035);
  } catch(err){ /* audio unavailable — silent, never fatal */ }
}


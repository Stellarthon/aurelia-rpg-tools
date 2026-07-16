// ═══════════════════════════════════════════════════════════════════════════
// DESIGN MODE — referee content authoring
// ═══════════════════════════════════════════════════════════════════════════
// Scope (grew well past the original "text fields only" pass): text overrides
// (read-aloud / referee context / referee notes / custom boxes) PLUS structured
// add/edit/remove of skill checks, timed events, NPC stat blocks and their
// detail rows, whole bodies (planets/moons/belts), locations, star systems,
// regions, jump lanes, territory paint, the ship-weapon catalogue, the item
// catalogue, authored stations + deck plans, splash screens and the whole
// Campaign Studio config layer. Nearly everything syncs to Supabase; see the
// store table in the section comments below. Referee-only fields are redacted
// out of the player-facing copies (js/55 stripOverlayForPlayers; see
// docs/design-mode-redaction.md).
//
// Mechanism: original campaign content stays exactly where it already is,
// hardcoded in MAIN / BASE_LOCATIONS. This system adds a lookup layer in
// front of it — contentOverrides holds any edited values, keyed by a
// stable content key like "elevator-read" or "loc-capitol-desc". Anywhere
// the app displays one of these fields, it checks contentOverrides first
// and falls back to the original hardcoded value if no override exists.
// Nothing about the original data is ever deleted or mutated — Design
// Mode edits are purely additive, which is what makes "Revert to
// Original" always possible regardless of how much editing happened.
//
// Safety net: every save pushes the PREVIOUS value (override or original,
// whichever was showing) onto a history list for that key before
// overwriting it, so "History" can step back through several edits, not
// just one. History is capped at 10 entries per field to keep storage
// reasonable.

let contentOverrides = {};   // {key: currentText}
let contentHistory = {};     // {key: [{text, t}, ...]} most recent first
let designModeOn = false;
let designEditCurrentKey = null;
let designEditOriginalText = '';

// ── Stage 3: add / remove whole checks, events, degree tiers, NPC rows ──
// Two more stores layered on top of the override system above:
//
// contentAdditions: {listKey: [item, item, ...]} — brand-new items the
// referee has added, appended after the hardcoded ones at render time.
// Keyed by a list-level key (e.g. "elevator-checks"), NOT a per-item key,
// since these items don't exist in the original data and have no index
// to anchor to.
//
// contentDeletions: {itemKey: true} — a tombstone marking a specific
// item (hardcoded OR added) as removed. Render loops check this and skip
// the item entirely. Using tombstones rather than actually splicing the
// hardcoded arrays keeps every existing per-item key (used throughout
// stage 2) stable regardless of what's been deleted elsewhere — deleting
// check #1 never shifts what key check #2 answers to.
let contentAdditions = {};
let contentDeletions = {};

async function loadContentOverrides(){
  try {
    const res = await getOverlayStore('content-overrides');
    contentOverrides = res.value != null ? JSON.parse(res.value) : {};
  } catch(e){ contentOverrides = {}; }
  try {
    const res2 = await getOverlayStore('content-history');
    contentHistory = res2.value != null ? JSON.parse(res2.value) : {};
  } catch(e){ contentHistory = {}; }
  try {
    const res3 = await getOverlayStore('content-additions');
    contentAdditions = res3.value != null ? JSON.parse(res3.value) : {};
  } catch(e){ contentAdditions = {}; }
  try {
    const res4 = await getOverlayStore('content-deletions');
    contentDeletions = res4.value != null ? JSON.parse(res4.value) : {};
  } catch(e){ contentDeletions = {}; }
  // Baselines for the field-level merge-on-save (see mergedSaveStore).
  snapshotBaseline('content-overrides', contentOverrides);
  snapshotBaseline('content-history', contentHistory);
  snapshotBaseline('content-additions', contentAdditions);
  snapshotBaseline('content-deletions', contentDeletions);
}

async function saveContentOverrides(){
  try { contentOverrides = await mergedSaveStore('content-overrides', contentOverrides); }
  catch(e){ console.error('Content override save failed', e); }
}

async function saveContentHistory(){
  try { contentHistory = await mergedSaveStore('content-history', contentHistory); }
  catch(e){ console.error('Content history save failed', e); }
}

async function saveContentAdditions(){
  try { contentAdditions = await mergedSaveStore('content-additions', contentAdditions); }
  catch(e){ console.error('Content additions save failed', e); }
}

async function saveContentDeletions(){
  try { contentDeletions = await mergedSaveStore('content-deletions', contentDeletions); }
  catch(e){ console.error('Content deletions save failed', e); }
}

// ═══════════════════════════════════════════════════════════════════════════
// BODY ADD / REMOVE / EDIT STORES  (system-scoped, Supabase-synced)
// ═══════════════════════════════════════════════════════════════════════════
// Three stores parallel to the content-* stores above, but operating on whole
// bodies (planets, moons, asteroid belts) rather than text/sub-items. Each is
// namespaced by system id so other star systems can be populated later without
// migration:
//   bodyAdditions:        {sysId: [bodyObj, ...]}      referee-created bodies
//   bodyDeletions:        {sysId: {bodyId: {body, t}}} tombstones on base bodies
//   bodyPropertyOverrides:{sysId: {bodyId: {field:val}}} metadata edits to base bodies
let bodyAdditions = {};
let bodyDeletions = {};
let bodyPropertyOverrides = {};

async function loadBodyStores(){
  try { const r = await getOverlayStore('body-additions'); bodyAdditions = r.value != null ? JSON.parse(r.value) : {}; }
  catch(e){ bodyAdditions = {}; }
  try { const r = await getOverlayStore('body-deletions'); bodyDeletions = r.value != null ? JSON.parse(r.value) : {}; }
  catch(e){ bodyDeletions = {}; }
  try { const r = await getOverlayStore('body-prop-overrides'); bodyPropertyOverrides = r.value != null ? JSON.parse(r.value) : {}; }
  catch(e){ bodyPropertyOverrides = {}; }
  snapshotBaseline('body-additions', bodyAdditions);
  snapshotBaseline('body-deletions', bodyDeletions);
  snapshotBaseline('body-prop-overrides', bodyPropertyOverrides);
}
async function saveBodyAdditions(){
  try { bodyAdditions = await mergedSaveStore('body-additions', bodyAdditions); }
  catch(e){ console.error('Body additions save failed', e); }
}
async function saveBodyDeletions(){
  try { bodyDeletions = await mergedSaveStore('body-deletions', bodyDeletions); }
  catch(e){ console.error('Body deletions save failed', e); }
}
async function saveBodyPropertyOverrides(){
  try { bodyPropertyOverrides = await mergedSaveStore('body-prop-overrides', bodyPropertyOverrides); }
  catch(e){ console.error('Body property overrides save failed', e); }
}

// The computed body set for a system: base bodies (minus tombstoned ones, with
// any metadata overrides applied) followed by referee-added bodies. EVERY
// render path reads through this rather than touching base data directly, so
// add / remove / edit all apply retroactively to the original bodies too.
function effectiveBodies(sysId){
  sysId = sysId || currentSystemId;
  const dels = bodyDeletions[sysId] || {};
  const props = bodyPropertyOverrides[sysId] || {};
  const out = [];
  baseBodiesFor(sysId).forEach(b => {
    if(dels[b.id]) return;
    const ov = props[b.id];
    out.push(ov ? Object.assign({}, b, ov) : b);
  });
  (bodyAdditions[sysId] || []).forEach(b => { if(!dels[b.id]) out.push(b); });
  return out;
}
// Convenience getter used throughout the rendering code in place of the old
// hardcoded BODIES array.
function getBodies(){ return effectiveBodies(currentSystemId); }

// ═══════════════════════════════════════════════════════════════════════════
// LOCATION STORES  (system-scoped, Supabase-synced) — Phase 2 + Phase 3
// ═══════════════════════════════════════════════════════════════════════════
// Locations are places on/around a body (cities, stations, bases, mines,
// research posts). Mirrors the body stores exactly. Namespaced by system id and
// keyed by body id so any world in any system can own locations.
//   BASE_LOCATIONS:            {sysId: {bodyId: [locObj, ...]}} hardcoded
//   locationAdditions:         {sysId: {bodyId: [locObj, ...]}} referee-created
//   locationDeletions:         {sysId: {locId: {loc, t, bodyId, wasAddition}}} tombstones
//   locationPropertyOverrides: {sysId: {locId: {field:val}}}     edits to base locations
// This is the same three-store shape the body engine uses (effectiveBodies),
// so a base location can be edited (override) and removed (tombstone, restorable)
// without ever mutating BASE_LOCATIONS — see Phase 3.2 for Aurelia's data.
let locationAdditions = {};
let locationDeletions = {};
let locationPropertyOverrides = {};

function baseLocationsFor(sysId, bodyId){
  // Route through the active Campaign Pack; the built-in pack's content.locations
  // IS the BASE_LOCATIONS constant (same ref) so behaviour is identical, while an
  // authored campaign supplies its own.
  const c = (typeof activePackContent === 'function') ? activePackContent() : null;
  const src = (c && c.locations) ? c.locations : (typeof BASE_LOCATIONS !== 'undefined' ? BASE_LOCATIONS : {});
  return ((src[sysId] || {})[bodyId]) || [];
}

async function loadLocationStores(){
  try { const r = await getOverlayStore('location-additions'); locationAdditions = r.value != null ? JSON.parse(r.value) : {}; }
  catch(e){ locationAdditions = {}; }
  try { const r = await getOverlayStore('location-deletions'); locationDeletions = r.value != null ? JSON.parse(r.value) : {}; }
  catch(e){ locationDeletions = {}; }
  try { const r = await getOverlayStore('location-prop-overrides'); locationPropertyOverrides = r.value != null ? JSON.parse(r.value) : {}; }
  catch(e){ locationPropertyOverrides = {}; }
  snapshotBaseline('location-additions', locationAdditions);
  snapshotBaseline('location-deletions', locationDeletions);
  snapshotBaseline('location-prop-overrides', locationPropertyOverrides);
}
async function saveLocationAdditions(){
  try { locationAdditions = await mergedSaveStore('location-additions', locationAdditions); }
  catch(e){ console.error('Location additions save failed', e); }
}
async function saveLocationDeletions(){
  try { locationDeletions = await mergedSaveStore('location-deletions', locationDeletions); }
  catch(e){ console.error('Location deletions save failed', e); }
}
async function saveLocationPropertyOverrides(){
  try { locationPropertyOverrides = await mergedSaveStore('location-prop-overrides', locationPropertyOverrides); }
  catch(e){ console.error('Location property overrides save failed', e); }
}

// Computed location set for a body: base locations (minus tombstoned ones, with
// any property overrides applied) followed by referee-added locations (minus
// tombstoned). Exactly mirrors effectiveBodies so add / edit / remove apply
// retroactively to the original Aurelia locations too.
function effectiveLocations(sysId, bodyId){
  sysId = sysId || currentSystemId;
  const dels = locationDeletions[sysId] || {};
  const props = locationPropertyOverrides[sysId] || {};
  const out = [];
  baseLocationsFor(sysId, bodyId).forEach(l => {
    if(dels[l.id]) return;
    const ov = props[l.id];
    out.push(ov ? Object.assign({}, l, ov) : l);
  });
  const adds = (locationAdditions[sysId] || {})[bodyId] || [];
  adds.forEach(l => { if(!dels[l.id]) out.push(l); });
  return out;
}
function isAddedLocation(sysId, locId){
  const byBody = locationAdditions[sysId] || {};
  return Object.values(byBody).some(arr => arr.some(l => l.id === locId));
}
// Find a location (effective, override-applied) + its bodyId anywhere in the
// current system, searching both base and referee-added locations.
function findLocation(locId){
  const sysId = currentSystemId;
  const bodyIds = new Set([
    ...Object.keys(BASE_LOCATIONS[sysId] || {}),
    ...Object.keys(locationAdditions[sysId] || {})
  ]);
  for(const bId of bodyIds){
    const hit = effectiveLocations(sysId, bId).find(l => l.id === locId);
    if(hit) return { loc: hit, bodyId: bId };
  }
  return null;
}

// Combines hardcoded items + additions, with deleted ones filtered out,
// and a per-item key attached to each so the caller can wire up edit/
// delete pencils consistently regardless of whether the item is original
// or referee-added. `listKey` identifies the list (e.g. "elevator-checks"),
// `keyPrefix` is the per-item key prefix already used by stage 2
// (e.g. "elevator-check-").
function mergeListWithAdditions(original, listKey, keyPrefix){
  const merged = [];
  (original||[]).forEach((item, i) => {
    const key = keyPrefix + i;
    if(contentDeletions[key]) return;
    merged.push({ item, key, isAddition: false });
  });
  const additions = contentAdditions[listKey] || [];
  additions.forEach((item, i) => {
    const key = keyPrefix + 'add' + i;
    if(contentDeletions[key]) return;
    merged.push({ item, key, isAddition: true, additionIndex: i });
  });
  return merged;
}

async function deleteContentItem(key, item){
  if(!confirm('Remove this? You can restore it later from "Show Removed Items" if you change your mind.')) return;
  contentDeletions[key] = { item, t: Date.now() };
  await saveContentDeletions();
  showToast('Item removed', 'info');
  if(currentView === 'station' && cur) renderDetail();
  if(currentView === 'system' && selectedBody) selectBody(selectedBody);
  if(currentView === 'body' && selectedBody){ if(selectedBodyLoc) selectBodyLocation(selectedBodyLoc); else buildBodyView(selectedBody); }
}

// Adds a brand-new blank item to the given list, saves it, re-renders so
// it appears in the list, then immediately opens its editor so the
// referee fills it in right away rather than leaving an empty entry
// sitting there. Each push gets its own "...addN" key via
// mergeListWithAdditions, computed fresh after the render.
async function addNewCheck(listKey){
  if(!contentAdditions[listKey]) contentAdditions[listKey] = [];
  const blank = { skill: '', degrees: [{l:'Success', c:'dp', t:''}] };
  contentAdditions[listKey].push(blank);
  await saveContentAdditions();
  if(currentView === 'station' && cur) renderDetail();
  if(currentView === 'body' && selectedBody) buildBodyView(selectedBody);
  const newIdx = contentAdditions[listKey].length - 1;
  const newKey = listKey.replace(/-checks$/, '-check-') + 'add' + newIdx;
  openDesignEditCheck(newKey, blank);
}

async function addNewEvent(listKey){
  if(!contentAdditions[listKey]) contentAdditions[listKey] = [];
  const blank = { t: '', e: '' };
  contentAdditions[listKey].push(blank);
  await saveContentAdditions();
  if(currentView === 'station' && cur) renderDetail();
  if(currentView === 'body' && selectedBody) buildBodyView(selectedBody);
  const newIdx = contentAdditions[listKey].length - 1;
  const newKey = listKey.replace(/-events$/, '-event-') + 'add' + newIdx;
  openDesignEditEvent(newKey, blank);
}

async function addNewNpcRow(listKey){
  if(!contentAdditions[listKey]) contentAdditions[listKey] = [];
  const blank = ['', ''];
  contentAdditions[listKey].push(blank);
  await saveContentAdditions();
  if(currentView === 'station' && cur) renderDetail();
  if(currentView === 'system' && selectedBody) selectBody(selectedBody);
  if(currentView === 'body' && selectedBody) buildBodyView(selectedBody);
  const newIdx = contentAdditions[listKey].length - 1;
  const newKey = listKey.replace(/-rows$/, '-row-') + 'add' + newIdx;
  openDesignEditNpcRow(newKey, blank);
}

async function restoreDeletedItem(key){
  delete contentDeletions[key];
  await saveContentDeletions();
  closeRemovedItemsPanel();
  if(currentView === 'station' && cur) renderDetail();
  if(currentView === 'system' && selectedBody) selectBody(selectedBody);
  if(currentView === 'body' && selectedBody){ if(selectedBodyLoc) selectBodyLocation(selectedBodyLoc); else buildBodyView(selectedBody); }
}

function openRemovedItemsPanel(){
  const keys = Object.keys(contentDeletions);
  // Removed bodies across all systems (each has its own restore path)
  const bodyEntries = [];
  Object.keys(bodyDeletions || {}).forEach(sysId => {
    Object.keys(bodyDeletions[sysId] || {}).forEach(bid => {
      bodyEntries.push({ sysId, bid, entry: bodyDeletions[sysId][bid] });
    });
  });
  const removedBoxes = getRemovedBoxTypes();
  // Removed locations across all systems
  const locEntries = [];
  Object.keys(locationDeletions || {}).forEach(sysId => {
    Object.keys(locationDeletions[sysId] || {}).forEach(lid => {
      locEntries.push({ sysId, lid, entry: locationDeletions[sysId][lid] });
    });
  });
  // Removed star systems (galaxy-map level)
  const sysEntries = Object.keys(systemDeletions || {}).map(id => ({ id, entry: systemDeletions[id] }));
  // Removed regions / sectors
  const facEntries = Object.keys(factionDeletions || {}).map(id => ({ id, entry: factionDeletions[id] }));
  // Removed catalog weapons
  const wpnEntries = (typeof weaponDeletions !== 'undefined') ? Object.keys(weaponDeletions).map(id => ({ id, entry: weaponDeletions[id] })) : [];
  let html = '';
  if(!keys.length && !bodyEntries.length && !removedBoxes.length && !locEntries.length && !sysEntries.length && !facEntries.length && !wpnEntries.length){
    html = '<div class="init-empty">Nothing has been removed yet.</div>';
  } else {
    // Removed box types first, then bodies, then content items
    const boxHtml = removedBoxes.map(b => `
      <div class="design-history-item" onclick="restoreBoxType('${b.key}')">
        <div class="design-history-label">${b._removedAt ? new Date(b._removedAt).toLocaleString()+' — ' : ''}tap to restore box type</div>
        <div class="design-history-snippet">🗂 ${b.label||b.key}${b.refOnly?' (referee-only)':''}</div>
      </div>`).join('');
    // Removed bodies (more significant), then content items
    const bodyHtml = bodyEntries.map(({sysId, bid, entry}) => {
      const b = entry.body || {};
      const snippet = `🪐 ${b.name || bid}${b.uwpString && b.uwpString!=='—' ? ' · '+b.uwpString : ''}`;
      return `<div class="design-history-item" onclick="restoreDeletedBody('${sysId.replace(/'/g,"\\'")}','${bid.replace(/'/g,"\\'")}')">
        <div class="design-history-label">${new Date(entry.t).toLocaleString()} — tap to restore body</div>
        <div class="design-history-snippet">${snippet.slice(0,140)}</div>
      </div>`;
    }).join('');
    const locHtml = locEntries.map(({sysId, lid, entry}) => {
      const l = entry.loc || {};
      const snippet = `📍 ${l.name || lid}${l.type ? ' · '+l.type : ''}`;
      return `<div class="design-history-item" onclick="restoreDeletedLocation('${sysId.replace(/'/g,"\\'")}','${lid.replace(/'/g,"\\'")}')">
        <div class="design-history-label">${new Date(entry.t).toLocaleString()} — tap to restore location</div>
        <div class="design-history-snippet">${snippet.slice(0,140)}</div>
      </div>`;
    }).join('');
    const sysHtml = sysEntries.map(({id, entry}) => {
      const n = entry.node || {};
      const snippet = `✦ ${n.label || n.name || id}`;
      return `<div class="design-history-item" onclick="restoreDeletedSystem('${id.replace(/'/g,"\\'")}')">
        <div class="design-history-label">${new Date(entry.t).toLocaleString()} — tap to restore system</div>
        <div class="design-history-snippet">${snippet.slice(0,140)}</div>
      </div>`;
    }).join('');
    const facHtml = facEntries.map(({id, entry}) => {
      const f = entry.fac || {};
      const snippet = `▰ ${f.name || id} (region)`;
      return `<div class="design-history-item" onclick="restoreDeletedFaction('${id.replace(/'/g,"\\'")}')">
        <div class="design-history-label">${new Date(entry.t).toLocaleString()} — tap to restore region</div>
        <div class="design-history-snippet">${snippet.slice(0,140)}</div>
      </div>`;
    }).join('');
    const wpnHtml = wpnEntries.map(({id, entry}) => {
      const w = entry.w || {};
      const snippet = `⚔ ${w.name || id}${w.damage ? ' · '+w.damage : ''} (weapon)`;
      return `<div class="design-history-item" onclick="restoreDeletedWeapon('${id.replace(/'/g,"\\'")}')">
        <div class="design-history-label">${new Date(entry.t).toLocaleString()} — tap to restore weapon</div>
        <div class="design-history-snippet">${snippet.slice(0,140)}</div>
      </div>`;
    }).join('');
    const itemHtml = keys.map(key => {
      const entry = contentDeletions[key];
      const item = entry.item;
      let snippet;
      if(typeof item === 'string') snippet = item;
      else if(Array.isArray(item)) snippet = item[0] + ': ' + item[1];
      else if(item && item.skill) snippet = '🎲 ' + item.skill;
      else if(item && item.t !== undefined && item.e !== undefined) snippet = item.t + ' — ' + item.e;
      else snippet = JSON.stringify(item);
      return `<div class="design-history-item" onclick="restoreDeletedItem('${key.replace(/'/g,"\\\\'")}')">
        <div class="design-history-label">${new Date(entry.t).toLocaleString()} — tap to restore</div>
        <div class="design-history-snippet">${(snippet||'').slice(0,140)}${(snippet||'').length>140?'…':''}</div>
      </div>`;
    }).join('');
    html = boxHtml + facHtml + wpnHtml + sysHtml + bodyHtml + locHtml + itemHtml;
  }
  document.getElementById('design-edit-title').textContent = 'REMOVED ITEMS';
  document.getElementById('design-edit-body').innerHTML = html;
  document.getElementById('design-edit-footer').classList.add('hidden');
  designEditCurrentKey = null;
  document.getElementById('design-edit-panel').classList.remove('hidden');
}

function closeRemovedItemsPanel(){
  closeDesignEdit();
}

// ═══════════════════════════════════════════════════════════════════════════
// MY DESIGN EDITS — audit index + per-item revert + revert-all
// ═══════════════════════════════════════════════════════════════════════════
// The Removed Items panel above answers "what did I delete?"; this one answers
// the other half — "what have I ADDED or CHANGED?" — which otherwise has no
// listing at all: a referee could only find edits by walking every view hunting
// for the purple has-override pencils. Every design store is enumerated, each
// edited BASE object gets a per-item "revert to original", and one "revert ALL
// content edits" returns the shipped campaign to pristine WITHOUT touching live
// session state (reveals, clock, initiative, whispers) or separately-authored
// assets (item catalogue, economy tuning, splash screens, Campaign Studio).
// Cross-file stores (system/faction/weapon/lane/paint/block) live in js/10 and
// js/80; every reference here is typeof-guarded so a missing symbol no-ops.

function _dCount(o){ return o ? Object.keys(o).length : 0; }
function _dSumArrays(m){ let n = 0; if(m) Object.keys(m).forEach(k => { if(Array.isArray(m[k])) n += m[k].length; }); return n; }
function _dSumInner(m){ let n = 0; if(m) Object.keys(m).forEach(s => n += _dCount(m[s])); return n; }
function _dSumNested(m){ let n = 0; if(m) Object.keys(m).forEach(s => { const inner = m[s]||{}; Object.keys(inner).forEach(b => { if(Array.isArray(inner[b])) n += inner[b].length; }); }); return n; }
// Cross-file design stores in js/10 / js/80 are top-level `let` globals, which
// are NOT window properties — so read them through a thunk that resolves the
// real lexical binding, swallowing any ReferenceError if a module is absent.
function _dg(getter){ try { const v = getter(); return v === undefined ? undefined : v; } catch(e){ return undefined; } }

// Total number of design edits layered over the built-in campaign — the exact
// set revert-all clears. Everything cross-file is read defensively.
function countAllDesignEdits(){
  let n = 0;
  n += _dCount(contentOverrides) + _dSumArrays(contentAdditions) + _dCount(contentDeletions);
  n += _dSumArrays(bodyAdditions) + _dSumInner(bodyDeletions) + _dSumInner(bodyPropertyOverrides);
  n += _dSumNested(locationAdditions) + _dSumInner(locationDeletions) + _dSumInner(locationPropertyOverrides);
  const sysAdd = _dg(()=>systemAdditions); if(Array.isArray(sysAdd)) n += sysAdd.length;
  n += _dCount(_dg(()=>systemDeletions)) + _dCount(_dg(()=>systemPropertyOverrides));
  n += _dCount(_dg(()=>factionAdditions)) + _dCount(_dg(()=>factionDeletions)) + _dCount(_dg(()=>factionPropertyOverrides));
  const wpnAdd = _dg(()=>weaponAdditions); if(Array.isArray(wpnAdd)) n += wpnAdd.length;
  n += _dCount(_dg(()=>weaponDeletions)) + _dCount(_dg(()=>weaponPropertyOverrides));
  const la = _dg(()=>gxLaneAdditions), ld = _dg(()=>gxLaneDeletions);
  if(Array.isArray(la)) n += la.length; if(Array.isArray(ld)) n += ld.length;
  const rb = _dg(()=>routeBlocks); if(rb){ n += _dCount(rb.blocks); if(rb.enabled === false) n += 1; }
  n += _dCount(_dg(()=>hexPaint));
  const tga = _dg(()=>tradeGoodAdditions);
  n += _dCount(_dg(()=>tradeGoodOverrides)) + (Array.isArray(tga) ? tga.length : 0) + _dCount(_dg(()=>tradeGoodDeletions));
  n += _dCount(_dg(()=>generatorOverrides));
  n += _dCount(_dg(()=>rulesOverrides));
  n += _dCount(_dg(()=>contractOverrides));
  n += _dCount(_dg(()=>themeOverrides)) + _dCount(_dg(()=>panelFlags));
  n += _dCount(_dg(()=>npcPortraits)) + _dCount(_dg(()=>sceneImages));
  return n;
}

// One list row: a label, a snippet, and a revert button (revertCall is a string
// of JS to run — the specific revert helper for this store).
function _dEditRow(label, snippet, revertCall){
  const s = (snippet || '').toString();
  return `<div class="design-history-item" style="display:flex;align-items:center;gap:10px;justify-content:space-between">
    <div style="min-width:0;flex:1">
      <div class="design-history-label">${escHtml(label)}</div>
      <div class="design-history-snippet">${escHtml(s.slice(0,140))}${s.length>140?'…':''}</div>
    </div>
    <button class="design-tier-remove" style="flex:none" onclick="${revertCall}">↺ revert</button>
  </div>`;
}
function _dSection(title, count, rowsHtml){
  return `<div class="settings-section-lbl" style="margin-top:12px">${escHtml(title)} <span style="color:var(--tx1);font-weight:400">· ${count}</span></div>${rowsHtml}`;
}
function _dq(s){ return String(s).replace(/'/g, "\\'"); }

function openDesignEditsIndex(){
  if(!isReferee() || !designModeOn) return;
  const parts = [];

  // ── Edited base content: read-aloud / desc / notes / checks / events / NPC rows
  const ovKeys = Object.keys(contentOverrides || {});
  if(ovKeys.length){
    const rows = ovKeys.map(key =>
      _dEditRow(key.replace(/^loc-/, '').replace(/-/g, ' › '), designEditSnippet(contentOverrides[key]),
        `revertContentOverride('${_dq(key)}')`)).join('');
    parts.push(_dSection('✏ Edited text & content', ovKeys.length, rows));
  }

  // ── Edited base bodies (planets / moons / belts) ──
  const bpo = bodyPropertyOverrides || {};
  const bodyRows = [];
  Object.keys(bpo).forEach(sysId => Object.keys(bpo[sysId] || {}).forEach(bid => {
    const fields = Object.keys(bpo[sysId][bid] || {}).join(', ');
    bodyRows.push(_dEditRow('🪐 ' + designBodyName(sysId, bid), 'edited: ' + fields,
      `revertBodyOverride('${_dq(sysId)}','${_dq(bid)}')`));
  }));
  if(bodyRows.length) parts.push(_dSection('🪐 Edited worlds', bodyRows.length, bodyRows.join('')));

  // ── Edited base locations ──
  const lpo = locationPropertyOverrides || {};
  const locRows = [];
  Object.keys(lpo).forEach(sysId => Object.keys(lpo[sysId] || {}).forEach(lid => {
    const fields = Object.keys(lpo[sysId][lid] || {}).join(', ');
    locRows.push(_dEditRow('📍 ' + designLocationName(sysId, lid), 'edited: ' + fields,
      `revertLocationOverride('${_dq(sysId)}','${_dq(lid)}')`));
  }));
  if(locRows.length) parts.push(_dSection('📍 Edited locations', locRows.length, locRows.join('')));

  // ── Edited base star systems (galaxy) ──
  const spo = _dg(()=>systemPropertyOverrides) || {};
  const sysRows = Object.keys(spo).map(id =>
    _dEditRow('✦ ' + id, 'edited: ' + Object.keys(spo[id] || {}).join(', '), `revertSystemOverride('${_dq(id)}')`));
  if(sysRows.length) parts.push(_dSection('✦ Edited star systems', sysRows.length, sysRows.join('')));

  // ── Edited base regions / factions ──
  const fpo = _dg(()=>factionPropertyOverrides) || {};
  const facRows = Object.keys(fpo).map(id =>
    _dEditRow('▰ ' + id, 'edited: ' + Object.keys(fpo[id] || {}).join(', '), `revertFactionOverride('${_dq(id)}')`));
  if(facRows.length) parts.push(_dSection('▰ Edited regions', facRows.length, facRows.join('')));

  // ── Edited base weapons ──
  const wpo = _dg(()=>weaponPropertyOverrides) || {};
  const wpnRows = Object.keys(wpo).map(id =>
    _dEditRow('⚔ ' + id, 'edited: ' + Object.keys(wpo[id] || {}).join(', '), `revertWeaponOverride('${_dq(id)}')`));
  if(wpnRows.length) parts.push(_dSection('⚔ Edited weapons', wpnRows.length, wpnRows.join('')));

  // ── Additions & map layers (informational; deletions live in Removed Items) ──
  const summary = [];
  const addBodies = _dSumArrays(bodyAdditions), addLocs = _dSumNested(locationAdditions),
        addChecks = _dSumArrays(contentAdditions),
        addSys = Array.isArray(_dg(()=>systemAdditions)) ? _dg(()=>systemAdditions).length : 0,
        addFac = _dCount(_dg(()=>factionAdditions)), addWpn = Array.isArray(_dg(()=>weaponAdditions)) ? _dg(()=>weaponAdditions).length : 0;
  const laneN = (Array.isArray(_dg(()=>gxLaneAdditions)) ? _dg(()=>gxLaneAdditions).length : 0) + (Array.isArray(_dg(()=>gxLaneDeletions)) ? _dg(()=>gxLaneDeletions).length : 0);
  const rb = _dg(()=>routeBlocks); const blockN = rb ? _dCount(rb.blocks) : 0;
  const paintN = _dCount(_dg(()=>hexPaint));
  const line = (n, label) => n ? `<div class="design-history-snippet" style="padding:2px 0">＋ ${n} ${label}</div>` : '';
  const addHtml = line(addSys, 'new star system(s)') + line(addFac, 'new region(s)') + line(addBodies, 'new world(s)') +
    line(addLocs, 'new location(s)') + line(addChecks, 'new check/event/NPC row(s)') + line(addWpn, 'new weapon(s)') +
    line(laneN, 'jump-lane change(s)') + line(blockN, 'closed lane(s)') + line(paintN, 'painted hex(es)');
  if(addHtml){
    summary.push(`<div class="settings-section-lbl" style="margin-top:12px">＋ Added &amp; map layers</div>${addHtml}
      <div class="se-note" style="margin-top:4px">Remove these from their own view, or restore deletions from 🗑 Show Removed Items.</div>`);
  }

  let html;
  if(!parts.length && !summary.length){
    html = '<div class="init-empty">No design edits yet. Turn on a pencil ✏ or add content, and it will be listed here.</div>';
  } else {
    const total = countAllDesignEdits();
    html = parts.join('') + summary.join('') +
      `<div class="archon-divider" style="margin:14px 0 10px"></div>
       <button class="se-reset" style="width:100%;color:#d45050;border-color:#d45050" onclick="revertAllContentEdits()">⟲ Revert ALL ${total} content edit${total===1?'':'s'} to original</button>
       <div class="se-note" style="margin-top:6px">Clears every edit to the shipped campaign. Does not touch reveals, the clock, initiative, whispers, your item catalogue, economy tuning, splash screens, or Campaign Studio settings.</div>`;
  }
  document.getElementById('design-edit-title').textContent = 'MY DESIGN EDITS';
  document.getElementById('design-edit-body').innerHTML = html;
  document.getElementById('design-edit-footer').classList.add('hidden');
  designEditCurrentKey = null;
  document.getElementById('design-edit-panel').classList.remove('hidden');
}

// Snippet for a content-override value (string | check obj | event obj | nperow tuple).
function designEditSnippet(v){
  if(typeof v === 'string') return v;
  if(Array.isArray(v)) return (v[0] || '') + ': ' + (v[1] || '');
  if(v && v.skill) return '🎲 ' + v.skill;
  if(v && v.t !== undefined && v.e !== undefined) return v.t + ' — ' + v.e;
  try { return JSON.stringify(v); } catch(e){ return ''; }
}
// Friendly names, resolved through the effective (override-applied) sets.
function designBodyName(sysId, bodyId){
  try {
    const props = (bodyPropertyOverrides[sysId] || {})[bodyId];
    if(props && props.name) return props.name;
    const b = effectiveBodies(sysId).find(x => x.id === bodyId);
    if(b && b.name) return b.name;
  } catch(e){}
  return bodyId;
}
function designLocationName(sysId, locId){
  try {
    const props = (locationPropertyOverrides[sysId] || {})[locId];
    if(props && props.name) return props.name;
    if(typeof findLocation === 'function' && currentSystemId === sysId){ const hit = findLocation(locId); if(hit && hit.loc && hit.loc.name) return hit.loc.name; }
  } catch(e){}
  return locId;
}

// Shared re-render after any single revert, then repaint the index in place.
function afterDesignRevert(){
  if(typeof refreshDesignAffordances === 'function') refreshDesignAffordances();
  if(typeof HX !== 'undefined' && HX.refresh) HX.refresh();
  showToast('Reverted to original');
  openDesignEditsIndex();
}
async function revertContentOverride(key){
  if(!Object.prototype.hasOwnProperty.call(contentOverrides, key)) return;
  delete contentOverrides[key];
  await saveContentOverrides();
  afterDesignRevert();
}
async function revertBodyOverride(sysId, bodyId){
  if(typeof recordDesignUndo === 'function') recordDesignUndo('Revert world edit');
  if(bodyPropertyOverrides[sysId]){ delete bodyPropertyOverrides[sysId][bodyId]; if(!_dCount(bodyPropertyOverrides[sysId])) delete bodyPropertyOverrides[sysId]; }
  await saveBodyPropertyOverrides();
  afterDesignRevert();
}
async function revertLocationOverride(sysId, locId){
  if(typeof recordDesignUndo === 'function') recordDesignUndo('Revert location edit');
  if(locationPropertyOverrides[sysId]){ delete locationPropertyOverrides[sysId][locId]; if(!_dCount(locationPropertyOverrides[sysId])) delete locationPropertyOverrides[sysId]; }
  await saveLocationPropertyOverrides();
  afterDesignRevert();
}
async function revertSystemOverride(id){
  const spo = _dg(()=>systemPropertyOverrides);
  if(spo && spo[id]){ delete spo[id]; if(typeof saveSystemPropertyOverrides === 'function') await saveSystemPropertyOverrides(); }
  afterDesignRevert();
}
async function revertFactionOverride(id){
  const fpo = _dg(()=>factionPropertyOverrides);
  if(fpo && fpo[id]){ delete fpo[id]; if(typeof saveFactionPropertyOverrides === 'function') await saveFactionPropertyOverrides(); if(typeof rebuildFactionsFromOverlay === 'function') rebuildFactionsFromOverlay(); }
  afterDesignRevert();
}
async function revertWeaponOverride(id){
  const wpo = _dg(()=>weaponPropertyOverrides);
  if(wpo && wpo[id]){ delete wpo[id]; if(typeof saveWeaponPropertyOverrides === 'function') await saveWeaponPropertyOverrides(); }
  afterDesignRevert();
}

// The big hammer — clear every design store that overlays the built-in campaign,
// then reload so every loader/renderer re-reads pristine state (mirrors the
// import/reset flow). Deliberately scoped: session state and separately-authored
// assets are left alone (see confirm text + header comment).
async function revertAllContentEdits(){
  if(!isReferee() || !designModeOn) return;
  const n = countAllDesignEdits();
  if(!n){ showToast('No content edits to revert', 'info'); return; }
  if(!confirm(
    'Revert ALL ' + n + ' content edit' + (n === 1 ? '' : 's') + ' back to the original campaign?\n\n' +
    'This clears every referee edit to star systems, regions, jump lanes, territory paint, worlds, locations, ' +
    'station text / checks / events / NPCs, and the weapon catalogue — restoring the shipped campaign exactly.\n\n' +
    'It does NOT touch: reveals, the clock, initiative, whispers, your item catalogue, economy tuning, ' +
    'splash screens, or Campaign Studio settings.\n\n' +
    'This cannot be undone. If you might want these back, Cancel and export your campaign first.\n\nContinue?')) return;

  // In-file content / body / location stores.
  contentOverrides = {}; contentHistory = {}; contentAdditions = {}; contentDeletions = {};
  bodyAdditions = {}; bodyDeletions = {}; bodyPropertyOverrides = {};
  locationAdditions = {}; locationDeletions = {}; locationPropertyOverrides = {};
  await saveContentOverrides(); await saveContentHistory(); await saveContentAdditions(); await saveContentDeletions();
  await saveBodyAdditions(); await saveBodyDeletions(); await saveBodyPropertyOverrides();
  await saveLocationAdditions(); await saveLocationDeletions(); await saveLocationPropertyOverrides();

  // Galaxy stores (js/10) — reset the live globals, then persist via their own savers.
  if(typeof systemAdditions !== 'undefined'){ systemAdditions = []; systemDeletions = {}; systemPropertyOverrides = {};
    if(typeof saveSystemAdditions === 'function') await saveSystemAdditions();
    if(typeof saveSystemDeletions === 'function') await saveSystemDeletions();
    if(typeof saveSystemPropertyOverrides === 'function') await saveSystemPropertyOverrides(); }
  if(typeof factionAdditions !== 'undefined'){ factionAdditions = {}; factionDeletions = {}; factionPropertyOverrides = {};
    if(typeof saveFactionAdditions === 'function') await saveFactionAdditions();
    if(typeof saveFactionDeletions === 'function') await saveFactionDeletions();
    if(typeof saveFactionPropertyOverrides === 'function') await saveFactionPropertyOverrides(); }
  if(typeof gxLaneAdditions !== 'undefined'){ gxLaneAdditions = []; gxLaneDeletions = [];
    if(typeof saveGalaxyLanes === 'function') await saveGalaxyLanes(); }
  if(typeof routeBlocks !== 'undefined'){ routeBlocks = { enabled: true, blocks: {} };
    if(typeof saveRouteBlocks === 'function') await saveRouteBlocks(); }
  if(typeof hexPaint !== 'undefined'){ hexPaint = {};
    if(typeof saveHexPaint === 'function') await saveHexPaint(); }
  if(typeof tradeGoodOverrides !== 'undefined'){ tradeGoodOverrides = {}; tradeGoodAdditions = []; tradeGoodDeletions = {};
    if(typeof saveTradeGoodOverrides === 'function') await saveTradeGoodOverrides();
    if(typeof saveTradeGoodAdditions === 'function') await saveTradeGoodAdditions();
    if(typeof saveTradeGoodDeletions === 'function') await saveTradeGoodDeletions(); }
  if(typeof generatorOverrides !== 'undefined'){ generatorOverrides = {};
    if(typeof saveGeneratorOverrides === 'function') await saveGeneratorOverrides(); }
  if(typeof contractOverrides !== 'undefined'){ contractOverrides = {};
    if(typeof saveContractOverrides === 'function') await saveContractOverrides(); }
  if(typeof rulesOverrides !== 'undefined'){ rulesOverrides = {};
    if(typeof applyRulesOverrides === 'function') applyRulesOverrides();   // restore the shipped tables in place
    if(typeof saveRulesOverrides === 'function') await saveRulesOverrides(); }
  if(typeof themeOverrides !== 'undefined'){ themeOverrides = {};
    if(typeof applyThemeOverrides === 'function') applyThemeOverrides();   // restore the shipped/pack colours
    if(typeof saveThemeOverrides === 'function') await saveThemeOverrides(); }
  if(typeof panelFlags !== 'undefined'){ panelFlags = {};
    if(typeof applyPanelFlags === 'function') applyPanelFlags();           // show every panel again
    if(typeof savePanelFlags === 'function') await savePanelFlags(); }
  if(typeof npcPortraits !== 'undefined'){ npcPortraits = {};              // drop custom body/station NPC faces
    if(typeof saveNpcPortraits === 'function') await saveNpcPortraits(); }
  if(typeof sceneImages !== 'undefined'){ sceneImages = {};                // drop location / area scene art
    if(typeof saveSceneImages === 'function') await saveSceneImages(); }

  // Combat / weapon stores (js/80).
  if(typeof weaponAdditions !== 'undefined'){ weaponAdditions = []; weaponDeletions = {}; weaponPropertyOverrides = {};
    if(typeof saveWeaponAdditions === 'function') await saveWeaponAdditions();
    if(typeof saveWeaponDeletions === 'function') await saveWeaponDeletions();
    if(typeof saveWeaponPropertyOverrides === 'function') await saveWeaponPropertyOverrides(); }

  showToast('All content edits reverted — reloading…');
  setTimeout(() => { try { location.reload(); } catch(e){} }, 700);
}

// ═══════════════════════════════════════════════════════════════════════════
// DESIGN-LAYER EXPORT / IMPORT — portable backup of just the design edits
// ═══════════════════════════════════════════════════════════════════════════
// The whole-campaign export (js/60) is coarse, online-only and destructive on
// import. This exports ONLY the Design-Mode layer — the referee's edits over the
// shipped campaign — as a small JSON file, from the referee's full in-memory
// data (so the "-ref" secrets travel too). Import replaces that layer and
// reloads, writing each store redaction-aware (stripped public + full "-ref").
// Session state (reveals, clock, initiative), the item catalogue, economy and
// Campaign Studio config are deliberately NOT included.
const DESIGN_LAYER_VERSION = 1;
function collectDesignLayer(){
  const d = {};
  const put = (k, v) => { if(v !== undefined) d[k] = v; };
  put('content-overrides', contentOverrides);
  put('content-additions', contentAdditions);
  put('content-deletions', contentDeletions);
  put('content-history', contentHistory);
  put('body-additions', bodyAdditions);
  put('body-deletions', bodyDeletions);
  put('body-prop-overrides', bodyPropertyOverrides);
  put('location-additions', locationAdditions);
  put('location-deletions', locationDeletions);
  put('location-prop-overrides', locationPropertyOverrides);
  if(typeof systemAdditions !== 'undefined'){ put('system-additions', systemAdditions); put('system-deletions', systemDeletions); put('system-prop-overrides', systemPropertyOverrides); }
  if(typeof factionAdditions !== 'undefined'){ put('faction-additions', factionAdditions); put('faction-deletions', factionDeletions); put('faction-prop-overrides', factionPropertyOverrides); }
  if(typeof weaponAdditions !== 'undefined'){ put('weapon-additions', weaponAdditions); put('weapon-deletions', weaponDeletions); put('weapon-prop-overrides', weaponPropertyOverrides); }
  if(typeof gxLaneAdditions !== 'undefined') put('galaxy-lanes', { additions: gxLaneAdditions, deletions: gxLaneDeletions });
  if(typeof routeBlocks !== 'undefined') put('route-blocks', routeBlocks);
  if(typeof hexPaint !== 'undefined') put('hex-paint', hexPaint);
  if(typeof tradeGoodOverrides !== 'undefined'){ put('trade-good-overrides', tradeGoodOverrides); put('trade-good-additions', tradeGoodAdditions); put('trade-good-deletions', tradeGoodDeletions); }
  if(typeof generatorOverrides !== 'undefined') put('generator-overrides', generatorOverrides);
  if(typeof contractOverrides !== 'undefined') put('contract-overrides', contractOverrides);
  if(typeof rulesOverrides !== 'undefined') put('rules-overrides', rulesOverrides);
  if(typeof themeOverrides !== 'undefined') put('theme-overrides', themeOverrides);
  if(typeof panelFlags !== 'undefined') put('panel-flags', panelFlags);
  if(typeof npcPortraits !== 'undefined') put('npc-portraits', npcPortraits);
  if(typeof sceneImages !== 'undefined') put('scene-images', sceneImages);
  if(typeof stationAdditions !== 'undefined') put('station-additions', stationAdditions);
  return d;
}
function exportDesignLayer(){
  if(!isReferee()){ showToast('Referee only', 'error'); return; }
  const data = collectDesignLayer();
  const total = (typeof countAllDesignEdits === 'function') ? countAllDesignEdits() : Object.keys(data).length;
  const blob = {
    app: 'aurelia-design-layer', version: DESIGN_LAYER_VERSION, exportedAt: new Date().toISOString(),
    campaignId: (typeof activeCampaignId !== 'undefined' ? activeCampaignId : 'archon-gambit'),
    editCount: total, data,
  };
  const json = JSON.stringify(blob, null, 2);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = `aurelia-design-layer-${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => { try { URL.revokeObjectURL(a.href); } catch(e){} }, 4000);
  showToast(`Exported ${total} design edit${total === 1 ? '' : 's'}`);
}
// Write one imported store back, redaction-aware: split stores get the full copy
// under "<key>-ref" and the stripped copy under the public key.
async function writeImportedDesignStore(key, value){
  const split = (typeof isSplitStore === 'function') && isSplitStore(key);
  if(split && typeof stripOverlayForPlayers === 'function'){
    await supaStorage.set(key + '-ref', JSON.stringify(value), true);
    await supaStorage.set(key, JSON.stringify(stripOverlayForPlayers(key, value)), true);
  } else {
    await supaStorage.set(key, JSON.stringify(value), true);
  }
}
function importDesignLayer(){
  if(!isReferee()){ showToast('Referee only', 'error'); return; }
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files && input.files[0]; if(!file) return;
    let blob;
    try { blob = JSON.parse(await file.text()); }
    catch(e){ showToast('Import failed — not valid JSON', 'error'); return; }
    if(!blob || blob.app !== 'aurelia-design-layer' || !blob.data || typeof blob.data !== 'object' || Array.isArray(blob.data)){
      showToast('Import failed — not an Aurelia design-layer file', 'error'); return; }
    const keys = Object.keys(blob.data);
    if(!keys.length){ showToast('Import failed — file has no design edits', 'error'); return; }
    if(!confirm(
      'Import this design layer (' + (blob.editCount != null ? blob.editCount + ' edits, ' : '') + keys.length + ' store' + (keys.length === 1 ? '' : 's') + ') from "' + file.name + '"?\n\n' +
      'This REPLACES all current Design-Mode edits over the shipped campaign (systems, regions, worlds, locations, station text / checks / events / NPCs, weapon catalogue, map layers).\n\n' +
      'It does NOT touch reveals, the clock, session state, your item catalogue, economy tuning or Campaign Studio.\n\n' +
      'Cannot be undone — export first if unsure. Continue?')) return;
    showToast('Importing design layer…', 'info');
    let ok = 0, fail = 0;
    for(const k of keys){
      try { await writeImportedDesignStore(k, blob.data[k]); ok++; } catch(e){ fail++; }
    }
    showToast(`Imported ${ok} store${ok === 1 ? '' : 's'}${fail ? ` (${fail} failed)` : ''} — reloading…`);
    setTimeout(() => { try { location.reload(); } catch(e){} }, 900);
  };
  input.click();
}


// Resolves the text actually shown for a given key — override if one
// exists, otherwise the original hardcoded value passed in.
function resolveContent(key, originalText){
  return Object.prototype.hasOwnProperty.call(contentOverrides, key) ? contentOverrides[key] : originalText;
}

// Resolved from the deployed campaign config (config.js → window.AURELIA_CONFIG)
// or a per-device setup, falling back to the reference campaign's code.
const DESIGN_MODE_CODE = (typeof aureliaCfg === 'function' && aureliaCfg('designCode')) || 'ilovetwix2012!';

// Player Mode and Design Mode are mutually exclusive — a referee should
// never be able to switch into Player Mode (to preview what players see)
// while editing controls are still live. toggleDesignMode() already
// blocks turning Design Mode ON while Player Mode is active via the
// isReferee() check, but that alone doesn't cover the reverse order:
// Design Mode ON first, then Player Mode switched on afterward. This
// forces it off the moment Player Mode activates, no passcode needed
// since we're removing access, not granting it.
function forceDesignModeOff(){
  if(!designModeOn) return;
  designModeOn = false;
  designPasscodePrompt = false; designPasscodeError = false;
  rootEl.classList.remove('design-active');
  // Design tools are no longer reachable — close that menu if it's open.
  closeDesignMenu();
  refreshOpenMenus();
}

// Re-render the views that show design-mode affordances (pencils, add/remove
// controls). Called whenever Design Mode flips on or off.
function refreshDesignAffordances(){
  if(currentView === 'station' && cur) renderDetail();
  if(currentView === 'system'){ if(selectedBody) selectBody(selectedBody); else renderSystemOverview(); }
  if(currentView === 'body' && selectedBody){ if(selectedBodyLoc) selectBodyLocation(selectedBodyLoc); else buildBodyView(selectedBody); }
  if(currentView === 'galaxy' && typeof RealMap !== 'undefined') RealMap.invalidate();  // REAL-map datacard flips read ↔ edit
  updateDesignPanelVisibility();  // the floating Design Studio follows the mode
}

// ═══ DESIGN STUDIO — floating, context-sensitive host for the Design editors ═══
// The editor sections that used to crowd the info panels (galaxy detail, orrery
// body detail, body/location views) render here instead. The panel exists only
// while Design Mode is on; its content follows the current view + selection.
// Section open/closed state lives in designSecState (bound in js/96 boot).
let designPanelCollapsed = false;
let designSecState = {};   // {sectionKey: open} — read by HX.designSectionsHTML

function toggleDesignCollapse(){
  const hdr = document.getElementById('design-header');
  if(hdr && hdr.dataset.suppressClick === '1') return;
  designPanelCollapsed = !designPanelCollapsed;
  const t = document.getElementById('design-toggle'); if(t) t.textContent = designPanelCollapsed ? '▲' : '▼';
  const b = document.getElementById('design-body'); if(b) b.classList.toggle('collapsed', designPanelCollapsed);
  const w = document.getElementById('design-wrap'); if(w) w.classList.toggle('panel-collapsed', designPanelCollapsed);
}

function updateDesignPanelVisibility(){
  const w = document.getElementById('design-wrap'); if(!w) return;
  const on = designModeOn && isReferee();
  w.classList.toggle('hidden', !on);
  if(on) renderDesignPanel();
}

// Context dispatcher: each view's render path calls this after it paints, so
// the panel always reflects the current selection without its own poll.
function renderDesignPanel(){
  if(!designModeOn || !isReferee()) return;
  const body = document.getElementById('design-body'); if(!body) return;
  let html = '';
  const view = (typeof currentView !== 'undefined') ? currentView : 'galaxy';
  if(view === 'galaxy' && typeof HX !== 'undefined' && HX.designSectionsHTML){
    html = HX.designSectionsHTML();
  } else if(view === 'system' && typeof designSystemViewHTML === 'function'){
    html = designSystemViewHTML();
  } else if(view === 'body' && typeof designBodyViewHTML === 'function'){
    html = designBodyViewHTML();
  } else if(view === 'station'){
    // Authored stations get their structural editor; Aurelia keeps its note.
    html = (typeof designStationViewHTML === 'function')
      ? designStationViewHTML()
      : `<div class="hx-small">Station content is edited in place — ✏ pencils appear on each text block while Design Mode is on.</div>`;
  }
  body.innerHTML = html || `<div class="hx-small">Select a system, body, or location to begin designing.</div>`;
}

function toggleDesignMode(){
  if(!isReferee()) return;
  if(!designModeOn){
    // Turning ON requires the passcode. prompt() is silently suppressed inside
    // sandboxed preview iframes, so show an inline passcode field in the
    // Referee menu instead and finish in submitDesignPasscode().
    designPasscodePrompt = !designPasscodePrompt; // click again to dismiss
    designPasscodeError = false;
    renderRefereeMenu();
    if(designPasscodePrompt){
      setTimeout(() => { const i = document.getElementById('design-pass-input'); if(i) i.focus(); }, 0);
    }
    return;
  }
  // Turning OFF is always immediate.
  designModeOn = false;
  designPasscodePrompt = false; designPasscodeError = false;
  rootEl.classList.remove('design-active');
  closeDesignMenu();
  refreshOpenMenus();
  refreshDesignAffordances();
}

// Validates the inline Design-Mode passcode and enables design mode on success.
function submitDesignPasscode(){
  const input = document.getElementById('design-pass-input');
  const val = input ? input.value : '';
  if(val !== DESIGN_MODE_CODE){
    designPasscodeError = true;
    renderRefereeMenu();
    setTimeout(() => { const i = document.getElementById('design-pass-input'); if(i) i.focus(); }, 0);
    return;
  }
  designModeOn = true;
  designPasscodePrompt = false;
  designPasscodeError = false;
  rootEl.classList.add('design-active'); // reveals the ✎ Design header icon
  refreshOpenMenus();
  refreshDesignAffordances();
}

function cancelDesignPasscode(){
  designPasscodePrompt = false;
  designPasscodeError = false;
  renderRefereeMenu();
}

// Wraps a piece of displayed text with a pencil-edit affordance when
// Design Mode is on. `key` must be stable and unique per field.
// `originalText` is the hardcoded fallback value for that field.
function designWrap(key, originalText, displayedHtml){
  if(!designModeOn) return displayedHtml;
  const hasOverride = Object.prototype.hasOwnProperty.call(contentOverrides, key);
  return `<div class="design-editable ${hasOverride?'has-override':''}" data-design-key="${key}">
    ${displayedHtml}
    <button class="design-edit-pencil" onclick="openDesignEdit('${key.replace(/'/g,"\\\\'")}', this)" title="Edit this text">✏</button>
  </div>`;
}

// designEditType: 'text' (stage 1, simple string) | 'check' | 'event' | 'nperow'
// (stage 2, structured objects/tuples). Each structured type gets its own
// small form rendered into #design-edit-body in place of the plain
// textarea, but everything else — save, revert, history — is shared.
let designEditType = 'text';

function openDesignEdit(key, btnEl){
  designEditCurrentKey = key;
  designEditType = 'text';
  const titleKey = key.replace(/^loc-/, '').replace(/-/g, ' › ');
  document.getElementById('design-edit-title').textContent = 'EDIT: ' + titleKey.toUpperCase();
  const current = resolveContent(key, designEditOriginalTextFor(key));
  showDesignEditBody(`<textarea id="design-edit-textarea" class="design-field-textarea" style="min-height:160px">${(current||'').replace(/</g,'&lt;')}</textarea>`);
  document.getElementById('design-history-list').innerHTML = '';
  document.getElementById('design-history-list').classList.add('hidden');
  document.getElementById('design-edit-panel').classList.remove('hidden');
}

// Opens the structured editor for a whole skill check (skill name + all
// its degree tiers). `original` is the hardcoded check object, used as
// the fallback if no override exists yet.
// Shared form-builder for the check editor — used by both the initial
// open and re-renders after adding/removing a tier, so the markup and
// the add/remove wiring only exist in one place.
function renderCheckEditForm(data){
  const degreesHTML = data.degrees.map((dg,i) => `
    <div class="design-degree-block">
      <div class="design-degree-head" style="display:flex;align-items:center;justify-content:space-between">
        <span>Tier ${i+1}</span>
        ${data.degrees.length > 1 ? `<button type="button" class="design-tier-remove" onclick="removeDesignDegreeTier(${i})">✕ Remove tier</button>` : ''}
      </div>
      <div class="design-field-group">
        <div class="design-field-label">Label (e.g. "Success", "Effect 2+")</div>
        <input type="text" class="design-field-input design-deg-label" data-idx="${i}" value="${(dg.l||dg.label||'').replace(/"/g,'&quot;')}">
      </div>
      <div class="design-field-group">
        <div class="design-field-label">Outcome text</div>
        <textarea class="design-field-textarea design-deg-text" data-idx="${i}">${(dg.t||dg.text||'').replace(/</g,'&lt;')}</textarea>
      </div>
    </div>
  `).join('');
  showDesignEditBody(`
    <div class="design-field-group">
      <div class="design-field-label">Skill check</div>
      <input type="text" id="design-check-skill" class="design-field-input" value="${(data.skill||'').replace(/"/g,'&quot;')}">
    </div>
    ${degreesHTML}
    <button type="button" class="design-add-btn" onclick="addDesignDegreeTier()">+ Add Tier</button>
  `);
}

// Adds a blank degree tier to the check currently being edited, preserving
// whatever's already been typed into the other tiers by reading the form
// back into a value first rather than re-rendering from the original data.
function addDesignDegreeTier(){
  const current = readDesignEditFormValue();
  current.degrees.push({ l: '', c: 'dp', t: '' });
  renderCheckEditForm(current);
}

function removeDesignDegreeTier(idx){
  const current = readDesignEditFormValue();
  if(current.degrees.length <= 1) return; // always keep at least one tier
  current.degrees.splice(idx, 1);
  renderCheckEditForm(current);
}

function openDesignEditCheck(key, original){
  designEditCurrentKey = key;
  designEditType = 'check';
  designOriginalRegistry[key] = original;
  document.getElementById('design-edit-title').textContent = 'EDIT SKILL CHECK';
  const data = resolveContent(key, original);
  renderCheckEditForm(data);
  document.getElementById('design-history-list').innerHTML = '';
  document.getElementById('design-history-list').classList.add('hidden');
  document.getElementById('design-edit-panel').classList.remove('hidden');
}

// Opens the structured editor for a single timed event (timing + text).
function openDesignEditEvent(key, original){
  designEditCurrentKey = key;
  designEditType = 'event';
  designOriginalRegistry[key] = original;
  document.getElementById('design-edit-title').textContent = 'EDIT EVENT';
  const data = resolveContent(key, original);
  showDesignEditBody(`
    <div class="design-field-group">
      <div class="design-field-label">Timing (e.g. "Hour 22", "On arrival")</div>
      <input type="text" id="design-event-timing" class="design-field-input" value="${(data.t||'').replace(/"/g,'&quot;')}">
    </div>
    <div class="design-field-group">
      <div class="design-field-label">Event text</div>
      <textarea id="design-event-text" class="design-field-textarea" style="min-height:100px">${(data.e||'').replace(/</g,'&lt;')}</textarea>
    </div>
  `);
  document.getElementById('design-history-list').innerHTML = '';
  document.getElementById('design-history-list').classList.add('hidden');
  document.getElementById('design-edit-panel').classList.remove('hidden');
}

// Opens the structured editor for a single NPC detail row (label + text).
// `original` is the [label, text] tuple.
function openDesignEditNpcRow(key, original){
  designEditCurrentKey = key;
  designEditType = 'nperow';
  designOriginalRegistry[key] = original;
  document.getElementById('design-edit-title').textContent = 'EDIT NPC DETAIL';
  const data = resolveContent(key, original);
  showDesignEditBody(`
    <div class="design-field-group">
      <div class="design-field-label">Label (e.g. "Manner", "On fuel")</div>
      <input type="text" id="design-row-label" class="design-field-input" value="${(data[0]||'').replace(/"/g,'&quot;')}">
    </div>
    <div class="design-field-group">
      <div class="design-field-label">Detail text</div>
      <textarea id="design-row-text" class="design-field-textarea" style="min-height:100px">${(data[1]||'').replace(/</g,'&lt;')}</textarea>
    </div>
  `);
  document.getElementById('design-history-list').innerHTML = '';
  document.getElementById('design-history-list').classList.add('hidden');
  document.getElementById('design-edit-panel').classList.remove('hidden');
}

// Opens the structured editor for a whole NPC's name / role / skills / stats.
// Stored as a PARTIAL override keyed "<nid>-npc" — the render Object.assigns it
// over the base NPC, so detail rows (edited separately by row key) are untouched.
// Works for base AND referee-added NPCs, on stations and bodies; the key is
// referee-only (isRefOnlyContentKey) so it's redacted from players.
function attrEsc(s){ return escHtml(s == null ? '' : s).replace(/"/g, '&quot;'); }
function renderNpcEditForm(data){
  const stats = (data && data.stats) || {};
  const statCells = Object.keys(stats).map(k => `
    <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
      <input type="text" class="design-field-input design-npc-stat" data-stat="${attrEsc(k)}" value="${attrEsc(stats[k])}" style="width:54px;text-align:center;padding:6px 4px">
      <div class="design-field-label" style="margin:0">${escHtml(k)}</div>
    </div>`).join('');
  // Portrait (players see this NPC, so the version stamp is in the shared
  // npc-portraits store keyed by the nid — the design key minus the -npc suffix).
  const nid = (designEditCurrentKey || '').replace(/-npc$/, '');
  const pver = (typeof npcPortraitVer === 'function') ? npcPortraitVer(nid) : 0;
  const avatar = (typeof npcMediaAvatar === 'function') ? npcMediaAvatar(nid, data && data.name, 48) : '';
  const portraitRow = `
    <div class="design-field-group" style="display:flex;align-items:center;gap:10px">
      ${avatar}
      <button class="design-edit-pencil-inline" onclick="triggerDesignNpcPortrait()">${pver ? 'Change photo' : 'Upload photo'}</button>
      ${pver ? `<button class="design-edit-pencil-inline danger" onclick="removeDesignNpcPortrait()" title="Remove photo">✕</button>` : ''}
      <input type="file" id="design-npc-portrait-file" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="onDesignNpcPortraitFile(event)">
    </div>`;
  showDesignEditBody(portraitRow + `
    <div class="design-field-group"><div class="design-field-label">Name</div>
      <input type="text" id="design-npc-name" class="design-field-input" value="${attrEsc(data.name)}"></div>
    <div class="design-field-group"><div class="design-field-label">Role</div>
      <input type="text" id="design-npc-role" class="design-field-input" value="${attrEsc(data.role)}"></div>
    <div class="design-field-group"><div class="design-field-label">Skills (comma-separated)</div>
      <input type="text" id="design-npc-skills" class="design-field-input" value="${attrEsc(data.skills)}"></div>
    <div class="design-field-group"><div class="design-field-label">Characteristics</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${statCells || '<span class="hx-small">This NPC has no characteristics.</span>'}</div></div>
  `);
}
// Re-render whichever entity view is on screen after a design change.
function rerenderDesignEntityView(){
  if(currentView === 'station' && typeof cur !== 'undefined' && cur && typeof renderDetail === 'function') renderDetail();
  else if(currentView === 'system' && selectedBody && typeof selectBody === 'function') selectBody(selectedBody);
  else if(currentView === 'body' && selectedBody){ if(selectedBodyLoc && typeof selectBodyLocation === 'function') selectBodyLocation(selectedBodyLoc); else if(typeof buildBodyView === 'function') buildBodyView(selectedBody); }
}
function _reRenderNpcForm(){
  const key = designEditCurrentKey; if(!key) return;
  const original = designOriginalRegistry[key] || {};
  const has = Object.prototype.hasOwnProperty.call(contentOverrides, key);
  renderNpcEditForm(has ? Object.assign({}, original, contentOverrides[key]) : original);
}
function triggerDesignNpcPortrait(){ const f = document.getElementById('design-npc-portrait-file'); if(f) f.click(); }
async function onDesignNpcPortraitFile(e){
  const file = e && e.target && e.target.files && e.target.files[0];
  if(e && e.target) e.target.value = '';
  if(!file || !isReferee()) return;
  const nid = (designEditCurrentKey || '').replace(/-npc$/, '');
  if(!nid) return;
  if(typeof resizePortrait !== 'function' || typeof uploadNpcPortraitBlob !== 'function'){ if(typeof showToast === 'function') showToast('Portraits unavailable'); return; }
  if(file.size > 12 * 1024 * 1024){ if(typeof showToast === 'function') showToast('Image too large (max 12 MB)'); return; }
  try {
    if(typeof showToast === 'function') showToast('Uploading…', 'info');
    const blob = await resizePortrait(file, 256);
    await uploadNpcPortraitBlob(nid, blob);
    if(typeof npcPortraits !== 'undefined'){ npcPortraits[nid] = Date.now(); if(typeof saveNpcPortraits === 'function') await saveNpcPortraits(); }
    _reRenderNpcForm();
    rerenderDesignEntityView();
    if(typeof showToast === 'function') showToast('Portrait updated');
  } catch(err){ console.error('NPC portrait upload failed', err); if(typeof showToast === 'function') showToast('Portrait upload failed'); }
}
async function removeDesignNpcPortrait(){
  if(!isReferee()) return;
  const nid = (designEditCurrentKey || '').replace(/-npc$/, '');
  if(typeof npcPortraits !== 'undefined' && npcPortraits[nid]){ delete npcPortraits[nid]; if(typeof saveNpcPortraits === 'function') await saveNpcPortraits(); }
  _reRenderNpcForm();
  rerenderDesignEntityView();
}

// ── Scene images (location / station-area establishing art) ──────────────────
// Landscape banners, so — unlike the square portrait crop — this preserves the
// aspect ratio and just caps the longest edge. See js/50 scene-images store.
function resizeSceneImage(file, maxDim){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      if(Math.max(w, h) > maxDim){ const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
}
function triggerSceneImage(key){ const f = document.getElementById('scene-image-file'); if(f) f.click(); }
async function onSceneImageFile(key, e){
  const file = e && e.target && e.target.files && e.target.files[0];
  if(e && e.target) e.target.value = '';
  if(!file || !isReferee() || !key) return;
  if(typeof uploadSceneImageBlob !== 'function'){ if(typeof showToast === 'function') showToast('Scene images unavailable'); return; }
  if(file.size > 12 * 1024 * 1024){ if(typeof showToast === 'function') showToast('Image too large (max 12 MB)'); return; }
  try {
    if(typeof showToast === 'function') showToast('Uploading…', 'info');
    const blob = await resizeSceneImage(file, 1400);
    await uploadSceneImageBlob(_sceneCampaign(), key, blob);
    if(typeof sceneImages !== 'undefined'){ sceneImages[key] = Date.now(); if(typeof saveSceneImages === 'function') await saveSceneImages(); }
    rerenderDesignEntityView();
    if(typeof showToast === 'function') showToast('Scene image updated');
  } catch(err){ console.error('Scene image upload failed', err); if(typeof showToast === 'function') showToast('Upload failed — is the scenes bucket set up? (migration 0015)'); }
}
async function removeSceneImage(key){
  if(!isReferee()) return;
  if(typeof sceneImages !== 'undefined' && sceneImages[key]){ delete sceneImages[key]; if(typeof saveSceneImages === 'function') await saveSceneImages(); }
  rerenderDesignEntityView();
}
function openDesignEditNpc(key, original){
  designEditCurrentKey = key;
  designEditType = 'npc';
  designOriginalRegistry[key] = original;
  document.getElementById('design-edit-title').textContent = 'EDIT NPC';
  const has = Object.prototype.hasOwnProperty.call(contentOverrides, key);
  const data = has ? Object.assign({}, original, contentOverrides[key]) : (original || {});
  renderNpcEditForm(data);
  document.getElementById('design-history-list').innerHTML = '';
  document.getElementById('design-history-list').classList.add('hidden');
  document.getElementById('design-edit-panel').classList.remove('hidden');
}

function showDesignEditBody(formHTML){
  document.getElementById('design-edit-body').innerHTML = formHTML + '<div id="design-history-list"></div>';
}

// Looks up the original hardcoded value for a key, so Revert always has
// something to fall back to even if contentOverrides has since changed it.
// Registered by each render call via designOriginalRegistry.
const designOriginalRegistry = {};
function designEditOriginalTextFor(key){
  return designOriginalRegistry[key] || '';
}

function closeDesignEdit(){
  document.getElementById('design-edit-panel').classList.add('hidden');
  document.getElementById('design-edit-footer').classList.remove('hidden');
  designEditCurrentKey = null;
}

// Reads the current form values back into the appropriate JS value shape
// for whichever designEditType is active.
function readDesignEditFormValue(){
  if(designEditType === 'text'){
    return document.getElementById('design-edit-textarea').value;
  }
  if(designEditType === 'check'){
    const skill = document.getElementById('design-check-skill').value;
    const labels = document.querySelectorAll('.design-deg-label');
    const texts = document.querySelectorAll('.design-deg-text');
    const degrees = [];
    labels.forEach((labelEl, i) => {
      degrees.push({ l: labelEl.value, c: (designEditOriginalTextFor(designEditCurrentKey).degrees[i]||{}).c || 'dp', t: texts[i].value });
    });
    return { skill, degrees };
  }
  if(designEditType === 'event'){
    return { t: document.getElementById('design-event-timing').value, e: document.getElementById('design-event-text').value };
  }
  if(designEditType === 'nperow'){
    return [document.getElementById('design-row-label').value, document.getElementById('design-row-text').value];
  }
  if(designEditType === 'npc'){
    const stats = {};
    document.querySelectorAll('.design-npc-stat').forEach(inp => {
      const v = String(inp.value).trim();
      stats[inp.dataset.stat] = (v !== '' && !isNaN(v)) ? Number(v) : v;   // keep numbers numeric, allow hex/text
    });
    return {
      name: document.getElementById('design-npc-name').value,
      role: document.getElementById('design-npc-role').value,
      skills: document.getElementById('design-npc-skills').value,
      stats,
    };
  }
  return null;
}

// Renders the form fields back from a given value — used by Revert and by
// restoring a history entry, so both end up reusing the same render logic
// as the original openDesignEdit* functions rather than duplicating it.
function renderDesignEditFormFromValue(value){
  if(designEditType === 'text'){
    document.getElementById('design-edit-textarea').value = value || '';
    return;
  }
  if(designEditType === 'check'){
    renderCheckEditForm(value);
    return;
  }
  if(designEditType === 'npc'){
    renderNpcEditForm(value);
    return;
  }
  if(designEditType === 'event'){
    showDesignEditBody(`
      <div class="design-field-group">
        <div class="design-field-label">Timing (e.g. "Hour 22", "On arrival")</div>
        <input type="text" id="design-event-timing" class="design-field-input" value="${(value.t||'').replace(/"/g,'&quot;')}">
      </div>
      <div class="design-field-group">
        <div class="design-field-label">Event text</div>
        <textarea id="design-event-text" class="design-field-textarea" style="min-height:100px">${(value.e||'').replace(/</g,'&lt;')}</textarea>
      </div>
    `);
    return;
  }
  if(designEditType === 'nperow'){
    showDesignEditBody(`
      <div class="design-field-group">
        <div class="design-field-label">Label (e.g. "Manner", "On fuel")</div>
        <input type="text" id="design-row-label" class="design-field-input" value="${(value[0]||'').replace(/"/g,'&quot;')}">
      </div>
      <div class="design-field-group">
        <div class="design-field-label">Detail text</div>
        <textarea id="design-row-text" class="design-field-textarea" style="min-height:100px">${(value[1]||'').replace(/</g,'&lt;')}</textarea>
      </div>
    `);
    return;
  }
}

async function saveDesignEdit(){
  if(!designEditCurrentKey) return;
  const key = designEditCurrentKey;
  const newValue = readDesignEditFormValue();
  const previousValue = resolveContent(key, designEditOriginalTextFor(key));

  // Push previous value onto history before overwriting
  if(!contentHistory[key]) contentHistory[key] = [];
  contentHistory[key].unshift({value: previousValue, type: designEditType, t: Date.now()});
  contentHistory[key] = contentHistory[key].slice(0, 10);

  contentOverrides[key] = newValue;
  await saveContentOverrides();
  await saveContentHistory();

  const msg = document.getElementById('design-save-msg');
  msg.style.display = 'inline';
  setTimeout(() => { msg.style.display = 'none'; }, 1500);
  showToast('Content saved');

  // Re-render the underlying view so the change is visible immediately
  if(currentView === 'station' && cur) renderDetail();
  if(currentView === 'system' && selectedBody) selectBody(selectedBody);
  if(currentView === 'body' && selectedBody){ if(selectedBodyLoc) selectBodyLocation(selectedBodyLoc); else buildBodyView(selectedBody); }
}

async function revertDesignEdit(){
  if(!designEditCurrentKey) return;
  const key = designEditCurrentKey;
  if(!confirm('Revert this field to its original campaign text? This removes your override entirely.')) return;
  delete contentOverrides[key];
  await saveContentOverrides();
  renderDesignEditFormFromValue(designEditOriginalTextFor(key));
  if(currentView === 'station' && cur) renderDetail();
  if(currentView === 'system' && selectedBody) selectBody(selectedBody);
  if(currentView === 'body' && selectedBody){ if(selectedBodyLoc) selectBodyLocation(selectedBodyLoc); else buildBodyView(selectedBody); }
}

function toggleDesignHistory(){
  const list = document.getElementById('design-history-list');
  const key = designEditCurrentKey;
  const hidden = list.classList.contains('hidden');
  if(!hidden){ list.classList.add('hidden'); list.innerHTML=''; return; }
  const hist = contentHistory[key] || [];
  if(!hist.length){
    list.innerHTML = '<div class="init-empty">No earlier versions saved yet.</div>';
  } else {
    list.innerHTML = hist.map((h,i) => {
      const snippet = typeof h.value === 'string' ? h.value
        : Array.isArray(h.value) ? (h.value[0]+': '+h.value[1])
        : h.value.skill ? h.value.skill
        : h.value.t ? (h.value.t+' — '+h.value.e)
        : JSON.stringify(h.value);
      return `<div class="design-history-item" onclick="restoreHistoryEntry(${i})">
        <div class="design-history-label">${new Date(h.t).toLocaleString()}</div>
        <div class="design-history-snippet">${(snippet||'').slice(0,120)}${(snippet||'').length>120?'…':''}</div>
      </div>`;
    }).join('');
  }
  list.classList.remove('hidden');
}

function restoreHistoryEntry(idx){
  const key = designEditCurrentKey;
  const hist = contentHistory[key] || [];
  const entry = hist[idx];
  if(!entry) return;
  renderDesignEditFormFromValue(entry.value);
  document.getElementById('design-history-list').classList.add('hidden');
}

// ── Splash-screen editor (referee, Design Mode) ─────────────────────────────
// Lets the referee turn each welcome splash on/off and edit its copy. Edits go
// to a working draft; Save commits to the shared config (SPLASH_DEFAULTS /
// getSplashConfig / saveSplashConfig live in 55-auth-gating.js) so every player
// picks up the new text and on/off state on their next poll. Preview shows the
// draft live without saving.
let splashDraft = null;

function openSplashEditor(){
  if(!isReferee()) return;
  const start = () => {
    splashDraft = JSON.parse(JSON.stringify(getSplashConfig()));
    renderSplashEditor();
    document.getElementById('splash-edit-modal').classList.remove('hidden');
  };
  // Make sure we edit the shared config, not stale defaults, if it hasn't loaded yet.
  if(typeof splashConfig !== 'undefined' && splashConfig === null && typeof loadSplashConfig === 'function'){
    loadSplashConfig().then(start).catch(start);
  } else { start(); }
}
function closeSplashEditor(){
  const m = document.getElementById('splash-edit-modal');
  if(m) m.classList.add('hidden');
}
function splashSetField(section, key, value){
  if(splashDraft && splashDraft[section]) splashDraft[section][key] = value;
}
function splashToggleEnabled(section){
  if(splashDraft && splashDraft[section]){ splashDraft[section].enabled = !splashDraft[section].enabled; renderSplashEditor(); }
}
function resetSplashDraft(){
  splashDraft = JSON.parse(JSON.stringify({ intro: SPLASH_DEFAULTS.intro, system: SPLASH_DEFAULTS.system }));
  renderSplashEditor();
}
function previewSplash(which){
  if(!splashDraft || typeof showSplash !== 'function') return;
  if(which === 'intro'){
    const c = splashDraft.intro;
    showSplash({ kicker:c.kicker, title:c.title, sub:c.sub, italicSub:true, hint:c.hint });
  } else {
    const c = splashDraft.system;
    const nm = (typeof currentSystemName === 'function') ? currentSystemName().toUpperCase() : 'SYSTEM NAME';
    showSplash({ kicker:c.kicker, title:nm, sub:c.sub, hint:c.hint, duration:3400 });
  }
}
function saveSplashEditor(){
  if(!splashDraft) return;
  splashConfig = JSON.parse(JSON.stringify(splashDraft));   // apply in-memory immediately
  closeSplashEditor();
  if(typeof showToast === 'function') showToast('Splash screens saved.');
  if(typeof saveSplashConfig === 'function') saveSplashConfig();  // persist + share in the background (caches offline, retries)
}
function renderSplashEditor(){
  const card = document.getElementById('splash-edit-card');
  if(!card || !splashDraft) return;
  const d = splashDraft;
  const attr = s => escHtml(s || '').replace(/"/g, '&quot;');   // escHtml doesn't cover quotes
  const toggle = section => {
    const on = d[section].enabled !== false;
    return `<div class="theme-toggle ${on?'on':''}" role="switch" tabindex="0" aria-checked="${on}"
      onclick="splashToggleEnabled('${section}')"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();splashToggleEnabled('${section}');}"><div class="theme-toggle-knob"></div></div>`;
  };
  const field = (section, key, label, ph) => `
    <div class="design-field-group">
      <div class="design-field-label">${label}</div>
      <input type="text" class="design-field-input" value="${attr(d[section][key])}" placeholder="${attr(ph)}"
        oninput="splashSetField('${section}','${key}',this.value)">
    </div>`;
  const previewBtn = which => `<button onclick="previewSplash('${which}')" style="margin-top:2px;font-size:10px;font-family:monospace;background:var(--accentGoldBg);color:var(--accentGold);border:.5px solid var(--accentGold);border-radius:5px;padding:6px 12px;cursor:pointer">▶ Preview</button>`;
  const introOff = d.intro.enabled === false, sysOff = d.system.enabled === false;
  card.innerHTML = `
    <div class="splash-edit-header">
      <span class="se-ttl">🌠 SPLASH SCREENS</span>
      <button onclick="closeSplashEditor()" aria-label="Close" style="background:none;border:none;color:var(--tx1);font-size:16px;cursor:pointer;padding:4px 8px">✕</button>
    </div>
    <div class="splash-edit-body">
      <div class="settings-section-lbl">App-entry welcome</div>
      <div class="settings-row">
        <span class="settings-row-label">Show on load</span>
        ${toggle('intro')}
      </div>
      <div class="se-note">Shown once when a player loads in, after the access code.</div>
      <div class="${introOff?'se-disabled':''}">
        ${field('intro','kicker','Small line above',"Aurelian System")}
        ${field('intro','title','Title',"WELCOME TRAVELLER")}
        ${field('intro','sub','Subtitle',"May the stars ever be full of wonder.")}
        ${field('intro','hint','Bottom hint',"Tap anywhere to begin")}
        ${previewBtn('intro')}
      </div>

      <div class="settings-section-lbl" style="margin-top:14px">Per-system welcome</div>
      <div class="settings-row">
        <span class="settings-row-label">Show when entering a system</span>
        ${toggle('system')}
      </div>
      <div class="se-note">Shown each time anyone enters a system from the galaxy. The system's own name is always the title.</div>
      <div class="${sysOff?'se-disabled':''}">
        ${field('system','kicker','Small line above name',"(optional)")}
        ${field('system','sub','Subtitle',"Welcome Traveller")}
        ${field('system','hint','Bottom hint',"Tap anywhere to continue")}
        ${previewBtn('system')}
      </div>
    </div>
    <div class="splash-edit-footer">
      <button class="se-reset" onclick="resetSplashDraft()">Reset to defaults</button>
      <button class="se-cancel" onclick="closeSplashEditor()">Cancel</button>
      <button class="se-save" onclick="saveSplashEditor()">Save</button>
    </div>`;
}


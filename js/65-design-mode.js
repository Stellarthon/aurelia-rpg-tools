// ═══════════════════════════════════════════════════════════════════════════
// DESIGN MODE — STAGE 1: simple text field overrides
// ═══════════════════════════════════════════════════════════════════════════
// Scope: read-aloud text, referee description/context, and referee notes
// fields on station areas/subs and Aurelia locations. Skill checks, timed
// events, and NPC stat-block rows are NOT covered yet — those are
// structurally different (nested arrays of objects, not plain strings) and
// are a deliberate later stage rather than part of this first pass.
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
    const res = await supaStorage.get('content-overrides', true);
    contentOverrides = res.value != null ? JSON.parse(res.value) : {};
  } catch(e){ contentOverrides = {}; }
  try {
    const res2 = await supaStorage.get('content-history', true);
    contentHistory = res2.value != null ? JSON.parse(res2.value) : {};
  } catch(e){ contentHistory = {}; }
  try {
    const res3 = await supaStorage.get('content-additions', true);
    contentAdditions = res3.value != null ? JSON.parse(res3.value) : {};
  } catch(e){ contentAdditions = {}; }
  try {
    const res4 = await supaStorage.get('content-deletions', true);
    contentDeletions = res4.value != null ? JSON.parse(res4.value) : {};
  } catch(e){ contentDeletions = {}; }
}

async function saveContentOverrides(){
  try { await supaStorage.set('content-overrides', JSON.stringify(contentOverrides), true); }
  catch(e){ console.error('Content override save failed', e); }
}

async function saveContentHistory(){
  try { await supaStorage.set('content-history', JSON.stringify(contentHistory), true); }
  catch(e){ console.error('Content history save failed', e); }
}

async function saveContentAdditions(){
  try { await supaStorage.set('content-additions', JSON.stringify(contentAdditions), true); }
  catch(e){ console.error('Content additions save failed', e); }
}

async function saveContentDeletions(){
  try { await supaStorage.set('content-deletions', JSON.stringify(contentDeletions), true); }
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
  try { const r = await supaStorage.get('body-additions', true); bodyAdditions = r.value != null ? JSON.parse(r.value) : {}; }
  catch(e){ bodyAdditions = {}; }
  try { const r = await supaStorage.get('body-deletions', true); bodyDeletions = r.value != null ? JSON.parse(r.value) : {}; }
  catch(e){ bodyDeletions = {}; }
  try { const r = await supaStorage.get('body-prop-overrides', true); bodyPropertyOverrides = r.value != null ? JSON.parse(r.value) : {}; }
  catch(e){ bodyPropertyOverrides = {}; }
}
async function saveBodyAdditions(){
  try { await supaStorage.set('body-additions', JSON.stringify(bodyAdditions), true); }
  catch(e){ console.error('Body additions save failed', e); }
}
async function saveBodyDeletions(){
  try { await supaStorage.set('body-deletions', JSON.stringify(bodyDeletions), true); }
  catch(e){ console.error('Body deletions save failed', e); }
}
async function saveBodyPropertyOverrides(){
  try { await supaStorage.set('body-prop-overrides', JSON.stringify(bodyPropertyOverrides), true); }
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
  return ((BASE_LOCATIONS[sysId] || {})[bodyId]) || [];
}

async function loadLocationStores(){
  try { const r = await supaStorage.get('location-additions', true); locationAdditions = r.value != null ? JSON.parse(r.value) : {}; }
  catch(e){ locationAdditions = {}; }
  try { const r = await supaStorage.get('location-deletions', true); locationDeletions = r.value != null ? JSON.parse(r.value) : {}; }
  catch(e){ locationDeletions = {}; }
  try { const r = await supaStorage.get('location-prop-overrides', true); locationPropertyOverrides = r.value != null ? JSON.parse(r.value) : {}; }
  catch(e){ locationPropertyOverrides = {}; }
}
async function saveLocationAdditions(){
  try { await supaStorage.set('location-additions', JSON.stringify(locationAdditions), true); }
  catch(e){ console.error('Location additions save failed', e); }
}
async function saveLocationDeletions(){
  try { await supaStorage.set('location-deletions', JSON.stringify(locationDeletions), true); }
  catch(e){ console.error('Location deletions save failed', e); }
}
async function saveLocationPropertyOverrides(){
  try { await supaStorage.set('location-prop-overrides', JSON.stringify(locationPropertyOverrides), true); }
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


// Resolves the text actually shown for a given key — override if one
// exists, otherwise the original hardcoded value passed in.
function resolveContent(key, originalText){
  return Object.prototype.hasOwnProperty.call(contentOverrides, key) ? contentOverrides[key] : originalText;
}

const DESIGN_MODE_CODE = 'ilovetwix2012!';

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


// ═══════════════════════════════════════════════════════════════════════════
// NPC LOCATION TRACKER
// ═══════════════════════════════════════════════════════════════════════════
// npcLocations: { [npcKey]: { area, sub, note, schedule: [{id,mins,area,sub,note}] } }
// npcKey = sanitised NPC name (lowercase, spaces→underscore)
// Stored in localStorage only — referee-side state.

let npcLocations = {};
let npcLocEditorOpen = null;   // npcKey currently editing, or null
let npcSchedFormOpen = null;   // npcKey whose add-schedule form is open

const NPC_LOC_KEY = 'aurelia_npc_locations';

function npcKey(name){ return name.toLowerCase().replace(/[^a-z0-9]/g,'_'); }

function npcLocLoad(){
  try {
    const raw = localStorage.getItem(NPC_LOC_KEY);
    if(raw) npcLocations = JSON.parse(raw);
  } catch(e){ npcLocations = {}; }
}

function npcLocSave(){
  try { localStorage.setItem(NPC_LOC_KEY, JSON.stringify(npcLocations)); }
  catch(e){}
}

// ── Area label helpers ────────────────────────────────────────────────────

const NPC_AREA_OPTIONS = [
  { value:'',             label:'— Unknown / off-station —' },
  { value:'elevator',     label:'Space Elevator' },
  { value:'docking',      label:'Docking Hub' },
  { value:'docking|landing-pad',       label:'  ↳ Landing Pad — Bay 15' },
  { value:'docking|dockmaster-office', label:'  ↳ Dockmaster\'s Office' },
  { value:'concourse',    label:'Main Concourse' },
  { value:'concourse|promenade',   label:'  ↳ Promenade' },
  { value:'concourse|stellarview', label:'  ↳ Stellarview Bar & Lounge' },
  { value:'concourse|exchange',    label:'  ↳ The Exchange' },
  { value:'concourse|dome',        label:'  ↳ Observation Dome' },
  { value:'security',     label:'Security & Administration' },
  { value:'security|guardhouse',  label:'  ↳ Guardhouse' },
  { value:'security|armoury',     label:'  ↳ Armoury' },
  { value:'security|admin-a',     label:'  ↳ Administration Block A' },
  { value:'security|admin-b',     label:'  ↳ Administration Block B' },
  { value:'medical',      label:'Medical Suite' },
  { value:'maintenance',  label:'Maintenance Level' },
  { value:'maintenance|life-support',   label:'  ↳ Life Support' },
  { value:'maintenance|reactor',        label:'  ↳ Reactor Level' },
  { value:'maintenance|manufacturing',  label:'  ↳ Manufacturing Level' },
];

function npcAreaLabel(area, sub){
  if(!area) return 'Location unknown';
  const key = sub ? area + '|' + sub : area;
  const opt = NPC_AREA_OPTIONS.find(o => o.value === key);
  return opt ? opt.label.trim() : area;
}

function npcAreaSelectHTML(selectedArea, selectedSub, idPrefix){
  const val = selectedSub ? selectedArea + '|' + selectedSub : selectedArea;
  return NPC_AREA_OPTIONS.map(o =>
    `<option value="${o.value}"${o.value===val?' selected':''}>${o.label}</option>`
  ).join('');
}

function npcParseAreaValue(val){
  if(!val) return { area:'', sub:'' };
  const [area, sub=''] = val.split('|');
  return { area, sub };
}

// ── Render location badge (injected into NPC card header) ─────────────────

// ── NPC disposition (Hostile / Neutral / Friendly) ────────────────────────
// Stored on the npcLocations record so it persists with the NPC. Pairs with
// the Reaction table in the Rules sidebar.
function npcDispoBadgeHTML(name){
  const k = npcKey(name);
  const cur = (npcLocations[k] && npcLocations[k].dispo) || '';
  const opt = [
    {v:'hostile',  label:'Hostile',  cls:'npc-dispo-hostile'},
    {v:'neutral',  label:'Neutral',  cls:'npc-dispo-neutral'},
    {v:'friendly', label:'Friendly', cls:'npc-dispo-friendly'},
  ];
  return '<div class="npc-dispo-row" onclick="event.stopPropagation()">' +
    opt.map(o =>
      '<span class="npc-dispo-pill ' + o.cls + (cur === o.v ? ' active' : '') +
      '" onclick="setNpcDispo(\'' + k + '\',\'' + o.v + '\')">' + o.label + '</span>'
    ).join('') +
    '</div>';
}

function setNpcDispo(k, dispo){
  if(!npcLocations[k]) npcLocations[k] = { area:'', sub:'', note:'', schedule:[] };
  // Toggle off if tapping the active one
  npcLocations[k].dispo = (npcLocations[k].dispo === dispo) ? '' : dispo;
  npcLocSave();
  if(currentView === 'station') renderDetail();
}

function npcLocationBadgeHTML(name){
  const k = npcKey(name);
  const loc = npcLocations[k];
  if(!loc || !loc.area){
    return `<div class="npc-location-badge has-location" onclick="event.stopPropagation();toggleNpcLocEditor('${k}')">📍 Set location</div>`;
  }
  const label = npcAreaLabel(loc.area, loc.sub);
  const note = loc.note ? ` · ${loc.note}` : '';
  return `<div class="npc-location-badge has-location" id="npc-loc-badge-${k}" onclick="event.stopPropagation();toggleNpcLocEditor('${k}')" title="Click to update location">📍 ${label}${note}</div>`;
}

// ── Editor (rendered inline inside the npc-body) ──────────────────────────

function toggleNpcLocEditor(k){
  if(npcLocEditorOpen === k){
    npcLocEditorOpen = null;
  } else {
    npcLocEditorOpen = k;
    npcSchedFormOpen = null;
  }
  if(currentView === 'station') renderDetail();
}

function npcLocEditorHTML(name){
  const k = npcKey(name);
  if(npcLocEditorOpen !== k) return '';
  const loc = npcLocations[k] || { area:'', sub:'', note:'', schedule:[] };
  const areaVal = loc.sub ? loc.area + '|' + loc.sub : (loc.area || '');

  // Schedule entries
  const sched = (loc.schedule || []).sort((a,b) => a.mins - b.mins);
  const schedHTML = sched.length ? sched.map(e => {
    const h = Math.floor(e.mins/60).toString().padStart(2,'0');
    const m = (e.mins%60).toString().padStart(2,'0');
    const dest = npcAreaLabel(e.area, e.sub);
    const noteStr = e.note ? ` <span style="color:var(--tx1);font-style:italic">(${e.note})</span>` : '';
    return `<div class="npc-sched-entry">
      <span class="npc-sched-time">${h}:${m}</span>
      <span class="npc-sched-dest">${dest}${noteStr}</span>
      <button class="npc-sched-del" onclick="npcSchedDelete('${k}','${e.id}')" title="Remove">✕</button>
    </div>`;
  }).join('') : '<div style="font-size:10px;color:var(--tx1);font-style:italic;padding:2px 0">No scheduled moves yet.</div>';

  // Add-entry form
  const addFormOpen = npcSchedFormOpen === k;
  const addForm = `
    <div class="npc-sched-add-form${addFormOpen ? ' open' : ''}" id="npc-sched-form-${k}">
      <div class="npc-loc-row">
        <div class="npc-loc-lbl">Time (HH:MM)</div>
        <input type="time" class="npc-sched-time-input" id="npc-sched-time-${k}" value="${(() => { const h=Math.floor(clockMinutes/60).toString().padStart(2,'0'); const m=(clockMinutes%60).toString().padStart(2,'0'); return h+':'+m; })()}">
      </div>
      <div class="npc-loc-row">
        <div class="npc-loc-lbl">Move to</div>
        <select class="npc-loc-select" id="npc-sched-area-${k}">
          ${npcAreaSelectHTML('', '', 'sched-'+k)}
        </select>
      </div>
      <div class="npc-loc-row">
        <div class="npc-loc-lbl">Note (optional)</div>
        <input type="text" class="npc-loc-note" id="npc-sched-note-${k}" placeholder="e.g. Heads to briefing" style="height:auto;padding:4px 7px">
      </div>
      <div class="npc-sched-form-row">
        <button class="npc-sched-commit" onclick="npcSchedAdd('${k}')">Add</button>
        <button class="npc-sched-cancel" onclick="npcSchedFormClose()">Cancel</button>
      </div>
    </div>`;

  return `
    <div class="npc-loc-editor open" id="npc-loc-editor-${k}">
      <div class="npc-loc-row">
        <div class="npc-loc-lbl">Current Location</div>
        <select class="npc-loc-select" id="npc-loc-area-${k}">
          ${npcAreaSelectHTML(loc.area, loc.sub, k)}
        </select>
      </div>
      <div class="npc-loc-row">
        <div class="npc-loc-lbl">Note (optional)</div>
        <textarea class="npc-loc-note" id="npc-loc-note-${k}" rows="1" placeholder="e.g. Waiting by the bar">${loc.note||''}</textarea>
      </div>
      <div class="npc-loc-btn-row">
        <button class="npc-loc-save" onclick="npcLocSaveEditor('${k}','${name.replace(/'/g,"\\\\'")}')">✓ Save location</button>
        <button class="npc-loc-clear" onclick="npcLocClear('${k}')">Clear</button>
      </div>

      <div class="npc-sched-section">
        <div class="npc-sched-lbl">
          <span>⏱ Schedule</span>
          <button class="npc-sched-add" onclick="npcSchedFormToggle('${k}')">+ Add move</button>
        </div>
        ${schedHTML}
        ${addForm}
      </div>
    </div>`;
}

// ── Save / clear current location ─────────────────────────────────────────

function npcLocSaveEditor(k, name){
  const selEl = document.getElementById('npc-loc-area-' + k);
  const noteEl = document.getElementById('npc-loc-note-' + k);
  if(!selEl) return;
  const { area, sub } = npcParseAreaValue(selEl.value);
  const note = noteEl ? noteEl.value.trim() : '';
  if(!npcLocations[k]) npcLocations[k] = { schedule:[] };
  npcLocations[k].area = area;
  npcLocations[k].sub  = sub;
  npcLocations[k].note = note;
  npcLocSave();
  npcLocEditorOpen = null;
  if(currentView === 'station') renderDetail();
  showToast('Location saved for ' + name);
}

function npcLocClear(k){
  if(npcLocations[k]){
    npcLocations[k].area = '';
    npcLocations[k].sub  = '';
    npcLocations[k].note = '';
  }
  npcLocSave();
  npcLocEditorOpen = null;
  if(currentView === 'station') renderDetail();
}

// ── Schedule CRUD ──────────────────────────────────────────────────────────

function npcSchedFormToggle(k){
  npcSchedFormOpen = npcSchedFormOpen === k ? null : k;
  if(currentView === 'station') renderDetail();
}

function npcSchedFormClose(){
  npcSchedFormOpen = null;
  if(currentView === 'station') renderDetail();
}

function npcSchedAdd(k){
  const timeEl = document.getElementById('npc-sched-time-' + k);
  const areaEl = document.getElementById('npc-sched-area-' + k);
  const noteEl = document.getElementById('npc-sched-note-' + k);
  if(!timeEl || !areaEl) return;
  const [hh, mm] = timeEl.value.split(':').map(Number);
  const mins = hh * 60 + mm;
  const { area, sub } = npcParseAreaValue(areaEl.value);
  const note = noteEl ? noteEl.value.trim() : '';
  if(!npcLocations[k]) npcLocations[k] = { area:'', sub:'', note:'', schedule:[] };
  if(!npcLocations[k].schedule) npcLocations[k].schedule = [];
  npcLocations[k].schedule.push({ id: 's'+Date.now(), mins, area, sub, note });
  npcLocSave();
  npcSchedFormOpen = null;
  if(currentView === 'station') renderDetail();
}

function npcSchedDelete(k, id){
  if(!npcLocations[k]) return;
  npcLocations[k].schedule = (npcLocations[k].schedule||[]).filter(e => e.id !== id);
  npcLocSave();
  if(currentView === 'station') renderDetail();
}

// ── Clock hook — called from checkTimedEvents ─────────────────────────────

function checkNpcSchedules(prevMins, newMins){
  let anyMoved = false;
  Object.entries(npcLocations).forEach(([k, loc]) => {
    if(!loc.schedule || !loc.schedule.length) return;
    loc.schedule.forEach(entry => {
      // Fire if clock crosses this entry's time
      const crossed = (prevMins < entry.mins && newMins >= entry.mins)
        || (newMins < prevMins && (entry.mins >= newMins || entry.mins <= prevMins)); // midnight wrap — simple: just check once per day
      if(crossed && (prevMins < entry.mins && newMins >= entry.mins)){
        loc.area = entry.area;
        loc.sub  = entry.sub;
        loc.note = entry.note || '';
        anyMoved = true;
        // Log it
        const dest = npcAreaLabel(entry.area, entry.sub);
        const nameGuess = k.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
        logEvent(`${nameGuess} → ${dest}${entry.note ? ' ('+entry.note+')' : ''}`, dest || 'Station');
      }
    });
  });
  if(anyMoved){
    npcLocSave();
    if(currentView === 'station') renderDetail();
  }
}

npcLocLoad();

// ═══════════════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════════════════════
// Stored as JSON in localStorage under 'aurelia_shortcuts'.
// Each binding: { id, label, defaultKey, key }
// 'key' is a string like "q", "Escape", "F2", "shift+r" etc.
// Modifier prefix order: ctrl+ > shift+ > alt+

const KBD_DEFAULTS = [
  { id:'qref',      label:'Open / close Quick Reference', defaultKey:'r' },
  { id:'quests',    label:'Open / close Mission Log',     defaultKey:'q' },
  { id:'settings',  label:'Open Settings',                defaultKey:',' },
  { id:'search',    label:'Focus search bar',             defaultKey:'/' },
  { id:'player',    label:'Toggle Traveller View',        defaultKey:'p' },
  { id:'clock1',    label:'Advance clock +1 min',         defaultKey:'1' },
  { id:'clock5',    label:'Advance clock +5 min',         defaultKey:'2' },
  { id:'clock15',   label:'Advance clock +15 min',        defaultKey:'3' },
  { id:'clockreset',label:'Reset clock',                  defaultKey:'0' },
  { id:'system',    label:'Go to System view',            defaultKey:'s' },
  { id:'station',   label:'Go to Station view',           defaultKey:'a' },
  { id:'lightmode', label:'Toggle light/dark mode',       defaultKey:'m' },
  { id:'tdisplay',  label:'Open table display',           defaultKey:'d' },
  { id:'tfollow',   label:'Table display: Follow / Hold', defaultKey:'f' },
  { id:'tsend',     label:'Send current view to table',   defaultKey:'t' },
  { id:'tblank',    label:'Table display: blank toggle',  defaultKey:'b' },
];

let kbdBindings = [];
let kbdListeningId = null;   // which binding is waiting for a key press

function kbdLoad(){
  try {
    const raw = localStorage.getItem('aurelia_shortcuts');
    if(raw){
      const saved = JSON.parse(raw);
      kbdBindings = KBD_DEFAULTS.map(d => {
        const found = saved.find(s => s.id === d.id);
        return { ...d, key: found ? found.key : d.defaultKey };
      });
    } else {
      kbdBindings = KBD_DEFAULTS.map(d => ({ ...d, key: d.defaultKey }));
    }
  } catch(e){
    kbdBindings = KBD_DEFAULTS.map(d => ({ ...d, key: d.defaultKey }));
  }
}

function kbdSave(){
  try {
    localStorage.setItem('aurelia_shortcuts', JSON.stringify(
      kbdBindings.map(b => ({ id: b.id, key: b.key }))
    ));
  } catch(e){}
}

function kbdReset(){
  kbdBindings = KBD_DEFAULTS.map(d => ({ ...d, key: d.defaultKey }));
  kbdSave();
  renderSettingsMenu(isReferee());
}

function kbdKeyLabel(key){
  if(!key) return '—';
  // Make modifiers look nice
  return key.replace('ctrl+','Ctrl+').replace('shift+','⇧').replace('alt+','Alt+');
}

function kbdStartListen(id){
  kbdListeningId = id;
  renderSettingsMenu(isReferee());
}

function kbdOnKeyForRebind(e){
  if(!kbdListeningId) return;
  e.preventDefault();
  e.stopPropagation();

  // Ignore bare modifiers
  if(['Control','Shift','Alt','Meta'].includes(e.key)) return;
  if(e.key === 'Escape'){
    kbdListeningId = null;
    renderSettingsMenu(isReferee());
    return;
  }

  let combo = '';
  if(e.ctrlKey)  combo += 'ctrl+';
  if(e.shiftKey) combo += 'shift+';
  if(e.altKey)   combo += 'alt+';
  combo += e.key.length === 1 ? e.key.toLowerCase() : e.key;

  const b = kbdBindings.find(x => x.id === kbdListeningId);
  if(b) b.key = combo;
  kbdListeningId = null;
  kbdSave();
  renderSettingsMenu(isReferee());
}

function kbdDispatch(e){
  if(DISPLAY_MODE) return; // the table TV is pointer-driven — panel/referee shortcuts stay off
  // Don't fire shortcuts when typing in an input/textarea
  const tag = document.activeElement?.tagName;
  if(tag === 'INPUT' || tag === 'TEXTAREA') return;
  // Don't fire if a modal overlay is open (settings, clock edit, etc.)
  // — except the settings shortcut itself should still close the menu
  const settingsOpen = !document.getElementById('settings-menu').classList.contains('hidden');

  let combo = '';
  if(e.ctrlKey)  combo += 'ctrl+';
  if(e.shiftKey) combo += 'shift+';
  if(e.altKey)   combo += 'alt+';
  combo += e.key.length === 1 ? e.key.toLowerCase() : e.key;

  const match = kbdBindings.find(b => b.key === combo);
  if(!match) return;

  // If rebind listener is active, let kbdOnKeyForRebind handle it instead
  if(kbdListeningId) return;

  e.preventDefault();

  switch(match.id){
    case 'qref':       toggleQref(); break;
    case 'quests':     toggleQuestPanel(); break;
    case 'settings':
      if(settingsOpen) closeSettingsMenu(); else openSettingsMenu(); break;
    case 'search':
      document.getElementById('search-input')?.focus(); break;
    case 'player':     togglePM(); break;
    case 'clock1':     advanceClock(1); break;
    case 'clock5':     advanceClock(5); break;
    case 'clock15':    advanceClock(15); break;
    case 'clockreset': resetClock(); break;
    case 'system':     if(currentView !== 'system') goSystem(); break;
    case 'station':    if(currentView !== 'station') enterStation(); break;
    case 'lightmode':  toggleLightMode(); break;
    // Table display cluster (js/93) — referee-only inside; keypress counts as
    // the user gesture window.open needs.
    case 'tdisplay':   if(typeof displayOpenWindow === 'function' && isReferee()) displayOpenWindow(); break;
    case 'tfollow':    if(typeof displayToggleFollow === 'function' && isReferee()) displayToggleFollow(); break;
    case 'tsend':      if(typeof displaySendView === 'function' && isReferee()) displaySendView(); break;
    case 'tblank':     if(typeof displayToggleBlank === 'function' && isReferee()) displayToggleBlank(); break;
  }
}

// Render the shortcuts table for the settings menu (called from renderSettingsMenu)
function kbdSettingsHTML(){
  const rows = kbdBindings.map(b => {
    const listening = kbdListeningId === b.id;
    return `
      <div class="kbd-row">
        <span class="kbd-action">${b.label}</span>
        <div class="kbd-binding">
          <span class="kbd-key">${kbdKeyLabel(b.key)}</span>
          <button class="kbd-rebind-btn${listening ? ' listening' : ''}"
            onclick="kbdStartListen('${b.id}')">
            ${listening ? 'press key…' : 'rebind'}
          </button>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="settings-section-lbl">Keyboard Shortcuts</div>
    ${rows}
    <button class="kbd-reset-all" onclick="kbdReset()">↺ Reset all to defaults</button>`;
}

// Wire up the global keydown listener
document.addEventListener('keydown', e => {
  if(kbdListeningId){
    kbdOnKeyForRebind(e);
  } else {
    kbdDispatch(e);
  }
});

kbdLoad();
// ── First-run keyboard shortcut hint ──────────────────────────────────────
// Surfaces the existence of shortcuts once, so they're discoverable without
// forcing the user to open Settings. Shows a single toast on first load.
(function showShortcutHintOnce(){
  try {
    if(DISPLAY_MODE) return; // don't burn the one-time hint (or write the flag) from the table TV
    if(localStorage.getItem('aurelia_kbd_hint_seen') === '1') return;
    // Delay so it doesn't collide with load
    setTimeout(() => {
      if(typeof showToast === 'function'){
        showToast('Tip: press R for Rules, Q for Quests, / to search. Rebind in Settings.', 'info');
        try { localStorage.setItem('aurelia_kbd_hint_seen', '1'); } catch(e){}
      }
    }, 1800);
  } catch(e){}
})();

loadArchonLog(); // archon tracker is localStorage-only, no Supabase, renders on-demand in Settings
renderEventLog();
renderRsrMarkers();

// ── Referee trackers: collapsed-by-default + tidy bottom-left stack ──────────
// The Event Log, NPC Status, and Initiative panels are persistently visible in
// referee mode. Left expanded, three tall panels buried the map and the docked
// right-hand detail panel and overlapped each other on tablets. Apply the saved
// (default: collapsed) state to each, then stack their compact bars up the
// bottom-left corner, clear of the right-hand detail. A panel the referee has
// dragged (saved panelpos_) keeps its own placement. Runs once at boot; the
// collapse booleans are seeded from the same localStorage keys in files 40/45.
(function tidyTrackers(){
  const collapsed = (k) => { try { const v = localStorage.getItem(k); return v==null ? true : v==='1'; } catch(e){ return true; } };
  const defs = [
    { id:'event-log-wrap', body:'event-log-body', foot:null,        tgl:'event-log-toggle', key:'aurelia_evlog_collapsed'  },
    { id:'health-wrap',    body:'health-body',    foot:null,        tgl:'health-toggle',    key:'aurelia_health_collapsed' },
    { id:'init-wrap',      body:'init-body',      foot:'init-foot', tgl:'init-toggle',      key:'aurelia_init_collapsed'   },
  ];
  defs.forEach(d => {
    const el = document.getElementById(d.id);
    if(el && collapsed(d.key)){
      el.classList.add('panel-collapsed');
      const b = document.getElementById(d.body); if(b) b.classList.add('collapsed');
      if(d.foot){ const f = document.getElementById(d.foot); if(f) f.classList.add('collapsed'); }
      const t = document.getElementById(d.tgl); if(t) t.textContent = '▲';
    }
  });
  let bottom = 8;
  defs.forEach(d => {
    const el = document.getElementById(d.id);
    if(!el) return;
    if(localStorage.getItem('panelpos_' + d.id)) return;   // respect a dragged placement
    el.style.left = '8px'; el.style.right = 'auto'; el.style.top = 'auto'; el.style.bottom = bottom + 'px';
    bottom += el.offsetHeight + 8;                          // stack by actual (usually collapsed) height
  });
})();

// ── Accessibility: label icon controls + make click-only rows keyboard-operable ──
// The UI renders interactive controls as innerHTML strings; hundreds of icon-only
// buttons and onclick <tr>/<div> rows ship without ARIA. Rather than hand-annotate
// every call site, enhance the DOM as it renders: derive an aria-label from existing
// title text for unlabelled / glyph-only controls, and give clickable NON-native
// elements (tr, div, td, span…) button semantics + Enter/Space activation so they're
// reachable by keyboard. Semantics only — no styling is changed. SVG nodes (the map /
// orrery, which can emit hundreds of dots) are deliberately skipped to avoid a tab trap.
const A11Y_SVG_NS = 'http://www.w3.org/2000/svg';
const A11Y_NATIVE = { BUTTON:1, A:1, INPUT:1, SELECT:1, TEXTAREA:1, LABEL:1, SUMMARY:1, OPTION:1 };
function a11yKeyActivate(e){
  if(e.target !== e.currentTarget) return;                 // let nested controls handle their own keys
  if(e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar'){
    e.preventDefault();
    e.currentTarget.click();
  }
}
function a11yEnhanceEl(el){
  if(!el || el.nodeType !== 1 || el.namespaceURI === A11Y_SVG_NS) return;
  if(el.getAttribute('data-a11y')) return;
  el.setAttribute('data-a11y','1');
  // Label glyph-only / unlabelled controls from their tooltip text.
  if(!el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')){
    const txt = (el.textContent || '').trim();
    const hasWords = /[a-z0-9]/i.test(txt);              // emoji/✕/▲ etc. don't count as an accessible name
    const imgAlt = el.querySelector && el.querySelector('img[alt]:not([alt=""])');
    if(!hasWords && !imgAlt){
      const t = el.getAttribute('title');
      if(t) el.setAttribute('aria-label', t);
    }
  }
  // Non-native clickable elements: make them focusable + behave like a button.
  if(!A11Y_NATIVE[el.tagName]){
    if(!el.hasAttribute('role')) el.setAttribute('role','button');
    if(!el.hasAttribute('tabindex')) el.setAttribute('tabindex','0');
    el.addEventListener('keydown', a11yKeyActivate);
  }
}
function a11yEnhance(root){
  if(!root || root.nodeType !== 1 || root.namespaceURI === A11Y_SVG_NS) return;
  if(root.matches && root.matches('[onclick]')) a11yEnhanceEl(root);
  if(root.querySelectorAll) root.querySelectorAll('[onclick]:not([data-a11y])').forEach(a11yEnhanceEl);
}
(function initA11y(){
  if(typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  const initial = () => { try { a11yEnhance(document.body); } catch(e){} };
  if(document.body) initial(); else document.addEventListener('DOMContentLoaded', initial);
  let queue = [], pending = false;
  const flush = () => { pending = false; const q = queue; queue = [];
    q.forEach(n => { try { if(n.isConnected) a11yEnhance(n); } catch(e){} }); };
  const obs = new MutationObserver(muts => {
    muts.forEach(m => m.addedNodes && m.addedNodes.forEach(n => {
      if(n.nodeType === 1 && n.namespaceURI !== A11Y_SVG_NS) queue.push(n); }));
    if(queue.length && !pending){ pending = true; requestAnimationFrame(flush); }
  });
  const start = () => { if(document.body) obs.observe(document.body, { childList:true, subtree:true }); };
  if(document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();

// --- Relocated from the 30-system-body.js boot block (load-order fix) ---
// Start shared-state / alert / combat polling for a returning player-mode device
// AFTER files 55/75/80 have defined start*Polling(). Classic <script> tags do not
// hoist a later file's function declarations across the file boundary, so this must
// run last (see docs/ARCHITECTURE.md, the load-order rule).
try { if(localStorage.getItem("aurelia_pm")==="1"){ startPolling(); startAlertPolling(); startCombatPolling(); } } catch(e){}

// ── Background starfield ────────────────────────────────────────────────────
// Decorative only: fills #starfield with a mix of static and slowly twinkling
// dots so every view sits over a subtle star field. Runs once at boot; the
// dots are percentage-positioned so they reflow with the viewport for free.
(function buildStarfield(){
  const host = document.getElementById('starfield');
  if(!host || host.childElementCount) return;
  const N = 150;
  const bits = [];
  for(let i = 0; i < N; i++){
    const x  = (Math.random() * 100).toFixed(2);
    const y  = (Math.random() * 100).toFixed(2);
    const sz = (Math.random() * 1.8 + 0.6).toFixed(2);
    const op = (Math.random() * 0.5 + 0.35).toFixed(2);
    // ~55% twinkle, the rest sit static and dim to give the field some depth.
    if(Math.random() < 0.55){
      const dur = (Math.random() * 5 + 2.5).toFixed(2);
      const delay = (Math.random() * 6).toFixed(2);
      bits.push(`<span class="star" style="left:${x}%;top:${y}%;width:${sz}px;height:${sz}px;animation-duration:${dur}s;animation-delay:-${delay}s"></span>`);
    } else {
      bits.push(`<span class="star" style="left:${x}%;top:${y}%;width:${sz}px;height:${sz}px;animation:none;opacity:${op}"></span>`);
    }
  }
  host.innerHTML = bits.join('');
})();

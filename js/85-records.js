// ═══════════════════════════════════════════════════════════════════════════
// IMPERIAL CALENDAR  (V1 — the campaign-date spine)
// ───────────────────────────────────────────────────────────────────────────
// Distinct from the intra-day station clock (clockMinutes / HH:MM): this is the
// campaign-scale Traveller Imperial date, written DDD-YYYY (e.g. 114-1105). It
// is the *source of truth* other features timestamp against — reputation
// milestones {day,year}, discovery reveals — so it ships with a small public
// API (imperialNow / formatImperial / imperialOrdinal / addImperialDays) for
// them to compare and sort dates. Shared state in aurelia_state:
//   'imperial-date'    → {day, year}
//   'campaign-events'  → [{id, day, year, title, note, visibleTo}]
// Referee advances the date (a jump = +1 week); players read it and poll for
// changes on the existing 4s loop. Event visibility is gated by canSee().
// ═══════════════════════════════════════════════════════════════════════════

const IMPERIAL_YEAR_DAYS = 365;
const IMPERIAL_WEEKDAYS = ['Wonday','Tuday','Thirday','Forday','Fiveday','Sixday','Senday'];

// Starting Imperial date. The deployed campaign config (config.js →
// window.AURELIA_CONFIG.imperialStart) sets the initial value; the shared
// 'imperial-date' row in Supabase still overrides it via loadImperialDate()
// once a campaign is under way.
let imperialDate = (function(){
  const d = { day: 1, year: 1105 };
  try {
    const s = (typeof window !== 'undefined' && window.AURELIA_CONFIG && window.AURELIA_CONFIG.imperialStart) || null;
    if(s && Number.isFinite(+s.day) && Number.isFinite(+s.year)){ d.day = +s.day; d.year = +s.year; }
  } catch(e){}
  return d;
})();
let campaignEvents = [];
let calPanelOpen = false;
let calCollapsed = false;

// ── Public date API (used by other features) ──
function imperialNow(){ return { day: imperialDate.day, year: imperialDate.year }; }
function imperialOrdinal(d){ return (d.year * IMPERIAL_YEAR_DAYS) + (d.day - 1); } // absolute day index
function ordinalToImperial(n){ return { year: Math.floor(n / IMPERIAL_YEAR_DAYS), day: (n % IMPERIAL_YEAR_DAYS) + 1 }; }
function addImperialDays(d, n){ return ordinalToImperial(imperialOrdinal(d) + n); }
// Presentation is Campaign Pack config (pkCalendar, js/05): the {day, year}
// spine is universal bookkeeping; how a date READS belongs to the setting.
// Tokens: {ddd} zero-padded day-of-year · {dd} · {d} · {yyyy} · {yy}.
function formatImperial(d){
  const cal = (typeof pkCalendar === 'function') ? pkCalendar() : null;
  const fmt = (cal && cal.format) || '{ddd}-{yyyy}';
  return fmt.replace(/{ddd}/g, String(d.day).padStart(3,'0'))
            .replace(/{dd}/g, String(d.day).padStart(2,'0'))
            .replace(/{d}/g, String(d.day))
            .replace(/{yyyy}/g, String(d.year))
            .replace(/{yy}/g, String(Math.abs(d.year) % 100).padStart(2,'0'));
}
function calendarChip(){ const cal = (typeof pkCalendar === 'function') ? pkCalendar() : null; return (cal && cal.chip != null) ? cal.chip : 'IMP'; }
function calendarEra(){ const cal = (typeof pkCalendar === 'function') ? pkCalendar() : null; return (cal && cal.era != null) ? cal.era : 'Imperial'; }
function imperialWeekday(d){
  const cal = (typeof pkCalendar === 'function') ? pkCalendar() : null;
  const wd = (cal && Array.isArray(cal.weekdays) && cal.weekdays.length === 7) ? cal.weekdays : IMPERIAL_WEEKDAYS;
  return d.day === 1 ? 'Holiday' : wd[(d.day - 2) % 7];
}

// ── Persistence + sync ──
async function loadImperialDate(){
  try { const r = await supaStorage.get('imperial-date', true);
    if(r.value != null) imperialDate = Object.assign(imperialDate, JSON.parse(r.value)); } catch(e){}
}
async function saveImperialDate(){
  try { await supaStorage.set('imperial-date', JSON.stringify(imperialDate), true); }
  catch(e){ console.error('Imperial date save failed:', e); }
}
async function loadCampaignEvents(){
  try { const r = await supaStorage.get('campaign-events', true);
    if(r.value != null) campaignEvents = JSON.parse(r.value) || []; } catch(e){ campaignEvents = []; }
}
async function saveCampaignEvents(){
  try { await supaStorage.set('campaign-events', JSON.stringify(campaignEvents), true); }
  catch(e){ console.error('Campaign events save failed:', e); }
}

// ── Header date chip ──
function renderImperialDate(){
  const el = document.getElementById('impdate-display');
  if(!el) return;
  const era = calendarEra();
  el.innerHTML = `<span class="impd-lbl">${escQH(calendarChip())}</span>${escQH(formatImperial(imperialDate))}`;
  el.title = imperialWeekday(imperialDate) + ' — Day ' + imperialDate.day + ', ' + imperialDate.year + (era ? ' ' + era : '');
}

// ── Date mutation (referee) ──
function advanceImperial(days){
  if(!isReferee()) return;
  imperialDate = addImperialDays(imperialDate, days);
  afterDateChange();
}
function setImperialFromInputs(){
  if(!isReferee()) return;
  const d = parseInt(document.getElementById('cal-set-day').value, 10) || 1;
  const y = parseInt(document.getElementById('cal-set-year').value, 10) || imperialDate.year;
  imperialDate = { day: Math.max(1, Math.min(IMPERIAL_YEAR_DAYS, d)), year: y };
  afterDateChange();
}
function afterDateChange(){
  renderImperialDate();
  if(calPanelOpen) renderCalendarPanel();
  if(typeof shipCostsOnDateChange === 'function') shipCostsOnDateChange();   // recurring ship costs accrue per 28-day period (js/91)
  if(typeof clocksOnDateChange === 'function') clocksOnDateChange();         // date-linked clocks prompt the referee (never auto-tick)
  if(typeof ECON!=='undefined'){ try { ECON.syncToDate(); } catch(e){}   // economy ticks in lockstep with the Imperial week
    if(typeof econPanelOpen!=='undefined' && econPanelOpen && typeof renderEconPanel==='function') renderEconPanel();
    if(typeof galnetRefresh==='function') galnetRefresh();               // refresh the live GalNet feed as the week advances
    if(currentView==='galaxy' && typeof HX!=='undefined') HX.refresh(); }
  saveImperialDate();
}

// ── Panel toggle / collapse (cloned from the quest panel) ──
function toggleCalendarPanel(){
  calPanelOpen = !calPanelOpen;
  const w = document.getElementById('cal-wrap'), b = document.getElementById('cal-btn');
  w.classList.toggle('hidden', !calPanelOpen);
  if(b) b.classList.toggle('panel-open', calPanelOpen);
  if(calPanelOpen) renderCalendarPanel();
}
function toggleCalCollapse(){
  if(document.getElementById('cal-header').dataset.suppressClick === '1') return;
  calCollapsed = !calCollapsed;
  document.getElementById('cal-toggle').textContent = calCollapsed ? '▲' : '▼';
  document.getElementById('cal-body').classList.toggle('collapsed', calCollapsed);
  document.getElementById('cal-wrap').classList.toggle('panel-collapsed', calCollapsed);
}

// ── Render ──
function calVisLabel(v){
  if(v === 'referee') return 'Ref';
  if(Array.isArray(v)) return v.map(n => n.split(' ')[0]).join('/') || 'None';
  return 'All';
}
function renderCalEvent(e, ref, nowOrd){
  const past = imperialOrdinal(e) <= nowOrd;
  const visTag = ref ? `<span class="cal-ev-vis" onclick="cycleCalEventVis('${e.id}')" title="Click to change who can see this">${calVisLabel(e.visibleTo)}</span>` : '';
  const del = ref ? `<span class="cal-ev-del" onclick="deleteCalEvent('${e.id}')" title="Delete event">✕</span>` : '';
  return `<div class="cal-ev${past ? ' past' : ''}">
    <span class="cal-ev-date">${formatImperial(e)}</span>
    <div class="cal-ev-body"><div class="cal-ev-title">${escQH(e.title)}</div>${e.note ? `<div class="cal-ev-note">${escQH(e.note)}</div>` : ''}</div>
    ${visTag}${del}
  </div>`;
}
function renderCalendarPanel(){
  const body = document.getElementById('cal-body');
  if(!body) return;
  const ref = isReferee();
  const now = imperialNow(), nowOrd = imperialOrdinal(now);

  const controls = ref ? `
    <div class="cal-controls">
      <button class="cal-btn-ctl" onclick="advanceImperial(-1)">− 1 Day</button>
      <button class="cal-btn-ctl" onclick="advanceImperial(1)">+ 1 Day</button>
      <button class="cal-btn-ctl wk" onclick="advanceImperial(7)" title="One jump ≈ one week">+ 1 Week ⟫</button>
    </div>
    <div class="cal-set-row">Set <input id="cal-set-day" type="number" min="1" max="365" value="${now.day}"> - <input id="cal-set-year" type="number" value="${now.year}"> <button class="cal-btn-ctl" onclick="setImperialFromInputs()">Go</button></div>` : '';

  const visible = campaignEvents.filter(e => ref || canSee(e.visibleTo))
    .slice().sort((a, b) => imperialOrdinal(a) - imperialOrdinal(b));
  let tl = '';
  if(!visible.length){
    tl = `<div class="cal-empty">${ref ? 'No campaign events yet. Add one below.' : 'No events recorded.'}</div>`;
  } else {
    let placedNow = false;
    visible.forEach(e => {
      if(!placedNow && imperialOrdinal(e) > nowOrd){
        tl += `<div class="cal-today-marker">◆ now · ${formatImperial(now)}</div>`;
        placedNow = true;
      }
      tl += renderCalEvent(e, ref, nowOrd);
    });
    if(!placedNow) tl += `<div class="cal-today-marker">◆ now · ${formatImperial(now)}</div>`;
  }

  const addForm = ref ? `
    <div class="cal-add">
      <input id="cal-new-title" placeholder="Event title…" maxlength="80">
      <div class="cal-add-row">
        <input id="cal-new-day" type="number" min="1" max="365" value="${now.day}" title="Day">
        <input id="cal-new-year" type="number" value="${now.year}" title="Year">
        <input id="cal-new-vis" placeholder="all / referee / Rhett Calder" title="Who can see it" style="flex:1">
      </div>
      <textarea id="cal-new-note" placeholder="Note (optional)…" rows="2"></textarea>
      <button class="cal-add-btn" onclick="addCalEvent()">+ Add to timeline</button>
    </div>` : '';

  body.innerHTML = `
    <div class="cal-now">
      <div class="cal-now-date">${escQH(formatImperial(now))}</div>
      <div class="cal-now-sub">${imperialWeekday(now)} · Day ${now.day} · ${now.year}${calendarEra() ? ' ' + escQH(calendarEra()) : ''}</div>
    </div>
    ${controls}
    <div class="cal-tl-title">Campaign Timeline</div>
    ${tl}
    ${addForm}`;
}

// ── Event CRUD (referee) ──
function parseCalVis(s){
  s = (s || '').trim();
  if(!s || s.toLowerCase() === 'all') return 'all';
  if(s.toLowerCase() === 'referee' || s.toLowerCase() === 'ref') return 'referee';
  return s.split(',').map(x => x.trim()).filter(Boolean);
}
function addCalEvent(){
  if(!isReferee()) return;
  const title = document.getElementById('cal-new-title').value.trim();
  if(!title) return;
  const day = Math.max(1, Math.min(IMPERIAL_YEAR_DAYS, parseInt(document.getElementById('cal-new-day').value, 10) || imperialDate.day));
  const year = parseInt(document.getElementById('cal-new-year').value, 10) || imperialDate.year;
  const note = document.getElementById('cal-new-note').value.trim();
  const visibleTo = parseCalVis(document.getElementById('cal-new-vis').value);
  campaignEvents.push({ id: 'ce_' + Date.now().toString(36), day, year, title, note, visibleTo });
  saveCampaignEvents();
  renderCalendarPanel();
}
function deleteCalEvent(id){
  if(!isReferee()) return;
  campaignEvents = campaignEvents.filter(e => e.id !== id);
  saveCampaignEvents();
  renderCalendarPanel();
}
function cycleCalEventVis(id){
  if(!isReferee()) return;
  const e = campaignEvents.find(x => x.id === id);
  if(!e) return;
  // all → referee → nav crew (Rhett + Cass) → all
  if(e.visibleTo === 'all') e.visibleTo = 'referee';
  else if(e.visibleTo === 'referee') e.visibleTo = ['Rhett Calder', 'Cassia Velen'];
  else e.visibleTo = 'all';
  saveCampaignEvents();
  renderCalendarPanel();
}
function calVisRaw(v){ if(v === 'referee') return 'referee'; if(Array.isArray(v)) return v.join(', '); return 'all'; }

// ═══════════════════════════════════════════════════════════════════════════
// DISCOVERY LOG / CODEX  (V1–V2 — "fog of knowledge")
// ───────────────────────────────────────────────────────────────────────────
// Generalises the reveal-status mechanic into three-stage fog on knowledge
// records. Each entry has a state: hidden (referee only) → rumoured (players
// see the title; the body is redacted) → known (players see the full body).
// Audience within rumoured/known is gated by canSee(). When the referee first
// lifts an entry out of hidden it is stamped revealedAt={day,year} from the
// Imperial calendar, so reveals can plot on the same campaign timeline.
// Shared state in aurelia_state key 'discovery-log'; players poll on the 4s loop.
// ═══════════════════════════════════════════════════════════════════════════

const DISC_CATEGORIES = [['lore','Lore'],['faction','Faction'],['location','Location'],['tech','Tech'],['person','Person']];

let discoveryLog = [];
let discPanelOpen = false;
let discCollapsed = false;
let discEditingId = null;

async function loadDiscoveryLog(){
  try { const r = await supaStorage.get('discovery-log', true); if(r.value != null) discoveryLog = JSON.parse(r.value) || []; }
  catch(e){ discoveryLog = []; }
}
async function saveDiscoveryLog(){
  try { await supaStorage.set('discovery-log', JSON.stringify(discoveryLog), true); }
  catch(e){ console.error('Discovery log save failed:', e); }
}

// Which fog stage does the CURRENT viewer see for this entry? null = not visible.
function discViewerStage(e){
  // pending = a player-submitted rumour awaiting referee moderation. Strictly
  // gated: only the referee (to approve/reject) and the author (to see it is
  // "awaiting") — never any other player, and never leaked into the fog.
  if(e.state === 'pending'){
    if(isReferee()) return 'pending';
    if(e.submittedBy && e.submittedBy === myIdentity) return 'pending';
    return null;
  }
  if(isReferee()) return 'known';
  if(e.state === 'hidden') return null;
  if(!canSee(e.visibleTo)) return null;
  return e.state; // 'rumoured' | 'known'
}
function discStateLabel(s){ return {hidden:'Hidden',rumoured:'Rumoured',known:'Known',pending:'Pending'}[s] || s; }

function toggleDiscoveryPanel(){
  discPanelOpen = !discPanelOpen;
  const w = document.getElementById('disc-wrap'), b = document.getElementById('disc-btn');
  w.classList.toggle('hidden', !discPanelOpen);
  if(b) b.classList.toggle('panel-open', discPanelOpen);
  if(discPanelOpen) renderDiscoveryPanel();
}
function toggleDiscCollapse(){
  if(document.getElementById('disc-header').dataset.suppressClick === '1') return;
  discCollapsed = !discCollapsed;
  document.getElementById('disc-toggle').textContent = discCollapsed ? '▲' : '▼';
  document.getElementById('disc-body').classList.toggle('collapsed', discCollapsed);
  document.getElementById('disc-wrap').classList.toggle('panel-collapsed', discCollapsed);
}

function renderDiscCard(e, ref){
  const stage = ref ? e.state : discViewerStage(e);
  const cat = DISC_CATEGORIES.find(c => c[0] === e.category);
  const catTag = `<span class="disc-cat cat-${e.category || 'lore'}">${cat ? cat[1] : (e.category || '')}</span>`;

  // Player-submitted rumour awaiting moderation: referee gets approve/reject;
  // the author sees only an "awaiting" marker; no one else reaches this card.
  if(stage === 'pending'){
    const who = escQH(e.submittedBy || 'a player');
    const bodyTxt = e.body ? escQH(e.body).replace(/\n/g,'<br>') : '';
    const ctl = ref
      ? `<div class="disc-ctl">
           <button class="disc-mini approve" onclick="approveRumour('${e.id}')" title="Approve → enters the fog as a rumour">✓ Approve</button>
           <button class="disc-mini del" onclick="rejectRumour('${e.id}')" title="Reject &amp; delete">✕ Reject</button>
         </div>`
      : `<div class="disc-pending-note">📥 Awaiting Referee</div>`;
    return `<div class="disc-card state-pending">
      <div class="disc-card-hd">${catTag}<span class="disc-title">${escQH(e.title)}</span></div>
      ${ref ? `<div class="disc-pending-by">Submitted by ${who}</div>` : ''}
      ${bodyTxt ? `<div class="disc-body-txt">${bodyTxt}</div>` : ''}
      ${ctl}
    </div>`;
  }

  let bodyHTML;
  if(!ref && stage === 'rumoured'){
    bodyHTML = `<span class="disc-redacted">▓▓▓ UNCONFIRMED — details unknown ▓▓▓</span>`;
  } else {
    bodyHTML = e.body ? escQH(e.body).replace(/\n/g,'<br>') : (ref ? '<span class="disc-redacted">(no body yet)</span>' : '');
  }
  const when = e.revealedAt ? `<span class="disc-when" title="Revealed">${formatImperial(e.revealedAt)}</span>` : '';
  const refCtl = ref ? `
    <div class="disc-ctl">
      <button class="disc-mini state-${e.state}" onclick="cycleDiscState('${e.id}')" title="Hidden → Rumoured → Known">${discStateLabel(e.state)}</button>
      <button class="disc-mini" onclick="cycleDiscVis('${e.id}')" title="Who can see it">${calVisLabel(e.visibleTo)}</button>
      <button class="disc-mini" onclick="editDiscEntry('${e.id}')" title="Edit">✏</button>
      <button class="disc-mini del" onclick="deleteDiscEntry('${e.id}')" title="Delete">✕</button>
    </div>` : '';
  return `<div class="disc-card state-${ref ? e.state : stage}">
    <div class="disc-card-hd">${catTag}<span class="disc-title">${escQH(e.title)}</span>${when}</div>
    ${bodyHTML ? `<div class="disc-body-txt">${bodyHTML}</div>` : ''}
    ${refCtl}
  </div>`;
}

function renderDiscForm(){
  const editing = discEditingId ? discoveryLog.find(e => e.id === discEditingId) : null;
  const catOpts = DISC_CATEGORIES.map(c => `<option value="${c[0]}"${editing && editing.category === c[0] ? ' selected' : ''}>${c[1]}</option>`).join('');
  const stateOpts = ['hidden','rumoured','known'].map(s => {
    const sel = editing ? (editing.state === s) : (s === 'hidden');
    return `<option value="${s}"${sel ? ' selected' : ''}>${discStateLabel(s)}</option>`;
  }).join('');
  return `<div class="disc-add">
    <div class="disc-add-ttl">${editing ? 'Edit entry' : 'New entry'}</div>
    <input id="disc-f-title" placeholder="Title…" maxlength="100" value="${editing ? escAttr(editing.title) : ''}">
    <div class="disc-add-row">
      <select id="disc-f-cat">${catOpts}</select>
      <select id="disc-f-state" title="Fog stage">${stateOpts}</select>
      <input id="disc-f-vis" placeholder="all / referee / Rhett Calder" value="${editing ? escAttr(calVisRaw(editing.visibleTo)) : ''}">
    </div>
    <textarea id="disc-f-body" rows="3" placeholder="Body / clue text…">${editing ? escQH(editing.body || '') : ''}</textarea>
    <div class="disc-add-row">
      <button class="cal-add-btn" style="flex:1" onclick="saveDiscEntry()">${editing ? 'Save changes' : '+ Add entry'}</button>
      ${editing ? `<button class="disc-mini" onclick="cancelDiscEdit()">Cancel</button>` : ''}
    </div>
  </div>`;
}

function renderDiscoveryPanel(){
  const body = document.getElementById('disc-body'); if(!body) return;
  const ref = isReferee();
  const visible = discoveryLog.filter(e => ref || discViewerStage(e));
  const countEl = document.getElementById('disc-count');
  if(countEl) countEl.textContent = visible.length;
  let list;
  if(!visible.length){
    list = `<div class="cal-empty">${ref ? 'No entries yet. Add lore, intel, or clues below.' : 'Nothing uncovered yet.'}</div>`;
  } else {
    // Order: known first, then rumoured, then hidden (referee view); within, keep insertion order.
    const rank = s => (s === 'pending' ? -1 : s === 'known' ? 0 : s === 'rumoured' ? 1 : 2);
    const sorted = visible.slice().sort((a, b) => rank(ref ? a.state : discViewerStage(a)) - rank(ref ? b.state : discViewerStage(b)));
    list = sorted.map(e => renderDiscCard(e, ref)).join('');
  }
  body.innerHTML = list + (ref ? renderDiscForm() : (myIdentity ? renderDiscSubmitForm() : ''));
}

function saveDiscEntry(){
  if(!isReferee()) return;
  const title = document.getElementById('disc-f-title').value.trim(); if(!title) return;
  const category = document.getElementById('disc-f-cat').value;
  const state = document.getElementById('disc-f-state').value;
  const visibleTo = parseCalVis(document.getElementById('disc-f-vis').value);
  const bodyTxt = document.getElementById('disc-f-body').value.trim();
  if(discEditingId){
    const e = discoveryLog.find(x => x.id === discEditingId);
    if(e){
      e.title = title; e.category = category; e.body = bodyTxt; e.visibleTo = visibleTo; e.state = state;
      if(state !== 'hidden' && !e.revealedAt) e.revealedAt = imperialNow();
    }
    discEditingId = null;
  } else {
    discoveryLog.push({
      id: 'disc_' + Date.now().toString(36), title, category, body: bodyTxt, state, visibleTo,
      createdAt: imperialNow(), revealedAt: state !== 'hidden' ? imperialNow() : null
    });
  }
  saveDiscoveryLog();
  renderDiscoveryPanel();
}
function editDiscEntry(id){ if(!isReferee()) return; discEditingId = id; renderDiscoveryPanel(); const f = document.getElementById('disc-f-title'); if(f) f.scrollIntoView({block:'nearest'}); }
function cancelDiscEdit(){ discEditingId = null; renderDiscoveryPanel(); }
function deleteDiscEntry(id){ if(!isReferee()) return; discoveryLog = discoveryLog.filter(e => e.id !== id); if(discEditingId === id) discEditingId = null; saveDiscoveryLog(); renderDiscoveryPanel(); }
function cycleDiscState(id){
  if(!isReferee()) return;
  const e = discoveryLog.find(x => x.id === id); if(!e) return;
  e.state = {hidden:'rumoured', rumoured:'known', known:'hidden'}[e.state] || 'hidden';
  if(e.state !== 'hidden' && !e.revealedAt) e.revealedAt = imperialNow(); // stamp first reveal
  saveDiscoveryLog();
  renderDiscoveryPanel();
}
function cycleDiscVis(id){
  if(!isReferee()) return;
  const e = discoveryLog.find(x => x.id === id); if(!e) return;
  if(e.visibleTo === 'all') e.visibleTo = 'referee';
  else if(e.visibleTo === 'referee') e.visibleTo = ['Rhett Calder', 'Cassia Velen'];
  else e.visibleTo = 'all';
  saveDiscoveryLog();
  renderDiscoveryPanel();
}

// ── Player-submitted rumours (the `pending` fog state) ─────────────────────
// An identified player may submit a rumour (title/category/body only — no
// state/visibility controls). It is stored `pending` and is invisible to every
// other player until the referee approves it (→ enters the fog as `rumoured`)
// or rejects it (deleted). Honour-system write, same as notes/funds.
function renderDiscSubmitForm(){
  const catOpts = DISC_CATEGORIES.map(c => `<option value="${c[0]}">${c[1]}</option>`).join('');
  return `<div class="disc-add">
    <div class="disc-add-ttl">Submit a rumour</div>
    <input id="disc-sub-title" placeholder="What did you hear?" maxlength="100">
    <div class="disc-add-row">
      <select id="disc-sub-cat">${catOpts}</select>
    </div>
    <textarea id="disc-sub-body" rows="2" placeholder="Details / where it came from…"></textarea>
    <div class="disc-add-row">
      <button class="cal-add-btn" style="flex:1" onclick="submitRumour()">📤 Submit to Referee</button>
    </div>
    <div class="disc-sub-hint">The referee reviews it before anyone else sees it.</div>
  </div>`;
}
function submitRumour(){
  if(isReferee() || !myIdentity) return;
  const t = document.getElementById('disc-sub-title'); if(!t) return;
  const title = t.value.trim(); if(!title) return;
  const category = document.getElementById('disc-sub-cat').value;
  const bodyTxt = document.getElementById('disc-sub-body').value.trim();
  discoveryLog.push({
    id: 'disc_' + Date.now().toString(36), title, category, body: bodyTxt,
    state: 'pending', submittedBy: myIdentity, visibleTo: 'all',
    createdAt: imperialNow(), revealedAt: null
  });
  saveDiscoveryLog();
  renderDiscoveryPanel();
  showToast('Rumour submitted to the Referee');
}
function approveRumour(id){
  if(!isReferee()) return;
  const e = discoveryLog.find(x => x.id === id); if(!e) return;
  e.state = 'rumoured';           // enters the shared fog as a rumour
  delete e.submittedBy;
  if(!e.revealedAt) e.revealedAt = imperialNow();
  saveDiscoveryLog();
  renderDiscoveryPanel();
  showToast('Rumour approved');
}
function rejectRumour(id){
  if(!isReferee()) return;
  discoveryLog = discoveryLog.filter(e => e.id !== id);
  saveDiscoveryLog();
  renderDiscoveryPanel();
  showToast('Rumour rejected', 'info');
}

// ═══════════════════════════════════════════════════════════════════════════
// NPC ROSTER  (Design Mode · standalone, browsable NPC library — referee)
// ───────────────────────────────────────────────────────────────────────────
// A library of NPCs that AREN'T tied to a station — recurring contacts, patrons,
// faction figures — authored + searched in one place, with a proper Traveller
// stat block (the character-sheet shape). The panel also lists every PLACED NPC
// (station/body sub-content, via buildSearchIndex) read-only with a jump-to, so
// the referee can find any NPC from one surface. Lore already has its own CRUD
// (the Library Data / discovery log), so this closes the last audit gap: NPCs as
// a first-class, browsable entity. Referee tool: loaded referee-only, never shown
// to players. Stored in aurelia_state 'npc-roster'.
let npcRoster = [];
let npcPanelOpen = false, npcCollapsed = false, npcEditingId = null, npcSearchQ = '';

async function loadNpcRoster(){
  if(typeof isReferee === 'function' && !isReferee()){ npcRoster = []; return; }   // referee tool — don't populate player memory
  try { const r = await supaStorage.get('npc-roster', true); npcRoster = (r.value != null ? JSON.parse(r.value) : []); if(!Array.isArray(npcRoster)) npcRoster = []; }
  catch(e){ npcRoster = []; }
}
async function saveNpcRoster(){ try { await supaStorage.set('npc-roster', JSON.stringify(npcRoster), true); } catch(e){ console.error('NPC roster save failed', e); } }
function npcById(id){ return npcRoster.find(n => n.id === id) || null; }
function emptyNpc(){ return { id:'npc_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5), name:'', role:'', faction:'', location:'', desc:'', str:7,dex:7,end:7,intl:7,edu:7,soc:7, skills:'', equipment:'', weapons:'', notes:'' }; }

function toggleNpcPanel(){
  if(!isReferee()){ if(typeof showToast==='function') showToast('Referee only','info'); return; }
  npcPanelOpen = !npcPanelOpen;
  const w = document.getElementById('npc-wrap'), b = document.getElementById('npc-btn');
  if(w) w.classList.toggle('hidden', !npcPanelOpen);
  if(b) b.classList.toggle('panel-open', npcPanelOpen);
  if(npcPanelOpen) renderNpcPanel();
}
function toggleNpcCollapse(){
  const h = document.getElementById('npc-header'); if(h && h.dataset.suppressClick === '1') return;
  npcCollapsed = !npcCollapsed;
  document.getElementById('npc-toggle').textContent = npcCollapsed ? '▲' : '▼';
  document.getElementById('npc-body').classList.toggle('collapsed', npcCollapsed);
  document.getElementById('npc-wrap').classList.toggle('panel-collapsed', npcCollapsed);
}
function npcSetSearch(v){ npcSearchQ = v; renderNpcPanel(); }

function npcRosterAdd(){ if(!isReferee()) return; const n = emptyNpc(); n.name = 'New NPC'; npcRoster.push(n); npcEditingId = n.id; saveNpcRoster(); renderNpcPanel(); }
function npcRosterDuplicate(id){ if(!isReferee()) return; const n = npcById(id); if(!n) return; const c = JSON.parse(JSON.stringify(n)); c.id = 'npc_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5); c.name = (n.name||'NPC')+' (copy)'; npcRoster.push(c); npcEditingId = c.id; saveNpcRoster(); renderNpcPanel(); }
function npcRosterRemove(id){ if(!isReferee()) return; if(!confirm('Remove this NPC from the roster?')) return; npcRoster = npcRoster.filter(n => n.id !== id); if(npcEditingId === id) npcEditingId = null; saveNpcRoster(); renderNpcPanel(); }
function npcEdit(id){ if(!isReferee()) return; npcEditingId = (npcEditingId === id ? null : id); renderNpcPanel(); }

// ── NPC roster → encounter (one-click add to the initiative tracker) ──
// Carries the whole stat block across so mid-fight adds need no retyping:
// DEX/INT DMs feed the initiative modifier fields, STR/DEX/END become the
// detailed damage bars, and skills/weapons/equipment land in the combatant
// notes. No dice are rolled — the score starts blank at 0; the referee taps
// it to reroll or reorders manually, per the tracker's existing controls.
function npcToEncounter(id){
  if(!isReferee()) return;
  const n = npcById(id); if(!n) return;
  if(typeof combatants === 'undefined' || typeof sortInitiative !== 'function') return;
  const dm = (typeof charDM === 'function') ? charDM : (() => 0);
  const raw = c => Math.max(1, parseInt(n[c]) || 7);
  const kit = [n.skills, n.weapons, n.equipment].filter(Boolean).join(' · ');
  combatants.push({
    id: combatantIdSeed++,
    name: n.name || 'NPC', score: 0,
    dex: dm(raw('dex')), int: dm(raw('intl')),
    ambush: null, down: false, notes: kit,
    healthMode: 'detailed',
    hp: 10, maxHp: 10,
    cStr: raw('str'), maxCStr: raw('str'),
    cDex: raw('dex'), maxCDex: raw('dex'),
    cEnd: raw('end'), maxCEnd: raw('end')
  });
  sortInitiative();
  if(typeof showToast === 'function') showToast((n.name || 'NPC') + ' added to the encounter — tap the score to roll initiative');
}
function npcEditField(id, field, value){ if(!isReferee()) return; const n = npcById(id); if(!n) return; const numeric = ['str','dex','end','intl','edu','soc']; n[field] = numeric.includes(field) ? (parseInt(value)||0) : value; saveNpcRoster(); }

function renderNpcCard(n){
  const ea = (typeof escQH==='function') ? escQH : (x=>String(x==null?'':x));
  const ea2 = (typeof escAttr==='function') ? (v=>escAttr(v==null?'':String(v))) : (v=>String(v==null?'':v));
  const editing = npcEditingId === n.id;
  const meta = [n.role, n.faction, n.location].filter(Boolean).map(ea).join(' · ');
  let hd = `<div class="disc-card-hd"><span class="disc-title">${ea(n.name||'(unnamed)')}</span>
    <div class="disc-ctl">
      <button class="disc-mini" onclick="npcToEncounter('${n.id}')" title="Add to encounter (initiative tracker)">⚔</button>
      <button class="disc-mini" onclick="npcEdit('${n.id}')" title="${editing?'Done':'Edit'}">${editing?'▾':'✏'}</button>
      <button class="disc-mini" onclick="npcRosterDuplicate('${n.id}')" title="Duplicate">⧉</button>
      <button class="disc-mini del" onclick="npcRosterRemove('${n.id}')" title="Remove">✕</button>
    </div></div>`;
  if(!editing){
    let b = hd; if(meta) b += `<div class="npc-meta">${meta}</div>`;
    if(n.desc) b += `<div class="disc-body-txt">${ea(n.desc).replace(/\n/g,'<br>')}</div>`;
    return `<div class="disc-card">${b}</div>`;
  }
  const chars = ['str','dex','end','intl','edu','soc'].map(c =>
    `<label>${c.toUpperCase()}<input type="number" value="${parseInt(n[c])||0}" onchange="npcEditField('${n.id}','${c}',this.value)"></label>`).join('');
  const ed = `<div class="disc-add">
    <input value="${ea2(n.name)}" placeholder="Name" onchange="npcEditField('${n.id}','name',this.value)">
    <div class="disc-add-row">
      <input value="${ea2(n.role)}" placeholder="Role / title" onchange="npcEditField('${n.id}','role',this.value)">
      <input value="${ea2(n.faction)}" placeholder="Faction" onchange="npcEditField('${n.id}','faction',this.value)">
    </div>
    <input value="${ea2(n.location)}" placeholder="Where found (system / station / world)" onchange="npcEditField('${n.id}','location',this.value)">
    <textarea rows="2" placeholder="Description" onchange="npcEditField('${n.id}','desc',this.value)">${ea(n.desc||'')}</textarea>
    <div class="npc-chars">${chars}</div>
    <input value="${ea2(n.skills)}" placeholder="Skills (e.g. Gun Combat 1, Persuade 2)" onchange="npcEditField('${n.id}','skills',this.value)">
    <input value="${ea2(n.equipment)}" placeholder="Equipment" onchange="npcEditField('${n.id}','equipment',this.value)">
    <input value="${ea2(n.weapons)}" placeholder="Weapons" onchange="npcEditField('${n.id}','weapons',this.value)">
    <textarea rows="2" placeholder="Referee notes" onchange="npcEditField('${n.id}','notes',this.value)">${ea(n.notes||'')}</textarea>
  </div>`;
  return `<div class="disc-card">${hd}${ed}</div>`;
}

function renderNpcPanel(){
  const body = document.getElementById('npc-body'); if(!body) return;
  if(!isReferee()){ body.innerHTML = '<div class="cal-empty">Referee only.</div>'; return; }
  const q = (npcSearchQ||'').trim().toLowerCase();
  const cnt = document.getElementById('npc-count'); if(cnt) cnt.textContent = npcRoster.length;
  const ros = npcRoster.filter(n => !q || [n.name,n.role,n.faction,n.location].some(x => (x||'').toLowerCase().includes(q)));
  // Every NPC placed in a station/body, via the existing search index (read-only).
  let placed = [];
  try { placed = buildSearchIndex().filter(it => it.type === 'NPC' && (!q || it.name.toLowerCase().includes(q))); } catch(e){}
  window._npcNavs = placed.map(p => p.nav);
  const searchBox = `<input class="npc-search" placeholder="🔍 Search NPCs…" value="${(typeof escAttr==='function')?escAttr(npcSearchQ):npcSearchQ}" oninput="npcSetSearch(this.value)">`;
  const rosHtml = ros.length
    ? ros.map(renderNpcCard).join('')
    : `<div class="cal-empty">${q ? 'No roster NPCs match.' : 'No NPCs yet. Add recurring contacts, patrons, or faction figures below.'}</div>`;
  const addBtn = `<button class="cal-add-btn" style="width:100%" onclick="npcRosterAdd()">+ New NPC</button>`;
  let placedHtml = '';
  if(placed.length){
    placedHtml = `<div class="disc-add-ttl" style="margin-top:8px">Placed in the world · ${placed.length}</div>` +
      placed.map((p,i) => `<div class="disc-card npc-jump" onclick="navigateToSearchResult(window._npcNavs[${i}])">
        <div class="disc-card-hd"><span class="disc-title">${escQH(p.name)}</span></div>
        <div class="npc-meta">${escQH(p.sub||'')} — tap to open</div></div>`).join('');
  }
  body.innerHTML = searchBox + rosHtml + addBtn + placedHtml;
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTION / COUNTDOWN CLOCKS
// ───────────────────────────────────────────────────────────────────────────
// Referee-authored progress clocks (4–12 segments, ticked up/down by hand)
// for faction schemes, looming threats and deadlines. Bookkeeping of tension
// only — nothing resolves automatically. Referee-only by default; a per-clock
// "reveal" shows it on players' devices as name + fill ONLY (referee notes
// and linked dates never render for players — spoiler control via canSee's
// honour-system model, like the rest of the app). A clock may be linked to
// an Imperial date: when the campaign date reaches it the referee is PROMPTED
// (toast + DUE badge) — the clock is never ticked automatically.
// Shared state in aurelia_state key 'clocks'; players ride the existing 4 s
// poll (js/55) — no new timers.
let clocks = [];
let clocksPanelOpen = false, clocksCollapsed = false, clocksEditingId = null;

async function loadClocks(){
  try { const r = await supaStorage.get('clocks', true); clocks = (r.value != null ? JSON.parse(r.value) : []); if(!Array.isArray(clocks)) clocks = []; }
  catch(e){ clocks = []; }
}
async function saveClocks(){ try { await supaStorage.set('clocks', JSON.stringify(clocks), true); } catch(e){ console.error('Clocks save failed', e); } }
function clockById(id){ return clocks.find(c => c.id === id) || null; }

function toggleClocksPanel(){
  clocksPanelOpen = !clocksPanelOpen;
  const w = document.getElementById('clocks-wrap'), b = document.getElementById('clocks-btn');
  if(w) w.classList.toggle('hidden', !clocksPanelOpen);
  if(b) b.classList.toggle('panel-open', clocksPanelOpen);
  if(clocksPanelOpen) renderClocksPanel();
}
function toggleClocksCollapse(){
  const h = document.getElementById('clocks-header'); if(h && h.dataset.suppressClick === '1') return;
  clocksCollapsed = !clocksCollapsed;
  document.getElementById('clocks-toggle').textContent = clocksCollapsed ? '▲' : '▼';
  document.getElementById('clocks-body').classList.toggle('collapsed', clocksCollapsed);
  document.getElementById('clocks-wrap').classList.toggle('panel-collapsed', clocksCollapsed);
}

function clockAdd(){
  if(!isReferee()) return;
  const c = { id:'clk_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5), name:'New clock', segments:6, filled:0, revealed:false, notes:'', due:null, duePrompted:false };
  clocks.push(c); clocksEditingId = c.id; saveClocks(); renderClocksPanel();
}
function clockRemove(id){ if(!isReferee()) return; if(!confirm('Remove this clock?')) return; clocks = clocks.filter(c => c.id !== id); if(clocksEditingId === id) clocksEditingId = null; saveClocks(); renderClocksPanel(); }
function clockEdit(id){ if(!isReferee()) return; clocksEditingId = (clocksEditingId === id ? null : id); renderClocksPanel(); }
function clockTick(id, dir){
  if(!isReferee()) return;
  const c = clockById(id); if(!c) return;
  c.filled = Math.max(0, Math.min(c.segments, (c.filled||0) + dir));
  saveClocks(); renderClocksPanel();
}
function clockToggleReveal(id){ if(!isReferee()) return; const c = clockById(id); if(!c) return; c.revealed = !c.revealed; saveClocks(); renderClocksPanel(); }
function clockEditField(id, field, value){
  if(!isReferee()) return;
  const c = clockById(id); if(!c) return;
  if(field === 'segments'){ c.segments = Math.max(2, Math.min(12, parseInt(value)||6)); c.filled = Math.min(c.filled||0, c.segments); }
  else c[field] = value;
  saveClocks(); renderClocksPanel();
}
function clockSetDue(id){
  if(!isReferee()) return;
  const c = clockById(id); if(!c) return;
  const d = parseInt((document.getElementById('clk-due-day-'+id)||{}).value, 10);
  const y = parseInt((document.getElementById('clk-due-year-'+id)||{}).value, 10);
  if(!isFinite(d) || !isFinite(y)) return;
  c.due = { day: Math.max(1, Math.min(IMPERIAL_YEAR_DAYS, d)), year: y };
  c.duePrompted = false;   // re-arm the prompt for the new date
  saveClocks(); renderClocksPanel();
}
function clockClearDue(id){ if(!isReferee()) return; const c = clockById(id); if(!c) return; c.due = null; c.duePrompted = false; saveClocks(); renderClocksPanel(); }

function clockIsDue(c){
  if(!c || !c.due) return false;
  try { return imperialOrdinal(imperialDate) >= imperialOrdinal(c.due); } catch(e){ return false; }
}
// Called from afterDateChange() — prompts the referee (never ticks) when a
// linked date arrives. Runs only on the device that advanced the date, which
// advanceImperial/setImperialFromInputs already gate to the referee.
function clocksOnDateChange(){
  if(typeof isReferee !== 'function' || !isReferee()) return;
  let dirty = false;
  clocks.forEach(c => {
    if(clockIsDue(c) && !c.duePrompted){
      c.duePrompted = true; dirty = true;
      if(typeof showToast === 'function') showToast('⏰ Clock due: "' + (c.name||'clock') + '" reached ' + formatImperial(c.due) + ' — advance it?', 'info');
    }
  });
  if(dirty) saveClocks();
  if(clocksPanelOpen) renderClocksPanel();
}

function clockSegmentsHTML(c){
  let cells = '';
  const seg = Math.max(1, c.segments||1), fill = Math.max(0, Math.min(seg, c.filled||0));
  for(let i = 0; i < seg; i++) cells += `<span class="clk-seg${i < fill ? ' fill' : ''}"></span>`;
  return `<div class="clk-track">${cells}</div>`;
}

function renderClockCardRef(c){
  const ea = (typeof escQH==='function') ? escQH : (x=>String(x==null?'':x));
  const ea2 = (typeof escAttr==='function') ? (v=>escAttr(v==null?'':String(v))) : (v=>String(v==null?'':v));
  const editing = clocksEditingId === c.id;
  const hd = `<div class="clk-hd">
    <span class="clk-name">${ea(c.name||'(unnamed)')}</span>
    <div class="disc-ctl">
      ${clockIsDue(c) ? '<span class="clk-due">DUE</span>' : ''}
      <button class="disc-mini${c.revealed?' clk-rev-on':''}" onclick="clockToggleReveal('${c.id}')" title="${c.revealed?'Revealed to players — tap to hide':'Hidden from players — tap to reveal (name + fill only)'}">${c.revealed?'👁':'🚫'}</button>
      <button class="disc-mini" onclick="clockEdit('${c.id}')" title="${editing?'Done':'Edit'}">${editing?'▾':'✏'}</button>
      <button class="disc-mini del" onclick="clockRemove('${c.id}')" title="Remove">✕</button>
    </div></div>`;
  const tick = `<div class="clk-ctl">
    <button class="disc-mini" onclick="clockTick('${c.id}',-1)" title="Tick back">−</button>
    <span class="clk-fill-lbl">${(c.filled||0)}/${c.segments}</span>
    <button class="disc-mini" onclick="clockTick('${c.id}',1)" title="Advance one segment">+</button>
    ${c.revealed ? '<span class="clk-fill-lbl" style="margin-left:auto">visible to players</span>' : ''}
  </div>`;
  let ed = '';
  if(editing){
    const segSel = [4,6,8,10,12].map(n=>`<option value="${n}"${c.segments===n?' selected':''}>${n} segments</option>`).join('');
    ed = `<div class="disc-add">
      <input value="${ea2(c.name)}" placeholder="Clock name (players see this when revealed)" onchange="clockEditField('${c.id}','name',this.value)">
      <select onchange="clockEditField('${c.id}','segments',this.value)">${segSel}</select>
      <div class="disc-add-row">
        <input type="number" inputmode="numeric" id="clk-due-day-${c.id}" placeholder="Day" min="1" max="${IMPERIAL_YEAR_DAYS}" value="${c.due?c.due.day:''}">
        <input type="number" inputmode="numeric" id="clk-due-year-${c.id}" placeholder="Year" value="${c.due?c.due.year:imperialDate.year}">
        <button class="disc-mini" onclick="clockSetDue('${c.id}')" title="Link to an Imperial date — you'll be prompted when it arrives (never auto-ticked)">📅</button>
        ${c.due?`<button class="disc-mini del" onclick="clockClearDue('${c.id}')" title="Unlink date">✕</button>`:''}
      </div>
      ${c.due?`<div class="npc-meta">Due ${formatImperial(c.due)} — you'll be prompted when the date arrives; nothing ticks itself.</div>`:''}
      <textarea rows="2" placeholder="Referee notes (never shown to players)" onchange="clockEditField('${c.id}','notes',this.value)">${ea(c.notes||'')}</textarea>
    </div>`;
  } else if(c.notes){
    ed = `<div class="npc-meta">${ea(c.notes).replace(/\n/g,'<br>')}</div>`;
  }
  return `<div class="clk-card">${hd}${clockSegmentsHTML(c)}${tick}${ed}</div>`;
}

function renderClocksPanel(){
  const body = document.getElementById('clocks-body'); if(!body) return;
  const ea = (typeof escQH==='function') ? escQH : (x=>String(x==null?'':x));
  const ref = (typeof isReferee === 'function') && isReferee();
  const visible = ref ? clocks : clocks.filter(c => c.revealed);
  const cnt = document.getElementById('clocks-count'); if(cnt) cnt.textContent = visible.length;
  if(!ref){
    // Players: revealed clocks only, name + fill. Notes and dates stay referee-side.
    body.innerHTML = visible.length
      ? visible.map(c => `<div class="clk-card">
          <div class="clk-hd"><span class="clk-name">${ea(c.name||'(unnamed)')}</span>
          <span class="clk-fill-lbl">${(c.filled||0)}/${c.segments}</span></div>
          ${clockSegmentsHTML(c)}</div>`).join('')
      : '<div class="cal-empty">Nothing the referee has chosen to show yet.</div>';
    return;
  }
  const addBtn = `<button class="cal-add-btn" style="width:100%" onclick="clockAdd()">+ New clock</button>`;
  body.innerHTML = (visible.length
    ? visible.map(renderClockCardRef).join('')
    : '<div class="cal-empty">No clocks yet. Track a faction scheme, a looming threat, or a deadline.</div>') + addBtn;
}

// ═══════════════════════════════════════════════════════════════════════════
// REPUTATION TRACKER  (V2 — faction standing + dated milestones)
// ───────────────────────────────────────────────────────────────────────────
// Party-wide faction standing on the Traveller reaction scale (−6…+6), plus a
// timeline of dated milestones stamped {day,year} from the Imperial calendar.
// Logging a milestone applies its delta to that faction's standing. Standings
// are party-wide (all players see them); milestone visibility is gated by
// canSee(). Shared state in aurelia_state key 'reputation'; 4s poll. The
// encounter generator (later) reads these standings to scale difficulty.
// ═══════════════════════════════════════════════════════════════════════════

const REP_BANDS = [ // [minInclusive, label, colour]
  [6,   'Ally',       '#54d6c0'],
  [3,   'Helpful',    '#7fd07f'],
  [1,   'Friendly',   '#a8d860'],
  [0,   'Neutral',    '#c9c4b6'],
  [-2,  'Unfriendly', '#e0b050'],
  [-5,  'Hostile',    '#e08040'],
  [-99, 'At War',     '#d45050']
];
function repBand(s){ for(const [min, label, color] of REP_BANDS){ if(s >= min) return {label, color}; } return {label:'At War', color:'#d45050'}; }

// ═══════════════════════════════════════════════════════════════════════════
// PARTY FUNDS & CHARACTER PURSES
// ═══════════════════════════════════════════════════════════════════════════
// A shared party fund every character can pay into / draw from, plus a personal
// purse per character. One shared blob under key `funds` (synced like reputation);
// every change is logged with the Imperial date + actor. Players see the party
// fund and their own purse; the referee sees and adjusts everyone's. (This adds
// the finances the character sheet deliberately left out — money lives here, in
// one place, so it's the obvious hook for the future station/outpost buy-sell.)
let funds = { party: 0, purses: {}, log: [] };
let fundsPanelOpen = false, fundsCollapsed = false;
// Guarantee the shape the operations rely on. A stored blob from an older build
// (or a partial write) can arrive missing `purses`/`log`, or with them set to
// null — which used to make a deposit throw at `funds.purses[...]=` /
// `funds.log.unshift(...)` AFTER the in-memory total had changed but BEFORE the
// re-render, so the panel froze and the buttons looked dead. Normalising up front
// makes every operation safe.
function normalizeFunds(){
  if(!funds || typeof funds !== 'object') funds = { party: 0, purses: {}, log: [] };
  funds.party = Number(funds.party) || 0;
  if(!funds.purses || typeof funds.purses !== 'object') funds.purses = {};
  if(!Array.isArray(funds.log)) funds.log = [];
}
async function loadFunds(){ try { const r = await supaStorage.get('funds', true); if(r.value != null) funds = Object.assign(funds, JSON.parse(r.value)); } catch(e){} normalizeFunds(); }
async function saveFunds(){ try { await supaStorage.set('funds', JSON.stringify(funds), true); } catch(e){ console.error('Funds save failed:', e); } }
function fundActor(){ return isReferee() ? 'Referee' : (myIdentity || 'Unknown'); }
function purseOf(name){ return Number((funds.purses || {})[name]) || 0; }
function fmtCr(n){ return 'Cr' + (Math.round(Number(n) || 0)).toLocaleString('en-US'); }
function fundsLog(target, amount, note){
  if(!Array.isArray(funds.log)) funds.log = [];
  let stamp = {}; try { stamp = imperialNow() || {}; } catch(e){ /* keep the money change even if the date stamp fails */ }
  funds.log.unshift(Object.assign(stamp, { by: fundActor(), target, amount, note: note || '' }));
  funds.log = funds.log.slice(0, 50);
}
function fundsAmt(){ const v = parseInt((document.getElementById('fund-amt') || {}).value, 10); return isFinite(v) ? Math.abs(v) : 0; }
function fundsNote(){ const e = document.getElementById('fund-note'); return e ? e.value.trim() : ''; }

function toggleFundsPanel(){
  fundsPanelOpen = !fundsPanelOpen;
  const w = document.getElementById('funds-wrap'), b = document.getElementById('funds-btn');
  w.classList.toggle('hidden', !fundsPanelOpen);
  if(b) b.classList.toggle('panel-open', fundsPanelOpen);
  if(fundsPanelOpen) renderFundsPanel();
}
function toggleFundsCollapse(){
  if(document.getElementById('funds-header').dataset.suppressClick === '1') return;
  fundsCollapsed = !fundsCollapsed;
  document.getElementById('funds-toggle').textContent = fundsCollapsed ? '▲' : '▼';
  document.getElementById('funds-body').classList.toggle('collapsed', fundsCollapsed);
  document.getElementById('funds-wrap').classList.toggle('panel-collapsed', fundsCollapsed);
}

// ── Operations (all log + save) ──
// Read the typed amount; if it's missing/invalid, tell the user instead of
// silently doing nothing (which reads as "the buttons are dead").
function fundsAmtOrWarn(){
  const a = fundsAmt();
  if(a <= 0 && typeof showToast === 'function') showToast('Enter a Cr amount first', 'error');
  return a;
}
function depositToParty(){ normalizeFunds(); const a = fundsAmtOrWarn(); if(a <= 0) return;
  if(myIdentity) funds.purses[myIdentity] = purseOf(myIdentity) - a;
  funds.party = (Number(funds.party) || 0) + a;
  fundsLog('party', a, (myIdentity ? 'Deposit from ' + myIdentity : 'Added to fund') + (fundsNote() ? ' — ' + fundsNote() : ''));
  saveFunds(); renderFundsPanel(); }
function withdrawFromParty(){ normalizeFunds(); const a = fundsAmtOrWarn(); if(a <= 0) return;
  funds.party = (Number(funds.party) || 0) - a;
  if(myIdentity) funds.purses[myIdentity] = purseOf(myIdentity) + a;
  fundsLog('party', -a, (myIdentity ? 'Withdrawn by ' + myIdentity : 'Drawn from fund') + (fundsNote() ? ' — ' + fundsNote() : ''));
  saveFunds(); renderFundsPanel(); }
function adjustMyPurse(sign){ normalizeFunds(); if(!myIdentity) return; const a = fundsAmtOrWarn(); if(a <= 0) return;
  funds.purses[myIdentity] = purseOf(myIdentity) + sign * a;
  fundsLog(myIdentity, sign * a, fundsNote() || (sign > 0 ? 'Income' : 'Spending'));
  saveFunds(); renderFundsPanel(); }
function refAdjustParty(sign){ normalizeFunds(); const a = fundsAmtOrWarn(); if(a <= 0) return;
  funds.party = (Number(funds.party) || 0) + sign * a;
  fundsLog('party', sign * a, fundsNote() || (sign > 0 ? 'Referee grant' : 'Referee charge'));
  saveFunds(); renderFundsPanel(); }
function refAdjustPurse(name, sign){ normalizeFunds(); const a = fundsAmtOrWarn(); if(a <= 0) return;
  funds.purses[name] = purseOf(name) + sign * a;
  fundsLog(name, sign * a, fundsNote() || (sign > 0 ? 'Paid by referee' : 'Charged by referee'));
  saveFunds(); renderFundsPanel(); }

function renderFundsPanel(){
  const body = document.getElementById('funds-body'); if(!body) return;
  normalizeFunds();   // never render (or read purses/log) against a malformed blob
  const ref = isReferee(), me = myIdentity;
  let h = `<div class="fund-row"><input id="fund-amt" class="fund-inp" type="number" min="0" step="100" placeholder="Cr amount"><input id="fund-note" class="fund-note" placeholder="note (optional)"></div>`;
  // Party fund — visible to all
  h += `<div class="fund-card"><div class="fund-lbl">Party Fund · shared</div><div class="fund-big">${fmtCr(funds.party)}</div>
    <div class="fund-row"><button class="disc-mini" onclick="depositToParty()">▲ Deposit</button><button class="disc-mini" onclick="withdrawFromParty()">▼ Withdraw</button>`;
  if(ref) h += `<button class="disc-mini" onclick="refAdjustParty(1)">+ Grant</button><button class="disc-mini" onclick="refAdjustParty(-1)">− Charge</button>`;
  h += `</div></div>`;
  // My purse — visible to the player
  if(me){
    h += `<div class="fund-card"><div class="fund-lbl">${escQH(me)} · your purse</div><div class="fund-big">${fmtCr(purseOf(me))}</div>
      <div class="fund-row"><button class="disc-mini" onclick="adjustMyPurse(1)">+ Income</button><button class="disc-mini" onclick="adjustMyPurse(-1)">− Spend</button></div></div>`;
  }
  // All purses — referee only
  if(ref){
    h += `<div class="fund-lbl" style="margin-top:2px">Character purses</div><div class="fund-card">`;
    crewRoster().forEach(n => { const safe = n.replace(/'/g, "\\'");
      h += `<div class="fund-purse"><span>${escQH(n)}</span><span style="display:flex;gap:6px;align-items:center"><b style="font-family:monospace;color:var(--tx0)">${fmtCr(purseOf(n))}</b>
        <button class="disc-mini" onclick="refAdjustPurse('${safe}',1)">+</button><button class="disc-mini" onclick="refAdjustPurse('${safe}',-1)">−</button></span></div>`; });
    h += `</div>`;
  }
  // Recurring ship costs — pending accruals awaiting referee approval (js/91)
  if(ref && typeof shipCostsFundsSectionHTML === 'function') h += shipCostsFundsSectionHTML();
  // Ledger — party entries to all; purse entries to that player + referee
  const vis = funds.log.filter(e => ref || e.target === 'party' || e.target === me);
  h += `<div class="fund-lbl" style="margin-top:2px">Ledger</div>`;
  if(!vis.length){ h += `<div class="cal-empty">No transactions yet.</div>`; }
  else { h += vis.slice(0, 20).map(e =>
    `<div class="fund-log"><span class="${e.amount >= 0 ? 'amt-pos' : 'amt-neg'}">${e.amount >= 0 ? '+' : '−'}${fmtCr(Math.abs(e.amount))}</span> · ${e.target === 'party' ? 'Party' : escQH(e.target)} · <span style="opacity:.6">${formatImperial(e)}</span><br>${escQH(e.note)} <span style="opacity:.5">(${escQH(e.by)})</span></div>`
  ).join(''); }
  body.innerHTML = h;
}

let reputation = {
  factions: [
    {id:'hegemony',  name:'Hegemony',                standing:-1},
    {id:'rsr',       name:'Reach Stars Resistance',  standing:2},
    {id:'syndicate', name:"Traders' Syndicate",      standing:0}
  ],
  milestones: []
};
let repPanelOpen = false;
let repCollapsed = false;

async function loadReputation(){ try { const r = await supaStorage.get('reputation', true); if(r.value != null) reputation = Object.assign(reputation, JSON.parse(r.value)); } catch(e){} }
async function saveReputation(){ try { await supaStorage.set('reputation', JSON.stringify(reputation), true); } catch(e){ console.error('Reputation save failed:', e); } }

function toggleReputationPanel(){
  repPanelOpen = !repPanelOpen;
  const w = document.getElementById('rep-wrap'), b = document.getElementById('rep-btn');
  w.classList.toggle('hidden', !repPanelOpen);
  if(b) b.classList.toggle('panel-open', repPanelOpen);
  if(repPanelOpen) renderReputationPanel();
}
function toggleRepCollapse(){
  if(document.getElementById('rep-header').dataset.suppressClick === '1') return;
  repCollapsed = !repCollapsed;
  document.getElementById('rep-toggle').textContent = repCollapsed ? '▲' : '▼';
  document.getElementById('rep-body').classList.toggle('collapsed', repCollapsed);
  document.getElementById('rep-wrap').classList.toggle('panel-collapsed', repCollapsed);
}

function repFactionName(id){ const f = reputation.factions.find(x => x.id === id); return f ? f.name : id; }

function renderReputationPanel(){
  const body = document.getElementById('rep-body'); if(!body) return;
  const ref = isReferee();

  const facHTML = reputation.factions.map(f => {
    const b = repBand(f.standing);
    const pct = ((f.standing + 6) / 12) * 100;
    const ctl = ref ? `<div class="rep-fac-ctl">
        <button class="disc-mini" onclick="adjustStanding('${f.id}',-1)">−</button>
        <button class="disc-mini" onclick="adjustStanding('${f.id}',1)">+</button>
        <button class="disc-mini del" onclick="removeFaction('${f.id}')" title="Remove faction">✕</button>
      </div>` : '';
    return `<div class="rep-fac">
      <div class="rep-fac-hd"><span class="rep-fac-name">${escQH(f.name)}</span>
        <span class="rep-band" style="color:${b.color}">${b.label} <span class="rep-val">${f.standing > 0 ? '+' : ''}${f.standing}</span></span></div>
      <div class="rep-meter"><div class="rep-meter-fill" style="width:${pct}%;background:${b.color}"></div><div class="rep-meter-zero"></div></div>
      ${ctl}
    </div>`;
  }).join('');
  const addFac = ref ? `<div class="rep-addfac"><input id="rep-newfac" placeholder="New faction…" maxlength="40"><button class="disc-mini" onclick="addFaction()">+ Faction</button></div>` : '';

  const visM = reputation.milestones.filter(m => ref || canSee(m.visibleTo)).slice().sort((a, b) => imperialOrdinal(b) - imperialOrdinal(a));
  let mHTML;
  if(!visM.length){
    mHTML = `<div class="cal-empty">${ref ? 'No milestones logged yet.' : 'No reputation events recorded.'}</div>`;
  } else {
    mHTML = visM.map(m => {
      const dStr = (m.delta > 0 ? '+' : '') + m.delta;
      const del = ref ? `<span class="cal-ev-del" onclick="deleteMilestone('${m.id}')" title="Delete">✕</span>` : '';
      const vis = ref ? `<span class="cal-ev-vis" onclick="cycleMilestoneVis('${m.id}')" title="Who can see it">${calVisLabel(m.visibleTo)}</span>` : '';
      return `<div class="rep-mile">
        <span class="cal-ev-date">${formatImperial(m)}</span>
        <div class="cal-ev-body"><div class="cal-ev-title">${escQH(m.title)}</div>
          <div class="rep-mile-meta">${escQH(repFactionName(m.factionId))} <span class="rep-mile-delta ${m.delta >= 0 ? 'pos' : 'neg'}">${dStr}</span></div></div>
        ${vis}${del}
      </div>`;
    }).join('');
  }

  const now = imperialNow();
  const facOpts = reputation.factions.map(f => `<option value="${f.id}">${escQH(f.name)}</option>`).join('');
  const addM = ref ? `<div class="disc-add">
    <div class="disc-add-ttl">New milestone — applies delta to standing</div>
    <input id="rep-m-title" placeholder="What happened…" maxlength="90">
    <div class="disc-add-row">
      <select id="rep-m-fac">${facOpts}</select>
      <input id="rep-m-delta" type="number" value="-1" title="Standing change" style="width:56px">
      <input id="rep-m-day" type="number" min="1" max="365" value="${now.day}" title="Day" style="width:52px">
      <input id="rep-m-year" type="number" value="${now.year}" title="Year" style="width:62px">
    </div>
    <input id="rep-m-vis" placeholder="all / referee / Rhett Calder">
    <button class="cal-add-btn" onclick="addMilestone()">+ Log milestone</button>
  </div>` : '';

  body.innerHTML = `<div class="rep-tl-title">Faction Standing</div>${facHTML}${addFac}<div class="rep-tl-title">Milestones</div>${mHTML}${addM}`;
}

function adjustStanding(id, delta){
  if(!isReferee()) return;
  const f = reputation.factions.find(x => x.id === id); if(!f) return;
  f.standing = Math.max(-6, Math.min(6, f.standing + delta));
  saveReputation(); renderReputationPanel();
}
function addFaction(){
  if(!isReferee()) return;
  const v = document.getElementById('rep-newfac').value.trim(); if(!v) return;
  reputation.factions.push({ id:'fac_' + Date.now().toString(36), name:v, standing:0 });
  saveReputation(); renderReputationPanel();
}
function removeFaction(id){
  if(!isReferee()) return;
  reputation.factions = reputation.factions.filter(f => f.id !== id);
  saveReputation(); renderReputationPanel();
}
function addMilestone(){
  if(!isReferee()) return;
  const title = document.getElementById('rep-m-title').value.trim(); if(!title) return;
  const factionId = document.getElementById('rep-m-fac').value;
  const delta = parseInt(document.getElementById('rep-m-delta').value, 10) || 0;
  const day = Math.max(1, Math.min(IMPERIAL_YEAR_DAYS, parseInt(document.getElementById('rep-m-day').value, 10) || imperialDate.day));
  const year = parseInt(document.getElementById('rep-m-year').value, 10) || imperialDate.year;
  const visibleTo = parseCalVis(document.getElementById('rep-m-vis').value);
  reputation.milestones.push({ id:'rm_' + Date.now().toString(36), factionId, delta, day, year, title, visibleTo });
  const f = reputation.factions.find(x => x.id === factionId);
  if(f) f.standing = Math.max(-6, Math.min(6, f.standing + delta)); // milestone moves standing
  saveReputation(); renderReputationPanel();
}
function deleteMilestone(id){
  if(!isReferee()) return;
  reputation.milestones = reputation.milestones.filter(m => m.id !== id);
  saveReputation(); renderReputationPanel();
}
function cycleMilestoneVis(id){
  if(!isReferee()) return;
  const m = reputation.milestones.find(x => x.id === id); if(!m) return;
  if(m.visibleTo === 'all') m.visibleTo = 'referee';
  else if(m.visibleTo === 'referee') m.visibleTo = ['Rhett Calder', 'Cassia Velen'];
  else m.visibleTo = 'all';
  saveReputation(); renderReputationPanel();
}

// ═══════════════════════════════════════════════════════════════════════════
// ORACLE  (V2 — rumour & random-encounter generators)
// ───────────────────────────────────────────────────────────────────────────
// Referee-only GM tools. Output is *seeded* from live state so it feels
// diegetic, not random: rumours weight toward factions with extreme standing
// and bend hostile/friendly to match; encounters scale difficulty off the
// danger dial AND the party's worst faction standing (per the brief). Ship name
// and current locale fill the templates. Results are ephemeral (not synced),
// but a rumour can be pushed "→ Codex" as a rumoured discovery entry players see.
// ═══════════════════════════════════════════════════════════════════════════

const ORACLE_GOODS = ['refined fuel','medical supplies','luxury goods','machine parts','foodstuffs','small arms','data cores','rare ore'];
const ORACLE_PLACES = ['Aurelia Station','the Aurelia approaches','Cairn Station','the outer berths','the concourse','the elevator gate'];
const RUMOUR_TEMPLATES = {
  generic: [
    'A dock worker swears {ship} was flagged on a patrol watch advisory.',
    'Someone is paying good credits to anyone who can place {ship} two weeks ago.',
    'Prices on {good} are about to move — somebody knows something.',
    'A broker on {place} is quietly buying {good} well above market.',
    'Travellers are avoiding the {place} routes lately. Nobody will say why.'
  ],
  hostile: [
    '{faction} has put a quiet bounty on whoever crewed {ship}.',
    'They say {faction} enforcers were asking after {ship} at {place}.',
    '{faction} is leaning on dockmasters to deny {ship} a berth.',
    'A {faction} skiff has been shadowing arrivals at {place}.'
  ],
  friendly: [
    '{faction} contacts hint there is clean work going, if you can be discreet.',
    'Word from {faction}: a berth at {place} will be looked after, no questions.',
    '{faction} remembers a favour your crew is owed — fondly.'
  ],
  neutral: [
    '{faction} is moving more cargo than usual through {place}.',
    '{faction} just lost a courier and wants it found before anyone else does.'
  ]
};
const RUMOUR_RELIABILITY = ['Reliable','Likely true','Unconfirmed','Probably false'];

// ── Market rumours: TRUE intel drawn from the living economy (ECON.intel) ──────
// Maps the sim's clinical good names to evocative dockside terms, and holds the
// rumour phrasings per signal kind. These rumours are tagged 'Reliable' because
// they are literally true at generation time — a player who acts on them profits.
const GOOD_FLAVOR = {
  'Common Consumables':'foodstuffs','Common Ore':'raw ore','Common Electronics':'electronics components',
  'Common Manufactured':'machine parts','Advanced Electronics':'high-tech components'
};
// CORP CONTRACTS — the corp sim flags jobs (ECON.corpEvents / the {kind:'contract'} items from
// ECON.intel); these templates resolve them into ready-to-run contracts. Placeholders: {corp} (the
// hiring house), {target} (rival), {place}/{from}/{to} (worlds), {good}, {vessel}, {reward}. Each has
// a short title, player-facing briefs, and a referee note. Drafted via draftCorpContract() below and
// pushed to the Quest Log / Library Data from the economy console.
const CORP_CONTRACT = {
  escort: { title:'Escort — {corp}', refNote:'{corp} convoy {vessel} ({good}, {from}→{to}). Reward ~{reward}. If the players escort it successfully, it survives; if they fail or decline, resolve with the ⚔ convoy-raid button.', briefs:[
    '{corp} is paying {reward} for armed escort of its hauler {vessel} — {good} on the {from}→{to} run. Raiders have been working that lane.',
    'Word at the {to} docks: {corp} wants guns aboard {vessel} for the {good} run in from {from}. {reward} on safe arrival.' ]},
  haul: { title:'Priority haul — {corp}', refNote:'{corp} expanding at {place}; needs {good} delivered to support it. Premium ~{reward} over market.', briefs:[
    '{corp} will pay a premium — {reward} — for a fast delivery of {good} into {place} to feed its new operation there.',
    '{corp} is short of {good} at {place} and paying over the odds ({reward}) to anyone who can run a hold in quick.' ]},
  bounty: { title:'Bounty — {corp}', refNote:'{corp} convoy {vessel} was raided near {to} ({good}). It posts a {reward} bounty on the raiders.', briefs:[
    '{corp} posts a {reward} bounty on the raiders who hit its {good} shipment near {to}. They want a name, or a wreck.',
    'Someone gutted a {corp} hauler off {to}. The company is paying {reward} to whoever settles the account.' ]},
  sabotage: { title:'Black job — {corp} vs {target}', refNote:'{corp} hiring against its rival {target}. Reward ~{reward}. Resolve a success with the ⚔ raid button on a {target} convoy.', briefs:[
    '{corp} will quietly pay {reward} to see {target}’s next {good} shipment never reach port. No questions, no records.',
    'A {corp} fixer is hiring deniable hands — {reward} to make a {target} cargo disappear. {good}, in transit, soon.' ]},
  espionage: { title:'Corporate espionage — {corp}', refNote:'{corp} wants intel on rival {target} (expansion plans / routes). Reward ~{reward}. Could hand the players {target}’s next move.', briefs:[
    '{corp} wants eyes inside {target} — {reward} for their expansion plans and trade routes. Discretion essential.',
    'A discreet {corp} broker is paying {reward} for whatever you can lift on {target}: berths, routes, who they’re buying.' ]},
  smuggle: { title:'Run the blockade — {place}', refNote:'{corp} wants {good} run past the trade restriction at {place}. Premium ~{reward}. Players smuggle a hold in — resolve as a skill/heat scene; if they’re caught or decline, seize the cargo with the ⚔ convoy-raid button.', briefs:[
    '{corp} is quietly paying {reward} to anyone who can run a hold of {good} past the clampdown at {place}. Customs are watching the berths.',
    'There’s a black market for {good} at {place} since the restriction bit — {corp} will pay {reward} for a discreet delivery, no manifest, no questions.' ]}
};
const MARKET_RUMOUR = {
  shock_output: [
    'Word on the docks: the {good} coming out of {place} has slowed to a trickle. Somebody knows why — and they’re already buying.',
    'They say production of {good} at {place} has been hit hard. It won’t stay cheap for long.'
  ],
  shock_block: [
    'The lanes around {place} are choked — nothing’s moving through, and shelves downstream are starting to empty.',
    'Hard word from {place}: the route is shut. Whatever rides that lane is about to get dear.'
  ],
  shock_embargo: [
    'Trade between {place} has frozen solid. The brokers who saw it coming are already repositioned.'
  ],
  shock_crackdown: [
    'The {place} has clamped down on {good} across its territory — supply is drying up and the price is climbing.',
    'Word is the {place} is restricting {good}. Whoever holds stock beyond their reach is sitting pretty.'
  ],
  shock_tariff: [
    'The {place} has slapped a tariff on {good} imports — it’s getting pricey behind their borders, and cheap outside them.',
    'A {place} import tariff is choking {good} at the frontier. Brokers who can run it past customs stand to clean up.'
  ],
  shock_demand: [
    'Demand for {good} is surging across {place} — buyers are desperate and the price is spiking.',
    'A run on {good} has hit {place}. Anyone arriving with a full hold could name their price.'
  ],
  shortage: [
    'Stockpiles of {good} are running thin around {place}. Prices there won’t hold where they are.',
    'A buyer at {place} is quietly paying over the odds for {good}. That tells you everything.',
    'If you’re holding {good}, {place} is where to sell it — and soon.'
  ],
  glut: [
    'There’s more {good} sitting at {place} than anyone can move. Cheap now — won’t last once word spreads.',
    '{place} is awash in {good}. A sharp trader buys low here before the surplus clears.'
  ],
  status_boom: [
    '{place} is booming — a new operation has drawn workers, money and trouble in equal measure. Easy coin there, if you know who to ask.',
    'Word is {place} is flush right now: wages up, bars full, and the holding cells fuller.'
  ],
  status_bust: [
    '{place} has gone quiet — the work dried up and anyone who can is leaving. Desperate ports make for cheap, willing hands.',
    'They pulled out of {place} and took the jobs with them. It’s a buyer’s market for anything — and anyone — there now.'
  ],
  status_unrest: [
    '{place} is restive — strikes on the docks, anger in the streets. Cargo moves slow and nothing ships on schedule.',
    'There’s real trouble brewing at {place}: the workforce has had enough and the bosses are nervous.'
  ],
  status_rationing: [
    'Larders are thinning at {place} — ration cards are out and folk are eyeing the relief convoys. A full hold of staples would be welcome, and well paid.',
    '{place} is tightening its belt. Whoever turns up with food will find grateful buyers.'
  ],
  blackmarket: [
    'There’s a black market running at {place} for {good} since the restriction. The discreet are doing very well out of it.',
    'Ask the right people at {place} and you can move {good} off the books — at a premium, and a risk.'
  ]
};

const ENCOUNTER_TABLES = {
  space: ['An unmarked ship matches your vector and holds at distance.','A distress beacon pulses nearby — genuine, or bait.','A customs interceptor orders you to cut thrust for inspection.','A debris field hides a salvageable, and probably claimed, wreck.','A free trader hails, offering an off-manifest cargo swap.'],
  port:  ['A dockside argument escalates near your berth — one party is armed.','A fixer drops into the seat across from you with a job and a warning.','Port authority flags a discrepancy in your paperwork.','A face from a crew member’s past is three tables over.','Someone tries to fix a tracker to your hull during the night cycle.'],
  surface:['A checkpoint ahead, and your transit codes are a day stale.','A local offers a shortcut around the patrols — for a price.','A crowd is gathering, and the mood could turn.','Weather closes in; shelter means trusting strangers.','You find something that was meant to stay buried.']
};
const ENCOUNTER_DIFF = ['Trivial','Routine','Tricky','Dangerous','Deadly'];
const ORACLE_WHERE = [['space','Space'],['port','Port'],['surface','Surface']];
const ORACLE_DANGER = [['0','Calm'],['1','Normal'],['2','Tense'],['3','Hostile']];

let oracleWhere = 'space';
let oracleDanger = 1;
let oracleResult = null;   // {kind:'rumour'|'encounter', ...}
let genPanelOpen = false;
let genCollapsed = false;

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
function oraclePlace(){
  let p;
  if(typeof isAuthoredCampaign === 'function' && isAuthoredCampaign()){
    // Authored campaigns: rumours name THIS galaxy's charted systems, not the
    // Archon Gambit docks. Falls back to neutral dockside spots pre-charting.
    p = (typeof GALAXY_NODES !== 'undefined' ? GALAXY_NODES : [])
      .filter(n => !n.uninhabited).map(n => n.label || n.name).filter(Boolean);
    if(!p.length) p = ['the docks', 'the port concourse', 'the outer berths'];
  } else {
    p = ORACLE_PLACES.slice();
  }
  if(shipState.destination) p.push(shipState.destination);
  return pick(p);
}

function goodFlavor(g){ return GOOD_FLAVOR[g] || (g ? g.toLowerCase() : pick(ORACLE_GOODS)); }
// ── FACTION CONTRACTS — jobs the STATES post (parallel to CORP_CONTRACT; {faction} = the power). The
//    faction AI (ECON.factionEvents) flags relief / patrol / bounty / development needs in its space;
//    these resolve them into ready-to-run contracts, drafted + posted through the same pipeline. ──
const FACTION_CONTRACT = {
  relief: { title:'Relief run — {faction}', refNote:'{faction} is subsidising staples/supply into {place} to head off a shortage. Premium ~{reward}. A straightforward supply-and-deliver job; failure lets the shortage bite (unrest risk).', briefs:[
    'The {faction} is paying {reward} for a fast relief run of {good} into {place} — stocks there are running dangerously thin.',
    'Word from a {faction} liaison: {reward} to anyone who can get a hold of {good} into {place} before the larders empty.' ]},
  patrol: { title:'Lane patrol — {faction}', refNote:'{faction} wants the {from}→{to} approach patrolled; a valuable convoy ({vessel}, {good}) is inbound. Reward ~{reward}. Runs as a picket/escort scene; if declined, resolve any raid with the ⚔ button.', briefs:[
    'The {faction} navy is stretched thin and is paying {reward} for private guns to patrol the {from}→{to} lane — a fat {good} convoy is due through.',
    '{faction} customs will pay {reward} to see the {to} approach kept clean this cycle. Raiders have been bold on that run.' ]},
  bounty: { title:'Bounty — {faction}', refNote:'Raiders struck shipping in {faction} space near {place}. It posts a {reward} bounty on the culprits. Resolve a success against the raiding convoy / a plausible raider.', briefs:[
    'The {faction} posts a {reward} bounty on the raiders working its space around {place}. Bring a name or a wreck.',
    'After the latest raid off {place}, the {faction} is done waiting — {reward} to whoever ends the raiders’ run.' ]},
  development: { title:'Development charter — {faction}', refNote:'{faction} is funding a build-up / survey at {place} and wants contractors. Reward ~{reward}. Open-ended downtime/skill work; good hook for a recurring patron.', briefs:[
    'The {faction} has opened a {reward} development charter at {place} — surveyors, haulers and fixers all wanted for the build-up.',
    'A {faction} ministry is hiring for works at {place}: {reward} on the table for crews willing to sign a charter.' ]}
};
// Fill a CORP_CONTRACT / FACTION_CONTRACT template from a rich contract item (ECON.contractItem /
// ECON.factionContractItem / an intel 'contract' item).
function fillContract(s, item){
  const money = (typeof econMoney==='function') ? econMoney(item.reward) : ('Cr'+(item.reward||0));
  return (''+s)
    .replace(/{corp}/g,    item.label||'a corporation')
    .replace(/{faction}/g, item.label||'a power')
    .replace(/{target}/g,  item.targetName||'a rival house')
    .replace(/{place}/g,   item.place||item.toLabel||'the frontier')
    .replace(/{from}/g,    item.fromLabel||'port')
    .replace(/{to}/g,      item.toLabel||'port')
    .replace(/{good}/g,    goodFlavor(item.good))
    .replace(/{vessel}/g,  item.vessel||'a hauler')
    .replace(/{reward}/g,  money);
}
// Roll a concrete contract from a flagged opportunity → {type,corp,target,reward,title,brief,refNote}.
function draftCorpContract(item){
  const t = (item.issuer==='faction' && FACTION_CONTRACT[item.contract]) || (CORP_CONTRACT[item.contract]) || FACTION_CONTRACT[item.contract] || CORP_CONTRACT.escort;
  return { type:item.contract, corp:item.label, target:item.targetName||null, reward:item.reward, color:item.color||null,
    title: fillContract(t.title, item), brief: fillContract(pick(t.briefs), item), refNote: fillContract(t.refNote, item) };
}
// Post a drafted contract to the shared Quest Log (players see & track it). Reuses the quest system.
function spawnContractQuest(c){
  if(typeof isReferee==='function' && !isReferee()) return false;
  if(!c || typeof questLog==='undefined') return false;
  const reward = c.reward ? ' · suggested reward '+((typeof econMoney==='function')?econMoney(c.reward):('Cr'+c.reward)) : '';
  questLog.push({ id:'q_'+Date.now().toString(36), title:c.title, status:'active', playerDesc:c.brief,
    refNote:(c.refNote||'')+reward, objectives:[] });
  if(typeof saveQuestLog==='function') saveQuestLog();
  if(typeof renderQuestPanel==='function' && typeof questPanelOpen!=='undefined' && questPanelOpen) renderQuestPanel();
  return true;
}
// Post a drafted contract to Library Data as a rumour players can overhear (reuses the discovery log).
function pushContractToLibrary(c){
  if(typeof isReferee==='function' && !isReferee()) return false;
  if(!c || typeof discoveryLog==='undefined') return false;
  const reward = c.reward ? ' · reward '+((typeof econMoney==='function')?econMoney(c.reward):('Cr'+c.reward)) : '';
  discoveryLog.push({ id:'disc_'+Date.now().toString(36), title:c.brief, category:'faction',
    body:(c.refNote||'')+reward, state:'rumoured', visibleTo:'all', createdAt:imperialNow(), revealedAt:imperialNow() });
  if(typeof saveDiscoveryLog==='function') saveDiscoveryLog();
  if(typeof renderDiscoveryPanel==='function' && typeof discPanelOpen!=='undefined' && discPanelOpen) renderDiscoveryPanel();
  return true;
}
// Oracle-side: post the currently shown contract rumour to the Quest Log.
function contractToQuest(){
  if(!oracleResult || !oracleResult.contract) return;
  if(spawnContractQuest(oracleResult.contract)){
    const note=document.getElementById('gen-codex-note'); if(note){ note.textContent='✓ Posted to the Quest Log'; setTimeout(()=>{ if(note) note.textContent=''; },2200); }
  }
}
// Build a TRUE rumour from the living economy's current intel, or null if the sim
// is off / nothing is moving. Biased toward the sharpest few signals so the most
// newsworthy shock or shortage usually surfaces.
function pickMarketRumour(){
  if(!(window.ECON && ECON.active())) return null;
  let items; try { items = ECON.intel(); } catch(e){ return null; }
  if(!items || !items.length) return null;
  const item = items[Math.floor(Math.random() * Math.min(items.length, 4))];
  if(item.kind === 'contract'){ const d = draftCorpContract(item);   // a corp job overheard on the docks
    return { kind:'rumour', text:d.brief, faction:null, source:'contract', contract:d,
      reliability:(item.contract==='sabotage'||item.contract==='espionage'||item.contract==='smuggle')?'Whispered':'Reliable' }; }
  if(item.kind === 'status'){ const tmpl = MARKET_RUMOUR['status_'+item.status] || MARKET_RUMOUR.shortage;   // a world's mood/condition
    return { kind:'rumour', text: pick(tmpl).replace(/{place}/g, item.label), faction:null, reliability:'Reliable', source:'market' }; }
  if(item.kind === 'blackmarket'){ const text = pick(MARKET_RUMOUR.blackmarket).replace(/{good}/g, goodFlavor(item.good)).replace(/{place}/g, item.label);
    return { kind:'rumour', text, faction:null, reliability:'Whispered', source:'market' }; }   // illicit, so sketchy intel
  if(item.kind === 'news'){ return { kind:'rumour', text:item.text, faction:null, reliability:'Reliable', source:'news' }; }   // a GalNet broadcast — government reshuffle, trade war, détente
  const key = item.kind === 'shock'
    ? (item.shock === 'output' ? 'shock_output' : item.shock === 'embargo' ? 'shock_embargo' : item.shock === 'crackdown' ? 'shock_crackdown' : item.shock === 'tariff' ? 'shock_tariff' : item.shock === 'demand' ? 'shock_demand' : 'shock_block')
    : (item.kind === 'glut' ? 'glut' : 'shortage');
  const tmpl = MARKET_RUMOUR[key] || MARKET_RUMOUR.shortage;
  const text = pick(tmpl).replace(/{good}/g, goodFlavor(item.good)).replace(/{place}/g, item.label);
  return { kind:'rumour', text, faction:null, reliability:'Reliable', source:'market' };
}
// Referee-triggered: deliberately pull the strongest current market signal.
function generateMarketRumour(){
  const m = pickMarketRumour();
  oracleResult = m || { kind:'rumour', text:'The markets are calm — no strong signal moving right now.', faction:null, reliability:'Unconfirmed', source:'market' };
  renderOraclePanel();
}

function generateRumour(){
  // Organic hook: ~30% of the time, surface a TRUE signal from the living economy
  // instead of a flavour template — when the sim is active and something is moving.
  if(Math.random() < 0.3){ const m = pickMarketRumour(); if(m){ oracleResult = m; renderOraclePanel(); return; } }
  const facs = reputation.factions || [];
  let faction = null;
  if(facs.length){ // weight by |standing| — louder factions when relations are extreme
    const weighted = [];
    facs.forEach(f => { const w = 1 + Math.abs(f.standing); for(let i = 0; i < w; i++) weighted.push(f); });
    faction = pick(weighted);
  }
  let bucket = 'generic';
  if(faction){ const s = faction.standing; bucket = s <= -3 ? 'hostile' : s >= 3 ? 'friendly' : (Math.random() < 0.5 ? 'neutral' : 'generic'); }
  let line = pick(RUMOUR_TEMPLATES[bucket] && RUMOUR_TEMPLATES[bucket].length ? RUMOUR_TEMPLATES[bucket] : RUMOUR_TEMPLATES.generic);
  line = line.replace(/{faction}/g, faction ? faction.name : 'Someone')
             .replace(/{ship}/g, shipState.name || 'the ship')
             .replace(/{place}/g, oraclePlace())
             .replace(/{good}/g, pick(ORACLE_GOODS));
  oracleResult = { kind:'rumour', text: line, faction: faction ? faction.name : null, reliability: pick(RUMOUR_RELIABILITY) };
  renderOraclePanel();
}

function generateEncounter(){
  const base = pick(ENCOUNTER_TABLES[oracleWhere] || ENCOUNTER_TABLES.space);
  const worst = (reputation.factions || []).reduce((m, f) => Math.min(m, f.standing), 0); // most-negative standing
  let diff = oracleDanger + Math.floor(Math.random() * 2);
  if(worst <= -3) diff += 1;
  if(worst <= -5) diff += 1;
  diff = Math.max(0, Math.min(4, diff));
  const hostile = (reputation.factions || []).filter(f => f.standing <= -3);
  const tie = (hostile.length && Math.random() < 0.55) ? pick(hostile).name : null;
  oracleResult = { kind:'encounter', text: base, difficulty: ENCOUNTER_DIFF[diff], diffIdx: diff, faction: tie };
  renderOraclePanel();
}

function rumourToCodex(){
  if(!isReferee() || !oracleResult || oracleResult.kind !== 'rumour') return;
  discoveryLog.push({
    id: 'disc_' + Date.now().toString(36),
    title: oracleResult.text,
    category: 'lore',
    body: oracleResult.faction ? ('Attributed to ' + oracleResult.faction + ' · ' + oracleResult.reliability) : oracleResult.reliability,
    state: 'rumoured',
    visibleTo: 'all',
    createdAt: imperialNow(),
    revealedAt: imperialNow()
  });
  saveDiscoveryLog();
  if(discPanelOpen) renderDiscoveryPanel();
  const note = document.getElementById('gen-codex-note');
  if(note){ note.textContent = '✓ Sent to Library Data as a rumour'; setTimeout(() => { if(note) note.textContent = ''; }, 2200); }
}

function setOracleWhere(w){ oracleWhere = w; renderOraclePanel(); }
function setOracleDanger(d){ oracleDanger = parseInt(d, 10) || 0; renderOraclePanel(); }

function toggleOraclePanel(){
  if(!isReferee()) return;
  genPanelOpen = !genPanelOpen;
  const w = document.getElementById('gen-wrap'), b = document.getElementById('gen-btn');
  w.classList.toggle('hidden', !genPanelOpen);
  if(b) b.classList.toggle('panel-open', genPanelOpen);
  if(genPanelOpen) renderOraclePanel();
}
function toggleGenCollapse(){
  if(document.getElementById('gen-header').dataset.suppressClick === '1') return;
  genCollapsed = !genCollapsed;
  document.getElementById('gen-toggle').textContent = genCollapsed ? '▲' : '▼';
  document.getElementById('gen-body').classList.toggle('collapsed', genCollapsed);
  document.getElementById('gen-wrap').classList.toggle('panel-collapsed', genCollapsed);
}

function renderOraclePanel(){
  const body = document.getElementById('gen-body'); if(!body) return;
  let resultHTML = '<div class="cal-empty">Generate a rumour or encounter.</div>';
  if(oracleResult){
    if(oracleResult.kind === 'rumour'){
      const fac = oracleResult.faction ? `<span class="gen-tag">${escQH(oracleResult.faction)}</span>` : '';
      const mkt = oracleResult.source === 'market' ? `<span class="gen-tag" style="color:var(--accentGold)" title="Drawn from the living economy — true at the time it was generated">📈 market</span>`
                : oracleResult.source === 'contract' ? `<span class="gen-tag" style="color:#9fd0ff" title="A corporation's job, drawn from the living economy">📋 contract</span>`
                : oracleResult.source === 'news' ? `<span class="gen-tag" style="color:#c9a9e0" title="A GalNet broadcast from the living galaxy — government reshuffle, trade war, or détente">📡 GalNet</span>` : '';
      const questBtn = oracleResult.contract ? `<button class="disc-mini" onclick="contractToQuest()" title="Post this contract to the Quest Log for players">→ Quest Log</button>` : '';
      resultHTML = `<div class="gen-result">
        <div class="gen-result-text">“${escQH(oracleResult.text)}”</div>
        <div class="gen-meta">${mkt}${fac}<span class="gen-tag">${oracleResult.reliability}</span>
          <button class="disc-mini" onclick="rumourToCodex()" title="Push to Library Data as a rumour players can see">→ Library Data</button>${questBtn}
          <span id="gen-codex-note" style="font-size:9px;color:var(--accentGold)"></span></div>
      </div>`;
    } else {
      const tie = oracleResult.faction ? `<span class="gen-tag">${escQH(oracleResult.faction)} involved</span>` : '';
      resultHTML = `<div class="gen-result">
        <div class="gen-result-text">${escQH(oracleResult.text)}</div>
        <div class="gen-meta"><span class="gen-diff gen-diff-${oracleResult.diffIdx}">${oracleResult.difficulty}</span>${tie}</div>
      </div>`;
    }
  }
  const whereOpts = ORACLE_WHERE.map(([v, l]) => `<span class="gen-opt${oracleWhere === v ? ' on' : ''}" onclick="setOracleWhere('${v}')">${l}</span>`).join('');
  const dangerOpts = ORACLE_DANGER.map(([v, l]) => `<span class="gen-opt${oracleDanger == v ? ' on' : ''}" onclick="setOracleDanger('${v}')">${l}</span>`).join('');
  const worst = (reputation.factions || []).reduce((m, f) => Math.min(m, f.standing), 0);
  const repHint = worst <= -3 ? `<div class="gen-hint">⚠ Hostile standing (${worst}) is raising encounter danger.</div>` : '';

  body.innerHTML = `
    ${resultHTML}
    <div class="gen-sec-title">Rumour</div>
    <button class="gen-go" onclick="generateRumour()">🎲 Generate rumour</button>
    <button class="gen-go" onclick="generateMarketRumour()" title="Pull a TRUE rumour straight from the living economy's current shortages & shocks">📈 Market whisper</button>
    <div class="gen-sec-title">Encounter</div>
    <div class="gen-row-lbl">Where</div><div class="gen-opts">${whereOpts}</div>
    <div class="gen-row-lbl">Danger</div><div class="gen-opts">${dangerOpts}</div>
    ${repHint}
    <button class="gen-go" onclick="generateEncounter()">🎲 Generate encounter</button>`;
}

function toggleQuestCard(id){
  const body = document.getElementById('qbody-'+id);
  if(body) body.classList.toggle('open');
}

async function toggleObjective(questId, objIdx){
  const q = questLog.find(x => x.id === questId);
  if(!q || !q.objectives[objIdx]) return;
  q.objectives[objIdx].done = !q.objectives[objIdx].done;
  await saveQuestLog();
  renderQuestPanel();
}

// ── Editor ────────────────────────────────────────────────────────────────

function openQuestEditor(id){
  questEditingId = id;
  const isNew = !id;
  const q = isNew ? null : questLog.find(x => x.id === id);

  document.getElementById('quest-edit-title').textContent = isNew ? 'NEW MISSION' : 'EDIT MISSION';
  document.getElementById('qe-title').value = q ? q.title : '';
  document.getElementById('qe-status').value = q ? q.status : 'active';
  document.getElementById('qe-player-desc').value = q ? q.playerDesc||'' : '';
  document.getElementById('qe-ref-note').value = q ? q.refNote||'' : '';
  document.getElementById('qe-delete-btn').classList.toggle('hidden', isNew);

  renderObjectiveEditorRows(q ? q.objectives||[] : []);
  document.getElementById('quest-edit-modal').classList.remove('hidden');
}

function closeQuestEditor(){
  document.getElementById('quest-edit-modal').classList.add('hidden');
  questEditingId = null;
}

function renderObjectiveEditorRows(objectives){
  const container = document.getElementById('qe-objectives');
  container.innerHTML = objectives.map((obj, i) => `
    <div class="qe-obj-row" id="qe-obj-${i}">
      <input type="checkbox" class="qe-obj-done" ${obj.done?'checked':''} title="Mark done">
      <div class="qe-obj-inputs">
        <textarea class="qe-obj-text" placeholder="Objective text...">${escQH(obj.text)}</textarea>
        <textarea class="qe-obj-refnote" placeholder="Ref note (private)...">${escQH(obj.refNote||'')}</textarea>
      </div>
      <button class="qe-obj-remove" onclick="removeObjectiveRow(${i})" title="Remove">✕</button>
    </div>
  `).join('');
}

function addQuestObjective(){
  const rows = readObjectiveRows();
  rows.push({text:'', done:false, refNote:''});
  renderObjectiveEditorRows(rows);
}

function removeObjectiveRow(idx){
  const rows = readObjectiveRows();
  rows.splice(idx, 1);
  renderObjectiveEditorRows(rows);
}

function readObjectiveRows(){
  const container = document.getElementById('qe-objectives');
  const rows = [];
  container.querySelectorAll('.qe-obj-row').forEach(row => {
    rows.push({
      text: row.querySelector('.qe-obj-text').value,
      done: row.querySelector('.qe-obj-done').checked,
      refNote: row.querySelector('.qe-obj-refnote').value,
    });
  });
  return rows;
}

async function saveQuestEdit(){
  const title = document.getElementById('qe-title').value.trim();
  if(!title){ alert('A mission title is required.'); return; }

  const questData = {
    id: questEditingId || ('q-' + Date.now()),
    title,
    status: document.getElementById('qe-status').value,
    playerDesc: document.getElementById('qe-player-desc').value,
    refNote: document.getElementById('qe-ref-note').value,
    objectives: readObjectiveRows(),
  };

  if(questEditingId){
    const idx = questLog.findIndex(x => x.id === questEditingId);
    if(idx !== -1) questLog[idx] = questData;
    else questLog.push(questData);
  } else {
    questLog.push(questData);
  }

  await saveQuestLog();
  closeQuestEditor();
  if(questPanelOpen) renderQuestPanel();
  showToast(questEditingId ? 'Quest updated' : 'Quest added');
}

async function deleteQuest(){
  if(!questEditingId) return;
  if(!confirm('Delete this mission? This cannot be undone.')) return;
  questLog = questLog.filter(x => x.id !== questEditingId);
  await saveQuestLog();
  closeQuestEditor();
  if(questPanelOpen) renderQuestPanel();
  showToast('Quest deleted', 'info');
}

// ═══════════════════════════════════════════════════════════════════════════
// SESSION JOURNAL — persisted, player-visible session recaps ("Previously on…")
// ═══════════════════════════════════════════════════════════════════════════
// The session-recap generator (generateSessionRecap, js/92) is ephemeral. The
// journal persists a recap as a dated entry so continuity carries between
// sessions. Shared key 'session-log' (shared:true), same pattern as quest-log:
// the referee writes, players poll and read; entries are visibility-gated via
// canSee(visibleTo) (default 'all'). Lives here (load pos 85) so the boot-time
// loadSessionLog() below resolves — it must be defined before it is called.
//   entry = { id, realDate, imperialDate:{day,year}|null, title, body, visibleTo }

let sessionLog = [];
let journalPanelOpen = false;
let journalCollapsed = false;

async function loadSessionLog(){
  try {
    const res = await supaStorage.get('session-log', true);
    if(res.value != null) sessionLog = JSON.parse(res.value) || [];
  } catch(e){ sessionLog = []; }
}
async function saveSessionLog(){
  try { await supaStorage.set('session-log', JSON.stringify(sessionLog), true); }
  catch(e){ console.error('Session journal save failed:', e); }
}

function toggleJournalPanel(){
  journalPanelOpen = !journalPanelOpen;
  const wrap = document.getElementById('journal-wrap');
  const btn = document.getElementById('journal-btn');
  if(!wrap) return;
  wrap.classList.toggle('hidden', !journalPanelOpen);
  if(btn) btn.classList.toggle('panel-open', journalPanelOpen);
  if(journalPanelOpen) renderJournalPanel();
}
function toggleJournalCollapse(){
  const hdr = document.getElementById('journal-header');
  if(hdr && hdr.dataset.suppressClick === '1') return;
  journalCollapsed = !journalCollapsed;
  document.getElementById('journal-toggle').textContent = journalCollapsed ? '▲' : '▼';
  document.getElementById('journal-body').classList.toggle('collapsed', journalCollapsed);
  document.getElementById('journal-wrap').classList.toggle('panel-collapsed', journalCollapsed);
}

// Referee: persist the current generated recap as a dated journal entry.
// Reads the recap already produced into #session-recap-output by
// generateSessionRecap() — so it reuses that generator rather than re-inventing.
function saveRecapToJournal(){
  if(!isReferee()) return;
  const out = document.getElementById('session-recap-output');
  const body = ((out && out.textContent) || '').trim();
  if(!body){ showToast('Generate a recap first', 'error'); return; }
  const imp = (typeof imperialNow === 'function') ? imperialNow() : null;
  const title = 'Session — ' + (imp ? formatImperial(imp) : new Date().toLocaleDateString());
  sessionLog.push({
    id: 'sess_' + Math.random().toString(36).slice(2, 9),
    realDate: new Date().toISOString().slice(0, 10),
    imperialDate: imp,
    title, body, visibleTo: 'all'
  });
  saveSessionLog();
  showToast('Saved to session journal');
  if(journalPanelOpen) renderJournalPanel();
}

function deleteJournalEntry(id){
  if(!isReferee()) return;
  if(!confirm('Delete this journal entry? This cannot be undone.')) return;
  sessionLog = sessionLog.filter(e => e.id !== id);
  saveSessionLog();
  renderJournalPanel();
}

function renderJournalPanel(){
  const ref = isReferee();
  const body = document.getElementById('journal-body');
  if(!body) return;
  // newest first; players only see entries their identity is permitted to
  const visible = sessionLog
    .filter(e => ref || (typeof canSee === 'function' ? canSee(e.visibleTo) : true))
    .slice().reverse();
  if(!visible.length){
    body.innerHTML = `<div class="journal-empty">${ref
      ? 'No saved recaps yet. Open Session Tools, “Generate recap”, then “Save to Journal”.'
      : 'No session recaps yet.'}</div>`;
    return;
  }
  body.innerHTML = visible.map(e => {
    const when = e.imperialDate ? formatImperial(e.imperialDate) : (e.realDate || '');
    const del = ref ? `<button class="journal-del" onclick="deleteJournalEntry('${e.id}')" title="Delete entry">✕</button>` : '';
    return `<div class="journal-entry">
      <div class="journal-entry-head">
        <span class="journal-entry-title">${escQH(e.title)}</span>
        <span class="journal-entry-date">${escQH(when)}</span>${del}
      </div>
      <div class="journal-entry-body">${escQH(e.body).replace(/\n/g,'<br>')}</div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// CARGO MANIFEST — the party's speculative-trade position (referee-facilitated)
// ═══════════════════════════════════════════════════════════════════════════
// Trade is played at the table: the referee runs the MgT2e Speculative-Trade
// checks from the rulebook (📖 Rules / their BYO book) and reads prices off the
// living-economy console — this app never resolves the trade. What was missing
// is a SHARED record of what the party is hauling and what they paid. The
// referee keeps it; every player sees the position live. Licensing-clean: no
// trade tables embedded — good names are free-text (the sim's own ECON.GOODS
// are offered as a convenience datalist). Shared key 'trade-cargo'.
//   lot = { id, good, tons, buyCr /* per dton */, world, date }

let tradeCargo = { lots: [] };
let cargoPanelOpen = false, cargoCollapsed = false;
let cargoRefWorld = ''; // device-local "which market am I checking" for the living-economy signal

async function loadTradeCargo(){
  try { const r = await supaStorage.get('trade-cargo', true); if(r.value != null){ const v = JSON.parse(r.value); tradeCargo = (v && Array.isArray(v.lots)) ? v : { lots: [] }; } }
  catch(e){ tradeCargo = { lots: [] }; }
}
async function saveTradeCargo(){
  try { await supaStorage.set('trade-cargo', JSON.stringify(tradeCargo), true); }
  catch(e){ console.error('Cargo manifest save failed:', e); }
}
function toggleCargoPanel(){
  cargoPanelOpen = !cargoPanelOpen;
  const w = document.getElementById('cargo-wrap'), b = document.getElementById('cargo-btn');
  if(!w) return;
  w.classList.toggle('hidden', !cargoPanelOpen);
  if(b) b.classList.toggle('panel-open', cargoPanelOpen);
  if(cargoPanelOpen) renderCargoPanel();
}
function toggleCargoCollapse(){
  const h = document.getElementById('cargo-header');
  if(h && h.dataset.suppressClick === '1') return;
  cargoCollapsed = !cargoCollapsed;
  document.getElementById('cargo-toggle').textContent = cargoCollapsed ? '▲' : '▼';
  document.getElementById('cargo-body').classList.toggle('collapsed', cargoCollapsed);
  document.getElementById('cargo-wrap').classList.toggle('panel-collapsed', cargoCollapsed);
}
function cargoAddLot(){
  if(!isReferee()) return;
  const gv = id => (document.getElementById(id) && document.getElementById(id).value || '').trim();
  const good = gv('cargo-f-good'); if(!good) return;
  const tons = Math.max(0, Number(gv('cargo-f-tons')) || 0);
  const buyCr = Math.max(0, Number(gv('cargo-f-cr')) || 0);
  const world = gv('cargo-f-world');
  tradeCargo.lots = tradeCargo.lots || [];
  tradeCargo.lots.push({
    id: 'lot_' + Date.now().toString(36), good, tons, buyCr, world,
    date: (typeof imperialNow === 'function' && typeof formatImperial === 'function') ? formatImperial(imperialNow()) : ''
  });
  saveTradeCargo(); renderCargoPanel();
  if(typeof showToast === 'function') showToast('Cargo lot added');
}
function cargoRemoveLot(id){
  if(!isReferee()) return;
  tradeCargo.lots = (tradeCargo.lots || []).filter(l => l.id !== id);
  saveTradeCargo(); renderCargoPanel();
}
function cargoSetRefWorld(id){ cargoRefWorld = id || ''; renderCargoPanel(); }
// A buy/sell hint from the LIVING ECONOMY's own pressure (-4..+4) at the chosen
// reference world — never a resolved price, and licensing-clean (the sim's own
// goods, not any copyrighted trade table). The referee still rolls the trade.
function cargoSignalChip(good){
  if(typeof ECON === 'undefined' || !cargoRefWorld || !ECON.GOODS || ECON.GOODS[good] == null) return '';
  let p; try { p = ECON.pressure(cargoRefWorld, good); } catch(e){ return ''; }
  if(p == null) return '';
  const cls = p >= 2 ? 'sell' : p <= -2 ? 'buy' : 'flat';
  const txt = p >= 2 ? 'dear here ▲' : p <= -2 ? 'cheap here ▼' : 'steady';
  const lbl = (typeof ECON.worlds === 'function' && (ECON.worlds()[cargoRefWorld] || {}).label) || cargoRefWorld;
  return ` <span class="cargo-sig cargo-sig-${cls}" title="Living-economy signal at ${escQH(lbl)} — the trade check is still yours to roll">${txt}</span>`;
}
function cargoRefSelectHTML(){
  if(typeof ECON === 'undefined' || typeof ECON.worlds !== 'function') return '';
  let ws;
  try { ws = Object.keys(ECON.worlds()).map(id => ({ id, label: (ECON.worlds()[id] || {}).label || id })).sort((a, b) => a.label.localeCompare(b.label)); }
  catch(e){ return ''; }
  if(!ws.length) return '';
  return `<div class="cargo-ref"><label>Market signal at <select onchange="cargoSetRefWorld(this.value)">
    <option value="">— pick a world —</option>
    ${ws.map(w => `<option value="${escQH(w.id)}"${w.id === cargoRefWorld ? ' selected' : ''}>${escQH(w.label)}</option>`).join('')}
  </select></label></div>`;
}
function renderCargoPanel(){
  const body = document.getElementById('cargo-body'); if(!body) return;
  const ref = isReferee();
  const lots = (tradeCargo && Array.isArray(tradeCargo.lots)) ? tradeCargo.lots : [];
  const fmt = (typeof fmtCr === 'function') ? fmtCr : (n => 'Cr' + (Number(n) || 0));
  const countEl = document.getElementById('cargo-count'); if(countEl) countEl.textContent = lots.length;
  const totalTons = lots.reduce((s, l) => s + (Number(l.tons) || 0), 0);
  const totalCr = lots.reduce((s, l) => s + (Number(l.tons) || 0) * (Number(l.buyCr) || 0), 0);
  let list;
  if(!lots.length){
    list = `<div class="cargo-empty">${ref ? 'No cargo tracked. Add a speculative lot below — the trade check itself happens at the table.' : 'The hold is empty.'}</div>`;
  } else {
    list = lots.map(l => {
      const invested = (Number(l.tons) || 0) * (Number(l.buyCr) || 0);
      const del = ref ? `<button class="cargo-del" onclick="cargoRemoveLot('${l.id}')" title="Sold / remove from hold">✕</button>` : '';
      return `<div class="cargo-lot">${del}
        <div class="cargo-lot-hd"><span class="cargo-good">${escQH(l.good)}</span><span class="cargo-tons">${Number(l.tons) || 0} dt</span></div>
        <div class="cargo-lot-meta">Bought ${fmt(l.buyCr)}/dt${l.world ? (' · ' + escQH(l.world)) : ''}${l.date ? (' · ' + escQH(l.date)) : ''} · in ${fmt(invested)}${cargoSignalChip(l.good)}</div>
      </div>`;
    }).join('');
    list += `<div class="cargo-total">Hold: <b>${totalTons} dt</b> · invested <b>${fmt(totalCr)}</b></div>`;
  }
  const goods = (typeof ECON !== 'undefined' && ECON.GOODS) ? Object.keys(ECON.GOODS) : [];
  const datalist = goods.length ? `<datalist id="cargo-goods">${goods.map(g => `<option value="${escQH(g)}">`).join('')}</datalist>` : '';
  const form = ref ? `
    <div class="cargo-add">${datalist}
      <input id="cargo-f-good" list="cargo-goods" placeholder="Good (e.g. Luxury Goods)" maxlength="40">
      <div class="cargo-add-row">
        <input id="cargo-f-tons" type="number" inputmode="numeric" min="0" placeholder="dtons">
        <input id="cargo-f-cr" type="number" inputmode="numeric" min="0" placeholder="Cr / dton">
      </div>
      <input id="cargo-f-world" placeholder="Bought at (world)" maxlength="40">
      <button class="cal-add-btn" onclick="cargoAddLot()">+ Track cargo lot</button>
      <div class="cargo-hint">Prices &amp; trade DMs come from your rulebook (📖 Rules) + the 📈 Economy console — this only records the position.</div>
    </div>` : '';
  body.innerHTML = cargoRefSelectHTML() + list + form;
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDOUTS / EVIDENCE — the referee pushes an image to players' devices
// ═══════════════════════════════════════════════════════════════════════════
// A map, a clue, a photo, a document scan — pushed to everyone or to a single
// player (per-handout audience via canSee(visibleTo), same spoiler gating as the
// rest of the app). Images live in the 'handouts' Storage bucket (js/50); a
// shared 'handouts' metadata key lists them so devices learn of new ones on the
// poll. Referee authors; players view in a lightbox. Referee-only push.
//   handout = { id, name, ver, visibleTo, date }

let handouts = [];
let handoutsPanelOpen = false, handoutsCollapsed = false, _handoutBusy = false;

async function loadHandouts(){
  try { const r = await supaStorage.get('handouts', true); if(r.value != null) handouts = JSON.parse(r.value) || []; }
  catch(e){ handouts = []; }
}
async function saveHandouts(){
  try { await supaStorage.set('handouts', JSON.stringify(handouts), true); }
  catch(e){ console.error('Handouts save failed:', e); }
}
function hoCampaign(){ return (typeof activeCampaignId !== 'undefined') ? activeCampaignId : 'default'; }
function visibleHandouts(){
  const ref = isReferee();
  return handouts.filter(h => ref || (typeof canSee === 'function' ? canSee(h.visibleTo) : true));
}
function toggleHandoutsPanel(){
  handoutsPanelOpen = !handoutsPanelOpen;
  const w = document.getElementById('handouts-wrap'), b = document.getElementById('handouts-btn');
  if(!w) return;
  w.classList.toggle('hidden', !handoutsPanelOpen);
  if(b) b.classList.toggle('panel-open', handoutsPanelOpen);
  if(handoutsPanelOpen) renderHandoutsPanel();
}
function toggleHandoutsCollapse(){
  const h = document.getElementById('handouts-header');
  if(h && h.dataset.suppressClick === '1') return;
  handoutsCollapsed = !handoutsCollapsed;
  document.getElementById('handouts-toggle').textContent = handoutsCollapsed ? '▲' : '▼';
  document.getElementById('handouts-body').classList.toggle('collapsed', handoutsCollapsed);
  document.getElementById('handouts-wrap').classList.toggle('panel-collapsed', handoutsCollapsed);
}
// Downscale the longest side to <=maxDim JPEG (aspect preserved) before upload.
function resizeHandoutImage(file, maxDim){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
}
function onHandoutFile(input){
  if(!isReferee()) return;
  const file = input && input.files && input.files[0];
  if(input) input.value = '';
  if(!file) return;
  if(file.type && !/^image\/(jpeg|png|webp)$/.test(file.type)){ if(typeof showToast === 'function') showToast('Choose a JPG/PNG/WebP image', 'error'); return; }
  if(file.size > 20 * 1024 * 1024){ if(typeof showToast === 'function') showToast('Image too large (max 20 MB source)', 'error'); return; }
  if(_handoutBusy) return;
  _handoutBusy = true; if(typeof showToast === 'function') showToast('Preparing handout…', 'info');
  const id = 'ho_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const vis = (document.getElementById('handout-vis') && document.getElementById('handout-vis').value) || 'all';
  const name = file.name ? file.name.replace(/\.[a-z0-9]+$/i, '') : 'Handout';
  resizeHandoutImage(file, 1600)
    .then(blob => uploadHandoutBlob(hoCampaign(), id, blob))
    .then(() => {
      handouts.push({ id, name, ver: Date.now(), visibleTo: vis,
        date: (typeof imperialNow === 'function' && typeof formatImperial === 'function') ? formatImperial(imperialNow()) : '' });
      return saveHandouts();
    })
    .then(() => { if(typeof showToast === 'function') showToast('Handout pushed to players'); if(handoutsPanelOpen) renderHandoutsPanel(); })
    .catch(err => { if(typeof showToast === 'function') showToast('Handout upload failed — is the handouts bucket set up? (migration 0004)', 'error'); console.error(err); })
    .finally(() => { _handoutBusy = false; });
}
function removeHandout(id){
  if(!isReferee()) return;
  handouts = handouts.filter(h => h.id !== id);
  saveHandouts(); renderHandoutsPanel();
}
function openHandout(id){
  const h = handouts.find(x => x.id === id); if(!h) return;
  if(!isReferee() && typeof canSee === 'function' && !canSee(h.visibleTo)) return;
  const box = document.getElementById('handout-lightbox'), img = document.getElementById('handout-lightbox-img');
  if(!box || !img || typeof handoutUrlFor !== 'function') return;
  img.src = handoutUrlFor(hoCampaign(), h.id, h.ver);
  box.classList.remove('hidden');
}
function closeHandout(){ const b = document.getElementById('handout-lightbox'); if(b) b.classList.add('hidden'); }
function renderHandoutsPanel(){
  const body = document.getElementById('handouts-body'); if(!body) return;
  const ref = isReferee();
  const list = visibleHandouts();
  const countEl = document.getElementById('handouts-count'); if(countEl) countEl.textContent = list.length;
  let grid;
  if(!list.length){
    grid = `<div class="handout-empty">${ref ? 'No handouts yet. Push a map, clue, or photo below.' : 'No handouts shared yet.'}</div>`;
  } else {
    grid = `<div class="handout-grid">` + list.map(h => {
      const url = (typeof handoutUrlFor === 'function') ? handoutUrlFor(hoCampaign(), h.id, h.ver) : '';
      const who = (h.visibleTo && h.visibleTo !== 'all') ? (Array.isArray(h.visibleTo) ? h.visibleTo.join(', ') : h.visibleTo) : 'All';
      const del = ref ? `<button class="handout-del" onclick="event.stopPropagation();removeHandout('${h.id}')" title="Remove">✕</button>` : '';
      // "→ Table" push (js/93) — only when a table display can actually be driven.
      const toTv = (ref && typeof displayCanSend === 'function' && displayCanSend())
        ? `<button class="handout-send" onclick="event.stopPropagation();sendHandoutToTable('${h.id}')" title="Show on the table display">📺</button>` : '';
      return `<div class="handout-thumb" onclick="openHandout('${h.id}')" title="${escQH(h.name || 'Handout')}">
        ${del}${toTv}<img src="${url}" alt="${escQH(h.name || '')}" loading="lazy" onerror="this.style.display='none'">
        <div class="handout-cap">${escQH(h.name || 'Handout')}${ref ? ` · ${escQH(who)}` : ''}</div>
      </div>`;
    }).join('') + `</div>`;
  }
  let form = '';
  if(ref){
    const opts = ['all'].concat((typeof crewRoster === 'function' ? crewRoster() : []));
    const optHtml = opts.map(o => `<option value="${escQH(o)}">${o === 'all' ? 'Everyone' : escQH(o)}</option>`).join('');
    form = `<div class="handout-add">
      <label class="handout-up">⬆ Push a handout<input type="file" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="onHandoutFile(this)"></label>
      <label class="handout-vis-lbl">To <select id="handout-vis">${optHtml}</select></label>
      <div class="cargo-hint">Downscaled to ≤1600px before upload. Send to a single player for a private clue. (Needs the <code>handouts</code> bucket — migration 0004.)</div>
    </div>`;
  }
  body.innerHTML = grid + form;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTACT DOSSIER — the party's contacts, with a shared blurb + per-PC layers
// ═══════════════════════════════════════════════════════════════════════════
// A player-facing "who do we know": patrons, informants, rivals. Separate from
// the referee-only NPC roster (which never syncs to players) — the referee
// PUBLISHES each contact (visibleTo audience) with a shared blurb everyone sees,
// PER-CHARACTER private knowledge ("what Rhett knows"), and a referee-only note.
// Player clients redact to the viewer's own layer (honour-system, like the
// combat/codex redaction — true secrecy needs the get-content path). Shared key
// 'contacts'.
//   contact = { id, name, role, faction, location, blurb, known:{identity:text}, refNote, visibleTo,
//               owner, rel, favOwed, favOwing }
// V2 adds the per-character ledger: `owner` ('' = party contact, or a character
// name — that character's personal contact, visible only to them + referee),
// `rel` relationship type, and favour tallies (favOwed = they owe the party/
// character; favOwing = the party/character owes them). The owning player can
// annotate their own contacts: their `known` layer plus the favour tallies.
// Complements the faction-level reputation tracker; the two stay separate.

const CONTACT_RELS = [['contact','Contact','var(--accentGold)'],['ally','Ally','#7fd07f'],['rival','Rival','#e0b050'],['enemy','Enemy','#d45050']];
function contactRelChip(rel){
  const r = CONTACT_RELS.find(x => x[0] === rel);
  return r ? `<span class="con-rel" style="color:${r[2]};border-color:${r[2]}">${r[1].toUpperCase()}</span>` : '';
}
// Referee edits everything; the owning character may annotate their own contact.
function contactCanAnnotate(c){
  if(typeof isReferee === 'function' && isReferee()) return true;
  return !!(c && c.owner && typeof myIdentity !== 'undefined' && myIdentity && c.owner === myIdentity);
}
function contactFav(id, key, delta){
  const c = contacts.find(x => x.id === id); if(!c || !contactCanAnnotate(c)) return;
  if(key !== 'favOwed' && key !== 'favOwing') return;
  c[key] = Math.max(0, (parseInt(c[key]) || 0) + delta);
  saveContacts(); renderContactsPanel();
}
// Owning player's inline note — writes their own `known` layer (referee uses the editor).
function contactMyNote(id, val){
  const c = contacts.find(x => x.id === id); if(!c || !contactCanAnnotate(c)) return;
  if(typeof myIdentity === 'undefined' || !myIdentity) return;
  c.known = c.known || {};
  if(String(val).trim()) c.known[myIdentity] = val; else delete c.known[myIdentity];
  saveContacts();
}

let contacts = [];
let contactsPanelOpen = false, contactsCollapsed = false, contactsEditingId = null, contactsExpanded = {};

async function loadContacts(){
  try { const r = await supaStorage.get('contacts', true); if(r.value != null) contacts = JSON.parse(r.value) || []; }
  catch(e){ contacts = []; }
}
async function saveContacts(){
  try { await supaStorage.set('contacts', JSON.stringify(contacts), true); }
  catch(e){ console.error('Contacts save failed:', e); }
}
function toggleContactsPanel(){
  contactsPanelOpen = !contactsPanelOpen;
  const w = document.getElementById('contacts-wrap'), b = document.getElementById('contacts-btn');
  if(!w) return;
  w.classList.toggle('hidden', !contactsPanelOpen);
  if(b) b.classList.toggle('panel-open', contactsPanelOpen);
  if(contactsPanelOpen) renderContactsPanel();
}
function toggleContactsCollapse(){
  const h = document.getElementById('contacts-header');
  if(h && h.dataset.suppressClick === '1') return;
  contactsCollapsed = !contactsCollapsed;
  document.getElementById('contacts-toggle').textContent = contactsCollapsed ? '▲' : '▼';
  document.getElementById('contacts-body').classList.toggle('collapsed', contactsCollapsed);
  document.getElementById('contacts-wrap').classList.toggle('panel-collapsed', contactsCollapsed);
}
function contactsToggleExpand(id){ contactsExpanded[id] = !contactsExpanded[id]; renderContactsPanel(); }
function contactAdd(){
  if(!isReferee()) return;
  const c = { id: 'con_' + Date.now().toString(36), name: '', role: '', faction: '', location: '', blurb: '', known: {}, refNote: '', visibleTo: 'all', owner: '', rel: 'contact', favOwed: 0, favOwing: 0 };
  contacts.push(c); contactsEditingId = c.id; contactsExpanded[c.id] = true;
  renderContactsPanel(); const f = document.getElementById('contact-f-name'); if(f) f.focus();
}
function contactEdit(id){ if(!isReferee()) return; contactsEditingId = (contactsEditingId === id ? null : id); renderContactsPanel(); }
function contactCancel(){ contactsEditingId = null; renderContactsPanel(); }
function contactSave(){
  if(!isReferee() || !contactsEditingId) return;
  const c = contacts.find(x => x.id === contactsEditingId); if(!c) return;
  const gv = id => (document.getElementById(id) && document.getElementById(id).value) || '';
  c.name = gv('contact-f-name').trim() || 'Contact';
  c.role = gv('contact-f-role'); c.faction = gv('contact-f-faction'); c.location = gv('contact-f-location');
  c.blurb = gv('contact-f-blurb'); c.refNote = gv('contact-f-refnote');
  c.visibleTo = (typeof parseCalVis === 'function') ? parseCalVis(gv('contact-f-vis')) : 'all';
  c.owner = gv('contact-f-owner');
  c.rel = gv('contact-f-rel') || 'contact';
  c.favOwed = Math.max(0, parseInt(gv('contact-f-favowed')) || 0);
  c.favOwing = Math.max(0, parseInt(gv('contact-f-favowing')) || 0);
  c.known = c.known || {};
  (typeof crewRoster === 'function' ? crewRoster() : []).forEach((nm, i) => {
    const v = gv('contact-f-known-' + i).trim(); if(v) c.known[nm] = v; else delete c.known[nm];
  });
  contactsEditingId = null;
  saveContacts(); renderContactsPanel();
  if(typeof showToast === 'function') showToast('Contact saved');
}
function contactRemove(id){
  if(!isReferee()) return;
  if(!confirm('Remove this contact?')) return;
  contacts = contacts.filter(c => c.id !== id);
  if(contactsEditingId === id) contactsEditingId = null;
  saveContacts(); renderContactsPanel();
}
function contactEditorHTML(c){
  const escA = (typeof escAttr === 'function') ? escAttr : (x => String(x == null ? '' : x).replace(/"/g, '&quot;'));
  const chars = (typeof crewRoster === 'function') ? crewRoster() : [];
  const visRaw = (typeof calVisRaw === 'function') ? calVisRaw(c.visibleTo) : '';
  const knownFields = chars.map((nm, i) => `<label class="con-known-lbl">${escQH(nm)} knows<textarea id="contact-f-known-${i}" rows="2" placeholder="What ${escQH(nm)} knows…">${escQH((c.known && c.known[nm]) || '')}</textarea></label>`).join('');
  const ownerOpts = ['<option value="">Party contact (shared)</option>'].concat(chars.map(nm => `<option value="${escA(nm)}"${c.owner === nm ? ' selected' : ''}>${escQH(nm)}'s contact</option>`)).join('');
  const relOpts = CONTACT_RELS.map(([v, lbl]) => `<option value="${v}"${(c.rel || 'contact') === v ? ' selected' : ''}>${lbl}</option>`).join('');
  return `<div class="con-edit">
    <input id="contact-f-name" placeholder="Name" maxlength="60" value="${escA(c.name)}">
    <div class="con-edit-row"><input id="contact-f-role" placeholder="Role" maxlength="50" value="${escA(c.role)}"><input id="contact-f-faction" placeholder="Faction" maxlength="50" value="${escA(c.faction)}"></div>
    <div class="con-edit-row"><input id="contact-f-location" placeholder="Where (system / station)" maxlength="50" value="${escA(c.location)}"><input id="contact-f-vis" placeholder="all / referee / Rhett Calder" value="${escA(visRaw)}"></div>
    <div class="con-edit-row"><select id="contact-f-owner" title="Whose contact is this? A character's personal contact is visible only to them (and you)">${ownerOpts}</select><select id="contact-f-rel" title="Relationship type">${relOpts}</select></div>
    <div class="con-edit-row con-fav-edit"><label>Favours they owe<input id="contact-f-favowed" type="number" inputmode="numeric" min="0" value="${parseInt(c.favOwed) || 0}"></label><label>Favours owed to them<input id="contact-f-favowing" type="number" inputmode="numeric" min="0" value="${parseInt(c.favOwing) || 0}"></label></div>
    <textarea id="contact-f-blurb" rows="2" placeholder="Shared blurb — what everyone knows">${escQH(c.blurb || '')}</textarea>
    <div class="con-known-grid">${knownFields}</div>
    <textarea id="contact-f-refnote" rows="2" placeholder="Referee-only note (honour-system)">${escQH(c.refNote || '')}</textarea>
    <div class="con-edit-row"><button class="cal-add-btn" style="flex:1" onclick="contactSave()">Save contact</button><button class="dt-mini" onclick="contactCancel()">Cancel</button></div>
  </div>`;
}
function renderContactsPanel(){
  const body = document.getElementById('contacts-body'); if(!body) return;
  const ref = isReferee();
  // Party contacts follow the audience rule; a character's personal contact is
  // theirs alone (plus the referee) regardless of visibleTo.
  const visible = contacts.filter(c => ref || ((!c.owner || c.owner === myIdentity) && (typeof canSee === 'function' ? canSee(c.visibleTo) : true)));
  const cnt = document.getElementById('contacts-count'); if(cnt) cnt.textContent = visible.length;
  let list;
  if(!visible.length){
    list = `<div class="wiki-empty">${ref ? "No contacts yet. Add the party's patrons, informants, and rivals below." : 'No contacts recorded yet.'}</div>`;
  } else {
    list = visible.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(c => {
      if(ref && contactsEditingId === c.id) return `<div class="con-card editing">${contactEditorHTML(c)}</div>`;
      const exp = !!contactsExpanded[c.id];
      const canAnn = contactCanAnnotate(c);
      const mineKnown = (!ref && c.known && myIdentity) ? c.known[myIdentity] : '';
      const meta = [c.role, c.faction, c.location].filter(Boolean).map(x => escQH(x)).join(' · ');
      const ctl = ref ? `<span class="wiki-ctl"><button class="dt-mini" onclick="event.stopPropagation();contactEdit('${c.id}')">✏</button><button class="dt-mini del" onclick="event.stopPropagation();contactRemove('${c.id}')">✕</button></span>` : '';
      const ownerChip = c.owner ? `<span class="con-owner">${ref ? escQH(c.owner) : 'YOURS'}</span>` : '';
      let detail = '';
      if(exp){
        if(c.blurb) detail += `<div class="con-blurb">${escQH(c.blurb).replace(/\n/g, '<br>')}</div>`;
        if(ref){
          const layers = Object.keys(c.known || {}).map(nm => `<div class="con-layer"><span class="con-layer-who">${escQH(nm)}</span> ${escQH(c.known[nm]).replace(/\n/g, '<br>')}</div>`).join('');
          if(layers) detail += `<div class="con-layers">${layers}</div>`;
          if(c.refNote) detail += `<div class="con-refnote">↳ ${escQH(c.refNote).replace(/\n/g, '<br>')}</div>`;
        } else if(mineKnown && !canAnn){
          detail += `<div class="con-layer mine"><span class="con-layer-who">You know</span> ${escQH(mineKnown).replace(/\n/g, '<br>')}</div>`;
        }
        // Favour ledger — tallied by the referee or the owning character.
        const owed = parseInt(c.favOwed) || 0, owing = parseInt(c.favOwing) || 0;
        if(owed || owing || canAnn){
          const step = key => canAnn ? `<button class="dt-mini" onclick="contactFav('${c.id}','${key}',-1)">−</button><button class="dt-mini" onclick="contactFav('${c.id}','${key}',1)">+</button>` : '';
          detail += `<div class="con-fav"><span>They owe <b>${owed}</b> ${step('favOwed')}</span><span>Owed to them <b>${owing}</b> ${step('favOwing')}</span></div>`;
        }
        // Owning player annotates their own contact in place.
        if(!ref && canAnn){
          detail += `<textarea class="con-mynote" rows="2" placeholder="Your notes on this contact…" onchange="contactMyNote('${c.id}', this.value)">${escQH((c.known && c.known[myIdentity]) || '')}</textarea>`;
        }
      }
      return `<div class="con-card">
        <div class="con-hd" onclick="contactsToggleExpand('${c.id}')">
          <span class="con-name">${escQH(c.name || 'Contact')}</span>
          ${contactRelChip(c.rel)}${ownerChip}
          ${meta ? `<span class="con-meta">${meta}</span>` : ''}
          ${ctl}<span class="wiki-exp">${exp ? '▲' : '▼'}</span>
        </div>
        ${detail}
      </div>`;
    }).join('');
  }
  body.innerHTML = list + (ref ? `<button class="cal-add-btn" style="width:100%" onclick="contactAdd()">+ New contact</button>` : '');
}

// ═══════════════════════════════════════════════════════════════════════════
// WIKI / ENCYCLOPEDIA — referee-curated lore articles (players read)
// ═══════════════════════════════════════════════════════════════════════════
// Long-form campaign canon the Codex (short fog-gated entries) doesn't fit:
// faction write-ups, places, history, tech. Referee authors; players read what
// their audience permits (canSee(visibleTo)). Referee-only editing (a V2 wiki);
// player contribution would reuse the Codex pending pattern later. Shared 'wiki'.
//   article = { id, title, category, body, visibleTo, updatedAt }

const WIKI_CATEGORIES = [['lore','Lore'],['faction','Faction'],['location','Location'],['history','History'],['tech','Tech'],['person','Person'],['other','Other']];
let wikiArticles = [];
let wikiPanelOpen = false, wikiCollapsed = false, wikiEditingId = null, wikiExpanded = {};

async function loadWiki(){
  try { const r = await supaStorage.get('wiki', true); if(r.value != null) wikiArticles = JSON.parse(r.value) || []; }
  catch(e){ wikiArticles = []; }
}
async function saveWiki(){
  try { await supaStorage.set('wiki', JSON.stringify(wikiArticles), true); }
  catch(e){ console.error('Wiki save failed:', e); }
}
function toggleWikiPanel(){
  wikiPanelOpen = !wikiPanelOpen;
  const w = document.getElementById('wiki-wrap'), b = document.getElementById('wiki-btn');
  if(!w) return;
  w.classList.toggle('hidden', !wikiPanelOpen);
  if(b) b.classList.toggle('panel-open', wikiPanelOpen);
  if(wikiPanelOpen) renderWikiPanel();
}
function toggleWikiCollapse(){
  const h = document.getElementById('wiki-header');
  if(h && h.dataset.suppressClick === '1') return;
  wikiCollapsed = !wikiCollapsed;
  document.getElementById('wiki-toggle').textContent = wikiCollapsed ? '▲' : '▼';
  document.getElementById('wiki-body').classList.toggle('collapsed', wikiCollapsed);
  document.getElementById('wiki-wrap').classList.toggle('panel-collapsed', wikiCollapsed);
}
function wikiToggleExpand(id){ wikiExpanded[id] = !wikiExpanded[id]; renderWikiPanel(); }
function wikiCatLabel(c){ const f = WIKI_CATEGORIES.find(x => x[0] === c); return f ? f[1] : (c || ''); }
function saveWikiArticle(){
  if(!isReferee()) return;
  const gv = id => (document.getElementById(id) && document.getElementById(id).value) || '';
  const title = gv('wiki-f-title').trim(); if(!title) return;
  const category = gv('wiki-f-cat');
  const bodyTxt = gv('wiki-f-body');
  const visibleTo = (typeof parseCalVis === 'function') ? parseCalVis(gv('wiki-f-vis')) : 'all';
  const date = (typeof imperialNow === 'function' && typeof formatImperial === 'function') ? formatImperial(imperialNow()) : '';
  if(wikiEditingId){
    const a = wikiArticles.find(x => x.id === wikiEditingId);
    if(a){ a.title = title; a.category = category; a.body = bodyTxt; a.visibleTo = visibleTo; a.updatedAt = date; }
    wikiEditingId = null;
  } else {
    wikiArticles.push({ id: 'wiki_' + Date.now().toString(36), title, category, body: bodyTxt, visibleTo, updatedAt: date });
  }
  saveWiki(); renderWikiPanel();
  if(typeof showToast === 'function') showToast('Article saved');
}
function editWikiArticle(id){ if(!isReferee()) return; wikiEditingId = id; renderWikiPanel(); const f = document.getElementById('wiki-f-title'); if(f) f.scrollIntoView({ block:'nearest' }); }
function cancelWikiEdit(){ wikiEditingId = null; renderWikiPanel(); }
function deleteWikiArticle(id){
  if(!isReferee()) return;
  if(!confirm('Delete this article? This cannot be undone.')) return;
  wikiArticles = wikiArticles.filter(a => a.id !== id);
  if(wikiEditingId === id) wikiEditingId = null;
  saveWiki(); renderWikiPanel();
}
function renderWikiForm(){
  const editing = wikiEditingId ? wikiArticles.find(a => a.id === wikiEditingId) : null;
  const escA = (typeof escAttr === 'function') ? escAttr : (x => String(x == null ? '' : x).replace(/"/g, '&quot;'));
  const catOpts = WIKI_CATEGORIES.map(c => `<option value="${c[0]}"${editing && editing.category === c[0] ? ' selected' : ''}>${c[1]}</option>`).join('');
  const visRaw = (typeof calVisRaw === 'function' && editing) ? calVisRaw(editing.visibleTo) : '';
  return `<div class="wiki-add">
    <div class="wiki-add-ttl">${editing ? 'Edit article' : 'New article'}</div>
    <input id="wiki-f-title" placeholder="Title…" maxlength="80" value="${editing ? escA(editing.title) : ''}">
    <div class="wiki-add-row">
      <select id="wiki-f-cat">${catOpts}</select>
      <input id="wiki-f-vis" placeholder="all / referee / Rhett Calder" value="${editing ? escA(visRaw) : ''}">
    </div>
    <textarea id="wiki-f-body" rows="5" placeholder="Article text…">${editing ? escQH(editing.body || '') : ''}</textarea>
    <div class="wiki-add-row">
      <button class="cal-add-btn" style="flex:1" onclick="saveWikiArticle()">${editing ? 'Save changes' : '+ Add article'}</button>
      ${editing ? `<button class="dt-mini" onclick="cancelWikiEdit()">Cancel</button>` : ''}
    </div>
  </div>`;
}
function renderWikiPanel(){
  const body = document.getElementById('wiki-body'); if(!body) return;
  const ref = isReferee();
  const visible = wikiArticles.filter(a => ref || (typeof canSee === 'function' ? canSee(a.visibleTo) : true));
  const countEl = document.getElementById('wiki-count'); if(countEl) countEl.textContent = visible.length;
  let list;
  if(!visible.length){
    list = `<div class="wiki-empty">${ref ? 'No articles yet. Write campaign lore, factions, or places below.' : 'No lore published yet.'}</div>`;
  } else {
    list = visible.slice().sort((a, b) => (a.title || '').localeCompare(b.title || '')).map(a => {
      const exp = !!wikiExpanded[a.id];
      const ctl = ref ? `<span class="wiki-ctl"><button class="dt-mini" onclick="event.stopPropagation();editWikiArticle('${a.id}')">✏</button><button class="dt-mini del" onclick="event.stopPropagation();deleteWikiArticle('${a.id}')">✕</button></span>` : '';
      return `<div class="wiki-art">
        <div class="wiki-art-hd" onclick="wikiToggleExpand('${a.id}')">
          <span class="wiki-cat">${escQH(wikiCatLabel(a.category))}</span>
          <span class="wiki-title">${escQH(a.title)}</span>
          ${ctl}<span class="wiki-exp">${exp ? '▲' : '▼'}</span>
        </div>
        ${exp ? `<div class="wiki-body-txt">${escQH(a.body || '').replace(/\n/g, '<br>')}</div>${a.updatedAt ? `<div class="wiki-meta">Updated ${escQH(a.updatedAt)}</div>` : ''}` : ''}
      </div>`;
    }).join('');
  }
  body.innerHTML = list + (ref ? renderWikiForm() : '');
}

// ═══════════════════════════════════════════════════════════════════════════
// DOWNTIME LOG — between-jump actions (players declare, referee resolves)
// ═══════════════════════════════════════════════════════════════════════════
// A jump takes ~1 week; this is where a player says "I'll train Gun Combat /
// repair the ship / meet my contact" during the passage, and the referee
// resolves it between sessions. NEVER auto-resolved — Traveller training is
// time-based (track weeks, not XP). Shared key 'downtime'; a player sees/authors
// their own entries, the referee sees & resolves all.
//   entry = { id, by, action, kind, weeks, status:'planned'|'done'|'failed', outcome, date }

const DOWNTIME_KINDS = [['training','Training'],['repair','Ship Repair'],['contact','Contact / Network'],['research','Research'],['rest','Rest / Recover'],['trade','Trade / Broker'],['other','Other']];
let downtime = [];
let downtimePanelOpen = false, downtimeCollapsed = false;

async function loadDowntime(){
  try { const r = await supaStorage.get('downtime', true); if(r.value != null) downtime = JSON.parse(r.value) || []; }
  catch(e){ downtime = []; }
}
async function saveDowntime(){
  try { await supaStorage.set('downtime', JSON.stringify(downtime), true); }
  catch(e){ console.error('Downtime save failed:', e); }
}
function toggleDowntimePanel(){
  downtimePanelOpen = !downtimePanelOpen;
  const w = document.getElementById('downtime-wrap'), b = document.getElementById('downtime-btn');
  if(!w) return;
  w.classList.toggle('hidden', !downtimePanelOpen);
  if(b) b.classList.toggle('panel-open', downtimePanelOpen);
  if(downtimePanelOpen) renderDowntimePanel();
}
function toggleDowntimeCollapse(){
  const h = document.getElementById('downtime-header');
  if(h && h.dataset.suppressClick === '1') return;
  downtimeCollapsed = !downtimeCollapsed;
  document.getElementById('downtime-toggle').textContent = downtimeCollapsed ? '▲' : '▼';
  document.getElementById('downtime-body').classList.toggle('collapsed', downtimeCollapsed);
  document.getElementById('downtime-wrap').classList.toggle('panel-collapsed', downtimeCollapsed);
}
function addDowntime(){
  if(!myIdentity){ if(typeof showToast === 'function') showToast('Set your character first', 'error'); return; }
  const gv = id => (document.getElementById(id) && document.getElementById(id).value || '').trim();
  const action = gv('dt-f-action'); if(!action) return;
  downtime.push({
    id: 'dt_' + Date.now().toString(36), by: myIdentity, action,
    kind: gv('dt-f-kind') || 'other', weeks: Math.max(0, Number(gv('dt-f-weeks')) || 0),
    status: 'planned', outcome: '',
    date: (typeof imperialNow === 'function' && typeof formatImperial === 'function') ? formatImperial(imperialNow()) : ''
  });
  saveDowntime(); renderDowntimePanel();
  if(typeof showToast === 'function') showToast('Downtime action logged');
}
function resolveDowntime(id, ok){
  if(!isReferee()) return;
  const e = downtime.find(x => x.id === id); if(!e) return;
  let outcome = '';
  try { const r = prompt(ok ? 'Outcome (what happened):' : 'Why it failed / what happened:', e.outcome || ''); if(r === null) return; outcome = r.trim(); } catch(err){}
  e.status = ok ? 'done' : 'failed'; e.outcome = outcome;
  saveDowntime(); renderDowntimePanel();
}
function reopenDowntime(id){
  if(!isReferee()) return;
  const e = downtime.find(x => x.id === id); if(!e) return;
  e.status = 'planned'; e.outcome = '';
  saveDowntime(); renderDowntimePanel();
}
function removeDowntime(id){
  const e = downtime.find(x => x.id === id); if(!e) return;
  if(!isReferee() && !(e.by === myIdentity && e.status === 'planned')) return; // players cancel only their own un-resolved
  downtime = downtime.filter(x => x.id !== id);
  saveDowntime(); renderDowntimePanel();
}
function renderDowntimePanel(){
  const body = document.getElementById('downtime-body'); if(!body) return;
  const ref = isReferee();
  const visible = downtime.filter(e => ref || e.by === myIdentity);
  const countEl = document.getElementById('downtime-count');
  if(countEl) countEl.textContent = visible.filter(e => e.status === 'planned').length;
  const kindLbl = k => { const f = DOWNTIME_KINDS.find(x => x[0] === k); return f ? f[1] : k; };
  let list;
  if(!visible.length){
    list = `<div class="dt-empty">${ref ? 'No downtime logged. Players declare between-jump actions here.' : (myIdentity ? 'No downtime yet. Log what you do during the jump below.' : 'Set your character to log downtime.')}</div>`;
  } else {
    const rank = s => s === 'planned' ? 0 : 1;
    list = visible.slice().sort((a, b) => rank(a.status) - rank(b.status)).map(e => {
      const mine = e.by === myIdentity, st = e.status;
      const badge = st === 'done' ? '<span class="dt-badge done">Resolved</span>' : st === 'failed' ? '<span class="dt-badge fail">Failed</span>' : '<span class="dt-badge">Planned</span>';
      const ctl = ref
        ? (st === 'planned'
            ? `<div class="dt-ctl"><button class="dt-mini ok" onclick="resolveDowntime('${e.id}',true)">✓ Resolve</button><button class="dt-mini bad" onclick="resolveDowntime('${e.id}',false)">✗ Failed</button><button class="dt-mini del" onclick="removeDowntime('${e.id}')">🗑</button></div>`
            : `<div class="dt-ctl"><button class="dt-mini" onclick="reopenDowntime('${e.id}')">↺ Reopen</button><button class="dt-mini del" onclick="removeDowntime('${e.id}')">🗑</button></div>`)
        : (mine && st === 'planned' ? `<div class="dt-ctl"><button class="dt-mini del" onclick="removeDowntime('${e.id}')">Cancel</button></div>` : '');
      return `<div class="dt-entry dt-${st}">
        <div class="dt-entry-hd">${ref ? `<span class="dt-by">${escQH(e.by)}</span>` : ''}<span class="dt-kind">${escQH(kindLbl(e.kind))}${e.weeks ? ' · ' + e.weeks + 'wk' : ''}</span>${badge}</div>
        <div class="dt-action">${escQH(e.action)}</div>
        ${e.outcome ? `<div class="dt-outcome">↳ ${escQH(e.outcome)}</div>` : ''}
        ${ctl}
      </div>`;
    }).join('');
  }
  const form = myIdentity ? `
    <div class="dt-add">
      <input id="dt-f-action" placeholder="What do you do during the jump?" maxlength="120">
      <div class="dt-add-row">
        <select id="dt-f-kind">${DOWNTIME_KINDS.map(k => `<option value="${k[0]}">${k[1]}</option>`).join('')}</select>
        <input id="dt-f-weeks" type="number" inputmode="numeric" min="0" placeholder="weeks" style="max-width:72px">
      </div>
      <button class="cal-add-btn" onclick="addDowntime()">+ Log downtime</button>
      <div class="cargo-hint">The referee resolves this between sessions — training is time (weeks), not points.</div>
    </div>` : '';
  body.innerHTML = list + form;
}

// ═══════════════════════════════════════════════════════════════════════════
// "SINCE YOU WERE LAST HERE" DIGEST — between-session continuity for players
// ═══════════════════════════════════════════════════════════════════════════
// A returning player gets a one-shot summary of what changed since they last
// left: Imperial date advance, party-funds delta, new Codex intel, resolved
// missions, new session recaps. Pure diff of already-loaded shared state against
// a per-device baseline in localStorage — no new shared key, no backend. Built
// as a self-contained inline-styled overlay (no index.html / css/app.css
// footprint) so it can't collide with other UI work. Players only; the referee
// is the source of the changes.

function _digestSnapshot(){
  const codex = (typeof discoveryLog !== 'undefined')
    ? discoveryLog.filter(e => (typeof discViewerStage === 'function') ? discViewerStage(e) : true).length : 0;
  const jrnl = (typeof sessionLog !== 'undefined')
    ? sessionLog.filter(e => (typeof canSee === 'function') ? canSee(e.visibleTo) : true).length : 0;
  const q = (typeof questLog !== 'undefined') ? questLog.filter(x => x.status !== 'hidden') : [];
  return {
    date: (typeof formatImperial === 'function' && typeof imperialDate !== 'undefined') ? formatImperial(imperialDate) : '',
    funds: (typeof funds !== 'undefined') ? (Number(funds.party) || 0) : 0,
    quests: q.length,
    questsDone: q.filter(x => x.status === 'complete').length,
    codex, journal: jrnl
  };
}
function _saveDigestBaseline(){
  try { localStorage.setItem('aurelia_lastseen', JSON.stringify(_digestSnapshot())); } catch(e){}
}
function _isPlayerViewer(){ return !(typeof isReferee === 'function' && isReferee()); }

function showSinceLastSessionDigest(){
  if(!_isPlayerViewer()) return;                                  // referee is the source
  try { if(!localStorage.getItem('aurelia_access')) return; } catch(e){ return; } // still at the gate
  let last = null;
  try { last = JSON.parse(localStorage.getItem('aurelia_lastseen') || 'null'); } catch(e){}
  if(!last){ _saveDigestBaseline(); return; }                     // first visit on this device → seed only
  const now = _digestSnapshot();
  const lines = [];
  if(last.date && now.date && last.date !== now.date)
    lines.push('🗓 Imperial date is now <b>' + escQH(now.date) + '</b> <span style="opacity:.6">(was ' + escQH(last.date) + ')</span>.');
  const df = now.funds - (Number(last.funds) || 0);
  if(df) lines.push('💰 Party funds ' + (df > 0 ? '+' : '−') + 'Cr ' + Math.abs(df).toLocaleString() + ' <span style="opacity:.6">(now Cr ' + now.funds.toLocaleString() + ')</span>.');
  const dc = now.codex - (Number(last.codex) || 0);
  if(dc > 0) lines.push('🗂 ' + dc + ' new Codex entr' + (dc === 1 ? 'y' : 'ies') + ' to read.');
  const dd = now.questsDone - (Number(last.questsDone) || 0);
  if(dd > 0) lines.push('📜 ' + dd + ' mission' + (dd === 1 ? '' : 's') + ' resolved.');
  else if(now.quests !== last.quests) lines.push('📜 The mission log was updated.');
  const dj = now.journal - (Number(last.journal) || 0);
  if(dj > 0) lines.push('📓 ' + dj + ' new session recap' + (dj === 1 ? '' : 's') + ' in the journal.');
  if(!lines.length) return;
  _renderDigestCard(lines);
}
function _renderDigestCard(lines){
  const old = document.getElementById('since-digest'); if(old) old.remove();
  const card = document.createElement('div');
  card.id = 'since-digest';
  card.setAttribute('style', [
    'position:fixed', 'left:50%', 'top:64px', 'transform:translateX(-50%)', 'z-index:200',
    'max-width:min(440px,92vw)', 'background:var(--bg1)', 'border:1px solid var(--accentGold)',
    'border-radius:10px', 'box-shadow:0 8px 32px rgba(0,0,0,.55)', 'padding:14px 16px',
    'color:var(--tx0)', 'font-size:12.5px', 'line-height:1.6'
  ].join(';'));
  card.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px">' +
      '<span style="font-family:monospace;font-weight:700;letter-spacing:1px;color:var(--accentGold);font-size:11px">◈ SINCE YOU WERE LAST HERE</span>' +
      '<button onclick="dismissDigest()" aria-label="Dismiss" style="background:transparent;border:none;color:var(--tx1);cursor:pointer;font-size:15px;line-height:1">✕</button>' +
    '</div>' +
    '<div>' + lines.map(l => '<div style="margin:3px 0">' + l + '</div>').join('') + '</div>';
  document.body.appendChild(card);
  try { card._t = setTimeout(() => { const c = document.getElementById('since-digest'); if(c) c.remove(); }, 16000); } catch(e){}
}
function dismissDigest(){ const c = document.getElementById('since-digest'); if(c){ try { clearTimeout(c._t); } catch(e){} c.remove(); } }

// Refresh the baseline when the player leaves so next visit diffs against the
// state they actually last saw (visibilitychange is the mobile-reliable signal).
try {
  document.addEventListener('visibilitychange', () => { if(document.hidden && _isPlayerViewer()) _saveDigestBaseline(); });
  window.addEventListener('beforeunload', () => { if(_isPlayerViewer()) _saveDigestBaseline(); });
} catch(e){}
// Fire once after boot has settled (data loaded, splash/gate cleared for a
// returning, already-unlocked player).
setTimeout(() => { try { showSinceLastSessionDigest(); } catch(e){} }, 5000);

// ═══════════════════════════════════════════════════════════════════════════
// WHISPER NOTES — panel UI (table-presentation plan §8)
// ───────────────────────────────────────────────────────────────────────────
// The one in-person use for "chat": a player passes the referee a secret note
// without the table seeing, and the referee replies privately. NOT a chat
// system — no player↔player messages, no group channel, no history browser.
// Data flow lives in js/50 (supaStorage.sendWhisper → put-state append) and
// js/55 (pollWhispers → get-content {whispersOnly:true}, whisperItems,
// whisperUnreadCount). Redaction is SERVER-side: this code never receives
// another player's items, so there is no canSee() filtering to forget here —
// only the mine/reply split for layout. Never rendered in display mode.
let whispersPanelOpen = false, whispersCollapsed = false, whispersShowResolved = false;

function toggleWhispersPanel(){
  if(typeof DISPLAY_MODE !== 'undefined' && DISPLAY_MODE) return;  // never on the table TV
  whispersPanelOpen = !whispersPanelOpen;
  const w = document.getElementById('whispers-wrap'), b = document.getElementById('whisper-btn');
  if(w) w.classList.toggle('hidden', !whispersPanelOpen);
  if(b) b.classList.toggle('panel-open', whispersPanelOpen);
  if(whispersPanelOpen){
    renderWhispersPanel();                        // instant, from the last poll
    if(typeof pollWhispers === 'function') pollWhispers();  // then refresh from the server
  }
}
function toggleWhispersCollapse(){
  const h = document.getElementById('whispers-header'); if(h && h.dataset.suppressClick === '1') return;
  whispersCollapsed = !whispersCollapsed;
  document.getElementById('whispers-toggle').textContent = whispersCollapsed ? '▲' : '▼';
  document.getElementById('whispers-body').classList.toggle('collapsed', whispersCollapsed);
  document.getElementById('whispers-wrap').classList.toggle('panel-collapsed', whispersCollapsed);
}

function wspTime(ts){
  const d = new Date(ts); if(isNaN(d)) return '';
  const hm = String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  return (d.toDateString() === new Date().toDateString()) ? hm : (d.getDate() + '/' + (d.getMonth()+1) + ' ' + hm);
}
// Whispers queued offline (unique 'whisper#…' keys in the js/50 outbound
// queue) — rendered as "sending…" rows so a composed-offline note is visibly
// not lost. They disappear from the queue (and appear in the thread) on flush.
function whisperPendingItems(){
  try {
    const q = (typeof loadQueue === 'function') ? loadQueue() : {};
    return Object.keys(q).filter(k => k.startsWith('whisper#'))
      .map(k => { try { return JSON.parse(q[k].value); } catch(e){ return null; } })
      .filter(Boolean);
  } catch(e){ return []; }
}

function updateWhisperBadge(){
  const n = (typeof whisperUnreadCount === 'function') ? whisperUnreadCount() : 0;
  const inPanel = document.getElementById('whispers-count');
  if(inPanel){ inPanel.textContent = n; inPanel.classList.toggle('hidden', !n); }
  const inMenu = document.getElementById('whisper-badge');
  if(inMenu){ inMenu.textContent = n; inMenu.classList.toggle('hidden', !n); }
  const more = document.getElementById('more-btn');
  if(more) more.classList.toggle('wsp-unread', n > 0);
}

function renderWhispersPanel(){
  const body = document.getElementById('whispers-body'); if(!body) return;
  const esc = (typeof escQH === 'function') ? escQH : (x => String(x == null ? '' : x));
  const token = (typeof getContentToken === 'function') ? getContentToken() : '';
  if(!token){
    body.innerHTML = '<div class="cal-empty">Whispers need an access token — apply yours in Settings → Secure Content.</div>';
    return;
  }
  // A poll-driven re-render (4s player / 8s referee) must never eat a
  // half-typed note or reply: capture every composer's text + focus before
  // replacing the DOM, restore straight after.
  const keep = {}; let focusId = null;
  body.querySelectorAll('input').forEach(i => {
    if(i.value) keep[i.id] = i.value;
    if(i === document.activeElement) focusId = i.id;
  });
  const items = Array.isArray(whisperItems) ? whisperItems : [];
  const repliesTo = id => items.filter(r => r && r.ref && r.re === id);
  const replyHTML = r => `<div class="wsp-reply">${esc(r.text)}<span class="wsp-meta"> · ${wspTime(r.ts)}</span></div>`;
  let html = '';

  if(isReferee()){
    // Referee: every player note, newest first; inline private reply; resolve
    // collapses the item out of the default list (kept, not deleted).
    const notes = items.filter(it => it && !it.ref).slice().reverse();
    const open = notes.filter(n => !n.resolved), done = notes.filter(n => n.resolved);
    const card = n => `<div class="wsp-card${n.resolved ? ' wsp-done' : ''}">
      <div class="wsp-hd"><span class="wsp-from">${esc(n.from || '?')}</span><span class="wsp-meta">${wspTime(n.ts)}</span>
        <button class="disc-mini" onclick="whisperSetResolved('${esc(n.id)}', ${n.resolved ? 'false' : 'true'})" title="${n.resolved ? 'Reopen' : 'Resolved — collapse it'}">${n.resolved ? '↺' : '✓'}</button>
      </div>
      ${n.resolved ? '' : `<div class="wsp-txt">${esc(n.text)}</div>${repliesTo(n.id).map(replyHTML).join('')}
      <div class="wsp-compose"><input id="wsp-re-${esc(n.id)}" maxlength="2000" placeholder="Reply privately to ${esc(n.from || 'them')}…" onkeydown="if(event.key==='Enter')whisperReplySend('${esc(n.id)}')"><button onclick="whisperReplySend('${esc(n.id)}')">Send</button></div>`}
    </div>`;
    html += open.length ? open.map(card).join('') : '<div class="cal-empty">No open whispers. Players send them from ⋯ More → Whispers.</div>';
    if(done.length){
      html += `<button class="wsp-show-done" onclick="whispersShowResolved=!whispersShowResolved;renderWhispersPanel()">${whispersShowResolved ? 'Hide' : 'Show'} resolved (${done.length})</button>`;
      if(whispersShowResolved) html += done.map(card).join('');
    }
  } else {
    // Player: their own thread only (the server sent nothing else) + composer.
    // Standing entries also ride this channel (ref:true) — keep them out of the note thread.
    const std = (typeof isStandingNote === 'function') ? isStandingNote : (() => false);
    const mine = items.filter(it => it && !it.ref);
    const orphanReplies = items.filter(it => it && it.ref && !std(it) && !mine.some(n => n.id === it.re));
    html += mine.map(n => `<div class="wsp-card">
        <div class="wsp-hd"><span class="wsp-from">You</span><span class="wsp-meta">${wspTime(n.ts)}</span></div>
        <div class="wsp-txt">${esc(n.text)}</div>
        ${repliesTo(n.id).map(replyHTML).join('')}
      </div>`).join('');
    if(orphanReplies.length) html += orphanReplies.map(r => `<div class="wsp-card">${replyHTML(r)}</div>`).join('');
    html += whisperPendingItems().map(p => `<div class="wsp-card"><div class="wsp-pending">📨 ${esc(p.text)} — sending when back online…</div></div>`).join('');
    if(!html) html = '<div class="cal-empty">Pass the referee a note no one else sees — "I pocket the data crystal".</div>';
    html += `<div class="wsp-compose"><input id="wsp-compose-input" maxlength="2000" placeholder="Whisper to the referee…" onkeydown="if(event.key==='Enter')whisperComposerSend()"><button onclick="whisperComposerSend()">Send</button></div>`;
  }

  body.innerHTML = html;
  Object.keys(keep).forEach(id => { const i = document.getElementById(id); if(i && !i.value) i.value = keep[id]; });
  if(focusId){ const i = document.getElementById(focusId); if(i){ i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch(e){} } }
  if(typeof whisperMarkSeen === 'function') whisperMarkSeen();  // rendering = reading
}

async function whisperComposerSend(){
  const el = document.getElementById('wsp-compose-input'); if(!el) return;
  const text = (el.value || '').trim(); if(!text) return;
  el.value = '';
  const r = await supaStorage.sendWhisper({ text });
  if(r.ok && typeof pollWhispers === 'function') await pollWhispers();
  else if(!r.ok && !r.rejected && typeof showToast === 'function') showToast('📨 Whisper queued — it sends when the connection returns.');
  renderWhispersPanel();
}
async function whisperReplySend(id){
  if(!isReferee()) return;
  const el = document.getElementById('wsp-re-' + id); if(!el) return;
  const text = (el.value || '').trim(); if(!text) return;
  const note = (Array.isArray(whisperItems) ? whisperItems : []).find(it => it && it.id === id);
  if(!note || !note.from) return;
  el.value = '';
  const r = await supaStorage.sendWhisper({ text, to: note.from, re: id });
  if(r.ok && typeof pollWhispers === 'function') await pollWhispers();
  else if(!r.ok && !r.rejected && typeof showToast === 'function') showToast('📨 Reply queued — it sends when the connection returns.');
  renderWhispersPanel();
}
// Resolve is a put-state op, not a value write — a tiny direct call. It is
// deliberately NOT queued offline: a missed toggle is a one-tap retry, not
// lost table state.
async function whisperSetResolved(id, resolved){
  if(!isReferee()) return;
  const token = (typeof getContentToken === 'function') ? getContentToken() : '';
  if(!token) return;
  try {
    const res = await fetch(SUPABASE_URL + '/functions/v1/put-state', {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'whispers', resolve: { id, resolved } })
    });
    if(!res.ok) throw new Error('put-state ' + res.status);
    if(typeof pollWhispers === 'function') await pollWhispers();
  } catch(e){
    if(typeof showToast === 'function') showToast('Could not update the whisper — try again.', 'error');
  }
  renderWhispersPanel();
}

// ───────────────────────────────────────────────────────────────────────────
// PLAYER STANDING — per-player PRIVATE reputation, tied to backstory
// ───────────────────────────────────────────────────────────────────────────
// The referee authors each player's standing with the galaxy's powers (a level +
// a backstory note); each player privately sees only their OWN sheet. It rides the
// whisper channel wholesale (see isStandingNote / STANDING_TAG in js/55): a standing
// is a referee whisper to one player, tagged + JSON-encoded, so it inherits the
// whisper system's REAL per-player privacy (put-state stamps visibleTo:[player];
// get-content returns each identity only their own; the row is excluded from public
// reads) with no new backend. Latest entry per (player, org) wins; a {removed:true}
// entry is a tombstone. Never shown on the table TV.
let standingPanelOpen = false, standingCollapsed = false, standingRefSel = null, standingPrefill = null;
const STD_LEVELS = [ ['Hostile','#e8776a'], ['Wary','#e0a24a'], ['Neutral','#c9b98a'], ['Friendly','#9fd0b0'], ['Allied','#7ec98f'] ];
function stdClampLevel(l){ l = l|0; return l<0?0:(l>4?4:l); }
function stdOrgColor(org){
  try { if(typeof GALAXY_FACTIONS!=='undefined' && GALAXY_FACTIONS[org]) return GALAXY_FACTIONS[org].color; } catch(e){}
  try { if(window.ECON && ECON.corps && ECON.corps()[org]) return ECON.corps()[org].color; } catch(e){}
  return '#9fb0c8';
}
function stdOrgLabel(org, fallback){
  try { if(typeof GALAXY_FACTIONS!=='undefined' && GALAXY_FACTIONS[org]) return GALAXY_FACTIONS[org].name; } catch(e){}
  try { if(window.ECON && ECON.corps && ECON.corps()[org]) return ECON.corps()[org].name; } catch(e){}
  return fallback || org;
}
// Reconstruct current standings from the standing-tagged whispers (latest per player+org).
function parseStandings(){
  const items = Array.isArray(whisperItems) ? whisperItems : [];
  const by = {};
  items.forEach(it => {
    if(typeof isStandingNote !== 'function' || !isStandingNote(it)) return;
    let e; try { e = JSON.parse(it.text.slice(STANDING_TAG.length)); } catch(_){ return; }
    if(!e || !e.org) return;
    const who = (Array.isArray(it.visibleTo) && it.visibleTo[0]) || '?';
    const ts = Date.parse(it.ts) || 0, k = who + ' ' + e.org;
    if(!by[k] || ts > by[k]._ts) by[k] = Object.assign({}, e, { _who: who, _ts: ts, _id: it.id });
  });
  return Object.values(by);
}
function stdPips(level){ const L = stdClampLevel(level), col = STD_LEVELS[L][1];
  let s = '<span class="std-level">';
  for(let i=0;i<5;i++) s += `<span class="std-pip"${i<=L ? ` style="background:${col}"` : ''}></span>`;
  return s + '</span>';
}
// A living-galaxy tie-in: the latest GalNet headline about a power the player has standing with.
function stdRelatedNews(org){
  let news = [];
  try { if(window.ECON && ECON.news) news = ECON.news() || []; } catch(e){}
  if((!news || !news.length) && typeof galnetFeed !== 'undefined') news = galnetFeed;
  const rel = (news||[]).filter(n => n && n.fac === org)[0];
  return rel ? `<div class="std-news">📡 ${escQH(rel.text)}</div>` : '';
}

function toggleStandingPanel(){
  if(typeof DISPLAY_MODE !== 'undefined' && DISPLAY_MODE) return;   // never on the table TV
  standingPanelOpen = !standingPanelOpen;
  const w = document.getElementById('standing-wrap'), b = document.getElementById('standing-btn');
  if(w) w.classList.toggle('hidden', !standingPanelOpen);
  if(b) b.classList.toggle('panel-open', standingPanelOpen);
  if(standingPanelOpen){ renderStandingPanel(); if(typeof pollWhispers === 'function') pollWhispers(); }
  else { standingPrefill = null; updateStandingBadge(); }
}
function toggleStandingCollapse(){
  const h = document.getElementById('standing-header'); if(h && h.dataset.suppressClick === '1') return;
  standingCollapsed = !standingCollapsed;
  const t = document.getElementById('standing-toggle'); if(t) t.textContent = standingCollapsed ? '▲' : '▼';
  document.getElementById('standing-body').classList.toggle('collapsed', standingCollapsed);
  document.getElementById('standing-wrap').classList.toggle('panel-collapsed', standingCollapsed);
}
function standingSeenTs(){ try { return parseInt(localStorage.getItem('standing-seen')||'0',10)||0; } catch(e){ return 0; } }
function standingMarkSeen(){ try { localStorage.setItem('standing-seen', String(Date.now())); } catch(e){} }
function standingUnread(){ if(isReferee()) return 0; const seen = standingSeenTs();
  return parseStandings().filter(e => !e.removed && e._ts > seen).length; }
function updateStandingBadge(){
  const el = document.getElementById('standing-count'); if(!el) return;
  const ref = isReferee();
  if(!ref){ const u = standingUnread();
    if(u > 0 && !standingPanelOpen){ el.textContent = '+'+u; el.classList.remove('hidden'); return; }
    const total = parseStandings().filter(e => !e.removed).length;
    if(total > 0){ el.textContent = String(total); el.classList.remove('hidden'); } else el.classList.add('hidden');
    return;
  }
  const players = new Set(parseStandings().filter(e => !e.removed).map(e => e._who)).size;
  if(players > 0){ el.textContent = String(players); el.classList.remove('hidden'); } else el.classList.add('hidden');
}
function renderStandingPanel(){
  const body = document.getElementById('standing-body'); if(!body) return;
  const token = (typeof getContentToken === 'function') ? getContentToken() : '';
  if(!isReferee() && !token){
    body.innerHTML = '<div class="std-empty">Standing needs your access token — apply it in Settings → Secure Content. Your reputation is private to you alone.</div>';
    updateStandingBadge(); return;
  }
  if(isReferee()) renderStandingRefereeBody(body); else renderStandingPlayerBody(body);
  if(!isReferee()) standingMarkSeen();   // rendering = reading
  updateStandingBadge();
}
function renderStandingPlayerBody(body){
  const list = parseStandings().filter(e => !e.removed).sort((a,b)=> (a.level|0)-(b.level|0));
  let h = `<div class="std-intro">Your private standing with the powers of the galaxy — <b>only you can see this</b>. It reflects your character's history and how each faction regards you.</div>`;
  if(!list.length){ body.innerHTML = h + `<div class="std-empty">No standings recorded yet. As your history with the powers takes shape, the referee will note it here.</div>`; return; }
  h += list.map(e => {
    const col = stdOrgColor(e.org), L = stdClampLevel(e.level), label = e.label || STD_LEVELS[L][0];
    return `<div class="std-item"><div class="std-hd">`
      + `<span style="color:${col};font-weight:600">${escQH(e.orgLabel || stdOrgLabel(e.org))}</span>`
      + `<span style="display:flex;gap:6px;align-items:center">${stdPips(e.level)} <span style="color:${STD_LEVELS[L][1]};font-size:11px">${escQH(label)}</span></span>`
      + `</div>${e.note ? `<div class="std-note">“${escQH(e.note)}”</div>` : ''}${stdRelatedNews(e.org)}</div>`;
  }).join('');
  body.innerHTML = h;
}
function renderStandingRefereeBody(body){
  const roster = (typeof securePlayers !== 'undefined' && Array.isArray(securePlayers)) ? securePlayers.filter(p => p && p.role !== 'referee') : [];
  const all = parseStandings();
  let h = `<div class="std-intro">Author each player's <b>private</b> standing with the powers. Only that player ever sees their own — it's delivered over the secure whisper channel. Tie it to their backstory in the note.</div>`;
  if(!roster.length){ body.innerHTML = h + `<div class="std-empty">No player roster yet. Issue player tokens in Settings → Secure Content — standing uses the token system so each entry reaches only its player.</div>`; return; }
  roster.forEach(p => {
    const who = p.identity, mine = all.filter(e => e._who === who && !e.removed).sort((a,b)=>(a.level|0)-(b.level|0)), open = standingRefSel === who;
    h += `<div class="std-ref-player"><div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="standingRefPick('${escQH(who)}')">`
       + `<span style="font-size:12px;color:var(--tx0);font-weight:600">${escQH(who)}</span>`
       + `<span style="font-size:10px;color:var(--tx1)">${mine.length} standing${mine.length===1?'':'s'} ${open?'▾':'▸'}</span></div>`;
    if(open){
      mine.forEach(e => { const col = stdOrgColor(e.org), L = stdClampLevel(e.level), label = e.label || STD_LEVELS[L][0];
        h += `<div style="margin-top:5px;border-top:.5px solid var(--bd0);padding-top:5px;font-size:11px">`
          + `<div style="display:flex;justify-content:space-between;align-items:center"><span style="color:${col};font-weight:600">${escQH(e.orgLabel || stdOrgLabel(e.org))}</span>`
          + `<span style="display:flex;gap:6px;align-items:center">${stdPips(e.level)} <span style="color:${STD_LEVELS[L][1]}">${escQH(label)}</span> <button onclick="standingRemove('${escQH(who)}','${escQH(e.org)}')" title="Remove this standing" style="background:none;border:none;color:#e8776a;cursor:pointer">✕</button></span></div>`
          + (e.note ? `<div class="std-note">“${escQH(e.note)}”</div>` : '') + `</div>`;
      });
      h += standingRefForm(who);
    }
    h += `</div>`;
  });
  body.innerHTML = h;
}
function standingRefForm(who){
  const skip = { uncharted:1, contested:1 };
  const facs = (typeof GALAXY_FACTIONS !== 'undefined') ? Object.keys(GALAXY_FACTIONS).filter(k => !skip[k]) : [];
  let corps = []; try { if(window.ECON && ECON.corps) corps = Object.values(ECON.corps()).filter(c => !c.defunct).map(c => ({ id:c.id, name:c.name })); } catch(e){}
  // A prefill (from a GalNet headline / a drafted contract) seeds the org + note.
  const pf = standingPrefill || {};
  const knownOrg = pf.org && (facs.indexOf(pf.org) >= 0 || corps.some(c => c.id === pf.org));
  const sel = v => (pf.org === v && knownOrg) ? ' selected' : '';
  const opts = facs.map(k => `<option value="${escQH(k)}"${sel(k)}>${escQH(GALAXY_FACTIONS[k].name)}</option>`).join('')
    + corps.map(c => `<option value="${escQH(c.id)}"${sel(c.id)}>${escQH(c.name)} (corp)</option>`).join('')
    + `<option value="__custom"${pf.org && !knownOrg ? ' selected' : ''}>Other (type below)…</option>`;
  const lvls = STD_LEVELS.map((l,i) => `<option value="${i}"${i===(pf.level!=null?stdClampLevel(pf.level):2)?' selected':''}>${l[0]}</option>`).join('');
  const customVal = (pf.org && !knownOrg) ? escQH(pf.org) : '';
  return `<div class="std-ref-form" style="margin-top:6px;border-top:.5px dashed var(--bd0);padding-top:6px;display:flex;flex-direction:column;gap:4px">`
    + (pf.org ? `<div style="font-size:9px;color:#e0b978">Noting from the galaxy — review &amp; set the level, then Set.</div>` : '')
    + `<div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center"><select id="std-org" onchange="standingOrgCustomToggle()">${opts}</select>`
    + `<input id="std-org-custom" placeholder="Custom org" value="${customVal}" style="display:${pf.org && !knownOrg ? '' : 'none'};flex:1">`
    + `<select id="std-level">${lvls}</select></div>`
    + `<input id="std-label" value="${pf.label ? escQH(pf.label) : ''}" placeholder="Custom label (optional, e.g. “Wanted”, “Sympathizer”)">`
    + `<textarea id="std-note" placeholder="Backstory hook — why they stand this way (private to the player)">${pf.note ? escQH(pf.note) : ''}</textarea>`
    + `<button onclick="standingSave('${escQH(who)}')" style="align-self:flex-start;background:#3a3020;border:1px solid #7a5f2f;color:#e0c890;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer">🎖 Set standing</button>`
    + `</div>`;
}
function standingRefPick(who){ standingRefSel = (standingRefSel === who) ? null : who; renderStandingPanel(); }
// Referee-side: which players currently hold a standing with `org` → [{who,label,level,note}].
function standingHoldersFor(org){
  return parseStandings().filter(e => e.org === org && !e.removed)
    .map(e => ({ who:e._who, level:e.level|0, label:e.label || STD_LEVELS[stdClampLevel(e.level)][0], note:e.note||'' }));
}
// Begin noting a standing from a living-galaxy event (a GalNet headline, a drafted contract).
// Opens the Standing panel with the org + note pre-filled; the referee picks the player & level.
function standingBeginNote(org, orgLabel, note, label){
  if(!isReferee()) return;
  standingPrefill = { org: org||'', orgLabel: orgLabel || stdOrgLabel(org), note: note||'', label: label||'' };
  const holders = [...new Set(standingHoldersFor(org).map(h => h.who))];
  const roster = (typeof securePlayers !== 'undefined' && Array.isArray(securePlayers)) ? securePlayers.filter(p => p && p.role !== 'referee') : [];
  if(holders.length === 1) standingRefSel = holders[0];                 // exactly one prior holder → jump to them
  else if(!standingRefSel && roster.length === 1) standingRefSel = roster[0].identity;
  if(!standingPanelOpen){ toggleStandingPanel(); } else renderStandingPanel();
  if(typeof showToast === 'function') showToast(standingRefSel ? '🎖 Review & set the standing.' : '🎖 Pick a player to note this for.');
}
function standingOrgCustomToggle(){ const s = document.getElementById('std-org'), c = document.getElementById('std-org-custom'); if(s && c) c.style.display = (s.value === '__custom') ? '' : 'none'; }
async function standingSave(who){
  const s = document.getElementById('std-org'), custom = document.getElementById('std-org-custom');
  let org = s ? s.value : '', orgLabel = '';
  if(org === '__custom'){ org = (custom && custom.value.trim()) || ''; orgLabel = org; if(!org){ if(typeof showToast==='function') showToast('Enter an organisation','error'); return; } }
  else orgLabel = stdOrgLabel(org);
  const level = stdClampLevel(parseInt((document.getElementById('std-level')||{}).value||'2',10));
  const label = ((document.getElementById('std-label')||{}).value||'').trim();
  const note = ((document.getElementById('std-note')||{}).value||'').trim();
  const entry = { org, orgLabel, level, label, note };
  const r = await supaStorage.sendWhisper({ text: STANDING_TAG + JSON.stringify(entry), to: who });
  if(r && r.ok){ if(typeof showToast==='function') showToast('🎖 Standing set for ' + who); standingRefSel = who; standingPrefill = null;
    if(typeof pollWhispers === 'function') await pollWhispers(); renderStandingPanel();
  } else if(typeof showToast==='function') showToast('Could not set standing — check the connection.', 'error');
}
async function standingRemove(who, org){
  const r = await supaStorage.sendWhisper({ text: STANDING_TAG + JSON.stringify({ org, removed:true }), to: who });
  if(r && r.ok){ if(typeof pollWhispers === 'function') await pollWhispers(); renderStandingPanel(); }
  else if(typeof showToast==='function') showToast('Could not update standing.', 'error');
}

// ── Player polling extension ──────────────────────────────────────────────
// Wired into the existing pollRevealState() call chain — see that function

makePanelDraggable('event-log-wrap', 'event-log-header');
makePanelResizable('event-log-wrap');
makePanelDraggable('standing-wrap', 'standing-header');
makePanelResizable('standing-wrap');
makePanelDraggable('init-wrap', 'init-header');
makePanelResizable('init-wrap');
makePanelDraggable('health-wrap', 'health-header');
makePanelResizable('health-wrap');
makePanelDraggable('quest-wrap', 'quest-header');
makePanelResizable('quest-wrap');
makePanelDraggable('galnet-wrap', 'galnet-header');
makePanelResizable('galnet-wrap');
makePanelDraggable('journal-wrap', 'journal-header');
makePanelResizable('journal-wrap');
makePanelDraggable('turnorder-wrap', 'turnorder-header');
makePanelResizable('turnorder-wrap');
makePanelDraggable('cargo-wrap', 'cargo-header');
makePanelResizable('cargo-wrap');
makePanelDraggable('handouts-wrap', 'handouts-header');
makePanelResizable('handouts-wrap');
makePanelDraggable('downtime-wrap', 'downtime-header');
makePanelResizable('downtime-wrap');
makePanelDraggable('wiki-wrap', 'wiki-header');
makePanelResizable('wiki-wrap');
makePanelDraggable('contacts-wrap', 'contacts-header');
makePanelResizable('contacts-wrap');
makePanelDraggable('ship-wrap', 'ship-header');
makePanelResizable('ship-wrap');
makePanelDraggable('combat-wrap', 'combat-header');
makePanelResizable('combat-wrap');
makePanelDraggable('cal-wrap', 'cal-header');
makePanelResizable('cal-wrap');
makePanelDraggable('disc-wrap', 'disc-header');
makePanelResizable('disc-wrap');
makePanelDraggable('npc-wrap', 'npc-header');
makePanelResizable('npc-wrap');
makePanelDraggable('rep-wrap', 'rep-header');
makePanelResizable('rep-wrap');
makePanelDraggable('clocks-wrap', 'clocks-header');
makePanelResizable('clocks-wrap');
makePanelDraggable('whispers-wrap', 'whispers-header');
makePanelResizable('whispers-wrap');
makePanelDraggable('funds-wrap', 'funds-header');
makePanelResizable('funds-wrap');
makePanelDraggable('gen-wrap', 'gen-header');
makePanelResizable('gen-wrap');

// ── Campaign Pack: assemble the active universe and apply its config to the UI
//    (theme, terminology, module flags) BEFORE the first render. For the
//    built-in Archon Gambit pack this is a no-op-equivalent (defaults match). ──
if(typeof initCampaignPacks === 'function') initCampaignPacks();
// Authored station deck maps (js/40 defines the store; supaStorage loads later,
// so the fetch belongs here in the boot block with the other shared stores).
if(typeof loadAuthoredStations === 'function') loadAuthoredStations();

buildOrrery();
renderInit();
buildQuickAddList();
checkIdentity();
renderWhoAmI();
updateConnPill();             // paint initial sync status; markOnline/Offline keep it current
if(queueLength()) flushQueue(); // push anything parked from a previous offline session

// ── Galaxy map is the landing view: draw it on load (no fade on first paint) ──
if(typeof HX !== 'undefined'){
  HX.enter();
  if(typeof RealMap !== 'undefined') RealMap.onGalaxyEnter();   // apply the per-device HEX | REAL pref
  document.getElementById('hdr-title').textContent = layerLabel('galaxy','The Orion Arm').toUpperCase();
  document.getElementById('breadcrumb').innerHTML = '';
  updateBackBtn();
}
loadRevealState().then(() => {
  if(currentView === 'station'){ buildStationSVG(); renderDetail(); }
});
loadClockState().then(() => { renderClock(); });
loadSplashConfig(); // referee's shared splash text / on-off state (welcome screens)
// Secure per-player content (Stage 2): no-op unless a token is stored. When on,
// strips baked-in secrets and applies only this token's server-authorised data.
ingestTokenFromUrl();     // apply a token from an invite link (#token=…) before hydrating
hydrateSecureContent();
loadContentOverrides().then(() => {
  if(currentView === 'station' && cur){ renderDetail(); }
  if(currentView === 'system' && selectedBody){ selectBody(selectedBody); }
  if(currentView === 'body' && selectedBody){ if(selectedBodyLoc) selectBodyLocation(selectedBodyLoc); else buildBodyView(selectedBody); }
});
loadBodyStores().then(() => {
  // Rebuild the system view so any added/removed/edited bodies appear
  if(typeof buildOrrery === 'function') buildOrrery();
  // Refresh galaxy "surveyed" markers once shared body data has loaded.
  if(currentView === 'galaxy' && typeof HX!=='undefined') HX.refresh();
  if(currentView === 'system' && selectedBody){
    // If the selected body was deleted while away, fall back to overview
    if(getBodies().find(b => b.id === selectedBody)) selectBody(selectedBody);
    else goSystemOverview();
  }
  if(currentView === 'body' && selectedBody){
    if(getBodies().find(b => b.id === selectedBody)) buildBodyView(selectedBody);
    else goSystem();
  }
});
loadLocationStores().then(() => {
  // Locations render inside the body view; refresh it if that's where we are.
  if(currentView === 'body' && selectedBody){
    if(selectedBodyLoc && findLocation(selectedBodyLoc)) selectBodyLocation(selectedBodyLoc);
    else buildBodyView(selectedBody);
  }
});
loadTextureCatalog().then(() => {
  // Re-render any view that draws textures once the catalog (and thus auto-by-type
  // defaults) is known — the body close-up and the orrery both use globe images.
  if(currentView === 'body' && selectedBody){ if(selectedBodyLoc) selectBodyLocation(selectedBodyLoc); else buildBodyView(selectedBody); }
  if(typeof buildOrrery === 'function') buildOrrery();
});
loadQuestLog(); // quests render on-demand when panel is opened, no immediate re-render needed
loadSessionLog(); // session journal renders on-demand when its panel is opened
loadTurnOrder(); // shared read-only turn order (players); referee is the source
loadTradeCargo(); // shared cargo manifest — renders on-demand when its panel opens
loadHandouts(); // referee-pushed handouts — renders on-demand when its panel opens
loadDowntime(); // between-jump downtime actions — renders on-demand when its panel opens
loadWiki(); // referee-curated lore articles — renders on-demand when its panel opens
loadContacts(); // contact dossier — renders on-demand when its panel opens
loadShipState().then(() => { if(shipPanelOpen) renderShipPanel(); renderAlertCtl(); if(currentView === 'galaxy' && typeof HX !== 'undefined') HX.refresh(); });
loadAlertState().then(() => applyAlertState());
loadCombatEncounter().then(() => { updateCombatBtn(); if(combatPanelOpen) renderCombat(); }); // hydrate any in-progress encounter
loadWeaponCatalog().then(() => { if(typeof shipEditorId!=='undefined' && shipEditorId && typeof renderShipEditor==='function') renderShipEditor(); }); // referee weapon templates
loadShipRoster().then(() => { if(typeof combatPanelOpen!=='undefined' && combatPanelOpen && typeof renderCombat==='function') renderCombat(); }); // referee ship roster + fleets
loadNpcRoster().then(() => { if(typeof npcPanelOpen!=='undefined' && npcPanelOpen && typeof renderNpcPanel==='function') renderNpcPanel(); }); // referee NPC roster
renderImperialDate(); // show default immediately, then refresh once loaded
loadImperialDate().then(() => { renderImperialDate(); if(currentView === 'galaxy' && typeof HX !== 'undefined') HX.refresh(); });
loadCampaignEvents().then(() => { if(calPanelOpen) renderCalendarPanel(); });
loadDiscoveryLog().then(() => { if(discPanelOpen) renderDiscoveryPanel(); });
loadReputation().then(() => { if(repPanelOpen) renderReputationPanel(); });
loadClocks().then(() => { if(clocksPanelOpen) renderClocksPanel(); });   // faction/countdown clocks
loadFunds().then(() => { if(fundsPanelOpen) renderFundsPanel(); });
loadFactionStores().then(() => { rebuildFactionsFromOverlay();   // fold in any referee-added / edited / removed regions
  if(currentView === 'galaxy' && typeof HX !== 'undefined') HX.refresh(); });
loadFactionHidden().then(() => { if(currentView === 'galaxy' && typeof HX !== 'undefined') HX.refresh(); });   // player-facing faction visibility
loadSystemStores().then(() => { rebuildSystemsFromOverlay();   // fold in any referee-added / edited / removed systems
  if(currentView === 'galaxy' && typeof HX !== 'undefined') HX.refresh(); });
loadGalaxyLanes().then(() => { try{ if(typeof ECON!=='undefined') ECON.syncLanes(); }catch(e){}   // economy follows jump lanes — pick up saved lane edits
  if(currentView === 'galaxy' && typeof HX !== 'undefined') HX.refresh(); });
loadRouteBlocks().then(() => { if(currentView === 'galaxy' && typeof HX !== 'undefined') HX.refresh(); });
loadHexPaint().then(() => { if(currentView === 'galaxy' && typeof HX !== 'undefined') HX.refresh(); });   // referee-painted territory hexes (shared)
if(typeof loadTradeGoodStores === 'function') loadTradeGoodStores().then(() => { if(typeof HX !== 'undefined' && HX.refresh) HX.refresh(); if(typeof renderTradePanel === 'function' && typeof tradePanelOpen !== 'undefined' && tradePanelOpen) renderTradePanel(); });   // referee-edited trade-goods catalogue (shared)


// ═══════════════════════════════════════════════════════════════════════════
// QUICK REFERENCE SIDEBAR
// ═══════════════════════════════════════════════════════════════════════════

const QREF_DATA = [
  {
    id: 'task',
    title: '2D6 Task Checks',
    content: () => `
      <div class="qref-formula">
        2D6 + Characteristic DM + Skill<br>
        vs Target Number (usually 8+)
      </div>
      <table class="qref-table">
        <thead><tr><th>Effect</th><th>Result</th></tr></thead>
        <tbody>
          <tr class="qref-highlight"><td>6+</td><td>Exceptional success</td></tr>
          <tr><td>2–5</td><td>Success</td></tr>
          <tr><td>0–1</td><td>Marginal success</td></tr>
          <tr><td>−1 to −5</td><td>Failure</td></tr>
          <tr class="qref-neg-row"><td>−6 or less</td><td>Exceptional failure</td></tr>
        </tbody>
      </table>
      <p class="qref-note">Effect = Roll − Target Number. Boon: roll 3D6 drop lowest. Bane: roll 3D6 drop highest.</p>`
  },
  {
    id: 'characteristics',
    title: 'Characteristic Modifiers',
    content: () => `
      <table class="qref-table">
        <thead><tr><th>Score</th><th>DM</th><th>Score</th><th>DM</th></tr></thead>
        <tbody>
          <tr><td>0</td><td>−3</td><td>9–11</td><td>+1</td></tr>
          <tr><td>1–2</td><td>−2</td><td>12–14</td><td>+2</td></tr>
          <tr><td>3–5</td><td>−1</td><td>15–17</td><td>+3</td></tr>
          <tr class="qref-highlight"><td>6–8</td><td>0</td><td>18–20</td><td>+4</td></tr>
        </tbody>
      </table>
      <p class="qref-note">STR · DEX · END · INT · EDU · SOC. Characteristic letter codes appear on UWPs and NPC stat blocks.</p>`
  },
  {
    id: 'skills',
    title: 'Common Skill DMs',
    content: () => `
      <table class="qref-table">
        <thead><tr><th>Situation</th><th>DM</th></tr></thead>
        <tbody>
          <tr><td>Untrained (most skills)</td><td>−3</td></tr>
          <tr><td>Untrained (Jack of All Trades)</td><td>−1 per level</td></tr>
          <tr><td>Skilled assistance</td><td>+1</td></tr>
          <tr><td>Good tools / conditions</td><td>+1 to +2</td></tr>
          <tr><td>Poor tools / conditions</td><td>−1 to −2</td></tr>
          <tr><td>Extra time (×10 time)</td><td>+1</td></tr>
          <tr><td>Rushing (÷10 time)</td><td>−2</td></tr>
          <tr><td>Aided by relevant Tech Level</td><td>+1 per 3 TL</td></tr>
        </tbody>
      </table>
      <p class="qref-note">Multiple assistants: only one assistance DM applies (the highest). Max +3 from assistance.</p>`
  },
  {
    id: 'reaction',
    title: 'Reaction Table',
    content: () => `
      <table class="qref-table">
        <thead><tr><th>2D6</th><th>Reaction</th></tr></thead>
        <tbody>
          <tr style="color:#d45050"><td>2</td><td>Hostile — immediate attack</td></tr>
          <tr><td>3–5</td><td>Hostile — threatens, demands</td></tr>
          <tr><td>6–7</td><td>Uncooperative</td></tr>
          <tr class="qref-highlight"><td>8–9</td><td>Neutral</td></tr>
          <tr><td>10–11</td><td>Friendly — willing to help</td></tr>
          <tr style="color:#4caf82"><td>12</td><td>Enthusiastic — actively assists</td></tr>
        </tbody>
      </table>
      <p class="qref-note">Apply SOC DM of the most socially prominent party member. Each subsequent check in same encounter: −1 cumulative.</p>`
  },
  {
    id: 'range',
    title: 'Encounter Distances',
    content: () => `
      <table class="qref-table">
        <thead><tr><th>Range Band</th><th>Distance</th></tr></thead>
        <tbody>
          <tr><td>Close</td><td>0–1.5 m</td></tr>
          <tr><td>Short</td><td>1.5–3 m</td></tr>
          <tr><td>Medium</td><td>3–50 m</td></tr>
          <tr><td>Long</td><td>50–250 m</td></tr>
          <tr><td>Very Long</td><td>250–500 m</td></tr>
          <tr><td>Distant</td><td>500 m+</td></tr>
        </tbody>
      </table>
      <p class="qref-note">Weapons have an effective range and a maximum range. Attacks beyond effective range suffer −2 DM. Beyond maximum: impossible.</p>`
  },
  {
    id: 'combat',
    title: 'Combat Sequence',
    content: () => `
      <table class="qref-table">
        <thead><tr><th>#</th><th>Step</th></tr></thead>
        <tbody>
          <tr><td>1</td><td><b>Surprise check</b> — Recon vs 8+ if ambushing</td></tr>
          <tr><td>2</td><td><b>Initiative</b> — 2D6 + DEX DM, highest goes first</td></tr>
          <tr><td>3</td><td><b>Minor action</b> — move, draw, aim, communicate</td></tr>
          <tr><td>4</td><td><b>Significant action</b> — attack, full move, skill check</td></tr>
          <tr><td>5</td><td><b>Reaction</b> — dodge (DEX 8+, −2 to attacker) or parry</td></tr>
          <tr><td>6</td><td><b>Damage</b> — subtract from STR/DEX/END in order</td></tr>
          <tr><td>7</td><td><b>Unconscious</b> when any stat hits 0; <b>dead</b> when all 3 = 0</td></tr>
        </tbody>
      </table>
      <table class="qref-table" style="margin-top:10px">
        <thead><tr><th>Attack roll</th><th>Formula</th></tr></thead>
        <tbody>
          <tr><td>Melee</td><td>2D6 + STR or DEX DM + Melee</td></tr>
          <tr><td>Ranged</td><td>2D6 + DEX DM + Gun Combat</td></tr>
          <tr class="qref-highlight"><td>Target</td><td>8+ (modified by range, cover, aim)</td></tr>
        </tbody>
      </table>
      <p class="qref-note">Aim (minor action): +1 DM to next attack. Max +6 from aiming. Cover: −1 to −4 DM to attacker.</p>`
  },
];

let qrefOpen = false;

function toggleQref(){
  qrefOpen ? closeQref() : openQref();
}

function openQref(){
  qrefOpen = true;
  document.getElementById('qref-panel').classList.add('open');
  document.getElementById('qref-overlay').classList.add('open');
  document.getElementById('qref-btn').classList.add('panel-open');
  renderQref();
  // focus search
  setTimeout(() => {
    const s = document.getElementById('qref-search');
    if(s) s.focus();
  }, 230);
}

function closeQref(){
  qrefOpen = false;
  document.getElementById('qref-panel').classList.remove('open');
  document.getElementById('qref-overlay').classList.remove('open');
  document.getElementById('qref-btn').classList.remove('panel-open');
}

function renderQref(){
  const body = document.getElementById('qref-body');
  if(!body) return;
  if(!_rulesLoaded){ loadRulesIndex().then(() => { if(qrefOpen) renderQref(); }); }
  const query = (document.getElementById('qref-search')?.value || '').toLowerCase().trim();

  let html = '';
  QREF_DATA.forEach(section => {
    const sectionHTML = section.content();
    // Simple filter: check title and rendered text content
    if(query){
      const plain = section.title.toLowerCase() + ' ' + sectionHTML.replace(/<[^>]+>/g,' ').toLowerCase();
      if(!plain.includes(query)) return;
    }
    html += `
      <div class="qref-section">
        <div class="qref-section-title">${section.title}</div>
        ${sectionHTML}
      </div>`;
  });

  const rrHtml = rulesIndexHTML(query);   // referee-authored page references (licensing-safe)
  if(!html && !rrHtml){
    html = '<p class="qref-note" style="text-align:center;padding:20px 0">No matches found.</p>';
  } else {
    html += rrHtml;
  }
  body.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════════════
// RULES & GEAR PAGE REFERENCES — referee-authored "where to look" index
// ═══════════════════════════════════════════════════════════════════════════
// Licensing-safe by design: stores ONLY topic + book + page (+ optional note) —
// facts, never rulebook prose — so the repo stays copyright-clean and open-source
// ready. Rendered as searchable cards inside the existing Rules panel; players
// poll them live (js/55). Layer 3 (BYO-rulebook PDF) can later deep-link a page.
// Shared key 'rules-index' (shared:true), same honour-system pattern as the rest.
let rulesIndex = [];
let _rulesLoaded = false;

async function loadRulesIndex(){
  try { const r = await supaStorage.get('rules-index', true); if(r.value != null) rulesIndex = JSON.parse(r.value) || []; }
  catch(e){ rulesIndex = []; }
  _rulesLoaded = true;
}
async function saveRulesIndex(){
  try { await supaStorage.set('rules-index', JSON.stringify(rulesIndex), true); }
  catch(e){ console.error('Rules index save failed:', e); }
}
function addRuleRef(){
  if(!isReferee()) return;
  const gv = id => (document.getElementById(id)?.value || '').trim();
  const topic = gv('rr-topic'); if(!topic) return;
  rulesIndex.push({ id:'rr_'+Date.now().toString(36), topic, book:gv('rr-book'), page:gv('rr-page'), note:gv('rr-note') });
  rulesIndex.sort((a,b) => (a.topic||'').localeCompare(b.topic||''));
  saveRulesIndex();
  renderQref();
  showToast('Page reference added');
}
function deleteRuleRef(id){
  if(!isReferee()) return;
  rulesIndex = rulesIndex.filter(r => r.id !== id);
  saveRulesIndex();
  renderQref();
}
function rulesIndexHTML(query){
  const ref = (typeof isReferee === 'function') && isReferee();
  const items = rulesIndex.filter(r => {
    if(!query) return true;
    return ((r.topic||'')+' '+(r.book||'')+' '+(r.page||'')+' '+(r.note||'')).toLowerCase().includes(query);
  });
  let cards = '';
  if(items.length){
    cards = items.map(r => {
      const cite = (r.book || r.page)
        ? `<span class="rr-cite">${escQH(r.book||'')}${r.book&&r.page?' ':''}${r.page?('p.'+escQH(r.page)):''}</span>` : '';
      const del = ref ? `<button class="rr-del" onclick="deleteRuleRef('${r.id}')" title="Delete">✕</button>` : '';
      return `<div class="rr-card">${del}
        <div class="rr-card-main"><span class="rr-topic">${escQH(r.topic)}</span>${cite}</div>
        ${r.note ? `<div class="rr-note">${escQH(r.note)}</div>` : ''}
      </div>`;
    }).join('');
  } else if(query){
    cards = '<div class="qref-note" style="padding:4px 0">No page references match.</div>';
  } else if(!ref){
    cards = '<div class="qref-note" style="padding:4px 0">No page references yet.</div>';
  }
  const form = ref ? `
    <div class="rr-add">
      <input id="rr-topic" placeholder="Topic (e.g. Autopistol, Grappling)" maxlength="60">
      <div class="rr-add-row">
        <input id="rr-book" placeholder="Book (e.g. Core Rulebook)" maxlength="40">
        <input id="rr-page" placeholder="Page" maxlength="12" style="max-width:74px">
      </div>
      <input id="rr-note" placeholder="Optional note" maxlength="80">
      <button class="cal-add-btn" onclick="addRuleRef()">+ Add page reference</button>
      <div class="rr-hint">Stores only topic + book + page — never rulebook text, so the app stays copyright-clean.</div>
    </div>` : '';
  if(!cards && !form) return '';
  return `<div class="qref-section">
    <div class="qref-section-title">📑 Page References${ref ? ' (referee)' : ''}</div>
    ${cards}${form}
  </div>`;
}
// escQH is defined in js/70 (loaded earlier); used here at render time.

// Escape closes qref — now handled by kbdDispatch

// ═══════════════════════════════════════════════════════════════════════════
// SESSION TOOLS — export + recap
// ═══════════════════════════════════════════════════════════════════════════
// Reads the existing event log (newest-first), the clock, revealed areas,
// quests, and NPC locations to produce a session summary the referee can
// keep in their notes.

function openSessionTools(){
  if(!isReferee()) return;
  document.getElementById('session-modal').classList.add('open');
  renderSessionStats();
  // Reset recap output
  const out = document.getElementById('session-recap-output');
  if(out){ out.style.display = 'none'; out.textContent = ''; }
}

function closeSessionTools(){
  document.getElementById('session-modal').classList.remove('open');
}

function renderSessionStats(){
  const el = document.getElementById('session-stats');
  if(!el) return;
  const revealedCount = Object.values(revealedAreas).filter(Boolean).length;
  const questActive = questLog.filter(q => q.status === 'active').length;
  const questDone = questLog.filter(q => q.status === 'complete').length;
  const npcsPlaced = Object.values(npcLocations).filter(l => l.area).length;
  el.innerHTML =
    '<div class="session-stat-row"><span>Station time</span><span>' + clockDisplay(clockMinutes) + '</span></div>' +
    '<div class="session-stat-row"><span>Events logged</span><span>' + eventLog.length + '</span></div>' +
    '<div class="session-stat-row"><span>Areas revealed</span><span>' + revealedCount + '</span></div>' +
    '<div class="session-stat-row"><span>Missions active / done</span><span>' + questActive + ' / ' + questDone + '</span></div>' +
    '<div class="session-stat-row"><span>NPCs placed on station</span><span>' + npcsPlaced + '</span></div>';
}

// Build a plain-text session log from current state.
function buildSessionLogText(){
  const lines = [];
  lines.push('AURELIA — SESSION LOG');
  lines.push('Generated: ' + new Date().toLocaleString());
  lines.push('Station time at export: ' + clockDisplay(clockMinutes));
  lines.push('='.repeat(48));
  lines.push('');

  // Event log — oldest first for readability
  lines.push('EVENT TIMELINE');
  lines.push('-'.repeat(48));
  if(!eventLog.length){
    lines.push('(no events logged)');
  } else {
    [...eventLog].reverse().forEach(e => {
      const area = e.area ? ' [' + e.area + ']' : '';
      lines.push(e.time + area + ' — ' + e.text);
    });
  }
  lines.push('');

  // Quests
  const activeQ = questLog.filter(q => q.status === 'active');
  const doneQ = questLog.filter(q => q.status === 'complete');
  if(activeQ.length || doneQ.length){
    lines.push('QUESTS');
    lines.push('-'.repeat(48));
    activeQ.forEach(q => lines.push('[ACTIVE] ' + q.title));
    doneQ.forEach(q => lines.push('[DONE]   ' + q.title));
    lines.push('');
  }

  // NPC positions
  const placed = Object.entries(npcLocations).filter(([k,l]) => l.area);
  if(placed.length){
    lines.push('NPC POSITIONS (at export)');
    lines.push('-'.repeat(48));
    placed.forEach(([k,l]) => {
      const name = k.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
      lines.push(name + ' — ' + npcAreaLabel(l.area, l.sub) + (l.note ? ' (' + l.note + ')' : ''));
    });
    lines.push('');
  }

  return lines.join('\n');
}

function exportSessionLog(){
  const text = buildSessionLogText();
  const blob = new Blob([text], {type:'text/plain'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0,10);
  a.href = url;
  a.download = 'aurelia-session-' + stamp + '.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Session log exported');
}

function copySessionLog(){
  const text = buildSessionLogText();
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text)
      .then(() => showToast('Copied to clipboard'))
      .catch(() => showToast('Copy failed — try export instead', 'error'));
  } else {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); showToast('Copied to clipboard'); }
    catch(e){ showToast('Copy failed — try export instead', 'error'); }
    document.body.removeChild(ta);
  }
}

// Generate a narrative-style recap from the event log.
// Deterministic and local — groups events by area and time, written in
// past tense as session-notes prose.
function generateSessionRecap(){
  const out = document.getElementById('session-recap-output');
  if(!out) return;
  out.style.display = 'block';

  if(!eventLog.length){
    out.innerHTML = '<span class="session-recap-empty">No events logged yet. The recap builds from the event timeline as the session plays out — advance the clock and trigger events first.</span>';
    return;
  }

  const events = [...eventLog].reverse(); // oldest first
  const parts = [];
  parts.push('SESSION RECAP — ' + new Date().toLocaleDateString());
  parts.push('');

  // Opening
  parts.push('The session ran from ' + events[0].time + ' to ' + events[events.length-1].time + ' station time, across ' + events.length + ' logged ' + (events.length === 1 ? 'beat' : 'beats') + '.');
  parts.push('');

  // Group consecutive events by area
  let lastArea = null;
  events.forEach(e => {
    if(e.area && e.area !== lastArea){
      parts.push('• At ' + (e.area) + ':');
      lastArea = e.area;
    }
    const prefix = e.area ? '   ' : '• ';
    parts.push(prefix + e.time + ' — ' + e.text);
  });

  // Quest status
  const activeQ = questLog.filter(q => q.status === 'active');
  const doneQ = questLog.filter(q => q.status === 'complete');
  if(doneQ.length){
    parts.push('');
    parts.push('Resolved this campaign: ' + doneQ.map(q => q.title).join('; ') + '.');
  }
  if(activeQ.length){
    parts.push('');
    parts.push('Still open: ' + activeQ.map(q => q.title).join('; ') + '.');
  }

  out.textContent = parts.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════
// Lightweight, reusable feedback for save/edit/delete actions.
// showToast('Location saved')  → success (default)
// showToast('Could not save', 'error')
// showToast('Time advanced', 'info')
let _toastTimer = null;
function showToast(message, type){
  type = type || 'success';
  const container = document.getElementById('toast-container');
  if(!container) return;
  const icons = { success:'✓', error:'✕', info:'•' };
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.innerHTML = '<span class="toast-icon">' + (icons[type]||'✓') + '</span><span>' +
    String(message).replace(/</g,'&lt;') + '</span>';
  container.appendChild(toast);
  // Auto-dismiss after 2.4s
  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 250);
  }, 2400);
  // Cap stack at 4
  while(container.children.length > 4){
    container.firstChild.remove();
  }
}


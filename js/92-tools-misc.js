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
  if(!_rbLoaded){ loadRulebookConfig().then(() => { if(qrefOpen) renderQref(); }); }
  const query = (document.getElementById('qref-search')?.value || '').toLowerCase().trim();
  // Word-level matching: every word must appear somewhere, in any order — so
  // "jumping rolls" finds "Jump procedure" where a literal phrase match fails.
  const tokens = query.split(/\s+/).filter(Boolean);
  const tokensMatch = plain => tokens.every(t => plain.includes(t));

  let html = '';
  QREF_DATA.forEach(section => {
    const sectionHTML = section.content();
    if(tokens.length){
      const plain = section.title.toLowerCase() + ' ' + sectionHTML.replace(/<[^>]+>/g,' ').toLowerCase();
      if(!tokensMatch(plain)) return;
    }
    html += `
      <div class="qref-section">
        <div class="qref-section-title">${section.title}</div>
        ${sectionHTML}
      </div>`;
  });

  const rrHtml = rulesIndexHTML(tokens);   // referee-authored page references (licensing-safe)
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
// Bulk import — paste a JSON array of {topic, book, page, pdf?, note?}. `pdf`
// is the PDF page number the ↗ button jumps to when it differs from the
// printed page (Mongoose PDFs run printed+1). Dedupes on topic+book+page.
function importRuleRefs(){
  if(!isReferee()) return;
  const el = document.getElementById('rr-import'); if(!el || !el.value.trim()) return;
  let arr;
  try { arr = JSON.parse(el.value); } catch(e){ showToast('Not valid JSON', 'error'); return; }
  if(!Array.isArray(arr)){ showToast('Expected a JSON array of references', 'error'); return; }
  const key = r => ((r.topic||'')+'|'+(r.book||'')+'|'+(r.page||'')).toLowerCase();
  const have = new Set(rulesIndex.map(key));
  let n = 0;
  arr.forEach(r => {
    if(!r || typeof r.topic !== 'string' || !r.topic.trim()) return;
    const rec = { id:'rr_'+Date.now().toString(36)+'_'+n, topic:String(r.topic).trim().slice(0,60),
      book:String(r.book||'').slice(0,40), page:String(r.page||'').slice(0,12),
      pdf:String(r.pdf||'').slice(0,12), note:String(r.note||'').slice(0,80) };
    if(have.has(key(rec))) return;
    have.add(key(rec)); rulesIndex.push(rec); n++;
  });
  rulesIndex.sort((a,b) => (a.topic||'').localeCompare(b.topic||''));
  saveRulesIndex();
  el.value = '';
  renderQref();
  showToast(n ? (n + ' reference' + (n===1?'':'s') + ' imported') : 'Nothing new to import');
}
function deleteRuleRef(id){
  if(!isReferee()) return;
  rulesIndex = rulesIndex.filter(r => r.id !== id);
  saveRulesIndex();
  renderQref();
}
function rulesIndexHTML(tokens){
  const ref = (typeof isReferee === 'function') && isReferee();
  tokens = tokens || [];
  const items = rulesIndex.filter(r => {
    if(!tokens.length) return true;
    const plain = ((r.topic||'')+' '+(r.book||'')+' '+(r.page||'')+' '+(r.note||'')).toLowerCase();
    return tokens.every(t => plain.includes(t));
  });
  let cards = '';
  if(items.length){
    cards = items.map(r => {
      const bookTxt = r.book ? `<span class="rr-cite">${escQH(r.book)}</span>` : '';
      let pageEl = '';
      if(r.page){
        const pg = escQH(r.page);
        // Link only when the citation matches an uploaded book; the anchor uses
        // the PDF page (r.pdf) when it differs from the printed page shown.
        const bk = rbBookForCitation(r.book);
        const anchor = (String(r.pdf || r.page).match(/\d+/) || [''])[0];
        pageEl = (bk && anchor)
          ? `<button class="rr-page" onclick="openRulebook('${anchor}','${bk.id}')" title="Open ${escQH(bk.label||'rulebook')} at this page">p.${pg} ↗</button>`
          : `<span class="rr-cite">p.${pg}</span>`;
      }
      const cite = (bookTxt || pageEl) ? `<span class="rr-cite-wrap">${bookTxt}${pageEl}</span>` : '';
      const del = ref ? `<button class="rr-del" onclick="deleteRuleRef('${r.id}')" title="Delete">✕</button>` : '';
      return `<div class="rr-card">${del}
        <div class="rr-card-main"><span class="rr-topic">${escQH(r.topic)}</span>${cite}</div>
        ${r.note ? `<div class="rr-note">${escQH(r.note)}</div>` : ''}
      </div>`;
    }).join('');
  } else if(tokens.length){
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
      <textarea id="rr-import" rows="2" placeholder='Bulk import — paste JSON: [{"topic":"Jump procedure","book":"Core Rulebook","page":"150","pdf":"151","note":"…"}]'></textarea>
      <button class="cal-add-btn" onclick="importRuleRefs()">⇪ Import references (JSON)</button>
      <div class="rr-hint">Stores only topic + book + page — never rulebook text, so the app stays copyright-clean.</div>
    </div>` : '';
  const bar = (typeof rulebookBarHTML === 'function') ? rulebookBarHTML() : '';
  if(!cards && !form && !bar) return '';
  return `<div class="qref-section">
    <div class="qref-section-title">📑 Page References${ref ? ' (referee)' : ''}</div>
    ${bar}${cards}${form}
  </div>`;
}
// escQH is defined in js/70 (loaded earlier); used here at render time.

// ── BYO rulebook library — upload (referee, in Settings) + open (everyone) ───
// The referee uploads their own legally-owned rulebook PDFs (Core + supplements
// like High Guard or the Central Supply Catalogue) to the per-campaign Storage
// bucket (js/50 uploadRulebookBlob); a small shared config ('rulebook-config')
// tells every device what exists + display labels + cache-bust versions.
// Opened in the browser's native PDF viewer; a cited page deep-links via
// '#page=N'. Never ships in the repo — user content only. Management lives in
// Settings ▸ Rulebook Library (rulebookLibraryHTML, called from js/60);
// the Rules panel keeps per-book open buttons for the whole table.
let rulebookConfig = {};   // { books:[{id,label,name,ver}] } — legacy {uploaded,name,ver} still read
let _rbLoaded = false;
let _rbBusy = false;

const RB_PRESETS = [
  { id:'core',              label:'Core Rulebook' },
  { id:'high-guard',        label:'High Guard' },
  { id:'csc',               label:'Central Supply Catalogue' },
  { id:'specialist-forces', label:'Specialist Forces' },
  { id:'robot-handbook',    label:'Robot Handbook' },
];

async function loadRulebookConfig(){
  try { const r = await supaStorage.get('rulebook-config', true); if(r.value != null) rulebookConfig = JSON.parse(r.value) || {}; }
  catch(e){ rulebookConfig = {}; }
  _rbLoaded = true;
}
async function saveRulebookConfig(){
  try { await supaStorage.set('rulebook-config', JSON.stringify(rulebookConfig), true); }
  catch(e){ console.error('Rulebook config save failed:', e); }
}
function rbCampaign(){ return (typeof activeCampaignId !== 'undefined') ? activeCampaignId : 'default'; }
// The book list, reading the pre-library single-book config as 'core'.
function rbBooks(){
  if(rulebookConfig && Array.isArray(rulebookConfig.books)) return rulebookConfig.books;
  if(rulebookConfig && rulebookConfig.uploaded)
    return [{ id:'core', label:'Core Rulebook', name:rulebookConfig.name||'Rulebook', ver:rulebookConfig.ver }];
  return [];
}
// Match a card's free-text book citation to an uploaded book. No citation →
// the first (core-first) book; a citation naming a book we don't hold → null,
// so a High Guard reference never opens the Core PDF at the wrong page.
function rbBookForCitation(book){
  const books = rbBooks(); if(!books.length) return null;
  const q = String(book||'').toLowerCase().trim();
  if(!q) return books[0];
  return books.find(b => { const l = String(b.label||'').toLowerCase();
    return l && (q.includes(l) || l.includes(q)); }) || null;
}
function openRulebook(page, bookId){
  const books = rbBooks();
  const b = books.find(x => x.id === bookId) || books[0];
  if(!b){ showToast('No rulebook uploaded yet', 'error'); return; }
  if(typeof rulebookUrlFor !== 'function'){ showToast('Rulebook viewer unavailable', 'error'); return; }
  const url = rulebookUrlFor(rbCampaign(), b.ver, b.id) + (page ? ('#page=' + encodeURIComponent(page)) : '');
  try { window.open(url, '_blank', 'noopener'); } catch(e){ location.href = url; }
}
function rbSlugId(label){
  return String(label||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,24) || ('book-' + Date.now().toString(36));
}
function rbAddBook(input){
  if(!isReferee()) return;
  const file = input && input.files && input.files[0]; if(!file) return;
  const sel = document.getElementById('rb-add-label');
  let id, label;
  if(sel && sel.value === '__custom'){
    label = (prompt('Book name (shown on the open button):') || '').trim();
    if(!label){ input.value = ''; return; }
    id = rbSlugId(label);
    if(rbBooks().some(b => b.id === id)) id += '-' + Date.now().toString(36).slice(-3);
  } else {
    const p = RB_PRESETS.find(x => x.id === (sel && sel.value));
    if(!p){ input.value = ''; return; }
    id = p.id; label = p.label;
  }
  rbUpload(input, file, id, label);
}
function rbReplaceBook(input, bookId){
  if(!isReferee()) return;
  const file = input && input.files && input.files[0]; if(!file) return;
  const b = rbBooks().find(x => x.id === bookId); if(!b) return;
  rbUpload(input, file, bookId, b.label);
}
function rbUpload(input, file, id, label){
  if(file.type && file.type !== 'application/pdf'){ showToast('Please choose a PDF', 'error'); input.value = ''; return; }
  if(file.size > 80 * 1024 * 1024){ showToast('PDF too large (max 80 MB)', 'error'); input.value = ''; return; }
  if(_rbBusy) return;
  _rbBusy = true; showToast('Uploading ' + label + '…', 'info');
  uploadRulebookBlob(rbCampaign(), file, id)
    .then(() => {
      const books = rbBooks().filter(b => b.id !== id);
      books.push({ id, label, name: file.name, ver: Date.now() });
      books.sort((a,b) => a.id==='core' ? -1 : b.id==='core' ? 1 : String(a.label).localeCompare(String(b.label)));
      rulebookConfig = { books };
      return saveRulebookConfig();
    })
    .then(() => { showToast(label + ' uploaded'); if(qrefOpen) renderQref(); if(typeof refreshOpenMenus === 'function') refreshOpenMenus(); })
    .catch(err => { showToast('Upload failed — is the rulebooks bucket set up? (migration 0003)', 'error'); console.error(err); })
    .finally(() => { _rbBusy = false; if(input) input.value = ''; });
}
function rbForgetBook(bookId){
  if(!isReferee()) return;
  const b = rbBooks().find(x => x.id === bookId); if(!b) return;
  if(!confirm('Forget "' + (b.label||bookId) + '"? The file stays in storage; this just hides it from the group.')) return;
  rulebookConfig = { books: rbBooks().filter(x => x.id !== bookId) };
  saveRulebookConfig();
  if(qrefOpen) renderQref();
  if(typeof refreshOpenMenus === 'function') refreshOpenMenus();
}
// Settings ▸ Rulebook Library — rendered by renderSettingsMenu (js/60).
function rulebookLibraryHTML(){
  if(!(typeof isReferee === 'function' && isReferee())) return '';
  if(!_rbLoaded){ loadRulebookConfig().then(() => { if(typeof refreshOpenMenus === 'function') refreshOpenMenus(); }); }
  const books = rbBooks();
  const chip = 'padding:6px 8px;background:var(--bg2);border:1px solid var(--bd0);color:var(--tx0);border-radius:var(--rad);font-size:11px;cursor:pointer';
  let h = `<div class="settings-section-lbl">📚 Rulebook Library</div>`;
  books.forEach(b => {
    h += `<div class="settings-row" style="gap:6px">
      <span class="settings-row-label" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis" title="${escQH(b.name||'')}">📖 ${escQH(b.label||b.id)}</span>
      <label style="${chip}">Replace<input type="file" accept="application/pdf" style="display:none" onchange="rbReplaceBook(this,'${escQH(b.id)}')"></label>
      <button style="${chip};color:#d45050" onclick="rbForgetBook('${escQH(b.id)}')" title="Forget (file stays in storage)">✕</button>
    </div>`;
  });
  const used = new Set(books.map(b => b.id));
  const opts = RB_PRESETS.filter(p => !used.has(p.id)).map(p => `<option value="${p.id}">${escQH(p.label)}</option>`).join('')
             + `<option value="__custom">Other supplement…</option>`;
  h += `<div class="settings-row" style="gap:6px">
      <select id="rb-add-label" style="flex:1;min-width:0;background:var(--bg2);border:1px solid var(--bd0);border-radius:var(--rad);color:var(--tx0);padding:7px;font-size:12px">${opts}</select>
      <label style="${chip};white-space:nowrap">⬆ Add PDF<input type="file" accept="application/pdf" style="display:none" onchange="rbAddBook(this)"></label>
    </div>
    <div class="settings-row" style="font-size:11px;color:var(--tx1)">Your own legally-owned PDFs, stored for this campaign's group only — never part of the app. Page references in the Rules panel open the matching book at the cited page. (Needs the <code>rulebooks</code> bucket — migration 0003.)</div>`;
  return h;
}
function rulebookBarHTML(){
  const ref = (typeof isReferee === 'function') && isReferee();
  const books = rbBooks();
  if(books.length){
    let h = `<div class="rb-bar" style="flex-wrap:wrap">`;
    books.forEach(b => { h += `<button class="rb-open" onclick="openRulebook('','${escQH(b.id)}')" title="${escQH(b.name||'')}">📖 ${escQH(b.label||'Rulebook')}</button>`; });
    h += `</div>`;
    if(ref) h += `<div class="rr-hint">Manage books in Settings ▸ 📚 Rulebook Library.</div>`;
    return h;
  }
  if(ref) return `<div class="rr-hint">No rulebooks uploaded — add your own PDFs in Settings ▸ 📚 Rulebook Library. Page references below still show book + page as plain citations.</div>`;
  return '';
}

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
    '<div class="session-stat-row"><span>NPCs placed on station</span><span>' + npcsPlaced + '</span></div>' +
    ((typeof plannerResolvedCheckCount === 'function' && plannerResolvedCheckCount())
      ? '<div class="session-stat-row"><span>Dice checks recorded</span><span>' + plannerResolvedCheckCount() + '</span></div>' : '');
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

  // Dice checks & outcomes recorded in the Session Planner (js/97)
  if(typeof plannerChecksRecapLines === 'function'){
    const ckLines = plannerChecksRecapLines();
    ckLines.forEach(l => lines.push(l));
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

  // Dice checks recorded in the Session Planner (js/97) — prose lines, may be empty
  const checkProse = (typeof plannerChecksRecapProse === 'function') ? plannerChecksRecapProse() : [];

  if(!eventLog.length && !checkProse.length){
    out.innerHTML = '<span class="session-recap-empty">Nothing to recap yet. The recap builds from the event timeline as the session plays out — advance the clock and trigger events, or record dice checks in the Session Planner.</span>';
    return;
  }

  const parts = [];
  parts.push('SESSION RECAP — ' + new Date().toLocaleDateString());
  parts.push('');

  if(eventLog.length){
    const events = [...eventLog].reverse(); // oldest first
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
  }

  // Key rolls (Session Planner dice checks)
  checkProse.forEach(l => parts.push(l));

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


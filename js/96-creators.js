// ═══════════════════════════════════════════════════════════════════════════
// NPC CREATOR (design mode) — manual / random / AI
// ═══════════════════════════════════════════════════════════════════════════
// New NPCs are stored in contentAdditions[areaNpcListKey] and render through
// mergeListWithAdditions alongside the hardcoded NPCs.

// The list key for the currently-selected area/sub's NPC additions.
function stKeyForNpcs(){
  return cur + (curSub ? '_' + curSub : '') + '-npcs';
}

// ── Random generator tables (Traveller-flavoured, Hegemony setting) ────────
const NPC_GEN = {
  firstNames: ['Sable','Dara','Petra','Cho','Mira','Owan','Teva','Yumi','Forlan','Riven',
    'Calla','Nadia','Esen','Brannt','Vesh','Corin','Imara','Dax','Lel','Soraya',
    'Kesh','Anuk','Marlo','Tibor','Wen','Galla','Rho','Senna','Ulric','Vance'],
  lastNames: ['Mwenye','Sousa','Bin-Ha','Saenz','Frey','Adeyemi','Vey','Cole','Marek','Dane',
    'Oduya','Reyes','Okonkwo','Sato','Halvorsen','Nazari','Bex','Tarn','Ileri','Voss'],
  roles: [
    'Dock worker','Station clerk','Cargo handler','Maintenance tech','Security officer',
    'Bartender','Shop assistant','Medical orderly','Comms operator','Customs inspector',
    'Fuel broker','Black-market fixer','Hegemony liaison','Freelance pilot','Data courier',
    'Sensor technician','Life-support engineer','Quartermaster','Bureaucrat','Off-duty marine'],
  manners: [
    'Brisk and businesslike, no time for small talk.',
    'Nervous, keeps glancing at the exits.',
    'Warm and chatty, knows everyone by name.',
    'Flat affect, answers in as few words as possible.',
    'Overly formal, hides behind procedure.',
    'Tired, has done this shift a thousand times.',
    'Sharp-eyed, sizes the crew up immediately.',
    'Friendly veneer over clear wariness.'],
  wants: [
    'Wants the shift to end without incident.',
    'Owes someone money and it shows.',
    'Looking for a way off the station.',
    'Quietly gathering information for a third party.',
    'Wants to be left alone.',
    'Hoping the crew can solve a small problem for them.',
    'Protecting a secret that could cost them their post.',
    'Trying to make a name for themselves.'],
  hooks: [
    'Saw something on the maintenance level they shouldn\'t have.',
    'Knows a back route that bypasses security.',
    'Has a cousin in the RSR cell.',
    'Holds a grudge against the Hegemony delegation.',
    'Can be bribed, but only with information.',
    'Recognises one of the PCs from somewhere.',
    'Carries a data wafer they\'re afraid to hand over.',
    'Has been skimming inventory for months.']
};

function gen_pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function gen_2d6(){ return (Math.floor(Math.random()*6)+1) + (Math.floor(Math.random()*6)+1); }

// Build a random NPC object matching the schema.
function generateRandomNpc(){
  const name = gen_pick(NPC_GEN.firstNames) + ' ' + gen_pick(NPC_GEN.lastNames);
  const role = gen_pick(NPC_GEN.roles);
  const stats = { STR:gen_2d6(), DEX:gen_2d6(), END:gen_2d6(), INT:gen_2d6(), EDU:gen_2d6(), SOC:gen_2d6() };
  // Skills: pick 2-3 plausible from role
  const skillPool = ['Admin','Streetwise','Persuade','Recon','Computers','Engineer','Gun Combat',
    'Melee','Stealth','Broker','Carouse','Investigate','Mechanic','Medic','Pilot','Deception'];
  const nSkills = 2 + Math.floor(Math.random()*2);
  const chosen = [];
  while(chosen.length < nSkills){
    const s = gen_pick(skillPool);
    if(!chosen.find(c => c.startsWith(s))) chosen.push(s + ' ' + (1 + Math.floor(Math.random()*2)));
  }
  const rows = [
    ['Manner', gen_pick(NPC_GEN.manners)],
    ['Wants', gen_pick(NPC_GEN.wants)],
    ['Hook', gen_pick(NPC_GEN.hooks)]
  ];
  return { name, role, stats, skills: chosen.join(', '), rows };
}

// ── Persist a new NPC into the current area ────────────────────────────────
async function commitNewNpc(npc){
  const listKey = stKeyForNpcs();
  if(!contentAdditions[listKey]) contentAdditions[listKey] = [];
  contentAdditions[listKey].push(npc);
  await saveContentAdditions();
  if(currentView === 'station' && cur) renderDetail();
  showToast('NPC "' + npc.name + '" added');
}

async function deleteAddedNpc(listKey, nidKey){
  if(!confirm('Delete this NPC? This cannot be undone.')) return;
  // nidKey ends with 'addN'; extract N
  const m = nidKey.match(/add(\d+)$/);
  if(!m){ showToast('Could not delete NPC', 'error'); return; }
  const idx = parseInt(m[1], 10);
  if(contentAdditions[listKey] && contentAdditions[listKey][idx]){
    contentAdditions[listKey].splice(idx, 1);
    await saveContentAdditions();
    if(currentView === 'station' && cur) renderDetail();
    showToast('NPC deleted', 'info');
  }
}

// ── NPC Creator modal logic ────────────────────────────────────────────────
let npcCreatorMode = 'manual';
let npcCreatorDraft = null;   // working NPC object for random/AI preview
let npcCreatorRows = [];      // working rows for manual mode

function openNpcCreator(){
  if(!isReferee() || !designModeOn) return;
  if(!cur){ showToast('Select an area first', 'error'); return; }
  npcCreatorMode = 'manual';
  npcCreatorDraft = null;
  npcCreatorRows = [['Manner',''],['Wants','']];
  document.getElementById('npc-creator-modal').classList.add('open');
  setNpcCreatorMode('manual');
}

function closeNpcCreator(){
  document.getElementById('npc-creator-modal').classList.remove('open');
}

function setNpcCreatorMode(mode){
  npcCreatorMode = mode;
  ['manual','random'].forEach(m => {
    const tab = document.getElementById('npc-tab-'+m);
    if(tab) tab.classList.toggle('on', m === mode);
  });
  renderNpcCreatorBody();
}

function escAttr(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function escHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function renderNpcCreatorBody(){
  const body = document.getElementById('npc-creator-body');
  if(!body) return;
  const areaLabel = MAIN[cur] ? (curSub && MAIN[cur].subs && MAIN[cur].subs[curSub] ? MAIN[cur].subs[curSub].label : MAIN[cur].label) : '';

  if(npcCreatorMode === 'manual'){
    body.innerHTML = renderManualForm(areaLabel);
  } else if(npcCreatorMode === 'random'){
    body.innerHTML = renderRandomPanel(areaLabel);
  }
}

// ── Manual form ────────────────────────────────────────────────────────────
function renderManualForm(areaLabel){
  const d = npcCreatorDraft || { name:'', role:'', stats:{STR:7,DEX:7,END:7,INT:7,EDU:7,SOC:7}, skills:'' };
  const rows = npcCreatorRows;
  const statCells = ['STR','DEX','END','INT','EDU','SOC'].map(s =>
    `<div class="npc-stat-cell"><label>${s}</label><input type="number" min="0" max="15" id="npc-stat-${s}" value="${d.stats[s]}"></div>`
  ).join('');
  const rowsHtml = rows.map((r,i) =>
    `<div class="npc-row-edit">
      <input type="text" placeholder="Label" value="${escAttr(r[0])}" oninput="npcCreatorRows[${i}][0]=this.value">
      <textarea placeholder="Detail" oninput="npcCreatorRows[${i}][1]=this.value">${escHtml(r[1])}</textarea>
      <button class="npc-row-del" onclick="npcCreatorRows.splice(${i},1);renderNpcCreatorBody()" title="Remove">✕</button>
    </div>`
  ).join('');

  return `
    <div class="npc-gen-hint">Adding to <b style="color:var(--tx0)">${escHtml(areaLabel)}</b>. Fill in what you need — only a name is required.</div>
    <div class="npc-form-row">
      <label class="npc-form-lbl">Name</label>
      <input type="text" class="npc-form-input" id="npc-f-name" value="${escAttr(d.name)}" placeholder="e.g. Petra Sousa">
    </div>
    <div class="npc-form-row">
      <label class="npc-form-lbl">Role</label>
      <input type="text" class="npc-form-input" id="npc-f-role" value="${escAttr(d.role)}" placeholder="e.g. Guardhouse officer">
    </div>
    <div class="npc-form-row">
      <label class="npc-form-lbl">Characteristics</label>
      <div class="npc-stat-grid">${statCells}</div>
    </div>
    <div class="npc-form-row">
      <label class="npc-form-lbl">Skills</label>
      <input type="text" class="npc-form-input" id="npc-f-skills" value="${escAttr(d.skills)}" placeholder="e.g. Admin 2, Persuade 1, Gun Combat 1">
    </div>
    <div class="npc-form-row">
      <label class="npc-form-lbl">Details</label>
      <div class="npc-rows-editor">${rowsHtml}</div>
      <button class="npc-row-add" onclick="npcCreatorRows.push(['','']);renderNpcCreatorBody()">+ Add detail row</button>
    </div>
    <div class="npc-creator-footer">
      <button class="npc-creator-btn" onclick="closeNpcCreator()">Cancel</button>
      <button class="npc-creator-btn primary" onclick="saveManualNpc()">Add NPC</button>
    </div>`;
}

function collectManualForm(){
  const name = (document.getElementById('npc-f-name')||{}).value || '';
  const role = (document.getElementById('npc-f-role')||{}).value || '';
  const skills = (document.getElementById('npc-f-skills')||{}).value || '';
  const stats = {};
  ['STR','DEX','END','INT','EDU','SOC'].forEach(s => {
    const el = document.getElementById('npc-stat-'+s);
    stats[s] = el ? (parseInt(el.value,10) || 0) : 7;
  });
  const rows = npcCreatorRows.filter(r => r[0].trim() || r[1].trim());
  return { name: name.trim(), role: role.trim(), stats, skills: skills.trim(), rows };
}

async function saveManualNpc(){
  const npc = collectManualForm();
  if(!npc.name){ showToast('NPC needs a name', 'error'); return; }
  await commitNewNpc(npc);
  closeNpcCreator();
}

// ── Random panel ───────────────────────────────────────────────────────────
function renderRandomPanel(areaLabel){
  const d = npcCreatorDraft;
  const preview = d ? renderNpcPreview(d) : '<div class="npc-gen-hint">Click <b style="color:var(--tx0)">Roll NPC</b> to generate a random Traveller NPC. Roll as many times as you like, then add the one you want.</div>';
  return `
    <div class="npc-gen-hint">Adding to <b style="color:var(--tx0)">${escHtml(areaLabel)}</b>. Characteristics are rolled 2D6; manner, wants, and hook come from setting-flavoured tables.</div>
    <div style="text-align:center;margin-bottom:8px">
      <button class="npc-creator-btn primary" onclick="rollRandomNpc()">🎲 Roll NPC</button>
    </div>
    <div id="npc-random-preview">${preview}</div>
    ${d ? `<div class="npc-creator-footer">
      <button class="npc-creator-btn" onclick="closeNpcCreator()">Cancel</button>
      <button class="npc-creator-btn" onclick="editDraftInManual()">✍ Tweak first</button>
      <button class="npc-creator-btn primary" onclick="saveDraftNpc()">Add this NPC</button>
    </div>` : ''}`;
}

function rollRandomNpc(){
  npcCreatorDraft = generateRandomNpc();
  renderNpcCreatorBody();
}

// ── Shared preview + save for random drafts ────────────────────────────────
function renderNpcPreview(npc){
  const stats = Object.entries(npc.stats||{}).map(([k,v]) => `${k} ${v}`).join('  ');
  const rows = (npc.rows||[]).map(r => `<div class="npc-preview-row"><b>${escHtml(r[0])}:</b> ${escHtml(r[1])}</div>`).join('');
  return `
    <div class="npc-preview">
      <div class="npc-preview-name">${escHtml(npc.name)}</div>
      <div class="npc-preview-role">${escHtml(npc.role||'')}</div>
      <div class="npc-preview-stats">${stats}</div>
      ${npc.skills ? `<div class="npc-preview-skills">${escHtml(npc.skills)}</div>` : ''}
      ${rows}
    </div>`;
}

async function saveDraftNpc(){
  if(!npcCreatorDraft){ return; }
  const npc = { ...npcCreatorDraft };
  if(!npc.name){ showToast('NPC needs a name', 'error'); return; }
  await commitNewNpc(npc);
  closeNpcCreator();
}

// Move the current draft into the manual editor for tweaking before saving.
function editDraftInManual(){
  if(npcCreatorDraft){
    npcCreatorRows = (npcCreatorDraft.rows || []).map(r => [r[0], r[1]]);
    if(!npcCreatorRows.length) npcCreatorRows = [['','']];
  }
  setNpcCreatorMode('manual');
}

// ═══════════════════════════════════════════════════════════════════════════
// BODY CREATOR  —  add planets / moons / asteroid belts in design mode
// ═══════════════════════════════════════════════════════════════════════════
// Mirrors the NPC creator's structure: a modal with Manual and Random (UWP)
// tabs, a working draft, and a commit that pushes into bodyAdditions (system-
// scoped, Supabase-synced). Random generation follows Mongoose Traveller 2e /
// World Builder's Handbook world-profile rules.

let bodyCreatorMode = 'manual';
let bodyCreatorDraft = null;   // {starport,size,atm,hydro,pop,gov,law,tech} for random tab
let bodyEditTargetId = null;   // when editing an existing body's properties

const BODY_CLASS_OPTIONS = [
  ['planet','Planet'],['moon','Moon'],['belt','Asteroid Belt'],
  ['gasgiant','Gas Giant'],['star','Star']
];
const BODY_TAG_OPTIONS = ['','FLAVOUR','ADVENTURE HOOK','CLASSIFIED','RESTRICTED','CAMPAIGN HUB'];

// ── Dice / UWP — delegate to the shared rules-correct generator (WGEN) ───────
// The body modal + system auto-generator use the {starport,atm,tech} field shape;
// genUWP() remaps WGEN's canonical {port,atmo,tl} output to it. roll2d6() is the
// single global one (above); clamp/ehex/tradeCodes are thin WGEN delegates.
function clamp(v,lo,hi){ return WGEN.clamp(v,lo,hi); }
function ehex(n){ return WGEN.ehex(n); }
function genUWP(){ const u = WGEN.genUWP();
  return { starport:u.port, size:u.size, atm:u.atmo, hydro:u.hydro, pop:u.pop, gov:u.gov, law:u.law, tech:u.tl }; }
function uwpToString(u, starport){ return WGEN.uwpStr(starport ? Object.assign({}, u, {port:starport}) : u); }
function tradeCodes(u){ return WGEN.tradeCodes(u); }
const UWP_FIELD_LABELS = {
  starport:'Starport', size:'Size', atm:'Atmosphere', hydro:'Hydrographics',
  pop:'Population', gov:'Government', law:'Law Level', tech:'Tech Level'
};
// Human-readable decode for the preview
function decodeUWP(u){
  const sizeKm = u.size===0 ? 'belt/<1,000 km' : '~'+(u.size*1600).toLocaleString()+' km';
  return [
    `Starport ${u.starport}`,
    `Size ${ehex(u.size)} (${sizeKm})`,
    `Atmo ${ehex(u.atm)}`,
    `Hydro ${ehex(u.hydro)} (${u.hydro*10}% water)`,
    `Pop ${ehex(u.pop)} (10^${u.pop})`,
    `Gov ${ehex(u.gov)}`,
    `Law ${ehex(u.law)}`,
    `TL ${ehex(u.tech)}`
  ].join(' · ');
}

// ── Open / close / mode ────────────────────────────────────────────────────
function openBodyCreator(force){
  // `force` lets the blank-system prompt open the creator without first toggling
  // design mode; the design-mode "+ Add Body" button still calls it bare.
  if(!isReferee()) return;
  if(!force && !designModeOn) return;
  bodyCreatorMode = 'manual';
  bodyCreatorDraft = null;
  bodyEditTargetId = null;
  document.getElementById('body-creator-title').textContent = '✦ Add Body';
  document.getElementById('body-creator-tabs').style.display = 'flex';
  // The "Random (UWP)" tab exists only when the active Campaign Pack's
  // world-schema provider supports generation; provider:'none' hides it so a
  // non-Traveller universe isn't offered a UWP roller it can't use.
  const genOn = (typeof pkWorldSchema !== 'function') || (pkWorldSchema().provider === 'traveller-uwp');
  const randTab = document.getElementById('body-tab-random');
  if(randTab) randTab.style.display = genOn ? '' : 'none';
  document.getElementById('body-creator-modal').classList.add('open');
  setBodyCreatorMode('manual');
}
function closeBodyCreator(){
  document.getElementById('body-creator-modal').classList.remove('open');
  bodyEditTargetId = null;
}
function setBodyCreatorMode(mode){
  bodyCreatorMode = mode;
  ['manual','random'].forEach(m => {
    const tab = document.getElementById('body-tab-'+m);
    if(tab) tab.classList.toggle('on', m === mode);
  });
  renderBodyCreatorBody();
}
function renderBodyCreatorBody(){
  const body = document.getElementById('body-creator-body');
  if(!body) return;
  if(bodyCreatorMode === 'manual') body.innerHTML = renderBodyManualForm();
  else body.innerHTML = renderBodyRandomPanel();
}

// ── Shared field helpers ───────────────────────────────────────────────────
// Ids covered by the built-in body classes / disc renderers; pack object types
// with one of these ids don't clutter the dropdown (the built-in class already
// represents them). Referee-defined types (any other id) are appended.
const BODY_BUILTIN_TYPE_IDS = ['star','world','ice','rock','moon','gasgiant','belt'];
function bodyCustomTypes(){
  return (typeof pkObjectTypes === 'function')
    ? pkObjectTypes().filter(t => t.id && BODY_BUILTIN_TYPE_IDS.indexOf(t.id) < 0)
    : [];
}
function bodyClassSelect(selected){
  const extra = bodyCustomTypes().map(t => ['type:' + t.id, t.label || t.id]);
  const opts = BODY_CLASS_OPTIONS.concat(extra);
  return `<select class="body-select" id="body-f-class" onchange="onBodyClassChange()">${
    opts.map(([v,l]) => `<option value="${v}"${v===selected?' selected':''}>${escHtml(l)}</option>`).join('')
  }</select>`;
}
// Maps a class dropdown value (built-in class or "type:<packTypeId>") to the
// built-in layout class the form's row-toggling / flag logic understands.
function bodyClassNormalize(raw){
  if((raw||'').indexOf('type:') !== 0) return raw || 'planet';
  const t = (typeof pkObjectTypes==='function') ? pkObjectTypes().find(x => x.id === raw.slice(5)) : null;
  const disc = t && t.disc;
  return disc==='star'?'star' : disc==='moon'?'moon' : disc==='belt'?'belt' : disc==='gasgiant'?'gasgiant' : 'planet';
}
function bodyParentSelect(selected){
  const opts = getBodies().filter(b => !b.isMoon).map(b =>
    `<option value="${b.id}"${b.id===selected?' selected':''}>${escHtml(b.name)}</option>`).join('');
  return `<select class="body-select" id="body-f-parent">${opts || '<option value="">(no parent bodies)</option>'}</select>`;
}
function bodyTagSelect(selected){
  return `<select class="body-select" id="body-f-tag">${
    BODY_TAG_OPTIONS.map(t => `<option value="${t}"${t===selected?' selected':''}>${t||'(none)'}</option>`).join('')
  }</select>`;
}
// Grouped picker of the hosted globe textures (value = exact filename, '' = auto
// by type, '__none__' = forced procedural). Populated from the runtime catalog.
function bodyTextureSelect(selected){
  const groups = {};
  textureCatalog.forEach(f => {
    const g = (f.match(/^[A-Za-z]+/) || ['Other'])[0];
    (groups[g] = groups[g] || []).push(f);
  });
  let opts = `<option value=""${!selected?' selected':''}>(Auto — match planet type)</option>`;
  opts += `<option value="__none__"${selected==='__none__'?' selected':''}>(None — procedural disc)</option>`;
  Object.keys(groups).forEach(g => {
    opts += `<optgroup label="${escAttr(g)}">`;
    groups[g].forEach(f => {
      const label = f.replace(/_1920x1080/i,'').replace(/\.(png|jpe?g|webp)$/i,'').trim();
      opts += `<option value="${escAttr(f)}"${f===selected?' selected':''}>${escHtml(label)}</option>`;
    });
    opts += `</optgroup>`;
  });
  if(!textureCatalog.length) opts += `<optgroup label="(texture list still loading — reopen this editor)"></optgroup>`;
  return `<select class="body-select" id="body-f-texture">${opts}</select>`;
}
function bodyOrbitSelect(selected){
  let opts = '';
  for(let i=1;i<=12;i++) opts += `<option value="${i}"${i===selected?' selected':''}>Orbit slot ${i}</option>`;
  return `<select class="body-select" id="body-f-orbit">${opts}</select>`;
}
function onBodyClassChange(){
  const cls = bodyClassNormalize((document.getElementById('body-f-class')||{}).value);
  const parentRow = document.getElementById('body-parent-row');
  const orbitRow = document.getElementById('body-orbit-row');
  const beltRow = document.getElementById('body-belt-row');
  if(parentRow) parentRow.style.display = (cls==='moon') ? '' : 'none';
  if(orbitRow) orbitRow.style.display = (cls==='moon') ? 'none' : '';
  if(beltRow) beltRow.style.display = (cls==='belt') ? '' : 'none';
}

// Suggest the next free orbit slot
function nextFreeOrbitSlot(){
  const used = {};
  getBodies().forEach(b => { if(b.orbitPos) used[b.orbitPos] = true; });
  for(let i=1;i<=12;i++) if(!used[i]) return i;
  return 12;
}

// Provider-aware world-profile inputs: the single UWP field for the Traveller
// schema (default, unchanged), or one input per referee-defined schema field
// (stored on body.fields) for a custom universe.
function renderBodyProfileFields(d){
  const ws = (typeof pkWorldSchema === 'function') ? pkWorldSchema() : { provider:'traveller-uwp' };
  if(ws.provider === 'traveller-uwp'){
    return `<div class="npc-form-row">
      <label class="npc-form-lbl">UWP</label>
      <input type="text" class="npc-form-input" id="body-f-uwp" value="${escAttr(d.uwpString)}" placeholder="e.g. B867976-C or — " style="font-family:monospace">
    </div>`;
  }
  const bf = (d && d.fields) || {};
  return (ws.fields||[]).map(f => `<div class="npc-form-row">
      <label class="npc-form-lbl">${escHtml(f.label||f.key)}</label>
      <input type="text" class="npc-form-input" id="body-f-fld-${f.key}" value="${escAttr(bf[f.key])}">
    </div>`).join('');
}
// ── Manual form ────────────────────────────────────────────────────────────
function renderBodyManualForm(prefill){
  const d = prefill || bodyCreatorDraft || {};
  const cls = d.bodyClass || 'planet';
  const orbit = d.orbitPos || nextFreeOrbitSlot();
  const color = d.color || '#8b91a8';
  return `
    <div class="npc-gen-hint">Adding to <b style="color:var(--tx0)">${escHtml(currentSystem().name)} system</b>. Only a name is required.</div>
    <div class="npc-form-row">
      <label class="npc-form-lbl">Name</label>
      <input type="text" class="npc-form-input" id="body-f-name" value="${escAttr(d.name)}" placeholder="e.g. Halcyon">
    </div>
    <div class="npc-form-row">
      <label class="npc-form-lbl">Body class</label>
      ${bodyClassSelect(cls)}
    </div>
    <div class="npc-form-row" id="body-parent-row" style="display:${cls==='moon'?'':'none'}">
      <label class="npc-form-lbl">Parent body</label>
      ${bodyParentSelect(d.parentId)}
    </div>
    <div class="npc-form-row" id="body-orbit-row" style="display:${cls==='moon'?'none':''}">
      <label class="npc-form-lbl">Orbit slot (inner → outer)</label>
      ${bodyOrbitSelect(orbit)}
    </div>
    <div class="npc-form-row">
      <label class="npc-form-lbl">Type label (free text)</label>
      <input type="text" class="npc-form-input" id="body-f-type" value="${escAttr(d.type)}" placeholder="e.g. Terrestrial · Ice-Rock">
    </div>
    ${renderBodyProfileFields(d)}
    <div class="body-uwp-grid">
      <div class="npc-form-row"><label class="npc-form-lbl">Orbit (AU / note)</label>
        <input type="text" class="npc-form-input" id="body-f-orbitau" value="${escAttr(d.orbitAU)}" placeholder="e.g. 2.4 AU"></div>
      <div class="npc-form-row"><label class="npc-form-lbl">Diameter</label>
        <input type="text" class="npc-form-input" id="body-f-diameter" value="${escAttr(d.diameter)}" placeholder="e.g. ~6,200 km"></div>
    </div>
    <div class="npc-form-row">
      <label class="npc-form-lbl">Period</label>
      <input type="text" class="npc-form-input" id="body-f-period" value="${escAttr(d.period)}" placeholder="e.g. ~2.4 standard years">
    </div>
    <div class="body-uwp-grid">
      <div class="npc-form-row"><label class="npc-form-lbl">Colour</label>
        <div class="body-color-row"><input type="color" id="body-f-color" value="${/^#[0-9a-fA-F]{6}$/.test(color)?color:'#8b91a8'}" oninput="syncBodyColorSwatch()"><input type="text" class="npc-form-input" id="body-f-colorhex" value="${escAttr(color)}" oninput="syncBodyColorHex()" style="font-family:monospace"></div></div>
      <div class="npc-form-row"><label class="npc-form-lbl">Tag</label>${bodyTagSelect(d.tag||'')}</div>
    </div>
    <div class="npc-form-row" id="body-belt-row" style="display:${cls==='belt'?'':'none'}">
      <label class="npc-form-lbl">Belt density (dot count, 20–600)</label>
      <input type="number" class="npc-form-input" id="body-f-density" min="20" max="600" value="${d.beltDensity||160}">
    </div>
    <div class="npc-form-row body-check-row">
      <input type="checkbox" id="body-f-hook" ${d.hook?'checked':''}><label for="body-f-hook" style="margin:0;cursor:pointer">Adventure hook (gold highlight + ! marker)</label>
    </div>
    <div class="npc-form-row body-check-row">
      <input type="checkbox" id="body-f-dock" ${d.tradersDock?'checked':''}><label for="body-f-dock" style="margin:0;cursor:pointer">⚓ Traders dock here (NPC convoys berth at this body — one per system)</label>
    </div>
    <div class="npc-form-row">
      <label class="npc-form-lbl">Overview / description</label>
      <textarea class="npc-form-textarea" id="body-f-desc" style="min-height:70px">${escHtml(d.desc)}</textarea>
    </div>
    <div class="npc-form-row">
      <label class="npc-form-lbl">Referee note</label>
      <textarea class="npc-form-textarea" id="body-f-refnote" style="min-height:50px">${escHtml(d.refNote)}</textarea>
    </div>
    <div class="npc-form-row">
      <label class="npc-form-lbl">Read aloud</label>
      <textarea class="npc-form-textarea" id="body-f-readaloud" style="min-height:50px">${escHtml(d.readAloud)}</textarea>
    </div>
    <div class="npc-form-row">
      <label class="npc-form-lbl">Surface texture — hosted globe (optional)</label>
      ${bodyTextureSelect(d.texture||'')}
    </div>
    <div class="npc-creator-footer">
      <button class="npc-creator-btn" onclick="closeBodyCreator()">Cancel</button>
      <button class="npc-creator-btn primary" onclick="saveBodyFromForm()">${bodyEditTargetId?'Save Changes':'Add Body'}</button>
    </div>`;
}
function syncBodyColorHex(){
  const hex = (document.getElementById('body-f-colorhex')||{}).value || '';
  if(/^#[0-9a-fA-F]{6}$/.test(hex)){ const c = document.getElementById('body-f-color'); if(c) c.value = hex; }
}
// Swatch → hex text: the form saves colour from the hex field, so a pick made in
// the native colour swatch must be mirrored back or it's silently dropped.
function syncBodyColorSwatch(){
  const c = document.getElementById('body-f-color'); if(!c) return;
  const h = document.getElementById('body-f-colorhex'); if(h) h.value = c.value;
}

// Maps a body-class choice to the boolean/type flags the renderer expects
function applyBodyClass(obj, cls){
  obj.isStar = (cls === 'star');
  obj.isMoon = (cls === 'moon');
  if(cls === 'belt' && !/asteroid belt/i.test(obj.type||'')){
    obj.type = obj.type ? obj.type : 'Asteroid Belt';
    if(!/asteroid belt/i.test(obj.type)) obj.type = 'Asteroid Belt';
  }
  return obj;
}

function collectBodyForm(){
  const g = id => (document.getElementById(id)||{}).value;
  const rawCls = g('body-f-class') || 'planet';
  // A "type:<id>" selection is a referee-defined object type; normalise it to a
  // built-in layout class for the flag logic and remember the pack type so the
  // body carries its typeId + disc.
  const packType = (rawCls.indexOf('type:')===0 && typeof pkObjectTypes==='function')
    ? pkObjectTypes().find(x => x.id === rawCls.slice(5)) : null;
  const cls = bodyClassNormalize(rawCls);
  const name = (g('body-f-name')||'').trim();
  let type = (g('body-f-type')||'').trim();
  if(cls === 'belt' && !/asteroid belt/i.test(type)) type = type ? (type + ' · Asteroid Belt') : 'Asteroid Belt';
  // Switching a body AWAY from belt: strip the auto-added belt suffix so the
  // type string can't keep classifying it as a belt (the Scoria flip).
  if(cls !== 'belt') type = type.replace(/\s*·\s*Asteroid Belt\s*$/i, '').trim();
  if(cls === 'gasgiant' && !type) type = 'Gas Giant';
  if(cls === 'moon' && !type) type = 'Moon';
  if(cls === 'star' && !type) type = 'Star';
  const obj = {
    name,
    type: type || 'Terrestrial',
    tag: g('body-f-tag') || null,
    color: (g('body-f-colorhex')||'').trim() || '#8b91a8',
    orbitAU: (g('body-f-orbitau')||'').trim() || '—',
    uwpString: (g('body-f-uwp')||'').trim() || '—',
    diameter: (g('body-f-diameter')||'').trim() || '—',
    period: (g('body-f-period')||'').trim() || '—',
    isMoon: cls === 'moon',
    isStar: cls === 'star',
    hook: !!(document.getElementById('body-f-hook')||{}).checked,
    // null (not false) when unticked, so an un-flagged body diffs clean against
    // base data and never writes a no-op override.
    tradersDock: (document.getElementById('body-f-dock')||{}).checked || null,
    desc: g('body-f-desc') || '',
    refNote: (g('body-f-refnote')||'').trim() || null,
    readAloud: (g('body-f-readaloud')||'').trim() || null,
    texture: g('body-f-texture') || null,
    npcs: [], checks: [], events: []
  };
  if(cls === 'moon'){
    obj.parentId = g('body-f-parent') || null;
    obj.orbitPos = null;
  } else {
    obj.orbitPos = parseInt(g('body-f-orbit'),10) || nextFreeOrbitSlot();
  }
  if(cls === 'belt'){
    obj.beltDensity = clamp(parseInt(g('body-f-density'),10)||160, 20, 600);
  }
  // Sensible display radius defaults by class
  obj.displayRadius = cls==='star'?18 : cls==='gasgiant'?16 : cls==='moon'?4 : 8;
  // Persist an explicit disc style for the unambiguous classes so the renderer
  // never has to re-guess from the free-text type (and so a body keeps its
  // class consistently across the orrery and close-up views). "planet" stays
  // null so ocean / ice / rock can still be derived from the type label.
  obj.discStyle = ({ belt:'belt', gasgiant:'gasgiant', star:'star', moon:'moon' })[cls] || null;
  // Referee-defined object type: stamp the typeId + its disc, and default the
  // free-text type label to the type's name when the referee left it blank.
  if(packType){
    obj.typeId = packType.id;
    if(packType.disc) obj.discStyle = packType.disc;
    if(!(g('body-f-type')||'').trim()) obj.type = packType.label || obj.type;
  }
  // Custom world schema: collect the referee-defined fields onto body.fields.
  const ws0 = (typeof pkWorldSchema === 'function') ? pkWorldSchema() : { provider:'traveller-uwp' };
  if(ws0.provider !== 'traveller-uwp'){
    const bf = {};
    (ws0.fields||[]).forEach(f => { const v = g('body-f-fld-'+f.key); if(v != null && String(v).trim() !== '') bf[f.key] = String(v).trim(); });
    obj.fields = bf;
  }
  return obj;
}

async function saveBodyFromForm(){
  const obj = collectBodyForm();
  if(!obj.name){ showToast('Body needs a name', 'error'); return; }
  if(obj.isMoon && !obj.parentId){ showToast('Pick a parent body for the moon', 'error'); return; }
  // UWP light validation (allow — for unprofiled bodies)
  if(obj.uwpString && obj.uwpString !== '—' && !/^[A-EX][0-9A-Z–—-]{6}-?[0-9A-Z]$/i.test(obj.uwpString.replace(/—/g,'-'))){
    if(!confirm('That UWP doesn\'t look standard. Save it anyway?')) return;
  }
  if(bodyEditTargetId){
    await commitBodyEdit(bodyEditTargetId, obj);
  } else {
    await commitNewBody(obj);
  }
  closeBodyCreator();
}

// ── Random (UWP) panel ─────────────────────────────────────────────────────
function renderBodyRandomPanel(){
  const u = bodyCreatorDraft && bodyCreatorDraft._uwp;
  let preview;
  if(!u){
    preview = '<div class="npc-gen-hint">Click <b style="color:var(--tx0)">Roll UWP</b> to generate a Traveller world profile. Re-roll the whole thing or any single field, override any value, then add it.</div>';
  } else {
    const sp = u.starport;
    const cells = ['starport','size','atm','hydro','pop','gov','law','tech'].map(f => {
      const val = f==='starport' ? sp : ehex(u[f]);
      return `<div class="body-uwp-cell">
        <label>${UWP_FIELD_LABELS[f]}<button class="uwp-roll" onclick="rerollUwpField('${f}')" title="Re-roll">🎲</button></label>
        <input type="text" id="uwp-f-${f}" value="${val}" oninput="onUwpFieldEdit('${f}',this.value)">
      </div>`;
    }).join('');
    const trades = tradeCodes(u);
    preview = `
      <div class="body-uwp-string" id="uwp-string">${uwpToString(u, sp)}</div>
      <div class="body-uwp-decode">${decodeUWP(u)}</div>
      <div class="body-uwp-trade">Trade: ${trades.length?trades.join(' '):'—'}</div>
      <div class="body-uwp-grid">${cells}</div>`;
  }
  return `
    <div class="npc-gen-hint">Adding to <b style="color:var(--tx0)">${escHtml(currentSystem().name)} system</b>. Profile rolled per Traveller 2e world-generation rules.</div>
    <div style="text-align:center;margin-bottom:10px">
      <button class="npc-creator-btn primary" onclick="rollFullUwp()">🎲 Roll UWP</button>
    </div>
    <div id="uwp-preview">${preview}</div>
    ${u ? `<div class="npc-creator-footer">
      <button class="npc-creator-btn" onclick="closeBodyCreator()">Cancel</button>
      <button class="npc-creator-btn" onclick="uwpToManual()">✍ Add details first</button>
      <button class="npc-creator-btn primary" onclick="uwpToManual(true)">Continue →</button>
    </div>` : ''}`;
}
function rollFullUwp(){
  bodyCreatorDraft = bodyCreatorDraft || {};
  bodyCreatorDraft._uwp = genUWP();
  renderBodyCreatorBody();
}
function rerollUwpField(field){
  if(!bodyCreatorDraft || !bodyCreatorDraft._uwp) return;
  const u = bodyCreatorDraft._uwp;
  if(field === 'starport') u.starport = WGEN.genStarport(null, u.pop);   // RAW: 2D + Population DM
  else if(field === 'size') u.size = clamp(roll2d6()-2,0,10);
  else if(field === 'atm') u.atm = u.size===0?0:clamp(roll2d6()-7+u.size,0,15);
  else if(field === 'hydro'){ let dm=0; if(u.atm<=1||u.atm>=10)dm-=4; u.hydro = u.size<=1?0:clamp(roll2d6()-7+u.atm+dm,0,10); }
  else if(field === 'pop') u.pop = clamp(roll2d6()-2,0,12);
  else if(field === 'gov') u.gov = u.pop===0?0:clamp(roll2d6()-7+u.pop,0,15);
  else if(field === 'law') u.law = u.pop===0?0:clamp(roll2d6()-7+u.gov,0,15);
  else if(field === 'tech') u.tech = u.pop===0?0:WGEN.genTechLevel(null,u.starport,u.size,u.atm,u.hydro,u.pop,u.gov);
  renderBodyCreatorBody();
}
function ehexToNum(ch){
  const digits = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const i = digits.indexOf((ch||'').toUpperCase());
  return i < 0 ? 0 : i;
}
function onUwpFieldEdit(field, val){
  if(!bodyCreatorDraft || !bodyCreatorDraft._uwp) return;
  const u = bodyCreatorDraft._uwp;
  if(field === 'starport') u.starport = (val||'X').toUpperCase().slice(0,1);
  else u[field] = ehexToNum(val);
  // Live-update the string + decode without a full re-render (keeps focus)
  const s = document.getElementById('uwp-string');
  if(s) s.textContent = uwpToString(u, u.starport);
  const dec = document.querySelector('.body-uwp-decode');
  if(dec) dec.textContent = decodeUWP(u);
  const tr = document.querySelector('.body-uwp-trade');
  if(tr){ const t = tradeCodes(u); tr.textContent = 'Trade: ' + (t.length?t.join(' '):'—'); }
}
// Move the rolled UWP into the manual form so the referee can name it / add prose
function uwpToManual(){
  const u = bodyCreatorDraft && bodyCreatorDraft._uwp;
  const prefill = {
    uwpString: u ? uwpToString(u, u.starport) : '',
    bodyClass: (u && u.size === 0) ? 'belt' : 'planet',
    beltDensity: 160,
    color: (u && u.size===0) ? '#8B7355' : '#8b91a8'
  };
  bodyCreatorDraft = Object.assign({}, prefill);
  bodyCreatorMode = 'manual';
  ['manual','random'].forEach(m => { const t=document.getElementById('body-tab-'+m); if(t) t.classList.toggle('on', m==='manual'); });
  document.getElementById('body-creator-body').innerHTML = renderBodyManualForm(prefill);
  // Apply class-dependent visibility after injecting
  onBodyClassChange();
}

// ── Commit / edit / delete ─────────────────────────────────────────────────
// A body edit (UWP, type, add/remove) can change a world's MgT2e trade codes or its fuel
// sources (gas giant / A-B refinery), which the living economy derives an unconfigured world
// from. Clear HX's cached UWPs (HX.syncNodes) then re-settle ECON so the change shows live
// instead of only after a reload. Harmless/idempotent for edits that don't affect the economy.
function econAfterBodyChange(){
  try { if(typeof HX!=='undefined' && HX.syncNodes && typeof GALAXY_NODES!=='undefined') HX.syncNodes(GALAXY_NODES); } catch(e){}
  try { if(typeof ECON!=='undefined' && ECON.syncLanes) ECON.syncLanes(); } catch(e){}
}

// One trade dock per system: flagging a body "Traders dock here" clears the
// flag on every other body, through the same overlay engine body edits use
// (added bodies mutate in place; base bodies get a bodyPropertyOverrides
// entry). The REAL-map datacard checkbox (js/15) routes through this too.
async function clearOtherTraderDocks(sysId, keepId){
  let addsDirty = false, ovDirty = false;
  effectiveBodies(sysId).forEach(b => {
    if(b.id === keepId || !b.tradersDock) return;
    const added = (bodyAdditions[sysId] || []).find(x => x.id === b.id);
    if(added){ added.tradersDock = null; addsDirty = true; }
    else {
      if(!bodyPropertyOverrides[sysId]) bodyPropertyOverrides[sysId] = {};
      if(!bodyPropertyOverrides[sysId][b.id]) bodyPropertyOverrides[sysId][b.id] = {};
      bodyPropertyOverrides[sysId][b.id].tradersDock = null;
      ovDirty = true;
    }
  });
  if(addsDirty) await saveBodyAdditions();
  if(ovDirty) await saveBodyPropertyOverrides();
}

async function commitNewBody(obj){
  recordDesignUndo('Add body "' + (obj.name||'') + '"');
  obj.id = 'body-add-' + Date.now() + '-' + Math.floor(Math.random()*1000);
  if(!bodyAdditions[currentSystemId]) bodyAdditions[currentSystemId] = [];
  bodyAdditions[currentSystemId].push(obj);
  await saveBodyAdditions();
  if(obj.tradersDock) await clearOtherTraderDocks(currentSystemId, obj.id);
  econAfterBodyChange();
  buildOrrery();
  showToast('Body "' + obj.name + '" added');
  selectBody(obj.id);
}

// Open the editor pre-filled with an existing body's current (effective) values
function openBodyEditor(id){
  if(!isReferee() || !designModeOn) return;
  const b = getBodies().find(x => x.id === id);
  if(!b){ showToast('Body not found', 'error'); return; }
  bodyEditTargetId = id;
  bodyCreatorMode = 'manual';
  // Honour an explicit discStyle first (set by prior edits) so the editor opens
  // on the class the body actually renders as, then fall back to the type text.
  // A body tagged with a referee-defined (non-built-in) object type re-opens on
  // that type; otherwise fall back to the built-in class detection.
  const isCustomType = b.typeId && bodyCustomTypes().some(t => t.id === b.typeId);
  const cls = isCustomType ? ('type:' + b.typeId)
    : b.isStar?'star' : b.isMoon?'moon'
    : (b.discStyle==='belt' || /asteroid belt/i.test(b.type||''))?'belt'
    : (b.discStyle==='gasgiant' || /gas giant/i.test(b.type||''))?'gasgiant' : 'planet';
  bodyCreatorDraft = {
    name:b.name, type:b.type, tag:b.tag||'', color:b.color, orbitAU:b.orbitAU,
    uwpString:b.uwpString, diameter:b.diameter, period:b.period, hook:!!b.hook,
    desc:b.desc, refNote:b.refNote, readAloud:b.readAloud, parentId:b.parentId,
    orbitPos:b.orbitPos, beltDensity:b.beltDensity, bodyClass:cls, fields:b.fields,
    tradersDock:!!b.tradersDock
  };
  document.getElementById('body-creator-title').textContent = '✦ Edit Body Properties';
  document.getElementById('body-creator-tabs').style.display = 'none';
  document.getElementById('body-creator-modal').classList.add('open');
  document.getElementById('body-creator-body').innerHTML = renderBodyManualForm(bodyCreatorDraft);
  onBodyClassChange();
}

async function commitBodyEdit(id, obj){
  recordDesignUndo('Edit body "' + (obj.name||'') + '"');
  obj.id = id;
  if(isAddedBody(id)){
    // Edit the addition in place (preserve its npcs/checks/events)
    const arr = bodyAdditions[currentSystemId] || [];
    const idx = arr.findIndex(b => b.id === id);
    if(idx >= 0){
      const prev = arr[idx];
      obj.npcs = prev.npcs || []; obj.checks = prev.checks || []; obj.events = prev.events || [];
      arr[idx] = obj;
      await saveBodyAdditions();
    }
  } else {
    // Base body — store only the changed metadata fields as overrides so the
    // body's checks/events/npcs and identity stay anchored to the base data.
    const base = baseBodiesFor(currentSystemId).find(b => b.id === id) || {};
    const fields = ['name','type','typeId','fields','tag','color','orbitAU','uwpString','diameter','period','hook','tradersDock','desc','refNote','readAloud','orbitPos','parentId','beltDensity','isMoon','isStar','discStyle','texture','textureUrl'];
    const ov = {};
    fields.forEach(f => {
      const nv = obj[f];
      // Normalise null/'' equivalence so we don't store no-op overrides
      const bv = base[f];
      const norm = v => (v === '' || v === undefined) ? null : v;
      if(norm(nv) !== norm(bv)) ov[f] = nv;
    });
    if(!bodyPropertyOverrides[currentSystemId]) bodyPropertyOverrides[currentSystemId] = {};
    if(Object.keys(ov).length) bodyPropertyOverrides[currentSystemId][id] = ov;
    else delete bodyPropertyOverrides[currentSystemId][id];
    await saveBodyPropertyOverrides();
  }
  if(obj.tradersDock) await clearOtherTraderDocks(currentSystemId, id);
  econAfterBodyChange();
  buildOrrery();
  showToast('Body updated');
  // Refresh whichever view is showing this body so edits (texture included)
  // appear immediately instead of needing a back-and-forth navigation.
  if(currentView === 'body' && selectedBody === id) buildBodyView(id);
  else selectBody(id);
}

async function deleteBody(id){
  const b = getBodies().find(x => x.id === id);
  if(!b) return;
  // Warn if this body has moons that will be orphaned
  const moons = getBodies().filter(x => x.isMoon && x.parentId === id);
  let msg = `Remove "${b.name}"? You can restore it from "Show Removed Items".`;
  if(moons.length) msg = `"${b.name}" has ${moons.length} moon(s) which will no longer have a parent. ` + msg;
  if(!confirm(msg)) return;
  recordDesignUndo('Delete body "' + (b.name||'') + '"');
  if(isAddedBody(id)){
    const arr = bodyAdditions[currentSystemId] || [];
    const idx = arr.findIndex(x => x.id === id);
    if(idx >= 0){
      // Keep a tombstone so it appears in "Removed Items" for restore
      if(!bodyDeletions[currentSystemId]) bodyDeletions[currentSystemId] = {};
      bodyDeletions[currentSystemId][id] = { body: arr[idx], t: Date.now(), wasAddition: true };
      arr.splice(idx, 1);
      await saveBodyAdditions();
      await saveBodyDeletions();
    }
  } else {
    if(!bodyDeletions[currentSystemId]) bodyDeletions[currentSystemId] = {};
    bodyDeletions[currentSystemId][id] = { body: b, t: Date.now(), wasAddition: false };
    await saveBodyDeletions();
  }
  econAfterBodyChange();
  showToast('Body removed', 'info');
  goSystemOverview();
}

async function restoreDeletedBody(sysId, id){
  const entry = (bodyDeletions[sysId] || {})[id];
  if(!entry) return;
  if(entry.wasAddition){
    if(!bodyAdditions[sysId]) bodyAdditions[sysId] = [];
    bodyAdditions[sysId].push(entry.body);
    await saveBodyAdditions();
  }
  delete bodyDeletions[sysId][id];
  await saveBodyDeletions();
  econAfterBodyChange();
  if(currentView === 'system'){ buildOrrery(); }
  closeRemovedItemsPanel();
  showToast('Body restored');
}



// ── Design Studio panel boot ─────────────────────────────────────────────────
// Registered here (not js/65) because makePanelDraggable/Resizable live in
// js/70, which loads after the design module. The capture-phase toggle listener
// persists each <details> section's open state across the panel's frequent
// full-innerHTML re-renders (same idiom as the galaxy detail panel).
makePanelDraggable('design-wrap', 'design-header');
makePanelResizable('design-wrap');
(function(){
  const b = document.getElementById('design-body');
  if(b) b.addEventListener('toggle', ev => {
    const d = ev.target;
    if(d && d.tagName === 'DETAILS' && d.dataset && d.dataset.sec) designSecState[d.dataset.sec] = d.open;
  }, true);
})();

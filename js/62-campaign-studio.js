// ═══════════════════════════════════════════════════════════════════════════
// CAMPAIGN STUDIO — the referee's control room for the whole universe
// ═══════════════════════════════════════════════════════════════════════════
// One modal that makes every setting-specific thing editable as Campaign Pack
// data: which campaign is active (switch / new / duplicate / import / export),
// the terminology map, the meters, the module toggles, the dice/resolution
// profile, the theme, the world-data schema, the navigation layers, and the
// object-type registry. Nothing here is Archon-Gambit-specific — it edits
// whatever pack is active, so the built-in campaign and a referee's own Star
// Wars pack are configured through the exact same controls.
//
// All handlers are runtime-invoked (menu clicks), so this file may load in any
// position after 05-campaign-pack.js; it declares functions only (no top-level
// forward references). Edits mutate _activePack.config in place, persist via
// saveActivePackConfig(), and re-apply to the running UI.

let studioTab = 'campaigns';
const STUDIO_TABS = [
  { id:'campaigns',   label:'Campaigns' },
  { id:'crew',        label:'Crew & Ship' },
  { id:'terminology', label:'Terminology' },
  { id:'meters',      label:'Meters' },
  { id:'modules',     label:'Modules' },
  { id:'dice',        label:'Dice' },
  { id:'calendar',    label:'Calendar' },
  { id:'theme',       label:'Theme' },
  { id:'worlds',      label:'Worlds' },
  { id:'layers',      label:'Layers' },
  { id:'types',       label:'Types' },
];

function openCampaignStudio(tab){
  if(typeof isReferee === 'function' && !isReferee()) return;
  studioTab = tab || 'campaigns';
  const m = document.getElementById('campaign-studio-modal');
  if(!m) return;
  m.style.display = 'flex';
  renderCampaignStudio();
}
function closeCampaignStudio(){ const m = document.getElementById('campaign-studio-modal'); if(m) m.style.display = 'none'; }

// Persist + re-apply after any edit, then re-render the studio.
function studioCommit(){
  if(typeof saveActivePackConfig === 'function') saveActivePackConfig();
  if(typeof applyPackToUI === 'function') applyPackToUI();
  if(typeof refreshOpenMenus === 'function') refreshOpenMenus();
  renderCampaignStudio();
}
function studioCfg(){ return (typeof activePackConfig === 'function') ? activePackConfig() : {}; }
function studioEsc(s){ return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Shared small UI atoms (inline-styled, no new CSS needed) ────────────────
const S_LBL = 'font-size:9px;font-family:monospace;color:var(--tx1);letter-spacing:1px;text-transform:uppercase;margin:12px 0 5px';
const S_IN  = 'width:100%;box-sizing:border-box;background:var(--bg0);color:var(--tx0);border:.5px solid var(--bd0);border-radius:5px;padding:6px 8px;font-size:12px;font-family:monospace';
const S_BTN = 'font-size:11px;font-family:monospace;padding:6px 12px;border-radius:5px;cursor:pointer;border:.5px solid var(--bd0);background:transparent;color:var(--tx0)';
const S_BTNP= 'font-size:11px;font-family:monospace;padding:6px 12px;border-radius:5px;cursor:pointer;border:none;background:var(--accentGold);color:#1a1a1a;font-weight:700';
const S_MINI= 'font-size:10px;font-family:monospace;padding:3px 7px;border-radius:4px;cursor:pointer;border:.5px solid var(--bd0);background:transparent;color:var(--tx1)';

function renderCampaignStudio(){
  const tabsEl = document.getElementById('campaign-studio-tabs');
  const bodyEl = document.getElementById('campaign-studio-body');
  if(!tabsEl || !bodyEl) return;
  tabsEl.innerHTML = STUDIO_TABS.map(t =>
    `<button onclick="studioGo('${t.id}')" style="font-size:10px;font-family:monospace;padding:4px 9px;border-radius:5px;cursor:pointer;border:.5px solid var(--bd0);background:${t.id===studioTab?'var(--accentGoldBg)':'transparent'};color:${t.id===studioTab?'var(--accentGold)':'var(--tx1)'}">${t.label}</button>`
  ).join('');
  const R = {
    campaigns: studioRenderCampaigns, crew: studioRenderCrew, terminology: studioRenderTerminology, meters: studioRenderMeters,
    modules: studioRenderModules, dice: studioRenderDice, calendar: studioRenderCalendar, theme: studioRenderTheme,
    worlds: studioRenderWorlds, layers: studioRenderLayers, types: studioRenderTypes,
  };
  bodyEl.innerHTML = (R[studioTab] || studioRenderCampaigns)();
}
function studioGo(tab){ studioTab = tab; renderCampaignStudio(); }

// ── Tab: Campaigns (switch / new / duplicate / import / export / reset) ─────
function studioRenderCampaigns(){
  const list = (typeof listCampaigns === 'function') ? listCampaigns() : [];
  const active = (typeof activeCampaignId !== 'undefined') ? activeCampaignId : 'archon-gambit';
  const rows = list.map(c => `
    <div style="display:flex;align-items:center;gap:8px;padding:7px 9px;border:.5px solid var(--bd0);border-radius:6px;margin-bottom:6px;background:${c.id===active?'var(--accentGoldBg)':'transparent'}">
      <span style="flex:1;font-size:12px;color:${c.id===active?'var(--accentGold)':'var(--tx0)'}">${studioEsc(c.title)}${c.builtin?' <span style="opacity:.5">· built-in</span>':''}${c.id===active?' <span style="opacity:.7">· active</span>':''}</span>
      ${c.id!==active?`<button style="${S_MINI}" onclick="studioSwitchCampaign('${c.id}')">Switch</button>`:''}
      ${!c.builtin?`<button style="${S_MINI};color:#d45050;border-color:#d45050" onclick="studioDeleteCampaign('${c.id}')">Delete</button>`:''}
    </div>`).join('');
  return `
    <div style="font-size:11px;color:var(--tx1);line-height:1.5;margin-bottom:8px">Each campaign is a self-contained universe. Switching reloads the app into that campaign; its data never touches another's.</div>
    <div style="${S_LBL}">Campaigns</div>
    ${rows}
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
      <button style="${S_BTNP}" onclick="studioNewCampaign()">＋ New campaign</button>
      <button style="${S_BTN}" onclick="studioDuplicateCampaign()">⧉ Duplicate active</button>
      <button style="${S_BTN}" onclick="studioImportPack()">⬆ Import pack…</button>
      <button style="${S_BTN}" onclick="studioExportPack()">⬇ Export pack</button>
    </div>
    <div style="${S_LBL}">Reset</div>
    <button style="${S_BTN};color:#d45050;border-color:#d45050" onclick="studioResetConfig()">⟲ Reset this campaign's settings to defaults</button>
    <div style="font-size:10px;color:var(--tx1);margin-top:5px">Clears terminology / meters / theme / module overrides for the active campaign. Content (systems, worlds, notes) is untouched.</div>`;
}
function studioSwitchCampaign(id){
  if(!confirm('Switch to this campaign? The app will reload.')) return;
  if(typeof switchCampaign === 'function' && switchCampaign(id)) location.reload();
}
function studioNewCampaign(){
  const name = (prompt('Name for the new campaign:', 'New Campaign') || '').trim();
  if(!name) return;
  if(typeof createCampaign !== 'function') return;
  const id = createCampaign(name);
  if(confirm('Campaign "'+name+'" created. Switch to it now? (reloads)')){ switchCampaign(id); location.reload(); }
  else renderCampaignStudio();
}
function studioDuplicateCampaign(){
  const name = (prompt('Name for the duplicate:', ((_activePack&&_activePack.title)||'Campaign')+' copy') || '').trim();
  if(!name) return;
  const id = duplicateCampaign(activeCampaignId, name);
  if(id && confirm('Duplicated. Switch to "'+name+'" now? (reloads)')){ switchCampaign(id); location.reload(); }
  else renderCampaignStudio();
}
function studioDeleteCampaign(id){
  if(!confirm('Delete this campaign and its settings? Its shared content rows remain in the store but become orphaned. This cannot be undone.')) return;
  if(typeof deleteCampaign === 'function' && deleteCampaign(id)) renderCampaignStudio();
}
function studioExportPack(){
  if(typeof exportPackObject !== 'function') return;
  const blob = exportPackObject();
  const json = JSON.stringify(blob, null, 2);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], {type:'application/json'}));
  a.download = (blob.id||'campaign') + '-pack.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>{ try{ URL.revokeObjectURL(a.href); }catch(e){} }, 4000);
  if(typeof showToast==='function') showToast('Exported campaign pack');
}
function studioImportPack(){
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files && input.files[0]; if(!file) return;
    let obj; try { obj = JSON.parse(await file.text()); } catch(e){ if(typeof showToast==='function') showToast('Not valid JSON','error'); return; }
    const res = validateAndMigratePack(obj);
    if(!res.ok){ if(typeof showToast==='function') showToast('Import failed — '+res.error,'error'); return; }
    const id = installImportedPack(res.pack);
    const note = res.migrated ? ' (migrated from an older format)' : '';
    if(confirm('Imported "'+res.pack.title+'"'+note+'. Switch to it now? (reloads)')){ switchCampaign(id); location.reload(); }
    else renderCampaignStudio();
  };
  input.click();
}
function studioResetConfig(){
  if(!confirm("Reset this campaign's settings (terminology, meters, theme, modules, dice) to defaults?")) return;
  if(typeof resetActivePackConfig === 'function') resetActivePackConfig();
  if(typeof refreshOpenMenus === 'function') refreshOpenMenus();
  renderCampaignStudio();
}

// ── Tab: Calendar ────────────────────────────────────────────────────────────
// How dates READ in this universe. The {day 1–365, year} spine is bookkeeping
// (jump weeks, recovery dates, ledger stamps) and never changes; the format
// string, header chip, era word and week names are presentation.
function studioRenderCalendar(){
  const cfg = studioCfg();
  const cal = cfg.calendar || { format:'{ddd}-{yyyy}', chip:'IMP', era:'Imperial', weekdays:null };
  const preview = (typeof formatImperial === 'function' && typeof imperialNow === 'function')
    ? formatImperial(imperialNow()) : '';
  const wk = Array.isArray(cal.weekdays) ? cal.weekdays.join(', ') : '';
  const row = (label, html) => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="width:110px;font-size:10px;font-family:monospace;color:var(--tx1)">${label}</span>${html}
    </div>`;
  return `
    <div style="font-size:11px;color:var(--tx1);line-height:1.5;margin-bottom:8px">How dates read in this universe. Tokens: <b>{ddd}</b> day-of-year (001–365) · <b>{dd}</b> · <b>{d}</b> · <b>{yyyy}</b> year · <b>{yy}</b>. e.g. Traveller <b>{ddd}-{yyyy}</b> · 40k-style <b>{ddd}.{yy}.M41</b> · plain <b>Day {d}, {yyyy}</b>. The day/year spine itself never changes — only how it reads.</div>
    ${row('format', `<input style="${S_IN}" value="${studioEsc(cal.format||'')}" onchange="studioCalField('format', this.value)">`)}
    ${row('header chip', `<input style="${S_IN}" value="${studioEsc(cal.chip||'')}" placeholder="e.g. IMP, UNSC, M41" onchange="studioCalField('chip', this.value)">`)}
    ${row('era word', `<input style="${S_IN}" value="${studioEsc(cal.era||'')}" placeholder="after the year in long dates — e.g. Imperial (blank = none)" onchange="studioCalField('era', this.value)">`)}
    ${row('week names', `<input style="${S_IN}" value="${studioEsc(wk)}" placeholder="7 comma-separated names (blank = Imperial week)" onchange="studioCalField('weekdays', this.value)">`)}
    ${preview ? `<div style="font-size:11px;color:var(--tx1);margin-top:10px">Today reads: <b style="color:var(--accentGold)">${studioEsc(preview)}</b></div>` : ''}`;
}
function studioCalField(key, val){
  const c = studioCfg();
  if(!c.calendar || typeof c.calendar !== 'object') c.calendar = { format:'{ddd}-{yyyy}', chip:'IMP', era:'Imperial', weekdays:null };
  if(key === 'weekdays'){
    const names = String(val || '').split(',').map(s => s.trim()).filter(Boolean);
    c.calendar.weekdays = names.length === 7 ? names : null;   // anything but exactly 7 names → Imperial week
  } else {
    c.calendar[key] = String(val || '');
  }
  if(key === 'format' && !c.calendar.format) c.calendar.format = '{ddd}-{yyyy}';   // never let dates render blank
  studioCommit();
  if(typeof renderImperialDate === 'function') renderImperialDate();   // the header chip updates live
  if(typeof renderCalendarPanel === 'function' && typeof calPanelOpen !== 'undefined' && calPanelOpen) renderCalendarPanel();
}

// ── Tab: Crew & Ship ─────────────────────────────────────────────────────────
// The party roster (identity picker, sheets, purses, whisper/visibleTo
// audiences), which member is the pilot (fuel readout foregrounded) and who
// counts as nav crew (jump distances, closed-lane locks), plus the default
// ship identity a fresh campaign's shipState boots with. Honour-system like
// all identity gating; renaming a member does not rewrite past audiences.
function studioRenderCrew(){
  const cfg = studioCfg();
  const crew = cfg.crew || { roster:[], pilot:'', nav:[] };
  const ship = cfg.ship || { name:'', startLocationId:'' };
  const roster = crew.roster || [];
  const nav = crew.nav || [];
  const rows = roster.map((n, i) => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <input style="${S_IN};flex:1" value="${studioEsc(n)}" onchange="studioCrewRename(${i}, this.value)">
      <label style="font-size:10px;color:var(--tx1);white-space:nowrap" title="Pilot — the fuel readout is foregrounded for them"><input type="radio" name="studio-pilot"${crew.pilot===n?' checked':''} onchange="studioCrewPilot('${studioEsc(n).replace(/'/g,"\\'")}')"> pilot</label>
      <label style="font-size:10px;color:var(--tx1);white-space:nowrap" title="Nav crew — sees jump distances and closed-lane locks"><input type="checkbox"${nav.includes(n)?' checked':''} onchange="studioCrewNav('${studioEsc(n).replace(/'/g,"\\'")}', this.checked)"> nav</label>
      <button style="${S_MINI}" onclick="studioCrewRemove(${i})" title="Remove from the roster">✕</button>
    </div>`).join('');
  return `
    <div style="font-size:11px;color:var(--tx1);line-height:1.5;margin-bottom:8px">The party roster — drives the identity picker, character sheets, purses and whisper audiences. Mark the <b>pilot</b> and the <b>nav</b> crew for the ship readout gating.</div>
    ${rows || '<div style="font-size:11px;color:var(--tx1);margin-bottom:8px">No crew yet — add your players below.</div>'}
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <input style="${S_IN};flex:1" id="studio-crew-new" placeholder="Character name…" onkeydown="if(event.key==='Enter')studioCrewAdd()">
      <button style="${S_BTNP}" onclick="studioCrewAdd()">＋ Add</button>
    </div>
    <div style="${S_LBL}">Ship</div>
    <div style="font-size:11px;color:var(--tx1);line-height:1.5;margin-bottom:8px">Defaults for this campaign's first boot — rename the live ship any time on the ${typeof TERM==='function'?studioEsc(TERM('ship')):'Ship'} sheet.</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="width:110px;font-size:10px;font-family:monospace;color:var(--tx1)">name</span>
      <input style="${S_IN}" value="${studioEsc(ship.name||'')}" placeholder="e.g. Pillar of Autumn" onchange="studioShipField('name', this.value)">
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="width:110px;font-size:10px;font-family:monospace;color:var(--tx1)">start system id</span>
      <input style="${S_IN}" value="${studioEsc(ship.startLocationId||'')}" placeholder="a charted system's id (optional)" onchange="studioShipField('startLocationId', this.value)">
    </div>`;
}
function studioCrew(){ const c = studioCfg(); if(!c.crew || typeof c.crew !== 'object') c.crew = { roster:[], pilot:'', nav:[] }; c.crew.roster = c.crew.roster || []; c.crew.nav = c.crew.nav || []; return c.crew; }
function studioCrewAdd(){
  const el = document.getElementById('studio-crew-new');
  const name = el ? el.value.trim() : '';
  if(!name) return;
  const crew = studioCrew();
  if(!crew.roster.includes(name)) crew.roster.push(name);
  studioCommit();
}
function studioCrewRename(i, val){
  const crew = studioCrew();
  const old = crew.roster[i];
  const name = String(val || '').trim();
  if(old == null || !name) { renderCampaignStudio(); return; }
  crew.roster[i] = name;
  if(crew.pilot === old) crew.pilot = name;
  crew.nav = crew.nav.map(n => n === old ? name : n);
  studioCommit();
}
function studioCrewRemove(i){
  const crew = studioCrew();
  const old = crew.roster[i]; if(old == null) return;
  crew.roster.splice(i, 1);
  if(crew.pilot === old) crew.pilot = '';
  crew.nav = crew.nav.filter(n => n !== old);
  studioCommit();
}
function studioCrewPilot(name){ studioCrew().pilot = name; studioCommit(); }
function studioCrewNav(name, on){
  const crew = studioCrew();
  crew.nav = crew.nav.filter(n => n !== name);
  if(on) crew.nav.push(name);
  studioCommit();
}
function studioShipField(key, val){
  const c = studioCfg(); if(!c.ship || typeof c.ship !== 'object') c.ship = { name:'', startLocationId:'' };
  c.ship[key] = String(val || '').trim();
  studioCommit();
}

// ── Tab: Terminology ────────────────────────────────────────────────────────
function studioRenderTerminology(){
  const term = studioCfg().terminology || {};
  const keys = Object.keys((typeof PACK_DEFAULTS!=='undefined'?PACK_DEFAULTS.terminology:term));
  const rows = keys.map(k => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="width:110px;font-size:10px;font-family:monospace;color:var(--tx1)">${k}</span>
      <input style="${S_IN}" value="${studioEsc(term[k]!=null?term[k]:'')}" onchange="studioSetTerm('${k}', this.value)">
    </div>`).join('');
  return `<div style="font-size:11px;color:var(--tx1);line-height:1.5;margin-bottom:8px">Rename every user-facing noun. e.g. <b>referee</b>→"GM", <b>jumpLane</b>→"hyperlane", <b>date</b>→"galactic standard".</div>${rows}`;
}
function studioSetTerm(key, val){
  const c = studioCfg(); if(!c.terminology) c.terminology = {};
  c.terminology[key] = val;
  studioCommit();
}

// ── Tab: Modules ────────────────────────────────────────────────────────────
function studioRenderModules(){
  const mods = studioCfg().modules || {};
  const keys = Object.keys((typeof PACK_DEFAULTS!=='undefined'?PACK_DEFAULTS.modules:mods));
  const rows = keys.map(k => {
    const on = mods[k] !== false;
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 2px;border-bottom:.5px solid var(--bd1)">
      <span style="font-size:12px;color:var(--tx0);text-transform:capitalize">${k}</span>
      <button style="${S_MINI};color:${on?'var(--accentGold)':'var(--tx1)'};border-color:${on?'var(--accentGold)':'var(--bd0)'}" onclick="studioToggleModule('${k}')">${on?'ON':'off'}</button>
    </div>`;
  }).join('');
  return `<div style="font-size:11px;color:var(--tx1);line-height:1.5;margin-bottom:8px">Turn whole subsystems on or off for this campaign. Off hides the feature entirely.</div>${rows}`;
}
function studioToggleModule(key){
  const c = studioCfg(); if(!c.modules) c.modules = {};
  c.modules[key] = (c.modules[key] === false);   // flip; default-true means first click turns off
  studioCommit();
}

// ── Tab: Dice / resolution ──────────────────────────────────────────────────
function studioRenderDice(){
  const r = studioCfg().resolution || {};
  return `
    <div style="font-size:11px;color:var(--tx1);line-height:1.5;margin-bottom:8px">The dice the app rolls through (initiative, world generation, checks) and the characteristic-modifier ladder.</div>
    <div style="${S_LBL}">Dice expression</div>
    <input style="${S_IN}" value="${studioEsc(r.dice||'2d6')}" onchange="studioSetDice('dice', this.value)" placeholder="e.g. 2d6, d20, 3d6">
    <div style="${S_LBL}">Modifier ladder</div>
    <select style="${S_IN}" onchange="studioSetDice('dmLadder', this.value)">
      <option value="traveller"${r.dmLadder==='traveller'?' selected':''}>Traveller (−3…+3)</option>
      <option value="linear"${r.dmLadder==='linear'?' selected':''}>Linear / d20 ((score−10)/2)</option>
      <option value="none"${r.dmLadder==='none'?' selected':''}>None (flat)</option>
    </select>
    <div style="${S_LBL}">Default target number</div>
    <input style="${S_IN}" type="number" value="${r.target!=null?r.target:8}" onchange="studioSetDice('target', this.value)">`;
}
function studioSetDice(field, val){
  const c = studioCfg(); if(!c.resolution) c.resolution = {};
  c.resolution[field] = (field==='target') ? (parseInt(val)||0) : val;
  if(field==='dice') c.resolution.profile = val;
  studioCommit();
}

// ── Tab: Theme ──────────────────────────────────────────────────────────────
const STUDIO_THEME_TOKENS = [
  { k:'--bg0', label:'Background' }, { k:'--bg1', label:'Panel' },
  { k:'--tx0', label:'Text' }, { k:'--tx1', label:'Muted text' },
  { k:'--accentGold', label:'Accent' }, { k:'--bd0', label:'Border' },
];
function studioRenderTheme(){
  const tokens = (studioCfg().theme && studioCfg().theme.tokens) || {};
  const rows = STUDIO_THEME_TOKENS.map(t => {
    const cur = tokens[t.k] || '';
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:7px">
      <span style="width:100px;font-size:11px;color:var(--tx0)">${t.label}</span>
      <input type="color" value="${/^#([0-9a-f]{6})$/i.test(cur)?cur:'#000000'}" onchange="studioSetTheme('${t.k}', this.value)" style="width:38px;height:28px;border:none;background:none;cursor:pointer">
      <input style="${S_IN};flex:1" value="${studioEsc(cur)}" onchange="studioSetTheme('${t.k}', this.value)" placeholder="(stylesheet default)">
    </div>`;
  }).join('');
  return `<div style="font-size:11px;color:var(--tx1);line-height:1.5;margin-bottom:8px">Override the palette. Empty = the stylesheet default. Applies live to :root design tokens.</div>${rows}
    <div style="${S_LBL}">Font family</div>
    <input style="${S_IN}" value="${studioEsc(tokens['--font']||'')}" onchange="studioSetTheme('--font', this.value)" placeholder="e.g. Georgia, serif">`;
}
function studioSetTheme(token, val){
  const c = studioCfg(); if(!c.theme) c.theme = {}; if(!c.theme.tokens) c.theme.tokens = {};
  if(val==null || val==='') delete c.theme.tokens[token]; else c.theme.tokens[token] = val;
  studioCommit();
}

// ── Tab: Worlds (world-data schema + generator provider) ────────────────────
function studioRenderWorlds(){
  const ws = studioCfg().worldSchema || {};
  const fields = ws.fields || [];
  const fieldRows = fields.map((f,i) => `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
      <input style="${S_IN};width:90px" value="${studioEsc(f.key)}" onchange="studioSchemaField(${i},'key',this.value)">
      <input style="${S_IN};flex:1" value="${studioEsc(f.label)}" onchange="studioSchemaField(${i},'label',this.value)">
      <button style="${S_MINI};color:#d45050;border-color:#d45050" onclick="studioRemoveSchemaField(${i})">✕</button>
    </div>`).join('');
  return `
    <div style="font-size:11px;color:var(--tx1);line-height:1.5;margin-bottom:8px">How a world is described, and which generator (if any) rolls one up.</div>
    <div style="${S_LBL}">Generator</div>
    <select style="${S_IN}" onchange="studioSetProvider(this.value)">
      <option value="traveller-uwp"${ws.provider==='traveller-uwp'?' selected':''}>Traveller UWP (2D6 world builder)</option>
      <option value="none"${ws.provider==='none'?' selected':''}>None (fields filled by hand)</option>
    </select>
    <div style="${S_LBL}">World fields</div>
    ${fieldRows}
    <button style="${S_MINI}" onclick="studioAddSchemaField()">+ Add field</button>`;
}
function studioSetProvider(val){ const c = studioCfg(); if(!c.worldSchema) c.worldSchema = {}; c.worldSchema.provider = val; studioCommit(); }
function studioSchemaField(i, field, val){ const c = studioCfg(); c.worldSchema.fields[i][field] = val; studioCommit(); }
function studioAddSchemaField(){ const c = studioCfg(); if(!c.worldSchema.fields) c.worldSchema.fields=[]; c.worldSchema.fields.push({key:'field',label:'Field',type:'text'}); studioCommit(); }
function studioRemoveSchemaField(i){ const c = studioCfg(); c.worldSchema.fields.splice(i,1); studioCommit(); }

// ── Tab: Layers (navigation taxonomy) ───────────────────────────────────────
function studioRenderLayers(){
  const tax = studioCfg().taxonomy || [];
  const rows = tax.map((t,i) => `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <span style="width:20px;text-align:center">${studioEsc(t.icon||'')}</span>
      <input style="${S_IN};width:44px" value="${studioEsc(t.icon||'')}" onchange="studioLayerField(${i},'icon',this.value)" title="Icon">
      <input style="${S_IN};flex:1" value="${studioEsc(t.label||'')}" onchange="studioLayerField(${i},'label',this.value)" title="Label">
      <input style="${S_IN};width:80px" value="${studioEsc(t.short||'')}" onchange="studioLayerField(${i},'short',this.value)" title="Short">
    </div>`).join('');
  return `<div style="font-size:11px;color:var(--tx1);line-height:1.5;margin-bottom:8px">The navigation layers, outermost → innermost. Rename them and change their icons; e.g. "System"→"Sector", "Station"→"City".</div>${rows}
    <div style="font-size:10px;color:var(--tx1);margin-top:6px">Layer count/order and custom renderers are pack-level; labels & icons are live-editable here.</div>`;
}
function studioLayerField(i, field, val){ const c = studioCfg(); c.taxonomy[i][field] = val; studioCommit(); }

// ── Tab: Types (object-type registry) ───────────────────────────────────────
const STUDIO_DISCS = ['star','ocean','ice','rock','moon','gasgiant','belt'];
function studioRenderTypes(){
  const types = studioCfg().objectTypes || [];
  const rows = types.map((t,i) => `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <input style="${S_IN};width:100px" value="${studioEsc(t.id)}" onchange="studioTypeField(${i},'id',this.value)" title="id">
      <input style="${S_IN};flex:1" value="${studioEsc(t.label)}" onchange="studioTypeField(${i},'label',this.value)" title="label">
      <select style="${S_IN};width:90px" onchange="studioTypeField(${i},'disc',this.value)">
        ${STUDIO_DISCS.map(d=>`<option value="${d}"${t.disc===d?' selected':''}>${d}</option>`).join('')}
      </select>
      <button style="${S_MINI};color:#d45050;border-color:#d45050" onclick="studioRemoveType(${i})">✕</button>
    </div>`).join('');
  return `<div style="font-size:11px;color:var(--tx1);line-height:1.5;margin-bottom:8px">The kinds of object the map can hold. Each maps to a disc renderer. Referee-defined types appear in the body creator.</div>${rows}
    <button style="${S_MINI}" onclick="studioAddType()">+ Add type</button>`;
}
function studioTypeField(i, field, val){ const c = studioCfg(); c.objectTypes[i][field] = val; studioCommit(); }
function studioAddType(){ const c = studioCfg(); if(!c.objectTypes) c.objectTypes=[]; c.objectTypes.push({id:'type'+c.objectTypes.length,label:'New Type',disc:'rock',behaviours:['landable']}); studioCommit(); }
function studioRemoveType(i){ const c = studioCfg(); c.objectTypes.splice(i,1); studioCommit(); }

// ── Tab: Meters (the generalised morality/tracker editor) ───────────────────
function studioRenderMeters(){
  const meters = studioCfg().meters || [];
  if(!meters.length){
    return `<div style="font-size:11px;color:var(--tx1);line-height:1.5;margin-bottom:10px">No meters. A meter tracks axes of behaviour (e.g. morality) and classifies a running total into bands.</div>
      <button style="${S_BTNP}" onclick="studioAddMeter()">＋ Add a meter</button>`;
  }
  const blocks = meters.map((m, mi) => {
    const axes = (m.axes||[]).map((a,ai)=>`
      <div style="display:flex;gap:5px;margin-bottom:4px">
        <input style="${S_IN};width:70px" value="${studioEsc(a.key)}" onchange="studioAxisField(${mi},${ai},'key',this.value)" title="key">
        <input style="${S_IN};flex:1" value="${studioEsc(a.label)}" onchange="studioAxisField(${mi},${ai},'label',this.value)" title="label">
        <button style="${S_MINI};color:#d45050;border-color:#d45050" onclick="studioRemoveAxis(${mi},${ai})">✕</button>
      </div>`).join('');
    const bands = (m.bands||[]).map((b,bi)=>`
      <div style="display:flex;gap:5px;margin-bottom:4px;align-items:center">
        <input style="${S_IN};width:48px" value="${b.min==null?'':b.min}" onchange="studioBandField(${mi},${bi},'min',this.value)" title="min" placeholder="−∞">
        <input style="${S_IN};width:48px" value="${b.max==null?'':b.max}" onchange="studioBandField(${mi},${bi},'max',this.value)" title="max" placeholder="+∞">
        <input style="${S_IN};flex:1" value="${studioEsc(b.label)}" onchange="studioBandField(${mi},${bi},'label',this.value)" title="label">
        <button style="${S_MINI};color:#d45050;border-color:#d45050" onclick="studioRemoveBand(${mi},${bi})">✕</button>
      </div>`).join('');
    const col = m.colors || {pos:'#4caf82',neg:'#d45050'};
    return `
      <div style="border:.5px solid var(--bd0);border-radius:8px;padding:10px;margin-bottom:12px">
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
          <input style="${S_IN};flex:1;font-weight:700" value="${studioEsc(m.label)}" onchange="studioMeterField(${mi},'label',this.value)">
          <button style="${S_MINI};color:#d45050;border-color:#d45050" onclick="studioRemoveMeter(${mi})">Remove</button>
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <label style="font-size:10px;color:var(--tx1)">Visible to
            <select style="${S_IN};width:auto;display:inline-block" onchange="studioMeterField(${mi},'visible',this.value)">
              <option value="referee"${m.visible==='referee'?' selected':''}>referee</option>
              <option value="players"${m.visible==='players'?' selected':''}>players</option>
            </select></label>
          <label style="font-size:10px;color:var(--tx1)">Axis range ±<input type="number" style="${S_IN};width:54px;display:inline-block" value="${m.axisRange||5}" onchange="studioMeterField(${mi},'axisRange',this.value)"></label>
          <label style="font-size:10px;color:var(--tx1)">+<input type="color" value="${col.pos}" onchange="studioMeterColor(${mi},'pos',this.value)" style="width:30px;height:22px;border:none;background:none;vertical-align:middle"></label>
          <label style="font-size:10px;color:var(--tx1)">−<input type="color" value="${col.neg}" onchange="studioMeterColor(${mi},'neg',this.value)" style="width:30px;height:22px;border:none;background:none;vertical-align:middle"></label>
        </div>
        <div style="${S_LBL}">Axes</div>${axes}
        <button style="${S_MINI}" onclick="studioAddAxis(${mi})">+ Axis</button>
        <div style="${S_LBL}">Bands (min / max / label — blank = ±∞)</div>${bands}
        <button style="${S_MINI}" onclick="studioAddBand(${mi})">+ Band</button>
      </div>`;
  }).join('');
  return `<div style="font-size:11px;color:var(--tx1);line-height:1.5;margin-bottom:10px">Meters appear in the ${studioEsc(TERM('referee'))} menu. Rename, re-axis, recolour, add several, or remove entirely.</div>
    ${blocks}
    <button style="${S_BTNP}" onclick="studioAddMeter()">＋ Add meter</button>`;
}
function studioMeters(){ const c = studioCfg(); if(!c.meters) c.meters = []; return c.meters; }
function studioMeterField(mi, field, val){ const m = studioMeters()[mi]; if(!m) return; m[field] = (field==='axisRange') ? (parseInt(val)||5) : val; studioCommit(); }
function studioMeterColor(mi, which, val){ const m = studioMeters()[mi]; if(!m) return; if(!m.colors) m.colors={pos:'#4caf82',neg:'#d45050'}; m.colors[which]=val; studioCommit(); }
function studioAxisField(mi, ai, field, val){ const m = studioMeters()[mi]; if(!m||!m.axes[ai]) return; m.axes[ai][field]=val; studioCommit(); }
function studioAddAxis(mi){ const m = studioMeters()[mi]; if(!m) return; if(!m.axes) m.axes=[]; m.axes.push({key:'axis'+m.axes.length,label:'New Axis'}); studioCommit(); }
function studioRemoveAxis(mi, ai){ const m = studioMeters()[mi]; if(!m) return; m.axes.splice(ai,1); studioCommit(); }
function studioBandField(mi, bi, field, val){ const m = studioMeters()[mi]; if(!m||!m.bands[bi]) return;
  if(field==='min'||field==='max'){ m.bands[bi][field] = (val===''? null : (parseInt(val)||0)); } else m.bands[bi][field]=val;
  studioCommit(); }
function studioAddBand(mi){ const m = studioMeters()[mi]; if(!m) return; if(!m.bands) m.bands=[]; m.bands.push({min:null,max:null,cls:'',label:'New band',desc:''}); studioCommit(); }
function studioRemoveBand(mi, bi){ const m = studioMeters()[mi]; if(!m) return; m.bands.splice(bi,1); studioCommit(); }
function studioAddMeter(){
  const c = studioCfg(); if(!c.meters) c.meters = [];
  const id = 'meter-' + Date.now().toString(36);
  c.meters.push({ id, label:'New Meter', visible:'referee', storageKey:'meter_'+id, axisRange:5,
    colors:{pos:'#4caf82',neg:'#d45050'},
    axes:[{key:'axis0',label:'Axis One'}],
    bands:[{min:1,max:null,cls:'',label:'Positive',desc:''},{min:null,max:0,cls:'',label:'Negative',desc:''}] });
  studioCommit();
}
function studioRemoveMeter(mi){
  const c = studioCfg(); if(!c.meters) return;
  if(!confirm('Remove this meter? Its logged history stays in storage but is no longer shown.')) return;
  c.meters.splice(mi,1);
  studioCommit();
}

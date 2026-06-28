// ═══════════════════════════════════════════════════════════════════════════
// STATION
// ═══════════════════════════════════════════════════════════════════════════
let cur=null, curSub=null, curTab="overview";
const notes={};
const nodeColours={elevator:"#BA7517",docking:"#185FA5",concourse:"#BA7517",security:"#534AB7",medical:"#0F6E56",maintenance:"#A32D2D"};

function selArea(areaId){
  cur=areaId; curSub=null; curTab="overview";
  updateNodes(); renderHeader(); renderTabs(); renderDetail(); renderFooter();
  showDetail();
}

function selSub(subId){
  curSub=subId; curTab="overview";
  renderHeader(); renderTabs(); renderDetail(); renderFooter();
}

function goBack(){
  curSub=null;
  curTab=pmCheck.checked?"notes":"overview";
  renderHeader(); renderTabs(); renderDetail(); renderFooter();
}

function showDetail(){
  if(window.innerWidth<=640){
    document.getElementById("map-panel").style.display="none";
    document.querySelector(".map-back-btn").style.display="flex";
  }
}
function showMap(){
  document.getElementById("map-panel").style.display="";
  document.querySelector(".map-back-btn").style.display="none";
}

function updateNodes(){
  ["elevator","docking","concourse","security","medical","maintenance"].forEach(id=>{
    const el=document.getElementById("r-"+id);
    if(!el) return;
    const on=cur===id;
    el.setAttribute("fill",on?nodeColours[id]+"33":"#0f1117");
    el.setAttribute("stroke-width",on?"2.5":"1.5");
  });
}

function getArea(){
  const a=MAIN[cur];
  if(curSub&&a.subs&&a.subs[curSub]) return a.subs[curSub];
  return a;
}

function renderHeader(){
  const h=document.getElementById("area-hdr");
  if(!cur){h.style.display="none";return;}
  const a=MAIN[cur], sub=curSub&&a.subs&&a.subs[curSub];
  h.style.display="block";
  h.innerHTML=`<span class="atag" style="background:${a.tagBg};color:${a.tagColor}">${a.tag}</span>`
    +`<div class="aname">${sub?a.label+" → "+sub.label:a.label}</div>`;
}

function renderTabs(){
  const tb=document.getElementById("tab-bar");
  if(!cur){tb.style.display="none";return;}
  const pm=pmCheck.checked;
  const refOnly=["npcs","checks","events","refnotes"];
  const allTabs=[["overview","Overview"],["npcs","NPCs"],["checks","Checks"],["events","Events"],["refnotes","Ref Notes"],["notes","My Notes"]];
  const tabs=pm?allTabs.filter(([k])=>!refOnly.includes(k)):allTabs;
  const hasSubs=!curSub&&MAIN[cur].subs&&Object.keys(MAIN[cur].subs).length>0;
  const validTabs = tabs.map(t=>t[0]);
  if(hasSubs) validTabs.push("subareas");
  if(!validTabs.includes(curTab)) curTab="overview";
  tb.style.display="flex";
  let html=tabs.map(([k,l])=>`<button class="tab${curTab===k?" on":""}" onclick="setTab('${k}')">${l}</button>`).join("");
  if(hasSubs) html+=`<button class="tab${curTab==="subareas"?" on":""}" onclick="setTab('subareas')">Sub-areas</button>`;
  tb.innerHTML=html;
}

function setTab(t){curTab=t;renderTabs();renderDetail();}

function renderDetail(){
  const d=document.getElementById("detail");
  if(!cur){
    d.innerHTML='<div class="empty"><div class="empty-icon">🛰</div><div style="font-size:14px;font-weight:600;color:#e8eaf0">Select an area</div><div style="font-size:12px;max-width:180px;text-align:center">Tap any node on the map.</div></div>';
    return;
  }
  const a=getArea(), mainA=MAIN[cur], pm=pmCheck.checked;
  if(pm&&refOnly_tabs.includes(curTab)) curTab="overview";
  const backBtn=curSub?`<button class="back-btn" onclick="goBack()">← Back to ${mainA.label}</button>`:"";

  // ── Reveal gate: only top-level areas are gated, not sub-areas ──
  const isTopLevelArea = !curSub && REVEALABLE_STATION_AREAS.includes(cur);
  const locked = isTopLevelArea && pm && !isRevealed(cur);

  if(locked){
    d.innerHTML = `<div class="empty"><div class="empty-icon">🔒</div>
      <div style="font-size:14px;font-weight:600;color:#e8eaf0">Not yet revealed</div>
      <div style="font-size:12px;max-width:200px;text-align:center;color:var(--tx1)">Your referee hasn't opened up this area yet.</div></div>`;
    return;
  }

  if(curTab==="overview"){
    let html=backBtn;
    // Referee-only reveal toggle (only shown when NOT in player mode, on top-level areas)
    if(!pm && isTopLevelArea){
      html += revealToggleRowHTML(cur);
    }
    const stKey = cur+(curSub?"_"+curSub:"");
    if(a.read){
      designOriginalRegistry[stKey+'-read'] = a.read;
      const readText = resolveContent(stKey+'-read', a.read);
      html+=`<div class="read-blk"><div class="read-lbl">📢 Read Aloud</div><div class="read-body">${designWrap(stKey+'-read', a.read, readText)}</div></div>`;
    }
    if(!pm&&a.rsr) html+=`<div class="rsr-tag">🔴 ${a.rsr}</div>`;
    if(a.desc){
      designOriginalRegistry[stKey+'-desc'] = a.desc;
      const descText = resolveContent(stKey+'-desc', a.desc);
      html+=`<div class="blk"><div class="blk-lbl">Referee Context</div><div class="blk-body">${designWrap(stKey+'-desc', a.desc, descText)}</div></div>`;
    }
    if(a.ship){
      html+=`<div class="blk" style="margin-top:8px"><div class="blk-lbl">THE MERIDIAN'S EDGE — STATBLOCK</div><div style="display:grid;grid-template-columns:1fr;gap:4px;margin-top:4px">
        ${a.ship.lines.map(([k,v])=>`<div style="display:grid;grid-template-columns:120px 1fr;gap:6px;font-size:11px;padding:4px 0;border-bottom:.5px solid var(--bg2)"><span style="color:var(--tx1);font-weight:700">${k}</span><span style="color:var(--tx0)">${v}</span></div>`).join("")}
      </div></div>`;
    }
    // Custom referee boxes (the area already shows its own Read Aloud + Referee
    // Context above, so only the registry's custom box types are appended here).
    html += renderBoxTypesHTML(bt => 'sta-'+stKey+'-box-'+bt.key, null, pm, true);
    d.innerHTML=html;
  } else if(curTab==="npcs"){
    let html=backBtn;
    const npcListKey = stKeyForNpcs();
    const npcBaseKey = "sta-npc-"+cur+(curSub||"");
    const mergedNpcs = mergeListWithAdditions(a.npcs, npcListKey, npcBaseKey);
    const addNpcBtn = designModeOn
      ? `<button class="design-add-btn" style="margin-bottom:10px;width:100%" onclick="openNpcCreator()">+ Add NPC</button>`
      : '';
    if(!mergedNpcs.length){
      d.innerHTML = html + addNpcBtn + `<div style="color:#8b91a8;font-size:12px;font-style:italic;padding:4px">No named NPCs in this area.</div>`;
      return;
    }
    html += addNpcBtn;
    html+=mergedNpcs.map(({item:n, key:nidKey, isAddition})=>{
      const nid=nidKey;
      const rowListKey = nid+'-rows';
      const rowBaseKey = nid+'-row-';
      const mergedRows = mergeListWithAdditions(n.rows, rowListKey, rowBaseKey);
      const rowsHTML = mergedRows.map(({item:r, key:rkey}) => {
        designOriginalRegistry[rkey] = r;
        const rdata = resolveContent(rkey, r);
        const pencil = designModeOn ? `<button class="design-edit-pencil-inline" onclick="openDesignEditNpcRow('${rkey}', ${JSON.stringify(r).replace(/"/g,'&quot;')})" title="Edit this detail">✏</button>` : '';
        const trash = designModeOn ? `<button class="design-edit-pencil-inline danger" onclick="deleteContentItem('${rkey}', ${JSON.stringify(rdata).replace(/"/g,'&quot;')})" title="Remove this detail">🗑</button>` : '';
        return `<div class="sr" style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px"><span><b>${rdata[0]}:</b> ${rdata[1]}</span><span style="display:flex;gap:4px;flex-shrink:0">${pencil}${trash}</span></div>`;
      }).join("");
      const addRowBtn = designModeOn ? `<button class="design-add-btn" style="margin-top:6px" onclick="addNewNpcRow('${rowListKey}')">+ Add Detail</button>` : '';
      const locBadge = !pmCheck.checked ? npcLocationBadgeHTML(n.name) : '';
      const dispoBadge = !pmCheck.checked ? npcDispoBadgeHTML(n.name) : '';
      const locEditor = !pmCheck.checked ? npcLocEditorHTML(n.name) : '';
      const hasLocEditor = npcLocEditorOpen === npcKey(n.name);
      const bodyOpen = hasLocEditor ? ' open' : '';
      const delNpcBtn = (designModeOn && isAddition)
        ? `<button class="design-edit-pencil-inline danger" style="margin-left:6px" onclick="event.stopPropagation();deleteAddedNpc('${npcListKey}','${nidKey}')" title="Delete this NPC">🗑</button>`
        : '';
      return `<div class="npc-card"${hasLocEditor ? ' style="overflow:visible"' : ''}><div class="npc-hdr" onclick="toggleNPC('${nid}',this)">
        <div><div class="npc-name">${n.name}</div><div class="npc-role">${n.role}</div>${locBadge}${dispoBadge}</div>
        <span style="display:flex;align-items:center;gap:2px">${delNpcBtn}<span class="chev" id="${nid}-chev"${hasLocEditor ? ' class="open"' : ''}>▾</span></span></div>
        <div class="npc-body${bodyOpen}" id="${nid}">
          ${locEditor}
          <div class="stat-grid">${Object.entries(n.stats).map(([k,v])=>`<div class="sc"><div class="sv">${v}</div><div class="sk">${k}</div></div>`).join("")}</div>
          <div class="skill-row">${n.skills}</div>
          ${rowsHTML}
          ${addRowBtn}
        </div></div>`;
    }).join("");
    d.innerHTML=html;
  } else if(curTab==="desc"){
    let html=backBtn;
    const pm=pmCheck.checked;
    const rawRead = a.read||"";
    if(!rawRead){d.innerHTML=html+`<div style="color:#8b91a8;font-size:12px;font-style:italic;padding:4px">No description for this area.</div>`;return;}
    // In player mode, strip lines containing PC names or referee cues
    const pcNames=["Rhett","Calder","Cassia","Velen","Curculion","Riley","Riven","Dahl"];
    const refCues=["Referee","referee","RSR","Underdeck","roll","Roll","symbol","Symbol","Note:","⚠"];
    let displayText = rawRead;
    if(pm){
      displayText = rawRead.split("\n").filter(line => {
        if(!line.trim()) return true;
        const hasPC = pcNames.some(n => line.includes(n) && (line.includes(" her ") || line.includes(" his ") || line.includes(" she ") || line.includes(" he ") || line.includes("hits ") || line.includes("smells") || line.includes("feels ")));
        const hasRef = refCues.some(c => line.startsWith(c) || line.includes("⚠"));
        return !hasPC && !hasRef;
      }).join("\n");
    }
    html += `<div class="read-blk"><div class="read-body" style="white-space:pre-wrap">${displayText.replace(/</g,"&lt;")}</div></div>`;
    d.innerHTML=html;
  } else if(curTab==="checks"){
    let html=backBtn;
    const degCls={ds:"deg-s",dp:"deg-p",df:"deg-f"};
    const chkListKey = cur+(curSub?"_"+curSub:"")+'-checks';
    const chkBaseKey = cur+(curSub?"_"+curSub:"")+'-check-';
    const mergedChecks = mergeListWithAdditions(a.checks, chkListKey, chkBaseKey);
    if(!mergedChecks.length){
      html += `<div style="color:#8b91a8;font-size:12px;font-style:italic;padding:4px">No skill checks in this area.</div>`;
    } else {
      html += mergedChecks.map(({item:c, key:ckey}) => {
        designOriginalRegistry[ckey] = c;
        const cdata = resolveContent(ckey, c);
        const pencil = designModeOn ? `<button class="design-edit-pencil-inline" onclick="openDesignEditCheck('${ckey}', ${JSON.stringify(c).replace(/"/g,'&quot;')})" title="Edit this check">✏</button>` : '';
        const trash = designModeOn ? `<button class="design-edit-pencil-inline danger" onclick="deleteContentItem('${ckey}', ${JSON.stringify(cdata).replace(/"/g,'&quot;')})" title="Remove this check">🗑</button>` : '';
        return `<div class="chk"><div class="chk-t" style="display:flex;align-items:center;justify-content:space-between"><span>🎲 ${cdata.skill}</span><span style="display:flex;gap:4px">${pencil}${trash}</span></div>${cdata.degrees.map(dg=>{
          const cls=dg.cls||degCls[dg.c]||"deg-p";
          const lbl=dg.label||dg.l||"";
          const txt=dg.text||dg.t||"";
          return `<div class="deg-row"><span class="${cls}">${lbl}</span><span style="font-size:11px">${txt}</span></div>`;
        }).join("")}</div>`;
      }).join("");
    }
    if(designModeOn){
      html += `<button class="design-add-btn" onclick="addNewCheck('${chkListKey}')">+ Add Skill Check</button>`;
    }
    d.innerHTML=html;
  } else if(curTab==="events"){
    let html=backBtn;
    const evtListKey = cur+(curSub?"_"+curSub:"")+'-events';
    const evtBaseKey = cur+(curSub?"_"+curSub:"")+'-event-';
    const mergedEvents = mergeListWithAdditions(a.events, evtListKey, evtBaseKey);
    if(!mergedEvents.length){
      html += `<div style="color:#8b91a8;font-size:12px;font-style:italic;padding:4px">No events scheduled.</div>`;
    } else {
      html += mergedEvents.map(({item:e, key:ekey}) => {
        designOriginalRegistry[ekey] = e;
        const edata = resolveContent(ekey, e);
        const pencil = designModeOn ? `<button class="design-edit-pencil-inline" onclick="openDesignEditEvent('${ekey}', ${JSON.stringify(e).replace(/"/g,'&quot;')})" title="Edit this event">✏</button>` : '';
        const trash = designModeOn ? `<button class="design-edit-pencil-inline danger" onclick="deleteContentItem('${ekey}', ${JSON.stringify(edata).replace(/"/g,'&quot;')})" title="Remove this event">🗑</button>` : '';
        return `<div class="evt"><div class="evt-t" style="display:flex;align-items:center;justify-content:space-between"><span>${edata.t}</span><span style="display:flex;gap:4px">${pencil}${trash}</span></div>${edata.e}</div>`;
      }).join("");
    }
    if(designModeOn){
      html += `<button class="design-add-btn" onclick="addNewEvent('${evtListKey}')">+ Add Event</button>`;
    }
    d.innerHTML=html;
  } else if(curTab==="refnotes"){
    let html=backBtn;
    const rnKey = (cur+(curSub?"_"+curSub:""))+'-refnotes';
    const origRefnotes = a.refnotes||"No referee notes for this area.";
    designOriginalRegistry[rnKey] = origRefnotes;
    const refnotesText = resolveContent(rnKey, origRefnotes);
    html+=`<div class="blk" style="border-left:3px solid ${mainA.ac}"><div class="blk-lbl">Referee Notes</div><div class="blk-body">${designWrap(rnKey, origRefnotes, refnotesText)}</div></div>`;
    d.innerHTML=html;
  } else if(curTab==="subareas"){
    const subs=MAIN[cur].subs||{}, keys=Object.keys(subs);
    if(!keys.length){d.innerHTML=`<div style="color:#8b91a8;font-size:12px;font-style:italic;padding:4px">No sub-areas defined.</div>`;return;}
    d.innerHTML=`<div class="blk-lbl" style="margin-bottom:8px">Select a Sub-Area</div><div class="sub-grid">${keys.map(k=>`<button class="sub-btn" onclick="selSub('${k}')" ontouchend="event.preventDefault();selSub('${k}')"><div class="sub-btn-name">${subs[k].label}</div><div class="sub-btn-desc">${subs[k].sub||""}</div></button>`).join("")}</div>`;
  } else if(curTab==="notes"){
    const key=cur+(curSub?"_"+curSub:"");
    if(pmCheck.checked){
      renderPlayerNotesTab(d, key);
    } else {
      const saved=notes[key]||"";
      d.innerHTML=backBtn+`<div class="blk-lbl" style="margin-bottom:8px">Session Notes</div><textarea class="note-ta" id="nta" placeholder="Track what happened here, player choices, NPC reactions...">${saved}</textarea><div style="display:flex;align-items:center;gap:10px;margin-top:9px"><button class="save-btn" onclick="saveNote()">Save</button><span class="saved-msg" id="smsg">✓ Saved</span></div>`;
    }
  }
}

// ── Player-facing notes tab: private notes + party notebook ──────────────
let notesSubTab = 'private';

async function renderPlayerNotesTab(container, key){
  if(!myIdentity){
    container.innerHTML = '<div class="init-empty">Pick a character name first.</div>';
    showIdentityModal();
    return;
  }
  container.innerHTML = `<div id="whoami-strip">Playing as <span onclick="changeIdentity()">${myIdentity}</span></div>
    <div class="notes-subtabs">
      <div class="notes-subtab ${notesSubTab==='private'?'on':''}" onclick="setNotesSubTab('${key}','private')">MY NOTES</div>
      <div class="notes-subtab ${notesSubTab==='party'?'on':''}" onclick="setNotesSubTab('${key}','party')">PARTY NOTEBOOK</div>
    </div>
    <div id="player-notes-body">Loading…</div>`;

  if(notesSubTab === 'private'){
    const text = await loadPrivateNote(key);
    const body = document.getElementById('player-notes-body');
    if(body) body.innerHTML = `<textarea class="note-ta" id="priv-nta" placeholder="Your private notes — only you and the referee can see these...">${text}</textarea>
      <div style="display:flex;align-items:center;gap:10px;margin-top:9px"><button class="save-btn" onclick="savePrivNotesTab('${key}')">Save</button><span class="saved-msg" id="priv-smsg">✓ Saved</span></div>`;
  } else {
    const list = await loadPartyNotes(key);
    const body = document.getElementById('player-notes-body');
    if(body){
      body.innerHTML = (list.length ? list.map(n =>
        `<div class="party-note-entry"><div class="party-note-author">${n.author}</div><div class="party-note-text">${n.text}</div></div>`
      ).join('') : '<div class="init-empty">No party notes yet for this area.</div>')
      + `<textarea class="note-ta" id="party-nta" placeholder="Add a note the whole party can see..." style="margin-top:8px;min-height:60px"></textarea>
      <div style="display:flex;align-items:center;gap:10px;margin-top:9px"><button class="save-btn" onclick="addPartyNoteTab('${key}')">Post</button></div>`;
    }
  }
}

function setNotesSubTab(key, tab){
  notesSubTab = tab;
  renderPlayerNotesTab(document.getElementById('detail'), key);
}

async function savePrivNotesTab(key){
  const ta = document.getElementById('priv-nta');
  if(!ta) return;
  await savePrivateNote(key, ta.value);
  const m = document.getElementById('priv-smsg');
  if(m){ m.style.display='inline'; setTimeout(()=>m.style.display='none',1500); }
}

async function addPartyNoteTab(key){
  const ta = document.getElementById('party-nta');
  if(!ta || !ta.value.trim()) return;
  await addPartyNote(key, ta.value);
  ta.value = '';
  renderPlayerNotesTab(document.getElementById('detail'), key);
}


const refOnly_tabs=["npcs","checks","events","refnotes"];

function toggleNPC(id,hdr){
  const el=document.getElementById(id), ch=document.getElementById(id+"-chev");
  const open=el.classList.contains("open");
  el.classList.toggle("open",!open);
  if(ch) ch.classList.toggle("open",!open);
}

function saveNote(){
  const key=cur+(curSub?"_"+curSub:"");
  const ta=document.getElementById("nta");
  if(ta){ notes[key]=ta.value; const m=document.getElementById("smsg"); if(m){m.style.display="inline";setTimeout(()=>m.style.display="none",1500);} showToast('Note saved'); }
}

function renderFooter(){
  const f=document.getElementById("foot"), cr=document.getElementById("conn-row");
  if(!cur||curSub){f.style.display="none";return;}
  const a=MAIN[cur];
  if(!a.conn||a.conn.length===0){f.style.display="none";return;}
  f.style.display="block";
  cr.innerHTML=a.conn.map(id=>{
    const c=nodeColours[id]||"#5b8ef0";
    return `<button class="conn-btn" onclick="selArea('${id}')" style="background:${c}22;color:${c};border-color:${c}">${MAIN[id].label}</button>`;
  }).join("");
}

// ═══════════════════════════════════════════════════════════════════════════
// STATION CLOCK
// ═══════════════════════════════════════════════════════════════════════════
let clockMinutes = 0; // total minutes since 00:00

function clockDisplay(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
}

function renderClock() {
  document.getElementById('clock-display').textContent = clockDisplay(clockMinutes);
  try { localStorage.setItem('aurelia_clock', clockMinutes); } catch(e){}
}

function advanceClock(mins) {
  if(!isReferee()) return;
  const prev = clockMinutes;
  clockMinutes = (clockMinutes + mins) % 1440;
  renderClock();
  checkTimedEvents(prev, clockMinutes);
  checkNpcSchedules(prev, clockMinutes);
  saveClockState();
}

function resetClock() {
  if(!isReferee()) return;
  clockMinutes = 0;
  renderClock();
  resetTimedEvents();
  saveClockState();
}

function openClockEdit(e) {
  if(!isReferee()) return;
  const pop = document.getElementById('clock-edit');
  const inp = document.getElementById('clock-input');
  inp.value = clockDisplay(clockMinutes);
  // Position below the display
  const rect = e.target.getBoundingClientRect();
  pop.style.top = (rect.bottom + 6) + 'px';
  pop.style.left = Math.max(4, rect.left - 60) + 'px';
  pop.classList.toggle('open');
  if(pop.classList.contains('open')) {
    setTimeout(() => inp.focus(), 50);
  }
}

function setClockFromInput() {
  if(!isReferee()) return;
  const val = document.getElementById('clock-input').value; // "HH:MM"
  if(val) {
    const [h, m] = val.split(':').map(Number);
    clockMinutes = (h * 60 + m) % 1440;
    renderClock();
    saveClockState();
  }
  document.getElementById('clock-edit').classList.remove('open');
}

// Close clock popover when clicking outside
document.addEventListener('click', function(e) {
  const pop = document.getElementById('clock-edit');
  if(pop.classList.contains('open') &&
     !pop.contains(e.target) &&
     e.target.id !== 'clock-display') {
    pop.classList.remove('open');
  }
});

// Restore clock from localStorage
try {
  const saved = localStorage.getItem('aurelia_clock');
  if(saved !== null) clockMinutes = parseInt(saved, 10) || 0;
} catch(e){}
renderClock();


// ═══════════════════════════════════════════════════════════════════════════
// RSR FOUND STATE
// ═══════════════════════════════════════════════════════════════════════════
const rsrFound = {1:false,2:false,3:false,4:false};
try {
  const saved = JSON.parse(localStorage.getItem('aurelia_rsr')||'{}');
  Object.keys(saved).forEach(k => rsrFound[k] = saved[k]);
} catch(e){}

function toggleRsrFound(n){
  rsrFound[n] = !rsrFound[n];
  try { localStorage.setItem('aurelia_rsr', JSON.stringify(rsrFound)); } catch(e){}
  renderRsrMarkers();
  if(rsrFound[n]) logEvent(`Players found RSR Symbol ${['①','②','③','④'][n-1]} — marker darkened.`);
}

function renderRsrMarkers(){
  [1,2,3,4].forEach(n => {
    const c = document.getElementById('rsr-c-'+n);
    const g = document.getElementById('rsr-g-'+n);
    if(!c) return;
    c.setAttribute('fill', rsrFound[n] ? '#6B1010' : '#A32D2D');
    if(g) g.setAttribute('title', rsrFound[n] ? 'Found ✓' : 'Tap to mark found');
  });
}

// Call after SVG loads
setTimeout(renderRsrMarkers, 100);

// ═══════════════════════════════════════════════════════════════════════════
// EVENT LOG
// ═══════════════════════════════════════════════════════════════════════════
let eventLog = [];
let eventLogCollapsed = false;
try { eventLog = JSON.parse(localStorage.getItem('aurelia_evlog')||'[]'); } catch(e){}

function logEvent(text, areaLabel){
  const entry = { time: clockDisplay(clockMinutes), area: areaLabel||'', text };
  eventLog.unshift(entry); // newest first
  if(eventLog.length > 100) eventLog.pop();
  try { localStorage.setItem('aurelia_evlog', JSON.stringify(eventLog)); } catch(e){}
  renderEventLog();
}

function renderEventLog(){
  const body = document.getElementById('event-log-body');
  const count = document.getElementById('event-log-count');
  const wrap = document.getElementById('event-log-wrap');
  if(!body) return;
  count.textContent = eventLog.length;
  if(wrap) wrap.classList.toggle('panel-collapsed', eventLogCollapsed);
  if(eventLogCollapsed){ body.classList.add('collapsed'); return; }
  body.classList.remove('collapsed');
  if(!eventLog.length){
    body.innerHTML = '<div style="color:var(--tx1);font-size:11px;font-style:italic;padding:4px">No events logged yet. Events trigger automatically as station time advances.</div>';
    return;
  }
  body.innerHTML = eventLog.map(e =>
    `<div class="evlog-entry">
      <div class="evlog-time">${e.time}${e.area?' · '+e.area:''}</div>
      <div class="evlog-text">${e.text}</div>
    </div>`
  ).join('');
}

function toggleEventLog(){
  if(document.getElementById('event-log-header').dataset.suppressClick === '1') return;
  eventLogCollapsed = !eventLogCollapsed;
  document.getElementById('event-log-toggle').textContent = eventLogCollapsed ? '▲' : '▼';
  renderEventLog();
}

function clearEventLog(){
  eventLog = [];
  try { localStorage.removeItem('aurelia_evlog'); } catch(e){}
  renderEventLog();
}

// Timed events — check which events should have fired at current clock time
// Each event has a minuteThreshold — fires when clock passes it
const TIMED_EVENTS = [];

let lastLoggedMinute = -1;
let firedEvents = new Set();
try {
  const saved = JSON.parse(localStorage.getItem('aurelia_fired')||'[]');
  firedEvents = new Set(saved);
} catch(e){}

function checkTimedEvents(prevMins, newMins){
  // Handle wrap-around (midnight)
  TIMED_EVENTS.forEach((ev, i) => {
    const key = i + '_' + ev.mins;
    if(firedEvents.has(key)) return;
    // Fire if we've passed the threshold this advance
    const crossed = prevMins < ev.mins && newMins >= ev.mins;
    if(crossed){
      logEvent(ev.text, ev.area);
      firedEvents.add(key);
      // Special: re-open elevator at hour 24
      if(ev.mins === 1440) openElevator();
    }
  });
  try { localStorage.setItem('aurelia_fired', JSON.stringify([...firedEvents])); } catch(e){}
}

function resetTimedEvents(){
  firedEvents = new Set();
  try { localStorage.removeItem('aurelia_fired'); } catch(e){}
}

function openElevator(){
  // Update elevator node in station SVG
  const el = document.getElementById('r-elevator');
  if(el) el.setAttribute('stroke','#4CAF50');
  const txt = document.querySelector('#n-elevator text');
  if(txt) { txt.textContent='ELEVATOR ONLINE'; txt.setAttribute('fill','#4CAF50'); }
  // Update MAIN data
  if(MAIN.elevator){
    MAIN.elevator.tag = 'ONLINE';
    MAIN.elevator.tagBg = '#0f2e20';
    MAIN.elevator.tagColor = '#4caf82';
    MAIN.elevator.read = MAIN.elevator.read.replace('Right now you cannot.','The gate is now open.');
  }
  logEvent('Space Elevator is back online. Gate unsealed.', 'Space Elevator');
}

// ═══════════════════════════════════════════════════════════════════════════
// BASE LOCATIONS DATA  (hardcoded, system→body keyed) — Phase 3
// ═══════════════════════════════════════════════════════════════════════════
// Aurelia's seven sites, migrated off the retired bespoke AURELIA_LOCS array
// onto the generic location engine. Layered by effectiveLocations exactly like
// BASE_BODIES_AUROS is by effectiveBodies. IDs are preserved byte-for-byte so
// existing referee text edits (loc-<id>-*) and reveal state still resolve.
//   sx/sy are offsets from disc centre in planet-radius (PR=110) units. The
//   orbital station was converted from its old angle:270/dist:0.72 polar form:
//   sx = cos(270°)·(400·0.72·0.92)/110 = 0 ;  sy = sin(270°)·(300·0.72·0.92)/110 = -1.806
const BASE_LOCATIONS = {
  "auros": {
    "aurelia": [
      {
        "id": "station",
        "name": "Aurelia Orbital Station",
        "surface": false,
        "sx": 0,
        "sy": -1.806,
        "color": "#4A90D9",
        "isStation": true,
        "interiorId": "aurelia-station",
        "elevatorTo": "capitol",
        "tag": "ACTIVE LOCATION",
        "desc": "The station sits at the L2 Lagrange point, permanently in Aurelia's shadow. A mid-sized orbital platform serving commercial docking, transit, and Hegemony administrative functions.\n\nThe crew's current location."
      },
      {
        "id": "capitol",
        "name": "Aurelia Capitol",
        "surface": true,
        "sx": -0.02,
        "sy": -0.44,
        "color": "#D4A843",
        "tag": "HEGEMONY",
        "desc": "The administrative capital of Aurelia. A purpose-built city on the northern continent's temperate coastline — gleaming towers, broad plazas, Hegemony administrative architecture at its most self-assured.\n\nPopulation 4 million. Heavily policed. Beautiful in the way that only wealth can afford."
      },
      {
        "id": "cradle",
        "name": "The Cradle",
        "surface": true,
        "sx": 0.3,
        "sy": 0.06,
        "color": "#2AABB8",
        "tag": "DEEP WATER",
        "desc": "Aurelia's most extraordinary city — built on the ocean floor in the equatorial deep trench, pressurised and lit from within. Visible from orbit as a faint blue-white glow through 600 metres of water.\n\nPopulation 12 million. The Cradle operates under a different legal framework from the surface — a legacy of the engineering charter that built it. The Hegemony's reach here is real but thinner."
      },
      {
        "id": "hegemony-base",
        "name": "Hegemony Garrison",
        "surface": true,
        "sx": 0.32,
        "sy": 0.58,
        "color": "#534AB7",
        "tag": "MILITARY",
        "desc": "A Hegemony Navy installation on the northern continent's high plateau. Mostly administrative — a handful of frigates on rotation, a rapid-response ground force, the regional communications hub.\n\nNot a combat posting. The Hegemony has not needed combat on Aurelia. The garrison commander finds this increasingly difficult to explain to new arrivals who expected action."
      },
      {
        "id": "spire-range",
        "name": "Spire Range",
        "surface": true,
        "sx": -0.44,
        "sy": 0.5,
        "color": "#9999AA",
        "tag": "LANDMARK",
        "desc": "The twin mountain peaks that appear in every Hegemony promotional image of Aurelia. Geologically ancient, atmospherically dramatic — the peaks catch the copper-tinted light of Auros at dawn and dusk and turn a shade of red that colonists have named the Auros Kiss.\n\nPopular tourist destination. Four licensed resort complexes at mid-altitude. Above 4,000 metres, only licensed research expeditions."
      },
      {
        "id": "omnisynth",
        "name": "OmniSynth Arcology",
        "surface": true,
        "sx": -0.66,
        "sy": 0.12,
        "color": "#C87941",
        "tag": "CORPORATE",
        "desc": "OmniSynth's primary Aurelian facility — a self-contained arcology on the southern coast housing 80,000 employees and their dependents. Research, manufacturing, and administrative functions. The arcology has its own power grid, water supply, and internal security force.\n\nFrom outside, it looks like a very clean small city. From inside, it looks like a company town."
      },
      {
        "id": "underdeck",
        "name": "Underdeck Entrance",
        "surface": true,
        "sx": -0.2,
        "sy": -0.3,
        "color": "#A32D2D",
        "tag": "UNDERDECK",
        "desc": "The surface access point for Aurelia's Cleaner settlements — a pressurised transition zone between the atmosphere above and the filtered tunnels below. Multiple entrances exist; this is the one that appears on Hegemony maps, marked as Infrastructure Access — Authorised Personnel Only.\n\nThe ones that don't appear on any map are more interesting."
      }
    ]
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// AURELIA NAVIGATION — now a thin wrapper over the generic body view
// ═══════════════════════════════════════════════════════════════════════════
// Aurelia is no longer a bespoke intermediary view: it is just the most richly
// populated instance of the generic body-and-location engine. goAurelia is kept
// as a named entry point because breadcrumbs (enterStation) and navBack call it.
function goAurelia(){ goBodyView('aurelia'); }


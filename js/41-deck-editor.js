// ═══════════════════════════════════════════════════════════════════════════
// DECK PLAN EDITOR — Roll20-style grid map for authored stations
// ═══════════════════════════════════════════════════════════════════════════
// Load-order: needs js/40-station.js (stationAdditions, currentStationId,
// stationDef, stationAreas, saveAuthoredStations, selArea). Runtime-only use
// of isReferee (55), designModeOn/renderDesignPanel (65), showToast (92).
//
// A deck plan lives INSIDE its authored station — stationAdditions[sid].deck —
// so it syncs to players through the existing 'station-additions' poll with no
// new keys. Shape: { w,h (cells), floors:[{x,y,w,h}], walls:[{x1,y1,x2,y2}]
// (grid-vertex coords, diagonals allowed), doors:[{x,y,o:'h'|'v'}] (edge from
// vertex (x,y) rightward / downward), props:[{t,x,y,r}] (cell + rotation),
// labels:[{t,x,y}] (cell units, fractional), links:[{a,x,y}] (areaId marker) }.
// A link marker claims its ROOM: every floor cell reachable from it without
// crossing an axis-aligned wall becomes the tap target on the station view,
// so players tap anywhere in the room — not just the marker — to open the area.
//
// The referee edits in a full-screen overlay (#dke-wrap, built lazily);
// players get the read-only render via deckStationSVG() from renderStationMap.

const DKE_CELL = 32;
function dkeEsc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// ── Prop stamp catalogue (generic engine set — glyphs centred on origin) ─────
const DKE_PROPS = {
  console : { n:'Console',  g:'<rect x="-12" y="-8" width="24" height="16" rx="2" fill="#0f1117" stroke="#5b8ef0" stroke-width="1.5"/><rect x="-9" y="-5" width="18" height="7" rx="1" fill="#5b8ef033" stroke="#5b8ef0" stroke-width=".7"/><circle cx="-6" cy="5" r="1.2" fill="#5b8ef0"/><circle cx="0" cy="5" r="1.2" fill="#5b8ef0"/><circle cx="6" cy="5" r="1.2" fill="#5b8ef0"/>' },
  terminal: { n:'Terminal', g:'<rect x="-11" y="-4" width="22" height="8" rx="1.5" fill="#0f1117" stroke="#5b8ef0" stroke-width="1.3"/><path d="M-8,0 h6" stroke="#5b8ef0" stroke-width="1"/><circle cx="7" cy="0" r="1.3" fill="#5b8ef0"/>' },
  crate   : { n:'Crate',    g:'<rect x="-10" y="-10" width="20" height="20" fill="#0f1117" stroke="#d4913a" stroke-width="1.5"/><path d="M-10,-10 L10,10 M10,-10 L-10,10" stroke="#d4913a" stroke-width=".8"/>' },
  table   : { n:'Table',    g:'<circle r="10" fill="#0f1117" stroke="#a3a9bf" stroke-width="1.5"/><circle r="3" fill="none" stroke="#a3a9bf" stroke-width=".7"/>' },
  chair   : { n:'Chair',    g:'<rect x="-6" y="-3" width="12" height="10" rx="2" fill="#0f1117" stroke="#a3a9bf" stroke-width="1.3"/><path d="M-6,-6 h12" stroke="#a3a9bf" stroke-width="2.5" stroke-linecap="round"/>' },
  bunk    : { n:'Bunk',     g:'<rect x="-12" y="-7" width="24" height="14" rx="2" fill="#0f1117" stroke="#4caf82" stroke-width="1.5"/><rect x="-10" y="-5" width="6" height="10" rx="1" fill="#4caf8233" stroke="#4caf82" stroke-width=".7"/>' },
  locker  : { n:'Locker',   g:'<rect x="-7" y="-11" width="14" height="22" rx="1" fill="#0f1117" stroke="#7f93b8" stroke-width="1.5"/><path d="M0,-11 v22" stroke="#7f93b8" stroke-width=".7"/><path d="M-3,-2 v4 M3,-2 v4" stroke="#7f93b8" stroke-width="1.2"/>' },
  airlock : { n:'Airlock',  g:'<circle r="11" fill="#0f1117" stroke="#D4A843" stroke-width="1.5"/><circle r="4" fill="none" stroke="#D4A843" stroke-width="1"/><path d="M-11,0 h22 M0,-11 v22" stroke="#D4A843" stroke-width=".7"/>' },
  plant   : { n:'Plant',    g:'<circle cy="5" r="4" fill="#0f1117" stroke="#4caf82" stroke-width="1.3"/><path d="M0,3 C-6,-2 -7,-8 -2,-9 M0,3 C6,-2 7,-8 2,-9 M0,3 v-10" stroke="#4caf82" stroke-width="1.1" fill="none"/>' },
  stairs  : { n:'Stairs',   g:'<rect x="-11" y="-11" width="22" height="22" fill="#0f1117" stroke="#a3a9bf" stroke-width="1.3"/><path d="M-11,-5.5 h22 M-11,0 h22 M-11,5.5 h22" stroke="#a3a9bf" stroke-width="1"/>' }
};

// ── Deck data helpers ────────────────────────────────────────────────────────
function dkeBlank(){ return { w:24, h:16, floors:[], walls:[], doors:[], props:[], labels:[], links:[] }; }
function dkeNorm(d){
  d.w = Math.max(4, Math.min(64, parseInt(d.w,10) || 24));
  d.h = Math.max(4, Math.min(64, parseInt(d.h,10) || 16));
  ['floors','walls','doors','props','labels','links'].forEach(k => { if(!Array.isArray(d[k])) d[k] = []; });
  return d;
}
function deckHasContent(d){
  return !!(d && ((d.floors||[]).length || (d.walls||[]).length || (d.doors||[]).length
    || (d.props||[]).length || (d.labels||[]).length || (d.links||[]).length));
}
// Current station's deck (editor always mutates through here so undo/redo and
// the poll's stationAdditions replacement can never leave a stale reference).
function dkeD(){
  if(typeof currentStationId === 'undefined' || currentStationId === 'aurelia') return null;
  const s = stationAdditions[currentStationId];
  return (s && s.deck) ? s.deck : null;
}

// ── Room detection (tap-the-room area links) ─────────────────────────────────
// Is the unit grid edge starting at vertex (x,y) — rightward for 'h', downward
// for 'v' — covered by an axis-aligned wall segment? Diagonal walls never block.
function dkeEdgeWalled(deck, x, y, o){
  return (deck.walls||[]).some(w => o === 'v'
    ? (w.x1 === x && w.x2 === x && Math.min(w.y1,w.y2) <= y && Math.max(w.y1,w.y2) >= y+1)
    : (w.y1 === y && w.y2 === y && Math.min(w.x1,w.x2) <= x && Math.max(w.x1,w.x2) >= x+1));
}
function dkeWallBlocks(deck, cx, cy, dx, dy){
  if(dx === 1)  return dkeEdgeWalled(deck, cx+1, cy, 'v');
  if(dx === -1) return dkeEdgeWalled(deck, cx, cy, 'v');
  if(dy === 1)  return dkeEdgeWalled(deck, cx, cy+1, 'h');
  return dkeEdgeWalled(deck, cx, cy, 'h');
}
// Flood-fill from a cell across floor cells, bounded by walls (doors sit ON a
// wall segment, so doorways bound rooms too). Null if the start cell isn't floor.
function dkeRoomCells(deck, sx, sy){
  const floor = new Set();
  (deck.floors||[]).forEach(f => {
    for(let i = 0; i < f.w; i++) for(let j = 0; j < f.h; j++) floor.add((f.x+i)+','+(f.y+j));
  });
  if(!floor.has(sx+','+sy)) return null;
  const seen = new Set([sx+','+sy]), queue = [[sx,sy]], out = [];
  while(queue.length){
    const cell = queue.shift(); out.push({ x: cell[0], y: cell[1] });
    [[1,0],[-1,0],[0,1],[0,-1]].forEach(d => {
      const nx = cell[0]+d[0], ny = cell[1]+d[1], k = nx+','+ny;
      if(seen.has(k) || !floor.has(k) || dkeWallBlocks(deck, cell[0], cell[1], d[0], d[1])) return;
      seen.add(k); queue.push([nx,ny]);
    });
  }
  return out;
}
function dkeRoomFillD(cells){
  const C = DKE_CELL;
  return cells.map(c => `M${c.x*C},${c.y*C}h${C}v${C}h${-C}z`).join('');
}
// Boundary-only path (edges between a room cell and a non-room cell) — used for
// the editor's dashed "this is what the marker claims" outline.
function dkeRoomOutlineD(cells){
  const C = DKE_CELL, set = new Set(cells.map(c => c.x+','+c.y));
  let d = '';
  cells.forEach(c => {
    if(!set.has(c.x+','+(c.y-1))) d += `M${c.x*C},${c.y*C}h${C}`;
    if(!set.has(c.x+','+(c.y+1))) d += `M${c.x*C},${(c.y+1)*C}h${C}`;
    if(!set.has((c.x-1)+','+c.y)) d += `M${c.x*C},${c.y*C}v${C}`;
    if(!set.has((c.x+1)+','+c.y)) d += `M${(c.x+1)*C},${c.y*C}v${C}`;
  });
  return d;
}

// ── Shared SVG renderer (editor canvas + read-only station view) ─────────────
function dkeContentSVG(deck, opt){
  opt = opt || {};
  const C = DKE_CELL, eh = dkeEsc;
  let out = '';
  // Floors first, grid over them (Roll20-style), structure on top.
  (deck.floors||[]).forEach(f => {
    out += `<rect x="${f.x*C}" y="${f.y*C}" width="${f.w*C}" height="${f.h*C}" fill="#1a1f2e"/>`;
  });
  let grid = '';
  for(let i = 0; i <= deck.w; i++) grid += `M${i*C},0 V${deck.h*C} `;
  for(let j = 0; j <= deck.h; j++) grid += `M0,${j*C} H${deck.w*C} `;
  out += `<path d="${grid}" stroke="#1e2333" stroke-width="${opt.editor ? .8 : .6}" fill="none"/>`;
  out += `<rect x="0" y="0" width="${deck.w*C}" height="${deck.h*C}" fill="none" stroke="#2e3347" stroke-width="1.4"/>`;
  (deck.walls||[]).forEach(w => {
    out += `<line x1="${w.x1*C}" y1="${w.y1*C}" x2="${w.x2*C}" y2="${w.y2*C}" stroke="#9aa7c7" stroke-width="3" stroke-linecap="square"/>`;
  });
  (deck.doors||[]).forEach(d => {
    if(d.o === 'h'){
      out += `<line x1="${(d.x+.12)*C}" y1="${d.y*C}" x2="${(d.x+.88)*C}" y2="${d.y*C}" stroke="#0f1117" stroke-width="5"/>`
           + `<rect x="${(d.x+.15)*C}" y="${d.y*C-3}" width="${.7*C}" height="6" rx="2" fill="#D4A843"/>`;
    } else {
      out += `<line x1="${d.x*C}" y1="${(d.y+.12)*C}" x2="${d.x*C}" y2="${(d.y+.88)*C}" stroke="#0f1117" stroke-width="5"/>`
           + `<rect x="${d.x*C-3}" y="${(d.y+.15)*C}" width="6" height="${.7*C}" rx="2" fill="#D4A843"/>`;
    }
  });
  (deck.props||[]).forEach(p => {
    const def = DKE_PROPS[p.t]; if(!def) return;
    out += `<g transform="translate(${(p.x+.5)*C},${(p.y+.5)*C}) rotate(${p.r||0})"><title>${eh(def.n)}</title>${def.g}</g>`;
  });
  (deck.labels||[]).forEach(l => {
    out += `<text x="${l.x*C}" y="${l.y*C}" text-anchor="middle" font-size="11" font-weight="600" fill="#e8eaf0" font-family="system-ui,sans-serif" letter-spacing=".5" style="pointer-events:none">${eh(l.t)}</text>`;
  });
  const areas = (typeof stationAreas === 'function') ? stationAreas() : {};
  const seenArea = {};
  let roomLayer = '', markerLayer = '';
  (deck.links||[]).forEach(lk => {
    const a = areas[lk.a]; if(!a) return;
    const ac = a.ac || '#7f93b8', cx = (lk.x+.5)*C, cy = (lk.y+.5)*C;
    const open = opt.interactive ? ` style="cursor:pointer" onclick="selArea('${eh(lk.a)}')"` : '';
    const room = dkeRoomCells(deck, lk.x, lk.y);
    // First claim per area carries id r-<areaId> so updateNodes() highlights it
    // — on the room shape when the marker sits on floor, else on the marker
    // circle. Only the interactive station view emits ids: the editor canvas
    // can share the DOM with it, and duplicate ids would corrupt both.
    const wantId = !!opt.interactive && !seenArea[lk.a]; seenArea[lk.a] = true;
    if(room && opt.interactive){
      // Whole-room tap target; transparent fill still catches pointer events,
      // and updateNodes() swaps it for the accent glow when the area is open.
      roomLayer += `<path${wantId ? ` id="r-${eh(lk.a)}"` : ''} data-off-fill="transparent" d="${dkeRoomFillD(room)}" fill="transparent"${open}/>`;
    } else if(room && opt.editor){
      roomLayer += `<path d="${dkeRoomOutlineD(room)}" fill="none" stroke="${eh(ac)}" stroke-width="1.2" stroke-dasharray="4,4" opacity=".4"/>`;
    }
    markerLayer += `<g${open}><circle${(wantId && !room) ? ` id="r-${eh(lk.a)}"` : ''} cx="${cx}" cy="${cy}" r="9" fill="#0f1117" stroke="${eh(ac)}" stroke-width="2"/>`
         + `<circle cx="${cx}" cy="${cy}" r="3" fill="${eh(ac)}"/>`
         + `<text x="${cx}" y="${cy+20}" text-anchor="middle" font-size="9" font-weight="600" fill="${eh(ac)}" font-family="system-ui,sans-serif">${eh(a.label||lk.a)}</text></g>`;
  });
  // Rooms under markers: a tap anywhere in the room opens the area, but each
  // marker stays individually tappable even inside another marker's room.
  out += roomLayer + markerLayer;
  if(opt.sel) out += dkeSelHighlightSVG(deck, opt.sel);
  return out;
}
function dkeSelHighlightSVG(deck, sel){
  const C = DKE_CELL, S = 'fill="none" stroke="#D4A843" stroke-width="1.5" stroke-dasharray="4,3"';
  const it = (deck[sel.kind + 's']||[])[sel.i]; if(!it) return '';
  if(sel.kind === 'floor') return `<rect x="${it.x*C}" y="${it.y*C}" width="${it.w*C}" height="${it.h*C}" ${S}/>`;
  if(sel.kind === 'wall')  return `<line x1="${it.x1*C}" y1="${it.y1*C}" x2="${it.x2*C}" y2="${it.y2*C}" stroke="#D4A843" stroke-width="6" opacity=".45"/>`;
  if(sel.kind === 'door')  return it.o === 'h'
    ? `<rect x="${it.x*C}" y="${it.y*C-6}" width="${C}" height="12" ${S}/>`
    : `<rect x="${it.x*C-6}" y="${it.y*C}" width="12" height="${C}" ${S}/>`;
  if(sel.kind === 'prop')  return `<rect x="${it.x*C+2}" y="${it.y*C+2}" width="${C-4}" height="${C-4}" rx="3" ${S}/>`;
  if(sel.kind === 'link')  return `<circle cx="${(it.x+.5)*C}" cy="${(it.y+.5)*C}" r="13" ${S}/>`;
  if(sel.kind === 'label'){
    const hw = Math.max(20, String(it.t||'').length*3.1) + 6;
    return `<rect x="${it.x*C-hw}" y="${it.y*C-12}" width="${hw*2}" height="18" rx="3" ${S}/>`;
  }
  return '';
}
// Read-only render for the station view (called from renderStationMap).
function deckStationViewBox(deck){
  const C = DKE_CELL, p = C;
  return `${-p} ${-p} ${deck.w*C + 2*p} ${deck.h*C + 2*p}`;
}
function deckStationSVG(deck, def){
  const name = ((def && def.name) || 'STATION').toUpperCase();
  return `<text x="0" y="-10" font-size="12" font-weight="700" fill="#e8eaf0" font-family="system-ui,sans-serif" letter-spacing="1">${dkeEsc(name)} — DECK PLAN</text>`
    + dkeContentSVG(dkeNorm(deck), { interactive:true });
}

// ═══ EDITOR ══════════════════════════════════════════════════════════════════
let dkeIsOpen = false, dkeTool = 'room', dkeSel = null, dkeUndoStack = [];
let dkePropType = 'console', dkeLinkArea = '';
let dkeView = { x:0, y:0, w:100, h:100 };
let dkePoly = null;                 // active wall-run last vertex {x,y}
let dkeGesture = null;              // single-pointer gesture state
const dkePtrs = new Map();          // pointerId → {x,y}
let dkePinch = null;                // last two-pointer metrics {d,mx,my}
let dkeSaveTimer = null, dkeDirty = false;

const DKE_TOOLS = [
  ['pan','✋ Pan'], ['select','➤ Select'], ['room','▭ Room'], ['floor','▦ Floor'],
  ['wall','─ Wall'], ['poly','⟋ Wall run'], ['door','🚪 Door'], ['prop','📦 Props'],
  ['label','🏷 Label'], ['link','⊕ Area link'], ['erase','⌫ Erase']
];
const DKE_HINTS = {
  pan:'Drag to pan · pinch or scroll to zoom.',
  select:'Tap anything to select it. Drag props, labels and links to move them.',
  room:'Drag a rectangle — floor and perimeter walls are placed in one go.',
  floor:'Drag to paint floor tiles cell by cell.',
  wall:'Drag from corner to corner to place a straight wall (diagonals allowed).',
  poly:'Tap corner after corner to chain walls. End the run from the bar above.',
  door:'Tap a cell edge to place a door there. Tap again to remove it.',
  prop:'Pick a stamp above, then tap a cell. Tap the same prop again to rotate it.',
  label:'Type the text above, then tap the map to place it.',
  link:'Pick an area above, then tap a room — players tap the marker to open that area.',
  erase:'Tap or drag over anything to delete it.'
};

function dkeEnsureDom(){
  if(document.getElementById('dke-wrap')) return;
  const w = document.createElement('div');
  w.id = 'dke-wrap';
  w.innerHTML = `
    <div class="dke-hdr">
      <div class="dke-title" id="dke-title">DECK PLAN</div>
      <label class="dke-dim">W <input id="dke-w" type="number" min="4" max="64"></label>
      <label class="dke-dim">H <input id="dke-h" type="number" min="4" max="64"></label>
      <button class="hx-act-btn" style="flex:0 0 auto" id="dke-undo" title="Undo">↶ Undo</button>
      <button class="hx-act-btn primary" style="flex:0 0 auto" id="dke-done">✓ Done</button>
    </div>
    <div class="dke-tools" id="dke-tools"></div>
    <div class="dke-sub" id="dke-sub"></div>
    <div id="dke-canvas"><svg id="dke-svg" xmlns="http://www.w3.org/2000/svg"><g id="dke-content"></g><g id="dke-ghost"></g></svg></div>
    <div class="dke-hint" id="dke-hint"></div>`;
  document.body.appendChild(w);
  const svg = document.getElementById('dke-svg');
  svg.addEventListener('pointerdown', dkePointerDown);
  svg.addEventListener('pointermove', dkePointerMove);
  svg.addEventListener('pointerup', dkePointerUp);
  svg.addEventListener('pointercancel', dkePointerUp);
  document.getElementById('dke-canvas').addEventListener('wheel', dkeWheel, { passive:false });
  document.getElementById('dke-undo').addEventListener('click', dkeUndoPop);
  document.getElementById('dke-done').addEventListener('click', dkeClose);
  document.getElementById('dke-w').addEventListener('change', function(){ dkeResize('w', this.value); });
  document.getElementById('dke-h').addEventListener('change', function(){ dkeResize('h', this.value); });
  window.addEventListener('resize', () => { if(dkeIsOpen) dkeApplyView(); });
  document.addEventListener('keydown', dkeKeyDown);
}

function dkeOpen(){
  if(typeof isReferee === 'function' && !isReferee()) return;
  if(typeof currentStationId === 'undefined' || currentStationId === 'aurelia') return;
  const s = stationAdditions[currentStationId]; if(!s) return;
  if(!s.deck) s.deck = dkeBlank();
  dkeNorm(s.deck);
  dkeEnsureDom();
  dkeIsOpen = true; dkeTool = deckHasContent(s.deck) ? 'select' : 'room';
  dkeSel = null; dkePoly = null; dkeGesture = null; dkeUndoStack = []; dkePtrs.clear(); dkePinch = null;
  document.getElementById('dke-wrap').classList.add('open');
  document.getElementById('dke-title').textContent = ((s.name || 'STATION').toUpperCase()) + ' — DECK PLAN';
  document.getElementById('dke-w').value = s.deck.w;
  document.getElementById('dke-h').value = s.deck.h;
  dkeFitView();
  dkeRenderAll();
}
function dkeClose(){
  if(!dkeIsOpen) return;
  dkeIsOpen = false; dkePoly = null; dkeGesture = null; dkePtrs.clear(); dkePinch = null;
  const w = document.getElementById('dke-wrap'); if(w) w.classList.remove('open');
  dkeFlushSave();
  if(typeof renderStationMap === 'function') renderStationMap();
  if(typeof updateNodes === 'function') updateNodes();
  if(typeof renderDesignPanel === 'function') renderDesignPanel();
}
function dkeRemove(){
  if(typeof isReferee === 'function' && !isReferee()) return;
  const s = stationAdditions[currentStationId]; if(!s || !s.deck) return;
  if(!confirm('Remove this deck plan? The map goes back to the automatic layout.')) return;
  delete s.deck;
  saveAuthoredStations();
  if(typeof renderStationMap === 'function') renderStationMap();
  if(typeof renderDesignPanel === 'function') renderDesignPanel();
}
// Design Studio row (called from designStationViewHTML in js/40-station.js).
function dkeStudioRowHTML(){
  const has = deckHasContent(dkeD()) || !!dkeD();
  return `<div class="hx-edit-row"><span>Deck plan</span><div style="flex:1;display:flex;gap:6px">
    <button class="hx-act-btn primary" onclick="dkeOpen()">🗺 ${has ? 'Edit' : 'Draw'} deck plan</button>
    ${has ? `<button class="hx-act-btn" style="flex:0 0 auto;border-color:#c0506e;color:#ff9bb6" onclick="dkeRemove()" title="Remove deck plan">🗑</button>` : ''}
  </div></div>`;
}

// ── Rendering ────────────────────────────────────────────────────────────────
function dkeRenderAll(){ dkeRenderContent(); dkeRenderTools(); dkeRenderSub(); dkeRenderHint(); dkeApplyView(); }
function dkeRenderContent(){
  const d = dkeD(), g = document.getElementById('dke-content');
  if(g) g.innerHTML = d ? dkeContentSVG(d, { editor:true, sel:dkeSel }) : '';
}
function dkeGhost(markup){
  const g = document.getElementById('dke-ghost'); if(g) g.innerHTML = markup || '';
}
function dkeRenderTools(){
  const el = document.getElementById('dke-tools'); if(!el) return;
  el.innerHTML = DKE_TOOLS.map(([k,l]) =>
    `<button class="dke-tool${dkeTool===k?' on':''}" onclick="dkeSetTool('${k}')">${l}</button>`).join('');
}
function dkeSetTool(t){
  dkeTool = t;
  if(t !== 'poly') dkePolyEnd(true);
  if(t !== 'select'){ dkeSel = null; dkeRenderContent(); }
  dkeRenderTools(); dkeRenderSub(); dkeRenderHint();
}
function dkeRenderHint(){
  const el = document.getElementById('dke-hint');
  if(el) el.textContent = DKE_HINTS[dkeTool] || '';
}
function dkeRenderSub(){
  const el = document.getElementById('dke-sub'); if(!el) return;
  const eh = dkeEsc;
  let html = '';
  if(dkeTool === 'prop'){
    html = Object.keys(DKE_PROPS).map(k =>
      `<button class="dke-tool${dkePropType===k?' on':''}" onclick="dkePropType='${k}';dkeRenderSub()" title="${eh(DKE_PROPS[k].n)}">`
      + `<svg viewBox="-16 -16 32 32" width="20" height="20" style="vertical-align:middle">${DKE_PROPS[k].g}</svg> ${eh(DKE_PROPS[k].n)}</button>`).join('');
  } else if(dkeTool === 'label'){
    html = `<input class="hx-edit-in" id="dke-label-text" placeholder="Label text — then tap the map…" style="max-width:260px">`;
  } else if(dkeTool === 'link'){
    const areas = (typeof stationAreas === 'function') ? stationAreas() : {};
    const ids = Object.keys(areas);
    html = ids.length
      ? `<select class="hx-edit-in" style="max-width:240px" onchange="dkeLinkArea=this.value">`
        + `<option value="">— pick an area —</option>`
        + ids.map(id => `<option value="${eh(id)}"${dkeLinkArea===id?' selected':''}>${eh(areas[id].label||id)}</option>`).join('')
        + `</select>`
      : `<span class="dke-note">No areas yet — add areas in the Design Studio first.</span>`;
  } else if(dkeTool === 'poly' && dkePoly){
    html = `<button class="dke-tool on" onclick="dkePolyEnd()">✓ End wall run</button>`;
  } else if(dkeTool === 'select' && dkeSel){
    const d = dkeD(), it = d ? (d[dkeSel.kind+'s']||[])[dkeSel.i] : null;
    if(it){
      if(dkeSel.kind === 'prop') html += `<button class="dke-tool" onclick="dkeRotateSel()">⟳ Rotate</button>`;
      if(dkeSel.kind === 'label') html += `<input class="hx-edit-in" style="max-width:200px" value="${eh(it.t)}" onchange="dkeEditLabelSel(this.value)">`;
      html += `<button class="dke-tool dke-danger" onclick="dkeDeleteSel()">🗑 Delete</button>`;
    }
  }
  el.innerHTML = html;
  el.style.display = html ? 'flex' : 'none';
  if(dkeTool === 'label'){
    const inp = document.getElementById('dke-label-text');
    if(inp){ inp.value = dkeLabelTextVal; inp.addEventListener('input', function(){ dkeLabelTextVal = this.value; }); }
  }
}
let dkeLabelTextVal = '';

// ── Viewport (viewBox kept at canvas aspect → linear client↔svg mapping) ─────
function dkeCanvasRect(){ return document.getElementById('dke-canvas').getBoundingClientRect(); }
function dkeApplyView(){
  const R = dkeCanvasRect();
  if(R.width > 0 && R.height > 0) dkeView.h = dkeView.w * (R.height / R.width);
  const svg = document.getElementById('dke-svg');
  if(svg) svg.setAttribute('viewBox', `${dkeView.x} ${dkeView.y} ${dkeView.w} ${dkeView.h}`);
}
function dkeFitView(){
  const d = dkeD(); if(!d) return;
  const C = DKE_CELL, pad = C * 1.5, R = dkeCanvasRect();
  const cw = d.w*C + 2*pad, ch = d.h*C + 2*pad;
  const aspect = (R.width > 0 && R.height > 0) ? R.width / R.height : 1;
  let vw = cw, vh = vw / aspect;
  if(vh < ch){ vh = ch; vw = vh * aspect; }
  dkeView = { x: d.w*C/2 - vw/2, y: d.h*C/2 - vh/2, w: vw, h: vh };
}
function dkeToSvg(cx, cy){
  const R = dkeCanvasRect();
  return { x: dkeView.x + (cx - R.left) / R.width * dkeView.w,
           y: dkeView.y + (cy - R.top) / R.height * dkeView.h };
}
function dkeZoomAt(cx, cy, k){
  const C = DKE_CELL, p = dkeToSvg(cx, cy), R = dkeCanvasRect();
  const nw = Math.max(C*3, Math.min(C*220, dkeView.w * k));
  const realK = nw / dkeView.w;
  dkeView.w = nw; dkeView.h = dkeView.h * realK;
  dkeView.x = p.x - (cx - R.left) / R.width * dkeView.w;
  dkeView.y = p.y - (cy - R.top) / R.height * dkeView.h;
  dkeApplyView();
}
function dkeWheel(ev){
  if(!dkeIsOpen) return;
  ev.preventDefault();
  dkeZoomAt(ev.clientX, ev.clientY, Math.pow(1.0015, ev.deltaY));
}

// ── Geometry helpers (cell units) ────────────────────────────────────────────
function dkeCellPt(p){ return { x: p.x / DKE_CELL, y: p.y / DKE_CELL }; }
function dkeVertex(p){
  const d = dkeD(), u = dkeCellPt(p);
  return { x: Math.max(0, Math.min(d.w, Math.round(u.x))), y: Math.max(0, Math.min(d.h, Math.round(u.y))) };
}
function dkeCell(p){
  const d = dkeD(), u = dkeCellPt(p);
  const x = Math.floor(u.x), y = Math.floor(u.y);
  if(x < 0 || y < 0 || x >= d.w || y >= d.h) return null;
  return { x, y };
}
function dkeNearestEdge(p, maxDist){
  const u = dkeCellPt(p), cx = Math.floor(u.x), cy = Math.floor(u.y);
  const fx = u.x - cx, fy = u.y - cy;
  const cand = [
    { x:cx, y:cy,   o:'h', dist:fy },
    { x:cx, y:cy+1, o:'h', dist:1-fy },
    { x:cx, y:cy,   o:'v', dist:fx },
    { x:cx+1, y:cy, o:'v', dist:1-fx }
  ].sort((a,b) => a.dist - b.dist)[0];
  return (cand && cand.dist <= maxDist) ? cand : null;
}
function dkeSegDist(u, s){
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const len2 = dx*dx + dy*dy;
  if(!len2) return Math.hypot(u.x - s.x1, u.y - s.y1);
  let t = ((u.x - s.x1)*dx + (u.y - s.y1)*dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(u.x - (s.x1 + t*dx), u.y - (s.y1 + t*dy));
}
function dkeHitTest(p){
  const d = dkeD(); if(!d) return null;
  const u = dkeCellPt(p);
  const e = dkeNearestEdge(p, .3);
  if(e){
    const i = d.doors.findIndex(dr => dr.x === e.x && dr.y === e.y && dr.o === e.o);
    if(i >= 0) return { kind:'door', i };
  }
  for(let i = d.props.length - 1; i >= 0; i--)
    if(Math.floor(u.x) === d.props[i].x && Math.floor(u.y) === d.props[i].y) return { kind:'prop', i };
  for(let i = d.links.length - 1; i >= 0; i--)
    if(Math.hypot(u.x - (d.links[i].x+.5), u.y - (d.links[i].y+.5)) < .5) return { kind:'link', i };
  for(let i = d.labels.length - 1; i >= 0; i--){
    const l = d.labels[i], hw = Math.max(.5, String(l.t||'').length * .1);
    if(Math.abs(u.x - l.x) < hw && Math.abs(u.y - l.y) < .4) return { kind:'label', i };
  }
  let best = -1, bestDist = .28;
  d.walls.forEach((w, i) => { const dist = dkeSegDist(u, w); if(dist < bestDist){ bestDist = dist; best = i; } });
  if(best >= 0) return { kind:'wall', i:best };
  for(let i = d.floors.length - 1; i >= 0; i--){
    const f = d.floors[i];
    if(u.x >= f.x && u.x <= f.x + f.w && u.y >= f.y && u.y <= f.y + f.h) return { kind:'floor', i };
  }
  return null;
}

// ── Undo / save ──────────────────────────────────────────────────────────────
function dkeSnapshot(){
  const d = dkeD(); if(!d) return;
  dkeUndoStack.push(JSON.stringify(d));
  if(dkeUndoStack.length > 40) dkeUndoStack.shift();
}
function dkeUndoPop(){
  const s = stationAdditions[currentStationId];
  if(!s || !dkeUndoStack.length) return;
  s.deck = dkeNorm(JSON.parse(dkeUndoStack.pop()));
  dkeSel = null; dkePoly = null;
  document.getElementById('dke-w').value = s.deck.w;
  document.getElementById('dke-h').value = s.deck.h;
  dkeCommit(); dkeRenderSub();
}
function dkeCommit(){
  dkeRenderContent();
  dkeDirty = true;
  if(dkeSaveTimer) clearTimeout(dkeSaveTimer);
  dkeSaveTimer = setTimeout(dkeFlushSave, 600);
}
function dkeFlushSave(){
  if(dkeSaveTimer){ clearTimeout(dkeSaveTimer); dkeSaveTimer = null; }
  if(!dkeDirty) return;
  dkeDirty = false;
  if(typeof saveAuthoredStations === 'function') saveAuthoredStations();
}
function dkeResize(dim, val){
  const d = dkeD(); if(!d) return;
  dkeSnapshot();
  d[dim] = Math.max(4, Math.min(64, parseInt(val,10) || d[dim]));
  document.getElementById('dke-' + dim).value = d[dim];
  dkeCommit();
}

// ── Selection actions ────────────────────────────────────────────────────────
function dkeDeleteSel(){
  const d = dkeD(); if(!d || !dkeSel) return;
  dkeSnapshot();
  (d[dkeSel.kind + 's']||[]).splice(dkeSel.i, 1);
  dkeSel = null;
  dkeCommit(); dkeRenderSub();
}
function dkeRotateSel(){
  const d = dkeD(); if(!d || !dkeSel || dkeSel.kind !== 'prop') return;
  dkeSnapshot();
  const p = d.props[dkeSel.i]; if(p) p.r = ((p.r||0) + 90) % 360;
  dkeCommit();
}
function dkeEditLabelSel(v){
  const d = dkeD(); if(!d || !dkeSel || dkeSel.kind !== 'label') return;
  const t = String(v||'').trim(); if(!t) return;
  dkeSnapshot();
  d.labels[dkeSel.i].t = t;
  dkeCommit();
}
function dkePolyEnd(silent){
  if(dkePoly){ dkePoly = null; dkeGhost(''); if(!silent) dkeRenderSub(); }
}

// ── Pointer gestures ─────────────────────────────────────────────────────────
function dkePinchMetrics(){
  const pts = [...dkePtrs.values()];
  return { d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
           mx: (pts[0].x + pts[1].x) / 2, my: (pts[0].y + pts[1].y) / 2 };
}
function dkePointerDown(ev){
  if(!dkeIsOpen) return;
  ev.preventDefault();
  const svg = document.getElementById('dke-svg');
  try { svg.setPointerCapture(ev.pointerId); } catch(e){}
  dkePtrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if(dkePtrs.size === 2){ dkeGesture = null; dkeGhost(''); dkePinch = dkePinchMetrics(); return; }
  if(dkePtrs.size > 2) return;
  const p = dkeToSvg(ev.clientX, ev.clientY), d = dkeD(); if(!d) return;
  if(dkeTool === 'pan'){
    dkeGesture = { t:'pan', cx: ev.clientX, cy: ev.clientY };
  } else if(dkeTool === 'room' || dkeTool === 'wall'){
    const v = dkeVertex(p);
    dkeGesture = { t: dkeTool, x0: v.x, y0: v.y, x1: v.x, y1: v.y };
  } else if(dkeTool === 'floor'){
    dkeGesture = { t:'floor', snapped:false };
    dkePaintFloor(p, dkeGesture);
  } else if(dkeTool === 'erase'){
    dkeGesture = { t:'erase', snapped:false };
    dkeEraseAt(p, dkeGesture);
  } else if(dkeTool === 'select'){
    const hit = dkeHitTest(p);
    if(hit && (hit.kind === 'prop' || hit.kind === 'label' || hit.kind === 'link')){
      dkeGesture = { t:'move', hit, sx: ev.clientX, sy: ev.clientY, moved:false, snapped:false };
    } else {
      dkeSel = hit; dkeRenderContent(); dkeRenderSub();
      dkeGesture = { t:'tapped' };
    }
  } else {
    dkeGesture = { t:'tap', sx: ev.clientX, sy: ev.clientY, cancel:false };
  }
}
function dkePointerMove(ev){
  if(!dkeIsOpen || !dkePtrs.has(ev.pointerId)) return;
  ev.preventDefault();
  dkePtrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if(dkePtrs.size === 2 && dkePinch){
    const cur = dkePinchMetrics(), R = dkeCanvasRect();
    if(cur.d > 0 && dkePinch.d > 0) dkeZoomAt(cur.mx, cur.my, dkePinch.d / cur.d);
    dkeView.x -= (cur.mx - dkePinch.mx) / R.width * dkeView.w;
    dkeView.y -= (cur.my - dkePinch.my) / R.height * dkeView.h;
    dkeApplyView();
    dkePinch = cur;
    return;
  }
  const g = dkeGesture; if(!g) return;
  const p = dkeToSvg(ev.clientX, ev.clientY), C = DKE_CELL;
  if(g.t === 'pan'){
    const R = dkeCanvasRect();
    dkeView.x -= (ev.clientX - g.cx) / R.width * dkeView.w;
    dkeView.y -= (ev.clientY - g.cy) / R.height * dkeView.h;
    g.cx = ev.clientX; g.cy = ev.clientY;
    dkeApplyView();
  } else if(g.t === 'room'){
    const v = dkeVertex(p); g.x1 = v.x; g.y1 = v.y;
    const x = Math.min(g.x0, g.x1)*C, y = Math.min(g.y0, g.y1)*C;
    dkeGhost(`<rect x="${x}" y="${y}" width="${Math.abs(g.x1-g.x0)*C}" height="${Math.abs(g.y1-g.y0)*C}" fill="#D4A84318" stroke="#D4A843" stroke-width="1.5" stroke-dasharray="5,3"/>`);
  } else if(g.t === 'wall'){
    const v = dkeVertex(p); g.x1 = v.x; g.y1 = v.y;
    dkeGhost(`<line x1="${g.x0*C}" y1="${g.y0*C}" x2="${g.x1*C}" y2="${g.y1*C}" stroke="#D4A843" stroke-width="2.5" stroke-dasharray="5,3"/>`);
  } else if(g.t === 'floor'){
    dkePaintFloor(p, g);
  } else if(g.t === 'erase'){
    dkeEraseAt(p, g);
  } else if(g.t === 'move'){
    if(!g.moved && Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) < 5) return;
    g.moved = true;
    if(!g.snapped){ dkeSnapshot(); g.snapped = true; }
    const d = dkeD(), it = (d[g.hit.kind + 's']||[])[g.hit.i]; if(!it) return;
    const u = dkeCellPt(p);
    if(g.hit.kind === 'label'){ it.x = u.x; it.y = u.y; }
    else { it.x = Math.floor(u.x); it.y = Math.floor(u.y); }
    dkeSel = g.hit;
    dkeRenderContent();
  } else if(g.t === 'tap'){
    if(Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) > 8) g.cancel = true;
  }
}
function dkePointerUp(ev){
  if(!dkePtrs.has(ev.pointerId)) return;
  dkePtrs.delete(ev.pointerId);
  if(dkePtrs.size < 2) dkePinch = null;
  const g = dkeGesture; if(!g || dkePtrs.size) return;
  dkeGesture = null;
  const d = dkeD(); if(!d) return;
  const p = dkeToSvg(ev.clientX, ev.clientY), C = DKE_CELL;
  if(g.t === 'room'){
    dkeGhost('');
    const x = Math.min(g.x0, g.x1), y = Math.min(g.y0, g.y1);
    const w = Math.abs(g.x1 - g.x0), h = Math.abs(g.y1 - g.y0);
    if(w >= 1 && h >= 1){
      dkeSnapshot();
      d.floors.push({ x, y, w, h });
      dkeAddWall(d, x, y, x+w, y);   dkeAddWall(d, x+w, y, x+w, y+h);
      dkeAddWall(d, x+w, y+h, x, y+h); dkeAddWall(d, x, y+h, x, y);
      dkeCommit();
    }
  } else if(g.t === 'wall'){
    dkeGhost('');
    if(g.x0 !== g.x1 || g.y0 !== g.y1){
      dkeSnapshot();
      dkeAddWall(d, g.x0, g.y0, g.x1, g.y1);
      dkeCommit();
    }
  } else if(g.t === 'floor' || g.t === 'erase'){
    dkeFlushSave();
  } else if(g.t === 'move'){
    if(g.moved){
      const it = (d[g.hit.kind + 's']||[])[g.hit.i];
      if(it && g.hit.kind === 'label'){ it.x = Math.round(it.x*4)/4; it.y = Math.round(it.y*4)/4; }
      dkeCommit(); dkeRenderSub();
    } else {
      dkeSel = g.hit; dkeRenderContent(); dkeRenderSub();
    }
  } else if(g.t === 'tap' && !g.cancel){
    dkeTapAction(p);
  }
}
function dkeAddWall(d, x1, y1, x2, y2){
  const dup = d.walls.some(w => (w.x1===x1 && w.y1===y1 && w.x2===x2 && w.y2===y2)
                             || (w.x1===x2 && w.y1===y2 && w.x2===x1 && w.y2===y1));
  if(!dup) d.walls.push({ x1, y1, x2, y2 });
}
function dkePaintFloor(p, g){
  const d = dkeD(), c = dkeCell(p);
  if(!d || !c) return;
  const dup = d.floors.some(f => f.w === 1 && f.h === 1 && f.x === c.x && f.y === c.y);
  if(dup) return;
  if(!g.snapped){ dkeSnapshot(); g.snapped = true; }
  d.floors.push({ x: c.x, y: c.y, w: 1, h: 1 });
  dkeRenderContent(); dkeDirty = true;
}
function dkeEraseAt(p, g){
  const d = dkeD(), hit = dkeHitTest(p);
  if(!d || !hit) return;
  if(!g.snapped){ dkeSnapshot(); g.snapped = true; }
  (d[hit.kind + 's']||[]).splice(hit.i, 1);
  if(dkeSel && dkeSel.kind === hit.kind && dkeSel.i === hit.i) dkeSel = null;
  dkeRenderContent(); dkeDirty = true;
}
function dkeTapAction(p){
  const d = dkeD(); if(!d) return;
  const C = DKE_CELL;
  if(dkeTool === 'poly'){
    const v = dkeVertex(p);
    if(!dkePoly){
      dkePoly = { x: v.x, y: v.y };
      dkeRenderSub();
    } else if(v.x !== dkePoly.x || v.y !== dkePoly.y){
      dkeSnapshot();
      dkeAddWall(d, dkePoly.x, dkePoly.y, v.x, v.y);
      dkePoly = { x: v.x, y: v.y };
      dkeCommit();
    }
    dkeGhost(`<circle cx="${dkePoly.x*C}" cy="${dkePoly.y*C}" r="5" fill="none" stroke="#D4A843" stroke-width="2"/>`);
  } else if(dkeTool === 'door'){
    const e = dkeNearestEdge(p, .4); if(!e) return;
    const i = d.doors.findIndex(dr => dr.x === e.x && dr.y === e.y && dr.o === e.o);
    dkeSnapshot();
    if(i >= 0) d.doors.splice(i, 1);
    else d.doors.push({ x: e.x, y: e.y, o: e.o });
    dkeCommit();
  } else if(dkeTool === 'prop'){
    const c = dkeCell(p); if(!c) return;
    const existing = d.props.find(pr => pr.x === c.x && pr.y === c.y);
    dkeSnapshot();
    if(existing && existing.t === dkePropType) existing.r = ((existing.r||0) + 90) % 360;
    else if(existing){ existing.t = dkePropType; existing.r = 0; }
    else d.props.push({ t: dkePropType, x: c.x, y: c.y, r: 0 });
    dkeCommit();
  } else if(dkeTool === 'label'){
    const t = String(dkeLabelTextVal||'').trim();
    if(!t){ if(typeof showToast === 'function') showToast('Type the label text first'); return; }
    dkeSnapshot();
    const u = dkeCellPt(p);
    d.labels.push({ t, x: Math.round(u.x*4)/4, y: Math.round(u.y*4)/4 });
    dkeCommit();
  } else if(dkeTool === 'link'){
    if(!dkeLinkArea){ if(typeof showToast === 'function') showToast('Pick an area first'); return; }
    const c = dkeCell(p); if(!c) return;
    dkeSnapshot();
    d.links.push({ a: dkeLinkArea, x: c.x, y: c.y });
    dkeCommit();
  }
}
function dkeKeyDown(ev){
  if(!dkeIsOpen) return;
  const tag = (ev.target && ev.target.tagName) || '';
  if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if(ev.key === 'Escape'){
    if(dkePoly) dkePolyEnd();
    else if(dkeSel){ dkeSel = null; dkeRenderContent(); dkeRenderSub(); }
    ev.preventDefault();
  } else if((ev.key === 'Delete' || ev.key === 'Backspace') && dkeSel){
    dkeDeleteSel(); ev.preventDefault();
  } else if((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z'){
    dkeUndoPop(); ev.preventDefault();
  }
}

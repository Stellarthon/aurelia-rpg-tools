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
// (grid-vertex coords, diagonals allowed), doors:[{x,y,o:'h'|'v',s?,t?,len?}]
// (openings on a wall edge from vertex (x,y) rightward for 'h' / downward for 'v';
// t = 'window' (else door), len = 1–3 cells, door s = 'open'|'locked' absent=closed
// — referee-cycled), props:[{t,x,y,r}] (top-left cell +
// rotation; multi-cell footprint comes from the DKE_PROPS catalogue, not the datum),
// labels:[{t,x,y}] (cell units, fractional), links:[{a,x,y,hid?:1,mem?}] (areaId
// marker; hid = fog of war), tokens:[{n,x,y}] (name + cell — PCs and NPCs) }.
// FOG OF WAR rides the link marker: hid hides the marker's whole claimed room
// from players (opaque fog with the grid redrawn over it — only boundary walls
// and doors stay visible, like seeing a hull from outside) and removes the tap
// target. The referee sees hidden rooms dimmed, with an eye toggle under each
// marker name on the station view. Links default to revealed so live maps
// don't black out; the referee closes the eye on rooms not yet explored.
// A link marker claims its ROOM: every floor cell reachable from it without
// crossing an axis-aligned wall becomes the tap target on the station view,
// so players tap anywhere in the room — not just the marker — to open the area.
// Tokens carry their display NAME in the deck (the NPC roster is referee-only,
// so player devices could never resolve an id). Art: the character's uploaded
// sheet portrait (public bucket, portraitUrlFor) clipped to a circle — when no
// portrait exists the <image> paints nothing and the initials disc beneath
// shows through, so no async portrait lookup is needed.
//
// The referee edits in a full-screen overlay (#dke-wrap, built lazily);
// players get the read-only render via deckStationSVG() from renderStationMap.

const DKE_CELL = 32;
const DKE_MAXDIM = 96;   // max deck size in cells (raised from 64 for drag-resize headroom)
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
  stairs  : { n:'Stairs',   g:'<rect x="-11" y="-11" width="22" height="22" fill="#0f1117" stroke="#a3a9bf" stroke-width="1.3"/><path d="M-11,-5.5 h22 M-11,0 h22 M-11,5.5 h22" stroke="#a3a9bf" stroke-width="1"/>' },
  // Multi-cell stamps (w/h in cells; glyph authored centred on origin, spanning
  // ±w·16 × ±h·16). Rotation swaps the footprint for 2×1 shapes; see dkePropFootprint.
  dblbunk : { n:'Double bunk', w:2, h:1, g:'<rect x="-30" y="-13" width="60" height="26" rx="3" fill="#0f1117" stroke="#4caf82" stroke-width="1.5"/><line x1="0" y1="-13" x2="0" y2="13" stroke="#4caf82" stroke-width=".8"/><rect x="-27" y="-10" width="9" height="20" rx="1" fill="#4caf8233" stroke="#4caf82" stroke-width=".6"/><rect x="18" y="-10" width="9" height="20" rx="1" fill="#4caf8233" stroke="#4caf82" stroke-width=".6"/>' },
  container:{ n:'Cargo container', w:2, h:1, g:'<rect x="-30" y="-12" width="60" height="24" fill="#0f1117" stroke="#d4913a" stroke-width="1.5"/><path d="M-18,-12 v24 M-6,-12 v24 M6,-12 v24 M18,-12 v24" stroke="#d4913a" stroke-width=".6"/><rect x="-30" y="-12" width="5" height="24" fill="none" stroke="#d4913a" stroke-width="1"/><rect x="25" y="-12" width="5" height="24" fill="none" stroke="#d4913a" stroke-width="1"/>' },
  shuttle : { n:'Shuttle', w:2, h:2, g:'<path d="M0,-28 L9,-8 L12,16 L7,25 L-7,25 L-12,16 L-9,-8 Z" fill="#0f1117" stroke="#7f93b8" stroke-width="1.6"/><path d="M-9,2 L-27,15 L-27,20 L-10,13 Z" fill="#0f1117" stroke="#7f93b8" stroke-width="1.2"/><path d="M9,2 L27,15 L27,20 L10,13 Z" fill="#0f1117" stroke="#7f93b8" stroke-width="1.2"/><path d="M0,-24 L5,-10 L-5,-10 Z" fill="#5b8ef033" stroke="#5b8ef0" stroke-width="1"/><rect x="-7" y="23" width="4.5" height="4" rx="1" fill="#D4A843"/><rect x="2.5" y="23" width="4.5" height="4" rx="1" fill="#D4A843"/>' },
  medbay  : { n:'Medbay bed', w:2, h:1, g:'<rect x="-30" y="-13" width="60" height="26" rx="3" fill="#0f1117" stroke="#4caf82" stroke-width="1.5"/><rect x="-27" y="-10" width="11" height="20" rx="1" fill="#4caf8233" stroke="#4caf82" stroke-width=".6"/><path d="M16,-6 h10 M21,-11 v10" stroke="#c0506e" stroke-width="2.6" stroke-linecap="round"/>' },
  wlocker : { n:'Weapons locker', g:'<rect x="-9" y="-12" width="18" height="24" rx="1.5" fill="#0f1117" stroke="#c0506e" stroke-width="1.5"/><circle r="4.5" fill="none" stroke="#c0506e" stroke-width="1.2"/><path d="M0,-8 v3 M0,8 v-3 M-8,0 h3 M8,0 h-3" stroke="#c0506e" stroke-width="1.2"/>' },
  reactor : { n:'Reactor', w:2, h:2, g:'<circle r="24" fill="#0f1117" stroke="#d4913a" stroke-width="1.6"/><circle r="10" fill="none" stroke="#d4913a" stroke-width="1.3"/><circle r="3" fill="#d4913a"/><path d="M0,-24 v6 M0,24 v-6 M-24,0 h6 M24,0 h-6 M-17,-17 l4.2,4.2 M17,17 l-4.2,-4.2 M17,-17 l-4.2,4.2 M-17,17 l4.2,-4.2" stroke="#d4913a" stroke-width="1.1"/>' },
  turret  : { n:'Turret', g:'<circle r="8" fill="#0f1117" stroke="#9aa7c7" stroke-width="1.5"/><rect x="-2" y="-15" width="4" height="9" rx="1" fill="#9aa7c7"/><circle r="3" fill="none" stroke="#9aa7c7" stroke-width="1"/>' },
  computer: { n:'Computer core', g:'<rect x="-9" y="-12" width="18" height="24" rx="1.5" fill="#0f1117" stroke="#5b8ef0" stroke-width="1.5"/><path d="M-6,-8 h12 M-6,-4 h12 M-6,0 h12 M-6,4 h8" stroke="#5b8ef0" stroke-width=".9"/><circle cx="5" cy="7" r="1.4" fill="#5b8ef0"/>' },
  pod     : { n:'Escape pod', g:'<ellipse rx="8" ry="11" fill="#0f1117" stroke="#D4A843" stroke-width="1.5"/><ellipse cy="-2" rx="4" ry="5" fill="none" stroke="#D4A843" stroke-width="1"/><path d="M-8,6 h16" stroke="#D4A843" stroke-width=".9"/>' }
};
// Prop footprint (in cells) at its rotation AND scale — 90°/270° swap w↔h so a
// 2×1 stamp turns; an optional `s` (1–3) multiplies both dimensions. Missing
// def / s absent stays the catalogue size, so pre-existing props are unchanged.
function dkePropScaleOf(p){ const s = (p && p.s) | 0; return s >= 1 && s <= 3 ? s : 1; }
function dkePropFootprint(p){
  const def = DKE_PROPS[p && p.t] || {}, w = def.w || 1, h = def.h || 1, r = ((p && p.r) || 0) % 360;
  const swap = (r === 90 || r === 270), sc = dkePropScaleOf(p);
  return { fw: (swap ? h : w) * sc, fh: (swap ? w : h) * sc };
}
function dkePropCells(p){
  const f = dkePropFootprint(p), out = [];
  for(let i = 0; i < f.fw; i++) for(let j = 0; j < f.fh; j++) out.push({ x: p.x + i, y: p.y + j });
  return out;
}
// Keep a prop's whole footprint on the grid (anchor is its top-left cell).
function dkeClampProp(d, p){
  const f = dkePropFootprint(p);
  p.x = Math.max(0, Math.min(d.w - f.fw, p.x));
  p.y = Math.max(0, Math.min(d.h - f.fh, p.y));
}

// ── Room templates & copy-paste ──────────────────────────────────────────────
// A template is a deck fragment in local (0-based) cell coords: {w,h,floors,
// walls,doors,props,labels}. Prefabs are fixed; the clipboard is captured from a
// dragged region. Stamping translates the fragment to an anchor and appends it to
// the live deck through the normal arrays, so rendering/hit-testing just work.
// Links and tokens are deliberately NOT copied (area markers + live characters).
function dkeRectWalls(w, h){
  return [ { x1:0,y1:0,x2:w,y2:0 }, { x1:w,y1:0,x2:w,y2:h }, { x1:w,y1:h,x2:0,y2:h }, { x1:0,y1:h,x2:0,y2:0 } ];
}
function dkeMkRoom(w, h, doors, props){
  return { w, h, floors:[{ x:0,y:0,w,h }], walls:dkeRectWalls(w,h), doors:doors||[], props:props||[], labels:[] };
}
const DKE_TEMPLATES = {
  cabin:   { n:'Cabin',            t:dkeMkRoom(3,3,[{ x:1,y:3,o:'h' }],[{ t:'bunk',x:0,y:0 },{ t:'locker',x:2,y:0 }]) },
  airlock: { n:'Airlock corridor', t:dkeMkRoom(2,5,[{ x:0,y:0,o:'h' },{ x:0,y:5,o:'h' }],[{ t:'airlock',x:0,y:0 },{ t:'airlock',x:1,y:4 }]) },
  bridge:  { n:'Bridge',           t:dkeMkRoom(4,3,[{ x:1,y:3,o:'h' }],[{ t:'console',x:0,y:0 },{ t:'console',x:1,y:0 },{ t:'console',x:2,y:0 },{ t:'console',x:3,y:0 },{ t:'chair',x:1,y:1 },{ t:'chair',x:2,y:1 }]) }
};
function dkeStampTemplate(d, tpl, ax, ay){
  if(!d || !tpl) return null;
  const ox = Math.max(0, Math.min(d.w - tpl.w, ax)), oy = Math.max(0, Math.min(d.h - tpl.h, ay));
  (tpl.floors||[]).forEach(f => d.floors.push({ x:f.x+ox, y:f.y+oy, w:f.w, h:f.h }));
  (tpl.walls||[]).forEach(w => dkeAddWall(d, w.x1+ox, w.y1+oy, w.x2+ox, w.y2+oy));
  (tpl.doors||[]).forEach(dr => { if(!d.doors.some(e => e.x===dr.x+ox && e.y===dr.y+oy && e.o===dr.o)){ const nd = { x:dr.x+ox, y:dr.y+oy, o:dr.o }; if(dr.s) nd.s = dr.s; d.doors.push(nd); } });
  (tpl.props||[]).forEach(pr => d.props.push({ t:pr.t, x:pr.x+ox, y:pr.y+oy, r:pr.r||0 }));
  (tpl.labels||[]).forEach(l => d.labels.push({ t:l.t, x:l.x+ox, y:l.y+oy }));
  return { ox, oy };
}
// Build a template from everything inside a dragged vertex rectangle (floors are
// clipped to the box; walls/doors kept if they lie on it; props by anchor cell).
function dkeCaptureRegion(d, x0, y0, x1, y1){
  const ax = Math.min(x0,x1), ay = Math.min(y0,y1), bx = Math.max(x0,x1), by = Math.max(y0,y1);
  const w = bx - ax, h = by - ay;
  if(w < 1 || h < 1) return null;
  const tpl = { w, h, floors:[], walls:[], doors:[], props:[], labels:[] };
  (d.floors||[]).forEach(f => {
    const fx0 = Math.max(f.x,ax), fy0 = Math.max(f.y,ay), fx1 = Math.min(f.x+f.w,bx), fy1 = Math.min(f.y+f.h,by);
    if(fx1 > fx0 && fy1 > fy0) tpl.floors.push({ x:fx0-ax, y:fy0-ay, w:fx1-fx0, h:fy1-fy0 });
  });
  (d.walls||[]).forEach(w2 => {
    if(w2.x1>=ax && w2.x1<=bx && w2.x2>=ax && w2.x2<=bx && w2.y1>=ay && w2.y1<=by && w2.y2>=ay && w2.y2<=by)
      tpl.walls.push({ x1:w2.x1-ax, y1:w2.y1-ay, x2:w2.x2-ax, y2:w2.y2-ay });
  });
  (d.doors||[]).forEach(dr => { if(dr.x>=ax && dr.x<=bx && dr.y>=ay && dr.y<=by){ const nd = { x:dr.x-ax, y:dr.y-ay, o:dr.o }; if(dr.s) nd.s = dr.s; tpl.doors.push(nd); } });
  (d.props||[]).forEach(pr => { if(pr.x>=ax && pr.x<bx && pr.y>=ay && pr.y<by) tpl.props.push({ t:pr.t, x:pr.x-ax, y:pr.y-ay, r:pr.r||0 }); });
  (d.labels||[]).forEach(l => { if(l.x>=ax && l.x<=bx && l.y>=ay && l.y<=by) tpl.labels.push({ t:l.t, x:l.x-ax, y:l.y-ay }); });
  return tpl;
}
function dkeActiveTpl(){
  if(dkeTplSel === '__clip') return dkeClipTpl;
  const e = DKE_TEMPLATES[dkeTplSel];
  return e ? e.t : null;
}

// ── Deck data helpers ────────────────────────────────────────────────────────
function dkeBlank(){ return { w:24, h:16, floors:[], walls:[], doors:[], props:[], labels:[], links:[], tokens:[] }; }
function dkeNorm(d){
  d.w = Math.max(4, Math.min(DKE_MAXDIM, parseInt(d.w,10) || 24));
  d.h = Math.max(4, Math.min(DKE_MAXDIM, parseInt(d.h,10) || 16));
  // Range-ruler scale (js §Range ruler): metres per cell — Traveller personal
  // scale is 1.5 m/square (CRB 2022 p.73) — and the reference weapon Range (m)
  // the range bands are measured against (default 50 m, referee-editable).
  d.mpc = Math.max(0.1, Math.min(100, parseFloat(d.mpc) || 1.5));
  d.refRange = Math.max(1, Math.min(9999, parseInt(d.refRange,10) || 50));
  ['floors','walls','doors','props','labels','links','tokens'].forEach(k => { if(!Array.isArray(d[k])) d[k] = []; });
  return d;
}
function deckHasContent(d){
  return !!(d && ((d.floors||[]).length || (d.walls||[]).length || (d.doors||[]).length
    || (d.props||[]).length || (d.labels||[]).length || (d.links||[]).length || (d.tokens||[]).length));
}
// ── Multiple decks per station ───────────────────────────────────────────────
// A station-additions entry holds its decks under `.decks` (array) with `.deckIdx`
// = the referee's active deck (synced; players follow it). LEGACY single decks
// live at `.deck`; reads below support both, and the first structural edit
// migrates `.deck` → `.decks[0]` (dkeEnsureDecks) so old maps keep working
// untouched until the referee adds a second deck. Each deck is a full deck object
// (own floors/walls/tokens/fog/scale), so decks are independent and all sync.
function dkeDeckList(s){
  if(!s) return [];
  if(Array.isArray(s.decks)) return s.decks;
  return s.deck ? [s.deck] : [];
}
function dkeDeckIndex(s){
  const n = dkeDeckList(s).length; if(!n) return 0;
  const i = (s && typeof s.deckIdx === 'number') ? s.deckIdx : 0;
  return Math.max(0, Math.min(n - 1, i));
}
function dkeCurrentDeck(s){
  const list = dkeDeckList(s);
  return list.length ? list[dkeDeckIndex(s)] : null;
}
function dkeDeckName(deck, i){ return (deck && deck.name) || ('Deck ' + (i + 1)); }
// Migrate legacy `.deck` → `.decks[]` in place (mutates; caller saves).
function dkeEnsureDecks(s){
  if(!s) return [];
  if(!Array.isArray(s.decks)){
    s.decks = s.deck ? [s.deck] : [];
    delete s.deck;
    if(typeof s.deckIdx !== 'number') s.deckIdx = 0;
  }
  return s.decks;
}
// ── Edit target: a station (default) OR the party ship ───────────────────────
// The editor is the same overlay either way; only the deck HOLDER and its save
// differ. dkeHolder() returns the object whose `.decks` we edit, dkeSave() writes
// it back, dkeAfterChange() refreshes the right surface. The ship deck lives on
// the shared shipState (synced via saveShipState), displayed read-only in Ship
// Status; stations keep syncing through stationAdditions as before.
let dkeTarget = 'station';   // 'station' | 'ship'
function dkeHolder(){
  if(dkeTarget === 'ship') return (typeof shipState !== 'undefined') ? shipState : null;
  return (typeof currentStationId !== 'undefined') ? stationAdditions[currentStationId] : null;
}
function dkeSave(){
  if(dkeTarget === 'ship'){ if(typeof saveShipState === 'function') saveShipState(); }
  else if(typeof saveAuthoredStations === 'function') saveAuthoredStations();
}
function dkeAfterChange(){
  if(dkeTarget === 'ship'){ if(typeof renderShipPanel === 'function') renderShipPanel(); return; }
  if(typeof renderStationMap === 'function') renderStationMap();
  if(typeof updateNodes === 'function') updateNodes();
}
// Current edit target's active deck (editor mutates through here so undo/redo and
// a poll's holder replacement can never leave a stale reference).
function dkeD(){ return dkeCurrentDeck(dkeHolder()); }

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

// ── Initiative tie-in ────────────────────────────────────────────────────────
// Tokens match initiative entries BY NAME (case-insensitive). The referee reads
// the live combatants array (js/45) so the glow works even before sharing; a
// player reads the redacted shared board (playerInit) — the same names their
// Turn Order panel shows, so nothing referee-private reaches the map.
function dkeInitRows(){
  const ref = (typeof isReferee === 'function') && isReferee();
  if(ref && typeof combatants !== 'undefined' && Array.isArray(combatants) && combatants.length){
    return combatants.map((c,i) => ({ name:c.name, down:!!c.down, cur: i === currentTurnIdx, ord: i+1 }));
  }
  if(!ref && typeof playerInit !== 'undefined' && playerInit && playerInit.shared && Array.isArray(playerInit.rows) && playerInit.rows.length){
    return playerInit.rows.map((r,i) => ({ name:r.name, down:!!r.down, cur: playerInit.turnId != null && r.id === playerInit.turnId, ord: i+1 }));
  }
  return null;
}
function dkeInitFor(rows, name){
  if(!rows) return null;
  const k = String(name||'').trim().toLowerCase();
  return rows.find(r => String(r.name||'').trim().toLowerCase() === k) || null;
}
// Nudged by renderInit (js/45) and the player initiative poll (js/55) so token
// overlays track the fight live. Only redraws surfaces actually showing a deck.
function dkeInitChanged(){
  if(dkeIsOpen) dkeRenderContent();
  if(typeof currentView !== 'undefined' && currentView === 'station'
     && typeof currentStationId !== 'undefined' && currentStationId !== 'aurelia'
     && typeof renderStationMap === 'function'){
    renderStationMap();
    if(typeof updateNodes === 'function') updateNodes();
  }
}

// ── Fog of war ───────────────────────────────────────────────────────────────
// Player fog: opaque wash over the room's cells with the grid redrawn on top,
// so the interior (floor tint, props, labels, tokens, marker) vanishes while
// boundary walls and doors stay visible — the hull without the inside.
function dkePlayerFogSVG(cells){
  const d = dkeRoomFillD(cells);
  return `<g style="pointer-events:none"><path d="${d}" fill="#0f1117"/>`
    + `<path d="${d}" fill="none" stroke="#1e2333" stroke-width=".6"/></g>`;
}
// A room link has three referee-set visibility states: 'revealed' (live),
// 'remembered' (players see a frozen last-known snapshot of its NPCs while the
// referee's live moves stay private) and 'hidden' (opaque fog). `mem` holds the
// snapshot; `hid` = opaque fog; neither = revealed. This is visual-only, like the
// existing fog (the live data still syncs — spoiler control, not security).
function dkeFogState(lk){ return (lk && lk.mem) ? 'remembered' : ((lk && lk.hid) ? 'hidden' : 'revealed'); }
// Freeze the tokens standing in a link's room at their current cells.
function dkeSnapshotRoomTokens(deck, lk){
  const room = dkeRoomCells(deck, lk.x, lk.y);
  if(!room) return [];
  const inRoom = new Set(room.map(c => c.x + ',' + c.y));
  return (deck.tokens || []).filter(t => inRoom.has(t.x + ',' + t.y)).map(t => ({ n: t.n, x: t.x, y: t.y }));
}
// A dimmed, dashed "last seen here" ghost token for a remembered snapshot (players).
function dkeMemTokenSVG(m){
  const C = DKE_CELL, eh = dkeEsc, r = 13, cx = (m.x+.5)*C, cy = (m.y+.5)*C;
  return `<g opacity=".5" style="pointer-events:none">`
    + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#10131c" stroke="#7f93b8" stroke-width="2" stroke-dasharray="3,2"/>`
    + `<text x="${cx}" y="${cy+3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="#7f93b8" font-family="system-ui,sans-serif">${eh(dkeTokenInitials(m.n))}</text>`
    + `<text x="${cx}" y="${cy+r+9}" text-anchor="middle" font-size="6.5" font-weight="600" fill="#7f93b8" font-family="system-ui,sans-serif">${eh(m.n)} · last seen</text>`
    + `</g>`;
}
// The referee's reveal toggle — cycles revealed → remembered → hidden.
function dkeFogEyeSVG(cx, cy, li, state){
  let glyph, title;
  if(state === 'hidden'){
    glyph = `<path d="M-6,-1.5 Q0,3.5 6,-1.5" fill="none" stroke="#D4A843" stroke-width="1.3" stroke-linecap="round"/>`
      + `<path d="M-4.2,1.4 l-1.4,2 M0,2.4 v2.4 M4.2,1.4 l1.4,2" stroke="#D4A843" stroke-width="1.1" stroke-linecap="round"/>`;
    title = 'Hidden from players — tap to reveal';
  } else if(state === 'remembered'){
    glyph = `<path d="M-6,0 Q0,-4.6 6,0 Q0,4.6 -6,0 Z" fill="none" stroke="#5b8ef0" stroke-width="1.2"/>`
      + `<circle r="1.7" fill="none" stroke="#5b8ef0" stroke-width="1"/><path d="M0,0 v-1.2 M0,0 h1" stroke="#5b8ef0" stroke-width=".8"/>`;
    title = 'Players see last-known positions — tap to hide fully';
  } else {
    glyph = `<path d="M-6,0 Q0,-4.6 6,0 Q0,4.6 -6,0 Z" fill="none" stroke="#a3a9bf" stroke-width="1.2"/><circle r="1.8" fill="#a3a9bf"/>`;
    title = 'Revealed — tap to freeze last-known positions';
  }
  return `<g transform="translate(${cx},${cy})" style="cursor:pointer" onclick="dkeToggleFog(${li})">`
    + `<title>${title}</title><circle r="9" fill="transparent"/>${glyph}</g>`;
}
function dkeToggleFog(li){
  if(typeof isReferee !== 'function' || !isReferee()) return;
  const deck = dkeMapDeck(); const lk = deck && (deck.links||[])[li]; if(!lk) return;
  const st = dkeFogState(lk);
  if(st === 'revealed'){ lk.mem = dkeSnapshotRoomTokens(deck, lk); delete lk.hid; }   // → remembered (snapshot now)
  else if(st === 'remembered'){ delete lk.mem; lk.hid = 1; }                          // → hidden
  else {                                                                              // → revealed
    delete lk.hid; delete lk.mem;
    if(typeof logEvent === 'function'){ const lbl = dkeLinkLabel(lk.a); logEvent('Referee revealed ' + lbl, dkeStationLabel()); }
  }
  if(typeof saveAuthoredStations === 'function') saveAuthoredStations();
  if(typeof renderStationMap === 'function') renderStationMap();
  if(typeof updateNodes === 'function') updateNodes();
  if(typeof showToast === 'function') showToast('Room ' + dkeFogState(lk));
}
// Referee cycles a door's state straight on the live station view (players see
// the result, can't change it). Closed is stored as no `s` field to keep decks lean.
function dkeCycleDoor(i){
  if(typeof isReferee !== 'function' || !isReferee()) return;
  const deck = dkeMapDeck(); if(!deck || !(deck.doors||[])[i]) return;
  if((deck.doors[i].t || 'door') !== 'door') return;   // windows have no state
  const ns = dkeNextDoorState(deck.doors[i].s);
  if(ns === 'closed') delete deck.doors[i].s; else deck.doors[i].s = ns;
  if(typeof saveAuthoredStations === 'function') saveAuthoredStations();
  if(typeof renderStationMap === 'function') renderStationMap();
  if(typeof updateNodes === 'function') updateNodes();
  if(typeof showToast === 'function') showToast('Door ' + (deck.doors[i].s || 'closed'));
}
// Auto-reveal: when the referee drops a PLAYER-CHARACTER token into a fogged room
// on the station view, the party has entered it, so lift that room's fog. Only
// PCs trigger it (names in the crew roster) — dropping a hidden NPC ambusher must
// NOT give the room away. The referee gets a toast and can re-hide with the eye
// toggle, so nothing reveals silently and they stay in charge (design philosophy:
// the eye toggles keep sight referee-decided; this only saves the manual tap).
function dkeTokenIsPC(name){
  if(typeof crewRoster !== 'function') return false;
  const k = String(name||'').trim().toLowerCase();
  return crewRoster().some(n => String(n||'').trim().toLowerCase() === k);
}
function dkeFogAutoReveal(deck, token){
  if(!deck || !token || !dkeTokenIsPC(token.n)) return false;
  const areas = (typeof stationAreas === 'function') ? stationAreas() : {};
  let revealed = null;
  (deck.links||[]).forEach(lk => {
    if(!lk.hid && !lk.mem) return;   // reveal hidden OR remembered rooms the party re-enters
    const room = dkeRoomCells(deck, lk.x, lk.y);
    if(room && room.some(c => c.x === token.x && c.y === token.y)){
      delete lk.hid; delete lk.mem;
      const a = areas[lk.a];
      revealed = (a && a.label) || lk.a;
    }
  });
  if(revealed){
    if(typeof showToast === 'function') showToast('Revealed ' + revealed + ' to players');
    if(typeof logEvent === 'function') logEvent('Party entered ' + revealed, dkeStationLabel());   // deck moment → event log (js/40)
  }
  return !!revealed;
}
// Small labels for the event log.
function dkeLinkLabel(id){
  const a = (typeof stationAreas === 'function') ? stationAreas()[id] : null;
  return (a && a.label) || id;
}
function dkeStationLabel(){
  return (typeof stationDef === 'function' && stationDef() && stationDef().name) || '';
}

// ── Tokens ───────────────────────────────────────────────────────────────────
const DKE_TOKEN_COLS = ['#5b8ef0','#d4913a','#4caf82','#D4A843','#9B59B6','#2AABB8','#c0506e','#7f93b8'];
// Referee-set token conditions → pip colour (bookkeeping shown on the map, not automated).
const DKE_TOKEN_STATUS = { bloodied:'#c0506e', stunned:'#D4A843', prone:'#5b8ef0' };
const DKE_STATUS_ORDER = ['', 'bloodied', 'stunned', 'prone'];
function dkeTokenColour(name){
  let h = 0; const s = String(name||'');
  for(let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return DKE_TOKEN_COLS[h % DKE_TOKEN_COLS.length];
}
function dkeTokenInitials(name){
  if(typeof portraitInitials === 'function') return portraitInitials(name);
  const parts = String(name||'').trim().split(/\s+/).filter(Boolean);
  return (((parts[0]||'')[0]||'') + ((parts[1]||'')[0]||'')).toUpperCase() || '?';
}
function dkeTokenSVG(t, opt, st, idx){
  const C = DKE_CELL, eh = dkeEsc, r = 13;
  const cx = (t.x+.5)*C, cy = (t.y+.5)*C, col = dkeTokenColour(t.n);
  // Portrait on top of the initials disc: if the character has no uploaded
  // photo the <image> paints nothing (and onerror prunes it), so the initials
  // show through. No portraitVer cache-buster here — a changed photo may stay
  // stale until a reload, which is fine for a map counter.
  const url = (opt.noPortraits || typeof portraitUrlFor !== 'function') ? '' : portraitUrlFor(t.n);
  const down = !!(st && st.down);
  const disc = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#10131c" stroke="${col}" stroke-width="2"/>`
    + `<text x="${cx}" y="${cy+3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="${col}" font-family="system-ui,sans-serif">${eh(dkeTokenInitials(t.n))}</text>`
    + (url ? `<image x="${cx-r}" y="${cy-r}" width="${2*r}" height="${2*r}" href="${eh(url)}" clip-path="url(#${eh(opt.idp||'sta')}-tkclip)" preserveAspectRatio="xMidYMid slice" onerror="this.remove()"/>` : '')
    + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="2"/>`;
  // Initiative overlays: pulsing ring on whose turn it is, order badge for
  // everyone in the tracker, dim + strike when down.
  const pulse = (st && st.cur && !down)
    ? `<circle cx="${cx}" cy="${cy}" r="16" fill="none" stroke="#D4A843" stroke-width="2">`
      + `<animate attributeName="r" values="15;18;15" dur="1.6s" repeatCount="indefinite"/>`
      + `<animate attributeName="stroke-opacity" values=".9;.3;.9" dur="1.6s" repeatCount="indefinite"/></circle>`
    : '';
  const strike = down
    ? `<line x1="${cx-10}" y1="${cy-10}" x2="${cx+10}" y2="${cy+10}" stroke="#d45050" stroke-width="2.5" stroke-linecap="round"/>`
    : '';
  const badge = st
    ? `<circle cx="${cx+10}" cy="${cy-10}" r="6.5" fill="#10131c" stroke="${st.cur ? '#D4A843' : '#7f93b8'}" stroke-width="1.2"/>`
      + `<text x="${cx+10}" y="${cy-7.5}" text-anchor="middle" font-size="7" font-weight="700" fill="${st.cur ? '#D4A843' : '#a3a9bf'}" font-family="system-ui,sans-serif">${st.ord}</text>`
    : '';
  // Referee-set condition pip (bottom-left of the disc).
  const stPip = (t.st && DKE_TOKEN_STATUS[t.st])
    ? `<circle cx="${cx-10}" cy="${cy+10}" r="4.5" fill="${DKE_TOKEN_STATUS[t.st]}" stroke="#0f1117" stroke-width="1.2"><title>${eh(t.st)}</title></circle>`
    : '';
  // Station view: for PLAYERS tokens are tap-transparent so a tap on one still
  // opens the room beneath. For the REFEREE they are grab targets — data-tk
  // marks the group for the map-drag handlers below, and touch-action:none is
  // scoped to the token only, so room taps keep firing their click on iOS
  // (the v33 gotcha: click dies under a broad touch-action:none).
  const refDrag = opt.interactive && typeof isReferee === 'function' && isReferee();
  const gAttrs = opt.interactive
    ? (refDrag ? ` data-tk="${idx}" style="touch-action:none;cursor:grab"` : ' style="pointer-events:none"')
    : '';
  return `<g${gAttrs}><title>${eh(t.n)}</title>`
    + (down ? `<g opacity=".45">${disc}</g>` : disc)
    + pulse + strike + badge + stPip
    + `<text x="${cx}" y="${cy+r+9}" text-anchor="middle" font-size="7.5" font-weight="600" fill="#a3a9bf" font-family="system-ui,sans-serif" style="pointer-events:none">${eh(t.n)}</text>`
    + `</g>`;
}

// ── Shared SVG renderer (editor canvas + read-only station view) ─────────────
// ── Door states ──────────────────────────────────────────────────────────────
// A door's state rides on an optional `s` field ('open' | 'locked'); absent = the
// default closed leaf, so every pre-existing door renders exactly as before and
// no deck migration is needed. The referee cycles state by tapping a door (door
// tool in the editor, or straight on the live station view); players only see it.
const DKE_DOOR_STATES = ['closed', 'open', 'locked'];
function dkeNextDoorState(s){
  return DKE_DOOR_STATES[(DKE_DOOR_STATES.indexOf(s || 'closed') + 1) % DKE_DOOR_STATES.length];
}
// An OPENING sits on a wall edge: `t` = 'door' (default) | 'window', `len` = 1–3
// cells along the edge, doors carry a state `s` ('open'|'locked', absent=closed).
// Door glyph: closed = gold leaf across the gap; open = gold leaf swung
// perpendicular; locked = red leaf + a dark keyhole. Window = pale-blue see-through
// glass with a mullion at each cell. len=1 & no `t` renders exactly like the old door.
function dkeOpeningCovers(op, e){
  if(op.o !== e.o) return false;
  const L = op.len || 1;
  return op.o === 'h' ? (e.y === op.y && e.x >= op.x && e.x < op.x + L)
                      : (e.x === op.x && e.y >= op.y && e.y < op.y + L);
}
function dkeOpeningSVG(op){
  const C = DKE_CELL, L = op.len || 1, type = op.t || 'door', s = op.s || 'closed';
  if(op.o === 'h'){
    const y = op.y*C, x0 = op.x*C;
    const gap = `<line x1="${x0+.12*C}" y1="${y}" x2="${x0+(L-.12)*C}" y2="${y}" stroke="#0f1117" stroke-width="5"/>`;
    if(type === 'window'){
      let m = ''; for(let k = 1; k < L; k++) m += `<line x1="${x0+k*C}" y1="${y-2.5}" x2="${x0+k*C}" y2="${y+2.5}" stroke="#4a8f9c" stroke-width=".8"/>`;
      return gap + `<rect x="${x0+.15*C}" y="${y-2.5}" width="${(L-.3)*C}" height="5" rx="1" fill="#7fd4e0" fill-opacity=".45" stroke="#7fd4e0" stroke-width=".9"/>${m}`;
    }
    if(s === 'open')   return gap + `<rect x="${x0+.12*C-1.5}" y="${y}" width="3" height="${.6*C}" rx="1.5" fill="#D4A843"/>`;
    if(s === 'locked') return gap + `<rect x="${x0+.15*C}" y="${y-3}" width="${(L-.3)*C}" height="6" rx="2" fill="#c0506e"/><circle cx="${x0+L*C/2}" cy="${y}" r="1.6" fill="#0f1117"/>`;
    return gap + `<rect x="${x0+.15*C}" y="${y-3}" width="${(L-.3)*C}" height="6" rx="2" fill="#D4A843"/>`;
  }
  const x = op.x*C, y0 = op.y*C;
  const gap = `<line x1="${x}" y1="${y0+.12*C}" x2="${x}" y2="${y0+(L-.12)*C}" stroke="#0f1117" stroke-width="5"/>`;
  if(type === 'window'){
    let m = ''; for(let k = 1; k < L; k++) m += `<line x1="${x-2.5}" y1="${y0+k*C}" x2="${x+2.5}" y2="${y0+k*C}" stroke="#4a8f9c" stroke-width=".8"/>`;
    return gap + `<rect x="${x-2.5}" y="${y0+.15*C}" width="5" height="${(L-.3)*C}" rx="1" fill="#7fd4e0" fill-opacity=".45" stroke="#7fd4e0" stroke-width=".9"/>${m}`;
  }
  if(s === 'open')   return gap + `<rect x="${x}" y="${y0+.12*C-1.5}" width="${.6*C}" height="3" rx="1.5" fill="#D4A843"/>`;
  if(s === 'locked') return gap + `<rect x="${x-3}" y="${y0+.15*C}" width="6" height="${(L-.3)*C}" rx="2" fill="#c0506e"/><circle cx="${x}" cy="${y0+L*C/2}" r="1.6" fill="#0f1117"/>`;
  return gap + `<rect x="${x-3}" y="${y0+.15*C}" width="6" height="${(L-.3)*C}" rx="2" fill="#D4A843"/>`;
}
// Fat transparent tap target over an opening (the leaf itself is too thin to hit).
function dkeOpeningHitSVG(op){
  const C = DKE_CELL, L = op.len || 1;
  return op.o === 'h'
    ? `<rect x="${(op.x+.1)*C}" y="${op.y*C-7}" width="${(L-.2)*C}" height="14" fill="transparent"/>`
    : `<rect x="${op.x*C-7}" y="${(op.y+.1)*C}" width="14" height="${(L-.2)*C}" fill="transparent"/>`;
}

// Public URL of a deck's floorplan-underlay image (stored in the handouts bucket,
// js/50). '' when the deck has none. Different-origin, so the SW won't cache it —
// offline the <image> just paints nothing and the traced walls/links still show.
function dkeDeckImgUrl(deck){
  if(!deck || !deck.img || !deck.img.id || typeof handoutUrlFor !== 'function') return '';
  const camp = (typeof activeCampaignId !== 'undefined') ? activeCampaignId : 'default';
  return handoutUrlFor(camp, deck.img.id, deck.img.ver);
}
function dkeContentSVG(deck, opt){
  opt = opt || {};
  const C = DKE_CELL, eh = dkeEsc;
  let out = '';
  const L = opt.layers || {};   // editor-only per-layer visibility (all on elsewhere)
  // Floorplan image UNDERLAY (bottom of the stack) — the referee traces walls,
  // doors and links on top. Fit inside the grid box, aspect preserved.
  const imgUrl = L.image === false ? '' : dkeDeckImgUrl(deck);
  if(imgUrl){
    const op = (deck.img && typeof deck.img.op === 'number') ? deck.img.op : 0.55;
    out += `<image href="${eh(imgUrl)}" x="0" y="0" width="${deck.w*C}" height="${deck.h*C}" opacity="${op}" preserveAspectRatio="xMidYMid meet" style="pointer-events:none" onerror="this.remove()"/>`;
  }
  // Floors next, grid over them (Roll20-style), structure on top.
  (deck.floors||[]).forEach(f => {
    out += `<rect x="${f.x*C}" y="${f.y*C}" width="${f.w*C}" height="${f.h*C}" fill="#1a1f2e"/>`;
  });
  if(L.grid !== false){
    let grid = '';
    for(let i = 0; i <= deck.w; i++) grid += `M${i*C},0 V${deck.h*C} `;
    for(let j = 0; j <= deck.h; j++) grid += `M0,${j*C} H${deck.w*C} `;
    out += `<path d="${grid}" stroke="#1e2333" stroke-width="${opt.editor ? .8 : .6}" fill="none"/>`;
  }
  out += `<rect x="0" y="0" width="${deck.w*C}" height="${deck.h*C}" fill="none" stroke="#2e3347" stroke-width="1.4"/>`;
  (deck.walls||[]).forEach(w => {
    out += `<line x1="${w.x1*C}" y1="${w.y1*C}" x2="${w.x2*C}" y2="${w.y2*C}" stroke="#9aa7c7" stroke-width="3" stroke-linecap="square"/>`;
  });
  const refView = !!opt.interactive && (typeof isReferee === 'function') && isReferee();
  let doorCtl = '';   // referee-only door tap targets, appended ABOVE the room taps
  (deck.doors||[]).forEach((d, i) => {
    out += dkeOpeningSVG(d);
    if(refView && (d.t || 'door') === 'door') doorCtl += `<g style="cursor:pointer" onclick="event.stopPropagation();dkeCycleDoor(${i})"><title>Door: ${eh(d.s||'closed')} — tap to cycle</title>${dkeOpeningHitSVG(d)}</g>`;
  });
  (deck.props||[]).forEach(p => {
    const def = DKE_PROPS[p.t]; if(!def) return;
    const f = dkePropFootprint(p), sc = dkePropScaleOf(p);   // s=1 → same transform as before
    const scaleTx = sc !== 1 ? ` scale(${sc})` : '';
    out += `<g transform="translate(${(p.x+f.fw/2)*C},${(p.y+f.fh/2)*C}) rotate(${p.r||0})${scaleTx}"><title>${eh(p.label || def.n)}</title>${def.g}</g>`;
    if(p.label && L.labels !== false) out += `<text x="${(p.x+f.fw/2)*C}" y="${(p.y+f.fh)*C-2}" text-anchor="middle" font-size="7.5" font-weight="600" fill="#a3a9bf" font-family="system-ui,sans-serif" style="pointer-events:none">${eh(p.label)}</text>`;
  });
  if(L.labels !== false) (deck.labels||[]).forEach(l => {
    out += `<text x="${l.x*C}" y="${l.y*C}" text-anchor="middle" font-size="11" font-weight="600" fill="#e8eaf0" font-family="system-ui,sans-serif" letter-spacing=".5" style="pointer-events:none">${eh(l.t)}</text>`;
  });
  const areas = opt.areas || ((typeof stationAreas === 'function') ? stationAreas() : {});
  const seenArea = {};
  const isPlayer = !!opt.interactive && !refView;
  let roomLayer = '', markerLayer = '', fogDim = '', fogPlayer = '';
  (deck.links||[]).forEach((lk, li) => {
    const a = areas[lk.a]; if(!a) return;
    const ac = a.ac || '#7f93b8', cx = (lk.x+.5)*C, cy = (lk.y+.5)*C;
    const open = opt.interactive ? ` style="cursor:pointer" onclick="selArea('${eh(lk.a)}')"` : '';
    const room = dkeRoomCells(deck, lk.x, lk.y);
    const state = dkeFogState(lk);   // 'revealed' | 'remembered' | 'hidden'
    const hid = state === 'hidden';  // remembered rooms render normally; tokens frozen below
    // Fog of war, player side: a hidden link renders NOTHING here — no marker,
    // no name, no tap target — just an opaque fog patch appended after the
    // token layer so it also covers whoever is standing inside.
    if(hid && opt.interactive && !refView){
      if(room) fogPlayer += dkePlayerFogSVG(room);
      return;
    }
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
    // Referee/editor indicators (never shown to players): hidden rooms stay
    // readable under a dim wash; remembered rooms get a blue dashed outline.
    if(room && !isPlayer){
      if(state === 'hidden') fogDim += `<path d="${dkeRoomFillD(room)}" fill="#0f1117" opacity=".55" style="pointer-events:none"/>`;
      else if(state === 'remembered') fogDim += `<path d="${dkeRoomFillD(room)}" fill="#5b8ef0" opacity=".1" style="pointer-events:none"/><path d="${dkeRoomOutlineD(room)}" fill="none" stroke="#5b8ef0" stroke-width="1.5" stroke-dasharray="5,4" opacity=".6" style="pointer-events:none"/>`;
    }
    markerLayer += `<g${open}><circle${(wantId && !room) ? ` id="r-${eh(lk.a)}"` : ''} cx="${cx}" cy="${cy}" r="9" fill="#0f1117" stroke="${eh(ac)}" stroke-width="2"/>`
         + `<circle cx="${cx}" cy="${cy}" r="3" fill="${eh(ac)}"/>`
         + `<text x="${cx}" y="${cy+20}" text-anchor="middle" font-size="9" font-weight="600" fill="${eh(ac)}" font-family="system-ui,sans-serif">${eh(a.label||lk.a)}</text></g>`;
    // Referee reveal toggle — an eye under the marker name on the station view.
    if(refView) markerLayer += dkeFogEyeSVG(cx, cy + 31, li, state);
  });
  // Rooms under markers: a tap anywhere in the room opens the area, but each
  // marker stays individually tappable even inside another marker's room.
  out += roomLayer + fogDim + markerLayer + doorCtl;
  // Remembered rooms (player side): the snapshotted NPCs are FROZEN — hide their
  // live tokens and draw last-known ghosts instead, until the referee re-reveals.
  let frozen = null, memGhosts = '';
  if(isPlayer){
    (deck.links||[]).forEach(lk => {
      if(Array.isArray(lk.mem) && lk.mem.length){
        frozen = frozen || {};
        lk.mem.forEach(m => { frozen[String(m.n||'').trim().toLowerCase()] = m; });
      }
    });
    if(frozen) Object.keys(frozen).forEach(k => { memGhosts += dkeMemTokenSVG(frozen[k]); });
  }
  if((deck.tokens||[]).length || memGhosts){
    // One shared circle clip for every portrait (objectBoundingBox = it fits
    // each <image> wherever it sits). The id is prefixed per surface (opt.idp)
    // because the editor canvas and the station map can be in the DOM at once.
    out += `<defs><clipPath id="${eh(opt.idp||'sta')}-tkclip" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath></defs>`;
    const initRows = dkeInitRows();
    (deck.tokens||[]).forEach((t, i) => {
      if(frozen && frozen[String(t.n||'').trim().toLowerCase()]) return;   // frozen NPC → live token hidden
      out += dkeTokenSVG(t, opt, dkeInitFor(initRows, t.n), i);
    });
    out += memGhosts;
  }
  out += fogPlayer;   // player fog last — it must cover tokens inside hidden rooms
  if(deck.ping){   // referee attention ping — a pulsing "look here" ring for everyone
    const px = (deck.ping.x+.5)*C, py = (deck.ping.y+.5)*C;
    out += `<g style="pointer-events:none"><circle cx="${px}" cy="${py}" r="12" fill="none" stroke="#D4A843" stroke-width="2.5">`
      + `<animate attributeName="r" values="7;20;7" dur="1.2s" repeatCount="indefinite"/>`
      + `<animate attributeName="stroke-opacity" values="1;0;1" dur="1.2s" repeatCount="indefinite"/></circle>`
      + `<circle cx="${px}" cy="${py}" r="2.5" fill="#D4A843"/></g>`;
  }
  if(opt.sel) out += dkeSelHighlightSVG(deck, opt.sel);
  if(opt.group) opt.group.forEach(s => { out += dkeSelHighlightSVG(deck, s); });
  if(opt.editor) out += dkeResizeHandlesSVG(deck);   // drag to resize the grid
  return out;
}
function dkeSelHighlightSVG(deck, sel){
  const C = DKE_CELL, S = 'fill="none" stroke="#D4A843" stroke-width="1.5" stroke-dasharray="4,3"';
  const it = (deck[sel.kind + 's']||[])[sel.i]; if(!it) return '';
  if(sel.kind === 'floor') return `<rect x="${it.x*C}" y="${it.y*C}" width="${it.w*C}" height="${it.h*C}" ${S}/>`;
  if(sel.kind === 'wall')  return `<line x1="${it.x1*C}" y1="${it.y1*C}" x2="${it.x2*C}" y2="${it.y2*C}" stroke="#D4A843" stroke-width="6" opacity=".45"/>`;
  if(sel.kind === 'door'){ const L = it.len || 1; return it.o === 'h'
    ? `<rect x="${it.x*C}" y="${it.y*C-6}" width="${L*C}" height="12" ${S}/>`
    : `<rect x="${it.x*C-6}" y="${it.y*C}" width="12" height="${L*C}" ${S}/>`; }
  if(sel.kind === 'prop'){ const f = dkePropFootprint(it); return `<rect x="${it.x*C+2}" y="${it.y*C+2}" width="${f.fw*C-4}" height="${f.fh*C-4}" rx="3" ${S}/>`; }
  if(sel.kind === 'link')  return `<circle cx="${(it.x+.5)*C}" cy="${(it.y+.5)*C}" r="13" ${S}/>`;
  if(sel.kind === 'token') return `<circle cx="${(it.x+.5)*C}" cy="${(it.y+.5)*C}" r="16" ${S}/>`;
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
  const title = (deck && deck.name) ? `${name} — ${String(deck.name).toUpperCase()}` : `${name} — DECK PLAN`;
  let out = `<text x="0" y="-10" font-size="12" font-weight="700" fill="#e8eaf0" font-family="system-ui,sans-serif" letter-spacing="1">${dkeEsc(title)}</text>`
    + dkeContentSVG(dkeNorm(deck), { interactive:true, idp:'sta' });
  // Range-ruler overlay rides along on every render so it survives poll redraws
  // (the ruler is transient measurement state, never saved into the deck).
  if(dkeMapRuler){
    if(dkeMapRulerState) out += dkeRulerOverlaySVG(deck, dkeMapRulerState.a, dkeMapRulerState.b);
    else if(dkeMapRulerAnchor) out += dkeAnchorDotSVG(dkeMapRulerAnchor);
  }
  if(dkeMapRanges && dkeRangeTokenIdx != null){   // weapon-range bands around a chosen token
    const tk = (deck.tokens || [])[dkeRangeTokenIdx];
    if(tk) out += dkeRangeRingsSVG(deck, tk);
  }
  return out;
}
// Concentric weapon-range band rings (Short/Normal/Long/Extreme) around a token,
// from the deck's reference weapon range + metres-per-cell. Visualisation only.
function dkeRangeRingsSVG(deck, tk){
  const C = DKE_CELL, mpc = dkeDeckMpc(deck), R = dkeDeckRefRange(deck);
  const cx = (tk.x+.5)*C, cy = (tk.y+.5)*C;
  const bands = [[R/4,'Short','#4caf82'],[R,'Normal','#a3a9bf'],[2*R,'Long','#d4913a'],[4*R,'Extreme','#c0506e']];
  let out = `<g style="pointer-events:none">`;
  bands.forEach(b => {
    const r = (b[0] / mpc) * C;
    out += `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="${b[2]}" stroke-width="1.2" stroke-dasharray="5,4" opacity=".5"/>`
      + `<text x="${cx}" y="${(cy - r + 11).toFixed(1)}" text-anchor="middle" font-size="8" font-weight="700" fill="${b[2]}" opacity=".85" font-family="system-ui,sans-serif">${b[1]} · ${Math.round(b[0])}m</text>`;
  });
  return out + `</g>`;
}
// Rasterise the current deck to a JPEG and push it to players as a handout
// (reuses the handouts bucket + list, js/50 & 85). The image underlay and token
// PORTRAITS are excluded so the cross-origin bucket URLs can't taint the canvas.
let dkePushBusy = false;
function dkePushDeckHandout(){
  if(typeof isReferee === 'function' && !isReferee()) return;
  const deck = dkeD();
  if(!deck || !deckHasContent(deck)){ if(typeof showToast === 'function') showToast('Nothing to push yet'); return; }
  if(typeof uploadHandoutBlob !== 'function' || typeof handouts === 'undefined' || typeof saveHandouts !== 'function'){
    if(typeof showToast === 'function') showToast('Handouts are not available here'); return;
  }
  if(dkePushBusy) return;
  dkePushBusy = true; if(typeof showToast === 'function') showToast('Rendering deck…');
  const vb = deckStationViewBox(deck), n = vb.split(' ').map(Number), W = Math.round(n[2]), H = Math.round(n[3]), K = 2;
  const stn = (dkeTarget === 'ship' && typeof shipState !== 'undefined' && shipState.name) ? shipState.name
    : ((typeof stationDef === 'function' && stationDef() && stationDef().name) || 'Deck');
  const label = `${stn} — ${deck.name || 'deck plan'}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${W*K}" height="${H*K}">`
    + `<rect x="${n[0]}" y="${n[1]}" width="${W}" height="${H}" fill="#0c0e14"/>`
    + `<text x="0" y="-10" font-size="12" font-weight="700" fill="#e8eaf0" font-family="system-ui,sans-serif" letter-spacing="1">${dkeEsc(label.toUpperCase())}</text>`
    + dkeContentSVG(dkeNorm(deck), { idp:'push', noPortraits:true, layers:{ image:false } }) + `</svg>`;
  const done = (msg) => { dkePushBusy = false; if(typeof showToast === 'function') showToast(msg); };
  const img = new Image();
  img.onload = () => {
    try {
      const cv = document.createElement('canvas'); cv.width = W*K; cv.height = H*K;
      cv.getContext('2d').drawImage(img, 0, 0, W*K, H*K);
      cv.toBlob(blob => {
        if(!blob){ done('Could not render deck'); return; }
        const id = 'deck_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const camp = (typeof activeCampaignId !== 'undefined') ? activeCampaignId : 'default';
        uploadHandoutBlob(camp, id, blob)
          .then(() => { handouts.push({ id, name: label, ver: Date.now(), visibleTo:'all',
              date: (typeof imperialNow === 'function' && typeof formatImperial === 'function') ? formatImperial(imperialNow()) : '' }); return saveHandouts(); })
          .then(() => { done('Deck pushed to players as a handout');
              if(typeof renderHandoutsPanel === 'function' && typeof handoutsPanelOpen !== 'undefined' && handoutsPanelOpen) renderHandoutsPanel(); })
          .catch(err => { done('Push failed — is the handouts bucket set up? (migration 0004)'); console.error(err); });
      }, 'image/jpeg', 0.9);
    } catch(e){ done('Could not render deck'); console.error(e); }
  };
  img.onerror = () => done('Could not render deck');
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// ── Range ruler (measure two cells → metres + Traveller range band) ──────────
// Distance is straight-line (Euclidean) between the two tapped cell centres,
// scaled by the deck's metres-per-cell (Traveller personal scale = 1.5 m/square).
// Range bands follow the Core Rulebook Update 2022 weapon-relative model,
// measured against the deck's reference weapon Range R (m): Short ≤¼R (DM +1),
// Normal ≤R (0), Long ≤2R (−2), Extreme ≤4R (−4); past 4R is out of range. RAW
// also makes any shot beyond 100 m Extreme without a Scope — flagged as a note.
// This is measurement, not information, so referee AND players get the tool.
function dkeDeckMpc(deck){ const v = parseFloat(deck && deck.mpc); return (v > 0 && isFinite(v)) ? v : 1.5; }
function dkeDeckRefRange(deck){ const v = parseInt(deck && deck.refRange, 10); return (v > 0) ? v : 50; }
function dkeRangeBand(distM, refRange){
  const R = refRange > 0 ? refRange : 50;
  let band, dm;
  if(distM <= R/4){ band = 'Short'; dm = '+1'; }
  else if(distM <= R){ band = 'Normal'; dm = '0'; }
  else if(distM <= 2*R){ band = 'Long'; dm = '−2'; }
  else if(distM <= 4*R){ band = 'Extreme'; dm = '−4'; }
  else return { band:'Out of range', dm:'—', note:'past 4× weapon range' };
  const note = (distM > 100 && band !== 'Extreme') ? '>100 m ⇒ Extreme without a Scope (DM −4)' : '';
  return { band, dm, note };
}
function dkeMeasureParts(deck, a, b){
  const cells = Math.hypot(b.x - a.x, b.y - a.y), m = cells * dkeDeckMpc(deck);
  return { cells, m, mText: (m < 10 ? m.toFixed(1) : Math.round(m).toString()), band: dkeRangeBand(m, dkeDeckRefRange(deck)) };
}
function dkeMeasureText(deck, a, b){
  const p = dkeMeasureParts(deck, a, b);
  return `${p.mText} m · ${p.band.band}${p.band.dm !== '—' ? ` (DM ${p.band.dm})` : ''}${p.band.note ? ' · ' + p.band.note : ''}`;
}
// A small dot marking the pending first cell of a tap-tap measurement.
function dkeAnchorDotSVG(c){
  const C = DKE_CELL, ax = (c.x+.5)*C, ay = (c.y+.5)*C;
  return `<g style="pointer-events:none"><circle cx="${ax}" cy="${ay}" r="4.5" fill="#0f1117" stroke="#D4A843" stroke-width="1.8"/>`
    + `<circle cx="${ax}" cy="${ay}" r="1.6" fill="#D4A843"/></g>`;
}
// Line + endpoint dots + a readout pill; shared by the editor ghost layer and
// the read-only station view (same C-unit coordinate space in both).
function dkeRulerOverlaySVG(deck, a, b){
  const C = DKE_CELL, eh = dkeEsc;
  const ax = (a.x+.5)*C, ay = (a.y+.5)*C, bx = (b.x+.5)*C, by = (b.y+.5)*C;
  const mx = (ax+bx)/2, my = (ay+by)/2;
  const p = dkeMeasureParts(deck, a, b);
  const label = `${p.mText} m · ${p.band.band}${p.band.dm !== '—' ? ` ${p.band.dm}` : ''}`;
  const w = label.length * 5.7 + 14;
  const dot = (x,y) => `<circle cx="${x}" cy="${y}" r="3.6" fill="#0f1117" stroke="#D4A843" stroke-width="1.6"/>`;
  return `<g style="pointer-events:none">`
    + `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#D4A843" stroke-width="1.8" stroke-dasharray="6,4"/>`
    + dot(ax, ay) + dot(bx, by)
    + `<g transform="translate(${mx.toFixed(1)},${(my-13).toFixed(1)})">`
    + `<rect x="${(-w/2).toFixed(1)}" y="-9" width="${w.toFixed(1)}" height="18" rx="4" fill="#0f1117" stroke="#D4A843" stroke-width="1" opacity=".96"/>`
    + `<text x="0" y="4" text-anchor="middle" font-size="10.5" font-weight="700" fill="#D4A843" font-family="system-ui,sans-serif">${eh(label)}</text></g>`
    + (p.band.note ? `<text x="${mx.toFixed(1)}" y="${(my+8).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#c9a24a" font-family="system-ui,sans-serif">${eh(p.band.note)}</text>` : '')
    + `</g>`;
}

// ═══ EDITOR ══════════════════════════════════════════════════════════════════
let dkeIsOpen = false, dkeTool = 'room', dkeSel = null, dkeUndoStack = [], dkeRedoStack = [];
let dkeGroup = [];   // marquee multi-selection: [{kind,i}] of movable items (prop/label/link/token)
function dkeInGroup(hit){ return !!hit && dkeGroup.some(s => s.kind === hit.kind && s.i === hit.i); }
let dkeLayers = { grid:true, image:true, labels:true };   // editor-only layer visibility
function dkeToggleLayer(k){ dkeLayers[k] = dkeLayers[k] === false; dkeRenderTools(); dkeRenderContent(); }
let dkePropType = 'console', dkeLinkArea = '', dkeTokenName = '';
let dkeRuler = null;         // last completed editor measurement {a:{x,y}, b:{x,y}}
let dkeRulerAnchor = null;   // pending first cell for a tap-tap measurement
let dkeTplMode = 'stamp';    // Rooms tool: 'stamp' (place a template) | 'copy' (grab a region)
let dkeTplSel = 'cabin';     // selected template key, or '__clip' for the clipboard
let dkeClipTpl = null;       // template captured by Copy area
let dkeOpenType = 'door';    // Openings tool: 'door' | 'window'
let dkeOpenLen = 1;          // Openings tool: length in cells (1–3)
let dkePropScale = 1;        // Props tool: placement scale (1–3), incl. shuttles
let dkeView = { x:0, y:0, w:100, h:100 };
let dkePoly = null;                 // active wall-run last vertex {x,y}
let dkeGesture = null;              // single-pointer gesture state
const dkePtrs = new Map();          // pointerId → {x,y}
let dkePinch = null;                // last two-pointer metrics {d,mx,my}
let dkeSaveTimer = null, dkeDirty = false;

const DKE_TOOLS = [
  ['pan','✋ Pan'], ['select','➤ Select'], ['room','▭ Room'], ['floor','▦ Floor'],
  ['wall','─ Wall'], ['poly','⟋ Wall run'], ['door','🚪 Openings'], ['prop','📦 Props'],
  ['token','⬤ Tokens'], ['label','🏷 Label'], ['link','⊕ Area link'], ['template','⧉ Rooms'], ['image','🖼 Image'], ['ruler','📏 Range'], ['erase','⌫ Erase']
];
const DKE_HINTS = {
  pan:'Drag to pan · pinch or scroll to zoom.',
  select:'Tap to select · drag a prop/label/link/token to move it · drag a box over empty space to marquee-select several, then drag any of them to move the group (or Delete).',
  room:'Drag a rectangle — floor and perimeter walls are placed in one go.',
  floor:'Drag to paint floor tiles cell by cell.',
  wall:'Drag from corner to corner to place a straight wall (diagonals allowed).',
  poly:'Tap corner after corner to chain walls. Tap the glowing start dot to close the loop into a room, or End the run from the bar above.',
  door:'Pick door or window + a length above, then tap a wall edge to place it. Tap a door to cycle closed → open → locked; tap a window to remove it. Erase or Select+Delete removes doors.',
  prop:'Pick a stamp + a size (1×–3×) above, then tap a cell. Stamps grow right/down from the tap. Tap the same prop again to rotate it; Select → ⤢ Size to resize.',
  token:'Pick a character above (or type any name), then tap to place. Tap a placed token to remove it; Select drags it around.',
  label:'Type the text above, then tap the map to place it.',
  link:'Pick an area above, then tap a room — players tap the marker to open that area.',
  ruler:'Tap two cells (or drag between them) to measure — distance in metres and the range band. Set the scale above.',
  image:'Upload a floorplan to trace over — draw walls, doors and links on top. Adjust opacity above; paint floors only where you want tap-to-open rooms.',
  erase:'Tap or drag over anything to delete it.'
};

function dkeEnsureDom(){
  if(document.getElementById('dke-wrap')) return;
  const w = document.createElement('div');
  w.id = 'dke-wrap';
  w.innerHTML = `
    <div class="dke-hdr">
      <div class="dke-title" id="dke-title">DECK PLAN</div>
      <label class="dke-dim">W <input id="dke-w" type="number" min="4" max="96"></label>
      <label class="dke-dim">H <input id="dke-h" type="number" min="4" max="96"></label>
      <label class="dke-dim" title="Scale the drawn content when you resize the grid"><input id="dke-scale" type="checkbox" style="width:auto"> ⤢ scale</label>
      <button class="hx-act-btn" style="flex:0 0 auto" id="dke-undo" title="Undo (Ctrl+Z)">↶</button>
      <button class="hx-act-btn" style="flex:0 0 auto" id="dke-redo" title="Redo (Ctrl+Shift+Z)">↷</button>
      <button class="hx-act-btn" style="flex:0 0 auto" id="dke-fit" title="Fit deck to view">⊙</button>
      <button class="hx-act-btn" style="flex:0 0 auto" id="dke-push" title="Push this deck to players as a handout">📤</button>
      <button class="hx-act-btn primary" style="flex:0 0 auto" id="dke-done">✓ Done</button>
    </div>
    <div class="dke-decks" id="dke-decks"></div>
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
  document.getElementById('dke-redo').addEventListener('click', dkeRedoPop);
  document.getElementById('dke-fit').addEventListener('click', function(){ dkeFitView(); dkeApplyView(); });
  document.getElementById('dke-push').addEventListener('click', dkePushDeckHandout);
  document.getElementById('dke-done').addEventListener('click', dkeClose);
  document.getElementById('dke-w').addEventListener('change', function(){ dkeResize('w', this.value); });
  document.getElementById('dke-h').addEventListener('change', function(){ dkeResize('h', this.value); });
  document.getElementById('dke-scale').addEventListener('change', function(){ dkeScaleContent = this.checked; });
  window.addEventListener('resize', () => { if(dkeIsOpen) dkeApplyView(); });
  document.addEventListener('keydown', dkeKeyDown);
}

// Shared editor bring-up once the holder is resolved (station or ship).
function dkeBeginEdit(holder, titleName){
  const decks = dkeEnsureDecks(holder);
  if(!decks.length){ decks.push(dkeBlank()); holder.deckIdx = 0; }
  const d = dkeCurrentDeck(holder);
  dkeNorm(d);
  dkeEnsureDom();
  dkeIsOpen = true; dkeTool = deckHasContent(d) ? 'select' : 'room';
  dkeSel = null; dkeGroup = []; dkePoly = null; dkeGesture = null; dkeUndoStack = []; dkeRedoStack = []; dkePtrs.clear(); dkePinch = null;
  document.getElementById('dke-wrap').classList.add('open');
  document.getElementById('dke-title').textContent = (String(titleName || 'STATION').toUpperCase()) + ' — DECK PLAN';
  document.getElementById('dke-w').value = d.w;
  document.getElementById('dke-h').value = d.h;
  const scEl = document.getElementById('dke-scale'); if(scEl) scEl.checked = dkeScaleContent;
  dkeFitView();
  dkeRenderAll();
}
function dkeOpen(){
  if(typeof isReferee === 'function' && !isReferee()) return;
  if(typeof currentStationId === 'undefined') return;
  dkeTarget = 'station';
  // The built-in Aurelia station has no stationAdditions entry (its areas come from
  // MAIN), so seed a deck-only holder for it — that lets the canon station carry a
  // drawable deck like authored stations, overriding the hand-drawn map once drawn.
  let s = stationAdditions[currentStationId];
  if(!s){ if(currentStationId === 'aurelia'){ s = stationAdditions['aurelia'] = {}; } else { return; } }
  const stnName = (typeof stationDef === 'function' && stationDef() && stationDef().name) || s.name || 'STATION';
  dkeBeginEdit(s, stnName);
}
function dkeOpenShip(){
  if(typeof isReferee === 'function' && !isReferee()) return;
  if(typeof shipState === 'undefined') return;
  dkeTarget = 'ship';
  dkeBeginEdit(shipState, shipState.name || 'SHIP');
}
function dkeClose(){
  if(!dkeIsOpen) return;
  dkeIsOpen = false; dkePoly = null; dkeGesture = null; dkePtrs.clear(); dkePinch = null;
  const w = document.getElementById('dke-wrap'); if(w) w.classList.remove('open');
  dkeFlushSave();
  const wasShip = dkeTarget === 'ship';
  dkeAfterChange();
  if(!wasShip && typeof renderDesignPanel === 'function') renderDesignPanel();
  dkeTarget = 'station';   // reset to the default target after closing
}
function dkeRemove(){
  if(typeof isReferee === 'function' && !isReferee()) return;
  const s = dkeHolder(); if(!s) return;
  const decks = dkeDeckList(s); if(!decks.length) return;
  const multi = decks.length > 1;
  if(!confirm(multi ? 'Remove this deck? Other decks stay.' : 'Remove this deck plan? The map goes back to the automatic layout.')) return;
  dkeEnsureDecks(s);
  s.decks.splice(dkeDeckIndex(s), 1);
  s.deckIdx = Math.max(0, Math.min(s.decks.length - 1, dkeDeckIndex(s)));
  if(!s.decks.length){ delete s.decks; delete s.deckIdx; }
  dkeUndoStack = []; dkeRedoStack = [];
  dkeSave();
  if(dkeIsOpen){ if(dkeDeckList(s).length){ dkeSel = null; dkeFitView(); dkeRenderAll(); dkeRenderDecks(); } else { dkeClose(); } }
  dkeAfterChange();
  if(dkeTarget === 'station' && typeof renderDesignPanel === 'function') renderDesignPanel();
}
// Design Studio row (called from designStationViewHTML in js/40-station.js).
// Explicitly the STATION deck (dkeD() follows dkeTarget, which may be 'ship').
function dkeStudioRowHTML(){
  const sd = (typeof currentStationId !== 'undefined') ? dkeCurrentDeck(stationAdditions[currentStationId]) : null;
  const has = !!sd;
  return `<div class="hx-edit-row"><span>Deck plan</span><div style="flex:1;display:flex;gap:6px">
    <button class="hx-act-btn primary" onclick="dkeOpen()">🗺 ${has ? 'Edit' : 'Draw'} deck plan</button>
    ${has ? `<button class="hx-act-btn" style="flex:0 0 auto;border-color:#c0506e;color:#ff9bb6" onclick="dkeRemove()" title="Remove deck plan">🗑</button>` : ''}
  </div></div>`;
}

// ── Ship deck plan (rendered into the Ship Status panel; edited via dkeOpenShip) ─
// Read-only, NON-interactive render (own idp so its token clip-path can't collide
// with the station map's). The referee authors it in the same editor overlay.
// Ship-deck area links target SHIP SYSTEMS (from js/75) rather than station areas,
// so a room can be tagged Bridge / Engineering / etc.
function dkeShipSystemAreas(){
  if(typeof SHIP_CRIT_SYSTEMS === 'undefined') return {};
  const out = {};
  SHIP_CRIT_SYSTEMS.forEach(kv => { out[kv[0]] = { label: kv[1], ac: '#7f93b8' }; });
  return out;
}
function dkeShipDeckSVG(deck){
  const nm = (typeof shipState !== 'undefined' && shipState.name) ? String(shipState.name).toUpperCase() : 'SHIP';
  const title = (deck && deck.name) ? `${nm} — ${String(deck.name).toUpperCase()}` : `${nm} — DECK PLAN`;
  const sysAreas = dkeShipSystemAreas();
  let out = `<text x="0" y="-10" font-size="12" font-weight="700" fill="#e8eaf0" font-family="system-ui,sans-serif" letter-spacing="1">${dkeEsc(title)}</text>`
    + dkeContentSVG(dkeNorm(deck), { idp:'ship', areas: sysAreas });
  // Live damage map: tint a room whose linked ship system has taken crit hits.
  const crits = (typeof shipState !== 'undefined' && shipState.crits) ? shipState.crits : null;
  if(crits) (deck.links||[]).forEach(lk => {
    const sev = Number(crits[lk.a]) || 0; if(sev <= 0 || !sysAreas[lk.a]) return;
    const room = dkeRoomCells(deck, lk.x, lk.y); if(!room) return;
    const col = sev >= 3 ? '#c0506e' : '#D4A843';
    out += `<path d="${dkeRoomFillD(room)}" fill="${col}" opacity="${sev >= 3 ? .28 : .16}" style="pointer-events:none"/>`;
  });
  // Cargo manifest: a room linked to the Cargo system shows the ship's live lot count + tonnage.
  if(typeof tradeCargo !== 'undefined' && tradeCargo && Array.isArray(tradeCargo.lots)){
    const lots = tradeCargo.lots, tons = lots.reduce((s, l) => s + (Number(l.tons) || 0), 0);
    (deck.links||[]).forEach(lk => {
      if(lk.a !== 'cargo') return;
      out += `<text x="${(lk.x+.5)*DKE_CELL}" y="${(lk.y+.5)*DKE_CELL+31}" text-anchor="middle" font-size="7.5" font-weight="600" fill="#4caf82" font-family="system-ui,sans-serif" style="pointer-events:none">${lots.length} lot${lots.length===1?'':'s'} · ${tons} t</text>`;
    });
  }
  if(dkeShipRuler){   // range-ruler overlay rides along on every ship-panel render
    if(dkeShipRulerState) out += dkeRulerOverlaySVG(deck, dkeShipRulerState.a, dkeShipRulerState.b);
    else if(dkeShipRulerAnchor) out += dkeAnchorDotSVG(dkeShipRulerAnchor);
  }
  return out;
}
// Ship Status section (called from renderShipPanel in js/75-ship.js).
function dkeShipStudioRowHTML(){
  const ref = (typeof isReferee === 'function') && isReferee();
  const deck = (typeof shipState !== 'undefined') ? dkeCurrentDeck(shipState) : null;
  const has = deck && deckHasContent(deck);
  let inner = '';
  if(has){
    inner += `<button class="cbt-btn${dkeShipRuler?' on':''}" style="margin-bottom:6px;padding:5px 10px" onclick="dkeShipToggleRuler()">📏 Range ruler</button>`
      + `<svg id="ship-deck-svg" viewBox="${deckStationViewBox(deck)}" style="width:100%;height:auto;max-height:60vh;display:block${dkeShipRuler?';touch-action:none':''}">${dkeShipDeckSVG(deck)}</svg>`;
  }
  if(ref){   // players with no deck see nothing (no empty section clutter)
    inner += `<button class="cbt-btn" style="width:100%;margin-top:${has ? '8px' : '0'}" onclick="dkeOpenShip()">🗺 ${has ? 'Edit' : 'Draw'} ship deck plan</button>`;
  }
  if(!inner) return '';
  return `<div class="sf-sec"><div class="sf-tab">Deck Plan</div><div class="sf-card">${inner}</div></div>`;
}
// ── Ship-deck range ruler (measurement, so referee AND players) ───────────────
// The ship deck renders read-only in Ship Status; a toggle turns the whole SVG
// into a two-tap tape measure. Handlers are delegated on the stable #ship-body so
// they survive renderShipPanel's innerHTML rebuilds; the overlay rides on the SVG.
let dkeShipRuler = false, dkeShipRulerState = null, dkeShipRulerAnchor = null, dkeShipRulerG = null;
function dkeShipToggleRuler(){
  dkeShipRuler = !dkeShipRuler;
  if(!dkeShipRuler){ dkeShipRulerState = null; dkeShipRulerAnchor = null; dkeShipRulerG = null; }
  if(typeof renderShipPanel === 'function') renderShipPanel();
}
function dkeShipDeck(){
  const deck = (typeof shipState !== 'undefined') ? dkeCurrentDeck(shipState) : null;
  return (deck && deckHasContent(deck)) ? deck : null;
}
function dkeShipRulerPt(ev){
  const svg = document.getElementById('ship-deck-svg');
  const m = svg && svg.getScreenCTM(); if(!m) return null;
  const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}
function dkeShipCellAt(deck, p){
  return { x: Math.max(0, Math.min(deck.w - 1, Math.floor(p.x / DKE_CELL))),
           y: Math.max(0, Math.min(deck.h - 1, Math.floor(p.y / DKE_CELL))) };
}
function dkeShipRulerDown(ev){
  if(!dkeShipRuler) return;
  if(!(ev.target && ev.target.closest && ev.target.closest('#ship-deck-svg'))) return;
  const deck = dkeShipDeck(), p = dkeShipRulerPt(ev); if(!deck || !p) return;
  dkeShipRulerG = { a: dkeShipCellAt(deck, p), sx: ev.clientX, sy: ev.clientY, moved:false };
  const svg = document.getElementById('ship-deck-svg');
  try { svg.setPointerCapture(ev.pointerId); } catch(e){}
  ev.preventDefault();
}
function dkeShipRulerMove(ev){
  const g = dkeShipRulerG; if(!g) return;
  if(!g.moved && Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) < 5) return;
  g.moved = true; ev.preventDefault();
  const deck = dkeShipDeck(), p = dkeShipRulerPt(ev); if(!deck || !p) return;
  g.b = dkeShipCellAt(deck, p);
  const svg = document.getElementById('ship-deck-svg');
  if(svg){ const old = svg.querySelector('#ship-ruler-live'); if(old) old.remove();
    svg.insertAdjacentHTML('beforeend', `<g id="ship-ruler-live">${dkeRulerOverlaySVG(deck, g.a, g.b)}</g>`); }
}
function dkeShipRulerUp(ev){
  const g = dkeShipRulerG; if(!g) return;
  dkeShipRulerG = null;
  const deck = dkeShipDeck(); if(!deck) return;
  const p = dkeShipRulerPt(ev);
  if(g.moved && p){ dkeShipRulerState = { a: g.a, b: dkeShipCellAt(deck, p) }; dkeShipRulerAnchor = null; }
  else if(!g.moved){
    if(!dkeShipRulerAnchor){ dkeShipRulerAnchor = g.a; dkeShipRulerState = null; }
    else { dkeShipRulerState = { a: dkeShipRulerAnchor, b: g.a }; dkeShipRulerAnchor = null; }
  }
  if(typeof renderShipPanel === 'function') renderShipPanel();
}
(function dkeShipRulerInit(){
  const body = document.getElementById('ship-body');
  if(!body) return;
  body.addEventListener('pointerdown', dkeShipRulerDown);
  body.addEventListener('pointermove', dkeShipRulerMove);
  body.addEventListener('pointerup', dkeShipRulerUp);
  body.addEventListener('pointercancel', dkeShipRulerUp);
})();

// ── Deck switcher (editor: add / rename / delete / switch the active deck) ────
function dkeRenderDecks(){
  const el = document.getElementById('dke-decks'); if(!el) return;
  const s = dkeHolder();
  const decks = dkeDeckList(s), cur = dkeDeckIndex(s);
  el.innerHTML = decks.map((dk, i) =>
    `<button class="dke-deck${i===cur?' on':''}" onclick="dkeSwitchDeck(${i})">${dkeEsc(dkeDeckName(dk, i))}</button>`).join('')
    + `<button class="dke-deck dke-deck-add" onclick="dkeAddDeck()" title="Add a deck">＋ Deck</button>`
    + `<button class="dke-deck" onclick="dkeRenameDeck(${cur})" title="Rename this deck">✎</button>`
    + `<button class="dke-deck" onclick="dkeExportDeck()" title="Copy this deck as JSON">⤓</button>`
    + `<button class="dke-deck" onclick="dkeImportDeck()" title="Import a deck from JSON">⤒</button>`
    + (decks.length > 1 ? `<button class="dke-deck dke-danger" onclick="dkeRemove()" title="Remove this deck">🗑</button>` : '');
}
// Export the active deck to the clipboard as JSON (fallback: a copyable prompt).
function dkeExportDeck(){
  const d = dkeD(); if(!d) return;
  const json = JSON.stringify(d);
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(json)
      .then(() => { if(typeof showToast === 'function') showToast('Deck JSON copied to clipboard'); })
      .catch(() => { if(typeof prompt === 'function') prompt('Copy this deck JSON:', json); });
  } else if(typeof prompt === 'function') prompt('Copy this deck JSON:', json);
}
// Import a pasted deck as a NEW deck on the current holder (never overwrites).
function dkeImportDeck(){
  const s = dkeHolder(); if(!s) return;
  const json = (typeof prompt === 'function') ? prompt('Paste deck JSON to import as a new deck:') : null;
  if(!json) return;
  let nd; try { nd = JSON.parse(json); } catch(e){ if(typeof showToast === 'function') showToast('Invalid deck JSON'); return; }
  if(!nd || typeof nd !== 'object' || (!('w' in nd) && !Array.isArray(nd.floors))){ if(typeof showToast === 'function') showToast('That does not look like a deck'); return; }
  dkeNorm(nd);
  const decks = dkeEnsureDecks(s);
  if(!nd.name) nd.name = 'Deck ' + (decks.length + 1);
  decks.push(nd);
  dkeSwitchDeck(decks.length - 1);
  if(typeof showToast === 'function') showToast('Deck imported');
}
function dkeSwitchDeck(i){
  const s = dkeHolder(); if(!s) return;
  dkeFlushSave();
  const decks = dkeEnsureDecks(s);
  s.deckIdx = Math.max(0, Math.min(decks.length - 1, i));
  dkeSel = null; dkeGroup = []; dkePoly = null; dkeUndoStack = []; dkeRedoStack = [];   // undo is per-deck
  const d = dkeCurrentDeck(s); if(d){ dkeNorm(d);
    const wEl = document.getElementById('dke-w'), hEl = document.getElementById('dke-h');
    if(wEl) wEl.value = d.w; if(hEl) hEl.value = d.h;
  }
  dkeSave();   // deckIdx syncs
  dkeFitView(); dkeRenderAll(); dkeRenderDecks();
}
function dkeAddDeck(){
  const s = dkeHolder(); if(!s) return;
  const decks = dkeEnsureDecks(s);
  const nd = dkeBlank(); nd.name = 'Deck ' + (decks.length + 1);
  decks.push(nd);
  dkeSwitchDeck(decks.length - 1);   // jump to the new deck
}
function dkeRenameDeck(i){
  const s = dkeHolder(); const decks = dkeDeckList(s); if(!decks[i]) return;
  const name = (typeof prompt === 'function') ? prompt('Deck name:', dkeDeckName(decks[i], i)) : null;
  if(name == null) return;
  dkeEnsureDecks(s);
  s.decks[i].name = String(name).trim().slice(0, 24) || ('Deck ' + (i + 1));
  dkeSave();
  dkeRenderDecks();
  dkeAfterChange();
}

// ── Rendering ────────────────────────────────────────────────────────────────
function dkeRenderAll(){ dkeRenderContent(); dkeRenderTools(); dkeRenderSub(); dkeRenderHint(); dkeRenderDecks(); dkeApplyView(); }
function dkeRenderContent(){
  const d = dkeD(), g = document.getElementById('dke-content');
  if(g) g.innerHTML = d ? dkeContentSVG(d, { editor:true, sel:dkeSel, group: dkeGroup, idp:'dke', layers: dkeLayers, areas: dkeTarget === 'ship' ? dkeShipSystemAreas() : undefined }) : '';
}
function dkeGhost(markup){
  const g = document.getElementById('dke-ghost'); if(g) g.innerHTML = markup || '';
}
// Tools grouped into labelled rows so the (bigger) toolbar stays scannable.
const DKE_TOOL_GROUPS = [
  ['Edit',     ['pan','select','erase']],
  ['Draw',     ['room','floor','wall','poly']],
  ['Build',    ['door','prop','template','image']],
  ['Annotate', ['label','link','token','ruler']]
];
function dkeRenderTools(){
  const el = document.getElementById('dke-tools'); if(!el) return;
  const lbl = {}; DKE_TOOLS.forEach(([k, l]) => { lbl[k] = l; });
  el.innerHTML = DKE_TOOL_GROUPS.map(([name, keys]) =>
    `<div class="dke-tgroup"><span class="dke-tglabel">${name}</span>`
    + keys.map(k => `<button class="dke-tool${dkeTool===k?' on':''}" onclick="dkeSetTool('${k}')">${lbl[k] || k}</button>`).join('')
    + `</div>`).join('')
    + `<div class="dke-tgroup"><span class="dke-tglabel">View</span>`
    + [['grid','▦ Grid'],['image','🖼 Image'],['labels','🏷 Labels']].map(([k, g]) =>
        `<button class="dke-tool${dkeLayers[k]!==false?' on':''}" onclick="dkeToggleLayer('${k}')" title="Show/hide ${k}">${g}</button>`).join('')
    + `</div>`;
}
function dkeSetTool(t){
  dkeTool = t;
  if(t !== 'poly') dkePolyEnd(true);
  if(t !== 'ruler'){ dkeRuler = null; dkeRulerAnchor = null; dkeGhost(''); }
  if(t !== 'select'){ dkeSel = null; dkeGroup = []; dkeRenderContent(); }
  dkeRenderTools(); dkeRenderSub(); dkeRenderHint();
}
// Editor ruler overlay + readout for the current state (measurement / pending
// anchor / idle). Overlay lives in the ghost layer so content re-renders keep it.
function dkeRulerRedraw(){
  const d = dkeD(), out = document.getElementById('dke-ruler-out');
  if(dkeRuler && d){
    dkeGhost(dkeRulerOverlaySVG(d, dkeRuler.a, dkeRuler.b));
    if(out) out.textContent = '📏 ' + dkeMeasureText(d, dkeRuler.a, dkeRuler.b);
  } else if(dkeRulerAnchor){
    dkeGhost(dkeAnchorDotSVG(dkeRulerAnchor));
    if(out) out.textContent = '📏 tap the second cell…';
  } else {
    dkeGhost('');
    if(out) out.textContent = '📏 tap two cells';
  }
}
function dkeSetDeckScale(key, val){
  const d = dkeD(); if(!d) return;
  dkeSnapshot();
  if(key === 'mpc'){ d.mpc = Math.max(0.1, Math.min(100, parseFloat(val) || 1.5)); const el = document.getElementById('dke-mpc'); if(el) el.value = d.mpc; }
  else { d.refRange = Math.max(1, Math.min(9999, parseInt(val,10) || 50)); const el = document.getElementById('dke-refrange'); if(el) el.value = d.refRange; }
  dkeCommit();
  dkeRulerRedraw();
}
// ── Floorplan image underlay (reuses the handouts bucket + resizer, js/50 & 85) ─
let dkeImgBusy = false;
function dkeUploadDeckImage(input){
  if(typeof isReferee === 'function' && !isReferee()) return;
  const file = input && input.files && input.files[0];
  if(input) input.value = '';
  if(!file) return;
  if(typeof resizeHandoutImage !== 'function' || typeof uploadHandoutBlob !== 'function'){
    if(typeof showToast === 'function') showToast('Image upload unavailable here'); return;
  }
  if(file.type && !/^image\/(jpeg|png|webp)$/.test(file.type)){ if(typeof showToast === 'function') showToast('Choose a JPG/PNG/WebP image'); return; }
  if(file.size > 20 * 1024 * 1024){ if(typeof showToast === 'function') showToast('Image too large (max 20 MB source)'); return; }
  const d = dkeD(); if(!d || dkeImgBusy) return;
  dkeImgBusy = true; if(typeof showToast === 'function') showToast('Preparing floorplan…');
  const id = (d.img && d.img.id) || ('dkimg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const camp = (typeof activeCampaignId !== 'undefined') ? activeCampaignId : 'default';
  resizeHandoutImage(file, 1600)
    .then(blob => uploadHandoutBlob(camp, id, blob))
    .then(() => {
      dkeSnapshot();
      d.img = { id, ver: Date.now(), op: (d.img && typeof d.img.op === 'number') ? d.img.op : 0.55 };
      dkeCommit(); dkeRenderSub();
      if(typeof showToast === 'function') showToast('Floorplan added — trace walls on top');
    })
    .catch(err => { if(typeof showToast === 'function') showToast('Upload failed — is the handouts bucket set up? (migration 0004)'); console.error(err); })
    .finally(() => { dkeImgBusy = false; });
}
function dkeSetDeckImgOpacity(v){
  const d = dkeD(); if(!d || !d.img) return;
  d.img.op = Math.max(0.05, Math.min(1, parseFloat(v) || 0.55));
  dkeCommit();   // re-render + debounced save
}
function dkeRemoveDeckImage(){
  const d = dkeD(); if(!d || !d.img) return;
  dkeSnapshot();
  delete d.img;   // the bucket object is left as a harmless orphan (like handouts)
  dkeCommit(); dkeRenderSub();
}
function dkeRenderHint(){
  const el = document.getElementById('dke-hint');
  if(!el) return;
  if(dkeTool === 'template'){
    el.textContent = dkeTplMode === 'copy'
      ? 'Drag a box over the map to copy that area — it becomes a stamp you can paste.'
      : 'Tap to stamp the selected room (grows right/down from the tap). Copy area duplicates part of the map.';
    return;
  }
  el.textContent = DKE_HINTS[dkeTool] || '';
}
function dkeTplPick(key){ dkeTplSel = key; dkeTplMode = 'stamp'; dkeGhost(''); dkeRenderSub(); dkeRenderHint(); }
function dkeTplCopyMode(){ dkeTplMode = 'copy'; dkeGhost(''); dkeRenderSub(); dkeRenderHint(); }
function dkeRenderSub(){
  const el = document.getElementById('dke-sub'); if(!el) return;
  const eh = dkeEsc;
  let html = '';
  if(dkeTool === 'door'){
    const ty = (k, l) => `<button class="dke-tool${dkeOpenType===k?' on':''}" onclick="dkeOpenType='${k}';dkeRenderSub()">${l}</button>`;
    const ln = n => `<button class="dke-tool${dkeOpenLen===n?' on':''}" onclick="dkeOpenLen=${n};dkeRenderSub()">${n}</button>`;
    html = ty('door','🚪 Door') + ty('window','⊟ Window')
      + `<span class="dke-note" style="margin:0 2px 0 8px">length</span>` + ln(1) + ln(2) + ln(3);
  } else if(dkeTool === 'prop'){
    html = Object.keys(DKE_PROPS).map(k => {
      const dp = DKE_PROPS[k], gw = dp.w || 1, gh = dp.h || 1, m = Math.max(gw, gh), half = m * 16;
      const size = (gw > 1 || gh > 1) ? ` <span style="opacity:.55">${gw}×${gh}</span>` : '';
      return `<button class="dke-tool${dkePropType===k?' on':''}" onclick="dkePropType='${k}';dkeRenderSub()" title="${eh(dp.n)}">`
        + `<svg viewBox="${-half} ${-half} ${m*32} ${m*32}" width="20" height="20" style="vertical-align:middle">${dp.g}</svg> ${eh(dp.n)}${size}</button>`;
    }).join('')
      + `<span class="dke-note" style="margin:0 2px 0 8px">size</span>`
      + [1,2,3].map(n => `<button class="dke-tool${dkePropScale===n?' on':''}" onclick="dkePropScale=${n};dkeRenderSub()">${n}×</button>`).join('');
  } else if(dkeTool === 'token'){
    const crew = (typeof crewRoster === 'function') ? crewRoster() : [];
    if(!dkeTokenName && crew.length) dkeTokenName = crew[0];
    html = crew.map(n => {
      const col = dkeTokenColour(n);
      return `<button class="dke-tool${dkeTokenName===n?' on':''}" onclick="dkeTokenName='${eh(n)}';dkeRenderSub()">`
        + `<span class="dke-tk-chip" style="border-color:${col};color:${col}">${eh(dkeTokenInitials(n))}</span> ${eh(n)}</button>`;
    }).join('')
    + `<input class="hx-edit-in" id="dke-token-custom" placeholder="Or any name — Vey, Pirate 1…" style="max-width:200px">`;
  } else if(dkeTool === 'label'){
    html = `<input class="hx-edit-in" id="dke-label-text" placeholder="Label text — then tap the map…" style="max-width:260px">`;
  } else if(dkeTool === 'link'){
    // On a ship deck, link rooms to SHIP SYSTEMS (they tint by damage); on a
    // station deck, to its Design-Studio areas (tap opens the area).
    const ship = dkeTarget === 'ship';
    const areas = ship ? dkeShipSystemAreas() : ((typeof stationAreas === 'function') ? stationAreas() : {});
    const ids = Object.keys(areas);
    html = ids.length
      ? `<span class="dke-note" style="margin-right:4px">${ship ? 'system' : 'area'}</span><select class="hx-edit-in" style="max-width:240px" onchange="dkeLinkArea=this.value">`
        + `<option value="">— pick ${ship ? 'a system' : 'an area'} —</option>`
        + ids.map(id => `<option value="${eh(id)}"${dkeLinkArea===id?' selected':''}>${eh(areas[id].label||id)}</option>`).join('')
        + `</select>`
      : `<span class="dke-note">No areas yet — add areas in the Design Studio first.</span>`;
  } else if(dkeTool === 'ruler'){
    const d = dkeD();
    const mpc = d ? dkeDeckMpc(d) : 1.5, rr = d ? dkeDeckRefRange(d) : 50;
    const readout = (dkeRuler && d) ? dkeMeasureText(d, dkeRuler.a, dkeRuler.b) : (dkeRulerAnchor ? 'tap the second cell…' : 'tap two cells');
    html = `<label class="dke-dim">m/cell <input id="dke-mpc" type="number" min="0.1" max="100" step="0.1" value="${mpc}" style="width:60px"></label>`
      + `<label class="dke-dim">weapon range m <input id="dke-refrange" type="number" min="1" max="9999" step="1" value="${rr}" style="width:64px"></label>`
      + `<span class="dke-note" id="dke-ruler-out">📏 ${eh(readout)}</span>`;
  } else if(dkeTool === 'template'){
    const stampOn = k => dkeTplMode === 'stamp' && dkeTplSel === k;
    html = Object.keys(DKE_TEMPLATES).map(k =>
      `<button class="dke-tool${stampOn(k)?' on':''}" onclick="dkeTplPick('${k}')">${eh(DKE_TEMPLATES[k].n)}</button>`).join('')
      + (dkeClipTpl ? `<button class="dke-tool${stampOn('__clip')?' on':''}" onclick="dkeTplPick('__clip')">📋 Paste ${dkeClipTpl.w}×${dkeClipTpl.h}</button>` : '')
      + `<button class="dke-tool${dkeTplMode==='copy'?' on':''}" onclick="dkeTplCopyMode()">▭ Copy area</button>`;
  } else if(dkeTool === 'image'){
    const d = dkeD(), hasImg = !!(d && d.img && d.img.id);
    const op = (d && d.img && typeof d.img.op === 'number') ? d.img.op : 0.55;
    html = `<label class="dke-tool" style="cursor:pointer">⬆ ${hasImg ? 'Replace' : 'Upload'} floorplan<input type="file" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="dkeUploadDeckImage(this)"></label>`;
    if(hasImg){
      html += `<label class="dke-dim">opacity <input type="range" min="0.05" max="1" step="0.05" value="${op}" oninput="dkeSetDeckImgOpacity(this.value)" style="width:90px"></label>`
        + `<button class="dke-tool dke-danger" onclick="dkeRemoveDeckImage()">🗑 Remove image</button>`;
    }
  } else if(dkeTool === 'poly' && dkePoly){
    html = `<button class="dke-tool on" onclick="dkePolyEnd()">✓ End wall run</button>`;
  } else if(dkeTool === 'select' && dkeGroup.length){
    html = `<span class="dke-note">${dkeGroup.length} selected — drag to move</span><button class="dke-tool" onclick="dkeDuplicate()">⧉ Duplicate</button><button class="dke-tool dke-danger" onclick="dkeDeleteGroup()">🗑 Delete all</button>`;
  } else if(dkeTool === 'select' && dkeSel){
    const d = dkeD(), it = d ? (d[dkeSel.kind+'s']||[])[dkeSel.i] : null;
    if(it){
      if(dkeSel.kind === 'prop') html += `<button class="dke-tool" onclick="dkeRotateSel()">⟳ Rotate</button><button class="dke-tool" onclick="dkeCyclePropSize()">⤢ Size ${dkePropScaleOf(it)}×</button><input class="hx-edit-in" style="max-width:150px" placeholder="name…" value="${eh(it.label||'')}" onchange="dkeEditPropLabel(this.value)">`;
      if(dkeSel.kind === 'label') html += `<input class="hx-edit-in" style="max-width:200px" value="${eh(it.t)}" onchange="dkeEditLabelSel(this.value)">`;
      if(dkeSel.kind === 'token') html += `<input class="hx-edit-in" style="max-width:180px" value="${eh(it.n)}" onchange="dkeEditTokenSel(this.value)"><button class="dke-tool" onclick="dkeCycleTokenStatus()">◍ ${it.st || 'status'}</button>`;
      if(dkeSel.kind === 'floor'){ const room = dkeRoomCells(d, it.x, it.y), mpc = dkeDeckMpc(d), cells = room ? room.length : it.w*it.h; html += `<span class="dke-note">Room ≈ ${Math.round(cells*mpc*mpc)} m² (${cells} cells)</span>`; }
      html += `<button class="dke-tool" onclick="dkeDuplicate()">⧉ Duplicate</button><button class="dke-tool dke-danger" onclick="dkeDeleteSel()">🗑 Delete</button>`;
    }
  }
  el.innerHTML = html;
  el.style.display = html ? 'flex' : 'none';
  if(dkeTool === 'label'){
    const inp = document.getElementById('dke-label-text');
    if(inp){ inp.value = dkeLabelTextVal; inp.addEventListener('input', function(){ dkeLabelTextVal = this.value; }); }
  }
  if(dkeTool === 'token'){
    const inp = document.getElementById('dke-token-custom');
    if(inp) inp.addEventListener('input', function(){ dkeTokenName = this.value.trim(); });
  }
  if(dkeTool === 'ruler'){
    const mi = document.getElementById('dke-mpc');
    if(mi) mi.addEventListener('change', function(){ dkeSetDeckScale('mpc', this.value); });
    const ri = document.getElementById('dke-refrange');
    if(ri) ri.addEventListener('change', function(){ dkeSetDeckScale('refRange', this.value); });
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
// Like dkeCell but clamps into the grid — the ruler always resolves a cell even
// when the tap lands in the canvas padding around the deck.
function dkeCellClamped(p){
  const d = dkeD(), u = dkeCellPt(p);
  return { x: Math.max(0, Math.min(d.w - 1, Math.floor(u.x))), y: Math.max(0, Math.min(d.h - 1, Math.floor(u.y))) };
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
    const i = d.doors.findIndex(op => dkeOpeningCovers(op, e));
    if(i >= 0) return { kind:'door', i };
  }
  for(let i = d.tokens.length - 1; i >= 0; i--)
    if(Math.hypot(u.x - (d.tokens[i].x+.5), u.y - (d.tokens[i].y+.5)) < .5) return { kind:'token', i };
  for(let i = d.props.length - 1; i >= 0; i--)
    if(dkePropCells(d.props[i]).some(cc => cc.x === Math.floor(u.x) && cc.y === Math.floor(u.y))) return { kind:'prop', i };
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
  dkeRedoStack = [];   // a fresh edit invalidates the redo branch
}
// Restore the active deck from `from`, saving the current state onto `onto` first.
function dkeHistoryStep(from, onto){
  const s = dkeHolder();
  if(!s || !from.length) return;
  const decks = dkeEnsureDecks(s), cur = dkeCurrentDeck(s);
  if(cur) onto.push(JSON.stringify(cur));
  const d = dkeNorm(JSON.parse(from.pop()));
  decks[dkeDeckIndex(s)] = d;
  dkeSel = null; dkePoly = null;
  const wEl = document.getElementById('dke-w'), hEl = document.getElementById('dke-h');
  if(wEl) wEl.value = d.w; if(hEl) hEl.value = d.h;
  dkeCommit(); dkeRenderSub();
}
function dkeUndoPop(){ dkeHistoryStep(dkeUndoStack, dkeRedoStack); }
function dkeRedoPop(){ dkeHistoryStep(dkeRedoStack, dkeUndoStack); }
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
  dkeSave();
}
let dkeScaleContent = false;   // resize toggle: scale drawn content WITH the grid
// Rebuild d's content from a captured baseline, scaled by (fx,fy). Coords/sizes
// snap to whole cells (labels stay fractional); degenerate walls are dropped.
function dkeRescaleContent(d, base, fx, fy){
  const rp = (v, f) => Math.round(v * f);
  d.floors = (base.floors||[]).map(o => ({ x:rp(o.x,fx), y:rp(o.y,fy), w:Math.max(1,rp(o.w,fx)), h:Math.max(1,rp(o.h,fy)) }));
  d.walls  = (base.walls||[]).map(o => ({ x1:rp(o.x1,fx), y1:rp(o.y1,fy), x2:rp(o.x2,fx), y2:rp(o.y2,fy) }))
             .filter(w => w.x1 !== w.x2 || w.y1 !== w.y2);
  d.doors  = (base.doors||[]).map(o => { const nd = { x:rp(o.x,fx), y:rp(o.y,fy), o:o.o }; if(o.t) nd.t = o.t; if(o.s) nd.s = o.s;
             const L = Math.max(1, rp(o.len||1, o.o === 'h' ? fx : fy)); if(L > 1) nd.len = L; return nd; });
  d.props  = (base.props||[]).map(o => { const np = { t:o.t, x:rp(o.x,fx), y:rp(o.y,fy), r:o.r||0 };
             const s = Math.max(1, Math.min(3, Math.round((o.s||1) * Math.min(fx,fy)))); if(s > 1) np.s = s; dkeClampProp(d, np); return np; });
  d.labels = (base.labels||[]).map(o => ({ t:o.t, x:o.x*fx, y:o.y*fy }));
  d.links  = (base.links||[]).map(o => { const nl = { a:o.a, x:rp(o.x,fx), y:rp(o.y,fy) }; if(o.hid) nl.hid = o.hid;
             if(o.mem) nl.mem = o.mem.map(m => ({ n:m.n, x:rp(m.x,fx), y:rp(m.y,fy) })); return nl; });
  d.tokens = (base.tokens||[]).map(o => ({ n:o.n, x:rp(o.x,fx), y:rp(o.y,fy) }));
}
// A small gold readout pill (live length/size while drawing).
function dkeDimPill(cx, cy, text){
  const w = String(text).length * 5.6 + 10;
  return `<g style="pointer-events:none"><rect x="${(cx-w/2).toFixed(1)}" y="${(cy-8).toFixed(1)}" width="${w.toFixed(1)}" height="15" rx="3" fill="#0f1117" stroke="#D4A843" stroke-width=".8" opacity=".96"/>`
    + `<text x="${cx.toFixed(1)}" y="${(cy+3.5).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#D4A843" font-family="system-ui,sans-serif">${dkeEsc(text)}</text></g>`;
}
function dkeResize(dim, val){
  const d = dkeD(); if(!d) return;
  dkeSnapshot();
  const base = dkeScaleContent ? JSON.parse(JSON.stringify(d)) : null;
  const old = { w: d.w, h: d.h };
  d[dim] = Math.max(4, Math.min(DKE_MAXDIM, parseInt(val,10) || d[dim]));
  document.getElementById('dke-' + dim).value = d[dim];
  if(base) dkeRescaleContent(d, base, d.w / old.w, d.h / old.h);
  dkeCommit();
}
// Which resize handle (if any) is under an svg-space point — E/S edges + SE corner.
function dkeResizeHandleAt(p){
  const d = dkeD(); if(!d) return null;
  const C = DKE_CELL, W = d.w*C, H = d.h*C, t = C*0.7;
  const near = (hx, hy) => Math.hypot(p.x - hx, p.y - hy) <= t;
  if(near(W, H)) return 'se';
  if(near(W, H/2)) return 'e';
  if(near(W/2, H)) return 's';
  return null;
}
// Handle glyphs, drawn at the deck's right/bottom edges + corner (editor only).
function dkeResizeHandlesSVG(d){
  const C = DKE_CELL, W = d.w*C, H = d.h*C, F = 'fill="#D4A843" stroke="#0f1117" stroke-width="1"';
  return `<g style="pointer-events:none">`
    + `<rect x="${W-7}" y="${H/2-11}" width="12" height="22" rx="2" ${F}/>`
    + `<rect x="${W/2-11}" y="${H-7}" width="22" height="12" rx="2" ${F}/>`
    + `<rect x="${W-8}" y="${H-8}" width="16" height="16" rx="2" ${F}/>`
    + `<path d="M${W-4},${H+2} L${W+2},${H-4} M${W-1},${H+3} L${W+3},${H-1}" stroke="#0f1117" stroke-width="1.3"/>`
    + `</g>`;
}

// ── Selection actions ────────────────────────────────────────────────────────
function dkeDeleteSel(){
  const d = dkeD(); if(!d || !dkeSel) return;
  dkeSnapshot();
  (d[dkeSel.kind + 's']||[]).splice(dkeSel.i, 1);
  dkeSel = null;
  dkeCommit(); dkeRenderSub();
}
// Movable items (prop/label/link/token) whose anchor point falls inside a cell
// rectangle — the marquee's catch. Anchor = cell centre (label = its point).
function dkeItemsInRect(d, ax, ay, bx, by){
  const out = [];
  ['prop','label','link','token'].forEach(kind => {
    (d[kind + 's']||[]).forEach((it, i) => {
      const px = kind === 'label' ? it.x : it.x + .5, py = kind === 'label' ? it.y : it.y + .5;
      if(px >= ax && px <= bx && py >= ay && py <= by) out.push({ kind, i });
    });
  });
  return out;
}
function dkeDeleteGroup(){
  const d = dkeD(); if(!d || !dkeGroup.length) return;
  dkeSnapshot();
  const byKind = {};
  dkeGroup.forEach(s => { (byKind[s.kind] = byKind[s.kind] || []).push(s.i); });
  // splice each kind in descending index order so earlier removals don't shift the rest
  Object.keys(byKind).forEach(kind => byKind[kind].sort((a,b) => b - a).forEach(i => (d[kind + 's']||[]).splice(i, 1)));
  dkeGroup = [];
  dkeCommit(); dkeRenderSub();
}
// Clone the selection (single dkeSel or the marquee group) offset one cell down-right.
function dkeDuplicate(){
  const d = dkeD(); if(!d) return;
  const sels = dkeGroup.length ? dkeGroup.slice() : (dkeSel ? [dkeSel] : []);
  if(!sels.length) return;
  dkeSnapshot();
  const made = [];
  sels.forEach(s => {
    const arr = d[s.kind + 's'], it = arr && arr[s.i]; if(!it) return;
    const copy = JSON.parse(JSON.stringify(it));
    if(s.kind === 'wall'){ copy.x1++; copy.y1++; copy.x2++; copy.y2++; }
    else { copy.x = (copy.x || 0) + 1; copy.y = (copy.y || 0) + 1; }
    arr.push(copy);
    if(s.kind === 'prop') dkeClampProp(d, copy);
    made.push({ kind: s.kind, i: arr.length - 1 });
  });
  if(dkeGroup.length){ dkeGroup = made; dkeSel = null; }
  else { dkeSel = made[0] || null; dkeGroup = []; }
  dkeCommit(); dkeRenderSub();
}
function dkeRotateSel(){
  const d = dkeD(); if(!d || !dkeSel || dkeSel.kind !== 'prop') return;
  dkeSnapshot();
  const p = d.props[dkeSel.i]; if(p){ p.r = ((p.r||0) + 90) % 360; dkeClampProp(d, p); }
  dkeCommit();
}
function dkeCyclePropSize(){
  const d = dkeD(); if(!d || !dkeSel || dkeSel.kind !== 'prop') return;
  const p = d.props[dkeSel.i]; if(!p) return;
  dkeSnapshot();
  const ns = dkePropScaleOf(p) % 3 + 1;   // 1→2→3→1
  if(ns > 1) p.s = ns; else delete p.s;
  dkeClampProp(d, p);
  dkeCommit(); dkeRenderSub();
}
function dkeEditLabelSel(v){
  const d = dkeD(); if(!d || !dkeSel || dkeSel.kind !== 'label') return;
  const t = String(v||'').trim(); if(!t) return;
  dkeSnapshot();
  d.labels[dkeSel.i].t = t;
  dkeCommit();
}
function dkeEditTokenSel(v){
  const d = dkeD(); if(!d || !dkeSel || dkeSel.kind !== 'token') return;
  const n = String(v||'').trim(); if(!n) return;
  dkeSnapshot();
  d.tokens[dkeSel.i].n = n;
  dkeCommit();
}
function dkeEditPropLabel(v){
  const d = dkeD(); if(!d || !dkeSel || dkeSel.kind !== 'prop') return;
  const t = String(v||'').trim().slice(0, 30);
  dkeSnapshot();
  if(t) d.props[dkeSel.i].label = t; else delete d.props[dkeSel.i].label;
  dkeCommit();
}
function dkeCycleTokenStatus(){
  const d = dkeD(); if(!d || !dkeSel || dkeSel.kind !== 'token') return;
  const t = d.tokens[dkeSel.i]; if(!t) return;
  dkeSnapshot();
  const ni = (DKE_STATUS_ORDER.indexOf(t.st || '') + 1) % DKE_STATUS_ORDER.length;
  if(DKE_STATUS_ORDER[ni]) t.st = DKE_STATUS_ORDER[ni]; else delete t.st;
  dkeCommit(); dkeRenderSub();
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
  const rh = dkeResizeHandleAt(p);   // grid resize handles win over any tool
  if(rh){ dkeGesture = { t:'resize', edge: rh, snapped:false, base: dkeScaleContent ? JSON.parse(JSON.stringify(d)) : null }; return; }
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
  } else if(dkeTool === 'ruler'){
    dkeGesture = { t:'ruler', a: dkeCellClamped(p), moved:false };
  } else if(dkeTool === 'template' && dkeTplMode === 'copy'){
    const v = dkeVertex(p);
    dkeGesture = { t:'tplcopy', x0: v.x, y0: v.y, x1: v.x, y1: v.y };
  } else if(dkeTool === 'select'){
    const hit = dkeHitTest(p), u = dkeCellPt(p);
    const movable = hit && (hit.kind === 'prop' || hit.kind === 'label' || hit.kind === 'link' || hit.kind === 'token');
    if(movable && dkeInGroup(hit)){                 // grab a grouped item → move the whole group
      dkeGesture = { t:'gmove', sx: ev.clientX, sy: ev.clientY, moved:false, snapped:false, start: u };
    } else if(movable){                             // single movable item
      dkeGroup = []; dkeGesture = { t:'move', hit, sx: ev.clientX, sy: ev.clientY, moved:false, snapped:false };
    } else if(hit){                                 // structural item (wall/floor/door) → single select
      dkeGroup = []; dkeSel = hit; dkeRenderContent(); dkeRenderSub(); dkeGesture = { t:'tapped' };
    } else {                                        // empty space → rubber-band marquee
      dkeSel = null; dkeGroup = [];
      dkeGesture = { t:'marquee', x0: u.x, y0: u.y, x1: u.x, y1: u.y };
      dkeRenderContent(); dkeRenderSub();
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
  } else if(g.t === 'resize'){
    if(!g.snapped){ dkeSnapshot(); g.snapped = true; }
    const dd = dkeD(), u = dkeCellPt(p);
    if(g.edge === 'e' || g.edge === 'se') dd.w = Math.max(4, Math.min(DKE_MAXDIM, Math.round(u.x)));
    if(g.edge === 's' || g.edge === 'se') dd.h = Math.max(4, Math.min(DKE_MAXDIM, Math.round(u.y)));
    // Scale mode: rebuild content from the captured baseline each move (no drift).
    if(g.base) dkeRescaleContent(dd, g.base, dd.w / g.base.w, dd.h / g.base.h);
    const wEl = document.getElementById('dke-w'), hEl = document.getElementById('dke-h');
    if(wEl) wEl.value = dd.w; if(hEl) hEl.value = dd.h;
    dkeRenderContent(); dkeDirty = true;
  } else if(g.t === 'room'){
    const v = dkeVertex(p); g.x1 = v.x; g.y1 = v.y;
    const mpc = dkeDeckMpc(dkeD()), wc = Math.abs(g.x1-g.x0), hc = Math.abs(g.y1-g.y0);
    const x = Math.min(g.x0, g.x1)*C, y = Math.min(g.y0, g.y1)*C;
    dkeGhost(`<rect x="${x}" y="${y}" width="${wc*C}" height="${hc*C}" fill="#D4A84318" stroke="#D4A843" stroke-width="1.5" stroke-dasharray="5,3"/>`
      + ((wc || hc) ? dkeDimPill(x + wc*C/2, y - 10, `${(wc*mpc).toFixed(1)}×${(hc*mpc).toFixed(1)} m`) : ''));
  } else if(g.t === 'wall'){
    const v = dkeVertex(p); g.x1 = v.x; g.y1 = v.y;
    const len = Math.hypot(g.x1-g.x0, g.y1-g.y0) * dkeDeckMpc(dkeD());
    dkeGhost(`<line x1="${g.x0*C}" y1="${g.y0*C}" x2="${g.x1*C}" y2="${g.y1*C}" stroke="#D4A843" stroke-width="2.5" stroke-dasharray="5,3"/>`
      + (len > 0 ? dkeDimPill((g.x0+g.x1)/2*C, (g.y0+g.y1)/2*C - 9, `${len.toFixed(1)} m`) : ''));
  } else if(g.t === 'tplcopy'){
    const v = dkeVertex(p); g.x1 = v.x; g.y1 = v.y;
    const x = Math.min(g.x0, g.x1)*C, y = Math.min(g.y0, g.y1)*C;
    dkeGhost(`<rect x="${x}" y="${y}" width="${Math.abs(g.x1-g.x0)*C}" height="${Math.abs(g.y1-g.y0)*C}" fill="#5b8ef022" stroke="#5b8ef0" stroke-width="1.5" stroke-dasharray="5,3"/>`);
  } else if(g.t === 'floor'){
    dkePaintFloor(p, g);
  } else if(g.t === 'erase'){
    dkeEraseAt(p, g);
  } else if(g.t === 'ruler'){
    const c = dkeCellClamped(p);
    if(!g.moved && (c.x !== g.a.x || c.y !== g.a.y)) g.moved = true;
    g.b = c;
    const d = dkeD();
    if(d && g.moved){
      dkeGhost(dkeRulerOverlaySVG(d, g.a, c));
      const out = document.getElementById('dke-ruler-out');
      if(out) out.textContent = '📏 ' + dkeMeasureText(d, g.a, c);
    }
  } else if(g.t === 'move'){
    if(!g.moved && Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) < 5) return;
    g.moved = true;
    if(!g.snapped){ dkeSnapshot(); g.snapped = true; }
    const d = dkeD(), it = (d[g.hit.kind + 's']||[])[g.hit.i]; if(!it) return;
    const u = dkeCellPt(p);
    if(g.hit.kind === 'label'){ it.x = u.x; it.y = u.y; }
    else { it.x = Math.floor(u.x); it.y = Math.floor(u.y); if(g.hit.kind === 'prop') dkeClampProp(d, it); }
    dkeSel = g.hit;
    dkeRenderContent();
  } else if(g.t === 'marquee'){
    const u = dkeCellPt(p); g.x1 = u.x; g.y1 = u.y;
    const x = Math.min(g.x0, g.x1)*C, y = Math.min(g.y0, g.y1)*C;
    dkeGhost(`<rect x="${x}" y="${y}" width="${Math.abs(g.x1-g.x0)*C}" height="${Math.abs(g.y1-g.y0)*C}" fill="#5b8ef022" stroke="#5b8ef0" stroke-width="1.5" stroke-dasharray="5,3"/>`);
  } else if(g.t === 'gmove'){
    if(!g.moved && Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) < 5) return;
    g.moved = true;
    const d = dkeD(), u = dkeCellPt(p);
    if(!g.snapped){ dkeSnapshot(); g.snapped = true; g.orig = dkeGroup.map(s => { const it = (d[s.kind+'s']||[])[s.i]; return { s, ox: it ? it.x : 0, oy: it ? it.y : 0 }; }); }
    const dxf = u.x - g.start.x, dyf = u.y - g.start.y;
    g.orig.forEach(o => {
      const it = (d[o.s.kind+'s']||[])[o.s.i]; if(!it) return;
      if(o.s.kind === 'label'){ it.x = o.ox + dxf; it.y = o.oy + dyf; }
      else { it.x = o.ox + Math.round(dxf); it.y = o.oy + Math.round(dyf); if(o.s.kind === 'prop') dkeClampProp(d, it); }
    });
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
  if(g.t === 'resize'){
    if(g.snapped) dkeFlushSave();
    return;
  }
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
  } else if(g.t === 'tplcopy'){
    dkeGhost('');
    const tpl = dkeCaptureRegion(d, g.x0, g.y0, g.x1, g.y1);
    if(tpl && (tpl.floors.length || tpl.walls.length || tpl.props.length || tpl.doors.length || tpl.labels.length)){
      dkeClipTpl = tpl; dkeTplSel = '__clip'; dkeTplMode = 'stamp';
      dkeRenderSub(); dkeRenderHint();
      if(typeof showToast === 'function') showToast(`Copied ${tpl.w}×${tpl.h} — tap to paste`);
    } else if(typeof showToast === 'function'){ showToast('Nothing to copy in that box'); }
  } else if(g.t === 'floor' || g.t === 'erase'){
    dkeFlushSave();
  } else if(g.t === 'ruler'){
    if(g.moved && g.b){ dkeRuler = { a: g.a, b: g.b }; dkeRulerAnchor = null; }
    else if(!dkeRulerAnchor){ dkeRulerAnchor = g.a; dkeRuler = null; }   // first tap
    else { dkeRuler = { a: dkeRulerAnchor, b: g.a }; dkeRulerAnchor = null; }  // second tap
    dkeRulerRedraw();
  } else if(g.t === 'move'){
    if(g.moved){
      const it = (d[g.hit.kind + 's']||[])[g.hit.i];
      if(it && g.hit.kind === 'label'){ it.x = Math.round(it.x*4)/4; it.y = Math.round(it.y*4)/4; }
      dkeCommit(); dkeRenderSub();
    } else {
      dkeSel = g.hit; dkeRenderContent(); dkeRenderSub();
    }
  } else if(g.t === 'marquee'){
    dkeGhost('');
    const ax = Math.min(g.x0,g.x1), ay = Math.min(g.y0,g.y1), bx = Math.max(g.x0,g.x1), by = Math.max(g.y0,g.y1);
    dkeGroup = (bx - ax > .1 || by - ay > .1) ? dkeItemsInRect(d, ax, ay, bx, by) : [];
    dkeSel = null; dkeRenderContent(); dkeRenderSub();
  } else if(g.t === 'gmove'){
    if(g.moved){ dkeCommit(); dkeRenderSub(); } else { dkeRenderSub(); }
  } else if(g.t === 'tap' && !g.cancel){
    dkeTapAction(p);
  }
}
function dkeAddWall(d, x1, y1, x2, y2){
  const dup = d.walls.some(w => (w.x1===x1 && w.y1===y1 && w.x2===x2 && w.y2===y2)
                             || (w.x1===x2 && w.y1===y2 && w.x2===x1 && w.y2===y1));
  if(!dup) d.walls.push({ x1, y1, x2, y2 });
}
// Ray-cast point-in-polygon (vertices in grid coords) — handles diagonal runs.
function dkePointInPoly(px, py, poly){
  let inside = false;
  for(let i = 0, j = poly.length - 1; i < poly.length; j = i++){
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if(((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
// Fill every grid cell whose centre lies inside the closed wall-run with floor.
function dkeFillPolygon(d, poly){
  const covered = (cx, cy) => (d.floors || []).some(f => cx >= f.x && cx < f.x + f.w && cy >= f.y && cy < f.y + f.h);
  for(let cy = 0; cy < d.h; cy++) for(let cx = 0; cx < d.w; cx++)
    if(dkePointInPoly(cx + 0.5, cy + 0.5, poly) && !covered(cx, cy)) d.floors.push({ x: cx, y: cy, w: 1, h: 1 });
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
      dkePoly = { x: v.x, y: v.y, start: { x: v.x, y: v.y }, path: [{ x: v.x, y: v.y }] };
      dkeRenderSub();
    } else if(v.x === dkePoly.start.x && v.y === dkePoly.start.y && dkePoly.path.length >= 3){
      // Closed the loop back at the start → seal it and fill the room.
      dkeSnapshot();
      dkeAddWall(d, dkePoly.x, dkePoly.y, v.x, v.y);
      dkeFillPolygon(d, dkePoly.path);
      dkeCommit();
      dkePolyEnd();
      if(typeof showToast === 'function') showToast('Room closed');
      return;
    } else if(v.x !== dkePoly.x || v.y !== dkePoly.y){
      dkeSnapshot();
      dkeAddWall(d, dkePoly.x, dkePoly.y, v.x, v.y);
      dkePoly.x = v.x; dkePoly.y = v.y; dkePoly.path.push({ x: v.x, y: v.y });
      dkeCommit();
    }
    // Ghost: last vertex + a highlighted start ring you can tap to close.
    const st = dkePoly.start;
    dkeGhost(`<circle cx="${dkePoly.x*C}" cy="${dkePoly.y*C}" r="5" fill="none" stroke="#D4A843" stroke-width="2"/>`
      + (dkePoly.path.length >= 3 ? `<circle cx="${st.x*C}" cy="${st.y*C}" r="7" fill="#4caf8233" stroke="#4caf82" stroke-width="2"><animate attributeName="r" values="6;9;6" dur="1.4s" repeatCount="indefinite"/></circle>` : `<circle cx="${st.x*C}" cy="${st.y*C}" r="4" fill="#D4A843"/>`));
  } else if(dkeTool === 'door'){
    const e = dkeNearestEdge(p, .4); if(!e) return;
    const i = d.doors.findIndex(op => dkeOpeningCovers(op, e));
    dkeSnapshot();
    if(i >= 0){
      const op = d.doors[i];
      if((op.t || 'door') === 'door' && dkeOpenType === 'door'){
        const ns = dkeNextDoorState(op.s);   // tap a door → cycle its state
        if(ns === 'closed') delete op.s; else op.s = ns;
      } else {
        d.doors.splice(i, 1);   // tap a window (or door with window selected) → remove
      }
    } else {
      // Place the selected type + length, clamped so it stays on the grid.
      let len = Math.max(1, Math.min(3, dkeOpenLen | 0 || 1));
      len = Math.max(1, Math.min(len, e.o === 'h' ? d.w - e.x : d.h - e.y));
      const op = { x: e.x, y: e.y, o: e.o };
      if(dkeOpenType === 'window') op.t = 'window';
      if(len > 1) op.len = len;
      d.doors.push(op);
    }
    dkeCommit();
  } else if(dkeTool === 'prop'){
    const c = dkeCell(p); if(!c) return;
    // Match against whole footprints so a tap anywhere on a multi-cell prop hits it.
    const existing = d.props.find(pr => dkePropCells(pr).some(cc => cc.x === c.x && cc.y === c.y));
    dkeSnapshot();
    if(existing && existing.t === dkePropType){ existing.r = ((existing.r||0) + 90) % 360; dkeClampProp(d, existing); }
    else if(existing){ existing.t = dkePropType; existing.r = 0; dkeClampProp(d, existing); }
    else { const np = { t: dkePropType, x: c.x, y: c.y, r: 0 }; if(dkePropScale > 1) np.s = dkePropScale; dkeClampProp(d, np); d.props.push(np); }
    dkeCommit();
  } else if(dkeTool === 'token'){
    const c = dkeCell(p); if(!c) return;
    const n = String(dkeTokenName||'').trim();
    if(!n){ if(typeof showToast === 'function') showToast('Pick a character or type a name first'); return; }
    const i = d.tokens.findIndex(t => t.x === c.x && t.y === c.y);
    dkeSnapshot();
    if(i >= 0) d.tokens.splice(i, 1);           // tap a placed token → remove it
    else d.tokens.push({ n, x: c.x, y: c.y });
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
  } else if(dkeTool === 'template'){
    const tpl = dkeActiveTpl();
    if(!tpl){ if(typeof showToast === 'function') showToast(dkeTplSel === '__clip' ? 'Copy an area first' : 'Pick a room first'); return; }
    const c = dkeCell(p); if(!c) return;
    dkeSnapshot();
    dkeStampTemplate(d, tpl, c.x, c.y);
    dkeCommit();
  }
}
// ═══ TOKEN DRAG ON THE STATION VIEW (referee, no editor needed) ══════════════
// Delegated pointer handlers on #mapsvg (they survive the innerHTML re-renders).
// A drag starts only from a token group (data-tk, referee render); anything
// under the 5px threshold stays a plain tap so room taps behave as before.
// During the drag the token <g> is moved by transform (re-queried each move in
// case a poll re-render swapped the DOM); the drop snaps to the cell under the
// pointer, saves, and swallows the one click the drop would otherwise fire.
let dkeMapDrag = null;          // {i, sx, sy, p0:{x,y}, last:{x,y}|null, moved}
let dkeMapClickGuardUntil = 0;  // swallow clicks until this timestamp after a drag

// ── Station-view range ruler (referee AND players — it's measurement) ─────────
// A floating #deck-ruler-btn toggles the tool; while on, the #mapsvg pointer
// handlers below measure between two cells instead of dragging tokens / opening
// rooms. The measurement is transient module state re-drawn by deckStationSVG on
// every render, so it survives the poll's innerHTML replacement.
let dkeMapRuler = false;        // ruler tool active on the station view
let dkeMapRulerState = null;    // last completed measurement {a:{x,y}, b:{x,y}}
let dkeMapRulerAnchor = null;   // pending first cell for a tap-tap measurement
let dkeMapRulerG = null;        // active drag gesture {a, sx, sy, moved, b?}
let dkeMapRanges = false;       // range-rings mode (referee): tap a token to ring it
let dkeRangeTokenIdx = null;    // focused token index (local to the referee's view)
let dkeMapPing = false;         // ping mode (referee): tap a cell to drop a shared "look here"
function dkeMapTogglePing(){
  dkeMapPing = !dkeMapPing;
  if(dkeMapPing){ if(dkeMapRuler) dkeMapToggleRuler(false); if(dkeMapRanges){ dkeMapRanges = false; dkeRangeTokenIdx = null; const rb = document.getElementById('deck-ranges-btn'); if(rb) rb.classList.remove('on'); } }
  else { const deck = dkeMapDeck(); if(deck && deck.ping){ delete deck.ping; if(typeof saveAuthoredStations === 'function') saveAuthoredStations(); } }   // exiting clears the ping
  const btn = document.getElementById('deck-ping-btn'); if(btn) btn.classList.toggle('on', dkeMapPing);
  const svg = document.getElementById('mapsvg'); if(svg) svg.style.touchAction = (dkeMapPing || dkeMapRuler || dkeMapRanges) ? 'none' : '';
  if(dkeMapPing && typeof showToast === 'function') showToast('Ping — tap to point players at a spot');
  if(typeof renderStationMap === 'function') renderStationMap();
}
function dkeMapToggleRanges(){
  dkeMapRanges = !dkeMapRanges;
  if(!dkeMapRanges) dkeRangeTokenIdx = null;
  if(dkeMapRanges && dkeMapRuler) dkeMapToggleRuler(false);   // mutually exclusive with the ruler
  if(dkeMapRanges && dkeMapPing){ dkeMapPing = false; const pb = document.getElementById('deck-ping-btn'); if(pb) pb.classList.remove('on'); }
  const btn = document.getElementById('deck-ranges-btn'); if(btn) btn.classList.toggle('on', dkeMapRanges);
  const svg = document.getElementById('mapsvg'); if(svg) svg.style.touchAction = dkeMapRanges ? 'none' : (dkeMapRuler ? 'none' : '');
  if(dkeMapRanges && typeof showToast === 'function') showToast('Range rings — tap a token');
  if(typeof renderStationMap === 'function') renderStationMap();
}

function dkeMapCellAt(deck, p){
  return { x: Math.max(0, Math.min(deck.w - 1, Math.floor(p.x / DKE_CELL))),
           y: Math.max(0, Math.min(deck.h - 1, Math.floor(p.y / DKE_CELL))) };
}
// Live overlay during a drag — inject a single throwaway node so we don't rebuild
// the whole map SVG on every pointermove (the next full render replaces it).
function dkeMapRulerLive(deck, a, b){
  const svg = document.getElementById('mapsvg'); if(!svg) return;
  const old = svg.querySelector('#deck-ruler-live'); if(old) old.remove();
  svg.insertAdjacentHTML('beforeend', `<g id="deck-ruler-live">${dkeRulerOverlaySVG(deck, a, b)}</g>`);
}
function dkeMapToggleRuler(force){
  const on = (typeof force === 'boolean') ? force : !dkeMapRuler;
  dkeMapRuler = on;
  if(!on){ dkeMapRulerState = null; dkeMapRulerAnchor = null; dkeMapRulerG = null; }
  if(on){   // ruler is exclusive with range rings + ping
    if(dkeMapRanges){ dkeMapRanges = false; dkeRangeTokenIdx = null; const rb = document.getElementById('deck-ranges-btn'); if(rb) rb.classList.remove('on'); }
    if(dkeMapPing){ dkeMapPing = false; const pb = document.getElementById('deck-ping-btn'); if(pb) pb.classList.remove('on'); }
  }
  const btn = document.getElementById('deck-ruler-btn');
  if(btn) btn.classList.toggle('on', on);
  const svg = document.getElementById('mapsvg');
  if(svg) svg.style.touchAction = on ? 'none' : '';   // let touch drags measure, not scroll
  if(on && typeof showToast === 'function') showToast('Range ruler on — tap two cells to measure');
  if(typeof renderStationMap === 'function') renderStationMap();
  if(typeof updateNodes === 'function') updateNodes();
}
// Called from renderStationMap: show the button only when a deck plan is on
// screen, and force the tool off if the deck went away.
function dkeRulerBtnSync(){
  const btn = document.getElementById('deck-ruler-btn'); if(!btn) return;
  const has = !!dkeMapDeck();
  if(!has && dkeMapRuler){
    dkeMapRuler = false; dkeMapRulerState = null; dkeMapRulerAnchor = null; dkeMapRulerG = null;
    const svg = document.getElementById('mapsvg'); if(svg) svg.style.touchAction = '';
  }
  btn.style.display = has ? 'flex' : 'none';
  btn.classList.toggle('on', dkeMapRuler);
  // Range-rings + ping buttons — referee only.
  const ref = has && (typeof isReferee === 'function') && isReferee();
  const rb = document.getElementById('deck-ranges-btn');
  if(rb){
    if(!ref && dkeMapRanges){ dkeMapRanges = false; dkeRangeTokenIdx = null; }
    rb.style.display = ref ? 'flex' : 'none';
    rb.classList.toggle('on', dkeMapRanges);
  }
  const pb = document.getElementById('deck-ping-btn');
  if(pb){
    if(!ref && dkeMapPing) dkeMapPing = false;
    pb.style.display = ref ? 'flex' : 'none';
    pb.classList.toggle('on', dkeMapPing);
  }
}
// Station-view deck switcher — shown only when the station has 2+ decks. The
// referee's buttons set the SYNCED active deck (players follow via the poll);
// players get a read-only "name · n/total" label. Called from renderStationMap.
function dkeRenderMapDecks(){
  const el = document.getElementById('deck-switcher'); if(!el) return;
  const s = (typeof stationAdditions !== 'undefined') ? stationAdditions[currentStationId] : null;
  const decks = dkeDeckList(s);
  if(!dkeMapDeck() || decks.length < 2){ el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'flex';
  const cur = dkeDeckIndex(s);
  const ref = (typeof isReferee === 'function') && isReferee();
  el.innerHTML = ref
    ? decks.map((dk, i) => `<button class="deck-sw-btn${i===cur?' on':''}" onclick="dkeMapSwitchDeck(${i})">${dkeEsc(dkeDeckName(dk, i))}</button>`).join('')
    : `<span class="deck-sw-label">${dkeEsc(dkeDeckName(decks[cur], cur))} · ${cur+1}/${decks.length}</span>`;
}
function dkeMapSwitchDeck(i){
  if(typeof isReferee !== 'function' || !isReferee()) return;
  const s = stationAdditions[currentStationId]; if(!s) return;
  const decks = dkeEnsureDecks(s);
  s.deckIdx = Math.max(0, Math.min(decks.length - 1, i));
  if(dkeMapRuler){ dkeMapRulerState = null; dkeMapRulerAnchor = null; }   // clear a stale measurement across decks
  if(typeof saveAuthoredStations === 'function') saveAuthoredStations();
  if(typeof renderStationMap === 'function') renderStationMap();
  if(typeof updateNodes === 'function') updateNodes();
}

function dkeMapDeck(){
  if(typeof currentStationId === 'undefined') return null;
  const s = (typeof stationAdditions !== 'undefined') ? stationAdditions[currentStationId] : null;
  const deck = dkeCurrentDeck(s);
  return (deck && deckHasContent(deck)) ? deck : null;
}
// Client → svg user coords. The station map is letterboxed (preserveAspectRatio
// default), so unlike the editor's aspect-managed viewBox this needs the CTM.
function dkeMapPt(ev){
  const svg = document.getElementById('mapsvg');
  const m = svg && svg.getScreenCTM(); if(!m) return null;
  const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}
function dkeMapDown(ev){
  if(dkeIsOpen) return;
  const deck = dkeMapDeck(); if(!deck) return;
  if(dkeMapRuler){
    const p = dkeMapPt(ev); if(!p) return;
    dkeMapRulerG = { a: dkeMapCellAt(deck, p), sx: ev.clientX, sy: ev.clientY, moved:false };
    const svg = document.getElementById('mapsvg');
    try { svg.setPointerCapture(ev.pointerId); } catch(e){}
    return;
  }
  if(dkeMapRanges){   // tap a token to ring it (referee), tap elsewhere to clear
    if(typeof isReferee !== 'function' || !isReferee()) return;
    const tg = (ev.target && ev.target.closest) ? ev.target.closest('g[data-tk]') : null;
    dkeRangeTokenIdx = tg ? parseInt(tg.getAttribute('data-tk'), 10) : null;
    dkeMapClickGuardUntil = Date.now() + 400;   // don't also open a room
    if(typeof renderStationMap === 'function') renderStationMap();
    ev.preventDefault();
    return;
  }
  if(dkeMapPing){   // tap a cell to drop a shared attention ping (referee)
    if(typeof isReferee !== 'function' || !isReferee()) return;
    const p = dkeMapPt(ev);
    if(p){ deck.ping = dkeMapCellAt(deck, p); if(typeof saveAuthoredStations === 'function') saveAuthoredStations(); }
    dkeMapClickGuardUntil = Date.now() + 400;
    if(typeof renderStationMap === 'function') renderStationMap();
    ev.preventDefault();
    return;
  }
  if(typeof isReferee !== 'function' || !isReferee()) return;
  const tg = (ev.target && ev.target.closest) ? ev.target.closest('g[data-tk]') : null;
  if(!tg) return;
  const i = parseInt(tg.getAttribute('data-tk'), 10);
  if(!(deck.tokens||[])[i]) return;
  const p0 = dkeMapPt(ev); if(!p0) return;
  dkeMapDrag = { i, sx: ev.clientX, sy: ev.clientY, p0, last: null, moved: false };
  const svg = document.getElementById('mapsvg');
  try { svg.setPointerCapture(ev.pointerId); } catch(e){}
}
function dkeMapMove(ev){
  if(dkeMapRuler){
    const rg = dkeMapRulerG; if(!rg) return;
    if(!rg.moved && Math.hypot(ev.clientX - rg.sx, ev.clientY - rg.sy) < 5) return;
    rg.moved = true; ev.preventDefault();
    const p = dkeMapPt(ev), deck = dkeMapDeck(); if(!p || !deck) return;
    rg.b = dkeMapCellAt(deck, p);
    dkeMapRulerLive(deck, rg.a, rg.b);
    return;
  }
  const g = dkeMapDrag; if(!g) return;
  if(!g.moved && Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) < 5) return;
  g.moved = true;
  ev.preventDefault();
  const p = dkeMapPt(ev); if(!p) return;
  g.last = p;
  const svg = document.getElementById('mapsvg');
  const el = svg && svg.querySelector('g[data-tk="' + g.i + '"]');
  if(el) el.setAttribute('transform', `translate(${p.x - g.p0.x},${p.y - g.p0.y})`);
}
// Plain tap on a token (referee) opens that character's sheet (PC) or NPC roster
// entry — the token already carries the name the rest of the app keys off.
function dkeMapOpenToken(i){
  const deck = dkeMapDeck(); const t = deck && (deck.tokens||[])[i]; if(!t) return;
  const name = t.n, low = String(name||'').trim().toLowerCase();
  if(typeof crewRoster === 'function' && crewRoster().some(n => String(n).trim().toLowerCase() === low)){
    if(typeof openSheet === 'function') openSheet(name);   // player character → sheet
    return;
  }
  if(typeof npcRoster !== 'undefined' && Array.isArray(npcRoster)){
    const npc = npcRoster.find(n => String(n.name||'').trim().toLowerCase() === low);
    if(npc){
      npcEditingId = npc.id;
      if(typeof npcPanelOpen !== 'undefined' && !npcPanelOpen){ if(typeof toggleNpcPanel === 'function') toggleNpcPanel(); }
      else if(typeof renderNpcPanel === 'function') renderNpcPanel();
      return;
    }
  }
  if(typeof showToast === 'function') showToast('No sheet for ' + name);
}
// Seed the initiative tracker (js/45) from the tokens on the current deck plan —
// they're already placed on the map, so combat starts from the board (referee).
function dkeSeedCombatFromMap(){
  if(typeof isReferee === 'function' && !isReferee()) return;
  const deck = dkeMapDeck();
  if(!deck || !(deck.tokens||[]).length){ if(typeof showToast === 'function') showToast('No tokens on the current map'); return; }
  if(typeof quickAddNPC !== 'function' || typeof combatants === 'undefined'){ if(typeof showToast === 'function') showToast('Initiative tracker unavailable'); return; }
  const have = new Set(combatants.map(c => String(c.name||'').trim().toLowerCase()));
  let added = 0;
  deck.tokens.forEach(t => { const k = String(t.n||'').trim().toLowerCase(); if(k && !have.has(k)){ quickAddNPC(t.n, 0, 0); have.add(k); added++; } });
  if(added && typeof saveCombatants === 'function') saveCombatants();
  if(typeof showToast === 'function') showToast(added ? `Added ${added} combatant${added > 1 ? 's' : ''} from the map` : 'All map tokens are already in initiative');
}
function dkeMapUp(ev){
  if(dkeMapRuler){
    const rg = dkeMapRulerG; if(!rg) return;
    dkeMapRulerG = null;
    const deck = dkeMapDeck(); if(!deck) return;
    const p = dkeMapPt(ev);
    if(rg.moved && p){ dkeMapRulerState = { a: rg.a, b: dkeMapCellAt(deck, p) }; dkeMapRulerAnchor = null; }
    else if(!rg.moved){
      if(!dkeMapRulerAnchor){ dkeMapRulerAnchor = rg.a; dkeMapRulerState = null; }   // first tap
      else { dkeMapRulerState = { a: dkeMapRulerAnchor, b: rg.a }; dkeMapRulerAnchor = null; }  // second tap
    }
    dkeMapClickGuardUntil = Date.now() + 400;   // a measuring tap must not open an area
    if(typeof renderStationMap === 'function') renderStationMap();
    return;
  }
  const g = dkeMapDrag; if(!g) return;
  dkeMapDrag = null;
  if(!g.moved){ dkeMapOpenToken(g.i); return; }   // plain tap on a token → open its sheet / NPC block
  const deck = dkeMapDeck();
  const p = dkeMapPt(ev) || g.last;
  if(deck && p && deck.tokens[g.i]){
    deck.tokens[g.i].x = Math.max(0, Math.min(deck.w - 1, Math.floor(p.x / DKE_CELL)));
    deck.tokens[g.i].y = Math.max(0, Math.min(deck.h - 1, Math.floor(p.y / DKE_CELL)));
    dkeFogAutoReveal(deck, deck.tokens[g.i]);   // PC dropped into a fogged room → lift its fog
    if(typeof saveAuthoredStations === 'function') saveAuthoredStations();
  }
  dkeMapClickGuardUntil = Date.now() + 400;  // the drop's click must not open an area
  if(typeof renderStationMap === 'function'){ renderStationMap(); }
  if(typeof updateNodes === 'function') updateNodes();
}
function dkeMapClickGuard(ev){
  if(Date.now() < dkeMapClickGuardUntil){
    dkeMapClickGuardUntil = 0;
    ev.stopPropagation(); ev.preventDefault();
  }
}
(function dkeMapDragInit(){
  const svg = document.getElementById('mapsvg');
  if(!svg) return;
  svg.addEventListener('pointerdown', dkeMapDown);
  svg.addEventListener('pointermove', dkeMapMove);
  svg.addEventListener('pointerup', dkeMapUp);
  svg.addEventListener('pointercancel', dkeMapUp);
  svg.addEventListener('click', dkeMapClickGuard, true);
})();

// Single-key tool shortcuts (no modifier) — desktop convenience.
const DKE_KEYS = { v:'select', h:'pan', r:'room', f:'floor', w:'wall', q:'poly',
  d:'door', p:'prop', o:'template', i:'image', t:'token', l:'label', a:'link', m:'ruler', e:'erase' };
function dkeKeyDown(ev){
  if(!dkeIsOpen) return;
  const tag = (ev.target && ev.target.tagName) || '';
  if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const k = (ev.key || '').toLowerCase();
  if(ev.key === 'Escape'){
    if(dkePoly) dkePolyEnd();
    else if(dkeSel || dkeGroup.length){ dkeSel = null; dkeGroup = []; dkeRenderContent(); dkeRenderSub(); }
    ev.preventDefault();
  } else if((ev.key === 'Delete' || ev.key === 'Backspace') && (dkeSel || dkeGroup.length)){
    if(dkeGroup.length) dkeDeleteGroup(); else dkeDeleteSel();
    ev.preventDefault();
  } else if((ev.ctrlKey || ev.metaKey) && k === 'z'){
    if(ev.shiftKey) dkeRedoPop(); else dkeUndoPop();   // Ctrl+Shift+Z = redo
    ev.preventDefault();
  } else if((ev.ctrlKey || ev.metaKey) && k === 'y'){
    dkeRedoPop(); ev.preventDefault();
  } else if((ev.ctrlKey || ev.metaKey) && k === 'd'){
    dkeDuplicate(); ev.preventDefault();
  } else if(!ev.ctrlKey && !ev.metaKey && !ev.altKey && DKE_KEYS[k]){
    dkeSetTool(DKE_KEYS[k]); ev.preventDefault();
  }
}

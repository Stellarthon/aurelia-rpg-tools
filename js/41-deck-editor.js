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
// labels:[{t,x,y}] (cell units, fractional), links:[{a,x,y,hid?:1}] (areaId
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
  shuttle : { n:'Shuttle', w:2, h:2, g:'<path d="M0,-28 L9,-8 L12,16 L7,25 L-7,25 L-12,16 L-9,-8 Z" fill="#0f1117" stroke="#7f93b8" stroke-width="1.6"/><path d="M-9,2 L-27,15 L-27,20 L-10,13 Z" fill="#0f1117" stroke="#7f93b8" stroke-width="1.2"/><path d="M9,2 L27,15 L27,20 L10,13 Z" fill="#0f1117" stroke="#7f93b8" stroke-width="1.2"/><path d="M0,-24 L5,-10 L-5,-10 Z" fill="#5b8ef033" stroke="#5b8ef0" stroke-width="1"/><rect x="-7" y="23" width="4.5" height="4" rx="1" fill="#D4A843"/><rect x="2.5" y="23" width="4.5" height="4" rx="1" fill="#D4A843"/>' }
};
// Prop footprint (in cells) at its current rotation — 90°/270° swap w↔h so a 2×1
// stamp occupies two vertical cells when turned. Missing/1×1 defs stay 1×1, so
// every pre-existing prop and every render path is unchanged for them.
function dkePropFootprint(p){
  const def = DKE_PROPS[p && p.t] || {}, w = def.w || 1, h = def.h || 1, r = ((p && p.r) || 0) % 360;
  const swap = (r === 90 || r === 270);
  return { fw: swap ? h : w, fh: swap ? w : h };
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
  d.w = Math.max(4, Math.min(64, parseInt(d.w,10) || 24));
  d.h = Math.max(4, Math.min(64, parseInt(d.h,10) || 16));
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
// The referee's reveal toggle: open eye = players see the room, closed = fog.
function dkeFogEyeSVG(cx, cy, li, hid){
  const glyph = hid
    ? `<path d="M-6,-1.5 Q0,3.5 6,-1.5" fill="none" stroke="#D4A843" stroke-width="1.3" stroke-linecap="round"/>`
      + `<path d="M-4.2,1.4 l-1.4,2 M0,2.4 v2.4 M4.2,1.4 l1.4,2" stroke="#D4A843" stroke-width="1.1" stroke-linecap="round"/>`
    : `<path d="M-6,0 Q0,-4.6 6,0 Q0,4.6 -6,0 Z" fill="none" stroke="#a3a9bf" stroke-width="1.2"/>`
      + `<circle r="1.8" fill="#a3a9bf"/>`;
  return `<g transform="translate(${cx},${cy})" style="cursor:pointer" onclick="dkeToggleFog(${li})">`
    + `<title>${hid ? 'Hidden from players — tap to reveal' : 'Revealed — tap to hide from players'}</title>`
    + `<circle r="9" fill="transparent"/>${glyph}</g>`;
}
function dkeToggleFog(li){
  if(typeof isReferee !== 'function' || !isReferee()) return;
  const deck = dkeMapDeck(); if(!deck || !(deck.links||[])[li]) return;
  if(deck.links[li].hid) delete deck.links[li].hid;
  else deck.links[li].hid = 1;
  if(typeof saveAuthoredStations === 'function') saveAuthoredStations();
  if(typeof renderStationMap === 'function') renderStationMap();
  if(typeof updateNodes === 'function') updateNodes();
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
    if(!lk.hid) return;
    const room = dkeRoomCells(deck, lk.x, lk.y);
    if(room && room.some(c => c.x === token.x && c.y === token.y)){
      delete lk.hid;
      const a = areas[lk.a];
      revealed = (a && a.label) || lk.a;
    }
  });
  if(revealed && typeof showToast === 'function') showToast('Revealed ' + revealed + ' to players');
  return !!revealed;
}

// ── Tokens ───────────────────────────────────────────────────────────────────
const DKE_TOKEN_COLS = ['#5b8ef0','#d4913a','#4caf82','#D4A843','#9B59B6','#2AABB8','#c0506e','#7f93b8'];
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
  const url = (typeof portraitUrlFor === 'function') ? portraitUrlFor(t.n) : '';
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
    + pulse + strike + badge
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
  // Floorplan image UNDERLAY (bottom of the stack) — the referee traces walls,
  // doors and links on top. Fit inside the grid box, aspect preserved.
  const imgUrl = dkeDeckImgUrl(deck);
  if(imgUrl){
    const op = (deck.img && typeof deck.img.op === 'number') ? deck.img.op : 0.55;
    out += `<image href="${eh(imgUrl)}" x="0" y="0" width="${deck.w*C}" height="${deck.h*C}" opacity="${op}" preserveAspectRatio="xMidYMid meet" style="pointer-events:none" onerror="this.remove()"/>`;
  }
  // Floors next, grid over them (Roll20-style), structure on top.
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
  const refView = !!opt.interactive && (typeof isReferee === 'function') && isReferee();
  let doorCtl = '';   // referee-only door tap targets, appended ABOVE the room taps
  (deck.doors||[]).forEach((d, i) => {
    out += dkeOpeningSVG(d);
    if(refView && (d.t || 'door') === 'door') doorCtl += `<g style="cursor:pointer" onclick="event.stopPropagation();dkeCycleDoor(${i})"><title>Door: ${eh(d.s||'closed')} — tap to cycle</title>${dkeOpeningHitSVG(d)}</g>`;
  });
  (deck.props||[]).forEach(p => {
    const def = DKE_PROPS[p.t]; if(!def) return;
    const f = dkePropFootprint(p);   // 1×1 → (x+.5,y+.5)·C, unchanged from before
    out += `<g transform="translate(${(p.x+f.fw/2)*C},${(p.y+f.fh/2)*C}) rotate(${p.r||0})"><title>${eh(def.n)}</title>${def.g}</g>`;
  });
  (deck.labels||[]).forEach(l => {
    out += `<text x="${l.x*C}" y="${l.y*C}" text-anchor="middle" font-size="11" font-weight="600" fill="#e8eaf0" font-family="system-ui,sans-serif" letter-spacing=".5" style="pointer-events:none">${eh(l.t)}</text>`;
  });
  const areas = (typeof stationAreas === 'function') ? stationAreas() : {};
  const seenArea = {};
  let roomLayer = '', markerLayer = '', fogDim = '', fogPlayer = '';
  (deck.links||[]).forEach((lk, li) => {
    const a = areas[lk.a]; if(!a) return;
    const ac = a.ac || '#7f93b8', cx = (lk.x+.5)*C, cy = (lk.y+.5)*C;
    const open = opt.interactive ? ` style="cursor:pointer" onclick="selArea('${eh(lk.a)}')"` : '';
    const room = dkeRoomCells(deck, lk.x, lk.y);
    const hid = !!lk.hid;
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
    // Fog of war, referee side (station view AND editor): hidden rooms stay
    // readable under a dim wash drawn below the markers.
    if(hid && room) fogDim += `<path d="${dkeRoomFillD(room)}" fill="#0f1117" opacity=".55" style="pointer-events:none"/>`;
    markerLayer += `<g${open}><circle${(wantId && !room) ? ` id="r-${eh(lk.a)}"` : ''} cx="${cx}" cy="${cy}" r="9" fill="#0f1117" stroke="${eh(ac)}" stroke-width="2"/>`
         + `<circle cx="${cx}" cy="${cy}" r="3" fill="${eh(ac)}"/>`
         + `<text x="${cx}" y="${cy+20}" text-anchor="middle" font-size="9" font-weight="600" fill="${eh(ac)}" font-family="system-ui,sans-serif">${eh(a.label||lk.a)}</text></g>`;
    // Referee reveal toggle — an eye under the marker name on the station view.
    if(refView) markerLayer += dkeFogEyeSVG(cx, cy + 31, li, hid);
  });
  // Rooms under markers: a tap anywhere in the room opens the area, but each
  // marker stays individually tappable even inside another marker's room.
  out += roomLayer + fogDim + markerLayer + doorCtl;
  if((deck.tokens||[]).length){
    // One shared circle clip for every portrait (objectBoundingBox = it fits
    // each <image> wherever it sits). The id is prefixed per surface (opt.idp)
    // because the editor canvas and the station map can be in the DOM at once.
    out += `<defs><clipPath id="${eh(opt.idp||'sta')}-tkclip" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath></defs>`;
    const initRows = dkeInitRows();
    deck.tokens.forEach((t, i) => { out += dkeTokenSVG(t, opt, dkeInitFor(initRows, t.n), i); });
  }
  out += fogPlayer;   // player fog last — it must cover tokens inside hidden rooms
  if(opt.sel) out += dkeSelHighlightSVG(deck, opt.sel);
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
  return out;
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
let dkeIsOpen = false, dkeTool = 'room', dkeSel = null, dkeUndoStack = [];
let dkePropType = 'console', dkeLinkArea = '', dkeTokenName = '';
let dkeRuler = null;         // last completed editor measurement {a:{x,y}, b:{x,y}}
let dkeRulerAnchor = null;   // pending first cell for a tap-tap measurement
let dkeTplMode = 'stamp';    // Rooms tool: 'stamp' (place a template) | 'copy' (grab a region)
let dkeTplSel = 'cabin';     // selected template key, or '__clip' for the clipboard
let dkeClipTpl = null;       // template captured by Copy area
let dkeOpenType = 'door';    // Openings tool: 'door' | 'window'
let dkeOpenLen = 1;          // Openings tool: length in cells (1–3)
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
  select:'Tap anything to select it. Drag props, labels and links to move them.',
  room:'Drag a rectangle — floor and perimeter walls are placed in one go.',
  floor:'Drag to paint floor tiles cell by cell.',
  wall:'Drag from corner to corner to place a straight wall (diagonals allowed).',
  poly:'Tap corner after corner to chain walls. Tap the glowing start dot to close the loop into a room, or End the run from the bar above.',
  door:'Pick door or window + a length above, then tap a wall edge to place it. Tap a door to cycle closed → open → locked; tap a window to remove it. Erase or Select+Delete removes doors.',
  prop:'Pick a stamp above, then tap a cell. Multi-cell stamps grow right/down from the tap. Tap the same prop again to rotate it.',
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
      <label class="dke-dim">W <input id="dke-w" type="number" min="4" max="64"></label>
      <label class="dke-dim">H <input id="dke-h" type="number" min="4" max="64"></label>
      <button class="hx-act-btn" style="flex:0 0 auto" id="dke-undo" title="Undo">↶ Undo</button>
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
  document.getElementById('dke-done').addEventListener('click', dkeClose);
  document.getElementById('dke-w').addEventListener('change', function(){ dkeResize('w', this.value); });
  document.getElementById('dke-h').addEventListener('change', function(){ dkeResize('h', this.value); });
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
  dkeSel = null; dkePoly = null; dkeGesture = null; dkeUndoStack = []; dkePtrs.clear(); dkePinch = null;
  document.getElementById('dke-wrap').classList.add('open');
  document.getElementById('dke-title').textContent = (String(titleName || 'STATION').toUpperCase()) + ' — DECK PLAN';
  document.getElementById('dke-w').value = d.w;
  document.getElementById('dke-h').value = d.h;
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
  dkeUndoStack = [];
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
function dkeShipDeckSVG(deck){
  const nm = (typeof shipState !== 'undefined' && shipState.name) ? String(shipState.name).toUpperCase() : 'SHIP';
  const title = (deck && deck.name) ? `${nm} — ${String(deck.name).toUpperCase()}` : `${nm} — DECK PLAN`;
  return `<text x="0" y="-10" font-size="12" font-weight="700" fill="#e8eaf0" font-family="system-ui,sans-serif" letter-spacing="1">${dkeEsc(title)}</text>`
    + dkeContentSVG(dkeNorm(deck), { idp:'ship' });
}
// Ship Status section (called from renderShipPanel in js/75-ship.js).
function dkeShipStudioRowHTML(){
  const ref = (typeof isReferee === 'function') && isReferee();
  const deck = (typeof shipState !== 'undefined') ? dkeCurrentDeck(shipState) : null;
  const has = deck && deckHasContent(deck);
  let inner = '';
  if(has){
    inner += `<svg viewBox="${deckStationViewBox(deck)}" style="width:100%;height:auto;max-height:60vh;display:block">${dkeShipDeckSVG(deck)}</svg>`;
  }
  if(ref){   // players with no deck see nothing (no empty section clutter)
    inner += `<button class="cbt-btn" style="width:100%;margin-top:${has ? '8px' : '0'}" onclick="dkeOpenShip()">🗺 ${has ? 'Edit' : 'Draw'} ship deck plan</button>`;
  }
  if(!inner) return '';
  return `<div class="sf-sec"><div class="sf-tab">Deck Plan</div><div class="sf-card">${inner}</div></div>`;
}

// ── Deck switcher (editor: add / rename / delete / switch the active deck) ────
function dkeRenderDecks(){
  const el = document.getElementById('dke-decks'); if(!el) return;
  const s = dkeHolder();
  const decks = dkeDeckList(s), cur = dkeDeckIndex(s);
  el.innerHTML = decks.map((dk, i) =>
    `<button class="dke-deck${i===cur?' on':''}" onclick="dkeSwitchDeck(${i})">${dkeEsc(dkeDeckName(dk, i))}</button>`).join('')
    + `<button class="dke-deck dke-deck-add" onclick="dkeAddDeck()" title="Add a deck">＋ Deck</button>`
    + `<button class="dke-deck" onclick="dkeRenameDeck(${cur})" title="Rename this deck">✎</button>`
    + (decks.length > 1 ? `<button class="dke-deck dke-danger" onclick="dkeRemove()" title="Remove this deck">🗑</button>` : '');
}
function dkeSwitchDeck(i){
  const s = dkeHolder(); if(!s) return;
  dkeFlushSave();
  const decks = dkeEnsureDecks(s);
  s.deckIdx = Math.max(0, Math.min(decks.length - 1, i));
  dkeSel = null; dkePoly = null; dkeUndoStack = [];   // undo is per-deck
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
  if(g) g.innerHTML = d ? dkeContentSVG(d, { editor:true, sel:dkeSel, idp:'dke' }) : '';
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
  if(t !== 'ruler'){ dkeRuler = null; dkeRulerAnchor = null; dkeGhost(''); }
  if(t !== 'select'){ dkeSel = null; dkeRenderContent(); }
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
    }).join('');
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
    const areas = (typeof stationAreas === 'function') ? stationAreas() : {};
    const ids = Object.keys(areas);
    html = ids.length
      ? `<select class="hx-edit-in" style="max-width:240px" onchange="dkeLinkArea=this.value">`
        + `<option value="">— pick an area —</option>`
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
  } else if(dkeTool === 'select' && dkeSel){
    const d = dkeD(), it = d ? (d[dkeSel.kind+'s']||[])[dkeSel.i] : null;
    if(it){
      if(dkeSel.kind === 'prop') html += `<button class="dke-tool" onclick="dkeRotateSel()">⟳ Rotate</button>`;
      if(dkeSel.kind === 'label') html += `<input class="hx-edit-in" style="max-width:200px" value="${eh(it.t)}" onchange="dkeEditLabelSel(this.value)">`;
      if(dkeSel.kind === 'token') html += `<input class="hx-edit-in" style="max-width:200px" value="${eh(it.n)}" onchange="dkeEditTokenSel(this.value)">`;
      html += `<button class="dke-tool dke-danger" onclick="dkeDeleteSel()">🗑 Delete</button>`;
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
}
function dkeUndoPop(){
  const s = dkeHolder();
  if(!s || !dkeUndoStack.length) return;
  const decks = dkeEnsureDecks(s), d = dkeNorm(JSON.parse(dkeUndoStack.pop()));
  decks[dkeDeckIndex(s)] = d;            // undo applies to the active deck (stack cleared on switch)
  dkeSel = null; dkePoly = null;
  document.getElementById('dke-w').value = d.w;
  document.getElementById('dke-h').value = d.h;
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
  dkeSave();
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
  const p = d.props[dkeSel.i]; if(p){ p.r = ((p.r||0) + 90) % 360; dkeClampProp(d, p); }
  dkeCommit();
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
  } else if(dkeTool === 'ruler'){
    dkeGesture = { t:'ruler', a: dkeCellClamped(p), moved:false };
  } else if(dkeTool === 'template' && dkeTplMode === 'copy'){
    const v = dkeVertex(p);
    dkeGesture = { t:'tplcopy', x0: v.x, y0: v.y, x1: v.x, y1: v.y };
  } else if(dkeTool === 'select'){
    const hit = dkeHitTest(p);
    if(hit && (hit.kind === 'prop' || hit.kind === 'label' || hit.kind === 'link' || hit.kind === 'token')){
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
    else { const np = { t: dkePropType, x: c.x, y: c.y, r: 0 }; dkeClampProp(d, np); d.props.push(np); }
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
  if(!g.moved) return;                       // plain tap — let normal clicks run
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

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
  stairs  : { n:'Stairs',   g:'<rect x="-11" y="-11" width="22" height="22" fill="#0f1117" stroke="#a3a9bf" stroke-width="1.3"/><path d="M-11,-5.5 h22 M-11,0 h22 M-11,5.5 h22" stroke="#a3a9bf" stroke-width="1"/>' }
};

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
// Current station's deck (editor always mutates through here so undo/redo and
// the poll's stationAdditions replacement can never leave a stale reference).
function dkeD(){
  if(typeof currentStationId === 'undefined') return null;
  // The built-in Aurelia station carries its deck under stationAdditions['aurelia']
  // too (a deck-only holder — its areas still come from MAIN); when it has content
  // the deck overrides the hand-drawn canon map (see renderStationMap, js/40).
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
  const refView = !!opt.interactive && (typeof isReferee === 'function') && isReferee();
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
  out += roomLayer + fogDim + markerLayer;
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
  if(sel.kind === 'door')  return it.o === 'h'
    ? `<rect x="${it.x*C}" y="${it.y*C-6}" width="${C}" height="12" ${S}/>`
    : `<rect x="${it.x*C-6}" y="${it.y*C}" width="12" height="${C}" ${S}/>`;
  if(sel.kind === 'prop')  return `<rect x="${it.x*C+2}" y="${it.y*C+2}" width="${C-4}" height="${C-4}" rx="3" ${S}/>`;
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
  let out = `<text x="0" y="-10" font-size="12" font-weight="700" fill="#e8eaf0" font-family="system-ui,sans-serif" letter-spacing="1">${dkeEsc(name)} — DECK PLAN</text>`
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
let dkeView = { x:0, y:0, w:100, h:100 };
let dkePoly = null;                 // active wall-run last vertex {x,y}
let dkeGesture = null;              // single-pointer gesture state
const dkePtrs = new Map();          // pointerId → {x,y}
let dkePinch = null;                // last two-pointer metrics {d,mx,my}
let dkeSaveTimer = null, dkeDirty = false;

const DKE_TOOLS = [
  ['pan','✋ Pan'], ['select','➤ Select'], ['room','▭ Room'], ['floor','▦ Floor'],
  ['wall','─ Wall'], ['poly','⟋ Wall run'], ['door','🚪 Door'], ['prop','📦 Props'],
  ['token','⬤ Tokens'], ['label','🏷 Label'], ['link','⊕ Area link'], ['ruler','📏 Range'], ['erase','⌫ Erase']
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
  token:'Pick a character above (or type any name), then tap to place. Tap a placed token to remove it; Select drags it around.',
  label:'Type the text above, then tap the map to place it.',
  link:'Pick an area above, then tap a room — players tap the marker to open that area.',
  ruler:'Tap two cells (or drag between them) to measure — distance in metres and the range band. Set the scale above.',
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
  if(typeof currentStationId === 'undefined') return;
  // The built-in Aurelia station has no stationAdditions entry (its areas come from
  // MAIN), so seed a deck-only holder for it — that lets the canon station carry a
  // drawable deck like authored stations, overriding the hand-drawn map once drawn.
  let s = stationAdditions[currentStationId];
  if(!s){ if(currentStationId === 'aurelia'){ s = stationAdditions['aurelia'] = {}; } else { return; } }
  if(!s.deck) s.deck = dkeBlank();
  dkeNorm(s.deck);
  dkeEnsureDom();
  dkeIsOpen = true; dkeTool = deckHasContent(s.deck) ? 'select' : 'room';
  dkeSel = null; dkePoly = null; dkeGesture = null; dkeUndoStack = []; dkePtrs.clear(); dkePinch = null;
  document.getElementById('dke-wrap').classList.add('open');
  const stnName = (typeof stationDef === 'function' && stationDef() && stationDef().name) || s.name || 'STATION';
  document.getElementById('dke-title').textContent = (stnName.toUpperCase()) + ' — DECK PLAN';
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
    const i = d.doors.findIndex(dr => dr.x === e.x && dr.y === e.y && dr.o === e.o);
    if(i >= 0) return { kind:'door', i };
  }
  for(let i = d.tokens.length - 1; i >= 0; i--)
    if(Math.hypot(u.x - (d.tokens[i].x+.5), u.y - (d.tokens[i].y+.5)) < .5) return { kind:'token', i };
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

function dkeMapDeck(){
  if(typeof currentStationId === 'undefined') return null;
  const s = (typeof stationAdditions !== 'undefined') ? stationAdditions[currentStationId] : null;
  return (s && s.deck && deckHasContent(s.deck)) ? s.deck : null;
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

#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Deck-editor logic harness — headless checks for the geometry-heavy parts of
// js/41-deck-editor.js (angled-wall openings, floor clipping, room merge, the
// Openings placement preview, and referee custom props).
//
//   node tools/deck-harness.mjs
//
// WHY THIS EXISTS: the deck editor lives inside a password-gated single-file app
// and this environment rasterises the browser preview at 0×0, so screenshots
// can't verify it. Instead we EXTRACT the pure functions from the source by
// brace-matching their declarations, run them in a Node closure with a few
// stubbed browser/app globals, and assert their outputs. Each deck-editor feature
// batch added a throwaway version of these; this is their permanent home.
//
// It is deliberately dependency-free (no npm) and self-contained. If a function
// is renamed in the source, extraction throws "not found: <name>" — that is the
// harness telling you the API moved, not a spurious failure; update the name list.
//
// DKE_PROPS is a minimal stub (console 1×1, container 2×1) — enough for the
// footprint maths under test; it is NOT the live catalogue.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'js', '41-deck-editor.js'), 'utf8');

// Slice out a `function NAME(...) { ... }` by brace-matching from its declaration.
function grab(name){
  const m = src.indexOf('function ' + name + '(');
  if(m < 0) throw new Error('not found: ' + name + ' (was it renamed in js/41-deck-editor.js?)');
  let depth = 0, j = src.indexOf('{', m);
  for(; j < src.length; j++){ const c = src[j]; if(c === '{') depth++; else if(c === '}'){ depth--; if(depth === 0){ j++; break; } } }
  return src.slice(m, j);
}

const NAMES = [
  // geometry / rooms
  'dkeSegDist','dkeCellPt',
  'dkeIsDiagWall','dkeNearestDiagWall','dkeDiagOpeningSpan','dkeDiagOpeningHit','dkeDiagOpeningSVG',
  'dkeClipCellHalfPlane','dkeDiagFloorCuts',
  'dkeSharedEdges','dkeRemoveEdgeWall','dkeOpeningCovers','dkeRoomCells','dkeEdgeWalled','dkeWallBlocks',
  'dkeIsDiagWall','dkeSegsIntersect','dkeCenterOnDiag','dkeDiagWallBetween','dkeFloorSet','dkeFillPolygon','dkePointInPoly',
  // room records + auto-detection + window see-through
  'dkeNewRoomId','dkeRoomEnclosed','dkeEnclosedRegions','dkeRoomForCell','dkeRoomById','dkeRoomLiveCells',
  'dkeSyncRooms','dkeRoomName','dkeRoomPending','dkeOpeningSides','dkeIsWindow','dkeIsClearWindow',
  'dkeWindowGraph','dkeWindowCluster','dkeRoomVisibleToPlayers','dkeRoomSeenThroughWindow',
  // openings preview + edges
  'dkeNearestEdge','dkeDoorPreview',
  // copy / paste
  'dkeCaptureRegion','dkeStampTemplate','dkeAddWall',
  // custom props
  'dkeIsCustomProp','dkeCustomDef','dkeCustomImgUrl','dkeSetPropType',
  'dkePropScaleOf','dkePropFootprint','dkePropCells','dkeClampProp','dkeNorm'
];

const prelude = `
const DKE_CELL = 32, DKE_MAXDIM = 96;
const DKE_PROPS = { console:{ n:'Computer', w:1, h:1, g:'' }, container:{ n:'Container', w:2, h:1, g:'' } };
const activeCampaignId = 'camp';
function deckMapUrlFor(camp, id, ver){ return 'https://x/' + camp + '/' + id + (ver ? ('?v=' + ver) : ''); }
let __deck = null, __ghost = '', dkeOpenType = 'door', dkeOpenLen = 1;
function dkeD(){ return __deck; }
function dkeGhost(m){ __ghost = m; }
// Room-record helpers reference these module globals / app functions at runtime.
let dkeRoomSeq = 0;
const __revealed = new Set();
function isRevealed(id){ return __revealed.has(id); }
`;
const body = prelude + NAMES.map(grab).join('\n')
  + `\nreturn Object.assign({ ${NAMES.join(', ')} }, {
       _setDeck:(d)=>{ __deck = d; }, _ghost:()=>__ghost,
       _reveal:(id)=>__revealed.add(id), _hide:(id)=>__revealed.delete(id), _clearReveal:()=>__revealed.clear(),
       _setOpen:(t,l)=>{ dkeOpenType = t; dkeOpenLen = l; } });`;
const M = new Function(body)();

// ── tiny assertion kit ───────────────────────────────────────────────────────
let pass = 0, fail = 0; const fails = [];
const ok = (c, msg) => { if(c){ pass++; } else { fail++; fails.push(msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b),
  msg + '  (got ' + JSON.stringify(a) + ', exp ' + JSON.stringify(b) + ')');
const px = n => (n * 32).toFixed(2);
const find = (arr, p) => arr.find(p);

// ═══ GROUP 1 — angled-wall openings, floor cuts, room merge ══════════════════
(() => {
  const diagWall = { x1:2, y1:6, x2:6, y2:2 };
  M._setDeck({ w:10, h:10, walls:[ { x1:0,y1:0,x2:4,y2:0 }, diagWall ] });

  const near = M.dkeNearestDiagWall({ x: px(4), y: px(4) }, .5);
  ok(near && near.w === diagWall, 'nearestDiag picks the diagonal wall (not the axis wall)');
  ok(near && Math.abs(near.t - 0.5) < 1e-6, 'projection t at wall midpoint ≈ 0.5');
  ok(M.dkeNearestDiagWall({ x: px(0), y: px(0) }, .4) === null, 'far tap → no diagonal');

  const span = M.dkeDiagOpeningSpan(near, 2);
  ok(Math.abs(Math.hypot(span.x2-span.x1, span.y2-span.y1) - 2) < 1e-6, 'len-2 span is 2 grid-units long');
  ok(Math.abs((span.x1+span.x2)/2 - 4) < 1e-6 && Math.abs((span.y1+span.y2)/2 - 4) < 1e-6, 'span centred on projection');
  const span2 = M.dkeDiagOpeningSpan({ w: diagWall, t: 0.05 }, 3);
  const t0 = (span2.x1 - diagWall.x1) / (diagWall.x2 - diagWall.x1);
  ok(t0 >= -1e-9 && t0 <= 1, 'clamped span stays on the wall');

  const op = { o:'d', x1:span.x1, y1:span.y1, x2:span.x2, y2:span.y2 };
  ok(M.dkeDiagOpeningHit(op, { x:4, y:4 }, .3), 'diag opening hit on centre');
  ok(!M.dkeDiagOpeningHit(op, { x:1, y:9 }, .3), 'diag opening miss far away');

  const svgClosed = M.dkeDiagOpeningSVG(op);
  ok(/#D4A843/.test(svgClosed) && /#0f1117/.test(svgClosed), 'closed diag door: gold leaf over dark gap');
  ok(/#7fd4e0/.test(M.dkeDiagOpeningSVG({ ...op, t:'window' })), 'diag window: pale glass');
  const svgLocked = M.dkeDiagOpeningSVG({ ...op, s:'locked' });
  ok(/#c0506e/.test(svgLocked) && /circle/.test(svgLocked), 'locked diag door: red + keyhole');
  ok(!/NaN/.test(svgClosed + M.dkeDiagOpeningSVG({ ...op, t:'window' }) + svgLocked), 'no NaN in diag opening SVG');
  ok(M.dkeOpeningCovers(op, { x:4, y:4, o:'h' }) === false, 'axis-edge cover test ignores diag openings');

  const floors4 = [{ x:0, y:0, w:4, h:4 }];
  const cutsA = M.dkeDiagFloorCuts({ w:4, h:4, floors:floors4, walls:[{ x1:2,y1:0,x2:4,y2:2 }] });
  ok(cutsA.length > 0, 'chamfer produces floor cuts');
  ok(cutsA.every(poly => poly.every(pt => pt.x - pt.y >= 2 - 1e-6)), 'all cut polygons on the exterior (x-y>=2)');
  eq(M.dkeDiagFloorCuts({ w:6, h:6, floors:[{x:0,y:0,w:6,h:6}], walls:[{x1:0,y1:0,x2:6,y2:6}] }), [], 'interior partition diagonal → no cut');
  eq(M.dkeDiagFloorCuts({ w:4, h:4, floors:floors4, walls:[{x1:0,y1:0,x2:4,y2:0}] }), [], 'axis-only deck → zero cuts');
  const clip = M.dkeClipCellHalfPlane(0, 0, (x) => x - 0.5);
  ok(clip.length === 4 && clip.every(pt => pt.x >= 0.5 - 1e-9), 'half-plane clip keeps the x>=0.5 side');

  const twoRooms = () => ({
    w:6, h:4,
    floors:[{ x:0,y:0,w:2,h:2 }, { x:2,y:0,w:2,h:2 }],
    walls:[
      { x1:0,y1:0,x2:2,y2:0 }, { x1:2,y1:0,x2:2,y2:2 }, { x1:2,y1:2,x2:0,y2:2 }, { x1:0,y1:2,x2:0,y2:0 },
      { x1:2,y1:0,x2:4,y2:0 }, { x1:4,y1:0,x2:4,y2:2 }, { x1:4,y1:2,x2:2,y2:2 }
    ],
    doors:[{ x:2, y:0, o:'v' }]
  });
  let d = twoRooms();
  const roomA = M.dkeRoomCells(d, 0, 0), roomB = M.dkeRoomCells(d, 2, 0);
  ok(roomA.length === 4 && roomB.length === 4, 'before merge: two 4-cell rooms');
  ok(!new Set(roomA.map(c=>c.x+','+c.y)).has('2,0'), 'before merge: room A excludes room B');
  const shared = M.dkeSharedEdges(roomA, roomB);
  eq(shared.map(e=>e.o+e.x+','+e.y).sort(), ['v2,0','v2,1'], 'shared boundary = the two v-edges at x=2');
  shared.forEach(e => M.dkeRemoveEdgeWall(d, e.x, e.y, e.o));
  ok(M.dkeRoomCells(d, 0, 0).length === 8, 'after merge: one 8-cell room');
  ok(d.doors.length === 0, 'door on the shared wall removed by merge');
  ok(d.walls.some(w => w.y1===0 && w.y2===0 && Math.max(w.x1,w.x2)>=4), 'outer top wall survives');

  let d2 = twoRooms();
  d2.walls = d2.walls.filter(w => !(w.x1===2 && w.x2===2));
  d2.walls.push({ x1:2, y1:0, x2:2, y2:4 });
  M.dkeRemoveEdgeWall(d2, 2, 0, 'v'); M.dkeRemoveEdgeWall(d2, 2, 1, 'v');
  const tall = d2.walls.filter(w => w.x1===2 && w.x2===2);
  ok(tall.length === 1 && Math.min(tall[0].y1,tall[0].y2)===2 && Math.max(tall[0].y1,tall[0].y2)===4, 'long shared wall trimmed to its remainder');
  eq(M.dkeSharedEdges([{x:0,y:0}], [{x:5,y:5}]), [], 'non-adjacent rooms share no edges');
})();

// ═══ GROUP 2 — copy/paste preserves angled + typed openings ══════════════════
(() => {
  const deck = {
    w:12, h:12, floors:[{ x:2,y:2,w:4,h:4 }], walls:[{ x1:2,y1:2,x2:6,y2:6 }],
    doors:[ { o:'d', x1:3,y1:3,x2:5,y2:5, t:'window' }, { x:2,y:2,o:'h', t:'window', len:2 }, { x:2,y:6,o:'h', s:'locked' } ],
    props:[], labels:[]
  };
  const tpl = M.dkeCaptureRegion(deck, 2, 2, 6, 6);
  ok(tpl && tpl.doors.length === 3, 'all 3 openings captured (incl. the diagonal)');
  const cd = find(tpl.doors, o => o.o === 'd');
  ok(cd && cd.t === 'window' && cd.x1 === 1 && cd.y1 === 1 && cd.x2 === 3 && cd.y2 === 3, 'diagonal opening survives with translated endpoints + type');
  const cw = find(tpl.doors, o => o.o === 'h' && o.t === 'window');
  ok(cw && cw.len === 2, 'axis window keeps t=window AND len=2');
  ok(find(tpl.doors, o => o.o === 'h' && o.s === 'locked'), 'axis locked door keeps its state');

  const out = { w:12, h:12, floors:[], walls:[], doors:[], props:[], labels:[] };
  M.dkeStampTemplate(out, tpl, 0, 0);
  ok(out.doors.length === 3, 'stamp lays down all 3 openings');
  const sd = find(out.doors, o => o.o === 'd');
  ok(sd && sd.t === 'window' && sd.x1 === 1 && sd.x2 === 3, 'stamped diagonal window intact');
  ok(find(out.doors, o => o.o === 'h' && o.t === 'window').len === 2, 'stamped axis window keeps type + length');
  M.dkeStampTemplate(out, tpl, 0, 0);
  ok(out.doors.length === 3, 'restamp dedups openings');
  M.dkeStampTemplate(out, tpl, 2, 0);
  ok(out.doors.length === 6, 'shifted stamp adds 3 fresh openings');
})();

// ═══ GROUP 3 — Openings placement preview ════════════════════════════════════
(() => {
  const axisDeck = { w:10, h:10, floors:[{x:0,y:0,w:10,h:10}], walls:[{x1:0,y1:0,x2:10,y2:0}] };
  const diagDeck = { w:10, h:10, floors:[{x:2,y:2,w:4,h:4}], walls:[{x1:2,y1:6,x2:6,y2:2}] };

  M._setDeck(axisDeck); M._setOpen('door', 1);
  M.dkeDoorPreview({ x: 3.5*32, y: 2.05*32 });
  let g = M._ghost();
  ok(/#D4A843/.test(g), 'axis door preview is gold');
  ok(g.includes(`x1="${px(3)}" y1="${px(2)}" x2="${px(4)}" y2="${px(2)}"`), 'axis ghost spans the targeted h-edge, len 1');

  M._setOpen('window', 2);
  M.dkeDoorPreview({ x: 3.5*32, y: 2.05*32 });
  g = M._ghost();
  ok(/#7fd4e0/.test(g), 'window preview is pale-blue');
  ok(g.includes(`x2="${px(5)}"`), 'window ghost honours length 2');

  M._setDeck(diagDeck); M._setOpen('door', 1);
  const probe = { x: 3.5*32, y: 4.5*32 };
  const span = M.dkeDiagOpeningSpan(M.dkeNearestDiagWall(probe, .4), 1);
  M.dkeDoorPreview(probe);
  g = M._ghost();
  ok(g.includes(`x1="${px(span.x1)}" y1="${px(span.y1)}" x2="${px(span.x2)}" y2="${px(span.y2)}"`), 'diagonal ghost matches computed span');
  ok(Math.abs(span.x1 - span.x2) > 1e-6 && Math.abs(span.y1 - span.y2) > 1e-6, 'preview target is diagonal, not an axis fallback');

  M._setDeck(axisDeck); M._setOpen('door', 1);
  M.dkeDoorPreview({ x: 5.5*32, y: 5.5*32 });
  ok(M._ghost() === '', 'mid-cell over nothing targetable → empty ghost');
})();

// ═══ GROUP 4 — referee custom image props ════════════════════════════════════
(() => {
  ok(M.dkeIsCustomProp('custom:abc') === true, 'custom:abc is custom');
  ok(M.dkeIsCustomProp('console') === false, 'console is not custom');
  ok(M.dkeIsCustomProp(null) === false, 'null is not custom');

  const deck = { w:10, h:10, customProps:[{ id:'throne', n:'Throne', w:3, h:2, ver:111 }] };
  ok(M.dkeCustomDef(deck, 'custom:throne').n === 'Throne', 'dkeCustomDef finds by id');
  ok(M.dkeCustomDef(deck, 'custom:missing') === null, 'dkeCustomDef null for unknown id');

  eq(M.dkePropFootprint({ t:'custom:throne', w:3, h:2, r:0 }), { fw:3, fh:2 }, 'custom footprint 3x2');
  eq(M.dkePropFootprint({ t:'custom:throne', w:3, h:2, r:90 }), { fw:2, fh:3 }, 'custom footprint swaps at 90');
  eq(M.dkePropFootprint({ t:'custom:throne', w:3, h:2, r:0, s:2 }), { fw:6, fh:4 }, 'custom footprint x scale 2');
  eq(M.dkePropFootprint({ t:'console' }), { fw:1, fh:1 }, 'built-in console still 1x1');
  eq(M.dkePropFootprint({ t:'container', r:90 }), { fw:1, fh:2 }, 'built-in container swaps at 90');
  ok(M.dkePropFootprint({ t:'custom:throne', w:3, h:2, r:15 }).fw === 3, '15deg does not swap footprint');

  eq(M.dkePropCells({ t:'custom:throne', x:1, y:1, w:2, h:2 }).length, 4, 'custom prop covers 2x2 = 4 cells');
  const clamped = { t:'custom:throne', x:9, y:9, w:3, h:2, r:0 };
  M.dkeClampProp(deck, clamped);
  ok(clamped.x === 7 && clamped.y === 8, 'custom prop clamped to fit (7,8)');

  const prop = { t:'console', x:0, y:0, r:0 };
  M.dkeSetPropType(deck, prop, 'custom:throne');
  ok(prop.t === 'custom:throne' && prop.w === 3 && prop.h === 2, 'set to custom copies w/h');
  M.dkeSetPropType(deck, prop, 'console');
  ok(prop.t === 'console' && prop.w === undefined && prop.h === undefined, 'set back to built-in strips w/h');

  const n = M.dkeNorm({});
  ok(Array.isArray(n.customProps) && n.customProps.length === 0, 'dkeNorm seeds customProps = []');
  ok(M.dkeCustomImgUrl(deck, deck.customProps[0]).includes('throne') && M.dkeCustomImgUrl(deck, deck.customProps[0]).includes('v=111'), 'dkeCustomImgUrl builds bucket URL');

  const srcDeck = M.dkeNorm({
    w:10, h:10, floors:[{ x:2,y:2,w:5,h:5 }],
    props:[{ t:'custom:throne', x:3, y:3, r:90, s:2, w:3, h:2, label:'Big chair' }],
    customProps:[{ id:'throne', n:'Throne', w:3, h:2, ver:111 }]
  });
  const tpl = M.dkeCaptureRegion(srcDeck, 2, 2, 7, 7);
  ok(tpl.props.length === 1, 'captured the custom prop');
  const cp = tpl.props[0];
  ok(cp.w === 3 && cp.h === 2 && cp.s === 2 && cp.label === 'Big chair' && cp.r === 90, 'captured prop keeps w/h/s/label/r');
  ok(tpl.customProps.length === 1 && tpl.customProps[0].id === 'throne', 'captured region carries the custom def');

  const destDeck = M.dkeNorm({ w:12, h:12 });
  M.dkeStampTemplate(destDeck, tpl, 0, 0);
  ok(destDeck.customProps.length === 1 && destDeck.customProps[0].id === 'throne', 'stamp merges the custom def into the target deck');
  const placed = destDeck.props[0];
  ok(placed.t === 'custom:throne' && placed.w === 3 && placed.h === 2 && placed.s === 2 && placed.label === 'Big chair', 'stamped custom prop fully intact');
  eq(M.dkePropFootprint(placed), { fw:4, fh:6 }, 'stamped custom prop footprint (w3 h2, r90, s2) = 4x6');
  M.dkeStampTemplate(destDeck, tpl, 4, 4);
  ok(destDeck.customProps.length === 1, 'restamp does not duplicate the custom def');
  ok(destDeck.props.length === 2, 'restamp adds a second placed prop');
})();

// ═══ GROUP 5 — room records: enclosure detection, sync, merge dedup ══════════
(() => {
  const oneRoom = () => ({
    w:8, h:8, floors:[{ x:1,y:1,w:2,h:2 }],
    walls:[ { x1:1,y1:1,x2:3,y2:1 }, { x1:3,y1:1,x2:3,y2:3 }, { x1:3,y1:3,x2:1,y2:3 }, { x1:1,y1:3,x2:1,y2:1 } ],
    doors:[], rooms:[]
  });
  let d = oneRoom();
  const cells = M.dkeRoomCells(d, 1, 1);
  ok(M.dkeRoomEnclosed(d, cells) === true, 'a 2×2 floor ringed by walls is enclosed');
  const regs = M.dkeEnclosedRegions(d);
  ok(regs.length === 1, 'one enclosed region found');
  eq(regs[0].anchor, { x:1, y:1 }, 'region anchor = canonical (min-y,min-x) cell');

  // Open floor with no perimeter walls → not a room.
  const open = { w:8, h:8, floors:[{ x:1,y:1,w:2,h:2 }], walls:[], doors:[], rooms:[] };
  ok(M.dkeRoomEnclosed(open, M.dkeRoomCells(open, 1, 1)) === false, 'un-walled floor is not enclosed');
  ok(M.dkeEnclosedRegions(open).length === 0, 'open floor yields no enclosed regions');

  // Sync auto-creates a pending (fresh) record and is idempotent.
  const made = M.dkeSyncRooms(d, true);
  ok(made.length === 1 && d.rooms.length === 1, 'sync creates exactly one room record');
  ok(d.rooms[0].x === 1 && d.rooms[0].y === 1 && d.rooms[0].fresh === 1, 'new record anchored + flagged fresh');
  ok(M.dkeRoomPending(d.rooms[0]) === true, 'fresh unnamed record is pending (pulses)');
  ok(M.dkeRoomName(d.rooms[0]) === 'Unnamed room', 'unnamed record shows a placeholder name');
  const again = M.dkeSyncRooms(d, true);
  ok(again.length === 0 && d.rooms.length === 1, 'sync is idempotent — no duplicate record');
  ok(M.dkeRoomForCell(d, 2, 2) === d.rooms[0], 'dkeRoomForCell resolves the record from any interior cell');
  ok(M.dkeRoomForCell(d, 6, 6) === null, 'a cell outside the floor resolves to no room');
  d.rooms[0].name = 'Bridge'; delete d.rooms[0].fresh;
  ok(M.dkeRoomPending(d.rooms[0]) === false, 'a named room no longer pends');

  // Naming a room parks it if its walls open up, and it never gets deleted.
  const opened = oneRoom(); M.dkeSyncRooms(opened, false); opened.rooms[0].name = 'Vault';
  opened.walls = opened.walls.filter(w => !(w.x1 === 1 && w.x2 === 1));   // drop the left wall → area opens
  const parked = M.dkeSyncRooms(opened, true);
  ok(parked.length === 0 && opened.rooms.length === 1 && opened.rooms[0].name === 'Vault', 'opening a room parks (keeps) its authored record');
  ok(M.dkeRoomLiveCells(opened, opened.rooms[0]) === null, 'a parked room reports no live cells');
})();

// ═══ GROUP 6 — merge dedups room records; windows share visibility ═══════════
(() => {
  const two = () => ({
    w:8, h:6, floors:[{ x:0,y:0,w:2,h:2 }, { x:2,y:0,w:2,h:2 }],
    walls:[
      { x1:0,y1:0,x2:2,y2:0 }, { x1:2,y1:0,x2:2,y2:2 }, { x1:2,y1:2,x2:0,y2:2 }, { x1:0,y1:2,x2:0,y2:0 },
      { x1:2,y1:0,x2:4,y2:0 }, { x1:4,y1:0,x2:4,y2:2 }, { x1:4,y1:2,x2:2,y2:2 }
    ],
    doors:[], rooms:[]
  });
  let d = two();
  M.dkeSyncRooms(d, false);
  ok(d.rooms.length === 2, 'two enclosed rooms → two records');
  d.rooms[0].name = 'Alpha'; d.rooms[1].name = 'Beta';
  // Remove the shared wall → the rooms flood into one; sync folds the two records.
  M.dkeRemoveEdgeWall(d, 2, 0, 'v'); M.dkeRemoveEdgeWall(d, 2, 1, 'v');
  ok(M.dkeEnclosedRegions(d).length === 1, 'after merge there is a single enclosed region');
  M.dkeSyncRooms(d, true);
  ok(d.rooms.length === 1, 'merge dedups to one room record');
  ok(!!d.rooms[0].name, 'the surviving record keeps an authored name');
  eq({ x:d.rooms[0].x, y:d.rooms[0].y }, { x:0, y:0 }, 're-anchored to the merged region canonical cell');

  // Window see-through: reveal one room, a CLEAR window shows the other; frost blocks it.
  let w = two();
  w.doors = [{ x:2, y:0, o:'v', t:'window' }];
  M.dkeSyncRooms(w, false);
  const A = w.rooms.find(r => r.x === 0), B = w.rooms.find(r => r.x === 2);
  eq(M.dkeOpeningSides({ x:2, y:0, o:'v' }), [{ x:1, y:0 }, { x:2, y:0 }], 'a vertical opening separates the cells left/right of it');
  ok(M.dkeIsClearWindow(w.doors[0]) === true && M.dkeIsWindow(w.doors[0]) === true, 'an un-frosted window is a clear window');
  M._clearReveal();
  ok(M.dkeRoomVisibleToPlayers(w, A) === false, 'nothing revealed → room A hidden');
  M._reveal(A.id);
  ok(M.dkeRoomVisibleToPlayers(w, A) === true, 'revealing A shows A');
  ok(M.dkeRoomVisibleToPlayers(w, B) === true, 'a clear window into A makes B visible too');
  ok(M.dkeRoomSeenThroughWindow(w, B) === true, 'B is flagged as seen-through-window (not itself revealed)');
  ok(M.dkeRoomSeenThroughWindow(w, A) === false, 'A is directly revealed, not merely seen through glass');
  ok(M.dkeWindowCluster(w, A).has('2,0'), 'window cluster of A includes B');
  // Frost the glass → the sight line closes.
  w.doors[0].f = 1;
  ok(M.dkeIsClearWindow(w.doors[0]) === false, 'a frosted window is no longer clear');
  ok(M.dkeRoomVisibleToPlayers(w, B) === false, 'frosted glass hides B again');
  ok(M.dkeRoomVisibleToPlayers(w, A) === true, 'A stays visible — it is directly revealed');
})();

// ═══ GROUP 7 — angled walls bound rooms (detection + selection) ══════════════
(() => {
  // Inclusive intersection: a proper crossing AND a 45° endpoint-touch both count.
  ok(M.dkeSegsIntersect({x:0,y:0},{x:2,y:0},{x:1,y:-1},{x:1,y:1}) === true, 'proper crossing detected');
  ok(M.dkeSegsIntersect({x:0.5,y:0.5},{x:1.5,y:0.5},{x:0,y:1},{x:2,y:-1}) === true, '45° wall touching a centre counts as intersecting');
  ok(M.dkeSegsIntersect({x:0,y:0},{x:1,y:0},{x:2,y:2},{x:3,y:4}) === false, 'a far diagonal does not intersect');

  // A diagonal wall running between two floored cells blocks flood-fill.
  const d = { w:4, h:4, floors:[{x:0,y:0,w:2,h:1}], walls:[{x1:0,y1:1,x2:2,y2:0}], doors:[], rooms:[] };
  ok(M.dkeWallBlocks(d, 0, 0, 1, 0) === true, 'a diagonal wall between two cells blocks passage');
  ok(M.dkeRoomCells(d, 0, 0).length === 1, 'flood-fill stops at the diagonal (1-cell room)');
  // A cell whose centre the diagonal bisects is dropped from the floor (no stray rooms).
  const bis = { w:4, h:4, floors:[{x:0,y:0,w:2,h:2}], walls:[{x1:0,y1:0,x2:2,y2:2}], doors:[], rooms:[] };
  ok(M.dkeCenterOnDiag(bis, 0, 0) === true && M.dkeCenterOnDiag(bis, 1, 1) === true, '45° wall bisects the cells on its line');
  ok(!M.dkeFloorSet(bis).has('0,0') && !M.dkeFloorSet(bis).has('1,1'), 'bisected cells are excluded from the floor set');

  // A diagonal PARTITION splits one floored rectangle into two detected rooms.
  const split = M.dkeNorm({ w:4, h:4,
    floors:[{ x:0,y:0,w:4,h:4 }],
    walls:[ { x1:0,y1:0,x2:4,y2:0 }, { x1:4,y1:0,x2:4,y2:4 }, { x1:4,y1:4,x2:0,y2:4 }, { x1:0,y1:4,x2:0,y2:0 },
            { x1:0,y1:1,x2:4,y2:3 } ]   // a shallow diagonal partition across the room
  });
  const rTop = M.dkeRoomCells(split, 0, 0), rBot = M.dkeRoomCells(split, 0, 3);
  ok(rTop.length > 0 && rBot.length > 0 && !new Set(rTop.map(c=>c.x+','+c.y)).has('0,3'), 'diagonal partition splits the rectangle into two rooms');

  // A room whose perimeter INCLUDES a non-axis diagonal is detected + selectable.
  const room = M.dkeNorm({ w:8, h:8, floors:[], walls:[], doors:[], rooms:[] });
  M.dkeFillPolygon(room, [{x:1,y:1},{x:4,y:1},{x:5,y:3},{x:5,y:5},{x:1,y:5}]);
  M.dkeAddWall(room,1,1,4,1); M.dkeAddWall(room,5,3,5,5); M.dkeAddWall(room,5,5,1,5); M.dkeAddWall(room,1,5,1,1);
  room.walls.push({ x1:4, y1:1, x2:5, y2:3 });
  ok(M.dkeEnclosedRegions(room).length === 1, 'the diagonally-bounded room is one enclosed region');
  M.dkeSyncRooms(room, true);
  ok(room.rooms.length === 1 && M.dkeRoomForCell(room, 2, 2) === room.rooms[0], 'diagonal room auto-detected + selectable');

  // THE REPORTED CASE — an OCTAGON (four 45° chamfered corners).
  const oct = M.dkeNorm({ w:8, h:8, floors:[], walls:[], doors:[], rooms:[] });
  const V = [{x:2,y:0},{x:6,y:0},{x:8,y:2},{x:8,y:6},{x:6,y:8},{x:2,y:8},{x:0,y:6},{x:0,y:2}];
  M.dkeFillPolygon(oct, V);
  M.dkeAddWall(oct,2,0,6,0); M.dkeAddWall(oct,8,2,8,6); M.dkeAddWall(oct,6,8,2,8); M.dkeAddWall(oct,0,6,0,2);   // 4 flat sides
  oct.walls.push({x1:6,y1:0,x2:8,y2:2},{x1:8,y1:6,x2:6,y2:8},{x1:2,y1:8,x2:0,y2:6},{x1:0,y1:2,x2:2,y2:0});      // 4 chamfers
  const oregs = M.dkeEnclosedRegions(oct);
  ok(oregs.length === 1, 'the octagon is a single enclosed room ('+oregs.length+' regions)');
  ok(M.dkeRoomEnclosed(oct, M.dkeRoomCells(oct, 4, 4)) === true, 'octagon interior reports enclosed');
  M.dkeSyncRooms(oct, true);
  ok(oct.rooms.length === 1, 'octagon auto-detected as one room ('+oct.rooms.length+')');
  ok(M.dkeRoomForCell(oct, 4, 4) === oct.rooms[0], 'octagon selectable from its centre');
})();

// ── report ───────────────────────────────────────────────────────────────────
if(fail){
  console.log('deck-harness: ' + pass + ' passed, ' + fail + ' FAILED');
  fails.forEach(m => console.log('  ✗ ' + m));
  process.exit(1);
}
console.log('deck-harness: ' + pass + '/' + pass + ' passed');
process.exit(0);

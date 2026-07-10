// ═══ REAL GALAXY VIEW — seamless galaxy ↔ system zoom (the second map) ═══
// A REAL-space rendering of the SAME live galaxy the hex map draws: one
// zoomable SVG scene where zooming into a star will reveal its system
// (GALAXY → APPROACH → SYSTEM; the reveal lands in a later phase — this
// module currently renders the galaxy overview: stars, lanes, territories).
// Positions derive from the hex layout (HX.hexOf) plus a seeded per-star
// jitter, lanes come from the referee's GX_LANES overlay, and every faction
// lookup routes through HX.effFac so hidden factions redact to "Uncharted"
// exactly as they do on the hex map. Nothing here writes to GALAXY_NODES.
// The HEX | REAL toggle persists per-device (localStorage 'aurelia_map_mode');
// shared state is untouched — this is a UI preference, not campaign data.
// Load order: needs js/00 (core) and js/10 (HX, GALAXY_NODES, GX_LANES,
// GALAXY_FACTIONS, hexPaint). Later-file symbols (escHtml js/96, isReferee
// js/55) are only referenced inside functions that run after boot.
const RealMap = (function(){
  'use strict';

  // ── Tunables (scene units — RPX is scaled down from the hex map's 26 so
  //    hex spacing suits the compact orrery footprint arriving in Phase 2) ──
  const RPX = 15;                 // hex cell radius in REAL scene units
  const JIT = 9;                  // max per-star jitter — under the hex inradius (~13) so every star stays in its own cell
  const ORBIT_INNER = 2.3;        // innermost orbit semi-major
  const ORBIT_OUTER = 9;          // outermost orbit semi-major — compact vs ~26u hex spacing
  const AXIS_RATIO = 0.42;        // semi-minor / semi-major (top-down tilt look)
  const TILT = -28*Math.PI/180;
  const TCOS = Math.cos(TILT), TSIN = Math.sin(TILT);
  const STAR_R = 1.15;            // fallback star radius, scene units
  const ORBIT_SPEED = 0.022;      // rad/s, divided by orbit slot — slow, stately drift
  // Reveal thresholds keyed to the outer orbit's ON-SCREEN size, so the open
  // feels the same on any display.
  const OPEN_MIN = 34;            // px: orrery starts fading in
  const OPEN_FULL = 128;          // px: full system detail (labels)
  // Spotlight: the open system nearest the viewport centre is the focus;
  // neighbours recede toward the floor and drop their labels.
  const FOCUS_FLOOR = 0.24;
  const FOCUS_T = 0.05;
  const R_TERR = 52;              // faction territory blob radius

  // ── Small helpers ──────────────────────────────────────────────────────
  const eh = s => (typeof escHtml==='function' ? escHtml(String(s==null?'':s)) : String(s==null?'':s));
  const at = s => eh(s).replace(/"/g,'&quot;');            // escHtml doesn't cover quotes
  function hashStr(s){ let h=2166136261>>>0; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
  function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
  function axialPx(q,r){ return [ RPX*1.5*q, RPX*Math.sqrt(3)*(r+q/2) ]; }
  // Orbit semi-axes for slot p, and a point on that tilted ellipse at angle t,
  // centred on the system's star at (cx,cy). Mirrors the app's orrery maths but
  // in REAL scene units with a per-system centre (every system keeps its own).
  function orbitAxes(p,maxP){ const a = maxP<=1 ? (ORBIT_INNER+ORBIT_OUTER)/2 : ORBIT_INNER+(ORBIT_OUTER-ORBIT_INNER)*(p-1)/(maxP-1); return [a,a*AXIS_RATIO]; }
  function orbitPt(cx,cy,a,b,t){ const ex=a*Math.cos(t), ey=b*Math.sin(t); return [ cx+ex*TCOS-ey*TSIN, cy+ex*TSIN+ey*TCOS ]; }
  function nodes(){ return (typeof GALAXY_NODES!=='undefined') ? GALAXY_NODES : []; }
  function nodeById(id){ if(typeof GX_MAP!=='undefined' && GX_MAP[id]) return GX_MAP[id]; return nodes().find(x=>x.id===id)||null; }
  // Lane adjacency straight off the shared GX_LANES set (referee overlay).
  function laneNeighbours(id){
    const out=[];
    if(typeof GX_LANES!=='undefined') GX_LANES.forEach(k=>{
      const i=k.indexOf('|'), a=k.slice(0,i), b=k.slice(i+1);
      if(a===id) out.push(b); else if(b===id) out.push(a);
    });
    return out;
  }
  // Faction identity ALWAYS resolves through the hex engine's redaction seam,
  // so a referee-hidden faction reads as "Uncharted" here too (name + colour),
  // and its territory is skipped exactly as the hex map skips it.
  function effFacOf(facId){
    if(typeof HX!=='undefined' && HX.effFac) return HX.effFac(facId);
    return { name:'Independent', color:'#9fb0c8' };
  }
  function facHiddenOf(facId){ return !!(typeof HX!=='undefined' && HX.facHidden && HX.facHidden(facId)); }
  function motionOff(){
    try{ if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true; }catch(e){}
    const r=document.getElementById('root'); return !!(r && r.classList.contains('anim-off'));
  }

  // ── State ──────────────────────────────────────────────────────────────
  let svg=null, scene=null, built=false;
  let modeVal='hex', modeRead=false;           // per-device pref, read lazily
  const view={x:0,y:0,scale:1};
  let fitScale=1, fitted=false, W=0, H=0;
  let extCam=false;                            // a mirrored camera owns the view (table display)
  let hoverNode=null, selectedNode=null, selectedBody=null;   // selectedBody = body id
  let tween=null;                              // {t0,dur,look0,look1,sc0,sc1,dip}
  let needRender=true, anyOpen=false, raf=0;
  let regionsOn=true;
  let tradersOn=true;                          // NPC trader convoy overlay (⚓ dock planets + moving markers)
  let layoutDirty=true, facDirty=true;
  let dcSig=null, dcUndoDone=false, dcRev=0;   // per-world datacard state
  const POS=new Map();                         // node id → {x,y} (derived; never written to nodes)
  let _facDefs='', _facBlobs='', _facLabels='';
  let _lastCam='';

  // ── Derived layout: hex placement (deterministic, shared with the hex map)
  //    + seeded uniform-in-disc jitter. Rebuilt whenever the hex side edits. ──
  function jitterOf(id){
    const rng=mulberry32(hashStr(id+'jit'));
    // Magnitude floor keeps every star OFF its hex centre — dead-centred stars
    // are what made the layout still read as a grid at low jitter.
    const ang=rng()*6.2832, mag=(0.3+0.7*Math.sqrt(rng()))*JIT;
    return [ Math.cos(ang)*mag, Math.sin(ang)*mag ];
  }
  function ensureLayout(){
    if(!layoutDirty) return;
    POS.clear();
    nodes().forEach(n=>{
      let q=null, r=null;
      if(typeof HX!=='undefined' && HX.hexOf){ const h=HX.hexOf(n.id); if(h){ q=h.q; r=h.r; } }
      if(q==null || r==null) return;           // not on the hex map → not on this one either
      const p=axialPx(q,r), j=jitterOf(n.id);
      POS.set(n.id, { x:p[0]+j[0], y:p[1]+j[1] });
    });
    layoutDirty=false;
  }
  function posOf(n){ return POS.get(n.id) || null; }

  // ── Faction territory overlay (tint blobs + empire labels), precomputed.
  //    Visibility mirrors the hex map's rules: independent / uncharted /
  //    unknown / hidden factions get NO tint and NO label. Referee-painted
  //    hexes (hexPaint) render as soft washes at their derived positions. ──
  function ensureFactionOverlay(){
    if(!facDirty) return;
    ensureLayout();
    const FAC=(typeof GALAXY_FACTIONS!=='undefined')?GALAXY_FACTIONS:{};
    const groups={};
    nodes().forEach(n=>{ (groups[n.faction]=groups[n.faction]||[]).push(n); });
    let defs='', blobs='', labels='', gi=0;
    Object.keys(groups).forEach(fk=>{
      if(fk==='independent' || fk==='uncharted' || !FAC[fk] || facHiddenOf(fk)) return;
      const fac=effFacOf(fk), col=fac.color;
      const mem=groups[fk].map(posOf).filter(Boolean);
      if(!mem.length) return;
      const gid='real-fg-'+(gi++);
      defs+=`<radialGradient id="${gid}" cx="50%" cy="50%" r="50%">`+
            `<stop offset="0%" stop-color="${col}" stop-opacity="0.42"/>`+
            `<stop offset="65%" stop-color="${col}" stop-opacity="0.13"/>`+
            `<stop offset="100%" stop-color="${col}" stop-opacity="0"/></radialGradient>`;
      mem.forEach(p=>{ blobs+=`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${R_TERR}" fill="url(#${gid})"/>`; });
      if(mem.length<2) return;
      let cx=0,cy=0; mem.forEach(p=>{cx+=p.x;cy+=p.y;}); cx/=mem.length; cy/=mem.length;
      let rms=0; mem.forEach(p=>{ rms+=(p.x-cx)**2+(p.y-cy)**2; }); rms=Math.sqrt(rms/mem.length);
      const name=(fac.name||fk).toUpperCase();
      let fs=Math.max(14,Math.min(60, rms*0.48));
      const maxW=Math.max(70, rms*2.1), estW=name.length*fs*0.58;
      if(estW>maxW) fs*=maxW/estW;
      fs=Math.max(10,fs);
      labels+=`<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" `+
              `font-size="${fs.toFixed(1)}" fill="${col}" fill-opacity="0.42" class="real-fac-lbl">${eh(name)}</text>`;
    });
    // Referee territory brush — same shared hexPaint the hex map draws.
    const painted=(typeof hexPaint!=='undefined' && hexPaint) ? hexPaint : {};
    Object.keys(painted).forEach(k=>{
      const c=k.split(','), q=+c[0], r=+c[1]; if(!isFinite(q)||!isFinite(r)) return;
      const col=painted[k]; if(!col) return;
      const p=axialPx(q,r);
      blobs+=`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${RPX}" fill="${at(col)}" fill-opacity="0.28"/>`;
    });
    _facDefs=defs; _facBlobs=blobs; _facLabels=labels;
    facDirty=false;
  }

  // ── Planet textures (local ./textures/, precached by sw.js — REAL view
  //    only; the orrery/body views keep the Supabase globes pipeline).
  //    The table mirrors textures/catalog.json: f = local downscale, c =
  //    category, o = the ORIGINAL globes-bucket filename, so a referee's
  //    explicit body.texture (a bucket name) resolves to its local copy. ──
  const TEX_BASE='textures/';
  const TEX_FILES=[
    {f:'csilla.jpg',c:'ice',o:'Csilla (Diffuse 4k)_1920x1080.png'},
    {f:'desert-02.jpg',c:'desert',o:'Desert 02 (Diffuse)_1920x1080.png'},
    {f:'desert-04.jpg',c:'desert',o:'Desert 04 (Diffuse)_1920x1080.png'},
    {f:'desert-05.jpg',c:'desert',o:'Desert 05 (Diffuse)_1920x1080.png'},
    {f:'desert-07.jpg',c:'desert',o:'Desert 07 (Diffuse)_1920x1080_1920x1080.png'},
    {f:'desert-08.jpg',c:'desert',o:'Desert 08 (Diffuse)_1920x1080_1920x1080.png'},
    {f:'exotic-01.jpg',c:'volcanic',o:'Exotic 01 (Diffuse) 4k_1920x1080_1920x1080.png'},
    {f:'exotic-02.jpg',c:'volcanic',o:'Exotic 02 (Diffuse 4k)_1920x1080.png'},
    {f:'exotic-03.jpg',c:'volcanic',o:'Exotic 03 (Diffuse 4k)_1920x1080_1920x1080.png'},
    {f:'felucia.jpg',c:'terran',o:'Felucia (Diffuse)_1920x1080.png'},
    {f:'gaseous-01.jpg',c:'gaseous',o:'Gaseous 01 (Diffuse 4k)_1920x1080.png'},
    {f:'gaseous-02.jpg',c:'gaseous',o:'Gaseous 02 (Diffuse 4k)_1920x1080.png'},
    {f:'gaseous-03.jpg',c:'gaseous',o:'Gaseous 03 (Diffuse 4k)_1920x1080.png'},
    {f:'ice-05.jpg',c:'ice',o:'Ice 05 (Diffuse) 4k_1920x1080_1920x1080.png'},
    {f:'ice-06.jpg',c:'ice',o:'Ice 06 (Diffuse 4k)_1920x1080_1920x1080.png'},
    {f:'korriban.jpg',c:'desert',o:'Korriban (Diffuse 4k)_1920x1080_1920x1080.png'},
    {f:'oceanic-05.jpg',c:'terran',o:'Oceanic 05 (Diffuse 4k)_1920x1080_1920x1080.png'},
    {f:'terran-05.jpg',c:'terran',o:'Terran 05 (Diffuse)_1920x1080_1920x1080.png'},
    {f:'terran-06.jpg',c:'terran',o:'Terran 06 (Diffuse)_1920x1080_1920x1080.png'},
    {f:'terran-09-2.jpg',c:'terran',o:'Terran 09 (Diffuse 4k)_1920x1080_1920x1080.png'},
    {f:'terran-09.jpg',c:'terran',o:'Terran 09 (Diffuse 2 4k)_1920x1080_1920x1080.png'},
    {f:'terran-10.jpg',c:'terran',o:'Terran 10 (Diffuse 4k)_1920x1080_1920x1080.png'},
    {f:'volcanic-01.jpg',c:'volcanic',o:'Volcanic 01 (Diffuse)_1920x1080_1920x1080.png'},
    {f:'volcanic-05.jpg',c:'volcanic',o:'Volcanic 05 (Diffuse 4k)_1920x1080_1920x1080.png'},
    {f:'volcanic-06.jpg',c:'volcanic',o:'Volcanic 06 (Diffuse 4k)_1920x1080_1920x1080.png'},
  ];
  // Preload once per unique URL: texture markup is only ever emitted for a
  // texture confirmed loaded, so the per-frame scene rebuild never re-requests
  // a missing file and never shows a broken tile.
  const _texOk={};
  function preloadTexture(url){
    if(url in _texOk) return;
    _texOk[url]=false;
    const im=new Image();
    im.onload =()=>{ _texOk[url]=true; invalidate(); };
    im.onerror=()=>{ /* leave false → never rendered → procedural fallback */ };
    im.src=url;
  }
  // Textures paint via <pattern> defs living OUTSIDE the innerHTML-swapped
  // scene group. An <image> rebuilt inside the scene every animation frame
  // re-rasterises asynchronously, so big textured planets blinked once open
  // (the ~14× screen flicker); a persistent pattern keeps ONE decoded image
  // alive for the session and per-frame markup only references its id. It
  // also ends the duplicate-clipPath hazard when two bodies round to the
  // same orbit slot. objectBoundingBox units scale the tile to any disc.
  const SVG_NS='http://www.w3.org/2000/svg', XLINK_NS='http://www.w3.org/1999/xlink';
  let _texDefs=null; const _texPatIds={};
  function texPatternId(url){
    if(_texPatIds[url]) return _texPatIds[url];
    if(!svg) return null;
    if(!_texDefs){ _texDefs=document.createElementNS(SVG_NS,'defs'); svg.insertBefore(_texDefs, svg.firstChild); }
    const pid='real-pat-'+url.replace(/[^A-Za-z0-9_-]/g,'-');
    const pat=document.createElementNS(SVG_NS,'pattern');
    pat.setAttribute('id',pid);
    pat.setAttribute('patternContentUnits','objectBoundingBox');
    pat.setAttribute('width','1'); pat.setAttribute('height','1');
    const im=document.createElementNS(SVG_NS,'image');
    im.setAttribute('href',url); im.setAttributeNS(XLINK_NS,'xlink:href',url);
    im.setAttribute('width','1'); im.setAttribute('height','1');
    im.setAttribute('preserveAspectRatio','xMidYMid slice');
    pat.appendChild(im); _texDefs.appendChild(pat);
    _texPatIds[url]=pid;
    return pid;
  }
  function texCategoryOf(b, kind){
    if(typeof defaultTextureCategory==='function') return defaultTextureCategory(b);
    if(kind==='belt' || b.isStar || b.isMoon) return null;   // fallback mirrors js/50
    if(kind==='gas') return 'gaseous';
    const t=(b.type||'').toLowerCase();
    if(/volcan|scorch|lava|molten/.test(t)) return 'volcanic';
    if(/desert|arid|dune|barren/.test(t)) return 'desert';
    if(/ocean|jewel|garden|terran|earth|temperate/.test(t)) return 'terran';
    if(/ice|frozen|glacial|tundra/.test(t)) return 'ice';
    return null;
  }
  // Same precedence as textureUrlFor (js/50) but resolved against the LOCAL
  // set: explicit URL > forced procedural > explicit catalog file (bucket
  // name mapped to its downscale) > auto-match by category, seeded by id.
  function texUrlFor(b, kind){
    if(b.textureUrl) return b.textureUrl;
    if(b.texture==='__none__') return null;
    if(b.texture){ const m=TEX_FILES.find(x=>x.o===b.texture||x.f===b.texture); if(m) return TEX_BASE+m.f; }
    const cat=texCategoryOf(b, kind); if(!cat) return null;
    const pool=TEX_FILES.filter(x=>x.c===cat); if(!pool.length) return null;
    const seed=(typeof seedFromString==='function') ? Math.abs(seedFromString(b.id)) : hashStr(b.id);
    return TEX_BASE+pool[seed%pool.length].f;
  }

  // ── Bodies: EXACTLY the app's shared overlay compose — effectiveBodies() —
  //    adapted to render shape. No procedural generation: a system nobody has
  //    authored is a bare star with no orbits. The adapter is cached per
  //    system and dropped on every shared-data refresh, so Design-Mode edits
  //    (any device) appear on the next render. ──────────────────────────────
  const sysCache=new Map();                    // systemId → adapted system
  function sysIdOf(n){ return n.systemId || n.id; }
  function starSceneR(dr){ return (isFinite(dr)&&dr>0) ? Math.max(0.85, Math.min(1.45, dr/15.6)) : STAR_R; }
  function bodySceneR(dr, kind){
    if(isFinite(dr)&&dr>0) return Math.max(0.34, Math.min(1.25, dr/14.4));
    return kind==='gas' ? 1.1 : 0.55;
  }
  function kindOf(b){
    if(typeof bodyDiscStyle==='function'){
      const d=bodyDiscStyle(b);
      if(d==='belt') return 'belt';
      if(d==='gasgiant') return 'gas';
      return 'terr';
    }
    const t=(b.type||'').toLowerCase();
    if(b.beltDensity!=null || /asteroid belt/.test(t)) return 'belt';
    if(/gas giant|ice giant/.test(t)) return 'gas';
    return 'terr';
  }
  function adaptSystem(n){
    const sysId=sysIdOf(n);
    let sys=sysCache.get(sysId);
    if(sys) return sys;
    const eff=(typeof effectiveBodies==='function') ? (effectiveBodies(sysId)||[]) : [];
    const starB=eff.find(b=>b.isStar);
    const star=starB
      ? { col:starB.color||'#F4D06A', type:starB.type||'Primary Star', r:starSceneR(starB.displayRadius), id:starB.id, name:starB.name }
      : { col:'#F4D06A', type:'Primary Star', r:STAR_R, id:null, name:null };
    // Planets + belts (moons render in the body view, not this overview).
    const raw=eff.filter(b=>!b.isStar && !b.isMoon);
    const used=new Set(); raw.forEach(b=>{ if(isFinite(b.orbitPos)&&b.orbitPos>0) used.add(Math.round(b.orbitPos)); });
    let nextSlot=1;
    const bodies=raw.map(b=>{
      let p=(isFinite(b.orbitPos)&&b.orbitPos>0) ? Math.round(b.orbitPos) : 0;
      if(!p){ while(used.has(nextSlot)) nextSlot++; p=nextSlot; used.add(p); }
      const kind=kindOf(b);
      const rng=mulberry32(hashStr(sysId+'|'+b.id));
      const texUrl=(kind==='belt') ? null : texUrlFor(b, kind);
      if(texUrl) preloadTexture(texUrl);
      return {
        id:b.id, name:b.name||'', type:b.type||'', kind, p,
        theta0:rng()*Math.PI*2, spd:ORBIT_SPEED/(0.6+p*0.55),
        col:b.color||(kind==='belt'?'#8B7355':'#9AA86A'),
        r:kind==='belt'?0:bodySceneR(b.displayRadius,kind),
        ring:kind==='gas'&&!!b.ringStyle, texUrl,
        hook:!!b.hook, uwp:b.uwpString, diameter:b.diameter,
        dock:!!b.tradersDock,
      };
    });
    let maxP=0; bodies.forEach(b=>{ if(b.p>maxP) maxP=b.p; });
    const rawById=new Map(); eff.forEach(b=>rawById.set(b.id,b));   // full app bodies (datacard fields)
    const dockBody=bodies.find(b=>b.dock)||null;                    // "Traders dock here" body (one per system)
    sys={ star, bodies, maxP, slots:Array.from(used).sort((a,b)=>a-b), raw:rawById, dockId:dockBody?dockBody.id:null };
    sysCache.set(sysId,sys);
    return sys;
  }

  // ── NPC trader overlay: the SAME living-economy agents the hex map draws
  //    (ECON.agents, js/90), rendered in REAL space. The new idea here is the
  //    per-system DOCK PLANET: a body flagged "Traders dock here" (tradersDock,
  //    set in the body editor or this map's datacard). Convoy paths anchor at
  //    the dock planet's LIVE orbital position instead of the star, and docked
  //    agents cluster around it — so zooming into a system shows the traders
  //    physically at the planet the system's goods come from. Read-only over
  //    shared econ state; renders for everyone, exactly like the hex overlay. ──
  function econReady(){ try{ return typeof window.ECON!=='undefined' && ECON.active(); }catch(e){ return false; } }
  function econNow(){ try{ return (ECON.state.week||0) + ((typeof window!=='undefined'&&window.econViewFrac)||0); }catch(e){ return 0; } }
  function econAgents(){ try{ return (ECON.agents&&ECON.agents())||[]; }catch(e){ return []; } }
  // Berthed at pos — idle, or loading before departure. Mirrors js/90's isDocked.
  function agentDocked(a,nowT){ return !!(a && a.pos && (!a.route || (a.route.began!=null && a.route.began>nowT))); }
  // Where trader traffic berths in a system: the tradersDock body at its CURRENT
  // orbital position, or the star centre when no body is flagged. A flagged belt
  // berths at a fixed point on its ring (belts don't orbit-animate here).
  function dockAnchor(n,t){
    const pos=posOf(n); if(!pos) return null;
    const sys=adaptSystem(n);
    const bd=sys.dockId ? sys.bodies.find(b=>b.id===sys.dockId) : null;
    if(!bd) return { x:pos.x, y:pos.y, r:sys.star.r, bd:null };
    const axes=orbitAxes(bd.p,sys.maxP);
    const ang=bd.kind==='belt' ? bd.theta0 : bd.theta0 + t*bd.spd;
    const pt=orbitPt(pos.x,pos.y,axes[0],axes[1],ang);
    return { x:pt[0], y:pt[1], r:Math.max(bd.r,0.4), bd };
  }
  // Route a convoy hop-by-hop: BFS over the union of surveyed jump lanes
  // (GX_LANES) and the always-flyable commercial links — the same graphs the
  // hex overlay routes along (visual pathing only; fuel-weighting lives there).
  const tradePathCache=new Map();              // 'from|pickup|to' → [node ids]; cleared on refresh()
  function tradeNeigh(id){
    const out=new Set(laneNeighbours(id));
    const n=nodeById(id); ((n&&(n._loreLinks||n.connections))||[]).forEach(c=>out.add(c));
    return out;
  }
  function tradeLeg(fromId,toId){
    if(!fromId||!toId||fromId===toId) return [fromId];
    const prev={}; prev[fromId]=fromId; const q=[fromId];
    while(q.length){ const u=q.shift(); if(u===toId) break;
      tradeNeigh(u).forEach(v=>{ if(!(v in prev) && POS.has(v)){ prev[v]=u; q.push(v); } }); }
    if(!(toId in prev)) return [fromId,toId];  // unreachable → direct line
    const path=[toId]; let c=toId; while(c!==fromId){ c=prev[c]; path.unshift(c); }
    return path;
  }
  function tradePathIds(route){
    const wp=(route.pickup && route.pickup!==route.from && route.pickup!==route.to) ? route.pickup : null;
    const key=route.from+'|'+(wp||'')+'|'+route.to;
    let ids=tradePathCache.get(key);
    if(!ids){
      ids=tradeLeg(route.from, wp||route.to);
      if(wp) ids=ids.concat(tradeLeg(wp,route.to).slice(1));   // deadhead + laden legs, shared pickup point dropped
      tradePathCache.set(key,ids);
    }
    return ids;
  }
  // In-flight convoys: faint dashed route + a diamond marker walked along it by
  // progress (week + econViewFrac, like the hex map). Berth endpoints (from /
  // pickup / to) land on each system's dock anchor; transit hops pass the star.
  function drawTraders(invS,s){
    if(!tradersOn || !econReady()) return '';
    const agents=econAgents(); if(!agents.length) return '';
    const nowT=econNow(), t=motionOff()?0:(Date.now()/1000);
    const showLbl=(s>fitScale*2.6);
    const flying=agents.filter(a=>a.route && !agentDocked(a,nowT));
    const many=flying.length>30;               // big fleet → drop labels (clutter), keep markers
    let g='<g pointer-events="none">';
    flying.forEach(a=>{
      const ids=tradePathIds(a.route);
      const pts=[];
      ids.forEach((id,i)=>{
        const berth=(i===0 || i===ids.length-1 || id===a.route.pickup);
        if(berth){ const bn=nodeById(id); if(bn){ const d=dockAnchor(bn,t); if(d){ pts.push({x:d.x,y:d.y}); return; } } }
        const p=POS.get(id); if(p) pts.push({x:p.x,y:p.y});
      });
      if(pts.length<2) return;
      let pr=0.5;
      if(a.route.began!=null && a.route.eta>a.route.began)
        pr=Math.max(0.02,Math.min(0.98,(nowT-a.route.began)/(a.route.eta-a.route.began)));
      const seg=[]; let total=0;
      for(let i=0;i<pts.length-1;i++){ const d=Math.hypot(pts[i+1].x-pts[i].x,pts[i+1].y-pts[i].y); seg.push(d); total+=d; }
      let x=pts[0].x, y=pts[0].y;
      if(total>0){ let want=pr*total, acc=0, k=0; while(k<seg.length-1 && acc+seg[k]<want){ acc+=seg[k]; k++; }
        const ff=seg[k]?(want-acc)/seg[k]:0; x=pts[k].x+(pts[k+1].x-pts[k].x)*ff; y=pts[k].y+(pts[k+1].y-pts[k].y)*ff; }
      // Selection follows the econ console, same as the hex overlay.
      const corpSel=(typeof window!=='undefined' && window.econCorpSel && a.backing===window.econCorpSel);
      const sel=(typeof window!=='undefined' && window.econTraderSel===a.id) || corpSel;
      const anySel=(typeof window!=='undefined' && (!!window.econTraderSel || !!window.econCorpSel)), dim=anySel&&!sel;
      const col=sel?'#ffe27a':'#f4d35e', z=(sel?5.5:4)*invS;
      const line=pts.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
      g+=`<polyline points="${line}" fill="none" stroke="${col}" stroke-width="${sel?1.6:0.8}" opacity="${sel?0.8:(dim?0.08:0.22)}" stroke-dasharray="${sel?'none':'2,3'}" vector-effect="non-scaling-stroke"/>`;
      g+=`<polygon points="${(x).toFixed(2)},${(y-z).toFixed(2)} ${(x+z).toFixed(2)},${y.toFixed(2)} ${x.toFixed(2)},${(y+z).toFixed(2)} ${(x-z).toFixed(2)},${y.toFixed(2)}" fill="${col}" stroke="#04060e" stroke-width="${(0.8*invS).toFixed(2)}" opacity="${dim?0.35:1}"/>`;
      if(showLbl && !dim && (sel || !many)){
        const tn=nodeById(a.route.to), fs=(8*invS).toFixed(2);
        g+=`<text x="${(x+6*invS).toFixed(2)}" y="${(y-4*invS).toFixed(2)}" font-size="${fs}" fill="${col}" fill-opacity="0.85" style="font-family:var(--mono,monospace)${sel?';font-weight:700':''}">${eh(a.name+' · '+String(a.route.good||'').replace('Common ','')+' → '+(tn?(tn.label||tn.name):a.route.to))}</text>`;
      }
    });
    g+='</g>';
    return g;
  }

  // ── Fit / zoom (transform maths mirror the prototype) ──────────────────
  function readRect(){ if(!svg) return; const r=svg.getBoundingClientRect(); W=r.width; H=r.height; }
  function fit(){
    if(!svg) return;
    if(extCam){ invalidate(); return; }   // a mirrored camera owns the view — never auto-fit over it
    ensureLayout(); readRect();
    if(!W || !H || !POS.size){ return; }
    let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
    POS.forEach(p=>{ minX=Math.min(minX,p.x); minY=Math.min(minY,p.y); maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y); });
    const pad=40, cw=(maxX-minX)+pad*2, ch=(maxY-minY)+pad*2;
    fitScale=Math.min(W/cw, H/ch)*0.94;
    view.scale=fitScale;
    view.x=W/2-((minX+maxX)/2)*view.scale;
    view.y=H/2-((minY+maxY)/2)*view.scale;
    fitted=true; invalidate();
  }
  function clampScale(s){ return Math.max(fitScale*0.55, Math.min(fitScale*70, s)); }
  function zoomAt(px,py,factor){
    const sx=(px-view.x)/view.scale, sy=(py-view.y)/view.scale;
    view.scale=clampScale(view.scale*factor);
    view.x=px-sx*view.scale; view.y=py-sy*view.scale;
    extCam=false; tween=null; invalidate();
  }

  // ── Camera flights: one tween interpolating a look-at point and the zoom
  //    (in log space). With motion off the flight collapses to an instant jump. ──
  function curLook(){ return { x:(W/2-view.x)/view.scale, y:(H/2-view.y)/view.scale }; }
  function startTween(look1, sc1, dur, dip){
    if(motionOff()){ view.scale=sc1; view.x=W/2-look1.x*sc1; view.y=H/2-look1.y*sc1; tween=null; invalidate(); return; }
    tween={ t0:performance.now(), dur, look0:curLook(), look1, sc0:view.scale, sc1, dip:dip||0 };
    invalidate();
  }
  function flyTo(n){
    const p=posOf(n); if(!p) return;
    startTween({x:p.x,y:p.y}, clampScale(OPEN_FULL*1.5/ORBIT_OUTER), 760, 0);
    extCam=false; selectedNode=n; selectedBody=null; showCard(n);
  }
  // Fly to a specific world: centre it at its CURRENT orbital position and
  // make sure we're zoomed into full system detail. Belts centre on the star.
  function flyToBody(n, bd){
    const pos=posOf(n); if(!pos) return;
    let px=pos.x, py=pos.y;
    if(bd && bd.kind!=='belt'){
      const axes=orbitAxes(bd.p, adaptSystem(n).maxP);
      const ang=bd.theta0 + (motionOff()?0:(Date.now()/1000))*bd.spd;
      const pt=orbitPt(pos.x,pos.y,axes[0],axes[1],ang); px=pt[0]; py=pt[1];
    }
    startTween({x:px,y:py}, clampScale(Math.max(view.scale, OPEN_FULL*1.8/ORBIT_OUTER)), 700, 0);
    extCam=false; selectedNode=n; selectedBody=bd?bd.id:null; if(bd) hideCard(); else showCard(n);
  }
  // Jump along a lane to a neighbour: travel the straight line between the
  // stars, dipping the zoom out on longer lanes so the journey stays visible.
  function jumpTo(fromN, toN){
    const a=posOf(fromN), b=posOf(toN); if(!b) return;
    const sc1=clampScale(OPEN_FULL*1.5/ORBIT_OUTER);
    const D=a ? Math.hypot(b.x-a.x, b.y-a.y) : 0;
    const fitBoth=0.82*Math.min(W,H)/((D+2*ORBIT_OUTER)||1);
    const dip=Math.max(0, Math.min(0.72, 1-fitBoth/sc1));
    startTween({x:b.x,y:b.y}, sc1, 760+Math.min(1000,D*7), dip);
    extCam=false; selectedNode=toN; selectedBody=null; showCard(toN);
  }
  function stepTween(now){
    if(!tween) return;
    let k=(now-tween.t0)/tween.dur; if(k>=1) k=1;
    const e = k<0.5 ? 4*k*k*k : 1-Math.pow(-2*k+2,3)/2;         // easeInOutCubic
    const lx=tween.look0.x+(tween.look1.x-tween.look0.x)*e;
    const ly=tween.look0.y+(tween.look1.y-tween.look0.y)*e;
    const a0=tween.sc0>0?tween.sc0:tween.sc1;
    const base=a0*Math.pow(tween.sc1/a0, e);                    // smooth zoom in log space
    const sc=base*(1-(tween.dip||0)*Math.sin(Math.PI*k));       // mid-flight zoom-out dip
    view.scale=sc; view.x=W/2-lx*sc; view.y=H/2-ly*sc;
    if(k>=1) tween=null;
    needRender=true;
  }

  // ── rAF lifecycle: single-flight, event-driven at the overview. The frame
  //    self-stops whenever the REAL view is not the active, visible map — the
  //    known battery failure mode this guards against. ──
  function active(){
    return built && modeVal==='real' && !document.hidden &&
           (typeof currentView==='undefined' || currentView==='galaxy');
  }
  function frame(now){
    raf=0;
    if(!active()) return;
    if(tween) stepTween(now);
    if(needRender || anyOpen){ needRender=false; render(now); }
    updateDatacard();                        // follow the selected world
    if(tween || (anyOpen && !motionOff())) raf=requestAnimationFrame(frame);
  }
  function invalidate(){ needRender=true; if(!raf && active()) raf=requestAnimationFrame(frame); }

  // ── Render (galaxy overview: territories, lanes, star dots, labels) ────
  function render(now){
    if(!scene) return;
    ensureLayout(); ensureFactionOverlay();
    const s=view.scale, invS=1/s;
    scene.setAttribute('transform',`translate(${view.x},${view.y}) scale(${s})`);
    const camSig=view.x.toFixed(1)+'|'+view.y.toFixed(1)+'|'+s.toFixed(4);
    if(camSig!==_lastCam){ _lastCam=camSig;
      if(typeof window.onRealCameraChanged==='function') window.onRealCameraChanged({x:view.x,y:view.y,scale:s}); }

    // viewport bounds in scene space (with margin) for culling
    const vx0=-view.x*invS-60, vy0=-view.y*invS-60, vx1=(W-view.x)*invS+60, vy1=(H-view.y)*invS+60;
    const z=s/(fitScale||s||1);
    const overviewK=Math.max(0,Math.min(1,(4.5-z)/(4.5-2.0)));   // 1 zoomed out → 0 as systems open

    let out='';
    if(regionsOn && _facBlobs){
      out+=`<defs>${_facDefs}</defs>`;
      out+=`<g opacity="${(0.10+0.75*overviewK).toFixed(3)}" pointer-events="none">${_facBlobs}</g>`;
      if(overviewK>0.01) out+=`<g opacity="${overviewK.toFixed(3)}" pointer-events="none">${_facLabels}</g>`;
    }
    // Jump lanes — the referee's GX_LANES overlay, identical to the hex map.
    let lanes='';
    if(typeof GX_LANES!=='undefined'){
      GX_LANES.forEach(k=>{
        const ids=k.split('|'), a=POS.get(ids[0]), b=POS.get(ids[1]);
        if(!a||!b) return;
        lanes+=`<line class="real-lane" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" vector-effect="non-scaling-stroke"/>`;
      });
    }
    out+=`<g>${lanes}</g>`;

    const outerPx=ORBIT_OUTER*s;                // on-screen radius of the outermost orbit
    const sizeF=Math.max(0, Math.min(1, (outerPx-OPEN_MIN)/(OPEN_FULL-OPEN_MIN)));  // 0 = dot, 1 = full orrery
    const showNames=(s>fitScale*2.6);
    const inV=p=>p.x>vx0&&p.x<vx1&&p.y>vy0&&p.y<vy1;
    let focusNode=null;                         // the system the hotbar / spotlight tracks

    if(sizeF<=0){
      // ── GALAXY overview: faction-coloured dots (through the redaction seam) ──
      nodes().forEach(n=>{
        const p=posOf(n); if(!p||!inV(p)) return;
        const fac=effFacOf(n.faction);
        const hot=(n===hoverNode||n===selectedNode);
        const rr=3.1*invS;
        out+=`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(rr*1.9).toFixed(2)}" fill="${fac.color}" opacity="${hot?0.28:0.14}"/>`;
        out+=`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${rr.toFixed(2)}" fill="${fac.color}" data-node="${at(n.id)}" style="cursor:pointer"/>`;
        if(showNames||hot){ const fs=(11*invS).toFixed(2);
          out+=`<text x="${p.x.toFixed(1)}" y="${(p.y-5.5*invS).toFixed(2)}" text-anchor="middle" font-size="${fs}" class="real-star-lbl${hot?' hot':''}">${eh(n.label||n.name)}</text>`; }
      });
      anyOpen=false;
    } else {
      // ── SYSTEM reveal: spotlight the open system nearest the viewport centre ──
      const minDim=Math.min(W,H), cxp=W/2, cyp=H/2;
      const open=[];
      nodes().forEach(n=>{
        const p=posOf(n); if(!p||!inV(p)) return;
        const px=view.x+p.x*s, py=view.y+p.y*s;
        let dp=Math.hypot(px-cxp,py-cyp);
        if(n===selectedNode) dp-=0.12*minDim;   // a dived-into system "sticks" as the focus
        open.push({n,p,dp});
      });
      let dMin=1e9; open.forEach(o=>{ if(o.dp<dMin) dMin=o.dp; });
      open.forEach(o=>{ if(o.dp===dMin) focusNode=o.n; });   // nearest-centre = spotlight focus
      const T=Math.max(60, FOCUS_T*minDim);
      open.forEach(o=>{
        const em=Math.max(FOCUS_FLOOR, Math.exp(-(o.dp-dMin)/T));
        out+=drawOrrery(o.n,o.p,sizeF,em,invS,s);
        if(sizeF<1){ const fac=effFacOf(o.n.faction); const rr=3.1*invS;
          out+=`<circle cx="${o.p.x.toFixed(1)}" cy="${o.p.y.toFixed(1)}" r="${rr.toFixed(2)}" fill="${fac.color}" opacity="${((1-sizeF)*(0.3+0.7*em)).toFixed(2)}"/>`; }
      });
      anyOpen=open.length>0;
    }
    // NPC trader convoys ride on top at every zoom (guarded — econ is a later module).
    try{ out+=drawTraders(invS,s); }catch(e){}

    scene.innerHTML=out;
    updateHotbar((sizeF>0.35 && focusNode) ? focusNode : null);   // planet hotbar for the focused system
    const zv=document.getElementById('real-zval');
    if(zv) zv.textContent=(s/(fitScale||1)).toFixed(1)+'×';
    const pill=document.getElementById('real-mode-pill');
    if(pill){ const outerPx=ORBIT_OUTER*s;
      pill.textContent = outerPx<OPEN_MIN ? 'GALAXY' : outerPx<OPEN_FULL ? 'APPROACH' : 'SYSTEM'; }
  }

  // ── One system's orrery, drawn in-scene around its star. Bodies are the
  //    adapted effectiveBodies() — a bare star renders with NO orbit rings. ──
  function drawOrrery(n,pos,sizeF,em,invS,s){
    const sys=adaptSystem(n), cx=pos.x, cy=pos.y, maxP=sys.maxP;
    const t=motionOff() ? 0 : (Date.now()/1000);   // shared epoch: every device/window agrees
    const tiltDeg=(TILT*180/Math.PI).toFixed(1);
    let g=`<g opacity="${(sizeF*em).toFixed(3)}">`;
    // orbit rings — one per OCCUPIED slot only (far→near)
    for(let i=sys.slots.length-1;i>=0;i--){
      const [a,b]=orbitAxes(sys.slots[i],maxP);
      g+=`<ellipse class="real-orbit" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${a.toFixed(2)}" ry="${b.toFixed(2)}" transform="rotate(${tiltDeg},${cx.toFixed(1)},${cy.toFixed(1)})" stroke-opacity="0.5" vector-effect="non-scaling-stroke"/>`;
    }
    // Split belts from planets; give each planet a DEPTH (its minor-axis
    // coordinate, tilt-invariant) so the far half of every orbit draws behind
    // the star and the near half in front.
    const showPlanetLabels=(sizeF>0.72 && em>0.62);
    const belts=[], planets=[];
    sys.bodies.forEach(bd=>{
      const [a,b]=orbitAxes(bd.p,maxP);
      const ang=bd.theta0 + t*bd.spd;
      if(bd.kind==='belt'){ belts.push({bd,a,b}); return; }
      const pt=orbitPt(cx,cy,a,b,ang);
      planets.push({bd,px:pt[0],py:pt[1],depth:b*Math.sin(ang)});
    });
    planets.sort((A,B)=>A.depth-B.depth);
    // asteroid belts (seeded dust) sit under everything
    belts.forEach(({bd,a,b})=>{
      const rng=mulberry32(hashStr(n.id+'belt'+bd.p));
      for(let i=0;i<44;i++){
        const aa=rng()*Math.PI*2, jit=1+(rng()-0.5)*0.22;
        const d=orbitPt(cx,cy,a*jit,b*jit,aa);
        g+=`<circle cx="${d[0].toFixed(2)}" cy="${d[1].toFixed(2)}" r="${(0.18+rng()*0.3).toFixed(2)}" fill="${bd.col}" opacity="${(0.35+rng()*0.4).toFixed(2)}"/>`;
      }
    });
    function planetSVG(P){
      const {bd,px,py}=P; let s2='';
      if(selectedBody===bd.id) s2+=`<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${(bd.r+0.9).toFixed(2)}" fill="none" stroke="#fff" stroke-opacity="0.8" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
      s2+=`<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${(bd.r+0.5).toFixed(2)}" fill="${bd.col}" opacity="0.10" data-body="${at(bd.id)}" data-node="${at(n.id)}"/>`;
      s2+=`<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${bd.r.toFixed(2)}" fill="${bd.col}" data-body="${at(bd.id)}" data-node="${at(n.id)}" style="cursor:pointer"/>`;
      if(bd.texUrl && _texOk[bd.texUrl] && sizeF>0.5 && em>0.55){
        const pid=texPatternId(bd.texUrl);
        // Opacity ramp so pinch jitter around the sizeF gate can't strobe the texture.
        if(pid){ const texOp=Math.min(1,(sizeF-0.5)/0.12);
          s2+=`<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${bd.r.toFixed(2)}" fill="url(#${pid})" fill-opacity="${texOp.toFixed(2)}" pointer-events="none"/>`; }
      }
      s2+=`<circle cx="${(px-bd.r*0.32).toFixed(2)}" cy="${(py-bd.r*0.32).toFixed(2)}" r="${(bd.r*0.55).toFixed(2)}" fill="#ffffff" opacity="0.14" pointer-events="none"/>`;
      if(bd.ring){
        s2+=`<ellipse cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" rx="${(bd.r+0.9).toFixed(2)}" ry="${((bd.r+0.9)*0.34).toFixed(2)}" fill="none" stroke="${bd.col}" stroke-opacity="0.6" vector-effect="non-scaling-stroke" transform="rotate(-18,${px.toFixed(2)},${py.toFixed(2)})"/>`;
      }
      if(bd.hook && em>0.4){ const fo=(12*invS).toFixed(2); s2+=`<text x="${(px+bd.r+0.4).toFixed(2)}" y="${(py-bd.r).toFixed(2)}" font-size="${fo}" fill="#E8A020" style="font-weight:700" pointer-events="none">!</text>`; }
      if(showPlanetLabels){ const fs=(8.5*invS).toFixed(2);
        s2+=`<text x="${px.toFixed(2)}" y="${(py+bd.r+7*invS).toFixed(2)}" text-anchor="middle" font-size="${fs}" fill="${bd.hook?'#E8A020':'#93a0bd'}" style="font-family:var(--mono,monospace)" pointer-events="none">${eh(bd.name)}${bd.dock?' ⚓':''}</text>`; }
      return s2;
    }
    for(const P of planets){ if(P.depth<0) g+=planetSVG(P); }   // far side, behind the star
    const pulse=motionOff() ? 1 : 1+0.06*Math.sin((Date.now()/1000)*1.4);
    const sr=sys.star.r*pulse;
    g+=`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(sr*2.8).toFixed(2)}" fill="${sys.star.col}" opacity="0.09" pointer-events="none"/>`;
    g+=`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(sr*1.7).toFixed(2)}" fill="${sys.star.col}" opacity="0.18" pointer-events="none"/>`;
    g+=`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${sr.toFixed(2)}" fill="${sys.star.col}" data-node="${at(n.id)}" style="cursor:pointer"/>`;
    for(const P of planets){ if(P.depth>=0) g+=planetSVG(P); }  // near side, in front
    // ── Docked traders: agents berthed at this system cluster around the dock
    //    anchor (the tradersDock planet, or the star when none is flagged),
    //    slowly circling so a busy port visibly bustles. Guarded — js/90 later. ──
    if(tradersOn && sizeF>0.3){ try{
      if(econReady()){
        const nowT=econNow();
        const here=econAgents().filter(a=>a.pos===n.id && agentDocked(a,nowT));
        if(here.length){
          const d=dockAnchor(n,t);
          if(d) here.forEach((a,i)=>{
            const ang=i*2.4 + t*0.1, rad=d.r+0.9+0.38*(i%3);
            const mx=d.x+Math.cos(ang)*rad, my=d.y+Math.sin(ang)*rad*0.55, z2=0.42;
            g+=`<polygon points="${mx.toFixed(2)},${(my-z2).toFixed(2)} ${(mx+z2).toFixed(2)},${my.toFixed(2)} ${mx.toFixed(2)},${(my+z2).toFixed(2)} ${(mx-z2).toFixed(2)},${my.toFixed(2)}" fill="#f4d35e" stroke="#04060e" stroke-width="0.12" opacity="0.92" pointer-events="none"><title>${at((a.name||'Trader')+' — docked')}</title></polygon>`;
          });
        }
      }
    }catch(e){} }
    // ── Jump arrows: one per GX_LANES lane touching this system; tap to travel ──
    if(em>0.6 && sizeF>0.55){
      laneNeighbours(n.id).forEach(cid=>{
        const tp=POS.get(cid), tn=nodeById(cid); if(!tp||!tn) return;
        const dx=tp.x-cx, dy=tp.y-cy, L=Math.hypot(dx,dy)||1, ux=dx/L, uy=dy/L;
        const R=ORBIT_OUTER*1.3, ax=cx+ux*R, ay=cy+uy*R, sz=1.7;
        const adeg=(Math.atan2(uy,ux)*180/Math.PI).toFixed(1);
        g+=`<g class="real-jump" data-jump="${at(cid)}" data-node="${at(n.id)}" transform="translate(${ax.toFixed(2)},${ay.toFixed(2)}) rotate(${adeg})" style="cursor:pointer">`;
        g+=`<circle r="${(sz*1.55).toFixed(2)}" fill="#0a1830" fill-opacity="0.55" stroke="#4f7fc0" stroke-opacity="0.85" vector-effect="non-scaling-stroke"/>`;
        g+=`<path d="M ${(-sz*0.45).toFixed(2)} ${(-sz*0.62).toFixed(2)} L ${(sz*0.72).toFixed(2)} 0 L ${(-sz*0.45).toFixed(2)} ${(sz*0.62).toFixed(2)} Z" fill="#cfe0ff"/>`;
        g+=`</g>`;
        if(showPlanetLabels){ const fs=(7.5*invS).toFixed(2);
          g+=`<text x="${(cx+ux*(R+sz*2.4)).toFixed(2)}" y="${(cy+uy*(R+sz*2.4)+2.5*invS).toFixed(2)}" text-anchor="middle" font-size="${fs}" fill="#7f93b8" style="font-family:var(--mono,monospace)" pointer-events="none">${eh(tn.label||tn.name)}</text>`; }
      });
    }
    // system name over the star — focus system only
    if(em>0.55 && sizeF>0.4){ const fs=(11*invS).toFixed(2); const nameOp=Math.max(0,Math.min(1,(sizeF-0.35)/0.5)).toFixed(2);
      g+=`<text x="${cx.toFixed(1)}" y="${(cy-sr-5*invS).toFixed(2)}" text-anchor="middle" font-size="${fs}" fill="#E8A020" opacity="${nameOp}" class="real-sys-lbl" pointer-events="none">${eh((n.label||n.name||'').toUpperCase())}</text>`; }
    g+='</g>';
    return g;
  }

  // ── Info card (read-only system card; faction through the redaction seam) ──
  function showCard(n){
    const el=document.getElementById('real-card'); if(!el) return;
    const fac=effFacOf(n.faction);
    const sys=adaptSystem(n);
    const bodiesHtml=sys.bodies.length
      ? '<div class="real-card-bodies">'+sys.bodies.map(b=>
          `<div class="rcb"><i style="background:${b.col}"></i>${eh(b.name)} — ${eh(b.type)}${b.dock?' <span title="Traders dock here">⚓</span>':''}${b.hook?' <span style="color:#E8A020">★</span>':''}</div>`).join('')+'</div>'
      : '<div class="real-card-bodies"><span class="rcb-none">No bodies charted yet.</span></div>';
    el.innerHTML=
      `<h2><span class="real-swatch" style="background:${fac.color}"></span>${eh(n.label||n.name)}</h2>`+
      `<div class="real-card-fac" style="color:${fac.color}">${eh(fac.name)} · ${eh(n.name)}</div>`+
      (n.desc?`<div class="real-card-desc">${eh(n.desc)}</div>`:'')+
      bodiesHtml;
    el.classList.add('show');
  }
  function hideCard(){ const el=document.getElementById('real-card'); if(el) el.classList.remove('show'); }

  // ── Per-world datacard: a small card that follows the selected world around
  //    its orbit. Read view for everyone; under designModeOn && isReferee() it
  //    becomes editable and writes through the SHARED overlay engine
  //    (bodyPropertyOverrides / bodyAdditions in js/65) — no parallel store.
  //    refNote / readAloud are BUILT only for the referee (never in player
  //    markup) and carry .ref-only as belt-and-braces. ──────────────────────
  function refOk(){ return typeof isReferee==='function' ? isReferee() : false; }
  function canEditNow(){ return refOk() && typeof designModeOn!=='undefined' && !!designModeOn; }
  function datacardHTML(n,bd,raw,edit){
    const belt=bd.kind==='belt';
    const close='<span class="real-dc-close" data-dc="close" title="Deselect">×</span>';
    if(edit){
      return '<div class="real-dc-hd"><span class="real-dc-dot" style="background:'+at(bd.col||'#888')+'"></span><span>Edit — '+eh(raw.name||bd.name)+'</span>'+close+'</div>'
        +'<div class="real-dc-lbl">Name</div><input data-f="name" value="'+at(raw.name||'')+'">'
        +'<div class="real-dc-lbl">Type</div><input data-f="type" value="'+at(raw.type||'')+'">'
        +(belt?'':'<div class="real-dc-lbl">UWP</div><input data-f="uwpString" value="'+at(raw.uwpString||'')+'">'
          +'<div class="real-dc-lbl">Diameter</div><input data-f="diameter" value="'+at(raw.diameter||'')+'">')
        +'<label class="real-dc-chk"><input type="checkbox" data-f="hook" '+(raw.hook?'checked':'')+'> Adventure hook</label>'
        +'<label class="real-dc-chk"><input type="checkbox" data-f="tradersDock" '+(raw.tradersDock?'checked':'')+'> ⚓ Traders dock here</label>'
        +'<div class="real-dc-lbl">Description (players)</div><textarea data-f="desc">'+eh(raw.desc||'')+'</textarea>'
        +'<div class="real-dc-lbl">Read-aloud</div><textarea data-f="readAloud">'+eh(raw.readAloud||'')+'</textarea>'
        +'<div class="real-dc-lbl">Referee note</div><textarea data-f="refNote">'+eh(raw.refNote||'')+'</textarea>';
    }
    let h='<div class="real-dc-hd"><span class="real-dc-dot" style="background:'+at(bd.col||'#888')+'"></span><span>'+eh(raw.name||bd.name)+(raw.hook?' <span style="color:#E8A020">★</span>':'')+'</span>'+close+'</div>';
    h+='<div class="real-dc-type">'+eh(raw.type||'')+'</div>';
    if(!belt && (raw.uwpString||raw.diameter)) h+='<div class="real-dc-stat">'+eh(raw.uwpString||'')+((raw.uwpString&&raw.diameter)?'  ·  ':'')+eh(raw.diameter||'')+'</div>';
    if(raw.tradersDock) h+='<div class="real-dc-stat" style="color:#f4d35e">⚓ Traders dock here — NPC convoys berth at this body</div>';
    h+='<div class="real-dc-desc">'+(raw.desc?eh(raw.desc):'<span class="real-dc-muted">No survey notes yet.</span>')+'</div>';
    if(refOk()){   // referee-only content: never built into player markup
      if(raw.readAloud) h+='<div class="real-dc-note real-dc-ra ref-only">“'+eh(raw.readAloud)+'”</div>';
      if(raw.refNote) h+='<div class="real-dc-note ref-only"><b>Referee:</b> '+eh(raw.refNote)+'</div>';
    }
    h+='<button class="view-close-btn real-dc-open" data-dc="open">⊙ View '+eh(raw.name||bd.name)+' up close</button>';
    return h;
  }
  function positionDatacard(dc,sx,sy,pr){
    const w=dc.offsetWidth||210, h=dc.offsetHeight||130, pad=10, gap=(pr||0)+16;
    let left=sx+gap;
    if(left+w > W-pad) left=sx-gap-w;              // flip left if it would overflow
    left=Math.max(pad, Math.min(W-w-pad, left));
    const top=Math.max(pad, Math.min(H-h-pad, sy-h/2));
    dc.style.left=left+'px'; dc.style.top=top+'px';
  }
  function updateDatacard(){
    const dc=document.getElementById('real-datacard'); if(!dc) return;
    const off=()=>{ if(dcSig!==null){ dc.classList.remove('show'); dcSig=null; } };
    if(modeVal!=='real' || !selectedNode || !selectedBody){ off(); return; }
    if(ORBIT_OUTER*view.scale < OPEN_MIN){ off(); return; }
    const sys=adaptSystem(selectedNode);
    const bd=sys.bodies.find(x=>x.id===selectedBody);
    if(!bd){ off(); return; }                       // body deleted out from under us
    const raw=sys.raw.get(bd.id)||{};
    const edit=canEditNow();
    // Edit mode keeps a stable signature so typing never loses input focus;
    // read mode folds in dcRev so remote edits appear as they sync.
    const sig=bd.id+'|'+(edit?'e':'r'+dcRev);
    if(sig!==dcSig){ dcSig=sig; dcUndoDone=false; dc.classList.toggle('real-dc-edit',edit); dc.innerHTML=datacardHTML(selectedNode,bd,raw,edit); }
    dc.classList.add('show');
    const pos=posOf(selectedNode); if(!pos){ off(); return; }
    const axes=orbitAxes(bd.p,sys.maxP);
    const ang= bd.kind==='belt' ? bd.theta0 : bd.theta0 + (motionOff()?0:(Date.now()/1000))*bd.spd;
    const pt=orbitPt(pos.x,pos.y,axes[0],axes[1],ang);
    positionDatacard(dc, view.x+pt[0]*view.scale, view.y+pt[1]*view.scale, (bd.r||1)*view.scale);
  }
  // The single write seam: one field of one body, through the app's shared
  // overlay engine. Added bodies mutate in place (+saveBodyAdditions), base
  // bodies accumulate bodyPropertyOverrides — mirroring commitBodyEdit (js/96).
  function writeBodyField(sysId, bodyId, field, val){
    if(!canEditNow()) return;
    if(typeof bodyPropertyOverrides==='undefined' || typeof saveBodyPropertyOverrides!=='function') return;
    if(!dcUndoDone && typeof recordDesignUndo==='function'){ recordDesignUndo('Edit body (REAL map)'); dcUndoDone=true; }
    const adds=(typeof bodyAdditions!=='undefined' && bodyAdditions[sysId]) || null;
    const added=adds ? adds.find(b=>b.id===bodyId) : null;
    if(added){ added[field]=val; if(typeof saveBodyAdditions==='function') saveBodyAdditions(); }
    else {
      if(!bodyPropertyOverrides[sysId]) bodyPropertyOverrides[sysId]={};
      if(!bodyPropertyOverrides[sysId][bodyId]) bodyPropertyOverrides[sysId][bodyId]={};
      bodyPropertyOverrides[sysId][bodyId][field]=val;
      saveBodyPropertyOverrides();
    }
    // One dock per system: ticking "Traders dock here" un-flags every other
    // body, through the shared helper the body editor uses (js/96 — guarded).
    if(field==='tradersDock' && val && typeof clearOtherTraderDocks==='function'){
      try{ clearOtherTraderDocks(sysId, bodyId); }catch(e){}
    }
    sysCache.delete(sysId); invalidate();
  }
  function bindDatacard(){
    const dc=document.getElementById('real-datacard'); if(!dc) return;
    dc.addEventListener('input',e=>{
      const f=e.target && e.target.getAttribute && e.target.getAttribute('data-f');
      if(!f || !selectedNode || !selectedBody) return;
      writeBodyField(sysIdOf(selectedNode), selectedBody, f, e.target.type==='checkbox'?e.target.checked:e.target.value);
    });
    dc.addEventListener('click',e=>{
      if(e.target.closest && e.target.closest('[data-dc="close"]')){
        selectedBody=null; dc.classList.remove('show'); dcSig=null; invalidate(); return; }
      if(e.target.closest && e.target.closest('[data-dc="open"]')){
        if(!selectedNode) return;
        const sysId=sysIdOf(selectedNode), bodyId=selectedBody;
        if(typeof enterSystem==='function' && typeof goBodyView==='function'){
          enterSystem(sysId,{quiet:true}); goBodyView(bodyId); bodyFromReal=true; }
      }
    });
  }

  // ── Pointer input: pan / pinch / wheel, taps on pointerup with a move-slop
  //    guard (iOS never gets a synthetic click on SVG under touch-action:none). ──
  function pickAt(px,py){
    const el=document.elementFromPoint(px,py);
    if(!el || !el.closest) return null;
    const jumpEl=el.closest('[data-jump]');
    if(jumpEl){ const n=nodeById(jumpEl.getAttribute('data-node'));
      return { jump:jumpEl.getAttribute('data-jump'), node:n, body:null }; }
    const bodyEl=el.closest('[data-body]');
    if(bodyEl){ const n=nodes().find(x=>x.id===bodyEl.getAttribute('data-node'));
      return n?{node:n, body:bodyEl.getAttribute('data-body')}:null; }
    const nodeEl=el.closest('[data-node]');
    if(nodeEl){ const n=nodes().find(x=>x.id===nodeEl.getAttribute('data-node'));
      return n?{node:n, body:null}:null; }
    return null;
  }
  function bindInput(){
    let drag=null, dragMoved=false, lastDist=0;
    svg.addEventListener('pointerdown',e=>{
      drag={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y,touch:e.pointerType==='touch'};
      dragMoved=false; svg.classList.add('real-dragging');
      if(svg.setPointerCapture){ try{ svg.setPointerCapture(e.pointerId); }catch(err){} }
    });
    svg.addEventListener('pointermove',e=>{
      if(drag){
        const dx=e.clientX-drag.x, dy=e.clientY-drag.y;
        if(!dragMoved && Math.abs(dx)+Math.abs(dy)<(drag.touch?12:4)) return;
        dragMoved=true; extCam=false; view.x=drag.vx+dx; view.y=drag.vy+dy; invalidate();
      } else {
        const hit=pickAt(e.clientX,e.clientY), hn=hit?hit.node:null;
        if(hn!==hoverNode){ hoverNode=hn; invalidate(); }
        svg.style.cursor = hn ? 'pointer' : 'grab';
      }
    });
    const endDrag=e=>{ if(drag && svg.releasePointerCapture){ try{ svg.releasePointerCapture(e.pointerId); }catch(err){} } drag=null; svg.classList.remove('real-dragging'); };
    svg.addEventListener('pointerup',e=>{
      const wasMoved=dragMoved; dragMoved=false; endDrag(e);
      if(e.button>0 || wasMoved) return;
      const hit=pickAt(e.clientX,e.clientY);
      if(!hit){ hideCard(); selectedNode=null; selectedBody=null; invalidate(); return; }
      if(hit.jump){ const tn=nodeById(hit.jump); if(tn) jumpTo(hit.node||tn, tn); invalidate(); return; }   // jump arrow → travel the lane
      if(hit.body){ selectedNode=hit.node; selectedBody=hit.body; hideCard(); invalidate(); return; }
      // tapped a star: dive in (or just select it once the system is already open)
      if(ORBIT_OUTER*view.scale < OPEN_FULL) flyTo(hit.node);
      else { selectedNode=hit.node; selectedBody=null; showCard(hit.node); invalidate(); }
    });
    svg.addEventListener('pointercancel',endDrag);
    svg.addEventListener('wheel',e=>{ e.preventDefault(); zoomAt(e.clientX,e.clientY, e.deltaY<0?1.14:1/1.14); },{passive:false});
    svg.addEventListener('touchmove',e=>{
      if(e.touches.length===2){ e.preventDefault();
        const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
        const mx=(e.touches[0].clientX+e.touches[1].clientX)/2, my=(e.touches[0].clientY+e.touches[1].clientY)/2;
        if(lastDist) zoomAt(mx,my,d/lastDist); lastDist=d;
      }
    },{passive:false});
    svg.addEventListener('touchend',()=>{ lastDist=0; });
  }

  // ── Planet hotbar — a row of the focused system's worlds, appearing as you
  //    zoom in. Rebuilt only when the focus / selection / data changes. ─────
  let hotbarSig=null, hotbarNode=null;
  function updateHotbar(node){
    const bar=document.getElementById('real-hotbar'); if(!bar) return;
    const sys=node ? adaptSystem(node) : null;
    if(!node || !sys.bodies.length){
      if(hotbarSig!==null){ bar.classList.remove('show'); bar.innerHTML=''; hotbarSig=null; hotbarNode=null; }
      return;
    }
    const sig=node.id+'|'+(selectedBody||'')+'|'+dcRev;
    if(sig===hotbarSig){ bar.classList.add('show'); return; }
    hotbarSig=sig; hotbarNode=node;
    bar.innerHTML=sys.bodies.map(bd=>{
      const belt=bd.kind==='belt', active=(selectedBody===bd.id)?' active':'';
      const style=belt?'':`background-color:${at(bd.col)}`+((bd.texUrl&&_texOk[bd.texUrl])?`;background-image:url(${at(bd.texUrl)})`:'');
      const short=(bd.name||'').replace(node.label||node.name||'','').trim()||bd.name;
      return `<div class="real-pi${belt?' belt':''}${active}" data-body="${at(bd.id)}" title="${at(bd.name+' — '+(bd.type||'')+(bd.dock?' · traders dock here':''))}"><div class="real-pi-disc" style="${style}"></div><div class="real-pi-lb">${eh(short)}${bd.dock?' ⚓':''}</div></div>`;
    }).join('');
    bar.classList.add('show');
  }
  function showPreview(pi, bd){
    const pv=document.getElementById('real-preview'), canvas=document.getElementById('galaxy-canvas');
    if(!pv||!canvas) return;
    const belt=bd.kind==='belt';
    const disc=belt ? '<div class="real-pv-disc belt"></div>'
      : `<div class="real-pv-disc" style="background-color:${at(bd.col)}${(bd.texUrl&&_texOk[bd.texUrl])?`;background-image:url(${at(bd.texUrl)})`:''}"></div>`;
    pv.innerHTML=disc
      +`<div class="real-pv-name">${eh(bd.name)}${bd.hook?' <span style="color:#E8A020">★</span>':''}</div>`
      +`<div class="real-pv-type">${eh(bd.type||'')}</div>`
      +'<div class="real-pv-hint">tap to fly here</div>';
    const r=pi.getBoundingClientRect(), c=canvas.getBoundingClientRect();
    pv.style.left=(r.left+r.width/2-c.left)+'px';
    pv.style.bottom=(c.bottom-r.top+10)+'px';
    pv.classList.add('show');
  }
  function hidePreview(){ const pv=document.getElementById('real-preview'); if(pv) pv.classList.remove('show'); }
  function bindHotbar(){
    const bar=document.getElementById('real-hotbar'); if(!bar) return;
    const bodyOf=el=>{ const pi=el&&el.closest&&el.closest('.real-pi'); if(!pi||!hotbarNode) return null;
      const id=pi.getAttribute('data-body'); return { pi, bd:adaptSystem(hotbarNode).bodies.find(b=>b.id===id) }; };
    bar.addEventListener('click',e=>{
      const h=bodyOf(e.target); if(!h||!h.bd) return;
      flyToBody(hotbarNode, h.bd); hidePreview();
    });
    bar.addEventListener('mouseover',e=>{ const h=bodyOf(e.target); if(h&&h.bd) showPreview(h.pi,h.bd); });
    bar.addEventListener('mouseleave',hidePreview);
  }

  // ── System search: type-ahead over label / name / (redacted) faction name;
  //    picking a match flies the camera there. Hidden factions resolve to
  //    "Uncharted", so a spoiler faction's name matches nothing for players. ──
  let sMatches=[];
  function runSearch(){
    const sIn=document.getElementById('real-search-in'), sRes=document.getElementById('real-search-results');
    if(!sIn||!sRes) return;
    const q=sIn.value.trim().toLowerCase();
    if(!q){ sRes.classList.remove('show'); sRes.innerHTML=''; sMatches=[]; return; }
    ensureLayout();
    sMatches=nodes().filter(n=>POS.has(n.id) &&
      ((n.label||'')+' '+(n.name||'')+' '+(effFacOf(n.faction).name||'')).toLowerCase().includes(q)).slice(0,8);
    sRes.innerHTML=sMatches.length
      ? sMatches.map((n,i)=>{ const fac=effFacOf(n.faction);
          return `<div class="real-sr" data-i="${i}"><i style="background:${fac.color}"></i><span class="real-sr-nm">${eh(n.label||n.name)}</span><span class="real-sr-sub">${eh(n.name)}</span></div>`; }).join('')
      : '<div class="real-sr-empty">No systems found</div>';
    sRes.classList.add('show');
  }
  function pickSearch(i){
    const n=sMatches[i]; if(!n) return;
    const sIn=document.getElementById('real-search-in'), sRes=document.getElementById('real-search-results');
    if(sRes) sRes.classList.remove('show');
    if(sIn){ sIn.value=n.label||n.name; sIn.blur(); }
    flyTo(n);
  }
  function bindSearch(){
    const sIn=document.getElementById('real-search-in'), sRes=document.getElementById('real-search-results');
    if(!sIn||!sRes) return;
    sIn.addEventListener('input',runSearch);
    sIn.addEventListener('focus',runSearch);
    sIn.addEventListener('keydown',e=>{
      if(e.key==='Enter'){ e.preventDefault(); if(sMatches.length) pickSearch(0); }
      else if(e.key==='Escape'){ e.stopPropagation(); sIn.value=''; runSearch(); sIn.blur(); }
    });
    sRes.addEventListener('click',e=>{ const r=e.target.closest&&e.target.closest('.real-sr'); if(r) pickSearch(+r.getAttribute('data-i')); });
    document.addEventListener('click',e=>{ if(!(e.target.closest&&e.target.closest('#real-search'))) sRes.classList.remove('show'); });
  }

  // ── Mode plumbing (per-device HEX | REAL preference) ───────────────────
  function readPref(){ try{ return localStorage.getItem('aurelia_map_mode')==='real' ? 'real' : 'hex'; }catch(e){ return 'hex'; } }
  function applyModeUi(){
    const canvas=document.getElementById('galaxy-canvas');
    if(canvas) canvas.classList.toggle('real-on', modeVal==='real');
    const bh=document.getElementById('mm-hex'), br=document.getElementById('mm-real');
    if(bh) bh.classList.toggle('on', modeVal!=='real');
    if(br) br.classList.toggle('on', modeVal==='real');
  }
  function scheduleFit(){ requestAnimationFrame(()=>requestAnimationFrame(()=>{ if(active()){ fit(); invalidate(); } })); }
  function setMode(m, opts){
    ensure();
    modeVal = (m==='real') ? 'real' : 'hex';
    modeRead=true;
    if(!(opts && opts.persist===false)){ try{ localStorage.setItem('aurelia_map_mode', modeVal); }catch(e){} }
    applyModeUi();
    if(modeVal==='real'){ if(!fitted) scheduleFit(); else readRect(); invalidate(); }
    else { updateHotbar(null); hidePreview(); }
    if(typeof window.onMapModeChanged==='function') window.onMapModeChanged(modeVal);
  }
  function onGalaxyEnter(){
    ensure(); if(!built) return;
    if(!modeRead){ modeVal=readPref(); modeRead=true; }
    applyModeUi();
    if(modeVal==='real'){ if(!fitted) scheduleFit(); else readRect(); invalidate(); }
  }
  // Hex-side data changed (system CRUD, lanes, paint, faction edits, polls,
  // redaction toggles) — every such path funnels through HX.refresh(), which
  // calls this hook. Rebuild the derived layers lazily on the next render.
  function refresh(){ layoutDirty=true; facDirty=true; sysCache.clear(); tradePathCache.clear(); dcRev++; invalidate(); }

  // ── Body-view return seam: armed when the datacard opens the classic body
  //    view, claimed by js/30's up-navigation so "back" lands on THIS map
  //    (camera untouched) instead of the hex system view. ──
  let bodyFromReal=false;
  function claimBodyReturn(){ const v=bodyFromReal; bodyFromReal=false; return v; }
  function clearBodyReturn(){ bodyFromReal=false; }

  // ── Camera mirror seams (table display, wired up fully in a later phase) ──
  function getCamera(){ return { x:view.x, y:view.y, scale:view.scale }; }
  function setCamera(c){
    if(!c || !isFinite(c.x) || !isFinite(c.y) || !isFinite(c.scale) || c.scale<=0) return;
    view.x=c.x; view.y=c.y; view.scale=c.scale; extCam=true; fitted=true; invalidate();
  }

  // ── Mount (idempotent, lazy — mirrors HX.ensure) ───────────────────────
  function ensure(){
    if(built) return;
    svg=document.getElementById('real-map'); if(!svg) return;
    scene=document.getElementById('real-scene'); if(!scene) return;
    bindInput(); bindDatacard(); bindHotbar(); bindSearch();
    window.addEventListener('resize',()=>{ if(!active()) return; readRect(); if(!fitted) fit(); invalidate(); });
    document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') invalidate(); });
    built=true;
  }

  // Hex edits reach this view through HX.refresh() → this hook (see js/10).
  window.onHXSharedRefresh=function(){ refresh(); };
  // Inline-handler shims, mirroring the hex map's window.hx* convention.
  window.mapModeSet=function(m){ setMode(m); };
  window.realZoomBy=function(f){ if(W&&H) zoomAt(W/2,H/2,f); };
  window.realResetView=function(){ extCam=false; tween=null; hideCard(); selectedNode=null; selectedBody=null; fit(); };
  window.realToggleRegions=function(){ regionsOn=!regionsOn;
    const b=document.getElementById('real-regions'); if(b) b.classList.toggle('off',!regionsOn); invalidate(); };
  window.realToggleTraders=function(){ tradersOn=!tradersOn;
    const b=document.getElementById('real-traders'); if(b) b.classList.toggle('off',!tradersOn); invalidate(); };

  return { mode:()=>modeVal, setMode, onGalaxyEnter, refresh, invalidate, getCamera, setCamera, claimBodyReturn, clearBodyReturn };
})();

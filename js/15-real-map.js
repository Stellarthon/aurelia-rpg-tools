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
  const JIT = 5.5;                // per-star jitter so the grid reads organically
  const ORBIT_OUTER = 9;          // outermost orbit semi-major (Phase 2 orreries)
  const OPEN_MIN = 34;            // px: orrery starts fading in (Phase 2)
  const OPEN_FULL = 128;          // px: full system detail (Phase 2)
  const R_TERR = 52;              // faction territory blob radius

  // ── Small helpers ──────────────────────────────────────────────────────
  const eh = s => (typeof escHtml==='function' ? escHtml(String(s==null?'':s)) : String(s==null?'':s));
  const at = s => eh(s).replace(/"/g,'&quot;');            // escHtml doesn't cover quotes
  function hashStr(s){ let h=2166136261>>>0; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
  function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
  function axialPx(q,r){ return [ RPX*1.5*q, RPX*Math.sqrt(3)*(r+q/2) ]; }
  function nodes(){ return (typeof GALAXY_NODES!=='undefined') ? GALAXY_NODES : []; }
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
  let hoverNode=null, selectedNode=null;
  let needRender=true, anyOpen=false, raf=0;
  let regionsOn=true;
  let layoutDirty=true, facDirty=true;
  const POS=new Map();                         // node id → {x,y} (derived; never written to nodes)
  let _facDefs='', _facBlobs='', _facLabels='';
  let _lastCam='';

  // ── Derived layout: hex placement (deterministic, shared with the hex map)
  //    + seeded uniform-in-disc jitter. Rebuilt whenever the hex side edits. ──
  function jitterOf(id){
    const rng=mulberry32(hashStr(id+'jit'));
    const ang=rng()*6.2832, mag=Math.sqrt(rng())*JIT;
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

  // ── Fit / zoom (transform maths mirror the prototype) ──────────────────
  function readRect(){ if(!svg) return; const r=svg.getBoundingClientRect(); W=r.width; H=r.height; }
  function fit(){
    if(!svg) return; ensureLayout(); readRect();
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
    extCam=false; invalidate();
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
    if(needRender || anyOpen){ needRender=false; render(now); }
    if(anyOpen && !motionOff()) raf=requestAnimationFrame(frame);
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

    // Star dots (faction-coloured through the redaction seam) + labels.
    const showNames=(s>fitScale*2.6);
    nodes().forEach(n=>{
      const p=posOf(n); if(!p) return;
      if(p.x<vx0||p.x>vx1||p.y<vy0||p.y>vy1) return;
      const fac=effFacOf(n.faction);
      const hot=(n===hoverNode||n===selectedNode);
      const rr=3.1*invS;
      out+=`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(rr*1.9).toFixed(2)}" fill="${fac.color}" opacity="${hot?0.28:0.14}"/>`;
      out+=`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${rr.toFixed(2)}" fill="${fac.color}" data-node="${at(n.id)}" style="cursor:pointer"/>`;
      if(showNames||hot){ const fs=(11*invS).toFixed(2);
        out+=`<text x="${p.x.toFixed(1)}" y="${(p.y-5.5*invS).toFixed(2)}" text-anchor="middle" font-size="${fs}" class="real-star-lbl${hot?' hot':''}">${eh(n.label||n.name)}</text>`; }
    });
    anyOpen=false;                              // orreries arrive in Phase 2

    scene.innerHTML=out;
    const zv=document.getElementById('real-zval');
    if(zv) zv.textContent=(s/(fitScale||1)).toFixed(1)+'×';
    const pill=document.getElementById('real-mode-pill');
    if(pill){ const outerPx=ORBIT_OUTER*s;
      pill.textContent = outerPx<OPEN_MIN ? 'GALAXY' : outerPx<OPEN_FULL ? 'APPROACH' : 'SYSTEM'; }
  }

  // ── Info card (read-only system card; faction through the redaction seam) ──
  function showCard(n){
    const el=document.getElementById('real-card'); if(!el) return;
    const fac=effFacOf(n.faction);
    el.innerHTML=
      `<h2><span class="real-swatch" style="background:${fac.color}"></span>${eh(n.label||n.name)}</h2>`+
      `<div class="real-card-fac" style="color:${fac.color}">${eh(fac.name)} · ${eh(n.name)}</div>`+
      (n.desc?`<div class="real-card-desc">${eh(n.desc)}</div>`:'');
    el.classList.add('show');
  }
  function hideCard(){ const el=document.getElementById('real-card'); if(el) el.classList.remove('show'); }

  // ── Pointer input: pan / pinch / wheel, taps on pointerup with a move-slop
  //    guard (iOS never gets a synthetic click on SVG under touch-action:none). ──
  function pickAt(px,py){
    const el=document.elementFromPoint(px,py);
    if(!el || !el.closest) return null;
    const nodeEl=el.closest('[data-node]');
    if(nodeEl){ const id=nodeEl.getAttribute('data-node');
      const n=nodes().find(x=>x.id===id); return n?{node:n}:null; }
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
      if(!hit){ hideCard(); selectedNode=null; invalidate(); return; }
      selectedNode=hit.node; showCard(hit.node); invalidate();
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
  function refresh(){ layoutDirty=true; facDirty=true; invalidate(); }

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
    bindInput();
    window.addEventListener('resize',()=>{ if(!active()) return; readRect(); if(!fitted) fit(); invalidate(); });
    document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') invalidate(); });
    built=true;
  }

  // Hex edits reach this view through HX.refresh() → this hook (see js/10).
  window.onHXSharedRefresh=function(){ refresh(); };
  // Inline-handler shims, mirroring the hex map's window.hx* convention.
  window.mapModeSet=function(m){ setMode(m); };
  window.realZoomBy=function(f){ if(W&&H) zoomAt(W/2,H/2,f); };
  window.realResetView=function(){ extCam=false; hideCard(); selectedNode=null; fit(); };
  window.realToggleRegions=function(){ regionsOn=!regionsOn;
    const b=document.getElementById('real-regions'); if(b) b.classList.toggle('off',!regionsOn); invalidate(); };

  return { mode:()=>modeVal, setMode, onGalaxyEnter, refresh, invalidate, getCamera, setCamera };
})();

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
      return {
        id:b.id, name:b.name||'', type:b.type||'', kind, p,
        theta0:rng()*Math.PI*2, spd:ORBIT_SPEED/(0.6+p*0.55),
        col:b.color||(kind==='belt'?'#8B7355':'#9AA86A'),
        r:kind==='belt'?0:bodySceneR(b.displayRadius,kind),
        ring:kind==='gas'&&!!b.ringStyle,
        hook:!!b.hook, uwp:b.uwpString, diameter:b.diameter,
      };
    });
    let maxP=0; bodies.forEach(b=>{ if(b.p>maxP) maxP=b.p; });
    sys={ star, bodies, maxP, slots:Array.from(used).sort((a,b)=>a-b) };
    sysCache.set(sysId,sys);
    return sys;
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
      const T=Math.max(60, FOCUS_T*minDim);
      open.forEach(o=>{
        const em=Math.max(FOCUS_FLOOR, Math.exp(-(o.dp-dMin)/T));
        out+=drawOrrery(o.n,o.p,sizeF,em,invS,s);
        if(sizeF<1){ const fac=effFacOf(o.n.faction); const rr=3.1*invS;
          out+=`<circle cx="${o.p.x.toFixed(1)}" cy="${o.p.y.toFixed(1)}" r="${rr.toFixed(2)}" fill="${fac.color}" opacity="${((1-sizeF)*(0.3+0.7*em)).toFixed(2)}"/>`; }
      });
      anyOpen=open.length>0;
    }

    scene.innerHTML=out;
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
      if(selectedBody===bd.id) s2+=`<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${(bd.r+0.9).toFixed(2)}" fill="none" stroke="#fff" stroke-opacity="0.8" vector-effect="non-scaling-stroke"/>`;
      s2+=`<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${(bd.r+0.5).toFixed(2)}" fill="${bd.col}" opacity="0.10"/>`;
      s2+=`<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${bd.r.toFixed(2)}" fill="${bd.col}" data-body="${at(bd.id)}" data-node="${at(n.id)}" style="cursor:pointer"/>`;
      s2+=`<circle cx="${(px-bd.r*0.32).toFixed(2)}" cy="${(py-bd.r*0.32).toFixed(2)}" r="${(bd.r*0.55).toFixed(2)}" fill="#ffffff" opacity="0.14" pointer-events="none"/>`;
      if(bd.ring){
        s2+=`<ellipse cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" rx="${(bd.r+0.9).toFixed(2)}" ry="${((bd.r+0.9)*0.34).toFixed(2)}" fill="none" stroke="${bd.col}" stroke-opacity="0.6" vector-effect="non-scaling-stroke" transform="rotate(-18,${px.toFixed(2)},${py.toFixed(2)})"/>`;
      }
      if(bd.hook && em>0.4){ const fo=(12*invS).toFixed(2); s2+=`<text x="${(px+bd.r+0.4).toFixed(2)}" y="${(py-bd.r).toFixed(2)}" font-size="${fo}" fill="#E8A020" style="font-weight:700" pointer-events="none">!</text>`; }
      if(showPlanetLabels){ const fs=(8.5*invS).toFixed(2);
        s2+=`<text x="${px.toFixed(2)}" y="${(py+bd.r+7*invS).toFixed(2)}" text-anchor="middle" font-size="${fs}" fill="${bd.hook?'#E8A020':'#93a0bd'}" style="font-family:var(--mono,monospace)" pointer-events="none">${eh(bd.name)}</text>`; }
      return s2;
    }
    for(const P of planets){ if(P.depth<0) g+=planetSVG(P); }   // far side, behind the star
    const pulse=motionOff() ? 1 : 1+0.06*Math.sin((Date.now()/1000)*1.4);
    const sr=sys.star.r*pulse;
    g+=`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(sr*2.8).toFixed(2)}" fill="${sys.star.col}" opacity="0.09"/>`;
    g+=`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(sr*1.7).toFixed(2)}" fill="${sys.star.col}" opacity="0.18"/>`;
    g+=`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${sr.toFixed(2)}" fill="${sys.star.col}" data-node="${at(n.id)}" style="cursor:pointer"/>`;
    for(const P of planets){ if(P.depth>=0) g+=planetSVG(P); }  // near side, in front
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
          `<div class="rcb"><i style="background:${b.col}"></i>${eh(b.name)} — ${eh(b.type)}${b.hook?' <span style="color:#E8A020">★</span>':''}</div>`).join('')+'</div>'
      : '<div class="real-card-bodies"><span class="rcb-none">No bodies charted yet.</span></div>';
    el.innerHTML=
      `<h2><span class="real-swatch" style="background:${fac.color}"></span>${eh(n.label||n.name)}</h2>`+
      `<div class="real-card-fac" style="color:${fac.color}">${eh(fac.name)} · ${eh(n.name)}</div>`+
      (n.desc?`<div class="real-card-desc">${eh(n.desc)}</div>`:'')+
      bodiesHtml;
    el.classList.add('show');
  }
  function hideCard(){ const el=document.getElementById('real-card'); if(el) el.classList.remove('show'); }

  // ── Pointer input: pan / pinch / wheel, taps on pointerup with a move-slop
  //    guard (iOS never gets a synthetic click on SVG under touch-action:none). ──
  function pickAt(px,py){
    const el=document.elementFromPoint(px,py);
    if(!el || !el.closest) return null;
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
  function refresh(){ layoutDirty=true; facDirty=true; sysCache.clear(); invalidate(); }

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
  window.realResetView=function(){ extCam=false; tween=null; hideCard(); selectedNode=null; selectedBody=null; fit(); };
  window.realToggleRegions=function(){ regionsOn=!regionsOn;
    const b=document.getElementById('real-regions'); if(b) b.classList.toggle('off',!regionsOn); invalidate(); };

  return { mode:()=>modeVal, setMode, onGalaxyEnter, refresh, invalidate, getCamera, setCamera };
})();

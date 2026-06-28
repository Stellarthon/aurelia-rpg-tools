// ═══════════════════════════════════════════════════════════════════════════
// SHARED STATE & PLAYER MODE
// ═══════════════════════════════════════════════════════════════════════════
let currentView = "galaxy"; // landing view is the Orion Arm starmap
const pmCheck = document.getElementById("pm-check");
const rootEl = document.getElementById("root");

function togglePM(){
  pmCheck.checked = !pmCheck.checked;
  rootEl.classList.toggle("pm-active", pmCheck.checked);
  const fp = document.getElementById('float-panels');
  if(fp) fp.classList.toggle('pm-active', pmCheck.checked);
  if(pmCheck.checked) forceDesignModeOff();
  try {
    if(pmCheck.checked) localStorage.setItem("aurelia_pm","1");
    else localStorage.removeItem("aurelia_pm");
  } catch(e){}
  if(currentView === "station" && cur) { renderTabs(); renderDetail(); updateStationLocks(); }
  if(currentView === "body" && selectedBody){ if(selectedBodyLoc) selectBodyLocation(selectedBodyLoc); else buildBodyView(selectedBody); }
  if(currentView === "system" && selectedBody) selectBody(selectedBody);
  checkIdentity();
  renderWhoAmI();
  if(pmCheck.checked){ startPolling(); startAlertPolling(); startCombatPolling(); } else { stopPolling(); stopAlertPolling(); stopCombatPolling(); }
  applyAlertState(); // refresh the alert puck / overlay for the new role
}
pmCheck.addEventListener("change", function(){
  rootEl.classList.toggle("pm-active", this.checked);
  if(this.checked) forceDesignModeOff();
  try {
    if(this.checked) localStorage.setItem("aurelia_pm","1");
    else localStorage.removeItem("aurelia_pm");
  } catch(e){}
  if(currentView === "station" && cur) { renderTabs(); renderDetail(); updateStationLocks(); }
  if(currentView === "body" && selectedBody){ if(selectedBodyLoc) selectBodyLocation(selectedBodyLoc); else buildBodyView(selectedBody); }
  if(currentView === "system" && selectedBody) selectBody(selectedBody);
  checkIdentity();
  renderWhoAmI();
  if(this.checked){ startPolling(); startAlertPolling(); startCombatPolling(); } else { stopPolling(); stopAlertPolling(); stopCombatPolling(); }
  applyAlertState();
});
try { if(localStorage.getItem("aurelia_pm")==="1"){ pmCheck.checked=true; rootEl.classList.add("pm-active")
    const fp2 = document.getElementById('float-panels'); if(fp2) fp2.classList.add('pm-active');; startPolling(); startAlertPolling(); startCombatPolling(); } } catch(e){}

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM MAP
// ═══════════════════════════════════════════════════════════════════════════
let selectedBody = null;

// ═══════════════════════════════════════════════════════════════════════════
// ORRERY  —  generic, data-driven, computed from N orbit slots
// ═══════════════════════════════════════════════════════════════════════════
// The orbital layout is derived from the number of occupied orbit positions in
// the current system rather than a hardcoded lookup table, so a system with any
// number of bodies lays out correctly. Decorations (rings, asteroid clusters,
// belt dot-fields) are read off body fields, so referee-created bodies can have
// them too. Star position (SX,SY) and tilt are fixed to preserve the look.

const ORR_SX = 594, ORR_SY = 180;
const ORR_TILT = -28 * Math.PI / 180;
const ORR_COS = Math.cos(ORR_TILT), ORR_SIN = Math.sin(ORR_TILT);
// Max belt dots that ANIMATE per orrery render (across all belts). Excess dots
// draw static — bounds per-frame compositor cost on dense/multi-belt systems.
const ORR_ANIM_DOT_BUDGET = 180;
// Max belt dots DRAWN per orrery render (across all belts). Beyond this we stop
// emitting dots entirely, so a system with many/dense belts can't balloon the DOM
// to thousands of <circle>s. The visual field stays full at typical densities.
const ORR_DOT_BUDGET = 700;
const ORR_INNER_A = 75;    // semi-major of orbit slot 1
const ORR_OUTER_A = 435;   // semi-major of the outermost slot
const ORR_AXIS_RATIO = 0.4; // semi-minor / semi-major
const ORR_PLANET_T = 207 * Math.PI / 180; // fan angle (bottom-left)

// Semi-major / semi-minor for orbit slot p (1..maxP), linearly spaced.
function orbitAxes(p, maxP){
  let a;
  if(maxP <= 1) a = (ORR_INNER_A + ORR_OUTER_A) / 2;
  else a = ORR_INNER_A + (ORR_OUTER_A - ORR_INNER_A) * (p - 1) / (maxP - 1);
  return [a, a * ORR_AXIS_RATIO];
}
function orbitPoint(a, b, t){
  const ex = a * Math.cos(t), ey = b * Math.sin(t);
  return [ ORR_SX + ex*ORR_COS - ey*ORR_SIN, ORR_SY + ex*ORR_SIN + ey*ORR_COS ];
}
function isBeltBody(b){
  // An explicit discStyle (set when a referee picks a class in the body editor)
  // is authoritative both ways, so a body can never read as a belt in one view
  // and a planet in another. Falls back to the type string for un-edited base
  // data (e.g. The Veil's "Asteroid Belt").
  if(b.discStyle) return b.discStyle === 'belt';
  return /asteroid belt/i.test(b.type || '');
}
// Deterministic 32-bit LCG seeded from a string (body id) — same belt every render.
function seedFromString(str){
  let h = 2166136261 >>> 0;
  for(let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function lcgNext(seed){ return ((seed * 1664525 + 1013904223) & 0xffffffff) >>> 0; }

// Coalesce rebuilds: the player poll, design-mode edits, and several view paths
// can all call buildOrrery() in a burst. Re-stringifying the whole SVG each time is
// the hot path, so collapse a burst into ONE rebuild on the next animation frame.
// (selectBody renders its detail panel from separate DOM, so a one-frame-late SVG
// is imperceptible and safe.)
let _orreryRaf = 0;
function buildOrrery(){
  if(_orreryRaf) return;
  if(typeof requestAnimationFrame !== 'function'){ buildOrreryNow(); return; }
  _orreryRaf = requestAnimationFrame(() => { _orreryRaf = 0; buildOrreryNow(); });
}
function buildOrreryNow(){
  const svg = document.getElementById("orrery-svg");
  if(!svg) return;
  const W=800, H=500;
  const bodies = getBodies();

  // Max occupied orbit slot drives the layout. Default 6 so a near-empty
  // system still spaces sensibly.
  const orbitPositions = bodies.filter(b => !b.isStar && !b.isMoon && b.orbitPos)
                               .map(b => b.orbitPos);
  const maxP = orbitPositions.length ? Math.max(6, Math.max.apply(null, orbitPositions)) : 6;

  // ── Body list table ────────────────────────────────────────
  const tbl = document.getElementById("body-list-table");
  if(tbl){
    tbl.innerHTML = `<tr><th>Body</th><th>Type</th><th>UWP</th><th></th></tr>`;
    bodies.forEach(b => {
      if(b.isMoon) return;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span style="display:inline-block;width:7px;height:7px;border-radius:${b.isStar?'0':'50%'};background:${b.color};margin-right:7px;vertical-align:middle"></span>
            <span style="color:${b.hook?'#E8A020':'var(--tx0)'};font-size:12px;font-weight:${b.hook?'700':'400'}">${b.name}</span></td>
        <td style="color:var(--tx1);font-size:10px">${(b.type||'').split('·')[0].trim()}</td>
        <td style="color:var(--accentGold);font-family:monospace;font-size:10px">${b.uwpString||'—'}</td>
        <td style="font-size:11px;color:#E8A020">${b.hook?'!':''}${b.tag==='CLASSIFIED'?'<span style="color:#C0392B;font-size:9px;font-family:monospace"> CLASSIF.</span>':''}${b.tag==='RESTRICTED'?'<span style="color:#9B59B6;font-size:9px;font-family:monospace"> RESTR.</span>':''}</td>`;
      tr.style.cursor="pointer";
      tr.setAttribute("role","button");
      tr.setAttribute("tabindex","0");
      tr.setAttribute("aria-label", `${b.name} — ${(b.type||'').split('·')[0].trim()}`);
      tr.onclick = () => selectBody(b.id);
      tr.onkeydown = (e) => { if(e.key==="Enter"||e.key===" "){ e.preventDefault(); selectBody(b.id); } };
      tbl.appendChild(tr);
    });
  }

  // ── Design-mode "Add Body" control (sibling of the table) ──
  const ovEl = document.getElementById("sys-overview");
  if(ovEl){
    let addBtn = document.getElementById("design-add-body-btn");
    if(designModeOn && isReferee()){
      if(!addBtn){
        addBtn = document.createElement("button");
        addBtn.id = "design-add-body-btn";
        addBtn.className = "design-add-btn";
        addBtn.style.cssText = "width:100%;margin-top:10px";
        addBtn.textContent = "+ Add Body";
        addBtn.onclick = openBodyCreator;
        ovEl.appendChild(addBtn);
      }
    } else if(addBtn){
      addBtn.remove();
    }
  }

  let html = "";

  // ── Defs — background + per-body shading gradients ─────────
  html += `<defs>
    <radialGradient id="bg-grad" cx="70%" cy="15%" r="80%">
      <stop offset="0%" stop-color="#0d1a35"/>
      <stop offset="100%" stop-color="#070a10"/>
    </radialGradient>`;
  // A shading gradient per non-star, non-belt body — but keyed by COLOUR, so N
  // bodies sharing a colour share ONE gradient def instead of emitting one apiece.
  const gradIds = {}; let gradSeq = 0;
  const gradId = (color) => { const c = color || '#888'; if(!(c in gradIds)) gradIds[c] = 'pg-'+(gradSeq++); return gradIds[c]; };
  const seenGrad = {};
  bodies.forEach(b => {
    if(b.isStar || isBeltBody(b)) return;
    const id = gradId(b.color); if(seenGrad[id]) return; seenGrad[id] = 1;
    html += `<radialGradient id="${id}" cx="65%" cy="30%" r="75%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="35%" stop-color="${b.color}" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000820" stop-opacity="0.45"/>
    </radialGradient>`;
  });
  html += `</defs>`;
  html += `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#bg-grad)"/>`;

  // ── Background stars ───────────────────────────────────────
  const STARS = [
    [30,30],[80,15],[145,45],[230,22],[320,8],[430,35],[520,18],[610,42],[690,25],[755,15],
    [15,85],[95,70],[190,90],[285,65],[375,80],[465,58],[555,72],[640,68],[720,80],[775,65],
    [22,140],[120,158],[210,132],[300,145],[410,135],[500,150],[590,130],[680,142],[760,128],
    [40,195],[130,210],[220,185],[350,202],[450,188],[560,205],[660,192],[758,200],
    [18,255],[100,268],[195,245],[310,260],[420,250],[540,265],[648,252],[755,262],
    [55,320],[160,335],[255,315],[365,328],[470,318],[575,332],[672,320],[760,330],
    [35,385],[140,398],[245,378],[355,392],[465,382],[570,395],[668,385],[762,395],
    [60,448],[155,460],[270,442],[380,455],[490,445],[595,458],[695,448],[762,460]
  ];
  STARS.forEach(([x,y],i) => {
    const r = i%7===0?1.5:i%3===0?1.2:0.8;
    const op = 0.15+((i*7)%5)*0.1;
    const cls = i%13===0?'twinkle-a':i%17===0?'twinkle-b':i%19===0?'twinkle-c':'';
    html += `<circle cx="${x}" cy="${y}" r="${r}" fill="white" opacity="${op}"${cls?' class="'+cls+'"':''} pointer-events="none"/>`;
  });

  const tiltDeg = (ORR_TILT * 180 / Math.PI).toFixed(1);

  // ── Orbit ellipses (one per slot, belt slots styled copper) ─
  const beltSlots = {};
  bodies.forEach(b => { if(isBeltBody(b) && b.orbitPos) beltSlots[b.orbitPos] = true; });
  for(let p = maxP; p >= 1; p--){
    const [a,b] = orbitAxes(p, maxP);
    const isBelt = !!beltSlots[p];
    html += `<ellipse class="orbit-ring" cx="${ORR_SX}" cy="${ORR_SY}" rx="${a.toFixed(1)}" ry="${b.toFixed(1)}" fill="none"
      stroke="${isBelt ? '#8B735566' : '#1a3a6a'}"
      stroke-width="${isBelt ? '3' : '1'}"
      stroke-dasharray="${isBelt ? '2,3' : '5,6'}"
      opacity="${isBelt ? '0.7' : '0.55'}"
      transform="rotate(${tiltDeg},${ORR_SX},${ORR_SY})"/>`;
  }

  // ── Asteroid belts — seeded procedural dot fields ──────────
  // The per-dot "vibe" is a sub-pixel transform animation; on SVG circles it is
  // not GPU-composited, so hundreds of them melt frame rate on tablet hardware.
  // Cap how many dots ANIMATE (across all belts) — the rest render identically
  // but static. Visual density is unchanged; the jitter is imperceptible anyway.
  // When motion is off (prefers-reduced-motion or the referee's animations toggle),
  // emit every belt dot static — no vibe class, no per-dot animation timing. The CSS
  // already neutralises .ast then, but skipping the work keeps the markup lean too.
  const motionOff = (typeof matchMedia==='function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
                 || (typeof rootEl!=='undefined' && rootEl && rootEl.classList.contains('anim-off'));
  let animBudget = motionOff ? 0 : ORR_ANIM_DOT_BUDGET;
  let dotBudget = ORR_DOT_BUDGET;                    // total drawn dots across all belts
  bodies.forEach(b => {
    if(!isBeltBody(b) || !b.orbitPos) return;
    const [va, vb] = orbitAxes(b.orbitPos, maxP);
    const col = b.color || '#8B7355';
    const density = Math.max(20, Math.min(600, b.beltDensity || 160));
    const draw = Math.max(0, Math.min(density, dotBudget));   // cull once the global budget is spent
    dotBudget -= draw;
    const VIBE = ['va','vb','vc','vd','ve','vf','vg','vh'];
    let rng = seedFromString(b.id || 'belt');
    for(let i=0;i<draw;i++){
      rng = lcgNext(rng); const arcFrac = (rng % 10000) / 10000;
      rng = lcgNext(rng); const radialJitter = ((rng % 10000) / 10000 - 0.5) * 0.28;
      rng = lcgNext(rng); const dotSize = 0.7 + (rng % 10000)/10000 * 1.8;
      rng = lcgNext(rng); const op = 0.3 + (rng % 10000)/10000 * 0.6;
      rng = lcgNext(rng); const vibeClass = VIBE[rng % 8];
      rng = lcgNext(rng); const vibeDur = (1.8 + (rng % 10000)/10000 * 2.4).toFixed(2);
      rng = lcgNext(rng); const vibeDelay = ((rng % 10000)/10000 * 3.0).toFixed(2);
      const ang = arcFrac * Math.PI * 2;
      const ra = va * (1 + radialJitter), rb = vb * (1 + radialJitter);
      const ex = ra * Math.cos(ang), ey = rb * Math.sin(ang);
      const vx = ORR_SX + ex*ORR_COS - ey*ORR_SIN;
      const vy = ORR_SY + ex*ORR_SIN + ey*ORR_COS;
      const animate = animBudget > 0; if(animate) animBudget--;
      const anim = animate ? ` ${vibeClass}" style="animation-duration:${vibeDur}s;animation-delay:-${vibeDelay}s"` : `"`;
      html += `<circle cx="${vx.toFixed(1)}" cy="${vy.toFixed(1)}" r="${dotSize.toFixed(1)}" fill="${col}" opacity="${op.toFixed(2)}" class="ast${anim} pointer-events="none"/>`;
    }
    // Belt click target + label at the fan position
    const [bpx,bpy] = orbitPoint(va, vb, ORR_PLANET_T);
    if(selectedBody===b.id) html += `<ellipse cx="${ORR_SX}" cy="${ORR_SY}" rx="${(va+2).toFixed(1)}" ry="${(vb+2).toFixed(1)}" fill="${col}" opacity="0.08" transform="rotate(${tiltDeg},${ORR_SX},${ORR_SY})" pointer-events="none"/>`;
    html += `<circle cx="${bpx.toFixed(1)}" cy="${bpy.toFixed(1)}" r="28" fill="transparent" data-body="${b.id}" class="body-node" style="cursor:pointer"/>`;
    html += `<text x="${bpx.toFixed(1)}" y="${(bpy+32).toFixed(1)}" text-anchor="middle" fill="${b.hook?'#E8A020':'#8b91a8'}" font-size="9" font-family="monospace" pointer-events="none">${b.name}</text>`;
    if(b.hook) html += `<text x="${(bpx+18).toFixed(1)}" y="${(bpy-12).toFixed(1)}" fill="#E8A020" font-size="11" font-weight="700" pointer-events="none">!</text>`;
  });

  // ── Draw order: planets far→near, then star, then moons ────
  const planets = bodies.filter(b => !b.isStar && !b.isMoon && !isBeltBody(b) && b.orbitPos)
                        .sort((a,b) => (b.orbitPos||0) - (a.orbitPos||0));
  const star = bodies.find(b => b.isStar);
  const moons = bodies.filter(b => b.isMoon);

  // Helper: where a parent body sits, so moons can hang off it
  function parentPos(parentId){
    const p = bodies.find(b => b.id === parentId);
    if(!p || !p.orbitPos) return null;
    return orbitPoint(...orbitAxes(p.orbitPos, maxP), ORR_PLANET_T);
  }

  // ── Planets ────────────────────────────────────────────────
  planets.forEach(b => {
    const [px,py] = orbitPoint(...orbitAxes(b.orbitPos, maxP), ORR_PLANET_T);
    const r = b.displayRadius || 7;
    const gid = gradId(b.color);
    if(selectedBody===b.id) html += `<circle cx="${px}" cy="${py}" r="${r+7}" fill="${b.color}" opacity="0.2" pointer-events="none"/>`;
    html += `<circle cx="${px}" cy="${py}" r="${r+4}" fill="${b.color}" opacity="0.07" pointer-events="none"/>`;
    html += `<g id="anim-planet-${b.id}" data-orbit="${b.orbitPos}" data-base-t="${ORR_PLANET_T}">`;
    html += `<circle cx="${px}" cy="${py}" r="${r}" fill="${b.color}" data-body="${b.id}" class="body-node" style="cursor:pointer"/>`;
    const tUrlP = textureUrlFor(b);
    if(tUrlP){
      const tp = escAttr(tUrlP);
      html += `<clipPath id="orr-tex-${b.id}"><circle cx="${px}" cy="${py}" r="${r}"/></clipPath>`;
      html += `<image href="${tp}" xlink:href="${tp}" x="${px-r}" y="${py-r}" width="${2*r}" height="${2*r}" preserveAspectRatio="xMidYMid slice" clip-path="url(#orr-tex-${b.id})" pointer-events="none"/>`;
    }
    html += `<circle cx="${px}" cy="${py}" r="${r}" fill="url(#${gid})" pointer-events="none"/>`;

    // Rings — data-driven via ringStyle: 'major' | 'subtle'
    if(b.ringStyle === 'major'){
      html += `<ellipse cx="${px}" cy="${py}" rx="${r+14}" ry="${(r+14)*0.27}" fill="none" stroke="${b.color}" stroke-width="2" opacity="0.3" pointer-events="none"/>`;
      html += `<ellipse cx="${px}" cy="${py}" rx="${r+9}" ry="${(r+9)*0.27}" fill="none" stroke="${b.color}" stroke-width="3.5" opacity="0.55" pointer-events="none"/>`;
      html += `<circle cx="${px}" cy="${py}" r="${r}" fill="${b.color}" clip-path="inset(0 0 50% 0)" pointer-events="none"/>`;
      html += `<circle cx="${px}" cy="${py}" r="${r}" fill="url(#${gid})" clip-path="inset(0 0 50% 0)" pointer-events="none"/>`;
    } else if(b.ringStyle === 'subtle'){
      html += `<ellipse cx="${px}" cy="${py}" rx="${r+8}" ry="${(r+8)*0.22}" fill="none" stroke="${b.color}" stroke-width="2" opacity="0.38" pointer-events="none"/>`;
      html += `<circle cx="${px}" cy="${py}" r="${r}" fill="${b.color}" clip-path="inset(0 0 50% 0)" pointer-events="none"/>`;
      html += `<circle cx="${px}" cy="${py}" r="${r}" fill="url(#${gid})" clip-path="inset(0 0 50% 0)" pointer-events="none"/>`;
    }

    if(b.hook) html += `<text x="${px+r+2}" y="${py-r-1}" fill="#E8A020" font-size="11" font-weight="700" pointer-events="none">!</text>`;
    html += `<text x="${px}" y="${py+r+14}" text-anchor="middle" fill="${b.hook?'#E8A020':'#8b91a8'}" font-size="9" font-family="monospace" pointer-events="none">${b.name}</text>`;
    html += `</g>`;
  });

  // ── Star ───────────────────────────────────────────────────
  if(star){
    const sr = star.displayRadius || 18;
    html += `<circle id="star-glow-outer" cx="${ORR_SX}" cy="${ORR_SY}" r="${sr*2.9}" fill="${star.color}" opacity="0.06"/>`;
    html += `<circle id="star-glow-mid" cx="${ORR_SX}" cy="${ORR_SY}" r="${sr*2.1}" fill="${star.color}" opacity="0.12"/>`;
    html += `<circle cx="${ORR_SX}" cy="${ORR_SY}" r="${sr*1.45}" fill="${star.color}" opacity="0.22"/>`;
    html += `<circle cx="${ORR_SX}" cy="${ORR_SY}" r="${sr}" fill="${star.color}" data-body="${star.id}" class="body-node" style="cursor:pointer"/>`;
    if(selectedBody===star.id) html += `<circle cx="${ORR_SX}" cy="${ORR_SY}" r="${sr*1.45}" fill="none" stroke="${star.color}" stroke-width="1.5" opacity="0.7" pointer-events="none"/>`;
    html += `<text x="${ORR_SX}" y="${ORR_SY+sr+18}" text-anchor="middle" fill="#E8A020" font-size="9" font-family="monospace" pointer-events="none">${star.name}</text>`;
  }

  // ── Moons — fanned generically around their parent ─────────
  // Group by parent so multiple moons spread out instead of overlapping.
  const moonsByParent = {};
  moons.forEach(m => { (moonsByParent[m.parentId] = moonsByParent[m.parentId] || []).push(m); });
  Object.keys(moonsByParent).forEach(pid => {
    const base = parentPos(pid);
    if(!base) return;
    const [bx,by] = base;
    const list = moonsByParent[pid];
    const parentBody = bodies.find(b => b.id === pid);
    const pr = (parentBody && parentBody.displayRadius) || 11;
    const ringR = pr + 16;
    list.forEach((m, idx) => {
      // Spread moons across an arc on the sunward/upper side
      const frac = list.length === 1 ? 0.5 : idx / (list.length - 1);
      const ang = (-140 + frac * 200) * Math.PI / 180; // -140°..+60°
      const mx = bx + ringR * Math.cos(ang);
      const my = by + ringR * 0.6 * Math.sin(ang);
      const mr = 4;
      html += `<line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${mx.toFixed(1)}" y2="${my.toFixed(1)}" stroke="#555566" stroke-width="0.5" opacity="0.5" pointer-events="none"/>`;
      html += `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="${mr}" fill="${m.color}" ${m.decoration==='dim'?'opacity="0.4"':''} data-body="${m.id}" class="body-node" style="cursor:pointer"/>`;
      const gid = gradId(m.color);
      const tUrlM = textureUrlFor(m);
      if(tUrlM){
        const tm = escAttr(tUrlM);
        html += `<clipPath id="orr-tex-${m.id}"><circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="${mr}"/></clipPath>`;
        html += `<image href="${tm}" xlink:href="${tm}" x="${(mx-mr).toFixed(1)}" y="${(my-mr).toFixed(1)}" width="${2*mr}" height="${2*mr}" preserveAspectRatio="xMidYMid slice" clip-path="url(#orr-tex-${m.id})" pointer-events="none"/>`;
      }
      html += `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="${mr}" fill="url(#${gid})" pointer-events="none"/>`;
      if(m.hook) html += `<text x="${(mx+5).toFixed(1)}" y="${(my-4).toFixed(1)}" fill="#E8A020" font-size="9" font-weight="700" pointer-events="none">!</text>`;
      // Optional asteroid-cluster decoration near the moon
      if(m.decoration === 'cluster'){
        html += `<text x="${(mx+25).toFixed(1)}" y="${(my+3).toFixed(1)}" fill="#8b91a8" font-size="7" font-family="monospace" dominant-baseline="middle" pointer-events="none">${m.name}</text>`;
        const dm = [{dx:-8,dy:-4,r:1.1},{dx:-12,dy:1,r:0.8},{dx:-5,dy:5,r:1.3},{dx:-9,dy:-8,r:0.7},{dx:4,dy:-6,r:0.9},{dx:8,dy:-3,r:1.0}];
        dm.forEach(a => { html += `<circle cx="${(mx+a.dx).toFixed(1)}" cy="${(my+a.dy).toFixed(1)}" r="${a.r}" fill="#8B7355" opacity="0.7" pointer-events="none"/>`; });
      } else {
        html += `<text x="${(mx+7).toFixed(1)}" y="${(my+3).toFixed(1)}" fill="#8b91a8" font-size="7" font-family="monospace" dominant-baseline="middle" pointer-events="none">${m.name}</text>`;
      }
    });
  });

  svg.innerHTML = html;
  svg.querySelectorAll(".body-node").forEach(el => {
    el.addEventListener("click", () => selectBody(el.getAttribute("data-body")));
    el.addEventListener("touchend", e => { e.preventDefault(); selectBody(el.getAttribute("data-body")); });
  });
}

// Shared renderer for a body's content sections (UWP header, fields, overview,
// read-aloud, referee note, NPCs, checks, events). Used by BOTH the orrery
// detail panel (selectBody) and the close-up body view (buildBodyView) so the
// two never diverge and their design-mode edits resolve to the same keys.
function renderBodyContentSections(body, pm){
  const id = body.id;
  let html = "";

  if(body.uwpString&&body.uwpString!=="—"){
    html += `<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px">
      <span style="font-family:monospace;font-size:18px;color:var(--accentGold);font-weight:700">${body.uwpString}</span>
      <span style="font-size:9px;color:#8b91a8;font-family:monospace;letter-spacing:1px">${body.tag||""}</span>
    </div>`;
  }

  const fields=[["Orbit",body.orbitAU],["Diameter",body.diameter],["Period",body.period]].filter(f=>f[1]&&f[1]!=="—");
  if(fields.length) html += `<div class="sg">${fields.map(([l,v])=>`<div class="sg-l">${l}</div><div class="sg-v">${v}</div>`).join("")}</div>`;

  const sbDescKey = 'body-'+id+'-desc';
  designOriginalRegistry[sbDescKey] = body.desc;
  const sbDescText = resolveContent(sbDescKey, body.desc);
  html += `<div class="s-sec"><div class="s-sec-lbl">Overview</div><div class="s-desc">${designWrap(sbDescKey, body.desc, (sbDescText||'').replace(/\n/g,"<br>"))}</div></div>`;

  // Referee boxes (Read Aloud, Referee Note, + any custom box types) are
  // registry-driven so adding / removing / renaming a box propagates to every
  // body. Built-ins keep their original content keys for back-compat.
  html += renderBoxTypesHTML(
    bt => bt.builtin ? ('body-'+id+'-'+bt.key) : ('body-'+id+'-box-'+bt.key),
    bk => body[bk],
    pm, false
  );

  if(!pm&&body.npcs&&body.npcs.length){
    html += `<div class="s-sec ref-only"><div class="s-sec-lbl">NPCs</div>`;
    body.npcs.forEach((n,i)=>{
      const nid=`sys-npc-${id}-${i}`;
      const rowListKey = 'body-'+id+'-npc-'+i+'-rows';
      const rowBaseKey = 'body-'+id+'-npc-'+i+'-row-';
      const mergedRows = mergeListWithAdditions(n.rows, rowListKey, rowBaseKey);
      const rowsHTML = mergedRows.map(({item:r, key:rkey}) => {
        designOriginalRegistry[rkey] = r;
        const rdata = resolveContent(rkey, r);
        const pencil = designModeOn ? `<button class="design-edit-pencil-inline" onclick="openDesignEditNpcRow('${rkey}', ${JSON.stringify(r).replace(/"/g,'&quot;')})" title="Edit this detail">✏</button>` : '';
        const trash = designModeOn ? `<button class="design-edit-pencil-inline danger" onclick="deleteContentItem('${rkey}', ${JSON.stringify(rdata).replace(/"/g,'&quot;')})" title="Remove this detail">🗑</button>` : '';
        return `<div class="npc-row" style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px"><div><div class="nrl">${rdata[0]}</div><div class="nrv">${rdata[1]}</div></div><span style="display:flex;gap:4px;flex-shrink:0">${pencil}${trash}</span></div>`;
      }).join("");
      const addRowBtn = designModeOn ? `<button class="design-add-btn" style="margin-top:6px" onclick="addNewNpcRow('${rowListKey}')">+ Add Detail</button>` : '';
      html += `<div class="npc-card"><div class="npc-hdr" onclick="toggleNPC('${nid}',this)">
        <div><div class="npc-name">${n.name}</div><div class="npc-role">${n.role}</div></div>
        <span class="chev" id="${nid}-chev">▾</span></div>
        <div class="npc-body" id="${nid}">
          <div class="skill-row">${n.skills}</div>
          ${rowsHTML}
          ${addRowBtn}
        </div></div>`;
    });
    html += `</div>`;
  }

  if(!pm&&body.checks&&body.checks.length){
    html += `<div class="s-sec ref-only"><div class="s-sec-lbl">Skill Checks</div>`;
    const degCls={ds:"deg-s",dp:"deg-p",df:"deg-f"};
    body.checks.forEach(c=>{
      html += `<div class="chk"><div class="chk-t">${c.skill}</div>`;
      c.degrees.forEach(d=>{
        const cls=d.cls||degCls[d.c]||"deg-p";
        const lbl=d.label||d.l||"";
        const txt=d.text||d.t||"";
        html+=`<div class="deg-row"><div class="${cls}">${lbl}</div><div style="font-size:11px">${txt}</div></div>`;
      });
      html += `</div>`;
    });
    html += `</div>`;
  }

  if(!pm&&body.events&&body.events.length){
    html += `<div class="s-sec ref-only"><div class="s-sec-lbl">Events</div>`;
    body.events.forEach(e=>html+=`<div class="evt"><div class="evt-t">${e.t}</div>${e.e}</div>`);
    html += `</div>`;
  }
  return html;
}

function selectBody(id){
  selectedBody = id;
  const body = getBodies().find(b=>b.id===id);
  if(!body) return;
  buildOrrery();

  document.getElementById("sys-overview").classList.add("v-hidden");
  const det = document.getElementById("sys-body-detail");
  det.classList.remove("v-hidden");

  const nm = document.getElementById("sys-dname");
  nm.textContent = body.name.toUpperCase();
  nm.style.color = body.color;
  document.getElementById("sys-dtype").textContent = body.type.toUpperCase();

  // The legacy bespoke "View Aurelia" button is retired — Aurelia now uses the
  // same generic close-up button as every other body (below). Keep it hidden.
  const stBtn = document.getElementById("btn-view-station");
  if(stBtn) stBtn.classList.add("v-hidden");

  const pm = pmCheck.checked;
  let html = "";

  // Generic close-up entry — every body, Aurelia included.
  html += `<button class="view-close-btn" onclick="goBodyView('${body.id}')">⊙ View ${escHtml(body.name)} up close</button>`;

  html += renderBodyContentSections(body, pm);

  // ── Design-mode body controls ──────────────────────────────
  if(designModeOn && isReferee()){
    const added = isAddedBody(body.id);
    html += `<div class="s-sec ref-only" style="border-top:.5px dashed var(--bd0);margin-top:14px;padding-top:12px">
      <div class="s-sec-lbl" style="color:#9B59B6">Design — This Body</div>
      <button class="design-add-btn" style="width:100%;margin-bottom:6px" onclick="openBodyEditor('${body.id}')">✦ Edit Body Properties</button>
      <button class="design-add-btn" style="width:100%;border-color:#d45050;color:#d45050" onclick="deleteBody('${body.id}')">🗑 ${added?'Delete This Body':'Remove This Body'}</button>
    </div>`;
  }

  det.innerHTML = html;
  setBreadcrumb([{label:"The Orion Arm",fn:"goGalaxy"},{label:currentSystemName(),fn:"goSystem"}], body.name);
}

// Returns to the system body-list overview (used after deleting the body
// currently being inspected, and reachable from the breadcrumb).
function goSystemOverview(){
  selectedBody = null;
  const det = document.getElementById("sys-body-detail");
  if(det){ det.classList.add("v-hidden"); det.innerHTML = ""; }
  const ov = document.getElementById("sys-overview");
  if(ov) ov.classList.remove("v-hidden");
  const stBtn = document.getElementById("btn-view-station");
  if(stBtn) stBtn.classList.add("v-hidden");
  renderSystemOverview(); // sets name/star-info, swaps body-list vs blank prompt
  setBreadcrumb([{label:"The Orion Arm",fn:"goGalaxy"}], currentSystemName());
  updateBackBtn();
  buildOrrery();
}

// True if the body id belongs to a referee-added body (vs a base body).
function isAddedBody(id){
  return (bodyAdditions[currentSystemId] || []).some(b => b.id === id);
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERIC BODY CLOSE-UP VIEW  —  Phase 1
// ═══════════════════════════════════════════════════════════════════════════
// A data-driven close-up page for any body. The disc visual is chosen from the
// body's discStyle (auto-derived from type when not explicitly set), so a gas
// giant, ice world, scorched rock, ocean world, star, moon, or belt each read
// differently. The right panel reuses renderBodyContentSections so its content
// and design-mode edits stay in lockstep with the orrery detail panel.
// Locations (Phase 2) and interiors (Phase 4) hang off this same view later.

// Pick the visual treatment for a body. Explicit body.discStyle wins; otherwise
// derive from type keywords / flags. Returns one of:
//   star | belt | gasgiant | ocean | ice | rock | moon
function bodyDiscStyle(body){
  if(body.discStyle) return body.discStyle;
  const t = (body.type || '').toLowerCase();
  if(body.isStar) return 'star';
  if(/asteroid belt/.test(t)) return 'belt';  // matches isBeltBody exactly
  if(/gas giant|ice giant/.test(t)) return 'gasgiant';
  if(body.isMoon) return 'moon';
  if(/jewel|ocean|garden/.test(t)) return 'ocean';
  if(/ice/.test(t)) return 'ice';
  return 'rock';
}

// Friendly label for the disc-style picker in the body editor (Phase-1 read-only
// display; editor wiring uses the same keys).
const DISC_STYLE_LABELS = {
  star:'Star', belt:'Asteroid Belt', gasgiant:'Gas / Ice Giant',
  ocean:'Ocean / Jewel', ice:'Ice World', rock:'Rock World', moon:'Moon'
};

// ── Disc renderer ──────────────────────────────────────────────────────────
// Returns an SVG inner-markup string for the fixed 800×600 viewBox. Pure SVG so
// every body is self-contained and portable across systems (no bespoke CSS
// divs). Seeded by body id so craters / belts are stable across renders.
function renderBodyDisc(body){
  const W=800, H=600, CX=400, CY=300;
  const style = bodyDiscStyle(body);
  const col = body.color || '#8b91a8';
  let s = '';

  // ── Background star field (deterministic) ──
  const STARS = [
    [32,22],[88,55],[155,18],[245,48],[348,12],[472,38],[588,68],[672,22],[748,50],
    [62,105],[152,132],[318,98],[428,128],[548,88],[648,118],[740,105],
    [22,188],[138,208],[232,168],[408,198],[528,178],[688,198],[772,168],
    [48,278],[158,298],[268,258],[398,288],[512,278],[638,268],[752,308],
    [88,368],[208,388],[372,348],[468,408],[608,368],[712,388],
    [30,455],[140,478],[280,442],[430,465],[570,445],[700,470],[770,445],
    [60,525],[180,548],[350,515],[490,538],[650,518],[750,540]
  ];
  STARS.forEach(([x,y],i) => {
    const r = i%5===0 ? 1.5 : 1;
    const op = 0.2 + (i%3)*0.15;
    s += `<circle cx="${x}" cy="${y}" r="${r}" fill="white" opacity="${op}" pointer-events="none"/>`;
  });

  // ── Ambient star-light glow from upper-right (toward Auros) ──
  s += `<defs>
    <radialGradient id="bv-ambient" cx="82%" cy="12%" r="65%">
      <stop offset="0%" stop-color="#E07030" stop-opacity="0.13"/>
      <stop offset="100%" stop-color="#E07030" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bv-base" cx="64%" cy="30%" r="78%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.32"/>
      <stop offset="42%" stop-color="${col}" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000610" stop-opacity="0.55"/>
    </radialGradient>
    <clipPath id="bv-clip"><circle cx="${CX}" cy="${CY}" r="110"/></clipPath>
  </defs>`;
  s += `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#bv-ambient)"/>`;

  if(style === 'belt')      s += discBelt(body, CX, CY, col);
  else if(style === 'star') s += discStar(body, CX, CY, col);
  else                      s += discPlanet(body, CX, CY, col, style);

  return s;
}

// Seeded RNG helpers reuse the orrery's seedFromString / lcgNext.
function discRng(seedStr){
  let rng = seedFromString(seedStr || 'body');
  return () => { rng = lcgNext(rng); return (rng % 100000) / 100000; };
}

// ── Planet-like disc (ocean / ice / rock / gasgiant / moon) ──
function discPlanet(body, CX, CY, col, style){
  const PR = style==='moon' ? 80 : style==='gasgiant' ? 122 : 110;
  let s = '';
  const rnd = discRng(body.id);

  // Soft outer atmosphere / glow halo (skip for airless rock & moon → thinner)
  const airy = (style==='ocean' || style==='gasgiant' || style==='ice');
  if(airy){
    s += `<circle cx="${CX}" cy="${CY}" r="${PR+12}" fill="${col}" opacity="0.05" pointer-events="none"/>`;
    s += `<circle cx="${CX}" cy="${CY}" r="${PR+5}" fill="none" stroke="${col}" stroke-width="6" opacity="0.10" pointer-events="none"/>`;
  }

  // Base sphere — body colour, click target for entering (Phase 2+); also the
  // fallback fill shown under/around a photo texture while it loads or if it
  // fails to resolve.
  s += `<circle cx="${CX}" cy="${CY}" r="${PR}" fill="${col}" data-body="${body.id}" class="bv-disc" style="cursor:default"/>`;

  // Gas-giant band detail is captured in a variable so it can be re-emitted
  // over the lower hemisphere after the ring-occlusion redraw — otherwise the
  // flat front-half repaint erases the banding on the bottom of ringed giants.
  // (Stays empty for photo-textured bodies, so the ring redraw is skipped.)
  let ggDetail = '';

  const texUrl = textureUrlFor(body);
  if(texUrl){
    // ── Data-driven photo texture ────────────────────────────────────────────
    // A pre-rendered lit globe PNG (hosted, transparent background) replaces the
    // procedural surface AND the heavy shading/terminator — the image already
    // carries its own lighting. Clipped to the body's actual radius for safety.
    s += `<clipPath id="bv-tex-clip"><circle cx="${CX}" cy="${CY}" r="${PR}"/></clipPath>`;
    const tex = escAttr(texUrl);
    s += `<image href="${tex}" xlink:href="${tex}" x="${CX-PR}" y="${CY-PR}" width="${2*PR}" height="${2*PR}" preserveAspectRatio="xMidYMid slice" clip-path="url(#bv-tex-clip)" pointer-events="none"/>`;
    // A light limb-darkening pass so the globe seats into the scene rather than
    // looking pasted on — much softer than the procedural disc's full shading.
    s += `<circle cx="${CX}" cy="${CY}" r="${PR}" fill="url(#bv-base)" opacity="0.4" pointer-events="none"/>`;
  } else {

  // Clipped style-specific surface detail
  s += `<g clip-path="url(#bv-clip)">`;

  if(style === 'gasgiant'){
    // Horizontal banding — alternating light/dark translucent strips
    const bands = 7;
    for(let i=0;i<bands;i++){
      const yy = CY - PR + (i + 0.5) * (2*PR/bands);
      const h  = (2*PR/bands) * (0.62 + rnd()*0.5);
      const light = i % 2 === 0;
      ggDetail += `<ellipse cx="${CX}" cy="${yy.toFixed(1)}" rx="${PR}" ry="${(h/2).toFixed(1)}" fill="${light?'#ffffff':'#000610'}" opacity="${(light?0.07:0.14).toFixed(2)}"/>`;
    }
    // A storm oval (great spot)
    const spotY = CY + (rnd()-0.5)*PR*0.7;
    ggDetail += `<ellipse cx="${(CX-PR*0.2).toFixed(1)}" cy="${spotY.toFixed(1)}" rx="${(PR*0.22).toFixed(1)}" ry="${(PR*0.12).toFixed(1)}" fill="#ffffff" opacity="0.10"/>`;
    ggDetail += `<ellipse cx="${(CX-PR*0.2).toFixed(1)}" cy="${spotY.toFixed(1)}" rx="${(PR*0.12).toFixed(1)}" ry="${(PR*0.06).toFixed(1)}" fill="#000610" opacity="0.12"/>`;
    s += ggDetail;
  } else if(style === 'ocean'){
    // Cloud swirls + landmass blots
    for(let i=0;i<5;i++){
      const a = rnd()*Math.PI*2, d = rnd()*PR*0.75;
      const x = CX + Math.cos(a)*d, y = CY + Math.sin(a)*d;
      s += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(18+rnd()*36).toFixed(1)}" ry="${(10+rnd()*16).toFixed(1)}" fill="#ffffff" opacity="${(0.06+rnd()*0.08).toFixed(2)}" transform="rotate(${(rnd()*60-30).toFixed(0)},${x.toFixed(1)},${y.toFixed(1)})"/>`;
    }
    for(let i=0;i<3;i++){
      const a = rnd()*Math.PI*2, d = rnd()*PR*0.6;
      const x = CX + Math.cos(a)*d, y = CY + Math.sin(a)*d;
      s += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(14+rnd()*22).toFixed(1)}" ry="${(9+rnd()*14).toFixed(1)}" fill="#1d3b2a" opacity="0.18"/>`;
    }
  } else if(style === 'ice'){
    // Frost sheen + fracture lines
    for(let i=0;i<4;i++){
      const a = rnd()*Math.PI*2, d = rnd()*PR*0.7;
      const x = CX + Math.cos(a)*d, y = CY + Math.sin(a)*d;
      s += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(16+rnd()*28).toFixed(1)}" ry="${(8+rnd()*12).toFixed(1)}" fill="#ffffff" opacity="${(0.07+rnd()*0.07).toFixed(2)}"/>`;
    }
    for(let i=0;i<5;i++){
      const x1 = CX-PR + rnd()*2*PR, y1 = CY-PR + rnd()*2*PR;
      const x2 = x1 + (rnd()*60-30), y2 = y1 + (rnd()*60-30);
      s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#cfe4ff" stroke-width="0.8" opacity="0.25"/>`;
    }
  } else { // rock & moon
    // Craters — seeded; rim highlight + dark floor
    const n = style==='moon' ? 9 : 12;
    for(let i=0;i<n;i++){
      const a = rnd()*Math.PI*2, d = rnd()*PR*0.82;
      const x = CX + Math.cos(a)*d, y = CY + Math.sin(a)*d;
      const cr = 3 + rnd()*11;
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${cr.toFixed(1)}" fill="#000610" opacity="0.16"/>`;
      s += `<circle cx="${(x-cr*0.25).toFixed(1)}" cy="${(y-cr*0.25).toFixed(1)}" r="${(cr*0.7).toFixed(1)}" fill="#ffffff" opacity="0.05"/>`;
    }
  }
  s += `</g>`;

  // Shading gradient overlay (limb darkening + sunward highlight)
  s += `<circle cx="${CX}" cy="${CY}" r="${PR}" fill="url(#bv-base)" pointer-events="none"/>`;

  // Terminator shadow (sunward from upper-right → shadow lower-left)
  s += `<g clip-path="url(#bv-clip)"><ellipse cx="${CX-36}" cy="${CY+18}" rx="${PR*0.92}" ry="${PR}" fill="#000610" opacity="0.30" transform="rotate(-18,${CX-36},${CY+18})"/></g>`;
  } // ── end procedural (non-textured) surface ──

  // Rings (data-driven, reusing body.ringStyle)
  if(body.ringStyle === 'major' || body.ringStyle === 'subtle'){
    const rr = body.ringStyle==='major' ? PR+44 : PR+30;
    const sw = body.ringStyle==='major' ? 9 : 5;
    s += `<ellipse cx="${CX}" cy="${CY}" rx="${rr}" ry="${(rr*0.26).toFixed(1)}" fill="none" stroke="${col}" stroke-width="${sw}" opacity="0.28" pointer-events="none"/>`;
    s += `<ellipse cx="${CX}" cy="${CY}" rx="${(rr-sw-3).toFixed(1)}" ry="${((rr-sw-3)*0.26).toFixed(1)}" fill="none" stroke="${col}" stroke-width="${(sw*0.5).toFixed(1)}" opacity="0.18" pointer-events="none"/>`;
    // Redraw the front (lower) half of the planet over the back of the ring.
    // For gas giants, re-emit the band detail clipped to that lower hemisphere
    // so the bottom half keeps its banding rather than rendering flat.
    const frontHalf = `M ${CX-PR} ${CY} A ${PR} ${PR} 0 0 0 ${CX+PR} ${CY} Z`;
    s += `<path d="${frontHalf}" fill="${col}" pointer-events="none"/>`;
    if(ggDetail){
      s += `<clipPath id="bv-front"><path d="${frontHalf}"/></clipPath>`;
      s += `<g clip-path="url(#bv-clip)"><g clip-path="url(#bv-front)">${ggDetail}</g></g>`;
    }
    s += `<path d="${frontHalf}" fill="url(#bv-base)" pointer-events="none"/>`;
  }

  // Name label
  s += `<text x="${CX}" y="${CY+PR+30}" text-anchor="middle" fill="${body.hook?'#E8A020':'#8b91a8'}" font-size="13" font-family="monospace" font-weight="700" letter-spacing="2" pointer-events="none">${(body.name||'').toUpperCase()}</text>`;
  return s;
}

// ── Star disc — glowing core + corona, no terminator ──
function discStar(body, CX, CY, col){
  let s = '';
  s += `<circle cx="${CX}" cy="${CY}" r="190" fill="${col}" opacity="0.05" pointer-events="none"/>`;
  s += `<circle cx="${CX}" cy="${CY}" r="150" fill="${col}" opacity="0.08" pointer-events="none"/>`;
  s += `<circle cx="${CX}" cy="${CY}" r="118" fill="${col}" opacity="0.14" pointer-events="none"/>`;
  s += `<circle cx="${CX}" cy="${CY}" r="92" fill="${col}" opacity="0.30" pointer-events="none"/>`;
  // Core with soft white centre
  s += `<defs><radialGradient id="bv-star" cx="50%" cy="42%" r="60%">
    <stop offset="0%" stop-color="#fff7ec" stop-opacity="0.95"/>
    <stop offset="55%" stop-color="${col}"/>
    <stop offset="100%" stop-color="${col}"/>
  </radialGradient></defs>`;
  s += `<circle cx="${CX}" cy="${CY}" r="78" fill="url(#bv-star)" data-body="${body.id}" class="bv-disc"/>`;
  // Subtle flare ticks around the rim
  const rnd = discRng(body.id);
  for(let i=0;i<14;i++){
    const a = (i/14)*Math.PI*2 + rnd()*0.2;
    const r1 = 80, r2 = 80 + 8 + rnd()*22;
    s += `<line x1="${(CX+Math.cos(a)*r1).toFixed(1)}" y1="${(CY+Math.sin(a)*r1).toFixed(1)}" x2="${(CX+Math.cos(a)*r2).toFixed(1)}" y2="${(CY+Math.sin(a)*r2).toFixed(1)}" stroke="${col}" stroke-width="2" opacity="0.25" pointer-events="none"/>`;
  }
  s += `<text x="${CX}" y="${CY+118}" text-anchor="middle" fill="#E8A020" font-size="13" font-family="monospace" font-weight="700" letter-spacing="2" pointer-events="none">${(body.name||'').toUpperCase()}</text>`;
  return s;
}

// ── Belt disc — dense procedural rock field, no sphere ──
function discBelt(body, CX, CY, col){
  let s = '';
  const rnd = discRng(body.id);
  const count = Math.max(120, Math.min(600, body.beltDensity || 280));
  // A broad tilted band across the view
  for(let i=0;i<count;i++){
    const ang = rnd()*Math.PI*2;
    const rad = 60 + rnd()*230;
    const x = CX + Math.cos(ang)*rad;
    const y = CY + Math.sin(ang)*rad*0.42; // flatten into a belt
    const r = 0.7 + rnd()*2.6;
    const op = 0.25 + rnd()*0.6;
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${col}" opacity="${op.toFixed(2)}" pointer-events="none"/>`;
  }
  // A few larger “named rock” candidates (Phase 2 turns these into locations)
  for(let i=0;i<5;i++){
    const ang = rnd()*Math.PI*2, rad = 90 + rnd()*180;
    const x = CX + Math.cos(ang)*rad, y = CY + Math.sin(ang)*rad*0.42;
    const r = 6 + rnd()*7;
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${col}"/>`;
    s += `<circle cx="${(x-r*0.3).toFixed(1)}" cy="${(y-r*0.3).toFixed(1)}" r="${(r*0.6).toFixed(1)}" fill="#ffffff" opacity="0.07"/>`;
  }
  s += `<text x="${CX}" y="${CY+150}" text-anchor="middle" fill="${body.hook?'#E8A020':'#8b91a8'}" font-size="13" font-family="monospace" font-weight="700" letter-spacing="2" pointer-events="none">${(body.name||'').toUpperCase()}</text>`;
  return s;
}

// ── View build + navigation ─────────────────────────────────────────────────
function buildBodyView(id){
  const body = getBodies().find(b => b.id === id);
  if(!body){ goSystem(); return; }
  selectedBody = id;
  selectedBodyLoc = null;

  const svg = document.getElementById('body-disc-svg');
  if(svg){
    const PR = bodyDiscPR(body);
    svg.innerHTML = renderBodyDisc(body) + renderElevators(body, 400, 300, PR)
      + renderMoonNodes(body, 400, 300, PR) + renderLocationNodes(body, 400, 300, PR);
    wireLocationNodes(svg);
    wireMoonNodes(svg);
    attachDiscTapHandler(svg);
  }

  const nm = document.getElementById('bv-dname');
  if(nm){ nm.textContent = body.name.toUpperCase(); nm.style.color = body.color; }
  const dt = document.getElementById('bv-dtype');
  if(dt) dt.textContent = (body.type||'').toUpperCase();

  const pm = pmCheck.checked;
  let html = '';
  html += renderBodyContentSections(body, pm);

  // Locations on/around this body (surface sites, stations, bases).
  html += renderLocationsSection(body, pm);

  // Design-mode body controls, same as the orrery detail panel
  if(designModeOn && isReferee()){
    const added = isAddedBody(body.id);
    html += `<div class="s-sec ref-only" style="border-top:.5px dashed var(--bd0);margin-top:14px;padding-top:12px">
      <div class="s-sec-lbl" style="color:#9B59B6">Design — This Body</div>
      <button class="design-add-btn" style="width:100%;margin-bottom:6px" onclick="openBodyEditor('${body.id}')">✦ Edit Body Properties</button>
      <button class="design-add-btn" style="width:100%;border-color:#d45050;color:#d45050" onclick="deleteBody('${body.id}')">🗑 ${added?'Delete This Body':'Remove This Body'}</button>
    </div>`;
  }

  const db = document.getElementById('bv-db');
  if(db) db.innerHTML = html;

  setBreadcrumb([{label:"The Orion Arm",fn:"goGalaxy"},{label:currentSystemName(),fn:"goSystem"}], body.name);
  document.getElementById('hdr-title').textContent = (body.name||'').toUpperCase();
}

function goBodyView(id){
  playViewTransition(() => {
    currentView = "body";
    document.getElementById("view-galaxy").classList.add("v-hidden");
    document.getElementById("view-system").classList.add("v-hidden");
    document.getElementById("view-station").classList.add("v-hidden");
    document.getElementById("view-body").classList.remove("v-hidden");
    document.getElementById("view-body").style.display = "flex";
    buildBodyView(id);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// LOCATION LAYER — render, tap-to-place, CRUD, detail   (Phase 2)
// ═══════════════════════════════════════════════════════════════════════════

let selectedBodyLoc = null;     // currently inspected location id (body view)
let placingLocation = null;     // {bodyId, repositionId?} while in tap-to-place mode

// Disc radius for a body — MUST match the radii used in renderBodyDisc so
// location placement and the visual agree. Star/belt have no real surface, so a
// notional radius is used and their locations are always orbital.
function bodyDiscPR(body){
  const style = bodyDiscStyle(body);
  if(style === 'star') return 78;
  if(style === 'belt') return 70;
  if(style === 'moon') return 80;
  if(style === 'gasgiant') return 122;
  return 110;
}
function bodyHasSurface(body){
  const style = bodyDiscStyle(body);
  return style !== 'star' && style !== 'belt';
}

// ── Render location nodes onto the disc (appended after renderBodyDisc) ──
function renderLocationNodes(body, CX, CY, PR){
  const locs = effectiveLocations(currentSystemId, body.id);
  if(!locs.length) return '';
  const showLocks = !isReferee();
  let s = '';
  locs.forEach(loc => {
    const nx = Math.round(CX + (loc.sx||0) * PR);
    const ny = Math.round(CY + (loc.sy||0) * PR);
    const isSelected = selectedBodyLoc === loc.id;
    const isLocked = showLocks && !isRevealed(loc.id);
    const col = loc.color || '#4A90D9';

    if(loc.isStation){
      // ── Orbital station icon — generic: any location with isStation gets the
      // mini space-station glyph (hub + cross arms + solar panels + antenna),
      // ported from the retired bespoke Aurelia renderer. ──
      const sel = isSelected;
      const sc = sel ? 1.4 : 1.0;
      const ang0 = Math.atan2((loc.sy||0), (loc.sx||0));
      const ex0 = CX + Math.cos(ang0) * (PR + 4);
      const ey0 = CY + Math.sin(ang0) * (PR + 4);
      s += `<line x1="${ex0.toFixed(1)}" y1="${ey0.toFixed(1)}" x2="${nx}" y2="${ny}" stroke="${col}" stroke-width="0.6" stroke-dasharray="3,5" opacity="0.35" pointer-events="none"/>`;
      s += `<g data-loc="${loc.id}" class="loc-node loc-station-icon" style="cursor:pointer" transform="translate(${nx},${ny}) scale(${sc})">`;
      if(sel){
        s += `<circle cx="0" cy="0" r="22" fill="${col}" opacity="0.12" pointer-events="none"/>`;
        s += `<circle cx="0" cy="0" r="16" fill="${col}" opacity="0.18" pointer-events="none"/>`;
      }
      s += `<circle cx="0" cy="0" r="13" fill="none" stroke="${col}" stroke-width="1" opacity="${sel?0.6:0.35}" pointer-events="none"/>`;
      s += `<circle cx="0" cy="0" r="5" fill="${sel?col+'88':'#0d1828'}" stroke="${col}" stroke-width="1.2" pointer-events="all"/>`;
      s += `<line x1="-13" y1="0" x2="13" y2="0" stroke="${col}" stroke-width="1.2" opacity="${sel?0.9:0.7}" pointer-events="none"/>`;
      s += `<line x1="0" y1="-13" x2="0" y2="13" stroke="${col}" stroke-width="1.2" opacity="${sel?0.9:0.7}" pointer-events="none"/>`;
      s += `<rect x="-18" y="-4" width="5" height="8" rx="1" fill="${col}" opacity="${sel?0.85:0.55}" pointer-events="none"/>`;
      s += `<rect x="-24" y="-4" width="5" height="8" rx="1" fill="${col}" opacity="${sel?0.75:0.45}" pointer-events="none"/>`;
      s += `<rect x="13" y="-4" width="5" height="8" rx="1" fill="${col}" opacity="${sel?0.85:0.55}" pointer-events="none"/>`;
      s += `<rect x="19" y="-4" width="5" height="8" rx="1" fill="${col}" opacity="${sel?0.75:0.45}" pointer-events="none"/>`;
      s += `<rect x="-1.5" y="7" width="3" height="7" fill="${col}" opacity="${sel?0.8:0.5}" pointer-events="none"/>`;
      s += `<rect x="-4" y="13" width="8" height="2.5" rx="1" fill="${col}" opacity="${sel?0.7:0.4}" pointer-events="none"/>`;
      s += `<line x1="0" y1="-14" x2="0" y2="-19" stroke="${col}" stroke-width="0.8" opacity="0.6" pointer-events="none"/>`;
      s += `<circle cx="0" cy="-20" r="1.2" fill="${col}" opacity="0.7" pointer-events="none"/>`;
      s += `</g>`;
      if(loc.hook) s += `<text x="${nx+20}" y="${ny-14}" fill="#E8A020" font-size="11" font-weight="700" pointer-events="none">!</text>`;
      const nameColor = loc.hook ? '#E8A020' : col;
      s += `<text x="${nx+28}" y="${ny+4}" text-anchor="start" fill="${nameColor}" font-size="9" font-family="monospace" font-weight="${isSelected?'700':'400'}" pointer-events="none">${escHtml(loc.name)}</text>`;
    } else if(loc.surface){
      const r = 7;
      if(isSelected){
        s += `<circle cx="${nx}" cy="${ny}" r="${r+8}" fill="${col}" opacity="0.15" pointer-events="none"/>`;
        s += `<circle cx="${nx}" cy="${ny}" r="${r+4}" fill="${col}" opacity="0.2" pointer-events="none"/>`;
      }
      s += `<circle cx="${nx}" cy="${ny}" r="${r}" fill="${isSelected ? col+'55' : '#0d1828dd'}" stroke="${col}" stroke-width="${isSelected?2:1.3}" data-loc="${loc.id}" class="loc-node" style="cursor:pointer"/>`;
      s += `<circle cx="${nx}" cy="${ny}" r="${isSelected?3:1.6}" fill="${col}" opacity="${isSelected?0.95:0.7}" pointer-events="none"/>`;
      if(loc.hook) s += `<text x="${nx+r+1}" y="${ny-r}" fill="#E8A020" font-size="10" font-weight="700" pointer-events="none">!</text>`;
      const labelDist = r + 4;
      let lx, anchor;
      if((loc.sx||0) >= 0){ lx = nx + labelDist; anchor = 'start'; } else { lx = nx - labelDist; anchor = 'end'; }
      const ly = ny + ((loc.sy||0) < -0.3 ? -2 : (loc.sy||0) > 0.3 ? 12 : 4);
      const nameColor = loc.hook ? '#E8A020' : col;
      s += `<text x="${lx}" y="${ly}" text-anchor="${anchor}" fill="#05070a" font-size="9" font-family="monospace" font-weight="700" pointer-events="none" opacity="0.6" stroke="#05070a" stroke-width="3">${escHtml(loc.name)}</text>`;
      s += `<text x="${lx}" y="${ly}" text-anchor="${anchor}" fill="${nameColor}" font-size="9" font-family="monospace" font-weight="${isSelected?'700':'400'}" pointer-events="none">${escHtml(loc.name)}</text>`;
    } else {
      // Orbital node — spoke line from disc edge to the node
      const ang = Math.atan2((loc.sy||0), (loc.sx||0));
      const ex = CX + Math.cos(ang) * (PR + 4);
      const ey = CY + Math.sin(ang) * (PR + 4);
      s += `<line x1="${ex.toFixed(1)}" y1="${ey.toFixed(1)}" x2="${nx}" y2="${ny}" stroke="${col}" stroke-width="0.6" stroke-dasharray="3,5" opacity="0.35" pointer-events="none"/>`;
      const r = 9;
      if(isSelected){
        s += `<circle cx="${nx}" cy="${ny}" r="${r+10}" fill="${col}" opacity="0.12" pointer-events="none"/>`;
        s += `<circle cx="${nx}" cy="${ny}" r="${r+5}" fill="${col}" opacity="0.18" pointer-events="none"/>`;
      }
      s += `<circle cx="${nx}" cy="${ny}" r="${r}" fill="${isSelected ? col+'44' : '#0d1828'}" stroke="${col}" stroke-width="${isSelected?2:1.2}" data-loc="${loc.id}" class="loc-node" style="cursor:pointer"/>`;
      s += `<circle cx="${nx}" cy="${ny}" r="${isSelected?4:2}" fill="${col}" opacity="${isSelected?0.9:0.6}" pointer-events="none"/>`;
      if(loc.hook) s += `<text x="${nx+r+2}" y="${ny-r+1}" fill="#E8A020" font-size="11" font-weight="700" pointer-events="none">!</text>`;
      const labelDist = r + 5; let lx, ly, anchor;
      const cosA = Math.cos(ang), sinA = Math.sin(ang);
      if(Math.abs(cosA) > 0.3){ lx = nx + (cosA>0?labelDist:-labelDist); ly = ny + (Math.abs(sinA)>0.6?(sinA>0?12:-4):4); anchor = cosA>0?'start':'end'; }
      else { lx = nx; ly = ny + (sinA>0?r+13:-(r+4)); anchor = 'middle'; }
      const nameColor = loc.hook ? '#E8A020' : col;
      s += `<text x="${lx}" y="${ly}" text-anchor="${anchor}" fill="${nameColor}" font-size="9" font-family="monospace" font-weight="${isSelected?'700':'400'}" pointer-events="none">${escHtml(loc.name)}</text>`;
    }

    if(isLocked){
      const bx = loc.isStation ? nx+13 : loc.surface ? nx+6 : nx+9;
      const by = loc.isStation ? ny-13 : loc.surface ? ny-6 : ny-9;
      s += `<circle cx="${bx}" cy="${by}" r="7" fill="#0a0c12" stroke="#555570" stroke-width="1" pointer-events="none"/>`;
      s += `<text x="${bx}" y="${by+3}" text-anchor="middle" font-size="8" pointer-events="none">🔒</text>`;
    }
  });
  return s;
}

// Wire location-node clicks (called after svg.innerHTML is set in buildBodyView)
function wireLocationNodes(svg){
  if(!svg) return;
  svg.querySelectorAll('.loc-node').forEach(el => {
    el.addEventListener('click', () => selectBodyLocation(el.getAttribute('data-loc')));
    el.addEventListener('touchend', e => { e.preventDefault(); selectBodyLocation(el.getAttribute('data-loc')); });
  });
}

// ── Space elevators (data-driven) ──────────────────────────────────────────
// Any location with elevatorTo:'<otherLocId>' draws an animated shaft between
// its node and the target's node — the same flourish Aurelia's Station↔Capitol
// elevator used, now generic so any world can have one. Drawn beneath the nodes.
function renderElevators(body, CX, CY, PR){
  const locs = effectiveLocations(currentSystemId, body.id);
  let s = '';
  locs.forEach(loc => {
    if(!loc.elevatorTo) return;
    const target = locs.find(l => l.id === loc.elevatorTo);
    if(!target) return;
    const sx = CX + (loc.sx||0) * PR, sy = CY + (loc.sy||0) * PR;
    const cx2 = CX + (target.sx||0) * PR, cy2 = CY + (target.sy||0) * PR;
    s += `<line x1="${sx}" y1="${sy}" x2="${cx2}" y2="${cy2}" stroke="#4A90D9" stroke-width="5" opacity="0.10" pointer-events="none"/>`;
    s += `<line x1="${sx}" y1="${sy}" x2="${cx2}" y2="${cy2}" stroke="#7AB8E8" stroke-width="1.5" opacity="0.55" pointer-events="none"/>`;
    const steps = 7;
    for(let i = 1; i < steps; i++){
      const t = i / steps;
      const tx = sx + (cx2 - sx) * t, ty = sy + (cy2 - sy) * t;
      s += `<line x1="${tx-3}" y1="${ty}" x2="${tx+3}" y2="${ty}" stroke="#7AB8E8" stroke-width="1" opacity="0.4" pointer-events="none"/>`;
    }
    const carDefs = [
      { dur: 7.5, delay: 0,   reverse: false },
      { dur: 8.2, delay: 3.0, reverse: false },
      { dur: 7.0, delay: 1.5, reverse: true  }
    ];
    carDefs.forEach(({dur, delay, reverse}) => {
      const keyPoints = reverse ? '1;0' : '0;1';
      s += `<circle r="2.2" fill="#E8A020"><animateMotion dur="${dur}s" repeatCount="indefinite" keyPoints="${keyPoints}" keyTimes="0;1" path="M ${sx} ${sy} L ${cx2} ${cy2}" begin="-${delay}s"/></circle>`;
    });
    const midX = (sx + cx2) / 2, midY = (sy + cy2) / 2;
    s += `<text x="${midX+8}" y="${midY+3}" fill="#7AB8E8" font-size="7" font-family="monospace" opacity="0.6" pointer-events="none">elevator</text>`;
  });
  return s;
}

// ── Moon nodes (data-driven) ────────────────────────────────────────────────
// A body's moons appear in its close-up as orbital glyphs that navigate to the
// moon's own close-up (goBodyView). Generic: any parent's moons behave the same,
// so Pallor is no longer a hand-placed special case. The flattened orbit at
// PR+120 / ·0.31 reproduces the bespoke Pallor orbit for a PR=110 planet.
function renderMoonNodes(body, CX, CY, PR){
  const moons = getBodies().filter(b => b.isMoon && b.parentId === body.id);
  if(!moons.length) return '';
  let s = '';
  const A = PR + 120, B = (PR + 120) * 0.31;
  moons.forEach((moon, i) => {
    const ang = (210 + i * 70) * Math.PI / 180;
    const mx = Math.round(CX + Math.cos(ang) * A);
    const my = Math.round(CY + Math.sin(ang) * B);
    const mcol = moon.color || '#B0B0B0';
    if(i === 0){
      s += `<ellipse cx="${CX}" cy="${CY}" rx="${A}" ry="${B.toFixed(1)}" fill="none" stroke="#444466" stroke-width="0.8" stroke-dasharray="5,6" opacity="0.30" pointer-events="none"/>`;
    }
    s += `<defs><radialGradient id="moon-grad-${moon.id}" cx="35%" cy="30%" r="70%"><stop offset="0%" stop-color="#d0d0d0"/><stop offset="60%" stop-color="${mcol}"/><stop offset="100%" stop-color="#6a6a72"/></radialGradient></defs>`;
    s += `<circle cx="${mx}" cy="${my}" r="18" fill="${mcol}" opacity="0.12" pointer-events="none"/>`;
    s += `<circle cx="${mx}" cy="${my}" r="14" fill="url(#moon-grad-${moon.id})" data-moon="${moon.id}" class="moon-node" style="cursor:pointer"/>`;
    s += `<circle cx="${mx-4}" cy="${my-3}" r="3" fill="none" stroke="#888890" stroke-width="0.8" opacity="0.5" pointer-events="none"/>`;
    s += `<circle cx="${mx+5}" cy="${my+4}" r="2" fill="none" stroke="#888890" stroke-width="0.6" opacity="0.4" pointer-events="none"/>`;
    s += `<ellipse cx="${mx+5}" cy="${my}" rx="8" ry="14" fill="#000820" opacity="0.38" pointer-events="none"/>`;
    s += `<text x="${mx}" y="${my+28}" text-anchor="middle" fill="#B0B0B0" font-size="8" font-family="monospace" pointer-events="none">${escHtml(moon.name)}</text>`;
    s += `<text x="${mx}" y="${my+38}" text-anchor="middle" fill="#555570" font-size="7" font-family="monospace" pointer-events="none">moon</text>`;
  });
  return s;
}
function wireMoonNodes(svg){
  if(!svg) return;
  svg.querySelectorAll('.moon-node').forEach(el => {
    el.addEventListener('click', () => goBodyView(el.getAttribute('data-moon')));
    el.addEventListener('touchend', e => { e.preventDefault(); goBodyView(el.getAttribute('data-moon')); });
  });
}

// ── Locations section in the body-view detail panel ──
function renderLocationsSection(body, pm){
  const locs = effectiveLocations(currentSystemId, body.id);
  let html = `<div class="s-sec ref-only" style="border-top:.5px dashed var(--bd0);margin-top:14px;padding-top:12px">
    <div class="s-sec-lbl" style="color:var(--tx1)">Locations</div>`;
  // Players see only revealed locations; referees see all.
  const visible = locs.filter(l => isReferee() || isRevealed(l.id));
  if(!visible.length){
    html += `<div style="font-size:11px;color:var(--tx1);line-height:1.5">${isReferee() ? 'No locations yet. Add surface sites, stations, or bases below.' : 'No locations available here.'}</div>`;
  } else {
    visible.forEach(l => {
      const rev = isRevealed(l.id);
      const lockDot = (isReferee() && !rev) ? '<span title="Hidden from players" style="color:#d45050">●</span> ' : '';
      html += `<div class="loc-list-row" onclick="selectBodyLocation('${l.id}')">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${l.color||'#4A90D9'};margin-right:7px;vertical-align:middle"></span>
        <span style="color:${l.hook?'#E8A020':'var(--tx0)'};font-size:12px;font-weight:${l.hook?'700':'400'}">${lockDot}${escHtml(l.name)}</span>
        <span style="font-size:9px;color:var(--tx1);font-family:monospace;margin-left:6px">${l.surface?'surface':'orbital'}</span>
      </div>`;
    });
  }
  if(designModeOn && isReferee()){
    html += `<button class="design-add-btn" style="width:100%;margin-top:8px" onclick="beginPlaceLocation('${body.id}')">+ Add Location</button>`;
  }
  html += `</div>`;
  return html;
}

// ── Tap-to-place ──
function beginPlaceLocation(bodyId, repositionId){
  if(!isReferee() || !designModeOn) return;
  placingLocation = { bodyId, repositionId: repositionId || null };
  const panel = document.getElementById('body-view-panel');
  if(panel){
    let hint = document.getElementById('place-loc-hint');
    if(!hint){
      hint = document.createElement('div');
      hint.id = 'place-loc-hint';
      panel.appendChild(hint);
    }
    const body = getBodies().find(b => b.id === bodyId);
    const surf = body && bodyHasSurface(body);
    hint.innerHTML = `<div class="place-hint-inner">📍 Tap ${surf ? 'the surface for a ground site, or out in orbit for a station' : 'anywhere in the field to place'} — <button onclick="cancelPlaceLocation()">cancel</button></div>`;
    hint.style.display = 'flex';
  }
  // Add a capture overlay on the svg
  const svg = document.getElementById('body-disc-svg');
  if(svg) svg.style.cursor = 'crosshair';
}
function cancelPlaceLocation(){
  placingLocation = null;
  const hint = document.getElementById('place-loc-hint');
  if(hint) hint.style.display = 'none';
  const svg = document.getElementById('body-disc-svg');
  if(svg) svg.style.cursor = '';
}
// Convert a pointer event on the disc SVG into sx/sy (PR units) and act on it.
function handleDiscTap(evt){
  if(!placingLocation) return;
  const svg = document.getElementById('body-disc-svg');
  const body = getBodies().find(b => b.id === placingLocation.bodyId);
  if(!svg || !body) { cancelPlaceLocation(); return; }
  const pt = svg.createSVGPoint();
  const touch = (evt.changedTouches && evt.changedTouches[0]) || evt;
  pt.x = touch.clientX; pt.y = touch.clientY;
  const ctm = svg.getScreenCTM();
  if(!ctm) { cancelPlaceLocation(); return; }
  const p = pt.matrixTransform(ctm.inverse());
  const CX = 400, CY = 300, PR = bodyDiscPR(body);
  let sx = (p.x - CX) / PR, sy = (p.y - CY) / PR;
  // Clamp to a sane field so a wild tap doesn't fly off-canvas
  const d = Math.sqrt(sx*sx + sy*sy);
  const MAXD = 2.4;
  if(d > MAXD){ sx = sx/d*MAXD; sy = sy/d*MAXD; }
  const surface = bodyHasSurface(body) && d <= 1.0;
  const repositionId = placingLocation.repositionId;
  cancelPlaceLocation();
  if(repositionId){
    const found = findLocation(repositionId);
    if(found){
      // writeLocationFields updates the in-memory store synchronously before its
      // async save, so the immediate rebuild already reflects the new position.
      writeLocationFields(repositionId, found.bodyId, { sx:+sx.toFixed(3), sy:+sy.toFixed(3), surface });
      buildBodyView(body.id); selectBodyLocation(repositionId); showToast('Location moved');
    }
  } else {
    openLocationCreator(body.id, { sx:+sx.toFixed(3), sy:+sy.toFixed(3), surface });
  }
}

// ── Location Creator modal (reuses #body-creator-* styling) ──
let locCreatorDraft = null;
let locEditTargetId = null;
function openLocationCreator(bodyId, pos, editLoc){
  if(!isReferee() || !designModeOn) return;
  locCreatorDraft = editLoc ? Object.assign({}, editLoc) : Object.assign({ bodyId }, pos);
  locEditTargetId = editLoc ? editLoc.id : null;
  document.getElementById('loc-creator-title').textContent = editLoc ? '✦ Edit Location' : '✦ Add Location';
  document.getElementById('loc-creator-modal').classList.add('open');
  renderLocCreatorBody(bodyId);
}
function closeLocationCreator(){
  document.getElementById('loc-creator-modal').classList.remove('open');
  locEditTargetId = null; locCreatorDraft = null;
}
function renderLocCreatorBody(bodyId){
  const d = locCreatorDraft || {};
  const body = getBodies().find(b => b.id === (d.bodyId || bodyId));
  const posLabel = d.surface ? 'Surface site' : 'Orbital';
  const color = d.color || '#4A90D9';
  const TAGS = ['','ACTIVE LOCATION','HEGEMONY','CORPORATE','MILITARY','DEEP WATER','LANDMARK','UNDERDECK','CLASSIFIED','RESTRICTED','SETTLEMENT','STATION','MINE','RESEARCH'];
  document.getElementById('loc-creator-body').innerHTML = `
    <div class="npc-gen-hint">${escHtml(body?body.name:'')} · <b style="color:var(--tx0)">${posLabel}</b>
      <button class="design-add-btn" style="margin-left:8px;padding:2px 8px" onclick="repositionFromCreator()">Move pin</button></div>
    <div class="npc-form-row"><label class="npc-form-lbl">Name</label>
      <input type="text" class="npc-form-input" id="loc-f-name" value="${escAttr(d.name)}" placeholder="e.g. Cairn Station"></div>
    <div class="npc-form-row"><label class="npc-form-lbl">Type / subtitle</label>
      <input type="text" class="npc-form-input" id="loc-f-type" value="${escAttr(d.type)}" placeholder="e.g. Mining outpost"></div>
    <div class="body-uwp-grid">
      <div class="npc-form-row"><label class="npc-form-lbl">Colour</label>
        <div class="body-color-row"><input type="color" id="loc-f-color" value="${/^#[0-9a-fA-F]{6}$/.test(color)?color:'#4A90D9'}"><input type="text" class="npc-form-input" id="loc-f-colorhex" value="${escAttr(color)}" oninput="syncLocColorHex()" style="font-family:monospace"></div></div>
      <div class="npc-form-row"><label class="npc-form-lbl">Tag</label>
        <select class="body-select" id="loc-f-tag">${TAGS.map(t=>`<option value="${t}"${t===(d.tag||'')?' selected':''}>${t||'(none)'}</option>`).join('')}</select></div>
    </div>
    <div class="npc-form-row body-check-row">
      <input type="checkbox" id="loc-f-hook" ${d.hook?'checked':''}><label for="loc-f-hook" style="margin:0;cursor:pointer">Adventure hook (gold highlight + ! marker)</label>
    </div>
    <div class="npc-form-row"><label class="npc-form-lbl">Overview / description</label>
      <textarea class="npc-form-textarea" id="loc-f-desc" style="min-height:80px">${escHtml(d.desc)}</textarea></div>
    <div class="npc-form-row"><label class="npc-form-lbl">Referee note</label>
      <textarea class="npc-form-textarea" id="loc-f-refnote" style="min-height:50px">${escHtml(d.refNote)}</textarea></div>
    <div class="npc-form-row"><label class="npc-form-lbl">Read aloud</label>
      <textarea class="npc-form-textarea" id="loc-f-readaloud" style="min-height:50px">${escHtml(d.readAloud)}</textarea></div>
    <div class="npc-creator-footer">
      <button class="npc-creator-btn" onclick="closeLocationCreator()">Cancel</button>
      <button class="npc-creator-btn primary" onclick="saveLocationFromForm()">${locEditTargetId?'Save Changes':'Add Location'}</button>
    </div>`;
}
function syncLocColorHex(){
  const hex = (document.getElementById('loc-f-colorhex')||{}).value || '';
  if(/^#[0-9a-fA-F]{6}$/.test(hex)){ const c=document.getElementById('loc-f-color'); if(c) c.value = hex; }
}
// Re-enter tap-to-place from inside the creator (keeps the draft details)
function repositionFromCreator(){
  collectLocDraft();
  const bodyId = locCreatorDraft.bodyId;
  closeLocationCreatorKeepDraft();
  beginPlaceLocationForDraft(bodyId);
}
function closeLocationCreatorKeepDraft(){
  document.getElementById('loc-creator-modal').classList.remove('open');
}
function beginPlaceLocationForDraft(bodyId){
  placingLocation = { bodyId, draftReturn:true };
  const panel = document.getElementById('body-view-panel');
  if(panel){
    let hint = document.getElementById('place-loc-hint');
    if(!hint){ hint = document.createElement('div'); hint.id='place-loc-hint'; panel.appendChild(hint); }
    hint.innerHTML = `<div class="place-hint-inner">📍 Tap to move the pin — <button onclick="cancelPlaceLocation()">cancel</button></div>`;
    hint.style.display = 'flex';
  }
  const svg = document.getElementById('body-disc-svg');
  if(svg) svg.style.cursor = 'crosshair';
}
function collectLocDraft(){
  const g = id => (document.getElementById(id)||{}).value;
  if(!locCreatorDraft) locCreatorDraft = {};
  locCreatorDraft.name = (g('loc-f-name')||'').trim();
  locCreatorDraft.type = (g('loc-f-type')||'').trim();
  locCreatorDraft.color = (g('loc-f-colorhex')||'').trim() || '#4A90D9';
  locCreatorDraft.tag = g('loc-f-tag') || '';
  locCreatorDraft.hook = !!(document.getElementById('loc-f-hook')||{}).checked;
  locCreatorDraft.desc = g('loc-f-desc') || '';
  locCreatorDraft.refNote = (g('loc-f-refnote')||'').trim();
  locCreatorDraft.readAloud = (g('loc-f-readaloud')||'').trim();
}
async function saveLocationFromForm(){
  collectLocDraft();
  const d = locCreatorDraft;
  if(!d.name){ showToast('Location needs a name', 'error'); return; }
  if(locEditTargetId){
    await commitLocationEdit(locEditTargetId, d);
  } else {
    await commitNewLocation(d);
  }
  closeLocationCreator();
}

// ── Commit / edit / delete / restore ──
async function commitNewLocation(d){
  recordDesignUndo('Add location "' + (d.name||'') + '"');
  const bodyId = d.bodyId;
  const loc = {
    id: 'loc-add-' + Date.now() + '-' + Math.floor(Math.random()*1000),
    bodyId,
    name: d.name, type: d.type || '', color: d.color || '#4A90D9',
    tag: d.tag || '', hook: !!d.hook,
    surface: !!d.surface, sx: d.sx||0, sy: d.sy||0,
    desc: d.desc || '', refNote: d.refNote || null, readAloud: d.readAloud || null,
    interiorId: null
  };
  if(!locationAdditions[currentSystemId]) locationAdditions[currentSystemId] = {};
  if(!locationAdditions[currentSystemId][bodyId]) locationAdditions[currentSystemId][bodyId] = [];
  locationAdditions[currentSystemId][bodyId].push(loc);
  await saveLocationAdditions();
  buildBodyView(bodyId);
  showToast('Location "' + loc.name + '" added');
  selectBodyLocation(loc.id);
}
// Write a set of {field:value} onto a location, branching base vs added exactly
// like the body engine: an added location is edited in place; a base location
// stores only its changed fields as overrides (vs BASE_LOCATIONS) so the base
// data stays pristine and restorable. Mirrors commitBodyEdit.
async function writeLocationFields(locId, bodyId, fields){
  if(isAddedLocation(currentSystemId, locId)){
    const arr = (locationAdditions[currentSystemId] || {})[bodyId] || [];
    const loc = arr.find(l => l.id === locId);
    if(loc){ Object.assign(loc, fields); await saveLocationAdditions(); }
  } else {
    const base = baseLocationsFor(currentSystemId, bodyId).find(l => l.id === locId) || {};
    if(!locationPropertyOverrides[currentSystemId]) locationPropertyOverrides[currentSystemId] = {};
    const ov = Object.assign({}, locationPropertyOverrides[currentSystemId][locId] || {});
    const norm = v => (v === '' || v === undefined) ? null : v;
    Object.keys(fields).forEach(f => {
      if(norm(fields[f]) !== norm(base[f])) ov[f] = fields[f];
      else delete ov[f];
    });
    if(Object.keys(ov).length) locationPropertyOverrides[currentSystemId][locId] = ov;
    else delete locationPropertyOverrides[currentSystemId][locId];
    await saveLocationPropertyOverrides();
  }
}
async function commitLocationEdit(locId, d){
  const found = findLocation(locId);
  if(!found){ showToast('Location not found','error'); return; }
  recordDesignUndo('Edit location "' + (d.name||'') + '"');
  const fields = {
    name: d.name, type: d.type || '', color: d.color || '#4A90D9',
    tag: d.tag || '', hook: !!d.hook,
    desc: d.desc || '', refNote: d.refNote || null, readAloud: d.readAloud || null
  };
  if(d.sx!==undefined) fields.sx = d.sx;
  if(d.sy!==undefined) fields.sy = d.sy;
  if(d.surface!==undefined) fields.surface = d.surface;
  await writeLocationFields(locId, found.bodyId, fields);
  buildBodyView(found.bodyId);
  showToast('Location updated');
  selectBodyLocation(locId);
}
async function deleteLocation(locId){
  const found = findLocation(locId);
  if(!found) return;
  if(!confirm(`Remove "${found.loc.name}"? You can restore it from "Show Removed Items".`)) return;
  recordDesignUndo('Delete location "' + (found.loc.name||'') + '"');
  const bodyId = found.bodyId;
  if(!locationDeletions[currentSystemId]) locationDeletions[currentSystemId] = {};
  if(isAddedLocation(currentSystemId, locId)){
    const arr = locationAdditions[currentSystemId][bodyId];
    const idx = arr.findIndex(l => l.id === locId);
    if(idx >= 0){
      locationDeletions[currentSystemId][locId] = { loc: arr[idx], t: Date.now(), bodyId, wasAddition:true };
      arr.splice(idx, 1);
      await saveLocationAdditions();
    }
  } else {
    // Base location — tombstone only; effectiveLocations filters it out. The
    // base data and any property override survive for a clean restore.
    locationDeletions[currentSystemId][locId] = { loc: found.loc, t: Date.now(), bodyId, wasAddition:false };
  }
  await saveLocationDeletions();
  selectedBodyLoc = null;
  showToast('Location removed','info');
  buildBodyView(bodyId);
}
async function restoreDeletedLocation(sysId, locId){
  const entry = (locationDeletions[sysId] || {})[locId];
  if(!entry) return;
  const bodyId = entry.bodyId;
  if(entry.wasAddition){
    if(!locationAdditions[sysId]) locationAdditions[sysId] = {};
    if(!locationAdditions[sysId][bodyId]) locationAdditions[sysId][bodyId] = [];
    locationAdditions[sysId][bodyId].push(entry.loc);
    await saveLocationAdditions();
  }
  // Base locations need no re-add — clearing the tombstone makes effectiveLocations
  // surface them again (with their property override, if any, still applied).
  delete locationDeletions[sysId][locId];
  await saveLocationDeletions();
  if(currentView === 'body' && selectedBody === bodyId) buildBodyView(bodyId);
  if(typeof closeRemovedItemsPanel === 'function') closeRemovedItemsPanel();
  showToast('Location restored');
}

// ── Location detail (right panel) ──
function selectBodyLocation(locId){
  if(placingLocation) return; // a tap during placement is a pin drop, not a select
  const found = findLocation(locId);
  if(!found){ return; }
  const loc = found.loc;
  selectedBodyLoc = locId;
  const body = getBodies().find(b => b.id === found.bodyId);
  // Re-render disc so the selected node highlights
  const svg = document.getElementById('body-disc-svg');
  if(svg){ const PR = bodyDiscPR(body); svg.innerHTML = renderBodyDisc(body) + renderElevators(body, 400, 300, PR) + renderMoonNodes(body, 400, 300, PR) + renderLocationNodes(body, 400, 300, PR); wireLocationNodes(svg); wireMoonNodes(svg); attachDiscTapHandler(svg); }

  const pm = pmCheck.checked;
  const nm = document.getElementById('bv-dname');
  if(nm){ nm.textContent = loc.name.toUpperCase(); nm.style.color = loc.color || '#4A90D9'; }
  const dt = document.getElementById('bv-dtype');
  if(dt) dt.textContent = (loc.type || loc.tag || 'LOCATION').toUpperCase();

  let html = `<button class="design-add-btn" style="width:100%;margin-bottom:10px" onclick="buildBodyView('${found.bodyId}')">← Back to ${escHtml(body?body.name:'body')}</button>`;

  // Reveal gate for players
  if(pm && !isRevealed(locId)){
    html += `<div class="empty" style="height:160px"><div class="empty-icon">🔒</div>
      <div style="font-size:14px;font-weight:600;color:#e8eaf0">Not yet revealed</div>
      <div style="font-size:12px;max-width:220px;text-align:center;color:var(--tx1)">Your referee hasn't opened up this location yet.</div></div>`;
    const db = document.getElementById('bv-db'); if(db) db.innerHTML = html;
    setBreadcrumb([{label:"The Orion Arm",fn:"goGalaxy"},{label:currentSystemName(),fn:"goSystem"},{label:body?body.name:'',fn:"goBackToBodyFromLoc"}], loc.name);
    return;
  }

  if(!pm){ html += revealToggleRowHTML(locId); }

  // Interior entry (e.g. Aurelia Orbital Station). The Station sub-app itself is
  // unchanged for Phase 3 — only its entry point moved onto the generic view.
  if(loc.isStation || loc.interiorId){
    html += `<button class="view-close-btn" style="margin-bottom:10px" onclick="enterStation()">⬡ Enter ${escHtml(loc.name)}</button>`;
  }

  // Overview
  const dKey = 'loc-'+locId+'-desc';
  designOriginalRegistry[dKey] = loc.desc;
  const dText = resolveContent(dKey, loc.desc);
  html += `<div class="s-blk" style="background:var(--bg1);padding:10px;border-radius:5px;margin-bottom:10px">
    <div class="s-sec-lbl" style="font-size:9px;color:var(--tx1);font-family:monospace;letter-spacing:2px;text-transform:uppercase;margin-bottom:5px">OVERVIEW</div>
    <div class="s-desc" style="font-size:12px;line-height:1.65">${designWrap(dKey, loc.desc, (dText||'').split('\n').join('<br>'))}</div></div>`;

  if(!pm && loc.readAloud){
    const rKey = 'loc-'+locId+'-readAloud';
    designOriginalRegistry[rKey] = loc.readAloud;
    const rText = resolveContent(rKey, loc.readAloud);
    html += `<div class="s-blk read"><div class="s-blk-lbl">READ ALOUD</div>${designWrap(rKey, loc.readAloud, rText)}</div>`;
  }
  if(!pm && loc.refNote){
    const nKey = 'loc-'+locId+'-refNote';
    designOriginalRegistry[nKey] = loc.refNote;
    const nText = resolveContent(nKey, loc.refNote);
    html += `<div class="s-blk ref ref-only"><div class="s-blk-lbl">REFEREE NOTE</div>${designWrap(nKey, loc.refNote, (nText||'').split('\n').join('<br>'))}</div>`;
  }

  // Custom referee boxes (parity with the retired bespoke view) — keeps any
  // existing loc-<id>-box-* edits showing and gives every location custom boxes.
  html += renderBoxTypesHTML(bt => 'loc-'+locId+'-box-'+bt.key, null, pm, true);

  // Design-mode location controls
  if(designModeOn && isReferee()){
    html += `<div class="s-sec ref-only" style="border-top:.5px dashed var(--bd0);margin-top:14px;padding-top:12px">
      <div class="s-sec-lbl" style="color:#9B59B6">Design — This Location</div>
      <button class="design-add-btn" style="width:100%;margin-bottom:6px" onclick="openLocationEditor('${locId}')">✦ Edit Location</button>
      <button class="design-add-btn" style="width:100%;margin-bottom:6px" onclick="beginPlaceLocation('${found.bodyId}','${locId}')">📍 Reposition</button>
      <button class="design-add-btn" style="width:100%;border-color:#d45050;color:#d45050" onclick="deleteLocation('${locId}')">🗑 Delete Location</button>
    </div>`;
  }

  const db = document.getElementById('bv-db'); if(db) db.innerHTML = html;
  setBreadcrumb([{label:"The Orion Arm",fn:"goGalaxy"},{label:currentSystemName(),fn:"goSystem"},{label:body?body.name:'',fn:"goBackToBodyFromLoc"}], loc.name);
}
function goBackToBodyFromLoc(){
  if(selectedBody) buildBodyView(selectedBody);
  else goSystem();
}
function openLocationEditor(locId){
  const found = findLocation(locId);
  if(!found) return;
  openLocationCreator(found.bodyId, null, found.loc);
}

// Attach the tap-to-place handler to the disc svg (idempotent)
function attachDiscTapHandler(svg){
  if(!svg || svg._discTapWired) return;
  svg.addEventListener('click', handleDiscTap);
  svg.addEventListener('touchend', handleDiscTap);
  svg._discTapWired = true;
}

// ═══════════════════════════════════════════════════════════════════════════
// VIEW SWITCHING
// ═══════════════════════════════════════════════════════════════════════════
// Plays a brief warp-style transition, then runs the actual view switch
// at the midpoint (when the overlay is fully opaque) so the swap is hidden.
function playViewTransition(switchFn){
  const el = document.getElementById('view-transition');
  if(!el){ switchFn(); return; }
  el.classList.remove('active');
  // Force reflow so re-adding the class restarts the animation
  void el.offsetWidth;
  el.classList.add('active');
  setTimeout(switchFn, 175); // ~35% through the 500ms animation = full opacity
  setTimeout(() => el.classList.remove('active'), 520);
}

function enterStation(){
  playViewTransition(() => {
    currentView = "station";
    document.getElementById("view-galaxy").classList.add("v-hidden");
    document.getElementById("view-system").classList.add("v-hidden");
    document.getElementById("view-body").classList.add("v-hidden");
    document.getElementById("view-station").classList.remove("v-hidden");
    document.getElementById("view-station").style.display="flex";
    document.getElementById("hdr-title").textContent = "AURELIA ORBITAL STATION";
    setBreadcrumb([{label:"The Orion Arm",fn:"goGalaxy"},{label:currentSystemName(),fn:"goSystem"},{label:"Aurelia",fn:"goAurelia"}],"Orbital Station");
    updateStationLocks();
  });
}

function goSystem(){
  playViewTransition(() => {
    currentView = "system";
    document.getElementById("view-galaxy").classList.add("v-hidden");
    document.getElementById("view-station").classList.add("v-hidden");
    document.getElementById("view-body").classList.add("v-hidden");
    document.getElementById("view-system").classList.remove("v-hidden");
    document.getElementById("view-system").style.display="flex";
    document.getElementById("hdr-title").textContent = currentSystemName().toUpperCase()+" SYSTEM";
    if(selectedBody){
      const b=getBodies().find(x=>x.id===selectedBody);
      setBreadcrumb([{label:"The Orion Arm",fn:"goGalaxy"},{label:currentSystemName(),fn:"goSystem"}],b?b.name:"");
    } else {
      setBreadcrumb([{label:"The Orion Arm",fn:"goGalaxy"}], currentSystemName());
    }
    updateBackBtn();
  });
}

function setBreadcrumb(crumbs,current){
  const el=document.getElementById("breadcrumb");
  el.innerHTML=crumbs.map(c=>`<span class="bc-link" onclick="${c.fn}()">${c.label}</span><span class="bc-sep"> › </span>`).join("")
    +(current?`<span style="color:#8b91a8">${current}</span>`:"");
  updateBackBtn();
}

// Hierarchical back-arrow (kept alongside the breadcrumb). Steps one level up
// from the current view; hidden at the root (system view, no body selected).
function navBack(){
  if(currentView === 'galaxy'){ return; }                 // top of the stack
  if(currentView === 'station'){ goAurelia(); return; }
  if(currentView === 'body'){ goSystem(); return; }
  if(currentView === 'system' && selectedBody){ goSystemOverview(); return; }
  if(currentView === 'system'){ goGalaxy(); return; }      // system root → back to the galaxy
}
function updateBackBtn(){
  const btn = document.getElementById('back-btn');
  if(!btn) return;
  const atRoot = (currentView === 'galaxy'); // only the galaxy map is the true root now
  btn.classList.toggle('hidden', atRoot);
}


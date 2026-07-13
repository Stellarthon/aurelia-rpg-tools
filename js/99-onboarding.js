// ═══════════════════════════════════════════════════════════════════════════
// FIRST-TIME REFEREE WALKTHROUGH  (welcome panel + coached spotlight tour)
// ───────────────────────────────────────────────────────────────────────────
// Distinct from setup.html (which configures a *deployment*): this teaches a new
// referee how to USE the app, the first time they reach it after the access gate.
//
// Flow: a short welcome panel → an optional coached tour that spotlights each real
// header control one at a time (dimming the rest) with a tooltip and Back/Next/Skip.
//
// • Referees only (isReferee()); players never see it (the tour is gated on
//   isReferee at trigger time, and the ref-only controls it points at are hidden
//   for players anyway).
// • Auto-runs once, gated on localStorage.aurelia_ref_onboarded !== '1'.
// • Re-runnable any time from Referee tools ▸ Take the tour (startRefereeWelcome()).
// • Fully self-contained: one IIFE, no inline handlers, all styles scoped under the
//   `arw-` prefix, so it can't collide with the app's global scope or CSS.
// ═══════════════════════════════════════════════════════════════════════════
(function(){
  "use strict";

  const DONE_KEY = 'aurelia_ref_onboarded';
  const Z = 2147483000; // above every app panel/menu
  function ls(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
  function markDone(){ try { localStorage.setItem(DONE_KEY, '1'); } catch(e){} }

  // ── Scoped styles (arw- prefix; palette mirrors setup.html for continuity) ──
  const CSS = `
  #arw-root{position:fixed;inset:0;z-index:${Z};font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
  #arw-catch{position:fixed;inset:0;z-index:${Z};background:transparent}
  #arw-back{position:fixed;inset:0;z-index:${Z};background:rgba(8,10,16,.72);
    display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(2px)}
  #arw-spot{position:fixed;z-index:${Z + 1};border-radius:10px;pointer-events:none;
    box-shadow:0 0 0 3px #D4A843, 0 0 0 9999px rgba(8,10,16,.72);
    transition:left .28s cubic-bezier(.4,0,.2,1),top .28s cubic-bezier(.4,0,.2,1),width .28s cubic-bezier(.4,0,.2,1),height .28s cubic-bezier(.4,0,.2,1)}
  .arw-tip,.arw-welcome{background:linear-gradient(180deg,#181c27,#141824);border:.5px solid #2e3347;
    border-radius:10px;box-shadow:0 24px 60px -24px #000;color:#e8eaf0}
  .arw-tip{position:fixed;z-index:${Z + 2};width:min(340px,calc(100vw - 24px));padding:16px 16px 13px}
  .arw-welcome{position:relative;z-index:${Z + 2};width:min(520px,100%);padding:26px 26px 22px;text-align:left}
  .arw-kick{font-family:ui-monospace,Menlo,Consolas,monospace;letter-spacing:.28em;font-size:10px;
    color:#D4A843;text-transform:uppercase}
  .arw-h{margin:8px 0 8px;font-size:22px;font-weight:650}
  .arw-tip .arw-h{font-size:15px;margin:0 0 6px;color:#D4A843}
  .arw-p{margin:0;color:#c9cee0;font-size:13px;line-height:1.55}
  .arw-tip .arw-p{font-size:12.5px;color:#c2c8db}
  .arw-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px 16px;margin:16px 0 4px;font-size:12px}
  .arw-grid .k{color:#D4A843;white-space:nowrap}
  .arw-grid .v{color:#a3a9bf}
  .arw-count{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10.5px;color:#7f869c;margin-bottom:7px}
  .arw-nav{display:flex;align-items:center;gap:8px;margin-top:14px}
  .arw-nav .sp{flex:1}
  .arw-btn{appearance:none;border:.5px solid #2e3347;background:#1e2333;color:#e8eaf0;font:inherit;
    font-size:12.5px;font-weight:600;padding:8px 14px;border-radius:7px;cursor:pointer;transition:.15s}
  .arw-btn:hover{border-color:#5b627a}
  .arw-btn.primary{background:#D4A843;border-color:#D4A843;color:#1a120a}
  .arw-btn.primary:hover{filter:brightness(1.08)}
  .arw-btn.ghost{background:transparent;color:#a3a9bf}
  .arw-btn.sm{padding:6px 11px;font-size:11.5px}
  .arw-btn:disabled{opacity:.4;cursor:default}
  .arw-x{position:absolute;top:12px;right:14px;background:none;border:none;color:#7f869c;font-size:20px;
    line-height:1;cursor:pointer}
  .arw-x:hover{color:#e8eaf0}
  @media(max-width:520px){ .arw-grid{grid-template-columns:1fr} }
  `;
  function injectCss(){
    if(document.getElementById('arw-style')) return;
    const s = document.createElement('style'); s.id = 'arw-style'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ── Tour stops. sel = comma-list of candidate targets (first visible wins);
  //    sel:null = a centered card with no spotlight. ──────────────────────────
  function tourSteps(){
    return [
      { sel:'#breadcrumb,#hdr-title,#hdr-locus', title:'Where you are',
        body:'Your place in the world. Drill in galaxy → system → station → deck plans; this trail always takes you back out.' },
      { sel:'#impdate-wrap,#clock-wrap,#impdate-display', title:'Time & the Imperial date',
        body:'Advance the clock and campaign date as play unfolds — every player’s screen updates live.' },
      { sel:'#search-wrap,#search-input', title:'Find anything',
        body:'Jump straight to any system, NPC, area, or rules check by name.' },
      { sel:'#referee-menu-btn', title:'Referee tools 🛡',
        body:'Display options, campaign backup, and Campaign Setup — edit your backend, access codes and player invites — live here. Design Mode, to edit the world itself, is one tap in.' },
      { sel:'#combat-btn,#ship-btn', title:'Run the session ⚔',
        body:'Space combat by the Traveller 2e rules, plus ship status, party funds, cargo and the mission log along this row.' },
      { sel:'#more-btn', title:'More tools ⋯',
        body:'Library data, the wiki, contacts, downtime, the living economy, and the session planner.' },
      { sel:'#settings-btn', title:'Settings ⚙',
        body:'Themes, keyboard shortcuts, and per-device display options.' },
      { sel:null, title:'Invite your players',
        body:'Open Campaign Setup (in 🛡 Referee tools) to hand each player a personal invite link — they join and see only what’s theirs. That’s it — you’re ready to run. Reopen this any time from Referee tools ▸ Take the tour.' },
    ];
  }

  // ── State + helpers ─────────────────────────────────────────────────────────
  let root = null, steps = [], idx = 0, onKey = null, onResize = null;

  function isVisible(el){
    if(!el) return false;
    const cs = getComputedStyle(el);
    if(cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return false;
    if(el.offsetParent === null && cs.position !== 'fixed') return false;
    const r = el.getBoundingClientRect();
    if(r.width <= 0 || r.height <= 0) return false;
    if(r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
    return true;
  }
  function firstVisible(sel){
    if(!sel) return null;
    const els = document.querySelectorAll(sel);
    for(let i = 0; i < els.length; i++){ if(isVisible(els[i])) return els[i]; }
    return null;
  }

  function teardown(){
    if(onKey){ document.removeEventListener('keydown', onKey, true); onKey = null; }
    if(onResize){ removeEventListener('resize', onResize); removeEventListener('orientationchange', onResize); onResize = null; }
    if(root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
  }
  function finish(){ markDone(); teardown(); }

  // ── The coached spotlight tour ──────────────────────────────────────────────
  function place(){
    const step = steps[idx];
    const tip = root.querySelector('.arw-tip');
    const spot = root.querySelector('#arw-spot');
    const target = step.sel ? firstVisible(step.sel) : null;
    tip.style.visibility = 'hidden';
    tip.style.left = '0px'; tip.style.top = '0px';
    const tw = tip.offsetWidth, th = tip.offsetHeight, vw = innerWidth, vh = innerHeight, gap = 14;
    if(target){
      const r = target.getBoundingClientRect(), pad = 6;
      spot.style.display = 'block';
      spot.style.left = (r.left - pad) + 'px';
      spot.style.top = (r.top - pad) + 'px';
      spot.style.width = (r.width + pad * 2) + 'px';
      spot.style.height = (r.height + pad * 2) + 'px';
      let top = r.bottom + gap;
      if(top + th > vh - 8) top = r.top - gap - th;            // flip above if no room below
      top = Math.max(8, Math.min(top, vh - th - 8));
      let left = r.left + r.width / 2 - tw / 2;                 // centre under the target
      left = Math.max(8, Math.min(left, vw - tw - 8));
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
    } else {
      spot.style.display = 'none';
      tip.style.left = Math.max(8, (vw - tw) / 2) + 'px';
      tip.style.top = Math.max(8, (vh - th) / 2) + 'px';
    }
    tip.style.visibility = 'visible';
  }

  function renderStep(){
    const step = steps[idx], last = idx === steps.length - 1;
    root.querySelector('.arw-tip').innerHTML =
      `<div class="arw-count">Step ${idx + 1} of ${steps.length}</div>
       <div class="arw-h">${step.title}</div>
       <p class="arw-p">${step.body}</p>
       <div class="arw-nav">
         <button class="arw-btn ghost sm" data-arw="skip">Skip</button>
         <div class="sp"></div>
         <button class="arw-btn sm" data-arw="back"${idx === 0 ? ' disabled' : ''}>‹ Back</button>
         <button class="arw-btn primary sm" data-arw="next">${last ? 'Finish ✓' : 'Next ›'}</button>
       </div>`;
    place();
  }

  function go(delta){
    const next = idx + delta;
    if(next < 0) return;
    if(next >= steps.length){ finish(); return; }
    idx = next; renderStep();
  }

  function startTour(){
    injectCss();
    teardown();
    steps = tourSteps().filter(s => s.sel === null || firstVisible(s.sel));
    if(!steps.length){ finish(); return; }
    idx = 0;
    root = document.createElement('div');
    root.id = 'arw-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Referee walkthrough');
    root.innerHTML = `<div id="arw-catch"></div><div id="arw-spot"></div><div class="arw-tip"></div>`;
    document.body.appendChild(root);
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-arw]'); if(!b) return;
      const a = b.getAttribute('data-arw');
      if(a === 'skip') finish();
      else if(a === 'back') go(-1);
      else if(a === 'next') go(1);
    });
    onKey = e => {
      if(e.key === 'Escape'){ e.preventDefault(); finish(); }
      else if(e.key === 'ArrowRight' || e.key === 'Enter'){ e.preventDefault(); go(1); }
      else if(e.key === 'ArrowLeft'){ e.preventDefault(); go(-1); }
    };
    document.addEventListener('keydown', onKey, true);
    onResize = () => { if(root) place(); };
    addEventListener('resize', onResize); addEventListener('orientationchange', onResize);
    renderStep();
  }

  // ── The welcome panel (entry point; offers the tour) ────────────────────────
  function startWelcome(){
    injectCss();
    teardown();
    root = document.createElement('div');
    root.id = 'arw-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Welcome, Referee');
    root.innerHTML =
      `<div id="arw-back"><div class="arw-welcome">
        <button class="arw-x" data-arw="close" aria-label="Close">×</button>
        <div class="arw-kick">Aurelia RPG Tools</div>
        <h2 class="arw-h">Welcome, Referee.</h2>
        <p class="arw-p">This is your virtual tabletop for running Traveller. Everything your table sees —
          the map, the clock, reveals, combat — is driven from here. Take a 60-second tour of the controls,
          or jump straight in.</p>
        <div class="arw-grid">
          <span class="k">The map</span><span class="v">galaxy → system → station → decks</span>
          <span class="k">The clock</span><span class="v">advance time; players see it live</span>
          <span class="k">🛡 Referee tools</span><span class="v">Design Mode, backup, Campaign Setup</span>
          <span class="k">⚔ Combat &amp; ⋯ More</span><span class="v">run the session end to end</span>
        </div>
        <div class="arw-nav">
          <div class="sp"></div>
          <button class="arw-btn ghost" data-arw="close">I’ll explore on my own</button>
          <button class="arw-btn primary" data-arw="tour">Start the guided tour ›</button>
        </div>
      </div></div>`;
    document.body.appendChild(root);
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-arw]'); if(!b) return;
      const a = b.getAttribute('data-arw');
      if(a === 'tour'){ startTour(); }
      else if(a === 'close'){ finish(); }
    });
    onKey = e => {
      if(e.key === 'Escape'){ e.preventDefault(); finish(); }
      else if(e.key === 'Enter'){ e.preventDefault(); startTour(); }
    };
    document.addEventListener('keydown', onKey, true);
  }

  // ── Public entry points (used by the Referee menu) ──────────────────────────
  window.startRefereeWelcome = startWelcome; // welcome panel → optional tour
  window.startRefereeTour = startTour;       // jump straight to the coached tour

  // ── Auto-run once, for a first-time referee, after the app has settled ──────
  function ready(){
    if(ls(DONE_KEY) === '1') return false;
    if(ls('aurelia_access') !== '1') return false;                    // still at the gate
    const sp = document.getElementById('app-splash');
    if(sp && sp.classList.contains('show')) return false;             // intro splash still up
    const gate = document.getElementById('pw-gate');
    if(gate && !gate.classList.contains('hidden') && gate.offsetParent !== null) return false;
    if(!document.getElementById('hdr')) return false;                 // header not built yet
    if(typeof isReferee === 'function' && !isReferee()) return false; // players never onboard
    if(typeof DISPLAY_MODE !== 'undefined' && DISPLAY_MODE) return false; // table-display window
    return true;
  }
  function schedule(){
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if(ready()){ clearInterval(t); startWelcome(); }
      else if(tries > 50){ clearInterval(t); } // ~20s ceiling; give up quietly
    }, 400);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
  else schedule();
})();

// ═══════════════════════════════════════════════════════════════════════════
// FIRST-RUN HELP  ·  walkthroughs (referee + player) + setup health check
// ───────────────────────────────────────────────────────────────────────────
// Distinct from setup.html (which configures a *deployment*): this teaches people
// how to USE the app, the first time they reach it, and lets a referee confirm
// their deployment is actually wired up.
//
//   • Referee walkthrough — welcome panel → optional coached spotlight tour of the
//     header controls. Auto-runs once (localStorage.aurelia_ref_onboarded).
//   • Player walkthrough  — a lighter welcome + short tour of the player-facing
//     controls, when someone opens their invite link. (localStorage.aurelia_player_onboarded)
//   • Setup health check   — referee-only panel: where each setting comes from,
//     live Supabase reachability, the aurelia_state table, and the get-content
//     Edge Function. openSetupHealth().
//
// Fully self-contained: one IIFE, no inline handlers, all styles scoped under the
// `arw-` prefix, so it can't collide with the app's global scope or CSS.
// ═══════════════════════════════════════════════════════════════════════════
(function(){
  "use strict";

  const Z = 2147483000; // above every app panel/menu
  const DONE = { referee: 'aurelia_ref_onboarded', player: 'aurelia_player_onboarded' };
  function ls(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
  function setLs(k, v){ try { localStorage.setItem(k, v); } catch(e){} }

  // ── Scoped styles (arw- prefix; palette mirrors setup.html for continuity) ──
  const CSS = `
  #arw-root{position:fixed;inset:0;z-index:${Z};font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
  #arw-catch{position:fixed;inset:0;z-index:${Z};background:transparent}
  #arw-back{position:fixed;inset:0;z-index:${Z};background:rgba(8,10,16,.72);
    display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(2px)}
  #arw-spot{position:fixed;z-index:${Z + 1};border-radius:10px;pointer-events:none;
    box-shadow:0 0 0 3px #D4A843, 0 0 0 9999px rgba(8,10,16,.72);
    transition:left .28s cubic-bezier(.4,0,.2,1),top .28s cubic-bezier(.4,0,.2,1),width .28s cubic-bezier(.4,0,.2,1),height .28s cubic-bezier(.4,0,.2,1)}
  .arw-tip,.arw-card{background:linear-gradient(180deg,#181c27,#141824);border:.5px solid #2e3347;
    border-radius:10px;box-shadow:0 24px 60px -24px #000;color:#e8eaf0}
  .arw-tip{position:fixed;z-index:${Z + 2};width:min(340px,calc(100vw - 24px));padding:16px 16px 13px}
  .arw-card{position:relative;z-index:${Z + 2};width:min(540px,100%);max-height:calc(100vh - 40px);
    overflow:auto;padding:26px 26px 22px;text-align:left}
  .arw-kick{font-family:ui-monospace,Menlo,Consolas,monospace;letter-spacing:.28em;font-size:10px;
    color:#D4A843;text-transform:uppercase}
  .arw-h{margin:8px 0 8px;font-size:22px;font-weight:650}
  .arw-tip .arw-h{font-size:15px;margin:0 0 6px;color:#D4A843}
  .arw-p{margin:0 0 2px;color:#c9cee0;font-size:13px;line-height:1.55}
  .arw-tip .arw-p{font-size:12.5px;color:#c2c8db}
  .arw-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px 16px;margin:16px 0 4px;font-size:12px}
  .arw-grid .k{color:#D4A843;white-space:nowrap}
  .arw-grid .v{color:#a3a9bf}
  .arw-count{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10.5px;color:#7f869c;margin-bottom:7px}
  .arw-nav{display:flex;align-items:center;gap:8px;margin-top:14px;flex-wrap:wrap}
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
  /* health check */
  .arw-hrow{display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-top:.5px solid #252a3a}
  .arw-hrow:first-of-type{border-top:none}
  .arw-hrow .lbl{flex:1;font-size:12.5px;color:#e8eaf0}
  .arw-hrow .sub{display:block;color:#8890a6;font-size:11px;margin-top:2px;line-height:1.45}
  .arw-pill{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10.5px;padding:3px 9px;border-radius:99px;
    border:.5px solid #2e3347;white-space:nowrap;flex:none}
  .arw-pill.ok{color:#4caf82;border-color:#2c5c47}
  .arw-pill.warn{color:#d4913a;border-color:#5c4726}
  .arw-pill.bad{color:#d45050;border-color:#5c2b2b}
  .arw-pill.mut{color:#8890a6}
  .arw-hsrc{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:#a3a9bf}
  /* not-configured banner (referee-only, dismissible) */
  #arw-banner{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:${Z - 10};
    max-width:min(720px,calc(100vw - 24px));display:flex;align-items:center;gap:12px;flex-wrap:wrap;
    background:linear-gradient(180deg,#2a2015,#231a10);border:.5px solid #5c4726;border-radius:10px;
    padding:11px 12px 11px 16px;box-shadow:0 18px 50px -20px #000;color:#f0d8ad;
    font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
  #arw-banner .arw-bmsg{font-size:12.5px;line-height:1.45;flex:1;min-width:200px}
  #arw-banner .arw-bacts{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .arw-bx{background:none;border:none;color:#c8b48a;font-size:18px;line-height:1;cursor:pointer;padding:0 2px}
  .arw-bx:hover{color:#fff}
  @media(max-width:520px){ .arw-grid{grid-template-columns:1fr} }
  `;
  function injectCss(){
    if(document.getElementById('arw-style')) return;
    const s = document.createElement('style'); s.id = 'arw-style'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ── Copy + steps, per role. sel = comma-list of candidate targets (first
  //    visible wins); sel:null = a centered card with no spotlight. ───────────
  function playerName(){
    let n = ls('aurelia_identity');
    if(!n && typeof myIdentity !== 'undefined' && myIdentity) n = myIdentity;
    return (n && String(n).trim()) || '';
  }
  const WELCOME = {
    referee: () => ({
      title: 'Welcome, Referee.',
      body: `This is your virtual tabletop for running Traveller. Everything your table sees —
        the map, the clock, reveals, combat — is driven from here. Take a 60-second tour of the
        controls, or jump straight in.`,
      grid: [
        ['The map', 'galaxy → system → station → decks'],
        ['The clock', 'advance time; players see it live'],
        ['🛡 Referee tools', 'Design Mode, backup, Campaign Setup'],
        ['⚔ Combat &amp; ⋯ More', 'run the session end to end'],
      ],
      tourLabel: 'Start the guided tour ›',
    }),
    player: () => {
      const n = playerName();
      return {
        title: n ? `Welcome aboard, ${escapeHtml(n)}.` : 'Welcome aboard.',
        body: `This is the table's shared map and toolkit for your Traveller campaign. Your referee
          runs the clock and reveals the galaxy as you go — here's where to look.`,
        grid: [
          ['The map', 'explore systems the crew has charted'],
          ['📜 Missions', 'your current jobs & leads'],
          ['🚀 Ship', 'fuel, jump range, travel time'],
          ['💰 Funds', 'the party account & your purse'],
        ],
        tourLabel: 'Show me around ›',
      };
    },
  };
  const STEPS = {
    referee: () => [
      { sel:'#breadcrumb,#hdr-title,#hdr-locus', title:'Where you are',
        body:'Your place in the world. Drill in galaxy → system → station → deck plans; this trail always takes you back out.' },
      { sel:'#impdate-wrap,#clock-wrap,#impdate-display', title:'Time & the Imperial date',
        body:'Advance the clock and campaign date as play unfolds — every player’s screen updates live.' },
      { sel:'#search-wrap,#search-input', title:'Find anything',
        body:'Jump straight to any system, NPC, area, or rules check by name.' },
      { sel:'#referee-menu-btn', title:'Referee tools 🛡',
        body:'Display options, campaign backup, Campaign Setup, a Setup health check, and this tour live here. Design Mode, to edit the world itself, is one tap in.' },
      { sel:'#combat-btn,#ship-btn', title:'Run the session ⚔',
        body:'Space combat by the Traveller 2e rules, plus ship status, party funds, cargo and the mission log along this row.' },
      { sel:'#more-btn', title:'More tools ⋯',
        body:'Library data, the wiki, contacts, downtime, the living economy, and the session planner.' },
      { sel:'#settings-btn', title:'Settings ⚙',
        body:'Themes, keyboard shortcuts, and per-device display options.' },
      { sel:null, title:'Invite your players',
        body:'Open Campaign Setup (in 🛡 Referee tools) to hand each player a personal invite link — they join and see only what’s theirs. That’s it — you’re ready to run. Reopen this any time from Referee tools ▸ Take the tour.' },
    ],
    player: () => [
      { sel:'#breadcrumb,#hdr-title,#hdr-locus', title:'Where you are',
        body:'Your place in the galaxy. Follow the crew from the starmap into a system, a station, and its decks.' },
      { sel:'#search-wrap,#search-input', title:'Find anything',
        body:'Search charted systems, people you’ve met, and rules by name.' },
      { sel:'#quest-btn', title:'Your missions 📜',
        body:'Current jobs, leads and objectives the party is chasing.' },
      { sel:'#ship-btn', title:'Your ship 🚀',
        body:'Fuel, jump range and travel time for the crew’s vessel.' },
      { sel:'#funds-btn', title:'Party funds 💰',
        body:'The shared account and your own purse.' },
      { sel:null, title:'The referee runs the table',
        body:'Your referee controls the clock and what’s revealed — so the map fills in as the story does. Explore what’s lit up; the rest unlocks as you play. Reopen this any time from ⚙ Settings ▸ Take the tour.' },
    ],
  };

  function escapeHtml(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  // ── Shared overlay state ────────────────────────────────────────────────────
  let root = null, steps = [], idx = 0, onKey = null, onResize = null, role = 'referee';

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
  function finish(){ setLs(DONE[role] || DONE.referee, '1'); teardown(); }

  // ── Coached spotlight tour ──────────────────────────────────────────────────
  function place(){
    const step = steps[idx];
    const tip = root.querySelector('.arw-tip');
    const spot = root.querySelector('#arw-spot');
    const target = step.sel ? firstVisible(step.sel) : null;
    tip.style.visibility = 'hidden'; tip.style.left = '0px'; tip.style.top = '0px';
    const tw = tip.offsetWidth, th = tip.offsetHeight, vw = innerWidth, vh = innerHeight, gap = 14;
    if(target){
      const r = target.getBoundingClientRect(), pad = 6;
      spot.style.display = 'block';
      spot.style.left = (r.left - pad) + 'px'; spot.style.top = (r.top - pad) + 'px';
      spot.style.width = (r.width + pad * 2) + 'px'; spot.style.height = (r.height + pad * 2) + 'px';
      let top = r.bottom + gap;
      if(top + th > vh - 8) top = r.top - gap - th;
      top = Math.max(8, Math.min(top, vh - th - 8));
      let left = r.left + r.width / 2 - tw / 2;
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
    const n = idx + delta;
    if(n < 0) return;
    if(n >= steps.length){ finish(); return; }
    idx = n; renderStep();
  }
  function startTour(r){
    role = (r === 'player') ? 'player' : 'referee';
    injectCss(); teardown();
    steps = STEPS[role]().filter(s => s.sel === null || firstVisible(s.sel));
    if(!steps.length){ finish(); return; }
    idx = 0;
    root = document.createElement('div');
    root.id = 'arw-root'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Walkthrough');
    root.innerHTML = `<div id="arw-catch"></div><div id="arw-spot"></div><div class="arw-tip"></div>`;
    document.body.appendChild(root);
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-arw]'); if(!b) return;
      const a = b.getAttribute('data-arw');
      if(a === 'skip') finish(); else if(a === 'back') go(-1); else if(a === 'next') go(1);
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

  // ── Welcome panel (entry point; offers the tour) ────────────────────────────
  function startWelcome(r){
    role = (r === 'player') ? 'player' : 'referee';
    injectCss(); teardown();
    const w = WELCOME[role]();
    const grid = w.grid.map(([k, v]) => `<span class="k">${k}</span><span class="v">${v}</span>`).join('');
    root = document.createElement('div');
    root.id = 'arw-root'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Welcome');
    root.innerHTML =
      `<div id="arw-back"><div class="arw-card">
        <button class="arw-x" data-arw="close" aria-label="Close">×</button>
        <div class="arw-kick">Aurelia RPG Tools</div>
        <h2 class="arw-h">${w.title}</h2>
        <p class="arw-p">${w.body}</p>
        <div class="arw-grid">${grid}</div>
        <div class="arw-nav">
          <div class="sp"></div>
          <button class="arw-btn ghost" data-arw="close">I’ll explore on my own</button>
          <button class="arw-btn primary" data-arw="tour">${w.tourLabel}</button>
        </div>
      </div></div>`;
    document.body.appendChild(root);
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-arw]'); if(!b) return;
      const a = b.getAttribute('data-arw');
      if(a === 'tour') startTour(role); else if(a === 'close') finish();
    });
    onKey = e => {
      if(e.key === 'Escape'){ e.preventDefault(); finish(); }
      else if(e.key === 'Enter'){ e.preventDefault(); startTour(role); }
    };
    document.addEventListener('keydown', onKey, true);
  }

  // ══ Setup health check (referee-only) ═══════════════════════════════════════
  function cfgSource(key, lsKey){
    const c = (typeof window.AURELIA_CONFIG === 'object' && window.AURELIA_CONFIG) || null;
    if(c && c[key] != null && c[key] !== '') return 'config.js';
    const v = ls(lsKey);
    if(v != null && v !== '') return 'this device';
    return 'built-in default';
  }
  async function probeBackend(){
    const url = (typeof SUPABASE_URL === 'string' ? SUPABASE_URL : '').replace(/\/+$/, '');
    const key = (typeof SUPABASE_KEY === 'string' ? SUPABASE_KEY : '');
    const out = { url, backend: 'unknown', table: 'unknown', getcontent: 'unknown' };
    if(!url || !key){ out.backend = 'unset'; return out; }
    try {
      const r = await fetch(url + '/rest/v1/aurelia_state?select=key&limit=1', { headers: { apikey: key, Authorization: 'Bearer ' + key } });
      if(r.status === 401 || r.status === 403){ out.backend = 'badkey'; }
      else if(r.ok){ out.backend = 'ok'; out.table = 'ok'; }
      else if(r.status === 404){ out.backend = 'ok'; out.table = 'missing'; }
      else {
        const t = await r.text().catch(() => '');
        out.backend = 'ok'; out.table = /does not exist|PGRST205|find the table/i.test(t) ? 'missing' : 'unknown';
      }
    } catch(e){ out.backend = 'unreachable'; }
    if(out.backend === 'ok'){
      try {
        const r2 = await fetch(url + '/functions/v1/get-content', { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: '{}' });
        out.getcontent = (r2.status === 404) ? 'missing' : 'deployed';
      } catch(e){ out.getcontent = 'unknown'; }
    }
    return out;
  }
  function pill(kind, text){ return `<span class="arw-pill ${kind}">${text}</span>`; }
  function hrow(label, sub, pillHtml){ return `<div class="arw-hrow"><div class="lbl">${label}${sub ? `<span class="sub">${sub}</span>` : ''}</div>${pillHtml}</div>`; }
  function hostOf(u){ try { return new URL(u).host; } catch(e){ return u || '—'; } }

  function openSetupHealth(){
    injectCss(); teardown();
    role = 'referee';
    const srcRows = [
      ['Backend URL', 'supabaseUrl', 'aurelia_supabase_url'],
      ['Backend key', 'supabaseKey', 'aurelia_supabase_key'],
      ['Access code', 'accessCode', 'aurelia_access_code'],
      ['Design code', 'designCode', 'aurelia_design_code'],
      ['Campaign name', 'campaignName', 'aurelia_campaign_name'],
    ].map(([lbl, k, lsk]) => `<div class="arw-hrow"><div class="lbl">${lbl}</div><span class="arw-hsrc">${cfgSource(k, lsk)}</span></div>`).join('');

    root = document.createElement('div');
    root.id = 'arw-root'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Setup health');
    root.innerHTML =
      `<div id="arw-back"><div class="arw-card">
        <button class="arw-x" data-arw="close" aria-label="Close">×</button>
        <div class="arw-kick">Aurelia RPG Tools</div>
        <h2 class="arw-h" style="font-size:19px">Setup health</h2>
        <p class="arw-p">A quick check that this copy is wired up. Nothing here changes anything.</p>
        <div id="arw-health-live" style="margin:14px 0 4px">
          ${hrow('Checking your Supabase backend…', 'reachability, tables, functions', pill('mut', '…'))}
        </div>
        <div class="arw-kick" style="margin:18px 0 4px">Where each setting comes from</div>
        ${srcRows}
        <div class="arw-nav">
          <button class="arw-btn ghost" data-arw="setup">Open Campaign Setup ›</button>
          <div class="sp"></div>
          <button class="arw-btn primary" data-arw="close">Done</button>
        </div>
      </div></div>`;
    document.body.appendChild(root);
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-arw]'); if(!b) return;
      const a = b.getAttribute('data-arw');
      if(a === 'close'){ teardown(); }                 // health check never sets an onboarded flag
      else if(a === 'setup'){ teardown(); location.href = 'setup.html'; }
    });
    onKey = e => { if(e.key === 'Escape'){ e.preventDefault(); teardown(); } };
    document.addEventListener('keydown', onKey, true);

    probeBackend().then(res => {
      const live = document.getElementById('arw-health-live');
      if(!live) return;
      const backend =
        res.backend === 'ok'         ? hrow('Backend reachable', hostOf(res.url), pill('ok', '✓ URL &amp; key valid')) :
        res.backend === 'badkey'     ? hrow('Backend key rejected', hostOf(res.url) + ' — check the publishable key', pill('bad', '✗ 401')) :
        res.backend === 'unreachable'? hrow('Backend unreachable', 'check the URL and your connection', pill('bad', '✗ no response')) :
        res.backend === 'unset'      ? hrow('No backend configured', 'run Campaign Setup to add your Supabase project', pill('warn', '— unset')) :
                                       hrow('Backend status unclear', hostOf(res.url), pill('warn', '? unknown'));
      const table =
        res.table === 'ok'      ? hrow('aurelia_state table', 'shared reveals, clock &amp; notes', pill('ok', '✓ present')) :
        res.table === 'missing' ? hrow('aurelia_state table', 'run the schema SQL from Campaign Setup ▸ Database', pill('bad', '✗ missing')) :
        res.backend === 'ok'    ? hrow('aurelia_state table', 'could not determine', pill('warn', '? unknown')) : '';
      const gc =
        res.getcontent === 'deployed' ? hrow('get-content function', 'per-player redaction is live', pill('ok', '✓ deployed')) :
        res.getcontent === 'missing'  ? hrow('get-content function', 'optional — only for hiding referee content from players', pill('mut', '— not set up')) : '';
      live.innerHTML = backend + table + gc;
    });
  }

  // ══ "Not fully configured" banner (referee-only, dismissible) ═══════════════
  // Conservative: fires only on unmistakable misconfiguration — placeholder/unset
  // config, a rejected key (401), or missing tables — never on a transient offline
  // blip (that's the conn-pill's job), so the live deploy never sees a false alarm.
  let bannerDismissed = false;
  function showConfigBanner(msg){
    injectCss();
    if(bannerDismissed || document.getElementById('arw-banner')) return;
    const el = document.createElement('div');
    el.id = 'arw-banner'; el.setAttribute('role', 'status');
    el.innerHTML = `<span class="arw-bmsg">⚠ ${msg}</span>
      <span class="arw-bacts">
        <button class="arw-btn primary sm" data-arw="bsetup">Campaign Setup ›</button>
        <button class="arw-btn ghost sm" data-arw="bhealth">Setup health</button>
        <button class="arw-bx" data-arw="bclose" aria-label="Dismiss">×</button>
      </span>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-arw]'); if(!b) return;
      const a = b.getAttribute('data-arw');
      if(a === 'bclose'){ bannerDismissed = true; el.remove(); }
      else if(a === 'bsetup'){ location.href = 'setup.html'; }
      else if(a === 'bhealth'){ el.remove(); openSetupHealth(); }
    });
  }
  async function maybeConfigBanner(){
    if(bannerDismissed) return;
    const url = (typeof SUPABASE_URL === 'string' ? SUPABASE_URL : '');
    const key = (typeof SUPABASE_KEY === 'string' ? SUPABASE_KEY : '');
    const acc = (typeof ACCESS_CODE === 'string' ? ACCESS_CODE : '');
    const dsg = (typeof DESIGN_MODE_CODE === 'string' ? DESIGN_MODE_CODE : '');
    const placeholder = /YOUR-PROJECT|YOUR_KEY|change-me-/i.test([url, key, acc, dsg].join(' '));
    if(!url || !key || placeholder){
      showConfigBanner('This copy isn’t connected to a campaign backend yet — run Campaign Setup to finish.');
      return;
    }
    const res = await probeBackend();
    if(bannerDismissed) return;
    if(res.backend === 'badkey')       showConfigBanner('Your backend key was rejected — re-check it in Campaign Setup.');
    else if(res.table === 'missing')   showConfigBanner('Your database tables are missing — run the schema SQL from Campaign Setup ▸ Database.');
  }

  // ── Public entry points (referee menu + settings menu) ──────────────────────
  window.startRefereeWelcome = () => startWelcome('referee');
  window.startRefereeTour = () => startTour('referee');
  window.startPlayerWelcome = () => startWelcome('player');
  window.openSetupHealth = openSetupHealth;
  // Auto-detect the viewer's role — used by the shared "Take the tour" menu entry.
  window.startWalkthrough = () => startWelcome((typeof isReferee === 'function' && !isReferee()) ? 'player' : 'referee');

  // ── Auto-run once, after the app has settled ────────────────────────────────
  function isSettled(){
    if(ls('aurelia_access') !== '1') return false;                   // still at the gate
    const sp = document.getElementById('app-splash');
    if(sp && sp.classList.contains('show')) return false;            // intro splash still up
    const gate = document.getElementById('pw-gate');
    if(gate && !gate.classList.contains('hidden') && gate.offsetParent !== null) return false;
    if(!document.getElementById('hdr')) return false;                // header not built yet
    if(typeof DISPLAY_MODE !== 'undefined' && DISPLAY_MODE) return false; // table-display window
    return true;
  }
  function viewerRole(){
    if(typeof isReferee !== 'function') return null;
    if(isReferee()) return ls(DONE.referee) === '1' ? null : 'referee';
    if(ls(DONE.player) === '1') return null;                         // player: only once
    if(playerName() || ls('aurelia_token')) return 'player';         // …and only genuine players
    return null;
  }
  function schedule(){
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if(isSettled()){
        clearInterval(t);
        const r = viewerRole();
        if(r) startWelcome(r);                                       // first-run walkthrough
        if(typeof isReferee === 'function' && isReferee()) maybeConfigBanner(); // misconfig nudge
      } else if(tries > 50){ clearInterval(t); }                     // ~20s ceiling; give up quietly
    }, 400);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
  else schedule();
})();

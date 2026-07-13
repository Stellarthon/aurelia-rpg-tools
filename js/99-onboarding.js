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
  /* deeper-dive help hub + topic cards */
  .arw-topics{display:grid;gap:8px;margin:16px 0 4px}
  .arw-topic{appearance:none;display:block;width:100%;text-align:left;cursor:pointer;font:inherit;
    background:#1e2333;border:.5px solid #2e3347;border-radius:9px;padding:11px 13px;transition:.15s}
  .arw-topic:hover{border-color:#D4A843;background:#232a3c}
  .arw-topic-t{display:block;font-size:13.5px;font-weight:600;color:#e8eaf0}
  .arw-topic-d{display:block;font-size:12px;color:#a3a9bf;margin-top:2px;line-height:1.45}
  .arw-sh{margin:17px 0 5px;font-size:13px;font-weight:650;color:#D4A843}
  .arw-sh:first-of-type{margin-top:10px}
  .arw-card .arw-ul{margin:4px 0 0;padding-left:18px}
  .arw-card .arw-ul li{font-size:12.5px;color:#c9cee0;line-height:1.5;margin:4px 0}
  .arw-card .arw-ul li b{color:#e8eaf0}
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
        body:'Open Campaign Setup (in 🛡 Referee tools) to hand each player a personal invite link — they join and see only what’s theirs. That’s the essentials — next, pick anything you’d like a closer look at, or jump straight in.' },
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
         <button class="arw-btn primary sm" data-arw="next">${last ? (role === 'referee' ? 'More help ›' : 'Finish ✓') : 'Next ›'}</button>
       </div>`;
    place();
  }
  function go(delta){
    const n = idx + delta;
    if(n < 0) return;
    if(n >= steps.length){ if(role === 'referee') openHelpHub(); else finish(); return; }
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

  // ══ Deeper-dive help hub (referee) — offered at the end of the tour ══════════
  // A menu of closer looks at the systems a new referee won't meet on the header
  // tour: the ⋯ More tools, Design Mode, the deck builder, the star maps, the
  // economy, combat, and character sheets. Pure content cards (no spotlight), so
  // they never depend on which panel happens to be open.
  const TOPICS = [
    { id:'more', tab:'🧰 The ⋯ More toolbox', blurb:'Every tab in the More menu — what’s shared with players, and what’s yours.',
      title:'The ⋯ More toolbox', sections:[
        { h:'What it is', html:`<p class="arw-p">The <b>⋯ More</b> button (top-right) is your toolbox — everything that isn’t a map, the clock, or combat. Player-facing tabs show for everyone; your referee-only tools are hidden from players automatically.</p>` },
        { h:'Shared with the table', html:`<ul class="arw-ul">
          <li><b>🗂 Library Data</b> — lore &amp; intel the party has uncovered.</li>
          <li><b>📚 Wiki</b> — your curated campaign lore and factions.</li>
          <li><b>🤝 Contacts</b> — patrons, informants and rivals.</li>
          <li><b>🤫 Whispers</b> — players send you private notes (watch the unread badge).</li>
          <li><b>⚖ Standing</b> · <b>🕗 Clocks</b> — faction reputation, and schemes/threats ticking down.</li>
          <li><b>⏳ Downtime</b> — between-jump actions: train, repair, work contacts.</li>
          <li><b>📅 Imperial Calendar</b> · <b>🖼 Handouts</b> · <b>📦 Starport Board</b> — the timeline, shared maps &amp; clues, and freight/passengers at this port.</li>
          <li><b>🎯 Turns</b> — combat turn order, shown once a fight begins.</li>
        </ul>` },
        { h:'Your referee-only tools', html:`<ul class="arw-ul">
          <li><b>🗓 Session Planner</b> — prep &amp; run a session; links Oracle, Missions and NPCs.</li>
          <li><b>👥 NPCs</b> — author and browse the roster.</li>
          <li><b>📈 Economy</b> · <b>🛒 Station Trade</b> — the living market and the buy/sell desk (its own topic below).</li>
          <li><b>🎬 Session</b> · <b>🎵 Scenes</b> — export/recap, and one-tap ambience audio.</li>
          <li><b>📡 Send players to this view</b> / <b>🔓 Release players</b> — pull every screen to follow you, then let them roam again.</li>
        </ul>` },
        { h:'Tip', html:`<p class="arw-p">Handouts, Whispers and “Send players to this view” are your live-table levers — keep them within reach during play.</p>` },
      ] },
    { id:'design', tab:'✏ Design Mode', blurb:'Turn it on to edit systems, stations, NPCs and text in place.',
      title:'Design Mode — editing your world', sections:[
        { h:'Turning it on (and off)', html:`<p class="arw-p">Open <b>🛡 Referee tools ▸ ✏ Design Mode</b>, type your <b>design passcode</b> (the <code>designCode</code> from setup) and Unlock. A purple <b>✎</b> appears in the header. Tap the toggle again to switch it off — no code needed. It can’t be on at the same time as Player Mode.</p>` },
        { h:'What it unlocks', html:`<p class="arw-p">Little <b>✏ pencils</b> appear on every editable piece of text, and the header <b>✎</b> opens Design tools:</p>
          <ul class="arw-ul">
            <li><b>🌐 Campaign Studio</b> — the campaign-level editor.</li>
            <li><b>↶ / ↷ Undo / Redo</b> · <b>🎒 Item Catalogue</b> · <b>🌠 Splash Screens</b> (the welcome players see).</li>
            <li><b>🗑 Show Removed Items</b> — restore anything deleted · <b>Referee Boxes</b> · <b>⟲ Reset Campaign</b>.</li>
          </ul>
          <p class="arw-p">Edit in place: read-aloud text, descriptions, referee notes, skill checks, timed events, NPCs, planets, moons &amp; belts, locations, whole star systems and regions.</p>` },
        { h:'Safe by design', html:`<p class="arw-p">Edits are <b>additive</b> — originals are never lost. Every field keeps its <b>History</b> and a <b>Revert to original</b>, and deletions are restorable from <b>Show Removed Items</b>.</p>` },
        { h:'One thing to know', html:`<p class="arw-p">Design edits save to the <b>shared backend</b>, so the whole table sees them. And <b>⟲ Reset Campaign</b> wipes reveals, the clock, initiative <i>and</i> all your edits for everyone — it can’t be undone. Treat it as a fresh start, not an undo.</p>` },
      ] },
    { id:'decks', tab:'🗺 The deck builder', blurb:'Draw a ship or station’s interior; players get a clean read-only copy.',
      title:'The deck builder', sections:[
        { h:'What it’s for', html:`<p class="arw-p">A square-grid editor for drawing a ship’s or station’s interior deck plan. A plan you draw <b>replaces</b> the app’s auto-generated station map, and players see a tidy read-only version.</p>` },
        { h:'Getting there', html:`<p class="arw-p">It’s a referee tool — turn on <b>Design Mode</b> first. Then on a <b>station</b>, the Design Studio panel shows <b>🗺 Draw deck plan</b>; on a <b>ship</b>, the <b>🚀 Ship</b> panel has <b>🗺 Draw ship deck plan</b>. Either opens the full-screen editor.</p>` },
        { h:'The tools', html:`<ul class="arw-ul">
          <li><b>Edit</b> — ✋ Pan · ➤ Select · ⌫ Erase.</li>
          <li><b>Draw</b> — ▭ Room · ▦ Floor · ─ Wall · ⟋ Wall run · ⋈ Merge.</li>
          <li><b>🚪 Openings</b> — doors &amp; windows; a live ghost shows exactly where it lands, and a tap cycles closed → open → locked.</li>
          <li><b>📦 Props</b> — stamp furniture; <b>＋ Custom</b> uploads your own image as a prop.</li>
          <li><b>⧉ Rooms</b> — prefab templates, plus <b>▭ Copy area</b> to copy/paste a whole region.</li>
          <li><b>Annotate</b> — 🏷 Label · <b>⊕ Area link</b> · ⬤ Tokens · 📏 Range.</li>
        </ul>` },
        { h:'Decks, saving &amp; players', html:`<p class="arw-p">Add levels with <b>＋ Deck</b>, rename/reorder, and export/import JSON. There’s <b>no Save button</b> — it auto-saves and syncs to players; <b>✓ Done</b> closes. <b>⊕ Area link</b> markers make rooms tap-to-open and power <b>fog-of-war</b> (rooms stay hidden until the party arrives), and <b>📤</b> renders the deck as a PNG handout.</p>` },
      ] },
    { id:'maps', tab:'🌌 The star maps (Hex &amp; Real)', blurb:'Plan jumps on the hex grid; go cinematic with the real view.',
      title:'The star maps — Hex &amp; Real', sections:[
        { h:'Two views, one toggle', html:`<p class="arw-p">In the galaxy view, <b>Hex / Real</b> switches between the two maps (remembered per device, and mirrored on the table display). Use <b>Hex</b> to plan, <b>Real</b> for a cinematic view.</p>` },
        { h:'The Hex map — your working map', html:`<p class="arw-p"><b>1 hex = 1 parsec</b> on a Traveller-style grid. (The layout is clustered by faction for clarity, not to real distance.)</p>
          <ul class="arw-ul">
            <li><b>Jump range</b> — <b>J1–J6</b> light every system a Jump-N drive reaches in one ~week-long jump (cyan = in range, gold = fuel range).</li>
            <li><b>Jump routes</b> — surveyed lanes cost less fuel and the plotter prefers them; you can add, remove, or <b>block a lane</b> with a reason.</li>
            <li><b>Reveal to players</b> — <b>Mark visited</b> opens a world’s market (unvisited worlds are fogged with no price intel; jumping there reveals it). The <b>👁 / 🙈</b> per-faction toggle can redact a whole region to “Uncharted.”</li>
          </ul>` },
        { h:'Drilling in', html:`<p class="arw-p">Click a star to select it (the <b>Jump Plotter</b> opens), then <b>⊙ View close up</b> drops into that system’s orrery.</p>` },
        { h:'The Real map', html:`<p class="arw-p">One seamless zoom from <b>Galaxy → Approach → System</b>; zoom a star to open its live orrery. It’s stylised, not real astronomy, and it never changes your system data — ideal on a table screen while you plan on Hex.</p>` },
      ] },
    { id:'economy', tab:'📈 The economy (simple &amp; realistic)', blurb:'From plain trade-good prices to a full simulated market with corporations.',
      title:'The economy — Simple &amp; Living', sections:[
        { h:'Where it lives', html:`<p class="arw-p">Under <b>⋯ More</b>: <b>📈 Economy</b> opens the <b>Living Economy</b> console (referee-only), and <b>🛒 Station Trade</b> is the buy/sell desk. Players never get a trade UI — prices are <b>fog-of-price</b>: a world shows a sealed “?” until the party has actually called there.</p>` },
        { h:'Simple mode (the default)', html:`<p class="arw-p">The header toggle reads <b>◐ Simple</b>. Prices come straight from each world’s <b>Produces / Demands</b> profile — producers sell their good cheaper, importers pay more. No stockpiles, no logistics. The <b>Station Trade</b> desk shows the trade-code DMs as reference and records the deals you roll with dice at the table (updating funds and cargo). This is all most tables ever need.</p>` },
        { h:'Full / Living simulation', html:`<p class="arw-p">Flip the toggle to <b>⚙ Full simulation</b> and it becomes a real stocks-and-flows economy: goods are made along supply chains (ore → electronics → advanced; fuel; food → pharma), worlds hold stockpiles, and trade moves goods producer → consumer with a <b>lead time equal to jump distance</b>, so shocks ripple outward. It layers on price drift, black markets, faction AI, pirates, and a <b>corporation layer</b> — trading houses (including the <b>OmniSynth</b> megacorp) with treasuries and fleets that advance each turn.</p>` },
        { h:'Running it', html:`<p class="arw-p">A tick is <b>one Imperial week</b>. It auto-advances when you move the campaign calendar; the console’s <b>+1 day / Step +1 wk / +4 wks / Reset</b> buttons let you <b>preview</b> cascades without moving the campaign date. Fire disruptions with the preset <b>Duration + Severity</b> controls, let <b>◇ Auto-fire events</b> run the market for you, or reach into the corporation controls.</p>` },
        { h:'Tip', html:`<p class="arw-p">Start in Simple. Switch to Full only when you want the market to feel alive between sessions — every device stays in sync, and if the engine ever hiccups, nothing changes for players.</p>` },
      ] },
    { id:'combat', tab:'⚔ Running combat', blurb:'Traveller 2e ship combat, plus an initiative tracker for boarding &amp; ground fights.',
      title:'Running combat', sections:[
        { h:'Two tools', html:`<p class="arw-p"><b>⚔ Combat</b> in the header runs <b>Traveller 2e ship combat</b>. For boarding actions and ground fights, use the <b>⚔ Initiative</b> tracker. Your device is the authority; players’ screens follow read-only, and hidden enemies stay hidden until you reveal them.</p>` },
        { h:'Setting up a space fight', html:`<p class="arw-p"><b>⚔ Begin Encounter</b> seeds the party ship. Type an enemy name ▸ <b>＋ Add ship</b> (foes start at <b>Long</b> range and hidden); <b>👁 Reveal</b> or <b>🔒 Hide stats</b> control what players see. Then <b>🎲 Roll Initiative &amp; Begin</b> (2D + Pilot + Thrust).</p>` },
        { h:'The round', html:`<p class="arw-p">Each round runs three phases in order, and <b>Next ▸</b> walks you through every ship in initiative order:</p>
          <ul class="arw-ul">
            <li><b>Manoeuvre</b> — allocate thrust, <b>Evade</b>, and <b>▸ Close / ◂ Open</b> range across the bands (Adjacent … Distant).</li>
            <li><b>Attack</b> — pick a target + weapon and <b>🔥 Fire</b> (2D + Gunnery vs 8+); missiles support salvos, locks and point-defence.</li>
            <li><b>Action</b> — Sensor Lock, Leadership, and other once-per-round moves.</li>
          </ul>` },
        { h:'Damage &amp; tips', html:`<p class="arw-p">Armour subtracts from damage, then Hull drops; a big Effect or every 10% of Hull lost triggers a critical. Add at least one enemy before rolling, keep foes hidden until they matter, and use <b>Quick-resolve</b> for minor skirmishes. Boarding? Switch to the Initiative tracker and <b>⚔ From map</b> to pull in the deck tokens.</p>` },
      ] },
    { id:'sheets', tab:'📋 Character sheets', blurb:'Open, edit and share PC sheets; the ship has its own panel.',
      title:'Character sheets', sections:[
        { h:'Opening them', html:`<p class="arw-p"><b>📋 Sheets</b> in the header. As referee you get a <b>character-picker</b> at the top to flip between everyone’s sheets; a player opens <b>their own</b> (and is asked who they’re “Playing as” if they haven’t chosen yet).</p>` },
        { h:'What’s on a sheet', html:`<p class="arw-p">Name &amp; age, the six characteristics (<b>STR / DEX / END / INT / EDU / SOC</b>) with live DMs, skills, a task-check helper, inventory with encumbrance, notes, a <b>💰 Funds</b> aside (personal purse + party fund) and <b>Status effect</b> chips. <b>🖨 Print / save as PDF</b> makes a paper or backup copy.</p>` },
        { h:'The ship is separate', html:`<p class="arw-p">The crew’s vessel lives on its own <b>🚀 Ship</b> panel — a shared “Ship Data File” with fuel, jump range and critical hits. You edit it; players read it (some readouts, like jump distance, show only to the pilots).</p>` },
        { h:'Saving &amp; visibility', html:`<p class="arw-p">Sheets save to the <b>shared backend</b> under each character’s name, so they sync across devices. You see and edit every sheet; players reach only their own. It’s honour-system visibility for spoilers, <i>not</i> security — data still ships to every device.</p>` },
      ] },
  ];

  function topicCard(i){
    const t = TOPICS[i], last = i === TOPICS.length - 1;
    const secs = t.sections.map(s => `<h3 class="arw-sh">${s.h}</h3>${s.html}`).join('');
    return `<div id="arw-back"><div class="arw-card">
        <button class="arw-x" data-arw="close" aria-label="Close">×</button>
        <div class="arw-kick">Referee guide · ${i + 1} of ${TOPICS.length}</div>
        <h2 class="arw-h" style="font-size:20px">${t.title}</h2>
        ${secs}
        <div class="arw-nav">
          <button class="arw-btn ghost sm" data-arw="hub">‹ All topics</button>
          <div class="sp"></div>
          <button class="arw-btn sm" data-arw="tprev"${i === 0 ? ' disabled' : ''}>‹ Prev</button>
          <button class="arw-btn primary sm" data-arw="tnext">${last ? 'Done ✓' : 'Next ›'}</button>
        </div>
      </div></div>`;
  }
  function openTopic(i){
    injectCss(); teardown(); role = 'referee';
    root = document.createElement('div');
    root.id = 'arw-root'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', TOPICS[i].title);
    root.innerHTML = topicCard(i);
    document.body.appendChild(root);
    const card = root.querySelector('.arw-card'); if(card) card.scrollTop = 0;
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-arw]'); if(!b) return;
      const a = b.getAttribute('data-arw');
      if(a === 'close') finish();
      else if(a === 'hub') openHelpHub();
      else if(a === 'tprev'){ if(i > 0) openTopic(i - 1); }
      else if(a === 'tnext'){ (i < TOPICS.length - 1) ? openTopic(i + 1) : finish(); }
    });
    onKey = e => {
      if(e.key === 'Escape'){ e.preventDefault(); finish(); }
      else if(e.key === 'ArrowRight'){ e.preventDefault(); (i < TOPICS.length - 1) ? openTopic(i + 1) : finish(); }
      else if(e.key === 'ArrowLeft'){ e.preventDefault(); if(i > 0) openTopic(i - 1); }
    };
    document.addEventListener('keydown', onKey, true);
  }
  function openHelpHub(){
    injectCss(); teardown(); role = 'referee';
    const list = TOPICS.map((t, i) =>
      `<button class="arw-topic" data-topic="${i}">
         <span class="arw-topic-t">${t.tab}</span>
         <span class="arw-topic-d">${t.blurb}</span>
       </button>`).join('');
    root = document.createElement('div');
    root.id = 'arw-root'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'More help');
    root.innerHTML =
      `<div id="arw-back"><div class="arw-card">
        <button class="arw-x" data-arw="close" aria-label="Close">×</button>
        <div class="arw-kick">Aurelia RPG Tools</div>
        <h2 class="arw-h">Want to go deeper?</h2>
        <p class="arw-p">You’ve got the basics. Pick anything you’d like a closer look at — or jump straight in. You can reopen this any time from 🛡 Referee tools ▸ 📖 Referee guide.</p>
        <div class="arw-topics">${list}</div>
        <div class="arw-nav">
          <div class="sp"></div>
          <button class="arw-btn primary" data-arw="close">I’m all set ✓</button>
        </div>
      </div></div>`;
    document.body.appendChild(root);
    const card = root.querySelector('.arw-card'); if(card) card.scrollTop = 0;
    root.addEventListener('click', e => {
      if(e.target.closest('[data-arw="close"]')){ finish(); return; }
      const b = e.target.closest('[data-topic]'); if(!b) return;
      openTopic(parseInt(b.getAttribute('data-topic'), 10) || 0);
    });
    onKey = e => { if(e.key === 'Escape'){ e.preventDefault(); finish(); } };
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
  // A backend only counts as reachable when it answers like PostgREST — a JSON
  // row array, or a coded "table not found" error. A bare status code is not
  // enough: a non-URL config value makes fetch() resolve against this page's own
  // origin, and that host's stray 404 must NOT read as "backend ok, table missing".
  function isHttpUrl(u){
    try { const p = new URL(u); return p.protocol === 'http:' || p.protocol === 'https:'; }
    catch(e){ return false; }
  }
  const PGRST_MISSING = /PGRST|could not find the table|schema cache|does not exist|relation .* does not exist/i;
  function classifyProbe(status, contentType, body){
    const json = /\bjson\b/i.test(contentType || '');
    if(status === 401 || status === 403) return 'badkey';
    if(status >= 200 && status < 300 && json){
      try { if(Array.isArray(JSON.parse(body))) return 'creds-ok'; } catch(e){}
      return 'not-supabase';
    }
    if(json && PGRST_MISSING.test(body || '')) return 'table-missing';
    return 'not-supabase';
  }
  async function probeBackend(){
    const url = (typeof SUPABASE_URL === 'string' ? SUPABASE_URL : '').replace(/\/+$/, '');
    const key = (typeof SUPABASE_KEY === 'string' ? SUPABASE_KEY : '');
    const out = { url, backend: 'unknown', table: 'unknown', getcontent: 'unknown' };
    if(!url || !key){ out.backend = 'unset'; return out; }
    if(!isHttpUrl(url)){ out.backend = 'unreachable'; return out; }   // a non-URL can't be a backend
    try {
      const r = await fetch(url + '/rest/v1/aurelia_state?select=key&limit=1', { headers: { apikey: key, Authorization: 'Bearer ' + key } });
      const body = await r.text().catch(() => '');
      const verdict = classifyProbe(r.status, r.headers.get('content-type'), body);
      if(verdict === 'badkey')             out.backend = 'badkey';
      else if(verdict === 'creds-ok')     { out.backend = 'ok'; out.table = 'ok'; }
      else if(verdict === 'table-missing'){ out.backend = 'ok'; out.table = 'missing'; }
      else                                  out.backend = 'unreachable'; // answered, but not like Supabase
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
  window.openHelpTopics = openHelpHub;   // referee deep-dive hub (also offered at the end of the tour)
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

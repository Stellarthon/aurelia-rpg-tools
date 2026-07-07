// ═══════════════════════════════════════════════════════════════════════════
// BOOT FLAGS
// ═══════════════════════════════════════════════════════════════════════════
// Table Display Mode — the chromeless, player-safe second window the referee
// drags onto the table TV (js/93-display.js). Declared here in the first
// module so every later module can branch on it. This is the app's ONLY boot
// query param — keep it that way (see docs/table-presentation-plan.md §2.2).
const DISPLAY_MODE = new URLSearchParams(location.search).has('display');

// Phone player-lock — handsets default to the player view (the referee runs the
// table from a laptop/TV, and referee chrome crowds a small screen). A per-device
// Settings toggle stores aurelia_phone_ref='1' to opt this phone back into full
// referee mode. Defined in the first module so isReferee() (js/55) and the boot
// pm-active guard (js/30) can both use it. Desktops/tablets never carry is-phone,
// so phonePlayerLock() is always false for them.
function phoneRefereeEnabled(){ try { return localStorage.getItem('aurelia_phone_ref') === '1'; } catch(e){ return false; } }
function phonePlayerLock(){ try { return document.documentElement.classList.contains('is-phone') && !phoneRefereeEnabled(); } catch(e){ return false; } }

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM DATA
// ═══════════════════════════════════════════════════════════════════════════
const BASE_BODIES_AUROS = [
  {
    "id": "auros",
    "name": "Auros",
    "type": "K3 V Orange Dwarf · Primary Star",
    "tag": null,
    "color": "#E07030",
    "orbitAU": "—",
    "uwpString": "—",
    "diameter": "~1.08 M☉ diameter",
    "period": "—",
    "isMoon": false,
    "isStar": true,
    "displayRadius": 18,
    "desc": "A calm, long-lived orange dwarf approximately 78% the mass of Sol. Its light gives Aurelia's sky its distinctive copper tint and bathes the inner system in warm amber-gold. K-type stars are considered ideal for long-term colonisation: low flare activity, extended main-sequence lifespan, stable output for billions of years.\n\nThe Hegemony chose this system deliberately. Nothing about Aurelia was an accident.",
    "readAloud": null,
    "orbitPos": null
  },
  {
    "id": "scoria",
    "name": "Scoria",
    "type": "Terrestrial · Scorched Rock",
    "tag": "FLAVOUR",
    "color": "#887755",
    "orbitAU": "0.28 AU",
    "uwpString": "X100000-0",
    "diameter": "~4,800 km",
    "period": "48 standard days",
    "isMoon": false,
    "isStar": false,
    "displayRadius": 7,
    "desc": "A tidally locked inner world — ~430°C on the day side, -180°C on the night side. No atmosphere worth naming. A dead archive of early system formation, the night side covered in concentric impact craters.",
    "readAloud": null,
    "orbitPos": 1
  },
  {
    "id": "aurelia",
    "name": "Aurelia",
    "type": "Terrestrial · Jewel World",
    "tag": "CAMPAIGN HUB",
    "color": "#4A90D9",
    "orbitAU": "0.71 AU",
    "uwpString": "B867976-C",
    "diameter": "~11,400 km",
    "period": "214 standard days",
    "isMoon": false,
    "isStar": false,
    "displayRadius": 11,
    "desc": "The campaign's heart. A warm, dense world with extensive ocean coverage, a copper-tinted sky, and a population of 800 million in coastal arcologies and the deep-water city known as the Cradle.\n\nThe Hegemony's showpiece. Every promotional image shows the turquoise south coast and the twin peaks of the Spire Range.\n\nThe atmosphere has a classified taint: long-term unfiltered exposure causes progressive respiratory degradation over 20–30 years. The data is suppressed. The Cleaners know. The surface population does not.",
    "readAloud": "Aurelia from orbit: the atmosphere catches Auros's orange light and scatters it into something the colour of a lit copper kettle. The night side shows city-glow in chains along the coastline. The orbital station sits at L2, permanently in Aurelia's shadow.",
    "orbitPos": 2
  },
  {
    "id": "pallor",
    "name": "Pallor",
    "type": "Moon · Tidally Locked",
    "tag": "FLAVOUR",
    "color": "#B0B0B0",
    "orbitAU": "Aurelia moon",
    "uwpString": "Y200000-0",
    "diameter": "~2,400 km",
    "period": "18.3 standard days",
    "isMoon": true,
    "parentId": "aurelia",
    "isStar": false,
    "desc": "Aurelia's sole natural satellite — small, grey, airless, tidally locked. Not beautiful enough to feature in Hegemony promotional material.\n\nThere is a decommissioned relay station on the far side that has been dark for twenty years. The RSR uses it for dead drops.",
    "readAloud": null,
    "orbitPos": null
  },
  {
    "id": "greymantle",
    "name": "Greymantle",
    "type": "Terrestrial · Ice-Rock",
    "tag": "FLAVOUR",
    "color": "#9999AA",
    "orbitAU": "1.8 AU",
    "uwpString": "D200100-4",
    "diameter": "~6,200 km",
    "period": "~2.4 standard years",
    "isMoon": false,
    "isStar": false,
    "displayRadius": 8,
    "desc": "A cold, thin-atmosphered mid-system world with ~100 people in a pressurised way-station. Greymantle's main industry is being on the route between Aurelia and the Veil — Class D starport, refuelling tanks, two people who don't ask questions about cargo manifests.",
    "readAloud": null,
    "orbitPos": 3
  },
  {
    "id": "veil",
    "name": "The Veil",
    "type": "Asteroid Belt",
    "tag": "ADVENTURE HOOK",
    "color": "#8B7355",
    "orbitAU": "1.3 AU",
    "uwpString": "E000200-5",
    "diameter": "Diffuse belt, ~0.4 AU wide",
    "period": "~1.8 standard years (inner edge)",
    "isMoon": false,
    "isStar": false,
    "beltDensity": 420,
    "desc": "A dense asteroid belt — remnant of a planet that failed to coalesce, or perhaps one that was broken apart. At certain orbital positions it creates a faint dust haze visible from Aurelia at dawn.\n\nSmall, unlicensed population of ~300 belt miners, scavengers, and people avoiding questions. Their settlement: Cairn Station, Law Level 0.",
    "readAloud": "The belt doesn't look like much at approach — scattered rocks catching Auros's amber light. Then the density increases and navigation gets serious. Cairn Station announces itself with running lights and a comms challenge.",
    "orbitPos": 4
  },
  {
    "id": "tanath",
    "name": "Tanath",
    "type": "Gas Giant · Major",
    "tag": "ADVENTURE HOOK",
    "color": "#C87941",
    "orbitAU": "5.4 AU",
    "uwpString": "D——0164-8",
    "diameter": "~140,000 km (est.)",
    "period": "12.3 standard years",
    "isMoon": false,
    "isStar": false,
    "displayRadius": 18,
    "ringStyle": "major",
    "desc": "A warm, massive gas giant banded in deep amber and rust-red — a miniature echo of Auros itself. OmniSynth's Extraction Rig Tanath-7 operates in the upper atmosphere, extracting fuel for sale. Technically a licensed commercial operation. In practice also a data relay, crew rotation point, and a place to fence things without clean provenance.",
    "readAloud": "Tanath fills the screen even at standard approach distance. Deep amber striations over rust-red, white ammonia clouds at the poles in slow spirals. At the terminator, the night side glows faintly from internal heat.",
    "orbitPos": 5
  },
  {
    "id": "esk",
    "name": "Esk",
    "type": "Moon · Sensor Array",
    "tag": "RESTRICTED",
    "color": "#4A90D9",
    "orbitAU": "Tanath moon I",
    "uwpString": "C100089-9",
    "diameter": "~3,800 km",
    "period": "7.1 standard days",
    "isMoon": true,
    "parentId": "tanath",
    "isStar": false,
    "desc": "A small, airless moon with a large Hegemony sensor array watching the outer system — jump emergence points, approaching traffic. Eight Navy personnel on six-week rotations. They tend not to volunteer twice.",
    "readAloud": null,
    "orbitPos": null
  },
  {
    "id": "nara",
    "name": "Nara",
    "type": "Moon · Rest Station",
    "tag": "FLAVOUR",
    "color": "#9B7B5B",
    "orbitAU": "Tanath moon II",
    "uwpString": "D310112-7",
    "diameter": "~4,200 km",
    "period": "14.4 standard days",
    "isMoon": true,
    "parentId": "tanath",
    "isStar": false,
    "desc": "A pressurised rest dome OmniSynth built for Tanath-7 contractor rotation. Utilitarian — bunks, a rec room, a bar that serves two things and neither of them well. ~20 people at any time.",
    "readAloud": null,
    "orbitPos": null
  },
  {
    "id": "darkmoon",
    "name": "The Dark Moon",
    "type": "Moon · CLASSIFIED",
    "tag": "CLASSIFIED",
    "color": "#2A2A3A",
    "orbitAU": "Tanath moon III (unlisted)",
    "uwpString": "X200000-0",
    "diameter": "~3,100 km",
    "period": "22.7 standard days (retrograde)",
    "isMoon": true,
    "parentId": "tanath",
    "isStar": false,
    "decoration": "cluster",
    "desc": "Not on standard charts. Not in the Hegemony's public registry. Not visible on the orbital station's navigation display.\n\nRetrograde orbit — it moves opposite to the other Tanath moons, which means it formed elsewhere, was captured, or was placed there. The Hegemony sensor array on Esk is deliberately pointed away from it.",
    "readAloud": "There is nothing on sensors where there should be nothing. Then — briefly, for eleven seconds — there is something. Then there is nothing again. The sensor logs do not retain the eleven seconds. This is not a glitch.",
    "orbitPos": null
  },
  {
    "id": "ouros",
    "name": "Ouros",
    "type": "Ice Giant · Outer System",
    "tag": "FLAVOUR",
    "color": "#2AABB8",
    "orbitAU": "14.2 AU",
    "uwpString": "X——0000-0",
    "diameter": "~38,000 km",
    "period": "53.4 standard years",
    "isMoon": false,
    "isStar": false,
    "displayRadius": 13,
    "ringStyle": "subtle",
    "desc": "A pale blue-green ice giant in the deep outer system. No installations. No traffic. Three small unnamed moons, none surveyed beyond preliminary pass data. The Hegemony has no interest in the deep outer system at present. The Archon Collective may.",
    "readAloud": null,
    "orbitPos": 6
  }
];

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM-SCOPED BODY MODEL
// ═══════════════════════════════════════════════════════════════════════════
// BASE_BODIES_AUROS is the canonical hardcoded data for the Auros system.
// To allow other star systems to be built later (each a node on the Orion Arm
// galaxy map), bodies live inside a system wrapper and all design-mode body
// edits are namespaced by system id. Today there is exactly one system —
// 'auros' — but the storage schema and renderer are already multi-system
// ready, so dropping in a second system is a data change, not a rewrite.
const SYSTEMS = {
  auros: { id:'auros', name:'Auros', base: BASE_BODIES_AUROS }
};
let currentSystemId = 'auros';

// ═══════════════════════════════════════════════════════════════════════════
// FUEL RULES  —  Mongoose Traveller 2e fuel model (single tunable config)
// ───────────────────────────────────────────────────────────────────────────
// One config object so the referee can tune the fuel maths without touching any
// logic. Consumed by the ship panel (js/75-ship.js · shipFuelForTrip) and the
// hex-jump plotter (js/10-galaxy.js · legFuel), which now both call jumpFuel()
// below instead of inlining the numbers. Defined in this earliest module so
// every later module can reference it directly (load-order safe).
//
//   Jump fuel (MgT2e core): 10% of hull tonnage per parsec jumped, EXACT tons —
//     J-2 in a 200 t hull = 0.10 × 200 × 2 = 40 t. No house rounding.
//   Lane factor: a HOUSE rule of the hex galaxy (surveyed jump lanes cost −15%),
//     NOT MgT2e. Kept as a constant so the referee can set it to 1 for pure RAW.
//   operatingFuel: power-plant / ongoing consumption (MgT2e ≈ 1 t of fuel per ton
//     of power plant per 4 weeks). This app doesn't track power-plant tonnage, so
//     it's approximated as a fraction of hull per in-jump week. DEFAULT OFF so the
//     referee's already-tested jump-feasibility numbers are unchanged; flip
//     enabled:true (and verify the fraction vs High Guard) to model it.
const FUEL_RULES = {
  jumpFuelPerParsecFraction: 0.10,   // 10% of hull tonnage, per parsec
  laneFuelFactor: 0.85,              // HOUSE (non-RAW): surveyed jump lane discount; 1 = pure MgT2e
  operatingFuel: {
    enabled: false,                  // OFF by default — turning on adds per-week power-plant burn to every jump
    powerPlantFractionOfHull: 0.10,  // assumed power-plant size ≈ 10% of hull (verify vs your High Guard build)
    tonsPerPPTonPer4Weeks: 1,        // MgT2e standard: 1 t fuel per ton of power plant per 4 weeks
    weeksPerJump: 1                  // one week in jumpspace per jump
  }
};
// Fuel for one jump — EXACT tons. fraction × hull × parsecs, optionally ×lane.
function jumpFuel(tonnage, parsecs, onLane){
  const t = Number(tonnage) || 0, p = Number(parsecs) || 0;
  let f = FUEL_RULES.jumpFuelPerParsecFraction * t * p;
  if(onLane) f *= FUEL_RULES.laneFuelFactor;
  return f;
}
// Ongoing power-plant fuel over `weeks` of operation (0 unless enabled).
function operatingFuel(tonnage, weeks){
  const o = FUEL_RULES.operatingFuel;
  if(!o || !o.enabled) return 0;
  const t = Number(tonnage) || 0, w = Number(weeks) || 0;
  return (o.powerPlantFractionOfHull * t) * o.tonsPerPPTonPer4Weeks * (w / 4);
}

// ── Trader convoy name labels (galaxy trade layer) ──────────────────────────
// Convoy labels (.hx-trade-lbl) live INSIDE the zooming scene, so left alone
// they scale with the map and balloon at high zoom. scaleTraderLabels() in
// js/10-galaxy.js counter-scales them off this config: it targets an on-screen
// px size, then divides back out by the live map scale so ONE CSS-var write
// (--hx-trader-font) restyles every label. Tunable, no inline magic numbers.
//   BASE:  the label's pre-2× on-screen px at default zoom (the historical
//          .hx-trade-lbl size). SCALE×BASE is the resting on-screen size.
//   SCALE: multiple of BASE to render at default zoom (2 = twice the old size).
//   ZOOM_EXPONENT: 1 = constant on-screen size (default); >1 = labels shrink on
//          screen as you zoom in; 0 = old scale-with-map behaviour.
//   MIN_PX / MAX_PX: clamp the effective on-screen px so extreme zoom in/out
//          stays sane.
const TRADER_LABEL = { BASE: 8.5, SCALE: 2, ZOOM_EXPONENT: 1, MIN_PX: 8, MAX_PX: 28 };

// ═══════════════════════════════════════════════════════════════════════════
// CLIENT ERROR TELEMETRY  —  on-device ring buffer + ref-viewable upload queue
// ───────────────────────────────────────────────────────────────────────────
// pushErr() records an error to a small localStorage ring buffer (aurelia_errlog)
// so recent client failures survive on a device, AND parks a copy on a local
// upload queue (aurelia_err_upload) which js/50-supabase.js drains to the
// error_log table (migration 0005). 00-core-data can't call the data layer at
// load time (50 loads later), so the two are decoupled through localStorage —
// the same shape as the offline write-through queue. Everything here is wrapped
// so telemetry can NEVER break the app: a throw inside pushErr is swallowed, and
// if the whole feature fails the app behaves exactly as it does today.
const ERRLOG_KEY     = 'aurelia_errlog';       // on-device ring buffer
const ERR_UPLOAD_KEY = 'aurelia_err_upload';   // pending uploads (50-supabase drains)
const ERRLOG_MAX     = 50;                      // ring buffer + queue hard cap (an error loop can't grow either unbounded)

function pushErr(message, stack, context){
  try {
    const ts = Date.now();
    const msg = String(message == null ? '' : message).slice(0, 1000);
    const stk = String(stack == null ? '' : stack).slice(0, 2048);   // 2KB cap before it ever leaves the device
    const ctx = (context && typeof context === 'object') ? context : (context != null ? { note: String(context) } : {});
    // 1. On-device ring buffer (newest last), capped at ERRLOG_MAX.
    let ring = [];
    try { ring = JSON.parse(localStorage.getItem(ERRLOG_KEY) || '[]'); if(!Array.isArray(ring)) ring = []; } catch(e){ ring = []; }
    ring.push({ ts, message: msg, stack: stk, context: ctx });
    if(ring.length > ERRLOG_MAX) ring = ring.slice(ring.length - ERRLOG_MAX);
    try { localStorage.setItem(ERRLOG_KEY, JSON.stringify(ring)); } catch(e){}
    // 2. Upload queue — annotated with who/where/version so the flush is a dumb POST.
    let q = [];
    try { q = JSON.parse(localStorage.getItem(ERR_UPLOAD_KEY) || '[]'); if(!Array.isArray(q)) q = []; } catch(e){ q = []; }
    q.push({
      created_at:  new Date(ts).toISOString(),
      player:      (typeof myIdentity !== 'undefined' && myIdentity) ? String(myIdentity).slice(0, 120) : null,
      app_version: (function(){ try { const el = document.getElementById('build-version'); return el ? el.textContent.trim().slice(0, 40) : null; } catch(e){ return null; } })(),
      ua:          (typeof navigator !== 'undefined' && navigator.userAgent) ? String(navigator.userAgent).slice(0, 400) : null,
      message:     msg,
      stack:       stk,
      context:     ctx
    });
    if(q.length > ERRLOG_MAX) q = q.slice(q.length - ERRLOG_MAX);
    try { localStorage.setItem(ERR_UPLOAD_KEY, JSON.stringify(q)); } catch(e){}
  } catch(e){ /* telemetry must never throw into the app */ }
}

// Global safety net: capture uncaught errors + unhandled promise rejections.
// Passive — never calls preventDefault(), so nothing about existing behaviour
// changes; it only feeds pushErr. Wrapped so a missing window/listener API just
// leaves telemetry local-only. (Deferred callbacks — load-order safe.)
try {
  if(typeof window !== 'undefined' && window.addEventListener){
    window.addEventListener('error', function(ev){
      try { pushErr(ev && ev.message, ev && ev.error && ev.error.stack, { src: ev && ev.filename, line: ev && ev.lineno, col: ev && ev.colno }); } catch(e){}
    });
    window.addEventListener('unhandledrejection', function(ev){
      try { const r = ev && ev.reason; pushErr(r && r.message ? r.message : ('unhandledrejection: ' + r), r && r.stack, { kind: 'unhandledrejection' }); } catch(e){}
    });
  }
} catch(e){ /* no window / listener support — telemetry stays on-device only */ }

// ═══════════════════════════════════════════════════════════════════════════
// RICH-TEXT WHITELIST SANITISER  —  session-planner prose (the ONE place that
// stores + renders HTML instead of escaping it)
// ───────────────────────────────────────────────────────────────────────────
// The session planner (js/97) lets the referee write lightly-formatted prose
// (bold / italic / lists / headings) and inline hyperlinks. That content is
// referee-only and NEVER reaches a player device, but we still whitelist it on
// every commit AND every render, so a hostile paste can't persist a script node
// or an event handler. Deliberately tiny tag/attribute allow-list; anything
// outside it is unwrapped to its text (or dropped entirely, for script/style).
// Internal links carry a `data-link` ref (scene:/quest:/location:/pdf:/url:);
// external links keep only a safe http(s)/mailto href. Browser-only (DOMParser);
// callers get plain stripped text if the DOM API is somehow unavailable.
const RICH_TAGS = { B:1, STRONG:1, I:1, EM:1, U:1, P:1, BR:1, UL:1, OL:1, LI:1, H3:1, H4:1, BLOCKQUOTE:1, SPAN:1, DIV:1, A:1 };
const RICH_DROP = { SCRIPT:1, STYLE:1, NOSCRIPT:1, IFRAME:1, OBJECT:1, EMBED:1, TEMPLATE:1, LINK:1, META:1, TITLE:1, SVG:1 };
const RICH_HREF_OK = /^(https?:|mailto:)/i;
const RICH_LINK_OK = /^(scene|quest|location|pdf|url):/i;

function sanitizeRich(html){
  const src = String(html == null ? '' : html);
  if(!src) return '';
  if(typeof DOMParser === 'undefined') return src.replace(/<[^>]*>/g, ''); // no DOM → strip to text
  let doc;
  try { doc = new DOMParser().parseFromString('<body>' + src + '</body>', 'text/html'); }
  catch(e){ return src.replace(/<[^>]*>/g, ''); }
  const clean = (node) => {
    // Snapshot first: we mutate childNodes as we walk.
    Array.prototype.slice.call(node.childNodes).forEach(child => {
      if(child.nodeType === 3) return;                                  // text — keep
      if(child.nodeType !== 1){ node.removeChild(child); return; }      // comment/other — drop
      const tag = child.tagName;
      if(RICH_DROP[tag]){ node.removeChild(child); return; }            // script/style — drop content and all
      if(!RICH_TAGS[tag]){                                              // other disallowed — unwrap, keep text
        clean(child);
        while(child.firstChild) node.insertBefore(child.firstChild, child);
        node.removeChild(child);
        return;
      }
      // Allowed element: strip every attribute except a safe href / data-link on <a>.
      Array.prototype.slice.call(child.attributes).forEach(a => {
        const name = a.name.toLowerCase();
        if(tag === 'A' && name === 'data-link' && RICH_LINK_OK.test((a.value || '').trim())) return;
        if(tag === 'A' && name === 'href' && RICH_HREF_OK.test((a.value || '').trim())) return;
        child.removeAttribute(a.name);
      });
      if(tag === 'A' && child.getAttribute('href')){                    // external link opens safely
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer');
      }
      clean(child);                                                     // recurse
    });
  };
  clean(doc.body);
  return doc.body.innerHTML;
}

// Plain-text projection of rich HTML — recap/export lines, graph popovers, previews.
function richToPlain(html){
  const src = String(html == null ? '' : html);
  if(!src) return '';
  if(typeof DOMParser !== 'undefined'){
    try {
      const doc = new DOMParser().parseFromString('<body>' + src + '</body>', 'text/html');
      return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    } catch(e){ /* fall through */ }
  }
  return src.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}


#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// build-agnostic.mjs · generate the franchise-agnostic "SciFi VTT" distribution
//
// The app is already built on a Campaign-Pack engine (js/05-campaign-pack.js):
// generic rendering/Design-Mode/panels code, with Archon Gambit as merely the
// DEFAULT pack's data. This tool produces a clean, public-repo-ready copy of the
// engine seeded with a GENERIC sample sector — no Archon Gambit lore or data.
//
//   node tools/build-agnostic.mjs [outDir]     # default: ./dist-scifivtt
//   node tools/build-agnostic.mjs --check       # build to a temp dir, run the
//                                                # lore leak-guard, exit nonzero
//                                                # if any AG token survives
//
// What it does, in order, per file:
//   1. Copy an ALLOWLIST of deployable files (engine + generic assets) to outDir.
//   2. Inject GENERIC sample content into the data literals (galaxy, station,
//      bodies, locations, crew) — replacing the Archon Gambit constants.
//   3. Apply string transforms: rename the `aurelia_` storage prefix → `vtt_`,
//      neutralise branding/terminology/faction/morality lore.
//   4. Write a fresh agnostic README, LICENSE, config.example.js, .gitignore.
//   5. Run the lore leak-guard over the output.
//
// DESIGN NOTE — anchor ids. The engine pins three structural ids at boot across
// six files (currentSystemId='auros', station/node/body 'aurelia', station
// interior 'aurelia-station'). Renaming them risks subtle boot breakage, so this
// v1 KEEPS them as opaque internal keys and reuses them in the generic content.
// They are lowercase code identifiers only — never shown to a user, never in any
// data prose — so the leak-guard allows them while flagging the display forms
// (`Aurelia`, `Auros`) and all other AG lore. Renaming the anchor ids to generic
// slugs is a clean follow-up.
//
// Deterministic: fixed RNG seed → identical sample sector every run.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const outArg = process.argv.slice(2).find(a => !a.startsWith('--'));
const OUT = checkOnly
  ? join(repoRoot, '.agnostic-check-tmp')
  : resolve(repoRoot, outArg || 'dist-scifivtt');

const APP_NAME = 'SciFi VTT';
const CAMPAIGN_TITLE = 'Sample Sector';
const CAMPAIGN_ID = 'sample-sector';

// ─────────────────────────────────────────────────────────────────────────────
// 1. FILE SELECTION
// ─────────────────────────────────────────────────────────────────────────────
// Deployable engine + generic assets copied verbatim (then transformed).
const COPY_FILES = [
  'index.html', 'setup.html', 'manifest.webmanifest', 'sw.js',
  '.nojekyll', '.gitattributes',
];
const COPY_DIRS = ['css', 'js', 'vendor', 'icons', 'textures'];

// Files/dirs deliberately NOT shipped (Archon Gambit specifics, private config,
// campaign docs, advanced backend, and repo dev tooling). Listed for the record;
// the copy step is an allowlist, so anything not named above is simply omitted:
//   config.js · docs/ · supabase/ · tools/ · .github/ · .claude/
//   'Ship Sheet 2026_printa4.pdf' · hex_jump_prototype.html

// ─────────────────────────────────────────────────────────────────────────────
// 2. GENERIC SAMPLE CONTENT (zero Archon Gambit lore)
// ─────────────────────────────────────────────────────────────────────────────
function mulberry(seed){ return function(){ seed|=0; seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
const rng = mulberry(31415926);
const rnd = () => rng();
const pick = a => a[Math.floor(rnd()*a.length)];

// Generic faction registry (replaces GALAXY_FACTIONS). Ids are data-only — no
// engine code branches on them — so they are freely invented.
const FACTIONS = {
  union:      { name:'Stellar Union',        color:'#00e5ff' },
  frontier:   { name:'Frontier Reaches',     color:'#aadd44' },
  combine:    { name:'Mercantile Combine',   color:'#6699ff' },
  collective: { name:'Workers’ Collective', color:'#ff6666' },
  dominion:   { name:'The Dominion',         color:'#cc88ff' },
  remnant:    { name:'Precursor Remnant',    color:'#aabbcc' },
  drift:      { name:'The Drift',            color:'#8855cc' },
  independent:{ name:'Independent',          color:'#66bbaa' },
  uncharted:  { name:'Uncharted',            color:'#9fb0c8' },
};

const DESC_ROLE = {
  union:     ['a core Union administrative world','a Union naval anchorage','a chartered Union colony','a Union agricultural world'],
  frontier:  ['a hardscrabble frontier settlement','a frontier prospecting claim','a frontier waystation','a homesteader colony'],
  combine:   ['a Combine company world','a Combine trade depot','a corporate mining concession','a Combine automated foundry'],
  collective:['a collective commune','a collectivised mining world','a workers’ labour world','a collective frontier soviet'],
  dominion:  ['a Dominion border fortress','a Dominion garrison world','a Dominion protectorate','a Dominion staging world'],
  remnant:   ['a dormant Precursor relay','a silent Precursor site','an abandoned Precursor installation','a half-lit Precursor waystation'],
  drift:     ['a Drift anomaly-world','a strange Drift research outpost','a world where the Drift lingers','a quiet Drift enclave'],
  independent:['an independent free port','a free-trader waystation','a belter refinery outpost','a smugglers’ haven','an independent shipyard'],
  uncharted: ['an unsurveyed system','a system known only from old charts','a rumoured but unconfirmed world'],
};

const CATALOG = ['Gliese','GJ','HD','HIP','Wolf','Ross','LHS','Luyten','Struve','Lalande','Kruger','Kapteyn','Tycho','Kepler'];
const LBL_ROOT = ['Ashford','Kestrel','Tantalus','Verdance','Cinder','Halcyon','Vantage','Sable','Ferrum','Concord','Redoubt','Marrow','Kiln','Solace','Vireo','Anvil','Providence','Ardent','Corvus','Draeger','Emberly','Grendel','Harrow','Ilium','Jubilee','Kavan','Lachlan','Morrow','Nadir','Oxley','Pallas','Quillon','Rhodes','Torrent','Umbra','Warden','Yarrow','Zenobia'];
const LBL_SUF = ['Landing','Reach','Station','Hold','Gate','Deep','Verge','Drift','Claim','Outpost','Depot','Watch','Terminus','Anchorage'];

// Home system stays on the anchor ids (system 'auros', world 'aurelia'). Only
// the DISPLAY names are generic.
const HOME_SYS_ID = 'auros';
const HOME_NODE_ID = 'aurelia';

function genGalaxy(count){
  const used = new Set([HOME_NODE_ID]);
  const usedNames = new Set(), usedLabels = new Set();
  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const uid = seed => { let id=slug(seed), n=2; while(used.has(id)){ id=slug(seed)+'-'+n++; } used.add(id); return id; };
  const catName = () => { for(let i=0;i<200;i++){ const nm=pick(CATALOG)+' '+(100+Math.floor(rnd()*9800)); if(!usedNames.has(nm)){ usedNames.add(nm); return nm; } } return 'HD '+(10000+Math.floor(rnd()*89999)); };
  const coinLabel = () => { for(let i=0;i<40;i++){ const s=rnd(); let l = s<0.5 ? pick(LBL_ROOT)+' '+pick(LBL_SUF) : pick(LBL_ROOT); if(!usedLabels.has(l)){ usedLabels.add(l); return l; } } const l=pick(LBL_ROOT)+' '+(2+Math.floor(rnd()*9)); usedLabels.add(l); return l; };

  // The home node — anchor ids, generic display. Central position on the canvas.
  const home = { id:HOME_NODE_ID, systemId:HOME_SYS_ID, name:'Epsilon Eridani', x:400, y:360,
    faction:'union', label:'Concord Waypoint', connections:[],
    desc:'Concord Waypoint — the sample sector’s starting system: a Union administrative world and orbital station. Replace this whole sector in Design Mode with your own.' };

  const facs = Object.keys(FACTIONS).filter(f => f !== 'uncharted');
  const gen = [home];
  for(let i=0;i<count;i++){
    const fac = pick(facs);
    const ang = rnd()*Math.PI*2, rad = 60 + rnd()*300;
    const x = Math.max(40, Math.min(760, Math.round(400 + Math.cos(ang)*rad)));
    const y = Math.max(40, Math.min(680, Math.round(360 + Math.sin(ang)*rad)));
    const name = catName();
    const label = rnd()<0.55 ? coinLabel() : name;
    const id = uid(label);
    gen.push({ id, name, x, y, faction:fac, label, connections:[], desc:`${label} — ${pick(DESC_ROLE[fac])}.` });
  }
  // Wire jump lanes: connect each system to its 2 nearest neighbours.
  const d2 = (a,b)=>(a.x-b.x)**2+(a.y-b.y)**2;
  gen.forEach(g => {
    const near = gen.filter(o=>o.id!==g.id).sort((a,b)=>d2(g,a)-d2(g,b)).slice(0,2);
    g.connections = [...new Set(near.map(o=>o.id))];
  });
  // Connectivity: union-find, attach stray components to the largest.
  const idx = new Map(gen.map((n,i)=>[n.id,i]));
  const connFix = () => {
    const parent = gen.map((_,i)=>i);
    const find = a=>{ while(parent[a]!==a){ parent[a]=parent[parent[a]]; a=parent[a]; } return a; };
    gen.forEach((n,i)=>(n.connections||[]).forEach(c=>{ if(idx.has(c)){ const a=find(i),b=find(idx.get(c)); if(a!==b) parent[a]=b; } }));
    const comp = {}; gen.forEach((n,i)=>{ const r=find(i); (comp[r]=comp[r]||[]).push(n); });
    const comps = Object.values(comp).sort((a,b)=>b.length-a.length);
    if(comps.length<=1) return false;
    const main = comps[0];
    for(let k=1;k<comps.length;k++){
      let best=null; comps[k].forEach(n=>main.forEach(o=>{ const d=d2(n,o); if(!best||d<best.d) best={n,o,d}; }));
      if(best){ best.n.connections=[...new Set([...(best.n.connections||[]), best.o.id])]; best.o.connections=[...new Set([...(best.o.connections||[]), best.n.id])]; }
    }
    return true;
  };
  let guard=0; while(connFix() && guard++<40){}
  return gen;
}

// Home-system bodies (BASE_BODIES_AUROS). Star id 'auros', world id 'aurelia'
// are anchors; the two flavour bodies use generic ids.
const BODIES = [
  { id:'auros', name:'Helion', type:'G2 V Yellow Star · Primary Star', tag:null, color:'#E0B040',
    orbitAU:'—', uwpString:'—', diameter:'~1.0 M☉ diameter', period:'—',
    isMoon:false, isStar:true, displayRadius:18,
    desc:'A stable main-sequence yellow star at the heart of the sample system. Sample data — replace it with your own primary in Design Mode.', readAloud:null, orbitPos:null },
  { id:'ember', name:'Ember', type:'Terrestrial · Scorched Rock', tag:'FLAVOUR', color:'#887755',
    orbitAU:'0.3 AU', uwpString:'Y100000-0', diameter:'~4,900 km', period:'52 standard days',
    isMoon:false, isStar:false, displayRadius:7,
    desc:'A tidally locked inner world — baked on the day side, frozen on the night side. No atmosphere worth naming.', readAloud:null, orbitPos:1 },
  { id:'aurelia', name:'Concord', type:'Terrestrial · Garden World', tag:'HOME', color:'#4A90D9',
    orbitAU:'0.9 AU', uwpString:'B867876-B', diameter:'~11,600 km', period:'240 standard days',
    isMoon:false, isStar:false, displayRadius:11,
    desc:'The sample sector’s starting world — a temperate garden planet with wide oceans and a population in coastal cities. This is placeholder content: rewrite it, or delete the sample campaign and start your own.', readAloud:null, orbitPos:2 },
  { id:'talon', name:'Talon', type:'Gas Giant', tag:'FLAVOUR', color:'#B5895A',
    orbitAU:'3.4 AU', uwpString:'—', diameter:'~48,000 km', period:'6.1 standard years',
    isMoon:false, isStar:false, displayRadius:14,
    desc:'A banded gas giant with a shallow gravity well — a convenient fuel-skimming stop for ships passing through.', readAloud:null, orbitPos:3 },
];

// Home-world locations (BASE_LOCATIONS). Keyed system 'auros' → world 'aurelia'.
// The 'station' location's interiorId 'aurelia-station' is an anchor id.
const LOCATIONS = {
  auros: {
    aurelia: [
      { id:'station', name:'Concord Orbital Station', surface:false, sx:0, sy:-1.806, color:'#4A90D9',
        isStation:true, interiorId:'aurelia-station', elevatorTo:'capitol', tag:'ACTIVE LOCATION',
        desc:'A mid-sized orbital platform serving commercial docking, transit, and administration. The crew’s current location. Sample content.' },
      { id:'capitol', name:'Concord Capitol', surface:true, sx:-0.02, sy:-0.44, color:'#D4A843', tag:'CAPITAL',
        desc:'The administrative capital — a purpose-built coastal city of towers and broad plazas. Placeholder content.' },
      { id:'harbour', name:'Deepwater Harbour', surface:true, sx:0.3, sy:0.06, color:'#2AABB8', tag:'PORT',
        desc:'A working sea-port and shipyard on the equatorial coast. Placeholder content — replace with your own.' },
      { id:'highlands', name:'The Highlands', surface:true, sx:-0.44, sy:0.5, color:'#9999AA', tag:'LANDMARK',
        desc:'A dramatic upland region of peaks and terraced valleys, popular with travellers. Placeholder content.' },
    ],
  },
};

// Station interior (MAIN). Room ids are generic; currentStationId 'aurelia'
// resolves here.
const STATION = {
  docking: {
    label:'Docking Hub', sub:'Arrival ring · Hangar bays', tag:'ARRIVAL',
    tagBg:'#1a2650', tagColor:'#5b8ef0', ac:'#185FA5',
    read:'The docking arm mates with a soft chime. Beyond it a wide, evenly lit corridor runs toward the concourse. A dockmaster’s office overlooks the hangar floor. Sample content — edit or replace in Design Mode.',
    conn:['concourse','ops'],
    subs:{
      'landing-pad':{ label:'Landing Pad — Bay 6', sub:'Where your ship sits', read:'A mid-sized berth on the docking ring. Fuel and power umbilicals run from the bay wall to the ship’s service ports.',
        ship:{ name:'The Wayfarer', lines:[
          ['Hull','100-ton streamlined hull, atmospheric capable. Sample ship — edit on the Ship sheet.'],
          ['Condition','Well-used and honest. Sample data.'],
          ['Drive','2G manoeuvre, jump-2 capable. Sample data.'],
        ] } },
      'dockmaster-office':{ label:'Dockmaster’s Office', sub:'Overlooking the bays', read:'A glass-fronted room looking out over the hangar floor. Sample content.' },
    },
  },
  concourse: {
    label:'Main Concourse', sub:'Promenade · shops & lounge', tag:'EXPLORATION',
    tagBg:'#2e1f0a', tagColor:'#d4913a', ac:'#BA7517',
    read:'The station’s heart — a high-ceilinged promenade running from the docks to the observation dome, lined with shopfronts and a bar. Sample content.',
    conn:['docking','ops','medical','engineering'],
    subs:{
      promenade:{ label:'The Promenade', sub:'Main thoroughfare', read:'A wide central walkway with benches at intervals. Sample content.' },
      lounge:{ label:'Observation Lounge', sub:'Outer windows', read:'A bar along the outer hull with floor-to-ceiling windows onto the stars and the world below. Sample content.' },
      exchange:{ label:'The Exchange', sub:'Shops & services', read:'A cluster of storefronts around a small atrium. Sample content.' },
      dome:{ label:'Observation Dome', sub:'End of the promenade', read:'A hemispheric observation space at the station’s outermost point. Sample content.' },
    },
  },
  ops: {
    label:'Operations & Security', sub:'Upper ring · Station control', tag:'RESTRICTED',
    tagBg:'#1e1e2e', tagColor:'#8b91a8', ac:'#534AB7',
    read:'Station operations and security. Not on the public map — monitors, an armoury, and the administrative offices. Sample content.',
    conn:['docking','concourse'],
    subs:{
      guardhouse:{ label:'Guardhouse', sub:'Security hub', read:'Banks of monitors covering the public areas. Sample content.' },
      admin:{ label:'Administration', sub:'Records & berth control', read:'Open-plan offices handling berth allocation and manifests. Sample content.' },
    },
  },
  medical: {
    label:'Medical Suite', sub:'Tertiary ring', tag:'SERVICES',
    tagBg:'#0f2e20', tagColor:'#4caf82', ac:'#0F6E56',
    read:'A clean, quiet clinic with its own atmospheric processing. Sample content.',
    conn:['concourse','engineering'], subs:{},
  },
  engineering: {
    label:'Engineering Level', sub:'Service tunnels · below the ring', tag:'UNDERDECK',
    tagBg:'#2e1010', tagColor:'#d45050', ac:'#A32D2D',
    read:'The station without its costume — real recycled air, functional lighting, and the machinery that keeps the ring alive. Sample content.',
    conn:['concourse','medical'],
    subs:{
      'life-support':{ label:'Life Support', sub:'Atmospheric processing', read:'Rows of atmospheric processors running the length of the room. Sample content.' },
      reactor:{ label:'Reactor Level', sub:'Power systems', read:'The fusion plant that powers the station, in a monitoring cage. Sample content.' },
      fabrication:{ label:'Fabrication', sub:'Repair & printing', read:'A fabrication floor with industrial printers and a machining station. Sample content.' },
    },
  },
};

// Generic pregen crew (KNOWN_CHARACTERS) — invented names, no AG identities.
const CREW = ['Vega Rell', 'Orin Tace', 'Sable Quen', 'Kestrel Vane', 'Wren Osei'];

// ─────────────────────────────────────────────────────────────────────────────
// 3. LITERAL INJECTION + STRING TRANSFORMS
// ─────────────────────────────────────────────────────────────────────────────
// Bracket-matched `const NAME = <literal>;` span finder (from strip-secrets.mjs).
function valueSpan(src, name){
  const m = new RegExp(`const\\s+${name}\\s*=\\s*`).exec(src);
  if(!m) return null;
  let i = m.index + m[0].length;
  const start = i, open = src[i], close = open === '{' ? '}' : ']';
  if(open !== '{' && open !== '[') return null;
  let depth = 0, s = null;
  for(; i < src.length; i++){
    const c = src[i];
    if(s){ if(c === '\\'){ i++; continue; } if(c === s) s = null; continue; }
    if(c === '"' || c === "'" || c === '`'){ s = c; continue; }
    if(c === open) depth++;
    else if(c === close){ depth--; if(depth === 0){ return { start, end: i + 1 }; } }
  }
  return null;
}
function replaceConst(src, name, literalStr){
  const span = valueSpan(src, name);
  if(!span){ throw new Error(`const ${name} not found for injection`); }
  return src.slice(0, span.start) + literalStr + src.slice(span.end);
}
const nodesLiteral = a => '[\n' + a.map(n => '  ' + JSON.stringify(n)).join(',\n') + '\n]';

// Per-file injections keyed by basename.
const INJECT = {
  'js/10-galaxy.js': src => {
    src = replaceConst(src, 'GALAXY_FACTIONS', JSON.stringify(FACTIONS, null, 2));
    src = replaceConst(src, 'GALAXY_NODES', nodesLiteral(genGalaxy(28)));
    return src;
  },
  'js/00-core-data.js': src => replaceConst(src, 'BASE_BODIES_AUROS', JSON.stringify(BODIES, null, 2)),
  'js/20-station-data.js': src => replaceConst(src, 'MAIN', JSON.stringify(STATION, null, 2)),
  'js/40-station.js': src => replaceConst(src, 'BASE_LOCATIONS', JSON.stringify(LOCATIONS, null, 2)),
  'js/55-auth-gating.js': src => replaceConst(src, 'KNOWN_CHARACTERS', JSON.stringify(CREW)),
};

// Ordered string transforms applied to every copied text file AFTER injection.
// Longer/more-specific patterns first. `g` = global.
// ORDER MATTERS: specific multi-word phrases & branding first, broad single-word
// rules (factions, archon→morality, anchor display names) last — otherwise a
// broad rule shreds a phrase before its specific rule can match it.
const TRANSFORMS = [
  // ── Storage-key + table-name prefix (aurelia_state, aurelia_theme, …) → vtt_.
  [/aurelia_/g, 'vtt_'],

  // ── Branding & campaign identity (before any broad word rule touches them).
  [/Aurelia RPG Tools/g, APP_NAME],
  [/Archon Gambit/g, CAMPAIGN_TITLE],
  [/'archon-gambit'/g, `'${CAMPAIGN_ID}'`],
  [/"archon-gambit"/g, `"${CAMPAIGN_ID}"`],

  // ── Multi-word AG lore phrases.
  [/Archon Collective — Morality/g, 'Morality'],
  [/Archon Collective/g, 'the faction'],
  [/Terran Hegemony/g, 'Stellar Union'],
  [/Reach Stars Resistance/g, 'Frontier Reaches'],
  [/Red Star Collective/g, 'the Combine'],
  [/Meridian['’]s Edge/gi, 'Wayfarer'],   // also THE MERIDIAN'S EDGE statblock header

  // ── Default-pack terminology → agnostic (mechanics stay; trademark nouns go).
  [/player:'Traveller'/g, "player:'Player'"],
  [/playerView:'Traveller View'/g, "playerView:'Player View'"],
  [/date:'Imperial date'/g, "date:'Sector date'"],
  [/calendar:'Imperial Calendar'/g, "calendar:'Sector Calendar'"],
  [/chip:'IMP'/g, "chip:'SD'"],
  [/era:'Imperial'/g, "era:'Standard'"],
  [/The Orion Arm/g, 'The Sector'],
  [/Orion Arm/g, 'the sector'],

  // ── Hardcoded reveal lists retargeted to the generic sample content ids.
  [/REVEALABLE_STATION_AREAS = \[[^\]]*\]/g, "REVEALABLE_STATION_AREAS = ['docking','concourse','ops','medical','engineering']"],
  [/REVEALABLE_AURELIA_LOCS  = \[[^\]]*\]/g, "REVEALABLE_AURELIA_LOCS  = ['station','capitol','harbour','highlands']"],

  // ── Crew identities. Full names first, then per-identity body classes, then
  // residual single tokens. New names come from CREW.
  [/as-rhett/g, 'as-crew-a'],
  [/as-cass/g, 'as-crew-b'],
  [/Rhett Calder/g, CREW[0]],   // Vega Rell
  [/Cassia Velen/g, CREW[1]],   // Orin Tace
  [/Dr Curculion/g, CREW[2]],   // Sable Quen
  [/Riven Dahl/g, CREW[3]],     // Kestrel Vane
  [/\bCassia\b/g, 'Orin'], [/\bCass\b/g, 'Orin'], [/\bRhett\b/g, 'Vega'],
  [/\bCurculion\b/g, 'Quen'], [/\bRiven\b/g, 'Kestrel'], [/\bDahl\b/g, 'Vane'],
  [/\bCalder\b/g, 'Rell'], [/\bVelen\b/g, 'Tace'], [/\bRiley\b/g, 'Wren'],

  // ── Factions. Lowercase ids (data-only in code; no engine branch depends on
  // them) map to the generic set, then capitalised display forms.
  [/hegemony/g, 'union'], [/omnisynth/g, 'combine'], [/sanhedrin/g, 'dominion'],
  [/vestalian/g, 'frontier'], [/\buhc\b/g, 'frontier'], [/\brsc\b/g, 'collective'],
  [/\bvast\b/g, 'drift'],
  [/Hegemony/g, 'Stellar Union'], [/OmniSynth/g, 'Combine'], [/Omnisynth/g, 'Combine'],
  [/Sanhedrin/g, 'Dominion'], [/Vestalian/g, 'Frontier'],
  // All-caps variants (tag preset lists, statblock headers).
  [/HEGEMONY/g, 'UNION'], [/\bRSC\b/g, 'Collective'], [/UNDERDECK/g, 'ENGINEERING'],
  // Stray generic-ish NPC name that embeds the 'Cassia' substring.
  [/\bCassian\b/g, 'Casmir'],

  // ── Morality tracker — the meter, its axes/bands constants, and every
  // archon-* CSS class / JS identifier. 'archon' is unambiguously AG here.
  [/ARCHON/g, 'MORALITY'], [/Archon/g, 'Morality'], [/archon/g, 'morality'],

  // ── Home-system anchor: the goAurelia navigation fn and residual display names.
  [/goAurelia/g, 'goHomeworld'],
  [/\bAurelian\b/g, 'Concordian'],
  [/\bAurelia\b/g, 'Concord'],
  [/\bAuros\b/g, 'Helion'],
  [/\bScoria\b/g, 'Ember'], [/\bscoria\b/g, 'ember'],
  [/\bTerran\b/g, 'Union'], [/\bUnderdeck\b/g, 'Engineering'],
];

function transform(text){
  for(const [re, to] of TRANSFORMS) text = text.replace(re, to);
  return text;
}

const TEXT_EXT = /\.(js|html|css|json|webmanifest|svg|md|txt|toml)$/i;
function isText(p){ return TEXT_EXT.test(p); }

// ─────────────────────────────────────────────────────────────────────────────
// 4. GENERATED FILES (agnostic README / LICENSE / config.example / .gitignore)
// ─────────────────────────────────────────────────────────────────────────────
const README = `# ${APP_NAME}

A browser-based, table-first **virtual tabletop for science-fiction RPGs** — an
interactive referee map and toolkit. The whole app is a single static page
(installable as a PWA, works offline), backed by a free Supabase project that
syncs reveals, the clock, and notes between everyone at the table.

Players open a link on a laptop, tablet, or phone — nothing to install. The
referee runs a layered galaxy → system → world → station → deck-plan map, a
calendar/clock, space combat, a living economy, session tools, and per-player
content redaction.

This build ships a small **generic sample sector** as its default campaign. It is
placeholder content: rewrite it in Design Mode, or build your own universe with
the **Campaign Pack** engine (the app is franchise-agnostic — the sample sector is
just one pack among many).

## Stand up your own campaign

You host the page once; your players just open the link. Roughly 10 minutes.

1. **Host the folder.** Any static host works — Netlify Drop, GitHub Pages, or
   Cloudflare Pages. The link you get is what you share with players.
2. **Run the setup wizard.** Open **\`setup.html\`** on your hosted copy (a fresh,
   unconfigured copy redirects there automatically). It collects your Supabase
   project, access codes, campaign name, and players, gives you paste-ready SQL
   for the database, and generates a deployable **\`config.js\`**.
3. **Deploy \`config.js\`.** Upload it next to \`index.html\`. That carries your
   backend and codes to every device that opens your link.

Re-run or edit any time from **Referee tools ▸ Campaign Setup**.

## \`config.js\` — the campaign config contract

\`index.html\` loads an optional \`config.js\` first and reads
\`window.AURELIA_CONFIG\`, resolving each setting \`config.js\` → \`localStorage\`
(this device) → the built-in default. Copy [\`config.example.js\`](config.example.js)
to \`config.js\`, or let the wizard generate it.

| Key | Purpose |
|-----|---------|
| \`campaignName\` | Browser-tab title |
| \`accessCode\` | The code players type at the gate |
| \`designCode\` | Referee-only code that unlocks Design Mode |
| \`supabaseUrl\` / \`supabaseKey\` | Your Supabase project URL + **publishable (anon)** key |
| \`imperialStart\` | Starting in-fiction date \`{ day, year }\` |

**Safe to publish:** the Supabase key is a publishable anon key (Row-Level
Security gates it) and the access/design codes are casual deterrents. Don't put
genuine secrets in \`config.js\`.

## Provenance

Generated from a private single-campaign codebase by \`tools/build-agnostic.mjs\`,
which strips all campaign-specific lore and reseeds a generic sample sector. The
engine (rendering, Design Mode, Campaign Packs, sync) is the shared spine.

## License

MIT — see [LICENSE](LICENSE).
`;

const LICENSE = `MIT License

Copyright (c) ${'2026'} ${APP_NAME} contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const CONFIG_EXAMPLE = `/* ${APP_NAME} — campaign config template.
   Copy this file to config.js and fill it in, or run the setup wizard
   (setup.html) which generates a ready-to-deploy config.js for you.

   Safe to publish: the Supabase key is a *publishable* anon key (Row-Level
   Security gates it) and the access/design codes are casual deterrents. Don't
   put genuine secrets here. */
window.AURELIA_CONFIG = {
  "campaignName": "",
  "accessCode": "changeme",
  "designCode": "changeme-referee",
  "supabaseUrl": "https://YOUR-PROJECT.supabase.co",
  "supabaseKey": "YOUR-PUBLISHABLE-ANON-KEY",
  "imperialStart": { "day": 1, "year": 1105 }
};
`;

const GITIGNORE = `# Local, per-deploy campaign config (never commit real backends/codes)
config.js

# Referee-uploaded content must never be committed
*.rulebook.pdf

# OS / editor cruft
.DS_Store
*.swp
node_modules/
`;

// ─────────────────────────────────────────────────────────────────────────────
// 5. LORE LEAK-GUARD
// ─────────────────────────────────────────────────────────────────────────────
// Tokens that are unambiguously Archon Gambit lore and must NOT survive. Ruleset
// terms (Traveller/Imperial mechanics, UWP) are intentionally allowed per the
// "campaign/setting only" scope. Anchor ids ('aurelia'/'auros' lowercase) are
// allowed as internal keys; the display forms are caught case-sensitively.
const LORE_TOKENS_CI = [   // case-insensitive
  'archon', 'sanhedrin', 'omnisynth', 'vestalian', 'hegemony', 'second fall',
  'red star collective', 'orion arm', 'rhett', 'cassia', 'curculion',
  'riven dahl', "riley", 'dockmaster vey', 'crystalliron',
  "meridian's edge", 'the cleaners', 'aurelia rpg',
];
const LORE_TOKENS_CS = ['Aurelia', 'Auros', 'Archon', 'Scoria'];  // case-sensitive display forms

function leakScan(dir){
  const hits = [];
  const walk = d => {
    for(const name of readdirSync(d)){
      const p = join(d, name);
      const st = statSync(p);
      if(st.isDirectory()){ walk(p); continue; }
      if(!isText(p)) continue;
      const rel = relative(dir, p);
      const text = readFileSync(p, 'utf8');
      const lines = text.split('\n');
      lines.forEach((ln, i) => {
        for(const t of LORE_TOKENS_CI){ if(ln.toLowerCase().includes(t)) hits.push({ rel, line:i+1, token:t, ctx:ln.trim().slice(0,100) }); }
        for(const t of LORE_TOKENS_CS){ if(ln.includes(t)) hits.push({ rel, line:i+1, token:t, ctx:ln.trim().slice(0,100) }); }
      });
    }
  };
  walk(dir);
  return hits;
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD
// ─────────────────────────────────────────────────────────────────────────────
function copyTree(srcDir, dstDir){
  mkdirSync(dstDir, { recursive: true });
  for(const name of readdirSync(srcDir)){
    const s = join(srcDir, name), d = join(dstDir, name);
    const st = statSync(s);
    if(st.isDirectory()){ copyTree(s, d); continue; }
    emit(s, d);
  }
}
function emit(srcPath, dstPath){
  const rel = relative(repoRoot, srcPath).split('\\').join('/');
  mkdirSync(dirname(dstPath), { recursive: true });
  if(isText(srcPath)){
    let text = readFileSync(srcPath, 'utf8');
    if(INJECT[rel]) text = INJECT[rel](text);
    text = transform(text);
    writeFileSync(dstPath, text);
  } else {
    copyFileSync(srcPath, dstPath);
  }
}

function build(){
  if(existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  for(const f of COPY_FILES){ const s = join(repoRoot, f); if(existsSync(s)) emit(s, join(OUT, f)); }
  for(const d of COPY_DIRS){ const s = join(repoRoot, d); if(existsSync(s)) copyTree(s, join(OUT, d)); }

  writeFileSync(join(OUT, 'README.md'), README);
  writeFileSync(join(OUT, 'LICENSE'), LICENSE);
  writeFileSync(join(OUT, 'config.example.js'), CONFIG_EXAMPLE);
  writeFileSync(join(OUT, '.gitignore'), GITIGNORE);

  // Syntax-check every emitted js module (catches a broken injection early).
  let syntaxErrors = 0;
  const checkJs = d => { for(const name of readdirSync(d)){ const p = join(d, name); const st = statSync(p); if(st.isDirectory()) checkJs(p); else if(p.endsWith('.js')){ try { execSync(`node --check "${p}"`, { stdio:'pipe' }); } catch(e){ syntaxErrors++; console.error(`  ✗ syntax: ${relative(OUT, p)}\n    ${String(e.stderr||e).split('\n').slice(0,3).join('\n    ')}`); } } } };
  checkJs(join(OUT, 'js'));

  const hits = leakScan(OUT);
  return { syntaxErrors, hits };
}

console.log(`build-agnostic → ${relative(repoRoot, OUT) || OUT}${checkOnly ? '  (--check)' : ''}`);
const { syntaxErrors, hits } = build();

if(hits.length){
  console.error(`\n✗ lore leak-guard: ${hits.length} occurrence(s) of Archon Gambit tokens survived:`);
  const shown = hits.slice(0, 40);
  for(const h of shown) console.error(`  ${h.rel}:${h.line}  [${h.token}]  ${h.ctx}`);
  if(hits.length > shown.length) console.error(`  … and ${hits.length - shown.length} more`);
} else {
  console.log('✓ lore leak-guard: clean (no Archon Gambit tokens)');
}
if(syntaxErrors) console.error(`✗ ${syntaxErrors} js module(s) failed node --check`);
else console.log('✓ js syntax: all modules parse');

const ok = hits.length === 0 && syntaxErrors === 0;
if(checkOnly){ rmSync(OUT, { recursive: true, force: true }); }
else if(ok){ console.log(`\nDone. Deployable agnostic app in ${relative(repoRoot, OUT)}/`); }
process.exit(ok ? 0 : 1);

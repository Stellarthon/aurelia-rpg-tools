// ─────────────────────────────────────────────────────────────────────────────
// gen-galaxy.mjs — deterministic galaxy-expansion generator.
//
// Preserves ALL curated systems verbatim, then appends N procedurally-generated
// systems (faction colonies + frontier/independent worlds) to GALAXY_NODES in
// js/10-galaxy.js. Each system's `name` is a catalog designation that seeds the
// MgT2e UWP engine (WGEN, seededRng(name)) in-app, so trade codes + the whole
// economy auto-derive — the generator only places systems, assigns factions, and
// wires jump lanes. Deterministic (fixed seed) → identical output every run, so
// UWP/hex/economy stay reproducible across devices.
//
//   node tools/gen-galaxy.mjs [addCount]     (default 130)
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'js/10-galaxy.js');
const ADD = parseInt(process.argv[2] || '130', 10);

// ── deterministic RNG (mulberry32) ──
function mulberry(seed){ return function(){ seed|=0; seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
const rng = mulberry(20260709);   // fixed seed → reproducible galaxy
const rnd = () => rng();
const pick = a => a[Math.floor(rnd()*a.length)];
const jitter = (v,amp) => v + Math.round((rnd()*2-1)*amp);

// ── load + parse the curated nodes ──
const src = fs.readFileSync(FILE, 'utf8');
const m = src.match(/const GALAXY_NODES = (\[[\s\S]*?\n\]);/);
if(!m){ console.error('GALAXY_NODES literal not found'); process.exit(1); }
const curated = JSON.parse(m[1]);
// Strip any prior generation so re-running is idempotent (generated nodes carry _gen:true).
const base = curated.filter(n => !n._gen);
console.log(`curated systems: ${base.length}`);

const usedIds = new Set(base.map(n=>n.id));
const usedNames = new Set(base.map(n=>n.name));
const usedLabels = new Set(base.map(n=>n.label));

// faction centroids (x,y — legacy coords; unrendered but kept for data completeness)
const byFac = {};
base.forEach(n => (byFac[n.faction]=byFac[n.faction]||[]).push(n));
const centroid = f => { const g=byFac[f]||base; return [ g.reduce((s,n)=>s+n.x,0)/g.length, g.reduce((s,n)=>s+n.y,0)/g.length ]; };

// ── name / label pools ──
const CATALOG = ['Gliese','GJ','HD','HIP','Wolf','Ross','LHS','Luyten','Struve','Lalande','Kruger','Kapteyn','Groombridge','Tycho','Kepler','Ross','Gliese','HD'];
const usedCatalogNums = new Set();
function catalogName(){ for(let i=0;i<200;i++){ const nm = pick(CATALOG)+' '+(100+Math.floor(rnd()*9800)); if(!usedNames.has(nm) && !usedCatalogNums.has(nm)){ usedCatalogNums.add(nm); usedNames.add(nm); return nm; } } return 'HD '+(10000+Math.floor(rnd()*89999)); }

const LBL_PRE = ['New','Port','Fort','Saint','Novo','Neo','Landing at','Haven','Cape','Nova'];
const LBL_ROOT = ['Ashford','Meridian','Kestrel','Tantalus','Verdance','Cinder','Halcyon','Tsvetov','Okoro','Vantage','Sable','Bishop','Calder','Ferrum','Aleph','Concord','Redoubt','Kalinga','Sundara','Marrow','Perdido','Kiln','Solace','Tallow','Vireo','Ostrava','Anvil','Gethsemane','Providence','Thornwell','Ardent','Corvus','Draeger','Emberly','Foxglove','Grendel','Harrow','Ilium','Jubilee','Kavan','Lachlan','Morrow','Nadir','Oxley','Pallas','Quillon','Rhodes','Selk','Torrent','Umbra','Volk','Warden','Yarrow','Zenobia'];
const LBL_SUFFIX = ['Landing','Reach','Station','Hold','Rest','Gate','Deep','Verge','Drift','Claim','Outpost','Depot','Watch','Terminus','Anchorage','Yards','Fields','Mires'];
function coinLabel(){
  for(let i=0;i<40;i++){
    const style=rnd();
    let lbl;
    if(style<0.4) lbl = pick(LBL_PRE)+' '+pick(LBL_ROOT);
    else if(style<0.75) lbl = pick(LBL_ROOT)+' '+pick(LBL_SUFFIX);
    else lbl = pick(LBL_ROOT);
    if(!usedLabels.has(lbl)){ usedLabels.add(lbl); return lbl; }
  }
  const l = pick(LBL_ROOT)+' '+(2+Math.floor(rnd()*9)); usedLabels.add(l); return l;
}
function slug(s){ return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
function uniqueId(seed){ let id=slug(seed), n=2; while(usedIds.has(id)){ id=slug(seed)+'-'+n++; } usedIds.add(id); return id; }

// ── faction distribution for the new systems (independent/frontier weighted heaviest) ──
const WEIGHTS = { independent:34, hegemony:24, sanhedrin:15, uhc:14, rsc:14, omnisynth:10, contested:9, archon:5, vast:5 };
const wsum = Object.values(WEIGHTS).reduce((a,b)=>a+b,0);
const quota = {}; let assigned=0;
Object.keys(WEIGHTS).forEach(f=>{ quota[f]=Math.max(0,Math.round(ADD*WEIGHTS[f]/wsum)); assigned+=quota[f]; });
quota.independent += (ADD-assigned);   // remainder to independents

const DESC_ROLE = {
  hegemony:['a fortified Hegemony core world','a Hegemony naval anchorage','a Terran administrative colony','a Hegemony agricultural world feeding the core'],
  sanhedrin:['a Congregation pilgrim colony','a temple-world of the Second Fall','a Sanhedrin cloister-world','a devout frontier parish'],
  uhc:['a Vestalian continuity arcology','a UHC industrial world','a Continuity records-vault world','a UHC terraforming project'],
  rsc:['a Red Star collective commune','an RSC labour world','a collectivised mining world','a Red Star frontier soviet'],
  omnisynth:['an OmniSynth company world','an OmniSynth research station','a corporate mining concession','an OmniSynth automated foundry-world'],
  contested:['a contested border world','a world under disputed claim','a lawless marches settlement','a shifting-allegiance frontier port'],
  archon:['a dormant Archon relay','a silent Archon node','an abandoned Collective installation','a half-lit Archon waystation'],
  vast:['a Vast anomaly-world','a strange Vast research outpost','a world where the Vast lingers','a quiet Vast enclave'],
  independent:['an independent free port','a frontier prospecting claim','an independent agricultural colony','a free-trader waystation','a belter refinery outpost','an independent shipbreaking yard','a homesteader colony','a smugglers’ haven'],
};

// ── generate ──
const gen = [];
Object.keys(quota).forEach(fac => {
  const [cx,cy] = centroid(fac);
  const n = quota[fac];
  for(let i=0;i<n;i++){
    // spread outward from the faction centroid; independents scatter much wider
    const spread = fac==='independent' ? 360 : (70 + Math.sqrt(i+1)*46);
    const ang = rnd()*Math.PI*2, rad = spread*(0.35+rnd()*0.9);
    const x = Math.max(40, Math.round(cx + Math.cos(ang)*rad));
    const y = Math.max(40, Math.round(cy + Math.sin(ang)*rad));
    const name = catalogName();
    // most frontier worlds keep a plain catalog identity; ~55% get a colony label
    const label = rnd()<0.55 ? coinLabel() : name;
    const id = uniqueId(label);
    gen.push({ id, name, x, y, faction:fac, label, connections:[], desc:`${label} — ${pick(DESC_ROLE[fac]||DESC_ROLE.independent)}.`, _gen:true });
  }
});

// ── wire jump lanes: connect every generated system to its nearest neighbours ──
const all = base.concat(gen);
const dist2 = (a,b)=> (a.x-b.x)**2 + (a.y-b.y)**2;
gen.forEach(g => {
  // candidates = all other systems, nearest first; prefer same-faction but allow cross-links
  const near = all.filter(o=>o.id!==g.id).map(o=>({o, d:dist2(g,o), same:o.faction===g.faction}))
    .sort((a,b)=> (a.d - b.d)).slice(0, 14);
  const links = [];
  // 2 nearest overall + 1 nearest same-faction (for territory cohesion)
  near.slice(0,2).forEach(c=> links.push(c.o.id));
  const sameF = near.find(c=>c.same && !links.includes(c.o.id));
  if(sameF) links.push(sameF.o.id);
  g.connections = [...new Set(links)];
});

// ── connectivity pass: union-find over the WHOLE graph; link stray components to the main one ──
function connectivity(nodes){
  const idx = new Map(nodes.map((n,i)=>[n.id,i]));
  const parent = nodes.map((_,i)=>i);
  const find = a=>{ while(parent[a]!==a){ parent[a]=parent[parent[a]]; a=parent[a]; } return a; };
  const uni = (a,b)=>{ a=find(a); b=find(b); if(a!==b) parent[a]=b; };
  nodes.forEach((n,i)=> (n.connections||[]).forEach(c=>{ if(idx.has(c)) uni(i, idx.get(c)); }));
  return { idx, find, parent };
}
let guard=0;
while(guard++<60){
  const { idx, find } = connectivity(all);
  const roots = new Set(all.map((_,i)=>find(i)));
  if(roots.size<=1) break;
  // biggest component = main; attach the nearest node of each other component to it
  const compOf = {}; all.forEach((n,i)=>{ const r=find(i); (compOf[r]=compOf[r]||[]).push(n); });
  const comps = Object.values(compOf).sort((a,b)=>b.length-a.length);
  const main = comps[0];
  for(let k=1;k<comps.length;k++){
    const c = comps[k];
    let best=null;
    c.forEach(n=> main.forEach(o=>{ const d=dist2(n,o); if(!best||d<best.d) best={n,o,d}; }));
    if(best){ const g = gen.find(x=>x.id===best.n.id) || best.n; (g.connections=g.connections||[]).push(best.o.id); g.connections=[...new Set(g.connections)]; }
  }
}

// final report
const finalFac = {}; all.forEach(n=> finalFac[n.faction]=(finalFac[n.faction]||0)+1);
console.log(`generated: ${gen.length} · total: ${all.length}`);
console.log('faction totals:', JSON.stringify(finalFac));
const { find } = connectivity(all);
console.log('connected components:', new Set(all.map((_,i)=>find(i))).size);

// ── write back: replace the GALAXY_NODES literal (curated first, generated after) ──
const out = base.concat(gen);
const literal = '[\n' + out.map(n => '  ' + JSON.stringify(n)).join(',\n') + '\n]';
const newSrc = src.replace(/const GALAXY_NODES = \[[\s\S]*?\n\];/, 'const GALAXY_NODES = ' + literal + ';');
fs.writeFileSync(FILE, newSrc);
console.log(`wrote ${FILE}`);

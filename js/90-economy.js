// ═══════════════════════════════════════════════════════════════════════════
// LIVING ECONOMY — Level 2 stocks/flows/lead-times engine  (window.ECON)
// ───────────────────────────────────────────────────────────────────────────
// Self-contained. Reads globals GALAXY_NODES / GALAXY_FACTIONS / imperialDate /
// imperialOrdinal / isReferee / supaStorage. The ONLY hook into the existing
// market is mktPressure() (HX module), which uses ECON.pressure() when the FULL
// sim is active (referee opt-in) and otherwise reads the SIMPLE static produces/
// demands model (simplePressure(), the default) — so prices stay coherent whether
// or not the sim is running, and if the engine throws nothing changes for players.
//
// Tick = 1 Imperial week. Goods are made by recipe (conservation); worlds hold
// stockpiles with a safety threshold; trade moves goods producer→consumer with a
// lead time = jump distance, so shocks ripple instead of teleport.
// ═══════════════════════════════════════════════════════════════════════════
window.ECON = (function(){
  const NO_MARKET = { vast:1, archon:1 };

  // ── Goods graph (BoM). Keyed to the real TRADE_GOODS names so the sim drives
  //    the prices players already see. Recipe = inputs consumed per 1 output;
  //    raws have no recipe (extraction). 'Scrap' is an internal input, untraded. ──
  const GOODS = {
    'Common Ore':          { tier:0 },                                              // raw (mined)
    'Scrap':               { tier:0, internal:true },                               // raw (salvaged)
    'Common Consumables':  { tier:0 },                                              // food (grown)
    'Common Electronics':  { tier:1, recipe:{ 'Common Ore':1, 'Scrap':1 } },        // component
    'Common Manufactured': { tier:1, recipe:{ 'Common Ore':1, 'Scrap':1 } },
    'Advanced Electronics':{ tier:2, recipe:{ 'Common Electronics':2 } },           // high-tech
    // ── Deeper graph: two new value chains + a raw, for richer multi-hop cascades ──
    'Precious Metals':     { tier:0 },                                              // raw (mined, high value)
    'Radioactives':        { tier:0 },                                              // raw (mined, very high value)
    'Biochemicals':        { tier:1, recipe:{ 'Common Consumables':1 } },           // refined from agri output
    'Luxury Goods':        { tier:2, recipe:{ 'Precious Metals':1 } },              // worked precious metals
    'Pharmaceuticals':     { tier:2, recipe:{ 'Biochemicals':2 } },                 // food → biochem → pharma
    // ── Fuel chain. Gas giants & C/D/E ports SKIM raw hydrogen; A/B ports REFINE it.
    //    Mirrors the ship planner's fuelAt() model, so frontier skimmers feed core
    //    refineries and fuel becomes a real, shockable, geography-driven commodity. ──
    'Unrefined Hydrogen':  { tier:0 },                                              // raw (skimmed at gas giants / C-D-E ports)
    'Refined Fuel':        { tier:1, recipe:{ 'Unrefined Hydrogen':1.1 } },         // refined at A-B starports
  };
  const SIM_GOODS = Object.keys(GOODS);

  // ── World economic profiles (kt/week). prod = output capacity; cons = demand
  //    (final + non-recipe needs). safW = weeks-of-cover safety stock. Keyed by
  //    GALAXY_NODES id (ids are scrambled vs labels — see comments). Unlisted
  //    market worlds get a light consumer default so the whole map stays alive. ──
  // cons = FINAL demand only (food for population + finished goods consumed).
  // Recipe inputs (ore/scrap/components) are auto-imported via recipeDraw — never
  // list them in cons or they double-count. Numbers are balanced so total supply
  // ≥ total demand for every good (system sits near equilibrium; shocks deviate it).
  const DEF = {
    cypress:        { prod:{'Common Consumables':320,'Biochemicals':20}, cons:{'Common Manufactured':6}, safW:1 },   // breadbasket + bio-refinery (+20 food offsets the biochem draw)
    'the-garden':   { prod:{'Common Consumables':53,'Biochemicals':8},  cons:{'Common Manufactured':3} },           // Congregation farm
    bastion:        { prod:{'Common Consumables':67,'Biochemicals':12}, cons:{'Common Manufactured':8,'Advanced Electronics':2,'Luxury Goods':2,'Pharmaceuticals':2} }, // Elysium Prime
    erebus:         { prod:{'Common Ore':130,'Precious Metals':8,'Radioactives':6}, cons:{'Common Consumables':6,'Common Manufactured':2} },
    'profit-margin':{ prod:{'Common Ore':100,'Scrap':120,'Precious Metals':10}, cons:{'Common Consumables':8} },
    graveyard:      { prod:{'Scrap':260,'Radioactives':5},              cons:{'Common Consumables':4} },            // salvage + reclaimed isotopes
    'elysium-prime':{ prod:{'Common Ore':40,'Precious Metals':6},       cons:{'Common Consumables':3} },            // Vanguard's End mine
    kronos:         { prod:{'Common Electronics':90,'Common Manufactured':40,'Luxury Goods':8}, cons:{'Common Consumables':15,'Radioactives':4,'Pharmaceuticals':2}, safW:1.5 }, // Kronos Prime
    castor:         { prod:{'Common Manufactured':60,'Luxury Goods':6}, cons:{'Common Consumables':8,'Pharmaceuticals':1} },  // forge-world
    'the-anvil':    { prod:{'Common Manufactured':40}, cons:{'Common Consumables':4} },             // shipyards
    vesta:          { prod:{'Common Electronics':25,'Pharmaceuticals':8}, cons:{'Common Consumables':10} },         // Vestalia — electronics + pharma labs
    sol:            { prod:{'Advanced Electronics':18,'Pharmaceuticals':10},
                      cons:{'Common Consumables':60,'Common Manufactured':25,'Advanced Electronics':15,'Luxury Goods':3,'Radioactives':3,'Precious Metals':1,'Pharmaceuticals':2}, safW:4 },
    aurelia:        { prod:{'Advanced Electronics':20},
                      cons:{'Common Consumables':120,'Common Manufactured':40,'Advanced Electronics':12,'Luxury Goods':6,'Pharmaceuticals':5,'Radioactives':3,'Precious Metals':2}, safW:3 },
    avalon:         { prod:{'Advanced Electronics':8}, cons:{'Common Consumables':8,'Common Manufactured':4,'Luxury Goods':1,'Pharmaceuticals':1} },
    warehouse:      { prod:{}, cons:{}, store:{'Common Consumables':200}, safW:8 },                // strategic food cache
  };
  const DEFAULT = { prod:{}, cons:{'Common Consumables':2,'Common Manufactured':1}, safW:2 };

  // ── Procedural profile derivation ───────────────────────────────────────────
  // The galaxy is semi-procedural: the referee hand-crafts and UWP-generates worlds.
  // A world the referee has NOT hand-authored (not in DEF, no override) derives its
  // production/consumption from what it physically IS — its MgT2e trade codes, its
  // population, its starport, and (for fuel) any gas giant — via HX.worldFacts(). So a
  // generated agri world feeds the sector and a generated refinery makes fuel, instead
  // of falling through to a dead light-consumer DEFAULT. Precedence (buildTopology /
  // defProfileOf): override > curated DEF > derivedProfile > DEFAULT fallback. Derived
  // from the SEEDED UWP only (per-device deterministic) → identical baseline everywhere.
  // Curated core worlds keep their hand-tuned DEF, so the balanced spine is untouched;
  // derived worlds are deliberately MODEST so a single addition rarely tips the galaxy —
  // and when a big one does, marketImpact() surfaces the new deficit to the referee.
  function popScale(pop){ pop=pop|0;
    if(pop<=0) return 0; if(pop<=2) return 2; if(pop<=3) return 4; if(pop<=4) return 7;
    if(pop===5) return 11; if(pop===6) return 18; if(pop===7) return 30; if(pop===8) return 55;
    if(pop===9) return 90; if(pop===10) return 130; return 170; }
  let derivedCache = {};   // id → derived profile; cleared whenever topology rebuilds
  let factsCache = {};     // id → HX.worldFacts(id); shared by derivedProfile + the fuel layer
  function factsOf(id){
    if(id in factsCache) return factsCache[id];
    return (factsCache[id] = (typeof HX!=='undefined' && HX.worldFacts) ? HX.worldFacts(id) : null);
  }
  function derivedProfile(id){
    if(derivedCache[id]) return derivedCache[id];
    const f = factsOf(id);
    if(!f) return DEFAULT;                                  // no facts yet (pre-HX-init) → old light default
    const codes=f.codes||[], C=c=>codes.includes(c), sc=popScale(f.pop), prod={}, cons={};
    const add=(m,g,v)=>{ v=Math.round(v); if(v>0) m[g]=(m[g]||0)+v; };
    if(sc<=0){ return (derivedCache[id]={ prod:{}, cons:{}, safW:2 }); }   // unpopulated rock — no market activity
    // FOOD — every inhabited world grows MOST of its own (local agriculture / hydroponics),
    // so derived worlds aren't pure importers (which would starve the whole galaxy). Ag/Ga
    // worlds are strong net exporters; Na (non-agri) & Po (poor) & dense In/Hi worlds run a
    // mild deficit, fed by the Ag surplus. Producer-generous / consumer-light bias → the
    // derived frontier rests at a small SURPLUS (stable baseline), never a structural deficit.
    const foodDem = sc*0.5;
    // Self-sufficiency skews slightly food-POSITIVE so the ~180-world galaxy stays fed: with far more
    // importer worlds than the original 53, the aggregate needs a little more local agriculture to keep
    // the frontier off perpetual famine (kept modest — the galaxy still rests near par, verified).
    let foodMult = 1.25;                                      // default world → food-surplus
    if(C('Ag')||C('Ga')) foodMult = 2.6;                     // breadbasket → net exporter
    else if(C('Na')) foodMult = 0.7;                         // non-agricultural → importer
    else if(C('Po')) foodMult = 0.85;
    else if(C('Hi')||C('In')) foodMult = 1.0;                // dense/urban → self-fed (hydroponics/imports balance)
    add(cons,'Common Consumables', foodDem);
    add(prod,'Common Consumables', foodDem*foodMult);
    if(C('Ag')||C('Ga')) add(prod,'Biochemicals', sc*0.28);
    // Archetype production (recipe inputs auto-import via recipeDraw — never list in cons).
    // Mining worlds also salvage SCRAP (the untraded internal input the recipes draw on),
    // so a frontier full of industry doesn't drain the two DEF scrap yards dry.
    if(C('As')||C('De')||C('Ic')){ add(prod,'Common Ore', sc*2.6); add(prod,'Scrap', sc*1.2);
      add(prod,'Precious Metals', sc*0.16); if(C('As')) add(prod,'Radioactives', sc*0.08); }   // mining / barren-rock
    // Industry co-locates extraction/reclamation, so an industrial world mines & salvages
    // ENOUGH of its own ore + scrap to feed its lines — else one big In world drains the
    // whole galaxy's raws (the recipes draw 1 ore + 1 scrap per tier-1 unit).
    if(C('In')){ add(prod,'Common Manufactured', sc*0.65); add(prod,'Common Electronics', sc*0.9);
      add(prod,'Common Ore', sc*1.6); add(prod,'Scrap', sc*1.6); }
    if(C('Ht')){ add(prod,'Advanced Electronics', sc*0.2); add(prod,'Pharmaceuticals', sc*0.12); }    // high-tech (advanced draws 2× electronics — kept modest)
    if(C('Ri')){ add(prod,'Luxury Goods', sc*0.24); add(prod,'Precious Metals', sc*0.18); }            // rich worlds: worked + raw precious metals
    // Finished-goods FINAL demand — kept light & concentrated so it doesn't out-run supply.
    if(f.pop>=7) add(cons,'Common Manufactured', sc*0.12);
    if(f.pop>=8) add(cons,'Advanced Electronics', sc*0.05);
    if(C('Hi')||C('Ri')) add(cons,'Luxury Goods', sc*0.04);
    if(C('Hi')) add(cons,'Pharmaceuticals', sc*0.03);
    return (derivedCache[id]={ prod, cons, safW:2 });
  }

  // ── Fuel layer (applied to EVERY market world, DEF + derived alike) ──────────
  // Fuel isn't part of a world's authored profile — it's infrastructure layered on by
  // buildTopology from the world's starport + traffic: A/B ports run REFINERIES (make
  // Refined Fuel), C/D/E ports SKIM raw Unrefined Hydrogen, a charted gas giant adds a
  // major skimming rig, and every world burns the fuel its port offers in proportion to
  // its shipping traffic. Refined Fuel's recipe draws hydrogen, so frontier skimmers feed
  // core refineries — fuel becomes a geography-driven commodity that can run short.
  const FUEL_REFINED='Refined Fuel', FUEL_HYDRO='Unrefined Hydrogen';
  const FUEL_HUBS = { sol:3, aurelia:3, terminus:2, kronos:1.5, bastion:1.5, 'profit-margin':1 };  // curated thirsty hubs
  const REFINERY_K=1.0, SKIM_K=1.7, FUEL_DEM_K=0.8, GG_BONUS=22;   // tuning knobs (calibrated against galaxy fuel balance)
  function trafficWeight(id){
    const n = (typeof GX_MAP!=='undefined') ? GX_MAP[id] : nodeOf(id);
    const deg = (n && n.connections) ? n.connections.length : 0;
    const f = factsOf(id);
    const portT = f ? ({A:3,B:2,C:1,D:0.6,E:0.3,X:0}[f.port]||0.5) : 0.5;
    const popT = f ? Math.max(0,(f.pop||0)-4)*0.4 : 0;
    return 1 + deg*0.6 + portT + popT + (FUEL_HUBS[id]||0);
  }
  function addFuelRate(m,g,v){ v=Math.round(v*10)/10; if(v>0) m[g]=(m[g]||0)+v; }
  function addFuel(id, prod, cons){
    if(!GOODS[FUEL_REFINED]) return;
    const f = factsOf(id); if(!f) return;
    const port = f.port; if(port==='X' || !port) return;            // no starport → no fuel infrastructure / appreciable traffic
    const tw = trafficWeight(id), refinery = (port==='A'||port==='B');
    if(refinery) addFuelRate(prod, FUEL_REFINED, tw*REFINERY_K);    // refinery
    else addFuelRate(prod, FUEL_HYDRO, tw*SKIM_K);                  // C/D/E gas skim
    if(f.gasGiant) addFuelRate(prod, FUEL_HYDRO, GG_BONUS);         // charted gas-giant rig (e.g. Tanath)
    addFuelRate(cons, refinery?FUEL_REFINED:FUEL_HYDRO, tw*FUEL_DEM_K);   // ships burn what their port offers
  }

  let worlds = null, adj = null, state = null;
  // Per-world prod/cons overrides authored in the Design Mode "Production & Consumption"
  // editor. Layered over the hardcoded DEF table by buildTopology() exactly like
  // contentOverrides layers over hardcoded narrative text — DEF is never mutated, so
  // "Revert" just drops the override. Keyed by GALAXY_NODES id. Persisted (referee-only)
  // to the shared econ-profiles row so every device resolves the same economy.
  let profiles = {};
  // ── Referee manual price overlay ─────────────────────────────────────────────
  // Authored intent (like profiles): a per-world and per-world+good price nudge in
  // "notches" (+ = dearer / raise, − = cheaper / lower). Each notch is ±8%, geometric so
  // +n and −n are exact inverses. Layered onto the price OUTSIDE the bounded priceMult (via
  // priceAdjOf → overlayMult), so it works in BOTH Simple and Full mode, and SURVIVES reset
  // (it lives here, not in state). Persisted to the shared econ-priceadj row (referee-only).
  let priceAdj = { world:{}, good:{} };
  const PADJ_STEP = 1.08, PADJ_MAX = 10;
  function clampNotch(n){ return Math.max(-PADJ_MAX, Math.min(PADJ_MAX, Math.round(+n)||0)); }
  function padjMult(notch){ return Math.pow(PADJ_STEP, clampNotch(notch)); }

  function nodeOf(id){ return (typeof GALAXY_NODES!=='undefined') ? GALAXY_NODES.find(n=>n.id===id) : null; }
  function isMarket(n){ return n && !NO_MARKET[n.faction]; }
  function curWeek(){ try { return Math.floor(imperialOrdinal(imperialDate)/7); } catch(e){ return 0; } }

  // Lore free-ports / trade-nexuses / refuelling stops. They sit on the frontier with thin
  // native economies, so without a draw convoys never call. Layering a "port traffic" import
  // demand (transient crews, resale, contraband) on top makes them genuine destinations that
  // merchants supply — using goods with galaxy headroom so the balance holds.
  const TRADE_HUBS = new Set(['terminus','dust','meridian','freeside','meridian-secundus','havens-gate']);
  function addHubDemand(cons){ const add=(g,v)=>{ cons[g]=Math.round(((cons[g]||0)+v)*10)/10; };
    add('Common Consumables', 24); add('Common Electronics', 3); add('Pharmaceuticals', 1.5); add('Biochemicals', 2); }

  function buildTopology(){
    worlds = {}; adj = {}; derivedCache = {}; factsCache = {};   // facts may have changed (UWP/body/faction edits) → re-derive
    _distMemo = {}; _distMemoBlk = ' ';                          // topology changed → drop the memoised BFS distances
    (typeof GALAXY_NODES!=='undefined'?GALAXY_NODES:[]).forEach(n=>{
      if(!isMarket(n)) return;
      const d = DEF[n.id] || derivedProfile(n.id);   // curated core keeps DEF; everything else derives from UWP/trade-codes/bodies
      const ov = profiles[n.id];   // designer override (Design Mode economy editor) wins over DEF/derived
      // COPY before layering fuel — DEF/derived/override profile objects must stay immutable
      // (DEF is shared; derivedCache is reused; overrides are persisted), so we never mutate them.
      const prod = Object.assign({}, (ov&&ov.prod)?ov.prod:(d.prod||{}));
      const cons = Object.assign({}, (ov&&ov.cons)?ov.cons:(d.cons||{}));
      addFuel(n.id, prod, cons);   // layer port-class fuel production + traffic-weighted fuel demand
      if(TRADE_HUBS.has(n.id) && !ov) addHubDemand(cons);   // free-port traffic (skip if the referee hand-authored this world)
      worlds[n.id] = { id:n.id, label:n.label||n.name, fac:n.faction, prod, cons, safW:d.safW||2, store:d.store||{} };
      adj[n.id] = [];
    });
    // ── Corp infrastructure layer (second pass — all worlds[] exist now). Each corp investment
    //    bumps its specialty OUTPUT plus a little worker/equipment DEMAND at the worked world —
    //    like addHubDemand, but emergent + bounded (≤3/world). Read from shared state.corps so
    //    every device rebuilds an identical base; only the referee-only corpsStep evolves it.
    //    Defunct corps keep their invests (bought-out infrastructure runs on → no base churn). ──
    if(state && state.corps){ Object.values(state.corps).forEach(c=>{ (c.invests||[]).forEach(inv=>{
      const w = worlds[inv.world]; if(!w) return;                    // guard: a thrown buildTopology would blank the whole economy panel
      // Vertically integrate: the expansion makes its specialty AND its whole input chain down to
      // raws, so the only galaxy-net change is +specialty surplus and a little worker food demand —
      // a recipe specialty (e.g. Luxury Goods) never starves its input (Precious Metals). Keeps the
      // galaxy in mild surplus at the invest bound (verified by the balance harness).
      const addProd=(g,amt)=>{ w.prod[g]=Math.round(((w.prod[g]||0)+amt)*10)/10; const r=GOODS[g]&&GOODS[g].recipe; if(r){ for(const i in r) addProd(i, amt*r[i]); } };
      addProd(c.specialty, CORP_OUT_BUMP);
      w.cons[FOOD_GOOD] = Math.round(((w.cons[FOOD_GOOD]||0) + CORP_DEM_FOOD)*10)/10;
    }); }); }
    Object.keys(worlds).forEach(id=>{
      const n = nodeOf(id);
      // Trade graph = the ECONOMY lane set (_econLinks): the authored jump network + the referee's
      // lane edits, DECOUPLED from what the map renders (the map shows only referee-drawn lanes, but
      // trade always has routes). Falls back to n.connections if the galaxy engine hasn't populated
      // _econLinks (e.g. the headless harness, which loads data-only). ECON.syncLanes picks up edits.
      (((n && (n._econLinks || n.connections)))||[]).forEach(c=>{ if(worlds[c] && adj[id].indexOf(c)<0){ adj[id].push(c); if(adj[c]&&adj[c].indexOf(id)<0) adj[c].push(id); } });
    });
  }

  // Rebuild the trade graph + baseline from the CURRENT jump lanes (call after a lane
  // edit so the economy tracks the map). Stock/transit persist; only adj + base change.
  function recomputeBase(){
    const seed={}; Object.values(worlds).forEach(w=>{ seed[w.id]={};
      SIM_GOODS.forEach(g=>{ const s=orderUpTo(w,g); if(s>0||w.prod[g]) seed[w.id][g]=Math.round(s); }); });
    return settleBaseline(seed).stock;
  }
  function syncLanes(){ ensure(); buildTopology(); state.base = recomputeBase(); save(); }
  // Market worlds NOT in the largest connected component of the jump-lane trade graph —
  // cut off from the main economy. Empty when the network is fully connected.
  function disconnected(){ ensure();
    const ids=Object.keys(worlds), seen=new Set(), comps=[];
    ids.forEach(s=>{ if(seen.has(s))return; const st=[s],c=[]; seen.add(s);
      while(st.length){ const u=st.pop(); c.push(u); (adj[u]||[]).forEach(v=>{ if(worlds[v]&&!seen.has(v)){seen.add(v);st.push(v);} }); }
      comps.push(c); });
    comps.sort((a,b)=>b.length-a.length);
    const main=new Set(comps[0]||[]);
    return ids.filter(id=>!main.has(id)).map(id=>({id,label:worlds[id].label}));
  }

  function recipeDraw(w, good){
    let n = 0;
    for(const out in w.prod){ const r = GOODS[out] && GOODS[out].recipe; if(r && r[good]) n += r[good]*w.prod[out]; }
    return n;
  }
  function safety(w, good){
    const rate = (w.cons[good]||0) + recipeDraw(w, good);
    return Math.max((w.store[good]||0), rate * (w.safW||2)) + (w.prod[good]||0);  // +~1wk finished-goods buffer so producers ship surplus, not 100%
  }
  // Weekly demand (final + recipe draw) and the reorder "order-up-to" level. The
  // pipeline term covers goods in transit so stock rests near safety instead of
  // sawtoothing to zero while a long-lead shipment is still inbound.
  const PIPELINE_WK = 4;   // reorder target = safety + this much demand, so on-hand rests at the safety buffer AFTER the lead-time pipeline is accounted for (most leads are 1–4 jumps). The per-tick cap + neediest-first sort below stop this from becoming a run on producers.
  function demandFor(w, good){ return (w.cons[good]||0) + recipeDraw(w, good); }
  function orderUpTo(w, good){ const d = demandFor(w, good); return safety(w, good) + d*PIPELINE_WK; }
  function stress(w){ let m = Infinity; for(const g of SIM_GOODS){ const s = safety(w,g); if(s>0 && demandFor(w,g)>0) m = Math.min(m, stk(w.id,g)/s); } return m; }  // lowest cover ratio — neediest worlds replenish first

  function dist(src, blk){
    const D = { [src]:0 }, q = [src];
    while(q.length){ const u = q.shift(); for(const v of adj[u]){ if(D[v]==null && !blk[v]){ D[v]=D[u]+1; q.push(v); } } }
    return D;
  }
  // Memoised dist for the hot per-step paths (replenishment + trader dispatch), where `blk` is
  // constant within a step. Each source's BFS is computed at most once per (step, blocked-set),
  // not once per consumer × agent × good — the difference between ~150ms and a few ms/step at
  // ~180 worlds. Invalidated whenever the topology (adj) rebuilds. See buildTopology().
  let _distMemo = {}, _distMemoBlk = ' ';
  function distC(src, blk){
    const bk = blk ? Object.keys(blk).join(',') : '';
    if(bk !== _distMemoBlk){ _distMemo = {}; _distMemoBlk = bk; }
    return _distMemo[src] || (_distMemo[src] = dist(src, blk));
  }

  // Settle the seeded (full) stock forward a few weeks with no shocks to find each
  // world+good's natural resting level — the reference pressure() reads deviation
  // from. Runs on a scratch copy so it touches neither the live state nor the clock,
  // and is deterministic (fixed profiles/topology) → identical baseline everywhere.
  const SETTLE_WK = 16;
  function settleBaseline(seedStock){
    const prev = state;
    state = { week:0, active:false, stock: JSON.parse(JSON.stringify(seedStock)), transit:[], shocks:[], log:[] };
    for(let i=1;i<=SETTLE_WK;i++) step(i);
    const result = { stock: state.stock, transit: state.transit };   // resting stock AND the in-flight pipeline that sustains it
    state = prev;
    return result;
  }

  function freshState(){
    buildTopology();
    const seed = {};
    Object.values(worlds).forEach(w=>{ seed[w.id]={};
      SIM_GOODS.forEach(g=>{ const s = orderUpTo(w,g); if(s>0 || w.prod[g]) seed[w.id][g] = Math.round(s); }); });  // full seed (incl. pipeline)
    const settled = settleBaseline(seed);   // settle the full seed to each world+good's resting level
    const base = settled.stock;
    // Open the economy AT that resting level — AND with the in-flight pipeline that
    // sustains it — so prices start AND stay STEADY (deviation 0). Without seeding the
    // pipeline, the first weeks' consumption dips stock below base before replenishment
    // lands, reading as a phantom galaxy-wide shortage. Etas are rebased to the live week.
    const stock = {}; Object.keys(base).forEach(id=>{ stock[id] = Object.assign({}, base[id]); });
    const wk = curWeek();
    const transit = (settled.transit||[]).map(t=> Object.assign({}, t, { eta: wk + (t.eta - SETTLE_WK) }));
    // Seed the corporations + flagships (DETERMINISTIC: fixed identities, empty invests, ids
    // continuing the tr* sequence). The megacorp opens with two flagships; rivals get one. Empty
    // invests add nothing to the topology, so the base computed above is corp-free and identical
    // on every device.
    const corps = freshCorps();
    const agents = freshAgents(); let aseq = agents.length - 1;   // freshAgents → tr0..tr4 (last index 4)
    const seedList = corpSeedList();
    Object.values(corps).forEach(c=>{ const arch=seedList.find(a=>a.id===c.id), ship=arch?arch.seedShip:'subm', n=c.megacorp?2:1;
      for(let k=0;k<n;k++){ aseq++; agents.push(newCorpShip('tr'+aseq, c.name.split(' ')[0]+' Flagship'+(n>1?' '+(k+1):''), c, ship, AGENT_START_CAP)); } });
    // active:false → a fresh campaign defaults to the SIMPLE economy (static per-world
    // produces/demands pricing via simplePressure(); no stepping, no logistics). The
    // referee opts INTO the full multi-tier simulation with the Living-economy toggle,
    // which persists active:true to the shared econ-state row. NB a persisted row's
    // active flag overrides this default on load (Object.assign(freshState(),parsed)),
    // so existing campaigns keep whatever mode they saved until the referee toggles.
    return { week: wk, active:false, stock, transit, shocks:[], log:[], history:[], base, agents, tradersOn:true, traderCap: DEFAULT_TRADER_CAP, agentSeq: aseq, infl:{}, priceHist:{ wk:[], goods:{} }, psm:{}, corps, corpEvents:[], worldStatus:{}, contraband:{}, directorOn:true, director:{ last:-999, seq:0 }, factionsOn:true, factions:freshFactions(), factionEvents:[], news:[], piratesOn:true, pirates:freshPirates(), pirSeq:0 };
  }
  function ensure(){ if(!worlds) buildTopology(); if(!state) state = freshState(); }
  function stk(id,g){ return (state.stock[id] && state.stock[id][g]) || 0; }
  function setStk(id,g,v){ if(!state.stock[id]) state.stock[id]={}; state.stock[id][g]=Math.max(0,Math.round(v*100)/100); }
  function log(week, text){ state.log.unshift({week,text}); if(state.log.length>80) state.log.length=80; }

  // ── World socio-economic STATUS — a per-world condition the sim derives each referee turn from its
  //    own signals (corp expansions/failures, food cover, trade crackdowns) and surfaces as TABLE
  //    flavour: a badge on the map, an Oracle rumour, a GM hook. Lives in shared state, advanced
  //    referee-only and persisted, so every device shows identical badges. PRICE-AFFECTING only via
  //    UNREST (a restive workforce downs tools — see outputFactor); boom/bust/rationing are pure
  //    colour. Referee-overridable to the hilt (force / pin / clear — see setWorldStatus): a forced
  //    entry is src:'ref' and the auto-deriver never touches it. ──
  const WS_KINDS = ['boom','bust','unrest','rationing'];
  const WS_UNREST_OUT = [0.85, 0.65, 0.45];   // non-food output multiplier by unrest severity 1..3 (food is EXEMPT — no hunger→strike→famine doom-loop)
  const WS_BOOM_WK = 6;          // a fresh corp expansion makes a world a boomtown for this long
  const WS_FOOD_RATION = 0.85;   // foodFactor at/below this (larder thinning) → rationing
  const WS_FOOD_UNREST = 0.5;    // foodFactor at/below this (real hunger) → unrest
  const WS_META = { boom:{label:'Boomtown',icon:'▲',color:'#7ec98f'}, bust:{label:'Slump',icon:'▼',color:'#c79a6a'},
                    unrest:{label:'Unrest',icon:'⚠',color:'#e8a0a0'}, rationing:{label:'Rationing',icon:'◷',color:'#d7c26a'} };
  function wsLive(s){ return !!(s && s.kind && (s.until==null || s.until>=state.week)); }
  // ── Contraband / black markets — a trade restriction (crackdown/tariff, or a referee fiat) chokes
  //    legitimate supply of a good, so illicit demand appears: a smuggling job (emitCorpEvent) and a
  //    player-visible black-market premium (blackMarketMult). The deal itself happens at the table. ──
  const SMUGGLE_PREMIUM = 1.6;   // black-market markup on the restricted good

  function outputFactor(id, good){
    let f = 1;
    const fac = worlds[id] && worlds[id].fac;
    state.shocks.forEach(s=>{
      if(s.kind==='output' && s.target===id && (s.good==='*'||s.good===good)) f*=s.factor;            // single-world strike / failure
      else if(s.kind==='crackdown' && s.faction===fac && (s.good==='*'||s.good===good)) f*=s.factor;  // faction-wide crackdown on a good
    });
    const ws = state.worldStatus && state.worldStatus[id];     // a restive workforce downs tools — dampens NON-food output (food exempt: no hunger→strike→famine spiral)
    if(good!==FOOD_GOOD && ws && ws.kind==='unrest') f *= WS_UNREST_OUT[Math.max(0,Math.min(2,(ws.sev||1)-1))];
    return f;
  }
  // ── Consumables underpin ALL labour ─────────────────────────────────────────
  // When a world's larder runs low, the workforce doesn't turn up and EVERY OTHER
  // output falls with it. foodFactor() returns a 0..1 multiplier applied to a world's
  // NON-food production: 1.0 while there is ≥1 week of food on hand, ramping smoothly
  // to FOOD_FLOOR as the larder empties. A world's OWN food production is EXEMPT (the
  // production loop skips it) — farmers eat first, so a food shock can't recursively
  // throttle the farms that fix it (no doom-loop). Inert at baseline: every world rests
  // well above a week of cover, so foodFactor()===1 there and calm-state prices are
  // unchanged (and the deterministic settle is unperturbed).
  const FOOD_GOOD = 'Common Consumables', FOOD_THRESH_WK = 1, FOOD_FLOOR = 0.15;
  function foodFactor(id){
    const w = worlds[id]; if(!w) return 1;
    const draw = (w.cons[FOOD_GOOD]||0) + recipeDraw(w, FOOD_GOOD);
    if(draw <= 0) return 1;                                    // nobody to feed here → no labour penalty
    const cover = stk(id, FOOD_GOOD) / draw;
    if(cover >= FOOD_THRESH_WK) return 1;
    return FOOD_FLOOR + (1 - FOOD_FLOOR) * Math.max(0, cover / FOOD_THRESH_WK);   // hungry workforce → output sags toward the floor
  }
  // Demand multiplier: a 'demand' shock (e.g. a plague spiking medical demand) inflates
  // consumption of a good at a world / across a faction → a fast-biting shortage.
  function demandFactor(id, good){
    let f = 1;
    const fac = worlds[id] && worlds[id].fac;
    state.shocks.forEach(s=>{ if(s.kind==='demand' && (s.target===id || s.faction===fac) && (s.good==='*'||s.good===good)) f*=s.factor; });
    return f;
  }
  function blocked(){ const b={}; state.shocks.forEach(s=>{ if(s.kind==='block') b[s.target]=1; }); return b; }
  function embargoed(a,b){
    return state.shocks.some(s=> s.kind==='embargo' &&
      ((s.facA===worlds[a].fac && s.facB===worlds[b].fac) || (s.facB===worlds[a].fac && s.facA===worlds[b].fac)));
  }
  // Tariff: a faction taxes cross-border IMPORTS of a good, so only a fraction gets
  // through (the rest is priced out — kept at source). Softer than an embargo; the
  // tariffing faction's worlds go short of the good while it piles up abroad.
  function tariffMult(fromId, toId, good){
    const tf = worlds[toId]&&worlds[toId].fac, ff = worlds[fromId]&&worlds[fromId].fac;
    if(!tf || ff===tf) return 1;            // only bites cross-border imports INTO the tariffing faction
    let m = 1;
    state.shocks.forEach(s=>{ if(s.kind==='tariff' && s.faction===tf && (s.good==='*'||s.good===good)) m*=s.factor; });
    return m;
  }

  // ── Level-3 trader agents (Independents) ──────────────────────────────────
  // The VISIBLE, disruptable face of trade: a persistent roster of named profit-
  // motivated merchants. Each week, idle agents survey for a large standing price
  // SPREAD (buy a non-producer glut / pressure ≥ +2, sell into a real shortage /
  // pressure ≤ −2, reachable & not embargoed), haul a bounded cargo on the normal
  // transit/lead-time system, and bank profit. They sit idle when the market is calm
  // and swarm during shocks, lighting up emergent routes.
  // NOTE: economically they are ~NEUTRAL, not a convergence engine — the central
  // replenishment in step() already converges prices near-optimally, so agents are
  // deliberately gated (non-producer sources, ≥4 spread) to ADD the living-trader /
  // Independents layer without competing with logistics or churning recovery. Their
  // real payoff is legibility + a hook for convoy-escort / raid mechanics (Tier-3 #7).
  const AGENT_NAMES = ['Vasquez Holdings','The Meridian Run','Okonkwo & Daughters','Calla Drift-Freight','Red Lantern Cartage','Sable Voss Lines'];
  const AGENT_VALUE = { 'Common Consumables':50,'Common Ore':40,'Common Electronics':300,'Common Manufactured':200,'Advanced Electronics':1200,'Refined Fuel':120,'Unrefined Hydrogen':30 }; // notional Cr/kt at par
  const AGENT_START_CAP = 40000, AGENT_CAP_QTY = 12, AGENT_SPREAD_MIN = 4, PUBLIC_SPREAD_MIN = 1;
  const DISPATCH_CAP = 18;   // per-good cap on the surplus/shortage worlds traders survey (perf at ~180 worlds; the sharpest win anyway)
  // Lifecycle economics (Cr/week). Upkeep, routine milk-run income, and the public subsidy all
  // scale with HULL SIZE (bigger ships cost more to run but haul more): see upkeepOf/milkRunOf.
  // Idle traders mostly cover upkeep on milk-runs so a calm galaxy thins the herd slowly; shocks
  // are when survivors profit. PUBLIC fleets are subsidised + get a longer insolvency grace.
  const GRACE_PRIVATE = 4, GRACE_PUBLIC = 8, SPAWN_PROB = 0.35, DEFAULT_TRADER_CAP = 12, TRADER_CAP_MAX = 150;   // 12 fits the 10-ship opening fleet (5 independents/relief + 5 corp flagships) + a little commission room, so no seed ship — and no rival's only flagship — is culled on the first step. ~10ms/weekly-step at 150; stays smooth (see bench)
  // Backed traders avoid rival territory: hard = never route through it; soft = penalised but allowed.
  const FACTION_AVOID = {
    hegemony:  { hard:['rsc'],      soft:[] },
    rsc:       { hard:['hegemony'], soft:[] },
    omnisynth: { hard:[],           soft:['rsc','sanhedrin'] },
    sanhedrin: { hard:['rsc'],      soft:['omnisynth'] },
    uhc:       { hard:[],           soft:['rsc'] },
  };
  const FAC_SHORT = { hegemony:'Hegemony', rsc:'RSC', omnisynth:'OmniSynth', sanhedrin:'Sanhedrin', uhc:'UHC' };
  const NAME_A=['Vasquez','Meridian','Okonkwo','Calla','Sable','Kessler','Yuan','Brightwater','Hollow','Tamburlaine','Orsk','Cinder','Halcyon','Ferrant','Drake','Voss','Anselm','Marlow','Quill','Saffron','Greywater','Castellan'];
  const NAME_B=['Holdings','Run','& Daughters','Freight','Lines','Cartage','Hauling','Transit','Shipping','Consignment','Carriers','& Sons','Ventures','Logistics','Clipper Co.','Star-Freight'];
  // ── Lightweight Traveller-2e merchant ship classes (flavour + varied cargo holds) ──
  // Each trader flies a real T2e merchant type; cargoT (displacement tons) drives the sim
  // haul size (kt/run) so holds genuinely differ. Public/subsidised fleets favour the bigger
  // subsidised hulls. (The sim moves kilotonnes while a hull carries tens of tons — the ship
  // is a flavour/scale layer over the abstract bulk run.)
  const SHIP_CLASSES = {
    free:  { id:'free',  name:'Free Trader',         tons:200,  jump:1, cargoT:82,  haul:9,  fuelMax:80  },
    far:   { id:'far',   name:'Far Trader',          tons:200,  jump:2, cargoT:64,  haul:8,  fuelMax:80  },
    subm:  { id:'subm',  name:'Subsidised Merchant', tons:400,  jump:1, cargoT:200, haul:14, fuelMax:160 },
    fat:   { id:'fat',   name:'Fat Trader',          tons:400,  jump:1, cargoT:268, haul:16, fuelMax:160 },
    heavy: { id:'heavy', name:'Heavy Freighter',     tons:1000, jump:2, cargoT:730, haul:24, fuelMax:400 },
  };
  function shipOf(a){ return SHIP_CLASSES[(a&&a.shipId)||'free'] || SHIP_CLASSES.free; }
  // ── TASK 5: trader fuel (per ship class). Fuel lives in state.agents → synced
  //    via econ-state and mutated ONLY in the referee-run agentsStep, exactly like
  //    a.pos / a.cap, so every client reads identical fuel (no per-client divergence).
  //    fuelMax defaults to 40% of hull (matches the player ship's 200t→80t) if a
  //    class omits it. jumpFuel()/FUEL_RULES (00-core-data) give the burn — same
  //    Mongoose Traveller 2e rules the player ship uses.
  function shipFuelMax(a){ const sc=shipOf(a); return sc.fuelMax || Math.round(0.4*sc.tons); }
  function ensureAgentFuel(a){ if(a.fuelMax==null) a.fuelMax=shipFuelMax(a); if(a.fuel==null) a.fuel=a.fuelMax; }
  function pickShip(backing){ const pub=backing&&backing!=='private';
    return pick(pub ? ['subm','subm','fat','heavy','far'] : ['free','free','far','far','subm','fat']); }
  function upkeepOf(a){ return Math.round(400 + shipOf(a).haul*60); }    // bigger hull → more vessel/crew/mooring upkeep (Free ~940 … Heavy ~1840)
  function milkRunOf(a){ return Math.round(shipOf(a).haul*55); }         // routine background haulage income scales with the hold
  function subsidyOf(a){ return Math.round(upkeepOf(a)*0.6); }           // a backer covers ~60% of its public fleet's upkeep
  function agentUnitPrice(good, p, id){ return (AGENT_VALUE[good]||100) * (1 - (p||0)*0.08) * (id?overlayMult(id,good):1); }  // cheaper when glutted (p>0), dearer when short (p<0); ×price-level overlay so traders bank inflated margins
  function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
  function genAgentName(){ for(let i=0;i<8;i++){ const nm=pick(NAME_A)+' '+pick(NAME_B); if(!state.agents.some(a=>a.name===nm)) return nm; } return pick(NAME_A)+' '+pick(NAME_B); }
  // Authored campaigns get no Archon-flavoured seeds: every trader is private,
  // the corp houses don't exist, and the faction AIs stay off — the referee's
  // own factions drive politics through the shock/price levers instead.
  function authored(){ return typeof isAuthoredCampaign==='function' && isAuthoredCampaign(); }
  function pickBacking(){ if(authored() || Math.random()<0.55) return 'private'; return pick(['hegemony','omnisynth','sanhedrin','rsc','uhc']); }
  // A fresh starting roster — a mix of independents and a couple of faction relief fleets.
  function freshAgents(){
    const seed=[['private','free'],['private','far'],['hegemony','subm'],['omnisynth','fat'],['private','free']];
    if(authored()) seed.forEach(s=>{ s[0]='private'; });
    const AN = (typeof genList==='function') ? genList('trader.names', AGENT_NAMES) : AGENT_NAMES;
    return seed.map((s,i)=>({ id:'tr'+i, name:(AN[i]||AGENT_NAMES[i]||('Trader '+(i+1))), cap:AGENT_START_CAP, pos:null, route:null, trips:0, profit:0, backing:s[0], shipId:s[1], insolventWk:0, hist:[], capHist:[] }));
  }
  // ── Corporations: a THIRD backing type (alongside `private` and the factions). Pooled-capital
  //    trading houses with an IDENTITY — a specialty good + home anchor that their ships favour and
  //    their investments expand. Corp ships are ordinary state.agents with backing='corp:<id>'.
  //    Treasury sweeps profitable ships' surplus and bails out losers; treasuries grow fleets and
  //    fund world infrastructure (the corpInvest topology layer in buildTopology). LIVE-only —
  //    skipped by settleBaseline like agents — and advanced ONLY by the referee, because investments
  //    move state.base (see corpsStep guards + the load/reset/advance re-settles). ──
  const CORP_SEED_TREASURY = 90000;      // a house opens with this much working capital — just shy of its first expansion, so a few weeks of operating income tip it over (rivals are established houses, not startups)
  const CORP_FLOAT = 35000;              // operating float a corp ship keeps; surplus is swept to treasury
  const CORP_BAIL_FLOOR = 6000;          // below this, a ship is topped back toward the float (funds permitting)
  const CORP_SHIP_COST = 35000;          // capital seeded into a newly commissioned hull (drawn from treasury)
  const CORP_COMMISSION_MIN = 45000;     // treasury floor to commission another ship
  const CORP_INVEST_MIN = 100000;        // treasury floor to fund a world expansion
  const CORP_INVEST_COST = 85000;        // cost of one expansion
  const CORP_INVEST_MAX_PER_WORLD = 3;   // bounded so the galaxy drifts, not breaks
  const CORP_INVEST_GLOBAL_MAX = 18;     // galaxy-wide cap on active expansions — keeps cumulative worker-food demand inside the galaxy's surplus (verified by the balance harness) so a long campaign can't slowly starve it
  const CORP_INVEST_MAX_PER_CORP = 9;    // no single house may hold more than half the global cap — leaves room for rivals (so OmniSynth dominates but doesn't monopolise; keeps rival-vs-megacorp contracts grounded)
  // ── Operating income — the engine of a LIVING corp economy. A house's on-screen flagship only
  //    arbitrages during shocks; between them an IDLE ship actually loses money (milk-run < upkeep),
  //    so without this every treasury froze the instant its seed capital was spent — and only the
  //    megacorp's outsized seed ever funded an expansion, so OmniSynth held ~100% of ALL investment
  //    within a few turns while no rival could ever reach the invest floor. This income is the house's
  //    off-screen trade + the return on its built infrastructure: treasuries now GROW between shocks,
  //    so rivals climb to fund their own expansions and the megacorp compounds toward its cap. Pooled
  //    capital, PRICE-NEUTRAL (treasury never feeds prices), referee-advanced — the invariants hold.
  const CORP_OP_INCOME = 3000;           // weekly cashflow per active flagship (the off-screen trade the on-screen sim doesn't model)
  const CORP_INVEST_YIELD = 2500;        // weekly return per active expansion — a bigger footprint grows faster, but the 9 / global-18 invest caps keep "richer-gets-richer" from ever reaching a literal monopoly
  const CORP_TREASURY_CAP = 750000;      // reserve ceiling: a house that's hit its invest cap has nothing left to buy, so bound the idle war-chest (×2 for the megacorp) — keeps console treasuries readable
  // OmniSynth — the setting's MEGACORP. Vital to the story → SAFEGUARDED: it never dissolves and a
  // solvency floor keeps it from ever going bankrupt. It opens large and dominant; its commercial arm
  // coexists with the `omnisynth` faction relief fleets. (Treasury is not price-affecting → no
  // determinism impact; investments still obey the bounded layer + global cap, so balance holds.)
  const MEGACORP_SEED_TREASURY = 200000; // opens as the dominant economic force — a clear first-mover lead (≈2 immediate expansions) without instantly locking the rivals out
  const MEGACORP_FLOOR = 40000;          // solvency floor — its vast off-screen holdings. Below the commission threshold ON PURPOSE: guarantees it can always bail a flagship and never collapses, WITHOUT free-funding endless growth (fleet/infra growth comes from operating income, like the rivals — just faster, as it runs two flagships)
  const CORP_MAX = 6, CORP_FORM_PROB = 0.015;          // occasional new houses form, up to this many
  const CORP_OUT_BUMP = 12;              // +specialty output one expansion adds at a world (the expansion also makes its own input chain — see buildTopology — so it never starves a recipe input)
  const MONOPOLY_SHARE = 0.5;            // a house controlling ≥ this fraction of galactic output of its specialty gains pricing power (opt-in — see state.monopolyOn)
  const MONOPOLY_PREMIUM_MAX = 0.30;     // monopoly price premium caps at +30% (bounded like inflation); scales from 0 at the threshold up to full dominance
  const CORP_DEM_FOOD = 2;               // +worker food demand per expansion (small; only Common Consumables, the galaxy's most-overproduced good, has the headroom to absorb it at the invest bound)
  const CORP_SHIP_POOL = ['far','subm','fat','fat','heavy'];   // well-capitalised → mid/large hulls
  const ESCORT_VALUE_MIN = 12000;        // a corp convoy worth at least this (Cr cargo = qty·Cr/kt) is worth flagging an escort contract for — catches high-tech/luxury hauls, not cheap bulk
  const CORP_CONTRACT_PROB = 0.04;       // weekly chance a house posts a sabotage/espionage job against a rival
  const CORP_ARCHETYPES = [
    { id:'corp:meridian', name:'Meridian Fuel Combine', specialty:FUEL_REFINED,  color:'#ff9a3c', seedShip:'subm', homes:['terminus','sol','aurelia'] },
    { id:'corp:halcyon',  name:'Halcyon Luxury House',  specialty:'Luxury Goods', color:'#e75bd0', seedShip:'far',  homes:['aurelia','kronos','castor'] },
    { id:'corp:ferrant',  name:'Ferrant Ore Cartel',    specialty:'Common Ore',   color:'#b08d57', seedShip:'fat',  homes:['erebus','profit-margin','kronos'] },
  ];
  // The megacorp seed — kept SEPARATE from CORP_ARCHETYPES (formCorp must never re-roll it).
  const MEGACORP = { id:'corp:omnisynth', name:'OmniSynth Industries', specialty:'Advanced Electronics', color:'#6699ff', seedShip:'heavy', homes:['kronos','the-anvil','warehouse','profit-margin'], megacorp:true };
  function corpSeedList(){ return CORP_ARCHETYPES.concat([MEGACORP]); }
  function isCorp(b){ return typeof b==='string' && b.indexOf('corp:')===0; }
  function corpOf(b){ return (state && state.corps && state.corps[b]) || null; }
  function corpHomeOf(a){ const h=(a.homes||[]).find(id=>worlds && worlds[id]); return h || (a.homes&&a.homes[0]) || null; }
  function newCorpShip(id, name, corp, shipId, cap){ return { id, name, cap, pos:null, route:null, trips:0, profit:0, backing:corp.id, shipId, insolventWk:0, hist:[], capHist:[] }; }
  function freshCorps(){ const out={};
    if(authored()) return out;   // authored campaigns: no OmniSynth & co — houses form organically (formCorp) or not at all
    corpSeedList().forEach(a=>{   // deterministic seed (empty invests → corp-free base) — 3 rivals + the OmniSynth megacorp
    out[a.id]={ id:a.id, name:a.name, specialty:a.specialty, color:a.color, home:corpHomeOf(a),
      treasury: a.megacorp?MEGACORP_SEED_TREASURY:CORP_SEED_TREASURY, invests:[], founded:0, megacorp: !!a.megacorp }; }); return out; }
  function traderCapOf(){ return Math.max(3, Math.min(TRADER_CAP_MAX, (state&&state.traderCap)||DEFAULT_TRADER_CAP)); }
  function factionOf(id){ return worlds[id] && worlds[id].fac; }
  // 0 = fine, 1 = soft-avoid (penalised), 2 = hard-avoid (impassable) for a backed trader.
  function avoidLevel(backing, id){
    if(!backing || backing==='private' || isCorp(backing)) return 0;   // corps trade for profit, anywhere — no territory avoidance
    const fac=factionOf(id), rel=FACTION_AVOID[backing];
    if(!rel||!fac||fac===backing) return 0;
    if(rel.hard.includes(fac)) return 2;
    if(rel.soft.includes(fac)) return 1;
    return 0;
  }
  function agentBlockSet(a, blk){
    if(!a.backing || a.backing==='private' || isCorp(a.backing)) return blk;   // corps ignore faction territory
    const set=Object.assign({}, blk);
    Object.keys(worlds).forEach(id=>{ if(avoidLevel(a.backing,id)===2) set[id]=1; });   // hostile space is impassable
    return set;
  }
  // A convoy can only set out from a world where it can refuel: a fuel-starved source halts
  // trade out of it — the fuel→trade coupling (mirror of food→output).
  function fueled(id){
    const f=factsOf(id); if(!f||f.port==='X'||!f.port) return false;
    const g=(f.port==='A'||f.port==='B')?FUEL_REFINED:FUEL_HYDRO, w=worlds[id]; if(!w) return false;
    const draw=(w.cons[g]||0); if(draw<=0) return true;
    return stk(id,g)/draw >= 0.5;
  }
  function removeAgent(a, reason, week){
    if(a.route){ const i=state.transit.findIndex(t=>t.agent===a.id && t.to===a.route.to && t.good===a.route.good); if(i>=0) state.transit.splice(i,1); }
    const idx=state.agents.indexOf(a); if(idx>=0) state.agents.splice(idx,1);
    log(week, `⚑ ${a.name} — ${reason}`);
  }
  function spawnAgent(week){
    const backing=pickBacking();
    state.agentSeq=(state.agentSeq||state.agents.length)+1;
    state.agents.push({ id:'tr'+state.agentSeq, name:genAgentName(), cap:AGENT_START_CAP, pos:null, route:null, trips:0, profit:0, backing, shipId:pickShip(backing), insolventWk:0, hist:[], capHist:[] });
    const tag = backing==='private' ? 'independent' : (FAC_SHORT[backing]||backing)+'-backed';
    log(week, `✦ New trader — ${state.agents[state.agents.length-1].name} (${tag})`);
  }

  function agentsStep(week){
    if(!state.agents || state.tradersOn===false) return;
    state.agents.forEach(ensureAgentFuel);   // TASK 5: give legacy/loaded agents fuel fields (idempotent)
    const blk = blocked(), goods = SIM_GOODS.filter(g=>!GOODS[g].internal);
    // Pool the imbalanced worlds per good once (cheap — empty at baseline).
    const pool = {};
    goods.forEach(g=>{ const sur=[], sho=[];
      Object.keys(worlds).forEach(id=>{ if(blk[id]) return; const p=rawPressure(id,g); if(p==null) return;
        // Source only from NON-producer gluts: consumer worlds that overshot above their
        // baseline. Producer surplus is already allocated optimally (neediest-first) by
        // replenishment, so skimming it just misallocates and starves other worlds.
        if(p>=2 && !worlds[id].prod[g]){ const room=stk(id,g)-refOf(id,g); if(room>0) sur.push({id,p,room}); }
        else if(p<=-2){ const room=refOf(id,g)-stk(id,g); if(room>0) sho.push({id,p,room}); } });
      // Cap each side to the sharpest DISPATCH_CAP — a trader only ever picks the highest score
      // (sharp pressure ÷ short distance), so the deepest gluts/shortages are all that can win.
      // Bounds dispatch to O(agents×goods×cap²) regardless of galaxy size (was O(worlds²) at ~180 worlds).
      if(sur.length>DISPATCH_CAP) sur.sort((a,b)=>b.p-a.p).length=DISPATCH_CAP;
      if(sho.length>DISPATCH_CAP) sho.sort((a,b)=>a.p-b.p).length=DISPATCH_CAP;
      pool[g]={sur,sho}; });
    // Arrivals: bank profit, log the trip, reposition (the cargo itself lands via state.transit).
    state.agents.forEach(a=>{ if(a.route && a.route.eta<=week){
      const sp=rawPressure(a.route.to,a.route.good), sellUnit=agentUnitPrice(a.route.good, sp!=null?sp:0, a.route.to);
      const tprofit=Math.round(a.route.qty*(sellUnit-a.route.buyUnit));
      a.cap += a.route.qty*sellUnit; a.profit += tprofit; a.trips++;
      a.hist=a.hist||[]; a.hist.unshift({ wk:week, good:a.route.good, from:a.route.from, to:a.route.to, qty:Math.round(a.route.qty*10)/10, profit:tprofit });
      if(a.hist.length>12) a.hist.length=12;                            // recent-trips ledger for the detail panel
      a.pos=a.route.to; a.route=null; } });

    // ── Living-market lifecycle: upkeep, subsidy, milk-run, bankruptcy, market entry ──
    for(let i=state.agents.length-1;i>=0;i--){ const a=state.agents[i];
      const corp = isCorp(a.backing);                  // corps draw NO faction subsidy — their treasury sweeps/bails them in corpsStep
      const pub = a.backing && a.backing!=='private' && !corp;
      a.upkeep = upkeepOf(a);
      a.cap -= a.upkeep;                                // vessel + crew wages + mooring fees (scales with hull)
      if(pub) a.cap += subsidyOf(a);                   // faction props up its relief fleet
      if(!a.route) a.cap += milkRunOf(a);              // routine background haulage when not on a big run
      if(a.cap<=0) a.insolventWk=(a.insolventWk||0)+1; else a.insolventWk=0;
      a.capHist=a.capHist||[]; a.capHist.push({ wk:week, cap:Math.round(a.cap) }); if(a.capHist.length>24) a.capHist.shift();   // weekly P&L sample for the sparkline
      if((a.insolventWk||0) >= ((pub||corp)?GRACE_PUBLIC:GRACE_PRIVATE)) removeAgent(a, 'insolvent — ceased trading', week);
    }
    const cap = traderCapOf();
    while(state.agents.length > cap){ let weak=state.agents[0]; state.agents.forEach(a=>{ if(a.cap<weak.cap) weak=a; }); removeAgent(weak,'stood down (fleet cap reduced)',week); }
    if(state.agents.length < cap && Math.random() < SPAWN_PROB) spawnAgent(week);

    // ── Dispatch — idle agents pick a route. Pool rooms decrement so convoys spread out. ──
    const executeRoute=(a,best)=>{
      if(!fueled(best.b.id)) return;                                  // fuel-starved source → convoy can't depart
      const buyUnit=agentUnitPrice(best.g,best.b.p,best.b.id);
      let qty=Math.min(shipOf(a).haul,best.b.room,best.s.room);        // cargo cap = this trader's ship class
      if(buyUnit>0) qty=Math.min(qty,Math.floor(a.cap/buyUnit));
      qty*=tariffMult(best.b.id,best.s.id,best.g);                    // tariff prices the convoy down at the border
      qty=Math.round(qty*100)/100; if(qty<0.5) return;
      // Deadhead: fly EMPTY from the trader's current berth to the cargo source, THEN laden to
      // the destination — so the convoy marker is continuous and never teleports between trips.
      const src=best.b.id, dst=best.s.id, startPos=a.pos||src;
      let dead=0; if(startPos!==src){ const D=dist(startPos,agentBlockSet(a,blk)); if(D[src]!=null) dead=D[src]; }   // deadhead also routes around hostile space for backed fleets
      const tripWk=dead+Math.max(1,best.dist), eta=week+tripWk;
      // ── TASK 5: fuel. The trader tops off during its berth IF this world can
      //    supply fuel; a fuel-STARVED berth (an economy fuel shortage — fueled()
      //    reads the Refined-Fuel/Hydrogen stock) forces a dry trader to HOLD here
      //    until it restocks, which shows in the referee's docked-traders panel.
      ensureAgentFuel(a);
      const need = jumpFuel(shipOf(a).tons, dead + Math.max(1,best.dist));   // MgT2e 10%×hull×pc — same FUEL_RULES as the player ship
      if(fueled(startPos)){ a.fuel = a.fuelMax; a.fuelWait = false; }         // refuel service at the berth
      else if((a.fuel||0) < need){ a.fuelWait = true; return; }              // dry & no fuel here → wait at port (dispatch aborts)
      a.fuel = Math.max(0, a.fuel - need); a.fuelWait = false;
      // Berthing: the ship sits at port 1–7 days before setting off (crew rest, loading,
      // repairs). The weekly cargo clock is unchanged — this is the port pause you see when
      // day-stepping: the marker idles at its berth until `began`, then flies the same route.
      const berthDays=1+Math.floor(Math.random()*7), berth=Math.min(berthDays/7, tripWk*0.7);
      setStk(src,best.g, stk(src,best.g)-qty); a.cap-=qty*buyUnit;
      state.transit.push({ good:best.g, qty, from:src, to:dst, eta, agent:a.id });
      a.route={ from:startPos, pickup:src, to:dst, good:best.g, qty, buyUnit, began:week+berth, eta, berthDays };
      a.pos=startPos; best.b.room-=qty; best.s.room-=qty;
      log(week, `${a.name}: ${qty}kt ${best.g.replace('Common ','')} ${worlds[src].label}→${worlds[dst].label}`);
    };
    // BACK-HAUL first: chain out of the trader's CURRENT berth (zero deadhead) — pick up a
    // good this world has surplus of (incl. its own production) and run it to a reachable
    // shortage. So a ship that drops food at Sol then carries Sol's high-tech onward, like a
    // real tramp freighter, instead of flying empty to the next glut. Opportunistic (a lower
    // price-gap bar than a deadhead run), and only ever fires when a real shortage exists, so
    // it adds no baseline activity. Sourcing a producer's surplus is allowed HERE only (the
    // global dispatch still steers clear of producer surplus to avoid fighting replenishment).
    const dispatchBackhaul=(a)=>{
      const pos=a.pos; if(!pos||!worlds[pos]||!fueled(pos)) return false;
      const F=(a.backing&&a.backing!=='private'&&!isCorp(a.backing))?a.backing:null, aBlk=agentBlockSet(a,blk);   // corps back-haul like independents (profit spread, no territory)
      if(aBlk[pos]) return false;
      const D=dist(pos,aBlk), minGap=F?PUBLIC_SPREAD_MIN:2; let best=null;
      goods.forEach(g=>{
        const surplus=stk(pos,g)-safety(worlds[pos],g); if(surplus<0.5) return;   // exportable surplus here
        const pSrc=rawPressure(pos,g); if(pSrc==null) return;
        const P=pool[g]; if(!P||!P.sho.length) return;
        P.sho.forEach(s=>{ if(s.room<=0||s.id===pos||aBlk[s.id]||D[s.id]==null||embargoed(pos,s.id)) return;
          if(F&&avoidLevel(F,s.id)===2) return;
          if((pSrc-s.p)<minGap) return;                                            // still want a worthwhile gap
          const score=F ? (-s.p + (factionOf(s.id)===F?2:0) - (avoidLevel(F,s.id)===1?2:0))/Math.max(1,D[s.id])
                        : (pSrc-s.p)/Math.max(1,D[s.id]);
          if(score>0 && (!best||score>best.score)) best={ b:{id:pos,p:pSrc,room:surplus}, s, g, dist:D[s.id], score }; });
      });
      if(best){ executeRoute(a,best); return true; }
      return false;
    };
    // PRIVATE merchants chase the fattest profit per jump, anywhere.
    const dispatchPrivate=(a)=>{
      const corp=corpOf(a.backing), spec=corp&&corp.specialty; let best=null;   // corp ships favour hauling their specialty good (identity)
      goods.forEach(g=>{ const P=pool[g]; if(!P.sur.length||!P.sho.length) return;
        P.sur.forEach(b=>{ if(b.room<=0) return; const D=distC(b.id,blk);
          P.sho.forEach(s=>{ if(s.room<=0||s.id===b.id||D[s.id]==null||embargoed(b.id,s.id)) return;
            const spread=b.p-s.p; if(spread<AGENT_SPREAD_MIN) return;
            let score=spread/Math.max(1,D[s.id]); if(spec&&g===spec) score*=1.5;
            if(!best||score>best.score) best={b,s,g,dist:D[s.id],score}; }); }); });
      if(best) executeRoute(a,best);
    };
    // PUBLIC relief fleets carry into the DEEPEST shortage in friendly space, routing around
    // hostile territory (hard-avoid is impassable; soft-avoid is penalised; own-faction favoured).
    const dispatchPublic=(a)=>{
      const F=a.backing, aBlk=agentBlockSet(a,blk); let best=null;
      goods.forEach(g=>{ const P=pool[g]; if(!P.sur.length||!P.sho.length) return;
        P.sho.forEach(s=>{ if(s.room<=0||aBlk[s.id]||avoidLevel(F,s.id)===2) return;
          P.sur.forEach(b=>{ if(b.room<=0||aBlk[b.id]||b.id===s.id||embargoed(b.id,s.id)) return;
            const spread=b.p-s.p; if(spread<PUBLIC_SPREAD_MIN) return;   // subsidised → runs on thin margins
            const D=distC(b.id,aBlk); if(D[s.id]==null) return;
            const depth=-s.p, ownBonus=(factionOf(s.id)===F)?2:0;
            const softPen=(avoidLevel(F,s.id)===1?2:0)+(avoidLevel(F,b.id)===1?1:0);
            const score=(depth+ownBonus-softPen)/Math.max(1,D[s.id]);
            if(score>0 && (!best||score>best.score)) best={b,s,g,dist:D[s.id],score}; }); }); });
      if(best) executeRoute(a,best);
    };
    state.agents.forEach(a=>{ if(a.route) return;
      if(dispatchBackhaul(a)) return;                                              // chain out of the current berth (no deadhead)
      if(a.backing && a.backing!=='private' && !isCorp(a.backing)) dispatchPublic(a); else dispatchPrivate(a); });   // faction → relief routing; corp/independent → profit-first
  }

  // ── Corp lifecycle helpers ──
  function corpShipName(c){ return c.name.split(' ')[0]+' '+pick(['Clipper','Hauler','Lighter','Carrier','Star-Freight','Runner']); }
  function investCountAt(worldId){ let n=0; Object.values(state.corps).forEach(c=>{ (c.invests||[]).forEach(iv=>{ if(iv.world===worldId) n++; }); }); return n; }
  function totalInvests(){ let n=0; Object.values(state.corps).forEach(c=>{ n+=(c.invests||[]).length; }); return n; }
  // Galaxy-wide output of a good (already includes the corp-invest layer baked into worlds[].prod by buildTopology).
  function galacticProd(good){ let s=0; Object.keys(worlds).forEach(id=>{ s+=(worlds[id].prod[good]||0); }); return s; }
  // A corp's share of galactic output of its SPECIALTY. Each of its expansions adds CORP_OUT_BUMP of that
  // good (all invests are for the specialty — see corpsStep step 3), so its contribution is invests×bump.
  function corpSpecialtyShare(c){ if(!c||!c.specialty) return 0; const tot=galacticProd(c.specialty); if(tot<=0) return 0;
    return Math.min(1, ((c.invests||[]).length * CORP_OUT_BUMP) / tot); }
  // Monopoly pricing premium for a good — OPT-IN (state.monopolyOn) and full-sim only, gated exactly like
  // inflation so the deterministic baseline is untouched (scratch settle state has no .corps / active=false).
  // Galaxy-wide for the dominated good; takes the strongest dominator if several qualify.
  function monopolyMult(id, good){
    if(!state.active || !state.monopolyOn || !state.corps) return 1;
    let m=1; Object.values(state.corps).forEach(c=>{ if(c.defunct||!c.monopoly) return;
      if(c.monopoly.good===good && c.monopoly.mult>m) m=c.monopoly.mult; }); return m;
  }
  function pickInvestWorld(c){   // a world this corp "works": already produces its specialty, or its home — bounded ≤3 invests/world (total)
    const cand=Object.keys(worlds).filter(id=> (worlds[id].prod[c.specialty]>0 || id===c.home) && investCountAt(id) < CORP_INVEST_MAX_PER_WORLD);
    if(!cand.length) return null;
    if(c.home && cand.indexOf(c.home)>=0) return c.home;            // grow the home base first
    return pick(cand);
  }
  // ── Corp CONTRACT opportunities — the (a) follow-on, now live. The sim FLAGS jobs the corps would
  //    pay players for (escort/haul/sabotage/espionage/bounty); the referee DRAFTS one into the Quest
  //    Log or Library Data (js/85-records CORP_CONTRACT templates + the console section). Pure flavour
  //    — never price-affecting; referee-advanced; deduped so the list doesn't flood. ──
  function emitCorpEvent(type, corp, data){
    if(!state.corpEvents) state.corpEvents=[];
    state.corpEvents.push(Object.assign({ type, corp:corp.id, wk:state.week }, data||{}));
    if(state.corpEvents.length>40) state.corpEvents.shift();
  }
  function hasCorpEvent(pred){ return (state.corpEvents||[]).some(pred); }
  // A corp's natural rival: a same-specialty competitor if any, else the megacorp (everyone resents
  // OmniSynth), else any other house. Grounds sabotage/espionage contracts. (Full (c) faction
  // alignment stays a TODO.)
  function rivalOf(c){
    const others = Object.values(state.corps).filter(x=>!x.defunct && x.id!==c.id);
    if(!others.length) return null;
    const same = others.filter(x=>x.specialty===c.specialty); if(same.length) return pick(same);
    const mega = others.find(x=>x.megacorp); if(mega) return mega;
    return pick(others);
  }
  function round100(n){ return Math.max(0, Math.round(n/100)*100); }
  // Suggested Cr reward for a contract (referee can adjust at the table). Scales with cargo value /
  // the hiring house's treasury so big jobs pay big. Displayed via econMoney.
  function contractRewardOf(e){
    const c = state.corps && state.corps[e.corp], cargo = (e.qty||0)*(AGENT_VALUE[e.good]||100);
    switch(e.type){
      case 'escort':    return Math.max(2500, round100(cargo*0.18));
      case 'bounty':    return Math.max(4000, round100(cargo*0.40));
      case 'haul':      return Math.max(3500, round100((AGENT_VALUE[e.good]||120)*45));
      case 'sabotage':  return Math.max(6000, round100((c?c.treasury:60000)*0.05));
      case 'espionage': return Math.max(4500, round100((c?c.treasury:60000)*0.035));
      case 'smuggle':   return Math.max(5000, round100(cargo*0.5));   // illicit risk pays — a premium over the legit haul rate
      default:          return 5000;
    }
  }
  // Raw corpEvent → rich, fully-labelled "contract intel" item (the shape intel() emits and the
  // console + 85-records draftCorpContract() consume). Single source of truth for contract display.
  function corpContractItem(e){
    if(!state.corps) return null; const c = state.corps[e.corp]; if(!c) return null;
    const tgt = e.target ? state.corps[e.target] : null;
    const wl = id => (id && worlds[id]) ? worlds[id].label : (id||null);
    return { kind:'contract', contract:e.type, corp:c.id, label:c.name, color:c.color,
      target:e.target||null, targetName: tgt?tgt.name:(e.targetName||null),
      world:e.world||null, place: wl(e.world),
      good: e.good||c.specialty, vessel:e.vessel||null,
      from:e.from||null, fromLabel: wl(e.from), to:e.to||null, toLabel: wl(e.to),
      qty:e.qty||null, reward: contractRewardOf(e), wk:e.wk };
  }
  function maybeSpikeUnrest(world){ /* TODO(b): a corp expansion can spike UNREST at the world — referee flag (displaced labour / resource grab). Wire to a shared state.unrest map + console toggle. */ }
  function formCorp(week){
    const used=new Set(Object.keys(state.corps));
    const arch=CORP_ARCHETYPES.find(a=>!used.has(a.id)); let corp;
    if(arch){ corp={ id:arch.id, name:arch.name, specialty:arch.specialty, color:arch.color, home:corpHomeOf(arch), treasury:CORP_SEED_TREASURY, invests:[], founded:week }; }
    else { let id; do { id='corp:n'+Math.floor(Math.random()*1e6).toString(36); } while(state.corps[id]);   // procedural house beyond the 3 archetypes
      const spec=pick([FUEL_REFINED,'Luxury Goods','Common Ore','Common Electronics','Pharmaceuticals']);
      const homes=Object.keys(worlds).filter(wid=>worlds[wid].prod[spec]>0);
      corp={ id, name:pick(NAME_A)+' '+pick(['Combine','Cartel','Consortium','Holdings','Industries','Group']), specialty:spec,
        color:pick(['#ff9a3c','#e75bd0','#b08d57','#6fd0c0','#d0c040','#ff7a7a']), home:homes.length?pick(homes):pick(Object.keys(worlds)),
        treasury:CORP_SEED_TREASURY, invests:[], founded:week }; }
    state.corps[corp.id]=corp;
    state.agentSeq=(state.agentSeq||state.agents.length)+1;
    state.agents.push(newCorpShip('tr'+state.agentSeq, corpShipName(corp), corp, arch?arch.seedShip:pick(CORP_SHIP_POOL), CORP_SHIP_COST));
    log(week, `✦ A new trading house forms — ${corp.name} (${corp.specialty.replace('Common ','')})`);
  }
  // Weekly corp turn: operating income, pooled-funds sweep/bail, fleet growth, infrastructure
  // investment, formation & dissolution. REFEREE-ONLY (investments move state.base; cross-device
  // determinism, invariant #4) and skipped by settleBaseline (scratch state has no `corps`). Records
  // investments only — the base re-settle is batched once per advance (see advance/syncToDate).
  // Tune the corp-balance constants with the headless harness: node tools/econ-corp-harness.cjs
  function corpsStep(week){
    if(!state.corps || state.tradersOn===false || !state.active) return;
    if(typeof isReferee==='function' && !isReferee()) return;
    const cap=traderCapOf();
    Object.values(state.corps).forEach(c=>{ if(c.defunct) return;
      if(c.megacorp && c.treasury < MEGACORP_FLOOR) c.treasury = MEGACORP_FLOOR;   // OmniSynth solvency floor — it can always bail a flagship & never collapses (vast off-screen holdings)
      const ships=state.agents.filter(a=>a.backing===c.id);          // re-scan each week — agentsStep splices on bankruptcy/spawn
      // 0) Operating income (see CORP_OP_INCOME) — accrue BEFORE the spend decisions so a house can act on
      //    it the same week. Scales with the active footprint (flagships + expansions) and is bounded by a
      //    reserve ceiling so an idle, fully-expanded house never piles up an unreadable war-chest.
      const tcap=(c.megacorp?2:1)*CORP_TREASURY_CAP;
      if(c.treasury < tcap) c.treasury = Math.min(tcap, c.treasury + CORP_OP_INCOME*ships.length + CORP_INVEST_YIELD*(c.invests||[]).length);
      // 1) Sweep ship surplus over the working float into the treasury; bail red ships back toward it.
      ships.forEach(a=>{
        if(a.cap > CORP_FLOAT){ c.treasury += a.cap-CORP_FLOAT; a.cap=CORP_FLOAT; }
        else if(a.cap < CORP_BAIL_FLOOR){ const give=Math.min(CORP_FLOAT-a.cap, c.treasury); if(give>0){ a.cap+=give; c.treasury-=give; } }
      });
      // 2) Fleet growth — commission a hull when flush & there's room under the cap (reuse agentSeq → no id collision).
      if(c.treasury >= CORP_COMMISSION_MIN && state.agents.length < cap){
        state.agentSeq=(state.agentSeq||state.agents.length)+1;
        const shipId=pick(CORP_SHIP_POOL), nm=corpShipName(c);
        state.agents.push(newCorpShip('tr'+state.agentSeq, nm, c, shipId, CORP_SHIP_COST));
        c.treasury-=CORP_SHIP_COST;
        log(week, `✦ ${c.name} commissions the ${nm} (${SHIP_CLASSES[shipId].name})`);
      }
      // 3) Infrastructure investment — expand a world it works (≤3/world, ≤global cap). Moves base → defer the re-settle.
      else if(c.treasury >= CORP_INVEST_MIN && totalInvests() < CORP_INVEST_GLOBAL_MAX && (c.invests||[]).length < CORP_INVEST_MAX_PER_CORP){
        const target=pickInvestWorld(c);
        if(target){ c.invests.push({ world:target, wk:week }); c.treasury-=CORP_INVEST_COST; state._corpDirty=true;
          log(week, `⚒ ${c.name} expands ${c.specialty.replace('Common ','')} at ${worlds[target].label}`);
          emitCorpEvent('haul', c, { world:target, good:'Common Manufactured' });   // an expansion needs equipment hauled in → a delivery contract
          maybeSpikeUnrest(target);
        }
      }
      // 4) Contract opportunities (flavour; deduped). A valuable convoy wants ESCORT; rivalry breeds
      //    occasional SABOTAGE / ESPIONAGE jobs against a rival house.
      const conv = ships.find(a=> a.route && a.route.good && a.route.qty*(AGENT_VALUE[a.route.good]||100) >= ESCORT_VALUE_MIN);
      if(conv && !hasCorpEvent(e=>e.type==='escort' && e.agent===conv.id))
        emitCorpEvent('escort', c, { agent:conv.id, vessel:conv.name, from:conv.route.from, to:conv.route.to, good:conv.route.good, qty:Math.round(conv.route.qty) });
      if(Math.random() < CORP_CONTRACT_PROB){ const r=rivalOf(c);
        if(r){ const t = Math.random()<0.5 ? 'sabotage' : 'espionage';
          if(!hasCorpEvent(e=>e.type===t && e.corp===c.id && e.target===r.id)) emitCorpEvent(t, c, { target:r.id, targetName:r.name }); } }
      // 5) Weekly P&L sample — NET WORTH (treasury + fleet capital), same {wk,cap} shape agents use so
      //    econSparkline renders it unchanged. Net worth, not bare treasury: commissioning a hull / an
      //    investment only moves cash into a ship or infrastructure, so this reads as real growth, not loss.
      c.capHist=c.capHist||[];
      const net = c.treasury + state.agents.filter(a=>a.backing===c.id).reduce((s,a)=>s+(a.cap||0),0);   // re-scan: includes a hull commissioned this week (treasury↓ offset by the new ship's cap → no false dip)
      c.capHist.push({ wk:week, cap:Math.round(net) }); if(c.capHist.length>24) c.capHist.shift();
      // 6) Monopoly flag — dominance of the corp's specialty good. Stored in shared state (persisted,
      //    referee-advanced) but only ACTUALLY moves prices when state.monopolyOn (see monopolyMult).
      const share = corpSpecialtyShare(c);
      c.monopoly = (share >= MONOPOLY_SHARE)
        ? { good:c.specialty, share:Math.round(share*100)/100, mult: 1 + MONOPOLY_PREMIUM_MAX * Math.min(1, (share-MONOPOLY_SHARE)/(1-MONOPOLY_SHARE)) }
        : null;
    });
    // New houses occasionally form; broke + shipless ones dissolve (keep invests as a defunct shell → no base churn).
    if(Object.values(state.corps).filter(c=>!c.defunct).length < CORP_MAX && Math.random() < CORP_FORM_PROB) formCorp(week);
    Object.values(state.corps).forEach(c=>{ if(c.defunct || c.megacorp) return;   // the megacorp (OmniSynth) is SAFEGUARDED — it never dissolves (vital to the story)
      if(c.treasury < 0 && !state.agents.some(a=>a.backing===c.id)){
        if((c.invests||[]).length){ c.defunct=true; log(week, `⚑ ${c.name} — insolvent; its assets are bought out`); }
        else { delete state.corps[c.id]; log(week, `⚑ ${c.name} — folded`); }
      }
    });
    // TODO(c): corp↔faction alignment/rivalry — an aligned corp could inherit its patron's avoidLevel; a rival could be embargoed. (rivalOf() below is a first step.)
    // TODO(d): OmniSynth is the built-in megacorp (megacorp:true, safeguarded). Next: maybeConsolidate() — OmniSynth absorbs a dissolved rival's fleet + invests; and a monopoly-pricing flag (corp.monopoly feeding overlayMult) once a house dominates a good. Monopoly pricing is PRICE-AFFECTING → must live in shared state + referee-advanced like inflation.
  }

  // Convoy raid — intercept a trader's in-flight cargo. The goods are destroyed/stolen
  // so they never land (the destination is DENIED the relief it was counting on), and
  // the merchant eats the loss. This is what makes the Independents' routes vulnerable
  // and the RSC raider threat bite: a referee preys on a specific convoy, and players
  // who escort one prevent exactly this.
  function raidConvoy(agentId){
    ensure();
    const a = (state.agents||[]).find(x=>x.id===agentId);
    if(!a || !a.route) return { ok:false, msg:'No active convoy to raid' };
    const r = a.route;
    const i = state.transit.findIndex(t=> t.agent===a.id && t.good===r.good && t.to===r.to);   // match the agent's cargo (its from = pickup, not the deadhead origin)
    if(i>=0) state.transit.splice(i,1);            // cargo lost → never lands → destination stays short
    const loss = Math.round(r.qty * r.buyUnit);    // sunk purchase cost (cap already paid at dispatch)
    a.profit -= loss; a.raided = (a.raided||0)+1; a.pos = r.from; a.route = null;   // survivor limps home empty
    log(state.week, `⚔ Convoy raided — ${a.name} lost ${r.qty}kt ${r.good.replace('Common ','')} on ${worlds[r.from]?worlds[r.from].label:r.from}→${worlds[r.to]?worlds[r.to].label:r.to}`);
    if(isCorp(a.backing) && corpOf(a.backing) && !hasCorpEvent(e=>e.type==='bounty' && e.agent===a.id))   // a raided HOUSE posts a bounty on the raiders
      emitCorpEvent('bounty', corpOf(a.backing), { agent:a.id, vessel:a.name, from:r.from, to:r.to, good:r.good, qty:Math.round(r.qty) });
    save();
    return { ok:true, agent:a.name, good:r.good, qty:r.qty, to:(worlds[r.to]?worlds[r.to].label:r.to), loss };
  }

  // ── World-status + contraband derivation (referee-only, persisted). Deterministic — reads stock/corp
  //    /shock state, no randomness — so the unrest output effect (via outputFactor) stays identical on
  //    every device once the referee's advance is saved. Called from step() after corpsStep. ──
  function worldStatusStep(week){
    if(!state.active) return;
    if(typeof isReferee==='function' && !isReferee()) return;
    if(!state.worldStatus) state.worldStatus={};
    const ws=state.worldStatus;
    Object.keys(ws).forEach(id=>{ const s=ws[id]; if(s && s.until!=null && s.until<week) delete ws[id]; });   // expire timed conditions (ref or auto)
    const boomAt={};   // world → wk of its most recent still-fresh corp expansion
    Object.values(state.corps||{}).forEach(c=>{ if(c.defunct) return; (c.invests||[]).forEach(iv=>{
      if(iv.wk!=null && week-iv.wk>=0 && week-iv.wk<WS_BOOM_WK) boomAt[iv.world]=Math.max(boomAt[iv.world]||0, iv.wk); }); });
    Object.keys(worlds).forEach(id=>{
      const cur=ws[id]; if(cur && cur.src==='ref') return;        // referee owns this world's status → hands off
      let kind=null, sev=1, until=null;
      const ff=foodFactor(id);
      const crackdownHere=state.shocks.some(s=> (s.kind==='crackdown'&&s.faction===worlds[id].fac) || (s.kind==='output'&&s.target===id&&s.factor!=null&&s.factor<0.4));
      if(ff<=WS_FOOD_UNREST || crackdownHere){ kind='unrest'; sev = ff<=0.3?3:(ff<=WS_FOOD_UNREST?2:1); }   // real hunger or a heavy crackdown → strikes/riots
      else if(ff<=WS_FOOD_RATION){ kind='rationing'; sev = ff<=0.7?2:1; }                                   // larder thinning → ration cards, relief convoys
      else if(boomAt[id]!=null){ kind='boom'; until=boomAt[id]+WS_BOOM_WK; }                                // a fresh corp expansion → jobs, newcomers, crime
      else { const liveHere=Object.values(state.corps||{}).some(c=>!c.defunct&&(c.invests||[]).some(iv=>iv.world===id));
             const deadHere=Object.values(state.corps||{}).some(c=>c.defunct&&(c.invests||[]).some(iv=>iv.world===id));
             if(deadHere&&!liveHere) kind='bust'; }                                                          // a house pulled out and nobody filled the gap → slump
      if(kind) ws[id]={ kind, sev, since:(cur&&cur.kind===kind?cur.since:week), until, src:'auto' };
      else if(cur && cur.src==='auto') delete ws[id];
    });
  }
  function maybeEmitSmuggle(id, good, week){
    if(hasCorpEvent(e=>e.type==='smuggle' && e.world===id && e.good===good)) return;      // dedupe live offers
    const corps=Object.values(state.corps||{}).filter(c=>!c.defunct); if(!corps.length) return;
    const sponsor=corps.find(c=>c.specialty===good) || corps.find(c=>c.megacorp) || corps[0];   // who wants product run past the blockade
    emitCorpEvent('smuggle', sponsor, { world:id, good, qty:10 });
  }
  function contrabandStep(week){
    if(!state.active) return;
    if(typeof isReferee==='function' && !isReferee()) return;
    if(!state.contraband) state.contraband={};
    const cb=state.contraband;
    Object.keys(cb).forEach(id=>{ const s=cb[id]; if(s && s.until!=null && s.until<week) delete cb[id]; });
    Object.keys(worlds).forEach(id=>{
      const cur=cb[id]; if(cur && cur.src==='ref'){ maybeEmitSmuggle(id, cur.good, week); return; }   // referee-planted markets persist + keep a job on offer
      let good=null;
      for(const s of state.shocks){ if((s.kind==='crackdown'||s.kind==='tariff') && s.faction===worlds[id].fac && s.good && s.good!=='*'){ good=s.good; break; } }
      if(good){ cb[id]={ good, since:(cur&&cur.good===good?cur.since:week), until:null, premium:SMUGGLE_PREMIUM, src:'auto' }; maybeEmitSmuggle(id, good, week); }
      else if(cur && cur.src==='auto') delete cb[id];
    });
  }

  // ── EVENT DIRECTOR — the galaxy makes its own trouble ─────────────────────────
  // Everything above REACTS — to a referee-fired shock, a price gap, a corp's move; nothing
  // ORIGINATES a crisis on its own, so an untouched galaxy only ever moves when the referee
  // clicks a preset. The director closes that loop. Each referee turn it reads the sim's OWN
  // signals (unrest that's festered long enough to spread, a monopolist's grip on a good, a
  // boomtown drawing crime, or just a calm week gone too quiet) and FIRES ITS OWN SHOCK —
  // reusing the exact shock KINDS the rest of the engine already consumes, so a director event
  // flows through outputFactor / demandFactor / tariffMult, the worldStatus derivation, the
  // black-market/contraband layer, the Oracle's true-rumour intel() and the console timeline
  // with ZERO new plumbing. The director only ORIGINATES the shock the referee would have had
  // to click.
  //
  // Bounded to ENRICH, never destabilise:
  //   • only self-expiring, time-limited output / crackdown / tariff / demand shocks — NEVER a
  //     route-severing block/embargo (those stay referee-authored story beats);
  //   • output cuts are floored at DIR_OUT_FLOOR (food-safe, and — being ≥ the 0.4 threshold
  //     worldStatus reads as unrest-inducing — a director strike can't itself bootstrap a fresh
  //     unrest→spread→unrest doom-loop);
  //   • a galaxy-wide cooldown + a cap on concurrently-live director shocks bound cumulative
  //     pressure well inside the balance the corp/food harness tuned.
  // REFEREE-ONLY + full-sim-only + settle-skipped (the settle scratch state is active:false, so
  // this returns immediately and the deterministic baseline is untouched) — exactly like
  // corpsStep / worldStatusStep. Only the referee's advance persists the fired shocks; every
  // device inherits the same state.shocks on load, so per-device prices stay identical. It uses
  // Math.random in the same referee-only way corpsStep/formCorp already do.
  const DIR_COOLDOWN = 3;        // ≥ this many weeks between director events — a heartbeat, not a barrage
  const DIR_MAX_ACTIVE = 4;      // never more than this many director shocks live at once (bounds cumulative pressure)
  const DIR_AMBIENT_PROB = 0.10; // weekly chance of a minor ambient event when nothing reactive fires (so it's never wholly static)
  const DIR_OUT_FLOOR = 0.4;     // director output cuts never bite harder than this — food-safe & non-unrest-bootstrapping
  const DIR_SPREAD_WK = 3;       // unrest must have festered this long before it spreads to a neighbour

  function directorActive(){ return (state.shocks||[]).filter(s=> s && s.src==='director'); }
  function facConsumersOf(good){ const set={}; Object.values(worlds).forEach(w=>{ if((w.cons[good]||0)>0 && w.fac) set[w.fac]=1; }); return Object.keys(set); }
  function exportsOf(id){ const w=worlds[id]; return w?Object.keys(w.prod).filter(g=>GOODS[g] && !GOODS[g].internal && w.prod[g]>0 && g!==FOOD_GOOD):[]; }

  // Push a director-originated shock: same shape + downstream handling as a referee fire(), tagged
  // src:'director' for the cooldown/cap accounting and a distinct timeline/log marker. No save() —
  // the advance loop saves once at the end.
  function dfire(week, spec){
    const s = Object.assign({ src:'director' }, spec);
    if(s.kind==='output' && s.factor!=null) s.factor = Math.max(DIR_OUT_FLOOR, s.factor);   // food-safe / non-unrest-bootstrapping floor
    s.until = (spec.weeks!=null) ? week + spec.weeks : week + 4;
    s.fired = week;
    state.shocks.push(s);
    if(!state.history) state.history=[];
    state.history.unshift({ label:s.label||s.kind, kind:s.kind, beganWk:week, endsWk:s.until, src:'director' });   // dated campaign timeline
    if(state.history.length>40) state.history.length=40;
    const D = state.director || (state.director = { last:-999, seq:0 });
    D.last = week; D.seq = (D.seq||0)+1;
    log(week, `◇ ${s.label || ('Emergent '+s.kind)}`);
  }

  // Curated ambient minor events — plausible, localized, gentle. Drawn at random on a calm week so
  // the galaxy is never wholly static. Returns a shock spec for a random market world (or null).
  function ambientEvent(week){
    const ids = Object.keys(worlds).filter(id=> worlds[id].fac && isMarket(nodeOf(id)));
    if(!ids.length) return null;
    const id = pick(ids), w = worlds[id], label = w.label, exp = exportsOf(id), roll = Math.random();
    if(roll < 0.4 && exp.length){ const g=pick(exp);
      return { kind:'output', target:id, good:g, factor:0.6, weeks:2+Math.floor(Math.random()*2), label:`⚑ Wildcat strike — ${label} (${g.replace('Common ','')})` }; }
    if(roll < 0.7 && exp.length){ const g=pick(exp);
      return { kind:'output', target:id, good:g, factor:0.55, weeks:2+Math.floor(Math.random()*2), label:`⚔ Raiders skim the lanes — ${label} (${g.replace('Common ','')})` }; }
    const cons = Object.keys(w.cons).filter(g=>GOODS[g] && !GOODS[g].internal && w.cons[g]>0);
    if(cons.length){ const g=pick(cons);
      return { kind:'demand', target:id, good:g, factor:1.6, weeks:2+Math.floor(Math.random()*2), label:`✦ Festival demand — ${label} (${g.replace('Common ','')})` }; }
    return null;
  }

  // Weekly director turn. Reads the sim's own signals for a REACTIVE event; failing that, an
  // occasional ambient one. Fires at most ONE shock per turn, gated by cooldown + the live cap.
  function directorStep(week){
    if(!state.active) return;                                     // full sim only (settle scratch state is active:false → skipped → baseline untouched)
    if(state.directorOn===false) return;                          // referee opt-out
    if(typeof isReferee==='function' && !isReferee()) return;     // referee-advanced (only the ref's advance persists; players inherit)
    const D = state.director || (state.director = { last:-999, seq:0 });
    if(week - (D.last||-999) < DIR_COOLDOWN) return;              // heartbeat, not a barrage
    if(directorActive().length >= DIR_MAX_ACTIVE) return;         // bound cumulative director pressure

    const cand = [], ws = state.worldStatus || {};

    // 1) Unrest spreads — a world restive (sev≥2) long enough infects a calm same-faction neighbour.
    Object.keys(ws).forEach(id=>{ const s=ws[id];
      if(!s || s.kind!=='unrest' || (s.sev||1)<2 || s.since==null || week-s.since < DIR_SPREAD_WK || !worlds[id]) return;
      const fac=worlds[id].fac;
      const nbrs=Object.keys(worlds).filter(n=> n!==id && worlds[n].fac===fac
        && !(ws[n] && ws[n].kind==='unrest') && !state.shocks.some(x=>x.target===n));
      if(nbrs.length){ const n=pick(nbrs), pool=exportsOf(n).concat(['*']), g=pick(pool);
        cand.push({ kind:'output', target:n, good:g, factor:0.5, weeks:3, label:`⚑ Unrest spreads — ${worlds[n].label}` }); }
    });

    // 2) Monopoly backlash — a house dominating a good draws a regulatory tariff from a faction that buys it.
    Object.values(state.corps||{}).forEach(c=>{ if(c.defunct || !c.monopoly || !c.monopoly.good) return;
      const g=c.monopoly.good, facs=facConsumersOf(g).filter(f=> !state.shocks.some(x=> x.kind==='tariff' && x.faction===f && x.good===g));
      if(facs.length){ const f=pick(facs);
        cand.push({ kind:'tariff', faction:f, good:g, factor:0.45, weeks:6, label:`⚖ ${facName(f)} tariff — curbing ${c.name.split(' ')[0]}'s grip on ${g.replace('Common ','')}` }); }
    });

    // 3) Boomtown crime — a boom draws raiders skimming one of its exports.
    Object.keys(ws).forEach(id=>{ const s=ws[id];
      if(!s || s.kind!=='boom' || !worlds[id]) return;
      const exp=exportsOf(id).filter(g=> !state.shocks.some(x=>x.target===id && x.good===g));
      if(exp.length){ const g=pick(exp);
        cand.push({ kind:'output', target:id, good:g, factor:0.6, weeks:3, label:`⚔ Boomtown crime wave — ${worlds[id].label} (${g.replace('Common ','')})` }); }
    });

    if(cand.length){ dfire(week, pick(cand)); return; }           // reactive beat takes priority

    // 4) Ambient heartbeat — the galaxy is calm; occasionally stir something minor so it's never static.
    if(Math.random() < DIR_AMBIENT_PROB){ const e=ambientEvent(week); if(e) dfire(week, e); }
  }

  // ── FACTION AI — the major powers as strategy-game actors ─────────────────────
  // The corp layer already models pooled-capital HOUSES; this models the STATES they operate in.
  // Each major faction becomes an autonomous actor with a treasury, weekly income from the worlds it
  // holds, a diplomatic STANCE toward every other power, and a per-turn BUDGET it allocates — exactly
  // the loop a 4X/grand-strategy AI runs. Concretely, each referee turn factionsStep():
  //   • books INCOME (a small tax on its worlds' output) into the treasury, bounded by a reserve cap;
  //   • drifts RELATIONS toward each rivalry's baseline (seeded from FACTION_AVOID), perturbed by live
  //     statecraft, so hostility/estrangement is dynamic not fixed;
  //   • runs STATECRAFT off those relations — a hostile power funds a trade EMBARGO or a protectionist
  //     TARIFF against a rival (reusing the shock system, tagged src:'faction'), and détente LIFTS an
  //     old embargo once relations recover;
  //   • spends its BUDGET on the galaxy: posts CONTRACTS players/traders can take (relief runs into its
  //     own shortages, lane patrols/escorts, bounties on raiders in its space, development jobs) and
  //     directly FUNDS relief shipments — treasury actually falls when it acts, like a 4X budget.
  // Contracts flow through the SAME pipeline corp contracts do (factionContractItem → intel() → the
  // Oracle's rumours → the console → one-click draft to the Quest Log), so almost no new plumbing.
  //
  // Bounded & safe, like every other advanced layer: statecraft is capped (≤ FAC_EMB_MAX live faction
  // embargoes, self-expiring, cooldown) and food-aware so a trade war can't starve the galaxy (the 11
  // independent worlds stay outside every faction embargo, so staples still flow); treasuries have a
  // reserve ceiling; contracts are deduped and capped. REFEREE-ONLY + full-sim-only + settle-skipped
  // (active:false scratch state → returns immediately, baseline untouched), and only the referee's
  // advance persists — every device inherits the same state.factions, so prices stay identical. Uses
  // Math.random the same referee-only way corpsStep / directorStep do.
  const FAC_AI_IDS = ['hegemony','uhc','sanhedrin','rsc','omnisynth'];   // the major powers that get an AI (the market factions with strategic profiles)
  const FAC_BASE_INCOME = 1500;          // baseline weekly state revenue (admin/tax floor) before per-world output tax
  const FAC_TAX_RATE = 0.015;            // fraction of a held world's weekly output VALUE the state books as revenue
  const FAC_TREASURY_CAP = 2_000_000;    // reserve ceiling — bound the idle war-chest so console treasuries stay readable
  const FAC_SEED_TREASURY = 300_000;     // opening war-chest (a few weeks from its first big move)
  const FAC_REL_MIN = -100, FAC_REL_MAX = 100;
  const FAC_REL_DRIFT = 0.05;            // per-week pull of a relation back toward its rivalry baseline (slow)
  const FAC_EMB_THRESH = -55;            // stance at/below this → a power may declare a trade embargo on the rival
  const FAC_TARIFF_THRESH = -30;         // stance at/below this (but above embargo) → a protectionist tariff instead
  const FAC_THAW_THRESH = -25;           // an active faction embargo LIFTS once stance recovers above this (détente)
  const FAC_EMB_MAX = 2;                 // never more than this many live faction embargoes at once (galaxy can't seize up)
  const FAC_EMB_COST = 40_000, FAC_TARIFF_COST = 15_000;   // statecraft is funded from the treasury
  const FAC_EMB_WK = 10, FAC_TARIFF_WK = 8;
  const FAC_STATECRAFT_COOLDOWN = 4;     // ≥ this many weeks between a faction's statecraft acts
  const FAC_CONTRACT_MAX = 8;            // cap on live faction contract offers (deduped) so the list doesn't flood
  const FAC_CONTRACT_PROB = 0.5;         // weekly chance a faction posts a contract when it has a live need
  const FAC_RELIEF_COST = 12_000;        // funding a direct relief shipment costs this from the treasury
  const FAC_RELIEF_QTY = 30;             // kt of staples/short good a funded relief lift moves toward the short world
  const FAC_DEV_COST = 60_000;           // a development grant (EXPAND agenda) — funded, posts a job
  const CAB_RESHUFFLE_PROB = 0.02;       // weekly chance a power reshuffles ONE cabinet post (~every 50 wks per seat-set) — occasional, newsworthy

  function facName2(id){ return (typeof GALAXY_FACTIONS!=='undefined' && GALAXY_FACTIONS[id] && GALAXY_FACTIONS[id].name) || facName(id); }
  function facColorOf(id){ return (typeof GALAXY_FACTIONS!=='undefined' && GALAXY_FACTIONS[id] && GALAXY_FACTIONS[id].color) || '#9fb0c8'; }
  function facWorlds(id){ return Object.keys(worlds).filter(w=> worlds[w].fac===id); }
  // Rivalry baseline for a stance A→B, seeded from the established hostilities in FACTION_AVOID.
  function relBaseline(a, b){ const av=FACTION_AVOID[a];
    if(av){ if((av.hard||[]).indexOf(b)>=0) return -70; if((av.soft||[]).indexOf(b)>=0) return -30; }
    const bv=FACTION_AVOID[b]; if(bv){ if((bv.hard||[]).indexOf(a)>=0) return -70; if((bv.soft||[]).indexOf(a)>=0) return -30; }
    return 10;   // no history → mildly cordial
  }
  // ── Government cabinets — each power's ministers, generated, occasionally reshuffled, broadcast on GalNet.
  //    The INITIAL cabinet is seeded DETERMINISTICALLY (name/trait from a stable hash of faction+post), so
  //    every device shows the same government before the referee's first advance. Reshuffles thereafter are
  //    referee-side (Math.random) and persisted, exactly like every other faction mutation. ──
  const GOV_FIRST = ['Vara','Doran','Mira','Kel','Sana','Orin','Tesh','Yuna','Cassian','Ravi','Lio','Nadia','Bram','Isolde','Garan','Petra','Soren','Aisha','Costa','Wen','Elias','Dara','Faren','Nix','Talia','Rurik'];
  const GOV_LAST  = ['Okonkwo','Vance','Solari','Marek','Bright','Cole','Ashfield','Reyes','Tamm','Voss','Kessler','Halloran','Drexler','Sable','Orsk','Quill','Anselm','Marlow','Castellan','Greaves','Yuan','Ferro','Lindqvist','Adeyemi','Koh','Novak'];
  const GOV_TRAITS = ['hawkish','dovish','protectionist','free-trader','reformist','hardliner','technocrat','populist','pragmatist','ideologue'];
  const GOV_REASONS = { resigned:'has resigned', dismissed:'was dismissed', died:'has died in office', scandal:'steps down amid scandal', promoted:'was promoted', retired:'retires', elected:'takes office after a vote', purged:'was purged', ascended:'has ascended', recalled:'was recalled' };
  // Per-power flavour: the head-of-state's title + the plausible ways its officials leave office.
  const FAC_GOV = {
    hegemony:  { head:'First Consul',        style:['elected','resigned','dismissed','retired','scandal'] },
    uhc:       { head:'Continuity Director', style:['elected','retired','resigned','recalled'] },
    sanhedrin: { head:'High Preceptor',      style:['ascended','died','resigned','retired'] },
    rsc:       { head:'Chairman',            style:['purged','dismissed','died','resigned'] },
    omnisynth: { head:'Chief Executive',     style:['dismissed','promoted','resigned','retired'] },
  };
  const GOV_POSTS = [
    { key:'trade',    title:'Minister of Commerce' },
    { key:'defence',  title:'Minister of Defence' },
    { key:'foreign',  title:'Foreign Secretary' },
    { key:'interior', title:'Minister of the Interior' },
  ];
  // Design-Mode editable via the generator overlay (js/85 genList — in global
  // scope here). genList returns the referee's override list if set, else the
  // shipped base. Edits only reshape NEWLY generated / reshuffled cabinet seats;
  // names already stamped into faction state are kept.
  function govFirsts(){ const l = (typeof genList==='function') ? genList('gov.firstNames', GOV_FIRST) : GOV_FIRST; return (l && l.length) ? l : GOV_FIRST; }
  function govLasts(){  const l = (typeof genList==='function') ? genList('gov.lastNames',  GOV_LAST)  : GOV_LAST;  return (l && l.length) ? l : GOV_LAST; }
  function govTraitList(){ const l = (typeof genList==='function') ? genList('gov.traits', GOV_TRAITS) : GOV_TRAITS; return (l && l.length) ? l : GOV_TRAITS; }
  function govHash(s){ let h=2166136261>>>0; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
  function govNameSeeded(seed){ const F=govFirsts(), L=govLasts(); return F[govHash('f'+seed)%F.length]+' '+L[govHash('l'+seed)%L.length]; }
  function govTraitSeeded(seed){ const T=govTraitList(); return T[govHash('t'+seed)%T.length]; }
  function govNameRandom(){ return pick(govFirsts())+' '+pick(govLasts()); }
  function freshCabinet(facId){ const gov=FAC_GOV[facId]||{head:'Head of State'};
    const out=[{ post:'head', title:gov.head, name:govNameSeeded(facId+':head'), trait:govTraitSeeded(facId+':head'), since:0 }];
    GOV_POSTS.forEach(p=> out.push({ post:p.key, title:p.title, name:govNameSeeded(facId+':'+p.key), trait:govTraitSeeded(facId+':'+p.key), since:0 }));
    return out;
  }

  function freshFactions(){ const out={};
    if(authored()) return out;   // authored campaigns: the Archon power AIs stay off — statecraft is the referee's
    FAC_AI_IDS.forEach(id=>{ const stance={};
      FAC_AI_IDS.forEach(o=>{ if(o!==id) stance[o]=relBaseline(id,o); });
      out[id]={ id, treasury:FAC_SEED_TREASURY, income:0, stance, agenda:'CONSOLIDATE', lastCraft:-999, hist:[], cabinet:freshCabinet(id), prevAgenda:'CONSOLIDATE' };
    });
    return out;
  }
  // GalNet — the galaxy news feed. A rolling window of headlines the sim broadcasts (cabinet changes,
  // trade wars, détente). Player-facing via the Oracle (intel() surfaces recent items) and the console.
  const NEWS_CAP = 40;
  function broadcastNews(week, facId, kind, text){ if(!state.news) state.news=[];
    state.news.unshift({ wk:week, fac:facId||null, kind, text }); if(state.news.length>NEWS_CAP) state.news.length=NEWS_CAP; }
  function factionEmbargoesLive(){ return (state.shocks||[]).filter(s=> s && s.kind==='embargo' && s.src==='faction'); }
  function relOf(a,b){ const f=state.factions&&state.factions[a]; return (f&&f.stance&&f.stance[b]!=null)?f.stance[b]:relBaseline(a,b); }
  function setRel(a,b,v){ v=Math.max(FAC_REL_MIN,Math.min(FAC_REL_MAX,Math.round(v)));
    const fa=state.factions&&state.factions[a]; if(fa){ fa.stance=fa.stance||{}; fa.stance[b]=v; }
  }
  function nudgeRel(a,b,d){ setRel(a,b, relOf(a,b)+d); setRel(b,a, relOf(b,a)+d); }   // symmetric perturbation

  // Emit a faction contract opportunity (parallel to emitCorpEvent). Deduped + capped.
  function emitFactionEvent(type, facId, data){
    if(!state.factionEvents) state.factionEvents=[];
    state.factionEvents.push(Object.assign({ type, faction:facId, wk:state.week }, data||{}));
    while(state.factionEvents.length>FAC_CONTRACT_MAX) state.factionEvents.shift();
  }
  function hasFactionEvent(pred){ return (state.factionEvents||[]).some(pred); }
  // Raw factionEvent → the rich {kind:'contract'} item the console + 85-records draftFactionContract() consume.
  function factionContractItem(e){
    if(!e || !e.faction) return null;
    const wl = id => (id && worlds[id]) ? worlds[id].label : (id||null);
    return { kind:'contract', contract:e.type, issuer:'faction', faction:e.faction, label:facName2(e.faction), color:facColorOf(e.faction),
      world:e.world||null, place: wl(e.world), good:e.good||null,
      from:e.from||null, fromLabel: wl(e.from), to:e.to||null, toLabel: wl(e.to),
      vessel:e.vessel||null, qty:e.qty||null, reward: factionContractReward(e), wk:e.wk,
      pirate:e.pirate||null, targetName:e.pirateName||null };   // pirate bounties name the band
  }
  function factionContractReward(e){
    const cargo=(e.qty||0)*(AGENT_VALUE[e.good]||100);
    switch(e.type){
      case 'relief':      return Math.max(4000, round100(cargo*0.5 + 6000));
      case 'patrol':      return Math.max(3000, round100(5000));
      case 'escort':      return Math.max(2500, round100(cargo*0.18));
      case 'bounty':      return Math.max(4000, round100(cargo*0.4 + 4000));
      case 'development':  return Math.max(6000, round100(FAC_DEV_COST*0.12));
      default:            return 5000;
    }
  }
  // Fund + dispatch a direct relief shipment of `good` toward short world `id` from the nearest producer
  // with surplus — the faction spending its treasury to physically ease its own shortage. Bounded qty.
  function fundRelief(facId, id, good){
    const f=state.factions[facId]; if(!f || f.treasury<FAC_RELIEF_COST) return false;
    const blk=blocked(), D=dist(id, blk); if(D[id]==null) return false;
    const prods=Object.values(worlds).filter(p=> p.id!==id && p.prod[good] && D[p.id]!=null && stk(p.id,good)>safety(p,good))
                  .sort((a,b)=> D[a.id]-D[b.id]);
    if(!prods.length) return false;
    const p=prods[0], qty=Math.min(FAC_RELIEF_QTY, Math.max(0, stk(p.id,good)-safety(p,good)));
    if(qty<=0) return false;
    setStk(p.id,good, stk(p.id,good)-qty);
    state.transit.push({ good, qty, from:p.id, to:id, eta: state.week + Math.max(1,D[p.id]), relief:facId });
    f.treasury -= FAC_RELIEF_COST;
    return true;
  }

  // Weekly faction turn: income → relations drift → statecraft → budget/contracts → P&L sample.
  function factionsStep(week){
    if(!state.active) return;                                      // full sim only (settle scratch state is active:false → skipped → baseline untouched)
    if(state.factionsOn===false) return;                          // referee opt-out
    if(typeof isReferee==='function' && !isReferee()) return;     // referee-advanced (only the ref's advance persists; players inherit)
    if(!state.factions) state.factions=freshFactions();
    if(!state.factionEvents) state.factionEvents=[];
    // expire faction contract offers whose situation has passed (timed) — keep it a live board
    state.factionEvents = state.factionEvents.filter(e=> e.until==null || e.until>=week);

    Object.values(state.factions).forEach(f=>{
      const mine=facWorlds(f.id);

      // 1) INCOME — a small tax on the output value of the worlds it holds (bounded reserve ceiling).
      let rev=FAC_BASE_INCOME;
      mine.forEach(id=>{ const w=worlds[id]; for(const g in w.prod){ if(GOODS[g]&&!GOODS[g].internal) rev += w.prod[g]*(AGENT_VALUE[g]||100)*FAC_TAX_RATE; } });
      f.income=Math.round(rev);
      if(f.treasury < FAC_TREASURY_CAP) f.treasury=Math.min(FAC_TREASURY_CAP, f.treasury+f.income);

      // 2) RELATIONS — pull each stance slowly toward its rivalry baseline; a live embargo/tariff between
      //    the two keeps eroding it (statecraft has diplomatic cost). The government's POSTURE bends the
      //    baseline: a hawkish/hardline cabinet drifts toward hostility, a dovish/reformist one toward
      //    thaw — so a reshuffle visibly reshapes a power's diplomacy over the following weeks.
      const cab=f.cabinet||[]; const defence=cab.find(s=>s.post==='defence')||{}, foreign=cab.find(s=>s.post==='foreign')||{}, head=cab.find(s=>s.post==='head')||{};
      const hawk=['hawkish','hardliner','ideologue'], dove=['dovish','reformist','pragmatist'];
      let posture=0; [defence.trait,foreign.trait,head.trait].forEach(t=>{ if(hawk.indexOf(t)>=0) posture--; else if(dove.indexOf(t)>=0) posture++; });
      const postureShift=Math.max(-12,Math.min(12, posture*5));   // bounded ±12: cabinet nudges the diplomatic baseline
      FAC_AI_IDS.forEach(o=>{ if(o===f.id) return;
        const base=Math.max(FAC_REL_MIN,Math.min(FAC_REL_MAX, relBaseline(f.id,o)+postureShift)); let r=relOf(f.id,o);
        r += (base-r)*FAC_REL_DRIFT;
        const hostileAct=(state.shocks||[]).some(s=> s.src==='faction' && ((s.kind==='embargo' && ((s.facA===f.id&&s.facB===o)||(s.facA===o&&s.facB===f.id))) || (s.kind==='tariff' && s.faction===f.id && s.againstFac===o)));
        if(hostileAct) r-=2;
        setRel(f.id,o, r);
      });

      // 3) AGENDA — read its own space and pick a posture (drives the budget below).
      let short=0, unrest=0;
      mine.forEach(id=>{ SIM_GOODS.forEach(g=>{ if(!GOODS[g]||GOODS[g].internal) return; const p=pressure(id,g); if(p!=null&&p<=-2) short++; });
        const ws=state.worldStatus&&state.worldStatus[id]; if(ws&&ws.kind==='unrest') unrest++; });
      let worstRival=null; FAC_AI_IDS.forEach(o=>{ if(o===f.id) return; if(worstRival==null || relOf(f.id,o)<relOf(f.id,worstRival)) worstRival=o; });
      const threatened=worstRival && relOf(f.id,worstRival)<=FAC_TARIFF_THRESH;
      f.agenda = (short+unrest>=2) ? 'STABILISE' : threatened ? 'CONTAIN'
               : (f.treasury>FAC_SEED_TREASURY*1.5 && short+unrest===0) ? 'EXPAND' : 'CONSOLIDATE';

      // 4) STATECRAFT — funded from the treasury, gated by relations, cooldown and the live-embargo cap.
      if(week-(f.lastCraft||-999) >= FAC_STATECRAFT_COOLDOWN){
        // détente first: lift an OWN faction embargo whose relation has recovered.
        const ownEmb=factionEmbargoesLive().find(s=> s.facA===f.id && relOf(f.id,s.facB)>=FAC_THAW_THRESH);
        if(ownEmb){ const i=state.shocks.indexOf(ownEmb); if(i>=0){ state.shocks.splice(i,1);
            nudgeRel(f.id, ownEmb.facB, +8); f.lastCraft=week;
            log(week, `🕊 ${facName2(f.id)} lifts its embargo on ${facName2(ownEmb.facB)}`);
            broadcastNews(week, f.id, 'thaw', `🕊 ${facName2(f.id)} lifts its trade embargo on ${facName2(ownEmb.facB)} as relations thaw.`);
            state.history.unshift({ label:`🕊 ${FAC_SHORT[f.id]||facName2(f.id)} ↔ ${FAC_SHORT[ownEmb.facB]||facName2(ownEmb.facB)} détente`, kind:'thaw', beganWk:week, endsWk:null, src:'faction' }); if(state.history.length>40) state.history.length=40; } }
        else if(worstRival){ const r=relOf(f.id,worstRival);
          const alreadyEmb=factionEmbargoesLive().some(s=> (s.facA===f.id&&s.facB===worstRival)||(s.facA===worstRival&&s.facB===f.id));
          if(r<=FAC_EMB_THRESH && !alreadyEmb && factionEmbargoesLive().length<FAC_EMB_MAX && f.treasury>=FAC_EMB_COST){
            f.treasury-=FAC_EMB_COST; f.lastCraft=week; nudgeRel(f.id,worstRival,-6);
            const s={ kind:'embargo', facA:f.id, facB:worstRival, src:'faction', until:week+FAC_EMB_WK, fired:week, label:`⛔ ${FAC_SHORT[f.id]||facName2(f.id)} embargoes ${FAC_SHORT[worstRival]||facName2(worstRival)}` };
            state.shocks.push(s); state.history.unshift({ label:s.label, kind:'embargo', beganWk:week, endsWk:s.until, src:'faction' }); if(state.history.length>40) state.history.length=40;
            log(week, `⛔ ${facName2(f.id)} declares a trade embargo on ${facName2(worstRival)}`);
            broadcastNews(week, f.id, 'embargo', `⛔ ${facName2(f.id)} declares a trade embargo on ${facName2(worstRival)} amid deepening tensions.`);
          } else if(r<=FAC_TARIFF_THRESH && f.treasury>=FAC_TARIFF_COST
                    && !(state.shocks||[]).some(s=> s.kind==='tariff' && s.faction===f.id && s.againstFac===worstRival)){
            // protectionist tariff on a good the rival exports and this faction imports
            const rivalExp=new Set(); facWorlds(worstRival).forEach(id=>Object.keys(worlds[id].prod).forEach(g=>{ if(GOODS[g]&&!GOODS[g].internal&&worlds[id].prod[g]>0) rivalExp.add(g); }));
            const wants=[...rivalExp].filter(g=> mine.some(id=>(worlds[id].cons[g]||0)>0));
            if(wants.length){ const g=pick(wants); f.treasury-=FAC_TARIFF_COST; f.lastCraft=week; nudgeRel(f.id,worstRival,-3);
              const s={ kind:'tariff', faction:f.id, againstFac:worstRival, good:g, factor:0.5, src:'faction', until:week+FAC_TARIFF_WK, fired:week, label:`⚖ ${FAC_SHORT[f.id]||facName2(f.id)} tariff on ${g.replace('Common ','')} (vs ${FAC_SHORT[worstRival]||facName2(worstRival)})` };
              state.shocks.push(s); state.history.unshift({ label:s.label, kind:'tariff', beganWk:week, endsWk:s.until, src:'faction' }); if(state.history.length>40) state.history.length=40;
              log(week, `⚖ ${facName2(f.id)} raises a protective tariff on ${g.replace('Common ','')}`);
              broadcastNews(week, f.id, 'tariff', `⚖ ${facName2(f.id)} imposes a protective tariff on ${g.replace('Common ','')} imports from ${facName2(worstRival)}.`);
            }
          }
        }
      }

      // 5) BUDGET / CONTRACTS — one posting per faction per week, on a live need, gated by treasury.
      if(Math.random()<FAC_CONTRACT_PROB && (state.factionEvents.length<FAC_CONTRACT_MAX)){
        // a) relief — a short world in its space (STABILISE/CONSOLIDATE)
        let posted=false;
        if(f.agenda==='STABILISE' || f.agenda==='CONSOLIDATE'){
          const needs=[];
          mine.forEach(id=>{ SIM_GOODS.forEach(g=>{ if(!GOODS[g]||GOODS[g].internal) return; const p=pressure(id,g); if(p!=null&&p<=-2) needs.push({id,g,p}); }); });
          needs.sort((a,b)=>a.p-b.p);
          const need=needs.find(n=> !hasFactionEvent(e=>e.type==='relief'&&e.world===n.id&&e.good===n.g));
          if(need){ emitFactionEvent('relief', f.id, { world:need.id, good:need.g, qty:FAC_RELIEF_QTY, until:week+6 });
            fundRelief(f.id, need.id, need.g);   // also physically fund part of it
            posted=true; }
        }
        // b) bounty — raiders hit its space (a director/convoy raid landed on a world it holds)
        if(!posted){
          const raidHere=(state.shocks||[]).find(s=> (s.kind==='output') && s.target && worlds[s.target] && worlds[s.target].fac===f.id
                          && /raid|crime|skim/i.test(s.label||'') && !hasFactionEvent(e=>e.type==='bounty'&&e.world===s.target));
          if(raidHere){ emitFactionEvent('bounty', f.id, { world:raidHere.target, good:raidHere.good, qty:20, until:week+6 }); posted=true; }
        }
        // c) patrol — a rich convoy transiting its space wants an escort (CONTAIN/CONSOLIDATE)
        if(!posted){
          const conv=(state.agents||[]).find(a=> a.route && worlds[a.route.to] && worlds[a.route.to].fac===f.id
                        && a.route.qty*(AGENT_VALUE[a.route.good]||100)>=ESCORT_VALUE_MIN && !hasFactionEvent(e=>e.type==='patrol'&&e.to===a.route.to));
          if(conv){ emitFactionEvent('patrol', f.id, { vessel:conv.name, from:conv.route.from, to:conv.route.to, good:conv.route.good, qty:Math.round(conv.route.qty), until:week+5 }); posted=true; }
        }
        // d) development — flush & calm (EXPAND): fund a build-up job at one of its worlds
        if(!posted && f.agenda==='EXPAND' && f.treasury>=FAC_DEV_COST && mine.length){
          const w=pick(mine);
          if(!hasFactionEvent(e=>e.type==='development'&&e.world===w)){ f.treasury-=FAC_DEV_COST;
            emitFactionEvent('development', f.id, { world:w, good:Object.keys(worlds[w].prod)[0]||null, until:week+8 }); posted=true; }
        }
      }

      // 6) GOVERNMENT — occasionally reshuffle a cabinet post (replacement) and broadcast it; and when the
      //    power's AGENDA shifts, broadcast that too (an "update" without a personnel change). Both are news.
      if(!f.cabinet || !f.cabinet.length) f.cabinet=freshCabinet(f.id);
      if(Math.random()<CAB_RESHUFFLE_PROB){
        const gov=FAC_GOV[f.id]||{}, seat=pick(f.cabinet), outgoing=seat.name;
        const reason=pick(gov.style||['resigned','dismissed','retired']);
        let nm=govNameRandom(); for(let k=0;k<6 && f.cabinet.some(s=>s.name===nm);k++) nm=govNameRandom();
        seat.name=nm; seat.trait=pick(govTraitList()); seat.since=week;
        broadcastNews(week, f.id, 'cabinet', `🏛 ${facName2(f.id)}: ${seat.title} ${outgoing} ${GOV_REASONS[reason]||'steps down'} — ${nm} ${seat.post==='head'?'assumes office':'is appointed'} (${seat.trait}).`);
        log(week, `🏛 ${FAC_SHORT[f.id]||facName2(f.id)} — ${seat.title}: ${nm} replaces ${outgoing}`);
        state.history.unshift({ label:`🏛 ${FAC_SHORT[f.id]||facName2(f.id)} ${seat.title} — ${nm}`, kind:'cabinet', beganWk:week, endsWk:null, src:'faction' }); if(state.history.length>40) state.history.length=40;
      }
      if(f.agenda!==f.prevAgenda){ const head=(f.cabinet||[]).find(s=>s.post==='head')||{};
        const AGD_NEWS={ STABILISE:'moves to stabilise its worlds', CONTAIN:'takes a harder line abroad', EXPAND:'opens an expansionist programme', CONSOLIDATE:'settles into consolidation' };
        broadcastNews(week, f.id, 'policy', `📜 ${facName2(f.id)} under ${head.title||'its government'} ${head.name?head.name+' ':''}${AGD_NEWS[f.agenda]||'changes course'}.`);
        f.prevAgenda=f.agenda;
      }

      // 7) P&L sample for the console sparkline.
      f.hist=f.hist||[]; f.hist.push({ wk:week, cap:Math.round(f.treasury) }); if(f.hist.length>24) f.hist.shift();
    });
  }

  // ── PIRATE BANDS — autonomous raiders, with rules-legal Traveller 2e / High Guard hulls ─────────
  // The dark mirror of the trader layer. Bands live at a lawless base, prey on convoys near their
  // turf, grow fat on loot and notorious with it — which draws faction bounties and patrols that wear
  // them back down, until they fold or are broken in a fight. Everything the referee/players already
  // have hooks in: raids reuse the convoy-loss mechanic, notoriety feeds the faction bounty pipeline,
  // activity broadcasts on GalNet, and a band's ship drops straight into the js/80 combat system.
  //
  // SHIPS ARE REAL MgT2e DESIGNS. Each hull carries the sim fields the band layer needs AND a `combat`
  // stat block ready for makeShipStats()/addCombatShip() — a genuine, rules-legal ship, not an ad-hoc
  // blob. Hull points follow the app's convention (≈0.4×tons, as the player Free Trader + genShipStats
  // do); weapon damage dice are the 2022 core values (Pulse 2D · Beam 1D · Missile 4D · Particle 4D).
  // High Guard hulls are flagged (hg:true).
  const PIRATE_WPN = {
    pulse:   id=>({ id, name:'Pulse Laser (triple turret)', type:'pulse-laser', mount:'turret', damage:'2D', range:'Medium',    ammo:0,  ammoMax:0,  notes:'Triple turret · TL10' }),
    beam:    id=>({ id, name:'Beam Laser (triple turret)',  type:'beam-laser',  mount:'turret', damage:'1D', range:'Long',      ammo:0,  ammoMax:0,  notes:'Triple turret · TL10' }),
    missile: id=>({ id, name:'Missile Rack (triple turret)',type:'missile',     mount:'turret', damage:'4D', range:'Special',   ammo:12, ammoMax:12, notes:'Smart missiles · TL10' }),
    particle:id=>({ id, name:'Particle Barbette',           type:'particle',    mount:'barbette',damage:'4D',range:'Very Long', ammo:0,  ammoMax:0,  notes:'Radiation crits · TL12 · High Guard' }),
    sand:    id=>({ id, name:'Sandcaster (triple turret)',  type:'sandcaster',  mount:'turret', damage:'',   range:'Special',   ammo:20, ammoMax:20, notes:'Point defence · TL9' }),
  };
  const PIRATE_SHIPS = {
    wolf: { id:'wolf', name:'Wolf-class Q-ship', t2e:'Modified Free Trader · 200t', hg:false, tons:200, jump:2, thrust:2, fuelMax:80,
      combat:{ tonnage:200, jumpRating:2, thrust:2, armourRating:1, hullPoints:80, hullPointsMax:80, power:120, powerMax:120, sensorDM:0,
        crewSkills:{ pilot:1, gunnery:1, engineer:1, sensors:1, tactics:1, leadership:0 },
        weapons:[ PIRATE_WPN.pulse('w_wolf1'), PIRATE_WPN.missile('w_wolf2') ], notes:'Disguised civilian hull with pop-up turrets — lures and boards lone traders.' } },
    corsair: { id:'corsair', name:'Corsair (Type-P)', t2e:'Corsair · 400t', hg:false, tons:400, jump:2, thrust:2, fuelMax:160,
      combat:{ tonnage:400, jumpRating:2, thrust:2, armourRating:2, hullPoints:160, hullPointsMax:160, power:240, powerMax:240, sensorDM:0,
        crewSkills:{ pilot:2, gunnery:2, engineer:1, sensors:1, tactics:1, leadership:1 },
        weapons:[ PIRATE_WPN.beam('w_cor1'), PIRATE_WPN.missile('w_cor2'), PIRATE_WPN.pulse('w_cor3') ], notes:'The classic raider — three triple turrets and jump-2 reach.' } },
    gazelle: { id:'gazelle', name:'Gazelle-class Close Escort', t2e:'High Guard · 300t', hg:true, tons:300, jump:4, thrust:6, fuelMax:180,
      combat:{ tonnage:300, jumpRating:4, thrust:6, armourRating:4, hullPoints:120, hullPointsMax:120, power:200, powerMax:200, sensorDM:1,
        crewSkills:{ pilot:2, gunnery:2, engineer:2, sensors:2, tactics:2, leadership:1 },
        weapons:[ PIRATE_WPN.particle('w_gaz1'), PIRATE_WPN.missile('w_gaz2'), PIRATE_WPN.sand('w_gaz3') ], notes:'A High Guard military hull — thrust-6 and a particle barbette. A pirate lord’s prize.' } },
    fighter: { id:'fighter', name:'Light Fighter (wolfpack)', t2e:'Small craft · 30t', hg:false, tons:30, jump:0, thrust:6, fuelMax:8,
      combat:{ tonnage:30, jumpRating:0, thrust:6, armourRating:2, hullPoints:12, hullPointsMax:12, power:20, powerMax:20, sensorDM:0,
        crewSkills:{ pilot:2, gunnery:2, engineer:0, sensors:0, tactics:0, leadership:0 },
        weapons:[ PIRATE_WPN.pulse('w_fig1') ], notes:'System-defence fighter flown in packs — no jump drive; needs a tender.' } },
  };
  const PIRATE_SHIP_IDS = Object.keys(PIRATE_SHIPS);
  const PIR_NAME_A = ['Crimson','Black','Iron','Ghost','Void','Ashen','Broken','Red','Silent','Ragged','Hollow','Scarlet','Grey','Jagged','Pale'];
  const PIR_NAME_B = ['Wake','Tide','Fang','Reavers','Corsairs','Hand','Star','Vultures','Wolves','Shroud','Talon','Compact','Run','Jackals'];
  const PIR_MAX = 4;                 // never more than this many active bands
  const PIR_FORM_PROB = 0.02;        // weekly chance a new band forms (from a bust/unrest world)
  const PIR_RAID_BASE = 0.22;        // per-band weekly raid chance (scaled by strength)
  const PIR_RAIDS_MAX = 2;           // GLOBAL cap on pirate raids per week — protects the tuned trade balance
  const PIR_LOOT_FRAC = 0.3;         // fence value of plundered cargo (fraction of notional Cr)
  const PIR_NOTO_RAID = 14;          // notoriety gained per successful raid
  const PIR_NOTO_DECAY = 3;          // weekly notoriety decay when lying low
  const PIR_BOUNTY_NOTO = 40;        // notoriety at/above which a faction posts a bounty
  const PIR_STR_MAX = 5;
  const PIR_LOOT_GROW = 60000;       // loot to add a hull (strength +1)
  const PIR_OP_LOOT = 1200;          // baseline weekly Cr per hull from OFF-SCREEN raiding (ambient traffic the on-screen
                                     //   sim doesn't model — mirrors CORP_OP_INCOME). Keeps a band's hoard growing even
                                     //   in a calm galaxy; on-screen convoy/supply raids add stolen GOODS on top.
  const PIR_LOOT_CAP = 150000;       // hoard ceiling — a maxed band's war-chest is bounded (readable console)
  const PIR_HEAT_LOSS = 0.12;        // weekly chance a heavily-hunted band loses a hull to patrols
  // Fences — shady traders who buy a band's stolen cargo cheap and move it to a lax-law port.
  const FENCE_LAW_MAX = 3;           // Traveller law level ≤ this = "lax" — a fence can move stolen goods here
  const FENCE_RATE = 0.35;           // the fence pays the band this fraction of notional value (bought hugely cheap)
  const FENCE_BATCH = 40;            // kt of stolen goods fenced per week
  const PIR_HOLD_CAP = 240;          // total kt a band can sit on before older loot spoils / is dumped

  function isPirate(id){ return typeof id==='string' && id.indexOf('pir:')===0; }
  function pirateOf(id){ return (state && state.pirates && state.pirates[id]) || null; }
  function pirateShipOf(b){ return PIRATE_SHIPS[(b&&b.ship)||'corsair'] || PIRATE_SHIPS.corsair; }
  function livePirates(){ return Object.values(state.pirates||{}).filter(b=>!b.defunct); }
  // A lawless berth: frontier / independent / contested space, or a slumped (bust) world.
  function lawlessWorlds(){ return Object.keys(worlds).filter(id=>{ const f=worlds[id].fac, ws=state&&state.worldStatus&&state.worldStatus[id];
    return f==='independent'||f==='contested'||f==='vast'||f==='archon' || (ws&&ws.kind==='bust'); }); }
  function pirNameA(){ const l = (typeof genList==='function') ? genList('pirate.nameA', PIR_NAME_A) : PIR_NAME_A; return (l && l.length) ? l : PIR_NAME_A; }
  function pirNameB(){ const l = (typeof genList==='function') ? genList('pirate.nameB', PIR_NAME_B) : PIR_NAME_B; return (l && l.length) ? l : PIR_NAME_B; }
  function pirateName(){ for(let i=0;i<8;i++){ const nm='The '+pick(pirNameA())+' '+pick(pirNameB()); if(!Object.values(state.pirates||{}).some(b=>b.name===nm)) return nm; } return 'The '+pick(pirNameA())+' '+pick(pirNameB()); }
  function freshPirates(){ const out={};
    const berths = lawlessWorlds(); if(!berths.length) return out;
    // two deterministic starter bands at the first lawless berths (stable id order → same on every device)
    const seed = berths.slice().sort();
    [['pir:crimson-wake','The Crimson Wake','corsair'],['pir:black-tide','The Black Tide','wolf']].forEach((s,i)=>{
      const base = seed[i % seed.length];
      out[s[0]] = { id:s[0], name:s[1], ship:s[2], base, strength:2, noto:20, loot:0, hold:{}, founded:0, hist:[] };
    });
    return out;
  }
  function pirateSeq(){ state.pirSeq=(state.pirSeq||0)+1; return state.pirSeq; }
  function formPirateBand(week){
    const berths = lawlessWorlds(); if(!berths.length) return;
    const base = pick(berths), id='pir:n'+pirateSeq().toString(36);
    const ship = pick(['wolf','wolf','corsair','fighter']);   // new bands start small
    state.pirates[id] = { id, name:pirateName(), ship, base, strength:1, noto:10, loot:0, hold:{}, founded:week, hist:[] };
    log(week, `☠ A raider band forms — ${state.pirates[id].name} out of ${worlds[base]?worlds[base].label:base}`);
    broadcastNews(week, null, 'pirate', `☠ A new raider band, ${state.pirates[id].name}, is preying on shipping out of ${worlds[base]?worlds[base].label:base}.`);
  }
  // Choose a prize to hit near the band's turf: preferentially a NAMED trader convoy (players can escort
  // those), else an anonymous shipment on the central supply lanes — so a band always has something to
  // raid even when the independent traders are idle in a calm market.
  function pickRaidPrize(b){
    const baseFac = worlds[b.base] && worlds[b.base].fac;
    const nearFac = id => { const f=worlds[id]&&worlds[id].fac; return f===baseFac; };
    const convoys = (state.agents||[]).filter(a=> a.route && a.route.qty>0 && a.route.eta>state.week);
    const nearC = convoys.filter(a=> nearFac(a.route.to)||nearFac(a.route.from));
    const conv = nearC.length ? nearC : convoys;
    if(conv.length && Math.random()<0.6) return { kind:'agent', a:pick(conv) };   // prefer escortable convoys
    const ship = (state.transit||[]).filter(t=> t.qty>0 && t.eta>state.week && !t.relief && !t.agent);
    const nearT = ship.filter(t=> nearFac(t.to)||nearFac(t.from));
    const pool = nearT.length ? nearT : ship;
    if(pool.length) return { kind:'transit', t:pick(pool) };
    if(conv.length) return { kind:'agent', a:pick(conv) };
    return null;
  }
  // Plunder a convoy: its cargo never LANDS (destination stays short) — instead it goes into the band's
  // HOLD as stolen goods, to be fenced later (or seized if the players storm the base). Same convoy-loss
  // model as the referee raid button; the merchant limps home.
  function pirateHoldTotal(b){ return Object.keys(b.hold||{}).reduce((s,g)=>s+(b.hold[g]||0),0); }
  function piratePlunder(b, prize, week){
    if(!prize) return false;
    let good, qty, fromId, toId, victim=null;
    if(prize.kind==='agent'){ const a=prize.a; if(!a || !a.route) return false; const r=a.route;
      const i=state.transit.findIndex(t=> t.agent===a.id && t.good===r.good && t.to===r.to); if(i>=0) state.transit.splice(i,1);
      good=r.good; qty=r.qty; fromId=r.from; toId=r.to;
      a.profit=(a.profit||0)-Math.round(r.qty*(r.buyUnit||0)); a.raided=(a.raided||0)+1; a.pos=r.from; a.route=null; victim=a.name;
    } else { const t=prize.t, i=state.transit.indexOf(t); if(i<0) return false; state.transit.splice(i,1);
      good=t.good; qty=t.qty; fromId=t.from; toId=t.to; }
    b.hold=b.hold||{};
    b.hold[good]=(b.hold[good]||0)+qty;                          // stolen cargo → the band's hold
    // spoilage: a band can only sit on so much before older loot rots / is dumped
    let over=pirateHoldTotal(b)-PIR_HOLD_CAP;
    if(over>0){ Object.keys(b.hold).forEach(g=>{ if(over<=0) return; const cut=Math.min(b.hold[g],over); b.hold[g]-=cut; over-=cut; if(b.hold[g]<=0.5) delete b.hold[g]; }); }
    b.noto=Math.min(100,(b.noto||0)+PIR_NOTO_RAID);
    const lane=`${worlds[fromId]?worlds[fromId].label:fromId}→${worlds[toId]?worlds[toId].label:toId}`, who=victim||'a supply convoy';
    log(week, `☠ ${b.name} plunders ${who} — ${Math.round(qty)}kt ${good.replace('Common ','')} taken on ${lane}`);
    broadcastNews(week, null, 'pirate', `☠ Raiders of ${b.name} struck ${who} on the ${lane} lane — ${Math.round(qty)}kt ${good.replace('Common ','')} taken.`);
    maybePirateBounty(b, week, toId);
    return true;
  }
  // Lax-law markets (Traveller law level ≤ FENCE_LAW_MAX) a fence can quietly move stolen goods through.
  function laxPorts(){ return Object.keys(worlds).filter(id=>{ const f=factsOf(id);
    return f && f.port && f.port!=='X' && (f.law|0)<=FENCE_LAW_MAX && isMarket(nodeOf(id)); }); }
  // A shady trader buys a batch of the band's hold cheap and dumps it on the nearest lax-law port —
  // stolen goods hit that black market cheap (a glut + a smuggling market), the band banks discounted Cr.
  function fenceBand(b, week){
    const goods=Object.keys(b.hold||{}).filter(g=>b.hold[g]>0.5); if(!goods.length) return;
    const g=goods.sort((x,y)=>b.hold[y]-b.hold[x])[0], qty=Math.min(FENCE_BATCH, b.hold[g]);
    const val=Math.round(qty*(AGENT_VALUE[g]||100));
    const D=dist(b.base, blocked());
    const ports=laxPorts().filter(id=>id!==b.base && D[id]!=null).sort((a,c)=>D[a]-D[c]);
    if(ports.length){
      const port=ports[0];
      setStk(port,g, stk(port,g)+qty);                            // stolen cargo floods the lax-law market
      state.contraband=state.contraband||{}; state.contraband[port]={ good:g, since:week, until:week+6, premium:SMUGGLE_PREMIUM, src:'pirate' };
      b.loot=(b.loot||0)+Math.round(val*FENCE_RATE);
      broadcastNews(week, null, 'pirate', `☠ Stolen ${g.replace('Common ','')} is flooding the ${worlds[port].label} market — a fence is quietly moving ${b.name}'s haul below cost.`);
    } else {
      b.loot=(b.loot||0)+Math.round(val*FENCE_RATE*0.65);         // no lawless port in reach → dumped to a passing trader at a worse cut
    }
    b.hold[g]-=qty; if(b.hold[g]<=0.5) delete b.hold[g];
  }
  function maybePirateBounty(b, week, nearWorld){
    if(!state.factions) return;
    const fac = (nearWorld && worlds[nearWorld] && worlds[nearWorld].fac) || (worlds[b.base] && worlds[b.base].fac);
    const f = (fac && state.factions[fac]) ? state.factions[fac] : livePirates().length ? Object.values(state.factions)[0] : null;
    if(!f) return;
    if(hasFactionEvent(e=>e.type==='bounty' && e.pirate===b.id)) return;   // one live bounty per band
    emitFactionEvent('bounty', f.id, { pirate:b.id, pirateName:b.name, world:nearWorld||b.base, good:pirateShipOf(b).name, qty:Math.round((b.strength||1)*10), until:week+8 });
  }
  function piratesStep(week){
    if(!state.active) return;
    if(state.piratesOn===false) return;
    if(typeof isReferee==='function' && !isReferee()) return;
    if(!state.pirates) state.pirates=freshPirates();
    let raids=0;
    if(livePirates().length<PIR_MAX && Math.random()<PIR_FORM_PROB) formPirateBand(week);
    livePirates().forEach(b=>{
      b.noto=Math.max(0,(b.noto||0)-PIR_NOTO_DECAY);
      b.loot=Math.min(PIR_LOOT_CAP,(b.loot||0)+PIR_OP_LOOT*(b.strength||1));   // off-screen raiding keeps the hoard growing
      if(raids<PIR_RAIDS_MAX && Math.random() < PIR_RAID_BASE*(0.6+0.18*(b.strength||1))){
        const v=pickRaidPrize(b); if(v && piratePlunder(b,v,week)) raids++;
      }
      fenceBand(b, week);   // shady traders move last week's haul to a lax-law port
      if((b.noto||0)>=PIR_BOUNTY_NOTO) maybePirateBounty(b, week, b.base);
      // growth on loot
      if((b.loot||0)>=PIR_LOOT_GROW && (b.strength||1)<PIR_STR_MAX){ b.loot-=PIR_LOOT_GROW; b.strength=(b.strength||1)+1;
        broadcastNews(week, null, 'pirate', `☠ ${b.name} grows bolder — another hull joins the pack (now ${b.strength} strong).`); }
      // heat: a notorious band with a live bounty gets worn down by patrols
      if((b.noto||0)>=PIR_BOUNTY_NOTO && hasFactionEvent(e=>e.type==='bounty'&&e.pirate===b.id) && Math.random()<PIR_HEAT_LOSS){
        b.strength=(b.strength||1)-1;
        if(b.strength<1){ b.defunct=true; log(week, `⚓ ${b.name} — broken up by patrols`); broadcastNews(week, null, 'pirate', `⚓ Patrols have broken the ${b.name}; the lanes near ${worlds[b.base]?worlds[b.base].label:b.base} are quieter.`); }
        else { b.noto=Math.max(0,(b.noto||0)-15); log(week, `⚔ ${b.name} loses a hull to patrols (now ${b.strength})`); }
      }
      b.hist=b.hist||[]; b.hist.push({wk:week, cap:Math.round((b.loot||0)+(b.strength||1)*50000)}); if(b.hist.length>24) b.hist.shift();
    });
  }
  // Referee: build a combat-ready MgT2e stat block for a band's ship (name stamped with the band).
  function pirateCombatStats(b){
    const sh=pirateShipOf(b);
    return Object.assign({ name:`${b.name} — ${sh.name}` }, JSON.parse(JSON.stringify(sh.combat)));
  }
  // Players storm the band's base: they seize its Cr hoard AND its stolen-goods hold, and the band is
  // wiped out. Returns the haul so the referee can bank the credits + hand the players the cargo.
  function raidPirateBase(id){
    const b=pirateOf(id); if(!b) return null;
    const loot=Math.round(b.loot||0), hold=Object.assign({}, b.hold||{});
    const holdValue=Math.round(Object.keys(hold).reduce((s,g)=>s+hold[g]*(AGENT_VALUE[g]||100),0));
    b.loot=0; b.hold={}; b.strength=0; b.defunct=true;
    log(state.week, `🏴 ${b.name} — base stormed; its hoard is seized`);
    broadcastNews(state.week, null, 'pirate', `🏴 The ${b.name} has been broken — its base stormed and its hoard carried off.`);
    save();
    return { ok:true, name:b.name, base:b.base, baseLabel:(worlds[b.base]?worlds[b.base].label:b.base), loot, hold, holdValue };
  }

  // ── Referee overrides — force / pin / clear any world condition or black market, and bend the corps
  //    to the story (collapse, refloat, set the war-chest, plant or pull an expansion). All persisted;
  //    the ones that move state.base re-settle it immediately, exactly like setProfile / a corp invest. ──
  function statusOf(id){ const s=state.worldStatus&&state.worldStatus[id]; return wsLive(s)?s:null; }
  function setWorldStatus(id, kind, sev, weeks, note){
    ensure(); if(!worlds[id]) return false; if(!state.worldStatus) state.worldStatus={};
    if(!kind || kind==='none'){ state.worldStatus[id]={ kind:null, src:'ref', since:state.week, until:null, note:note||'' }; }   // suppress: deriver hands off, no badge
    else { if(WS_KINDS.indexOf(kind)<0) return false;
      state.worldStatus[id]={ kind, sev:Math.max(1,Math.min(3,Math.round(sev)||1)), src:'ref', since:state.week,
        until:(weeks>0?state.week+Math.round(weeks):null), note:note||'' }; }
    save(); return true;
  }
  function pinWorldStatus(id){ ensure(); const s=state.worldStatus&&state.worldStatus[id]; if(s){ s.src='ref'; save(); return true; } return false; }
  function clearWorldStatus(id){ ensure(); if(state.worldStatus&&state.worldStatus[id]){ delete state.worldStatus[id]; save(); } }
  function contrabandAt(id){ const s=state.contraband&&state.contraband[id]; return (s&&s.good&&(s.until==null||s.until>=state.week))?s:null; }
  function setContraband(id, good, weeks){ ensure(); if(!worlds[id]||!good) return false; if(!state.contraband) state.contraband={};
    state.contraband[id]={ good, since:state.week, until:(weeks>0?state.week+Math.round(weeks):null), premium:SMUGGLE_PREMIUM, src:'ref' }; save(); return true; }
  function clearContraband(id){ ensure(); if(state.contraband&&state.contraband[id]){ delete state.contraband[id]; save(); } }
  function blackMarketMult(id, good){ const s=state.contraband&&state.contraband[id]; return (s&&s.good===good&&(s.until==null||s.until>=state.week))?(s.premium||SMUGGLE_PREMIUM):1; }
  function dissolveCorp(id, mode){ ensure(); const c=state.corps&&state.corps[id]; if(!c) return false;
    state.agents=(state.agents||[]).filter(a=>a.backing!==id);   // a collapsed house's flagships are seized / sold off
    if(mode==='liquidate'){ const hadInvest=(c.invests||[]).length>0; delete state.corps[id];
      if(hadInvest){ worlds=null; adj=null; ensure(); state.base=recomputeBase(); }    // its expansions vanish → base shifts
      log(state.week, `⚑ ${c.name} — liquidated (referee)`); }
    else { c.defunct=true; if(c.treasury>0) c.treasury=0; log(state.week, `⚑ ${c.name} — collapsed; assets bought out (referee)`); }   // keep invests as a defunct shell → no base churn
    save(); return true; }
  function reviveCorp(id){ ensure(); const c=state.corps&&state.corps[id]; if(!c) return false; c.defunct=false; if(c.treasury<CORP_SEED_TREASURY) c.treasury=CORP_SEED_TREASURY;
    if(!state.agents.some(a=>a.backing===id)){ state.agentSeq=(state.agentSeq||state.agents.length)+1; state.agents.push(newCorpShip('tr'+state.agentSeq, corpShipName(c), c, pick(CORP_SHIP_POOL), CORP_SHIP_COST)); }
    log(state.week, `✦ ${c.name} — refloated (referee)`); save(); return true; }
  function setCorpTreasury(id, amt){ ensure(); const c=state.corps&&state.corps[id]; if(!c) return false; c.treasury=Math.round(+amt)||0; if(c.defunct&&c.treasury>0) c.defunct=false; save(); return true; }
  function addCorpInvest(id, world){ ensure(); const c=state.corps&&state.corps[id]; if(!c||!worlds[world]) return false;
    c.invests=c.invests||[]; c.invests.push({ world, wk:state.week }); worlds=null; adj=null; ensure(); state.base=recomputeBase(); save(); return true; }
  function removeCorpInvest(id, world){ ensure(); const c=state.corps&&state.corps[id]; if(!c||!c.invests) return false;
    const i=c.invests.findIndex(iv=>iv.world===world); if(i<0) return false; c.invests.splice(i,1); worlds=null; adj=null; ensure(); state.base=recomputeBase(); save(); return true; }

  function step(week){
    state.shocks = state.shocks.filter(s=> s.until==null || s.until>=week);
    const blk = blocked();
    const land = []; state.transit = state.transit.filter(t=>{ if(t.eta<=week){ land.push(t); return false; } return true; });
    land.forEach(t=> setStk(t.to,t.good, stk(t.to,t.good)+t.qty));

    Object.values(worlds).forEach(w=>{
      const ff = foodFactor(w.id);                              // hungry workforce throttles all non-food output (food itself is exempt — farmers eat first)
      for(const g in w.prod){
        const cap = w.prod[g] * outputFactor(w.id, g) * (g===FOOD_GOOD ? 1 : ff);
        const storeCap = safety(w,g) + w.prod[g]*2;                 // idle when warehouses are full — no infinite hoarding, so a producer shock actually bites
        const r = GOODS[g].recipe; let made = Math.min(cap, Math.max(0, storeCap - stk(w.id,g)));
        if(r) for(const inp in r) made = Math.min(made, stk(w.id,inp)/r[inp]);
        made = Math.max(0, made);
        if(r) for(const inp in r) setStk(w.id,inp, stk(w.id,inp)-made*r[inp]);
        setStk(w.id,g, stk(w.id,g)+made);
      }
      for(const g in w.cons) setStk(w.id,g, stk(w.id,g) - w.cons[g]*demandFactor(w.id,g));
    });

    Object.values(worlds).forEach(w=>{ for(const g of SIM_GOODS){
      if(stk(w.id,g)<0) log(week, `${w.label}: ${g} shortfall`); setStk(w.id,g, stk(w.id,g)); } });

    // replenishment — order-up-to, multi-source (nearest first), in-transit aware
    const incoming = {};
    state.transit.forEach(t=>{ if(!incoming[t.to]) incoming[t.to]={}; incoming[t.to][t.good]=(incoming[t.to][t.good]||0)+t.qty; });
    // Index producers by good ONCE per step (prod rates are static within a step) — turns the inner
    // producer scan from O(worlds) into O(producers-of-g), so the whole pass is O(worlds×producers)
    // not O(worlds²×goods). Behaviour is identical: same candidate set, same distance sort. Critical
    // now the galaxy is ~180 worlds (was O(n²) → tens of ms/step; see gen-galaxy.mjs).
    const prodByGood = {};
    Object.values(worlds).forEach(p=>{ for(const g in p.prod){ if(p.prod[g]) (prodByGood[g]=prodByGood[g]||[]).push(p); } });
    Object.values(worlds).sort((a,b)=> stress(a)-stress(b)).forEach(w=>{   // neediest worlds get first claim on producer surplus
      if(blk[w.id]) return;
      const D = distC(w.id, blk);
      SIM_GOODS.forEach(g=>{
        const d = demandFor(w,g); if(d<=0) return;
        const have = stk(w.id,g) + ((incoming[w.id]||{})[g]||0);
        let need = Math.min(orderUpTo(w,g) - have, d*3);          // cap per-tick pull so no world hoards / drains a producer in one tick
        if(need < d*0.5) return;                                  // hysteresis — skip trivial top-ups
        const prods = (prodByGood[g]||[]).filter(p=> p.id!==w.id && !blk[p.id] && D[p.id]!=null && !embargoed(w.id,p.id))
                        .sort((a,b)=> D[a.id]-D[b.id]);
        for(const p of prods){
          if(need<=0) break;
          const surplus = stk(p.id,g) - safety(p,g); if(surplus<=0) continue;
          let qty = Math.min(need, surplus); if(qty<=0) continue;
          qty *= tariffMult(p.id, w.id, g);                          // import tariff prices out part of the shipment
          qty = Math.round(qty*100)/100; if(qty<=0) continue;
          setStk(p.id,g, stk(p.id,g)-qty);
          state.transit.push({ good:g, qty, from:p.id, to:w.id, eta: week + Math.max(1,D[p.id]) });
          need -= qty;
        }
      });
    });
    psmStep(week);               // update the EMA price signal BEFORE anyone reads pressure() this week
    agentsStep(week);            // autonomous Independents arbitrage the resulting price gaps
    corpsStep(week);             // corporations: treasury sweep/bail, fleet growth, infrastructure investment (referee-only)
    worldStatusStep(week);       // per-world socio-economic status (boom/bust/unrest/rationing) — referee-only, persisted (unrest dampens output next step)
    contrabandStep(week);        // trade restrictions → black markets + smuggling jobs — referee-only
    directorStep(week);          // the galaxy makes its own trouble — reads this week's signals, fires its own bounded shock (referee-only)
    factionsStep(week);          // major powers as strategy-game actors — income, relations/diplomacy, statecraft, budget & contracts (referee-only)
    piratesStep(week);           // autonomous raider bands — prey on convoys, grow notorious, draw bounties, get broken up (referee-only)
    inflationStep(week);         // shortages ratchet the price level up (sticky); calm decays it back
    priceHistStep(week);         // sample per-world prices for the price-history charts
    state.week = week;
  }

  // Max weeks we will step one-at-a-time to catch the sim up to the live calendar.
  // A persisted week can lag the Imperial calendar by tens of thousands of weeks
  // (year 1105 ≈ week 57,617; a real saved row hit 179,197). Looping step() over
  // that gap froze the tab for tens of seconds (~0.32 ms/step). Bigger gaps snap to
  // a freshly-settled resting baseline instead — coherent prices, fixed cost. ~5 yrs.
  const MAX_CATCHUP = 260;
  // Re-establish a coherent steady state at `wk` WITHOUT stepping every intervening
  // week. Re-seeds stock to each world+good's settled resting level (same baseline
  // machinery freshState uses) and rebases the in-flight pipeline to `wk`, while
  // preserving campaign-level fields (active flag, agent roster + banked profit,
  // timeline, traders setting). After this stock == base, so pressures read ~0.
  function reseedTo(wk){
    ensure();
    worlds=null; adj=null; ensure();   // defensive: settle the topology that matches the current state.corps
    const seed = {};
    Object.values(worlds).forEach(w=>{ seed[w.id]={};
      SIM_GOODS.forEach(g=>{ const s=orderUpTo(w,g); if(s>0||w.prod[g]) seed[w.id][g]=Math.round(s); }); });
    const settled = settleBaseline(seed);
    const base = settled.stock;
    const stock = {}; Object.keys(base).forEach(id=>{ stock[id]=Object.assign({},base[id]); });
    state.base = base;
    state.stock = stock;
    state.transit = (settled.transit||[]).map(t=> Object.assign({}, t, { eta: wk + (t.eta - SETTLE_WK) }));
    state.shocks = (state.shocks||[]).filter(s=> s.until==null || s.until>=wk);   // long-expired shocks drop
    (state.agents||[]).forEach(a=>{ a.route=null; a.insolventWk=0; });           // in-flight convoys would have landed ages ago; don't bankrupt everyone on a big time-skip
    state.week = wk;
  }
  // A corp investment during the per-week loop only RECORDS itself (state._corpDirty); we re-settle
  // base ONCE here, not per-investment inside step() — bounds the settle cost and keeps base stable
  // across the advance (see Determinism design).
  function corpResettle(){ if(state._corpDirty){ state._corpDirty=false; worlds=null; adj=null; ensure(); state.base=recomputeBase(); } }
  function advance(weeks){ ensure(); const target = state.week + Math.max(1, Math.round(weeks));
    if(target - state.week > MAX_CATCHUP) reseedTo(target);                       // gap too large to step — snap to resting baseline
    else for(let wk=state.week+1; wk<=target; wk++) step(wk);
    corpResettle(); save(); }
  function syncToDate(){ ensure(); const now=curWeek();
    if(now>state.week && state.active){
      if(now - state.week > MAX_CATCHUP) reseedTo(now);                           // gap too large to step — snap to resting baseline
      else for(let wk=state.week+1; wk<=now; wk++) step(wk);
      corpResettle(); save(); }
    else if(now!==state.week){ state.week=now; } }

  // Price pressure = signed deviation of current stock from this world+good's own
  // settled equilibrium (state.base). 0 = at its normal level (steady baseline for
  // every world regardless of how high or low it naturally rests); negative = drawn
  // down below normal → dearer; positive = glutted above normal → cheaper. A shock
  // that thins a buffer reads as real dearness immediately, propagating down a trade
  // spine and decaying with distance, so the sim "moves" at the player trade console.
  // Self-calibrating from the deterministic baseline → identical prices on every device.
  // Normalised instantaneous deviation of stock from this world+good's settled baseline
  // (clamped ±0.5 → ±4 pressure). null for unpriced / isolated-frontier worlds: only price
  // worlds holding a real working stock (≥~1wk cover) so the frontier rides seeded noise, not
  // a phantom permanent crisis.
  function rawDev(id, good){
    if(!state || !state.active || !worlds || !worlds[id] || GOODS[good]==null) return null;
    const w = worlds[id]; if(!(w.cons[good]||w.prod[good]||recipeDraw(w,good))) return null;
    const ref = (state.base && state.base[id] && state.base[id][good]) || 0;
    if(ref < Math.max(1, demandFor(w,good))) return null;
    return Math.max(-0.5, Math.min(0.5, stk(id,good)/ref - 1));
  }
  // PRICE-SMOOTHING. The weekly inventory of import-heavy worlds sawtooths hard (drain → a big
  // replenishment shipment overshoots → drain again), so pricing straight off raw stock makes
  // prices spike ±every week. Instead price off an EMA of the deviation — a market reacts to the
  // TREND, not a single-week blip — so a SUSTAINED shortage still bites (the EMA converges over a
  // few weeks) while the bang-bang noise is filtered out. Persisted (deterministic); the actual
  // stock flows, baseline and galaxy balance are untouched — only the price READING is smoothed.
  const PSM_ALPHA = 0.2;
  function smoothedDev(id, good){
    const r = rawDev(id,good); if(r==null) return null;
    const m = state.psm; return (m && m[id] && m[id][good]!=null) ? m[id][good] : r;
  }
  function psmStep(week){
    if(!state.psm) return;   // settle's scratch state has none → skipped (determinism)
    Object.keys(worlds).forEach(id=>{ SIM_GOODS.forEach(g=>{ if(GOODS[g].internal) return;
      const r=rawDev(id,g); if(r==null) return;
      const m=state.psm[id]||(state.psm[id]={});
      m[g] = (m[g]==null) ? r : m[g] + (r-m[g])*PSM_ALPHA; }); });
  }
  function pressure(id, good){ const d=smoothedDev(id,good); return d==null?null:Math.max(-4,Math.min(4,Math.round(d*8))); }
  // Traders react to the REAL spot inventory (un-smoothed), so they still catch transient
  // shortages and call at marginal worlds — while everything DISPLAYED (player prices, the chart,
  // inflation, rumours) reads the smoothed pressure() above.
  function rawPressure(id, good){ const d=rawDev(id,good); return d==null?null:Math.max(-4,Math.min(4,Math.round(d*8))); }
  // Continuous (un-quantized) Cr/kt price for the history chart — smooth, no integer step-jumps.
  function priceSample(id, good){ const d=smoothedDev(id,good); return d==null?null:Math.round(agentUnitPrice(good, Math.max(-4,Math.min(4,d*8)), id)); }

  // ── Sticky-spike inflation ───────────────────────────────────────────────────
  // A persistent per-world, per-good price-LEVEL index (1 = par). Each live week a
  // shortage ratchets it UP fast; otherwise it decays SLOWLY back toward 1 — so repeated
  // crises leave a lasting higher price level (recognisably "inflation"), yet it is bounded
  // and self-healing so it can't run away. Lives in state (clears on reset, persists in the
  // shared row) and is SKIPPED by settleBaseline (the scratch state has no .infl field) — so
  // the deterministic baseline is untouched. Applied as a multiplier OUTSIDE the bounded
  // priceMult table, so the price level can genuinely climb (and enrich traders selling in).
  const INFL_UP=0.07, INFL_DOWN=0.03, INFL_MAX=3.0;
  function inflOf(id, good){ const m=state.infl; return (m && m[id] && m[id][good]) || 1; }
  function priceAdjOf(id, good){ let m = padjMult(priceAdj.world[id]||0);   // world-wide nudge × per-good nudge
    const gg = priceAdj.good[id]; if(gg && gg[good]) m *= padjMult(gg[good]); return m; }
  function inflMult(id, good){ return state.active ? inflOf(id,good) : 1; }   // sticky inflation = full-sim only
  function overlayMult(id, good){ return priceAdjOf(id,good) * inflMult(id,good) * monopolyMult(id,good); }   // shared seam: manual × inflation × (opt-in) monopoly premium
  function inflationStep(week){
    if(!state.infl) return;                                          // scratch settle state has none → skipped (determinism)
    const goods = SIM_GOODS.filter(g=>!GOODS[g].internal);
    Object.keys(worlds).forEach(id=>{ goods.forEach(g=>{
      const p = pressure(id,g); if(p==null) return;
      const w = worlds[id], dem = demandFor(w,g), cover = dem>0 ? stk(id,g)/dem : Infinity;
      let v = inflOf(id,g);
      // Inflate only on GENUINE scarcity: below its own baseline (p≤−2) AND physically running
      // out (<1wk of cover). A world merely riding below a high baseline but still well-stocked
      // doesn't inflate — that keeps the calm galaxy near par (only real crises move the level).
      if(p <= -2 && cover < 1) v *= (1 + INFL_UP * (-p)/4);          // running short (dearer) → prices ratchet up fast
      else v += (1 - v) * INFL_DOWN;                                 // otherwise sticky decay back toward par
      v = Math.max(1, Math.min(INFL_MAX, v));
      if(v <= 1.0001){ if(state.infl[id]){ delete state.infl[id][g]; if(!Object.keys(state.infl[id]).length) delete state.infl[id]; } }
      else (state.infl[id]=state.infl[id]||{})[g]=Math.round(v*1000)/1000;
    }); });
  }
  // Combined price-level multiplier the player console + traders apply ON TOP of the bounded
  // local price: manual referee adjustment × (sticky inflation, full-sim only).
  function priceOverlay(id, good){ ensure(); return overlayMult(id, good); }
  function inflationLevel(){ ensure(); let s=0,n=0;          // galaxy inflation gauge: mean index over ALL priced pairs (≈1 unless inflation is broad)
    const goods=SIM_GOODS.filter(g=>!GOODS[g].internal);
    Object.keys(worlds).forEach(id=>goods.forEach(g=>{ if(pressure(id,g)==null) return; s+=inflOf(id,g); n++; }));
    return n? s/n : 1; }

  // ── Price-history sampling (for the console's price-over-time charts) ─────────
  // Each live week, record every priced world's Cr/kt for each tracked good, into a rolling
  // window. SESSION-ONLY (not in save()) so the synced row stays lean — it accumulates as the
  // referee advances the sim. Skipped by settleBaseline (its scratch state has no priceHist).
  const PRICEHIST_CAP = 60;
  function priceHistStep(week){
    if(!state.priceHist) return;
    const ph=state.priceHist; ph.wk.push(week); if(ph.wk.length>PRICEHIST_CAP) ph.wk.shift();
    SIM_GOODS.filter(g=>!GOODS[g].internal).forEach(g=>{ const gm=ph.goods[g]||(ph.goods[g]={});
      Object.keys(worlds).forEach(id=>{ const price=priceSample(id,g);   // smooth, un-quantized Cr/kt
        const arr=gm[id]||(gm[id]=[]); arr.push(price); if(arr.length>PRICEHIST_CAP) arr.shift(); }); });
  }

  async function load(){ try { ensure(); const r = await supaStorage.get('econ-state', true);
    if(r.value!=null){ state = Object.assign(freshState(), JSON.parse(r.value));
      worlds=null; adj=null; ensure(); state.base = recomputeBase();   // freshState's base predates the merged state.corps; re-derive so the loaded corp investments are reflected (every device — players inherit base this way)
    } } catch(e){} }
  function save(){ try { if(typeof isReferee==='function' && !isReferee()) return;
    supaStorage.set('econ-state', JSON.stringify({ week:state.week, active:state.active, stock:state.stock, transit:state.transit, shocks:state.shocks, log:state.log, history:state.history, agents:state.agents, tradersOn:state.tradersOn, traderCap:state.traderCap, agentSeq:state.agentSeq, infl:state.infl, psm:state.psm, corps:state.corps, corpEvents:state.corpEvents, monopolyOn:state.monopolyOn, worldStatus:state.worldStatus, contraband:state.contraband, directorOn:state.directorOn, director:state.director, factionsOn:state.factionsOn, factions:state.factions, factionEvents:state.factionEvents, news:state.news, piratesOn:state.piratesOn, pirates:state.pirates, pirSeq:state.pirSeq }), true); } catch(e){} }
  function reset(){ const wasActive = !!(state && state.active); state = freshState(); state.active = wasActive;
    reseedTo(state.week);   // freshState ran buildTopology against the OLD state.corps; reseedTo rebuilds the topology against the NOW-live fresh (empty-invest) corps AND snaps stock+base+transit together to the resting level (so stock==base, pressures read ~0)
    save(); }   // reseed stock; keep the current Simple/Full mode

  const PRESETS = [
    { id:'raid',     label:'Pirate raid — Erebus ore', kind:'output', target:'erebus', good:'Common Ore', factor:0.7, weeks:6 },
    { id:'blockade', label:'Blockade — Alpha Centauri', kind:'block',  target:'pollux', weeks:6 },
    { id:'cypress',  label:'Cypress automation failure', kind:'output', target:'cypress', good:'Common Consumables', factor:0.2, weeks:8 },
    { id:'embargo',  label:'Hegemony / OmniSynth embargo', kind:'embargo', facA:'hegemony', facB:'omnisynth', weeks:8 },
    { id:'museum',   label:'Strike — The Museum (food SPOF)', kind:'block', target:'the-museum', weeks:6 },
    // ── Worker strikes (output cuts) — varied worker types & goods ──
    { id:'miners',   label:'⛏ Miners’ strike — Profit Margin', kind:'output', target:'profit-margin', good:'Common Ore', factor:0.3, weeks:4 },
    { id:'foundry',  label:'⚙ Foundry strike — Kronos', kind:'output', target:'kronos', good:'Common Electronics', factor:0.3, weeks:5 },
    { id:'forge',    label:'🔨 Forge strike — Castor', kind:'output', target:'castor', good:'Common Manufactured', factor:0.3, weeks:5 },
    { id:'farm',     label:'🌾 Farmhands’ walkout — The Garden', kind:'output', target:'the-garden', good:'Common Consumables', factor:0.3, weeks:4 },
    { id:'dockers',  label:'🚢 Dockworkers’ strike — The Warehouse', kind:'block', target:'warehouse', weeks:5 },
    // ── Politics: a faction-wide crackdown restricting a good across its space ──
    { id:'crackdown',label:'⚖ Hegemony crackdown — high-tech', kind:'crackdown', faction:'hegemony', good:'Advanced Electronics', factor:0.2, weeks:6 },
    { id:'tariff',   label:'⚖ Hegemony import tariff — electronics', kind:'tariff', faction:'hegemony', good:'Common Electronics', factor:0.4, weeks:6 },
    // ── New value-chain disruptions (deeper goods graph) ──
    { id:'biorefinery', label:'⚗ Bio-refinery failure — Cypress', kind:'output', target:'cypress', good:'Biochemicals', factor:0.2, weeks:5 },
    { id:'minecollapse',label:'💎 Mine collapse — Precious Metals', kind:'output', target:'profit-margin', good:'Precious Metals', factor:0.15, weeks:5 },
    { id:'plague',      label:'☣ Plague — pharma demand spike (Hegemony)', kind:'demand', faction:'hegemony', good:'Pharmaceuticals', factor:3, weeks:5 },
  ];
  function fire(p){ ensure(); const s = Object.assign({}, p); s.until = (p.weeks!=null)? state.week + p.weeks : null; s.fired=state.week; state.shocks.push(s);
    if(!state.history) state.history=[];
    state.history.unshift({ label:s.label||s.kind, kind:s.kind, beganWk:state.week, endsWk:s.until });   // dated campaign timeline
    if(state.history.length>40) state.history.length=40;
    save(); }
  function cancel(i){ state.shocks.splice(i,1); save(); }

  function facName(id){ return (''+id).replace(/(^|[-_ ])(\w)/g, (m,a,b)=>(a?' ':'')+b.toUpperCase()).trim(); }
  // Current newsworthy economic signals, for the Oracle to turn into TRUE rumours:
  // active shocks (with their origin world+good) and the sharpest shortages/gluts.
  // Ranked shocks-first, then by deviation magnitude. Empty when the sim is off/quiet.
  function intel(){
    ensure();
    if(!state || !state.active) return [];
    const out = [];
    state.shocks.forEach(s=>{
      let label;
      if(s.kind==='crackdown' || s.kind==='tariff' || (s.kind==='demand' && s.faction)) label = facName(s.faction);
      else if(s.target && worlds[s.target]) label = worlds[s.target].label;
      else if(s.kind==='embargo') label = facName(s.facA)+' & '+facName(s.facB);
      else label = s.target || 'the lanes';
      out.push({ kind:'shock', shock:s.kind, world:s.target||null, label, good:s.good||null });
    });
    // CORP CONTRACT HOOKS — surface flagged corp jobs so the Oracle can leak them as ambient rumours
    // (the console's "Corporate contracts" section is the primary, targeted path). Ranked LAST so they
    // never crowd out true market intel in the "Market whisper" pick.
    (state.corpEvents||[]).forEach(e=>{ const it=corpContractItem(e); if(it) out.push(it); });
    (state.factionEvents||[]).forEach(e=>{ const it=factionContractItem(e); if(it) out.push(it); });   // faction (state) jobs — same rumour pipeline
    // World-status conditions + black markets — the Oracle can whisper these as ambient news/rumour.
    if(state.worldStatus) Object.keys(state.worldStatus).forEach(id=>{ const s=state.worldStatus[id];
      if(s && s.kind && worlds[id] && (s.until==null||s.until>=state.week)) out.push({ kind:'status', status:s.kind, sev:s.sev||1, world:id, label:worlds[id].label }); });
    if(state.contraband) Object.keys(state.contraband).forEach(id=>{ const s=state.contraband[id];
      if(s && s.good && worlds[id] && (s.until==null||s.until>=state.week)) out.push({ kind:'blackmarket', world:id, label:worlds[id].label, good:s.good }); });
    // GalNet headlines — the Oracle can broadcast the latest government / diplomacy news as a true rumour.
    (state.news||[]).slice(0,6).forEach(n=>{ if(n && n.text) out.push({ kind:'news', text:n.text, faction:n.fac||null, label:n.fac?facName2(n.fac):'GalNet', newsKind:n.kind }); });
    const goods = SIM_GOODS.filter(g=>!GOODS[g].internal);
    Object.keys(worlds).forEach(id=>{ goods.forEach(g=>{
      const p = pressure(id,g); if(p==null) return;
      if(p<=-2) out.push({ kind:'shortage', world:id, label:worlds[id].label, good:g, pressure:p });
      else if(p>=3) out.push({ kind:'glut', world:id, label:worlds[id].label, good:g, pressure:p });
    }); });
    out.sort((a,b)=>{ const r=x=> x.kind==='shock'?0:(x.kind==='news'?3:((x.kind==='contract'||x.kind==='blackmarket')?2:1));
      if(r(a)!==r(b)) return r(a)-r(b); return Math.abs(b.pressure||4)-Math.abs(a.pressure||4); });
    return out;
  }

  // A logged party cargo run nudges the marginal price: buying good G at `from`
  // tightens it there, selling at `to` eases it there. Modelled in price-NOTCH space
  // (1 notch = ref/8 of stock, since pressure = (stk/ref−1)*8) so a player-scale hold
  // registers despite the kt-scale sim. Destination relief is amplified by how short
  // it already is — running relief into a crisis matters most — and every effect is
  // capped so a single run can't erase a shortage or crash a source.
  const TONS_PER_NOTCH = 300;   // tons ≈ one price notch into a balanced market (tunable game-feel knob)
  function refOf(id, good){ return (state.base && state.base[id] && state.base[id][good]) || (worlds[id] ? safety(worlds[id],good) : 0); }
  function applyRun(from, good, to, tons){
    ensure();
    if(!state || GOODS[good]==null) return { ok:false, msg:'Pick a tracked good' };
    tons = Math.max(0, Math.round(+tons||0)); if(tons<=0) return { ok:false, msg:'Enter a tonnage' };
    if(from===to) return { ok:false, msg:'From and To must differ' };
    const W = tons / TONS_PER_NOTCH, moves = [];
    if(to && worlds[to]){
      const refD = refOf(to,good), pB = pressure(to,good), shortfall = (pB!=null && pB<0) ? -pB : 0;
      const notches = Math.min(W * (1 + shortfall*0.6), 2);          // shortage-amplified, capped
      if(refD>0 && notches>0){ setStk(to,good, stk(to,good) + notches*refD/8);
        moves.push({ label:worlds[to].label, dir:'eased', notches:+notches.toFixed(2) }); }
    }
    if(from && worlds[from]){
      const refS = refOf(from,good), notches = Math.min(W*0.5, 1);   // pulling supply out, smaller + capped
      if(refS>0 && notches>0){ setStk(from,good, Math.max(0, stk(from,good) - notches*refS/8));
        moves.push({ label:worlds[from].label, dir:'tightened', notches:+notches.toFixed(2) }); }
    }
    const fl = from&&worlds[from]?worlds[from].label:'—', tl = to&&worlds[to]?worlds[to].label:'—';
    log(state.week, `Cargo run · ${tons}t ${good.replace('Common ','')} ${fl}→${tl}`);
    save();
    return { ok:true, moves };
  }

  // ── Designer economy profiles + production-chain resolution ─────────────────
  function defProfileOf(id){ const d = DEF[id] || derivedProfile(id); return { prod: d.prod||{}, cons: d.cons||{} }; }
  function effectiveProfileOf(id){ const ov = profiles[id], d = defProfileOf(id);
    return { prod:(ov&&ov.prod)?ov.prod:d.prod, cons:(ov&&ov.cons)?ov.cons:d.cons, overridden:!!ov }; }
  function isMarketId(id){ ensure(); return !!worlds[id]; }   // false for vast/archon (no-market factions)

  // Pure, cycle-safe production-chain resolver. Given an output good + its rate, return a
  // tree: each node carries the good, its scaled rate, whether it's a raw (no recipe), and
  // its child inputs. Tracks the ancestry path; if an input recurs in its own ancestry it's
  // flagged cycle:true and NOT expanded — so a malformed recipe (A→B→A) can never recurse
  // forever. Depth-capped as a second guard. The editor commits only the DIRECT children
  // (node.inputs[*].rate); deeper tiers are preview-only (upstream worlds draw their own).
  function resolveChain(good, rate, _path, _depth){
    rate = +rate||0; _path = _path||[]; _depth = _depth||0;
    const recipe = (GOODS[good] && GOODS[good].recipe) || null;
    const node = { good, rate:Math.round(rate*1000)/1000, raw:!recipe, cycle:false, inputs:[] };
    if(!recipe || _depth >= 12) return node;
    for(const inp in recipe){
      const qty = recipe[inp]*rate;
      if(inp===good || _path.indexOf(inp) >= 0){            // input is its own ancestor → circular
        node.inputs.push({ good:inp, rate:Math.round(qty*1000)/1000, raw:!(GOODS[inp]&&GOODS[inp].recipe), cycle:true, inputs:[] });
      } else {
        node.inputs.push(resolveChain(inp, qty, _path.concat(good), _depth+1));
      }
    }
    return node;
  }
  function chainHasCycle(node){ return !!node && (node.cycle || (node.inputs||[]).some(chainHasCycle)); }
  // Direct recipe inputs a prod map draws (one level, scaled, summed) — exactly recipeDraw()'s
  // rule, surfaced so the editor can SHOW auto-imported inputs. NEVER written to cons (the sim
  // already derives them from prod via recipeDraw; listing them in cons would double-count).
  function autoInputsOf(prodMap){
    const out = {};
    for(const g in prodMap){ const r = GOODS[g] && GOODS[g].recipe; if(!r) continue;
      for(const inp in r) out[inp] = (out[inp]||0) + r[inp]*prodMap[g]; }
    return out;
  }

  // Net galaxy supply of a good = Σ producers − Σ (final demand + recipe draw). With
  // (ovId,ovProd,ovCons) the named world's contribution is swapped for a candidate profile,
  // so before/after the same call diffs a pending edit. Aggregates every world — so a good
  // made/used on many worlds sums correctly instead of being overwritten.
  function worldNetOf(prodMap, consMap, good){
    let draw = 0; for(const out in prodMap){ const r = GOODS[out] && GOODS[out].recipe; if(r && r[good]) draw += r[good]*prodMap[out]; }
    return (prodMap[good]||0) - ((consMap[good]||0) + draw);
  }
  function galaxyNetOf(good, ovId, ovProd, ovCons){
    ensure(); let n = 0;
    Object.values(worlds).forEach(w=>{ n += (ovId && w.id===ovId) ? worldNetOf(ovProd||{}, ovCons||{}, good) : worldNetOf(w.prod, w.cons, good); });
    return n;
  }
  // Live Market Impact for a pending edit — no persistence, no re-settle. For every good the
  // edit touches (directly or via recipe draw) report galaxy net supply before/after + a
  // qualitative price arrow. Prices here renormalise to each world's settled baseline, so the
  // honest stable signal is the STRUCTURAL balance: pushing a good toward deficit makes it
  // chronically dearer (▲), toward surplus cheaper (▼). deficit flags goods the galaxy can no
  // longer cover; newDeficit flags an edit that TIPS a good from covered into deficit.
  function marketImpact(id, prod, cons){
    ensure();
    const cur = effectiveProfileOf(id), goods = new Set();
    [prod, cur.prod].forEach(m=>{ for(const g in m){ goods.add(g); const r = GOODS[g] && GOODS[g].recipe; if(r) for(const inp in r) goods.add(inp); } });
    [cons, cur.cons].forEach(m=>{ for(const g in m) goods.add(g); });
    const out = [];
    goods.forEach(g=>{ if(GOODS[g]==null) return;
      const before = galaxyNetOf(g, id, cur.prod, cur.cons), after = galaxyNetOf(g, id, prod, cons);
      const delta = Math.round((after-before)*100)/100;
      if(Math.abs(delta) < 0.005) return;
      out.push({ good:g, before:Math.round(before*100)/100, after:Math.round(after*100)/100,
                 delta, arrow: delta>0?'▼':'▲', deficit: after < 0, newDeficit: after<0 && before>=0 });
    });
    out.sort((a,b)=> Math.abs(b.delta)-Math.abs(a.delta));
    return out;
  }

  // Commit a pending edit: store the override, rebuild the trade topology with it in place,
  // and re-settle the baseline so live prices reflect the new structure (mirrors syncLanes()).
  function setProfile(id, prod, cons){
    ensure();
    profiles[id] = { prod: prod||{}, cons: cons||{} };
    worlds = null; adj = null; ensure();
    state.base = recomputeBase();
    saveProfiles(); save();
  }
  function clearProfile(id){
    ensure();
    if(!profiles[id]) return;
    delete profiles[id];
    worlds = null; adj = null; ensure();
    state.base = recomputeBase();
    saveProfiles(); save();
  }
  async function loadProfiles(){ try { const r = await supaStorage.get('econ-profiles', true);
    if(r.value!=null){ profiles = JSON.parse(r.value) || {}; worlds = null; adj = null; ensure(); state.base = recomputeBase(); } } catch(e){} }
  function saveProfiles(){ try { if(typeof isReferee==='function' && !isReferee()) return;
    supaStorage.set('econ-profiles', JSON.stringify(profiles), true); } catch(e){} }
  async function loadPriceAdj(){ try { const r = await supaStorage.get('econ-priceadj', true);
    if(r.value!=null){ const v=JSON.parse(r.value)||{}; priceAdj={ world:v.world||{}, good:v.good||{} }; } } catch(e){} }
  function savePriceAdj(){ try { if(typeof isReferee==='function' && !isReferee()) return;
    supaStorage.set('econ-priceadj', JSON.stringify(priceAdj), true); } catch(e){} }
  function setWorldPriceAdj(id, notch){ ensure(); notch=clampNotch(notch); if(notch) priceAdj.world[id]=notch; else delete priceAdj.world[id]; savePriceAdj(); }
  function setGoodPriceAdj(id, good, notch){ ensure(); notch=clampNotch(notch); priceAdj.good[id]=priceAdj.good[id]||{};
    if(notch) priceAdj.good[id][good]=notch; else { delete priceAdj.good[id][good]; if(!Object.keys(priceAdj.good[id]).length) delete priceAdj.good[id]; } savePriceAdj(); }
  function clearPriceAdjAt(id){ ensure(); delete priceAdj.world[id]; delete priceAdj.good[id]; savePriceAdj(); }

  return {
    GOODS, SIM_GOODS, PRESETS,
    ensure, advance, syncToDate, pressure, intel, applyRun, fire, cancel, reset, load, save,
    resolveChain, chainHasCycle, autoInputsOf, marketImpact, isMarketId,
    effectiveProfile: effectiveProfileOf, defProfile: defProfileOf, setProfile, clearProfile,
    loadProfiles, saveProfiles,
    // Snapshot / restore the raw designer-profile overrides (for Design-Mode undo).
    exportProfiles(){ return JSON.parse(JSON.stringify(profiles||{})); },
    importProfiles(obj){ profiles = obj || {}; worlds = null; adj = null; ensure(); state.base = recomputeBase(); saveProfiles(); save(); },
    get state(){ ensure(); return state; },
    worlds(){ ensure(); return worlds; },
    active(){ return !!(state && state.active); },
    setActive(v){ ensure(); state.active=!!v; if(v) state.week=curWeek(); save(); },
    coverWeeks(id,g){ ensure(); const w=worlds[id]; if(!w) return null; const rate=(w.cons[g]||0)+recipeDraw(w,g); return rate>0? stk(id,g)/rate : null; },
    foodFactor(id){ ensure(); return foodFactor(id); },   // 0..1 labour-output multiplier (1 = fed; <1 = larder running dry, all non-food output sagging)
    stock: stk, safety:(id,g)=>{ ensure(); return worlds[id]?safety(worlds[id],g):0; },
    agents(){ ensure(); (state.agents||[]).forEach(ensureAgentFuel); return state.agents||[]; },   // TASK 5: every trader always carries fuel state (idempotent — only fills missing fields)
    shipOf:(a)=>shipOf(a), SHIP_CLASSES,
    corps(){ ensure(); return state.corps||{}; },   // {corpId:{name,specialty,home,color,treasury,invests,megacorp,monopoly,playerShares,...}}
    isCorp,
    corpSpecialtyShare:(c)=>{ ensure(); return corpSpecialtyShare(c); },   // 0..1 — this house's slice of galactic output of its specialty
    galacticProd:(g)=>{ ensure(); return galacticProd(g); },
    monopolyOn(){ ensure(); return !!state.monopolyOn; },                  // opt-in price-affecting monopoly premium
    setMonopoly(v){ ensure(); state.monopolyOn=!!v; save(); },
    setCorpShares(id,pct){ ensure(); const c=state.corps&&state.corps[id]; if(!c) return; c.playerShares=Math.max(0,Math.min(100,Math.round(+pct)||0)); save(); },   // referee-only ledger: party's % stake in a house
    corpEvents(){ ensure(); return state.corpEvents||[]; },          // raw flagged contract opportunities
    contractItem:(e)=>{ ensure(); return corpContractItem(e); },     // raw event → rich, labelled contract item (reward, places, names)
    contractReward:(e)=>{ ensure(); return contractRewardOf(e); },
    clearCorpEvent(i){ ensure(); if(state.corpEvents) { state.corpEvents.splice(i,1); save(); } },   // referee dismisses an opportunity after drafting/ignoring it
    agentById(id){ ensure(); return (state.agents||[]).find(a=>a.id===id)||null; },
    tradersOn(){ ensure(); return state.tradersOn!==false; },
    setTraders(v){ ensure(); state.tradersOn=!!v; save(); },
    directorOn(){ ensure(); return state.directorOn!==false; },              // the event director — galaxy fires its own emergent shocks (full-sim only)
    setDirector(v){ ensure(); state.directorOn=!!v; save(); },
    // ── Faction AI — major powers as strategy-game actors (treasury, relations, statecraft, contracts) ──
    factionsOn(){ ensure(); return state.factionsOn!==false; },
    setFactions(v){ ensure(); state.factionsOn=!!v; save(); },
    factions(){ ensure(); if(!state.factions) state.factions=freshFactions(); return state.factions; },
    factionIds:()=>FAC_AI_IDS.slice(),
    // Design-Mode: the editable procedural-flavour name lists (minister names,
    // trader / pirate names) surfaced to the generator-tables editor. Each rides
    // the shared generator-overrides store via genList(key, base).
    flavourLists(){ return [
      { key:'gov.firstNames', label:'Minister first names',  group:'Government',       base:GOV_FIRST },
      { key:'gov.lastNames',  label:'Minister surnames',     group:'Government',       base:GOV_LAST },
      { key:'gov.traits',     label:'Minister traits',       group:'Government',       base:GOV_TRAITS },
      { key:'trader.names',   label:'Hauler company names',  group:'Traders & pirates', base:AGENT_NAMES },
      { key:'pirate.nameA',   label:'Pirate name — prefix',  group:'Traders & pirates', base:PIR_NAME_A },
      { key:'pirate.nameB',   label:'Pirate name — suffix',  group:'Traders & pirates', base:PIR_NAME_B },
    ]; },
    cabinetOf(id){ ensure(); const f=state.factions&&state.factions[id]; if(f&&(!f.cabinet||!f.cabinet.length)) f.cabinet=freshCabinet(id); return (f&&f.cabinet)||[]; },
    news(){ ensure(); return state.news||[]; },                               // GalNet feed — rolling headlines (cabinet changes, trade wars, détente, policy)
    relOf:(a,b)=>{ ensure(); return relOf(a,b); },                            // A→B stance (−100..+100)
    facName:(id)=>facName2(id), facColor:(id)=>facColorOf(id),
    factionEvents(){ ensure(); return state.factionEvents||[]; },             // raw faction contract opportunities
    factionContractItem:(e)=>{ ensure(); return factionContractItem(e); },    // raw event → rich, labelled contract item
    clearFactionEvent(i){ ensure(); if(state.factionEvents){ state.factionEvents.splice(i,1); save(); } },
    // referee overrides
    setFactionTreasury(id,amt){ ensure(); const f=state.factions&&state.factions[id]; if(!f) return false; f.treasury=Math.max(0,Math.round(+amt)||0); save(); return true; },
    setRelation(a,b,v){ ensure(); if(!state.factions||!state.factions[a]) return false; setRel(a,b,+v); setRel(b,a,+v); save(); return true; },
    liftFactionShock(a,b){ ensure(); const before=(state.shocks||[]).length;   // referee lifts a faction embargo/tariff between two powers
      state.shocks=(state.shocks||[]).filter(s=> !(s.src==='faction' && ((s.facA===a&&s.facB===b)||(s.facA===b&&s.facB===a) || (s.faction===a&&s.againstFac===b))));
      if(state.shocks.length!==before){ save(); return true; } return false; },
    // ── Pirate bands — autonomous raiders with rules-legal MgT2e / High Guard hulls ──
    piratesOn(){ ensure(); return state.piratesOn!==false; },
    setPirates(v){ ensure(); state.piratesOn=!!v; save(); },
    pirates(){ ensure(); if(!state.pirates) state.pirates=freshPirates(); return state.pirates; },
    pirateShips:()=>PIRATE_SHIPS, isPirate, goodValue:(g)=>(AGENT_VALUE[g]||100),
    pirateCombatStats:(id)=>{ ensure(); const b=pirateOf(id); return b?pirateCombatStats(b):null; },   // combat-ready MgT2e stat block
    // referee controls
    pirateRaidNow(id){ ensure(); const b=pirateOf(id); if(!b||b.defunct) return false; const v=pickRaidPrize(b); if(!v) return false; const ok=piratePlunder(b,v,state.week); save(); return ok; },
    raidPirateBase(id){ ensure(); return raidPirateBase(id); },   // players storm the base → seize loot + stolen-goods hold; band wiped out
    setPirateStrength(id,n){ ensure(); const b=pirateOf(id); if(!b) return false; b.strength=Math.max(0,Math.min(PIR_STR_MAX,Math.round(+n)||0)); if(b.strength<1){ b.defunct=true; } else b.defunct=false; save(); return true; },
    setPirateShip(id,ship){ ensure(); const b=pirateOf(id); if(!b||!PIRATE_SHIPS[ship]) return false; b.ship=ship; save(); return true; },
    disbandPirate(id){ ensure(); const b=pirateOf(id); if(!b) return false; b.defunct=true; log(state.week,`⚓ ${b.name} — disbanded (referee)`); save(); return true; },
    spawnPirate(){ ensure(); if(!state.pirates) state.pirates=freshPirates(); formPirateBand(state.week); save(); return true; },
    traderCap(){ ensure(); return traderCapOf(); },
    setTraderCap(v){ ensure(); state.traderCap=Math.max(3,Math.min(TRADER_CAP_MAX,Math.round(+v)||DEFAULT_TRADER_CAP)); save(); },
    priceOverlay, inflationLevel, inflationOf:(id,g)=>{ ensure(); return inflOf(id,g); },
    priceHist(){ ensure(); return state.priceHist||{wk:[],goods:{}}; },   // {wk:[...], goods:{good:{sysId:[Cr/kt...]}}} — session-only rolling window
    // Referee manual price controls (notches; + dearer, − cheaper). Works in Simple & Full mode, survives reset.
    worldPriceAdj:(id)=>{ ensure(); return priceAdj.world[id]||0; },
    goodPriceAdj:(id,g)=>{ ensure(); return (priceAdj.good[id]&&priceAdj.good[id][g])||0; },
    setWorldPriceAdj, setGoodPriceAdj, clearPriceAdjAt, loadPriceAdj, savePriceAdj,
    priceAdjMult:(id,g)=>{ ensure(); return priceAdjOf(id,g); },
    raidConvoy, syncLanes, disconnected,
    // World status + contraband — referee tools; players read the live (persisted) state for badges/black markets.
    WS_META, WS_KINDS,
    worldStatus:(id)=>{ ensure(); return statusOf(id); },           // effective status entry for a world, or null
    allWorldStatus(){ ensure(); return state.worldStatus||{}; },
    setWorldStatus, pinWorldStatus, clearWorldStatus,
    contraband:(id)=>{ ensure(); return contrabandAt(id); },        // {good,premium,...} if a black market exists here, else null
    allContraband(){ ensure(); return state.contraband||{}; },
    setContraband, clearContraband,
    blackMarketMult:(id,g)=>{ ensure(); return blackMarketMult(id,g); },   // price multiplier for a good on a world's black market (1 = none)
    dissolveCorp, reviveCorp, setCorpTreasury, addCorpInvest, removeCorpInvest,   // referee corp god-mode (force a collapse, etc.)
  };
})();

// ── Living Economy — referee console (panel + render) ───────────────────────
let econPanelOpen = false, econCollapsed = false;
let econRunSel = { from:'cypress', good:'Common Consumables', to:'aurelia', tons:30 };   // sticky cargo-run form
let econTraderSel = null;   // expanded trader detail (agent id) in the console
let econCorpSel = null;     // expanded corporation detail (corp id) — drawTrade highlights ALL its convoys
let econDraftSel = null;    // {i, item, contract} — a corp contract drafted from an opportunity, awaiting post
let econShockCfg = { weeks:6, severity:3 };   // sticky duration + severity for fired disruptions
let econWSCfg = { world:'cypress', kind:'unrest', sev:2, weeks:8 };   // sticky "force a world status" form
let econCBCfg = { world:'cypress', good:'Refined Fuel', weeks:8 };    // sticky "force a black market" form
let econPriceHistSel = { good:'Common Consumables', sys:'' };   // price-history chart selection
function econSetPriceHistGood(v){ econPriceHistSel.good=v; econPriceHistSel.sys=''; renderEconPanel(); }
function econSetPriceHistSys(v){ econPriceHistSel.sys=v; renderEconPanel(); }
// Price-over-time chart: galactic-average line for a good, plus (optionally) one system's line vs it.
function econPriceChartHTML(good, sysId){
  const ph=ECON.priceHist(), N=(ph.wk||[]).length;
  if(N<2) return `<div style="font-size:10px;color:var(--tx1)">No price history yet — switch to Full simulation and step a few weeks.</div>`;
  const gm=ph.goods[good]||{};
  const avg=[]; for(let i=0;i<N;i++){ let s=0,c=0; for(const id in gm){ const v=gm[id][i]; if(v!=null){s+=v;c++;} } avg.push(c?s/c:null); }
  const sysArr=(sysId&&gm[sysId])?gm[sysId]:null;
  let mn=Infinity,mx=-Infinity; [avg,sysArr].forEach(arr=>{ if(arr) arr.forEach(v=>{ if(v!=null){mn=Math.min(mn,v);mx=Math.max(mx,v);} }); });
  if(!isFinite(mn)) return `<div style="font-size:10px;color:var(--tx1)">No price data for ${escQH(good.replace('Common ',''))} yet.</div>`;
  if(mn===mx){ mn=mn*0.95; mx=mx*1.05||1; }
  const W=300,H=110,PADT=4,PADB=4, X=i=>2+(i/(N-1))*(W-4), Y=v=>H-PADB-((v-mn)/(mx-mn))*(H-PADT-PADB);
  const pathOf=arr=>{ let d='',pen=false; for(let i=0;i<arr.length;i++){ const v=arr[i]; if(v==null){pen=false;continue;} d+=(pen?'L':'M')+X(i).toFixed(1)+','+Y(v).toFixed(1)+' '; pen=true; } return d.trim(); };
  const gcol=econGoodColor(good), sysLbl=sysArr?((ECON.worlds()[sysId]||{}).label||sysId):'';
  let h=`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" style="display:block;background:var(--bg0);border-radius:4px">`;
  h+=`<path d="${pathOf(avg)}" fill="none" stroke="#9fb0c8" stroke-width="${sysArr?1:1.4}"${sysArr?' stroke-dasharray="3,2"':''}/>`;
  if(sysArr) h+=`<path d="${pathOf(sysArr)}" fill="none" stroke="${gcol}" stroke-width="1.6" stroke-linejoin="round"/>`;
  h+=`</svg>`;
  h+=`<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--tx1);margin-top:1px"><span>wk ${ph.wk[0]}</span><span>Cr ${Math.round(mn)}–${Math.round(mx)}/kt</span><span>wk ${ph.wk[N-1]}</span></div>`;
  h+=`<div style="font-size:9px;color:var(--tx1);margin-top:2px"><span style="color:#9fb0c8">▬ galactic avg</span>${sysArr?` · <span style="color:${gcol}">▬ ${escQH(sysLbl)}</span>`:''}</div>`;
  return h;
}
const ECON_WATCH = ['erebus','profit-margin','graveyard','kronos','the-anvil','castor','cypress','the-garden','bastion','sol','aurelia','vesta','avalon','warehouse'];
function econToggleTrader(id){ econTraderSel = (econTraderSel===id)?null:id; window.econTraderSel = econTraderSel;   // drawTrade highlights this convoy's route on the map
  econCorpSel = null; window.econCorpSel = null;                                  // single-ship pick clears any house highlight (mutually exclusive)
  renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh(); }
// Click a corporation → highlight ALL its convoys on the map (every agent with backing===id) and
// expand its detail (net-worth P&L + fleet roster). Mirrors econToggleTrader; the two highlight
// modes are mutually exclusive so the map only ever shows one selection.
function econToggleCorp(id){ econCorpSel = (econCorpSel===id)?null:id; window.econCorpSel = econCorpSel;
  econTraderSel = null; window.econTraderSel = null;
  renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh(); }
function econMoney(n){ n=Math.round(n||0); const s=n<0?'−':''; const a=Math.abs(n); return s+(a>=1000?'Cr'+(a/1000).toFixed(a>=10000?0:1).replace(/\.0$/,'')+'k':'Cr'+a); }
// Tiny SVG P&L sparkline from a trader's weekly capital samples (a dashed zero-line when it dips below 0).
function econSparkline(capHist, w, h){
  const pts=(capHist||[]).filter(p=>p&&isFinite(p.cap));
  if(pts.length<2) return `<div style="font-size:10px;color:var(--tx1)">Not enough history yet — step the sim.</div>`;
  const caps=pts.map(p=>p.cap), min=Math.min(...caps,0), max=Math.max(...caps,1), range=(max-min)||1;
  const X=i=>4+(i/(pts.length-1))*(w-8), Y=c=>h-4-((c-min)/range)*(h-8);
  const path=pts.map((p,i)=>`${i?'L':'M'}${X(i).toFixed(1)},${Y(p.cap).toFixed(1)}`).join(' ');
  const up=caps[caps.length-1]>=caps[0], col=up?'#7ec98f':'#e8a0a0', zeroY=(min<0&&max>0)?Y(0):null;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" style="display:block">`+
    (zeroY!=null?`<line x1="0" y1="${zeroY.toFixed(1)}" x2="${w}" y2="${zeroY.toFixed(1)}" stroke="#6a2a2a" stroke-width="0.6" stroke-dasharray="3,3"/>`:'')+
    `<path d="${path}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}
// Expanded detail for one trader — ship stat block + P&L sparkline + recent-trips ledger.
function econTraderDetailHTML(a){
  const sh=ECON.shipOf(a), wl=ECON.worlds();
  let h=`<div style="background:var(--bg0);border:1px solid var(--bd0);border-radius:6px;padding:7px 8px;margin:1px 0 6px">`;
  h+=`<div style="font-size:10px;color:var(--tx1);margin-bottom:5px">🚀 <b style="color:var(--tx0)">${escQH(sh.name)}</b> · ${sh.tons}t hull · Jump-${sh.jump} · ${sh.cargoT}t hold (${sh.haul}kt/run)</div>`;
  h+=`<div style="font-size:10px;color:var(--tx1);margin-bottom:2px">Capital · last ${(a.capHist||[]).length} wks · now <b style="color:${a.cap>=0?'#7ec98f':'#e8a0a0'}">${econMoney(a.cap)}</b></div>`;
  h+=econSparkline(a.capHist,280,46);
  { const ch=(a.capHist||[]).filter(p=>p&&p.wk!=null); if(ch.length>=2)
    h+=`<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--tx1);margin-top:1px"><span>wk ${ch[0].wk}</span><span>${ch.length} wks</span><span>wk ${ch[ch.length-1].wk}</span></div>`; }
  h+=`<div style="font-size:10px;color:var(--tx1);margin:6px 0 2px">Recent trips</div>`;
  if(!(a.hist||[]).length) h+=`<div style="font-size:10px;color:var(--tx1)">No completed trips yet.</div>`;
  else a.hist.slice(0,8).forEach(t=>{ const pc=t.profit>=0?'#7ec98f':'#e8a0a0';
    h+=`<div style="font-size:10px;color:#cdd6e0;display:flex;justify-content:space-between;gap:8px"><span>wk${t.wk} · ${t.qty}kt ${t.good.replace('Common ','')} ${escQH((wl[t.from]||{}).label||t.from)}→${escQH((wl[t.to]||{}).label||t.to)}</span><span style="color:${pc};white-space:nowrap">${econMoney(t.profit)}</span></div>`; });
  h+=`</div>`;
  return h;
}
// Expanded detail for one corporation — identity, net-worth P&L (treasury + fleet), fleet roster &
// world expansions. Net worth is the house's true P&L: the treasury sweeps each ship's surplus weekly
// (so a single hull's capital sits near the float) — the wealth lives in the pooled treasury + fleet.
function econCorpDetailHTML(c){
  const wl=ECON.worlds(), st=ECON.state, nowT=st.week+(window.econViewFrac||0);
  const ships=ECON.agents().filter(a=>a.backing===c.id);
  const fleetCap=ships.reduce((s,a)=>s+(a.cap||0),0), net=(c.treasury||0)+fleetCap;
  const gcol=(typeof econGoodColor==='function')?econGoodColor(c.specialty):'#9fb0c8', spec=(''+c.specialty).replace('Common ','');
  let h=`<div style="background:var(--bg0);border:1px solid var(--bd0);border-radius:6px;padding:7px 8px;margin:1px 0 6px">`;
  h+=`<div style="font-size:10px;color:var(--tx1);margin-bottom:5px">🏢 <b style="color:var(--tx0)">${escQH(c.name)}</b>${c.megacorp?' <span style="color:#9fd0ff" title="Megacorp — safeguarded">★</span>':''} · <span style="color:${gcol}">◆ ${escQH(spec)}</span>${c.home&&wl[c.home]?` · ${escQH(wl[c.home].label)}`:''}</div>`;
  h+=`<div style="font-size:10px;color:var(--tx1);margin-bottom:2px">Net worth (treasury + fleet) · last ${(c.capHist||[]).length} wks · now <b style="color:${net>=0?'#7ec98f':'#e8a0a0'}">${econMoney(net)}</b></div>`;
  h+=econSparkline(c.capHist,280,46);
  { const ch=(c.capHist||[]).filter(p=>p&&p.wk!=null); if(ch.length>=2)
    h+=`<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--tx1);margin-top:1px"><span>wk ${ch[0].wk}</span><span>treasury ${econMoney(c.treasury)} · fleet ${econMoney(fleetCap)}</span><span>wk ${ch[ch.length-1].wk}</span></div>`; }
  h+=`<div style="font-size:10px;color:var(--tx1);margin:6px 0 2px">Fleet · ${ships.length} ship${ships.length===1?'':'s'}</div>`;
  if(!ships.length) h+=`<div style="font-size:10px;color:var(--tx1)">No active ships.</div>`;
  else ships.forEach(a=>{
    const onRoute=a.route&&wl[a.route.from]&&wl[a.route.to], berthing=onRoute&&a.route.began!=null&&nowT<a.route.began;
    const rt = berthing ? `<span style="color:#e0b24a">⚓ loading at ${escQH(wl[a.route.from].label)}</span>`
             : onRoute ? `<span style="color:#7ec0e0">${a.route.good.replace('Common ','')} ${escQH(wl[a.route.from].label)}→${escQH(wl[a.route.to].label)}</span>`
                       : `<span style="color:var(--tx1)">surveying</span>`;
    h+=`<div style="font-size:10px;color:#cdd6e0;display:flex;justify-content:space-between;gap:8px"><span>${escQH(a.name)} · ${rt}</span><span style="color:${a.cap>=0?'#cdd6e0':'#e8a0a0'};white-space:nowrap">${econMoney(a.cap)}</span></div>`;
  });
  const inv=c.invests||[];
  if(inv.length){ const by={}; inv.forEach(iv=>{ by[iv.world]=(by[iv.world]||0)+1; });
    const parts=Object.keys(by).map(wid=>`${escQH((wl[wid]||{}).label||wid)}${by[wid]>1?' ×'+by[wid]:''}`).join(' · ');
    h+=`<div style="font-size:10px;color:var(--tx1);margin:6px 0 0">Expansions · ${escQH(spec)} — ${parts}</div>`; }
  // Rivalry — the house's natural competitor + any live black-job contracts it's running or fending off.
  { const corps=ECON.corps(), others=Object.values(corps).filter(x=>!x.defunct&&x.id!==c.id);
    const same=others.filter(x=>x.specialty===c.specialty).sort((a,b)=>(''+a.name).localeCompare(b.name));
    const rival = same[0] || others.find(x=>x.megacorp) || others.slice().sort((a,b)=>(''+a.name).localeCompare(b.name))[0] || null;
    const evs=ECON.corpEvents(), bj=e=>e.type==='sabotage'||e.type==='espionage';
    const offensive=evs.filter(e=>bj(e)&&e.corp===c.id), defensive=evs.filter(e=>bj(e)&&e.target===c.id);
    if(rival||offensive.length||defensive.length){
      h+=`<div style="font-size:10px;color:var(--tx1);margin:6px 0 2px">Rivalry${rival?` · chief rival <span style="color:${rival.color||'#e8a0a0'}">${escQH(rival.name)}</span>`:''}</div>`;
      offensive.forEach(e=>{ const t=corps[e.target]; h+=`<div style="font-size:10px;color:#e0b24a">⚔ running a ${e.type} job vs ${escQH((t&&t.name)||e.targetName||'a rival')}</div>`; });
      defensive.forEach(e=>{ const o=corps[e.corp]; h+=`<div style="font-size:10px;color:#e8a0a0">🛡 targeted by ${escQH((o&&o.name)||'a rival')}'s ${e.type}</div>`; });
    }
  }
  // Party stake — REFEREE LEDGER ONLY (no automated trading): records what share of the house the
  // party owns, so the net-worth graph above doubles as their portfolio value. Adjust at the table.
  { const sh=c.playerShares||0, portfolio=Math.round(net*sh/100);
    const bs='background:var(--bg0);border:1px solid var(--bd0);color:var(--tx0);border-radius:5px;padding:0 7px;font-size:11px;cursor:pointer';
    h+=`<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:10px;color:var(--tx1);margin:7px 0 0;border-top:1px dashed var(--bd0);padding-top:6px">`;
    h+=`<span>Party stake <b style="color:${sh>0?'#7ec98f':'var(--tx1)'}">${sh}%</b>${sh>0?` · portfolio <b style="color:#7ec98f">${econMoney(portfolio)}</b>`:''}</span>`;
    h+=`<span style="margin-left:auto;display:inline-flex;gap:4px"><button title="Sell 5%" style="${bs}" onclick="event.stopPropagation();econBumpCorpShares('${c.id}',-5)">–</button><button title="Buy 5%" style="${bs}" onclick="event.stopPropagation();econBumpCorpShares('${c.id}',5)">+</button></span></div>`; }
  h+=`</div>`;
  return h;
}

function toggleEconPanel(){
  if(typeof isReferee==='function' && !isReferee()){ if(typeof showToast==='function') showToast('Referee only','error'); return; }
  econPanelOpen = !econPanelOpen;
  const w=document.getElementById('econ-wrap'), b=document.getElementById('econ-btn');
  if(w) w.classList.toggle('hidden', !econPanelOpen);
  if(b) b.classList.toggle('panel-open', econPanelOpen);
  if(econPanelOpen){ renderEconPanel(); econInitDrag(); }
}
function toggleEconCollapse(){
  if(window.econDidDrag){ window.econDidDrag=false; return; }   // a drag just ended on the header — don't also collapse
  econCollapsed=!econCollapsed;
  const t=document.getElementById('econ-toggle'); if(t) t.textContent=econCollapsed?'▲':'▼';
  const b=document.getElementById('econ-body'); if(b) b.classList.toggle('hidden', econCollapsed);
}
// Drag the market panel by its header (and remember where you put it). A genuine drag
// suppresses the header's collapse-toggle; a plain click still collapses.
function econInitDrag(){
  const wrap=document.getElementById('econ-wrap'), head=document.getElementById('econ-header');
  if(!wrap||!head||head._dragBound) return; head._dragBound=true;
  try{ const p=JSON.parse(localStorage.getItem('econ-pos')||'null'); if(p&&p.left!=null){ wrap.style.left=p.left+'px'; wrap.style.top=p.top+'px'; wrap.style.right='auto'; } }catch(e){}
  let sx,sy,ox,oy,dragging=false,moved=false;
  const pt=e=>e.touches?e.touches[0]:e;
  const move=e=>{ if(!dragging) return; const ev=pt(e), dx=ev.clientX-sx, dy=ev.clientY-sy;
    if(moved || Math.abs(dx)+Math.abs(dy)>4){ moved=true; window.econDidDrag=true; if(e.cancelable) e.preventDefault();
      const w=wrap.offsetWidth;
      let nl=Math.max(40-w, Math.min(window.innerWidth-40, ox+dx));
      let nt=Math.max(0,  Math.min(window.innerHeight-40, oy+dy));
      wrap.style.left=nl+'px'; wrap.style.top=nt+'px'; wrap.style.right='auto'; } };
  const up=()=>{ dragging=false;
    document.removeEventListener('mousemove',move); document.removeEventListener('mouseup',up);
    document.removeEventListener('touchmove',move); document.removeEventListener('touchend',up);
    if(moved){ try{ const r=wrap.getBoundingClientRect(); localStorage.setItem('econ-pos',JSON.stringify({left:Math.round(r.left),top:Math.round(r.top)})); }catch(e){} } };
  const down=e=>{ const ev=pt(e); sx=ev.clientX; sy=ev.clientY; const r=wrap.getBoundingClientRect(); ox=r.left; oy=r.top; dragging=true; moved=false;
    document.addEventListener('mousemove',move); document.addEventListener('mouseup',up);
    document.addEventListener('touchmove',move,{passive:false}); document.addEventListener('touchend',up); };
  head.addEventListener('mousedown',down); head.addEventListener('touchstart',down,{passive:true});
}
// Severity 1..5 → shock factor: "cut" shocks (output/crackdown/tariff) bite harder toward 0;
// "spike" shocks (demand) climb higher. block/embargo carry no factor — duration only.
const SHOCK_SEV_LBL = ['Mild','Moderate','Serious','Severe','Crippling'];
const SHOCK_CUT = [0.7,0.5,0.3,0.15,0.05], SHOCK_SPIKE = [1.5,2.5,3.5,5,7];
function econFireById(id){
  const p=ECON.PRESETS.find(x=>x.id===id); if(!p) return;
  const wEl=document.getElementById('econ-shock-weeks');
  const weeks = wEl ? Math.max(1,Math.min(104,Math.round(+wEl.value)||p.weeks||6)) : (p.weeks||6);
  const sev = Math.max(1,Math.min(5,econShockCfg.severity||3));
  econShockCfg.weeks = weeks; econShockCfg.severity = sev;
  const s = Object.assign({}, p, { weeks });
  if(p.factor!=null) s.factor = (p.kind==='demand') ? SHOCK_SPIKE[sev-1] : SHOCK_CUT[sev-1];
  ECON.fire(s);
  renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh();
}
function econStep(n){ window.econViewFrac=0; ECON.advance(n); renderEconPanel(); if(typeof galnetRefresh==='function') galnetRefresh(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh(); }
// +1 day: a sub-week render clock so convoys crawl hop-by-hop along their jump-lane path
// (lets you watch ships actually follow lanes). Rolls into a real weekly step every 7 days.
window.econViewFrac = 0;
function econDayStep(){
  window.econViewFrac = (window.econViewFrac||0) + 1/7;
  if(window.econViewFrac >= 1 - 1e-9){ window.econViewFrac = 0; ECON.advance(1); }
  renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh();
}
function econToggleActive(){ ECON.setActive(!ECON.active()); renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh(); }
function econReset(){ if(confirm('Reset the economy to seeded starting stocks?')){ ECON.reset(); renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh(); } }
function econCancelShock(i){ ECON.cancel(i); renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh(); }
function econApplyRun(){
  econRunSel = {
    from: document.getElementById('econ-run-from').value,
    good: document.getElementById('econ-run-good').value,
    to:   document.getElementById('econ-run-to').value,
    tons: document.getElementById('econ-run-tons').value
  };
  const r = ECON.applyRun(econRunSel.from, econRunSel.good, econRunSel.to, econRunSel.tons);
  if(typeof showToast==='function'){
    if(r && r.ok){ const m = r.moves.map(x=>`${x.label} ${x.dir}`).join(' · '); showToast('Cargo run applied' + (m?' — '+m:' (no effect)')); }
    else showToast((r&&r.msg)||'Run failed','error');
  }
  renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh();
}
function econToggleTraders(){ ECON.setTraders(!ECON.tradersOn()); renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh(); }
// The event director: when ON, an untouched galaxy fires its OWN emergent shocks (spreading unrest,
// monopoly backlash, boomtown crime, ambient strikes/raids/festivals) — bounded & referee-advanced.
function econToggleDirector(){ ECON.setDirector(!ECON.directorOn()); renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh(); }
// Opt-in monopoly pricing: lets a house dominating its specialty good raise that good's price galaxy-wide
// (bounded, full-sim only). OFF by default so it never silently shifts a tuned economy.
function econToggleMonopoly(){ ECON.setMonopoly(!ECON.monopolyOn()); renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh(); }
function econBumpCorpShares(id, d){ if(typeof ECON==='undefined') return; const c=ECON.corps()[id]; if(!c) return; ECON.setCorpShares(id, (c.playerShares||0)+d); renderEconPanel(); }
function econRaidConvoy(id){
  const r = ECON.raidConvoy(id);
  if(typeof showToast==='function'){
    if(r&&r.ok) showToast(`⚔ Convoy raided — ${r.agent} lost ${r.qty}kt ${r.good.replace('Common ','')} bound for ${r.to}`,'error');
    else showToast((r&&r.msg)||'No convoy','error');
  }
  renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh();
}
// ── Contracts (corp + faction): draft a flagged opportunity, then post it to the Quest Log / Library ──
function econClearDraftedEvent(){ if(!econDraftSel) return;   // remove the source event once posted (routes corp vs faction)
  if(econDraftSel.src==='faction') ECON.clearFactionEvent(econDraftSel.i); else ECON.clearCorpEvent(econDraftSel.i); }
function econDraftContract(i){
  const ev = ECON.corpEvents()[i]; if(!ev) return;
  const item = ECON.contractItem(ev); if(!item || typeof draftCorpContract!=='function') return;
  econDraftSel = { i, src:'corp', item, contract: draftCorpContract(item) };
  renderEconPanel();
}
function econDraftFactionContract(i){
  const ev = ECON.factionEvents()[i]; if(!ev) return;
  const item = ECON.factionContractItem(ev); if(!item || typeof draftCorpContract!=='function') return;
  econDraftSel = { i, src:'faction', item, contract: draftCorpContract(item) };
  renderEconPanel();
}
function econRerollContract(){ if(econDraftSel && typeof draftCorpContract==='function'){ econDraftSel.contract = draftCorpContract(econDraftSel.item); renderEconPanel(); } }
function econContractNote(msg){ const n=document.getElementById('econ-contract-note'); if(n){ n.textContent=msg; } }
// Close the loop: note the issuer of the drafted contract as a patron in a player's private Standing.
function econNoteContractPatron(){
  if(!econDraftSel || typeof standingBeginNote!=='function') return;
  const it=econDraftSel.item||{}, org=it.faction||it.corp||it.label, label=it.label||org;
  const title=(econDraftSel.contract&&econDraftSel.contract.title)||(it.contract+' contract');
  standingBeginNote(org, label, 'Patron — hired the crew: '+title);
}
function econContractToQuest(){
  if(!econDraftSel) return;
  const ok = (typeof spawnContractQuest==='function') && spawnContractQuest(econDraftSel.contract);
  if(ok){ if(typeof showToast==='function') showToast('📋 Contract posted to the Quest Log','success'); econClearDraftedEvent(); econDraftSel=null; renderEconPanel(); }
  else econContractNote('Quest Log unavailable');
}
function econContractToLibrary(){
  if(!econDraftSel) return;
  const ok = (typeof pushContractToLibrary==='function') && pushContractToLibrary(econDraftSel.contract);
  if(ok){ if(typeof showToast==='function') showToast('📋 Contract leaked to Library Data','success'); econClearDraftedEvent(); econDraftSel=null; renderEconPanel(); }
  else econContractNote('Library Data unavailable');
}
function econDismissContract(i){ ECON.clearCorpEvent(i); if(econDraftSel && econDraftSel.src==='corp' && econDraftSel.i===i) econDraftSel=null; renderEconPanel(); }
function econDismissFactionContract(i){ ECON.clearFactionEvent(i); if(econDraftSel && econDraftSel.src==='faction' && econDraftSel.i===i) econDraftSel=null; renderEconPanel(); }
function econToggleFactions(){ ECON.setFactions(!ECON.factionsOn()); renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh(); }
// ── Pirate band controls (referee) ──
function econTogglePirates(){ ECON.setPirates(!ECON.piratesOn()); renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh(); }
function econSpawnPirate(){ ECON.spawnPirate(); renderEconPanel(); if(typeof galnetRefresh==='function') galnetRefresh(); }
function econDisbandPirate(id){ ECON.disbandPirate(id); renderEconPanel(); if(typeof galnetRefresh==='function') galnetRefresh(); }
function econPirateHull(id,d){ const b=ECON.pirates()[id]; if(!b) return; ECON.setPirateStrength(id,(b.strength||0)+d); renderEconPanel(); if(typeof galnetRefresh==='function') galnetRefresh(); }
function econPirateRaid(id){ const ok=ECON.pirateRaidNow(id);
  if(typeof showToast==='function') showToast(ok?'☠ Raid resolved — a convoy was plundered':'No convoy in reach to raid', ok?'success':'info');
  renderEconPanel(); if(typeof galnetRefresh==='function') galnetRefresh(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh(); }
// Players stormed a band's base: seize the hoard. Credits go to party funds; the stolen goods are
// reported for the referee to hand out as cargo. The band is wiped out.
function econPirateBaseRaid(id){
  const r = ECON.raidPirateBase(id); if(!r || !r.ok){ if(typeof showToast==='function') showToast('No such band','error'); return; }
  if(typeof funds!=='undefined' && r.loot>0){
    if(typeof normalizeFunds==='function') normalizeFunds();
    funds.party = (funds.party||0) + r.loot;
    if(typeof fundsLog==='function') fundsLog('party', r.loot, 'Pirate hoard seized — '+r.name);
    if(typeof saveFunds==='function') saveFunds();
    if(typeof fundsPanelOpen!=='undefined' && fundsPanelOpen && typeof renderFundsPanel==='function') renderFundsPanel();
  }
  const gs=Object.keys(r.hold||{}).filter(g=>r.hold[g]>0.5);
  const goods=gs.map(g=>`${Math.round(r.hold[g])}kt ${g.replace('Common ','')}`).join(', ');
  if(typeof showToast==='function') showToast(`🏴 ${r.name} wiped out — ${econMoney(r.loot)} to party funds${goods?' · seized cargo: '+goods:''}`,'success');
  renderEconPanel(); if(typeof galnetRefresh==='function') galnetRefresh(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh();
}
// Drop a band's rules-legal MgT2e/High Guard hull into the current combat encounter.
function econDeployPirate(id){
  if(typeof combatEncounter==='undefined' || !combatEncounter){ if(typeof showToast==='function') showToast('Start a ⚔ Combat encounter first, then deploy','info'); return; }
  if(typeof addCombatShip!=='function' || typeof makeShipStats!=='function'){ if(typeof showToast==='function') showToast('Combat system unavailable','error'); return; }
  const stats=ECON.pirateCombatStats(id); if(!stats){ if(typeof showToast==='function') showToast('No such band','error'); return; }
  const sid=addCombatShip(makeShipStats(stats), { name:stats.name, side:'hostile', revealed:false });
  if(sid){ if(typeof showToast==='function') showToast('☠ '+stats.name+' entered the engagement'); if(typeof renderCombat==='function') renderCombat(); }
}
function econBumpFactionTreasury(id,d){ const f=ECON.factions()[id]; if(!f) return; ECON.setFactionTreasury(id, Math.max(0,(f.treasury||0)+d)); renderEconPanel(); }

// ── Economy editor (Design Mode · Production & Consumption) ─────────────────
// Edits a world's prod/cons via ECON's profile-override layer, with recipe-aware
// auto-input display, a full upstream chain preview, and a live Market Impact summary.
// Commit re-settles the galactic baseline (ECON.setProfile); Revert drops the override.
const ECON_GOOD_COL = {   // mirrors HX's GOOD_COL so good chips read consistently across the app
  'Common Consumables':'#5fb87a','Common Ore':'#b07a4a','Common Electronics':'#4a90d9',
  'Common Manufactured':'#8a9bb5','Advanced Electronics':'#3fd0d0','Precious Metals':'#e0c040',
  'Radioactives':'#9fd44a','Biochemicals':'#3faf8f','Luxury Goods':'#c060c0','Pharmaceuticals':'#e07090',
  'Refined Fuel':'#3f9d5a','Unrefined Hydrogen':'#caa83b'
};
function econGoodColor(g){ return ECON_GOOD_COL[g] || '#9fb0c8'; }
function econNum(n){ return (Math.round((+n||0)*100)/100).toString(); }

// Production/consumption chip row for a world — the SINGLE source both the galaxy star
// panel and the system-overview panel render from, so the two views always show identical
// numbers (one ECON profile keyed by node id). ▲ = produced (supply), ▼ = consumed (demand).
function econChipsHTML(nodeId){
  if(typeof ECON==='undefined' || !ECON.isMarketId(nodeId)) return '';
  const ep = ECON.effectiveProfile(nodeId); let chips='';
  Object.keys(ep.prod).forEach(g=> chips+=`<span class="hx-tag" style="border-color:${econGoodColor(g)};color:${econGoodColor(g)}">▲ ${escQH(g)} ${econNum(ep.prod[g])}</span>`);
  Object.keys(ep.cons).forEach(g=> chips+=`<span class="hx-tag" style="border-color:${econGoodColor(g)};color:${econGoodColor(g)}">▼ ${escQH(g)} ${econNum(ep.cons[g])}</span>`);
  return chips;
}
// Design-Mode "Production & Consumption" section for the SYSTEM overview panel. Mirrors the
// galaxy star panel's section (same data via econChipsHTML, same editor via openEconEditor),
// styled with this panel's .s-sec classes. nodeId = SYSTEMS[sysId].galaxyId (the ECON key).
function econSystemSectionHTML(nodeId){
  if(typeof ECON==='undefined' || !nodeId || !(designModeOn && isReferee())) return '';
  let h = `<div class="s-sec ref-only"><div class="s-sec-lbl" style="color:#9B59B6">Production &amp; Consumption</div>`;
  if(!ECON.isMarketId(nodeId)){
    return h + `<div style="font-size:11px;color:var(--tx1)">No open market in this system — nothing to configure.</div></div>`;
  }
  const ep = ECON.effectiveProfile(nodeId), chips = econChipsHTML(nodeId);
  h += chips ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">${chips}</div>`
             : `<div style="font-size:11px;color:var(--tx1);margin-bottom:8px">No production or consumption configured.</div>`;
  if(ep.overridden) h += `<div style="font-size:11px;color:#C98BE8;margin:-2px 0 8px">✎ Custom economy — overrides the built-in profile.</div>`;
  h += `<button class="design-add-btn" style="width:100%" onclick="openEconEditor('${nodeId}')">⚒ Edit production &amp; consumption</button>`;
  h += econPriceControlHTML(nodeId);
  h += `</div>`;
  return h;
}

// ── Ref-only: trade ships docked in the viewed system (TASK 4) ───────────────
// Lists, for the referee only, the NPC traders physically at this world's port —
// idle after a run, or berthed/loading before departure (route not yet begun) —
// with name, ship class, backing, route-if-known, and fuel state (populated once
// TASK 5 lands; degrades to nothing until then). Reads the SAME shared econ-state
// (ECON.agents) every client already syncs, so it surfaces nothing to players
// beyond what the public economy already carries. Returns '' for players and for
// a system with no economy node, so no trader markup ever enters a player's DOM.
function dockedTradersSectionHTML(nodeId){
  if(typeof ECON==='undefined' || !nodeId || typeof isReferee!=='function' || !isReferee()) return '';
  let agents;
  try { agents = ECON.agents() || []; } catch(e){ return ''; }
  const esc = (s)=>String(s==null?'':s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const week = (function(){ try { return ECON.state.week||0; } catch(e){ return 0; } })();
  const worlds = (function(){ try { return ECON.worlds()||{}; } catch(e){ return {}; } })();
  const nameOf = (id)=> (worlds[id] && (worlds[id].label||worlds[id].name)) || id;
  // Docked = at this node AND not yet flying (no route, or still berthed/loading).
  const isDocked = (a)=> a && a.pos===nodeId && (!a.route || (a.route.began!=null && a.route.began>week));
  const docked  = agents.filter(isDocked);
  const inbound = agents.filter(a => a && a.route && a.route.to===nodeId && !isDocked(a)).length;
  const backLabel = (a)=>{
    const b = a && a.backing;
    if(!b || b==='private') return 'Independent';
    if(typeof ECON.isCorp==='function' && ECON.isCorp(b)){ const c=(ECON.corps()||{})[b]; return (c&&c.name)||'Corporate'; }
    return b.charAt(0).toUpperCase()+b.slice(1);
  };
  let h = `<div class="s-sec ref-only"><div class="s-sec-lbl" style="color:#5f87c9">🚢 Docked Traders <span style="color:var(--tx1);font-weight:400">· referee</span></div>`;
  // Berth line: the body flagged "Traders dock here" (tradersDock — set in the
  // body editor / REAL-map datacard). That's where the REAL map parks these
  // ships; unflagged systems berth at the star, so nothing is shown.
  try {
    const nd = (typeof GX_MAP!=='undefined' && GX_MAP[nodeId]) || null;
    const sysId = (nd && nd.systemId) || nodeId;
    const db = (typeof effectiveBodies==='function' ? effectiveBodies(sysId) : []).find(b => b.tradersDock && !b.isStar);
    if(db) h += `<div style="font-size:11px;color:#f4d35e;margin-bottom:4px">⚓ Berth: <b>${esc(db.name)}</b></div>`;
  } catch(e){}
  if(!docked.length){
    h += `<div style="font-size:11px;color:var(--tx1)">No traders docked here${inbound?` · <b style="color:var(--tx0)">${inbound}</b> inbound`:''}.</div>`;
  } else {
    h += docked.map(a=>{
      const sc = (ECON.shipOf&&ECON.shipOf(a))||{}, cls = sc.name||'Trader';
      const route = (a.route && a.route.to) ? `⏳ loading → <b style="color:var(--tx0)">${esc(nameOf(a.route.to))}</b>`
                  : (a.hist && a.hist[0] && a.hist[0].from) ? `arrived from ${esc(nameOf(a.hist[0].from))}` : 'idle';
      // Fuel readout (TASK 5). Falls back to the ship class's tank so it shows even
      // for agents not yet stepped; ⚠ when a fuel-starved berth is holding it dry.
      const fMax = (a.fuelMax!=null) ? a.fuelMax : (sc.fuelMax!=null ? sc.fuelMax : null);
      const fCur = (a.fuel!=null) ? a.fuel : fMax;
      const fuelStr = (fMax!=null)
        ? `<span style="color:${(a.fuelWait || (fCur < fMax*0.15)) ? '#e8a0a0':'#7ec98f'}">⛽ ${Math.round(fCur)}/${Math.round(fMax)}t${a.fuelWait?' · <b style="color:#e8a0a0">⚠ awaiting fuel</b>':''}</span>`
        : '';
      return `<div style="padding:5px 0;border-top:1px solid var(--bd0)">
        <div style="font-size:12px"><b>${esc(a.name||'Trader')}</b> <span style="color:var(--tx1)">· ${esc(cls)}</span></div>
        <div style="font-size:11px;color:var(--tx1)">${esc(backLabel(a))} · ${route}${fuelStr?` · ${fuelStr}`:''}</div>
      </div>`;
    }).join('');
    if(inbound) h += `<div style="font-size:11px;color:var(--tx1);margin-top:5px">+ <b style="color:var(--tx0)">${inbound}</b> inbound</div>`;
  }
  h += `</div>`;
  return h;
}

// ── Referee manual price lever (raise/lower a whole world's prices) ───────────
// Shared by the galaxy star panel, the system-overview panel, and the economy editor.
// Each press = ±1 notch (±8%); works in Simple AND Full mode and survives reset.
function econPriceControlHTML(nodeId, compact){
  if(typeof ECON==='undefined' || !ECON.isMarketId || !ECON.isMarketId(nodeId)) return '';
  const notch=ECON.worldPriceAdj(nodeId), pct=Math.round((Math.pow(1.08,notch)-1)*100);
  const lbl = notch===0 ? 'at par' : (notch>0?`▲ +${pct}% dearer`:`▼ ${pct}% cheaper`);
  const col = notch>0?'#e8a0a0':(notch<0?'#7ec98f':'var(--tx1)');
  const bs='background:var(--bg0);border:1px solid var(--bd0);color:var(--tx0);border-radius:5px;padding:2px 9px;font-size:12px;cursor:pointer';
  return `<div style="margin-top:8px">`+
    `<div style="font-size:11px;color:var(--tx1);margin-bottom:3px">Market prices <span style="color:${col}">· ${lbl}${notch?` (${notch>0?'+':''}${notch})`:''}</span></div>`+
    `<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">`+
      `<button title="Lower all prices here" style="${bs}" onclick="econBumpPrice('${nodeId}',-1)">– cheaper</button>`+
      `<button title="Raise all prices here" style="${bs}" onclick="econBumpPrice('${nodeId}',1)">+ dearer</button>`+
      (notch!==0?`<button title="Back to par" style="${bs};border-color:#6a2a2a;color:#e8a0a0" onclick="econResetPrice('${nodeId}')">reset</button>`:'')+
    `</div>`+
    (compact?'':`<div style="font-size:10px;color:var(--tx1);margin-top:3px">Nudges every good's buy &amp; sell price here (Simple &amp; Full mode). Per-good control is in the economy editor.</div>`)+
  `</div>`;
}
function econRerenderPriceUI(nodeId){
  try { if(econEditNodeId===nodeId){ const m=document.getElementById('econ-editor-modal'); if(m&&m.classList.contains('open')) renderEconEditor(); } } catch(e){}
  try { if(currentView==='galaxy' && typeof HX!=='undefined') HX.refresh(); } catch(e){}
  try { const el=document.getElementById('sys-econ-section'); if(el) el.innerHTML=econSystemSectionHTML(nodeId); } catch(e){}
  try { if(typeof econPanelOpen!=='undefined' && econPanelOpen) renderEconPanel(); } catch(e){}
}
function econBumpPrice(nodeId, d){ if(typeof ECON==='undefined') return; ECON.setWorldPriceAdj(nodeId, ECON.worldPriceAdj(nodeId)+d); econRerenderPriceUI(nodeId); }
function econResetPrice(nodeId){ if(typeof ECON==='undefined') return; ECON.setWorldPriceAdj(nodeId, 0); econRerenderPriceUI(nodeId); }   // clears the world-wide nudge (per-good tweaks kept)
function econBumpGoodPrice(nodeId, good, d){ if(typeof ECON==='undefined') return; ECON.setGoodPriceAdj(nodeId, good, ECON.goodPriceAdj(nodeId,good)+d);
  renderEconEditor(); try{ if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh(); }catch(e){} }
function econSetTraderCap(v){ if(typeof ECON==='undefined') return; ECON.setTraderCap(v); renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh(); }

let econEditNodeId = null;        // node id being edited
let econEditDraft  = null;        // { prod:[{good,rate}], cons:[{good,rate}] } working copy
let econPicker     = null;        // { list:'prod'|'cons' } while the add-good selector is open

function openEconEditor(nodeId){
  if(typeof isReferee==='function' && !isReferee()){ if(typeof showToast==='function') showToast('Referee only','error'); return; }
  if(typeof ECON==='undefined' || !ECON.isMarketId(nodeId)){ if(typeof showToast==='function') showToast('This world keeps no market','error'); return; }
  econEditNodeId = nodeId; econPicker = null;
  const p = ECON.effectiveProfile(nodeId);
  const toRows = m => Object.keys(m||{}).map(g=>({ good:g, rate:m[g] }));
  econEditDraft = { prod: toRows(p.prod), cons: toRows(p.cons) };
  const modal = document.getElementById('econ-editor-modal'); if(modal) modal.classList.add('open');
  renderEconEditor();
  setTimeout(()=>{ const b=document.getElementById('econ-editor-body'); if(b) b.scrollTop=0; }, 0);
}
function closeEconEditor(){
  econEditNodeId = null; econEditDraft = null; econPicker = null;
  const modal = document.getElementById('econ-editor-modal'); if(modal) modal.classList.remove('open');
}
function econDraftMaps(){   // draft arrays → {good:rate} maps (only valid, positive rows)
  const toMap = arr => { const m={}; (arr||[]).forEach(r=>{ if(r.good && +r.rate>0) m[r.good]=+r.rate; }); return m; };
  return { prod: toMap(econEditDraft.prod), cons: toMap(econEditDraft.cons) };
}
function econDraftValid(){
  const seen = l => { const s=new Set(); return econEditDraft[l].every(r=>{ if(!r.good||!(+r.rate>0)||s.has(r.good)) return false; s.add(r.good); return true; }); };
  return seen('prod') && seen('cons');
}

// One editable good row (Produces / manual Consumes). Rate edits don't rebuild the row
// (focus is preserved) — they refresh only the derived panels via renderEconDerived().
function econRowHtml(list, idx, r){
  const col = econGoodColor(r.good), tier = (ECON.GOODS[r.good]||{}).tier;
  const bad = !(+r.rate>0);
  return `<div class="econ-ed-row${bad?' warn':''}">`+
    `<span class="econ-ed-good"><span class="econ-ed-dot" style="background:${col}"></span>`+
      `<span class="econ-ed-gname">${escQH(r.good)}</span><span class="econ-ed-tier">T${tier}</span></span>`+
    `<input class="econ-ed-rate" type="number" min="0" step="1" value="${escQH(econNum(r.rate))}" `+
      `aria-label="${escQH(r.good)} rate, kilotonnes per week" `+
      `oninput="econSetRate('${list}',${idx},this.value)">`+
    `<button class="econ-ed-del" title="Remove ${escQH(r.good)}" aria-label="Remove ${escQH(r.good)}" onclick="econRemoveRow('${list}',${idx})">✕</button>`+
  `</div>`;
}
function econRowsHtml(list){
  const rows = econEditDraft[list];
  if(!rows.length) return `<div class="econ-ed-empty">None ${list==='prod'?'produced':'consumed as final demand'} here.</div>`;
  return rows.map((r,i)=>econRowHtml(list,i,r)).join('');
}
// The add-good selector: searchable, icon-labelled, goods already in this list disabled.
function econPickerHtml(){
  if(!econPicker) return '';
  const list = econPicker.list, used = new Set(econEditDraft[list].map(r=>r.good));
  const goods = ECON.SIM_GOODS;
  return `<div class="econ-ed-picker">`+
    `<input class="econ-ed-search" id="econ-pick-search" placeholder="Search goods…" `+
      `aria-label="Search goods" oninput="renderEconPicker()" onkeydown="if(event.key==='Escape'){econPicker=null;renderEconEditor();}">`+
    `<div class="econ-ed-list" id="econ-pick-list">${econPickerListHtml('')}</div></div>`;
}
function econPickerListHtml(q){
  const list = econPicker.list, used = new Set(econEditDraft[list].map(r=>r.good));
  q = (q||'').toLowerCase();
  const goods = ECON.SIM_GOODS.filter(g=>g.toLowerCase().includes(q));
  if(!goods.length) return `<div class="econ-ed-empty" style="padding:8px 9px">No goods match “${escQH(q)}”.</div>`;
  return goods.map((g,gi)=>{ const i=ECON.SIM_GOODS.indexOf(g), col=econGoodColor(g), tier=(ECON.GOODS[g]||{}).tier, dis=used.has(g);
    return `<button class="econ-ed-opt" ${dis?'disabled':''} onclick="econPick(${i})">`+
      `<span class="econ-ed-dot" style="background:${col}"></span><span style="flex:1">${escQH(g)}</span>`+
      `<span class="econ-ed-tier">T${tier}${dis?' · added':''}</span></button>`; }).join('');
}
function renderEconPicker(){ const el=document.getElementById('econ-pick-list'), s=document.getElementById('econ-pick-search');
  if(el) el.innerHTML = econPickerListHtml(s?s.value:''); }
function econOpenPicker(list){ econPicker={list}; renderEconEditor(); setTimeout(()=>{ const s=document.getElementById('econ-pick-search'); if(s) s.focus(); },0); }
function econPick(goodIdx){ if(!econPicker) return; const good=ECON.SIM_GOODS[goodIdx]; if(!good) return;
  const list=econPicker.list; if(econEditDraft[list].some(r=>r.good===good)){ econPicker=null; renderEconEditor(); return; }
  const dflt = list==='prod' ? 10 : 5;
  econEditDraft[list].push({ good, rate:dflt }); econPicker=null; renderEconEditor(); }
function econRemoveRow(list,idx){ econEditDraft[list].splice(idx,1); renderEconEditor(); }
function econSetRate(list,idx,val){ if(econEditDraft[list][idx]){ econEditDraft[list][idx].rate = val===''?0:+val; }
  // mark the row valid/invalid without rebuilding it (keeps input focus), then refresh derived panels
  const rows=document.getElementById(list==='prod'?'econ-prod-rows':'econ-cons-rows');
  if(rows && rows.children[idx]) rows.children[idx].classList.toggle('warn', !(+val>0));
  renderEconDerived(); }
// "Produce locally" — promote an auto-imported recipe input into a locally produced good.
function econProduceLocally(goodIdx){ const good=ECON.SIM_GOODS[goodIdx]; if(!good) return;
  if(!econEditDraft.prod.some(r=>r.good===good)){
    const auto = ECON.autoInputsOf(econDraftMaps().prod);
    econEditDraft.prod.push({ good, rate: Math.max(1, Math.round(auto[good]||1)) }); }
  renderEconEditor(); }

function econChainTreeHtml(node, depth){
  const pad = depth>0 ? '&nbsp;'.repeat((depth-1)*3)+'└─ ' : '';
  const cls = node.cycle ? 'cyc' : (node.raw ? 'raw' : 'g');
  let h = `<div>${pad}<span class="${cls}">${node.cycle?'⟲ ':''}${escQH(node.good)}</span> <span class="q">×${econNum(node.rate)}</span>`+
    `${node.raw&&!node.cycle?' <span style="opacity:.55">(raw)</span>':''}${node.cycle?' <span class="cyc">circular — not expanded</span>':''}</div>`;
  (node.inputs||[]).forEach(c=> h += econChainTreeHtml(c, depth+1));
  return h;
}

// Derived panels — recomputed live as rates change: auto-imported inputs, the full chain
// preview, the Market Impact summary, the cycle warning, and the Save button's enabled state.
function renderEconDerived(){
  if(!econEditDraft) return;
  const maps = econDraftMaps(), prodMap = maps.prod;
  const auto = ECON.autoInputsOf(prodMap);
  const prodGoods = new Set(econEditDraft.prod.map(r=>r.good));

  // Auto-imported recipe inputs (shown, never written to cons). Hidden when produced locally.
  const autoEl = document.getElementById('econ-auto-rows');
  if(autoEl){ const keys = Object.keys(auto).filter(g=>!prodGoods.has(g));
    autoEl.innerHTML = keys.length ? keys.map(g=>{ const i=ECON.SIM_GOODS.indexOf(g), col=econGoodColor(g), tier=(ECON.GOODS[g]||{}).tier;
        return `<div class="econ-ed-row auto">`+
          `<span class="econ-ed-good"><span class="econ-ed-dot" style="background:${col}"></span>`+
            `<span class="econ-ed-gname">${escQH(g)}</span><span class="econ-ed-tier">T${tier}</span>`+
            `<span class="econ-ed-badge auto" title="Auto-derived: a recipe input for a good produced here. The sim imports it via trade — it is NOT added to final demand (that would double-count). Click “produce locally” to make it here instead.">auto</span>`+
            `<span class="econ-ed-badge imported" title="Supplied by interstellar trade rather than produced on this world.">imported</span></span>`+
          `<span class="econ-ed-rate" style="border:none;background:none;text-align:right">${econNum(auto[g])}<span class="econ-ed-unit"> kt/wk</span></span>`+
          `<button class="econ-ed-mini" title="Produce ${escQH(g)} on this world instead of importing it" onclick="econProduceLocally(${i})">+ make here</button>`+
        `</div>`; }).join('')
      : `<div class="econ-ed-empty">No recipe inputs — nothing produced here needs upstream goods.</div>`;
  }

  // Full upstream chain preview (collapsible) + circular-dependency detection.
  let cyclic = false;
  const chainEl = document.getElementById('econ-chain');
  if(chainEl){ const recipeProds = econEditDraft.prod.filter(r=> r.good && +r.rate>0 && ECON.GOODS[r.good] && ECON.GOODS[r.good].recipe);
    if(!recipeProds.length){ chainEl.innerHTML = `<div class="econ-ed-empty">Add a produced good with a recipe to preview its supply chain.</div>`; }
    else { chainEl.innerHTML = recipeProds.map(r=>{ const tree=ECON.resolveChain(r.good, +r.rate); if(ECON.chainHasCycle(tree)) cyclic=true;
      return `<div class="econ-ed-tree" style="margin-bottom:8px">${econChainTreeHtml(tree,0)}</div>`; }).join(''); }
  }
  const warnEl = document.getElementById('econ-cyc-warn');
  if(warnEl) warnEl.style.display = cyclic ? 'block' : 'none';

  // Market Impact — net galaxy supply shift + projected price direction per affected good.
  const impEl = document.getElementById('econ-impact');
  if(impEl){ const imp = ECON.marketImpact(econEditNodeId, maps.prod, maps.cons);
    if(!imp.length){ impEl.innerHTML = `<div class="econ-ed-empty">No change to the galactic market yet.</div>`; }
    else { impEl.innerHTML = imp.map(m=>{ const col=econGoodColor(m.good), up=m.arrow==='▲';
      return `<div class="econ-ed-impact-row">`+
        `<span class="econ-ed-impact-good"><span class="econ-ed-dot" style="background:${col}"></span>${escQH(m.good)}`+
          `${m.newDeficit?' <span class="econ-ed-deficit" title="This edit tips the whole galaxy into a supply deficit for this good.">⚠ tips to deficit</span>':(m.deficit?' <span class="econ-ed-deficit">deficit</span>':'')}</span>`+
        `<span class="econ-ed-impact-val">${econNum(m.before)}→${econNum(m.after)} kt/wk `+
          `<span class="econ-ed-arrow ${up?'up':'down'}" title="${up?'Net supply falls → price tends dearer':'Net supply rises → price tends cheaper'}">${m.arrow}${up?' dearer':' cheaper'}</span></span>`+
      `</div>`; }).join(''); }
  }

  const saveBtn = document.getElementById('econ-editor-save');
  if(saveBtn) saveBtn.disabled = !econDraftValid();
}

function renderEconEditor(){
  const body=document.getElementById('econ-editor-body'); if(!body||!econEditDraft) return;
  const id=econEditNodeId, w=ECON.worlds()[id], p=ECON.effectiveProfile(id);
  const FAC=(typeof GALAXY_FACTIONS!=='undefined')?GALAXY_FACTIONS:{}, fac=FAC[w.fac]||{name:'Independent',color:'#9fb0c8'};
  const ttl=document.getElementById('econ-editor-title'); if(ttl) ttl.innerHTML=`⚒ ${escQH(w.label)} — Production &amp; Consumption`;
  let h='';
  h+=`<div class="econ-ed-sub"><span class="hx-tag" style="color:${fac.color};border-color:${fac.color}">${escQH(fac.name)}</span> `+
     `Rates are in <b>kilotonnes per week</b> (1 tick = 1 Imperial week). `+
     `${p.overridden?'<b style="color:#C98BE8">Custom economy</b> — overrides the built-in profile.':'Showing the built-in profile; edits create a custom override.'}</div>`;

  h+=`<div class="econ-ed-cyc-warn" id="econ-cyc-warn" style="display:none">⟲ <b>Circular dependency</b> in a recipe chain — the loop is shown but not expanded, so resolution never runs away. Check the recipe data.</div>`;

  // Produces
  h+=`<div class="econ-ed-section"><div class="econ-ed-lbl">▲ Produces <span class="econ-ed-hint">— goods made here (adds supply)</span></div>`;
  h+=`<div class="econ-ed-rows" id="econ-prod-rows">${econRowsHtml('prod')}</div>`;
  h+= (econPicker&&econPicker.list==='prod') ? econPickerHtml()
      : `<button class="econ-ed-add" onclick="econOpenPicker('prod')">+ Add produced good</button>`;
  h+=`</div>`;

  // Consumes (manual final demand) + auto-imported inputs
  h+=`<div class="econ-ed-section"><div class="econ-ed-lbl">▼ Consumes <span class="econ-ed-hint">— final demand: population + finished goods (adds demand)</span></div>`;
  h+=`<div class="econ-ed-rows" id="econ-cons-rows">${econRowsHtml('cons')}</div>`;
  h+= (econPicker&&econPicker.list==='cons') ? econPickerHtml()
      : `<button class="econ-ed-add" onclick="econOpenPicker('cons')">+ Add consumed good</button>`;
  h+=`<div class="econ-ed-lbl" style="margin:14px 0 6px">⚙ Auto-imported recipe inputs <span class="econ-ed-hint">— derived from Produces; supplied by trade</span></div>`;
  h+=`<div class="econ-ed-rows" id="econ-auto-rows"></div>`;
  h+=`</div>`;

  // Chain preview
  h+=`<div class="econ-ed-section"><details class="econ-ed-collapse"><summary>▸ Full production-chain preview</summary>`+
     `<div id="econ-chain"></div></details></div>`;

  // Market price tweaks — referee manual price overlay (world-wide lever + per good)
  h+=`<div class="econ-ed-section"><div class="econ-ed-lbl">⚖ Market price tweaks <span class="econ-ed-hint">— manual referee nudge, Simple &amp; Full mode (survives reset)</span></div>`;
  h+= econPriceControlHTML(id, true);
  const pgoods = ECON.SIM_GOODS.filter(g=>!ECON.GOODS[g].internal && (((p.prod&&p.prod[g])||(p.cons&&p.cons[g]))||ECON.goodPriceAdj(id,g)));
  h+=`<div class="econ-ed-lbl" style="margin:12px 0 4px;font-size:10px;color:var(--tx1)">Per good</div>`;
  if(!pgoods.length){ h+=`<div class="econ-ed-empty">No goods traded here to price.</div>`; }
  else pgoods.forEach(g=>{ const notch=ECON.goodPriceAdj(id,g), pct=Math.round((Math.pow(1.08,notch)-1)*100), col=econGoodColor(g);
    const lab=notch===0?'par':(notch>0?`+${pct}%`:`${pct}%`), lc=notch>0?'#e8a0a0':(notch<0?'#7ec98f':'var(--tx1)');
    h+=`<div class="econ-ed-row"><span class="econ-ed-good"><span class="econ-ed-dot" style="background:${col}"></span><span class="econ-ed-gname">${escQH(g)}</span></span>`+
       `<span style="color:${lc};font-size:11px;min-width:46px;text-align:right">${lab}</span>`+
       `<button class="econ-ed-mini" title="Cheaper" onclick="econBumpGoodPrice('${id}','${escQH(g)}',-1)">–</button>`+
       `<button class="econ-ed-mini" title="Dearer" onclick="econBumpGoodPrice('${id}','${escQH(g)}',1)">+</button></div>`;
  });
  h+=`</div>`;

  // Market impact
  h+=`<div class="econ-ed-section"><div class="econ-ed-lbl">≈ Market impact <span class="econ-ed-hint">— projected galactic supply/demand &amp; price shift</span></div>`+
     `<div class="econ-ed-impact" id="econ-impact"></div></div>`;

  body.innerHTML=h;
  // Revert only makes sense when an override exists
  const rev=document.getElementById('econ-editor-revert'); if(rev) rev.style.display = p.overridden ? '' : 'none';
  renderEconDerived();
}

function commitEconEditor(){
  if(!econEditDraft||!econEditNodeId) return;
  if(!econDraftValid()){ if(typeof showToast==='function') showToast('Fix invalid rows (rates must be > 0, no duplicates)','error'); return; }
  const maps=econDraftMaps();
  if(typeof recordDesignUndo==='function') recordDesignUndo('Edit economy — ' + econEditNodeId);
  ECON.setProfile(econEditNodeId, maps.prod, maps.cons);
  if(typeof showToast==='function') showToast('Economy saved — galactic market updated');
  closeEconEditor();
  if(typeof econPanelOpen!=='undefined'&&econPanelOpen) renderEconPanel();
  if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh();
}
function econEditRevert(){
  if(!econEditNodeId) return;
  if(!confirm('Revert this world to its built-in economy? Your custom production/consumption here will be discarded.')) return;
  if(typeof recordDesignUndo==='function') recordDesignUndo('Revert economy — ' + econEditNodeId);
  ECON.clearProfile(econEditNodeId);
  if(typeof showToast==='function') showToast('Reverted to the built-in economy');
  closeEconEditor();
  if(typeof econPanelOpen!=='undefined'&&econPanelOpen) renderEconPanel();
  if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh();
}

// ── World status & black markets — referee panel. Lists the live conditions the sim derives (boom/
//    bust/unrest/rationing) plus any black markets, each with clear/pin, and two "force" mini-forms so
//    the referee can plant or suppress any condition at will. ──
// ── GalNet — the galaxy news feed (cabinet reshuffles, trade wars, détente, policy shifts) ──
function econGalNetSectionHTML(){
  if(typeof ECON==='undefined' || !ECON.active() || typeof ECON.news!=='function') return '';
  const news=ECON.news(); if(!news.length) return '';
  const NICON={ cabinet:'🏛', embargo:'⛔', tariff:'⚖', thaw:'🕊', policy:'📜', pirate:'☠' };
  let h=`<div style="padding:8px 10px;border-bottom:1px solid var(--bd0)">`;
  h+=`<div style="font-size:11px;color:var(--tx1);margin-bottom:5px">📡 GalNet — galaxy news <span style="color:var(--tx1);font-size:9px">— broadcast from the living galaxy</span></div>`;
  const stdHolders = (typeof standingHoldersFor==='function') ? standingHoldersFor : null;
  news.slice(0,10).forEach(n=>{ const col=n.fac?ECON.facColor(n.fac):'#9fb0c8';
    const holders = (n.fac && stdHolders) ? stdHolders(n.fac) : [];
    h+=`<div style="display:flex;gap:6px;align-items:baseline;font-size:10px;color:#cdd6e0;padding:2px 0;border-top:1px solid var(--bd0)">`;
    h+=`<span style="color:var(--tx1);white-space:nowrap;font-size:9px">wk ${n.wk}</span>`;
    h+=`<span style="border-left:2px solid ${col};padding-left:6px;flex:1">${NICON[n.kind]||'•'} ${escQH(n.text)}`;
    if(n.fac && typeof standingBeginNote==='function'){
      const note=(''+n.text).replace(/'/g,'’').replace(/"/g,'”');
      const who = holders.length ? ` title="Affects: ${holders.map(x=>escQH(x.who)+' ('+escQH(x.label)+')').join(', ')}"` : '';
      h+=` <button onclick="standingBeginNote('${escQH(n.fac)}','${escQH(ECON.facName?ECON.facName(n.fac):n.fac)}','${escQH(note)}')"${who} style="background:none;border:1px solid ${holders.length?'#7a5f2f':'var(--bd0)'};color:${holders.length?'#e0b978':'var(--tx1)'};border-radius:4px;padding:0 5px;font-size:9px;cursor:pointer;white-space:nowrap">🎖${holders.length?' '+holders.length:''}</button>`;
    }
    h+=`</span></div>`; });
  h+=`<div style="font-size:9px;color:var(--tx1);margin-top:4px">Headlines the galaxy generates on its own — governments reshuffle, powers embargo &amp; reconcile, agendas shift. Players overhear these via the Oracle (📡 GalNet rumours). <b style="color:#e0b978">🎖</b> notes a headline into a player's private Standing (a number = players already tied to that power).</div>`;
  h+=`</div>`;
  return h;
}
// ── Factions — the major powers as strategy-game actors (treasury · income · agenda · diplomacy · statecraft) ──
function econRelWord(v){ return v>=40?['warm','#7ec98f']:v>=0?['cordial','#9fd0b0']:v>=-30?['wary','#e0c87a']:v>=-55?['tense','#e0a24a']:['hostile','#e8776a']; }
function econFactionsSectionHTML(){
  if(typeof ECON==='undefined' || !ECON.active()) return '';
  const on=ECON.factionsOn(), F=ECON.factions(), ids=ECON.factionIds().filter(id=>F[id]);
  const AGD={ STABILISE:['🛟 Stabilise','#5fb0e0'], CONTAIN:['🛡 Contain','#e0a24a'], EXPAND:['✦ Expand','#7ec98f'], CONSOLIDATE:['◉ Consolidate','#9fb0c8'] };
  const shocks=(ECON.state.shocks||[]).filter(s=>s && s.src==='faction');
  const wl=ECON.worlds();
  let h=`<div style="padding:8px 10px;border-bottom:1px solid var(--bd0)">`;
  h+=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;flex-wrap:wrap"><span style="font-size:11px;color:var(--tx1)">Factions — powers of the galaxy</span>`;
  h+=`<button onclick="econToggleFactions()" title="Faction AI — when ON, the major powers act like a strategy-game AI: book income from their worlds, post contracts (relief / patrol / bounty / development), fund relief into their own shortages, and run diplomacy — trade embargoes &amp; tariffs against rivals, and détente when relations recover. Bounded, referee-advanced, full-sim only." style="background:${on?'#26324a':'var(--bg0)'};border:1px solid ${on?'#5f7f9d':'var(--bd0)'};color:${on?'#cfe0f2':'var(--tx1)'};border-radius:6px;padding:4px 8px;font-size:10px;cursor:pointer">◈ Faction AI · ${on?'ON':'OFF'}</button>`;
  h+=`</div>`;
  if(!ids.length){ h+=`<div style="font-size:10px;color:var(--tx1)">No faction state yet — step the sim.</div></div>`; return h; }
  const CB='background:none;border:1px solid var(--bd0);color:var(--tx1);border-radius:5px;padding:0 5px;font-size:9px;cursor:pointer;white-space:nowrap';
  ids.slice().sort((a,b)=>(F[b].treasury||0)-(F[a].treasury||0)).forEach(id=>{
    const f=F[id], col=ECON.facColor(id), nm=ECON.facName(id);
    // best & worst standing
    let best=null,worst=null; ids.forEach(o=>{ if(o===id) return; const r=ECON.relOf(id,o);
      if(best==null||r>ECON.relOf(id,best)) best=o; if(worst==null||r<ECON.relOf(id,worst)) worst=o; });
    const owned=Object.keys(wl).filter(w=>wl[w].fac===id).length;
    const agd=AGD[f.agenda]||AGD.CONSOLIDATE;
    const myShocks=shocks.filter(s=> s.facA===id || s.faction===id);
    h+=`<div style="padding:3px 0;border-top:1px solid var(--bd0)">`;
    h+=`<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:11px;color:#cdd6e0">`;
    h+=`<span><span class="hx-tag" style="border-color:${col};color:${col};font-size:9px;padding:0 4px">${escQH(nm.split(' ')[0])}</span> ${escQH(nm)} <span style="color:${agd[1]};font-size:9px">${agd[0]}</span></span>`;
    h+=`<span style="color:${(f.treasury||0)>=0?'#7ec98f':'#e8a0a0'};white-space:nowrap" title="State treasury">${econMoney(f.treasury||0)}</span></div>`;
    h+=`<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:10px;color:var(--tx1)">`;
    h+=`<span>${owned} world${owned===1?'':'s'} · <span style="color:#7ec98f">+${econMoney(f.income||0)}/wk</span></span>`;
    if(best!=null&&worst!=null){ const rb=ECON.relOf(id,best), rw=ECON.relOf(id,worst), wb=econRelWord(rb), ww=econRelWord(rw);
      h+=`<span style="white-space:nowrap">↑<span style="color:${wb[1]}" title="Best standing (${rb})">${escQH(ECON.facName(best).split(' ')[0])}</span> · ↓<span style="color:${ww[1]}" title="Worst standing (${rw})">${escQH(ECON.facName(worst).split(' ')[0])}</span></span>`; }
    h+=`</div>`;
    if(myShocks.length){ h+=`<div style="font-size:9px;margin-top:2px;display:flex;gap:4px;flex-wrap:wrap">`;
      myShocks.forEach(s=>{ const other=s.facB||s.againstFac; const lab=s.kind==='embargo'?`⛔ embargo ${ECON.facName(other).split(' ')[0]}`:`⚖ tariff ${(''+(s.good||'')).replace('Common ','')}`;
        h+=`<span style="background:#3a1d1d;border:1px solid #7a3f3f;color:#e8b0a0;border-radius:4px;padding:0 5px" title="ends wk ${s.until}">${escQH(lab)} <button onclick="ECON.liftFactionShock('${id}','${other}');renderEconPanel()" title="Referee: lift this" style="background:none;border:none;color:#e8b0a0;cursor:pointer;padding:0">✕</button></span>`; });
      h+=`</div>`; }
    // Cabinet — the power's government: head of state + ministers (name · trait). Reshuffled over time; broadcast on GalNet.
    { const cab=ECON.cabinetOf(id), head=cab.find(s=>s.post==='head');
      if(head){ h+=`<div style="font-size:9px;color:var(--tx1);margin-top:2px">🏛 <span style="color:#cdd6e0">${escQH(head.title)}</span> <b style="color:${col}">${escQH(head.name)}</b> <span style="color:var(--tx1)">· ${escQH(head.trait)}</span></div>`;
        h+=`<div style="font-size:9px;color:var(--tx1);margin-top:1px;display:flex;gap:4px;flex-wrap:wrap">`;
        cab.filter(s=>s.post!=='head').forEach(s=>{ h+=`<span title="${escQH(s.title)} · ${escQH(s.trait)}${s.since?' · since wk '+s.since:''}" style="background:var(--bg0);border:1px solid var(--bd0);border-radius:4px;padding:0 4px"><span style="color:var(--tx1)">${escQH(s.title.replace('Minister of the ','').replace('Minister of ','').replace('Foreign Secretary','Foreign'))}:</span> ${escQH(s.name)}</span>`; });
        h+=`</div>`; }
    }
    h+=econSparkline(f.hist,280,34);
    h+=`<div style="display:flex;gap:4px;margin-top:2px;flex-wrap:wrap">`;
    h+=`<button onclick="econBumpFactionTreasury('${id}',100000)" title="Fund the treasury (+100k)" style="${CB}">＋100k</button>`;
    h+=`<button onclick="econBumpFactionTreasury('${id}',-100000)" title="Drain the treasury (−100k)" style="${CB}">－100k</button>`;
    h+=`</div></div>`;
  });
  h+=`<div style="font-size:10px;color:var(--tx1);margin-top:5px">Powers book income from the worlds they hold, then spend it: posting contracts (below), funding relief into their own shortages, and running statecraft. <b style="color:#e8776a">⛔/⚖</b> = a live trade embargo or tariff a power has raised against a rival (relations-driven; self-expiring; ✕ to lift). Standing drifts toward each rivalry's baseline and tips into embargoes when it sours, détente when it recovers. Turn <b>Faction AI</b> off for static borders.</div>`;
  h+=`</div>`;
  return h;
}
// ── Pirate bands — autonomous raiders with rules-legal Traveller 2e / High Guard hulls ──
function econPiratesSectionHTML(){
  if(typeof ECON==='undefined' || !ECON.active() || typeof ECON.pirates!=='function') return '';
  const on=ECON.piratesOn(), P=ECON.pirates(), wl=ECON.worlds(), SHIPS=ECON.pirateShips();
  const bands=Object.values(P);
  const CB='background:none;border:1px solid var(--bd0);color:var(--tx1);border-radius:5px;padding:0 5px;font-size:9px;cursor:pointer;white-space:nowrap';
  const pips=(n,max,col)=>{ let s='<span style="display:inline-flex;gap:2px;vertical-align:middle">'; for(let i=0;i<max;i++) s+=`<span style="width:9px;height:6px;border-radius:1px;background:${i<n?col:'var(--bd0)'}"></span>`; return s+'</span>'; };
  let h=`<div style="padding:8px 10px;border-bottom:1px solid var(--bd0)">`;
  h+=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;flex-wrap:wrap"><span style="font-size:11px;color:var(--tx1)">☠ Pirate bands</span>`;
  h+=`<button onclick="econTogglePirates()" title="Pirate AI — when ON, raider bands autonomously prey on convoys near their turf, grow notorious, draw faction bounties, and get broken up by patrols. Bounded (≤2 raids/week) &amp; referee-advanced. Their ships are rules-legal MgT2e/High Guard hulls you can deploy straight into combat." style="background:${on?'#3a1d1d':'var(--bg0)'};border:1px solid ${on?'#7a3f3f':'var(--bd0)'};color:${on?'#e8b0a0':'var(--tx1)'};border-radius:6px;padding:4px 8px;font-size:10px;cursor:pointer">☠ Pirate AI · ${on?'ON':'OFF'}</button>`;
  h+=`<button onclick="econSpawnPirate()" title="Spawn a new raider band at a lawless world" style="${CB};padding:4px 8px;font-size:10px">＋ Band</button>`;
  h+=`</div>`;
  const hasEnc = (typeof combatEncounter!=='undefined' && combatEncounter);
  bands.sort((a,b)=>((a.defunct?1:0)-(b.defunct?1:0)) || ((b.noto||0)-(a.noto||0))).forEach(b=>{
    const sh=SHIPS[b.ship]||SHIPS.corsair, base=wl[b.base]?wl[b.base].label:(b.base||'—');
    h+=`<div style="padding:3px 0;border-top:1px solid var(--bd0)${b.defunct?';opacity:.5':''}">`;
    h+=`<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:11px;color:#cdd6e0">`;
    h+=`<span><span class="hx-tag" style="border-color:#e8776a;color:#e8776a;font-size:9px;padding:0 4px">☠</span> ${escQH(b.name)}${b.defunct?' <span style="color:var(--tx1);font-size:9px">(broken up)</span>':''}</span>`;
    h+=`<span style="color:#e0b978;white-space:nowrap" title="Fenced loot">${econMoney(b.loot||0)}</span></div>`;
    h+=`<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:10px;color:var(--tx1);margin-top:1px">`;
    h+=`<span title="Home berth">⚓ ${escQH(base)}</span>`;
    h+=`<span title="Strength (hulls)">${pips(b.strength||0,5,'#e8776a')} <span style="color:var(--tx1)">×${b.strength||0}</span></span></div>`;
    h+=`<div style="font-size:9px;color:var(--tx1);margin-top:2px"><span style="color:#9fd0ff">${escQH(sh.name)}</span> — ${escQH(sh.t2e)}${sh.hg?' <span style="color:#e0b978" title="High Guard hull">◆ HG</span>':''}`;
    h+=` · notoriety <b style="color:${(b.noto||0)>=40?'#e8776a':'#e0c87a'}">${Math.round(b.noto||0)}</b></div>`;
    { const hold=b.hold||{}, gs=Object.keys(hold).filter(g=>hold[g]>0.5);
      if(gs.length){ const hv=Math.round(gs.reduce((s,g)=>s+hold[g]*ECON.goodValue(g),0));
        h+=`<div style="font-size:9px;color:#e0b978;margin-top:1px" title="Stolen cargo in the band's hold — fenced to lax-law ports over time, or seized if the players storm the base">📦 hold: ${gs.map(g=>Math.round(hold[g])+'kt '+g.replace('Common ','')).join(', ')} <span style="color:var(--tx1)">(~${econMoney(hv)})</span></div>`; }
    }
    if(!b.defunct){
      h+=`<div style="display:flex;gap:4px;margin-top:3px;flex-wrap:wrap">`;
      h+=`<button onclick="econPirateRaid('${b.id}')" title="Resolve a raid now — plunder a convoy in reach" style="${CB}">☠ Raid now</button>`;
      h+=`<button onclick="econDeployPirate('${b.id}')" title="${hasEnc?'Deploy this hull into the current combat encounter (a rules-legal MgT2e stat block)':'Start a ⚔ Combat encounter first, then deploy'}" style="${CB};${hasEnc?'border-color:#7a3f3f;color:#e8b0a0':''}">⚔ To combat</button>`;
      h+=`<button onclick="econPirateBaseRaid('${b.id}')" title="Players stormed the base — seize its Cr hoard (→ party funds) + its stolen-goods hold; the band is wiped out" style="${CB};border-color:#7a5f2f;color:#e0b978">🏴 Raid base</button>`;
      h+=`<button onclick="econPirateHull('${b.id}',1)" title="Add a hull" style="${CB}">＋hull</button>`;
      h+=`<button onclick="econPirateHull('${b.id}',-1)" title="Lose a hull (0 = broken up)" style="${CB}">－hull</button>`;
      h+=`<button onclick="econDisbandPirate('${b.id}')" title="Break up this band" style="${CB}">⚓ Disband</button>`;
      h+=`</div>`;
    }
    h+=`</div>`;
  });
  if(!bands.length) h+=`<div style="font-size:10px;color:var(--tx1)">No bands yet — the frontier is quiet. Spawn one, or let the sim form them.</div>`;
  h+=`<div style="font-size:10px;color:var(--tx1);margin-top:5px">Raiders prey on convoys near their turf (≤2/week — the tuned trade balance holds), banking fenced loot and notoriety. Notoriety draws <b>faction bounties</b> (in the contracts below) and patrols that wear a band down until it's broken. <b style="color:#9fd0ff">Ships are real MgT2e / High Guard designs</b> — <b>⚔ To combat</b> drops the band's hull into a live encounter as a rules-legal stat block.</div>`;
  h+=`</div>`;
  return h;
}
function econWorldStatusSectionHTML(){
  if(typeof ECON==='undefined' || !ECON.active()) return '';
  const META=ECON.WS_META||{}, wl=ECON.worlds(), wk=ECON.state.week;
  const ist='background:var(--bg0);border:1px solid var(--bd0);color:var(--tx0);border-radius:5px;padding:3px 4px;font-size:11px';
  const CB='background:none;border:1px solid var(--bd0);color:var(--tx1);border-radius:5px;padding:0 6px;font-size:10px;cursor:pointer';
  const wopts=Object.values(wl).map(w=>({id:w.id,label:w.label})).sort((a,b)=>(''+a.label).localeCompare(b.label));
  const wsel=(sel)=>wopts.map(w=>`<option value="${w.id}"${w.id===sel?' selected':''}>${escQH(w.label)}</option>`).join('');
  const goods=ECON.SIM_GOODS.filter(g=>!ECON.GOODS[g].internal);
  let h=`<div style="padding:8px 10px;border-bottom:1px solid var(--bd0)">`;
  h+=`<div style="font-size:11px;color:var(--tx1);margin-bottom:5px">World status &amp; black markets</div>`;
  const ws=ECON.allWorldStatus(), cb=ECON.allContraband(), rows=[];
  Object.keys(ws).forEach(id=>{ const s=ws[id]; if(!s||!s.kind||!wl[id]) return; const m=META[s.kind]||{};
    rows.push(`<div style="display:flex;justify-content:space-between;gap:6px;align-items:center;font-size:11px;padding:2px 0;border-top:1px solid var(--bd0)"><span><span style="color:${m.color||'#9fb0c8'}">${m.icon||'•'} ${escQH(m.label||s.kind)}${s.sev>1?' '+('I'.repeat(s.sev)):''}</span><span style="color:var(--tx1)"> · ${escQH(wl[id].label)}</span> <span style="color:var(--tx1);font-size:9px">${s.src==='ref'?'📌 forced':'auto'}${s.until!=null?' · '+Math.max(0,s.until-wk)+'wk':''}</span></span><span style="white-space:nowrap">${s.src!=='ref'?`<button onclick="econPinStatus('${id}')" title="Pin — the sim won't overwrite it" style="${CB}">📌</button> `:''}<button onclick="econClearStatus('${id}')" title="Clear" style="${CB}">✕</button></span></div>`); });
  Object.keys(cb).forEach(id=>{ const s=cb[id]; if(!s||!s.good||!wl[id]) return;
    rows.push(`<div style="display:flex;justify-content:space-between;gap:6px;align-items:center;font-size:11px;padding:2px 0;border-top:1px solid var(--bd0)"><span><span style="color:#b48cd6">☣ Black market</span><span style="color:var(--tx1)"> · ${escQH(wl[id].label)} · ${escQH((''+s.good).replace('Common ',''))} <span style="color:#b48cd6">+${Math.round(((s.premium||1.6)-1)*100)}%</span></span> <span style="color:var(--tx1);font-size:9px">${s.src==='ref'?'📌 forced':'auto'}</span></span><span><button onclick="econClearContraband('${id}')" title="Clear" style="${CB}">✕</button></span></div>`); });
  h+= rows.length ? rows.join('') : `<div style="font-size:10px;color:var(--tx1)">No active conditions. The sim flags boomtowns, slumps, unrest, rationing and black markets as the galaxy churns — or force one below.</div>`;
  const cfg=econWSCfg;
  h+=`<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-top:7px">`;
  h+=`<select id="econ-ws-world" style="${ist}">${wsel(cfg.world)}</select>`;
  h+=`<select id="econ-ws-kind" style="${ist}">`+['boom','bust','unrest','rationing','none'].map(k=>`<option value="${k}"${k===cfg.kind?' selected':''}>${k==='none'?'suppress':(META[k]?META[k].label:k)}</option>`).join('')+`</select>`;
  h+=`<select id="econ-ws-sev" style="${ist}" title="Severity (unrest = output hit)">`+[1,2,3].map(n=>`<option value="${n}"${n===cfg.sev?' selected':''}>sev ${n}</option>`).join('')+`</select>`;
  h+=`<input id="econ-ws-weeks" type="number" min="0" step="1" value="${cfg.weeks}" style="${ist};width:52px" title="Duration, weeks (0 = until cleared)"><span style="font-size:11px;color:var(--tx1)">wk</span>`;
  h+=`<button onclick="econForceStatus()" style="background:#3a2d4a;border:1px solid #6f5b8a;color:#d8c8ea;border-radius:6px;padding:5px 9px;font-size:11px;cursor:pointer">Force status</button>`;
  h+=`</div>`;
  const cc=econCBCfg;
  h+=`<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-top:5px">`;
  h+=`<select id="econ-cb-world" style="${ist}">${wsel(cc.world)}</select>`;
  h+=`<select id="econ-cb-good" style="${ist}">`+goods.map(g=>`<option value="${g}"${g===cc.good?' selected':''}>${g.replace('Common ','')}</option>`).join('')+`</select>`;
  h+=`<input id="econ-cb-weeks" type="number" min="0" step="1" value="${cc.weeks}" style="${ist};width:52px" title="Duration, weeks (0 = until cleared)"><span style="font-size:11px;color:var(--tx1)">wk</span>`;
  h+=`<button onclick="econForceContraband()" style="background:#2d2a4a;border:1px solid #6f5b8a;color:#c8c8ea;border-radius:6px;padding:5px 9px;font-size:11px;cursor:pointer">☣ Black market</button>`;
  h+=`</div>`;
  h+=`<div style="font-size:10px;color:var(--tx1);margin-top:5px">Unrest dampens a world's non-food output (food is spared — no famine spiral). A black market pays a premium and posts a smuggling job below; players still cut the deal at the table.</div>`;
  h+=`</div>`;
  return h;
}
// World-status / black-market referee handlers
function econForceStatus(){
  const w=document.getElementById('econ-ws-world'), k=document.getElementById('econ-ws-kind'), sv=document.getElementById('econ-ws-sev'), wke=document.getElementById('econ-ws-weeks');
  if(!w||!k) return;
  econWSCfg={ world:w.value, kind:k.value, sev:Math.max(1,Math.min(3,parseInt(sv&&sv.value)||1)), weeks:Math.max(0,parseInt(wke&&wke.value)||0) };
  ECON.setWorldStatus(econWSCfg.world, econWSCfg.kind, econWSCfg.sev, econWSCfg.weeks);
  renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh();
}
function econClearStatus(id){ ECON.clearWorldStatus(id); renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh(); }
function econPinStatus(id){ ECON.pinWorldStatus(id); renderEconPanel(); }
function econForceContraband(){
  const w=document.getElementById('econ-cb-world'), g=document.getElementById('econ-cb-good'), wke=document.getElementById('econ-cb-weeks');
  if(!w||!g) return;
  econCBCfg={ world:w.value, good:g.value, weeks:Math.max(0,parseInt(wke&&wke.value)||0) };
  ECON.setContraband(econCBCfg.world, econCBCfg.good, econCBCfg.weeks);
  renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh();
}
function econClearContraband(id){ ECON.clearContraband(id); renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh(); }
// Corp god-mode referee handlers — force a collapse / refloat / bend the war-chest
function econCollapseCorp(id, mode){
  const c=ECON.corps()[id]; if(!c) return;
  let msg = mode==='liquidate' ? `Liquidate ${c.name}? Its ships, treasury and expansions are wiped entirely.`
                               : `Collapse ${c.name}? Its flagships are seized and it becomes a defunct shell (its expansions linger as bought-out infrastructure).`;
  if(c.megacorp) msg = `⚠ ${c.name} is the OmniSynth MEGACORP — the setting's dominant economic power, normally safeguarded so it never collapses.\n\n`+msg+`\n\nForce it anyway?`;
  if(!confirm(msg)) return;
  ECON.dissolveCorp(id, mode);
  renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh();
}
function econReviveCorp(id){ ECON.reviveCorp(id); renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh(); }
function econBailCorp(id){ const c=ECON.corps()[id]; if(!c) return; ECON.setCorpTreasury(id,(c.treasury||0)+100000); renderEconPanel(); }
function econDrainCorp(id){ const c=ECON.corps()[id]; if(!c) return; ECON.setCorpTreasury(id,(c.treasury||0)-100000); renderEconPanel(); }

function renderEconPanel(){
  const body=document.getElementById('econ-body'); if(!body) return;
  if(typeof ECON==='undefined'){ body.innerHTML='<div style="padding:10px;color:var(--tx1)">Engine not loaded.</div>'; return; }
  const st=ECON.state, on=ECON.active(), wk=st.week;
  const btn=(label,fn,extra)=>`<button onclick="${fn}" style="background:var(--bg0);border:1px solid var(--bd0);color:var(--tx0);border-radius:6px;padding:5px 9px;font-size:11px;cursor:pointer;margin:2px ${extra||''}">${label}</button>`;
  let h='';
  h+=`<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border-bottom:1px solid var(--bd0)">`;
  h+=`<span style="font-size:11px;color:var(--tx1)">Living economy</span>`;
  h+=btn(on?'⚙ Full simulation':'◐ Simple (default)', 'econToggleActive()', on?'background:#1d4a33;border-color:#3f9d5a;color:#bfeacb':'background:#3a3320;border-color:#9d8a3f;color:#eadfbf');
  if(on){
    h+=`<span style="font-size:11px;color:var(--tx1)">Imperial week <b style="color:#f4d35e">${wk}</b></span>`;
    { let lvl=1; try{ lvl=ECON.inflationLevel(); }catch(e){} const ic=lvl>1.15?'#e8a0a0':(lvl>1.03?'#e0b24a':'#9fb0c8');
      h+=`<span style="font-size:11px;color:var(--tx1)" title="Galaxy price level vs par — rises with sustained shortages, decays slowly">Inflation <b style="color:${ic}">×${lvl.toFixed(2)}</b></span>`; }
    h+=btn('+1 day','econDayStep()'); h+=btn('Step +1 wk','econStep(1)'); h+=btn('+4 wks','econStep(4)'); h+=btn('Reset','econReset()');
    { const fr=window.econViewFrac||0; if(fr>0.001) h+=`<span style="font-size:10px;color:#7ec0e0" title="Sub-week render offset — convoys are mid-jump; reaches a full week at day 7">· day ${Math.round(fr*7)}/7</span>`; }
    h+=`<span style="font-size:10px;color:var(--tx1);flex-basis:100%">Full mode: the multi-tier sim steps every Imperial week and when you advance the calendar. Steps here preview cascades without moving the campaign date. Click the toggle to switch back to Simple.</span>`;
  } else {
    h+=`<span style="font-size:10px;color:var(--tx1);flex-basis:100%">Simple mode: prices come straight from each world's <b>Produces / Demands</b> profile (edit it in Design Mode) — no stepping, no logistics. Producers sell their good cheaper; importers pay more. Switch to <b>Full simulation</b> for the deep stocks/flows model with shocks, convoys &amp; cargo runs (the controls below).</span>`;
  }
  h+=`</div>`;
  // The economy now trades over the JUMP-LANE network — flag any market worlds cut off from it.
  { let disc=[]; try{ disc=ECON.disconnected(); }catch(e){}
    if(disc.length){ h+=`<div style="padding:8px 10px;border-bottom:1px solid var(--bd0);background:rgba(180,60,60,.10)">`;
      h+=`<div style="font-size:11px;color:#e8a0a0;margin-bottom:3px">⚠ ${disc.length} world${disc.length>1?'s':''} off the jump-lane network — economically isolated</div>`;
      h+=`<div style="font-size:10px;color:#cdd6e0;line-height:1.5">${disc.map(d=>escQH(d.label)).join(' · ')}</div>`;
      h+=`<div style="font-size:10px;color:var(--tx1);margin-top:3px">Draw jump lanes to these worlds (Design Mode) to fold them back into the economy.</div></div>`; } }
  h+=`<div style="padding:8px 10px;border-bottom:1px solid var(--bd0)">`;
  { const dOn=ECON.directorOn();
    h+=`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;flex-wrap:wrap">`;
    h+=`<span style="font-size:11px;color:var(--tx1)">Fire a disruption</span>`;
    h+=`<button onclick="econToggleDirector()" title="Auto-fire events — when ON, the galaxy fires its OWN emergent disruptions between the ones you fire here: spreading unrest, monopoly backlash, boomtown crime, and occasional ambient strikes / raids / festivals. Bounded &amp; self-expiring; referee-advanced, full-sim only. Turn OFF for a galaxy that only moves when you fire a preset." style="background:${dOn?'#3a2d4a':'var(--bg0)'};border:1px solid ${dOn?'#7a5f9d':'var(--bd0)'};color:${dOn?'#e5d6f2':'var(--tx1)'};border-radius:6px;padding:4px 8px;font-size:10px;cursor:pointer;white-space:nowrap">◇ Auto-fire events · ${dOn?'ON':'OFF'}</button>`;
    h+=`</div>`; }
  { const si='background:var(--bg0);border:1px solid var(--bd0);color:var(--tx0);border-radius:5px;padding:3px 4px;font-size:11px';
    h+=`<div style="display:flex;align-items:center;gap:7px;margin-bottom:6px;flex-wrap:wrap">`;
    h+=`<span style="font-size:10px;color:var(--tx1)">Duration</span><input id="econ-shock-weeks" type="number" min="1" max="104" value="${econShockCfg.weeks}" style="${si};width:46px"><span style="font-size:10px;color:var(--tx1)">wks</span>`;
    h+=`<span style="font-size:10px;color:var(--tx1);margin-left:4px">Severity</span>`;
    h+=`<input id="econ-shock-sev" type="range" min="1" max="5" value="${econShockCfg.severity}" oninput="econShockCfg.severity=+this.value;var l=document.getElementById('econ-sev-lbl');if(l)l.textContent=['Mild','Moderate','Serious','Severe','Crippling'][this.value-1]" style="width:84px;accent-color:#9d8a3f;cursor:pointer">`;
    h+=`<span id="econ-sev-lbl" style="font-size:10px;color:#e0b24a;min-width:58px">${SHOCK_SEV_LBL[econShockCfg.severity-1]}</span>`;
    h+=`</div><div style="font-size:10px;color:var(--tx1);margin-bottom:5px">Sets how long &amp; how hard the next disruption hits (block/embargo use duration only).</div>`; }
  ECON.PRESETS.forEach(p=> h+=btn('⚡ '+p.label, `econFireById('${p.id}')`) );
  if(st.shocks.length){ h+=`<div style="font-size:11px;color:var(--tx1);margin:6px 0 3px">Active shocks</div>`;
    st.shocks.forEach((s,i)=>{ const ttl=(s.until!=null)?` · ends wk ${s.until}`:'';
      const auto=(s.src==='director')?` <span style="color:#c9a9e0;font-size:9px" title="Auto-fired by the event director — cancel it like any shock">◇ auto</span>`:'';
      h+=`<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#e8a0a0;padding:2px 0"><span>⚡ ${s.label||s.kind}${auto}${ttl}</span><button onclick="econCancelShock(${i})" style="background:none;border:none;color:#e8a0a0;cursor:pointer">✕</button></div>`; }); }
  h+=`</div>`;
  // Cargo run — players move the marginal price by hauling goods world→world
  { const wopts = Object.values(ECON.worlds()).sort((a,b)=>a.label.localeCompare(b.label));
    const wsel = (sel)=> wopts.map(w=>`<option value="${w.id}"${w.id===sel?' selected':''}>${escQH(w.label)}</option>`).join('');
    const gsel = ECON.SIM_GOODS.filter(g=>!ECON.GOODS[g].internal).map(g=>`<option value="${g}"${g===econRunSel.good?' selected':''}>${g.replace('Common ','')}</option>`).join('');
    const ist='background:var(--bg0);border:1px solid var(--bd0);color:var(--tx0);border-radius:5px;padding:3px 4px;font-size:11px';
    h+=`<div style="padding:8px 10px;border-bottom:1px solid var(--bd0)">`;
    h+=`<div style="font-size:11px;color:var(--tx1);margin-bottom:5px">Cargo run — move the margin</div>`;
    h+=`<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center">`;
    h+=`<select id="econ-run-good" style="${ist}">${gsel}</select>`;
    h+=`<span style="font-size:11px;color:var(--tx1)">from</span><select id="econ-run-from" style="${ist}">${wsel(econRunSel.from)}</select>`;
    h+=`<span style="font-size:11px;color:var(--tx1)">to</span><select id="econ-run-to" style="${ist}">${wsel(econRunSel.to)}</select>`;
    h+=`<input id="econ-run-tons" type="number" min="0" step="5" value="${econRunSel.tons}" style="${ist};width:62px" title="Tons hauled"> <span style="font-size:11px;color:var(--tx1)">t</span>`;
    h+=`<button onclick="econApplyRun()" style="background:#1d3a4a;border:1px solid #3f7d9d;color:#bfe0ea;border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer">🚚 Apply run</button>`;
    h+=`</div><div style="font-size:10px;color:var(--tx1);margin-top:4px">Buying tightens the source, selling eases the destination — relief into a shortage moves price most. Capped per run.</div>`;
    h+=`</div>`; }
  h+=`<div style="padding:8px 10px;border-bottom:1px solid var(--bd0)"><div style="font-size:11px;color:var(--tx1);margin-bottom:4px">Stockpiles — weeks of cover · price effect</div>`;
  h+=`<table style="width:100%;border-collapse:collapse;font-size:11px">`;
  ECON_WATCH.forEach(id=>{ const w=ECON.worlds()[id]; if(!w) return;
    let tg=null, tc=Infinity;
    ECON.SIM_GOODS.forEach(g=>{ if(ECON.GOODS[g].internal) return; const cov=ECON.coverWeeks(id,g); if(cov!=null && cov<tc){ tc=cov; tg=g; } });
    if(tg==null) return;
    const p=ECON.pressure(id,tg);
    const pc = p==null?'#8aa':(p<0?'#e87a7a':(p>0?'#7ec98f':'#9fb0c8'));
    const ptxt = p==null?'—':(p<0?`▲ dearer (${p})`:(p>0?`▼ cheaper (+${p})`:'steady'));
    const cc = tc<1?'#e87a7a':(tc<2?'#e0b24a':'#9fb0c8');
    let ff=1; try{ if(on) ff=ECON.foodFactor(id); }catch(e){}
    const ffBadge = (ff<0.99) ? ` <span style="color:#e8a0a0;font-size:9px" title="Food short — workforce thin, ALL output throttled">⚠ −${Math.round((1-ff)*100)}%</span>` : '';
    h+=`<tr style="border-top:1px solid var(--bd0)"><td style="padding:3px 4px;color:var(--tx0)">${w.label}${ffBadge}</td><td style="padding:3px 4px;color:var(--tx1)">${tg.replace('Common ','')}</td><td style="padding:3px 4px;text-align:right;color:${cc}">${tc.toFixed(1)} wk</td><td style="padding:3px 4px;text-align:right;color:${pc}">${ptxt}</td></tr>`;
  });
  h+=`</table></div>`;
  // Price history — galactic average for a good, optionally compared against one system
  { const gsel=ECON.SIM_GOODS.filter(g=>!ECON.GOODS[g].internal), cur=econPriceHistSel;
    if(!gsel.includes(cur.good)) cur.good=gsel[0];
    const gm=(ECON.priceHist().goods||{})[cur.good]||{};
    const sysOpts=Object.keys(gm).filter(id=>gm[id].some(v=>v!=null)).map(id=>({id,label:(ECON.worlds()[id]||{}).label||id})).sort((a,b)=>a.label.localeCompare(b.label));
    if(cur.sys && !gm[cur.sys]) cur.sys='';
    const ist='background:var(--bg0);border:1px solid var(--bd0);color:var(--tx0);border-radius:5px;padding:3px 4px;font-size:11px';
    h+=`<div style="padding:8px 10px;border-bottom:1px solid var(--bd0)">`;
    h+=`<div style="font-size:11px;color:var(--tx1);margin-bottom:5px">Price history — Cr/kt over time</div>`;
    h+=`<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:6px">`;
    h+=`<select onchange="econSetPriceHistGood(this.value)" style="${ist}">${gsel.map(g=>`<option value="${g}"${g===cur.good?' selected':''}>${g.replace('Common ','')}</option>`).join('')}</select>`;
    h+=`<select onchange="econSetPriceHistSys(this.value)" style="${ist}"><option value="">Galactic average</option>${sysOpts.map(o=>`<option value="${o.id}"${o.id===cur.sys?' selected':''}>${escQH(o.label)}</option>`).join('')}</select>`;
    h+=`</div>`;
    h+=econPriceChartHTML(cur.good, cur.sys);
    h+=`</div>`; }
  // Corporations — pooled-capital trading houses (identity · net worth · fleet · investments · market share)
  { const corps=Object.values(ECON.corps()), wl=ECON.worlds(), ags=ECON.agents();
    if(corps.length){
      const netOf=c=>(c.treasury||0)+ags.filter(a=>a.backing===c.id).reduce((s,a)=>s+(a.cap||0),0);
      const live=corps.filter(c=>!c.defunct), totNet=Math.max(1, live.reduce((s,c)=>s+Math.max(0,netOf(c)),0)), monoOn=ECON.monopolyOn();
      h+=`<div style="padding:8px 10px;border-bottom:1px solid var(--bd0)">`;
      h+=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px"><span style="font-size:11px;color:var(--tx1)">Corporations — pooled capital</span>`;
      h+=btn(monoOn?'⚖ Monopoly ON':'⚖ Monopoly OFF','econToggleMonopoly()', monoOn?'background:#4a3a1d;border-color:#9d7a3f;color:#eadcbf':'');
      h+=`</div>`;
      corps.sort((a,b)=>((a.defunct?1:0)-(b.defunct?1:0)) || (netOf(b)-netOf(a))).forEach(c=>{
        const fleet=ags.filter(a=>a.backing===c.id).length, inv=(c.invests||[]).length, net=netOf(c);
        const col=c.color||'#ff9a3c', gcol=(typeof econGoodColor==='function')?econGoodColor(c.specialty):'#9fb0c8', spec=(''+c.specialty).replace('Common ','');
        const wealthPct=c.defunct?0:Math.round(100*Math.max(0,net)/totNet), mktPct=Math.round(100*ECON.corpSpecialtyShare(c)), mono=c.monopoly, open=econCorpSel===c.id;
        const monoBadge = mono?` <span style="color:#e0b24a;font-size:9px" title="Dominates ${Math.round((mono.share||0)*100)}% of galactic ${escQH(spec)}${monoOn?` — raising its price +${Math.round((mono.mult-1)*100)}%`:' (turn Monopoly pricing ON to apply)'}">⚖</span>`:'';
        h+=`<div onclick="econToggleCorp('${c.id}')" title="${escQH(c.name)} — click to highlight its ships &amp; see net-worth P&amp;L" style="padding:3px 0;border-top:1px solid var(--bd0);cursor:pointer${c.defunct?';opacity:.5':''}${open?';background:rgba(255,154,60,.08)':''}">`;
        h+=`<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:11px;color:#cdd6e0">`;
        h+=`<span><span style="color:var(--tx1)">${open?'▾':'▸'}</span> <span class="hx-tag" style="border-color:${col};color:${col};font-size:9px;padding:0 4px">${escQH(c.name.split(' ')[0])}</span> ${escQH(c.name)}${c.megacorp?' <span style="color:#9fd0ff;font-size:9px" title="Megacorp — safeguarded, never collapses">★</span>':''}${monoBadge}${c.defunct?' <span style="color:var(--tx1);font-size:9px">(defunct)</span>':''}</span>`;
        h+=`<span style="color:${net>=0?'#7ec98f':'#e8a0a0'};white-space:nowrap" title="Net worth = treasury + fleet capital">${econMoney(net)}</span></div>`;
        h+=`<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:10px;color:var(--tx1)">`;
        h+=`<span><span style="color:${gcol}">◆ ${escQH(spec)}</span> ${mktPct}% mkt${c.home&&wl[c.home]?` · ${escQH(wl[c.home].label)}`:''}</span>`;
        h+=`<span style="white-space:nowrap">${fleet} ship${fleet===1?'':'s'} · ${inv} invest${inv===1?'':'s'}</span></div>`;
        if(!c.defunct) h+=`<div title="${wealthPct}% of total corporate net worth" style="height:3px;background:var(--bd0);border-radius:2px;margin-top:3px"><div style="height:100%;width:${wealthPct}%;background:${col};border-radius:2px"></div></div>`;
        const CB='background:none;border:1px solid var(--bd0);color:var(--tx1);border-radius:5px;padding:0 5px;font-size:9px;cursor:pointer;white-space:nowrap';
        h+=`<div style="display:flex;gap:4px;margin-top:3px;flex-wrap:wrap">`;
        if(c.defunct){ h+=`<button onclick="econReviveCorp('${c.id}')" title="Refloat — clears defunct, restores a flagship + seed capital" style="${CB}">↑ Refloat</button>`; }
        else { h+=`<button onclick="econCollapseCorp('${c.id}','defunct')" title="Force a collapse — flagships seized, becomes a defunct shell (its expansions linger as bought-out infrastructure)" style="${CB}">⚑ Collapse</button>`;
               h+=`<button onclick="econCollapseCorp('${c.id}','liquidate')" title="Wipe entirely — ships, treasury and expansions all gone" style="${CB}">✕ Liquidate</button>`; }
        h+=`<button onclick="econBailCorp('${c.id}')" title="Top up the war-chest (+100k)" style="${CB}">＋100k</button>`;
        h+=`<button onclick="econDrainCorp('${c.id}')" title="Drain the war-chest (−100k)" style="${CB}">－100k</button>`;
        h+=`</div>`;
        h+=`</div>`;
        if(open) h+=econCorpDetailHTML(c);
      });
      h+=`<div style="font-size:10px;color:var(--tx1);margin-top:5px">Click a house to highlight its ships on the map &amp; see its net-worth P&amp;L. Corp ships trade profit-first anywhere (no territory); treasuries earn weekly operating income, sweep ship profit, bail out losers, grow fleets, and fund world expansions. Bar = share of total corporate net worth; “% mkt” = its slice of galactic output of its specialty. <b style="color:#e0b24a">⚖</b> marks a house dominating its good — turn on <b>Monopoly</b> to let that dominance raise the good's price (bounded, opt-in). <b style="color:#9fd0ff">★</b> = the OmniSynth megacorp (safeguarded — never collapses).</div>`;
      h+=`</div>`;
    }
  }
  h+=econGalNetSectionHTML();        // GalNet news feed — cabinet reshuffles, trade wars, détente, policy shifts
  h+=econFactionsSectionHTML();      // major powers — treasury, income, agenda, diplomacy & statecraft, with referee overrides
  h+=econPiratesSectionHTML();       // pirate bands — bases, strength, notoriety, T2e hulls, raid/deploy-to-combat controls
  h+=econWorldStatusSectionHTML();   // world conditions (boom/bust/unrest/rationing) + black markets, with referee force/pin/clear
  // Corporate contracts — jobs the houses would pay players for. The referee DRAFTS one into a
  // concrete contract, then posts it to the Quest Log (players track it) or leaks it to Library Data.
  { const evs=ECON.corpEvents();
    if(evs.length){
      const CICON={ escort:'🛡', haul:'📦', bounty:'🎯', sabotage:'⚔', espionage:'🕵', smuggle:'🕯' };
      h+=`<div style="padding:8px 10px;border-bottom:1px solid var(--bd0)">`;
      h+=`<div style="font-size:11px;color:var(--tx1);margin-bottom:5px">Corporate contracts <span style="color:var(--tx1);font-size:9px">— ${evs.length} on offer</span></div>`;
      const stdH = (typeof standingHoldersFor==='function') ? standingHoldersFor : null;
      evs.slice().reverse().forEach((ev)=>{ const i=evs.indexOf(ev); const it=ECON.contractItem(ev); if(!it) return;
        const col=it.color||'#9fd0ff', drafted=econDraftSel&&econDraftSel.src==='corp'&&econDraftSel.i===i;
        const held = (stdH && it.corp) ? stdH(it.corp) : [];
        const summ = (it.contract==='sabotage'||it.contract==='espionage' ? `vs ${escQH(it.targetName||'a rival')}`
                   : it.contract==='haul' ? `→ ${escQH(it.place||'?')}`
                   : (it.vessel?`${escQH(it.vessel)}`:'') )
                   + (held.length?` <span title="Players with standing here" style="color:#e0b978">🎖 ${held.map(x=>escQH(x.who.split(' ')[0])).join(', ')}</span>`:'');
        h+=`<div style="padding:3px 0;border-top:1px solid var(--bd0)">`;
        h+=`<div style="display:flex;justify-content:space-between;gap:6px;align-items:center;font-size:11px;color:#cdd6e0">`;
        h+=`<span>${CICON[it.contract]||'•'} <span style="color:${col}">${escQH(it.label)}</span> <span style="color:var(--tx1);font-size:10px">${it.contract}${summ?' · '+summ:''}</span></span>`;
        h+=`<span style="white-space:nowrap"><span style="color:#f4d35e">${econMoney(it.reward)}</span> <button onclick="econDraftContract(${i})" style="background:none;border:1px solid #3a5f8a;color:#9fd0ff;border-radius:5px;padding:0 6px;font-size:10px;cursor:pointer">✍ Draft</button> <button onclick="econDismissContract(${i})" title="Dismiss" style="background:none;border:1px solid var(--bd0);color:var(--tx1);border-radius:5px;padding:0 5px;font-size:10px;cursor:pointer">✕</button></span></div>`;
        if(drafted){ const d=econDraftSel.contract;
          h+=`<div style="background:var(--bg0);border:1px solid var(--bd0);border-radius:6px;padding:7px 8px;margin:4px 0 6px">`;
          h+=`<div style="font-size:11px;color:var(--tx0);font-weight:600;margin-bottom:3px">${escQH(d.title)}</div>`;
          h+=`<div style="font-size:11px;color:#cdd6e0;line-height:1.45;margin-bottom:4px">${escQH(d.brief)}</div>`;
          h+=`<div style="font-size:10px;color:var(--tx1);margin-bottom:5px">Reward ${econMoney(d.reward)} · ${escQH(d.refNote)}</div>`;
          h+=`<div style="display:flex;gap:5px;flex-wrap:wrap">`;
          h+=`<button onclick="econContractToQuest()" style="background:#1d3a4a;border:1px solid #3a6f9d;color:#bfe3ea;border-radius:5px;padding:1px 7px;font-size:10px;cursor:pointer">→ Quest Log</button>`;
          h+=`<button onclick="econContractToLibrary()" style="background:none;border:1px solid #6a5a2a;color:#e0c87a;border-radius:5px;padding:1px 7px;font-size:10px;cursor:pointer">→ Library Data</button>`;
          h+=`<button onclick="econRerollContract()" title="Re-roll the wording" style="background:none;border:1px solid var(--bd0);color:var(--tx1);border-radius:5px;padding:1px 7px;font-size:10px;cursor:pointer">⟳ Re-roll</button>`;
          h+=`<button onclick="econNoteContractPatron()" title="Note this patron in a player's private Standing" style="background:none;border:1px solid #7a5f2f;color:#e0b978;border-radius:5px;padding:1px 7px;font-size:10px;cursor:pointer">🎖 Patron</button>`;
          h+=`<span id="econ-contract-note" style="font-size:9px;color:#7ec98f;align-self:center"></span></div>`;
          h+=`</div>`;
        }
        h+=`</div>`;
      });
      h+=`<div style="font-size:10px;color:var(--tx1);margin-top:5px">Flagged from live corp activity — valuable convoys want escorts, raided houses post bounties, rivals pay for sabotage &amp; espionage (often against OmniSynth). Sabotage/bounty resolve with the ⚔ raid button on the target convoy.</div>`;
      h+=`</div>`;
    }
  }
  // Faction contracts — jobs the STATES post (relief / patrol / bounty / development). Same draft pipeline.
  { const evs=(typeof ECON.factionEvents==='function')?ECON.factionEvents():[];
    if(evs.length){
      const FICON={ relief:'🌾', patrol:'🛰', bounty:'🎯', development:'🏗', escort:'🛡' };
      h+=`<div style="padding:8px 10px;border-bottom:1px solid var(--bd0)">`;
      h+=`<div style="font-size:11px;color:var(--tx1);margin-bottom:5px">Faction contracts <span style="color:var(--tx1);font-size:9px">— ${evs.length} on offer · posted by the powers</span></div>`;
      const stdHF = (typeof standingHoldersFor==='function') ? standingHoldersFor : null;
      evs.slice().reverse().forEach((ev)=>{ const i=evs.indexOf(ev); const it=ECON.factionContractItem(ev); if(!it) return;
        const col=it.color||'#9fb0c8', drafted=econDraftSel&&econDraftSel.src==='faction'&&econDraftSel.i===i;
        const held = (stdHF && it.faction) ? stdHF(it.faction) : [];
        const summ = (it.contract==='relief'||it.contract==='bounty'||it.contract==='development' ? `${escQH(it.place||'?')}${it.good?' · '+(''+it.good).replace('Common ',''):''}`
                   : it.contract==='patrol' ? `${escQH(it.toLabel||'?')}` : '')
                   + (held.length?` <span title="Players with standing here" style="color:#e0b978">🎖 ${held.map(x=>escQH(x.who.split(' ')[0])).join(', ')}</span>`:'');
        h+=`<div style="padding:3px 0;border-top:1px solid var(--bd0)">`;
        h+=`<div style="display:flex;justify-content:space-between;gap:6px;align-items:center;font-size:11px;color:#cdd6e0">`;
        h+=`<span>${FICON[it.contract]||'•'} <span style="color:${col}">${escQH(it.label)}</span> <span style="color:var(--tx1);font-size:10px">${it.contract}${summ?' · '+summ:''}</span></span>`;
        h+=`<span style="white-space:nowrap"><span style="color:#f4d35e">${econMoney(it.reward)}</span> <button onclick="econDraftFactionContract(${i})" style="background:none;border:1px solid #3a5f8a;color:#9fd0ff;border-radius:5px;padding:0 6px;font-size:10px;cursor:pointer">✍ Draft</button> <button onclick="econDismissFactionContract(${i})" title="Dismiss" style="background:none;border:1px solid var(--bd0);color:var(--tx1);border-radius:5px;padding:0 5px;font-size:10px;cursor:pointer">✕</button></span></div>`;
        if(drafted){ const d=econDraftSel.contract;
          h+=`<div style="background:var(--bg0);border:1px solid var(--bd0);border-radius:6px;padding:7px 8px;margin:4px 0 6px">`;
          h+=`<div style="font-size:11px;color:var(--tx0);font-weight:600;margin-bottom:3px">${escQH(d.title)}</div>`;
          h+=`<div style="font-size:11px;color:#cdd6e0;line-height:1.45;margin-bottom:4px">${escQH(d.brief)}</div>`;
          h+=`<div style="font-size:10px;color:var(--tx1);margin-bottom:5px">Reward ${econMoney(d.reward)} · ${escQH(d.refNote)}</div>`;
          h+=`<div style="display:flex;gap:5px;flex-wrap:wrap">`;
          h+=`<button onclick="econContractToQuest()" style="background:#1d3a4a;border:1px solid #3a6f9d;color:#bfe3ea;border-radius:5px;padding:1px 7px;font-size:10px;cursor:pointer">→ Quest Log</button>`;
          h+=`<button onclick="econContractToLibrary()" style="background:none;border:1px solid #6a5a2a;color:#e0c87a;border-radius:5px;padding:1px 7px;font-size:10px;cursor:pointer">→ Library Data</button>`;
          h+=`<button onclick="econRerollContract()" title="Re-roll the wording" style="background:none;border:1px solid var(--bd0);color:var(--tx1);border-radius:5px;padding:1px 7px;font-size:10px;cursor:pointer">⟳ Re-roll</button>`;
          h+=`<button onclick="econNoteContractPatron()" title="Note this patron in a player's private Standing" style="background:none;border:1px solid #7a5f2f;color:#e0b978;border-radius:5px;padding:1px 7px;font-size:10px;cursor:pointer">🎖 Patron</button>`;
          h+=`<span id="econ-contract-note" style="font-size:9px;color:#7ec98f;align-self:center"></span></div>`;
          h+=`</div>`;
        }
        h+=`</div>`;
      });
      h+=`<div style="font-size:10px;color:var(--tx1);margin-top:5px">Posted by the faction AI from live conditions in each power's space — relief runs into shortages, lane patrols for inbound convoys, bounties on raiders, and development charters when a power is flush. Draft one to the Quest Log exactly like a corp job.</div>`;
      h+=`</div>`;
    }
  }
  // Traders — the living merchant market (funds, upkeep, backing, territory, lifecycle)
  { const on=ECON.tradersOn(), wl=ECON.worlds(), FAC=(typeof GALAXY_FACTIONS!=='undefined')?GALAXY_FACTIONS:{}, CORPS=ECON.corps();
    const money=n=>{ n=Math.round(n); const s=n<0?'−':''; const a=Math.abs(n); return s+(a>=1000?'Cr'+(a/1000).toFixed(a>=10000?0:1).replace(/\.0$/,'')+'k':'Cr'+a); };
    const backInfo=b=>{ if(!b||b==='private') return {nm:'Indep',col:'#66bbaa'};
      if(ECON.isCorp(b)){ const c=CORPS[b]; return {nm:(c&&c.name?c.name.split(' ')[0]:'Corp'), col:(c&&c.color)||'#ff9a3c'}; }   // corp ships get their house colour
      const f=FAC[b]; return {nm:(f&&f.name?f.name.split(' ')[0]:b), col:(f&&f.color)||'#9fb0c8'}; };
    const cap=ECON.traderCap(), ags=ECON.agents();
    h+=`<div style="padding:8px 10px;border-bottom:1px solid var(--bd0)">`;
    h+=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px"><span style="font-size:11px;color:var(--tx1)">Traders — living market</span>`;
    h+=btn(on?'● ON':'○ OFF','econToggleTraders()', on?'background:#1d4a33;border-color:#3f9d5a;color:#bfeacb':'');
    h+=`</div>`;
    h+=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">`;
    h+=`<span style="font-size:10px;color:var(--tx1);white-space:nowrap">Fleet cap <b style="color:#f4d35e">${cap}</b> · ${ags.length} active</span>`;
    h+=`<input type="range" min="3" max="150" value="${cap}" oninput="econSetTraderCap(this.value)" style="flex:1;accent-color:#3f9d5a;cursor:pointer" title="Max simultaneous traders — performance lever; smooth to ~150, lowering it stands the weakest down">`;
    h+=`</div>`;
    ags.forEach(a=>{
      const bi=backInfo(a.backing), onRoute = a.route && wl[a.route.from] && wl[a.route.to];
      const nowT = st.week + (window.econViewFrac||0), berthing = onRoute && a.route.began!=null && nowT < a.route.began;
      const rt = berthing ? `<span style="color:#e0b24a">⚓ berthed at ${escQH(wl[a.route.from].label)} · loading${a.route.berthDays?` (${a.route.berthDays}d)`:''}</span>`
               : onRoute ? `<span style="color:#7ec0e0">hauling ${a.route.good.replace('Common ','')} ${escQH(wl[a.route.from].label)}→${escQH(wl[a.route.to].label)}</span>`
                         : `<span style="color:var(--tx1)">surveying</span>`;
      const pc = a.profit>=0?'#7ec98f':'#e87a7a';
      const grace = (a.backing&&a.backing!=='private')?8:4;
      const insolv = (a.insolventWk>0) ? `<span style="color:#e8a0a0;font-size:10px" title="Weeks insolvent — bankrupt at ${grace}"> ⚠${a.insolventWk}/${grace}wk</span>` : '';
      const raidBtn = onRoute ? `<button onclick="event.stopPropagation();econRaidConvoy('${a.id}')" title="Intercept this convoy — cargo lost, destination denied relief" style="background:none;border:1px solid #6a2a2a;color:#e8a0a0;border-radius:5px;padding:0 5px;font-size:10px;cursor:pointer;margin-left:5px">⚔</button>` : '';
      const raided = a.raided ? `<span style="color:#e8a0a0;font-size:10px"> ${a.raided}⚔</span>` : '';
      const open = econTraderSel===a.id, sh=ECON.shipOf(a);
      h+=`<div onclick="econToggleTrader('${a.id}')" title="${escQH(sh.name)} — click for P&amp;L, trips &amp; ship" style="padding:2px 0;border-top:1px solid var(--bd0);cursor:pointer${open?';background:rgba(127,200,224,.06)':''}">`;
      h+=`<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:11px;color:#cdd6e0">`;
      h+=`<span><span style="color:var(--tx1)">${open?'▾':'▸'}</span> <span class="hx-tag" style="border-color:${bi.col};color:${bi.col};font-size:9px;padding:0 4px">${escQH(bi.nm)}</span> ${escQH(a.name)}</span>`;
      h+=`<span style="color:${a.cap>=0?'#cdd6e0':'#e8a0a0'};white-space:nowrap">${money(a.cap)}${insolv}</span></div>`;
      h+=`<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:10px;color:var(--tx1)">`;
      h+=`<span>${rt}${raidBtn}</span><span style="color:${pc};white-space:nowrap">${a.trips} trips${raided} · ${money(a.profit)} P/L · −${money(a.upkeep||0)}/wk</span></div>`;
      h+=`</div>`;
      if(open) h+=econTraderDetailHTML(a);
    });
    h+=`<div style="font-size:10px;color:var(--tx1);margin-top:5px">Faction-backed fleets relieve their own shortages &amp; shun hostile space; independents chase profit. Upkeep drains idle traders; the insolvent go bankrupt; new ones spawn up to the cap.</div>`;
    h+=`</div>`; }
  // Economic history — fired shocks as a dated campaign timeline
  { const hist = ECON.state.history || [];
    if(hist.length){
      const dt = wk=>{ try{ return formatImperial(ordinalToImperial(wk*7)); }catch(e){ return 'wk '+wk; } };
      h+=`<div style="padding:8px 10px;border-bottom:1px solid var(--bd0)"><div style="font-size:11px;color:var(--tx1);margin-bottom:4px">Economic history</div>`;
      hist.slice(0,12).forEach(e=>{
        const active = e.endsWk==null || e.endsWk>=st.week;
        const span = e.endsWk!=null ? `${dt(e.beganWk)} → ${dt(e.endsWk)}` : `${dt(e.beganWk)} → ongoing`;
        h+=`<div style="font-size:11px;padding:1px 0;color:${active?'#e8a0a0':'#9fb0c8'}">${active?'⚡':'·'} ${escQH(e.label)} <span style="color:var(--tx1);font-size:10px">${span}</span></div>`;
      });
      h+=`</div>`;
    } }
  body.innerHTML=h;
}

ECON.load().then(() => ECON.loadProfiles()).then(() => ECON.loadPriceAdj()).then(() => { if(econPanelOpen) renderEconPanel(); if(currentView === 'galaxy' && typeof HX !== 'undefined') HX.refresh(); });


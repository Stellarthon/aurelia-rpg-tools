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
    let foodMult = 1.0;                                       // default world → ~self-sufficient
    if(C('Ag')||C('Ga')) foodMult = 2.3;                     // breadbasket → net exporter
    else if(C('Na')) foodMult = 0.4;                         // non-agricultural → importer
    else if(C('Po')) foodMult = 0.6;
    else if(C('Hi')||C('In')) foodMult = 0.85;               // dense/urban → mild importer
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
      // Trade graph follows the JUMP-LANE network (n.connections = the live GX_LANES
      // overlay). Worlds with no jump lane are economically isolated BY DESIGN — see
      // ECON.disconnected(); draw jump lanes to reconnect them (ECON.syncLanes picks
      // up edits live). NB the jump-lane net is sparser than the old lore graph.
      (((n&&n.connections))||[]).forEach(c=>{ if(worlds[c] && adj[id].indexOf(c)<0){ adj[id].push(c); if(adj[c]&&adj[c].indexOf(id)<0) adj[c].push(id); } });
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
    return { week: wk, active:false, stock, transit, shocks:[], log:[], history:[], base, agents, tradersOn:true, traderCap: DEFAULT_TRADER_CAP, agentSeq: aseq, infl:{}, priceHist:{ wk:[], goods:{} }, psm:{}, corps, corpEvents:[] };
  }
  function ensure(){ if(!worlds) buildTopology(); if(!state) state = freshState(); }
  function stk(id,g){ return (state.stock[id] && state.stock[id][g]) || 0; }
  function setStk(id,g,v){ if(!state.stock[id]) state.stock[id]={}; state.stock[id][g]=Math.max(0,Math.round(v*100)/100); }
  function log(week, text){ state.log.unshift({week,text}); if(state.log.length>80) state.log.length=80; }

  function outputFactor(id, good){
    let f = 1;
    const fac = worlds[id] && worlds[id].fac;
    state.shocks.forEach(s=>{
      if(s.kind==='output' && s.target===id && (s.good==='*'||s.good===good)) f*=s.factor;            // single-world strike / failure
      else if(s.kind==='crackdown' && s.faction===fac && (s.good==='*'||s.good===good)) f*=s.factor;  // faction-wide crackdown on a good
    });
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
  // Lifecycle economics (Cr/week). Upkeep, routine milk-run income, and the public subsidy all
  // scale with HULL SIZE (bigger ships cost more to run but haul more): see upkeepOf/milkRunOf.
  // Idle traders mostly cover upkeep on milk-runs so a calm galaxy thins the herd slowly; shocks
  // are when survivors profit. PUBLIC fleets are subsidised + get a longer insolvency grace.
  const GRACE_PRIVATE = 4, GRACE_PUBLIC = 8, SPAWN_PROB = 0.35, DEFAULT_TRADER_CAP = 8, TRADER_CAP_MAX = 150;   // ~10ms/weekly-step at 150; stays smooth (see bench)
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
    free:  { id:'free',  name:'Free Trader',         tons:200,  jump:1, cargoT:82,  haul:9 },
    far:   { id:'far',   name:'Far Trader',          tons:200,  jump:2, cargoT:64,  haul:8 },
    subm:  { id:'subm',  name:'Subsidised Merchant', tons:400,  jump:1, cargoT:200, haul:14 },
    fat:   { id:'fat',   name:'Fat Trader',          tons:400,  jump:1, cargoT:268, haul:16 },
    heavy: { id:'heavy', name:'Heavy Freighter',     tons:1000, jump:2, cargoT:730, haul:24 },
  };
  function shipOf(a){ return SHIP_CLASSES[(a&&a.shipId)||'free'] || SHIP_CLASSES.free; }
  function pickShip(backing){ const pub=backing&&backing!=='private';
    return pick(pub ? ['subm','subm','fat','heavy','far'] : ['free','free','far','far','subm','fat']); }
  function upkeepOf(a){ return Math.round(400 + shipOf(a).haul*60); }    // bigger hull → more vessel/crew/mooring upkeep (Free ~940 … Heavy ~1840)
  function milkRunOf(a){ return Math.round(shipOf(a).haul*55); }         // routine background haulage income scales with the hold
  function subsidyOf(a){ return Math.round(upkeepOf(a)*0.6); }           // a backer covers ~60% of its public fleet's upkeep
  function agentUnitPrice(good, p, id){ return (AGENT_VALUE[good]||100) * (1 - (p||0)*0.08) * (id?overlayMult(id,good):1); }  // cheaper when glutted (p>0), dearer when short (p<0); ×price-level overlay so traders bank inflated margins
  function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
  function genAgentName(){ for(let i=0;i<8;i++){ const nm=pick(NAME_A)+' '+pick(NAME_B); if(!state.agents.some(a=>a.name===nm)) return nm; } return pick(NAME_A)+' '+pick(NAME_B); }
  function pickBacking(){ if(Math.random()<0.55) return 'private'; return pick(['hegemony','omnisynth','sanhedrin','rsc','uhc']); }
  // A fresh starting roster — a mix of independents and a couple of faction relief fleets.
  function freshAgents(){
    const seed=[['private','free'],['private','far'],['hegemony','subm'],['omnisynth','fat'],['private','free']];
    return seed.map((s,i)=>({ id:'tr'+i, name:AGENT_NAMES[i], cap:AGENT_START_CAP, pos:null, route:null, trips:0, profit:0, backing:s[0], shipId:s[1], insolventWk:0, hist:[], capHist:[] }));
  }
  // ── Corporations: a THIRD backing type (alongside `private` and the factions). Pooled-capital
  //    trading houses with an IDENTITY — a specialty good + home anchor that their ships favour and
  //    their investments expand. Corp ships are ordinary state.agents with backing='corp:<id>'.
  //    Treasury sweeps profitable ships' surplus and bails out losers; treasuries grow fleets and
  //    fund world infrastructure (the corpInvest topology layer in buildTopology). LIVE-only —
  //    skipped by settleBaseline like agents — and advanced ONLY by the referee, because investments
  //    move state.base (see corpsStep guards + the load/reset/advance re-settles). ──
  const CORP_SEED_TREASURY = 55000;      // a house opens with this much working capital
  const CORP_FLOAT = 35000;              // operating float a corp ship keeps; surplus is swept to treasury
  const CORP_BAIL_FLOOR = 6000;          // below this, a ship is topped back toward the float (funds permitting)
  const CORP_SHIP_COST = 35000;          // capital seeded into a newly commissioned hull (drawn from treasury)
  const CORP_COMMISSION_MIN = 45000;     // treasury floor to commission another ship
  const CORP_INVEST_MIN = 130000;        // treasury floor to fund a world expansion
  const CORP_INVEST_COST = 110000;       // cost of one expansion
  const CORP_INVEST_MAX_PER_WORLD = 3;   // bounded so the galaxy drifts, not breaks
  const CORP_INVEST_GLOBAL_MAX = 18;     // galaxy-wide cap on active expansions — keeps cumulative worker-food demand inside the galaxy's surplus (verified by the balance harness) so a long campaign can't slowly starve it
  const CORP_INVEST_MAX_PER_CORP = 9;    // no single house may hold more than half the global cap — leaves room for rivals (so OmniSynth dominates but doesn't monopolise; keeps rival-vs-megacorp contracts grounded)
  // OmniSynth — the setting's MEGACORP. Vital to the story → SAFEGUARDED: it never dissolves and a
  // solvency floor keeps it from ever going bankrupt. It opens large and dominant; its commercial arm
  // coexists with the `omnisynth` faction relief fleets. (Treasury is not price-affecting → no
  // determinism impact; investments still obey the bounded layer + global cap, so balance holds.)
  const MEGACORP_SEED_TREASURY = 300000; // opens as the dominant economic force
  const MEGACORP_FLOOR = 40000;          // solvency floor — its vast off-screen holdings. Below the commission threshold ON PURPOSE: guarantees it can always bail a flagship and never collapses, WITHOUT free-funding endless growth (fleet/infra growth still comes from earned surplus, like the rivals)
  const CORP_MAX = 6, CORP_FORM_PROB = 0.015;          // occasional new houses form, up to this many
  const CORP_OUT_BUMP = 12;              // +specialty output one expansion adds at a world (the expansion also makes its own input chain — see buildTopology — so it never starves a recipe input)
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
  function freshCorps(){ const out={}; corpSeedList().forEach(a=>{   // deterministic seed (empty invests → corp-free base) — 3 rivals + the OmniSynth megacorp
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
        P.sur.forEach(b=>{ if(b.room<=0) return; const D=dist(b.id,blk);
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
            const D=dist(b.id,aBlk); if(D[s.id]==null) return;
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
  // Weekly corp turn: pooled-funds sweep/bail, fleet growth, infrastructure investment, formation &
  // dissolution. REFEREE-ONLY (investments move state.base; cross-device determinism, invariant #4)
  // and skipped by settleBaseline (scratch state has no `corps`). Records investments only — the base
  // re-settle is batched once per advance (see advance/syncToDate), never per-investment.
  function corpsStep(week){
    if(!state.corps || state.tradersOn===false || !state.active) return;
    if(typeof isReferee==='function' && !isReferee()) return;
    const cap=traderCapOf();
    Object.values(state.corps).forEach(c=>{ if(c.defunct) return;
      if(c.megacorp && c.treasury < MEGACORP_FLOOR) c.treasury = MEGACORP_FLOOR;   // OmniSynth solvency floor — it can always bail a flagship & never collapses (vast off-screen holdings)
      const ships=state.agents.filter(a=>a.backing===c.id);          // re-scan each week — agentsStep splices on bankruptcy/spawn
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
    Object.values(worlds).sort((a,b)=> stress(a)-stress(b)).forEach(w=>{   // neediest worlds get first claim on producer surplus
      if(blk[w.id]) return;
      const D = dist(w.id, blk);
      SIM_GOODS.forEach(g=>{
        const d = demandFor(w,g); if(d<=0) return;
        const have = stk(w.id,g) + ((incoming[w.id]||{})[g]||0);
        let need = Math.min(orderUpTo(w,g) - have, d*3);          // cap per-tick pull so no world hoards / drains a producer in one tick
        if(need < d*0.5) return;                                  // hysteresis — skip trivial top-ups
        const prods = Object.values(worlds).filter(p=> p.id!==w.id && !blk[p.id] && p.prod[g] && D[p.id]!=null && !embargoed(w.id,p.id))
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
  function overlayMult(id, good){ return priceAdjOf(id,good) * inflMult(id,good); }   // shared seam: manual × inflation
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
    supaStorage.set('econ-state', JSON.stringify({ week:state.week, active:state.active, stock:state.stock, transit:state.transit, shocks:state.shocks, log:state.log, history:state.history, agents:state.agents, tradersOn:state.tradersOn, traderCap:state.traderCap, agentSeq:state.agentSeq, infl:state.infl, psm:state.psm, corps:state.corps, corpEvents:state.corpEvents }), true); } catch(e){} }
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
    const goods = SIM_GOODS.filter(g=>!GOODS[g].internal);
    Object.keys(worlds).forEach(id=>{ goods.forEach(g=>{
      const p = pressure(id,g); if(p==null) return;
      if(p<=-2) out.push({ kind:'shortage', world:id, label:worlds[id].label, good:g, pressure:p });
      else if(p>=3) out.push({ kind:'glut', world:id, label:worlds[id].label, good:g, pressure:p });
    }); });
    out.sort((a,b)=>{ const r=x=> x.kind==='shock'?0:(x.kind==='contract'?2:1);
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
    agents(){ ensure(); return state.agents||[]; },
    shipOf:(a)=>shipOf(a), SHIP_CLASSES,
    corps(){ ensure(); return state.corps||{}; },   // {corpId:{name,specialty,home,color,treasury,invests,megacorp,...}}
    isCorp,
    corpEvents(){ ensure(); return state.corpEvents||[]; },          // raw flagged contract opportunities
    contractItem:(e)=>{ ensure(); return corpContractItem(e); },     // raw event → rich, labelled contract item (reward, places, names)
    contractReward:(e)=>{ ensure(); return contractRewardOf(e); },
    clearCorpEvent(i){ ensure(); if(state.corpEvents) { state.corpEvents.splice(i,1); save(); } },   // referee dismisses an opportunity after drafting/ignoring it
    agentById(id){ ensure(); return (state.agents||[]).find(a=>a.id===id)||null; },
    tradersOn(){ ensure(); return state.tradersOn!==false; },
    setTraders(v){ ensure(); state.tradersOn=!!v; save(); },
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
  };
})();

// ── Living Economy — referee console (panel + render) ───────────────────────
let econPanelOpen = false, econCollapsed = false;
let econRunSel = { from:'cypress', good:'Common Consumables', to:'aurelia', tons:30 };   // sticky cargo-run form
let econTraderSel = null;   // expanded trader detail (agent id) in the console
let econCorpSel = null;     // expanded corporation detail (corp id) — drawTrade highlights ALL its convoys
let econDraftSel = null;    // {i, item, contract} — a corp contract drafted from an opportunity, awaiting post
let econShockCfg = { weeks:6, severity:3 };   // sticky duration + severity for fired disruptions
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
function econStep(n){ window.econViewFrac=0; ECON.advance(n); renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh(); }
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
function econRaidConvoy(id){
  const r = ECON.raidConvoy(id);
  if(typeof showToast==='function'){
    if(r&&r.ok) showToast(`⚔ Convoy raided — ${r.agent} lost ${r.qty}kt ${r.good.replace('Common ','')} bound for ${r.to}`,'error');
    else showToast((r&&r.msg)||'No convoy','error');
  }
  renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh();
}
// ── Corporate contracts: draft a flagged opportunity, then post it to the Quest Log / Library Data ──
function econDraftContract(i){
  const ev = ECON.corpEvents()[i]; if(!ev) return;
  const item = ECON.contractItem(ev); if(!item || typeof draftCorpContract!=='function') return;
  econDraftSel = { i, item, contract: draftCorpContract(item) };
  renderEconPanel();
}
function econRerollContract(){ if(econDraftSel && typeof draftCorpContract==='function'){ econDraftSel.contract = draftCorpContract(econDraftSel.item); renderEconPanel(); } }
function econContractNote(msg){ const n=document.getElementById('econ-contract-note'); if(n){ n.textContent=msg; } }
function econContractToQuest(){
  if(!econDraftSel) return;
  const ok = (typeof spawnContractQuest==='function') && spawnContractQuest(econDraftSel.contract);
  if(ok){ if(typeof showToast==='function') showToast('📋 Contract posted to the Quest Log','success'); ECON.clearCorpEvent(econDraftSel.i); econDraftSel=null; renderEconPanel(); }
  else econContractNote('Quest Log unavailable');
}
function econContractToLibrary(){
  if(!econDraftSel) return;
  const ok = (typeof pushContractToLibrary==='function') && pushContractToLibrary(econDraftSel.contract);
  if(ok){ if(typeof showToast==='function') showToast('📋 Contract leaked to Library Data','success'); ECON.clearCorpEvent(econDraftSel.i); econDraftSel=null; renderEconPanel(); }
  else econContractNote('Library Data unavailable');
}
function econDismissContract(i){ ECON.clearCorpEvent(i); if(econDraftSel && econDraftSel.i===i) econDraftSel=null; renderEconPanel(); }

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
  h+=`<div style="padding:8px 10px;border-bottom:1px solid var(--bd0)"><div style="font-size:11px;color:var(--tx1);margin-bottom:4px">Fire a disruption</div>`;
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
      h+=`<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#e8a0a0;padding:2px 0"><span>⚡ ${s.label||s.kind}${ttl}</span><button onclick="econCancelShock(${i})" style="background:none;border:none;color:#e8a0a0;cursor:pointer">✕</button></div>`; }); }
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
  // Corporations — pooled-capital trading houses (identity · treasury · fleet · investments)
  { const corps=Object.values(ECON.corps()), wl=ECON.worlds(), ags=ECON.agents();
    if(corps.length){
      h+=`<div style="padding:8px 10px;border-bottom:1px solid var(--bd0)">`;
      h+=`<div style="font-size:11px;color:var(--tx1);margin-bottom:5px">Corporations — pooled capital</div>`;
      corps.sort((a,b)=>((a.defunct?1:0)-(b.defunct?1:0)) || (b.treasury-a.treasury)).forEach(c=>{
        const fleet=ags.filter(a=>a.backing===c.id).length, inv=(c.invests||[]).length;
        const col=c.color||'#ff9a3c', gcol=(typeof econGoodColor==='function')?econGoodColor(c.specialty):'#9fb0c8', spec=(''+c.specialty).replace('Common ','');
        const open = econCorpSel===c.id;
        h+=`<div onclick="econToggleCorp('${c.id}')" title="${escQH(c.name)} — click to highlight its ships &amp; see net-worth P&amp;L" style="padding:3px 0;border-top:1px solid var(--bd0);cursor:pointer${c.defunct?';opacity:.5':''}${open?';background:rgba(255,154,60,.08)':''}">`;
        h+=`<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:11px;color:#cdd6e0">`;
        h+=`<span><span style="color:var(--tx1)">${open?'▾':'▸'}</span> <span class="hx-tag" style="border-color:${col};color:${col};font-size:9px;padding:0 4px">${escQH(c.name.split(' ')[0])}</span> ${escQH(c.name)}${c.megacorp?' <span style="color:#9fd0ff;font-size:9px" title="Megacorp — safeguarded, never collapses">★</span>':''}${c.defunct?' <span style="color:var(--tx1);font-size:9px">(defunct)</span>':''}</span>`;
        h+=`<span style="color:${c.treasury>=0?'#7ec98f':'#e8a0a0'};white-space:nowrap">${econMoney(c.treasury)}</span></div>`;
        h+=`<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:10px;color:var(--tx1)">`;
        h+=`<span><span style="color:${gcol}">◆ ${escQH(spec)}</span>${c.home&&wl[c.home]?` · ${escQH(wl[c.home].label)}`:''}</span>`;
        h+=`<span style="white-space:nowrap">${fleet} ship${fleet===1?'':'s'} · ${inv} invest${inv===1?'':'s'}</span></div>`;
        h+=`</div>`;
        if(open) h+=econCorpDetailHTML(c);
      });
      h+=`<div style="font-size:10px;color:var(--tx1);margin-top:5px">Click a house to highlight its ships on the map &amp; see its net-worth P&amp;L. Corp ships trade profit-first anywhere (no territory); treasuries sweep ship profit, bail out losers, grow fleets, and fund world expansions. <b style="color:#9fd0ff">★</b> = the OmniSynth megacorp (safeguarded — never collapses).</div>`;
      h+=`</div>`;
    }
  }
  // Corporate contracts — jobs the houses would pay players for. The referee DRAFTS one into a
  // concrete contract, then posts it to the Quest Log (players track it) or leaks it to Library Data.
  { const evs=ECON.corpEvents();
    if(evs.length){
      const CICON={ escort:'🛡', haul:'📦', bounty:'🎯', sabotage:'⚔', espionage:'🕵' };
      h+=`<div style="padding:8px 10px;border-bottom:1px solid var(--bd0)">`;
      h+=`<div style="font-size:11px;color:var(--tx1);margin-bottom:5px">Corporate contracts <span style="color:var(--tx1);font-size:9px">— ${evs.length} on offer</span></div>`;
      evs.slice().reverse().forEach((ev)=>{ const i=evs.indexOf(ev); const it=ECON.contractItem(ev); if(!it) return;
        const col=it.color||'#9fd0ff', drafted=econDraftSel&&econDraftSel.i===i;
        const summ = it.contract==='sabotage'||it.contract==='espionage' ? `vs ${escQH(it.targetName||'a rival')}`
                   : it.contract==='haul' ? `→ ${escQH(it.place||'?')}`
                   : (it.vessel?`${escQH(it.vessel)}`:'') ;
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
          h+=`<span id="econ-contract-note" style="font-size:9px;color:#7ec98f;align-self:center"></span></div>`;
          h+=`</div>`;
        }
        h+=`</div>`;
      });
      h+=`<div style="font-size:10px;color:var(--tx1);margin-top:5px">Flagged from live corp activity — valuable convoys want escorts, raided houses post bounties, rivals pay for sabotage &amp; espionage (often against OmniSynth). Sabotage/bounty resolve with the ⚔ raid button on the target convoy.</div>`;
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


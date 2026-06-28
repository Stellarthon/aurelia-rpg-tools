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

  let worlds = null, adj = null, state = null;
  // Per-world prod/cons overrides authored in the Design Mode "Production & Consumption"
  // editor. Layered over the hardcoded DEF table by buildTopology() exactly like
  // contentOverrides layers over hardcoded narrative text — DEF is never mutated, so
  // "Revert" just drops the override. Keyed by GALAXY_NODES id. Persisted (referee-only)
  // to the shared econ-profiles row so every device resolves the same economy.
  let profiles = {};

  function nodeOf(id){ return (typeof GALAXY_NODES!=='undefined') ? GALAXY_NODES.find(n=>n.id===id) : null; }
  function isMarket(n){ return n && !NO_MARKET[n.faction]; }
  function curWeek(){ try { return Math.floor(imperialOrdinal(imperialDate)/7); } catch(e){ return 0; } }

  function buildTopology(){
    worlds = {}; adj = {};
    (typeof GALAXY_NODES!=='undefined'?GALAXY_NODES:[]).forEach(n=>{
      if(!isMarket(n)) return;
      const d = DEF[n.id] || DEFAULT;
      const ov = profiles[n.id];   // designer override (Design Mode economy editor) wins over DEF
      worlds[n.id] = { id:n.id, label:n.label||n.name, fac:n.faction,
                       prod:(ov&&ov.prod)?ov.prod:(d.prod||{}),
                       cons:(ov&&ov.cons)?ov.cons:(d.cons||{}),
                       safW:d.safW||2, store:d.store||{} };
      adj[n.id] = [];
    });
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
    // active:false → a fresh campaign defaults to the SIMPLE economy (static per-world
    // produces/demands pricing via simplePressure(); no stepping, no logistics). The
    // referee opts INTO the full multi-tier simulation with the Living-economy toggle,
    // which persists active:true to the shared econ-state row. NB a persisted row's
    // active flag overrides this default on load (Object.assign(freshState(),parsed)),
    // so existing campaigns keep whatever mode they saved until the referee toggles.
    return { week: wk, active:false, stock, transit, shocks:[], log:[], history:[], base, agents: freshAgents(), tradersOn:true };
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
  const AGENT_VALUE = { 'Common Consumables':50,'Common Ore':40,'Common Electronics':300,'Common Manufactured':200,'Advanced Electronics':1200 }; // notional Cr/kt at par
  const AGENT_START_CAP = 40000, AGENT_CAP_QTY = 12, AGENT_SPREAD_MIN = 4;
  function agentUnitPrice(good, p){ return (AGENT_VALUE[good]||100) * (1 - (p||0)*0.08); }  // cheaper when glutted (p>0), dearer when short (p<0)
  function freshAgents(){ return AGENT_NAMES.map((nm,i)=>({ id:'tr'+i, name:nm, cap:AGENT_START_CAP, pos:null, route:null, trips:0, profit:0 })); }

  function agentsStep(week){
    if(!state.agents || state.tradersOn===false) return;
    const blk = blocked(), goods = SIM_GOODS.filter(g=>!GOODS[g].internal);
    // Pool the imbalanced worlds per good once (cheap — empty at baseline).
    const pool = {};
    goods.forEach(g=>{ const sur=[], sho=[];
      Object.keys(worlds).forEach(id=>{ if(blk[id]) return; const p=pressure(id,g); if(p==null) return;
        // Source only from NON-producer gluts: consumer worlds that overshot above their
        // baseline. Producer surplus is already allocated optimally (neediest-first) by
        // replenishment, so skimming it just misallocates and starves other worlds.
        if(p>=2 && !worlds[id].prod[g]){ const room=stk(id,g)-refOf(id,g); if(room>0) sur.push({id,p,room}); }
        else if(p<=-2){ const room=refOf(id,g)-stk(id,g); if(room>0) sho.push({id,p,room}); } });
      pool[g]={sur,sho}; });
    // Arrivals: bank profit & reposition (the cargo itself lands via state.transit).
    state.agents.forEach(a=>{ if(a.route && a.route.eta<=week){
      const sp=pressure(a.route.to,a.route.good), sellUnit=agentUnitPrice(a.route.good, sp!=null?sp:0);
      a.cap += a.route.qty*sellUnit; a.profit += Math.round(a.route.qty*(sellUnit-a.route.buyUnit));
      a.trips++; a.pos=a.route.to; a.route=null; } });
    // Idle agents pick the best spread/short-haul edge; pool rooms are decremented so
    // agents spread across opportunities instead of all stacking the same lane.
    state.agents.forEach(a=>{ if(a.route) return;
      let best=null;
      goods.forEach(g=>{ const P=pool[g]; if(!P.sur.length||!P.sho.length) return;
        P.sur.forEach(b=>{ if(b.room<=0) return; const D=dist(b.id,blk);
          P.sho.forEach(s=>{ if(s.room<=0||s.id===b.id||D[s.id]==null||embargoed(b.id,s.id)) return;
            const spread=b.p-s.p; if(spread<AGENT_SPREAD_MIN) return;
            const score=spread/Math.max(1,D[s.id]);
            if(!best||score>best.score) best={b,s,g,dist:D[s.id],score}; }); }); });
      if(!best) return;
      const buyUnit=agentUnitPrice(best.g,best.b.p);
      let qty=Math.min(AGENT_CAP_QTY,best.b.room,best.s.room);
      if(buyUnit>0) qty=Math.min(qty,Math.floor(a.cap/buyUnit));
      qty*=tariffMult(best.b.id,best.s.id,best.g);                    // tariff prices the convoy down at the border
      qty=Math.round(qty*100)/100; if(qty<0.5) return;
      setStk(best.b.id,best.g, stk(best.b.id,best.g)-qty); a.cap-=qty*buyUnit;
      state.transit.push({ good:best.g, qty, from:best.b.id, to:best.s.id, eta:week+Math.max(1,best.dist), agent:a.id });
      a.route={ from:best.b.id, to:best.s.id, good:best.g, qty, buyUnit, began:week, eta:week+Math.max(1,best.dist) };
      a.pos=best.b.id; best.b.room-=qty; best.s.room-=qty;
      log(week, `${a.name}: ${qty}kt ${best.g.replace('Common ','')} ${worlds[best.b.id].label}→${worlds[best.s.id].label}`);
    });
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
    const i = state.transit.findIndex(t=> t.agent===a.id && t.good===r.good && t.from===r.from && t.to===r.to);
    if(i>=0) state.transit.splice(i,1);            // cargo lost → never lands → destination stays short
    const loss = Math.round(r.qty * r.buyUnit);    // sunk purchase cost (cap already paid at dispatch)
    a.profit -= loss; a.raided = (a.raided||0)+1; a.pos = r.from; a.route = null;   // survivor limps home empty
    log(state.week, `⚔ Convoy raided — ${a.name} lost ${r.qty}kt ${r.good.replace('Common ','')} on ${worlds[r.from]?worlds[r.from].label:r.from}→${worlds[r.to]?worlds[r.to].label:r.to}`);
    save();
    return { ok:true, agent:a.name, good:r.good, qty:r.qty, to:(worlds[r.to]?worlds[r.to].label:r.to), loss };
  }

  function step(week){
    state.shocks = state.shocks.filter(s=> s.until==null || s.until>=week);
    const blk = blocked();
    const land = []; state.transit = state.transit.filter(t=>{ if(t.eta<=week){ land.push(t); return false; } return true; });
    land.forEach(t=> setStk(t.to,t.good, stk(t.to,t.good)+t.qty));

    Object.values(worlds).forEach(w=>{
      for(const g in w.prod){
        const cap = w.prod[g] * outputFactor(w.id, g);
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
    agentsStep(week);            // autonomous Independents arbitrage the resulting price gaps
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
    (state.agents||[]).forEach(a=>{ a.route=null; });                            // in-flight convoys would have landed ages ago
    state.week = wk;
  }
  function advance(weeks){ ensure(); const target = state.week + Math.max(1, Math.round(weeks));
    if(target - state.week > MAX_CATCHUP) reseedTo(target);                       // gap too large to step — snap to resting baseline
    else for(let wk=state.week+1; wk<=target; wk++) step(wk);
    save(); }
  function syncToDate(){ ensure(); const now=curWeek();
    if(now>state.week && state.active){
      if(now - state.week > MAX_CATCHUP) reseedTo(now);                           // gap too large to step — snap to resting baseline
      else for(let wk=state.week+1; wk<=now; wk++) step(wk);
      save(); }
    else if(now!==state.week){ state.week=now; } }

  // Price pressure = signed deviation of current stock from this world+good's own
  // settled equilibrium (state.base). 0 = at its normal level (steady baseline for
  // every world regardless of how high or low it naturally rests); negative = drawn
  // down below normal → dearer; positive = glutted above normal → cheaper. A shock
  // that thins a buffer reads as real dearness immediately, propagating down a trade
  // spine and decaying with distance, so the sim "moves" at the player trade console.
  // Self-calibrating from the deterministic baseline → identical prices on every device.
  function pressure(id, good){
    if(!state || !state.active || !worlds || !worlds[id] || GOODS[good]==null) return null;
    const w = worlds[id]; if(!(w.cons[good]||w.prod[good]||recipeDraw(w,good))) return null;
    const ref = (state.base && state.base[id] && state.base[id][good]) || 0;
    // Only price worlds that hold a real working stock of this good (≥~1wk of normal
    // cover). Isolated frontier worlds the trade network never reaches settle to ~nothing
    // — they aren't a market in the sim's goods, so they keep riding the existing seeded
    // noise (return null) instead of reading a phantom permanent crisis.
    if(ref < Math.max(1, demandFor(w,good))) return null;
    return Math.max(-4, Math.min(4, Math.round((stk(id,good)/ref - 1)*8)));
  }

  async function load(){ try { ensure(); const r = await supaStorage.get('econ-state', true);
    if(r.value!=null){ state = Object.assign(freshState(), JSON.parse(r.value)); } } catch(e){} }
  function save(){ try { if(typeof isReferee==='function' && !isReferee()) return;
    supaStorage.set('econ-state', JSON.stringify({ week:state.week, active:state.active, stock:state.stock, transit:state.transit, shocks:state.shocks, log:state.log, history:state.history, agents:state.agents, tradersOn:state.tradersOn }), true); } catch(e){} }
  function reset(){ const wasActive = !!(state && state.active); state = freshState(); state.active = wasActive; save(); }   // reseed stock; keep the current Simple/Full mode

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
    const goods = SIM_GOODS.filter(g=>!GOODS[g].internal);
    Object.keys(worlds).forEach(id=>{ goods.forEach(g=>{
      const p = pressure(id,g); if(p==null) return;
      if(p<=-2) out.push({ kind:'shortage', world:id, label:worlds[id].label, good:g, pressure:p });
      else if(p>=3) out.push({ kind:'glut', world:id, label:worlds[id].label, good:g, pressure:p });
    }); });
    out.sort((a,b)=>{ const r=x=> x.kind==='shock'?0:1;
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
  function defProfileOf(id){ const d = DEF[id] || DEFAULT; return { prod: d.prod||{}, cons: d.cons||{} }; }
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
    stock: stk, safety:(id,g)=>{ ensure(); return worlds[id]?safety(worlds[id],g):0; },
    agents(){ ensure(); return state.agents||[]; },
    tradersOn(){ ensure(); return state.tradersOn!==false; },
    setTraders(v){ ensure(); state.tradersOn=!!v; save(); },
    raidConvoy, syncLanes, disconnected,
  };
})();

// ── Living Economy — referee console (panel + render) ───────────────────────
let econPanelOpen = false, econCollapsed = false;
let econRunSel = { from:'cypress', good:'Common Consumables', to:'aurelia', tons:30 };   // sticky cargo-run form
const ECON_WATCH = ['erebus','profit-margin','graveyard','kronos','the-anvil','castor','cypress','the-garden','bastion','sol','aurelia','vesta','avalon','warehouse'];

function toggleEconPanel(){
  if(typeof isReferee==='function' && !isReferee()){ if(typeof showToast==='function') showToast('Referee only','error'); return; }
  econPanelOpen = !econPanelOpen;
  const w=document.getElementById('econ-wrap'), b=document.getElementById('econ-btn');
  if(w) w.classList.toggle('hidden', !econPanelOpen);
  if(b) b.classList.toggle('panel-open', econPanelOpen);
  if(econPanelOpen) renderEconPanel();
}
function toggleEconCollapse(){
  econCollapsed=!econCollapsed;
  const t=document.getElementById('econ-toggle'); if(t) t.textContent=econCollapsed?'▲':'▼';
  const b=document.getElementById('econ-body'); if(b) b.classList.toggle('hidden', econCollapsed);
}
function econFireById(id){ const p=ECON.PRESETS.find(x=>x.id===id); if(p){ ECON.fire(p); renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh(); } }
function econStep(n){ ECON.advance(n); renderEconPanel(); if(currentView==='galaxy'&&typeof HX!=='undefined') HX.refresh(); }
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

// ── Economy editor (Design Mode · Production & Consumption) ─────────────────
// Edits a world's prod/cons via ECON's profile-override layer, with recipe-aware
// auto-input display, a full upstream chain preview, and a live Market Impact summary.
// Commit re-settles the galactic baseline (ECON.setProfile); Revert drops the override.
const ECON_GOOD_COL = {   // mirrors HX's GOOD_COL so good chips read consistently across the app
  'Common Consumables':'#5fb87a','Common Ore':'#b07a4a','Common Electronics':'#4a90d9',
  'Common Manufactured':'#8a9bb5','Advanced Electronics':'#3fd0d0','Precious Metals':'#e0c040',
  'Radioactives':'#9fd44a','Biochemicals':'#3faf8f','Luxury Goods':'#c060c0','Pharmaceuticals':'#e07090'
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
  h += `<button class="design-add-btn" style="width:100%" onclick="openEconEditor('${nodeId}')">⚒ Edit production &amp; consumption</button></div>`;
  return h;
}
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
    h+=btn('Step +1 wk','econStep(1)'); h+=btn('+4 wks','econStep(4)'); h+=btn('Reset','econReset()');
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
    h+=`<tr style="border-top:1px solid var(--bd0)"><td style="padding:3px 4px;color:var(--tx0)">${w.label}</td><td style="padding:3px 4px;color:var(--tx1)">${tg.replace('Common ','')}</td><td style="padding:3px 4px;text-align:right;color:${cc}">${tc.toFixed(1)} wk</td><td style="padding:3px 4px;text-align:right;color:${pc}">${ptxt}</td></tr>`;
  });
  h+=`</table></div>`;
  // Traders — autonomous Independent merchants arbitraging price gaps
  { const on=ECON.tradersOn(), wl=ECON.worlds(), money=n=>{ n=Math.round(n); const s=n<0?'−':''; const a=Math.abs(n); return s+(a>=1000?'Cr'+(a/1000).toFixed(a>=10000?0:1).replace(/\.0$/,'')+'k':'Cr'+a); };
    h+=`<div style="padding:8px 10px;border-bottom:1px solid var(--bd0)">`;
    h+=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px"><span style="font-size:11px;color:var(--tx1)">Traders — Independents</span>`;
    h+=btn(on?'● ON':'○ OFF','econToggleTraders()', on?'background:#1d4a33;border-color:#3f9d5a;color:#bfeacb':'');
    h+=`</div>`;
    ECON.agents().forEach(a=>{
      const onRoute = a.route && wl[a.route.from] && wl[a.route.to];
      const rt = onRoute
        ? `<span style="color:#7ec0e0">hauling ${a.route.good.replace('Common ','')} ${escQH(wl[a.route.from].label)}→${escQH(wl[a.route.to].label)} · arr wk ${a.route.eta}</span>`
        : `<span style="color:var(--tx1)">surveying</span>`;
      const pc = a.profit>=0?'#7ec98f':'#e87a7a';
      const raidBtn = onRoute ? `<button onclick="econRaidConvoy('${a.id}')" title="Intercept this convoy — cargo lost, destination denied relief (RSC raider threat)" style="background:none;border:1px solid #6a2a2a;color:#e8a0a0;border-radius:5px;padding:1px 6px;font-size:10px;cursor:pointer;margin-left:6px">⚔ raid</button>` : '';
      const raided = a.raided ? `<span style="color:#e8a0a0;font-size:10px"> · ${a.raided}⚔</span>` : '';
      h+=`<div style="font-size:11px;color:#cdd6e0;padding:1px 0;display:flex;justify-content:space-between;gap:10px;align-items:center"><span>${escQH(a.name)} · ${rt}${raidBtn}</span><span style="color:${pc};white-space:nowrap">${a.trips} trips${raided} · ${money(a.profit)}</span></div>`;
    });
    h+=`<div style="font-size:10px;color:var(--tx1);margin-top:4px">Idle at baseline; they swarm to arbitrage shock-driven price gaps, easing shortages as they go.</div>`;
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
  h+=`<div style="padding:8px 10px"><div style="font-size:11px;color:var(--tx1);margin-bottom:4px">Cascade log</div>`;
  if(!st.log.length) h+=`<div style="font-size:11px;color:var(--tx1)">No shortages yet — fire a shock and step the sim.</div>`;
  else st.log.slice(0,24).forEach(e=> h+=`<div style="font-size:11px;color:#cdd6e0;padding:1px 0">wk ${e.week} · ${e.text}</div>`);
  h+=`</div>`;
  body.innerHTML=h;
}

ECON.load().then(() => ECON.loadProfiles()).then(() => { if(econPanelOpen) renderEconPanel(); if(currentView === 'galaxy' && typeof HX !== 'undefined') HX.refresh(); });


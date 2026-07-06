// ═══════════════════════════════════════════════════════════════════════════
// TRADE RUN — Station Trade desk + Starport Board (freight / passengers / mail)
// ───────────────────────────────────────────────────────────────────────────
// Needs loaded before it: 00 (helpers), 10 (HX.localMarket/worldFacts/hexOf),
// 50 (supaStorage, via the funds/cargo save paths), 55 (isReferee/canSee),
// 70 (panel drag/resize + escQH), 75 (shipState), 85 (funds ledger,
// trade-cargo manifest, imperial date, fmtCr), 90 (ECON — optional at runtime).
//
// STATION TRADE is a REFEREE TOOL: players never get a buy/sell UI — their
// market intel stays the fog-of-price readout on the hex map. It looks up the
// local market (trade-code Purchase/Sale DMs + live pressure, shown as
// REFERENCE ONLY) and records deals already resolved at the table with dice —
// nothing here rolls or auto-resolves a trade. Recording a deal writes the
// funds ledger (shared key 'funds', imperial-dated) and the cargo manifest
// (shared key 'trade-cargo') in one step, riding the existing save paths and
// polls.
//
// STARPORT BOARD is diegetic — a public posting board, so players get a
// read-only view. The referee generates it per MgT2e RAW (Passenger/Freight
// Traffic 2D tables, mail 12+; these are the referee's own world-simulation
// rolls, same precedent as the Oracle generators). Player-side checks (Broker/
// Carouse/Streetwise Effect, Steward, ranks) are rolled AT THE TABLE and typed
// in as inputs. Accepting a lot / booking a passage is referee-executed and
// writes funds + cargo/passenger records. Shared key 'starport-board'.
// ═══════════════════════════════════════════════════════════════════════════

let tradePanelOpen = false, tradeCollapsed = false;
// Sticky deal form (survives re-renders, like econRunSel).
let tradeDeal = { mode: 'buy', good: '', tons: '', cr: '', lotId: '' };
let _tradeMktRows = [];   // last-rendered market rows, index → row (tap-to-fill)

function toggleTradePanel(){
  if(!tradePanelOpen && typeof isReferee === 'function' && !isReferee()){
    if(typeof showToast === 'function') showToast('Referee only', 'info'); return;
  }
  tradePanelOpen = !tradePanelOpen;
  const w = document.getElementById('trade-wrap'), b = document.getElementById('trade-btn');
  if(!w) return;
  w.classList.toggle('hidden', !tradePanelOpen);
  if(b) b.classList.toggle('panel-open', tradePanelOpen);
  if(tradePanelOpen) renderTradePanel();
}
function toggleTradeCollapse(){
  const h = document.getElementById('trade-header');
  if(h && h.dataset.suppressClick === '1') return;
  tradeCollapsed = !tradeCollapsed;
  document.getElementById('trade-toggle').textContent = tradeCollapsed ? '▲' : '▼';
  document.getElementById('trade-body').classList.toggle('collapsed', tradeCollapsed);
  document.getElementById('trade-wrap').classList.toggle('panel-collapsed', tradeCollapsed);
}

// Compact credits (mirrors the map's kCr, which is closure-scoped in HX).
function trdCr(n){ n = Math.round(Number(n) || 0); const a = Math.abs(n);
  if(a >= 1e6) return 'Cr' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if(a >= 1e3) return 'Cr' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return 'Cr' + n; }
function tradeHoldUsed(){
  const lots = (typeof tradeCargo !== 'undefined' && tradeCargo && Array.isArray(tradeCargo.lots)) ? tradeCargo.lots : [];
  return lots.reduce((s, l) => s + (Number(l.tons) || 0), 0);
}

// ── Sticky-form plumbing ─────────────────────────────────────────────────────
function tradeSetMode(m){ tradeDeal.mode = m === 'sell' ? 'sell' : 'buy'; tradeDeal.lotId = ''; renderTradePanel(); }
function tradeInput(field, value){
  if(field in tradeDeal) tradeDeal[field] = value;
  const t = document.getElementById('trd-total');   // live total without a full re-render (keeps typing focus)
  if(t) t.innerHTML = tradeTotalHTML();
}
function tradePickRow(i){
  const r = _tradeMktRows[i]; if(!r) return;
  tradeDeal.good = r.good;
  tradeDeal.cr = String(Math.round(tradeDeal.mode === 'sell' ? r.sellP : r.buyP));
  renderTradePanel();
}
function tradeSetLot(id){
  tradeDeal.lotId = id || '';
  if(id && typeof tradeCargo !== 'undefined'){
    const lot = (tradeCargo.lots || []).find(l => l.id === id);
    if(lot){ tradeDeal.good = lot.good; tradeDeal.tons = String(lot.tons); }
  }
  renderTradePanel();
}
function tradeTotalHTML(){
  const tons = Math.max(0, Number(tradeDeal.tons) || 0), cr = Math.max(0, Number(tradeDeal.cr) || 0);
  if(!(tons > 0 && cr > 0)) return '<span style="opacity:.55">Enter dtons and Cr/dt</span>';
  const total = Math.round(tons * cr);
  let margin = '';
  if(tradeDeal.mode === 'sell' && tradeDeal.lotId && typeof tradeCargo !== 'undefined'){
    const lot = (tradeCargo.lots || []).find(l => l.id === tradeDeal.lotId);
    if(lot && Number(lot.buyCr) > 0){
      const m = Math.round(tons * (cr - Number(lot.buyCr)));
      margin = ` · <span style="color:${m >= 0 ? '#4CAF50' : '#d45050'}">${m >= 0 ? '+' : '−'}${trdCr(Math.abs(m))} vs cost</span>`;
    }
  }
  return `${tradeDeal.mode === 'buy' ? '−' : '+'}<b>${trdCr(total)}</b> party fund${margin}`;
}

// ── Record a deal the table has already resolved ────────────────────────────
function tradeRecordDeal(){
  if(typeof isReferee === 'function' && !isReferee()){ if(typeof showToast === 'function') showToast('Referee only', 'error'); return; }
  const good = (tradeDeal.good || '').trim();
  const tons = Math.max(0, Number(tradeDeal.tons) || 0);
  const cr = Math.max(0, Number(tradeDeal.cr) || 0);
  if(!good || tons <= 0 || cr <= 0){ if(typeof showToast === 'function') showToast('Fill in good, dtons and Cr/dt first', 'error'); return; }
  const total = Math.round(tons * cr);
  const mkt = (typeof HX !== 'undefined' && HX.localMarket) ? HX.localMarket() : null;
  const where = mkt ? mkt.label : (shipState && shipState.origin) || '';
  if(typeof normalizeFunds === 'function') normalizeFunds();

  if(tradeDeal.mode === 'buy'){
    funds.party = (Number(funds.party) || 0) - total;
    fundsLog('party', -total, `Bought ${tons} dt ${good} @ ${trdCr(cr)}/dt — ${where}`);
    tradeCargo.lots = tradeCargo.lots || [];
    tradeCargo.lots.push({
      id: 'lot_' + Date.now().toString(36), good, tons, buyCr: cr, world: where,
      date: (typeof imperialNow === 'function' && typeof formatImperial === 'function') ? formatImperial(imperialNow()) : ''
    });
  } else {
    funds.party = (Number(funds.party) || 0) + total;
    fundsLog('party', total, `Sold ${tons} dt ${good} @ ${trdCr(cr)}/dt — ${where}`);
    if(tradeDeal.lotId){   // draw the sold tonnage down from the linked hold lot
      const lot = (tradeCargo.lots || []).find(l => l.id === tradeDeal.lotId);
      if(lot){
        lot.tons = Math.max(0, (Number(lot.tons) || 0) - tons);
        if(lot.tons <= 0) tradeCargo.lots = tradeCargo.lots.filter(l => l.id !== tradeDeal.lotId);
      }
    }
  }
  saveFunds(); saveTradeCargo();
  if(typeof showToast === 'function') showToast(`${tradeDeal.mode === 'buy' ? 'Purchase' : 'Sale'} recorded — ${trdCr(total)}`);
  tradeDeal.tons = ''; tradeDeal.cr = ''; tradeDeal.lotId = '';
  renderTradePanel();
  if(typeof fundsPanelOpen !== 'undefined' && fundsPanelOpen && typeof renderFundsPanel === 'function') renderFundsPanel();
  if(typeof cargoPanelOpen !== 'undefined' && cargoPanelOpen && typeof renderCargoPanel === 'function') renderCargoPanel();
}

// ── Render ──────────────────────────────────────────────────────────────────
function tradePressureChip(p){
  if(p >= 2)  return `<span class="trd-sig trd-sig-glut" title="Locally abundant — cheaper to buy, weak to sell">▼ glut</span>`;
  if(p <= -2) return `<span class="trd-sig trd-sig-scarce" title="Locally scarce — dearer to buy, strong to sell">▲ scarce</span>`;
  return `<span class="trd-sig trd-sig-flat">steady</span>`;
}
function renderTradePanel(){
  const body = document.getElementById('trade-body'); if(!body) return;
  if(typeof isReferee === 'function' && !isReferee()){ body.innerHTML = `<div class="cal-empty">Referee tool.</div>`; return; }
  const mkt = (typeof HX !== 'undefined' && HX.localMarket) ? HX.localMarket() : null;
  if(!mkt){ body.innerHTML = `<div class="cal-empty">No current location — set the ship's position on the galaxy map.</div>`; return; }
  const dateStr = (typeof formatImperial === 'function' && typeof imperialDate !== 'undefined') ? formatImperial(imperialDate) : '';
  if(mkt.noMarket){
    body.innerHTML = `<div class="fund-card"><div class="fund-lbl">📍 ${escQH(mkt.label)}</div>
      <div class="trd-note">No open market — ${escQH(mkt.faction || 'this region')} keeps no commercial trade here. Deals, if any, are pure roleplay.</div></div>`;
    return;
  }

  // Head card — where, when, and what the numbers mean.
  let h = `<div class="fund-card"><div class="fund-lbl">📍 ${escQH(mkt.label)} · Port ${escQH(mkt.port || '?')} · ${escQH((mkt.codes || []).join(' ') || '—')}</div>
    <div class="trd-note">Local market as of <b>${escQH(dateStr)}</b>. Indicative prices at the 3D average, party Broker-${mkt.broker} vs counterparty Broker-2.
    <b>The real price is rolled at the table</b> (3D6 + Broker + Purchase DM − Sale DM, minus the other side's Broker) — DMs below are reference, nothing here rolls.</div></div>`;

  // Market table — stocked goods first, everything else sell-side only.
  const rows = (mkt.rows || []).slice().sort((a, b) => (b.availHere - a.availHere));
  _tradeMktRows = rows;
  h += `<div class="fund-lbl">Local market — tap a line to fill the deal form</div><table class="trd-tbl"><thead><tr>
    <th style="text-align:left">Good</th><th>Buy DM</th><th>Sell DM</th><th>Mkt</th><th>~Buy</th><th>~Sell</th></tr></thead><tbody>`;
  rows.forEach((r, i) => {
    const dm = v => v > 0 ? '+' + v : String(v);
    h += `<tr class="trd-row${r.availHere ? '' : ' trd-row-dim'}" onclick="tradePickRow(${i})">
      <td class="trd-good">${escQH(r.good)}${r.availHere ? '' : ' <span class="trd-nostock">not stocked</span>'}</td>
      <td>${dm(r.buyDM)}</td><td>${dm(r.sellDM)}</td><td>${tradePressureChip(r.pressure)}</td>
      <td class="trd-buy">${r.availHere ? trdCr(r.buyP) : '—'}</td><td class="trd-sell">${trdCr(r.sellP)}</td></tr>`;
  });
  h += `</tbody></table>`;

  // Deal recorder — writes the outcome the dice already decided.
  const lots = (typeof tradeCargo !== 'undefined' && tradeCargo && Array.isArray(tradeCargo.lots)) ? tradeCargo.lots : [];
  const datalist = `<datalist id="trd-goods">${rows.map(r => `<option value="${escQH(r.good)}">`).join('')}</datalist>`;
  const lotSel = tradeDeal.mode === 'sell' && lots.length ? `
    <select class="trd-lot-sel" onchange="tradeSetLot(this.value)">
      <option value="">— sale not from a tracked lot —</option>
      ${lots.map(l => `<option value="${escQH(l.id)}"${l.id === tradeDeal.lotId ? ' selected' : ''}>${escQH(l.good)} · ${Number(l.tons) || 0} dt @ ${trdCr(l.buyCr)}/dt</option>`).join('')}
    </select>` : '';
  h += `<div class="fund-card">${datalist}
    <div class="fund-lbl">Record a deal struck at the table</div>
    <div class="fund-row">
      <button class="disc-mini${tradeDeal.mode === 'buy' ? ' trd-mode-on' : ''}" onclick="tradeSetMode('buy')">▼ Buy</button>
      <button class="disc-mini${tradeDeal.mode === 'sell' ? ' trd-mode-on' : ''}" onclick="tradeSetMode('sell')">▲ Sell</button>
      <input id="trd-good" class="fund-note" list="trd-goods" placeholder="Good" maxlength="40" value="${escQH(tradeDeal.good)}" oninput="tradeInput('good',this.value)">
    </div>
    ${lotSel}
    <div class="fund-row">
      <input class="fund-inp" type="number" inputmode="numeric" min="0" placeholder="dtons" value="${escQH(tradeDeal.tons)}" oninput="tradeInput('tons',this.value)">
      <input class="fund-inp" type="number" inputmode="numeric" min="0" placeholder="Cr / dton" value="${escQH(tradeDeal.cr)}" oninput="tradeInput('cr',this.value)">
      <span id="trd-total" class="trd-total">${tradeTotalHTML()}</span>
    </div>
    <div class="fund-row"><button class="cal-add-btn" onclick="tradeRecordDeal()">✍ Record ${tradeDeal.mode === 'buy' ? 'purchase — pay from' : 'sale — credit to'} party fund</button></div>
  </div>`;

  // Hold + fund footing.
  const used = tradeHoldUsed(), cap = Math.max(0, Number(shipState && shipState.cargoHold) || 0);
  const over = cap > 0 && used > cap;
  h += `<div class="trd-note">Hold ${used} / ${cap || '?'} dt${over ? ' <b style="color:#d45050">— over capacity</b>' : ''}
    · Party fund ${typeof fmtCr === 'function' ? fmtCr(funds && funds.party) : (funds && funds.party)}
    · Broker checks, haggling and the decision itself stay at the table.</div>`;
  body.innerHTML = h;
}

// ═══════════════════════════════════════════════════════════════════════════
// STARPORT BOARD — freight lots, passengers & mail on offer at the port
// ═══════════════════════════════════════════════════════════════════════════
// RAW: Core Update 2022 pp. 238–241. Passage & freight rates by parsecs
// travelled; traffic rolled 2D + DMs per SOURCE and DESTINATION world
// (population, starport, zone, TL for freight), −1 per parsec past the first.
// Zones aren't modelled on the map (known gap), so the referee sets them per
// generation. Lot sizes: Major 1D×10 dt, Minor 1D×5 dt, Incidental 1D dt.
// Mail: 2D ≥ 12 → 1D containers, 5 dt each, Cr25,000 flat, all or none.

const PASSAGE_RATES = {   // Cr per passage, by parsecs travelled
  1:{high:9000,  middle:6500,  basic:2000,  low:700},
  2:{high:14000, middle:10000, basic:3000,  low:1300},
  3:{high:21000, middle:14000, basic:5000,  low:2200},
  4:{high:34000, middle:23000, basic:8000,  low:3900},
  5:{high:60000, middle:40000, basic:14000, low:7200},
  6:{high:210000,middle:130000,basic:55000, low:27000},
};
const FREIGHT_RATES = { 1:1000, 2:1600, 3:2600, 4:4400, 5:8500, 6:32000 };   // Cr per ton, paid on delivery
const MAIL_CR = 25000;   // Cr per 5-dt container, flat regardless of distance
const PAX_CLASSES = [['high','High',-4],['middle','Middle',0],['basic','Basic',0],['low','Low',1]];
const FRT_SIZES   = [['major','Major',-4,10],['minor','Minor',0,5],['incidental','Incidental',2,1]];

let starBoard = { world:'', worldLabel:'', date:'', entries: [] };
let boardPanelOpen = false, boardCollapsed = false;
// Sticky generate form. Effects/skills are TABLE-ROLLED then typed in here;
// armed=null means "derive from the ship's weapon mounts".
let boardGen = { dest:'', srcZone:'green', destZone:'green', effPax:'0', steward:'0', effFrt:'0', navRank:'0', socDM:'0', armed:null };

async function loadStarportBoard(){
  try { const r = await supaStorage.get('starport-board', true);
    if(r.value != null){ const v = JSON.parse(r.value); if(v && Array.isArray(v.entries)) starBoard = v; } } catch(e){}
}
async function saveStarportBoard(){
  try { await supaStorage.set('starport-board', JSON.stringify(starBoard), true); }
  catch(e){ console.error('Starport board save failed:', e); }
}
function toggleBoardPanel(){
  boardPanelOpen = !boardPanelOpen;
  const w = document.getElementById('board-wrap'), b = document.getElementById('board-btn');
  if(!w) return;
  w.classList.toggle('hidden', !boardPanelOpen);
  if(b) b.classList.toggle('panel-open', boardPanelOpen);
  if(boardPanelOpen) renderBoardPanel();
}
function toggleBoardCollapse(){
  const h = document.getElementById('board-header');
  if(h && h.dataset.suppressClick === '1') return;
  boardCollapsed = !boardCollapsed;
  document.getElementById('board-toggle').textContent = boardCollapsed ? '▲' : '▼';
  document.getElementById('board-body').classList.toggle('collapsed', boardCollapsed);
  document.getElementById('board-wrap').classList.toggle('panel-collapsed', boardCollapsed);
}

// ── Dice + RAW DM tables ─────────────────────────────────────────────────────
function bd6(){ return 1 + Math.floor(Math.random() * 6); }
function bdD(n){ let s = 0; for(let i = 0; i < n; i++) s += bd6(); return s; }
function bdUid(){ return 'bd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
function bdPortDM(port){ return port === 'A' ? 2 : port === 'B' ? 1 : port === 'E' ? -1 : port === 'X' ? -3 : 0; }
// Per-world passenger DM: Pop ≤1 −4 · 6–7 +1 · 8+ +3; port A+2/B+1/E−1/X−3; Amber +1; Red −4.
function bdPaxWorldDM(f, zone){
  if(!f) return 0; let dm = 0; const p = f.pop | 0;
  if(p <= 1) dm -= 4; else if(p >= 8) dm += 3; else if(p >= 6) dm += 1;
  dm += bdPortDM(f.port);
  if(zone === 'amber') dm += 1; else if(zone === 'red') dm -= 4;
  return dm;
}
// Per-world freight DM: Pop ≤1 −4 · 6–7 +2 · 8+ +4; port as above; TL ≤6 −1 · TL 9+ +2; Amber −2; Red −6.
function bdFrtWorldDM(f, zone){
  if(!f) return 0; let dm = 0; const p = f.pop | 0;
  if(p <= 1) dm -= 4; else if(p >= 8) dm += 4; else if(p >= 6) dm += 2;
  dm += bdPortDM(f.port);
  const tl = f.tl | 0; if(tl <= 6) dm -= 1; else if(tl >= 9) dm += 2;
  if(zone === 'amber') dm -= 2; else if(zone === 'red') dm -= 6;
  return dm;
}
// Traffic tables (modified 2D → number of D6 to roll). Passenger: ≤1:0 · 2–3:1D ·
// 4–6:2D · 7–10:3D · 11–13:4D · 14–15:5D · 16:6D … 19:9D · 20+:10D.
function bdPaxDice(v){ return v <= 1 ? 0 : v <= 3 ? 1 : v <= 6 ? 2 : v <= 10 ? 3 : v <= 13 ? 4 : v <= 15 ? 5 : v >= 20 ? 10 : v - 10; }
// Freight: ≤1:0 · 2–3:1D · 4–5:2D · 6–8:3D · 9–11:4D · 12–14:5D · 15–16:6D · 17:7D … 20+:10D.
function bdFrtDice(v){ return v <= 1 ? 0 : v <= 3 ? 1 : v <= 5 ? 2 : v <= 8 ? 3 : v <= 11 ? 4 : v <= 14 ? 5 : v <= 16 ? 6 : v >= 20 ? 10 : v - 10; }

// Candidate destinations: market worlds within the 6-pc rate table.
function bdDestinations(){
  if(typeof HX === 'undefined' || !HX.hexOf) return [];
  const src = (typeof shipState !== 'undefined') ? shipState.locationId : null;
  const o = src ? HX.hexOf(src) : null; if(!o) return [];
  const out = [];
  (typeof GALAXY_NODES !== 'undefined' ? GALAXY_NODES : []).forEach(n => {
    if(n.id === src) return;
    try { if(typeof ECON !== 'undefined' && ECON.isMarketId && !ECON.isMarketId(n.id)) return; } catch(e){}
    const h = HX.hexOf(n.id); if(!h) return;
    const pc = (Math.abs(o.q - h.q) + Math.abs(o.r - h.r) + Math.abs(o.q + o.r - h.q - h.r)) / 2;
    if(pc >= 1 && pc <= 6) out.push({ id: n.id, label: n.label || n.name || n.id, pc });
  });
  return out.sort((a, b) => a.pc - b.pc || a.label.localeCompare(b.label));
}
function boardInput(field, value){ if(field in boardGen) boardGen[field] = value; }
function boardArmed(){
  if(boardGen.armed != null) return !!boardGen.armed;
  return !!(typeof shipState !== 'undefined' && Array.isArray(shipState.weapons) && shipState.weapons.length);
}

// ── Generate the board for one destination (referee) ───────────────────────
// The 2D traffic rolls are the referee's own world-simulation dice (Oracle
// precedent); the typed-in Effects came from checks rolled at the table.
function boardGenerate(){
  if(typeof isReferee === 'function' && !isReferee()){ if(typeof showToast === 'function') showToast('Referee only', 'error'); return; }
  const src = (typeof shipState !== 'undefined') ? shipState.locationId : null;
  const mkt = (typeof HX !== 'undefined' && HX.localMarket) ? HX.localMarket() : null;
  if(!src || !mkt){ if(typeof showToast === 'function') showToast('No current location', 'error'); return; }
  const dests = bdDestinations();
  const d = dests.find(x => x.id === boardGen.dest) || dests[0];
  if(!d){ if(typeof showToast === 'function') showToast('No market world within 6 pc', 'error'); return; }
  boardGen.dest = d.id;
  const sf = HX.worldFacts(src), df = HX.worldFacts(d.id);
  const distDM = -(d.pc - 1);
  const int0 = v => { const n = parseInt(v, 10); return isFinite(n) ? n : 0; };
  const effPax = int0(boardGen.effPax), steward = int0(boardGen.steward), effFrt = int0(boardGen.effFrt);
  const navRank = int0(boardGen.navRank), socDM = int0(boardGen.socDM), armed = boardArmed();
  const today = (typeof imperialNow === 'function' && typeof formatImperial === 'function') ? formatImperial(imperialNow()) : '';

  // A new port wipes the old port's postings (taken entries live on the ship's
  // books, not here); re-rolling the same destination replaces its open posts.
  if(starBoard.world !== src) starBoard = { world: src, worldLabel: mkt.label, date: today, entries: [] };
  starBoard.entries = starBoard.entries.filter(e => !(e.dest === d.id && e.status === 'open'));

  const paxBase = effPax + steward + bdPaxWorldDM(sf, boardGen.srcZone) + bdPaxWorldDM(df, boardGen.destZone) + distDM;
  PAX_CLASSES.forEach(([cls, lbl, cdm]) => {
    const roll = bdD(2), tot = roll + paxBase + cdm;
    const dice = bdPaxDice(tot), count = dice > 0 ? bdD(dice) : 0;
    if(count > 0) starBoard.entries.push({ id: bdUid(), kind: 'pax', sub: cls, dest: d.id, destLabel: d.label, pc: d.pc,
      count, taken: 0, fare: PASSAGE_RATES[d.pc][cls], status: 'open', roll, dm: paxBase + cdm, date: today });
  });
  const frtBase = effFrt + bdFrtWorldDM(sf, boardGen.srcZone) + bdFrtWorldDM(df, boardGen.destZone) + distDM;
  FRT_SIZES.forEach(([sub, lbl, cdm, mult]) => {
    const roll = bdD(2), tot = roll + frtBase + cdm;
    const dice = bdFrtDice(tot), lots = dice > 0 ? bdD(dice) : 0;
    for(let i = 0; i < lots; i++){
      const tons = bd6() * mult;   // Major 1D×10 · Minor 1D×5 · Incidental 1D
      starBoard.entries.push({ id: bdUid(), kind: 'freight', sub, dest: d.id, destLabel: d.label, pc: d.pc,
        tons, rate: FREIGHT_RATES[d.pc], pay: tons * FREIGHT_RATES[d.pc], status: 'open', roll, dm: frtBase + cdm, date: today });
    }
  });
  // Mail: bracket the net freight DM, 2D ≥ 12; 1D containers, all or none.
  const bracket = frtBase <= -10 ? -2 : frtBase <= -5 ? -1 : frtBase <= 4 ? 0 : frtBase <= 9 ? 1 : 2;
  const mailDM = bracket + (armed ? 2 : 0) + ((sf && (sf.tl | 0) <= 5) ? -4 : 0) + navRank + socDM;
  const mailRoll = bdD(2);
  if(mailRoll + mailDM >= 12){
    const n = bd6();
    starBoard.entries.push({ id: bdUid(), kind: 'mail', sub: 'mail', dest: d.id, destLabel: d.label, pc: d.pc,
      count: n, tons: n * 5, pay: n * MAIL_CR, status: 'open', roll: mailRoll, dm: mailDM, date: today });
  }
  starBoard.date = today;
  saveStarportBoard(); renderBoardPanel();
  if(typeof showToast === 'function') showToast('Board posted — ' + starBoard.worldLabel + ' → ' + d.label);
}
function boardClear(){
  if(typeof isReferee === 'function' && !isReferee()) return;
  starBoard.entries = starBoard.entries.filter(e => e.status !== 'open');
  saveStarportBoard(); renderBoardPanel();
}

// ── Referee accepts a posting (checks already rolled at the table) ──────────
function boardAccept(id){
  if(typeof isReferee === 'function' && !isReferee()){ if(typeof showToast === 'function') showToast('Referee only', 'error'); return; }
  const e = starBoard.entries.find(x => x.id === id);
  if(!e || e.status !== 'open') return;
  const today = (typeof imperialNow === 'function' && typeof formatImperial === 'function') ? formatImperial(imperialNow()) : '';
  if(typeof normalizeFunds === 'function') normalizeFunds();

  if(e.kind === 'pax'){
    // Book k of the remaining seats; fares are collected on boarding.
    const inp = document.getElementById('bd-take-' + e.id);
    const remaining = (Number(e.count) || 0) - (Number(e.taken) || 0);
    let k = inp ? parseInt(inp.value, 10) : remaining;
    k = Math.max(1, Math.min(isFinite(k) ? k : remaining, remaining));
    e.taken = (Number(e.taken) || 0) + k;
    if(e.taken >= e.count) e.status = 'taken';
    shipState.passengers = Array.isArray(shipState.passengers) ? shipState.passengers : [];
    shipState.passengers.push({ id: 'pax_' + Date.now().toString(36), cls: e.sub, count: k, dest: e.dest, destLabel: e.destLabel, fare: e.fare, date: today });
    const total = k * e.fare;
    funds.party = (Number(funds.party) || 0) + total;
    fundsLog('party', total, `${k}× ${e.sub} passage to ${e.destLabel} — fares collected at ${starBoard.worldLabel}`);
    saveShipState(); saveFunds();
  } else {
    // Freight & mail ride in the hold and PAY ON DELIVERY (RAW) — the lot goes
    // on the cargo manifest now, the credits land when it's delivered.
    e.status = 'taken';
    tradeCargo.lots = tradeCargo.lots || [];
    tradeCargo.lots.push({
      id: 'lot_' + Date.now().toString(36),
      good: e.kind === 'mail' ? `Mail — ${e.count} container${e.count > 1 ? 's' : ''} → ${e.destLabel}` : `Freight (${e.sub}) → ${e.destLabel}`,
      tons: e.tons, buyCr: 0, world: starBoard.worldLabel, date: today,
      kind: e.kind, dest: e.dest, destLabel: e.destLabel, pay: e.pay
    });
    saveTradeCargo();
  }
  saveStarportBoard(); renderBoardPanel();
  if(typeof showToast === 'function') showToast(e.kind === 'pax' ? 'Passage booked' : 'Contract accepted — pays on delivery');
  if(typeof fundsPanelOpen !== 'undefined' && fundsPanelOpen && typeof renderFundsPanel === 'function') renderFundsPanel();
  if(typeof cargoPanelOpen !== 'undefined' && cargoPanelOpen && typeof renderCargoPanel === 'function') renderCargoPanel();
  if(typeof shipPanelOpen !== 'undefined' && shipPanelOpen && typeof renderShipPanel === 'function') renderShipPanel();
}

// ── Delivery / disembark (referee, from the Aboard manifest) ────────────────
function boardDeliver(lotId){
  if(typeof isReferee === 'function' && !isReferee()) return;
  const lot = (tradeCargo.lots || []).find(l => l.id === lotId);
  if(!lot || !(lot.kind === 'freight' || lot.kind === 'mail')) return;
  if(typeof normalizeFunds === 'function') normalizeFunds();
  const pay = Math.round(Number(lot.pay) || 0);
  funds.party = (Number(funds.party) || 0) + pay;
  fundsLog('party', pay, `Delivered: ${lot.good} (${lot.tons} dt)`);
  tradeCargo.lots = tradeCargo.lots.filter(l => l.id !== lotId);
  saveFunds(); saveTradeCargo(); renderBoardPanel();
  if(typeof showToast === 'function') showToast('Delivered — ' + trdCr(pay) + ' collected');
  if(typeof fundsPanelOpen !== 'undefined' && fundsPanelOpen && typeof renderFundsPanel === 'function') renderFundsPanel();
  if(typeof cargoPanelOpen !== 'undefined' && cargoPanelOpen && typeof renderCargoPanel === 'function') renderCargoPanel();
  if(typeof shipPanelOpen !== 'undefined' && shipPanelOpen && typeof renderShipPanel === 'function') renderShipPanel();
}
function boardDisembark(paxId){
  if(typeof isReferee === 'function' && !isReferee()) return;
  const pax = Array.isArray(shipState.passengers) ? shipState.passengers : [];
  shipState.passengers = pax.filter(p => p.id !== paxId);
  saveShipState(); renderBoardPanel();
  if(typeof shipPanelOpen !== 'undefined' && shipPanelOpen && typeof renderShipPanel === 'function') renderShipPanel();
}

// ── Render ──────────────────────────────────────────────────────────────────
function bdKindChip(e){
  if(e.kind === 'pax') return `<span class="bd-chip bd-chip-pax">🧍 ${escQH(e.sub)}</span>`;
  if(e.kind === 'mail') return `<span class="bd-chip bd-chip-mail">✉ mail</span>`;
  return `<span class="bd-chip bd-chip-frt">📦 ${escQH(e.sub)}</span>`;
}
function bdEntryLine(e, ref){
  const dice = `<span class="bd-dice" title="Referee's traffic roll: 2D ${e.roll} + DM ${e.dm >= 0 ? '+' : ''}${e.dm}">2D:${e.roll}${e.dm >= 0 ? '+' : ''}${e.dm}</span>`;
  let what, pay, act = '';
  if(e.kind === 'pax'){
    const remaining = (Number(e.count) || 0) - (Number(e.taken) || 0);
    what = `${remaining}${e.taken ? ' of ' + e.count : ''} × ${escQH(e.sub)} passage → <b>${escQH(e.destLabel)}</b>`;
    pay = `${trdCr(e.fare)}/berth`;
    if(ref && e.status === 'open') act = `<input id="bd-take-${escQH(e.id)}" class="bd-take" type="number" min="1" max="${remaining}" value="${remaining}">
      <button class="disc-mini" onclick="boardAccept('${escQH(e.id)}')">Book</button>`;
  } else if(e.kind === 'mail'){
    what = `${e.count} sealed mail container${e.count > 1 ? 's' : ''} (${e.tons} dt) → <b>${escQH(e.destLabel)}</b> · all or none`;
    pay = `${trdCr(e.pay)} on delivery`;
    if(ref && e.status === 'open') act = `<button class="disc-mini" onclick="boardAccept('${escQH(e.id)}')">Accept</button>`;
  } else {
    what = `${escQH(e.sub)} lot · ${e.tons} dt → <b>${escQH(e.destLabel)}</b>`;
    pay = `${trdCr(e.pay)} on delivery (${trdCr(e.rate)}/dt)`;
    if(ref && e.status === 'open') act = `<button class="disc-mini" onclick="boardAccept('${escQH(e.id)}')">Accept</button>`;
  }
  const taken = e.status !== 'open' ? `<span class="bd-taken">TAKEN</span>` : '';
  return `<div class="bd-entry${e.status !== 'open' ? ' bd-entry-taken' : ''}">${bdKindChip(e)}
    <span class="bd-what">${what}</span><span class="bd-pay">${pay}</span>${ref ? dice : ''}${taken}${act}</div>`;
}
function renderBoardPanel(){
  const body = document.getElementById('board-body'); if(!body) return;
  const ref = (typeof isReferee === 'function') ? isReferee() : false;
  const src = (typeof shipState !== 'undefined') ? shipState.locationId : null;
  const here = starBoard.world && starBoard.world === src;
  let h = '';

  // ── The posted board (players see this — it's literally a public board) ──
  if(!starBoard.world || !starBoard.entries.length){
    h += `<div class="cal-empty">${ref ? 'No postings — generate the board below on arrival.' : 'Nothing posted at this port yet.'}</div>`;
  } else {
    h += `<div class="fund-lbl">📌 Posted at ${escQH(starBoard.worldLabel)} · ${escQH(starBoard.date)}${here ? '' : ' · <span style="color:#e8c65a">left behind — the ship has moved on</span>'}</div>`;
    const open = starBoard.entries.filter(e => e.status === 'open'), done = starBoard.entries.filter(e => e.status !== 'open');
    open.concat(done).forEach(e => { h += bdEntryLine(e, ref && here); });
    if(ref && here) h += `<div class="trd-note">Freight is paid on delivery; late delivery docks (1D+4)×10% — adjust in 💰 ${typeof TERM === 'function' ? escQH(TERM('funds')) : 'Funds'} if it comes up. Booking and broker haggling happen at the table; the board only records it.</div>`;
  }

  // ── Aboard — accepted contracts & booked passengers (diegetic manifest) ──
  const lots = (typeof tradeCargo !== 'undefined' && tradeCargo && Array.isArray(tradeCargo.lots)) ? tradeCargo.lots.filter(l => l.kind === 'freight' || l.kind === 'mail') : [];
  const pax = (typeof shipState !== 'undefined' && Array.isArray(shipState.passengers)) ? shipState.passengers : [];
  if(lots.length || pax.length){
    h += `<div class="fund-lbl" style="margin-top:4px">🚀 Aboard</div>`;
    lots.forEach(l => {
      h += `<div class="bd-entry">${l.kind === 'mail' ? '✉' : '📦'} <span class="bd-what">${escQH(l.good)} · ${Number(l.tons) || 0} dt</span>
        <span class="bd-pay">${trdCr(l.pay)} on delivery</span>
        ${ref ? `<button class="disc-mini" onclick="boardDeliver('${escQH(l.id)}')" title="Arrived — collect payment into the party fund">✓ Delivered</button>` : ''}</div>`;
    });
    pax.forEach(p => {
      h += `<div class="bd-entry">🧍 <span class="bd-what">${Number(p.count) || 0} × ${escQH(p.cls)} passenger${(Number(p.count) || 0) > 1 ? 's' : ''} → ${escQH(p.destLabel)}</span>
        <span class="bd-pay">fares collected</span>
        ${ref ? `<button class="disc-mini" onclick="boardDisembark('${escQH(p.id)}')" title="Arrived — passengers disembark">✓ Disembark</button>` : ''}</div>`;
    });
  }

  // ── Referee: generate form ──
  if(ref){
    const dests = bdDestinations();
    if(!boardGen.dest && dests.length) boardGen.dest = dests[0].id;
    const zoneSel = (field) => `<select class="bd-sel" onchange="boardInput('${field}',this.value)">
      ${[['green','Green'],['amber','Amber'],['red','Red']].map(([v, l]) => `<option value="${v}"${boardGen[field] === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    const numIn = (field, lbl, title) => `<label class="bd-in" title="${escQH(title)}">${lbl}<input type="number" value="${escQH(boardGen[field])}" oninput="boardInput('${field}',this.value)"></label>`;
    h += `<div class="fund-card"><div class="fund-lbl">Generate the board (referee) — RAW 2D traffic rolls</div>
      <div class="fund-row"><label class="bd-in" style="flex:1">Destination
        <select class="bd-sel" style="width:100%" onchange="boardInput('dest',this.value)">
          ${dests.map(x => `<option value="${escQH(x.id)}"${x.id === boardGen.dest ? ' selected' : ''}>${escQH(x.label)} · ${x.pc} pc</option>`).join('')}
        </select></label></div>
      <div class="fund-row"><label class="bd-in">Zone here ${zoneSel('srcZone')}</label><label class="bd-in">Zone there ${zoneSel('destZone')}</label>
        <label class="bd-in" title="Derived from the ship's weapon mounts — override for the mail DM">✚ Armed <input type="checkbox"${boardArmed() ? ' checked' : ''} onchange="boardGen.armed=this.checked"></label></div>
      <div class="fund-row">${numIn('effPax', 'Pax check Effect', 'Effect of the Average (8+) Broker, Carouse or Streetwise check — rolled at the table')}
        ${numIn('steward', 'Steward', "Highest Steward skill aboard")}</div>
      <div class="fund-row">${numIn('effFrt', 'Freight check Effect', 'Effect of the Average (8+) Broker or Streetwise check — rolled at the table')}
        ${numIn('navRank', 'Naval/Scout rank', 'Highest Naval or Scout rank aboard (mail)')}
        ${numIn('socDM', 'SOC DM', 'Highest SOC DM aboard (mail)')}</div>
      <div class="fund-row"><button class="cal-add-btn" onclick="boardGenerate()">🎲 Roll traffic & post the board</button>
        <button class="disc-mini" onclick="boardClear()" title="Take down un-taken postings">✕ Clear open</button></div>
      <div class="trd-note">Check Effects above come from dice rolled at the table — the app only rolls the port's traffic (the referee's own 2D world rolls) and does the rate lookups.</div>
    </div>`;
  }
  body.innerHTML = h;
}

// ═══════════════════════════════════════════════════════════════════════════
// RECURRING SHIP COSTS — accrue on calendar advance, referee approves
// ═══════════════════════════════════════════════════════════════════════════
// RAW (Core Update 2022 p.160): per Maintenance Period (4 weeks / 28 days) —
// mortgage = price ÷ 240; maintenance = 0.1% of price per year ÷ 12; life
// support Cr1,000/stateroom + Cr1,000/person + Cr100/occupied low berth;
// salaries Pilot 6,000 · Astrogator 5,000 · Engineer 4,000 · Medic 3,000 ·
// Steward 2,000 · Gunner 1,000 · Marine 1,000. Amounts are referee-editable
// (staterooms/crew aren't on the sheet, so life support & salaries can't be
// derived — the RAW formulae ride the tooltips instead). When the Imperial
// date crosses a 28-day boundary each enabled item lands as a PENDING entry;
// NOTHING is ever deducted until the referee approves it into the ledger.
// Shared key 'ship-costs'; the review UI lives in the 💰 Funds panel.

const SHIP_COST_PERIOD = 28;   // days per Maintenance Period (RAW)
const SHIP_COST_HINTS = {
  maintenance: 'RAW: 0.1% of purchase price per year, billed monthly (÷12)',
  mortgage:    'RAW: purchase price ÷ 240, every 4 weeks for 40 years',
  lifeSupport: 'RAW: Cr1,000 per stateroom + Cr1,000 per person aboard + Cr100 per occupied low berth',
  salaries:    'RAW per period: Pilot 6,000 · Astrogator 5,000 · Engineer 4,000 · Medic 3,000 · Steward 2,000 · Gunner 1,000 · Marine 1,000',
};
let shipCosts = { cfg: null, lastOrd: null, pending: [] };
let shipCostsCfgOpen = false;   // rates editor visibility (device-local)

// "MCr64", "MCr 42.6", "Cr42,600,000", "42600000" → credits (0 if unparseable).
function parseCrStr(s){
  if(typeof s === 'number' && isFinite(s)) return Math.round(s);
  s = String(s || '').replace(/,/g, '');
  const m = s.match(/(\d+(?:\.\d+)?)/); if(!m) return 0;
  let v = parseFloat(m[1]);
  if(/mcr/i.test(s)) v *= 1e6;
  return Math.round(v);
}
// RAW defaults off the ship sheet where derivable; sheet cost strings as fallback.
function shipCostsDefaults(){
  const ss = (typeof shipState !== 'undefined') ? shipState : {};
  const price = parseCrStr(ss.purchaseCost);
  return [
    { id: 'maintenance', label: 'Maintenance',   amount: price > 0 ? Math.round(price * 0.001 / 12) : parseCrStr(ss.maintenance), on: true },
    { id: 'mortgage',    label: 'Mortgage',      amount: price > 0 ? Math.round(price / 240) : parseCrStr(ss.mortgage), on: true },
    { id: 'lifeSupport', label: 'Life support',  amount: 0, on: true },
    { id: 'salaries',    label: 'Crew salaries', amount: 0, on: true },
  ];
}
function shipCostsEnsure(){
  if(!shipCosts || typeof shipCosts !== 'object') shipCosts = { cfg: null, lastOrd: null, pending: [] };
  if(!shipCosts.cfg || !Array.isArray(shipCosts.cfg.items)) shipCosts.cfg = { items: shipCostsDefaults() };
  if(!Array.isArray(shipCosts.pending)) shipCosts.pending = [];
}
async function loadShipCosts(){
  try { const r = await supaStorage.get('ship-costs', true);
    if(r.value != null){ const v = JSON.parse(r.value); if(v && typeof v === 'object') shipCosts = v; } } catch(e){}
  shipCostsEnsure();
}
async function saveShipCosts(){
  try { await supaStorage.set('ship-costs', JSON.stringify(shipCosts), true); }
  catch(e){ console.error('Ship costs save failed:', e); }
}

// Called from afterDateChange() (85-records.js) whenever the referee moves the
// Imperial date. Crossing a 28-day boundary queues each enabled item as pending.
function shipCostsOnDateChange(){
  if(typeof isReferee === 'function' && !isReferee()) return;
  shipCostsEnsure();
  const cur = imperialOrdinal(imperialDate);
  if(shipCosts.lastOrd == null || cur < shipCosts.lastOrd){   // first run / date moved back: re-baseline, no back-billing
    shipCosts.lastOrd = cur; saveShipCosts(); return;
  }
  let accrued = 0;
  while(cur >= shipCosts.lastOrd + SHIP_COST_PERIOD){
    shipCosts.lastOrd += SHIP_COST_PERIOD;
    const due = formatImperial(ordinalToImperial(shipCosts.lastOrd));
    shipCosts.cfg.items.forEach(it => {
      const amt = Math.round(Number(it.amount) || 0);
      if(it.on && amt > 0){ shipCosts.pending.push({ id: 'sc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), itemId: it.id, label: it.label, amount: amt, due }); accrued++; }
    });
  }
  if(accrued){
    saveShipCosts();
    if(typeof fundsPanelOpen !== 'undefined' && fundsPanelOpen && typeof renderFundsPanel === 'function') renderFundsPanel();
    if(typeof showToast === 'function') showToast(`⏱ Maintenance period ended — ${accrued} ship cost${accrued > 1 ? 's' : ''} pending in 💰 ${typeof TERM === 'function' ? TERM('funds') : 'Funds'}`);
  }
}
function shipCostApprove(id){
  if(typeof isReferee === 'function' && !isReferee()) return;
  const p = shipCosts.pending.find(x => x.id === id); if(!p) return;
  if(typeof normalizeFunds === 'function') normalizeFunds();
  funds.party = (Number(funds.party) || 0) - p.amount;
  fundsLog('party', -p.amount, `${p.label} — maintenance period ending ${p.due}`);
  shipCosts.pending = shipCosts.pending.filter(x => x.id !== id);
  saveFunds(); saveShipCosts();
  if(typeof renderFundsPanel === 'function') renderFundsPanel();
}
function shipCostWaive(id){
  if(typeof isReferee === 'function' && !isReferee()) return;
  shipCosts.pending = shipCosts.pending.filter(x => x.id !== id);
  saveShipCosts();
  if(typeof renderFundsPanel === 'function') renderFundsPanel();
}
function shipCostApproveAll(){
  if(typeof isReferee === 'function' && !isReferee()) return;
  shipCosts.pending.slice().forEach(p => shipCostApprove(p.id));
}
function shipCostSetAmount(itemId, value){
  if(typeof isReferee === 'function' && !isReferee()) return;
  shipCostsEnsure();
  const it = shipCosts.cfg.items.find(x => x.id === itemId); if(!it) return;
  it.amount = Math.max(0, Math.round(Number(value) || 0));
  saveShipCosts();
}
function shipCostToggle(itemId){
  if(typeof isReferee === 'function' && !isReferee()) return;
  shipCostsEnsure();
  const it = shipCosts.cfg.items.find(x => x.id === itemId); if(!it) return;
  it.on = !it.on;
  saveShipCosts();
}
function shipCostsToggleCfg(){ shipCostsCfgOpen = !shipCostsCfgOpen; if(typeof renderFundsPanel === 'function') renderFundsPanel(); }
function shipCostsRederive(){
  if(typeof isReferee === 'function' && !isReferee()) return;
  shipCostsEnsure();
  const def = shipCostsDefaults();
  shipCosts.cfg.items.forEach(it => { const d = def.find(x => x.id === it.id); if(d && d.amount > 0) it.amount = d.amount; });
  saveShipCosts();
  if(typeof renderFundsPanel === 'function') renderFundsPanel();
  if(typeof showToast === 'function') showToast('Rates re-derived from the ship sheet where possible');
}

// Referee section rendered inside the 💰 Funds panel (see renderFundsPanel).
function shipCostsFundsSectionHTML(){
  shipCostsEnsure();
  let h = `<div class="fund-lbl" style="margin-top:2px">Ship running costs · every ${SHIP_COST_PERIOD} days</div><div class="fund-card">`;
  if(!shipCosts.pending.length){
    h += `<div class="trd-note">Nothing pending — costs accrue as the Imperial date advances, and only land in the ledger when you approve them.</div>`;
  } else {
    shipCosts.pending.forEach(p => {
      h += `<div class="fund-purse"><span>${escQH(p.label)} <span style="opacity:.6;font-size:10px">due ${escQH(p.due)}</span></span>
        <span style="display:flex;gap:6px;align-items:center"><b style="font-family:monospace;color:#d45050">−${fmtCr(p.amount)}</b>
        <button class="disc-mini" onclick="shipCostApprove('${escQH(p.id)}')" title="Deduct from the party fund and log it">✓ Pay</button>
        <button class="disc-mini" onclick="shipCostWaive('${escQH(p.id)}')" title="Dismiss without charging (deferred, story reasons…)">✕</button></span></div>`;
    });
    if(shipCosts.pending.length > 1){
      const tot = shipCosts.pending.reduce((s, p) => s + p.amount, 0);
      h += `<div class="fund-row"><button class="disc-mini" onclick="shipCostApproveAll()">✓ Pay all — ${fmtCr(tot)}</button></div>`;
    }
  }
  h += `<div class="fund-row"><button class="disc-mini" onclick="shipCostsToggleCfg()">${shipCostsCfgOpen ? '▴ Hide rates' : '⚙ Rates'}</button></div>`;
  if(shipCostsCfgOpen){
    shipCosts.cfg.items.forEach(it => {
      h += `<div class="fund-purse" title="${escQH(SHIP_COST_HINTS[it.id] || '')}">
        <span><input type="checkbox"${it.on ? ' checked' : ''} onchange="shipCostToggle('${escQH(it.id)}')"> ${escQH(it.label)}</span>
        <span><input class="fund-inp" style="width:84px" type="number" min="0" value="${Math.round(Number(it.amount) || 0)}" onchange="shipCostSetAmount('${escQH(it.id)}',this.value)"> Cr</span></div>`;
    });
    h += `<div class="fund-row"><button class="disc-mini" onclick="shipCostsRederive()" title="Maintenance & mortgage from the sheet's purchase cost (0.1%/yr ÷12 · price ÷240)">↺ Derive from ship sheet</button></div>
      <div class="trd-note">Life support & salaries aren't derivable (staterooms/crew aren't on the sheet) — RAW formulae are in each row's tooltip; set what fits the ship.</div>`;
  }
  h += `</div>`;
  return h;
}

// ── Boot ────────────────────────────────────────────────────────────────────
loadStarportBoard();   // shared board — renders on-demand when its panel opens
loadShipCosts();       // recurring-cost config + pending queue (reviewed in Funds)
makePanelDraggable('trade-wrap', 'trade-header');
makePanelResizable('trade-wrap');
makePanelDraggable('board-wrap', 'board-header');
makePanelResizable('board-wrap');

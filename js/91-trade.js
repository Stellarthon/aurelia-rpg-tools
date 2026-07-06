// ═══════════════════════════════════════════════════════════════════════════
// STATION TRADE — referee deal desk for the world the party is docked at
// ───────────────────────────────────────────────────────────────────────────
// Needs loaded before it: 00 (helpers), 10 (HX.localMarket), 50 (supaStorage,
// via the funds/cargo save paths), 55 (isReferee), 70 (panel drag/resize +
// escQH), 75 (shipState), 85 (funds ledger, trade-cargo manifest, imperial
// date, fmtCr), 90 (ECON price overlay — optional at runtime).
//
// A REFEREE TOOL: players never get a buy/sell UI — their market intel stays
// the fog-of-price readout on the hex map. This screen looks up the local
// market (trade-code Purchase/Sale DMs + live pressure, shown as REFERENCE
// ONLY) and records deals already resolved at the table with dice — nothing
// here rolls or auto-resolves a trade. Recording a deal writes the funds
// ledger (shared key 'funds', imperial-dated) and the cargo manifest (shared
// key 'trade-cargo') in one step, riding the existing save paths and polls.
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

makePanelDraggable('trade-wrap', 'trade-header');
makePanelResizable('trade-wrap');

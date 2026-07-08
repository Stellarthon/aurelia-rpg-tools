#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Corp-balance harness — headless driver for the Living Economy corp layer.
//
// Loads the REAL galaxy data (js/10-galaxy.js) and the REAL economy engine
// (js/90-economy.js, the window.ECON IIFE) into a Node vm sandbox with stubbed
// browser globals, then steps the sim as the referee and reports, turn by turn,
// each trading house's treasury / fleet / investments. This is the "balance
// harness" the economy comments reference — use it to tune the corp constants.
//
//   node tools/econ-corp-harness.cjs [weeksPerTurn] [turns] [seeds]
//
// Determinism: the engine uses Math.random in a few referee-only spots (corp
// formation, invest-world choice, berth days, spawns). We seed it with a tiny
// LCG so a run is reproducible; pass several seeds to see the spread.
//
// SCOPE: this models the corp TREASURY / FLEET / INVEST layer, which is all that
// matters for corp balance and is fully self-contained. It does NOT load the HX
// worldgen module, so derived worlds get no UWP facts → their (agricultural) food
// production is absent and the harness galaxy reads as food-negative. That is a
// harness limitation, not a real condition: the live galaxy's Ag/Ga worlds export
// food and the global invest cap (18) was tuned to keep worker-food demand inside
// that real surplus. Don't read the harness's foodFactor as a balance signal.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const galaxySrc = fs.readFileSync(path.join(ROOT, 'js/10-galaxy.js'), 'utf8').split('\n');
const econSrc   = fs.readFileSync(path.join(ROOT, 'js/90-economy.js'), 'utf8').split('\n');

// GALAXY_FACTIONS .. end of GALAXY_NODES — pure data literals (bounds found
// dynamically so the slice survives galaxy-size changes: gen-galaxy.mjs).
const _gStart = galaxySrc.findIndex(l => l.includes('const GALAXY_FACTIONS'));
const _gEnd   = galaxySrc.findIndex(l => l.startsWith('const GALAXY_NODES_BASE'));
const galaxyData = galaxySrc.slice(_gStart, _gEnd).join('\n');
// The window.ECON IIFE: lines 1 .. its close at `})();` (line 1219). Everything
// after is referee-console UI (DOM), which we don't load.
const iifeClose = econSrc.findIndex((l, i) => i > 0 && l === '})();');
const econIIFE = econSrc.slice(0, iifeClose + 1).join('\n');

function makeRng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

function buildECON(seed) {
  const rng = makeRng(seed);
  const M = {}; Object.getOwnPropertyNames(Math).forEach(k => { M[k] = Math[k]; }); M.random = rng;
  const sandbox = {
    console,
    Math: M, JSON, Object, Array, Number, String, Boolean, isFinite, isNaN, parseInt, parseFloat, Set, Map, Proxy, Symbol,
    window: {},
    isReferee: () => true,                                   // harness drives the sim AS the referee
    imperialDate: { day: 1, year: 1105 },
    imperialOrdinal: () => 0,                                // curWeek() => 0, so the sim opens at week 0
    supaStorage: { get: async () => null, set: () => {} },   // no persistence
    localStorage: { getItem: () => null, setItem: () => {} },
    document: new Proxy({}, { get: () => () => {} }),
    showToast: () => {},
    setTimeout: () => 0, clearTimeout: () => {},
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(galaxyData + '\n' + econIIFE, ctx, { filename: 'econ-harness-bundle.js' });
  return sandbox.window.ECON;
}

function snapshot(ECON) {
  const corps = ECON.corps();
  const agents = ECON.agents();
  return Object.values(corps).map(c => ({
    name: c.name.split(' ')[0],
    mega: !!c.megacorp,
    defunct: !!c.defunct,
    treasury: Math.round(c.treasury),
    fleet: agents.filter(a => a.backing === c.id).length,
    invests: (c.invests || []).length,
  }));
}

function fmt(n) { return (n >= 0 ? ' ' : '') + String(n).padStart(7); }

function runOne(seed, weeksPerTurn, turns, verbose) {
  const ECON = buildECON(seed);
  ECON.ensure();
  ECON.setTraders(true);
  ECON.setActive(true);
  if (verbose) {
    console.log(`\n=== seed ${seed} · ${weeksPerTurn}-week turns · cap=${ECON.traderCap()} · ${ECON.agents().length} seed ships ===`);
  }
  const rows = [];
  for (let t = 0; t <= turns; t++) {
    if (t > 0) ECON.advance(weeksPerTurn);
    const snap = snapshot(ECON);
    rows.push({ turn: t, week: t * weeksPerTurn, snap });
  }
  if (verbose) {
    const names = rows[0].snap.map(c => (c.mega ? '★' : ' ') + c.name);
    console.log('turn wk  | ' + names.map(n => n.padStart(9)).join(' | ') + '   (treasury · fleet/invests)');
    rows.forEach(r => {
      const cells = r.snap.map(c => {
        const tag = c.defunct ? 'DEFUNCT' : `${c.fleet}f/${c.invests}i`;
        return (Math.round(c.treasury / 1000) + 'k').padStart(5) + ' ' + tag.padStart(8);
      });
      console.log(String(r.turn).padStart(2) + ' ' + String(r.week).padStart(3) + '  | ' + cells.join(' | '));
    });
  }
  return rows;
}

// ── Aggregate verdict across seeds: at the final turn, what share of total corp
//    investments does OmniSynth hold, and how many rivals are viable (alive with
//    ≥1 invest OR a positive growing treasury)? ──
function verdict(weeksPerTurn, turns, seeds) {
  let megaInvestShare = 0, rivalInvestTotal = 0, megaInvestTotal = 0, rivalsViable = 0, rivalsTotal = 0, rivalDefunct = 0, runs = 0;
  for (let s = 1; s <= seeds; s++) {
    const rows = runOne(s, weeksPerTurn, turns, false);
    const fin = rows[rows.length - 1].snap;
    const mega = fin.find(c => c.mega);
    const rivals = fin.filter(c => !c.mega);
    const totalInv = fin.reduce((a, c) => a + c.invests, 0);
    megaInvestTotal += mega.invests;
    rivalInvestTotal += rivals.reduce((a, c) => a + c.invests, 0);
    if (totalInv > 0) { megaInvestShare += mega.invests / totalInv; runs++; }
    rivals.forEach(r => { rivalsTotal++; if (r.defunct) rivalDefunct++; else if (r.invests >= 1) rivalsViable++; });
  }
  const avgShare = runs ? (100 * megaInvestShare / runs) : 0;
  console.log(`\n──────── VERDICT over ${seeds} seeds @ turn ${turns} (week ${turns * weeksPerTurn}) ────────`);
  console.log(`OmniSynth invest share (avg): ${avgShare.toFixed(0)}%   [mega total invests ${megaInvestTotal}, rivals total ${rivalInvestTotal}]`);
  console.log(`Rivals with ≥1 investment:    ${rivalsViable}/${rivalsTotal}   (defunct: ${rivalDefunct}/${rivalsTotal})`);
}

const weeksPerTurn = parseInt(process.argv[2] || '4', 10);
const turns = parseInt(process.argv[3] || '12', 10);
const seeds = parseInt(process.argv[4] || '8', 10);

// A couple of detailed traces, then the aggregate verdict.
runOne(1, weeksPerTurn, turns, true);
runOne(2, weeksPerTurn, turns, true);
verdict(weeksPerTurn, turns, seeds);

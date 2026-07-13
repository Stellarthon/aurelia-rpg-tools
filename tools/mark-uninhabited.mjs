#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// mark-uninhabited.mjs · Deterministically flag ~30% of systems as uninhabited.
//
// "Not every system is inhabited after 12000 years of colonisation" — cut the
// inhabited count by 30% WITHOUT touching jump lanes, connectivity, or the
// hand-authored (curated) worlds. A flagged system stays on the map and stays a
// jump pass-through, but reads as barren (pop 0, port X) so the economy gives it
// an empty market and the referee tools show it as unsettled.
//
// The cut is drawn ENTIRELY from the procedurally-generated (`_gen:true`) pool,
// excluding the Vast (alien) and Archon (rogue-AI) polities — those are special
// powers, not colonisation frontier. All 53 curated worlds stay inhabited.
//
// Re-runnable + idempotent: same seed → same selection. Node order, keys, and the
// one-object-per-line format are preserved (JSON.stringify matches the in-file
// style exactly), so the diff is purely the added "uninhabited":true flags.
//
//   node tools/mark-uninhabited.mjs            # rewrite js/10-galaxy.js in place
//   node tools/mark-uninhabited.mjs --check    # report only, no write
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(repoRoot, 'js/10-galaxy.js');
const checkOnly = process.argv.includes('--check');
const SEED = 20260709;                 // fixed → deterministic selection
const CUT_FRACTION = 0.30;             // share of ALL systems to leave uninhabited
const NO_FRONTIER = new Set(['vast', 'archon']);  // special polities, never "empty colony"

const src = readFileSync(file, 'utf8');
const m = /const GALAXY_NODES = (\[[\s\S]*?\n\]);/.exec(src);
if (!m) throw new Error('GALAXY_NODES literal not found');
const nodes = JSON.parse(m[1]);  // literal is JSON-clean (same as gen-galaxy.mjs)

// Deterministic PRNG (mulberry32) → stable shuffle of the eligible pool.
function mulberry(seed) {
  return function () { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const rng = mulberry(SEED);

// Start clean each run so the selection is a pure function of (seed, node set).
nodes.forEach(n => { delete n.uninhabited; });

const eligible = nodes.filter(n => n._gen && !NO_FRONTIER.has(n.faction));
const target = Math.round(nodes.length * CUT_FRACTION);   // 30% of all systems

// Fisher–Yates on a copy, seeded → take the first `target`.
const pool = eligible.slice();
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
const chosen = new Set(pool.slice(0, Math.min(target, pool.length)).map(n => n.id));

nodes.forEach(n => { if (chosen.has(n.id)) n.uninhabited = true; });

const inhabited = nodes.filter(n => !n.uninhabited).length;
console.log(`systems: ${nodes.length} · eligible frontier: ${eligible.length} · target cut (30%): ${target}`);
console.log(`→ marked uninhabited: ${chosen.size} · remaining inhabited: ${inhabited} (${(100 * chosen.size / nodes.length).toFixed(1)}% cut)`);
console.log(`curated still inhabited: ${nodes.filter(n => !n._gen && !n.uninhabited).length}/${nodes.filter(n => !n._gen).length}`);

const serialized = '[\n' + nodes.map(n => '  ' + JSON.stringify(n)).join(',\n') + '\n]';
const out = src.slice(0, m.index) + 'const GALAXY_NODES = ' + serialized + ';' + src.slice(m.index + m[0].length);

if (checkOnly) { console.log('(--check) no write'); process.exit(0); }
if (out === src) { console.log('✓ already up to date — nothing changed.'); process.exit(0); }
writeFileSync(file, out);
console.log('✓ js/10-galaxy.js rewritten with uninhabited flags.');

#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// strip-secrets.mjs  ·  Stage 3 of the per-player redaction plan
//
// THE IRREVERSIBLE DE-BAKE. Rewrites the three campaign-data literals in
// index.html (BASE_BODIES_AUROS, MAIN, GALAXY_NODES) to contain ONLY player-safe
// fields. The referee content (NPC stat blocks, checks, "Referee Context", RSR
// notes, hooks, refnotes) is REMOVED from the shipped file — it now lives only in
// the campaign_content table and is fetched at runtime by an authorised token via
// get-content. After this, a player's downloaded HTML contains 0 bytes of secrets.
//
//   node tools/strip-secrets.mjs            # rewrites index.html in place
//   node tools/strip-secrets.mjs --check    # verify only, no write (exit 1 if dirty)
//
// Safe to re-run (idempotent). Classification MUST match tools/extract-content.mjs
// and the client REDACT_FIELDS. The data literals are pure JSON-like literals
// (verified), so parse→strip→reserialise is lossless for player-safe content.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = resolve(repoRoot, 'index.html');
const checkOnly = process.argv.includes('--check');

// Referee-only fields removed from each structure (mirror of REDACT_FIELDS in
// index.html and the referee side of tools/extract-content.mjs).
const REDACT = {
  BASE_BODIES_AUROS: ['refNote', 'hook', 'npcs', 'checks', 'events', 'rsr', 'refnotes'],
  MAIN:              ['desc', 'rsr', 'npcs', 'checks', 'events', 'refnotes', 'refNote', 'hook'],
  GALAXY_NODES:      ['refNote', 'refnotes', 'npcs', 'checks', 'hook'],
  BASE_LOCATIONS:    ['refNote', 'hook'],   // nested system → body → [locations]
  TIMED_EVENTS:      '*',                    // whole array is GM-only → ships as []
};

// Locate the value literal after `const NAME = `, bracket-matching past strings.
function valueSpan(src, name) {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*`).exec(src);
  if (!m) throw new Error(`const ${name} not found`);
  let i = m.index + m[0].length;
  const start = i, open = src[i], close = open === '{' ? '}' : ']';
  let depth = 0, s = null, line = false, block = false;
  for (; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && src[i + 1] === '/') { block = false; i++; } continue; }
    if (s) { if (c === s && p !== '\\') s = null; continue; }
    if (c === '/' && src[i + 1] === '/') { line = true; continue; }
    if (c === '/' && src[i + 1] === '*') { block = true; continue; }
    if (c === '"' || c === "'" || c === '`') { s = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { i++; break; } }
  }
  return { start, end: i, text: src.slice(start, i) };
}

function evalLiteral(expr) {
  const stub = new Proxy({}, { has: () => true, get: () => undefined });
  return new Function('__s__', `with(__s__){ return (${expr}); }`)(stub);
}

// Recursively delete referee fields. MAIN strips areas AND their nested subs.
function stripFields(value, fields, isMainRoot = false) {
  if (Array.isArray(value)) { value.forEach(v => stripFields(v, fields)); return value; }
  if (value && typeof value === 'object') {
    for (const f of fields) delete value[f];
    if (value.subs && typeof value.subs === 'object') {
      Object.values(value.subs).forEach(s => stripFields(s, fields));
    }
    if (isMainRoot) Object.values(value).forEach(a => stripFields(a, fields));
  }
  return value;
}

const src = readFileSync(htmlPath, 'utf8');

// ── Coverage guard (fail-closed) ─────────────────────────────────────────────
// Refuse to strip if any structure still holds campaign-secret content this
// script doesn't yet handle — an incomplete strip would leak (uncovered secrets
// stay in the bundle) or lose data (stripped content not on the server). These
// MUST each be in REDACT (or explicitly cleared as non-secret) before stripping.
const MUST_COVER = ['BASE_BODIES_AUROS', 'MAIN', 'GALAXY_NODES', 'BASE_LOCATIONS', 'TIMED_EVENTS'];
// Referee-ish text that is generic GM tooling (rules / random generators), NOT
// campaign secrets — intentionally shipped. (Confirm scope before adding here.)
const NON_SECRET = new Set([
  'ARCHON_BANDS', 'NPC_GEN', 'ORACLE_GOODS', 'ORACLE_PLACES', 'RUMOUR_TEMPLATES',
  'RUMOUR_RELIABILITY', 'ENCOUNTER_TABLES', 'ENCOUNTER_DIFF', 'ORACLE_WHERE',
  'ORACLE_DANGER', 'QREF_DATA',
]);
const REF_FIELD_RE = /\b(npcs|checks|refnotes|refNote|rsr|events|hook):/;
{
  const declared = [...new Set([...src.matchAll(/const ([A-Z_][A-Z0-9_]{2,}[A-Za-z_]*) *= *[\[{]/g)].map(m => m[1]))];
  const missing = MUST_COVER.filter(n => !REDACT[n] && new RegExp(`const ${n}\\b`).test(src));
  const newlyFound = declared.filter(n =>
    !REDACT[n] && !NON_SECRET.has(n) && !MUST_COVER.includes(n) && REF_FIELD_RE.test(valueSpan(src, n).text));
  const uncovered = [...new Set([...missing, ...newlyFound])];
  if (uncovered.length) {
    console.error(`✗ ABORT — referee content NOT covered by this strip: ${uncovered.join(', ')}`);
    console.error('  Extend REDACT here (and tools/extract-content.mjs + the client) so this content');
    console.error('  is on the server before removing it from the bundle. No changes written.');
    process.exit(2);
  }
}

const edits = [];
let strippedFieldCount = 0;

const countAndStrip = (rec, fields) => { for (const f of fields) if (rec[f] !== undefined) strippedFieldCount++; stripFields(rec, fields); };

for (const [name, fields] of Object.entries(REDACT)) {
  const span = valueSpan(src, name);
  const value = evalLiteral(span.text);
  const before = JSON.stringify(value).length;
  let outValue = value;
  if (fields === '*') {                                   // whole array is GM-only → []
    strippedFieldCount += Array.isArray(value) ? value.length : 0;
    outValue = [];
  } else if (name === 'MAIN') {                            // object: { areaId: area{…, subs} }
    Object.values(value).forEach(area => countAndStrip(area, fields));
  } else if (name === 'BASE_LOCATIONS') {                  // object: { sys: { body: [locations] } }
    for (const bodies of Object.values(value))
      for (const locs of Object.values(bodies))
        locs.forEach(loc => countAndStrip(loc, fields));
  } else {                                                 // flat array of records
    value.forEach(rec => countAndStrip(rec, fields));
  }
  const serialized = JSON.stringify(outValue, null, 2);
  edits.push({ name, start: span.start, end: span.end, serialized, before, after: serialized.length });
}

// Apply replacements from the end of the file backwards so offsets stay valid.
let out = src;
for (const e of edits.sort((a, b) => b.start - a.start)) {
  out = out.slice(0, e.start) + e.serialized + out.slice(e.end);
}

const changed = out !== src;
edits.forEach(e => console.log(`  ${e.name}: ${e.before} → ${e.after} bytes (JSON)`));
console.log(`Referee fields removed: ${strippedFieldCount}`);

if (checkOnly) {
  if (changed) { console.error('✗ index.html still contains referee literals (run without --check to strip).'); process.exit(1); }
  console.log('✓ already stripped — no referee literals in the bundle.');
} else if (changed) {
  writeFileSync(htmlPath, out);
  console.log('✓ index.html rewritten — referee content removed from the shipped file.');
} else {
  console.log('✓ nothing to strip — already clean.');
}

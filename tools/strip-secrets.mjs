#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// strip-secrets.mjs  ·  Stage 3 of the per-player redaction plan
//
// THE IRREVERSIBLE DE-BAKE. Rewrites the campaign-data literals (BASE_BODIES_AUROS,
// MAIN, GALAXY_NODES, BASE_LOCATIONS, TIMED_EVENTS) to contain ONLY player-safe
// fields. The referee content (NPC stat blocks, checks, "Referee Context", RSR
// notes, hooks, refnotes) is REMOVED from the shipped files — it now lives only in
// the campaign_content table and is fetched at runtime by an authorised token via
// get-content. After this, a player's download contains 0 bytes of secrets.
//
// NOTE: index.html was split into ordered classic <script src> files under js/
// (see docs/ARCHITECTURE.md), so these literals now live in js modules, not in
// index.html — this tool reads/writes those modules (see LITERAL_FILE below).
//
//   node tools/strip-secrets.mjs            # rewrites the js modules in place
//   node tools/strip-secrets.mjs --check    # verify only, no write (exit 1 if dirty)
//
// Safe to re-run (idempotent). Classification MUST match tools/extract-content.mjs
// and the client REDACT_FIELDS. The data literals are pure JSON-like literals
// (verified), so parse→strip→reserialise is lossless for player-safe content.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

// ── Post-split repoint (see docs/ARCHITECTURE.md) ────────────────────────────
// index.html was split into ordered classic <script src> files under js/. The
// campaign-data literals this de-bake strips no longer live in index.html — each
// now lives in the js module below. (SUPABASE_KEY in js/50-supabase.js is a
// *publishable* anon key, RLS-gated, NOT a de-baked secret — left as-is.)
const LITERAL_FILE = {
  BASE_BODIES_AUROS: 'js/00-core-data.js',
  GALAXY_NODES:      'js/10-galaxy.js',
  MAIN:              'js/20-station-data.js',
  BASE_LOCATIONS:    'js/40-station.js',
  TIMED_EVENTS:      'js/40-station.js',
};

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

// Read every js module once. The coverage guard scans ALL of them so a referee
// secret added to ANY module fails closed; stripping rewrites only the files
// that hold a covered literal.
const jsDir = resolve(repoRoot, 'js');
const fileSrc = {};                                       // 'js/NN-x.js' -> contents
for (const f of readdirSync(jsDir).filter(n => n.endsWith('.js')).sort()) {
  fileSrc['js/' + f] = readFileSync(resolve(jsDir, f), 'utf8');
}
// First js module that declares each top-level data const (name -> 'js/..').
const declFile = {};
for (const [rel, s] of Object.entries(fileSrc))
  for (const m of s.matchAll(/const ([A-Z_][A-Z0-9_]{2,}[A-Za-z_]*) *= *[\[{]/g))
    if (!(m[1] in declFile)) declFile[m[1]] = rel;

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
  // Engine config + generator templates, intentionally shipped. These carry
  // field-name-like keys that REF_FIELD_RE matches, but the keys are UI labels /
  // parameterised template fields, NOT campaign secrets (verified in-repo):
  //  · PACK_DEFAULTS   — franchise-agnostic pack defaults; the only trigger is its
  //    terminology map's label keys refNote:'Referee Note' / npcs:'NPCs'
  //    (js/05-campaign-pack.js) — labels, not data.
  //  · CORP_CONTRACT   — parameterised corp-job templates ({corp}/{target}/{reward}
  //    placeholders, same class as the ORACLE_*/RUMOUR_* generators above)
  //    (js/85-records.js) — no campaign-specific content.
  'PACK_DEFAULTS', 'CORP_CONTRACT',
]);
const REF_FIELD_RE = /\b(npcs|checks|refnotes|refNote|rsr|events|hook):/;
{
  const missing = MUST_COVER.filter(n => !REDACT[n] && n in declFile);
  const newlyFound = Object.keys(declFile).filter(n =>
    !REDACT[n] && !NON_SECRET.has(n) && !MUST_COVER.includes(n) && REF_FIELD_RE.test(valueSpan(fileSrc[declFile[n]], n).text));
  const uncovered = [...new Set([...missing, ...newlyFound])];
  if (uncovered.length) {
    console.error(`✗ ABORT — referee content NOT covered by this strip: ${uncovered.join(', ')}`);
    console.error('  Extend REDACT here (and tools/extract-content.mjs + the client) so this content');
    console.error('  is on the server before removing it from the bundle. No changes written.');
    process.exit(2);
  }
}

// Locate + strip each covered literal in the js module that now holds it.
const editsByFile = {};                                   // 'js/..' -> [{name,start,end,serialized,…}]
let strippedFieldCount = 0;

const countAndStrip = (rec, fields) => { for (const f of fields) if (rec[f] !== undefined) strippedFieldCount++; stripFields(rec, fields); };

for (const [name, fields] of Object.entries(REDACT)) {
  const rel = LITERAL_FILE[name];
  if (!rel || !(rel in fileSrc)) throw new Error(`no js module mapped for ${name}`);
  const span = valueSpan(fileSrc[rel], name);
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
  (editsByFile[rel] ||= []).push({ name, start: span.start, end: span.end, serialized, before, after: serialized.length });
}

// Apply per file, end→start so offsets stay valid; write only files that changed.
let anyChanged = false;
for (const [rel, edits] of Object.entries(editsByFile)) {
  let out = fileSrc[rel];
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.serialized + out.slice(e.end);
  const changed = out !== fileSrc[rel];
  anyChanged = anyChanged || changed;
  edits.forEach(e => console.log(`  ${rel} · ${e.name}: ${e.before} → ${e.after} bytes (JSON)`));
  if (!checkOnly && changed) writeFileSync(resolve(repoRoot, rel), out);
}
console.log(`Referee fields removed: ${strippedFieldCount}`);

if (checkOnly) {
  if (anyChanged) { console.error('✗ js modules still contain referee literals (run without --check to strip).'); process.exit(1); }
  console.log('✓ already stripped — no referee literals in the bundle.');
} else if (anyChanged) {
  console.log('✓ js modules rewritten — referee content removed from the shipped files.');
} else {
  console.log('✓ nothing to strip — already clean.');
}

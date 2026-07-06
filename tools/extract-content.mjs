#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// extract-content.mjs  ·  Stage 0 of the per-player redaction plan
//
// Lifts the hardcoded campaign data out of index.html into audience-tagged
// "content fragments" ready to seed the `campaign_content` table, and writes a
// human-readable classification report for the referee to verify BEFORE seeding.
//
//   node tools/extract-content.mjs [path/to/index.html]
//   → supabase/seed/campaign_content.json     (the seed payload)
//   → supabase/seed/classification-report.md  (REVIEW THIS before seeding)
//
// Design principles (see docs/per-player-redaction-plan.md §5):
//   • FAIL CLOSED — any field not explicitly classified is treated as `referee`
//     (over-hiding is safe; leaking is not).
//   • Classification is INTENT-based, not driven by the current (sometimes buggy)
//     render gating. Where the two disagree, the report flags it.
//   • Each area/body emits at most TWO fragments: one `all` (player-safe) and one
//     `referee`. A referee fragment is filtered out atomically server-side, so a
//     mis-merge can never partially expose it.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const htmlPath = resolve(process.argv[2] || resolve(repoRoot, 'index.html'));
const outDir = resolve(repoRoot, 'supabase/seed');

// ── Classification table ─────────────────────────────────────────────────────
// audience for a field, keyed by structure. `referee` = GM only; `all` = any
// revealed viewer. Anything absent here falls through to FAIL-CLOSED (referee).
const PLAYER_SAFE = {
  // bodies (BASE_BODIES_AUROS): the survey-overview fields a player sees
  body: new Set(['id','name','type','tag','tagBg','tagColor','color','ac',
                 'orbitAU','uwpString','diameter','period','orbitPos','isStar',
                 'isMoon','beltDensity','readAloud','desc',
                 // presentational/positional — needed for the player's map to draw
                 'displayRadius','parentId','ringStyle','decoration']),
  // station areas (MAIN) and their subs: read-aloud + chrome only.
  // NOTE: MAIN `desc` is labelled "Referee Context" in the UI and is referee-only
  // by INTENT — it is deliberately NOT listed here (see report flag).
  area: new Set(['label','sub','tag','tagBg','tagColor','ac','read','conn','ship']),
  // galaxy systems (GALAXY_NODES): map position + public lore
  node: new Set(['id','name','label','x','y','faction','connections','desc','systemId']),
  // body-surface locations (BASE_LOCATIONS): everything except the two referee hints
  location: new Set(['id','name','surface','sx','sy','color','isStation','interiorId','elevatorTo','tag','desc']),
};
const REFEREE_FIELDS = {
  body: new Set(['refNote','hook','npcs','checks','events','rsr','refnotes']),
  area: new Set(['desc','rsr','npcs','checks','events','refnotes','refNote','hook']),
  node: new Set(['refNote','refnotes','npcs','checks','hook']),
  location: new Set(['refNote','hook']),
};
// Fields whose current render gating disagrees with their assigned audience —
// reported so the referee knows the migration FIXES a current leak.
const KNOWN_CURRENT_LEAKS = [
  { struct: 'area', field: 'desc',
    note: 'MAIN.*.desc renders unconditionally at index.html:5954 (no !pm gate, unlike rsr at :5953) so it currently leaks to players. Classified `referee` here — redaction fixes the leak.' },
];

// ── Extract a `const NAME = <expr>;` value from the source by bracket-matching ─
function extractConst(src, name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*`);
  const m = re.exec(src);
  if (!m) throw new Error(`could not locate const ${name}`);
  let i = m.index + m[0].length;
  const open = src[i];
  const close = open === '{' ? '}' : open === '[' ? ']' : null;
  if (!close) throw new Error(`${name} is not an object/array literal`);
  // Bracket-match, skipping strings/comments so braces inside text don't fool us.
  let depth = 0, inStr = null, inLine = false, inBlock = false;
  for (; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && src[i + 1] === '/') { inBlock = false; i++; } continue; }
    if (inStr) { if (c === inStr && p !== '\\') inStr = null; continue; }
    if (c === '/' && src[i + 1] === '/') { inLine = true; continue; }
    if (c === '/' && src[i + 1] === '*') { inBlock = true; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(m.index + m[0].length, i);
}

// Evaluate a literal in a sandbox where any unknown identifier resolves to a
// harmless stub (the data is almost entirely literals; this tolerates the odd
// cross-reference without pulling in the whole 14k-line file).
function evalLiteral(exprSrc, predefined = {}) {
  const stub = new Proxy(predefined, {
    has: () => true,
    get: (t, k) => (k in t ? t[k] : (k === Symbol.unscopables ? undefined : undefined)),
  });
  // eslint-disable-next-line no-new-func
  const fn = new Function('__sandbox__', `with(__sandbox__){ return (${exprSrc}); }`);
  return fn(stub);
}

// ── Walk + classify ──────────────────────────────────────────────────────────
const fragments = []; // { path, audience, value }
const report = [];    // { path, audience, reason }

function classifyRecord(struct, record, path) {
  const safe = {}, ref = {};
  for (const [k, v] of Object.entries(record)) {
    if (v == null) continue;
    let audience;
    if (PLAYER_SAFE[struct]?.has(k)) audience = 'all';
    else if (REFEREE_FIELDS[struct]?.has(k)) audience = 'referee';
    else audience = 'referee'; // FAIL CLOSED
    const known = PLAYER_SAFE[struct]?.has(k) || REFEREE_FIELDS[struct]?.has(k);
    (audience === 'all' ? safe : ref)[k] = v;
    report.push({
      path: `${path}.${k}`, audience,
      reason: known ? 'classified' : 'FAIL-CLOSED (unknown field — review)',
    });
  }
  if (Object.keys(safe).length) fragments.push({ path, audience: 'all', value: safe });
  if (Object.keys(ref).length) fragments.push({ path, audience: 'referee', value: ref });
  return ref;
}

function run() {
  const src = readFileSync(htmlPath, 'utf8');

  // 1. Bodies
  const bodies = evalLiteral(extractConst(src, 'BASE_BODIES_AUROS'));
  bodies.forEach(b => {
    classifyRecord('body', b, `body.${b.id}`);
  });

  // 2. Station areas (MAIN) + their subs
  const MAIN = evalLiteral(extractConst(src, 'MAIN'));
  for (const [areaId, area] of Object.entries(MAIN)) {
    const { subs, ...areaFields } = area;
    classifyRecord('area', areaFields, `area.${areaId}`);
    if (subs && typeof subs === 'object') {
      for (const [subId, sub] of Object.entries(subs)) {
        classifyRecord('area', sub, `area.${areaId}.sub.${subId}`);
      }
    }
  }

  // 3. Galaxy nodes
  const nodes = evalLiteral(extractConst(src, 'GALAXY_NODES'));
  nodes.forEach(n => classifyRecord('node', n, `node.${n.id}`));

  // 4. Body-surface locations (BASE_LOCATIONS: system → body → [locations])
  const locations = evalLiteral(extractConst(src, 'BASE_LOCATIONS'));
  for (const [sysId, bodies] of Object.entries(locations)) {
    for (const [bodyId, locs] of Object.entries(bodies)) {
      locs.forEach(loc => classifyRecord('location', loc, `loc.${sysId}.${bodyId}.${loc.id}`));
    }
  }

  // 5. Referee event timeline (TIMED_EVENTS): the whole array is GM-only, stored
  // as one atomic referee fragment (a player token never receives it).
  const timed = evalLiteral(extractConst(src, 'TIMED_EVENTS'));
  fragments.push({ path: 'timed_events', audience: 'referee', value: timed });
  report.push({ path: 'timed_events', audience: 'referee', reason: 'whole array — GM-only event log' });

  // ── Write outputs ──
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'campaign_content.json'),
    JSON.stringify(fragments, null, 2));

  // Ready-to-run seed: paste into the Supabase SQL editor after the migration.
  const sqlLit = (s) => `'${String(s).replace(/'/g, "''")}'`;
  let sql = `-- Seed campaign_content (generated by tools/extract-content.mjs — do not hand-edit).\n`;
  sql += `-- Idempotent: re-running refreshes values. Run AFTER 0001_per_player_redaction.sql.\n`;
  sql += `begin;\ntruncate public.campaign_content;\n`;
  sql += `insert into public.campaign_content (path, audience, value) values\n`;
  sql += fragments.map(f =>
    `  (${sqlLit(f.path)}, ${sqlLit(JSON.stringify(f.audience))}::jsonb, ${sqlLit(JSON.stringify(f.value))}::jsonb)`
  ).join(',\n');
  sql += `\non conflict (path, audience) do update set value = excluded.value, updated_at = now();\ncommit;\n`;
  writeFileSync(resolve(outDir, 'campaign_content.seed.sql'), sql);

  const refCount = fragments.filter(f => f.audience === 'referee').length;
  const allCount = fragments.filter(f => f.audience === 'all').length;
  const failClosed = report.filter(r => r.reason.startsWith('FAIL-CLOSED'));

  let md = `# Content Classification Report\n\n`;
  md += `> Generated by \`tools/extract-content.mjs\` from \`${htmlPath.replace(repoRoot + '/', '')}\`.\n`;
  md += `> **The referee MUST review this before seeding** (Stage 0). Every row a\n`;
  md += `> player can see is marked \`all\`; everything else is \`referee\`.\n\n`;
  md += `## Summary\n\n`;
  md += `- Fragments: **${fragments.length}** (\`all\`: ${allCount}, \`referee\`: ${refCount})\n`;
  md += `- Fields classified: **${report.length}**\n`;
  md += `- **FAIL-CLOSED defaults (unrecognised → hidden — confirm these): ${failClosed.length}**\n\n`;

  md += `## Current-render leaks this migration fixes\n\n`;
  for (const k of KNOWN_CURRENT_LEAKS) md += `- \`${k.struct}.${k.field}\` — ${k.note}\n`;
  md += `\n## FAIL-CLOSED fields (review — were any of these meant to be player-visible?)\n\n`;
  if (!failClosed.length) md += `_None — every field matched the classification table._\n`;
  else for (const r of failClosed) md += `- \`${r.path}\`\n`;

  md += `\n## Player-visible (\`all\`) fields\n\n`;
  for (const r of report.filter(r => r.audience === 'all')) md += `- \`${r.path}\`\n`;

  writeFileSync(resolve(outDir, 'classification-report.md'), md);

  console.log(`✓ ${fragments.length} fragments → supabase/seed/campaign_content.json`);
  console.log(`  ${allCount} player-visible, ${refCount} referee-only`);
  console.log(`✓ classification-report.md (${failClosed.length} fail-closed defaults to review)`);
}

run();

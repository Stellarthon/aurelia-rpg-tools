#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// verify-split.mjs · re-runs the two offline gates for the index.html light split
// (see docs/ARCHITECTURE.md). Proves the split is a pure partition + load-order safe.
//
//   node tools/verify-split.mjs <pre-split-index.html>
//   # e.g.  git show <pre-split-commit>:index.html > /tmp/orig.html
//   #       node tools/verify-split.mjs /tmp/orig.html
//
// Gate 1 — partition-equivalence: concatenating the css <link>s and js <script
//          src>s named in the CURRENT index.html, in order, reproduces the ORIGINAL
//          <style> / <script> inner content byte-for-byte.
// Gate 2 — load-order: no top-level synchronous call references a function defined
//          in a later-loaded file (a hoist that splitting would break).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const refPath = process.argv[2];
if (!refPath) { console.error('usage: node tools/verify-split.mjs <pre-split-index.html>'); process.exit(2); }

const splitLines = (s) => s.match(/[^\n]*\n|[^\n]+/g) ?? [];
const read = (rel) => readFileSync(resolve(repoRoot, rel), 'utf8');

// ── original inner content (line-granular, excludes the tag lines) ───────────
const ref = readFileSync(refPath, 'utf8');
const refLines = splitLines(ref);
const lineIs = (i, t) => (refLines[i] ?? '').trim() === t;
const between = (openTag, closeTag, fromIdx = 0) => {
  let o = -1; for (let i = fromIdx; i < refLines.length; i++) if (lineIs(i, openTag)) { o = i; break; }
  let c = -1; for (let i = o + 1; i < refLines.length; i++) if (lineIs(i, closeTag)) { c = i; break; }
  if (o < 0 || c < 0) throw new Error(`could not find ${openTag} … ${closeTag}`);
  return { inner: refLines.slice(o + 1, c).join(''), close: c };
};
const cssInner = between('<style>', '</style>').inner;
const jsInner = between('<script>', '</script>').inner;          // first script == the main one

// ── current wiring: ordered css/js the split index.html actually loads ───────
const cur = read('index.html');
const cssFiles = [...cur.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(m => m[1]);
const jsFiles  = [...cur.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);

const cssConcat = cssFiles.map(read).join('');
const jsConcat  = jsFiles.map(read).join('');

let ok = true;
function gate1(name, orig, concat, files) {
  if (orig === concat) { console.log(`GATE1 ${name}: PASS — byte-identical (${orig.length} B across ${files.length} files)`); return; }
  ok = false;
  const n = Math.min(orig.length, concat.length); let i = 0; while (i < n && orig[i] === concat[i]) i++;
  console.log(`GATE1 ${name}: FAIL — origLen=${orig.length} concatLen=${concat.length}, first diff @${i}`);
  console.log(`  orig:   ${JSON.stringify(orig.slice(i, i + 60))}`);
  console.log(`  concat: ${JSON.stringify(concat.slice(i, i + 60))}`);
}
gate1('CSS', cssInner, cssConcat, cssFiles);
gate1('JS', jsInner, jsConcat, jsFiles);

// ── Gate 2 — load-order audit over the concatenated js (== original) ─────────
// Boundaries (1-based first line of each js file) derived from real file sizes.
const bounds = []; let acc = 1;
for (const f of jsFiles) { bounds.push(acc); acc += splitLines(read(f)).length; }
bounds.push(acc);
const fileOf = (ln) => { let i = 0; while (i < bounds.length - 1 && ln >= bounds[i + 1]) i++; return i; };

const jsl = jsConcat.split('\n');                                  // 1-based: line N = jsl[N-1]
const defLine = new Map();
for (let n = 1; n <= jsl.length; n++) {
  const L = jsl[n - 1] ?? '';
  const m = /^function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(L) || /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(L);
  if (m && !defLine.has(m[1])) defLine.set(m[1], n);
}
const HOST = new Set(['document','window','navigator','setTimeout','setInterval','clearTimeout','clearInterval',
  'console','localStorage','requestAnimationFrame','cancelAnimationFrame','fetch','Math','JSON','Object','Array',
  'Date','Promise','Set','Map','String','Number','parseInt','parseFloat','matchMedia','alert','queueMicrotask']);
const violations = [];
for (let n = 1; n <= jsl.length; n++) {
  const L = jsl[n - 1] ?? '';
  if (/^(?:async\s+)?function\s/.test(L)) continue;
  const m = /^([A-Za-z_$][\w$]*)\s*[.(]/.exec(L);
  if (!m || !/^[A-Za-z_$][\w$.]*\(/.test(L) || HOST.has(m[1])) continue;
  const d = defLine.get(m[1]);
  if (d && d > n) violations.push({ n, name: m[1], d, callFile: fileOf(n), defFile: fileOf(d), text: L.trim().slice(0, 80) });
}
if (violations.length === 0) {
  console.log(`GATE2: PASS — no top-level synchronous forward reference across ${jsFiles.length} files`);
} else {
  ok = false;
  console.log(`GATE2: FAIL — ${violations.length} hoisting-dependent forward reference(s):`);
  for (const v of violations) console.log(`  L${v.n} ${v.name}() needs def L${v.d} (file ${v.defFile} > ${v.callFile}): ${v.text}`);
}

console.log(ok ? '\nVERIFY: PASS' : '\nVERIFY: FAIL');
process.exit(ok ? 0 : 1);

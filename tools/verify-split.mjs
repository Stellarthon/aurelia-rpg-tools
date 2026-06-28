#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// verify-split.mjs · re-runs the two offline gates for the index.html light split
// (see docs/ARCHITECTURE.md). Proves the split is a partition (+ one declared
// load-order relocation) that is load-order safe.
//
//   node tools/verify-split.mjs <pre-split-index.html>
//   # NB on Windows/autocrlf: `git show <commit>:index.html` emits LF and will
//   #   diff falsely against the CRLF working tree. Capture the original through
//   #   the same smudge filter instead, e.g. a temp worktree at the pre-split commit.
//
// Gate 1 — partition-equivalence: concatenating the css <link>s and js <script
//          src>s named in the CURRENT index.html, in order, reproduces the ORIGINAL
//          <style> / <script> inner content byte-for-byte — EXCEPT for the declared
//          RELOCATIONS below, which are reversed first (proving nothing else changed).
// Gate 2 — load-order: a depth/scope-aware scan that no SYNCHRONOUS top-level
//          statement (incl. inside top-level if/try/for blocks and IIFE bodies, not
//          just column-0 lines) references a symbol defined in a later-loaded file.
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

// ── Declared load-order relocations (the only sanctioned reordering) ─────────
// Each entry moved a synchronous statement from its source position into a later
// file so it runs after its dependencies are defined. Reversing every relocation
// must turn the load-order concatenation back into the original byte-for-byte —
// that is the partition proof: nothing else was edited.
const RELOCATIONS = [{
  note: "player-mode polling start: moved out of 30-system-body.js boot block → tail of 98-trackers-boot.js",
  added:                                                   // suffix appended to the last js file (file 98)
    "\r\n" +
    "// --- Relocated from the 30-system-body.js boot block (load-order fix) ---\r\n" +
    "// Start shared-state / alert / combat polling for a returning player-mode device\r\n" +
    "// AFTER files 55/75/80 have defined start*Polling(). Classic <script> tags do not\r\n" +
    "// hoist a later file's function declarations across the file boundary, so this must\r\n" +
    "// run last (see docs/ARCHITECTURE.md, the load-order rule).\r\n" +
    "try { if(localStorage.getItem(\"aurelia_pm\")===\"1\"){ startPolling(); startAlertPolling(); startCombatPolling(); } } catch(e){}\r\n",
  anchor:  "add('pm-active');;",                           // unique site the calls were cut from (file 30)
  restore: " startPolling(); startAlertPolling(); startCombatPolling();",
}];

function reverseRelocations(js) {
  let out = js, ok = true, notes = [];
  for (const r of RELOCATIONS) {
    if (!out.endsWith(r.added)) { ok = false; notes.push(`  ✗ expected relocated block at tail of load order not found: ${r.note}`); continue; }
    out = out.slice(0, out.length - r.added.length);
    const n = out.split(r.anchor).length - 1;
    if (n !== 1) { ok = false; notes.push(`  ✗ relocation anchor occurs ${n}× (want 1): ${r.note}`); continue; }
    out = out.replace(r.anchor, r.anchor + r.restore);
    notes.push(`  ↩ reversed: ${r.note}`);
  }
  return { out, ok, notes };
}

let ok = true;
function gate1(name, orig, concat) {
  if (orig === concat) { console.log(`GATE1 ${name}: PASS — byte-identical (${orig.length} chars across the files)`); return; }
  const n = Math.min(orig.length, concat.length); let i = 0; while (i < n && orig[i] === concat[i]) i++;
  ok = false;
  console.log(`GATE1 ${name}: FAIL — origLen=${orig.length} concatLen=${concat.length}, first diff @${i}`);
  console.log(`  orig:   ${JSON.stringify(orig.slice(i, i + 60))}`);
  console.log(`  concat: ${JSON.stringify(concat.slice(i, i + 60))}`);
}
gate1('CSS', cssInner, cssConcat);

// JS gate: pure-partition, else partition-modulo-declared-relocations.
if (jsInner === jsConcat) {
  console.log(`GATE1 JS: PASS — byte-identical (${jsInner.length} chars), pure partition`);
} else {
  const { out, ok: rok, notes } = reverseRelocations(jsConcat);
  notes.forEach(s => console.log(s));
  if (rok && out === jsInner) {
    console.log(`GATE1 JS: PASS — partition byte-identical after reversing ${RELOCATIONS.length} declared relocation(s)`);
  } else {
    ok = false;
    const n = Math.min(jsInner.length, out.length); let i = 0; while (i < n && jsInner[i] === out[i]) i++;
    console.log(`GATE1 JS: FAIL — reconstruction != original (first diff @${i})`);
    console.log(`  orig:   ${JSON.stringify(jsInner.slice(i, i + 60))}`);
    console.log(`  recon:  ${JSON.stringify(out.slice(i, i + 60))}`);
  }
}

// ── Gate 2 — depth/scope-aware load-order audit over the loaded js files ─────
// A call/reference is SYNCHRONOUS-AT-LOAD when every enclosing function-body scope
// is an IIFE (incl. none → top level / top-level if/try/for block). A sync ref to a
// top-level symbol defined in a LATER file is the hoist that splitting would break.
// (typeof-guarded refs are treated as safe, matching the documented exception.)
const parts = jsFiles.map(read);
const code = parts.join('');
const fb = []; { let a = 0; parts.forEach((p, i) => { fb.push([a, a + p.length, i]); a += p.length; }); }
const fileAt = (pos) => { for (const [a, b, i] of fb) if (pos >= a && pos < b) return i; return parts.length - 1; };
const lineAt = (pos) => { const e = fb.find(([a, b]) => pos >= a && pos < b) ?? fb[fb.length - 1]; let ln = 1; for (let k = e[0]; k < pos; k++) if (code[k] === '\n') ln++; return [jsFiles[e[2]], ln]; };
const lineTextAt = (pos) => { let s = pos; while (s > 0 && code[s - 1] !== '\n') s--; let e = pos; while (e < code.length && code[e] !== '\n') e++; return code.slice(s, e); };

const defFnFile = new Map(), defVarFile = new Map();
parts.forEach((p, fi) => {
  for (const m of p.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) if (!defFnFile.has(m[1])) defFnFile.set(m[1], fi);
  for (const m of p.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) if (!defVarFile.has(m[1])) defVarFile.set(m[1], fi);
});

const KW_CTRL = new Set(['if','for','while','switch','catch','with']);
const KW_BLOCK = new Set(['try','else','do','finally']);
const KW = new Set([...KW_CTRL, ...KW_BLOCK, 'function','return','typeof','new','in','of','instanceof','await','yield','delete','void','case','const','let','var','class','extends','throw']);
const fnIntervals = []; const calls = [];
{
  let i = 0; const n = code.length; const braceStack = []; const parenWord = []; let prevWord = '', prevSig = '';
  const nextSig = (from) => { let j = from; while (j < n) { const c = code[j]; if (c === ' '||c==='\t'||c==='\r'||c==='\n') { j++; continue; } if (c==='/'&&code[j+1]==='/') { while (j<n&&code[j]!=='\n') j++; continue; } if (c==='/'&&code[j+1]==='*') { j+=2; while (j<n&&!(code[j]==='*'&&code[j+1]==='/')) j++; j+=2; continue; } return j; } return -1; };
  while (i < n) {
    const c = code[i], d = code[i + 1];
    if (c==='/'&&d==='/') { while (i<n&&code[i]!=='\n') i++; continue; }
    if (c==='/'&&d==='*') { i+=2; while (i<n&&!(code[i]==='*'&&code[i+1]==='/')) i++; i+=2; continue; }
    if (c==='"'||c==="'") { const q=c; i++; while (i<n&&code[i]!==q){ if(code[i]==='\\') i++; i++; } i++; prevSig=q; prevWord=''; continue; }
    if (c==='`') { i++; while (i<n){ if(code[i]==='\\'){i+=2;continue;} if(code[i]==='`'){i++;break;} if(code[i]==='$'&&code[i+1]==='{'){ let dep=1;i+=2; while(i<n&&dep){const cc=code[i]; if(cc==='{')dep++; else if(cc==='}')dep--; if(dep)i++;} i++; continue;} i++; } prevSig='`'; prevWord=''; continue; }
    if (c==='/' && !/[A-Za-z0-9_$)\]}]/.test(prevSig) && prevSig!=='`'&&prevSig!=='"'&&prevSig!=="'") {
      let j=i+1, cls=false; while (j<n){ const cc=code[j]; if(cc==='\\'){j+=2;continue;} if(cc==='[')cls=true; else if(cc===']')cls=false; else if(cc==='/'&&!cls){j++;break;} else if(cc==='\n')break; j++; }
      if (code[j-1]==='/') { i=j; while (i<n&&/[a-z]/.test(code[i])) i++; prevSig='/'; prevWord=''; continue; }
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j=i; while (j<n&&/[A-Za-z0-9_$]/.test(code[j])) j++;
      const word = code.slice(i,j); const after = nextSig(j); const ac = after>=0?code[after]:'';
      if (!KW.has(word) && (ac==='('||ac==='.')) { if (!(prevWord==='function'&&ac==='(')) calls.push({ pos:i, name:word }); }
      prevWord=word; prevSig=code[j-1]; i=j; continue;
    }
    if (c==='(') { parenWord.push(prevWord); prevSig=c; prevWord=''; i++; continue; }
    if (c===')') { const w=parenWord.pop()??''; prevSig=c; prevWord='CALLCLOSE:'+w; i++; continue; }
    if (c==='{') {
      let isFn=false;
      if (prevSig==='>') isFn=true;
      else if (typeof prevWord==='string'&&prevWord.startsWith('CALLCLOSE:')) { const w=prevWord.slice('CALLCLOSE:'.length); isFn=!KW_CTRL.has(w); }
      else if (KW_BLOCK.has(prevWord)) isFn=false;
      else isFn=false;
      braceStack.push({ isFn, start:i }); prevSig=c; prevWord=''; i++; continue;
    }
    if (c==='}') {
      const fr=braceStack.pop();
      if (fr&&fr.isFn) { const after=nextSig(i+1); const ac=after>=0?code[after]:''; let iife=false; if(ac==='(')iife=true; else if(ac===')'){ const a2=nextSig(after+1); if(a2>=0&&code[a2]==='(')iife=true; } fnIntervals.push({ start:fr.start, end:i, iife }); }
      prevSig=c; prevWord=''; i++; continue;
    }
    if (c===' '||c==='\t'||c==='\r'||c==='\n') { i++; continue; }
    prevSig=c; prevWord=''; i++;
  }
}
const syncAtLoad = (pos) => fnIntervals.filter(f => pos>f.start&&pos<f.end).every(f => f.iife);
const violations = [];
for (const cl of calls) {
  const df = defFnFile.has(cl.name) ? defFnFile.get(cl.name) : (defVarFile.has(cl.name) ? defVarFile.get(cl.name) : -1);
  if (df < 0) continue;
  const cf = fileAt(cl.pos);
  if (df <= cf) continue;
  if (!syncAtLoad(cl.pos)) continue;
  if (new RegExp(`typeof\\s+${cl.name}\\b`).test(lineTextAt(cl.pos))) continue;   // documented typeof-guard exception
  const [file, line] = lineAt(cl.pos);
  violations.push({ file, line, name: cl.name, defFile: jsFiles[df], callFile: jsFiles[cf], kind: defFnFile.has(cl.name) ? 'function' : 'var/const' });
}
if (violations.length === 0) {
  console.log(`GATE2: PASS — no synchronous forward reference across ${jsFiles.length} files (scanned ${calls.length} call/member refs, ${fnIntervals.length} fn scopes)`);
} else {
  ok = false;
  console.log(`GATE2: FAIL — ${violations.length} synchronous forward reference(s) into a later-loaded file:`);
  for (const v of violations) console.log(`  ✗ ${v.file}:${v.line}  ${v.name}() [${v.kind}] defined in ${v.defFile} (called from ${v.callFile})`);
}

console.log(ok ? '\nVERIFY: PASS' : '\nVERIFY: FAIL');
process.exit(ok ? 0 : 1);

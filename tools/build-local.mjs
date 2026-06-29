// build-local.mjs — produce a self-contained index.local.html for double-click local viewing.
// Inlines every `<link rel="stylesheet" href="css/…">` and `<script src="js/…">` from the modular
// index.html (the DEPLOYED source of truth — never overwritten) into one standalone file. No deps.
//
//   node tools/build-local.mjs
//
// Output index.local.html is a LOCAL ARTIFACT (gitignored). Rebuild it after any css/ or js/ change.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// Neutralise any literal close-tags inside inlined content so they can't terminate the wrapper early.
const safeJS  = s => s.replace(/<\/script>/gi, '<\\/script>');
const safeCSS = s => s.replace(/<\/style>/gi, '<\\/style>');

let html = read('index.html');
let css = 0, js = 0;

// <link rel="stylesheet" href="css/x.css"> → <style>…</style>
html = html.replace(/<link\b[^>]*\bhref="(css\/[^"]+)"[^>]*>/gi, (m, href) => {
  if(!/stylesheet/i.test(m)) return m;
  css++; return `<style data-inlined="${href}">\n${safeCSS(read(href))}\n</style>`;
});

// <script src="js/x.js"></script> → <script>…</script>
html = html.replace(/<script\b[^>]*\bsrc="(js\/[^"]+)"[^>]*>\s*<\/script>/gi, (m, src) => {
  js++; return `<script data-inlined="${src}">\n${safeJS(read(src))}\n</script>`;
});

fs.writeFileSync(path.join(ROOT, 'index.local.html'), html);
console.log(`index.local.html built — inlined ${css} stylesheet(s) + ${js} script(s), ${(html.length/1024).toFixed(0)}kB`);
if(css !== 2 || js !== 18) console.warn(`⚠ expected 2 css + 18 js (got ${css} + ${js}) — check index.html references`);

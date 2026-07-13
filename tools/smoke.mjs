#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// smoke.mjs · headless boot smoke test for the single-page app.
//
//   node tools/smoke.mjs
//
// Serves the repo over http and drives it in headless Chromium to prove:
//   1. Configured (the checked-in config.js present) → the app boots to its access
//      gate with no console errors and no css/js load failures.
//   2. Unconfigured (config.js temporarily removed) → the first-run setup wizard
//      takes over: index.html redirects to setup.html before the app boots.
//   3. The campaign-config resolver actually flows: an overridden config.js drives
//      the live SUPABASE_URL / ACCESS_CODE / DESIGN_MODE_CODE / imperialDate / title.
//
// Browser resolution order: $PLAYWRIGHT_EXECUTABLE → a pre-installed
// /opt/pw-browsers chromium → whatever `playwright` downloaded (CI installs it).
// Exits non-zero on the first failure.
// ─────────────────────────────────────────────────────────────────────────────
import http from 'node:http';
import { readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'config.js');

function loadChromium(){
  try { return require('playwright').chromium; } catch (e) {}
  try { return require('playwright-core').chromium; } catch (e) {}
  console.error('smoke: neither "playwright" nor "playwright-core" is installed.');
  process.exit(2);
}
function findExecutable(){
  if (process.env.PLAYWRIGHT_EXECUTABLE && existsSync(process.env.PLAYWRIGHT_EXECUTABLE)) return process.env.PLAYWRIGHT_EXECUTABLE;
  try {
    for (const d of readdirSync('/opt/pw-browsers')) {
      if (/^chromium-\d+$/.test(d)) {
        const p = `/opt/pw-browsers/${d}/chrome-linux/chrome`;
        if (existsSync(p)) return p;
      }
    }
  } catch (e) {}
  return null; // let playwright use its own downloaded browser
}

const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
  '.webmanifest':'application/manifest+json', '.png':'image/png', '.jpg':'image/jpeg', '.pdf':'application/pdf', '.svg':'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !existsSync(fp)) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(await readFile(fp));
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const chromium = loadChromium();
const exe = findExecutable();
const browser = await chromium.launch(exe ? { executablePath: exe, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });

let pass = true;
const check = (label, ok, extra = '') => { if (!ok) pass = false; console.log(`${ok ? 'OK ' : 'BAD'}  ${label}${extra ? '  ' + extra : ''}`); };

async function loadPage(url) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [], assetFails = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('response', r => {
    const u = r.url();
    if (r.status() >= 400 && (u.includes('/js/') || u.includes('/css/') || u.endsWith('/index.html'))) assetFails.push(u.replace(base, '') + ' HTTP ' + r.status());
  });
  await page.goto(base + url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1200);
  return { ctx, page, errors, assetFails };
}
// App-relevant console errors only (Supabase/network/favicon/SW are environmental).
const relevant = e => !/serviceWorker|ServiceWorker|favicon|net::ERR_|Failed to fetch|Failed to load resource|supabase\.co|storage\/v1|rest\/v1|functions\/v1/i.test(e);

try {
  // ── 1) Configured deploy ──
  console.log('\n=== 1 · configured (config.js present) ===');
  {
    const { ctx, page, errors, assetFails } = await loadPage('/index.html');
    check('no redirect (stays on index.html)', !page.url().includes('setup.html'), page.url().replace(base, ''));
    check('reaches the access gate', await page.$('#pw-gate') !== null);
    check('no app console errors', errors.filter(relevant).length === 0, errors.filter(relevant).join(' | '));
    check('no css/js load failures', assetFails.length === 0, assetFails.join(' | '));
    await ctx.close();
  }

  // ── 2) Unconfigured → wizard redirect ──
  console.log('\n=== 2 · unconfigured (no config.js) ===');
  const bak = CONFIG + '.smokebak';
  await rename(CONFIG, bak);
  try {
    const { ctx, page } = await loadPage('/index.html');
    check('redirects to setup.html', page.url().includes('setup.html'), page.url().replace(base, ''));
    check('setup wizard rendered', await page.$('#stepper') !== null);
    await ctx.close();
  } finally { await rename(bak, CONFIG); }

  // ── 3) Config resolution flows into the live constants ──
  console.log('\n=== 3 · config.js overrides the live constants ===');
  const bak2 = CONFIG + '.smokebak2';
  await rename(CONFIG, bak2);
  const override = { campaignName: 'SMOKE CAMPAIGN', accessCode: 'SmokeAccess', designCode: 'SmokeDesign',
    supabaseUrl: 'https://smoke.example.co', supabaseKey: 'sb_publishable_SMOKE', imperialStart: { day: 7, year: 1234 } };
  await writeFile(CONFIG, 'window.AURELIA_CONFIG = ' + JSON.stringify(override) + ';\n');
  try {
    const { ctx, page } = await loadPage('/index.html');
    const got = await page.evaluate(() => ({
      url: typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : null,
      key: typeof SUPABASE_KEY !== 'undefined' ? SUPABASE_KEY : null,
      access: typeof ACCESS_CODE !== 'undefined' ? ACCESS_CODE : null,
      design: typeof DESIGN_MODE_CODE !== 'undefined' ? DESIGN_MODE_CODE : null,
      imp: typeof imperialDate !== 'undefined' ? imperialDate : null,
      title: document.title,
    }));
    check('SUPABASE_URL', got.url === 'https://smoke.example.co', got.url);
    check('SUPABASE_KEY', got.key === 'sb_publishable_SMOKE', got.key);
    check('ACCESS_CODE', got.access === 'SmokeAccess', got.access);
    check('DESIGN_MODE_CODE', got.design === 'SmokeDesign', got.design);
    check('imperialDate', JSON.stringify(got.imp) === JSON.stringify({ day: 7, year: 1234 }), JSON.stringify(got.imp));
    check('document.title', got.title === 'SMOKE CAMPAIGN', got.title);
    await ctx.close();
  } finally { await unlink(CONFIG).catch(() => {}); await rename(bak2, CONFIG); }
} finally {
  await browser.close();
  server.close();
}

console.log('\n==== SMOKE:', pass ? 'PASS' : 'FAIL', '====');
process.exit(pass ? 0 : 1);

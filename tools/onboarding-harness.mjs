#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// onboarding-harness.mjs · headless integration test for the SETUP ↔ WALKTHROUGH
// wiring (js/99-onboarding.js). Complements tools/smoke.mjs, which proves the
// setup *wizard* redirect + config resolution; this one proves the first-run
// help that a configured deploy shows once someone is past the gate, and every
// seam where that help hands back to Campaign Setup (setup.html).
//
//   node tools/onboarding-harness.mjs
//
// Serves the repo over http and drives it in headless Chromium to prove:
//   1. Referee first-run — pass the real access gate on the configured deploy →
//      the referee welcome auto-runs, its guided tour completes, and the
//      `aurelia_ref_onboarded` flag then suppresses a second auto-run on reload.
//   2. Player first-run — an invite-link viewer (player mode + identity) auto-runs
//      the *player* welcome/tour and sets `aurelia_player_onboarded`.
//   3. Setup health → setup — openSetupHealth() reports each setting's source
//      (config.js for the deployed ones) and "Open Campaign Setup" lands on setup.html.
//   4. Misconfig banner → setup — a placeholder config.js raises the referee-only
//      "not connected" banner, whose Campaign Setup button lands on setup.html.
//   5. Replay — an already-onboarded referee does NOT auto-run, but "Take the tour"
//      (startWalkthrough) still re-opens the welcome, role auto-detected.
//
// Supabase is network-blocked throughout: the walkthrough logic is what's under
// test, and it must not depend on live backend state. Browser resolution mirrors
// smoke.mjs. Exits non-zero on the first failing check.
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
  console.error('onboarding: neither "playwright" nor "playwright-core" is installed.');
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

// Disable the intro splash (a per-device setting) so "settled" is reached on the
// first poll — the auto-run timing itself is exercised faithfully in scenario 1,
// where the splash stays on and the gate is passed for real.
const NO_SPLASH = JSON.stringify({ intro: { enabled: false } });

// A fresh, Supabase-blocked context. `seed` is an object of localStorage keys to
// preset before the app boots (gate/role/onboarded flags).
async function context(seed){
  const ctx = await browser.newContext();
  await ctx.route(/supabase\.co/i, r => r.abort());
  if (seed && Object.keys(seed).length){
    await ctx.addInitScript(s => { try { for (const k in s) localStorage.setItem(k, s[k]); } catch(e){} }, seed);
  }
  return ctx;
}
const q = (page, sel) => page.$(sel);
const waitFor = (page, sel, timeout = 6000) => page.waitForSelector(sel, { timeout }).catch(() => null);
// Click Next/Finish until the coached tour tears itself down (or a guard trips).
async function runTourToEnd(page){
  let guard = 0;
  while (await q(page, '.arw-tip') && guard++ < 40){
    await page.click('[data-arw="next"]').catch(() => {});
    await page.waitForTimeout(120);
  }
  return await q(page, '#arw-root') === null;
}

try {
  // ── 1) Referee first-run: real gate → auto welcome → tour → onboarded → no re-run ──
  console.log('\n=== 1 · referee first-run walkthrough (configured deploy) ===');
  {
    const ctx = await context();                       // no seed: hit the gate for real, splash on
    const page = await ctx.newPage();
    await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
    check('access gate shown on fresh configured load', await q(page, '#pw-gate:not(.hidden)') !== null);
    check('no walkthrough before the gate is passed', await q(page, '#arw-root') === null);

    const code = await page.evaluate(() => (window.AURELIA_CONFIG && window.AURELIA_CONFIG.accessCode) || 'Traveller2E!');
    await page.fill('#pw-input', code);
    await page.click('#pw-submit');

    const card = await waitFor(page, '#arw-root .arw-card', 15000);
    check('referee welcome auto-runs after passing the gate', !!card);
    const title = card ? await card.$eval('.arw-h', el => el.textContent).catch(() => '') : '';
    check('welcome shows the referee copy', /Welcome, Referee/i.test(title), title);
    check('onboarded flag not set while the welcome is still open',
      await page.evaluate(() => localStorage.getItem('aurelia_ref_onboarded')) !== '1');

    await page.click('[data-arw="tour"]');
    const tip = await waitFor(page, '.arw-tip', 5000);
    check('guided tour starts from the welcome', !!tip);
    const counter = tip ? await tip.$eval('.arw-count', el => el.textContent).catch(() => '') : '';
    check('tour opens on step 1', /Step 1 of/i.test(counter), counter);

    // Step through the spotlight tour; the referee tour then hands off to the help hub.
    let guard = 0;
    while (await q(page, '.arw-tip') && guard++ < 40){
      await page.click('[data-arw="next"]').catch(() => {});
      await page.waitForTimeout(120);
    }
    const hub = await waitFor(page, '.arw-topics', 5000);
    check('tour hands off to the "go deeper" help hub', !!hub);
    check('onboarded flag not set until the hub is dismissed',
      await page.evaluate(() => localStorage.getItem('aurelia_ref_onboarded')) !== '1');

    // Open a deep-dive topic, confirm it has real detail, then return to the hub.
    await page.click('[data-topic="0"]');
    check('a deep-dive topic opens with detail', await waitFor(page, '.arw-sh', 5000) !== null);
    check('topic card labels itself one of the seven guides',
      /of 7/i.test(await page.$eval('.arw-kick', el => el.textContent).catch(() => '')));
    await page.click('[data-arw="hub"]');
    check('"All topics" returns to the hub', await waitFor(page, '.arw-topics', 3000) !== null);

    // Finish from the hub.
    await page.click('[data-arw="close"]');
    await page.waitForTimeout(200);
    check('dismissing the hub tears down the overlay', await q(page, '#arw-root') === null);
    check('referee onboarded flag set after finishing',
      await page.evaluate(() => localStorage.getItem('aurelia_ref_onboarded')) === '1');

    // Reload (splash off now, so "settled" is quick) → the auto-run must stay quiet.
    await page.evaluate(v => localStorage.setItem('aurelia_cache_splash-config', v), NO_SPLASH);
    await page.reload({ waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2500);
    check('walkthrough does not auto-run a second time', await q(page, '#arw-root') === null);
    await ctx.close();
  }

  // ── 2) Player first-run: invite-link viewer → player welcome/tour ──
  console.log('\n=== 2 · player first-run walkthrough (invite link) ===');
  {
    const ctx = await context({
      aurelia_access: '1', aurelia_pm: '1', aurelia_identity: 'Rhett Calder',
      'aurelia_cache_splash-config': NO_SPLASH,
    });
    const page = await ctx.newPage();
    await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });

    const card = await waitFor(page, '#arw-root .arw-card', 15000);
    check('player welcome auto-runs for an invite-link viewer', !!card);
    const title = card ? await card.$eval('.arw-h', el => el.textContent).catch(() => '') : '';
    check('welcome shows the player copy with the identity', /Welcome aboard/i.test(title) && /Rhett Calder/.test(title), title);
    const cta = await page.$eval('[data-arw="tour"]', el => el.textContent).catch(() => '');
    check('player-flavoured tour CTA present', /Show me around/i.test(cta), cta);

    await page.click('[data-arw="tour"]');
    await waitFor(page, '.arw-tip', 5000);
    check('player tour runs to completion', await runTourToEnd(page));
    check('player onboarded flag set after finishing',
      await page.evaluate(() => localStorage.getItem('aurelia_player_onboarded')) === '1');
    check('referee flag left untouched by a player run',
      await page.evaluate(() => localStorage.getItem('aurelia_ref_onboarded')) !== '1');
    await ctx.close();
  }

  // ── 3) Setup health check reports sources and hands back to Campaign Setup ──
  console.log('\n=== 3 · setup health → Campaign Setup ===');
  {
    const ctx = await context({
      aurelia_access: '1', aurelia_ref_onboarded: '1', 'aurelia_cache_splash-config': NO_SPLASH,
    });
    const page = await ctx.newPage();
    await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(1200);
    check('no auto-run once the referee is already onboarded', await q(page, '#arw-root') === null);

    await page.evaluate(() => window.openSetupHealth());
    const card = await waitFor(page, '#arw-root .arw-card', 5000);
    check('setup health panel opens', !!card);
    const h = card ? await card.$eval('.arw-h', el => el.textContent).catch(() => '') : '';
    check('panel is the Setup health panel', /Setup health/i.test(h), h);

    const sources = await page.$$eval('.arw-hsrc', els => els.map(e => e.textContent.trim()));
    check('deployed settings are attributed to config.js', sources.filter(s => /config\.js/i.test(s)).length >= 3, JSON.stringify(sources));

    await page.click('[data-arw="setup"]');
    await page.waitForURL(/setup\.html/, { timeout: 5000 }).catch(() => {});
    check('"Open Campaign Setup" navigates to setup.html', page.url().includes('setup.html'), page.url().replace(base, ''));
    await ctx.close();
  }

  // ── 4) Placeholder config → misconfig banner → Campaign Setup ──
  console.log('\n=== 4 · misconfig banner → Campaign Setup ===');
  {
    const bak = CONFIG + '.onbbak';
    await rename(CONFIG, bak);
    const placeholder = { campaignName: '', accessCode: 'change-me-player-code', designCode: 'change-me-design-code',
      supabaseUrl: 'https://YOUR-PROJECT.supabase.co', supabaseKey: 'sb_publishable_YOUR_KEY', imperialStart: { day: 1, year: 1105 } };
    await writeFile(CONFIG, 'window.AURELIA_CONFIG = ' + JSON.stringify(placeholder) + ';\n');
    try {
      const ctx = await context({
        aurelia_access: '1', aurelia_ref_onboarded: '1', 'aurelia_cache_splash-config': NO_SPLASH,
      });
      const page = await ctx.newPage();
      await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
      const banner = await waitFor(page, '#arw-banner', 8000);
      check('misconfig banner appears for the referee on a placeholder config', !!banner);
      const msg = banner ? await banner.$eval('.arw-bmsg', el => el.textContent).catch(() => '') : '';
      check('banner names the unconnected backend', /connected|Campaign Setup/i.test(msg), msg);

      await page.click('[data-arw="bsetup"]');
      await page.waitForURL(/setup\.html/, { timeout: 5000 }).catch(() => {});
      check('banner "Campaign Setup" navigates to setup.html', page.url().includes('setup.html'), page.url().replace(base, ''));
      await ctx.close();
    } finally { await unlink(CONFIG).catch(() => {}); await rename(bak, CONFIG); }
  }

  // ── 5) Replay: onboarded referee stays quiet, but "Take the tour" re-opens it ──
  console.log('\n=== 5 · replay via "Take the tour" (startWalkthrough) ===');
  {
    const ctx = await context({
      aurelia_access: '1', aurelia_ref_onboarded: '1', 'aurelia_cache_splash-config': NO_SPLASH,
    });
    const page = await ctx.newPage();
    await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(1200);
    check('no auto welcome for an already-onboarded referee', await q(page, '#arw-root') === null);

    await page.evaluate(() => window.startWalkthrough());
    const card = await waitFor(page, '#arw-root .arw-card', 5000);
    check('"Take the tour" re-opens the welcome on demand', !!card);
    const t = card ? await card.$eval('.arw-h', el => el.textContent).catch(() => '') : '';
    check('replay auto-detects the referee role', /Welcome, Referee/i.test(t), t);
    await ctx.close();
  }

  // ── 6) Wizard "Test connection" must not call a non-Supabase URL valid (regression) ──
  console.log('\n=== 6 · setup wizard rejects URLs that are not a Supabase project ===');
  {
    const ctx = await context();
    const page = await ctx.newPage();
    await page.goto(base + '/setup.html', { waitUntil: 'load', timeout: 30000 });
    // Jump to the Connect step so #conn-result exists, then drive testConnection directly.
    const probe = url => page.evaluate(async u => {
      state.step = STEPS.findIndex(s => s.id === 'supabase'); render();
      state.supabase.url = u; state.supabase.key = 'sb_publishable_TEST';
      await testConnection();
      return { html: document.querySelector('#conn-result').innerHTML, tested: state.supabase.tested };
    }, url);

    const noScheme = await probe('my-project');           // no https:// → would resolve against our own origin
    check('a value with no scheme is not called valid', !/valid/i.test(noScheme.html) && noScheme.tested === false, noScheme.html);

    const wrongHost = await probe(base);                  // absolute, but our static host → 404 that is not PostgREST
    check('an absolute non-Supabase 404 is not called valid', !/valid/i.test(wrongHost.html) && wrongHost.tested === false, wrongHost.html);
    await ctx.close();
  }

  // ── 7) The "Referee guide" deep-dive hub and its topic content ──
  console.log('\n=== 7 · referee guide hub + deep-dive topics ===');
  {
    const ctx = await context({
      aurelia_access: '1', aurelia_ref_onboarded: '1', 'aurelia_cache_splash-config': NO_SPLASH,
    });
    const page = await ctx.newPage();
    await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(1000);

    await page.evaluate(() => window.openHelpTopics());
    check('📖 Referee guide opens the hub', await waitFor(page, '.arw-topics', 5000) !== null);
    check('hub offers all seven deep-dive topics', await page.$$eval('.arw-topic', els => els.length) === 7);

    // The economy topic must cover BOTH the simple and the realistic/living modes.
    await page.click('[data-topic="4"]');
    await waitFor(page, '.arw-sh', 5000);
    const econ = await page.$eval('#arw-root .arw-card', el => el.textContent).catch(() => '');
    check('economy topic covers the simple mode', /simple/i.test(econ), econ.slice(0, 60));
    check('economy topic covers the realistic/living mode', /full simulation|living/i.test(econ), '');
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log('\n==== ONBOARDING:', pass ? 'PASS' : 'FAIL', '====');
process.exit(pass ? 0 : 1);

# Aurelia RPG Tools

A browser-based **virtual tabletop for Traveller (Mongoose 2e)** — an interactive
referee map and toolkit for running campaigns in the Orion Arm. The whole app is a
single static page (installable as a PWA, works offline), backed by a free Supabase
project that syncs reveals, the clock, and notes between everyone at the table.

Players open a link on a laptop, tablet, or phone — nothing to install. The referee
runs the galaxy → system → station → deck-plan map, the Imperial clock, space combat,
a living economy, session tools, and per-player content redaction.

---

## Stand up your own campaign

You host the page once; your players just open the link. Roughly 10 minutes.

1. **Host the folder.** Any static host works — [Netlify Drop](https://app.netlify.com/drop)
   (drag the folder in, no account needed), GitHub Pages, or Cloudflare Pages. The link
   you get is what you share with players.
2. **Run the setup wizard.** Open **`setup.html`** on your hosted copy (a fresh, unconfigured
   copy redirects there automatically). It collects your Supabase project, access codes,
   campaign name, and players, gives you paste-ready SQL for the database, and generates a
   deployable **`config.js`**.
3. **Deploy `config.js`.** Upload it next to `index.html`. That's what carries your backend
   and codes to *every* device that opens your link. Done — hand out the invite links.

Re-run or edit any time from **🛡 Referee tools ▸ Campaign Setup**, and confirm everything
is wired with **🛡 Referee tools ▸ 🩺 Setup health**.

## First-run experience

- An **unconfigured copy** (no `config.js`, no completed setup) redirects to the setup
  wizard before the app boots.
- A **first-time referee** gets a welcome panel and an optional coached tour of the controls.
- A **first-time player** (opening their invite link) gets a lighter welcome + short tour.

  Replay either any time from **⚙ Settings ▸ Take the tour**.

## `config.js` — the campaign config contract

`index.html` loads an optional `config.js` first and reads `window.AURELIA_CONFIG`, resolving
each setting **`config.js` → `localStorage` (this device) → the built-in default**. Copy
[`config.example.js`](config.example.js) to `config.js`, or let the wizard generate it.

| Key | Purpose |
|-----|---------|
| `campaignName` | Browser-tab title (blank keeps the built-in title) |
| `accessCode` | The code players type at the gate |
| `designCode` | Referee-only code that unlocks Design Mode |
| `supabaseUrl` / `supabaseKey` | Your Supabase project URL + **publishable (anon)** key |
| `imperialStart` | Starting in-fiction date `{ day, year }` |

**Safe to publish:** the Supabase key is a publishable anon key (Row-Level Security gates it)
and the access/design codes are casual deterrents, visible in any shipped build by design.
Don't put genuine secrets in `config.js`.

> The checked-in `config.js` carries the reference campaign so the canonical deploy is
> configured out of the box. Forking to run your own? Replace it (or delete it to let the
> wizard launch on first load).

## The backend

The Supabase schema, per-player redaction, and Edge Functions live under
[`supabase/`](supabase/) — see [`supabase/README.md`](supabase/README.md). The wizard's
**Database** step gives you the paste-ready SQL; the optional per-player redaction path
(hiding referee content from players on their own devices) is documented there and in the
wizard's advanced section.

## Development

The app was split from one large `index.html` into ordered CSS/JS files **without changing
how it runs** — see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the load-order rules
and invariants. Classic `<script src>` (no ES modules): everything shares one hoisted global
scope, so load order matters.

```
index.html     markup + <link> css + ordered <script src> js + trailing SW <script>
config.js      per-deploy campaign config (window.AURELIA_CONFIG); config.example.js is the template
setup.html     the first-run setup wizard (generates config.js)
css/           tokens.css (design tokens) + app.css
js/            00-core-data … 99-onboarding  (numeric prefix = load order)
sw.js          offline app-shell service worker (precaches every css/js file)
supabase/      schema migrations, seed, and Edge Functions
tools/         node harnesses (see below)
docs/          architecture + planning notes
```

Standalone checks (dependency-free, `node <file>`):

- `tools/deck-harness.mjs` — logic checks for the deck editor's geometry.
- `tools/econ-corp-harness.cjs` — Living Economy corp-balance driver.
- `tools/verify-split.mjs <pre-split-index.html>` — proves the css/js split is a
  behaviour-preserving partition (needs the pre-split monolith as an argument).

CI (`.github/workflows/ci.yml`) runs `node --check` on every js file, the deck harness, a
headless boot smoke test (`tools/smoke.mjs`), and a headless setup + walkthrough integration
test (`tools/onboarding-harness.mjs` — first-run referee/player walkthroughs, the setup health
check, the misconfig banner including every hand-off back to the setup wizard, and the wizard's
connection test rejecting anything that isn't a real Supabase project).

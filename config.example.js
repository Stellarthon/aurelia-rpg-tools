/* ─────────────────────────────────────────────────────────────────────────
   Aurelia RPG Tools — campaign config TEMPLATE.

   Copy this file to `config.js` (same folder as index.html) and fill in your
   own values — or, easier, run the setup wizard (open setup.html), which
   generates a ready-to-deploy config.js for you.

   index.html loads config.js before anything else and reads window.AURELIA_CONFIG,
   so EVERY device that opens your link picks up these settings. Each value falls
   back to the built-in default baked into the js modules when omitted or empty.

   Safe to publish: the Supabase key is a *publishable* anon key (Row-Level
   Security gates it) and the access/design codes are casual deterrents — visible
   in any shipped build by design, not real security. Don't put genuine secrets here.
   ───────────────────────────────────────────────────────────────────────── */
window.AURELIA_CONFIG = {
  // Shown in the browser tab title. Leave "" to keep the built-in title.
  "campaignName": "",

  // The code players type at the gate to open the app.
  "accessCode": "change-me-player-code",

  // The referee-only code that unlocks Design Mode. Make it different.
  "designCode": "change-me-design-code",

  // Your Supabase project — Settings → API. The key is the anon / publishable one.
  "supabaseUrl": "https://YOUR-PROJECT.supabase.co",
  "supabaseKey": "sb_publishable_YOUR_KEY",

  // Starting in-fiction Imperial date (day-of-year 1–365, Imperial year).
  "imperialStart": { "day": 1, "year": 1105 }
};

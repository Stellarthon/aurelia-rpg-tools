/* ─────────────────────────────────────────────────────────────────────────
   Aurelia RPG Tools — campaign config.

   index.html loads this file before anything else and reads window.AURELIA_CONFIG,
   so EVERY device that opens the campaign link picks up these settings. That is
   what makes the backend, access codes and campaign name YOURS rather than the
   fallback defaults baked into the js modules. (localStorage can't do this — it
   is per-device, so it never reaches players.)

   This checked-in copy carries the reference campaign so the canonical deploy is
   configured out of the box (and the first-run setup wizard stays out of the way).

   Setting up your OWN campaign? Run the setup wizard (setup.html), download the
   config.js it generates, and REPLACE this file with it — or delete this file to
   let the wizard launch automatically on first load.

   Safe to publish: the Supabase key is a *publishable* anon key (Row-Level
   Security gates it) and the access/design codes are casual deterrents — visible
   in any shipped build by design, not real security. Don't put genuine secrets here.
   ───────────────────────────────────────────────────────────────────────── */
window.AURELIA_CONFIG = {
  "campaignName": "",
  "accessCode": "Traveller2E!",
  "designCode": "ilovetwix2012!",
  "supabaseUrl": "https://rarxefzcqvgqvxutprcq.supabase.co",
  "supabaseKey": "sb_publishable_KZ773h9ML7-e2jfyH2a9Lg_v-sREJIM",
  "imperialStart": { "day": 1, "year": 1105 }
};

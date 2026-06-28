// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM DATA
// ═══════════════════════════════════════════════════════════════════════════
const BASE_BODIES_AUROS = [
  {
    "id": "auros",
    "name": "Auros",
    "type": "K3 V Orange Dwarf · Primary Star",
    "tag": null,
    "color": "#E07030",
    "orbitAU": "—",
    "uwpString": "—",
    "diameter": "~1.08 M☉ diameter",
    "period": "—",
    "isMoon": false,
    "isStar": true,
    "displayRadius": 18,
    "desc": "A calm, long-lived orange dwarf approximately 78% the mass of Sol. Its light gives Aurelia's sky its distinctive copper tint and bathes the inner system in warm amber-gold. K-type stars are considered ideal for long-term colonisation: low flare activity, extended main-sequence lifespan, stable output for billions of years.\n\nThe Hegemony chose this system deliberately. Nothing about Aurelia was an accident.",
    "readAloud": null,
    "orbitPos": null
  },
  {
    "id": "scoria",
    "name": "Scoria",
    "type": "Terrestrial · Scorched Rock",
    "tag": "FLAVOUR",
    "color": "#887755",
    "orbitAU": "0.28 AU",
    "uwpString": "X100000-0",
    "diameter": "~4,800 km",
    "period": "48 standard days",
    "isMoon": false,
    "isStar": false,
    "displayRadius": 7,
    "desc": "A tidally locked inner world — ~430°C on the day side, -180°C on the night side. No atmosphere worth naming. A dead archive of early system formation, the night side covered in concentric impact craters.",
    "readAloud": null,
    "orbitPos": 1
  },
  {
    "id": "aurelia",
    "name": "Aurelia",
    "type": "Terrestrial · Jewel World",
    "tag": "CAMPAIGN HUB",
    "color": "#4A90D9",
    "orbitAU": "0.71 AU",
    "uwpString": "B867976-C",
    "diameter": "~11,400 km",
    "period": "214 standard days",
    "isMoon": false,
    "isStar": false,
    "displayRadius": 11,
    "desc": "The campaign's heart. A warm, dense world with extensive ocean coverage, a copper-tinted sky, and a population of 800 million in coastal arcologies and the deep-water city known as the Cradle.\n\nThe Hegemony's showpiece. Every promotional image shows the turquoise south coast and the twin peaks of the Spire Range.\n\nThe atmosphere has a classified taint: long-term unfiltered exposure causes progressive respiratory degradation over 20–30 years. The data is suppressed. The Cleaners know. The surface population does not.",
    "readAloud": "Aurelia from orbit: the atmosphere catches Auros's orange light and scatters it into something the colour of a lit copper kettle. The night side shows city-glow in chains along the coastline. The orbital station sits at L2, permanently in Aurelia's shadow.",
    "orbitPos": 2
  },
  {
    "id": "pallor",
    "name": "Pallor",
    "type": "Moon · Tidally Locked",
    "tag": "FLAVOUR",
    "color": "#B0B0B0",
    "orbitAU": "Aurelia moon",
    "uwpString": "Y200000-0",
    "diameter": "~2,400 km",
    "period": "18.3 standard days",
    "isMoon": true,
    "parentId": "aurelia",
    "isStar": false,
    "desc": "Aurelia's sole natural satellite — small, grey, airless, tidally locked. Not beautiful enough to feature in Hegemony promotional material.\n\nThere is a decommissioned relay station on the far side that has been dark for twenty years. The RSR uses it for dead drops.",
    "readAloud": null,
    "orbitPos": null
  },
  {
    "id": "greymantle",
    "name": "Greymantle",
    "type": "Terrestrial · Ice-Rock",
    "tag": "FLAVOUR",
    "color": "#9999AA",
    "orbitAU": "1.8 AU",
    "uwpString": "D200100-4",
    "diameter": "~6,200 km",
    "period": "~2.4 standard years",
    "isMoon": false,
    "isStar": false,
    "displayRadius": 8,
    "desc": "A cold, thin-atmosphered mid-system world with ~100 people in a pressurised way-station. Greymantle's main industry is being on the route between Aurelia and the Veil — Class D starport, refuelling tanks, two people who don't ask questions about cargo manifests.",
    "readAloud": null,
    "orbitPos": 3
  },
  {
    "id": "veil",
    "name": "The Veil",
    "type": "Asteroid Belt",
    "tag": "ADVENTURE HOOK",
    "color": "#8B7355",
    "orbitAU": "1.3 AU",
    "uwpString": "E000200-5",
    "diameter": "Diffuse belt, ~0.4 AU wide",
    "period": "~1.8 standard years (inner edge)",
    "isMoon": false,
    "isStar": false,
    "beltDensity": 420,
    "desc": "A dense asteroid belt — remnant of a planet that failed to coalesce, or perhaps one that was broken apart. At certain orbital positions it creates a faint dust haze visible from Aurelia at dawn.\n\nSmall, unlicensed population of ~300 belt miners, scavengers, and people avoiding questions. Their settlement: Cairn Station, Law Level 0.",
    "readAloud": "The belt doesn't look like much at approach — scattered rocks catching Auros's amber light. Then the density increases and navigation gets serious. Cairn Station announces itself with running lights and a comms challenge.",
    "orbitPos": 4
  },
  {
    "id": "tanath",
    "name": "Tanath",
    "type": "Gas Giant · Major",
    "tag": "ADVENTURE HOOK",
    "color": "#C87941",
    "orbitAU": "5.4 AU",
    "uwpString": "D——0164-8",
    "diameter": "~140,000 km (est.)",
    "period": "12.3 standard years",
    "isMoon": false,
    "isStar": false,
    "displayRadius": 18,
    "ringStyle": "major",
    "desc": "A warm, massive gas giant banded in deep amber and rust-red — a miniature echo of Auros itself. OmniSynth's Extraction Rig Tanath-7 operates in the upper atmosphere, extracting fuel for sale. Technically a licensed commercial operation. In practice also a data relay, crew rotation point, and a place to fence things without clean provenance.",
    "readAloud": "Tanath fills the screen even at standard approach distance. Deep amber striations over rust-red, white ammonia clouds at the poles in slow spirals. At the terminator, the night side glows faintly from internal heat.",
    "orbitPos": 5
  },
  {
    "id": "esk",
    "name": "Esk",
    "type": "Moon · Sensor Array",
    "tag": "RESTRICTED",
    "color": "#4A90D9",
    "orbitAU": "Tanath moon I",
    "uwpString": "C100089-9",
    "diameter": "~3,800 km",
    "period": "7.1 standard days",
    "isMoon": true,
    "parentId": "tanath",
    "isStar": false,
    "desc": "A small, airless moon with a large Hegemony sensor array watching the outer system — jump emergence points, approaching traffic. Eight Navy personnel on six-week rotations. They tend not to volunteer twice.",
    "readAloud": null,
    "orbitPos": null
  },
  {
    "id": "nara",
    "name": "Nara",
    "type": "Moon · Rest Station",
    "tag": "FLAVOUR",
    "color": "#9B7B5B",
    "orbitAU": "Tanath moon II",
    "uwpString": "D310112-7",
    "diameter": "~4,200 km",
    "period": "14.4 standard days",
    "isMoon": true,
    "parentId": "tanath",
    "isStar": false,
    "desc": "A pressurised rest dome OmniSynth built for Tanath-7 contractor rotation. Utilitarian — bunks, a rec room, a bar that serves two things and neither of them well. ~20 people at any time.",
    "readAloud": null,
    "orbitPos": null
  },
  {
    "id": "darkmoon",
    "name": "The Dark Moon",
    "type": "Moon · CLASSIFIED",
    "tag": "CLASSIFIED",
    "color": "#2A2A3A",
    "orbitAU": "Tanath moon III (unlisted)",
    "uwpString": "X200000-0",
    "diameter": "~3,100 km",
    "period": "22.7 standard days (retrograde)",
    "isMoon": true,
    "parentId": "tanath",
    "isStar": false,
    "decoration": "cluster",
    "desc": "Not on standard charts. Not in the Hegemony's public registry. Not visible on the orbital station's navigation display.\n\nRetrograde orbit — it moves opposite to the other Tanath moons, which means it formed elsewhere, was captured, or was placed there. The Hegemony sensor array on Esk is deliberately pointed away from it.",
    "readAloud": "There is nothing on sensors where there should be nothing. Then — briefly, for eleven seconds — there is something. Then there is nothing again. The sensor logs do not retain the eleven seconds. This is not a glitch.",
    "orbitPos": null
  },
  {
    "id": "ouros",
    "name": "Ouros",
    "type": "Ice Giant · Outer System",
    "tag": "FLAVOUR",
    "color": "#2AABB8",
    "orbitAU": "14.2 AU",
    "uwpString": "X——0000-0",
    "diameter": "~38,000 km",
    "period": "53.4 standard years",
    "isMoon": false,
    "isStar": false,
    "displayRadius": 13,
    "ringStyle": "subtle",
    "desc": "A pale blue-green ice giant in the deep outer system. No installations. No traffic. Three small unnamed moons, none surveyed beyond preliminary pass data. The Hegemony has no interest in the deep outer system at present. The Archon Collective may.",
    "readAloud": null,
    "orbitPos": 6
  }
];

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM-SCOPED BODY MODEL
// ═══════════════════════════════════════════════════════════════════════════
// BASE_BODIES_AUROS is the canonical hardcoded data for the Auros system.
// To allow other star systems to be built later (each a node on the Orion Arm
// galaxy map), bodies live inside a system wrapper and all design-mode body
// edits are namespaced by system id. Today there is exactly one system —
// 'auros' — but the storage schema and renderer are already multi-system
// ready, so dropping in a second system is a data change, not a rewrite.
const SYSTEMS = {
  auros: { id:'auros', name:'Auros', base: BASE_BODIES_AUROS }
};
let currentSystemId = 'auros';


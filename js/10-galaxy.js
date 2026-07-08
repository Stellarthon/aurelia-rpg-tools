// ═══════════════════════════════════════════════════════════════════════════
// GALAXY MAP — DATA + REGISTRY  (Orion Arm; ported from orion_arm_map_v4)
// ═══════════════════════════════════════════════════════════════════════════
const GALAXY_FACTIONS = {
  hegemony:   { name:'Terran Hegemony',                      color:'#00e5ff' },
  uhc:        { name:'Vestalian Continuity Government',                         color:'#aadd44' },
  sanhedrin:  { name:'Congregation of the Second Fall',      color:'#cc88ff' },
  rsc:        { name:'Red Star Collective',                  color:'#ff6666' },
  omnisynth:  { name:'OmniSynth Industries',                 color:'#6699ff' },
  archon:     { name:'Archon Collective',                    color:'#aabbcc' },
  vast:       { name:'The Vast',                             color:'#8855cc' },
  independent:{ name:'Independent',                         color:'#66bbaa' },
  contested:  { name:'Independent (Contested)',              color:'#ddaa44' },
  uncharted:  { name:'Uncharted',                            color:'#9fb0c8' },
};
// Pristine snapshot of the authored regions. The Design-Mode faction overlay
// (factionAdditions / factionDeletions / factionPropertyOverrides) is recomputed
// from this base, so region renames / recolours / deletes apply retroactively
// and stay restorable — exactly like the system overlay.
const GALAXY_FACTIONS_BASE = JSON.parse(JSON.stringify(GALAXY_FACTIONS));

const NODE_COLOR = '#00e5ff';

const GALAXY_NODES = [
  {"id":"silent-witness","name":"Gliese 526","x":90,"y":350,"faction":"archon","label":"Silent Night","connections":["whisper"],"desc":"Silent Night — A former Archon Collective node now dormant and unexplored. A place of silence and waiting. Whatever was here has gone quiet, but the infrastructure remains."},
  {"id":"whisper","name":"Gliese 667 Cc","x":112,"y":462,"faction":"vast","label":"Whisper","connections":["silent-witness","the-mausoleum","threshold"],"desc":"Whisper — A planet where time flows differently. A Vast research site, perhaps. Or a mistake. Clocks run wrong here. Logs show journeys that took days arriving in hours, or never arriving at all."},
  {"id":"the-mausoleum","name":"Hyades Cluster","x":172,"y":490,"faction":"archon","label":"The Mausoleum","connections":["whisper","threshold","the-fade"],"desc":"The Mausoleum — The Silent Core and heart of Archon Collective territory. A forbidden zone of megastructures and silence. No human vessel has returned from its interior. The structures are vast, ancient, and clearly still active."},
  {"id":"threshold","name":"Gliese 229","x":88,"y":562,"faction":"vast","label":"Threshold","connections":["whisper","the-mausoleum","the-fade","echo"],"desc":"Threshold — The first confirmed Vast contact point. A region of space where reality itself seems distorted. Sensor readings are unreliable. Navigation is approximate at best. Something here is very interested in ships that pass through."},
  {"id":"the-fade","name":"Gliese 581 D","x":162,"y":548,"faction":"vast","label":"The Fade","connections":["the-mausoleum","threshold"],"desc":"The Fade — A region of space slowly \"unmaking.\" Reality is coming apart here. Avoid at all costs. The light is wrong. Physics is negotiable. Ships that linger too long come back changed, or do not come back."},
  {"id":"echo","name":"Uncharted Nebula","x":85,"y":648,"faction":"vast","label":"Echo","connections":["threshold"],"desc":"Echo — A rogue planet drifting through the Ghost Reef, detected only by its faint thermal signature. It has an atmosphere, which is impossible. It has no star. Something is keeping it warm from within."},
  {"id":"the-reach","name":"Kapteyn's Star","x":218,"y":745,"faction":"independent","label":"The Reach","connections":["meridian"],"desc":"The Reach — A failed pre-Collapse colony, abandoned and never resettled. A ghost town in space, perfectly preserved and utterly empty. The lights still work. The food processors still cycle. No one knows why it was abandoned overnight."},
  {"id":"ironhold","name":"Gliese 806","x":295,"y":108,"faction":"sanhedrin","label":"Redemption","connections":["penitence","redemption"],"desc":"Redemption — A penal colony for techno-heretics. Those who worship machines or trust AI too much are sent here to labor and repent. The Congregation considers suffering to be a form of prayer."},
  {"id":"penitence","name":"Gliese 563","x":298,"y":200,"faction":"sanhedrin","label":"Penitence","connections":["ironhold","the-garden","sanhedrin-prime"],"desc":"Penitence — A monastery world of silent contemplation. No visitors are allowed. No one speaks. The silence is the point. The Congregation's most devout spend their lives here in total quiet."},
  {"id":"the-garden","name":"Gliese 706","x":290,"y":318,"faction":"sanhedrin","label":"The Garden","connections":["penitence","sanhedrin-prime","the-hammer"],"desc":"The Garden — An agricultural commune run by the Congregation, producing \"faithfully grown\" exports for the Hegemony market. Every crop is blessed. Every harvest is a sacrament. The profit margins are excellent."},
  {"id":"redemption","name":"Gliese 505","x":540,"y":145,"faction":"sanhedrin","label":"New Jerusalem","connections":["ironhold","new-jerusalem","new-canaan"],"desc":"New Jerusalem — A major pilgrimage site containing relics of Old Earth faiths. A place of quiet devotion and political intrigue. The Congregation's cardinals argue theology while their security apparatus does the real work."},
  {"id":"new-jerusalem","name":"Beta Comae","x":570,"y":185,"faction":"sanhedrin","label":"New Canaan","connections":["redemption","new-canaan"],"desc":"New Canaan — A pilgrimage world of austere devotion, aligned with the Hegemony. A place where faith and politics meet. The Congregation provides spiritual legitimacy; the Hegemony provides security. Both benefit."},
  {"id":"new-canaan","name":"Ursae Majoris","x":428,"y":175,"faction":"sanhedrin","label":"Sanhedrin Prime","connections":["redemption","new-jerusalem","sanhedrin-prime"],"desc":"Sanhedrin Prime — Theocratic headquarters of the Congregation, a world of temples and councils. The seat of the High Patriarch's power. Every decision made here ripples across Congregation space for decades."},
  {"id":"sanhedrin-prime","name":"Gliese 710","x":428,"y":248,"faction":"archon","label":"The Echo","connections":["new-canaan","the-garden","graveyard"],"desc":"The Echo — Where active Archon Collective signals have been detected but no response to hails. Something is listening. Something is waiting. The signals are complex, structured, and entirely unlike known communication protocols."},
  {"id":"graveyard","name":"61 Cygni","x":518,"y":248,"faction":"contested","label":"Graveyard","connections":["sanhedrin-prime","watchtower"],"desc":"Graveyard — A shattered world that witnessed one of the final, brutal battles of the Uprising. A wasteland of wrecked warships and silent tombs, haunted by the ghosts of Captain Cutter's last stand. Salvagers come. Most leave quickly."},
  {"id":"the-hammer","name":"Deep Space (Mobile)","x":418,"y":485,"faction":"rsc","label":"The Hammer","connections":["the-forge","october-yards","aurelia","watchtower","the-garden"],"desc":"The Hammer — A Vanguard raiding base: a converted mining vessel that serves as a mobile headquarters for hit-and-run attacks. It has no fixed location. Hegemony intelligence has been trying to find it for years."},
  {"id":"the-forge","name":"Deep Space (Mobile)","x":388,"y":558,"faction":"rsc","label":"The Forge","connections":["the-hammer","october-yards"],"desc":"The Forge — A secret Vanguard shipyard hidden in deep space. Where the Collective builds its fleet, one ship at a time. Its coordinates are the most closely guarded secret in the Red Star Collective."},
  {"id":"october-yards","name":"Gliese 406","x":478,"y":592,"faction":"rsc","label":"Red Sunrise","connections":["the-forge","the-hammer","red-sunrise","aurelia"],"desc":"Red Sunrise — A failed collective farm, now a cautionary tale. A reminder that good intentions are not enough. The original settlers starved. The Collective uses it as a lesson about the need for discipline and central planning."},
  {"id":"red-sunrise","name":"Gliese 445","x":463,"y":645,"faction":"rsc","label":"New Hope","connections":["october-yards","meridian"],"desc":"New Hope — A secret Vanguard training world, home to \"Liberation University.\" A place where revolutionaries are forged in secrecy. The curriculum covers tactics, ideology, and why this revolution will succeed where all others failed."},
  {"id":"watchtower","name":"Procyon","x":602,"y":378,"faction":"hegemony","label":"Watchtower","connections":["graveyard","vega","aurelia","the-hammer"],"desc":"Watchtower — Home to a heavily fortified Hegemony naval station on the edge of the Silent Core. A lonely, paranoid posting for those who watch for threats that never come — or so they are told."},
  {"id":"vega","name":"Vega","x":700,"y":360,"faction":"hegemony","label":"Vega","connections":["watchtower","castor"],"desc":"Vega — An old, stable system housing the Hegemony's premier military academies and strategic resupply depots. The fortified bulwark on the Coreward border. To graduate from Vega's academies is to be marked for command."},
  {"id":"aurelia","systemId":"auros","name":"Epsilon Indi","x":602,"y":478,"faction":"hegemony","label":"Aurelia ★","connections":["watchtower","the-hammer","october-yards","sol"],"desc":"Aurelia — The Hegemony's showcase world and administrative heart. A gleaming paradise for the loyal, built on exploitation and maintained by repression. Almost too perfect. Current campaign location. Population 800 million. UWP: A767978-C."},
  {"id":"sol","name":"Sol","x":660,"y":445,"faction":"hegemony","label":"Sol","connections":["castor","pollux","new-horizon"],"desc":"Sol — The cradle of humanity and capital of the Hegemony. A heavily fortified ecumenopolis, its skies thick with military traffic. Earth is a world of grey towers, propaganda broadcasts, and constant surveillance. The Assembly Hall still stands, but it is now a museum to a lost age."},
  {"id":"castor","name":"Castor","x":748,"y":385,"faction":"hegemony","label":"Castor","connections":["vega","sol","pollux","warehouse"],"desc":"Castor — A binary star system and the Hegemony's primary forge-world. Pollux is a polluted hive of industry, its skies permanently stained orange and grey. Produces the warships that project Hegemony power across the Orion Arm."},
  {"id":"pollux","name":"Alpha Centauri","x":700,"y":448,"faction":"hegemony","label":"Alpha Centauri","connections":["castor","sol","new-horizon","the-archive","kronos"],"desc":"Alpha Centauri — Home to New Horizon, the \"First Colony\" and a gleaming model of Hegemony propaganda. A prosperous, heavily controlled world that serves as the primary gateway between Hegemony space and the Contested Rim."},
  {"id":"new-horizon","name":"Groombridge 34","x":655,"y":525,"faction":"hegemony","label":"Ironhold","connections":["aurelia","sol","pollux","ophion-prime","the-archive"],"desc":"Ironhold — The Hegemony's primary reserve fleet anchorage. A system filled with mothballed warships, waiting for a war that may never come. The scale of the reserve fleet is a state secret. The scale is immense."},
  {"id":"warehouse","name":"Gliese 693","x":938,"y":255,"faction":"omnisynth","label":"Warehouse","connections":["castor","profit-margin","kronos"],"desc":"Warehouse — A massive automated storage depot. No one knows what's inside. No one asks. The shipping manifests are classified. The security detail is larger than most planetary militias."},
  {"id":"profit-margin","name":"Gliese 777","x":1028,"y":205,"faction":"omnisynth","label":"Profit Margin","connections":["warehouse","the-anvil","kronos"],"desc":"Profit Margin — A corporate resource extraction world staffed by indentured laborers. Efficiency is the only god. Workers are contracted for seven-year terms. The contracts auto-renew for debt accrued during service."},
  {"id":"the-anvil","name":"Gliese 674","x":1168,"y":252,"faction":"omnisynth","label":"The Anvil","connections":["profit-margin","terminus"],"desc":"The Anvil — Orbital shipyards belonging to OmniSynth Industries, producing civilian and military vessels for any buyer. A place of constant construction and corporate secrecy. The Hegemony is OmniSynth's best customer."},
  {"id":"kronos","name":"Gliese 667","x":1042,"y":305,"faction":"omnisynth","label":"Kronos Prime","connections":["warehouse","profit-margin","terminus","pollux"],"desc":"Kronos Prime — The industrial heart of OmniSynth Industries. A company-owned world of factories, barracks, and hidden labs. The most secure corporate world in the Orion Arm. The hidden labs are the reason for the security."},
  {"id":"terminus","name":"Wolf 359","x":1118,"y":342,"faction":"independent","label":"Terminus","connections":["the-anvil","kronos","erebus"],"desc":"Terminus — A major trade nexus where Spinward traffic converges. A planet-wide warehouse district with a massive transient population. OmniSynth runs the fuel infrastructure. Everyone else just passes through."},
  {"id":"erebus","name":"TRAPPIST-1","x":1188,"y":408,"faction":"independent","label":"Erebus","connections":["terminus","the-museum"],"desc":"Erebus — A remote mining colony on the fringe. A company-run world where workers are little more than slaves. The ore is valuable enough to justify the distance. The workers were not consulted on this calculation."},
  {"id":"the-archive","name":"Gliese 555","x":928,"y":548,"faction":"uhc","label":"The Archive","connections":["pollux","new-horizon","the-museum","vesta","old-earth"],"desc":"The Archive — A secret backup of the Vestalian Great Library, hidden in an obscure system to preserve knowledge from those who would exploit it. Only a handful of people know this system's true purpose."},
  {"id":"the-museum","name":"Gliese 754","x":1028,"y":535,"faction":"uhc","label":"The Museum","connections":["the-archive","pollux","cypress","erebus"],"desc":"The Museum — An orbital museum containing original UHC artifacts, ships, and records. A treasure trove for historians and a target for everyone else. The security is surprisingly robust for a cultural institution."},
  {"id":"vesta","name":"Eta Cassiopeiae","x":918,"y":618,"faction":"uhc","label":"Vestalia","connections":["the-archive","memory","avalon"],"desc":"Vestalia — The first successful extrasolar colony and a living museum of the United Human Colonies. Beautiful, ancient, and slowly dying. The Great Library holds the most complete pre-Collapse archives in human space."},
  {"id":"old-earth","name":"Gliese 667 C","x":918,"y":642,"faction":"uhc","label":"Old Earth","connections":["the-archive","memory"],"desc":"Old Earth — A failed colony preserved as a ruin of pre-Collapse life. A pilgrimage site for historians and those who mourn what was lost. The ruins are perfectly preserved. No one is sure how."},
  {"id":"memory","name":"Gliese 682","x":948,"y":655,"faction":"uhc","label":"Memory","connections":["vesta","old-earth","avalon","zephyria-prime"],"desc":"Memory — A historical preservation world where enthusiasts reenact UHC-era life. A living museum of a time before the fall. The residents do not consider it reenactment. To them, this is the real world."},
  {"id":"avalon","name":"Tau Ceti","x":938,"y":715,"faction":"contested","label":"Avalon","connections":["vesta","memory","solidarity","zephyria-prime"],"desc":"Avalon — A prosperous, technologically advanced independent colony ruled by a technocratic oligarchy. A hub for research, diplomacy, and quiet deals. Everyone wants Avalon's cooperation. Avalon charges accordingly."},
  {"id":"zephyria-prime","name":"Gliese 581","x":1015,"y":732,"faction":"contested","label":"Zephyria Prime","connections":["memory","avalon"],"desc":"Zephyria Prime — The site of the first Eidolon Ruin discovery and the catalyst for the Collapse. A haunted, semi-quarantined graveyard crawling with scavengers and patrolled by Archon Collective drones. Whatever was found here started everything."},
  {"id":"solidarity","name":"Gliese 293","x":878,"y":760,"faction":"rsc","label":"Solidarity","connections":["avalon","dust"],"desc":"Solidarity — An underground railway hub moving refugees and dissidents across the Orion Arm. A network of safe houses and secret routes. The Collective calls it humanitarian aid. The Hegemony calls it sedition."},
  {"id":"dust","name":"Ross 154","x":888,"y":820,"faction":"independent","label":"Dust","connections":["solidarity"],"desc":"Dust — A desert world where water is rationed and survival is a daily struggle. A culture of hard people living a hard life. They have never asked for help and would not accept it if offered."},
  {"id":"cypress","name":"36 Ophiuchi A","x":1108,"y":580,"faction":"hegemony","label":"Cypress","connections":["the-museum","bastion"],"desc":"Cypress — An agricultural breadbasket world entirely automated and run by a skeleton crew of overseers. Food for the Hegemony, grown in perfect silence. The automation never fails. No one asks why it never fails."},
  {"id":"bastion","name":"Epsilon Eridani","x":1238,"y":595,"faction":"contested","label":"Elysium Prime / Elysium Secundus","connections":["cypress","vanguards-end","elysium-prime"],"desc":"Epsilon Eridani — Home to Elysium Prime and Elysium Secundus. Elysium Prime is a lush, democratic agricultural hub, fiercely independent and constantly pressured by the Hegemony. Elysium Secundus is a jungle world, wild and untamed, home to pirate bases, uncharted ruins, and those who prefer to live outside the law."},
  {"id":"vanguards-end","name":"Wolf 294","x":1315,"y":595,"faction":"hegemony","label":"Bastion","connections":["bastion"],"desc":"Bastion — A maximum security prison world for political dissidents, inconvenient truth-tellers, and those who simply disappeared. A cold, grey rock with an atmosphere that requires constant filtration. The Hegemony does not officially acknowledge its existence."},
  {"id":"elysium-prime","name":"Luyten 726-8","x":1205,"y":665,"faction":"hegemony","label":"Vanguard's End","connections":["bastion","elysium-secundus"],"desc":"Vanguard's End — A barren mining colony that serves as a prison for exiled Red Star Collective prisoners. A place of hard labor and broken spirits. The ore it produces is barely worth the cost. The isolation is the point."},
  {"id":"elysium-secundus","name":"Gliese 892","x":1270,"y":678,"faction":"archon","label":"The Watch","connections":["elysium-prime"],"desc":"The Watch — A Collective observation post monitoring human space. They watch. They wait. They do not interfere. The post has been active for longer than human spaceflight has existed."},
  {"id":"meridian","name":"82 Eridani","x":488,"y":698,"faction":"independent","label":"Meridian / Meridian Prime","connections":["the-reach","solitude","red-sunrise","haven"],"desc":"Meridian / Meridian Prime — Meridian is a stable, prosperous neutral world and diplomatic hub. Meridian Prime is a banking and finance hub, planetary neutrality enforced by economic interdependence. Everyone owes Meridian money. This is deliberate."},
  {"id":"solitude","name":"Luyten's Star","x":568,"y":748,"faction":"independent","label":"Solitude","connections":["meridian","haven","ophion-prime"],"desc":"Solitude — A tiny, barely habitable world settled by a pre-Collapse religious sect that rejected technology. They live as their ancestors did, untouched by the wider galaxy. They know what is out there. They chose this."},
  {"id":"haven","name":"Lacaille 9352","x":542,"y":805,"faction":"independent","label":"Haven","connections":["meridian","solitude","meridian-secundus"],"desc":"Haven — A refugee colony founded by survivors of Hegemony pacification campaigns. Overcrowded, under-resourced, and fiercely defiant. They have survived things that should have destroyed them. This has made them dangerous."},
  {"id":"ophion-prime","name":"HD 219134","x":708,"y":698,"faction":"independent","label":"Ophion Prime","connections":["solitude","new-horizon","freeside"],"desc":"Ophion Prime — A notorious pirate haven and lawless world. The Crimson Bazaar, its main station, is where anything can be bought or sold. The only law is enforced by whoever is currently strongest. This changes regularly."},
  {"id":"freeside","name":"Barnard's Star","x":645,"y":758,"faction":"independent","label":"Freeside","connections":["ophion-prime","meridian-secundus","havens-gate"],"desc":"Freeside — A failed agricultural colony turned anarchist experiment. Poor, chaotic, and fiercely free. The original colonists starved. The current residents celebrate this as proof that freedom matters more than comfort."},
  {"id":"meridian-secundus","name":"Gliese 876","x":645,"y":828,"faction":"independent","label":"Freeport Omega","connections":["haven","freeside","havens-gate"],"desc":"Freeport Omega — A libertarian paradise with no taxes and no extradition. A haven for the wealthy, the criminal, and those who just want to be left alone. The wealthy and the criminal often turn out to be the same people."},
  {"id":"havens-gate","name":"Gliese 832","x":708,"y":868,"faction":"independent","label":"Haven's Gate","connections":["freeside","meridian-secundus"],"desc":"Haven's Gate — A major refueling station orbiting a gas giant. A vital stop for ships traveling the Rimward routes. The station master knows everyone's name, their ship registry, and approximately what they are running from."},
  {"id":"verdance-fields","name":"Tycho 3946","x":777,"y":389,"faction":"independent","label":"Verdance Fields","connections":["corvus-mires","aleph","port-lachlan"],"desc":"Verdance Fields — a free-trader waystation.","_gen":true},
  {"id":"neo-pallas","name":"Ross 1184","x":610,"y":964,"faction":"independent","label":"Neo Pallas","connections":["nadir","oxley-landing","groombridge-5337"],"desc":"Neo Pallas — a frontier prospecting claim.","_gen":true},
  {"id":"tallow-claim","name":"Kapteyn 6255","x":694,"y":508,"faction":"independent","label":"Tallow Claim","connections":["new-horizon","pollux","lachlan-anchorage"],"desc":"Tallow Claim — an independent shipbreaking yard.","_gen":true},
  {"id":"nadir-depot","name":"Wolf 9414","x":839,"y":891,"faction":"independent","label":"Nadir Depot","connections":["ilium","hip-3578","dust"],"desc":"Nadir Depot — a frontier prospecting claim.","_gen":true},
  {"id":"oxley-landing","name":"Kepler 3950","x":639,"y":881,"faction":"independent","label":"Oxley Landing","connections":["nadir","meridian-secundus","havens-gate"],"desc":"Oxley Landing — an independent shipbreaking yard.","_gen":true},
  {"id":"haven-emberly","name":"Kepler 3935","x":851,"y":647,"faction":"independent","label":"Haven Emberly","connections":["zenobia","ferrum","hd-7374"],"desc":"Haven Emberly — an independent shipbreaking yard.","_gen":true},
  {"id":"gliese-9700","name":"Gliese 9700","x":415,"y":492,"faction":"independent","label":"Gliese 9700","connections":["the-hammer","fort-jubilee","hd-5772"],"desc":"Gliese 9700 — a belter refinery outpost.","_gen":true},
  {"id":"kapteyn-4857","name":"Kapteyn 4857","x":514,"y":361,"faction":"independent","label":"Kapteyn 4857","connections":["ostrava-verge","port-zenobia","hd-5772"],"desc":"Kapteyn 4857 — an independent shipbreaking yard.","_gen":true},
  {"id":"nadir","name":"Kepler 1955","x":619,"y":906,"faction":"independent","label":"Nadir","connections":["oxley-landing","neo-pallas","meridian-secundus"],"desc":"Nadir — an independent shipbreaking yard.","_gen":true},
  {"id":"torrent-watch","name":"Kepler 1473","x":521,"y":1053,"faction":"independent","label":"Torrent Watch","connections":["groombridge-5337","neo-pallas","nadir"],"desc":"Torrent Watch — an independent shipbreaking yard.","_gen":true},
  {"id":"lalande-2829","name":"Lalande 2829","x":270,"y":721,"faction":"independent","label":"Lalande 2829","connections":["cape-umbra","the-reach","wolf-3500"],"desc":"Lalande 2829 — a frontier prospecting claim.","_gen":true},
  {"id":"novo-warden","name":"Kepler 9074","x":801,"y":522,"faction":"independent","label":"Novo Warden","connections":["hd-5592","struve-4314","tallow-claim"],"desc":"Novo Warden — a homesteader colony.","_gen":true},
  {"id":"morrow","name":"HD 8467","x":899,"y":954,"faction":"independent","label":"Morrow","connections":["nadir-depot","halcyon-reach","ilium"],"desc":"Morrow — a homesteader colony.","_gen":true},
  {"id":"groombridge-5337","name":"Groombridge 5337","x":538,"y":1048,"faction":"independent","label":"Groombridge 5337","connections":["torrent-watch","neo-pallas","nadir"],"desc":"Groombridge 5337 — a belter refinery outpost.","_gen":true},
  {"id":"kalinga","name":"Lalande 591","x":976,"y":564,"faction":"independent","label":"Kalinga","connections":["nova-anvil","fort-grendel"],"desc":"Kalinga — an independent free port.","_gen":true},
  {"id":"hd-7374","name":"HD 7374","x":891,"y":730,"faction":"independent","label":"HD 7374","connections":["halcyon-hold","solidarity","dust"],"desc":"HD 7374 — a smugglers’ haven.","_gen":true},
  {"id":"lachlan-anchorage","name":"LHS 8665","x":605,"y":478,"faction":"independent","label":"Lachlan Anchorage","connections":["aurelia","kapteyn-6027","hd-5772"],"desc":"Lachlan Anchorage — an independent free port.","_gen":true},
  {"id":"neo-tsvetov","name":"Groombridge 9487","x":1119,"y":638,"faction":"independent","label":"Neo Tsvetov","connections":["sundara","cypress","quillon"],"desc":"Neo Tsvetov — an independent shipbreaking yard.","_gen":true},
  {"id":"tantalus","name":"Ross 4962","x":624,"y":290,"faction":"independent","label":"Tantalus","connections":["marrow-hold","watchtower","kapteyn-4857"],"desc":"Tantalus — a belter refinery outpost.","_gen":true},
  {"id":"groombridge-3861","name":"Groombridge 3861","x":606,"y":546,"faction":"independent","label":"Groombridge 3861","connections":["tycho-2081","new-horizon","ross-2012"],"desc":"Groombridge 3861 — a smugglers’ haven.","_gen":true},
  {"id":"halcyon-reach","name":"Gliese 7348","x":990,"y":983,"faction":"independent","label":"Halcyon Reach","connections":["morrow","nova-kiln","nadir-depot"],"desc":"Halcyon Reach — an independent free port.","_gen":true},
  {"id":"marrow-hold","name":"Groombridge 496","x":633,"y":309,"faction":"independent","label":"Marrow Hold","connections":["tantalus","lalande-777","kapteyn-4857"],"desc":"Marrow Hold — a free-trader waystation.","_gen":true},
  {"id":"hip-3578","name":"HIP 3578","x":769,"y":914,"faction":"independent","label":"HIP 3578","connections":["ilium","nadir-depot","havens-gate"],"desc":"HIP 3578 — an independent free port.","_gen":true},
  {"id":"hip-8511","name":"HIP 8511","x":527,"y":741,"faction":"independent","label":"HIP 8511","connections":["solitude","wolf-3500","meridian"],"desc":"HIP 8511 — an independent agricultural colony.","_gen":true},
  {"id":"halcyon-hold","name":"GJ 8318","x":875,"y":754,"faction":"independent","label":"Halcyon Hold","connections":["solidarity","hd-7374","dust"],"desc":"Halcyon Hold — a belter refinery outpost.","_gen":true},
  {"id":"aleph","name":"Groombridge 5034","x":793,"y":373,"faction":"independent","label":"Aleph","connections":["verdance-fields","corvus-mires","port-lachlan"],"desc":"Aleph — a belter refinery outpost.","_gen":true},
  {"id":"ross-2012","name":"Ross 2012","x":579,"y":601,"faction":"independent","label":"Ross 2012","connections":["grendel","tycho-2081","groombridge-3861"],"desc":"Ross 2012 — a free-trader waystation.","_gen":true},
  {"id":"quillon","name":"Kapteyn 8016","x":1081,"y":705,"faction":"independent","label":"Quillon","connections":["haven-pallas","neo-concord","neo-tsvetov"],"desc":"Quillon — an independent shipbreaking yard.","_gen":true},
  {"id":"ilium","name":"Gliese 1697","x":790,"y":916,"faction":"independent","label":"Ilium","connections":["hip-3578","nadir-depot","havens-gate"],"desc":"Ilium — a homesteader colony.","_gen":true},
  {"id":"wolf-3500","name":"Wolf 3500","x":478,"y":755,"faction":"independent","label":"Wolf 3500","connections":["tsvetov-mires","hip-8511","meridian"],"desc":"Wolf 3500 — an independent free port.","_gen":true},
  {"id":"kruger-6077","name":"Kruger 6077","x":559,"y":811,"faction":"independent","label":"Kruger 6077","connections":["haven","solitude","hip-8511"],"desc":"Kruger 6077 — a free-trader waystation.","_gen":true},
  {"id":"cape-umbra","name":"Tycho 2801","x":281,"y":701,"faction":"independent","label":"Cape Umbra","connections":["lalande-2829","perdido-verge","the-reach"],"desc":"Cape Umbra — a free-trader waystation.","_gen":true},
  {"id":"port-lachlan","name":"HD 465","x":754,"y":388,"faction":"independent","label":"Port Lachlan","connections":["castor","verdance-fields","aleph"],"desc":"Port Lachlan — an independent agricultural colony.","_gen":true},
  {"id":"hd-5772","name":"HD 5772","x":548,"y":476,"faction":"independent","label":"HD 5772","connections":["tycho-2743","kapteyn-6027","lachlan-anchorage"],"desc":"HD 5772 — a homesteader colony.","_gen":true},
  {"id":"ardent-verge","name":"Luyten 5594","x":831,"y":441,"faction":"hegemony","label":"Ardent Verge","connections":["verdance","corvus-mires","castor"],"desc":"Ardent Verge — a Hegemony agricultural world feeding the core.","_gen":true},
  {"id":"verdance","name":"Wolf 2569","x":781,"y":430,"faction":"hegemony","label":"Verdance","connections":["corvus-mires","verdance-fields","ardent-verge"],"desc":"Verdance — a Hegemony naval anchorage.","_gen":true},
  {"id":"corvus-mires","name":"Gliese 1170","x":771,"y":407,"faction":"hegemony","label":"Corvus Mires","connections":["verdance-fields","verdance","castor"],"desc":"Corvus Mires — a fortified Hegemony core world.","_gen":true},
  {"id":"nova-anvil","name":"Ross 3123","x":941,"y":562,"faction":"hegemony","label":"Nova Anvil","connections":["the-archive","kalinga","gliese-2053"],"desc":"Nova Anvil — a Hegemony naval anchorage.","_gen":true},
  {"id":"kruger-2035","name":"Kruger 2035","x":695,"y":369,"faction":"hegemony","label":"Kruger 2035","connections":["vega","lalande-777","castor"],"desc":"Kruger 2035 — a Hegemony agricultural world feeding the core.","_gen":true},
  {"id":"grendel-watch","name":"Kapteyn 4331","x":983,"y":444,"faction":"hegemony","label":"Grendel Watch","connections":["morrow-watch","marrow-verge","gliese-2053"],"desc":"Grendel Watch — a Terran administrative colony.","_gen":true},
  {"id":"perdido","name":"Luyten 5792","x":689,"y":588,"faction":"hegemony","label":"Perdido","connections":["nova-foxglove","ross-802","new-horizon"],"desc":"Perdido — a Hegemony naval anchorage.","_gen":true},
  {"id":"haven-ashford","name":"Ross 4669","x":971,"y":282,"faction":"hegemony","label":"Haven Ashford","connections":["gliese-8791","warehouse","wolf-9518"],"desc":"Haven Ashford — a Hegemony naval anchorage.","_gen":true},
  {"id":"okoro-station","name":"Struve 7122","x":586,"y":431,"faction":"hegemony","label":"Okoro Station","connections":["kapteyn-6027","tycho-2743","aurelia"],"desc":"Okoro Station — a fortified Hegemony core world.","_gen":true},
  {"id":"groombridge-8520","name":"Groombridge 8520","x":828,"y":613,"faction":"hegemony","label":"Groombridge 8520","connections":["haven-emberly","zenobia","hd-354"],"desc":"Groombridge 8520 — a Hegemony naval anchorage.","_gen":true},
  {"id":"tycho-2743","name":"Tycho 2743","x":572,"y":474,"faction":"hegemony","label":"Tycho 2743","connections":["kapteyn-6027","hd-5772","aurelia"],"desc":"Tycho 2743 — a Terran administrative colony.","_gen":true},
  {"id":"gliese-8791","name":"Gliese 8791","x":971,"y":288,"faction":"hegemony","label":"Gliese 8791","connections":["haven-ashford","warehouse","wolf-9518"],"desc":"Gliese 8791 — a fortified Hegemony core world.","_gen":true},
  {"id":"nova-foxglove","name":"Kruger 7420","x":724,"y":582,"faction":"hegemony","label":"Nova Foxglove","connections":["perdido","ross-802","tycho-2104"],"desc":"Nova Foxglove — a Terran administrative colony.","_gen":true},
  {"id":"gliese-2053","name":"Gliese 2053","x":983,"y":503,"faction":"hegemony","label":"Gliese 2053","connections":["fort-grendel","morrow-watch","grendel-watch"],"desc":"Gliese 2053 — a fortified Hegemony core world.","_gen":true},
  {"id":"hd-3111","name":"HD 3111","x":1082,"y":427,"faction":"hegemony","label":"HD 3111","connections":["gliese-4547","aleph-fields","tycho-7982"],"desc":"HD 3111 — a Hegemony agricultural world feeding the core.","_gen":true},
  {"id":"harrow-yards","name":"Kapteyn 7282","x":861,"y":570,"faction":"hegemony","label":"Harrow Yards","connections":["struve-4314","zenobia","groombridge-8520"],"desc":"Harrow Yards — a Hegemony agricultural world feeding the core.","_gen":true},
  {"id":"wolf-9518","name":"Wolf 9518","x":968,"y":223,"faction":"hegemony","label":"Wolf 9518","connections":["bishop-mires","warehouse","haven-ashford"],"desc":"Wolf 9518 — a Hegemony naval anchorage.","_gen":true},
  {"id":"grendel","name":"HD 3092","x":531,"y":586,"faction":"hegemony","label":"Grendel","connections":["ross-2012","october-yards","tycho-2743"],"desc":"Grendel — a Terran administrative colony.","_gen":true},
  {"id":"tycho-7982","name":"Tycho 7982","x":1105,"y":507,"faction":"hegemony","label":"Tycho 7982","connections":["wolf-3572","lalande-1385","cypress"],"desc":"Tycho 7982 — a Hegemony naval anchorage.","_gen":true},
  {"id":"hd-354","name":"HD 354","x":782,"y":638,"faction":"hegemony","label":"HD 354","connections":["groombridge-8520","tycho-2104","vantage"],"desc":"HD 354 — a Hegemony naval anchorage.","_gen":true},
  {"id":"kepler-1285","name":"Kepler 1285","x":931,"y":666,"faction":"hegemony","label":"Kepler 1285","connections":["memory","old-earth","nova-anvil"],"desc":"Kepler 1285 — a Hegemony agricultural world feeding the core.","_gen":true},
  {"id":"vantage","name":"LHS 6409","x":739,"y":688,"faction":"hegemony","label":"Vantage","connections":["selk-anchorage","tycho-2104","hd-354"],"desc":"Vantage — a fortified Hegemony core world.","_gen":true},
  {"id":"kapteyn-527","name":"Kapteyn 527","x":725,"y":174,"faction":"hegemony","label":"Kapteyn 527","connections":["tantalus","new-jerusalem","vega"],"desc":"Kapteyn 527 — a Hegemony naval anchorage.","_gen":true},
  {"id":"tycho-2104","name":"Tycho 2104","x":733,"y":657,"faction":"hegemony","label":"Tycho 2104","connections":["ross-802","vantage","hd-354"],"desc":"Tycho 2104 — a fortified Hegemony core world.","_gen":true},
  {"id":"thornwell","name":"Struve 223","x":535,"y":129,"faction":"sanhedrin","label":"Thornwell","connections":["redemption","kruger-9271","oxley"],"desc":"Thornwell — a temple-world of the Second Fall.","_gen":true},
  {"id":"gj-3295","name":"GJ 3295","x":453,"y":155,"faction":"sanhedrin","label":"GJ 3295","connections":["ardent-mires","oxley","new-canaan"],"desc":"GJ 3295 — a devout frontier parish.","_gen":true},
  {"id":"calder-watch","name":"Wolf 6100","x":254,"y":260,"faction":"sanhedrin","label":"Calder Watch","connections":["landing-at-kavan","the-garden","penitence"],"desc":"Calder Watch — a devout frontier parish.","_gen":true},
  {"id":"lalande-2735","name":"Lalande 2735","x":365,"y":273,"faction":"sanhedrin","label":"Lalande 2735","connections":["sanhedrin-prime","gj-9779","the-garden"],"desc":"Lalande 2735 — a Congregation pilgrim colony.","_gen":true},
  {"id":"landing-at-kavan","name":"Ross 8519","x":242,"y":194,"faction":"sanhedrin","label":"Landing at Kavan","connections":["penitence","calder-watch","gj-6798"],"desc":"Landing at Kavan — a Sanhedrin cloister-world.","_gen":true},
  {"id":"ardent-mires","name":"Ross 2376","x":478,"y":148,"faction":"sanhedrin","label":"Ardent Mires","connections":["oxley","gj-3295","kruger-9271"],"desc":"Ardent Mires — a Sanhedrin cloister-world.","_gen":true},
  {"id":"kiln","name":"Wolf 2279","x":265,"y":40,"faction":"sanhedrin","label":"Kiln","connections":["gliese-1265","ironhold","gj-6798"],"desc":"Kiln — a devout frontier parish.","_gen":true},
  {"id":"gj-6798","name":"GJ 6798","x":248,"y":119,"faction":"sanhedrin","label":"GJ 6798","connections":["ironhold","landing-at-kavan","kiln"],"desc":"GJ 6798 — a devout frontier parish.","_gen":true},
  {"id":"oxley","name":"Ross 1431","x":478,"y":138,"faction":"sanhedrin","label":"Oxley","connections":["ardent-mires","gj-3295","kruger-9271"],"desc":"Oxley — a Sanhedrin cloister-world.","_gen":true},
  {"id":"novo-kalinga","name":"Lalande 5066","x":462,"y":84,"faction":"sanhedrin","label":"Novo Kalinga","connections":["gliese-9630","oxley","ardent-mires"],"desc":"Novo Kalinga — a Congregation pilgrim colony.","_gen":true},
  {"id":"gliese-9630","name":"Gliese 9630","x":454,"y":40,"faction":"sanhedrin","label":"Gliese 9630","connections":["novo-kalinga","oxley","kruger-9271"],"desc":"Gliese 9630 — a Congregation pilgrim colony.","_gen":true},
  {"id":"ostrava-verge","name":"Gliese 170","x":511,"y":385,"faction":"sanhedrin","label":"Ostrava Verge","connections":["port-zenobia","lhs-3145"],"desc":"Ostrava Verge — a Congregation pilgrim colony.","_gen":true},
  {"id":"gliese-1265","name":"Gliese 1265","x":314,"y":40,"faction":"sanhedrin","label":"Gliese 1265","connections":["kiln","ironhold","gj-6798"],"desc":"Gliese 1265 — a Congregation pilgrim colony.","_gen":true},
  {"id":"kruger-9271","name":"Kruger 9271","x":513,"y":132,"faction":"sanhedrin","label":"Kruger 9271","connections":["thornwell","redemption","oxley"],"desc":"Kruger 9271 — a Congregation pilgrim colony.","_gen":true},
  {"id":"port-zenobia","name":"Gliese 264","x":496,"y":389,"faction":"sanhedrin","label":"Port Zenobia","connections":["lhs-3145","ostrava-verge"],"desc":"Port Zenobia — a devout frontier parish.","_gen":true},
  {"id":"ferrum","name":"Kruger 666","x":834,"y":679,"faction":"uhc","label":"Ferrum","connections":["haven-emberly","hd-354","old-earth"],"desc":"Ferrum — a UHC terraforming project.","_gen":true},
  {"id":"neo-concord","name":"Groombridge 9134","x":1047,"y":717,"faction":"uhc","label":"Neo Concord","connections":["haven-pallas","wolf-8073","lalande-4989"],"desc":"Neo Concord — a UHC industrial world.","_gen":true},
  {"id":"hd-5592","name":"HD 5592","x":813,"y":540,"faction":"uhc","label":"HD 5592","connections":["struve-4314","novo-warden","hd-9823"],"desc":"HD 5592 — a UHC terraforming project.","_gen":true},
  {"id":"lalande-1385","name":"Lalande 1385","x":1049,"y":511,"faction":"uhc","label":"Lalande 1385","connections":["the-museum","gliese-4547","morrow-watch"],"desc":"Lalande 1385 — a Continuity records-vault world.","_gen":true},
  {"id":"haven-pallas","name":"LHS 4767","x":1055,"y":700,"faction":"uhc","label":"Haven Pallas","connections":["neo-concord","quillon","wolf-8073"],"desc":"Haven Pallas — a UHC terraforming project.","_gen":true},
  {"id":"hd-9823","name":"HD 9823","x":904,"y":513,"faction":"uhc","label":"HD 9823","connections":["the-archive","nova-anvil","struve-4314"],"desc":"HD 9823 — a Continuity records-vault world.","_gen":true},
  {"id":"harrow-verge","name":"Tycho 1899","x":958,"y":365,"faction":"uhc","label":"Harrow Verge","connections":["lalande-2449","marrow-verge","morrow-watch"],"desc":"Harrow Verge — a Continuity records-vault world.","_gen":true},
  {"id":"wolf-8073","name":"Wolf 8073","x":1014,"y":728,"faction":"uhc","label":"Wolf 8073","connections":["zephyria-prime","neo-concord","haven-pallas"],"desc":"Wolf 8073 — a UHC industrial world.","_gen":true},
  {"id":"morrow-watch","name":"Wolf 1167","x":1005,"y":458,"faction":"uhc","label":"Morrow Watch","connections":["grendel-watch","aleph-fields","lalande-1385"],"desc":"Morrow Watch — a UHC industrial world.","_gen":true},
  {"id":"marrow-verge","name":"Ross 6101","x":957,"y":402,"faction":"uhc","label":"Marrow Verge","connections":["lalande-2449","harrow-verge","morrow-watch"],"desc":"Marrow Verge — a UHC industrial world.","_gen":true},
  {"id":"nova-kiln","name":"Luyten 4329","x":945,"y":824,"faction":"uhc","label":"Nova Kiln","connections":["dust","solidarity","lalande-4989"],"desc":"Nova Kiln — a UHC terraforming project.","_gen":true},
  {"id":"ross-802","name":"Ross 802","x":721,"y":639,"faction":"uhc","label":"Ross 802","connections":["tycho-2104","vantage","ferrum"],"desc":"Ross 802 — a UHC terraforming project.","_gen":true},
  {"id":"lalande-4989","name":"Lalande 4989","x":938,"y":730,"faction":"uhc","label":"Lalande 4989","connections":["avalon","hd-7374","memory"],"desc":"Lalande 4989 — a UHC industrial world.","_gen":true},
  {"id":"struve-4314","name":"Struve 4314","x":829,"y":535,"faction":"uhc","label":"Struve 4314","connections":["hd-5592","novo-warden","hd-9823"],"desc":"Struve 4314 — a UHC terraforming project.","_gen":true},
  {"id":"gj-2668","name":"GJ 2668","x":524,"y":533,"faction":"rsc","label":"GJ 2668","connections":["haven-tsvetov","lalande-7400","october-yards"],"desc":"GJ 2668 — a Red Star frontier soviet.","_gen":true},
  {"id":"providence-terminus","name":"Luyten 3698","x":423,"y":736,"faction":"rsc","label":"Providence Terminus","connections":["tsvetov-mires","wolf-3500","kruger-5735"],"desc":"Providence Terminus — a Red Star frontier soviet.","_gen":true},
  {"id":"anvil-rest","name":"LHS 9105","x":545,"y":673,"faction":"rsc","label":"Anvil Rest","connections":["meridian","hip-8511","red-sunrise"],"desc":"Anvil Rest — a collectivised mining world.","_gen":true},
  {"id":"aleph-station","name":"Kepler 8886","x":646,"y":737,"faction":"rsc","label":"Aleph Station","connections":["freeside","ophion-prime","anvil-rest"],"desc":"Aleph Station — a collectivised mining world.","_gen":true},
  {"id":"tsvetov-mires","name":"HD 6509","x":433,"y":741,"faction":"rsc","label":"Tsvetov Mires","connections":["providence-terminus","wolf-3500","kruger-5735"],"desc":"Tsvetov Mires — a collectivised mining world.","_gen":true},
  {"id":"struve-6886","name":"Struve 6886","x":317,"y":518,"faction":"rsc","label":"Struve 6886","connections":["selk-verge","the-forge","the-hammer"],"desc":"Struve 6886 — a Red Star collective commune.","_gen":true},
  {"id":"haven-tsvetov","name":"Ross 8450","x":508,"y":523,"faction":"rsc","label":"Haven Tsvetov","connections":["gj-2668","lalande-7400","october-yards"],"desc":"Haven Tsvetov — an RSC labour world.","_gen":true},
  {"id":"selk-verge","name":"LHS 7618","x":354,"y":491,"faction":"rsc","label":"Selk Verge","connections":["struve-6886","fort-jubilee","the-hammer"],"desc":"Selk Verge — a Red Star collective commune.","_gen":true},
  {"id":"hd-6306","name":"HD 6306","x":353,"y":680,"faction":"rsc","label":"HD 6306","connections":["perdido-verge","cape-umbra","kruger-5735"],"desc":"HD 6306 — a Red Star collective commune.","_gen":true},
  {"id":"perdido-verge","name":"Kapteyn 6554","x":351,"y":724,"faction":"rsc","label":"Perdido Verge","connections":["hd-6306","kruger-5735","providence-terminus"],"desc":"Perdido Verge — a collectivised mining world.","_gen":true},
  {"id":"kruger-5735","name":"Kruger 5735","x":367,"y":766,"faction":"rsc","label":"Kruger 5735","connections":["perdido-verge","providence-terminus","tsvetov-mires"],"desc":"Kruger 5735 — a collectivised mining world.","_gen":true},
  {"id":"port-thornwell","name":"Gliese 7116","x":441,"y":572,"faction":"rsc","label":"Port Thornwell","connections":["october-yards","the-forge","red-sunrise"],"desc":"Port Thornwell — a Red Star collective commune.","_gen":true},
  {"id":"lalande-777","name":"Lalande 777","x":661,"y":375,"faction":"rsc","label":"Lalande 777","connections":["kruger-2035","vega"],"desc":"Lalande 777 — a collectivised mining world.","_gen":true},
  {"id":"lalande-7400","name":"Lalande 7400","x":503,"y":502,"faction":"rsc","label":"Lalande 7400","connections":["haven-tsvetov","gj-2668","the-hammer"],"desc":"Lalande 7400 — a Red Star frontier soviet.","_gen":true},
  {"id":"verdance-reach","name":"HIP 9228","x":1113,"y":380,"faction":"omnisynth","label":"Verdance Reach","connections":["grendel-terminus","terminus","saint-grendel"],"desc":"Verdance Reach — an OmniSynth research station.","_gen":true},
  {"id":"bishop-mires","name":"Gliese 4244","x":939,"y":246,"faction":"omnisynth","label":"Bishop Mires","connections":["warehouse","wolf-9518","profit-margin"],"desc":"Bishop Mires — an OmniSynth automated foundry-world.","_gen":true},
  {"id":"kruger-9706","name":"Kruger 9706","x":1030,"y":316,"faction":"omnisynth","label":"Kruger 9706","connections":["kronos","gliese-8791","saint-grendel"],"desc":"Kruger 9706 — an OmniSynth research station.","_gen":true},
  {"id":"rhodes","name":"Gliese 1040","x":1216,"y":203,"faction":"omnisynth","label":"Rhodes","connections":["jubilee","the-anvil","bishop-depot"],"desc":"Rhodes — an OmniSynth automated foundry-world.","_gen":true},
  {"id":"grendel-terminus","name":"Kepler 9311","x":1120,"y":386,"faction":"omnisynth","label":"Grendel Terminus","connections":["verdance-reach","terminus","saint-grendel"],"desc":"Grendel Terminus — an OmniSynth automated foundry-world.","_gen":true},
  {"id":"bishop-depot","name":"Luyten 8025","x":1142,"y":286,"faction":"omnisynth","label":"Bishop Depot","connections":["the-anvil","terminus","verdance-reach"],"desc":"Bishop Depot — an OmniSynth company world.","_gen":true},
  {"id":"luyten-7412","name":"Luyten 7412","x":1215,"y":372,"faction":"omnisynth","label":"Luyten 7412","connections":["erebus","grendel-terminus","verdance-reach"],"desc":"Luyten 7412 — an OmniSynth company world.","_gen":true},
  {"id":"aleph-fields","name":"Ross 7682","x":1046,"y":434,"faction":"omnisynth","label":"Aleph Fields","connections":["saint-grendel","gliese-4547","verdance-reach"],"desc":"Aleph Fields — an OmniSynth automated foundry-world.","_gen":true},
  {"id":"jubilee","name":"HD 3809","x":1214,"y":176,"faction":"omnisynth","label":"Jubilee","connections":["rhodes","the-anvil","bishop-depot"],"desc":"Jubilee — an OmniSynth research station.","_gen":true},
  {"id":"saint-grendel","name":"Ross 8436","x":1045,"y":402,"faction":"omnisynth","label":"Saint Grendel","connections":["aleph-fields","hd-3111","verdance-reach"],"desc":"Saint Grendel — a corporate mining concession.","_gen":true},
  {"id":"hd-3738","name":"HD 3738","x":785,"y":577,"faction":"contested","label":"HD 3738","connections":["hd-5592","groombridge-8520","zenobia"],"desc":"HD 3738 — a world under disputed claim.","_gen":true},
  {"id":"wolf-6713","name":"Wolf 6713","x":908,"y":644,"faction":"contested","label":"Wolf 6713","connections":["old-earth","vesta","zenobia"],"desc":"Wolf 6713 — a world under disputed claim.","_gen":true},
  {"id":"sundara","name":"Wolf 6256","x":1101,"y":618,"faction":"contested","label":"Sundara","connections":["neo-tsvetov","cypress","wolf-3572"],"desc":"Sundara — a contested border world.","_gen":true},
  {"id":"lalande-2449","name":"Lalande 2449","x":937,"y":388,"faction":"contested","label":"Lalande 2449","connections":["marrow-verge","harrow-verge"],"desc":"Lalande 2449 — a contested border world.","_gen":true},
  {"id":"wolf-3572","name":"Wolf 3572","x":1128,"y":553,"faction":"contested","label":"Wolf 3572","connections":["cypress","tycho-7982","sundara"],"desc":"Wolf 3572 — a world under disputed claim.","_gen":true},
  {"id":"zenobia","name":"LHS 439","x":873,"y":619,"faction":"contested","label":"Zenobia","connections":["haven-emberly","wolf-6713","hd-3738"],"desc":"Zenobia — a lawless marches settlement.","_gen":true},
  {"id":"selk-anchorage","name":"Lalande 4015","x":740,"y":697,"faction":"contested","label":"Selk Anchorage","connections":["vantage","ophion-prime","hd-3738"],"desc":"Selk Anchorage — a lawless marches settlement.","_gen":true},
  {"id":"fort-grendel","name":"Groombridge 9500","x":994,"y":531,"faction":"contested","label":"Fort Grendel","connections":["gliese-2053","the-museum","gliese-4547"],"desc":"Fort Grendel — a world under disputed claim.","_gen":true},
  {"id":"gliese-4547","name":"Gliese 4547","x":1067,"y":460,"faction":"contested","label":"Gliese 4547","connections":["aleph-fields","hd-3111","fort-grendel"],"desc":"Gliese 4547 — a shifting-allegiance frontier port.","_gen":true},
  {"id":"lhs-3145","name":"LHS 3145","x":489,"y":391,"faction":"archon","label":"LHS 3145","connections":["port-zenobia","ostrava-verge","gj-9779"],"desc":"LHS 3145 — a silent Archon node.","_gen":true},
  {"id":"gj-9779","name":"GJ 9779","x":412,"y":342,"faction":"archon","label":"GJ 9779","connections":["lalande-2735","lhs-3145","sanhedrin-prime"],"desc":"GJ 9779 — a silent Archon node.","_gen":true},
  {"id":"fort-jubilee","name":"Ross 6681","x":398,"y":473,"faction":"archon","label":"Fort Jubilee","connections":["the-hammer","gliese-9700","lhs-3145"],"desc":"Fort Jubilee — a silent Archon node.","_gen":true},
  {"id":"kapteyn-6027","name":"Kapteyn 6027","x":588,"y":476,"faction":"archon","label":"Kapteyn 6027","connections":["aurelia","tycho-2743","tycho-2081"],"desc":"Kapteyn 6027 — a half-lit Archon waystation.","_gen":true},
  {"id":"tycho-2081","name":"Tycho 2081","x":622,"y":563,"faction":"archon","label":"Tycho 2081","connections":["groombridge-3861","new-horizon","kapteyn-6027"],"desc":"Tycho 2081 — a silent Archon node.","_gen":true},
  {"id":"lhs-6342","name":"LHS 6342","x":162,"y":582,"faction":"vast","label":"LHS 6342","connections":["the-fade","threshold","calder"],"desc":"LHS 6342 — a quiet Vast enclave.","_gen":true},
  {"id":"calder","name":"Ross 4202","x":138,"y":494,"faction":"vast","label":"Calder","connections":["the-mausoleum","whisper","the-fade"],"desc":"Calder — a quiet Vast enclave.","_gen":true},
  {"id":"groombridge-7477","name":"Groombridge 7477","x":205,"y":448,"faction":"vast","label":"Groombridge 7477","connections":["hip-6329","the-mausoleum","calder"],"desc":"Groombridge 7477 — a quiet Vast enclave.","_gen":true},
  {"id":"meridian-landing","name":"Tycho 2885","x":83,"y":395,"faction":"vast","label":"Meridian Landing","connections":["silent-witness","whisper","calder"],"desc":"Meridian Landing — a strange Vast research outpost.","_gen":true},
  {"id":"hip-6329","name":"HIP 6329","x":216,"y":485,"faction":"vast","label":"HIP 6329","connections":["groombridge-7477","the-mausoleum","calder","struve-6886"],"desc":"HIP 6329 — a quiet Vast enclave.","_gen":true}
];

// Pristine snapshot of the AUTHORED galaxy, taken before any derived fields
// (_loreLinks, _baseConnections, the lane-overlay `connections`) are layered on.
// The Design-Mode system overlay (systemAdditions/Deletions/PropertyOverrides,
// defined below) is ALWAYS recomputed from this base, so referee edits/deletes
// apply retroactively to the original systems and stay restorable.
const GALAXY_NODES_BASE = GALAXY_NODES.map(n => JSON.parse(JSON.stringify(n)));

// Snapshot each node's ORIGINAL lore connections before the live jump-lane
// overlay (GX_LANES) overwrites `connections` further down. The economy sim
// trades along these established commercial routes — independent of whatever
// jump lanes the party has actually surveyed.
GALAXY_NODES.forEach(n => { n._loreLinks = Array.isArray(n.connections) ? n.connections.slice() : []; });

// Lookup map by galaxy-node id.
const GX_MAP = {};
GALAXY_NODES.forEach(s => GX_MAP[s.id] = s);

// Register every galaxy node as a drillable system in the multi-system SYSTEMS
// registry. The authored Auros/Aurelia system already exists; all others start
// with an empty `base` (unsurveyed → blank-system prompt on entry). Referee-
// generated/added bodies live in bodyAdditions[systemId] (Supabase-synced),
// exactly like Auros, so a populated system survives reloads for everyone.
GALAXY_NODES.forEach(n => {
  const sid = n.systemId || n.id;
  if(!SYSTEMS[sid]){
    SYSTEMS[sid] = {
      id: sid,
      name: (n.label || n.name).replace(' ★','').trim(),
      starName: n.name,
      faction: n.faction,
      galaxyId: n.id,
      base: []
    };
  } else {
    // Backfill galaxy linkage onto the pre-authored system (Auros).
    SYSTEMS[sid].galaxyId = SYSTEMS[sid].galaxyId || n.id;
    SYSTEMS[sid].faction  = SYSTEMS[sid].faction  || n.faction;
    SYSTEMS[sid].starName = SYSTEMS[sid].starName || n.name;
  }
});

// Undirected jump-lane set built from base connections (single source of truth
// for the rendered lines and the detail-panel connection list).
const GX_LANES = new Set();
function gxLaneKey(a,b){ return a < b ? a+'|'+b : b+'|'+a; }
let gxLaneAdditions = [];   // canonical lane keys added beyond the base data
let gxLaneDeletions = [];   // canonical lane keys removed from the base data
// RENDERED lanes = REFEREE-drawn only. The map shows exactly the jump lanes the referee draws in
// Design Mode (gxLaneAdditions, persisted); the authored `connections` are NOT rendered (the base
// network is off). The ECONOMY trade graph is DECOUPLED from the rendered lanes (see _econLinks
// below): it always routes on the full authored network + the referee's edits, so a ~180-system
// galaxy trades out of the box even with a clean, referee-authored lane map.
GALAXY_NODES.forEach(s => { s._baseConnections = []; });
function gxRebuildLanes(){
  GX_LANES.clear();
  GALAXY_NODES.forEach(s => (s._baseConnections||[]).forEach(cid => {   // empty by default → rendered lanes are referee-only
    if(GX_MAP[cid] && cid !== s.id) GX_LANES.add(gxLaneKey(s.id, cid));
  }));
  gxLaneDeletions.forEach(k => GX_LANES.delete(k));
  gxLaneAdditions.forEach(k => {
    const [a,b] = k.split('|');
    if(GX_MAP[a] && GX_MAP[b] && a !== b) GX_LANES.add(k);
  });
  // Rebuild every node's connections array from the RENDERED set so the detail panel's connection
  // list matches the drawn lanes.
  const adj = {};
  GALAXY_NODES.forEach(s => adj[s.id] = []);
  GX_LANES.forEach(k => {
    const [a,b] = k.split('|');
    if(adj[a] && !adj[a].includes(b)) adj[a].push(b);
    if(adj[b] && !adj[b].includes(a)) adj[b].push(a);
  });
  GALAXY_NODES.forEach(s => s.connections = adj[s.id]);
  // ECONOMY graph — authored network (_loreLinks) + referee lane edits, INVISIBLE on the map. Trade
  // always has routes regardless of which lanes the referee chose to draw; a referee lane deletion
  // reroutes trade, an addition opens a new trade route. Read by ECON.buildTopology (js/90).
  const eset = new Set();
  GALAXY_NODES.forEach(s => (s._loreLinks||[]).forEach(cid => { if(GX_MAP[cid] && cid!==s.id) eset.add(gxLaneKey(s.id, cid)); }));
  gxLaneDeletions.forEach(k => eset.delete(k));
  gxLaneAdditions.forEach(k => { const [a,b]=k.split('|'); if(GX_MAP[a]&&GX_MAP[b]&&a!==b) eset.add(k); });
  const eadj = {}; GALAXY_NODES.forEach(s => eadj[s.id] = []);
  eset.forEach(k => { const [a,b]=k.split('|'); if(eadj[a]&&!eadj[a].includes(b)) eadj[a].push(b); if(eadj[b]&&!eadj[b].includes(a)) eadj[b].push(a); });
  GALAXY_NODES.forEach(s => s._econLinks = eadj[s.id]);
}
gxRebuildLanes();

// ═══════════════════════════════════════════════════════════════════════════
// GALAXY MAP — ENGINE  (ported from orion_arm_map_v4, namespaced gx*)
// ═══════════════════════════════════════════════════════════════════════════
// The Orion Arm starmap is the app's landing view. Nodes are star systems;
// "View Close Up" drills into the generic per-system orrery (enterSystem),
// which reads effectiveBodies(systemId) exactly like Auros. Unsurveyed systems
// (empty base + no additions) show a blank-system prompt offering manual entry
// or random UWP generation. Lanes/connections are read-only here (V1) — the
// orion file's lane/flag/design-editing layer is intentionally not ported.

let gxLinkMode = false;     // armed while adding a jump lane (Design Mode)
let gxLinkOrigin = null;    // first system picked while linking

// ── Jump-lane overlay persistence (Supabase-synced, shared like body edits) ──
async function loadGalaxyLanes(){
  try {
    const r = await supaStorage.get('galaxy-lanes', true);
    const v = r.value != null ? JSON.parse(r.value) : {};
    gxLaneAdditions = Array.isArray(v.additions) ? v.additions : [];
    gxLaneDeletions = Array.isArray(v.deletions) ? v.deletions : [];
  } catch(e){ gxLaneAdditions = []; gxLaneDeletions = []; }
  gxRebuildLanes();
}
async function saveGalaxyLanes(){
  try { await supaStorage.set('galaxy-lanes', JSON.stringify({additions:gxLaneAdditions, deletions:gxLaneDeletions}), true); }
  catch(e){ console.error('Galaxy lane save failed', e); }
}

// ── Add / remove lanes (Design Mode, referee only) ──
function gxAddLane(a, b){
  if(a === b){ showToast('Pick a different destination'); return; }
  if(!GX_MAP[a] || !GX_MAP[b]) return;
  const k = gxLaneKey(a, b);
  if(GX_LANES.has(k)){ showToast('That jump lane already exists'); return; }
  const di = gxLaneDeletions.indexOf(k);
  if(di >= 0) gxLaneDeletions.splice(di, 1);   // un-delete a previously removed base lane
  else if(!gxLaneAdditions.includes(k)) gxLaneAdditions.push(k);
  gxRebuildLanes(); saveGalaxyLanes();
  try { if(typeof ECON!=='undefined') ECON.syncLanes(); } catch(e){}   // economy now follows jump lanes — re-route on edit
  if(typeof HX!=='undefined') HX.refresh();   // redraw the hex galaxy after a lane edit
  showToast('Jump lane added');
}
function gxRemoveLane(k){
  if(!designModeOn || !isReferee()) return;
  if(!GX_LANES.has(k)) return;
  if(!confirm('Remove this jump lane?')) return;
  const ai = gxLaneAdditions.indexOf(k);
  if(ai >= 0) gxLaneAdditions.splice(ai, 1);    // a session addition — just drop it
  else if(!gxLaneDeletions.includes(k)) gxLaneDeletions.push(k); // tombstone a base lane
  gxRebuildLanes(); saveGalaxyLanes();
  try { if(typeof ECON!=='undefined') ECON.syncLanes(); } catch(e){}   // economy now follows jump lanes — re-route on edit
  if(typeof HX!=='undefined') HX.refresh();   // redraw the hex galaxy after a lane edit
  showToast('Jump lane removed');
}
// Arm/cancel lane-add mode, then complete it on the next node tap.
function gxArmLink(originId){
  if(!designModeOn || !isReferee()) return;
  gxLinkMode = true; gxLinkOrigin = originId || null;
  showToast('Tap a destination system to link');
  if(typeof HX!=='undefined') HX.refresh();   // reflect link-mode in the hex panel
}
function gxCancelLink(){
  gxLinkMode = false; gxLinkOrigin = null;
  if(typeof HX!=='undefined') HX.refresh();   // reflect link-mode in the hex panel
}
function gxLinkPick(id){
  if(!gxLinkOrigin){ gxLinkOrigin = id; return; }
  const origin = gxLinkOrigin;
  gxLinkMode = false; gxLinkOrigin = null;
  gxAddLane(origin, id);
}

// ═══════════════════════════════════════════════════════════════════════════
// STAR-SYSTEM OVERLAY  (Design Mode · add / edit / move / remove whole systems)
// ───────────────────────────────────────────────────────────────────────────
// The galaxy-map analogue of the body/location overlays: three Supabase-synced
// stores layer on the authored GALAXY_NODES_BASE so the referee can add, edit,
// reposition and remove star systems, with every change persisting, syncing to
// players, and applying retroactively to the original systems.
//   systemAdditions:         [ {id,systemId,name,label,faction,desc,connections,q,r}, ... ]  referee-created
//   systemDeletions:         { id: {node, q, r, t, wasAddition} }   tombstones on systems (restorable)
//   systemPropertyOverrides: { id: {field:val, q?, r?} }            in-place edits / repositions of base systems
// effectiveNodes() recomputes the live set from base + overlay, and
// rebuildSystemsFromOverlay() reapplies it across EVERY derived structure
// (GALAXY_NODES in place, GX_MAP, SYSTEMS, _loreLinks, lanes, HX, ECON). It is
// idempotent, so it runs the same on boot, on a referee edit, and on a player
// poll — exactly like gxRebuildLanes recomputes the lane set.
let systemAdditions = [];
let systemDeletions = {};
let systemPropertyOverrides = {};

async function loadSystemStores(){
  try { const r = await supaStorage.get('system-additions', true);      systemAdditions = (r.value!=null ? JSON.parse(r.value) : []); if(!Array.isArray(systemAdditions)) systemAdditions = []; } catch(e){ systemAdditions = []; }
  try { const r = await supaStorage.get('system-deletions', true);      systemDeletions = (r.value!=null ? JSON.parse(r.value) : {}); } catch(e){ systemDeletions = {}; }
  try { const r = await supaStorage.get('system-prop-overrides', true); systemPropertyOverrides = (r.value!=null ? JSON.parse(r.value) : {}); } catch(e){ systemPropertyOverrides = {}; }
}
async function saveSystemAdditions(){ try { await supaStorage.set('system-additions', JSON.stringify(systemAdditions), true); } catch(e){ console.error('System additions save failed', e); } }
async function saveSystemDeletions(){ try { await supaStorage.set('system-deletions', JSON.stringify(systemDeletions), true); } catch(e){ console.error('System deletions save failed', e); } }
async function saveSystemPropertyOverrides(){ try { await supaStorage.set('system-prop-overrides', JSON.stringify(systemPropertyOverrides), true); } catch(e){ console.error('System property overrides save failed', e); } }

// Live galaxy node set = base systems (minus tombstoned, with overrides applied)
// followed by referee-added systems. Returns fresh clones so callers may mutate.
function effectiveNodes(){
  const out = [];
  GALAXY_NODES_BASE.forEach(n => {
    if(systemDeletions[n.id]) return;
    const clone = JSON.parse(JSON.stringify(n));
    const ov = systemPropertyOverrides[n.id];
    out.push(ov ? Object.assign(clone, ov) : clone);
  });
  systemAdditions.forEach(n => { if(!systemDeletions[n.id]) out.push(JSON.parse(JSON.stringify(n))); });
  return out;
}
function isAddedSystem(id){ return systemAdditions.some(s => s.id === id); }
function isBaseSystem(id){ return GALAXY_NODES_BASE.some(n => n.id === id); }

// Reapply the overlay across every structure that reads galaxy nodes. Clears and
// refills GALAXY_NODES IN PLACE (so every closure that captured the array keeps
// working), re-derives the lookup / lore / system registries, recomputes lanes,
// then diffs the result into the HX hex map (no cluster reshuffle) and the
// economy. Idempotent — safe to call repeatedly on load / edit / poll.
function rebuildSystemsFromOverlay(){
  const eff = effectiveNodes();
  // 1. GALAXY_NODES, in place
  GALAXY_NODES.length = 0; eff.forEach(n => GALAXY_NODES.push(n));
  // 2. Node-local derived fields + lookup map
  GALAXY_NODES.forEach(n => { n._loreLinks = Array.isArray(n.connections) ? n.connections.slice() : []; });
  Object.keys(GX_MAP).forEach(k => delete GX_MAP[k]);
  GALAXY_NODES.forEach(s => GX_MAP[s.id] = s);
  GALAXY_NODES.forEach(s => { s._baseConnections = []; });   // rendered lanes = referee-drawn only (economy uses _econLinks; see init path)
  // 3. Register any newly-added system as a drillable (empty) system
  GALAXY_NODES.forEach(n => {
    const sid = n.systemId || n.id;
    if(!SYSTEMS[sid]) SYSTEMS[sid] = { id: sid, name: (n.label || n.name || sid).replace(' ★','').trim(), starName: n.name, faction: n.faction, galaxyId: n.id, base: [] };
  });
  // 4. Lanes — gxRebuildLanes guards each endpoint against GX_MAP, so a lane that
  //    touched a now-removed system is dropped automatically (and reappears on restore).
  gxRebuildLanes();
  // 5. Hex map + economy topology
  try { if(typeof HX !== 'undefined' && HX.syncNodes) HX.syncNodes(GALAXY_NODES); } catch(e){ console.error('HX.syncNodes failed', e); }
  try { if(typeof ECON !== 'undefined' && ECON.syncLanes) ECON.syncLanes(); } catch(e){}
}

// What references a system — surfaced before a destructive delete so the referee
// sees what goes with it (no silent orphaning).
function systemDeps(id){
  let lanes = 0;
  try { GX_LANES.forEach(k => { const p = k.split('|'); if(p[0]===id || p[1]===id) lanes++; }); } catch(e){}
  const node = GX_MAP[id] || {};
  const sysId = node.systemId || id;
  const bodies = (typeof effectiveBodies === 'function' ? effectiveBodies(sysId) : []).length;
  const here = (typeof shipState !== 'undefined' && shipState.locationId === id);
  return { lanes, bodies, here, sysId };
}

// Create a system at a hex the referee tapped (click-to-place), then select it so
// its editor opens for the rest of the details. Added blank, edited in place —
// the same "add then immediately edit" idiom the content editors use.
function hxCreateSystemAt(q, r){
  if(!designModeOn || !isReferee()) return;
  let id = 'sys' + Date.now().toString(36), bump = 1;
  while(GX_MAP[id] || systemDeletions[id]) id = 'sys' + (Date.now() + bump++).toString(36);
  const node = { id, systemId: id, name: 'New System', label: 'New System', faction: 'independent', connections: [], desc: '', q, r };
  systemAdditions.push(node);
  saveSystemAdditions();
  rebuildSystemsFromOverlay();
  if(typeof HX !== 'undefined'){ HX.refresh(); HX.selectById(id); }
  showToast('System added — fill in its details');
}
function hxBeginAddSystem(){
  if(!designModeOn || !isReferee()) return;
  if(typeof HX !== 'undefined' && HX.armPlace) HX.armPlace((q, r) => hxCreateSystemAt(q, r));
}

// Edit a single field. Additions are mutated directly; base systems accumulate a
// property override so the original data is never touched and edits stay retroactive.
function hxEditSystemField(id, field, value){
  if(!isReferee()) return;
  const add = systemAdditions.find(s => s.id === id);
  if(add){
    add[field] = value;
    if(field === 'label' && !add.name) add.name = value;
    saveSystemAdditions();
  } else if(isBaseSystem(id)){
    if(!systemPropertyOverrides[id]) systemPropertyOverrides[id] = {};
    systemPropertyOverrides[id][field] = value;
    saveSystemPropertyOverrides();
  } else return;
  rebuildSystemsFromOverlay();
  if(typeof HX !== 'undefined') HX.refresh();
}

function hxMoveSystem(id){
  if(!designModeOn || !isReferee()) return;
  if(typeof HX !== 'undefined' && HX.armPlace) HX.armPlace((q, r) => hxPlaceSystem(id, q, r));
}
function hxPlaceSystem(id, q, r){
  if(!isReferee()) return;
  const add = systemAdditions.find(s => s.id === id);
  if(add){ add.q = q; add.r = r; saveSystemAdditions(); }
  else if(isBaseSystem(id)){ if(!systemPropertyOverrides[id]) systemPropertyOverrides[id] = {}; systemPropertyOverrides[id].q = q; systemPropertyOverrides[id].r = r; saveSystemPropertyOverrides(); }
  else return;
  if(typeof HX !== 'undefined' && HX.moveSystem) HX.moveSystem(id, q, r);
  if(typeof HX !== 'undefined') HX.refresh();
  showToast('System moved');
}

async function hxRemoveSystem(id){
  if(!designModeOn || !isReferee()) return;
  const node = GX_MAP[id]; if(!node) return;
  const dep = systemDeps(id);
  if(dep.here){ alert('The party is currently located at "' + (node.label || node.name) + '". Move the ship to another system before removing this one — deleting it would strand the party.'); return; }
  const bits = [];
  if(dep.lanes)  bits.push(dep.lanes + ' jump lane' + (dep.lanes > 1 ? 's' : ''));
  if(dep.bodies) bits.push(dep.bodies + ' charted ' + (dep.bodies > 1 ? 'bodies' : 'body'));
  let msg = 'Remove "' + (node.label || node.name) + '"?';
  msg += bits.length ? ('\n\nThis also removes ' + bits.join(' and ') + '. Everything is restorable from "Show Removed Items".')
                     : ' You can restore it from "Show Removed Items".';
  if(!confirm(msg)) return;
  let q = node.q, r = node.r;
  try { if(typeof HX !== 'undefined' && HX.hexOf){ const h = HX.hexOf(id); if(h){ q = h.q; r = h.r; } } } catch(e){}
  const add = systemAdditions.find(s => s.id === id);
  const baseNode = GALAXY_NODES_BASE.find(n => n.id === id);
  systemDeletions[id] = { node: add || (baseNode ? JSON.parse(JSON.stringify(baseNode)) : node), q, r, t: Date.now(), wasAddition: !!add };
  if(add) systemAdditions = systemAdditions.filter(s => s.id !== id);
  await saveSystemDeletions(); if(add) await saveSystemAdditions();
  rebuildSystemsFromOverlay();
  if(typeof HX !== 'undefined') HX.refresh();
  showToast('System removed', 'info');
}

async function restoreDeletedSystem(id){
  const entry = systemDeletions[id]; if(!entry) return;
  if(entry.wasAddition && entry.node){
    const nd = entry.node;
    if(entry.q != null) nd.q = entry.q;
    if(entry.r != null) nd.r = entry.r;
    if(!systemAdditions.some(s => s.id === id)) systemAdditions.push(nd);
    await saveSystemAdditions();
  } else if(entry.q != null){
    if(!systemPropertyOverrides[id]) systemPropertyOverrides[id] = {};
    systemPropertyOverrides[id].q = entry.q;
    systemPropertyOverrides[id].r = entry.r;
    await saveSystemPropertyOverrides();
  }
  delete systemDeletions[id];
  await saveSystemDeletions();
  rebuildSystemsFromOverlay();
  if(typeof HX !== 'undefined') HX.refresh();
  if(typeof closeRemovedItemsPanel === 'function') closeRemovedItemsPanel();
  showToast('System restored');
}

// ═══════════════════════════════════════════════════════════════════════════
// REGION / FACTION OVERLAY  (Design Mode · add / edit / remove sectors)
// ───────────────────────────────────────────────────────────────────────────
// Regions are the galaxy's sectors of space — each is a faction territory that
// colours the map overlay and tags its systems. Same three-store overlay as
// systems, layered on GALAXY_FACTIONS_BASE:
//   factionAdditions:         { id: {name,color} }       referee-created regions
//   factionDeletions:         { id: {fac, t, wasAddition} } tombstones (restorable)
//   factionPropertyOverrides: { id: {name?,color?} }      edits to base regions
// Composes with system authoring: a new region immediately appears in the
// "Design — System" faction picker, and recolouring it recolours every system
// and territory blob that references it (retroactive).
let factionAdditions = {};
let factionDeletions = {};
let factionPropertyOverrides = {};

async function loadFactionStores(){
  try { const r = await supaStorage.get('faction-additions', true);      factionAdditions = (r.value!=null ? JSON.parse(r.value) : {}); } catch(e){ factionAdditions = {}; }
  try { const r = await supaStorage.get('faction-deletions', true);      factionDeletions = (r.value!=null ? JSON.parse(r.value) : {}); } catch(e){ factionDeletions = {}; }
  try { const r = await supaStorage.get('faction-prop-overrides', true); factionPropertyOverrides = (r.value!=null ? JSON.parse(r.value) : {}); } catch(e){ factionPropertyOverrides = {}; }
}
async function saveFactionAdditions(){ try { await supaStorage.set('faction-additions', JSON.stringify(factionAdditions), true); } catch(e){ console.error('Faction additions save failed', e); } }
async function saveFactionDeletions(){ try { await supaStorage.set('faction-deletions', JSON.stringify(factionDeletions), true); } catch(e){ console.error('Faction deletions save failed', e); } }
async function saveFactionPropertyOverrides(){ try { await supaStorage.set('faction-prop-overrides', JSON.stringify(factionPropertyOverrides), true); } catch(e){ console.error('Faction prop overrides save failed', e); } }

// ── Player-facing faction visibility (referee-controlled) ────────────────────
// Some regions are lore spoilers (The Vast, the Archon Collective). The referee
// can hide a whole faction from players: to players a hidden region's systems
// read as "Uncharted" (name, colour, territory blob and faction tag all
// redacted) and the region drops out of the Regions list — the same shared
// blob + poll mechanism the area reveal control uses. The referee always sees
// the truth plus the toggle state. Default: the two spoiler factions start
// hidden, every other region visible.
// The spoilers-hidden default must survive an absent stored value: until the
// referee explicitly saves a visibility state, EVERYONE (players polling
// included) falls back to this, or The Vast / Archon Collective would leak.
const FACTION_HIDDEN_DEFAULT = { archon:true, vast:true };
let factionHidden = { ...FACTION_HIDDEN_DEFAULT };
async function loadFactionHidden(){
  try { const r = await supaStorage.get('faction-hidden', true);
    factionHidden = (r && r.value != null) ? (JSON.parse(r.value) || {}) : { ...FACTION_HIDDEN_DEFAULT };
  } catch(e){ factionHidden = { ...FACTION_HIDDEN_DEFAULT }; }
}
async function saveFactionHidden(){ try { await supaStorage.set('faction-hidden', JSON.stringify(factionHidden), true); } catch(e){ console.error('Faction hidden save failed', e); } }
function toggleFactionHidden(id){
  if(typeof isReferee === 'function' && !isReferee()) return; // referee-only
  factionHidden[id] = !factionHidden[id];
  saveFactionHidden();                              // fire-and-forget; players pick it up on their next poll
  if(typeof HX !== 'undefined') HX.refresh();       // referee's own view updates immediately
  if(typeof showToast === 'function'){ const nm = (GALAXY_FACTIONS[id]||{}).name || id;
    showToast('“' + nm + '” ' + (factionHidden[id] ? 'hidden from' : 'revealed to') + ' players', 'info'); }
}

function effectiveFactions(){
  const out = {};
  Object.keys(GALAXY_FACTIONS_BASE).forEach(id => {
    if(factionDeletions[id]) return;
    const clone = JSON.parse(JSON.stringify(GALAXY_FACTIONS_BASE[id]));
    const ov = factionPropertyOverrides[id];
    out[id] = ov ? Object.assign(clone, ov) : clone;
  });
  Object.keys(factionAdditions).forEach(id => { if(!factionDeletions[id]) out[id] = JSON.parse(JSON.stringify(factionAdditions[id])); });
  return out;
}
// Rebuild GALAXY_FACTIONS in place (same object reference, so every FAC[id]
// lookup keeps working). Colours/names are read live at render, so a refresh
// is all that's needed downstream.
function rebuildFactionsFromOverlay(){
  const eff = effectiveFactions();
  Object.keys(GALAXY_FACTIONS).forEach(k => delete GALAXY_FACTIONS[k]);
  Object.keys(eff).forEach(k => GALAXY_FACTIONS[k] = eff[k]);
}

function hxAddFaction(){
  if(!designModeOn || !isReferee()) return;
  let id = 'reg' + Date.now().toString(36), bump = 1;
  while(GALAXY_FACTIONS[id] || factionDeletions[id]) id = 'reg' + (Date.now() + bump++).toString(36);
  factionAdditions[id] = { name: 'New Region', color: '#66bbaa' };
  saveFactionAdditions();
  rebuildFactionsFromOverlay();
  if(typeof HX !== 'undefined') HX.refresh();
  showToast('Region added — name it and pick a colour');
}
function hxEditFactionField(id, field, value){
  if(!isReferee()) return;
  const add = factionAdditions[id];
  if(add){ add[field] = value; saveFactionAdditions(); }
  else if(GALAXY_FACTIONS_BASE[id]){ if(!factionPropertyOverrides[id]) factionPropertyOverrides[id] = {}; factionPropertyOverrides[id][field] = value; saveFactionPropertyOverrides(); }
  else return;
  rebuildFactionsFromOverlay();
  if(typeof HX !== 'undefined') HX.refresh();
}
async function hxRemoveFaction(id){
  if(!designModeOn || !isReferee()) return;
  if(id === 'independent' || id === 'uncharted'){ alert('The Independent and Uncharted regions are built-in fallbacks and can’t be removed.'); return; }
  const fac = GALAXY_FACTIONS[id]; if(!fac) return;
  const members = GALAXY_NODES.filter(n => n.faction === id).map(n => n.id);
  let msg = 'Remove the region "' + (fac.name || id) + '"?';
  if(members.length) msg += '\n\n' + members.length + ' system' + (members.length > 1 ? 's' : '') + ' in this region will become Independent.';
  msg += ' Restorable from "Show Removed Items".';
  if(!confirm(msg)) return;
  // Reassign member systems → independent so nothing dangles (one batched save).
  members.forEach(sid => {
    const add = systemAdditions.find(s => s.id === sid);
    if(add) add.faction = 'independent';
    else { if(!systemPropertyOverrides[sid]) systemPropertyOverrides[sid] = {}; systemPropertyOverrides[sid].faction = 'independent'; }
  });
  const wasAdd = !!factionAdditions[id];
  factionDeletions[id] = { fac: factionAdditions[id] || JSON.parse(JSON.stringify(GALAXY_FACTIONS_BASE[id] || fac)), t: Date.now(), wasAddition: wasAdd };
  if(wasAdd) delete factionAdditions[id];
  await saveFactionDeletions();
  if(wasAdd) await saveFactionAdditions();
  if(members.length){ await saveSystemAdditions(); await saveSystemPropertyOverrides(); }
  rebuildFactionsFromOverlay();
  rebuildSystemsFromOverlay();
  if(typeof HX !== 'undefined') HX.refresh();
  showToast('Region removed', 'info');
}
async function restoreDeletedFaction(id){
  const entry = factionDeletions[id]; if(!entry) return;
  if(entry.wasAddition && entry.fac){ factionAdditions[id] = entry.fac; await saveFactionAdditions(); }
  delete factionDeletions[id];
  await saveFactionDeletions();
  rebuildFactionsFromOverlay();
  if(typeof HX !== 'undefined') HX.refresh();
  if(typeof closeRemovedItemsPanel === 'function') closeRemovedItemsPanel();
  showToast('Region restored');
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTE BLOCKING  (V2 — referee-controlled jump-lane closures + auto advisory)
// ───────────────────────────────────────────────────────────────────────────
// Shared campaign state in aurelia_state key 'route-blocks'. Two layers:
//   • Manual blocks — hard, story-truth closures the referee sets per lane
//     (red). Each carries an optional reason and an `explain` flag (default
//     true) controlling whether nav crew see the reason or just "unavailable".
//   • Auto advisory — soft, derived from ship state (amber). Treated globally:
//     a jump lane is a single jump in this map's model, so if the ship cannot
//     currently make ANY jump (no J-drive, or fuel below one jump's worth) the
//     whole network is flagged out-of-range. We deliberately do NOT invent
//     per-lane parsec distances the data model doesn't carry.
// `enabled` is the kill-switch: flipping it off makes every manual block inert
// instantly. Block/advisory styling is shown only to the nav crew (Rhett +
// Cass) and the referee; other players see ordinary lanes.
// ═══════════════════════════════════════════════════════════════════════════

let routeBlocks = { enabled: true, blocks: {} };

async function loadRouteBlocks(){
  try { const r = await supaStorage.get('route-blocks', true); if(r.value != null){ const v = JSON.parse(r.value); routeBlocks = { enabled: v.enabled !== false, blocks: v.blocks || {} }; } }
  catch(e){ routeBlocks = { enabled: true, blocks: {} }; }
}
async function saveRouteBlocks(){
  try { await supaStorage.set('route-blocks', JSON.stringify(routeBlocks), true); }
  catch(e){ console.error('Route blocks save failed:', e); }
}

// ── Territory hex paint (referee-defined, shared) ───────────────────────────
// A map of hex → colour ("q,r" → "#rrggbb"), painted by the referee with the
// map's colour picker (see hxTogglePaint / paintPick in the HX engine). Rendered
// as translucent coloured hexes in the territory overlay, on top of the
// auto-derived region tint. Shared campaign state, like route blocks and reveal
// flags, so every player sees the same painted borders. Colours only — never a
// faction identity — so painting can't leak a hidden region's spoilers.
let hexPaint = {};
async function loadHexPaint(){
  try { const r = await supaStorage.get('hex-paint', true); hexPaint = (r.value != null) ? (JSON.parse(r.value) || {}) : {}; }
  catch(e){ hexPaint = {}; }
}
async function saveHexPaint(){
  try { await supaStorage.set('hex-paint', JSON.stringify(hexPaint || {}), true); }
  catch(e){ console.error('Hex paint save failed:', e); }
}

// A lane counts as blocked only while the kill-switch (enabled) is on. Blocks are
// a visual/story signal for nav crew — they do NOT alter the route planner
// (advisory only, per docs/phase-2-feasibility-study.md §5); the referee narrates
// the gate. Referee sets them; Rhett/Cass see them; other players see plain lanes.
let gxBlockMode = false; // referee "tap a lane to close/open it" mode
function isLaneBlocked(k){ return !!(routeBlocks.enabled && routeBlocks.blocks && routeBlocks.blocks[k]); }
function gxArmBlock(){
  if(typeof isReferee === 'function' && !isReferee()) return;
  gxBlockMode = !gxBlockMode;
  showToast(gxBlockMode ? 'Block mode ON — tap a jump lane to close/open it' : 'Block mode off');
  if(typeof HX !== 'undefined') HX.refresh();
}
function gxToggleBlock(k){
  if(typeof isReferee === 'function' && !isReferee()) return;
  routeBlocks.blocks = routeBlocks.blocks || {};
  if(routeBlocks.blocks[k]){ delete routeBlocks.blocks[k]; showToast('Jump lane reopened'); }
  else {
    let reason = '';
    try { const r = prompt('Reason nav crew sees (blank = "Route closed"):', ''); if(r === null) return; reason = r.trim(); } catch(e){}
    routeBlocks.blocks[k] = { reason, explain: true };
    showToast('Jump lane closed');
  }
  saveRouteBlocks();
  if(typeof HX !== 'undefined') HX.refresh();
}
function gxToggleBlocksEnabled(){
  if(typeof isReferee === 'function' && !isReferee()) return;
  routeBlocks.enabled = !routeBlocks.enabled;
  saveRouteBlocks();
  showToast(routeBlocks.enabled ? 'Route blocks active' : 'Route blocks disabled (kill-switch)');
  if(typeof HX !== 'undefined') HX.refresh();
}

// ═══ WORLD GENERATOR — one rules-correct MgT2e UWP + trade-code engine ═══════
// Single source of truth shared by BOTH the galaxy map (HX.uwpOf — seeded,
// per-device-deterministic) and the Add-Body / system auto-generators (Math.random).
// Pass any rng()->[0,1); callers supply a seeded rng for reproducible map output.
// Trade codes + uwpStr read fields flexibly so both the HX shape ({port,atmo,tl})
// and the body-modal shape ({starport,atm,tech}) work unchanged.
const WGEN = (function(){
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  function hashStr(s){ s=String(s); let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
  function mulberry(seed){ return function(){ seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
  function seededRng(str){ return mulberry(hashStr(str)); }
  // Traveller extended hex: 0-9 then A.. skipping I and O (canonical).
  const EHEX='0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  function ehex(n){ return EHEX[clamp(Math.round(n),0,EHEX.length-1)]; }
  function d6(rng){ return 1 + Math.floor((rng||Math.random)()*6); }
  function roll2d6(rng){ return d6(rng) + d6(rng); }
  // Starport: 2D + Population DM (RAW): Pop 8–9 +1, 10+ +2, Pop 3–4 −1, ≤2 −2.
  // Pass pop when known; omitted → flat 2D (legacy callers).
  function genStarport(rng, pop){
    let dm=0; if(pop!=null){ pop|=0; dm = pop>=10?2 : pop>=8?1 : pop<=2?-2 : pop<=4?-1 : 0; }
    const r=roll2d6(rng)+dm;
    return r<=2?'X':r<=4?'E':r<=6?'D':r<=8?'C':r<=10?'B':'A';
  }
  // Tech Level: 1D + DMs (starport/size/atmo/hydro/pop/gov) — MgT2e RAW.
  function genTechLevel(rng, starport, size, atm, hydro, pop, gov){
    let dm=0;
    dm += ({A:6,B:4,C:2,X:-4})[starport] || 0;
    if(size<=1) dm+=2; else if(size<=4) dm+=1;
    if(atm<=3 || atm>=10) dm+=1;
    if(hydro===0 || hydro===9) dm+=1; else if(hydro===10) dm+=2;
    if(pop>=1 && pop<=5) dm+=1; else if(pop===8) dm+=1; else if(pop===9) dm+=2; else if(pop>=10) dm+=4;
    if(gov===0 || gov===5) dm+=1; else if(gov===7) dm+=2; else if(gov===13 || gov===14) dm-=2;
    return clamp(d6(rng)+dm, 0, 33);
  }
  // Generate a UWP. opts:{ rng, port, core, deep, tlFloor }.
  //  rng     — defaults Math.random; pass a seeded rng for reproducible output.
  //  port    — fixed starport (map worlds derive it from faction); omitted → rolled.
  //  core    — +1 pop and a +2 tech bump for high-civilisation core worlds (map only).
  //  deep    — minimal deep-space outpost profile (map only).
  //  tlFloor — minimum tech level (map starports imply a floor).
  // Returns { port, size, atmo, hydro, pop, gov, law, tl } (UWP order).
  function genUWP(opts){
    opts = opts || {};
    const rng = opts.rng || Math.random;
    if(opts.deep){ const port = opts.port || genStarport(rng);
      return { port, size:0, atmo:0, hydro:0, pop: rng()<.5?1:2, gov:0, law:0, tl: opts.core?12:10 }; }
    const size = clamp(roll2d6(rng)-2, 0, 10);
    const atmo = size===0 ? 0 : clamp(roll2d6(rng)-7+size, 0, 15);
    // Temperature: 2D + atmosphere DM (RAW), rolled before hydrographics because
    // hot/boiling climates bake surface water off (−2 / −6, unless Atmo D/F).
    const tdm = (atmo===2||atmo===3)?-2 : (atmo===4||atmo===5||atmo===14)?-1
              : (atmo===8||atmo===9)?1 : (atmo===10||atmo===13||atmo===15)?2
              : (atmo===11||atmo===12)?6 : 0;
    const temp = roll2d6(rng)+tdm;
    let hydro;
    if(size<=1) hydro=0;
    else { let dm=0; if(atmo<=1||atmo>=10) dm-=4;
      if(atmo!==13&&atmo!==15){ if(temp>=12) dm-=6; else if(temp>=10) dm-=2; }
      hydro = clamp(roll2d6(rng)-7+atmo+dm, 0, 10); }   // hydro DM keys off ATMOSPHERE (RAW), not size
    let pop = clamp(roll2d6(rng)-2, 0, 12); if(opts.core) pop = clamp(pop+1, 0, 12);
    const gov = pop===0 ? 0 : clamp(roll2d6(rng)-7+pop, 0, 15);
    const law = pop===0 ? 0 : clamp(roll2d6(rng)-7+gov, 0, 15);
    // Starport is rolled AFTER Population so its RAW Pop DM can apply. Map worlds
    // pass a fixed opts.port, so their seeded dice sequence is unchanged by this.
    const port = opts.port || genStarport(rng, pop);
    let tl = pop===0 ? 0 : genTechLevel(rng, port, size, atmo, hydro, pop, gov);
    if(opts.core) tl = clamp(tl+2, 0, 33);
    if(opts.tlFloor!=null) tl = clamp(Math.max(tl, opts.tlFloor), 0, 33);
    return { port, size, atmo, hydro, pop, gov, law, tl, temp };
  }
  // Field-flexible accessors so both UWP shapes work.
  const fAtm = u => (u.atmo!=null?u.atmo:u.atm)|0, fTl = u => (u.tl!=null?u.tl:u.tech)|0, fPort = u => u.port||u.starport;
  // Temperature band label (RAW). Atmo 0–1 worlds have no climate to speak of —
  // extreme day/night swings; authored UWPs without a stored temp return null.
  function tempBand(u){ if(u==null) return null; if(fAtm(u)<=1) return 'Extreme swings';
    const t=u.temp; if(t==null) return null;
    return t<=2?'Frozen':t<=4?'Cold':t<=9?'Temperate':t<=11?'Hot':'Boiling'; }
  // Environmental minimum TL to sustain a population (RAW life-support viability);
  // 0 = shirt-sleeve world, no floor.
  function envMinTL(u){ const a=fAtm(u);
    return (a<=1||a===10)?8 : (a===2||a===3)?5 : (a===4||a===7||a===9)?3
         : (a===11)?9 : (a===12)?10 : (a===13||a===14)?5 : (a===15)?8 : 0; }
  function uwpStr(u){ return fPort(u)+ehex(u.size)+ehex(fAtm(u))+ehex(u.hydro)+ehex(u.pop)+ehex(u.gov)+ehex(u.law)+'-'+ehex(fTl(u)); }
  // Canonical MgT2e trade codes (single source of truth).
  function tradeCodes(u){
    const c=[], size=u.size|0, atmo=fAtm(u), hydro=u.hydro|0, pop=u.pop|0, gov=u.gov|0, law=u.law|0, tl=fTl(u);
    if(atmo>=4&&atmo<=9 && hydro>=4&&hydro<=8 && pop>=5&&pop<=7) c.push('Ag');
    if(size===0&&atmo===0&&hydro===0) c.push('As');
    if(pop===0&&gov===0&&law===0) c.push('Ba');
    if(atmo>=2&&hydro===0) c.push('De');
    if(atmo>=10&&hydro>=1) c.push('Fl');
    if(size>=6&&size<=8 && [5,6,8].includes(atmo) && hydro>=5&&hydro<=7) c.push('Ga');
    if(pop>=9) c.push('Hi');
    if(tl>=12) c.push('Ht');                                           // High-Tech: TL ≥ 12
    if(atmo<=1&&hydro>=1) c.push('Ic');
    if([0,1,2,4,7,9,10,11,12].includes(atmo) && pop>=9) c.push('In'); // Industrial: canonical atmo set
    if(pop>=1&&pop<=3) c.push('Lo');
    if(pop>=1&&tl<=5) c.push('Lt');                                    // Low-Tech: Pop 1+, TL ≤ 5
    if(atmo<=3&&hydro<=3&&pop>=6) c.push('Na');
    if(pop>=4&&pop<=6) c.push('Ni');
    if(atmo>=2&&atmo<=5&&hydro<=3) c.push('Po');
    if([6,8].includes(atmo) && pop>=6&&pop<=8 && gov>=4&&gov<=9) c.push('Ri');
    if(atmo===0) c.push('Va');
    if(hydro===10) c.push('Wa');
    return c;
  }
  return { clamp, hashStr, mulberry, seededRng, ehex, d6, roll2d6, genStarport, genTechLevel, genUWP, uwpStr, tradeCodes, tempBand, envMinTL };
})();

// ═══ GALAXY MAP — HEX-JUMP ENGINE (ported onto main; replaces the Orion render layer) ═══
const HX = (function(){
  // ── Astrometry reference (real J2000 distances, ly) — joined to GALAXY_NODES
  //    by star name. Used ONLY for the "real distance from Sol" readout and to
  //    pack each faction's nearest worlds closest to its anchor. The MAP layout
  //    is hand-clustered by faction (political clarity over real distance).
  const LY = { 'Sol':0,'Alpha Centauri':4.37,"Barnard's Star":5.96,'Wolf 359':7.86,
    'Lalande 21185':8.31,'Sirius':8.66,'Luyten 726-8':8.79,'Ross 154':9.70,'Ross 248':10.30,
    'Epsilon Eridani':10.48,'Lacaille 9352':10.74,'Ross 128':11.01,'61 Cygni':11.40,'Procyon':11.46,
    'Groombridge 34':11.62,'Epsilon Indi':11.87,'Tau Ceti':11.91,"Luyten's Star":12.36,
    "Kapteyn's Star":12.83,'Wolf 294':14.80,'Gliese 674':14.81,'Gliese 876':15.24,'Gliese 832':16.16,
    '82 Eridani':19.71,'36 Ophiuchi':19.50,'Eta Cassiopeiae':19.42,'Gliese 581':20.40,'Gliese 555':20.40,
    'Gliese 754':19.30,'HD 219134':21.34,'Gliese 667':23.20,'Vega':25.04,'Beta Comae':29.95,
    'Pollux':33.78,'TRAPPIST-1':40.66,'Castor':51.00,'Ursae Majoris':29.65,'Gliese 505':35.83,
    'Gliese 563':87.90,'Gliese 706':36.20,'Gliese 710':62.25,'Gliese 693':19.21,'Gliese 777':52.20,
    'Gliese 806':39.35,'Gliese 293':26.64,'Hyades Cluster':153.0,'Gliese 445':17.55 };
  const LY_PER_PC=3.261564;
  function lyOf(name){ if(!name) return null; if(LY[name]!=null) return LY[name];
    const base=name.replace(/\s+[A-Za-z]{1,2}$/,'').trim(); return LY[base]!=null?LY[base]:null; }
  function pcOf(name){ const ly=lyOf(name); return ly==null?null:ly/LY_PER_PC; }
  function ehexVal(c){ if(c==null) return 0; if(/[0-9]/.test(c)) return +c;
    const u=String(c).toUpperCase().charCodeAt(0); return (u>=65&&u<=90)?(u-55):0; }
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  const disp=s=>String((s&&(s.label||s.star))||'').replace(' ★','');
  const eh=s=>(typeof escHtml==='function'?escHtml(String(s)):String(s));
  function ref(){ return typeof isReferee!=='function' || isReferee(); }
  // Faction visibility: to a player a referee-hidden faction is redacted to the
  // neutral "Uncharted" region so its name / colour / territory can't spoil it.
  // The referee always sees the truth.
  function facHidden(facId){ return !ref() && typeof factionHidden!=='undefined' && !!factionHidden[facId]; }
  function effFac(facId){ const F=(typeof GALAXY_FACTIONS!=='undefined')?GALAXY_FACTIONS:{};
    if(facHidden(facId)) return F.uncharted || {name:'Uncharted', color:'#9fb0c8'};
    return F[facId] || {name:'Independent', color:'#9fb0c8'}; }

  // ── Hex math (flat-top axial, 1 hex = 1 parsec) ──
  function hexDist(a,b){return (Math.abs(a.q-b.q)+Math.abs(a.r-b.r)+Math.abs(a.q+a.r-b.q-b.r))/2;}
  const DIRS=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
  function spiral(cx,cy,maxR){ const out=[{q:cx,r:cy}];
    for(let rad=1;rad<=maxR;rad++){ let h={q:cx+DIRS[4][0]*rad,r:cy+DIRS[4][1]*rad};
      for(let side=0;side<6;side++) for(let i=0;i<rad;i++){ out.push({q:h.q,r:h.r}); h={q:h.q+DIRS[side][0],r:h.r+DIRS[side][1]}; } }
    return out; }

  // ── Build hex systems from GALAXY_NODES, hand-clustered by faction ──
  // Faction anchors spread ~2.2× wider than the original 53-world map so the far larger
  // (~180-world) clusters sit apart with real interstellar gaps between regions — more
  // parsecs (hexes) to cross between powers, without crowding the hex grid.
  const FACTION_ANCHOR={ hegemony:[0,0], contested:[9,-4], sanhedrin:[15,-9], omnisynth:[9,-13],
    uhc:[9,9], archon:[20,7], vast:[2,15], rsc:[-13,0] };
  const IND_POCKETS=[[-18,7],[-11,14],[-4,20],[13,11],[22,-3],[-7,-9],[16,-16],[-20,-6],[6,22],[24,4]];
  const FAC_ORDER=['hegemony','sanhedrin','omnisynth','uhc','contested','rsc','archon','vast'];
  function isDeep(n){ return /deep space|mobile|uncharted nebula/i.test(n.name||''); }
  const SYS=(typeof GALAXY_NODES!=='undefined'?GALAXY_NODES:[]).map(n=>({ id:n.id, systemId:n.systemId||n.id,
    star:n.name, label:(n.label||n.name), fac:n.faction, connections:n.connections||[],
    pc:pcOf(n.name), deep:isDeep(n), campaign:true, q:null, r:null }));
  const occupied=new Set();
  // Spread placement: stars in a territory sit ≥ HEX_SPACING hexes apart, so a faction reads as a
  // scattered REGION of systems with space between them — not a solid blob of adjacent stars.
  const HEX_SPACING=2;
  const hDist=(x,y)=>(Math.abs(x.q-y.q)+Math.abs(x.q+x.r-y.q-y.r)+Math.abs(x.r-y.r))/2;
  function placeSpread(members, anchor, maxR){
    const sp=spiral(anchor[0],anchor[1],maxR), placed=[];
    members.forEach(m=>{
      let h=null;
      for(let i=0;i<sp.length;i++){ const c=sp[i]; if(occupied.has(c.q+','+c.r)) continue;   // pass 1: honour spacing
        if(placed.some(p=>hDist(p,c)<HEX_SPACING)) continue; h=c; break; }
      if(!h) for(let i=0;i<sp.length;i++){ const c=sp[i]; if(!occupied.has(c.q+','+c.r)){ h=c; break; } }  // pass 2: any free cell
      h=h||{q:anchor[0],r:anchor[1]};
      occupied.add(h.q+','+h.r); m.q=h.q; m.r=h.r; placed.push(h);
    });
  }
  function clusterFaction(fac){ placeSpread(SYS.filter(x=>x.fac===fac).sort((x,y)=>(x.pc==null?9999:x.pc)-(y.pc==null?9999:y.pc)), FACTION_ANCHOR[fac]||[0,0], 18); }
  FAC_ORDER.forEach(clusterFaction);
  // Independents scatter across their pockets (round-robin), spread within each pocket.
  { const inds=SYS.filter(x=>x.fac==='independent').sort((x,y)=>(x.pc==null?9999:x.pc)-(y.pc==null?9999:y.pc));
    const pockets={}; inds.forEach((m,idx)=>{ (pockets[idx%IND_POCKETS.length]=pockets[idx%IND_POCKETS.length]||[]).push(m); });
    Object.keys(pockets).forEach(k=> placeSpread(pockets[k], IND_POCKETS[k], 7)); }
  const sp0=spiral(0,0,42); let _j=0;
  SYS.filter(x=>x.q==null).forEach(m=>{ while(_j<sp0.length&&occupied.has(sp0[_j].q+','+sp0[_j].r))_j++;
    const h=sp0[_j]||{q:0,r:0}; occupied.add(h.q+','+h.r); m.q=h.q; m.r=h.r; _j++; });

  // ── (A) Uncharted frontier: real nearby stars with no campaign identity. Any
  //    star in the catalogue NOT already claimed by a GALAXY_NODES system becomes
  //    a non-drillable "uncharted" waypoint, dropped into the largest remaining
  //    void by a farthest-point fill so it bridges the faction blobs and modest
  //    jump drives can island-hop across borders (mirrors the prototype). ──
  const STAR_CATALOG=[
    {name:'Sol',ly:0},{name:'Alpha Centauri',ly:4.37},{name:"Barnard's Star",ly:5.96},
    {name:'Wolf 359',ly:7.86},{name:'Lalande 21185',ly:8.31},{name:'Sirius',ly:8.66},
    {name:'Luyten 726-8',ly:8.79},{name:'Ross 154',ly:9.70},{name:'Ross 248',ly:10.30},
    {name:'Epsilon Eridani',ly:10.48},{name:'Lacaille 9352',ly:10.74},{name:'Ross 128',ly:11.01},
    {name:'EZ Aquarii',ly:11.27},{name:'61 Cygni',ly:11.40},{name:'Procyon',ly:11.46},
    {name:'Struve 2398',ly:11.49},{name:'Groombridge 34',ly:11.62},{name:'Epsilon Indi',ly:11.87},
    {name:'DX Cancri',ly:11.83},{name:'Tau Ceti',ly:11.91},{name:'Gliese 1061',ly:11.99},
    {name:'YZ Ceti',ly:12.13},{name:"Luyten's Star",ly:12.36},{name:"Teegarden's Star",ly:12.50},
    {name:"Kapteyn's Star",ly:12.83},{name:'Lacaille 8760',ly:12.95},{name:'Kruger 60',ly:13.15},
    {name:'Wolf 1061',ly:14.05},{name:'Wolf 294',ly:14.80},{name:'Gliese 674',ly:14.81},
    {name:'Gliese 876',ly:15.24},{name:'Gliese 832',ly:16.16},{name:'40 Eridani',ly:16.26},
    {name:'70 Ophiuchi',ly:16.59},{name:'Altair',ly:16.73},{name:'Gliese 445',ly:17.55},
    {name:'Gliese 526',ly:17.60},{name:'Gliese 682',ly:16.33},{name:'Sigma Draconis',ly:18.80},
    {name:'Gliese 229',ly:18.79},{name:'36 Ophiuchi',ly:19.50},{name:'Eta Cassiopeiae',ly:19.42},
    {name:'82 Eridani',ly:19.71},{name:'Delta Pavonis',ly:19.92},{name:'Gliese 581',ly:20.40},
    {name:'Gliese 555',ly:20.40},{name:'Gliese 754',ly:19.30},{name:'HD 219134',ly:21.34},
    {name:'Gliese 667',ly:23.20},{name:'Vega',ly:25.04},{name:'Fomalhaut',ly:25.13},
    {name:'Beta Comae',ly:29.95},{name:'Pollux',ly:33.78},{name:'TRAPPIST-1',ly:40.66},
    {name:'Castor',ly:51.00},{name:'Ursae Majoris',ly:29.65},{name:'Gliese 505',ly:35.83},
    {name:'Gliese 563',ly:87.90},{name:'Gliese 706',ly:36.20},{name:'Gliese 710',ly:62.25},
    {name:'Gliese 693',ly:19.21},{name:'Gliese 777',ly:52.20},{name:'Gliese 806',ly:39.35},
    {name:'Gliese 293',ly:26.64},{name:'Hyades Cluster',ly:153.0},
    {name:'Gliese 412',ly:15.83},{name:'AD Leonis',ly:16.20},{name:'Gliese 687',ly:14.79},
    {name:'Gliese 1245',ly:15.20},{name:'Wolf 1055',ly:19.30},{name:'Groombridge 1618',ly:15.89},
    {name:'Stein 2051',ly:18.00},{name:'Gliese 205',ly:18.61},{name:'Gliese 570',ly:19.00},
    {name:'Gliese 783',ly:19.62},{name:'Xi Bootis',ly:21.90},{name:'61 Virginis',ly:27.90},
    {name:'p Eridani',ly:26.62},{name:'107 Piscium',ly:24.40},
  ];
  const baseStar=n=>String(n||'').replace(/\s+[A-Za-z]{1,2}$/,'').trim();
  const slug=n=>String(n).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  const campStars=new Set(); SYS.forEach(s=>{ campStars.add(baseStar(s.star)); campStars.add(String(s.star||'').trim()); });
  const UNCH=STAR_CATALOG
    .filter(c=>!campStars.has(baseStar(c.name)) && !campStars.has(c.name.trim()))
    .map(c=>({ id:'unchart-'+slug(c.name), systemId:null, star:c.name, label:c.name, fac:'uncharted',
      connections:[], pc:(c.ly!=null?c.ly/LY_PER_PC:null), deep:false, campaign:false, uncharted:true, q:null, r:null }));
  (function fillNeutral(){
    const placed=SYS.filter(x=>x.q!=null); if(!placed.length) return;
    let mnQ=99,mxQ=-99,mnR=99,mxR=-99;
    placed.forEach(s=>{mnQ=Math.min(mnQ,s.q);mxQ=Math.max(mxQ,s.q);mnR=Math.min(mnR,s.r);mxR=Math.max(mxR,s.r);});
    const cands=[]; for(let q=mnQ-1;q<=mxQ+1;q++) for(let r=mnR-1;r<=mxR+1;r++) if(!occupied.has(q+','+r)) cands.push({q,r});
    const pts=placed.slice();
    UNCH.forEach(m=>{ let best=null,bestD=-1;
      cands.forEach(c=>{ if(occupied.has(c.q+','+c.r)) return; let md=99;
        for(const p of pts){ const d=hexDist(c,p); if(d<md) md=d; } if(md>bestD){ bestD=md; best=c; } });
      if(!best) best=spiral(0,0,40).find(h=>!occupied.has(h.q+','+h.r))||{q:0,r:0};
      occupied.add(best.q+','+best.r); m.q=best.q; m.r=best.r; pts.push(m); SYS.push(m); });
  })();

  const BY_KEY={}; SYS.forEach(s=>BY_KEY[s.q+','+s.r]=s);
  const BY_ID={};  SYS.forEach(s=>BY_ID[s.id]=s);

  // ── Lanes ← the host's editable GX_LANES overlay (with surveyed-route discount) ──
  const LANE_FUEL_FACTOR=FUEL_RULES.laneFuelFactor;   // surveyed jump-lane discount (house rule; tune/disable via FUEL_RULES in 00-core-data.js)
  function laneEdges(){ const out=[]; if(typeof GX_LANES==='undefined') return out;
    GX_LANES.forEach(k=>{ const parts=k.split('|'), sa=BY_ID[parts[0]], sb=BY_ID[parts[1]];
      if(sa&&sb&&sa!==sb) out.push({a:sa,b:sb,len:hexDist(sa,sb),key:k}); }); return out; }
  function onLane(a,b){ return typeof GX_LANES!=='undefined' && typeof gxLaneKey==='function'
    && GX_LANES.has(gxLaneKey(a.id,b.id)); }

  // ── Refuelling: starport class (A/B refined, C/D unrefined, X none; E stocks
  //    no fuel of its own (RAW) — wilderness skim only, if the system offers a
  //    gas/ice giant or surface water).
  //    Prefer the real surveyed main-world UWP[0]; else a label override; else default.
  const PORT_OVERRIDE={ 'Aurelia ★':'B','Watchtower':'B','Vega':'A','Castor':'B','Alpha Centauri':'B',
    'Kronos Prime':'B','The Anvil':'B','Terminus':'B','Avalon':'B','Vestalia':'B','The Hammer':'B','The Forge':'B',
    "Haven's Gate":'D','Ophion Prime':'D','Dust':'D','Erebus':'D','Freeport Omega':'D',
    'Silent Night':'X','The Echo':'X','The Mausoleum':'X','Zephyria Prime':'X','Threshold':'X','Echo':'X','The Watch':'X','The Fade':'X' };
  function parseUwp(str){ if(!str||str==='—') return null; const raw=String(str).replace('-','').toUpperCase();
    if(raw.length<8||!/[A-EX]/.test(raw[0])) return null;
    return { port:raw[0], size:ehexVal(raw[1]),atmo:ehexVal(raw[2]),hydro:ehexVal(raw[3]),
      pop:ehexVal(raw[4]),gov:ehexVal(raw[5]),law:ehexVal(raw[6]),tl:ehexVal(raw[7]) }; }
  function realMainWorld(systemId){ if(!systemId) return null;   // uncharted waypoints have no surveyed system — never borrow another's bodies
    try{ const bodies=(typeof effectiveBodies==='function'?effectiveBodies(systemId):[])||[];
      let best=null,bestScore=-1; bodies.forEach(b=>{ if(b.isStar) return; const u=parseUwp(b.uwpString); if(!u) return;
        const score=(b.hook?100:0)+u.pop; if(score>bestScore){bestScore=score;best={uwp:u,body:b};} }); return best; }catch(e){ return null; } }
  function portOf(s){ const real=realMainWorld(s.systemId); if(real) return real.uwp.port;
    if(PORT_OVERRIDE[s.label]!=null) return PORT_OVERRIDE[s.label]; return s.deep?'X':'C'; }
  // Dead regions — The Vast and the Archon Collective run no commercial trade
  // and no refuelling infrastructure, so their systems never offer fuel or a
  // market regardless of any surveyed starport class.
  const NO_MARKET_FACS={ vast:1, archon:1 };
  function hasMarket(s){ return !!s && !NO_MARKET_FACS[s.fac]; }
  // Wilderness refuelling source: a gas/ice giant to skim, or surface water to purify.
  function skimSourceAt(s){
    try{ const bodies=(typeof effectiveBodies==='function'?effectiveBodies(s.systemId):[])||[];
      if(bodies.some(b=> b.discStyle==='gasgiant' || /gas giant|ice giant/i.test(b.type||''))) return true; }catch(e){}
    try{ return (uwpOf(s).hydro|0)>=1; }catch(e){ return false; }
  }
  function fuelAt(s){ if(s&&NO_MARKET_FACS[s.fac]) return 'none'; const p=portOf(s);
    if(p==='A'||p==='B') return 'refined';
    if(p==='X') return 'none';
    if(p==='E') return skimSourceAt(s)?'unrefined':'none';
    return 'unrefined'; }
  const FUEL_INFO={ refined:{c:'#3f9d5a',t:'Refined fuel'}, unrefined:{c:'#caa83b',t:'Unrefined (skim)'}, none:{c:'#b23a3a',t:'No fuel'} };

  // ── UWP + trade (MgT2e). Prefer the real surveyed UWP; else generate deterministically. ──
  function hashStr(s){ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
  function mulberry(seed){ return function(){ seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
  function eHex(n){ return WGEN.ehex(n); }
  // Uncharted worlds get a deterministic UWP from the shared rules-correct generator,
  // seeded on the star name so every device produces the same world. Surveyed worlds
  // (realMainWorld) keep their authored UWP. Faction core worlds run high-tech; the
  // starport implies a tech floor.
  function uwpOf(s){ if(s._uwp) return s._uwp;
    const real=realMainWorld(s.systemId); if(real){ s._uwp=real.uwp; return real.uwp; }
    const core=['hegemony','omnisynth','uhc','sanhedrin'].includes(s.fac), port=portOf(s);
    const tlFloor={A:10,B:8,C:5,D:0,E:0,X:0}[port]||0;
    const u=WGEN.genUWP({ rng:WGEN.seededRng(s.star||s.label), port, core, deep:s.deep, tlFloor });
    s._uwp=u; return u; }
  function uwpStr(s){ return WGEN.uwpStr(uwpOf(s)); }
  function tradeCodes(s){ return WGEN.tradeCodes(uwpOf(s)); }
  // MgT2e Core 2022 Trade Goods table (curated subset for the map catalogue).
  // Cells verified against the rulebook (2e rules audit, 114-2026); deviations
  // kept on purpose are marked HOUSE. Negative DMs are real — bestDM() honours
  // them when they're the only applicable entry in a column.
  const TRADE_GOODS=[
    {name:'Common Electronics',base:20000,buy:{In:2,Ht:3,Ri:1},sell:{Ni:2,Lt:1,Po:1},avail:'all'},
    {name:'Common Industrial',base:10000,buy:{Na:2,In:5},sell:{Ni:3,Ag:2},avail:'all'},
    {name:'Common Manufactured',base:20000,buy:{Na:2,In:5},sell:{Ni:3,Hi:2},avail:'all'},
    {name:'Common Raw Materials',base:5000,buy:{Ag:3,Ga:2},sell:{In:2,Po:2},avail:'all'},
    {name:'Common Consumables',base:2000,buy:{Ag:3,Wa:2,Ga:1,As:-4},sell:{As:1,Fl:1,Ic:1,Hi:1},avail:'all'},   // HOUSE: base Cr2,000 (RAW Cr500)
    {name:'Common Ore',base:1000,buy:{As:4},sell:{In:3,Ni:1},avail:'all'},
    {name:'Advanced Electronics',base:100000,buy:{In:2,Ht:3},sell:{Ni:1,Ri:2,As:3},avail:['In','Ht']},
    {name:'Biochemicals',base:50000,buy:{Ag:1,Wa:2},sell:{In:2},avail:['Ag','Wa']},
    {name:'Crystals & Gems',base:20000,buy:{As:2,De:1,Ic:1},sell:{In:3,Ri:2},avail:['As','De','Ic']},
    {name:'Cybernetics',base:250000,buy:{Ht:1},sell:{As:1,Ic:1,Ri:2},avail:['Ht']},
    {name:'Luxury Goods',base:200000,buy:{Hi:1},sell:{Ri:4},avail:['Hi']},
    {name:'Medical Supplies',base:50000,buy:{Ht:2},sell:{In:2,Po:1,Ri:1},avail:['Ht','Hi']},
    {name:'Petrochemicals',base:10000,buy:{De:2,Fl:1,Ic:1,Wa:1},sell:{In:2,Ag:1,Lt:2},avail:['De','Fl','Ic','Wa']},   // HOUSE: buy Fl/Ic/Wa +1 (RAW De+2 only)
    {name:'Pharmaceuticals',base:100000,buy:{As:2,Hi:1},sell:{Ri:2,Lt:1},avail:['As','De','Hi','Wa']},
    {name:'Precious Metals',base:50000,buy:{As:3,De:1,Ic:2},sell:{Ri:3,In:2,Ht:1},avail:['As','De','Ic','Fl']},
    {name:'Radioactives',base:1000000,buy:{As:2,Lo:2},sell:{In:3,Ht:1,Ni:-2,Ag:-3},avail:['As','Lo']},
    {name:'Spices',base:6000,buy:{De:2},sell:{Hi:2,Ri:3,Po:3},avail:['Ga','De','Wa']},
    {name:'Textiles',base:3000,buy:{Ag:7},sell:{Hi:3,Na:2},avail:['Ag','Ni']},
    {name:'Wood',base:1000,buy:{Ag:6},sell:{Ri:2,In:1},avail:['Ag','Ga']},
  ];
  const PURCHASE_PCT=[3.0,2.5,2.0,1.75,1.5,1.35,1.25,1.20,1.15,1.10,1.05,1.00,0.95,0.90,0.85,0.80,0.75,0.70,0.65,0.60,0.55,0.50,0.45,0.40,0.35,0.30,0.25,0.20,0.15];
  const SALE_PCT=[0.10,0.20,0.30,0.40,0.45,0.50,0.55,0.60,0.65,0.70,0.75,0.80,0.85,0.90,1.00,1.05,1.10,1.15,1.20,1.25,1.30,1.40,1.50,1.60,1.75,2.00,2.50,3.00,4.00];
  function priceMult(arr,roll){ const i=clamp(Math.round(roll)+3,0,arr.length-1); return arr[i]; }
  function kCr(n){ n=Math.round(n); const a=Math.abs(n);
    if(a>=1e6) return 'Cr'+(n/1e6).toFixed(2).replace(/\.?0+$/,'')+'M';
    if(a>=1e3) return 'Cr'+(n/1e3).toFixed(1).replace(/\.0$/,'')+'k'; return 'Cr'+n; }
  // Largest applicable DM per column (RAW "use only the largest"). A negative DM
  // counts when it's the only applicable entry; no applicable codes at all → 0.
  function bestDM(dm,codes){ let m=null; for(const c of codes) if(dm[c]!=null) m=(m==null)?dm[c]:Math.max(m,dm[c]); return m==null?0:m; }
  const AVG_ROLL=10.5;             // 3D average — panel shows indicative prices; play rolls 3D6
  const COUNTERPARTY_BROKER=2;     // RAW: supplier/buyer Broker skill (default 2), subtracted from both rolls
  // ── Living market ──────────────────────────────────────────────────────────
  // Every system carries its own supply/demand quirk, and the whole market
  // drifts with the Imperial calendar so prices are never static. `mktPressure`
  // is a signed modifier on a good's local trade roll:
  //    + = locally abundant → cheaper to BUY here, weaker demand to SELL here
  //    − = locally scarce    → dearer to buy here, strong demand to sell here
  // Trade codes (the lore) still drive the bulk of each price via bestDM(); this
  // only layers a bounded, seeded wobble on top, so results stay lore-accurate
  // while differing system-to-system and week-to-week. Seeds are deterministic,
  // so every device computes the same prices for the same Imperial week.
  function imperialWeek(){ return (typeof imperialDate!=='undefined'&&typeof imperialOrdinal==='function')?Math.floor(imperialOrdinal(imperialDate)/7):0; }
  function seedScore(tag){ const r=mulberry(hashStr(tag)); return Math.round(r()*4)-2; }   // −2..+2
  // ── Simple (default) economy ────────────────────────────────────────────────
  // A pure, deterministic price pressure derived STATICALLY from each world's
  // produces/demands profile — no simulation, no stepping, no logistics. Reads the
  // SAME data the full sim uses (ECON.effectiveProfile → DEF table layered with the
  // Design-Mode "Production & Consumption" overrides), so editing a world's economy
  // once drives BOTH modes. Same sign convention as mktPressure:
  //    produces the good          → +  (local glut → cheaper to buy / weaker to sell)
  //    demands it (and makes none) → −  (local scarcity → dearer to buy / stronger to sell)
  //    neither                     → 0  (+ a trivial deterministic ±1 wobble for texture)
  // Magnitude scales crudely with how strongly the world makes/uses it (dedicated vs
  // incidental). Clamped to the same ±4 band so it composes with the trade-code DMs.
  function simpleMag(rate){ rate=+rate||0; if(rate<=0) return 0; return rate>=40?3 : rate>=10?2 : 1; }
  function simplePressure(worldId, goodName){
    let p = 0;
    try {
      if(window.ECON && ECON.effectiveProfile){
        const prof = ECON.effectiveProfile(worldId);
        if(prof){
          const prod = (prof.prod && prof.prod[goodName]) || 0;
          let demand = (prof.cons && prof.cons[goodName]) || 0;
          try { const ai = ECON.autoInputsOf(prof.prod||{}); demand += (ai[goodName]||0); } catch(e){}   // recipe inputs the world auto-draws are genuine demand
          if(prod > 0) p = simpleMag(prod);            // produces it → glut → positive
          else if(demand > 0) p = -simpleMag(demand);  // imports it → scarcity → negative
        }
      }
    } catch(e){}
    if(p === 0) p = clamp(seedScore('simple|'+(worldId||'')+'|'+goodName), -1, 1);   // tiny deterministic texture, no time component
    return clamp(p, -4, 4);
  }
  function mktPressure(sys,goodName){ const key=(sys.id||sys.label||'')+'|'+goodName;
    // FULL-simulation mode (referee opt-in): live stockpiles drive the price
    // (scarcity = dearer). A light ±1 seeded texture lets steady prices breathe
    // week-to-week without overriding the sim signal.
    try { if(window.ECON && ECON.active()){ const sp=ECON.pressure(sys.id,goodName);
      if(sp!=null){ const tex=seedScore('mkt-tex|'+key+'|'+imperialWeek())*0.5; return clamp(Math.round(sp+tex),-4,4); } } } catch(e){}
    // SIMPLE mode (default), or a good the sim doesn't track: static produces/demands.
    return simplePressure(sys.id||sys.label, goodName); }
  function tradeOpportunities(src,dst){ if(!hasMarket(src)||!hasMarket(dst)) return [];
    const sc=tradeCodes(src), dc=tradeCodes(dst), out=[];
    TRADE_GOODS.forEach(g=>{ if(g.avail!=='all' && !g.avail.some(c=>sc.includes(c))) return;
      const buyRoll =AVG_ROLL+bestDM(g.buy,sc)-bestDM(g.sell,sc)+broker-COUNTERPARTY_BROKER+mktPressure(src,g.name),
            sellRoll=AVG_ROLL+bestDM(g.sell,dc)-bestDM(g.buy,dc)+broker-COUNTERPARTY_BROKER-mktPressure(dst,g.name);
      let buyP=g.base*priceMult(PURCHASE_PCT,buyRoll), sellP=g.base*priceMult(SALE_PCT,sellRoll);
      // Price-level overlay (referee manual adjustment × sticky inflation) layered OUTSIDE the
      // bounded priceMult table, so a sustained shortage can push the level past the table's cap.
      try { if(window.ECON && ECON.priceOverlay){ buyP*=ECON.priceOverlay(src.id,g.name); sellP*=ECON.priceOverlay(dst.id,g.name); } } catch(e){}
      out.push({good:g.name,buyP,sellP,profit:sellP-buyP}); });
    return out.sort((a,b)=>b.profit-a.profit); }
  // ── Local market snapshot (Station Trade screen, js/91-trade.js) ───────────
  // One world, every catalogue good: the largest applicable Purchase/Sale DM
  // (reference only — play still rolls 3D6), the live market pressure, and the
  // SAME indicative prices the map shows (AVG_ROLL + party Broker vs the RAW
  // default counterparty Broker-2), so the station screen and the hex map can
  // never quote different numbers. `availHere` = the supplier actually stocks
  // it (Common, or a trade code matches); anything can still be SOLD here.
  function localMarket(id){
    readShared();   // pick up live locationId/broker even if the map was never opened
    const s = id ? BY_ID[id] : origin;
    if(!s) return null;
    if(!hasMarket(s)){ const f=effFac(s.fac); return { id:s.id, label:disp(s), noMarket:true, faction:(f&&f.name)||'' }; }
    const codes=tradeCodes(s);
    const rows=TRADE_GOODS.map(g=>{
      const availHere = g.avail==='all' || g.avail.some(c=>codes.includes(c));
      const buyDM=bestDM(g.buy,codes), sellDM=bestDM(g.sell,codes), pr=mktPressure(s,g.name);
      const buyRoll =AVG_ROLL+buyDM-sellDM+broker-COUNTERPARTY_BROKER+pr,
            sellRoll=AVG_ROLL+sellDM-buyDM+broker-COUNTERPARTY_BROKER-pr;
      let buyP=g.base*priceMult(PURCHASE_PCT,buyRoll), sellP=g.base*priceMult(SALE_PCT,sellRoll);
      try { if(window.ECON && ECON.priceOverlay){ const ov=ECON.priceOverlay(s.id,g.name); buyP*=ov; sellP*=ov; } } catch(e){}
      return { good:g.name, base:g.base, availHere, buyDM, sellDM, pressure:pr, buyP, sellP };
    });
    return { id:s.id, label:disp(s), port:portOf(s), codes, broker, rows };
  }

  // ── State (mirrors shared state; refreshed from shipState/imperialDate each render) ──
  let jumpRating=2, tonnage=200, fuelMax=80, fuelAboard=24, cargoHold=30, broker=2;
  let origin=null, selected=null;
  let showLanes=true, showTerr=true, showRange=false, showFuel=true, showTrade=false, showRoutes=true, showBestRun=false, dragMoved=false, tapConsumed=false;
  let view={x:0,y:0,scale:1}, fitScale=1, fitted=false, built=false, resizeBound=false, svg=null, scene=null;
  let secState={}, secBound=false;   // collapsible-section open/closed state for the selected-system panel (persists across re-renders)
  let placeMode=false, placeCb=null; // Design Mode: armed while the referee taps an empty hex to place / move a system
  let paintMode=false, paintColor='#4aa3ff'; // referee territory brush: armed while tapping hexes to paint/erase them
  const RPX=26, LABEL_ZOOM_F=1.3, LOD_DETAIL_Z=1.25;   // below LOD_DETAIL_Z (× fit) = overview LOD: cull backdrop grid + labels
  function readShared(){ const ss=(typeof shipState!=='undefined')?shipState:{};
    jumpRating=clamp(Number(ss.jumpRating)||2,1,6); tonnage=Number(ss.tonnage)||200;
    fuelMax=Number(ss.fuelMax)||80; fuelAboard=Math.max(0,Number(ss.fuel)||0);
    cargoHold=Math.max(0,Number(ss.cargoHold!=null?ss.cargoHold:30)); broker=clamp(Number(ss.broker!=null?ss.broker:2),0,6);
    origin=BY_ID[ss.locationId]||BY_ID['aurelia']||SYS[0];
    if(selected && !BY_ID[selected.id]) selected=null; }   // drop a stale selection; null = galaxy overview (deselected)

  // ── Visited systems — gate market intel so players can't price-scout worlds
  //    they have never been to. The current location and home port always count;
  //    past jump destinations are back-filled from the log; the referee can
  //    reveal a system manually (e.g. arrival handled in narration).
  function visitedSet(){ const ss=(typeof shipState!=='undefined')?shipState:{};
    const set=new Set(Array.isArray(ss.visited)?ss.visited:[]);
    if(ss.locationId) set.add(ss.locationId); set.add('aurelia');
    if(Array.isArray(ss.jumpLog)) ss.jumpLog.forEach(e=>{ const m=SYS.find(x=>disp(x)===e.to); if(m) set.add(m.id); });
    return set; }
  function isVisited(s){ return !!s && visitedSet().has(s.id); }

  // ── Market-intel staleness — a visited world's trade readout on the map fades with the
  //    weeks since the party last called there (word ages at roughly one jump per week).
  //    shipState.visitLog stamps the Imperial ordinal of each call; the current location
  //    always reads fresh (0), an unvisited world has no age (Infinity). Referees see live
  //    truth, so callers apply this dimming for players only. ──
  function visitWeeks(s){ if(!s) return Infinity;
    const ss=(typeof shipState!=='undefined')?shipState:{};
    if(ss.locationId===s.id) return 0;                                   // where you are now = live
    const log=ss.visitLog;
    if(!log||log[s.id]==null||typeof imperialOrdinal!=='function'||typeof imperialDate==='undefined') return Infinity;
    return Math.max(0,(imperialOrdinal(imperialDate)-log[s.id])/7); }
  // Opacity floor 0.35, reached at a ~3-jump (21-day) staleness horizon.
  function staleOp(s){ const w=visitWeeks(s); return w===Infinity?0.35:clamp(1-w/3,0.35,1); }

  // ── Pixel projection (flat-top axial → screen) ──
  function axialPx(q,r){ return { x:RPX*1.5*q, y:RPX*Math.sqrt(3)*(r+q/2) }; }
  function hexPoly(cx,cy){ let p=[]; for(let i=0;i<6;i++){const a=Math.PI/180*60*i; p.push((cx+RPX*Math.cos(a)).toFixed(1)+','+(cy+RPX*Math.sin(a)).toFixed(1));} return p.join(' '); }
  function NS(n,a){const e=document.createElementNS('http://www.w3.org/2000/svg',n);for(const k in a)e.setAttribute(k,a[k]);return e;}
  function labelsVisible(){ return view.scale>=fitScale*LABEL_ZOOM_F; }
  function applyTransform(){ if(scene) scene.setAttribute('transform',`translate(${view.x},${view.y}) scale(${view.scale})`); if(svg){ svg.classList.toggle('hx-lblzoom',labelsVisible()); scaleTraderLabels(); }
    // Table-display camera mirror (js/93): the referee window sets this hook to
    // broadcast pan/zoom; it is rAF-throttled on the other side. Nothing else
    // in the app assigns it, so this is a no-op outside Follow mode.
    if(typeof window.onHXCameraChanged==='function') window.onHXCameraChanged(view); }
  // External camera control for the table display window (js/93). setCamera
  // locks out fitView's auto-fit so a mirrored camera is never stomped by the
  // deferred fit scheduled in enter() or by a window resize; the grid retile
  // (full render) is debounced because camera frames arrive at up to 60/s.
  let extCamLock=false, extCamRenderT=null;
  function getCamera(){ return { x:view.x, y:view.y, scale:view.scale }; }
  function setCamera(c){ if(!c) return;
    view.x=Number(c.x)||0; view.y=Number(c.y)||0; view.scale=Number(c.scale)||1;
    extCamLock=true; fitted=true; applyTransform();
    clearTimeout(extCamRenderT); extCamRenderT=setTimeout(()=>{ if(svg) render(); },120); }
  // Trader convoy labels live inside the zooming scene, so left alone they'd balloon with the
  // map at high zoom. Counter-scale them off TRADER_LABEL (00-core-data.js): pick a target
  // on-screen px, then divide back out by the live map scale so ONE CSS-var write restyles every
  // label (they carry font-size:var(--hx-trader-font)). z = zoom factor (1 at fit/default). ──
  function scaleTraderLabels(){ if(!svg) return;
    const TL=TRADER_LABEL, z=view.scale/(fitScale||1);                            // zoom factor: 1 = default (fit)
    // Target on-screen px = SCALE×BASE at z=1, riding z^(1−EXPONENT): EXPONENT 1 holds it
    // constant on screen, 0 lets it grow with the map, >1 shrinks it as you zoom in. Clamped.
    const onScreen=clamp(TL.SCALE*TL.BASE*Math.pow(Math.max(z,1e-3),1-TL.ZOOM_EXPONENT), TL.MIN_PX, TL.MAX_PX);
    svg.style.setProperty('--hx-trader-font', (onScreen/(view.scale||1)).toFixed(3)+'px'); }

  // ── Infinite grid: which hexes to tile this frame ──
  // Invert axialPx for the four screen corners to get the q,r box currently in
  // view, so the hex grid and click-to-place targets fill wherever the referee
  // has panned. The galaxy has no fixed bounds — pan into the void and keep going.
  function visibleHexRange(pad){ if(!svg) return null;
    const rect=svg.getBoundingClientRect(); if(!rect.width||!rect.height) return null;
    pad=pad||0; const SQ3=Math.sqrt(3);
    const toQR=(px,py)=>{ const sx=(px-view.x)/view.scale, sy=(py-view.y)/view.scale; const q=sx/(RPX*1.5); return { q, r: sy/(RPX*SQ3)-q/2 }; };
    const cs=[toQR(0,0),toQR(rect.width,0),toQR(0,rect.height),toQR(rect.width,rect.height)];
    let mnq=1e9,mxq=-1e9,mnr=1e9,mxr=-1e9;
    cs.forEach(c=>{ mnq=Math.min(mnq,c.q); mxq=Math.max(mxq,c.q); mnr=Math.min(mnr,c.r); mxr=Math.max(mxr,c.r); });
    return { minQ:Math.floor(mnq)-pad, maxQ:Math.ceil(mxq)+pad, minR:Math.floor(mnr)-pad, maxR:Math.ceil(mxr)+pad }; }
  // The viewport box when it's a sane size (so the grid is unbounded and follows
  // panning), else a tight box around the systems (pre-fit, or zoomed way out).
  function gridRange(pad, sysBounds){ const vr=visibleHexRange(pad);
    if(vr){ const cells=(vr.maxQ-vr.minQ+1)*(vr.maxR-vr.minR+1); if(cells>0 && cells<=6000) return vr; }
    return { minQ:sysBounds.minQ-2, maxQ:sysBounds.maxQ+2, minR:sysBounds.minR-2, maxR:sysBounds.maxR+2 }; }
  // Pan/zoom is transform-only (no DOM rebuild) for smoothness; re-render once the
  // gesture settles so the grid + place targets re-tile the newly-exposed area.
  let _vpRAF=null;
  function scheduleViewportRender(){ if(_vpRAF) return; _vpRAF=requestAnimationFrame(()=>{ _vpRAF=null; if(svg&&origin) render(); }); }
  // Wheel zoom fires many events per second; applyTransform keeps the gesture
  // buttery, but a full scene rebuild every frame is what makes zooming feel
  // laggy. So debounce the re-tile: only rebuild once the wheel settles, matching
  // how pinch already waits for touchend before re-rendering.
  let _settleTimer=null;
  function scheduleSettleRender(){ if(_settleTimer) clearTimeout(_settleTimer); _settleTimer=setTimeout(()=>{ _settleTimer=null; if(svg&&origin) render(); },140); }

  // ── Render ──
  function render(){ if(!svg||!origin) return;
    svg.innerHTML='';
    const g=NS('g',{id:'hx-scene',transform:`translate(${view.x},${view.y}) scale(${view.scale})`});
    svg.appendChild(g); scene=g; svg.classList.toggle('hx-lblzoom',labelsVisible());
    const FAC=(typeof GALAXY_FACTIONS!=='undefined')?GALAXY_FACTIONS:{};
    const range=showRange?fuelReach():null;
    // ── Level-of-detail + viewport culling (keeps the ~180-system map smooth) ──
    // z = zoom relative to fit (1 = whole galaxy on screen). At overview zoom we skip the empty
    // backdrop grid and per-star labels; at any zoom we draw only stars/lanes inside the viewport.
    const z = view.scale/(fitScale||view.scale||1);
    const lodOverview = z < LOD_DETAIL_Z;                 // zoomed out enough that the whole arm shows
    const showLbl = labelsVisible();
    const _vw = visibleHexRange(3);                       // visible q,r window (null pre-fit → draw all)
    const inView = s => !_vw || (s.q>=_vw.minQ && s.q<=_vw.maxQ && s.r>=_vw.minR && s.r<=_vw.maxR);
    if(showTerr){ const tg=NS('g',{'pointer-events':'none'}); g.appendChild(tg);
      const painted=(typeof hexPaint!=='undefined'&&hexPaint)?hexPaint:{};
      const byFac={};
      SYS.forEach(s=>{ if(s.fac==='independent'||s.fac==='uncharted'||!FAC[s.fac]||facHidden(s.fac)) return; (byFac[s.fac]=byFac[s.fac]||[]).push(s); });
      // Region territory, drawn as translucent coloured HEXES (was one big
      // "sphere" per region): fill each member system's hex plus its empty
      // neighbours, so the cluster reads as a hex-tiled sector. A referee-painted
      // cell wins over the auto tint, and another region's star hex is never
      // recoloured.
      Object.keys(byFac).forEach(f=>{ const fac=FAC[f]; const cells=new Set();
        byFac[f].forEach(s=>{ cells.add(s.q+','+s.r);
          DIRS.forEach(d=>{ const nk=(s.q+d[0])+','+(s.r+d[1]); if(!BY_KEY[nk]) cells.add(nk); }); });
        cells.forEach(k=>{ if(painted[k]) return;                        // manual paint overrides the auto tint
          const occ=BY_KEY[k]; if(occ && occ.fac!==f) return;           // don't tint a different region's star hex
          const c=k.split(','), q=+c[0], r=+c[1], p=axialPx(q,r);
          tg.appendChild(NS('polygon',{points:hexPoly(p.x,p.y),fill:fac.color,'fill-opacity':0.11,stroke:fac.color,'stroke-opacity':0.22,'stroke-width':0.75})); });
        const pts=byFac[f].map(s=>axialPx(s.q,s.r));
        const cx=pts.reduce((a,p)=>a+p.x,0)/pts.length, cy=pts.reduce((a,p)=>a+p.y,0)/pts.length;
        let rad=0; pts.forEach(p=>rad=Math.max(rad,Math.hypot(p.x-cx,p.y-cy))); rad+=RPX*1.5;
        const lab=NS('text',{x:cx,y:cy-rad+12,'text-anchor':'middle',fill:fac.color,'fill-opacity':0.55,'font-family':'monospace','font-size':9.5,'font-weight':700,'letter-spacing':1.2});
        lab.textContent=fac.name.toUpperCase(); tg.appendChild(lab); });
      // Referee-painted hexes: a manual translucent colour wash over any cell,
      // rendered on top of the region tint. Shared to every viewer.
      Object.keys(painted).forEach(k=>{ const c=k.split(','), q=+c[0], r=+c[1];
        if(!isFinite(q)||!isFinite(r)) return; const col=painted[k]; if(!col) return;
        const p=axialPx(q,r);
        tg.appendChild(NS('polygon',{points:hexPoly(p.x,p.y),fill:col,'fill-opacity':0.28,stroke:col,'stroke-opacity':0.55,'stroke-width':1})); }); }
    let minQ=99,maxQ=-99,minR=99,maxR=-99;
    SYS.forEach(s=>{minQ=Math.min(minQ,s.q);maxQ=Math.max(maxQ,s.q);minR=Math.min(minR,s.r);maxR=Math.max(maxR,s.r);});
    const gr=gridRange(1,{minQ,maxQ,minR,maxR});   // tile the visible viewport (infinite/pannable), not a fixed box
    const hexLayer=NS('g',{}); g.appendChild(hexLayer);
    for(let q=gr.minQ;q<=gr.maxQ;q++) for(let r=gr.minR;r<=gr.maxR;r++){
      const cell={q,r}, dist=hexDist(cell,origin); let cls='hx-hex', hl=false;
      if(range){ if(range.reach.has(q+','+r)){ cls+=' fuelreach'; hl=true; } }
      else if(dist>=1&&dist<=jumpRating){ cls+= dist===1?' reach reach1':' reach'; hl=true; }
      if(lodOverview && !hl) continue;   // overview: drop the empty backdrop grid; keep only the reach/fuel highlights
      const p=axialPx(q,r);
      hexLayer.appendChild(NS('polygon',{points:hexPoly(p.x,p.y),class:cls})); }
    const op=axialPx(origin.q,origin.r);
    [5,10,15].forEach(h=>{ g.appendChild(NS('circle',{cx:op.x,cy:op.y,r:h*Math.sqrt(3)*RPX,class:'hx-ring'}));
      const t=NS('text',{x:op.x,y:op.y-h*Math.sqrt(3)*RPX+11,class:'hx-ring-lbl','text-anchor':'middle'}); t.textContent=h+' hex'; g.appendChild(t); });
    // Trade mode + exactly one good picked in the legend → price heatmap: wash each market
    // world green where it's a good place to BUY that good (local glut) and red where it's a
    // good place to SELL (local shortage / demand). Drawn here, under the lanes and stars, so
    // it reads as a background layer. See drawPriceHeat().
    if(showTrade && tradeGoods.size===1){ try{ drawPriceHeat(g); }catch(e){} }
    if(showLanes){ const editing=(typeof designModeOn!=='undefined'&&designModeOn&&ref());
      const laneLayer=NS('g',{}); g.appendChild(laneLayer);
      laneEdges().forEach(L=>{ if(!inView(L.a)&&!inView(L.b)) return;   // cull lanes fully off-screen
        const pa=axialPx(L.a.q,L.a.r), pb=axialPx(L.b.q,L.b.r);
        const flyable=L.len<=jumpRating||onLane(L.a,L.b), touches=(L.a===origin||L.b===origin);
        const line=NS('line',{x1:pa.x,y1:pa.y,x2:pb.x,y2:pb.y,class:'hx-lane'});
        if(flyable){ line.setAttribute('stroke-dasharray','none'); line.setAttribute('opacity',touches?'0.95':'0.5'); }
        else { line.setAttribute('opacity',touches?'0.55':'0.18'); }
        if(touches) line.setAttribute('stroke-width','1.6');
        // Route block: the referee + nav crew (Rhett/Cass) see a closed lane as
        // dashed red with a lock; other players see an ordinary lane.
        const blk=(typeof isLaneBlocked==='function')&&isLaneBlocked(L.key);
        const showBlk=blk&&(ref()||(typeof canSee==='function'&&typeof SHIP_NAV_AUDIENCE!=='undefined'&&canSee(SHIP_NAV_AUDIENCE)));
        if(showBlk){ line.setAttribute('stroke','#d45050'); line.setAttribute('stroke-dasharray','5,4'); line.setAttribute('opacity','0.92'); line.setAttribute('stroke-width',touches?'2':'1.5'); }
        laneLayer.appendChild(line);
        if(showBlk){ const mx=(pa.x+pb.x)/2, my=(pa.y+pb.y)/2;
          const lock=NS('text',{x:mx,y:my+3,'text-anchor':'middle',style:'font-size:11px;fill:#ff9b9b;pointer-events:none'}); lock.textContent='🔒';
          const bd=routeBlocks.blocks&&routeBlocks.blocks[L.key]; const tt=NS('title',{});
          tt.textContent=(bd&&bd.explain!==false&&bd.reason)?bd.reason:'Route closed'; lock.appendChild(tt); laneLayer.appendChild(lock); }
        const canHit=editing||(ref()&&typeof gxBlockMode!=='undefined'&&gxBlockMode);
        if(canHit){ const hit=NS('line',{x1:pa.x,y1:pa.y,x2:pb.x,y2:pb.y,stroke:'transparent','stroke-width':6,style:'cursor:pointer'});
          hit.addEventListener('pointerup',ev=>{ if(ev.button>0||dragMoved) return; tapConsumed=true;
            if(typeof gxBlockMode!=='undefined'&&gxBlockMode){ if(typeof gxToggleBlock==='function') gxToggleBlock(L.key); }
            else if(editing){ if(typeof gxRemoveLane==='function') gxRemoveLane(L.key); } }); laneLayer.appendChild(hit); } }); }
    // Supply→demand connector arcs for the picked good(s): producer → importer, drawn under
    // the live convoys. Structural (needs no sim), so it's the Simple-mode counterpart to the
    // goods-flow lines. See drawSupplyRoutes().
    if(showTrade && showRoutes && tradeGoods.size){ try{ drawSupplyRoutes(g); }catch(e){} }
    if(showTrade){ try{ drawTrade(g); }catch(e){} }   // living-economy overlay: goods flows + trader convoys
    // Corp territory — when a house is selected in the econ console, ring its HQ + expanded worlds in
    // its house colour (HQ = solid ring + label; expansions = dashed, growing with the invest count).
    if(typeof window!=='undefined' && window.econCorpSel && typeof ECON!=='undefined'){
      try{ const c=ECON.corps()[window.econCorpSel];
        if(c){ const col=c.color||'#ff9a3c', cg=NS('g',{'pointer-events':'none'}); const counts={};
          if(c.home) counts[c.home]=0; (c.invests||[]).forEach(iv=>{ counts[iv.world]=(counts[iv.world]||0)+1; });
          Object.keys(counts).forEach(wid=>{ const s=BY_ID[wid]; if(!s) return; const p=axialPx(s.q,s.r), isHome=wid===c.home, rad=11+Math.min(6,counts[wid]*2);
            cg.appendChild(NS('circle',{cx:p.x,cy:p.y,r:rad,fill:col,'fill-opacity':0.06,stroke:col,'stroke-opacity':0.85,'stroke-width':isHome?1.8:1.1,'stroke-dasharray':isHome?'none':'3,3'}));
            if(isHome){ const t=NS('text',{x:p.x,y:p.y-rad-3,'text-anchor':'middle',fill:col,'font-family':'monospace','font-size':8.5,'font-weight':700,opacity:0.9}); t.textContent='◆ '+(''+c.name).split(' ')[0].toUpperCase(); cg.appendChild(t); } });
          g.appendChild(cg); }
      }catch(e){}
    }
    if(selected&&selected!==origin){ const route=bestRoute(origin,selected);
      if(route&&route.length>1){ const plan=fuelPlan(route);
        for(let i=0;i<route.length-1;i++){ const pa=axialPx(route[i].q,route[i].r),pb=axialPx(route[i+1].q,route[i+1].r);
          g.appendChild(NS('line',{x1:pa.x,y1:pa.y,x2:pb.x,y2:pb.y,class:plan.legs[i].ok?'hx-route':'hx-route-bad'})); }
        for(let i=0;i<route.length-1;i++){ if(plan.legs[i].refuel){ const sp=route[i], pp=axialPx(sp.q,sp.r);
          const t=NS('text',{x:pp.x,y:pp.y-9,'text-anchor':'middle','font-size':'11'}); t.textContent='⛽'; g.appendChild(t); } }
        if(plan.strandedAt!=null){ const sp=route[plan.strandedAt], p=axialPx(sp.q,sp.r);
          g.appendChild(NS('circle',{cx:p.x,cy:p.y,r:8,class:'hx-strand-dot'}));
          const t=NS('text',{x:p.x,y:p.y+22,'text-anchor':'middle',class:'hx-fuel-warn'}); t.textContent='⚠ STRANDED'; g.appendChild(t); } } }
    // Referee-only "best run from here" overlay: the most profit-per-week cargo run reachable
    // from the current location, drawn as a gold route to the destination. Never shown to
    // players — the trade call is theirs to make (see bestRunFromHere).
    if(showBestRun && ref()){ try{ const br=bestRunFromHere();
      if(br){ const rt=br.route, bl=NS('g',{class:'hx-bestrun-layer','pointer-events':'none'}); g.appendChild(bl);
        for(let i=0;i<rt.length-1;i++){ const pa=axialPx(rt[i].q,rt[i].r),pb=axialPx(rt[i+1].q,rt[i+1].r);
          bl.appendChild(NS('line',{x1:pa.x,y1:pa.y,x2:pb.x,y2:pb.y,class:'hx-bestrun'})); }
        const dp=axialPx(br.dst.q,br.dst.r);
        bl.appendChild(NS('circle',{cx:dp.x,cy:dp.y,r:10,fill:'none',stroke:'#ffd24a','stroke-width':1.6,opacity:0.95}));
        const lbl=NS('text',{x:dp.x,y:dp.y-13,'text-anchor':'middle',class:'hx-bestrun-lbl'});
        lbl.textContent=`★ ${gShort(br.good)} +${kCr(br.perTon)}/t`; bl.appendChild(lbl); }
    }catch(e){} }
    SYS.forEach(s=>{ if(!inView(s) && s!==origin && s!==selected) return;   // cull off-screen stars (keep origin + selection)
      const p=axialPx(s.q,s.r), col=effFac(s.fac).color;
      const isOrigin=s===origin, isSel=s===selected, inRange=!range||isOrigin||range.reach.has(s.q+','+s.r);
      if(showFuel){ const fa=fuelAt(s), ring=NS('circle',{cx:p.x,cy:p.y,r:6.5,fill:'none',stroke:FUEL_INFO[fa].c,'stroke-width':1.2,opacity:inRange?0.65:0.25});
        if(fa==='none') ring.setAttribute('stroke-dasharray','2,2'); g.appendChild(ring); }
      // Travel-zone ring (MgT2e convention): amber = caution, red = interdicted.
      // Drawn for everyone — zones are public traveller data, not a referee secret.
      if(s.zone==='amber'||s.zone==='red'){ g.appendChild(NS('circle',{cx:p.x,cy:p.y,r:7.5,fill:'none',
        stroke:s.zone==='red'?'#ff5a4d':'#e8c65a','stroke-width':1.4,opacity:inRange?0.9:0.3})); }
      if(isOrigin) g.appendChild(NS('circle',{cx:p.x,cy:p.y,r:9,fill:'none',stroke:'#f4d35e','stroke-width':1.5,opacity:.8}));
      if(range&&s===range.farthest){ g.appendChild(NS('circle',{cx:p.x,cy:p.y,r:9,fill:'none',stroke:'#D4A843','stroke-width':1.5,opacity:.95}));
        const ml=NS('text',{x:p.x,y:p.y+20,'text-anchor':'middle',class:'hx-range-lbl'}); ml.textContent='◆ MAX RANGE'; g.appendChild(ml); }
      let marker;
      if(s.deep){ const z=isOrigin?5:4; marker=NS('polygon',{points:`${p.x},${p.y-z} ${p.x+z},${p.y} ${p.x},${p.y+z} ${p.x-z},${p.y}`,
        fill:isOrigin?'#f4d35e':'#04060e',stroke:isOrigin?'#f4d35e':col,'stroke-width':1.3,class:'hx-star-dot'}); }
      else marker=NS('circle',{cx:p.x,cy:p.y,r:isOrigin?5:4,fill:isOrigin?'#f4d35e':col,class:'hx-star-dot'});
      if(isSel&&!isOrigin){ marker.setAttribute('stroke','#fff'); marker.setAttribute('stroke-width','1.5'); }
      if(!inRange) marker.setAttribute('opacity','0.3'); marker.style.cursor='pointer';
      g.appendChild(marker);
      if(showLbl || isOrigin || isSel){                                  // overview LOD: only pinned/selected labels (was CSS-hidden anyway)
        const lbl=NS('text',{x:p.x+8,y:p.y+3,class:'hx-star-lbl'+((isOrigin||isSel)?' pin':'')});
        if(!inRange) lbl.setAttribute('opacity','0.3'); lbl.textContent=disp(s); g.appendChild(lbl); }
      // Finger-friendly tap target: the visible star is only ~8px across — far below a
      // usable touch target — so overlay a larger transparent hit circle that carries the
      // tap (and the hover-label). Sits on top so a tap near a star still selects it.
      const hit=NS('circle',{cx:p.x,cy:p.y,r:14,fill:'transparent','pointer-events':'all',style:'cursor:pointer'});
      // Drive selection off pointerup, not click: iOS Safari does not reliably emit a
      // synthetic click on SVG shapes once we've taken over touch (touch-action:none +
      // custom pointer handlers), which left stars untappable on iPad. tapConsumed tells
      // the map-level pointerup this tap was handled, so it won't also deselect.
      hit.addEventListener('pointerup',ev=>{ if(ev.button>0||dragMoved) return; tapConsumed=true;
        if(typeof designModeOn!=='undefined'&&designModeOn&&ref()&&typeof gxLinkMode!=='undefined'&&gxLinkMode){ if(typeof gxLinkPick==='function') gxLinkPick(s.id); return; }
        selectSys(s); });
      if(!(isOrigin||isSel)){ hit.addEventListener('pointerenter',()=>{ lbl.style.display='block'; }); hit.addEventListener('pointerleave',()=>{ lbl.style.display=''; }); }
      g.appendChild(hit);
    });
    // Trade mode: emoji badges above each market world — what it produces (▲) and needs
    // (▼), with amounts. Drawn AFTER the stars so it layers on top; works in Simple mode
    // too (no live sim needed), unlike the goods-flow/convoy overlay above.
    if(showTrade){ try{ drawEconBadges(g); }catch(e){} }
    // Design Mode click-to-place: highlight every empty hex in view as a tap
    // target. Tiles the whole viewport, so panning lets the referee drop a system
    // anywhere on the unbounded grid. Topmost layer so it wins the click.
    if(placeMode){ const pl=NS('g',{}); g.appendChild(pl);
      for(let q=gr.minQ;q<=gr.maxQ;q++) for(let r=gr.minR;r<=gr.maxR;r++){
        if(occupied.has(q+','+r)) continue; const p=axialPx(q,r);
        const cell=NS('polygon',{points:hexPoly(p.x,p.y),fill:'#9B59B6','fill-opacity':0.10,stroke:'#9B59B6','stroke-opacity':0.55,'stroke-width':1,'stroke-dasharray':'3,3',style:'cursor:pointer'});
        cell.addEventListener('pointerup',ev=>{ if(ev.button>0||dragMoved) return; tapConsumed=true; placePick(q,r); });   // ignore the tap that ends a pan
        pl.appendChild(cell); } }
    // Referee territory brush: tile every visible hex as a tap target so the ref
    // can paint/erase borders. Already-painted cells preview their colour; empty
    // ones show a faint outline in the current brush colour. Topmost so it wins.
    if(paintMode){ const pg=NS('g',{}); g.appendChild(pg);
      const painted=(typeof hexPaint!=='undefined'&&hexPaint)?hexPaint:{};
      for(let q=gr.minQ;q<=gr.maxQ;q++) for(let r=gr.minR;r<=gr.maxR;r++){
        const key=q+','+r, p=axialPx(q,r), cur=painted[key]||null;
        const cell=NS('polygon',{points:hexPoly(p.x,p.y),fill:cur||paintColor,'fill-opacity':cur?0.34:0.05,stroke:paintColor,'stroke-opacity':0.6,'stroke-width':1,'stroke-dasharray':'3,2',style:'cursor:crosshair'});
        cell.addEventListener('pointerup',ev=>{ if(ev.button>0||dragMoved) return; tapConsumed=true; paintPick(q,r); });   // ignore the tap that ends a pan
        pg.appendChild(cell); } }
  }

  // ── Living-economy overlay: where goods flow, and where the Independent traders are ──
  const GOOD_COL = {
    'Common Consumables':'#5fb87a','Common Ore':'#b07a4a','Common Electronics':'#4a90d9',
    'Common Manufactured':'#8a9bb5','Advanced Electronics':'#3fd0d0','Precious Metals':'#e0c040',
    'Radioactives':'#9fd44a','Biochemicals':'#3faf8f','Luxury Goods':'#c060c0','Pharmaceuticals':'#e07090'
  };
  const gShort = g => (g||'').replace('Common ','');
  const tradeGoods = new Set();   // which goods' flows are drawn (empty = none); toggled from the legend grid
  // Shortest path over the always-flyable commercial (lore) routes — the graph the
  // economy actually trades along. Used to route a convoy when no surveyed jump-lane
  // route exists, so it follows established lanes instead of cutting across open space.
  function lorePath(fromId, toId){
    const M = (typeof GX_MAP!=='undefined') ? GX_MAP : null; if(!M||!M[fromId]||!M[toId]) return null;
    const links = id => { const n=M[id]; return (n&&(n._loreLinks||n.connections))||[]; };
    const prev={}; prev[fromId]=fromId; const q=[fromId];
    while(q.length){ const u=q.shift(); if(u===toId) break; links(u).forEach(v=>{ if(M[v] && !(v in prev)){ prev[v]=u; q.push(v); } }); }
    if(!(toId in prev)) return null;
    const path=[toId]; let c=toId; while(c!==fromId){ c=prev[c]; path.unshift(c); } return path;
  }
  function drawTrade(layer){
    if(typeof window.ECON==='undefined' || !ECON.active()) return;
    let st; try{ st=ECON.state; }catch(e){ return; }
    // 1) Goods flows — only for goods SELECTED in the legend grid (empty by default, so
    //    nothing heavy renders until asked). One animated line per (lane, good), offset
    //    perpendicular so several goods on one lane don't overlap.
    if(tradeGoods.size){
      const gi={}; Object.keys(GOOD_COL).forEach((g,i)=>gi[g]=i);
      const lanes={};
      (st.transit||[]).forEach(t=>{ if(!tradeGoods.has(t.good)||!BY_ID[t.from]||!BY_ID[t.to]) return;
        const k=t.from+'>'+t.to+'>'+t.good, L=lanes[k]||(lanes[k]={from:t.from,to:t.to,good:t.good,qty:0});
        L.qty+=t.qty; });
      const flowG=NS('g',{}); layer.appendChild(flowG);
      Object.values(lanes).forEach(L=>{ if(L.qty<1) return;
        const a=BY_ID[L.from], b=BY_ID[L.to], pa=axialPx(a.q,a.r), pb=axialPx(b.q,b.r);
        const dx=pb.x-pa.x, dy=pb.y-pa.y, len=Math.hypot(dx,dy)||1, ux=dx/len, uy=dy/len, nx=-uy, ny=ux;
        const off=((gi[L.good]||0)-4.5)*1.5, ox=nx*off, oy=ny*off;
        const x1=pa.x+ux*6+ox, y1=pa.y+uy*6+oy, x2=pb.x-ux*8+ox, y2=pb.y-uy*8+oy;
        const col=GOOD_COL[L.good]||'#9fb0c8', w=Math.max(0.8, Math.min(4.5, Math.sqrt(L.qty)/2.4));
        const ln=NS('line',{x1,y1,x2,y2,stroke:col,'stroke-width':w,'stroke-linecap':'round',opacity:0.6,'stroke-dasharray':'5,5','pointer-events':'stroke'});
        ln.appendChild(NS('animate',{attributeName:'stroke-dashoffset',from:10,to:0,dur:'0.9s',repeatCount:'indefinite'}));
        const tt=NS('title',{}); tt.textContent=`${disp(a)} → ${disp(b)}: ${gShort(L.good)} ${Math.round(L.qty)}kt`; ln.appendChild(tt);
        flowG.appendChild(ln);
        flowG.appendChild(NS('polygon',{points:`${x2},${y2} ${x2-ux*6-uy*3.4},${y2-uy*6+ux*3.4} ${x2-ux*6+uy*3.4},${y2-uy*6-ux*3.4}`,fill:col,opacity:0.75,'pointer-events':'none'}));
      });
    }
    // 2) Trader convoys — route each along the fuel-optimal JUMP-LANE path (not a straight
    //    line), draw that multi-hop polyline, and place the ship marker along it by progress.
    const week=st.week;
    const allAgents=(ECON.agents&&ECON.agents())||[];
    const manyConvoys = allAgents.filter(a=>a.route).length > 30;   // big fleet → drop per-convoy labels (clutter + cost), keep markers/lines
    allAgents.forEach(a=>{ if(!a.route) return;
      const f=BY_ID[a.route.from], t=BY_ID[a.route.to]; if(!f||!t) return;
      const frac=(typeof window!=='undefined'&&window.econViewFrac)||0;   // sub-week render clock (+1 day) so convoys crawl along their lane path
      let pr=0.5; if(a.route.began!=null && a.route.eta>a.route.began) pr=Math.max(0.06,Math.min(0.94,(week+frac-a.route.began)/(a.route.eta-a.route.began)));
      // Marker path = deadhead (from → pickup, empty) + laden (pickup → dest), so the ship
      // flies from where it currently is to its next cargo source instead of teleporting.
      const legPts=(fid,tid)=>{ const ff=BY_ID[fid], tt=BY_ID[tid]; if(!ff||!tt) return null;
        let nodes=null; try{ nodes=bestRoute(ff,tt); }catch(e){}
        let p; if(nodes && nodes.length>1) p=nodes.map(n=>axialPx(n.q,n.r));                // surveyed jump-lane, fuel-optimal
        else { const idp=lorePath(fid,tid); if(idp && idp.length>1) p=idp.map(id=>BY_ID[id]).filter(Boolean).map(n=>axialPx(n.q,n.r)); }   // else the always-flyable commercial routes
        if(!p || p.length<2) p=[axialPx(ff.q,ff.r), axialPx(tt.q,tt.r)]; return p; };       // last resort: direct
      const wp=(a.route.pickup && a.route.pickup!==a.route.from && BY_ID[a.route.pickup]) ? a.route.pickup : null;
      let pts=legPts(a.route.from, wp||a.route.to);
      if(wp){ const seg2=legPts(wp, a.route.to); if(seg2 && seg2.length>1) pts=(pts||[]).concat(seg2.slice(1)); }   // join deadhead + laden (drop the shared pickup point)
      if(!pts || pts.length<2) pts=[axialPx(f.q,f.r), axialPx(t.q,t.r)];
      // walk the polyline to the progress point
      const seg=[]; let total=0; for(let i=0;i<pts.length-1;i++){ const d=Math.hypot(pts[i+1].x-pts[i].x,pts[i+1].y-pts[i].y); seg.push(d); total+=d; }
      let x=pts[0].x, y=pts[0].y;
      if(total>0){ let want=pr*total, acc=0, k=0; while(k<seg.length-1 && acc+seg[k]<want){ acc+=seg[k]; k++; }
        const ff=seg[k]?(want-acc)/seg[k]:0; x=pts[k].x+(pts[k+1].x-pts[k].x)*ff; y=pts[k].y+(pts[k+1].y-pts[k].y)*ff; }
      // Highlight the SELECTED trader's route, OR every convoy of the SELECTED corporation
      // (econCorpSel = a backing id like 'corp:omnisynth'); dim the rest. Picked in the econ console.
      const corpSel=(typeof window!=='undefined' && window.econCorpSel && a.backing===window.econCorpSel);
      const sel=(typeof window!=='undefined' && window.econTraderSel===a.id) || corpSel;
      const anySel=(typeof window!=='undefined' && (!!window.econTraderSel || !!window.econCorpSel)), dim=anySel&&!sel;
      const col=sel?'#ffe27a':'#f4d35e', z=sel?6:4.2, gg=NS('g',{'pointer-events':'none'});
      if(sel) gg.appendChild(NS('polyline',{points:pts.map(p=>`${p.x},${p.y}`).join(' '),fill:'none',stroke:col,'stroke-width':3,opacity:0.22,'stroke-linejoin':'round'}));   // glow
      gg.appendChild(NS('polyline',{points:pts.map(p=>`${p.x},${p.y}`).join(' '),fill:'none',stroke:col,'stroke-width':sel?1.6:0.8,opacity:sel?0.95:(dim?0.12:0.3),'stroke-dasharray':sel?'none':'2,3'}));
      gg.appendChild(NS('polygon',{points:`${x},${y-z} ${x+z},${y} ${x},${y+z} ${x-z},${y}`,fill:col,stroke:'#04060e','stroke-width':1,opacity:dim?0.35:1}));
      if(!dim && (sel || !manyConvoys)){ const lbl=NS('text',{x:x+7,y:y-4,class:'hx-trade-lbl'}); lbl.textContent=`${a.name} · ${gShort(a.route.good)} → ${disp(t)}`;
        if(sel) lbl.setAttribute('font-weight','700'); gg.appendChild(lbl); }
      layer.appendChild(gg);
    });
  }

  // ── Trade-mode econ badges — what each market world PRODUCES (▲) and DEMANDS (▼),
  //    as emoji above the star with kt/week amounts. Reads ECON.effectiveProfile — the
  //    SAME produces/demands the price model and the star panel (econChipsHTML) use — so
  //    it works in Simple AND Full economy mode. Amounts ride a zoom-gated class
  //    (.hx-econ-amt), so the map stays a clean at-a-glance icon view until you zoom in.
  //    The whole layer is pointer-events:none, so a badge never steals a tap from the
  //    star beneath it (the badges sit inside the star's 14px hit circle). ────────────
  const GOOD_ICON = {
    'Common Ore':'🪨','Common Consumables':'🌾','Common Electronics':'🔌',
    'Common Manufactured':'⚙️','Advanced Electronics':'💻','Precious Metals':'💎',
    'Radioactives':'☢️','Biochemicals':'🧪','Luxury Goods':'💍','Pharmaceuticals':'💊',
    'Unrefined Hydrogen':'💨','Refined Fuel':'⛽','Scrap':'♻️'
  };
  function econAmt(v){ v=Math.round(+v||0); return v>=1000 ? (Math.round(v/100)/10)+'k' : ''+v; }
  // Top produced / net-imported goods for a market world. Demand = final consumption +
  // the recipe inputs the world auto-draws (autoInputsOf), NET of what it makes itself —
  // so a world that grows its own food doesn't read as "needs food". Internal/untraded
  // goods (Scrap) are dropped. The legend's goods filter (tradeGoods) narrows the badges
  // to just the selected goods when any are picked; empty = no filter = show every good,
  // so it matches the flow lines you've focused on. Returns null when nothing survives.
  function econBadgeData(id){
    if(typeof window.ECON==='undefined' || !ECON.effectiveProfile || !ECON.isMarketId || !ECON.isMarketId(id)) return null;
    let ep; try{ ep=ECON.effectiveProfile(id); }catch(e){ return null; }
    if(!ep) return null;
    const G=ECON.GOODS||{}, prod=ep.prod||{}, cons=ep.cons||{};
    const picked=tradeGoods.size ? g=>tradeGoods.has(g) : ()=>true;   // legend filter (empty = all)
    const shown=g=> G[g] && !G[g].internal && picked(g);
    let auto={}; try{ auto=ECON.autoInputsOf(prod)||{}; }catch(e){}
    const prodE=Object.keys(prod).filter(g=>prod[g]>0 && shown(g))
      .map(g=>({good:g,rate:prod[g]})).sort((a,b)=>b.rate-a.rate);
    const dem={};
    Object.keys(cons).forEach(g=>{ dem[g]=(dem[g]||0)+cons[g]; });
    Object.keys(auto).forEach(g=>{ dem[g]=(dem[g]||0)+auto[g]; });
    const demE=Object.keys(dem).filter(shown)
      .map(g=>({good:g,rate:dem[g]-(prod[g]||0)}))   // net import: subtract own output
      .filter(e=>e.rate>0.5).sort((a,b)=>b.rate-a.rate);
    if(!prodE.length && !demE.length) return null;
    return { prod:prodE, dem:demE };
  }
  function drawEconBadges(layer){
    if(typeof window.ECON==='undefined' || !ECON.effectiveProfile) return;
    const bg=NS('g',{'pointer-events':'none'}); layer.appendChild(bg);
    const STEP=11, MAX=3, isRef=ref(), vset=isRef?null:visitedSet();
    const mkText=(par,x,y,cls,txt,col,op)=>{ const a={x,y,'text-anchor':'middle',class:cls}; if(col)a.fill=col; if(op!=null)a.opacity=op;
      const t=NS('text',a); t.textContent=txt; par.appendChild(t); return t; };
    SYS.forEach(s=>{ const data=econBadgeData(s.id); if(!data) return;
      const p=axialPx(s.q,s.r);
      // Fog: a market the party has never called at shows only a sealed "?" — no produce/
      // demand intel — until they visit (referees always see the live badges).
      if(!isRef && !vset.has(s.id)){ mkText(bg, p.x, p.y-13, 'hx-econ-unknown', '?', null, null); return; }
      const wg=NS('g', isRef?{}:{opacity:staleOp(s).toFixed(2)}); bg.appendChild(wg);   // players' intel fades with weeks since the visit
      const rows=[];
      if(data.prod.length) rows.push({entries:data.prod.slice(0,MAX), extra:data.prod.length-MAX, kind:'prod'});
      if(data.dem.length)  rows.push({entries:data.dem.slice(0,MAX),  extra:data.dem.length-MAX,  kind:'dem'});
      rows.forEach((row,ri)=>{ const y=p.y-12-ri*12, isProd=row.kind==='prod', col=isProd?'#66c07a':'#e3a24a';
        // Produce icons show at every zoom (the at-a-glance "what this world makes" map);
        // the demand row rides the same .hx-lblzoom gate as amounts, so the fit view stays
        // clean and the full produce+demand+amount detail unfolds as you zoom in.
        const dim=isProd?'':' hx-econ-dem';
        const n=row.entries.length, startX=p.x-(n-1)*STEP/2;
        mkText(wg, startX-8, y, 'hx-econ-dir'+dim, isProd?'▲':'▼', col);                // direction cue
        row.entries.forEach((e,i)=>{ const x=startX+i*STEP;
          mkText(wg, x, y, 'hx-econ-ic'+dim, GOOD_ICON[e.good]||'▪');                    // the good's emoji
          mkText(wg, x+4.7, y+4.7, 'hx-econ-amt', econAmt(e.rate), col); });             // kt/week (zoom-gated)
        if(row.extra>0) mkText(wg, startX+n*STEP-2, y, 'hx-econ-dir'+dim, '+'+row.extra, col, 0.85); });   // overflow beyond top-3
    });
  }

  // ── Price heatmap — for the single good picked in the legend, wash each market world by
  //    how good a place it is to trade it. Green = local glut (produced here / cheap → BUY);
  //    red = local shortage (demanded here / dear → SELL). Colour + sign come from mktPressure
  //    (the same signal that drives the price everywhere, live in Full sim), but a world is
  //    only tinted when it has a REAL stake in the good (produces or net-imports it, via the
  //    same econBadgeData the badges use) — so seeded price-texture never washes the map. A
  //    world at price-equilibrium but with a stake still gets a mid tint from its profile. ──
  const HEAT_BUY='#3fae5a', HEAT_SELL='#d8503f';
  function drawPriceHeat(layer){
    if(typeof window.ECON==='undefined') return;
    const good=[...tradeGoods][0]; if(!good) return;
    const hg=NS('g',{'pointer-events':'none'}); layer.appendChild(hg);
    const isRef=ref(), vset=isRef?null:visitedSet();
    SYS.forEach(s=>{ const data=econBadgeData(s.id); if(!data) return;   // no stake in this good → no tint
      if(!isRef && !vset.has(s.id)) return;                              // fog: no price intel for worlds the party has never called at
      let pr=0; try{ pr=mktPressure(s,good); }catch(e){}
      let t=clamp(pr/4,-1,1);
      if(Math.abs(t)<0.25) t = data.prod.length ? 0.45 : -0.45;         // ~equilibrium: fall back to the profile stake
      const col=t>0?HEAT_BUY:HEAT_SELL, p=axialPx(s.q,s.r);
      const op=(0.15+Math.abs(t)*0.32)*(isRef?1:staleOp(s));            // players' intel fades with weeks since the visit
      hg.appendChild(NS('polygon',{points:hexPoly(p.x,p.y),fill:col,'fill-opacity':op.toFixed(2),
        stroke:col,'stroke-opacity':Math.min(0.9,op+0.28).toFixed(2),'stroke-width':1})); });
  }

  // ── Supply→demand connector arcs — for each good picked in the legend, arc from every net
  //    importer to its NEAREST net producer (producer → importer, arrowhead at the importer).
  //    This is the STATIC "who should trade with whom" for a good; unlike the animated convoys
  //    it needs no running sim, so it's the Simple-mode counterpart to the flow lines. Reads the
  //    same net produce/demand the badges use; capped per good so the map stays legible. ──
  function goodNet(id, good){   // >0 net exporter (produces more than it uses), <0 net importer
    if(typeof window.ECON==='undefined' || !ECON.isMarketId || !ECON.isMarketId(id)) return 0;
    let ep; try{ ep=ECON.effectiveProfile(id); }catch(e){ return 0; }
    if(!ep) return 0;
    const prod=(ep.prod&&ep.prod[good])||0, cons=(ep.cons&&ep.cons[good])||0;
    let auto=0; try{ auto=(ECON.autoInputsOf(ep.prod||{})[good])||0; }catch(e){}
    return prod-(cons+auto);
  }
  function drawSupplyRoutes(layer){
    if(typeof window.ECON==='undefined') return;
    const rg=NS('g',{'pointer-events':'none'}); layer.appendChild(rg);
    const IMP_CAP=8;   // arcs per good = neediest importers only, so a busy good stays readable
    [...tradeGoods].forEach(good=>{
      const producers=[], importers=[];
      SYS.forEach(s=>{ const n=goodNet(s.id,good); if(n>0.5) producers.push(s); else if(n<-0.5) importers.push({s,need:-n}); });
      if(!producers.length || !importers.length) return;
      importers.sort((a,b)=>b.need-a.need);
      const col=GOOD_COL[good]||'#9fb0c8';
      importers.slice(0,IMP_CAP).forEach(imp=>{
        let best=null, bd=Infinity;
        producers.forEach(pr=>{ const d=hexDist(imp.s,pr); if(d<bd){ bd=d; best=pr; } });   // nearest supply
        if(!best) return;
        const a=axialPx(best.q,best.r), b=axialPx(imp.s.q,imp.s.r);
        const dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy)||1, ux=dx/len, uy=dy/len, nx=-uy, ny=ux;
        const ax=a.x+ux*7, ay=a.y+uy*7, bx=b.x-ux*8, by=b.y-uy*8;                             // clear the star markers
        const bow=Math.min(38, len*0.16), cx=(ax+bx)/2+nx*bow, cy=(ay+by)/2+ny*bow;           // gentle bow
        const w=Math.max(0.7, Math.min(2.6, Math.sqrt(imp.need)/2));                          // heavier arc = hungrier importer
        rg.appendChild(NS('path',{d:`M${ax.toFixed(1)},${ay.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`,
          fill:'none',stroke:col,'stroke-width':w,'stroke-opacity':0.5,'stroke-linecap':'round'}));
        const tx=bx-cx, ty=by-cy, tl=Math.hypot(tx,ty)||1, hx=tx/tl, hy=ty/tl, px=-hy, py=hx, sz=4;   // arrowhead along the tangent
        rg.appendChild(NS('polygon',{points:`${bx.toFixed(1)},${by.toFixed(1)} ${(bx-hx*sz+px*sz*0.6).toFixed(1)},${(by-hy*sz+py*sz*0.6).toFixed(1)} ${(bx-hx*sz-px*sz*0.6).toFixed(1)},${(by-hy*sz-py*sz*0.6).toFixed(1)}`,fill:col,'fill-opacity':0.7}));
      });
    });
  }

  // ── Fuel / routing ──
  // (B) A jump lane counts as a SINGLE max-rating jump regardless of map distance,
  //     so lore connections are always flyable. Its fuel/reach distance is capped
  //     to the jump rating; off-lane hops keep their true hex distance.
  function jumpDist(a,b){ const h=hexDist(a,b); return onLane(a,b)?Math.min(h,jumpRating):h; }
  function legFuel(a,b){ return jumpFuel(tonnage, jumpDist(a,b), onLane(a,b)) + operatingFuel(tonnage, FUEL_RULES.operatingFuel.weeksPerJump||1); }   // 10%×hull×pc (×lane) + power-plant (0 unless enabled)
  function fuelPlan(route){ let tank=Math.min(fuelAboard,fuelMax), strandedAt=null, reason='', refuels=0, total=0; const legs=[];
    for(let i=0;i<route.length-1;i++){ const here=route[i], f=legFuel(here,route[i+1]); total+=f;
      const canRefuel=strandedAt===null && i>0 && fuelAt(here)!=='none'; if(canRefuel){ tank=fuelMax; refuels++; }
      const ok=strandedAt===null && tank>=f-1e-6; if(ok) tank-=f; else if(strandedAt===null){ strandedAt=i; reason=(fuelMax<f-1e-6)?'tanksize':'dry'; }
      legs.push({fuel:f,ok,refuel:canRefuel}); }
    return { legs, strandedAt, reason, refuels, total, endTank:tank }; }
  function dijkstra(from){ const cost={}, prev={}, done={};
    SYS.forEach(s=>cost[s.q+','+s.r]=Infinity); cost[from.q+','+from.r]=0;
    while(true){ let u=null,ud=Infinity; SYS.forEach(s=>{const k=s.q+','+s.r; if(!done[k]&&cost[k]<ud){ud=cost[k];u=s;}});
      if(!u) break; done[u.q+','+u.r]=true;
      SYS.forEach(v=>{ if(v===u||done[v.q+','+v.r]) return; const h=hexDist(u,v); if(h<1||jumpDist(u,v)>jumpRating) return;
        const nd=cost[u.q+','+u.r]+legFuel(u,v); if(nd<cost[v.q+','+v.r]){ cost[v.q+','+v.r]=nd; prev[v.q+','+v.r]=u; } }); }
    return {cost,prev}; }
  function routeFrom(prev,from,to){ const path=[to]; let cur=to; while(cur!==from){ cur=prev[cur.q+','+cur.r]; if(!cur) return null; path.unshift(cur); } return path; }
  function bestRoute(from,to){ if(from===to) return [from]; const {cost,prev}=dijkstra(from);
    if(cost[to.q+','+to.r]===Infinity) return null; return routeFrom(prev,from,to); }
  function fuelReach(){ const {cost,prev}=dijkstra(origin); const reach=new Set(); let farthest=null,fd=-1,fjumps=0,fcost=0;
    SYS.forEach(s=>{ if(s===origin||cost[s.q+','+s.r]===Infinity) return; const path=routeFrom(prev,origin,s); if(!path) return;
      if(fuelPlan(path).strandedAt===null){ reach.add(s.q+','+s.r); const d=hexDist(s,origin); if(d>fd){ fd=d; farthest=s; fjumps=path.length-1; fcost=cost[s.q+','+s.r]; } } });
    return { reach, count:reach.size, farthest, farthestCost:fcost, farthestJumps:fjumps }; }

  // ── Best cargo run from the current location (REFEREE-ONLY analysis). Over every feasible,
  //    fuel-reachable market, take that leg's most profitable good (tradeOpportunities, the
  //    same pricing the cargo panel uses) and rank by profit-per-week — favouring a quick
  //    turnaround over a marginally richer long haul. Deliberately a referee aid: it names the
  //    optimal move, which is the players' call to make, so it never renders in player view. ──
  function bestRunFromHere(){
    if(!hasMarket(origin)) return null;
    const {cost,prev}=dijkstra(origin); let best=null;
    SYS.forEach(s=>{ if(s===origin || !hasMarket(s) || cost[s.q+','+s.r]===Infinity) return;
      const route=routeFrom(prev,origin,s); if(!route || route.length<2) return;
      const plan=fuelPlan(route); if(plan.strandedAt!=null) return;                    // must actually be flyable
      const ops=tradeOpportunities(origin,s).filter(o=>o.profit>0); if(!ops.length) return;
      const top=ops[0], weeks=Math.max(1,route.length-1), total=top.profit*cargoHold, perWeek=total/weeks;
      if(!best || perWeek>best.perWeek) best={ dst:s, good:top.good, perTon:top.profit, total, weeks, route, plan, perWeek, fuel:plan.total }; });
    return best;
  }

  // ── Campaign-action helpers (referee-gated) ──
  let toastTimer=null;
  function toast(msg){ const t=document.getElementById('hx-toast'); if(!t) return; t.innerHTML=msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),4500); }
  function executeJump(){
    if(!ref()){ toast('Referee executes jumps — you can plan freely.'); return; }
    if(!selected||selected===origin) return;
    const route=bestRoute(origin,selected); if(!route){ toast('No route.'); return; }
    const plan=fuelPlan(route);
    if(plan.strandedAt!=null){ toast('⚠ Route strands at '+eh(disp(route[plan.strandedAt]))+' — cannot jump.'); return; }
    // Tabletop pacing: stop at the first refuelling layover so the table can roleplay
    // the stop, then refuel + Execute again to carry on. Single-tank routes go straight
    // through. (The first refuel stop has no earlier refuel, so the sub-route's endTank
    // is the true fuel on arrival — no auto-refuel sneaks in before the pause.)
    let stopIdx=route.length-1;
    for(let i=1;i<route.length-1;i++){ if(plan.legs[i].refuel){ stopIdx=i; break; } }
    const legRoute=route.slice(0,stopIdx+1), legPlan=fuelPlan(legRoute);
    const from=origin, to=legRoute[legRoute.length-1], weeks=legRoute.length-1, pausing=(to!==selected);
    let fired=[];
    if(typeof imperialDate!=='undefined'&&typeof advanceImperial==='function'&&typeof imperialOrdinal==='function'){
      const startOrd=imperialOrdinal(imperialDate); advanceImperial(weeks*7); const endOrd=imperialOrdinal(imperialDate);
      fired=((typeof campaignEvents!=='undefined'&&campaignEvents)||[]).filter(e=>{ const o=imperialOrdinal(e); return o>startOrd&&o<=endOrd; }); }
    if(typeof shipState!=='undefined'){
      shipState.fuel=Math.max(0,Math.round(legPlan.endTank)); shipState.locationId=to.id; shipState.origin=disp(to);
      shipState.destination=pausing?disp(selected):''; shipState.jumpParsecs=pausing?jumpDist(to,selected):0;
      shipState.visited=Array.isArray(shipState.visited)?shipState.visited:[];
      if(!shipState.visited.includes(to.id)) shipState.visited.push(to.id);   // arriving reveals this stop's market to players
      shipState.visitLog=shipState.visitLog||{};                              // stamp the call so remote intel can age (revisiting resets it)
      if(typeof imperialOrdinal==='function'&&typeof imperialDate!=='undefined') shipState.visitLog[to.id]=imperialOrdinal(imperialDate);
      shipState.jumpLog=Array.isArray(shipState.jumpLog)?shipState.jumpLog:[];
      shipState.jumpLog.unshift({ date:(typeof imperialDate!=='undefined'&&typeof formatImperial==='function'?formatImperial(imperialDate):''),
        from:disp(from), to:disp(to), weeks, burn:Math.round(legPlan.total), refuels:0, events:fired.map(e=>({title:e.title,note:e.note||''})) });
      if(shipState.jumpLog.length>40) shipState.jumpLog.length=40;
      if(typeof saveShipState==='function') saveShipState();
      if(typeof shipPanelOpen!=='undefined'&&shipPanelOpen&&typeof renderShipPanel==='function') renderShipPanel(); }
    refresh();
    if(pausing) toast(`⛽ Arrived at <b>${eh(disp(to))}</b> to refuel · ${weeks} wk. Roleplay the layover, refuel here, then Execute again to continue to <b>${eh(disp(selected))}</b>.`+(fired.length?` · <span style="color:#caa83b">${fired.length} event${fired.length>1?'s':''}!</span>`:''));
    else toast(`Jumped <b>${eh(disp(from))} → ${eh(disp(to))}</b> · ${weeks} wk`+(fired.length?` · <span style="color:#caa83b">${fired.length} event${fired.length>1?'s':''}!</span>`:''));
  }
  function markVisited(id){
    if(!ref()){ toast('Referee only.'); return; }
    if(typeof shipState==='undefined') return;
    shipState.visited=Array.isArray(shipState.visited)?shipState.visited:[];
    if(!shipState.visited.includes(id)) shipState.visited.push(id);
    shipState.visitLog=shipState.visitLog||{};                              // stamp the call so remote intel can age (revisiting resets it)
    if(typeof imperialOrdinal==='function'&&typeof imperialDate!=='undefined') shipState.visitLog[id]=imperialOrdinal(imperialDate);
    if(typeof saveShipState==='function') saveShipState();
    refresh(); toast('System marked visited — its market is now visible to players.');
  }
  function refuelHere(){
    if(!ref()){ toast('Referee only.'); return; }
    const kind=fuelAt(origin); if(kind==='none'){ toast('No fuel here.'); return; }
    let costNote='';
    if(typeof shipState!=='undefined'){
      // RAW price hint only — the honour-system Funds ledger stays manual.
      const tons=Math.max(0, fuelMax-(Number(shipState.fuel)||0)), rate=(kind==='refined')?500:100;
      if(tons>0) costNote=` — log ${kCr(tons*rate)} in Funds (${kind} Cr${rate}/t)`;
      shipState.fuel=fuelMax; if(typeof saveShipState==='function') saveShipState();
      if(typeof shipPanelOpen!=='undefined'&&shipPanelOpen&&typeof renderShipPanel==='function') renderShipPanel(); }
    refresh(); toast(`Refuelled at <b>${eh(disp(origin))}</b> — tank ${fuelMax}t${costNote}.`);
  }
  function selectSys(s){ selected=s;
    if(typeof shipState!=='undefined'&&s){ shipState.destination=(s===origin)?'':disp(s); shipState.jumpParsecs=(s===origin)?0:jumpDist(origin,s);
      if(typeof shipPanelOpen!=='undefined'&&shipPanelOpen&&typeof renderShipPanel==='function') renderShipPanel(); }
    refresh(); }
  // Tapping empty space clears the selection and returns to the galaxy overview,
  // so the galaxy-level panel is always reachable without leaving the map.
  function deselect(){ if(!selected) return; selected=null;
    if(typeof shipState!=='undefined'){ shipState.destination=''; shipState.jumpParsecs=0;
      if(typeof shipPanelOpen!=='undefined'&&shipPanelOpen&&typeof renderShipPanel==='function') renderShipPanel(); }
    refresh(); }

  // ── Right panel ──
  function renderDate(){ const el=document.getElementById('hx-pdate'); if(el&&typeof imperialDate!=='undefined'&&typeof formatImperial==='function') el.textContent=formatImperial(imperialDate); }
  function renderJBtns(){ const c=document.getElementById('hx-jbtns'); if(!c) return; c.innerHTML='';
    for(let j=1;j<=6;j++){ const b=document.createElement('button'); b.className='hx-jbtn'+(j===jumpRating?' on':''); b.textContent='J'+j; b.disabled=!ref();
      b.onclick=()=>{ if(!ref()) return; jumpRating=j; if(typeof shipState!=='undefined'){ shipState.jumpRating=j; if(typeof saveShipState==='function') saveShipState();
        if(typeof shipPanelOpen!=='undefined'&&shipPanelOpen&&typeof renderShipPanel==='function') renderShipPanel(); } refresh(); }; c.appendChild(b); } }
  function renderOriginNote(){ const el=document.getElementById('hx-origin-note'); if(!el||!origin) return; const rg=fuelReach();
    el.innerHTML=`Location: <b style="color:#f4d35e">${eh(disp(origin))}</b> (${origin.deep?'deep space':eh(origin.star)}). `+
      `A <b style="color:#00e5ff">Jump-${jumpRating}</b> drive reaches any system within ${jumpRating} hex${jumpRating>1?'es':''} in one ~1-week jump.`+
      `<br><b style="color:#D4A843">Range</b> on ${fuelAboard.toFixed(0)}/${fuelMax.toFixed(0)}t + refuelling: <b>${rg.count}</b> system${rg.count===1?'':'s'}`+
      (rg.farthest?` — farthest <b>${eh(disp(rg.farthest))}</b> (${rg.farthestJumps} jump${rg.farthestJumps===1?'':'s'})`:'')+'.'; }
  function renderSel(){ const el=document.getElementById('hx-sel-block'); if(!el) return;
    if(!origin){ el.innerHTML=''; return; }
    const FAC=(typeof GALAXY_FACTIONS!=='undefined')?GALAXY_FACTIONS:{};
    const s=selected, fac=s?effFac(s.fac):null, dHex=s?hexDist(s,origin):0; let html='';
    // Each panel section is a collapsible <details> dropdown. `sec()` closes the
    // previously-open section and opens a new one; open/closed state is keyed and
    // persisted in secState so it survives the frequent full-innerHTML re-renders.
    let _secOpen=false;
    const sec=(k,t,def,st)=>{ const o=(k in secState)?secState[k]:(def!==false); const pre=_secOpen?'</div></details>':''; _secOpen=true;
      return pre+`<details class="hx-sec" data-sec="${k}"${o?' open':''}><summary class="hx-sec-lbl"${st?` style="${st}"`:''}>${t}</summary><div class="hx-sec-body">`; };
    if(!s){
      // ── Galaxy overview (nothing selected) — tap a star to inspect it ──
      html+=sec('galaxy','Galaxy',true);
      html+=`<div style="font-size:14px;font-weight:700;color:var(--tx0)">The Orion Arm</div>`;
      html+=`<div class="hx-small hx-mono" style="margin-top:2px">Hex navigation · 1 hex = 1 parsec</div>`;
      const charted=SYS.filter(x=>!x.uncharted).length, unch=SYS.filter(x=>x.uncharted).length;
      html+=`<div class="hx-kv" style="margin-top:6px"><span class="k">Charted systems</span><span class="v">${charted}</span></div>`;
      if(unch) html+=`<div class="hx-kv"><span class="k">Uncharted stars</span><span class="v">${unch}</span></div>`;
      html+=`<div class="hx-kv"><span class="k">Your location</span><span class="v" style="color:#f4d35e">${eh(disp(origin))}</span></div>`;
      const counts={}; SYS.forEach(x=>{ if(x.uncharted) return; counts[x.fac]=(counts[x.fac]||0)+1; });
      let regKeys=Object.keys(FAC).filter(k=>counts[k]&&k!=='uncharted').sort((a,b)=>counts[b]-counts[a]);
      if(!ref()) regKeys=regKeys.filter(k=>!facHidden(k));   // players never see a hidden region listed
      if(regKeys.length){ html+=`<div class="hx-small" style="margin:8px 0 3px;color:var(--tx1)">Regions${ref()?' · <span style="opacity:.75">👁 tap to hide/reveal for players</span>':''}</div>`;
        regKeys.forEach(k=>{ const f=FAC[k]||{}; const hid=(typeof factionHidden!=='undefined'&&!!factionHidden[k]);
          const eye=ref()?`<button class="hx-fac-eye ${hid?'hidden-fac':'shown-fac'}" title="${hid?'Hidden from players — tap to reveal':'Visible to players — tap to hide'}" onclick="event.stopPropagation();toggleFactionHidden('${k}')">${hid?'🙈':'👁'}</button>`:'';
          html+=`<div class="hx-reach-item${hid?' fac-hidden':''}" style="cursor:default"><span class="hx-reach-name"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${f.color||'#888'};margin-right:6px;vertical-align:-1px"></span>${eh(f.name||k)}</span><span class="d" style="display:flex;align-items:center;gap:3px">${counts[k]}${eye}</span></div>`; }); }
      html+=document.documentElement.classList.contains('is-phone')
        ? `<div class="hx-small" style="margin-top:8px">Pick a system above to inspect it and plan a jump — the map itself is on the table display.</div>`
        : `<div class="hx-small" style="margin-top:8px">Tap a star to inspect it and plan a jump. Tap empty space to return here.</div>`;
    } else {
    html+=sec('sel','Selected System',true);
    html+=`<div style="font-size:14px;font-weight:700;color:var(--tx0)">${eh(disp(s))}</div>`;
    html+=`<div class="hx-small hx-mono" style="margin-top:2px">${s.deep?'Deep space — no fixed stellar position':eh(s.star)}</div>`;
    html+=`<span class="hx-tag" style="color:${fac.color};border-color:${fac.color}">${eh(fac.name)}</span>`;
    if(s.uncharted) html+=`<div class="hx-small" style="color:var(--tx1);margin:-2px 0 6px">○ Uncharted — no charted worlds; estimated data only</div>`;
    else {
      html+=`<div class="hx-btn-row"><button class="hx-act-btn" onclick="enterSystem('${s.systemId}')">⊙ View close up of ${eh(disp(s))}</button></div>`;
      const surveyed=(typeof effectiveBodies==='function'?effectiveBodies(s.systemId):[]).length>0;
      html+=`<div class="hx-small" style="color:${surveyed?'#4caf82':'var(--tx1)'};margin:-4px 0 6px">${surveyed?'✓ Surveyed':'○ Unsurveyed — estimated data'}</div>`;
    }
    if(s.zone==='amber') html+=`<div class="hx-small" style="color:#e8c65a">⚠ Amber Zone — caution advised; passenger &amp; freight traffic runs thinner here.</div>`;
    else if(s.zone==='red') html+=`<div class="hx-small" style="color:#ff5a4d">⛔ Red Zone — interdicted. Almost no legitimate traffic in or out.</div>`;
    if(!s.deep && s.pc!=null) html+=`<div class="hx-kv"><span class="k">Real distance from Sol <span style="opacity:.6">(ref)</span></span><span class="v">${s.pc.toFixed(2)} pc</span></div>`;
    html+=`<div class="hx-kv"><span class="k">Hex (q,r)</span><span class="v">${s.q}, ${s.r}</span></div>`;
    const selFuel=fuelAt(s);
    html+=`<div class="hx-kv"><span class="k">Starport / fuel</span><span class="v" style="color:${FUEL_INFO[selFuel].c}">Class ${portOf(s)} · ${FUEL_INFO[selFuel].t}</span></div>`;
    html+=`<div class="hx-kv"><span class="k">UWP</span><span class="v">${uwpStr(s)}</span></div>`;
    const selCodes=tradeCodes(s); if(selCodes.length) html+=`<div class="hx-kv"><span class="k">Trade codes</span><span class="v">${selCodes.join(' ')}</span></div>`;
    { const selU=uwpOf(s), climate=WGEN.tempBand(selU);
      if(climate) html+=`<div class="hx-kv"><span class="k">Climate</span><span class="v">${climate}${selU.temp!=null?` <span style="opacity:.6">(${selU.temp})</span>`:''}</span></div>`;
      // RAW life-support viability: a populated world under its environmental TL
      // floor is a story hook (imported tech, domes, a colony in decline) — flag, don't reroll.
      const minTL=WGEN.envMinTL(selU), selTL=(selU.tl!=null?selU.tl:selU.tech)|0;
      if((selU.pop|0)>0 && minTL>selTL)
        html+=`<div class="hx-small" style="color:#e8c65a">⚠ TL ${selTL} is below the TL ${minTL} survival floor for this atmosphere — life here needs a story.</div>`; }
    // Corporate presence — which trading houses are HQ'd or have expanded here (player-visible, like trade codes).
    if(typeof ECON!=='undefined' && ECON.isMarketId && ECON.isMarketId(s.id)){
      try{ const corps=Object.values(ECON.corps()).filter(c=>!c.defunct && (c.home===s.id || (c.invests||[]).some(iv=>iv.world===s.id)));
        if(corps.length){ const parts=corps.map(c=>{ const n=(c.invests||[]).filter(iv=>iv.world===s.id).length, role=c.home===s.id?(n?`HQ +${n}`:'HQ'):`${n} op${n===1?'':'s'}`;
            return `<span style="color:${c.color||'#ff9a3c'}">${eh((''+c.name).split(' ')[0])}</span> <span style="opacity:.65">(${role})</span>`; }).join(', ');
          html+=`<div class="hx-kv"><span class="k">Corporate presence</span><span class="v" style="text-align:right">${parts}</span></div>`; }
      }catch(e){}
    }
    // Living-economy world condition + black market (referee always; players once they've called here, like market data)
    if(typeof ECON!=='undefined' && ECON.active() && (ref() || isVisited(s))){
      const wst=ECON.worldStatus(s.id), WM=ECON.WS_META||{};
      if(wst && wst.kind && WM[wst.kind]) html+=`<div class="hx-kv"><span class="k">Condition</span><span class="v" style="color:${WM[wst.kind].color}">${WM[wst.kind].icon} ${WM[wst.kind].label}${wst.sev>1?' '+('I'.repeat(wst.sev)):''}</span></div>`;
      const cbd=ECON.contraband(s.id);
      if(cbd && cbd.good) html+=`<div class="hx-kv"><span class="k">Black market</span><span class="v" style="color:#b48cd6">☣ ${eh((''+cbd.good).replace('Common ',''))} +${Math.round(((cbd.premium||1.6)-1)*100)}%</span></div>`;
    }
    if(s===origin){
      html+=`<div class="hx-kv"><span class="k">Status</span><span class="v" style="color:#f4d35e">◆ Current location${typeof imperialDate!=='undefined'&&typeof formatImperial==='function'?' · '+formatImperial(imperialDate):''}</span></div>`;
      if(fuelAt(s)!=='none' && fuelAboard<fuelMax && ref())
        html+=`<div class="hx-btn-row"><button class="hx-act-btn" onclick="hxRefuelHere()">⛽ Refuel to ${fuelMax}t · ${FUEL_INFO[fuelAt(s)].t}</button></div>`;
    }
    if(s!==origin){
      html+=sec('from','From '+eh(disp(origin)),true);
      html+=`<div class="hx-kv"><span class="k">Jump distance</span><span class="v">${dHex} hex / ${dHex} pc</span></div>`;
      const route=bestRoute(origin,s);
      if(!route){ html+=`<div class="hx-note hx-warn">Unreachable with a Jump-${jumpRating} drive — no chain of ≤${jumpRating}-pc hops connects these. Needs a longer-legged ship or an intermediate stop.</div>`; }
      else { const plan=fuelPlan(route), jumps=route.length-1; let base=0, legsHtml='';
        const pct=+(FUEL_RULES.jumpFuelPerParsecFraction*100).toFixed(1), opWk=FUEL_RULES.operatingFuel.weeksPerJump||1;
        for(let i=0;i<jumps;i++){ const a=route[i],b=route[i+1], lane=onLane(a,b), ld=jumpDist(a,b), lf=plan.legs[i].fuel, ok=plan.legs[i].ok, rf=plan.legs[i].refuel;
          const op=operatingFuel(tonnage,opWk); base+=jumpFuel(tonnage,ld)+op;   // no-lane cost (+power) so "Saved via lanes" = base − plan.total
          const formula=`${pct}%×${tonnage}t×${ld}pc${lane?' ×'+LANE_FUEL_FACTOR+' lane':''}${op>0?' +'+op.toFixed(1)+'t pwr':''}`;   // verifiable breakdown at the table
          legsHtml+=`<div class="hx-route-leg" style="${ok?'':'color:#ff5a4d'}">▸ <b>${eh(disp(a))}</b>${rf?' <span style="color:#3f9d5a">⛽</span>':''} → <b>${eh(disp(b))}</b> · <span class="hx-small" style="opacity:.75">${formula} =</span> ${lf.toFixed(0)} t${ok?'':' ✖ dry'}</div>`; }
        const saved=base-plan.total, head=jumps===1?(onLane(origin,s)?'Direct, 1 jump · on lane':'Direct, 1 jump'):`${jumps} jumps`;
        html+=`<div class="hx-kv"><span class="k">${jumps===1?'Reachable':'Cheapest route'}</span><span class="v" style="color:${jumps===1?'#00e5ff':'#ddaa44'}">${head}</span></div>`;
        html+=`<div class="hx-kv"><span class="k">Total burn / time</span><span class="v">${plan.total.toFixed(0)} t · ${jumps} week${jumps>1?'s':''}</span></div>`;
        html+=`<div class="hx-kv"><span class="k">Tank</span><span class="v">${Math.min(fuelAboard,fuelMax).toFixed(0)} / ${fuelMax.toFixed(0)} t${plan.refuels?` · ${plan.refuels} refuel${plan.refuels>1?'s':''} ⛽`:''}</span></div>`;
        if(saved>0.5) html+=`<div class="hx-kv"><span class="k">Saved via lanes</span><span class="v" style="color:#00cc88">−${saved.toFixed(0)} t</span></div>`;
        if(plan.strandedAt!=null){ const sp=route[plan.strandedAt], nx=route[plan.strandedAt+1], f=plan.legs[plan.strandedAt].fuel;
          const msg=plan.reason==='tanksize'?`the ${hexDist(sp,nx)}-pc jump to <b>${eh(disp(nx))}</b> needs <b>${f.toFixed(0)} t</b> but a full tank only holds ${fuelMax.toFixed(0)} t. Fit a bigger tank, or route via shorter hops.`:`the ship arrives dry and <b>${eh(disp(sp))}</b> (port ${portOf(sp)}) has <b>no fuel</b>. The next jump needs ${f.toFixed(0)} t. Re-route through a fuelled system.`;
          html+=`<div class="hx-note" style="border-color:#ff5a4d;color:#ffa39c"><b style="color:#ff5a4d">⚠ STRANDED at ${eh(disp(sp))}.</b> ${msg}</div>`; }
        else html+=`<div class="hx-kv"><span class="k">Feasible</span><span class="v" style="color:#00cc88">${plan.refuels?`yes — ${plan.refuels} refuel stop${plan.refuels>1?'s':''}`:'yes, on one tank'}</span></div>`;
        html+=`<details open><summary>Route (Jump-${jumpRating})</summary>${legsHtml}</details>`;
        if(plan.strandedAt==null && ref()){
          let rfi=-1; for(let i=1;i<route.length-1;i++){ if(plan.legs[i].refuel){ rfi=i; break; } }   // first refuel layover — jump pauses there
          const ejLbl = rfi>0 ? `⚡ Jump to ${eh(disp(route[rfi]))} · ${rfi} wk · ⛽ refuel stop` : `⚡ Execute jump · ${jumps} wk`;
          html+=`<div class="hx-btn-row"><button class="hx-act-btn primary" onclick="hxExecuteJump()">${ejLbl}</button></div>`; }
        else if(plan.strandedAt==null) html+=`<div class="hx-small" style="margin-top:6px">Referee executes jumps. You can plan freely.</div>`;
      }
      html+=sec('cargo','Speculative Cargo → '+eh(disp(s)),false);
      const srcMkt=hasMarket(origin), dstMkt=hasMarket(s);
      if(!srcMkt||!dstMkt){ const dead=!srcMkt?origin:s, df=effFac(dead.fac);
        html+=`<div class="hx-small">No open market — ${eh((df&&df.name)||'this region')} keeps no commercial trade or refuelling at ${eh(disp(dead))}.</div>`; }
      else if(!ref() && !isVisited(s)){
        html+=`<div class="hx-small">○ Market data sealed — cargo prices for ${eh(disp(s))} appear only once the party has called there in person.</div>`; }
      else { const ops=tradeOpportunities(origin,s).filter(o=>o.profit>0).slice(0,4);
        if(!ops.length) html+=`<div class="hx-small">No profitable cargo from ${eh(disp(origin))} this week (Broker-${broker}).</div>`;
        else { ops.forEach(o=>{ html+=`<div class="hx-reach-item" style="cursor:default"><span class="hx-reach-name">${eh(o.good)}</span><span class="d">${kCr(o.buyP)} → ${kCr(o.sellP)} · <b style="color:#3f9d5a">+${kCr(o.profit)}/t</b></span></div>`; });
          const best=ops[0]; html+=`<div class="hx-kv"><span class="k">Best load · ${eh(best.good)} × ${cargoHold}t</span><span class="v" style="color:#3f9d5a">+${kCr(best.profit*cargoHold)}</span></div>`;
          html+=`<div class="hx-small" style="color:var(--tx1);margin-top:4px">Prices as of ${eh(typeof formatImperial==='function'?formatImperial(imperialDate):'now')} (Broker-${broker}); they drift week to week. Play rolls 3D6 per buy/sell.</div>`; } }
      { const cbd=(typeof ECON!=='undefined'&&ECON.active())?ECON.contraband(s.id):null;
        if(cbd && cbd.good && (ref()||isVisited(s)))
          html+=`<div class="hx-small" style="color:#b48cd6;margin-top:4px">☣ Black market — ${eh((''+cbd.good).replace('Common ',''))} moves off the books here at ~+${Math.round(((cbd.premium||1.6)-1)*100)}% over list since the restriction. Arrange the buy with the referee.</div>`; }
      if(ref() && (srcMkt&&dstMkt)){ html+= isVisited(s)
        ? `<div class="hx-small" style="color:#4caf82;margin-top:4px">✓ Party has called here — market visible to players.</div>`
        : `<div class="hx-btn-row"><button class="hx-act-btn" onclick="hxMarkVisited('${s.id}')">○ Mark visited — reveal market to players</button></div>`; }
    }
    }   // end of the selected-system (else) branch
    if(typeof designModeOn!=='undefined'&&designModeOn&&ref()){ const linking=(typeof gxLinkMode!=='undefined'&&gxLinkMode);
      html+=sec('dlanes','Design — Jump Lanes',true,'color:#9B59B6');
      html+= linking ? `<div class="hx-btn-row"><button class="hx-act-btn" style="border-color:#c0506e;color:#ff9bb6" onclick="gxCancelLink()">✕ Cancel — tap a destination on the map</button></div>`
        : (s ? `<div class="hx-btn-row"><button class="hx-act-btn" onclick="gxArmLink('${s.id}')">+ Add jump lane from ${eh(disp(s))}</button></div>`
             : `<div class="hx-small">Select a star, then tap a destination to draw a jump lane between it and another.</div>`);
      html+=`<div class="hx-small">Add a lane from any star — select it, then tap the destination. Tap a lane to remove it. No need to fly there.</div>`;
      const nblk=(routeBlocks&&routeBlocks.blocks)?Object.keys(routeBlocks.blocks).length:0;
      html+=`<div class="hx-btn-row" style="margin-top:6px"><button class="hx-act-btn"${gxBlockMode?' style="border-color:#d45050;color:#ff9b9b"':''} onclick="gxArmBlock()">${gxBlockMode?'✓ Block mode ON — tap a lane to close/open':'🔒 Close / reopen jump lanes'}</button></div>`;
      html+=`<div class="hx-btn-row"><button class="hx-act-btn"${routeBlocks.enabled?'':' style="border-color:#caa83b;color:#e8c65a"'} onclick="gxToggleBlocksEnabled()">${routeBlocks.enabled?('Blocks active · '+nblk+' closed — tap to lift all'):('Kill-switch OFF · '+nblk+' held')}</button></div>`;
      html+=`<div class="hx-small">Closed lanes show dashed-red with 🔒 to you and nav crew (Rhett, Cass); other players see an ordinary lane. Blocks are a story signal — the route planner itself is unchanged.</div>`; }
    if(typeof designModeOn!=='undefined'&&designModeOn&&ref()){
      html+=sec('dsys','Design — System',false,'color:#9B59B6');
      if(typeof HX!=='undefined'&&HX.placing&&HX.placing()){
        html+=`<div class="hx-btn-row"><button class="hx-act-btn" style="border-color:#c0506e;color:#ff9bb6" onclick="HX.cancelPlace()">✕ Cancel — or tap an empty hex on the map</button></div>`;
      } else if(!s){
        html+=`<div class="hx-small">Tap an empty hex on the map (or the button below) to chart a new system, then select it to edit its details.</div>`;
        html+=`<div class="hx-btn-row" style="margin-top:6px"><button class="hx-act-btn" onclick="hxBeginAddSystem()">＋ Add new system</button></div>`;
      } else if(s.uncharted){
        html+=`<div class="hx-small">Uncharted frontier star — not an authored system, so there's nothing to edit here. Use “Add new system” to chart a system of your own.</div>`;
        html+=`<div class="hx-btn-row" style="margin-top:6px"><button class="hx-act-btn" onclick="hxBeginAddSystem()">＋ Add new system</button></div>`;
      } else {
        const nd=(typeof GX_MAP!=='undefined'?GX_MAP[s.id]:null)||{};
        const FACS=(typeof GALAXY_FACTIONS!=='undefined')?GALAXY_FACTIONS:{};
        const facOpts=Object.keys(FACS).map(fk=>`<option value="${fk}"${s.fac===fk?' selected':''}>${eh((FACS[fk]||{}).name||fk)}</option>`).join('');
        const ea=(typeof escAttr==='function')?escAttr:eh;
        html+=`<label class="hx-edit-row"><span>Name</span><input class="hx-edit-in" value="${ea(disp(s))}" onchange="hxEditSystemField('${s.id}','label',this.value)"></label>`;
        html+=`<label class="hx-edit-row"><span>Star</span><input class="hx-edit-in" value="${ea(s.star||'')}" onchange="hxEditSystemField('${s.id}','name',this.value)"></label>`;
        html+=`<label class="hx-edit-row"><span>Faction</span><select class="hx-edit-in" onchange="hxEditSystemField('${s.id}','faction',this.value)">${facOpts}</select></label>`;
        const zoneOpts=[['','Green — no advisory'],['amber','Amber — caution advised'],['red','Red — interdicted']].map(([v,l])=>`<option value="${v}"${(nd.zone||'')===v?' selected':''}>${l}</option>`).join('');
        html+=`<label class="hx-edit-row"><span>Zone</span><select class="hx-edit-in" onchange="hxEditSystemField('${s.id}','zone',this.value)">${zoneOpts}</select></label>`;
        html+=`<div class="hx-small" style="margin:2px 0 6px">Zone rings show on the map for everyone and feed the Starport Board's passenger &amp; freight DMs (amber +1/−2, red −4/−6).</div>`;
        html+=`<label class="hx-edit-row hx-edit-col"><span>Notes</span><textarea class="hx-edit-in" rows="2" onchange="hxEditSystemField('${s.id}','desc',this.value)">${eh(nd.desc||'')}</textarea></label>`;
        html+=`<div class="hx-small" style="margin:2px 0 6px">UWP &amp; worlds come from this system's main world — use <b>⊙ View close up</b> above to add or randomly generate bodies.</div>`;
        html+=`<div class="hx-btn-row"><button class="hx-act-btn" onclick="hxMoveSystem('${s.id}')">✎ Move on map</button> <button class="hx-act-btn" style="border-color:#c0506e;color:#ff9bb6" onclick="hxRemoveSystem('${s.id}')">🗑 Remove</button></div>`;
        html+=`<div class="hx-btn-row" style="margin-top:8px"><button class="hx-act-btn" onclick="hxBeginAddSystem()">＋ Add new system</button></div>`;
      }
    }
    if(typeof designModeOn!=='undefined'&&designModeOn&&ref()){
      html+=sec('dregions','Design — Regions',false,'color:#9B59B6');
      const RF=(typeof GALAXY_FACTIONS!=='undefined')?GALAXY_FACTIONS:{};
      const ea2=(typeof escAttr==='function')?escAttr:eh;
      Object.keys(RF).forEach(fk=>{ const f=RF[fk]||{}; const builtin=(fk==='independent'||fk==='uncharted'); const mem=SYS.filter(x=>x.fac===fk&&!x.uncharted).length;
        html+=`<div class="hx-reg-row">`+
          `<input type="color" class="hx-reg-col" value="${ea2(f.color||'#888888')}" onchange="hxEditFactionField('${fk}','color',this.value)" title="Region colour">`+
          `<input class="hx-edit-in" value="${ea2(f.name||fk)}" onchange="hxEditFactionField('${fk}','name',this.value)" title="${mem} system${mem===1?'':'s'} in this region">`+
          (builtin?`<span class="hx-reg-lock" title="Built-in fallback region">🔒</span>`:`<button class="hx-reg-del" title="Remove region" onclick="hxRemoveFaction('${fk}')">🗑</button>`)+
        `</div>`; });
      html+=`<div class="hx-btn-row" style="margin-top:8px"><button class="hx-act-btn" onclick="hxAddFaction()">＋ Add region</button></div>`;
      html+=`<div class="hx-small">Regions are the galaxy's sectors — they colour the territory overlay and tag systems. Assign a system to a region under “Design — System”.</div>`;
    }
    if(typeof designModeOn!=='undefined'&&designModeOn&&ref()&&typeof ECON!=='undefined'&&s){
      html+=sec('decon','Design — Production &amp; Consumption',true,'color:#9B59B6');
      if(!ECON.isMarketId(s.id)){
        html+=`<div class="hx-small">${eh((fac&&fac.name)||'This faction')} keeps no open market at ${eh(disp(s))} — nothing to configure.</div>`;
      } else {
        const ep=ECON.effectiveProfile(s.id);
        const chips=(typeof econChipsHTML==='function')?econChipsHTML(s.id):'';
        html+= chips ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">${chips}</div>`
                     : `<div class="hx-small" style="margin-bottom:6px">No production or consumption configured.</div>`;
        if(ep.overridden) html+=`<div class="hx-small" style="color:#C98BE8;margin:-2px 0 6px">✎ Custom economy — overrides the built-in profile.</div>`;
        html+=`<div class="hx-btn-row"><button class="hx-act-btn" onclick="openEconEditor('${s.id}')">⚒ Edit production &amp; consumption</button></div>`;
        if(typeof econPriceControlHTML==='function') html+=econPriceControlHTML(s.id);
      }
    }
    const fromLanes=laneEdges().filter(L=>L.a===origin||L.b===origin).map(L=>({to:L.a===origin?L.b:L.a,len:L.len})).sort((a,b)=>a.len-b.len);
    if(fromLanes.length){ html+=sec('lanes','Lanes from '+eh(disp(origin))+' · '+fromLanes.length,false);
      fromLanes.forEach(f=>{ html+=`<div class="hx-reach-item" onclick="hxSelectByKey('${f.to.q},${f.to.r}')"><span class="hx-reach-name" style="color:#00cc88">⟢ ${eh(disp(f.to))}</span><span class="d">${f.len} pc · 1 jump</span></div>`; }); }
    const reach=SYS.filter(x=>x!==origin&&hexDist(x,origin)>=1&&hexDist(x,origin)<=jumpRating).sort((a,b)=>hexDist(a,origin)-hexDist(b,origin));
    html+=sec('range','In range of '+eh(disp(origin))+' · '+reach.length,false);
    if(!reach.length) html+=`<div class="hx-small">Nothing within Jump-${jumpRating}. Increase the jump drive or move.</div>`;
    reach.forEach(x=>{ const dh=hexDist(x,origin), lane=onLane(x,origin); html+=`<div class="hx-reach-item" onclick="hxSelectByKey('${x.q},${x.r}')"><span class="hx-reach-name" style="${lane?'color:#00cc88':''}">${lane?'⟢ ':''}${eh(disp(x))}</span><span class="d">${dh} pc · ${legFuel(x,origin).toFixed(0)}t</span></div>`; });
    const log=(typeof shipState!=='undefined'&&Array.isArray(shipState.jumpLog))?shipState.jumpLog:[];
    if(log.length){ html+=sec('log',"Captain's Log · "+log.length,false);
      log.slice(0,8).forEach(e=>{ html+=`<div class="hx-log-item"><b>${eh(e.date||'')}</b> · ${eh(e.from||'')} → <b>${eh(e.to||'')}</b> · ${e.weeks||0} wk · ${e.burn||0}t`+(e.refuels?` · ${e.refuels}⛽`:'')+`</div>`;
        (e.events||[]).forEach(ev=>html+=`<div class="hx-log-event">▸ <b style="color:#caa83b">${eh(ev.title||'')}</b>${ev.note?' — '+eh(ev.note):''}</div>`); }); }
    if(_secOpen) html+='</div></details>';   // close the final open section
    el.innerHTML=html;
    if(!secBound){ secBound=true;   // capture-phase listener: <details> toggle doesn't bubble, so remember each section's open state across re-renders
      el.addEventListener('toggle',ev=>{ const d=ev.target; if(d&&d.tagName==='DETAILS'&&d.dataset&&d.dataset.sec) secState[d.dataset.sec]=d.open; },true); }
  }

  // ── Phone-only system picker — on handsets the map canvas is hidden (the
  //    table display is the map), so this dropdown replaces tap-to-select.
  //    Lists exactly the stars the map would show; hidden-region stars appear
  //    under their real label, same as they do on the map itself. ──
  function renderPicker(){ const el=document.getElementById('hx-sys-picker'); if(!el) return;
    if(!document.documentElement.classList.contains('is-phone')) return;   // never populated off-phone
    if(document.activeElement===el) return;   // don't rebuild under an open picker sheet
    const key=s=>s.q+','+s.r;
    const opt=(v,t)=>{ const o=document.createElement('option'); o.value=v; o.textContent=t; return o; };
    el.innerHTML='';
    el.appendChild(opt('','— Galaxy overview —'));
    const gCh=document.createElement('optgroup'); gCh.label='Charted systems';
    const gUn=document.createElement('optgroup'); gUn.label='Uncharted stars';
    SYS.slice().sort((a,b)=>disp(a).localeCompare(disp(b)))
      .forEach(s=>{ (s.uncharted?gUn:gCh).appendChild(opt(key(s),disp(s)+(s===origin?' ◆ here':''))); });
    el.appendChild(gCh); if(gUn.children.length) el.appendChild(gUn);
    el.value=(selected&&BY_KEY[key(selected)]===selected)?key(selected):''; }

  // ── Ship-stat inputs (shared with shipState) ──
  function bindInputs(){ [['hx-tonnage','tonnage'],['hx-fuelmax','fuelMax'],['hx-fuelaboard','fuel'],['hx-cargohold','cargoHold'],['hx-broker','broker']].forEach(pair=>{
    const id=pair[0], field=pair[1], elx=document.getElementById(id); if(!elx) return;
    elx.addEventListener('input',()=>{ if(!ref()){ syncInputs(); return; } let v=Math.max(0,Number(elx.value)||0); if(field==='broker') v=clamp(v,0,6);
      if(typeof shipState!=='undefined'){ shipState[field]=v; if(typeof saveShipState==='function') saveShipState();
        if(typeof shipPanelOpen!=='undefined'&&shipPanelOpen&&typeof renderShipPanel==='function') renderShipPanel(); }
      readShared(); renderOriginNote(); render(); renderSel(); }); }); }
  function syncInputs(){ const r=ref(); const set=(id,val)=>{const e=document.getElementById(id); if(e){ if(document.activeElement!==e) e.value=val; e.disabled=!r; }};
    set('hx-tonnage',tonnage); set('hx-fuelmax',fuelMax); set('hx-fuelaboard',Math.round(fuelAboard)); set('hx-cargohold',cargoHold); set('hx-broker',broker); }

  // ── Pan / zoom (transform-only — no DOM rebuild) ──
  function zoomBy(f){ view.scale=clamp(view.scale*f,0.3,4); applyTransform(); }
  function fitView(){ if(!svg) return; if(extCamLock){ render(); return; }   // a mirrored camera (table display) owns the view — never auto-fit over it
    const rect=svg.getBoundingClientRect(); if(!rect.width||!rect.height){ render(); return; }
    let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9; SYS.forEach(s=>{const p=axialPx(s.q,s.r); minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);});
    const pad=70, cw=(maxX-minX)+pad*2, ch=(maxY-minY)+pad*2;
    view.scale=clamp(Math.min(rect.width/cw,rect.height/ch),0.3,1.6); fitScale=view.scale;
    view.x=rect.width/2-((minX+maxX)/2)*view.scale; view.y=rect.height/2-((minY+maxY)/2)*view.scale; fitted=true; render(); }
  function bindPanZoom(){ if(!svg) return; let drag=null, lastDist=null;
    svg.addEventListener('pointerdown',e=>{ drag={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y,touch:e.pointerType==='touch'}; dragMoved=false; tapConsumed=false; svg.classList.add('hx-dragging'); });
    // A finger tap jitters several px before lift; a 4px pan threshold misreads that as a
    // drag and the star's `if(dragMoved) return;` swallows the tap. Use a larger slop for
    // touch so taps register, while keeping mouse panning crisp.
    svg.addEventListener('pointermove',e=>{ if(!drag) return; const dx=e.clientX-drag.x, dy=e.clientY-drag.y; if(!dragMoved&&Math.abs(dx)+Math.abs(dy)<(drag.touch?12:4)) return; dragMoved=true; view.x=drag.vx+dx; view.y=drag.vy+dy; applyTransform(); });
    // Cleanup on window so a release that drifts off the map still ends the pan.
    window.addEventListener('pointerup',()=>{ const moved=dragMoved; drag=null; tapConsumed=false; if(svg) svg.classList.remove('hx-dragging'); if(moved) scheduleViewportRender(); });
    // Tap empty map → deselect (back to the galaxy overview). Scoped to the svg so taps
    // elsewhere in the app never clear the selection. Star / lane / place-cell pointerups
    // fire first (deeper in the tree) and set tapConsumed, so only true background taps
    // reach deselect. Driven off pointerup, not click: iOS doesn't reliably synthesize a
    // click on SVG shapes once touch-action:none + custom pointer handlers are in play.
    svg.addEventListener('pointerup',e=>{ if(e.button>0||dragMoved||tapConsumed) return;
      if(placeMode) return;                                       // placing a system — the hex cells handle the tap
      if(typeof gxLinkMode!=='undefined'&&gxLinkMode) return;     // drawing a lane — tap picks the destination
      deselect(); });
    svg.addEventListener('wheel',e=>{ e.preventDefault(); zoomBy(e.deltaY<0?1.12:0.89); scheduleSettleRender(); },{passive:false});
    svg.addEventListener('touchmove',e=>{ if(e.touches.length===2){ e.preventDefault(); const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY); if(lastDist) zoomBy(d/lastDist); lastDist=d; } },{passive:false});
    svg.addEventListener('touchend',()=>{ lastDist=null; scheduleViewportRender(); }); }

  function refresh(){ readShared(); syncInputs(); renderDate(); renderJBtns(); renderOriginNote(); render(); renderSel(); renderPicker(); }

  // ── Lifecycle hooks (enter/exit driven by goGalaxy + navBack) ──
  function ensure(){ if(built) return; svg=document.getElementById('hx-map'); if(!svg) return;
    bindPanZoom(); bindInputs(); if(!resizeBound){ window.addEventListener('resize',onResize); resizeBound=true; } built=true; }
  function enter(){ ensure(); if(!svg) return; readShared(); refresh();
    if(!fitted) requestAnimationFrame(()=>requestAnimationFrame(()=>{ if(svg) fitView(); renderSel(); })); }
  function onResize(){ if(typeof currentView!=='undefined'&&currentView!=='galaxy') return; if(!built||!svg) return; render(); }
  function selectById(id){ ensure(); const s=BY_ID[id]; if(s) selected=s; readShared(); refresh(); }
  function externalRefresh(){ if(!built||!svg){ return; } readShared(); syncInputs(); renderDate(); renderJBtns(); renderOriginNote(); render(); renderSel(); renderPicker(); }

  // ── window onclick shims (referenced by inline handlers / overlay buttons) ──
  window.hxToggleLanes=()=>{ showLanes=!showLanes; const b=document.getElementById('hx-lane-toggle'); if(b){ b.textContent='Lanes: '+(showLanes?'ON':'OFF'); b.classList.toggle('off',!showLanes); } render(); };
  window.hxToggleTerr =()=>{ showTerr=!showTerr; const b=document.getElementById('hx-terr-toggle'); if(b){ b.textContent='Territories: '+(showTerr?'ON':'OFF'); b.classList.toggle('off',!showTerr); } render(); };
  window.hxToggleRange=()=>{ showRange=!showRange; const b=document.getElementById('hx-range-toggle'); if(b){ b.textContent='Fuel range: '+(showRange?'ON':'OFF'); b.classList.toggle('on',showRange); } render(); };
  window.hxToggleFuel =()=>{ showFuel=!showFuel; const b=document.getElementById('hx-fuel-toggle'); if(b){ b.textContent='Fuel: '+(showFuel?'ON':'OFF'); b.classList.toggle('off',!showFuel); } render(); };
  function buildTradeLegend(lg){
    // Each world shows emoji badges for what it makes (▲) and needs (▼); the chips below
    // double as the emoji key AND toggle each good's animated flow lines (Full sim only).
    let h='<div class="hx-tl-h"><span style="color:#66c07a;font-weight:700">▲</span> produces · <span style="color:#e3a24a;font-weight:700">▼</span> needs</div>'+
      '<div class="hx-tl-sub">Emoji above each world · zoom in for demand &amp; amounts</div>'+
      '<div class="hx-tl-h" style="margin-top:7px">Goods flows <span class="hx-tl-an" onclick="hxTradeAllGoods(true)">all</span> · <span class="hx-tl-an" onclick="hxTradeAllGoods(false)">none</span></div><div class="hx-tl-grid">';
    Object.keys(GOOD_COL).forEach(g=>{ const on=tradeGoods.has(g);
      h+=`<div class="hx-tl-chip${on?' on':''}" onclick="hxTradeGood('${g}')"><span class="hx-tl-em">${GOOD_ICON[g]||''}</span><span class="hx-tl-sw" style="background:${GOOD_COL[g]}"></span>${gShort(g)}</div>`; });
    h+='</div>';
    // Supply→demand arcs: producer → importer for each picked good (works without the sim).
    h+=`<div class="hx-tl-row" style="margin-top:5px"><span class="hx-tl-an${showRoutes?' on':''}" onclick="hxToggleRoutes()">⟿ routes: ${showRoutes?'ON':'OFF'}</span><span style="color:var(--tx1);opacity:.85">supply → demand</span></div>`;
    // Price heatmap key — only meaningful for a single good, so it appears once exactly one
    // chip is picked; otherwise a hint tells you how to summon it.
    if(tradeGoods.size===1){ const g=[...tradeGoods][0];
      h+=`<div class="hx-tl-heat"><div class="hx-tl-h" style="margin-bottom:4px">Price map · ${GOOD_ICON[g]||''} ${gShort(g)}</div>`+
        `<div class="hx-tl-heatbar"></div>`+
        `<div class="hx-tl-heatlbl"><span style="color:${HEAT_BUY}">BUY · glut</span><span style="color:${HEAT_SELL}">SELL · scarce</span></div></div>`;
    } else {
      h+='<div class="hx-tl-sub" style="margin-top:6px">Pick one good above for a buy/sell price map</div>';
    }
    // Referee-only "best run from here" — names the optimal cargo run, so it's the ref's
    // planning aid, never the players' (they make the call). Gated on ref() AND .ref-only so
    // it can't leak into player view.
    if(ref()){ h+=`<div class="hx-tl-best ref-only"><div class="hx-tl-row"><span class="hx-tl-an${showBestRun?' on':''}" onclick="hxToggleBestRun()">★ best run: ${showBestRun?'ON':'OFF'}</span><span style="color:var(--tx1);opacity:.85">referee</span></div>`;
      if(showBestRun){ let br=null; try{ br=bestRunFromHere(); }catch(e){}
        if(br) h+=`<div class="hx-tl-bestread">Buy <b>${GOOD_ICON[br.good]||''} ${gShort(br.good)}</b> here → sell at <b>${eh(disp(br.dst))}</b><br><span style="color:#3f9d5a">+${kCr(br.perTon)}/t · +${kCr(br.total)} / hold</span> · ${br.weeks} wk · ${Math.round(br.fuel)}t fuel</div>`;
        else h+=`<div class="hx-tl-sub" style="margin-top:3px">No profitable run reachable from ${eh(disp(origin))}.</div>`; }
      h+='</div>'; }
    h+='<div class="hx-tl-row" style="margin-top:6px"><span class="hx-tl-sw" style="background:#f4d35e;clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)"></span>Independent trader (always shown)</div>';
    lg.innerHTML=h;
  }
  window.hxToggleTrade=()=>{ showTrade=!showTrade; const b=document.getElementById('hx-trade-toggle'); if(b){ b.textContent='Trade: '+(showTrade?'ON':'OFF'); b.classList.toggle('on',showTrade); }
    const lg=document.getElementById('hx-trade-legend');
    if(lg){ lg.classList.toggle('hidden',!showTrade); if(showTrade) buildTradeLegend(lg); }
    render(); };
  window.hxToggleRoutes=()=>{ showRoutes=!showRoutes;
    const lg=document.getElementById('hx-trade-legend'); if(lg) buildTradeLegend(lg); render(); };
  window.hxToggleBestRun=()=>{ if(!ref()) return; showBestRun=!showBestRun;
    const lg=document.getElementById('hx-trade-legend'); if(lg) buildTradeLegend(lg); render(); };
  window.hxTradeGood=g=>{ if(tradeGoods.has(g)) tradeGoods.delete(g); else tradeGoods.add(g);
    const lg=document.getElementById('hx-trade-legend'); if(lg) buildTradeLegend(lg); render(); };
  window.hxTradeAllGoods=on=>{ tradeGoods.clear(); if(on) Object.keys(GOOD_COL).forEach(g=>tradeGoods.add(g));
    const lg=document.getElementById('hx-trade-legend'); if(lg) buildTradeLegend(lg); render(); };
  window.hxZoomBy=f=>zoomBy(f);
  window.hxResetView=()=>fitView();
  window.hxExecuteJump=executeJump;
  window.hxRefuelHere=refuelHere;
  window.hxMarkVisited=markVisited;
  window.hxSelectByKey=k=>{ const s=BY_KEY[k]; if(s) selectSys(s); };
  // Phone picker onchange — empty value returns to the galaxy overview.
  window.hxPickSystem=k=>{ if(!k){ deselect(); return; } const s=BY_KEY[k]; if(s) selectSys(s); };

  // ── Design Mode: live add / move / remove of campaign systems ──
  // syncNodes() diffs the host's effective GALAXY_NODES set into SYS/BY_ID/BY_KEY/
  // occupied WITHOUT re-running the cluster placement, so existing systems never
  // jump. New nodes land on the hex they carry (click-to-place) or the nearest
  // free hex; removed nodes free their cell. Called from rebuildSystemsFromOverlay.
  function nearestFreeHex(q0,r0){ const sp=spiral(Math.round(q0||0),Math.round(r0||0),36);
    for(const h of sp){ if(!occupied.has(h.q+','+h.r)) return h; } return {q:q0||0,r:r0||0}; }
  function syncNodes(nodes){
    const want={}; (nodes||[]).forEach(n=>{ want[n.id]=n; });
    // Remove campaign systems whose node is gone (leave uncharted frontier stars).
    for(let i=SYS.length-1;i>=0;i--){ const s=SYS[i]; if(s.uncharted) continue;
      if(!want[s.id]){ occupied.delete(s.q+','+s.r); if(BY_KEY[s.q+','+s.r]===s) delete BY_KEY[s.q+','+s.r]; delete BY_ID[s.id]; SYS.splice(i,1); } }
    // Add new / update existing.
    Object.keys(want).forEach(id=>{ const n=want[id]; let s=BY_ID[id];
      if(s){ s.star=n.name; s.label=(n.label||n.name); s.fac=n.faction; s.connections=n.connections||[]; s.pc=pcOf(n.name); s.deep=isDeep(n); s.systemId=n.systemId||n.id; s.zone=n.zone||''; s._uwp=null;   // drop cached UWP so a faction/survey edit re-derives trade codes (and ECON.worldFacts) fresh
        if(n.q!=null&&n.r!=null&&(s.q!==n.q||s.r!==n.r)){ const occ=BY_KEY[n.q+','+n.r];
          if(!occ||occ===s){ occupied.delete(s.q+','+s.r); if(BY_KEY[s.q+','+s.r]===s) delete BY_KEY[s.q+','+s.r];
            s.q=n.q; s.r=n.r; occupied.add(s.q+','+s.r); BY_KEY[s.q+','+s.r]=s; } } }
      else { let q=n.q, r=n.r;
        if(q==null||r==null||occupied.has(q+','+r)){ const a=FACTION_ANCHOR[n.faction]||[0,0]; const f=nearestFreeHex(q!=null?q:a[0], r!=null?r:a[1]); q=f.q; r=f.r; }
        s={ id:n.id, systemId:n.systemId||n.id, star:n.name, label:(n.label||n.name), fac:n.faction, connections:n.connections||[], pc:pcOf(n.name), deep:isDeep(n), zone:n.zone||'', campaign:true, q, r };
        SYS.push(s); BY_ID[id]=s; BY_KEY[q+','+r]=s; occupied.add(q+','+r); } });
    if(selected&&!BY_ID[selected.id]) selected=null;
    if(origin&&!BY_ID[origin.id]) origin=BY_ID['aurelia']||SYS[0]||null;
  }
  function moveSystem(id,q,r){ const s=BY_ID[id]; if(!s) return; const occ=BY_KEY[q+','+r]; if(occ&&occ!==s) return;
    occupied.delete(s.q+','+s.r); if(BY_KEY[s.q+','+s.r]===s) delete BY_KEY[s.q+','+s.r];
    s.q=q; s.r=r; occupied.add(q+','+r); BY_KEY[q+','+r]=s; render(); renderSel(); }
  function hexOf(id){ const s=BY_ID[id]; return s?{q:s.q,r:s.r}:null; }
  function armPlace(cb){ if(typeof designModeOn!=='undefined'&&!designModeOn) return; placeMode=true; placeCb=cb||null;
    toast('Tap an empty hex to place the system.'); render(); renderSel(); }
  function cancelPlace(){ placeMode=false; placeCb=null; render(); renderSel(); }
  function placePick(q,r){ const cb=placeCb; placeMode=false; placeCb=null; render(); renderSel(); if(cb) cb(q,r); }
  window.hxCancelPlace=cancelPlace;

  // ── Referee territory brush ──
  // Tap a hex to paint it the current brush colour; tap it again in the same
  // colour to erase it. Painted cells are shared campaign state (see hexPaint /
  // saveHexPaint), so every player sees the borders the referee draws.
  function paintPick(q,r){
    if(typeof isReferee==='function' && !isReferee()) return;   // referee-only tool
    if(typeof hexPaint==='undefined') return;
    const key=q+','+r, same=hexPaint[key] && String(hexPaint[key]).toLowerCase()===String(paintColor).toLowerCase();
    if(same) delete hexPaint[key]; else hexPaint[key]=paintColor;
    if(typeof saveHexPaint==='function') saveHexPaint();
    render();
  }
  window.hxTogglePaint=()=>{
    if(typeof isReferee==='function' && !isReferee()) return;
    paintMode=!paintMode;
    if(paintMode && !showTerr){ showTerr=true;   // paint lives in the territory overlay — make sure it's visible
      const tb=document.getElementById('hx-terr-toggle'); if(tb){ tb.textContent='Territories: ON'; tb.classList.remove('off'); } }
    const b=document.getElementById('hx-paint-toggle'); if(b){ b.textContent='🖌 Paint: '+(paintMode?'ON':'OFF'); b.classList.toggle('on',paintMode); }
    toast(paintMode?'Paint mode ON — tap hexes to colour them; tap again to erase.':'Paint mode off.');
    render();
  };
  window.hxSetPaintColor=c=>{ if(c) paintColor=c; if(paintMode) render(); };
  window.hxClearPaint=()=>{
    if(typeof isReferee==='function' && !isReferee()) return;
    if(typeof hexPaint==='undefined') return;
    if(!Object.keys(hexPaint).length){ toast('No painted hexes to clear.'); return; }
    if(typeof confirm==='function' && !confirm('Clear all painted territory hexes?')) return;
    hexPaint={}; if(typeof saveHexPaint==='function') saveHexPaint(); render();
  };

  // ── World economic facts — the physical inputs the living economy derives an
  //    UNCONFIGURED world's production/consumption from, so procedurally generated
  //    worlds join the market automatically (ECON.derivedProfile). Reuses the SAME
  //    seeded UWP the map shows (uwpOf), so the chart and the economy never disagree.
  //    Gas/ice giants flag a hydrogen-skimming source for the fuel chain. Returns null
  //    for an unknown / no-market node (caller falls back to a light-consumer default).
  function worldFacts(id){
    const node=(typeof GX_MAP!=='undefined')?GX_MAP[id]:null; if(!node) return null;
    const s = BY_ID[id] || { id, systemId:node.systemId||id, fac:node.faction,
                             star:node.name, label:node.label||node.name, deep:isDeep(node) };
    let uwp; try{ uwp=uwpOf(s); }catch(e){ return null; }
    let codes; try{ codes=WGEN.tradeCodes(uwp); }catch(e){ codes=[]; }
    let gasGiant=false;
    try{ const bodies=(typeof effectiveBodies==='function'?effectiveBodies(s.systemId):[])||[];
      gasGiant=bodies.some(b=> b.discStyle==='gasgiant' || /gas giant|ice giant/i.test(b.type||'')); }catch(e){}
    return { codes, port:uwp.port, pop:uwp.pop|0, law:uwp.law|0, tl:uwp.tl|0, gasGiant, fac:node.faction };
  }

  return { enter, ensure, refresh:externalRefresh, selectById, onResize, syncNodes, moveSystem, hexOf, armPlace, cancelPlace, placing(){ return placeMode; }, worldFacts, localMarket, getCamera, setCamera, get origin(){ return origin; } };
})();

function goGalaxy(){
  playViewTransition(() => {
    currentView = 'galaxy';
    ['view-system','view-body','view-station'].forEach(v => {
      const el = document.getElementById(v); if(el) el.classList.add('v-hidden');
    });
    const gv = document.getElementById('view-galaxy');
    gv.classList.remove('v-hidden'); gv.style.display = 'flex';
    document.getElementById('hdr-title').textContent = layerLabel('galaxy','The Orion Arm').toUpperCase();
    document.getElementById('breadcrumb').innerHTML = '';
    updateBackBtn();
    if(typeof HX!=='undefined') HX.enter();   // hex-jump galaxy layer: read shared state, render, fit
  });
}

// ── Drill into a system's close-up (the orrery) ────────────────────────────
function currentSystemName(){
  if(currentSystemId === 'auros') return 'Aurelian'; // campaign flavour name (after Aurelia)
  const s = SYSTEMS[currentSystemId];
  return s ? (s.name || s.id) : 'System';
}

function enterSystem(systemId){
  if(!SYSTEMS[systemId]) return;
  playViewTransition(() => {
    currentSystemId = systemId;
    selectedBody = null;
    currentView = 'system';
    ['view-galaxy','view-body','view-station'].forEach(v => {
      const el = document.getElementById(v); if(el) el.classList.add('v-hidden');
    });
    const vs = document.getElementById('view-system');
    vs.classList.remove('v-hidden'); vs.style.display = 'flex';
    // Reset overview ↔ body-detail visibility (a body may have been selected in
    // a previously-visited system).
    const det = document.getElementById('sys-body-detail');
    if(det){ det.classList.add('v-hidden'); det.innerHTML = ''; }
    const ov = document.getElementById('sys-overview');
    if(ov) ov.classList.remove('v-hidden');
    const stBtn = document.getElementById('btn-view-station');
    if(stBtn) stBtn.classList.add('v-hidden');
    document.getElementById('hdr-title').textContent = currentSystemName().toUpperCase() + ' ' + layerShort('system','System').toUpperCase();
    setBreadcrumb([{label:'The Orion Arm', fn:'goGalaxy'}], currentSystemName());
    renderSystemOverview();
    buildOrrery();
    updateBackBtn();
    maybeSystemWelcome(systemId);
  });
}

// ── Per-system welcome ──────────────────────────────────────────────────────
// Greet the viewer with the system name over "Welcome Traveller" each time they
// drop into a system from the galaxy. Shown to everyone (players + referee); the
// referee can turn it off or edit the copy from the splash editor. Cosmetic.
function maybeSystemWelcome(sysId){
  if(typeof showSplash !== 'function') return;                 // splash unavailable
  if(!sysId || !SYSTEMS[sysId]) return;
  const c = (typeof getSplashConfig === 'function') ? getSplashConfig().system : null;
  if(c && c.enabled === false) return;   // referee turned it off
  showSplash({
    kicker: c ? c.kicker : '',
    title:  currentSystemName().toUpperCase(),   // the system name is always the headline
    sub:    c ? c.sub  : 'Welcome Traveller',
    hint:   c ? c.hint : 'Tap anywhere to continue',
    duration: 3400,
    // Cover the system view on the same frame it renders — the welcome comes
    // FIRST, then fades out to reveal the system, instead of fading in a beat
    // after the view has already popped into place.
    instant: true,
  });
}

// Star-info header for the system overview (per system).
const AUROS_OVERVIEW_HTML = `<div style="color:var(--tx1);font-size:12px;line-height:1.6;margin-bottom:14px">
  Star type: <span style="color:#E8A020;font-weight:700">Auros — K3 V Orange Dwarf</span><br>
  Mass: 0.78 M☉ · Luminosity: 0.42 L☉ · Age: 5.2 Gyr<br>
  Habitable zone: 0.55–0.85 AU
</div>`;
function gxStarInfoHTML(sysId){
  if(sysId === 'auros') return AUROS_OVERVIEW_HTML;
  const sys = SYSTEMS[sysId] || {};
  const node = GX_MAP[sys.galaxyId] || {};
  const f = GALAXY_FACTIONS[sys.faction] || {name:'Independent', color:'var(--tx1)'};
  const star = effectiveBodies(sysId).find(b => b.isStar);
  let lines = `Star designation: <span style="color:#E8A020;font-weight:700">${escHtml(sys.starName||sys.name)}</span><br>`;
  if(star) lines += `Primary: ${escHtml((star.type||'').split('·')[0].trim())}<br>`;
  lines += `Faction: <span style="color:${f.color}">${escHtml(f.name)}</span>`;
  const desc = node.desc ? `<div class="s-desc" style="margin-top:10px;color:var(--tx1)">${escHtml(node.desc)}</div>` : '';
  return `<div style="color:var(--tx1);font-size:12px;line-height:1.6;margin-bottom:14px">${lines}</div>${desc}`;
}

// Build the system-overview panel: star info, then either the body list or the
// blank-system prompt depending on whether the system has been surveyed.
function renderSystemOverview(){
  const sysId = currentSystemId;
  const nm = document.getElementById('sys-dname');
  if(nm){ nm.textContent = currentSystemName().toUpperCase() + ' SYSTEM'; nm.style.color = ''; }
  const dt = document.getElementById('sys-dtype');
  if(dt) dt.textContent = 'SELECT A BODY TO INSPECT';
  const star = document.getElementById('sys-star-info');
  if(star) star.innerHTML = gxStarInfoHTML(sysId);

  // System economy (Design Mode, referee) — same prod/cons data + editor as the galaxy view.
  // Below it, the ref-only "Docked Traders" panel (TASK 4) for the same world node.
  const econSec = document.getElementById('sys-econ-section');
  if(econSec){
    const nodeId = (SYSTEMS[sysId]||{}).galaxyId;
    econSec.innerHTML = econSystemSectionHTML(nodeId)
      + (typeof dockedTradersSectionHTML==='function' ? dockedTradersSectionHTML(nodeId) : '');   // 90-economy (later module) — guarded per house pattern
  }

  const bodies = effectiveBodies(sysId);
  const bodiesSec = document.getElementById('sys-bodies-section');
  const prompt = document.getElementById('sys-blank-prompt');
  if(bodies.length === 0){
    if(bodiesSec) bodiesSec.classList.add('v-hidden');
    if(prompt){ prompt.classList.remove('v-hidden'); prompt.innerHTML = renderBlankPrompt(sysId); }
  } else {
    if(bodiesSec) bodiesSec.classList.remove('v-hidden');
    if(prompt){ prompt.classList.add('v-hidden'); prompt.innerHTML = ''; }
  }
}

function renderBlankPrompt(sysId){
  const sys = SYSTEMS[sysId] || {};
  if(!isReferee()){
    return `<div class="blank-sys-card">
      <div class="blank-sys-icon">🛰</div>
      <div class="blank-sys-title">Unsurveyed system</div>
      <div class="blank-sys-sub">${escHtml(sys.name||'This system')} has not been charted by your referee yet.</div>
    </div>`;
  }
  return `<div class="blank-sys-card">
    <div class="blank-sys-icon">🪐</div>
    <div class="blank-sys-title">Unsurveyed system</div>
    <div class="blank-sys-sub">No bodies charted in <b style="color:var(--tx0)">${escHtml(sys.name||'this system')}</b> yet. Populate it:</div>
    <div class="blank-sys-actions">
      <button class="blank-sys-btn gen" onclick="generateSystem('${sysId}')">🎲 Generate system (UWP)</button>
      <button class="blank-sys-btn man" onclick="openBodyCreator(true)">✍️ Add a body manually</button>
    </div>
    <div class="blank-sys-note">Generation rolls a primary star and 3–7 worlds per Traveller 2e world-profile rules. Everything is saved to the shared campaign and can be edited or removed afterwards.</div>
  </div>`;
}

// ── Full-system random generator ───────────────────────────────────────────
const GX_STAR_TYPES = [
  {cls:'M', label:'M5 V Red Dwarf',            color:'#E0623A', r:14, w:5},
  {cls:'K', label:'K3 V Orange Dwarf',         color:'#E07030', r:16, w:4},
  {cls:'G', label:'G2 V Yellow Main Sequence', color:'#F4D06A', r:18, w:3},
  {cls:'F', label:'F5 V White',                color:'#FBF4D6', r:20, w:2},
  {cls:'A', label:'A2 V Blue-White',           color:'#CFE0FF', r:22, w:1},
];
function gxPickStar(){
  const total = GX_STAR_TYPES.reduce((a,s)=>a+s.w,0);
  let n = Math.random()*total;
  for(const s of GX_STAR_TYPES){ if((n-=s.w) < 0) return s; }
  return GX_STAR_TYPES[1];
}
function gxName(){
  const a=['Hal','Vor','Cae','Ny','Tor','Lys','Mer','Ash','Kael','Dra','Sel','Ves','Cor','Ith','Bel','Ona','Pyr','Zan','Qel','Rho','Mar','Tyl'];
  const b=['ion','dara','lis','mar','this','ora','enn','aris','elle','oth','une','ix','ara','os','yn','eia','ade','orn','ix','eus'];
  return a[Math.floor(Math.random()*a.length)] + b[Math.floor(Math.random()*b.length)];
}
function gxTerrColor(u){
  if(u.hydro >= 7) return '#3E78C8';        // ocean world
  if(u.hydro >= 3) return '#4A90D9';        // temperate
  if(u.atm >= 10)  return '#9AA86A';        // exotic/dense
  if(u.atm <= 1)   return '#9A8C7A';        // rock/airless
  return '#B98E5A';                          // dry/desert
}
function gxTerrType(u){
  if(u.atm === 0 || u.size === 0) return 'Terrestrial · Airless Rock';
  if(u.hydro >= 7) return 'Terrestrial · Ocean World';
  if(u.hydro <= 1) return 'Terrestrial · Desert World';
  if(u.atm >= 10)  return 'Terrestrial · Exotic Atmosphere';
  return 'Terrestrial · Rocky World';
}
async function generateSystem(sysId){
  if(!isReferee()){ showToast('Referee only', 'error'); return; }
  if(!SYSTEMS[sysId]){ showToast('Unknown system', 'error'); return; }
  const sys = SYSTEMS[sysId];
  const stamp = Date.now();
  const mk = (n) => `gen-${sysId}-${stamp}-${n}-${Math.floor(Math.random()*1000)}`;
  const out = [];

  // Primary star (orbitPos null = at the centre).
  const st = gxPickStar();
  out.push({
    id: mk('star'), name: sys.starName || (sys.name+' Primary'),
    type: st.label + ' · Primary Star', tag:null, color: st.color,
    orbitAU:'—', uwpString:'—', diameter:'—', period:'—',
    isMoon:false, isStar:true, hook:false, displayRadius: st.r, orbitPos:null,
    desc:'Auto-generated primary star.', refNote:null, readAloud:null, npcs:[], checks:[], events:[]
  });

  const count = 3 + Math.floor(Math.random()*5); // 3..7 orbital slots
  let beltPlaced = false, mainWorld = null, mainScore = -1;
  let gasGiantId = null;
  const auBase = [0.3,0.6,1.0,1.6,2.8,5.2,9.4,14.0,19.0];

  for(let p=1; p<=count; p++){
    const u = genUWP();
    const id = mk('p'+p);
    const au = (auBase[p-1] || (auBase[auBase.length-1] + (p-auBase.length)*6)) * (0.85 + Math.random()*0.3);
    const auStr = au.toFixed(au<10?2:1) + ' AU';
    const outer = p >= count-1;

    if(u.size === 0 && !beltPlaced){
      // Asteroid belt
      beltPlaced = true;
      out.push({
        id, name: gxName()+' Belt', type:'Asteroid Belt', tag:null, color:'#8B7355',
        orbitAU: auStr, uwpString: uwpToString(u, u.starport), diameter:'Diffuse belt',
        period:'—', isMoon:false, isStar:false, hook:false, beltDensity: 120+Math.floor(Math.random()*260),
        orbitPos:p, desc:'Auto-generated asteroid belt.', refNote:null, readAloud:null, npcs:[], checks:[], events:[]
      });
      continue;
    }
    if(outer && Math.random() < 0.55){
      // Gas giant
      const gg = Math.random()<0.5;
      gasGiantId = gasGiantId || id;
      out.push({
        id, name: gxName(), type: gg?'Gas Giant · Major':'Ice Giant · Outer System', tag:null,
        color: gg?'#C87941':'#2AABB8', orbitAU: auStr, uwpString:'—',
        diameter:'~'+(40+Math.floor(Math.random()*120))+',000 km', period:'—',
        isMoon:false, isStar:false, hook:false, displayRadius: gg?18:13,
        ringStyle: Math.random()<0.5 ? (gg?'major':'subtle') : null,
        orbitPos:p, desc:'Auto-generated '+(gg?'gas':'ice')+' giant.', refNote:null, readAloud:null, npcs:[], checks:[], events:[]
      });
      continue;
    }
    // Terrestrial world
    const size = Math.max(0, u.size);
    out.push({
      id, name: gxName(), type: gxTerrType(u), tag:null, color: gxTerrColor(u),
      orbitAU: auStr, uwpString: uwpToString(u, u.starport),
      diameter: '~'+((size*1600)||800).toLocaleString()+' km', period:'—',
      isMoon:false, isStar:false, hook:false, displayRadius: Math.max(6, Math.min(12, 5+Math.round(size/2))),
      orbitPos:p, desc:'Auto-generated world. UWP '+uwpToString(u,u.starport)+'.', refNote:null, readAloud:null, npcs:[], checks:[], events:[]
    });
    // Track the most developed world as the system's main world / hook.
    const score = u.pop*2 + (u.atm>=4&&u.atm<=9?3:0) + (u.hydro>=1&&u.hydro<=9?2:0);
    if(score > mainScore){ mainScore = score; mainWorld = out[out.length-1]; }
  }

  // Optional moon on a gas giant.
  if(gasGiantId && Math.random() < 0.6){
    const u = genUWP();
    out.push({
      id: mk('moon'), name: gxName(), type:'Moon · Satellite', tag:null, color:'#B0B0B0',
      orbitAU:'(moon)', uwpString: uwpToString(u, u.starport), diameter:'~'+(1+Math.floor(Math.random()*4))+',000 km',
      period:'—', isMoon:true, parentId: gasGiantId, isStar:false, hook:false,
      desc:'Auto-generated moon.', refNote:null, readAloud:null, npcs:[], checks:[], events:[]
    });
  }

  // Flag the main world.
  if(mainWorld && mainScore >= 12){ mainWorld.hook = true; mainWorld.tag = 'ADVENTURE HOOK'; }

  if(!bodyAdditions[sysId]) bodyAdditions[sysId] = [];
  out.forEach(b => bodyAdditions[sysId].push(b));
  await saveBodyAdditions();
  showToast('Generated ' + out.length + ' bodies for ' + (sys.name||sysId));
  renderSystemOverview();
  buildOrrery();
}

function currentSystem(){ return SYSTEMS[currentSystemId]; }
function baseBodiesFor(sysId){
  // Read the active Campaign Pack's content; for the built-in Archon Gambit pack
  // content.systems IS the SYSTEMS constant (same reference) so behaviour is
  // identical, while an authored campaign supplies its own (or empty) systems.
  const c = (typeof activePackContent === 'function') ? activePackContent() : null;
  if(c && c.systems && c.systems[sysId]) return c.systems[sysId].base || [];
  return (typeof SYSTEMS !== 'undefined' && SYSTEMS[sysId]) ? SYSTEMS[sysId].base : [];
}


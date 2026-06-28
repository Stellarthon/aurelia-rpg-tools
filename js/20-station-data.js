// ═══════════════════════════════════════════════════════════════════════════
// STATION DATA
// ═══════════════════════════════════════════════════════════════════════════
const MAIN = {
  "elevator": {
    "label": "Space Elevator",
    "sub": "Planet surface · Currently offline",
    "tag": "OFF LIMITS",
    "tagBg": "#2e1f0a",
    "tagColor": "#d4913a",
    "ac": "#BA7517",
    "read": "The orbital elevator runs from the equatorial anchor on Aurelia's surface to this platform — a cable 36,000km long, the engineering marvel of the sector. You can feel a faint vibration through the deck plates when the cars are running. Right now you cannot.\n\nThe elevator is offline for 24 hours whilst the surface terminal undergoes a drive system retrofit. A polite notice near the sealed gate explains this. Two security staff stand nearby in the manner of people who have been told to look approachable.",
    "conn": [
      "concourse",
      "docking"
    ],
    "subs": {}
  },
  "docking": {
    "label": "Docking Hub",
    "sub": "Sector 10 · Hangar Bay 15",
    "tag": "ARRIVAL",
    "tagBg": "#1a2650",
    "tagColor": "#5b8ef0",
    "ac": "#185FA5",
    "read": "The docking arm connects with a sound that is almost musical — a tone, not a clunk. The corridor beyond is wider than it needs to be, lit from everywhere at once, no shadows. The floor gives slightly underfoot.\n\nDockmaster Vey's glass-fronted office overlooks the hangar floor. The fuel situation is critical — the jump drive core is depleted.",
    "conn": [
      "concourse",
      "elevator",
      "security"
    ],
    "subs": {
      "landing-pad": {
        "label": "Landing Pad — Bay 15",
        "sub": "Where the Meridian's Edge sits",
        "read": "Bay 15 is a mid-sized berth on the station's docking ring — large enough for a 200-ton vessel, which makes a 100-ton scout look solitary in the space. The Meridian's Edge sits at the centre of a clean composite floor that has been swept recently. Fuel lines and power umbilicals run from the bay wall to the ship's service ports.\n\nThe ship looks exactly like what she is: a hundred-ton scout/courier that has been working for a long time and has not stopped. She is not ugly. She is honest.",
        "ship": {
          "name": "The Meridian's Edge",
          "lines": [
            [
              "Hull",
              "100-ton streamlined wedge. Atmospheric capable. The profile is distinctive — a broad flat ventral surface tapering to a sharp prow, twin engine pods mounted asymmetrically off the port quarter."
            ],
            [
              "Condition",
              "Old. Well-loved. The crystalliron armour plating shows four centuries of minor impacts. The hull is a faded grey-green that was probably a specific shade once."
            ],
            [
              "Engine pods",
              "Port pod is original — smaller, older. Starboard pod is the upgrade: slightly larger, different alloy. Between them the drive output is 2G."
            ],
            [
              "Markings",
              "No name plate. The name MERIDIAN'S EDGE appears on the ship's transponder. Near the portside airlock, someone has welded a small bracket to the hull. Riley made it. She hasn't explained what it was for."
            ],
            [
              "Interior",
              "Cramped in the way of old ships designed by people who understood that space is weight. The mess table has six places. The sixth is in the correct position. Nobody set it there this morning."
            ],
            [
              "Maintenance note",
              "Annual maintenance is 5 years overdue. All Engineering checks aboard ship are at -1 DM until this is addressed. Riley knows."
            ],
            [
              "Jump drive",
              "WARP-2 capable. Originally WARP-3. The jump drive core is currently depleted. Refuelling is the priority."
            ]
          ]
        }
      },
      "dockmaster-office": {
        "label": "Dockmaster's Office",
        "sub": "Glass-fronted · Overlooking Bay 15",
        "read": "A glass-fronted room that looks out over the entire hangar floor. Vey can see every bay from his desk. He tends to stand rather than sit, hands clasped behind his back, watching.\n\nThe office is functional rather than comfortable — a desk, a terminal, a shelf of physical binders that look like they predate the terminal by twenty years. The binders are organised by date. The dates go back further than Vey has worked here."
      }
    }
  },
  "concourse": {
    "label": "Main Concourse",
    "sub": "300-metre promenade · 4 sub-areas",
    "tag": "EXPLORATION",
    "tagBg": "#2e1f0a",
    "tagColor": "#d4913a",
    "ac": "#BA7517",
    "read": "The station's heart. A high-ceilinged promenade running from the docking hub to the observation dome. The ceiling mimics an idealised sky — blue, clear, slow clouds taking forty minutes to cross. The light shifts with them.\n\nPrices are not displayed in the windows. Everything is beautiful in the way of a museum that has decided you belong here or you don't.",
    "conn": [
      "docking",
      "elevator",
      "security",
      "maintenance",
      "medical"
    ],
    "subs": {
      "promenade": {
        "label": "The Promenade",
        "sub": "Main thoroughfare · Full length",
        "read": "The central walkway of the concourse. Wide enough for six people abreast. The composite floor is pale and slightly warm underfoot — heated from below. Benches at regular intervals, designed to be comfortable but not so comfortable that people linger."
      },
      "stellarview": {
        "label": "Stellarview Bar & Lounge",
        "sub": "Deck 3 · Observation windows",
        "read": "The bar occupies the outer curve of the station's tertiary ring — one long wall of floor-to-ceiling transparisteel looking out onto the stars and the planet below. Aurelia fills the lower third of every window.\n\nThe interior is dark wood tones, low lighting, high stools at a long curved bar. The bartender knows your drink before you sit down — very good facial recognition software integrated into the ordering system."
      },
      "exchange": {
        "label": "The Exchange",
        "sub": "Commercial district · Shops & services",
        "read": "Six storefronts arranged around a small atrium at the concourse's mid-point. The atrium has a real tree at its centre — not a large one, but genuine, growing in a recessed planter with a small brass plaque. The tree is forty-three years old and was brought from Aurelia's surface as a seedling."
      },
      "dome": {
        "label": "Observation Dome",
        "sub": "End of the promenade · Aurelia below",
        "read": "The terminus of the promenade. The dome is exactly what it sounds like — a full hemispheric transparisteel observation space at the station's outermost point. Aurelia fills the lower half of the view: blue and white and impossibly beautiful from up here.\n\nThere are benches arranged in concentric arcs facing the planet. The outermost arc is close enough to the transparisteel that you can press your hand against it and feel the cold of space through the material — a design choice, not an oversight.\n\nPeople come here to think. There is an unspoken agreement that you do not speak to strangers in the dome."
      }
    }
  },
  "security": {
    "label": "Security & Administration",
    "sub": "Upper ring · Station Operations",
    "tag": "RESTRICTED",
    "tagBg": "#1e1e2e",
    "tagColor": "#8b91a8",
    "ac": "#534AB7",
    "read": "Not on the visitor map. Upper ring, behind a door marked STATION OPERATIONS — NO ENTRY. Two guards in white uniforms with slightly different collar markings. Players are intercepted before reaching the door — unless Rhett knows someone inside.",
    "conn": [
      "docking",
      "concourse",
      "maintenance"
    ],
    "subs": {
      "guardhouse": {
        "label": "Guardhouse",
        "sub": "Security hub · Upper ring entrance",
        "read": "The operational centre of station security. Banks of monitors showing feeds from every public area — the concourse, the docking bays, the medical suite waiting area, the elevator gate. The maintenance level is not monitored from here."
      },
      "armoury": {
        "label": "Armoury",
        "sub": "Weapons storage · Restricted access",
        "read": "A small room behind a reinforced door with a biometric lock. Standard station security loadout: sidearms, shock batons, two combat rifles in a locked rack, breaching tools, emergency vacc suits. Everything is catalogued and counted after every shift.\n\nThere is a single missile launcher in a separate locker. It has never been removed from its locker since installation. The locker has dust on the seal."
      },
      "admin-a": {
        "label": "Administration Block A",
        "sub": "Station operations & records",
        "read": "The administrative heart of the station. Open-plan, twelve workstations, half occupied at any given time. Filing systems for berth allocation, cargo manifests, passenger records going back forty years. The physical binders from Vey's office are duplicated here."
      },
      "admin-b": {
        "label": "Administration Block B",
        "sub": "Delegation suite · Currently in use",
        "read": "Normally a secondary records office. Currently repurposed for the duration of the trade delegation — four Hegemony administrative staff working at temporary terminals, a sealed inner office for the delegation's senior attaché, and a security sweep conducted every two hours.\n\nThe door to Block B requires delegation credentials or Dara's explicit authorisation."
      }
    }
  },
  "medical": {
    "label": "Medical Suite",
    "sub": "Aurelia Medical Institute · Tertiary ring",
    "tag": "KEY NPC",
    "tagBg": "#0f2e20",
    "tagColor": "#4caf82",
    "ac": "#0F6E56",
    "read": "The tertiary ring — its own atmospheric processing, power redundancy, acoustic dampening. The smell of a continuous sterilisation cycle. Rotating anatomical models in the waiting area illuminated from within.\n\nThe smell hits Cass before she's ready. The sterilisation compound is the same as Meridian Interstellar Academy. She has half a second where she is twenty-three and the future is uncomplicated.",
    "conn": [
      "concourse",
      "maintenance"
    ],
    "subs": {}
  },
  "maintenance": {
    "label": "Maintenance Level",
    "sub": "Service tunnels · Below the station",
    "tag": "UNDERDECK",
    "tagBg": "#2e1010",
    "tagColor": "#d45050",
    "ac": "#A32D2D",
    "read": "The floral additive is gone. Real recycled air — metallic, honest. Narrower corridors. Functional lighting. Panels with visible seams and marker notes nobody erased. The station without its costume.\n\nThe Cleaners live and work here on five-year non-transferable contracts. Their community is real. Their opinions about the floor above them are their own.",
    "conn": [
      "concourse",
      "medical",
      "security"
    ],
    "subs": {
      "life-support": {
        "label": "Life Support",
        "sub": "Atmospheric processing · Level 1",
        "read": "The largest single space in the maintenance level. Tall enough to stand straight in — just. A grid of atmospheric processors running the full length of the room, each one the size of a wardrobe, humming at slightly different frequencies. The combined sound is almost musical in an industrial way.\n\nThis is where the floral additive is produced and distributed. The machine responsible is smaller than expected — a grey box the size of a suitcase, mounted near the ceiling. It has a small label: AMBIENT ATMOSPHERIC SUPPLEMENT — LEVEL 7 FRAGRANCE SYSTEM. Below it someone has written in marker: 'for whom?'\n\nThe air down here is what the station actually breathes. Up above is the edited version."
      },
      "reactor": {
        "label": "Reactor Level",
        "sub": "Power systems · Level 2",
        "read": "Down a level from life support, accessible via a service ladder that requires a keycard. The reactor level is hotter than anywhere else in the station — not dangerously, but noticeably. The fusion plant that powers the station sits at the centre: a dull grey cylinder four metres tall and two metres wide, surrounded by a hexagonal monitoring cage.\n\nThe reactor is 30 years old. It was designed for 25."
      },
      "manufacturing": {
        "label": "Manufacturing Level",
        "sub": "Fabrication & repair · Level 3",
        "read": "The lowest accessible level of the station. A fabrication floor: three industrial printers, a machining station, a welding rig, a parts inventory wall covering the entire length of one side. The parts wall is organised with a precision that suggests whoever is responsible for it has strong opinions about organisation.\n\nThis is where the Cleaners' tools come from, where damaged station components are repaired or printed, where Riley would spend a significant amount of time if allowed."
      }
    }
  }
};



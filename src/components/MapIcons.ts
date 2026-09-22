import L from 'leaflet';

/**
 * Custom SVG DivIcon for the Pirate Ship (User)
 */
export function createPirateShipIcon(headingDeg: number = 0): L.DivIcon {
  const html = `
    <div style="transform: rotate(${headingDeg}deg); transform-origin: center center; width: 72px; height: 72px; position: relative;" class="pointer-events-none drop-shadow-[0_4px_14px_rgba(0,0,0,0.85)]">
      <!-- Water wake behind ship -->
      <div style="position: absolute; bottom: 3px; left: 50%; transform: translateX(-50%); width: 34px; height: 20px; background: radial-gradient(ellipse, rgba(255,255,255,0.75) 0%, rgba(56,189,248,0) 80%); border-radius: 50%; filter: blur(1.5px);"></div>
      
      <!-- Pirate Ship SVG -->
      <svg viewBox="0 0 100 100" width="72" height="72" class="overflow-visible">
        <!-- Ship Hull -->
        <path d="M 50 12 C 67 32 70 72 50 92 C 30 72 33 32 50 12 Z" fill="#3f1e07" stroke="#1c1917" stroke-width="3" />
        <!-- Deck plank lines -->
        <line x1="50" y1="20" x2="50" y2="82" stroke="#78350f" stroke-width="1.8" />
        <line x1="41" y1="36" x2="59" y2="36" stroke="#78350f" stroke-width="1.2" />
        <line x1="39" y1="52" x2="61" y2="52" stroke="#78350f" stroke-width="1.2" />
        <line x1="42" y1="68" x2="58" y2="68" stroke="#78350f" stroke-width="1.2" />

        <!-- Cannons protruding from hull -->
        <rect x="27" y="44" width="4" height="2" fill="#18181b" />
        <rect x="26" y="58" width="4" height="2" fill="#18181b" />
        <rect x="69" y="44" width="4" height="2" fill="#18181b" />
        <rect x="70" y="58" width="4" height="2" fill="#18181b" />

        <!-- Main Mast Crossbeams -->
        <line x1="26" y1="42" x2="74" y2="42" stroke="#1f2937" stroke-width="2.8" stroke-linecap="round" />
        <line x1="30" y1="62" x2="70" y2="62" stroke="#1f2937" stroke-width="2.8" stroke-linecap="round" />

        <!-- Black Sails -->
        <!-- Front Sail -->
        <path d="M 32 39 Q 50 48 68 39 Q 50 32 32 39 Z" fill="#09090b" stroke="#3f3f46" stroke-width="1.2" />
        <!-- Main Sail -->
        <path d="M 27 58 Q 50 69 73 58 Q 50 49 27 58 Z" fill="#09090b" stroke="#3f3f46" stroke-width="1.2" />
        
        <!-- Golden Bowsprit / Mast top -->
        <circle cx="50" cy="12" r="2.5" fill="#fbbf24" stroke="#92400e" stroke-width="0.8" />

        <!-- ================= PIRATE FLAG (JOLLY ROGER) ================= -->
        <!-- Flagpole extending from main mast -->
        <line x1="50" y1="42" x2="50" y2="16" stroke="#fbbf24" stroke-width="2.2" stroke-linecap="round" />
        <circle cx="50" cy="15" r="2" fill="#fbbf24" />

        <!-- Waving Jolly Roger Flag fluttering to starboard (right) -->
        <!-- Flag background with rippling edge -->
        <path d="M 51 16 Q 66 12 82 17 L 80 34 Q 65 29 51 33 Z" fill="#0a0a0a" stroke="#ef4444" stroke-width="0.9" />

        <!-- Skull & Crossbones on the Pirate Flag -->
        <!-- Crossed Bones behind Skull -->
        <line x1="58" y1="20" x2="74" y2="28" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" />
        <line x1="58" y1="28" x2="74" y2="20" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" />
        <!-- Bone ends / knobs -->
        <circle cx="58" cy="20" r="1.1" fill="#ffffff" />
        <circle cx="74" cy="28" r="1.1" fill="#ffffff" />
        <circle cx="58" cy="28" r="1.1" fill="#ffffff" />
        <circle cx="74" cy="20" r="1.1" fill="#ffffff" />

        <!-- Skull -->
        <ellipse cx="66" cy="23.5" rx="3.5" ry="3.8" fill="#ffffff" />
        <rect x="64.5" y="26.5" width="3" height="1.6" rx="0.5" fill="#ffffff" />
        <!-- Eye sockets -->
        <circle cx="65" cy="23.5" r="0.8" fill="#0a0a0a" />
        <circle cx="67" cy="23.5" r="0.8" fill="#0a0a0a" />
        <!-- Nose cavity -->
        <polygon points="66,24.8 65.6,25.5 66.4,25.5" fill="#0a0a0a" />
        <!-- Teeth lines -->
        <line x1="65.3" y1="26.8" x2="65.3" y2="28.1" stroke="#0a0a0a" stroke-width="0.4" />
        <line x1="66.7" y1="26.8" x2="66.7" y2="28.1" stroke="#0a0a0a" stroke-width="0.4" />
      </svg>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'pirate-ship-icon',
    iconSize: [72, 72],
    iconAnchor: [36, 36],
  });
}

/**
 * Custom SVG DivIcon for the Small Scout Boat
 */
export function createScoutBoatIcon(headingDeg: number = 0): L.DivIcon {
  const html = `
    <div style="transform: rotate(${headingDeg}deg); transform-origin: center center; width: 44px; height: 44px; position: relative;" class="pointer-events-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
      <!-- Scout Wake -->
      <div style="position: absolute; bottom: 2px; left: 50%; transform: translateX(-50%); width: 16px; height: 10px; background: radial-gradient(ellipse, rgba(255,255,255,0.7) 0%, rgba(56,189,248,0) 70%); border-radius: 50%; filter: blur(1px);"></div>

      <svg viewBox="0 0 100 100" width="44" height="44" class="overflow-visible">
        <!-- Hull -->
        <path d="M 50 12 C 60 28 62 68 50 86 C 38 68 40 28 50 12 Z" fill="#b45309" stroke="#451a03" stroke-width="3" />
        <!-- Scout single white triangular sail -->
        <path d="M 50 25 L 68 52 L 50 48 Z" fill="#f8fafc" stroke="#64748b" stroke-width="1.2" />
        <!-- Scout Mast -->
        <circle cx="50" cy="36" r="2.5" fill="#f59e0b" />
        <!-- Left & Right Oars -->
        <line x1="26" y1="44" x2="48" y2="48" stroke="#78350f" stroke-width="2" stroke-linecap="round" />
        <line x1="74" y1="44" x2="52" y2="48" stroke="#78350f" stroke-width="2" stroke-linecap="round" />
      </svg>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'scout-boat-icon',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}

/**
 * Custom SVG DivIcon for the Anchor
 */
export function createAnchorIcon(): L.DivIcon {
  const html = `
    <div style="width: 48px; height: 48px; position: relative;" class="pointer-events-none drop-shadow-[0_4px_10px_rgba(0,0,0,0.9)] animate-bounce">
      <!-- Glow ring on water -->
      <div style="position: absolute; inset: 6px; border-radius: 50%; border: 2px dashed #fbbf24; opacity: 0.8; animation: spin 8s linear infinite;"></div>
      <svg viewBox="0 0 100 100" width="48" height="48" class="overflow-visible">
        <!-- Top ring -->
        <circle cx="50" cy="20" r="8" fill="none" stroke="#f59e0b" stroke-width="4" />
        <!-- Stock (crossbar) -->
        <line x1="30" y1="36" x2="70" y2="36" stroke="#fbbf24" stroke-width="5" stroke-linecap="round" />
        <circle cx="30" cy="36" r="3" fill="#b45309" />
        <circle cx="70" cy="36" r="3" fill="#b45309" />
        <!-- Shank (vertical shaft) -->
        <line x1="50" y1="26" x2="50" y2="82" stroke="#fbbf24" stroke-width="5.5" stroke-linecap="round" />
        <!-- Flukes (curved anchor arms) -->
        <path d="M 22 62 C 24 86 76 86 78 62" fill="none" stroke="#f59e0b" stroke-width="5.5" stroke-linecap="round" />
        <!-- Arrowhead flukes -->
        <polygon points="22,62 16,66 26,72" fill="#fbbf24" stroke="#78350f" stroke-width="1" />
        <polygon points="78,62 84,66 74,72" fill="#fbbf24" stroke="#78350f" stroke-width="1" />
      </svg>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'anchor-icon',
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });
}

/**
 * Custom SVG DivIcon for the Supply Ship with Supplies Flag
 */
export function createSupplyShipIcon(headingDeg: number = 0): L.DivIcon {
  const html = `
    <div style="transform: rotate(${headingDeg}deg); transform-origin: center center; width: 56px; height: 56px; position: relative;" class="pointer-events-none drop-shadow-[0_3px_12px_rgba(0,0,0,0.85)]">
      <!-- Water wake -->
      <div style="position: absolute; bottom: 3px; left: 50%; transform: translateX(-50%); width: 24px; height: 14px; background: radial-gradient(ellipse, rgba(255,255,255,0.75) 0%, rgba(56,189,248,0) 70%); border-radius: 50%; filter: blur(1px);"></div>

      <svg viewBox="0 0 100 100" width="56" height="56" class="overflow-visible">
        <!-- Hull (Weathered Merchant Cargo Vessel) -->
        <path d="M 50 12 C 65 28 66 74 50 92 C 34 74 35 28 50 12 Z" fill="#2d1b09" stroke="#1c1917" stroke-width="2.5" />
        
        <!-- Cargo Deck Planking -->
        <line x1="50" y1="22" x2="50" y2="82" stroke="#78350f" stroke-width="1.2" />

        <!-- Cargo Crates / Barrels in Cargo Hold -->
        <rect x="42" y="34" width="16" height="12" fill="#854d0e" stroke="#451a03" stroke-width="1.2" rx="1" />
        <rect x="44" y="50" width="12" height="11" fill="#a16207" stroke="#451a03" stroke-width="1.2" rx="1" />
        
        <!-- Cargo cross-strapping ropes -->
        <line x1="42" y1="34" x2="58" y2="46" stroke="#ca8a04" stroke-width="0.8" />
        <line x1="42" y1="46" x2="58" y2="34" stroke="#ca8a04" stroke-width="0.8" />
        
        <!-- Barrels on side decks -->
        <circle cx="40" cy="64" r="3.2" fill="#713f12" stroke="#1c1917" stroke-width="0.8" />
        <circle cx="60" cy="64" r="3.2" fill="#713f12" stroke="#1c1917" stroke-width="0.8" />

        <!-- Mast & Crossbeam -->
        <line x1="36" y1="30" x2="64" y2="30" stroke="#1c1917" stroke-width="2" stroke-linecap="round" />
        <circle cx="50" cy="30" r="2.5" fill="#f59e0b" />
        <line x1="50" y1="30" x2="50" y2="10" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" />

        <!-- Supplies Flag: fluttering to starboard with Crate/Cross Emblem -->
        <path d="M 51 10 Q 66 6 82 11 L 80 26 Q 65 21 51 25 Z" fill="#0284c7" stroke="#38bdf8" stroke-width="0.8" />
        <!-- Supply symbol on flag (Gold Supply Crate with Red Cross/Straps) -->
        <rect x="58" y="13" width="12" height="9" fill="#fbbf24" stroke="#78350f" stroke-width="0.8" rx="0.8" />
        <line x1="64" y1="13" x2="64" y2="22" stroke="#dc2626" stroke-width="1" />
        <line x1="58" y1="17.5" x2="70" y2="17.5" stroke="#dc2626" stroke-width="1" />
      </svg>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'supply-ship-icon',
    iconSize: [56, 56],
    iconAnchor: [28, 28],
  });
}

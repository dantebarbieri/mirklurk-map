// Game rules ported from Mirklurk 0.8.1.5 (decompiled GML). References name the source entry.

/** Zone (room) edge in game units; tiles are 16 units, so 160 tiles per side. */
export const ROOM = 2560;
export const TILE = 16;
export const TILES = ROOM / TILE;
export const GRID = 5;

/** Area types: global.areaType / worldGrid values (gml_Object_obj_menu_Alarm_8). */
export const Area = {
  Fort: 0,
  CommonBog: 1,
  WitheredMire: 2,
  DrownedFen: 3,
  BrokenFen: 4,
  SavageMirk: 5,
  Ruins: 22,
  RiftMire: 23,
  VastWaters: 100,
} as const;

/** Special solid `index` values (gml_Object_manager_area_Alarm_2 / Alarm_6). */
export const SolidId = {
  Boat: -3000,
  Fort: -2997,
  Camp: -2996,
  Hideout: -2995,
  Library: -2994,
  LibraryShelf: -2993,
  Lair: -2992,
  Hut: -2990,
  Shipwreck: -2989,
} as const;

/** Interior area types reached through a solid's transPoint[0]. */
export const INTERIOR_NAMES: Record<number, string> = {
  10: "Cave",
  11: "Large cave",
  12: "Cave",
  20: "Ruin",
  21: "Ruin cellar",
  24: "Rift depths I",
  25: "Rift depths II",
  26: "Rift depths III",
  30: "Undercroft",
  31: "Bhato's hideout",
  32: "Fort interior",
  33: "Library",
  34: "Gurb-Gurb's hut",
  35: "Shipwreck",
};

/** Landmark buildings, named after who lives there (Bestiary.ini) or the game's own map label. */
export const LANDMARK_NAMES: Record<number, string> = {
  [SolidId.Fort]: "Fort Solid",
  [SolidId.Camp]: "Camp",
  [SolidId.Hideout]: "Bhato's hideout",
  [SolidId.Library]: "Library",
  [SolidId.Lair]: "Scaal's lair",
  [SolidId.Hut]: "Gurb-Gurb's hut",
  [SolidId.Shipwreck]: "Ihar's shipwreck",
  [SolidId.Boat]: "Boat",
};

/** Beings that the game treats as essential (is_essential in scr_ai_related) — the NPCs. */
export const NPC_BEINGS = new Set([5, 6, 8, 12, 19, 20, 26, 33, 34]);

/** Water/elevation thresholds (gml_Object_databank_Create_0). */
export const Thresh = { deep: -0.4, water: -0.3, shallow: -0.2, dry: 0.195, mountain: 0.2 } as const;

export const gridpos = (v: number) => Math.max(0, v) & ~15;
export const centerpos = (v: number) => (Math.max(0, v) & ~15) + 8;
export const tileIndex = (data: number) => data & 0x7ffff;

/** Water1 tile present (tile_is_water). */
export const isWaterTile = (water1: number) => tileIndex(water1) > 0;
/** Lower-layer sand (tile_is_sand / tile_to_enum "Lower" == 4). */
export function isSandTile(lower: number): boolean {
  const t = tileIndex(lower);
  return (t >= 1 && t <= 3) || (t >= 80 && t < 96);
}
/** Slope tile (tile_is_slope). */
export function isSlopeTile(s1: number, s2: number): boolean {
  const a = tileIndex(s1);
  if (a <= 0) return false;
  if (a !== 53) return true;
  const b = tileIndex(s2);
  return b > 0 && b !== 53;
}

/** Weight of each gridpos(irandom_range(lo, hi)) outcome: how many integers floor to it. */
export function axisWeights(lo: number, hi: number): Map<number, number> {
  const m = new Map<number, number>();
  for (let v = lo; v <= hi; v++) {
    const g = gridpos(v);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Outcomes of gridpos(half + irandom_range(-16, 16) * step), as used for the quest buildings. */
export function centeredLattice(step: number): Map<number, number> {
  const m = new Map<number, number>();
  for (let k = -16; k <= 16; k++) {
    const g = gridpos(ROOM / 2 + k * step);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

export interface Placement {
  /** Axis distribution of the sprite anchor (x and y use the same one). */
  axis: Map<number, number>;
  /** Entrance offset from the anchor (transPoint[1], transPoint[2]). */
  door: [number, number];
  sprite: string;
}

/** How each late-placed landmark picks its anchor (manager_area Alarm_2 / Alarm_6). */
export const PLACEMENT = {
  hideout: { axis: centeredLattice(16), door: [24, -8], sprite: "spr_built_48x32" },
  library: { axis: centeredLattice(32), door: [40, -8], sprite: "spr_building_80x96" },
  lair: { axis: centeredLattice(10), door: [72, -8], sprite: "spr_building_128x96" },
  hut: { axis: axisWeights(120, ROOM - 48), door: [56, -8], sprite: "spr_building_80x80" },
  shipwreck: { axis: axisWeights(256, ROOM - 256), door: [72, -8], sprite: "spr_building_128x64" },
} satisfies Record<string, Placement>;

/** Attempts made by Alarm_6 per zone entry before giving up on the shipwreck. */
export const SHIPWRECK_TRIES = 1280;

/**
 * Per-entry shipwreck chance for a Broken Fen whose terrain has not been generated yet.
 * The only generated Broken Fen we sampled had 138 valid anchor tiles (0.84% per try, 99.998% per
 * entry); every other generated zone we checked still reached 95%+. 99% is a conservative stand-in.
 */
export const SHIPWRECK_UNEXPLORED_CHANCE = 0.99;

/**
 * Shipwreck site test (Alarm_6): not water at (x, y-16), water at (x-16, y-16), sand at (x, y-32),
 * not water at (x+128, y-16). Works in tile coordinates of the anchor.
 */
export function shipwreckSiteOk(water1: Uint32Array, lower: Uint32Array, tx: number, ty: number): boolean {
  const at = (a: Uint32Array, x: number, y: number) => (x >= 0 && y >= 0 && x < TILES && y < TILES ? a[y * TILES + x] : 0);
  return !isWaterTile(at(water1, tx, ty - 1)) &&
    isWaterTile(at(water1, tx - 1, ty - 1)) &&
    isSandTile(at(lower, tx, ty - 2)) &&
    !isWaterTile(at(water1, tx + 8, ty - 1));
}

/** The fort's reflection through the grid centre (Alarm_8: riftQuestArea). */
export const reflect = (x: number, y: number): [number, number] => [GRID - 1 - x, GRID - 1 - y];

/** Map coordinate label as the game prints it (textf_array_to_mapcoord): "C,2". */
export const coordLabel = (x: number, y: number) => `${"ABCDE"[x] ?? "?"},${y + 1}`;

/** Outdoor area types (area_is_outside). */
export const isOutside = (t: number) => [0, 1, 2, 3, 4, 5, 22, 23, 100].includes(t);

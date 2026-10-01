import manifest from "./artdata.json" with { type: "json" };
import { tileIndex } from "./rules.ts";

export interface Tileset {
  file: string;
  width: number;
  height: number;
  columns: number;
  borderX: number;
  borderY: number;
  frames: number[];
}

export interface Sprite {
  file: string;
  w: number;
  h: number;
  ox: number;
  oy: number;
  frames: number;
}

export interface TileLayer {
  name: string;
  tileset: string;
  depth: number;
}

export const ART: {
  version: string;
  tilesets: Record<string, Tileset>;
  sprites: Record<string, Sprite>;
  rooms: Record<string, TileLayer[]>;
} = manifest;

/** Room defaults plus manager_area Alarm_2's tileset substitutions. */
export function areaLayers(kind: number): TileLayer[] {
  const room: Record<number, string> = {
    30: "rm_basement_clay",
    31: "rm_hideout_ranger",
    32: "rm_fortsolid",
    33: "rm_library",
    34: "rm_hut_gurb",
    35: "rm_shipwreck",
  };
  const override: Record<string, string> = { EffWater: "ts_effects_water" };
  if ([10, 11, 12].includes(kind)) override.Dungeon = "ts_cave";
  else if ([30, 32].includes(kind)) {
    override.Dungeon = override.OnTop = override.EffWater = "ts_castle";
  } else if ([20, 21, 33].includes(kind)) {
    override.Dungeon = "ts_ruin";
    override.OnTop = "ts_ruin_top";
  } else if ([24, 25, 26].includes(kind)) override.Dungeon = "ts_riftworld";
  return ART.rooms[room[kind] ?? "rm_world"].map((l) => ({ ...l, tileset: override[l.name] ?? l.tileset }));
}

export function tileSource(tileset: Tileset, data: number): [number, number] | null {
  const index = tileIndex(data);
  if (index === 0) return null;
  const frame = tileset.frames[index];
  if (frame === undefined) throw new Error(`Tile ${index} is outside ${tileset.file}`);
  return [
    frame % tileset.columns * (16 + 2 * tileset.borderX) + tileset.borderX,
    Math.floor(frame / tileset.columns) * (16 + 2 * tileset.borderY) + tileset.borderY,
  ];
}

/** Canvas transform around a tile's centre: mirror/flip, then clockwise quarter-turn. */
export function tileTransform(data: number): [number, number, number, number] {
  const x = data & 0x10000000 ? -1 : 1;
  const y = data & 0x20000000 ? -1 : 1;
  return data & 0x40000000 ? [0, x, -y, 0] : [x, 0, 0, y];
}

/** Pick a prefiltered level that will only be reduced, never magnified. */
export function mipLevel(pixelsPerGamePixel: number, levels: number): number {
  return Math.max(0, Math.min(levels - 1, Math.floor(Math.log2(1 / pixelsPerGamePixel))));
}

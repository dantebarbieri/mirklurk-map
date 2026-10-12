// Save editor: which tiles of an area can take the player or a new creature. The game's own checks (tile_is_solid, tile_is_pit and
// tile_is_water in gml_GlobalScript_scr_tiles_autotiling, tile_is_free on the pathfinding grid) block Data 1 (solid) and 3 (pit) and
// water (any Water1 tile); Data 2 is only shade under a canopy. Anything already standing there, on ground or water, takes the
// tile. Creatures go only on free ground; you can also go into water (raft.ts says how deep it is and what happens to a raft).

import { tileIndex, TILES } from "../rules.ts";

export const Ground = { Free: 0, Water: 1, Blocked: 2, Taken: 3 } as const;
export type GroundKind = (typeof Ground)[keyof typeof Ground];

export const GROUND_TEXT: Record<GroundKind, string> = {
  [Ground.Free]: "free ground",
  [Ground.Water]: "water",
  [Ground.Blocked]: "a wall, cliff or pit",
  [Ground.Taken]: "already taken",
};

/** A pixel rectangle [left, top, right, bottom], inclusive, of something standing in the area. */
export type Box = [number, number, number, number];

/** A tile's own rectangle, for things that stand on one tile. */
export const tileBox = (x: number, y: number): Box => {
  const l = Math.floor(x / 16) * 16, t = Math.floor(y / 16) * 16;
  return [l, t, l + 15, t + 15];
};

/** One GroundKind per tile, row-major. */
export function groundMap(data: Uint32Array | undefined, water1: Uint32Array | undefined, taken: Box[]): Uint8Array {
  const out = new Uint8Array(TILES * TILES);
  for (let i = 0; i < out.length; i++) {
    const d = data ? tileIndex(data[i]) : 0;
    out[i] = d === 1 || d === 3 ? Ground.Blocked : water1 && tileIndex(water1[i]) > 0 ? Ground.Water : Ground.Free;
  }
  for (const [l, t, r, b] of taken) {
    const x0 = Math.max(0, Math.floor(l / 16)), x1 = Math.min(TILES - 1, Math.floor(r / 16));
    const y0 = Math.max(0, Math.floor(t / 16)), y1 = Math.min(TILES - 1, Math.floor(b / 16));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) if (out[y * TILES + x] !== Ground.Blocked) out[y * TILES + x] = Ground.Taken;
    }
  }
  return out;
}

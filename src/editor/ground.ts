// Save editor: which tiles of an area can take the player or a new creature. The game's own checks (tile_is_solid, tile_is_pit and
// tile_is_water in gml_GlobalScript_scr_tiles_autotiling, tile_is_free on the pathfinding grid) block Data 1 (solid) and 3 (pit) and
// water (any Water1 tile); Data 2 is only shade under a canopy. Anything already standing there, on ground or water, takes the
// tile. Creatures go only on free ground; you can also go into water (raft.ts says how deep it is and what happens to a raft).
// Inside, the room around the walls is open ground too (quest rooms such as the Undercroft are mostly that), so you only go where a
// way out can be walked to.

import { tileIndex, TILES } from "../rules.ts";

export const Ground = { Free: 0, Water: 1, Blocked: 2, Taken: 3, Shut: 4 } as const;
export type GroundKind = (typeof Ground)[keyof typeof Ground];

export const GROUND_TEXT: Record<GroundKind, string> = {
  [Ground.Free]: "free ground",
  [Ground.Water]: "water",
  [Ground.Blocked]: "a wall, cliff or pit",
  [Ground.Taken]: "already taken",
  [Ground.Shut]: "beyond the walls, where no way out can be reached",
};

/** A pixel rectangle [left, top, right, bottom], inclusive, of something standing in the area. */
export type Box = [number, number, number, number];

/** A tile's own rectangle, for things that stand on one tile. */
export const tileBox = (x: number, y: number): Box => {
  const l = Math.floor(x / 16) * 16, t = Math.floor(y / 16) * 16;
  return [l, t, l + 15, t + 15];
};

const isWall = (d: number) => d === 1 || d === 3;

/**
 * The tiles that can be walked to, side by side, from `seeds` (tile indices, such as where an interior's ways out and stairs are
 * used) without crossing a wall or pit, as 1s, row-major. Undefined when there is no Data layer, no seed, or the walk reaches the
 * edge of the room, so that nothing encloses it.
 */
export function reachable(data: Uint32Array | undefined, seeds: number[]): Uint8Array | undefined {
  if (!data) return undefined;
  const seen = new Uint8Array(TILES * TILES);
  const stack: number[] = [];
  const visit = (x: number, y: number) => {
    const i = y * TILES + x;
    if (x < 0 || y < 0 || x >= TILES || y >= TILES || seen[i] || isWall(tileIndex(data[i]))) return;
    seen[i] = 1;
    stack.push(i);
  };
  // A door's own tile is often part of its wall, so the tiles beside it count as well.
  for (const s of seeds) {
    const x = s % TILES, y = Math.floor(s / TILES);
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) visit(x + dx, y + dy);
  }
  if (!stack.length) return undefined;
  while (stack.length) {
    const i = stack.pop()!, x = i % TILES, y = (i - x) / TILES;
    if (x === 0 || y === 0 || x === TILES - 1 || y === TILES - 1) return undefined;
    visit(x + 1, y), visit(x - 1, y), visit(x, y + 1), visit(x, y - 1);
  }
  return seen;
}

/** One GroundKind per tile, row-major. Where `reach` (from `reachable`) is 0, open tiles are Shut. */
export function groundMap(
  data: Uint32Array | undefined,
  water1: Uint32Array | undefined,
  taken: Box[],
  reach?: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(TILES * TILES);
  for (let i = 0; i < out.length; i++) {
    out[i] = data && isWall(tileIndex(data[i]))
      ? Ground.Blocked
      : reach && !reach[i]
      ? Ground.Shut
      : water1 && tileIndex(water1[i]) > 0
      ? Ground.Water
      : Ground.Free;
  }
  for (const [l, t, r, b] of taken) {
    const x0 = Math.max(0, Math.floor(l / 16)), x1 = Math.min(TILES - 1, Math.floor(r / 16));
    const y0 = Math.max(0, Math.floor(t / 16)), y1 = Math.min(TILES - 1, Math.floor(b / 16));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * TILES + x;
        if (out[i] !== Ground.Blocked && out[i] !== Ground.Shut) out[i] = Ground.Taken;
      }
    }
  }
  return out;
}

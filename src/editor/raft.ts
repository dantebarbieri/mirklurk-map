// Save editor: water and rafts, for moving yourself. The game never saves the raft you stand on with its zone: save_start_save marks
// it destroyOnSave and sets the player's ensureRaft, and on load player_raft_ensure makes a finished raft (a station of index 171)
// under you again, wherever you are (gml_GlobalScript_scr_saveload, scr_basic_useful). A raft you left is a station in its zone's
// Stations.save. How deep you stand is tile_get_height (scr_tiles_movement); where a raft can go is rafting_possible_here
// (scr_pathfinding).

import { isSlopeTile, Thresh, tileIndex, TILES } from "../rules.ts";
import { isRec, movePlayer, type Rec } from "./edits.ts";

/** The finished raft's item and station index (Finish Raft). */
export const RAFT = 171;

/**
 * A finished raft standing on tile (tx, ty), as Finish Raft leaves the placed Raft Base (spr_placed_16x16_wider, frame 1) and
 * save_stations writes it.
 */
export function raftStation(tx: number, ty: number): Rec {
  return {
    sprite: "spr_placed_16x16_wider",
    pic: 1,
    blend: 0xffffff,
    x: tx * 16 + 8,
    y: ty * 16 + 8,
    index: RAFT,
    activeTurns: 0,
    localItem: -4,
    status: -200,
  };
}

export const isRaft = (s: unknown): s is Rec => isRec(s) && s.index === RAFT;

function stationList(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) throw new Error("Stations.save is not a list");
  return raw;
}

/** Leaves a finished raft on tile (tx, ty) of a zone's Stations.save. */
export function addRaft(stations: unknown, tx: number, ty: number) {
  stationList(stations).push(raftStation(tx, ty));
}

/** Takes the raft saved as `same` (its JSON when it was picked) out of a zone's Stations.save. */
export function takeRaft(stations: unknown, same: string): Rec {
  const list = stationList(stations);
  const i = list.findIndex((s) => isRaft(s) && JSON.stringify(s) === same);
  if (i < 0) throw new Error("That raft is no longer there");
  return list.splice(i, 1)[0] as Rec;
}

/** You stand on a raft: the game makes one under you when it loads the save. */
export const onRaft = (p: Rec) => p.ensureRaft === true;

export interface RaftPlan {
  /** You were on a raft when the move was chosen; if that is no longer so, the move no longer applies. */
  from: boolean;
  /** You stand on a raft after it. */
  to: boolean;
  /** Where you stood (areaX, areaY, xx, yy) when the raft you leave there was chosen; the move no longer applies elsewhere. */
  at?: [number, number, number, number];
}

/** Moves you (movePlayer) on a raft or not. Returns whether anything changed. */
export function moveWithRaft(p: Rec, zoneX: number, zoneY: number, tileX: number, tileY: number, plan: RaftPlan): boolean {
  if (onRaft(p) !== plan.from) throw new Error(plan.from ? "You are no longer on a raft" : "You are on a raft now");
  const where = () => [p.areaX, p.areaY, p.xx, p.yy];
  if (plan.at && where().some((v, i) => v !== plan.at![i])) throw new Error("You have moved since");
  const before = [...where(), p.areaType, onRaft(p)].join();
  movePlayer(p, zoneX, zoneY, tileX, tileY);
  if (plan.to || "ensureRaft" in p) p.ensureRaft = plan.to;
  return [...where(), p.areaType, onRaft(p)].join() !== before;
}

/** The tile layers and heights (Ygrid.save) of an outdoor zone that say how deep its water is; any may be missing. */
export interface WaterLayers {
  layers: Partial<Record<(typeof WATER_LAYERS)[number], Uint32Array>>;
  heights?: Float32Array;
}
export const WATER_LAYERS = ["Water1", "Water2", "Water3", "Hinderance", "Grass", "OnLower", "Slopes1", "Slopes2"] as const;

const at = (w: WaterLayers, layer: (typeof WATER_LAYERS)[number], i: number) => {
  const a = w.layers[layer];
  return a ? tileIndex(a[i]) : 0;
};
/** Grass tiles 24–31 (tile_to_enum "Grass" 5000) stand up out of the water, so a raft cannot go there. */
const isReeds = (grass: number) => grass >= 24 && grass < 32;

/**
 * How deep you stand on tile i of an outdoor zone without a raft: tile_get_height. Slopes, hinderances, reeds and goo raise you;
 * otherwise each water layer deepens it, and the deep water layer more where the ground (Ygrid) dips below the deep threshold.
 */
export function tileHeight(w: WaterLayers, i: number): number {
  const raw = (layer: "Slopes1" | "Slopes2") => w.layers[layer]?.[i] ?? 0;
  if (isSlopeTile(raw("Slopes1"), raw("Slopes2"))) return -3;
  const ht = at(w, "Hinderance", i), ground = at(w, "OnLower", i);
  if (ht > 0 && ht < 50) return ht < 20 ? -6 : -4;
  if (isReeds(at(w, "Grass", i))) return -3;
  if (ht >= 120 && ht < 130) return -2;
  // Goo (tile_is_goo: OnLower 4–6 and 64–79).
  if ((ground >= 4 && ground <= 6) || (ground >= 64 && ground < 80)) return 2;
  let height = 0;
  if (at(w, "Water1", i) > 0) height += 1;
  if (at(w, "Water2", i) > 0) height += 3;
  if (at(w, "Water3", i) > 0) {
    height += 4;
    const hole = Thresh.deep - 0.05, y = w.heights?.[i];
    if (y !== undefined && y < hole) height += Math.abs(y - hole) * 100;
    height = Math.min(height, 28);
  }
  // The game's -2 for "Lower" tiles of kind 2 never applies: tile_to_enum gives no Lower tile that kind.
  return Math.round(height);
}

/** From this height up you swim, using stamina each turn, and drown once it runs out (player_set_ae_water, obj_player Alarm_0). */
export const SWIM_HEIGHT = 14;
/** From this height up the water reaches your torso (player_set_ae_water). */
const CHEST_HEIGHT = 8;

/** How deep water of this height is, in a few words. */
export function waterKind(height: number): string {
  return height >= SWIM_HEIGHT ? "deep water" : height >= CHEST_HEIGHT ? "chest-deep water" : "shallow water";
}

/** What standing in water of this height means for you. */
export function waterEffect(height: number): string {
  return height >= SWIM_HEIGHT
    ? "you would swim, which costs stamina every turn, and drown once it runs out"
    : height >= CHEST_HEIGHT
    ? "you would be soaked"
    : "you would get wet";
}

/** What standing in water of this height means, for a warning. */
export const waterText = (height: number) => `${waterKind(height)}: ${waterEffect(height)}`;

/**
 * Whether a raft can be on tile i: rafting_possible_here, which the raft's pathfinding checks for every step. The ground must lie
 * at or below the water threshold (Ygrid), with no reeds and no hinderance below 70.
 */
export function raftable(w: WaterLayers, i: number): boolean {
  if (!w.heights) return false;
  const ht = at(w, "Hinderance", i);
  return w.heights[i] <= Thresh.water && !isReeds(at(w, "Grass", i)) && (ht === 0 || ht >= 70);
}

/** raftable for every tile of the zone, row-major. */
export function raftMap(w: WaterLayers): Uint8Array {
  const out = new Uint8Array(TILES * TILES);
  for (let i = 0; i < out.length; i++) out[i] = raftable(w, i) ? 1 : 0;
  return out;
}

/** Whether each tile of the zone has water (tile_is_water: any Water1 tile), row-major. */
export function wetMap(w: WaterLayers): Uint8Array {
  const out = new Uint8Array(TILES * TILES), w1 = w.layers.Water1;
  if (w1) { for (let i = 0; i < out.length; i++) out[i] = tileIndex(w1[i]) > 0 ? 1 : 0; }
  return out;
}

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const AROUND = [...SIDES, [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const inZone = (x: number, y: number) => x >= 0 && y >= 0 && x < TILES && y < TILES;

/**
 * Where your raft docks when you leave it for tile `to`, which a raft cannot reach. The land you go to is the dry ground (wet 0)
 * joined to `to`, side by side or corner to corner; in water, `to` with the dry ground it touches. The raft drifts from tile `from`
 * (in this zone's tile coordinates, beyond 0–159 when it comes from another zone) straight towards `to`, passing over any other
 * island and the shallows around it, until its way first reaches that land. It docks on the free raft water (raft and free 1)
 * nearest that point through the water beside that land (so never across it): fewest steps, then straightest, then nearest
 * `from`. Undefined when no free raft water can be reached from that land in this zone.
 */
export function dockTile(raft: Uint8Array, wet: Uint8Array, free: Uint8Array, to: number, from: [number, number]): number | undefined {
  const land = new Uint8Array(TILES * TILES);
  land[to] = 1;
  const stack = [to];
  while (stack.length) {
    const i = stack.pop()!, x = i % TILES, y = (i - x) / TILES;
    for (const [dx, dy] of AROUND) {
      const nx = x + dx, ny = y + dy, j = ny * TILES + nx;
      if (!inZone(nx, ny) || land[j] || wet[j]) continue;
      land[j] = 1;
      stack.push(j);
    }
  }
  const tx = to % TILES, ty = (to - tx) / TILES, [fx, fy] = from;
  let hit = to;
  const steps = Math.max(Math.abs(tx - fx), Math.abs(ty - fy));
  for (let s = 0; s < steps; s++) {
    const x = Math.round(fx + ((tx - fx) * s) / steps), y = Math.round(fy + ((ty - fy) * s) / steps);
    if (inZone(x, y) && land[y * TILES + x]) {
      hit = y * TILES + x;
      break;
    }
  }
  const hx = hit % TILES, hy = (hit - hx) / TILES;
  // Outwards from where it reached the land, a ring of steps at a time, never over that land.
  const search = (through: (j: number) => boolean): number | undefined => {
    const seen = new Uint8Array(TILES * TILES);
    seen[hit] = 1;
    let ring = [hit];
    while (ring.length) {
      const next: number[] = [];
      let best: number | undefined, bestHit = Infinity, bestFrom = Infinity;
      for (const i of ring) {
        const x = i % TILES, y = (i - x) / TILES;
        for (const [dx, dy] of AROUND) {
          const nx = x + dx, ny = y + dy, j = ny * TILES + nx;
          if (!inZone(nx, ny) || seen[j] || land[j] || !through(j)) continue;
          seen[j] = 1;
          next.push(j);
          if (!raft[j] || !free[j]) continue;
          const dHit = (nx - hx) ** 2 + (ny - hy) ** 2, dFrom = (nx - fx) ** 2 + (ny - fy) ** 2;
          if (dHit < bestHit || (dHit === bestHit && (dFrom < bestFrom || (dFrom === bestFrom && j < best!)))) {
            best = j, bestHit = dHit, bestFrom = dFrom;
          }
        }
      }
      if (best !== undefined) return best;
      ring = next;
    }
  };
  // Through the water; only if none of it leads to raft water, over other ground as well.
  return search((j) => wet[j] === 1) ?? search(() => true);
}

// Live-mode guess of where the player went right after a save, from the game's own transition rules.
//
// The game saves the moment a transition starts (save_start_save): when the border "travel" button is clicked
// (gml_Object_UI_Draw_64) and when an entrance or way out is used (targetAction 4 in gml_Object_obj_player_Step_0).
// So a save at a border or beside a door usually means the player is already on the other side.

import { centerpos, GRID, isOutside, ROOM } from "./rules.ts";
import type { PlayerSave } from "./save.ts";
import type { Interior, World } from "./world.ts";

export interface Estimate {
  zone: [number, number];
  /** The interior the player is guessed to be in; undefined outdoors or when it has not been saved yet. */
  interior?: Interior;
  /** The outdoor entrance used, on the zone map; set with `interior` (rift depths have no outdoor `at`). */
  entrance?: [number, number];
  inside: boolean;
  /** In the interior's coordinates when `interior` is set, else in the zone's (the entrance spot when inside). */
  pos: [number, number];
  basis: string;
}

/** How far from a door's interaction point the player can stand when using it (they walk next to the solid). */
export const DOOR_REACH = 48;

const DIRS = [
  ["west", -1, 0],
  ["east", 1, 0],
  ["north", 0, -1],
  ["south", 0, 1],
] as const;

/** UI_Draw_64 offers travel at x ≤ 16, x ≥ room_width − 16, y ≤ 48 or y ≥ room_height − 48, checked in that order. */
export function borderSide(x: number, y: number): (typeof DIRS)[number] | undefined {
  if (x <= 16) return DIRS[0];
  if (x >= ROOM - 16) return DIRS[1];
  if (y <= 48) return DIRS[2];
  if (y >= ROOM - 48) return DIRS[3];
}

/** Arrival spot after crossing a border: sendX/sendY from UI_Draw_64, plus manager_area Alarm_2's +16 unless sent to x = 8 or x = room_width − 8. */
export function arrival(x: number, y: number, side: (typeof DIRS)[number]): [number, number] {
  if (side[0] === "east") return [8, y];
  if (side[0] === "west") return [ROOM - 8, y];
  return side[0] === "south" ? [x, 40 + 16] : [x, ROOM - 24 + 16];
}

const dist = (a: [number, number], x: number, y: number) => Math.hypot(a[0] - x, a[1] - y);

function nearestDoor(solids: { transPoint: number[] | null }[], pos: [number, number]) {
  let best: number[] | undefined, bestD = DOOR_REACH;
  for (const s of solids) {
    const tp = s.transPoint;
    if (!tp || tp.length < 5) continue;
    const d = dist(pos, tp[1], tp[2]);
    if (d <= bestD) [best, bestD] = [tp, d];
  }
  return best;
}

function currentInterior(world: World, p: PlayerSave): Interior | undefined {
  return world.interiors.find((it) =>
    it.kind === p.area.type && it.zone[0] === p.area.x && it.zone[1] === p.area.y &&
    (it.at[0] === -1 || (it.at[0] === p.entrance[0] && it.at[1] === p.entrance[1]))
  );
}

/** Where `p` most likely went next, or null when its save does not sit at a transition. */
export function inferMove(world: World, p: PlayerSave): Estimate | null {
  const [ax, ay] = [p.area.x, p.area.y];
  if (isOutside(p.area.type)) {
    const zone = world.zones[ay]?.[ax];
    const door = zone && nearestDoor(zone.solids, p.pos);
    if (door) {
      // obj_screenfader Step_0: entranceX/Y = centerpos(interactX/Y), then the player is moved to sendX/sendY.
      const at: [number, number] = [centerpos(door[1]), centerpos(door[2])];
      const interior = world.interiors.find((it) => it.zone[0] === ax && it.zone[1] === ay && it.at[0] === at[0] && it.at[1] === at[1]);
      return interior
        ? { zone: [ax, ay], interior, entrance: at, inside: true, pos: [door[3], door[4]], basis: "saved beside this entrance" }
        : { zone: [ax, ay], inside: true, pos: at, basis: "saved beside this entrance (inside not saved yet)" };
    }
    const side = borderSide(p.pos[0], p.pos[1]);
    if (!side) return null;
    const [nx, ny] = [ax + side[1], ay + side[2]];
    if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) return null;
    return { zone: [nx, ny], inside: false, pos: arrival(p.pos[0], p.pos[1], side), basis: `saved at the ${side[0]} border` };
  }
  const here = currentInterior(world, p);
  const door = here && nearestDoor(here.solids, p.pos);
  if (!here || !door) return null;
  // Alarm_3 saves on first entering a quest room, with its way out made at the player's feet (16 below; the shipwreck's on the spot).
  const k = here.kind ?? 0;
  if (k >= 30 && k <= 35 && p.pos[0] === door[1] && p.pos[1] === door[2] - (k === 35 ? 0 : 16)) return null;
  if (isOutside(door[0])) {
    // The way out sends the player to the entrance's interaction point; Alarm_2 then adds 16 (x is never 8 there).
    return { zone: here.zone, inside: false, pos: [door[3], door[4] + 16], basis: "saved beside the way out" };
  }
  const up = here.parent?.kind === door[0] ? here.parent : undefined;
  const to = up ?? world.interiors.find((it) => it.parent === here && it.kind === door[0]);
  return to
    ? { zone: here.zone, interior: to, entrance: p.entrance, inside: true, pos: [door[3], door[4]], basis: "saved beside the stairs" }
    : null;
}

const sameArea = (e: Estimate, world: World, p: PlayerSave) =>
  e.zone[0] === p.area.x && e.zone[1] === p.area.y && e.inside === !isOutside(p.area.type) &&
  (!e.inside || e.interior === currentInterior(world, p));

/**
 * The live estimate for `world.player`. `prev` is the previous live snapshot: when it already predicted this save's area
 * and the player is still where it said they would arrive, this save is the game's own arrival save (new-area generation,
 * manager_area Alarm_2/Alarm_3), not another departure.
 */
export function estimatePlayer(world: World, prev?: PlayerSave): Estimate | null {
  const p = world.player;
  const before = prev && inferMove(world, prev);
  if (before && (before.interior || !before.inside) && sameArea(before, world, p) && dist(before.pos, p.pos[0], p.pos[1]) <= 16) {
    return null;
  }
  // Without a previous snapshot, a save exactly on an arrival spot is most likely the new zone's own save: trust it.
  const [x, y] = p.pos;
  if (!prev && isOutside(p.area.type) && (x === 8 || x === ROOM - 8 || y === ROOM - 8)) return null;
  return inferMove(world, p);
}

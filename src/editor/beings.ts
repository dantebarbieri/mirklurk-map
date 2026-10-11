// Save editor: creatures in an area's Beings.save (save_beings/load_beings in gml_GlobalScript_scr_saveload). The game writes these
// thirteen keys for every being and load_beings reads them back, then being_initiate fills in the species' stats without touching the
// saved hit points, so a new creature needs its fresh hit-point grid, armor included.

import { BEINGS, freshHealth } from "../bestiary.ts";
import { BEING_NAMES } from "../gamedata.ts";
import { NPC_BEINGS, TILES } from "../rules.ts";
import { isRec, type Rec } from "./edits.ts";

/** Scaal is the main quest's boss; a second one would not be part of the quest. */
const SCAAL = 22;

/** NPCs and Scaal belong to quests and are never spawned. */
export const spawnable = (index: number) => !!BEINGS[index] && !NPC_BEINGS.has(index) && index !== SCAAL && !!BEING_NAMES[index];

/** Quest characters: deleting one can leave a quest waiting for someone who is gone. */
export const isQuestBeing = (index: number) => NPC_BEINGS.has(index) || index === SCAAL;

/** A creature as save_beings writes a fresh one standing on the centre of tile (tileX, tileY). */
export function newBeing(index: number, tileX: number, tileY: number): Rec {
  if (!spawnable(index)) throw new Error(`${BEING_NAMES[index] ?? `Being ${index}`} cannot be spawned`);
  if (![tileX, tileY].every((t) => Number.isInteger(t) && t >= 0 && t < TILES)) throw new Error("Tile is outside the area");
  const hpgrid = freshHealth(index)!;
  return {
    index,
    status: -200,
    state: 0,
    x: tileX * 16 + 8,
    y: tileY * 16 + 8,
    homeX: -4,
    homeY: -4,
    hpgrid,
    statusgrid: hpgrid.map((row) => row.map(() => [])),
    localStage: -1,
    stuckArrows: [],
    turnLimit: -4,
    turnCounter: 0,
  };
}

export function spawnBeing(beings: unknown[], index: number, tileX: number, tileY: number): Rec {
  const being = newBeing(index, tileX, tileY);
  beings.push(being);
  return being;
}

/** Removes the being at `i` of Beings.save's list; returns it. */
export function deleteBeing(beings: unknown[], i: number): Rec {
  const being = beings[i];
  if (!isRec(being)) throw new Error("No creature there");
  beings.splice(i, 1);
  return being;
}

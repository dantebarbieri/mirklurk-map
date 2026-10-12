// Save editor: creatures in an area's Beings.save (save_beings/load_beings in gml_GlobalScript_scr_saveload). The game writes these
// thirteen keys for every being and load_beings reads them back, then being_initiate fills in the species' stats without touching the
// saved hit points, so a new creature needs its fresh hit-point grid, armor included.

import { BEINGS, freshHealth } from "../bestiary.ts";
import { BEING_NAMES } from "../gamedata.ts";
import { NPC_BEINGS, Thresh, TILES } from "../rules.ts";
import { isRec, type Rec } from "./edits.ts";
import { layerAt, tileHeight, type WaterLayers } from "./raft.ts";

/** Scaal is the main quest's boss; a second one would not be part of the quest. */
const SCAAL = 22;
/** The Dead Unwanted is Viend before he is revived: removing it can strand his quest, and a second one would be a second Viend. */
const DEAD_UNWANTED = 9;
const QUEST_BEINGS = new Set([...NPC_BEINGS, SCAAL, DEAD_UNWANTED]);

/** Quest characters (NPCs, the Dead Unwanted and Scaal) are never spawned. */
export const spawnable = (index: number) => !!BEINGS[index] && !QUEST_BEINGS.has(index) && !!BEING_NAMES[index];

/** Quest characters: deleting one can leave a quest waiting for someone who is gone. */
export const isQuestBeing = (index: number) => QUEST_BEINGS.has(index);

/** is_flyer (gml_GlobalScript_scr_ai_related): Dreadfly, Giant Gnat, Deathfly and Scaal fly over anything. */
const FLYERS = new Set([1, 2, 22, 25]);
/** is_swimmer: Mire Serpent, Mudfin and Razorfin live in the water. */
const SWIMMERS = new Set([4, 17, 24]);
/** size 0 in global.beingDB (gml_Object_databank_Alarm_3): small creatures, which cannot wade as deep. */
const SMALL = new Set([0, 1, 2, 7, 10, 11, 13, 17, 23, 24, 25, 27, 29, 30]);
const GIANT_SLUG = 0, MIRE_SERPENT = 4;

/** How a kind of creature gets about: what decides where it can be. */
export const habitat = (index: number): "flies" | "swims" | "walks" =>
  FLYERS.has(index) ? "flies" : SWIMMERS.has(index) ? "swims" : "walks";

/**
 * Why a creature of kind `index` cannot be on tile i of an area, or undefined when it can: tile_meets_classneeds
 * (gml_GlobalScript_scr_tiles_finders), which the game checks wherever a creature spawns or moves, and when it loads an area other
 * than straight from the menu, when it moves each creature to a tile within 8 that suits it, or removes it if none does. Flyers go
 * anywhere. Others keep off brambles, sharp ground and rift vines. Swimmers need water: the ground (Ygrid) at or below the water
 * threshold for a Mire Serpent, below halfway between the shallow and water thresholds for a Mudfin or Razorfin. Walkers wade, but
 * not where the ground lies at or below the deep threshold, or the water threshold for small ones; a Giant Slug keeps out of the
 * deeper water layer. Walls, pits and taken tiles are the caller's to check.
 */
export function habitatRefusal(index: number, w: WaterLayers, i: number, outside: boolean): string | undefined {
  const name = BEING_NAMES[index] ?? "This creature";
  if (FLYERS.has(index)) return undefined;
  const thorny = layerAt(w, "NatureData", i);
  if (thorny >= 1 && thorny <= 3) return `${name} cannot go on brambles, sharp ground or rift vines; only flyers can`;
  // Without heights the ground counts as dry.
  const y = w.heights?.[i] ?? 0;
  if (index === MIRE_SERPENT) return y > Thresh.water ? `${name} needs deep water` : undefined;
  if (SWIMMERS.has(index)) return y >= (Thresh.shallow + Thresh.water) / 2 ? `${name} needs water` : undefined;
  const height = tileHeight(w, i, outside);
  if (index === GIANT_SLUG) {
    return layerAt(w, "Water2", i) > 0 && height > 1 ? `The water is too deep for ${name}` : undefined;
  }
  // step_in_water_here: water, and not lifted out of it (by reeds, say).
  const wading = layerAt(w, "Water1", i) > 0 && height >= -1;
  if (wading && y <= (SMALL.has(index) ? Thresh.water : Thresh.deep)) return `The water is too deep for ${name}, which walks`;
}

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

/**
 * Removes the being at `i` of Beings.save's list and returns it. Given `same`, the being's JSON when it was picked, it removes the
 * being that still matches, nearest to `i`, so the removal can run again after an earlier change to the list was undone.
 */
export function deleteBeing(beings: unknown[], i: number, same?: string): Rec {
  let at = i;
  if (same !== undefined && JSON.stringify(beings[i]) !== same) {
    const matches = beings.flatMap((b, j) => JSON.stringify(b) === same ? [j] : []);
    if (!matches.length) throw new Error("That creature is no longer there");
    at = matches.reduce((best, j) => Math.abs(j - i) < Math.abs(best - i) ? j : best);
  }
  const being = beings[at];
  if (!isRec(being)) throw new Error("No creature there");
  beings.splice(at, 1);
  return being;
}

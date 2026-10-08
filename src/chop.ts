// Tree liveliness and harvest cost, ported from Mirklurk 0.8.1.5 (decompiled GML).
// Sources: tree harvest menu in gml_Object_UI_Draw_64, tree_initiate / tree_grow in scr_nature,
// loot drops in gml_Object_obj_tree_Step_0, chopMod values in gml_Object_databank_Alarm_1.

import type { Inventory } from "./inventory.ts";
import type { Tree } from "./save.ts";

/** Slots of a saved partArray entry (obj_tree treeParts). */
export const Part = { size: 11, parent: 16, depth: 21, life: 22 } as const;

/** global.NATDEAD (gml_Room_rm_int_Create): below this a part is dead, leafless and stops growing. */
export const NATDEAD = 0.33;

/** Nature indices (Nature.ini [Titles]). */
export const Nature = { Willow: 4, Brambles: 6, Cypress: 7, RiftVine: 13, Trollgnarl: 17, Elderwort: 20 } as const;

/** nature_is_tree: the species with a trunk and wood. */
export const isTree = (index: number) =>
  index === Nature.Willow || index === Nature.Cypress || index === Nature.Trollgnarl || index === Nature.Elderwort;

/** [TreeStuff] Fresh0–Fresh4 in UI.ini. */
export const FRESHNESS = ["Very Fresh", "Fresh", "Half Dead", "Mostly Dead", "Dead"] as const;

/** Every item with a chopMod (the tool bonus). 31 is "Unarmed", the bare-hands fallback. */
export const CHOP_TOOLS: Record<number, number> = {
  31: 1,
  159: 0.5,
  2: 1.25,
  3: 1.5,
  5: 1.5,
  6: 1.5,
  4: 1.6,
  10: 1.7,
  7: 1.75,
  9: 1.75,
  8: 2,
  11: 2,
  27: 3,
  184: 3,
  185: 3,
  188: 3,
  189: 3,
  28: 3.4,
  29: 4,
  30: 4.2,
};
export const UNARMED = 31;

/** The player's `actionPointsMax` (obj_player Create); the harvest menu refuses any part costing more. */
export const MAX_AP = 8;

/** GameMaker's round() rounds halves to even. */
export function roundGml(v: number): number {
  const r = Math.round(v);
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export interface Trunk {
  /** 0 (dead) to 1 (very fresh). */
  life: number;
  size: number;
  /** Index into FRESHNESS: 0 very fresh … 4 dead. */
  freshness: number;
  part: number[];
}

export const freshnessOf = (life: number) => Math.min(4, Math.max(0, roundGml(4 - 4 * life)));

/** The tree's root part (tree_initiate gives it parent -1; it is always saved first). */
export function trunkOf(tree: Tree): Trunk | undefined {
  const part = tree.parts?.find((b) => b[Part.parent] === -1);
  if (!part) return undefined;
  const life = part[Part.life];
  return { life, size: part[Part.size], freshness: freshnessOf(life), part };
}

/** The harvest menu's size label for a part (Twig, Branch, Thick Branch, Trunk, Stem). */
export function partLabel(species: number, part: number[]): string {
  const size = part[Part.size], trunk = part[Part.depth] === 0;
  if (!isTree(species)) return "Twig";
  if (species === Nature.Elderwort) return trunk ? "Stem" : size < 0.33 ? "Twig" : "Branch";
  if (trunk) return size < 0.2 ? "Branch" : size < 0.3 ? "Thick Branch" : "Trunk";
  return size < 0.2 ? "Twig" : size < 0.4 ? "Branch" : "Thick Branch";
}

/** Dryness divisor: drier (less alive) wood is much cheaper to cut. */
export const dryDivisor = (life: number) => roundGml(Math.max(0.1, 1 - life) * 10) * 0.5;

/** Action points the game charges to chop one part with a tool of this chopMod (before rounding). */
export function rawHarvestCost(species: number, part: number[], chopMod: number): number {
  const size = part[Part.size], trunk = part[Part.depth] === 0;
  let ap = 24 * size / dryDivisor(part[Part.life]);
  if (species === Nature.Elderwort) ap = trunk ? 8 * size : 4 * size;
  else if (isTree(species) && trunk) ap *= 1.33 + size;
  ap = Math.min(ap, 32);
  if (species === Nature.Cypress) ap *= 1.2;
  else if (species === Nature.Trollgnarl) ap *= 2;
  return ap / chopMod;
}

/** The harvest cost as the game shows and charges it: to the nearest 0.2 AP, at least 0.2. */
export const harvestCost = (species: number, part: number[], chopMod: number) =>
  Math.max(0.2, roundGml(rawHarvestCost(species, part, chopMod) * 5) / 5);

/** The game prints whole costs without decimals and others with one. */
export const formatAp = (ap: number) => (Number.isInteger(ap) ? `${ap}` : ap.toFixed(1));

/** sprite_get_height of each species' trunk sprite. */
const TRUNK_HEIGHT: Record<number, number> = { [Nature.Willow]: 80, [Nature.Cypress]: 160, [Nature.Trollgnarl]: 60 };
/** Trunk wood item by species: [size < 0.2, otherwise]. */
const TRUNK_WOOD: Record<number, [number, number]> = {
  [Nature.Willow]: [34, 35],
  [Nature.Cypress]: [79, 80],
  [Nature.Trollgnarl]: [214, 214],
};

/** Wood a felled trunk drops when it lands: ceil(size × height / 16) + 1 pieces (branches drop their own). */
export function trunkWood(species: number, size: number): { item: number; count: number } | undefined {
  const h = TRUNK_HEIGHT[species], wood = TRUNK_WOOD[species];
  if (!h || !wood) return undefined;
  return { item: wood[size < 0.2 ? 0 : 1], count: Math.ceil(size * h / 16) + 1 };
}

/** Chopping tools the character carries (equipped or in any bag), best first. Bare hands always work. */
export function ownedTools(inventory: Inventory | undefined): number[] {
  const found = new Set<number>([UNARMED]);
  const walk = (inv: Inventory | undefined) => {
    if (inv?.state !== "saved") return;
    for (const item of inv.items) {
      if (CHOP_TOOLS[item.index] !== undefined) found.add(item.index);
      item.contents.forEach(walk);
    }
  };
  walk(inventory);
  return [...found].sort((a, b) => CHOP_TOOLS[b] - CHOP_TOOLS[a] || a - b);
}

/** A manual pick only holds while the carried tools are what they were when it was made; otherwise the best carried tool. */
export function chosenTool(owned: number[], pick?: { tool: number; owned: string }): number {
  return pick && pick.owned === owned.join() ? pick.tool : owned[0];
}

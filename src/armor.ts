// Equipment slots and the player's armor, ported from Mirklurk 0.8.1.5 (decompiled GML).
// Sources: myEquips in gml_Object_obj_player_Create_0 (slot order, as Player.save lists them), player_update_gearstats and
// player_real_combat_check in gml_GlobalScript_scr_basic_useful, item_durfix_value in gml_GlobalScript_scr_items,
// being_get_armor_max in gml_GlobalScript_scr_ai_related, and armor / durabilityMax in gml_Object_databank_Alarm_1.

import { roundGml } from "./chop.ts";
import { type HealthGrid, Hp } from "./health.ts";
import type { SavedItem } from "./inventory.ts";

/**
 * myEquips.subSlots in order. Slots 0–1 and 2–3 are the two weapon sets (main hand, then off hand: a shield, a torch or
 * arrows); only one set is in hand (`actives` in Player.save).
 */
export const SLOT_NAMES = [
  "main hand",
  "off hand",
  "main hand",
  "off hand",
  "helmet",
  "hood",
  "shirt",
  "vest or chest armor",
  "backpack",
  "belt",
  "pants",
  "leg armor",
  "gloves",
  "cloak",
  "socks",
  "footwear",
] as const;

export const isWeaponSlot = (slot: number) => slot < 4;

/** [armor, durabilityMax] of every item with armor. */
export const ARMOR: Readonly<Record<number, readonly [armor: number, durabilityMax: number]>> = {
  0: [1.5, 50],
  1: [2.5, 100],
  15: [0.35, 25],
  16: [0.1, 25],
  17: [0.1, 35],
  18: [0.1, 45],
  20: [0.5, 40],
  21: [0.6, 75],
  22: [0.5, 40],
  23: [0.6, 70],
  24: [0.6, 75],
  33: [1, 60],
  42: [0.5, 30],
  43: [2, 65],
  50: [3.5, 200],
  54: [6, 300],
  55: [6, 300],
  56: [6, 300],
  57: [1, 200],
  58: [5, 300],
  59: [0.5, 75],
  116: [2, 120],
  117: [3, 200],
  118: [1.5, 25],
  119: [1, 50],
  137: [0.5, 45],
  145: [2, 120],
  146: [2, 120],
  147: [4.5, 150],
  164: [0.25, 50],
  165: [1.5, 100],
  192: [2, 70],
  193: [4, 110],
  194: [1, 50],
  195: [1.5, 50],
  196: [0.25, 40],
  197: [0.25, 45],
  198: [0.5, 50],
  199: [0.15, 30],
  200: [1, 100],
  201: [0.5, 120],
  202: [0.5, 80],
  203: [0.5, 90],
  204: [0.5, 50],
  205: [1, 90],
  207: [0.25, 40],
  208: [0.25, 50],
  209: [0.5, 95],
};

/** An item worn in an equipment slot; `active` is false for the weapon set not in hand. */
export interface Equipped {
  slot: number;
  active: boolean;
  item: SavedItem;
}

/** item_durfix_value: an item's armor scaled by its durability, to 0.01. Undefined for items without armor. */
export function itemArmor(item: SavedItem): number | undefined {
  const a = ARMOR[item.index];
  if (!a) return undefined;
  const [armor, max] = a;
  return roundGml(armor * ((item.durability ?? max) / max) * 100) / 100;
}

/** player_update_gearstats' totalArmor: every equipment slot's armor (both weapon sets), to 0.1, as the equipment screen shows it. */
export const totalArmor = (equipment: readonly Equipped[]) =>
  roundGml(equipment.reduce((sum, e) => sum + (itemArmor(e.item) ?? 0), 0) * 10) / 10;

/** being_get_armor_max: armor layers the grid can still take, up to 3 on each living hit point. */
export const armorRoom = (g: HealthGrid) => g.cells.flat().reduce((sum, c) => sum + (c.hp >= Hp.Healthy ? Math.max(0, 4 - c.hp) : 0), 0);

/** player_real_combat_check: armor points to distribute when combat starts, the total rounded down and capped by the grid. */
export const armorToPlace = (total: number, g?: HealthGrid) => Math.min(Math.floor(total), g ? armorRoom(g) : Infinity);

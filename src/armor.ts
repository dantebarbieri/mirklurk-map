// Equipment slots and the player's armor, ported from Mirklurk 0.9.0.0 (decompiled GML).
// Sources: myEquips in gml_Object_obj_player_Create_0 (slot order, as Player.save lists them), player_update_gearstats and
// player_real_combat_check in gml_GlobalScript_scr_basic_useful, item_durfix_value in gml_GlobalScript_scr_items,
// being_get_armor_max in gml_GlobalScript_scr_ai_related, and armor / durabilityMax in gml_Object_databank_Alarm_1.

import { roundGml } from "./chop.ts";
import { type HealthGrid, Hp } from "./health.ts";
import type { SavedItem } from "./inventory.ts";
import { ITEMS } from "./itemdata.ts";

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

/** Armor points from the item database; durabilityMax comes from the generated item data, also used by condition and editing. */
const ARMOR_POINTS: Readonly<Record<number, number>> = {
  0: 1.5,
  1: 2.5,
  15: 0.35,
  16: 0.1,
  17: 0.1,
  18: 0.1,
  20: 0.5,
  21: 0.6,
  22: 0.5,
  23: 0.6,
  24: 0.6,
  33: 1,
  42: 0.5,
  43: 2,
  50: 3.5,
  54: 6,
  55: 6,
  56: 6,
  57: 1,
  58: 5,
  59: 0.5,
  116: 2,
  117: 3,
  118: 1.5,
  119: 1,
  137: 0.5,
  145: 2,
  146: 2,
  147: 4.5,
  164: 0.25,
  165: 1.5,
  192: 2,
  193: 4,
  194: 1,
  195: 1.5,
  196: 0.25,
  197: 0.25,
  198: 0.5,
  199: 0.15,
  200: 1,
  201: 0.5,
  202: 0.5,
  203: 0.5,
  204: 0.5,
  205: 1,
  207: 0.25,
  208: 0.25,
  209: 0.5,
  264: 1,
};

/** [armor, durabilityMax] of every item with armor. */
export const ARMOR: Readonly<Record<number, readonly [armor: number, durabilityMax: number]>> = Object.fromEntries(
  Object.entries(ARMOR_POINTS).map(([index, armor]) => {
    const max = ITEMS[Number(index)]?.durability;
    if (max === undefined || !Number.isFinite(max) || max <= 0) throw new Error(`Armor item ${index} has no valid durability maximum`);
    return [index, [armor, max] as const];
  }),
);

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

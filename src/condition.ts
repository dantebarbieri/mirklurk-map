// An item's condition as the game's item tooltip shows it (item_draw_info in gml_GlobalScript_scr_items): durability out of the item
// database's durabilityMax (portions left for food and medicine, oil left for Lamp Oil), burn time left out of burnTime for torches
// and lanterns, and how wet it is. Shared by the map's inventories and the save editor.

import { ITEMS } from "./itemdata.ts";

/** Lamp Oil: its durability is the oil in the flask, which refills a lantern (items_bonus_apply). */
export const LAMP_OIL = 112;
/** itemDB types whose durability the tooltip never shows: materials (14), coins and gems (25) and quest items (26). */
const UNSHOWN = new Set([14, 25, 26]);
/** Remedies (13), food (19) and medicine (20): durability counts the portions left. */
const PORTIONS = new Set([13, 19, 20]);

/** What an item's durability counts: wear, the portions left, or the lamp oil left. */
export type DurabilityKind = "durability" | "portions" | "oil";
export const DURABILITY_LABELS: Readonly<Record<DurabilityKind, string>> = {
  durability: "Durability",
  portions: "Portions left",
  oil: "Oil left",
};

/** What item `index`'s durability counts, when its tooltip shows it: a durabilityMax over 1, on a type that shows it. */
export function durabilityKind(index: number): DurabilityKind | undefined {
  const d = ITEMS[index];
  if (!d || d.durability === undefined || d.durability <= 1 || UNSHOWN.has(d.type)) return undefined;
  return index === LAMP_OIL ? "oil" : PORTIONS.has(d.type) ? "portions" : "durability";
}

/** Torches and lanterns: the turns a new one burns (burnTime), which its burnTimeLeft counts down from. */
export const fuelMax = (index: number): number | undefined => ITEMS[index]?.burn;

/** Only items with a waterproof value ever get wet in the game. */
export const canGetWet = (index: number) => ITEMS[index]?.waterproof !== undefined;

/** The saved fields an item's condition comes from: a Player.save item record, or a parsed SavedItem. */
export interface ItemState {
  index: number;
  durability?: unknown;
  burnTimeLeft?: unknown;
  wet?: unknown;
}

export interface Gauge {
  value: number;
  max: number;
}

export interface Condition {
  /** Durability, portions or oil left; a value the save leaves out is full, as a new item is. */
  durability?: Gauge & { kind: DurabilityKind };
  /** Burn time left, in turns. */
  fuel?: Gauge;
  /** 0–1, only when wet at all. */
  wet?: number;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function conditionOf(item: ItemState): Condition {
  const c: Condition = {};
  const kind = durabilityKind(item.index);
  if (kind) {
    const max = ITEMS[item.index].durability!;
    c.durability = { kind, value: finite(item.durability) ? item.durability : max, max };
  }
  const burn = fuelMax(item.index);
  if (burn !== undefined && finite(item.burnTimeLeft)) c.fuel = { value: item.burnTimeLeft, max: burn };
  if (isWet(item)) c.wet = item.wet as number;
  return c;
}

/** Wear that repairing restores: durability (not portions or oil) under its maximum. */
export function needsRepair(item: ItemState): boolean {
  const d = conditionOf(item).durability;
  return d?.kind === "durability" && d.value < d.max;
}

/** Fuel that refuelling tops up: a torch's or lantern's burn time, or a Lamp Oil flask's oil, under full. */
export function needsFuel(item: ItemState): boolean {
  const c = conditionOf(item);
  return (!!c.fuel && c.fuel.value < c.fuel.max) || (c.durability?.kind === "oil" && c.durability.value < c.durability.max);
}

export const isWet = (item: ItemState) => finite(item.wet) && item.wet > 0;

/** A number as GML's string() writes durability (up to two decimals), or burn time to a tenth of a turn. */
export const amountText = (v: number, places = 2) => String(Math.round(v * 10 ** places) / 10 ** places + 0);
/** Wetness as textf_floatpercent writes it, to 0.1%; a trace shows as under 0.1% rather than 0%. */
export const wetText = (wet: number) => (wet > 0 && wet < 0.0005 ? "<0.1%" : `${Math.round(wet * 1000) / 10 + 0}%`);

export interface ConditionPart {
  text: string;
  /** A quarter or less left. */
  low?: boolean;
}

/** What a condition shows: "Durability 87/180", "Fuel 23.5/35 turns", "Wet 40%". */
export function conditionParts(c: Condition): ConditionPart[] {
  const parts: ConditionPart[] = [];
  if (c.durability) {
    const { kind, value, max } = c.durability;
    parts.push({ text: `${DURABILITY_LABELS[kind]} ${amountText(value)}/${max}`, low: value <= max / 4 });
  }
  if (c.fuel) parts.push({ text: `Fuel ${amountText(c.fuel.value, 1)}/${c.fuel.max} turns`, low: c.fuel.value <= c.fuel.max / 4 });
  if (c.wet !== undefined) parts.push({ text: `Wet ${wetText(c.wet)}` });
  return parts;
}

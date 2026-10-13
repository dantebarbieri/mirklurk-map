// Gatherables: the plants you harvest and the bird nests you search, read from an area's saved Hinderance tiles.

import { ITEM_NAMES } from "./gamedata.ts";
import { roundGml } from "./chop.ts";
import { plural } from "./format.ts";
import { TILE, tileIndex, TILES } from "./rules.ts";
import type { Layer, Mark } from "./objects.ts";
import type { Grid } from "./save.ts";
import { atLeast, type GameVersion } from "./version.ts";

export type GatherKind = "calmia" | "turnip" | "cranberry" | "cress" | "lily" | "bulb" | "nest";

/** Each kind's map layer and name. Calmia, Vile Bulbs and nests have no Nature.ini title, so they are named after what they give. */
export const GATHER_KINDS: Record<GatherKind, { layer: Layer; name: string }> = {
  calmia: { layer: "calmia", name: "Calmia" },
  turnip: { layer: "turnips", name: "Turnip" },
  cranberry: { layer: "cranberries", name: "Cranberry" },
  cress: { layer: "watercress", name: "Watercress" },
  lily: { layer: "lilies", name: "Water Lily" },
  bulb: { layer: "bulbs", name: "Vile Bulb" },
  nest: { layer: "nests", name: "Bird nest" },
};

export const GATHER_LAYERS = new Set<Layer>(Object.values(GATHER_KINDS).map((k) => k.layer));

/** What harvesting (or searching) one tile gives: an item and its base amount, before Green Fingers' extra one. */
export interface Gather {
  kind: GatherKind;
  /** Growth stage, 0 (just sprouted) to 4 (full grown), for plants that grow through five tiles. */
  stage?: number;
  item: number;
  /** Base amount [min, max]; null while a young Cranberry has no berries yet. */
  amount: [number, number] | null;
}

/**
 * loot_amountchances(a, b) (gml_GlobalScript_scr_items) under `rules`: since 0.8.9.9 it picks an upper bound i from a…b (b raised
 * to a when smaller), then a…i, so a to b; before, i ran 0…b−1 and the count a…a+i, so a to a+b−1. Low counts are likelier.
 */
export const amountRange = (a: number, b: number, rules: GameVersion): [number, number] =>
  atLeast(rules, "0.8.9.9") ? [a, Math.max(a, Math.floor(b))] : [a, a + Math.ceil(b) - 1];

/**
 * The gatherable a Hinderance tile index holds, if any: tile_is_harvestable (gml_GlobalScript_scr_tiles_autotiling)
 * with the yields of loot_generate (gml_GlobalScript_scr_items) and bird nests (Hinderance 145 searched, 146 full).
 * Ferns (80–89, Plant Fiber) are harvestable too but cover the ground everywhere, so they are shaded instead (`fernAt`).
 */
export function gatherAt(tile: number, rules: GameVersion): Gather | null {
  if (tile === 147) return { kind: "calmia", item: 142, amount: amountRange(1, 3, rules) };
  if (tile === 148) return { kind: "bulb", item: 173, amount: amountRange(1, 2, rules) };
  if (tile >= 150 && tile < 160) {
    // Two looks of five stages each; the last two stages give two turnips.
    const stage = (tile - 150) % 5;
    return { kind: "turnip", stage, item: 221, amount: stage >= 3 ? [2, 2] : [1, 1] };
  }
  if (tile >= 160 && tile < 165) {
    const stage = tile - 160, n = tile - 162 + 2;
    return { kind: "cranberry", stage, item: 225, amount: tile >= 162 ? amountRange(n, n * 2, rules) : null };
  }
  if (tile >= 170 && tile < 180) {
    const stage = (tile - 170) % 5, n = stage + 1;
    return { kind: "cress", stage, item: 226, amount: amountRange(n, roundGml(n * 1.5), rules) };
  }
  // Lilypads grow 70–74 and 75–79; only the two flowering stages give Water Lilies.
  if (tile === 73 || tile === 78) return { kind: "lily", stage: 3, item: 175, amount: [1, 1] };
  if (tile === 74 || tile === 79) return { kind: "lily", stage: 4, item: 175, amount: [2, 2] };
  if (tile === 145 || tile === 146) return { kind: "nest", item: 77, amount: tile === 146 ? amountRange(1, 7, rules) : null };
  return null;
}

/** A fern's growth stage (0–4; two looks, 80–84 and 85–89) and its Plant Fiber, (n, 2n) with n = stage + 1 (loot_generate case 57). */
export function fernAt(tile: number, rules: GameVersion): { stage: number; amount: [number, number] } | null {
  const stage = fernStage(tile);
  return stage === null ? null : { stage, amount: amountRange(stage + 1, (stage + 1) * 2, rules) };
}

const fernStage = (tile: number) => (tile < 80 || tile >= 90 ? null : (tile - 80) % 5);

/** The Ferns overlay's colour for a Hinderance tile, as [r, g, b, alpha]: deeper the bigger the fern, so the more fiber. */
export function fernShade(tile: number): [number, number, number, number] | null {
  const stage = fernStage(tile);
  return stage === null ? null : [150, 205, 60, 80 + 30 * stage];
}

const STAGES = ["sprouting", "young", "growing", "grown", "full grown"];

/** "3" or "3–6", as the yields read. */
export const amountText = ([a, b]: [number, number]) => a === b ? `${a}` : `${a}–${b}`;

/** LootData 99: harvested or searched, with what was left saved to LOOT-x_y.save (scr_menu_related). */
const LEFT_OVER = 99;

/** "Cranberries x2–5 (grown)", or why there is nothing to take; `loot` is the tile's LootData. */
export function gatherDetail(g: Gather, loot = 0): string {
  if (loot === LEFT_OVER) return `${g.kind === "nest" ? "searched" : "harvested"}; what was left lies in its ground loot`;
  if (g.kind === "nest") {
    if (!g.amount) return loot > 0 && loot < 50 ? `searched; refills in about ${plural(loot, "day")}` : "searched";
    return `Feather x${amountText(g.amount)}, 40% chance of Egg x1–3`;
  }
  const stage = g.stage === undefined ? "" : ` (${STAGES[g.stage]})`;
  if (!g.amount) return `no berries yet${stage}`;
  return `${ITEM_NAMES[g.item] ?? `Item ${g.item}`} x${amountText(g.amount)}${stage}`;
}

/** Map marks for an area's gatherables: one per tile, at its centre. `loot` (LootData) tells taken and refilling ones apart. */
export function gatherMarks(hinderance: Grid<Uint32Array>, loot: Grid<Uint32Array> | null | undefined, rules: GameVersion): Mark[] {
  const out: Mark[] = [];
  for (let i = 0; i < TILES * TILES; i++) {
    const g = gatherAt(tileIndex(hinderance.data[i]), rules);
    if (!g) continue;
    const left = tileIndex(loot?.data[i] ?? 0);
    const state = !g.amount ? (g.kind === "nest" ? " empty" : " unripe") : "";
    out.push({
      layer: GATHER_KINDS[g.kind].layer,
      kind: `gather ${g.kind}${state}`,
      x: (i % TILES) * TILE + TILE / 2,
      y: Math.floor(i / TILES) * TILE + TILE / 2,
      name: GATHER_KINDS[g.kind].name,
      detail: gatherDetail(g, left),
      item: g.item,
      gather: g,
    });
  }
  return out;
}

/** Most to take first, then ripest; for the list under the map. */
export const gatherOrder = (a: Mark, b: Mark) =>
  (b.gather?.amount?.[1] ?? -1) - (a.gather?.amount?.[1] ?? -1) || (b.gather?.stage ?? 0) - (a.gather?.stage ?? 0);

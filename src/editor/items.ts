// Save editor: adding items to the player's carried containers the way the game's pickup does (item_pickup, item_stack, item_add and
// item_fits in gml_GlobalScript_scr_items). Items are written as the item constructor makes them, and every cell an item covers in a
// container's gridSave holds its own copy with the same X,Y origin, as json_stringify writes a grid.

import { ITEMS } from "../itemdata.ts";
import { isRec, type Rec } from "./edits.ts";

/** Empty grid cell (GameMaker's noone). */
const EMPTY = -4;
/** item(89) remembers the zone it was made in; item(252) the zones it has collected. */
const CONNECTED_AREA_ITEM = 89;
const COLLECTED_AREAS_ITEM = 252;

/** Items the editor can add: everything carryable in the item database. */
export const addable = (index: number) => !!ITEMS[index] && !ITEMS[index].unlootable;

/** A new item record, as `new item(index, amount, true)` makes it; `neww` gives it the game's gold "new" highlight. */
export function newItem(index: number, amount: number, zone: [number, number], bagTemplate?: Rec): Rec {
  const d = ITEMS[index];
  if (!d) throw new Error(`Unknown item ${index}`);
  const item: Rec = {
    index,
    amount,
    X: EMPTY,
    Y: EMPTY,
    durability: d.durability ?? 1,
    wet: 0,
    rotation: 0,
    sideflipped: false,
    neww: true,
    subParts: [],
  };
  if (d.bag) {
    const [w, h] = d.bag;
    // inventory(w, h, index): only gridSave is loaded back; the rest mirrors what the game saves next to it.
    (item.subParts as Rec[]).push({
      type: 0,
      grabbed: false,
      grabY: bagTemplate?.grabY ?? 24,
      parentID: EMPTY,
      weight: 0,
      X: bagTemplate?.X ?? 0,
      Y: bagTemplate?.Y ?? 0,
      WIDTH: w * 16,
      HEIGHT: h * 16,
      parentIndex: index,
      linkedMenu: EMPTY,
      gridSave: Array.from({ length: h }, () => Array<number>(w).fill(EMPTY)),
    });
  }
  if (index === CONNECTED_AREA_ITEM) item.connectedArea = [...zone];
  if (index === COLLECTED_AREAS_ITEM) item.collectedAreas = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]);
  if (d.burn !== undefined) {
    item.burnTimeLeft = d.burn;
    item.lit = false;
  }
  return item;
}

/** A carried container's inventory: subParts entries of type 0, whose gridSave is [y][x]. */
interface Bag {
  owner: number;
  grid: unknown[][];
  inventory: Rec;
}

/** Inventories of everything in myEquips, in slot order, as item_pickup visits them. */
export function carriedBags(p: Rec): Bag[] {
  const out: Bag[] = [];
  const equips = Array.isArray(p.myEquips) ? p.myEquips : [];
  equips.forEach((item, slot) => {
    if (!isRec(item) || !Array.isArray(item.subParts)) return;
    for (const part of item.subParts) {
      if (!isRec(part) || part.type !== 0) continue;
      const grid = part.gridSave;
      if (!Array.isArray(grid) || !grid.length || grid.some((row) => !Array.isArray(row) || row.length !== grid[0].length)) {
        throw new Error(`The container in equipment slot ${slot + 1} has an unreadable grid`);
      }
      out.push({ owner: Number(item.index), grid: grid as unknown[][], inventory: part });
    }
  });
  return out;
}

const origin = (g: unknown[][], x: number, y: number): Rec | undefined => {
  const c = g[y]?.[x];
  return isRec(c) && c.X === x && c.Y === y ? c : undefined;
};

/** Every cell holding the item whose origin is (x, y): its copies. */
function copies(g: unknown[][], x: number, y: number): Rec[] {
  const out: Rec[] = [];
  for (const row of g) for (const c of row) if (isRec(c) && c.X === x && c.Y === y) out.push(c);
  return out;
}

/** item_fits for a new, unturned item: the whole rectangle is inside the grid and empty. */
function fits(g: unknown[][], x: number, y: number, w: number, h: number): boolean {
  if (y + h > g.length || x + w > g[0].length) return false;
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (g[j][i] !== EMPTY) return false;
  return true;
}

export interface AddResult {
  /** How many were added. */
  added: number;
  /** How many did not fit anywhere. */
  left: number;
}

/**
 * Adds `amount` of item `index` to the player's carried containers: first topping up stacks of the same item (item_stack), then
 * placing new stacks of at most stackLimit in the first free spot, scanning each container column by column as item_add does.
 * Whatever does not fit is reported back rather than dropped on the ground.
 */
export function addItems(p: Rec, index: number, amount: number): AddResult {
  if (!addable(index)) throw new Error(`Item ${index} cannot be carried`);
  if (!Number.isInteger(amount) || amount < 1) throw new Error("Amount must be a whole number of at least 1");
  const d = ITEMS[index];
  const bags = carriedBags(p);
  let left = amount;
  if (d.stack > 1) {
    for (const bag of bags) {
      const g = bag.grid;
      for (let x = 0; x < g[0].length && left; x++) {
        for (let y = 0; y < g.length && left; y++) {
          const here = origin(g, x, y);
          if (!here || here.index !== index || Number(here.amount) >= d.stack) continue;
          const have = Number(here.amount);
          const add = Math.min(left, d.stack - have);
          const wet = typeof here.wet === "number" ? here.wet * have / (have + add) : here.wet;
          for (const c of copies(g, x, y)) {
            c.amount = have + add;
            if (wet !== undefined) c.wet = wet;
          }
          left -= add;
        }
      }
    }
  }
  const zone: [number, number] = [Number(p.areaX), Number(p.areaY)];
  const template = bags[0]?.inventory;
  for (const bag of bags) {
    const g = bag.grid;
    for (let x = 0; x < g[0].length && left; x++) {
      for (let y = 0; y < g.length && left; y++) {
        if (!fits(g, x, y, d.w, d.h)) continue;
        const n = Math.min(left, d.stack);
        const item = newItem(index, n, zone, template);
        item.X = x;
        item.Y = y;
        const json = JSON.stringify(item);
        for (let j = y; j < y + d.h; j++) for (let i = x; i < x + d.w; i++) g[j][i] = JSON.parse(json);
        left -= n;
      }
    }
  }
  return { added: amount - left, left };
}

/** Free cells across all carried containers, for showing how much room is left. */
export function freeCells(p: Rec): number {
  return carriedBags(p).reduce((n, b) => n + b.grid.flat().filter((c) => c === EMPTY).length, 0);
}

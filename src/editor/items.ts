// Save editor: adding items to the player's carried containers the way the game's pickup does (item_pickup, item_stack, item_add and
// item_fits in gml_GlobalScript_scr_items). Items are written as the item constructor makes them, and every cell an item covers in a
// container's gridSave holds its own copy with the same X,Y origin, as json_stringify writes a grid.

import { ITEMS } from "../itemdata.ts";
import { ITEM_NAMES } from "../gamedata.ts";
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

/** Where a carried item is: its equipment slot, then, for each container it is inside, that container's part and the item's origin. */
export interface ItemPlace {
  slot: number;
  path: { part: number; x: number; y: number }[];
}

/** An item worn or carried, with what its containers hold. */
export interface CarriedItem {
  place: ItemPlace;
  index: number;
  amount: number;
  contents: CarriedItem[];
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
/** A two-handed melee weapon is saved in its off hand too (slots 1 and 3); the game's loader skips that copy. */
const isOffHandCopy = (equips: unknown[], slot: number) =>
  (slot === 1 || slot === 3) && isRec(equips[slot]) && same(equips[slot], equips[slot - 1]);

function carried(rec: Rec, place: ItemPlace): CarriedItem {
  const contents: CarriedItem[] = [];
  (Array.isArray(rec.subParts) ? rec.subParts : []).forEach((part, i) => {
    if (!isRec(part) || part.type !== 0 || !Array.isArray(part.gridSave)) return;
    const g = part.gridSave as unknown[][];
    for (let y = 0; y < g.length; y++) {
      for (let x = 0; x < (Array.isArray(g[y]) ? g[y].length : 0); x++) {
        if (origin(g, x, y)) contents.push(carried(g[y][x] as Rec, { slot: place.slot, path: [...place.path, { part: i, x, y }] }));
      }
    }
  });
  return { place, index: Number(rec.index), amount: Number(rec.amount), contents };
}

/** How many items are inside a carried item, at any depth. */
export const countInside = (c: CarriedItem): number => c.contents.reduce((n, inner) => n + 1 + countInside(inner), 0);

/** Everything the player wears, in slot order, each with what its containers hold (row by row). */
export function carriedItems(p: Rec): CarriedItem[] {
  const equips = Array.isArray(p.myEquips) ? p.myEquips : [];
  return equips.flatMap((rec, slot) => isRec(rec) && !isOffHandCopy(equips, slot) ? [carried(rec, { slot, path: [] })] : []);
}

/** The steps to the item at `place`: each container grid on the way, ending with the item's own; undefined when nothing is there. */
function locate(p: Rec, place: ItemPlace): { item: Rec; grids: { grid: unknown[][]; x: number; y: number }[] } | undefined {
  const equips = Array.isArray(p.myEquips) ? p.myEquips : [];
  let item = equips[place.slot];
  const grids: { grid: unknown[][]; x: number; y: number }[] = [];
  for (const { part, x, y } of place.path) {
    if (!isRec(item) || !Array.isArray(item.subParts)) return undefined;
    const sub = item.subParts[part];
    if (!isRec(sub) || sub.type !== 0 || !Array.isArray(sub.gridSave)) return undefined;
    const grid = sub.gridSave as unknown[][];
    item = origin(grid, x, y);
    grids.push({ grid, x, y });
  }
  return isRec(item) ? { item, grids } : undefined;
}

/** The item at `place`, if there is one. */
export const itemAt = (p: Rec, place: ItemPlace): Rec | undefined => locate(p, place)?.item;

/** Every cell of a grid holding the item at origin (x, y) becomes a copy of the origin cell again. */
function syncCopies(g: unknown[][], x: number, y: number) {
  const json = JSON.stringify(g[y][x]);
  for (let j = 0; j < g.length; j++) {
    for (let i = 0; i < g[j].length; i++) {
      const c = g[j][i];
      if ((i !== x || j !== y) && isRec(c) && c.X === x && c.Y === y) g[j][i] = JSON.parse(json);
    }
  }
}

export interface RemoveResult {
  /** How many were removed. */
  removed: number;
  /** Items that were inside it and went with it, at any depth. */
  inside: number;
}

/**
 * Removes `amount` (or "all") of item `index` at `place`: an equipment slot becomes empty (with a two-handed weapon's off-hand copy),
 * and a container's grid gets every cell the item covered emptied. Fewer than all of a stack lowers its amount. Every copy of the
 * containers it was in, which each cell of theirs holds, is brought up to date. Throws when that item is no longer there or there are
 * fewer than `amount`.
 */
export function removeItem(p: Rec, place: ItemPlace, index: number, amount: number | "all"): RemoveResult {
  const name = ITEM_NAMES[index] ?? `Item ${index}`;
  const found = locate(p, place);
  if (!found || found.item.index !== index) throw new Error(`${name} is no longer there`);
  const { item, grids } = found;
  const have = Number(item.amount);
  const n = amount === "all" ? have : amount;
  if (!Number.isInteger(n) || n < 1) throw new Error("Amount must be a whole number of at least 1");
  if (n > have) throw new Error(`There ${have === 1 ? "is only 1" : `are only ${have}`} there`);
  const equips = p.myEquips as unknown[];
  const twin = place.path.length === 0 && (place.slot === 0 || place.slot === 2) && isOffHandCopy(equips, place.slot + 1);
  const all = n === have;
  const inside = all ? countInside(carried(item, place)) : 0;
  const last = grids[grids.length - 1];
  if (!all) {
    item.amount = have - n;
    if (last) syncCopies(last.grid, last.x, last.y);
  } else if (last) {
    for (const row of last.grid) {
      for (let i = 0; i < row.length; i++) {
        const c = row[i];
        if (isRec(c) && c.X === last.x && c.Y === last.y) row[i] = EMPTY;
      }
    }
  } else equips[place.slot] = EMPTY;
  // The containers it was in changed, so every copy of each of them is made again from its origin.
  for (let k = grids.length - 2; k >= 0; k--) syncCopies(grids[k].grid, grids[k].x, grids[k].y);
  if (twin) equips[place.slot + 1] = isRec(equips[place.slot]) ? JSON.parse(JSON.stringify(equips[place.slot])) : EMPTY;
  return { removed: n, inside };
}

// Save editor: adding items to the player's carried containers the way the game's pickup does (item_pickup, item_stack, item_add and
// item_fits in gml_GlobalScript_scr_items). Items are written as the item constructor makes them, and every cell an item covers in a
// container's gridSave holds its own copy with the same X,Y origin, as json_stringify writes a grid.

import { ITEMS } from "../itemdata.ts";
import { ITEM_NAMES } from "../gamedata.ts";
import {
  canGetWet,
  DURABILITY_LABELS,
  durabilityKind,
  durabilityMax,
  fuelMax,
  isWet,
  type ItemState,
  itemState,
  needsFuel,
  needsRepair,
  stackLimit,
  stacksMatch,
} from "../condition.ts";
import { isRec, type Rec } from "../save-record.ts";
import { isOffHandCopy } from "../inventory.ts";
import { type GameVersion, NEWEST } from "../version.ts";

/** Empty grid cell (GameMaker's noone). */
const EMPTY = -4;
/** item(89) remembers the zone it was made in; item(252) the zones it has collected. */
const CONNECTED_AREA_ITEM = 89;
const COLLECTED_AREAS_ITEM = 252;

/** Items the editor can add: everything you can carry in the item database, which leaves out only Unarmed and Finish Raft. */
export const addable = (index: number) => !!ITEMS[index] && !ITEMS[index].uncarried;

/**
 * A new item record, as `new item(index, amount, true)` makes it under the game version `rules`; `neww` gives it the game's gold
 * "new" highlight.
 */
export function newItem(index: number, amount: number, zone: [number, number], bagTemplate?: Rec, rules: GameVersion = NEWEST): Rec {
  const d = ITEMS[index];
  if (!d) throw new Error(`Unknown item ${index}`);
  const item: Rec = {
    index,
    amount,
    X: EMPTY,
    Y: EMPTY,
    durability: durabilityMax(index, rules) ?? 1,
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
export interface Bag {
  /** The equipment slot of the item it belongs to, and which of that item's subParts it is. */
  slot: number;
  part: number;
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
    item.subParts.forEach((part, partIndex) => {
      if (!isRec(part) || part.type !== 0) return;
      const grid = part.gridSave;
      if (!Array.isArray(grid) || !grid.length || grid.some((row) => !Array.isArray(row) || row.length !== grid[0].length)) {
        throw new Error(`The container in equipment slot ${slot + 1} has an unreadable grid`);
      }
      out.push({ slot, part: partIndex, owner: Number(item.index), grid: grid as unknown[][], inventory: part });
    });
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

/** item_fits: the whole w×h rectangle at (x, y) is inside the grid and empty. */
function fits(g: unknown[][], x: number, y: number, w: number, h: number): boolean {
  if (y + h > g.length || x + w > g[0].length) return false;
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (g[j][i] !== EMPTY) return false;
  return true;
}

/**
 * The first free spot for item `index` in grid g, column by column as item_add scans: upright first, then turned sideways
 * (sideflipped, which covers height × width), as you can turn an item while holding it in the game.
 */
function spotFor(g: unknown[][], index: number): { x: number; y: number; sideflipped: boolean } | undefined {
  const d = ITEMS[index];
  if (!d) return undefined;
  for (const sideflipped of d.w === d.h ? [false] : [false, true]) {
    const [w, h] = sideflipped ? [d.h, d.w] : [d.w, d.h];
    for (let x = 0; x < g[0].length; x++) for (let y = 0; y < g.length; y++) if (fits(g, x, y, w, h)) return { x, y, sideflipped };
  }
}

/** Writes `item` into grid g with its origin at (x, y), turned sideways or not: every cell it covers holds its own copy. */
function put(g: unknown[][], item: Rec, x: number, y: number, sideflipped: boolean) {
  const d = ITEMS[Number(item.index)];
  const [w, h] = sideflipped ? [d.h, d.w] : [d.w, d.h];
  const json = JSON.stringify({ ...item, X: x, Y: y, sideflipped });
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) g[j][i] = JSON.parse(json);
}

export interface AddResult {
  /** How many were added. */
  added: number;
  /** Some went in turned sideways, as there was no room for them upright. */
  turned?: boolean;
  /** How many did not fit anywhere. */
  left: number;
}

/**
 * Adds `amount` of item `index` to the player's carried containers: first topping up stacks of the same item (item_stack), then
 * placing new stacks of at most stackLimit in the first free spot, scanning each container column by column as item_add does. What
 * finds no room upright is then turned sideways, as you could turn it in the game. Whatever does not fit is reported back rather
 * than dropped on the ground. New items are made as the game version `rules` makes them.
 */
export function addItems(p: Rec, index: number, amount: number, rules: GameVersion = NEWEST): AddResult {
  if (!addable(index)) throw new Error(`Item ${index} cannot be carried`);
  if (!Number.isInteger(amount) || amount < 1) throw new Error("Amount must be a whole number of at least 1");
  const d = ITEMS[index];
  const bags = carriedBags(p);
  const limit = stackLimit(index, rules);
  const zone: [number, number] = [Number(p.areaX), Number(p.areaY)];
  const template = bags[0]?.inventory;
  const fresh = newItem(index, 1, zone, template, rules);
  let left = amount;
  if (limit > 1) {
    for (const bag of bags) {
      const g = bag.grid;
      for (let x = 0; x < g[0].length && left; x++) {
        for (let y = 0; y < g.length && left; y++) {
          const here = origin(g, x, y);
          if (!here || !stacksMatch(itemState(here), itemState(fresh)) || Number(here.amount) >= limit) continue;
          const have = Number(here.amount);
          const add = Math.min(left, limit - have);
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
  let turned = false;
  for (const sideflipped of d.w === d.h ? [false] : [false, true]) {
    const [w, h] = sideflipped ? [d.h, d.w] : [d.w, d.h];
    for (const bag of bags) {
      const g = bag.grid;
      for (let x = 0; x < g[0].length && left; x++) {
        for (let y = 0; y < g.length && left; y++) {
          if (!fits(g, x, y, w, h)) continue;
          const n = Math.min(left, limit);
          put(g, newItem(index, n, zone, template, rules), x, y, sideflipped);
          turned ||= sideflipped;
          left -= n;
        }
      }
    }
  }
  return { added: amount - left, left, ...(turned ? { turned } : {}) };
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

function carried(rec: Rec, place: ItemPlace): CarriedItem {
  const contents: CarriedItem[] = [];
  // Only worn containers hold anything: the game empties one kept inside another when it loads (NESTED_NOTE in inventory.ts).
  if (place.path.length) return { place, index: Number(rec.index), amount: Number(rec.amount), contents };
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

/**
 * What each equipment slot takes, in Player.save's order (myEquips.subSlots[i].takes in gml_Object_obj_player_Create_0): an itemDB
 * type, or 0 and 21 for the main and off hand of the two weapon sets.
 */
export const SLOT_TAKES: readonly number[] = [0, 21, 0, 21, 1, 2, 3, 4, 7, 5, 9, 10, 8, 6, 11, 12];
/**
 * weapon_is_ranged: bows and crossbows, which are two-handed (type 17) but leave the off hand to their ammunition. Since 0.8.9.9
 * the magic orbs are ranged too, but they are one-handed (type 16), so only the bows matter here.
 */
const RANGED = new Set([93, 44, 105, 106, 179]);
/** A two-handed melee weapon: the loader also puts it in the off hand beside it, and the save holds a copy there. */
export const isTwoHandedMelee = (index: number) => ITEMS[index]?.type === 17 && !RANGED.has(index);

/** item_fits_slot: an item goes in a slot that takes its type; main hands take types 16, 17 and 23, off hands 15, 23 and 24. */
export function fitsSlot(index: number, slot: number): boolean {
  const type = ITEMS[index]?.type, takes = SLOT_TAKES[slot];
  if (type === undefined || takes === undefined) return false;
  if (type === takes) return true;
  if (takes === 0) return type === 16 || type === 17 || type === 23;
  if (takes === 21) return type === 15 || type === 23 || type === 24;
  return false;
}

function equipList(p: Rec): unknown[] {
  const equips = p.myEquips;
  if (!Array.isArray(equips) || equips.length !== SLOT_TAKES.length) throw new Error("Player.save's equipment slots are not as expected");
  return equips;
}

/** The empty slots item `index` could be worn in, in slot order; a two-handed melee weapon also needs the off hand beside it. */
export function freeSlotsFor(p: Rec, index: number): number[] {
  const equips = equipList(p);
  return SLOT_TAKES.flatMap((_, slot) =>
    fitsSlot(index, slot) && equips[slot] === EMPTY && (!isTwoHandedMelee(index) || equips[slot + 1] === EMPTY) ? [slot] : []
  );
}

/** Empty equipment slots, in slot order (an off hand a two-handed weapon fills is not empty). */
export const freeSlots = (p: Rec): number[] => equipList(p).flatMap((e, slot) => e === EMPTY ? [slot] : []);

/** Puts `item` in `slot`, with a two-handed melee weapon's copy in the off hand beside it. */
function wear(equips: unknown[], slot: number, item: Rec) {
  item.X = EMPTY;
  item.Y = EMPTY;
  equips[slot] = item;
  if (isTwoHandedMelee(Number(item.index))) equips[slot + 1] = JSON.parse(JSON.stringify(item));
}

/** The slot to wear item `index` in: `slot` when given and free, else the first free one it fits. */
function slotFor(p: Rec, index: number, slot?: number): number {
  const free = freeSlotsFor(p, index);
  const at = slot ?? free[0];
  const name = ITEM_NAMES[index] ?? `Item ${index}`;
  if (at === undefined || !free.includes(at)) {
    const fits = SLOT_TAKES.flatMap((_, s) => fitsSlot(index, s) ? [s] : []);
    throw new Error(fits.length ? `${name} has no free slot to be worn in` : `${name} cannot be worn`);
  }
  return at;
}

/**
 * Puts a new item `index` on, as the item constructor makes it, in `slot` or the first free slot it fits (item_fits_slot); a stack
 * (ammunition) takes up to its stack limit. A container worn this way gives an empty inventory to put things in. Returns the slot and
 * how many were put on. It is made as the game version `rules` makes it.
 */
export function wearNew(
  p: Rec,
  index: number,
  amount = 1,
  slot?: number,
  rules: GameVersion = NEWEST,
): { slot: number; amount: number } {
  if (!addable(index)) throw new Error(`Item ${index} cannot be carried`);
  if (!Number.isInteger(amount) || amount < 1) throw new Error("Amount must be a whole number of at least 1");
  const at = slotFor(p, index, slot);
  const n = Math.min(amount, stackLimit(index, rules));
  const item = newItem(index, n, [Number(p.areaX), Number(p.areaY)], carriedBags(p)[0]?.inventory, rules);
  wear(p.myEquips as unknown[], at, item);
  return { slot: at, amount: n };
}

/**
 * Clears what a container's save says it holds: a container kept inside another was empty in the game (NESTED_NOTE in inventory.ts),
 * and its saved grid is a leftover.
 */
function emptyContainers(item: Rec) {
  const bag = ITEMS[Number(item.index)]?.bag;
  for (const part of Array.isArray(item.subParts) ? item.subParts : []) {
    if (!isRec(part) || part.type !== 0 || !Array.isArray(part.gridSave)) continue;
    const [w, h] = bag ?? [part.gridSave[0]?.length ?? 0, part.gridSave.length];
    part.gridSave = Array.from({ length: h }, () => Array<number>(w).fill(EMPTY));
    part.weight = 0;
  }
}

/** Takes the item at `place` (in a container) out of it and wears it in `slot` or the first free slot it fits. */
export function wearCarried(p: Rec, place: ItemPlace, index: number, slot?: number): number {
  const found = locate(p, place);
  const name = ITEM_NAMES[index] ?? `Item ${index}`;
  if (!found || found.item.index !== index || place.path.length !== 1) throw new Error(`${name} is no longer there`);
  const at = slotFor(p, index, slot);
  const item = JSON.parse(JSON.stringify(found.item));
  removeItem(p, place, index, "all");
  emptyContainers(item);
  item.sideflipped = false;
  wear(p.myEquips as unknown[], at, item);
  return at;
}

/** Items in a worn item's own containers. */
const holds = (item: Rec): number =>
  (Array.isArray(item.subParts) ? item.subParts : []).reduce(
    (n: number, part) =>
      n + (isRec(part) && part.type === 0 && Array.isArray(part.gridSave)
        ? (part.gridSave as unknown[][]).flat().filter((c) => c !== EMPTY && c !== null).length
        : 0),
    0,
  );

/** A worn container: its item's equipment slot and which of that item's subParts it is. */
export interface ContainerRef {
  slot: number;
  part: number;
}

const isWhere = (place: ItemPlace, to: ContainerRef) =>
  place.path.length ? to.slot === place.slot && to.part === place.path[0].part : to.slot === place.slot;

/** The worn containers the item at `place` can move into: those with room for it (upright or sideways), other than where it is. */
export function roomFor(p: Rec, place: ItemPlace, index: number): Bag[] {
  const found = locate(p, place);
  if (!found || found.item.index !== index || place.path.length > 1) return [];
  if (!place.path.length && holds(found.item)) return [];
  return carriedBags(p).filter((b) => !isWhere(place, b) && spotFor(b.grid, index));
}

/**
 * Moves the item at `place` (worn, or in a worn container) into the worn container `to`, at its first free spot: upright first, then
 * turned sideways. A worn container moves only when empty and never into itself, as item_fits allows; a two-handed melee weapon's
 * off-hand copy goes with it. Throws when it has no room there. Returns whether it went in sideways.
 */
export function moveItem(p: Rec, place: ItemPlace, index: number, to: ContainerRef): { sideflipped: boolean } {
  const name = ITEM_NAMES[index] ?? `Item ${index}`;
  const equips = equipList(p);
  const worn = place.path.length === 0;
  const found = locate(p, place);
  if (!found || found.item.index !== index || place.path.length > 1 || (worn && isOffHandCopy(equips, place.slot))) {
    throw new Error(`${name} is no longer there`);
  }
  const target = carriedBags(p).find((b) => b.slot === to.slot && b.part === to.part);
  if (!target) throw new Error("That container is no longer worn");
  const into = ITEM_NAMES[target.owner] ?? `Item ${target.owner}`;
  if (isWhere(place, to)) throw new Error(worn ? `${name} cannot go inside itself` : `${name} is already in ${into}`);
  if (worn && holds(found.item)) {
    throw new Error(`Take everything out of ${name} first: the game empties a container kept inside another one when it loads`);
  }
  const at = spotFor(target.grid, index);
  if (!at) {
    const d = ITEMS[index];
    throw new Error(`${name} needs a free ${d.w}×${d.h} space${d.w === d.h ? "" : ", upright or sideways,"} and ${into} has none`);
  }
  const item = JSON.parse(JSON.stringify(found.item));
  if (worn) {
    const twin = (place.slot === 0 || place.slot === 2) && isOffHandCopy(equips, place.slot + 1);
    equips[place.slot] = EMPTY;
    if (twin) equips[place.slot + 1] = EMPTY;
  } else removeItem(p, place, index, "all");
  emptyContainers(item);
  put(target.grid, item, at.x, at.y, at.sideflipped);
  return { sideflipped: at.sideflipped };
}

/**
 * Takes off what is worn in `slot` and moves it into the first worn container with room (moveItem); returns that container's item.
 * Throws when none has room, or when it is a container with things in it.
 */
export function takeOff(p: Rec, slot: number, index: number): number {
  const name = ITEM_NAMES[index] ?? `Item ${index}`;
  const equips = equipList(p);
  const item = equips[slot];
  if (!isRec(item) || item.index !== index || isOffHandCopy(equips, slot)) throw new Error(`${name} is no longer worn there`);
  if (holds(item)) {
    throw new Error(`Take everything out of ${name} first: the game empties a container kept inside another one when it loads`);
  }
  const bag = carriedBags(p).find((b) => b.slot !== slot && spotFor(b.grid, index));
  if (!bag) throw new Error(`There is no room for ${name} in your other bags`);
  moveItem(p, { slot, path: [] }, index, bag);
  return bag.owner;
}
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

// --- Condition: durability, fuel and wetness (src/condition.ts says which items have which) ---

/**
 * Changes the item at `place` with `change`, then makes every copy the save keeps of it match again: the other grid cells it covers,
 * the containers it is in, and a two-handed melee weapon's off-hand copy.
 */
function update(p: Rec, place: ItemPlace, index: number, change: (item: Rec) => void) {
  const found = locate(p, place);
  if (!found || found.item.index !== index) throw new Error(`${ITEM_NAMES[index] ?? `Item ${index}`} is no longer there`);
  const equips = p.myEquips as unknown[];
  const twin = place.path.length === 0 && (place.slot === 0 || place.slot === 2) && isOffHandCopy(equips, place.slot + 1);
  change(found.item);
  for (let k = found.grids.length - 1; k >= 0; k--) syncCopies(found.grids[k].grid, found.grids[k].x, found.grids[k].y);
  if (twin) equips[place.slot + 1] = JSON.parse(JSON.stringify(equips[place.slot]));
}

/** Everything worn and what worn containers hold, in carriedItems' order. */
const everything = (p: Rec): CarriedItem[] =>
  carriedItems(p).flatMap(function all(c): CarriedItem[] {
    return [c, ...c.contents.flatMap(all)];
  });

/** What the Repair all, Refuel all and Dry all helpers restore. */
export type Upkeep = "repair" | "refuel" | "dry";
const NEEDS: Record<Upkeep, (item: ItemState, rules: GameVersion) => boolean> = { repair: needsRepair, refuel: needsFuel, dry: isWet };

/** The items worn or in worn containers that `what` would change under the game version `rules`. */
export function needing(p: Rec, what: Upkeep, rules: GameVersion = NEWEST): CarriedItem[] {
  return everything(p).filter((c) => {
    const rec = itemAt(p, c.place);
    return !!rec && NEEDS[what](itemState(rec), rules);
  });
}

/**
 * Repairs every item worn or carried to its full durability (durabilityMax under `rules`), as repair kits do up to that maximum. Food
 * portions and lamp oil are used up, not worn, so they are left as they are. Returns the items repaired.
 */
export function repairAll(p: Rec, rules: GameVersion = NEWEST): CarriedItem[] {
  const list = needing(p, "repair", rules);
  for (const c of list) update(p, c.place, c.index, (item) => void (item.durability = durabilityMax(c.index, rules)));
  return list;
}

/** Fills every torch's and lantern's burn time (burnTimeLeft to burnTime) and every Lamp Oil flask. Returns the items refuelled. */
export function refuelAll(p: Rec, rules: GameVersion = NEWEST): CarriedItem[] {
  const list = needing(p, "refuel", rules);
  for (const c of list) {
    const burn = fuelMax(c.index);
    update(p, c.place, c.index, (item) => {
      if (burn !== undefined) item.burnTimeLeft = burn;
      else item.durability = durabilityMax(c.index, rules);
    });
  }
  return list;
}

/**
 * Dries every item worn or carried (wet 0), and the clothes on your body (Player.save's wetness, head, torso, legs and feet), which
 * the preview lists as wet clothes. Returns the items dried and whether your body was wet.
 */
export function dryAll(p: Rec): { items: CarriedItem[]; body: boolean } {
  const items = needing(p, "dry");
  for (const c of items) update(p, c.place, c.index, (item) => void (item.wet = 0));
  let body = false;
  if (Array.isArray(p.wetness)) {
    p.wetness = p.wetness.map((v) => {
      if (typeof v !== "number" || !(v > 0)) return v;
      body = true;
      return 0;
    });
  }
  return { items, body };
}

export interface ConditionEdit {
  /** Durability, portions or oil left: more than 0 (the game breaks or uses up an item at 0) and at most durabilityMax. */
  durability?: number;
  /** Burn time left in turns, 0 to burnTime; at 0 a lit torch or lantern goes out, as it does when it burns down. */
  fuel?: number;
  /** 0–1, only on items that get wet in the game (or to dry one that somehow is). */
  wet?: number;
}

/**
 * Sets the condition of the item at `place`: only the values given, each checked against what the game version `rules` allows for
 * that item.
 */
export function setCondition(p: Rec, place: ItemPlace, index: number, e: ConditionEdit, rules: GameVersion = NEWEST) {
  const name = ITEM_NAMES[index] ?? `Item ${index}`;
  const kind = durabilityKind(index, rules), burn = fuelMax(index);
  if (e.durability !== undefined) {
    if (!kind) throw new Error(`${name} has no durability the game shows`);
    const max = durabilityMax(index, rules)!;
    if (!Number.isFinite(e.durability) || e.durability <= 0 || e.durability > max) {
      const ends = kind === "durability" ? "breaks" : "uses up";
      throw new Error(`${DURABILITY_LABELS[kind]} must be more than 0 and at most ${max}: at 0 the game ${ends} ${name}`);
    }
  }
  if (e.fuel !== undefined) {
    if (burn === undefined) throw new Error(`${name} burns no fuel`);
    if (!Number.isFinite(e.fuel) || e.fuel < 0 || e.fuel > burn) throw new Error(`Fuel must be from 0 to ${burn} turns`);
  }
  if (e.wet !== undefined) {
    if (!Number.isFinite(e.wet) || e.wet < 0 || e.wet > 1) throw new Error("Wetness must be from 0% to 100%");
    if (e.wet > 0 && !canGetWet(index)) throw new Error(`${name} never gets wet in the game`);
  }
  update(p, place, index, (item) => {
    if (e.durability !== undefined) item.durability = e.durability;
    if (e.fuel !== undefined) {
      item.burnTimeLeft = e.fuel;
      if (e.fuel <= 0 && item.lit === true) item.lit = false;
    }
    if (e.wet !== undefined) item.wet = e.wet;
  });
}

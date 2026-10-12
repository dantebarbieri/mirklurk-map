import { isRec, type Rec } from "./save-record.ts";
import { finite } from "./values.ts";

export interface SavedItem {
  index: number;
  amount: number;
  durability?: number;
  /** Torches and lanterns: turns of burning left. */
  burnTimeLeft?: number;
  wet?: number;
  contents: Inventory[];
}

export type Inventory =
  | { state: "saved"; items: SavedItem[]; note?: string }
  | { state: "unrolled" | "unavailable"; reason: string };

/**
 * A container kept inside another (a bag in a bag, or in a chest) holds nothing once the game loads the save: load_player and
 * load_containers give each one a new, empty inventory (item_recreate_grid). Its saved grid is a leftover: save_player refreshes only
 * worn containers', so it is the grid from when the bag was last worn, its cells written as those items are now, wherever they went.
 */
export const NESTED_NOTE = "Empty: the game empties a container kept inside another one when it loads the save.";

function item(raw: unknown, depth: number, inGrid = false): SavedItem {
  if (depth > 20) throw new Error("Inventory nesting exceeds 20 levels");
  if (
    !isRec(raw) || !Number.isInteger(raw.index) || !finite(raw.index) || raw.index < 0 ||
    !finite(raw.amount) || raw.amount < 0
  ) throw new Error("Invalid saved item");
  if (raw.subParts !== undefined && !Array.isArray(raw.subParts)) throw new Error("Invalid item subParts");
  for (const field of ["durability", "burnTimeLeft", "wet"]) {
    if (raw[field] !== undefined && !finite(raw[field])) throw new Error(`Invalid item ${field}`);
  }
  return {
    index: raw.index,
    amount: raw.amount,
    durability: finite(raw.durability) ? raw.durability : undefined,
    burnTimeLeft: finite(raw.burnTimeLeft) ? raw.burnTimeLeft : undefined,
    wet: finite(raw.wet) ? raw.wet : undefined,
    contents: (raw.subParts ?? []).flatMap((part: unknown): Inventory[] =>
      isRec(part) && part.type === 0
        ? [inGrid ? { state: "saved", items: [], note: NESTED_NOTE } : parseInventoryGrid(part.gridSave, depth + 1)]
        : []
    ),
  };
}

/**
 * GameMaker repeats each item in every occupied cell; only its X,Y origin counts. A saved cell can carry a wrong origin (its record
 * is shared with wherever the item went later), so such cells fall back to the top-left of their block of identical records; every
 * saved field must match for cells to join one block. A container kept in the grid holds nothing as the game loads it (NESTED_NOTE).
 */
export function parseInventoryGrid(raw: unknown, depth = 0): Inventory {
  if (raw === undefined) return { state: "unavailable", reason: "Contents were not recorded in this save." };
  if (!Array.isArray(raw) || raw.some((row) => !Array.isArray(row))) throw new Error("Invalid inventory grid");
  const rows: unknown[][] = raw;
  if (rows.some((row) => row.length !== (rows[0]?.length ?? 0))) throw new Error("Ragged inventory grid");
  const items: SavedItem[] = [];
  let repaired = false;
  const keys = new Map<unknown, string>();
  const key = (v: unknown) => {
    let k = keys.get(v);
    if (k === undefined) keys.set(v, k = JSON.stringify(v));
    return k;
  };
  const sameRecord = (a: unknown, b: unknown) => isRec(a) && (a === b || key(a) === key(b));
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const cell = rows[y][x];
      // item_recreate_grid passes over undefined cells (written as null) as it does empty ones (-4).
      if (cell === -4 || cell === null) continue;
      if (!isRec(cell) || !Number.isInteger(cell.X) || !Number.isInteger(cell.Y)) throw new Error("Invalid inventory cell");
      const ix = Number(cell.X), iy = Number(cell.Y);
      const origin = rows[iy]?.[ix];
      if (isRec(origin) && origin.X === ix && origin.Y === iy && origin.index === cell.index) {
        if (ix === x && iy === y) items.push(item(cell, depth, true));
      } else {
        repaired = true;
        if (!sameRecord(rows[y][x - 1], cell) && !sameRecord(rows[y - 1]?.[x], cell)) items.push(item(cell, depth, true));
      }
    }
  }
  return repaired
    ? { state: "saved", items, note: "The game saved inconsistent item positions here; items are shown by occupied cells." }
    : { state: "saved", items };
}

/** Equipment slots and LOOT-x_y files contain each item once, not a grid. */
export function parseItemList(raw: unknown): Inventory {
  if (raw === undefined) return { state: "unavailable", reason: "Items were not recorded in this save." };
  if (!Array.isArray(raw)) throw new Error("Invalid saved item list");
  return { state: "saved", items: raw.filter((v) => v !== -4).map((v) => item(v, 0)) };
}

export function containerInventory(raw: Rec): Inventory {
  if (raw.status === -214) return { state: "unrolled", reason: "Not rolled when saved. Generated on first opening in the game." };
  return parseInventoryGrid(raw.gridSave);
}

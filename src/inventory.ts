export interface SavedItem {
  index: number;
  amount: number;
  durability?: number;
  wet?: number;
  contents: Inventory[];
}

export type Inventory =
  | { state: "saved"; items: SavedItem[]; note?: string }
  | { state: "unrolled" | "unavailable"; reason: string };

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function item(raw: unknown, depth: number): SavedItem {
  if (depth > 20) throw new Error("Inventory nesting exceeds 20 levels");
  if (
    !record(raw) || !Number.isInteger(raw.index) || !finite(raw.index) || raw.index < 0 ||
    !finite(raw.amount) || raw.amount < 0
  ) throw new Error("Invalid saved item");
  if (raw.subParts !== undefined && !Array.isArray(raw.subParts)) throw new Error("Invalid item subParts");
  for (const field of ["durability", "wet"]) {
    if (raw[field] !== undefined && !finite(raw[field])) throw new Error(`Invalid item ${field}`);
  }
  return {
    index: raw.index,
    amount: raw.amount,
    durability: finite(raw.durability) ? raw.durability : undefined,
    wet: finite(raw.wet) ? raw.wet : undefined,
    contents: (raw.subParts ?? []).flatMap((part: unknown): Inventory[] =>
      record(part) && part.type === 0 ? [parseInventoryGrid(part.gridSave, depth + 1)] : []
    ),
  };
}

const sameRecord = (a: unknown, b: Record<string, unknown>) => record(a) && a.index === b.index && a.X === b.X && a.Y === b.Y;

/**
 * GameMaker repeats each item in every occupied cell; only its X,Y origin counts.
 * The game can save a wrong origin (e.g. a bag stored inside its own pouch), so such
 * cells fall back to the top-left of their block of identical records.
 */
export function parseInventoryGrid(raw: unknown, depth = 0): Inventory {
  if (raw === undefined) return { state: "unavailable", reason: "Contents were not recorded in this save." };
  if (!Array.isArray(raw) || raw.some((row) => !Array.isArray(row))) throw new Error("Invalid inventory grid");
  const rows: unknown[][] = raw;
  if (rows.some((row) => row.length !== (rows[0]?.length ?? 0))) throw new Error("Ragged inventory grid");
  const items: SavedItem[] = [];
  let repaired = false;
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const cell = rows[y][x];
      if (cell === -4) continue;
      if (!record(cell) || !Number.isInteger(cell.X) || !Number.isInteger(cell.Y)) throw new Error("Invalid inventory cell");
      const ix = Number(cell.X), iy = Number(cell.Y);
      const origin = rows[iy]?.[ix];
      if (record(origin) && origin.X === ix && origin.Y === iy && origin.index === cell.index) {
        if (ix === x && iy === y) items.push(item(cell, depth));
      } else {
        repaired = true;
        if (!sameRecord(rows[y][x - 1], cell) && !sameRecord(rows[y - 1]?.[x], cell)) items.push(item(cell, depth));
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

export function containerInventory(raw: Record<string, unknown>): Inventory {
  if (raw.status === -214) return { state: "unrolled", reason: "Not rolled when saved. Generated on first opening in the game." };
  return parseInventoryGrid(raw.gridSave);
}

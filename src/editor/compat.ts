// Save editor: whether the unsaved changes suit the game version in use. An item or creature that version's game lacks makes a
// save it cannot load (version.ts), so saving or downloading changes that add one is refused. What the save already held, as a
// save played on the beta does, is left alone.

import { BEING_NAMES, ITEM_NAMES } from "../gamedata.ts";
import type { FileMap } from "../files.ts";
import { decodeJson } from "../save.ts";
import { isRec } from "../save-record.ts";
import { type GameVersion, hasBeing, hasItem } from "../version.ts";

type Counts = Map<number, number>;
const add = (m: Counts, index: number, n: number) => m.set(index, (m.get(index) ?? 0) + n);

/**
 * How much of each item a save file holds, summing the amounts of its item records (index, amount and durability, as `new item`
 * makes them), and of each creature a Beings.save holds. The game saves a copy of an item in each cell it covers, so an item counts
 * once per cell: what matters is only whether a file holds more than before.
 */
function contents(path: string, raw: unknown): { items: Counts; beings: Counts } {
  const items: Counts = new Map(), beings: Counts = new Map();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isRec(v)) {
      if (typeof v.index === "number" && "durability" in v && typeof v.amount === "number") add(items, v.index, v.amount);
      Object.values(v).forEach(walk);
    }
  };
  walk(raw);
  if (/(^|\/)Beings\.save$/.test(path) && Array.isArray(raw)) {
    for (const b of raw) if (isRec(b) && typeof b.index === "number") add(beings, b.index, 1);
  }
  return { items, beings };
}

/** The indices `after` holds more of than `before`. */
const grown = (after: Counts, before: Counts) => [...after].filter(([i, n]) => n > (before.get(i) ?? 0)).map(([i]) => i);

/**
 * The names of the items and creatures that writing `pending` (each changed save file's bytes) over `saved` adds, or adds more of,
 * and game version `rules` does not have; empty when the changes suit it.
 */
export async function versionConflicts(saved: FileMap, pending: ReadonlyMap<string, Uint8Array>, rules: GameVersion): Promise<string[]> {
  const names = new Set<string>();
  for (const [path, bytes] of pending) {
    if (!path.endsWith(".save")) continue;
    const was = saved.get(path);
    const after = contents(path, decodeJson(bytes));
    const before = was ? contents(path, decodeJson(await was.read())) : { items: new Map(), beings: new Map() };
    for (const i of grown(after.items, before.items)) if (!hasItem(rules, i)) names.add(ITEM_NAMES[i] ?? `Item ${i}`);
    for (const i of grown(after.beings, before.beings)) if (!hasBeing(rules, i)) names.add(BEING_NAMES[i] ?? `Being ${i}`);
  }
  return [...names];
}

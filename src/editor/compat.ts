// Save editor: whether the unsaved changes suit the game version in use. An item or creature that version's game lacks makes a
// save it cannot load (version.ts), so saving or downloading changes that add one is refused. What the save already held, as a
// save played on the beta does, is left alone.

import { BEING_NAMES, ITEM_NAMES } from "../gamedata.ts";
import type { FileMap } from "../files.ts";
import { decodeJson } from "../save.ts";
import { isRec } from "../save-record.ts";
import { type GameVersion, hasBeing, hasItem } from "../version.ts";

/** The item records anywhere in a save file (index, amount and durability, as `new item` makes them), and a Beings.save's beings. */
function contents(path: string, raw: unknown): { items: number[]; beings: number[] } {
  const items: number[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isRec(v)) {
      if (typeof v.index === "number" && "amount" in v && "durability" in v) items.push(v.index);
      Object.values(v).forEach(walk);
    }
  };
  walk(raw);
  const beings = /(^|\/)Beings\.save$/.test(path) && Array.isArray(raw)
    ? raw.filter((b) => isRec(b) && typeof b.index === "number").map((b) => b.index as number)
    : [];
  return { items, beings };
}

/** What `after` holds beyond `before`, counting each index as often as it occurs. */
function added(after: number[], before: number[]): number[] {
  const left = new Map<number, number>();
  for (const i of before) left.set(i, (left.get(i) ?? 0) + 1);
  return after.filter((i) => {
    const n = left.get(i) ?? 0;
    if (n) left.set(i, n - 1);
    return !n;
  });
}

/**
 * The names of the items and creatures that saving `preview` (EditSession.preview) over `saved` adds and game version `rules`
 * does not have; empty when the changes suit it. Only changed save files are read.
 */
export async function versionConflicts(saved: FileMap, preview: FileMap, rules: GameVersion): Promise<string[]> {
  const names = new Set<string>();
  for (const [path, file] of preview) {
    const was = saved.get(path);
    if (file === was || !path.endsWith(".save")) continue;
    const after = contents(path, decodeJson(await file.read()));
    const before = was ? contents(path, decodeJson(await was.read())) : { items: [], beings: [] };
    for (const i of added(after.items, before.items)) if (!hasItem(rules, i)) names.add(ITEM_NAMES[i] ?? `Item ${i}`);
    for (const i of added(after.beings, before.beings)) if (!hasBeing(rules, i)) names.add(BEING_NAMES[i] ?? `Being ${i}`);
  }
  return [...names];
}

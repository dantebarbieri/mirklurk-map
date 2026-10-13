import { parseBeings, parsePlaced } from "../save.ts";
import type { EditSession } from "./session.ts";

/** Placement uses draft creatures and stations, not the display loader's empty-on-error lists or its cached saved objects. */
export async function areaObjects(session: Pick<EditSession, "files" | "json">, dir: string) {
  const read = async <T>(name: string, parse: (raw: unknown) => T[]): Promise<T[]> => {
    const path = `${dir}${name}`;
    if (!session.files.has(path)) return [];
    try {
      return parse(await session.json(path));
    } catch (cause) {
      throw new Error(`${path}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
  };
  const beingsPath = `${dir}Beings.save`;
  const hasBeings = session.files.has(beingsPath);
  const [beings, stations] = await Promise.all([read("Beings.save", parseBeings), read("Stations.save", parsePlaced)]);
  return { beingsPath, hasBeings, beings, stations };
}

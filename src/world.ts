// Builds the world model for one character folder.

import type { FileMap } from "./files.ts";
import { ZONE_NAMES } from "./gamedata.ts";
import { centerpos, GRID } from "./rules.ts";
import {
  type Being,
  decodeHeights,
  decodeJson,
  decodeTilemap,
  type Grid,
  parseAreaDir,
  parseBeings,
  parseContainers,
  parsePlaced,
  parsePlayer,
  parseSolids,
  parseTrees,
  type Placed,
  type PlayerSave,
  type Solid,
  type Tree,
} from "./save.ts";
import { type Inventory, parseItemList } from "./inventory.ts";

export interface Zone {
  x: number;
  y: number;
  type: number;
  name: string;
  /** The game has generated this zone (it has a folder, a map or a visit time). */
  explored: boolean;
  lastVisit: [number, number] | null;
  /** Path of Maps/x_y.png, the map the game drew when it generated the zone. */
  mapPath?: string;
  /** Path prefix of the "[ x,y ]/" folder, when it was loaded. */
  dir?: string;
  solids: Solid[];
}

export interface Interior {
  zone: [number, number];
  /** Entrance position in the parent area (the folder name's last two numbers). */
  at: [number, number];
  dir: string;
  /** Area type of this interior (transPoint[0] of the entrance that leads here). */
  kind: number | null;
  /** The interior whose stairs lead here, for deeper levels. */
  parent: Interior | null;
  /** No saved solid leads here any more (e.g. Fort Solid after the explosion). */
  sealed: boolean;
  solids: Solid[];
}

/** Interior type implied by its way-out solid (manager_area Alarm_3 / dungeonlike_areas pick these frames). */
function kindFromExit(solids: Solid[], zoneType: number): number | null {
  for (const s of solids) {
    if (!s.transPoint) continue;
    if (s.sprite === "spr_stairs_natural32x32") return [10, 20, 24][s.pic] ?? null; // frame families: cave, ruin, rift
    if (s.sprite === "spr_placed_16x16") {
      const k = ({ 4: 30, 9: 32, 10: 33, 13: 35 } as Record<number, number>)[s.pic];
      if (k) return k;
      if (s.pic === 5) return zoneType === 3 || zoneType === 5 ? 34 : 31;
    }
  }
  return null;
}

export interface World {
  character: string;
  player: PlayerSave;
  zones: Zone[][];
  interiors: Interior[];
  warnings: string[];
  files: FileMap;
  savedAt?: number;
}

export async function readJson(files: FileMap, path: string): Promise<unknown | undefined> {
  const src = files.get(path);
  if (!src) return undefined;
  return decodeJson(await src.read());
}

export async function loadWorld(files: FileMap, root: string, character: string): Promise<World> {
  const warnings: string[] = [];
  const player = parsePlayer(await readJson(files, `${root}Player.save`));

  const exteriorDirs = new Map<string, string>();
  const interiorDirs: { zone: [number, number]; at: [number, number]; dir: string }[] = [];
  const maps = new Map<string, string>();
  const seenDirs = new Set<string>();
  for (const path of files.keys()) {
    if (!path.startsWith(root)) continue;
    const rel = path.slice(root.length);
    const map = /^Maps\/(\d)_(\d)\.png$/.exec(rel);
    if (map) {
      maps.set(`${map[1]},${map[2]}`, path);
      continue;
    }
    const slash = rel.indexOf("/");
    if (slash < 0) continue;
    const dirName = rel.slice(0, slash);
    if (seenDirs.has(dirName)) continue;
    seenDirs.add(dirName);
    const nums = parseAreaDir(dirName);
    const dir = `${root}${dirName}/`;
    if (nums?.length === 2) exteriorDirs.set(`${nums[0]},${nums[1]}`, dir);
    else if (nums?.length === 4) interiorDirs.push({ zone: [nums[0], nums[1]], at: [nums[2], nums[3]], dir });
    else if (/^RW[123]$/.test(dirName)) {
      const lair = player.riftQuestArea ?? [-1, -1];
      interiorDirs.push({ zone: lair, at: [-1, Number(dirName[2])], dir });
    }
  }

  const solidsOf = async (dir: string): Promise<Solid[]> => {
    try {
      return parseSolids(await readJson(files, `${dir}Solids.save`));
    } catch (e) {
      warnings.push(`${dir}Solids.save: ${(e as Error).message}`);
      return [];
    }
  };

  const zones: Zone[][] = [];
  for (let y = 0; y < GRID; y++) {
    const row: Zone[] = [];
    for (let x = 0; x < GRID; x++) {
      const type = player.grid[y][x];
      const dir = exteriorDirs.get(`${x},${y}`);
      const mapPath = maps.get(`${x},${y}`);
      const lastVisit = player.lastVisit[y][x];
      row.push({
        x,
        y,
        type,
        name: ZONE_NAMES[type] ?? `Unknown zone (${type})`,
        explored: !!(dir || mapPath || lastVisit),
        lastVisit,
        mapPath,
        dir,
        solids: dir ? await solidsOf(dir) : [],
      });
    }
    zones.push(row);
  }

  const interiors: Interior[] = [];
  for (const d of interiorDirs) {
    interiors.push({ ...d, kind: null, parent: null, sealed: false, solids: await solidsOf(d.dir) });
  }
  const leadsTo = (s: Solid, at: [number, number]) =>
    s.transPoint && s.transPoint.length >= 3 && centerpos(s.transPoint[1]) === at[0] && centerpos(s.transPoint[2]) === at[1];
  for (const it of interiors) {
    if (it.at[0] === -1) {
      it.kind = 23 + it.at[1];
      const upper = it.at[1] > 1 ? interiors.find((o) => o.at[0] === -1 && o.at[1] === it.at[1] - 1) : undefined;
      it.parent = upper ?? null;
      continue;
    }
    const [zx, zy] = it.zone;
    const ext = zones[zy]?.[zx]?.solids.find((s) => leadsTo(s, it.at));
    if (ext) {
      it.kind = ext.transPoint![0];
      continue;
    }
    for (const other of interiors) {
      if (other === it || other.zone[0] !== zx || other.zone[1] !== zy) continue;
      const stairs = other.solids.find((s) => leadsTo(s, it.at) && s.transPoint![0] !== zones[zy]?.[zx]?.type);
      if (stairs) {
        it.kind = stairs.transPoint![0];
        it.parent = other;
        break;
      }
    }
    if (it.kind === null) {
      it.kind = kindFromExit(it.solids, zones[zy]?.[zx]?.type ?? -1);
      it.sealed = !!zones[zy]?.[zx]?.dir;
    }
  }

  return { character, player, zones, interiors, warnings, files, savedAt: files.get(`${root}Player.save`)?.lastModified };
}

export interface ZoneDetail {
  beings: Being[];
  containers: Placed[];
  stations: Placed[];
  interactables: Placed[];
  decorations: Placed[];
  groundLoot?: { x: number; y: number; inventory: Inventory }[];
}

async function tryList<T>(world: World, path: string, parse: (raw: unknown) => T[]): Promise<T[]> {
  try {
    const raw = await readJson(world.files, path);
    return raw === undefined ? [] : parse(raw);
  } catch (e) {
    world.warnings.push(`${path}: ${(e as Error).message}`);
    return [];
  }
}

const detailCache = new WeakMap<object, Map<string, Promise<ZoneDetail>>>();

/** Beings, loot and placed objects of an area folder (zone or interior). */
export function loadDetail(world: World, dir: string): Promise<ZoneDetail> {
  let cache = detailCache.get(world);
  if (!cache) detailCache.set(world, cache = new Map());
  let p = cache.get(dir);
  if (!p) {
    p = (async () => ({
      beings: await tryList(world, `${dir}Beings.save`, parseBeings),
      containers: await tryList(
        world,
        `${dir}Containers.save`,
        (raw) => parseContainers(raw, (message) => world.warnings.push(`${dir}Containers.save: ${message}`)),
      ),
      stations: await tryList(world, `${dir}Stations.save`, parsePlaced),
      interactables: await tryList(world, `${dir}Interactables.save`, parsePlaced),
      decorations: await tryList(world, `${dir}Decoration.save`, parsePlaced),
      groundLoot: await loadGroundLoot(world, dir),
    }))();
    cache.set(dir, p);
  }
  return p;
}

async function loadGroundLoot(world: World, dir: string): Promise<NonNullable<ZoneDetail["groundLoot"]>> {
  const out: NonNullable<ZoneDetail["groundLoot"]> = [];
  for (const path of world.files.keys()) {
    if (!path.startsWith(dir)) continue;
    const match = /^LOOT-(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)\.save$/.exec(path.slice(dir.length));
    if (!match) continue;
    let inventory: Inventory;
    try {
      inventory = parseItemList(await readJson(world.files, path));
    } catch (e) {
      const reason = `${path}: ${(e as Error).message}`;
      world.warnings.push(reason);
      inventory = { state: "unavailable", reason };
    }
    out.push({ x: Number(match[1]), y: Number(match[2]), inventory });
  }
  return out;
}

const treeCache = new WeakMap<object, Map<string, Promise<Tree[]>>>();

/** Saved plants of an area folder, parsed once per world like `loadDetail`. */
export function loadTrees(world: World, dir: string): Promise<Tree[]> {
  let cache = treeCache.get(world);
  if (!cache) treeCache.set(world, cache = new Map());
  let p = cache.get(dir);
  if (!p) cache.set(dir, p = tryList(world, `${dir}Trees.save`, parseTrees));
  return p;
}

export async function loadLayer(world: World, dir: string, layer: string): Promise<Grid<Uint32Array> | null> {
  const src = world.files.get(`${dir}${layer}.tmap`);
  if (!src) return null;
  try {
    return decodeTilemap(await src.read());
  } catch (e) {
    world.warnings.push(`${dir}${layer}.tmap: ${(e as Error).message}`);
    return null;
  }
}

export async function loadHeights(world: World, dir: string): Promise<Grid<Float32Array> | null> {
  const src = world.files.get(`${dir}Ygrid.save`);
  if (!src) return null;
  try {
    return decodeHeights(await src.read());
  } catch (e) {
    world.warnings.push(`${dir}Ygrid.save: ${(e as Error).message}`);
    return null;
  }
}

export const interiorsOf = (world: World, x: number, y: number) => world.interiors.filter((i) => i.zone[0] === x && i.zone[1] === y);

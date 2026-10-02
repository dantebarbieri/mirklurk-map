// Decoders for Mirklurk save files (gml_GlobalScript_scr_saveload).

import { TILES } from "./rules.ts";
import { containerInventory, type Inventory, parseItemList } from "./inventory.ts";

/** save_datajson: UTF-8 JSON written with buffer_string, so it ends in one NUL byte. */
export function decodeJson(bytes: Uint8Array): unknown {
  let end = bytes.length;
  if (end > 0 && bytes[end - 1] === 0) end--;
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start, end));
  if (text.trim() === "") return [];
  return JSON.parse(text);
}

export interface Grid<T extends Uint32Array | Float32Array> {
  w: number;
  h: number;
  data: T;
}

function header(bytes: Uint8Array): [DataView, number, number] {
  if (bytes.length < 8) throw new Error("grid file is too short");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = dv.getUint32(0, true), h = dv.getUint32(4, true);
  if (w !== TILES || h !== TILES || bytes.length !== 8 + w * h * 4) {
    throw new Error(`unexpected grid size ${w}x${h} (${bytes.length} bytes)`);
  }
  return [dv, w, h];
}

/** save_layer: two u32 dimensions, then row-major u32 tile data. */
export function decodeTilemap(bytes: Uint8Array): Grid<Uint32Array> {
  const [dv, w, h] = header(bytes);
  const data = new Uint32Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = dv.getUint32(8 + i * 4, true);
  return { w, h, data };
}

/** save_grid (Ygrid.save): two u32 dimensions, then row-major f32 heights. */
export function decodeHeights(bytes: Uint8Array): Grid<Float32Array> {
  const [dv, w, h] = header(bytes);
  const data = new Float32Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = dv.getFloat32(8 + i * 4, true);
  return { w, h, data };
}

/** Area folder names are GameMaker's string() of an array: "[ 2,1 ]" or "[ 2,1,568,968 ]". */
export function parseAreaDir(name: string): number[] | null {
  const m = /^\[\s*(-?\d+(?:\s*,\s*-?\d+)*)\s*\]$/.exec(name);
  return m ? m[1].split(",").map((s) => Number(s.trim())) : null;
}

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const pair = (v: unknown): [number, number] | null =>
  Array.isArray(v) && v.length >= 2 && typeof v[0] === "number" && typeof v[1] === "number" ? [v[0], v[1]] : null;

export interface PlayerSave {
  version: string;
  grid: number[][]; // [y][x], as grid_to_array writes it
  lastVisit: ([number, number] | null)[][];
  area: { x: number; y: number; type: number };
  pos: [number, number];
  entrance: [number, number];
  mainQuest: number;
  day: number;
  daysAlive: number;
  rangerCamp: [number, number] | null;
  libraryArea: [number, number] | null;
  riftQuestArea: [number, number] | null;
  gurbsHut: boolean;
  shipWreck: boolean;
  inventory?: Inventory;
}

export function parsePlayer(raw: unknown): PlayerSave {
  const arr = raw as Record<string, unknown>[];
  const p = Array.isArray(arr) ? arr[arr.length - 1] : undefined;
  if (!p || typeof p !== "object") throw new Error("Player.save has no player record");
  const grid = p.worldGrid;
  if (!Array.isArray(grid) || grid.length !== 5 || grid.some((r) => !Array.isArray(r) || r.length !== 5)) {
    throw new Error("Player.save has no 5×5 worldGrid");
  }
  const mem = Array.isArray(p.worldGridMem) ? (p.worldGridMem as unknown[][]) : [];
  return {
    version: typeof p.VERSION === "string" ? p.VERSION : "?",
    grid: (grid as unknown[][]).map((r) => r.map((v) => num(v, -4))),
    lastVisit: [0, 1, 2, 3, 4].map((y) => [0, 1, 2, 3, 4].map((x) => pair(mem[y]?.[x]))),
    area: { x: num(p.areaX), y: num(p.areaY), type: num(p.areaType) },
    pos: [num(p.xx), num(p.yy)],
    entrance: [num(p.entranceX), num(p.entranceY)],
    mainQuest: num(p.mainQ),
    day: num(p.MDday),
    daysAlive: num(p.daysAlive),
    rangerCamp: pair(p.rangerCamp),
    libraryArea: pair(p.libraryArea),
    riftQuestArea: pair(p.riftQuestArea),
    gurbsHut: p.gurbsHut === true,
    shipWreck: p.shipWreck === true,
    inventory: parseItemList(p.myEquips),
  };
}

export interface Solid {
  sprite: string;
  pic: number;
  index: number;
  x: number;
  y: number;
  transPoint: number[] | null;
}

export interface Being {
  index: number;
  state: number;
  x: number;
  y: number;
}

export interface Placed {
  sprite: string;
  pic: number;
  index: number;
  status: number;
  x: number;
  y: number;
  object?: string;
  inventory?: Inventory;
}

export interface Tree {
  index: number;
  x: number;
  y: number;
  /** Saved procedural branch geometry, in obj_tree's partArray layout. */
  parts?: number[][];
}

const list = (raw: unknown) => (Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");

export const parseSolids = (raw: unknown): Solid[] =>
  list(raw).map((s) => ({
    sprite: str(s.sprite),
    pic: Math.floor(num(s.pic)),
    index: num(s.index, -4),
    x: num(s.x),
    y: num(s.y),
    transPoint: Array.isArray(s.transPoint) ? (s.transPoint as unknown[]).map((v) => num(v)) : null,
  }));

export const parseBeings = (raw: unknown): Being[] =>
  list(raw).map((b) => ({ index: num(b.index, -1), state: num(b.state), x: num(b.x), y: num(b.y) }));

/** Containers, stations, interactables and decorations share this shape. */
export const parsePlaced = (raw: unknown): Placed[] =>
  list(raw).map((c) => ({
    sprite: str(c.sprite),
    pic: Math.floor(num(c.pic)),
    index: num(c.index, -4),
    status: num(c.status, -200),
    x: num(c.x),
    y: num(c.y),
    object: typeof c.object === "string" ? c.object : undefined,
  }));

export const parseContainers = (raw: unknown): Placed[] => {
  if (!Array.isArray(raw)) throw new Error("Invalid containers list");
  const placed = parsePlaced(raw);
  return placed.map((c, i) => ({ ...c, inventory: containerInventory(raw[i]) }));
};

export const parseTrees = (raw: unknown): Tree[] =>
  list(raw).map((t) => {
    if (
      t.partArray !== undefined && (!Array.isArray(t.partArray) ||
        t.partArray.some((p) => !Array.isArray(p) || p.length < 25 || p.some((v) => typeof v !== "number" || !Number.isFinite(v))))
    ) {
      throw new Error("Invalid saved tree branch geometry");
    }
    return { index: num(t.index, -1), x: num(t.x), y: num(t.y), parts: t.partArray as number[][] | undefined };
  });

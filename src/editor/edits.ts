// Save editor: changes to a character's Player.save record, written the way the game itself leaves them (Mirklurk 0.8.1.5,
// gml_GlobalScript_scr_saveload's save_player/load_player). Every function edits the raw parsed record in place and keeps every key
// it does not own, because load_player reads almost all of them without checking that they exist.

import { Hp } from "../health.ts";
import { MAX_LEVEL, xpForLevel } from "../player.ts";
import { centerpos, INTERIOR_NAMES, isOutside, TILES } from "../rules.ts";
import type { PlayerSave } from "../save.ts";
import { SKY_KEYS, Weather, type WeatherState } from "../weather.ts";
import type { Interior } from "../world.ts";

export type Rec = Record<string, unknown>;

export const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
function wholeIn(v: number, lo: number, hi: number, what: string): number {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`${what} must be a whole number from ${lo} to ${hi}`);
  return v;
}

/** The record the game loads: the last element of Player.save's array (load_player array_pops it). */
export function playerRecord(raw: unknown): Rec {
  const p = Array.isArray(raw) ? raw[raw.length - 1] : undefined;
  if (!isRec(p)) throw new Error("Player.save has no player record");
  return p;
}

export const MAX_SKILL_POINTS = 99;

/** Unspent skill points; the game's skill menu spends them, one per rank. */
export function setSkillPoints(p: Rec, points: number) {
  p.skillPoints = wholeIn(points, 0, MAX_SKILL_POINTS, "Skill points");
}

/** Unplaced hit points from levelling up (hpAddPoints); the game lets you place them on the body grid. */
export function setNewHitPoints(p: Rec, points: number) {
  p.hpAddPoints = wholeIn(points, 0, MAX_SKILL_POINTS, "New hit points");
}

/**
 * A level-up (obj_player Step_1) subtracts the level's XP, adds the level and grants one skill point, and one hit point to place when
 * the new level is a multiple of 3. Changing the level grants or takes back those points as the game would, never below zero (points
 * already spent stay spent), and keeps XP under the new level's threshold so the game does not level up again on load.
 */
export function setLevel(p: Rec, level: number) {
  wholeIn(level, 1, MAX_LEVEL, "Level");
  const from = num(p.level, 1);
  p.level = level;
  p.skillPoints = Math.max(0, num(p.skillPoints) + level - from);
  p.hpAddPoints = Math.max(0, num(p.hpAddPoints) + Math.floor(level / 3) - Math.floor(from / 3));
  p.xp = Math.min(Math.max(0, num(p.xp)), xpForLevel(level) - 1);
}

export interface VitalsEdit {
  wellbeing?: number;
  satiation?: number;
  focus?: number;
  stamina?: number;
  warmth?: number;
}

/** Each vital eases towards its *Next target (obj_player Step_0); setting both makes the edit take hold at once. */
const VITAL_KEYS = {
  satiation: ["hunger", "hungerNext"],
  focus: ["focus", "focusNext"],
  stamina: ["energy", "energyNext"],
  warmth: ["warmth", "warmthNext"],
} as const;

/**
 * Values are 0–1, as the circle bar shows them. Wellbeing (haelth) is recomputed every second as the mean of the 25×25 wellbeing
 * grid's cells (wbgrid, obj_player Step_0), so the cells are set too, all to the same value.
 */
export function setVitals(p: Rec, v: VitalsEdit) {
  for (const [stat, [now, next]] of Object.entries(VITAL_KEYS)) {
    const value = v[stat as keyof typeof VITAL_KEYS];
    if (value === undefined) continue;
    p[now] = p[next] = clamp01(value);
  }
  if (v.wellbeing !== undefined) {
    const w = clamp01(v.wellbeing);
    p.haelth = p.nextHaelth = w;
    if (Array.isArray(p.wbgrid)) {
      for (const row of p.wbgrid) if (Array.isArray(row)) { for (const cell of row) if (isRec(cell)) cell.haelth = w; }
    }
  }
}

/**
 * Restores every lost (0) or burned (-1) hit point and clears poison, bleeding and stun (statusgrid). Armored hit points (2–4)
 * and empty cells (-4) are kept. Returns how many hit points came back.
 */
export function healPlayer(p: Rec): number {
  let healed = 0;
  if (Array.isArray(p.hpgrid)) {
    for (const row of p.hpgrid) {
      if (!Array.isArray(row)) continue;
      for (let x = 0; x < row.length; x++) {
        if (row[x] === Hp.Lost || row[x] === Hp.Burned) row[x] = Hp.Healthy, healed++;
      }
    }
  }
  if (Array.isArray(p.statusgrid)) p.statusgrid = p.statusgrid.map((row) => Array.isArray(row) ? row.map(() => []) : row);
  return healed;
}

export interface SkyEdit {
  day?: number;
  /** Minutes since midnight, 0–1439. */
  minute?: number;
  weather?: WeatherState;
  /** Rain strength 0.08–1, used only when the weather is Rain. */
  rain?: number;
  /** World temperature 0–1; the game eases it back towards the hour's usual value each turn. */
  temperature?: number;
}

/** player_endturn starts rain at f_r(0.08, 1) and keeps it at least that while it rains. */
export const MIN_RAIN = 0.08;
export const MAX_DAY = 9999;
const rainIn = (v: number) => Math.min(1, Math.max(MIN_RAIN, v));

/**
 * Time and weather in manager_day's saved keys. Weather is written the way player_endturn leaves it: Clear has no cloud or rain,
 * Cloudy has cloud and no rain, Rain has cloud and rain of at least 0.08. Changing the day moves daysAlive with it.
 */
export function setSky(p: Rec, e: SkyEdit) {
  if (e.day !== undefined) {
    const day = wholeIn(e.day, 1, MAX_DAY, "Day");
    p.daysAlive = Math.max(0, num(p.daysAlive) + day - num(p[SKY_KEYS.day], 1));
    p[SKY_KEYS.day] = day;
  }
  if (e.minute !== undefined) p[SKY_KEYS.minute] = wholeIn(e.minute, 0, 24 * 60 - 1, "Minute");
  if (e.temperature !== undefined) p[SKY_KEYS.temperature] = clamp01(e.temperature);
  if (e.weather !== undefined) {
    if (!(Object.values(Weather) as number[]).includes(e.weather)) throw new Error(`Unknown weather ${e.weather}`);
    p[SKY_KEYS.weather] = e.weather;
    p[SKY_KEYS.cloud] = e.weather === Weather.Clear ? 0 : 1;
    p[SKY_KEYS.rain] = e.weather === Weather.Rain ? rainIn(e.rain ?? Math.max(num(p[SKY_KEYS.rain]), 0.5)) : 0;
  } else if (e.rain !== undefined && p[SKY_KEYS.weather] === Weather.Rain) {
    p[SKY_KEYS.rain] = rainIn(e.rain);
  }
}

/** worldGrid is [y][x] of zone types (grid_to_array). */
export function zoneType(p: Rec, x: number, y: number): number | undefined {
  const row = Array.isArray(p.worldGrid) ? p.worldGrid[y] : undefined;
  const t = Array.isArray(row) ? row[x] : undefined;
  return typeof t === "number" ? t : undefined;
}

/**
 * An interior to stand in, as Player.save names it (savearea in scr_saveload): its area type, and the entrance it is entered by,
 * whose position (the last two numbers of its folder's name, [ x,y,ex,ey ]) the game keeps in entranceX/entranceY. Scaal's depths
 * (types 24–26, folders RW1–RW3) are named by their type alone, so they need no entrance.
 */
export interface Inside {
  type: number;
  entrance?: [number, number];
}

const isDepths = (type: number) => type >= 24 && type <= 26;

/**
 * You are saved in interior `it`: your area type is an interior's and names its folder as savearea does, Scaal's depths by type
 * and the rest by zone and entrance. Outdoors entranceX/entranceY still hold the last door you used, so they mean nothing there.
 */
export function isInside(p: PlayerSave, it: Interior): boolean {
  if (isOutside(p.area.type)) return false;
  if (isDepths(p.area.type)) return it.at[0] === -1 && it.at[1] === p.area.type - 23;
  return it.zone[0] === p.area.x && it.zone[1] === p.area.y && it.at[0] === centerpos(p.entrance[0]) &&
    it.at[1] === centerpos(p.entrance[1]);
}

/**
 * How Player.save names interior `it` (see Inside): the area type you are saved with when you are in it, otherwise the transPoint
 * of the entrance or stairs that lead there. Undefined when that is only a guess, because none is saved any more.
 */
export function insideOf(it: Interior, p: PlayerSave): Inside | undefined {
  const type = isInside(p, it) ? p.area.type : it.kindGuessed ? null : it.kind;
  if (type === null || isOutside(type) || !(type in INTERIOR_NAMES)) return undefined;
  return it.at[0] === -1 ? { type } : { type, entrance: [it.at[0], it.at[1]] };
}

/**
 * Puts the player on a tile of an outdoor zone, or of one of its interiors (`inside`). The game stands the player on tile centres
 * and loads the area named by areaX/areaY/areaType (and, inside, entranceX/entranceY) from its folder, so the area must already
 * exist (the caller checks the folder). A raft (ensureRaft) is made under the player wherever they load.
 */
export function movePlayer(p: Rec, zoneX: number, zoneY: number, tileX: number, tileY: number, inside?: Inside) {
  const type = zoneType(p, zoneX, zoneY);
  if (inside) {
    if (type === undefined) throw new Error("That interior's zone is not in the world");
    if (isOutside(inside.type) || !(inside.type in INTERIOR_NAMES)) throw new Error(`Area type ${inside.type} is not an interior`);
    if (!inside.entrance && !isDepths(inside.type)) throw new Error("An interior is named by the entrance it is entered by");
  } else if (type === undefined || !isOutside(type)) throw new Error("The player can only be moved to an outdoor zone or an interior");
  wholeIn(tileX, 0, TILES - 1, "Tile column");
  wholeIn(tileY, 0, TILES - 1, "Tile row");
  p.areaX = zoneX;
  p.areaY = zoneY;
  p.areaType = inside ? inside.type : type;
  if (inside?.entrance) [p.entranceX, p.entranceY] = inside.entrance;
  p.xx = tileX * 16 + 8;
  p.yy = tileY * 16 + 8;
}

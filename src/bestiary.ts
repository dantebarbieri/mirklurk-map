// Combat stats of every creature and NPC, ported from Mirklurk 0.8.9.9 (decompiled GML).
// Sources: global.beingDB in gml_Object_databank_Alarm_3 (stats and its damage totals), the examine card (case 11 in
// gml_Object_UI_Draw_64), being_initiate in gml_GlobalScript_scr_basic_useful (a fresh being's hit points), attack_draw in
// gml_GlobalScript_scr_gui_general, aiming in gml_Object_manager_area_Step_0 and being_get_target in gml_GlobalScript_scr_ai_related.

import { roundGml } from "./chop.ts";
import { plural } from "./format.ts";
import { DAMAGE_CLASS_NAMES } from "./gamedata.ts";
import { atLeast, type GameVersion } from "./version.ts";

/** damageClass values ([DamageClasses] in UI.ini). */
export const DamageClass = { Poison: 2, Sharp: 14, Blunt: 15, Force: 16, Piercing: 17, Fire: 18, Weak: 24, Leeching: 27 } as const;

/** Teams whose beings never pick you as a target (being_get_target): 0, the NPCs, and 10, Wilda's Survivors and Grand Mother. */
const FRIENDLY_TEAMS = new Set([0, 10]);

export interface Attack {
  /** [row][column]: the whole part is the least damage a cell deals and the first decimal the most (1.2 is 1–2); 0 is no hit. */
  pattern: number[][];
  /** Absent when it deals no damage at all (Dead Unwanted's `noone`). */
  damageClass?: number;
  /** Reach in tiles, centre to centre (meleeDist / rangedDist); the examine card shows the whole part. */
  dist: number;
  /** AP per attack (attackCost / rangedAttackCost). */
  cost: number;
  /** How well it aims (attackIQ / rangedAttackIQ), 0 to 4; see `INTELLIGENCE`. */
  iq: number;
}

export interface BeingStats {
  /** hpgridsize: [width, height]. */
  grid: [number, number];
  /** XP for the kill, given only if you landed a hit on it (yieldsXP in attack_lands, obj_being Alarm_0). */
  xp: number;
  /** Armor layers a fresh one spreads over its hit points (see `freshHealth`). */
  armor: number;
  /** AP it has each turn. */
  apMax: number;
  /** Tiles it moves a turn; the examine card shows the whole part. */
  tilespeed: number;
  /** Tiles within which it picks targets it can see. */
  hostileDist: number;
  /** Chance each turn that it turns on a target it has picked. */
  hostileChance: number;
  /** Chance it shifts its grid aside when attacked (get_dodges). */
  dodgeChance: number;
  /** Chance it strikes at a target leaving its reach (being_ao_check); the databank fills in 0.33 when it is left out. */
  aooChance: number;
  /**
   * Beings pick targets only on other teams (team 8 also its own; Captain Eir and Magus Clay each other once Clay has fled);
   * teams 0 (the NPCs) and 10 (Wilda's Survivors) never target you.
   */
  team: number;
  melee: Attack;
  /** Only when rangedDist > 0, as the examine card shows it. */
  ranged?: Attack;
}

/** global.beingDB by being index (Bestiary.ini [Titles]). */
// deno-fmt-ignore
export const BEINGS: Record<number, BeingStats> = {
  0: { // Giant Slug
    grid: [2, 2], xp: 5, armor: 0, apMax: 2, tilespeed: 1.5, hostileDist: 1.6, hostileChance: 0.5,
    dodgeChance: 0, aooChance: 0.02, team: 4,
    melee: { pattern: [[0.1]], damageClass: 24, dist: 1.5, cost: 2, iq: 0 },
  },
  1: { // Dreadfly
    grid: [2, 2], xp: 15, armor: 0, apMax: 10, tilespeed: 8, hostileDist: 5, hostileChance: 0.65,
    dodgeChance: 0.225, aooChance: 0.33, team: 3,
    melee: { pattern: [[0.1, 0.1]], damageClass: 15, dist: 1.5, cost: 6, iq: 2 },
  },
  2: { // Giant Gnat
    grid: [1, 1], xp: 5, armor: 0, apMax: 5, tilespeed: 4, hostileDist: 5, hostileChance: 0.75,
    dodgeChance: 0.15, aooChance: 0.75, team: 3,
    melee: { pattern: [[1.1]], damageClass: 17, dist: 1.5, cost: 3, iq: 1 },
  },
  3: { // Swamp Troll
    grid: [5, 5], xp: 200, armor: 0, apMax: 10, tilespeed: 6, hostileDist: 7, hostileChance: 0.33,
    dodgeChance: 0, aooChance: 0.33, team: 9,
    melee: { pattern: [[1.1, 0.1, 1.1], [0.1, 1.1, 0.1], [1.1, 0.1, 1.1]], damageClass: 16, dist: 2.25, cost: 6, iq: 2 },
  },
  4: { // Mire Serpent
    grid: [3, 9], xp: 250, armor: 0, apMax: 10, tilespeed: 6, hostileDist: 12, hostileChance: 0.9,
    dodgeChance: 0.15, aooChance: 0.5, team: 3,
    melee: { pattern: [[1.3, 1.3], [1.3, 1.3]], damageClass: 2, dist: 3.25, cost: 6, iq: 3 },
  },
  5: { // Soldier
    grid: [4, 3], xp: 250, armor: 12, apMax: 10, tilespeed: 6, hostileDist: 12, hostileChance: 0.75,
    dodgeChance: 0.2, aooChance: 0.33, team: 0,
    melee: { pattern: [[0.1, 0.1], [0.1, 0.1]], damageClass: 15, dist: 1.5, cost: 6, iq: 3 },
    ranged: { pattern: [[1.2, 2.2], [2.2, 1.2]], damageClass: 17, dist: 14, cost: 6, iq: 3 },
  },
  6: { // Captain Eir
    grid: [5, 4], xp: 500, armor: 20, apMax: 10, tilespeed: 6, hostileDist: 7, hostileChance: 0.7,
    dodgeChance: 0.15, aooChance: 0.33, team: 0,
    melee: { pattern: [[0, 1.2, 0], [1.2, 2.2, 1.2], [0, 1.2, 0]], damageClass: 15, dist: 2.25, cost: 6, iq: 3 },
  },
  7: { // Boulder Crab
    grid: [2, 2], xp: 25, armor: 4, apMax: 8, tilespeed: 2.5, hostileDist: 2, hostileChance: 0.33,
    dodgeChance: 0.1, aooChance: 0.1, team: 3,
    melee: { pattern: [[1.1, 1.1]], damageClass: 17, dist: 1.5, cost: 6, iq: 1 },
  },
  8: { // Magus Clay
    grid: [4, 4], xp: 1200, armor: 0, apMax: 10, tilespeed: 6, hostileDist: 10, hostileChance: 0.65,
    dodgeChance: 0.1, aooChance: 0.33, team: 0,
    melee: { pattern: [[0.1, 0.1], [0.1, 0.1]], damageClass: 24, dist: 1.5, cost: 6, iq: 3 },
    ranged: { pattern: [[0.1, 0.1, 0.1], [0.1, 1.2, 0.1], [0.1, 0.1, 0.1]], damageClass: 18, dist: 10, cost: 7, iq: 3 },
  },
  9: { // Dead Unwanted
    grid: [4, 4], xp: 1200, armor: 0, apMax: 5, tilespeed: 2, hostileDist: 0, hostileChance: 0,
    dodgeChance: 0.15, aooChance: 0.33, team: 0,
    melee: { pattern: [[0.1, 0.1], [0.1, 0.1]], dist: 2.25, cost: 4, iq: 3 },
  },
  10: { // Viper
    grid: [1, 2], xp: 10, armor: 0, apMax: 5, tilespeed: 3, hostileDist: 5, hostileChance: 0.8,
    dodgeChance: 0.15, aooChance: 0.33, team: 7,
    melee: { pattern: [[1.3]], damageClass: 2, dist: 1.5, cost: 3, iq: 2 },
  },
  11: { // Mirk Runner
    grid: [3, 2], xp: 20, armor: 0, apMax: 10, tilespeed: 8, hostileDist: 5, hostileChance: 0.65,
    dodgeChance: 0.2, aooChance: 0.5, team: 3,
    melee: { pattern: [[0.1, 0], [0, 0.1]], damageClass: 17, dist: 1.5, cost: 6, iq: 2 },
  },
  12: { // Ranger Bhato
    grid: [3, 4], xp: 200, armor: 0, apMax: 10, tilespeed: 6, hostileDist: 15, hostileChance: 0.75,
    dodgeChance: 0.25, aooChance: 0.33, team: 0,
    melee: { pattern: [[1.2, 1.2, 1.2]], damageClass: 14, dist: 1.5, cost: 6, iq: 3 },
    ranged: { pattern: [[0, 1.1, 0], [1.1, 2.2, 1.1], [0, 1.1, 0]], damageClass: 17, dist: 15, cost: 7, iq: 3 },
  },
  13: { // Sceetler
    grid: [3, 3], xp: 30, armor: 0, apMax: 10, tilespeed: 8, hostileDist: 7, hostileChance: 0.65,
    dodgeChance: 0.15, aooChance: 0.15, team: 5,
    melee: { pattern: [[0.1, 0.1]], damageClass: 24, dist: 1.5, cost: 6, iq: 2 },
    ranged: { pattern: [[3.4]], damageClass: 2, dist: 7, cost: 6, iq: 2 },
  },
  14: { // Scaalmyr Grunt
    grid: [3, 3], xp: 50, armor: 9, apMax: 10, tilespeed: 5, hostileDist: 7, hostileChance: 0.33,
    dodgeChance: 0, aooChance: 0.33, team: 5,
    melee: { pattern: [[0.1, 1.1, 0.1], [0, 1.1, 0], [0, 1.1, 0]], damageClass: 15, dist: 1.5, cost: 6, iq: 3 },
  },
  15: { // Scaalmyr Warrior
    grid: [5, 3], xp: 125, armor: 15, apMax: 10, tilespeed: 7, hostileDist: 7, hostileChance: 1,
    dodgeChance: 0.12, aooChance: 0.6, team: 5,
    melee: { pattern: [[1.2, 0, 1.2], [0, 1.2, 0], [1.2, 0, 1.2]], damageClass: 14, dist: 2.25, cost: 6, iq: 3 },
  },
  16: { // Scaalmyr Geomancer
    grid: [5, 3], xp: 300, armor: 15, apMax: 10, tilespeed: 6, hostileDist: 7, hostileChance: 1,
    dodgeChance: 0.05, aooChance: 0.2, team: 5,
    melee: { pattern: [[0.2, 0, 0.2], [0, 2.3, 0], [0.2, 0, 0.2]], damageClass: 24, dist: 1.5, cost: 6, iq: 3 },
    ranged: { pattern: [[0.1, 0.1, 0.1], [0.1, 0.1, 0.1], [0.1, 0.1, 0.1]], damageClass: 18, dist: 8, cost: 6, iq: 3 },
  },
  17: { // Mudfin
    grid: [2, 3], xp: 25, armor: 0, apMax: 10, tilespeed: 4, hostileDist: 5, hostileChance: 1,
    dodgeChance: 0.25, aooChance: 0.33, team: 3,
    melee: { pattern: [[1.2, 1.2]], damageClass: 14, dist: 1.5, cost: 6, iq: 1 },
  },
  18: { // Cave Troll
    grid: [5, 5], xp: 200, armor: 25, apMax: 10, tilespeed: 5, hostileDist: 6, hostileChance: 0.67,
    dodgeChance: 0, aooChance: 0.33, team: 9,
    melee: { pattern: [[0.1, 1.2, 0.1], [1.2, 2.2, 1.2], [0.1, 1.2, 0.1]], damageClass: 15, dist: 2.25, cost: 6, iq: 1 },
  },
  19: { // Viend
    grid: [4, 3], xp: 1200, armor: 0, apMax: 10, tilespeed: 6, hostileDist: 1.6, hostileChance: 0.5,
    dodgeChance: 0.2, aooChance: 0.33, team: 0,
    melee: { pattern: [[0.1, 0.1], [0.1, 0.1]], damageClass: 24, dist: 1.5, cost: 6, iq: 3 },
  },
  20: { // Commander Tain
    grid: [5, 4], xp: 500, armor: 20, apMax: 10, tilespeed: 6, hostileDist: 7, hostileChance: 0,
    dodgeChance: 0, aooChance: 0.33, team: 0,
    melee: { pattern: [[0]], damageClass: 15, dist: 2.25, cost: 6, iq: 3 },
  },
  21: { // Toadkin
    grid: [5, 5], xp: 45, armor: 0, apMax: 10, tilespeed: 5, hostileDist: 7, hostileChance: 0.4,
    dodgeChance: 0.08, aooChance: 0.45, team: 6,
    melee: { pattern: [[0.1, 0.1], [0.1, 0.1]], damageClass: 15, dist: 1.5, cost: 6, iq: 3 },
  },
  22: { // Scaal
    grid: [9, 9], xp: 2500, armor: 0, apMax: 10, tilespeed: 6, hostileDist: 12, hostileChance: 1,
    dodgeChance: 0.05, aooChance: 0.5, team: 5,
    melee: { pattern: [[0.2, 1.2, 0.2], [1.2, 2.3, 1.2], [0.2, 1.2, 0.2]], damageClass: 15, dist: 2.25, cost: 6, iq: 3 },
    ranged: { pattern: [[0.1, 1.2, 0.1], [1.2, 3.3, 1.2], [0.1, 1.2, 0.1]], damageClass: 15, dist: 12, cost: 6, iq: 3 },
  },
  23: { // Red Fang
    grid: [1, 3], xp: 20, armor: 1, apMax: 5, tilespeed: 3, hostileDist: 7, hostileChance: 0.8,
    dodgeChance: 0.175, aooChance: 0.5, team: 7,
    melee: { pattern: [[2.4]], damageClass: 2, dist: 1.5, cost: 3, iq: 2 },
  },
  24: { // Razorfin
    grid: [2, 3], xp: 40, armor: 0, apMax: 10, tilespeed: 6, hostileDist: 6, hostileChance: 1,
    dodgeChance: 0.33, aooChance: 0.55, team: 3,
    melee: { pattern: [[4.6]], damageClass: 14, dist: 1.5, cost: 6, iq: 2 },
  },
  25: { // Deathfly
    grid: [4, 4], xp: 45, armor: 0, apMax: 10, tilespeed: 8, hostileDist: 7, hostileChance: 0.95,
    dodgeChance: 0.2, aooChance: 0.33, team: 3,
    melee: { pattern: [[1.2, 1.2], [1.2, 1.2]], damageClass: 15, dist: 1.5, cost: 6, iq: 3 },
  },
  26: { // Gurb-Gurb
    grid: [4, 4], xp: 500, armor: 0, apMax: 10, tilespeed: 6, hostileDist: 7, hostileChance: 0.7,
    dodgeChance: 0.15, aooChance: 0.33, team: 0,
    melee: { pattern: [[1.2, 1.2], [1.2, 1.2]], damageClass: 15, dist: 2.25, cost: 6, iq: 3 },
  },
  27: { // Firelouse
    grid: [2, 3], xp: 30, armor: 6, apMax: 10, tilespeed: 4, hostileDist: 4, hostileChance: 0.45,
    dodgeChance: 0.05, aooChance: 0.2, team: 3,
    melee: { pattern: [[1.2]], damageClass: 18, dist: 1.5, cost: 6, iq: 2 },
  },
  28: { // Nightmare
    grid: [3, 7], xp: 200, armor: 0, apMax: 10, tilespeed: 7, hostileDist: 12, hostileChance: 0.67,
    dodgeChance: 0.33, aooChance: 0.75, team: 8,
    melee: { pattern: [[0.1, 0, 0.1], [0, 1.2, 0], [0.1, 0, 0.1]], damageClass: 2, dist: 2.25, cost: 5, iq: 3 },
  },
  29: { // Mirk Mauler
    grid: [4, 2], xp: 40, armor: 0, apMax: 10, tilespeed: 8, hostileDist: 10, hostileChance: 0.75,
    dodgeChance: 0.33, aooChance: 0.65, team: 3,
    melee: { pattern: [[1.2, 0], [0, 1.2]], damageClass: 17, dist: 1.5, cost: 6, iq: 3 },
  },
  30: { // Titanspine Crab
    grid: [2, 2], xp: 50, armor: 12, apMax: 8, tilespeed: 2.5, hostileDist: 3, hostileChance: 0.5,
    dodgeChance: 0.1, aooChance: 0.15, team: 3,
    melee: { pattern: [[1.2, 1.2]], damageClass: 17, dist: 1.5, cost: 6, iq: 1 },
  },
  31: { // Raving Unwanted
    grid: [4, 2], xp: 30, armor: 0, apMax: 10, tilespeed: 6, hostileDist: 8, hostileChance: 0.5,
    dodgeChance: 0.25, aooChance: 0.45, team: 8,
    melee: { pattern: [[0.2, 0.2], [0.2, 0.2]], damageClass: 14, dist: 1.5, cost: 6, iq: 1 },
  },
  32: { // Mutated Unwanted
    grid: [3, 3], xp: 55, armor: 0, apMax: 10, tilespeed: 8, hostileDist: 10, hostileChance: 0.25,
    dodgeChance: 0.35, aooChance: 0.75, team: 5,
    melee: { pattern: [[0.2, 1.2], [1.2, 0.2]], damageClass: 17, dist: 1.5, cost: 6, iq: 3 },
  },
  33: { // Ihar
    grid: [4, 4], xp: 500, armor: 0, apMax: 10, tilespeed: 1, hostileDist: 7, hostileChance: 0.7,
    dodgeChance: 0.15, aooChance: 0.33, team: 0,
    melee: { pattern: [[1.2, 1.2], [1.2, 1.2]], damageClass: 15, dist: 2.25, cost: 6, iq: 3 },
  },
  34: { // Wilda
    grid: [4, 4], xp: 200, armor: 0, apMax: 10, tilespeed: 6, hostileDist: 14, hostileChance: 0.85,
    dodgeChance: 0.25, aooChance: 0.33, team: 10,
    melee: { pattern: [[0, 1.1, 0], [1.1, 2.3, 1.1], [0, 1.1, 0]], damageClass: 17, dist: 2.25, cost: 6, iq: 3 },
    ranged: { pattern: [[0, 1.2, 0], [1.2, 3.3, 1.2], [0, 1.2, 0]], damageClass: 17, dist: 12, cost: 7, iq: 3 },
  },
  35: { // Survivor
    grid: [4, 3], xp: 150, armor: 0, apMax: 10, tilespeed: 6, hostileDist: 12, hostileChance: 0.85,
    dodgeChance: 0.25, aooChance: 0.33, team: 10,
    melee: { pattern: [[0, 1.1, 0], [1.1, 2.2, 1.1], [0, 1.1, 0]], damageClass: 17, dist: 2.25, cost: 6, iq: 3 },
  },
  36: { // Grand Mother
    grid: [5, 4], xp: 500, armor: 0, apMax: 10, tilespeed: 6, hostileDist: 7, hostileChance: 0,
    dodgeChance: 0, aooChance: 0.33, team: 10,
    melee: { pattern: [[0]], damageClass: 15, dist: 2.25, cost: 6, iq: 3 },
  },
  37: { // Mirkfang Matriarch
    grid: [9, 5], xp: 300, armor: 0, apMax: 10, tilespeed: 10, hostileDist: 10, hostileChance: 0.55,
    dodgeChance: 0.3, aooChance: 0.33, team: 11,
    melee: { pattern: [[2.3, 0, 2.3], [1.2, 0, 1.2]], damageClass: 27, dist: 1.5, cost: 5, iq: 3 },
  },
  38: { // Mirkfang
    grid: [3, 3], xp: 25, armor: 0, apMax: 10, tilespeed: 8, hostileDist: 10, hostileChance: 0.5,
    dodgeChance: 0.4, aooChance: 0.33, team: 11,
    melee: { pattern: [[0.1, 0, 0.1]], damageClass: 27, dist: 1.5, cost: 6, iq: 2 },
  },
  39: { // Giant Mirkfang
    grid: [5, 4], xp: 50, armor: 0, apMax: 10, tilespeed: 8, hostileDist: 10, hostileChance: 0.5,
    dodgeChance: 0.35, aooChance: 0.33, team: 11,
    melee: { pattern: [[1.2, 0, 1.2]], damageClass: 27, dist: 1.5, cost: 6, iq: 3 },
  },
  40: { // The Terror
    grid: [9, 5], xp: 500, armor: 0, apMax: 10, tilespeed: 9, hostileDist: 9, hostileChance: 0.75,
    dodgeChance: 0.25, aooChance: 0.33, team: 11,
    melee: { pattern: [[2.3, 0, 2.3], [1.2, 0, 1.2]], damageClass: 27, dist: 1.5, cost: 5, iq: 3 },
  },
  41: { // Magus Clay, in his realm
    grid: [7, 7], xp: 750, armor: 0, apMax: 10, tilespeed: 6, hostileDist: 10, hostileChance: 1,
    dodgeChance: 0.25, aooChance: 0.33, team: 8,
    melee: { pattern: [[1.2, 2.2], [2.2, 1.2]], damageClass: 18, dist: 1.5, cost: 5, iq: 3 },
    ranged: { pattern: [[1.1, 2.2, 1.1], [2.2, 3.3, 2.2], [1.1, 2.2, 1.1]], damageClass: 18, dist: 16, cost: 5, iq: 3 },
  },
};

export const hasRanged = (being: number) => (BEINGS[being]?.ranged?.dist ?? 0) > 0;

export interface Damage {
  min: number;
  max: number;
}

/** A pattern cell as the game reads it (databank damage totals, attack_draw): 1.2 is 1–2, 0.1 is 0–1, 0 is no hit. */
export function damageCell(v: number): Damage | undefined {
  if (!(v > 0)) return undefined;
  const min = Math.floor(v);
  return { min, max: roundGml((v - min) * 10) };
}

/** "2" or "1–2", as attack_draw prints a cell. */
export const damageText = (d: Damage) => (d.min === d.max ? `${d.min}` : `${d.min}–${d.max}`);

/** Every cell's damage added up, as the databank does for its `damage` / `rangedDamage` totals. */
export function totalDamage(pattern: number[][]): Damage {
  const sum = { min: 0, max: 0 };
  for (const d of pattern.flat().map(damageCell)) {
    if (d) sum.min += d.min, sum.max += d.max;
  }
  return sum;
}

/** It can hurt: it has a damage class and a pattern that deals something (Commander Tain's [[0]] does not). */
export const canHurt = (a: Attack) => a.damageClass !== undefined && totalDamage(a.pattern).max > 0;

/** Teams 0 and 10 (the NPCs, Wilda's Survivors, Grand Mother and the Dead Unwanted) never pick you as a target (being_get_target). */
export const targetsYou = (s: BeingStats) => !FRIENDLY_TEAMS.has(s.team);

/** [TTgen] 11–15 in UI.ini by attackIQ, paraphrased. */
export const INTELLIGENCE = [
  { name: "Zero", aim: "strikes at random, even at hit points already lost" },
  { name: "Low", aim: "aims at any hit point at random" },
  { name: "Medium", aim: "keeps its pattern on your grid, so fewer blows miss" },
  { name: "High", aim: "aims at clusters of hit points, sparing ones already bleeding or poisoned" },
  { name: "Highest", aim: "picks the spot and turn of its pattern that deal the most damage" },
] as const;

/** On Hard (myDiff 3) beings aim one level better, up to Highest (manager_area Step_0). */
export const hardIq = (iq: number) => Math.min(INTELLIGENCE.length - 1, iq + 1);

/**
 * Whether the pattern may land turned by quarter turns (being_get_attack_xy): Sharp blows at random (that sets the way they
 * bleed), High intelligence tries a random turn at each spot and Highest every turn.
 */
export const turnsPattern = (a: Attack, iq = a.iq) => a.damageClass === DamageClass.Sharp || iq >= 3;

export interface DamageClassInfo {
  name: string;
  /** What it does besides the damage ([TTgen] 32–39 in UI.ini, paraphrased; attack_lands, attack_aftermath). */
  effect: string;
  /** Lower-case key for its colour (CSS class `dmg-<key>`). */
  key: string;
}

const EFFECTS: Record<number, [key: string, effect: string]> = {
  [DamageClass.Sharp]: [
    "sharp",
    "Bleeding: hurts at the start of the target's turn, stacks and spreads the way the blow struck, even under armor. A blow on armor only breaks armor.",
  ],
  [DamageClass.Poison]: [
    "poison",
    "Hurts at the start of the target's turn, stacks and spreads to a random neighbour, even under armor. A blow on armor only breaks armor.",
  ],
  [DamageClass.Blunt]: ["blunt", "10% base chance to stun, so the target misses a turn."], // 12% before 0.8.9.9 (attack_aftermath)
  [DamageClass.Piercing]: ["piercing", "15% chance per hit to deal 1 extra damage."],
  [DamageClass.Force]: ["force", "15% chance per hit to also deal 1 damage to a neighbouring hit point."],
  [DamageClass.Fire]: ["fire", "Burns: a hit point it destroys cannot regenerate or be healed until treated."],
  [DamageClass.Weak]: ["weak", "No extra effect."],
  [DamageClass.Leeching]: [
    "leeching",
    "Each hit point it destroys heals one of the attacker's own, which also takes over any poison on the hit point destroyed.",
  ],
};

/** What a damage class does under `rules`: Blunt blows stunned 12% of the time before 0.8.9.9 (attack_aftermath, [TTgen] 33). */
export function damageClassInfo(damageClass: number | undefined, rules: GameVersion): DamageClassInfo | undefined {
  if (damageClass === undefined) return undefined;
  const [key, effect] = EFFECTS[damageClass] ?? ["weak", ""];
  const then = damageClass === DamageClass.Blunt && !atLeast(rules, "0.8.9.9") ? effect.replace(/^10%/, "12%") : effect;
  return { name: DAMAGE_CLASS_NAMES[damageClass] ?? `Class ${damageClass}`, effect: then, key };
}

/** textf_floatpercent: whole percentages without decimals, others with one. */
export function formatPercent(v: number): string {
  const p = roundGml(v * 10000) / 100;
  return `${Number.isInteger(p) ? p : p.toFixed(1)}%`;
}

/** A distance as the examine card prints it: the whole tiles. */
export const formatTiles = (dist: number) => plural(Math.floor(dist), "tile");

/** being_initiate's per-species hit-point shapes, as ds_grid (x, y) cells: -4 holes, and extra layers (armor) on top. */
const HOLES: Record<number, [number, number][]> = {
  13: [[0, 0], [0, 2], [2, 0], [2, 2]],
  25: [[0, 0], [0, 3], [3, 0], [3, 3]],
  28: [[2, 0], [0, 1], [2, 2], [0, 3], [2, 4], [0, 5], [2, 6]],
  21: [[0, 0], [0, 1], [1, 0], [4, 0], [4, 1], [3, 0], [0, 4], [0, 3], [1, 4], [4, 4], [4, 3], [3, 4]],
  38: [[1, 0], [0, 2], [2, 2]],
  39: [[1, 0], [3, 0], [0, 2], [4, 2], [0, 3], [1, 3], [3, 3], [4, 3]],
};
const EXTRA: Record<number, [number, number, number][]> = {
  13: [[1, 1, 3]],
  34: [[1, 1, 1], [2, 1, 1], [1, 2, 1], [2, 2, 1]],
  35: [[1, 1, 2], [2, 1, 1], [1, 2, 1], [2, 2, 2]],
};
const SCAAL = 22, MIRK_MAULER = 29, MATRIARCH = 37, TERROR = 40;
/** A Mirkfang Matriarch's and The Terror's 9 by 5 grid: wings with holes, and a body down the middle under extra layers. */
const MATRIARCH_HOLES: [number, number][] = [
  [0, 2],
  [0, 3],
  [1, 3],
  [1, 0],
  [2, 0],
  [3, 0],
  [5, 0],
  [6, 0],
  [7, 0],
  [7, 3],
  [8, 3],
  [8, 2],
  [0, 4],
  [1, 4],
  [2, 4],
  [8, 4],
  [7, 4],
  [6, 4],
];
const MATRIARCH_BODY: [number, number][] = [[4, 0], ...[1, 2, 3, 4].flatMap((y): [number, number][] => [[3, y], [4, y], [5, y]])];

/**
 * The hpgrid ([y][x], as saves store it) a newly spawned being has: being_initiate's shape for its species, then its armor
 * laid one layer at a time over the hit points row by row (at most 3 per cell, 128 passes). Undefined for unknown beings.
 */
export function freshHealth(being: number): number[][] | undefined {
  const s = BEINGS[being];
  if (!s) return undefined;
  const [w, hh] = s.grid;
  const g = Array.from({ length: hh }, () => Array<number>(w).fill(1));
  for (const [x, y] of HOLES[being] ?? []) g[y][x] = -4;
  for (const [x, y, n] of EXTRA[being] ?? []) g[y][x] += n;
  if (being === SCAAL) {
    // lerp(4, 0, distance from the centre / 8), rounded; a 0 would be a hole.
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < w; x++) {
        const v = roundGml(4 - 4 * (Math.sqrt((x - 4) ** 2 + (y - 4) ** 2) / 8));
        g[y][x] = v === 0 ? -4 : v;
      }
    }
  } else if (being === MIRK_MAULER) {
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if ((x + y) % 2 === 0) g[y][x]++;
  } else if (being === MATRIARCH || being === TERROR) {
    for (const [x, y] of MATRIARCH_HOLES) g[y][x] = -4;
    for (const [x, y] of MATRIARCH_BODY) g[y][x] = being === TERROR ? 3 : 2;
    // The Terror also has a layer on each of the other hit points in her top two rows.
    if (being === TERROR) { for (let y = 0; y < 2; y++) for (let x = 0; x < w; x++) if (g[y][x] === 1) g[y][x] = 2; }
  }
  let armor = Math.min(s.armor, w * hh * 3);
  for (let tries = 0; armor > 0 && tries < 128; tries++) {
    for (let y = 0; y < hh && armor > 0; y++) {
      for (let x = 0; x < w && armor > 0; x++) {
        if (g[y][x] >= 1 && g[y][x] < 4) g[y][x]++, armor--;
      }
    }
  }
  return g;
}

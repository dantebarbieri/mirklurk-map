// Hit-point grids of the player and of beings as saved (hpgrid and statusgrid), ported from Mirklurk 0.8.1.5.
// Sources: attack_lands and the turn-start poison/bleed effects in gml_GlobalScript_scr_basic_useful, hpcell_draw in
// gml_GlobalScript_scr_gui_general, statusgrid_get in gml_GlobalScript_scr_gen_ingamers, being_initiate's armor.

import { h, s } from "./dom.ts";

/** Lasting statusgrid entries; the others (hit, miss and armor-break flashes) are animations that fade within a second. */
export const Status = { Poison: 2, BleedUp: 10, BleedRight: 11, BleedDown: 12, BleedLeft: 13, Stunned: 23 } as const;

/** hpgrid values: -4 is no hit point at all; 2–4 are a healthy hit point under 1–3 armor. */
export const Hp = { None: -4, Burned: -1, Lost: 0, Healthy: 1 } as const;

export interface HealthCell {
  /** Saved hpgrid value (see `Hp`). */
  hp: number;
  /** Poison stacks: each takes the hit point at the start of a turn, then the rest spread to a living neighbour. */
  poison: number;
  /** Bleed stacks by the way they spread once the hit point is lost: up, right, down, left. */
  bleed: [number, number, number, number];
}

export interface HealthGrid {
  w: number;
  h: number;
  /** [y][x], as grid_to_array writes it. */
  cells: HealthCell[][];
  /** Stunned: misses its next turn (blunt damage). */
  stunned: boolean;
}

export type CellKind = "none" | "burned" | "lost" | "healthy";

export const cellKind = (c: HealthCell): CellKind =>
  c.hp >= Hp.Healthy ? "healthy" : c.hp === Hp.Lost ? "lost" : c.hp === Hp.Burned ? "burned" : "none";
export const cellArmor = (c: HealthCell) => Math.max(0, Math.min(3, c.hp - 1));
export const cellBleed = (c: HealthCell) => c.bleed[0] + c.bleed[1] + c.bleed[2] + c.bleed[3];

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const rectangular = (v: unknown): v is unknown[][] =>
  Array.isArray(v) && v.length > 0 && v.every((r) => Array.isArray(r) && r.length > 0 && r.length === (v[0] as unknown[]).length);

/**
 * A saved hpgrid with its statusgrid, or undefined when hpgrid is missing or malformed. Statuses that do not match the
 * grid's shape are ignored rather than rejecting the hit points.
 */
export function parseHealth(hpgrid: unknown, statusgrid?: unknown): HealthGrid | undefined {
  if (!rectangular(hpgrid) || hpgrid.some((r) => r.some((v) => !finite(v)))) return undefined;
  const hh = hpgrid.length, w = hpgrid[0].length;
  const statuses = rectangular(statusgrid) && statusgrid.length === hh && statusgrid[0].length === w ? statusgrid : undefined;
  let stunned = false;
  const cells = (hpgrid as number[][]).map((row, y) =>
    row.map((hp, x): HealthCell => {
      const cell: HealthCell = { hp: Math.round(hp), poison: 0, bleed: [0, 0, 0, 0] };
      const list = statuses?.[y][x];
      for (const raw of Array.isArray(list) ? list : []) {
        if (!finite(raw)) continue;
        const s = Math.floor(raw);
        if (s === Status.Poison) cell.poison++;
        else if (s >= Status.BleedUp && s <= Status.BleedLeft) cell.bleed[s - Status.BleedUp]++;
        else if (s === Status.Stunned) stunned = true;
      }
      return cell;
    })
  );
  return { w, h: hh, cells, stunned };
}

export interface HealthSummary {
  /** Cells that are hit points at all (not -4). */
  total: number;
  healthy: number;
  lost: number;
  burned: number;
  armor: number;
  poisonedCells: number;
  poison: number;
  bleedingCells: number;
  bleed: number;
}

export function summarize(g: HealthGrid): HealthSummary {
  const s: HealthSummary = { total: 0, healthy: 0, lost: 0, burned: 0, armor: 0, poisonedCells: 0, poison: 0, bleedingCells: 0, bleed: 0 };
  for (const c of g.cells.flat()) {
    const kind = cellKind(c);
    if (kind === "none") continue;
    s.total++;
    s[kind]++;
    s.armor += cellArmor(c);
    if (c.poison) s.poisonedCells++, s.poison += c.poison;
    const b = cellBleed(c);
    if (b) s.bleedingCells++, s.bleed += b;
  }
  return s;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "9 of 12 hit points left · 2 lost · 1 burned · 3 armor · poison ×2 in 1 cell · bleeding ×1" */
export function healthText(g: HealthGrid): string {
  const s = summarize(g);
  return [
    `${s.healthy} of ${plural(s.total, "hit point")} left`,
    s.lost ? `${s.lost} lost` : "",
    s.burned ? `${s.burned} burned` : "",
    s.armor ? `${s.armor} armor` : "",
    s.poison ? `poison ×${s.poison} in ${plural(s.poisonedCells, "cell")}` : "",
    s.bleed ? `bleeding ×${s.bleed} in ${plural(s.bleedingCells, "cell")}` : "",
    g.stunned ? "stunned" : "",
  ].filter(Boolean).join(" · ");
}

/** A thick chevron for the way a bleed spreads: up, right, down or left (0–3). */
const chevron = (dir: number) =>
  s(
    "svg",
    { class: "hp-chevron", viewBox: "0 0 10 10", "aria-hidden": "true", focusable: "false" },
    s("path", { d: "M1.75 7 5 3.5 8.25 7", transform: `rotate(${dir * 90} 5 5)` }),
  );
const DIRS = ["up", "right", "down", "left"];
const KIND_TEXT: Record<CellKind, string> = {
  none: "",
  healthy: "Healthy hit point",
  lost: "Lost hit point (a wound)",
  burned: "Burned hit point: cannot heal or regenerate until treated",
};

function cellTitle(c: HealthCell): string {
  const armor = cellArmor(c);
  return [
    KIND_TEXT[cellKind(c)],
    armor ? `${armor} armor` : "",
    c.poison ? `poison ×${c.poison}` : "",
    ...c.bleed.map((n, i) => n ? `bleeding ×${n}, spreading ${DIRS[i]}` : ""),
  ].filter(Boolean).join(", ");
}

function armorShield(): SVGElement {
  return s(
    "svg",
    { class: "hp-shield", viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false" },
    s("path", { d: "M3 1.25h10L14.75 3v3.5c0 3.3-2.4 6-6.75 8.25C3.65 12.5 1.25 9.8 1.25 6.5V3Z" }),
    s("path", { class: "hp-shield-rim", d: "M4 4h8" }),
  );
}

/** One cell, also used by the legend. */
function cellView(c: HealthCell): HTMLElement {
  const kind = cellKind(c);
  const armor = cellArmor(c);
  return h(
    "span",
    {
      class: `hp-cell ${kind}${armor ? ` armor${armor}` : ""}${c.poison ? " poisoned" : ""}${cellBleed(c) ? " bleeding" : ""}`,
      title: kind === "none" ? undefined : cellTitle(c),
    },
    armor ? armorShield() : null,
    c.poison ? h("span", { class: "hp-poison" }, c.poison) : null,
    cellBleed(c) ? h("span", { class: "hp-bleed" }, c.bleed.map((n, dir) => n ? [chevron(dir), n > 1 ? String(n) : ""] : null)) : null,
  );
}

/** A hit-point grid as the game draws it, one square per cell, with its summary underneath. */
export function healthGridView(g: HealthGrid, caption = healthText(g)): HTMLElement {
  return h(
    "figure",
    { class: "hp" },
    h(
      "div",
      { class: "hp-grid", role: "img", "aria-label": caption, style: `grid-template-columns: repeat(${g.w}, var(--hp-cell))` },
      g.cells.flat().map(cellView),
    ),
    h("figcaption", { class: "muted" }, caption),
  );
}

const cell = (hp: number, extra: Partial<HealthCell> = {}): HealthCell => ({ hp, poison: 0, bleed: [0, 0, 0, 0], ...extra });

/** Swatches for the states in `g` (all of them when omitted). */
export function healthLegend(g?: HealthGrid): HTMLElement {
  const sum = g && summarize(g);
  const armorLevels = new Set(g?.cells.flat().map(cellArmor));
  const items: [boolean, HealthCell, string][] = [
    [true, cell(1), "healthy"],
    [!g || armorLevels.has(1), cell(2), "1 armor (bronze)"],
    [!g || armorLevels.has(2), cell(3), "2 armor (silver)"],
    [!g || armorLevels.has(3), cell(4), "3 armor (gold)"],
    [!sum || sum.lost > 0, cell(0), "lost"],
    [!sum || sum.burned > 0, cell(-1), "burned"],
    [!sum || sum.poison > 0, cell(1, { poison: 1 }), "poisoned (stacks)"],
    [!sum || sum.bleed > 0, cell(1, { bleed: [0, 1, 0, 0] }), "bleeding (spreads that way)"],
  ];
  return h(
    "ul",
    { class: "hp-legend" },
    items.filter(([show]) => show).map(([, c, label]) => h("li", {}, cellView(c), label)),
  );
}

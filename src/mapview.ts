// Interactive zone map: an SVG in game units (0–2560) with zoom, pan and constant-size markers.

import { h, s } from "./dom.ts";
import { backCloses, isFullMap, onFullMap, setFullMap } from "./fullscreen.ts";
import { describe, type Layer, type Mark } from "./objects.ts";
import { ROOM } from "./rules.ts";

/**
 * The map's view: a square of the world in game units. It fits the map's shorter side, centred, and a map that is not
 * square (full screen) shows more of the world along its longer side, as SVG's default `xMidYMid meet` draws it.
 */
export interface Viewport {
  x: number;
  y: number;
  size: number;
}

/** A rectangle of the world in game units. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TouchPoint {
  x: number;
  y: number;
}

/** What a width×height map shows of view [x, y, size], as [x, y, width, height] in game units (see `Viewport`). */
export function visibleRect([x, y, size]: [number, number, number], width: number, height: number): [number, number, number, number] {
  const short = Math.min(width, height);
  const w = size * width / short, h = size * height / short;
  return [x - (w - size) / 2, y - (h - size) / 2, w, h];
}

/**
 * Clamps a view of a width×height map to bounds [left, top, max]: its size to 96…max, and what it shows to the bounds, or,
 * along a side that shows more than the bounds, the bounds to what it shows. The bottom `below` px of the map are covered
 * (by a bottom sheet), so the view may show that much past the bounds' bottom edge.
 */
export function clampView(
  view: [number, number, number],
  [left, top, max]: [number, number, number],
  width: number,
  height: number,
  below = 0,
): [number, number, number] {
  const size = Math.min(Math.max(view[2], 96), max);
  const [x, y, w, h] = visibleRect([view[0], view[1], size], width, height);
  // The covered strip only ever loosens the limit, so opening a sheet never moves the view by itself.
  const fit = (v: number, span: number, lo: number, extra = 0) =>
    Math.min(Math.max(v, Math.min(lo, lo + max - span)), Math.max(lo, lo + max + extra - span));
  return [fit(x, w, left) + (w - size) / 2, fit(y, h, top, below * size / Math.min(width, height)) + (h - size) / 2, size];
}

/** Keep the world point under the gesture midpoint fixed while the fingers move and scale (points relative to the map). */
export function gestureView(
  view: Viewport,
  before: TouchPoint[],
  after: TouchPoint[],
  width: number,
  height: number,
  max: number,
): Viewport {
  const midpoint = (points: TouchPoint[]) => ({
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  });
  const a = midpoint(before), b = midpoint(after);
  const distance = (points: TouchPoint[]) => Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  const factor = before.length === 2 && after.length === 2 ? Math.max(1, distance(before)) / Math.max(1, distance(after)) : 1;
  const size = Math.min(max, Math.max(96, view.size * factor));
  // The view square sits centred on the shorter side.
  const short = Math.min(width, height), ox = (width - short) / 2, oy = (height - short) / 2;
  return {
    x: view.x + (a.x - ox) / short * view.size - (b.x - ox) / short * size,
    y: view.y + (a.y - oy) / short * view.size - (b.y - oy) / short * size,
    size,
  };
}

export interface Placement {
  left: number;
  top: number;
  /** The most height the card may take on its side. */
  room: number;
  below: boolean;
  /** The point is off the map. */
  off: boolean;
}

/**
 * Where a w×h popup card goes beside point (x, y) of an areaW×areaH map: centred on the point within the margins, below it
 * unless it only fits above (or there is more room above), and no taller than the room on that side.
 */
export function cardPlace(x: number, y: number, w: number, h: number, areaW: number, areaH: number, gap = 16, pad = 8): Placement {
  const roomBelow = areaH - y - gap - pad, roomAbove = y - gap - pad;
  const below = h <= roomBelow || roomBelow >= roomAbove;
  const room = Math.max(0, below ? roomBelow : roomAbove);
  return {
    left: Math.max(pad, Math.min(x - w / 2, areaW - w - pad)),
    top: below ? y + gap : y - gap - Math.min(h, room),
    room,
    below,
    off: x < 0 || y < 0 || x > areaW || y > areaH,
  };
}

/** Maps at most this wide (portrait phones) show the full-screen popup as a bottom sheet instead of a card beside its mark. */
export const SHEET_WIDTH = 600;
/** The strip at the top of the map, over the zone's title, that a sheet pulled all the way up leaves uncovered. */
export const SHEET_TOP = 56;
/** A sheet let go faster than this (px/ms) keeps going one step: up to full, or down to half or closed. */
const FLICK = 0.5;
const SHEET_MS = 200;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export type SheetState = "closed" | "half" | "full";

/** A bottom sheet's heights on a map `mapHeight` tall, for content `natural` tall: half the map, and all but SHEET_TOP. */
export function sheetHeights(mapHeight: number, natural = Infinity): [number, number] {
  return [Math.min(natural, Math.round(mapHeight / 2)), Math.min(natural, mapHeight - SHEET_TOP)];
}

/**
 * Where a dragged bottom sheet settles when let go at `height`, moving at `velocity` px/ms (down is positive), given its
 * half and full heights and whether it was full before. A flick goes one step its way; otherwise the nearest height wins,
 * and under 60% of the half height closes it.
 */
export function sheetSnap(height: number, velocity: number, half: number, full: number, wasFull: boolean): SheetState {
  const tall = full > half;
  if (velocity > FLICK) return wasFull && tall && height > half * 0.6 ? "half" : "closed";
  if (velocity < -FLICK) return tall ? "full" : "half";
  if (height < half * 0.6) return "closed";
  return tall && height > (half + full) / 2 ? "full" : "half";
}

/**
 * Whether a finger moving (dx, dy) on a bottom sheet's content drags the sheet instead of scrolling the content: up while
 * the sheet is at half height (it grows before its content scrolls), down while the content is scrolled to its top.
 */
export function dragsSheet(dx: number, dy: number, full: boolean, scrollTop: number): boolean {
  return Math.abs(dy) > Math.abs(dx) && (dy < 0 ? !full : scrollTop <= 0);
}

/**
 * How far to move the map's content (px, down is positive) so a point `y` px below its top shows between `top` and `bottom`:
 * 0 when it already does (or there is no room), else enough to centre it there.
 */
export function revealShift(y: number, top: number, bottom: number): number {
  return bottom <= top || (y >= top && y <= bottom) ? 0 : (top + bottom) / 2 - y;
}

export interface Raster {
  paint(ctx: CanvasRenderingContext2D, view: Rect): void;
  subscribe(callback: () => void): () => void;
}

export interface MapSpec {
  base: SVGElement[];
  /** Initial view: [x, y, size] in game units. */
  view?: [number, number, number];
  bounds?: [number, number, number];
  raster?: Raster;
  onMapClick?: (x: number, y: number) => void;
  marks: Mark[];
  heats: { cls: string; url: string; bounds?: [number, number, number, number] | null }[];
  /** The player's marker (layer "you", labelled by `mark.label`); `title` is its hover text (saved or estimated position). */
  player?: { mark: Mark; title: string };
  onOpen?: (m: Mark) => void;
  /** Called after every zoom or pan, with the view centred on the part of the map a bottom sheet leaves uncovered. */
  onView?: (view: [number, number, number]) => void;
  /** Called once the view comes to rest: when the last finger or button lifts after moving it, or shortly after a wheel or button zoom. */
  onSettle?: () => void;
  /** Shows a Locate button, which calls this to find the player wherever they are (see `locate`). */
  onLocate?: () => void;
  /**
   * Details of the selected mark. In full screen the card floats beside the mark as it moves (style.css positions it
   * absolutely), or on a narrow map docks as a bottom sheet (its grabber is a `.grabber` button in the card), and Escape
   * or a tap on the empty map calls `close`.
   */
  popup?: { card: HTMLElement; close: () => void };
}

/** How much of the map, along the axis panned across, the next zone must fill before panning selects it. */
export const FOCUS_SHARE = 2 / 3;

/** A view `size` game units across is too zoomed out for any zone to fill FOCUS_SHARE of it: a survey of several zones. */
export const surveying = (size: number) => size * FOCUS_SHARE > ROOM;

/** How much of the world, in game units, Locate shows around the player at most: 24 tiles across. */
export const LOCATE_SIZE = 384;

/**
 * Locate's view of point (x, y) from a view `size` across: zoomed in to LOCATE_SIZE unless already closer, and centred on
 * the point within the part of the map left uncovered when a bottom sheet covers `cover` of its shorter side.
 */
export function locateView(size: number, x: number, y: number, cover = 0): [number, number, number] {
  const w = Math.min(size, LOCATE_SIZE);
  return [x - w / 2, y - w / 2 + cover * w / 2, w];
}

/**
 * The zone of an n×n world that a viewport (in origin's coordinates) is about, given the zone it was about: per axis,
 * the zone under the viewport's centre once it fills FOCUS_SHARE of the view, else the current one. The band between
 * the two keeps the selection from flickering near a border, and a view too zoomed out for any zone to fill that share
 * is a survey of several zones, so it keeps the current one too.
 */
export function focusZone(
  [x, y, size]: [number, number, number],
  [ox, oy]: [number, number],
  current: [number, number],
  n = 5,
): [number, number] {
  if (surveying(size)) return current;
  const margin = (FOCUS_SHARE - 0.5) * size;
  const axis = (centre: number, at: number) =>
    centre >= at * ROOM - margin && centre < (at + 1) * ROOM + margin ? at : Math.min(n - 1, Math.max(0, Math.floor(centre / ROOM)));
  const next: [number, number] = [axis(x + size / 2 + ox * ROOM, current[0]), axis(y + size / 2 + oy * ROOM, current[1])];
  return next[0] === current[0] && next[1] === current[1] ? current : next;
}

/** Zones of an n×n world, other than origin, that a shown area [x, y, width, height] in origin's coordinates overlaps. */
export function zonesInView([x, y, w, h]: [number, number, number, number], [ox, oy]: [number, number], n = 5): [number, number][] {
  const out: [number, number][] = [];
  const lo = (v: number, o: number) => Math.max(0, o + Math.floor(v / ROOM));
  const hi = (v: number, span: number, o: number) => Math.min(n - 1, o + Math.ceil((v + span) / ROOM) - 1);
  for (let zy = lo(y, oy); zy <= hi(y, h, oy); zy++) {
    for (let zx = lo(x, ox); zx <= hi(x, w, ox); zx++) if (zx !== ox || zy !== oy) out.push([zx, zy]);
  }
  return out;
}

export function mapBounds([x, y, size]: [number, number, number]): [number, number, number] {
  const left = Math.min(0, x), top = Math.min(0, y);
  return [left, top, Math.max(Math.max(ROOM, x + size) - left, Math.max(ROOM, y + size) - top)];
}

const POINT: Record<string, (m: Mark) => SVGElement[]> = {
  landmark: () => [s("rect", { x: -5, y: -5, width: 10, height: 10, transform: "rotate(45)" })],
  entrance: () => [s("path", { d: "M-6 4 L0 -6 L6 4 Z" })],
  exit: () => [s("path", { d: "M-5 3 L0 -5 L5 3 Z" })],
  npc: () => [s("circle", { r: 5 })],
  creature: (m) => creatureIcon(m.kind),
  loot: () => [s("rect", { x: -3.5, y: -3.5, width: 7, height: 7 })],
  carcass: () => [s("path", { d: "M-3 -3 L3 3 M3 -3 L-3 3" })],
  drop: () => [s("circle", { r: 2.5 })],
  storage: () => [s("rect", { x: -4, y: -4, width: 8, height: 8 })],
  camp: () => [s("path", { d: "M-4 3 L0 -5 L4 3 Z" })],
  raft: (m) => raftIcon(m.kind),
  rift: () => [s("rect", { x: -4, y: -4, width: 8, height: 8, transform: "rotate(45)" })],
  tree: (m) => treeIcon(m.kind),
  bramble: () => [s("path", { d: "M-5 0 H5 M0 -5 V5 M-3.6 -3.6 L3.6 3.6 M3.6 -3.6 L-3.6 3.6" })],
  gather: (m) => gatherIcon(m.kind),
};
/** Astra's raft symbols from spr_placed_16x16_wider: lashed crossbars (frame 0), log deck and paddle (frame 1). */
export const RAFT_ICON = {
  deck:
    "M-6.3 -5.7 L-4 -6.1 L-4 6 L-6.3 5.6 Z M-3.1 -6.4 L-.7 -6.7 L-.7 6.5 L-3.1 6.2 Z M.2 -6.1 L2.6 -6.5 L2.6 6.1 L.2 6.5 Z M3.5 -6.5 L5.9 -6.8 L5.9 5.7 L3.5 6 Z",
  bars: "M-7 -5.3 L6.8 -5.8 L6.8 -4.4 L-7 -3.9 Z M-7 4 L6.8 3.6 L6.8 5 L-7 5.4 Z",
  rope: "M-5.6 -5.8 L-5 -3.5 M-.3 -6 L.3 -3.9 M5 -6.1 L5.6 -4 M-5.6 3.6 L-5 5.8 M-.3 3.3 L.3 5.5 M5 3 L5.6 5.3",
  paddle: "M-5.9 2.4 L-6.5 1.2 L-3.4 -.5 L-2.9 .1 L5 -3.8 L5.5 -2.9 L-2.4 1 L-2.5 1.8 Z",
};

export function raftIcon(kind: string): SVGElement[] {
  const base = kind.split(" ").includes("base");
  return [
    ...(!base ? [s("path", { class: "raft-deck", d: RAFT_ICON.deck })] : []),
    s("path", { class: "raft-bars", d: RAFT_ICON.bars }),
    s("path", { class: "raft-rope", d: RAFT_ICON.rope }),
    ...(!base ? [s("path", { class: "raft-paddle", d: RAFT_ICON.paddle })] : []),
  ];
}

/** Hand-drawn, game-shaped silhouettes in screen pixels; roots end at y=4. */
const TREE_ICONS: Record<string, { wood?: string; crown: string; detail: string }> = {
  willow: {
    wood: "M-1.8 4 Q-.5 1 -1 -2 L-4 -4 L-3 -5 L0 -3 L3 -6 L4 -5 L1 -1 Q.6 2 1.8 4 Z",
    crown:
      "M-6.5 .5 Q-7.5 -4 -5 -6 Q-4 -9 -1 -8 Q1 -10 3 -7 Q6.5 -7 6.5 -3 L6 1 L4.5 -1 L3.5 .5 L3 -3 Q1 -5 -1 -3 L-2 1 L-3.5 -1 L-4.5 2 L-5 -1 Z",
    detail: "M-4 -5 Q-5 -3 -4.5 -1 M1.5 -7 Q4 -6 4.5 -3",
  },
  cypress: {
    wood: "M-1.8 4 L-.8 0 L-3 -2 L-2 -3 L0 -1 L1 -6 L2 -6 L1.3 0 L2 4 Z",
    crown: "M2 -10 L4 -7 L3 -6 L5 -4 L3.5 -3 L6 0 L3 1 L1 -.5 L-1 1 L-4.5 0 L-6 -2 L-4 -2 L-4.5 -4 L-2 -3 L-2.5 -6 L-.5 -5 L0 -8 L1 -7 Z",
    detail: "M.5 -5 L2 -3 L3.5 -3 M-2 -1.5 L0 -.5 L2 -1.5",
  },
  trollgnarl: {
    crown:
      "M-2.5 4 Q-1 2 -1.8 0 Q-2.5 -1.5 -1 -3 L-3 -4.5 L-5 -4.8 L-6 -7 L-3.5 -5.8 L-4 -9 L-2 -6.3 L.2 -4.8 L.6 -7 L-.5 -10 L1.5 -8.5 L3 -10 L2.5 -6 L4 -7 L5 -9 L5 -6 L3 -4 Q1 -2 1.7 -.5 Q.5 1.5 2.5 4 Z",
    detail: "M-.5 3 Q.7 1.5 -.3 0 Q-1.2 -1 .5 -2.5 M-2.5 -5.5 L0 -3.5",
  },
  elderwort: {
    wood: "M-1 4 L-.5 1 L-4 -1 L-3.5 -2 L0 0 L1 -4 L2 -3 L1 1 L4 -1 L4.5 0 L1 2 L1 4 Z",
    crown:
      "M-.8 -5 Q-2 -6 -.8 -7 Q-.8 -8.5 .8 -8 Q2 -9 2.7 -7.5 Q4.3 -7.2 3.2 -5.8 Q3 -4.3 1.5 -4.8 Q0 -4 -.8 -5 Z M-6 -2 Q-7 -3 -5.8 -4 Q-5.8 -5.5 -4.2 -5 Q-2.8 -6 -2.1 -4.5 Q-.5 -4.2 -1.6 -2.8 Q-1.8 -1.3 -3.3 -1.8 Q-4.8 -1 -6 -2 Z M1 0 Q0 -1 1.2 -2 Q1.2 -3.5 2.8 -3 Q4.2 -4 4.9 -2.5 Q6.5 -2.2 5.4 -.8 Q5.2 .7 3.7 .2 Q2.2 1 1 0 Z",
    detail: "M.5 -6.5 H1.5 M-4.5 -3.5 H-3.5 M2.5 -1.5 H3.5",
  },
};

/** Shared by map markers and list rows, including the freshness-coloured bare Trollgnarl trunk. */
export function treeIcon(kind: string): SVGElement[] {
  const icon = TREE_ICONS[kind.split(" ")[1]] ?? TREE_ICONS.willow;
  return [
    ...(icon.wood ? [s("path", { class: "tree-wood", d: icon.wood })] : []),
    s("path", { class: "tree-crown", d: icon.crown }),
    s("path", { class: "tree-detail", d: icon.detail }),
  ];
}

type GatherPart = [tag: "path" | "circle" | "ellipse", cls: "leaf" | "fruit" | "root" | "detail", attrs: Record<string, number | string>];

/**
 * Gatherables' symbols, centred on their tile, in screen pixels like the trees (drawn by Astra from the game's tiles
 * and the wiki's item pictures). Each part is coloured by its class (style.css): leaf, fruit (the harvested part,
 * hidden on young cranberries and searched nests), root and detail.
 */
const GATHER_ICONS: Record<string, GatherPart[]> = {
  calmia: [
    ["path", "root", { d: "M-1.7 -.3 Q1.5 -1.3 2.9 .9 Q4.5 3.6 .7 5.8 L-.8 6.2 L-.3 4.5 Q-3.6 4.8 -3.3 2 Q-3.3 .6 -1.7 -.3 Z" }],
    ["path", "leaf", {
      d: "M-1.4 1.5 Q-4.9 .9 -4.9 -1.6 Q-2.8 -2.2 -1 -.3 L-1.8 -3.5 L-.9 -3.8 L.1 -.7 L1.8 -4.3 L2.6 -3.9 L1.3 -.8 Q3 -2.2 4.6 -1.3 Q4.1 1.1 1.2 1.4 Z",
    }],
    ["path", "fruit", {
      d: "M-4.8 -3.1 Q-5.7 -4.8 -3.8 -4.9 Q-3.3 -6.4 -2.2 -5.4 Q-.4 -5.8 -.5 -4.1 Q.3 -2.8 -1.3 -2.3 Q-2.3 -.9 -3.2 -2.3 Q-4.7 -1.7 -4.8 -3.1 Z",
    }],
    ["path", "fruit", {
      d: "M.7 -4.1 Q-.1 -5.6 1.5 -5.7 Q2.1 -6.5 3 -5.7 Q4.8 -5.9 4.6 -4.5 Q5.3 -3 3.7 -2.7 Q2.8 -1.6 1.9 -2.7 Q.5 -2.3 .7 -4.1 Z",
    }],
  ],
  turnip: [
    ["path", "fruit", { d: "M-3.6 -.5 Q-.2 -1.9 3.5 -.5 Q4.5 2.4 .9 4.6 L-.2 6.2 L-.8 4.7 Q-4.6 2.7 -3.6 -.5 Z" }],
    ["path", "root", { d: "M-3.6 -.5 Q-.2 -1.9 3.5 -.5 L3.7 .8 Q2.1 1.6 .1 .7 Q-1.9 1.6 -3.8 .7 Z" }],
    ["path", "leaf", {
      d: "M-.9 -.3 L-1.5 -2 Q-4.7 -2.7 -4.8 -5.1 Q-2.1 -5.9 -.7 -3.1 L-.7 -5.6 L1 -6 L1.1 -2.6 Q2.3 -5.1 4.8 -4.8 Q4.8 -2.1 1.2 -1.3 L.8 -.3 Z",
    }],
  ],
  cranberry: [
    ["path", "leaf", {
      d: "M-6.1 1.6 Q-6.2 -1.5 -3.4 -2.8 Q-1.9 -3.1 -1.2 -1.5 Q-.4 -4.4 2.1 -3.8 Q3.4 -2.9 2.7 -1.1 Q5.4 -2.4 6.1 .2 Q5.6 3.1 2.9 2.9 Q.5 4.8 -1.3 3 Q-4.2 4 -6.1 1.6 Z",
    }],
    ["circle", "fruit", { cx: -3.2, cy: .3, r: 1.15 }],
    ["circle", "fruit", { cx: .3, cy: 1.7, r: 1.15 }],
    ["circle", "fruit", { cx: 3.5, cy: .2, r: 1.15 }],
  ],
  cress: [
    ["path", "root", {
      d: "M-.8 5.5 L-.4 3 L-3.5 3.4 L-3.6 2.5 L-.3 2.1 L-.1 .4 L-3.9 -1.2 L-3.5 -2 L0 -.7 L-.3 -4.3 L.5 -4.4 L.9 -.3 L3.4 -1.6 L3.8 -.8 L.9 .7 L.5 3.1 L2.9 3 L3 3.9 L.4 4 L.1 5.6 Z",
    }],
    ["circle", "leaf", { cx: .1, cy: -4.3, r: 1.65 }],
    ["circle", "leaf", { cx: -3.6, cy: -1.8, r: 1.75 }],
    ["circle", "leaf", { cx: 3.6, cy: -1, r: 1.8 }],
    ["circle", "leaf", { cx: -3.2, cy: 2.8, r: 1.9 }],
    ["circle", "leaf", { cx: 2.6, cy: 3.8, r: 1.8 }],
  ],
  lily: [
    ["path", "leaf", { d: "M.3 .9 L4.9 -2.9 C2.5 -5.2 -2.6 -4.4 -4.7 -2 C-7.3 .9 -5.7 4.9 -1.7 5.7 C1.7 6.3 5.6 4.3 5.9 1 L.3 .9 Z" }],
    ["path", "fruit", {
      d: "M-3.4 -.8 Q-5 -2.1 -4.5 -4.2 Q-3 -4.5 -2.1 -3.4 L-1.1 -5.9 Q.7 -5.2 1 -3.5 Q2.6 -4.3 3.3 -3.1 Q3.4 -1.3 1.5 -.6 Q-.8 1 -3.4 -.8 Z",
    }],
    ["ellipse", "root", { cx: -.8, cy: -1.7, rx: .95, ry: .8 }],
  ],
  bulb: [
    ["path", "leaf", { d: "M-3.8 .1 L-1.7 .1 L-1.4 3.5 L-.5 4.8 L-3.6 4.9 L-3.2 3 Z M1.4 1.8 L3.4 1.7 L3.3 4 L4.4 4.8 L1.1 5 L1.7 3.7 Z" }],
    ["path", "fruit", { d: "M-5.7 .5 C-5.6 -2.6 -4.3 -5.8 -2.8 -5.8 C-1 -5.8 .2 -2.8 .2 -.2 Q.3 1 -1.3 1 L-4.2 1.1 Q-5.4 1.5 -5.7 .5 Z" }],
    ["path", "fruit", { d: "M.2 2 C-.2 -.1 1.2 -3.4 3 -3.4 C4.7 -3.4 5.9 -1.1 5.6 1.5 Q5.4 2.5 3.5 2.5 L1.3 2.7 Q.4 2.7 .2 2 Z" }],
  ],
  nest: [
    ["path", "leaf", {
      d: "M-6.1 -1.1 L-4.6 -2 L-5.2 -3.1 L-2.8 -2.7 Q.3 -4.2 3.6 -2.6 L5.9 -3.1 L5.2 -1.4 L6.2 -.6 Q6.2 3.7 2.2 5.1 Q-2.4 6 -5.4 2.7 Z",
    }],
    ["ellipse", "root", { cx: 0, cy: -1, rx: 4.8, ry: 2.2 }],
    ["path", "fruit", { d: "M-3.9 -.4 C-4.4 -2.2 -3.7 -5 -2.1 -5 C-.7 -4.8 .1 -2.2 -.6 -.7 Q-1.7 .8 -3.9 -.4 Z" }],
    ["path", "fruit", { d: "M.3 -.5 C-.1 -1.9 1.1 -4.1 2.3 -4 C3.6 -3.6 4.3 -1.5 3.5 -.3 Q2.1 .8 .3 -.5 Z" }],
    ["path", "leaf", { d: "M-5.7 -.2 Q.1 2.1 5.8 -.5 Q5.2 3.3 1.8 4.6 Q-2.3 5.1 -5.2 2.3 Z" }],
    ["path", "detail", { d: "M-4.5 .8 Q-1.2 3.2 2.8 3 M-2.2 3.5 Q1.1 1.8 4.5 1.1" }],
  ],
};

/** Shared by map markers, list rows and the legend; the kind's second word picks the plant. */
export function gatherIcon(kind: string): SVGElement[] {
  return (GATHER_ICONS[kind.split(" ")[1]] ?? GATHER_ICONS.calmia).map(([tag, cls, attrs]) => s(tag, { class: `g-${cls}`, ...attrs }));
}

/**
 * Creature silhouettes by icon family (`CREATURE_ICON` in objects.ts), in screen pixels centred on where the creature
 * stands, within ±7.5: a filled body, optional inner detail strokes and optional glowing eyes.
 */
export const CREATURE_ICONS: Record<string, { body: string; detail?: string; eye?: string }> = {
  fly: {
    body:
      "M-1 -1 Q-5 0 -6.5 -5 Q-7 -7 -5 -6.5 Q-2 -5 -1 -1 Z M1 -1 Q2 -5 5 -6.5 Q7 -7 6.5 -5 Q5 0 1 -1 Z M-2 -1 Q0 -2.5 2 -1 L2.5 1 L5 2.5 L4.5 4 L2 2.5 L1.5 4 L3 5.5 L2 6.5 L0 5 L-2 6.5 L-3 5.5 L-1.5 4 L-2 2.5 L-4.5 4 L-5 2.5 L-2.5 1 Z",
    detail: "M-5 -5 L-2.5 -2.5 M5 -5 L2.5 -2.5 M-1 3 L1 3",
    eye: "M-1.5 -.5 L-.5 -.5 L-.5 .5 L-1.5 .5 Z M.5 -.5 L1.5 -.5 L1.5 .5 L.5 .5 Z",
  },
  louse: {
    body:
      "M-6 1 L-7 .5 L-6.5 -1 L-5.5 -1.5 Q-5.5 -4 -3 -4.5 L-2.5 -5.5 L-1 -5 Q2 -5 3.5 -2 L5 -2.5 L6.5 -1 L6 1 L6.5 2 L5 2.5 L5 4 L3.5 4 L3 2.5 L1.5 3 L1 4.5 L-.5 4.5 L-1 3 L-2.5 3 L-3 4 L-4.5 3.5 L-4 2 L-5 2 L-6 3 L-7 2 Z",
    detail: "M-3 -3.5 Q-4 -1.5 -3 1 M-.5 -3.5 Q-1.5 -1 -.5 1.5 M2 -1.5 L2.5 .5",
    eye: "M4 -.5 L5 -.5 L5 .5 L4 .5 Z",
  },
  sceetler: {
    body:
      "M1 1 Q2 -1 -.5 -2.5 Q-4 -3.5 -4 -5 Q-4 -6.5 -1.5 -6.5 Q1 -6.5 1.5 -5 L.5 -3.5 L-1 -4 L-.5 -5 Q-2 -5.5 -2.5 -4.5 Q-2 -3.5 .5 -3 Q3.5 -2.5 3 1 L5 1.5 L6 6.5 L4.5 6.5 L3.5 3 L1 2.5 L1 6 L-.5 6 L-.5 2.5 L-3.5 2 L-4.5 6.5 L-6 6 L-5 0 L-2 .5 Q-1 -1 1 1 Z",
    detail: "M-3.3 -5.4 L-2.8 -5 M.2 -2.1 L.9 -2.8 M1.8 -.1 L2.6 -.4",
    eye: "M0 -5 L.8 -4.8 L.4 -4 L-.4 -4.2 Z",
  },
  crab: {
    body:
      "M-4 0 L-5 -.5 Q-7 -1 -7 -3.5 L-6 -4.5 L-5.5 -2.5 L-4.5 -4 L-3.5 -3 L-4 -1.5 Q0 -3 4 -1.5 L3.5 -3 L4.5 -4 L5.5 -2.5 L6 -4.5 L7 -3.5 Q7 -1 5 -.5 L4 0 L6.5 1 L6.5 2.5 L4 1.5 L3 2.5 L5.5 3.5 L4.5 4.5 L2 3 L1 3.5 L-1 3.5 L-2 3 L-4.5 4.5 L-5.5 3.5 L-3 2.5 L-4 1.5 L-6.5 2.5 L-6.5 1 Z",
    detail: "M-3 .5 Q0 -1 3 .5 M-2 2 Q0 2.5 2 2",
    eye: "M-.8 -.5 Q0 -1.2 .8 -.5 L.8 .5 Q0 1.2 -.8 .5 Z",
  },
  nightmare: {
    body:
      "M-2.5 -7 L-1 -7 -.5 -5.5 .5 -5.5 1 -7 2.5 -7 2.5 -5 5.5 -6 6.5 -4.5 2.5 -3.5 1 -3 2 -2.5 6.5 -3 7 -1.5 2 -1 1 -.5 2 0 7 0 7 1.5 2 1.5 1 2 2 2.5 6.5 3 6 4.5 2 4 1 4.5 1.5 5 4.5 5.5 3.5 7 1 6.5 Q0 7 -1 6.5 L-3.5 7 -4.5 5.5 -1.5 5 -1 4.5 -2 4 -6 4.5 -6.5 3 -2 2.5 -1 2 -2 1.5 -7 1.5 -7 0 -2 0 -1 -.5 -2 -1 -7 -1.5 -6.5 -3 -2 -2.5 -1 -3 -2.5 -3.5 -6.5 -4.5 -5.5 -6 -2.5 -5 Z",
    eye: "M-1.5 -5 L-.5 -5 -.5 -4 -1.5 -4 Z M.5 -5 L1.5 -5 1.5 -4 .5 -4 Z",
  },
  snake: {
    body:
      "M-5.5 6 C-3 5 -1 4.5 -1 3 C-1 1 -5 1 -5 -2 C-5 -5 -2 -6 0 -5.5 L1 -6.5 Q4 -7 6 -5.5 L6 -3.5 Q4.5 -2 2 -3 L.5 -4 C-1.5 -4.5 -3 -4 -3 -2.5 C-3 -.5 1.5 -.5 1.5 2.5 C1.5 5.5 -2.5 6.5 -5.5 6 Z",
    detail: "M3 -3.5 L5.5 -4 M-3.5 -2 Q-3.5 0 -.5 1.5 Q1 3 -.5 4.5",
    eye: "M3.5 -5.5 L5 -5.5 L4.5 -4.5 L3.5 -4.5 Z",
  },
  slug: {
    body:
      "M-6.5 4 C-4 3 -5 -1 -1.5 -1 Q.5 -1 2 .5 L2 -2 L1 -3.5 Q1 -4.5 2.5 -4.5 Q4 -4 3 -2.5 L3.5 0 L4 -.5 L4.5 -3 Q4 -4.5 5.5 -4.5 Q7 -4 6 -2.5 L5.5 .5 Q7 1.5 6.5 3.5 Q1 5 -6.5 4 Z",
    detail: "M-2.5 0 Q-1 2 2 2.5 M-3.5 3 Q0 4 4.5 3",
    eye: "M1.5 -4 L2.5 -4 L2.5 -3 L1.5 -3 Z M5 -4 L6 -4 L6 -3 L5 -3 Z",
  },
  fish: {
    body:
      "M-3 -1.5 L-6.5 -4 L-4.5 0 L-6.5 4 L-3 1.5 Q-1.5 3 .5 3.5 L2 5 L3 2.5 Q5.5 2 6.5 .5 Q5.5 -1.5 3.5 -2 Q2 -2.5 1 -2.5 L-.5 -5.5 Q-2 -4.5 -2 -2.5 Z",
    detail: "M2 -1 Q1 0 2 2 M-4 -1 L-3.5 0 L-4 1 M0 1 L-1.5 1.5",
    eye: "M4 -.5 L5 .5 L4.5 1.5 L3.5 .5 Z",
  },
  rodent: {
    body:
      "M-5 .5 C-5 -2 -3.5 -3.5 -2 -3.5 C0 -3.5 1 -2.5 2 -2.5 Q4 -2 7 .5 L3 2 L3 3.5 L1.5 3.5 L1.5 2.5 Q0 3 -1.5 2.5 L-1 3.5 L-2.5 3.5 L-3 2.5 L-4.5 2 C-6 2.5 -6 3.5 -4.5 4 Q-4 4.5 -3.5 4 L-3.5 5.5 Q-5 5.5 -6 4.5 Q-7 4 -7 2.5 Q-7 1 -5 .5 Z M2 -2.5 C2 -3.5 3.5 -3.5 3.5 -2.5 C3.5 -1.5 2 -1.5 2 -2.5 Z",
    eye: "M4.5 -.5 L5 0 L4.5 .5 L4 0 Z",
  },
  troll: {
    body:
      "M-7 3.5 L-6.5 -1 Q-6.5 -4 -3.5 -6.5 Q-1 -7 0 -4.5 Q2 -6 4.5 -4.5 L6.5 -5 L6 -2.5 L5 -1.5 Q5 0 5.5 1.5 L6.5 4.5 Q5 5.5 3.5 4.5 L3 1.5 Q3 3 2 4 L3 5.5 H4 V7 H.5 L-.5 4.5 H-1.5 L-2 7 H-5 L-4 3.5 L-4.5 1 V4.5 Q-6 5 -7 3.5 Z",
    detail: "M0 -3.5 L-2 -5 L-1.5 -2.5 Q-1 0 1.5 .5 Q4 .5 4.5 -1.5 M1.5 -1 H3.5 M-1.5 1.5 Q0 3.5 1.5 2.5 M-4 -3 Q-5 -1 -5 .5",
    eye: "M.5 -3.5 L2 -3 V-2 H.5 Z M3 -3 L4.5 -3.5 V-2 H3 Z",
  },
  toad: {
    body:
      "M-6.5 -6.5 L-5 -6.5 L-4 6.5 H-5.5 Z M-2 -3.5 Q-2.5 -6 -.5 -6 Q1 -6 1 -4.5 H3 Q3 -6.5 4.5 -6 Q6 -5.5 5 -3.5 L5 -2 Q4.5 -1 3.5 -.5 Q5 .5 4.5 2 L6.5 3.5 L6 6 L3 6.5 L3 5 L4.5 4.5 L3 3.5 Q1.5 5 -1 3.5 L-2.5 4.5 L-1 5 L-1 6.5 L-4 6 L-4.5 3.5 L-3 2 Q-3.5 1 -2.5 0 L-5 0 L-5 -1.5 L-2 -2 L-2.5 -3 Z",
    detail: "M-1 -2.5 Q1.5 -1.5 4 -2.5 M-.5 .5 Q-1 3 1 3 Q3 3 3.5 1",
    eye: "M-.8 -5 H.4 V-3.8 H-.8 Z M3.6 -5 H4.8 V-3.8 H3.6 Z",
  },
  scaalmyr: {
    body:
      "M-2 -3 L-2.5 -4.5 L-4.5 -5.5 L-4 -6.5 L-3 -6 L-3 -7 L-1.5 -7 L-1.5 -5.5 L-.5 -4.5 H.5 L1.5 -5.5 L1.5 -7 H3 L3 -6 L4 -6.5 L4.5 -5.5 L2.5 -4.5 L2 -3 L1.5 -2 Q3 -1 3.5 .5 L4.5 4 L3 4.5 L2.5 1 L1.5 .5 L1 2.5 L2.5 6.5 H.5 L0 3.5 L-.5 6.5 H-2.5 L-1 2.5 L-1.5 .5 L-2.5 1 L-3 4.5 L-4.5 4 L-3.5 .5 Q-3 -1 -1.5 -2 Z",
    detail: "M-1 -.5 H1 M-1 1 H1",
    eye: "M-1.5 -3.5 H-.5 V-2.5 H-1.5 Z M.5 -3.5 H1.5 V-2.5 H.5 Z",
  },
  scaal: {
    body:
      "M0 -7 Q3.5 -6.5 4.5 -4 Q6 -2 4.5 .5 Q6 1.5 6.5 4.5 Q6 5.5 5 5 Q5 3 3.5 2.5 L3 3.5 Q2.5 5 3.5 6.5 L2 7 Q.5 5.5 1.5 3.5 H-1.5 Q-.5 5.5 -2 7 L-3.5 6.5 Q-2.5 5 -3 3.5 L-3.5 2.5 Q-5 3 -5 5 Q-6 5.5 -6.5 4.5 Q-6 1.5 -4.5 .5 Q-6 -2 -4.5 -4 Q-3.5 -6.5 0 -7 Z",
    detail: "M0 -5.5 Q-1 -3.5 0 -.5 M-1.5 2.5 Q0 1.5 1.5 2.5",
    eye:
      "M-2.7 -3.5 H-1.5 V-2.4 H-2.7 Z M1.5 -3.5 H2.7 V-2.4 H1.5 Z M-3.8 -1.5 H-2.6 V-.4 H-3.8 Z M2.6 -1.5 H3.8 V-.4 H2.6 Z M-2.1 .5 H-.9 V1.6 H-2.1 Z M.9 .5 H2.1 V1.6 H.9 Z",
  },
  unwanted: {
    body:
      "M2 -5 Q4 -3.5 3.5 -1 L4.5 1 V4 L3 4.5 L2.5 3 V1 L1 .5 L1.5 2 H.5 L1 3 L3.5 5 L6 5.5 L5.5 7 H2.5 L0 4.5 L-1 3.5 L-2.5 4.5 L-2 5.5 L0 6 L-.5 7 H-3.5 L-4 4 L-2.5 2.5 H-3 L-2.5 1 L-3 .5 L-2 -1 L-4 .5 L-5 3 L-5.5 4.5 L-7 4 L-6.5 2.5 L-5.5 -.5 L-4 -2 L-5 -2.5 L-5.5 -4 L-4.5 -4.5 L-6 -5 L-4.5 -5.5 V-6.5 L-3 -5.5 L-2 -7 L-1.5 -5.5 L0 -6 L-.5 -4.5 L.5 -4 Z",
    detail: "M1 -3.5 Q2 -2.5 2 -1.5 M-1 .5 L0 1.5",
    eye: "M-4.5 -4 H-3.5 V-3 H-4.5 Z M-2.5 -3.5 H-1.5 V-2.5 H-2.5 Z",
  },
};

/** A creature's map symbol by its kind ("creature fly"); a plain dot for a being without an icon. */
export function creatureIcon(kind: string): SVGElement[] {
  const icon = CREATURE_ICONS[kind.split(" ")[1]];
  if (!icon) return [s("circle", { class: "creature-body", r: 3 })];
  return [
    s("path", { class: "creature-body", d: icon.body }),
    ...(icon.detail ? [s("path", { class: "creature-detail", d: icon.detail })] : []),
    ...(icon.eye ? [s("path", { class: "creature-eye", d: icon.eye })] : []),
  ];
}
/** A simple player pictogram, coloured by the character's hair (--hair). Origin is the torso, shoulders end at y=4. */
export function personIcon(): SVGElement[] {
  const d = "M0 -8.5 A3 3 0 1 1 0 -2.5 A3 3 0 1 1 0 -8.5 Z M-5.5 4 A5.5 4.5 0 0 1 5.5 4 Z";
  return [s("path", { class: "you-halo", d }), s("path", { class: "you-fill", d })];
}
/** Inline (HTML) person icon for the world grid and lists. */
export const personSvg = () =>
  s("svg", { class: "you-icon", viewBox: "-7 -10 14 15.5", "aria-hidden": "true" }, s("g", { class: "you" }, personIcon()));

const FOOTPRINT_ONLY = new Set(["boulder", "ruin", "rock", "boat", "shelf"]);

/**
 * A mark kind's map symbol as a small inline icon, for list rows and the legend. Footprint-only kinds, and the "water",
 * "sharp" and "fern" ground overlays, are drawn as a swatch.
 */
export function markIcon(kind: string): SVGElement {
  const k = kind.split(" ")[0];
  const swatch = FOOTPRINT_ONLY.has(k) || k === "water" || k === "sharp" || k === "fern";
  return s(
    "svg",
    { class: "sym-icon", viewBox: k === "tree" || k === "you" ? "-8 -11 16 16" : "-8 -8 16 16", "aria-hidden": "true" },
    swatch
      ? s("rect", { class: `fp ${kind}`, x: -6, y: -6, width: 12, height: 12, rx: 2 })
      : s("g", { class: `pt ${kind}` }, k === "you" ? personIcon() : (POINT[k] ?? POINT.loot)({ kind } as Mark)),
  );
}

/** Quiet time after a wheel or button zoom before the view counts as settled (wheels have no end event). */
const SETTLE_MS = 250;
/** How long the player's marker pulses after Locate (style.css's `you-ping`, twice). */
const PING_MS = 1500;

type Box = [number, number, number, number];
export const boxArea = ([l, t, r, b]: Box) => (r - l + 1) * (b - t + 1);

/** Footprint paint order: largest first, so a smaller intersecting footprint is always on top. */
export const footprintOrder = (a: Box, b: Box) => boxArea(b) - boxArea(a);

/**
 * How far, in CSS pixels, a tap may land from a marker's symbol and still pick it: half of a 44px touch target, as most
 * symbols are only 5–14px across.
 */
export const TOUCH_REACH = 22;

/** How far a finger may drift before a tap becomes a drag; a mouse's 4px would turn many taps into small pans. */
const SLOP = { fine: 4, touch: 10 };

export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The box nearest point (x, y) within `reach` (0 inside a box), or -1. On a tie the later box wins, as it is drawn on top.
 */
export function nearestBox(boxes: ScreenBox[], x: number, y: number, reach: number): number {
  let best = -1, bestDistance = reach;
  boxes.forEach((b, i) => {
    const d = Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom));
    if (d <= bestDistance) [best, bestDistance] = [i, d];
  });
  return best;
}

/** Marks whose footprint exactly matches `m`'s, `m` first; a single entry when nothing else shares it. */
export function stackAt(marks: Mark[], m: Mark): Mark[] {
  const k = m.box?.join();
  return k ? [m, ...marks.filter((o) => o !== m && o.box?.join() === k)] : [m];
}

/**
 * Named timeouts that are cancelled together, so disposing of their owner leaves none to fire; setting a name again replaces
 * the one waiting under it. Tests pass their own `schedule` and `cancel`.
 */
export class Timeouts<Name extends string> {
  private waiting = new Map<Name, number>();

  constructor(
    private schedule: (f: () => void, ms: number) => number = (f, ms) => setTimeout(f, ms),
    private cancel: (id: number) => void = (id) => clearTimeout(id),
  ) {}

  /** Runs `f` after `ms`, instead of whatever was waiting under `name`. */
  set(name: Name, f: () => void, ms: number) {
    this.clear(name);
    this.waiting.set(
      name,
      this.schedule(() => {
        this.waiting.delete(name);
        f();
      }, ms),
    );
  }

  clear(name: Name) {
    const id = this.waiting.get(name);
    if (id !== undefined) this.cancel(id);
    this.waiting.delete(name);
  }

  clearAll() {
    for (const id of this.waiting.values()) this.cancel(id);
    this.waiting.clear();
  }
}

export class MapView {
  readonly el: HTMLElement;
  readonly svg: SVGSVGElement;
  private pts: { g: SVGElement; x: number; y: number }[] = [];
  private markLayer: SVGElement;
  private fpLayer: SVGElement;
  private picker: HTMLElement;
  private heatLayer: SVGElement;
  private overlay: SVGElement;
  private tip: HTMLElement;
  private youTitle = "";
  /** The player's marker, when the map shows them. */
  you?: Mark;
  private marks: Mark[] = [];
  private keep: ((m: Mark) => boolean) | null = null;
  private vx = 0;
  private vy = 0;
  private vw = ROOM;
  /** The view as last set; the map shows it clamped to its current size, so a resize (full screen) leaves it as it was. */
  private asked: [number, number, number];
  private home: [number, number, number];
  private k = 1;
  private selected = -1;
  private bounds: [number, number, number];
  private observer: ResizeObserver;
  private canvas?: HTMLCanvasElement;
  private raster?: Raster;
  private unsubscribe?: () => void;
  private frame = 0;
  private onView?: (view: [number, number, number]) => void;
  private onSettle?: () => void;
  private pointers = new Map<number, TouchPoint>();
  private moved = false;
  /** Every timeout the map sets, so `dispose` cancels them all. */
  private timeouts = new Timeouts<"settle" | "ping" | "sheet" | "slide">();
  private waiting: (() => void)[] = [];
  private popup?: { card: HTMLElement; close: () => void };
  /** Gives up Back's hold on the floating card (see `holdBack`). */
  private back?: () => void;
  /** Whether the bottom sheet is pulled up full; kept across maps, so a redrawn map (another zone, a live save) keeps it. */
  private static sheetFull = false;
  /** The sheet is being dragged or is settling, so `place` lets it grow to full height. */
  private sheetMoving = false;
  /** The sheet is sliding away to close, so Back no longer holds it. */
  private closing = false;
  private glideFrame = 0;
  /** Pixels at the bottom of the map that the sheet covers, which the view may show past the bounds (see `setRoom`). */
  private room = 0;
  private roomTarget = 0;
  private roomFrame = 0;
  /** The popup card's pointer at its mark; drawn here, as the card itself scrolls and would clip it. */
  private tail: HTMLElement;
  private fullButton: HTMLElement;
  private unfull: () => void;
  private onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented || !isFullMap()) return;
    // An open choice menu closes itself first; full screen stays.
    if (!this.picker.hidden) e.preventDefault();
    else if (this.showing) {
      e.preventDefault();
      this.popup!.close();
    }
  };

  constructor(spec: MapSpec) {
    this.home = spec.view ?? [0, 0, ROOM];
    this.bounds = spec.bounds ?? mapBounds(this.home);
    [this.vx, this.vy, this.vw] = this.asked = this.home;
    this.svg = s("svg", { class: "map", viewBox: this.viewBox(), role: "img" }) as SVGSVGElement;
    const base = s("g", { class: "base" }, spec.base);
    this.heatLayer = s("g", { class: "heats" });
    this.overlay = s("g", { class: "overlays" });
    this.fpLayer = s("g", { class: "footprints" });
    this.markLayer = s("g", { class: "marks" }, this.fpLayer);
    this.svg.append(base, this.overlay, this.heatLayer, this.markLayer);
    for (const ht of spec.heats) {
      this.heatLayer.append(this.image(ht.url, `heat ${ht.cls}`));
      if (ht.bounds) {
        const [l, t, r, b] = ht.bounds;
        this.heatLayer.append(s("rect", { class: `heat-edge ${ht.cls}`, x: l, y: t, width: r - l, height: b - t }));
      }
    }
    this.tip = h("div", { class: "tip", hidden: true });
    this.picker = h("div", { class: "picker", role: "menu", hidden: true });
    if (spec.raster) {
      this.raster = spec.raster;
      this.canvas = document.createElement("canvas");
      this.canvas.className = "terrain";
      this.canvas.setAttribute("aria-hidden", "true");
      this.unsubscribe = spec.raster.subscribe(() => this.redraw());
    }
    const zoomBtn = (label: string, f: number) =>
      h("button", { class: "zoom", type: "button", "aria-label": label, onclick: () => this.zoomBy(f) }, label === "Zoom in" ? "+" : "−");
    this.fullButton = h(
      "button",
      { class: "zoom full", type: "button", "aria-label": "Full screen", onclick: () => setFullMap(!isFullMap()) },
      s(
        "svg",
        { viewBox: "0 0 16 16", "aria-hidden": "true" },
        s("path", { class: "enter", d: "M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" }),
        s("path", { class: "leave", d: "M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4" }),
      ),
    );
    this.tail = h(
      "div",
      { class: "popup-tail", hidden: true, "aria-hidden": "true" },
      s("svg", { viewBox: "0 0 16 9" }, s("path", { d: "M0 0L8 9L16 0" })),
    );
    this.el = h(
      "div",
      { class: "mapbox" },
      this.canvas,
      this.svg,
      h(
        "div",
        { class: "zooms" },
        this.fullButton,
        zoomBtn("Zoom in", 0.6),
        zoomBtn("Zoom out", 1 / 0.6),
        h("button", {
          class: "zoom",
          type: "button",
          "aria-label": "Reset view",
          onclick: () => this.reset(),
        }, "⟲"),
        spec.bounds
          ? h(
            "button",
            { class: "zoom fit-world", type: "button", "aria-label": "Fit whole world", onclick: () => this.fitWorld() },
            "World",
          )
          : null,
        spec.onLocate
          ? h(
            "button",
            {
              class: "zoom locate",
              type: "button",
              "aria-label": "Locate player",
              title: "Locate player: zoom in on them, even indoors",
              onclick: spec.onLocate,
            },
            s(
              "svg",
              { viewBox: "0 0 16 16", "aria-hidden": "true" },
              s("circle", { cx: 8, cy: 8, r: 4.5 }),
              s("circle", { class: "dot", cx: 8, cy: 8, r: 1.5 }),
              s("path", { d: "M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15" }),
            ),
          )
          : null,
      ),
      this.tip,
      this.picker,
      this.tail,
    );
    this.addMarks(spec.marks);
    if (spec.player) {
      const me = this.you = spec.player.mark;
      this.youTitle = spec.player.title;
      // Inside somewhere, the marker sits on that entrance, so its label goes below rather than over the building's.
      const label = s("text", { y: me.interior ? 17 : -14 }, me.label ?? me.name);
      this.addPoint(me.x, me.y, "you L-you", [...personIcon(), label], this.marks.push(me) - 1);
    }
    this.popup = spec.popup;
    if (this.popup) this.wireSheet(this.popup.card);
    this.rescale();
    this.onView = spec.onView;
    this.onSettle = spec.onSettle;
    this.wire(spec.onOpen, spec.onMapClick);
    // A new map size shows a different area, so it counts as a view change (neighbours load, the raster repaints).
    this.observer = new ResizeObserver((entries) => entries.some((e) => e.target === this.svg) ? this.apply(true) : this.place());
    this.observer.observe(this.svg);
    if (this.popup) this.observer.observe(this.popup.card);
    this.unfull = onFullMap(() => this.full(true));
    this.full();
    document.addEventListener("keydown", this.onKey);
  }

  dispose() {
    this.observer.disconnect();
    this.unsubscribe?.();
    this.unfull();
    // Back's hold on an open card passes to the map drawn next, which shows the card again (or Back finds none to close).
    this.back = undefined;
    document.removeEventListener("keydown", this.onKey);
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.glideFrame);
    cancelAnimationFrame(this.roomFrame);
    // A sheet still settling, for one, would place this map's card again and take Back's hold from the map drawn next.
    this.timeouts.clearAll();
    this.onSettle = undefined;
    this.release();
  }

  get viewport(): [number, number, number] {
    return [this.vx, this.vy, this.vw];
  }

  /** The view to keep when the map is drawn again: as last set, before fitting this map's size. */
  get requested(): [number, number, number] {
    return this.asked;
  }

  /** What the map shows, [x, y, width, height] in game units: more than `viewport` along the longer side of a map that is not square. */
  get visible(): [number, number, number, number] {
    const [w, h] = this.screen();
    return visibleRect(this.viewport, w, h);
  }

  /** The map's size in CSS pixels (a square guess until it is laid out). */
  private screen(): [number, number] {
    const w = this.svg.clientWidth || 600;
    return [w, this.svg.clientHeight || w];
  }

  /** `changed` when full screen was just switched on or off, rather than this map being drawn into the current mode. */
  private full(changed = false) {
    const on = isFullMap();
    this.fullButton.setAttribute("aria-pressed", String(on));
    this.fullButton.title = on ? "Exit full screen (Esc)" : "Full screen";
    const m = this.selection;
    if (!changed || !on || !m || this.popup?.card.hidden !== false) return this.place();
    // Details already open: a sheet starts at half height and the map brings their mark into sight, fitted to its new size.
    MapView.sheetFull = false;
    this.apply(true);
    if (this.docked) this.slideIn(this.popup!.card);
    this.reveal(m);
  }

  /** Back closes the floating card before it leaves full screen, while this map shows it (see `backCloses`). */
  private holdBack(open: boolean) {
    if (open && !this.back) {
      this.back = backCloses(() => {
        if (!this.svg.isConnected || !this.showing) return false;
        // Back has already let go of the card's history entry.
        this.back = undefined;
        if (this.docked) this.settleSheet("closed");
        else this.popup!.close();
        return true;
      });
    } else if (!open && this.back) {
      const release = this.back;
      this.back = undefined;
      release();
    }
  }

  /** The popup card floats over the map (full screen only): beside the selected mark, or docked as a bottom sheet. */
  private get floating() {
    return !!this.popup && !this.popup.card.hidden && isFullMap();
  }

  /** The floating card is a bottom sheet, as the map is too narrow to fit it beside its mark. */
  private get docked() {
    return this.floating && this.screen()[0] <= SHEET_WIDTH;
  }

  /** The floating card is in sight (its mark is on the map, or it is a sheet), so Escape or a tap on the empty map closes it. */
  private get showing() {
    return this.floating && !this.popup!.card.classList.contains("off");
  }

  /** Keeps the floating popup card beside its mark, or docked; outside full screen it returns to the page's flow. */
  private place() {
    if (!this.popup) return;
    const card = this.popup.card;
    const m = this.selection;
    this.holdBack(this.floating && !!m && !this.closing);
    if (!this.floating || !m) {
      this.tail.hidden = true;
      if (card.style.length) card.style.cssText = "";
      card.classList.remove("off", "sheet");
      this.setRoom(0);
      return;
    }
    if (this.docked) return this.dock(card);
    card.classList.remove("sheet");
    this.setRoom(0);
    const map = this.svg.getBoundingClientRect();
    const host = (card.offsetParent ?? document.body).getBoundingClientRect();
    const [vx, vy, vw] = this.visible;
    const k = map.width / vw;
    const x = (m.x - vx) * k, y = (m.y - vy) * k;
    const at = cardPlace(x, y, card.offsetWidth, card.scrollHeight + 2, map.width, map.height);
    card.classList.toggle("off", at.off);
    card.style.left = `${map.left - host.left + at.left}px`;
    card.style.top = `${map.top - host.top + at.top}px`;
    card.style.maxHeight = `${at.room}px`;
    this.tail.hidden = at.off;
    if (at.off) return;
    const box = this.el.getBoundingClientRect();
    const tx = Math.max(at.left + 12, Math.min(x, at.left + card.offsetWidth - 12));
    this.tail.classList.toggle("below", at.below);
    this.tail.style.left = `${map.left - box.left + tx - 8}px`;
    this.tail.style.top = `${map.top - box.top + (at.below ? at.top - 8 : at.top + card.offsetHeight - 1)}px`;
  }

  /** Docks the card along the bottom of the map, half or full height (as tall as it may grow while it moves). */
  private dock(card: HTMLElement) {
    this.tail.hidden = true;
    card.classList.remove("off");
    card.classList.add("sheet");
    card.style.left = card.style.top = "";
    const [half, full] = sheetHeights(this.screen()[1]);
    card.style.maxHeight = `${this.sheetMoving || MapView.sheetFull ? full : half}px`;
    const grabber = card.querySelector(".grabber");
    grabber?.setAttribute("aria-expanded", String(MapView.sheetFull));
    grabber?.setAttribute("aria-label", MapView.sheetFull ? "Show less" : "Show more");
    if (!this.sheetMoving) this.setRoom(card.offsetHeight);
  }

  /**
   * Lets the view show `px` past the bounds' bottom, the height the sheet covers, so marks near the world's edge can still be
   * brought into sight above it. More room returns a view asked for past the old limit (by a map drawn again while the
   * sheet was open). Less, as the sheet closes, glides the view back in, where it stays; but if its card stays open
   * (leaving full screen, or turning to landscape), what was in sight above the sheet becomes the middle of the map.
   */
  private setRoom(px: number) {
    if (px === this.roomTarget) return;
    this.roomTarget = px;
    cancelAnimationFrame(this.roomFrame);
    const from = this.room;
    this.room = px;
    const shrink = px < from;
    if (px === 0 && shrink && this.selection && this.popup?.card.hidden === false) {
      this.vy -= (from - px) / 2 * this.k;
      return this.apply();
    }
    const [w, h] = this.screen();
    const view = this.viewport;
    if (clampView(this.asked, this.bounds, w, h, px).every((v, i) => Math.abs(v - view[i]) < 0.01)) return;
    const show = () => {
      this.apply(true);
      if (shrink) this.asked = this.viewport;
    };
    if (!shrink || matchMedia(REDUCED_MOTION).matches) return show();
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - start) / SHEET_MS));
      this.room = from + (px - from) * (1 - (1 - t) ** 3);
      show();
      this.roomFrame = t < 1 ? requestAnimationFrame(step) : 0;
    };
    this.room = from;
    this.roomFrame = requestAnimationFrame(step);
  }

  /** The card's height with nothing limiting it. */
  private natural(card: HTMLElement): number {
    const { height, maxHeight } = card.style;
    card.style.height = "";
    card.style.maxHeight = "none";
    const natural = card.offsetHeight;
    Object.assign(card.style, { height, maxHeight });
    return natural;
  }

  /**
   * Dragging the sheet, by its grabber (any pointer) or, with a finger, by its content when `dragsSheet` says so: the sheet
   * follows and settles as `sheetSnap` says. A tap (or press) on the grabber toggles between half and full height.
   */
  private wireSheet(card: HTMLElement) {
    const onGrabber = (e: Event) => e.target instanceof Element && !!e.target.closest(".grabber");
    let drag: { y: number; height: number; half: number; full: number; moved: boolean; trail: { y: number; t: number }[] } | undefined;
    let dragged = false;
    const start = (y: number) => {
      const [half, full] = sheetHeights(this.screen()[1], this.natural(card));
      drag = { y, height: card.offsetHeight, half, full, moved: false, trail: [] };
      dragged = false;
    };
    const move = (y: number, t: number) => {
      if (!drag) return;
      const dy = y - drag.y;
      if (!drag.moved && Math.abs(dy) < SLOP.touch) return;
      drag.moved = this.sheetMoving = true;
      card.style.height = `${Math.max(0, Math.min(drag.full, drag.height - dy))}px`;
      this.place();
      drag.trail = [...drag.trail.filter((p) => t - p.t < 100), { y, t }];
    };
    const end = (t: number, cancelled: boolean) => {
      if (!drag) return;
      const { half, full, moved, trail } = drag;
      drag = undefined;
      // A tap on the grabber leaves the toggle to the click that follows.
      if (!moved) return;
      dragged = true;
      const recent = trail.filter((p) => t - p.t < 100);
      const [a, b] = [recent[0], recent[recent.length - 1]];
      const velocity = recent.length > 1 ? (b.y - a.y) / Math.max(1, b.t - a.t) : 0;
      this.settleSheet(
        cancelled ? (MapView.sheetFull ? "full" : "half") : sheetSnap(card.offsetHeight, velocity, half, full, MapView.sheetFull),
      );
    };

    let pointer = -1;
    card.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !onGrabber(e) || !this.docked || drag) return;
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      pointer = e.pointerId;
      start(e.clientY);
    });
    card.addEventListener("pointermove", (e) => e.pointerId === pointer && move(e.clientY, e.timeStamp));
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = -1;
      end(e.timeStamp, e.type === "pointercancel");
    };
    card.addEventListener("pointerup", up);
    card.addEventListener("pointercancel", up);
    card.addEventListener("click", (e) => {
      if (!onGrabber(e) || !this.docked || dragged) return;
      const [half, full] = sheetHeights(this.screen()[1], this.natural(card));
      if (full > half) this.settleSheet(MapView.sheetFull ? "half" : "full");
    });

    // Touch events, as only they can keep the content from scrolling once a drag of the sheet is chosen.
    let finger: { id: number; x: number; y: number; sheet?: boolean } | undefined;
    const touchOf = (e: TouchEvent) => [...e.changedTouches].find((t) => t.identifier === finger?.id);
    card.addEventListener("touchstart", (e) => {
      if (e.touches.length > 1) {
        if (finger?.sheet) end(e.timeStamp, true);
        finger = undefined;
        return;
      }
      const t = e.changedTouches[0];
      finger = this.docked && !drag && !onGrabber(e) ? { id: t.identifier, x: t.clientX, y: t.clientY } : undefined;
    }, { passive: true });
    card.addEventListener("touchmove", (e) => {
      const t = touchOf(e);
      if (!finger || !t) return;
      if (finger.sheet === undefined) {
        const dx = t.clientX - finger.x, dy = t.clientY - finger.y;
        // Too small a move to tell a drag from a scroll (and too small for the browser to have begun scrolling).
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 3) return;
        // Decided on the first move, as a browser that has begun scrolling can no longer be stopped.
        finger.sheet = dragsSheet(dx, dy, MapView.sheetFull, card.scrollTop) && this.docked && !drag;
        if (!finger.sheet) return void (finger = undefined);
        start(finger.y);
      }
      e.preventDefault();
      move(t.clientY, e.timeStamp);
    }, { passive: false });
    const lift = (e: TouchEvent) => {
      if (!touchOf(e)) return;
      const sheet = finger?.sheet;
      finger = undefined;
      if (sheet) end(e.timeStamp, e.type === "touchcancel");
    };
    card.addEventListener("touchend", lift);
    card.addEventListener("touchcancel", lift);
  }

  /**
   * Animates the sheet from its current height to `to` (off the bottom when closing), then hands its size back to `place`.
   * A marker opened while it slides away keeps its card.
   */
  private settleSheet(to: SheetState) {
    const card = this.popup!.card;
    const m = this.selection;
    const [half, full] = sheetHeights(this.screen()[1], this.natural(card));
    if (to !== "closed") MapView.sheetFull = to === "full";
    this.sheetMoving = true;
    this.closing = to === "closed";
    card.style.height = `${card.offsetHeight}px`;
    this.place();
    const finish = () => {
      this.sheetMoving = this.closing = false;
      card.style.transition = card.style.transform = card.style.height = "";
      if (to === "closed" && this.selection === m) this.popup!.close();
      else this.place();
    };
    if (matchMedia(REDUCED_MOTION).matches) return finish();
    void card.offsetHeight;
    card.style.transition = `height ${SHEET_MS}ms ease-out, transform ${SHEET_MS}ms ease-out`;
    if (to === "closed") card.style.transform = "translateY(100%)";
    else card.style.height = `${to === "full" ? full : half}px`;
    this.timeouts.set("sheet", finish, SHEET_MS + 20);
  }

  /**
   * After a tap opens `m` (`fresh` when no card was open): its card starts scrolled to the top; a sheet starts at half
   * height, sliding up if fresh, and the map glides to keep `m` in sight above it.
   */
  private opened(m: Mark, fresh: boolean) {
    const card = this.popup?.card;
    if (!card || card.hidden || this.selection !== m || !this.svg.isConnected) return;
    card.scrollTop = 0;
    MapView.sheetFull = false;
    this.place();
    if (!this.docked) return;
    if (fresh) this.slideIn(card);
    this.reveal(m);
  }

  private slideIn(card: HTMLElement) {
    card.classList.add("sheet-in");
    this.timeouts.set("slide", () => card.classList.remove("sheet-in"), 400);
  }

  /** Glides the map to bring `m` into sight: above the sheet when docked, else anywhere on the map. */
  private reveal(m: Mark) {
    const [left, top, width] = this.visible;
    const [w, h] = this.screen();
    const k = w / width;
    const pad = 12;
    const dx = revealShift((m.x - left) * k, pad, w - pad);
    const dy = this.docked
      ? revealShift((m.y - top) * k, SHEET_TOP, h - this.popup!.card.offsetHeight - 16)
      : revealShift((m.y - top) * k, pad, h - pad);
    if (dx || dy) this.glide(-dx / k, -dy / k);
  }

  /** Pans the view by (dx, dy) game units over a moment, on top of any other change meanwhile; a touch on the map stops it. */
  private glide(dx: number, dy: number) {
    cancelAnimationFrame(this.glideFrame);
    if (matchMedia(REDUCED_MOTION).matches) {
      this.vx += dx;
      this.vy += dy;
      return this.apply();
    }
    const start = performance.now();
    let done = 0;
    const step = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - start) / SHEET_MS)), eased = 1 - (1 - t) ** 3;
      this.vx += dx * (eased - done);
      this.vy += dy * (eased - done);
      done = eased;
      this.apply();
      this.glideFrame = t < 1 ? requestAnimationFrame(step) : 0;
    };
    this.glideFrame = requestAnimationFrame(step);
  }

  /** The mark last passed to `select`. */
  get selection(): Mark | undefined {
    return this.marks[this.selected];
  }

  /** Resolves once no finger or button holds the map, at once when none does. */
  released(): Promise<void> {
    return this.pointers.size ? new Promise((resolve) => this.waiting.push(resolve)) : Promise.resolve();
  }

  private release() {
    for (const resolve of this.waiting.splice(0)) resolve();
  }

  private settle() {
    this.timeouts.clear("settle");
    if (this.pointers.size || !this.moved) return;
    this.moved = false;
    this.onSettle?.();
  }

  restore(view: [number, number, number]) {
    [this.vx, this.vy, this.vw] = view;
    this.apply();
  }

  private redraw() {
    if (!this.canvas || !this.raster || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const canvas = this.canvas!;
      const [w, h] = this.screen().map((v) => Math.max(1, Math.round(v * devicePixelRatio)));
      if (canvas.width !== w || canvas.height !== h) [canvas.width, canvas.height] = [w, h];
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, w, h);
      const [x, y, width, height] = this.visible;
      this.raster!.paint(ctx, { x, y, width, height });
    });
  }

  fitWorld() {
    [this.vx, this.vy, this.vw] = this.bounds;
    this.apply();
  }

  private image(url: string, cls: string, x = 0, y = 0) {
    return s("image", { href: url, x, y, width: ROOM, height: ROOM, class: cls, preserveAspectRatio: "none" });
  }

  /** Shows (or with null removes) overlay `id`, a zone-sized image whose top left is (x, y); its first word is its kind. */
  setOverlay(id: string, url: string | null, x = 0, y = 0) {
    this.overlay.querySelector(`[data-id="${id}"]`)?.remove();
    if (url) {
      const img = this.image(url, `overlay ${id.split(" ")[0]}`, x, y);
      img.setAttribute("data-id", id);
      this.overlay.append(img);
    }
  }

  setLayers(on: Set<Layer>, all: Layer[]) {
    for (const l of all) this.svg.classList.toggle(`hide-${l}`, !on.has(l));
  }

  /** Hides the marks that fail `keep` (null shows all), including marks added later. */
  setFilter(keep: ((m: Mark) => boolean) | null) {
    this.keep = keep;
    this.applyFilter();
  }

  private applyFilter() {
    this.markLayer.querySelectorAll("[data-i]").forEach((e) => {
      const m = this.marks[Number(e.getAttribute("data-i"))];
      if (m) e.classList.toggle("filtered", !!this.keep && !this.keep(m));
    });
  }

  highlight(m: Mark | null) {
    this.markLayer.querySelectorAll(".hl").forEach((e) => e.classList.remove("hl"));
    if (!m) return;
    const i = this.marks.indexOf(m);
    this.markLayer.querySelectorAll(`[data-i="${i}"]`).forEach((e) => e.classList.add("hl"));
  }

  /** Persistently marks `m` as the clicked/inspected mark (white border, 1.1× size). */
  select(m: Mark | null) {
    this.markLayer.querySelectorAll(".sel").forEach((e) => e.classList.remove("sel"));
    this.selected = m ? this.marks.indexOf(m) : -1;
    if (this.selected >= 0) this.markLayer.querySelectorAll(`[data-i="${this.selected}"]`).forEach((e) => e.classList.add("sel"));
    this.rescale();
  }

  addMarks(marks: Mark[]) {
    const frag = document.createDocumentFragment();
    const fps: SVGElement[] = [...this.fpLayer.children] as SVGElement[];
    for (const m of marks) {
      const i = this.marks.push(m) - 1;
      const cls = `${m.kind} L-${m.layer}`;
      if (m.box) {
        const [l, t, r, b] = m.box;
        fps.push(s("rect", { class: `fp ${cls}`, x: l, y: t, width: r - l + 1, height: b - t + 1, "data-i": i }));
      }
      if (m.radius) fps.push(s("circle", { class: `fp area ${cls}`, cx: m.x, cy: m.y, r: m.radius, "data-i": i }));
      if (FOOTPRINT_ONLY.has(m.kind.split(" ")[0])) continue;
      const sym = (POINT[m.kind.split(" ")[0]] ?? POINT.loot)(m);
      if (m.label) sym.push(s("text", { y: -9 }, m.label));
      this.addPoint(m.x, m.y, cls, sym, i, frag);
    }
    // Area circles sort by their bounding square, so they sit below the footprints they cover.
    const box = (e: SVGElement): Box => {
      const m = this.marks[Number(e.getAttribute("data-i"))], r = m.radius ?? 0;
      return e.tagName === "circle" ? [m.x - r, m.y - r, m.x + r, m.y + r] : m.box!;
    };
    this.fpLayer.append(...fps.sort((a, b) => footprintOrder(box(a), box(b))));
    this.markLayer.append(frag);
    if (this.keep) this.applyFilter();
    this.rescale();
  }

  private addPoint(x: number, y: number, cls: string, children: SVGElement[], i: number, into: ParentNode = this.markLayer) {
    const g = s("g", { class: `pt ${cls}`, "data-i": i }, children);
    this.pts.push({ g, x, y });
    into.append(g);
  }

  private rescale() {
    const [w, h] = this.screen();
    this.k = this.vw / Math.min(w, h);
    for (const p of this.pts) {
      const k = p.g.getAttribute("data-i") === String(this.selected) ? this.k * 1.1 : this.k;
      p.g.setAttribute("transform", `translate(${p.x} ${p.y}) scale(${k})`);
    }
    this.redraw();
    this.place();
  }

  private viewBox() {
    return `${this.vx} ${this.vy} ${this.vw} ${this.vw}`;
  }

  /** Shows the view as set (or, after a resize, as last set), clamped to the bounds for the map's size. */
  private apply(resized = false) {
    const [w, h] = this.screen();
    if (!resized) this.asked = this.viewport;
    [this.vx, this.vy, this.vw] = clampView(this.asked, this.bounds, w, h, this.room);
    this.svg.setAttribute("viewBox", this.viewBox());
    this.rescale();
    // The map is about what a bottom sheet leaves uncovered, so the view reported is centred there; a map not yet laid out
    // (being built for a redraw) has only a guessed size, so it waits for its first resize to report.
    if (this.svg.clientWidth) this.onView?.([this.vx, this.vy - this.room / 2 * this.vw / Math.min(w, h), this.vw]);
    this.moved = true;
    this.timeouts.set("settle", () => this.settle(), SETTLE_MS);
  }

  zoomBy(f: number, cx = this.vx + this.vw / 2, cy = this.vy + this.vw / 2) {
    const nw = Math.min(Math.max(this.vw * f, 96), this.bounds[2]);
    this.vx = cx - (cx - this.vx) * nw / this.vw;
    this.vy = cy - (cy - this.vy) * nw / this.vw;
    this.vw = nw;
    this.apply();
  }

  reset() {
    [this.vx, this.vy, this.vw] = this.home;
    this.apply();
  }

  /**
   * Zooms in on the player's marker, the opposite of World (see `locateView`; above a docked sheet), and with `ping` makes
   * it pulse a moment so the eye finds it.
   */
  locate(ping = true) {
    const m = this.you;
    if (!m) return;
    cancelAnimationFrame(this.glideFrame);
    const [w, h] = this.screen();
    [this.vx, this.vy, this.vw] = locateView(this.vw, m.x, m.y, this.room / Math.min(w, h));
    this.apply();
    if (ping) this.ping();
  }

  /** Pulses the player's marker (style.css), from the start if it already is. */
  private ping() {
    const g = this.markLayer.querySelector(".pt.you");
    if (!g) return;
    g.classList.remove("ping");
    // Restyled in between, so the animation restarts.
    void g.getBoundingClientRect();
    g.classList.add("ping");
    this.timeouts.set("ping", () => g.classList.remove("ping"), PING_MS);
  }

  /** Centres the view on a marker, zooming in if the whole zone is showing. */
  focus(m: Mark) {
    const w = Math.min(this.vw, 768);
    this.vx = m.x - w / 2;
    this.vy = m.y - w / 2;
    this.vw = w;
    this.apply();
    this.highlight(m);
  }

  private toGame(e: { clientX: number; clientY: number }) {
    const r = this.svg.getBoundingClientRect();
    const [x, y, w] = visibleRect(this.viewport, r.width || 1, r.height || 1);
    const k = w / (r.width || 1);
    return [x + (e.clientX - r.left) * k, y + (e.clientY - r.top) * k];
  }

  private wire(onOpen?: (m: Mark) => void, onMapClick?: (x: number, y: number) => void) {
    const svg = this.svg;
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const [x, y] = this.toGame(e);
      this.zoomBy(Math.exp(Math.max(-1, Math.min(1, e.deltaY / 200)) * 0.5), x, y);
    }, { passive: false });
    const pointers = this.pointers;
    let origin: TouchPoint | undefined;
    let suppressClick = false;
    let tapTarget: EventTarget | null = null;
    let touch = false;
    svg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (!pointers.size) {
        suppressClick = false;
        origin = { x: e.clientX, y: e.clientY };
        tapTarget = e.target;
        touch = e.pointerType !== "mouse";
      } else {
        suppressClick = true;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      svg.setPointerCapture(e.pointerId);
      cancelAnimationFrame(this.glideFrame);
      this.tip.hidden = true;
      this.picker.hidden = true;
    });
    svg.addEventListener("pointermove", (e) => {
      if (pointers.has(e.pointerId)) {
        const slop = touch ? SLOP.touch : SLOP.fine;
        if (!suppressClick && origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < slop) return;
        suppressClick = true;
        svg.classList.add("panning");
        const r = svg.getBoundingClientRect();
        const points = () => [...pointers.values()].slice(0, 2).map((p) => ({ x: p.x - r.left, y: p.y - r.top }));
        const before = points();
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const view = gestureView({ x: this.vx, y: this.vy, size: this.vw }, before, points(), r.width, r.height, this.bounds[2]);
        [this.vx, this.vy, this.vw] = [view.x, view.y, view.size];
        this.apply();
        this.tip.hidden = true;
        return;
      }
      const m = this.markAt(e.target);
      svg.classList.toggle("on-mark", !!m);
      if (!m) {
        this.tip.hidden = true;
        return;
      }
      const box = this.el.getBoundingClientRect();
      const what = m.layer === "you" ? this.youTitle : describe(m);
      this.tip.textContent = what + (onOpen ? (m.interior ? " — click to look inside" : " — click to inspect") : "");
      this.tip.hidden = false;
      const x = e.clientX - box.left, y = e.clientY - box.top;
      this.tip.style.left = `${Math.min(x + 14, box.width - this.tip.offsetWidth - 4)}px`;
      this.tip.style.top = `${y + 16 + this.tip.offsetHeight > box.height ? y - this.tip.offsetHeight - 8 : y + 16}px`;
    });
    const lifted = () => {
      if (pointers.size) return;
      svg.classList.remove("panning");
      this.settle();
      this.release();
    };
    const end = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (e.type === "pointercancel") suppressClick = true;
      if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
      lifted();
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    svg.addEventListener("lostpointercapture", (e) => {
      if (pointers.delete(e.pointerId)) {
        suppressClick = true;
        lifted();
      }
    });
    svg.addEventListener("pointerleave", () => {
      this.tip.hidden = true;
      svg.classList.remove("on-mark");
    });
    svg.addEventListener("click", (e) => {
      if (suppressClick) return;
      const target = tapTarget ?? e.target;
      // A fingertip is far wider than most symbols, so a touch that misses every one picks the nearest within reach.
      const onSymbol = target instanceof Element && !!target.closest(".pt");
      const near = touch && origin && !onSymbol ? this.pointNear(origin.x, origin.y) : undefined;
      const m = near ?? this.markAt(target);
      this.picker.hidden = true;
      if (m && onOpen) {
        const open = (m: Mark) => {
          const fresh = this.popup?.card.hidden !== false;
          onOpen(m);
          this.opened(m, fresh);
        };
        const stack = stackAt(this.marks, m).filter((o) => o === m || this.shown(o));
        if (stack.length > 1) this.pick(stack, e, open);
        else open(m);
      } else if (!m && this.showing) {
        this.popup!.close();
      } else if (!m && onMapClick) {
        const [x, y] = this.toGame(e);
        onMapClick(x, y);
      }
    });
    svg.addEventListener("dblclick", (e) => {
      e.preventDefault();
      if (suppressClick) return;
      const [x, y] = this.toGame(e);
      this.zoomBy(0.5, x, y);
    });
  }

  private shown(m: Mark) {
    const el = this.fpLayer.querySelector(`[data-i="${this.marks.indexOf(m)}"]`);
    return !!el && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden";
  }

  /** Lets the user choose between marks sharing an identical footprint. */
  private pick(stack: Mark[], e: MouseEvent, onOpen: (m: Mark) => void) {
    const close = () => {
      this.picker.hidden = true;
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", outside);
    };
    const key = (k: KeyboardEvent) => k.key === "Escape" && close();
    const outside = (p: PointerEvent) => !this.picker.contains(p.target as Node) && close();
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", outside);
    this.picker.replaceChildren(
      ...stack.map((m) =>
        h("button", {
          type: "button",
          role: "menuitem",
          onclick: () => {
            close();
            onOpen(m);
          },
        }, describe(m))
      ),
    );
    this.tip.hidden = true;
    this.picker.hidden = false;
    const box = this.el.getBoundingClientRect();
    const x = e.clientX - box.left, y = e.clientY - box.top;
    this.picker.style.left = `${Math.max(4, Math.min(x, box.width - this.picker.offsetWidth - 4))}px`;
    this.picker.style.top = `${Math.max(4, Math.min(y, box.height - this.picker.offsetHeight - 4))}px`;
    (this.picker.firstElementChild as HTMLElement | null)?.focus();
  }

  /** The shown point marker whose symbol (not its label) is nearest client point (x, y), within TOUCH_REACH. */
  private pointNear(x: number, y: number): Mark | undefined {
    const r = this.svg.getBoundingClientRect();
    const [vx, vy, vw] = this.visible;
    const k = r.width / vw;
    // Symbols span at most ~12px from their anchor, so this narrows the search before any is measured.
    const near = this.pts.filter((p) =>
      Math.hypot(r.left + (p.x - vx) * k - x, r.top + (p.y - vy) * k - y) < TOUCH_REACH + 16 && getComputedStyle(p.g).display !== "none"
    );
    const boxes = near.map(({ g }) => {
      const rects = [...g.children].filter((c) => c.tagName !== "text").map((c) => c.getBoundingClientRect());
      return {
        left: Math.min(...rects.map((b) => b.left)),
        top: Math.min(...rects.map((b) => b.top)),
        right: Math.max(...rects.map((b) => b.right)),
        bottom: Math.max(...rects.map((b) => b.bottom)),
      };
    });
    const i = nearestBox(boxes, x, y, TOUCH_REACH);
    return i < 0 ? undefined : this.markAt(near[i].g);
  }

  private markAt(target: EventTarget | null): Mark | undefined {
    const el = target instanceof Element ? target.closest("[data-i]") : null;
    const i = el ? Number(el.getAttribute("data-i")) : -1;
    return i >= 0 ? this.marks[i] : undefined;
  }
}

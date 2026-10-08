// Interactive zone map: an SVG in game units (0–2560) with zoom, pan and constant-size markers.

import { h, s } from "./dom.ts";
import type { Layer, Mark } from "./objects.ts";
import { describe } from "./objects.ts";
import { ROOM } from "./rules.ts";

export interface Viewport {
  x: number;
  y: number;
  size: number;
}

export interface TouchPoint {
  x: number;
  y: number;
}

/** Keep the world point under the gesture midpoint fixed while the fingers move and scale. */
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
  return { x: view.x + a.x / width * view.size - b.x / width * size, y: view.y + a.y / height * view.size - b.y / height * size, size };
}

export interface Raster {
  paint(ctx: CanvasRenderingContext2D, view: Viewport): void;
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
  /** The player's spot; `title` is its hover text (saved or estimated position). */
  player?: { x: number; y: number; label: string; title: string };
  onOpen?: (m: Mark) => void;
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
  creature: () => [s("circle", { r: 3 })],
  loot: () => [s("rect", { x: -3.5, y: -3.5, width: 7, height: 7 })],
  carcass: () => [s("path", { d: "M-3 -3 L3 3 M3 -3 L-3 3" })],
  drop: () => [s("circle", { r: 2.5 })],
  storage: () => [s("rect", { x: -4, y: -4, width: 8, height: 8 })],
  camp: () => [s("path", { d: "M-4 3 L0 -5 L4 3 Z" })],
  rift: () => [s("rect", { x: -4, y: -4, width: 8, height: 8, transform: "rotate(45)" })],
  tree: (m) => treeIcon(m.kind),
  bramble: () => [s("path", { d: "M-5 0 H5 M0 -5 V5 M-3.6 -3.6 L3.6 3.6 M3.6 -3.6 L-3.6 3.6" })],
};
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
/** A simple player pictogram, coloured by the character's hair (--hair). Origin is the torso, shoulders end at y=4. */
export function personIcon(): SVGElement[] {
  const d = "M0 -8.5 A3 3 0 1 1 0 -2.5 A3 3 0 1 1 0 -8.5 Z M-5.5 4 A5.5 4.5 0 0 1 5.5 4 Z";
  return [s("path", { class: "you-halo", d }), s("path", { class: "you-fill", d })];
}
/** Inline (HTML) person icon for the world grid and lists. */
export const personSvg = () =>
  s("svg", { class: "you-icon", viewBox: "-7 -10 14 15.5", "aria-hidden": "true" }, s("g", { class: "you" }, personIcon()));

const FOOTPRINT_ONLY = new Set(["boulder", "ruin", "rock", "boat", "shelf"]);

export class MapView {
  readonly el: HTMLElement;
  readonly svg: SVGSVGElement;
  private pts: { g: SVGElement; x: number; y: number }[] = [];
  private markLayer: SVGElement;
  private heatLayer: SVGElement;
  private overlay: SVGElement;
  private tip: HTMLElement;
  private youTitle = "";
  private marks: Mark[] = [];
  private keep: ((m: Mark) => boolean) | null = null;
  private vx = 0;
  private vy = 0;
  private vw = ROOM;
  private home: [number, number, number];
  private k = 1;
  private bounds: [number, number, number];
  private observer: ResizeObserver;
  private canvas?: HTMLCanvasElement;
  private raster?: Raster;
  private unsubscribe?: () => void;
  private frame = 0;

  constructor(spec: MapSpec) {
    this.home = spec.view ?? [0, 0, ROOM];
    this.bounds = spec.bounds ?? mapBounds(this.home);
    [this.vx, this.vy, this.vw] = this.home;
    this.svg = s("svg", { class: "map", viewBox: this.viewBox(), role: "img" }) as SVGSVGElement;
    const base = s("g", { class: "base" }, spec.base);
    this.heatLayer = s("g", { class: "heats" });
    this.overlay = s("g", { class: "overlays" });
    this.markLayer = s("g", { class: "marks" });
    this.svg.append(base, this.overlay, this.heatLayer, this.markLayer);
    for (const ht of spec.heats) {
      this.heatLayer.append(this.image(ht.url, `heat ${ht.cls}`));
      if (ht.bounds) {
        const [l, t, r, b] = ht.bounds;
        this.heatLayer.append(s("rect", { class: `heat-edge ${ht.cls}`, x: l, y: t, width: r - l, height: b - t }));
      }
    }
    this.tip = h("div", { class: "tip", hidden: true });
    if (spec.raster) {
      this.raster = spec.raster;
      this.canvas = document.createElement("canvas");
      this.canvas.className = "terrain";
      this.canvas.setAttribute("aria-hidden", "true");
      this.unsubscribe = spec.raster.subscribe(() => this.redraw());
    }
    const zoomBtn = (label: string, f: number) =>
      h("button", { class: "zoom", type: "button", "aria-label": label, onclick: () => this.zoomBy(f) }, label === "Zoom in" ? "+" : "−");
    this.el = h(
      "div",
      { class: "mapbox" },
      this.canvas,
      this.svg,
      h(
        "div",
        { class: "zooms" },
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
      ),
      this.tip,
    );
    this.addMarks(spec.marks);
    if (spec.player) {
      this.youTitle = spec.player.title;
      this.addPoint(spec.player.x, spec.player.y, "you L-you", [...personIcon(), s("text", { y: -14 }, spec.player.label)], -1);
    }
    this.rescale();
    this.wire(spec.onOpen, spec.onMapClick);
    this.observer = new ResizeObserver(() => this.rescale());
    this.observer.observe(this.svg);
  }

  dispose() {
    this.observer.disconnect();
    this.unsubscribe?.();
    cancelAnimationFrame(this.frame);
  }

  get viewport(): [number, number, number] {
    return [this.vx, this.vy, this.vw];
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
      const size = Math.max(1, Math.round(this.svg.clientWidth * devicePixelRatio));
      if (canvas.width !== size) canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, size, size);
      this.raster!.paint(ctx, { x: this.vx, y: this.vy, size: this.vw });
    });
  }

  fitWorld() {
    [this.vx, this.vy, this.vw] = this.bounds;
    this.apply();
  }

  private image(url: string, cls: string) {
    return s("image", { href: url, x: 0, y: 0, width: ROOM, height: ROOM, class: cls, preserveAspectRatio: "none" });
  }

  setOverlay(id: string, url: string | null) {
    this.overlay.querySelector(`[data-id="${id}"]`)?.remove();
    if (url) {
      const img = this.image(url, `overlay ${id}`);
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

  addMarks(marks: Mark[]) {
    const frag = document.createDocumentFragment();
    for (const m of marks) {
      const i = this.marks.push(m) - 1;
      const cls = `${m.kind} L-${m.layer}`;
      if (m.box) {
        const [l, t, r, b] = m.box;
        frag.append(s("rect", { class: `fp ${cls}`, x: l, y: t, width: r - l + 1, height: b - t + 1, "data-i": i }));
      }
      if (FOOTPRINT_ONLY.has(m.kind.split(" ")[0])) continue;
      const sym = (POINT[m.kind.split(" ")[0]] ?? POINT.loot)(m);
      if (m.label) sym.push(s("text", { y: -9 }, m.label));
      this.addPoint(m.x, m.y, cls, sym, i, frag);
    }
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
    const w = this.svg.clientWidth || 600;
    this.k = this.vw / w;
    for (const p of this.pts) p.g.setAttribute("transform", `translate(${p.x} ${p.y}) scale(${this.k})`);
    this.redraw();
  }

  private viewBox() {
    return `${this.vx} ${this.vy} ${this.vw} ${this.vw}`;
  }

  private apply() {
    const [left, top, max] = this.bounds;
    this.vw = Math.min(Math.max(this.vw, 96), max);
    this.vx = Math.min(Math.max(this.vx, left), left + max - this.vw);
    this.vy = Math.min(Math.max(this.vy, top), top + max - this.vw);
    this.svg.setAttribute("viewBox", this.viewBox());
    this.rescale();
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
    return [this.vx + (e.clientX - r.left) / r.width * this.vw, this.vy + (e.clientY - r.top) / r.height * this.vw];
  }

  private wire(onOpen?: (m: Mark) => void, onMapClick?: (x: number, y: number) => void) {
    const svg = this.svg;
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const [x, y] = this.toGame(e);
      this.zoomBy(Math.exp(Math.max(-1, Math.min(1, e.deltaY / 200)) * 0.5), x, y);
    }, { passive: false });
    const pointers = new Map<number, TouchPoint>();
    let origin: TouchPoint | undefined;
    let suppressClick = false;
    let tapTarget: EventTarget | null = null;
    svg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (!pointers.size) {
        suppressClick = false;
        origin = { x: e.clientX, y: e.clientY };
        tapTarget = e.target;
      } else {
        suppressClick = true;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      svg.setPointerCapture(e.pointerId);
      this.tip.hidden = true;
    });
    svg.addEventListener("pointermove", (e) => {
      if (pointers.has(e.pointerId)) {
        if (!suppressClick && origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < 4) return;
        suppressClick = true;
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
      const you = !m && (e.target as Element | null)?.closest?.(".pt.you");
      if (!m && !you) {
        this.tip.hidden = true;
        return;
      }
      const box = this.el.getBoundingClientRect();
      this.tip.textContent = m
        ? describe(m) + (onOpen ? (m.interior ? " — click to look inside" : " — click to inspect") : "")
        : this.youTitle;
      this.tip.hidden = false;
      const x = e.clientX - box.left, y = e.clientY - box.top;
      this.tip.style.left = `${Math.min(x + 14, box.width - this.tip.offsetWidth - 4)}px`;
      this.tip.style.top = `${y + 16 + this.tip.offsetHeight > box.height ? y - this.tip.offsetHeight - 8 : y + 16}px`;
    });
    const end = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (e.type === "pointercancel") suppressClick = true;
      if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    svg.addEventListener("lostpointercapture", (e) => {
      if (pointers.delete(e.pointerId)) suppressClick = true;
    });
    svg.addEventListener("pointerleave", () => (this.tip.hidden = true));
    svg.addEventListener("click", (e) => {
      if (suppressClick) return;
      const m = this.markAt(tapTarget ?? e.target);
      if (m && onOpen) onOpen(m);
      else if (!m && onMapClick) {
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

  private markAt(target: EventTarget | null): Mark | undefined {
    const el = (target as Element | null)?.closest?.("[data-i]");
    const i = el ? Number(el.getAttribute("data-i")) : -1;
    return i >= 0 ? this.marks[i] : undefined;
  }
}

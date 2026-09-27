// Interactive zone map: an SVG in game units (0–2560) with zoom, pan and constant-size markers.

import { h, s } from "./dom.ts";
import type { Layer, Mark } from "./objects.ts";
import { describe } from "./objects.ts";
import { ROOM } from "./rules.ts";

export interface MapSpec {
  base: SVGElement[];
  /** Initial view: [x, y, size] in game units. */
  view?: [number, number, number];
  marks: Mark[];
  heats: { cls: string; url: string; bounds?: [number, number, number, number] | null }[];
  player?: { x: number; y: number; label: string };
  onOpen?: (m: Mark) => void;
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
  tree: () => [s("circle", { r: 2.5 })],
};
const FOOTPRINT_ONLY = new Set(["boulder", "ruin", "rock", "boat", "shelf"]);

export class MapView {
  readonly el: HTMLElement;
  readonly svg: SVGSVGElement;
  private pts: { g: SVGElement; x: number; y: number }[] = [];
  private markLayer: SVGElement;
  private heatLayer: SVGElement;
  private overlay: SVGElement;
  private tip: HTMLElement;
  private marks: Mark[] = [];
  private vx = 0;
  private vy = 0;
  private vw = ROOM;
  private home: [number, number, number];
  private k = 1;

  constructor(spec: MapSpec) {
    this.home = spec.view ?? [0, 0, ROOM];
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
    const zoomBtn = (label: string, f: number) =>
      h("button", { class: "zoom", type: "button", "aria-label": label, onclick: () => this.zoomBy(f) }, label === "Zoom in" ? "+" : "−");
    this.el = h(
      "div",
      { class: "mapbox" },
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
      ),
      this.tip,
    );
    this.addMarks(spec.marks);
    if (spec.player) {
      this.addPoint(spec.player.x, spec.player.y, "you", [s("circle", { r: 6 }), s("text", { y: -10 }, spec.player.label)], -1);
    }
    this.rescale();
    this.wire(spec.onOpen);
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
  }

  private viewBox() {
    return `${this.vx} ${this.vy} ${this.vw} ${this.vw}`;
  }

  private apply() {
    const max = Math.max(ROOM, this.home[2]);
    this.vw = Math.min(Math.max(this.vw, 96), max);
    this.vx = Math.min(Math.max(this.vx, Math.min(0, this.home[0])), Math.max(ROOM, this.home[0] + this.home[2]) - this.vw);
    this.vy = Math.min(Math.max(this.vy, Math.min(0, this.home[1])), Math.max(ROOM, this.home[1] + this.home[2]) - this.vw);
    this.svg.setAttribute("viewBox", this.viewBox());
    this.rescale();
  }

  zoomBy(f: number, cx = this.vx + this.vw / 2, cy = this.vy + this.vw / 2) {
    const nw = Math.min(Math.max(this.vw * f, 96), Math.max(ROOM, this.home[2]));
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

  private wire(onOpen?: (m: Mark) => void) {
    const svg = this.svg;
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const [x, y] = this.toGame(e);
      this.zoomBy(Math.exp(Math.max(-1, Math.min(1, e.deltaY / 200)) * 0.5), x, y);
    }, { passive: false });
    let drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
    svg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, vx: this.vx, vy: this.vy, moved: false };
    });
    svg.addEventListener("pointermove", (e) => {
      if (drag && (e.buttons & 1)) {
        const r = svg.getBoundingClientRect();
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        if (!drag.moved) svg.setPointerCapture(e.pointerId);
        drag.moved = true;
        this.vx = drag.vx - dx / r.width * this.vw;
        this.vy = drag.vy - dy / r.height * this.vw;
        this.apply();
        this.tip.hidden = true;
        return;
      }
      const m = this.markAt(e.target);
      if (!m) {
        this.tip.hidden = true;
        return;
      }
      const box = this.el.getBoundingClientRect();
      this.tip.textContent = describe(m) + (m.interior && onOpen ? " — click to look inside" : "");
      this.tip.hidden = false;
      const x = e.clientX - box.left, y = e.clientY - box.top;
      this.tip.style.left = `${Math.min(x + 14, box.width - this.tip.offsetWidth - 4)}px`;
      this.tip.style.top = `${y + 16 + this.tip.offsetHeight > box.height ? y - this.tip.offsetHeight - 8 : y + 16}px`;
    });
    const end = () => {
      setTimeout(() => (drag = null));
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    svg.addEventListener("pointerleave", () => (this.tip.hidden = true));
    svg.addEventListener("click", (e) => {
      if (drag?.moved) return;
      const m = this.markAt(e.target);
      if (m?.interior && onOpen) onOpen(m);
    });
    svg.addEventListener("dblclick", (e) => {
      e.preventDefault();
      const [x, y] = this.toGame(e);
      this.zoomBy(0.5, x, y);
    });
    new ResizeObserver(() => this.rescale()).observe(svg);
  }

  private markAt(target: EventTarget | null): Mark | undefined {
    const el = (target as Element | null)?.closest?.("[data-i]");
    const i = el ? Number(el.getAttribute("data-i")) : -1;
    return i >= 0 ? this.marks[i] : undefined;
  }
}

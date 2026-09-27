// Tiny DOM helpers.

type Attrs = Record<string, string | number | boolean | undefined | null | EventListener>;
type Child = Node | string | number | null | undefined | false | Child[];

function build<E extends Element>(el: E, attrs: Attrs | undefined, children: Child[]): E {
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v);
    // Through CSSOM, so a strict Content-Security-Policy (no inline styles) still allows it.
    else if (k === "style") (el as unknown as ElementCSSInlineStyle).style.cssText = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  const add = (c: Child) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(typeof c === "object" ? c : String(c));
  };
  children.forEach(add);
  return el;
}

export const h = (tag: string, attrs?: Attrs, ...children: Child[]) => build(document.createElement(tag), attrs, children);

export const SVG = "http://www.w3.org/2000/svg";
export const s = (tag: string, attrs?: Attrs, ...children: Child[]) =>
  build(document.createElementNS(SVG, tag) as SVGElement, attrs, children);

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

/** Paints a 160×160 per-tile image and returns it as a data: URL for an SVG <image>. */
export function tileImage(paint: (img: ImageData) => void, size = 160): string {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  paint(img);
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

export function hex(color: string): [number, number, number] {
  const n = parseInt(color.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

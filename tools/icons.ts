/**
 * MirkMap's hand-pixelled icon, derived from the permitted Mirklurk game art:
 * - assets/wiki/item_89.1b089b316c.png: parchment silhouette, folds and colours.
 * - Steam's Mirklurk logo: green land, purple outline and amber waypoint.
 *
 * Regenerate every shipped icon with `deno task icons`; no source images or
 * packages are needed. "." is transparent. Each character is one art pixel.
 */
export const PALETTE: Readonly<Record<string, string>> = {
  ".": "#00000000",
  i: "#312751",
  p: "#e8caa6",
  s: "#e2b27e",
  t: "#d89557",
  g: "#50913e",
  k: "#2e6030",
  a: "#f5a430",
};

export const ICON_ART = [
  ".....iiiiii.....",
  "iiiiiisppgii....",
  "ippspspsggkii...",
  "iippspsiiigki...",
  "iiippsiaaaikii..",
  "ipstpgiapaigkii.",
  "iiptppiaaaisski.",
  "ipsptppiaisggki.",
  "ipspkkpiaitttsi.",
  "iipspgttiptppii.",
  ".iipspsppspiii..",
  "..ipstpsspii....",
  "..iipssppii.....",
  "...iippiii......",
  "....iiii........",
  "................",
] as const;

export const BACKGROUND = "#1b1516";
type RGBA = readonly [number, number, number, number];

function color(hex: string): RGBA {
  if (!/^#[\da-f]{6}([\da-f]{2})?$/i.test(hex)) throw new Error(`Invalid colour: ${hex}`);
  const byte = (start: number) => parseInt(hex.slice(start, start + 2), 16);
  return [byte(1), byte(3), byte(5), hex.length === 9 ? byte(7) : 255];
}

function validateArt(rows: readonly string[]): number {
  if (rows.length === 0 || rows.some((row) => row.length !== rows.length)) throw new Error("Icon art must be a nonempty square");
  for (const pixel of rows.join("")) {
    if (!Object.hasOwn(PALETTE, pixel)) throw new Error(`Unknown palette symbol: ${pixel}`);
  }
  return rows.length;
}

export function rasterize(
  rows: readonly string[],
  size: number,
  background = "#00000000",
  scale = Math.floor(size / rows.length),
): Uint8Array {
  const grid = validateArt(rows);
  if (!Number.isInteger(size) || size < grid) throw new Error("Raster size must fit the art at integer scale");
  if (!Number.isInteger(scale) || scale < 1 || grid * scale > size) throw new Error("Integer scale must fit the raster");
  const pixels = new Uint8Array(size * size * 4);
  const backdrop = color(background);
  for (let i = 0; i < pixels.length; i += 4) pixels.set(backdrop, i);
  const offset = Math.floor((size - grid * scale) / 2);
  const colors = Object.fromEntries(Object.entries(PALETTE).map(([key, hex]) => [key, color(hex)]));
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      if (rows[y][x] === ".") continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const at = ((offset + y * scale + dy) * size + offset + x * scale + dx) * 4;
          pixels.set(colors[rows[y][x]], at);
        }
      }
    }
  }
  return pixels;
}

export function toSvg(rows: readonly string[]): string {
  const grid = validateArt(rows);
  const paths: string[] = [];
  for (const [symbol, fill] of Object.entries(PALETTE)) {
    if (symbol === ".") continue;
    let d = "";
    for (let y = 0; y < grid; y++) {
      for (let x = 0; x < grid;) {
        if (rows[y][x] !== symbol) {
          x++;
          continue;
        }
        const start = x;
        while (x < grid && rows[y][x] === symbol) x++;
        const width = x - start;
        d += `M${start} ${y}h${width}v1h-${width}z`;
      }
    }
    if (d) paths.push(`<path fill="${fill}" d="${d}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid} ${grid}" shape-rendering="crispEdges">${paths.join("")}</svg>\n`;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const payload = concat([new TextEncoder().encode(type), data]);
  const result = new Uint8Array(12 + data.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  result.set(payload, 4);
  view.setUint32(result.length - 4, crc32(payload));
  return result;
}

export async function encodePng(width: number, height: number, pixels: Uint8Array): Promise<Uint8Array> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || pixels.length !== width * height * 4) {
    throw new Error("Invalid RGBA raster dimensions");
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4;
  const scanlines = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) scanlines.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const compressed = new Uint8Array(
    await new Response(new Blob([scanlines]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer(),
  );
  return concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array()),
  ]);
}

if (import.meta.main) {
  const directory = new URL("../icons/", import.meta.url);
  await Deno.mkdir(directory, { recursive: true });
  await Deno.writeTextFile(new URL("favicon.svg", directory), toSvg(ICON_ART));
  // Maximize integer scaling while keeping an 8% home-screen inset. Fit the
  // maskable art's entire square grid inside the central 40%-radius safe circle.
  const grid = ICON_ART.length;
  const homeScale = (size: number) => Math.floor((size - 2 * Math.ceil(size * 0.08)) / grid);
  const maskableScale = (size: number) => Math.floor(size * 0.8 / (grid * Math.SQRT2));
  for (
    const [name, size, background, scale] of [
      ["favicon-32.png", 32, "#00000000", 2],
      ["apple-touch-icon.png", 180, BACKGROUND, homeScale(180)],
      ["icon-192.png", 192, BACKGROUND, homeScale(192)],
      ["icon-512.png", 512, BACKGROUND, homeScale(512)],
      ["icon-maskable-512.png", 512, BACKGROUND, maskableScale(512)],
    ] as const
  ) {
    const bytes = await encodePng(size, size, rasterize(ICON_ART, size, background, scale));
    await Deno.writeFile(new URL(name, directory), bytes);
    console.log(`${name}: ${bytes.length} bytes`);
  }
}

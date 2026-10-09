// QR Code (ISO/IEC 18004) encoder for sharing links: error-correction level M, versions 1–10. Text is split into the cheapest mix of
// numeric (3.3 bits/digit), alphanumeric (5.5 bits/char: 0–9, A–Z, space and $%*+-./:) and byte (8 bits/byte, UTF-8) segments.
// No dependencies; renders as SVG so the strict CSP needs no canvas or data: images.

import { s } from "./dom.ts";

// Level M: error-correction codewords per block and number of blocks, for versions 1–10.
const ECC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const MAX_VERSION = ECC_PER_BLOCK.length;

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a: number, b: number) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** Reed–Solomon error-correction codewords for one block (generator roots α^0…α^(n−1)). */
function correction(data: number[], n: number): number[] {
  let generator = [1];
  for (let i = 0; i < n; i++) {
    const next = [...generator, 0];
    for (let j = 1; j < next.length; j++) next[j] ^= mul(generator[j - 1], EXP[i]);
    generator = next;
  }
  const message = [...data, ...Array(n).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const factor = message[i];
    if (factor) { for (let j = 0; j <= n; j++) message[i + j] ^= mul(generator[j], factor); }
  }
  return message.slice(data.length);
}

const size = (version: number) => version * 4 + 17;
const alignments = (version: number): number[] => {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let p = size(version) - 7; result.length < count; p -= step) result.splice(1, 0, p);
  return result;
};
/** Modules left for codewords after all function patterns. */
function rawModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const count = Math.floor(version / 7) + 2;
    result -= (25 * count - 10) * count - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}
const dataCodewords = (version: number) => Math.floor(rawModules(version) / 8) - ECC_PER_BLOCK[version - 1] * BLOCKS[version - 1];

const NUMERIC = 0, ALPHANUMERIC = 1, BYTE = 2;
type Mode = typeof NUMERIC | typeof ALPHANUMERIC | typeof BYTE;
const MODES: Mode[] = [NUMERIC, ALPHANUMERIC, BYTE];
const INDICATOR = [0b0001, 0b0010, 0b0100];
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
const encoder = new TextEncoder();
/** Character-count field width, which grows from version 10. */
const countBits = (mode: Mode, version: number) => (version < 10 ? [10, 9, 8] : [12, 11, 16])[mode];
export interface Segment {
  mode: "numeric" | "alphanumeric" | "byte";
  text: string;
}
const NAMES: Segment["mode"][] = ["numeric", "alphanumeric", "byte"];

/**
 * The cheapest segmentation, by dynamic programming over characters. Costs are in sixths of a bit so numeric (10 bits per 3 digits)
 * and alphanumeric (11 bits per 2 characters) runs stay exact; closing a segment rounds its partial group up to whole bits.
 */
function segment(text: string, version: number): { mode: Mode; text: string }[] {
  const chars = [...text];
  const allowed = (mode: Mode, c: string) =>
    mode === BYTE || (mode === NUMERIC ? c >= "0" && c <= "9" : c.length === 1 && ALPHABET.includes(c));
  const charCost = (mode: Mode, c: string) => mode === NUMERIC ? 20 : mode === ALPHANUMERIC ? 33 : encoder.encode(c).length * 48;
  const header = (mode: Mode) => (4 + countBits(mode, version)) * 6;
  const close = (cost: number) => Math.ceil(cost / 6) * 6;
  let cost = [Infinity, Infinity, Infinity];
  const previous: Mode[][] = [];
  chars.forEach((c, i) => {
    const next = [Infinity, Infinity, Infinity], from: Mode[] = [NUMERIC, ALPHANUMERIC, BYTE];
    for (const mode of MODES) {
      if (!allowed(mode, c)) continue;
      for (const before of i ? MODES : [mode]) {
        const start = i === 0 ? header(mode) : before === mode ? cost[before] : close(cost[before]) + header(mode);
        if (start + charCost(mode, c) < next[mode]) (next[mode] = start + charCost(mode, c)), (from[mode] = before);
      }
    }
    cost = next;
    previous.push(from);
  });
  let mode = MODES.reduce((best, m) => close(cost[m]) < close(cost[best]) ? m : best, BYTE);
  const modes: Mode[] = [];
  for (let i = chars.length - 1; i >= 0; i--) {
    modes[i] = mode;
    mode = previous[i][mode];
  }
  const result: { mode: Mode; text: string }[] = [];
  chars.forEach((c, i) => {
    const last = result.at(-1);
    if (last?.mode === modes[i]) last.text += c;
    else result.push({ mode: modes[i], text: c });
  });
  return result;
}

function segmentBits({ mode, text }: { mode: Mode; text: string }, version: number): number {
  const n = mode === BYTE ? encoder.encode(text).length : text.length;
  const data = mode === NUMERIC
    ? 10 * Math.floor(n / 3) + [0, 4, 7][n % 3]
    : mode === ALPHANUMERIC
    ? 11 * Math.floor(n / 2) + 6 * (n % 2)
    : 8 * n;
  return 4 + countBits(mode, version) + data;
}

/** The smallest version and its segments; exported so tests can check the chosen modes. */
export function plan(text: string): { version: number; segments: Segment[] } {
  for (let version = 1; version <= MAX_VERSION; version++) {
    const parts = segment(text, version);
    if (parts.reduce((sum, part) => sum + segmentBits(part, version), 0) <= dataCodewords(version) * 8) {
      return { version, segments: parts.map(({ mode, text }) => ({ mode: NAMES[mode], text })) };
    }
  }
  throw new Error("Text is too long for a QR code");
}

function codewords(segments: Segment[], version: number): number[] {
  const capacity = dataCodewords(version);
  const bits: number[] = [];
  const put = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  for (const { mode: name, text } of segments) {
    const mode = NAMES.indexOf(name) as Mode;
    put(INDICATOR[mode], 4);
    if (mode === BYTE) {
      const bytes = encoder.encode(text);
      put(bytes.length, countBits(mode, version));
      bytes.forEach((b) => put(b, 8));
    } else if (mode === NUMERIC) {
      put(text.length, countBits(mode, version));
      for (let i = 0; i < text.length; i += 3) {
        const group = text.slice(i, i + 3);
        put(Number(group), [0, 4, 7, 10][group.length]);
      }
    } else {
      put(text.length, countBits(mode, version));
      for (let i = 0; i < text.length; i += 2) {
        const a = ALPHABET.indexOf(text[i]);
        if (i + 1 < text.length) put(a * 45 + ALPHABET.indexOf(text[i + 1]), 11);
        else put(a, 6);
      }
    }
  }
  put(0, Math.min(4, capacity * 8 - bits.length));
  put(0, (8 - bits.length % 8) % 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);

  const blocks = BLOCKS[version - 1], ecc = ECC_PER_BLOCK[version - 1];
  const total = Math.floor(rawModules(version) / 8);
  const short = blocks - total % blocks, shortLength = Math.floor(total / blocks) - ecc;
  const parts: number[][] = [], checks: number[][] = [];
  for (let i = 0, offset = 0; i < blocks; i++) {
    const length = shortLength + (i < short ? 0 : 1);
    parts.push(data.slice(offset, offset += length));
    checks.push(correction(parts[i], ecc));
  }
  const result: number[] = [];
  for (let i = 0; i <= shortLength; i++) for (const part of parts) if (i < part.length) result.push(part[i]);
  for (let i = 0; i < ecc; i++) for (const check of checks) result.push(check[i]);
  return result;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
  (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];

function penalty(grid: boolean[][]): number {
  const n = grid.length;
  let score = 0, dark = 0;
  const line = (get: (i: number) => boolean) => {
    for (let i = 0, run = 0; i <= n; i++) {
      if (i < n && i > 0 && get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    for (let i = 0; i + 11 <= n; i++) {
      const window = Array.from({ length: 11 }, (_, k) => get(i + k) ? 1 : 0).join("");
      if (window === "10111010000" || window === "00001011101") score += 40;
    }
  };
  for (let y = 0; y < n; y++) {
    line((x) => grid[y][x]);
    line((x) => grid[x][y]);
    for (let x = 0; x < n; x++) {
      if (grid[y][x]) dark++;
      if (x + 1 < n && y + 1 < n && grid[y][x] === grid[y][x + 1] && grid[y][x] === grid[y + 1][x] && grid[y][x] === grid[y + 1][x + 1]) {
        score += 3;
      }
    }
  }
  return score + 10 * Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5);
}

/** Dark modules, [y][x], without the quiet zone. `mask` forces a mask pattern (tests compare against references). */
export function qrMatrix(text: string, mask?: number): boolean[][] {
  const { version, segments } = plan(text);
  const n = size(version);
  const modules = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
  const fixed = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark;
    fixed[y][x] = true;
  };

  for (let i = 0; i < n; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < n && y >= 0 && y < n) set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const centres = alignments(version);
  for (const cy of centres) {
    for (const cx of centres) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === n - 7) || (cx === n - 7 && cy === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  const format = (pattern: number) => {
    // Level M is 0b00; the 5 data bits get a BCH(15,5) remainder and the standard XOR mask.
    let rem = pattern;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((pattern << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, n - 15 + i, bit(i));
    set(8, n - 8, true);
  };
  format(0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1, a = n - 11 + i % 3, b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  const data = codewords(segments, version);
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < n; step++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? n - 1 - step : step;
        if (fixed[y][x]) continue;
        modules[y][x] = i < data.length * 8 && ((data[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
        i++;
      }
    }
  }

  const apply = (m: number) => {
    const grid = modules.map((row) => [...row]);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fixed[y][x] && MASKS[m](x, y)) grid[y][x] = !grid[y][x];
    return grid;
  };
  let best = mask ?? 0;
  if (mask === undefined) {
    let lowest = Infinity;
    for (let m = 0; m < 8; m++) {
      format(m);
      const score = penalty(apply(m));
      if (score < lowest) (lowest = score), (best = m);
    }
  }
  format(best);
  return apply(best);
}

/** Black-on-white SVG with the standard four-module quiet zone. */
export function qrSvg(text: string, label: string): SVGElement {
  const grid = qrMatrix(text);
  const n = grid.length + 8;
  let path = "";
  grid.forEach((row, y) => row.forEach((dark, x) => dark && (path += `M${x + 4} ${y + 4}h1v1h-1z`)));
  return s(
    "svg",
    { class: "qr", viewBox: `0 0 ${n} ${n}`, role: "img", "aria-label": label, "shape-rendering": "crispEdges" },
    s("rect", { width: n, height: n, fill: "#fff" }),
    s("path", { d: path, fill: "#000" }),
  );
}

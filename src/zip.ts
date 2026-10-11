// Minimal ZIP support (stored + deflate), enough to read a zipped save folder and to write one the game can load.

const EOCD = 0x06054b50, CEN = 0x02014b50, LOC = 0x04034b50;

export interface ZipEntry {
  name: string;
  read(): Promise<Uint8Array>;
}

export async function readZip(blob: Blob): Promise<ZipEntry[]> {
  const tailLen = Math.min(blob.size, 22 + 0xffff);
  const tail = new Uint8Array(await blob.slice(blob.size - tailLen).arrayBuffer());
  const tv = new DataView(tail.buffer);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a ZIP file");
  const count = tv.getUint16(eocd + 10, true);
  const cdSize = tv.getUint32(eocd + 12, true);
  const cdOffset = tv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error("ZIP64 archives are not supported");

  const cd = new Uint8Array(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const dv = new DataView(cd.buffer);
  const utf8 = new TextDecoder();
  const latin = new TextDecoder("latin1");
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== CEN) throw new Error("corrupt ZIP directory");
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const nameBytes = cd.subarray(p + 46, p + 46 + nameLen);
    const name = (flags & 0x800 ? utf8 : latin).decode(nameBytes).replace(/\\/g, "/");
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (flags & 1) throw new Error(`encrypted ZIP entry: ${name}`);
    if (method !== 0 && method !== 8) throw new Error(`unsupported ZIP compression (${method}): ${name}`);
    entries.push({
      name,
      async read() {
        const lh = new DataView(await blob.slice(local, local + 30).arrayBuffer());
        if (lh.getUint32(0, true) !== LOC) throw new Error(`corrupt ZIP entry: ${name}`);
        const start = local + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
        const raw = blob.slice(start, start + csize);
        const out = method === 0
          ? new Uint8Array(await raw.arrayBuffer())
          : new Uint8Array(await new Response(raw.stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
        if (out.length !== usize) throw new Error(`ZIP entry has the wrong size: ${name}`);
        return out;
      },
    });
  }
  return entries;
}

export interface ZipInput {
  /** Path inside the archive, with "/" between folders. */
  name: string;
  data: Uint8Array;
  /** Milliseconds since the epoch; ZIP stores local time to 2 seconds, as Windows does. */
  modified?: number;
  /** The MS-DOS hidden attribute, which Windows and most unzip tools apply when extracting. */
  hidden?: boolean;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** [time, date] in MS-DOS format, clamped to the years ZIP can store (1980 to 2107). */
function dosTime(ms: number): [number, number] {
  const d = new Date(ms);
  const year = d.getFullYear();
  if (!(year >= 1980)) return [0, (1 << 5) | 1];
  if (year > 2107) return [(23 << 11) | (59 << 5) | 29, (127 << 9) | (12 << 5) | 31];
  return [
    (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  ];
}

async function deflate(data: Uint8Array): Promise<Uint8Array | undefined> {
  if (typeof CompressionStream === "undefined") return undefined;
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (e) {
    console.debug("Storing ZIP entry uncompressed", e);
    return undefined;
  }
}

/**
 * A ZIP that Windows Explorer, macOS and unzip extract as is: each entry deflated when that makes it smaller, else stored, with
 * MS-DOS attributes so `hidden` applies on Windows. Names are flagged UTF-8 only when they need it. No ZIP64, so under 4 GiB.
 */
export async function writeZip(files: ZipInput[], now = Date.now()): Promise<Blob> {
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const packed = await deflate(file.data);
    const method = packed && packed.length < file.data.length ? 8 : 0;
    const body = method ? packed! : file.data;
    if (files.length > 0xfffe || name.length > 0xffff || offset + body.length + name.length + 30 > 0xfffffffe) {
      throw new Error("Too large for a ZIP file");
    }
    const [time, date] = dosTime(file.modified || now);
    const crc = crc32(file.data);
    const flags = name.length === file.name.length ? 0 : 0x800;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOC, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const entry = new Uint8Array(46 + name.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, CEN, true);
    // Made by MS-DOS (high byte 0), so the external attributes are DOS attributes: archive, plus hidden when asked.
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(38, file.hidden ? 0x22 : 0x20, true);
    cv.setUint32(42, offset, true);
    entry.set(name, 46);
    parts.push(local as BlobPart, body as BlobPart);
    central.push(entry);
    offset += local.length + body.length;
  }
  const size = central.reduce((sum, e) => sum + e.length, 0);
  if (offset + size > 0xfffffffe) throw new Error("Too large for a ZIP file");
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, EOCD, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central as BlobPart[], end as BlobPart], { type: "application/zip" });
}

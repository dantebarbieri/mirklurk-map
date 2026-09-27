// Minimal read-only ZIP support (stored + deflate), enough for a zipped save folder.

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

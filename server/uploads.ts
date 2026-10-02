import { frame, MAX_UPLOAD, SHARE_INTERVAL, SHARE_LIFETIME, type SharedInfo, TOKEN, unpackSave } from "../src/sharing-format.ts";

interface RecordInfo extends SharedInfo {
  owner: string;
  editHash: string;
  size: number;
  deleted: boolean;
}
const MAX_STORAGE = 1024 * 1024 * 1024;
const MAX_ACTIVE = 128;
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map((n) => n.toString(16).padStart(2, "0")).join("");
const digest = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((n) => n.toString(16).padStart(2, "0"))
    .join("");

/** IPv6 privacy addresses in the same /64 share a quota. IPv4-mapped IPv6 is IPv4. */
export function ipBucket(ip: string): string {
  if (!ip.includes(":")) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || ip.split(".").some((n) => Number(n) > 255)) throw new Error("Invalid client IP");
    return ip.split(".").map(Number).join(".");
  }
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const [left, right] = canonical.split("::");
  const a = left ? left.split(":") : [];
  const b = right ? right.split(":") : [];
  const parts = right === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill("0"), ...b];
  if (parts.slice(0, 5).every((n) => parseInt(n, 16) === 0) && parseInt(parts[5], 16) === 65535) {
    const high = parseInt(parts[6], 16), low = parseInt(parts[7], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return parts.slice(0, 4).map((n) => parseInt(n, 16).toString(16)).join(":") + "::/64";
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
const publicInfo = ({ id, name, created, updated, expires, version }: RecordInfo): SharedInfo => ({
  id,
  name,
  created,
  updated,
  expires,
  version,
});

async function readExactly(file: Deno.FsFile, size: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(size);
  let offset = 0;
  while (offset < size) {
    const n = await file.read(bytes.subarray(offset));
    if (n === null) throw new Error("Incomplete upload record");
    offset += n;
  }
  return bytes;
}

export class UploadStore {
  private records = new Map<string, RecordInfo>();
  private rates = new Map<string, { count: number; until: number }>();
  private writing = false;
  private salt = "";
  constructor(private directory: string, private now = () => Date.now()) {}

  async init() {
    await Deno.mkdir(this.directory, { recursive: true });
    try {
      this.salt = await Deno.readTextFile(`${this.directory}/salt`);
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
      this.salt = randomToken();
      await Deno.writeTextFile(`${this.directory}/salt`, this.salt, { createNew: true, mode: 0o600 });
    }
    for await (const entry of Deno.readDir(this.directory)) {
      if (/^[a-f0-9]{64}\.tmp$/.test(entry.name)) {
        await Deno.remove(`${this.directory}/${entry.name}`);
      } else if (/^[a-f0-9]{64}\.bin$/.test(entry.name)) {
        const file = await Deno.open(`${this.directory}/${entry.name}`);
        try {
          const prefix = await readExactly(file, 4);
          const length = new DataView(prefix.buffer).getUint32(0);
          if (length > 4096) throw new Error("Invalid stored record");
          const record: RecordInfo = JSON.parse(new TextDecoder().decode(await readExactly(file, length)));
          if (record.id !== entry.name.slice(0, -4)) throw new Error("Stored record ID mismatch");
          this.records.set(record.id, record);
        } finally {
          file.close();
        }
      }
    }
    await this.cleanup();
  }

  async cleanup() {
    if (this.writing) return;
    this.writing = true;
    try {
      for (const [id, record] of this.records) {
        if (record.expires <= this.now()) {
          await Deno.remove(`${this.directory}/${id}.bin`);
          this.records.delete(id);
        }
      }
      for (const [ip, rate] of this.rates) if (rate.until <= this.now()) this.rates.delete(ip);
    } finally {
      this.writing = false;
    }
  }

  private async save(record: RecordInfo, body: Uint8Array) {
    const path = `${this.directory}/${record.id}`;
    try {
      await Deno.writeFile(`${path}.tmp`, frame(record, body), { mode: 0o600 });
      await Deno.rename(`${path}.tmp`, `${path}.bin`);
    } catch (e) {
      try {
        await Deno.remove(`${path}.tmp`);
      } catch (cleanup) {
        if (!(cleanup instanceof Deno.errors.NotFound)) console.error("Could not remove failed upload", cleanup);
      }
      throw e;
    }
    this.records.set(record.id, record);
  }

  async handle(request: Request, address: string): Promise<Response> {
    try {
      const result = await this.route(request, address);
      result.headers.set("Cache-Control", "no-store");
      result.headers.set("X-Content-Type-Options", "nosniff");
      return result;
    } catch (e) {
      const known = e instanceof HttpError;
      if (!known) console.error("Upload service error", e);
      return Response.json({ error: known ? e.message : "Upload service failed; please retry later" }, {
        status: known ? e.status : 500,
        headers: { "Cache-Control": "no-store", ...(known && e.status === 429 ? { "Retry-After": "60" } : {}) },
      });
    }
  }

  private async route(request: Request, address: string): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz" && request.method === "GET") return new Response("ok\n");
    const owner = await digest(this.salt + ipBucket(address));
    const now = this.now();
    let rate = this.rates.get(owner);
    if (!rate || rate.until <= now) {
      for (const [key, value] of this.rates) if (value.until <= now) this.rates.delete(key);
      if (this.rates.size >= 10_000) throw new HttpError(503, "Server busy; retry later");
      rate = { count: 0, until: now + 60_000 };
      this.rates.set(owner, rate);
    }
    if (++rate.count > 60) throw new HttpError(429, "Too many requests; wait a minute");
    if (url.pathname === "/api/shares" && request.method === "GET") {
      return Response.json({ enabled: true, maxBytes: MAX_UPLOAD, maxActivePerIP: 3, lifetimeDays: 7, pollSeconds: 30 });
    }
    const match = /^\/api\/shares\/([a-f0-9]{64})(\/data)?$/.exec(url.pathname);
    const creating = url.pathname === "/api/shares" && request.method === "POST";
    let record = match ? this.records.get(match[1]) : undefined;
    if (!creating && (!record || record.deleted || record.expires <= now)) throw new HttpError(404, "Shared save expired or not found");
    if (request.method === "GET" && record) {
      if (!match?.[2]) return Response.json(publicInfo(record));
      if (request.headers.get("If-None-Match") === `"${record.version}"`) return new Response(null, { status: 304 });
      const file = await Deno.open(`${this.directory}/${record.id}.bin`);
      try {
        const prefix = await readExactly(file, 4);
        const length = new DataView(prefix.buffer).getUint32(0);
        if (length > 4096) throw new Error("Invalid stored record");
        const stored: RecordInfo = JSON.parse(new TextDecoder().decode(await readExactly(file, length)));
        if (stored.deleted || stored.expires <= this.now()) throw new HttpError(404, "Shared save expired or not found");
        record = stored;
      } catch (e) {
        file.close();
        throw e;
      }
      return new Response(file.readable, {
        headers: { "Content-Type": "application/octet-stream", ETag: `"${record.version}"` },
      });
    }
    if (!creating && (!["PUT", "DELETE"].includes(request.method) || match?.[2])) throw new HttpError(405, "Method not allowed");
    // Custom content type + authorization prevent cross-origin form submissions; no CORS is granted.
    if (request.headers.get("Sec-Fetch-Site") === "cross-site") throw new HttpError(403, "Cross-site uploads are not allowed");
    if (request.headers.get("Content-Type") !== "application/octet-stream") throw new HttpError(415, "Expected a save package");
    if (record) {
      const edit = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
      if (!TOKEN.test(edit) || await digest(edit) !== record.editHash) throw new HttpError(403, "This device does not own the shared save");
    }
    if (this.writing) throw new HttpError(503, "Another upload is in progress; retry shortly");
    this.writing = true;
    try {
      // Re-read after authorization's await: a concurrent write may have replaced the record.
      if (record) {
        record = this.records.get(record.id);
        if (!record || record.deleted || record.expires <= this.now()) throw new HttpError(404, "Shared save expired or not found");
      }
      if (request.method === "DELETE" && record) {
        await this.save({ ...record, deleted: true, size: 0 }, new Uint8Array());
        return new Response(null, { status: 204 });
      }
      const active = [...this.records.values()].filter((r) => !r.deleted && r.expires > now);
      if (creating) {
        if (active.filter((r) => r.owner === owner).length >= 3) {
          throw new HttpError(429, "Only three active shared saves per IP are allowed");
        }
        if ([...this.records.values()].filter((r) => r.owner === owner && r.created > now - 86_400_000).length >= 6) {
          throw new HttpError(429, "Only six new shares per IP are allowed in 24 hours, including deleted shares");
        }
        if (active.length >= MAX_ACTIVE || this.records.size >= 2048) throw new HttpError(503, "Shared-save storage is full");
      } else if (record && now - record.updated < SHARE_INTERVAL) {
        throw new HttpError(429, "Wait 30 seconds between save updates");
      }
      const body = await this.readBody(request);
      if (record && record.expires <= this.now()) throw new HttpError(404, "Shared save expired while uploading");
      let name: string;
      try {
        name = unpackSave(body).name;
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      if (active.reduce((sum, r) => sum + r.size, 0) - (record?.size ?? 0) + body.length > MAX_STORAGE) {
        throw new HttpError(503, "Shared-save storage is full");
      }
      const edit = creating ? randomToken() : undefined;
      const next: RecordInfo = {
        id: record?.id ?? randomToken(),
        owner: record?.owner ?? owner,
        editHash: record?.editHash ?? await digest(edit!),
        created: record?.created ?? now,
        expires: record?.expires ?? now + SHARE_LIFETIME,
        updated: now,
        version: randomToken(),
        name,
        size: body.length,
        deleted: false,
      };
      await this.save(next, body);
      return Response.json({ ...publicInfo(next), ...(edit ? { edit } : {}) }, { status: creating ? 201 : 200 });
    } finally {
      this.writing = false;
    }
  }

  private async readBody(request: Request): Promise<Uint8Array> {
    const declared = request.headers.get("Content-Length");
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_UPLOAD)) throw new HttpError(413, "Upload exceeds 64 MiB");
    const reader = request.body?.getReader();
    if (!reader) throw new HttpError(400, "Missing save package");
    let timer: number | undefined;
    let timedOut = false;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      timer = setTimeout(() => {
        timedOut = true;
        reader.cancel("Upload timeout").catch((e) => console.error("Could not cancel upload", e));
      }, 60_000);
      for (;;) {
        const { value, done } = await reader.read();
        if (timedOut) throw new HttpError(408, "Upload timed out");
        if (done) break;
        size += value.length;
        if (size > MAX_UPLOAD) {
          await reader.cancel();
          throw new HttpError(413, "Upload exceeds 64 MiB");
        }
        chunks.push(value);
      }
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
    return body;
  }
}

if (import.meta.main) {
  const store = new UploadStore(Deno.env.get("UPLOAD_DIR") ?? "/data");
  await store.init();
  const trustProxy = Deno.env.get("TRUST_UPLOAD_PROXY") === "true";
  setInterval(() => store.cleanup().catch((e) => console.error("Upload expiry cleanup failed", e)), 60_000);
  Deno.serve(
    { hostname: "0.0.0.0", port: 8081 },
    (request, info) =>
      store.handle(request, trustProxy ? request.headers.get("X-Upload-IP") ?? info.remoteAddr.hostname : info.remoteAddr.hostname),
  );
}

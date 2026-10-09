import {
  frame,
  LIBRARY_WORLDS,
  libraryId,
  MAX_UPLOAD,
  newToken,
  RETENTION,
  SHARE_INTERVAL,
  shareId,
  shareKey,
  TOKEN,
  unframe,
  unpackSave,
  validName,
  worldId,
  type WorldInfo,
} from "../src/sharing-format.ts";

/** One stored world. Keys are never stored: a library is its sync key's hash, a share link its share key's hash. */
interface WorldRecord {
  key: string;
  library: string;
  id: string;
  name: string;
  owner: string;
  created: number;
  updated: number;
  expires: number;
  version: string;
  size: number;
  /** The share key derives from the sync key and this salt; a new salt revokes the old share link. */
  salt: string;
  view: string;
}
interface LibraryRecord {
  id: string;
  name: string;
  owner: string;
  updated: number;
}

const DAY = 86_400_000;
const MAX_STORAGE = 1024 * 1024 * 1024;
const MAX_WORLDS = 128;
const MAX_LIBRARIES = 2048;
/** Abuse guardrails per client network, on top of the per-library limit. */
const NETWORK_WORLDS = 10;
const NETWORK_DAILY = 10;
const NETWORK_LIBRARIES = 10;
export const LIMITS = {
  worldsPerLibrary: LIBRARY_WORLDS,
  retentionDays: RETENTION / DAY,
  maxBytes: MAX_UPLOAD,
  pollSeconds: SHARE_INTERVAL / 1000,
};

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

async function readHeader(file: Deno.FsFile): Promise<WorldRecord> {
  const length = new DataView((await readExactly(file, 4)).buffer).getUint32(0);
  if (length > 4096) throw new Error("Invalid stored record");
  return JSON.parse(new TextDecoder().decode(await readExactly(file, length)));
}

async function removeIfPresent(path: string) {
  try {
    await Deno.remove(path);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
}

export class UploadStore {
  private worlds = new Map<string, WorldRecord>();
  private views = new Map<string, string>();
  private libraries = new Map<string, LibraryRecord>();
  private adds: { owner: string; at: number }[] = [];
  private rates = new Map<string, { count: number; until: number }>();
  private writing = false;
  private salt = "";
  constructor(private directory: string, private now = () => Date.now()) {}

  async init() {
    await Deno.mkdir(`${this.directory}/worlds`, { recursive: true });
    await Deno.mkdir(`${this.directory}/libraries`, { recursive: true });
    try {
      this.salt = await Deno.readTextFile(`${this.directory}/salt`);
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
      this.salt = newToken();
      await Deno.writeTextFile(`${this.directory}/salt`, this.salt, { createNew: true, mode: 0o600 });
    }
    for await (const entry of Deno.readDir(this.directory)) {
      // Uploads from the earlier one-link-per-upload format are not migrated; they expired within a week anyway.
      if (/^[a-f0-9]{64}\.(bin|tmp)$/.test(entry.name) || entry.name === "adds.json.tmp") {
        await Deno.remove(`${this.directory}/${entry.name}`);
      }
    }
    for await (const entry of Deno.readDir(`${this.directory}/worlds`)) {
      const path = `${this.directory}/worlds/${entry.name}`;
      if (entry.name.endsWith(".tmp")) await Deno.remove(path);
      else if (/^[a-f0-9]{64}\.bin$/.test(entry.name)) {
        const file = await Deno.open(path);
        try {
          const record = await readHeader(file);
          if (record.key !== entry.name.slice(0, -4)) throw new Error("Stored record key mismatch");
          this.worlds.set(record.key, record);
          this.views.set(record.view, record.key);
        } finally {
          file.close();
        }
      }
    }
    for await (const entry of Deno.readDir(`${this.directory}/libraries`)) {
      const path = `${this.directory}/libraries/${entry.name}`;
      if (entry.name.endsWith(".tmp")) await Deno.remove(path);
      else if (/^[a-f0-9]{64}\.json$/.test(entry.name)) {
        const library: LibraryRecord = JSON.parse(await Deno.readTextFile(path));
        if (library.id !== entry.name.slice(0, -5)) throw new Error("Stored library mismatch");
        this.libraries.set(library.id, library);
      }
    }
    try {
      this.adds = JSON.parse(await Deno.readTextFile(`${this.directory}/adds.json`));
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
    await this.cleanup();
  }

  async cleanup() {
    if (this.writing) return;
    this.writing = true;
    try {
      const now = this.now();
      for (const record of this.worlds.values()) if (record.expires <= now) await this.drop(record);
      const used = new Set([...this.worlds.values()].map((w) => w.library));
      for (const library of this.libraries.values()) {
        if (library.updated + RETENTION <= now && !used.has(library.id)) {
          await removeIfPresent(`${this.directory}/libraries/${library.id}.json`);
          this.libraries.delete(library.id);
        }
      }
      const adds = this.adds.filter((a) => a.at > now - DAY);
      if (adds.length !== this.adds.length) {
        this.adds = adds;
        await this.write(`${this.directory}/adds.json`, new TextEncoder().encode(JSON.stringify(adds)));
      }
      for (const [ip, rate] of this.rates) if (rate.until <= now) this.rates.delete(ip);
    } finally {
      this.writing = false;
    }
  }

  private async drop(record: WorldRecord) {
    await removeIfPresent(`${this.directory}/worlds/${record.key}.bin`);
    this.worlds.delete(record.key);
    if (this.views.get(record.view) === record.key) this.views.delete(record.view);
  }

  private async write(path: string, bytes: Uint8Array) {
    try {
      await Deno.writeFile(`${path}.tmp`, bytes, { mode: 0o600 });
      await Deno.rename(`${path}.tmp`, path);
    } catch (e) {
      try {
        await Deno.remove(`${path}.tmp`);
      } catch (cleanup) {
        if (!(cleanup instanceof Deno.errors.NotFound)) console.error("Could not remove failed upload", cleanup);
      }
      throw e;
    }
  }

  private async store(record: WorldRecord, body: Uint8Array) {
    await this.write(`${this.directory}/worlds/${record.key}.bin`, frame(record, body));
    const old = this.worlds.get(record.key);
    if (old && old.view !== record.view) this.views.delete(old.view);
    this.worlds.set(record.key, record);
    this.views.set(record.view, record.key);
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

  private key(request: Request): string {
    const header = request.headers.get("Authorization") ?? "";
    const key = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!TOKEN.test(key)) throw new HttpError(401, "Missing or invalid key");
    return key;
  }

  /** Authorization headers and non-form content types already force a CORS preflight, which is never granted. */
  private mutation(request: Request, type?: string) {
    if (request.headers.get("Sec-Fetch-Site") === "cross-site") throw new HttpError(403, "Cross-site changes are not allowed");
    if (type && request.headers.get("Content-Type") !== type) throw new HttpError(415, `Expected ${type}`);
  }

  private async exclusive<T>(run: () => Promise<T>): Promise<T> {
    if (this.writing) throw new HttpError(503, "Another upload is in progress; retry shortly");
    this.writing = true;
    try {
      return await run();
    } finally {
      this.writing = false;
    }
  }

  private live(key: string | undefined): WorldRecord | undefined {
    const record = key ? this.worlds.get(key) : undefined;
    return record && record.expires > this.now() ? record : undefined;
  }

  private async info(record: WorldRecord, sync: string): Promise<WorldInfo> {
    const { id, name, created, updated, expires, version, size } = record;
    return { id, name, created, updated, expires, version, size, share: await shareKey(sync, record.salt) };
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
    if (url.pathname === "/api/config" && request.method === "GET") return Response.json(LIMITS);

    if (url.pathname === "/api/view/data") {
      if (request.method !== "GET") throw new HttpError(405, "Shared worlds are read-only");
      const record = this.live(this.views.get(await shareId(this.key(request))));
      if (!record) throw new HttpError(404, "This shared world was deleted, expired, or its link was reset");
      return this.data(request, record);
    }

    const match = /^\/api\/library(?:\/worlds\/([A-Za-z0-9_-]{22})(\/data|\/share)?)?$/.exec(url.pathname);
    if (!match) throw new HttpError(404, "Not found");
    const sync = this.key(request);
    const library = await libraryId(sync);
    const [, id, action] = match;
    if (!id && request.method === "GET") {
      const worlds = [...this.worlds.values()].filter((w) => w.library === library && w.expires > now)
        .sort((a, b) => b.updated - a.updated);
      return Response.json({
        name: this.libraries.get(library)?.name ?? "",
        worlds: await Promise.all(worlds.map((w) => this.info(w, sync))),
        limits: LIMITS,
      });
    }
    if (!id && request.method === "PATCH") return this.rename(request, library, owner);
    if (!id) throw new HttpError(405, "Method not allowed");
    const key = await digest(`${library}/${id}`);
    if (action === "/data" && request.method === "GET") {
      const record = this.live(key);
      if (!record) throw new HttpError(404, "This world was deleted or expired");
      return this.data(request, record);
    }
    if (action === "/share" && request.method === "POST") return this.reshare(request, key, sync);
    if (!action && request.method === "PUT") return this.upsert(request, { key, library, id, owner, sync });
    if (!action && request.method === "DELETE") {
      this.mutation(request);
      return this.exclusive(async () => {
        const record = this.live(key);
        if (!record) throw new HttpError(404, "This world was already deleted or expired");
        await this.drop(record);
        return new Response(null, { status: 204 });
      });
    }
    throw new HttpError(405, "Method not allowed");
  }

  private async data(request: Request, record: WorldRecord): Promise<Response> {
    if (request.headers.get("If-None-Match") === `"${record.version}"`) return new Response(null, { status: 304 });
    const file = await Deno.open(`${this.directory}/worlds/${record.key}.bin`);
    try {
      // The file may have been replaced since the in-memory lookup; its own header describes these bytes.
      const stored = await readHeader(file);
      if (stored.expires <= this.now()) throw new HttpError(404, "This world was deleted or expired");
      return new Response(file.readable, {
        headers: {
          "Content-Type": "application/octet-stream",
          ETag: `"${stored.version}"`,
          "Last-Modified": new Date(stored.updated).toUTCString(),
        },
      });
    } catch (e) {
      file.close();
      throw e;
    }
  }

  private async rename(request: Request, library: string, owner: string): Promise<Response> {
    this.mutation(request, "application/json");
    let name: unknown;
    try {
      name = JSON.parse(new TextDecoder().decode(await this.readBody(request, 1024))).name;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, "Expected a JSON name");
    }
    if (!validName(name)) throw new HttpError(400, "Library names are at most 40 characters, without control characters");
    return this.exclusive(async () => {
      const path = `${this.directory}/libraries/${library}.json`;
      const existing = this.libraries.get(library);
      if (!name) {
        // Unnamed is the default, so clearing a name frees its record.
        await removeIfPresent(path);
        this.libraries.delete(library);
        return Response.json({ name });
      }
      if (!existing) {
        if ([...this.libraries.values()].filter((l) => l.owner === owner).length >= NETWORK_LIBRARIES) {
          throw new HttpError(429, `Only ${NETWORK_LIBRARIES} libraries can be named from one network`);
        }
        if (this.libraries.size >= MAX_LIBRARIES) throw new HttpError(503, "Library storage is full");
      }
      const record: LibraryRecord = { id: library, name, owner: existing?.owner ?? owner, updated: this.now() };
      await this.write(path, new TextEncoder().encode(JSON.stringify(record)));
      this.libraries.set(library, record);
      return Response.json({ name });
    });
  }

  private reshare(request: Request, key: string, sync: string): Promise<Response> {
    this.mutation(request);
    return this.exclusive(async () => {
      const record = this.live(key);
      if (!record) throw new HttpError(404, "This world was deleted or expired");
      const { body } = unframe(await Deno.readFile(`${this.directory}/worlds/${key}.bin`));
      const salt = newToken();
      const next = { ...record, salt, view: await shareId(await shareKey(sync, salt)) };
      await this.store(next, body);
      return Response.json(await this.info(next, sync));
    });
  }

  private upsert(
    request: Request,
    { key, library, id, owner, sync }: { key: string; library: string; id: string; owner: string; sync: string },
  ): Promise<Response> {
    this.mutation(request, "application/octet-stream");
    return this.exclusive(async () => {
      const now = this.now();
      const record = this.live(key);
      // "If-Match: *" marks an update: it must not quietly re-add a world deleted on another device.
      if (!record && request.headers.get("If-Match") === "*") {
        throw new HttpError(412, "This world is no longer in your library (it was deleted or expired). Add it again to keep it");
      }
      if (record && now - record.updated < SHARE_INTERVAL) throw new HttpError(429, "Wait 30 seconds between updates of a world");
      const active = [...this.worlds.values()].filter((w) => w.expires > now);
      if (!record) {
        // Updating a world already in the library is always allowed; only adding one counts against limits.
        if (active.filter((w) => w.library === library).length >= LIBRARY_WORLDS) {
          throw new HttpError(409, `Your library is full (${LIBRARY_WORLDS} of ${LIBRARY_WORLDS} worlds). Delete a world to add this one.`);
        }
        if (active.filter((w) => w.owner === owner).length >= NETWORK_WORLDS) {
          throw new HttpError(429, `Only ${NETWORK_WORLDS} worlds can be stored from one network at a time`);
        }
        if (this.adds.filter((a) => a.owner === owner && a.at > now - DAY).length >= NETWORK_DAILY) {
          throw new HttpError(429, `Only ${NETWORK_DAILY} worlds can be added from one network per day, including deleted ones`);
        }
        if (active.length >= MAX_WORLDS) throw new HttpError(503, "Shared-save storage is full");
      }
      const body = await this.readBody(request, MAX_UPLOAD);
      let unpacked: ReturnType<typeof unpackSave>;
      try {
        unpacked = unpackSave(body);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      if (await worldId(unpacked.name, unpacked.grid) !== id) {
        throw new HttpError(409, "This save is a different world from the one it would update, so nothing was changed");
      }
      if (active.reduce((sum, w) => sum + w.size, 0) - (record?.size ?? 0) + body.length > MAX_STORAGE) {
        throw new HttpError(503, "Shared-save storage is full");
      }
      const salt = record?.salt ?? newToken();
      const next: WorldRecord = {
        key,
        library,
        id,
        name: unpacked.name,
        owner: record?.owner ?? owner,
        created: record?.created ?? now,
        updated: now,
        expires: now + RETENTION,
        version: newToken(),
        size: body.length,
        salt,
        view: record?.view ?? await shareId(await shareKey(sync, salt)),
      };
      await this.store(next, body);
      if (!record) {
        this.adds.push({ owner, at: now });
        await this.write(`${this.directory}/adds.json`, new TextEncoder().encode(JSON.stringify(this.adds)));
      }
      return Response.json(await this.info(next, sync), { status: record ? 200 : 201 });
    });
  }

  private async readBody(request: Request, max: number): Promise<Uint8Array> {
    const limit = max === MAX_UPLOAD ? "64 MiB" : `${max} bytes`;
    const declared = request.headers.get("Content-Length");
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > max)) throw new HttpError(413, `Upload exceeds ${limit}`);
    const reader = request.body?.getReader();
    if (!reader) throw new HttpError(400, "Missing request body");
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
        if (size > max) {
          await reader.cancel();
          throw new HttpError(413, `Upload exceeds ${limit}`);
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

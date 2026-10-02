import { type FileMap, findCharacters } from "../src/files.ts";
import { frame, MAX_FILES, MAX_UPLOAD, packSave, SHARE_INTERVAL, SHARE_LIFETIME, unframe, unpackSave } from "../src/sharing-format.ts";
import { ipBucket, UploadStore } from "../server/uploads.ts";
import { assert, assertEquals, assertRejects } from "./assert.ts";

function fixture(): FileMap {
  const bytes = new TextEncoder().encode(JSON.stringify([{ worldGrid: Array.from({ length: 5 }, () => [1, 1, 1, 1, 1]) }]));
  return new Map([
    ["Saves/Hero/Player.save", { read: () => Promise.resolve(bytes), lastModified: 1234 }],
    ["Saves/Hero/[ 0,0 ]/Containers.save", { read: () => Promise.resolve(new TextEncoder().encode("[]")) }],
    ["Saves/Other/Player.save", { read: () => Promise.resolve(bytes) }],
  ]);
}
const packet = () => packSave(fixture(), { name: "Hero", root: "Saves/Hero/" });

Deno.test("sharing: package only selected character with immutable file bytes and timestamps", async () => {
  const files = fixture();
  const bytes = await packet();
  const unpacked = unpackSave(bytes);
  assertEquals(unpacked.name, "Hero");
  assertEquals(findCharacters(unpacked.files), [{ name: "Shared", root: "Shared/" }]);
  assertEquals([...unpacked.files.keys()], ["Shared/Player.save", "Shared/[ 0,0 ]/Containers.save"]);
  assertEquals(unpacked.files.get("Shared/Player.save")!.lastModified, 1234);
  assertEquals([...await unpacked.files.get("Shared/Player.save")!.read()], [...await files.get("Saves/Hero/Player.save")!.read()]);
});

Deno.test("sharing: reject path traversal, duplicates, multiple characters and malformed manifests", async () => {
  for (const path of ["../Player.save", "/Player.save", "x\\Player.save", "x//Player.save", "x/Player.save", "a.exe", "a\0.save"]) {
    await assertRejects(() => unpackSave(frame({ name: "Hero", entries: [{ path, size: 0, modified: 0 }] }, new Uint8Array())));
  }
  for (const size of [-1, 1, 0.5, "0"]) {
    await assertRejects(() => unpackSave(frame({ name: "Hero", entries: [{ path: "Player.save", size, modified: 0 }] }, new Uint8Array())));
  }
  await assertRejects(() => unpackSave(frame({ name: "Hero", entries: Array(MAX_FILES + 1).fill({}) }, new Uint8Array())));
  await assertRejects(() => unpackSave(new Uint8Array(MAX_UPLOAD + 1)), /64 MiB/);
  await assertRejects(() => unpackSave(new Uint8Array([255, 255, 255, 255])), /manifest size/);
  await assertRejects(() =>
    unpackSave(frame({ name: "Hero", entries: [{ path: "Player.save", size: 2, modified: 0 }] }, new TextEncoder().encode("[]")))
  );
  const { header, body } = unframe(await packet());
  assert(header && typeof header === "object" && "entries" in header && Array.isArray(header.entries));
  header.entries.push(header.entries[0]);
  await assertRejects(() => unpackSave(frame(header, body)), /Invalid save file entry/);
});

Deno.test("sharing: IP quotas normalize mapped IPv4 and IPv6 privacy addresses", () => {
  assertEquals(ipBucket("192.168.1.12"), "192.168.1.12");
  assertEquals(ipBucket("::ffff:192.168.1.12"), "192.168.1.12");
  assertEquals(ipBucket("2001:db8:1234:5678::1"), ipBucket("2001:db8:1234:5678:abcd::12"));
  assert(ipBucket("2001:db8:1234:5679::1") !== ipBucket("2001:db8:1234:5678::1"));
});

Deno.test("sharing: package byte and file-count limits accept their exact boundary", async () => {
  const player = await fixture().get("Saves/Hero/Player.save")!.read();
  const entries = [{ path: "Player.save", size: player.length, modified: 0 }];
  for (let i = 1; i < MAX_FILES; i++) entries.push({ path: `area/${i}.save`, size: 0, modified: 0 });
  assertEquals(unpackSave(frame({ name: "Hero", entries }, player)).files.size, MAX_FILES);
  const largeEntries = [
    { path: "Player.save", size: player.length, modified: 0 },
    { path: "Maps/0_0.png", size: MAX_UPLOAD, modified: 0 },
  ];
  const manifestSize = frame({ name: "Hero", entries: largeEntries }, new Uint8Array()).length;
  largeEntries[1].size = MAX_UPLOAD - manifestSize - player.length;
  const body = new Uint8Array(MAX_UPLOAD - manifestSize);
  body.set(player);
  const exact = frame({ name: "Hero", entries: largeEntries }, body);
  assertEquals(exact.length, MAX_UPLOAD);
  assertEquals(unpackSave(exact).files.size, 2);
  await assertRejects(
    () =>
      unpackSave(
        frame(
          { name: "Hero", entries: [{ path: "Player.save", size: 4 * 1024 * 1024 + 1, modified: 0 }] },
          new Uint8Array(4 * 1024 * 1024 + 1),
        ),
      ),
    /4 MiB/,
  );
});

async function withStore(
  run: (context: {
    store: UploadStore;
    directory: string;
    advance(ms: number): void;
    request(method: string, path?: string, bytes?: Uint8Array, edit?: string, ip?: string): Promise<Response>;
    restart(): Promise<void>;
  }) => Promise<void>,
) {
  const directory = await Deno.makeTempDir({ prefix: "mirklurk-sharing-" });
  let now = 1_800_000_000_000;
  let store = new UploadStore(directory, () => now);
  await store.init();
  try {
    await run({
      get store() {
        return store;
      },
      directory,
      advance: (ms) => now += ms,
      request: (method, path = "", bytes, edit, ip = "192.0.2.1") =>
        store.handle(
          new Request(`http://localhost/api/shares${path}`, {
            method,
            headers: { "Content-Type": "application/octet-stream", ...(edit ? { Authorization: `Bearer ${edit}` } : {}) },
            body: bytes as BodyInit | undefined,
          }),
          ip,
        ),
      restart: async () => {
        store = new UploadStore(directory, () => now);
        await store.init();
      },
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

Deno.test("sharing service: private read capabilities, owner-only updates, fixed expiry, restart persistence", () =>
  withStore(async (ctx) => {
    const bytes = await packet();
    const created = await ctx.request("POST", "", bytes);
    assertEquals(created.status, 201);
    const info = await created.json();
    assert(info.id !== info.edit);
    assertEquals(info.expires - info.created, SHARE_LIFETIME);
    const metadata = await (await ctx.request("GET", `/${info.id}`)).json();
    assert(!("edit" in metadata) && !("editHash" in metadata) && !("owner" in metadata));
    const data = await ctx.request("GET", `/${info.id}/data`);
    assertEquals(data.headers.get("cache-control"), "no-store");
    const etag = data.headers.get("etag")!;
    assertEquals([...new Uint8Array(await data.arrayBuffer())], [...bytes]);
    const unchanged = await ctx.store.handle(
      new Request(`http://localhost/api/shares/${info.id}/data`, {
        headers: { "If-None-Match": etag },
      }),
      "192.0.2.1",
    );
    assertEquals(unchanged.status, 304);
    assertEquals((await ctx.request("PUT", `/${info.id}`, bytes, info.id)).status, 403);
    assertEquals((await ctx.request("PUT", `/${info.id}`, bytes, info.edit)).status, 429);
    ctx.advance(SHARE_INTERVAL);
    const updated = await ctx.request("PUT", `/${info.id}`, bytes, info.edit);
    assertEquals(updated.status, 200);
    const newer = await updated.json();
    assertEquals(newer.expires, info.expires);
    assert(newer.version !== info.version);
    await ctx.restart();
    assertEquals((await (await ctx.request("GET", `/${info.id}`)).json()).version, newer.version);
    ctx.advance(SHARE_LIFETIME);
    assertEquals((await ctx.request("GET", `/${info.id}`)).status, 404);
    assertEquals((await ctx.request("GET", `/${info.id}/data`)).status, 404);
    await ctx.store.cleanup();
    await assertRejects(() => Deno.stat(`${ctx.directory}/${info.id}.bin`), /cannot find|not found|No such file/i);
  }));

Deno.test("sharing service: three active saves per IP; deletion cannot bypass persistent daily creation limits", () =>
  withStore(async (ctx) => {
    const bytes = await packet();
    const records = [];
    for (let i = 0; i < 3; i++) records.push(await (await ctx.request("POST", "", bytes)).json());
    assertEquals((await ctx.request("POST", "", bytes)).status, 429);
    assertEquals((await ctx.request("POST", "", bytes, undefined, "192.0.2.2")).status, 201);
    for (const record of records) {
      assertEquals((await ctx.request("DELETE", `/${record.id}`, undefined, "0".repeat(64))).status, 403);
      assertEquals((await ctx.request("DELETE", `/${record.id}`, undefined, record.edit)).status, 204);
      assertEquals((await ctx.request("GET", `/${record.id}`)).status, 404);
      assertEquals((await ctx.request("PUT", `/${record.id}`, bytes, record.edit)).status, 404);
    }
    for (let i = 0; i < 3; i++) {
      const record = await (await ctx.request("POST", "", bytes)).json();
      await ctx.request("DELETE", `/${record.id}`, undefined, record.edit);
    }
    await ctx.restart();
    assertEquals((await ctx.request("POST", "", bytes)).status, 429);
    ctx.advance(86_400_001);
    assertEquals((await ctx.request("POST", "", bytes)).status, 201);
  }));

Deno.test("sharing service: invalid packages, cross-site writes, oversized bodies and request floods are rejected", () =>
  withStore(async (ctx) => {
    assertEquals((await ctx.request("POST", "", new Uint8Array([1]))).status, 400);
    const cross = new Request("http://localhost/api/shares", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "Sec-Fetch-Site": "cross-site" },
      body: await packet() as BodyInit,
    });
    assertEquals((await ctx.store.handle(cross, "192.0.2.1")).status, 403);
    const large = new Request("http://localhost/api/shares", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "Content-Length": String(MAX_UPLOAD + 1) },
      body: new Uint8Array(),
    });
    assertEquals((await ctx.store.handle(large, "192.0.2.1")).status, 413);
    for (let i = 0; i < 60; i++) await ctx.request("GET");
    assertEquals((await ctx.request("GET")).status, 429);
    ctx.advance(60_001);
    assertEquals((await ctx.request("GET")).status, 200);
  }));

Deno.test("sharing service: only one upload body is admitted at a time", () =>
  withStore(async (ctx) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let admitted!: () => void;
    const reading = new Promise<void>((resolve) => admitted = resolve);
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => controller = c,
      pull: () => admitted(),
    }, { highWaterMark: 0 });
    const first = ctx.store.handle(
      new Request("http://localhost/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: stream,
      }),
      "192.0.2.1",
    );
    await reading;
    const next = await ctx.request("POST", "", await packet());
    controller.enqueue(await packet());
    controller.close();
    assertEquals((await first).status, 201);
    assertEquals(next.status, 503);
  }));

Deno.test("sharing service: streamed bodies cannot bypass byte limits without Content-Length", () =>
  withStore(async (ctx) => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_UPLOAD));
        controller.enqueue(new Uint8Array(1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await ctx.store.handle(
      new Request("http://localhost/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body,
      }),
      "192.0.2.1",
    );
    assertEquals(response.status, 413);
    assert(cancelled);
    assertEquals((await ctx.request("POST", "", await packet())).status, 201);
  }));

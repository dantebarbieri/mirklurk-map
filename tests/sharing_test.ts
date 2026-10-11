import { type FileMap, findCharacters } from "../src/files.ts";
import {
  formatPairCode,
  frame,
  keyFromLink,
  linkKey,
  MAX_FILES,
  MAX_UPLOAD,
  newPairCode,
  newToken,
  openPairing,
  packSave,
  PAIR_BOX,
  PAIR_ID,
  PAIR_TTL,
  pairCode,
  pairId,
  RETENTION,
  sealPairing,
  SHARE_INTERVAL,
  TOKEN,
  unframe,
  unpackSave,
  worldId,
} from "../src/sharing-format.ts";
import { ipBucket, UploadStore } from "../server/uploads.ts";
import { assert, assertEquals, assertRejects } from "./assert.ts";

const encode = (text: string) => new TextEncoder().encode(text);
const grid = (cell: number) => Array.from({ length: 5 }, () => Array(5).fill(cell));
function fixture(name = "Hero", cell = 1): FileMap {
  const bytes = encode(JSON.stringify([{ worldGrid: grid(cell) }]));
  return new Map([
    [`Saves/${name}/Player.save`, { read: () => Promise.resolve(bytes), lastModified: 1234 }],
    [`Saves/${name}/[ 0,0 ]/Containers.save`, { read: () => Promise.resolve(encode("[]")) }],
    ["Saves/Other/Player.save", { read: () => Promise.resolve(bytes) }],
  ]);
}
const packet = (name = "Hero", cell = 1) => packSave(fixture(name, cell), { name, root: `Saves/${name}/` });
const idOf = (name = "Hero", cell = 1) => worldId(name, grid(cell));

Deno.test("sharing: package only selected character with immutable file bytes and timestamps", async () => {
  const files = fixture();
  const bytes = await packet();
  const unpacked = unpackSave(bytes);
  assertEquals(unpacked.name, "Hero");
  assertEquals(unpacked.grid, grid(1));
  assertEquals(findCharacters(unpacked.files), [{ name: "Shared", root: "Shared/" }]);
  assertEquals([...unpacked.files.keys()], ["Shared/Player.save", "Shared/[ 0,0 ]/Containers.save"]);
  assertEquals(unpacked.files.get("Shared/Player.save")!.lastModified, 1234);
  assertEquals([...await unpacked.files.get("Shared/Player.save")!.read()], [...await files.get("Saves/Hero/Player.save")!.read()]);
});

Deno.test("sharing: world identity is the character name and zone layout", async () => {
  assert(TOKEN.test(newToken()) && newToken() !== newToken());
  assertEquals(await idOf(), await idOf());
  assert(await idOf("Hero", 1) !== await idOf("Hero", 2));
  assert(await idOf("Hero", 1) !== await idOf("Other", 1));
});

Deno.test("sharing: links carry keys as 78 digits that round-trip exactly", () => {
  for (let i = 0; i < 200; i++) {
    const key = newToken();
    assert(TOKEN.test(key), key);
    const digits = linkKey(key);
    assert(/^\d{78}$/.test(digits));
    assertEquals(keyFromLink(digits), key);
  }
  assertEquals(linkKey("A".repeat(43)), "0".repeat(78));
  const max = ((1n << 256n) - 1n).toString();
  assertEquals(keyFromLink(max), `${"_".repeat(42)}8`);
  assertEquals(keyFromLink((1n << 256n).toString()), undefined);
  for (const bad of ["1".repeat(77), "1".repeat(79), `${"1".repeat(77)}x`, ""]) assertEquals(keyFromLink(bad), undefined);
  // Only canonical base64url is a key, so every key has exactly one link form.
  assert(!TOKEN.test(`${"A".repeat(42)}B`));
});

Deno.test("sharing: sync codes are 8 unambiguous characters, and only the right code opens the sealed key", async () => {
  for (let i = 0; i < 100; i++) {
    const code = newPairCode();
    assert(/^[0-9A-HJKMNP-TV-Z]{8}$/.test(code), code);
    assertEquals(pairCode(code), code);
    assertEquals(pairCode(` ${formatPairCode(code).toLowerCase()} `), code);
  }
  assertEquals(formatPairCode("ABCD1234"), "ABCD-1234");
  assertEquals(pairCode("oIlL 00 00"), "01110000");
  for (const bad of ["ABCDEFG", "ABCDEFGHJ", "ABCU-EFGH", "ABCD_EFGH", "", "https://map.example/#s=1"]) {
    assertEquals(pairCode(bad), undefined);
  }

  const key = newToken(), code = "K7M2-9QXR".replace("-", "");
  const sealed = await sealPairing(code, key);
  assert(PAIR_ID.test(sealed.id) && PAIR_BOX.test(sealed.box));
  assertEquals(sealed.id, await pairId(code));
  assert(!sealed.box.includes(key));
  assert((await sealPairing(code, key)).box !== sealed.box, "each seal uses a fresh IV");
  assertEquals(await openPairing(code, sealed.box), key);
  assertEquals(await openPairing("K7M29QXS", sealed.box), undefined);
  const tampered = sealed.box.slice(0, 30) + (sealed.box[30] === "A" ? "B" : "A") + sealed.box.slice(31);
  assertEquals(await openPairing(code, tampered), undefined);
  assertEquals(await openPairing(code, `${sealed.box}A`), undefined);
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
  await assertRejects(() => unpackSave(frame({ name: "Hero", entries: [{ path: "Player.save", size: 2, modified: 0 }] }, encode("[]"))));
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

interface Options {
  body?: BodyInit;
  key?: string;
  ip?: string;
  type?: string;
  headers?: Record<string, string>;
}
interface Context {
  store: UploadStore;
  directory: string;
  advance(ms: number): void;
  request(method: string, path: string, options?: Options): Promise<Response>;
  put(key: string, name?: string, cell?: number, ip?: string): Promise<Response>;
  list(key: string): Promise<{ name: string; worlds: Record<string, unknown>[]; limits?: unknown }>;
  restart(): Promise<void>;
}

async function withStore(run: (context: Context) => Promise<void>, before?: (directory: string) => Promise<void>) {
  const directory = await Deno.makeTempDir({ prefix: "mirklurk-sharing-" });
  await before?.(directory);
  let now = 1_800_000_000_000;
  let store = new UploadStore(directory, () => now);
  await store.init();
  const request = (method: string, path: string, { body, key, ip = "192.0.2.1", type, headers = {} }: Options = {}) =>
    store.handle(
      new Request(`http://localhost/api${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "Content-Type": type ?? "application/octet-stream" } : {}),
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
          ...headers,
        },
        body,
      }),
      ip,
    );
  try {
    await run({
      get store() {
        return store;
      },
      directory,
      advance: (ms) => now += ms,
      request,
      put: async (key, name = "Hero", cell = 1, ip) =>
        request("PUT", `/library/worlds/${await idOf(name, cell)}`, { key, ip, body: await packet(name, cell) as BodyInit }),
      list: async (key) => (await request("GET", "/library", { key })).json(),
      restart: async () => {
        store = new UploadStore(directory, () => now);
        await store.init();
      },
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

Deno.test("sharing service: a world is added once, then updated in place with sliding retention, surviving restarts", () =>
  withStore(async (ctx) => {
    const sync = newToken();
    assertEquals(await ctx.list(sync), {
      name: "",
      worlds: [],
      limits: { worldsPerLibrary: 5, retentionDays: 30, maxBytes: MAX_UPLOAD, pollSeconds: 30 },
    });
    const bytes = await packet();
    const created = await ctx.put(sync);
    assertEquals(created.status, 201);
    const info = await created.json();
    assertEquals(info.id, await idOf());
    assertEquals(info.name, "Hero");
    assertEquals(info.expires - info.updated, RETENTION);
    assert(TOKEN.test(info.share) && info.share !== sync);
    const listed = (await ctx.list(sync)).worlds;
    assertEquals(listed, [info]);
    const data = await ctx.request("GET", `/library/worlds/${info.id}/data`, { key: sync });
    assertEquals(data.headers.get("cache-control"), "no-store");
    assertEquals(Date.parse(data.headers.get("last-modified")!), Math.floor(info.updated / 1000) * 1000);
    const etag = data.headers.get("etag")!;
    assertEquals([...new Uint8Array(await data.arrayBuffer())], [...bytes]);
    const unchanged = await ctx.request("GET", `/library/worlds/${info.id}/data`, { key: sync, headers: { "If-None-Match": etag } });
    assertEquals(unchanged.status, 304);

    assertEquals((await ctx.put(sync)).status, 429);
    ctx.advance(SHARE_INTERVAL);
    const updated = await ctx.put(sync);
    assertEquals(updated.status, 200);
    const newer = await updated.json();
    assertEquals(newer.created, info.created);
    assertEquals(newer.share, info.share);
    assertEquals(newer.expires, info.expires + SHARE_INTERVAL);
    assert(newer.version !== info.version);
    assertEquals((await ctx.list(sync)).worlds.length, 1);

    await ctx.restart();
    assertEquals((await ctx.list(sync)).worlds, [newer]);
    ctx.advance(RETENTION - 1);
    assertEquals((await ctx.request("GET", `/library/worlds/${info.id}/data`, { key: sync })).status, 200);
    ctx.advance(1);
    assertEquals((await ctx.request("GET", `/library/worlds/${info.id}/data`, { key: sync })).status, 404);
    assertEquals((await ctx.list(sync)).worlds, []);
    await ctx.store.cleanup();
    assertEquals([...Deno.readDirSync(`${ctx.directory}/worlds`)].length, 0);
  }));

Deno.test("sharing service: share keys are read-only, never sync keys, and resetting one revokes it; keys are not stored", () =>
  withStore(async (ctx) => {
    const sync = newToken();
    const info = await (await ctx.put(sync)).json();
    const view = await ctx.request("GET", "/view/data", { key: info.share });
    assertEquals(view.status, 200);
    assertEquals([...new Uint8Array(await view.arrayBuffer())], [...await packet()]);
    assertEquals((await ctx.request("PUT", "/view/data", { key: info.share, body: await packet() as BodyInit })).status, 405);

    // A share key used as a sync key is just another, empty library.
    assertEquals((await ctx.list(info.share)).worlds, []);
    assertEquals((await ctx.request("DELETE", `/library/worlds/${info.id}`, { key: info.share })).status, 404);
    assertEquals((await ctx.request("GET", `/library/worlds/${info.id}/data`, { key: info.share })).status, 404);
    assertEquals((await ctx.request("POST", `/library/worlds/${info.id}/share`, { key: info.share })).status, 404);
    assertEquals((await ctx.put(info.share)).status, 201);
    assertEquals((await ctx.list(sync)).worlds, [info]);
    assertEquals((await ctx.request("GET", "/library")).status, 401);
    assertEquals((await ctx.request("GET", "/view/data", { key: "x".repeat(42) })).status, 401);
    assertEquals((await ctx.request("GET", "/view/data", { key: sync })).status, 404);

    const reset = await ctx.request("POST", `/library/worlds/${info.id}/share`, { key: sync });
    assertEquals(reset.status, 200);
    const fresh = await reset.json();
    assert(TOKEN.test(fresh.share) && fresh.share !== info.share);
    assertEquals(fresh.version, info.version);
    assertEquals((await ctx.request("GET", "/view/data", { key: info.share })).status, 404);
    await ctx.restart();
    assertEquals((await ctx.request("GET", "/view/data", { key: fresh.share })).status, 200);
    assertEquals((await ctx.request("GET", "/view/data", { key: info.share })).status, 404);

    const stored: string[] = [];
    const walk = (dir: string) => {
      for (const entry of Deno.readDirSync(dir)) {
        if (entry.isDirectory) walk(`${dir}/${entry.name}`);
        else stored.push(new TextDecoder().decode(Deno.readFileSync(`${dir}/${entry.name}`)));
      }
    };
    walk(ctx.directory);
    for (const key of [sync, info.share, fresh.share]) assert(!stored.some((text) => text.includes(key)), "a key was stored");
  }));

Deno.test("sharing service: five worlds per library; updates bypass it; a mismatched update changes nothing", () =>
  withStore(async (ctx) => {
    const sync = newToken();
    for (let i = 0; i < 5; i++) assertEquals((await ctx.put(sync, `Hero${i}`)).status, 201);
    const full = await ctx.put(sync, "Hero5");
    assertEquals(full.status, 409);
    assert(/full \(5 of 5 worlds\)/.test((await full.json()).error));
    ctx.advance(SHARE_INTERVAL);
    assertEquals((await ctx.put(sync, "Hero0")).status, 200);

    const before = (await ctx.list(sync)).worlds.find((w) => w.name === "Hero1");
    const mismatch = await ctx.request("PUT", `/library/worlds/${await idOf("Hero1")}`, {
      key: sync,
      body: await packet("Hero1", 2) as BodyInit,
    });
    assertEquals(mismatch.status, 409);
    assert(/different world/.test((await mismatch.json()).error));
    assertEquals((await ctx.list(sync)).worlds.find((w) => w.name === "Hero1"), before);

    assertEquals((await ctx.request("DELETE", `/library/worlds/${await idOf("Hero1")}`, { key: sync })).status, 204);
    assertEquals((await ctx.request("DELETE", `/library/worlds/${await idOf("Hero1")}`, { key: sync })).status, 404);
    // An update (If-Match: *) of a world deleted elsewhere is refused instead of re-adding it.
    const stale = await ctx.request("PUT", `/library/worlds/${await idOf("Hero1")}`, {
      key: sync,
      body: await packet("Hero1") as BodyInit,
      headers: { "If-Match": "*" },
    });
    assertEquals(stale.status, 412);
    assert(/no longer in your library/.test((await stale.json()).error));
    assertEquals((await ctx.list(sync)).worlds.length, 4);
    ctx.advance(SHARE_INTERVAL);
    const update = await ctx.request("PUT", `/library/worlds/${await idOf("Hero0")}`, {
      key: sync,
      body: await packet("Hero0") as BodyInit,
      headers: { "If-Match": "*" },
    });
    assertEquals(update.status, 200);
    assertEquals((await ctx.put(sync, "Hero5")).status, 201);
    assertEquals((await ctx.list(sync)).worlds.length, 5);
  }));

Deno.test("sharing service: per-network guardrails count stored worlds and daily adds, including deleted ones", () =>
  withStore(async (ctx) => {
    const first = newToken(), second = newToken(), third = newToken();
    for (let i = 0; i < 5; i++) {
      assertEquals((await ctx.put(first, `A${i}`)).status, 201);
      assertEquals((await ctx.put(second, `B${i}`)).status, 201);
    }
    assertEquals((await ctx.put(third)).status, 429);
    assertEquals((await ctx.put(third, "Hero", 1, "192.0.2.2")).status, 201);
    assertEquals((await ctx.request("DELETE", `/library/worlds/${await idOf("A0")}`, { key: first })).status, 204);
    await ctx.restart();
    const daily = await ctx.put(first, "A0");
    assertEquals(daily.status, 429);
    assert(/per day/.test((await daily.json()).error));
    ctx.advance(SHARE_INTERVAL);
    assertEquals((await ctx.put(first, "A1")).status, 200);
    ctx.advance(86_400_001);
    assertEquals((await ctx.put(first, "A0")).status, 201);
  }));

Deno.test("sharing service: library names are validated, persisted, returned to every synced device, and capped per network", () =>
  withStore(async (ctx) => {
    const sync = newToken();
    const rename = (body: string, type = "application/json") => ctx.request("PATCH", "/library", { key: sync, body, type });
    assertEquals((await rename(JSON.stringify({ name: "Dante's PCs" }))).status, 200);
    assertEquals((await ctx.list(sync)).name, "Dante's PCs");
    for (const name of ["x".repeat(41), "a\nb", " padded", 7]) assertEquals((await rename(JSON.stringify({ name }))).status, 400);
    assertEquals((await rename("not json")).status, 400);
    assertEquals((await rename(JSON.stringify({ name: "Form" }), "text/plain")).status, 415);
    await ctx.restart();
    assertEquals((await ctx.list(sync)).name, "Dante's PCs");
    ctx.advance(RETENTION);
    await ctx.store.cleanup();
    assertEquals((await ctx.list(sync)).name, "");

    // Naming is capped per network; clearing a name frees its slot.
    const named = (key: string, name: string, ip = "192.0.2.1") =>
      ctx.request("PATCH", "/library", { key, ip, body: JSON.stringify({ name }), type: "application/json" });
    const keys = Array.from({ length: 10 }, () => newToken());
    for (const key of keys) assertEquals((await named(key, "Mine")).status, 200);
    assertEquals((await named(newToken(), "One too many")).status, 429);
    assertEquals((await named(keys[0], "Renamed")).status, 200);
    assertEquals((await named(newToken(), "Elsewhere", "192.0.2.2")).status, 200);
    assertEquals((await named(keys[1], "")).status, 200);
    assertEquals((await ctx.list(keys[1])).name, "");
    assertEquals((await named(newToken(), "Fits again")).status, 200);
  }));

const json = (body: unknown, ip?: string) => ({ body: JSON.stringify(body), type: "application/json", ip });

Deno.test("sharing service: a sync code hands out its sealed key once, for ten minutes, and nothing about it is stored", () =>
  withStore(async (ctx) => {
    const sync = newToken(), code = newPairCode();
    const sealed = await sealPairing(code, sync);
    const offer = (body: unknown = sealed, key = sync) => ctx.request("POST", "/library/pair", { key, ...json(body) });
    const claim = (id = sealed.id) => ctx.request("POST", "/pair", json({ id }));
    const offered = await offer();
    assertEquals(offered.status, 201);
    assertEquals(await offered.json(), { expiresIn: PAIR_TTL / 1000 });
    const claimed = await claim();
    assertEquals(claimed.status, 200);
    assertEquals(claimed.headers.get("cache-control"), "no-store");
    assertEquals(await openPairing(code, (await claimed.json()).box), sync);
    assertEquals((await claim()).status, 404);

    assertEquals((await offer()).status, 201);
    ctx.advance(PAIR_TTL - 1);
    await ctx.store.cleanup();
    ctx.advance(1);
    const expired = await claim();
    assertEquals(expired.status, 404);
    assert(/wrong, was already used, or expired/.test((await expired.json()).error));

    // A new code replaces the library's earlier one, and closing the card withdraws it.
    const next = await sealPairing(newPairCode(), sync);
    assertEquals((await offer()).status, 201);
    assertEquals((await offer(next)).status, 201);
    assertEquals((await claim()).status, 404);
    assertEquals((await ctx.request("DELETE", "/library/pair", { key: sync })).status, 204);
    assertEquals((await claim(next.id)).status, 404);
    // Another library's code is not withdrawn with it.
    const other = newToken(), theirs = await sealPairing(newPairCode(), other);
    assertEquals((await offer(theirs, other)).status, 201);
    assertEquals((await ctx.request("DELETE", "/library/pair", { key: sync })).status, 204);
    assertEquals((await claim(theirs.id)).status, 200);

    assertEquals((await ctx.request("POST", "/library/pair", json(sealed))).status, 401);
    for (const bad of [{ id: "x", box: sealed.box }, { id: sealed.id, box: "short" }, { id: sealed.id }, [sealed.id, sealed.box]]) {
      assertEquals((await offer(bad)).status, 400);
    }
    assertEquals((await ctx.request("POST", "/library/pair", { key: sync, body: JSON.stringify(sealed), type: "text/plain" })).status, 415);
    assertEquals(
      (await ctx.request("POST", "/pair", { ...json({ id: sealed.id }), headers: { "Sec-Fetch-Site": "cross-site" } })).status,
      403,
    );
    assertEquals((await ctx.request("POST", "/pair", json({ id: "not a hash" }))).status, 400);
    assertEquals((await ctx.request("GET", "/pair")).status, 405);
    assertEquals((await ctx.request("PUT", "/library/pair", { key: sync, ...json(sealed) })).status, 405);

    assertEquals((await offer()).status, 201);
    const stored: string[] = [];
    const walk = (dir: string) => {
      for (const entry of Deno.readDirSync(dir)) {
        if (entry.isDirectory) walk(`${dir}/${entry.name}`);
        else stored.push(new TextDecoder().decode(Deno.readFileSync(`${dir}/${entry.name}`)));
      }
    };
    walk(ctx.directory);
    for (const secret of [sync, sealed.box, sealed.id, code]) {
      assert(!stored.some((text) => text.includes(secret)), "a sync code was stored");
    }
    // Codes live only in memory, so a restart forgets them.
    await ctx.restart();
    assertEquals((await claim()).status, 404);
  }));

Deno.test("sharing service: wrong sync codes and open codes are limited per network", () =>
  withStore(async (ctx) => {
    const sync = newToken(), code = newPairCode();
    const sealed = await sealPairing(code, sync);
    assertEquals((await ctx.request("POST", "/library/pair", { key: sync, ...json(sealed) })).status, 201);
    const guess = (id: string, ip = "198.51.100.7") => ctx.request("POST", "/pair", json({ id }, ip));
    for (let i = 0; i < 20; i++) assertEquals((await guess(await pairId(`${i}`.padStart(8, "0")))).status, 404);
    const blocked = await guess(sealed.id);
    assertEquals(blocked.status, 429);
    assert(/wait an hour/.test((await blocked.json()).error));
    assertEquals((await guess(sealed.id, "198.51.100.8")).status, 200);
    ctx.advance(3_600_000);
    assertEquals((await guess(sealed.id)).status, 404);

    const open = async (ip: string) =>
      (await ctx.request("POST", "/library/pair", { key: newToken(), ...json(await sealPairing(newPairCode(), sync), ip) })).status;
    for (let i = 0; i < 10; i++) assertEquals(await open("192.0.2.9"), 201);
    assertEquals(await open("192.0.2.9"), 429);
    assertEquals(await open("192.0.2.10"), 201);
    ctx.advance(PAIR_TTL);
    assertEquals(await open("192.0.2.9"), 201);
  }));

Deno.test("sharing service: uploads from the previous one-link format are removed on startup", () =>
  withStore(async (ctx) => {
    assertEquals([...Deno.readDirSync(ctx.directory)].map((e) => e.name).sort(), ["libraries", "salt", "worlds"]);
    assertEquals(await (await ctx.request("GET", "/config")).json(), {
      worldsPerLibrary: 5,
      retentionDays: 30,
      maxBytes: MAX_UPLOAD,
      pollSeconds: 30,
    });
  }, (directory) => Deno.writeFile(`${directory}/${"a".repeat(64)}.bin`, new Uint8Array([0, 0, 0, 2, 123, 125]))));

Deno.test("sharing service: invalid packages, cross-site writes, oversized bodies and request floods are rejected", () =>
  withStore(async (ctx) => {
    const sync = newToken();
    const path = `/library/worlds/${await idOf()}`;
    assertEquals((await ctx.request("PUT", path, { key: sync, body: new Uint8Array([1]) })).status, 400);
    assertEquals((await ctx.request("PUT", path, { key: sync, body: await packet() as BodyInit, type: "text/plain" })).status, 415);
    const cross = { "Sec-Fetch-Site": "cross-site" };
    assertEquals((await ctx.request("PUT", path, { key: sync, body: await packet() as BodyInit, headers: cross })).status, 403);
    assertEquals((await ctx.put(sync)).status, 201);
    assertEquals((await ctx.request("DELETE", path, { key: sync, headers: cross })).status, 403);
    const large = await ctx.request("PUT", path.replace(/[^/]+$/, await idOf("Big")), {
      key: sync,
      body: new Uint8Array(),
      headers: { "Content-Length": String(MAX_UPLOAD + 1) },
    });
    assertEquals(large.status, 413);
    for (let i = 0; i < 54; i++) await ctx.request("GET", "/config");
    assertEquals((await ctx.request("GET", "/config")).status, 429);
    ctx.advance(60_001);
    assertEquals((await ctx.request("GET", "/config")).status, 200);
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
    const sync = newToken();
    const first = ctx.request("PUT", `/library/worlds/${await idOf()}`, { key: sync, body: stream });
    await reading;
    const next = await ctx.put(sync, "Other");
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
    const sync = newToken();
    const response = await ctx.request("PUT", `/library/worlds/${await idOf()}`, { key: sync, body });
    assertEquals(response.status, 413);
    assert(cancelled);
    assertEquals((await ctx.put(sync)).status, 201);
  }));

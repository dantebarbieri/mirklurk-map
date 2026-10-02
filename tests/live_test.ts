import { assert, assertEquals, assertRejects } from "./assert.ts";
import { captureSnapshot, type LiveDirectory, LiveReader, type Scan, scanDirectory, type Snapshot } from "../src/live.ts";
import { decodeJson, parsePlayer } from "../src/save.ts";

const json = (value: unknown) => JSON.stringify(value) + "\0";
const p = (x = 24) => [{ worldGrid: Array.from({ length: 5 }, () => [1, 1, 1, 1, 1]), areaX: 0, areaY: 0, areaType: 1, xx: x }];
function scan(version = 1, extra: Record<string, string> = {}, containersTime = version): Scan {
  const entries = new Map([
    ["Hero/Player.save", { file: new File([json(p(version * 24))], "Player.save", { lastModified: version }), stamp: `p${version}` }],
    ["Hero/[ 0,0 ]/Containers.save", {
      file: new File([json([])], "Containers.save", { lastModified: containersTime }),
      stamp: `c${containersTime}`,
    }],
    ...Object.entries(extra).map((
      [path, text],
    ): [string, { file: File; stamp: string }] => [`Hero/${path}`, {
      file: new File([text], path, { lastModified: version }),
      stamp: text,
    }]),
  ]);
  return { entries, signature: JSON.stringify([...entries].map(([path, e]) => [path, e.stamp])) };
}

Deno.test("live: directory enumeration discovers nested additions, ignores unrelated files and records metadata", async () => {
  const file = new File([json(p())], "Player.save", { lastModified: 42 });
  const directory: LiveDirectory = {
    name: "Saves",
    kind: "directory",
    async *values() {
      yield {
        name: "Hero",
        kind: "directory",
        async *values() {
          yield { name: "Player.save", kind: "file", getFile: () => Promise.resolve(file) };
          yield {
            name: "readme.txt",
            kind: "file",
            getFile: () => {
              throw new Error("Must not read unrelated file");
            },
          };
        },
      };
    },
  };
  const found = await scanDirectory(directory);
  assertEquals([...found.entries.keys()], ["Saves/Hero/Player.save"]);
  assertEquals(found.entries.get("Saves/Hero/Player.save")?.stamp, `42:${file.size}`);
});

Deno.test("live: snapshots reuse unchanged bytes and remove deleted files", async () => {
  const first = await captureSnapshot(scan(1, { "[ 0,0 ]/LOOT-8_8.save": json([]) }));
  const next = await captureSnapshot(scan(1), first);
  assert(first.files.get("Hero/Player.save") === next.files.get("Hero/Player.save"));
  assert(!next.files.has("Hero/[ 0,0 ]/LOOT-8_8.save"));
  assertEquals(next.files.get("Hero/Player.save")?.lastModified, 1);
  const newer = await captureSnapshot(scan(2), first);
  assertEquals(parsePlayer(decodeJson(await first.files.get("Hero/Player.save")!.read())).pos[0], 24);
  assertEquals(parsePlayer(decodeJson(await newer.files.get("Hero/Player.save")!.read())).pos[0], 48);
});

Deno.test("live: reject incomplete save stages, malformed JSON, grids and map images", async () => {
  await assertRejects(() => captureSnapshot(scan(2, {}, 1)), /Containers.save/);
  await assertRejects(() => captureSnapshot(scan(1, { "Player.save": "" })), /empty/);
  await assertRejects(() => captureSnapshot(scan(1, { "[ 0,0 ]/LOOT-8_8.save": "[" })));
  await assertRejects(() => captureSnapshot(scan(1, { "[ 0,0 ]/Lower.tmap": "partial" })), /short/);
  await assertRejects(() => captureSnapshot(scan(1, { "Maps/0_0.png": "partial" })), /PNG/);
  const missing = scan();
  missing.entries.delete("Hero/[ 0,0 ]/Containers.save");
  await assertRejects(() => captureSnapshot(missing), /Containers.save/);
});

Deno.test("live: completion fence matches interior entrances and rift depth folders", async () => {
  const interior = [{ ...p()[0], areaType: 31, entranceX: 24, entranceY: 40 }];
  const inside = scan(1, {
    "Player.save": json(interior),
    "[ 0,0,24,40 ]/Containers.save": json([]),
  });
  assert((await captureSnapshot(inside)).files.has("Hero/[ 0,0,24,40 ]/Containers.save"));
  inside.entries.delete("Hero/[ 0,0,24,40 ]/Containers.save");
  await assertRejects(() => captureSnapshot(inside), /current area's Containers/);
  const rift = scan(1, { "Player.save": json([{ ...p()[0], areaType: 25 }]), "RW2/Containers.save": json([]) });
  assert((await captureSnapshot(rift)).files.has("Hero/RW2/Containers.save"));
  rift.entries.delete("Hero/RW2/Containers.save");
  await assertRejects(() => captureSnapshot(rift), /current area's Containers/);
});

Deno.test("live: malformed update preserves the accepted snapshot and recovers on the next complete save", async () => {
  let time = 0, current = scan();
  const published: Snapshot[] = [], errors: string[] = [];
  const reader = new LiveReader(() => Promise.resolve(current), (s) => {
    published.push(s);
    return Promise.resolve(true);
  }, (message, error) => {
    if (error) errors.push(message);
  }, () => time);
  await reader.poll();
  time = 1500;
  await reader.poll();
  current = scan(2, { "[ 0,0 ]/Containers.save": "[" });
  await reader.poll();
  time = 3000;
  await reader.poll();
  assertEquals(published.length, 1);
  assert(errors[0].includes("Retaining the last snapshot"));
  assertEquals(parsePlayer(decodeJson(await published[0].files.get("Hero/Player.save")!.read())).pos[0], 24);
  current = scan(2);
  await reader.poll();
  time = 4500;
  await reader.poll();
  assertEquals(published.length, 2);
  reader.stop();
});

Deno.test("live: quiet time is measured, changed-during-read snapshot is never published", async () => {
  let time = 0, current = scan();
  const published: Snapshot[] = [], messages: string[] = [];
  let scans = 0;
  const reader = new LiveReader(
    () => {
      scans++;
      if (scans === 4) current = scan(2);
      return Promise.resolve(current);
    },
    (s) => {
      published.push(s);
      return Promise.resolve(true);
    },
    (s) => messages.push(s),
    () => time,
  );
  await reader.poll();
  time = 1499;
  await reader.poll();
  assertEquals(published.length, 0);
  time = 1500;
  await reader.poll(); // Fourth scan occurs after capture, with changed metadata.
  assertEquals(published.length, 0);
  assert(messages.some((s) => s.includes("changed while reading")));
  time = 3000;
  await reader.poll();
  assertEquals(published.length, 1);
  await reader.poll();
  assertEquals(published.length, 1);
  reader.stop();
});

Deno.test("live: failed publication retries, stop cancels an in-flight scan, polls never overlap", async () => {
  let time = 0, attempts = 0;
  const reader = new LiveReader(
    () => Promise.resolve(scan()),
    () => {
      attempts++;
      return Promise.resolve(attempts > 1);
    },
    () => {},
    () => time,
  );
  await reader.poll();
  time = 1600;
  await reader.poll();
  await reader.poll();
  assertEquals(attempts, 2);
  reader.stop();
  const deferred = Promise.withResolvers<Scan>();
  let calls = 0, published = false;
  const stopped = new LiveReader(() => {
    calls++;
    return deferred.promise;
  }, () => {
    published = true;
    return Promise.resolve(true);
  }, () => {});
  const inFlight = stopped.poll();
  await stopped.poll();
  assertEquals(calls, 1);
  stopped.stop();
  deferred.resolve(scan());
  await inFlight;
  assertEquals(published, false);
  await stopped.poll();
  assertEquals(calls, 1);
});

Deno.test("live: permission errors are reported and do not publish empty replacements", async () => {
  const messages: [string, boolean][] = [];
  let publish = 0;
  const reader = new LiveReader(() => Promise.reject(new DOMException("Denied", "NotAllowedError")), () => {
    publish++;
    return Promise.resolve(true);
  }, (message, error) => messages.push([message, error]));
  await reader.poll();
  assertEquals(publish, 0);
  assert(messages[0][0].includes("Folder access lost"));
  assertEquals(messages[0][1], true);
  reader.stop();
});

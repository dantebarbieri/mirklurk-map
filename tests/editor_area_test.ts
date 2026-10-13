import { assert, assertEquals, assertRejects } from "./assert.ts";
import { areaObjects } from "../src/editor/area.ts";
import { CopySource, EditSession } from "../src/editor/session.ts";
import { setSkillPoints } from "../src/editor/edits.ts";
import { decodeJson } from "../src/save.ts";
import { playerRecord } from "../src/save-record.ts";
import type { FileMap } from "../src/files.ts";

const dir = "Hero/[ 0,0 ]/";
const playerPath = "Hero/Player.save";
const source = (raw: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(raw));
  return { read: () => Promise.resolve(bytes) };
};
const station = { index: 171, x: 40, y: 40, sprite: "raft", futureField: { kept: true } };

async function session(beings?: unknown, stations?: unknown) {
  const files: FileMap = new Map([[
    playerPath,
    source([{
      worldGrid: Array.from({ length: 5 }, () => [1, 1, 1, 1, 1]),
      skillPoints: 0,
    }]),
  ]]);
  if (beings !== undefined) files.set(`${dir}Beings.save`, source(beings));
  if (stations !== undefined) files.set(`${dir}Stations.save`, source(stations));
  const copy = new CopySource(files, "fixture");
  const read = await copy.read();
  return new EditSession(copy, read, read.characters[0], "fixture");
}

Deno.test("editor area: missing optional lists and saved empty lists remain distinct", async () => {
  const missing = await areaObjects(await session(), dir);
  assertEquals(missing, { beingsPath: `${dir}Beings.save`, hasBeings: false, beings: [], stations: [] });
  const empty = await areaObjects(await session([], []), dir);
  assertEquals(empty, { ...missing, hasBeings: true });
});

Deno.test("editor area: placement reads unsaved station and creature positions without changing saved bytes", async () => {
  const s = await session([{ index: 3, x: 24, y: 24 }], [station]);
  await s.apply(`${dir}Stations.save`, (raw) => {
    if (!Array.isArray(raw)) throw new Error("Expected station list");
    raw[0].x = 56;
    return "Moved raft";
  });
  await s.apply(`${dir}Beings.save`, (raw) => {
    if (!Array.isArray(raw)) throw new Error("Expected creature list");
    raw[0].y = 72;
    return "Moved creature";
  });
  const objects = await areaObjects(s, dir);
  assertEquals([objects.stations[0].x, objects.beings[0].y], [56, 72]);
  assertEquals(decodeJson(await s.files.get(`${dir}Stations.save`)!.read()), [station]);
  assertEquals(s.changes, ["Moved raft", "Moved creature"]);
});

Deno.test("editor area: malformed records fail explicitly with the file path, not an empty placement map", async () => {
  for (const raw of [null, {}, "not a list", [false], [null], [[]], [{}, -4]]) {
    await assertRejects(
      () => session(raw, []).then((s) => areaObjects(s, dir)),
      /Hero\/\[ 0,0 \]\/Beings\.save: Invalid saved record list/,
    );
    await assertRejects(
      () => session([], raw).then((s) => areaObjects(s, dir)),
      /Hero\/\[ 0,0 \]\/Stations\.save: Invalid saved record list/,
    );
  }
  const s = await session();
  s.files.set(`${dir}Stations.save`, { read: () => Promise.reject(new Error("read refused")) });
  await assertRejects(() => areaObjects(s, dir), /Stations\.save: read refused/);
  s.files.set(`${dir}Stations.save`, { read: () => Promise.resolve(new TextEncoder().encode("{broken")) });
  await assertRejects(() => areaObjects(s, dir), /Stations\.save: /);
});

Deno.test("editor area: a failed read preserves pending edits, and reloading valid data recovers", async () => {
  const s = await session([], {});
  await s.apply(playerPath, (raw) => (setSkillPoints(playerRecord(raw), 3), "Skill points 0 to 3"));
  const draft = await s.json(playerPath);
  await assertRejects(() => areaObjects(s, dir), /Stations\.save: Invalid saved record list/);
  assert((await s.json(playerPath)) === draft);
  assertEquals(playerRecord(draft).skillPoints, 3);
  assertEquals(s.changes, ["Skill points 0 to 3"]);
  assertEquals(playerRecord(decodeJson(await s.files.get(playerPath)!.read())).skillPoints, 0);

  const repaired = new CopySource(new Map(s.files).set(`${dir}Stations.save`, source([station])), "repaired");
  assertEquals(await s.rebase(await repaired.read()), []);
  assertEquals((await areaObjects(s, dir)).stations.map((s) => s.index), [171]);
  assertEquals(playerRecord(await s.json(playerPath)).skillPoints, 3);
  assertEquals(s.changes, ["Skill points 0 to 3"]);
});

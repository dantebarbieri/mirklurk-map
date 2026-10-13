// The save editor's session against real files: a character folder copied to a temporary directory, opened through stand-ins for
// the File System Access API's handles. Checks the write order Live saves rely on, the Cheated mark, backups, stale-save refusal
// and restoring; a world in My worlds (against the upload server's own code) and a copy, downloaded or saved into the game's folder;
// and handing a save between MirkMap and the editor. A real save is edited too when available (copied, never changed in place):
//   MIRKLURK_SAVES="…\Saves" deno task test

import { assert, assertEquals, assertRejects } from "./assert.ts";
import {
  type Backup,
  CopySource,
  type EditDirectory,
  type EditFile,
  EditSession,
  FolderSource,
  type LibraryCall,
  LibrarySource,
  StaleError,
} from "../src/editor/session.ts";
import { addItems } from "../src/editor/items.ts";
import { movePlayer, playerRecord, setSkillPoints, setVitals } from "../src/editor/edits.ts";
import { addRaft, moveWithRaft } from "../src/editor/raft.ts";
import { deleteBeing, newBeing, spawnBeing } from "../src/editor/beings.ts";
import { cheatedInfo } from "../src/cheated.ts";
import { readMarker } from "../src/marker.ts";
import { decodeJson, parsePlayer } from "../src/save.ts";
import { loadWorld } from "../src/world.ts";
import { identify, newToken, packSave, SHARE_INTERVAL, unpackSave, worldId } from "../src/sharing-format.ts";
import { countCoins } from "../src/coins.ts";
import { isOutside } from "../src/rules.ts";
import { type FileMap, fromDirectory } from "../src/files.ts";
import { ShareError } from "../src/library.ts";
import { fileMapOf, storedFiles } from "../src/handoff.ts";
import { readZip } from "../src/zip.ts";
import { UploadStore } from "../server/uploads.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class DiskFile implements EditFile {
  readonly kind = "file";
  constructor(readonly name: string, private path: string) {}
  async getFile(): Promise<File> {
    const bytes = await Deno.readFile(this.path);
    return new File([bytes], this.name, { lastModified: (await Deno.stat(this.path)).mtime!.getTime() });
  }
  createWritable() {
    const chunks: Uint8Array[] = [];
    const path = this.path;
    return Promise.resolve({
      write(data: BufferSource | Blob | string) {
        if (typeof data === "string") chunks.push(encoder.encode(data));
        else if (ArrayBuffer.isView(data)) chunks.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice());
        else throw new Error("Unexpected write");
        return Promise.resolve();
      },
      async close() {
        const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let at = 0;
        for (const c of chunks) out.set(c, at), at += c.length;
        await Deno.writeFile(path, out);
      },
    });
  }
}

/** Like Chrome and Edge on Windows: names Safe Browsing lists as dangerous there, such as .ini, are refused and left out of listings. */
const refused = (name: string) => /\.(ini|cfg|lnk|url|scf)$/i.test(name);

class DiskDirectory implements EditDirectory {
  readonly kind = "directory";
  constructor(readonly name: string, private path: string) {}
  async *values(): AsyncIterable<DiskDirectory | DiskFile> {
    for await (const e of Deno.readDir(this.path)) {
      if (e.isFile && refused(e.name)) continue;
      yield e.isDirectory ? new DiskDirectory(e.name, `${this.path}/${e.name}`) : new DiskFile(e.name, `${this.path}/${e.name}`);
    }
  }
  async getDirectoryHandle(name: string) {
    if (!(await Deno.stat(`${this.path}/${name}`)).isDirectory) throw new Error("Not a directory");
    return new DiskDirectory(name, `${this.path}/${name}`);
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (refused(name)) throw new TypeError("Failed to execute 'getFileHandle' on 'FileSystemDirectoryHandle': Name is not allowed.");
    if (!options?.create) await Deno.stat(`${this.path}/${name}`);
    return new DiskFile(name, `${this.path}/${name}`);
  }
}

/** A store that keeps backups and the cheated record in memory. */
function memoryStore() {
  const backups: Backup[] = [], remembered: string[] = [];
  return {
    backups,
    remembered,
    store: {
      backup: (b: Backup) => Promise.resolve(void backups.push(b)),
      remember: (w: string) => Promise.resolve(void remembered.push(w)),
    },
  };
}

async function openSession(root: string, name: string, store = memoryStore().store) {
  const source = new FolderSource(new DiskDirectory(name, `${root}/${name}`));
  const read = await source.read();
  const character = read.characters[0];
  const player = parsePlayer(decodeJson(await read.files.get(`${character.root}Player.save`)!.read()));
  return new EditSession(source, read, character, await worldId(character.name, player.grid), store);
}

const grid = (t: number) => Array.from({ length: 5 }, () => Array(5).fill(t));
const E = -4;

/** A small character standing in outdoor zone A,1 with a 4×2 pouch, and an explored zone B,1. */
async function fixture(root: string) {
  const base = `${root}/Hero`;
  await Deno.mkdir(`${base}/[ 0,0 ]`, { recursive: true });
  await Deno.mkdir(`${base}/[ 1,0 ]`, { recursive: true });
  const pouch = {
    index: 13,
    amount: 1,
    X: 0,
    Y: 0,
    durability: 30,
    wet: 0,
    rotation: 0,
    sideflipped: false,
    neww: false,
    subParts: [{ type: 0, parentIndex: 13, X: 33, Y: 900, gridSave: [[E, E, E, E], [E, E, E, E]] }],
  };
  const player = [{
    VERSION: "0.8.1.5",
    worldGrid: grid(1),
    worldGridMem: grid(0),
    areaX: 0,
    areaY: 0,
    areaType: 1,
    xx: 40,
    yy: 40,
    entranceX: 0,
    entranceY: 0,
    skillPoints: 0,
    myEquips: [E, pouch, E],
    actives: [true, true, true],
  }];
  const save = (path: string, value: unknown) =>
    Deno.writeFile(`${base}/${path}`, new Uint8Array([...encoder.encode(JSON.stringify(value)), 0]));
  await save("Player.save", player);
  // The game writes Player.save first and the current area's Containers.save last.
  for (const zone of ["[ 0,0 ]", "[ 1,0 ]"]) {
    await save(`${zone}/Beings.save`, []);
    await save(`${zone}/Containers.save`, []);
  }
  // The game's own .ini files, which the browser hides from the editor.
  await Deno.writeTextFile(`${base}/[ 0,0 ]/LastVisit.ini`, "[Visit]\r\nday=1\r\n");
}

const mtime = async (path: string) => (await Deno.stat(path)).mtime!.getTime();

Deno.test("editor session: saves in the game's order, marks the world first, backs up and reopens cleanly", async () => {
  const root = await Deno.makeTempDir({ prefix: "mirklurk-editor-" });
  try {
    await fixture(root);
    // Notes MirkMap already keeps about the world stay, next to the mark.
    await Deno.writeTextFile(`${root}/Hero/MirkMap.json`, '{"fromShare":true}');
    const original = await Deno.readFile(`${root}/Hero/Player.save`);
    const mem = memoryStore();
    const s = await openSession(root, "Hero", mem.store);
    const player = `${s.character.root}Player.save`;
    await s.apply(player, (raw) => (setSkillPoints(playerRecord(raw), 5), "Skill points 0 → 5"));
    await s.apply("Hero/[ 1,0 ]/Beings.save", (raw) => (spawnBeing(raw as unknown[], 3, 20, 30), "Spawned a troll"));
    assertEquals(s.changes.length, 2);
    assertEquals(await s.save(), 2);
    assertEquals(s.changes.length, 0, "drafts dropped after saving");

    const base = `${root}/Hero`;
    const notes = await Deno.readTextFile(`${base}/MirkMap.json`);
    assertEquals(cheatedInfo(notes)?.edits, 1);
    assertEquals(readMarker(notes).fromShare, true);
    assertEquals(await Deno.readTextFile(`${base}/[ 0,0 ]/LastVisit.ini`), "[Visit]\r\nday=1\r\n");
    const written = await Deno.readFile(`${base}/Player.save`);
    assertEquals(written[written.length - 1], 0, "ends in one NUL like save_datajson");
    assertEquals(parsePlayer(decodeJson(written)).skillPoints, 5);
    assertEquals((decodeJson(await Deno.readFile(`${base}/[ 1,0 ]/Beings.save`)) as unknown[]).length, 1);
    assert(await mtime(`${base}/[ 0,0 ]/Containers.save`) >= await mtime(`${base}/Player.save`), "current area written last");
    assertEquals(mem.backups.length, 1);
    assertEquals(mem.backups[0].changes, ["Skill points 0 → 5", "Spawned a troll"]);
    assertEquals([...mem.backups[0].files.find((f) => f.path === player)!.bytes], [...original]);
    assertEquals(mem.remembered, [s.world]);

    // What the map sees afterwards: an accepted snapshot of a world marked Cheated.
    const again = await openSession(root, "Hero");
    assert((await loadWorld(again.files, again.character.root, again.character.name)).cheated);

    // A second save counts another edit and keeps the first time.
    await s.apply(player, (raw) => (setSkillPoints(playerRecord(raw), 6), "Skill points 5 → 6"));
    await s.save();
    const twice = cheatedInfo(await Deno.readTextFile(`${base}/MirkMap.json`))!;
    assertEquals([twice.edits, twice.since], [2, cheatedInfo(notes)!.since]);

    // Restoring writes the old files back; the mark stays.
    await s.restore(mem.backups[0]);
    assertEquals([...await Deno.readFile(`${base}/Player.save`)], [...original]);
    assert(cheatedInfo(await Deno.readTextFile(`${base}/MirkMap.json`)));
    assert(await mtime(`${base}/[ 0,0 ]/Containers.save`) >= await mtime(`${base}/Player.save`));
    await openSession(root, "Hero");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("editor session: refuses to save over a game save made after the folder was read, before marking anything", async () => {
  const root = await Deno.makeTempDir({ prefix: "mirklurk-editor-" });
  try {
    await fixture(root);
    const s = await openSession(root, "Hero");
    const player = `${s.character.root}Player.save`;
    await s.apply(player, (raw) => (setSkillPoints(playerRecord(raw), 9), "Skill points 0 → 9"));
    await new Promise((r) => setTimeout(r, 20));
    const p = `${root}/Hero/Player.save`;
    await Deno.writeFile(p, await Deno.readFile(p));
    await Deno.writeFile(`${root}/Hero/[ 0,0 ]/Containers.save`, await Deno.readFile(`${root}/Hero/[ 0,0 ]/Containers.save`));
    await assertRejects(() => s.save(), /changed .* since this folder was read/);
    try {
      await s.save();
    } catch (e) {
      assert(e instanceof StaleError);
    }
    await assertRejects(() => Deno.stat(`${root}/Hero/MirkMap.json`));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("editor session: a save writes the edits as they were when it started, and blocks discarding until it is done", async () => {
  const root = await Deno.makeTempDir({ prefix: "mirklurk-editor-" });
  try {
    await fixture(root);
    const s = await openSession(root, "Hero");
    const player = `${s.character.root}Player.save`;
    await s.apply(player, (raw) => (setSkillPoints(playerRecord(raw), 5), "Skill points 0 → 5"));
    const p = playerRecord(await s.json(player));
    const saving = s.save();
    assert(s.saving);
    let blocked = false;
    try {
      s.discard();
    } catch (e) {
      blocked = /Wait for the save/.test((e as Error).message);
    }
    assert(blocked, "discard waits for the save");
    setSkillPoints(p, 9);
    await assertRejects(() => s.save(), /Wait for the save/);
    assertEquals(await saving, 1);
    assert(!s.saving);
    assertEquals(parsePlayer(decodeJson(await Deno.readFile(`${root}/Hero/Player.save`))).skillPoints, 5);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("editor session: the preview the full map draws has the unsaved edits, and nothing is written", async () => {
  const root = await Deno.makeTempDir({ prefix: "mirklurk-editor-" });
  try {
    await fixture(root);
    const s = await openSession(root, "Hero");
    const player = `${s.character.root}Player.save`;
    const before = await Deno.readFile(`${root}/Hero/Player.save`);
    assert([...s.preview()].every(([path, src]) => s.files.get(path) === src), "no edits: the files as read");
    await s.apply(player, (raw) => (movePlayer(playerRecord(raw), 1, 0, 50, 60), "Moved"));
    await s.apply("Hero/[ 1,0 ]/Beings.save", (raw) => (spawnBeing(raw as unknown[], 3, 20, 30), "Spawned a troll"));
    await s.json("Hero/[ 0,0 ]/Beings.save");

    const preview = s.preview();
    assertEquals([...preview.keys()], [...s.files.keys()]);
    assert(preview.get("Hero/[ 0,0 ]/Beings.save") === s.files.get("Hero/[ 0,0 ]/Beings.save"), "a draft read but not changed");
    const shown = await loadWorld(preview, s.character.root, s.character.name);
    assertEquals([shown.player.area.x, shown.player.area.y, shown.player.pos[0] >> 4, shown.player.pos[1] >> 4], [1, 0, 50, 60]);
    assertEquals((decodeJson(await preview.get("Hero/[ 1,0 ]/Beings.save")!.read()) as unknown[]).length, 1);
    assertEquals([...await Deno.readFile(`${root}/Hero/Player.save`)], [...before], "nothing written");
    assertEquals(s.changes.length, 2);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("editor session: undoing one change runs the later ones again; changes that no longer apply are dropped", async () => {
  const root = await Deno.makeTempDir({ prefix: "mirklurk-editor-" });
  try {
    await fixture(root);
    const s = await openSession(root, "Hero");
    const player = `${s.character.root}Player.save`;
    const beings = "Hero/[ 1,0 ]/Beings.save";
    const setPoints = (to: number) => (raw: unknown) => {
      const p = playerRecord(raw), from = p.skillPoints;
      setSkillPoints(p, to);
      return `Skill points ${from} → ${to}`;
    };
    await s.apply(player, setPoints(5));
    await s.apply(player, setPoints(7));
    await s.apply(beings, (raw) => (spawnBeing(raw as unknown[], 3, 20, 30), "Spawned a troll"));
    const troll = JSON.stringify((await s.json(beings) as unknown[])[0]);
    await s.apply(beings, (raw) => (deleteBeing(raw as unknown[], 0, troll), "Removed the troll"));

    assertEquals(await s.undo(0), [], "the later change to the same file still applies");
    assertEquals(s.changes, ["Skill points 0 → 7", "Spawned a troll", "Removed the troll"], "its line is written anew");
    assertEquals(playerRecord(await s.json(player)).skillPoints, 7);
    assertEquals(await s.undo(1), ["Removed the troll"], "the troll it removed is gone with the spawn");
    assertEquals(s.changes, ["Skill points 0 → 7"]);
    assertEquals(await s.json(beings), []);

    // An edit that throws, or changes nothing, leaves the draft as the recorded changes made it.
    await assertRejects(() =>
      s.apply(player, (raw) => {
        setSkillPoints(playerRecord(raw), 50);
        throw new Error("half done");
      }), /half done/);
    assertEquals(await s.apply(player, (raw) => void (playerRecord(raw).skillPoints = 60)), undefined);
    assertEquals(playerRecord(await s.json(player)).skillPoints, 7);
    await assertRejects(() => s.undo(5), /already undone/);
    assertEquals(await s.save(), 1, "only Player.save changed in the end");
    assertEquals(parsePlayer(decodeJson(await Deno.readFile(`${root}/Hero/Player.save`))).skillPoints, 7);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("editor session: changes with the same key as the last one replace it, from where it started", async () => {
  const root = await Deno.makeTempDir({ prefix: "mirklurk-editor-" });
  try {
    await fixture(root);
    const s = await openSession(root, "Hero");
    const player = `${s.character.root}Player.save`;
    const setPoints = (to: number) => (raw: unknown) => {
      const p = playerRecord(raw), from = p.skillPoints;
      if (from === to) return undefined;
      setSkillPoints(p, to);
      return `Skill points ${from} → ${to}`;
    };
    assertEquals(await s.apply(player, setPoints(3), "points"), "Skill points 0 → 3");
    assertEquals(await s.apply(player, setPoints(5), "points"), "Skill points 0 → 5");
    assertEquals(s.changes, ["Skill points 0 → 5"]);
    // A throwing edit keeps the change it would have replaced.
    await assertRejects(() =>
      s.apply(player, (raw) => {
        setSkillPoints(playerRecord(raw), 50);
        throw new Error("too many");
      }, "points"), /too many/);
    assertEquals([s.changes, playerRecord(await s.json(player)).skillPoints], [["Skill points 0 → 5"], 5]);
    // Back where it started: no change at all.
    assertEquals(await s.apply(player, setPoints(0), "points"), undefined);
    assertEquals([s.changes, playerRecord(await s.json(player)).skillPoints], [[], 0]);
    // Another key, or none, in between starts a new change.
    await s.apply(player, setPoints(2), "points");
    await s.apply(player, (raw) => (setVitals(playerRecord(raw), { focus: 50 }), "Focus 50%"));
    assertEquals(await s.apply(player, setPoints(4), "points"), "Skill points 2 → 4");
    assertEquals(s.changes, ["Skill points 0 → 2", "Focus 50%", "Skill points 2 → 4"]);
    assertEquals(await s.undo(0), [], "the keyed change still runs again after an undo");
    assertEquals(await s.apply(player, setPoints(6), "points"), "Skill points 0 → 6");
    assertEquals(s.changes, ["Focus 50%", "Skill points 0 → 6"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("editor session: reloading after the game saved runs the unsaved changes again; ones that are now no-ops are dropped", async () => {
  const root = await Deno.makeTempDir({ prefix: "mirklurk-editor-" });
  try {
    await fixture(root);
    const base = `${root}/Hero`;
    const write = (path: string, value: unknown) =>
      Deno.writeFile(`${base}/${path}`, new Uint8Array([...encoder.encode(JSON.stringify(value)), 0]));
    const wolf = newBeing(3, 10, 10);
    await write("[ 0,0 ]/Beings.save", [wolf]);
    await write("[ 0,0 ]/Containers.save", []);
    const s = await openSession(root, "Hero");
    const player = `${s.character.root}Player.save`;
    const here = "Hero/[ 0,0 ]/Beings.save", there = "Hero/[ 1,0 ]/Beings.save";
    await s.apply(player, (raw) => {
      const p = playerRecord(raw), from = p.skillPoints;
      setSkillPoints(p, 5);
      return from === 5 ? undefined : `Skill points ${from} → 5`;
    });
    await s.apply(player, (raw) => {
      const p = playerRecord(raw), from = p.haelth ?? 0;
      setVitals(p, { wellbeing: 1 });
      return from === 1 ? undefined : `Wellbeing ${from} → 1`;
    });
    const same = JSON.stringify((await s.json(here) as unknown[])[0]);
    await s.apply(here, (raw) => (deleteBeing(raw as unknown[], 0, same), "Removed the wolf"));
    await s.apply(there, (raw) => (spawnBeing(raw as unknown[], 3, 20, 30), "Spawned a troll"));
    assertEquals(s.changes, ["Skill points 0 → 5", "Wellbeing 0 → 1", "Removed the wolf", "Spawned a troll"]);

    // The game is played: it heals you to full wellbeing, gives you skill points and the wolf walks, then saves in its own order.
    await new Promise((r) => setTimeout(r, 20));
    const raw = decodeJson(await Deno.readFile(`${base}/Player.save`));
    Object.assign(playerRecord(raw), { skillPoints: 2, haelth: 1, nextHaelth: 1 });
    await write("Player.save", raw);
    await write("[ 0,0 ]/Beings.save", [{ ...wolf, x: 200 }]);
    await write("[ 0,0 ]/Containers.save", []);
    await assertRejects(() => s.save(), /since this folder was read/);

    // A reload that cannot be read leaves the session as it was.
    const read = await s.source.read();
    const broken = new Map(read.files).set(player, { read: () => Promise.resolve(encoder.encode("[")) });
    await assertRejects(() => s.rebase({ ...read, files: broken }));
    assertEquals(s.changes.length, 4);
    assertEquals(playerRecord(await s.json(player)).skillPoints, 5);

    assertEquals(await s.rebase(read), ["Wellbeing 0 → 1", "Removed the wolf"]);
    assertEquals(s.changes, ["Skill points 2 → 5", "Spawned a troll"], "the changes that still apply, their lines written anew");
    assertEquals(await s.save(), 2, "no longer stale");
    const saved = playerRecord(decodeJson(await Deno.readFile(`${base}/Player.save`)));
    assertEquals([saved.skillPoints, saved.haelth], [5, 1]);
    assertEquals(decodeJson(await Deno.readFile(`${base}/[ 0,0 ]/Beings.save`)), [{ ...wolf, x: 200 }], "the game's wolf stays");
    assertEquals((decodeJson(await Deno.readFile(`${base}/[ 1,0 ]/Beings.save`)) as unknown[]).length, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("editor session: a reload drops the changes to a file the game no longer has", async () => {
  const root = await Deno.makeTempDir({ prefix: "mirklurk-editor-" });
  try {
    await fixture(root);
    const s = await openSession(root, "Hero");
    await s.apply("Hero/[ 1,0 ]/Beings.save", (raw) => (spawnBeing(raw as unknown[], 3, 20, 30), "Spawned a troll"));
    await s.apply(`${s.character.root}Player.save`, (raw) => (setSkillPoints(playerRecord(raw), 4), "Skill points 0 → 4"));
    await Deno.remove(`${root}/Hero/[ 1,0 ]`, { recursive: true });
    assertEquals(await s.rebase(await s.source.read()), ["Spawned a troll"]);
    assertEquals(s.changes, ["Skill points 0 → 4"]);
    assertEquals(await s.save(), 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("editor session: moving to another zone makes that zone's Containers.save the last file written", async () => {
  const root = await Deno.makeTempDir({ prefix: "mirklurk-editor-" });
  try {
    await fixture(root);
    const s = await openSession(root, "Hero");
    const player = `${s.character.root}Player.save`;
    await s.apply(player, (raw) => (movePlayer(playerRecord(raw), 1, 0, 50, 60), "Moved"));
    await s.save();
    const base = `${root}/Hero`;
    assert(await mtime(`${base}/[ 1,0 ]/Containers.save`) >= await mtime(`${base}/Player.save`));
    await openSession(root, "Hero");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// --- A real save, copied ---

/** Moving you from A,1 (where the fixture stands you, at 40,40) to B,1 off your raft, leaving it at tile 2,2 of A,1. */
const leaveRaft = (s: EditSession) => [
  {
    path: `${s.character.root}Player.save`,
    edit: (raw: unknown) =>
      moveWithRaft(playerRecord(raw), 1, 0, 50, 60, { from: true, to: false, at: [0, 0, 40, 40] }) ? "Moved you to B,1" : undefined,
  },
  { path: "Hero/[ 0,0 ]/Stations.save", edit: (raw: unknown) => (addRaft(raw, 2, 2), "left your raft in A,1") },
];

/** The fixture with an empty Stations.save in each zone, standing on a raft when `onRaft`. */
async function raftFixture(root: string, onRaft: boolean) {
  await fixture(root);
  const base = `${root}/Hero`;
  const write = (path: string, value: unknown) =>
    Deno.writeFile(`${base}/${path}`, new Uint8Array([...encoder.encode(JSON.stringify(value)), 0]));
  const raw = decodeJson(await Deno.readFile(`${base}/Player.save`));
  playerRecord(raw).ensureRaft = onRaft;
  await write("Player.save", raw);
  for (const zone of ["[ 0,0 ]", "[ 1,0 ]"]) await write(`${zone}/Stations.save`, []);
  await write("[ 0,0 ]/Containers.save", []);
  return write;
}

Deno.test("editor session: a change to several files is one change, made, undone and saved together", async () => {
  const root = await Deno.makeTempDir({ prefix: "mirklurk-editor-" });
  try {
    await raftFixture(root, false);
    const s = await openSession(root, "Hero");
    const player = `${s.character.root}Player.save`, here = "Hero/[ 0,0 ]/Stations.save", there = "Hero/[ 1,0 ]/Stations.save";
    await s.apply(player, (raw) => (playerRecord(raw).ensureRaft = true, "Made a raft under you"));
    assertEquals(await s.applyAll(leaveRaft(s)), "Moved you to B,1; left your raft in A,1");
    assertEquals(s.changes, ["Made a raft under you", "Moved you to B,1; left your raft in A,1"]);
    assertEquals((await s.json(here) as unknown[]).length, 1);

    // If any of its edits changes nothing or throws, nothing is recorded and every draft stays as the changes made it.
    const dock = { path: there, edit: (raw: unknown) => (addRaft(raw, 5, 5), "docked your raft") };
    assertEquals(await s.applyAll([dock, { path: player, edit: () => undefined }]), undefined);
    await assertRejects(() =>
      s.applyAll([dock, {
        path: player,
        edit: () => {
          throw new Error("half done");
        },
      }]), /half done/);
    await assertRejects(() => s.applyAll([dock, { path: "Hero/[ 3,3 ]/Stations.save", edit: () => "x" }]), /missing/);
    assertEquals(await s.json(there), []);
    assertEquals(s.changes.length, 2);

    // Undoing the move takes the raft it left back too.
    assertEquals(await s.undo(1), []);
    assertEquals(s.changes, ["Made a raft under you"]);
    assertEquals(await s.json(here), []);
    assertEquals(playerRecord(await s.json(player)).areaX, 0);

    // Undoing the raft you stood on drops the move off it, raft and all.
    await s.applyAll(leaveRaft(s));
    assertEquals(await s.undo(0), ["Moved you to B,1; left your raft in A,1"]);
    assertEquals([s.changes.length, (await s.json(here) as unknown[]).length], [0, 0]);

    await s.apply(player, (raw) => (playerRecord(raw).ensureRaft = true, "Made a raft under you"));
    await s.applyAll(leaveRaft(s));
    assertEquals(await s.save(), 2, "Player.save and A,1's Stations.save");
    const base = `${root}/Hero`;
    assertEquals(playerRecord(decodeJson(await Deno.readFile(`${base}/Player.save`))).ensureRaft, false);
    assertEquals((decodeJson(await Deno.readFile(`${base}/[ 0,0 ]/Stations.save`)) as { x: number }[]).map((r) => r.x), [40]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("editor session: a reload drops a change to several files whole when one of its edits no longer applies", async () => {
  const root = await Deno.makeTempDir({ prefix: "mirklurk-editor-" });
  try {
    const write = await raftFixture(root, true);
    const s = await openSession(root, "Hero");
    const player = `${s.character.root}Player.save`;
    await s.applyAll(leaveRaft(s));
    await s.apply(player, (raw) => (setSkillPoints(playerRecord(raw), 3), "Skill points 0 → 3"));

    // The game is played: you step off your raft onto the shore, and it saves.
    await new Promise((r) => setTimeout(r, 20));
    const raw = decodeJson(await Deno.readFile(`${root}/Hero/Player.save`));
    Object.assign(playerRecord(raw), { ensureRaft: false, xx: 56 });
    await write("Player.save", raw);
    await write("[ 0,0 ]/Stations.save", [{ index: 171, x: 40, y: 40 }]);
    await write("[ 0,0 ]/Containers.save", []);

    assertEquals(await s.rebase(await s.source.read()), ["Moved you to B,1; left your raft in A,1"]);
    assertEquals(s.changes, ["Skill points 0 → 3"]);
    assertEquals(await s.json("Hero/[ 0,0 ]/Stations.save"), [{ index: 171, x: 40, y: 40 }], "no second raft");
    assertEquals(playerRecord(await s.json(player)).xx, 56);
    assertEquals(await s.save(), 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// --- A real save, copied ---

// --- My worlds, copies, and handing a save over ---

/** Every file under `dir`, .ini files too, as a picked folder or a .zip gives them (the File System Access API hides .ini files). */
async function readTree(dir: string, prefix: string, out: FileMap = new Map()): Promise<FileMap> {
  for await (const e of Deno.readDir(dir)) {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory) await readTree(path, `${prefix}${e.name}/`, out);
    else {
      const bytes = await Deno.readFile(path), lastModified = (await Deno.stat(path)).mtime!.getTime();
      out.set(`${prefix}${e.name}`, { read: () => Promise.resolve(bytes), lastModified });
    }
  }
  return out;
}

/** Library calls answered by the upload server's own code, failing as src/library.ts's api does. */
function libraryCall(store: UploadStore, key: string): LibraryCall {
  return async (path, init = {}) => {
    const response = await store.handle(
      new Request(`http://localhost/api${path}`, {
        ...init,
        headers: { ...init.headers as Record<string, string>, Authorization: `Bearer ${key}` },
      }),
      "192.0.2.1",
    );
    if (!response.ok && response.status !== 304) throw new ShareError(response.status, (await response.json()).error);
    return response;
  };
}

async function unzip(blob: Blob): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const entry of await readZip(blob)) out.set(entry.name, await entry.read());
  return out;
}

const skillPoints = async (files: FileMap, path: string) => parsePlayer(decodeJson(await files.get(path)!.read())).skillPoints;

Deno.test("editor session: a world from My worlds is saved back to the library, refusing a version updated elsewhere", async () => {
  const root = await Deno.makeTempDir({ prefix: "mirklurk-editor-" });
  let now = 1_800_000_000_000;
  const server = new UploadStore(`${root}/server`, () => now);
  try {
    await fixture(root);
    await Deno.mkdir(`${root}/server`);
    await server.init();
    const call = libraryCall(server, newToken());
    const put = async (files: FileMap, root: string) => {
      const hero = { name: "Hero", root };
      return call(`/library/worlds/${await identify(files, hero)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: await packSave(files, hero) as BodyInit,
      });
    };
    // MirkMap adds the world from the folder, .ini files and all.
    const disk = await readTree(`${root}/Hero`, "Hero/");
    const id = (await (await put(disk, "Hero/")).json()).id;

    const source = new LibrarySource(id, call);
    const read = await source.read();
    assertEquals(read.characters, [{ name: "Hero", root: "Shared/" }]);
    const mem = memoryStore();
    const s = new EditSession(source, read, read.characters[0], id, mem.store);
    const player = "Shared/Player.save";
    await s.apply(player, (raw) => (setSkillPoints(playerRecord(raw), 5), "Skill points 0 → 5"));
    now += SHARE_INTERVAL;
    assertEquals(await s.save(), 1);
    assertEquals(s.changes.length, 0);
    const stored = async () => (await unpackSave(new Uint8Array(await (await call(`/library/worlds/${id}/data`)).arrayBuffer()))).files;
    let files = await stored();
    assertEquals(await skillPoints(files, player), 5);
    assertEquals(cheatedInfo(decoder.decode(await files.get("Shared/MirkMap.json")!.read()))?.edits, 1);
    assertEquals(decoder.decode(await files.get("Shared/[ 0,0 ]/LastVisit.ini")!.read()), "[Visit]\r\nday=1\r\n", "untouched files stay");
    assert((await (await call("/library")).json()).worlds[0].cheated, "the library lists it as Cheated");
    assertEquals([mem.backups.length, mem.backups[0].root, mem.remembered], [1, "Shared/", [id]]);

    // Saved twice in a row: the version it saved is the one it checks against next.
    await s.apply(player, (raw) => (setSkillPoints(playerRecord(raw), 6), "Skill points 5 → 6"));
    await assertRejects(() => s.save(), /30 seconds/);
    assertEquals([s.changes.length, mem.backups.length], [1, 1], "a refused upload keeps the change, and no backup");
    now += SHARE_INTERVAL;
    assertEquals(await s.save(), 1);

    // Another device updates the world: saving refuses until the newest version is read again.
    await s.apply(player, (raw) => {
      const p = playerRecord(raw), from = p.skillPoints;
      setSkillPoints(p, 9);
      return `Skill points ${from} → 9`;
    });
    now += SHARE_INTERVAL;
    const other = new Map(await stored());
    const newer = decodeJson(await other.get(player)!.read());
    playerRecord(newer).skillPoints = 2;
    other.set(player, { read: () => Promise.resolve(new Uint8Array([...encoder.encode(JSON.stringify(newer)), 0])), lastModified: now });
    await put(other, "Shared/");
    now += SHARE_INTERVAL;
    const stale = await s.save().then(() => undefined, (e) => e);
    assert(stale instanceof StaleError && /updated in My worlds/.test(stale.message), String(stale));
    assertEquals(await s.rebase(await source.read()), []);
    assertEquals(s.changes, ["Skill points 2 → 9"]);
    assertEquals(await s.save(), 1);
    files = await stored();
    assertEquals(await skillPoints(files, player), 9);
    assertEquals(cheatedInfo(decoder.decode(await files.get("Shared/MirkMap.json")!.read()))?.edits, 3);

    // Restoring writes the backup back to the library and drops the unsaved changes; a refused restore keeps them.
    await s.apply(player, (raw) => (setSkillPoints(playerRecord(raw), 4), "Skill points 9 → 4"));
    await assertRejects(() => s.restore(mem.backups[0]), /30 seconds/);
    assertEquals(s.changes, ["Skill points 9 → 4"]);
    now += SHARE_INTERVAL;
    await s.restore(mem.backups[0]);
    assertEquals(s.changes.length, 0);
    assertEquals(await skillPoints(await stored(), player), 0);

    // Saved, but this browser can't keep its backup: the save stands, with a warning, rather than reading as failed.
    const failing = { backup: () => Promise.reject(new Error("quota exceeded")), remember: () => Promise.resolve() };
    const fresh = await source.read();
    const t = new EditSession(source, fresh, fresh.characters[0], id, failing);
    await t.apply(player, (raw) => (setSkillPoints(playerRecord(raw), 3), "Skill points 0 → 3"));
    now += SHARE_INTERVAL;
    assertEquals(await t.save(), 1);
    assert(/quota exceeded/.test(t.warning ?? ""), String(t.warning));
    assertEquals([t.changes.length, await skillPoints(await stored(), player)], [0, 3]);

    // Another device's update lands between the check and the upload: the upload names the version it read, so it is refused.
    let raced = false;
    const racing: LibraryCall = async (path, init) => {
      const match = new Headers(init?.headers).get("If-Match");
      if (init?.method === "PUT" && match && match !== "*" && !raced) {
        raced = true;
        await put(new Map(await stored()), "Shared/");
        now += SHARE_INTERVAL;
      }
      return call(path, init);
    };
    const racedSource = new LibrarySource(id, racing);
    const before = await racedSource.read();
    const u = new EditSession(racedSource, before, before.characters[0], id, memoryStore().store);
    await u.apply(player, (raw) => (setSkillPoints(playerRecord(raw), 8), "Skill points 3 → 8"));
    now += SHARE_INTERVAL;
    const lost = await u.save().then(() => undefined, (e) => e);
    assert(raced && lost instanceof StaleError && /updated in My worlds/.test(lost.message), String(lost));
    assertEquals([u.changes.length, await skillPoints(await stored(), player)], [1, 3]);
    now += SHARE_INTERVAL;

    // Deleted on another device: nothing can be saved to it.
    await s.apply(player, (raw) => (setSkillPoints(playerRecord(raw), 1), "Skill points 0 → 1"));
    await call(`/library/worlds/${id}`, { method: "DELETE" });
    await assertRejects(() => s.save(), /no longer in My worlds/);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("editor session: a copy downloads with its changes and the mark, then saves into the game's folder at its own path", async () => {
  const root = await Deno.makeTempDir({ prefix: "mirklurk-editor-" });
  try {
    await fixture(`${root}/Saves`);
    // A .zip of the Hero folder: its files sit under Hero/, where the Saves folder has them under Saves/Hero/.
    const copy = await CopySource.of(await readTree(`${root}/Saves/Hero`, "Hero/"), "Hero.zip");
    const read = await copy.read();
    const hero = read.characters[0];
    assertEquals(hero, { name: "Hero", root: "Hero/" });
    const grid = parsePlayer(decodeJson(await read.files.get("Hero/Player.save")!.read())).grid;
    const mem = memoryStore();
    const s = new EditSession(copy, read, hero, await worldId("Hero", grid), mem.store);
    await s.apply("Hero/Player.save", (raw) => (setSkillPoints(playerRecord(raw), 7), "Skill points 0 → 7"));
    await s.apply("Hero/[ 1,0 ]/Beings.save", (raw) => (spawnBeing(raw as unknown[], 3, 20, 30), "Spawned a troll"));
    await assertRejects(() => s.save(), /Choose where to save this copy/);

    const zip = await s.download();
    assertEquals([zip.filename, zip.folder], ["Hero.zip", "Hero"]);
    const back = await unzip(zip.blob);
    assertEquals(parsePlayer(decodeJson(back.get("Hero/Player.save")!)).skillPoints, 7);
    assertEquals((decodeJson(back.get("Hero/[ 1,0 ]/Beings.save")!) as unknown[]).length, 1);
    assertEquals(cheatedInfo(decoder.decode(back.get("Hero/MirkMap.json")!))?.edits, 1);
    assertEquals(decoder.decode(back.get("Hero/[ 0,0 ]/LastVisit.ini")!), "[Visit]\r\nday=1\r\n");
    const unzipped: FileMap = new Map([...back].map(([path, bytes]) => [path, { read: () => Promise.resolve(bytes) }]));
    assert((await loadWorld(unzipped, "Hero/", "Hero")).cheated, "the map reads the download as Cheated");
    assertEquals([s.changes.length, mem.backups.length, mem.remembered], [2, 0, [s.world]], "the changes stay unsaved");

    // Saved into the Saves folder: the changes edit the same files there, under its own path.
    const folder = new FolderSource(new DiskDirectory("Saves", `${root}/Saves`));
    const there = await folder.read();
    const target = there.characters.find((c) => c.name === "Hero")!;
    assertEquals(target.root, "Saves/Hero/");
    assertEquals(await s.rebase(there, { source: folder, character: target }), []);
    assert(s.source === folder && s.character === target, "the session moved to the folder");
    assertEquals(s.changes, ["Skill points 0 → 7", "Spawned a troll"]);
    assertEquals(await s.save(), 2);
    const base = `${root}/Saves/Hero`;
    assertEquals(parsePlayer(decodeJson(await Deno.readFile(`${base}/Player.save`))).skillPoints, 7);
    assertEquals((decodeJson(await Deno.readFile(`${base}/[ 1,0 ]/Beings.save`)) as unknown[]).length, 1);
    assert(cheatedInfo(await Deno.readTextFile(`${base}/MirkMap.json`)));
    assertEquals(mem.backups[0].root, "Saves/Hero/");

    // That backup, restored where the Hero folder itself was opened, finds its files under Hero/.
    const direct = await openSession(`${root}/Saves`, "Hero", mem.store);
    assertEquals(direct.character.root, "Hero/");
    await direct.restore(mem.backups[0]);
    assertEquals(parsePlayer(decodeJson(await Deno.readFile(`${base}/Player.save`))).skillPoints, 0);
    assertEquals(await Deno.readFile(`${base}/[ 1,0 ]/Beings.save`).then((b) => decodeJson(b)), []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("editor session: a copy saved into a folder holding a newer save runs its changes on that save", async () => {
  const root = await Deno.makeTempDir({ prefix: "mirklurk-editor-" });
  try {
    await fixture(root);
    const copy = new CopySource(await readTree(`${root}/Hero`, "Hero/"), "Hero.zip");
    const read = await copy.read();
    const grid = parsePlayer(decodeJson(await read.files.get("Hero/Player.save")!.read())).grid;
    const s = new EditSession(copy, read, read.characters[0], await worldId("Hero", grid), memoryStore().store);
    await s.apply("Hero/Player.save", (raw) => {
      const p = playerRecord(raw), from = p.skillPoints;
      setSkillPoints(p, 4);
      return from === 4 ? undefined : `Skill points ${from} → 4`;
    });
    await s.apply("Hero/[ 1,0 ]/Beings.save", (raw) => (spawnBeing(raw as unknown[], 3, 20, 30), "Spawned a troll"));
    // Played since the copy was made: the game gave 4 skill points and dropped zone B,1's creatures file.
    const raw = decodeJson(await Deno.readFile(`${root}/Hero/Player.save`));
    playerRecord(raw).skillPoints = 4;
    await Deno.writeFile(`${root}/Hero/Player.save`, new Uint8Array([...encoder.encode(JSON.stringify(raw)), 0]));
    await Deno.remove(`${root}/Hero/[ 1,0 ]/Beings.save`);
    await Deno.writeFile(`${root}/Hero/[ 0,0 ]/Containers.save`, await Deno.readFile(`${root}/Hero/[ 0,0 ]/Containers.save`));
    const folder = new FolderSource(new DiskDirectory("Hero", `${root}/Hero`));
    const there = await folder.read();
    assertEquals(await s.rebase(there, { source: folder, character: there.characters[0] }), ["Skill points 0 → 4", "Spawned a troll"]);
    assertEquals(s.changes, []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("handing a save over: a copy of files reads back the same, and a folder handle lists every file under its name", async () => {
  const root = await Deno.makeTempDir({ prefix: "mirklurk-editor-" });
  try {
    await fixture(root);
    const files = await readTree(`${root}/Hero`, "Hero/");
    const back = fileMapOf(await storedFiles(new Map([...files, ["Other/Player.save", files.get("Hero/Player.save")!]]), "Hero/"));
    assertEquals([...back.keys()], [...files.keys()], "only the character handed over");
    for (const [path, source] of files) {
      assertEquals([...await back.get(path)!.read()], [...await source.read()], path);
      assertEquals(back.get(path)!.lastModified, source.lastModified);
    }
    const listed = await fromDirectory(new DiskDirectory("Hero", `${root}/Hero`));
    // The browser hides .ini files from folder handles (see DiskDirectory), as it does for Live saves.
    assertEquals([...listed.keys()].sort(), [...files.keys()].filter((p) => !p.endsWith(".ini")).sort());
    assertEquals([...await listed.get("Hero/Player.save")!.read()], [...await files.get("Hero/Player.save")!.read()]);

    // A world from My worlds sits under Shared/: handed over as a copy, it keeps its character's name, so it downloads as Hero.
    const shared: FileMap = new Map([...files].map(([path, source]) => [`Shared/${path.slice("Hero/".length)}`, source]));
    const hero = { name: "Hero", root: "Shared/" };
    const copy = new CopySource(fileMapOf(await storedFiles(shared, hero.root)), "what MirkMap had open", hero);
    const read = await copy.read();
    assertEquals(read.characters, [hero]);
    const grid = parsePlayer(decodeJson(await read.files.get("Shared/Player.save")!.read())).grid;
    const s = new EditSession(copy, read, hero, await worldId("Hero", grid), memoryStore().store);
    assertEquals(s.world, await identify(files, { name: "Hero", root: "Hero/" }), "the same world as the folder's");
    assertEquals((await s.download()).filename, "Hero.zip");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

const saves = Deno.env.get("MIRKLURK_SAVES") ??
  decodeURIComponent(new URL("../../Saves", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const real = ["Tiberius", "Lorroakan", "Lilly"].find((n) => {
  try {
    return Deno.statSync(`${saves}/${n}/Player.save`).isFile;
  } catch {
    return false;
  }
});

async function copyTree(from: string, to: string) {
  await Deno.mkdir(to, { recursive: true });
  for await (const e of Deno.readDir(from)) {
    if (e.isDirectory) await copyTree(`${from}/${e.name}`, `${to}/${e.name}`);
    else {
      await Deno.copyFile(`${from}/${e.name}`, `${to}/${e.name}`);
      const st = await Deno.stat(`${from}/${e.name}`);
      await Deno.utime(`${to}/${e.name}`, st.atime!, st.mtime!);
    }
  }
}

Deno.test({ name: "editor session: a copy of a real save takes edits and still loads in the map", ignore: !real }, async () => {
  const root = await Deno.makeTempDir({ prefix: "mirklurk-editor-" });
  try {
    await copyTree(`${saves}/${real}`, `${root}/${real}`);
    const s = await openSession(root, real!);
    const player = `${s.character.root}Player.save`;
    const before = parsePlayer(await s.json(player));
    const coins = countCoins(before.inventory).copper;
    let added = 0;
    await s.apply(player, (raw) => (added = addItems(playerRecord(raw), 72, 10).added, "Coins"));
    const world = await loadWorld(s.files, s.character.root, s.character.name);
    const other = world.zones.flat().find((z) => z.dir && isOutside(z.type) && s.files.has(`${z.dir}Containers.save`));
    assert(other, "an explored zone");
    await s.apply(player, (raw) => (movePlayer(playerRecord(raw), other.x, other.y, 80, 80), "Moved"));
    await s.save();
    const again = await openSession(root, real!);
    const after = parsePlayer(decodeJson(await again.files.get(`${again.character.root}Player.save`)!.read()));
    assertEquals(countCoins(after.inventory).copper, coins + added);
    assertEquals([after.area.x, after.area.y, after.pos[0], after.pos[1]], [other.x, other.y, 1288, 1288]);
    const reloaded = await loadWorld(again.files, again.character.root, again.character.name);
    assert(reloaded.cheated && !reloaded.warnings.length, reloaded.warnings.join("; "));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

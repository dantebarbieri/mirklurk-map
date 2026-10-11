// The save editor's session against real files: a character folder copied to a temporary directory, opened through stand-ins for
// the File System Access API's handles. Checks the write order Live saves rely on, the Cheated mark, backups, stale-save refusal
// and restoring. A real save is edited too when available (copied, never changed in place):
//   MIRKLURK_SAVES="…\Saves" deno task test

import { assert, assertEquals, assertRejects } from "./assert.ts";
import { type Backup, type EditDirectory, type EditFile, EditSession, StaleError } from "../src/editor/session.ts";
import { addItems } from "../src/editor/items.ts";
import { movePlayer, playerRecord, setSkillPoints } from "../src/editor/edits.ts";
import { spawnBeing } from "../src/editor/beings.ts";
import { findCharacters } from "../src/files.ts";
import { cheatedInfo } from "../src/cheated.ts";
import { decodeJson, parsePlayer } from "../src/save.ts";
import { loadWorld } from "../src/world.ts";
import { worldId } from "../src/sharing-format.ts";
import { countCoins } from "../src/coins.ts";
import { isOutside } from "../src/rules.ts";

const encoder = new TextEncoder();

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

class DiskDirectory implements EditDirectory {
  readonly kind = "directory";
  constructor(readonly name: string, private path: string) {}
  async *values(): AsyncIterable<DiskDirectory | DiskFile> {
    for await (const e of Deno.readDir(this.path)) {
      yield e.isDirectory ? new DiskDirectory(e.name, `${this.path}/${e.name}`) : new DiskFile(e.name, `${this.path}/${e.name}`);
    }
  }
  async getDirectoryHandle(name: string) {
    if (!(await Deno.stat(`${this.path}/${name}`)).isDirectory) throw new Error("Not a directory");
    return new DiskDirectory(name, `${this.path}/${name}`);
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
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
  const dir = new DiskDirectory(name, `${root}/${name}`);
  const { scan, files } = await EditSession.open(dir);
  const character = findCharacters(files)[0];
  const player = parsePlayer(decodeJson(await files.get(`${character.root}Player.save`)!.read()));
  return new EditSession(dir, scan, files, character, await worldId(character.name, player.grid), store);
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
}

const mtime = async (path: string) => (await Deno.stat(path)).mtime!.getTime();

Deno.test("editor session: saves in the game's order, marks the world first, backs up and reopens cleanly", async () => {
  const root = await Deno.makeTempDir({ prefix: "mirklurk-editor-" });
  try {
    await fixture(root);
    const original = await Deno.readFile(`${root}/Hero/Player.save`);
    const mem = memoryStore();
    const s = await openSession(root, "Hero", mem.store);
    const player = `${s.character.root}Player.save`;
    setSkillPoints(playerRecord(await s.json(player)), 5);
    s.changed(player, "Skill points 0 → 5");
    spawnBeing(await s.json("Hero/[ 1,0 ]/Beings.save") as unknown[], 3, 20, 30);
    s.changed("Hero/[ 1,0 ]/Beings.save", "Spawned a troll");
    assertEquals(s.changes.length, 2);
    assertEquals(await s.save(), 2);
    assertEquals(s.changes.length, 0, "drafts dropped after saving");

    const base = `${root}/Hero`;
    const ini = await Deno.readTextFile(`${base}/MirkMap.ini`);
    assertEquals(cheatedInfo(ini)?.edits, 1);
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
    setSkillPoints(playerRecord(await s.json(player)), 6);
    s.changed(player, "Skill points 5 → 6");
    await s.save();
    const twice = cheatedInfo(await Deno.readTextFile(`${base}/MirkMap.ini`))!;
    assertEquals([twice.edits, twice.since], [2, cheatedInfo(ini)!.since]);

    // Restoring writes the old files back; the mark stays.
    await s.restore(mem.backups[0]);
    assertEquals([...await Deno.readFile(`${base}/Player.save`)], [...original]);
    assert(cheatedInfo(await Deno.readTextFile(`${base}/MirkMap.ini`)));
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
    setSkillPoints(playerRecord(await s.json(player)), 9);
    s.changed(player, "Skill points 0 → 9");
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
    await assertRejects(() => Deno.stat(`${root}/Hero/MirkMap.ini`));
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
    const p = playerRecord(await s.json(player));
    setSkillPoints(p, 5);
    s.changed(player, "Skill points 0 → 5");
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

Deno.test("editor session: moving to another zone makes that zone's Containers.save the last file written", async () => {
  const root = await Deno.makeTempDir({ prefix: "mirklurk-editor-" });
  try {
    await fixture(root);
    const s = await openSession(root, "Hero");
    const player = `${s.character.root}Player.save`;
    movePlayer(playerRecord(await s.json(player)), 1, 0, 50, 60);
    s.changed(player, "Moved");
    await s.save();
    const base = `${root}/Hero`;
    assert(await mtime(`${base}/[ 1,0 ]/Containers.save`) >= await mtime(`${base}/Player.save`));
    await openSession(root, "Hero");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// --- A real save, copied ---

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
    const p = playerRecord(await s.json(player));
    const before = parsePlayer(await s.json(player));
    const coins = countCoins(before.inventory).copper;
    const added = addItems(p, 72, 10).added;
    s.changed(player, "Coins");
    const world = await loadWorld(s.files, s.character.root, s.character.name);
    const other = world.zones.flat().find((z) => z.dir && isOutside(z.type) && s.files.has(`${z.dir}Containers.save`));
    assert(other, "an explored zone");
    movePlayer(p, other.x, other.y, 80, 80);
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

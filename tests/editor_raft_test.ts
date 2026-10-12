// The save editor's water and raft rules: how deep you stand, where a raft floats, where a raft you leave docks, moving you on or off
// a raft or inside, and where each kind of creature can live. Real saves check them against rafts, creatures and interiors the game
// made itself when available (skipped otherwise):
//   MIRKLURK_SAVES="…\Saves" deno task test

import { assert, assertEquals } from "./assert.ts";
import {
  addRaft,
  dockTile,
  moveWithRaft,
  onRaft,
  RAFT,
  raftable,
  raftMap,
  raftStation,
  SWIM_HEIGHT,
  takeRaft,
  tileHeight,
  WATER_LAYERS,
  waterKind,
  type WaterLayers,
  waterText,
  wetMap,
} from "../src/editor/raft.ts";
import { insideOf, isInside, movePlayer, playerRecord, type Rec } from "../src/editor/edits.ts";
import { habitat, habitatRefusal } from "../src/editor/beings.ts";
import { reachable } from "../src/editor/ground.ts";
import { tileIndex, TILES } from "../src/rules.ts";
import { findCharacters } from "../src/files.ts";
import { currentContainers } from "../src/live.ts";
import { decodeJson, parsePlayer } from "../src/save.ts";
import { loadDetail, loadHeights, loadLayer, loadWorld } from "../src/world.ts";

function assertThrows(fn: () => unknown, match: RegExp) {
  try {
    fn();
  } catch (e) {
    if (!match.test((e as Error).message)) throw new Error(`wrong error: ${(e as Error).message}`);
    return;
  }
  throw new Error(`expected an error matching ${match}`);
}
const sorted = (r: Rec) => Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));
const N = TILES * TILES;
const layers = () => ({ layers: Object.fromEntries(WATER_LAYERS.map((l) => [l, new Uint32Array(N)])), heights: new Float32Array(N) });

Deno.test("water depth: each water layer deepens it, the deep layer more over holes; slopes, hinderances, reeds and goo raise you", () => {
  const w: WaterLayers = layers();
  const set = (layer: (typeof WATER_LAYERS)[number], i: number, v: number) => (w.layers[layer]![i] = v);
  const deep = (i: number, y: number) => (set("Water1", i, 3), set("Water2", i, 3), set("Water3", i, 3), w.heights![i] = y);
  set("Water1", 0, 7);
  set("Water1", 1, 7), set("Water2", 1, 9);
  deep(2, -0.4);
  deep(3, -0.6);
  deep(4, -1);
  deep(5, -0.51);
  [6, 7, 8, 9, 10, 11].forEach((i) => deep(i, -1));
  set("Hinderance", 6, 10);
  set("Hinderance", 7, 30);
  set("Grass", 8, 25);
  set("Hinderance", 9, 125);
  set("OnLower", 10, 5);
  set("Slopes1", 11, 7);
  // Slopes1 tile 53 alone is not a slope.
  set("Water1", 12, 1), set("Slopes1", 12, 53);
  // Flip bits in the tile data do not change the tile.
  set("Water1", 13, 0x10000000 | 4);
  assertEquals(
    Array.from({ length: 15 }, (_, i) => tileHeight(w, i)),
    [1, 4, 8, 23, 28, 14, -6, -4, -3, -2, 2, -3, 1, 1, 0],
  );
  assertEquals([waterKind(SWIM_HEIGHT), waterKind(13), waterKind(8), waterKind(7), waterKind(-2)], [
    "deep water",
    "chest-deep water",
    "chest-deep water",
    "shallow water",
    "shallow water",
  ]);
  assert(/swim/.test(waterText(tileHeight(w, 5))) && !/swim/.test(waterText(tileHeight(w, 2))));
  // Without Ygrid.save the deep layer adds only its own 4.
  assertEquals(tileHeight({ layers: w.layers }, 4), 8);
});

Deno.test("rafts float where the ground lies at or below the water threshold, without reeds or low hinderances", () => {
  const w: WaterLayers = layers();
  w.heights!.set([-0.3, -0.29, -0.8, -0.8, -0.8, -0.8]);
  w.layers.Grass![2] = 24;
  w.layers.Hinderance![3] = 60;
  w.layers.Hinderance![4] = 70;
  assertEquals([0, 1, 2, 3, 4, 5].map((i) => raftable(w, i)), [true, false, false, false, true, true]);
  assertEquals([...raftMap(w).subarray(0, 6)], [1, 0, 0, 0, 1, 1]);
  assert(!raftable({ layers: w.layers }, 0), "without heights nothing is known to float");
});

/**
 * A lake (raft water everywhere) with the dry island 50–59 × 50–59, and another island 30–34 × 52–56 between it and the west.
 * `shallows` are wet tiles a raft cannot go.
 */
function lake(shallows: [number, number][] = []) {
  const raft = new Uint8Array(N).fill(1), wet = new Uint8Array(N).fill(1);
  const dry = (x0: number, x1: number, y0: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) raft[y * TILES + x] = wet[y * TILES + x] = 0;
  };
  dry(50, 59, 50, 59);
  dry(30, 34, 52, 56);
  for (const [x, y] of shallows) raft[y * TILES + x] = 0;
  return { raft, wet, dry };
}
const tile = (x: number, y: number) => y * TILES + x;
const open = () => new Uint8Array(N).fill(1);

Deno.test("a raft you leave for land drifts towards you, past other islands, and docks at that land's first shore", () => {
  const { raft, wet } = lake();
  const dock = (to: number, from: [number, number], free = open()) => dockTile(raft, wet, free, to, from);
  assertEquals(dock(tile(55, 55), [10, 55]), tile(49, 55), "the island in between is passed over");
  assertEquals(dock(tile(55, 55), [-20, 55]), tile(49, 55), "from the zone to the west");
  assertEquals(dock(tile(55, 55), [55, 140]), tile(55, 60), "from the south");
  assertEquals(dock(tile(32, 54), [10, 55]), tile(29, 54), "landing on the nearer island");
  const taken = open();
  taken[tile(49, 55)] = 0;
  assertEquals(dock(tile(55, 55), [10, 55], taken), tile(49, 54), "taken: the next nearest, beside the land");
  // Stepping off onto the shore right beside it, it stays where it is.
  assertEquals(dock(tile(50, 52), [49, 52]), tile(49, 52));
  assertEquals(dockTile(new Uint8Array(N), wet, open(), tile(55, 55), [10, 55]), undefined, "no raft water at all");
});

Deno.test("shallows do not join islands: the raft passes a small island in front, and docks beyond the shallows of yours", () => {
  // A small island just off yours, joined to it only by shallow water: the raft's way crosses it first.
  const shallowJoin = lake(Array.from({ length: 4 }, (_, k) => [46 + k, 55] as [number, number]));
  shallowJoin.dry(44, 45, 54, 56);
  assertEquals(dockTile(shallowJoin.raft, shallowJoin.wet, open(), tile(55, 55), [10, 55]), tile(49, 54), "beside your island");
  // Your island ringed by two tiles of shallows: the raft stops at the first raft water outside them.
  const ring: [number, number][] = [];
  for (let y = 48; y <= 61; y++) for (let x = 48; x <= 61; x++) if (x < 50 || x > 59 || y < 50 || y > 59) ring.push([x, y]);
  const ringed = lake(ring);
  assertEquals(dockTile(ringed.raft, ringed.wet, open(), tile(55, 55), [10, 55]), tile(47, 55));
  // Wading out into those shallows, it comes as close to you as raft water goes.
  assertEquals(dockTile(ringed.raft, ringed.wet, open(), tile(48, 55), [10, 55]), tile(47, 55));
  assertEquals(dockTile(ringed.raft, ringed.wet, open(), tile(48, 49), [10, 30]), tile(47, 49), "in the shallows' corner");
  // Never across your island: from the east, it docks on the east side.
  assertEquals(dockTile(ringed.raft, ringed.wet, open(), tile(51, 55), [150, 55]), tile(62, 55));
});

Deno.test("moving on a raft keeps it under you; moving off or onto one needs you to still be where it was chosen", () => {
  const p: Rec = { areaX: 2, areaY: 0, areaType: 1, xx: 344, yy: 744, ensureRaft: true, worldGrid: [[0, 1, 1, 3, 4]] };
  assert(onRaft(p));
  assert(moveWithRaft(p, 3, 0, 10, 12, { from: true, to: true }));
  assertEquals([p.areaX, p.areaType, p.xx, p.yy, p.ensureRaft], [3, 3, 168, 200, true]);
  assert(!moveWithRaft(p, 3, 0, 10, 12, { from: true, to: true }), "nothing changed");
  assertThrows(() => moveWithRaft(p, 1, 0, 5, 5, { from: false, to: false }), /on a raft now/);
  assertThrows(() => moveWithRaft(p, 1, 0, 5, 5, { from: true, to: false, at: [2, 0, 344, 744] }), /moved since/);
  assert(moveWithRaft(p, 1, 0, 5, 5, { from: true, to: false, at: [3, 0, 168, 200] }));
  assertEquals([p.areaX, p.xx, p.ensureRaft], [1, 88, false]);
  assertThrows(() => moveWithRaft(p, 2, 0, 5, 5, { from: true, to: true }), /no longer on a raft/);
  const old: Rec = { areaX: 1, areaY: 0, areaType: 1, xx: 40, yy: 40, worldGrid: [[0, 1, 1, 3, 4]] };
  moveWithRaft(old, 2, 0, 1, 1, { from: false, to: false });
  assert(!("ensureRaft" in old), "a save without ensureRaft does not get one for nothing");
  moveWithRaft(old, 2, 0, 2, 2, { from: false, to: true });
  assertEquals(old.ensureRaft, true);
});

Deno.test("no raft goes inside: you leave it to go in; moving between interiors counts even on the same spot", () => {
  const p: Rec = {
    areaX: 2,
    areaY: 0,
    areaType: 1,
    xx: 344,
    yy: 744,
    entranceX: 8,
    entranceY: 8,
    ensureRaft: true,
    worldGrid: [[0, 1, 1]],
  };
  const cave = { type: 10, entrance: [1368, 1384] as [number, number] };
  assertThrows(() => moveWithRaft(p, 2, 0, 80, 80, { from: true, to: true }, cave), /cannot go inside/);
  assertEquals([p.areaType, p.ensureRaft], [1, true], "nothing changed");
  assert(moveWithRaft(p, 2, 0, 80, 80, { from: true, to: false, at: [2, 0, 344, 744] }, cave));
  assertEquals([p.areaType, p.entranceX, p.entranceY, p.xx, p.yy, p.ensureRaft], [10, 1368, 1384, 1288, 1288, false]);
  assert(!moveWithRaft(p, 2, 0, 80, 80, { from: false, to: false }, cave), "nothing changed");
  assert(moveWithRaft(p, 2, 0, 80, 80, { from: false, to: false }, { type: 11, entrance: [840, 1880] }), "another cave, same spot");
  assertEquals([p.areaType, p.entranceX, p.entranceY], [11, 840, 1880]);
});

Deno.test("rafts are left and taken in Stations.save as the game saves a finished raft", () => {
  const stations: unknown[] = [{ index: 38, x: 8, y: 8 }];
  addRaft(stations, 21, 46);
  assertEquals(sorted(stations[1] as Rec), {
    activeTurns: 0,
    blend: 16777215,
    index: RAFT,
    localItem: -4,
    pic: 1,
    sprite: "spr_placed_16x16_wider",
    status: -200,
    x: 344,
    y: 744,
  });
  addRaft(stations, 3, 3);
  const second = JSON.stringify(stations[2]);
  assertEquals((takeRaft(stations, second) as Rec).x, 56);
  assertThrows(() => takeRaft(stations, second), /no longer there/);
  assertThrows(() => takeRaft(stations, JSON.stringify(stations[0])), /no longer there/);
  assertThrows(() => addRaft({}, 1, 1), /not a list/);
  assertEquals(stations.length, 2);
});

Deno.test("creatures live where the game lets them: swimmers in water, walkers out of deep water and brambles, flyers anywhere", () => {
  const w: WaterLayers = layers();
  const set = (layer: (typeof WATER_LAYERS)[number], i: number, v: number) => (w.layers[layer]![i] = v);
  // 0 dry land; 1 shallows; 2 a little deeper; 3 deeper, with the second water layer; 4 deep; 5 brambles; 6 reeds in deep water.
  w.heights!.set([0.1, -0.22, -0.27, -0.35, -0.5, 0.1, -0.5]);
  for (const i of [1, 2, 3, 4, 6]) set("Water1", i, 1);
  for (const i of [3, 4]) set("Water2", i, 1);
  set("Water3", 4, 1);
  set("NatureData", 5, 1);
  set("Hinderance", 6, 10);
  const [SLUG, DREADFLY, TROLL, SERPENT, RUNNER, MUDFIN, RAZORFIN] = [0, 1, 3, 4, 11, 17, 24];
  const can = (index: number) => [0, 1, 2, 3, 4, 5, 6].map((i) => habitatRefusal(index, w, i, true) === undefined ? 1 : 0);
  assertEquals(can(MUDFIN), [0, 0, 1, 1, 1, 0, 1], "a Mudfin needs the ground below -0.25");
  assertEquals(can(RAZORFIN), can(MUDFIN));
  assertEquals(can(SERPENT), [0, 0, 0, 1, 1, 0, 1], "a Mire Serpent needs it at or below -0.3");
  assertEquals(can(RUNNER), [1, 1, 1, 0, 0, 0, 1], "a small walker wades only above -0.3; reeds lift it out of the water");
  assertEquals(can(TROLL), [1, 1, 1, 1, 0, 0, 1], "a big one above -0.4");
  assertEquals(can(SLUG), [1, 1, 1, 0, 0, 0, 1], "a Giant Slug keeps out of the second water layer");
  assertEquals(can(DREADFLY), [1, 1, 1, 1, 1, 1, 1], "flyers go anywhere");
  assertEquals([habitat(MUDFIN), habitat(DREADFLY), habitat(RUNNER)], ["swims", "flies", "walks"]);
  assert(/brambles/.test(habitatRefusal(RUNNER, w, 5, true)!) && /needs water/.test(habitatRefusal(MUDFIN, w, 0, true)!));
  // Inside, raised floors (Dungeon 1–9) lift a walker out of the water; outdoors that layer means nothing.
  set("Dungeon", 4, 5);
  assertEquals([tileHeight(w, 4, false), habitatRefusal(TROLL, w, 4, false), tileHeight(w, 4, true)], [-6, undefined, 13]);
});

// --- Real saves ---

const dir = Deno.env.get("MIRKLURK_SAVES") ??
  decodeURIComponent(new URL("../../Saves", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const present = (() => {
  try {
    return Deno.statSync(dir).isDirectory;
  } catch {
    return false;
  }
})();

Deno.test({ name: "real saves: the game's own rafts float, are written like ours, and dock at a shore", ignore: !present }, async () => {
  const files = new Map<string, { read: () => Promise<Uint8Array> }>();
  const walk = (root: string, prefix: string) => {
    for (const e of Deno.readDirSync(root)) {
      if (e.isDirectory) walk(`${root}/${e.name}`, `${prefix}${e.name}/`);
      else files.set(`${prefix}${e.name}`, { read: () => Deno.readFile(`${root}/${e.name}`) });
    }
  };
  walk(dir, "Saves/");
  let rafts = 0;
  for (const c of findCharacters(files)) {
    const world = await loadWorld(files, c.root, c.name);
    for (const z of world.zones.flat()) {
      if (!z.dir) continue;
      const stations = (await loadDetail(world, z.dir)).stations.filter((s) => s.index === RAFT);
      if (!stations.length) continue;
      const w: WaterLayers = { layers: {}, heights: (await loadHeights(world, z.dir))?.data };
      for (const l of WATER_LAYERS) w.layers[l] = (await loadLayer(world, z.dir, l))?.data;
      const raft = raftMap(w), wet = wetMap(w);
      for (const s of stations) {
        rafts++;
        const [tx, ty] = [s.x >> 4, s.y >> 4];
        assert(raft[ty * TILES + tx], `${c.name} ${z.dir}: the raft at tile ${tx},${ty} floats`);
        assertEquals([s.sprite, s.pic, s.x, s.y], [raftStation(tx, ty).sprite, 1, tx * 16 + 8, ty * 16 + 8]);
        // Landing on the nearest dry tile, the raft docks right beside that land.
        let land = -1, best = Infinity;
        for (let i = 0; i < N; i++) {
          const d = (i % TILES - tx) ** 2 + (Math.floor(i / TILES) - ty) ** 2;
          if (!wet[i] && d < best) land = i, best = d;
        }
        if (land < 0) continue;
        const dock = dockTile(raft, wet, new Uint8Array(N).fill(1), land, [tx, ty]);
        assert(dock !== undefined && raft[dock], `${c.name} ${z.dir}: docks on raft water`);
      }
    }
  }
  console.log(`  ${rafts} rafts checked`);
});

Deno.test({ name: "real saves: the game's own creatures stand where they can live", ignore: !present }, async () => {
  const files = new Map<string, { read: () => Promise<Uint8Array> }>();
  const walk = (root: string, prefix: string) => {
    for (const e of Deno.readDirSync(root)) {
      if (e.isDirectory) walk(`${root}/${e.name}`, `${prefix}${e.name}/`);
      else files.set(`${prefix}${e.name}`, { read: () => Deno.readFile(`${root}/${e.name}`) });
    }
  };
  walk(dir, "Saves/");
  let checked = 0, fish = 0;
  for (const c of findCharacters(files)) {
    const world = await loadWorld(files, c.root, c.name);
    const areas = [
      ...world.zones.flat().filter((z) => z.dir).map((z) => ({ dir: z.dir!, outside: true })),
      ...world.interiors.map((it) => ({ dir: it.dir, outside: false })),
    ];
    for (const a of areas) {
      const beings = (await loadDetail(world, a.dir)).beings.filter((b) => b.state !== 1);
      if (!beings.length) continue;
      const w: WaterLayers = { layers: {}, heights: (await loadHeights(world, a.dir))?.data };
      for (const l of WATER_LAYERS) w.layers[l] = (await loadLayer(world, a.dir, l))?.data;
      for (const b of beings) {
        const i = (b.y >> 4) * TILES + (b.x >> 4), why = habitatRefusal(b.index, w, i, a.outside);
        checked++;
        if (!why) continue;
        // The wildlife spawner (manager_area Alarm_4) puts Mudfins on any water tile, shallows too; only moving checks their needs.
        assert(habitat(b.index) === "swims" && (w.layers.Water1?.[i] ?? 0) > 0, `${c.name} ${a.dir}: ${why} at ${b.x >> 4},${b.y >> 4}`);
        fish++;
      }
    }
  }
  console.log(`  ${checked} creatures checked, ${fish} fish spawned into shallows`);
});

Deno.test({
  name: "real saves: moving into each interior names the folder the game wrote, onto floor its way out reaches",
  ignore: !present,
}, async () => {
  const files = new Map<string, { read: () => Promise<Uint8Array> }>();
  const walk = (root: string, prefix: string) => {
    for (const e of Deno.readDirSync(root)) {
      if (e.isDirectory) walk(`${root}/${e.name}`, `${prefix}${e.name}/`);
      else files.set(`${prefix}${e.name}`, { read: () => Deno.readFile(`${root}/${e.name}`) });
    }
  };
  walk(dir, "Saves/");
  let moved = 0, refused = 0, standing = 0;
  for (const c of findCharacters(files)) {
    const world = await loadWorld(files, c.root, c.name);
    const raw = decodeJson(await files.get(`${c.root}Player.save`)!.read());
    for (const it of world.interiors) {
      const data = (await loadLayer(world, it.dir, "Data"))?.data;
      const exits = it.solids.flatMap((s) => s.transPoint ? [(s.transPoint[2] >> 4) * TILES + (s.transPoint[1] >> 4)] : []);
      const reach = reachable(data, exits);
      assert(reach, `${c.name} ${it.dir}: the way out leads to enclosed floor`);
      if (isInside(world.player, it)) {
        const [x, y] = world.player.pos;
        assert(reach[(y >> 4) * TILES + (x >> 4)], `${c.name} ${it.dir}: where the game saved you is reachable`);
        standing++;
      }
      const inside = insideOf(it, world.player);
      if (!inside) {
        refused++;
        continue;
      }
      const p = playerRecord(structuredClone(raw));
      const floor = reach.findIndex((r, i) => r === 1 && tileIndex(data![i]) !== 1 && tileIndex(data![i]) !== 3);
      movePlayer(p, it.zone[0], it.zone[1], floor % TILES, Math.floor(floor / TILES), inside);
      const after = parsePlayer([p]);
      assert(isInside(after, it), `${c.name} ${it.dir}: you are in it`);
      // savearea: the folder the game loads you into, which Containers.save the editor writes last.
      assertEquals(currentContainers(files, c.root, after), `${it.dir}Containers.save`, `${c.name} ${it.dir}`);
      moved++;
    }
  }
  assert(moved > 0);
  console.log(`  ${moved} interiors moved into, ${refused} refused (kind only guessed), ${standing} where you stand`);
});

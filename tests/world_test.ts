import { assertEquals } from "./assert.ts";
import type { FileMap } from "../src/files.ts";
import type { PlayerSave } from "../src/save.ts";
import { loadWorld, questZone, type World, type Zone } from "../src/world.ts";

const zone = (x: number, y: number) => ({ x, y }) as Zone;
const world = (p: Partial<PlayerSave>) =>
  ({ player: p, zones: [0, 1, 2, 3, 4].map((y) => [0, 1, 2, 3, 4].map((x) => zone(x, y))) }) as unknown as World;

Deno.test("quest zones are where Player.save fixes them: [x, y] in rangerCamp, libraryArea and riftQuestArea", () => {
  const w = world({ rangerCamp: [1, 2], libraryArea: [4, 0], riftQuestArea: null });
  assertEquals([questZone(w, "bhato"), questZone(w, "library"), questZone(w, "scaal")], [zone(1, 2), zone(4, 0), undefined]);
  assertEquals(questZone(world({ rangerCamp: [7, 1] }), "bhato"), undefined, "off the grid");
});

const source = (raw: unknown) => ({ read: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(raw))) });
/** A character whose fort is at A,1 (type 0), every other zone a Common Bog, with these area folders' solids. */
function files(player: Record<string, unknown>, folders: Record<string, unknown[]>): FileMap {
  const grid = [0, 1, 2, 3, 4].map((y) => [0, 1, 2, 3, 4].map((x) => (x === 0 && y === 0 ? 0 : 1)));
  const map: FileMap = new Map([["Hero/Player.save", source([{ worldGrid: grid, ...player }])]]);
  for (const [dir, solids] of Object.entries(folders)) map.set(`Hero/${dir}/Solids.save`, source(solids));
  return map;
}
/** The way out a Magus realm gets (manager_area Alarm_3): back to an area of `type`, at the portal's spot. */
const wayOut = (type: number) => ({
  sprite: "spr_spell_twirl",
  pic: 0,
  index: -4,
  x: 1192,
  y: 1144,
  transPoint: [type, 1192, 1144, 600, 744, -200],
});

Deno.test("a Magus realm (MagusRealm/) belongs to the zone its portal opened in, while you are in it", async () => {
  const p = { areaX: 3, areaY: 1, areaType: 37, entranceX: 600, entranceY: 744 };
  const w = await loadWorld(files(p, { MagusRealm: [wayOut(1)], "[ 3,1 ]": [] }), "Hero/", "Hero");
  assertEquals(w.interiors.map((i) => [i.kind, i.zone, i.at, i.sealed, i.dir]), [[37, [3, 1], [600, 744], true, "Hero/MagusRealm/"]]);
});

Deno.test("outside, a Magus realm is placed only when its way out names a zone type the world has once", async () => {
  const outside = { areaX: 2, areaY: 2, areaType: 1, entranceX: 0, entranceY: 0 };
  const fort = await loadWorld(files(outside, { MagusRealm: [wayOut(0)] }), "Hero/", "Hero");
  assertEquals(fort.interiors.map((i) => [i.kind, i.zone, i.at]), [[37, [0, 0], [600, 744]]]);
  // 24 Common Bogs: the save does not say which one the portal opened in.
  const bog = await loadWorld(files(outside, { MagusRealm: [wayOut(1)] }), "Hero/", "Hero");
  assertEquals(bog.interiors, []);
});

Deno.test("Grand Mother's hut is known by its ladder outside, or else by its way out", async () => {
  const p = { areaX: 0, areaY: 1, areaType: 5, entranceX: 0, entranceY: 0 };
  const ladder = {
    sprite: "spr_building_48x48_tall",
    pic: 0,
    index: -2987,
    x: 1000,
    y: 1000,
    transPoint: [36, 1024, 992, 1192, 1208, -213],
  };
  const exit = { sprite: "spr_placed_16x16_taller", pic: 11, index: -4, x: 1192, y: 1224, transPoint: [5, 1192, 1224, 1024, 992, -200] };
  const known = await loadWorld(files(p, { "[ 0,1 ]": [ladder], "[ 0,1,1032,1000 ]": [exit] }), "Hero/", "Hero");
  assertEquals(known.interiors.map((i) => [i.kind, !!i.kindGuessed]), [[36, false]]);
  const guessed = await loadWorld(files(p, { "[ 0,1 ]": [], "[ 0,1,1032,1000 ]": [exit] }), "Hero/", "Hero");
  assertEquals(guessed.interiors.map((i) => [i.kind, !!i.kindGuessed, i.sealed]), [[36, true, true]]);
});

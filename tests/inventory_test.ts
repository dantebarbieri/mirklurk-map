import { assert, assertEquals, assertRejects } from "./assert.ts";
import { containerInventory, parseInventoryGrid, parseItemList } from "../src/inventory.ts";
import { parseContainers, parsePlayer } from "../src/save.ts";
import { detailMarks, markKey } from "../src/objects.ts";
import { loadDetail, loadWorld, type ZoneDetail } from "../src/world.ts";
import { BEING_NAMES, ITEM_NAMES } from "../src/gamedata.ts";
import { entityWiki, itemWiki, wikiUrl } from "../src/wiki.ts";

const item = (index = 3, X = 0, Y = 0, amount = 1) => ({ index, X, Y, amount, durability: 81, wet: 0.25, subParts: [] });
const player = (extra = {}) => [{ worldGrid: Array.from({ length: 5 }, () => [1, 1, 1, 1, 1]), ...extra }];
const detail = (containers: ZoneDetail["containers"]): ZoneDetail => ({
  containers,
  beings: [],
  stations: [],
  interactables: [],
  decorations: [],
});

Deno.test("inventory: repeated occupied cells are one stack; identical separate stacks stay distinct", () => {
  const a = item(3, 0, 0, 2), b = item(3, 2, 0, 3);
  const parsed = parseInventoryGrid([[a, a, b], [a, a, b]]);
  assert(parsed.state === "saved");
  assertEquals(parsed.items.map((i) => [i.index, i.amount, i.durability, i.wet]), [[3, 2, 81, 0.25], [3, 3, 81, 0.25]]);
});

Deno.test("inventory: equipment with nested bags retains independent inventories", () => {
  const nested = { ...item(12), subParts: [{ type: 0, gridSave: [[item(72, 0, 0, 20)]] }] };
  const bag = { ...item(148), subParts: [{ type: 0, gridSave: [[nested]] }, [[1, 0], [0, 1]]] };
  const p = parsePlayer(player({ myEquips: [-4, bag, item(3)] }));
  assert(p.inventory?.state === "saved");
  assertEquals(p.inventory.items.length, 2);
  const inner = p.inventory.items[0].contents[0];
  assert(inner.state === "saved");
  const coins = inner.items[0].contents[0];
  assert(coins.state === "saved");
  assertEquals(coins.items[0].amount, 20);
});

Deno.test("inventory: not rolled, absent, and empty are distinct", () => {
  assertEquals(containerInventory({ status: -214, gridSave: [[-4]] }).state, "unrolled");
  assertEquals(containerInventory({ status: -200 }).state, "unavailable");
  assertEquals(containerInventory({ status: -200, gridSave: [[-4]] }), { state: "saved", items: [] });
  assertEquals(parseItemList(undefined).state, "unavailable");
  assertEquals(parseItemList([]), { state: "saved", items: [] });
});

Deno.test("inventory: game-saved wrong origins recover by occupied cells with a note", () => {
  // From a real save: a bag inside its own pouch, with item 130's origin written as 0,0 instead of 2,0.
  const self = { ...item(12), subParts: [{ type: 0, grid: "@ref ds_grid(159)" }] }, stray = item(130);
  const parsed = parseInventoryGrid([[self, self, stray, stray], [self, self, stray, stray]]);
  assert(parsed.state === "saved");
  assertEquals(parsed.items.map((i) => i.index), [12, 130]);
  assert(parsed.note?.includes("inconsistent"));
  assertEquals(parsed.items[0].contents[0].state, "unavailable");
  const outOfBounds = parseInventoryGrid([[item(3, 10)]]);
  assert(outOfBounds.state === "saved");
  assertEquals(outOfBounds.items.length, 1);
  assertEquals((parseInventoryGrid([[item(3)]]) as { note?: string }).note, undefined);
  const one = item(3, 10, 0, 1), two = item(3, 10, 0, 2), wetter = { ...item(3, 10, 0, 1), wet: 0.5 };
  const adjacent = parseInventoryGrid([[one, one, two], [one, one, two], [wetter, wetter, two]]);
  assert(adjacent.state === "saved");
  assertEquals(adjacent.items.map((i) => [i.amount, i.wet]), [[1, 0.25], [2, 0.25], [1, 0.5]]);
});

Deno.test("inventory: corrupt grids and item records are explicit errors", async () => {
  await assertRejects(() => parseInventoryGrid([[-4], []]), /Ragged/);
  await assertRejects(() => parseInventoryGrid([[null]]), /cell/);
  await assertRejects(() => parseItemList([{ index: 3, amount: "many" }]), /item/);
  await assertRejects(() => parseItemList([{ ...item(), wet: Infinity }]), /wet/);
});

Deno.test("markers: reopened chests, remains, corpses, storage and wood drops remain inspectable", () => {
  const containers = parseContainers([
    { index: 149, status: -200, gridSave: [[item()]] },
    { index: 152, status: -205, gridSave: [[-4]] },
    { index: 31, status: -216, gridSave: [[item()]] },
    { index: 108, status: -211, gridSave: [[item()]] },
    { index: -4, status: -205, sprite: "spr_drops_woodcut", gridSave: [[item()]] },
    { index: 150, status: -214, gridSave: [[-4]] },
  ]);
  const marks = detailMarks(detail(containers));
  assertEquals(marks.length, 6);
  assertEquals(marks.map((m) => m.inventory?.state), ["saved", "saved", "saved", "saved", "saved", "unrolled"]);
  assertEquals(marks[2].name, `Carcass: ${BEING_NAMES[31]}`);
  // Stashes are their own layer, apart from camp items.
  assertEquals([marks[3].layer, marks[3].kind], ["storage", "storage"]);
});

Deno.test("ground loot: keep independently saved records visible at occupied container tiles", async () => {
  const source = (raw: unknown) => ({ read: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(raw))) });
  const world = await loadWorld(
    new Map([
      ["Player.save", source(player())],
      ["[ 0,0 ]/LOOT-24_40.save", source([item(72, 0, 0, 20)])],
      ["[ 0,0 ]/LOOT-40_40.save", source("bad")],
      ["[ 0,0,24,40 ]/LOOT-8_8.save", source([])],
    ]),
    "",
    "Hero",
  );
  const d = await loadDetail(world, "[ 0,0 ]/");
  assertEquals(d.groundLoot?.length, 2);
  assertEquals(d.groundLoot?.[0].inventory.state, "saved");
  assertEquals(d.groundLoot?.[1].inventory.state, "unavailable");
  assertEquals(world.warnings.length, 1);
  for (const grid of [{}, { gridSave: [[item(3)]] }]) {
    d.containers = parseContainers([{ x: 24, y: 40, status: -205, ...grid }]);
    const marks = detailMarks(d);
    assertEquals(marks.length, 3);
    const ground = marks.find((m) => m.name === "Ground loot" && m.x === 24)!;
    assert(ground.inventory?.state === "saved");
    assertEquals(ground.inventory.items[0].index, 72);
    assert(ground.detail?.includes("LOOT-24_40.save"));
    assert(markKey(ground) !== markKey(marks[0]));
    assertEquals(marks[0].inventory?.state, "gridSave" in grid ? "saved" : "unavailable");
  }
});

Deno.test("manual containers: malformed inventory retains its marker and does not hide valid neighbors", async () => {
  const containers = [
    { x: 24, y: 40, index: 149, status: -200, gridSave: [[item()]] },
    {
      x: 56,
      y: 40,
      index: 108,
      status: -211,
      gridSave: [[{
        ...item(12),
        subParts: [{ type: 0, gridSave: [[null]] }],
      }]],
    },
    { x: 72, y: 40, index: 31, status: -216, gridSave: [[item(72)]] },
  ];
  const source = (raw: unknown) => ({ read: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(raw))) });
  const world = await loadWorld(
    new Map([
      ["Player.save", source(player())],
      ["[ 0,0 ]/Containers.save", source(containers)],
    ]),
    "",
    "Hero",
  );
  const loaded = await loadDetail(world, "[ 0,0 ]/");
  assertEquals(loaded.containers.map((c) => c.inventory?.state), ["saved", "unavailable", "saved"]);
  assertEquals(detailMarks(loaded).map((m) => m.x), [24, 56, 72]);
  assertEquals(world.warnings.length, 1);
  assert(world.warnings[0].includes("Containers.save: Container 2 at 56,40"));
  await assertRejects(() => parseContainers(containers), /inventory cell/);
});

Deno.test("inspection: remains keep their selection key after opening", () => {
  const before = detailMarks(detail(parseContainers([{ x: 24, y: 40, index: 152, status: -214 }])))[0];
  const after = detailMarks(detail(parseContainers([{ x: 24, y: 40, index: 152, status: -205, gridSave: [[item()]] }])))[0];
  assertEquals(before.name, "Unsearched remains");
  assertEquals(after.name, "Remains");
  assertEquals(markKey(before), markKey(after));
  assertEquals(after.inventory?.state, "saved");
});

Deno.test("wiki: only verified titles produce direct article links; loot uses specific guides", () => {
  assertEquals(wikiUrl("Not a real page"), undefined);
  assertEquals(wikiUrl("Iron Dagger"), "https://mirklurk.wiki/w/Iron_Dagger");
  assertEquals(wikiUrl(ITEM_NAMES[148]), "https://mirklurk.wiki/w/Ranger's_Backpack");
  assertEquals(entityWiki("Chest (best loot)"), wikiUrl("Treasure chests"));
  assertEquals(entityWiki("Unsearched remains"), wikiUrl("Skeletons and corpses"));
  assertEquals(entityWiki("Carcass: Giant Slug"), wikiUrl("Giant Slug"));
  for (const name of Object.values(BEING_NAMES)) assert(wikiUrl(name), `No verified being page: ${name}`);
  assertEquals(itemWiki("Turnip"), wikiUrl("Turnip (item)"));
  assertEquals(entityWiki("Turnip"), wikiUrl("Turnip (nature)"));
  assertEquals(wikiUrl("Tree health and chopping"), "https://mirklurk.wiki/w/Tree_health_and_chopping");
  for (const name of Object.values(ITEM_NAMES)) assert(itemWiki(name), `No verified item page: ${name}`);
});

import { assert, assertEquals } from "./assert.ts";
import { CREATURE_ICON, detailMarks, riftRadius, sealedMarks, solidMarks, yourRaftMarks } from "../src/objects.ts";
import type { Interior } from "../src/world.ts";
import type { PlayerSave } from "../src/save.ts";
import { CREATURE_ICONS } from "../src/mapview.ts";
import { BEING_NAMES } from "../src/gamedata.ts";
import { NPC_MARKERS, SolidId } from "../src/rules.ts";

Deno.test("rift poison radius follows its sprite", () => {
  assertEquals(riftRadius("spr_rift_32x32"), 192);
  assertEquals(riftRadius("spr_rift_16x16"), 60);
  assertEquals(riftRadius("spr_rift_32x32_dead"), 0);
  assertEquals(riftRadius("spr_rift_16x16_dead"), 0);
});

Deno.test("creatures: every creature is drawn as its kind's icon, NPCs and unknown beings as before", () => {
  const indexes = [...Object.keys(BEING_NAMES).map(Number), 99];
  const marks = detailMarks({
    beings: indexes.map((index) => ({ index, state: 0, x: 0, y: 0 })),
    containers: [],
    stations: [],
    interactables: [],
    decorations: [],
  });
  assertEquals(marks.map((m) => m.being), indexes);
  for (const m of marks) {
    const [kind, icon] = m.kind.split(" ");
    if (NPC_MARKERS.has(m.being!)) assertEquals([m.layer, m.kind], ["npcs", "npc"]);
    else if (m.being === 99) assertEquals([m.layer, m.kind], ["creatures", "creature"]);
    else {
      assertEquals([m.layer, kind], ["creatures", "creature"]);
      assert(CREATURE_ICONS[icon], `${m.name} has an icon (${icon})`);
    }
  }
  // Kinds that look alike in the game share an icon.
  assertEquals([CREATURE_ICON[1], CREATURE_ICON[2], CREATURE_ICON[25]], ["fly", "fly", "fly"]);
  assertEquals([CREATURE_ICON[14], CREATURE_ICON[15], CREATURE_ICON[16]], ["scaalmyr", "scaalmyr", "scaalmyr"]);
  assert(Object.keys(CREATURE_ICON).every((i) => !NPC_MARKERS.has(Number(i))), "NPCs keep the NPC marker");
  // Wilda's Survivors never target you, so they are drawn as NPCs, unlabelled like the Soldiers; Grand Mother is labelled.
  const survivor = marks.find((m) => m.being === 35)!;
  assertEquals([survivor.layer, survivor.kind, survivor.label], ["npcs", "npc", undefined]);
  const mother = marks.find((m) => m.being === 36)!;
  assertEquals([mother.layer, mother.kind, mother.label], ["npcs", "npc", "Grand Mother"]);
  // The Mirkfangs share the bat; The Terror, a boss with its own sprite, has its own shape, as Scaal does beside the Scaalmyr;
  // Clay in his realm attacks you, so he is a creature with a magus's shape.
  assertEquals([37, 38, 39, 40, 41].map((i) => marks.find((m) => m.being === i)!.kind), [
    "creature bat",
    "creature bat",
    "creature bat",
    "creature terror",
    "creature magus",
  ]);
  assert(CREATURE_ICONS.terror.body !== CREATURE_ICONS.bat.body, "The Terror is not drawn as a Mirkfang");
  // So is the Dead Unwanted (Viend before he is revived), labelled like the other named NPCs.
  const viend = marks.find((m) => m.being === 9)!;
  assertEquals([viend.layer, viend.kind, viend.label], ["npcs", "npc", "Dead Unwanted"]);
  assertEquals(Object.keys(CREATURE_ICONS).sort(), [...new Set(Object.values(CREATURE_ICON))].sort(), "no unused icons");
});

Deno.test("rafts: placed rafts and Raft Bases are their own layer; the raft you stand on is drawn under you", () => {
  const at = { sprite: "spr_placed_16x16_wider", pic: 1, status: -200, x: 344, y: 744 };
  const marks = detailMarks({
    beings: [],
    containers: [],
    stations: [{ ...at, index: 171 }, { ...at, pic: 0, index: 170 }, { ...at, sprite: "spr_placed_16x16", pic: 0, index: 38 }],
    interactables: [],
    decorations: [],
  });
  assertEquals(marks.map((m) => [m.layer, m.kind, m.name, m.item]), [
    ["rafts", "raft", "Raft", 171],
    ["rafts", "raft base", "Raft Base", 170],
    ["camp", "camp", "Campfire", 38],
  ]);
  const p = { onRaft: true, area: { x: 2, y: 0, type: 5 }, pos: [340, 750] } as PlayerSave;
  assertEquals(yourRaftMarks(p, 2, 0).map((m) => [m.layer, m.kind, m.x, m.y, m.item]), [["rafts", "raft yours", 344, 744, 171]]);
  assertEquals(yourRaftMarks(p, 1, 0), [], "only in your zone");
  assertEquals(yourRaftMarks({ ...p, onRaft: false }, 2, 0), []);
  assertEquals(yourRaftMarks({ ...p, area: { x: 2, y: 0, type: 30 } }, 2, 0), [], "never indoors");
});

Deno.test("storage: a placed Storage Chest keeps its contents like Clay's and Bhato's chests, and is storage", () => {
  const at = { sprite: "spr_placed_16x16", pic: 6, x: 344, y: 744 };
  const marks = detailMarks({
    beings: [],
    containers: [
      { ...at, index: 275, status: -207, xscale: -1 },
      { ...at, index: 108, status: -211 },
      { ...at, index: 109, status: -211 },
      { ...at, index: 248, status: -207 },
    ],
    stations: [],
    interactables: [],
    decorations: [],
  });
  assertEquals(marks.map((m) => [m.layer, m.name]), [
    ["storage", "Storage Chest"],
    ["storage", "Hidden Hollow"],
    ["storage", "Storage chest"],
    ["loot", "Jar of Fireflies"],
  ]);
});

Deno.test("the Survivors' camp: Grand Mother's hut leads inside and is labelled; the other huts are not", () => {
  const hut = (index: number, pic: number, transPoint: number[] | null) => ({
    sprite: "spr_building_48x48_tall",
    pic,
    index,
    x: 1000,
    y: 1000,
    transPoint,
  });
  const marks = solidMarks([hut(SolidId.MotherHut, 0, [36, 1024, 992, 1192, 1208, -212]), hut(SolidId.SurvivorHut, 1, null)], []);
  assertEquals(marks.map((m) => [m.layer, m.name, m.label, m.detail, m.x, m.y]), [
    ["places", "Survivors' camp", "Survivors' camp", "Leads to: Grand Mother's hut", 1024, 992],
    ["places", "Survivors' hut", undefined, undefined, 1023.5, 999],
  ]);
});

Deno.test("a Magus realm has no entrance to mark, so it gets a marker where its portal opened", () => {
  const realm = { zone: [1, 2], at: [1208, 1336], dir: "MagusRealm/", kind: 37, parent: null, sealed: true, solids: [] } as Interior;
  const marks = sealedMarks([realm, { ...realm, kind: 30, at: [500, 500], dir: "x/" }]);
  assertEquals(marks.map((m) => [m.layer, m.name, m.x, m.y]), [["places", "Magus realm", 1208, 1336], ["places", "Undercroft", 500, 500]]);
  assert(marks[0].detail!.includes("Magus' Shard"), marks[0].detail);
  assertEquals(marks[1].detail, "entrance is gone");
});

import { assert, assertEquals } from "./assert.ts";
import { CREATURE_ICON, detailMarks, riftRadius, yourRaftMarks } from "../src/objects.ts";
import type { PlayerSave } from "../src/save.ts";
import { CREATURE_ICONS } from "../src/mapview.ts";
import { BEING_NAMES } from "../src/gamedata.ts";
import { NPC_MARKERS } from "../src/rules.ts";

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
  // The Unwanted Guard never targets you, so it is drawn as an NPC, unlabelled like the Soldiers.
  const guard = marks.find((m) => m.being === 35)!;
  assertEquals([guard.layer, guard.kind, guard.label], ["npcs", "npc", undefined]);
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

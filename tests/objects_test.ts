import { assert, assertEquals } from "./assert.ts";
import { CREATURE_ICON, detailMarks, riftRadius } from "../src/objects.ts";
import { CREATURE_ICONS } from "../src/mapview.ts";
import { BEING_NAMES } from "../src/gamedata.ts";
import { NPC_BEINGS } from "../src/rules.ts";

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
    if (NPC_BEINGS.has(m.being!)) assertEquals([m.layer, m.kind], ["npcs", "npc"]);
    else if (m.being === 99) assertEquals([m.layer, m.kind], ["creatures", "creature"]);
    else {
      assertEquals([m.layer, kind], ["creatures", "creature"]);
      assert(CREATURE_ICONS[icon], `${m.name} has an icon (${icon})`);
    }
  }
  // Kinds that look alike in the game share an icon.
  assertEquals([CREATURE_ICON[1], CREATURE_ICON[2], CREATURE_ICON[25]], ["fly", "fly", "fly"]);
  assertEquals([CREATURE_ICON[14], CREATURE_ICON[15], CREATURE_ICON[16]], ["scaalmyr", "scaalmyr", "scaalmyr"]);
  assert(Object.keys(CREATURE_ICON).every((i) => !NPC_BEINGS.has(Number(i))), "NPCs keep the NPC marker");
  assertEquals(Object.keys(CREATURE_ICONS).sort(), [...new Set(Object.values(CREATURE_ICON))].sort(), "no unused icons");
});

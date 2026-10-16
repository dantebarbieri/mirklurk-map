// Item condition as the game's tooltip shows it: which items show durability, portions or oil left, burn time and wetness.

import { assert, assertEquals } from "./assert.ts";
import {
  canGetWet,
  conditionOf,
  conditionParts,
  durabilityKind,
  durabilityMax,
  fuelMax,
  isOrb,
  isWet,
  itemState,
  needsFuel,
  needsRepair,
  wetText,
} from "../src/condition.ts";
import { ITEMS } from "../src/itemdata.ts";

Deno.test("condition: durability shows as the tooltip shows it, named for what it counts", () => {
  assertEquals(durabilityKind(4), "durability", "Steel Dagger");
  assertEquals(durabilityKind(110), "durability", "a lantern wears too");
  assertEquals(durabilityKind(25), "portions", "Loaf of Bread");
  assertEquals(durabilityKind(112), "oil", "Lamp Oil");
  for (const index of [51, 72, 75, 52, 19]) {
    assertEquals(durabilityKind(index), undefined, `${index}: a durability of 1, coins, a quest item, a material, none at all`);
  }
  assertEquals([fuelMax(41), fuelMax(110), fuelMax(112), fuelMax(4)], [35, 100, undefined, undefined]);
  assert(canGetWet(23) && canGetWet(35) && canGetWet(12), "a shirt, a log and a backpack get wet");
  assert(!canGetWet(4) && !canGetWet(72) && !canGetWet(110), "a dagger, coins and a lantern never do");
  // 0.8.9.9 adds two that can get wet: Clay's Magus Hood and Magi's Ropebelt.
  assertEquals(Object.values(ITEMS).filter((d) => d.waterproof !== undefined).length, 76);
  assert(canGetWet(264) && canGetWet(265) && !canGetWet(267), "the hood and the ropebelt get wet, an orb never does");
  assertEquals([durabilityKind(266), durabilityKind(267), durabilityKind(261)], ["durability", "durability", undefined]);
});

Deno.test("condition: since 0.9.0.1 Grand Mother's orbs wear, 30 casts from new; before, they had 1 and showed none", () => {
  const orbs = Object.keys(ITEMS).map(Number).filter(isOrb);
  assertEquals(orbs, [267, 268, 269, 270, 271, 272, 273, 274]);
  for (const orb of orbs) {
    assertEquals([durabilityMax(orb), durabilityMax(orb, "0.9.0.1"), durabilityMax(orb, "0.9.0.0")], [30, 30, 1], `${orb}`);
    assertEquals([durabilityKind(orb, "0.9.0.2"), durabilityKind(orb, "0.8.9.9")], ["durability", undefined], `${orb}`);
  }
  assertEquals([durabilityMax(266, "0.9.0.0"), durabilityMax(4, "0.8.1.5"), durabilityMax(19), durabilityMax(-1)], [
    ITEMS[266].durability,
    ITEMS[4].durability,
    ITEMS[19].durability,
    undefined,
  ]);
  const worn = { index: 270, durability: 7 };
  assertEquals(conditionParts(conditionOf(worn)), [{ text: "Durability 7/30", low: true }]);
  assertEquals(conditionParts(conditionOf(worn, "0.9.0.0")), [], "an older game shows an orb's condition not at all");
  assert(needsRepair(worn) && !needsRepair(worn, "0.9.0.0") && !needsFuel(worn, "0.9.0.0"));
  assertEquals(conditionOf({ index: 267, durability: 1 }).durability, { kind: "durability", value: 1, max: 30 }, "a migrated save's");
});

Deno.test("condition: current and maximum values, fuel in turns, wetness in percent, low when a quarter or less is left", () => {
  const lantern = conditionOf({ index: 110, durability: 30, burnTimeLeft: 12.25, wet: 0 });
  assertEquals(lantern, { durability: { kind: "durability", value: 30, max: 50 }, fuel: { value: 12.25, max: 100 } });
  assertEquals(conditionParts(lantern), [{ text: "Durability 30/50", low: false }, { text: "Fuel 12.3/100 turns", low: true }]);
  assertEquals(conditionParts(conditionOf({ index: 23, durability: 70, wet: 0.4567 })), [
    { text: "Durability 70/70", low: false },
    { text: "Wet 45.7%" },
  ]);
  assertEquals(conditionOf({ index: 54 }).durability?.value, 300, "not saved: full, as a new one is");
  assertEquals(conditionParts(conditionOf({ index: 25, durability: 1 })), [{ text: "Portions left 1/5", low: true }]);
  assertEquals(conditionParts(conditionOf({ index: 112, durability: 87.5 })), [{ text: "Oil left 87.5/150", low: false }]);
  assertEquals(conditionParts(conditionOf({ index: 72, durability: 100, wet: 0 })), [], "coins show nothing");
  assertEquals([wetText(0), wetText(0.0001), wetText(1)], ["0%", "<0.1%", "100%"]);
});

Deno.test("condition: what repairing and refuelling restore", () => {
  assert(!needsRepair({ index: 110, durability: 50, burnTimeLeft: 3 }) && needsFuel({ index: 110, durability: 50, burnTimeLeft: 3 }));
  assert(needsRepair({ index: 110, durability: 49, burnTimeLeft: 100 }) && !needsFuel({ index: 110, durability: 49, burnTimeLeft: 100 }));
  assert(needsFuel({ index: 112, durability: 100 }) && !needsRepair({ index: 112, durability: 100 }), "Lamp Oil is fuel");
  assert(!needsRepair({ index: 25, durability: 2 }) && !needsFuel({ index: 25, durability: 2 }), "eaten bread is not worn");
  assert(!needsRepair({ index: 72, durability: 50 }), "coins have no durability to repair");
  assert(isWet({ index: 35, wet: 0.01 }) && !isWet({ index: 35, wet: 0 }) && !isWet({ index: 35 }));
});

Deno.test("condition: a raw item record from a save reads as its condition fields, whatever else it holds", () => {
  const rec = { index: 4, amount: 1, X: 0, Y: 0, durability: 50, wet: 0.25, sideflipped: false };
  assertEquals(itemState(rec), { index: 4, durability: 50, burnTimeLeft: undefined, wet: 0.25 });
  assertEquals(conditionOf(itemState(rec)), conditionOf({ index: 4, durability: 50, wet: 0.25 }));
  assert(isWet(itemState(rec)) && !isWet(itemState({ index: 23, wet: 0 })));
});

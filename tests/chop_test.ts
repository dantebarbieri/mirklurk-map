import { assert, assertEquals } from "./assert.ts";
import {
  CHOP_TOOLS,
  chosenTool,
  dryDivisor,
  formatAp,
  freshnessOf,
  harvestCost,
  Nature,
  ownedTools,
  Part,
  partLabel,
  roundGml,
  trunkOf,
  trunkWood,
  UNARMED,
} from "../src/chop.ts";
import { brambleMarks, treeDetail, treeMarks } from "../src/objects.ts";
import type { Inventory } from "../src/inventory.ts";

const IRON_HAND_AXE = 27, STEEL_FELLING_AXE = 30;

function part(size: number, life: number, depth = 0, parent = depth ? 0 : -1): number[] {
  const b = new Array(26).fill(0);
  b[Part.size] = size;
  b[Part.life] = life;
  b[Part.depth] = depth;
  b[Part.parent] = parent;
  return b;
}

Deno.test("chop: GameMaker round() sends halves to even", () => {
  assertEquals([0.5, 1.5, 2.5, 3.5, 2.4, 2.6].map(roundGml), [0, 2, 2, 4, 2, 3]);
});

Deno.test("chop: freshness labels follow round(lerp(4, 0, life))", () => {
  assertEquals([1, 0.9, 0.875, 0.75, 0.625, 0.5, 0.3, 0.1, 0].map(freshnessOf), [0, 0, 0, 1, 2, 2, 3, 4, 4]);
});

Deno.test("chop: drier wood divides the cost", () => {
  assertEquals(dryDivisor(1), 0.5);
  assertEquals(dryDivisor(0.5), 2.5);
  assertEquals(dryDivisor(0), 5);
});

Deno.test("chop: willow trunk cost with the dryness, trunk factor, cap and tool", () => {
  // 24 × 0.95 / 3.5 × (1.33 + 0.95) / 3 = 4.95 → 5
  assertEquals(harvestCost(Nature.Willow, part(0.95, 0.3), CHOP_TOOLS[IRON_HAND_AXE]), 5);
  // A living trunk hits the 32 AP cap before the tool divides it.
  assertEquals(harvestCost(Nature.Willow, part(0.95, 1), CHOP_TOOLS[UNARMED]), 32);
  assertEquals(harvestCost(Nature.Willow, part(0.95, 1), CHOP_TOOLS[IRON_HAND_AXE]), 10.6);
  assertEquals(harvestCost(Nature.Willow, part(0.95, 0), CHOP_TOOLS[IRON_HAND_AXE]), 3.4);
  // Branches skip the trunk factor.
  assertEquals(harvestCost(Nature.Willow, part(0.3, 0.5, 2), CHOP_TOOLS[UNARMED]), 2.8);
});

Deno.test("chop: species multipliers apply after the cap", () => {
  assertEquals(harvestCost(Nature.Cypress, part(1, 1), CHOP_TOOLS[UNARMED]), 38.4);
  assertEquals(harvestCost(Nature.Trollgnarl, part(1, 1), CHOP_TOOLS[UNARMED]), 64);
  // Elderwort ignores dryness: 8 × size for the stem, 4 × size for branches.
  assertEquals(harvestCost(Nature.Elderwort, part(0.5, 1), CHOP_TOOLS[UNARMED]), 4);
  assertEquals(harvestCost(Nature.Elderwort, part(0.5, 0), CHOP_TOOLS[UNARMED]), 4);
  assertEquals(harvestCost(Nature.Elderwort, part(0.5, 1, 1), CHOP_TOOLS[UNARMED]), 2);
});

Deno.test("chop: costs round to 0.2 AP and never drop below it", () => {
  assertEquals(harvestCost(Nature.Willow, part(0.01, 0), CHOP_TOOLS[STEEL_FELLING_AXE]), 0.2);
  assertEquals(formatAp(5), "5");
  assertEquals(formatAp(10.6), "10.6");
});

Deno.test("chop: part labels match the harvest menu", () => {
  assertEquals(partLabel(Nature.Willow, part(0.95, 1)), "Trunk");
  assertEquals(partLabel(Nature.Willow, part(0.25, 1)), "Thick Branch");
  assertEquals(partLabel(Nature.Willow, part(0.1, 1)), "Branch");
  assertEquals(partLabel(Nature.Willow, part(0.1, 1, 1)), "Twig");
  assertEquals(partLabel(Nature.Willow, part(0.45, 1, 1)), "Thick Branch");
  assertEquals(partLabel(Nature.Elderwort, part(0.5, 1)), "Stem");
  assertEquals(partLabel(Nature.Brambles, part(0.5, 1)), "Twig");
});

Deno.test("chop: felled trunks drop logs by size", () => {
  assertEquals(trunkWood(Nature.Willow, 0.95), { item: 35, count: 6 });
  assertEquals(trunkWood(Nature.Cypress, 0.15), { item: 79, count: 3 });
  assertEquals(trunkWood(Nature.Trollgnarl, 0.5), { item: 214, count: 3 });
  assertEquals(trunkWood(Nature.Elderwort, 0.5), undefined);
});

Deno.test("chop: the trunk is the root part and drives the marker", () => {
  const tree = { index: Nature.Willow, x: 100, y: 200, parts: [part(0.9, 0.4), part(0.3, 0.6, 1)] };
  const trunk = trunkOf(tree)!;
  assertEquals([trunk.life, trunk.freshness], [0.4, 2]);
  assertEquals(trunkOf({ ...tree, parts: [part(0.9, 0.4, 0, -4)] }), undefined);
  const [mark] = treeMarks([tree], IRON_HAND_AXE);
  assertEquals(mark.kind, "tree willow f2");
  assertEquals(mark.detail, "Half Dead (40% alive), trunk 5.4 AP");
  assertEquals(treeDetail(tree), "Half Dead (40% alive)");
});

Deno.test("chop: brambles and rift vines are their own layer, not trees", () => {
  const plant = (index: number) => ({ index, x: 0, y: 0, parts: [part(0.5, 0.5)] });
  const saved = [plant(Nature.Willow), plant(Nature.Brambles), plant(Nature.RiftVine), plant(Nature.Cypress)];
  assertEquals(treeMarks(saved).map((m) => m.kind.split(" ")[1]), ["willow", "cypress"]);
  assertEquals(brambleMarks(saved).map((m) => [m.layer, m.kind]), [["brambles", "bramble"], ["vines", "bramble vine"]]);
});

Deno.test("chop: the default tool is the best one carried, even in a bag", () => {
  const item = (index: number, contents: Inventory[] = []) => ({ index, amount: 1, contents });
  const inv: Inventory = { state: "saved", items: [item(3), item(100, [{ state: "saved", items: [item(IRON_HAND_AXE)] }])] };
  assertEquals(ownedTools(inv), [IRON_HAND_AXE, 3, UNARMED]);
  assertEquals(ownedTools(undefined), [UNARMED]);
  assertEquals(chosenTool([IRON_HAND_AXE, UNARMED]), IRON_HAND_AXE);
  assertEquals(chosenTool([IRON_HAND_AXE, UNARMED], { tool: UNARMED, owned: `${IRON_HAND_AXE},${UNARMED}` }), UNARMED);
  assertEquals(chosenTool([IRON_HAND_AXE, UNARMED], { tool: UNARMED, owned: `${UNARMED}` }), IRON_HAND_AXE);
  assert(Object.values(CHOP_TOOLS).every((m) => m > 0));
});

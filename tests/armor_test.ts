import { assert, assertEquals } from "./assert.ts";
import { armorRoom, armorToPlace, type Equipped, itemArmor, SLOT_NAMES, totalArmor } from "../src/armor.ts";
import { parseHealth } from "../src/health.ts";
import type { SavedItem } from "../src/inventory.ts";
import { parsePlayer } from "../src/save.ts";

const saved = (index: number, durability?: number): SavedItem => ({ index, amount: 1, durability, contents: [] });
const worn = (slot: number, item: SavedItem, active = true): Equipped => ({ slot, active, item });

Deno.test("armor: each piece scales with durability to 0.01, the total to 0.1", () => {
  assertEquals(itemArmor(saved(54, 289)), 5.78); // Steel Bascinet 6 × 289/300
  assertEquals(itemArmor(saved(205, 61)), 0.68); // Ranger's Hood 1 × 61/90
  assertEquals(itemArmor(saved(54)), 6); // durability not saved: full
  assertEquals(itemArmor(saved(22, 40)), 0.5); // Simple Shirt, new
  assertEquals(itemArmor(saved(3, 50)), undefined); // a dagger has none
  const kit = [worn(4, saved(54, 289)), worn(5, saved(205, 61)), worn(6, saved(23, 63)), worn(0, saved(157, 37))];
  assertEquals(totalArmor(kit), 7); // 5.78 + 0.68 + 0.54 = 7.0
  assertEquals(totalArmor([...kit, worn(14, saved(18, 44))]), 7.1);
  assertEquals(totalArmor([]), 0);
});

Deno.test("armor: combat start rounds the total down and caps it at 3 layers per living hit point", () => {
  const g = parseHealth([[1, 0, -1], [1, 2, -4]])!;
  assertEquals(armorRoom(g), 3 + 3 + 2);
  assertEquals(armorToPlace(7.9, g), 7);
  assertEquals(armorToPlace(11.5, g), 8);
  assertEquals(armorToPlace(0.9), 0);
});

Deno.test("armor: equipment keeps its slots and weapon sets, and drops a two-hander's off-hand copy", () => {
  const item = (index: number, durability = 50) => ({ index, amount: 1, durability, X: -4, Y: -4, subParts: [], wet: 0 });
  const equips = Array<unknown>(16).fill(-4);
  equips[0] = item(185); // Steel Greatsword in the first set's main hand…
  equips[1] = item(185); // …and saved again in its off hand
  equips[2] = item(106);
  equips[3] = item(46);
  equips[4] = item(54, 289);
  const p = parsePlayer([{
    worldGrid: Array.from({ length: 5 }, () => [1, 1, 1, 1, 1]),
    myEquips: equips,
    actives: [false, false, true, true, ...Array(12).fill(true)],
  }]);
  assert(p.inventory?.state === "saved");
  assertEquals(p.inventory.items.map((i) => i.index), [185, 106, 46, 54]);
  assertEquals(p.equipment.map((e) => [e.slot, e.active]), [[0, false], [2, true], [3, true], [4, true]]);
  assert(p.equipment.every((e, i) => p.inventory?.state === "saved" && e.item === p.inventory.items[i]));
  assertEquals(SLOT_NAMES[p.equipment[3].slot], "helmet");
  assertEquals(totalArmor(p.equipment), 5.8);
  assertEquals(parsePlayer([{ worldGrid: Array.from({ length: 5 }, () => [1, 1, 1, 1, 1]) }]).equipment, []);
});

Deno.test({
  name: "armor: real saves give a total within what their equipment can hold",
  ignore: !Deno.env.get("MIRKLURK_SAVES"),
  fn() {
    const root = Deno.env.get("MIRKLURK_SAVES")!;
    for (const c of Deno.readDirSync(root)) {
      if (!c.isDirectory) continue;
      const text = new TextDecoder().decode(Deno.readFileSync(`${root}/${c.name}/Player.save`)).replace(/\0+$/, "");
      const p = parsePlayer(JSON.parse(text));
      const total = totalArmor(p.equipment);
      assert(total >= 0 && total < 40, `${c.name}: ${total}`);
      assert(p.equipment.every((e) => e.slot >= 0 && e.slot < SLOT_NAMES.length), c.name);
      if (p.health) assert(armorToPlace(total, p.health) <= Math.floor(total), c.name);
    }
  },
});

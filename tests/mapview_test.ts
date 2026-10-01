import { mapBounds } from "../src/mapview.ts";
import { ROOM } from "../src/rules.ts";
import { assert, assertEquals } from "./assert.ts";

Deno.test("map bounds: include the room and both axes of an offset home view", () => {
  const homes: [number, number, number][] = [
    [0, 0, ROOM],
    [-96, 112, 768],
    [112, -96, 768],
    [-192, -32, 640],
    [2496, 2448, 256],
    [-64, 2496, 256],
    [-32, -96, 3000],
  ];
  for (const home of homes) {
    const [x, y, size] = mapBounds(home);
    assert(x <= 0 && y <= 0 && x + size >= ROOM && y + size >= ROOM, `${home}: all room edges remain reachable`);
    assert(x <= home[0] && y <= home[1], `${home}: home origin remains reachable`);
    assert(x + size >= home[0] + home[2] && y + size >= home[1] + home[2], `${home}: home far edges remain reachable`);
  }
  assertEquals(mapBounds([0, 0, ROOM]), [0, 0, ROOM]);
  assertEquals(mapBounds([-96, 112, 768]), [-96, 0, ROOM + 96]);
  assertEquals(mapBounds([2496, 2448, 256]), [0, 0, 2752]);
});

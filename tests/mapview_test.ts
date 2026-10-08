import { boxArea, footprintOrder, gestureView, mapBounds, stackAt, zonesInView } from "../src/mapview.ts";
import type { Mark } from "../src/objects.ts";
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

Deno.test("map gestures: pinch anchors midpoint, pans, and clamps zoom without jumping", () => {
  const view = { x: 500, y: 500, size: 1000 };
  const before = [{ x: 100, y: 150 }, { x: 200, y: 150 }];
  assertEquals(gestureView(view, before, [{ x: 50, y: 150 }, { x: 250, y: 150 }], 300, 300, ROOM), {
    x: 750,
    y: 750,
    size: 500,
  });
  assertEquals(gestureView(view, [{ x: 150, y: 150 }], [{ x: 180, y: 120 }], 300, 300, ROOM), {
    x: 400,
    y: 600,
    size: 1000,
  });
  const minimum = { x: 500, y: 500, size: 96 };
  assertEquals(gestureView(minimum, before, [{ x: 50, y: 150 }, { x: 250, y: 150 }], 300, 300, ROOM), minimum);
  const maximum = { x: 0, y: 0, size: ROOM };
  assertEquals(gestureView(maximum, before, [{ x: 125, y: 150 }, { x: 175, y: 150 }], 300, 300, ROOM), maximum);
});

Deno.test("footprints: smaller boxes paint above larger ones; identical boxes stack", () => {
  const fort: Mark = { layer: "camp", kind: "landmark", x: 0, y: 0, box: [0, 0, 99, 99], name: "Fort Solid" };
  const door: Mark = { layer: "camp", kind: "entrance", x: 5, y: 5, box: [4, 4, 9, 9], name: "Fort interior" };
  const twin: Mark = { ...door, name: "Twin" };
  assertEquals([fort.box!, door.box!].sort(footprintOrder), [fort.box!, door.box!]);
  assertEquals([door.box!, fort.box!].sort(footprintOrder), [fort.box!, door.box!]);
  assertEquals(boxArea(door.box!), 36);
  assertEquals(stackAt([fort, door, twin], twin), [twin, door]);
  assertEquals(stackAt([fort, door, twin], fort), [fort]);
});

Deno.test("zones in view: neighbours a viewport overlaps, clipped to the world", () => {
  assertEquals(zonesInView([0, 0, ROOM], [2, 2]), []);
  assertEquals(zonesInView([-1, 0, ROOM], [2, 2]), [[1, 2]]);
  assertEquals(zonesInView([-ROOM, -ROOM, 3 * ROOM], [0, 0]), [[1, 0], [0, 1], [1, 1]]);
  assertEquals(zonesInView([-4 * ROOM, -4 * ROOM, 5 * ROOM], [4, 4]).length, 24);
});

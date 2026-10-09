import {
  boxArea,
  cardPlace,
  clampView,
  FOCUS_SHARE,
  focusZone,
  footprintOrder,
  gestureView,
  mapBounds,
  stackAt,
  visibleRect,
  zonesInView,
} from "../src/mapview.ts";
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

Deno.test("zones in view: neighbours a shown area overlaps, clipped to the world", () => {
  assertEquals(zonesInView([0, 0, ROOM, ROOM], [2, 2]), []);
  assertEquals(zonesInView([-1, 0, ROOM, ROOM], [2, 2]), [[1, 2]]);
  assertEquals(zonesInView([-ROOM, -ROOM, 3 * ROOM, 3 * ROOM], [0, 0]), [[1, 0], [0, 1], [1, 1]]);
  assertEquals(zonesInView([-4 * ROOM, -4 * ROOM, 5 * ROOM, 5 * ROOM], [4, 4]).length, 24);
  // A tall (portrait full-screen) map sees the zones above and below too.
  assertEquals(zonesInView(visibleRect([0, 0, ROOM], 400, 800), [2, 2]), [[2, 1], [2, 3]]);
});

Deno.test("visible area: the view square fits the shorter side, centred, and the longer side shows more", () => {
  assertEquals(visibleRect([100, 200, 1000], 500, 500), [100, 200, 1000, 1000]);
  assertEquals(visibleRect([100, 200, 1000], 1000, 500), [-400, 200, 2000, 1000]);
  assertEquals(visibleRect([100, 200, 1000], 400, 800), [100, -300, 1000, 2000]);
});

Deno.test("clamp view: square maps keep the old clamp; a longer side may show past the bounds but keeps them in view", () => {
  const bounds: [number, number, number] = [-ROOM, -ROOM, 5 * ROOM];
  // Square: the view stays inside the bounds and between 96 and their size.
  assertEquals(clampView([-2 * ROOM, 0, ROOM], bounds, 500, 500), [-ROOM, 0, ROOM]);
  assertEquals(clampView([0, 0, 10], bounds, 500, 500), [0, 0, 96]);
  assertEquals(clampView([0, 0, 9 * ROOM], bounds, 500, 500), bounds);
  // Wide, zoomed in: what shows (twice as wide) stops at the bounds' edge, not just the square.
  assertEquals(clampView([-ROOM, 0, ROOM], bounds, 1000, 500), [-ROOM / 2, 0, ROOM]);
  // Tall, whole world: wider than the bounds vertically, so the world can sit anywhere within the screen, not past it.
  const [x, y, size] = clampView(bounds, bounds, 400, 800);
  assertEquals([x, y, size], bounds);
  assertEquals(clampView([-ROOM, -5 * ROOM, 5 * ROOM], bounds, 400, 800), [-ROOM, -ROOM - 2.5 * ROOM, 5 * ROOM]);
  assertEquals(clampView([-ROOM, 5 * ROOM, 5 * ROOM], bounds, 400, 800), [-ROOM, -ROOM + 2.5 * ROOM, 5 * ROOM]);
});

Deno.test("map gestures on a wide map: the point under the fingers stays put", () => {
  const view = { x: 0, y: 0, size: 1000 };
  const width = 600, height = 300;
  const game = (v: typeof view, p: { x: number; y: number }) => {
    const [x, y, w] = visibleRect([v.x, v.y, v.size], width, height);
    return [x + p.x * w / width, y + p.y * w / width].map((n) => Math.round(n * 1e6) / 1e6);
  };
  const before = [{ x: 400, y: 100 }, { x: 500, y: 100 }], after = [{ x: 300, y: 200 }, { x: 500, y: 200 }];
  const next = gestureView(view, before, after, width, height, ROOM);
  assertEquals(next.size, 500);
  assertEquals(game(next, { x: 400, y: 200 }), game(view, { x: 450, y: 100 }));
});

Deno.test("popup card: centred below its point, above near the bottom, inside the margins, and off with the point", () => {
  assertEquals(cardPlace(200, 100, 100, 50, 400, 400), { left: 150, top: 116, room: 276, below: true, off: false });
  // Too tall for below but fits above.
  assertEquals(cardPlace(200, 350, 100, 200, 400, 400), { left: 150, top: 134, room: 326, below: false, off: false });
  // Too tall for either side: the roomier one, limited to it.
  const tall = cardPlace(200, 150, 100, 900, 400, 400);
  assertEquals([tall.below, tall.room, tall.top], [true, 226, 166]);
  // Clamped to the margins near the edges.
  assertEquals(cardPlace(10, 100, 100, 50, 400, 400).left, 8);
  assertEquals(cardPlace(395, 100, 100, 50, 400, 400).left, 292);
  assert(cardPlace(-5, 100, 100, 50, 400, 400).off, "point left of the map");
  assert(cardPlace(200, 401, 100, 50, 400, 400).off, "point below the map");
});

Deno.test("focus zone: follows the centre past a hysteresis band, per axis, only when zoomed in on about one zone", () => {
  // A view of `size` centred at (cx, cy), in the coordinates of zone (2,2).
  const at = (cx: number, cy: number, size = ROOM): [number, number, number] => [cx - size / 2, cy - size / 2, size];
  const home: [number, number] = [2, 2];
  const band = (FOCUS_SHARE - 0.5) * ROOM;
  assertEquals(focusZone(at(ROOM / 2, ROOM / 2), home, home), home);
  // Peeking into the east neighbour keeps the zone until that neighbour fills two thirds of the view.
  assertEquals(focusZone(at(ROOM + band - 1, ROOM / 2), home, home), home);
  assertEquals(focusZone(at(ROOM + band + 1, ROOM / 2), home, home), [3, 2]);
  // Coming back needs the same margin the other way, so hovering on the border cannot flicker.
  assertEquals(focusZone(at(ROOM - band + 1, ROOM / 2), home, [3, 2]), [3, 2]);
  assertEquals(focusZone(at(ROOM - band - 1, ROOM / 2), home, [3, 2]), home);
  // Panning east while drifting slightly south changes only the column.
  assertEquals(focusZone(at(ROOM + band + 1, ROOM + band - 1), home, home), [3, 2]);
  assertEquals(focusZone(at(ROOM + band + 1, ROOM + band + 1), home, home), [3, 3]);
  // The band scales with the view, so it is the same share of the screen at any zoom.
  assertEquals(focusZone(at(-17, ROOM / 2, 96), home, home), [1, 2]);
  assertEquals(focusZone(at(-15, ROOM / 2, 96), home, home), home);
  // Zoomed out so no zone can fill two thirds of the view: a survey, which keeps the selection.
  assertEquals(focusZone(at(1.5 * ROOM, 1.5 * ROOM, 1.5 * ROOM + 1), home, home), home);
  assertEquals(focusZone(at(1.5 * ROOM, 1.5 * ROOM, 1.5 * ROOM), home, home), [3, 3]);
  assertEquals(focusZone([-2 * ROOM, -2 * ROOM, 5 * ROOM], home, home), home);
  // The centre is clamped to the world.
  assertEquals(focusZone(at(-ROOM / 2, ROOM / 2), [0, 2], [0, 2]), [0, 2]);
});

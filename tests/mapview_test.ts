import {
  boxArea,
  cardPlace,
  clampView,
  CREATURE_ICONS,
  dragsSheet,
  FOCUS_SHARE,
  focusZone,
  footprintOrder,
  gestureView,
  LOCATE_SIZE,
  locateView,
  mapBounds,
  nearestBox,
  RAFT_ICON,
  revealShift,
  SHEET_TOP,
  sheetHeights,
  sheetSnap,
  stackAt,
  surveying,
  TOUCH_REACH,
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

Deno.test("touch picking: the nearest symbol within reach, inside counting as zero, later boxes winning ties", () => {
  const dot = (x: number, y: number, r = 3) => ({ left: x - r, top: y - r, right: x + r, bottom: y + r });
  const creature = dot(100, 100), loot = dot(130, 100);
  assertEquals(nearestBox([creature, loot], 100, 100, TOUCH_REACH), 0, "a direct hit");
  assertEquals(nearestBox([creature, loot], 112, 108, TOUCH_REACH), 0, "a near miss picks the dot it was meant for");
  assertEquals(nearestBox([creature, loot], 118, 100, TOUCH_REACH), 1, "the closer of two");
  assertEquals(nearestBox([creature, loot], 100, 100 + 3 + TOUCH_REACH + 1, TOUCH_REACH), -1, "out of reach");
  assertEquals(nearestBox([creature, dot(101, 100)], 100, 100, TOUCH_REACH), 1, "overlapping: the one drawn on top");
  assertEquals(nearestBox([], 0, 0, TOUCH_REACH), -1);
});

/** Points along an SVG path (absolute or relative M L H V Q T C S A Z), sampled finely enough to bound it. */
function pathPoints(d: string): [number, number][] {
  const tok = d.match(/[a-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const pts: [number, number][] = [];
  let i = 0, cmd = "", last = "", x = 0, y = 0, sx = 0, sy = 0, kx = 0, ky = 0;
  const n = () => Number(tok[i++]);
  const sample = (f: (t: number) => [number, number]) => {
    for (let k = 1; k <= 32; k++) pts.push(f(k / 32));
  };
  while (i < tok.length) {
    if (/[a-z]/i.test(tok[i])) cmd = tok[i++];
    const C = cmd.toUpperCase(), ox = cmd === C ? 0 : x, oy = cmd === C ? 0 : y;
    let nx = x, ny = y;
    if (C === "Z") {
      [nx, ny] = [sx, sy];
      if (i < tok.length && !/[a-z]/i.test(tok[i])) throw new Error(`number after Z in ${d}`);
    } else if (C === "M" || C === "L") {
      [nx, ny] = [ox + n(), oy + n()];
      if (C === "M") [sx, sy, cmd] = [nx, ny, cmd === "M" ? "L" : "l"];
    } else if (C === "H") nx = ox + n();
    else if (C === "V") ny = oy + n();
    else if (C === "Q" || C === "T") {
      const [ax, ay] = C === "Q" ? [ox + n(), oy + n()] : /[QT]/.test(last) ? [2 * x - kx, 2 * y - ky] : [x, y];
      [nx, ny] = [ox + n(), oy + n()];
      const [x0, y0, x2, y2] = [x, y, nx, ny];
      sample((t) => [(1 - t) ** 2 * x0 + 2 * t * (1 - t) * ax + t * t * x2, (1 - t) ** 2 * y0 + 2 * t * (1 - t) * ay + t * t * y2]);
      [kx, ky] = [ax, ay];
    } else if (C === "C" || C === "S") {
      const [ax, ay] = C === "C" ? [ox + n(), oy + n()] : /[CS]/.test(last) ? [2 * x - kx, 2 * y - ky] : [x, y];
      const [bx, by] = [ox + n(), oy + n()];
      [nx, ny] = [ox + n(), oy + n()];
      const [x0, y0, x3, y3] = [x, y, nx, ny];
      const bez = (p0: number, p1: number, p2: number, p3: number, t: number) =>
        (1 - t) ** 3 * p0 + 3 * t * (1 - t) ** 2 * p1 + 3 * t * t * (1 - t) * p2 + t ** 3 * p3;
      sample((t) => [bez(x0, ax, bx, x3, t), bez(y0, ay, by, y3, t)]);
      [kx, ky] = [bx, by];
    } else if (C === "A") {
      // Endpoint to centre parameterisation, as in the SVG spec's implementation notes.
      let [rx, ry] = [Math.abs(n()), Math.abs(n())];
      const phi = n() * Math.PI / 180, large = n(), sweep = n();
      [nx, ny] = [ox + n(), oy + n()];
      if (rx && ry && (nx !== x || ny !== y)) {
        const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
        const [hx, hy] = [(x - nx) / 2, (y - ny) / 2];
        const [px, py] = [cos * hx + sin * hy, -sin * hx + cos * hy];
        const grow = Math.sqrt(Math.max(1, px * px / (rx * rx) + py * py / (ry * ry)));
        [rx, ry] = [rx * grow, ry * grow];
        const sq = (rx * rx * ry * ry - rx * rx * py * py - ry * ry * px * px) / (rx * rx * py * py + ry * ry * px * px);
        const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, sq));
        const [qx, qy] = [co * rx * py / ry, -co * ry * px / rx];
        const [cx, cy] = [cos * qx - sin * qy + (x + nx) / 2, sin * qx + cos * qy + (y + ny) / 2];
        const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
        const [ux, uy, vx, vy] = [(px - qx) / rx, (py - qy) / ry, (-px - qx) / rx, (-py - qy) / ry];
        const start = angle(1, 0, ux, uy);
        let sweepAngle = angle(ux, uy, vx, vy);
        if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
        if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI;
        sample((t) => {
          const [ex, ey] = [rx * Math.cos(start + sweepAngle * t), ry * Math.sin(start + sweepAngle * t)];
          return [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy];
        });
      }
    } else throw new Error(`unsupported path command ${cmd} in ${d}`);
    pts.push([nx, ny]);
    [last, x, y] = [C, nx, ny];
  }
  return pts;
}

const extent = (pts: [number, number][]) => {
  const [xs, ys] = [pts.map((p) => p[0]), pts.map((p) => p[1])];
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
};

Deno.test("path bounds: lines, curves and arcs are measured along the drawn path", () => {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  const circle = extent(pathPoints("M-3 1 a3 3 0 1 1 6 0 A3 3 0 1 1 -3 1 Z"));
  assert(near(circle.left, -3) && near(circle.right, 3) && near(circle.top, -2) && near(circle.bottom, 4), JSON.stringify(circle));
  const curve = extent(pathPoints("M0 0 Q2 -4 4 0 c0 2 -4 2 -4 0 h1 v-1 L0 0"));
  assert(near(curve.top, -2) && near(curve.bottom, 1.5) && near(curve.right, 4), JSON.stringify(curve));
});

Deno.test("creature icons: bigger than the old dot, inside the 16px symbol box and centred on the creature", () => {
  for (const [name, icon] of Object.entries(CREATURE_ICONS)) {
    const body = extent(pathPoints(icon.body));
    const all = extent([icon.body, icon.detail ?? "", icon.eye ?? ""].flatMap(pathPoints));
    // The outline (0.45px either side) still fits the -8..8 viewBox of legend and list icons.
    assert(Math.max(-all.left, -all.top, all.right, all.bottom) <= 7.5, `${name} fits: ${JSON.stringify(all)}`);
    assert(Math.abs(body.left + body.right) <= 2 && Math.abs(body.top + body.bottom) <= 2, `${name} centred: ${JSON.stringify(body)}`);
    assert(Math.max(body.right - body.left, body.bottom - body.top) >= 10, `${name} is an icon, not a dot`);
  }
});

Deno.test("raft icons: lashed crossbars, deck and paddle fit the shared 16px map, legend and list symbol", () => {
  for (const [part, d] of Object.entries(RAFT_ICON)) {
    const box = extent(pathPoints(d));
    assert(Math.max(-box.left, -box.top, box.right, box.bottom) <= 7.3, `${part} fits with its outline: ${JSON.stringify(box)}`);
  }
  const deck = extent(pathPoints(RAFT_ICON.deck)), bars = extent(pathPoints(RAFT_ICON.bars));
  assert(deck.bottom - deck.top > 12 && deck.right - deck.left > 12);
  assert(bars.bottom - bars.top > 10 && bars.right - bars.left > 13);
});

Deno.test("bottom sheet: half and full heights fit the content and leave the top strip", () => {
  assertEquals(sheetHeights(844), [422, 844 - SHEET_TOP]);
  assertEquals(sheetHeights(844, 300), [300, 300], "short content stays short");
  assertEquals(sheetHeights(844, 600), [422, 600]);
});

Deno.test("bottom sheet: a release settles at the nearest height, a flick goes one step, and dragging low closes", () => {
  const [half, full] = [422, 788];
  assertEquals(sheetSnap(430, 0, half, full, false), "half", "let go near half");
  assertEquals(sheetSnap(700, 0, half, full, false), "full", "dragged most of the way up");
  assertEquals(sheetSnap(200, 0, half, full, false), "closed", "dragged well below half");
  assertEquals(sheetSnap(440, -1, half, full, false), "full", "flicked up");
  assertEquals(sheetSnap(400, 1, half, full, false), "closed", "flicked down from half");
  assertEquals(sheetSnap(700, 1, half, full, true), "half", "flicked down from full: one step");
  assertEquals(sheetSnap(150, 1, half, full, true), "closed", "flicked down from full, already low");
  assertEquals(sheetSnap(300, -1, 300, 300, false), "half", "short content has no full height");
});

Deno.test("bottom sheet: a finger on the content grows the sheet from half height, and pulls it down from the content's top", () => {
  assertEquals(dragsSheet(0, -5, false, 0), true, "up at half: the sheet grows");
  assertEquals(dragsSheet(0, -5, false, 120), true, "up at half, even partway down the content");
  assertEquals(dragsSheet(0, -5, true, 0), false, "up at full: the content scrolls");
  assertEquals(dragsSheet(0, 5, true, 0), true, "down at the content's top: the sheet follows");
  assertEquals(dragsSheet(0, 5, true, 120), false, "down partway down the content: it scrolls back first");
  assertEquals(dragsSheet(0, 5, false, 0), true, "down at half");
  assertEquals(dragsSheet(6, 3, false, 0), false, "sideways");
});

Deno.test("bottom sheet: the map moves only to bring a covered point between the top strip and the sheet", () => {
  // A 400px map at 1000 units: the 100px a sheet covers are 250 units the view may show past the bottom.
  assertEquals(clampView([0, 2000, 1000], [0, 0, ROOM], 400, 400), [0, ROOM - 1000, 1000]);
  assertEquals(clampView([0, 2000, 1000], [0, 0, ROOM], 400, 400, 100), [0, ROOM - 750, 1000]);
  assertEquals(clampView([0, 2000, 1000], [0, 0, ROOM], 400, 400, 1000), [0, 2000, 1000], "as far as asked");
  // Zoomed out on a tall map the bounds already show whole; the covered strip never pulls the view in.
  assertEquals(clampView([0, 0, ROOM], [0, 0, ROOM], 390, 844, 422), clampView([0, 0, ROOM], [0, 0, ROOM], 390, 844));
  assertEquals(clampView([0, -800, ROOM], [0, 0, ROOM], 390, 844, 422), clampView([0, -800, ROOM], [0, 0, ROOM], 390, 844));
  assertEquals(revealShift(300, 56, 400), 0, "already in sight");
  assertEquals(revealShift(700, 56, 400), 228 - 700, "under the sheet: moved up to the middle of the gap");
  assertEquals(revealShift(20, 56, 400), 228 - 20, "under the top strip: moved down");
  assertEquals(revealShift(700, 56, 40), 0, "no room above the sheet");
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

Deno.test("survey: zoomed out past one and a half zones, the view is about none of them (and hides the zone's outline)", () => {
  assert(!surveying(ROOM), "one zone");
  assert(!surveying(1.5 * ROOM), "exactly the share");
  assert(surveying(1.5 * ROOM + 1), "just past it");
  assert(surveying(5 * ROOM), "the whole world");
  // The same line focus zone draws: a survey keeps the selection, however far its centre is into another zone.
  const centred = (size: number): [number, number, number] => [1.5 * ROOM - size / 2, 1.5 * ROOM - size / 2, size];
  for (const size of [ROOM, 1.5 * ROOM, 1.5 * ROOM + 1, 3 * ROOM]) {
    assertEquals(focusZone(centred(size), [2, 2], [2, 2])[0] === 2, surveying(size), `size ${size}`);
  }
});

Deno.test("locate: centres on the player, zoomed in to at most LOCATE_SIZE, above a sheet covering the bottom", () => {
  // From a whole zone (or the world), Locate zooms in to LOCATE_SIZE around them.
  assertEquals(locateView(ROOM, 1000, 1200), [1000 - LOCATE_SIZE / 2, 1200 - LOCATE_SIZE / 2, LOCATE_SIZE]);
  assertEquals(locateView(5 * ROOM, -300, 4000), [-300 - LOCATE_SIZE / 2, 4000 - LOCATE_SIZE / 2, LOCATE_SIZE]);
  // Already closer in: it keeps the zoom and only centres.
  assertEquals(locateView(200, 1000, 1200), [900, 1100, 200]);
  // A sheet covering half the map's shorter side: the player sits in the middle of what is left above it, which is the
  // view a map reports (its y less half the covered share of the size).
  const [x, y, size] = locateView(ROOM, 1000, 1200, 0.5);
  assertEquals([x, y, size], [808, 1104, LOCATE_SIZE]);
  assertEquals(y - 0.5 / 2 * size + size / 2, 1200);
});

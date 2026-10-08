import { assertEquals } from "./assert.ts";
import { arrival, borderSide, estimatePlayer, inferMove } from "../src/estimate.ts";
import { bgr, isLight, type PlayerSave } from "../src/save.ts";
import type { Interior, World, Zone } from "../src/world.ts";

const player = (area: [number, number, number], pos: [number, number], entrance: [number, number] = [8, 8]) =>
  ({ area: { x: area[0], y: area[1], type: area[2] }, pos, entrance }) as PlayerSave;

// Zone B,1 (meadow, type 1) has a cave entrance: interact point 1000,1000 and arrival spot 1280,1400 inside.
const cave: Interior = {
  zone: [1, 0],
  at: [1000, 1000],
  dir: "[ 1,0,1000,1000 ]/",
  kind: 10,
  parent: null,
  sealed: false,
  solids: [{ sprite: "spr_stairs_natural32x32", pic: 0, index: 0, x: 1256, y: 1376, transPoint: [1, 1280, 1384, 1000, 984, -200] }],
};
const zone = (x: number, y: number): Zone => ({
  x,
  y,
  type: 1,
  name: "",
  explored: true,
  lastVisit: null,
  solids: x === 1 && y === 0 ? [{ sprite: "spr_cave", pic: 0, index: 0, x: 990, y: 980, transPoint: [10, 1000, 1000, 1280, 1400] }] : [],
});
const world = (p: PlayerSave) =>
  ({ player: p, zones: [0, 1, 2, 3, 4].map((y) => [0, 1, 2, 3, 4].map((x) => zone(x, y))), interiors: [cave] }) as unknown as World;

Deno.test("border thresholds and arrival spots follow UI_Draw_64 and manager_area Alarm_2", () => {
  assertEquals(borderSide(16, 1000)?.[0], "west");
  assertEquals(borderSide(17, 1000), undefined);
  assertEquals(borderSide(2552, 30)?.[0], "east"); // x is checked before y
  assertEquals(borderSide(1000, 40)?.[0], "north");
  assertEquals(borderSide(1000, 2520)?.[0], "south");
  assertEquals(arrival(2552, 900, borderSide(2552, 900)!), [8, 900]);
  assertEquals(arrival(8, 900, borderSide(8, 900)!), [2552, 900]);
  assertEquals(arrival(600, 2520, borderSide(600, 2520)!), [600, 56]);
  assertEquals(arrival(600, 40, borderSide(600, 40)!), [600, 2552]);
});

Deno.test("a save at a border moves the estimate to the neighbouring zone", () => {
  const e = inferMove(world(player([1, 0, 1], [2552, 900])), player([1, 0, 1], [2552, 900]));
  assertEquals(e && { zone: e.zone, pos: e.pos, inside: e.inside }, { zone: [2, 0], pos: [8, 900], inside: false });
  // No zone north of row 1.
  assertEquals(inferMove(world(player([1, 0, 1], [900, 24])), player([1, 0, 1], [900, 24])), null);
  // Away from borders and doors: no estimate.
  assertEquals(inferMove(world(player([1, 0, 1], [600, 600])), player([1, 0, 1], [600, 600])), null);
});

Deno.test("a save beside an entrance or way out crosses it", () => {
  const p = player([1, 0, 1], [1000, 1016]);
  const inside = inferMove(world(p), p);
  assertEquals(inside?.interior, cave);
  assertEquals(inside?.pos, [1280, 1400]);
  const q = player([1, 0, 10], [1280, 1400], [1000, 1000]);
  const out = inferMove(world(q), q);
  assertEquals(out && { zone: out.zone, pos: out.pos, inside: out.inside }, { zone: [1, 0], pos: [1000, 1000], inside: false });
});

Deno.test("the game's arrival save after a predicted move is not treated as another departure", () => {
  const before = player([1, 0, 1], [2552, 900]);
  const arrived = player([2, 0, 1], [8, 900]);
  assertEquals(estimatePlayer(world(arrived), before), null);
  // Without the previous snapshot an exact arrival spot is trusted as saved.
  assertEquals(estimatePlayer(world(arrived)), null);
});

Deno.test("hairBlend is a BGR colour", () => {
  assertEquals(bgr(4011322), "rgb(58,53,61)");
  assertEquals(isLight(4011322), false);
  assertEquals(isLight(0x80c0ff), true); // rgb(255,192,128) blonde-ish
  assertEquals(isLight(0x000080), false); // dark red
});

Deno.test("the save made on first entering a quest room is not read as leaving it", () => {
  const hideout: Interior = {
    ...cave,
    kind: 31,
    solids: [{ sprite: "spr_placed_16x16", pic: 5, index: 0, x: 1192, y: 1224, transPoint: [1, 1192, 1224, 1000, 984] }],
  };
  const w = (p: PlayerSave) => ({ ...world(p), interiors: [hideout] }) as unknown as World;
  const arrived = player([1, 0, 31], [1192, 1208], [1000, 1000]);
  assertEquals(inferMove(w(arrived), arrived), null);
  const leaving = player([1, 0, 31], [1208, 1224], [1000, 1000]);
  assertEquals(inferMove(w(leaving), leaving)?.pos, [1000, 1000]);
});

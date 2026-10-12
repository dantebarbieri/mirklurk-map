import { assertEquals } from "./assert.ts";
import type { PlayerSave } from "../src/save.ts";
import { questZone, type World, type Zone } from "../src/world.ts";

const zone = (x: number, y: number) => ({ x, y }) as Zone;
const world = (p: Partial<PlayerSave>) =>
  ({ player: p, zones: [0, 1, 2, 3, 4].map((y) => [0, 1, 2, 3, 4].map((x) => zone(x, y))) }) as unknown as World;

Deno.test("quest zones are where Player.save fixes them: [x, y] in rangerCamp, libraryArea and riftQuestArea", () => {
  const w = world({ rangerCamp: [1, 2], libraryArea: [4, 0], riftQuestArea: null });
  assertEquals([questZone(w, "bhato"), questZone(w, "library"), questZone(w, "scaal")], [zone(1, 2), zone(4, 0), undefined]);
  assertEquals(questZone(world({ rangerCamp: [7, 1] }), "bhato"), undefined, "off the grid");
});

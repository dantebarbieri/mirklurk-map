import { assertEquals } from "./assert.ts";
import { riftRadius } from "../src/objects.ts";

Deno.test("rift poison radius follows its sprite", () => {
  assertEquals(riftRadius("spr_rift_32x32"), 192);
  assertEquals(riftRadius("spr_rift_16x16"), 60);
  assertEquals(riftRadius("spr_rift_32x32_dead"), 0);
  assertEquals(riftRadius("spr_rift_16x16_dead"), 0);
});

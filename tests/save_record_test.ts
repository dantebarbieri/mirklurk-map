import { assert, assertEquals, assertThrows } from "./assert.ts";
import { isRec, playerRecord } from "../src/save-record.ts";

Deno.test("save records distinguish objects from missing values, arrays and primitives", () => {
  assert(isRec({}));
  assert(isRec({ futureField: { preserved: true } }));
  for (const invalid of [undefined, null, [], 0, -4, true, "record"]) assert(!isRec(invalid));
});

Deno.test("the player record is the original last record, never an earlier fallback", () => {
  const first = { level: 1 };
  const last = { level: 2, futureField: { preserved: true } };
  assert(playerRecord([first, last]) === last);
  playerRecord([first, last]).level = 3;
  assertEquals(last, { level: 3, futureField: { preserved: true } });
  assertEquals(first, { level: 1 });
  for (const invalid of [undefined, null, {}, [], [first, null], [first, []], [first, -4], [first, "record"]]) {
    assertThrows(() => playerRecord(invalid), /Player.save has no player record/);
  }
});

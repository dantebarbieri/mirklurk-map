import { assert, assertEquals, assertThrows } from "./assert.ts";
import { isRec, playerRecord, recordList } from "../src/save-record.ts";

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

Deno.test("optional record lists preserve valid records and report malformed data", () => {
  assertEquals(recordList(undefined), []);
  assertEquals(recordList([]), []);
  const records = [{ x: 24, y: 40, extra: { preserved: true } }];
  assert(recordList(records) === records);
  assert(recordList(records)[0] === records[0]);
  for (const invalid of [null, {}, 0, "records", [null], [[]], [0], [false], ["record"], [{}, null]]) {
    assertThrows(() => recordList(invalid), /Invalid saved record list/);
  }
});

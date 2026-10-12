import { assert, assertEquals } from "./assert.ts";
import { clamp01, finite, isRec, num } from "../src/values.ts";

Deno.test("isRec: JSON objects only, not null or arrays", () => {
  assert(isRec({}) && isRec({ a: 1 }));
  for (const v of [null, undefined, [], [{}], 1, "x", true]) assert(!isRec(v), `${JSON.stringify(v)} is not a record`);
});

Deno.test("finite and num: NaN, infinities and other types fall back", () => {
  assert(finite(0) && finite(-1.5));
  for (const v of [NaN, Infinity, -Infinity, "1", null, undefined]) assert(!finite(v), `${String(v)} is not finite`);
  assertEquals([num(2.5), num("2"), num(NaN), num(undefined, -4), num(Infinity, 1)], [2.5, 0, 0, -4, 1]);
});

Deno.test("clamp01 keeps values within 0–1", () => {
  assertEquals([clamp01(-0.5), clamp01(0), clamp01(0.25), clamp01(1), clamp01(1.5)], [0, 0, 0.25, 1, 1]);
});

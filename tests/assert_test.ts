import { assert, assertAlmost, assertEquals } from "./assert.ts";

function fails(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    if (e instanceof Error) return e;
    throw new Error("Assertion threw a non-Error value");
  }
  throw new Error("Assertion incorrectly accepted the values");
}

Deno.test("assertEquals compares values without JSON's lossy coercions or key ordering", () => {
  assertEquals({ a: 1, b: [undefined, 2n] }, { b: [undefined, 2n], a: 1 });
  assertEquals(NaN, NaN);
  assertEquals(Infinity, Infinity);
  assertEquals(undefined, undefined);
  const different: [unknown, unknown][] = [
    [NaN, null],
    [Infinity, null],
    [Infinity, -Infinity],
    [0, -0],
    [undefined, null],
    [[undefined], [null]],
    [{ absent: undefined }, {}],
    [Array(1), [undefined]],
    [[], {}],
    [1, "1"],
    [1n, 2n],
    [Symbol("same"), Symbol("same")],
    [() => 1, () => 1],
    [{ value: 1 }, { value: 2 }],
    [{ a: 1 }, { b: 1 }],
    [Object.create(null), {}],
  ];
  for (const [actual, expected] of different) fails(() => assertEquals(actual, expected));
  const key = Symbol("key");
  assertEquals({ [key]: 1 }, { [key]: 1 });
  fails(() => assertEquals({ [key]: 1 }, { [key]: 2 }));
  assert(fails(() => assertEquals(NaN, 1, "value")).message.includes("value: expected 1, got NaN"));
});

Deno.test("assertEquals compares binary views, dates, maps and sets by their contents", () => {
  assertEquals(new Uint8Array([1, 2]), new Uint8Array([0, 1, 2]).subarray(1));
  assertEquals(new Uint8Array([1, 2]).buffer, new Uint8Array([1, 2]).buffer);
  assertEquals(new DataView(new Uint8Array([1, 2]).buffer), new DataView(new Uint8Array([1, 2]).buffer));
  assertEquals(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
  assertEquals(/same/gi, /same/gi);
  assertEquals(new Map([[{ id: 1 }, "one"], [{ id: 2 }, "two"]]), new Map([[{ id: 2 }, "two"], [{ id: 1 }, "one"]]));
  assertEquals(new Set([{ id: 1 }, { id: 2 }]), new Set([{ id: 2 }, { id: 1 }]));
  const different: [unknown, unknown][] = [
    [new Uint8Array([1]), new Uint8Array([2])],
    [new Uint8Array([1]), new Uint8Array([1, 2])],
    [new Uint8Array([1]), new Uint16Array([1])],
    [new Uint8Array([1]), { 0: 1 }],
    [new Uint8Array([1]).buffer, new Uint8Array([2]).buffer],
    [new Date(0), new Date(1)],
    [/same/g, /same/i],
    [new Map([[1, 2]]), new Map([[1, 3]])],
    [new Map([[1, 2]]), new Map()],
    [new Set([1]), new Set([2])],
    [new Set([1]), new Set()],
    [new Set([{ id: 1 }, { id: 1 }]), new Set([{ id: 1 }, { id: 2 }])],
    [new URL("https://one.example"), new URL("https://two.example")],
  ];
  for (const [actual, expected] of different) fails(() => assertEquals(actual, expected));
});

Deno.test("assertEquals handles cycles without accepting different cycle shapes", () => {
  const a: { self?: unknown; value: number } = { value: 1 };
  const b: { self?: unknown; value: number } = { value: 1 };
  a.self = a;
  b.self = b;
  assertEquals(a, b);
  b.self = { self: b, value: 1 };
  fails(() => assertEquals(a, b));
  const mapA = new Map<unknown, unknown>(), mapB = new Map<unknown, unknown>();
  mapA.set(mapA, mapA);
  mapB.set(mapB, mapB);
  assertEquals(mapA, mapB);
});

Deno.test("assertAlmost rejects NaN, infinities and invalid tolerances", () => {
  assertAlmost(1, 1, 0);
  assertAlmost(1, 1.25, 0.25);
  for (const value of [NaN, Infinity, -Infinity]) {
    fails(() => assertAlmost(value, 1));
    fails(() => assertAlmost(1, value));
    fails(() => assertAlmost(value, value));
  }
  for (const tolerance of [NaN, Infinity, -1]) fails(() => assertAlmost(1, 1, tolerance));
  assert(fails(() => assertAlmost(1, 2, 0.1, "distance")).message.startsWith("distance:"));
});

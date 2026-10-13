import { assertEquals } from "./assert.ts";
import { pct, plural } from "../src/format.ts";

Deno.test("plural: one, none, many and nouns that add more than an s", () => {
  assertEquals([plural(1, "turn"), plural(0, "turn"), plural(3, "turn")], ["1 turn", "0 turns", "3 turns"]);
  assertEquals([plural(1, "branch", "branches"), plural(2, "branch", "branches")], ["1 branch", "2 branches"]);
});

Deno.test("pct never rounds to a certainty it is not", () => {
  assertEquals(
    [0, 0.004, 0.01, 0.5, 0.994, 0.995, 0.999, 1].map(pct),
    ["0%", "<1%", "1%", "50%", "99%", ">99%", ">99%", "100%"],
  );
});

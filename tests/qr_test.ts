import { qrMatrix } from "../src/qr.ts";
import { assertEquals, assertRejects } from "./assert.ts";

// Reference matrices from an independent encoder (node-qrcode 1.5.4, byte mode, level M, fixed mask), one row per
// base-36 number. Version 7 also covers the version-information blocks.
const references: [string, number, string][] = [
  ["Mirklurk", 2, "18mf3 muyp wr4t wsil wsbh mzi9 18prz 5c0 xfng zu9 5gi6 2fr2 k8x7 5hw 18ncy mxn0 wtfl wr2o wrd4 mtrg 18rki"],
  [
    "z".repeat(110),
    5,
    "cdhtttunz 6cxte06dd 93lz2zsrh 93qe82lwd 92i3qtf19 6cuar8w8x cenaj8hhb 1a07kyrk 6dg0vzqa6 ay1zmwama omsr0elu bl9oomd8d " +
    "bmlfzwj9u 9jwj7q177 56brjwik2 88ccn8qp8 321fm31vt 3783rvw5v 42i8fi6uh 7arpigepp 7s0bw71mh 53hpob2tu bg1aijdxu akbg34r31 " +
    "9cip7cqgi a0fgxus83 bnrhrinjm cboo1uqh8 baon7fiaj 9z9nf1xlv b0ql848kp 8kaevyl9 157yqk5zt 6fw5m8gfm k6precoi 5w08i5al9 " +
    "7k9sbv65u 12ni4sur cdigj8g9e 6cfto4xzw 92u6961vd 92cci3n8x 928pwuw0p 6c2oyobz0 celaucrne",
  ],
];
const parse = (rows: string, size: number) =>
  rows.split(" ").map((row) => {
    let value = 0n;
    for (const digit of row) value = value * 36n + BigInt(parseInt(digit, 36));
    return [...value.toString(2).padStart(size, "0")].map((bit) => bit === "1");
  });

Deno.test("qr: matches an independent encoder module for module", () => {
  for (const [text, mask, rows] of references) {
    const mine = qrMatrix(text, mask);
    assertEquals(mine, parse(rows, mine.length));
  }
});

Deno.test("qr: picks the smallest version, keeps function patterns, and rejects text that does not fit", async () => {
  assertEquals(qrMatrix("https://map.mirklurk.danteb.com/#sync=" + "A".repeat(43)).length, 37);
  const grid = qrMatrix("Mirklurk");
  assertEquals(grid.length, 21);
  for (const [x, y] of [[0, 0], [14, 0], [0, 14]]) {
    assertEquals(grid[y].slice(x, x + 7), [true, true, true, true, true, true, true]);
    assertEquals(grid[y + 1].slice(x, x + 7), [true, false, false, false, false, false, true]);
  }
  assertEquals(grid[13][8], true);
  assertEquals(qrMatrix("y".repeat(213)).length, 57);
  await assertRejects(() => qrMatrix("y".repeat(214)), /too long/);
});

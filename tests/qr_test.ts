import { plan, qrMatrix } from "../src/qr.ts";
import { assertEquals, assertRejects } from "./assert.ts";

const maxKey = "115792089237316195423570985008687907853269984665640564039457584007913129639935"; // 2^256 − 1
// Reference matrices from an independent encoder (node-qrcode 1.5.4, level M, fixed mask, the same segments), one row per base-36
// number. Version 7 also covers the version-information blocks; the sync link mixes alphanumeric, byte and numeric segments.
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
  [
    `HTTPS://MAP.MIRKLURK.DANTEB.COM/#s=${maxKey}`,
    6,
    "3xe0ghr 20jk8ch 2vkn5ul 2vewajh 2vj14rh 207fq69 3xbl6yn 5m39c 2gj3q8n 2zktqdc 1ignkx4 31po7ra 1l5dtlk swogrm 1ci0gb3 xynmyj " +
    "45mvnd 10lsnza 36p07t2 108bjyn 2y0st6d 2nzxrza 2ih22z9 2a8gxco 3k31ji7 c5qfy 3xe282a 20f4bo5 2vr7vu9 2vl4cty 2v99lu3 20aedwq " +
    "3xh65n2",
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

Deno.test("qr: mixes numeric, alphanumeric and byte segments to keep sharing links small", () => {
  const sync = plan(`HTTPS://MAP.MIRKLURK.DANTEB.COM/#s=${maxKey}`);
  assertEquals(sync.version, 4);
  assertEquals(sync.segments, [
    { mode: "alphanumeric", text: "HTTPS://MAP.MIRKLURK.DANTEB.COM/" },
    { mode: "byte", text: "#s=" },
    { mode: "numeric", text: maxKey },
  ]);
  // The same link with a lowercase host, or with a base64url key, needs a larger code.
  assertEquals(plan(`https://map.mirklurk.danteb.com/#s=${maxKey}`).version, 5);
  assertEquals(plan(`HTTPS://MAP.MIRKLURK.DANTEB.COM/#s=${"aB3_".repeat(10)}aB3`).version, 5);
  // A short run between byte characters is cheaper left in the byte segment.
  assertEquals(plan("ab12cd").segments, [{ mode: "byte", text: "ab12cd" }]);
  assertEquals(plan("😀 1").segments, [{ mode: "byte", text: "😀 1" }]);
  assertEquals(plan("").segments, []);
});

Deno.test("qr: picks the smallest version, keeps function patterns, and rejects text that does not fit", async () => {
  const grid = qrMatrix("Mirklurk");
  assertEquals(grid.length, 21);
  for (const [x, y] of [[0, 0], [14, 0], [0, 14]]) {
    assertEquals(grid[y].slice(x, x + 7), [true, true, true, true, true, true, true]);
    assertEquals(grid[y + 1].slice(x, x + 7), [true, false, false, false, false, false, true]);
  }
  assertEquals(grid[13][8], true);
  assertEquals(qrMatrix("y".repeat(213)).length, 57);
  await assertRejects(() => qrMatrix("y".repeat(214)), /too long/);
  assertEquals(qrMatrix("7".repeat(513)).length, 57);
  await assertRejects(() => qrMatrix("7".repeat(514)), /too long/);
});

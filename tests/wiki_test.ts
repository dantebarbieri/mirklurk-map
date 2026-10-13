import art from "../src/wikiart.json" with { type: "json" };
import { BEING_NAMES, ITEM_NAMES } from "../src/gamedata.ts";
import { beingImage, entityWiki, itemImage, placeImage } from "../src/wiki.ts";
import { assert, assertEquals } from "./assert.ts";

Deno.test("wiki art: every bundled picture exists, same-origin and content-hashed, with its recorded size", async () => {
  const images = [art.beings, art.items, art.places].flatMap((group) => Object.values(group));
  assert(images.length > 0, "no wiki pictures bundled");
  for (const image of images) {
    assert(/^assets\/wiki\/[a-z0-9_]+\.[0-9a-f]{10}\.png$/.test(image.file), image.file);
    const bytes = await Deno.readFile(new URL(`../${image.file}`, import.meta.url));
    assertEquals([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], image.file);
    const dv = new DataView(bytes.buffer);
    assertEquals([dv.getUint32(16), dv.getUint32(20)], [image.w, image.h], image.file);
  }
});

Deno.test("wiki art: creatures and NPCs as they look in the world, placed items and quest buildings", () => {
  assertEquals([BEING_NAMES[21], beingImage(21)?.source], ["Toadkin", "Being-21-cropped.png"]);
  assertEquals([BEING_NAMES[8], beingImage(8)?.source], ["Magus Clay", "Being-8-overworld-cropped.png"]);
  // Magus Clay in his realm (0.8.9.9's being 41) has his own boss page and picture on the wiki.
  assertEquals([BEING_NAMES[41], beingImage(41)?.source], ["Magus Clay", "Being-41-cropped.png"]);
  for (const i of [36, 37, 38, 39, 40]) assertEquals(beingImage(i)?.source, `Being-${i}-cropped.png`);
  for (let i = 258; i <= 275; i++) assert(i === 263 || itemImage(i), `item ${i} has a picture`);
  assertEquals(itemImage(171)?.source, "Item-171-cropped.png");
  assertEquals([ITEM_NAMES[108], itemImage(108)?.source], ["Hidden Hollow", "Item-108-cropped.png"]);
  assert(placeImage("Bhato's hideout") && placeImage("Gurb-Gurb's hut") && placeImage("Ihar's shipwreck"));
  assertEquals(beingImage(-1), undefined);
});

Deno.test("wiki links: Magus Clay the NPC and the boss in his realm have separate pages", () => {
  assertEquals(entityWiki("Magus Clay", "Bestiary", 8), "https://mirklurk.wiki/w/Magus_Clay");
  assertEquals(entityWiki("Magus Clay", "Bestiary", 41), "https://mirklurk.wiki/w/Magus_Clay_(boss)");
  assertEquals(entityWiki("Carcass: Magus Clay", "Loot tables", 41), "https://mirklurk.wiki/w/Magus_Clay_(boss)");
  assertEquals(entityWiki("Magus Clay"), "https://mirklurk.wiki/w/Magus_Clay");
});

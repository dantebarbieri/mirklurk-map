import art from "../src/wikiart.json" with { type: "json" };
import { BEING_NAMES, ITEM_NAMES } from "../src/gamedata.ts";
import { beingImage, beingTitle, entityWiki, itemImage, itemTitle, itemWiki, placeImage, wikiUrl } from "../src/wiki.ts";
import { assert, assertEquals } from "./assert.ts";
import { addable } from "../src/editor/items.ts";
import { CHANNELS, hasItem } from "../src/version.ts";

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
  assertEquals([BEING_NAMES[21], beingImage(21)?.source], ["Toadkin", "Toadkin_sprite_(cropped).png"]);
  assertEquals([BEING_NAMES[8], beingImage(8)?.source], ["Magus Clay", "Magus_Clay_sprite_(cropped).png"]);
  // Magus Clay in his realm (0.8.9.9's being 41) has his own boss page and picture on the wiki.
  assertEquals([BEING_NAMES[41], beingImage(41)?.source], ["Magus Clay", "Magus_Clay_(boss)_sprite_(cropped).png"]);
  for (const i of [36, 37, 38, 39, 40, 42, 43, 45, 46]) {
    assertEquals(beingImage(i)?.source, `${BEING_NAMES[i].replaceAll(" ", "_")}_sprite_(cropped).png`);
  }
  // Without an in-world sprite on the wiki, a being falls back to its portrait.
  assertEquals([BEING_NAMES[9], beingImage(9)?.source], ["Dead Unwanted", "Dead_Unwanted_portrait.png"]);
  for (let i = 258; i <= 279; i++) assert(i === 263 || itemImage(i), `item ${i} has a picture`);
  for (let i = 284; i <= 286; i++) assert(itemImage(i), `item ${i} has a picture`);
  // 0.9.1.0's flint, by their wiki pages' titles.
  assertEquals([276, 277].map((i) => [ITEM_NAMES[i], itemImage(i)?.source, itemWiki(ITEM_NAMES[i])]), [
    ["Flint (Large)", "Flint_(Large)_icon_(cropped).png", "https://mirklurk.wiki/w/Flint_(Large)"],
    ["Flint Dagger", "Flint_Dagger_icon_(cropped).png", "https://mirklurk.wiki/w/Flint_Dagger"],
  ]);
  assertEquals(itemImage(171)?.source, "Finish_Raft_sprite_(cropped).png");
  assertEquals([ITEM_NAMES[108], itemImage(108)?.source], ["Hidden Hollow", "Hidden_Hollow_icon_(cropped).png"]);
  assertEquals(
    itemImage(Number(Object.entries(ITEM_NAMES).find(([, n]) => n === "Turnip")![0]))?.source,
    "Turnip_(item)_icon_(cropped).png",
  );
  assertEquals(placeImage("Bhato's hideout")?.source, "Ranger_Bhato_exterior_(cropped).png");
  assert(placeImage("Gurb-Gurb's hut") && placeImage("Ihar's shipwreck"));
  assertEquals(beingImage(-1), undefined);
});

Deno.test("wiki titles: beings and items with a disambiguated page", () => {
  assertEquals([beingTitle("Magus Clay", 8), beingTitle("Magus Clay", 41)], ["Magus Clay", "Magus Clay (boss)"]);
  assertEquals([itemTitle("Turnip"), itemTitle("Iron Dagger")], ["Turnip (item)", "Iron Dagger"]);
});

Deno.test("wiki links: published stable and tester version pages are verified alongside earlier versions", () => {
  for (
    const version of [
      "0.9.1.2",
      "0.9.2.0",
      "0.9.5.0",
      "0.9.5.3",
      "0.9.5.5",
      "0.9.5.6",
      "0.9.6.0",
      "0.9.6.1",
      "0.9.6.2",
      "0.9.6.5",
      "0.9.9.7",
    ]
  ) {
    assertEquals(wikiUrl(`Version ${version}`), `https://mirklurk.wiki/w/Version_${version}`);
  }
});

Deno.test("wiki: 0.9.6.5 entities link to published pages and the four redrawn items use qualified replacements", () => {
  for (const i of [284, 285, 286]) {
    const name = ITEM_NAMES[i];
    assertEquals(itemWiki(name), `https://mirklurk.wiki/w/${name.replaceAll(" ", "_")}`);
    assertEquals(itemImage(i)?.source, `${name.replaceAll(" ", "_")}_icon_(cropped).png`);
  }
  for (const i of [45, 46]) {
    const name = BEING_NAMES[i];
    const url = `https://mirklurk.wiki/w/${name.replaceAll(" ", "_")}`;
    assertEquals(entityWiki(name, "Bestiary", i), url);
    assertEquals(entityWiki(`Carcass: ${name}`, "Loot tables", i), url);
    assertEquals(wikiUrl(`${name} loot`), `${url}_loot`);
  }
  assertEquals(wikiUrl("Webbed treasure"), "https://mirklurk.wiki/w/Webbed_treasure");
  for (const i of [58, 195, 224, 260]) {
    assertEquals(itemImage(i)?.source, `${ITEM_NAMES[i].replaceAll(" ", "_")}_icon_(0.9.6.5,_cropped).png`);
  }
});

Deno.test("wiki: 0.9.5.0 entities have canonical links and pictures", () => {
  for (const i of [0, 278, 279]) {
    const name = ITEM_NAMES[i];
    assertEquals(itemWiki(name), `https://mirklurk.wiki/w/${name.replaceAll(" ", "_")}`);
    assertEquals(itemImage(i)?.source, `${name.replaceAll(" ", "_")}_icon_(cropped).png`);
  }
  assertEquals(wikiUrl("Wood Buckler"), "https://mirklurk.wiki/w/Wood_Buckler");
  for (const i of [42, 43]) {
    const name = BEING_NAMES[i];
    const url = `https://mirklurk.wiki/w/${name.replaceAll(" ", "_")}`;
    assertEquals(entityWiki(name, "Bestiary", i), url);
    assertEquals(entityWiki(`Carcass: ${name}`, "Loot tables", i), url);
    assertEquals(wikiUrl(`${name} loot`), `${url}_loot`);
  }
});

Deno.test("wiki: tester items have canonical cropped pictures without making them available in stable pickers", () => {
  const beta = CHANNELS.beta;
  assert(beta);
  for (const i of [280, 281, 282, 283, 288, 289, 290, 291, 292, 293, 294, 295, 296]) {
    const name = ITEM_NAMES[i];
    assertEquals(itemWiki(name), `https://mirklurk.wiki/w/${name.replaceAll(" ", "_")}`);
    assertEquals(itemImage(i)?.source, `${name.replaceAll(" ", "_")}_icon_(cropped).png`);
    assert(addable(i) && hasItem(beta, i), `tester picker offers ${name}`);
    assert(!hasItem(CHANNELS.latest, i), `stable picker excludes ${name} despite published art`);
  }
});

Deno.test("wiki links: Magus Clay the NPC and the boss in his realm have separate pages", () => {
  assertEquals(entityWiki("Magus Clay", "Bestiary", 8), "https://mirklurk.wiki/w/Magus_Clay");
  assertEquals(entityWiki("Magus Clay", "Bestiary", 41), "https://mirklurk.wiki/w/Magus_Clay_(boss)");
  assertEquals(entityWiki("Carcass: Magus Clay", "Loot tables", 41), "https://mirklurk.wiki/w/Magus_Clay_(boss)");
  assertEquals(entityWiki("Magus Clay"), "https://mirklurk.wiki/w/Magus_Clay");
});

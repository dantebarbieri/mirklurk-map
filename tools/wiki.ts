// Refresh the public title allowlist and the bundled wiki images. No save data or game files are sent to the wiki.
import { BEING_NAMES, ITEM_NAMES } from "../src/gamedata.ts";
import { beingTitle, itemTitle } from "../src/wiki.ts";
import { contentHash, removeTree } from "./shared.ts";

const API = "https://mirklurk.wiki/api.php";

async function query(params: Record<string, string>, list: string, cursor: string) {
  const out: Record<string, unknown>[] = [];
  let next: string | undefined;
  do {
    const url = new URL(API);
    url.search = new URLSearchParams({ action: "query", list, format: "json", ...params, ...(next ? { [cursor]: next } : {}) }).toString();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Wiki returned HTTP ${response.status}`);
    const data = await response.json();
    if (data.error || !Array.isArray(data.query?.[list])) throw new Error(`Invalid wiki ${list} response`);
    out.push(...data.query[list]);
    next = data.continue?.[cursor];
  } while (next);
  return out;
}

const titles: string[] = [];
for (const page of await query({ apnamespace: "0", aplimit: "500" }, "allpages", "apcontinue")) {
  if (typeof page.title !== "string" || typeof page.pageid !== "number") throw new Error("Invalid wiki page");
  titles.push(page.title);
}
if (!titles.includes("Loot tables") || !titles.includes("Bestiary")) throw new Error("Wiki catalog lacks required guide pages");
const verified = new Date().toISOString().slice(0, 10);
await Deno.writeTextFile(
  new URL("../src/wikidata.json", import.meta.url),
  JSON.stringify({ verified, titles: [...new Set(titles)].sort() }, null, 2) + "\n",
);
console.log(`Verified ${titles.length} public wiki titles`);

// Images, named on the wiki by page title: one per creature or NPC (by being index, its in-world sprite before its portrait),
// per item, and per place below (by the page of the NPC who lives there).
const PLACES: Record<string, string> = {
  "Bhato's hideout": "Ranger Bhato",
  "Gurb-Gurb's hut": "Gurb-Gurb",
  "Ihar's shipwreck": "Ihar",
};
const files = new Map<string, string>();
for (const image of await query({ ailimit: "500", aiprop: "url" }, "allimages", "aicontinue")) {
  if (typeof image.name !== "string" || typeof image.url !== "string") throw new Error("Invalid wiki image");
  if (!image.url.startsWith("https://mirklurk.wiki/images/")) throw new Error(`Unexpected image URL ${image.url}`);
  files.set(image.name, image.url);
}
/** The first file the wiki has for page `title`, trying each kind (such as "sprite") cropped and then whole. */
const pick = (title: string, ...kinds: string[]) => {
  const base = title.replaceAll(" ", "_");
  return kinds.flatMap((kind) => [`${base}_${kind}_(cropped).png`, `${base}_${kind}.png`]).find((n) => files.has(n));
};
type Group = "beings" | "items" | "places";
const wanted: [Group, string, string | undefined][] = [];
for (const [i, name] of Object.entries(BEING_NAMES)) wanted.push(["beings", i, pick(beingTitle(name, Number(i)), "sprite", "portrait")]);
for (const [i, name] of Object.entries(ITEM_NAMES)) wanted.push(["items", i, pick(itemTitle(name), "icon", "sprite")]);
for (const [name, title] of Object.entries(PLACES)) wanted.push(["places", name, pick(title, "exterior")]);

const out = new URL("../assets/wiki/", import.meta.url);
await removeTree(out);
await Deno.mkdir(out, { recursive: true });
const art: Record<Group, Record<string, { file: string; w: number; h: number; source: string }>> = { beings: {}, items: {}, places: {} };
for (const [group, key, name] of wanted) {
  if (!name) continue;
  const response = await fetch(files.get(name)!);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 512 * 1024 || ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) {
    throw new Error(`${name} is not a small PNG`);
  }
  const view = new DataView(bytes.buffer);
  const [w, h] = [view.getUint32(16), view.getUint32(20)];
  const file = `${group.slice(0, -1)}_${key.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.${await contentHash(bytes)}.png`;
  await Deno.writeFile(new URL(file, out), bytes);
  art[group][key] = { file: `assets/wiki/${file}`, w, h, source: name };
}
await Deno.writeTextFile(new URL("../src/wikiart.json", import.meta.url), JSON.stringify({ verified, ...art }, null, 2) + "\n");
console.log(Object.entries(art).map(([group, list]) => `${Object.keys(list).length} ${group}`).join(", ") + " images");

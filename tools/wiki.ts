// Refresh the public title allowlist and the bundled wiki images. No save data or game files are sent to the wiki.
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

// Images: one per creature or NPC (by being index, its in-world look first), per item, and per place below.
const PLACES: Record<string, string> = {
  "Bhato's hideout": "Ranger-Bhato-hut-exterior",
  "Gurb-Gurb's hut": "Gurb-Gurb-hollow-exterior",
  "Ihar's shipwreck": "Ihar-shipwreck-exterior",
};
const files = new Map<string, string>();
for (const image of await query({ ailimit: "500", aiprop: "url" }, "allimages", "aicontinue")) {
  if (typeof image.name !== "string" || typeof image.url !== "string") throw new Error("Invalid wiki image");
  if (!image.url.startsWith("https://mirklurk.wiki/images/")) throw new Error(`Unexpected image URL ${image.url}`);
  files.set(image.name, image.url);
}
/** The first of `names` the wiki has. */
const pick = (...names: string[]) => names.find((n) => files.has(n));
const indices = (re: RegExp) => [...new Set([...files.keys()].flatMap((n) => re.exec(n)?.[1] ?? []))].map(Number).sort((a, b) => a - b);
type Group = "beings" | "items" | "places";
const wanted: [Group, string, string | undefined][] = [];
for (const i of indices(/^Being-(\d+)/)) {
  wanted.push(["beings", String(i), pick(...["-overworld-cropped", "-cropped", "-overworld", ""].map((v) => `Being-${i}${v}.png`))]);
}
for (const i of indices(/^Item-(\d+)/)) wanted.push(["items", String(i), pick(`Item-${i}-cropped.png`, `Item-${i}.png`)]);
for (const [name, f] of Object.entries(PLACES)) wanted.push(["places", name, pick(`${f}-cropped.png`, `${f}.png`)]);

const out = new URL("../assets/wiki/", import.meta.url);
await Deno.remove(out, { recursive: true }).catch(() => {});
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
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hash = Array.from(digest.slice(0, 5), (b) => b.toString(16).padStart(2, "0")).join("");
  const file = `${group.slice(0, -1)}_${key.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.${hash}.png`;
  await Deno.writeFile(new URL(file, out), bytes);
  art[group][key] = { file: `assets/wiki/${file}`, w, h, source: name };
}
await Deno.writeTextFile(new URL("../src/wikiart.json", import.meta.url), JSON.stringify({ verified, ...art }, null, 2) + "\n");
console.log(Object.entries(art).map(([group, list]) => `${Object.keys(list).length} ${group}`).join(", ") + " images");

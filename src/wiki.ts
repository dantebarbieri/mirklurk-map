import data from "./wikidata.json" with { type: "json" };
import art from "./wikiart.json" with { type: "json" };

const titles = new Set(data.titles);
export const wikiVerified = data.verified;

/** Never construct an article URL for a title absent from the verified catalog or the upcoming list. */
export function wikiUrl(title: string): string | undefined {
  return titles.has(title) ? `https://mirklurk.wiki/w/${encodeURIComponent(title.replaceAll(" ", "_"))}` : undefined;
}

export function itemWiki(name: string): string | undefined {
  return wikiUrl(name === "Turnip" ? "Turnip (item)" : name);
}

const aliases: Record<string, string> = {
  "Unsearched remains": "Skeletons and corpses",
  "Remains": "Skeletons and corpses",
  "Chest": "Treasure chests",
  "Chest (better loot)": "Treasure chests",
  "Chest (best loot)": "Treasure chests",
  "Supplies": "Dead camp",
  "Camp": "Dead camp",
  "Storage chest": "Loot tables",
  "Dropped items": "Loot tables",
  "Ground loot": "Loot tables",
  "Bookshelf": "Story rewards and finds",
  "Bhato's hideout": "Ranger Bhato",
  "Gurb-Gurb's hut": "Gurb-Gurb",
  "Ihar's shipwreck": "Ihar",
  "Shipwreck": "Ihar",
  "Scaal's lair": "Scaal",
  "Large boulder": "Searching boulders",
  "Boulder": "Searching boulders",
  "Ruins": "Searching ruins",
  "Rock": "Pebbles",
  "Ruin block": "Searching ruins",
  "Turnip": "Turnip (nature)",
};

export function entityWiki(name: string, fallback = "World generation"): string | undefined {
  const title = name.replace(/^Carcass: /, "");
  return wikiUrl(aliases[title] ?? title) ?? wikiUrl(fallback);
}

/** A picture from the wiki, bundled at development time (`deno task wiki`); the site never loads the wiki itself. */
export interface WikiImage {
  /** Same-origin path, content-hashed. */
  file: string;
  w: number;
  h: number;
  /** The wiki file it was taken from. */
  source: string;
}

const image = (group: Record<string, WikiImage>, key: string | number): WikiImage | undefined => group[String(key)];
/** A creature or NPC by being index: NPCs as they look in the world rather than their portrait. */
export const beingImage = (index: number) => image(art.beings, index);
export const itemImage = (index: number) => image(art.items, index);
/** Quest buildings by map name, such as "Bhato's hideout". */
export const placeImage = (name: string) => image(art.places, name);

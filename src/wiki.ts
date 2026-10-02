import data from "./wikidata.json" with { type: "json" };

const titles = new Set(data.titles);
export const wikiVerified = data.verified;

/** Never construct an article URL for a title absent from the verified catalog. */
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

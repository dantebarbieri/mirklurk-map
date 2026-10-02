// Refresh the public title allowlist. No save data or game files are sent to the wiki.
const titles: string[] = [];
let next: string | undefined;
do {
  const url = new URL("https://mirklurk.wiki/api.php");
  url.search = new URLSearchParams({
    action: "query",
    list: "allpages",
    apnamespace: "0",
    aplimit: "500",
    format: "json",
    ...(next ? { apcontinue: next } : {}),
  }).toString();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Wiki returned HTTP ${response.status}`);
  const data = await response.json();
  if (data.error || !Array.isArray(data.query?.allpages)) throw new Error("Invalid wiki title response");
  for (const page of data.query.allpages) {
    if (typeof page.title !== "string" || typeof page.pageid !== "number") throw new Error("Invalid wiki page");
    titles.push(page.title);
  }
  next = data.continue?.apcontinue;
} while (next);
if (!titles.includes("Loot tables") || !titles.includes("Bestiary")) throw new Error("Wiki catalog lacks required guide pages");
await Deno.writeTextFile(
  new URL("../src/wikidata.json", import.meta.url),
  JSON.stringify({ verified: new Date().toISOString().slice(0, 10), titles: [...new Set(titles)].sort() }, null, 2) + "\n",
);
console.log(`Verified ${titles.length} public wiki titles`);

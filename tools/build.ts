// Builds the static site into dist/: index.html, one hashed script and stylesheet, the bundled art, the web app manifest and icons,
// and sw.js, the service worker that keeps all of it for offline use.

import art from "../src/artdata.json" with { type: "json" };
import wikiArt from "../src/wikiart.json" with { type: "json" };

const root = new URL("../", import.meta.url);
const dist = new URL("dist/", root);

async function bundle(entry: string): Promise<Uint8Array> {
  const { success, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
    args: ["bundle", "--platform", "browser", "--minify", entry],
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!success) {
    console.error(new TextDecoder().decode(stderr));
    Deno.exit(1);
  }
  return stdout;
}

async function hash(bytes: Uint8Array) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(d.slice(0, 5), (b) => b.toString(16).padStart(2, "0")).join("");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

await Deno.remove(dist, { recursive: true }).catch(() => {});
await Deno.mkdir(dist, { recursive: true });
await Deno.mkdir(new URL("assets/game/", dist), { recursive: true });
await Deno.mkdir(new URL("assets/wiki/", dist), { recursive: true });
await Deno.mkdir(new URL("icons/", dist), { recursive: true });
const artFiles = new Set([
  ...[...Object.values(art.tilesets), ...Object.values(art.sprites)].map((asset) => asset.file),
  ...[wikiArt.beings, wikiArt.items, wikiArt.places].flatMap((group) => Object.values(group).map((image) => image.file)),
]);
const icons = [...Deno.readDirSync(new URL("icons/", root))].filter((e) => e.isFile && /\.(png|svg)$/.test(e.name)).map((e) =>
  `icons/${e.name}`
).sort();
for (const file of [...artFiles, ...icons, "manifest.webmanifest"]) {
  await Deno.copyFile(new URL(file, root), new URL(file, dist));
}

const js = await bundle("src/main.ts");
const css = await Deno.readFile(new URL("style.css", root));
const jsName = `app.${await hash(js)}.js`;
const cssName = `style.${await hash(css)}.css`;
await Deno.writeFile(new URL(jsName, dist), js);
await Deno.writeFile(new URL(cssName, dist), css);
const html = (await Deno.readTextFile(new URL("index.html", root)))
  .replace('href="style.css"', `href="${cssName}"`)
  .replace('src="app.js"', `src="${jsName}"`);
await Deno.writeTextFile(new URL("index.html", dist), html);

// "" is the page itself. Hashed names change with their content; the rest is part of the version so any change installs a new worker.
const files = ["", jsName, cssName, "manifest.webmanifest", ...icons, ...[...artFiles].sort()];
const worker = await bundle("src/sw.ts");
const unhashed = await Promise.all(["manifest.webmanifest", ...icons].map((file) => Deno.readFile(new URL(file, dist))));
const encoder = new TextEncoder();
const version = await hash(concat(encoder.encode(html + JSON.stringify(files)), worker, ...unhashed));
await Deno.writeFile(
  new URL("sw.js", dist),
  concat(encoder.encode(`const MIRKMAP_BUILD=${JSON.stringify({ version, files })};\n`), worker),
);
console.log(`dist/: index.html, ${jsName} (${(js.length / 1024).toFixed(1)} KiB), ${cssName}, sw.js (${files.length} files kept offline)`);

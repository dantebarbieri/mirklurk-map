// Builds the static site into dist/: the map (index.html) and the save editor (edit/index.html), each with one hashed script and
// stylesheet, the bundled art, the web app manifest and icons, and sw.js, the service worker that keeps all of it for offline use.

import art from "../src/artdata.json" with { type: "json" };
import wikiArt from "../src/wikiart.json" with { type: "json" };
import { bundle, concat, contentHash, removeTree, root } from "./shared.ts";

const dist = new URL("dist/", root);

/** `entry` bundled and minified; a compile error stops the build. */
async function minified(entry: string): Promise<Uint8Array> {
  try {
    return await bundle(entry, "--minify");
  } catch (e) {
    console.error((e as Error).message);
    Deno.exit(1);
  }
}

await removeTree(dist);
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

const js = await minified("src/main.ts");
const css = await Deno.readFile(new URL("style.css", root));
const jsName = `app.${await contentHash(js)}.js`;
const cssName = `style.${await contentHash(css)}.css`;
await Deno.writeFile(new URL(jsName, dist), js);
await Deno.writeFile(new URL(cssName, dist), css);
/** A page with its asset names swapped for the hashed ones; every name must be found. */
async function page(source: string, names: Record<string, string>): Promise<string> {
  let text = await Deno.readTextFile(new URL(source, root));
  for (const [from, to] of Object.entries(names)) {
    if (!text.includes(from)) throw new Error(`${source} does not contain ${from}`);
    text = text.replace(from, to);
  }
  return text;
}
const html = await page("index.html", { 'href="style.css"': `href="${cssName}"`, 'src="app.js"': `src="${jsName}"` });
await Deno.writeTextFile(new URL("index.html", dist), html);

// The save editor at edit/: its own script and stylesheet on top of the map's (edit.html sets <base href="../">).
const editJs = await minified("src/editor/main.ts");
const editCss = await Deno.readFile(new URL("editor.css", root));
const editJsName = `edit.${await contentHash(editJs)}.js`;
const editCssName = `editor.${await contentHash(editCss)}.css`;
await Deno.writeFile(new URL(editJsName, dist), editJs);
await Deno.writeFile(new URL(editCssName, dist), editCss);
await Deno.mkdir(new URL("edit/", dist), { recursive: true });
const editHtml = await page("edit.html", {
  'href="style.css"': `href="${cssName}"`,
  'href="editor.css"': `href="${editCssName}"`,
  'src="edit.js"': `src="${editJsName}"`,
});
await Deno.writeTextFile(new URL("edit/index.html", dist), editHtml);

// "" and "edit/" are the pages. Hashed names change with their content; the rest is part of the version so any change installs a new worker.
const files = ["", "edit/", jsName, cssName, editJsName, editCssName, "manifest.webmanifest", ...icons, ...[...artFiles].sort()];
const worker = await minified("src/sw.ts");
const unhashed = await Promise.all(["manifest.webmanifest", ...icons].map((file) => Deno.readFile(new URL(file, dist))));
const encoder = new TextEncoder();
const version = await contentHash(concat(encoder.encode(html + editHtml + JSON.stringify(files)), worker, ...unhashed));
await Deno.writeFile(
  new URL("sw.js", dist),
  concat(encoder.encode(`const MIRKMAP_BUILD=${JSON.stringify({ version, files })};\n`), worker),
);
console.log(
  `dist/: index.html, ${jsName} (${(js.length / 1024).toFixed(1)} KiB), ${cssName}, edit/index.html, ${editJsName} ` +
    `(${(editJs.length / 1024).toFixed(1)} KiB), ${editCssName}, sw.js (${files.length} files kept offline)`,
);

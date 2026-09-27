// Builds the static site into dist/: one hashed script, one hashed stylesheet and index.html.

const root = new URL("../", import.meta.url);
const dist = new URL("dist/", root);

async function bundle(): Promise<Uint8Array> {
  const { success, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
    args: ["bundle", "--platform", "browser", "--minify", "src/main.ts"],
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

await Deno.remove(dist, { recursive: true }).catch(() => {});
await Deno.mkdir(dist, { recursive: true });

const js = await bundle();
const css = await Deno.readFile(new URL("style.css", root));
const jsName = `app.${await hash(js)}.js`;
const cssName = `style.${await hash(css)}.css`;
await Deno.writeFile(new URL(jsName, dist), js);
await Deno.writeFile(new URL(cssName, dist), css);
const html = (await Deno.readTextFile(new URL("index.html", root)))
  .replace('href="style.css"', `href="${cssName}"`)
  .replace('src="app.js"', `src="${jsName}"`);
await Deno.writeTextFile(new URL("index.html", dist), html);
console.log(`dist/: index.html, ${jsName} (${(js.length / 1024).toFixed(1)} KiB), ${cssName}`);

// Local dev server on 127.0.0.1: bundles on each page load, and can serve your own saves
// read-only at /__saves/<Character>/ so that /?dev=<Character> loads one without picking it. The save editor is at /edit/.
//   deno task dev            (saves default to ../Saves, override with MIRKLURK_SAVES)

import { UploadStore } from "../server/uploads.ts";
import { bundle, root } from "./shared.ts";

const uploads = Deno.env.get("ENABLE_UPLOADS") === "true" ? new UploadStore(".uploads") : undefined;
if (uploads) {
  await uploads.init();
  setInterval(() => uploads.cleanup().catch((e) => console.error("Upload cleanup failed", e)), 60_000);
}
const saves = Deno.env.get("MIRKLURK_SAVES") ??
  decodeURIComponent(new URL("../Saves/", root).pathname).replace(/^\/([A-Za-z]:)/, "$1").replace(/\/$/, "");
const port = Number(Deno.env.get("PORT") ?? 8123);

/** `entry` bundled with a source map; a compile error is logged in the browser's console instead. */
async function script(entry: string): Promise<Response> {
  try {
    const js = await bundle(entry, "--sourcemap=inline");
    return new Response(js as BodyInit, { headers: { "content-type": "text/javascript", "cache-control": "no-store" } });
  } catch (e) {
    const msg = (e as Error).message;
    console.error(msg);
    return new Response(`console.error(${JSON.stringify(msg)})`, { headers: { "content-type": "text/javascript" } });
  }
}

async function listDir(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (e.isDirectory) out.push(...await listDir(`${dir}/${e.name}`, `${prefix}${e.name}/`));
    else if (e.isFile) out.push(prefix + e.name);
  }
  return out;
}

const types: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css",
  png: "image/png",
  svg: "image/svg+xml",
  webmanifest: "application/manifest+json",
};

Deno.serve({ hostname: "127.0.0.1", port }, async (req, info) => {
  const path = decodeURIComponent(new URL(req.url).pathname);
  if (path.startsWith("/api/")) {
    return uploads
      ? uploads.handle(req, info.remoteAddr.hostname)
      : Response.json({ error: "Uploads are disabled; set ENABLE_UPLOADS=true to enable local sharing" }, { status: 503 });
  }
  try {
    if (path === "/app.js") return await script("src/main.ts");
    if (path === "/edit.js") return await script("src/editor/main.ts");
    if (/^\/assets\/(game|wiki)\/[a-z0-9_.]+\.png$/.test(path)) {
      return new Response(await Deno.readFile(new URL(path.slice(1), root)), {
        headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable" },
      });
    }
    if (
      path === "/" || path === "/index.html" || path === "/edit" || path === "/edit/" || path === "/style.css" ||
      path === "/editor.css" || path === "/manifest.webmanifest" || /^\/icons\/[a-z0-9-]+\.(png|svg)$/.test(path)
    ) {
      const file = path === "/" ? "index.html" : path.startsWith("/edit") && !path.endsWith(".css") ? "edit.html" : path.slice(1);
      return new Response(await Deno.readFile(new URL(file, root)), {
        headers: { "content-type": types[file.split(".").pop()!], "cache-control": "no-store" },
      });
    }
    const m = /^\/__saves\/([^/]+)\/(.*)$/.exec(path);
    // The path is decoded, so "..\" counts as a step up too (Windows takes either separator).
    if (m && !m[1].includes("..") && !m[2].split(/[\\/]/).includes("..")) {
      const dir = `${saves}/${m[1]}`;
      if (m[2] === "") return Response.json(await listDir(dir));
      return new Response(await Deno.readFile(`${dir}/${m[2]}`), {
        headers: { "content-type": types[m[2].split(".").pop()!] ?? "application/octet-stream" },
      });
    }
  } catch (e) {
    return new Response(String(e), { status: 404 });
  }
  return new Response("not found", { status: 404 });
});
console.log(`http://127.0.0.1:${port}/  (saves: ${saves})`);

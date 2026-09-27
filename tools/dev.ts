// Local dev server on 127.0.0.1: bundles on each page load, and can serve your own saves
// read-only at /__saves/<Character>/ so that /?dev=<Character> loads one without picking it.
//   deno task dev            (saves default to ../Saves, override with MIRKLURK_SAVES)

const root = new URL("../", import.meta.url);
const saves = Deno.env.get("MIRKLURK_SAVES") ??
  decodeURIComponent(new URL("../Saves/", root).pathname).replace(/^\/([A-Za-z]:)/, "$1").replace(/\/$/, "");
const port = Number(Deno.env.get("PORT") ?? 8123);

async function bundle(): Promise<Response> {
  const { success, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
    args: ["bundle", "--platform", "browser", "--sourcemap=inline", "src/main.ts"],
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!success) {
    const msg = new TextDecoder().decode(stderr);
    console.error(msg);
    return new Response(`console.error(${JSON.stringify(msg)})`, { headers: { "content-type": "text/javascript" } });
  }
  return new Response(stdout as BodyInit, { headers: { "content-type": "text/javascript", "cache-control": "no-store" } });
}

async function listDir(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (e.isDirectory) out.push(...await listDir(`${dir}/${e.name}`, `${prefix}${e.name}/`));
    else if (e.isFile) out.push(prefix + e.name);
  }
  return out;
}

const types: Record<string, string> = { html: "text/html; charset=utf-8", css: "text/css", png: "image/png" };

Deno.serve({ hostname: "127.0.0.1", port }, async (req) => {
  const path = decodeURIComponent(new URL(req.url).pathname);
  try {
    if (path === "/app.js") return await bundle();
    if (path === "/" || path === "/index.html" || path === "/style.css") {
      const file = path === "/style.css" ? "style.css" : "index.html";
      return new Response(await Deno.readFile(new URL(file, root)), {
        headers: { "content-type": types[file.split(".")[1]], "cache-control": "no-store" },
      });
    }
    const m = /^\/__saves\/([^/]+)\/(.*)$/.exec(path);
    if (m && !m[2].split("/").includes("..") && !m[1].includes("..")) {
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

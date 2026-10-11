import { IMMUTABLE, route } from "../src/offline.ts";
import { assert, assertEquals } from "./assert.ts";

Deno.test("offline: pages try the network first, kept files come from the cache, and the sharing API is never touched", () => {
  const scope = new URL("https://map.example/");
  const kept = new Set(["", "app.0123abcd.js", "icons/favicon.svg", "assets/game/ts_grass.4e020da481.png"]);
  const at = (path: string, mode = "cors", method = "GET") => route(new URL(path, scope), scope, mode, method, kept);
  assertEquals(at("/", "navigate"), "page");
  assertEquals(at("/?dev=Hero&zone=C2", "navigate"), "page");
  assertEquals(at("/index.html", "navigate"), "page");
  assertEquals(at("/app.0123abcd.js"), "cache");
  assertEquals(at("/icons/favicon.svg", "no-cors"), "cache");
  assertEquals(at("/assets/game/ts_grass.4e020da481.png", "no-cors"), "cache");
  assertEquals(at("/app.ffffffffff.js"), undefined);
  assertEquals(at("/app.0123abcd.js?x=1"), undefined);
  assertEquals(at("/icons/favicon.svg", "cors", "POST"), undefined);
  for (const path of ["/api", "/api/library", "/api/view/data", "/api/pair", "/api/library/pair"]) {
    assertEquals(at(path), undefined);
    assertEquals(at(path, "navigate"), undefined);
  }
  assertEquals(route(new URL("https://mirklurk.wiki/item.png"), scope, "no-cors", "GET", kept), undefined);

  const nested = new URL("https://map.example/map/");
  assertEquals(route(new URL("https://map.example/other/"), nested, "navigate", "GET", kept), undefined);
  assertEquals(route(new URL("https://map.example/map/api/library"), nested, "cors", "GET", kept), undefined);
  assertEquals(route(new URL("https://map.example/map/icons/favicon.svg"), nested, "no-cors", "GET", kept), "cache");
});

Deno.test("offline: only content-hashed files are reused across versions", () => {
  for (
    const file of ["app.41a6f3f2c9.js", "style.a7f04eb7f4.css", "assets/game/ts_grass.4e020da481.png", "assets/wiki/item_89.1b089b316c.png"]
  ) {
    assert(IMMUTABLE.test(file), file);
  }
  for (const file of ["", "index.html", "sw.js", "app.js", "manifest.webmanifest", "icons/favicon.svg", "assets/game/ts_grass.png"]) {
    assert(!IMMUTABLE.test(file), file);
  }
});

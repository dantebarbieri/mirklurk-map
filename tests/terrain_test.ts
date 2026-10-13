import { type Scene, scenery, TerrainStore } from "../src/terrain.ts";
import { loadWorld } from "../src/world.ts";
import { assert, assertEquals } from "./assert.ts";

function world() {
  const bytes = new TextEncoder().encode(JSON.stringify([{ worldGrid: Array.from({ length: 5 }, () => [0, 1, 1, 1, 1]) }]));
  return loadWorld(new Map([["Player.save", { read: () => Promise.resolve(bytes) }]]), "", "Hero");
}

const scene = (dir: string): Scene => ({ dir, kind: 1, solids: [], x: 0, y: 0, label: dir });
const texture = () => ({ levels: [] as HTMLCanvasElement[] });

Deno.test("terrain: disposing aborts active work, drops queued scenes and ignores late results", async () => {
  const first = Promise.withResolvers<ReturnType<typeof texture>>();
  const calls: string[] = [];
  const signals: AbortSignal[] = [];
  let updates = 0;
  const store = new TerrainStore(await world(), (_world, area, signal) => {
    calls.push(area.dir!);
    signals.push(signal);
    return first.promise;
  });
  store.subscribe(() => updates++);
  store.get(scene("first/"), true);
  store.get(scene("queued/"), true);
  assertEquals(calls, ["first/"]);
  store.dispose();
  assert(signals[0].aborted);
  assertEquals(store.get(scene("after-dispose/"), true), undefined);
  first.resolve(texture());
  await first.promise;
  assertEquals(calls, ["first/"]);
  assertEquals(updates, 0);
  assertEquals(store.previews.size, 0);
  assertEquals(store.errors.size, 0);
});

Deno.test("terrain: disabling releases completed caches and a fresh store can render again", async () => {
  const w = await world();
  const area = scene("area/");
  const rendered = texture();
  const store = new TerrainStore(w, () => Promise.resolve(rendered));
  const ready = Promise.withResolvers<void>();
  store.subscribe(() => ready.resolve());
  store.get(area, true);
  await ready.promise;
  assertEquals(store.get(area, true), rendered);
  assertEquals(store.previews.size, 1);
  store.dispose();
  assertEquals(store.previews.size, 0);
  assertEquals(store.get(area, true), undefined);

  const enabled = new TerrainStore(w, () => Promise.resolve(rendered));
  const resumed = Promise.withResolvers<void>();
  enabled.subscribe(() => resumed.resolve());
  enabled.get(area, true);
  await resumed.promise;
  assertEquals(enabled.previews.size, 1);
  enabled.dispose();
});

Deno.test("terrain: cancellation does not report stale render failures", async () => {
  const render = Promise.withResolvers<ReturnType<typeof texture>>();
  const store = new TerrainStore(await world(), () => render.promise);
  store.get(scene("first/"), true);
  store.dispose();
  render.reject(new DOMException("Cancelled", "AbortError"));
  await render.promise.catch(() => {});
  assertEquals(store.errors.size, 0);
});

Deno.test("terrain: the realistic map draws scenery, never carcasses or magic effects", () => {
  const at = { pic: 0, index: -4, status: -200, x: 8, y: 8 };
  const drawn = scenery([{ sprite: "spr_spell_twirl", pic: 0, index: -4, x: 1192, y: 1144, transPoint: [1, 1192, 1144, 600, 744] }], {
    beings: [],
    containers: [{ ...at, sprite: "spr_survivor", status: -216 }, { ...at, sprite: "spr_rat", status: -209 }, {
      ...at,
      sprite: "spr_placed_16x16",
    }],
    stations: [{ ...at, sprite: "spr_placed_16x16", xscale: -1 }],
    interactables: [{ ...at, sprite: "spr_eff_portal_large", object: "obj_eff_light", index: 262 }, { ...at, sprite: "spr_rift_32x32" }],
    decorations: [{ ...at, sprite: "spr_spell_flamey", index: 263 }, { ...at, sprite: "" }],
  });
  assertEquals(drawn.map((d) => d.sprite), ["spr_placed_16x16", "spr_placed_16x16", "spr_rift_32x32"]);
  assertEquals(drawn.map((d) => ("xscale" in d ? d.xscale : undefined)), [undefined, -1, undefined]);
});

import { type Scene, TerrainStore } from "../src/terrain.ts";
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

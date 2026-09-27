// Checks the viewer against real saves when they are available (skipped otherwise):
//   MIRKLURK_SAVES="…\Saves" deno task test      (defaults to ../Saves next to this folder)

import { assert, assertEquals } from "./assert.ts";
import { type FileMap, findCharacters } from "../src/files.ts";
import { landmarks, shipwreckOdds } from "../src/predict.ts";
import { Area, PLACEMENT, reflect } from "../src/rules.ts";
import { loadLayer, loadWorld } from "../src/world.ts";

const dir = Deno.env.get("MIRKLURK_SAVES") ??
  decodeURIComponent(new URL("../../Saves", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const present = (() => {
  try {
    return Deno.statSync(dir).isDirectory;
  } catch {
    return false;
  }
})();

function readTree(root: string, prefix = "Saves/", out: FileMap = new Map()): FileMap {
  for (const e of Deno.readDirSync(root)) {
    const p = `${root}/${e.name}`;
    if (e.isDirectory) readTree(p, `${prefix}${e.name}/`, out);
    else out.set(`${prefix}${e.name}`, { read: () => Deno.readFile(p) });
  }
  return out;
}

Deno.test({ name: "real saves: grid, quest zones and landmarks", ignore: !present }, async () => {
  const files = readTree(dir);
  const chars = findCharacters(files);
  assert(chars.length > 0, "no characters found");
  for (const c of chars) {
    const w = await loadWorld(files, c.root, c.name);
    assertEquals(w.warnings, [], `${c.name} warnings`);
    const fort = w.zones.flat().filter((z) => z.type === Area.Fort);
    assertEquals(fort.length, 1, `${c.name}: one fort`);
    const [fx, fy] = [fort[0].x, fort[0].y];
    assert(fx === 0 || fx === 4, `${c.name}: fort on an edge column`);
    assertEquals(w.player.riftQuestArea, reflect(fx, fy), `${c.name}: Scaal's zone mirrors the fort`);
    const [rx, ry] = w.player.rangerCamp!;
    assertEquals(Math.abs(rx - fx) + Math.abs(ry - fy), 1, `${c.name}: Bhato next to the fort`);
    assertEquals(w.zones[ry][rx].type, Area.CommonBog);

    const ship = new Map<string, number>();
    for (const z of w.zones.flat()) {
      if (z.type !== Area.BrokenFen || !z.dir) continue;
      const [a, b] = [await loadLayer(w, z.dir, "Water1"), await loadLayer(w, z.dir, "Lower")];
      ship.set(`${z.x},${z.y}`, shipwreckOdds(a!.data, b!.data).perEntry);
    }
    const marks = landmarks(w, ship);
    const by = Object.fromEntries(marks.map((m) => [m.id, m]));
    assertEquals(by.fort.status, "found");
    for (const id of ["gurb", "ihar"] as const) {
      const flag = id === "gurb" ? w.player.gurbsHut : w.player.shipWreck;
      assertEquals(by[id].status, flag ? "found" : "candidates", `${c.name} ${id}`);
      if (!flag) {
        const total = by[id].candidates!.reduce((s, x) => s + x.share, 0);
        assert(Math.abs(total - 1) < 1e-9, `${c.name} ${id} shares sum to 1`);
      }
    }
    for (const it of w.interiors) assert(it.kind !== null, `${c.name}: ${it.dir} is linked to an entrance`);

    // Every building the game already placed must sit where our placement rules say it can.
    const rule = {
      bhato: PLACEMENT.hideout,
      library: PLACEMENT.library,
      scaal: PLACEMENT.lair,
      gurb: PLACEMENT.hut,
      ihar: PLACEMENT.shipwreck,
    };
    for (const [id, pl] of Object.entries(rule)) {
      const m = by[id];
      if (m.status !== "found") continue;
      assert(pl.axis.has(m.solid!.x) && pl.axis.has(m.solid!.y), `${c.name} ${id} at ${m.solid!.x},${m.solid!.y} fits its rule`);
      const tp = m.solid!.transPoint!;
      assertEquals([tp[1] - m.solid!.x, tp[2] - m.solid!.y], pl.door, `${c.name} ${id} door offset`);
    }
  }
});

Deno.test({ name: "real saves: placed buildings sit in the zones the save names", ignore: !present }, async () => {
  const files = readTree(dir);
  for (const c of findCharacters(files)) {
    const w = await loadWorld(files, c.root, c.name);
    const m = Object.fromEntries(landmarks(w, new Map()).map((x) => [x.id, x]));
    const p = w.player;
    const saved = { bhato: p.rangerCamp, library: p.libraryArea, scaal: p.riftQuestArea };
    for (const [id, zone] of Object.entries(saved)) {
      if (m[id].status === "found") assertEquals(m[id].zone, zone, `${c.name} ${id}`);
    }
    if (m.gurb.status === "found") assertEquals(w.zones[m.gurb.zone![1]][m.gurb.zone![0]].type, Area.DrownedFen, `${c.name} hut`);
    if (m.ihar.status === "found") {
      const z = w.zones[m.ihar.zone![1]][m.ihar.zone![0]];
      assertEquals(z.type, Area.BrokenFen, `${c.name} shipwreck`);
      const odds = shipwreckOdds((await loadLayer(w, z.dir!, "Water1"))!.data, (await loadLayer(w, z.dir!, "Lower"))!.data);
      assert(odds.perEntry > 0.9, `${c.name}: the Broken Fen holding the shipwreck has shore sites (${odds.perEntry})`);
    }
  }
});

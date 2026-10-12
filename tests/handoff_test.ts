// Handing the open save between MirkMap and the save editor (src/handoff.ts), on an in-memory store in place of IndexedDB and stand-in
// tabs: each tab takes only its own handoff, once; the editor falls back to the save it had open last; leftovers are cleared.

import { assert, assertEquals } from "./assert.ts";
import {
  fileMapOf,
  forget,
  type Handoff,
  handOff,
  type HandoffContext,
  remember,
  storedFiles,
  takeHandoff,
  TRANSFER_TTL,
} from "../src/handoff.ts";
import type { FileMap } from "../src/files.ts";

/** One browser: a store shared by its tabs, and a clock. */
function browser() {
  const records = new Map<string, unknown>();
  let time = 1_800_000_000_000, next = 0;
  return {
    records,
    advance: (ms: number) => time += ms,
    /** A tab of this browser, with its own sessionStorage. */
    tab(): HandoffContext {
      const session = new Map<string, string>();
      return {
        store: { update: (work) => Promise.resolve(work(records)) },
        tab: {
          getItem: (k) => session.get(k) ?? null,
          setItem: (k, v) => void session.set(k, v),
          removeItem: (k) => void session.delete(k),
        },
        now: () => time,
        token: () => `t${++next}`,
      };
    },
  };
}

const world = (id: string): Handoff => ({ save: { kind: "world", id, name: id, library: "lib" } });
const files: Handoff = { save: { kind: "files", files: [] }, character: { name: "Hero", root: "Hero/" } };
const transfers = (records: Map<string, unknown>) => [...records.keys()].filter((k) => k.startsWith("transfer:")).length;

Deno.test("handoff: tabs handing over at the same time each open their own save, and only once", async () => {
  const b = browser();
  const one = b.tab(), two = b.tab();
  await handOff(world("A"), "editor", one);
  await handOff(world("B"), "editor", two);
  assertEquals((await takeHandoff("editor", two))?.handoff, world("B"));
  const first = await takeHandoff("editor", one);
  assertEquals([first?.handoff, first?.handed], [world("A"), true]);
  assertEquals(transfers(b.records), 0, "each is removed once taken");
  assertEquals(await takeHandoff("editor", one), undefined, "a reload does not take it again");
});

Deno.test("handoff: only the page it is for takes it; the map never falls back, the editor reopens its last folder or world", async () => {
  const b = browser();
  const tab = b.tab();
  await remember(world("Last"), tab);
  assertEquals(await takeHandoff("map", tab), undefined, "the map opens nothing on its own");
  assertEquals(await takeHandoff("editor", tab), { handoff: world("Last"), handed: false });

  // Handed to the map, the editor loading instead in this tab ignores it and opens its last save.
  await handOff(world("ToMap"), "map", tab);
  assertEquals((await takeHandoff("editor", tab))?.handoff, world("Last"));
  assertEquals(await takeHandoff("map", tab), undefined, "the flag went with the page that loaded");

  // A copy is handed over, never reopened.
  await handOff(files, "editor", tab);
  assertEquals(await takeHandoff("editor", tab), { handoff: files, handed: true });
  await remember(files, tab);
  assertEquals(await takeHandoff("editor", tab), undefined);
  await remember(world("Last"), tab);
  await forget(tab);
  assertEquals(await takeHandoff("editor", tab), undefined);
});

Deno.test("handoff: handoffs whose page never loaded are cleared after a while; unreadable flags are ignored", async () => {
  const b = browser();
  const closed = b.tab(), other = b.tab();
  await handOff(world("Abandoned"), "editor", closed);
  await handOff(world("Unopened"), "editor", b.tab());
  b.advance(TRANSFER_TTL - 1000);
  await handOff(world("Recent"), "editor", other);
  b.advance(2000);
  assertEquals(await takeHandoff("map", b.tab()), undefined);
  assertEquals(transfers(b.records), 1, "only the recent one stays");
  assertEquals((await takeHandoff("editor", other))?.handoff, world("Recent"));

  const broken = b.tab();
  broken.tab.setItem("mirkmap-handoff", "{");
  assertEquals(await takeHandoff("editor", broken), undefined);
  assertEquals(broken.tab.getItem("mirkmap-handoff"), null);
});

Deno.test("handoff: a copy carries one character's files, read back byte for byte with their times", async () => {
  const bytes = (text: string) => new TextEncoder().encode(text);
  const map: FileMap = new Map([
    ["Saves/Hero/Player.save", { read: () => Promise.resolve(bytes("[1]")), lastModified: 5 }],
    ["Saves/Hero/[ 0,0 ]/Beings.save", { read: () => Promise.resolve(bytes("[]")) }],
    ["Saves/Other/Player.save", { read: () => Promise.resolve(bytes("[2]")), lastModified: 7 }],
  ]);
  const back = fileMapOf(await storedFiles(map, "Saves/Hero/"));
  assertEquals([...back.keys()], ["Saves/Hero/Player.save", "Saves/Hero/[ 0,0 ]/Beings.save"]);
  assertEquals(new TextDecoder().decode(await back.get("Saves/Hero/Player.save")!.read()), "[1]");
  assertEquals([back.get("Saves/Hero/Player.save")!.lastModified, back.get("Saves/Hero/[ 0,0 ]/Beings.save")!.lastModified], [
    5,
    undefined,
  ]);
  assert((await storedFiles(map)).length === 3, "every file when no character is named");
});

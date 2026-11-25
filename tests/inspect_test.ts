import art from "../src/artdata.json" with { type: "json" };
import { entityUrl, markImage, picture } from "../src/inspect.ts";
import { markIcon } from "../src/mapview.ts";
import type { Mark } from "../src/objects.ts";
import { itemImage } from "../src/wiki.ts";
import { creatureView } from "../src/creature.ts";
import { parseHealth } from "../src/health.ts";
import type { GameVersion } from "../src/version.ts";
import { assert, assertEquals } from "./assert.ts";
import { parsePlayer } from "../src/save.ts";
import { skyPanel } from "../src/skyview.ts";

const raft: Mark = { layer: "rafts", kind: "raft", item: 171, name: "Raft", x: 344, y: 744 };

Deno.test("wiki link: Magus Clay in his realm and his carcass link to his boss page, the NPC to his own", () => {
  const boss = "https://mirklurk.wiki/w/Magus_Clay_(boss)";
  const clay: Mark = { layer: "npcs", kind: "magus", name: "Magus Clay", being: 41, x: 10, y: 10 };
  assertEquals(entityUrl(clay), boss);
  assertEquals(entityUrl({ ...clay, layer: "loot", kind: "carcass", name: "Carcass: Magus Clay" }), boss);
  assertEquals(entityUrl({ ...clay, being: 8 }), "https://mirklurk.wiki/w/Magus_Clay");
});

Deno.test("raft picture: finished and ridden rafts use world frame 1, bases keep their wiki picture", async () => {
  const image = markImage(raft);
  assert(image && "frame" in image);
  const strip = art.sprites.spr_placed_16x16_wider;
  assertEquals(image, { ...strip, frame: 1 });
  assertEquals(markImage({ ...raft, kind: "raft yours", detail: "you stand on it" }), image);
  assertEquals(markImage({ ...raft, kind: "raft base", item: 170, name: "Raft Base" }), itemImage(170));
  assert(itemImage(170));
  assertEquals(itemImage(171)?.source, "Finish_Raft_sprite_(cropped).png", "the wiki shows a finished raft as it looks in the world");
  assert(/^assets\/game\/[a-z0-9_]+\.[0-9a-f]{10}\.png$/.test(image.file));
  const bytes = await Deno.readFile(new URL(`../${image.file}`, import.meta.url));
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].slice(0, 5)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  assert(image.file.endsWith(`.${hash}.png`));
  const png = new DataView(bytes.buffer);
  assertEquals([png.getUint32(16), png.getUint32(20)], [image.w * image.frames, image.h]);
  assert(image.frame < image.frames);
});

class ElementStub {
  attrs: Record<string, string> = {};
  children: (ElementStub | string)[] = [];
  style = { cssText: "" };
  classList = { add: (_name: string) => {} };
  constructor(readonly tag: string) {}
  setAttribute(key: string, value: string) {
    this.attrs[key] = value;
  }
  append(child: ElementStub | string) {
    this.children.push(child);
  }
  addEventListener(_type: string, _handler: () => void) {}
  replaceChildren(...children: (ElementStub | string)[]) {
    this.children = children;
  }
  text(): string {
    return this.children.map((c) => typeof c === "string" ? c : c.text()).join("");
  }
}

Deno.test("sky panel: release cave exposure follows selected rules without changing saved time or temperature", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: (tag: string) => new ElementStub(tag),
      createElementNS: (_ns: string, tag: string) => new ElementStub(tag),
    },
  });
  try {
    const p = parsePlayer([{
      VERSION: "0.9.9.7",
      worldGrid: Array.from({ length: 5 }, () => Array(5).fill(1)),
      areaType: 13,
      MDminute: 420,
      MDday: 1,
      MDtemperature: 0.9,
    }]);
    const before = structuredClone(p);
    const text = (rules?: GameVersion) => (skyPanel(p, rules) as unknown as ElementStub).text();
    assert(text().includes("Indoors no rain"), "default follows the actual tester save, not newest rules");
    assert(text("0.9.6.5").includes("Indoors no rain"));
    assert(text("1.0.0.0").includes("Underground the game's dial reads Unknown Time"));
    assert(text("1.0.0.0").includes("no weather reaches you and it is always Cold"));
    assertEquals(p, before, "saved sky and player fields remain authoritative");
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

Deno.test("creature cards use selected Geomancer stats, retain saved health and qualify spider attacks", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: (tag: string) => new ElementStub(tag),
      createElementNS: (_ns: string, tag: string) => new ElementStub(tag),
    },
  });
  try {
    const saved = parseHealth([[2, 1, 1, 1, 1], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1]])!;
    const render = (being: number, rules: GameVersion) =>
      (creatureView(being, saved, { key: "test", rules }) as unknown as ElementStub[]).map((el) => el.text()).join(" ");
    assert(render(16, "0.9.5.6").includes("300 XP"));
    const latest = render(16, "0.9.6.5");
    assert(latest.includes("200 XP") && latest.includes("within 10 tiles"));
    assert(latest.includes("A fresh one has 20 hit points, 20 armor"));
    assertEquals([saved.w, saved.h, saved.cells[0][0].hp], [5, 3, 2], "existing grid stays unchanged");
    for (const i of [45, 46]) {
      const text = render(i, "0.9.6.5");
      assert(text.includes("Blunt") && text.includes("uses Poison"));
      assert(text.includes(`counter reaches ${i === 45 ? 2 : 3}`) && text.includes("per creature turn, not per attack"));
    }
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

Deno.test("raft rendering: distinct shared SVG symbols and a cropped, game-credited world picture", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  const made: ElementStub[] = [];
  const create = (tag: string) => {
    const element = new ElementStub(tag);
    made.push(element);
    return element;
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: create, createElementNS: (_ns: string, tag: string) => create(tag) },
  });
  try {
    const parts = (kind: string) => {
      made.length = 0;
      markIcon(kind);
      assert(made.some((e) => e.tag === "svg" && e.attrs.viewBox === "-8 -8 16 16"));
      return made.filter((e) => e.tag === "path").map((e) => e.attrs.class);
    };
    assertEquals(parts("raft"), ["raft-deck", "raft-bars", "raft-rope", "raft-paddle"]);
    assertEquals(parts("raft yours"), parts("raft"));
    assertEquals(parts("raft base"), ["raft-bars", "raft-rope"]);
    made.length = 0;
    picture(markImage(raft)!, "Raft", "portrait", 112, 88);
    const root = made.find((e) => e.tag === "svg")!;
    assertEquals(root.attrs.viewBox, "24 0 24 24");
    assertEquals([root.attrs.width, root.attrs.height, root.attrs.overflow, root.attrs.role], ["72", "72", "hidden", "img"]);
    assertEquals(root.attrs["aria-label"], "Raft");
    assertEquals(made.find((e) => e.tag === "title")?.children, ["Raft (picture from the game; art by Edym Pixels)"]);
    assertEquals(made.find((e) => e.tag === "image")?.attrs, {
      href: art.sprites.spr_placed_16x16_wider.file,
      width: "144",
      height: "24",
    });
    made.length = 0;
    picture(itemImage(170)!, "Raft Base", "portrait", 112, 88);
    assertEquals(made.find((e) => e.tag === "img")?.attrs.title, "Raft Base (picture from the wiki)");
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

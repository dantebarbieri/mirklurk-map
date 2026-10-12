import art from "../src/artdata.json" with { type: "json" };
import { markImage, picture } from "../src/inspect.ts";
import { markIcon } from "../src/mapview.ts";
import type { Mark } from "../src/objects.ts";
import { itemImage } from "../src/wiki.ts";
import { assert, assertEquals } from "./assert.ts";

const raft: Mark = { layer: "rafts", kind: "raft", item: 171, name: "Raft", x: 344, y: 744 };

Deno.test("raft picture: finished and ridden rafts use world frame 1, bases keep their wiki picture", async () => {
  const image = markImage(raft);
  assert(image && "frame" in image);
  const strip = art.sprites.spr_placed_16x16_wider;
  assertEquals(image, { ...strip, frame: 1 });
  assertEquals(markImage({ ...raft, kind: "raft yours", detail: "you stand on it" }), image);
  assertEquals(markImage({ ...raft, kind: "raft base", item: 170, name: "Raft Base" }), itemImage(170));
  assert(itemImage(170));
  assertEquals(itemImage(171), undefined, "a finished raft is not an inventory picture");
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
  constructor(readonly tag: string) {}
  setAttribute(key: string, value: string) {
    this.attrs[key] = value;
  }
  append(child: ElementStub | string) {
    this.children.push(child);
  }
}

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

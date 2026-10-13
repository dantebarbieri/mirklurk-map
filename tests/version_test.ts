import { assert, assertEquals } from "./assert.ts";
import {
  atLeast,
  CHANNEL_LABELS,
  channelOf,
  CHANNELS,
  CHANNELS_TOOLTIP,
  detectVersion,
  type GameVersion,
  hasBeing,
  hasItem,
  NEWEST,
  versionLabel,
  VERSIONS,
} from "../src/version.ts";
import { ownRules, switchChannels, versionNote, versionSwitch, versionTitle } from "../src/versionview.ts";
import { ITEMS } from "../src/itemdata.ts";
import { BEINGS } from "../src/bestiary.ts";
import { BEING_NAMES, ITEM_NAMES } from "../src/gamedata.ts";
import { addable } from "../src/editor/items.ts";
import { spawnable } from "../src/editor/beings.ts";

const OLD: GameVersion = "0.8.1.5", NEW: GameVersion = "0.8.9.9";

Deno.test("version: Latest is the stable 0.8.1.5 and Beta the 0.8.9.9 test build, named in one place", () => {
  assertEquals(VERSIONS, ["0.8.1.5", "0.8.9.9"]);
  assertEquals(CHANNELS, { latest: OLD, beta: NEW });
  assertEquals(CHANNEL_LABELS, { latest: "Latest", beta: "Beta" });
  assertEquals([channelOf(OLD), channelOf(NEW)], ["latest", "beta"]);
  assertEquals([versionLabel(OLD), versionLabel(NEW)], ["Latest (0.8.1.5)", "Beta (0.8.9.9)"]);
  assertEquals(CHANNELS_TOOLTIP.split("\n"), [
    "Latest: Mirklurk 0.8.1.5, the game's default Steam branch",
    "Beta: Mirklurk 0.8.9.9, the opt-in Steam beta, next_version_tester",
  ]);
  // The generated data (items, beings, art) is read from the newest version.
  assertEquals(NEWEST, NEW);
  assert(atLeast(NEW, OLD) && atLeast(NEW, NEW) && atLeast(OLD, OLD) && !atLeast(OLD, NEW));
});

Deno.test("version: a save's VERSION picks the newest rules no newer than it", () => {
  const cases: [string | undefined, GameVersion | undefined][] = [
    ["0.8.1.5", OLD],
    ["0.8.9.9", NEW],
    [" 0.8.9.9 ", NEW],
    ["0.8.5", OLD],
    ["0.8.9.8", OLD],
    ["0.8.9.10", NEW],
    ["9.0.0.0", NEW],
    ["0.9", NEW],
    // Older than any rules MirkMap has: the oldest.
    ["0.7.2.1", OLD],
    ["", undefined],
    ["beta", undefined],
    ["0.8.x", undefined],
    [undefined, undefined],
  ];
  for (const [saved, rules] of cases) assertEquals(detectVersion(saved), rules, `${saved}`);
});

Deno.test("version: 0.8.1.5's game has no items from 258 or beings from 36; nothing older was removed", () => {
  const items = Object.keys(ITEMS).map(Number);
  assert(items.some((i) => i >= 258) && items.some((i) => i < 258));
  for (const i of items) {
    assert(hasItem(NEW, i), `${ITEM_NAMES[i]} in 0.8.9.9`);
    assertEquals(hasItem(OLD, i), i < 258, `${i} ${ITEM_NAMES[i]}`);
  }
  for (const i of Object.keys(BEINGS).map(Number)) {
    assert(hasBeing(NEW, i), `${BEING_NAMES[i]} in 0.8.9.9`);
    // 35 (a Survivor since 0.8.9.9) was already in 0.8.1.5's beingDB, as a guard never placed.
    assertEquals(hasBeing(OLD, i), i <= 35, `${i} ${BEING_NAMES[i]}`);
  }
  // What the save editor offers under each: the Storage Chest and the magic weapons, and the Mirkfangs, only for Beta.
  const offered = (v: GameVersion) => items.filter((i) => addable(i) && hasItem(v, i));
  assertEquals(offered(NEW).filter((i) => !offered(OLD).includes(i)).length, items.filter((i) => i >= 258 && addable(i)).length);
  assert(offered(NEW).includes(275) && !offered(OLD).includes(275), "Storage Chest");
  const spawns = (v: GameVersion) => Object.keys(BEINGS).map(Number).filter((i) => spawnable(i) && hasBeing(v, i));
  assertEquals(spawns(NEW).filter((i) => !spawns(OLD).includes(i)), [37, 38, 39]);
});

Deno.test("version switch: notes say whether the rules follow the save", () => {
  assertEquals(switchChannels(), ["latest", "beta"]);
  assertEquals(versionNote({ detected: NEW, rules: NEW, saved: "0.8.9.9" }), "from this save (0.8.9.9)");
  assertEquals(versionNote({ detected: OLD, rules: OLD, saved: "0.8.5.0" }), "from this save (0.8.5.0, so 0.8.1.5's rules)");
  assertEquals(versionNote({ detected: OLD, rules: NEW, saved: "0.8.1.5" }), "chosen; this save is 0.8.1.5");
  assertEquals(versionNote({ rules: OLD }), "this save names no version");
  assertEquals(versionNote({ rules: NEW }), "chosen; this save names no version");
  assertEquals(versionNote({ rules: OLD, saved: "beta" }), "this save's version, beta, is unreadable");
  assertEquals([ownRules({ rules: NEW }), ownRules({ detected: NEW, rules: OLD })], [CHANNELS.latest, NEW]);
  const title = versionTitle({ detected: NEW, rules: NEW }, "Editor note.");
  assert(title.startsWith(CHANNELS_TOOLTIP) && title.endsWith("\n\nEditor note."), title);
  assert(versionTitle({ rules: OLD }).includes("names no version"));
});

class Stub {
  attrs: Record<string, string> = {};
  children: (Stub | string)[] = [];
  listeners: Record<string, () => void> = {};
  constructor(readonly tag: string) {}
  setAttribute(key: string, value: string) {
    this.attrs[key] = value;
  }
  addEventListener(type: string, f: () => void) {
    this.listeners[type] = f;
  }
  append(child: Stub | string) {
    this.children.push(child);
  }
  text(): string {
    return this.children.map((c) => (typeof c === "string" ? c : c.text())).join("");
  }
}

Deno.test("version switch: Latest and Beta buttons, the one in use pressed; the save's own goes back to following it", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: (tag: string) => new Stub(tag) } });
  try {
    const picks: (GameVersion | undefined)[] = [];
    const render = (detected: GameVersion | undefined, rules: GameVersion) => {
      const root = versionSwitch({ detected, rules, saved: detected }, (v) => picks.push(v)) as unknown as Stub;
      const group = root.children[0] as Stub;
      return { root, group, buttons: group.children as Stub[], note: root.children[1] as Stub };
    };
    const old = render(OLD, OLD);
    assertEquals(old.group.attrs.role, "group");
    assertEquals(old.buttons.map((b) => [b.text(), b.attrs["aria-pressed"]]), [["Latest", "true"], ["Beta", "false"]]);
    assertEquals(old.buttons.map((b) => b.attrs.title), [
      "Mirklurk 0.8.1.5, the game's default Steam branch; this save's version",
      "Mirklurk 0.8.9.9, the opt-in Steam beta, next_version_tester",
    ]);
    assertEquals([old.note.text(), old.note.attrs.class], ["from this save (0.8.1.5)", "muted version-note"]);
    assert(old.root.attrs.title.startsWith(CHANNELS_TOOLTIP));
    old.buttons[0].listeners.click();
    old.buttons[1].listeners.click();
    // Picked over the save: Beta pressed, and Latest (the save's own) goes back to following the save.
    const chosen = render(OLD, NEW);
    assertEquals(chosen.buttons.map((b) => b.attrs["aria-pressed"]), ["false", "true"]);
    assertEquals([chosen.note.text(), chosen.note.attrs.class], ["chosen; this save is 0.8.1.5", "version-note chosen"]);
    chosen.buttons[0].listeners.click();
    // No version saved: Latest's rules, and picking Latest again follows the save.
    const none = render(undefined, NEW);
    none.buttons[0].listeners.click();
    assertEquals(picks, [NEW, undefined, undefined]);
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

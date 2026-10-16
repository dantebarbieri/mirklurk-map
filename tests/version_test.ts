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
  overrideOf,
  sameRules,
  versionLabel,
  VERSIONS,
} from "../src/version.ts";
import { ownRules, switchOptions, versionNote, versionSwitch, versionTitle } from "../src/versionview.ts";
import { NO_VERSION, parsePlayer } from "../src/save.ts";
import { ITEMS } from "../src/itemdata.ts";
import { BEINGS } from "../src/bestiary.ts";
import { BEING_NAMES, ITEM_NAMES } from "../src/gamedata.ts";
import { addable } from "../src/editor/items.ts";
import { spawnable } from "../src/editor/beings.ts";

const OLD: GameVersion = "0.8.1.5", BETA: GameVersion = "0.8.9.9", REL: GameVersion = "0.9.0.0";
const FIX: GameVersion = "0.9.0.1", NEW: GameVersion = "0.9.0.2";
/** The branches before 0.9.0.0's release: 0.8.1.5 as Latest and the 0.8.9.9 beta. */
const BEFORE = { latest: OLD, beta: BETA };

Deno.test("version: Latest is the 0.9.0.2 release, with no beta, named in one place", () => {
  assertEquals(VERSIONS, ["0.8.1.5", "0.8.9.9", "0.9.0.0", "0.9.0.1", "0.9.0.2"]);
  assertEquals(CHANNELS, { latest: NEW });
  assertEquals(CHANNEL_LABELS, { latest: "Latest", beta: "Beta" });
  assertEquals([channelOf(OLD), channelOf(BETA), channelOf(REL), channelOf(FIX), channelOf(NEW)], [
    undefined,
    undefined,
    undefined,
    undefined,
    "latest",
  ]);
  assertEquals([versionLabel(OLD), versionLabel(REL), versionLabel(FIX), versionLabel(NEW)], [
    "0.8.1.5",
    "0.9.0.0",
    "0.9.0.1",
    "Latest (0.9.0.2)",
  ]);
  assertEquals(CHANNELS_TOOLTIP.split("\n"), ["Latest: Mirklurk 0.9.0.2, the game's Steam release"]);
  // The generated data (items, beings, art) is read from the newest version.
  assertEquals(NEWEST, NEW);
  assert(atLeast(NEW, OLD) && atLeast(NEW, BETA) && atLeast(BETA, OLD) && atLeast(OLD, OLD) && !atLeast(OLD, BETA) && !atLeast(BETA, NEW));
  assert(atLeast(NEW, FIX) && atLeast(FIX, REL) && !atLeast(REL, FIX) && !atLeast(FIX, NEW));
  // 0.9.0.0 released the 0.8.9.9 beta with bug fixes only, and 0.9.0.2 fixed bugs in 0.9.0.1: the same rules.
  assert(sameRules(REL, BETA) && sameRules(BETA, REL) && sameRules(OLD, OLD) && sameRules(NEW, FIX) && sameRules(FIX, NEW));
  // 0.9.0.1 changed orbs, Magus Clay's armor and a price.
  assert(!sameRules(OLD, BETA) && !sameRules(NEW, OLD) && !sameRules(FIX, REL) && !sameRules(NEW, BETA));
});

Deno.test("version: a save's VERSION picks the newest rules no newer than it", () => {
  const cases: [string | undefined, GameVersion | undefined][] = [
    ["0.8.1.5", OLD],
    ["0.8.9.9", BETA],
    ["0.9.0.0", REL],
    [" 0.9.0.0 ", REL],
    ["0.9.0.1", FIX],
    ["0.9.0.2", NEW],
    ["0.8.5", OLD],
    ["0.8.9.8", OLD],
    ["0.8.9.10", BETA],
    ["0.9", REL],
    ["0.9.0.0.5", REL],
    ["0.9.0.3", NEW],
    ["9.0.0.0", NEW],
    // Older than any rules MirkMap has: the oldest.
    ["0.7.2.1", OLD],
    ["", undefined],
    ["beta", undefined],
    ["0.8.x", undefined],
    [undefined, undefined],
  ];
  for (const [saved, rules] of cases) assertEquals(detectVersion(saved), rules, `${saved}`);
});

Deno.test("version: a pick overrides only another version than the save's, also after a reload changes the save's", () => {
  assertEquals(overrideOf(NEW, OLD), NEW);
  assertEquals(overrideOf(OLD, NEW), OLD);
  assertEquals(overrideOf(NEW, undefined), NEW);
  assertEquals(overrideOf(undefined, OLD), undefined);
  // Latest picked on a 0.8.1.5 save, which the game then saves as 0.9.0.2: the pick is dropped, so the save is followed.
  const pick = overrideOf(NEW, OLD);
  assertEquals(overrideOf(pick, detectVersion("0.9.0.2")), undefined);
});

Deno.test("version: 0.8.1.5's game has no items from 258 or beings from 36; later ones have 0.8.9.9's; nothing older was removed", () => {
  const items = Object.keys(ITEMS).map(Number);
  assert(items.some((i) => i >= 258) && items.some((i) => i < 258));
  for (const i of items) {
    assert(hasItem(NEW, i) && hasItem(FIX, i) && hasItem(REL, i) && hasItem(BETA, i), `${ITEM_NAMES[i]} since 0.8.9.9`);
    assertEquals(hasItem(OLD, i), i < 258, `${i} ${ITEM_NAMES[i]}`);
  }
  for (const i of Object.keys(BEINGS).map(Number)) {
    assert(hasBeing(NEW, i) && hasBeing(FIX, i) && hasBeing(REL, i) && hasBeing(BETA, i), `${BEING_NAMES[i]} since 0.8.9.9`);
    // 35 (a Survivor since 0.8.9.9) was already in 0.8.1.5's beingDB, as a guard never placed.
    assertEquals(hasBeing(OLD, i), i <= 35, `${i} ${BEING_NAMES[i]}`);
  }
  // What the save editor offers under each: the Storage Chest and the magic weapons, and the Mirkfangs, only since 0.8.9.9.
  const offered = (v: GameVersion) => items.filter((i) => addable(i) && hasItem(v, i));
  assertEquals(offered(NEW), offered(BETA));
  assertEquals(offered(NEW).filter((i) => !offered(OLD).includes(i)).length, items.filter((i) => i >= 258 && addable(i)).length);
  assert(offered(NEW).includes(275) && !offered(OLD).includes(275), "Storage Chest");
  const spawns = (v: GameVersion) => Object.keys(BEINGS).map(Number).filter((i) => spawnable(i) && hasBeing(v, i));
  assertEquals(spawns(NEW), spawns(BETA));
  assertEquals(spawns(NEW).filter((i) => !spawns(OLD).includes(i)), [37, 38, 39]);
});

Deno.test("version switch: a choice only where the rules differ; notes say whether the rules follow the save", () => {
  type Channels = { latest: GameVersion; beta?: GameVersion };
  const labels = (detected?: GameVersion, channels?: Channels) =>
    switchOptions({ detected, rules: detected ?? NEW }, channels).map((o) => [o.label, o.version]);
  // An older save keeps a button for its own version, oldest first.
  assertEquals(labels(OLD), [["0.8.1.5", OLD], ["Latest", NEW]]);
  assertEquals(
    switchOptions({ detected: OLD, rules: OLD })[0].title,
    "Mirklurk 0.8.1.5, on no Steam branch now; this save's version",
  );
  // 0.9.0.0 and the 0.8.9.9 beta share rules that are not Latest's, so their saves get a switch, named after the save's version.
  assertEquals(labels(REL), [["0.9.0.0", REL], ["Latest", NEW]]);
  assertEquals(labels(BETA), [["0.8.9.9", BETA], ["Latest", NEW]]);
  // One button, so no switch, for a 0.9.0.2 save, a 0.9.0.1 save (the same rules) and a save that names no version.
  assertEquals(labels(NEW), [["Latest", NEW]]);
  assertEquals(labels(FIX), [["Latest", NEW]]);
  assertEquals(labels(undefined), [["Latest", NEW]]);
  // While a beta is out, as before 0.9.0.0: Latest and Beta, and a later save on the beta's rules adds none.
  assertEquals(labels(OLD, BEFORE), [["Latest", OLD], ["Beta", BETA]]);
  assertEquals(labels(REL, BEFORE), [["Latest", OLD], ["Beta", BETA]]);
  assertEquals(labels(undefined, BEFORE), [["Latest", OLD], ["Beta", BETA]]);
  // A beta with Latest's rules is one button.
  assertEquals(labels(OLD, { latest: NEW, beta: FIX }), [["0.8.1.5", OLD], ["Latest", NEW]]);
  assertEquals(versionNote({ detected: NEW, rules: NEW, saved: "0.9.0.2" }), "from this save (0.9.0.2)");
  assertEquals(versionNote({ detected: OLD, rules: OLD, saved: "0.8.5.0" }), "from this save (0.8.5.0, so 0.8.1.5's rules)");
  assertEquals(versionNote({ detected: OLD, rules: NEW, saved: "0.8.1.5" }), "chosen; this save is 0.8.1.5");
  assertEquals(versionNote({ rules: NEW }), "this save names no version");
  assertEquals(versionNote({ rules: OLD }), "chosen; this save names no version");
  assertEquals(versionNote({ rules: NEW, saved: "beta" }), "this save's version, beta, is unreadable");
  // A Player.save without VERSION parses to NO_VERSION, which names none.
  const grid = [0, 1, 2, 3, 4].map(() => [1, 1, 1, 1, 1]);
  const bare = parsePlayer([{ worldGrid: grid }]);
  assertEquals(bare.version, NO_VERSION);
  assertEquals(detectVersion(bare.version), undefined);
  assertEquals(versionNote({ rules: NEW, saved: bare.version }), "this save names no version");
  assertEquals(versionNote({ rules: OLD, saved: bare.version }), "chosen; this save names no version");
  assertEquals(parsePlayer([{ worldGrid: grid, VERSION: "0.9.0.2" }]).version, NEW);
  assertEquals([ownRules({ rules: OLD }), ownRules({ detected: OLD, rules: NEW })], [CHANNELS.latest, OLD]);
  const title = versionTitle({ detected: OLD, rules: OLD }, "Editor note.");
  assert(title.startsWith(CHANNELS_TOOLTIP) && title.endsWith("\n\nEditor note."), title);
  assert(versionTitle({ rules: NEW }).includes("names no version"));
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

Deno.test("version switch: the save's version and Latest, the one in use pressed; hidden when there is no choice", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: (tag: string) => new Stub(tag) } });
  try {
    const picks: (GameVersion | undefined)[] = [];
    const render = (detected: GameVersion | undefined, rules: GameVersion, channels?: { latest: GameVersion; beta?: GameVersion }) => {
      const root = versionSwitch({ detected, rules, saved: detected }, (v) => picks.push(v), undefined, channels) as unknown as Stub;
      const group = root.children[0] as Stub;
      return { root, group, buttons: group.children as Stub[], note: root.children[1] as Stub };
    };
    // Nothing to pick: no switch for a 0.9.0.2 save, a 0.9.0.1 save or a save that names no version.
    for (const detected of [NEW, FIX, undefined]) {
      assertEquals(versionSwitch({ detected, rules: detected ?? NEW }, (v) => picks.push(v)), null, `${detected}`);
    }
    const old = render(OLD, OLD);
    assertEquals(old.group.attrs.role, "group");
    assertEquals(old.buttons.map((b) => [b.text(), b.attrs["aria-pressed"]]), [["0.8.1.5", "true"], ["Latest", "false"]]);
    assertEquals(old.buttons.map((b) => b.attrs.title), [
      "Mirklurk 0.8.1.5, on no Steam branch now; this save's version",
      "Mirklurk 0.9.0.2, the game's Steam release",
    ]);
    assertEquals([old.note.text(), old.note.attrs.class], ["from this save (0.8.1.5)", "muted version-note"]);
    assert(old.root.attrs.title.startsWith(CHANNELS_TOOLTIP));
    old.buttons[0].listeners.click();
    old.buttons[1].listeners.click();
    // Latest picked over the save: Latest pressed, and the save's own goes back to following the save.
    const chosen = render(OLD, NEW);
    assertEquals(chosen.buttons.map((b) => b.attrs["aria-pressed"]), ["false", "true"]);
    assertEquals([chosen.note.text(), chosen.note.attrs.class], ["chosen; this save is 0.8.1.5", "version-note chosen"]);
    chosen.buttons[0].listeners.click();
    assertEquals(picks, [NEW, undefined]);
    // While a beta is out, Latest and Beta buttons; picking Latest again on a save with no version follows the save.
    picks.length = 0;
    const before = render(OLD, OLD, BEFORE);
    assertEquals(before.buttons.map((b) => [b.text(), b.attrs["aria-pressed"]]), [["Latest", "true"], ["Beta", "false"]]);
    assertEquals(before.buttons[1].attrs.title, "Mirklurk 0.8.9.9, the opt-in Steam beta");
    before.buttons[1].listeners.click();
    render(undefined, BETA, BEFORE).buttons[0].listeners.click();
    assertEquals(picks, [BETA, undefined]);
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

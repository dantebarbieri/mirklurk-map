// The journal as journal_update (gml_GlobalScript_scr_basic_useful) rebuilds it from the saved main-quest stage, with its people and
// places linked. Real saves are checked when available (skipped otherwise):
//   MIRKLURK_SAVES="…\Saves" deno task test

import { assert, assertEquals } from "./assert.ts";
import { JOURNAL, JOURNAL_FIRST } from "../src/gamedata.ts";
import {
  bhatoDirection,
  ENTRY_INFO,
  FIRST_INFO,
  journalEntries,
  journalHeadline,
  type JournalSave,
  type JournalTarget,
  linkSegments,
  locateTarget,
  stageNote,
  targetName,
} from "../src/journal.ts";
import { Area, INTERIOR_NAMES } from "../src/rules.ts";
import { findCharacters } from "../src/files.ts";
import { loadWorld, type World } from "../src/world.ts";
import { HAVE_SAVES, readTree } from "./saves.ts";

/** A world with the fort at `fort` ([x, y]) and every other zone a Common Bog. */
function save(mainQuest: number, fort: [number, number] = [0, 2], over: Partial<JournalSave> = {}): JournalSave {
  const grid = [0, 1, 2, 3, 4].map((y) => [0, 1, 2, 3, 4].map((x) => (x === fort[0] && y === fort[1] ? Area.Fort : Area.CommonBog)));
  return { mainQuest, grid, rangerCamp: [fort[0] + 1, fort[1]], libraryArea: [2, 4], riftQuestArea: [4, 2], ...over };
}

const stages = (s: JournalSave) => journalEntries(s).map((e) => e.stage);
const linked = (s: JournalSave, stage: number | null) =>
  journalEntries(s).find((e) => e.stage === stage)!.segments.filter((x) => x.link).map((x) => x.text);

Deno.test("journal: the opening entry alone before stage 0, during and after the tutorial", () => {
  for (const q of [-10, -9, -6, -5]) assertEquals(stages(save(q)), [null], `stage ${q}`);
  assertEquals(stageNote(-10), "Still in the opening tutorial.");
  assertEquals(stageNote(-6), "Still in the opening tutorial.");
  assertEquals(stageNote(-5), "The opening tutorial is over, or was skipped.");
  assertEquals(journalHeadline(save(-5)), "Entry 1 · Exile");
  assertEquals(journalEntries(save(-5))[0].text, JOURNAL_FIRST);
});

Deno.test("journal: one entry per stage reached that has text, in the game's order", () => {
  assertEquals(stages(save(0)), [null, 0]);
  assertEquals(stages(save(3)), [null, 0, 1, 2, 3]);
  // 14, 21, 22 and 27 have no text in UI.ini [Journal].
  assertEquals(stages(save(14)), [null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assertEquals(stages(save(22)).slice(-3), [18, 19, 20]);
  const all = stages(save(30));
  assertEquals(all.length, 28);
  for (const gap of [14, 21, 22, 27]) assert(!all.includes(gap), `no entry for ${gap}`);
  assertEquals(all.at(-1), 30);
  assertEquals(journalHeadline(save(30)), "Entry 28 · Free");
  // Beyond the last stage the journal stays whole.
  assertEquals(stages(save(31)).length, 28);
});

Deno.test("journal: the game's own text, with only its places filled in", () => {
  for (const e of journalEntries(save(30))) {
    if (e.stage === null) continue;
    assertEquals(e.text, JOURNAL[e.stage].replace("CCC", e.stage === 7 ? "to the east" : e.stage === 17 ? "C,5" : "E,3"), `${e.stage}`);
    assertEquals(e.segments.map((s) => s.text).join(""), e.text, `${e.stage} segments`);
  }
});

Deno.test("journal: stages that add no entry say what is going on", () => {
  for (const q of [14, 21, 22, 27]) assert(stageNote(q), `note for ${q}`);
  for (const q of [0, 7, 13, 15, 26, 30]) assertEquals(stageNote(q), undefined, `no note for ${q}`);
});

Deno.test("journal: entry 7 points from the fort to Bhato's zone, east or west before south, else north", () => {
  const dir = (fort: [number, number], camp: [number, number]) => bhatoDirection(save(7, fort, { rangerCamp: camp }));
  assertEquals(dir([0, 2], [1, 2]), "to the east");
  assertEquals(dir([4, 2], [3, 2]), "to the west");
  assertEquals(dir([0, 1], [0, 2]), "to the south");
  assertEquals(dir([0, 2], [0, 1]), "to the north");
  // A diagonal (never generated) still follows the game's order: east or west wins.
  assertEquals(dir([0, 1], [1, 2]), "to the east");
  const seven = journalEntries(save(7, [4, 2], { rangerCamp: [4, 3] })).at(-1)!;
  assertEquals(seven.stage, 7);
  assert(seven.text.includes("in the next area to the south."), seven.text);
  assertEquals(linked(save(7, [4, 2], { rangerCamp: [4, 3] }), 7), ["a ranger named Bhato", "the next area to the south", "some hideout"]);
  const unknown = journalEntries(save(7, [4, 2], { rangerCamp: null })).at(-1)!;
  assert(unknown.text.includes("in the next area. "), unknown.text);
});

Deno.test("journal: entries 17 and 26 name the Library's and Scaal's zones as the game prints them", () => {
  const e = journalEntries(save(26, [0, 2], { libraryArea: [2, 4], riftQuestArea: [4, 2] }));
  const at = (stage: number) => e.find((x) => x.stage === stage)!;
  assert(at(17).text.includes("travel to area C,5."), at(17).text);
  assertEquals(at(17).title, "The ruins at C,5");
  assert(at(26).text.endsWith("lies at E,3."), at(26).text);
  assert(!e.some((x) => /CCC/.test(x.text + x.title)), "every place is filled in");
});

Deno.test("journal: names and places are linked where the game's text mentions them", () => {
  const s = save(30);
  assertEquals(linked(s, null), ["this wretched ship"]);
  assertEquals(linked(s, 4), ["Eir", "Clay", "the undercroft of the fort"]);
  assertEquals(linked(s, 9), ["Bhato", "Bhato"]);
  assertEquals(linked(s, 26), ["Clay", "E,3"]);
  // "Scaal" is a word of its own, not the start of "scaalmyr" or "Scaalmyrs".
  assertEquals(linked(s, 29), ["Scaal", "Eir"]);
  assertEquals(linked(s, 0), []);
  // Every phrase is in the game's text, so a game update that rewords one shows up here.
  for (const [stage, info] of [[null, FIRST_INFO] as const, ...Object.entries(ENTRY_INFO).map(([k, v]) => [Number(k), v] as const)]) {
    const raw = stage === null ? JOURNAL_FIRST : JOURNAL[stage];
    assert(raw !== undefined, `stage ${stage} has text`);
    for (const [phrase] of info.links) {
      assert(linkSegments(raw, [[phrase, { kind: "rift" }]]).some((x) => x.link), `stage ${stage}: "${phrase}"`);
    }
  }
});

Deno.test("journal: link splitting takes whole words and prefers the longer phrase", () => {
  const a: JournalTarget = { kind: "rift" }, b: JournalTarget = { kind: "zone", zone: "bhato" };
  assertEquals(linkSegments("Scaalmyrs and Scaal.", [["Scaal", a]]), [{ text: "Scaalmyrs and " }, { text: "Scaal", link: a }, {
    text: ".",
  }]);
  assertEquals(
    linkSegments("talk to Captain Eir", [["Eir", a], ["Captain Eir", b]]).map((x) => [x.text, !!x.link]),
    [["talk to ", false], ["Captain Eir", true]],
  );
  assertEquals(targetName({ kind: "being", index: 8, home: a }), "Magus Clay");
  assertEquals(targetName({ kind: "interior", type: 30 }), "Undercroft");
});

async function worlds(): Promise<World[]> {
  const files = readTree();
  return await Promise.all(findCharacters(files).map((c) => loadWorld(files, c.root, c.name)));
}

Deno.test({ name: "journal: real saves", ignore: !HAVE_SAVES }, async () => {
  for (const w of await worlds()) {
    const p = w.player, name = w.character;
    const e = journalEntries(p);
    assertEquals(e[0].stage, null, name);
    const last = e.at(-1)!.stage;
    if (p.mainQuest < 0) assertEquals(e.length, 1, `${name}: only the opening entry before stage 0`);
    else assert(last !== null && last <= p.mainQuest && (last === p.mainQuest || stageNote(p.mainQuest)), `${name}: newest entry`);
    assert(bhatoDirection(p) !== "", `${name}: Bhato's direction`);
    assert(!e.some((x) => /CCC| at \?|area \?/.test(x.title + x.text)), `${name}: places filled in`);
    // Every person and place the journal mentions is somewhere on the map.
    for (const x of e) {
      for (const s of x.segments) if (s.link) assert(await locateTarget(w, s.link), `${name}: "${s.text}" in entry ${x.stage}`);
    }
  }
});

Deno.test({ name: "journal: real saves find the people and places where they are", ignore: !HAVE_SAVES }, async () => {
  const all = await worlds();
  const by = (n: string) => all.find((w) => w.character === n);
  const lilly = by("Lilly"), demo = by("StatusDemo");
  if (lilly) {
    const at = (t: JournalTarget) => locateTarget(lilly, t);
    const fort = lilly.zones.flat().find((z) => z.type === Area.Fort)!;
    // Eir stands outside in the fort's zone; Clay is in the Undercroft and Bhato in his hideout.
    const eir = await at({ kind: "being", index: 6, home: { kind: "rift" } });
    assertEquals([eir?.zone.x, eir?.zone.y, eir?.interior, eir?.mark?.being], [fort.x, fort.y, undefined, 6]);
    const clay = await at(journalEntries(lilly.player).find((x) => x.stage === 4)!.segments.find((s) => s.text === "Clay")!.link!);
    assertEquals([clay?.interior?.kind, clay?.mark?.being], [30, 8]);
    const bhato = await at(journalEntries(lilly.player).find((x) => x.stage === 8)!.segments.find((s) => s.text === "Bhato")!.link!);
    assertEquals([bhato?.interior?.kind, bhato?.mark?.being, bhato?.zone.x, bhato?.zone.y], [31, 12, ...lilly.player.rangerCamp!]);
    // The rift samples come from the rift the game puts beside the Camp, in the fort's zone.
    const rift = await at({ kind: "rift" });
    assertEquals([rift?.zone.x, rift?.zone.y, rift?.mark?.layer], [fort.x, fort.y, "rifts"]);
    // The undercroft is saved, so the link opens it.
    const under = await at({ kind: "interior", type: 30 });
    assertEquals(under?.interior?.kind, 30);
  }
  if (demo) {
    const e = journalEntries(demo.player);
    const link = (stage: number, text: string) => e.find((x) => x.stage === stage)!.segments.find((s) => s.text === text)!.link!;
    const tain = await locateTarget(demo, link(15, "the commander"));
    assertEquals([tain?.interior?.kind, tain?.mark?.being], [32, 20]);
    const library = await locateTarget(demo, link(18, "the ruins"));
    assertEquals([library?.mark?.name, library?.zone.x, library?.zone.y], ["Library", ...demo.player.libraryArea!]);
    // Scaal's lair is not placed yet in this save: the link shows its zone, as the entry names it.
    const lair = await locateTarget(demo, link(26, "A,5"));
    assertEquals([lair?.zone.x, lair?.zone.y, lair?.mark], [...demo.player.riftQuestArea!, undefined]);
    assertEquals(INTERIOR_NAMES[32], "Fort interior");
  }
});

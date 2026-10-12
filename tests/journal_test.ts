// The journal as journal_update (gml_GlobalScript_scr_basic_useful) rebuilds it from the saved main-quest stage. Real saves are
// checked when available (skipped otherwise):
//   MIRKLURK_SAVES="…\Saves" deno task test

import { assert, assertEquals } from "./assert.ts";
import { decodeJson, parsePlayer } from "../src/save.ts";
import { bhatoDirection, journalEntries, journalHeadline, type JournalSave, stageNote } from "../src/journal.ts";
import { Area } from "../src/rules.ts";

/** A world with the fort at `fort` ([x, y]) and every other zone a Common Bog. */
function save(mainQuest: number, fort: [number, number] = [0, 2], over: Partial<JournalSave> = {}): JournalSave {
  const grid = [0, 1, 2, 3, 4].map((y) => [0, 1, 2, 3, 4].map((x) => (x === fort[0] && y === fort[1] ? Area.Fort : Area.CommonBog)));
  return { mainQuest, grid, rangerCamp: [fort[0] + 1, fort[1]], libraryArea: [2, 4], riftQuestArea: [4, 2], ...over };
}

const stages = (s: JournalSave) => journalEntries(s).map((e) => e.stage);

Deno.test("journal: the opening entry alone before stage 0, during and after the tutorial", () => {
  for (const q of [-10, -9, -6, -5]) assertEquals(stages(save(q)), [null], `stage ${q}`);
  assertEquals(stageNote(-10), "Still in the opening tutorial.");
  assertEquals(stageNote(-6), "Still in the opening tutorial.");
  assertEquals(stageNote(-5), "The opening tutorial is over, or was skipped.");
  assertEquals(journalHeadline(save(-5)), "Entry 1 · Exile");
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
  assert(seven.text.includes("neighbouring area to the south."), seven.text);
  const unknown = journalEntries(save(7, [4, 2], { rangerCamp: null })).at(-1)!;
  assert(unknown.text.includes("neighbouring area. "), unknown.text);
});

Deno.test("journal: entries 17 and 26 name the Library's and Scaal's zones as the game prints them", () => {
  const e = journalEntries(save(26, [0, 2], { libraryArea: [2, 4], riftQuestArea: [4, 2] }));
  const at = (stage: number) => e.find((x) => x.stage === stage)!;
  assert(at(17).text.includes("area C,5"), at(17).text);
  assertEquals(at(17).title, "The ruins of C,5");
  assert(at(26).text.includes("is at E,3."), at(26).text);
  assert(!e.some((x) => /CCC/.test(x.text + x.title)), "every place is filled in");
});

const dir = Deno.env.get("MIRKLURK_SAVES") ??
  decodeURIComponent(new URL("../../Saves", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const players = (() => {
  const out: [string, JournalSave][] = [];
  try {
    for (const e of Deno.readDirSync(dir)) {
      if (!e.isDirectory) continue;
      try {
        out.push([e.name, parsePlayer(decodeJson(Deno.readFileSync(`${dir}/${e.name}/Player.save`)))]);
      } catch {
        // Not a character folder.
      }
    }
  } catch {
    // No saves here.
  }
  return out;
})();

Deno.test({ name: "journal: real saves", ignore: players.length === 0 }, () => {
  for (const [name, p] of players) {
    const e = journalEntries(p);
    assertEquals(e[0].stage, null, name);
    const last = e.at(-1)!.stage;
    if (p.mainQuest < 0) assertEquals(e.length, 1, `${name}: only the opening entry before stage 0`);
    else assert(last !== null && last <= p.mainQuest && (last === p.mainQuest || stageNote(p.mainQuest)), `${name}: newest entry`);
    assert(bhatoDirection(p) !== "", `${name}: Bhato's direction`);
    assert(!e.some((x) => /CCC|unknown area/.test(x.text + x.title)), `${name}: places filled in`);
  }
});

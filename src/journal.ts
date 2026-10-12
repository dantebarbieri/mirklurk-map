// The character's journal, as Mirklurk 0.8.1.5 rebuilds it from the saved main-quest stage (mainQ, global.MAINQUESTSTAGE) when
// it loads a save: journal_update in gml_GlobalScript_scr_basic_useful pushes UI.ini [Journal] "First", then the entry of every
// stage from 0 up to the saved one that has text. Stages without text add nothing. The entries are summarised here in MirkMap's
// own words, not copied, as with the other longer game texts; the places the game fills in ("CCC") are filled in the same way.

import { h } from "./dom.ts";
import { wikiLink } from "./inspect.ts";
import { Area, coordLabel } from "./rules.ts";
import type { PlayerSave } from "./save.ts";
import { wikiUrl } from "./wiki.ts";

export type JournalSave = Pick<PlayerSave, "mainQuest" | "grid" | "rangerCamp" | "libraryArea" | "riftQuestArea">;

export interface JournalEntry {
  /** The main-quest stage that adds it; null for the opening entry every journal starts with. */
  stage: number | null;
  title: string;
  text: string;
}

/** What journal_update fills in for "CCC": the direction of Bhato's zone, or a zone's map coordinate. */
interface Places {
  bhato: string;
  library: string;
  scaal: string;
}

const FIRST: Omit<JournalEntry, "stage"> = {
  title: "Exile",
  text: "Banished from the Kingdom and about to step off the ship into the Mirk, with no idea what waits there.",
};

/** UI.ini [Journal] 0–30, paraphrased. 14, 21, 22 and 27 have no text, so they add no entry. */
const ENTRIES: Readonly<Record<number, (at: Places) => Omit<JournalEntry, "stage">>> = {
  0: () => ({
    title: "First supplies",
    text: "Some basic supplies to start with. Survive, and look to the map for a hint of what to do next.",
  }),
  1: () => ({
    title: "The ruined camp",
    text: "The camp is wrecked and the other Unwanted are dead. One of them carried a flute that may still matter to someone.",
  }),
  2: () => ({ title: "News for Eir", text: "Captain Eir took the news of the camp hard and asked to be visited again tomorrow." }),
  3: () => ({ title: "Another night", text: "Another night survived; time to go back to Eir." }),
  4: () => ({ title: "Magus Clay", text: "Eir sends you to Clay, who lives in the undercroft beneath the fort." }),
  5: () => ({ title: "Rift samples", text: "Clay wants three samples taken from the rift itself. Careful." }),
  6: () => ({ title: "Clay's research", text: "Clay needs time to study the weaves; speak to Eir in the meantime." }),
  7: (at) => ({
    title: "Ranger Bhato",
    text: `Find a ranger called Bhato in the neighbouring area${
      at.bhato ? ` ${at.bhato}` : ""
    }. He keeps a hideout there, so he may be hard to spot.`,
  }),
  8: () => ({ title: "The cellar", text: "Bhato says one of the ruins in his area leads down into an ancient cellar. Search them." }),
  9: () => ({
    title: "The beast's drop",
    text: "The strange beast Bhato described is dead and dropped something heavy. Look at it, then bring it to Bhato.",
  }),
  10: () => ({ title: "The rune", text: "Back to Clay at Fort Solid, taking the strange rune along." }),
  11: () => ({ title: "The potion", text: "Clay wants a potion poured down the throat of one of the dead at the abandoned camp." }),
  12: () => ({ title: "Back to life", text: "One of the Unwanted has come back to life. Guide him to Fort Solid." }),
  13: () => ({
    title: "Viend at the fort",
    text: "Viend made it to the fort, where Clay is probably examining him. Captain Eir has something to say.",
  }),
  15: () => ({ title: "Into the fort", text: "Fort Solid is open to you now. Speak to the commander." }),
  16: () => ({ title: "Before the journey", text: "Talk to Clay once more before setting out on the longer journey." }),
  17: (at) => ({
    title: `The ruins of ${at.library}`,
    text: `Travel to area ${at.library}: among its many ruins there may be records about the rifts and "The Caged Ones".`,
  }),
  18: () => ({
    title: "At the ruins",
    text: "The ruins are reached. Search them for anything that has lasted the ages and can tell something useful.",
  }),
  19: () => ({ title: "The strongbox", text: "Found an ancient strongbox that seems magical. Clay will want to see it." }),
  20: () => ({ title: "While Clay works", text: "Speak to the commander again while Clay tries to open the strongbox." }),
  23: () => ({
    title: "After the blast",
    text: "Talking with the commander, then nothing. Waking with a splitting headache, aching all over, ears ringing. " +
      "Ask around about what happened.",
  }),
  24: () => ({ title: "Will Clay talk?", text: "See whether Clay is willing to talk." }),
  25: () => ({ title: "Clay vanishes", text: "Clay seems to have dropped something just before he disappeared." }),
  26: (at) => ({
    title: "Clay's item",
    text: "Was this odd item left on purpose or by accident? It feels important. If Clay was right, the way to stop the " +
      `Scaalmyr's conquest is at ${at.scaal}.`,
  }),
  28: () => ({ title: "The depths", text: "This has to be the place. Scaal lives somewhere in these depths; go as deep as possible." }),
  29: () => ({
    title: "Scaal defeated",
    text: "Scaal is dead and no new Scaalmyr will be spawned, though some may still roam the Mirk. Tell Eir.",
  }),
  30: () => ({
    title: "Free",
    text: "Free now, perhaps even to go home one day. But what would home mean, after all the Mirk has changed?",
  }),
};

/** Stages that add no entry, and what they mean (set in scr_text_related, scr_smartones and UI_Draw_64). */
export function stageNote(stage: number): string | undefined {
  // -10 to -6 are the tutorial's steps; finishing or skipping it sets -5.
  if (stage < -5) return "Still in the opening tutorial.";
  if (stage < 0) return "The opening tutorial is over, or was skipped.";
  return ({
    14: "Viend has just reached Captain Eir.",
    21: "In the middle of the talk with Commander Tain.",
    22: "Caught in a blast at the end of the talk with Commander Tain.",
    27: "Captain Eir has handed over the Summoning Stone.",
  } as Record<number, string>)[stage];
}

/** map_get_fort_xy: the fort's zone, searched column by column; [-4, -4] without one. */
function fortZone(grid: number[][]): [number, number] {
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) if (grid[y]?.[x] === Area.Fort) return [x, y];
  return [-4, -4];
}

/** Bestiary.ini [ToTheDir] 0–3. */
const TO_THE = ["to the north", "to the south", "to the east", "to the west"];

/** Entry 7's direction: Bhato's zone seen from the fort, east or west winning over south, else north (journal_update). */
export function bhatoDirection(p: Pick<PlayerSave, "grid" | "rangerCamp">): string {
  if (!p.rangerCamp) return "";
  const [cx, cy] = p.rangerCamp, [fx, fy] = fortZone(p.grid);
  let dir = cy > fy ? 1 : 0;
  if (cx > fx) dir = 2;
  else if (cx < fx) dir = 3;
  return TO_THE[dir];
}

const coord = (c: [number, number] | null) => (c ? coordLabel(c[0], c[1]) : "an unknown area");

/** The journal's entries in the game's order (Entry 1 first); the last is the one the game opens it on. */
export function journalEntries(p: JournalSave): JournalEntry[] {
  const at: Places = { bhato: bhatoDirection(p), library: coord(p.libraryArea), scaal: coord(p.riftQuestArea) };
  const out: JournalEntry[] = [{ stage: null, ...FIRST }];
  for (let stage = 0; stage <= p.mainQuest; stage++) {
    const entry = ENTRIES[stage];
    if (entry) out.push({ stage, ...entry(at) });
  }
  return out;
}

function entryView(e: JournalEntry, n: number, tag = "li"): HTMLElement {
  return h(
    tag,
    { class: "journal-entry" },
    h("div", { class: "journal-entry-head" }, h("strong", {}, `Entry ${n}`), ` · ${e.title}`),
    h("p", { class: "journal-text" }, e.text),
  );
}

/** The newest entry, a note for a stage that adds none, then the earlier entries under a collapsible list. */
export function journalView(p: JournalSave, key: string, expanded?: Set<string>): HTMLElement[] {
  const entries = journalEntries(p);
  const last = entries.length - 1;
  const note = stageNote(p.mainQuest);
  const earlier = `${key}/earlier`;
  return [
    h("div", { class: "journal-latest" }, entryView(entries[last], last + 1, "div")),
    note ? h("p", { class: "journal-note" }, `${note} The journal adds no entry for this step.`) : null,
    last > 0
      ? h(
        "details",
        { class: "journal-earlier", "data-remember": earlier, open: expanded?.has(earlier) ?? false },
        h("summary", {}, `Earlier entries (${last})`),
        h("ol", { class: "journal-entries" }, entries.slice(0, last).map((e, i) => entryView(e, i + 1))),
      )
      : null,
    h(
      "p",
      { class: "muted journal-about" },
      `Main quest stage ${p.mainQuest}. The entries are the ones the game lists after loading this save, summarised in MirkMap's ` +
        "own words. ",
      wikiLink(wikiUrl("Quests and journal"), "Quests and journal"),
      " (story spoilers)",
    ),
  ].filter((e): e is HTMLElement => !!e);
}

/** The newest entry's number and title, for a collapsed panel's summary. */
export function journalHeadline(p: JournalSave): string {
  const entries = journalEntries(p);
  return `Entry ${entries.length} · ${entries[entries.length - 1].title}`;
}

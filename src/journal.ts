// The character's journal, as Mirklurk 0.9.1.2 rebuilds it from the saved main-quest stage (mainQ, global.MAINQUESTSTAGE) when
// it loads a save: journal_update in gml_GlobalScript_scr_basic_useful pushes UI.ini [Journal] "First", then the entry of every
// stage from 0 up to the saved one that has text, filling in the place each "CCC" stands for. Stages without text add nothing.
// The text is the game's own (src/gamedata.ts). MirkMap adds a short title to each entry and links the people and places it
// mentions, which `locateTarget` finds in the save so the map can show them.

import { h } from "./dom.ts";
import { BEING_NAMES, JOURNAL, JOURNAL_FIRST, TO_THE_DIR } from "./gamedata.ts";
import { wikiLink } from "./inspect.ts";
import { detailMarks, type Mark, solidMarks } from "./objects.ts";
import { Area, coordLabel, INTERIOR_NAMES, LANDMARK_NAMES, MAGUS_REALM, SolidId } from "./rules.ts";
import { destination, type PlayerSave } from "./save.ts";
import { type Interior, interiorsOf, loadDetail, type QuestZone, questZone, type World, type Zone, type ZoneDetail } from "./world.ts";
import { wikiUrl } from "./wiki.ts";

export type JournalSave =
  & Pick<PlayerSave, "mainQuest" | "grid" | "rangerCamp" | "libraryArea" | "riftQuestArea">
  & Partial<Pick<PlayerSave, "campQuest">>;

/** A person or place an entry mentions. */
export type JournalTarget =
  /** A person by being index; `home` is where to look when the save has no such being (not met yet, or gone). */
  | { kind: "being"; index: number; home: JournalTarget }
  /** A quest building by solid index; while it is not placed yet, its quest zone. */
  | { kind: "building"; solid: number; zone?: QuestZone }
  /** An interior by area type: the saved one, else the entrance that leads there, else `via` or the quest zone. */
  | { kind: "interior"; type: number; zone?: QuestZone; via?: JournalTarget }
  | { kind: "zone"; zone: QuestZone }
  /** The rift nearest the Camp, where Clay's rift samples come from (any rift gives a Rift Weave, scr_smartones). */
  | { kind: "rift" };

export interface JournalSegment {
  text: string;
  link?: JournalTarget;
}

export interface JournalEntry {
  /** The main-quest stage that adds it; null for the opening entry every journal starts with. */
  stage: number | null;
  /** MirkMap's short title for it; the game shows only "Entry n". */
  title: string;
  /** The game's text with its places filled in. */
  text: string;
  /** The same text, split where it mentions a person or place. */
  segments: JournalSegment[];
}

const building = (solid: number, zone?: QuestZone): JournalTarget => ({ kind: "building", solid, zone });
const FORT = building(SolidId.Fort);
const CAMP = building(SolidId.Camp);
const SHIP = building(SolidId.Boat);
const HIDEOUT = building(SolidId.Hideout, "bhato");
const LIBRARY = building(SolidId.Library, "library");
const LAIR = building(SolidId.Lair, "scaal");
const BHATO_ZONE: JournalTarget = { kind: "zone", zone: "bhato" };
const LIBRARY_ZONE: JournalTarget = { kind: "zone", zone: "library" };
const UNDERCROFT: JournalTarget = { kind: "interior", type: 30, via: FORT };
const FORT_INSIDE: JournalTarget = { kind: "interior", type: 32, via: FORT };
const CELLAR: JournalTarget = { kind: "interior", type: 21, zone: "bhato" };
const DEPTHS: JournalTarget = { kind: "interior", type: 24, zone: "scaal", via: LAIR };
const DEEPEST: JournalTarget = { kind: "interior", type: 26, zone: "scaal", via: DEPTHS };
const RIFT: JournalTarget = { kind: "rift" };
const REALM: JournalTarget = { kind: "interior", type: MAGUS_REALM };
const SURVIVORS_CAMP = building(SolidId.MotherHut);
const MOTHERS_HUT: JournalTarget = { kind: "interior", type: 36, via: SURVIVORS_CAMP };
const person = (index: number, home: JournalTarget): JournalTarget => ({ kind: "being", index, home });
const EIR = person(6, FORT);
const CLAY = person(8, UNDERCROFT);
/** Magus Clay in his realm (being 41), where he falls. */
const CLAY_IN_REALM = person(41, REALM);
const BHATO = person(12, HIDEOUT);
const VIEND = person(19, FORT);
const TAIN = person(20, FORT_INSIDE);
const SCAAL = person(22, DEEPEST);
const WILDA = person(34, SURVIVORS_CAMP);
const TERROR = person(40, SURVIVORS_CAMP);
const GRAND_MOTHER = person(36, MOTHERS_HUT);

export interface EntryInfo {
  title: string;
  /** Phrases of the game's text (whole words, every occurrence) and what they mention. */
  links: [string, JournalTarget][];
}

export const FIRST_INFO: EntryInfo = { title: "Exile", links: [["this wretched ship", SHIP]] };

/** Per stage of UI.ini [Journal]. "CCC" in a title or phrase is the place the game fills in. */
export const ENTRY_INFO: Readonly<Record<number, EntryInfo>> = {
  0: { title: "First supplies", links: [] },
  1: { title: "The ruined camp", links: [["The camp", CAMP]] },
  2: { title: "News for Eir", links: [["Eir", EIR], ["the camp", CAMP]] },
  3: { title: "Another night", links: [["Eir", EIR]] },
  4: { title: "Magus Clay", links: [["Eir", EIR], ["Clay", CLAY], ["the undercroft of the fort", UNDERCROFT]] },
  5: { title: "Rift samples", links: [["Clay", CLAY], ["the rift", RIFT]] },
  6: { title: "Clay's research", links: [["Clay", CLAY], ["Eir", EIR]] },
  7: {
    title: "Ranger Bhato",
    links: [["a ranger named Bhato", BHATO], ["the next area CCC", BHATO_ZONE], ["some hideout", HIDEOUT]],
  },
  8: { title: "The cellar", links: [["Bhato", BHATO], ["his area", BHATO_ZONE], ["an ancient cellar", CELLAR]] },
  9: { title: "The beast's drop", links: [["Bhato", BHATO]] },
  10: { title: "The rune", links: [["Clay", CLAY], ["Fort Solid", FORT]] },
  11: { title: "The potion", links: [["the abandonded camp site", CAMP], ["Clay", CLAY], ["one of the dead", CAMP]] },
  12: { title: "Back to life", links: [["One of the Unwanted", VIEND], ["Fort Solid", FORT]] },
  13: { title: "Viend at the fort", links: [["Viend", VIEND], ["the fort", FORT], ["Clay", CLAY], ["Captain Eir", EIR]] },
  15: { title: "Into the fort", links: [["Fort Solid", FORT], ["the commander", TAIN]] },
  16: { title: "Before the journey", links: [["Clay", CLAY]] },
  17: { title: "The ruins at CCC", links: [["area CCC", LIBRARY_ZONE]] },
  18: { title: "At the ruins", links: [["the ruins", LIBRARY]] },
  19: { title: "The strongbox", links: [["Clay", CLAY]] },
  20: { title: "While Clay works", links: [["the commander", TAIN], ["Clay", CLAY]] },
  23: { title: "After the blast", links: [["the commander", TAIN]] },
  24: { title: "Will Clay talk?", links: [["Clay", CLAY]] },
  25: { title: "Clay vanishes", links: [["Clay", CLAY]] },
  26: { title: "Clay's item", links: [["Clay", CLAY], ["CCC", LAIR]] },
  28: { title: "The depths", links: [["these depths", DEPTHS], ["Scaal", SCAAL]] },
  29: { title: "Scaal defeated", links: [["Scaal", SCAAL], ["Eir", EIR]] },
  30: { title: "Free", links: [] },
  31: { title: "Clay is dead", links: [["Clay", CLAY_IN_REALM], ["Eir", EIR], ["Fort Solid", FORT]] },
  32: { title: "At peace", links: [["Eir", EIR]] },
};

interface Places {
  bhato: string;
  library: string;
  scaal: string;
}

/** Which place each entry's "CCC" stands for (journal_update). */
const FILLS: Readonly<Record<number, keyof Places>> = { 7: "bhato", 17: "library", 26: "scaal" };

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

/**
 * The Survivors' side quest at Wilda's camp, by its stage (campQ, global.campQUESTstage: Wilda's dialogue in scr_menu_related,
 * The Terror's death in obj_being Alarm_0). The game keeps it out of the journal, so this is MirkMap's summary, not the game's text.
 */
export const CAMP_QUEST: Readonly<Record<number, EntryInfo & { text: string }>> = {
  0: {
    title: "The Terror",
    text:
      "Wilda will trust you once you bring her the head of The Terror, an extra vicious Mirkfang Matriarch who stalks this Savage Mirk at night but never comes near the Survivors' camp.",
    links: [["Wilda", WILDA], ["The Terror", TERROR], ["the Survivors' camp", SURVIVORS_CAMP]],
  },
  1: {
    title: "The Terror is slain",
    text: "The Terror is slain. Bring her head to Wilda.",
    links: [["The Terror", TERROR], ["Wilda", WILDA]],
  },
  2: {
    title: "Trusted",
    text: "Wilda trusts you: you may visit Grand Mother for her blessing, and Wilda now answers a Summoning Stone's call.",
    links: [["Wilda", WILDA], ["Grand Mother", GRAND_MOTHER]],
  },
};

/** map_get_fort_xy: the fort's zone, searched column by column; [-4, -4] without one. */
function fortZone(grid: number[][]): [number, number] {
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) if (grid[y]?.[x] === Area.Fort) return [x, y];
  return [-4, -4];
}

/** Entry 7's direction: Bhato's zone seen from the fort, east or west winning over south, else north (journal_update). */
export function bhatoDirection(p: Pick<PlayerSave, "grid" | "rangerCamp">): string {
  if (!p.rangerCamp) return "";
  const [cx, cy] = p.rangerCamp, [fx, fy] = fortZone(p.grid);
  let dir = cy > fy ? 1 : 0;
  if (cx > fx) dir = 2;
  else if (cx < fx) dir = 3;
  return TO_THE_DIR[dir] ?? "";
}

/** textf_array_to_mapcoord, as coordLabel. */
const coord = (c: [number, number] | null) => (c ? coordLabel(c[0], c[1]) : "?");

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Splits `text` at every whole-word occurrence of the phrases, longer phrases first where they overlap. */
export function linkSegments(text: string, links: [string, JournalTarget][]): JournalSegment[] {
  const hits: { at: number; end: number; link: JournalTarget }[] = [];
  for (const [phrase, link] of [...links].sort((a, b) => b[0].length - a[0].length)) {
    for (const m of text.matchAll(new RegExp(`\\b${escape(phrase)}\\b`, "g"))) {
      const at = m.index, end = at + phrase.length;
      if (!hits.some((o) => at < o.end && end > o.at)) hits.push({ at, end, link });
    }
  }
  hits.sort((a, b) => a.at - b.at);
  const out: JournalSegment[] = [];
  let i = 0;
  for (const hit of hits) {
    if (hit.at > i) out.push({ text: text.slice(i, hit.at) });
    out.push({ text: text.slice(hit.at, hit.end), link: hit.link });
    i = hit.end;
  }
  if (i < text.length) out.push({ text: text.slice(i) });
  return out;
}

function entry(stage: number | null, raw: string, info: EntryInfo | undefined, at: Places): JournalEntry {
  const place = stage === null ? undefined : FILLS[stage];
  // journal_update replaces the first "CCC" only; without a place to put there, it is dropped with its space.
  const fill = (s: string) => place ? s.replace(at[place] ? "CCC" : / ?CCC/, at[place]) : s;
  const segments = linkSegments(raw, info?.links ?? []).map((s) => ({ ...s, text: fill(s.text) }));
  return {
    stage,
    title: fill(info?.title ?? (stage === null ? "First entry" : `Stage ${stage}`)),
    text: segments.map((s) => s.text).join(""),
    segments,
  };
}

/** The journal's entries in the game's order (Entry 1 first); the last is the one the game opens it on. */
export function journalEntries(p: JournalSave): JournalEntry[] {
  const at: Places = { bhato: bhatoDirection(p), library: coord(p.libraryArea), scaal: coord(p.riftQuestArea) };
  const out = [entry(null, JOURNAL_FIRST, FIRST_INFO, at)];
  for (let stage = 0; stage <= p.mainQuest; stage++) {
    const raw = JOURNAL[stage];
    if (raw !== undefined && raw !== "unknown") out.push(entry(stage, raw, ENTRY_INFO[stage], at));
  }
  return out;
}

/** How a link names what it shows. */
export function targetName(t: JournalTarget): string {
  switch (t.kind) {
    case "being":
      return BEING_NAMES[t.index] ?? "them";
    case "building":
      return t.solid === SolidId.Boat ? "the ship" : LANDMARK_NAMES[t.solid] ?? "it";
    case "interior":
      return INTERIOR_NAMES[t.type] ?? "it";
    case "zone":
      return { bhato: "Bhato's zone", library: "the Library's zone", scaal: "Scaal's zone" }[t.zone];
    case "rift":
      return "the rift nearest the Camp";
  }
}

/** Where a link's person or place is in the save: a zone or interior to show, and its marker there when it has one. */
export interface Located {
  zone: Zone;
  interior?: Interior;
  mark?: Mark;
}

/** Finds a link's person or place in the world, falling back as each target says; undefined when the save has no trace of it. */
export async function locateTarget(world: World, t: JournalTarget): Promise<Located | undefined> {
  const inZone = (q: QuestZone | undefined, [x, y]: [number, number]) => {
    const z = q && questZone(world, q);
    return !q || (!!z && z.x === x && z.y === y);
  };
  const zoneAt = ([x, y]: [number, number]) => world.zones[y]?.[x];
  const solidMark = (zone: Zone, solid: Zone["solids"][number]) => solidMarks([solid], interiorsOf(world, zone.x, zone.y))[0];
  switch (t.kind) {
    case "being": {
      const find = (d: ZoneDetail) => detailMarks(d).find((m) => m.being === t.index && (m.layer === "npcs" || m.layer === "creatures"));
      for (const zone of world.zones.flat()) {
        const mark = zone.dir ? find(await loadDetail(world, zone.dir)) : undefined;
        if (mark) return { zone, mark };
      }
      for (const interior of world.interiors) {
        const zone = zoneAt(interior.zone);
        const mark = zone && find(await loadDetail(world, interior.dir));
        if (zone && mark) return { zone, interior, mark };
      }
      return locateTarget(world, t.home);
    }
    case "building": {
      for (const zone of world.zones.flat()) {
        const solid = zone.solids.find((s) => s.index === t.solid);
        if (solid) return { zone, mark: solidMark(zone, solid) };
      }
      const zone = t.zone && questZone(world, t.zone);
      return zone ? { zone } : undefined;
    }
    case "interior": {
      const interior = world.interiors.find((i) => i.kind === t.type && inZone(t.zone, i.zone));
      const zone = interior && zoneAt(interior.zone);
      if (interior && zone) return { zone, interior };
      for (const z of world.zones.flat()) {
        if (!inZone(t.zone, [z.x, z.y])) continue;
        const door = z.solids.find((s) => destination(s)?.[0] === t.type);
        if (door) return { zone: z, mark: solidMark(z, door) };
      }
      if (t.via) return locateTarget(world, t.via);
      const qz = t.zone && questZone(world, t.zone);
      return qz ? { zone: qz } : undefined;
    }
    case "zone": {
      const zone = questZone(world, t.zone);
      return zone ? { zone } : undefined;
    }
    case "rift": {
      const fort = world.zones.flat().find((z) => z.type === Area.Fort);
      const camp = fort?.solids.find((s) => s.index === SolidId.Camp);
      const far = (z: Zone) => (fort ? Math.abs(z.x - fort.x) + Math.abs(z.y - fort.y) : 0);
      for (const zone of world.zones.flat().filter((z) => z.dir).sort((a, b) => far(a) - far(b))) {
        const rifts = detailMarks(await loadDetail(world, zone.dir!)).filter((m) => m.layer === "rifts");
        // Live rifts first (dead ones have no radius), then the one beside the Camp.
        const rank = (m: Mark) => (m.radius ? 0 : 1e9) + (camp && zone === fort ? Math.hypot(m.x - camp.x, m.y - camp.y) : 0);
        rifts.sort((a, b) => rank(a) - rank(b));
        if (rifts.length) return { zone, mark: rifts[0] };
      }
      return undefined;
    }
  }
}

/** Shows a link's person or place on the map. */
export type FindTarget = (t: JournalTarget) => void;

function textView(segments: JournalSegment[], find?: FindTarget): HTMLElement {
  return h(
    "p",
    { class: "journal-text" },
    segments.map((s) =>
      s.link && find
        ? h("button", {
          type: "button",
          class: "link journal-link",
          title: `Show ${targetName(s.link)} on the map`,
          onclick: () => find(s.link!),
        }, s.text)
        : s.text
    ),
  );
}

function entryView(e: JournalEntry, n: number, find?: FindTarget, tag = "li"): HTMLElement {
  return h(
    tag,
    { class: "journal-entry" },
    h("div", { class: "journal-entry-head" }, h("strong", {}, `Entry ${n}`), ` · ${e.title}`),
    textView(e.segments, find),
  );
}

/** The Survivors' side quest, when it has begun: its stage's summary (CAMP_QUEST), with its people and places linked. */
function campQuestView(stage: number | undefined, find?: FindTarget): HTMLElement | null {
  const info = stage === undefined ? undefined : CAMP_QUEST[stage];
  if (!info) return null;
  return h(
    "div",
    { class: "journal-entry journal-side" },
    h("div", { class: "journal-entry-head" }, h("strong", {}, "Survivors' camp"), ` · ${info.title}`),
    textView(linkSegments(info.text, info.links), find),
    h("p", { class: "muted" }, "A side quest the game keeps out of the journal; MirkMap sums up where it stands."),
  );
}

/**
 * The newest entry, a note for a stage that adds none, then the earlier entries under a collapsible list. With `find`, the people
 * and places the entries mention are links that show them on the map.
 */
export function journalView(p: JournalSave, key: string, expanded?: Set<string>, find?: FindTarget): HTMLElement[] {
  const entries = journalEntries(p);
  const last = entries.length - 1;
  const note = stageNote(p.mainQuest);
  const earlier = `${key}/earlier`;
  return [
    h("div", { class: "journal-latest" }, entryView(entries[last], last + 1, find, "div")),
    note ? h("p", { class: "journal-note" }, `${note} The journal adds no entry for this step.`) : null,
    campQuestView(p.campQuest, find),
    last > 0
      ? h(
        "details",
        { class: "journal-earlier", "data-remember": earlier, open: expanded?.has(earlier) ?? false },
        h("summary", {}, `Earlier entries (${last})`),
        h("ol", { class: "journal-entries" }, entries.slice(0, last).map((e, i) => entryView(e, i + 1, find))),
      )
      : null,
    h(
      "p",
      { class: "muted journal-about" },
      `Main quest stage ${p.mainQuest}. The entries the game lists after loading this save${
        find ? "; click a name or place to see it on the map" : ""
      }. `,
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

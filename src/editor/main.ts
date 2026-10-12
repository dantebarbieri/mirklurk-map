// Entry point of the save editor (edit.html, served at /edit/): open a character folder for writing, confirm that saving marks the
// world as Cheated, then change it. The edits are in edits.ts, items.ts and beings.ts; writing and backups in session.ts. The
// character preview is the map's own player inspection (player.ts), shown as the edits will be saved, and the Full map is the map's
// own world view (view.ts) of the save as it would be saved, where the Move tool picks where you stand.

import { $, h } from "../dom.ts";
import { type Character, characterIndex, type FileMap, fromDataTransfer, fromFiles } from "../files.ts";
import { BEING_NAMES, ITEM_NAMES } from "../gamedata.ts";
import { libraryId, worldId, type WorldInfo } from "../sharing-format.ts";
import { cheatedInfo, knownCheated } from "../cheated.ts";
import { isSaveFile, markerText } from "../marker.ts";
import { api, libraryKey, libraryKeyFor } from "../library.ts";
import { offerDownload } from "../download.ts";
import { fileMapOf, forget, type Handoff, handOff, type OpenSave, remember, storedFiles, takeHandoff } from "../handoff.ts";
import { type Being, decodeJson, parseBeings, parsePlaced, parsePlayer, type PlayerSave } from "../save.ts";
import { type Interior, interiorsOf, loadDetail, loadHeights, loadLayer, loadTrees, loadWorld, type World, type Zone } from "../world.ts";
import {
  CONDITIONS,
  MAX_LEVEL,
  percent,
  playerView,
  sicknessLevel,
  STAT_LABELS,
  temperatureLabel,
  wetClothes,
  xpForLevel,
} from "../player.ts";
import { creatureView } from "../creature.ts";
import { Coin, coinsView, countCoins } from "../coins.ts";
import { coordLabel, INTERIOR_NAMES, isOutside, TILES } from "../rules.ts";
import { spriteBox } from "../predict.ts";
import { BEINGS, targetsYou } from "../bestiary.ts";
import { BLEED_DIRS, cellKind, cellPlace, cellTitle, healthGridPicker, parseHealth } from "../health.ts";
import { formatClock, parseSky, Weather, WEATHER_LABELS, weatherKind, type WeatherState } from "../weather.ts";
import {
  type Backup,
  canWriteFolders,
  CopySource,
  type Edit,
  type EditDirectory,
  EditSession,
  FolderSource,
  LibrarySource,
  listBackups,
  type SaveRead,
  type SaveSource,
  type WritablePicker,
} from "./session.ts";
import {
  type ConditionsEdit,
  healPlayer,
  type HitPointStatus,
  hitPointStatus,
  insideOf,
  isInside,
  MAX_DAY,
  MAX_SKILL_POINTS,
  MAX_STACKS,
  MAX_TURNS,
  MIN_RAIN,
  playerRecord,
  type Rec,
  setConditions,
  setHitPointStatus,
  setLevel,
  setNewHitPoints,
  setSkillPoints,
  setSky,
  setStunned,
  setVitals,
  type SkyEdit,
  TIMED,
  type Timed,
  type VitalsEdit,
} from "./edits.ts";
import {
  addable,
  addItems,
  type Bag,
  carriedBags,
  type CarriedItem,
  carriedItems,
  type ConditionEdit,
  countInside,
  dryAll,
  freeCells,
  freeSlots,
  freeSlotsFor,
  itemAt,
  moveItem,
  needing,
  refuelAll,
  removeItem,
  repairAll,
  roomFor,
  setCondition,
  type Upkeep,
  wearCarried,
  wearNew,
} from "./items.ts";
import {
  amountText,
  canGetWet,
  conditionOf,
  conditionParts,
  DURABILITY_LABELS,
  durabilityKind,
  fuelMax,
  isWet,
  type ItemState,
  wetText,
} from "../condition.ts";
import { conditionView } from "../inspect.ts";
import { SLOT_NAMES } from "../armor.ts";
import { deleteBeing, habitat, habitatRefusal, isQuestBeing, spawnable, spawnBeing } from "./beings.ts";
import { type Box, Ground, GROUND_TEXT, type GroundKind, groundMap, reachable, tileBox } from "./ground.ts";
import {
  addRaft,
  dockTile,
  isRaft,
  moveWithRaft,
  onRaft,
  RAFT,
  raftable,
  raftMap,
  takeRaft,
  tileHeight,
  WATER_LAYERS,
  waterEffect,
  waterKind,
  type WaterLayers,
  waterText,
  wetMap,
} from "./raft.ts";
import { disposeView, rememberView, renderWorld, showJournalTarget, type State, worldState } from "../view.ts";
import type { JournalTarget } from "../journal.ts";
import { LAYERS } from "../objects.ts";
import { setFullMap } from "../fullscreen.ts";
import { ask, type Choice, choose, form } from "../dialog.ts";

/** An area the map card shows: an outdoor zone or one of its interiors. */
interface Area {
  zone: Zone;
  interior?: Interior;
  dir: string;
}
type Tool = "inspect" | "move" | "spawn";
/** The editor's cards, or MirkMap's full map of the save as it would be saved. */
type View = "edit" | "map";
/** Where the full map was looking, to keep it there when the map is drawn again. */
type MapPlace = Pick<State, "selected" | "interiorDir" | "viewport" | "inspected" | "expanded">;

/** The save being opened or open; a failed open puts back the session's. */
let source: SaveSource | undefined;
/** The folder open came from MirkMap's Live saves, which watches it again when it gets the folder back. */
let folderLive = false;
let chars: Character[] = [];
let active = 0;
let session: EditSession | undefined;
let world: World | undefined;
let cheated = false;
let editing = false;
let area: Area | undefined;
let tool: Tool = "inspect";
let spawnIndex = Number(Object.keys(BEINGS).find((i) => spawnable(Number(i))));
let selected: number | undefined;
/** The hit point picked in the Hit points card, [x, y]. */
let hpPick: [number, number] | undefined;
/** Open sections of the preview, once the user has opened or closed one. */
let expanded: Set<string> | undefined;
const notes = new Map<string, { text: string; error?: boolean }>();
let renderToken = 0;
let view: View = "edit";
/** The full map while it is shown, with the blob: URLs of its zone maps. */
let map: { state: State; urls: string[] } | undefined;
/** The full map's Move tool is on: a click on its empty ground moves you there. */
let moving = false;
/** A person or place from the preview's journal for the full map to show once it is drawn. */
let mapTarget: JournalTarget | undefined;
/** The full map's layers and modes, kept while the page is open. */
const mapPrefs: State["prefs"] = {
  layers: new Set(LAYERS.filter((l) => l.on).map((l) => l.id)),
  water: false,
  realistic: false,
  treeMin: 0,
};
/** The folder open is the dev server's throwaway copy (devOpen), not a real save. */
let devCopy = false;

const playerPath = () => `${session!.character.root}Player.save`;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function status(text: string, error = false) {
  const el = $("#status");
  el.textContent = text;
  el.classList.toggle("error", error);
}

function note(card: string, text: string, error = false) {
  notes.set(card, { text, error });
}
const noteView = (card: string) => {
  const n = notes.get(card);
  return n ? h("p", { class: `edit-note${n.error ? " error" : ""}`, role: "status" }, n.text) : null;
};

// --- Opening a save ---

const picker = globalThis as WritablePicker;

/** Where the save open came from, as the page names it. */
function sourceText(src: SaveSource): string {
  if (src instanceof FolderSource) return `the folder ${src.dir.name}`;
  if (src instanceof LibrarySource) return "My worlds";
  return (src as CopySource).label;
}

/** The game's folder, opened to write where the browser can (desktop Chrome and Edge); elsewhere it is read as a copy. */
async function openFolder() {
  if (!canWriteFolders()) {
    $<HTMLInputElement>("#pick-folder").click();
    return;
  }
  let dir: EditDirectory;
  try {
    dir = await picker.showDirectoryPicker!({ mode: "readwrite", id: "mirklurk-saves" });
  } catch (e) {
    if ((e as DOMException).name !== "AbortError") status(`Could not open the folder: ${errorText(e)}`, true);
    return;
  }
  await openSource(new FolderSource(dir));
}

/**
 * A world in My worlds, from the library it is in (`library`, its ID) when this browser still keeps that library, or else from the
 * library in use.
 */
async function libraryWorld(id: string, library?: string): Promise<LibrarySource> {
  const key = library ? await libraryKeyFor(library) : libraryKey();
  if (!key) {
    throw new Error(
      library
        ? "That world is in a library this browser no longer keeps. Sync it again from another device, or open the world another way."
        : "This browser has no library. Add a world to My worlds in MirkMap first.",
    );
  }
  return new LibrarySource(id, (path, init) => api(path, key, init), library ?? await libraryId(key));
}

/** A .zip, dropped files or a folder read without write access, edited as a copy. */
async function openCopy(read: Promise<FileMap>, label: string) {
  status("Reading the save...");
  try {
    await openSource(await CopySource.of(await read, label));
  } catch (e) {
    console.error(e);
    status(`Could not read the save: ${errorText(e)}`, true);
  }
}

/**
 * Opens the save `next` and shows the character `want` (or the first); edit mode ends and unsaved edits are dropped once it is read.
 * Until then, and if it can't be read, the save open stays as it was. `live`: a folder MirkMap's Live saves was watching, which it
 * watches again when it gets the folder back; `dev`: the dev server's throwaway copy (devOpen).
 */
async function openSource(next: SaveSource, want?: Character, live = false, dev = false) {
  source = next;
  await openCharacter(0, want, { live, dev });
}

/**
 * Reads the save again and shows character `i` (or `want`); edit mode ends and unsaved edits are dropped. `fresh`: the save is newly
 * opened, with these settings.
 */
async function openCharacter(i: number, want?: Character, fresh?: Fresh) {
  const src = source;
  if (!src) return;
  status("Reading the save...");
  let read: SaveRead;
  try {
    read = await src.read();
  } catch (e) {
    console.error(e);
    if (source !== src) return;
    source = session?.source;
    status(errorText(e), true);
    return;
  }
  if (source === src) await install(src, read, want ?? (fresh ? undefined : chars[i]), false, fresh);
}

/** A newly opened save's settings (see openSource). */
interface Fresh {
  live: boolean;
  dev: boolean;
}

/** Shows the character `want` (or the first) of the save `read` from `src`, in a fresh session. */
async function install(src: SaveSource, read: SaveRead, want: Character | undefined, keepArea = false, fresh?: Fresh) {
  try {
    const found = read.characters;
    if (!found.length) throw new Error("No Player.save found. Choose a character's folder or the game's Saves folder.");
    const c = found[characterIndex(found, want)];
    const loaded = await loadWorld(read.files, c.root, c.name);
    const id = await worldId(c.name, loaded.player.grid);
    const marked = cheatedInfo(await markerText(read.files, c.root)) !== undefined || await knownCheated(id);
    if (source !== src) return;
    if (fresh) {
      editing = false;
      notes.clear();
      folderLive = fresh.live;
      devCopy = fresh.dev;
    }
    chars = found;
    active = found.indexOf(c);
    // Another character or save starts the full map afresh; after a save or restore it stays where it was.
    if (!keepArea) closeMap();
    session = new EditSession(src, read, c, id);
    world = loaded;
    cheated = marked;
    if (!keepArea || !area) area = playerArea(loaded.player);
    else area = sameArea(area);
    selected = undefined;
    hpPick = undefined;
    forgetMapImages();
    showCharacters();
    document.body.classList.add("loaded");
    status(`${c.name} loaded from ${sourceText(src)}${loaded.warnings.length ? ` with ${loaded.warnings.length} warnings` : ""}.`);
    void rememberOpen();
  } catch (e) {
    console.error(e);
    if (source !== src) return;
    source = session?.source;
    status(errorText(e), true);
    return;
  }
  await render();
}

function showCharacters() {
  const select = $<HTMLSelectElement>("#character");
  select.replaceChildren(...chars.map((ch, n) => h("option", { value: n, selected: n === active }, ch.name)));
  select.hidden = chars.length < 2;
}

/** The open save as MirkMap and the editor hand it over; undefined for the dev server's throwaway copy. */
async function openSave(s: EditSession): Promise<OpenSave | undefined> {
  if (devCopy) return undefined;
  if (s.source instanceof FolderSource) return { kind: "folder", handle: s.source.dir, live: folderLive };
  if (s.source instanceof LibrarySource) {
    return { kind: "world", id: s.source.id, name: s.character.name, library: s.source.library };
  }
  return { kind: "files", files: await storedFiles(s.files, s.character.root) };
}

/** Remembers the folder or library world open, so the editor opens it again next time it loads; a copy is not kept. */
async function rememberOpen() {
  const s = session;
  if (!s || devCopy) return;
  try {
    if (s.source.kind === "copy") await forget();
    else await remember({ save: (await openSave(s))!, character: s.character });
  } catch (e) {
    console.debug("Could not remember the open save", e);
  }
}

/** Shows the save `read` that `s` now edits, once its unsaved changes ran again on it. */
function settle(s: EditSession, read: SaveRead, c: Character, loaded: World, marked: boolean) {
  chars = read.characters;
  active = chars.indexOf(c);
  world = loaded;
  cheated = marked;
  area = area ? sameArea(area) : playerArea(loaded.player);
  selected = undefined;
  hpPick = undefined;
  savedRecords.delete(s);
  forgetMapImages();
  showCharacters();
  notes.clear();
}

/** "Your unsaved change still applies. Dropped, as ...": what running the changes again on another save did. */
function rerunText(s: EditSession, dropped: string[]): string {
  const n = s.changes.length;
  return (n ? ` ${n === 1 ? "Your unsaved change still applies" : `Your ${n} unsaved changes still apply`}.` : "") +
    (dropped.length
      ? ` Dropped, as ${dropped.length === 1 ? "it no longer applies" : "they no longer apply"}: ${dropped.join("; ")}.`
      : "");
}

/**
 * Reads the save again (after playing in the game, or after another device updated the world in My worlds) and runs the unsaved
 * changes again on the newest save, so they can still be saved. Changes that no longer apply, or now change nothing, are dropped and
 * named. If the folder now holds another world, loading it drops the changes, after asking.
 */
async function reloadSave() {
  const s = session;
  if (!s || s.saving || s.source.kind === "copy") return;
  status("Reading the save again...");
  let otherWorld = false;
  await locked(async () => {
    try {
      const read = await s.source.read();
      const c = read.characters.find((ch) => ch.root === s.character.root);
      if (!c) throw new Error(`${s.character.name}'s save is no longer in this folder. Open the folder again to choose a character.`);
      const loaded = await loadWorld(read.files, c.root, c.name);
      if (await worldId(c.name, loaded.player.grid) !== s.world) {
        otherWorld = true;
        return;
      }
      const marked = cheatedInfo(await markerText(read.files, c.root)) !== undefined || await knownCheated(s.world);
      const dropped = await s.rebase(read);
      if (session !== s) return;
      settle(s, read, c, loaded, marked);
      status(
        `Reloaded ${c.name}'s save${loaded.warnings.length ? ` with ${loaded.warnings.length} warnings` : ""}.` + rerunText(s, dropped),
        dropped.length > 0,
      );
    } catch (e) {
      console.error(e);
      status(errorText(e), true);
    }
  });
  if (otherWorld) {
    status(`${s.character.name}'s folder now holds a different world.`);
    if (!await dropChanges("Loading the new world", "Drop them and load it")) {
      status(`${s.character.name}'s folder now holds a different world; your unsaved changes cannot be saved to it.`, true);
      return;
    }
    editing = false;
    notes.clear();
    await openCharacter(active);
    return;
  }
  await render();
}

/**
 * Saves a copy's changes into the game's folder: asks for it (the character's folder or the Saves folder), finds the same world
 * there and runs the unsaved changes again on the save it holds, as Reload save does, so nothing the game saved since is lost. Saves
 * at once when every change still does what it did on the copy; otherwise shows what they do now, to check before saving.
 */
async function saveCopyToFolder(s: EditSession) {
  let dir: EditDirectory;
  try {
    dir = await picker.showDirectoryPicker!({ mode: "readwrite", id: "mirklurk-saves" });
  } catch (e) {
    if ((e as DOMException).name !== "AbortError") status(`Could not open the folder: ${errorText(e)}`, true);
    return;
  }
  const folder = new FolderSource(dir);
  const before = [...s.changes];
  let same = false;
  status(`Reading ${dir.name}...`);
  await locked(async () => {
    try {
      const read = await folder.read();
      let c: Character | undefined;
      for (const ch of read.characters) {
        if (ch.name !== s.character.name) continue;
        const p = parsePlayer(decodeJson(await read.files.get(`${ch.root}Player.save`)!.read()));
        if (await worldId(ch.name, p.grid) === s.world) {
          c = ch;
          break;
        }
      }
      if (!c) {
        throw new Error(
          `${dir.name} has no save of this world of ${s.character.name}. Choose ${s.character.name}'s folder in the game's Saves ` +
            "folder, or the Saves folder itself.",
        );
      }
      const loaded = await loadWorld(read.files, c.root, c.name);
      const marked = cheatedInfo(await markerText(read.files, c.root)) !== undefined || await knownCheated(s.world);
      const dropped = await s.rebase(read, { source: folder, character: c });
      if (session !== s) return;
      source = folder;
      folderLive = false;
      settle(s, read, c, loaded, marked);
      void rememberOpen();
      same = !dropped.length && s.changes.every((line, i) => line === before[i]);
      if (!same) {
        status(
          `The save in ${dir.name} is not the one this copy was made from, so your changes ran again on it.` +
            rerunText(s, dropped) + " Nothing is saved yet: check them below, then save.",
          true,
        );
      }
    } catch (e) {
      console.error(e);
      status(errorText(e), true);
    }
  });
  if (same && session === s) await save();
  else await render();
}

/**
 * What the map or the editor had open, opened here: a world from My worlds, a copy of files, or a folder, read at once while this
 * browser still lets the page read it and otherwise after a click.
 */
async function openHandoff({ save, character }: Handoff, handed: boolean) {
  if (save.kind === "world") return openSource(await libraryWorld(save.id, save.library), character);
  if (save.kind === "files") {
    return openSource(new CopySource(fileMapOf(save.files), "what MirkMap had open", character), character);
  }
  const folder = new FolderSource(save.handle as EditDirectory);
  const live = handed && !!save.live;
  if (await folder.allowed("read", false)) return openSource(folder, character, live);
  const again = $("#reopen");
  again.replaceChildren(
    h("button", {
      class: "button",
      type: "button",
      onclick: async () => {
        // Reading is enough until the first save, which asks to write (see writable).
        if (!await folder.allowed("read", true)) {
          status(`The browser did not let MirkMap open ${folder.dir.name}. Choose Open save folder... instead.`, true);
          return;
        }
        again.hidden = true;
        await openSource(folder, character, live);
      },
    }, `Open ${folder.dir.name} again`),
    h("span", { class: "muted" }, ` The folder ${handed ? "MirkMap had" : "you had"} open; your browser asks first.`),
  );
  again.hidden = false;
}

/** The worlds in this browser's library, offered in the header to edit. */
async function listWorlds() {
  const key = libraryKey();
  if (!key) return;
  try {
    const { worlds } = await (await api("/library", key)).json() as { worlds: WorldInfo[] };
    // Each world is opened from the library it was listed from, even if another tab switches libraries meanwhile.
    const library = await libraryId(key);
    const select = $<HTMLSelectElement>("#open-world");
    select.replaceChildren(
      h("option", { value: "" }, "Edit from My worlds..."),
      ...worlds.map((w) => h("option", { value: w.id, "data-library": library }, `${w.name}${w.cheated ? " (Cheated)" : ""}`)),
    );
    select.hidden = !worlds.length;
  } catch (e) {
    console.debug("My worlds are unavailable", e);
  }
}

function playerArea(p: PlayerSave): Area | undefined {
  const w = world!;
  const zone = w.zones[p.area.y]?.[p.area.x];
  if (!zone) return undefined;
  const inside = interiorsOf(w, zone.x, zone.y).find((it) => isInside(p, it));
  if (inside) return { zone, interior: inside, dir: inside.dir };
  return zone.dir ? { zone, dir: zone.dir } : firstArea();
}

const firstArea = (): Area | undefined => {
  const zone = world!.zones.flat().find((z) => z.dir);
  return zone ? { zone, dir: zone.dir! } : undefined;
};

/** The same area in a freshly loaded world. */
function sameArea(a: Area): Area | undefined {
  const zone = world!.zones[a.zone.y][a.zone.x];
  const interior = a.interior && world!.interiors.find((it) => it.dir === a.interior!.dir);
  return interior ? { zone, interior, dir: interior.dir } : zone.dir ? { zone, dir: zone.dir } : firstArea();
}

/** The area the full map was looking at: that interior, or that zone once explored. */
function mapArea(place: MapPlace): Area | undefined {
  const w = world!;
  const interior = place.interiorDir ? w.interiors.find((it) => it.dir === place.interiorDir) : undefined;
  const parent = interior && w.zones[interior.zone[1]]?.[interior.zone[0]];
  if (interior && parent) return { zone: parent, interior, dir: interior.dir };
  const zone = place.selected && w.zones[place.selected[1]]?.[place.selected[0]];
  return zone && zone.dir ? { zone, dir: zone.dir } : undefined;
}

const areaName = (a: Area) => {
  const zone = `${coordLabel(a.zone.x, a.zone.y)} ${a.zone.name}`;
  return a.interior ? `${INTERIOR_NAMES[a.interior.kind ?? -1] ?? "Interior"} in ${zone}` : zone;
};

// --- Editing ---

/**
 * Applies an edit and shows its result on `card`. The edit must read only the draft it is given (read form fields and other page
 * state before making it), because undoing an earlier change runs it again.
 */
const edit = (card: string, path: string, change: Edit) => editAll(card, [{ path, edit: change }]);

/** Applies several files' edits as one change (undone together), like `edit`. */
async function editAll(card: string, steps: { path: string; edit: Edit }[]) {
  try {
    const text = await session!.applyAll(steps);
    if (text) note(card, `${text}. Not saved yet.`);
  } catch (e) {
    note(card, errorText(e), true);
  }
  await render();
}

const editPlayer = (card: string, change: (p: Rec, raw: unknown) => string | undefined) =>
  edit(card, playerPath(), (raw) => change(playerRecord(raw), raw));

/** Undoes unsaved change `i`; later changes to the same file run again, and any that no longer apply are dropped and named. */
async function undoChange(i: number) {
  const s = session;
  if (!s || s.saving) return;
  const what = s.changes[i];
  try {
    const dropped = await s.undo(i);
    notes.clear();
    status(
      `Undid: ${what}.` +
        (dropped.length
          ? ` Also dropped, as ${dropped.length === 1 ? "it no longer applies" : "they no longer apply"}: ${dropped.join("; ")}.`
          : ""),
      dropped.length > 0,
    );
  } catch (e) {
    status(errorText(e), true);
  }
  await render();
}

/** Locks the page while a save or restore writes files, or a reload reads them, so nothing changes or discards the drafts meanwhile. */
async function locked<T>(run: () => Promise<T>): Promise<T> {
  document.body.classList.add("busy");
  const buttons = [$<HTMLButtonElement>("#save"), $<HTMLButtonElement>("#download")];
  for (const b of buttons) b.disabled = true;
  try {
    return await run();
  } finally {
    document.body.classList.remove("busy");
    for (const b of buttons) b.disabled = false;
  }
}

/**
 * Whether the session's folder may be written; asking needs this click. MirkMap hands over a folder it was allowed to read, and the
 * browser forgets what it allowed once every tab of the site is closed.
 */
async function writable(s: EditSession): Promise<boolean> {
  if (!(s.source instanceof FolderSource) || await s.source.allowed("readwrite", true)) return true;
  status(`Saving needs your browser's permission to change the files in ${s.source.dir.name}. Try again to be asked again.`, true);
  return false;
}

/** Saves the unsaved changes where the save came from: the game's folder or My worlds. A copy asks for the game's folder first. */
async function save() {
  const s = session;
  if (!s || s.saving) return;
  if (s.source instanceof CopySource) return saveCopyToFolder(s);
  if (!await writable(s)) return;
  const library = s.source instanceof LibrarySource;
  status(library ? `Saving ${s.character.name} to My worlds...` : "Saving...");
  await locked(async () => {
    try {
      const n = await s.save();
      // Another save opened meanwhile (with the keyboard: the page is locked to the pointer) stays on screen.
      if (session !== s) return;
      cheated = true;
      notes.clear();
      await install(s.source, s.current, s.character, true);
      editing = true;
      const files = n === 1 ? "1 file" : `${n} files`;
      status(
        (library
          ? `Saved ${files} to ${s.character.name} in My worlds, where your synced devices see it within 30 seconds. ` +
            "This world is now marked Cheated. To play it, download it."
          : `Saved ${files}. This world is now marked Cheated. Load it from the game's menu to play it.`) +
          (s.warning ? ` ${s.warning}.` : ""),
        !!s.warning,
      );
      await render();
    } catch (e) {
      console.error(e);
      status(errorText(e), true);
    }
  });
}

/** Downloads the save as saving would leave it, with the Cheated mark; the changes stay unsaved where the save came from. */
async function download() {
  const s = session;
  if (!s || s.saving) return;
  try {
    const zip = await s.download();
    offerDownload(zip);
    if (session !== s) return;
    cheated = true;
    status(
      `Downloaded ${zip.filename} with your changes and the Cheated mark. To play it, put its ${zip.folder} folder into the game's ` +
        `Saves folder and load ${zip.folder}; if Saves already has an older ${zip.folder} folder, move it out first.` +
        (s.source.kind === "library" ? " Your changes are not in My worlds until you save them there." : ""),
    );
  } catch (e) {
    console.error(e);
    status(`Could not download the save: ${errorText(e)}`, true);
  }
  await render();
}

async function restore(b: Backup) {
  const s = session;
  if (!s || s.saving) return;
  const when = new Date(b.at).toLocaleString();
  if (
    !await ask({
      title: `Restore the files from before ${when}?`,
      body: [
        `This writes back the ${b.files.length === 1 ? "file" : `${b.files.length} files`} the world had before the edits saved then: ${
          b.changes.join("; ")
        }.`,
        s.changes.length ? h("p", { class: "warning" }, "Your unsaved changes are dropped.") : null,
        "The Cheated mark stays.",
      ],
      confirm: "Restore",
      danger: true,
    }) || !await writable(s)
  ) return;
  await locked(async () => {
    try {
      // The session drops the unsaved changes once the backup is written back; a refused restore keeps them.
      await s.restore(b);
      if (session !== s) return;
      status(`Restored the files from before ${when}.`);
    } catch (e) {
      status(errorText(e), true);
      return;
    }
    await install(s.source, s.current, s.character, true);
    editing = true;
    await render();
  });
}

function openDisclosure() {
  const dialog = $<HTMLDialogElement>("#disclosure");
  const ok = $<HTMLInputElement>("#disclosure-ok");
  ok.checked = false;
  $<HTMLButtonElement>("#disclosure-enter").disabled = true;
  $("#disclosure-already").hidden = !cheated;
  dialog.returnValue = "";
  dialog.showModal();
}

// --- Rendering ---

async function render() {
  const my = ++renderToken;
  const app = $("#app");
  const s = session;
  updateSavebar();
  updateViewSwitch();
  updateMapBar();
  const reload = $<HTMLButtonElement>("#reload");
  reload.hidden = !s || !editing || s.source.kind === "copy";
  reload.title = s?.source.kind === "library"
    ? "Read this world from My worlds again, after another device updated it. Your unsaved changes stay and run again on the " +
      "newest version; any that no longer change anything are dropped."
    : "Read the save folder again after playing in the game. Your unsaved changes stay and run again on the newest save; any " +
      "that no longer change anything are dropped.";
  if (!s || !world) return;
  if (view === "map") return renderMap(my);
  let raw: unknown, v: PlayerSave;
  try {
    raw = await s.json(playerPath());
    v = parsePlayer(raw);
  } catch (e) {
    status(errorText(e), true);
    return;
  }
  const p = playerRecord(raw);
  const cards: (HTMLElement | null)[] = [];
  if (editing) {
    const saved = await savedPlayer(s).catch(() => undefined);
    cards.push(
      characterCard(v),
      hitPointsCard(v, p),
      conditionsCard(v, p),
      skyCard(p),
      itemsCard(v, p, saved),
      await mapCard(v, p),
      // A copy has no backups to restore into; once saved into the game's folder it does.
      s.source.kind === "copy" ? null : backupsCard(await listBackups(s.world).catch(() => [])),
    );
  }
  if (my !== renderToken) return;
  app.replaceChildren(summary(v, p), ...(editing ? [h("div", { class: "edit-grid" }, ...cards, previewCard(v))] : []));
}

/** The player record as the files have it, without unsaved changes; read once per session. */
const savedRecords = new WeakMap<EditSession, Promise<Rec>>();
function savedPlayer(s: EditSession): Promise<Rec> {
  let rec = savedRecords.get(s);
  if (!rec) {
    const src = s.files.get(`${s.character.root}Player.save`);
    rec = src ? src.read().then((bytes) => playerRecord(decodeJson(bytes))) : Promise.reject(new Error("Player.save is missing"));
    savedRecords.set(s, rec);
  }
  return rec;
}

function summary(v: PlayerSave, p: Rec): HTMLElement {
  const s = session!, c = s.character;
  const sky = parseSky(p);
  const where = playerArea(v);
  const from = s.source instanceof FolderSource
    ? `From the folder ${s.source.dir.name}. Saving writes the game's files there.`
    : s.source instanceof LibrarySource
    ? "From My worlds. Saving updates it there, for every device that syncs your library; downloading gives you a save to play."
    : `A copy, from ${sourceText(s.source)}. Download it with your changes to play it${
      canWriteFolders() ? ", or save them into the game's folder" : ""
    }.`;
  const mode = s.source.kind === "folder"
    ? "Played since? Save and quit to the game's menu and choose Reload save at the top: your unsaved changes stay."
    : s.source.kind === "library"
    ? "Updated since on another device? Choose Reload save at the top: your unsaved changes stay."
    : "";
  return h(
    "section",
    { class: "edit-summary" },
    h(
      "h2",
      {},
      c.name,
      cheated ? [" ", h("abbr", { class: "badge badge-cheated", title: "Cheated: edited with the save editor" }, "C")] : null,
    ),
    h(
      "p",
      {},
      `Level ${v.level} · ${where ? areaName(where) : "unknown area"}`,
      sky ? ` · Day ${sky.day}, ${formatClock(sky.minute)} · ${WEATHER_LABELS[weatherKind(sky)]}` : "",
    ),
    h("p", { class: "muted" }, from),
    editing
      ? h(
        "p",
        { class: "muted" },
        `Edit mode. Changes stay in this tab until you ${
          s.source.kind === "copy" ? "download or save" : "save"
        } them with the bar at the bottom. ${mode}`.trim(),
      )
      : h(
        "p",
        {},
        h("button", { class: "button", type: "button", onclick: openDisclosure }, "Edit this character..."),
        cheated ? h("span", { class: "muted" }, " This world is already marked Cheated.") : null,
      ),
  );
}

function card(id: string, title: string, ...body: (HTMLElement | HTMLElement[] | string | null)[]): HTMLElement {
  return h(
    "section",
    { class: `edit-card edit-${id}`, "aria-labelledby": `card-${id}` },
    h("h3", { id: `card-${id}` }, title),
    body,
    noteView(id),
  );
}

const field = (label: string, input: HTMLElement, ...after: (HTMLElement | string | null)[]) =>
  h("label", { class: "edit-field" }, h("span", {}, label), input, ...after);

function numberInput(value: number, min: number, max: number): HTMLInputElement {
  return h("input", { type: "number", class: "num", value, min, max, step: 1, required: true }) as HTMLInputElement;
}
function readWhole(input: HTMLInputElement, what: string): number {
  const n = Number(input.value);
  if (input.value.trim() === "" || !Number.isInteger(n)) throw new Error(`${what} must be a whole number`);
  return n;
}
/** Runs an edit from a form, showing input errors on its card. */
const act = (cardId: string, run: () => Promise<void> | void) => async () => {
  try {
    await run();
  } catch (e) {
    note(cardId, errorText(e), true);
    await render();
  }
};

function characterCard(v: PlayerSave): HTMLElement {
  const level = numberInput(v.level, 1, MAX_LEVEL);
  const skill = numberInput(v.skillPoints, 0, MAX_SKILL_POINTS);
  const newHp = numberInput(v.newHitPoints, 0, MAX_SKILL_POINTS);
  const setButton = (onclick: () => void) =>
    h("button", { type: "button", class: "button subtle", onclick: act("character", onclick) }, "Set");
  const vitals = v.vitals;
  const sliders: [keyof VitalsEdit, string, number | undefined][] = [
    ["wellbeing", "Wellbeing", vitals?.wellbeing],
    ["satiation", STAT_LABELS.satiation, vitals?.satiation],
    ["focus", STAT_LABELS.focus, vitals?.focus],
    ["stamina", STAT_LABELS.stamina, vitals?.stamina],
    ["warmth", STAT_LABELS.warmth, vitals?.warmth],
  ];
  const inputs = new Map<keyof VitalsEdit, HTMLInputElement>();
  const vitalRows = sliders.map(([key, label, value]) => {
    const out = h("output", {}, describeVital(key, value ?? 0));
    const input = h("input", {
      type: "range",
      min: 0,
      max: 100,
      step: 1,
      value: Math.round((value ?? 0) * 100),
      oninput: () => out.textContent = describeVital(key, Number(input.value) / 100),
    }) as HTMLInputElement;
    inputs.set(key, input);
    return field(label, input, out);
  });
  return card(
    "character",
    "Level, points and wellbeing",
    field(
      "Level",
      level,
      setButton(() => {
        const to = readWhole(level, "Level");
        return editPlayer("character", (p) => {
          const from = Number(p.level);
          setLevel(p, to);
          return to === from ? undefined : `Level ${from} → ${to} (skill points and new hit points follow)`;
        });
      }),
    ),
    h(
      "p",
      { class: "muted small" },
      `XP ${Math.round(v.xp)} of ${xpForLevel(v.level)} to the next level. Each level grants a skill point, and every third level a hit ` +
        "point to place; lowering the level takes back unspent ones.",
    ),
    field(
      "Skill points to spend",
      skill,
      setButton(() => {
        const to = readWhole(skill, "Skill points");
        return editPlayer("character", (p) => {
          const from = Number(p.skillPoints);
          setSkillPoints(p, to);
          return to === from ? undefined : `Skill points ${from} → ${to}`;
        });
      }),
    ),
    field(
      "New hit points to place",
      newHp,
      setButton(() => {
        const to = readWhole(newHp, "New hit points");
        return editPlayer("character", (p) => {
          const from = Number(p.hpAddPoints);
          setNewHitPoints(p, to);
          return to === from ? undefined : `New hit points ${from} → ${to}`;
        });
      }),
    ),
    h("h4", {}, "Wellbeing and stats"),
    vitals ? vitalRows : h("p", { class: "muted" }, "This save does not record wellbeing."),
    vitals
      ? h("button", {
        type: "button",
        class: "button subtle",
        onclick: act("character", () => {
          // The sliders that were moved; the others keep whatever the draft has.
          const e: VitalsEdit = {};
          for (const [key, , shown] of sliders) {
            const to = Number(inputs.get(key)!.value) / 100;
            if (Math.round((shown ?? 0) * 100) !== Math.round(to * 100)) e[key] = to;
          }
          return editPlayer("character", (p, raw) => {
            const before = parsePlayer(raw).vitals;
            // Only the stats that still differ, so one the game already has where you asked is left exactly as it is.
            const differ: VitalsEdit = {};
            const changes = sliders.flatMap(([key, label]) => {
              const to = e[key], from = before?.[key] ?? 0;
              if (to === undefined || Math.round(from * 100) === Math.round(to * 100)) return [];
              differ[key] = to;
              return [`${label} ${percent(from)} → ${percent(to)}`];
            });
            setVitals(p, differ);
            return changes.length ? changes.join(", ") : undefined;
          });
        }),
      }, "Apply wellbeing and stats")
      : null,
    h(
      "p",
      { class: "muted small" },
      "Sickness, warm to the core, well rested and overburdening keep changing wellbeing each turn (see Conditions).",
    ),
  );
}

const describeVital = (key: keyof VitalsEdit, v: number) => key === "warmth" ? `${percent(v)} ${temperatureLabel(v)}` : percent(v);

const bleedText = (s: HitPointStatus) => s.bleed ? `${s.bleed} spreading ${BLEED_DIRS[s.dir]}` : "0";

/** The player's hit points: pick one to set its poison and bleeding; stun, and heal every wound. */
function hitPointsCard(v: PlayerSave, p: Rec): HTMLElement {
  const g = v.health;
  if (!g) return card("health", "Hit points and their statuses", h("p", { class: "muted" }, "Hit points were not saved."));
  if (hpPick && cellKind(g.cells[hpPick[1]]?.[hpPick[0]] ?? { hp: -4, poison: 0, bleed: [0, 0, 0, 0] }) === "none") hpPick = undefined;
  const pick = (x: number, y: number) => {
    hpPick = [x, y];
    const next = hitPointsCard(v, p);
    el.replaceWith(next);
    next.querySelector<HTMLElement>(".hp-pick[aria-pressed='true']")?.focus();
  };
  const stunTo = !g.stunned;
  const el = card(
    "health",
    "Hit points and their statuses",
    healthGridPicker(g, hpPick, pick),
    hpPick ? pickedView(hpPick[0], hpPick[1]) : h("p", { class: "muted small" }, "Pick a hit point to set its poison and bleeding."),
    h(
      "p",
      { class: "item-actions" },
      h("button", {
        type: "button",
        class: "button subtle",
        title: stunTo ? "Stunned by a blunt blow: you miss your next turn" : "You no longer miss your next turn",
        onclick: act("health", () =>
          editPlayer("health", (rec) => {
            const from = parseHealth(rec.hpgrid, rec.statusgrid)?.stunned;
            setStunned(rec, stunTo);
            return from === stunTo ? undefined : stunTo ? "Stunned: you miss your next turn" : "No longer stunned";
          })),
      }, stunTo ? "Stun" : "Remove stun"),
      h("button", {
        type: "button",
        class: "button subtle",
        onclick: act("health", () =>
          editPlayer("health", (rec) => {
            const before = JSON.stringify([rec.hpgrid, rec.statusgrid]);
            const n = healPlayer(rec);
            if (JSON.stringify([rec.hpgrid, rec.statusgrid]) === before) return undefined;
            return `Healed ${n === 1 ? "1 hit point" : `${n} hit points`} and cleared poison, bleeding and stun`;
          })),
      }, "Heal all wounds"),
    ),
    h(
      "p",
      { class: "muted small" },
      "At the end of each turn a poisoned or bleeding hit point is lost, armor or not, and its other stacks move on: poison to a " +
        "random living hit point beside it, bleeding to the next one the way it spreads. Only living hit points take them. Heal all " +
        "wounds restores lost and burned hit points and clears every status; armor stays.",
    ),
  );
  return el;

  function pickedView(x: number, y: number): HTMLElement {
    const c = g!.cells[y][x];
    const now = hitPointStatus(p, x, y);
    const alive = c.hp >= 1;
    const locked = !alive && !now.poison && !now.bleed;
    const poison = numberInput(now.poison, 0, MAX_STACKS);
    const bleed = numberInput(now.bleed, 0, MAX_STACKS);
    const dir = h(
      "select",
      { "aria-label": "The way the bleed spreads" },
      BLEED_DIRS.map((d, i) => h("option", { value: i, selected: i === now.dir }, `spreading ${d}`)),
    ) as HTMLSelectElement;
    for (const input of [poison, bleed, dir]) input.disabled = locked;
    const apply = act("health", () => {
      const to: HitPointStatus = {
        poison: readWhole(poison, "Poison stacks"),
        bleed: readWhole(bleed, "Bleeding stacks"),
        dir: Number(dir.value),
      };
      return editPlayer("health", (rec) => {
        const from = hitPointStatus(rec, x, y);
        setHitPointStatus(rec, x, y, to);
        const after = hitPointStatus(rec, x, y);
        const changes = [
          from.poison !== after.poison ? `poison ${from.poison} → ${after.poison}` : "",
          bleedText(from) !== bleedText(after) ? `bleeding ${bleedText(from)} → ${bleedText(after)}` : "",
        ].filter(Boolean);
        return changes.length ? `Hit point at ${cellPlace(x, y)}: ${changes.join(", ")}` : undefined;
      });
    });
    return h(
      "div",
      { class: "hp-picked" },
      h("h4", {}, `Hit point at ${cellPlace(x, y)}`),
      h("p", { class: "small" }, cellTitle(c)),
      field("Poison stacks", poison),
      field("Bleeding stacks", bleed, dir),
      locked ? h("p", { class: "muted small" }, "Lost and burned hit points take no poison or bleeding.") : null,
      h("button", { type: "button", class: "button subtle", disabled: locked, onclick: apply }, "Apply to this hit point"),
    );
  }
}

const ROMAN = ["I", "II", "III"];
const turnsText = (t: number) => `${Number.isInteger(t) ? t : t.toFixed(1)} ${t === 1 ? "turn" : "turns"}`;
const timedText = (t: number) => (t > 0 ? turnsText(t) : "off");
const sickText = (level: number, turns: number) => (level ? `${ROMAN[level - 1]} for ${turnsText(turns)}` : "none");
/** The game's average sickness from bad food: i_r(20, 32) turns times the level (player_get_sickness). */
const SICK_TURNS = 26;

/** Lasting conditions: sickness and its level, warm to the core, well fed, well rested and stamina boosts, with their turns. */
function conditionsCard(v: PlayerSave, p: Rec): HTMLElement {
  const sickLevel = sicknessLevel(v.effects);
  const sickShown = Math.ceil(v.sickTime);
  const sickTurns = numberInput(sickShown, 0, MAX_TURNS);
  sickTurns.disabled = !sickLevel;
  const level = h(
    "select",
    {
      "aria-label": "Sickness",
      onchange: () => {
        const l = Number(level.value);
        sickTurns.disabled = !l;
        if (l && !(Number(sickTurns.value) > 0)) sickTurns.value = String(SICK_TURNS * l);
      },
    },
    h("option", { value: 0, selected: !sickLevel }, "None"),
    [1, 2, 3].map((l) =>
      h("option", { value: l, selected: sickLevel === l }, `${CONDITIONS[16 + l].label} (${CONDITIONS[16 + l].effect})`)
    ),
  ) as HTMLSelectElement;
  const rows = (Object.entries(TIMED) as [Timed, typeof TIMED[Timed]][]).map(([k, t]) => {
    const shown = Math.ceil(v[t.key]);
    return { k, t, shown, input: numberInput(shown, 0, t.max) };
  });
  const apply = act("conditions", () => {
    // Only what was changed here, so the edit keeps the rest of the draft as it is, also when it runs again after an undo or a reload.
    const e: ConditionsEdit = {};
    const l = Number(level.value);
    const turns = l ? readWhole(sickTurns, "Turns of sickness") : 0;
    if (l !== sickLevel || (l && turns !== sickShown)) e.sickness = { level: l, turns };
    for (const { k, t, shown, input } of rows) {
      const to = readWhole(input, `Turns of ${CONDITIONS[t.ae].label.toLowerCase()}`);
      if (to !== shown) e[k] = to;
    }
    return editPlayer("conditions", (rec, raw) => {
      const before = parsePlayer(raw);
      const differ: ConditionsEdit = {};
      const changes: string[] = [];
      if (e.sickness) {
        const from = sicknessLevel(before.effects), { level: lv, turns: n } = e.sickness;
        if (from !== lv || before.sickTime !== n) {
          differ.sickness = e.sickness;
          changes.push(`Sickness ${sickText(from, before.sickTime)} → ${sickText(lv, n)}`);
        }
      }
      for (const { k, t } of rows) {
        const to = e[k];
        if (to === undefined || before[t.key] === to) continue;
        differ[k] = to;
        changes.push(`${CONDITIONS[t.ae].label} ${timedText(before[t.key])} → ${timedText(to)}`);
      }
      setConditions(rec, differ);
      return changes.length ? changes.join(", ") : undefined;
    });
  });
  return card(
    "conditions",
    "Conditions",
    field("Sickness", level),
    field("Sickness lasts", sickTurns, "turns"),
    rows.map(({ t, input }) =>
      field(CONDITIONS[t.ae].label, input, "turns", h("span", { class: "muted small" }, CONDITIONS[t.ae].effect ?? ""))
    ),
    h("button", { type: "button", class: "button subtle", onclick: apply }, "Apply conditions"),
    h(
      "p",
      { class: "muted small" },
      "Each lasts the turns given; the game counts them down by one at the end of every turn and ends the condition at 0, so 0 " +
        "removes it. Warm to the core runs down at half speed while you sleep in a Great Bedroll (a tenth in a Furhide Bedroll), and " +
        "not at all beside a fire hot enough to warm you further. The game caps warm to the core, well fed and well rested at 35 turns.",
    ),
    h(
      "p",
      { class: "muted small" },
      "Tiredness, overburdening, wading, shelter and the other conditions follow your stats, load and surroundings: the game sets " +
        "them again every step, so they are not edited here.",
    ),
    wetView(v, p),
  );
}

/** Wet clothes as the preview lists them, and Dry all (the same as under Items and coins). */
function wetView(v: PlayerSave, p: Rec): HTMLElement[] {
  const body = wetClothes(v.wetness);
  const items = orNone(() => needing(p, "dry")).length;
  const wet = body.length || items || bodyWet(p);
  return [
    h("h4", {}, "Wet clothes"),
    h(
      "p",
      {},
      wet
        ? [
          body.length ? `On your body: ${body.join(", ")}.` : bodyWet(p) ? "Your body is barely damp." : "Your body is dry.",
          items ? ` ${items === 1 ? "1 item" : `${items} items`} you wear or carry ${items === 1 ? "is" : "are"} wet.` : "",
        ]
        : "You and everything you carry are dry.",
    ),
    h("button", {
      type: "button",
      class: "button subtle",
      disabled: !wet,
      onclick: act("conditions", () => upkeep("dry", "conditions")),
    }, items ? `Dry all (${items})` : "Dry all"),
    h(
      "p",
      { class: "muted small" },
      "Wet clothes cool you toward 10% warmth each turn, and wet clothing soaks the body under it. Dry all dries both, as under " +
        "Items and coins.",
    ),
  ];
}

function skyCard(p: Rec): HTMLElement {
  const sky = parseSky(p);
  if (!sky) return card("sky", "Time and weather", h("p", { class: "muted" }, "This save does not record the time."));
  const day = numberInput(sky.day, 1, MAX_DAY);
  const pad = (n: number) => String(n).padStart(2, "0");
  const minute = Math.min(sky.minute, 24 * 60 - 1);
  const time = h("input", {
    type: "time",
    step: 60,
    value: `${pad(Math.floor(minute / 60))}:${pad(Math.floor(minute % 60))}`,
    required: true,
  }) as HTMLInputElement;
  const weather = h(
    "select",
    { onchange: () => rain.disabled = Number(weather.value) !== Weather.Rain },
    ([["Clear", Weather.Clear], ["Cloudy", Weather.Cloudy], ["Rain", Weather.Rain]] as const).map(([label, value]) =>
      h("option", { value, selected: sky.weather === value }, label)
    ),
  ) as HTMLSelectElement;
  const rainOut = h("output", {}, percent(Math.max(MIN_RAIN, sky.rain || 0.5)));
  const rain = h("input", {
    type: "range",
    min: Math.round(MIN_RAIN * 100),
    max: 100,
    step: 1,
    value: Math.round(Math.max(MIN_RAIN, sky.rain || 0.5) * 100),
    disabled: sky.weather !== Weather.Rain,
    oninput: () => rainOut.textContent = percent(Number(rain.value) / 100),
  }) as HTMLInputElement;
  const tempOut = h("output", {}, `${percent(sky.temperature)} ${temperatureLabel(sky.temperature)}`);
  const temp = h("input", {
    type: "range",
    min: 0,
    max: 100,
    step: 1,
    value: Math.round(sky.temperature * 100),
    oninput: () => tempOut.textContent = `${percent(Number(temp.value) / 100)} ${temperatureLabel(Number(temp.value) / 100)}`,
  }) as HTMLInputElement;
  const apply = act("sky", () => {
    const [hh, mm] = time.value.split(":").map(Number);
    if (!Number.isInteger(hh) || !Number.isInteger(mm)) throw new Error("Choose a time");
    // Only what was changed here, so the edit keeps the rest of the draft as it is, also when it runs again after an undo or a reload.
    const e: SkyEdit = {};
    const dayTo = readWhole(day, "Day");
    if (dayTo !== sky.day) e.day = dayTo;
    if (hh * 60 + mm !== Math.floor(minute)) e.minute = hh * 60 + mm;
    const weatherTo = Number(weather.value) as WeatherState;
    if (weatherTo !== sky.weather) e.weather = weatherTo;
    if (e.weather !== undefined || Number(rain.value) !== Math.round(Math.max(MIN_RAIN, sky.rain || 0.5) * 100)) {
      e.rain = Number(rain.value) / 100;
    }
    if (Number(temp.value) !== Math.round(sky.temperature * 100)) e.temperature = Number(temp.value) / 100;
    return editPlayer("sky", (rec) => {
      const before = parseSky(rec)!;
      setSky(rec, e);
      const after = parseSky(rec)!;
      const changes: string[] = [];
      if (after.day !== before.day || after.minute !== before.minute) {
        changes.push(`Day ${before.day} ${formatClock(before.minute)} → day ${after.day} ${formatClock(after.minute)}`);
      }
      if (after.weather !== before.weather || after.rain !== before.rain) {
        changes.push(`${WEATHER_LABELS[weatherKind(before)]} → ${WEATHER_LABELS[weatherKind(after)]}`);
      }
      if (Math.round(after.temperature * 100) !== Math.round(before.temperature * 100)) {
        changes.push(`Air ${percent(before.temperature)} → ${percent(after.temperature)}`);
      }
      return changes.length ? changes.join(", ") : undefined;
    });
  });
  return card(
    "sky",
    "Time and weather",
    h("p", {}, `Now day ${sky.day}, ${formatClock(sky.minute)}, ${WEATHER_LABELS[weatherKind(sky)].toLowerCase()}.`),
    field("Day", day),
    field("Time", time),
    field("Weather", weather),
    field("Rain strength", rain, rainOut),
    field("Air temperature", temp, tempOut),
    h("button", { type: "button", class: "button subtle", onclick: apply }, "Apply time and weather"),
    h(
      "p",
      { class: "muted small" },
      "The game eases the air temperature back toward the hour's usual value each turn, and changes the weather when the hour turns. " +
        "Going back in time stops regrowth in zones you visited later until the clock catches up.",
    ),
  );
}

/** Carryable items by display name; a repeated name gets its item number. */
const ITEM_CHOICES: Map<string, number> = (() => {
  const named = Object.keys(ITEM_NAMES).map(Number).filter((i) => addable(i)).map((i) => [ITEM_NAMES[i], i] as const);
  const count = new Map<string, number>();
  for (const [name] of named) count.set(name, (count.get(name) ?? 0) + 1);
  return new Map(
    named.map(([name, i]) => [count.get(name)! > 1 ? `${name} (${i})` : name, i] as const).sort(([a], [b]) => a.localeCompare(b)),
  );
})();

function itemsCard(v: PlayerSave, p: Rec, saved: Rec | undefined): HTMLElement {
  const name = h("input", {
    type: "text",
    list: "item-choices",
    placeholder: "Type an item name",
    autocomplete: "off",
    class: "item-name",
  }) as HTMLInputElement;
  const amount = numberInput(1, 1, 999);
  const coins: [keyof ReturnType<typeof countCoins>, number, HTMLInputElement][] = [
    ["gold", Coin.Gold, numberInput(0, 0, 9999)],
    ["silver", Coin.Silver, numberInput(0, 0, 9999)],
    ["copper", Coin.Copper, numberInput(0, 0, 9999)],
  ];
  let free = 0;
  try {
    free = freeCells(p);
  } catch (e) {
    note("items", errorText(e), true);
  }
  /** Adds to the bags; what does not fit is reported, not dropped. */
  const add = async (index: number, n: number) => {
    let left = 0;
    await editPlayer("items", (rec) => {
      const r = addItems(rec, index, n);
      left = r.left;
      return r.added ? `Added ${r.added} × ${ITEM_NAMES[index]}${r.turned ? " (some turned sideways to fit)" : ""}` : undefined;
    });
    if (left) {
      note("items", `${left} × ${ITEM_NAMES[index]} did not fit in your bags. Make room in the game or carry a bigger bag first.`, true);
      await render();
    }
  };
  return card(
    "items",
    "Items and coins",
    h(
      "p",
      {},
      "Coins carried: ",
      coinsView(countCoins(v.inventory), { all: true }),
      ` · ${free === 1 ? "1 free cell" : `${free} free cells`} in your bags`,
    ),
    h("datalist", { id: "item-choices" }, [...ITEM_CHOICES.keys()].map((n) => h("option", { value: n }))),
    field("Item", name),
    field("Amount", amount),
    h(
      "span",
      { class: "item-actions" },
      h("button", {
        type: "button",
        class: "button subtle",
        onclick: act("items", async () => {
          const index = ITEM_CHOICES.get(name.value.trim());
          if (index === undefined) throw new Error("Pick an item from the list");
          await add(index, readWhole(amount, "Amount"));
        }),
      }, "Add to bags"),
      h("button", {
        type: "button",
        class: "button subtle",
        title: "Put a new one on, in a free equipment slot it fits",
        onclick: act("items", async () => {
          const index = ITEM_CHOICES.get(name.value.trim());
          if (index === undefined) throw new Error("Pick an item from the list");
          const n = readWhole(amount, "Amount");
          await editPlayer("items", (rec) => {
            const r = wearNew(rec, index, n);
            return `Put on ${r.amount > 1 ? `${r.amount} × ` : ""}${itemName(index)} (${slotLabel(r.slot)})`;
          });
        }),
      }, "Wear it"),
    ),
    h("h4", {}, "Coins"),
    h("div", { class: "coin-fields" }, coins.map(([label, , input]) => field(label[0].toUpperCase() + label.slice(1), input))),
    h("button", {
      type: "button",
      class: "button subtle",
      onclick: act("items", async () => {
        const wanted = coins.map(([, index, input]) => [index, readWhole(input, "Coins")] as const).filter(([, n]) => n > 0);
        if (!wanted.length) throw new Error("Enter how many coins to add");
        for (const [index, n] of wanted) await add(index, n);
      }),
    }, "Add coins"),
    h(
      "p",
      { class: "muted small" },
      "Items go into the bags you carry, topping up stacks first, exactly as picking them up would. New items glow gold in the game until you look at them. " +
        "Wear it puts a new one on instead, in a free equipment slot it fits.",
    ),
    hasBags(p) ? null : h(
      "p",
      { class: "edit-note" },
      "You wear nothing to carry things in. Pick a backpack, a vest or a pouch above and choose Wear it to make room.",
    ),
    carriedView(p, saved),
  );
}

const itemName = (index: number) => ITEM_NAMES[index] ?? `Item ${index}`;
/** An equipment slot's name; the second weapon set's hands say so. */
const slotLabel = (slot: number) => `${SLOT_NAMES[slot] ?? `slot ${slot + 1}`}${slot === 2 || slot === 3 ? " (second set)" : ""}`;
const hasBags = (p: Rec) => {
  try {
    return carriedBags(p).length > 0;
  } catch {
    return true;
  }
};
const orNone = <T>(read: () => T[]): T[] => {
  try {
    return read();
  } catch {
    return [];
  }
};

/** What the player wears and carries, each with Remove; items unsaved changes made or changed are tagged. */
function carriedView(p: Rec, saved: Rec | undefined): HTMLElement {
  let list: CarriedItem[];
  try {
    list = carriedItems(p);
  } catch (e) {
    return h("p", { class: "edit-note error" }, errorText(e));
  }
  const total = list.reduce((n, c) => n + 1 + countInside(c), 0);
  const row = (c: CarriedItem, holder?: string): HTMLElement => {
    const name = itemName(c.index);
    const rec = itemAt(p, c.place);
    const before = saved && itemAt(saved, c.place);
    const changed = !before || !rec || before.index !== c.index || Number(before.amount) !== c.amount || !sameCondition(before, rec);
    const howMany = c.amount > 1 ? numberInput(c.amount, 1, c.amount) : null;
    howMany?.setAttribute("aria-label", `How many ${name} to remove`);
    const from = holder ? ` from ${holder}` : ` (worn: ${slotLabel(c.place.slot)})`;
    const condition = rec ? conditionParts(conditionOf(asState(rec))) : [];
    // Where it can go: worn containers with room for it, and a free slot it fits.
    const wearIn = holder !== undefined ? orNone(() => freeSlotsFor(p, c.index))[0] : undefined;
    const choices = [
      ...orNone(() => roomFor(p, c.place, c.index)).map((b) =>
        h("option", { value: `in:${b.slot}:${b.part}` }, `${holder === undefined ? "Take off into" : "Into"} ${bagLabel(b)}`)
      ),
      wearIn === undefined ? null : h("option", { value: "wear" }, `Wear it (${slotLabel(wearIn)})`),
    ].filter((o) => o !== null);
    const moveTo = choices.length
      ? h(
        "select",
        { class: "move-to", "aria-label": `Where to move ${name}` },
        h("option", { value: "" }, "Move to…"),
        choices,
      ) as HTMLSelectElement
      : null;
    const sizes = holder === undefined ? orNone(() => carriedBags(p)).filter((b) => b.slot === c.place.slot) : [];
    return h(
      "li",
      {},
      h(
        "span",
        { class: "carried-name" },
        name,
        c.amount > 1 ? ` ×${c.amount}` : "",
        holder ? null : h("span", { class: "muted" }, ` ${slotLabel(c.place.slot)}`),
        sizes.map((b) => h("span", { class: "muted" }, ` · ${bagRoom(b)}`)),
        condition.length ? conditionView(condition) : null,
        changed ? [" ", h("span", { class: "tag" }, "unsaved")] : null,
      ),
      h(
        "span",
        { class: "carried-controls" },
        rec && hasCondition(c.index, rec)
          ? h("button", {
            type: "button",
            class: "button subtle small",
            title: `Set ${name}'s ${conditionWords(c.index, rec)}`,
            onclick: act("items", () => editCondition(p, c, rec, holder)),
          }, "Condition…")
          : null,
        moveTo,
        moveTo
          ? h("button", {
            type: "button",
            class: "button subtle small",
            onclick: act("items", () => moveCarried(c, moveTo.value, from)),
          }, "Move")
          : null,
        howMany,
        h("button", {
          type: "button",
          class: "button subtle small",
          onclick: act("items", () => removeCarried(c, howMany, from)),
        }, "Remove"),
      ),
      c.contents.length ? h("ul", {}, c.contents.map((inner) => row(inner, name))) : null,
    );
  };
  return h(
    "details",
    { class: "carried", "data-remember": "editor-carried", open: expanded ? expanded.has("editor-carried") : true },
    h("summary", {}, `What you wear and carry (${total === 1 ? "1 item" : `${total} items`})`),
    upkeepView(p),
    list.length ? h("ul", { class: "carried-list" }, list.map((c) => row(c))) : h("p", { class: "muted" }, "Nothing."),
    h("p", { class: "muted small" }, `Free slots: ${orNone(() => freeSlots(p)).map(slotLabel).join(", ") || "none"}.`),
    h(
      "p",
      { class: "muted small" },
      "Move to lists the containers you wear that have room for an item (upright, or turned sideways), and a free slot it fits. " +
        "A container moves only when empty: the game empties one kept inside another when it loads. Remove deletes an item from the " +
        "save; a container goes with everything in it. Condition… sets an item's durability, fuel or wetness to any value the game " +
        "allows. Items tagged unsaved come from unsaved changes, which you can also undo from the list at the bottom.",
    ),
  );
}

/** A worn container's name, with its slot when it is not the obvious one. */
const bagLabel = (b: Bag) => `${itemName(b.owner)} (${slotLabel(b.slot)})`;
/** A container's size and free cells. */
const bagRoom = (b: Bag) => {
  const free = b.grid.flat().filter((cell) => cell === -4).length;
  return `${b.grid[0].length}×${b.grid.length}, ${free === 1 ? "1 free cell" : `${free} free cells`}`;
};

/** Moves a carried or worn item where its Move to list says: into a worn container, or on (wearing it). */
async function moveCarried(c: CarriedItem, choice: string, from: string) {
  const name = itemName(c.index);
  if (choice === "wear") return wearFromBag(c, from);
  const m = /^in:(\d+):(\d+)$/.exec(choice);
  if (!m) throw new Error(`Choose where to move ${name}`);
  const to = { slot: Number(m[1]), part: Number(m[2]) };
  const { place, index } = c;
  await editPlayer("items", (rec) => {
    const amount = Number(itemAt(rec, place)?.amount ?? 1);
    const into = carriedBags(rec).find((b) => b.slot === to.slot && b.part === to.part);
    const r = moveItem(rec, place, index, to);
    return `Moved ${amount > 1 ? `${amount} × ` : ""}${name}${from} into ${into ? itemName(into.owner) : "a container"}` +
      (r.sideflipped ? ", turned sideways" : "");
  });
}

/** Puts a carried item on, in the first free slot it fits. */
async function wearFromBag(c: CarriedItem, from: string) {
  const { place, index } = c;
  await editPlayer("items", (rec) => `Put on ${itemName(index)}${from} (${slotLabel(wearCarried(rec, place, index))})`);
}

/** Removes some or all of a carried item; a container with things in it asks first. */
async function removeCarried(c: CarriedItem, howMany: HTMLInputElement | null, from: string) {
  const name = itemName(c.index);
  const n = howMany ? readWhole(howMany, "How many") : 1;
  if (n < 1 || n > c.amount) throw new Error(`Remove from 1 to ${c.amount} ${name}`);
  const amount = n === c.amount ? "all" : n;
  const inside = countInside(c);
  if (
    amount === "all" && inside &&
    !await ask({
      title: `Remove ${name} and what is in it?`,
      body: [`The ${inside === 1 ? "item" : `${inside} items`} inside it ${inside === 1 ? "goes" : "go"} too.`],
      confirm: "Remove all",
      danger: true,
    })
  ) return;
  const { place, index } = c;
  await editPlayer("items", (rec) => {
    const r = removeItem(rec, place, index, amount);
    const what = r.removed > 1 ? `${r.removed} × ${name}` : name;
    return `Removed ${what}${from}${r.inside ? ` and the ${r.inside === 1 ? "item" : `${r.inside} items`} in it` : ""}`;
  });
}

// --- Condition: durability, fuel and wetness ---

const asState = (rec: Rec) => rec as unknown as ItemState;
/** Fields the game changes as an item wears, burns, gets wet or dries; a change to one marks the item unsaved. */
const CONDITION_KEYS = ["durability", "burnTimeLeft", "wet", "lit"];
const sameCondition = (a: Rec, b: Rec) => CONDITION_KEYS.every((k) => a[k] === b[k]);
/** Something about the item that Condition… can set: durability the game shows, fuel, or wetness. */
const hasCondition = (index: number, rec: Rec) =>
  !!durabilityKind(index) || fuelMax(index) !== undefined || canGetWet(index) || isWet(asState(rec));
const joinAnd = (words: string[]) => words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : words[0];
/** "durability, fuel and wetness": what Condition… sets on the item. */
function conditionWords(index: number, rec: Rec): string {
  const kind = durabilityKind(index);
  return joinAnd([
    kind ? DURABILITY_LABELS[kind].toLowerCase() : "",
    fuelMax(index) !== undefined ? "fuel" : "",
    canGetWet(index) || isWet(asState(rec)) ? "wetness" : "",
  ].filter(Boolean));
}

/** The items a helper changed, by name: "Steel Dagger, 2 × Torch and Wool Shirt". */
function nameList(list: CarriedItem[]): string {
  const counts = new Map<string, number>();
  for (const c of list) counts.set(itemName(c.index), (counts.get(itemName(c.index)) ?? 0) + 1);
  const names = [...counts].map(([name, n]) => (n > 1 ? `${n} × ${name}` : name));
  return joinAnd(names.length > 6 ? [...names.slice(0, 5), `${names.length - 5} more`] : names);
}

const bodyWet = (p: Rec) => Array.isArray(p.wetness) && p.wetness.some((v) => typeof v === "number" && v > 0);

const UPKEEP: { what: Upkeep; label: string; tip: string; none: string }[] = [
  {
    what: "repair",
    label: "Repair all",
    tip: "Restore the durability of everything you wear and carry to its maximum (food portions and lamp oil are not wear)",
    none: "Nothing you wear or carry needs repair",
  },
  {
    what: "refuel",
    label: "Refuel all",
    tip: "Fill the burn time of every torch and lantern you carry, and every Lamp Oil flask",
    none: "Every torch, lantern and Lamp Oil flask you carry is full",
  },
  {
    what: "dry",
    label: "Dry all",
    tip: "Dry everything you wear and carry, and the clothes on your body",
    none: "Nothing you wear or carry is wet",
  },
];

/** Repair all, Refuel all and Dry all, each with how many items it would change, and disabled when there are none. */
function upkeepView(p: Rec): HTMLElement {
  return h(
    "div",
    { class: "upkeep", role: "group", "aria-label": "Restore everything you wear and carry" },
    UPKEEP.map(({ what, label, tip, none }) => {
      const n = orNone(() => needing(p, what)).length;
      const idle = !n && !(what === "dry" && bodyWet(p));
      return h("button", {
        type: "button",
        class: "button subtle small",
        disabled: idle,
        title: idle ? none : tip,
        onclick: act("items", () => upkeep(what)),
      }, n ? `${label} (${n})` : label);
    }),
  );
}

async function upkeep(what: Upkeep, cardId = "items") {
  await editPlayer(cardId, (rec) => {
    if (what === "repair") {
      const list = repairAll(rec);
      return list.length ? `Repaired ${nameList(list)}` : undefined;
    }
    if (what === "refuel") {
      const list = refuelAll(rec);
      return list.length ? `Refuelled ${nameList(list)}` : undefined;
    }
    const r = dryAll(rec);
    const dried = [r.items.length ? nameList(r.items) : "", r.body ? "the clothes on your body" : ""].filter(Boolean);
    return dried.length ? `Dried ${dried.join(", and ")}` : undefined;
  });
}

/**
 * Sets one item's durability, fuel or wetness in a dialog, to anything the game allows (lower too); only the values changed there
 * are written.
 */
async function editCondition(p: Rec, c: CarriedItem, rec: Rec, holder?: string) {
  const { place, index } = c;
  const name = itemName(index);
  const where = holder ? ` in ${holder}` : ` (worn: ${slotLabel(place.slot)})`;
  const now = conditionOf(asState(rec));
  const burn = fuelMax(index);
  const wetNow = isWet(asState(rec)) ? Number(rec.wet) : 0;
  const amount = (value: number, max: number, places = 2) =>
    h("input", { type: "number", class: "num", value: amountText(value, places), min: 0, max, step: "any" }) as HTMLInputElement;
  const durability = now.durability && amount(now.durability.value, now.durability.max);
  const fuel = burn !== undefined ? amount(now.fuel?.value ?? burn, burn, 1) : undefined;
  const wetOut = h("output", {}, wetText(wetNow));
  const wet = canGetWet(index) || wetNow > 0
    ? h("input", {
      type: "range",
      min: 0,
      max: 100,
      step: 1,
      value: Math.round(wetNow * 100),
      oninput: () => wetOut.textContent = `${wet!.value}%`,
    }) as HTMLInputElement
    : undefined;
  const value = (input: HTMLInputElement) => (input.value.trim() === "" ? NaN : Number(input.value));
  // Only what was changed here, so an untouched value (such as a fraction the game left) stays exactly as it is.
  const read = (): ConditionEdit => ({
    ...(durability && durability.value !== durability.defaultValue ? { durability: value(durability) } : {}),
    ...(fuel && fuel.value !== fuel.defaultValue ? { fuel: value(fuel) } : {}),
    ...(wet && wet.value !== wet.defaultValue ? { wet: Number(wet.value) / 100 } : {}),
  });
  const kind = now.durability?.kind;
  const about = [
    kind === "durability" ? "Durability wears down with use; at 0 the game breaks the item." : "",
    kind === "portions" ? "Each portion eaten or used takes one; at 0 it is used up." : "",
    kind === "oil" ? "Oil left refills lanterns; at 0 the flask is used up." : "",
    fuel ? "Fuel is the turns it burns while lit; at 0 it goes out and cannot be lit." : "",
  ].filter(Boolean).join(" ");
  const ok = await form({
    title: `Condition of ${name}`,
    body: [
      h("p", { class: "muted" }, holder ? `In ${holder}` : `Worn: ${slotLabel(place.slot)}`),
      durability && kind ? field(DURABILITY_LABELS[kind], durability, `of ${now.durability!.max}`) : null,
      fuel ? field("Fuel", fuel, `of ${burn} turns`) : null,
      wet ? field("Wet", wet, wetOut) : null,
      about ? h("p", { class: "muted small" }, about) : null,
    ],
    confirm: "Apply",
    check: () => {
      try {
        setCondition(structuredClone(p), place, index, read());
      } catch (e) {
        return errorText(e);
      }
    },
  });
  const e = read();
  if (!ok || !Object.keys(e).length) return;
  await editPlayer("items", (draft) => {
    const old = itemAt(draft, place);
    const was = old ? conditionOf(asState(old)) : {};
    const wasWet = old && isWet(asState(old)) ? Number(old.wet) : 0;
    setCondition(draft, place, index, e);
    const changes: string[] = [];
    if (e.durability !== undefined && was.durability && e.durability !== was.durability.value) {
      const { kind, value, max } = was.durability;
      changes.push(`${DURABILITY_LABELS[kind].toLowerCase()} ${amountText(value)} → ${amountText(e.durability)} of ${max}`);
    }
    if (e.fuel !== undefined && e.fuel !== was.fuel?.value) {
      changes.push(`fuel ${was.fuel ? amountText(was.fuel.value, 1) : "none"} → ${amountText(e.fuel, 1)} of ${burn} turns`);
    }
    if (e.wet !== undefined && e.wet !== wasWet) changes.push(`wet ${wetText(wasWet)} → ${wetText(e.wet)}`);
    return changes.length ? `${name}${where}: ${changes.join(", ")}` : undefined;
  });
}

// --- Map and creatures ---

const mapImages = new Map<string, Promise<HTMLImageElement | undefined>>();
/** Drops the zone maps read so far; the game redraws them as you explore. */
function forgetMapImages() {
  for (const p of mapImages.values()) void p.then((img) => img && URL.revokeObjectURL(img.src));
  mapImages.clear();
}
function mapImage(path: string | undefined): Promise<HTMLImageElement | undefined> {
  if (!path) return Promise.resolve(undefined);
  let p = mapImages.get(path);
  if (!p) {
    p = (async () => {
      const src = session!.files.get(path);
      if (!src) return undefined;
      const img = new Image();
      img.src = URL.createObjectURL(new Blob([await src.read() as BlobPart], { type: "image/png" }));
      await img.decode().catch(() => undefined);
      return img;
    })();
    mapImages.set(path, p);
  }
  return p;
}

const SCALE = 3;

/**
 * What stands on each tile of an area, with the unsaved edits: its ground, its creatures, its rafts and whether you are there.
 * `ground` counts your own tile as taken; `aroundYou` does not, for where a raft you leave can go. Inside, only the floor that its
 * ways out and stairs can be walked to from is open.
 */
async function areaGround(a: Area, v: PlayerSave) {
  const w = world!, s = session!;
  const beingsPath = `${a.dir}Beings.save`;
  const hasBeings = s.files.has(beingsPath);
  const beings: Being[] = parseBeings(hasBeings ? await s.json(beingsPath) as unknown[] : []);
  // The draft, so rafts left or docked by unsaved changes take their tiles.
  const stationsPath = `${a.dir}Stations.save`;
  const stations = s.files.has(stationsPath) ? parsePlaced(await s.json(stationsPath)) : [];
  const [data, water1] = await Promise.all(["Data", "Water1"].map((l) => loadLayer(w, a.dir, l)));
  const trees = await loadTrees(w, a.dir);
  const detail = await loadDetail(w, a.dir);
  const solids = a.interior ? a.interior.solids : a.zone.solids;
  const reach = a.interior
    ? reachable(data?.data, solids.flatMap((s) => s.transPoint ? [(s.transPoint[2] >> 4) * TILES + (s.transPoint[1] >> 4)] : []))
    : undefined;
  const youHere = playerArea(v)?.dir === a.dir;
  const taken: Box[] = [
    ...solids.map((s) => spriteBox(s.sprite, s.x, s.y)),
    ...trees.map((t) => tileBox(t.x, t.y)),
    ...[...detail.containers, ...stations, ...detail.interactables].map((c) => spriteBox(c.sprite, c.x, c.y)),
    ...beings.map((b) => tileBox(b.x, b.y)),
  ];
  return {
    beingsPath,
    hasBeings,
    beings,
    youHere,
    rafts: stations.filter((st) => st.index === RAFT),
    ground: groundMap(data?.data, water1?.data, [...taken, ...(youHere ? [tileBox(v.pos[0], v.pos[1])] : [])], reach),
    aroundYou: groundMap(data?.data, water1?.data, taken, reach),
  };
}

/** The layers of an area that say how deep its water is and, outdoors, where a raft can go. */
async function waterOf(dir: string): Promise<WaterLayers> {
  const w = world!;
  const [grids, heights] = await Promise.all([Promise.all(WATER_LAYERS.map((l) => loadLayer(w, dir, l))), loadHeights(w, dir)]);
  const layers: WaterLayers["layers"] = {};
  WATER_LAYERS.forEach((l, i) => grids[i] && (layers[l] = grids[i]!.data));
  return { layers, heights: heights?.data };
}

/** Why interior `it` cannot be moved into, or undefined when it can. */
function insideRefusal(it: Interior, v: PlayerSave): string | undefined {
  if (!insideOf(it, v)) {
    return "No saved entrance or stairs lead here any more, so which kind of interior this is (and how the game would load it) is " +
      "only a guess; you cannot move here.";
  }
}

/** Why you cannot be moved to tile tx,ty of area a, or undefined when you can. Water is allowed: `chooseMove` asks first. */
function moveRefusal(a: Area, tx: number, ty: number, ground: Uint8Array, v: PlayerSave): string | undefined {
  const why = a.interior && insideRefusal(a.interior, v);
  if (why) return why;
  const k = ground[ty * TILES + tx] as GroundKind;
  if (k === Ground.Blocked || k === Ground.Taken || k === Ground.Shut) {
    return `Tile ${tx},${ty} is ${GROUND_TEXT[k]}; pick ground or water.`;
  }
  const what = a.interior ? "area" : "zone";
  // manager_area Alarm_2 loads an area only when its folder has Ygrid.save, and makes a new one otherwise.
  if (!session!.files.has(`${a.dir}Ygrid.save`)) {
    return `This ${what} has no Ygrid.save, so the game would make it anew instead of loading it; you cannot move there.`;
  }
  if (!session!.files.has(`${a.dir}Containers.save`)) {
    return `The game has not finished saving this ${what} (it has no Containers.save), so you cannot move there.`;
  }
}

type Step = { path: string; edit: Edit };
type MoveChoice = Choice<"bring" | "new" | "swim" | "along" | "leave" | "dock" | "drop"> & { steps: Step[] };

const zoneName = (z: Zone) => `${coordLabel(z.x, z.y)} ${z.name}`;

/** The rafts left in explored zones (in their drafts), nearest your tile `at` (world tile coordinates) first. */
async function parkedRafts(at: [number, number]) {
  const out: { zone: Zone; path: string; tx: number; ty: number; same: string; d: number }[] = [];
  for (const zone of world!.zones.flat()) {
    const path = zone.dir && `${zone.dir}Stations.save`;
    if (!path || !isOutside(zone.type) || !session!.files.has(path)) continue;
    const list = await session!.json(path);
    if (!Array.isArray(list)) continue;
    for (const st of list) {
      if (!isRaft(st)) continue;
      const tx = Number(st.x) >> 4, ty = Number(st.y) >> 4;
      const d = Math.hypot(zone.x * TILES + tx - at[0], zone.y * TILES + ty - at[1]);
      out.push({ zone, path, tx, ty, same: JSON.stringify(st), d });
    }
  }
  return out.sort((a, b) => a.d - b.d);
}

/**
 * Works out how to move you to tile tx,ty of area a (an outdoor zone or an interior), which moveRefusal allows: straight away onto
 * ground, or, asking first, into water (outdoors with your raft, a new one or none) or off your raft (docking it at that shore or
 * leaving it where it is; a raft never goes inside). Returns the edits to make, or undefined when the question is cancelled.
 */
async function chooseMove(a: Area, tx: number, ty: number): Promise<Step[] | undefined> {
  const s = session!, w = world!;
  const raw = await s.json(playerPath());
  const p = playerRecord(raw), v = parsePlayer(raw);
  const { ground, aroundYou } = await areaGround(a, v);
  const i = ty * TILES + tx;
  const water = await waterOf(a.dir);
  const isWater = ground[i] === Ground.Water;
  const height = tileHeight(water, i, !a.interior);
  const canRaft = isWater && !a.interior && raftable(water, i);
  // Fixed now, so undoing an earlier change cannot make this move go to another interior.
  const inside = a.interior ? insideOf(a.interior, v) : undefined;
  if (a.interior && !inside) throw new Error(insideRefusal(a.interior, v));
  const fromRaft = onRaft(p);
  const where = `${areaName(a)}, tile ${tx},${ty}`;
  const at = [p.areaX, p.areaY, p.xx, p.yy].map(Number) as [number, number, number, number];
  const outside = isOutside(Number(p.areaType));
  const [ox, oy] = [at[2] >> 4, at[3] >> 4];
  // Your tile in world tile coordinates; inside, the entrance you went in by.
  const you: [number, number] = [at[0] * TILES + (outside ? ox : v.entrance[0] >> 4), at[1] * TILES + (outside ? oy : v.entrance[1] >> 4)];
  const move = (to: boolean, text: string, stay = false): Step => ({
    path: playerPath(),
    edit: (r) =>
      moveWithRaft(playerRecord(r), a.zone.x, a.zone.y, tx, ty, { from: fromRaft, to, at: stay ? at : undefined }, inside)
        ? text
        : undefined,
  });
  const inWater = isWater ? `, in ${waterKind(height)}` : "";
  if (!fromRaft && !isWater) return [move(false, `Moved you to ${where}`)];

  const choices: MoveChoice[] = [];
  const body: string[] = [];
  let title: string;
  // Where the raft you are on stays if you leave it: its own zone, where you stand.
  const here = outside ? w.zones[at[1]]?.[at[0]] : undefined;
  const herePath = here?.dir && `${here.dir}Stations.save`;
  const leave = herePath && s.files.has(herePath)
    ? { path: herePath, edit: (r: unknown) => (addRaft(r, ox, oy), `left your raft in ${zoneName(here!)}, tile ${ox},${oy}`) }
    : undefined;
  // Only when the raft cannot be left anywhere (you are not in a saved outdoor zone): going without it loses it.
  const dropRaft = (): MoveChoice => ({
    value: "drop",
    label: "Go without your raft",
    detail: "Where you stand cannot keep it, so it is lost.",
    danger: true,
    steps: [move(false, `Moved you to ${where}${inWater}, without your raft`)],
  });
  if (!fromRaft) {
    title = `Tile ${tx},${ty} is water`;
    body.push(`Tile ${tx},${ty} of ${areaName(a)} is ${waterText(height)}.`);
    if (canRaft) {
      const [parked] = await parkedRafts(you);
      if (parked) {
        choices.push({
          value: "bring",
          label: "Bring your raft",
          detail: `From tile ${parked.tx},${parked.ty} of ${zoneName(parked.zone)}; you stand on it there.`,
          steps: [
            move(true, `Moved you to ${where}, on your raft`),
            {
              path: parked.path,
              edit: (r) => (takeRaft(r, parked.same), `took it from ${zoneName(parked.zone)}, tile ${parked.tx},${parked.ty}`),
            },
          ],
        });
      }
      choices.push({
        value: "new",
        label: parked ? "Make a new raft there" : "Make a raft there",
        detail: "A finished raft under you, as the game makes one when it loads you on a raft.",
        steps: [move(true, `Moved you to ${where}, on a new raft`)],
      });
    } else if (!a.interior) body.push("A raft could not float there: it needs deeper water, without reeds.");
    choices.push({
      value: "swim",
      label: canRaft ? "Go without a raft" : "Go into the water",
      detail: `You stand in ${waterKind(height)}.`,
      steps: [move(false, `Moved you to ${where}${inWater}`)],
    });
  } else if (canRaft) {
    title = "Take your raft along?";
    body.push(`You are on your raft. Tile ${tx},${ty} of ${areaName(a)} is ${waterKind(height)} that a raft floats on.`);
    choices.push({
      value: "along",
      label: "Bring your raft",
      detail: "You stand on it there.",
      steps: [move(true, `Moved you and your raft to ${where}`)],
    });
    if (leave) {
      choices.push({
        value: "leave",
        label: "Leave your raft here",
        detail: `It stays at tile ${ox},${oy} of ${zoneName(here!)}; at the new spot ${waterEffect(height)}.`,
        steps: [move(false, `Moved you to ${where}${inWater}`, true), leave],
      });
    } else choices.push(dropRaft());
  } else {
    title = "Leave your raft?";
    body.push(
      a.interior
        ? `You are on your raft, and a raft cannot go into ${areaName(a)}.`
        : `You are on your raft, and it cannot go to tile ${tx},${ty} of ${areaName(a)}: ` +
          (isWater
            ? `that is ${waterKind(height)} (${waterEffect(height)}), and a raft needs deeper water without reeds.`
            : "that is dry ground."),
    );
    const from: [number, number] = [you[0] - a.zone.x * TILES, you[1] - a.zone.y * TILES];
    const free = aroundYou.map((k) => k === Ground.Free || k === Ground.Water ? 1 : 0);
    const dock = !a.interior && s.files.has(`${a.dir}Stations.save`) ? dockTile(raftMap(water), wetMap(water), free, i, from) : undefined;
    if (dock !== undefined) {
      const [dx, dy] = [dock % TILES, Math.floor(dock / TILES)];
      choices.push({
        value: "dock",
        label: "Dock your raft at that shore",
        detail: `It drifts towards you, past any other island, to the first shore of that land: tile ${dx},${dy}.`,
        steps: [
          move(false, `Moved you to ${where}${inWater}`),
          { path: `${a.dir}Stations.save`, edit: (r) => (addRaft(r, dx, dy), `docked your raft at tile ${dx},${dy}`) },
        ],
      });
    } else if (!a.interior) body.push("No water a raft floats on can be reached from that land in this zone, so it cannot dock there.");
    if (leave) {
      choices.push({
        value: "leave",
        label: "Leave your raft where it is",
        detail: `It stays at tile ${ox},${oy} of ${zoneName(here!)}.`,
        steps: [move(false, `Moved you to ${where}${inWater}`, true), leave],
      });
    }
    if (!choices.length) choices.push(dropRaft());
  }
  const picked = await choose({ title, body, choices });
  return choices.find((c) => c.value === picked)?.steps;
}

async function mapCard(v: PlayerSave, p: Rec): Promise<HTMLElement> {
  const w = world!;
  if (!area) return card("map", "Where you stand and creatures", h("p", { class: "muted" }, "No explored area was found."));
  const a = area;
  const { beingsPath, hasBeings, beings, youHere, rafts, ground } = await areaGround(a, v);
  const you = playerArea(v);
  const img = a.interior ? undefined : await mapImage(a.zone.mapPath);
  const outside = !a.interior;
  const water = await waterOf(a.dir);
  const youOnRaft = onRaft(p);
  if (selected !== undefined && !beings[selected]) selected = undefined;
  const youTile = youHere ? (v.pos[1] >> 4) * TILES + (v.pos[0] >> 4) : -1;
  const raftTiles = new Set(rafts.map((r) => (r.y >> 4) * TILES + (r.x >> 4)));
  // Where the creature to spawn cannot be: walls and what is already there, and where it does not live.
  const spawnKind = spawnIndex;
  const blocked = (t: number) => ground[t] === Ground.Blocked || ground[t] === Ground.Taken;
  const habitatWhy = (t: number) => blocked(t) ? undefined : habitatRefusal(spawnKind, water, t, outside);
  const spawnOk = tool === "spawn"
    ? Uint8Array.from({ length: ground.length }, (_, t) => blocked(t) || habitatWhy(t) ? 0 : 1)
    : new Uint8Array();

  const canvas = h("canvas", { width: TILES * SCALE, height: TILES * SCALE, class: `edit-map tool-${tool}` }) as HTMLCanvasElement;
  const caption = h("p", { class: "muted small map-caption" }, "Point at a tile to see what is there.");
  let hover: number | undefined;
  const beingAt = (t: number) => beings.findIndex((b) => (b.y >> 4) * TILES + (b.x >> 4) === t);
  const raftAt = (g: CanvasRenderingContext2D, t: number) => {
    g.fillStyle = "#9a6a3c";
    g.strokeStyle = "#1b1516";
    g.lineWidth = 1;
    const [cx, cy] = [(t % TILES + 0.5) * SCALE, (Math.floor(t / TILES) + 0.5) * SCALE];
    g.fillRect(cx - 5, cy - 4, 10, 8);
    g.strokeRect(cx - 5, cy - 4, 10, 8);
  };
  const draw = () => {
    const g = canvas.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#cebbae";
    g.fillRect(0, 0, canvas.width, canvas.height);
    // Outdoors, the game's own map of the zone; inside, ground drawn from the tile layers.
    if (img) g.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (let i = 0; i < ground.length; i++) {
      const x = (i % TILES) * SCALE, y = Math.floor(i / TILES) * SCALE;
      const k = ground[i];
      if (!img && (k === Ground.Water || k === Ground.Blocked)) {
        g.fillStyle = k === Ground.Water ? "#3d4f63" : "#2a1f22";
        g.fillRect(x, y, SCALE, SCALE);
      }
      // What the tool cannot use is darkened: where the chosen creature cannot be; for you, walls, what is already there and,
      // inside, floor no way out leads to.
      if (tool === "spawn" ? !spawnOk[i] : tool === "move" && (k === Ground.Blocked || k === Ground.Taken || k === Ground.Shut)) {
        g.fillStyle = "rgba(20, 10, 12, .45)";
        g.fillRect(x, y, SCALE, SCALE);
      }
    }
    for (const t of raftTiles) raftAt(g, t);
    beings.forEach((b, i) => {
      const stats = BEINGS[b.index];
      g.fillStyle = isQuestBeing(b.index) ? "#fff3b2" : stats && targetsYou(stats) ? "#ff6b5a" : "#a6d98c";
      g.strokeStyle = i === selected ? "#ffffff" : "#1b1516";
      g.lineWidth = i === selected ? 2 : 1;
      g.beginPath();
      g.arc((b.x / 16) * SCALE, (b.y / 16) * SCALE, i === selected ? 6 : 4, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    });
    if (youHere) {
      if (youOnRaft) raftAt(g, youTile);
      const [x, y] = [(v.pos[0] / 16) * SCALE, (v.pos[1] / 16) * SCALE];
      g.fillStyle = "#d1b76a";
      g.strokeStyle = "#1b1516";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, y - 7), g.lineTo(x + 6, y), g.lineTo(x, y + 7), g.lineTo(x - 6, y), g.closePath();
      g.fill();
      g.stroke();
    }
    if (hover !== undefined) {
      g.strokeStyle = "#ffffff";
      g.lineWidth = 1;
      g.strokeRect((hover % TILES) * SCALE - 0.5, Math.floor(hover / TILES) * SCALE - 0.5, SCALE + 1, SCALE + 1);
    }
  };
  const tileOf = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    const tx = Math.floor(((e.clientX - r.left) / r.width) * TILES), ty = Math.floor(((e.clientY - r.top) / r.height) * TILES);
    return tx >= 0 && ty >= 0 && tx < TILES && ty < TILES ? ty * TILES + tx : undefined;
  };
  const describe = (t: number) => {
    const b = beingAt(t);
    const k = ground[t] as GroundKind;
    const what = b >= 0
      ? BEING_NAMES[beings[b].index] ?? "Creature"
      : t === youTile
      ? youOnRaft ? "you, on your raft" : "you"
      : raftTiles.has(t)
      ? "a raft"
      : k === Ground.Water
      ? `${waterKind(tileHeight(water, t, outside))}${outside && raftable(water, t) ? ", where a raft floats" : ""}`
      : GROUND_TEXT[k];
    const why = tool === "spawn" && b < 0 && t !== youTile && !raftTiles.has(t) ? habitatWhy(t) : undefined;
    return `Tile ${t % TILES},${Math.floor(t / TILES)}: ${what}${why ? ` (${why})` : ""}`;
  };
  canvas.addEventListener("mousemove", (e) => {
    const t = tileOf(e);
    if (t === hover) return;
    hover = t;
    caption.textContent = t === undefined ? "" : describe(t);
    draw();
  });
  canvas.addEventListener("mouseleave", () => (hover = undefined, draw()));
  canvas.addEventListener("click", (e) => {
    const t = tileOf(e);
    if (t === undefined) return;
    const tx = t % TILES, ty = Math.floor(t / TILES);
    if (tool === "inspect") {
      const b = beingAt(t);
      selected = b >= 0 ? b : undefined;
      void render();
      return;
    }
    if (tool === "move") {
      const refusal = moveRefusal(a, tx, ty, ground, v);
      if (refusal) {
        note("map", refusal, true);
        void render();
      } else {void act("map", async () => {
          const steps = await chooseMove(a, tx, ty);
          if (steps) await editAll("map", steps);
        })();}
      return;
    }
    if (tool === "spawn") {
      const why = blocked(t) ? `tile ${tx},${ty} is ${GROUND_TEXT[ground[t] as GroundKind]}` : habitatWhy(t);
      if (why) {
        note("map", `Not on tile ${tx},${ty}: ${why}. Pick a tile that is not darkened.`, true);
        void render();
        return;
      }
      const kind = spawnKind;
      void edit("map", beingsPath, (raw) => {
        spawnBeing(raw as unknown[], kind, tx, ty);
        return `Spawned a ${BEING_NAMES[kind]} in ${areaName(a)}, tile ${tx},${ty}`;
      });
    }
  });
  draw();

  const zoneButtons = h(
    "div",
    { class: "zone-grid", role: "group", "aria-label": "Zone" },
    w.zones.flat().map((z) =>
      h("button", {
        type: "button",
        class: `zone-button${z === a.zone ? " current" : ""}${you?.zone === z ? " you" : ""}`,
        disabled: !z.dir,
        title: `${coordLabel(z.x, z.y)} ${z.name}${z.dir ? "" : " (not explored)"}`,
        onclick: () => {
          area = { zone: z, dir: z.dir! };
          selected = undefined;
          void render();
        },
      }, coordLabel(z.x, z.y))
    ),
  );
  const inside = interiorsOf(w, a.zone.x, a.zone.y);
  const areaSelect = h(
    "select",
    {
      "aria-label": "Area",
      onchange: () => {
        const it = inside.find((i) => i.dir === areaSelect.value);
        area = it ? { zone: a.zone, interior: it, dir: it.dir } : { zone: a.zone, dir: a.zone.dir! };
        selected = undefined;
        void render();
      },
    },
    a.zone.dir ? h("option", { value: a.zone.dir, selected: !a.interior }, "Outdoors") : null,
    inside.map((it) =>
      h(
        "option",
        { value: it.dir, selected: a.interior === it },
        `${INTERIOR_NAMES[it.kind ?? -1] ?? "Interior"} at tile ${it.at[0] >> 4},${it.at[1] >> 4}`,
      )
    ),
  ) as HTMLSelectElement;
  const spawnSelect = h(
    "select",
    {
      "aria-label": "Creature to spawn",
      onchange: () => (spawnIndex = Number(spawnSelect.value), tool === "spawn" && void render()),
    },
    Object.keys(BEINGS).map(Number).filter(spawnable).sort((x, y) => BEING_NAMES[x].localeCompare(BEING_NAMES[y])).map((i) =>
      h("option", { value: i, selected: i === spawnIndex }, `${BEING_NAMES[i]}${habitat(i) === "walks" ? "" : ` (${habitat(i)})`}`)
    ),
  ) as HTMLSelectElement;
  const toolRadio = (value: Tool, label: string, disabled = false) =>
    h(
      "label",
      { class: `tool${disabled ? " disabled" : ""}` },
      h("input", {
        type: "radio",
        name: "map-tool",
        value,
        checked: tool === value,
        disabled,
        onchange: () => (tool = value, void render()),
      }),
      ` ${label}`,
    );
  const remove = (i: number) =>
    act("map", async () => {
      const b = beings[i];
      const name = BEING_NAMES[b.index] ?? "creature";
      if (
        isQuestBeing(b.index) &&
        !await ask({
          title: `Remove ${name}?`,
          body: [h("p", { class: "warning" }, `${name} is part of a quest. Removing them can leave that quest unfinishable.`)],
          confirm: "Remove anyway",
          danger: true,
        })
      ) return;
      selected = undefined;
      // The creature as it is now, so undoing an earlier change cannot make this remove a different one.
      const same = JSON.stringify((await session!.json(beingsPath) as unknown[])[i]);
      await edit("map", beingsPath, (raw) => {
        deleteBeing(raw as unknown[], i, same);
        return `Removed ${name} from ${areaName(a)}, tile ${b.x >> 4},${b.y >> 4}`;
      });
    });
  const sel = selected !== undefined ? beings[selected] : undefined;
  const cannotMove = a.interior && insideRefusal(a.interior, v);
  return card(
    "map",
    "Where you stand and creatures",
    zoneButtons,
    h(
      "div",
      { class: "map-tools" },
      areaSelect,
      toolRadio("inspect", "Select a creature"),
      toolRadio("move", "Move yourself here", !!cannotMove),
      toolRadio("spawn", "Spawn"),
      spawnSelect,
    ),
    !hasBeings ? h("p", { class: "muted small" }, "This area has no saved creature list, so creatures cannot be added here.") : null,
    h("div", { class: "map-frame" }, canvas),
    caption,
    cannotMove ? h("p", { class: "muted small" }, cannotMove) : null,
    youOnRaft ? h("p", { class: "muted small" }, "You are on your raft: the game makes it under you when it loads the save.") : null,
    sel
      ? h(
        "div",
        { class: "selected-being" },
        h("h4", {}, `${BEING_NAMES[sel.index] ?? "Creature"} at tile ${sel.x >> 4},${sel.y >> 4}`),
        ...creatureView(sel.index, sel.health, { key: "editor-being" }),
        h("button", { type: "button", class: "button subtle", onclick: remove(selected!) }, "Remove this creature"),
      )
      : null,
    h("h4", {}, `Creatures here (${beings.length})`),
    beings.length
      ? h(
        "ol",
        { class: "being-list" },
        beings.map((b, i) =>
          h(
            "li",
            { class: i === selected ? "selected" : "" },
            h(
              "button",
              { type: "button", class: "link", onclick: () => (selected = i, tool = "inspect", void render()) },
              BEING_NAMES[b.index] ?? `Being ${b.index}`,
            ),
            ` tile ${b.x >> 4},${b.y >> 4}`,
            isQuestBeing(b.index) ? h("span", { class: "tag" }, "quest") : null,
            " ",
            h("button", { type: "button", class: "button subtle small", onclick: remove(i) }, "Remove"),
          )
        ),
      )
      : h("p", { class: "muted" }, "None saved here."),
    h(
      "p",
      { class: "muted small" },
      "Dark tiles are what the tool cannot use: walls, pits and what is already there; for you, inside, also floor that no way " +
        "out leads to; and for the creature to spawn, where it cannot live: swimmers need water, walkers keep out of deep water and " +
        "off brambles, and flyers go anywhere. Point at a dark tile to see why. Brown marks are rafts. Moving you into water, or off " +
        "your raft, asks first what happens to a raft; a raft never goes inside. Loading the save keeps creatures where you put " +
        "them; entering their area later moves each to a nearby tile that suits it.",
    ),
  );
}

// --- Full map ---

/** Takes the full map down, returning where it was looking. */
function closeMap(): MapPlace | undefined {
  if (!map) return undefined;
  const st = map.state;
  rememberView(st);
  disposeView(st);
  map.urls.forEach((u) => URL.revokeObjectURL(u));
  map = undefined;
  return { selected: st.selected, interiorDir: st.interiorDir, viewport: st.viewport, inspected: st.inspected, expanded: st.expanded };
}

/** MirkMap's own view of the save as it would be saved, looking where it was, or else at the editor's area. */
async function renderMap(my: number) {
  const s = session!, c = s.character;
  try {
    const files = s.preview();
    const shown = await loadWorld(files, c.root, c.name);
    shown.cheated ||= cheated;
    const next = await worldState(shown, files, mapPrefs);
    if (my !== renderToken) {
      next.urls.forEach((u) => URL.revokeObjectURL(u));
      return;
    }
    const place: MapPlace = closeMap() ?? { selected: area && [area.zone.x, area.zone.y], interiorDir: area?.interior?.dir };
    map = { state: Object.assign(next.state, place), urls: next.urls };
    setMoving(moving);
    renderWorld(map.state);
    const target = mapTarget;
    mapTarget = undefined;
    if (target) await showJournalTarget(map.state, target);
  } catch (e) {
    console.error(e);
    note("fullmap", `Could not draw the map: ${errorText(e)}`, true);
  }
  updateMapBar();
}

/** Turns the full map's Move tool on or off; it is only on in edit mode. */
function setMoving(on: boolean) {
  moving = on && editing;
  if (map) map.state.onGround = moving ? (zone, tx, ty, inside) => void moveFromMap(zone, tx, ty, inside) : undefined;
  updateMapBar();
}

/**
 * The full map's Move tool: moves you to the clicked tile of a zone or interior (`inside`) when it is ground or water (asking first
 * about water and rafts, like the zone's map), then turns itself off. Cancelling the question keeps it on.
 */
async function moveFromMap(z: Zone, tx: number, ty: number, inside?: Interior) {
  if (!moving || !editing || session?.saving) return;
  try {
    let a: Area;
    if (inside) {
      // The full map reads the save as it would be saved; the editor's own world has the same folders.
      const it = world!.interiors.find((i) => i.dir === inside.dir);
      const zone = it && world!.zones[it.zone[1]]?.[it.zone[0]];
      if (!it || !zone) throw new Error("That interior is not in the save being edited.");
      a = { zone, interior: it, dir: it.dir };
    } else {
      const zone = world!.zones[z.y][z.x];
      if (!zone.dir) {
        throw new Error(`${coordLabel(zone.x, zone.y)} ${zone.name} is not explored yet; you can move only to a zone you have explored.`);
      }
      a = { zone, dir: zone.dir };
    }
    const v = parsePlayer(await session!.json(playerPath()));
    const { ground } = await areaGround(a, v);
    const refusal = moveRefusal(a, tx, ty, ground, v);
    if (refusal) throw new Error(refusal);
    const steps = await chooseMove(a, tx, ty);
    if (!steps || !moving) return;
    setMoving(false);
    await editAll("fullmap", steps);
  } catch (e) {
    note("fullmap", errorText(e), true);
    updateMapBar();
  }
}

function updateMapBar() {
  const shown = view === "map" && !!session;
  $("#map-bar").hidden = !shown;
  document.body.classList.toggle("map-mode", shown);
  document.body.classList.toggle("map-move", shown && moving);
  if (!shown) return;
  const n = session!.changes.length;
  $("#map-about").textContent =
    (n ? `The map shows ${n === 1 ? "your unsaved change" : `your ${n} unsaved changes`}.` : "The map shows the save as it is.") +
    (editing ? "" : " To make changes, choose Editor, then Edit this character...");
  $("#map-move-control").hidden = !editing;
  $<HTMLInputElement>("#map-move").checked = moving;
  const message = notes.get("fullmap");
  const out = $("#map-note");
  out.textContent = message?.text ?? "";
  out.classList.toggle("error", !!message?.error);
}

function updateViewSwitch() {
  $("#view-switch").hidden = !session;
  $("#show-editor").setAttribute("aria-pressed", String(view === "edit"));
  $("#show-map").setAttribute("aria-pressed", String(view === "map"));
}

/** Switches between the editor's cards and the full map; the editor picks up the area the map was looking at. */
function showView(next: View) {
  if (next === view) return;
  if (next === "edit") {
    setFullMap(false);
    const place = closeMap();
    const there = place && mapArea(place);
    if (there && there.dir !== area?.dir) {
      area = there;
      selected = undefined;
    }
    moving = false;
  }
  notes.delete("fullmap");
  view = next;
  void render();
}

function backupsCard(backups: Backup[]): HTMLElement {
  return card(
    "backups",
    "Backups in this browser",
    backups.length
      ? h(
        "ol",
        { class: "backup-list" },
        backups.map((b) =>
          h(
            "li",
            {},
            h("strong", {}, new Date(b.at).toLocaleString()),
            ` · ${b.files.length === 1 ? "1 file" : `${b.files.length} files`} before: `,
            h("span", { class: "muted" }, b.changes.join("; ")),
            " ",
            h("button", { type: "button", class: "button subtle small", onclick: () => void restore(b) }, "Restore"),
          )
        ),
      )
      : h("p", { class: "muted" }, "Each save keeps the files it replaces here, up to the last 10 saves of this world."),
  );
}

function previewCard(v: PlayerSave): HTMLElement {
  return h(
    "section",
    { class: "edit-card edit-preview", "aria-labelledby": "card-preview" },
    h("h3", { id: "card-preview" }, session!.changes.length ? "Preview with unsaved changes" : "As saved"),
    ...playerView(v, {
      key: "editor",
      expanded,
      difficulty: v.difficulty,
      // The journal's people and places are shown on the full map.
      find: (t) => {
        mapTarget = t;
        showView("map");
      },
    }),
  );
}

function updateSavebar() {
  const bar = $("#savebar");
  const changes = session?.changes ?? [];
  const kind = session?.source.kind;
  bar.hidden = !editing || !changes.length;
  const save = $<HTMLButtonElement>("#save");
  save.textContent = kind === "library" ? "Save to My worlds" : kind === "copy" ? "Save to game files..." : "Save to game files";
  save.title = kind === "copy"
    ? "Choose the game's Saves folder or this character's folder in it; your changes run again on the save there, then are saved"
    : "";
  save.hidden = kind === "copy" && !canWriteFolders();
  // A folder's own files are saved in place; the editor reads them without the game's .ini files, so it does not zip them.
  $("#download").hidden = kind === "folder";
  $("#change-count").textContent = `${changes.length === 1 ? "1 unsaved change" : `${changes.length} unsaved changes`}`;
  $("#change-list").replaceChildren(
    ...changes.map((c, i) =>
      h(
        "li",
        {},
        c,
        " ",
        h("button", {
          type: "button",
          class: "button subtle small",
          title: "Undo just this change; later changes stay",
          onclick: () => void undoChange(i),
        }, "Undo"),
      )
    ),
  );
}

/** Asks before `action` drops the unsaved changes; true when there are none or the user agrees. */
async function dropChanges(action: string, confirm: string): Promise<boolean> {
  const n = session?.changes.length ?? 0;
  return !n || await ask({
    title: "Drop your unsaved changes?",
    body: [`${action} drops ${n === 1 ? "your unsaved change" : `your ${n} unsaved changes`}. The save files stay as they are.`],
    confirm,
    danger: true,
  });
}

/** Opens a save after asking to drop the unsaved changes, if there are any. */
async function replace(open: () => Promise<void> | void) {
  if (await dropChanges("Opening another save", "Drop them and open")) await open();
}

/**
 * Follows the link back to MirkMap with the save open handed over, so the map shows it: the folder (watched again with Live saves
 * when it came from there), the world from My worlds, or the copy as it was opened.
 */
async function backToMap(e: MouseEvent) {
  const s = session;
  if (!s || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  const href = (e.currentTarget as HTMLAnchorElement).href;
  try {
    const save = await openSave(s);
    if (save) await handOff({ save, character: s.character }, "map");
  } catch (err) {
    console.error("Could not hand the save to MirkMap", err);
  }
  location.href = href;
}

// --- Wiring ---

function wire() {
  if (!canWriteFolders()) $("#unsupported").hidden = false;
  $("#open-folder").addEventListener("click", () => void replace(openFolder));
  const folderInput = $<HTMLInputElement>("#pick-folder"), zipInput = $<HTMLInputElement>("#pick-zip");
  for (const input of [folderInput, zipInput]) {
    input.addEventListener("change", () => {
      const list = Array.from(input.files ?? []);
      input.value = "";
      if (!list.length) return;
      const label = input === zipInput ? list[0].name : `a copy of the folder ${list[0].webkitRelativePath.split("/")[0] || "you chose"}`;
      void replace(() => openCopy(fromFiles(list), label));
    });
  }
  const worlds = $<HTMLSelectElement>("#open-world");
  worlds.addEventListener("change", () => {
    const id = worlds.value, library = worlds.selectedOptions[0]?.dataset.library;
    worlds.value = "";
    if (id) {
      void replace(async () => {
        try {
          await openSource(await libraryWorld(id, library));
        } catch (e) {
          status(errorText(e), true);
        }
      });
    }
  });
  $<HTMLAnchorElement>("#back-to-map").addEventListener("click", (e) => void backToMap(e));
  let depth = 0;
  addEventListener("dragenter", (e) => {
    e.preventDefault();
    if (++depth === 1) document.body.classList.add("dragging");
  });
  addEventListener("dragleave", () => {
    if (--depth <= 0) (depth = 0), document.body.classList.remove("dragging");
  });
  addEventListener("dragover", (e) => e.preventDefault());
  addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove("dragging");
    if (!e.dataTransfer || document.body.classList.contains("busy")) return;
    // Read at once: the dropped items are gone once this event is over.
    const files = fromDataTransfer(e.dataTransfer);
    files.catch(() => undefined);
    void replace(() => openCopy(files, "the dropped save"));
  });
  $<HTMLSelectElement>("#character").addEventListener("change", async (e) => {
    const select = e.target as HTMLSelectElement;
    const to = Number(select.value);
    if (!await dropChanges(`Switching to ${chars[to]?.name ?? "another character"}`, "Drop them and switch")) {
      select.value = String(active);
      return;
    }
    editing = false;
    notes.clear();
    void openCharacter(to);
  });
  $("#save").addEventListener("click", () => void save());
  $("#download").addEventListener("click", () => void download());
  $("#reload").addEventListener("click", () => void reloadSave());
  $("#show-editor").addEventListener("click", () => showView("edit"));
  $("#show-map").addEventListener("click", () => showView("map"));
  $<HTMLInputElement>("#map-move").addEventListener("change", (e) => {
    notes.delete("fullmap");
    setMoving((e.target as HTMLInputElement).checked);
  });
  addEventListener("keydown", (e) => {
    // An open dialog takes Escape for itself.
    if (e.key !== "Escape" || !moving || e.defaultPrevented || document.querySelector("dialog[open]")) return;
    // Handled here, so a full-screen map stays full screen.
    e.preventDefault();
    setMoving(false);
  });
  $("#discard").addEventListener("click", async () => {
    const n = session?.changes.length ?? 0;
    if (
      session?.saving || !n || !await ask({
        title: "Discard all unsaved changes?",
        body: [`${n === 1 ? "Your unsaved change is" : `All ${n} unsaved changes are`} dropped. The save files stay as they are.`],
        confirm: "Discard",
        danger: true,
      })
    ) return;
    session?.discard();
    notes.clear();
    void render();
  });
  const ok = $<HTMLInputElement>("#disclosure-ok");
  const dialog = $<HTMLDialogElement>("#disclosure");
  ok.addEventListener("change", () => ($<HTMLButtonElement>("#disclosure-enter").disabled = !ok.checked));
  $("#disclosure-cancel").addEventListener("click", () => dialog.close("cancel"));
  $("#disclosure-enter").addEventListener("click", () => dialog.close("enter"));
  dialog.addEventListener("close", () => {
    if (dialog.returnValue !== "enter" || !ok.checked) return;
    editing = true;
    void render();
  });
  // Remember which preview sections are open across re-renders.
  document.addEventListener("toggle", (e) => {
    const d = e.target as HTMLElement;
    if (!(d instanceof HTMLDetailsElement) || !d.dataset.remember) return;
    expanded ??= new Set(
      [...document.querySelectorAll<HTMLDetailsElement>("details[data-remember]")].filter((x) => x.open).map((x) => x.dataset.remember!),
    );
    if (d.open) expanded.add(d.dataset.remember);
    else expanded.delete(d.dataset.remember);
  }, true);
  addEventListener("beforeunload", (e) => {
    // A dev copy (devOpen) is a throwaway copy in this browser, so only a real save asks before leaving.
    if (session?.changes.length && !devCopy) e.preventDefault();
  });
}

wire();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch((e) => console.debug("No service worker", e));

/**
 * Dev server only (`deno task dev`, /edit/?dev=<Character>): copies that save from /__saves/ into this origin's private file system
 * and edits the copy, never the real save. Add &fresh to start over from the real save.
 */
async function devOpen(name: string, fresh: boolean) {
  status(`Copying ${name} into this browser for editing...`);
  const opfs = await navigator.storage.getDirectory() as unknown as EditDirectory & {
    getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<EditDirectory>;
    removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  };
  if (fresh) await opfs.removeEntry(name, { recursive: true }).catch(() => undefined);
  const exists = await opfs.getDirectoryHandle(name).then(() => true, () => false);
  const root = await opfs.getDirectoryHandle(name, { create: true });
  if (!exists) {
    const base = `/__saves/${encodeURIComponent(name)}/`;
    const list: string[] = await (await fetch(base)).json();
    for (const path of list) {
      if (!isSaveFile(path)) continue;
      const parts = path.split("/");
      let d = root as EditDirectory & { getDirectoryHandle(n: string, o?: { create?: boolean }): Promise<EditDirectory> };
      for (const part of parts.slice(0, -1)) d = await d.getDirectoryHandle(part, { create: true }) as typeof d;
      const bytes = await (await fetch(base + parts.map(encodeURIComponent).join("/"))).arrayBuffer();
      const out = await (await d.getFileHandle(parts[parts.length - 1], { create: true })).createWritable();
      await out.write(bytes);
      await out.close();
    }
    // Keep the game's order: Player.save before the current area's Containers.save.
    const touch = async (path: string) => {
      const parts = path.split("/");
      let d = root as EditDirectory;
      for (const part of parts.slice(0, -1)) d = await d.getDirectoryHandle(part);
      const handle = await d.getFileHandle(parts[parts.length - 1]);
      const bytes = await (await handle.getFile()).arrayBuffer();
      const out = await handle.createWritable();
      await out.write(bytes);
      await out.close();
    };
    for (const path of list.filter((p) => p.endsWith("/Containers.save"))) await touch(path);
  }
  await openSource(new FolderSource(root), undefined, false, true);
}

const dev = new URLSearchParams(location.search);
void listWorlds();
if (dev.get("dev") && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  void devOpen(dev.get("dev")!, dev.has("fresh")).catch((e) => status(`Dev copy failed: ${errorText(e)}`, true));
} else {
  // What MirkMap handed over, or the folder or library world open here last time.
  takeHandoff("editor").then(async (taken) => {
    if (taken && !source) await openHandoff(taken.handoff, taken.handed);
  }).catch((e) => {
    console.error(e);
    status(`Could not open the save again: ${errorText(e)}`, true);
  });
}

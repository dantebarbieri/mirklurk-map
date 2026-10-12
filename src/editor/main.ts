// Entry point of the save editor (edit.html, served at /edit/): open a character folder for writing, confirm that saving marks the
// world as Cheated, then change it. The edits are in edits.ts, items.ts and beings.ts; writing and backups in session.ts. The
// character preview is the map's own player inspection (player.ts), shown as the edits will be saved, and the Full map is the map's
// own world view (view.ts) of the save as it would be saved, where the Move tool picks where you stand.

import { $, h } from "../dom.ts";
import { type Character, characterIndex, findCharacters } from "../files.ts";
import { BEING_NAMES, ITEM_NAMES } from "../gamedata.ts";
import { worldId } from "../sharing-format.ts";
import { cheatedInfo, knownCheated } from "../cheated.ts";
import { isSaveFile, markerText } from "../marker.ts";
import { type Being, decodeJson, parseBeings, parsePlaced, parsePlayer, type PlayerSave } from "../save.ts";
import { type Interior, interiorsOf, loadDetail, loadHeights, loadLayer, loadTrees, loadWorld, type World, type Zone } from "../world.ts";
import { MAX_LEVEL, percent, playerView, STAT_LABELS, temperatureLabel, xpForLevel } from "../player.ts";
import { creatureView } from "../creature.ts";
import { Coin, coinsView, countCoins } from "../coins.ts";
import { coordLabel, INTERIOR_NAMES, isOutside, TILES } from "../rules.ts";
import { spriteBox } from "../predict.ts";
import { BEINGS, targetsYou } from "../bestiary.ts";
import { healthText } from "../health.ts";
import { formatClock, parseSky, Weather, WEATHER_LABELS, weatherKind, type WeatherState } from "../weather.ts";
import { type Backup, canEdit, type Edit, type EditDirectory, EditSession, listBackups, type WritablePicker } from "./session.ts";
import {
  healPlayer,
  insideOf,
  isInside,
  MAX_DAY,
  MAX_SKILL_POINTS,
  MIN_RAIN,
  playerRecord,
  type Rec,
  setLevel,
  setNewHitPoints,
  setSkillPoints,
  setSky,
  setVitals,
  type SkyEdit,
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
import { disposeView, rememberView, renderWorld, type State, worldState } from "../view.ts";
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

let dir: EditDirectory | undefined;
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
/** Open sections of the preview, once the user has opened or closed one. */
let expanded: Set<string> | undefined;
const notes = new Map<string, { text: string; error?: boolean }>();
let renderToken = 0;
let view: View = "edit";
/** The full map while it is shown, with the blob: URLs of its zone maps. */
let map: { state: State; urls: string[] } | undefined;
/** The full map's Move tool is on: a click on its empty ground moves you there. */
let moving = false;
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

// --- Opening a folder ---

async function openFolder() {
  const picker = globalThis as WritablePicker;
  try {
    dir = await picker.showDirectoryPicker!({ mode: "readwrite", id: "mirklurk-saves" });
    devCopy = false;
  } catch (e) {
    if ((e as DOMException).name !== "AbortError") status(`Could not open the folder: ${errorText(e)}`, true);
    return;
  }
  await openCharacter(0);
}

/** Reads the folder again and shows character `i`; edit mode ends and unsaved edits are dropped. */
async function openCharacter(i: number, keepArea = false) {
  if (!dir) return;
  status("Reading the save...");
  try {
    const { scan, files } = await EditSession.open(dir);
    const found = findCharacters(files);
    const pick = chars.length ? characterIndex(found, chars[i]) : i;
    chars = found;
    active = Math.min(pick, chars.length - 1);
    const c = chars[active];
    const loaded = await loadWorld(files, c.root, c.name);
    const id = await worldId(c.name, loaded.player.grid);
    // Another character or folder starts the full map afresh; after a save or restore it stays where it was.
    if (!keepArea) closeMap();
    session = new EditSession(dir, scan, files, c, id);
    world = loaded;
    cheated = cheatedInfo(await markerText(files, c.root)) !== undefined || await knownCheated(id);
    if (!keepArea || !area) area = playerArea(loaded.player);
    else area = sameArea(area);
    selected = undefined;
    forgetMapImages();
    showCharacters();
    document.body.classList.add("loaded");
    status(`${c.name} loaded${loaded.warnings.length ? ` with ${loaded.warnings.length} warnings` : ""}.`);
  } catch (e) {
    console.error(e);
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

/**
 * Reads the folder again, after playing in the game, and runs the unsaved changes again on the newest save, so they can still be
 * saved. Changes that no longer apply, or now change nothing, are dropped and named. If the folder now holds another world, loading
 * it drops the changes, after asking.
 */
async function reloadSave() {
  const s = session;
  if (!dir || !s || s.saving) return;
  status("Reading the save again...");
  let otherWorld = false;
  await locked(async () => {
    try {
      const { scan, files } = await EditSession.open(dir!);
      const found = findCharacters(files);
      const c = found.find((ch) => ch.root === s.character.root);
      if (!c) throw new Error(`${s.character.name}'s save is no longer in this folder. Open the folder again to choose a character.`);
      const loaded = await loadWorld(files, c.root, c.name);
      if (await worldId(c.name, loaded.player.grid) !== s.world) {
        otherWorld = true;
        return;
      }
      const marked = cheatedInfo(await markerText(files, c.root)) !== undefined || await knownCheated(s.world);
      const dropped = await s.rebase(scan, files);
      if (session !== s) return;
      chars = found;
      active = found.indexOf(c);
      world = loaded;
      cheated = marked;
      area = area ? sameArea(area) : playerArea(loaded.player);
      selected = undefined;
      savedRecords.delete(s);
      forgetMapImages();
      showCharacters();
      notes.clear();
      const n = s.changes.length;
      status(
        `Reloaded ${c.name}'s save${loaded.warnings.length ? ` with ${loaded.warnings.length} warnings` : ""}.` +
          (n ? ` ${n === 1 ? "Your unsaved change still applies" : `Your ${n} unsaved changes still apply`}.` : "") +
          (dropped.length
            ? ` Dropped, as ${dropped.length === 1 ? "it no longer applies" : "they no longer apply"}: ${dropped.join("; ")}.`
            : ""),
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
  $<HTMLButtonElement>("#save").disabled = true;
  try {
    return await run();
  } finally {
    document.body.classList.remove("busy");
    $<HTMLButtonElement>("#save").disabled = false;
  }
}

async function save() {
  if (session?.saving) return;
  status("Saving...");
  await locked(async () => {
    try {
      const n = await session!.save();
      cheated = true;
      notes.clear();
      await openCharacter(active, true);
      editing = true;
      status(`Saved ${n === 1 ? "1 file" : `${n} files`}. This world is now marked Cheated. Load it from the game's menu to play it.`);
      await render();
    } catch (e) {
      console.error(e);
      status(errorText(e), true);
    }
  });
}

async function restore(b: Backup) {
  if (session?.saving) return;
  const when = new Date(b.at).toLocaleString();
  if (
    !await ask({
      title: `Restore the files from before ${when}?`,
      body: [
        `This writes back the ${b.files.length === 1 ? "file" : `${b.files.length} files`} the world had before the edits saved then: ${
          b.changes.join("; ")
        }.`,
        session?.changes.length ? h("p", { class: "warning" }, "Your unsaved changes are dropped.") : null,
        "The Cheated mark stays.",
      ],
      confirm: "Restore",
      danger: true,
    })
  ) return;
  await locked(async () => {
    try {
      session!.discard();
      await session!.restore(b);
      status(`Restored the files from before ${when}.`);
    } catch (e) {
      status(errorText(e), true);
      return;
    }
    await openCharacter(active, true);
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
  $("#reload").hidden = !s || !editing;
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
  const cards: HTMLElement[] = [];
  if (editing) {
    const saved = await savedPlayer(s).catch(() => undefined);
    cards.push(
      characterCard(v),
      skyCard(p),
      itemsCard(v, p, saved),
      await mapCard(v, p),
      backupsCard(await listBackups(s.world).catch(() => [])),
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
  const c = session!.character;
  const sky = parseSky(p);
  const where = playerArea(v);
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
    editing
      ? h(
        "p",
        { class: "muted" },
        "Edit mode. Changes stay in this tab until you save them with the bar at the bottom. Played since? Save and quit to the " +
          "game's menu and choose Reload save at the top: your unsaved changes stay.",
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
    "Level, points, health and wellbeing",
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
    h("h4", {}, "Health"),
    h("p", {}, v.health ? healthText(v.health) : "Hit points were not saved."),
    h("button", {
      type: "button",
      class: "button subtle",
      onclick: act("character", () =>
        editPlayer("character", (p) => {
          const before = JSON.stringify([p.hpgrid, p.statusgrid]);
          const n = healPlayer(p);
          if (JSON.stringify([p.hpgrid, p.statusgrid]) === before) return undefined;
          return `Healed ${n === 1 ? "1 hit point" : `${n} hit points`} and cleared poison, bleeding and stun`;
        })),
    }, "Heal all wounds"),
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
    h("p", { class: "muted small" }, "Conditions such as sickness or exhaustion keep affecting wellbeing until they run out."),
  );
}

const describeVital = (key: keyof VitalsEdit, v: number) => key === "warmth" ? `${percent(v)} ${temperatureLabel(v)}` : percent(v);

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

async function upkeep(what: Upkeep) {
  await editPlayer("items", (rec) => {
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
    ...playerView(v, { key: "editor", expanded, difficulty: v.difficulty }),
  );
}

function updateSavebar() {
  const bar = $("#savebar");
  const changes = session?.changes ?? [];
  bar.hidden = !editing || !changes.length;
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

// --- Wiring ---

function wire() {
  if (!canEdit()) {
    $("#unsupported").hidden = false;
    $<HTMLButtonElement>("#open-folder").disabled = true;
  }
  $("#open-folder").addEventListener("click", async () => {
    if (!await dropChanges("Opening another folder", "Drop them and open")) return;
    editing = false;
    void openFolder();
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
    // A dev copy (devOpen) is a throwaway copy in this browser, so only a real save folder asks before leaving.
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
  dir = root;
  devCopy = true;
  await openCharacter(0);
}

const dev = new URLSearchParams(location.search);
if (dev.get("dev") && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  void devOpen(dev.get("dev")!, dev.has("fresh")).catch((e) => status(`Dev copy failed: ${errorText(e)}`, true));
}

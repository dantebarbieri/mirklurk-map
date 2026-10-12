// Entry point of the save editor (edit.html, served at /edit/): open a character folder for writing, confirm that saving marks the
// world as Cheated, then change it. The edits are in edits.ts, items.ts and beings.ts; writing and backups in session.ts. The
// character preview is the map's own player inspection (player.ts), shown as the edits will be saved.

import { $, h } from "../dom.ts";
import { type Character, characterIndex, findCharacters } from "../files.ts";
import { BEING_NAMES, ITEM_NAMES } from "../gamedata.ts";
import { worldId } from "../sharing-format.ts";
import { cheatedInfo, knownCheated } from "../cheated.ts";
import { isSaveFile, markerText } from "../marker.ts";
import { type Being, parseBeings, parsePlayer, type PlayerSave } from "../save.ts";
import { type Interior, interiorsOf, loadDetail, loadLayer, loadTrees, loadWorld, type World, type Zone } from "../world.ts";
import { MAX_LEVEL, percent, playerView, STAT_LABELS, temperatureLabel, xpForLevel } from "../player.ts";
import { creatureView } from "../creature.ts";
import { Coin, coinsView, countCoins } from "../coins.ts";
import { centerpos, coordLabel, INTERIOR_NAMES, isOutside, TILES } from "../rules.ts";
import { spriteBox } from "../predict.ts";
import { BEINGS, targetsYou } from "../bestiary.ts";
import { healthText } from "../health.ts";
import { formatClock, parseSky, Weather, WEATHER_LABELS, weatherKind, type WeatherState } from "../weather.ts";
import { type Backup, canEdit, type EditDirectory, EditSession, listBackups, type WritablePicker } from "./session.ts";
import {
  healPlayer,
  MAX_DAY,
  MAX_SKILL_POINTS,
  MIN_RAIN,
  movePlayer,
  playerRecord,
  type Rec,
  setLevel,
  setNewHitPoints,
  setSkillPoints,
  setSky,
  setVitals,
  type VitalsEdit,
} from "./edits.ts";
import { addable, addItems, freeCells } from "./items.ts";
import { deleteBeing, isQuestBeing, spawnable, spawnBeing } from "./beings.ts";
import { type Box, Ground, GROUND_TEXT, type GroundKind, groundMap, tileBox } from "./ground.ts";

/** An area the map card shows: an outdoor zone or one of its interiors. */
interface Area {
  zone: Zone;
  interior?: Interior;
  dir: string;
}
type Tool = "inspect" | "move" | "spawn";

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
    session = new EditSession(dir, scan, files, c, id);
    world = loaded;
    cheated = cheatedInfo(await markerText(files, c.root)) !== undefined || await knownCheated(id);
    if (!keepArea || !area) area = playerArea(loaded.player);
    else area = sameArea(area);
    selected = undefined;
    const select = $<HTMLSelectElement>("#character");
    select.replaceChildren(...chars.map((ch, n) => h("option", { value: n, selected: n === active }, ch.name)));
    select.hidden = chars.length < 2;
    document.body.classList.add("loaded");
    status(`${c.name} loaded${loaded.warnings.length ? ` with ${loaded.warnings.length} warnings` : ""}.`);
  } catch (e) {
    console.error(e);
    status(errorText(e), true);
    return;
  }
  await render();
}

function playerArea(p: PlayerSave): Area | undefined {
  const w = world!;
  const zone = w.zones[p.area.y]?.[p.area.x];
  if (!zone) return undefined;
  if (!isOutside(p.area.type)) {
    const inside = interiorsOf(w, zone.x, zone.y).find((it) => isPlayerIn(p, it));
    if (inside) return { zone, interior: inside, dir: inside.dir };
  }
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

function isPlayerIn(p: PlayerSave, it: Interior): boolean {
  if (p.area.type >= 24 && p.area.type <= 26) return it.at[0] === -1 && it.at[1] === p.area.type - 23;
  return it.zone[0] === p.area.x && it.zone[1] === p.area.y && it.at[0] === centerpos(p.entrance[0]) &&
    it.at[1] === centerpos(p.entrance[1]);
}

const areaName = (a: Area) => {
  const zone = `${coordLabel(a.zone.x, a.zone.y)} ${a.zone.name}`;
  return a.interior ? `${INTERIOR_NAMES[a.interior.kind ?? -1] ?? "Interior"} in ${zone}` : zone;
};

// --- Editing ---

async function edit(card: string, path: string, change: (raw: unknown) => string | undefined) {
  try {
    const raw = await session!.json(path);
    const text = change(raw);
    if (text) {
      session!.changed(path, text);
      note(card, `${text}. Not saved yet.`);
    }
  } catch (e) {
    note(card, errorText(e), true);
  }
  await render();
}

const editPlayer = (card: string, change: (p: Rec) => string | undefined) => edit(card, playerPath(), (raw) => change(playerRecord(raw)));

/** Locks the page while a save or restore writes files, so nothing changes or discards the drafts meanwhile. */
async function writing<T>(run: () => Promise<T>): Promise<T> {
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
  await writing(async () => {
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
    !confirm(
      `Write back the ${
        b.files.length === 1 ? "file" : `${b.files.length} files`
      } this world had before the edits saved ${when}? Unsaved edits are dropped. The Cheated mark stays.`,
    )
  ) return;
  await writing(async () => {
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
  if (!s || !world) return;
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
    cards.push(characterCard(v), skyCard(p), itemsCard(v, p), await mapCard(v), backupsCard(await listBackups(s.world).catch(() => [])));
  }
  if (my !== renderToken) return;
  app.replaceChildren(summary(v, p), ...(editing ? [h("div", { class: "edit-grid" }, ...cards, previewCard(v))] : []));
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
    editing ? h("p", { class: "muted" }, "Edit mode. Changes stay in this tab until you save them with the bar at the bottom.") : h(
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
      setButton(() =>
        editPlayer("character", (p) => {
          const to = readWhole(level, "Level"), from = Number(p.level);
          setLevel(p, to);
          return to === from ? undefined : `Level ${from} → ${to} (skill points and new hit points follow)`;
        })
      ),
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
      setButton(() =>
        editPlayer("character", (p) => {
          const to = readWhole(skill, "Skill points"), from = Number(p.skillPoints);
          setSkillPoints(p, to);
          return to === from ? undefined : `Skill points ${from} → ${to}`;
        })
      ),
    ),
    field(
      "New hit points to place",
      newHp,
      setButton(() =>
        editPlayer("character", (p) => {
          const to = readWhole(newHp, "New hit points"), from = Number(p.hpAddPoints);
          setNewHitPoints(p, to);
          return to === from ? undefined : `New hit points ${from} → ${to}`;
        })
      ),
    ),
    h("h4", {}, "Health"),
    h("p", {}, v.health ? healthText(v.health) : "Hit points were not saved."),
    h("button", {
      type: "button",
      class: "button subtle",
      onclick: act("character", () =>
        editPlayer("character", (p) => {
          const n = healPlayer(p);
          return `Healed ${n === 1 ? "1 hit point" : `${n} hit points`} and cleared poison, bleeding and stun`;
        })),
    }, "Heal all wounds"),
    h("h4", {}, "Wellbeing and stats"),
    vitals ? vitalRows : h("p", { class: "muted" }, "This save does not record wellbeing."),
    vitals
      ? h("button", {
        type: "button",
        class: "button subtle",
        onclick: act("character", () =>
          editPlayer("character", (p) => {
            const changes: string[] = [];
            const e: VitalsEdit = {};
            for (const [key, label, before] of sliders) {
              const to = Number(inputs.get(key)!.value) / 100;
              if (Math.round((before ?? 0) * 100) === Math.round(to * 100)) continue;
              e[key] = to;
              changes.push(`${label} ${percent(before ?? 0)} → ${percent(to)}`);
            }
            setVitals(p, e);
            return changes.length ? changes.join(", ") : undefined;
          })),
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
  const apply = act("sky", () =>
    editPlayer("sky", (rec) => {
      const [hh, mm] = time.value.split(":").map(Number);
      if (!Number.isInteger(hh) || !Number.isInteger(mm)) throw new Error("Choose a time");
      const before = parseSky(rec)!;
      const w = Number(weather.value) as WeatherState;
      const e = {
        day: readWhole(day, "Day"),
        minute: hh * 60 + mm,
        weather: w,
        rain: Number(rain.value) / 100,
        temperature: Number(temp.value) / 100,
      };
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
    }));
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

function itemsCard(v: PlayerSave, p: Rec): HTMLElement {
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
      return r.added ? `Added ${r.added} × ${ITEM_NAMES[index]}` : undefined;
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
    h("button", {
      type: "button",
      class: "button subtle",
      onclick: act("items", async () => {
        const index = ITEM_CHOICES.get(name.value.trim());
        if (index === undefined) throw new Error("Pick an item from the list");
        await add(index, readWhole(amount, "Amount"));
      }),
    }, "Add to bags"),
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
      "Items go into the bags you carry, topping up stacks first, exactly as picking them up would. New items glow gold in the game until you look at them.",
    ),
  );
}

// --- Map and creatures ---

const mapImages = new Map<string, Promise<HTMLImageElement | undefined>>();
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

async function mapCard(v: PlayerSave): Promise<HTMLElement> {
  const w = world!;
  if (!area) return card("map", "Where you stand and creatures", h("p", { class: "muted" }, "No explored area was found."));
  const a = area;
  const beingsPath = `${a.dir}Beings.save`;
  const hasBeings = session!.files.has(beingsPath);
  const rawBeings = hasBeings ? await session!.json(beingsPath) as unknown[] : [];
  const beings: Being[] = parseBeings(rawBeings);
  const [data, water1] = await Promise.all(["Data", "Water1"].map((l) => loadLayer(w, a.dir, l)));
  const trees = await loadTrees(w, a.dir);
  const detail = await loadDetail(w, a.dir);
  const solids = a.interior ? a.interior.solids : a.zone.solids;
  const you = playerArea(v);
  const youHere = you?.dir === a.dir;
  const taken: Box[] = [
    ...solids.map((s) => spriteBox(s.sprite, s.x, s.y)),
    ...trees.map((t) => tileBox(t.x, t.y)),
    ...[...detail.containers, ...detail.stations, ...detail.interactables].map((c) => spriteBox(c.sprite, c.x, c.y)),
    ...beings.map((b) => tileBox(b.x, b.y)),
    ...(youHere ? [tileBox(v.pos[0], v.pos[1])] : []),
  ];
  const ground = groundMap(data?.data, water1?.data, taken);
  const img = a.interior ? undefined : await mapImage(a.zone.mapPath);
  if (selected !== undefined && !beings[selected]) selected = undefined;
  const youTile = youHere ? (v.pos[1] >> 4) * TILES + (v.pos[0] >> 4) : -1;

  const canvas = h("canvas", { width: TILES * SCALE, height: TILES * SCALE, class: `edit-map tool-${tool}` }) as HTMLCanvasElement;
  const caption = h("p", { class: "muted small map-caption" }, "Point at a tile to see what is there.");
  let hover: number | undefined;
  const beingAt = (t: number) => beings.findIndex((b) => (b.y >> 4) * TILES + (b.x >> 4) === t);
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
      if (tool !== "inspect" && k !== Ground.Free) {
        g.fillStyle = "rgba(20, 10, 12, .45)";
        g.fillRect(x, y, SCALE, SCALE);
      }
    }
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
    const what = b >= 0 ? BEING_NAMES[beings[b].index] ?? "Creature" : t === youTile ? "you" : GROUND_TEXT[ground[t] as GroundKind];
    return `Tile ${t % TILES},${Math.floor(t / TILES)}: ${what}`;
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
    if (ground[t] !== Ground.Free) {
      note("map", `Tile ${tx},${ty} is ${GROUND_TEXT[ground[t] as GroundKind]}; pick free ground.`, true);
      void render();
      return;
    }
    if (tool === "move") {
      if (a.interior) return;
      if (!session!.files.has(`${a.dir}Containers.save`)) {
        note("map", "The game has not finished saving this zone (it has no Containers.save), so you cannot move there.", true);
        void render();
        return;
      }
      void editPlayer("map", (p) => {
        movePlayer(p, a.zone.x, a.zone.y, tx, ty);
        return `Moved you to ${areaName(a)}, tile ${tx},${ty}`;
      });
    } else if (tool === "spawn") {
      void edit("map", beingsPath, (raw) => {
        spawnBeing(raw as unknown[], spawnIndex, tx, ty);
        return `Spawned a ${BEING_NAMES[spawnIndex]} in ${areaName(a)}, tile ${tx},${ty}`;
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
    { "aria-label": "Creature to spawn", onchange: () => (spawnIndex = Number(spawnSelect.value)) },
    Object.keys(BEINGS).map(Number).filter(spawnable).sort((x, y) => BEING_NAMES[x].localeCompare(BEING_NAMES[y])).map((i) =>
      h("option", { value: i, selected: i === spawnIndex }, BEING_NAMES[i])
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
        isQuestBeing(b.index) && !confirm(`${name} is part of a quest. Removing them can leave that quest unfinishable. Remove anyway?`)
      ) return;
      selected = undefined;
      await edit("map", beingsPath, (raw) => {
        deleteBeing(raw as unknown[], i);
        return `Removed ${name} from ${areaName(a)}, tile ${b.x >> 4},${b.y >> 4}`;
      });
    });
  const sel = selected !== undefined ? beings[selected] : undefined;
  return card(
    "map",
    "Where you stand and creatures",
    zoneButtons,
    h(
      "div",
      { class: "map-tools" },
      areaSelect,
      toolRadio("inspect", "Select a creature"),
      toolRadio("move", "Move yourself here", !!a.interior),
      toolRadio("spawn", "Spawn"),
      spawnSelect,
    ),
    !hasBeings ? h("p", { class: "muted small" }, "This area has no saved creature list, so creatures cannot be added here.") : null,
    h("div", { class: "map-frame" }, canvas),
    caption,
    a.interior ? h("p", { class: "muted small" }, "You can move only to an outdoor zone you have explored.") : null,
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
      "Dark tiles are water, walls or already taken. Creatures stand where you put them when the game loads the area.",
    ),
  );
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
  $("#change-list").replaceChildren(...changes.map((c) => h("li", {}, c)));
}

// --- Wiring ---

function wire() {
  if (!canEdit()) {
    $("#unsupported").hidden = false;
    $<HTMLButtonElement>("#open-folder").disabled = true;
  }
  $("#open-folder").addEventListener("click", () => {
    if (session?.changes.length && !confirm("Drop your unsaved changes and open another folder?")) return;
    editing = false;
    void openFolder();
  });
  $<HTMLSelectElement>("#character").addEventListener("change", (e) => {
    const select = e.target as HTMLSelectElement;
    if (session?.changes.length && !confirm("Drop your unsaved changes and switch character?")) {
      select.value = String(active);
      return;
    }
    editing = false;
    notes.clear();
    void openCharacter(Number(select.value));
  });
  $("#save").addEventListener("click", () => void save());
  $("#discard").addEventListener("click", () => {
    if (session?.saving || !confirm("Discard all unsaved changes?")) return;
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
    if (session?.changes.length) e.preventDefault();
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
  await openCharacter(0);
}

const dev = new URLSearchParams(location.search);
if (dev.get("dev") && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  void devOpen(dev.get("dev")!, dev.has("fresh")).catch((e) => status(`Dev copy failed: ${errorText(e)}`, true));
}

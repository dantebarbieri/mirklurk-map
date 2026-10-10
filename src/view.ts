// Page rendering: world grid, landmark list, zone and interior panels.

import { $, h, hex, s, tileImage } from "./dom.ts";
import { focusZone, MapView, markIcon, personSvg, zonesInView } from "./mapview.ts";
import type { Estimate } from "./estimate.ts";
import {
  brambleMarks,
  detailMarks,
  type Layer,
  LAYERS,
  type Mark,
  markKey,
  sealedMarks,
  solidMarks,
  treeDetail,
  treeMarks,
} from "./objects.ts";
import { CHOP_TOOLS, chosenTool, ownedTools, trunkOf, UNARMED } from "./chop.ts";
import { heatBounds, type Landmark, type LandmarkId, pct, zoneHeat } from "./predict.ts";
import { Area, coordLabel, INTERIOR_NAMES, isOutside, NPC_BEINGS, ROOM, Thresh, tileIndex, TILES } from "./rules.ts";
import { BEING_NAMES, ITEM_NAMES } from "./gamedata.ts";
import { paintThumbnail, TerrainRaster, TerrainStore, worldScenes } from "./terrain.ts";
import { entityLink, inspectMark, inventoryView, wikiTitle } from "./inspect.ts";
import { coinRollup } from "./player.ts";
import { entityWiki } from "./wiki.ts";
import {
  type Interior,
  interiorsOf,
  loadDetail,
  loadHeights,
  loadLayer,
  loadTrees,
  type World,
  type Zone,
  type ZoneDetail,
} from "./world.ts";

export interface State {
  world: World;
  marks: Landmark[];
  mapUrls: Map<string, string>;
  /** Shared across characters and reloads. */
  prefs: {
    layers: Set<Layer>;
    water: boolean;
    realistic: boolean;
    /** Show only trees whose trunk freshness index is at least this (0 = all, 4 = dead only). */
    treeMin: number;
    /** Manually picked chopping tool and the carried tools it was picked with (see `chosenTool`). */
    chopTool?: { tool: number; owned: string };
    /** The map legend is expanded; unset until toggled (then it starts open on large screens). */
    legend?: boolean;
  };
  terrain: TerrainStore;
  cleanup?: () => void;
  selected?: [number, number];
  interiorDir?: string;
  viewport?: [number, number, number];
  inspected?: string;
  expanded?: Set<string>;
  /** Live mode only: where the player probably went after this save. */
  estimate?: Estimate | null;
}

const HEAT_COLOR: Record<LandmarkId, string> = {
  fort: "#fff3b2",
  bhato: "#a6d98c",
  library: "#ffd873",
  scaal: "#c79bff",
  gurb: "#ff9f5a",
  ihar: "#6fd3ff",
};

const key = (x: number, y: number) => `${x},${y}`;
let token = 0;
let activeMap: MapView | undefined;
/** The zone whose coordinates `activeMap` uses; undefined while it shows an interior. */
let activeZone: [number, number] | undefined;

export function rememberView(st: State) {
  st.viewport = activeMap?.requested;
  st.expanded = openSections(document);
}

export function playerInterior(world: World): Interior | undefined {
  const p = world.player;
  if (isOutside(p.area.type)) return undefined;
  return world.interiors.find((it) =>
    it.kind === p.area.type && it.zone[0] === p.area.x && it.zone[1] === p.area.y &&
    (it.at[0] === -1 || (it.at[0] === p.entrance[0] && it.at[1] === p.entrance[1]))
  );
}

export function disposeView(st: State) {
  ++token;
  activeMap?.dispose();
  activeMap = undefined;
  activeZone = undefined;
  st.cleanup?.();
  st.terrain.dispose();
}

/** Water on each side of a zone, as the game decides it (terrain_create_shore in Alarm_2). */
function shores(world: World, x: number, y: number) {
  const g = world.player.grid;
  const t = g[y][x];
  const wet = (xx: number, yy: number) => {
    const v = g[yy]?.[xx];
    return v === undefined || v === Area.VastWaters || v === Area.BrokenFen || t === Area.BrokenFen;
  };
  return { all: t === Area.VastWaters, n: wet(x, y - 1), s: wet(x, y + 1), e: wet(x + 1, y), w: wet(x - 1, y) };
}

interface Spot {
  x: number;
  y: number;
  zone: [number, number];
  inside: boolean;
  /** Interior holding the player, when known. */
  interior?: string;
  /** Position inside interior. */
  at?: [number, number];
  estimated?: string;
  title: string;
}

const tileOf = (x: number, y: number) => `tile ${x >> 4},${y >> 4}`;

/** The player's spot: the live estimate when there is one, else the saved position (indoors, the entrance outside). */
export function playerSpot(st: State): Spot {
  const world = st.world, p = world.player, e = st.estimate;
  const saved = `saved at ${coordLabel(p.area.x, p.area.y)}${isOutside(p.area.type) ? "" : " (indoors)"}, ${tileOf(p.pos[0], p.pos[1])}`;
  if (e) {
    const [x, y] = e.interior ? e.entrance ?? e.interior.at : e.pos;
    return {
      x,
      y,
      zone: e.zone,
      inside: e.inside,
      interior: e.interior?.dir,
      at: e.interior ? e.pos : undefined,
      estimated: e.basis,
      title: `${world.character} (estimated: ${e.basis}; ${saved})`,
    };
  }
  const inside = !isOutside(p.area.type);
  const [x, y] = inside ? p.entrance : p.pos;
  return {
    x,
    y,
    zone: [p.area.x, p.area.y],
    inside,
    interior: playerInterior(world)?.dir,
    at: p.pos,
    title: `${world.character} (${saved})`,
  };
}

const youLabel = (st: State, you: Spot, inside: boolean) =>
  `${st.world.character}${inside ? " (inside)" : ""}${you.estimated ? " (est.)" : ""}`;

/** The player's clickable map marker, carrying the save for their inspection; `away` when drawn from a neighbouring zone. */
const youMark = (st: State, you: Spot, x: number, y: number, label: string, away?: Mark["away"]): { mark: Mark; title: string } => ({
  mark: {
    layer: "you",
    kind: "you",
    x,
    y,
    name: st.world.character,
    label,
    detail: you.estimated ? `probably here (${you.estimated})` : undefined,
    away,
    player: st.world.player,
  },
  title: you.title,
});

export function renderWorld(st: State) {
  st.cleanup?.();
  const w = st.world, p = w.player;
  const you = playerSpot(st);
  const root = document.documentElement.style;
  if (p.hair) root.setProperty("--hair", p.hair);
  else root.removeProperty("--hair");
  const light = p.hairLight !== false;
  root.setProperty("--you-line", light ? "#120e0f" : "#f4efe6");
  root.setProperty("--you-halo", light ? "#f4efe6" : "#120e0f");
  const here = w.zones[you.zone[1]]?.[you.zone[0]];
  const version = p.version === "0.8.1.5" ? "" : ` · made for game 0.8.1.5, this save is ${p.version}`;
  const summary = h(
    "p",
    { class: "summary" },
    h("b", {}, w.character),
    ` · day ${p.day}`,
    here
      ? ` · you are ${you.estimated ? "probably " : ""}in ${coordLabel(here.x, here.y)} ${here.name}${you.inside ? " (indoors)" : ""}${
        you.estimated ? ` (estimated: ${you.estimated})` : ""
      }`
      : "",
    version,
  );
  const freshness = h(
    "p",
    { class: "muted freshness" },
    p.version ? "Saved snapshot" : "Snapshot",
    w.savedAt ? ` - Player saved ${new Date(w.savedAt).toLocaleString()}` : " - file timestamp unavailable",
    ". Not a live position; other areas and ground loot may have different save times.",
  );
  const grid = h("div", { class: "grid", role: "group", "aria-label": "World map" });
  grid.append(h("span"), ..."ABCDE".split("").map((c) => h("span", { class: "axis" }, c)));
  for (let y = 0; y < 5; y++) {
    grid.append(h("span", { class: "axis" }, y + 1));
    for (let x = 0; x < 5; x++) grid.append(cell(st, w.zones[y][x], you));
  }
  const warn = w.warnings.length
    ? h(
      "details",
      { class: "warnings" },
      h("summary", {}, `${w.warnings.length} file(s) could not be read`),
      h("ul", {}, w.warnings.map((t) => h("li", {}, t))),
    )
    : null;
  const mode = h("input", { type: "checkbox", checked: st.prefs.realistic, id: "realistic-mode" }) as HTMLInputElement;
  mode.addEventListener("change", () => setRealistic(st, mode.checked));
  const modeControl = h("label", { class: "chip mode" }, mode, "Realistic");
  const artStatus = h("p", { class: "legend art-status", role: "status" });
  const updateArt = () => {
    if (!st.prefs.realistic) return;
    const scenes = worldScenes(w, 0, 0);
    for (const target of grid.querySelectorAll<HTMLCanvasElement>("canvas")) {
      const scene = scenes[Number(target.dataset.zone)];
      paintThumbnail(target, st.terrain, scene);
    }
    const saved = scenes.filter((scene) => scene.dir);
    const ready = saved.filter((scene) => st.terrain.previews.has(scene.dir!) || st.terrain.errors.has(scene.dir!)).length;
    const problems = [...st.terrain.errors.values(), ...w.warnings];
    artStatus.textContent = problems.length
      ? problems.join(" · ")
      : !saved.length
      ? "No saved terrain available. Open the full character folder or ZIP, including its area folders, for realistic mode."
      : ready < saved.length
      ? `Rendering saved terrain (${ready}/${saved.length})...`
      : "Game terrain and saved scenery. Wheel to zoom, drag to pan, World to fit all zones. Pan a neighbouring zone into view, or click it, to inspect it. NPCs, creatures and carcasses remain markers; lighting and animation are not simulated.";
    artStatus.classList.toggle("error", problems.length > 0);
  };
  st.cleanup = st.terrain.subscribe(updateArt);
  $("#app").replaceChildren(
    h(
      "section",
      { id: "world" },
      summary,
      freshness,
      modeControl,
      grid,
      st.prefs.realistic ? artStatus : null,
      landmarkList(st),
      h(
        "details",
        { class: "inventory-panel", "data-remember": "player", open: st.expanded?.has("player") },
        h("summary", {}, "Saved equipment & inventory"),
        coinRollup(p.inventory),
        inventoryView(p.inventory, "player", st.expanded),
      ),
      warn,
    ),
    h("section", { id: "zone", "aria-live": "polite" }),
  );
  updateArt();
  const [x, y] = st.selected ?? you.zone;
  const interior = w.interiors.find((it) => it.dir === st.interiorDir);
  if (interior) {
    document.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`)?.classList.add("sel");
    renderInterior(st, w.zones[y][x], interior, INTERIOR_NAMES[interior.kind ?? -1] ?? "Interior");
  } else selectZone(st, x, y, true);
}

/** Switches Realistic mode (the world section's chip and the map legend), keeping the view. */
function setRealistic(st: State, on: boolean) {
  rememberView(st);
  st.prefs.realistic = on;
  if (!on) {
    st.terrain.dispose();
    st.terrain = new TerrainStore(st.world);
  }
  renderWorld(st);
}

function cell(st: State, z: Zone, you: Spot) {
  const url = st.mapUrls.get(key(z.x, z.y));
  const sh = shores(st.world, z.x, z.y);
  const thumb = st.prefs.realistic && z.dir
    ? h("canvas", { width: 160, height: 160, "data-zone": z.y * 5 + z.x, "aria-label": "Saved game terrain" })
    : url && !st.prefs.realistic
    ? h("img", { src: url, alt: "", draggable: "false" })
    : h(
      "div",
      { class: "blank" },
      sh.all ? null : h("div", {
        class: "land",
        style: `top:${sh.n ? 14 : 0}%;bottom:${sh.s ? 14 : 0}%;left:${sh.w ? 14 : 0}%;right:${sh.e ? 14 : 0}%`,
      }),
    );
  const pills: HTMLElement[] = [];
  const dots: HTMLElement[] = [];
  for (const m of st.marks) {
    if (m.status === "found" && m.zone?.[0] === z.x && m.zone[1] === z.y) {
      pills.push(h("span", { class: `pill found m-${m.id}` }, m.name));
      if (m.solid) {
        const tp = m.solid.transPoint;
        const [dx, dy] = tp && tp.length >= 3 ? [tp[1], tp[2]] : [m.solid.x, m.solid.y];
        dots.push(h("span", { class: `dot m-${m.id}`, style: `left:${dx / ROOM * 100}%;top:${dy / ROOM * 100}%` }));
      }
    } else if (m.status === "zone" && m.zone?.[0] === z.x && m.zone[1] === z.y) {
      pills.push(h("span", { class: `pill zone m-${m.id}`, title: m.note }, m.name));
      if (!z.explored) {
        const heat = zoneHeat(st.world, [m], z)[0];
        const b = heat && heatBounds(heat.heat);
        if (b) {
          dots.push(h("span", {
            class: `region m-${m.id}`,
            style: `left:${b[0] / ROOM * 100}%;top:${b[1] / ROOM * 100}%;width:${(b[2] - b[0]) / ROOM * 100}%;height:${
              (b[3] - b[1]) / ROOM * 100
            }%`,
          }));
        }
      }
    } else if (m.status === "candidates") {
      const c = m.candidates?.find((c) => c.x === z.x && c.y === z.y && c.share > 0);
      if (c) pills.push(h("span", { class: `pill maybe m-${m.id}`, title: m.note }, `${m.name} ${pct(c.share)}`));
    }
  }
  const isHere = you.zone[0] === z.x && you.zone[1] === z.y;
  if (isHere) {
    dots.push(
      h("span", { class: "you-dot", title: you.title, style: `left:${you.x / ROOM * 100}%;top:${you.y / ROOM * 100}%` }, personSvg()),
    );
  }
  return h(
    "button",
    {
      type: "button",
      class: `cell${z.explored ? " explored" : ""}${isHere ? " here" : ""}`,
      "data-x": z.x,
      "data-y": z.y,
      "aria-label": `${coordLabel(z.x, z.y)} ${z.name}${z.explored ? "" : ", not explored"}`,
      onclick: () => selectZone(st, z.x, z.y),
    },
    h("div", { class: "thumb" }, thumb, dots),
    h("div", { class: "pills" }, pills),
    h("div", { class: "label" }, h("b", {}, coordLabel(z.x, z.y)), " ", z.name),
  );
}

function where(st: State, x: number, y: number, text?: string) {
  return h("button", { type: "button", class: "where", onclick: () => selectZone(st, x, y) }, text ?? coordLabel(x, y));
}

function landmarkList(st: State) {
  const items = st.marks.map((m) => {
    let loc: (HTMLElement | string)[] = [];
    if ((m.status === "found" || m.status === "zone") && m.zone) {
      const pending = m.status === "zone" && !st.world.zones[m.zone[1]][m.zone[0]].explored;
      loc = [where(st, m.zone[0], m.zone[1]), pending ? h("span", { class: "muted" }, " exact spot not generated yet") : ""];
    } else if (m.status === "candidates") {
      loc = (m.candidates ?? [])
        .filter((c) => c.share > 0)
        .sort((a, b) => b.share - a.share)
        .flatMap((c, i) => [i ? " · " : "", where(st, c.x, c.y, `${coordLabel(c.x, c.y)} ${pct(c.share)}`)]);
    } else loc = [h("span", { class: "muted" }, "—")];
    return h(
      "li",
      { class: `${m.status} m-${m.id}` },
      h("span", { class: "sw" }),
      h("span", { class: "who" }, m.name),
      h("span", { class: "loc" }, loc),
      h("span", { class: "note" }, m.note),
    );
  });
  return h("div", { class: "landmarks" }, h("h2", {}, "Landmarks"), h("ul", {}, items));
}

export function selectZone(st: State, x: number, y: number, restore = false) {
  if (!restore) {
    st.viewport = undefined;
    st.inspected = undefined;
  }
  st.interiorDir = undefined;
  st.selected = [x, y];
  markCell(x, y);
  renderZone(st, st.world.zones[y][x]);
}

function markCell(x: number, y: number) {
  document.querySelectorAll(".cell.sel").forEach((c) => c.classList.remove("sel"));
  document.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`)?.classList.add("sel");
}

function zoneHeader(z: Zone) {
  const visit = z.lastVisit ? `last here on day ${Math.floor(z.lastVisit[0])}` : z.explored ? "explored" : "not explored yet";
  return h(
    "header",
    {},
    h("h2", {}, h("span", { class: "coord" }, coordLabel(z.x, z.y)), " ", wikiTitle(entityWiki(z.name), z.name)),
    h("span", { class: "muted" }, visit),
  );
}

/**
 * Lets the zone map pan into its neighbours. While the view moves, the zone it is about (`focusZone`) is previewed at
 * once in the grid, the title and the map's outline; its details open in place only when the view comes to rest, so a
 * pan across several zones loads just the last one and never interrupts the gesture.
 */
function zoneFollower(st: State, z: Zone, outline: SVGElement) {
  let focus: [number, number] = [z.x, z.y], committed = focus;
  return {
    view(view: [number, number, number]) {
      const next = focusZone(view, [z.x, z.y], focus);
      if (next === focus) return;
      focus = next;
      const n = st.world.zones[focus[1]][focus[0]];
      markCell(n.x, n.y);
      $("#zone > header")?.replaceWith(zoneHeader(n));
      outline.setAttribute("x", String((n.x - z.x) * ROOM));
      outline.setAttribute("y", String((n.y - z.y) * ROOM));
    },
    settle() {
      if (focus[0] === committed[0] && focus[1] === committed[1]) return;
      committed = focus;
      renderZone(st, st.world.zones[focus[1]][focus[0]], true);
    },
  };
}

/** Every zone's own map (or its water and land sketch) and the zone borders, laid out around z. */
function worldBase(st: State, z: Zone): SVGElement[] {
  const zones = st.world.zones.flat().map((n) => {
    const url = st.mapUrls.get(key(n.x, n.y));
    return s(
      "g",
      { transform: `translate(${(n.x - z.x) * ROOM} ${(n.y - z.y) * ROOM})` },
      url
        ? s("image", { href: url, x: 0, y: 0, width: ROOM, height: ROOM, class: "b-map", preserveAspectRatio: "none" })
        : blankBase(st.world, n),
    );
  });
  const lines = Array.from(
    { length: 6 },
    (_, i) => `M${-z.x * ROOM} ${(i - z.y) * ROOM}h${5 * ROOM}M${(i - z.x) * ROOM} ${-z.y * ROOM}v${5 * ROOM}`,
  ).join("");
  return [...zones, s("path", { class: "zone-edges", d: lines })];
}

function blankBase(world: World, z: Zone): SVGElement[] {
  const sh = shores(world, z.x, z.y);
  const inset = ROOM * 0.12;
  const out: SVGElement[] = [s("rect", { class: "b-water", x: 0, y: 0, width: ROOM, height: ROOM })];
  if (!sh.all) {
    const l = sh.w ? inset : 0, t = sh.n ? inset : 0, r = sh.e ? inset : 0, b = sh.s ? inset : 0;
    out.push(s("rect", { class: "b-land", x: l, y: t, width: ROOM - l - r, height: ROOM - t - b }));
  }
  return out;
}

function heatUrl(heat: Float32Array, color: string) {
  let max = 0, support = 0;
  for (const v of heat) {
    if (v > max) max = v;
    if (v > 0) support++;
  }
  // Few candidate tiles: paint them boldly. A zone-wide spread: a light wash, so the map stays readable.
  const top = Math.min(235, Math.max(55, 235 * Math.sqrt(1200 / Math.max(support, 1))));
  const [r, g, b] = hex(color);
  return tileImage((img) => {
    for (let i = 0; i < heat.length; i++) {
      if (heat[i] <= 0) continue;
      img.data.set([r, g, b, Math.round(top * (0.45 + 0.55 * Math.sqrt(heat[i] / max)))], i * 4);
    }
  });
}

async function waterUrl(world: World, dir: string): Promise<string | null> {
  const w1 = await loadLayer(world, dir, "Water1");
  if (!w1) return null;
  const y = await loadHeights(world, dir);
  return tileImage((img) => {
    for (let i = 0; i < TILES * TILES; i++) {
      if (tileIndex(w1.data[i]) <= 0) continue;
      const deep = y ? y.data[i] < Thresh.water : false;
      img.data.set(deep ? [40, 110, 200, 200] : [110, 180, 235, 170], i * 4);
    }
  });
}

interface Inside {
  interior: Interior;
  detail: ZoneDetail;
}

function insideSummary(d: ZoneDetail): string {
  const count = new Map<string, number>();
  for (const b of d.beings) {
    if (b.state !== 1 && NPC_BEINGS.has(b.index)) count.set(BEING_NAMES[b.index], (count.get(BEING_NAMES[b.index]) ?? 0) + 1);
  }
  const parts = [...count].sort((a, b) => a[1] - b[1]).map(([n, c]) => (c > 1 ? `${n} ×${c}` : n));
  const foes = d.beings.filter((b) => b.state !== 1 && !NPC_BEINGS.has(b.index)).length;
  const loot = d.containers.filter((c) => c.status === -214).length;
  if (foes) parts.push(`${foes} creature${foes > 1 ? "s" : ""}`);
  if (loot) parts.push(`${loot} unsearched`);
  return parts.length ? parts.join(", ") : "nothing left";
}

/**
 * Shows zone z. With `glide` (panning into it from the current zone map) the map stays on screen until the new one is
 * built, and the new one takes over the same view, inspection and open sections, so the move is seamless.
 */
async function renderZone(st: State, z: Zone, glide = false) {
  const my = ++token;
  const world = st.world;
  st.interiorDir = undefined;
  const panel = $("#zone");
  const header = zoneHeader(z);
  const gliding = glide && !!activeMap && !!activeZone;
  if (gliding) $("#zone > header")?.replaceWith(header);
  else {
    activeMap?.dispose();
    activeMap = activeZone = undefined;
    panel.replaceChildren(header, h("p", { class: "muted loading" }, "Loading…"));
  }

  const detail = z.dir ? await loadDetail(world, z.dir) : null;
  const inners = interiorsOf(world, z.x, z.y);
  const insides: Inside[] = [];
  for (const it of inners) insides.push({ interior: it, detail: await loadDetail(world, it.dir) });
  const candidateHere = (id: LandmarkId) =>
    st.marks.some((m) => m.id === id && m.status === "candidates" && m.candidates?.some((c) => c.x === z.x && c.y === z.y));
  const standingHere = world.player.area.x === z.x && world.player.area.y === z.y;
  const tiles = {
    ...(z.dir && candidateHere("ihar")
      ? { water1: (await loadLayer(world, z.dir, "Water1"))?.data, lower: (await loadLayer(world, z.dir, "Lower"))?.data }
      : {}),
    ...(z.dir && candidateHere("gurb") && standingHere ? { trees: await loadTrees(world, z.dir) } : {}),
  };
  if (my !== token) return;
  if (gliding) {
    // Swapping maps under a finger would drop the gesture, so a still-held map is replaced once it is let go.
    await activeMap!.released();
    if (my !== token) return;
    const [dx, dy] = [(activeZone![0] - z.x) * ROOM, (activeZone![1] - z.y) * ROOM];
    rememberView(st);
    const [vx, vy, vw] = st.viewport!;
    st.viewport = [vx + dx, vy + dy, vw];
    const open = activeMap!.selection;
    st.inspected = open ? markKey({ ...open, x: open.x + dx, y: open.y + dy }) : undefined;
    st.selected = [z.x, z.y];
    markCell(z.x, z.y);
    activeMap!.dispose();
  }

  const marks: Mark[] = [...solidMarks(z.solids, inners), ...sealedMarks(inners), ...(detail ? detailMarks(detail) : [])];
  for (const m of marks) {
    const inside = m.interior && insides.find((i) => i.interior === m.interior);
    if (inside) m.detail = `${m.detail === "entrance is gone" ? "entrance is gone; " : ""}inside: ${insideSummary(inside.detail)}`;
  }
  const heats = zoneHeat(world, st.marks, z, { ...tiles, beings: detail?.beings });
  const you = playerSpot(st);
  const [youOx, youOy] = [(you.zone[0] - z.x) * ROOM, (you.zone[1] - z.y) * ROOM];
  const youAway = youOx || youOy ? { zone: world.zones[you.zone[1]][you.zone[0]].name, ox: youOx, oy: youOy } : undefined;
  const inspector = h("section", { class: "inspection", hidden: true, "aria-live": "polite" });
  const picker = () => toolPicker(st, () => chips);
  const close = () => closeInspection(st, map, inspector);
  const inspect = (m: Mark, expanded?: Set<string>) => {
    map.select(m);
    inspectMark(inspector, m, { expanded, tool: chopTool(st), picker: picker(), close, difficulty: world.player.difficulty });
  };
  const openInterior = (m: Mark) => {
    if (m.interior) {
      st.viewport = undefined;
      st.inspected = undefined;
      const at = around.zoneOf.get(m) ?? z;
      st.selected = [at.x, at.y];
      markCell(at.x, at.y);
      renderInterior(st, at, m.interior, m.name);
    } else {
      st.inspected = markKey(m);
      inspect(m);
    }
  };
  // Both modes span the world: the zone sits at the origin, its neighbours around it.
  const outline = s("rect", { class: "zone-focus", x: 0, y: 0, width: ROOM, height: ROOM });
  const follow = zoneFollower(st, z, outline);
  const map = new MapView({
    base: [...(st.prefs.realistic ? [] : worldBase(st, z)), outline],
    raster: st.prefs.realistic ? new TerrainRaster(st.terrain, worldScenes(world, z.x, z.y)) : undefined,
    bounds: [-z.x * ROOM, -z.y * ROOM, 5 * ROOM],
    onMapClick: (px: number, py: number) => {
      const x = z.x + Math.floor(px / ROOM), y = z.y + Math.floor(py / ROOM);
      if (x >= 0 && x < 5 && y >= 0 && y < 5 && (x !== z.x || y !== z.y)) selectZone(st, x, y);
    },
    marks,
    heats: heats.map((ht) => ({ cls: `m-${ht.id}`, url: heatUrl(ht.heat, HEAT_COLOR[ht.id]), bounds: heatBounds(ht.heat) })),
    // The map spans the world, so the player shows even from a neighbouring zone.
    player: youMark(st, you, you.x + youOx, you.y + youOy, youLabel(st, you, you.inside), youAway),
    onOpen: openInterior,
    onView: (view) => {
      around.refresh();
      follow.view(view);
    },
    onSettle: follow.settle,
    popup: { card: inspector, close },
  });
  activeMap = map;
  activeZone = [z.x, z.y];
  const around = neighbourMarks(st, map, z, () => my === token, (added) => restoreInspection(added));
  if (st.viewport) map.restore(st.viewport);
  // At once rather than debounced, so neighbours already on screen do not blink when gliding in.
  around.load();
  const restoreInspection = (available: Mark[]) => {
    const inspected = available.find((m) => markKey(m) === st.inspected);
    if (inspected) inspect(inspected, st.expanded);
  };
  // The player only on this first pass: neighbours' batches arrive later and must not rebuild an open card of them.
  restoreInspection(map.you ? [...marks, map.you] : marks);
  const treeList = h("div", { class: "lists" });
  const layers = mapLayers(st, map, z.dir, () => my === token, false, (plants) => {
    const open = plants.find((m) => markKey(m) === st.inspected);
    // Re-rendering for a new tool keeps the inspection's open sections.
    if (open) inspect(open, inspector.hidden ? st.expanded : openSections(inspector));
    const keep = treeKeep(st.prefs.treeMin);
    const shown = plants.filter((m) => m.layer === "trees" && (!keep || keep(m))).sort((a, b) => treeLife(a) - treeLife(b));
    const wasOpen = treeList.querySelector("details")?.open;
    treeList.replaceChildren(markGroup(st, map, openInterior, "Trees, deadest first", shown, false) ?? "");
    const list = treeList.querySelector("details");
    if (list && wasOpen !== undefined) list.open = wasOpen;
  });
  const chips = layerChips(st, layers);
  map.el.append(mapLegend(st, layers));

  const retool = () => {
    around.refresh(true);
    const open = around.trees.find((m) => markKey(m) === st.inspected);
    if (open && !inspector.hidden) inspect(open, openSections(inspector));
  };
  chips.addEventListener("retool", retool);
  layers.listen(() => around.refresh());

  const shading = heats.length
    ? h(
      "p",
      { class: "legend" },
      "Shaded: where the entrance can still appear — ",
      heats.map((ht, i) => {
        const m = st.marks.find((m) => m.id === ht.id)!;
        const c = m.candidates?.find((c) => c.x === z.x && c.y === z.y);
        const perVisit = c && c.entry < 1 ? `, ${c.estimated ? "about " : ""}${pct(c.entry)} per visit` : "";
        const odds = c ? ` (${pct(c.share)} it ends up here${perVisit})` : "";
        return [i ? "; " : "", h("span", { class: `sw m-${ht.id}` }), `${m.name}${odds}: ${ht.basis}`];
      }),
      ".",
    )
    : !z.explored
    ? h("p", { class: "legend" }, "The game generates this zone when you first enter it.")
    : null;

  const lists = poiLists(st, marks, map, openInterior);
  panel.replaceChildren(
    ...[header, map.el, chips, shading, inspector, lists, treeList, areaWarnings(world)].filter((n): n is HTMLElement => !!n),
  );
}

/** The inspection's open sections, to keep them when it is drawn again. */
const openSections = (root: ParentNode) =>
  new Set(Array.from(root.querySelectorAll<HTMLDetailsElement>("details[data-remember][open]")).map((el) => el.dataset.remember!));

/** Closes the inspection: the full-screen card's ×, Escape, or a tap on the empty map there. */
function closeInspection(st: State, map: MapView, inspector: HTMLElement) {
  st.inspected = undefined;
  map.select(null);
  inspector.hidden = true;
}

/** Other zones' markers, loaded once each zone first scrolls into view (trees only while shown). */
function neighbourMarks(st: State, map: MapView, z: Zone, current: () => boolean, onAdd: (marks: Mark[]) => void) {
  const world = st.world;
  const loaded = new Set<string>(), treesLoaded = new Set<string>();
  const zoneOf = new Map<Mark, Zone>();
  const trees: Mark[] = [];
  const add = (n: Zone, marks: Mark[]) => {
    if (!current()) return;
    const ox = (n.x - z.x) * ROOM, oy = (n.y - z.y) * ROOM;
    for (const m of marks) {
      m.x += ox;
      m.y += oy;
      if (m.box) m.box = [m.box[0] + ox, m.box[1] + oy, m.box[2] + ox, m.box[3] + oy];
      m.away = { zone: n.name, ox, oy };
      zoneOf.set(m, n);
    }
    map.addMarks(marks);
    onAdd(marks);
  };
  const load = () => {
    if (!current()) return;
    const plants = [...PLANT_LAYERS].some((l) => st.prefs.layers.has(l));
    for (const [x, y] of zonesInView(map.visible, [z.x, z.y])) {
      const n = world.zones[y][x], k = key(x, y);
      if (!loaded.has(k)) {
        loaded.add(k);
        const inners = interiorsOf(world, x, y);
        (n.dir ? loadDetail(world, n.dir) : Promise.resolve(null)).then((detail) =>
          add(n, [...solidMarks(n.solids, inners), ...sealedMarks(inners), ...(detail ? detailMarks(detail) : [])])
        );
      }
      if (plants && n.dir && !treesLoaded.has(k)) {
        treesLoaded.add(k);
        loadTrees(world, n.dir).then((saved) => {
          const t = treeMarks(saved, chopTool(st));
          trees.push(...t);
          add(n, [...t, ...brambleMarks(saved)]);
        });
      }
    }
  };
  let timer = 0;
  return {
    zoneOf,
    trees,
    load() {
      clearTimeout(timer);
      load();
    },
    /** Debounced; settings also refreshes neighbour tree costs after the chopping tool changes. */
    refresh(settings = false) {
      if (settings) { for (const m of trees) m.detail = treeDetail(m.tree!, chopTool(st)); }
      clearTimeout(timer);
      timer = setTimeout(load, 120);
    },
  };
}

/** A map layer, or the water overlay (a separate pref, switched with the Terrain layers). */
type Switch = Layer | "water";

/** Switches by category: the chips' tri-state headers and the legend's group titles. */
const LAYER_GROUPS: [string, Switch[]][] = [
  ["Locations", ["places", "caves", "ruins", "rifts"]],
  ["Entities", ["you", "npcs", "creatures"]],
  ["Items", ["loot", "drops", "camp", "storage"]],
  ["Terrain", ["boulders", "rubble", "rocks", "sharp", "water"]],
  ["Nature", ["trees", "brambles", "vines"]],
];

/** Layers drawn from saved plants (lazy `loadTrees`), and the NatureData tile each thorny layer shades. */
const PLANT_LAYERS = new Set<Layer>(["trees", "brambles", "vines"]);
const THORN_TILES: [Layer, number][] = [["brambles", 1], ["sharp", 2], ["vines", 3]];
const OUTDOOR_ONLY = new Set<Layer>(["trees", "brambles", "vines", "sharp", "boulders", "rubble"]);

const switchLabel = (id: Switch) => id === "water" ? "Water" : LAYERS.find((l) => l.id === id)!.label;
const switchDefault = (id: Switch) => id !== "water" && LAYERS.find((l) => l.id === id)!.on;

/** The world grid's person follows the You layer too. */
function showLayers(st: State, map: MapView, all: Layer[]) {
  map.setLayers(st.prefs.layers, all);
  document.body.classList.toggle("hide-you", !st.prefs.layers.has("you"));
}

/** A map's switches, kept in `st.prefs`. The chips under the map and the legend on it are two views of one `Layers`. */
interface Layers {
  /** What this map offers, in LAYERS order; water only outdoors. */
  ids: Switch[];
  /** An outdoor zone: trees, thorny ground and water can be shown. */
  outdoor: boolean;
  on(id: Switch): boolean;
  set(id: Switch, on: boolean): void;
  /** Calls `f` after every change. */
  listen(f: () => void): void;
  /** Shows trees, only those whose trunk is at least this dead (see TRUNK_FILTERS). */
  trunks(min: number): void;
  /** The chopping tool changed: tree costs follow. */
  retool(): void;
}

/** Switches every one of `ids` on, or all off when they already are. */
function toggleAll(layers: Layers, ids: Switch[]) {
  const on = !ids.every((id) => layers.on(id));
  for (const id of ids) layers.set(id, on);
}

/** The switches of a map. Trees and water load lazily, and only for outdoor zones (`dir` given). */
function mapLayers(
  st: State,
  map: MapView,
  dir: string | undefined,
  current: () => boolean,
  indoor = false,
  onPlants?: (plants: Mark[]) => void,
): Layers {
  const all = LAYERS.map((l) => l.id);
  showLayers(st, map, all);
  map.setFilter(treeKeep(st.prefs.treeMin));
  const outdoor = !!dir && !indoor;
  const listeners: (() => void)[] = [];
  let treesLoaded = false;
  let trees: Mark[] = [];
  let brambles: Mark[] = [];
  const treesChanged = () => {
    if (current() && treesLoaded) onPlants?.([...trees, ...brambles]);
  };
  const loadTreesOnce = async () => {
    if (treesLoaded || !dir) return;
    treesLoaded = true;
    const saved = await loadTrees(st.world, dir);
    if (current()) {
      trees = treeMarks(saved, chopTool(st));
      brambles = brambleMarks(saved);
      map.addMarks([...trees, ...brambles]);
      treesChanged();
    }
  };
  let thornsRequest = 0;
  const setThorns = async () => {
    const request = ++thornsRequest;
    const tiles = THORN_TILES.filter(([l]) => st.prefs.layers.has(l)).map(([, t]) => t);
    const url = dir && tiles.length ? await thornsUrl(st.world, dir, tiles) : null;
    if (current() && request === thornsRequest) map.setOverlay("thorns", url);
  };
  const setWater = async () => {
    const url = st.prefs.water && dir ? await waterUrl(st.world, dir) : null;
    if (current()) map.setOverlay("water", url);
  };
  if (outdoor) {
    if ([...PLANT_LAYERS].some((l) => st.prefs.layers.has(l))) loadTreesOnce();
    setThorns();
    if (st.prefs.water) setWater();
  }
  const on = (id: Switch) => id === "water" ? st.prefs.water : st.prefs.layers.has(id);
  const set = (id: Switch, show: boolean) => {
    if (on(id) === show) return;
    if (id === "water") {
      st.prefs.water = show;
      setWater();
    } else {
      if (show) st.prefs.layers.add(id);
      else st.prefs.layers.delete(id);
      if (PLANT_LAYERS.has(id) && show) loadTreesOnce();
      if (THORN_TILES.some(([t]) => t === id)) setThorns();
      showLayers(st, map, all);
    }
    for (const f of listeners) f();
  };
  return {
    ids: [...all.filter((id) => !indoor || !OUTDOOR_ONLY.has(id)), ...(outdoor ? ["water" as const] : [])],
    outdoor,
    on,
    set,
    listen: (f) => listeners.push(f),
    trunks(min) {
      st.prefs.treeMin = min;
      map.setFilter(treeKeep(min));
      set("trees", true);
      treesChanged();
    },
    retool() {
      for (const m of trees) m.detail = treeDetail(m.tree!, chopTool(st));
      treesChanged();
    },
  };
}

/** Layer checkboxes under the map, grouped by category, each group with a tri-state header. */
function layerChips(st: State, layers: Layers) {
  const chips = h("div", { class: "layers" });
  const boxes = new Map<Switch, HTMLInputElement>();
  const chip = (id: Switch) => {
    const box = h("input", { type: "checkbox" }) as HTMLInputElement;
    box.addEventListener("change", () => layers.set(id, box.checked));
    boxes.set(id, box);
    return h("label", { class: id === "water" ? "chip water" : `chip L-${id}`, title: LAYER_TIPS[id] }, box, switchLabel(id));
  };
  const headers: [HTMLInputElement, Switch[]][] = [];
  const header = (label: string, ids: Switch[]) => {
    const box = h("input", { type: "checkbox" }) as HTMLInputElement;
    box.addEventListener("change", () => toggleAll(layers, ids));
    headers.push([box, ids]);
    return h("label", { class: "chip group" }, box, label);
  };
  const sync = () => {
    for (const [id, box] of boxes) box.checked = layers.on(id);
    for (const [box, ids] of headers) {
      const n = ids.filter((id) => layers.on(id)).length;
      box.checked = n === ids.length;
      box.indeterminate = n > 0 && n < ids.length;
    }
  };
  const reset = h("button", { type: "button", class: "chip reset" }, "Reset to defaults");
  reset.addEventListener("click", () => {
    for (const id of layers.ids) layers.set(id, switchDefault(id));
  });
  chips.append(h("div", { class: "layer-group" }, header("All", layers.ids), reset));
  for (const [label, ids] of LAYER_GROUPS) {
    const here = ids.filter((id) => layers.ids.includes(id));
    if (here.length) chips.append(h("div", { class: "layer-group" }, header(label, here), here.map(chip)));
  }
  layers.listen(sync);
  sync();
  if (layers.outdoor) {
    const trunks = h(
      "select",
      { "aria-label": "Show trees by trunk liveliness" },
      TRUNK_FILTERS.map(([min, label]) => h("option", { value: min, selected: min === st.prefs.treeMin }, label)),
    ) as HTMLSelectElement;
    trunks.addEventListener("change", () => layers.trunks(Number(trunks.value)));
    chips.append(h("label", { class: "chip L-trees" }, "Trunks", trunks));

    // The tree inspection's tool picker (see `toolPicker`) signals a new tool here.
    chips.addEventListener("retool", () => layers.retool());
  }
  return chips;
}

/** The map symbol each switch's legend entry shows (a `markIcon` kind). */
const SWITCH_ICON: Record<Switch, string> = {
  places: "landmark",
  caves: "entrance",
  ruins: "entrance",
  rifts: "rift",
  exits: "exit",
  you: "you",
  npcs: "npc",
  creatures: "creature",
  loot: "loot",
  drops: "drop",
  camp: "camp",
  storage: "storage",
  boulders: "boulder",
  rubble: "ruin",
  rocks: "rock",
  sharp: "sharp",
  water: "water",
  trees: "tree willow",
  brambles: "bramble",
  vines: "bramble vine",
};

/**
 * The legend floating on a large or full-screen map (style.css decides when it shows): each switch's map symbol, tapped
 * to show or hide it, group titles to switch a whole group, and Realistic mode. It collapses to its title.
 */
function mapLegend(st: State, layers: Layers): HTMLElement {
  const keys = new Map<Switch, HTMLElement>();
  const key = (id: Switch) => {
    const el = h(
      "button",
      { type: "button", class: "key", title: LAYER_TIPS[id], onclick: () => layers.set(id, !layers.on(id)) },
      markIcon(SWITCH_ICON[id]),
      h("span", {}, switchLabel(id)),
    );
    keys.set(id, el);
    return el;
  };
  const groups = LAYER_GROUPS.map(([label, ids]) => {
    const here = ids.filter((id) => layers.ids.includes(id));
    if (!here.length) return null;
    return h(
      "div",
      { class: "key-group", role: "group", "aria-label": label },
      h(
        "button",
        { type: "button", class: "key-title", title: `Show or hide all ${label}`, onclick: () => toggleAll(layers, here) },
        label,
      ),
      here.map(key),
    );
  });
  const sync = () => {
    for (const [id, el] of keys) el.setAttribute("aria-pressed", String(layers.on(id)));
  };
  layers.listen(sync);
  sync();
  const realistic = h(
    "button",
    {
      type: "button",
      class: "key",
      "aria-pressed": String(st.prefs.realistic),
      title: "Game terrain and saved scenery instead of the game's own maps",
      onclick: () => setRealistic(st, !st.prefs.realistic),
    },
    h("span", { class: "switch", "aria-hidden": "true" }),
    h("span", {}, "Realistic"),
  );
  const open = st.prefs.legend ?? matchMedia("(min-width: 720px) and (min-height: 560px)").matches;
  const legend = h("div", { class: `map-legend${open ? " open" : ""}`, role: "group", "aria-label": "Map legend" });
  const toggle = h(
    "button",
    { type: "button", class: "key-toggle", "aria-expanded": String(open), title: "Show or hide the legend" },
    s(
      "svg",
      { class: "sym-icon", viewBox: "0 0 16 16", "aria-hidden": "true" },
      s("path", { d: "M8 2.5 14 5.5 8 8.5 2 5.5ZM2 8.5l6 3 6-3M2 11.5l6 3 6-3" }),
    ),
    "Legend",
  );
  toggle.addEventListener("click", () => {
    st.prefs.legend = legend.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(st.prefs.legend));
  });
  legend.append(toggle, h("div", { class: "key-body" }, groups, h("div", { class: "key-group settings" }, realistic)));
  return legend;
}

/** "Chop with" select for the tree inspection; changing it dispatches "retool" on `target`. */
function toolPicker(st: State, target: () => Element | undefined): HTMLElement {
  const owned = ownedTools(st.world.player.inventory);
  const tools = Object.keys(CHOP_TOOLS).map(Number).sort((a, b) => CHOP_TOOLS[b] - CHOP_TOOLS[a] || a - b);
  const tool = h(
    "select",
    { "aria-label": "Chopping tool for harvest costs" },
    tools.map((t) =>
      h(
        "option",
        { value: t, selected: t === chopTool(st) },
        `${ITEM_NAMES[t] ?? `Item ${t}`} ×${CHOP_TOOLS[t]}${owned.includes(t) && t !== UNARMED ? " (carried)" : ""}`,
      )
    ),
  ) as HTMLSelectElement;
  tool.addEventListener("change", () => {
    st.prefs.chopTool = { tool: Number(tool.value), owned: owned.join() };
    target()?.dispatchEvent(new Event("retool"));
  });
  return h("label", { class: "chop-with" }, "Chop with ", tool);
}

const LAYER_TIPS: Partial<Record<Switch, string>> = {
  places: "Named landmarks such as Fort Solid, Camp, the Library and NPC homes, and their entrances",
  caves: "Cave entrances",
  ruins: "Ruin and ruin cellar entrances",
  rifts: "Rifts and the entrances to the rift depths",
  drops: "Items lying on the ground: ones you dropped, wood from felled trees, and separately saved ground loot",
  camp: "Workstations and other camp items you have placed",
  storage:
    "Places to keep items: treasure chests (they stay after looting), Hidden Hollows, the Camp stash, and Clay's and Bhato's storage",
  trees: "Willow, Cypress, Trollgnarl and Elderwort, coloured by how dead the trunk is",
  boulders: "Boulders and large boulders",
  rubble: "Ruin footprints and blocks that cannot be entered",
  brambles: "Brambles and the ground they cover: each step there costs more AP and scratches you",
  vines: "Rift Vines and the ground they cover: slower to cross than brambles, and they scratch you",
  sharp: "Sharp ground, such as the ring around Fort Solid's clearing: the worst footing of the three, making each step cost more AP",
};

/** Saved NatureData tiles that hinder walking (1 brambles, 3 rift vine, 2 sharp ground); only `tiles` are painted. */
async function thornsUrl(world: World, dir: string, tiles: number[]): Promise<string | null> {
  const nd = await loadLayer(world, dir, "NatureData");
  if (!nd) return null;
  const colour: Record<number, number[]> = { 1: [160, 110, 60, 170], 3: [235, 110, 170, 160], 2: [220, 220, 210, 170] };
  return tileImage((img) => {
    for (let i = 0; i < TILES * TILES; i++) {
      const t = tileIndex(nd.data[i]);
      const c = tiles.includes(t) ? colour[t] : undefined;
      if (c) img.data.set(c, i * 4);
    }
  });
}

const TRUNK_FILTERS: [number, string][] = [
  [0, "All"],
  [2, "Half Dead or drier"],
  [3, "Mostly Dead or drier"],
  [4, "Dead only"],
];

/** The tool chosen for harvest costs, else the best one the character carries. */
const chopTool = (st: State) => chosenTool(ownedTools(st.world.player.inventory), st.prefs.chopTool);

const treeLife = (m: Mark) => (m.tree && trunkOf(m.tree)?.life) ?? 2;

/** Map filter for the trunk liveliness select: trees whose trunk is at least this dead. */
const treeKeep = (min: number) =>
  min > 0 ? (m: Mark) => m.layer !== "trees" || (m.tree ? (trunkOf(m.tree)?.freshness ?? -1) : -1) >= min : null;

function areaWarnings(world: World) {
  return world.warnings.length ? h("p", { class: "warnings" }, world.warnings.join(" · ")) : null;
}

function markGroup(st: State, map: MapView, open: (m: Mark) => void, title: string, ms: Mark[], openByDefault = true) {
  if (!ms.length) return null;
  const rows = ms.map((m) =>
    h(
      "li",
      {
        class: `L-${m.layer} ${m.kind}`,
        onmouseenter: () => map.highlight(m),
        onmouseleave: () => map.highlight(null),
      },
      m.layer === "trees" ? markIcon(m.kind) : h("span", { class: `sym ${m.kind}` }),
      m.interior ? h("button", { type: "button", class: "link", title: "Look inside", onclick: () => open(m) }, m.name) : h("button", {
        type: "button",
        class: "plain",
        title: "Show on map and inspect",
        onclick: () => {
          map.focus(m);
          open(m);
        },
      }, m.name),
      entityLink(m),
      m.detail ? h("span", { class: "muted" }, ` — ${m.detail}`) : "",
      m.inventory
        ? h(
          "span",
          { class: "muted" },
          m.inventory.state === "saved"
            ? ` - ${m.inventory.items.length ? `${m.inventory.items.length} saved stack(s)` : "empty when saved"}`
            : m.inventory.state === "unrolled"
            ? " - not rolled when saved"
            : " - contents unavailable",
        )
        : null,
    )
  );
  return h(
    "details",
    { "data-remember": title, open: st.expanded ? st.expanded.has(title) : openByDefault },
    h("summary", {}, `${title} (${ms.length})`),
    h("ul", {}, rows),
  );
}

const LOCATIONS = new Set<Layer>(["exits", "places", "caves", "ruins", "rifts"]);

function poiLists(st: State, marks: Mark[], map: MapView, open: (m: Mark) => void) {
  const group = (title: string, ms: Mark[], openByDefault = true) => markGroup(st, map, open, title, ms, openByDefault);
  const places = marks.filter((m) => LOCATIONS.has(m.layer) && m.kind !== "boat");
  places.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const npcs = marks.filter((m) => m.layer === "npcs");
  const loot = marks.filter((m) => m.layer === "loot");
  const drops = marks.filter((m) => m.layer === "drops");
  const camp = marks.filter((m) => m.layer === "camp");
  const storage = marks.filter((m) => m.layer === "storage");
  const creatures = marks.filter((m) => m.layer === "creatures");
  return h(
    "div",
    { class: "lists" },
    group("Places", places),
    group("NPCs", npcs),
    group("Loot", loot, loot.length <= 12),
    group("Dropped items", drops, drops.length <= 12),
    group("Camp", camp),
    group("Storage", storage),
    group("Creatures when saved", creatures, false),
  );
}

const rank = (m: Mark) => (m.kind === "landmark" ? 0 : m.kind.startsWith("entrance explored") ? 1 : m.kind.startsWith("entrance") ? 2 : 3);

async function renderInterior(st: State, z: Zone, it: Interior, name: string) {
  const my = ++token;
  activeMap?.dispose();
  activeZone = undefined;
  const world = st.world;
  st.interiorDir = it.dir;
  const panel = $("#zone");
  const [data, lower, onLower, water1] = await Promise.all(["Data", "Lower", "OnLower", "Water1"].map((l) => loadLayer(world, it.dir, l)));
  const detail = await loadDetail(world, it.dir);
  const visit = await lastVisit(world, it);
  if (my !== token) return;
  const deeper = world.interiors.filter((o) => o.parent === it);
  const marks: Mark[] = [...solidMarks(it.solids, deeper, it), ...detailMarks(detail)];

  let x0 = TILES, y0 = TILES, x1 = -1, y1 = -1;
  const grow = (tx: number, ty: number) => {
    x0 = Math.min(x0, tx), y0 = Math.min(y0, ty), x1 = Math.max(x1, tx), y1 = Math.max(y1, ty);
  };
  // Walkable area: everything not blocked (Data 1) that the exits, NPCs and loot connect to.
  const reach = data ? floodFloor(data.data, marks.map((m) => (m.y >> 4) * TILES + (m.x >> 4))) : null;
  const floor = (i: number) =>
    reach ? reach[i] === 1 : !!data && tileIndex(data.data[i]) !== 1 &&
      (tileIndex(lower?.data[i] ?? 0) > 0 || tileIndex(onLower?.data[i] ?? 0) > 0 || tileIndex(water1?.data[i] ?? 0) > 0);
  let floorCount = 0;
  for (let i = 0; i < TILES * TILES; i++) if (floor(i)) grow(i % TILES, (i / TILES) | 0), floorCount++;
  for (const m of marks) grow(m.x >> 4, m.y >> 4);
  if (x1 < 0) [x0, y0, x1, y1] = [60, 60, 100, 100];
  const size = Math.max(x1 - x0, y1 - y0) + 8;
  const view: [number, number, number] = [((x0 + x1) / 2 - size / 2) * 16, ((y0 + y1) / 2 - size / 2) * 16, size * 16];
  const url = tileImage((img) => {
    for (let i = 0; i < TILES * TILES; i++) {
      const d = data ? tileIndex(data.data[i]) : 0;
      if (tileIndex(water1?.data[i] ?? 0) > 0 && d !== 1) img.data.set([61, 79, 99, 255], i * 4);
      else if (d === 3) img.data.set([10, 7, 8, 255], i * 4);
      else if (floor(i)) img.data.set([206, 187, 174, 255], i * 4);
      else if (d === 1 && floorCount > 0) img.data.set([42, 31, 34, 255], i * 4);
    }
  });
  const kind = it.kind !== null ? INTERIOR_NAMES[it.kind] ?? name : name;
  const you = playerSpot(st);
  const inspector = h("section", { class: "inspection", hidden: true, "aria-live": "polite" });
  const close = () => closeInspection(st, map, inspector);
  const inspect = (m: Mark, expanded?: Set<string>) => {
    map.select(m);
    inspectMark(inspector, m, { expanded, close, difficulty: st.world.player.difficulty });
  };
  const open = (m: Mark) => {
    if (m.interior) {
      st.viewport = undefined;
      st.inspected = undefined;
      renderInterior(st, z, m.interior, m.name);
    } else {
      st.inspected = markKey(m);
      inspect(m);
    }
  };
  const map = new MapView({
    base: st.prefs.realistic
      ? []
      : [s("image", { href: url, x: 0, y: 0, width: ROOM, height: ROOM, class: "b-map", preserveAspectRatio: "none" })],
    raster: st.prefs.realistic
      ? new TerrainRaster(st.terrain, [{ dir: it.dir, kind: it.kind, solids: it.solids, x: 0, y: 0, label: kind }])
      : undefined,
    view,
    marks,
    heats: [],
    player: you.interior === it.dir && you.at ? youMark(st, you, you.at[0], you.at[1], youLabel(st, you, false)) : undefined,
    onOpen: open,
    popup: { card: inspector, close },
  });
  activeMap = map;
  if (st.viewport) map.restore(st.viewport);
  const inspected = [...marks, ...(map.you ? [map.you] : [])].find((m) => markKey(m) === st.inspected);
  if (inspected) inspect(inspected, st.expanded);
  const layers = mapLayers(st, map, undefined, () => my === token, true);
  map.el.append(mapLegend(st, layers));
  const up = it.parent;
  const back = h(
    "button",
    {
      type: "button",
      class: "link",
      onclick: () => {
        st.viewport = undefined;
        st.inspected = undefined;
        if (up) renderInterior(st, z, up, INTERIOR_NAMES[up.kind ?? -1] ?? "Interior");
        else renderZone(st, z);
      },
    },
    up ? `← back to ${INTERIOR_NAMES[up.kind ?? -1] ?? "the level above"}` : `← back to ${coordLabel(z.x, z.y)} ${z.name}`,
  );
  panel.replaceChildren(
    h("header", {}, h("h2", {}, kind), h("span", { class: "muted" }, `inside ${coordLabel(z.x, z.y)} ${z.name}${visit}`)),
    back,
    map.el,
    layerChips(st, layers),
    inspector,
    poiLists(st, marks, map, open),
    ...(world.warnings.length ? [areaWarnings(world)!] : []),
  );
}

/** Flood-fills unblocked tiles from the seeds; null when it leaks to the room edge (not an enclosed interior). */
function floodFloor(data: Uint32Array, seeds: number[]): Uint8Array | null {
  const seen = new Uint8Array(TILES * TILES);
  const open = (i: number) => i >= 0 && i < seen.length && !seen[i] && tileIndex(data[i]) !== 1;
  const stack: number[] = [];
  for (const s of seeds) {
    for (const i of [s, s - 1, s + 1, s - TILES, s + TILES]) {
      if (open(i)) (seen[i] = 1), stack.push(i);
    }
  }
  if (!stack.length) return null;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % TILES, y = (i / TILES) | 0;
    if (x === 0 || y === 0 || x === TILES - 1 || y === TILES - 1) return null;
    for (const j of [i - 1, i + 1, i - TILES, i + TILES]) if (open(j)) (seen[j] = 1), stack.push(j);
  }
  return seen;
}

async function lastVisit(world: World, it: Interior): Promise<string> {
  const src = world.files.get(`${it.dir}LastVisit.ini`);
  if (!src) return "";
  const text = new TextDecoder().decode(await src.read());
  const day = /Day\s*=\s*"?([\d.]+)/.exec(text);
  return day ? ` · last here on day ${Math.floor(Number(day[1]))}` : "";
}

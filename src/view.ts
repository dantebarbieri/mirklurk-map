// Page rendering: world grid, landmark list, zone and interior panels.

import { $, h, hex, s, tileImage } from "./dom.ts";
import { MapView, personSvg, treeIcon } from "./mapview.ts";
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
import { CHOP_TOOLS, ownedTools, trunkOf, UNARMED } from "./chop.ts";
import { heatBounds, type Landmark, type LandmarkId, pct, zoneHeat } from "./predict.ts";
import { Area, coordLabel, INTERIOR_NAMES, isOutside, NPC_BEINGS, ROOM, Thresh, tileIndex, TILES } from "./rules.ts";
import { BEING_NAMES, ITEM_NAMES } from "./gamedata.ts";
import { paintThumbnail, TerrainRaster, TerrainStore, worldScenes } from "./terrain.ts";
import { entityLink, inspectMark, inventoryView, wikiLink } from "./inspect.ts";
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
    /** Chopping tool item; undefined picks the best one the character carries. */
    chopTool?: number;
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

export function rememberView(st: State) {
  st.viewport = activeMap?.viewport;
  st.expanded = new Set(
    Array.from(document.querySelectorAll<HTMLDetailsElement>("details[data-remember][open]")).map((el) => el.dataset.remember!),
  );
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
    const [x, y] = e.interior ? e.interior.at : e.pos;
    return {
      x,
      y,
      zone: e.zone,
      inside: e.inside,
      interior: e.interior?.dir,
      at: e.interior ? e.pos : undefined,
      estimated: e.basis,
      title: `You (estimated: ${e.basis}; ${saved})`,
    };
  }
  const inside = !isOutside(p.area.type);
  const [x, y] = inside ? p.entrance : p.pos;
  return { x, y, zone: [p.area.x, p.area.y], inside, interior: playerInterior(world)?.dir, at: p.pos, title: `You (${saved})` };
}

const youLabel = (you: Spot, inside: boolean) => `You${inside ? " (inside)" : ""}${you.estimated ? " (est.)" : ""}`;

export function renderWorld(st: State) {
  st.cleanup?.();
  const w = st.world, p = w.player;
  const you = playerSpot(st);
  const root = document.documentElement.style;
  if (p.hair) root.setProperty("--hair", p.hair);
  else root.removeProperty("--hair");
  const light = p.hairLight !== false;
  root.setProperty("--you-line", light ? "#120e0f" : "#f4efe6");
  root.setProperty("--you-halo", light ? "rgb(244 239 230 / .45)" : "rgb(18 14 15 / .5)");
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
  mode.addEventListener("change", () => {
    rememberView(st);
    st.prefs.realistic = mode.checked;
    if (!mode.checked) {
      st.terrain.dispose();
      st.terrain = new TerrainStore(w);
    }
    renderWorld(st);
  });
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
      : "Game terrain and saved scenery. Wheel to zoom, drag to pan, World to fit all zones. Click a neighbouring zone to inspect it. NPCs, creatures and carcasses remain markers; lighting and animation are not simulated.";
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
  document.querySelectorAll(".cell.sel").forEach((c) => c.classList.remove("sel"));
  document.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`)?.classList.add("sel");
  renderZone(st, st.world.zones[y][x]);
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

async function renderZone(st: State, z: Zone) {
  const my = ++token;
  activeMap?.dispose();
  const world = st.world;
  st.interiorDir = undefined;
  const panel = $("#zone");
  const visit = z.lastVisit ? `last here on day ${Math.floor(z.lastVisit[0])}` : z.explored ? "explored" : "not explored yet";
  panel.replaceChildren(
    h(
      "header",
      {},
      h("h2", {}, h("span", { class: "coord" }, coordLabel(z.x, z.y)), " ", z.name),
      h("span", { class: "muted" }, visit),
      wikiLink(entityWiki(z.name)),
    ),
    h("p", { class: "muted loading" }, "Loading…"),
  );

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

  const marks: Mark[] = [...solidMarks(z.solids, inners), ...sealedMarks(inners), ...(detail ? detailMarks(detail) : [])];
  for (const m of marks) {
    const inside = m.interior && insides.find((i) => i.interior === m.interior);
    if (inside) m.detail = `${m.detail === "entrance is gone" ? "entrance is gone; " : ""}inside: ${insideSummary(inside.detail)}`;
  }
  const heats = zoneHeat(world, st.marks, z, { ...tiles, beings: detail?.beings });
  const you = playerSpot(st);
  const url = st.mapUrls.get(key(z.x, z.y));
  const base = url
    ? [s("image", { href: url, x: 0, y: 0, width: ROOM, height: ROOM, class: "b-map", preserveAspectRatio: "none" })]
    : blankBase(world, z);
  const inspector = h("section", { class: "inspection", hidden: true, "aria-live": "polite" });
  const openInterior = (m: Mark) => {
    if (m.interior) {
      st.viewport = undefined;
      st.inspected = undefined;
      renderInterior(st, z, m.interior, m.name);
    } else {
      st.inspected = markKey(m);
      inspectMark(inspector, m, undefined, chopTool(st));
    }
  };
  const map = new MapView({
    base: st.prefs.realistic ? [] : base,
    ...(st.prefs.realistic
      ? {
        raster: new TerrainRaster(st.terrain, worldScenes(world, z.x, z.y)),
        bounds: [-z.x * ROOM, -z.y * ROOM, 5 * ROOM] as [number, number, number],
        onMapClick: (px: number, py: number) => {
          const x = z.x + Math.floor(px / ROOM), y = z.y + Math.floor(py / ROOM);
          if (x >= 0 && x < 5 && y >= 0 && y < 5 && (x !== z.x || y !== z.y)) selectZone(st, x, y);
        },
      }
      : {}),
    marks,
    heats: heats.map((ht) => ({ cls: `m-${ht.id}`, url: heatUrl(ht.heat, HEAT_COLOR[ht.id]), bounds: heatBounds(ht.heat) })),
    player: you.zone[0] === z.x && you.zone[1] === z.y
      ? { x: you.x, y: you.y, label: youLabel(you, you.inside), title: you.title }
      : undefined,
    onOpen: openInterior,
  });
  activeMap = map;
  if (st.viewport) map.restore(st.viewport);
  const restoreInspection = (available: Mark[]) => {
    const inspected = available.find((m) => markKey(m) === st.inspected);
    if (inspected) inspectMark(inspector, inspected, st.expanded, chopTool(st));
  };
  restoreInspection(marks);
  const treeList = h("div", { class: "lists" });
  const chips = layerChips(st, map, z.dir, () => my === token, false, (plants) => {
    const open = plants.find((m) => markKey(m) === st.inspected);
    if (open) {
      // Re-rendering for a new tool keeps the inspection's open sections.
      const expanded = inspector.hidden ? st.expanded : new Set(
        Array.from(inspector.querySelectorAll<HTMLDetailsElement>("details[data-remember][open]")).map((el) => el.dataset.remember!),
      );
      inspectMark(inspector, open, expanded, chopTool(st));
    }
    const keep = treeKeep(st.prefs.treeMin);
    const shown = plants.filter((m) => m.layer === "trees" && (!keep || keep(m))).sort((a, b) => treeLife(a) - treeLife(b));
    const wasOpen = treeList.querySelector("details")?.open;
    treeList.replaceChildren(markGroup(st, map, openInterior, "Trees, deadest first", shown, false) ?? "");
    const list = treeList.querySelector("details");
    if (list && wasOpen !== undefined) list.open = wasOpen;
  });

  const legend = heats.length
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
    ...[panel.firstElementChild!, map.el, chips, legend, inspector, lists, treeList, areaWarnings(world)].filter((n): n is Element => !!n),
  );
}

/** Layer chips grouped by category, each with a tri-state header. */
const LAYER_GROUPS: [string, (Layer | "water")[]][] = [
  ["Locations", ["places", "caves", "ruins", "rifts"]],
  ["Entities", ["you", "npcs", "creatures"]],
  ["Items", ["loot", "camp"]],
  ["Terrain", ["boulders", "rubble", "rocks", "sharp", "water"]],
  ["Nature", ["trees", "brambles", "vines"]],
];

/** Layers drawn from saved plants (lazy `loadTrees`), and the NatureData tile each thorny layer shades. */
const PLANT_LAYERS = new Set<Layer>(["trees", "brambles", "vines"]);
const THORN_TILES: [Layer, number][] = [["brambles", 1], ["sharp", 2], ["vines", 3]];
const OUTDOOR_ONLY = new Set<Layer>(["trees", "brambles", "vines", "sharp", "boulders", "rubble"]);

/** The world grid's person follows the You layer too. */
function showLayers(st: State, map: MapView, all: Layer[]) {
  map.setLayers(st.prefs.layers, all);
  document.body.classList.toggle("hide-you", !st.prefs.layers.has("you"));
}

/** Layer checkboxes. Trees and water load lazily, and only for outdoor zones (`dir` given). */
function layerChips(
  st: State,
  map: MapView,
  dir: string | undefined,
  current: () => boolean,
  indoor = false,
  onPlants?: (plants: Mark[]) => void,
) {
  const all = LAYERS.map((l) => l.id);
  showLayers(st, map, all);
  map.setFilter(treeKeep(st.prefs.treeMin));
  const chips = h("div", { class: "layers" });
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
  // Water is a separate pref but is shown as part of Terrain.
  const boxes = new Map<Layer | "water", [HTMLInputElement, HTMLElement]>();
  for (const l of LAYERS) {
    if (indoor && OUTDOOR_ONLY.has(l.id)) continue;
    const box = h("input", { type: "checkbox", checked: st.prefs.layers.has(l.id) }) as HTMLInputElement;
    box.addEventListener("change", () => {
      if (box.checked) st.prefs.layers.add(l.id);
      else st.prefs.layers.delete(l.id);
      if (PLANT_LAYERS.has(l.id) && box.checked) loadTreesOnce();
      if (THORN_TILES.some(([t]) => t === l.id)) setThorns();
      showLayers(st, map, all);
    });
    boxes.set(l.id, [box, h("label", { class: `chip L-${l.id}`, title: LAYER_TIPS[l.id] ?? "" }, box, l.label)]);
  }
  if (dir && !indoor) {
    if ([...PLANT_LAYERS].some((l) => st.prefs.layers.has(l))) loadTreesOnce();
    setThorns();
    const box = h("input", { type: "checkbox", checked: st.prefs.water }) as HTMLInputElement;
    const setWater = async () => {
      const url = st.prefs.water ? await waterUrl(st.world, dir) : null;
      if (current()) map.setOverlay("water", url);
    };
    box.addEventListener("change", () => {
      st.prefs.water = box.checked;
      setWater();
    });
    boxes.set("water", [box, h("label", { class: "chip water" }, box, "Water")]);
    if (st.prefs.water) setWater();
  }

  /** Tri-state header: checks all of `set`, or clears them when every one is already on. */
  const headers: [HTMLInputElement, HTMLInputElement[]][] = [];
  const setBox = (x: HTMLInputElement, on: boolean) => {
    if (x.checked === on) return;
    x.checked = on;
    x.dispatchEvent(new Event("change"));
  };
  const header = (label: string, set: HTMLInputElement[]) => {
    const box = h("input", { type: "checkbox" }) as HTMLInputElement;
    box.addEventListener("change", () => {
      const on = !set.every((x) => x.checked);
      for (const x of set) setBox(x, on);
    });
    headers.push([box, set]);
    return h("label", { class: "chip group" }, box, label);
  };
  const sync = () => {
    for (const [box, set] of headers) {
      const n = set.filter((x) => x.checked).length;
      box.checked = n === set.length;
      box.indeterminate = n > 0 && n < set.length;
    }
  };
  const every = [...boxes.values()].map(([box]) => box);
  const reset = h("button", { type: "button", class: "chip reset" }, "Reset to defaults");
  reset.addEventListener("click", () => {
    for (const l of LAYERS) if (boxes.has(l.id)) setBox(boxes.get(l.id)![0], l.on);
    const water = boxes.get("water");
    if (water) setBox(water[0], false);
  });
  chips.append(h("div", { class: "layer-group" }, header("All", every), reset));
  for (const [label, ids] of LAYER_GROUPS) {
    const rows = ids.flatMap((id) => boxes.has(id) ? [boxes.get(id)!] : []);
    if (!rows.length) continue;
    chips.append(h("div", { class: "layer-group" }, header(label, rows.map(([box]) => box)), ...rows.map(([, el]) => el)));
  }
  for (const box of every) box.addEventListener("change", sync);
  sync();
  if (dir && !indoor) {
    const trunks = h(
      "select",
      { "aria-label": "Show trees by trunk liveliness" },
      TRUNK_FILTERS.map(([min, label]) => h("option", { value: min, selected: min === st.prefs.treeMin }, label)),
    ) as HTMLSelectElement;
    trunks.addEventListener("change", () => {
      st.prefs.treeMin = Number(trunks.value);
      map.setFilter(treeKeep(st.prefs.treeMin));
      const treeBox = boxes.get("trees")?.[0];
      if (treeBox && !treeBox.checked) {
        treeBox.checked = true;
        treeBox.dispatchEvent(new Event("change"));
      }
      treesChanged();
    });
    chips.append(h("label", { class: "chip L-trees" }, "Trunks", trunks));

    const owned = new Set(ownedTools(st.world.player.inventory));
    const tools = Object.keys(CHOP_TOOLS).map(Number).sort((a, b) => CHOP_TOOLS[b] - CHOP_TOOLS[a] || a - b);
    const tool = h(
      "select",
      { "aria-label": "Chopping tool for harvest costs" },
      tools.map((t) =>
        h(
          "option",
          { value: t, selected: t === chopTool(st) },
          `${ITEM_NAMES[t] ?? `Item ${t}`} ×${CHOP_TOOLS[t]}${owned.has(t) && t !== UNARMED ? " (carried)" : ""}`,
        )
      ),
    ) as HTMLSelectElement;
    tool.addEventListener("change", () => {
      st.prefs.chopTool = Number(tool.value);
      for (const m of trees) m.detail = treeDetail(m.tree!, st.prefs.chopTool);
      treesChanged();
    });
    chips.append(h("label", { class: "chip L-trees" }, "Chop with", tool));
  }
  return chips;
}

const LAYER_TIPS: Partial<Record<Layer, string>> = {
  places: "Named landmarks such as Fort Solid, Camp, the Library and NPC homes, and their entrances",
  caves: "Cave entrances",
  ruins: "Ruin and ruin cellar entrances",
  rifts: "Rifts and the entrances to the rift depths",
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
const chopTool = (st: State) => st.prefs.chopTool ?? ownedTools(st.world.player.inventory)[0];

const treeLife = (m: Mark) => (m.tree && trunkOf(m.tree)?.life) ?? 2;

/** Map filter for the trunk liveliness select: trees whose trunk is at least this dead. */
const treeKeep = (min: number) =>
  min > 0 ? (m: Mark) => m.layer !== "trees" || (m.tree ? (trunkOf(m.tree)?.freshness ?? -1) : -1) >= min : null;

function areaWarnings(world: World) {
  return world.warnings.length ? h("p", { class: "warnings" }, world.warnings.join(" · ")) : null;
}

/** The map's tree silhouette, for list rows. */
const treeSym = (kind: string) =>
  s(
    "svg",
    { class: `sym-icon ${kind}`, viewBox: "-8 -11 16 16", "aria-hidden": "true" },
    treeIcon(kind),
  );

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
      m.layer === "trees" ? treeSym(m.kind) : h("span", { class: `sym ${m.kind}` }),
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
  const camp = marks.filter((m) => m.layer === "camp");
  const creatures = marks.filter((m) => m.layer === "creatures");
  return h(
    "div",
    { class: "lists" },
    group("Places", places),
    group("NPCs", npcs),
    group("Loot", loot, loot.length <= 12),
    group("Camp & storage", camp),
    group("Creatures when saved", creatures, false),
  );
}

const rank = (m: Mark) => (m.kind === "landmark" ? 0 : m.kind.startsWith("entrance explored") ? 1 : m.kind.startsWith("entrance") ? 2 : 3);

async function renderInterior(st: State, z: Zone, it: Interior, name: string) {
  const my = ++token;
  activeMap?.dispose();
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
  const open = (m: Mark) => {
    if (m.interior) {
      st.viewport = undefined;
      st.inspected = undefined;
      renderInterior(st, z, m.interior, m.name);
    } else {
      st.inspected = markKey(m);
      inspectMark(inspector, m);
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
    player: you.interior === it.dir && you.at ? { x: you.at[0], y: you.at[1], label: youLabel(you, false), title: you.title } : undefined,
    onOpen: open,
  });
  activeMap = map;
  if (st.viewport) map.restore(st.viewport);
  const inspected = marks.find((m) => markKey(m) === st.inspected);
  if (inspected) inspectMark(inspector, inspected, st.expanded);
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
    layerChips(st, map, undefined, () => my === token, true),
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

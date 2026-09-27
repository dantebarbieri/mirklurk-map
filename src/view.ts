// Page rendering: world grid, landmark list, zone and interior panels.

import { $, h, hex, s, tileImage } from "./dom.ts";
import { MapView } from "./mapview.ts";
import { detailMarks, type Layer, LAYERS, type Mark, sealedMarks, solidMarks, treeMarks } from "./objects.ts";
import { heatBounds, type Landmark, type LandmarkId, pct, zoneHeat } from "./predict.ts";
import { Area, coordLabel, INTERIOR_NAMES, isOutside, NPC_BEINGS, ROOM, Thresh, tileIndex, TILES } from "./rules.ts";
import { BEING_NAMES } from "./gamedata.ts";
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
  prefs: { layers: Set<Layer>; water: boolean };
  selected?: [number, number];
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

function playerSpot(world: World): { x: number; y: number; zone: [number, number]; inside: boolean } {
  const p = world.player;
  const inside = !isOutside(p.area.type);
  const [x, y] = inside ? p.entrance : p.pos;
  return { x, y, zone: [p.area.x, p.area.y], inside };
}

export function renderWorld(st: State) {
  const w = st.world, p = w.player;
  const you = playerSpot(w);
  const here = w.zones[you.zone[1]]?.[you.zone[0]];
  const version = p.version === "0.8.1.5" ? "" : ` · made for game 0.8.1.5, this save is ${p.version}`;
  const summary = h(
    "p",
    { class: "summary" },
    h("b", {}, w.character),
    ` · day ${p.day}`,
    here ? ` · you are in ${coordLabel(here.x, here.y)} ${here.name}${you.inside ? " (indoors)" : ""}` : "",
    version,
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
  $("#app").replaceChildren(
    h("section", { id: "world" }, summary, grid, landmarkList(st), warn),
    h("section", { id: "zone", "aria-live": "polite" }),
  );
  selectZone(st, you.zone[0], you.zone[1]);
}

function cell(st: State, z: Zone, you: ReturnType<typeof playerSpot>) {
  const url = st.mapUrls.get(key(z.x, z.y));
  const sh = shores(st.world, z.x, z.y);
  const thumb = url ? h("img", { src: url, alt: "", draggable: "false" }) : h(
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
  if (isHere) dots.push(h("span", { class: "you", title: "You", style: `left:${you.x / ROOM * 100}%;top:${you.y / ROOM * 100}%` }));
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

export function selectZone(st: State, x: number, y: number) {
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
  const world = st.world;
  const panel = $("#zone");
  const visit = z.lastVisit ? `last here on day ${Math.floor(z.lastVisit[0])}` : z.explored ? "explored" : "not explored yet";
  panel.replaceChildren(
    h("header", {}, h("h2", {}, h("span", { class: "coord" }, coordLabel(z.x, z.y)), " ", z.name), h("span", { class: "muted" }, visit)),
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
  const you = playerSpot(world);
  const url = st.mapUrls.get(key(z.x, z.y));
  const base = url
    ? [s("image", { href: url, x: 0, y: 0, width: ROOM, height: ROOM, class: "b-map", preserveAspectRatio: "none" })]
    : blankBase(world, z);
  const openInterior = (m: Mark) => m.interior && renderInterior(st, z, m.interior, m.name);
  const map = new MapView({
    base,
    marks,
    heats: heats.map((ht) => ({ cls: `m-${ht.id}`, url: heatUrl(ht.heat, HEAT_COLOR[ht.id]), bounds: heatBounds(ht.heat) })),
    player: you.zone[0] === z.x && you.zone[1] === z.y ? { x: you.x, y: you.y, label: you.inside ? "You (inside)" : "You" } : undefined,
    onOpen: openInterior,
  });
  const chips = layerChips(st, map, z.dir, () => my === token);

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

  const lists = poiLists(marks, map, openInterior);
  panel.replaceChildren(...[panel.firstElementChild!, map.el, chips, legend, lists].filter((n): n is Element => !!n));
}

/** Layer checkboxes. Trees and water load lazily, and only for outdoor zones (`dir` given). */
function layerChips(st: State, map: MapView, dir: string | undefined, current: () => boolean, indoor = false) {
  const all = LAYERS.map((l) => l.id);
  map.setLayers(st.prefs.layers, all);
  const chips = h("div", { class: "layers" });
  let treesLoaded = false;
  const loadTreesOnce = async () => {
    if (treesLoaded || !dir) return;
    treesLoaded = true;
    const trees = await loadTrees(st.world, dir);
    if (current()) map.addMarks(treeMarks(trees));
  };
  for (const l of LAYERS) {
    if (indoor && (l.id === "trees" || l.id === "boulders")) continue;
    const box = h("input", { type: "checkbox", checked: st.prefs.layers.has(l.id) }) as HTMLInputElement;
    box.addEventListener("change", () => {
      if (box.checked) st.prefs.layers.add(l.id);
      else st.prefs.layers.delete(l.id);
      if (l.id === "trees" && box.checked) loadTreesOnce();
      map.setLayers(st.prefs.layers, all);
    });
    chips.append(h("label", { class: `chip L-${l.id}` }, box, l.label));
  }
  if (dir && !indoor) {
    if (st.prefs.layers.has("trees")) loadTreesOnce();
    const box = h("input", { type: "checkbox", checked: st.prefs.water }) as HTMLInputElement;
    const setWater = async () => {
      const url = st.prefs.water ? await waterUrl(st.world, dir) : null;
      if (current()) map.setOverlay("water", url);
    };
    box.addEventListener("change", () => {
      st.prefs.water = box.checked;
      setWater();
    });
    chips.append(h("label", { class: "chip water" }, box, "Water"));
    if (st.prefs.water) setWater();
  }
  return chips;
}

function poiLists(marks: Mark[], map: MapView, open: (m: Mark) => void) {
  const group = (title: string, ms: Mark[], openByDefault = true) => {
    if (!ms.length) return null;
    const rows = ms.map((m) =>
      h(
        "li",
        {
          class: `L-${m.layer} ${m.kind}`,
          onmouseenter: () => map.highlight(m),
          onmouseleave: () => map.highlight(null),
        },
        h("span", { class: `sym ${m.kind}` }),
        m.interior
          ? h("button", { type: "button", class: "link", title: "Look inside", onclick: () => open(m) }, m.name)
          : h("button", { type: "button", class: "plain", title: "Show on map", onclick: () => map.focus(m) }, m.name),
        m.detail ? h("span", { class: "muted" }, ` — ${m.detail}`) : "",
      )
    );
    return h("details", { open: openByDefault }, h("summary", {}, `${title} (${ms.length})`), h("ul", {}, rows));
  };
  const places = marks.filter((m) => m.layer === "places" && m.kind !== "boat");
  places.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const npcs = marks.filter((m) => m.layer === "npcs");
  const loot = marks.filter((m) => m.layer === "loot");
  const camp = marks.filter((m) => m.layer === "camp");
  const creatures = marks.filter((m) => m.layer === "creatures");
  const tally = new Map<string, number>();
  for (const c of creatures) tally.set(c.name, (tally.get(c.name) ?? 0) + 1);
  return h(
    "div",
    { class: "lists" },
    group("Places", places),
    group("NPCs", npcs),
    group("Loot", loot, loot.length <= 12),
    group("Camp & storage", camp),
    creatures.length
      ? h("p", { class: "muted" }, `Creatures when saved: ${[...tally].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(", ")}`)
      : null,
  );
}

const rank = (m: Mark) => (m.kind === "landmark" ? 0 : m.kind.startsWith("entrance explored") ? 1 : m.kind.startsWith("entrance") ? 2 : 3);

async function renderInterior(st: State, z: Zone, it: Interior, name: string) {
  const my = ++token;
  const world = st.world;
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
  const open = (m: Mark) => m.interior && renderInterior(st, z, m.interior, m.name);
  const map = new MapView({
    base: [s("image", { href: url, x: 0, y: 0, width: ROOM, height: ROOM, class: "b-map", preserveAspectRatio: "none" })],
    view,
    marks,
    heats: [],
    onOpen: open,
  });
  const up = it.parent;
  const back = h(
    "button",
    {
      type: "button",
      class: "link",
      onclick: () => (up ? renderInterior(st, z, up, INTERIOR_NAMES[up.kind ?? -1] ?? "Interior") : renderZone(st, z)),
    },
    up ? `← back to ${INTERIOR_NAMES[up.kind ?? -1] ?? "the level above"}` : `← back to ${coordLabel(z.x, z.y)} ${z.name}`,
  );
  panel.replaceChildren(
    h("header", {}, h("h2", {}, kind), h("span", { class: "muted" }, `inside ${coordLabel(z.x, z.y)} ${z.name}${visit}`)),
    back,
    map.el,
    layerChips(st, map, undefined, () => my === token, true),
    poiLists(marks, map, open),
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

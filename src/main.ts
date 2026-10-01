// Entry point: pick or drop a save, then render the world.

import { $, h } from "./dom.ts";
import { type Character, type FileMap, findCharacters, fromDataTransfer, fromFiles } from "./files.ts";
import { LAYERS } from "./objects.ts";
import { landmarks, shipwreckOdds } from "./predict.ts";
import { Area } from "./rules.ts";
import { disposeView, renderWorld, selectZone, type State } from "./view.ts";
import { TerrainStore } from "./terrain.ts";
import { loadLayer, loadWorld } from "./world.ts";

let files: FileMap | null = null;
let chars: Character[] = [];
let urls: string[] = [];
const prefs = { layers: new Set(LAYERS.filter((l) => l.on).map((l) => l.id)), water: false, realistic: false };
let state: State | undefined;
let showToken = 0;
let activeCharacter = 0;

function status(text: string, error = false) {
  const el = $("#status");
  el.textContent = text;
  el.classList.toggle("error", error);
}

async function open(map: FileMap) {
  const found = findCharacters(map);
  if (!found.length) {
    status("No Player.save in what you picked. Choose a character folder from the game's Saves folder.", true);
    return;
  }
  await show(0, map, found);
}

async function show(i: number, selectedFiles = files, selectedChars = chars) {
  if (!selectedFiles) return;
  const my = ++showToken;
  const c = selectedChars[i];
  const preparedUrls: string[] = [];
  let installed = false;
  status(`Reading ${c.name}…`);
  try {
    const world = await loadWorld(selectedFiles, c.root, c.name);
    const shipwreck = new Map<string, number>();
    for (const z of world.zones.flat()) {
      if (z.type !== Area.BrokenFen || !z.dir) continue;
      const [w1, lo] = await Promise.all([loadLayer(world, z.dir, "Water1"), loadLayer(world, z.dir, "Lower")]);
      if (w1 && lo) shipwreck.set(`${z.x},${z.y}`, shipwreckOdds(w1.data, lo.data).perEntry);
    }
    if (my !== showToken) return;
    const mapUrls = new Map<string, string>();
    for (const z of world.zones.flat()) {
      if (!z.mapPath) continue;
      const bytes = await selectedFiles.get(z.mapPath)!.read();
      if (my !== showToken) return;
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
      preparedUrls.push(url);
      mapUrls.set(`${z.x},${z.y}`, url);
    }
    const st: State = { world, marks: landmarks(world, shipwreck), mapUrls, prefs, terrain: new TerrainStore(world) };
    const options = selectedChars.map((c, i) => h("option", { value: i }, c.name));
    if (state) disposeView(state);
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = preparedUrls;
    files = selectedFiles;
    chars = selectedChars;
    activeCharacter = i;
    state = st;
    installed = true;
    const pick = $<HTMLSelectElement>("#character");
    pick.replaceChildren(...options);
    pick.hidden = chars.length < 2;
    pick.value = String(activeCharacter);
    document.body.classList.add("loaded");
    renderWorld(st);
    const want = /^([A-E]),?([1-5])$/i.exec(new URLSearchParams(location.search).get("zone") ?? "");
    if (want) selectZone(st, "ABCDE".indexOf(want[1].toUpperCase()), Number(want[2]) - 1);
    status("");
  } catch (e) {
    if (my !== showToken) return;
    console.error(e);
    $<HTMLSelectElement>("#character").value = String(activeCharacter);
    status(`Could not read ${c.name}: ${(e as Error).message}`, true);
  } finally {
    if (!installed) preparedUrls.forEach((u) => URL.revokeObjectURL(u));
  }
}

function wire() {
  const folder = $<HTMLInputElement>("#pick-folder");
  const zip = $<HTMLInputElement>("#pick-zip");
  for (const input of [folder, zip]) {
    input.addEventListener("change", async () => {
      if (input.files?.length) await open(await fromFiles(Array.from(input.files)));
      input.value = "";
    });
  }
  $<HTMLSelectElement>("#character").addEventListener("change", (e) => show(Number((e.target as HTMLSelectElement).value)));
  let depth = 0;
  addEventListener("dragenter", (e) => {
    e.preventDefault();
    if (++depth === 1) document.body.classList.add("dragging");
  });
  addEventListener("dragleave", () => {
    if (--depth <= 0) (depth = 0), document.body.classList.remove("dragging");
  });
  addEventListener("dragover", (e) => e.preventDefault());
  addEventListener("drop", async (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove("dragging");
    if (e.dataTransfer) await open(await fromDataTransfer(e.dataTransfer));
  });
}

async function devSave(name: string) {
  const list: string[] = await (await fetch(`/__saves/${encodeURIComponent(name)}/`)).json();
  const map: FileMap = new Map();
  for (const p of list) {
    map.set(`${name}/${p}`, {
      read: async () =>
        new Uint8Array(
          await (await fetch(`/__saves/${encodeURIComponent(name)}/${p.split("/").map(encodeURIComponent).join("/")}`)).arrayBuffer(),
        ),
    });
  }
  await open(map);
}

wire();
const dev = new URLSearchParams(location.search).get("dev");
if (dev && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) devSave(dev);

// Entry point: pick or drop a save, then render the world.

import { $, h } from "./dom.ts";
import { type Character, characterIndex, type FileMap, findCharacters, fromDataTransfer, fromFiles } from "./files.ts";
import { LAYERS, PLAYER_KEY } from "./objects.ts";
import { landmarks, shipwreckOdds } from "./predict.ts";
import { Area } from "./rules.ts";
import { estimatePlayer } from "./estimate.ts";
import { disposeView, playerSpot, rememberView, renderWorld, selectZone, type State } from "./view.ts";
import { TerrainStore } from "./terrain.ts";
import { loadLayer, loadWorld } from "./world.ts";
import { type DirectoryPicker, LiveReader, scanDirectory } from "./live.ts";
import { Sharing } from "./sharing.ts";

let files: FileMap | null = null;
let chars: Character[] = [];
let urls: string[] = [];
const prefs: State["prefs"] = {
  layers: new Set(LAYERS.filter((l) => l.on).map((l) => l.id)),
  water: false,
  realistic: false,
  treeMin: 0,
};
let state: State | undefined;
let showToken = 0;
let activeCharacter = 0;
let reader: LiveReader | undefined;
let liveTimer: number | undefined;
let sourceToken = 0;
let follow = true;
let revision = 0;
const sharing: Sharing = new Sharing({
  current: () =>
    files && !sharing.isWatching ? { files, character: chars[activeCharacter], revision, session: sourceToken, live: !!reader } : undefined,
  stopLocal: stopLive,
  display: (map, character, refresh) => show(0, map, [character], refresh),
});

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

async function show(i: number, selectedFiles = files, selectedChars = chars, refresh = false): Promise<boolean> {
  if (!selectedFiles) return false;
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
    if (refresh && world.warnings.length) throw new Error(world.warnings.join("; "));
    if (my !== showToken) return false;
    const mapUrls = new Map<string, string>();
    for (const z of world.zones.flat()) {
      if (!z.mapPath) continue;
      const bytes = await selectedFiles.get(z.mapPath)!.read();
      if (my !== showToken) return false;
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
      preparedUrls.push(url);
      mapUrls.set(`${z.x},${z.y}`, url);
    }
    const st: State = { world, marks: landmarks(world, shipwreck), mapUrls, prefs, terrain: new TerrainStore(world) };
    const same = refresh && state && chars[activeCharacter]?.root === c.root;
    // Estimates are only for live views (local live saves or a watched shared link); manual imports show the save as is.
    if (reader || sharing.isWatching) st.estimate = estimatePlayer(world, same ? state!.world.player : undefined);
    if (same && state) {
      rememberView(state);
      st.selected = state.selected;
      st.interiorDir = state.interiorDir;
      st.viewport = state.viewport;
      st.inspected = state.inspected;
      st.expanded = state.expanded;
    }
    if ((reader || sharing.isWatching) && follow) {
      const you = playerSpot(st);
      const selected = you.zone;
      const interior = you.inside ? you.interior : undefined;
      if (st.selected?.[0] !== selected[0] || st.selected?.[1] !== selected[1] || st.interiorDir !== interior) {
        st.viewport = undefined;
        // An open card of the player follows them; anything else stays behind.
        if (st.inspected !== PLAYER_KEY) st.inspected = undefined;
      }
      st.selected = selected;
      st.interiorDir = interior;
    }
    const options = selectedChars.map((c, i) => h("option", { value: i }, c.name));
    if (state) disposeView(state);
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = preparedUrls;
    files = selectedFiles;
    chars = selectedChars;
    activeCharacter = i;
    state = st;
    ++revision;
    installed = true;
    const pick = $<HTMLSelectElement>("#character");
    pick.replaceChildren(...options);
    pick.hidden = chars.length < 2;
    pick.value = String(activeCharacter);
    document.body.classList.add("loaded");
    renderWorld(st);
    const want = /^([A-E]),?([1-5])$/i.exec(new URLSearchParams(location.search).get("zone") ?? "");
    if (want && !refresh && !reader && !sharing.isWatching) selectZone(st, "ABCDE".indexOf(want[1].toUpperCase()), Number(want[2]) - 1);
    sharing.changed();
    status("");
    return true;
  } catch (e) {
    if (my !== showToken) return false;
    console.error(e);
    $<HTMLSelectElement>("#character").value = String(activeCharacter);
    status(`Could not read ${c.name}: ${(e as Error).message}`, true);
    return false;
  } finally {
    if (!installed) preparedUrls.forEach((u) => URL.revokeObjectURL(u));
  }
}

function liveStatus(text: string, error = false) {
  $("#live-status").textContent = text;
  $("#live-status").classList.toggle("error", error);
}

function stopLive() {
  sharing.stop();
  ++sourceToken;
  ++showToken;
  reader?.stop();
  reader = undefined;
  clearInterval(liveTimer);
  liveTimer = undefined;
  $("#stop-live").hidden = true;
  $("#follow-control").hidden = true;
  status("");
  liveStatus("Live saves off. Manual imports are snapshots.");
  if (state?.estimate) {
    rememberView(state);
    state.estimate = null;
    if (follow) followPlayer(state);
    renderWorld(state);
  }
  sharing.changed();
}

/** Points the view at the player's (estimated or saved) spot. */
function followPlayer(st: State) {
  const you = playerSpot(st);
  st.selected = you.zone;
  st.interiorDir = you.inside ? you.interior : undefined;
  st.viewport = undefined;
  if (st.inspected !== PLAYER_KEY) st.inspected = undefined;
}

async function manualImport(read: () => Promise<FileMap>) {
  stopLive();
  const my = sourceToken;
  try {
    const map = await read();
    if (my === sourceToken) await open(map);
  } catch (e) {
    if (my !== sourceToken) return;
    console.error(e);
    status(`Could not import save: ${(e as Error).message}`, true);
  }
}

async function startLive(picker: DirectoryPicker) {
  stopLive();
  const my = sourceToken;
  try {
    const handle = await picker.showDirectoryPicker!({ mode: "read" });
    if (my !== sourceToken) return;
    const session = sourceToken;
    status("");
    const selectedCharacter = chars[activeCharacter];
    let first = true;
    reader = new LiveReader(
      () => scanDirectory(handle),
      async (snapshot) => {
        if (session !== sourceToken) return false;
        const found = findCharacters(snapshot.files);
        const selected = first ? selectedCharacter : chars[activeCharacter];
        const i = characterIndex(found, selected);
        const success = await show(i, snapshot.files, found, !first);
        if (success) first = false;
        return success;
      },
      liveStatus,
    );
    $("#stop-live").hidden = false;
    $("#follow-control").hidden = false;
    liveStatus("Reading folder; waiting for a complete save snapshot.");
    liveTimer = setInterval(() => reader?.poll(), 1500);
    await reader.poll();
  } catch (e) {
    if (my !== sourceToken) return;
    if (e instanceof DOMException && e.name === "AbortError") return;
    console.error(e);
    liveStatus(`Could not open live folder: ${(e as Error).message}`, true);
  }
}
function wire() {
  const folder = $<HTMLInputElement>("#pick-folder");
  const zip = $<HTMLInputElement>("#pick-zip");
  for (const input of [folder, zip]) {
    input.addEventListener("change", async () => {
      if (input.files?.length) await manualImport(() => fromFiles(Array.from(input.files!)));
      input.value = "";
    });
  }
  $<HTMLSelectElement>("#character").addEventListener("change", (e) => show(Number((e.target as HTMLSelectElement).value)));
  const picker: DirectoryPicker = window;
  const liveButton = $<HTMLButtonElement>("#start-live");
  liveButton.disabled = !picker.showDirectoryPicker || !isSecureContext;
  if (liveButton.disabled) {
    liveButton.title = "Live saves require desktop Chrome/Edge over HTTPS or localhost. Manual imports still work.";
    liveStatus(liveButton.title);
  }
  liveButton.addEventListener("click", () => startLive(picker));
  $("#stop-live").addEventListener("click", stopLive);
  $<HTMLInputElement>("#follow-player").addEventListener("change", (e) => {
    follow = (e.target as HTMLInputElement).checked;
    if (follow && state) {
      rememberView(state);
      followPlayer(state);
      renderWorld(state);
    }
  });
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
    if (e.dataTransfer) await manualImport(() => fromDataTransfer(e.dataTransfer!));
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
  await manualImport(() => Promise.resolve(map));
}

wire();
void sharing.init();
// Offline use and a faster start after the first visit (src/sw.ts). The dev server has no service worker, so this quietly fails there.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch((e) => console.debug("No service worker", e));
// An installed app may keep its storage, and with it the library key, when the browser clears space; a browser tab doesn't ask.
if (matchMedia("(display-mode: standalone)").matches) navigator.storage?.persist?.().catch((e) => console.debug(e));
const dev = new URLSearchParams(location.search).get("dev");
if (dev && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  devSave(dev).catch((e) => {
    console.error(e);
    status(`Could not read development save: ${e.message}`, true);
  });
}

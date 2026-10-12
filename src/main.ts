// Entry point: pick or drop a save, then render the world.

import { $, h } from "./dom.ts";
import {
  type Character,
  characterIndex,
  type FileMap,
  findCharacters,
  fromDataTransfer,
  fromDirectory,
  fromFiles,
  named,
} from "./files.ts";
import { LAYERS, PLAYER_KEY } from "./objects.ts";
import { estimatePlayer } from "./estimate.ts";
import { disposeView, playerSpot, rememberView, renderWorld, selectZone, type State, worldState } from "./view.ts";
import { loadWorld } from "./world.ts";
import { type DirectoryPicker, type LiveDirectory, LiveReader, scanDirectory } from "./live.ts";
import { Sharing } from "./sharing.ts";
import { knownCheated } from "./cheated.ts";
import { worldId } from "./sharing-format.ts";
import { fileMapOf, type Handoff, handOff, storedFiles, takeHandoff } from "./handoff.ts";

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
/** The folder each file map on screen was read from (Live saves, or a folder the editor handed back), to hand to the save editor. */
const folders = new WeakMap<FileMap, LiveDirectory>();
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

async function open(map: FileMap, want?: Character) {
  const found = named(findCharacters(map), want);
  if (!found.length) {
    status("No Player.save in what you picked. Choose a character folder from the game's Saves folder.", true);
    return;
  }
  await show(characterIndex(found, want), map, found);
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
    // The editor's record in this browser keeps the Cheated mark even when MirkMap.json was removed.
    world.cheated ||= await knownCheated(await worldId(c.name, world.player.grid));
    if (my !== showToken) return false;
    const prepared = await worldState(world, selectedFiles, prefs);
    preparedUrls.push(...prepared.urls);
    // After worldState: its shipwreck odds read Broken Fen layers, and a layer that cannot be read adds a warning.
    if (refresh && world.warnings.length) throw new Error(world.warnings.join("; "));
    if (my !== showToken) return false;
    const st = prepared.state;
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

async function manualImport(read: () => Promise<FileMap>, want?: Character) {
  stopLive();
  const my = sourceToken;
  try {
    const map = await read();
    if (my === sourceToken) await open(map, want);
  } catch (e) {
    if (my !== sourceToken) return;
    console.error(e);
    status(`Could not import save: ${(e as Error).message}`, true);
  }
}

/** Live saves on the folder `pick` gives: the directory picker, or a folder the save editor handed back. */
async function startLive(pick: () => Promise<LiveDirectory>, want?: Character) {
  stopLive();
  const my = sourceToken;
  try {
    const handle = await pick();
    if (my !== sourceToken) return;
    const session = sourceToken;
    status("");
    const selectedCharacter = want ?? chars[activeCharacter];
    let first = true;
    reader = new LiveReader(
      () => scanDirectory(handle),
      async (snapshot) => {
        if (session !== sourceToken) return false;
        folders.set(snapshot.files, handle);
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
/** The save on screen as the editor opens it: the world followed from My worlds, the folder it was read from, or a copy of it. */
async function currentHandoff(): Promise<Handoff | undefined> {
  const world = sharing.following;
  // The library this page follows the world in, not whichever one another tab may have switched to since.
  if (world) return { save: { kind: "world", ...world, library: await sharing.library() } };
  // A world from a share link is someone else's; the editor opens on its own.
  if (sharing.isWatching || !files) return undefined;
  const character = chars[activeCharacter];
  const handle = folders.get(files);
  if (handle) return { save: { kind: "folder", handle, live: !!reader }, character };
  status(`Handing ${character?.name ?? "the save"} to the save editor...`);
  // Only the character on screen: a whole Saves folder can be hundreds of megabytes.
  return { save: { kind: "files", files: await storedFiles(files, character?.root) }, character };
}

/** Follows the Save editor link with the save on screen handed over, so the editor opens it without asking for it again. */
async function toEditor(e: MouseEvent) {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  const href = (e.currentTarget as HTMLAnchorElement).href;
  try {
    const handoff = await currentHandoff();
    if (handoff) await handOff(handoff, "editor");
  } catch (err) {
    console.error("Could not hand the save to the editor", err);
  }
  location.href = href;
}

/** What the save editor handed back when its Back to MirkMap link was followed, shown as it was before: watched, if it was. */
async function pickUp({ save, character }: Handoff) {
  if (save.kind === "world") {
    // The map follows worlds of the library in use; one from a library switched away from since stays where it is.
    if (await sharing.library() === save.library) sharing.follow(save.id, save.name);
    else status(`${save.name} is in another of your libraries. Switch to it under My worlds & sync to see it.`);
    return;
  }
  if (save.kind === "files") return manualImport(() => Promise.resolve(fileMapOf(save.files)), character);
  const dir = save.handle as LiveDirectory & { queryPermission?(options: { mode: "read" }): Promise<PermissionState> };
  // Reading it again needs a click once the browser forgot it allowed that (after every tab of the site was closed).
  if (dir.queryPermission && await dir.queryPermission({ mode: "read" }) !== "granted") {
    status(`To see ${dir.name} here again, choose Open save folder or Live saves.`);
    return;
  }
  if (save.live) await startLive(() => Promise.resolve(dir), character);
  else {
    await manualImport(async () => {
      const map = await fromDirectory(dir);
      folders.set(map, dir);
      return map;
    }, character);
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
  liveButton.addEventListener("click", () => startLive(() => picker.showDirectoryPicker!({ mode: "read" })));
  $("#stop-live").addEventListener("click", stopLive);
  $<HTMLAnchorElement>("#to-editor").addEventListener("click", (e) => void toEditor(e));
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
// The save editor's Back to MirkMap link hands over what it had open; the library's own reopening waits for that.
takeHandoff("map").catch((e) => console.error("Could not read what the save editor handed over", e)).then((taken) => {
  void sharing.init(!taken);
  if (taken) void pickUp(taken.handoff);
});
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

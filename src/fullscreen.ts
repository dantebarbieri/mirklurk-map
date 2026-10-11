// Full-screen map, one mode for the whole page. A body class lays the zone panel over the window (style.css), so maps rendered
// while it is on (another zone, an interior, a live refresh) stay full screen; where the browser has the Fullscreen API it
// also hides the browser's own bars (iPhones have none, so the class alone covers the page there). The map's button,
// Escape or the browser's Back leave it; while a card floats on the map, Back closes the card first (see `backCloses`).

const listeners = new Set<(on: boolean) => void>();
/** Marks this page load's history entries; ones left by an earlier load (a reload while full screen) are not ours. */
const entry = `${Date.now()}-${Math.random()}`;
let on = false;
let scroll = 0;
let wired = false;
/** Our history entries above the page's own, counting traversals already asked for: full screen's, then an open card's. */
let depth = 0;
/** Popstates still due from traversals we asked for. */
let pending = 0;
/** Closes the card that Back closes first; returns false when there is none in sight to close after all. */
let layer: (() => boolean) | undefined;

export const isFullMap = () => on;

/** Calls `f` whenever the mode changes; returns the unsubscribe function. */
export function onFullMap(f: (on: boolean) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** How many of our entries history is on: 0 (the page's own), 1 (full screen) or 2 (a card on it). */
const level = () => (history.state?.fullMap === entry ? (history.state.layer ? 2 : 1) : 0);

/** Takes history back `n` entries, its popstate being ours. */
function goBack(n: number) {
  if (n <= 0) return;
  pending++;
  history.go(-n);
}

export function setFullMap(next: boolean) {
  if (next === on) return;
  wire();
  on = next;
  layer = undefined;
  if (on) {
    scroll = scrollY;
    // A history entry of its own, so Back (a phone's back gesture) closes the map rather than leaving the page.
    history.pushState({ fullMap: entry }, "");
    depth = 1;
    document.documentElement.requestFullscreen?.({ navigationUI: "hide" })
      .then(() => {
        if (!on) void document.exitFullscreen().catch(() => {});
      })
      .catch(() => {});
  } else {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    goBack(depth);
    depth = 0;
  }
  document.body.classList.toggle("map-full", on);
  if (!on) scrollTo(0, scroll);
  for (const f of listeners) f(on);
}

/**
 * While full screen, makes Back call `close` before it leaves full screen (and leave it anyway when `close` returns false),
 * with a history entry of its own. Returns the function to call once the card closes some other way, which takes that entry
 * back. A card already registered is replaced, keeping its entry, so a map drawn again keeps Back closing its card.
 */
export function backCloses(close: () => boolean): () => void {
  if (!on) return () => {};
  if (depth < 2) {
    history.pushState({ fullMap: entry, layer: true }, "");
    depth = 2;
  }
  layer = close;
  return () => {
    if (layer !== close) return;
    layer = undefined;
    goBack(depth - 1);
    depth = Math.min(depth, 1);
  };
}

function wire() {
  if (wired) return;
  wired = true;
  document.addEventListener("fullscreenchange", () => {
    if (!on || document.fullscreenElement) return;
    // Android's Back leaves the browser's full screen without reaching the page's history; on a phone it closes an open card
    // first, as Back does elsewhere, and the map stays over the page. (A desktop's Escape leaves at once, as the browser
    // keeps it from the page.)
    const close = layer;
    if (close && matchMedia("(pointer: coarse)").matches) {
      layer = undefined;
      if (close()) {
        goBack(depth - 1);
        depth = Math.min(depth, 1);
        return;
      }
    }
    setFullMap(false);
  });
  addEventListener("popstate", () => {
    if (pending && --pending) return;
    if (!on) return;
    const now = level();
    // History went back less than asked, or the user went forward: return to where the page is.
    if (now > depth) return goBack(now - depth);
    if (now === depth) return;
    depth = now;
    const close = layer;
    layer = undefined;
    if (now === 0 || !close?.()) setFullMap(false);
  });
  // After the map's own Escape handling (a choice menu or popup closes first and marks the event handled).
  addEventListener("keydown", (e) => {
    if (on && e.key === "Escape" && !e.defaultPrevented) setFullMap(false);
  });
}

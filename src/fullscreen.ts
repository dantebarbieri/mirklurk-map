// Full-screen map, one mode for the whole page. A body class lays the zone panel over the window (style.css), so maps rendered
// while it is on (another zone, an interior, a live refresh) stay full screen; where the browser has the Fullscreen API it
// also hides the browser's own bars (iPhones have none, so the class alone covers the page there). The map's button,
// Escape or the browser's Back leave it.

const listeners = new Set<(on: boolean) => void>();
/** Marks this page load's history entry; one left by an earlier load (a reload while full screen) is not ours. */
const entry = `${Date.now()}-${Math.random()}`;
let on = false;
let scroll = 0;
let wired = false;

export const isFullMap = () => on;

/** Calls `f` whenever the mode changes; returns the unsubscribe function. */
export function onFullMap(f: (on: boolean) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function setFullMap(next: boolean) {
  if (next === on) return;
  wire();
  on = next;
  if (on) {
    scroll = scrollY;
    // A history entry of its own, so Back (a phone's back gesture) closes the map rather than leaving the page.
    history.pushState({ fullMap: entry }, "");
    document.documentElement.requestFullscreen?.({ navigationUI: "hide" })
      .then(() => {
        if (!on) void document.exitFullscreen().catch(() => {});
      })
      .catch(() => {});
  } else {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    if (history.state?.fullMap === entry) history.back();
  }
  document.body.classList.toggle("map-full", on);
  if (!on) scrollTo(0, scroll);
  for (const f of listeners) f(on);
}

function wire() {
  if (wired) return;
  wired = true;
  document.addEventListener("fullscreenchange", () => {
    if (on && !document.fullscreenElement) setFullMap(false);
  });
  addEventListener("popstate", () => {
    if (on && history.state?.fullMap !== entry) setFullMap(false);
  });
  // After the map's own Escape handling (a choice menu or popup closes first and marks the event handled).
  addEventListener("keydown", (e) => {
    if (on && e.key === "Escape" && !e.defaultPrevented) setFullMap(false);
  });
}

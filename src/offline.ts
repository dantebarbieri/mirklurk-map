// How the service worker (src/sw.ts) answers requests. The build lists the files it keeps: the page, its script and stylesheet, the
// web app manifest, the icons and all bundled art.

/** Files named by their content hash never change, so a copy cached by an earlier version is still right. */
export const IMMUTABLE = /^(app|style)\.[0-9a-f]+\.(js|css)$|^assets\/(game|wiki)\/[a-z0-9_]+\.[0-9a-f]+\.png$/;

/**
 * "page": a navigation, answered from the network with the cached page as the offline fallback. "cache": a kept file, answered from the
 * cache. Undefined: left to the network untouched, which includes everything under api/ (sync and sharing) and other origins.
 */
export type Answer = "page" | "cache";

export function route(url: URL, scope: URL, mode: string, method: string, kept: ReadonlySet<string>): Answer | undefined {
  if (method !== "GET" || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return undefined;
  const path = url.pathname.slice(scope.pathname.length);
  if (path === "api" || path.startsWith("api/")) return undefined;
  if (mode === "navigate") return "page";
  return kept.has(path) && !url.search ? "cache" : undefined;
}

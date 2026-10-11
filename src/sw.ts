// Service worker: after the first visit the viewer opens instantly and works offline, including Realistic mode and inspection pictures.
// Saves are read in the page, so local folders, .zip files and Live saves need no network; synced and shared worlds still do.
// tools/build.ts bundles this into dist/sw.js and defines MIRKMAP_BUILD: a version and the files to keep.

import { IMMUTABLE, route } from "./offline.ts";

interface LifecycleEvent extends Event {
  waitUntil(work: Promise<unknown>): void;
}
interface RequestEvent extends LifecycleEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}
interface WorkerScope {
  readonly registration: { readonly scope: string };
  readonly clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: "install" | "activate", listener: (event: LifecycleEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: RequestEvent) => void): void;
}
declare const MIRKMAP_BUILD: { version: string; files: string[] };

/** How long a navigation waits for the network before the cached page is shown instead. */
const PAGE_WAIT = 3000;
const worker = self as unknown as WorkerScope;
const { version, files } = MIRKMAP_BUILD;
const CACHE = `mirkmap-${version}`;
const scope = new URL(worker.registration.scope);
const kept = new Set(files);
const page = new URL("./", scope).href;

worker.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(files.map(async (file) => {
      const url = new URL(file, scope).href;
      const immutable = IMMUTABLE.test(file);
      // Unchanged art is copied from the previous version's cache instead of being downloaded again.
      const response = (immutable ? await caches.match(url, { ignoreVary: true }) : undefined) ??
        await fetch(url, { cache: immutable ? "default" : "no-cache" });
      if (!response.ok) throw new Error(`Could not keep ${file} for offline use: HTTP ${response.status}`);
      await cache.put(url, response);
    }));
    await worker.skipWaiting();
  })());
});

worker.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith("mirkmap-") && name !== CACHE) await caches.delete(name);
    await worker.clients.claim();
  })());
});

worker.addEventListener("fetch", (event) => {
  const { request } = event;
  const answer = route(new URL(request.url), scope, request.mode, request.method, kept);
  if (answer === "page") event.respondWith(navigate(request));
  else if (answer === "cache") {
    event.respondWith((async () => (await (await caches.open(CACHE)).match(request, { ignoreVary: true })) ?? fetch(request))());
  }
});

/** The newest page when the network answers in time; otherwise, or when the server fails, the kept one. */
async function navigate(request: Request): Promise<Response> {
  const cached = async () => (await caches.open(CACHE)).match(page, { ignoreVary: true });
  const network = fetch(request);
  // If the kept page is shown first, a later network failure is expected.
  network.catch(() => undefined);
  try {
    const first = await Promise.race([network, new Promise<undefined>((resolve) => setTimeout(resolve, PAGE_WAIT))]);
    if (first && first.status < 500) return first;
    return (await cached()) ?? first ?? await network;
  } catch {
    return (await cached()) ?? Response.error();
  }
}

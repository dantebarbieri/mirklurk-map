import { type ShareSource, Sharing } from "../src/sharing.ts";
import { packSave, type SharedInfo, unpackSave } from "../src/sharing-format.ts";
import { assert, assertEquals } from "./assert.ts";

const storageKey = "mirklurk-shares-v1";
const firstId = "a".repeat(64), secondId = "b".repeat(64), editKey = "c".repeat(64);
const info = (id = firstId, version = "v1"): SharedInfo => ({
  id,
  name: id === firstId ? "Hero" : "Other",
  version,
  created: Date.now(),
  updated: Date.now(),
  expires: Date.now() + 86_400_000,
});
const source = (name = "Hero", session = 1): ShareSource => ({
  character: { name, root: `${name}/` },
  session,
  revision: 1,
  files: new Map([[`${name}/Player.save`, {
    read: () =>
      Promise.resolve(new TextEncoder().encode(JSON.stringify([{ worldGrid: Array.from({ length: 5 }, () => [1, 1, 1, 1, 1]) }]))),
    lastModified: 1234,
  }]]),
});

/** Only the DOM surface used by Sharing; events still use real EventTarget dispatch. */
class ElementStub extends EventTarget {
  children: (ElementStub | string)[] = [];
  disabled = false;
  checked = false;
  hidden = false;
  open = false;
  value = "";
  private text = "";
  private classes = new Set<string>();
  classList = {
    toggle: (name: string, on: boolean) => on ? this.classes.add(name) : this.classes.delete(name),
    contains: (name: string) => this.classes.has(name),
  };
  constructor(readonly tag = "div") {
    super();
  }
  get textContent(): string {
    return this.text + this.children.map((c) => typeof c === "string" ? c : c.textContent).join("");
  }
  set textContent(text: string) {
    this.text = text;
    this.children = [];
  }
  setAttribute(name: string, value: string) {
    if (name === "disabled") this.disabled = true;
    if (name === "value") this.value = value;
  }
  append(child: ElementStub | string) {
    this.children.push(child);
  }
  replaceChildren(...children: ElementStub[]) {
    this.text = "";
    this.children = children;
  }
  click() {
    if (!this.disabled) this.dispatchEvent(new Event("click"));
  }
  findButton(label: string): ElementStub | undefined {
    if (this.tag === "button" && this.textContent === label) return this;
    for (const child of this.children) {
      const found = typeof child !== "string" && child.findButton(label);
      if (found) return found;
    }
  }
}

interface PendingRequest {
  path: string;
  method: string;
  headers: Headers;
  body: RequestInit["body"];
  resolve(response: Response): void;
  answered: boolean;
}

async function withBrowser(run: (browser: BrowserStub) => Promise<void>, remembered: object[] = []) {
  const browser = new BrowserStub(remembered);
  try {
    await browser.sharing.init();
    await run(browser);
  } finally {
    browser.restore();
  }
}

class BrowserStub {
  private restorations: (() => void)[] = [];
  private elements = new Map<string, ElementStub>();
  private storage = new Map<string, string>();
  private timers: { callback: () => void; delay: number }[] = [];
  private listeners = new Map<string, () => void>();
  readonly document = {
    hidden: false,
    querySelector: (selector: string) => this.el(selector),
    createElement: (tag: string) => new ElementStub(tag),
  };
  readonly location = { origin: "https://map.example", pathname: "/", hash: "" };
  readonly requests: PendingRequest[] = [];
  readonly displays: { name: string; refresh: boolean }[] = [];
  current = source();
  viewport = { x: 100, y: 200, size: 768 };
  acceptDisplay = true;
  readonly sharing: Sharing;

  constructor(remembered: object[]) {
    this.storage.set(storageKey, JSON.stringify(remembered));
    this.install(globalThis, "document", this.document);
    this.install(globalThis, "location", this.location);
    this.install(globalThis, "localStorage", {
      getItem: (key: string) => this.storage.get(key) ?? null,
      setItem: (key: string, value: string) => this.storage.set(key, value),
    });
    this.install(globalThis, "setInterval", (callback: () => void, delay: number) => this.timers.push({ callback, delay }));
    this.install(globalThis, "addEventListener", (name: string, callback: () => void) => this.listeners.set(name, callback));
    this.install(AbortSignal, "timeout", () => new AbortController().signal);
    this.install(globalThis, "fetch", (path: string, init: RequestInit) => {
      if (path === "/api/shares" && !init.method) return Promise.resolve(Response.json({ enabled: true }));
      const pending = Promise.withResolvers<Response>();
      this.requests.push({
        path,
        method: init.method ?? "GET",
        headers: new Headers(init.headers),
        body: init.body,
        resolve: pending.resolve,
        answered: false,
      });
      return pending.promise;
    });
    this.sharing = new Sharing({
      current: () => this.sharing.isWatching ? undefined : this.current,
      stopLocal: () => this.manual(source("Hero", this.current.session + 1)),
      display: (_files, character, refresh) => {
        this.displays.push({ name: character.name, refresh });
        if (this.acceptDisplay && !refresh) this.viewport = { x: 0, y: 0, size: 2560 };
        return Promise.resolve(this.acceptDisplay);
      },
    });
  }

  private install(target: object, key: string, value: unknown) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { configurable: true, writable: true, value });
    this.restorations.push(() => {
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else Reflect.deleteProperty(target, key);
    });
  }

  restore() {
    this.sharing.stop();
    for (const restore of this.restorations.reverse()) restore();
  }

  el(selector: string): ElementStub {
    let element = this.elements.get(selector);
    if (!element) this.elements.set(selector, element = new ElementStub());
    return element;
  }

  // Complete promise/stream work without advancing the fake polling clock.
  async settle() {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  async request(method: string, path: string): Promise<PendingRequest> {
    await this.settle();
    const request = this.requests.find((r) => !r.answered && r.method === method && r.path === `/api/shares${path}`);
    assert(request, `Missing ${method} ${path}`);
    return request;
  }

  async reply(request: PendingRequest, response: Response) {
    request.answered = true;
    request.resolve(response);
    await this.settle();
  }

  stored(): (SharedInfo & { edit?: string })[] {
    return JSON.parse(this.storage.get(storageKey)!);
  }

  open(id = firstId) {
    this.el("#share-link").value = `${this.location.origin}/#share=${id}`;
    this.el("#open-share").dispatchEvent(new Event("submit", { cancelable: true }));
  }

  manual(next = source("Other", this.current.session + 1)) {
    this.sharing.stop();
    this.current = next;
    this.sharing.changed();
  }

  async tick() {
    assertEquals(this.timers.map((timer) => timer.delay), [30_000]);
    this.timers[0].callback();
    await this.settle();
  }

  async data(request: PendingRequest, id = firstId, version = "v1") {
    const save = source(info(id).name);
    await this.reply(request, new Response(await packSave(save.files, save.character) as BodyInit, { headers: { ETag: `"${version}"` } }));
  }

  async snapshot(id = firstId, version = "v1") {
    await this.data(await this.request("GET", `/${id}/data`), id, version);
    await this.reply(await this.request("GET", `/${id}`), Response.json(info(id, version)));
  }
}

Deno.test("sharing client: switching watches cancels a stale response and starts the newer poll without overlap", () =>
  withBrowser(async (b) => {
    b.open();
    const old = await b.request("GET", `/${firstId}/data`);
    b.open(secondId);
    await b.tick();
    assertEquals(b.requests.length, 1);
    let cancelled = false;
    await b.reply(
      old,
      new Response(
        new ReadableStream({
          cancel: () => {
            cancelled = true;
          },
        }),
      ),
    );
    assert(cancelled);
    await b.snapshot(secondId);
    assertEquals(b.displays, [{ name: "Other", refresh: false }]);
    assertEquals(b.stored().map((r) => r.id), [secondId]);
  }));

Deno.test("sharing client: a manual import while metadata is pending cannot display or remember the stale save", () =>
  withBrowser(async (b) => {
    b.open();
    await b.data(await b.request("GET", `/${firstId}/data`));
    const metadata = await b.request("GET", `/${firstId}`);
    b.manual();
    await b.reply(metadata, Response.json(info()));
    assertEquals(b.displays, []);
    assertEquals(b.stored(), []);
    assert(!b.sharing.isWatching);
    assert(b.el("#stop-watch").hidden);
  }));

Deno.test("sharing client: initial display resets, accepted refresh preserves viewport, unchanged/error polls retain the snapshot", () =>
  withBrowser(async (b) => {
    b.open();
    await b.snapshot();
    const viewport = b.viewport = { x: 600, y: 700, size: 512 };
    await b.tick();
    const unchanged = await b.request("GET", `/${firstId}/data`);
    assertEquals(unchanged.headers.get("If-None-Match"), '"v1"');
    await b.reply(unchanged, new Response(null, { status: 304 }));
    assertEquals(b.displays.length, 1);
    await b.tick();
    await b.reply(await b.request("GET", `/${firstId}/data`), Response.json({ error: "Unavailable" }, { status: 503 }));
    assert(b.el("#share-status").classList.contains("error"));
    assert(b.sharing.isWatching);
    assert(b.viewport === viewport);
    await b.tick();
    await b.snapshot(firstId, "v2");
    assertEquals(b.displays, [{ name: "Hero", refresh: false }, { name: "Hero", refresh: true }]);
    assert(b.viewport === viewport);
    b.document.hidden = true;
    const count = b.requests.length;
    await b.tick();
    assertEquals(b.requests.length, count);
  }));

Deno.test("sharing client: failed display does not accept its ETag; expiry stops watching and retains the map", () =>
  withBrowser(async (b) => {
    b.open();
    await b.snapshot();
    const viewport = b.viewport;
    b.acceptDisplay = false;
    await b.tick();
    await b.snapshot(firstId, "v2");
    assert(b.el("#share-status").textContent.includes("could not be displayed"));
    await b.tick();
    const retry = await b.request("GET", `/${firstId}/data`);
    assertEquals(retry.headers.get("If-None-Match"), '"v1"');
    await b.reply(retry, Response.json({ error: "Expired" }, { status: 404 }));
    assert(!b.sharing.isWatching);
    assert(b.viewport === viewport);
    assert(b.el("#follow-control").hidden);
    const count = b.requests.length;
    await b.tick();
    assertEquals(b.requests.length, count);
  }));

Deno.test("sharing client: cancel during packaging prevents an upload; switching session during POST retains its owner key only", () =>
  withBrowser(async (b) => {
    const player = b.current.files.get("Hero/Player.save")!;
    const bytes = await player.read();
    const read = Promise.withResolvers<Uint8Array>();
    player.read = () => read.promise;
    b.el("#share-save").click();
    b.manual();
    read.resolve(bytes);
    await b.settle();
    assertEquals(b.requests.length, 0);
    b.el("#share-save").click();
    const uploading = await b.request("POST", "");
    b.el("#share-save").click();
    assertEquals(b.requests.length, 1);
    assert(uploading.body instanceof Uint8Array);
    assertEquals(unpackSave(uploading.body).name, "Other");
    b.manual(source("Third", 3));
    await b.reply(uploading, Response.json({ ...info(), name: "Other", edit: editKey }));
    assertEquals(b.stored()[0].edit, editKey);
    assert(b.el("#publish-live").disabled);
    assert(!b.el("#publish-live").checked);
    assertEquals(b.el("#share-link").value, "");
    await b.tick();
    assertEquals(b.requests.length, 1);
  }));

Deno.test("sharing client: changing character during POST does not bind publishing to the new character", () =>
  withBrowser(async (b) => {
    b.el("#share-save").click();
    const uploading = await b.request("POST", "");
    b.current = source("Other", b.current.session);
    b.sharing.changed();
    await b.reply(uploading, Response.json({ ...info(), edit: editKey }));
    assertEquals(b.stored()[0].edit, editKey);
    assert(b.el("#publish-live").disabled);
    assert(!b.el("#publish-live").checked);
    await b.tick();
    assertEquals(b.requests.length, 1);
  }));

Deno.test("sharing client: metadata and replacements retain owner keys; publishing requires opt-in and a changed revision", () =>
  withBrowser(async (b) => {
    b.open();
    await b.snapshot();
    assertEquals(b.stored()[0].edit, editKey);
    b.manual(source());
    const replace = b.el("#shared-list").findButton("Replace with selected save");
    assert(replace);
    replace.click();
    const update = await b.request("PUT", `/${firstId}`);
    assertEquals(update.headers.get("Authorization"), `Bearer ${editKey}`);
    await b.reply(update, Response.json(info(firstId, "v2")));
    assertEquals(b.stored()[0].edit, editKey);
    assert(!b.el("#publish-live").disabled);
    const count = b.requests.length;
    ++b.current.revision;
    await b.tick();
    assertEquals(b.requests.length, count);
    b.el("#publish-live").checked = true;
    await b.tick();
    const published = await b.request("PUT", `/${firstId}`);
    await b.tick();
    assertEquals(b.requests.length, count + 1);
    await b.reply(published, Response.json(info(firstId, "v3")));
    await b.tick();
    assertEquals(b.requests.length, count + 1);
    b.current = source("Other", b.current.session);
    b.sharing.changed();
    assert(!b.el("#publish-live").checked);
    assert(b.el("#publish-live").disabled);
  }, [{ ...info(), edit: editKey }]));

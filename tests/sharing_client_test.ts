import { type ShareSource, Sharing } from "../src/sharing.ts";
import { linkKey, packSave, TOKEN, unpackSave, worldId, type WorldInfo } from "../src/sharing-format.ts";
import { assert, assertEquals } from "./assert.ts";

const storageKey = "mirklurk-library-v1";
const keyA = "A".repeat(43), keyB = "E".repeat(43), shareKey = "Q".repeat(43);
const grid = Array.from({ length: 5 }, () => [1, 1, 1, 1, 1]);
const playerBytes = new TextEncoder().encode(JSON.stringify([{ worldGrid: grid }]));
const source = (name = "Hero", session = 1, live = false): ShareSource => ({
  character: { name, root: `${name}/` },
  session,
  revision: 1,
  live,
  files: new Map([[`${name}/Player.save`, { read: () => Promise.resolve(playerBytes), lastModified: 1234 }]]),
});
async function world(name = "Hero", version = "v1", updated = Date.now()): Promise<WorldInfo> {
  return {
    id: await worldId(name, grid),
    name,
    created: updated,
    updated,
    expires: updated + 30 * 86_400_000,
    version,
    size: 100,
    share: name === "Hero" ? shareKey : "U".repeat(43),
  };
}

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
    if (name === "hidden") this.hidden = true;
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
  select() {}
  find(match: (element: ElementStub) => boolean): ElementStub | undefined {
    if (match(this)) return this;
    for (const child of this.children) {
      const found = typeof child !== "string" && child.find(match);
      if (found) return found;
    }
  }
  button(label: string): ElementStub {
    const found = this.find((e) => e.tag === "button" && e.textContent === label);
    assert(found, `Missing button ${label}`);
    return found;
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

async function withBrowser(run: (browser: BrowserStub) => Promise<void>, stored?: object, hash = "") {
  const browser = new BrowserStub(stored, hash);
  try {
    await run(browser);
  } finally {
    browser.restore();
  }
}

class BrowserStub {
  private restorations: (() => void)[] = [];
  private elements = new Map<string, ElementStub>();
  private timers: (() => void)[] = [];
  private listeners = new Map<string, () => void>();
  readonly storage = new Map<string, string>();
  readonly document = {
    hidden: false,
    activeElement: undefined,
    querySelector: (selector: string) => this.el(selector),
    createElement: (tag: string) => new ElementStub(tag),
    createElementNS: (_namespace: string, tag: string) => new ElementStub(tag),
  };
  readonly location = { origin: "https://map.example", pathname: "/", search: "", hash: "" };
  readonly requests: PendingRequest[] = [];
  readonly displays: { name: string; refresh: boolean }[] = [];
  /** Library listings answered immediately, by sync key; other requests wait for `reply`. */
  readonly server = new Map<string, { name: string; worlds: WorldInfo[] }>();
  clipboard = "";
  confirmAnswer = true;
  readonly confirms: string[] = [];
  current?: ShareSource;
  acceptDisplay = true;
  readonly sharing: Sharing;

  constructor(stored: object | undefined, hash: string) {
    if (stored) this.storage.set(storageKey, JSON.stringify(stored));
    this.location.hash = hash;
    this.install(globalThis, "document", this.document);
    this.install(globalThis, "location", this.location);
    this.install(globalThis, "history", {
      replaceState: (_state: unknown, _title: string, url: string) => this.location.hash = new URL(url, this.location.origin).hash,
    });
    this.install(globalThis, "localStorage", {
      getItem: (key: string) => this.storage.get(key) ?? null,
      setItem: (key: string, value: string) => this.storage.set(key, value),
      removeItem: (key: string) => this.storage.delete(key),
    });
    this.install(globalThis, "navigator", { clipboard: { writeText: (text: string) => Promise.resolve(void (this.clipboard = text)) } });
    this.install(globalThis, "confirm", (message: string) => {
      this.confirms.push(message);
      return this.confirmAnswer;
    });
    this.install(globalThis, "setInterval", (callback: () => void) => this.timers.push(callback));
    this.install(globalThis, "addEventListener", (name: string, callback: () => void) => this.listeners.set(name, callback));
    this.install(AbortSignal, "timeout", () => new AbortController().signal);
    this.install(globalThis, "fetch", (path: string, init: RequestInit) => {
      const method = init.method ?? "GET";
      const headers = new Headers(init.headers);
      const key = headers.get("Authorization")!.replace("Bearer ", "");
      if (path === "/api/library" && method === "GET") {
        const library = this.server.get(key) ?? { name: "", worlds: [] };
        return Promise.resolve(Response.json({ ...library, limits: { worldsPerLibrary: 5, retentionDays: 30 } }));
      }
      const pending = Promise.withResolvers<Response>();
      this.requests.push({ path, method, headers, body: init.body, resolve: pending.resolve, answered: false });
      return pending.promise;
    });
    this.sharing = new Sharing({
      current: () => this.sharing.isWatching ? undefined : this.current,
      stopLocal: () => {
        this.current = undefined;
        this.sharing.stop();
        this.sharing.changed();
      },
      display: (_files, character, refresh) => {
        this.displays.push({ name: character.name, refresh });
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

  // Complete promise, hashing and stream work without advancing the fake polling clock.
  async settle() {
    for (let i = 0; i < 10; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  async init() {
    await this.sharing.init();
    await this.settle();
  }

  async request(method: string, path: string): Promise<PendingRequest> {
    await this.settle();
    const request = this.requests.find((r) => !r.answered && r.method === method && r.path === `/api${path}`);
    assert(request, `Missing ${method} ${path}; have ${this.requests.filter((r) => !r.answered).map((r) => `${r.method} ${r.path}`)}`);
    return request;
  }

  pending() {
    return this.requests.filter((r) => !r.answered).length;
  }

  async reply(request: PendingRequest, response: Response) {
    request.answered = true;
    request.resolve(response);
    await this.settle();
  }

  async data(request: PendingRequest, name = "Hero", version = "v1") {
    const save = source(name);
    await this.reply(request, new Response(await packSave(save.files, save.character) as BodyInit, { headers: { ETag: `"${version}"` } }));
  }

  stored(): { current: { key: string; name: string }; saved: { key: string; name: string }[]; opened?: string; auto: boolean } {
    return JSON.parse(this.storage.get(storageKey)!);
  }

  status() {
    return this.el("#share-status").textContent;
  }

  async load(next: ShareSource | undefined) {
    this.sharing.stop();
    this.current = next;
    this.sharing.changed();
    await this.settle();
  }

  async tick() {
    assertEquals(this.timers.length, 1);
    this.timers[0]();
    await this.settle();
  }
}

Deno.test("sharing client: a first visit remembers a new private library without showing its key", () =>
  withBrowser(async (b) => {
    await b.init();
    const { current, saved, auto } = b.stored();
    assert(TOKEN.test(current.key));
    assertEquals([current.name, saved, auto], ["", [], true]);
    assertEquals(b.el("#library-usage").textContent, "0 of 5 worlds. Each is kept 30 days after its last update.");
    assert(b.el("#save-world").disabled);
    assertEquals(b.displays, []);
    assertEquals(b.pending(), 0);
  }));

Deno.test("sharing client: a returning browser reopens the world it followed last, falling back to the newest", async () =>
  withBrowser(async (b) => {
    const older = await world("Hero", "v1", Date.now() - 60_000), newer = await world("Other");
    b.server.set(keyA, { name: "Dante", worlds: [newer, older] });
    await b.init();
    const download = await b.request("GET", `/library/worlds/${older.id}/data`);
    assertEquals(download.headers.get("Authorization"), `Bearer ${keyA}`);
    await b.data(download);
    assertEquals(b.displays, [{ name: "Hero", refresh: false }]);
    assert(b.sharing.isWatching);
    assert(!b.el("#viewing").hidden);
    assertEquals(b.el("#viewing-text").textContent, "Following Hero from your library (updated just now).");
    assertEquals(b.el("#library-name").value, "Dante");
    assertEquals(b.el("#world-list").children.length, 2);
  }, { current: { key: keyA, name: "" }, saved: [], opened: await worldId("Hero", grid), auto: true }));

Deno.test("sharing client: adding uploads the selected character; the same world then updates, and refusals are shown", () =>
  withBrowser(async (b) => {
    await b.init();
    await b.load(source());
    assertEquals(b.el("#save-world").textContent, "Add Hero to my worlds");
    b.el("#save-world").click();
    const add = await b.request("PUT", `/library/worlds/${await worldId("Hero", grid)}`);
    assertEquals(add.headers.get("If-Match"), null);
    assertEquals(add.headers.get("Authorization"), `Bearer ${keyA}`);
    assertEquals(unpackSave(add.body as Uint8Array).name, "Hero");
    b.el("#save-world").click();
    assertEquals(b.pending(), 1);
    await b.reply(add, Response.json(await world(), { status: 201 }));
    assert(b.status().startsWith("Added Hero."));
    assertEquals(b.el("#save-world").textContent, "Update Hero in my worlds");
    assertEquals(b.el("#world-list").children.length, 1);
    assertEquals(b.el("#world-list").find((e) => e.textContent === "this save")?.tag, "span");

    b.el("#save-world").click();
    const update = await b.request("PUT", `/library/worlds/${await worldId("Hero", grid)}`);
    assertEquals(update.headers.get("If-Match"), "*");
    await b.reply(
      update,
      Response.json({ error: "This save is a different world from the one it would update, so nothing was changed" }, { status: 409 }),
    );
    assertEquals(b.status(), "Could not update Hero: This save is a different world from the one it would update, so nothing was changed");
    assert(b.el("#share-status").classList.contains("error"));

    await b.load(source("Other", 2));
    assertEquals(b.el("#save-world").textContent, "Add Other to my worlds");
    b.el("#save-world").click();
    await b.reply(
      await b.request("PUT", `/library/worlds/${await worldId("Other", grid)}`),
      Response.json({ error: "Your library is full (5 of 5 worlds). Delete a world to add this one." }, { status: 409 }),
    );
    assertEquals(b.status(), "Could not add Other: Your library is full (5 of 5 worlds). Delete a world to add this one.");
  }, { current: { key: keyA, name: "" }, saved: [], auto: true }));

Deno.test("sharing client: changing the source while packaging cancels the upload", () =>
  withBrowser(async (b) => {
    await b.init();
    await b.load(source());
    const player = b.current!.files.get("Hero/Player.save")!;
    const read = Promise.withResolvers<Uint8Array>();
    player.read = () => read.promise;
    b.el("#save-world").click();
    await b.load(source("Other", 2));
    read.resolve(playerBytes);
    await b.settle();
    assertEquals(b.pending(), 0);
  }, { current: { key: keyA, name: "" }, saved: [], auto: true }));

Deno.test("sharing client: a sync link joins that library, keeps the previous one, and leaves the address bar", () =>
  withBrowser(
    async (b) => {
      const shared = await world();
      b.server.set(keyA, { name: "Laptop", worlds: [await world("Other")] });
      b.server.set(keyB, { name: "Dante", worlds: [shared] });
      await b.init();
      assertEquals(b.location.hash, "");
      assertEquals(b.confirms, [
        "Sync this browser with Dante (Hero)?\n\nOnly continue if you made this link yourself on one of your own devices: " +
        "whoever made it can see and change every world you add or update here.\n\n" +
        "Your current library, Laptop, will be saved so you can switch back.",
      ]);
      assertEquals(b.stored().current, { key: keyB, name: "Dante" });
      assertEquals(b.stored().saved, [{ key: keyA, name: "Laptop" }]);
      assertEquals(b.status(), "This browser now syncs Dante. Your previous library, Laptop, is saved below; switch back any time.");
      const download = await b.request("GET", `/library/worlds/${shared.id}/data`);
      assertEquals(download.headers.get("Authorization"), `Bearer ${keyB}`);
      await b.data(download);
      assertEquals(b.displays, [{ name: "Hero", refresh: false }]);

      assert(!b.el("#saved-libraries").hidden);
      b.el("#library-list").button("Switch to this library").click();
      await b.settle();
      assertEquals(b.stored().current, { key: keyA, name: "Laptop" });
      assertEquals(b.stored().saved, [{ key: keyB, name: "Dante" }]);
      assertEquals(b.el("#library-name").value, "Laptop");
      const resumed = await b.request("GET", `/library/worlds/${(await world("Other")).id}/data`);
      assertEquals(resumed.headers.get("Authorization"), `Bearer ${keyA}`);

      b.confirmAnswer = false;
      b.el("#library-list").button("Remove from this browser").click();
      assertEquals(b.stored().saved.length, 1);
      b.confirmAnswer = true;
      b.el("#library-list").button("Remove from this browser").click();
      assertEquals(b.stored().saved, []);
      assert(b.el("#saved-libraries").hidden);
    },
    { current: { key: keyA, name: "Laptop" }, saved: [], auto: true },
    `#s=${linkKey(keyB)}`,
  ));

Deno.test("sharing client: an empty, unnamed library is replaced by a sync link instead of being kept", () =>
  withBrowser(
    async (b) => {
      await b.init();
      assertEquals(b.stored().current, { key: keyB, name: "" });
      assertEquals(b.stored().saved, []);
      assertEquals(b.status(), "This browser now syncs the same worlds as your other device.");
      assert(b.el("#saved-libraries").hidden);
    },
    undefined,
    `#s=${linkKey(keyB)}`,
  ));

Deno.test("sharing client: a truncated sync link is reported and changes nothing", () =>
  withBrowser(
    async (b) => {
      await b.init();
      assertEquals(b.status(), "This sync link is incomplete. Copy the whole link again.");
      assertEquals(b.stored().current, { key: keyA, name: "" });
      assertEquals(b.location.hash, "");
      assertEquals(b.confirms, []);
    },
    { current: { key: keyA, name: "" }, saved: [], auto: true },
    `#s=${linkKey(keyB).slice(0, 70)}`,
  ));

Deno.test("sharing client: declining a sync link keeps this browser's own library and still removes the link", () =>
  withBrowser(
    async (b) => {
      const mine = await world("Other");
      b.server.set(keyA, { name: "Mine", worlds: [mine] });
      b.confirmAnswer = false;
      await b.init();
      assert(b.confirms[0].startsWith("Sync this browser with an unnamed library (no worlds yet)?"));
      assertEquals(b.location.hash, "");
      assertEquals(b.stored().current, { key: keyA, name: "Mine" });
      assertEquals(b.stored().saved, []);
      assertEquals(b.status(), "Sync link ignored. This browser keeps its own library.");
      const download = await b.request("GET", `/library/worlds/${mine.id}/data`);
      assertEquals(download.headers.get("Authorization"), `Bearer ${keyA}`);
    },
    { current: { key: keyA, name: "Mine" }, saved: [], auto: true },
    `#s=${linkKey(keyB)}`,
  ));

Deno.test("sharing client: a share link follows one world read-only and never touches the viewer's library", () =>
  withBrowser(
    async (b) => {
      b.server.set(keyA, { name: "Mine", worlds: [await world("Other")] });
      await b.init();
      const download = await b.request("GET", "/view/data");
      assertEquals(download.headers.get("Authorization"), `Bearer ${shareKey}`);
      await b.data(download);
      assertEquals(b.displays, [{ name: "Hero", refresh: false }]);
      assertEquals(b.stored().current, { key: keyA, name: "Mine" });
      assertEquals(
        b.el("#viewing-text").textContent,
        "Viewing Hero, shared with you read-only (updated just now). Your own worlds are unchanged.",
      );
      assert(b.el("#save-world").disabled);
      assertEquals(b.location.hash, `#v=${linkKey(shareKey)}`);
      b.el("#stop-watch").click();
      assert(!b.sharing.isWatching);
      assertEquals(b.location.hash, "");
    },
    { current: { key: keyA, name: "Mine" }, saved: [], auto: true },
    `#v=${linkKey(shareKey)}`,
  ));

Deno.test("sharing client: Live saves keep an added world updated once per change, and only while enabled", () =>
  withBrowser(async (b) => {
    const added = await world();
    b.server.set(keyA, { name: "", worlds: [added] });
    await b.init();
    assertEquals(b.pending(), 1);
    await b.reply(await b.request("GET", `/library/worlds/${added.id}/data`), Response.json({ error: "gone" }, { status: 503 }));
    await b.load(source("Hero", 2, true));
    await b.tick();
    const update = await b.request("PUT", `/library/worlds/${added.id}`);
    assertEquals(update.headers.get("If-Match"), "*");
    await b.reply(update, Response.json(await world("Hero", "v2")));
    assert(b.status().startsWith("Updated Hero automatically"));
    await b.tick();
    assertEquals(b.pending(), 0);
    ++b.current!.revision;
    await b.tick();
    const tooSoon = await b.request("PUT", `/library/worlds/${added.id}`);
    await b.reply(tooSoon, Response.json({ error: "Wait 30 seconds between updates of a world" }, { status: 429 }));
    assert(!b.el("#share-status").classList.contains("error"));
    await b.tick();
    await b.reply(await b.request("PUT", `/library/worlds/${added.id}`), Response.json(await world("Hero", "v3")));
    ++b.current!.revision;
    b.el("#auto-update").checked = false;
    b.el("#auto-update").dispatchEvent(new Event("change"));
    assertEquals(b.stored().auto, false);
    await b.tick();
    assertEquals(b.pending(), 0);

    b.el("#auto-update").checked = true;
    b.el("#auto-update").dispatchEvent(new Event("change"));
    await b.load(source("Other", 3, true));
    await b.tick();
    assertEquals(b.pending(), 0);
    await b.load(source("Hero", 4));
    await b.tick();
    assertEquals(b.pending(), 0);

    // Deleted on another device while this tab still listed it: the update is refused, never re-added.
    await b.load(source("Hero", 5, true));
    await b.tick();
    const deleted = await b.request("PUT", `/library/worlds/${added.id}`);
    b.server.set(keyA, { name: "", worlds: [] });
    await b.reply(deleted, Response.json({ error: "This world is no longer in your library" }, { status: 412 }));
    assertEquals(b.status(), "Hero was removed from your library on another device, so it is no longer updated automatically.");
    assertEquals(b.el("#save-world").textContent, "Add Hero to my worlds");
    ++b.current!.revision;
    await b.tick();
    assertEquals(b.pending(), 0);
  }, { current: { key: keyA, name: "" }, saved: [], auto: true }));

Deno.test("sharing client: following polls with ETags, a stale response is cancelled, and deletion elsewhere keeps the map", () =>
  withBrowser(async (b) => {
    const hero = await world(), other = await world("Other", "v1", Date.now() - 1000);
    b.server.set(keyA, { name: "", worlds: [hero, other] });
    await b.init();
    const stale = await b.request("GET", `/library/worlds/${hero.id}/data`);
    b.el("#world-list").find((e) => e.tag === "li" && e.textContent.startsWith("Other"))!.button("Open").click();
    await b.tick();
    let cancelled = false;
    await b.reply(stale, new Response(new ReadableStream({ cancel: () => void (cancelled = true) })));
    assert(cancelled);
    await b.data(await b.request("GET", `/library/worlds/${other.id}/data`), "Other");
    assertEquals(b.displays, [{ name: "Other", refresh: false }]);
    assertEquals(b.stored().opened, other.id);

    await b.tick();
    const unchanged = await b.request("GET", `/library/worlds/${other.id}/data`);
    assertEquals(unchanged.headers.get("If-None-Match"), '"v1"');
    await b.reply(unchanged, new Response(null, { status: 304 }));
    await b.tick();
    await b.reply(await b.request("GET", `/library/worlds/${other.id}/data`), Response.json({ error: "Busy" }, { status: 503 }));
    assert(b.el("#share-status").classList.contains("error"));
    assert(b.sharing.isWatching);
    await b.tick();
    await b.data(await b.request("GET", `/library/worlds/${other.id}/data`), "Other", "v2");
    assertEquals(b.status(), "");
    assertEquals(b.displays, [{ name: "Other", refresh: false }, { name: "Other", refresh: true }]);
    b.document.hidden = true;
    await b.tick();
    assertEquals(b.pending(), 0);
    b.document.hidden = false;
    await b.tick();
    await b.reply(
      await b.request("GET", `/library/worlds/${other.id}/data`),
      Response.json({ error: "This world was deleted or expired" }, { status: 404 }),
    );
    assert(!b.sharing.isWatching);
    assert(b.el("#follow-control").hidden);
    assertEquals(b.status(), "Could not refresh Other: This world was deleted or expired. The last snapshot stays on screen.");
    assertEquals(b.displays.length, 2);
  }, { current: { key: keyA, name: "" }, saved: [], auto: true }));

Deno.test("sharing client: share and sync cards show a QR code and copy links; deleting asks first", () =>
  withBrowser(async (b) => {
    const hero = await world();
    b.server.set(keyA, { name: "", worlds: [hero] });
    await b.init();
    await b.reply(await b.request("GET", `/library/worlds/${hero.id}/data`), Response.json({ error: "busy" }, { status: 503 }));
    b.el("#world-list").button("Share...").click();
    const card = b.el("#share-card");
    assert(!card.hidden);
    assert(card.find((e) => e.tag === "svg"));
    assertEquals(card.find((e) => e.tag === "h3")?.textContent, "Share Hero (read-only)");
    card.button("Copy link").click();
    await b.settle();
    assertEquals(b.clipboard, `https://map.example/#v=${linkKey(shareKey)}`);
    card.button("Reset link").click();
    const reset = await b.request("POST", `/library/worlds/${hero.id}/share`);
    await b.reply(reset, Response.json({ ...hero, share: "M".repeat(43) }));
    assert(b.status().startsWith("New share link ready for Hero."));
    card.button("Copy link").click();
    await b.settle();
    assertEquals(b.clipboard, `https://map.example/#v=${linkKey("M".repeat(43))}`);
    b.el("#sync-device").click();
    assertEquals(card.find((e) => e.tag === "h3")?.textContent, "Sync another device");
    card.button("Copy link").click();
    await b.settle();
    assertEquals(b.clipboard, `https://map.example/#s=${linkKey(keyA)}`);
    assert(!JSON.stringify(card.textContent).includes(keyA));
    card.button("Close").click();
    assert(card.hidden);

    b.confirmAnswer = false;
    b.el("#world-list").button("Delete").click();
    await b.settle();
    assertEquals(b.pending(), 0);
    b.confirmAnswer = true;
    b.el("#world-list").button("Delete").click();
    await b.reply(await b.request("DELETE", `/library/worlds/${hero.id}`), new Response(null, { status: 204 }));
    assertEquals(b.el("#world-list").children.length, 0);
    assert(b.status().startsWith("Deleted Hero."));
  }, { current: { key: keyA, name: "" }, saved: [], auto: true }));

Deno.test("sharing client: renaming the library saves the friendly name for every synced device", () =>
  withBrowser(async (b) => {
    await b.init();
    b.el("#library-name").value = "  Dante's PCs ";
    b.el("#library-name").dispatchEvent(new Event("change"));
    const rename = await b.request("PATCH", "/library");
    assertEquals(rename.headers.get("Content-Type"), "application/json");
    assertEquals(JSON.parse(rename.body as string), { name: "Dante's PCs" });
    await b.reply(rename, Response.json({ name: "Dante's PCs" }));
    assertEquals(b.stored().current.name, "Dante's PCs");
    b.el("#library-name").value = "x".repeat(41);
    b.el("#library-name").dispatchEvent(new Event("change"));
    await b.settle();
    assertEquals(b.pending(), 0);
    assert(b.el("#share-status").classList.contains("error"));
  }, { current: { key: keyA, name: "" }, saved: [], auto: true }));

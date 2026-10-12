import { type ShareSource, Sharing } from "../src/sharing.ts";
import {
  linkKey,
  openPairing,
  packSave,
  PAIR_TTL,
  pairId,
  sealPairing,
  TOKEN,
  unpackSave,
  worldId,
  type WorldInfo,
} from "../src/sharing-format.ts";
import { readZip } from "../src/zip.ts";
import { readMarker } from "../src/marker.ts";
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

/** Where focus() reports to; set by the BrowserStub in use. */
let focusing: ((element: ElementStub) => void) | undefined;
/** Disabling the focused element moves focus away from it, as browsers do. */
let blurring: ((element: ElementStub) => void) | undefined;
/** Told when a modal dialog opens; set by the BrowserStub in use. */
let showing: ((dialog: ElementStub) => void) | undefined;

/** Only the DOM surface used by Sharing; events still use real EventTarget dispatch. */
class ElementStub extends EventTarget {
  children: (ElementStub | string)[] = [];
  parent?: ElementStub;
  readonly attributes = new Map<string, string>();
  private off = false;
  checked = false;
  hidden = false;
  open = false;
  value = "";
  returnValue = "";
  download?: string;
  href?: string;
  private text = "";
  private classes = new Set<string>();
  classList = {
    toggle: (name: string, on: boolean) => on ? this.classes.add(name) : this.classes.delete(name),
    contains: (name: string) => this.classes.has(name),
  };
  constructor(readonly tag = "div") {
    super();
  }
  get disabled() {
    return this.off;
  }
  set disabled(value: boolean) {
    this.off = value;
    if (value) blurring?.(this);
  }
  get textContent(): string {
    return this.text + this.children.map((c) => typeof c === "string" ? c : c.textContent).join("");
  }
  set textContent(text: string) {
    this.text = text;
    this.children = [];
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name === "disabled") this.disabled = true;
    if (name === "hidden") this.hidden = true;
    if (name === "value") this.value = value;
  }
  append(child: ElementStub | string) {
    if (typeof child !== "string") child.parent = this;
    this.children.push(child);
  }
  replaceChildren(...children: ElementStub[]) {
    this.text = "";
    this.children = children;
  }
  click() {
    if (!this.disabled) this.dispatchEvent(new Event("click"));
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = undefined;
  }
  select() {}
  focus() {
    focusing?.(this);
  }
  /** A native modal <dialog>: open, with focus on its autofocus control. */
  showModal() {
    this.open = true;
    this.find((e) => e.attributes.has("autofocus"))?.focus();
    showing?.(this);
  }
  /** This element and everything in it, in document order. */
  all(): ElementStub[] {
    return [this, ...this.children.flatMap((c) => typeof c === "string" ? [] : c.all())];
  }
  close(value?: string) {
    if (!this.open) return;
    this.open = false;
    if (value !== undefined) this.returnValue = value;
    this.dispatchEvent(new Event("close"));
  }
  /** What Escape does to an open modal dialog. */
  escape() {
    if (this.dispatchEvent(new Event("cancel", { cancelable: true }))) this.close();
  }
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
  /** The page body: download links and dialogs are appended here. */
  readonly body = new ElementStub("body");
  readonly document = {
    hidden: false,
    activeElement: undefined as ElementStub | undefined,
    querySelector: (selector: string) => this.el(selector),
    createElement: (tag: string) => new ElementStub(tag),
    createElementNS: (_namespace: string, tag: string) => new ElementStub(tag),
    body: {
      append: (element: ElementStub) => {
        if (element.tag === "a") this.links.push(element);
        this.body.append(element);
      },
    },
  };
  /** Links handed to the browser to download, and the blobs behind their blob: URLs. */
  readonly links: ElementStub[] = [];
  readonly blobs = new Map<string, Blob>();
  readonly location = { origin: "https://map.example", pathname: "/", search: "", hash: "" };
  readonly requests: PendingRequest[] = [];
  readonly displays: { name: string; refresh: boolean }[] = [];
  /** Library listings answered immediately, by sync key; other requests wait for `reply`. */
  readonly server = new Map<string, { name: string; worlds: WorldInfo[] }>();
  clipboard = "";
  /** Every request fails as if the network were gone. */
  down = false;
  /** Questions (src/dialog.ts) are answered as they open, confirmed while `confirmAnswer` holds; off, a test answers them itself. */
  autoAnswer = true;
  confirmAnswer = true;
  /** What each question answered so far said: its title, then its paragraphs. */
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
    // The page never uses the browser's own confirm(); a call fails the test.
    this.install(globalThis, "confirm", () => {
      throw new Error("confirm() was called");
    });
    showing = (dialog) => {
      if (!this.autoAnswer) return;
      this.confirms.push(dialog.all().filter((e) => e.tag === "h2" || e.tag === "p").map((e) => e.textContent).join("\n\n"));
      const answer = this.confirmAnswer ? "confirm" : "cancel";
      dialog.all().find((e) => e.tag === "button" && e.attributes.get("value") === answer)!.click();
    };
    this.restorations.push(() => showing = undefined);
    this.install(globalThis, "setInterval", (callback: () => void) => this.timers.push(callback));
    focusing = (element) => this.document.activeElement = element;
    blurring = (element) => this.document.activeElement === element && (this.document.activeElement = this.body);
    this.restorations.push(() => focusing = blurring = undefined);
    // Long timers (such as revoking a download's blob: URL) never fire in a test; short ones still settle promises.
    const setTimeout = globalThis.setTimeout;
    this.install(globalThis, "setTimeout", (callback: () => void, ms = 0) => ms >= 1000 ? 0 : setTimeout(callback, ms));
    this.install(URL, "createObjectURL", (blob: Blob) => {
      const url = `blob:${this.location.origin}/${this.blobs.size}`;
      this.blobs.set(url, blob);
      return url;
    });
    this.install(URL, "revokeObjectURL", () => {});
    this.install(globalThis, "addEventListener", (name: string, callback: () => void) => this.listeners.set(name, callback));
    this.install(AbortSignal, "timeout", () => new AbortController().signal);
    this.install(globalThis, "fetch", (path: string, init: RequestInit) => {
      if (this.down) return Promise.reject(new TypeError("Failed to fetch"));
      const method = init.method ?? "GET";
      const headers = new Headers(init.headers);
      const key = headers.get("Authorization")?.replace("Bearer ", "");
      if (key && path === "/api/library" && method === "GET") {
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

  /** Waits for packaging (file reads and compression) to hand the browser `count` downloads in all. */
  async downloaded(count: number) {
    for (let i = 0; i < 50 && this.links.length < count; i++) await this.settle();
    assertEquals(this.links.length, count);
    await this.settle();
  }

  /** The modal dialog on the page, if one is open. */
  dialog(): ElementStub | undefined {
    return this.body.children.find((e): e is ElementStub => typeof e !== "string" && e.tag === "dialog" && e.open);
  }

  async fire(event: string) {
    this.listeners.get(event)!();
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
      await b.settle();
      assertEquals(b.stored().saved.length, 1);
      b.confirmAnswer = true;
      b.el("#library-list").button("Remove from this browser").click();
      await b.settle();
      assertEquals(b.stored().saved, []);
      assertEquals(b.confirms.slice(1), [
        "Remove Dante from this browser?\n\nIts worlds stay online until they expire, but only a device that still syncs it can bring it back here.",
        "Remove Dante from this browser?\n\nIts worlds stay online until they expire, but only a device that still syncs it can bring it back here.",
      ]);
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

Deno.test("sharing client: a shared world downloads as a playable save marked From Share, after a warning dialog", () =>
  withBrowser(
    async (b) => {
      await b.init();
      assert(b.el("#download-world").disabled);
      // The sharer's own MirkMap.json keys (here a save editor's) survive the download.
      const files = new Map(source().files);
      files.set("Hero/MirkMap.json", { read: () => Promise.resolve(new TextEncoder().encode('{"cheated":true}')) });
      const packed = await packSave(files, { name: "Hero", root: "Hero/" });
      await b.reply(await b.request("GET", "/view/data"), new Response(packed as BodyInit, { headers: { ETag: '"v1"' } }));
      assert(!b.el("#download-world").disabled);

      // A modal dialog asks first: focus moves into it, and Escape declines and puts focus back.
      b.autoAnswer = false;
      const trigger = b.el("#download-world");
      trigger.focus();
      trigger.click();
      const dialog = b.dialog();
      assert(dialog, "no dialog opened");
      const title = dialog.find((e) => e.tag === "h2")!;
      assertEquals(title.textContent, "Download Hero to play it?");
      assertEquals(dialog.attributes.get("aria-labelledby"), title.attributes.get("id"));
      assert(
        dialog.textContent.includes("It downloads as Hero (From Share).zip, and MirkMap marks it S (From Share)."),
        dialog.textContent,
      );
      const warning = dialog.find((e) => e.tag === "p" && e.attributes.get("class") === "warning");
      assertEquals(
        warning?.textContent,
        "If your game's Saves folder already has a character called Hero, putting this one there overwrites it.",
      );
      assert(dialog.textContent.includes("To keep both, rename one of the two folders first"), dialog.textContent);
      assert(b.document.activeElement === dialog.button("Download"), "focus is on Download");
      dialog.escape();
      await b.settle();
      assertEquals(b.dialog(), undefined);
      assert(!b.body.children.includes(dialog), "a closed dialog is removed");
      assert(b.document.activeElement === trigger, "focus is back on Download save");
      assertEquals(b.links.length, 0);

      // Cancel declines too.
      trigger.click();
      b.dialog()!.button("Cancel").click();
      await b.settle();
      assertEquals([b.dialog(), b.links.length], [undefined, 0]);

      trigger.click();
      b.dialog()!.button("Download").click();
      await b.downloaded(1);
      assert(b.document.activeElement === trigger, "focus is back on Download save");
      assertEquals(b.confirms, []);
      // The snapshot on screen is what downloads, so nothing is fetched again.
      assertEquals(b.pending(), 0);
      assertEquals(b.links.map((l) => l.download), ["Hero (From Share).zip"]);
      const entries = await readZip(b.blobs.get(b.links[0].href!)!);
      assertEquals(entries.map((e) => e.name), ["Hero/Player.save", "Hero/MirkMap.json"]);
      assertEquals([...await entries[0].read()], [...playerBytes]);
      const marker = readMarker(new TextDecoder().decode(await entries[1].read()));
      assertEquals(Object.keys(marker), ["cheated", "fromShare", "shareDownloaded"]);
      assertEquals([marker.cheated, marker.fromShare], [true, true]);
      assert(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(String(marker.shareDownloaded)), String(marker.shareDownloaded));
      assert(b.status().startsWith("Downloaded Hero (From Share).zip. To play it, put its Hero folder into the game's Saves folder"));
      assert(b.status().includes("that character would be overwritten: rename one of the folders first"), b.status());
      assert(!b.el("#share-status").classList.contains("error"));
    },
    { current: { key: keyA, name: "" }, saved: [], auto: true },
    `#v=${linkKey(shareKey)}`,
  ));

Deno.test("sharing client: library worlds from a share show an S badge, and any library world downloads unmarked", () =>
  withBrowser(async (b) => {
    const mine = await world("Other"), copy: WorldInfo = { ...await world("Hero", "v1", Date.now() - 60_000), fromShare: true };
    b.server.set(keyA, { name: "", worlds: [mine, copy] });
    await b.init();
    const [first, second] = b.el("#world-list").children as ElementStub[];
    assertEquals(first.find((e) => e.tag === "abbr"), undefined);
    assertEquals(second.find((e) => e.tag === "abbr")?.textContent, "S");
    assert(second.textContent.startsWith("Hero S (From Share)"), second.textContent);

    second.button("Download").click();
    const data = await b.request("GET", `/library/worlds/${copy.id}/data`);
    assertEquals(data.headers.get("Authorization"), `Bearer ${keyA}`);
    await b.data(data);
    await b.downloaded(1);
    assertEquals(b.links.map((l) => l.download), ["Hero.zip"]);
    assertEquals((await readZip(b.blobs.get(b.links[0].href!)!)).map((e) => e.name), ["Hero/Player.save"]);
    assert(b.status().includes("If Saves already has an older Hero folder, move it out first"), b.status());

    // The world that is open downloads what is on screen.
    await b.data(await b.request("GET", `/library/worlds/${mine.id}/data`), "Other");
    (b.el("#world-list").children[0] as ElementStub).button("Download").click();
    await b.downloaded(2);
    assertEquals(b.pending(), 0);
    assertEquals(b.links.map((l) => l.download), ["Hero.zip", "Other.zip"]);
    assertEquals(b.confirms, []);
  }, { current: { key: keyA, name: "" }, saved: [], auto: true }));

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
    await b.reply(await b.request("POST", "/library/pair"), Response.json({ expiresIn: 600 }, { status: 201 }));
    card.button("Copy link").click();
    await b.settle();
    assertEquals(b.clipboard, `https://map.example/#s=${linkKey(keyA)}`);
    assert(!JSON.stringify(card.textContent).includes(keyA));
    card.button("Close").click();
    assert(card.hidden);
    await b.reply(await b.request("DELETE", "/library/pair"), new Response(null, { status: 204 }));

    // A destructive question: an alertdialog described by its body, red Delete, and focus on Cancel so Enter alone deletes nothing.
    b.autoAnswer = false;
    b.el("#world-list").button("Delete").click();
    await b.settle();
    const question = b.dialog()!;
    assertEquals(question.attributes.get("role"), "alertdialog");
    const described = question.all().find((e) => e.attributes.get("id") === question.attributes.get("aria-describedby"));
    assertEquals(described?.textContent, "It disappears from all your synced devices, and its share link stops working.");
    assert(question.button("Delete").attributes.get("class")!.includes("danger"));
    assert(b.document.activeElement === question.button("Cancel"), "focus starts on Cancel");
    question.escape();
    await b.settle();
    assertEquals([b.dialog(), b.pending()], [undefined, 0]);
    b.autoAnswer = true;

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

async function enter(b: BrowserStub, text: string) {
  b.el("#join-code").value = text;
  b.el("#join-form").dispatchEvent(new Event("submit", { cancelable: true }));
  await b.settle();
}

Deno.test("sharing client: a one-time sync code joins its library after confirming; wrong codes change nothing", () =>
  withBrowser(async (b) => {
    b.server.set(keyA, { name: "Phone", worlds: [] });
    b.server.set(keyB, { name: "Dante", worlds: [] });
    await b.init();
    await enter(b, "not a code!");
    assertEquals(b.status(), "Enter the 8-character sync code from your other device, or paste a whole sync or share link.");
    assertEquals(b.pending(), 0);

    await enter(b, " k7m2-9qxr ");
    const wrong = await b.request("POST", "/pair");
    assertEquals(wrong.headers.get("Authorization"), null);
    assertEquals(wrong.headers.get("Content-Type"), "application/json");
    assertEquals(JSON.parse(wrong.body as string), { id: await pairId("K7M29QXR") });
    await b.reply(wrong, Response.json({ error: "This sync code is wrong" }, { status: 404 }));
    assert(b.status().startsWith("That sync code is wrong, was already used, or expired."), b.status());
    assert(b.el("#share-status").classList.contains("error"));
    assertEquals(b.el("#join-code").value, " k7m2-9qxr ");

    await enter(b, "K7M2-9QXR");
    await b.reply(await b.request("POST", "/pair"), Response.json({ box: (await sealPairing("K7M29QXS", keyB)).box }));
    assertEquals(b.status(), "Could not use the sync code: it does not match the library it was made for");
    assertEquals(b.confirms, []);

    b.confirmAnswer = false;
    await enter(b, "K7M2-9QXR");
    await b.reply(await b.request("POST", "/pair"), Response.json({ box: (await sealPairing("K7M29QXR", keyB)).box }));
    assertEquals(b.status(), "Sync code ignored. This browser keeps its own library.");
    assertEquals(b.stored().current, { key: keyA, name: "Phone" });

    b.confirmAnswer = true;
    await enter(b, "K7M2-9QXR");
    await b.reply(await b.request("POST", "/pair"), Response.json({ box: (await sealPairing("K7M29QXR", keyB)).box }));
    assertEquals(b.confirms.length, 2);
    assert(b.confirms[1].startsWith("Sync this browser with Dante (no worlds yet)?\n\nOnly continue if you made this code yourself"));
    assertEquals(b.stored().current, { key: keyB, name: "Dante" });
    assertEquals(b.stored().saved, [{ key: keyA, name: "Phone" }]);
    assertEquals(b.el("#join-code").value, "");
    assert(b.status().startsWith("This browser now syncs Dante."));
  }, { current: { key: keyA, name: "Phone" }, saved: [], auto: true }));

Deno.test("sharing client: a pasted sync or share link works like opening it", () =>
  withBrowser(async (b) => {
    b.server.set(keyB, { name: "Dante", worlds: [] });
    await b.init();
    await enter(b, `  https://map.example/#s=${linkKey(keyB)} `);
    assertEquals(b.stored().current, { key: keyB, name: "Dante" });
    assertEquals(b.location.hash, "");
    assertEquals(b.el("#join-code").value, "");

    await enter(b, `https://map.example/#v=${linkKey(shareKey)}`);
    const download = await b.request("GET", "/view/data");
    assertEquals(download.headers.get("Authorization"), `Bearer ${shareKey}`);
    assertEquals(b.location.hash, `#v=${linkKey(shareKey)}`);
    assertEquals(b.stored().current.key, keyB);

    await enter(b, `https://map.example/#s=${linkKey(keyA).slice(0, 70)}`);
    assertEquals(b.status(), "This sync link is incomplete. Copy the whole link again.");
    assertEquals(b.stored().current.key, keyB);
  }));

Deno.test("sharing client: the sync card shows a one-time code for this library that expires and is withdrawn on close", () =>
  withBrowser(async (b) => {
    await b.init();
    const card = b.el("#share-card");
    b.el("#sync-device").click();
    assert(card.textContent.includes("Making a sync code..."));
    const offer = await b.request("POST", "/library/pair");
    assertEquals(offer.headers.get("Authorization"), `Bearer ${keyA}`);
    assertEquals(offer.headers.get("Content-Type"), "application/json");
    const { id, box } = JSON.parse(offer.body as string);
    await b.reply(offer, Response.json({ expiresIn: PAIR_TTL / 1000 }, { status: 201 }));
    const shown = card.find((e) => e.tag === "p" && /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(e.textContent));
    assert(shown, card.textContent);
    const code = shown.textContent.replace("-", "");
    assertEquals(id, await pairId(code));
    assertEquals(await openPairing(code, box), keyA);
    assert(!card.textContent.includes(keyA) && !card.textContent.includes(box));

    const now = Date.now;
    Date.now = () => now() + PAIR_TTL;
    try {
      await b.tick();
      assert(card.textContent.includes("The sync code expired."), card.textContent);
      card.button("New code").click();
      const again = await b.request("POST", "/library/pair");
      assert(JSON.parse(again.body as string).id !== id);
      await b.reply(again, Response.json({ expiresIn: PAIR_TTL / 1000 }, { status: 201 }));
      assert(!card.textContent.includes("expired"));
      card.button("Close").click();
      await b.reply(await b.request("DELETE", "/library/pair"), new Response(null, { status: 204 }));
    } finally {
      Date.now = now;
    }
    assertEquals(b.pending(), 0);

    b.el("#sync-device").click();
    await b.reply(
      await b.request("POST", "/library/pair"),
      Response.json({ error: "Only 10 sync codes can be open from one network at a time" }, { status: 429 }),
    );
    assert(card.textContent.includes("Could not make a sync code: Only 10 sync codes can be open from one network at a time."));
    card.button("Close").click();
    await b.settle();
    assertEquals(b.pending(), 0);

    // Closed before the server answered: the code nobody saw is withdrawn.
    b.el("#sync-device").click();
    const early = await b.request("POST", "/library/pair");
    card.button("Close").click();
    await b.reply(early, Response.json({ expiresIn: PAIR_TTL / 1000 }, { status: 201 }));
    await b.reply(await b.request("DELETE", "/library/pair"), new Response(null, { status: 204 }));
    assertEquals(b.pending(), 0);
  }, { current: { key: keyA, name: "" }, saved: [], auto: true }));

Deno.test("sharing client: offline, a notice replaces the library; back online it clears and the newest world reopens", () =>
  withBrowser(async (b) => {
    const hero = await world();
    b.server.set(keyA, { name: "", worlds: [hero] });
    (globalThis.navigator as { onLine?: boolean }).onLine = false;
    b.down = true;
    await b.init();
    assertEquals(b.status(), "Offline. Your worlds sync again when you're back online; saves you open still work.");
    assert(b.el("#sync-device").disabled);
    b.down = false;
    (globalThis.navigator as { onLine?: boolean }).onLine = true;
    await b.fire("online");
    assertEquals(b.status(), "");
    assert(!b.el("#sync-device").disabled);
    await b.data(await b.request("GET", `/library/worlds/${hero.id}/data`));
    assertEquals(b.displays, [{ name: "Hero", refresh: false }]);
  }, { current: { key: keyA, name: "" }, saved: [], auto: true }));

// "My worlds": a private library of uploaded worlds that this browser remembers. Other devices join it with a
// sync link (full access, for your own devices); single worlds are shared with read-only links.

import { $, h } from "./dom.ts";
import type { Character, FileMap } from "./files.ts";
import { qrSvg } from "./qr.ts";
import {
  formatPairCode,
  identify,
  keyFromLink,
  LIBRARY_WORLDS,
  linkKey,
  MAX_UPLOAD,
  newPairCode,
  newToken,
  openPairing,
  packSave,
  PAIR_TTL,
  pairCode,
  pairId,
  RETENTION,
  sealPairing,
  SHARE_INTERVAL,
  TOKEN,
  unpackSave,
  validName,
  WORLD_ID,
  type WorldInfo,
} from "./sharing-format.ts";

export interface ShareSource {
  files: FileMap;
  character: Character;
  revision: number;
  session: number;
  /** Live saves is monitoring this source, so a world already in the library is kept updated. */
  live: boolean;
}
interface Hooks {
  current(): ShareSource | undefined;
  stopLocal(): void;
  display(files: FileMap, character: Character, refresh: boolean): Promise<boolean>;
}
/** A library this browser can open: its sync key (never displayed) and a friendly name. */
interface Library {
  key: string;
  name: string;
}
interface Remembered {
  current: Library;
  saved: Library[];
  /** The library world this browser last followed, reopened on the next visit. */
  opened?: string;
  auto: boolean;
}
type Watch =
  & { name: string; version?: string; updated?: number }
  & ({ kind: "world"; id: string } | { kind: "view"; key: string });
type Card = { kind: "sync" } | { kind: "share"; id: string };
/** The one-time code shown on the sync card, for the library it was made for. */
interface Pair {
  key: string;
  code?: string;
  expires?: number;
  error?: string;
}

const storageKey = "mirklurk-library-v1";
const legacyKey = "mirklurk-shares-v1";
const MAX_SAVED = 20;

class ShareError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Library calls carry its key in the Authorization header; claiming a sync code is the only call without one. */
async function api(path: string, key: string | undefined, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { ...init.headers as Record<string, string>, ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });
  if (!response.ok && response.status !== 304) {
    let message = `Sharing service returned HTTP ${response.status}`;
    if (response.headers.get("Content-Type")?.includes("application/json")) message = (await response.json()).error ?? message;
    throw new ShareError(response.status, message);
  }
  return response;
}

const label = (library: Library) => library.name || "Unnamed library";
const tagOf = (source: ShareSource) => `${source.session}:${source.character.root}`;
function ago(time: number): string {
  const minutes = Math.round((Date.now() - time) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return `on ${new Date(time).toLocaleDateString()}`;
}

export class Sharing {
  private remembered: Remembered = { current: { key: "", name: "" }, saved: [], auto: true };
  private worlds?: WorldInfo[];
  private limit = LIBRARY_WORLDS;
  private retentionDays = RETENTION / 86_400_000;
  private enabled = false;
  private watching?: Watch;
  private card?: Card;
  private cardLink?: string;
  private pair?: Pair;
  private local?: { tag: string; id: Promise<string | undefined>; resolved?: string };
  /** World ID → the local revision last uploaded, so automatic updates send each change once. */
  private published = new Map<string, string>();
  private generation = 0;
  private uploading = false;
  private polling = false;
  private pollFailed = false;
  /** The library could not be reached; cleared once it can. */
  private unreachable = false;
  private refreshing?: string;
  constructor(private hooks: Hooks) {}

  get isWatching() {
    return !!this.watching;
  }

  private report(text: string, error = false) {
    this.pollFailed = this.unreachable = false;
    $("#share-status").textContent = text;
    $("#share-status").classList.toggle("error", error);
  }

  /** Clears a refresh error once following works again, without hiding other messages. */
  private recovered() {
    if (this.pollFailed) this.report("");
  }

  stop() {
    if (this.watching) $("#live-status").textContent = "Stopped following. The last snapshot stays on screen.";
    ++this.generation;
    this.watching = undefined;
    if (new URLSearchParams(location.hash.slice(1)).has("v")) history.replaceState(null, "", location.pathname + location.search);
    this.render();
  }

  changed() {
    const source = this.hooks.current();
    if (source) void this.identity(source).then(() => this.render());
    this.render();
  }

  async init() {
    this.load();
    $("#save-world").addEventListener("click", () => void this.save());
    $("#auto-update").addEventListener("change", () => {
      this.remembered.auto = $<HTMLInputElement>("#auto-update").checked;
      this.persist();
    });
    $("#library-name").addEventListener("change", () => void this.rename($<HTMLInputElement>("#library-name").value));
    $("#sync-device").addEventListener("click", () => this.show(this.card?.kind === "sync" ? undefined : { kind: "sync" }));
    $("#join-form").addEventListener("submit", (event) => {
      event.preventDefault();
      void this.enter($<HTMLInputElement>("#join-code").value);
    });
    $("#stop-watch").addEventListener("click", () => {
      this.stop();
      $("#follow-control").hidden = true;
      this.changed();
      this.report("Stopped following. The last snapshot stays on screen.");
    });
    setInterval(() => {
      void this.autoPublish();
      if (document.hidden) return;
      void this.poll();
      void this.refresh();
    }, SHARE_INTERVAL);
    addEventListener("hashchange", () => void this.openHash());
    addEventListener("online", () => void this.refresh().then(() => this.autoOpen()));
    this.render();
    await this.refresh();
    if (!await this.openHash()) this.autoOpen();
  }

  private load() {
    let stored: Partial<Remembered> | undefined;
    try {
      stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") ?? undefined;
      localStorage.removeItem(legacyKey);
    } catch (e) {
      console.error(e);
    }
    const valid = (l: unknown): l is Library =>
      !!l && typeof l === "object" && TOKEN.test((l as Library).key) && validName((l as Library).name);
    this.remembered = {
      current: valid(stored?.current) ? stored.current : { key: newToken(), name: "" },
      saved: Array.isArray(stored?.saved) ? stored.saved.filter(valid).slice(0, MAX_SAVED) : [],
      opened: typeof stored?.opened === "string" && WORLD_ID.test(stored.opened) ? stored.opened : undefined,
      auto: stored?.auto !== false,
    };
    this.persist();
  }

  private persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(this.remembered));
    } catch (e) {
      console.error(e);
      this.report("This browser can't remember your library. Sync another device before closing the page to keep access.", true);
    }
  }

  private openHash(): Promise<boolean> {
    return this.openLink(location.hash.slice(1), true);
  }

  /** `#s=` joins a library (then leaves the address bar); `#v=` follows one shared world read-only. Keys are written as digits. */
  private async openLink(fragment: string, address: boolean): Promise<boolean> {
    const params = new URLSearchParams(fragment);
    const sync = params.get("s"), view = params.get("v");
    if (sync !== null) {
      if (address) history.replaceState(null, "", location.pathname + location.search);
      const key = keyFromLink(sync);
      if (!key) {
        this.report("This sync link is incomplete. Copy the whole link again.", true);
        return false;
      }
      await this.join(key);
      return true;
    }
    if (view !== null) {
      const key = keyFromLink(view);
      if (!key) {
        this.report("This share link is incomplete. Copy the whole link again.", true);
        return false;
      }
      if (this.watching?.kind !== "view" || this.watching.key !== key) this.watch({ kind: "view", key, name: "the shared world" });
      return true;
    }
    if (address && params.has("share")) {
      history.replaceState(null, "", location.pathname + location.search);
      this.report("That link is from the old sharing system and no longer works. Ask for a new share link.", true);
    }
    return false;
  }

  /** A one-time sync code, or a pasted sync or share link: a Home Screen app on iPhone never receives links itself. */
  private async enter(text: string) {
    const input = $<HTMLInputElement>("#join-code");
    const value = text.trim();
    if (!value) return;
    const fragment = value.includes("#") ? value.slice(value.indexOf("#") + 1) : "";
    if (/(^|&)[sv]=/.test(fragment)) {
      input.value = "";
      await this.openLink(fragment, false);
      return;
    }
    const code = pairCode(value);
    if (!code) {
      this.report("Enter the 8-character sync code from your other device, or paste a whole sync or share link.", true);
      return;
    }
    this.report("Checking the sync code...");
    let key: string | undefined;
    try {
      const response = await api("/pair", undefined, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: await pairId(code) }),
      });
      const { box } = await response.json();
      key = typeof box === "string" ? await openPairing(code, box) : undefined;
      if (!key) throw new Error("it does not match the library it was made for");
    } catch (e) {
      this.report(
        e instanceof ShareError && e.status === 404
          ? "That sync code is wrong, was already used, or expired. Make a new one with Sync another device... on your other device."
          : `Could not use the sync code: ${(e as Error).message}`,
        true,
      );
      return;
    }
    input.value = "";
    await this.join(key, "code");
  }

  private async join(key: string, via: "link" | "code" = "link") {
    const previous = this.remembered.current;
    if (key === previous.key) {
      this.report(`This browser already syncs ${previous.name || "this library"}.`);
      this.autoOpen();
      return;
    }
    // A library that could not be loaded might hold worlds, so it is kept as well.
    const keep = !this.worlds || this.worlds.length > 0 || !!previous.name;
    let preview: { name: string; worlds: WorldInfo[] } | undefined;
    try {
      preview = await (await api("/library", key)).json();
    } catch (e) {
      console.error(e);
    }
    const target = preview
      ? `${preview.name || "an unnamed library"} (${preview.worlds.map((w) => w.name).join(", ") || "no worlds yet"})`
      : "another library";
    // Whoever made a sync link receives everything this browser adds or updates, so a link from someone else is never followed silently.
    if (
      !confirm(
        `Sync this browser with ${target}?\n\nOnly continue if you made this ${via} yourself on one of your own devices: ` +
          "whoever made it can see and change every world you add or update here." +
          (keep ? `\n\nYour current library, ${label(previous)}, will be saved so you can switch back.` : ""),
      )
    ) {
      this.report(`Sync ${via} ignored. This browser keeps its own library.`);
      this.autoOpen();
      return;
    }
    await this.use({ key, name: preview?.name ?? this.remembered.saved.find((l) => l.key === key)?.name ?? "" }, keep);
    const { name } = this.remembered.current;
    this.report(
      `This browser now syncs ${name || "the same worlds as your other device"}.` +
        (keep ? ` Your previous library, ${label(previous)}, is saved below; switch back any time.` : ""),
    );
    this.autoOpen();
  }

  private async switchTo(library: Library) {
    const previous = this.remembered.current;
    await this.use(library, true);
    this.report(`Switched to ${label(this.remembered.current)}. ${label(previous)} is saved below.`);
    this.autoOpen();
  }

  private forget(library: Library) {
    if (
      !confirm(
        `Remove ${
          label(library)
        } from this browser? Its worlds stay online until they expire, but only a device that still syncs it can bring it back here.`,
      )
    ) return;
    this.remembered.saved = this.remembered.saved.filter((l) => l.key !== library.key);
    this.persist();
    this.render();
  }

  private async use(library: Library, keepPrevious: boolean) {
    const previous = this.remembered.current;
    this.remembered.saved = [
      ...(keepPrevious ? [previous] : []),
      ...this.remembered.saved.filter((l) => l.key !== library.key && l.key !== previous.key),
    ].slice(0, MAX_SAVED);
    this.remembered.current = { ...library };
    this.remembered.opened = undefined;
    this.persist();
    if (this.watching?.kind === "world") {
      this.stop();
      $("#follow-control").hidden = true;
    }
    this.worlds = undefined;
    this.published.clear();
    this.show(undefined);
    this.changed();
    await this.refresh();
  }

  /** Reopen what this browser followed last time (or the newest world) when nothing else is on screen. */
  private autoOpen() {
    if (this.watching || this.hooks.current() || !this.worlds?.length) return;
    const world = this.worlds.find((w) => w.id === this.remembered.opened) ?? this.worlds[0];
    this.watch({ kind: "world", id: world.id, name: world.name });
  }

  private async refresh() {
    const key = this.remembered.current.key;
    if (this.refreshing === key) return;
    this.refreshing = key;
    try {
      const body = await (await api("/library", key)).json();
      if (key !== this.remembered.current.key) return;
      if (this.unreachable) this.report("");
      this.enabled = true;
      this.worlds = body.worlds;
      this.limit = body.limits?.worldsPerLibrary ?? this.limit;
      this.retentionDays = body.limits?.retentionDays ?? this.retentionDays;
      if (body.name !== this.remembered.current.name && validName(body.name)) {
        this.remembered.current.name = body.name;
        this.persist();
      }
    } catch (e) {
      console.error(e);
      if (key === this.remembered.current.key && !this.enabled) {
        this.report(
          navigator.onLine === false
            ? "Offline. Your worlds sync again when you're back online; saves you open still work."
            : `Syncing is unavailable on this server. ${(e as Error).message}`,
          true,
        );
        this.unreachable = true;
      }
    } finally {
      if (this.refreshing === key) this.refreshing = undefined;
      this.render();
    }
  }

  private merge(info: WorldInfo) {
    this.worlds = [info, ...(this.worlds ?? []).filter((w) => w.id !== info.id)].sort((a, b) => b.updated - a.updated);
  }

  private identity(source: ShareSource): Promise<string | undefined> {
    const tag = tagOf(source);
    if (this.local?.tag !== tag) {
      const local: NonNullable<typeof this.local> = { tag, id: Promise.resolve(undefined) };
      local.id = identify(source.files, source.character).then((id) => local.resolved = id, (e) => {
        console.error(e);
        return undefined;
      });
      this.local = local;
    }
    return this.local.id;
  }

  private async save() {
    const source = this.hooks.current();
    if (!source) return;
    const id = await this.identity(source);
    if (!id) {
      this.report("This save has no readable Player.save, so it can't be added.", true);
      return;
    }
    await this.upload(source, id, false);
  }

  private async autoPublish() {
    const source = this.hooks.current();
    if (!this.remembered.auto || !source?.live || this.uploading) return;
    const id = await this.identity(source);
    if (!id || !this.worlds?.some((w) => w.id === id)) return;
    if (this.published.get(id) === `${tagOf(source)}:${source.revision}`) return;
    await this.upload(source, id, true);
  }

  /** Adds the world, or updates it if the library already has it; the server decides and rejects mismatches. */
  private async upload(source: ShareSource, id: string, auto: boolean) {
    if (this.uploading) return;
    this.uploading = true;
    this.render();
    const key = this.remembered.current.key;
    const name = source.character.name;
    const adding = !this.worlds?.some((w) => w.id === id);
    const revision = `${tagOf(source)}:${source.revision}`;
    try {
      if (!auto) this.report(`${adding ? "Adding" : "Updating"} ${name}...`);
      const bytes = await packSave(source.files, source.character);
      const now = this.hooks.current();
      if (!now || tagOf(now) !== tagOf(source) || key !== this.remembered.current.key) return;
      const response = await api(`/library/worlds/${id}`, key, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream", ...(adding ? {} : { "If-Match": "*" }) },
        body: bytes as BodyInit,
      });
      const info: WorldInfo = await response.json();
      this.published.set(id, revision);
      if (key !== this.remembered.current.key) return;
      this.merge(info);
      this.report(
        response.status === 201
          ? `Added ${info.name}. Your synced devices will see it within 30 seconds.`
          : `Updated ${info.name} ${auto ? "automatically " : ""}at ${new Date(info.updated).toLocaleTimeString()}.`,
      );
    } catch (e) {
      // Automatic updates retry on the next change; a too-early update simply waits for the next tick.
      if (auto && e instanceof ShareError && e.status === 429) return;
      if (auto) this.published.set(id, revision);
      const gone = e instanceof ShareError && e.status === 412;
      if (gone && key === this.remembered.current.key) this.worlds = this.worlds?.filter((w) => w.id !== id);
      this.report(
        gone && auto
          ? `${name} was removed from your library on another device, so it is no longer updated automatically.`
          : `Could not ${adding ? "add" : "update"} ${name}: ${(e as Error).message}`,
        !(gone && auto),
      );
      if (e instanceof ShareError && (e.status === 409 || gone)) void this.refresh();
    } finally {
      this.uploading = false;
      this.render();
    }
  }

  private async remove(world: WorldInfo) {
    if (!confirm(`Delete ${world.name}? It disappears from all your synced devices, and its share link stops working.`)) return;
    const key = this.remembered.current.key;
    try {
      await api(`/library/worlds/${world.id}`, key, { method: "DELETE" });
      this.report(`Deleted ${world.name}. Copies already downloaded elsewhere can't be revoked.`);
    } catch (e) {
      this.report(`Could not delete ${world.name}: ${(e as Error).message}`, true);
      if (!(e instanceof ShareError && e.status === 404)) return;
    }
    if (key !== this.remembered.current.key) return;
    this.worlds = this.worlds?.filter((w) => w.id !== world.id);
    if (this.watching?.kind === "world" && this.watching.id === world.id) {
      this.stop();
      $("#follow-control").hidden = true;
      this.changed();
    }
    this.renderCard();
    this.render();
  }

  private async rename(value: string) {
    const name = value.trim();
    if (!validName(name)) {
      this.report("Library names are at most 40 characters.", true);
      return;
    }
    const key = this.remembered.current.key;
    try {
      await api("/library", key, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      if (key !== this.remembered.current.key) return;
      this.remembered.current.name = name;
      this.persist();
      this.report(name ? `Renamed this library to ${name}.` : "Removed this library's name.");
    } catch (e) {
      this.report(`Could not rename this library: ${(e as Error).message}`, true);
    }
    this.renderCard();
    this.render();
  }

  private async reshare(world: WorldInfo) {
    if (!confirm(`Make a new share link for ${world.name}? Anyone using the old link loses access.`)) return;
    const key = this.remembered.current.key;
    try {
      const info: WorldInfo = await (await api(`/library/worlds/${world.id}/share`, key, { method: "POST" })).json();
      if (key !== this.remembered.current.key) return;
      this.merge(info);
      this.report(`New share link ready for ${world.name}. The old link no longer works.`);
    } catch (e) {
      this.report(`Could not reset the share link: ${(e as Error).message}`, true);
    }
    this.renderCard();
    this.render();
  }

  private show(card: Card | undefined) {
    this.card = card;
    if (card?.kind === "sync") void this.newPair();
    else this.withdrawPair();
    this.renderCard();
  }

  /** Makes a one-time code for the sync card; it replaces any earlier code of this library. */
  private async newPair() {
    const key = this.remembered.current.key;
    const pair: Pair = { key };
    this.pair = pair;
    this.renderCard();
    try {
      const code = newPairCode();
      const response = await api("/library/pair", key, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(await sealPairing(code, key)),
      });
      await response.body?.cancel();
      if (this.pair !== pair) {
        // Closed while it was being made, so nobody has seen it.
        if (this.pair?.key !== key) void api("/library/pair", key, { method: "DELETE" }).catch((e) => console.error(e));
        return;
      }
      pair.code = code;
      pair.expires = Date.now() + PAIR_TTL;
    } catch (e) {
      if (this.pair !== pair) return;
      pair.error = (e as Error).message;
    }
    this.renderCard();
  }

  /** Closing the sync card withdraws its code early. */
  private withdrawPair() {
    const pair = this.pair;
    this.pair = undefined;
    if (pair?.code && pair.expires! > Date.now()) void api("/library/pair", pair.key, { method: "DELETE" }).catch((e) => console.error(e));
  }

  private pairView() {
    const pair = this.pair;
    const again = h("button", { type: "button", class: "button subtle", onclick: () => void this.newPair() }, "New code");
    if (!pair || pair.error) return h("p", { class: "pair" }, `Could not make a sync code${pair?.error ? `: ${pair.error}` : ""}. `, again);
    if (!pair.code) return h("p", { class: "pair muted" }, "Making a sync code...");
    if (pair.expires! <= Date.now()) return h("p", { class: "pair" }, "The sync code expired. ", again);
    return h(
      "div",
      { class: "pair" },
      h(
        "p",
        {},
        "On an iPhone Home Screen app, or anywhere a link won't open, type this code under ",
        h("b", {}, "Sync code or link"),
        ":",
      ),
      h("p", { class: "pair-code" }, formatPairCode(pair.code)),
      h("p", { class: "muted" }, `It works once, within ${PAIR_TTL / 60_000} minutes, and stops when you close this card.`),
    );
  }

  private async copy(link: string, fallback: HTMLInputElement) {
    try {
      await navigator.clipboard.writeText(link);
      this.report("Link copied.");
    } catch {
      fallback.hidden = false;
      fallback.select();
      this.report("Copy the link from the box below.");
    }
  }

  private renderCard() {
    const el = $("#share-card");
    const card = this.card;
    const world = card?.kind === "share" ? this.worlds?.find((w) => w.id === card.id) : undefined;
    if (!card || (card.kind === "share" && !world) || !this.enabled) {
      this.card = this.cardLink = undefined;
      this.withdrawPair();
      el.hidden = true;
      el.replaceChildren();
      return;
    }
    const sync = card.kind === "sync";
    const fragment = `#${sync ? "s" : "v"}=${linkKey(sync ? this.remembered.current.key : world!.share)}`;
    const link = `${location.origin}${location.pathname}${fragment}`;
    const title = sync
      ? `Sync another device${this.remembered.current.name ? ` with ${this.remembered.current.name}` : ""}`
      : `Share ${world!.name} (read-only)`;
    const pair = this.pair;
    const state = sync && pair ? `${pair.code}:${pair.error}:${pair.expires! <= Date.now()}` : "";
    if (this.cardLink === `${link}\n${title}\n${state}`) return;
    this.cardLink = `${link}\n${title}\n${state}`;
    const fallback = h("input", {
      class: "share-link",
      readonly: true,
      value: link,
      hidden: true,
      "aria-label": "Link",
    }) as HTMLInputElement;
    const button = (text: string, action: () => void, primary = false) =>
      h("button", { type: "button", class: primary ? "button" : "button subtle", onclick: action }, text);
    el.replaceChildren(
      h("h3", {}, title),
      // Scheme and host are case-insensitive; in capitals they fit the QR code's compact alphanumeric mode.
      qrSvg(
        `${location.origin.toUpperCase()}${location.pathname}${fragment}`,
        sync ? "QR code for the sync link" : `QR code for viewing ${world!.name}`,
      ),
      h(
        "div",
        {},
        h(
          "p",
          {},
          sync
            ? "Scan this with your phone's camera, or open the link on your other PC. That device will see and update the same worlds."
            : `Anyone with this link can view ${
              world!.name
            } and follow its updates. They can't change anything, and their own worlds stay as they are.`,
        ),
        sync
          ? h(
            "p",
            { class: "warning" },
            "Anyone with this link or code can add, update and delete your worlds. Only use them on your own devices.",
          )
          : null,
        sync ? this.pairView() : null,
        h(
          "div",
          { class: "share-actions" },
          button("Copy link", () => void this.copy(link, fallback), true),
          "share" in navigator ? button("Share...", () => void navigator.share({ title, url: link }).catch((e) => console.error(e))) : null,
          sync ? null : button("Reset link", () => void this.reshare(world!)),
          button("Close", () => this.show(undefined)),
        ),
        fallback,
      ),
    );
    el.hidden = false;
  }

  private render() {
    const source = this.hooks.current();
    const localId = source && this.local?.tag === tagOf(source) ? this.local.resolved : undefined;
    const worlds = this.worlds ?? [];
    const existing = localId ? worlds.some((w) => w.id === localId) : false;
    const save = $<HTMLButtonElement>("#save-world");
    save.textContent = source
      ? `${existing ? "Update" : "Add"} ${source.character.name} ${existing ? "in" : "to"} my worlds`
      : "Add this world to my worlds";
    save.disabled = !this.enabled || !this.worlds || !localId || this.uploading;
    const auto = $<HTMLInputElement>("#auto-update");
    auto.checked = this.remembered.auto;
    auto.disabled = !this.enabled;
    const name = $<HTMLInputElement>("#library-name");
    if (document.activeElement !== name) name.value = this.remembered.current.name;
    name.disabled = !this.enabled;
    $<HTMLButtonElement>("#sync-device").disabled = !this.enabled;
    $("#library-usage").textContent = this.worlds
      ? `${worlds.length} of ${this.limit} worlds${worlds.length >= this.limit ? " (full: delete one to add another)" : ""}. ` +
        `Each is kept ${this.retentionDays} days after its last update.`
      : "";

    const watching = this.watching;
    const button = (text: string, action: () => void, disabled = false) =>
      h("button", { type: "button", class: "button subtle", disabled, onclick: action }, text);
    $("#world-list").replaceChildren(...worlds.map((world) => {
      const open = watching?.kind === "world" && watching.id === world.id;
      return h(
        "li",
        {},
        h("b", {}, world.name),
        open ? h("span", { class: "tag" }, "open") : null,
        world.id === localId ? h("span", { class: "tag" }, "this save") : null,
        h("span", { class: "muted" }, ` updated ${ago(world.updated)}, kept until ${new Date(world.expires).toLocaleDateString()}`),
        h(
          "div",
          { class: "share-actions" },
          button(open ? "Following" : "Open", () => this.watch({ kind: "world", id: world.id, name: world.name }), open),
          button("Share...", () => this.show({ kind: "share", id: world.id })),
          button("Delete", () => void this.remove(world)),
        ),
      );
    }));

    $("#viewing").hidden = !watching;
    const updated = watching?.updated ? ` (updated ${ago(watching.updated)})` : "";
    $("#viewing-text").textContent = !watching
      ? ""
      : !watching.version
      ? `Opening ${watching.name}...`
      : watching.kind === "view"
      ? `Viewing ${watching.name}, shared with you read-only${updated}. Your own worlds are unchanged.`
      : `Following ${watching.name} from your library${updated}.`;

    const saved = this.remembered.saved;
    $("#saved-libraries").hidden = !saved.length;
    $("#library-list").replaceChildren(...saved.map((library) =>
      h(
        "li",
        {},
        h("b", {}, label(library)),
        h(
          "div",
          { class: "share-actions" },
          button("Switch to this library", () => void this.switchTo(library), !this.enabled),
          button("Remove from this browser", () => this.forget(library)),
        ),
      )
    ));
    this.renderCard();
  }

  private watch(target: Watch) {
    this.hooks.stopLocal();
    ++this.generation;
    this.watching = target;
    if (target.kind === "world") {
      this.remembered.opened = target.id;
      this.persist();
    } else {
      history.replaceState(null, "", `${location.pathname}${location.search}#v=${linkKey(target.key)}`);
    }
    $("#follow-control").hidden = false;
    $("#live-status").textContent = target.kind === "view"
      ? "Viewing a shared world. Local folder monitoring is off."
      : "Following a world from your library. Local folder monitoring is off.";
    this.changed();
    void this.poll();
  }

  private async poll() {
    const watch = this.watching;
    if (!watch || this.polling) return;
    this.polling = true;
    try {
      const response = await api(
        watch.kind === "world" ? `/library/worlds/${watch.id}/data` : "/view/data",
        watch.kind === "world" ? this.remembered.current.key : watch.key,
        { headers: watch.version ? { "If-None-Match": watch.version } : {} },
      );
      if (watch !== this.watching) {
        await response.body?.cancel();
        return;
      }
      if (response.status === 304) {
        this.recovered();
        this.render();
        return;
      }
      const length = response.headers.get("Content-Length");
      if (length && Number(length) > MAX_UPLOAD) {
        await response.body?.cancel();
        throw new Error("Shared save is too large");
      }
      const snapshot = unpackSave(new Uint8Array(await response.arrayBuffer()));
      if (watch !== this.watching) return;
      const success = await this.hooks.display(snapshot.files, { name: snapshot.name, root: "Shared/" }, !!watch.version);
      if (!success) throw new Error("Shared snapshot could not be displayed; retaining the previous map");
      if (watch !== this.watching) return;
      watch.version = response.headers.get("ETag") ?? undefined;
      watch.name = snapshot.name;
      watch.updated = Date.parse(response.headers.get("Last-Modified") ?? "") || Date.now();
      this.recovered();
      this.render();
    } catch (e) {
      if (watch === this.watching) {
        if (e instanceof ShareError && e.status === 404) {
          this.stop();
          $("#follow-control").hidden = true;
          this.changed();
          if (watch.kind === "world") void this.refresh();
        }
        this.report(`Could not refresh ${watch.name}: ${(e as Error).message}. The last snapshot stays on screen.`, true);
        this.pollFailed = true;
      }
    } finally {
      this.polling = false;
      if (this.watching && watch !== this.watching) void this.poll();
    }
  }
}

import { $, h } from "./dom.ts";
import type { Character, FileMap } from "./files.ts";
import { packSave, SHARE_INTERVAL, type SharedInfo, TOKEN, unpackSave } from "./sharing-format.ts";

interface Remembered extends SharedInfo {
  edit?: string;
}
export interface ShareSource {
  files: FileMap;
  character: Character;
  revision: number;
  session: number;
}
interface Hooks {
  current(): ShareSource | undefined;
  stopLocal(): void;
  display(files: FileMap, character: Character, refresh: boolean): Promise<boolean>;
}
const storageKey = "mirklurk-shares-v1";

class ShareError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`/api/shares${path}`, { ...init, signal: AbortSignal.timeout(60_000), cache: "no-store" });
  if (!response.ok && response.status !== 304) {
    let message = `Sharing service returned HTTP ${response.status}`;
    if (response.headers.get("Content-Type")?.includes("application/json")) message = (await response.json()).error ?? message;
    throw new ShareError(response.status, message);
  }
  return response;
}

export class Sharing {
  private remembered: Remembered[] = [];
  private watching?: { id: string; version?: string };
  private publishing?: { id: string; session: number; root: string; revision: number };
  private generation = 0;
  private uploading = false;
  private polling = false;
  private enabled = false;
  constructor(private hooks: Hooks) {}

  get isWatching() {
    return !!this.watching;
  }

  private report(text: string, error = false) {
    $("#share-status").textContent = text;
    $("#share-status").classList.toggle("error", error);
  }

  stop() {
    if (this.watching) $("#live-status").textContent = "Shared save watching stopped. The last snapshot is retained.";
    ++this.generation;
    this.watching = undefined;
    this.publishing = undefined;
    $<HTMLInputElement>("#publish-live").checked = false;
    $("#stop-watch").hidden = true;
  }

  changed() {
    const current = this.hooks.current();
    if (this.publishing && (!current || current.session !== this.publishing.session || current.character.root !== this.publishing.root)) {
      this.publishing = undefined;
      $<HTMLInputElement>("#publish-live").checked = false;
      this.report("Automatic publishing stopped because the source or character changed. Existing links remain available until expiry.");
    }
    $<HTMLButtonElement>("#share-save").disabled = !this.enabled || !current || this.uploading;
    $<HTMLInputElement>("#publish-live").disabled = !this.publishing;
    this.render();
  }

  async init() {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      if (!Array.isArray(saved)) throw new Error("Invalid remembered-save list");
      this.remembered = saved.filter((r): r is Remembered =>
        r && typeof r === "object" && typeof r.id === "string" && TOKEN.test(r.id) &&
        typeof r.name === "string" && typeof r.expires === "number" &&
        (!r.edit || (typeof r.edit === "string" && TOKEN.test(r.edit)))
      ).slice(0, 100);
    } catch (e) {
      console.error(e);
      this.report("This browser cannot restore remembered links. Keep a copy of your sharing link.", true);
    }
    this.render();
    $("#share-save").addEventListener("click", () => this.publish(true));
    $("#stop-watch").addEventListener("click", () => {
      this.stop();
      $("#follow-control").hidden = true;
      this.changed();
      this.report("Stopped watching. The last downloaded snapshot remains visible.");
    });
    $("#open-share").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = $<HTMLInputElement>("#share-link").value.trim();
      try {
        const id = TOKEN.test(input) ? input : new URLSearchParams(new URL(input).hash.slice(1)).get("share");
        if (!id || !TOKEN.test(id)) throw new Error("Paste a private sharing link or its 64-character code");
        this.watch(id);
      } catch (e) {
        this.report((e as Error).message, true);
      }
    });
    setInterval(() => {
      if (!document.hidden) void this.poll();
      if ($<HTMLInputElement>("#publish-live").checked) void this.publish(false);
    }, SHARE_INTERVAL);
    addEventListener("hashchange", () => this.openHash());
    try {
      await api("");
      this.enabled = true;
      this.changed();
    } catch (e) {
      this.report(`Uploads unavailable on this server. ${(e as Error).message}`, true);
    }
    this.openHash();
  }

  private openHash() {
    const id = new URLSearchParams(location.hash.slice(1)).get("share");
    if (id && TOKEN.test(id)) this.watch(id);
  }

  private remember(info: Remembered) {
    const old = this.remembered.find((r) => r.id === info.id);
    this.remembered = [{ ...old, ...info }, ...this.remembered.filter((r) => r.id !== info.id)].slice(0, 100);
    this.persist();
  }

  private persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(this.remembered));
    } catch (e) {
      console.error(e);
      this.report("Could not remember this link on this device. Copy it before leaving the page.", true);
    }
    this.render();
  }

  private link(id: string) {
    return `${location.origin}${location.pathname}#share=${id}`;
  }

  private render() {
    $("#shared-list").replaceChildren(...this.remembered.map((record) => {
      const expired = record.expires <= Date.now();
      const button = (text: string, action: () => void, disabled = false) =>
        h("button", { type: "button", class: "button subtle", disabled, onclick: action }, text);
      return h(
        "li",
        {},
        h("b", {}, record.name),
        h("span", { class: "muted" }, ` ${expired ? "Expired" : "Expires"} ${new Date(record.expires).toLocaleString()}`),
        h(
          "div",
          { class: "share-actions" },
          button("Open / watch", () => this.watch(record.id), expired),
          button("Show link", () => {
            $<HTMLInputElement>("#share-link").value = this.link(record.id);
            $<HTMLInputElement>("#share-link").select();
          }, expired),
          record.edit ? button("Delete upload", () => this.remove(record), expired) : null,
          record.edit
            ? button("Replace with selected save", () => this.publish(false, record), expired || !this.hooks.current() || this.uploading)
            : null,
          button("Forget link", () => {
            this.remembered = this.remembered.filter((r) => r.id !== record.id);
            this.persist();
          }),
        ),
      );
    }));
  }

  private async remove(record: Remembered) {
    try {
      await api(`/${record.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${record.edit}`, "Content-Type": "application/octet-stream" },
      });
      if (this.watching?.id === record.id || this.publishing?.id === record.id) {
        if (this.watching) $("#follow-control").hidden = true;
        this.stop();
        this.changed();
      }
      this.report("Upload deleted. Downloaded copies on other devices cannot be revoked.");
      this.remembered = this.remembered.filter((r) => r.id !== record.id);
      this.persist();
    } catch (e) {
      this.report((e as Error).message, true);
    }
  }

  private async publish(create: boolean, destination?: Remembered) {
    if (this.uploading) return;
    const source = this.hooks.current();
    if (!source) return;
    const target = this.publishing;
    if (
      !create && !destination &&
      (!target || target.session !== source.session || target.root !== source.character.root || target.revision === source.revision)
    ) {
      return;
    }
    const existing = destination ?? (!create ? this.remembered.find((r) => r.id === target?.id) : undefined);
    if (!create && !existing?.edit) {
      $<HTMLInputElement>("#publish-live").checked = false;
      this.report("Publishing stopped: the upload's owner key is no longer stored on this device.", true);
      return;
    }
    this.uploading = true;
    this.changed();
    const generation = this.generation;
    try {
      this.report(create ? "Uploading the selected character..." : "Publishing the latest settled snapshot...");
      const bytes = await packSave(source.files, source.character);
      if (generation !== this.generation) return;
      const response = await api(existing ? `/${existing.id}` : "", {
        method: existing ? "PUT" : "POST",
        headers: { "Content-Type": "application/octet-stream", ...(existing ? { Authorization: `Bearer ${existing.edit}` } : {}) },
        body: bytes as BodyInit,
      });
      const info: Remembered = await response.json();
      // Retain the owner key even if the user switches sources during the request.
      this.report(`Shared until ${new Date(info.expires).toLocaleString()}. Anyone with the link can view the save.`);
      this.remember(info);
      if (generation === this.generation) {
        this.publishing = { id: info.id, session: source.session, root: source.character.root, revision: source.revision };
        $<HTMLInputElement>("#share-link").value = this.link(info.id);
      }
    } catch (e) {
      if (e instanceof ShareError && (e.status === 403 || e.status === 404)) {
        this.publishing = undefined;
        $<HTMLInputElement>("#publish-live").checked = false;
      }
      this.report(`Could not share: ${(e as Error).message}`, true);
    } finally {
      this.uploading = false;
      this.changed();
    }
  }

  private watch(id: string) {
    this.hooks.stopLocal();
    ++this.generation;
    this.watching = { id };
    $<HTMLDetailsElement>(".sharing").open = true;
    $("#stop-watch").hidden = false;
    $("#follow-control").hidden = false;
    $("#live-status").textContent = "Watching a shared save. Local folder monitoring is off.";
    this.changed();
    this.report("Opening shared save...");
    void this.poll();
  }

  private async poll() {
    const watch = this.watching;
    if (!watch || this.polling) return;
    this.polling = true;
    try {
      const response = await api(`/${watch.id}/data`, {
        headers: watch.version ? { "If-None-Match": watch.version } : {},
      });
      if (watch !== this.watching) {
        await response.body?.cancel();
        return;
      }
      if (response.status === 304) {
        this.report("Watching shared save every 30 seconds; no new snapshot.");
        return;
      }
      const length = response.headers.get("Content-Length");
      if (length && Number(length) > 64 * 1024 * 1024) {
        await response.body?.cancel();
        throw new Error("Shared save is too large");
      }
      const snapshot = unpackSave(new Uint8Array(await response.arrayBuffer()));
      if (watch !== this.watching) return;
      const info: SharedInfo = await (await api(`/${watch.id}`)).json();
      if (watch !== this.watching) return;
      const success = await this.hooks.display(snapshot.files, { name: snapshot.name, root: "Shared/" }, !!watch.version);
      if (!success) throw new Error("Shared snapshot could not be displayed; retaining the previous map");
      if (watch !== this.watching) return;
      watch.version = response.headers.get("ETag") ?? undefined;
      this.report(`Watching every 30 seconds. Expires ${new Date(info.expires).toLocaleString()}.`);
      this.remember(info);
    } catch (e) {
      if (watch === this.watching) {
        if (e instanceof ShareError && e.status === 404) {
          this.stop();
          $("#follow-control").hidden = true;
          this.changed();
        }
        this.report(`Could not refresh shared save: ${(e as Error).message}. Last snapshot retained.`, true);
      }
    } finally {
      this.polling = false;
      if (this.watching && watch !== this.watching) void this.poll();
    }
  }
}

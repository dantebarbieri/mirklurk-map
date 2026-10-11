import type { Character, FileMap } from "./files.ts";
import { decodeJson, parsePlayer } from "./save.ts";

export const MAX_UPLOAD = 64 * 1024 * 1024;
export const MAX_FILES = 4096;
/** Worlds one library may hold; updating a world already in it never counts. */
export const LIBRARY_WORLDS = 5;
/** A world is deleted this long after its last update. */
export const RETENTION = 30 * 24 * 60 * 60 * 1000;
export const SHARE_INTERVAL = 30_000;
export const NAME_LENGTH = 40;
/** Sync keys and read-only share keys: 32 random bytes, canonical base64url (the last character carries 4 bits, so its low 2 are zero). */
export const TOKEN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
export const WORLD_ID = /^[A-Za-z0-9_-]{22}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const hasControl = (text: string) => [...text].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

/** A world as listed to sync-key holders; `share` is its current read-only key. */
export interface WorldInfo {
  id: string;
  name: string;
  created: number;
  updated: number;
  expires: number;
  version: string;
  size: number;
  share: string;
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hex = (bytes: Uint8Array) => [...bytes].map((n) => n.toString(16).padStart(2, "0")).join("");
const sha256 = async (text: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));

export const newToken = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
/** The server stores only hashes: a library is found by its sync key's hash, a shared world by its share key's hash. */
export const libraryId = async (sync: string) => hex(await sha256(`mirklurk/library\n${sync}`));
/** Read-only keys derive one-way from the sync key and a per-world salt, so a share key can never become a sync key. */
export const shareKey = async (sync: string, salt: string) => base64url(await sha256(`mirklurk/share\n${sync}\n${salt}`));
export const shareId = async (share: string) => hex(await sha256(`mirklurk/view\n${share}`));
/** Same character name and zone layout = same world, so uploading it again updates it instead of adding a copy. */
export const worldId = async (name: string, grid: number[][]) =>
  base64url(await sha256(`mirklurk/world\n${JSON.stringify([name, grid])}`)).slice(0, 22);

export function validName(name: unknown): name is string {
  return typeof name === "string" && name.length <= NAME_LENGTH && name === name.trim() && !hasControl(name);
}

/**
 * Links carry a key as 78 decimal digits rather than base64url: a QR code stores digits in numeric mode at 3.3 bits each, against 8 bits
 * for every base64url character, which keeps sharing QR codes one size smaller.
 */
export function linkKey(key: string): string {
  const bytes = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/") + "="), (c) => c.charCodeAt(0));
  return BigInt(`0x${hex(bytes)}`).toString().padStart(78, "0");
}
export function keyFromLink(digits: string): string | undefined {
  if (!/^\d{78}$/.test(digits)) return undefined;
  const value = BigInt(digits);
  if (value >> 256n) return undefined;
  return base64url(Uint8Array.from(value.toString(16).padStart(64, "0").match(/../g)!, (b) => parseInt(b, 16)));
}

/**
 * One-time sync codes, for devices that can't open a sync link, such as a Home Screen app on iPhone (links open in Safari, which keeps
 * separate storage). A code is 8 Crockford base32 characters (40 bits), works once and expires after PAIR_TTL. The browser that shows it
 * encrypts its sync key with a key derived from the code; the server keeps only that ciphertext, in memory, under the code's hash.
 */
export const PAIR_TTL = 10 * 60 * 1000;
export const PAIR_ID = /^[a-f0-9]{64}$/;
/** base64url of a 12-byte IV and the AES-GCM encryption of a 43-character key with its 16-byte tag. */
export const PAIR_BOX = /^[A-Za-z0-9_-]{95}$/;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const newPairCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => CROCKFORD[b & 31]).join("");
export const formatPairCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;
/** Reads a typed code: case, spaces and dashes don't matter, and O, I and L are read as 0, 1 and 1. */
export function pairCode(text: string): string | undefined {
  const code = text.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(code) ? code : undefined;
}
export const pairId = async (code: string) => hex(await sha256(`mirklurk/pair\n${code}`));
const pairCipher = async (code: string, usage: KeyUsage) =>
  crypto.subtle.importKey("raw", await sha256(`mirklurk/pair-key\n${code}`) as BufferSource, "AES-GCM", false, [usage]);

export async function sealPairing(code: string, key: string): Promise<{ id: string; box: string }> {
  const id = await pairId(code);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(id) },
      await pairCipher(code, "encrypt"),
      encoder.encode(key),
    ),
  );
  return { id, box: base64url(new Uint8Array([...iv, ...sealed])) };
}

/** The sync key inside a box, or undefined if the code doesn't open it. */
export async function openPairing(code: string, box: string): Promise<string | undefined> {
  if (!PAIR_BOX.test(box)) return undefined;
  const bytes = Uint8Array.from(atob(box.replace(/-/g, "+").replace(/_/g, "/") + "="), (c) => c.charCodeAt(0));
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.subarray(0, 12), additionalData: encoder.encode(await pairId(code)) },
      await pairCipher(code, "decrypt"),
      bytes.subarray(12),
    );
    const key = decoder.decode(plain);
    return TOKEN.test(key) ? key : undefined;
  } catch {
    return undefined;
  }
}

export function frame(header: unknown, body: Uint8Array): Uint8Array {
  const json = encoder.encode(JSON.stringify(header));
  const result = new Uint8Array(4 + json.length + body.length);
  new DataView(result.buffer).setUint32(0, json.length);
  result.set(json, 4);
  result.set(body, 4 + json.length);
  return result;
}

export function unframe(bytes: Uint8Array): { header: unknown; body: Uint8Array } {
  if (bytes.length < 4) throw new Error("Incomplete save package");
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (length > 1024 * 1024 || length > bytes.length - 4) throw new Error("Invalid save manifest size");
  return { header: JSON.parse(decoder.decode(bytes.subarray(4, 4 + length))), body: bytes.subarray(4 + length) };
}

function validPath(path: string): boolean {
  return path.length <= 240 && !path.includes("\\") && !hasControl(path) &&
    path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..") &&
    /\.(save|tmap|png|ini)$/i.test(path);
}

/** One character, uncompressed: limits apply to actual bytes, not a ZIP's claimed size. */
export async function packSave(files: FileMap, character: Character): Promise<Uint8Array> {
  const entries: { path: string; size: number; modified: number }[] = [];
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (const [path, source] of files) {
    if (!path.startsWith(character.root)) continue;
    const relative = path.slice(character.root.length);
    if (!validPath(relative)) continue;
    const bytes = await source.read();
    size += bytes.length;
    if (size > MAX_UPLOAD || entries.length >= MAX_FILES) throw new Error("Save exceeds the 64 MiB / 4,096-file sharing limit");
    entries.push({ path: relative, size: bytes.length, modified: source.lastModified ?? 0 });
    chunks.push(bytes);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  const result = frame({ name: character.name, entries }, body);
  unpackSave(result);
  return result;
}

export function unpackSave(bytes: Uint8Array): { name: string; files: FileMap; grid: number[][] } {
  if (bytes.length > MAX_UPLOAD) throw new Error("Save exceeds the 64 MiB sharing limit");
  const { header, body } = unframe(bytes);
  if (!header || typeof header !== "object" || !("name" in header) || !("entries" in header)) {
    throw new Error("Invalid save manifest");
  }
  const { name, entries } = header;
  if (typeof name !== "string" || !name.trim() || name.length > 100 || hasControl(name)) {
    throw new Error("Invalid character name");
  }
  if (!Array.isArray(entries) || !entries.length || entries.length > MAX_FILES) throw new Error("Invalid save file count");
  const files: FileMap = new Map();
  let offset = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") throw new Error("Invalid file entry");
    const { path, size, modified } = entry;
    if (
      typeof path !== "string" || !validPath(path) || files.has(`Shared/${path}`) ||
      !Number.isSafeInteger(size) || size < 0 || size > body.length - offset ||
      typeof modified !== "number" || !Number.isFinite(modified) || modified < 0
    ) throw new Error("Invalid save file entry");
    if (path.endsWith("Player.save") && path !== "Player.save") throw new Error("Upload only one character at a time");
    const content = body.subarray(offset, offset + size);
    files.set(`Shared/${path}`, { read: () => Promise.resolve(content), lastModified: modified || undefined });
    offset += size;
  }
  if (offset !== body.length) throw new Error("Unexpected trailing save data");
  // Validate synchronously from the manifest's player slice before accepting storage.
  const player = entries.find((entry) => entry.path === "Player.save");
  if (!player) throw new Error("Player.save is required");
  if (player.size > 4 * 1024 * 1024) throw new Error("Player.save exceeds the 4 MiB limit");
  let start = 0;
  for (const entry of entries) {
    if (entry === player) break;
    start += entry.size;
  }
  const { grid } = parsePlayer(decodeJson(body.subarray(start, start + player.size)));
  return { name, files, grid };
}

/** The world ID the server will compute for this character's package. */
export async function identify(files: FileMap, character: Character): Promise<string> {
  const player = files.get(`${character.root}Player.save`);
  if (!player) throw new Error("Player.save is required");
  return worldId(character.name, parsePlayer(decodeJson(await player.read())).grid);
}

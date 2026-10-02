import type { Character, FileMap } from "./files.ts";
import { decodeJson, parsePlayer } from "./save.ts";

export const MAX_UPLOAD = 64 * 1024 * 1024;
export const MAX_FILES = 4096;
export const SHARE_LIFETIME = 7 * 24 * 60 * 60 * 1000;
export const SHARE_INTERVAL = 30_000;
export const TOKEN = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const hasControl = (text: string) => [...text].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

export interface SharedInfo {
  id: string;
  name: string;
  created: number;
  updated: number;
  expires: number;
  version: string;
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

export function unpackSave(bytes: Uint8Array): { name: string; files: FileMap } {
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
  parsePlayer(decodeJson(body.subarray(start, start + player.size)));
  return { name, files };
}

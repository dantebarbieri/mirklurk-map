// The library API ("My worlds") as the map's sharing panel and the save editor both call it, and the library key this browser keeps.

import { libraryId, TOKEN } from "./sharing-format.ts";

/** Where the map keeps this browser's library (src/sharing.ts writes it); the editor only reads it. */
export const LIBRARY_STORAGE = "mirklurk-library-v1";

export class ShareError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Library calls carry its key in the Authorization header; claiming a sync code is the only call without one. */
export async function api(path: string, key: string | undefined, init: RequestInit = {}): Promise<Response> {
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

/** The keys of the libraries this browser keeps: the current one first, then the others saved to switch back to. */
function storedKeys(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(LIBRARY_STORAGE) ?? "null");
    const keys: unknown[] = [
      stored?.current?.key,
      ...(Array.isArray(stored?.saved) ? stored.saved.map((l: { key?: unknown }) => l?.key) : []),
    ];
    return keys.filter((key): key is string => typeof key === "string" && TOKEN.test(key));
  } catch {
    return [];
  }
}

/** The key of the library this browser uses, if the map has made or joined one. */
export function libraryKey(): string | undefined {
  const [key] = storedKeys();
  return key;
}

/** The key of the library with this ID (libraryId of its key) if this browser keeps it, current or saved to switch back to. */
export async function libraryKeyFor(library: string): Promise<string | undefined> {
  for (const key of storedKeys()) if (await libraryId(key) === library) return key;
}

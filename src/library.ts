// The library API ("My worlds") as the map's sharing panel and the save editor both call it, and the library key this browser keeps.

import { TOKEN } from "./sharing-format.ts";

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

/** The key of the library this browser uses, if the map has made or joined one. */
export function libraryKey(): string | undefined {
  try {
    const key = JSON.parse(localStorage.getItem(LIBRARY_STORAGE) ?? "null")?.current?.key;
    return typeof key === "string" && TOKEN.test(key) ? key : undefined;
  } catch {
    return undefined;
  }
}

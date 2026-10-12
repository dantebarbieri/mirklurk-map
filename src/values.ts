// The loosely typed JSON that saves hold: GameMaker writes records, lists and numbers without a schema, so readers check what
// they get. Shared by the map's parsers, the save editor's edits and MirkMap.json.

/** A JSON object, as saves keep their records. */
export type Rec = Record<string, unknown>;

/** A JSON object: neither null nor an array. */
export const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** A number that is neither NaN nor infinite. */
export const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** `v` when it is a finite number, else `fallback`. */
export const num = (v: unknown, fallback = 0): number => (finite(v) ? v : fallback);

/** `v` kept within 0–1. */
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

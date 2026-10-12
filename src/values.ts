// Numbers in the loosely typed JSON that saves hold: GameMaker writes them without a schema, so readers check what they get.
// Records (objects) are src/save-record.ts's.

/** A number that is neither NaN nor infinite. */
export const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** `v` when it is a finite number, else `fallback`. */
export const num = (v: unknown, fallback = 0): number => (finite(v) ? v : fallback);

/** `v` kept within 0–1. */
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

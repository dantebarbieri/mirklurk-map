// Raw JSON records shared by save readers and editors. Keep unknown fields intact when editing a record.

export type Rec = Record<string, unknown>;

export const isRec = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);

/** The record the game loads: the last element of Player.save's array (load_player array_pops it). */
export function playerRecord(raw: unknown): Rec {
  const player: unknown = Array.isArray(raw) ? raw[raw.length - 1] : undefined;
  if (!isRec(player)) throw new Error("Player.save has no player record");
  return player;
}

/** Missing optional area files are empty; malformed lists or records are not. */
export function recordList(raw: unknown): Rec[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every(isRec)) throw new Error("Invalid saved record list");
  return raw;
}

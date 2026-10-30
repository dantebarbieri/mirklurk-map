// Which game version's rules apply. A save names the version that wrote it (save_player's VERSION in Player.save), so MirkMap
// follows it. Steam runs one version now (0.9.2.0); for a save from an older version whose rules differ, the version switch can show
// Latest's instead, as the world will be once the current game saves it.

/** The game versions whose rules MirkMap has, oldest first. */
export const VERSIONS = ["0.8.1.5", "0.8.9.9", "0.9.0.0", "0.9.0.1", "0.9.0.2", "0.9.1.0", "0.9.1.2", "0.9.2.0"] as const;
export type GameVersion = (typeof VERSIONS)[number];

/**
 * Versions whose rules are an earlier version's: nothing MirkMap reads or writes changed. 0.9.0.0 released the 0.8.9.9 beta with
 * bug fixes only (its items, beings, texts and art are 0.8.9.9's), 0.9.0.2 changed no more than bugs in 0.9.0.1, and 0.9.1.2 no more
 * than bugs in 0.9.1.0.
 */
const SAME_RULES: Readonly<Partial<Record<GameVersion, GameVersion>>> = {
  "0.9.0.0": "0.8.9.9",
  "0.9.0.2": "0.9.0.1",
  "0.9.1.2": "0.9.1.0",
};

/** Whether versions `a` and `b` have the same rules. */
export const sameRules = (a: GameVersion, b: GameVersion) => (SAME_RULES[a] ?? a) === (SAME_RULES[b] ?? b);

/** Steam's branches: the release, and an opt-in beta while there is one. */
export type Channel = "latest" | "beta";

/**
 * The version each Steam branch runs. This is the one place to change when a version is released: point `latest` at it, and
 * `beta` at a new opt-in beta while one is out (omitted when there is none, as now: the switch then offers no Beta).
 */
export const CHANNELS: Readonly<{ latest: GameVersion; beta?: GameVersion }> = { latest: "0.9.2.0" };
export const CHANNEL_LABELS: Readonly<Record<Channel, string>> = { latest: "Latest", beta: "Beta" };
/** What each branch is on Steam, for the switch's tooltip. */
export const CHANNEL_NOTES: Readonly<Record<Channel, string>> = {
  latest: "the game's Steam release",
  beta: "the opt-in Steam beta",
};

/** The branches running now. */
export const channelsOf = (channels: Readonly<Partial<Record<Channel, GameVersion>>>): Channel[] =>
  (Object.keys(CHANNEL_LABELS) as Channel[]).filter((c) => channels[c] !== undefined);

/** "0.8.9.9" as [0, 8, 9, 9]; undefined when it is not a dotted version. */
function parts(v: string): number[] | undefined {
  return /^\d+(\.\d+)*$/.test(v.trim()) ? v.trim().split(".").map(Number) : undefined;
}

/** Orders two dotted versions; missing parts count as 0 ("0.9" is "0.9.0.0"). */
function compare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/**
 * The rules for a save's VERSION: the newest version MirkMap knows that is no newer than it, so a save from a later build gets the
 * newest rules and one from before the oldest the oldest. Undefined when the save names no readable version.
 */
export function detectVersion(version: string | undefined): GameVersion | undefined {
  const v = version === undefined ? undefined : parts(version);
  if (!v) return undefined;
  let found: GameVersion = VERSIONS[0];
  for (const known of VERSIONS) if (compare(parts(known)!, v) <= 0) found = known;
  return found;
}

/**
 * What a pick on the version switch overrides: nothing when it is the version the save names, so the rules follow the save
 * again, also after a reload finds the save now names the version picked.
 */
export const overrideOf = (pick: GameVersion | undefined, detected: GameVersion | undefined): GameVersion | undefined =>
  pick === detected ? undefined : pick;

/** Whether rules `v` include what version `since` brought. */
export const atLeast = (v: GameVersion, since: GameVersion) => VERSIONS.indexOf(v) >= VERSIONS.indexOf(since);

/** The branch that runs version `v`, if one does. */
export const channelOf = (v: GameVersion): Channel | undefined => channelsOf(CHANNELS).find((c) => CHANNELS[c] === v);

/** "Latest (0.9.2.0)", or the bare version when no branch runs it any more. */
export function versionLabel(v: GameVersion): string {
  const c = channelOf(v);
  return c ? `${CHANNEL_LABELS[c]} (${v})` : v;
}

/** The switch's tooltip: what each branch is and runs. */
export const CHANNELS_TOOLTIP = channelsOf(CHANNELS)
  .map((c) => `${CHANNEL_LABELS[c]}: Mirklurk ${CHANNELS[c]}, ${CHANNEL_NOTES[c]}`)
  .join("\n");

/**
 * What each version added to the item and being databases (global.itemDB in gml_Object_databank_Alarm_1, global.beingDB in
 * Alarm_3), as inclusive index ranges. An older game has no data for these: a save holding one fails to load there.
 */
const ADDED: Readonly<Partial<Record<GameVersion, { items?: [number, number]; beings?: [number, number] }>>> = {
  "0.8.9.9": { items: [258, 275], beings: [36, 41] },
  // Flint (Large) and the Flint Dagger made from it.
  "0.9.1.0": { items: [276, 277] },
};

const addedIn = (key: "items" | "beings", index: number): GameVersion | undefined =>
  VERSIONS.find((v) => {
    const r = ADDED[v]?.[key];
    return !!r && index >= r[0] && index <= r[1];
  });

/** Whether version `v`'s game knows item `index`. */
export const hasItem = (v: GameVersion, index: number) => {
  const since = addedIn("items", index);
  return !since || atLeast(v, since);
};

/** Whether version `v`'s game knows being `index`. */
export const hasBeing = (v: GameVersion, index: number) => {
  const since = addedIn("beings", index);
  return !since || atLeast(v, since);
};

/** The version MirkMap's newest rules come from: what it was last read from (the build its generated data matches). */
export const NEWEST: GameVersion = VERSIONS[VERSIONS.length - 1];

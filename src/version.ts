// Which game version's rules apply. Steam offers Mirklurk on two branches: the default one and an opt-in beta
// (next_version_tester). A save names the version that wrote it (save_player's VERSION in Player.save), so MirkMap follows it; the
// Latest/Beta toggle can still pick the other branch's rules, for a world you are about to play on that branch.

/** The game versions whose rules MirkMap has, oldest first. */
export const VERSIONS = ["0.8.1.5", "0.8.9.9"] as const;
export type GameVersion = (typeof VERSIONS)[number];

/**
 * Steam's branches and the version each one runs. This is the one place to change when a beta becomes the release: point
 * `latest` at it (and `beta` at the next beta, or at the same version until there is one).
 */
export const CHANNELS = { latest: "0.8.1.5", beta: "0.8.9.9" } as const satisfies Record<string, GameVersion>;
export type Channel = keyof typeof CHANNELS;
export const CHANNEL_LABELS: Readonly<Record<Channel, string>> = { latest: "Latest", beta: "Beta" };
/** What each branch is on Steam, for the toggle's tooltip. */
export const CHANNEL_NOTES: Readonly<Record<Channel, string>> = {
  latest: "the game's default Steam branch",
  beta: "the opt-in Steam beta, next_version_tester",
};

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
 * What a pick on the Latest/Beta switch overrides: nothing when it is the version the save names, so the rules follow the save
 * again, also after a reload finds the save now names the version picked.
 */
export const overrideOf = (pick: GameVersion | undefined, detected: GameVersion | undefined): GameVersion | undefined =>
  pick === detected ? undefined : pick;

/** Whether rules `v` include what version `since` brought. */
export const atLeast = (v: GameVersion, since: GameVersion) => VERSIONS.indexOf(v) >= VERSIONS.indexOf(since);

/** The branch that runs version `v`, if one does. */
export const channelOf = (v: GameVersion): Channel | undefined => (Object.keys(CHANNELS) as Channel[]).find((c) => CHANNELS[c] === v);

/** "Latest (0.8.1.5)", or the bare version when no branch runs it any more. */
export function versionLabel(v: GameVersion): string {
  const c = channelOf(v);
  return c ? `${CHANNEL_LABELS[c]} (${v})` : v;
}

/** The toggle's tooltip: what each branch is and runs. */
export const CHANNELS_TOOLTIP = (Object.keys(CHANNELS) as Channel[])
  .map((c) => `${CHANNEL_LABELS[c]}: Mirklurk ${CHANNELS[c]}, ${CHANNEL_NOTES[c]}`)
  .join("\n");

/**
 * What each version added to the item and being databases (global.itemDB in gml_Object_databank_Alarm_1, global.beingDB in
 * Alarm_3), as inclusive index ranges. An older game has no data for these: a save holding one fails to load there.
 */
const ADDED: Readonly<Partial<Record<GameVersion, { items: [number, number]; beings: [number, number] }>>> = {
  "0.8.9.9": { items: [258, 275], beings: [36, 41] },
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

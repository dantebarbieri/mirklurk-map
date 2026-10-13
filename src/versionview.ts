// The Latest/Beta switch: which game version's rules MirkMap and the save editor follow (version.ts).

import { h } from "./dom.ts";
import { NO_VERSION } from "./save.ts";
import { type Channel, CHANNEL_LABELS, CHANNEL_NOTES, CHANNELS, CHANNELS_TOOLTIP, type GameVersion, VERSIONS } from "./version.ts";

/** Where the rules in use come from. */
export interface VersionChoice {
  /** The rules the save's VERSION names; undefined when it names none. */
  detected?: GameVersion;
  /** The rules in use. */
  rules: GameVersion;
  /** The save's VERSION as written (PlayerSave.version, NO_VERSION when it has none). */
  saved?: string;
}

/** Steam's branches and the version each runs (version.ts's CHANNELS; tests pass others, as after a release). */
type Channels = Readonly<Record<Channel, GameVersion>>;

/** A button of the switch. */
export interface SwitchOption {
  version: GameVersion;
  label: string;
  title: string;
}

/**
 * The switch's buttons, oldest version first: one per branch, a single one while both run the same version, and the save's own
 * version too when no branch runs it any more, so the save can always be followed again.
 */
export function switchOptions(choice: VersionChoice, channels: Channels = CHANNELS): SwitchOption[] {
  const own = (v: GameVersion) => (v === choice.detected ? "; this save's version" : "");
  const out: SwitchOption[] = [];
  for (const c of Object.keys(channels) as Channel[]) {
    const v = channels[c];
    if (!out.some((o) => o.version === v)) {
      out.push({ version: v, label: CHANNEL_LABELS[c], title: `Mirklurk ${v}, ${CHANNEL_NOTES[c]}${own(v)}` });
    }
  }
  const d = choice.detected;
  if (d && !out.some((o) => o.version === d)) out.push({ version: d, label: d, title: `Mirklurk ${d}, on no Steam branch now${own(d)}` });
  return out.sort((a, b) => VERSIONS.indexOf(a.version) - VERSIONS.indexOf(b.version));
}

/** The rules followed without a pick: the save's, or Latest's when it names no version. */
export const ownRules = ({ detected }: VersionChoice, channels: Channels = CHANNELS): GameVersion => detected ?? channels.latest;

/** The save's VERSION as written, or undefined when it has none. */
const namedVersion = (saved: string | undefined) => {
  const v = saved?.trim();
  return v && v !== NO_VERSION ? v : undefined;
};

/** The note beside the switch: whether the rules follow the save, and which version it names. */
export function versionNote(choice: VersionChoice, channels: Channels = CHANNELS): string {
  const { detected } = choice;
  const named = namedVersion(choice.saved);
  const chosen = choice.rules === ownRules(choice, channels) ? "" : "chosen; ";
  if (!detected) return `${chosen}${named ? `this save's version, ${named}, is unreadable` : "this save names no version"}`;
  if (chosen) return `${chosen}this save is ${named ?? detected}`;
  return `from this save (${named && named !== detected ? `${named}, so ${detected}'s rules` : detected})`;
}

/** The switch's tooltip: what each branch runs, and how the rules are picked. */
export function versionTitle(choice: VersionChoice, extra?: string): string {
  return [
    CHANNELS_TOOLTIP,
    "",
    choice.detected
      ? "MirkMap follows the version this save names. Pick the other to see the rules of that version, as when you take this save to the other branch; pick the save's own to follow it again."
      : "This save names no version, so MirkMap follows Latest's rules unless you pick another.",
    ...(extra ? ["", extra] : []),
  ].join("\n");
}

/**
 * A Latest/Beta switch for `choice`. `pick` gets the version clicked, or undefined when it is the save's own (follow the save
 * again); the caller re-renders.
 */
export function versionSwitch(
  choice: VersionChoice,
  pick: (v: GameVersion | undefined) => void,
  extra?: string,
  channels: Channels = CHANNELS,
): HTMLElement {
  const own = ownRules(choice, channels);
  const buttons = switchOptions(choice, channels).map(({ version, label, title }) =>
    h("button", {
      type: "button",
      "aria-pressed": String(version === choice.rules),
      title,
      onclick: () => {
        if (version !== choice.rules) pick(version === own ? undefined : version);
      },
    }, label)
  );
  return h(
    "span",
    { class: "version-switch", title: versionTitle(choice, extra) },
    h("span", { class: "coin-mode version-mode", role: "group", "aria-label": "Game version rules" }, buttons),
    h("span", { class: choice.rules === own ? "muted version-note" : "version-note chosen" }, versionNote(choice, channels)),
  );
}

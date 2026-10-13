// The Latest/Beta switch: which game version's rules MirkMap and the save editor follow (version.ts).

import { h } from "./dom.ts";
import { type Channel, CHANNEL_LABELS, CHANNEL_NOTES, CHANNELS, CHANNELS_TOOLTIP, type GameVersion } from "./version.ts";

/** Where the rules in use come from. */
export interface VersionChoice {
  /** The rules the save's VERSION names; undefined when it names none. */
  detected?: GameVersion;
  /** The rules in use. */
  rules: GameVersion;
  /** The save's VERSION as written, when it has one. */
  saved?: string;
}

/** The switch's buttons: one per branch, and one only while both run the same version. */
export const switchChannels = (): Channel[] =>
  (Object.keys(CHANNELS) as Channel[]).filter((c, i, all) => all.findIndex((d) => CHANNELS[d] === CHANNELS[c]) === i);

/** The rules followed without a pick: the save's, or Latest's when it names no version. */
export const ownRules = ({ detected }: VersionChoice): GameVersion => detected ?? CHANNELS.latest;

/** The note beside the switch: whether the rules follow the save, and which version it names. */
export function versionNote(choice: VersionChoice): string {
  const { detected, saved } = choice;
  const named = saved?.trim() || undefined;
  const chosen = choice.rules === ownRules(choice) ? "" : "chosen; ";
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
export function versionSwitch(choice: VersionChoice, pick: (v: GameVersion | undefined) => void, extra?: string): HTMLElement {
  const buttons = switchChannels().map((c) => {
    const v = CHANNELS[c];
    const own = v === ownRules(choice);
    return h("button", {
      type: "button",
      "aria-pressed": String(v === choice.rules),
      title: `Mirklurk ${v}, ${CHANNEL_NOTES[c]}${v === choice.detected ? "; this save's version" : ""}`,
      onclick: () => {
        if (v !== choice.rules) pick(own ? undefined : v);
      },
    }, CHANNEL_LABELS[c]);
  });
  const note = versionNote(choice);
  return h(
    "span",
    { class: "version-switch", title: versionTitle(choice, extra) },
    h("span", { class: "coin-mode version-mode", role: "group", "aria-label": "Game version rules" }, buttons),
    h("span", { class: choice.rules === ownRules(choice) ? "muted version-note" : "version-note chosen" }, note),
  );
}

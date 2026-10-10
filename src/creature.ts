// A creature's or NPC's hit points, attacks and combat stats, as the game's examine card shows them (case 11 in
// gml_Object_UI_Draw_64); the numbers and rules are in bestiary.ts.

import {
  type Attack,
  BEINGS,
  type BeingStats,
  canHurt,
  damageCell,
  damageClassInfo,
  damageText,
  formatPercent,
  formatTiles,
  freshHealth,
  hardIq,
  INTELLIGENCE,
  targetsYou,
  totalDamage,
  turnsPattern,
} from "./bestiary.ts";
import { h } from "./dom.ts";
import { type HealthGrid, healthGridView, healthLegend, parseHealth, summarize } from "./health.ts";
import { section, type SectionContext, wikiLink } from "./inspect.ts";
import { wikiUrl } from "./wiki.ts";

/** The Melee/Ranged choice, kept for every being with both and across re-renders. */
let showRanged = false;

/** global.GAMEDIFF on Hard (myDiff in Player.save). */
const HARD = 3;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const amount = (hp: number, armor: number) => `${plural(hp, "hit point")}${armor ? `, ${armor} armor` : ""}`;

/** The saved grid against a fresh one's (being_initiate), or the fresh shape when the save has none. */
function hitPoints(being: number, saved: HealthGrid | undefined): HTMLElement[] {
  const cells = freshHealth(being);
  const fresh = cells && parseHealth(cells);
  const full = fresh && summarize(fresh);
  if (!saved) {
    if (!fresh || !full) return [h("p", { class: "muted" }, "Its hit points were not saved.")];
    return [
      healthGridView(fresh, `At full health: ${amount(full.total, full.armor)}.`),
      h("p", { class: "muted creature-note" }, "Its hit points were not saved; this is how a fresh one spawns."),
      healthLegend(fresh),
    ];
  }
  const now = summarize(saved);
  let note = "";
  if (fresh && full && fresh.w === saved.w && fresh.h === saved.h) {
    const hp = full.total - now.healthy, armor = full.armor - now.armor;
    const down = [hp > 0 ? plural(hp, "hit point") : "", armor > 0 ? `${armor} armor` : ""].filter(Boolean).join(" and ");
    note = down
      ? `Full health: ${amount(full.total, full.armor)}; down ${down}.`
      : full.armor
      ? "At full health, armor intact."
      : "At full health.";
  } else if (full) {
    note = `A fresh one has ${amount(full.total, full.armor)}.`;
  }
  const out = [healthGridView(saved)];
  if (note) out.push(h("p", { class: "muted creature-note" }, note));
  out.push(healthLegend(saved));
  return out;
}

const row = (label: string, value: string, more = "", title?: string) => [
  h("dt", {}, label),
  h("dd", { title }, value, more ? h("span", { class: "muted" }, more) : null),
];

const cellText = (v: number) => {
  const d = damageCell(v);
  return d ? damageText(d) : "";
};

/** How well it aims in this save: one level better on Hard; both when the difficulty is unknown. */
function aim(iq: number, difficulty: number | undefined): { level: number; text: string } {
  const base = INTELLIGENCE[iq], hard = INTELLIGENCE[hardIq(iq)];
  if (difficulty === undefined) return { level: iq, text: `: ${base.aim}${hard !== base ? ` (${hard.name} on Hard)` : ""}` };
  const now = difficulty === HARD ? hard : base;
  return { level: difficulty === HARD ? hardIq(iq) : iq, text: `: ${now.aim}${now !== base ? " (one level up on Hard)" : ""}` };
}

/** The pattern as the examine card draws it: a square with its damage ("2" or "1–2") for each cell that hits. */
function patternView(a: Attack, key: string, difficulty: number | undefined): HTMLElement {
  const w = a.pattern[0].length;
  const label = `Attack pattern, ${w} by ${a.pattern.length}: ${
    a.pattern.map((r) => r.map((v) => cellText(v) || "no hit").join(", ")).join("; ")
  }`;
  const turned = turnsPattern(a, aim(a.iq, difficulty).level)
    ? "; it may strike with it turned"
    : difficulty === undefined && turnsPattern(a, hardIq(a.iq))
    ? "; on Hard it may strike with it turned"
    : "";
  return h(
    "figure",
    { class: `atk dmg-${key}` },
    h(
      "div",
      { class: "atk-grid", role: "img", "aria-label": label, style: `grid-template-columns: repeat(${w}, var(--atk-cell))` },
      a.pattern.flat().map((v) => h("span", { class: cellText(v) ? "atk-cell hit" : "atk-cell" }, cellText(v))),
    ),
    h("figcaption", { class: "muted" }, `${damageText(totalDamage(a.pattern))} damage when every cell lands on a hit point${turned}`),
  );
}

function attackView(s: BeingStats, a: Attack, ranged: boolean, difficulty: number | undefined): HTMLElement[] {
  const info = damageClassInfo(a.damageClass);
  if (!info || !canHurt(a)) return [h("p", { class: "muted" }, ranged ? "No ranged attack." : "No melee attack.")];
  const iq = aim(a.iq, difficulty);
  return [
    h(
      "p",
      { class: "attack-class" },
      h("span", { class: `dmg dmg-${info.key}`, title: info.effect }, info.name),
      " ",
      h("span", { class: "muted" }, info.effect),
    ),
    patternView(a, info.key, difficulty),
    h(
      "dl",
      { class: "creature-stats" },
      row(
        "Reach",
        formatTiles(a.dist),
        ranged ? ", used once you are out of its melee reach and in its line of sight" : "",
        `${a.dist} tiles, centre to centre`,
      ),
      row("Cost", `${a.cost} AP`, ` of its ${s.apMax} a turn`),
      row("Intelligence", INTELLIGENCE[iq.level].name, iq.text),
    ),
  ];
}

/** The melee attack, or a Melee/Ranged toggle that swaps the pattern and its details in place. */
function attackSection(s: BeingStats, difficulty: number | undefined): HTMLElement[] {
  const { melee, ranged } = s;
  if (!canHurt(melee) && !ranged) return [h("p", { class: "muted" }, "It does not attack.")];
  const body = h("div", { class: "attack-body" });
  if (!ranged) {
    body.append(...attackView(s, melee, false, difficulty));
    return [body];
  }
  const render = () => {
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", String((i === 1) === showRanged)));
    body.replaceChildren(...attackView(s, showRanged ? ranged : melee, showRanged, difficulty));
  };
  const buttons = [melee, ranged].map((a, i) => {
    const info = damageClassInfo(a.damageClass);
    return h(
      "button",
      {
        type: "button",
        class: `attack-mode dmg-${info?.key ?? "none"}`,
        onclick: () => {
          showRanged = i === 1;
          render();
        },
      },
      h("span", { class: "dmg-dot", "aria-hidden": "true" }),
      i ? "Ranged" : "Melee",
      info ? h("span", { class: "muted" }, ` ${info.name}`) : null,
    );
  });
  render();
  return [h("div", { class: "attack-toggle", role: "group", "aria-label": "Attack to show" }, buttons), body];
}

function hostility(s: BeingStats): [string, string] {
  const odds = `${formatPercent(s.hostileChance)} a turn`;
  if (!targetsYou(s)) {
    return ["Never targets you", s.hostileChance > 0 ? `; turns on creatures within ${formatTiles(s.hostileDist)} (${odds})` : ""];
  }
  return s.hostileChance > 0 ? [odds, ` once you are within ${formatTiles(s.hostileDist)} and in sight`] : ["Never hostile", ""];
}

/** The rest of the examine card, and the XP. */
function behaviour(s: BeingStats): HTMLElement {
  return h(
    "dl",
    { class: "creature-stats" },
    row("Movement", `${formatTiles(s.tilespeed)} a turn`),
    row("Hostility", ...hostility(s)),
    row("Dodge", formatPercent(s.dodgeChance), "", "Chance it shifts its hit points aside when attacked, so blows can miss"),
    row(
      "Attack of opportunity",
      formatPercent(s.aooChance),
      "",
      "Chance it strikes when you leave its melee reach; jumping away avoids it",
    ),
    row("Experience", `${s.xp} XP`, " if it dies after you hit it"),
  );
}

const sectioned = (el: HTMLElement) => (el.classList.add("creature-section"), el);

/** Inspection sections for a living being: its saved hit points, its attacks (melee/ranged) and its combat stats. */
export function creatureView(being: number, health: HealthGrid | undefined, ctx: SectionContext): HTMLElement[] {
  const s = BEINGS[being];
  if (!s) return health ? [sectioned(section(ctx, "hit-points", "Hit points", true, healthGridView(health), healthLegend(health)))] : [];
  const now = health && summarize(health);
  const title = now ? `Hit points (${now.healthy} of ${now.total})` : "Hit points";
  return [
    sectioned(section(ctx, "hit-points", title, true, ...hitPoints(being, health))),
    sectioned(section(ctx, "attack", s.ranged ? "Attacks" : "Attack", true, ...attackSection(s, ctx.difficulty))),
    sectioned(section(ctx, "behaviour", "Behaviour", true, behaviour(s))),
    h(
      "p",
      { class: "creature-links" },
      wikiLink(wikiUrl("Damage types"), "Damage types"),
      wikiLink(wikiUrl("Health and armor"), "Health and armor"),
    ),
  ];
}

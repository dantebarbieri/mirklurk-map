// The player's saved condition and belongings: hit points, wellbeing and the four stats behind it, conditions, coins and
// inventory. Wellbeing math is ported from Mirklurk 0.8.1.5: player_get_stat_changes and player_get_combined_wellbeing in
// gml_GlobalScript_scr_basic_useful, with the thresholds set in gml_Room_rm_int_Create, as the circle bar in
// gml_Object_UI_Draw_64 reports them.

import { type Coins, coinsView, coinValue, countCoins, fewestCoins } from "./coins.ts";
import { ARMOR, armorToPlace, isWeaponSlot, itemArmor, SLOT_NAMES, totalArmor } from "./armor.ts";
import { h } from "./dom.ts";
import { ITEM_NAMES } from "./gamedata.ts";
import { healthGridView, healthLegend, type HealthSummary, summarize } from "./health.ts";
import type { Inventory, SavedItem } from "./inventory.ts";
import { inventoryView, section, type SectionContext, wikiLink, wikiTitle } from "./inspect.ts";
import type { PlayerSave } from "./save.ts";
import { wikiUrl } from "./wiki.ts";

export type Stat = "focus" | "stamina" | "satiation" | "warmth";
/** In the order the card lists them. */
export const STATS: readonly Stat[] = ["focus", "stamina", "satiation", "warmth"];

/** The game calls them Focus, Stamina, Satiation and Warmth (UI.ini); warmth is the body's temperature. */
export const STAT_LABELS: Readonly<Record<Stat, string>> = {
  focus: "Focus",
  stamina: "Stamina",
  satiation: "Satiation",
  warmth: "Warmth (temperature)",
};
const STAT_WIKI: Readonly<Record<Stat, string>> = { focus: "Focus", stamina: "Stamina", satiation: "Satiation", warmth: "Temperature" };

/** global.hungerGainTresh … warmthLoseHigh (gml_Room_rm_int_Create); satiation, focus and stamina share the first two. */
export const GAIN_AT = 0.5, LOSE_BELOW = 0.2, COMFORT_LOW = 0.4, COMFORT_HIGH = 0.6;
/** At or below this the game flags wellbeing as dangerously low while it falls (aeList 30, gml_Object_obj_player_Step_0). */
export const DANGER = 0.33;

/** player_get_stat_changes: [wellbeing lost per turn at 0, gained per turn from GAIN_AT]. Warmth loses at both ends instead. */
const RATES: Readonly<Record<Stat, readonly [number, number]>> = {
  satiation: [0.01, 0.005],
  focus: [0.005, 0.002],
  stamina: [0.005, 0.002],
  warmth: [0.03, 0],
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** GameMaker's round() breaks ties to the even neighbour. */
function gmRound(v: number): number {
  const r = Math.round(v);
  return r - v === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** One stat's change to wellbeing per turn (player_get_stat_changes), rounded to 0.1% as the game does. */
export function statChange(stat: Stat, v: number): number {
  let ret = 0;
  if (stat === "warmth") {
    if (v <= COMFORT_LOW) ret = -RATES.warmth[0] * clamp01((COMFORT_LOW - v) / COMFORT_LOW);
    else if (v >= COMFORT_HIGH) ret = -RATES.warmth[0] * clamp01((v - COMFORT_HIGH) / (1 - COMFORT_HIGH));
  } else {
    const [lose, gain] = RATES[stat];
    if (v < LOSE_BELOW) ret = -lose * clamp01((LOSE_BELOW - v) / LOSE_BELOW);
    else if (v >= GAIN_AT) ret = gain;
  }
  return gmRound(ret / 0.001) * 0.001 + 0;
}

/** A share as a percentage, whole or to one decimal like the game's tooltips ("41.8%", "100%"). */
export const percent = (v: number) => `${Math.round(v * 1000) / 10 + 0}%`;
/** A change with its sign: "+0.5%", "−1.7%", "±0%". */
export const signedPercent = (c: number) => `${c > 0 ? "+" : c < 0 ? "−" : "±"}${percent(Math.abs(c))}`;

/** temperature_get_label (gml_GlobalScript_scr_map_and_weather) with UI.ini [Weather] Temp0–6: [up to, label]. */
const TEMPERATURES: readonly [number, string][] = [
  [0.15, "Biting cold"],
  [0.3, "Very cold"],
  [0.4, "Cold"],
  [0.6, "Comfortable"],
  [0.7, "Warm"],
  [0.85, "Very hot"],
];
export const temperatureLabel = (w: number) => TEMPERATURES.find(([max]) => w <= max)?.[1] ?? "Blazing hot";

export type Tone = "gain" | "loss" | "none";
const toneOf = (c: number): Tone => c > 0 ? "gain" : c < 0 ? "loss" : "none";

export interface StatStatus {
  /** Wellbeing per turn, as a fraction. */
  change: number;
  tone: Tone;
  text: string;
}

/** What a stat does to wellbeing right now, in words. */
export function statStatus(stat: Stat, v: number): StatStatus {
  const change = statChange(stat, v);
  const tone = toneOf(change);
  const perTurn = `${signedPercent(change)} wellbeing per turn`;
  if (stat === "warmth") {
    const label = temperatureLabel(v);
    if (change < 0) return { change, tone, text: `${label}: ${perTurn}` };
    return {
      change,
      tone,
      text: v > COMFORT_LOW && v < COMFORT_HIGH ? "Comfortable: no effect on wellbeing" : `${label}, but no effect yet`,
    };
  }
  if (change > 0) return { change, tone, text: `Raising wellbeing: ${perTurn}` };
  if (change < 0) return { change, tone, text: `Too low: ${perTurn}` };
  return {
    change,
    tone,
    text: v < LOSE_BELOW ? "Low, but no effect yet" : `No effect on wellbeing; from ${percent(GAIN_AT)} it raises it`,
  };
}

export interface WellbeingPart {
  label: string;
  /** Wellbeing per turn, as a fraction. */
  change: number;
  stat?: Stat;
}

export interface WellbeingChange {
  /** The net change per turn at save time. */
  total: number;
  /** The four stats (always), then any active bonus or penalty. */
  parts: WellbeingPart[];
}

/** Effect indices in aeList (UI.ini [AEs]) that change wellbeing directly. */
const Ae = { Sickness1: 17, Sickness3: 19, VeryOverburdened: 25, ExtremelyOverburdened: 26 } as const;
const ROMAN = ["I", "II", "III"];

/** The worst sickness in aeList: 1–3, or 0. */
export function sicknessLevel(effects: readonly number[]): number {
  for (let i = Ae.Sickness3; i >= Ae.Sickness1; i--) if (effects.includes(i)) return i - Ae.Sickness1 + 1;
  return 0;
}

type Wellbeing = Pick<PlayerSave, "vitals" | "effects" | "sickTime" | "warmthTime" | "restedTime">;

/** player_get_combined_wellbeing: how much wellbeing changes per turn, and why; undefined when the stats were not saved. */
export function wellbeingChange(p: Wellbeing): WellbeingChange | undefined {
  if (!p.vitals) return undefined;
  const vitals = p.vitals;
  const parts: WellbeingPart[] = STATS.map((stat) => ({ label: STAT_LABELS[stat], change: statChange(stat, vitals[stat]), stat }));
  if (p.warmthTime > 0) parts.push({ label: "Warm to the core", change: 0.01 });
  if (p.restedTime > 0) parts.push({ label: "Well rested", change: 0.01 });
  // The game reads the level from aeList while sickTime lasts; without one it would misread it, so that state is skipped.
  const sick = p.sickTime > 0 ? sicknessLevel(p.effects) : 0;
  if (sick) parts.push({ label: `Sickness ${ROMAN[sick - 1]}`, change: -sick / 100 });
  if (p.effects.includes(Ae.VeryOverburdened)) parts.push({ label: "Very overburdened", change: -0.01 });
  else if (p.effects.includes(Ae.ExtremelyOverburdened)) parts.push({ label: "Extremely overburdened", change: -0.02 });
  const total = Math.round(parts.reduce((s, x) => s + x.change, 0) * 1000) / 1000 + 0;
  return { total, parts };
}

/** Where wellbeing is heading, in words. */
export function wellbeingTrend(wellbeing: number, total: number): string {
  if (total < 0) return wellbeing <= DANGER ? "Dangerously low and falling" : "Falling";
  if (total > 0) return wellbeing >= 1 ? "Full: it cannot rise above 100%" : "Rising";
  return "Steady";
}

export type ConditionTone = "good" | "bad" | "info";

export interface ConditionInfo {
  label: string;
  tone: ConditionTone;
  effect?: string;
}

/** Short names for the active effects in aeList, with what they do (paraphrasing UI.ini [AEs] and its tooltips). */
export const CONDITIONS: Readonly<Record<number, ConditionInfo>> = {
  0: { label: "Low stamina", tone: "bad", effect: "more risk of accidents" },
  1: { label: "Very low stamina", tone: "bad", effect: "more risk of accidents" },
  2: { label: "Exhausted", tone: "bad", effect: "stamina extremely low; more risk of accidents" },
  3: { label: "Tired", tone: "bad", effect: "less focused; more risk of accidents" },
  4: { label: "Very tired", tone: "bad", effect: "unfocused; more risk of accidents" },
  5: { label: "Sleep deprived", tone: "bad", effect: "unable to focus; more risk of accidents" },
  6: { label: "Feet partly submerged", tone: "info" },
  7: { label: "Feet submerged", tone: "info" },
  8: { label: "Legs partly submerged", tone: "info" },
  9: { label: "Legs almost submerged", tone: "info" },
  10: { label: "Waist deep", tone: "bad" },
  11: { label: "Chest deep", tone: "bad" },
  12: { label: "Shoulder deep", tone: "bad" },
  13: { label: "Chin deep", tone: "bad" },
  14: { label: "Drowning", tone: "bad", effect: "fully submerged" },
  15: { label: "Downed", tone: "bad", effect: "no actions until you get up, which costs 4 AP" },
  16: { label: "Lit item", tone: "info", effect: "burns for a limited time" },
  17: { label: "Sickness I", tone: "bad", effect: "−1% wellbeing per turn" },
  18: { label: "Sickness II", tone: "bad", effect: "−2% wellbeing per turn" },
  19: { label: "Sickness III", tone: "bad", effect: "−3% wellbeing per turn" },
  20: { label: "Warm to the core", tone: "good", effect: "loses warmth 50% slower; +1% wellbeing per turn" },
  21: { label: "Well fed", tone: "good", effect: "loses 50% less stamina" },
  22: { label: "Well rested", tone: "good", effect: "+1% wellbeing per turn" },
  23: { label: "Some shelter", tone: "good", effect: "80% cover from rain; cools you slightly when warm" },
  24: { label: "Overburdened", tone: "bad", effect: "moving and jumping cost 20% more AP; more risk of accidents" },
  25: { label: "Very overburdened", tone: "bad", effect: "moving and jumping cost 60% more AP; −1% wellbeing per turn" },
  26: { label: "Extremely overburdened", tone: "bad", effect: "moving and jumping cost twice the AP; −2% wellbeing per turn" },
  27: { label: "Swimming", tone: "info", effect: "you drown when stamina runs out" },
  28: { label: "Companion", tone: "good", effect: "someone aids you" },
  29: { label: "Stamina boost", tone: "good", effect: "+12% stamina each turn" },
  30: { label: "Wellbeing dangerously low", tone: "bad", effect: "and still falling" },
  31: { label: "Great shelter", tone: "good", effect: "95% cover from rain; cools you when warm" },
};

export interface Condition extends ConditionInfo {
  index: number;
  /** Turns left, for effects whose timer is saved (sickTime, warmthTime, restedTime). */
  turns?: number;
}

/** The saved aeList as conditions, in the order they were gained. */
export function conditionsOf(p: Pick<PlayerSave, "effects" | "sickTime" | "warmthTime" | "restedTime">): Condition[] {
  const timer = (i: number) => i >= Ae.Sickness1 && i <= Ae.Sickness3 ? p.sickTime : i === 20 ? p.warmthTime : i === 22 ? p.restedTime : 0;
  return [...new Set(p.effects)].map((index) => {
    const info: ConditionInfo = CONDITIONS[index] ?? { label: `Condition ${index}`, tone: "info" };
    const t = timer(index);
    return { index, ...info, ...(t > 0 ? { turns: Math.ceil(t) } : {}) };
  });
}

/** wetness[0–3] (player_wet_submerged in gml_GlobalScript_scr_basic_useful). */
const BODY = ["head", "torso", "legs", "feet"];

/** Wet clothing by body part ("torso 40%"), skipping dry ones. */
export const wetClothes = (wetness: readonly number[]) =>
  wetness.flatMap((v, i) => BODY[i] && Math.round(v * 100) >= 1 ? [`${BODY[i]} ${percent(Math.min(1, v))}`] : []);

/** xp_to_lvl (gml_GlobalScript_scr_basic_useful): XP needed to leave a level. */
export const xpForLevel = (level: number) => Math.floor(28 * 1.2 ** level / 5) * 5;
/** gml_Object_obj_player_Step_1, which also adds a new hit point every third level. */
export const MAX_LEVEL = 60;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Coin roll-up.

/** "true" counts the coins carried; "minimum" the same value in the fewest coins. */
export type CoinMode = "true" | "minimum";
let coinMode: CoinMode = "true";
export const currentCoinMode = () => coinMode;
/** Remembered for the session, so every roll-up (and later re-renders) count the same way. */
export const setCoinMode = (mode: CoinMode) => void (coinMode = mode);

export const coinCount = (c: Coins) => c.gold + c.silver + c.copper;
export const displayCoins = (c: Coins, mode: CoinMode): Coins => mode === "minimum" ? fewestCoins(coinValue(c)) : { ...c };

const silverText = (copper: number) => copper % 100 ? (copper / 100).toFixed(2) : String(copper / 100);

/** The line under the coins: how many there are and what they are worth. */
export function coinNote(c: Coins, mode: CoinMode): string {
  const n = coinCount(c), fewest = coinCount(fewestCoins(coinValue(c)));
  const count = mode === "true"
    ? `${plural(n, "coin")}, bags included`
    : fewest < n
    ? `${plural(fewest, "coin")} at fewest (you carry ${n})`
    : `${plural(n, "coin")}, already the fewest`;
  return `${count} · worth ${coinValue(c).toLocaleString("en-US")} copper (${silverText(coinValue(c))} silver)`;
}

const COIN_MODES: [CoinMode, string, string][] = [
  ["true", "True coins", "The coins you carry, as they are"],
  ["minimum", "Minimum coins", "The same value in the fewest coins: 100 copper make a silver, 10 silver a gold"],
];

function paintRollup(el: HTMLElement) {
  const c: Coins = { gold: Number(el.dataset.gold), silver: Number(el.dataset.silver), copper: Number(el.dataset.copper) };
  el.querySelector(".coin-rollup-amount")?.replaceChildren(coinsView(displayCoins(c, coinMode), { all: true }));
  el.querySelectorAll<HTMLElement>(".coin-mode button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === coinMode)));
  const note = el.querySelector(".coin-rollup-note");
  if (note) note.textContent = coinNote(c, coinMode);
}

/** Every coin in an inventory, nested bags included, with a True / Minimum coins switch shared by all roll-ups. */
export function coinRollup(inventory: Inventory | undefined): HTMLElement {
  if (inventory?.state !== "saved") return h("p", { class: "coin-rollup muted" }, "Coins: unknown, the inventory was not saved.");
  const c = countCoins(inventory);
  if (!coinCount(c)) return h("p", { class: "coin-rollup muted" }, "No coins.");
  const el = h(
    "div",
    { class: "coin-rollup", "data-gold": c.gold, "data-silver": c.silver, "data-copper": c.copper },
    h(
      "div",
      { class: "coin-rollup-head" },
      h("strong", {}, wikiTitle(wikiUrl("Currency and trading"), "Coins")),
      h(
        "span",
        { class: "coin-mode", role: "group", "aria-label": "Count coins as" },
        COIN_MODES.map(([mode, label, title]) =>
          h("button", {
            type: "button",
            "data-mode": mode,
            title,
            "aria-pressed": "false",
            onclick: () => {
              setCoinMode(mode);
              paintRollup(el);
              document.querySelectorAll<HTMLElement>(".coin-rollup[data-copper]").forEach(paintRollup);
            },
          }, label)
        ),
      ),
    ),
    h("div", { class: "coin-rollup-amount", "aria-live": "polite" }),
    h("p", { class: "coin-rollup-note muted" }),
  );
  paintRollup(el);
  return el;
}

// Views.

function bar(kind: Stat | "wellbeing", v: number): HTMLElement {
  const at = `${(clamp01(v) * 100).toFixed(1)}%`;
  if (kind === "warmth") {
    return h(
      "span",
      { class: "vital-bar warmth", "aria-hidden": "true" },
      h("span", { class: "vital-band" }),
      h("span", { class: "vital-needle", style: `left: ${at}` }),
    );
  }
  // Wellbeing: dangerously low at 33%, hit points heal while resting from 50%. The stats: lowering below 20%, raising from 50%.
  const ticks = kind === "wellbeing" ? [DANGER, 0.5] : [LOSE_BELOW, GAIN_AT];
  return h(
    "span",
    { class: "vital-bar", "aria-hidden": "true" },
    h("span", { class: "vital-fill", style: `width: ${at}` }),
    ticks.map((t) => h("span", { class: "vital-tick", style: `left: ${t * 100}%` })),
  );
}

function statRow(stat: Stat, v: number): HTMLElement {
  const s = statStatus(stat, v);
  return h(
    "li",
    { class: `vital ${stat}` },
    h(
      "div",
      { class: "vital-row" },
      h("span", { class: "vital-name" }, wikiTitle(wikiUrl(STAT_WIKI[stat]), STAT_LABELS[stat])),
      h("span", { class: "vital-value" }, percent(v)),
    ),
    bar(stat, v),
    h("div", { class: `vital-note ${s.tone}` }, s.text),
  );
}

function wellbeingView(p: PlayerSave, ctx: SectionContext): HTMLElement[] {
  const change = wellbeingChange(p);
  if (!p.vitals || !change) return [h("p", { class: "muted" }, "Wellbeing and its stats were not saved.")];
  const wb = p.vitals.wellbeing;
  const tone = toneOf(change.total);
  const extras = change.parts.filter((x) => !x.stat);
  const rules = `${ctx.key}/wellbeing/rules`;
  return [
    h(
      "ul",
      { class: "vitals" },
      h(
        "li",
        { class: "vital wellbeing" },
        h(
          "div",
          { class: "vital-row" },
          h("span", { class: "vital-name" }, wikiTitle(wikiUrl("Wellbeing"), "Wellbeing")),
          h("span", { class: "vital-value" }, percent(wb)),
          h(
            "span",
            { class: `vital-change ${tone}`, title: "Net change per turn at save time" },
            `${signedPercent(change.total)} per turn`,
          ),
        ),
        bar("wellbeing", wb),
        h("div", { class: `vital-note ${tone}` }, `${wellbeingTrend(wb, change.total)}. The change per turn sums the lines below.`),
      ),
      STATS.map((stat) => statRow(stat, p.vitals![stat])),
      extras.map((x) =>
        h(
          "li",
          { class: "vital extra" },
          h("div", { class: `vital-note ${toneOf(x.change)}` }, `${x.label}: ${signedPercent(x.change)} per turn`),
        )
      ),
    ),
    h(
      "details",
      { class: "vital-rules", "data-remember": rules, open: ctx.expanded?.has(rules) ?? false },
      h("summary", {}, "How wellbeing changes each turn"),
      h(
        "ul",
        {},
        h("li", {}, "Satiation: +0.5% from 50%; below 20% it costs up to 1% (at 0%)."),
        h("li", {}, "Focus and stamina: +0.2% each from 50%; below 20% each costs up to 0.5%."),
        h("li", {}, "Warmth: no effect between 40% and 60%; colder or hotter costs up to 3% (at 0% or 100%)."),
        h("li", {}, "Warm to the core and well rested: +1% each while they last. Sickness I–III: −1% to −3%."),
        h("li", {}, "Very or extremely overburdened: −1% or −2%."),
        h("li", {}, "Each stat's share is rounded to 0.1%. Wellbeing stays between 0% and 100%; from 50%, resting heals lost hit points."),
      ),
      h("p", {}, wikiLink(wikiUrl("Wellbeing"), "Wellbeing"), " · ", wikiLink(wikiUrl("Resting"), "Resting")),
    ),
  ];
}

function healText(s: HealthSummary, wellbeing: number | undefined): string {
  return [
    s.lost
      ? `Lost hit points heal with potions or salves, or slowly while resting when wellbeing is 50% or more${
        wellbeing === undefined ? "" : ` (now ${percent(wellbeing)})`
      }.`
      : "",
    s.burned ? "Burned ones cannot heal until treated." : "",
  ].filter(Boolean).join(" ");
}

const armorText = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** Armor from equipment (as the equipment screen totals it) and the points it gives to distribute when combat starts. */
function armorView(p: PlayerSave, ctx: SectionContext): HTMLElement[] {
  if (p.inventory?.state !== "saved") return [];
  const pieces = p.equipment.flatMap((e) => {
    const armor = itemArmor(e.item);
    return armor === undefined ? [] : [{ e, armor, full: ARMOR[e.item.index][0], max: ARMOR[e.item.index][1] }];
  });
  if (!pieces.length) return [h("p", { class: "player-armor muted" }, "No armor equipped.")];
  const total = totalArmor(p.equipment);
  const place = armorToPlace(total, p.health);
  const capped = place < Math.floor(total);
  const why = capped ? " (capped: at most 3 layers on each living hit point)" : Number.isInteger(total) ? "" : " (rounded down)";
  return [
    h(
      "p",
      { class: "player-armor" },
      h("strong", {}, `Armor ${armorText(total)}`),
      " from equipment: ",
      h("strong", {}, plural(place, "point")),
      " to distribute on your hit points when combat starts",
      why ? h("span", { class: "muted" }, why) : null,
      ".",
    ),
    section(
      ctx,
      "armor",
      "Armor by item",
      false,
      h(
        "ul",
        { class: "armor-pieces" },
        pieces.map(({ e, armor, full, max }) =>
          h(
            "li",
            {},
            h("span", {}, ITEM_NAMES[e.item.index] ?? `Item ${e.item.index}`),
            h(
              "span",
              { class: "muted" },
              ` ${armor}`,
              (e.item.durability ?? max) < max ? ` of ${full} (${Math.round((e.item.durability ?? max) / max * 100)}% durability)` : "",
              e.active ? "" : ", other weapon set",
            ),
          )
        ),
      ),
      h("p", { class: "muted" }, "Each piece gives its armor scaled by durability left; the total counts both weapon sets."),
    ),
  ];
}

/** Marks the player's top-level inventory items, the ones worn or held, with an E naming the slot. */
export function equippedBadge(p: PlayerSave): (item: SavedItem) => HTMLElement | null {
  const worn = new Map(p.equipment.map((e) => [e.item, e]));
  return (item) => {
    const e = worn.get(item);
    if (!e) return null;
    const slot = SLOT_NAMES[e.slot] ?? "equipment";
    const label = isWeaponSlot(e.slot) && !e.active ? `Equipped in your other weapon set (${slot})` : `Equipped: ${slot}`;
    return h("span", { class: `equip-badge${e.active ? "" : " off"}`, role: "img", "aria-label": label, title: label }, "E");
  };
}

function hitPointsView(p: PlayerSave, ctx: SectionContext): HTMLElement[] {
  if (!p.health) return [h("p", { class: "muted" }, "Hit points were not saved."), ...armorView(p, ctx)];
  const s = summarize(p.health);
  const guides: [string, string][] = [["Health and armor", "Health and armor"], ["Armor points", "Armor points"]];
  if (s.poison) guides.push(["Poison", "Poison"]);
  if (s.bleed || s.burned) guides.push(["Damage types", "Damage types"]);
  const heal = healText(s, p.vitals?.wellbeing);
  return [
    healthGridView(p.health),
    healthLegend(p.health),
    ...armorView(p, ctx),
    p.newHitPoints > 0
      ? h(
        "p",
        { class: "new-hp" },
        `${plural(p.newHitPoints, "new hit point")} from levelling up ${p.newHitPoints === 1 ? "is" : "are"} not placed on the grid yet.`,
      )
      : null,
    heal ? h("p", { class: "muted" }, heal) : null,
    h("p", {}, guides.flatMap(([title, label], i) => [i ? " · " : "", wikiLink(wikiUrl(title), label)])),
  ].filter((e): e is HTMLElement => !!e);
}

function conditionsView(p: PlayerSave): HTMLElement[] {
  const list = conditionsOf(p);
  const wet = wetClothes(p.wetness);
  const items = [
    ...list.map((c) =>
      h(
        "li",
        { class: `condition ${c.tone}` },
        h("strong", {}, c.label),
        c.turns ? h("span", { class: "muted" }, ` (${plural(c.turns, "turn")} left)`) : null,
        c.effect ? h("span", { class: "condition-effect" }, `: ${c.effect}`) : null,
      )
    ),
    wet.length
      ? h(
        "li",
        { class: "condition bad" },
        h("strong", {}, "Wet clothes"),
        h("span", { class: "condition-effect" }, `: ${wet.join(", ")}; they cool you toward 10% warmth each turn`),
      )
      : null,
  ].filter((e): e is HTMLElement => !!e);
  const next = p.level < MAX_LEVEL ? `${Math.round(p.xp)} / ${xpForLevel(p.level)} XP to level ${p.level + 1}` : "the highest level";
  return [
    items.length ? h("ul", { class: "conditions" }, items) : h("p", { class: "muted" }, "No active conditions."),
    h(
      "p",
      { class: "player-level" },
      h("strong", {}, `Level ${p.level}`),
      ` · ${next}`,
      p.skillPoints > 0 ? ` · ${plural(p.skillPoints, "skill point")} to spend` : "",
      " · ",
      wikiLink(wikiUrl("Level progression"), "Levels"),
      " · ",
      wikiLink(wikiUrl("Skills"), "Skills"),
    ),
  ];
}

/** Inspection sections for the player: hit points, wellbeing and its four stats, conditions, coins and inventory. */
export function playerView(p: PlayerSave, ctx: SectionContext): HTMLElement[] {
  return [
    section(ctx, "hp", "Hit points", true, ...hitPointsView(p, ctx)),
    section(ctx, "wellbeing", "Wellbeing", true, ...wellbeingView(p, ctx)),
    section(ctx, "conditions", "Conditions and level", true, ...conditionsView(p)),
    section(
      ctx,
      "inventory",
      "Inventory",
      true,
      coinRollup(p.inventory),
      inventoryView(p.inventory, `${ctx.key}/inventory`, ctx.expanded, equippedBadge(p)),
      h("p", { class: "muted" }, "As saved. E marks what you wear or hold (dashed: your other weapon set); the rest is in your bags."),
    ),
  ];
}

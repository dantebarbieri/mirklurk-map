// The saved time of day and weather: a panel under the world summary, and a compact chip that floats on the full-screen map.

import { h } from "./dom.ts";
import { pct, plural } from "./format.ts";
import { temperatureLabel } from "./player.ts";
import type { PlayerSave } from "./save.ts";
import { skyIcon, type SkyIconName } from "./skyicons.ts";
import {
  balanceTrend,
  clock,
  dayCountdown,
  exposure,
  formatClock,
  nextPhase,
  phaseAt,
  type Sky,
  sunIsUp,
  UNDERGROUND_TEMPERATURE,
  UNKNOWN_TIME,
  Weather,
  WEATHER_LABELS,
  weatherKind,
  weatherOutlook,
} from "./weather.ts";

/** The thermometer's liquid in each of the game's seven frames (spr_ui_temperatures, picked by floor(6.99 × temperature)). */
const THERMOMETER = ["#aeeee2", "#73efe8", "#42bfe8", "#dbcb75", "#f5a430", "#f1641f", "#b9451d"];

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(2)}`;
const BALANCE_HINT = "The game's rain balance, −1 to +1, rises while it rains and falls while it is dry. After a dry spell (below 0) " +
  "clouds gather and rain starts more often; after a wet spell (above 0) rain starts less often and stops sooner.";

function weatherIcon(sky: Sky): SkyIconName {
  const kind = weatherKind(sky);
  if (kind === "clear") return sunIsUp(clock(sky).minute) ? "weather-clear-day" : "weather-clear-night";
  return kind === "clearing" ? "weather-drizzle" : `weather-${kind}`;
}

/** The chance of each change at the next hourly check, worded for the current state. */
function oddsText(sky: Sky, p: PlayerSave): string {
  const o = weatherOutlook(sky, p.daysAlive, p.difficulty);
  const when = `Next hour, in ${plural(o.turns, "turn")}`;
  if (sky.weather === Weather.Rain) return `${when}: ${pct(o.cloudy)} eases to cloud, ${pct(o.clear)} clears`;
  if (sky.weather === Weather.Cloudy) {
    const rain = o.rainBlocked ? "no rain yet (first two days, Easy or Medium)" : `${pct(o.rain)} rain`;
    return `${when}: ${pct(o.clear)} clears, ${rain}`;
  }
  return `${when}: ${pct(o.cloudy)} clouds over`;
}

function balanceText(sky: Sky): [string, string] {
  const t = balanceTrend(sky);
  const spell = t.tilt === "drier"
    ? "Wet spell: the odds lean dry"
    : t.tilt === "wetter"
    ? "Dry spell: the odds lean wet"
    : "Rain balance even: the usual odds";
  const way = t.perTurn > 0 ? "rising while it rains" : t.perTurn < 0 ? "falling while dry" : "at its limit";
  const back = t.turnsToEven !== undefined && t.tilt !== "even" ? `, even in ${plural(t.turnsToEven, "turn")}` : "";
  return [spell, `${signed(sky.rainBalance)}, ${way}${back}`];
}

/** Rain balance −1…1 as a bar: the dry-spell side on the left, the wet-spell side on the right, an arrow for where it heads. */
function balanceMeter(sky: Sky): HTMLElement {
  const t = balanceTrend(sky);
  const at = (Math.min(1, Math.max(-1, sky.rainBalance)) + 1) * 50;
  return h(
    "span",
    { class: "balance-meter", role: "img", "aria-label": `Rain balance ${signed(sky.rainBalance)} of −1 to +1` },
    h("span", { class: `balance-mark${t.perTurn > 0 ? " up" : t.perTurn < 0 ? " down" : ""}`, style: `left:${at}%` }),
  );
}

function thermometer(sky: Sky): HTMLElement {
  const icon = skyIcon("thermometer");
  icon.style.color = THERMOMETER[Math.max(0, Math.min(6, Math.floor(6.99 * sky.temperature)))];
  return h("span", { class: "sky-temp" }, icon, temperatureLabel(sky.temperature));
}

/** Time, weather and where the rain balance is steering it, as saved; null when the save has no clock. */
export function skyPanel(p: PlayerSave): HTMLElement | null {
  const sky = p.sky;
  if (!sky) return null;
  const { minute } = clock(sky);
  const phase = phaseAt(minute), next = nextPhase(minute), goal = dayCountdown(minute);
  const where = exposure(p.area.type);
  const countdowns = [next, ...(goal.phase === next.phase ? [] : [goal])]
    .map((c) => `${c.phase.label} in ${plural(c.turns, "turn")}`)
    .join(" · ");
  const trend = balanceTrend(sky);
  const [spell, balance] = balanceText(sky);
  const note = where === "underground"
    ? `Underground the game's dial reads ${UNKNOWN_TIME}, no weather reaches you and it is always ${
      temperatureLabel(UNDERGROUND_TEMPERATURE)
    }.`
    : where === "sheltered"
    ? "Indoors no rain falls on you; the sky outside is the same over every zone."
    : "One sky for the whole world: every outdoor zone has this weather.";
  return h(
    "div",
    { class: "sky", role: "group", "aria-label": "Time and weather at save time" },
    h(
      "p",
      { class: "sky-row" },
      skyIcon(`time-${phase.id}`),
      h("span", {}, h("b", {}, formatClock(minute)), ` · ${phase.label}`, h("span", { class: "muted" }, ` · ${countdowns}`)),
    ),
    h(
      "p",
      { class: "sky-row" },
      skyIcon(weatherIcon(sky)),
      h(
        "span",
        {},
        h("b", {}, WEATHER_LABELS[weatherKind(sky)]),
        " · ",
        thermometer(sky),
        h("span", { class: "muted" }, ` · ${oddsText(sky, p)}`),
      ),
    ),
    h(
      "p",
      { class: "sky-row", title: BALANCE_HINT },
      skyIcon(`trend-${trend.tilt}`),
      h("span", {}, spell, balanceMeter(sky), h("span", { class: "muted" }, balance)),
    ),
    h("p", { class: "sky-note muted" }, note),
  );
}

/** Clock and weather at a glance, for the zone title floating on the full-screen map (style.css hides it elsewhere). */
export function skyChip(p: PlayerSave): HTMLElement | null {
  const sky = p.sky;
  if (!sky) return null;
  const { minute } = clock(sky);
  const phase = phaseAt(minute), goal = dayCountdown(minute);
  const weather = WEATHER_LABELS[weatherKind(sky)];
  const label = `${formatClock(minute)}, ${phase.label}, ${weather}; ${goal.phase.label} in ${plural(goal.turns, "turn")}`;
  return h(
    "span",
    { class: "sky-chip", title: label, "aria-label": label, role: "img" },
    skyIcon(`time-${phase.id}`),
    formatClock(minute),
    skyIcon(weatherIcon(sky)),
  );
}

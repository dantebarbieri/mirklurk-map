// Time of day and weather as the game keeps them (Mirklurk 0.8.1.5): one `manager_day` for the whole world, saved once per
// character in Player.save (gml_GlobalScript_scr_saveload). Pure functions, shared with anything that reads or writes those keys.
//
// Every turn (`player_endturn` in gml_GlobalScript_scr_basic_useful) adds 8 minutes and moves the rain balance; when the hour
// ticks over, the weather may change. Midnight (`hour >= 24` in gml_Object_manager_day_Step_0) sets the minute to 0 and adds a
// day. Nothing else changes them, apart from a developer-only debug panel.

/** `localWeather` (MDweather): the weather state machine's three states. */
export const Weather = { Clear: 0, Cloudy: 1, Rain: 2 } as const;
export type WeatherState = (typeof Weather)[keyof typeof Weather];

/** `manager_day`'s saved state, under the Player.save keys in `SKY_KEYS`. */
export interface Sky {
  /** Minutes since midnight, 0–1439 (`minute`; a new game starts at 420, 07:00). The hour is `minute / 60`. */
  minute: number;
  /** In-game day, from 1 (`day`). */
  day: number;
  /** Air temperature, 0 biting cold to 1 blazing hot (`temperature`); labelled by `temperature_get_label`. */
  temperature: number;
  /** `localWeather`: 0 clear, 1 cloudy, 2 rain (see `Weather`). */
  weather: number;
  /** Clouds on screen (`cloudPower`): 1 while cloudy or raining, else 0. */
  cloud: number;
  /** Rain strength (`rainPower`), 0 for none; 0.08–1 while raining, falling to 0 as rain fades out. */
  rain: number;
  /** Rain balance (`rainBalance`), −1 to 1: up while it rains, down while it is dry; it tilts the weather odds back. */
  rainBalance: number;
}

/** Player.save key of each `Sky` field. MDrainBalance is missing from older saves (the loader then keeps 0). */
export const SKY_KEYS = {
  minute: "MDminute",
  day: "MDday",
  temperature: "MDtemperature",
  weather: "MDweather",
  cloud: "MDcloud",
  rain: "MDrain",
  rainBalance: "MDrainBalance",
} as const satisfies Record<keyof Sky, string>;

/** Minutes per turn (`minute += 8`). */
export const TURN_MINUTES = 8;
export const DAY_MINUTES = 24 * 60;
/** `manager_day` Create: a new game starts at 07:00 on day 1. */
export const NEW_GAME_MINUTE = 420;
/** Rain balance per turn: +1/180 while `rainPower > 0`, else −1/360, kept within −1…1. */
export const BALANCE_RAIN = 1 / 180;
export const BALANCE_DRY = -1 / 360;
/** Rain at most this strong plays the soft rain sound (`snd_amb_rain_soft`, gml_Object_manager_day_Step_0). */
export const LIGHT_RAIN = 0.2;
/** Rain at least this strong leaves only the largest splashes (`EffRain` tiles 32–56). */
export const HEAVY_RAIN = 0.725;
/** Below this distance from 0 the rain balance changes the odds by under 5%, so it counts as even. */
export const EVEN_BALANCE = 0.05;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Reads `Sky` from Player.save's player record; undefined when the clock itself (MDminute, MDday) is missing. */
export function parseSky(p: Record<string, unknown>): Sky | undefined {
  const minute = num(p[SKY_KEYS.minute]), day = num(p[SKY_KEYS.day]);
  if (minute === undefined || day === undefined) return undefined;
  return {
    minute,
    day,
    temperature: num(p[SKY_KEYS.temperature]) ?? 0.5,
    weather: num(p[SKY_KEYS.weather]) ?? Weather.Clear,
    cloud: num(p[SKY_KEYS.cloud]) ?? 0,
    rain: num(p[SKY_KEYS.rain]) ?? 0,
    rainBalance: num(p[SKY_KEYS.rainBalance]) ?? 0,
  };
}

/** The clock as the game resumes it: a minute of 1440 or more rolls over to 0 of the next day on the first step. */
export function clock(sky: Pick<Sky, "minute" | "day">): { minute: number; day: number } {
  return sky.minute >= DAY_MINUTES ? { minute: 0, day: sky.day + 1 } : { minute: Math.max(0, sky.minute), day: sky.day };
}

export type PhaseId = "dawn" | "sunrise" | "morning" | "midday" | "afternoon" | "sunset" | "dusk" | "night";

/**
 * The day-cycle dial's labels (UI.ini [Time] DayLabel0–7) and the minute each starts at, in order. The dial's tooltip picks
 * them by hour in gml_Object_UI_Draw_64: Night from 22:00 to 04:00.
 */
export const PHASES: readonly { id: PhaseId; label: string; start: number }[] = [
  { id: "dawn", label: "Dawn", start: 4 * 60 },
  { id: "sunrise", label: "Sunrise", start: 6 * 60 },
  { id: "morning", label: "Morning", start: 8 * 60 },
  { id: "midday", label: "Midday", start: 11 * 60 },
  { id: "afternoon", label: "Afternoon", start: 14 * 60 },
  { id: "sunset", label: "Sunset", start: 17 * 60 },
  { id: "dusk", label: "Dusk", start: 20 * 60 },
  { id: "night", label: "Night", start: 22 * 60 },
];
/** DayLabel8, which the dial shows underground (`area_is_dungeonlike`) instead of the time. */
export const UNKNOWN_TIME = "Unknown Time";
/** Underground the air is always this temperature, whatever the sky (`player_gets_all_wet`; the HUD's thermometer agrees). */
export const UNDERGROUND_TEMPERATURE = 0.35;

const phase = (id: PhaseId) => PHASES.find((p) => p.id === id)!;

/** The dial's label for a minute of the day. */
export const phaseAt = (minute: number) => PHASES.findLast((p) => minute >= p.start) ?? phase("night");

/** Turns until the clock first reaches `target` (a minute of the day), counting midnight's rollover to 0. */
export function turnsUntil(minute: number, target: number): number {
  const m = clock({ minute, day: 0 }).minute;
  if (target > m) return Math.ceil((target - m) / TURN_MINUTES);
  return Math.ceil((DAY_MINUTES - m) / TURN_MINUTES) + Math.ceil(target / TURN_MINUTES);
}

/** The next label on the dial and the turns until it. */
export function nextPhase(minute: number): { phase: (typeof PHASES)[number]; turns: number } {
  const i = PHASES.indexOf(phaseAt(minute));
  const next = PHASES[(i + 1) % PHASES.length];
  return { phase: next, turns: turnsUntil(minute, next.start) };
}

/**
 * The dial tooltip's own countdown (gml_Object_UI_Draw_64): "Turns until Dusk" from 06:00 to 20:00, when sleeping until
 * sunrise becomes possible, else "Turns until Sunrise". The game rounds `minutes / 8` down, which reads one turn short when
 * the minute is not a multiple of 8 (day 1, which starts at 07:00); this counts the turns it really takes.
 */
export function dayCountdown(minute: number): { phase: (typeof PHASES)[number]; turns: number } {
  const m = clock({ minute, day: 0 }).minute;
  const goal = m >= phase("sunrise").start && m < phase("dusk").start ? phase("dusk") : phase("sunrise");
  return { phase: goal, turns: turnsUntil(m, goal.start) };
}

/** Turns until the hour ticks over, the only time the weather can change. */
export function turnsToNextHour(minute: number): number {
  const m = clock({ minute, day: 0 }).minute;
  return Math.ceil((Math.floor(m / 60) * 60 + 60 - m) / TURN_MINUTES);
}

/** The dial's sun is above its horizon from 06:00 to 18:00 (it turns once a day; gml_Object_UI_Draw_64). */
export const sunIsUp = (minute: number) => minute >= 6 * 60 && minute < 18 * 60;

/** The time of day in the reader's locale, 12- or 24-hour as it prefers ("7:00 AM", "07:00"). */
export function formatClock(minute: number, locale?: string | string[]): string {
  const m = clock({ minute, day: 0 }).minute;
  return new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(2000, 0, 1, Math.floor(m / 60), m % 60)));
}

export type WeatherKind = "clear" | "clearing" | "cloudy" | "drizzle" | "light-rain" | "rain" | "heavy-rain";

export const WEATHER_LABELS: Readonly<Record<WeatherKind, string>> = {
  clear: "Clear",
  clearing: "Clearing",
  cloudy: "Cloudy",
  drizzle: "Rain easing off",
  "light-rain": "Light rain",
  rain: "Rain",
  "heavy-rain": "Heavy rain",
};

/**
 * What the sky looks like. Rain fades out after the state leaves Rain (`rainFadePower`, not saved): "clearing" when it
 * went straight to Clear, "drizzle" when it went back to Cloudy.
 */
export function weatherKind(sky: Pick<Sky, "weather" | "cloud" | "rain">): WeatherKind {
  const rainKind = (): WeatherKind => (sky.rain >= HEAVY_RAIN ? "heavy-rain" : sky.rain > LIGHT_RAIN ? "rain" : "light-rain");
  switch (sky.weather) {
    case Weather.Clear:
      return sky.rain > 0 ? "clearing" : "clear";
    case Weather.Cloudy:
      return sky.rain > 0 ? "drizzle" : "cloudy";
    case Weather.Rain:
      return rainKind();
  }
  return sky.rain > 0 ? rainKind() : sky.cloud > 0 ? "cloudy" : "clear";
}

/** The rain balance after `turns` more turns with rain at `rain` (it does not change between hour ticks once loaded). */
export const balanceAfter = (balance: number, rain: number, turns: number) =>
  Math.min(1, Math.max(-1, balance + turns * (rain > 0 ? BALANCE_RAIN : BALANCE_DRY)));

/** The next weather check: when it comes and the chance of each outcome. */
export interface Outlook {
  /** Turns until the hour ticks over and the weather may change. */
  turns: number;
  /** The rain balance at that check. */
  balance: number;
  /** Chance of each state after the check (they add up to 1, the current state's being the chance it stays). */
  clear: number;
  cloudy: number;
  rain: number;
  /** Rain cannot start yet: the first two days (daysAlive under 2) on Easy or Medium. */
  rainBlocked: boolean;
}

/**
 * The odds at the next hourly check (`player_endturn`), from the balance at that moment:
 *  - Clear turns Cloudy with max(2%, 12% × (1 − balance)).
 *  - Cloudy clears with max(2%, 10% × (1 + balance)); otherwise rain starts with max(2%, 30% × (1 − balance)) — never while
 *    daysAlive < 2 on Easy or Medium (GAMEDIFF ≤ 2).
 *  - Rain eases back to Cloudy with max(1%, 25% × (1 + balance)); otherwise it clears at once with max(1%, 5% × (1 + balance)),
 *    or keeps raining a little stronger or weaker (±0.1).
 * `difficulty` is `myDiff` (1 Easy, 2 Medium, 3 Hard); new games default to Medium.
 */
export function weatherOutlook(sky: Sky, daysAlive: number, difficulty = 2): Outlook {
  const { minute } = clock(sky);
  const turns = turnsToNextHour(minute);
  const b = balanceAfter(sky.rainBalance, sky.rain, turns);
  const rainBlocked = daysAlive < 2 && difficulty <= 2;
  let clear = 0, cloudy = 0, rain = 0;
  if (sky.weather === Weather.Cloudy) {
    clear = Math.max(0.02, 0.1 * (1 + b));
    rain = rainBlocked ? 0 : (1 - clear) * Math.max(0.02, 0.3 * (1 - b));
    cloudy = 1 - clear - rain;
  } else if (sky.weather === Weather.Rain) {
    cloudy = Math.max(0.01, 0.25 * (1 + b));
    clear = (1 - cloudy) * Math.max(0.01, 0.05 * (1 + b));
    rain = 1 - cloudy - clear;
  } else {
    cloudy = Math.max(0.02, 0.12 * (1 - b));
    clear = 1 - cloudy;
  }
  return { turns, balance: b, clear, cloudy, rain, rainBlocked };
}

/** Which way the rain balance tilts the odds, and where it is heading. */
export interface BalanceTrend {
  /** "wetter": after a dry spell, clouds and rain come more readily; "drier": after a wet one, rain starts less and stops sooner. */
  tilt: "wetter" | "drier" | "even";
  /** The balance's change per turn: up while it rains, down while it is dry (0 when pinned at −1 or 1). */
  perTurn: number;
  /** Turns until the balance is back to 0 if the weather holds, when it is heading that way. */
  turnsToEven?: number;
}

export function balanceTrend(sky: Pick<Sky, "rainBalance" | "rain">): BalanceTrend {
  const b = sky.rainBalance;
  const step = sky.rain > 0 ? BALANCE_RAIN : BALANCE_DRY;
  const pinned = (step > 0 && b >= 1) || (step < 0 && b <= -1);
  const tilt = b <= -EVEN_BALANCE ? "wetter" : b >= EVEN_BALANCE ? "drier" : "even";
  const homeward = b !== 0 && Math.sign(step) !== Math.sign(b);
  return {
    tilt,
    perTurn: pinned ? 0 : step,
    // A little slack so float noise in the saved balance cannot add a turn.
    turnsToEven: homeward ? Math.ceil(Math.abs(b / step) - 1e-9) : undefined,
  };
}

/** How much of the weather an area gets: outdoors all of it, in a building the light but no rain, underground none. */
export type Exposure = "outdoors" | "sheltered" | "underground";

/**
 * `area_is_outside` (swamp-like zones, ruins, the rift mire, vast waters) and `area_is_dungeonlike` (caves, ruin interiors and
 * cellars, the undercroft, the library, the rift depths) in gml_GlobalScript_scr_map_and_weather. The fort interior, Bhato's
 * hideout, Gurb-Gurb's hut and the shipwreck are neither: their light follows the day, but no rain falls inside.
 */
export function exposure(areaType: number): Exposure {
  if ([0, 1, 2, 3, 4, 5, 22, 23, 100].includes(areaType)) return "outdoors";
  if ([10, 11, 12, 20, 21, 24, 25, 26, 30, 33].includes(areaType)) return "underground";
  return "sheltered";
}

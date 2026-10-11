// Time of day and weather (src/weather.ts), checked against a step-by-step run of the game's own turn loop
// (player_endturn / manager_day Step), plus real saves when available (skipped otherwise):
//   MIRKLURK_SAVES="…\Saves" deno task test

import { assert, assertAlmost, assertEquals } from "./assert.ts";
import { decodeJson, parsePlayer } from "../src/save.ts";
import {
  balanceAfter,
  balanceTrend,
  clock,
  dayCountdown,
  exposure,
  formatClock,
  nextPhase,
  parseSky,
  phaseAt,
  PHASES,
  type Sky,
  turnsToNextHour,
  turnsUntil,
  Weather,
  weatherKind,
  weatherOutlook,
} from "../src/weather.ts";

/** One turn as the game plays it: +8 minutes, then midnight's rollover on the next step. */
const step = (m: number) => (m + 8 >= 1440 ? 0 : m + 8);
/** Turns until the clock first reaches `target`, playing turns one by one. */
function reach(minute: number, target: number): number {
  let m = minute;
  for (let k = 1; k < 1000; k++) {
    const next = step(m);
    if (m < target && next >= target) return k;
    m = next;
  }
  throw new Error("never reached");
}
/** Turns until the hour ticks over; the check compares hours before the rollover, so 23:56 + 8 minutes is hour 24. */
function nextHour(minute: number): number {
  let m = minute;
  for (let k = 1; k < 1000; k++) {
    if (Math.floor((m + 8) / 60) > Math.floor(m / 60)) return k;
    m = step(m);
  }
  throw new Error("never reached");
}

const sky = (over: Partial<Sky> = {}): Sky => ({
  minute: 420,
  day: 1,
  temperature: 0.5,
  weather: Weather.Clear,
  cloud: 0,
  rain: 0,
  rainBalance: 0,
  ...over,
});

Deno.test("weather: Player.save's MD keys, an older save's missing balance, and no clock", () => {
  const p = { MDminute: 192, MDday: 6, MDtemperature: 0.24, MDcloud: 1, MDrain: 0.34, MDweather: 2, MDrainBalance: 0.186 };
  assertEquals(parseSky(p), { minute: 192, day: 6, temperature: 0.24, weather: 2, cloud: 1, rain: 0.34, rainBalance: 0.186 });
  assertEquals(parseSky({ ...p, MDrainBalance: undefined })?.rainBalance, 0);
  assertEquals(parseSky({ MDday: 3 }), undefined);
  const saved = parsePlayer([{ worldGrid: Array.from({ length: 5 }, () => [1, 1, 1, 1, 1]), ...p }]);
  assertEquals(saved.sky?.minute, 192);
  assertEquals(clock({ minute: 1444, day: 1 }), { minute: 0, day: 2 });
});

Deno.test("weather: the dial's labels change on the hours UI_Draw_64 uses", () => {
  const at = (h: number, m = 0) => phaseAt(h * 60 + m).label;
  assertEquals(
    [at(0), at(3, 59), at(4), at(5, 59), at(6), at(7, 59), at(8), at(11), at(14), at(17), at(19, 59), at(20), at(21, 59), at(22)],
    ["Night", "Night", "Dawn", "Dawn", "Sunrise", "Sunrise", "Morning", "Midday", "Afternoon", "Sunset", "Sunset", "Dusk", "Dusk", "Night"],
  );
  assertEquals(nextPhase(23 * 60).phase.label, "Dawn");
});

Deno.test("weather: turn counts match playing the turns, across midnight and on day 1's odd minutes", () => {
  // Day 1 starts at 420, so its minutes are 4 more than a multiple of 8 until the first midnight drops the remainder.
  for (let m = 0; m < 1440; m += 4) {
    for (const p of PHASES) assertEquals(turnsUntil(m, p.start), reach(m, p.start), `${m} → ${p.label}`);
    assertEquals(turnsToNextHour(m), nextHour(m), `hour after ${m}`);
  }
  assertEquals(turnsUntil(1436, 360), 46);
  assertEquals(nextPhase(420), { phase: PHASES[2], turns: 8 });
});

Deno.test("weather: the countdown is the dial's Dusk by day and Sunrise by night, one more than its rounded-down count on day 1", () => {
  const game = (m: number) => Math.floor((m >= 360 && m < 1200 ? 1200 - m : m < 360 ? 360 - m : 1440 - m + 360) / 8);
  assertEquals(dayCountdown(420).phase.label, "Dusk");
  assertEquals(dayCountdown(420).turns, 98);
  assertEquals(game(420), 97);
  assertEquals(dayCountdown(1200).phase.label, "Sunrise");
  assertEquals(dayCountdown(192).phase.label, "Sunrise");
  for (let m = 0; m < 1440; m += 8) assertEquals(dayCountdown(m).turns, game(m), `minute ${m}`);
});

Deno.test("weather: the clock follows the reader's locale", () => {
  assertEquals(formatClock(420, "en-US"), "7:00 AM");
  assertEquals(formatClock(420, "en-GB"), "07:00");
  assertEquals(formatClock(1439, "en-US"), "11:59 PM");
  assertEquals(formatClock(1444, "de-DE"), "00:00");
});

Deno.test("weather: states, including rain fading out after the state has moved on", () => {
  assertEquals(weatherKind({ weather: 0, cloud: 0, rain: 0 }), "clear");
  assertEquals(weatherKind({ weather: 0, cloud: 0, rain: 0.3 }), "clearing");
  assertEquals(weatherKind({ weather: 1, cloud: 1, rain: 0 }), "cloudy");
  assertEquals(weatherKind({ weather: 1, cloud: 1, rain: 0.05 }), "drizzle");
  assertEquals(weatherKind({ weather: 2, cloud: 1, rain: 0.08 }), "light-rain");
  assertEquals(weatherKind({ weather: 2, cloud: 1, rain: 0.2 }), "light-rain");
  assertEquals(weatherKind({ weather: 2, cloud: 1, rain: 0.34 }), "rain");
  assertEquals(weatherKind({ weather: 2, cloud: 1, rain: 0.725 }), "heavy-rain");
});

Deno.test("weather: next hour's odds use the balance as it will be at that turn", () => {
  // 06:56 → the check is one turn away, at 07:04; a dry turn takes 1/360 off first.
  const clear = weatherOutlook(sky({ minute: 416 }), 5);
  assertEquals(clear.turns, 1);
  assertAlmost(clear.balance, -1 / 360);
  assertAlmost(clear.cloudy, 0.12 * (1 + 1 / 360));
  assertAlmost(clear.clear + clear.cloudy + clear.rain, 1);

  const cloudy = weatherOutlook(sky({ minute: 600, weather: Weather.Cloudy, cloud: 1 }), 5);
  assertEquals(cloudy.turns, 8);
  const b = -8 / 360;
  assertAlmost(cloudy.clear, 0.1 * (1 + b));
  assertAlmost(cloudy.rain, (1 - 0.1 * (1 + b)) * 0.3 * (1 - b));
  assertAlmost(cloudy.cloudy, 1 - cloudy.clear - cloudy.rain);

  // No rain in the first two days on Easy or Medium; Hard has no such grace.
  const fresh = weatherOutlook(sky({ weather: Weather.Cloudy, cloud: 1 }), 1, 2);
  assert(fresh.rainBlocked && fresh.rain === 0);
  assert(weatherOutlook(sky({ weather: Weather.Cloudy, cloud: 1 }), 1, 3).rain > 0);
  assert(weatherOutlook(sky({ weather: Weather.Cloudy, cloud: 1 }), 2, 2).rain > 0);

  // A long wet spell: rain ends quickly, the balance is pinned at 1.
  const wet = weatherOutlook(sky({ weather: Weather.Rain, cloud: 1, rain: 0.9, rainBalance: 1 }), 30);
  assertAlmost(wet.balance, 1);
  assertAlmost(wet.cloudy, 0.5);
  assertAlmost(wet.clear, 0.5 * 0.1);
  // The floors: after a long wet spell clouds still gather 2% of hours.
  assertAlmost(weatherOutlook(sky({ rainBalance: 1 }), 30).cloudy, 0.02);
  assertAlmost(balanceAfter(-1, 0, 10), -1);
});

Deno.test("weather: the rain balance's tilt and its way back to even", () => {
  const dryingOut = balanceTrend({ rainBalance: 0.19, rain: 0 });
  assertEquals(dryingOut.tilt, "drier");
  assertAlmost(dryingOut.perTurn, -1 / 360);
  assertEquals(dryingOut.turnsToEven, 69);
  const soaking = balanceTrend({ rainBalance: -0.71, rain: 0.3 });
  assertEquals(soaking.tilt, "wetter");
  assertEquals(soaking.turnsToEven, 128);
  assertEquals(balanceTrend({ rainBalance: 0.5, rain: 0.3 }).turnsToEven, undefined);
  assertEquals(balanceTrend({ rainBalance: 1, rain: 0.3 }).perTurn, 0);
  assertEquals(balanceTrend({ rainBalance: 0.02, rain: 0 }).tilt, "even");
  // 180 turns of rain to +1, 360 dry ones back: the game settles near a third of turns raining.
  assertAlmost(balanceAfter(0, 0.5, 180), 1, 1e-9);
  assertAlmost(balanceAfter(1, 0, 360), 0, 1e-9);
});

Deno.test("weather: who feels it — outdoors, sheltered in buildings, underground", () => {
  assertEquals([0, 1, 5, 22, 23, 100].map(exposure), Array(6).fill("outdoors"));
  assertEquals([10, 11, 12, 20, 21, 24, 25, 26, 30, 33].map(exposure), Array(10).fill("underground"));
  assertEquals([31, 32, 34, 35].map(exposure), Array(4).fill("sheltered"));
});

const dir = Deno.env.get("MIRKLURK_SAVES") ??
  decodeURIComponent(new URL("../../Saves", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const present = (() => {
  try {
    return Deno.statSync(dir).isDirectory;
  } catch {
    return false;
  }
})();

Deno.test({ name: "weather: real saves have a clock and consistent weather", ignore: !present }, () => {
  let n = 0;
  for (const e of Deno.readDirSync(dir)) {
    if (!e.isDirectory) continue;
    let bytes: Uint8Array;
    try {
      bytes = Deno.readFileSync(`${dir}/${e.name}/Player.save`);
    } catch {
      continue;
    }
    const p = parsePlayer(decodeJson(bytes));
    const s = p.sky;
    assert(s, `${e.name}: no clock`);
    assert(s.minute >= 0 && s.minute < 1440 && s.day >= 1, `${e.name}: clock ${s.minute} day ${s.day}`);
    // Midnight drops day 1's 4-minute remainder: from day 2 on, minutes are multiples of 8.
    assertEquals(s.minute % 4, 0, `${e.name}: minute`);
    if (s.day > 1) assertEquals(s.minute % 8, 0, `${e.name}: minute after day 1`);
    if (s.weather === Weather.Rain) assert(s.rain >= 0.08 && s.cloud === 1, `${e.name}: rain`);
    if (s.weather === Weather.Clear) assertEquals(s.cloud, 0, `${e.name}: clear sky`);
    const o = weatherOutlook(s, p.daysAlive, p.difficulty);
    assertAlmost(o.clear + o.cloudy + o.rain, 1, 1e-9, e.name);
    n++;
  }
  assert(n > 0, "no Player.save found");
});

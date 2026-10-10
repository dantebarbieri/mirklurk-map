// The player inspection's pure parts: wellbeing math (player_get_stat_changes / player_get_combined_wellbeing), stat
// statuses, condition labels, levels and the coin roll-up modes. Real saves are checked when available (skipped otherwise):
//   MIRKLURK_SAVES="…\Saves" deno task test

import { assert, assertAlmost, assertEquals } from "./assert.ts";
import { parseItemList } from "../src/inventory.ts";
import { countCoins } from "../src/coins.ts";
import { decodeJson, parsePlayer, type PlayerSave } from "../src/save.ts";
import {
  coinCount,
  coinNote,
  conditionsOf,
  currentCoinMode,
  displayCoins,
  percent,
  setCoinMode,
  sicknessLevel,
  signedPercent,
  statChange,
  statStatus,
  temperatureLabel,
  wellbeingChange,
  wellbeingTrend,
  wetClothes,
  xpForLevel,
} from "../src/player.ts";

type Wellbeing = Parameters<typeof wellbeingChange>[0];
const player = (over: Partial<Wellbeing> = {}): Wellbeing => ({
  vitals: { wellbeing: 1, focus: 0.3, stamina: 0.3, satiation: 0.3, warmth: 0.5 },
  effects: [],
  sickTime: 0,
  warmthTime: 0,
  restedTime: 0,
  ...over,
});

Deno.test("player: each stat's wellbeing change follows the game's thresholds and 0.1% rounding", () => {
  assertEquals(statChange("satiation", 0.5), 0.005);
  assertEquals(statChange("satiation", 0.49), 0);
  assertEquals(statChange("satiation", 0.2), 0);
  assertEquals(statChange("satiation", 0.1), -0.005);
  assertEquals(statChange("satiation", 0), -0.01);
  assertEquals(statChange("focus", 1), 0.002);
  assertEquals(statChange("focus", 0.0928), -0.003);
  assertEquals(statChange("stamina", 0.026666666666666), -0.004);
  assertEquals(statChange("stamina", -1), -0.005);
  // Warmth hurts outside 40–60%, up to 3% at either end.
  assertEquals(statChange("warmth", 0.5), 0);
  assertEquals(statChange("warmth", 0.4), 0);
  assertEquals(statChange("warmth", 0.6), 0);
  assertEquals(statChange("warmth", 0.19570654907133), -0.015);
  assertEquals(statChange("warmth", 0), -0.03);
  assertEquals(statChange("warmth", 0.8), -0.015);
  assertEquals(statChange("warmth", 1), -0.03);
});

Deno.test("player: combined wellbeing adds timers, sickness and overburdening like player_get_combined_wellbeing", () => {
  // Lorroakan's save: fed, but very tired, exhausted and very cold.
  const lorroakan = wellbeingChange(player({
    vitals: { wellbeing: 0.418, focus: 0.0928, stamina: 0.026666666666666, satiation: 0.5138, warmth: 0.19570654907133 },
    effects: [4, 16, 2, 23],
  }));
  assert(lorroakan);
  assertEquals(lorroakan.parts.map((x) => [x.label, x.change]), [
    ["Focus", -0.003],
    ["Stamina", -0.004],
    ["Satiation", 0.005],
    ["Warmth (temperature)", -0.015],
  ]);
  assertEquals(lorroakan.total, -0.017);

  // Tiberius: warm to the core and well rested outweigh a cold spell.
  const tiberius = wellbeingChange(player({
    vitals: { wellbeing: 1, focus: 0.9552, stamina: 0.94, satiation: 0.8046334, warmth: 0.323625241131445 },
    effects: [20, 22],
    warmthTime: 17.8,
    restedTime: 16.6,
  }));
  assert(tiberius);
  assertEquals(tiberius.parts.filter((x) => !x.stat).map((x) => x.label), ["Warm to the core", "Well rested"]);
  assertEquals(tiberius.total, 0.023);

  const sick = wellbeingChange(player({ effects: [18], sickTime: 12 }));
  assertEquals(sick?.parts.at(-1), { label: "Sickness II", change: -0.02 });
  assertEquals(sick?.total, -0.02);
  assertEquals(wellbeingChange(player({ effects: [18] }))?.total, 0, "sickness counts only while sickTime lasts");
  assertEquals(wellbeingChange(player({ effects: [24] }))?.total, 0, "plain overburdened costs AP, not wellbeing");
  assertEquals(wellbeingChange(player({ effects: [25] }))?.total, -0.01);
  assertEquals(wellbeingChange(player({ effects: [26] }))?.total, -0.02);
  assertEquals(wellbeingChange(player({ effects: [26, 25] }))?.total, -0.01, "the game checks very overburdened first");
  assertEquals(wellbeingChange(player({ vitals: undefined })), undefined);
  assertEquals([sicknessLevel([17, 19]), sicknessLevel([4])], [3, 0]);
});

Deno.test("player: stat statuses, temperature labels and wellbeing trend in words", () => {
  assertEquals(statStatus("warmth", 0.19570654907133), { change: -0.015, tone: "loss", text: "Very cold: −1.5% wellbeing per turn" });
  assertEquals(statStatus("warmth", 0.9).text, "Blazing hot: −2.3% wellbeing per turn");
  assertEquals(statStatus("warmth", 0.5), { change: 0, tone: "none", text: "Comfortable: no effect on wellbeing" });
  assertEquals(statStatus("warmth", 0.4).text, "Cold, but no effect yet");
  assertEquals(statStatus("satiation", 0.8), { change: 0.005, tone: "gain", text: "Raising wellbeing: +0.5% wellbeing per turn" });
  assertEquals(statStatus("focus", 0.05).text, "Too low: −0.4% wellbeing per turn");
  assertEquals(statStatus("stamina", 0.35).text, "No effect on wellbeing; from 50% it raises it");
  assertEquals(statStatus("stamina", 0.1999).text, "Low, but no effect yet");
  assertEquals(
    [0, 0.15, 0.2, 0.3, 0.35, 0.4, 0.5, 0.6, 0.65, 0.7, 0.8, 0.85, 0.9].map(temperatureLabel),
    [
      "Biting cold",
      "Biting cold",
      "Very cold",
      "Very cold",
      "Cold",
      "Cold",
      "Comfortable",
      "Comfortable",
      "Warm",
      "Warm",
      "Very hot",
      "Very hot",
      "Blazing hot",
    ],
  );
  assertEquals([percent(0.418321422115821), percent(1), percent(0.57), percent(0)], ["41.8%", "100%", "57%", "0%"]);
  assertEquals([signedPercent(-0.017), signedPercent(0.005), signedPercent(-0)], ["−1.7%", "+0.5%", "±0%"]);
  assertEquals(wellbeingTrend(0.3, -0.01), "Dangerously low and falling");
  assertEquals(wellbeingTrend(0.6, -0.01), "Falling");
  assertEquals(wellbeingTrend(1, 0.02), "Full: it cannot rise above 100%");
  assertEquals(wellbeingTrend(0.6, 0), "Steady");
});

Deno.test("player: conditions get short labels, timers and wet clothes", () => {
  const p = { effects: [4, 16, 2, 23, 20, 22, 18, 4, 99], sickTime: 11.2, warmthTime: 17.8, restedTime: 16.6 };
  assertEquals(
    conditionsOf(p).map((c) => [c.label, c.tone, c.turns ?? null]),
    [
      ["Very tired", "bad", null],
      ["Lit item", "info", null],
      ["Exhausted", "bad", null],
      ["Some shelter", "good", null],
      ["Warm to the core", "good", 18],
      ["Well rested", "good", 17],
      ["Sickness II", "bad", 12],
      ["Condition 99", "info", null],
    ],
  );
  assertEquals(wetClothes([1, 0.4, 0.004, 1]), ["head 100%", "torso 40%", "feet 100%"]);
  assertEquals(wetClothes([]), []);
});

Deno.test("player: XP needed per level (xp_to_lvl)", () => {
  assertEquals([1, 5, 7, 17].map(xpForLevel), [30, 65, 100, 620]);
});

Deno.test("player: coin roll-up counts true or fewest coins, remembered across roll-ups", () => {
  const coin = (index: number, amount: number) => ({ index, amount, X: 0, Y: 0, subParts: [] });
  const pouch = { ...coin(12, 1), subParts: [{ type: 0, gridSave: [[coin(72, 250)], [coin(73, 12)]] }] };
  const c = countCoins(parseItemList([coin(74, 1), pouch, coin(72, 5)]));
  assertEquals(displayCoins(c, "true"), { gold: 1, silver: 12, copper: 255 });
  assertEquals(displayCoins(c, "minimum"), { gold: 2, silver: 4, copper: 55 });
  assertEquals(coinCount(c), 268);
  assertEquals(coinNote(c, "true"), "268 coins, bags included · worth 2,455 copper (24.55 silver)");
  assertEquals(coinNote(c, "minimum"), "61 coins at fewest (you carry 268) · worth 2,455 copper (24.55 silver)");
  assertEquals(coinNote({ gold: 1, silver: 0, copper: 0 }, "minimum"), "1 coin, already the fewest · worth 1,000 copper (10 silver)");
  assertEquals(currentCoinMode(), "true");
  setCoinMode("minimum");
  assertEquals(currentCoinMode(), "minimum");
  setCoinMode("true");
});

const dir = Deno.env.get("MIRKLURK_SAVES") ??
  decodeURIComponent(new URL("../../Saves", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const players = (() => {
  const out: [string, PlayerSave][] = [];
  try {
    for (const e of Deno.readDirSync(dir)) {
      if (!e.isDirectory) continue;
      try {
        out.push([e.name, parsePlayer(decodeJson(Deno.readFileSync(`${dir}/${e.name}/Player.save`)))]);
      } catch {
        // Not a character folder.
      }
    }
  } catch {
    // No saves here.
  }
  return out;
})();

Deno.test({ name: "player: real saves agree with the wellbeing port", ignore: players.length === 0 }, () => {
  for (const [name, p] of players) {
    const change = wellbeingChange(p);
    assert(change && p.vitals, `${name}: vitals saved`);
    // The game keeps aeList 30 exactly while wellbeing is at most 33% and the combined change is negative.
    assertEquals(p.effects.includes(30), p.vitals.wellbeing <= 0.33 && change.total < 0, `${name}: dangerously low flag`);
    for (const c of conditionsOf(p)) assert(!c.label.startsWith("Condition "), `${name}: condition ${c.index} has a label`);
    if (p.effects.includes(20)) assert(p.warmthTime > 0, `${name}: warm to the core has a timer`);
    if (p.effects.includes(22)) assert(p.restedTime > 0, `${name}: well rested has a timer`);
    if (sicknessLevel(p.effects)) assert(p.sickTime > 0, `${name}: sickness has a timer`);
    assert(Math.round(p.xp) < xpForLevel(p.level), `${name}: XP below the next level`);
    if (name === "Lorroakan") assertAlmost(change.total, -0.017, 1e-9, name);
    if (name === "Tiberius") assertAlmost(change.total, 0.023, 1e-9, name);
  }
});

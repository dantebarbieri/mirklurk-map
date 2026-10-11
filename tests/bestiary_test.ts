// Being combat stats and fresh hit points (src/bestiary.ts). The last test reads real saves when they are available:
//   MIRKLURK_SAVES="…\Saves" deno task test      (defaults to ../Saves next to this folder)

import { assert, assertEquals } from "./assert.ts";
import {
  BEINGS,
  canHurt,
  damageCell,
  DamageClass,
  damageClassInfo,
  damageText,
  formatPercent,
  formatTiles,
  freshHealth,
  hardIq,
  hasRanged,
  targetsYou,
  totalDamage,
  turnsPattern,
} from "../src/bestiary.ts";
import { BEING_NAMES, DAMAGE_CLASS_NAMES } from "../src/gamedata.ts";
import { NPC_BEINGS } from "../src/rules.ts";

const rectangular = (g: number[][]) => g.length > 0 && g.every((r) => r.length > 0 && r.length === g[0].length);

Deno.test("bestiary: every being 0–35 with consistent attacks", () => {
  assertEquals(Object.keys(BEINGS).map(Number).sort((a, b) => a - b), [...Array(36).keys()]);
  for (const [i, s] of Object.entries(BEINGS)) {
    assert(BEING_NAMES[+i] !== undefined, `${i} has a name`);
    for (const a of [s.melee, ...(s.ranged ? [s.ranged] : [])]) {
      assert(rectangular(a.pattern), `${i} pattern is rectangular`);
      assert(a.damageClass === undefined || DAMAGE_CLASS_NAMES[a.damageClass] !== undefined, `${i} damage class is named`);
      assert(a.iq >= 0 && a.iq <= 4 && a.cost > 0 && a.cost <= s.apMax && a.dist > 0, `${i} attack numbers`);
      for (const v of a.pattern.flat()) {
        const d = damageCell(v);
        assert(v === 0 || (d && d.max >= d.min), `${i} cell ${v}`);
      }
    }
    assertEquals(hasRanged(+i), s.ranged !== undefined, `${i} ranged`);
    assert(!s.ranged || canHurt(s.ranged), `${i} ranged attack hurts`);
    assert(s.grid[0] > 0 && s.grid[1] > 0, `${i} grid`);
  }
  assertEquals(Object.keys(BEINGS).filter((i) => hasRanged(+i)).map(Number), [5, 8, 12, 13, 16, 22, 34]);
  assertEquals(Object.keys(BEINGS).filter((i) => !canHurt(BEINGS[+i].melee)).map(Number), [9, 20]);
  for (const npc of NPC_BEINGS) assert(!targetsYou(BEINGS[npc]), `${BEING_NAMES[npc]} is on the fort's team`);
  assert(targetsYou(BEINGS[22]));
});

Deno.test("bestiary: damage cells and totals as the game reads them", () => {
  assertEquals(damageCell(0), undefined);
  assertEquals(damageCell(0.1), { min: 0, max: 1 });
  assertEquals(damageCell(1.1), { min: 1, max: 1 });
  assertEquals(damageCell(2.3), { min: 2, max: 3 });
  assertEquals(damageCell(4.6), { min: 4, max: 6 });
  assertEquals(damageText({ min: 1, max: 2 }), "1–2");
  assertEquals(damageText({ min: 3, max: 3 }), "3");
  // Scaal's ranged blow, Captain Eir's cross, Tain's empty pattern.
  assertEquals(totalDamage(BEINGS[22].ranged!.pattern), { min: 7, max: 15 });
  assertEquals(totalDamage(BEINGS[6].melee.pattern), { min: 6, max: 10 });
  assertEquals(totalDamage(BEINGS[20].melee.pattern), { min: 0, max: 0 });
  assertEquals(damageClassInfo(DamageClass.Sharp)?.name, "Sharp");
  assertEquals(damageClassInfo(BEINGS[13].ranged!.damageClass)?.key, "poison");
  assertEquals(damageClassInfo(BEINGS[9].melee.damageClass), undefined);
  for (const dc of Object.keys(DAMAGE_CLASS_NAMES).map(Number)) assert(damageClassInfo(dc)!.effect, `${dc} effect`);
});

Deno.test("bestiary: labels like the examine card", () => {
  assertEquals(formatPercent(0.33), "33%");
  assertEquals(formatPercent(0.175), "17.5%");
  assertEquals(formatPercent(1), "100%");
  assertEquals(formatTiles(1.5), "1 tile");
  assertEquals(formatTiles(2.25), "2 tiles");
  assertEquals(hardIq(3), 4);
  assertEquals(hardIq(4), 4);
  assert(turnsPattern(BEINGS[15].melee), "Sharp blows come turned");
  assert(!turnsPattern(BEINGS[0].melee) && !turnsPattern(BEINGS[13].melee), "Zero and Medium intelligence keep the pattern");
  assert(turnsPattern(BEINGS[13].melee, hardIq(BEINGS[13].melee.iq)), "High intelligence turns it");
});

Deno.test("bestiary: fresh hit points match saved full-health beings", () => {
  assertEquals(freshHealth(13), [[-4, 1, -4], [1, 4, 1], [-4, 1, -4]]);
  assertEquals(freshHealth(7), [[2, 2], [2, 2]]);
  assertEquals(freshHealth(30), [[4, 4], [4, 4]]);
  assertEquals(freshHealth(29), [[2, 1, 2, 1], [1, 2, 1, 2]]);
  assertEquals(freshHealth(23), [[2], [1], [1]]);
  assertEquals(freshHealth(28), [[1, 1, -4], [-4, 1, 1], [1, 1, -4], [-4, 1, 1], [1, 1, -4], [-4, 1, 1], [1, 1, -4]]);
  assertEquals(freshHealth(21), [
    [-4, -4, 1, -4, -4],
    [-4, 1, 1, 1, -4],
    [1, 1, 1, 1, 1],
    [-4, 1, 1, 1, -4],
    [-4, -4, 1, -4, -4],
  ]);
  assertEquals(freshHealth(20), Array(4).fill([2, 2, 2, 2, 2]));
  assertEquals(freshHealth(18), Array(5).fill([2, 2, 2, 2, 2]));
  assertEquals(freshHealth(25), [[-4, 1, 1, -4], [1, 1, 1, 1], [1, 1, 1, 1], [-4, 1, 1, -4]]);
  assertEquals(freshHealth(34), [[1, 1, 1, 1], [1, 2, 2, 1], [1, 2, 2, 1], [1, 1, 1, 1]]);
  assertEquals(freshHealth(35), [[1, 1, 1, 1], [1, 3, 2, 1], [1, 2, 3, 1]]);
  // Scaal: 4 at the centre down to 1 at the corners, by distance (halves round to even).
  const scaal = freshHealth(22)!;
  assertEquals(scaal[4], [2, 2, 3, 4, 4, 4, 3, 2, 2]);
  assertEquals(scaal[0], [1, 2, 2, 2, 2, 2, 2, 2, 1]);
  assertEquals(freshHealth(-1), undefined);
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

function* beingSaves(root: string): Generator<string> {
  for (const e of Deno.readDirSync(root)) {
    const p = `${root}/${e.name}`;
    if (e.isDirectory) yield* beingSaves(p);
    else if (e.name === "Beings.save") yield p;
  }
}

Deno.test({ name: "real saves: no saved being has more hit points or armor than a fresh one", ignore: !present }, () => {
  let full = 0;
  for (const file of beingSaves(dir)) {
    const beings = JSON.parse(Deno.readTextFileSync(file).replace(/\0+$/, "")) as { index: number; hpgrid?: number[][] }[];
    for (const b of beings) {
      const fresh = freshHealth(b.index);
      if (!fresh || !Array.isArray(b.hpgrid)) continue;
      const at = `${BEING_NAMES[b.index]} in ${file}`;
      assertEquals([b.hpgrid.length, b.hpgrid[0].length], [fresh.length, fresh[0].length], `${at}: shape`);
      fresh.forEach((row, y) =>
        row.forEach((v, x) => {
          const saved = b.hpgrid![y][x];
          assert(v === -4 ? saved === -4 : saved !== -4 && saved <= v, `${at}: cell ${x},${y} is ${saved}, fresh ${v}`);
        })
      );
      if (JSON.stringify(b.hpgrid) === JSON.stringify(fresh)) full++;
    }
  }
  assert(full > 0, "some beings were saved at full health");
});

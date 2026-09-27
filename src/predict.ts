// Where the quest landmarks are, or where the game's own placement rules can still put them.

import { BEING_NAMES, SPRITES } from "./gamedata.ts";
import { Area, PLACEMENT, type Placement, SHIPWRECK_TRIES, SHIPWRECK_UNEXPLORED_CHANCE, shipwreckSiteOk, SolidId, TILES } from "./rules.ts";
import type { Being, Solid, Tree } from "./save.ts";
import type { World, Zone } from "./world.ts";

export type LandmarkId = "fort" | "bhato" | "library" | "scaal" | "gurb" | "ihar";

export interface Candidate {
  x: number;
  y: number;
  /** Chance the landmark ends up in this zone (candidates sum to 1). */
  share: number;
  /** Chance it is created the next time you enter this zone. */
  entry: number;
  /** `entry` is an estimate because the zone's terrain does not exist yet. */
  estimated: boolean;
  /** It will be created here as soon as this save is loaded (you are standing in it). */
  now: boolean;
}

export interface Landmark {
  id: LandmarkId;
  name: string;
  building: string;
  solidId: number;
  /** found: exact building from the save; zone: zone known, spot not generated yet; candidates: not created yet. */
  status: "found" | "zone" | "candidates" | "none";
  zone?: [number, number];
  solid?: Solid;
  candidates?: Candidate[];
  note: string;
}

const LANDMARKS: { id: LandmarkId; name: string; building: string; solidId: number }[] = [
  { id: "fort", name: "Fort Solid", building: "Fort Solid", solidId: SolidId.Fort },
  { id: "bhato", name: BEING_NAMES[12] ?? "Ranger Bhato", building: "Hideout", solidId: SolidId.Hideout },
  { id: "library", name: "Library", building: "Library", solidId: SolidId.Library },
  { id: "scaal", name: BEING_NAMES[22] ?? "Scaal", building: "Lair", solidId: SolidId.Lair },
  { id: "gurb", name: BEING_NAMES[26] ?? "Gurb-Gurb", building: "Hut", solidId: SolidId.Hut },
  { id: "ihar", name: BEING_NAMES[33] ?? "Ihar", building: "Shipwreck", solidId: SolidId.Shipwreck },
];

function findSolid(world: World, id: number): { zone: Zone; solid: Solid } | undefined {
  for (const row of world.zones) {
    for (const zone of row) {
      const solid = zone.solids.find((s) => s.index === id);
      if (solid) return { zone, solid };
    }
  }
}

const zonesOfType = (world: World, types: number[]) => world.zones.flat().filter((z) => types.includes(z.type));

/** Zone-level odds: head for a random candidate each time (repeats allowed); each entry succeeds with `entry`. */
export function shareOut(cands: Omit<Candidate, "share">[]): Candidate[] {
  const total = cands.reduce((s, c) => s + c.entry, 0);
  const now = cands.find((c) => c.now);
  const rest = now ? 1 - now.entry : 1;
  return cands.map((c) => ({
    ...c,
    share: total <= 0 ? 0 : (c.now ? c.entry : 0) + rest * c.entry / total,
  }));
}

/** Chance of at least one valid site in SHIPWRECK_TRIES tries, from a zone's saved tiles. */
export function shipwreckOdds(water1: Uint32Array, lower: Uint32Array): { perTry: number; perEntry: number; heat: Float32Array } {
  const { axis, door } = PLACEMENT.shipwreck;
  const heat = new Float32Array(TILES * TILES);
  let all = 0, ok = 0;
  for (const [ay, wy] of axis) {
    for (const [ax, wx] of axis) {
      const w = wx * wy;
      all += w;
      if (shipwreckSiteOk(water1, lower, ax / 16, ay / 16)) {
        ok += w;
        heat[((ay + door[1]) >> 4) * TILES + ((ax + door[0]) >> 4)] += w;
      }
    }
  }
  if (ok > 0) { for (let i = 0; i < heat.length; i++) heat[i] /= ok; }
  const perTry = ok / all;
  return { perTry, perEntry: 1 - Math.pow(1 - perTry, SHIPWRECK_TRIES), heat };
}

export function landmarks(world: World, shipwreck: Map<string, number>): Landmark[] {
  const p = world.player;
  const here = `${p.area.x},${p.area.y}`;
  const out: Landmark[] = [];
  for (const def of LANDMARKS) {
    const hit = findSolid(world, def.solidId);
    if (hit) {
      out.push({ ...def, status: "found", zone: [hit.zone.x, hit.zone.y], solid: hit.solid, note: hit.zone.name });
      continue;
    }
    if (def.id === "fort" || def.id === "bhato" || def.id === "library" || def.id === "scaal") {
      const cell = def.id === "fort" ? zonesOfType(world, [Area.Fort])[0] : (() => {
        const c = def.id === "bhato" ? p.rangerCamp : def.id === "library" ? p.libraryArea : p.riftQuestArea;
        return c ? world.zones[c[1]]?.[c[0]] : undefined;
      })();
      if (!cell) {
        out.push({ ...def, status: "none", note: "This save does not record it." });
      } else if (cell.explored) {
        out.push({
          ...def,
          status: "zone",
          zone: [cell.x, cell.y],
          note: "Its zone is in your save; include that zone's folder to see the exact spot.",
        });
      } else {
        out.push({
          ...def,
          status: "zone",
          zone: [cell.x, cell.y],
          note:
            "Its zone is fixed in your save; the game places the building when you first enter. The shaded square shows where it can land.",
        });
      }
      continue;
    }

    // Gurb-Gurb and Ihar are created by manager_area Alarm_6 on entering a matching zone.
    const isGurb = def.id === "gurb";
    const created = isGurb ? p.gurbsHut : p.shipWreck;
    const drowned = zonesOfType(world, [Area.DrownedFen]);
    const types = isGurb ? (drowned.length ? [Area.DrownedFen] : [Area.SavageMirk]) : [Area.BrokenFen];
    let pool = zonesOfType(world, types);
    // Already created but not found: it must be in an explored zone whose folder we could not check.
    if (created) pool = pool.filter((z) => z.explored && !z.dir);
    const kind = isGurb ? (types[0] === Area.DrownedFen ? "Drowned Fen" : "Savage Mirk") : "Broken Fen";
    const raw = pool.map((z) => {
      const key = `${z.x},${z.y}`;
      const measured = shipwreck.get(key);
      const entry = created || isGurb ? 1 : measured ?? SHIPWRECK_UNEXPLORED_CHANCE;
      return {
        x: z.x,
        y: z.y,
        entry,
        estimated: !created && !isGurb && measured === undefined,
        now: !created && key === here && p.area.type === z.type,
      };
    });
    const candidates = shareOut(raw);
    if (created) {
      out.push({
        ...def,
        status: candidates.length ? "candidates" : "none",
        candidates,
        note: candidates.length
          ? `Already created in an explored ${kind}, but that zone's folder was not loaded.`
          : `Your save says it exists, but no loaded ${kind} holds it; load the whole character folder.`,
      });
    } else if (!candidates.some((c) => c.share > 0)) {
      out.push({ ...def, status: "none", candidates, note: `No ${kind} in this world can hold it.` });
    } else {
      const now = candidates.find((c) => c.now);
      out.push({
        ...def,
        status: "candidates",
        candidates,
        note: now
          ? `You are in a ${kind}: it appears here as soon as you load this save${now.entry < 1 ? ` (${pct(now.entry)} chance)` : ""}.`
          : isGurb
          ? `Appears in the first ${kind} you enter.`
          : `Appears in the first ${kind} you enter that has a suitable shore.`,
      });
    }
  }
  return out;
}

export const pct = (p: number) => (p >= 0.995 && p < 1 ? ">99%" : p > 0 && p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`);

/** Bounding box of a sprite placed at (x, y) (sprite origin applied), as [left, top, right, bottom]. */
export function spriteBox(sprite: string, x: number, y: number): [number, number, number, number] {
  const g = SPRITES[sprite];
  if (!g) return [x - 8, y - 8, x + 7, y + 7];
  const [, , ox, oy, bl, br, bt, bb] = g;
  return [x - ox + bl, y - oy + bt, x - ox + br, y - oy + bb];
}

function latticeHeat(pl: Placement, valid?: (ax: number, ay: number) => boolean): Float32Array {
  const heat = new Float32Array(TILES * TILES);
  let total = 0;
  for (const [ay, wy] of pl.axis) {
    for (const [ax, wx] of pl.axis) {
      if (valid && !valid(ax, ay)) continue;
      const tx = (ax + pl.door[0]) >> 4, ty = (ay + pl.door[1]) >> 4;
      if (tx < 0 || ty < 0 || tx >= TILES || ty >= TILES) continue;
      heat[ty * TILES + tx] += wx * wy;
      total += wx * wy;
    }
  }
  if (total > 0) { for (let i = 0; i < heat.length; i++) heat[i] /= total; }
  return heat;
}

/**
 * Hut rule (Alarm_6): it re-rolls until its rectangle, grown by 16, touches an active PAR_solid or PAR_being.
 * Trees are PAR_solid too, but only those near the camera are active then (smartactivation), so trees count
 * only around the player's position when the player is in this zone.
 */
function hutValidity(solids: Solid[], beings: Being[], trees: Tree[], player?: [number, number]) {
  const boxes: [number, number, number, number][] = solids.map((s) => spriteBox(s.sprite, s.x, s.y));
  for (const b of beings) boxes.push(spriteBox("spr_male1", b.x, b.y));
  if (player) {
    boxes.push(spriteBox("spr_human_legs", player[0], player[1]));
    const [px, py] = player;
    for (const t of trees) {
      if (t.x > px - 480 && t.x < px + 480 && t.y > py - 276 && t.y < py + 500) boxes.push(spriteBox("spr_ui_frame_16", t.x, t.y));
    }
  }
  const [w, h] = [SPRITES["spr_building_80x80"]?.[0] ?? 80, SPRITES["spr_building_80x80"]?.[1] ?? 128];
  return (ax: number, ay: number) => {
    const l = ax - 16, t = ay - h - 16, r = ax + w + 16, b = ay + 16;
    return boxes.some(([bl, bt, br, bb]) => !(br < l || bl > r || bb < t || bt > b));
  };
}

export interface ZoneHeat {
  id: LandmarkId;
  heat: Float32Array;
  /** How the heat was derived, for the legend. */
  basis: string;
}

/** Number of possible door tiles, and whether they are all equally likely. */
function spots(heat: Float32Array): { n: string; even: boolean } {
  let n = 0, min = Infinity, max = 0;
  for (const v of heat) {
    if (v <= 0) continue;
    n++;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return { n: `${n.toLocaleString("en-US")} ${n === 1 ? "spot" : "spots"}`, even: max - min < 1e-9 };
}

/**
 * Door-tile probabilities for landmarks that could still appear in this zone.
 * `tiles` supplies the zone's saved layers and objects; the exact rules need them, otherwise the rule's full range shows.
 */
export function zoneHeat(
  world: World,
  marks: Landmark[],
  zone: Zone,
  tiles?: { water1?: Uint32Array; lower?: Uint32Array; beings?: Being[]; trees?: Tree[] },
): ZoneHeat[] {
  const out: ZoneHeat[] = [];
  const pending = zone.explored ? "this zone's files were not loaded" : "the zone is generated when you enter";
  for (const m of marks) {
    const inZone = m.zone && m.zone[0] === zone.x && m.zone[1] === zone.y;
    if (m.status === "zone" && inZone && !zone.explored) {
      const pl = m.id === "bhato" ? PLACEMENT.hideout : m.id === "library" ? PLACEMENT.library : m.id === "scaal" ? PLACEMENT.lair : null;
      if (pl) {
        const heat = latticeHeat(pl);
        const sp = spots(heat);
        out.push({
          id: m.id,
          heat,
          basis: `${sp.n}, ${sp.even ? "all equally likely" : "some twice as likely as others"} (the game's placement rule)`,
        });
      }
    }
    const cand = m.status === "candidates" && m.candidates?.find((c) => c.x === zone.x && c.y === zone.y && c.share > 0);
    if (!cand) continue;
    if (m.id === "gurb") {
      const p = world.player;
      if (zone.dir) {
        const here = p.area.x === zone.x && p.area.y === zone.y ? p.pos : undefined;
        const heat = latticeHeat(PLACEMENT.hut, hutValidity(zone.solids, tiles?.beings ?? [], tiles?.trees ?? [], here));
        out.push({ id: m.id, heat, basis: `${spots(heat).n}; it has to touch a rock, ruin, tree or creature` });
      } else {
        out.push({ id: m.id, heat: latticeHeat(PLACEMENT.hut), basis: `anywhere away from the edges; ${pending}` });
      }
    } else if (m.id === "ihar") {
      if (zone.dir && tiles?.water1 && tiles.lower) {
        const heat = shipwreckOdds(tiles.water1, tiles.lower).heat;
        out.push({ id: m.id, heat, basis: `${spots(heat).n} on your saved shores pass the game's test` });
      } else {
        out.push({ id: m.id, heat: latticeHeat(PLACEMENT.shipwreck), basis: `on a shore with open water to its west; ${pending}` });
      }
    }
  }
  return out;
}

/** Extent of a heat map in game units (for outlines on the overview grid). */
export function heatBounds(heat: Float32Array): [number, number, number, number] | null {
  let x0 = TILES, y0 = TILES, x1 = -1, y1 = -1;
  for (let i = 0; i < heat.length; i++) {
    if (heat[i] <= 0) continue;
    const x = i % TILES, y = (i / TILES) | 0;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : [x0 * 16, y0 * 16, (x1 + 1) * 16, (y1 + 1) * 16];
}

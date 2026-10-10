// A creature's or NPC's hit points, attacks and combat stats (worker-owned; see the inspection dispatch in inspect.ts).

import type { HealthGrid } from "./health.ts";
import type { SectionContext } from "./inspect.ts";

/** Inspection sections for a living being: its saved hit points, its attacks (melee/ranged) and its combat stats. */
export function creatureView(_being: number, _health: HealthGrid | undefined, _ctx: SectionContext): HTMLElement[] {
  return [];
}

// The player's saved condition and belongings (worker-owned; see the inspection dispatch in inspect.ts).

import type { SectionContext } from "./inspect.ts";
import type { PlayerSave } from "./save.ts";

/** Inspection sections for the player: hit points, wellbeing and its four stats, conditions, coins and inventory. */
export function playerView(_p: PlayerSave, _ctx: SectionContext): HTMLElement[] {
  return [];
}

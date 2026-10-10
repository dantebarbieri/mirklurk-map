// What the merchants sell (worker-owned; see the inspection dispatch in inspect.ts).

import type { SectionContext } from "./inspect.ts";

/** Whether a being trades with the player. */
export const sells = (_being: number): boolean => false;

/** Inspection sections for a merchant: its wares and their prices. */
export function merchantView(_being: number, _ctx: SectionContext): HTMLElement[] {
  return [];
}

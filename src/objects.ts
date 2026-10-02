// Classifies saved objects into map markers.

import { BEING_NAMES, ITEM_NAMES, MAP_LABELS, NATURE_NAMES } from "./gamedata.ts";
import { spriteBox } from "./predict.ts";
import { centerpos, INTERIOR_NAMES, isOutside, LANDMARK_NAMES, NPC_BEINGS, SolidId } from "./rules.ts";
import type { Placed, Solid, Tree } from "./save.ts";
import type { Interior, ZoneDetail } from "./world.ts";
import type { Inventory } from "./inventory.ts";

export type Layer = "places" | "npcs" | "creatures" | "loot" | "camp" | "boulders" | "rocks" | "trees";

export const LAYERS: { id: Layer; label: string; on: boolean }[] = [
  { id: "npcs", label: "NPCs", on: true },
  { id: "loot", label: "Loot", on: true },
  { id: "camp", label: "Camp & storage", on: true },
  { id: "boulders", label: "Boulders & ruins", on: true },
  { id: "creatures", label: "Creatures", on: false },
  { id: "rocks", label: "Small rocks", on: false },
  { id: "trees", label: "Trees", on: false },
];

export interface Mark {
  layer: Layer;
  /** CSS class for the marker style. */
  kind: string;
  x: number;
  y: number;
  box?: [number, number, number, number];
  label?: string;
  name: string;
  detail?: string;
  interior?: Interior;
  /** Entrance leading here: "explored" when the game has saved the interior. */
  explored?: boolean;
  inventory?: Inventory;
}

const tile = (x: number, y: number) => `tile ${x >> 4},${y >> 4}`;

export const markKey = (m: Mark) => `${m.layer}:${m.x}:${m.y}:${m.name === "Unsearched remains" ? "Remains" : m.name}`;

/** The saved interior a transition leads to (folder "[ zx,zy,ex,ey ]", or RW1–RW3 for the rift depths). */
function interiorFor(tp: number[], interiors: Interior[]): Interior | undefined {
  if (tp[0] >= 24 && tp[0] <= 26) return interiors.find((i) => i.at[0] === -1 && i.kind === tp[0]);
  return interiors.find((i) => i.at[0] === centerpos(tp[1]) && i.at[1] === centerpos(tp[2]));
}

/** Solids of a zone (current = undefined) or of an interior. */
export function solidMarks(solids: Solid[], interiors: Interior[], current?: Interior): Mark[] {
  const out: Mark[] = [];
  for (const s of solids) {
    const box = spriteBox(s.sprite, s.x, s.y);
    const tp = s.transPoint && s.transPoint.length >= 3 ? s.transPoint : null;
    const landmark = LANDMARK_NAMES[s.index];
    if (landmark) {
      const name = MAP_LABELS[s.index] ?? landmark;
      const leads = tp ? INTERIOR_NAMES[tp[0]] : undefined;
      const interior = tp ? interiorFor(tp, interiors) : undefined;
      out.push({
        layer: "places",
        kind: s.index === SolidId.Boat ? "boat" : "landmark",
        x: tp ? tp[1] : (box[0] + box[2]) / 2,
        y: tp ? tp[2] : box[3],
        box,
        // The game prints Fort Solid and Camp on its own map already.
        label: s.index === SolidId.Boat || MAP_LABELS[s.index] ? undefined : name,
        name,
        detail: leads && leads !== name ? `Leads to: ${leads}` : undefined,
        interior,
        explored: !!interior,
      });
      continue;
    }
    if (tp) {
      const up = isOutside(tp[0]) || (current?.parent != null && tp[0] === current.parent.kind);
      if (current && up) {
        out.push({ layer: "places", kind: "exit", x: tp[1], y: tp[2], box, name: "Way out" });
        continue;
      }
      const name = INTERIOR_NAMES[tp[0]];
      if (name) {
        const interior = interiorFor(tp, interiors);
        out.push({
          layer: "places",
          kind: interior ? "entrance explored" : "entrance",
          x: tp[1],
          y: tp[2],
          box,
          name: current ? `${name} (deeper)` : name,
          detail: interior ? "Explored" : "Not entered yet",
          interior,
          explored: !!interior,
        });
        continue;
      }
    }
    if (s.index === SolidId.LibraryShelf) {
      out.push({ layer: "loot", kind: "shelf", x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2, box, name: "Bookshelf" });
      continue;
    }
    const spr = s.sprite;
    let layer: Layer = "boulders", kind = "boulder", name = "Boulder";
    if (spr === "spr_boulders_128x128") [kind, name] = ["boulder big", "Large boulder"];
    else if (/^spr_ruins_(32x32|64x48)$/.test(spr)) [kind, name] = ["ruin", "Ruins"];
    else if (/^spr_(boulders_16x16|cavesolids_)/.test(spr)) [layer, kind, name] = ["rocks", "rock", "Rock"];
    else if (spr === "spr_ruins_16x16") [layer, kind, name] = ["rocks", "rock", "Ruin block"];
    else if (!/^spr_boulders_/.test(spr)) [layer, kind, name] = ["rocks", "rock", spr.replace(/^spr_/, "").replace(/_/g, " ")];
    out.push({ layer, kind, x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2, box, name });
  }
  return out;
}

const CHEST: Record<number, string> = { 149: "Chest", 150: "Chest (better loot)", 151: "Chest (best loot)" };

export function detailMarks(d: ZoneDetail): Mark[] {
  const out: Mark[] = [];
  for (const b of d.beings) {
    if (b.state === 1) continue;
    const name = BEING_NAMES[b.index] ?? `Being ${b.index}`;
    const npc = NPC_BEINGS.has(b.index);
    const label = npc && b.index !== 5 ? name : undefined;
    out.push({ layer: npc ? "npcs" : "creatures", kind: npc ? "npc" : "creature", x: b.x, y: b.y, name, label });
  }
  for (const c of d.containers) {
    const at = {
      x: c.x,
      y: c.y,
      inventory: c.inventory ?? { state: "unavailable" as const, reason: "Contents were not recorded in this save." },
    };
    if (c.index === 152) out.push({ layer: "loot", kind: "loot", ...at, name: c.status === -214 ? "Unsearched remains" : "Remains" });
    else if (CHEST[c.index]) out.push({ layer: "loot", kind: "loot chest", ...at, name: CHEST[c.index] });
    else if (c.status === -215) out.push({ layer: "loot", kind: "loot", ...at, name: "Supplies" });
    else if (c.status === -211) {
      out.push({ layer: "camp", kind: "storage", ...at, name: c.index === 108 ? ITEM_NAMES[108] ?? "Hidden Hollow" : "Storage chest" });
    } else if (c.status === -209 || c.status === -216) {
      out.push({ layer: "loot", kind: "carcass", ...at, name: `Carcass: ${BEING_NAMES[c.index] ?? "creature"}` });
    } else if (c.status === -205) {
      out.push({ layer: "loot", kind: "drop", ...at, name: "Dropped items" });
    } else out.push({ layer: "loot", kind: "loot", ...at, name: ITEM_NAMES[c.index] ?? "Container" });
  }
  for (const loot of d.groundLoot ?? []) {
    out.push({
      layer: "loot",
      kind: "drop",
      name: "Ground loot",
      ...loot,
      detail: `Separate LOOT-${loot.x}_${loot.y}.save record; not merged with containers at this tile`,
    });
  }
  for (const s of d.stations) out.push(stationMark(s));
  for (const i of d.interactables) {
    const [l, t, r, b] = spriteBox(i.sprite, i.x, i.y);
    if (i.object === "obj_rift") {
      out.push({ layer: "places", kind: "rift", x: (l + r) / 2, y: (t + b) / 2, name: "Rift", detail: "harms anything close to it" });
    } else if (i.object === "obj_interactable") {
      out.push({ layer: "loot", kind: "loot", x: i.x, y: i.y, name: "Something to examine" });
    }
  }
  return out;
}

function stationMark(s: Placed): Mark {
  const name = ITEM_NAMES[s.index] ?? "Workstation";
  return { layer: "camp", kind: "camp", x: s.x, y: s.y, name };
}

/** Saved interiors whose entrance no longer exists (so they get a marker of their own). */
export const sealedMarks = (interiors: Interior[]): Mark[] =>
  interiors.filter((i) => i.sealed && !i.parent && i.at[0] >= 0).map((i) => ({
    layer: "places",
    kind: "entrance explored",
    x: i.at[0],
    y: i.at[1],
    name: i.kind !== null ? INTERIOR_NAMES[i.kind] ?? "Interior" : "Interior",
    detail: "entrance is gone",
    interior: i,
    explored: true,
  }));

export const treeMarks = (trees: Tree[]): Mark[] =>
  trees.map((t) => ({ layer: "trees", kind: "tree", x: t.x, y: t.y, name: NATURE_NAMES[t.index] ?? "Tree" }));

export const describe = (m: Mark) => `${m.name}${m.detail ? ` — ${m.detail}` : ""} (${tile(m.x, m.y)})`;

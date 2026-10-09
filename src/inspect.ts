import { h } from "./dom.ts";
import { ITEM_NAMES } from "./gamedata.ts";
import type { Inventory, SavedItem } from "./inventory.ts";
import { type Mark, markKey } from "./objects.ts";
import type { Tree } from "./save.ts";
import { CHOP_TOOLS, formatAp, FRESHNESS, harvestCost, MAX_AP, NATDEAD, Nature, partLabel, trunkOf, trunkWood, UNARMED } from "./chop.ts";
import { entityWiki, itemWiki, wikiUrl, wikiVerified } from "./wiki.ts";

export function wikiLink(url: string | undefined, label = "Wiki") {
  return url
    ? h("a", {
      class: "link wiki",
      href: url,
      target: "_blank",
      rel: "noopener noreferrer",
      title: `Wiki page verified ${wikiVerified}; opens in a new tab`,
    }, label)
    : h("span", { class: "muted" }, "No verified wiki page");
}

function itemRow(item: SavedItem, key: string, expanded?: Set<string>): HTMLElement {
  const name = ITEM_NAMES[item.index] ?? `Item ${item.index}`;
  const url = itemWiki(name);
  const condition = [
    item.durability !== undefined ? `durability ${Math.round(item.durability * 100) / 100}` : "",
    item.wet !== undefined && item.wet > 0 ? `wet ${Math.round(item.wet * 100)}%` : "",
  ].filter(Boolean).join(", ");
  return h(
    "li",
    {},
    url ? wikiLink(url, name) : name,
    ` x${item.amount}`,
    condition ? h("span", { class: "muted" }, ` (${condition})`) : null,
    !url ? wikiLink(wikiUrl("Items"), "Item guide") : null,
    item.contents.map((contents, i) => {
      const pocket = `${key}/pocket${i}`;
      return h(
        "details",
        { "data-remember": pocket, open: expanded ? expanded.has(pocket) : true },
        h("summary", {}, item.contents.length > 1 ? `Pocket ${i + 1}` : "Contents"),
        inventoryView(contents, pocket, expanded),
      );
    }),
  );
}

export function inventoryView(inventory: Inventory | undefined, key = "inventory", expanded?: Set<string>): HTMLElement {
  if (!inventory || inventory.state !== "saved") {
    return h("p", { class: "muted" }, inventory?.reason ?? "Inventory is unavailable in this save.");
  }
  const list = inventory.items.length
    ? h("ul", { class: "inventory-items" }, inventory.items.map((item, i) => itemRow(item, `${key}/${i}:${item.index}`, expanded)))
    : h("p", { class: "muted" }, "Empty when saved.");
  return inventory.note ? h("div", {}, h("p", { class: "muted" }, inventory.note), list) : list;
}

export function entityLink(m: Mark) {
  return wikiLink(
    entityWiki(
      m.name,
      m.layer === "npcs" || m.layer === "creatures" ? "Bestiary" : m.layer === "loot" ? "Loot tables" : "World generation",
    ),
  );
}

export interface InspectOptions {
  /** Open sections to restore. */
  expanded?: Set<string>;
  /** Chopping tool for tree costs, and the select that changes it. */
  tool?: number;
  picker?: HTMLElement;
  /** Closes the inspection; its button shows when the card floats over a full-screen map. */
  close?: () => void;
}

export function inspectMark(panel: HTMLElement, m: Mark, { expanded, tool, picker, close }: InspectOptions = {}) {
  panel.hidden = false;
  panel.replaceChildren(
    ...(close ? [h("button", { type: "button", class: "close", "aria-label": "Close", title: "Close (Esc)", onclick: close }, "×")] : []),
    h("h3", {}, m.name),
    h(
      "p",
      { class: "muted" },
      `${m.away ? `${m.away.zone}, saved` : "Saved"} tile ${(m.x - (m.away?.ox ?? 0)) >> 4},${(m.y - (m.away?.oy ?? 0)) >> 4}${
        m.detail ? ` - ${m.detail}` : ""
      }`,
    ),
    entityLink(m),
    ...(m.tree
      ? (m.layer === "brambles" || m.layer === "vines"
        ? brambleView(m.tree, tool ?? UNARMED)
        : treeView(m.tree, tool ?? UNARMED, `inspection:${markKey(m)}`, expanded, picker))
      : []),
    ...(m.inventory
      ? [
        inventoryView(m.inventory, `inspection:${markKey(m)}`, expanded),
        h("p", { class: "muted" }, "Saved contents only. Unsaved changes and later decay are not visible."),
      ]
      : []),
  );
}

const toolName = (tool: number) => ITEM_NAMES[tool] ?? `Item ${tool}`;

const treeGuide = () => h("p", {}, wikiLink(wikiUrl("Tree health and chopping"), "How tree health and chopping work"));

/** How a thorny plant hinders walking (scr_tiles_movement), and what cutting its stem costs. */
function brambleView(plant: Tree, tool: number): HTMLElement[] {
  const vine = plant.index === Nature.RiftVine;
  const stem = trunkOf(plant);
  return [
    h(
      "p",
      {},
      "Its stems turn the ground under them into ",
      h("strong", {}, vine ? "rift vine" : "bramble"),
      ` tiles (shaded on the map). Each step onto one costs more AP: the game divides a step's cost by the tile's footing, and ${
        vine ? "rift vines take 0.6" : "brambles take 0.4"
      } off it (sharp ground takes 1.0). Every step there also scratches you, costing a little wellbeing and wearing your gear. Each Wanderer skill level softens the slowdown by 8%.`,
    ),
    stem
      ? h(
        "p",
        {},
        "Cutting its main stem: ",
        h("strong", {}, `${formatAp(harvestCost(plant.index, stem.part, CHOP_TOOLS[tool]))} AP`),
        ` with ${toolName(tool)} (${FRESHNESS[stem.freshness].toLowerCase()}, ${Math.round(stem.life * 100)}% alive).`,
      )
      : null,
  ].filter((e): e is HTMLElement => !!e);
}

/** Trunk liveliness, the game's harvest cost for the trunk with the chosen tool, and what it drops. */
function treeView(tree: Tree, tool: number, key: string, expanded?: Set<string>, picker?: HTMLElement): HTMLElement[] {
  const trunk = trunkOf(tree);
  if (!trunk) return [h("p", { class: "muted" }, "No standing trunk was saved for this plant.")];
  const label = partLabel(tree.index, trunk.part);
  const cost = (t: number) => formatAp(harvestCost(tree.index, trunk.part, CHOP_TOOLS[t]));
  const tooDear = (t: number) => harvestCost(tree.index, trunk.part, CHOP_TOOLS[t]) > MAX_AP;
  const wood = trunkWood(tree.index, trunk.size);
  const wet = Math.max(0, trunk.life - 0.5);
  const tools = Object.keys(CHOP_TOOLS).map(Number).sort((a, b) => CHOP_TOOLS[b] - CHOP_TOOLS[a] || a - b);
  const branches = (tree.parts?.length ?? 1) - 1;
  return [
    h(
      "p",
      { class: `trunk-life tree f${trunk.freshness}` },
      h("span", { class: "freshness-tag" }, FRESHNESS[trunk.freshness]),
      ` trunk, ${Math.round(trunk.life * 100)}% alive`,
      h("span", { class: "life-bar", "aria-hidden": "true" }, h("span", { style: `width: ${Math.round(trunk.life * 100)}%` })),
      trunk.life < NATDEAD ? h("span", { class: "muted" }, " (leafless, no longer growing)") : null,
    ),
    picker ? h("p", {}, picker) : null,
    h(
      "p",
      {},
      `Harvest cost (${label}): `,
      h("strong", {}, `${cost(tool)} AP`),
      ` with ${toolName(tool)} (tool bonus ×${CHOP_TOOLS[tool]}).`,
      tool !== UNARMED ? h("span", { class: "muted" }, ` Bare hands: ${cost(UNARMED)} AP.`) : null,
    ),
    h(
      "p",
      { class: "muted" },
      tooDear(tool)
        ? `The game refuses this chop: it costs more than the ${MAX_AP} AP maximum. Use a stronger tool or wait for the trunk to dry.`
        : "Outside combat you can chop with fewer AP left; the shortfall comes off your next turn.",
    ),
    wood
      ? h(
        "p",
        {},
        `Felled, it drops ${wood.count} × ${ITEM_NAMES[wood.item] ?? `Item ${wood.item}`} (${
          wet > 0 ? `${Math.round(wet * 100)}% wet` : "dry"
        })`,
        branches ? `, and its ${branches} branch${branches === 1 ? "" : "es"} fall with it` : "",
        ".",
      )
      : null,
    h(
      "details",
      { "data-remember": `${key}/tools`, open: expanded?.has(`${key}/tools`) ?? false },
      h("summary", {}, "Cost with every tool"),
      h(
        "ul",
        { class: "tool-costs" },
        tools.map((t) =>
          h(
            "li",
            { class: t === tool ? "current" : "" },
            `${toolName(t)} (×${CHOP_TOOLS[t]}): ${cost(t)} AP${tooDear(t) ? ` (over ${MAX_AP} AP, refused)` : ""}`,
          )
        ),
      ),
    ),
    treeGuide(),
  ].filter((e): e is HTMLElement => !!e);
}

import { h } from "./dom.ts";
import { ITEM_NAMES } from "./gamedata.ts";
import type { Inventory, SavedItem } from "./inventory.ts";
import { type Mark, markKey } from "./objects.ts";
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

export function inspectMark(panel: HTMLElement, m: Mark, expanded?: Set<string>) {
  panel.hidden = false;
  panel.replaceChildren(
    h("h3", {}, m.name),
    h("p", { class: "muted" }, `Saved tile ${m.x >> 4},${m.y >> 4}${m.detail ? ` - ${m.detail}` : ""}`),
    entityLink(m),
    ...(m.inventory
      ? [
        inventoryView(m.inventory, `inspection:${markKey(m)}`, expanded),
        h("p", { class: "muted" }, "Saved contents only. Unsaved changes and later decay are not visible."),
      ]
      : []),
  );
}

import { h, s } from "./dom.ts";
import art from "./artdata.json" with { type: "json" };
import { ITEM_NAMES } from "./gamedata.ts";
import type { Inventory, SavedItem } from "./inventory.ts";
import { type Mark, markKey } from "./objects.ts";
import type { Gather, GatherKind } from "./gather.ts";
import type { Tree } from "./save.ts";
import { CHOP_TOOLS, formatAp, FRESHNESS, harvestCost, MAX_AP, NATDEAD, Nature, partLabel, trunkOf, trunkWood, UNARMED } from "./chop.ts";
import { beingImage, entityWiki, itemImage, itemWiki, placeImage, type WikiImage, wikiUrl, wikiVerified } from "./wiki.ts";
import { creatureView } from "./creature.ts";
import { merchantView, sells } from "./merchants.ts";
import { playerView } from "./player.ts";
import type { FindTarget } from "./journal.ts";

const wikiAnchor = (url: string, cls: string, label: string) =>
  h("a", {
    class: cls,
    href: url,
    target: "_blank",
    rel: "noopener noreferrer",
    title: `Wiki page verified ${wikiVerified}; opens in a new tab`,
  }, label);

export function wikiLink(url: string | undefined, label = "Wiki") {
  return url ? wikiAnchor(url, "link wiki", label) : h("span", { class: "muted" }, "No verified wiki page");
}

/** A heading's text as the link to its wiki page (dotted like other links), or plain text without one. */
export const wikiTitle = (url: string | undefined, text: string) => url ? wikiAnchor(url, "link", text) : text;

interface GameImage {
  file: string;
  w: number;
  h: number;
  frames: number;
  frame: number;
}

const raftImage: GameImage = { ...art.sprites.spr_placed_16x16_wider, frame: 1 };

/**
 * A bundled picture fitted to a w×h box, never enlarged past whole pixels so the pixel art stays crisp; `fill` keeps the
 * whole box (the picture centred in it) so a column of them lines up.
 */
export function picture(img: WikiImage | GameImage, alt: string, cls: string, w: number, h_: number, fill = false) {
  const fit = Math.min(w / img.w, h_ / img.h);
  const k = fit >= 1 ? Math.floor(fit) : fit;
  const size = { width: fill ? w : Math.round(img.w * k), height: fill ? h_ : Math.round(img.h * k) };
  if ("frame" in img) {
    return s(
      "svg",
      { class: cls, ...size, viewBox: `${img.frame * img.w} 0 ${img.w} ${img.h}`, overflow: "hidden", role: "img", "aria-label": alt },
      s("title", {}, `${alt} (picture from the game; art by Edym Pixels)`),
      s("image", { href: img.file, width: img.w * img.frames, height: img.h }),
    );
  }
  return h("img", {
    class: cls,
    src: img.file,
    ...size,
    alt,
    decoding: "async",
    title: alt ? `${alt} (picture from the wiki)` : undefined,
  });
}

/** Finished rafts are world tiles, not inventory items; all other pictures come from the wiki. */
export const markImage = (m: Mark) =>
  m.layer === "rafts" && m.item === 171
    ? raftImage
    : m.being !== undefined
    ? beingImage(m.being)
    : m.item !== undefined
    ? itemImage(m.item)
    : placeImage(m.name);

function itemRow(item: SavedItem, key: string, expanded?: Set<string>, badge?: Node | null): HTMLElement {
  const name = ITEM_NAMES[item.index] ?? `Item ${item.index}`;
  const url = itemWiki(name);
  const icon = itemImage(item.index);
  const condition = [
    item.durability !== undefined ? `durability ${Math.round(item.durability * 100) / 100}` : "",
    item.wet !== undefined && item.wet > 0 ? `wet ${Math.round(item.wet * 100)}%` : "",
  ].filter(Boolean).join(", ");
  return h(
    "li",
    {},
    badge,
    icon ? picture(icon, "", "item-icon", 24, 20, true) : null,
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

/** A saved item list; `badge` marks its top-level items (such as the player's equipped ones), not what they contain. */
export function inventoryView(
  inventory: Inventory | undefined,
  key = "inventory",
  expanded?: Set<string>,
  badge?: (item: SavedItem) => Node | null,
): HTMLElement {
  if (!inventory || inventory.state !== "saved") {
    return h("p", { class: "muted" }, inventory?.reason ?? "Inventory is unavailable in this save.");
  }
  const list = inventory.items.length
    ? h(
      "ul",
      { class: "inventory-items" },
      inventory.items.map((item, i) => itemRow(item, `${key}/${i}:${item.index}`, expanded, badge?.(item))),
    )
    : h("p", { class: "muted" }, "Empty when saved.");
  return inventory.note ? h("div", {}, h("p", { class: "muted" }, inventory.note), list) : list;
}

/** The wiki page for a mark: its own, else a guide to its kind. The player has none. */
export const entityUrl = (m: Mark) =>
  m.layer === "you" ? undefined : entityWiki(
    m.name,
    m.layer === "npcs" || m.layer === "creatures"
      ? "Bestiary"
      : m.layer === "loot" || m.layer === "drops"
      ? "Loot tables"
      : m.gather
      ? "Plant harvesting"
      : "World generation",
  );

export const entityLink = (m: Mark) => wikiLink(entityUrl(m));

/** Where an inspection section keeps its state: `key` prefixes its `data-remember` names, `expanded` lists the open ones. */
export interface SectionContext {
  key: string;
  expanded?: Set<string>;
  /** The save's difficulty (PlayerSave.difficulty), when known. */
  difficulty?: number;
  /** Shows a person or place the journal mentions on the map; without it they are plain text. */
  find?: FindTarget;
}

/** A collapsible section that stays open across re-renders (see `openSections` in view.ts). */
export function section(ctx: SectionContext, id: string, title: string, open: boolean, ...body: (HTMLElement | null)[]) {
  const key = `${ctx.key}/${id}`;
  return h("details", { "data-remember": key, open: ctx.expanded ? ctx.expanded.has(key) : open }, h("summary", {}, title), body);
}

export interface InspectOptions {
  /** Open sections to restore. */
  expanded?: Set<string>;
  /** Chopping tool for tree costs, and the select that changes it. */
  tool?: number;
  picker?: HTMLElement;
  /** Closes the inspection; its button, and a bottom sheet's grabber, show when the card floats over a full-screen map. */
  close?: () => void;
  /** The save's difficulty, for how well beings aim. */
  difficulty?: number;
  /** Shows a person or place the player's journal mentions on the map. */
  find?: FindTarget;
}

export function inspectMark(panel: HTMLElement, m: Mark, { expanded, tool, picker, close, difficulty, find }: InspectOptions = {}) {
  panel.hidden = false;
  const img = markImage(m);
  const ctx: SectionContext = { key: `inspection:${markKey(m)}`, expanded, difficulty, find };
  // Carcasses carry their creature's index too, but they are loot, not a living being.
  const being = m.being !== undefined && !m.inventory ? m.being : undefined;
  panel.replaceChildren(
    ...(close
      ? [
        // MapView drags and toggles it (see `wireSheet`) and keeps its label.
        h("button", { type: "button", class: "grabber", "aria-label": "Show more", "aria-expanded": "false" }),
        h("button", { type: "button", class: "close", "aria-label": "Close", title: "Close (Esc)", onclick: close }, "×"),
      ]
      : []),
    h(
      "div",
      { class: "inspect-head" },
      img ? picture(img, m.name, "portrait", 112, 88) : null,
      h(
        "div",
        {},
        h("h3", {}, wikiTitle(entityUrl(m), m.name)),
        h(
          "p",
          { class: "muted" },
          `${m.away ? `${m.away.zone}, saved` : "Saved"} tile ${(m.x - (m.away?.ox ?? 0)) >> 4},${(m.y - (m.away?.oy ?? 0)) >> 4}${
            m.detail ? ` - ${m.detail}` : ""
          }`,
        ),
      ),
    ),
    ...(m.player ? playerView(m.player, ctx) : []),
    ...(being === undefined
      ? []
      : sells(being)
      ? [...merchantView(being, ctx), section(ctx, "combat", "Hit points and attacks", false, ...creatureView(being, m.health, ctx))]
      : creatureView(being, m.health, ctx)),
    ...(m.tree
      ? (m.layer === "brambles" || m.layer === "vines"
        ? brambleView(m.tree, tool ?? UNARMED)
        : treeView(m.tree, tool ?? UNARMED, `inspection:${markKey(m)}`, expanded, picker))
      : []),
    ...(m.gather ? gatherView(m.gather) : []),
    ...(m.inventory
      ? [
        inventoryView(m.inventory, `inspection:${markKey(m)}`, expanded),
        h("p", { class: "muted" }, "Saved contents only. Unsaved changes and later decay are not visible."),
      ]
      : []),
  );
}

const toolName = (tool: number) => ITEM_NAMES[tool] ?? `Item ${tool}`;

/** How a plant grows into its yield, or how a nest refills (loot_generate in scr_items, nature_grow in scr_nature). */
function gatherView(g: Gather): HTMLElement[] {
  if (g.kind === "nest") {
    return [
      h(
        "p",
        {},
        "Search it for 1–7 Feathers, with a 40% chance of 1–3 Eggs and, rarely, a tiny treasure. A searched nest stays empty for 4–12 days, then refills.",
      ),
      h("p", {}, wikiLink(wikiUrl("Bird nests"), "Bird nests on the wiki")),
    ];
  }
  const growth: Partial<Record<GatherKind, string>> = {
    turnip: "From stage 4 a turnip gives two instead of one.",
    cranberry: "Berries come at stage 3: 2–5, then 3–8, and 4–11 when full grown.",
    cress: "The bigger the patch, the more: 1–2 at stage 1, up to 5–12 at stage 5.",
    lily: "A lilypad flowers at stage 4 (one Water Lily) and 5 (two); younger pads give none.",
  };
  const regrow: Partial<Record<GatherKind, string>> = {
    calmia: "Each time you come back, two new Calmia sprout somewhere in the zone for every day (or part of one) you were away.",
    bulb: "Each time you come back, the cave grows one new Vile Bulb for every day (or part of one) you were away.",
  };
  return [
    g.stage !== undefined ? h("p", {}, `Growth stage ${g.stage + 1} of 5. `, growth[g.kind] ?? "") : null,
    regrow[g.kind] ? h("p", {}, regrow[g.kind]!) : null,
    h(
      "p",
      { class: "muted" },
      "Base amounts, lower counts likelier; Green Fingers can add one more. Plants grow, spread and die back as turns pass and when you return, so this is the plant as saved.",
    ),
    h("p", {}, wikiLink(wikiUrl("Plant harvesting"), "How plant harvesting works")),
  ].filter((e): e is HTMLElement => !!e);
}

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

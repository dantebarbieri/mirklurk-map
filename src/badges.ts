// Small badges shown next to a world's name.

import { h } from "./dom.ts";

/** A world downloaded from someone's share link (MirkMap.ini has from_share=1): an S badge and "(From Share)". */
export const fromShareTag = () => [
  " ",
  h("abbr", { class: "badge badge-share", title: "From Share: downloaded from a share link" }, "S"),
  h("span", { class: "muted" }, " (From Share)"),
];

/** A world changed with the save editor (src/cheated.ts): a C badge and "(Cheated)". The mark is permanent. */
export const cheatedTag = () => [
  " ",
  h("abbr", { class: "badge badge-cheated", title: "Cheated: changed with the save editor" }, "C"),
  h("span", { class: "muted" }, " (Cheated)"),
];

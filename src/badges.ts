// Small badges shown next to a world's name.

import { h } from "./dom.ts";

/** A world downloaded from someone's share link (MirkMap.ini has from_share=1): an S badge and "(From Share)". */
export const fromShareTag = () => [
  " ",
  h("abbr", { class: "badge badge-share", title: "From Share: downloaded from a share link" }, "S"),
  h("span", { class: "muted" }, " (From Share)"),
];

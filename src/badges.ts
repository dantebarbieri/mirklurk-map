// Small badges shown next to a world's name.

import { h } from "./dom.ts";

/** A world changed with the save editor (src/cheated.ts): a C badge and "(Cheated)". The mark is permanent. */
export const cheatedTag = () => [
  " ",
  h("abbr", { class: "badge badge-cheated", title: "Cheated: changed with the save editor" }, "C"),
  h("span", { class: "muted" }, " (Cheated)"),
];

// A modal question in MirkMap's style, instead of the browser's unstyled confirm(), which also stops the page and cannot be styled.

import { h } from "./dom.ts";

type Content = Parameters<typeof h>[2];
let dialogs = 0;

/**
 * Asks before an action: a native modal <dialog> (an alertdialog to assistive technology, described by its body), so the page behind
 * is inert and focus moves into it: to `confirm`, or for a `danger`ous action (one that deletes or drops something) to `cancel`, so
 * Enter alone never does it. Escape, Cancel or a click outside declines. Focus returns to where it was. A string in `body` is a
 * paragraph. Resolves true only when `confirm` is chosen.
 */
export function ask({ title, body, confirm, cancel = "Cancel", danger = false }: {
  title: string;
  body: (string | Content)[];
  confirm: string;
  cancel?: string;
  danger?: boolean;
}): Promise<boolean> {
  const previous = document.activeElement as HTMLElement | null;
  const id = `dialog-${++dialogs}`;
  const close = (value: string) => dialog.close(value);
  const button = (value: "confirm" | "cancel", label: string, cls: string) =>
    h("button", {
      type: "button",
      class: cls,
      value,
      autofocus: (value === "cancel") === danger,
      onclick: () => close(value),
    }, label);
  const dialog = h(
    "dialog",
    {
      class: `dialog${danger ? " danger" : ""}`,
      role: "alertdialog",
      "aria-labelledby": `${id}-title`,
      "aria-describedby": `${id}-body`,
      // The dialog itself is only hit outside its content, on the backdrop.
      onclick: (event: Event) => event.target === dialog && close("cancel"),
    },
    h(
      "div",
      { class: "dialog-content" },
      h("h2", { id: `${id}-title` }, title),
      h("div", { id: `${id}-body` }, body.map((part) => typeof part === "string" ? h("p", {}, part) : part)),
      h(
        "div",
        { class: "share-actions dialog-actions" },
        button("cancel", cancel, "button subtle"),
        button("confirm", confirm, danger ? "button danger" : "button"),
      ),
    ),
  ) as HTMLDialogElement;
  document.body.append(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      dialog.remove();
      previous?.focus?.();
      resolve(dialog.returnValue === "confirm");
    }, { once: true });
    dialog.showModal();
  });
}

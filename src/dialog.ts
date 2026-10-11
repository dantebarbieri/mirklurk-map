// A modal question in MirkMap's style, instead of the browser's unstyled confirm().

import { h } from "./dom.ts";

type Content = Parameters<typeof h>[2];
let dialogs = 0;

/**
 * Asks before an action: a native modal <dialog>, so focus moves into it (to `confirm`) and the page behind is inert. Escape, Cancel or a
 * click outside declines. Focus returns to where it was. Resolves true only when `confirm` is chosen.
 */
export function ask({ title, body, confirm, cancel = "Cancel" }: {
  title: string;
  body: Content[];
  confirm: string;
  cancel?: string;
}): Promise<boolean> {
  const previous = document.activeElement as HTMLElement | null;
  const id = `dialog-title-${++dialogs}`;
  const close = (value: string) => dialog.close(value);
  const dialog = h(
    "dialog",
    {
      class: "dialog",
      "aria-labelledby": id,
      // The dialog itself is only hit outside its content, on the backdrop.
      onclick: (event: Event) => event.target === dialog && close("cancel"),
    },
    h(
      "div",
      { class: "dialog-content" },
      h("h2", { id }, title),
      body,
      h(
        "div",
        { class: "share-actions dialog-actions" },
        h("button", { type: "button", class: "button subtle", onclick: () => close("cancel") }, cancel),
        h("button", { type: "button", class: "button", autofocus: true, onclick: () => close("confirm") }, confirm),
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

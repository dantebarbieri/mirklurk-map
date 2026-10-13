// A modal question in MirkMap's style, instead of the browser's unstyled confirm(), which also stops the page and cannot be styled.

import { h } from "./dom.ts";

type Content = Parameters<typeof h>[2];
let dialogs = 0;

/**
 * Shows `dialog` as a modal until it closes, then removes it and returns focus to where it was. A click on the dialog element
 * itself, which only its backdrop receives (its content covers the rest), cancels it. Resolves to its return value.
 */
function showModal(dialog: HTMLDialogElement): Promise<string> {
  const previous = document.activeElement as HTMLElement | null;
  dialog.addEventListener("click", (event) => event.target === dialog && dialog.close("cancel"));
  document.body.append(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      dialog.remove();
      previous?.focus?.();
      resolve(dialog.returnValue);
    }, { once: true });
    dialog.showModal();
  });
}

/**
 * Asks before an action: a native modal <dialog> (an alertdialog to assistive technology, described by its body), so the page behind
 * is inert and focus moves into it: to `confirm`, or for a `danger`ous action (one that deletes or drops something) to `cancel`, so
 * Enter alone never does it. Escape, Cancel or a click outside declines. Focus returns to where it was. A string in `body` is a
 * paragraph. Resolves true only when `confirm` is chosen.
 */
export async function ask({ title, body, confirm, cancel = "Cancel", danger = false }: {
  title: string;
  body: (string | Content)[];
  confirm: string;
  cancel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return await choose({ title, body, cancel, danger, choices: [{ value: "confirm", label: confirm, danger }] }) === "confirm";
}

export interface Choice<T extends string> {
  value: T;
  label: string;
  /** A line under the label saying what it does. */
  detail?: string;
  danger?: boolean;
}

/**
 * Asks which of several ways to go, like `ask`: the choices are buttons, the first one that is not `danger`ous takes focus (or
 * Cancel when all are), and Escape, Cancel or a click outside declines. Resolves to the chosen value, or undefined. No choice may
 * have the value "cancel", which is Cancel's.
 */
export async function choose<T extends string>({ title, body, choices, cancel = "Cancel", danger = false }: {
  title: string;
  body: (string | Content)[];
  choices: Choice<T>[];
  cancel?: string;
  /** Styles the whole dialog as a warning. */
  danger?: boolean;
}): Promise<T | undefined> {
  const id = `dialog-${++dialogs}`;
  const close = (value: string) => dialog.close(value);
  const focus = choices.find((c) => !c.danger);
  const button = (value: string, label: string, cls: string, detail?: string) =>
    h("button", {
      type: "button",
      class: cls,
      value,
      autofocus: value === (focus?.value ?? "cancel"),
      onclick: () => close(value),
    }, detail ? [h("span", { class: "choice-label" }, label), h("span", { class: "choice-detail" }, detail)] : label);
  const stacked = choices.some((c) => c.detail);
  const dialog = h(
    "dialog",
    {
      class: `dialog${danger ? " danger" : ""}`,
      role: "alertdialog",
      "aria-labelledby": `${id}-title`,
      "aria-describedby": `${id}-body`,
    },
    h(
      "div",
      { class: "dialog-content" },
      h("h2", { id: `${id}-title` }, title),
      h("div", { id: `${id}-body` }, body.map((part) => typeof part === "string" ? h("p", {}, part) : part)),
      stacked
        ? h(
          "div",
          { class: "dialog-choices" },
          choices.map((c) => button(c.value, c.label, `button choice${c.danger ? " danger" : ""}`, c.detail)),
        )
        : null,
      h(
        "div",
        { class: "share-actions dialog-actions" },
        button("cancel", cancel, "button subtle"),
        stacked ? null : choices.map((c) => button(c.value, c.label, c.danger ? "button danger" : "button")),
      ),
    ),
  ) as HTMLDialogElement;
  const value = await showModal(dialog);
  return choices.find((c) => c.value === value)?.value;
}

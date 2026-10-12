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
export function choose<T extends string>({ title, body, choices, cancel = "Cancel", danger = false }: {
  title: string;
  body: (string | Content)[];
  choices: Choice<T>[];
  cancel?: string;
  /** Styles the whole dialog as a warning. */
  danger?: boolean;
}): Promise<T | undefined> {
  const previous = document.activeElement as HTMLElement | null;
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
      // The dialog itself is only hit outside its content, on the backdrop.
      onclick: (event: Event) => event.target === dialog && close("cancel"),
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
  document.body.append(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      dialog.remove();
      previous?.focus?.();
      resolve(choices.find((c) => c.value === dialog.returnValue)?.value);
    }, { once: true });
    dialog.showModal();
  });
}

/**
 * A small form in the same style: `body` holds its fields in a <form method="dialog">, so Enter in a field submits it, and focus starts
 * on the first field. On submit, `check` may name a problem, shown in the dialog (which stays open) so it can be put right. Escape,
 * Cancel or a click outside declines; focus returns to where it was. Resolves true only once submitted without a problem.
 */
export function form({ title, body, confirm, cancel = "Cancel", check }: {
  title: string;
  body: (string | Content)[];
  confirm: string;
  cancel?: string;
  check?: () => string | undefined;
}): Promise<boolean> {
  const previous = document.activeElement as HTMLElement | null;
  const id = `dialog-${++dialogs}`;
  const problem = h("p", { class: "dialog-problem", role: "alert" });
  const dialog = h(
    "dialog",
    {
      class: "dialog",
      "aria-labelledby": `${id}-title`,
      onclick: (event: Event) => event.target === dialog && dialog.close("cancel"),
    },
    h(
      "form",
      {
        class: "dialog-content",
        method: "dialog",
        novalidate: true,
        onsubmit: (event: Event) => {
          event.preventDefault();
          const error = check?.();
          problem.textContent = error ?? "";
          if (!error) dialog.close("confirm");
        },
      },
      h("h2", { id: `${id}-title` }, title),
      body.map((part) => typeof part === "string" ? h("p", {}, part) : part),
      problem,
      h(
        "div",
        { class: "share-actions dialog-actions" },
        h("button", { type: "button", class: "button subtle", onclick: () => dialog.close("cancel") }, cancel),
        h("button", { type: "submit", class: "button" }, confirm),
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
    dialog.querySelector<HTMLElement>("input, select, textarea")?.focus();
  });
}

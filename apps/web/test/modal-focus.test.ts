// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModalFrame } from "../src/play/ModalFrame";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
    this.querySelector("button")?.focus();
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

function Host() {
  const [open, setOpen] = useState(false);
  return createElement(
    "div",
    null,
    createElement("button", { type: "button", onClick: () => setOpen(true) }, "Open wallet dialog"),
    open &&
      createElement(
        ModalFrame,
        {
          title: "Your wallet.",
          eyebrow: "TEST",
          close: () => setOpen(false),
        } as Parameters<typeof ModalFrame>[0],
        createElement("p", null, "body"),
      ),
  );
}

describe("ModalFrame focus", () => {
  it("moves focus into the dialog and back to the opener when it closes", () => {
    render(createElement(Host));
    const opener = screen.getByRole("button", { name: "Open wallet dialog" });
    opener.focus();
    fireEvent.click(opener);
    const close = screen.getByRole("button", { name: "Close dialog" });
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("does not move focus to an opener that left the page", () => {
    const { container } = render(createElement(Host));
    const opener = screen.getByRole("button", { name: "Open wallet dialog" });
    opener.focus();
    fireEvent.click(opener);
    opener.remove();
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(container.contains(document.activeElement)).toBe(false);
  });
});

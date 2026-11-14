// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { liftPopupsToTopLayer } from "../src/wallet/near-connect";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function popup() {
  const el = document.createElement("div");
  el.className = "abc hot-connector-popup";
  return el;
}

describe("liftPopupsToTopLayer", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("moves an SDK popup into the open modal dialog so it is visible and not inert", async () => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    // jsdom has no top layer: model `:modal` for the selector the adapter uses.
    Object.defineProperty(dialog, "matches", { value: () => true });
    document.body.append(dialog);
    const stop = liftPopupsToTopLayer();
    const el = popup();
    document.body.append(el);
    await tick();
    expect(el.parentElement).toBe(dialog);
    stop();
  });

  it("leaves popups on the body when no modal dialog is open", async () => {
    const stop = liftPopupsToTopLayer();
    const el = popup();
    document.body.append(el);
    await tick();
    expect(el.parentElement).toBe(document.body);
    stop();
  });

  it("ignores unrelated nodes and stops observing after the stop function", async () => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    const stop = liftPopupsToTopLayer();
    stop();
    const late = popup();
    document.body.append(late);
    await tick();
    expect(late.parentElement).toBe(document.body);
  });
});

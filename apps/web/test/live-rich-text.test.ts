// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { RichText } from "../src/play/live/RichText";
import { parseInline, parseRichText } from "../src/play/live/richTextParser";

afterEach(cleanup);
const html = (text: string) => render(createElement(RichText, { text })).container;

describe("reply subset parser", () => {
  it("splits paragraphs on blank lines and keeps single newlines as line breaks", () => {
    const blocks = parseRichText("one\ntwo\n\nthree");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: "p" });
    const c = html("one\ntwo\n\nthree");
    expect(c.querySelectorAll("p")).toHaveLength(2);
    expect(c.querySelectorAll("p")[0]?.querySelectorAll("br")).toHaveLength(1);
  });

  it("renders bold with no visible asterisks", () => {
    const c = html("**Debt:** none");
    expect(c.querySelector("strong")?.textContent).toBe("Debt:");
    expect(c.textContent).toBe("Debt: none");
  });

  it("keeps an unclosed bold marker literal", () => {
    expect(parseInline("a **b")).toEqual([{ kind: "text", text: "a **b" }]);
    expect(html("a **b").querySelector("strong")).toBeNull();
    expect(html("a **b").textContent).toBe("a **b");
  });

  it("handles adjacent, empty and whitespace-padded markers without guessing", () => {
    expect(parseInline("**a****b**")).toEqual([
      { kind: "bold", text: "a" },
      { kind: "bold", text: "b" },
    ]);
    expect(html("****").textContent).toBe("****");
    expect(html("** padded **").querySelector("strong")).toBeNull();
    expect(html("** padded **").textContent).toBe("** padded **");
  });

  it("does not nest bold: a marker inside bold stays literal around a flat span", () => {
    const parts = parseInline("**a **b** c**");
    expect(parts.filter((p) => p.kind === "bold").map((p) => p.text)).toEqual(["b"]);
    expect(parts.map((p) => p.text).join("")).toBe("**a b c**");
  });

  it("renders unordered lists with both markers and an ordered list with its start", () => {
    const c = html("- one\n* two\n- three");
    expect(c.querySelectorAll("ul > li")).toHaveLength(3);
    expect(c.textContent).toBe("onetwothree");
    const o = html("1. first\n2. second");
    expect(o.querySelectorAll("ol > li")).toHaveLength(2);
    expect(o.querySelector("ol")?.getAttribute("start")).toBe("1");
  });

  it("ends a list when a plain line follows, without a blank line", () => {
    const blocks = parseRichText("- one\n- two\nAfter the list");
    expect(blocks.map((b) => b.kind)).toEqual(["ul", "p"]);
    const c = html("Intro\n- one\n- two\n\nOutro");
    expect(Array.from(c.children[0]?.children ?? []).map((e) => e.tagName)).toEqual([
      "P",
      "UL",
      "P",
    ]);
  });

  it("treats a bold line start as text, not a list item", () => {
    const blocks = parseRichText("**Note** here");
    expect(blocks).toEqual([
      {
        kind: "p",
        lines: [
          [
            { kind: "bold", text: "Note" },
            { kind: "text", text: " here" },
          ],
        ],
      },
    ]);
  });

  it("shows HTML-looking text as literal text and creates no element", () => {
    const attack = "<img src=x onerror=alert(1)> <script>alert(1)</script>";
    const c = html(attack);
    expect(c.querySelector("img")).toBeNull();
    expect(c.querySelector("script")).toBeNull();
    expect(c.textContent).toBe(attack);
    expect(c.innerHTML).toContain("&lt;img");
  });

  it("leaves headings, links and code fences as literal text", () => {
    const c = html("# Title\n[x](http://a.b)\n`code`");
    expect(c.querySelector("a, h1, code")).toBeNull();
    expect(c.textContent).toBe("# Title[x](http://a.b)`code`");
  });

  it("marks the root so very long words wrap inside the bubble", () => {
    const word = "x".repeat(400);
    const c = html(word);
    expect(c.textContent).toBe(word);
    expect(c.firstElementChild?.className).toContain("[overflow-wrap:anywhere]");
  });
});

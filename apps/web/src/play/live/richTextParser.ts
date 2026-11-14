/**
 * Parser for the reply subset in design.md contract 2: paragraphs split by a blank line, single
 * newlines as line breaks, `**bold**`, `- ` / `* ` lists and `1. ` lists. Anything else is kept
 * as literal text, so the renderer never needs to trust the model's output.
 */
export type Inline = { kind: "text" | "bold"; text: string };
export type Block =
  | { kind: "p"; lines: Inline[][] }
  | { kind: "ul"; items: Inline[][] }
  | { kind: "ol"; start: number; items: Inline[][] };

const UNORDERED = /^[-*] (.*)$/;
const ORDERED = /^(\d{1,9})\. (.*)$/;
const MARK = "**";

/** `**` opens bold only when a closing `**` follows and neither inner edge is whitespace. */
export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  let literal = "";
  const flush = () => {
    if (literal) out.push({ kind: "text", text: literal });
    literal = "";
  };
  let i = 0;
  while (i < line.length) {
    if (line.startsWith(MARK, i)) {
      const close = line.indexOf(MARK, i + MARK.length);
      const inner = close === -1 ? "" : line.slice(i + MARK.length, close);
      if (inner && !/^\s|\s$/.test(inner)) {
        flush();
        out.push({ kind: "bold", text: inner });
        i = close + MARK.length;
        continue;
      }
      literal += MARK;
      i += MARK.length;
      continue;
    }
    literal += line[i];
    i += 1;
  }
  flush();
  return out;
}

export function parseRichText(text: string): Block[] {
  const blocks: Block[] = [];
  let list = null as Extract<Block, { kind: "ul" | "ol" }> | null;
  let paragraph = null as Extract<Block, { kind: "p" }> | null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      list = null;
      paragraph = null;
      continue;
    }
    const unordered = UNORDERED.exec(line);
    const ordered = unordered ? null : ORDERED.exec(line);
    if (unordered || ordered) {
      paragraph = null;
      const kind = unordered ? "ul" : "ol";
      if (list?.kind !== kind) {
        list =
          kind === "ul" ? { kind, items: [] } : { kind, start: Number(ordered?.[1]), items: [] };
        blocks.push(list);
      }
      list.items.push(parseInline((unordered ?? ordered)?.[unordered ? 1 : 2] ?? ""));
    } else {
      list = null;
      if (!paragraph) {
        paragraph = { kind: "p", lines: [] };
        blocks.push(paragraph);
      }
      paragraph.lines.push(parseInline(line));
    }
  }
  return blocks;
}

import { Fragment, type ReactNode } from "react";
import { type Inline, parseRichText } from "./richTextParser";

function inline(parts: Inline[]): ReactNode[] {
  return parts.map((part, index) =>
    part.kind === "bold" ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts are static for a given text
      <strong key={index} className="font-semibold text-[#edf3f5]">
        {part.text}
      </strong>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts are static for a given text
      <Fragment key={index}>{part.text}</Fragment>
    ),
  );
}

/** Builds React elements from the reply subset; never injects HTML. Unknown markup is text. */
export function RichText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`space-y-2 [overflow-wrap:anywhere] ${className}`}>
      {parseRichText(text).map((block, index) => {
        if (block.kind === "p")
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: blocks are static for a given text
            <p key={index}>
              {block.lines.map((line, lineIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: lines are static for a given text
                <Fragment key={lineIndex}>
                  {lineIndex > 0 && <br />}
                  {inline(line)}
                </Fragment>
              ))}
            </p>
          );
        const items = block.items.map((item, itemIndex) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: items are static for a given text
          <li key={itemIndex}>{inline(item)}</li>
        ));
        return block.kind === "ul" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks are static for a given text
          <ul key={index} className="list-disc space-y-1 pl-5">
            {items}
          </ul>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks are static for a given text
          <ol key={index} start={block.start} className="list-decimal space-y-1 pl-5">
            {items}
          </ol>
        );
      })}
    </div>
  );
}

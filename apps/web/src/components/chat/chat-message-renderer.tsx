"use client";
import { useEffect, useMemo, useState, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { proseClasses } from "@/lib/markdown/shared-prose";
import { sanitizeHtml } from "@/lib/markdown/sanitize-html";
import {
  InlineCitationMarker,
  type Citation,
} from "@/components/agent-panel/citation-chips";
import { CodeBlock } from "./renderers/code-block";
import { CalloutBlockquote } from "./renderers/callout-blockquote";
import { StreamingCursor } from "./streaming-text";

const chatProseClasses = [
  proseClasses.body,
  "leading-7",
  "[&_p:first-child]:mt-0",
  "[&_p:last-child]:mb-0",
  "[&_p]:my-2",
  "[&_ul]:my-2",
  "[&_ol]:my-2",
  "[&_li]:my-0.5",
].join(" ");

const compactChatProseClasses = [
  proseClasses.body,
  "text-[13px] leading-6",
  "[&_p:first-child]:mt-0",
  "[&_p:last-child]:mb-0",
  "[&_p]:my-1.5",
  "[&_p]:leading-6",
  "[&_ul]:my-1.5",
  "[&_ol]:my-1.5",
  "[&_li]:my-0.5",
  "[&_li]:leading-6",
  "[&_h1]:text-base",
  "[&_h2]:text-[15px]",
  "[&_h3]:text-sm",
  "[&_table]:text-xs",
].join(" ");

interface ChatMessageRendererProps {
  body: string;
  citations?: Citation[];
  /** True while the message is mid-stream — appends a blinking cursor. */
  streaming?: boolean;
  compact?: boolean;
}

type MarkdownPlugin = NonNullable<
  ComponentProps<typeof ReactMarkdown>["remarkPlugins"]
>[number];
type RehypePlugin = NonNullable<
  ComponentProps<typeof ReactMarkdown>["rehypePlugins"]
>[number];

type MathPlugins = {
  remarkMath: MarkdownPlugin;
  rehypeKatex: RehypePlugin;
};

function hasMathSyntax(body: string): boolean {
  return /(^|[^\\])\$\$?/.test(body) || /\\\(|\\\[/.test(body);
}

function linkifyCitationMarkers(body: string, citations: Citation[]): string {
  if (citations.length === 0) return body;
  const citationIndexes = new Set(citations.map((citation) => citation.index));
  return body.replace(/\[\^(\d+)\]/g, (match, index: string) => {
    const citationIndex = Number(index);
    if (!citationIndexes.has(citationIndex)) return match;
    return `[[${citationIndex}]](#opencairn-citation-${citationIndex})`;
  });
}

function citationIndexFromHref(href: unknown): number | null {
  if (typeof href !== "string") return null;
  const match = href.match(/^#opencairn-citation-(\d+)$/);
  return match ? Number(match[1]) : null;
}

export function ChatMessageRenderer({
  body,
  citations = [],
  streaming,
  compact,
}: ChatMessageRendererProps) {
  const safeBody = sanitizeHtml(linkifyCitationMarkers(body, citations));
  const needsMath = hasMathSyntax(safeBody);
  const [mathPlugins, setMathPlugins] = useState<MathPlugins | null>(null);

  useEffect(() => {
    if (!needsMath || mathPlugins) return;
    let cancelled = false;
    import("./markdown-math-plugins").then((plugins) => {
      if (!cancelled) {
        setMathPlugins({
          remarkMath: plugins.remarkMath,
          rehypeKatex: plugins.rehypeKatex,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mathPlugins, needsMath]);

  const remarkPlugins = useMemo(
    () =>
      needsMath && mathPlugins
        ? [remarkGfm, mathPlugins.remarkMath]
        : [remarkGfm],
    [mathPlugins, needsMath],
  );
  const rehypePlugins = useMemo(
    () =>
      needsMath && mathPlugins
        ? [rehypeRaw, mathPlugins.rehypeKatex]
        : [rehypeRaw],
    [mathPlugins, needsMath],
  );

  return (
    <div
      className={compact ? compactChatProseClasses : chatProseClasses}
      data-testid="chat-message-renderer"
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{
          code: CodeBlock,
          pre: ({ children }) => <>{children}</>,
          table: ({ children }) => (
            <table className={proseClasses.table}>{children}</table>
          ),
          blockquote: CalloutBlockquote,
          a: ({ children, ...props }) => {
            const citationIndex = citationIndexFromHref(props.href);
            const citation =
              citationIndex !== null
                ? citations.find((item) => item.index === citationIndex)
                : null;
            if (citation) return <InlineCitationMarker citation={citation} />;
            return (
              <a {...props} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          img: ({ alt, ...props }) => (
            <img
              {...props}
              alt={alt ?? ""}
              className="my-2 max-h-80 max-w-full rounded-[var(--radius-control)] border border-border object-contain"
              loading="lazy"
            />
          ),
        }}
      >
        {safeBody}
      </ReactMarkdown>
      {streaming && <StreamingCursor />}
    </div>
  );
}

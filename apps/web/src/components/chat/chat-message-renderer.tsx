"use client";
import { useEffect, useMemo, useState, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { proseClasses } from "@/lib/markdown/shared-prose";
import { sanitizeHtml } from "@/lib/markdown/sanitize-html";
import { CodeBlock } from "./renderers/code-block";
import { CalloutBlockquote } from "./renderers/callout-blockquote";
import { StreamingCursor } from "./streaming-text";

interface ChatMessageRendererProps {
  body: string;
  /** True while the message is mid-stream — appends a blinking cursor. */
  streaming?: boolean;
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

export function ChatMessageRenderer({
  body,
  streaming,
}: ChatMessageRendererProps) {
  const safeBody = sanitizeHtml(body);
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
    <div className={proseClasses.body} data-testid="chat-message-renderer">
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
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {safeBody}
      </ReactMarkdown>
      {streaming && <StreamingCursor />}
    </div>
  );
}

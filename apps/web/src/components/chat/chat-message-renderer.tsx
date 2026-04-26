"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import "katex/dist/katex.min.css";
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

export function ChatMessageRenderer({
  body,
  streaming,
}: ChatMessageRendererProps) {
  // Normalize escape sequences that might arrive as literal two-character
  // sequences (e.g., from JSX string attributes or improperly serialized
  // agent responses). Real newlines pass through unchanged.
  const normalized = body
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "");
  const safeBody = sanitizeHtml(normalized);
  return (
    <div className={proseClasses.body} data-testid="chat-message-renderer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
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

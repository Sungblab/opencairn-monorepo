// Plan 2C Task 8 — read-only renderer for the public-share viewer.
//
// Plate v49 (`platejs`) does NOT export a `PlateStatic` symbol like the plan
// originally assumed. Mounting the full `<Plate>` editor in read-only mode
// would drag in Slate, history, plugins, and Yjs adapters for what is
// fundamentally a "walk JSON, emit JSX" job. So this is a hand-rolled
// recursive renderer over the Plate value shape (array of nodes where each
// node has either `{ type, children }` for blocks or `{ text, ...marks }`
// for leaves). Unknown block types fall through to a `<div>` so a
// future-Plate-version document never crashes the share page.
//
// Block coverage matches the slash-command set shipped in Plan 2A
// (paragraph, h1/h2/h3, blockquote, ul/ol/li, code_block). Wiki-link,
// research-meta, and other custom block types still render — they just
// fall through to the generic `<div>` path until we decide to add bespoke
// read-only renderers for them. Math (equation/inline_equation), image, and
// embed have dedicated static renderers (see ELEMENTS dict).
//
// Plan 2E Phase B-5 Task 5.1 — added static math renderers for "equation"
// (block) and "inline_equation" (inline) node types. These use katex directly
// without `useEditorRef()` so they are safe in contexts that have no Plate
// editor context (share page, chat renderer). The `MathInline`/`MathBlock`
// components that live in apps/web/src/components/editor/elements/ call
// `useEditorRef()` at the top level and must NOT be imported here.

import { Fragment, type ReactElement, type ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

import { safeHref } from "@/lib/url/safe-href";

/**
 * Render a LaTeX string to HTML via katex. Returns null if tex is empty or
 * unparseable; callers render a fallback error span in that case.
 */
function renderKatexHtml(
  tex: string,
  opts?: { displayMode?: boolean },
): string | null {
  if (!tex) return null;
  try {
    return katex.renderToString(tex, {
      throwOnError: true,
      displayMode: opts?.displayMode,
    });
  } catch {
    return null;
  }
}

type Node = Record<string, unknown>;
type Value = Node[];

interface ElementProps {
  children: ReactNode;
  node: Node;
}

const ELEMENTS: Record<string, (props: ElementProps) => ReactElement> = {
  // Plan 2E Phase B-5 — static math renderers. These do NOT call useEditorRef()
  // and are therefore safe outside of a Plate editor context (share page, etc.).
  //
  // "equation" = EquationPlugin key (block math node, texExpression attr)
  // "inline_equation" = InlineEquationPlugin key (inline math, texExpression attr)
  equation: ({ node }) => {
    const tex = String(node.texExpression ?? "");
    const html = renderKatexHtml(tex, { displayMode: true });
    return (
      <div className="my-3 rounded border border-border p-3 overflow-x-auto">
        {html ? (
          <span dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span className="text-sm text-red-600">{`$$${tex}$$`}</span>
        )}
      </div>
    );
  },
  inline_equation: ({ node }) => {
    const tex = String(node.texExpression ?? "");
    const html = renderKatexHtml(tex);
    return html ? (
      <span
        className="mx-0.5 inline-block"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    ) : (
      <span className="text-xs text-red-600">{`$${tex}$`}</span>
    );
  },
  // Plan 2E Phase B-2 — image block: <figure> with lazy-loaded <img>.
  // alt defaults to "" (decorative) when absent — satisfies jsx-a11y.
  image: ({ node }) => {
    const url = String(node.url ?? "");
    const alt = String(node.alt ?? "");
    const caption = node.caption ? String(node.caption) : undefined;
    const width = typeof node.width === "number" ? node.width : undefined;
    return (
      <figure className="my-4">
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          style={width ? { width: `${width * 100}%` } : undefined}
          className="rounded-md max-w-full h-auto"
        />
        {caption && (
          <figcaption className="text-sm text-muted-foreground mt-1">
            {caption}
          </figcaption>
        )}
      </figure>
    );
  },
  // Plan 2E Phase B — embed block: sandboxed iframe in an aspect-video container.
  // CSP frame-src in next.config.ts allows the 3 provider origins.
  embed: ({ node }) => {
    const embedUrl = String(node.embedUrl ?? "");
    const provider = String(node.provider ?? "");
    return (
      <div className="my-4 aspect-video w-full">
        <iframe
          src={embedUrl}
          title={`${provider} embed`}
          sandbox="allow-scripts allow-same-origin allow-presentation"
          allow="autoplay; fullscreen; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
          className="h-full w-full rounded-md border-0"
        />
      </div>
    );
  },
  p: ({ children }) => <p className="my-2 leading-7">{children}</p>,
  h1: ({ children }) => (
    <h1 className="mt-6 mb-3 text-2xl font-semibold">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-5 mb-2 text-xl font-semibold">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-4 mb-2 text-lg font-semibold">{children}</h3>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-border pl-4 text-muted-foreground">
      {children}
    </blockquote>
  ),
  ul: ({ children }) => <ul className="my-2 list-disc pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal pl-6">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  // Inline link. Notion ingest + the Deep Research markdown converter both
  // emit `{ type: "a", url, children }` nodes (see
  // apps/worker/src/worker/activities/notion_activities.py +
  // apps/worker/src/worker/activities/deep_research/markdown_to_plate.py).
  // Without this branch they fall through to `<div>` and silently drop
  // their hyperlink.
  a: ({ children, node }) => (
    <a
      href={safeHref(node.url)}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-primary underline underline-offset-4"
    >
      {children}
    </a>
  ),
  code_block: ({ children, node }) => {
    const language = String(node.language ?? node.lang ?? "").trim();
    return (
      <figure
        className="my-4 overflow-hidden rounded-md border border-border bg-muted/30"
        data-testid="static-code-block"
      >
        <figcaption className="flex min-h-8 items-center justify-between border-b border-border bg-muted/50 px-3 text-xs text-muted-foreground">
          <span data-testid="static-code-language">
            {language || "code"}
          </span>
          <span aria-hidden className="font-mono">
            {"</>"}
          </span>
        </figcaption>
        <pre className="m-0 overflow-x-auto bg-transparent p-3 text-sm leading-6">
          <code>{children}</code>
        </pre>
      </figure>
    );
  },
  code_line: ({ children }) => (
    <span className="block min-h-5 whitespace-pre font-mono">{children}</span>
  ),
};

function renderText(node: Node, key: number): ReactNode {
  let el: ReactNode = String(node.text ?? "");
  if (node.code) el = <code key={`c-${key}`}>{el}</code>;
  if (node.bold) el = <strong key={`b-${key}`}>{el}</strong>;
  if (node.italic) el = <em key={`i-${key}`}>{el}</em>;
  if (node.underline) el = <u key={`u-${key}`}>{el}</u>;
  return <Fragment key={key}>{el}</Fragment>;
}

function renderNode(node: Node, key: number): ReactNode {
  // Slate leaves are detected by the presence of a `text` key, not by absence
  // of `type` — some custom inline elements may still set `type` while also
  // carrying a `text` placeholder. Plate's own renderer uses the same heuristic.
  if (typeof node.text === "string") return renderText(node, key);

  const type = String(node.type ?? "p");
  const children = ((node.children as Node[] | undefined) ?? []).map((c, i) =>
    renderNode(c, i),
  );
  const Renderer = ELEMENTS[type];
  if (Renderer) {
    return (
      <Renderer key={key} node={node}>
        {children}
      </Renderer>
    );
  }
  // Unknown block type → fall through to a div so we never drop content.
  return <div key={key}>{children}</div>;
}

export function PlateStaticRenderer({ value }: { value: Value }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      {value.map((n, i) => (
        <Fragment key={i}>{renderNode(n, i)}</Fragment>
      ))}
    </div>
  );
}

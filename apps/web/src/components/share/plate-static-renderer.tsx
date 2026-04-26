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
// (paragraph, h1/h2/h3, blockquote, ul/ol/li, code_block). Math, wiki-link,
// research-meta, and other custom block types still render — they just
// fall through to the generic `<div>` path until we decide to add bespoke
// read-only renderers for them.

import { Fragment, type ReactElement, type ReactNode } from "react";

type Node = Record<string, unknown>;
type Value = Node[];

interface ElementProps {
  children: ReactNode;
  node: Node;
}

const ELEMENTS: Record<string, (props: ElementProps) => ReactElement> = {
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
  code_block: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded bg-muted p-3 text-sm">
      <code>{children}</code>
    </pre>
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

import { MarkdownPlugin } from "@platejs/markdown";
import { createSlateEditor } from "platejs";
import {
  BaseBlockquotePlugin,
  BaseBoldPlugin,
  BaseCodePlugin,
  BaseH1Plugin,
  BaseH2Plugin,
  BaseH3Plugin,
  BaseHorizontalRulePlugin,
  BaseItalicPlugin,
  BaseStrikethroughPlugin,
} from "@platejs/basic-nodes";
import { BaseCodeBlockPlugin, BaseCodeLinePlugin } from "@platejs/code-block";
import { BaseListPlugin } from "@platejs/list";

// Plan 2D — Markdown → Plate v49 Value converter.
//
// Used by:
//   1. The chat → editor save_suggestion flow (insert markdown body
//      from a chat into the active Plate editor).
//   2. Future: import flow for Notion ZIP / Drive .md files.
//
// The deserializer is a one-shot Slate editor we throw away after each
// call — no UI dependency, so this can run inside server actions /
// non-DOM tests without jsdom. Custom post-processing (mermaid /
// callout) runs after the standard Plate AST is built, walking the
// tree exactly once.
//
// Returns Plate `Value` (Element[]). Always has at least one element
// (empty paragraph for empty/blank input) so callers don't need to
// special-case "did the parse return nothing?".
//
// NOTE: Uses Base (non-React) plugins — these are SlatePlugin instances
// compatible with createSlateEditor. The live editor (NoteEditor.tsx)
// uses the React equivalents (PlatePlugin) from /react subpaths.

type PlateNode = {
  type?: string;
  lang?: string;
  children?: PlateNode[];
  text?: string;
  [key: string]: unknown;
};

const deserializerPlugins = [
  BaseBoldPlugin,
  BaseItalicPlugin,
  BaseStrikethroughPlugin,
  BaseCodePlugin,
  BaseH1Plugin,
  BaseH2Plugin,
  BaseH3Plugin,
  BaseBlockquotePlugin,
  BaseHorizontalRulePlugin,
  BaseListPlugin,
  BaseCodeBlockPlugin,
  BaseCodeLinePlugin,
  MarkdownPlugin,
];

function joinCodeLines(node: PlateNode): string {
  // Plate code_block has children of type code_line, each with a single text leaf.
  if (!node.children) return "";
  return node.children
    .map((line) => line.children?.[0]?.text ?? "")
    .join("\n");
}

function postprocessMermaid(nodes: PlateNode[]): PlateNode[] {
  return nodes.map((n) => {
    if (n.type === "code_block" && (n.lang === "mermaid" || n.lang === "Mermaid")) {
      return {
        type: "mermaid",
        code: joinCodeLines(n),
        children: [{ text: "" }],
      };
    }
    return n;
  });
}

const CALLOUT_KINDS = ["info", "warn", "tip", "danger"] as const;
type CalloutKind = (typeof CALLOUT_KINDS)[number];

const CALLOUT_PREFIX_RE = /^\s*\[!(\w+)\]\s?(.*)$/;

function extractCalloutKind(node: PlateNode): {
  kind: CalloutKind;
  strippedFirstChild: PlateNode;
} | null {
  if (node.type !== "blockquote") return null;
  const firstChild = node.children?.[0];
  if (!firstChild) return null;

  // The Plate markdown deserializer produces blockquotes with text leaves
  // as direct children: blockquote → { text: "[!kind] body" }.
  // Detect both the flat case (firstChild is a text leaf) and the nested
  // case (firstChild is a paragraph whose first leaf has the text).
  let firstLeaf: PlateNode;
  let text: string;
  let isFlat: boolean;

  if (typeof firstChild.text === "string") {
    // Flat: firstChild itself is the text leaf.
    firstLeaf = firstChild;
    text = firstChild.text;
    isFlat = true;
  } else {
    // Nested: firstChild is a block element (p) containing text leaves.
    const leaf = firstChild.children?.[0];
    if (!leaf || typeof leaf.text !== "string") return null;
    firstLeaf = leaf;
    text = leaf.text;
    isFlat = false;
  }

  const match = text.match(CALLOUT_PREFIX_RE);
  if (!match) return null;

  const rawKind = match[1].toLowerCase();
  const kind: CalloutKind = (CALLOUT_KINDS as readonly string[]).includes(rawKind)
    ? (rawKind as CalloutKind)
    : "info";
  const remaining = match[2];

  let strippedFirstChild: PlateNode;
  if (isFlat) {
    // Wrap the stripped text leaf in a paragraph so the callout children
    // follow the standard Slate element structure (element → text leaves).
    strippedFirstChild = {
      type: "p",
      children: [{ ...firstLeaf, text: remaining }],
    };
  } else {
    // Rebuild the paragraph with the prefix stripped from the first leaf.
    const newLeafChildren = [
      { ...firstLeaf, text: remaining },
      ...(firstChild.children?.slice(1) ?? []),
    ];
    strippedFirstChild = { ...firstChild, children: newLeafChildren };
  }

  return { kind, strippedFirstChild };
}

function postprocessCallout(nodes: PlateNode[]): PlateNode[] {
  return nodes.map((n) => {
    const detected = extractCalloutKind(n);
    if (!detected) return n;
    const { kind, strippedFirstChild } = detected;
    const otherChildren = n.children?.slice(1) ?? [];
    return {
      type: "callout",
      kind,
      children: [strippedFirstChild, ...otherChildren],
    };
  });
}

export function markdownToPlate(markdown: string): PlateNode[] {
  if (!markdown || !markdown.trim()) {
    return [{ type: "p", children: [{ text: "" }] }];
  }

  let value: PlateNode[] = [];
  try {
    const editor = createSlateEditor({
      plugins: deserializerPlugins,
      value: [{ type: "p", children: [{ text: "" }] }],
    });
    value = editor.api.markdown.deserialize(markdown) as PlateNode[];
  } catch {
    // Defensive: the deserializer can throw on extreme malformed input
    // (unbalanced HTML, exotic punctuation). Fall back to a single
    // paragraph holding the raw text rather than crashing the caller.
    return [{ type: "p", children: [{ text: markdown }] }];
  }

  if (!value || value.length === 0) {
    return [{ type: "p", children: [{ text: "" }] }];
  }

  return postprocessCallout(postprocessMermaid(value));
}

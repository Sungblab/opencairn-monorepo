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

  return postprocessMermaid(value);
}

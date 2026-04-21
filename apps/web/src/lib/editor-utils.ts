// Plate Value = array of block nodes. Types kept loose because @platejs/core
// tightens them at the editor boundary — over-typing here forces every consumer
// to import Plate types.
//
// MVP scope: walks .text and .children only. Does not surface leaf alternatives
// like mention value, link url, code, texExpression — widen when those plugins
// ship. Mirrors apps/api/src/lib/plate-text.ts — keep behavior in sync.
export type PlateNode = {
  type?: string;
  text?: string;
  children?: PlateNode[];
  [k: string]: unknown;
};
export type PlateValue = PlateNode[];

const MAX_DEPTH = 64;

export function plateValueToText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const walk = (nodes: PlateNode[], depth: number): string => {
    if (depth > MAX_DEPTH) return "";
    return nodes
      .map((n) => {
        if (typeof n.text === "string") return n.text;
        if (Array.isArray(n.children)) return walk(n.children, depth + 1);
        return "";
      })
      .join(" ");
  };
  return walk(value as PlateNode[], 0)
    .replace(/\s+/g, " ")
    .trim();
}

export function emptyEditorValue(): PlateValue {
  return [{ type: "p", children: [{ text: "" }] }];
}

export function parseEditorContent(raw: unknown): PlateValue {
  if (!Array.isArray(raw)) return emptyEditorValue();
  return raw as PlateValue;
}

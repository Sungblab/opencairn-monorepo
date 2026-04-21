// Flatten a Plate Value (array of block nodes) into plain text for FTS.
// Mirrors apps/web/src/lib/editor-utils.ts#plateValueToText — keep in sync.
// MVP: only walks `text` leaves and `children`. Mention/link/code-block leaf
// variants are intentionally deferred until the web editor adds those plugins.
type PlateNode = { text?: string; children?: PlateNode[] };

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

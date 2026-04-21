// Flatten a Plate Value (array of block nodes) into plain text for FTS.
// Mirrors apps/web/src/lib/editor-utils.ts#plateValueToText — keep in sync.
type PlateNode = { text?: string; children?: PlateNode[] };

export function plateValueToText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const walk = (nodes: PlateNode[]): string =>
    nodes
      .map((n) => {
        if (typeof n.text === "string") return n.text;
        if (Array.isArray(n.children)) return walk(n.children);
        return "";
      })
      .join("");
  return walk(value as PlateNode[]).trim();
}

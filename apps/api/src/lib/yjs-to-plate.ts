import * as Y from "yjs";

export type PlateValue = Array<Record<string, unknown>>;

// Empty paragraph keeps Plate happy (it requires at least one block child).
const EMPTY_PLATE: PlateValue = [{ type: "p", children: [{ text: "" }] }];

// Convert a Y.XmlFragment into a Plate-shaped node tree. Plate's Yjs
// integration uses XmlFragment with element/text nodes whose `nodeName`
// becomes the Plate `type`. Leaf text nodes carry attributes for marks.
function fragmentToPlateChildren(
  fragment: Y.XmlFragment,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const child of fragment.toArray()) {
    if (child instanceof Y.XmlElement) {
      const node: Record<string, unknown> = { type: child.nodeName };
      const attrs = child.getAttributes();
      for (const [k, v] of Object.entries(attrs)) {
        if (k !== "type") node[k] = v;
      }
      node.children = fragmentToPlateChildren(child);
      if ((node.children as unknown[]).length === 0) {
        node.children = [{ text: "" }];
      }
      out.push(node);
    } else if (child instanceof Y.XmlText) {
      const segments: Array<Record<string, unknown>> = [];
      const delta = child.toDelta() as Array<{
        insert: string;
        attributes?: Record<string, unknown>;
      }>;
      for (const seg of delta) {
        segments.push({ text: seg.insert, ...(seg.attributes ?? {}) });
      }
      // XmlText holds inline runs; lift them into the parent's children.
      out.push(...segments);
    }
  }
  return out;
}

export function yjsStateToPlateValue(state: Uint8Array): PlateValue {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const fragment = doc.getXmlFragment("content");
  const children = fragmentToPlateChildren(fragment);
  if (children.length === 0) return EMPTY_PLATE;
  // Top-level XmlText would land here as a leaf; wrap in a paragraph for
  // Plate's "blocks at root" invariant.
  if (children.every((c) => "text" in c)) {
    return [{ type: "p", children }];
  }
  return children as PlateValue;
}

export function fallbackPlateValue(content: unknown): PlateValue {
  if (Array.isArray(content) && content.length > 0) {
    return content as PlateValue;
  }
  return EMPTY_PLATE;
}

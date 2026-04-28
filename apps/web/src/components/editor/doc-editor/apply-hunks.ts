import type { Value, TElement, TText } from "platejs";
import type { DocEditorHunk } from "@opencairn/shared";

// Plan 11B Phase A — pure transform, no Plate editor instance required.
//
// Strategy: walk top-level blocks, match by `id`, then splice hunks into
// children PRESERVING marks on text outside the hunk range. The
// replacement text itself drops marks (the LLM rewrites prose — we don't
// know how to map source marks onto a different sentence); per-mark
// preservation INSIDE the hunk is a Phase C concern (real Diff View where
// the model returns a styled inline-AST). What matters here: bold /
// italic / link in unrelated parts of the same block stay intact.
//
// Hunks within a block apply right-to-left so earlier offsets stay valid
// after each splice.

export interface ApplyHunksResult {
  value: Value;
  appliedCount: number;
  skippedCount: number;
}

export function applyHunksToValue(
  value: Value,
  hunks: DocEditorHunk[],
): ApplyHunksResult {
  if (hunks.length === 0) {
    return { value, appliedCount: 0, skippedCount: 0 };
  }
  let mutated = false;
  let appliedCount = 0;
  let skippedCount = 0;
  // Hunks targeting an unknown blockId are skipped at the block-walk
  // level — count them up-front so a later splice that no-ops doesn't
  // double-count.
  const knownBlockIds = new Set<string>();
  for (const node of value) {
    if (isElementWithId(node)) knownBlockIds.add(node.id);
  }
  for (const h of hunks) {
    if (!knownBlockIds.has(h.blockId)) skippedCount++;
  }

  const next = value.map((node) => {
    if (!isElementWithId(node)) return node;
    const blockHunks = hunks.filter((h) => h.blockId === node.id);
    if (blockHunks.length === 0) return node;
    const sorted = [...blockHunks].sort(
      (a, b) => b.originalRange.start - a.originalRange.start,
    );
    let children = node.children as (TElement | TText)[];
    let blockMutated = false;
    for (const h of sorted) {
      const result = spliceTextRange(
        children,
        h.originalRange.start,
        h.originalRange.end,
        h.originalText,
        h.replacementText,
      );
      if (result === null) {
        skippedCount++;
        continue;
      }
      children = result;
      appliedCount++;
      blockMutated = true;
    }
    if (!blockMutated) return node;
    mutated = true;
    return { ...node, children };
  });
  // Preserve referential identity when nothing changed so React/Plate
  // memoization paths can short-circuit.
  return {
    value: mutated ? next : value,
    appliedCount,
    skippedCount,
  };
}

function isElementWithId(
  node: unknown,
): node is TElement & { id: string; children: (TElement | TText)[] } {
  return (
    typeof node === "object" &&
    node !== null &&
    "id" in node &&
    typeof (node as { id: unknown }).id === "string" &&
    "children" in node
  );
}

// Splice [start, end) inside the flattened concatenation of `children`
// with `replacement`. Returns a new children array where text segments
// outside the splice keep their original marks; only the spliced span is
// emitted as a plain `{ text: replacement }` node. Returns `null` when the
// substring at [start, end) does not match `expected` — the document
// drifted and the caller must skip this hunk.
function spliceTextRange(
  children: (TElement | TText)[],
  start: number,
  end: number,
  expected: string,
  replacement: string,
): (TElement | TText)[] | null {
  // Phase A scope: only flat text siblings. Any inline element (link,
  // mention, etc.) inside the block falls through to the lossy fallback
  // — Phase C revisits with a structured replacement AST.
  if (!children.every((c) => "text" in c)) {
    return spliceTextRangeFallback(
      children,
      start,
      end,
      expected,
      replacement,
    );
  }
  const texts = children as TText[];
  const flat = texts.map((c) => c.text).join("");
  if (flat.slice(start, end) !== expected) return null;

  const out: TText[] = [];
  let pos = 0;
  let inserted = false;
  for (const c of texts) {
    const segStart = pos;
    const segEnd = pos + c.text.length;
    if (segEnd <= start || segStart >= end) {
      // Entirely outside the hunk — keep node + marks.
      out.push(c);
    } else {
      // Intersects: keep unaffected prefix/suffix slices with original
      // marks, drop the overlap, and insert the replacement once at the
      // first intersection point.
      if (segStart < start) {
        out.push({ ...c, text: c.text.slice(0, start - segStart) });
      }
      if (!inserted) {
        out.push({ text: replacement });
        inserted = true;
      }
      if (segEnd > end) {
        out.push({ ...c, text: c.text.slice(end - segStart) });
      }
    }
    pos = segEnd;
  }
  // Edge case: replacement falls at the very end (end === flat.length)
  // and no segment intersected — should not happen given we already
  // validated `flat.slice(start, end) === expected`, but guard anyway.
  if (!inserted) out.push({ text: replacement });

  return mergeAdjacentText(out.filter((n) => n.text.length > 0));
}

// Coalesce adjacent text nodes that share the same mark set. Plate
// canonicalizes text runs this way; without merging, the splice would
// leave a `[{text:"Hi"},{text:" world"}]` pair where a single
// `{text:"Hi world"}` is expected. Marks are compared by JSON shape since
// every Plate mark is a primitive boolean / string flag.
function mergeAdjacentText(nodes: TText[]): TText[] {
  const out: TText[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (prev && sameMarks(prev, n)) {
      out[out.length - 1] = { ...prev, text: prev.text + n.text };
    } else {
      out.push(n);
    }
  }
  return out;
}

function sameMarks(a: TText, b: TText): boolean {
  const aMarks = markKeys(a);
  const bMarks = markKeys(b);
  if (aMarks.length !== bMarks.length) return false;
  for (const k of aMarks) {
    if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k])
      return false;
  }
  return true;
}

function markKeys(n: TText): string[] {
  return Object.keys(n)
    .filter((k) => k !== "text")
    .sort();
}

// Fallback for blocks containing inline elements (links, mentions) that
// intersect the hunk range. Collapses the whole block to plain text — the
// same lossy behavior the original prose had before Phase C lands a
// structured replacement AST.
function spliceTextRangeFallback(
  children: (TElement | TText)[],
  start: number,
  end: number,
  expected: string,
  replacement: string,
): (TElement | TText)[] | null {
  const flat = children
    .map((c) => ("text" in c ? c.text : flattenChildren(c.children ?? [])))
    .join("");
  if (flat.slice(start, end) !== expected) return null;
  const next = flat.slice(0, start) + replacement + flat.slice(end);
  return [{ text: next }];
}

function flattenChildren(children: (TElement | TText)[]): string {
  return children
    .map((c) => ("text" in c ? c.text : flattenChildren(c.children ?? [])))
    .join("");
}

import type { NoteVersionDiff } from "@opencairn/shared";

type PlateNode = Record<string, unknown>;
type VersionRef = number | "current";

function asBlocks(value: unknown): PlateNode[] {
  return Array.isArray(value) ? (value as PlateNode[]) : [];
}

function textOf(node: unknown): string {
  const parts: string[] = [];
  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const obj = value as { text?: unknown; children?: unknown };
    if (typeof obj.text === "string") {
      parts.push(obj.text);
      return;
    }
    if (Array.isArray(obj.children)) obj.children.forEach(walk);
  };
  walk(node);
  return parts.join("");
}

function blockKey(node: unknown, index: number): string {
  if (node && typeof node === "object") {
    const obj = node as { id?: unknown; blockId?: unknown };
    if (typeof obj.id === "string") return obj.id;
    if (typeof obj.blockId === "string") return obj.blockId;
  }
  return String(index);
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

function commonSuffix(a: string, b: string, prefix: number): number {
  let i = 0;
  while (
    i + prefix < a.length &&
    i + prefix < b.length &&
    a[a.length - 1 - i] === b[b.length - 1 - i]
  ) {
    i += 1;
  }
  return i;
}

function textDiff(
  before: string,
  after: string,
): Array<{ kind: "equal" | "insert" | "delete"; text: string }> {
  if (before === after) return [{ kind: "equal", text: before }];
  const prefix = commonPrefix(before, after);
  const suffix = commonSuffix(before, after, prefix);
  const parts: Array<{ kind: "equal" | "insert" | "delete"; text: string }> =
    [];
  if (prefix > 0) parts.push({ kind: "equal", text: before.slice(0, prefix) });
  const removed = before.slice(prefix, before.length - suffix);
  const inserted = after.slice(prefix, after.length - suffix);
  if (removed) parts.push({ kind: "delete", text: removed });
  if (inserted) parts.push({ kind: "insert", text: inserted });
  if (suffix > 0)
    parts.push({ kind: "equal", text: before.slice(before.length - suffix) });
  return parts;
}

export function diffPlateValues(input: {
  fromVersion: VersionRef;
  toVersion: VersionRef;
  before: unknown;
  after: unknown;
}): NoteVersionDiff {
  const before = asBlocks(input.before);
  const after = asBlocks(input.after);
  const max = Math.max(before.length, after.length);
  const blocks: NoteVersionDiff["blocks"] = [];
  let addedBlocks = 0;
  let removedBlocks = 0;
  let changedBlocks = 0;
  let addedWords = 0;
  let removedWords = 0;

  for (let index = 0; index < max; index += 1) {
    const b = before[index];
    const a = after[index];
    const key = blockKey(a ?? b, index);

    if (!b && a) {
      addedBlocks += 1;
      addedWords += wordCount(textOf(a));
      blocks.push({ key, status: "added", after: a });
      continue;
    }
    if (b && !a) {
      removedBlocks += 1;
      removedWords += wordCount(textOf(b));
      blocks.push({ key, status: "removed", before: b });
      continue;
    }
    if (!b || !a) continue;

    const beforeText = textOf(b);
    const afterText = textOf(a);
    if (JSON.stringify(b) === JSON.stringify(a)) {
      blocks.push({ key, status: "unchanged", before: b, after: a });
      continue;
    }

    changedBlocks += 1;
    const parts = textDiff(beforeText, afterText);
    addedWords += parts
      .filter((part) => part.kind === "insert")
      .reduce((sum, part) => sum + wordCount(part.text), 0);
    removedWords += parts
      .filter((part) => part.kind === "delete")
      .reduce((sum, part) => sum + wordCount(part.text), 0);
    blocks.push({
      key,
      status: "changed",
      before: b,
      after: a,
      textDiff: parts,
    });
  }

  return {
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    summary: {
      addedBlocks,
      removedBlocks,
      changedBlocks,
      addedWords,
      removedWords,
    },
    blocks,
  };
}

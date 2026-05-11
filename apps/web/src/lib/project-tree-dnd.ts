import type { TreeNode } from "@/hooks/use-project-tree";

export const PROJECT_TREE_DRAG_MIME =
  "application/vnd.opencairn.project-tree-node+json";

export type ProjectTreeDragPayload = {
  id: string;
  kind: Exclude<TreeNode["kind"], "empty">;
  label: string;
  targetId: string;
  parentId: string | null;
};

export function treeNodeToDragPayload(
  node: TreeNode,
): ProjectTreeDragPayload | null {
  if (node.kind === "empty") return null;
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    targetId: node.target_id ?? node.id,
    parentId: node.parent_id,
  };
}

export function writeProjectTreeDragPayload(
  dataTransfer: DataTransfer,
  payload: ProjectTreeDragPayload,
) {
  dataTransfer.setData(PROJECT_TREE_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData("text/plain", payload.label);
  dataTransfer.effectAllowed = "copyMove";
}

export function readProjectTreeDragPayload(
  dataTransfer: DataTransfer,
): ProjectTreeDragPayload | null {
  const raw = dataTransfer.getData(PROJECT_TREE_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ProjectTreeDragPayload>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.kind !== "string" ||
      typeof parsed.label !== "string" ||
      typeof parsed.targetId !== "string"
    ) {
      return null;
    }
    return {
      id: parsed.id,
      kind: parsed.kind as ProjectTreeDragPayload["kind"],
      label: parsed.label,
      targetId: parsed.targetId,
      parentId: typeof parsed.parentId === "string" ? parsed.parentId : null,
    };
  } catch {
    return null;
  }
}

export function dataTransferHasProjectTreeNode(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes(PROJECT_TREE_DRAG_MIME);
}

export function dataTransferHasFiles(dataTransfer: DataTransfer) {
  if (dataTransfer.files.length > 0) return true;
  return Array.from(dataTransfer.types).includes("Files");
}

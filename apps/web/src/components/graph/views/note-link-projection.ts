import type { ViewNode } from "@opencairn/shared";
import type { GroundedEdge, GroundedGraphResponse } from "../grounded-types";

type NoteLinks = NonNullable<GroundedGraphResponse["noteLinks"]>;

export type NoteLinkProjection = {
  nodes: ViewNode[];
  noteNodeIds: Set<string>;
};

export type NoteLinkGraphProjection = NoteLinkProjection & {
  edges: GroundedEdge[];
};

function collectNoteLinkNodes(
  nodes: ViewNode[],
  noteLinks: NoteLinks | undefined,
): NoteLinkProjection {
  if (!noteLinks?.length) return { nodes, noteNodeIds: new Set() };

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const noteDegree = new Map<string, number>();
  const noteTitles = new Map<string, string>();

  for (const link of noteLinks) {
    noteTitles.set(link.sourceNoteId, link.sourceTitle);
    noteTitles.set(link.targetNoteId, link.targetTitle);
    noteDegree.set(link.sourceNoteId, (noteDegree.get(link.sourceNoteId) ?? 0) + 1);
    noteDegree.set(link.targetNoteId, (noteDegree.get(link.targetNoteId) ?? 0) + 1);
  }

  const noteNodeIds = new Set<string>();
  for (const [noteId, title] of noteTitles) {
    if (nodeMap.has(noteId)) continue;
    noteNodeIds.add(noteId);
    nodeMap.set(noteId, {
      id: noteId,
      name: title,
      description: "",
      degree: noteDegree.get(noteId) ?? 1,
      noteCount: 1,
      firstNoteId: noteId,
    });
  }

  return { nodes: [...nodeMap.values()], noteNodeIds };
}

export function projectNoteLinksToNodes(
  nodes: ViewNode[],
  noteLinks: NoteLinks | undefined,
): NoteLinkProjection {
  return collectNoteLinkNodes(nodes, noteLinks);
}

export function projectNoteLinksToGraph(
  nodes: ViewNode[],
  edges: GroundedEdge[],
  noteLinks: NoteLinks | undefined,
): NoteLinkGraphProjection {
  const projection = collectNoteLinkNodes(nodes, noteLinks);
  if (!noteLinks?.length) return { ...projection, edges };

  const edgeMap = new Map(edges.map((edge) => [edge.id, edge]));
  for (const link of noteLinks) {
    const id = `note-link:${link.sourceNoteId}->${link.targetNoteId}`;
    if (edgeMap.has(id)) continue;
    edgeMap.set(id, {
      id,
      sourceId: link.sourceNoteId,
      targetId: link.targetNoteId,
      relationType: "wiki-link",
      weight: 1,
      surfaceType: "wiki_link",
      displayOnly: true,
      sourceNoteIds: [link.sourceNoteId, link.targetNoteId],
      sourceNoteLinks: [link],
    });
  }

  return { ...projection, edges: [...edgeMap.values()] };
}

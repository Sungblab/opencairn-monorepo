import type { DocEditorClaim } from "@opencairn/shared";

export type FactcheckCommentInsert = {
  workspaceId: string;
  noteId: string;
  parentId: null;
  anchorBlockId: string;
  authorId: string;
  body: string;
  bodyAst: {
    agentKind: "doc_editor";
    command: "factcheck";
    verdict: DocEditorClaim["verdict"];
    evidence: DocEditorClaim["evidence"];
    range: DocEditorClaim["range"];
    triggeredBy: string;
    note: string;
  };
};

const VERDICT_LABEL: Record<DocEditorClaim["verdict"], string> = {
  supported: "Supported",
  unclear: "Needs review",
  contradicted: "Contradicted",
};

export function buildFactcheckCommentRows({
  claims,
  workspaceId,
  noteId,
  userId,
}: {
  claims: DocEditorClaim[];
  workspaceId: string;
  noteId: string;
  userId: string;
}): FactcheckCommentInsert[] {
  return claims.map((claim) => ({
    workspaceId,
    noteId,
    parentId: null,
    anchorBlockId: claim.blockId,
    authorId: userId,
    body: `${VERDICT_LABEL[claim.verdict]}: ${claim.note}`,
    bodyAst: {
      agentKind: "doc_editor",
      command: "factcheck",
      verdict: claim.verdict,
      evidence: claim.evidence,
      range: claim.range,
      triggeredBy: userId,
      note: claim.note,
    },
  }));
}

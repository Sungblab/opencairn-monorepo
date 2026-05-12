import {
  and,
  db,
  desc,
  eq,
  inArray,
  isNull,
  notes,
  wikiLinks,
} from "@opencairn/db";
import { canRead } from "./permissions";

export type ProjectWikiIndexPage = {
  id: string;
  title: string;
  type: string;
  sourceType: string | null;
  summary: string;
  updatedAt: string;
  inboundLinks: number;
  outboundLinks: number;
};

export type ProjectWikiIndex = {
  projectId: string;
  generatedAt: string;
  latestPageUpdatedAt: string | null;
  totals: {
    pages: number;
    wikiLinks: number;
    orphanPages: number;
  };
  pages: ProjectWikiIndexPage[];
};

export async function buildProjectWikiIndex(opts: {
  projectId: string;
  userId?: string;
}): Promise<ProjectWikiIndex> {
  if (
    opts.userId &&
    !(await canRead(opts.userId, { type: "project", id: opts.projectId }))
  ) {
    return emptyProjectWikiIndex(opts.projectId);
  }

  const noteRows = await db
    .select({
      id: notes.id,
      title: notes.title,
      type: notes.type,
      sourceType: notes.sourceType,
      updatedAt: notes.updatedAt,
      contentText: notes.contentText,
      inheritParent: notes.inheritParent,
    })
    .from(notes)
    .where(and(eq(notes.projectId, opts.projectId), isNull(notes.deletedAt)))
    .orderBy(desc(notes.updatedAt));

  const visibleNotes: typeof noteRows = [];
  for (const note of noteRows) {
    if (note.inheritParent === false) {
      if (
        !opts.userId ||
        !(await canRead(opts.userId, { type: "note", id: note.id }))
      ) {
        continue;
      }
    }
    visibleNotes.push(note);
  }

  const noteIds = new Set(visibleNotes.map((note) => note.id));
  const linkRows = visibleNotes.length
    ? await db
        .select({
          sourceNoteId: wikiLinks.sourceNoteId,
          targetNoteId: wikiLinks.targetNoteId,
        })
        .from(wikiLinks)
        .where(
          and(
            inArray(wikiLinks.sourceNoteId, [...noteIds]),
            inArray(wikiLinks.targetNoteId, [...noteIds]),
          ),
        )
    : [];

  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  let wikiLinkTotal = 0;
  for (const link of linkRows) {
    if (!noteIds.has(link.sourceNoteId) || !noteIds.has(link.targetNoteId)) {
      continue;
    }
    wikiLinkTotal += 1;
    outbound.set(link.sourceNoteId, (outbound.get(link.sourceNoteId) ?? 0) + 1);
    inbound.set(link.targetNoteId, (inbound.get(link.targetNoteId) ?? 0) + 1);
  }

  const pages = visibleNotes.map((note) => ({
    id: note.id,
    title: note.title,
    type: note.type,
    sourceType: note.sourceType,
    summary: (note.contentText ?? "").trim().slice(0, 280),
    updatedAt: note.updatedAt.toISOString(),
    inboundLinks: inbound.get(note.id) ?? 0,
    outboundLinks: outbound.get(note.id) ?? 0,
  }));
  const latestPageUpdatedAt = visibleNotes[0]?.updatedAt.toISOString() ?? null;
  const orphanPages = pages.filter(
    (page) => page.inboundLinks === 0 && page.outboundLinks === 0,
  ).length;

  return {
    projectId: opts.projectId,
    generatedAt: new Date().toISOString(),
    latestPageUpdatedAt,
    totals: {
      pages: visibleNotes.length,
      wikiLinks: wikiLinkTotal,
      orphanPages,
    },
    pages,
  };
}

function emptyProjectWikiIndex(projectId: string): ProjectWikiIndex {
  return {
    projectId,
    generatedAt: new Date().toISOString(),
    latestPageUpdatedAt: null,
    totals: {
      pages: 0,
      wikiLinks: 0,
      orphanPages: 0,
    },
    pages: [],
  };
}

export function projectWikiIndexToPrompt(
  index: ProjectWikiIndex,
  opts: { pageLimit?: number; orphanLimit?: number } = {},
): string {
  const lines = [
    "## Project Wiki Index",
    `Project: ${index.projectId}`,
    `Generated at: ${index.generatedAt}`,
    `Latest page update: ${index.latestPageUpdatedAt ?? "none"}`,
    `Pages: ${index.totals.pages}`,
    `Wiki links: ${index.totals.wikiLinks}`,
    `Orphan pages: ${index.totals.orphanPages}`,
  ];
  if (index.pages.length > 0) {
    lines.push("", "Top linked pages:");
    const pages = [...index.pages].sort(
      (a, b) =>
        b.inboundLinks + b.outboundLinks - (a.inboundLinks + a.outboundLinks) ||
        a.title.localeCompare(b.title),
    );
    const limitedPages =
      typeof opts.pageLimit === "number"
        ? pages.slice(0, opts.pageLimit)
        : pages;
    for (const page of limitedPages) {
      const summary = page.summary ? ` - ${page.summary}` : "";
      lines.push(
        `- ${page.title} (${page.type}; in:${page.inboundLinks}, out:${page.outboundLinks})${summary}`,
      );
    }
  }
  const orphanPages = index.pages
    .filter((page) => page.inboundLinks === 0 && page.outboundLinks === 0)
    .sort((a, b) => a.title.localeCompare(b.title));
  if (orphanPages.length > 0) {
    lines.push("", "Orphan page candidates:");
    const limitedOrphans =
      typeof opts.orphanLimit === "number"
        ? orphanPages.slice(0, opts.orphanLimit)
        : orphanPages;
    for (const page of limitedOrphans) {
      lines.push(`- ${page.title} (${page.type})`);
    }
  }
  return lines.join("\n");
}

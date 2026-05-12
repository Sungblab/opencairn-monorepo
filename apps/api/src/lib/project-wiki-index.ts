import {
  and,
  db,
  desc,
  eq,
  extractWikiLinkReferences,
  inArray,
  isNull,
  notes,
  wikiLinks,
  wikiLogs,
} from "@opencairn/db";
import { canRead } from "./permissions";

const DEFAULT_PROMPT_LINK_LIMIT = 24;

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

export type ProjectWikiIndexLink = {
  sourceNoteId: string;
  sourceTitle: string;
  targetNoteId: string;
  targetTitle: string;
};

export type ProjectWikiIndexLog = {
  noteId: string;
  noteTitle: string;
  agent: string;
  action: string;
  reason: string | null;
  createdAt: string;
};

export type ProjectWikiIndexUnresolvedLink = {
  sourceNoteId: string;
  sourceTitle: string;
  targetTitle: string;
  reason: "missing" | "ambiguous";
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
  links: ProjectWikiIndexLink[];
  unresolvedLinks: ProjectWikiIndexUnresolvedLink[];
  recentLogs: ProjectWikiIndexLog[];
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
      content: notes.content,
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
  const titleById = new Map(visibleNotes.map((note) => [note.id, note.title]));
  const titleCounts = new Map<string, number>();
  for (const note of visibleNotes) {
    titleCounts.set(note.title, (titleCounts.get(note.title) ?? 0) + 1);
  }
  const links: ProjectWikiIndexLink[] = [];
  let wikiLinkTotal = 0;
  for (const link of linkRows) {
    if (!noteIds.has(link.sourceNoteId) || !noteIds.has(link.targetNoteId)) {
      continue;
    }
    wikiLinkTotal += 1;
    outbound.set(link.sourceNoteId, (outbound.get(link.sourceNoteId) ?? 0) + 1);
    inbound.set(link.targetNoteId, (inbound.get(link.targetNoteId) ?? 0) + 1);
    links.push({
      sourceNoteId: link.sourceNoteId,
      sourceTitle: titleById.get(link.sourceNoteId) ?? link.sourceNoteId,
      targetNoteId: link.targetNoteId,
      targetTitle: titleById.get(link.targetNoteId) ?? link.targetNoteId,
    });
  }

  const unresolvedLinks: ProjectWikiIndexUnresolvedLink[] = [];
  for (const note of visibleNotes) {
    const refs = extractWikiLinkReferences(note.content);
    for (const targetTitle of refs.targetTitles) {
      const count = titleCounts.get(targetTitle) ?? 0;
      if (count === 1) continue;
      unresolvedLinks.push({
        sourceNoteId: note.id,
        sourceTitle: note.title,
        targetTitle,
        reason: count === 0 ? "missing" : "ambiguous",
      });
    }
  }

  const logRows = visibleNotes.length
    ? await db
        .select({
          noteId: wikiLogs.noteId,
          agent: wikiLogs.agent,
          action: wikiLogs.action,
          reason: wikiLogs.reason,
          createdAt: wikiLogs.createdAt,
        })
        .from(wikiLogs)
        .where(inArray(wikiLogs.noteId, [...noteIds]))
        .orderBy(desc(wikiLogs.createdAt))
        .limit(12)
    : [];
  const recentLogs: ProjectWikiIndexLog[] = logRows.map((row) => ({
    noteId: row.noteId,
    noteTitle: titleById.get(row.noteId) ?? row.noteId,
    agent: row.agent,
    action: row.action,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  }));

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
    links: links.sort((a, b) =>
      a.sourceTitle.localeCompare(b.sourceTitle) ||
      a.targetTitle.localeCompare(b.targetTitle),
    ),
    unresolvedLinks: unresolvedLinks.sort((a, b) =>
      a.sourceTitle.localeCompare(b.sourceTitle) ||
      a.targetTitle.localeCompare(b.targetTitle) ||
      a.reason.localeCompare(b.reason),
    ),
    recentLogs,
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
    links: [],
    unresolvedLinks: [],
    recentLogs: [],
    pages: [],
  };
}

export function projectWikiIndexToPrompt(
  index: ProjectWikiIndex,
  opts: { pageLimit?: number; linkLimit?: number; orphanLimit?: number } = {},
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
  if (index.links.length > 0) {
    lines.push("", "Wiki link map:");
    const linkLimit = opts.linkLimit ?? DEFAULT_PROMPT_LINK_LIMIT;
    const limitedLinks =
      typeof linkLimit === "number" ? index.links.slice(0, linkLimit) : index.links;
    for (const link of limitedLinks) {
      lines.push(`- ${link.sourceTitle} -> ${link.targetTitle}`);
    }
  }
  if (index.recentLogs.length > 0) {
    lines.push("", "Recent wiki activity:");
    for (const log of index.recentLogs) {
      const reason = log.reason ? ` - ${log.reason}` : "";
      lines.push(
        `- ${log.createdAt} ${log.agent} ${log.action} ${log.noteTitle}${reason}`,
      );
    }
  }
  if (index.unresolvedLinks.length > 0) {
    lines.push("", "Unresolved wiki links:");
    for (const link of index.unresolvedLinks) {
      lines.push(`- ${link.sourceTitle} -> ${link.targetTitle} (${link.reason})`);
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

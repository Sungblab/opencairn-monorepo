import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

type SeedNote = {
  label: string;
  title: string;
  headingPath: string;
  contextText: string;
  contentText: string;
  tokenCount: number;
  sourceOffsets: { start: number; end: number };
  vectorWeight: number;
  inheritParent: boolean;
  pagePermission: "inherit" | "owner-only";
};

type DbRetrievalManifest = {
  manifestVersion: string;
  cases: Array<{
    id: string;
    query: string;
    ragMode: "strict" | "expand";
    scope: "workspace";
    expectedReadableLabels: string[];
    expectedBlockedLabels: string[];
    expectedRoute: string;
    seed: {
      notes: SeedNote[];
    };
  }>;
};

type JsonlRow = {
  area: "db_backed_retrieval" | "summary";
  caseId: string;
  manifestVersion?: string;
  metrics: Record<string, number | string | boolean>;
  failures: string[];
  notes?: string[];
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const benchmarkRoot = resolve(repoRoot, "apps/api/benchmarks/rag-agent");
const resultRoot = resolve(repoRoot, "apps/api/benchmarks/results");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function git(args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unavailable";
  }
}

function oneHot(index: number, dim = 768): number[] {
  return Array.from({ length: dim }, (_, i) => (i === index ? 1 : 0));
}

function nearQueryVector(weight: number, dim = 768): number[] {
  return Array.from({ length: dim }, (_, i) => {
    if (i === 0) return weight;
    if (i === 1) return 1 - weight;
    return 0;
  });
}

function outputStem(manifestVersion: string): string {
  const slug = manifestVersion
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `rag-db-retrieval-${slug || "manual-run"}`;
}

async function runDbCase(
  fixture: DbRetrievalManifest["cases"][number],
  manifestVersion: string,
): Promise<JsonlRow> {
  if (!process.env.DATABASE_URL) {
    return {
      area: "db_backed_retrieval",
      caseId: fixture.id,
      manifestVersion,
      metrics: { db_enabled: false },
      failures: ["missing_DATABASE_URL"],
      notes: [
        "Set DATABASE_URL against a migrated local Postgres before running this benchmark.",
      ],
    };
  }

  const [
    {
      db,
      user,
      workspaces,
      workspaceMembers,
      projects,
      projectPermissions,
      pagePermissions,
      notes,
      noteChunks,
      eq,
      sql,
    },
    { retrieveWithPolicy },
    { canRead },
  ] = await Promise.all([
    import("@opencairn/db"),
    import("../src/lib/chat-retrieval.js"),
    import("../src/lib/permissions.js"),
  ]);

  const ownerId = `rag-owner-${randomUUID()}`;
  const guestId = `rag-guest-${randomUUID()}`;
  const workspaceId = randomUUID();
  const sharedProjectId = randomUUID();
  const ids = Object.fromEntries(
    fixture.seed.notes.map((note) => [note.label, randomUUID()]),
  ) as Record<string, string>;

  try {
    await db.insert(user).values([
      {
        id: ownerId,
        email: `${ownerId}@example.com`,
        name: "RAG Benchmark Owner",
        emailVerified: false,
      },
      {
        id: guestId,
        email: `${guestId}@example.com`,
        name: "RAG Benchmark Guest",
        emailVerified: false,
      },
    ]);
    await db.insert(workspaces).values({
      id: workspaceId,
      slug: `rag-db-${workspaceId.slice(0, 8)}`,
      name: "RAG DB Benchmark",
      ownerId,
    });
    await db.insert(workspaceMembers).values([
      { workspaceId, userId: ownerId, role: "owner" },
      { workspaceId, userId: guestId, role: "guest", invitedBy: ownerId },
    ]);
    await db.insert(projects).values({
      id: sharedProjectId,
      workspaceId,
      name: "Shared Retrieval Project",
      createdBy: ownerId,
      defaultRole: "viewer",
    });
    await db.insert(projectPermissions).values({
      projectId: sharedProjectId,
      userId: guestId,
      role: "viewer",
      grantedBy: ownerId,
    });
    await db.insert(notes).values(
      fixture.seed.notes.map((note) => ({
        id: ids[note.label],
        workspaceId,
        projectId: sharedProjectId,
        title: note.title,
        contentText: note.contentText,
        type: "source",
        sourceType: "manual",
        embedding: nearQueryVector(note.vectorWeight),
        inheritParent: note.inheritParent,
      })),
    );
    const pagePermissionRows = fixture.seed.notes
      .filter((note) => note.pagePermission === "owner-only")
      .map((note) => ({
        pageId: ids[note.label],
        userId: ownerId,
        role: "viewer",
        grantedBy: ownerId,
      }));
    if (pagePermissionRows.length > 0) {
      await db.insert(pagePermissions).values(pagePermissionRows);
    }
    await db.insert(noteChunks).values(
      fixture.seed.notes.map((note) => ({
        workspaceId,
        projectId: sharedProjectId,
        noteId: ids[note.label],
        chunkIndex: 0,
        headingPath: note.headingPath,
        contextText: note.contextText,
        contentText: note.contentText,
        tokenCount: note.tokenCount,
        sourceOffsets: note.sourceOffsets,
        contentHash: `hash-${ids[note.label]}`,
        embedding: nearQueryVector(note.vectorWeight),
      })),
    );
    await db.execute(sql`
      UPDATE notes
      SET content_tsv = to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content_text, ''))
      WHERE workspace_id = ${workspaceId}
    `);
    await db.execute(sql`
      UPDATE note_chunks
      SET content_tsv = to_tsvector('simple', coalesce(context_text, '') || ' ' || coalesce(content_text, ''))
      WHERE workspace_id = ${workspaceId}
    `);

    const result = await retrieveWithPolicy({
      workspaceId,
      query: fixture.query,
      ragMode: fixture.ragMode,
      scope: { type: "workspace", workspaceId },
      chips: [],
      userId: guestId,
      queryEmbedding: oneHot(0),
    });

    const hitNoteIds = new Set(result.hits.map((hit) => hit.noteId));
    const failures: string[] = [];
    const leakedNoteIds = new Set<string>();
    for (const label of fixture.expectedReadableLabels) {
      if (!ids[label])
        failures.push(`unknown_expected_readable_label:${label}`);
      else if (!hitNoteIds.has(ids[label]))
        failures.push(`missing_expected_readable_hit:${label}`);
    }
    for (const label of fixture.expectedBlockedLabels) {
      if (!ids[label]) {
        failures.push(`unknown_expected_blocked_label:${label}`);
      } else if (hitNoteIds.has(ids[label])) {
        failures.push(`unreadable_hit_leaked:${label}`);
        leakedNoteIds.add(ids[label]);
      }
    }
    const uniqueHitNoteIds = [...hitNoteIds];
    const canReadResults = await Promise.all(
      uniqueHitNoteIds.map(async (noteId) => ({
        noteId,
        readable: await canRead(guestId, { type: "note", id: noteId }),
      })),
    );
    for (const { noteId, readable } of canReadResults) {
      if (!readable) {
        failures.push(`canRead_false_hit:${noteId}`);
        leakedNoteIds.add(noteId);
      }
    }
    if (result.policySummary.route !== fixture.expectedRoute) {
      failures.push(`unexpected_route:${result.policySummary.route}`);
    }

    return {
      area: "db_backed_retrieval",
      caseId: fixture.id,
      manifestVersion,
      metrics: {
        db_enabled: true,
        retrieval_hit_count: result.hits.length,
        permission_leakage_count: leakedNoteIds.size,
        expected_readable_hit_pass: fixture.expectedReadableLabels.every(
          (label) => hitNoteIds.has(ids[label]),
        ),
        blocked_unreadable_hit_pass: fixture.expectedBlockedLabels.every(
          (label) => !hitNoteIds.has(ids[label]),
        ),
        route: result.policySummary.route,
        quality_decision: result.qualityReport.decision,
        retry_applied: result.qualityReport.retryApplied,
      },
      failures,
    };
  } finally {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(user).where(eq(user.id, ownerId));
    await db.delete(user).where(eq(user.id, guestId));
  }
}

async function main(): Promise<void> {
  mkdirSync(resultRoot, { recursive: true });
  const manifest = readJson<DbRetrievalManifest>(
    resolve(benchmarkRoot, "db-backed-retrieval-fixtures.json"),
  );
  const stem = outputStem(manifest.manifestVersion);
  const jsonlOut = resolve(resultRoot, `${stem}.jsonl`);
  const markdownOut = resolve(resultRoot, `${stem}.md`);
  const rows = [];
  for (const fixture of manifest.cases) {
    rows.push(await runDbCase(fixture, manifest.manifestVersion));
  }
  const permissionLeakageCount = rows.reduce(
    (sum, row) => sum + Number(row.metrics.permission_leakage_count ?? 0),
    0,
  );
  const failureCount = rows.reduce((sum, row) => sum + row.failures.length, 0);
  rows.push({
    area: "summary",
    caseId: stem,
    metrics: {
      db_case_count: manifest.cases.length,
      db_enabled: rows.some((row) => row.metrics.db_enabled === true),
      permission_leakage_count: permissionLeakageCount,
      failure_count: failureCount,
    },
    failures: rows.flatMap((row) => row.failures),
  });

  writeFileSync(
    jsonlOut,
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );

  const sha = git(["rev-parse", "HEAD"]);
  const markdown = `# RAG DB Retrieval Benchmark

Manifest version: ${manifest.manifestVersion}

Runner input HEAD: \`${sha}\`

This SHA is captured before the runner rewrites the report artifact. The final
PR or merge commit can differ from this value.

Command:

\`\`\`powershell
$env:DATABASE_URL = "postgresql://USER:PASSWORD@127.0.0.1:15432/DB_NAME"
pnpm --filter @opencairn/api benchmark:rag-db
\`\`\`

Raw JSONL: \`apps/api/benchmarks/results/${stem}.jsonl\`

## Summary

| Metric | Value |
| --- | ---: |
| DB cases | ${manifest.cases.length} |
| DB enabled | ${rows.some((row) => row.metrics.db_enabled === true)} |
| Permission leakage count | ${permissionLeakageCount} |
| Failure count | ${failureCount} |

## Scope

This benchmark seeds real users, workspace membership, project permission, page-level permission overrides, notes, and note chunks. It runs the production \`retrieveWithPolicy()\` path with a deterministic query embedding override so local DB evaluation does not require a live embedding provider.

The first fixture proves that a guest who can read the project still does not receive a note hidden by \`inheritParent=false\` and page-level permissions, even when that hidden chunk is more vector-similar than the readable chunk.
`;
  writeFileSync(markdownOut, markdown);
  console.log(`Wrote ${rows.length} rows to ${jsonlOut}`);
  console.log(`Wrote summary to ${markdownOut}`);
  if (failureCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

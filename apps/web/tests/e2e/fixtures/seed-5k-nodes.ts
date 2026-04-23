import type { APIRequestContext } from "@playwright/test";
import { seedAndSignIn, type SeededSession } from "../helpers/seed-session";

// Perf fixture for the Phase 2 sidebar. Seeds a workspace + project + ~5K
// tree nodes (default split: 500 folders ~3 levels deep, 4500 notes) so
// the Task 15 `@perf` test can measure first-paint virtualization time.
//
// Status: the server-side bulk-seed endpoint isn't implemented yet — the
// test-seed route mints exactly one note per workspace. This wrapper
// stakes out the shape we want so the perf test can switch over the
// moment /api/internal/test-seed-bulk (or equivalent) ships. Callers get
// a runtime error instead of a silently skipped assertion so the perf
// run fails loudly when unwired.

const DEFAULT_API_BASE = process.env.API_BASE ?? "http://localhost:4000";

export interface SeedBulkOptions {
  folders?: number;
  notes?: number;
  maxDepth?: number;
}

export interface BulkSeededSession extends SeededSession {
  folderIds: string[];
  noteIds: string[];
}

export async function seed5kNodes(
  request: APIRequestContext,
  opts: SeedBulkOptions = {},
): Promise<BulkSeededSession> {
  const base = await seedAndSignIn(request);

  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    throw new Error(
      "INTERNAL_API_SECRET not set — required for seed-5k-nodes.",
    );
  }

  const res = await request.post(
    `${DEFAULT_API_BASE}/api/internal/test-seed-bulk`,
    {
      headers: {
        "x-internal-secret": secret,
        "content-type": "application/json",
      },
      data: {
        projectId: base.projectId,
        folders: opts.folders ?? 500,
        notes: opts.notes ?? 4500,
        maxDepth: opts.maxDepth ?? 3,
      },
    },
  );
  if (!res.ok()) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `test-seed-bulk not available: ${res.status()} ${res.statusText()} ${body}. ` +
        "Phase 2 perf test requires this endpoint — implement it in " +
        "apps/api/src/routes/internal.ts before running the @perf suite.",
    );
  }
  const { folderIds, noteIds } = (await res.json()) as {
    folderIds: string[];
    noteIds: string[];
  };
  return { ...base, folderIds, noteIds };
}

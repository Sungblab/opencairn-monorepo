import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
try {
  process.loadEnvFile(resolve(repoRoot, ".env"));
} catch {
  // Environment can be supplied by the caller.
}

async function main() {
  const [
    { db, eq, sql, user, workspaces, synthesisDocuments, synthesisRuns },
    { getBucket, getS3Client },
  ] =
    await Promise.all([import("@opencairn/db"), import("../src/lib/s3")]);

  const workspaceRows = await db
    .select({ id: workspaces.id, slug: workspaces.slug })
    .from(workspaces)
    .where(sql`${workspaces.slug} like 'live-product-%'`);
  const userRows = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(sql`${user.email} like 'live-product-%@example.com'`);

  const objectKeys = new Set<string>(
    (process.env.LIVE_PRODUCT_EXTRA_OBJECT_KEYS ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean),
  );

  for (const row of workspaceRows) {
    objectKeys.add(`synthesis/runs/${row.id}/document.pdf`);
  }

  const documentRows = await db
    .select({ s3Key: synthesisDocuments.s3Key })
    .from(synthesisDocuments)
    .innerJoin(synthesisRuns, eq(synthesisRuns.id, synthesisDocuments.runId))
    .innerJoin(workspaces, eq(workspaces.id, synthesisRuns.workspaceId))
    .where(sql`${workspaces.slug} like 'live-product-%'`);
  for (const row of documentRows) {
    if (row.s3Key) objectKeys.add(row.s3Key);
  }

  let removedObjects = 0;
  const client = getS3Client();
  const bucket = getBucket();
  for (const key of objectKeys) {
    try {
      await client.removeObject(bucket, key);
      removedObjects += 1;
    } catch {
      // Already removed or unavailable; the DB cleanup below is the key part.
    }
  }

  await db.delete(workspaces).where(sql`${workspaces.slug} like 'live-product-%'`);
  await db.delete(user).where(sql`${user.email} like 'live-product-%@example.com'`);

  console.log(
    JSON.stringify(
      {
        removedWorkspaces: workspaceRows,
        removedUsers: userRows,
        removedObjects,
      },
      null,
      2,
    ),
  );
}

main();

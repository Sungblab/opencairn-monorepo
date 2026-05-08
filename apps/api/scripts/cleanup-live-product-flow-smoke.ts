// @ts-nocheck
import { readFile } from "node:fs/promises";
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
  const [{ db, sql, user, workspaces }, { getBucket, getS3Client }] =
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
  try {
    const report = JSON.parse(
      await readFile(
        resolve(repoRoot, "output/playwright/live-product-flow-smoke-report.json"),
        "utf8",
      ),
    );
    for (const key of report?.compiledObjectKeys ?? []) {
      objectKeys.add(key);
    }
  } catch {
    // No report to mine.
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

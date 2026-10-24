// Generic verified owner-test release prefix check.
// The caller supplies an exact pinned release root after package verification.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { lstat, realpath } from "node:fs/promises";

const RELEASE = /^\/opt\/octoport\/ops-releases\/[0-9a-f]{40}$/;

async function main() {
  const url = process.env.DATABASE_URL;
  const release = process.env.OCTOPORT_RELEASE_ROOT;
  if (!url) throw new Error("DATABASE_URL_REQUIRED");
  if (!release || !RELEASE.test(release)) {
    throw new Error("OCTOPORT_RELEASE_ROOT_INVALID");
  }
  for (const path of [
    "/opt",
    "/opt/octoport",
    "/opt/octoport/ops-releases",
    release,
  ]) {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("OCTOPORT_RELEASE_ROOT_INVALID");
    }
  }
  if ((await realpath(release)) !== release) {
    throw new Error("OCTOPORT_RELEASE_ROOT_INVALID");
  }

  const migrationsModule = await import(
    pathToFileURL(resolve(release, "packages/server/db/src/migrations.ts")).href
  );
  const runtimeModule = await import(
    pathToFileURL(resolve(release, "packages/server/db/src/index.ts")).href
  );
  const assertMigrationHistory = migrationsModule.assertMigrationHistory;
  const createDatabaseRuntime = runtimeModule.createDatabaseRuntime;
  if (
    typeof assertMigrationHistory !== "function" ||
    typeof createDatabaseRuntime !== "function"
  ) {
    throw new Error("MIGRATION_CHECK_RUNTIME_INVALID");
  }

  const runtime = createDatabaseRuntime(url);
  try {
    await assertMigrationHistory(
      runtime,
      resolve(release, "packages/server/db/drizzle"),
    );
    const count = await runtime.query<{ count: string; latest: string | null }>(
      "SELECT count(*)::text AS count,max(created_at)::text AS latest FROM drizzle.__drizzle_migrations",
    );
    const applied = Number(count.rows[0]?.count);
    if (!Number.isSafeInteger(applied) || applied < 0) {
      throw new Error("MIGRATION_PREFIX_COUNT_INVALID");
    }
    console.log(
      JSON.stringify({
        status: "PASS_PREFIX",
        applied,
        latest: count.rows[0]?.latest ?? null,
      }),
    );
  } finally {
    await runtime.close();
  }
}
main().catch(() => {
  console.error("PREFIX_CHECK_FAILED");
  process.exitCode = 1;
});

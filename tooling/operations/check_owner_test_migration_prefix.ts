// Exact prepared owner-test release; no imports from a moving worktree.
// This reuses B's canonical migration validator and never authors/applies a migration.
import { assertMigrationHistory } from "/opt/octoport/ops-releases/62024d192a8572c11aafab91653330d1f996699f/packages/server/db/src/migrations.ts";
import { createDatabaseRuntime } from "/opt/octoport/ops-releases/62024d192a8572c11aafab91653330d1f996699f/packages/server/db/src/index.ts";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_REQUIRED");
  const runtime = createDatabaseRuntime(url);
  try {
    await assertMigrationHistory(
      runtime,
      "/opt/octoport/ops-releases/62024d192a8572c11aafab91653330d1f996699f/packages/server/db/drizzle",
    );
    const count = await runtime.query<{ count: string; latest: string | null }>(
      "SELECT count(*)::text AS count,max(created_at)::text AS latest FROM drizzle.__drizzle_migrations",
    );
    console.log(
      JSON.stringify({
        status: "PASS_PREFIX",
        applied: Number(count.rows[0]?.count),
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

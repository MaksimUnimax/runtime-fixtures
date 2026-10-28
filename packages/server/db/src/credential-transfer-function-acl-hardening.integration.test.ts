import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseRuntime, type DatabaseRuntime } from "./index.js";
import { runMigrations } from "./migrations.js";

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "DATABASE_URL is required for real PostgreSQL integration tests.",
  );

let db: DatabaseRuntime;

async function functionAcl() {
  return db.query<{
    name: string;
    public_execute: boolean;
    owner_execute: boolean;
  }>(`
    SELECT p.proname AS name,
      EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(
          coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))
        ) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE'
      ) AS public_execute,
      pg_catalog.has_function_privilege(
        p.proowner,p.oid,'EXECUTE'
      ) AS owner_execute
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='octoport_transfer_fence'
      AND p.proname IN (
        'claim_writer',
        'authorize_writer',
        'guard_transfer_statement',
        'clear_transaction_authorization'
      )
    ORDER BY p.proname
  `);
}

async function journalTail() {
  return db.query<{ count: string; created_at: string; hash: string }>(`
    SELECT
      (SELECT count(*)::text FROM drizzle.__drizzle_migrations) AS count,
      hash,
      created_at::text
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at DESC,id DESC
    LIMIT 1
  `);
}

describe.sequential("credential-transfer function ACL hardening", () => {
  beforeAll(async () => {
    db = createDatabaseRuntime(url);
    await db.ready();
  });

  afterAll(async () => {
    await db.close();
  });

  it("commits 0061 and removes PUBLIC EXECUTE from every fence function", async () => {
    await runMigrations({ connectionString: url });

    const tail = (await journalTail()).rows[0];
    expect(tail?.count).toBe("51");
    expect(tail?.created_at).toBe("1793029560000");
    // Adding 0062 must never erase the previously accepted 0061 ACL hardening.
    const aclMigration = await db.query<{ present: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at=1791907801000) AS present",
    );
    expect(aclMigration.rows[0]?.present).toBe(true);

    const acl = await functionAcl();
    expect(acl.rows).toHaveLength(4);
    expect(acl.rows.map((row) => row.name)).toEqual([
      "authorize_writer",
      "claim_writer",
      "clear_transaction_authorization",
      "guard_transfer_statement",
    ]);
    expect(acl.rows.every((row) => row.public_execute === false)).toBe(true);
    expect(acl.rows.every((row) => row.owner_execute === true)).toBe(true);

    const first = {
      journal: tail,
      acl: acl.rows,
    };
    await runMigrations({ connectionString: url });
    expect({
      journal: (await journalTail()).rows[0],
      acl: (await functionAcl()).rows,
    }).toEqual(first);
  });
});

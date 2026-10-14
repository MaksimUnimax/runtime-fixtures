import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DatabaseQuery,
  DatabaseRuntime,
} from "../../../../packages/server/db/src/index.js";
import { resetTransferProtectedTestFixture } from "./credential-transfer-fixture-reset.js";

const RESET = "TRUNCATE audit_events,accounts,users CASCADE";

function fixture(
  options: {
    database?: string;
    superuser?: boolean;
    directSession?: boolean;
    guardEnabled?: boolean;
    badClaim?: boolean;
    failReset?: boolean;
  } = {},
) {
  const calls: string[] = [];
  let authorized = false;
  const query: DatabaseQuery["query"] = async (sql, values) => {
    calls.push(sql);
    let rows: Record<string, unknown>[] = [];
    if (sql.includes("current_database()")) {
      rows = [
        {
          database_name: options.database ?? "octoport_c_test",
          is_superuser: options.superuser ?? true,
          direct_session: options.directSession ?? true,
        },
      ];
    } else if (sql.includes("FROM pg_trigger")) {
      rows = [{ guard_enabled: options.guardEnabled ?? true }];
    } else if (sql.includes("claim_writer(")) {
      rows = [
        {
          epoch: "21",
          owner_instance_id: options.badClaim ? "wrong" : values?.[0],
        },
      ];
    } else if (sql.includes("authorize_writer(")) {
      authorized = true;
      rows = [{ epoch: values?.[0], owner_instance_id: values?.[1] }];
    } else if (sql.startsWith("TRUNCATE")) {
      if (!authorized) throw new Error("TEST_RESET_WITHOUT_AUTHORIZATION");
      if (options.failReset) throw new Error("INTENTIONAL_RESET_FAILURE");
    }
    return { rows: rows as never[] };
  };
  const database = {
    transaction: async <T>(operation: (tx: DatabaseQuery) => Promise<T>) =>
      operation({ query }),
  } as Pick<DatabaseRuntime, "transaction">;
  return { database, calls };
}

describe("fenced integration-only fixture reset", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("supports original RESTART IDENTITY CASCADE fixture semantics", async () => {
    const sql = "TRUNCATE accounts,users RESTART IDENTITY CASCADE";
    const f = fixture();
    await resetTransferProtectedTestFixture(f.database, sql);
    expect(f.calls[4]).toBe(sql);
  });
  it.each(["octoport_a_test", "octoport_b_test", "seller_agents_i1_client"])(
    "does not touch other role-owned database %s",
    async (name) => {
      const f = fixture({ database: name });
      await expect(
        resetTransferProtectedTestFixture(f.database, RESET),
      ).rejects.toThrow("TRANSFER_FIXTURE_RESET_DATABASE_OR_ROLE_DENIED");
      expect(f.calls).toHaveLength(1);
    },
  );
  it("requires exact Server CI GitHub context for product_control_plane_test", async () => {
    const f = fixture({ database: "product_control_plane_test" });
    vi.stubEnv("GITHUB_ACTIONS", "true");
    vi.stubEnv("CI", "true");
    vi.stubEnv("GITHUB_REPOSITORY", "wrong/repository");
    await expect(
      resetTransferProtectedTestFixture(f.database, RESET),
    ).rejects.toThrow("TRANSFER_FIXTURE_RESET_DATABASE_OR_ROLE_DENIED");
    expect(f.calls).toHaveLength(1);
    vi.stubEnv("GITHUB_REPOSITORY", "MaksimUnimax/runtime-fixtures");
    await resetTransferProtectedTestFixture(f.database, RESET);
    expect(f.calls.at(-1)).toBe(RESET);
  });
  it("uses the real epoch claim, authorization, and unchanged TRUNCATE in one transaction", async () => {
    const f = fixture();
    await resetTransferProtectedTestFixture(f.database, RESET);
    expect(f.calls).toHaveLength(5);
    expect(f.calls[0]).toContain("current_database()");
    expect(f.calls[1]).toContain("credential_transfer_epoch_guard");
    expect(f.calls[2]).toContain("claim_writer(");
    expect(f.calls[3]).toContain("authorize_writer(");
    expect(f.calls[4]).toBe(RESET);
    expect(f.calls.join(" ")).not.toMatch(
      /DISABLE TRIGGER|DROP TRIGGER|GRANT /i,
    );
  });
  it.each([
    ["not allowlisted", { database: "production" }],
    ["foreign A role database", { database: "octoport_a_test" }],
    ["foreign B role database", { database: "octoport_b_test" }],
    ["Tester database", { database: "seller_agents_i1_client" }],
    ["not superuser", { superuser: false }],
    ["role changed", { directSession: false }],
  ])("refuses unsafe %s before claim or reset", async (_name, options) => {
    const f = fixture(options);
    await expect(
      resetTransferProtectedTestFixture(f.database, RESET),
    ).rejects.toThrow("TRANSFER_FIXTURE_RESET_DATABASE_OR_ROLE_DENIED");
    expect(f.calls).toHaveLength(1);
  });
  it("rejects an inactive guard before claiming", async () => {
    const f = fixture({ guardEnabled: false });
    await expect(
      resetTransferProtectedTestFixture(f.database, RESET),
    ).rejects.toThrow("TRANSFER_FIXTURE_RESET_GUARD_NOT_ACTIVE");
    expect(f.calls).toHaveLength(2);
  });
  it("rejects an invalid epoch claim", async () => {
    const f = fixture({ badClaim: true });
    await expect(
      resetTransferProtectedTestFixture(f.database, RESET),
    ).rejects.toThrow("TRANSFER_FIXTURE_RESET_CLAIM_INVALID");
    expect(f.calls).toHaveLength(3);
  });
  it.each([
    "DELETE FROM users",
    "TRUNCATE users CASCADE; DROP TABLE users",
    "TRUNCATE drizzle.__drizzle_migrations CASCADE",
    "TRUNCATE octoport_transfer_fence.writer_epoch CASCADE",
    "TRUNCATE public.users CASCADE",
    "TRUNCATE unauthorized_table CASCADE",
    "TRUNCATE users,unauthorized_table CASCADE",
    "TRUNCATE users,users CASCADE",
  ])(
    "rejects non-TRUNCATE or multi-statement input before connecting: %s",
    async (sql) => {
      const f = fixture();
      await expect(
        resetTransferProtectedTestFixture(f.database, sql),
      ).rejects.toThrow("TRANSFER_FIXTURE_RESET_SQL_NOT_ALLOWED");
      expect(f.calls).toEqual([]);
    },
  );
  it("propagates fixture reset failures rather than pretending a pass", async () => {
    const f = fixture({ failReset: true });
    await expect(
      resetTransferProtectedTestFixture(f.database, RESET),
    ).rejects.toThrow("INTENTIONAL_RESET_FAILURE");
    expect(f.calls).toHaveLength(5);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DatabaseQuery,
  DatabaseRuntime,
} from "../../../../packages/server/db/src/index.js";
import { createCredentialTransferTestAuthority } from "./credential-transfer-test-authority.js";

/** Fault injection for fixture cleanup only; not a database security proof. */
function fakeAdministrator() {
  let roleExists = false;
  let owner = "";
  let dropFailures = 0;
  let elections = 0;
  const query: DatabaseQuery["query"] = async <
    T extends Record<string, unknown>,
  >(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }> => {
    let rows: Record<string, unknown>[] = [];
    if (text.includes("current_database() AS database_name")) {
      rows = [
        {
          database_name: "octoport_c_test",
          is_superuser: true,
          direct_session: true,
        },
      ];
    } else if (
      text.startsWith("SELECT count(*)::text AS count FROM pg_roles")
    ) {
      rows = [{ count: roleExists ? "1" : "0" }];
    } else if (text.startsWith("CREATE ROLE")) {
      roleExists = true;
    } else if (text.startsWith("DROP ROLE")) {
      if (dropFailures > 0) {
        dropFailures -= 1;
        throw new Error("INJECTED_DROP_FAILURE");
      }
      roleExists = false;
    } else if (text.includes("WITH caller AS")) {
      const keys = [
        "direct_session_identity",
        "restricted_role",
        "expected_relations",
        "epoch_structure",
        "transaction_context_structure",
        "safe_functions",
        "cannot_assume_owner",
        "private_schema_usage_only",
        "can_call_entry_functions",
        "no_direct_epoch_mutation",
        "cannot_truncate_requests",
        "functions_not_public",
        "mandatory_statement_trigger",
      ];
      rows = [Object.fromEntries(keys.map((k) => [k, true]))];
    } else if (
      text.trimStart().startsWith("SELECT epoch") &&
      text.includes(".claim_writer(")
    ) {
      owner = String(values?.[0]);
      elections += 1;
      rows = [{ epoch: "2", owner_instance_id: owner }];
    } else if (
      text.trimStart().startsWith("SELECT epoch") &&
      text.includes(".authorize_writer(")
    ) {
      rows = [{ epoch: "2", owner_instance_id: owner }];
    }
    return { rows: rows as T[] };
  };
  const database = {
    query,
    transaction: async <T>(action: (tx: DatabaseQuery) => Promise<T>) =>
      action({ query }),
  } as unknown as DatabaseRuntime;
  return {
    database,
    roleExists: () => roleExists,
    elections: () => elections,
    failNextDrop: () => {
      dropFailures = 1;
    },
  };
}

afterEach(() => vi.useRealTimers());
describe("test authority cleanup can recover without reviving business admission", () => {
  it("retries cleanup explicitly after a bounded drain timeout, never election or business", async () => {
    vi.useFakeTimers();
    const fake = fakeAdministrator();
    const authority = await createCredentialTransferTestAuthority(
      fake.database,
      "octoport_c_test",
    );
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => {
      enter = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const work = vi.fn(async () => {
      enter();
      await gate;
      return "completed";
    });
    const pending = authority.transaction(work);
    await entered;
    const first = authority.dispose();
    const failed = expect(first).rejects.toThrow(
      "TRANSFER_TEST_ACTIVE_OPERATIONS_DID_NOT_FINISH",
    );
    await vi.advanceTimersByTimeAsync(8_001);
    await failed;
    expect(fake.roleExists()).toBe(true);
    expect(authority.isActive()).toBe(false);
    const forbidden = vi.fn(async () => "never");
    await expect(authority.transaction(forbidden)).rejects.toMatchObject({
      code: "TRANSFER_CONFLICT",
    });
    release();
    expect(await pending).toBe("completed");
    await authority.dispose();
    expect(fake.roleExists()).toBe(false);
    expect(authority.isActive()).toBe(false);
    expect(work).toHaveBeenCalledTimes(1);
    expect(forbidden).not.toHaveBeenCalled();
    expect(fake.elections()).toBe(1);
  });
  it("retries only failed role cleanup after a reported database error", async () => {
    const fake = fakeAdministrator();
    const authority = await createCredentialTransferTestAuthority(
      fake.database,
      "octoport_c_test",
    );
    fake.failNextDrop();
    await expect(authority.dispose()).rejects.toThrow("INJECTED_DROP_FAILURE");
    expect(fake.roleExists()).toBe(true);
    expect(authority.isActive()).toBe(false);
    await authority.dispose();
    await authority.dispose();
    expect(fake.roleExists()).toBe(false);
    expect(fake.elections()).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { createFeedbackSupportRepository } from "./feedback-support-repository.js";
import type { DatabaseRuntime } from "./index.js";

const userId = "00000000-0000-4000-8000-000000000081";
const accountId = "00000000-0000-4000-8000-000000000082";
const caseId = "00000000-0000-4000-8000-000000000083";
const signalId = "00000000-0000-4000-8000-000000000084";

function fixture(hasAccess: boolean) {
  const sqlCalls: string[] = [];
  let lockHeldAtMembershipCheck = false;
  let revokeCommittedBeforeFeedbackWrite = false;
  let wroteFeedback = false;
  let revocationCanCommit = false;
  let transactions = 0;

  const caseRow = {
    id: caseId,
    account_id: accountId,
    created_by_user_id: userId,
    device_id: null,
    created_at: "2026-10-15T00:00:00.000Z",
    updated_at: "2026-10-15T00:00:00.000Z",
    category: "OTHER",
    severity: "LOW",
    status: "NEW",
    description: "Synthetic created-before-revocation case",
    diagnostics: null,
    server_version: null,
    portal_version: null,
    extension_version: null,
    browser_family: null,
    browser_version: null,
    marketplace: "NONE",
    support_code: null,
    release_identity: null,
    assigned_admin_principal_id: null,
    resolution_code: null,
  };

  const checkedMembership = (sql: string) => {
    lockHeldAtMembershipCheck = sql.includes("FOR SHARE OF m,a");
    // Simulate a concurrent DELETE from account_memberships / account
    // suspension immediately after this SELECT has returned.
    // A plain SELECT allows revocation to commit before feedback INSERT.
    revocationCanCommit = hasAccess && !lockHeldAtMembershipCheck;
    return { rows: hasAccess ? [{ id: accountId }] : [] };
  };
  const query = async (sql: string): Promise<{ rows: unknown[] }> => {
    sqlCalls.push(sql);
    if (sql.startsWith("SELECT a.id FROM accounts"))
      return checkedMembership(sql);
    if (sql.startsWith("SELECT m.id FROM account_memberships"))
      return checkedMembership(sql);
    if (sql.startsWith("INSERT INTO auth_rate_limit_buckets"))
      return { rows: [{ count: 1 }] };
    if (
      sql.startsWith("INSERT INTO feedback_cases(") ||
      sql.startsWith("INSERT INTO feedback_signal_events(")
    ) {
      wroteFeedback = true;
      if (revocationCanCommit) revokeCommittedBeforeFeedbackWrite = true;
      return {
        rows: sql.startsWith("INSERT INTO feedback_cases(")
          ? [caseRow]
          : [{ id: signalId }],
      };
    }
    if (sql.startsWith("INSERT INTO audit_events(")) return { rows: [] };
    if (sql.startsWith("SELECT pg_advisory_xact_lock(")) return { rows: [] };
    if (sql.startsWith("SELECT id FROM feedback_signal_events"))
      return { rows: [] };
    throw new Error("UNEXPECTED_SYNTHETIC_SQL: " + sql.slice(0, 85));
  };
  const tx = { query };
  const runtime = {
    transaction: async (run: (value: typeof tx) => Promise<unknown>) => {
      transactions += 1;
      return run(tx);
    },
  } as unknown as DatabaseRuntime;
  return {
    repository: createFeedbackSupportRepository(runtime),
    sqlCalls,
    get lockHeld() {
      return lockHeldAtMembershipCheck;
    },
    get staleWritePossible() {
      return revokeCommittedBeforeFeedbackWrite;
    },
    get wrote() {
      return wroteFeedback;
    },
    get transactions() {
      return transactions;
    },
  };
}

async function createCase(test: ReturnType<typeof fixture>) {
  return test.repository.createCase({
    userId,
    body: {
      accountId,
      category: "OTHER",
      severity: "LOW",
      marketplace: "NONE",
      description: "Synthetic test only",
    },
    description: "Synthetic test only",
    diagnostics: null,
    correlationId: "synthetic-case-lease",
  });
}

async function recordSignal(test: ReturnType<typeof fixture>) {
  return test.repository.recordSignal({
    userId,
    body: {
      accountId,
      event: "first_start",
      idempotencyKey: "synthetic-account-write-lease",
    },
    correlationId: "synthetic-signal-lease",
  });
}

describe("B06 active account lease protects final feedback writes (synthetic)", () => {
  it.each(["createCase", "recordSignal"] as const)(
    "holds the membership/account SHARE lock until the %s insert commits",
    async (operation) => {
      const run = fixture(true);
      const result =
        operation === "createCase"
          ? await createCase(run)
          : await recordSignal(run);
      expect(result).toBeDefined();
      expect(run.transactions).toBe(1);
      expect(run.wrote).toBe(true);
      expect(run.lockHeld).toBe(true);
      expect(run.staleWritePossible).toBe(false);
      expect(run.sqlCalls.some((sql) => sql.includes("FOR SHARE OF m,a"))).toBe(
        true,
      );
    },
  );

  it.each(["createCase", "recordSignal"] as const)(
    "rejects the %s write for an already revoked membership",
    async (operation) => {
      const run = fixture(false);
      const result =
        operation === "createCase"
          ? await createCase(run)
          : await recordSignal(run);
      expect(result).toEqual(
        operation === "createCase" ? { kind: "ACCOUNT_FORBIDDEN" } : "CONFLICT",
      );
      expect(run.wrote).toBe(false);
    },
  );
});

import { describe, expect, it } from "vitest";
import { createFeedbackSupportRepository } from "./feedback-support-repository.js";
import type { DatabaseRuntime } from "./index.js";

const userId = "00000000-0000-4000-8000-000000000071";
const caseId = "00000000-0000-4000-8000-000000000072";
const accountId = "00000000-0000-4000-8000-000000000073";
const followupId = "00000000-0000-4000-8000-000000000074";

type AccessState = "ACTIVE" | "MEMBERSHIP_REMOVED" | "ACCOUNT_SUSPENDED";

function fixture(accessState: AccessState) {
  const statements: string[] = [];
  const row = {
    id: caseId,
    account_id: accountId,
    created_by_user_id: userId,
    device_id: null,
    created_at: "2026-10-15T00:00:00.000Z",
    updated_at: "2026-10-15T00:00:00.000Z",
    category: "OTHER",
    severity: "LOW",
    status: "NEW",
    description: "Synthetic support case for revoked membership test",
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
  const hasAccess = accessState === "ACTIVE";
  const query = async (sql: string) => {
    statements.push(sql);
    if (sql.includes("FROM feedback_cases")) {
      if (sql.includes("ORDER BY created_at DESC")) {
        return { rows: !sql.includes("EXISTS") || hasAccess ? [row] : [] };
      }
      return { rows: [row] };
    }
    if (sql.includes("FROM account_memberships")) {
      return { rows: hasAccess ? [{ id: accountId }] : [] };
    }
    if (sql.includes("FROM feedback_followups")) return { rows: [] };
    if (sql.startsWith("INSERT INTO auth_rate_limit_buckets"))
      return { rows: [{ count: 1 }] };
    if (sql.startsWith("INSERT INTO feedback_followups"))
      return {
        rows: [
          {
            id: followupId,
            author_type: "USER",
            body: "Synthetic message",
            created_at: "2026-10-15T00:00:00.000Z",
          },
        ],
      };
    if (sql.startsWith("UPDATE feedback_cases SET updated_at"))
      return { rows: [] };
    throw new Error("UNEXPECTED_SYNTHETIC_SQL: " + sql.slice(0, 90));
  };
  const tx = { query };
  const db = {
    query,
    transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as DatabaseRuntime;
  return { repository: createFeedbackSupportRepository(db), statements };
}

describe("B06 revoked account membership fences support case access (synthetic, no DB)", () => {
  it.each(["MEMBERSHIP_REMOVED", "ACCOUNT_SUSPENDED"] as const)(
    "denies list, detail and user mutation after %s with no side effects",
    async (accessState) => {
      const { repository, statements } = fixture(accessState);
      const listed = await repository.listOwnCases({ userId });
      const detail = await repository.getOwnCase({ userId, caseId });
      const followup = await repository.addFollowup({
        actorType: "USER",
        actorId: userId,
        caseId,
        body: "Synthetic message",
        correlationId: "synthetic-revoked-membership",
      });
      expect({ listed, detail, followup }).toEqual({
        listed: [],
        detail: { kind: "FORBIDDEN" },
        followup: { kind: "FORBIDDEN" },
      });
      expect(
        statements.filter((sql) =>
          /INSERT INTO feedback_followups|INSERT INTO auth_rate_limit_buckets|UPDATE feedback_cases SET updated_at/u.test(
            sql,
          ),
        ),
      ).toEqual([]);
    },
  );

  it("preserves listing, detail and user followup for an active member", async () => {
    const { repository, statements } = fixture("ACTIVE");
    const listed = await repository.listOwnCases({ userId });
    expect(listed).toHaveLength(1);
    const detail = await repository.getOwnCase({ userId, caseId });
    expect("kind" in detail).toBe(false);
    const reply = await repository.addFollowup({
      actorType: "USER",
      actorId: userId,
      caseId,
      body: "Synthetic message",
      correlationId: "synthetic-active-membership",
    });
    expect("kind" in reply).toBe(false);
    expect(
      statements.some((sql) =>
        sql.startsWith("INSERT INTO feedback_followups"),
      ),
    ).toBe(true);
    const lockedAccountChecks = statements.filter((sql) =>
      sql.startsWith("SELECT m.id FROM account_memberships"),
    );
    expect(lockedAccountChecks).toHaveLength(2);
    for (const sql of lockedAccountChecks) {
      expect(sql).toContain("a.status='ACTIVE'");
      expect(sql).toContain("FOR SHARE OF m,a");
    }
  });
});

import { describe, expect, it } from "vitest";
import { createFeedbackSupportRepository } from "./feedback-support-repository.js";
import type { DatabaseRuntime } from "./index.js";

const CASE_ID = "00000000-0000-4000-8000-000000000051";
const SUPPORT_ID = "00000000-0000-4000-8000-000000000052";
const ACCOUNT_ID = "00000000-0000-4000-8000-000000000053";
const TOMBSTONE = "[Feedback removed after account deletion]";

function fixture(anonymized: boolean) {
  const statements: string[] = [];
  const originalCase = {
    id: CASE_ID,
    account_id: anonymized ? null : ACCOUNT_ID,
    created_by_user_id: anonymized
      ? null
      : "00000000-0000-4000-8000-000000000054",
    device_id: null,
    created_at: "2026-10-15T00:00:00.000Z",
    updated_at: "2026-10-15T00:00:00.000Z",
    category: "OTHER",
    severity: "LOW",
    status: "NEW",
    description: anonymized ? TOMBSTONE : "Synthetic active case",
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
  const query = async (sql: string): Promise<{ rows: unknown[] }> => {
    statements.push(sql);
    if (sql.startsWith("SELECT status FROM admin_principals"))
      return { rows: [{ status: "ACTIVE" }] };
    if (sql.startsWith("SELECT role FROM admin_role_grants"))
      return { rows: [{ role: "ADMIN_SUPPORT" }] };
    if (sql.startsWith("SELECT id,account_id,created_by_user_id"))
      return { rows: [originalCase] };
    if (sql.startsWith("UPDATE feedback_cases SET status="))
      return { rows: [{ ...originalCase, status: "TRIAGED" }] };
    if (sql.startsWith("INSERT INTO audit_events")) return { rows: [] };
    if (sql.startsWith("INSERT INTO feedback_signal_events"))
      return { rows: [{ id: "00000000-0000-4000-8000-000000000055" }] };
    if (
      sql.startsWith(
        "SELECT id,author_type,body,created_at FROM feedback_followups",
      )
    )
      return { rows: [] };
    throw new Error("UNEXPECTED_FAKE_SQL: " + sql.slice(0, 80));
  };
  const tx = { query };
  const runtime = {
    query,
    transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as DatabaseRuntime;
  return { repository: createFeedbackSupportRepository(runtime), statements };
}

describe("B06 anonymized support case status guard (synthetic, no PostgreSQL)", () => {
  it("refuses status mutation and side effects after account anonymization", async () => {
    const { repository, statements } = fixture(true);
    const result = await repository.transitionCase({
      actorType: "SUPPORT",
      actorId: SUPPORT_ID,
      caseId: CASE_ID,
      status: "TRIAGED",
      correlationId: "synthetic-anonymized-case",
    });
    expect(result).toEqual({ kind: "FORBIDDEN" });
    expect(
      statements.filter((sql) =>
        /UPDATE feedback_cases SET status=|INSERT INTO audit_events|INSERT INTO feedback_signal_events/u.test(
          sql,
        ),
      ),
    ).toEqual([]);
  });

  it("preserves an authorized status transition for an ordinary active case", async () => {
    const { repository, statements } = fixture(false);
    const result = await repository.transitionCase({
      actorType: "SUPPORT",
      actorId: SUPPORT_ID,
      caseId: CASE_ID,
      status: "TRIAGED",
      correlationId: "synthetic-active-case",
    });
    expect("kind" in result).toBe(false);
    if ("kind" in result) return;
    expect(result.status).toBe("TRIAGED");
    expect(
      statements.some((sql) =>
        sql.startsWith("UPDATE feedback_cases SET status="),
      ),
    ).toBe(true);
  });
});

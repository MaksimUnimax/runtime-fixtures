import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FeedbackSupportService } from "@product/feedback-support";
import {
  createFeedbackSupportRepository,
  createDatabaseRuntime,
  type DatabaseRuntime,
} from "./index.js";
import { runMigrations } from "./migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

describe.sequential("B2 PostgreSQL feedback/support persistence", () => {
  let runtime: DatabaseRuntime;
  let service: FeedbackSupportService;
  let userId: string;
  let otherUserId: string;
  let accountId: string;

  beforeAll(async () => {
    runtime = createDatabaseRuntime(connectionString!);
    await runtime.ready();
    await runMigrations({ connectionString: connectionString! });
    service = new FeedbackSupportService(
      createFeedbackSupportRepository(runtime),
    );
  });

  beforeEach(async () => {
    await runtime.query(
      "TRUNCATE feedback_followups,feedback_cases,feedback_signal_events,auth_rate_limit_buckets RESTART IDENTITY CASCADE",
    );
    userId = randomUUID();
    otherUserId = randomUUID();
    accountId = randomUUID();
    await runtime.query("INSERT INTO users(id) VALUES($1),($2)", [
      userId,
      otherUserId,
    ]);
    await runtime.query("INSERT INTO accounts(id) VALUES($1)", [accountId]);
    await runtime.query(
      "INSERT INTO account_memberships(account_id,user_id,role) VALUES($1,$2,'OWNER')",
      [accountId, userId],
    );
  });

  afterAll(async () => runtime.close());

  it("isolates cases, redacts obvious secrets, writes safe audit metadata, and aggregates without bodies", async () => {
    const created = await service.createCase(userId, {
      accountId,
      category: "AUTH",
      description:
        "<script>alert(1)</script> Bearer abcdefghijklmnopqrstuvwxyz123456",
      diagnostics: { productVersion: "0.2.4", capabilityState: "AUTH" },
      extensionVersion: "0.2.4",
      browserFamily: "Opera",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.description).not.toContain(
      "abcdefghijklmnopqrstuvwxyz123456",
    );
    const own = await service.getOwnCase({
      userId,
      caseId: created.value.caseId,
    });
    expect(own.ok).toBe(true);
    const other = await service.getOwnCase({
      userId: otherUserId,
      caseId: created.value.caseId,
    });
    expect(other).toEqual({ ok: false, code: "FORBIDDEN" });

    const triaged = await service.transitionCase(
      "SUPPORT",
      randomUUID(),
      created.value.caseId,
      { status: "TRIAGED" },
    );
    expect(triaged.ok).toBe(true);
    const resolved = await service.transitionCase(
      "SUPPORT",
      randomUUID(),
      created.value.caseId,
      { status: "RESOLVED", resolutionCode: "FIXED" },
    );
    expect(resolved.ok).toBe(true);
    const invalid = await service.transitionCase(
      "SUPPORT",
      randomUUID(),
      created.value.caseId,
      { status: "NEW" },
    );
    expect(invalid).toEqual({ ok: false, code: "INVALID_TRANSITION" });

    const aggregate = await service.aggregateSignals({ category: "AUTH" });
    expect(aggregate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "feedback_case_created",
          category: "AUTH",
          count: 1,
        }),
        expect.objectContaining({
          event: "feedback_case_resolved",
          category: "AUTH",
          count: 1,
        }),
      ]),
    );
    const audit = await runtime.query<{
      safe_metadata: Record<string, unknown> | null;
    }>(
      "SELECT safe_metadata FROM audit_events WHERE target_type='FEEDBACK_CASE' ORDER BY created_at",
    );
    expect(JSON.stringify(audit.rows)).not.toContain("alert(1)");
    expect(JSON.stringify(audit.rows)).not.toContain(
      "abcdefghijklmnopqrstuvwxyz123456",
    );
    const stored = await runtime.query<{
      description: string;
      diagnostics: unknown;
    }>("SELECT description,diagnostics FROM feedback_cases WHERE id=$1", [
      created.value.caseId,
    ]);
    expect(stored.rows[0]!.description).not.toContain(
      "abcdefghijklmnopqrstuvwxyz123456",
    );
    expect(JSON.stringify(stored.rows[0]!.diagnostics)).not.toContain(
      "storageState",
    );
  });

  it("supports account anonymization and configurable retention deletion", async () => {
    const created = await service.createCase(userId, {
      accountId,
      category: "OTHER",
      description: "remove me",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await service.transitionCase("ADMIN", randomUUID(), created.value.caseId, {
      status: "TRIAGED",
    });
    await service.transitionCase("ADMIN", randomUUID(), created.value.caseId, {
      status: "RESOLVED",
    });
    await service.transitionCase("ADMIN", randomUUID(), created.value.caseId, {
      status: "CLOSED",
    });
    const anonymized = await service.anonymizeAccount(accountId);
    expect(anonymized.cases).toBe(1);
    const row = await runtime.query<{
      account_id: string | null;
      description: string;
      diagnostics: unknown;
    }>(
      "SELECT account_id,description,diagnostics FROM feedback_cases WHERE id=$1",
      [created.value.caseId],
    );
    expect(row.rows[0]).toEqual({
      account_id: null,
      description: "[Feedback removed after account deletion]",
      diagnostics: null,
    });
    await runtime.query(
      "UPDATE feedback_cases SET updated_at='2020-01-01T00:00:00Z' WHERE id=$1",
      [created.value.caseId],
    );
    const purged = await service.purgeExpired({
      now: new Date("2030-01-01T00:00:00.000Z"),
      closedRetentionDays: 1,
      signalRetentionDays: 1,
    });
    expect(purged.cases).toBe(1);
  });

  it("stores one account milestone under concurrent retry and calculates an isolated funnel", async () => {
    const key = "registration-started-integration-1";
    const payload = {
      event: "registration_started" as const,
      accountId,
      idempotencyKey: key,
      productVersion: "0.2.4",
      extensionVersion: "0.2.4",
      browserFamily: "Opera",
      browserVersion: "136",
      releaseIdentity: "rc-1",
    };
    const results = await Promise.all([
      service.recordSignal(userId, payload),
      service.recordSignal(userId, payload),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    const accountCreated = await service.recordSignal(userId, {
      event: "account_created",
      accountId,
      idempotencyKey: "account-created-integration-1",
      productVersion: "0.2.4",
    });
    expect(accountCreated.ok).toBe(true);
    const funnel = await service.aggregateFunnel({
      funnel: "ONBOARDING",
      from: "2026-01-01T00:00:00.000Z",
      to: "2030-01-01T00:00:00.000Z",
    });
    expect(funnel.cohortCount).toBe(1);
    expect(funnel.stages[0]!.reachedCount).toBe(1);
    const rows = await runtime.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM feedback_signal_events WHERE account_id=$1 AND event='registration_started'",
      [accountId],
    );
    expect(rows.rows[0]!.count).toBe("1");
    const anonymized = await service.anonymizeAccount(accountId);
    expect(anonymized.signals).toBeGreaterThanOrEqual(2);
    const remaining = await runtime.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM feedback_signal_events WHERE account_id=$1",
      [accountId],
    );
    expect(remaining.rows[0]!.count).toBe("0");
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ADMIN_AUDIT_RETENTION_CATEGORY,
  createAuditRetentionRepository,
} from "./audit-retention-repository.js";
import { createDatabaseRuntime, type DatabaseRuntime } from "./index.js";
import { runMigrations } from "./migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const retentionTargets: Record<string, string> = {
  P7_ADMIN_ADAPTER_CREATED: "AI_ADAPTER",
  P7_ADMIN_ADAPTER_UPDATED: "AI_ADAPTER",
  P7_ADMIN_SURFACE_CREATED: "AI_SURFACE",
  P7_ADMIN_SURFACE_UPDATED: "AI_SURFACE",
  P7_ADMIN_VARIANT_CREATED: "AI_VARIANT",
  P7_ADMIN_VARIANT_UPDATED: "AI_VARIANT",
  P7_ADMIN_PROFILE_CREATED: "ADAPTER_PROFILE",
  P7_ADMIN_PROFILE_UPDATED: "ADAPTER_PROFILE",
};

describe.sequential("administrative audit retention", () => {
  let runtime: DatabaseRuntime;
  const prefix = `audit-retention-test:${randomUUID()}:`;
  const correlationIds: string[] = [];
  const repository = () => createAuditRetentionRepository(runtime);

  beforeAll(async () => {
    runtime = createDatabaseRuntime(connectionString!);
    await runtime.ready();
    await runMigrations({ connectionString: connectionString! });
  });

  afterEach(async () => {
    if (runtime) {
      for (const correlationId of correlationIds.splice(0))
        await runtime.query(
          "DELETE FROM audit_events WHERE correlation_id=$1",
          [correlationId],
        );
    }
  });

  afterAll(async () => runtime.close());

  async function insert(
    action: string,
    createdAt: Date,
    marker = "expired payload marker",
    actorType = "ADMIN",
    targetType = retentionTargets[action] ?? "TEST",
  ): Promise<string> {
    const correlationId = `${prefix}${randomUUID()}`;
    correlationIds.push(correlationId);
    await runtime.query(
      `INSERT INTO audit_events(actor_type,action,target_type,correlation_id,reason,safe_metadata,created_at)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        actorType,
        action,
        targetType,
        correlationId,
        marker,
        JSON.stringify({ marker }),
        createdAt,
      ],
    );
    return correlationId;
  }

  it("deletes only explicitly allowlisted operational admin actions in bounded count-only batches", async () => {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60_000);
    const expired = new Date(cutoff.getTime() - 1);
    const atCutoff = await insert("P7_ADMIN_ADAPTER_CREATED", cutoff);
    const recent = await insert(
      "P7_ADMIN_SURFACE_UPDATED",
      new Date(cutoff.getTime() + 1),
    );
    const eligible = await Promise.all([
      insert("P7_ADMIN_ADAPTER_CREATED", expired, "secret-one"),
      insert("P7_ADMIN_PROFILE_UPDATED", expired, "secret-two"),
      insert("P7_ADMIN_VARIANT_CREATED", expired, "secret-three"),
    ]);
    correlationIds.push(`audit-retention:${cutoff.toISOString()}`);
    const protectedActions = [
      "ADMIN_OWNER_BOOTSTRAPPED",
      "ADMIN_SESSION_CREATED",
      "ADMIN_SESSION_REVOKED",
      "ADMIN_PRINCIPAL_CREATED",
      "ADMIN_ROLE_GRANTED",
      "ADMIN_ROLE_REVOKED",
      "ADMIN_PRINCIPAL_SUSPENDED",
      "ADMIN_PRINCIPAL_RESTORED",
      "BETA_ADMISSION_CHANGED",
      "BETA_ADMISSION_INITIAL_BOOTSTRAPPED",
      "ADMIN_DEVICE_REVOKED",
      "AUTH_IDENTITY_CREATED",
      "PORTAL_SESSION_CREATED",
      "PAYMENT_SUCCEEDED",
      "PAYMENT_FAILED",
      "PAYMENT_CANCELED",
      "PAYMENT_RECONCILED",
      "SUBSCRIPTION_ACTIVATED",
      "SUBSCRIPTION_GRANTED",
      "SUBSCRIPTION_EXTENDED",
      "SUBSCRIPTION_SUSPENDED",
      "CHECKOUT_INTENT_CREATED",
      "PRICE_REVISION_PUBLISHED",
      "ADMIN_P7_UNLISTED_ACTION",
    ];
    const protectedIds = await Promise.all(
      protectedActions.map((action) => insert(action, expired, "do not copy")),
    );
    // An actor/type or prefix heuristic would incorrectly delete this row.
    const unknownAdmin = await insert("ADMIN_UNLISTED_MAINTENANCE", expired);
    const sameActionWrongActor = await insert(
      "P7_ADMIN_ADAPTER_CREATED",
      expired,
      "wrong actor",
      "SYSTEM",
    );
    const sameActionWrongTarget = await insert(
      "P7_ADMIN_ADAPTER_CREATED",
      expired,
      "wrong target",
      "ADMIN",
      "ADMIN_SESSION",
    );
    const first = await repository().purgeExpired({
      category: ADMIN_AUDIT_RETENTION_CATEGORY,
      cutoff,
      retentionDays: 90,
      batchSize: 2,
      statementTimeoutMs: 5_000,
    });
    expect(first).toBe(2);

    const remaining = await repository().purgeExpired({
      category: ADMIN_AUDIT_RETENTION_CATEGORY,
      cutoff,
      retentionDays: 90,
      batchSize: 10,
      statementTimeoutMs: 5_000,
    });
    expect(remaining).toBe(1);
    await expect(
      repository().purgeExpired({
        category: ADMIN_AUDIT_RETENTION_CATEGORY,
        cutoff,
        retentionDays: 90,
        batchSize: 10,
        statementTimeoutMs: 5_000,
      }),
    ).resolves.toBe(0);

    const retained = await runtime.query<{ correlation_id: string }>(
      "SELECT correlation_id FROM audit_events WHERE correlation_id=ANY($1::text[])",
      [
        [
          atCutoff,
          recent,
          ...protectedIds,
          unknownAdmin,
          sameActionWrongActor,
          sameActionWrongTarget,
        ],
      ],
    );
    expect(new Set(retained.rows.map((row) => row.correlation_id))).toEqual(
      new Set([
        atCutoff,
        recent,
        ...protectedIds,
        unknownAdmin,
        sameActionWrongActor,
        sameActionWrongTarget,
      ]),
    );
    const deleted = await runtime.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_events WHERE correlation_id=ANY($1::text[])",
      [eligible],
    );
    expect(deleted.rows[0]?.count).toBe("0");

    const retentionEvents = await runtime.query<{
      actor_type: string;
      action: string;
      target_type: string;
      reason: string;
      safe_metadata: Record<string, unknown>;
      correlation_id: string;
    }>(
      "SELECT actor_type,action,target_type,reason,safe_metadata,correlation_id FROM audit_events WHERE action='ADMIN_AUDIT_RETENTION_PURGED' AND correlation_id=$1",
      [`audit-retention:${cutoff.toISOString()}`],
    );
    expect(retentionEvents.rows).toHaveLength(2);
    for (const event of retentionEvents.rows) {
      expect(event).toMatchObject({
        actor_type: "SYSTEM",
        action: "ADMIN_AUDIT_RETENTION_PURGED",
        target_type: "AUDIT_RETENTION",
        reason: "ADMIN_AUDIT_RETENTION",
      });
      expect(event.safe_metadata).toEqual({
        category: ADMIN_AUDIT_RETENTION_CATEGORY,
        retentionDays: 90,
        cutoff: cutoff.toISOString(),
        deletedCount: expect.any(Number),
        batchSize: expect.any(Number),
      });
      expect(JSON.stringify(event)).not.toContain("secret-");
      expect(JSON.stringify(event)).not.toContain("expired payload marker");
      expect(JSON.stringify(event)).not.toContain("expired event action");
    }
    expect(
      retentionEvents.rows.reduce(
        (total, event) => total + Number(event.safe_metadata.deletedCount),
        0,
      ),
    ).toBe(3);
    // Repository SQL only returns the aggregate count; the API has no ID result.
    expect(typeof first).toBe("number");
  });

  it("fails closed for invalid category, batch, timeout, retention, and cutoff", async () => {
    const base = {
      category: ADMIN_AUDIT_RETENTION_CATEGORY,
      cutoff: new Date("2026-01-01T00:00:00.000Z"),
      retentionDays: 90,
      batchSize: 10,
      statementTimeoutMs: 5_000,
    };
    const purge = (overrides: Partial<typeof base>) =>
      repository().purgeExpired({ ...base, ...overrides } as never);
    await expect(purge({ category: "ADMIN_ALL" as never })).rejects.toThrow(
      "category is not allowlisted",
    );
    await expect(purge({ batchSize: 0 })).rejects.toThrow("batchSize");
    await expect(purge({ batchSize: 1_001 })).rejects.toThrow("batchSize");
    await expect(purge({ statementTimeoutMs: 0 })).rejects.toThrow(
      "statementTimeoutMs",
    );
    await expect(purge({ statementTimeoutMs: 30_001 })).rejects.toThrow(
      "statementTimeoutMs",
    );
    await expect(purge({ retentionDays: 89 })).rejects.toThrow(
      "fixed at 90 days",
    );
    await expect(
      purge({ cutoff: new Date(Date.now() - 89 * 24 * 60 * 60_000) }),
    ).rejects.toThrow("cannot purge events before 90 days");
    await expect(purge({ cutoff: new Date(Number.NaN) })).rejects.toThrow(
      "valid date",
    );
  });
});

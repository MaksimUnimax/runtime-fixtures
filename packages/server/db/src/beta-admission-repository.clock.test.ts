import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBetaAdmissionRepository } from "./beta-admission-repository.js";
import type { DatabaseRuntime } from "./index.js";

// These synthetic clock values never query or mutate a real PostgreSQL server.
const databaseNow = Date.parse("2026-10-14T12:00:00.000Z");
const applicationNow = Date.parse("2026-10-14T13:00:00.000Z");
const existingInviteExpires = Date.parse("2026-10-14T12:30:00.000Z");

function fakePgWithIndependentClock(
  options: {
    replayCreation?: boolean;
    existingExpiresAtMs?: number;
    existingReservationPresent?: boolean;
    insertedExpiresAtMs?: number;
  } = {},
) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  let mutations = 0;
  const invitationRow = {
    id: "33333333-3333-4333-8333-333333333333",
    normalized_identity_target: "pending@example.invalid",
    create_request_id_hash: "original-request",
    create_payload_hash: "original-payload",
    created_at: new Date(databaseNow - 1000),
    expires_at: new Date(options.existingExpiresAtMs ?? existingInviteExpires),
    consumed_at: null,
    consumed_user_id: null,
    revoked_at: null,
    revoke_request_id_hash: null,
    revoke_payload_hash: null,
  };
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    statements.push({ sql, values });
    if (sql.includes("SELECT status FROM admin_principals"))
      return { rows: [{ status: "ACTIVE" }] };
    if (sql.includes("FROM admin_role_grants"))
      return { rows: [{ role: "ADMIN_BETA_OPERATOR" }] };
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [{}] };
    if (sql.includes("FROM beta_admission_state"))
      return {
        rows: [
          {
            mode: "CLOSED",
            capacity: 1,
            admitted: 0,
            revision: 1,
            updated_at: new Date(databaseNow),
          },
        ],
      };
    if (sql.includes("FROM beta_admission_mutations")) return { rows: [] };
    if (sql.includes("FROM user_identities")) return { rows: [] };
    if (
      sql.includes("FROM beta_identity_invitations") &&
      sql.includes("create_request_id_hash=$1")
    )
      return {
        rows: options.replayCreation
          ? [
              {
                ...invitationRow,
                db_now: new Date(databaseNow),
                db_is_active: true,
              },
            ]
          : [],
      };
    if (
      sql.includes("FROM beta_identity_invitations") &&
      sql.includes("revoke_request_id_hash=$1")
    )
      return { rows: [] };
    if (
      sql.includes("FROM beta_identity_invitations") &&
      sql.includes("WHERE id=$1") &&
      !sql.includes("FOR UPDATE")
    )
      return {
        rows: [
          {
            ...invitationRow,
            db_now: new Date(databaseNow),
            db_is_active: true,
          },
        ],
      };
    if (
      sql.includes("FROM beta_identity_invitations") &&
      sql.includes("WHERE id=$1") &&
      sql.includes("FOR UPDATE")
    )
      return { rows: [{ ...invitationRow, db_is_active: true }] };
    if (
      sql.includes("FROM beta_identity_invitations") &&
      sql.includes("LIMIT 1")
    )
      return { rows: [] };
    if (
      sql.includes("count(*)::bigint") &&
      sql.includes("FROM beta_identity_invitations")
    ) {
      const sqlUsesPgClock = sql.includes("clock_timestamp()");
      const queryTime = sqlUsesPgClock
        ? databaseNow
        : values[0] instanceof Date
          ? values[0].getTime()
          : Number.POSITIVE_INFINITY;
      const pending = options.existingReservationPresent !== false;
      const expiresAt = options.existingExpiresAtMs ?? existingInviteExpires;
      return { rows: [{ count: Number(pending && expiresAt > queryTime) }] };
    }
    if (sql.includes("UPDATE beta_admission_state")) {
      mutations++;
      return {
        rows: [
          {
            mode: "CLOSED",
            capacity: values[2],
            admitted: 0,
            revision: values[3],
            updated_at: values[4],
          },
        ],
      };
    }
    if (sql.includes("INSERT INTO beta_identity_invitations")) {
      mutations++;
      return {
        rows: [
          {
            ...invitationRow,
            id: "44444444-4444-4444-8444-444444444444",
            normalized_identity_target: "new@example.invalid",
            expires_at: new Date(
              options.insertedExpiresAtMs ?? applicationNow + 3600_000,
            ),
            db_is_active: true,
          },
        ],
      };
    }
    if (sql.includes("UPDATE beta_identity_invitations")) {
      mutations++;
      return {
        rows: [{ ...invitationRow, revoked_at: new Date(applicationNow) }],
      };
    }
    if (
      sql.includes("INSERT INTO beta_admission_mutations") ||
      sql.includes("INSERT INTO audit_events")
    )
      return { rows: [] };
    throw new Error("Unexpected synthetic SQL operation: " + sql.slice(0, 100));
  });
  const runtime = {
    query,
    transaction: async <T>(
      operation: (tx: { query: typeof query }) => Promise<T>,
    ) => operation({ query }),
  } as unknown as DatabaseRuntime;
  return {
    repository: createBetaAdmissionRepository(runtime),
    statements,
    getMutationCount: () => mutations,
  };
}

describe("beta admission reserves capacity using the PostgreSQL clock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(applicationNow);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports a database-active invitation as PENDING when the app clock is ahead", async () => {
    const { repository, statements } = fakePgWithIndependentClock();
    const result = await repository.readIdentityInvitation(
      "33333333-3333-4333-8333-333333333333",
    );
    expect(result).toMatchObject({ status: "PENDING" });
    expect(
      statements.some(
        (s) =>
          s.sql.includes("FROM beta_identity_invitations") &&
          s.sql.includes("db_is_active") &&
          s.sql.includes("clock_timestamp()"),
      ),
    ).toBe(true);
  });

  it("replays an existing still-active invitation with PostgreSQL-consistent status", async () => {
    const { repository, statements, getMutationCount } =
      fakePgWithIndependentClock({ replayCreation: true });
    const result = await repository.inviteIdentity({
      actorPrincipalId: "11111111-1111-4111-8111-111111111111",
      normalizedIdentityTarget: "pending@example.invalid",
      correlationId: "clock-skew-replay",
      requestIdHash: "original-request",
      payloadHash: "original-payload",
      expectedRevision: 1,
      ttlMs: 24 * 60 * 60_000,
      reason: "synthetic-replay",
    });
    expect(result.kind).toBe("APPLIED");
    if (result.kind !== "APPLIED") throw new Error("synthetic replay missing");
    expect(result.replay).toBe(true);
    expect(result.invitation.status).toBe("PENDING");
    expect(getMutationCount()).toBe(0);
    expect(
      statements.some(
        (s) =>
          s.sql.includes("create_request_id_hash=$1") &&
          s.sql.includes("db_is_active") &&
          s.sql.includes("clock_timestamp()"),
      ),
    ).toBe(true);
  });

  it("preserves microsecond-precise database activity for a displayed invitation", async () => {
    // PostgreSQL may compare expiry at *.000500 while JS Date rounds to *.000.
    const { repository, statements } = fakePgWithIndependentClock({
      existingExpiresAtMs: databaseNow,
    });
    const result = await repository.readIdentityInvitation(
      "33333333-3333-4333-8333-333333333333",
    );
    expect(result?.status).toBe("PENDING");
    expect(
      statements.some(
        (s) =>
          s.sql.includes("FROM beta_identity_invitations") &&
          s.sql.includes("db_is_active") &&
          s.sql.includes("clock_timestamp()"),
      ),
    ).toBe(true);
  });

  it("preserves microsecond activity when replaying an existing invitation", async () => {
    const { repository, statements } = fakePgWithIndependentClock({
      replayCreation: true,
      existingExpiresAtMs: databaseNow,
    });
    const result = await repository.inviteIdentity({
      actorPrincipalId: "11111111-1111-4111-8111-111111111111",
      normalizedIdentityTarget: "pending@example.invalid",
      correlationId: "clock-replay-micro",
      requestIdHash: "original-request",
      payloadHash: "original-payload",
      expectedRevision: 1,
      ttlMs: 24 * 60 * 60_000,
      reason: "synthetic-microsecond",
    });
    expect(result.kind).toBe("APPLIED");
    if (result.kind !== "APPLIED") throw new Error("missing synthetic replay");
    expect(result.invitation.status).toBe("PENDING");
    expect(
      statements.some(
        (s) =>
          s.sql.includes("create_request_id_hash=$1") &&
          s.sql.includes("db_is_active") &&
          s.sql.includes("clock_timestamp()"),
      ),
    ).toBe(true);
  });

  it("reports a newly created database-active invitation using the database predicate", async () => {
    const expiry = databaseNow + 30 * 60_000;
    const { repository, statements } = fakePgWithIndependentClock({
      existingReservationPresent: false,
      insertedExpiresAtMs: expiry,
    });
    const result = await repository.inviteIdentity({
      actorPrincipalId: "11111111-1111-4111-8111-111111111111",
      normalizedIdentityTarget: "new@example.invalid",
      correlationId: "clock-insert-status",
      requestIdHash: "create-status-hash",
      payloadHash: "create-status-payload",
      expectedRevision: 1,
      ttlMs: 24 * 60 * 60_000,
      reason: "synthetic-created",
    });
    expect(result.kind).toBe("APPLIED");
    if (result.kind !== "APPLIED") throw new Error("missing synthetic insert");
    expect(result.invitation.status).toBe("PENDING");
    expect(
      statements.some(
        (s) =>
          s.sql.includes("INSERT INTO beta_identity_invitations") &&
          s.sql.includes("RETURNING") &&
          s.sql.includes("db_is_active") &&
          s.sql.includes("clock_timestamp()"),
      ),
    ).toBe(true);
  });

  it("inserts invitation expiry as PostgreSQL now plus TTL, not a server-created timestamp", async () => {
    const { repository, statements } = fakePgWithIndependentClock({
      existingReservationPresent: false,
    });
    const result = await repository.inviteIdentity({
      actorPrincipalId: "11111111-1111-4111-8111-111111111111",
      normalizedIdentityTarget: "ttl-new@example.invalid",
      correlationId: "ttl-database-new",
      requestIdHash: "ttl-new-request",
      payloadHash: "ttl-new-payload",
      expectedRevision: 1,
      ttlMs: 24 * 60 * 60_000,
      reason: "synthetic TTL source test",
    });
    expect(result.kind).toBe("APPLIED");
    const inserted = statements.find((s) =>
      s.sql.includes("INSERT INTO beta_identity_invitations"),
    );
    if (!inserted) throw new Error("insert not observed");
    expect(inserted.sql).toMatch(
      /VALUES\(\$1,\$2,\$3,\$4,clock_timestamp\(\)\s*\+/,
    );
    expect(inserted.values[4]).toBe(24 * 60 * 60_000);
  });

  it("rejects reducing capacity under a database-active invitation despite a fast app clock", async () => {
    const { repository, statements, getMutationCount } =
      fakePgWithIndependentClock();
    const outcome = await repository.mutate({
      actorPrincipalId: "11111111-1111-4111-8111-111111111111",
      correlationId: "clock-skew-capacity",
      requestIdHash: "capacity-request-hash",
      payloadHash: "capacity-payload-hash",
      expectedRevision: 1,
      action: "SET_CAPACITY",
      capacity: 0,
      reason: "synthetic-capacity",
    });
    expect(outcome.kind).toBe("CONFLICT");
    expect(getMutationCount()).toBe(0);
    const count = statements.filter((s) => s.sql.includes("count(*)::bigint"));
    expect(count).toHaveLength(1);
    const countQuery = count[0];
    if (!countQuery) throw new Error("missing synthetic capacity-count query");
    expect(countQuery.sql).toContain("clock_timestamp()");
    expect(countQuery.values).toEqual([]);
  });

  it("rejects extra invitation when the database still reserves the only slot", async () => {
    const { repository, statements, getMutationCount } =
      fakePgWithIndependentClock();
    const outcome = await repository.inviteIdentity({
      actorPrincipalId: "11111111-1111-4111-8111-111111111111",
      normalizedIdentityTarget: "new@example.invalid",
      correlationId: "clock-skew-invite",
      requestIdHash: "invite-request-hash",
      payloadHash: "invite-payload-hash",
      expectedRevision: 1,
      ttlMs: 24 * 60 * 60_000,
      reason: "synthetic-invite",
    });
    expect(outcome.kind).toBe("CAPACITY_REACHED");
    expect(getMutationCount()).toBe(0);
    expect(
      statements.some(
        (s) =>
          s.sql.includes("count(*)::bigint") &&
          s.sql.includes("clock_timestamp()"),
      ),
    ).toBe(true);
  });

  it("does not prematurely refuse revocation of a still-active PostgreSQL invitation", async () => {
    const { repository, getMutationCount, statements } =
      fakePgWithIndependentClock();
    const outcome = await repository.revokeIdentityInvitation({
      actorPrincipalId: "11111111-1111-4111-8111-111111111111",
      invitationId: "33333333-3333-4333-8333-333333333333",
      correlationId: "clock-skew-revoke",
      requestIdHash: "revoke-request-hash",
      payloadHash: "revoke-payload-hash",
      reason: "synthetic-revoke",
    });
    expect(outcome.kind).toBe("APPLIED");
    expect(getMutationCount()).toBe(1);
    expect(
      statements.some(
        (s) =>
          s.sql.includes("db_is_active") && s.sql.includes("clock_timestamp()"),
      ),
    ).toBe(true);
  });
});

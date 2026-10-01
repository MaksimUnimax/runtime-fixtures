import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BetaAdmissionService } from "../../../packages/server/beta-access/src/index.js";
import {
  createBetaAdmissionRepository,
  createDatabaseRuntime,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for S1.1 beta integration tests");

let db: DatabaseRuntime;
let service: BetaAdmissionService;
const now = new Date("2030-01-01T00:00:00.000Z");

async function q<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) {
  return db.query<T>(text, values);
}

async function reset() {
  await q("DROP TRIGGER IF EXISTS s11_fail_beta_audit ON audit_events");
  await q("DROP FUNCTION IF EXISTS s11_fail_beta_audit()");
  await q(
    "TRUNCATE beta_identity_invitations,beta_admission_mutations,beta_admission_state,audit_events,admin_role_grants,admin_principals,users CASCADE",
  );
  await q(
    "INSERT INTO beta_admission_state(id,mode,capacity,admitted,revision,updated_at) VALUES(1,'CLOSED',0,0,1,$1)",
    [now],
  );
}

async function admin(role = "ADMIN_BETA_OPERATOR") {
  const userId = randomUUID();
  const principalId = randomUUID();
  await q("INSERT INTO users(id) VALUES($1)", [userId]);
  await q("INSERT INTO admin_principals(id,user_id) VALUES($1,$2)", [
    principalId,
    userId,
  ]);
  await q(
    "INSERT INTO admin_role_grants(admin_principal_id,role) VALUES($1,$2)",
    [principalId, role],
  );
  return principalId;
}

function input(
  actorPrincipalId: string,
  requestId: string,
  changes: Partial<{
    expectedRevision: number;
    action: "OPEN" | "PAUSE" | "CLOSE" | "ADD_CAPACITY" | "SET_CAPACITY";
    amount: number;
    capacity: number;
    reason: string;
  }> = {},
) {
  return {
    actorPrincipalId,
    requestId,
    correlationId: "correlation-s11",
    expectedRevision: 1,
    action: "ADD_CAPACITY" as const,
    amount: 100,
    reason: "S1.1 acceptance",
    ...changes,
  };
}

async function auditCount() {
  const result = await q<{ count: string }>(
    "SELECT count(*)::text AS count FROM audit_events WHERE action='BETA_ADMISSION_CHANGED'",
  );
  return Number(result.rows[0]!.count);
}

describe.sequential("S1.1 beta admission on real PostgreSQL", () => {
  beforeAll(async () => {
    db = createDatabaseRuntime(connectionString);
    await db.ready();
    await runMigrations({ connectionString });
    service = new BetaAdmissionService(createBetaAdmissionRepository(db));
  });

  beforeEach(reset);
  afterAll(async () => db.close());

  it("starts CLOSED with zero capacity and admitted count", async () => {
    await admin();
    await expect(service.read()).resolves.toEqual({
      mode: "CLOSED",
      capacity: 0,
      admitted: 0,
      remaining: 0,
      revision: 1,
      updatedAt: now,
    });
  });

  it("ADD_CAPACITY mutates state exactly once and replays without writes", async () => {
    const actor = await admin();
    const first = await service.mutate(input(actor, "request-add-100"));
    expect(first.kind).toBe("APPLIED");
    if (first.kind !== "APPLIED") throw new Error("first mutation failed");
    expect(first.replay).toBe(false);
    expect(first.state).toMatchObject({
      mode: "CLOSED",
      capacity: 100,
      admitted: 0,
      remaining: 100,
      revision: 2,
    });
    expect(await auditCount()).toBe(1);

    const replay = await service.mutate(input(actor, "request-add-100"));
    expect(replay).toEqual({
      kind: "APPLIED",
      replay: true,
      state: first.state,
    });
    expect(await service.read()).toEqual(first.state);
    expect(
      (await q("SELECT count(*)::text AS count FROM beta_admission_mutations"))
        .rows[0]!.count,
    ).toBe("1");
    expect(await auditCount()).toBe(1);
  });

  it("rejects a reused requestId with a different payload without mutation", async () => {
    const actor = await admin();
    const first = await service.mutate(input(actor, "request-conflict"));
    expect(first.kind).toBe("APPLIED");
    const conflict = await service.mutate(
      input(actor, "request-conflict", { amount: 200 }),
    );
    expect(conflict).toEqual({ kind: "CONFLICT" });
    expect((await service.read()).capacity).toBe(100);
    expect(await auditCount()).toBe(1);
  });

  it("binds create requestId globally under concurrent cross-target reuse", async () => {
    const actor = await admin();
    const capacity = await service.mutate(
      input(actor, "request-cross-target-create-capacity", { amount: 2 }),
    );
    expect(capacity.kind).toBe("APPLIED");
    if (capacity.kind !== "APPLIED") throw new Error("capacity setup failed");

    const sharedRequestId = "invite-cross-target-request";
    const [left, right] = await Promise.all([
      service.createIdentityInvitation({
        actorPrincipalId: actor,
        requestId: sharedRequestId,
        correlationId: "invite-cross-target-left-correlation",
        expectedRevision: capacity.state.revision,
        normalizedIdentityTarget: "cross-target-left@example.test",
        reason: "left",
      }),
      service.createIdentityInvitation({
        actorPrincipalId: actor,
        requestId: sharedRequestId,
        correlationId: "invite-cross-target-right-correlation",
        expectedRevision: capacity.state.revision,
        normalizedIdentityTarget: "cross-target-right@example.test",
        reason: "right",
      }),
    ]);

    expect([left.kind, right.kind].sort()).toEqual(["APPLIED", "CONFLICT"]);
    expect(
      (
        await q<{ count: string }>(
          "SELECT count(*)::text count FROM beta_identity_invitations",
        )
      ).rows[0]!.count,
    ).toBe("1");
  });

  it("binds revoke requestId globally and conflicts instead of surfacing a unique violation", async () => {
    const actor = await admin();
    const capacity = await service.mutate(
      input(actor, "request-invite-capacity", { amount: 2 }),
    );
    expect(capacity.kind).toBe("APPLIED");
    if (capacity.kind !== "APPLIED") throw new Error("capacity setup failed");

    const first = await service.createIdentityInvitation({
      actorPrincipalId: actor,
      requestId: "invite-first-request",
      correlationId: "invite-first-correlation",
      expectedRevision: capacity.state.revision,
      normalizedIdentityTarget: "first-reviewer@example.test",
      reason: "first reviewer",
    });
    const second = await service.createIdentityInvitation({
      actorPrincipalId: actor,
      requestId: "invite-second-request",
      correlationId: "invite-second-correlation",
      expectedRevision: capacity.state.revision,
      normalizedIdentityTarget: "second-reviewer@example.test",
      reason: "second reviewer",
    });
    expect(first.kind).toBe("APPLIED");
    expect(second.kind).toBe("APPLIED");
    if (first.kind !== "APPLIED" || second.kind !== "APPLIED")
      throw new Error("invitation setup failed");

    const revoked = await service.revokeIdentityInvitation({
      actorPrincipalId: actor,
      invitationId: first.invitation.id,
      requestId: "revoke-shared-request",
      correlationId: "revoke-first-correlation",
      reason: "revoke first",
    });
    expect(revoked).toMatchObject({
      kind: "APPLIED",
      replay: false,
      invitation: { id: first.invitation.id, status: "REVOKED" },
    });

    await expect(
      service.revokeIdentityInvitation({
        actorPrincipalId: actor,
        invitationId: second.invitation.id,
        requestId: "revoke-shared-request",
        correlationId: "revoke-second-correlation",
        reason: "revoke second",
      }),
    ).resolves.toEqual({ kind: "CONFLICT" });

    await expect(
      service.readIdentityInvitation(second.invitation.id),
    ).resolves.toMatchObject({ id: second.invitation.id, status: "PENDING" });
  });

  it("rejects invitation creation for an already-existing email identity", async () => {
    const actor = await admin();
    const capacity = await service.mutate(
      input(actor, "request-existing-identity-capacity", { amount: 1 }),
    );
    expect(capacity.kind).toBe("APPLIED");
    if (capacity.kind !== "APPLIED") throw new Error("capacity setup failed");

    const existingUserId = randomUUID();
    await q("INSERT INTO users(id) VALUES($1)", [existingUserId]);
    await q(
      "INSERT INTO user_identities(user_id,provider,normalized_identifier,verified_at) VALUES($1,'EMAIL',$2,now())",
      [existingUserId, "existing-reviewer@example.test"],
    );

    await expect(
      service.createIdentityInvitation({
        actorPrincipalId: actor,
        requestId: "invite-existing-identity",
        correlationId: "invite-existing-identity-correlation",
        expectedRevision: capacity.state.revision,
        normalizedIdentityTarget: "existing-reviewer@example.test",
        reason: "must conflict",
      }),
    ).resolves.toEqual({ kind: "CONFLICT" });

    expect(
      (
        await q<{ count: string }>(
          "SELECT count(*)::text count FROM beta_identity_invitations",
        )
      ).rows[0]!.count,
    ).toBe("0");
  });

  it("replays one revoke idempotently without duplicate audit", async () => {
    const actor = await admin();
    const capacity = await service.mutate(
      input(actor, "request-revoke-replay-capacity", { amount: 1 }),
    );
    expect(capacity.kind).toBe("APPLIED");
    if (capacity.kind !== "APPLIED") throw new Error("capacity setup failed");

    const created = await service.createIdentityInvitation({
      actorPrincipalId: actor,
      requestId: "invite-revoke-replay",
      correlationId: "invite-revoke-replay-correlation",
      expectedRevision: capacity.state.revision,
      normalizedIdentityTarget: "revoke-replay@example.test",
      reason: "revoke replay",
    });
    expect(created.kind).toBe("APPLIED");
    if (created.kind !== "APPLIED") throw new Error("invitation setup failed");

    const request = {
      actorPrincipalId: actor,
      invitationId: created.invitation.id,
      requestId: "revoke-idempotent-request",
      correlationId: "revoke-idempotent-correlation",
      reason: "idempotent revoke",
    };
    const first = await service.revokeIdentityInvitation(request);
    const replay = await service.revokeIdentityInvitation(request);
    expect(first).toMatchObject({
      kind: "APPLIED",
      replay: false,
      invitation: { status: "REVOKED" },
    });
    expect(replay).toMatchObject({
      kind: "APPLIED",
      replay: true,
      invitation: { status: "REVOKED" },
    });
    expect(
      Number(
        (
          await q<{ count: string }>(
            "SELECT count(*)::text count FROM audit_events WHERE action='BETA_IDENTITY_INVITATION_REVOKED'",
          )
        ).rows[0]!.count,
      ),
    ).toBe(1);
  });

  it("redacts email-shaped text from invitation create and revoke audit reasons", async () => {
    const actor = await admin();
    const capacity = await service.mutate(
      input(actor, "request-audit-redaction-capacity", { amount: 1 }),
    );
    expect(capacity.kind).toBe("APPLIED");
    if (capacity.kind !== "APPLIED") throw new Error("capacity setup failed");

    const rawEmails = [
      "private.reviewer@example.test",
      "reviewer@bücher.example",
    ];
    const created = await service.createIdentityInvitation({
      actorPrincipalId: actor,
      requestId: "invite-audit-redaction",
      correlationId: "invite-audit-redaction-correlation",
      expectedRevision: capacity.state.revision,
      normalizedIdentityTarget: "audit-target@example.test",
      reason: `invite ${rawEmails.join(" and ")} for review`,
    });
    expect(created.kind).toBe("APPLIED");
    if (created.kind !== "APPLIED") throw new Error("invitation setup failed");

    const revoked = await service.revokeIdentityInvitation({
      actorPrincipalId: actor,
      invitationId: created.invitation.id,
      requestId: "revoke-audit-redaction",
      correlationId: "revoke-audit-redaction-correlation",
      reason: `remove ${rawEmails.join(" and ")} from review`,
    });
    expect(revoked.kind).toBe("APPLIED");

    const audit = await q<{ action: string; reason: string; safe: string }>(
      `SELECT action,reason,safe_metadata::text AS safe
         FROM audit_events
        WHERE target_id=$1
          AND action IN ('BETA_IDENTITY_INVITED','BETA_IDENTITY_INVITATION_REVOKED')
        ORDER BY created_at,action`,
      [created.invitation.id],
    );
    expect(audit.rows).toHaveLength(2);
    for (const row of audit.rows) {
      expect(row.reason).toContain("[REDACTED_EMAIL]");
      for (const rawEmail of rawEmails) {
        expect(row.reason).not.toContain(rawEmail);
        expect(row.safe).not.toContain(rawEmail);
      }
      expect(row.safe).not.toContain("identityHash");
    }
  });

  it("rejects a stale expected revision without state or audit changes", async () => {
    const actor = await admin();
    await service.mutate(input(actor, "request-stale"));
    const stale = await service.mutate(
      input(actor, "request-stale-second", { expectedRevision: 1 }),
    );
    expect(stale).toEqual({ kind: "STALE" });
    expect((await service.read()).revision).toBe(2);
    expect(await auditCount()).toBe(1);
  });

  it("rejects SET_CAPACITY below admitted without state change", async () => {
    const actor = await admin();
    await q(
      "UPDATE beta_admission_state SET capacity=100,admitted=50 WHERE id=1",
    );
    const result = await service.mutate(
      input(actor, "request-below-admitted", {
        action: "SET_CAPACITY",
        capacity: 49,
      }),
    );
    expect(result).toEqual({ kind: "CONFLICT" });
    expect(await service.read()).toMatchObject({
      capacity: 100,
      admitted: 50,
      revision: 1,
    });
    expect(await auditCount()).toBe(0);
  });

  it("reserves CLOSED beta capacity for invitations and protects SET_CAPACITY", async () => {
    const actor = await admin();
    const capacity = await service.mutate(
      input(actor, "request-reservation-capacity", { amount: 2 }),
    );
    expect(capacity.kind).toBe("APPLIED");
    if (capacity.kind !== "APPLIED") throw new Error("capacity setup failed");

    const first = await service.createIdentityInvitation({
      actorPrincipalId: actor,
      requestId: "invite-reservation-first",
      correlationId: "invite-reservation-correlation-1",
      expectedRevision: capacity.state.revision,
      normalizedIdentityTarget: "reservation-one@example.test",
      reason: "reserve reviewer one",
    });
    const second = await service.createIdentityInvitation({
      actorPrincipalId: actor,
      requestId: "invite-reservation-second",
      correlationId: "invite-reservation-correlation-2",
      expectedRevision: capacity.state.revision,
      normalizedIdentityTarget: "reservation-two@example.test",
      reason: "reserve reviewer two",
    });
    expect(first.kind).toBe("APPLIED");
    expect(second.kind).toBe("APPLIED");

    await expect(
      service.mutate(
        input(actor, "request-capacity-below-reservations", {
          expectedRevision: capacity.state.revision,
          action: "SET_CAPACITY",
          capacity: 1,
          amount: undefined,
        }),
      ),
    ).resolves.toEqual({ kind: "CONFLICT" });

    expect(await service.read()).toMatchObject({
      mode: "CLOSED",
      capacity: 2,
      admitted: 0,
      revision: capacity.state.revision,
    });
  });

  it("serializes invitation reservations so two reviewers cannot reserve the last slot", async () => {
    const actor = await admin();
    const capacity = await service.mutate(
      input(actor, "request-single-reservation-capacity", { amount: 1 }),
    );
    expect(capacity.kind).toBe("APPLIED");
    if (capacity.kind !== "APPLIED") throw new Error("capacity setup failed");

    const [left, right] = await Promise.all([
      service.createIdentityInvitation({
        actorPrincipalId: actor,
        requestId: "invite-last-slot-left",
        correlationId: "invite-last-slot-correlation-left",
        expectedRevision: capacity.state.revision,
        normalizedIdentityTarget: "last-slot-left@example.test",
        reason: "reserve left",
      }),
      service.createIdentityInvitation({
        actorPrincipalId: actor,
        requestId: "invite-last-slot-right",
        correlationId: "invite-last-slot-correlation-right",
        expectedRevision: capacity.state.revision,
        normalizedIdentityTarget: "last-slot-right@example.test",
        reason: "reserve right",
      }),
    ]);

    expect([left.kind, right.kind].sort()).toEqual([
      "APPLIED",
      "CAPACITY_REACHED",
    ]);
    expect(
      Number(
        (
          await q<{ count: string }>(
            "SELECT count(*)::text count FROM beta_identity_invitations WHERE consumed_at IS NULL AND revoked_at IS NULL AND expires_at>now()",
          )
        ).rows[0]!.count,
      ),
    ).toBe(1);
  });

  it("revoke and expiry release reserved capacity", async () => {
    const actor = await admin();
    const capacity = await service.mutate(
      input(actor, "request-release-reservation-capacity", { amount: 2 }),
    );
    expect(capacity.kind).toBe("APPLIED");
    if (capacity.kind !== "APPLIED") throw new Error("capacity setup failed");

    const first = await service.createIdentityInvitation({
      actorPrincipalId: actor,
      requestId: "invite-release-first",
      correlationId: "invite-release-correlation-1",
      expectedRevision: capacity.state.revision,
      normalizedIdentityTarget: "release-one@example.test",
      reason: "release first",
    });
    const second = await service.createIdentityInvitation({
      actorPrincipalId: actor,
      requestId: "invite-release-second",
      correlationId: "invite-release-correlation-2",
      expectedRevision: capacity.state.revision,
      normalizedIdentityTarget: "release-two@example.test",
      reason: "release second",
    });
    expect(first.kind).toBe("APPLIED");
    expect(second.kind).toBe("APPLIED");
    if (first.kind !== "APPLIED" || second.kind !== "APPLIED")
      throw new Error("invitation setup failed");

    await expect(
      service.revokeIdentityInvitation({
        actorPrincipalId: actor,
        invitationId: first.invitation.id,
        requestId: "revoke-release-first",
        correlationId: "revoke-release-correlation",
        reason: "release reservation",
      }),
    ).resolves.toMatchObject({ kind: "APPLIED", replay: false });

    await q(
      "UPDATE beta_identity_invitations SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",
      [second.invitation.id],
    );

    const shrunk = await service.mutate(
      input(actor, "request-capacity-after-release", {
        expectedRevision: capacity.state.revision,
        action: "SET_CAPACITY",
        capacity: 0,
        amount: undefined,
      }),
    );
    expect(shrunk).toMatchObject({
      kind: "APPLIED",
      state: { capacity: 0, admitted: 0 },
    });
  });

  it("accepts OPEN, PAUSE, and CLOSE with one revision per command", async () => {
    const actor = await admin();
    for (const [revision, action, requestId, mode] of [
      [1, "OPEN", "request-open", "OPEN"],
      [2, "PAUSE", "request-pause", "PAUSED"],
      [3, "CLOSE", "request-close", "CLOSED"],
    ] as const) {
      const result = await service.mutate(
        input(actor, requestId, {
          expectedRevision: revision,
          action,
        }),
      );
      expect(result).toMatchObject({
        kind: "APPLIED",
        replay: false,
        state: { mode, revision: revision + 1 },
      });
    }
    expect(await auditCount()).toBe(3);
  });

  it("records actor, reason, before/after state, and correlation without secrets", async () => {
    const actor = await admin();
    const result = await service.mutate(
      input(actor, "private-request-id", { reason: "operator reason" }),
    );
    expect(result.kind).toBe("APPLIED");
    const rows = await q<{
      actor_id: string;
      reason: string;
      correlation_id: string;
      safe_metadata: Record<string, unknown>;
    }>(
      "SELECT actor_id,reason,correlation_id,safe_metadata FROM audit_events WHERE action='BETA_ADMISSION_CHANGED'",
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      actor_id: actor,
      reason: "operator reason",
      correlation_id: "correlation-s11",
      safe_metadata: {
        action: "ADD_CAPACITY",
        old: { mode: "CLOSED", capacity: 0, admitted: 0, revision: 1 },
        new: { mode: "CLOSED", capacity: 100, admitted: 0, revision: 2 },
      },
    });
    expect(JSON.stringify(rows.rows[0])).not.toContain("private-request-id");
    expect(JSON.stringify(rows.rows[0])).not.toMatch(/otp|token|secret/i);
  });

  it("redacts secret-shaped admin reasons before audit persistence", async () => {
    const actor = await admin();
    const result = await service.mutate(
      input(actor, "request-redacted-reason", {
        reason:
          "token=supersecretvalue Bearer abcdefghijklmnopqrstuvwxyz123456",
      }),
    );
    expect(result.kind).toBe("APPLIED");
    const row = await q<{ reason: string }>(
      "SELECT reason FROM audit_events WHERE action='BETA_ADMISSION_CHANGED'",
    );
    expect(row.rows[0]!.reason).not.toContain("supersecretvalue");
    expect(row.rows[0]!.reason).not.toContain(
      "abcdefghijklmnopqrstuvwxyz123456",
    );
    expect(row.rows[0]!.reason).toContain("[REDACTED");
  });

  it("rechecks current manage permission inside the transaction", async () => {
    const actor = await admin();
    await q(
      "UPDATE admin_role_grants SET revoked_at=$2,revoked_by_admin_principal_id=$1 WHERE admin_principal_id=$1",
      [actor, now],
    );
    expect(await service.mutate(input(actor, "request-revoked"))).toEqual({
      kind: "FORBIDDEN",
    });
    expect(await service.read()).toMatchObject({ revision: 1, capacity: 0 });
    expect(await auditCount()).toBe(0);
  });

  it("rolls back state and mutation ledger when audit insertion fails", async () => {
    const actor = await admin();
    await q(`
      CREATE FUNCTION s11_fail_beta_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'BETA_ADMISSION_CHANGED' THEN RAISE EXCEPTION 'forced beta audit failure'; END IF;
        RETURN NEW;
      END $$
    `);
    await q(
      "CREATE TRIGGER s11_fail_beta_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION s11_fail_beta_audit()",
    );
    await expect(
      service.mutate(input(actor, "request-audit-failure")),
    ).rejects.toThrow("forced beta audit failure");
    expect(await service.read()).toMatchObject({ revision: 1, capacity: 0 });
    expect(
      (await q("SELECT count(*)::text AS count FROM beta_admission_mutations"))
        .rows[0]!.count,
    ).toBe("0");
    expect(await auditCount()).toBe(0);
  });

  it("returns the original timestamp when replaying after a later mutation", async () => {
    const actor = await admin();
    const first = await service.mutate(input(actor, "request-r1"));
    expect(first.kind).toBe("APPLIED");
    if (first.kind !== "APPLIED") throw new Error("first mutation failed");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await service.mutate(
      input(actor, "request-r2", {
        expectedRevision: 2,
        action: "OPEN",
        amount: undefined,
      }),
    );
    expect(second.kind).toBe("APPLIED");
    if (second.kind !== "APPLIED") throw new Error("second mutation failed");
    expect(second.state.updatedAt.getTime()).toBeGreaterThan(
      first.state.updatedAt.getTime(),
    );
    const replay = await service.mutate(input(actor, "request-r1"));
    expect(replay).toEqual({
      kind: "APPLIED",
      replay: true,
      state: first.state,
    });
    expect(await auditCount()).toBe(2);
  });

  it("serializes concurrent commands against one expected revision", async () => {
    const actor = await admin();
    const [left, right] = await Promise.all([
      service.mutate(input(actor, "request-concurrent-left")),
      service.mutate(input(actor, "request-concurrent-right")),
    ]);
    expect([left.kind, right.kind].sort()).toEqual(["APPLIED", "STALE"]);
    expect(await service.read()).toMatchObject({ capacity: 100, revision: 2 });
    expect(await auditCount()).toBe(1);
    expect(
      (await q("SELECT count(*)::text AS count FROM beta_admission_mutations"))
        .rows[0]!.count,
    ).toBe("1");
  });
});

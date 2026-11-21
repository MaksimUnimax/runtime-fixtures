import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AdminAuthService,
  deriveAdminAuthKeys,
  type AdminRole,
} from "../../../packages/server/admin-auth/src/index.js";
import {
  createAdminAuthRepository,
  createAdminOpsRepository,
  createDatabaseRuntime,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import { resetTransferProtectedTestFixture } from "./helpers/credential-transfer-fixture-reset.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for B14 integration tests");

let db: DatabaseRuntime;
// Synthetic test-only key material, never credentials for an installed service.
const keys = deriveAdminAuthKeys(Buffer.alloc(32, 14));
const betaRole = "ADMIN_BETA_OPERATOR" as const;
const betaPermissions = ["beta.admission.manage", "beta.admission.read"];
const q = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => db.query<T>(text, values);

async function clean() {
  // Keep the real fixture authorization and migration guards enabled. This
  // helper admits only its existing disposable databases and CI identity.
  await resetTransferProtectedTestFixture(
    db,
    "TRUNCATE admin_sessions,admin_role_grants,admin_principals,audit_events,sessions,devices,account_memberships,user_identities,portal_sessions,accounts,users CASCADE",
  );
}

async function makeUser(status: "ACTIVE" | "SUSPENDED" = "ACTIVE") {
  const userId = randomUUID();
  await q("INSERT INTO users(id,status) VALUES($1,$2)", [userId, status]);
  await q(
    "INSERT INTO user_identities(user_id,provider,normalized_identifier,verified_at) VALUES($1,'EMAIL',$2,now())",
    [userId, `b14-${userId}@example.test`],
  );
  return userId;
}

async function seedPrincipal(userId: string, role: AdminRole = "ADMIN_OWNER") {
  const principalId = randomUUID();
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

async function makePortal(userId: string) {
  const sessionId = randomUUID();
  const result = await q<{ created_at: Date }>(
    "INSERT INTO portal_sessions(id,user_id,created_at,expires_at,session_token_hash) VALUES($1,$2,now()-interval '1 second',now()+interval '1 hour',$3) RETURNING created_at",
    [sessionId, userId, `b14-synthetic-portal-${sessionId}`],
  );
  return { sessionId, userId, createdAt: result.rows[0]!.created_at };
}

function authService() {
  return new AdminAuthService(createAdminAuthRepository(db), keys);
}

async function elevate(auth: AdminAuthService, userId: string) {
  const result = await auth.createAdminSession(
    await makePortal(userId),
    `b14-session-${randomUUID()}`,
  );
  if (!result.ok)
    throw new Error(`B14 fixture elevation failed: ${result.code}`);
  return result.value;
}

async function readPrincipal(principalId: string) {
  const result = await createAdminOpsRepository(db).listPrincipals({
    principalId,
    limit: 1,
  });
  if ("kind" in result)
    throw new Error(`B14 principal read failed: ${result.kind}`);
  expect(result.items).toHaveLength(1);
  return result.items[0]!;
}

async function auditCount(correlationId: string) {
  const result = await q<{ count: number }>(
    "SELECT count(*)::integer AS count FROM audit_events WHERE correlation_id=$1",
    [correlationId],
  );
  return result.rows[0]!.count;
}

async function ownerAndSuspendedUserOwner() {
  const activeUserId = await makeUser();
  const suspendedUserId = await makeUser();
  const activePrincipalId = await seedPrincipal(activeUserId);
  const suspendedUserPrincipalId = await seedPrincipal(suspendedUserId);
  // Model a user suspended after its Owner principal was provisioned. The
  // principal and its grant remain active, but they cannot authorize a login.
  await q("UPDATE users SET status='SUSPENDED' WHERE id=$1", [suspendedUserId]);
  const auth = authService();
  const activeSession = await elevate(auth, activeUserId);

  expect(activeSession.subject.adminPrincipalId).toBe(activePrincipalId);
  expect(activeSession.subject.permissions).toContain("admin.principal.manage");
  const inactiveElevation = await auth.createAdminSession(
    await makePortal(suspendedUserId),
    `b14-inactive-owner-${randomUUID()}`,
  );
  expect(inactiveElevation.ok).toBe(false);
  if (!inactiveElevation.ok)
    expect(inactiveElevation.code).toBe("ADMIN_FORBIDDEN");

  return {
    auth,
    activePrincipalId,
    suspendedUserPrincipalId,
    activeSession,
  };
}

// Real PostgreSQL repository/authentication coverage. HTTP permission, CSRF,
// and contract validation are exercised separately, not replaced by this suite.
describe.sequential("B14 admin operations on real PostgreSQL", () => {
  beforeAll(async () => {
    db = createDatabaseRuntime(connectionString);
    await db.ready();
    await runMigrations({ connectionString });
  });
  beforeEach(clean);
  afterAll(async () => db?.close());

  it.each(["revoke", "suspend"] as const)(
    "does not %s the last usable Owner when another Owner belongs to a suspended user",
    async (operation) => {
      const fixture = await ownerAndSuspendedUserOwner();
      const repository = createAdminOpsRepository(db);
      const correlationId = `b14-last-usable-${operation}`;
      const before = await readPrincipal(fixture.activePrincipalId);
      const input = {
        principalId: fixture.activePrincipalId,
        expectedRevision: before.revision,
        actorId: fixture.activeSession.subject.adminPrincipalId,
        correlationId,
        reason: "Isolated B14 last usable Owner verification",
      };

      const result =
        operation === "revoke"
          ? await repository.revokeRole({ ...input, role: "ADMIN_OWNER" })
          : await repository.setPrincipalStatus({
              ...input,
              status: "SUSPENDED",
            });

      expect(result).toEqual({ kind: "LAST_OWNER" });
      expect(await readPrincipal(fixture.activePrincipalId)).toEqual(before);
      expect(await auditCount(correlationId)).toBe(0);
      expect(
        await fixture.auth.authenticateAdminSession(
          fixture.activeSession.sessionToken,
        ),
      ).toMatchObject({
        ok: true,
        value: {
          adminPrincipalId: fixture.activePrincipalId,
          roles: ["ADMIN_OWNER"],
        },
      });
      const session = await q<{ revoked_at: Date | null }>(
        "SELECT revoked_at FROM admin_sessions WHERE id=$1",
        [fixture.activeSession.subject.adminSessionId],
      );
      expect(session.rows[0]!.revoked_at).toBeNull();
    },
  );

  it("allows removal of an unusable Owner when one usable Owner remains", async () => {
    const fixture = await ownerAndSuspendedUserOwner();
    const correlationId = "b14-remove-unusable-owner";
    const result = await createAdminOpsRepository(db).revokeRole({
      principalId: fixture.suspendedUserPrincipalId,
      role: "ADMIN_OWNER",
      expectedRevision: 1,
      actorId: fixture.activeSession.subject.adminPrincipalId,
      correlationId,
      reason: "Remove obsolete access from an isolated suspended test user",
    });

    expect(result).toMatchObject({
      kind: "OK",
      principal: {
        principalId: fixture.suspendedUserPrincipalId,
        status: "ACTIVE",
        revision: 2,
        roles: [],
      },
    });
    expect(await readPrincipal(fixture.activePrincipalId)).toMatchObject({
      status: "ACTIVE",
      revision: 1,
      roles: ["ADMIN_OWNER"],
    });
    expect(
      await fixture.auth.authenticateAdminSession(
        fixture.activeSession.sessionToken,
      ),
    ).toMatchObject({ ok: true, value: { roles: ["ADMIN_OWNER"] } });
    const events = await q<{
      actor_id: string;
      action: string;
      target_id: string;
    }>(
      "SELECT actor_id,action,target_id FROM audit_events WHERE correlation_id=$1",
      [correlationId],
    );
    expect(events.rows).toEqual([
      {
        actor_id: fixture.activePrincipalId,
        action: "ADMIN_ROLE_REVOKED",
        target_id: fixture.suspendedUserPrincipalId,
      },
    ]);
  });

  it.each([
    { action: "ADMIN_ROLE_GRANTED", targetType: "ADMIN_PRINCIPAL" },
    { action: "ADMIN_DEVICE_REVOKED", targetType: "DEVICE" },
    { action: "B14_UNKNOWN_ARCHIVED_EVENT", targetType: "UNKNOWN" },
  ])(
    "keeps nonempty stored reason and metadata private for $action",
    async ({ action, targetType }) => {
      const actorId = await seedPrincipal(await makeUser());
      const id = randomUUID();
      const targetId = randomUUID();
      const correlationId = `b14-private-${id}`;
      const privateReason = `B14_SYNTHETIC_PRIVATE_REASON_${id}`;
      const metadataCanary = `B14_SYNTHETIC_PRIVATE_METADATA_${id}`;
      const metadata = {
        role: betaRole,
        oldRevision: 1,
        newRevision: 2,
        reasonCode: "ADMIN_REVOKED",
        privateDiagnostic: metadataCanary,
        nested: { token: metadataCanary },
      };
      await q(
        "INSERT INTO audit_events(id,actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata) VALUES($1,'ADMIN',$2,$3,$4,$5,$6,$7,$8::jsonb)",
        [
          id,
          actorId,
          action,
          targetType,
          targetId,
          correlationId,
          privateReason,
          JSON.stringify(metadata),
        ],
      );
      // Verify that this exercises populated private columns, not null/absent
      // fixture fields that could make a projection test pass vacuously.
      const stored = await q<{ reason: string; safe_metadata: unknown }>(
        "SELECT reason,safe_metadata FROM audit_events WHERE id=$1",
        [id],
      );
      expect(stored.rows[0]).toEqual({
        reason: privateReason,
        safe_metadata: metadata,
      });

      const result = await createAdminOpsRepository(db).listAuditEvents({
        correlationId,
        limit: 10,
      });
      if ("kind" in result)
        throw new Error(`B14 audit read failed: ${result.kind}`);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id,
        actorType: "ADMIN",
        actorId,
        action,
        targetType,
        targetId,
        correlationId,
      });
      expect(result.items[0]!.createdAt).toBeInstanceOf(Date);
      expect(result.items[0]).not.toHaveProperty("reason");
      expect(result.items[0]).not.toHaveProperty("safeMetadata");
      expect(result.items[0]).not.toHaveProperty("safe_metadata");
      expect(JSON.stringify(result)).not.toContain(privateReason);
      expect(JSON.stringify(result)).not.toContain(metadataCanary);
    },
  );

  it("preserves Beta operator authority, role history and session revocation through its full lifecycle", async () => {
    const ownerId = await seedPrincipal(await makeUser());
    const betaUserId = await makeUser();
    const repository = createAdminOpsRepository(db);
    const auth = authService();
    const created = await repository.createPrincipal({
      userId: betaUserId,
      initialRole: betaRole,
      actorId: ownerId,
      correlationId: "b14-beta-create",
      reason: "Set up an isolated Beta operator",
    });
    expect(created.kind).toBe("OK");
    if (created.kind !== "OK")
      throw new Error("B14 Beta principal not created");
    const principalId = created.principal.principalId;
    expect(created.principal).toMatchObject({
      userId: betaUserId,
      status: "ACTIVE",
      revision: 1,
      roles: [betaRole],
    });
    const filtered = await repository.listPrincipals({
      role: betaRole,
      limit: 10,
    });
    if ("kind" in filtered)
      throw new Error(`B14 Beta role filter failed: ${filtered.kind}`);
    expect(filtered.items.map((principal) => principal.principalId)).toEqual([
      principalId,
    ]);

    const session = await elevate(auth, betaUserId);
    expect(session.subject.permissions).toEqual(betaPermissions);
    const denied = await repository.grantRole({
      principalId,
      role: "ADMIN_OWNER",
      expectedRevision: 1,
      actorId: session.subject.adminPrincipalId,
      correlationId: "b14-beta-denied-owner-grant",
      reason: "Verify that Beta operator cannot grant itself Owner",
    });
    expect(denied).toEqual({ kind: "FORBIDDEN" });
    expect(await auditCount("b14-beta-denied-owner-grant")).toBe(0);
    expect(await readPrincipal(principalId)).toMatchObject({
      revision: 1,
      roles: [betaRole],
    });

    const revoked = await repository.revokeRole({
      principalId,
      role: betaRole,
      expectedRevision: 1,
      actorId: ownerId,
      correlationId: "b14-beta-revoke",
      reason: "Withdraw the isolated Beta operator grant",
    });
    expect(revoked).toMatchObject({
      kind: "OK",
      principal: { revision: 2, roles: [] },
    });
    expect(await auth.authenticateAdminSession(session.sessionToken)).toEqual({
      ok: false,
      code: "ADMIN_UNAUTHORIZED",
    });
    const withoutBeta = await repository.listPrincipals({
      role: betaRole,
      limit: 10,
    });
    if ("kind" in withoutBeta)
      throw new Error(`B14 Beta role filter failed: ${withoutBeta.kind}`);
    expect(withoutBeta.items).toEqual([]);

    const stale = await repository.grantRole({
      principalId,
      role: betaRole,
      expectedRevision: 1,
      actorId: ownerId,
      correlationId: "b14-beta-stale-regrant",
      reason: "Do not overwrite the intervening role revocation",
    });
    expect(stale).toEqual({ kind: "STALE" });
    expect(await auditCount("b14-beta-stale-regrant")).toBe(0);
    const regranted = await repository.grantRole({
      principalId,
      role: betaRole,
      expectedRevision: 2,
      actorId: ownerId,
      correlationId: "b14-beta-regrant",
      reason: "Issue a new reviewed Beta operator grant",
    });
    expect(regranted).toMatchObject({
      kind: "OK",
      principal: { revision: 3, roles: [betaRole] },
    });
    const history = await q<{
      role: string;
      revoked_at: Date | null;
      granted_by_admin_principal_id: string;
      revoked_by_admin_principal_id: string | null;
    }>(
      "SELECT role,revoked_at,granted_by_admin_principal_id,revoked_by_admin_principal_id FROM admin_role_grants WHERE admin_principal_id=$1 ORDER BY granted_at,id",
      [principalId],
    );
    expect(history.rows).toHaveLength(2);
    expect(history.rows.filter((row) => row.revoked_at !== null)).toEqual([
      {
        role: betaRole,
        revoked_at: expect.any(Date),
        granted_by_admin_principal_id: ownerId,
        revoked_by_admin_principal_id: ownerId,
      },
    ]);
    expect(history.rows.filter((row) => row.revoked_at === null)).toEqual([
      {
        role: betaRole,
        revoked_at: null,
        granted_by_admin_principal_id: ownerId,
        revoked_by_admin_principal_id: null,
      },
    ]);
    expect(
      await auth.authenticateAdminSession(session.sessionToken),
    ).toMatchObject({
      ok: true,
      value: { roles: [betaRole], permissions: betaPermissions },
    });

    const suspended = await repository.setPrincipalStatus({
      principalId,
      status: "SUSPENDED",
      expectedRevision: 3,
      actorId: ownerId,
      correlationId: "b14-beta-suspend",
      reason: "Suspend the isolated Beta operator",
    });
    expect(suspended).toMatchObject({
      kind: "OK",
      changed: true,
      revokedSessionCount: 1,
      principal: { status: "SUSPENDED", revision: 4, roles: [betaRole] },
    });
    expect(await auth.authenticateAdminSession(session.sessionToken)).toEqual({
      ok: false,
      code: "ADMIN_PRINCIPAL_SUSPENDED",
    });
    const restored = await repository.setPrincipalStatus({
      principalId,
      status: "ACTIVE",
      expectedRevision: 4,
      actorId: ownerId,
      correlationId: "b14-beta-restore",
      reason: "Restore the reviewed Beta operator principal",
    });
    expect(restored).toMatchObject({
      kind: "OK",
      changed: true,
      revokedSessionCount: 0,
      principal: { status: "ACTIVE", revision: 5, roles: [betaRole] },
    });
    expect(await auth.authenticateAdminSession(session.sessionToken)).toEqual({
      ok: false,
      code: "ADMIN_SESSION_EXPIRED",
    });
    const oldSession = await q<{
      revoked_at: Date | null;
      revoke_reason: string | null;
    }>("SELECT revoked_at,revoke_reason FROM admin_sessions WHERE id=$1", [
      session.subject.adminSessionId,
    ]);
    expect(oldSession.rows[0]).toEqual({
      revoked_at: expect.any(Date),
      revoke_reason: "ADMIN_PRINCIPAL_SUSPENDED",
    });
    const freshSession = await elevate(auth, betaUserId);
    expect(freshSession.subject.adminSessionId).not.toBe(
      session.subject.adminSessionId,
    );
    expect(freshSession.subject.permissions).toEqual(betaPermissions);

    const events = await q<{ action: string; actor_id: string }>(
      "SELECT action,actor_id FROM audit_events WHERE target_type='ADMIN_PRINCIPAL' AND target_id=$1 ORDER BY action,id",
      [principalId],
    );
    expect(events.rows.map((event) => event.action)).toEqual(
      [
        "ADMIN_PRINCIPAL_CREATED",
        "ADMIN_ROLE_GRANTED",
        "ADMIN_ROLE_REVOKED",
        "ADMIN_ROLE_GRANTED",
        "ADMIN_PRINCIPAL_SUSPENDED",
        "ADMIN_PRINCIPAL_RESTORED",
      ].sort(),
    );
    expect(events.rows.every((event) => event.actor_id === ownerId)).toBe(true);
  });
});

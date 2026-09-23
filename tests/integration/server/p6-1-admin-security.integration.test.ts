import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AdminAuthService,
  deriveAdminAuthKeys,
  permissionsForRoles,
  type AdminRole,
} from "../../../packages/server/admin-auth/src/index.js";
import {
  createAdminAuthRepository,
  createDatabaseRuntime,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for P6.1 integration tests");
let db: DatabaseRuntime;
const now = new Date("2030-01-01T00:00:00.000Z");
const keys = deriveAdminAuthKeys(Buffer.alloc(32, 8));
const repo = () => createAdminAuthRepository(db);
const service = () =>
  new AdminAuthService(
    repo(),
    keys,
    () => now,
    () => "A".repeat(43),
  );
async function q<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) {
  return db.query<T>(text, values);
}
async function clear() {
  await q(
    "TRUNCATE admin_sessions,admin_role_grants,admin_principals,audit_events,portal_sessions,user_identities,accounts,users CASCADE",
  );
}
async function user(
  email = `user-${randomUUID()}@example.test`,
  status = "ACTIVE",
  verified = true,
) {
  const userId = randomUUID();
  await q("INSERT INTO users(id,status) VALUES($1,$2)", [userId, status]);
  await q(
    "INSERT INTO user_identities(user_id,provider,normalized_identifier,verified_at) VALUES($1,'EMAIL',$2,$3)",
    [userId, email, verified ? now : null],
  );
  return { userId, email };
}
async function portal(userId: string, ageMs = 0) {
  const id = randomUUID();
  await q(
    "INSERT INTO portal_sessions(id,user_id,created_at,expires_at,session_token_hash) VALUES($1,$2,$3,$4,$5)",
    [
      id,
      userId,
      new Date(now.getTime() - ageMs),
      new Date(now.getTime() + 86_400_000),
      `portal-${id}`,
    ],
  );
  return id;
}
async function principal(userId: string, role: AdminRole = "ADMIN_OWNER") {
  const id = randomUUID();
  await q("INSERT INTO admin_principals(id,user_id) VALUES($1,$2)", [
    id,
    userId,
  ]);
  await q(
    "INSERT INTO admin_role_grants(admin_principal_id,role) VALUES($1,$2)",
    [id, role],
  );
  return id;
}
async function elevate(userId: string, ageMs = 0) {
  const source = await portal(userId, ageMs);
  const result = await service().createAdminSession(
    { sessionId: source, userId, createdAt: new Date(now.getTime() - ageMs) },
    "p6-correlation",
  );
  return { result, source };
}

describe.sequential("P6.1 admin security foundation on real PostgreSQL", () => {
  beforeAll(async () => {
    db = createDatabaseRuntime(connectionString);
    await db.ready();
    await runMigrations({ connectionString });
  });
  beforeEach(clear);
  afterAll(async () => db.close());

  it("migration creates exactly the three admin tables", async () => {
    const rows = await q<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'admin_%' ORDER BY table_name",
    );
    expect(rows.rows.map((r) => r.table_name)).toEqual([
      "admin_principals",
      "admin_role_grants",
      "admin_sessions",
    ]);
  });
  it("includes the complete current migration journal through 0033", async () => {
    const rows = await q<{ count: string }>(
      "SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations",
    );
    expect(rows.rows[0]!.count).toBe("23");
  });
  it("principal user binding is unique", async () => {
    const u = await user();
    await q("INSERT INTO admin_principals(user_id) VALUES($1)", [u.userId]);
    await expect(
      q("INSERT INTO admin_principals(user_id) VALUES($1)", [u.userId]),
    ).rejects.toBeInstanceOf(Error);
  });
  it("principal deletion is rejected", async () => {
    const u = await user();
    const p = await principal(u.userId);
    await expect(
      q("DELETE FROM admin_principals WHERE id=$1", [p]),
    ).rejects.toBeInstanceOf(Error);
  });
  it("principal revision is positive", async () => {
    const u = await user();
    const p = await principal(u.userId);
    await expect(
      q("UPDATE admin_principals SET revision=0 WHERE id=$1", [p]),
    ).rejects.toBeInstanceOf(Error);
  });
  it("principal identity is immutable", async () => {
    const a = await user();
    const b = await user();
    const p = await principal(a.userId);
    await expect(
      q("UPDATE admin_principals SET user_id=$2 WHERE id=$1", [p, b.userId]),
    ).rejects.toBeInstanceOf(Error);
  });
  it("role grant active uniqueness is enforced", async () => {
    const u = await user();
    const p = await principal(u.userId);
    await expect(
      q(
        "INSERT INTO admin_role_grants(admin_principal_id,role) VALUES($1,'ADMIN_OWNER')",
        [p],
      ),
    ).rejects.toBeInstanceOf(Error);
  });
  it("revoked role history is retained", async () => {
    const u = await user();
    const p = await principal(u.userId);
    await q(
      "UPDATE admin_role_grants SET revoked_at=$2,revoked_by_admin_principal_id=$1 WHERE admin_principal_id=$1",
      [p, now],
    );
    expect((await q("SELECT * FROM admin_role_grants")).rows).toHaveLength(1);
  });
  it("role history deletion is rejected", async () => {
    const u = await user();
    const p = await principal(u.userId);
    await expect(
      q("DELETE FROM admin_role_grants WHERE admin_principal_id=$1", [p]),
    ).rejects.toBeInstanceOf(Error);
  });
  it("session token hash is unique", async () => {
    const a = await user();
    const p = await principal(a.userId);
    const s = await portal(a.userId);
    const values = [
      randomUUID(),
      p,
      s,
      "same-hash",
      now,
      new Date(now.getTime() + 1_000),
    ];
    await q(
      "INSERT INTO admin_sessions(id,admin_principal_id,source_portal_session_id,session_token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
      values,
    );
    await expect(
      q(
        "INSERT INTO admin_sessions(id,admin_principal_id,source_portal_session_id,session_token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
        [randomUUID(), p, s, "same-hash", now, new Date(now.getTime() + 1_000)],
      ),
    ).rejects.toBeInstanceOf(Error);
  });
  it("session deletion is rejected", async () => {
    const u = await user();
    const p = await principal(u.userId);
    const s = await portal(u.userId);
    const id = randomUUID();
    await q(
      "INSERT INTO admin_sessions(id,admin_principal_id,source_portal_session_id,session_token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
      [id, p, s, "delete-hash", now, new Date(now.getTime() + 1_000)],
    );
    await expect(
      q("DELETE FROM admin_sessions WHERE id=$1", [id]),
    ).rejects.toBeInstanceOf(Error);
  });
  it("session expiry shape is enforced", async () => {
    const u = await user();
    const p = await principal(u.userId);
    const s = await portal(u.userId);
    await expect(
      q(
        "INSERT INTO admin_sessions(admin_principal_id,source_portal_session_id,session_token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$4)",
        [p, s, "expiry-hash", now],
      ),
    ).rejects.toBeInstanceOf(Error);
  });
  it("cross-user session insertion is rejected by the trigger", async () => {
    const a = await user();
    const b = await user();
    const p = await principal(a.userId);
    const s = await portal(b.userId);
    await expect(
      q(
        "INSERT INTO admin_sessions(admin_principal_id,source_portal_session_id,session_token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",
        [p, s, "cross-user", now, new Date(now.getTime() + 1_000)],
      ),
    ).rejects.toBeInstanceOf(Error);
  });
  it("bootstrap succeeds for a verified active email", async () => {
    const u = await user("owner@example.test");
    const result = await service().bootstrapOwner(u.email, "bootstrap-1");
    expect(result.ok).toBe(true);
    expect((await q("SELECT role FROM admin_role_grants")).rows[0]!.role).toBe(
      "ADMIN_OWNER",
    );
  });
  it("bootstrap finds normalized email", async () => {
    await user("mixed@example.test");
    expect(
      (await service().bootstrapOwner(" MIXED@EXAMPLE.TEST ", "bootstrap-2"))
        .ok,
    ).toBe(true);
  });
  it("bootstrap rejects unknown email", async () => {
    expect(
      await service().bootstrapOwner("missing@example.test", "bootstrap-3"),
    ).toEqual({ ok: false, code: "ADMIN_BOOTSTRAP_USER_NOT_FOUND" });
  });
  it("bootstrap rejects unverified email", async () => {
    await user("unverified@example.test", "ACTIVE", false);
    expect(
      (await service().bootstrapOwner("unverified@example.test", "bootstrap-4"))
        .code,
    ).toBe("ADMIN_BOOTSTRAP_USER_NOT_FOUND");
  });
  it("bootstrap rejects suspended user", async () => {
    await user("suspended@example.test", "SUSPENDED");
    expect(
      (await service().bootstrapOwner("suspended@example.test", "bootstrap-5"))
        .code,
    ).toBe("ADMIN_BOOTSTRAP_USER_INACTIVE");
  });
  it("bootstrap closes after first active role", async () => {
    await user("one@example.test");
    await service().bootstrapOwner("one@example.test", "bootstrap-6");
    await user("two@example.test");
    expect(
      (await service().bootstrapOwner("two@example.test", "bootstrap-7")).code,
    ).toBe("ADMIN_BOOTSTRAP_CLOSED");
  });
  it("bootstrap writes exact system audit", async () => {
    const u = await user("audit-owner@example.test");
    const result = await service().bootstrapOwner(
      u.email,
      "operator-correlation",
    );
    const rows = await q<{
      actor_type: string;
      actor_id: string | null;
      action: string;
      target_type: string;
      correlation_id: string;
      safe_metadata: Record<string, unknown>;
    }>(
      "SELECT actor_type,actor_id,action,target_type,correlation_id,safe_metadata FROM audit_events",
    );
    expect(result.ok && rows.rows[0]).toMatchObject({
      actor_type: "SYSTEM",
      actor_id: null,
      action: "ADMIN_OWNER_BOOTSTRAPPED",
      target_type: "ADMIN_PRINCIPAL",
      correlation_id: "operator-correlation",
      safe_metadata: { role: "ADMIN_OWNER", userId: u.userId },
    });
  });
  it("bootstrap audit has no email or token", async () => {
    const u = await user("private-owner@example.test");
    await service().bootstrapOwner(u.email, "bootstrap-privacy");
    expect(
      JSON.stringify((await q("SELECT safe_metadata FROM audit_events")).rows),
    ).not.toMatch(/private-owner|token|csrf/i);
  });
  it("concurrent bootstrap has exactly one winner", async () => {
    await user("race-a@example.test");
    await user("race-b@example.test");
    const results = await Promise.all([
      service().bootstrapOwner("race-a@example.test", "race-a"),
      service().bootstrapOwner("race-b@example.test", "race-b"),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      (await q("SELECT count(*) FROM admin_role_grants")).rows[0]!.count,
    ).toBe("1");
  });
  it("fresh source portal session elevates", async () => {
    const u = await user();
    await principal(u.userId);
    expect((await elevate(u.userId)).result.ok).toBe(true);
  });
  it("source portal at fifteen minutes elevates", async () => {
    const u = await user();
    await principal(u.userId);
    expect((await elevate(u.userId, 900_000)).result.ok).toBe(true);
  });
  it("source portal over fifteen minutes is rejected", async () => {
    const u = await user();
    await principal(u.userId);
    expect((await elevate(u.userId, 900_001)).result.code).toBe(
      "ADMIN_REAUTH_REQUIRED",
    );
  });
  it("source portal revoked is rejected", async () => {
    const u = await user();
    await principal(u.userId);
    const x = await elevate(u.userId);
    expect(x.result.ok).toBe(true);
    await q(
      "UPDATE portal_sessions SET revoked_at=$2,revoke_reason='TEST' WHERE id=$1",
      [x.source, now],
    );
    expect(
      (
        await service().createAdminSession(
          { sessionId: x.source, userId: u.userId, createdAt: now },
          "revoked",
        )
      ).code,
    ).toBe("ADMIN_FORBIDDEN");
  });
  it("source portal expired is rejected", async () => {
    const u = await user();
    await principal(u.userId);
    const s = await portal(u.userId);
    await q("UPDATE portal_sessions SET expires_at=$2 WHERE id=$1", [
      s,
      new Date(now.getTime() - 1),
    ]);
    expect(
      (
        await service().createAdminSession(
          { sessionId: s, userId: u.userId, createdAt: now },
          "expired",
        )
      ).code,
    ).toBe("ADMIN_FORBIDDEN");
  });
  it("principal suspension blocks elevation", async () => {
    const u = await user();
    const p = await principal(u.userId);
    await q("UPDATE admin_principals SET status='SUSPENDED' WHERE id=$1", [p]);
    expect((await elevate(u.userId)).result.code).toBe(
      "ADMIN_PRINCIPAL_SUSPENDED",
    );
  });
  it("no active role blocks elevation", async () => {
    const u = await user();
    await q("INSERT INTO admin_principals(user_id) VALUES($1)", [u.userId]);
    expect((await elevate(u.userId)).result.code).toBe("ADMIN_FORBIDDEN");
  });
  it("user suspension blocks elevation", async () => {
    const u = await user();
    await principal(u.userId);
    await q("UPDATE users SET status='SUSPENDED' WHERE id=$1", [u.userId]);
    expect((await elevate(u.userId)).result.code).toBe("ADMIN_FORBIDDEN");
  });
  it("admin session stores a hash and not plaintext token", async () => {
    const u = await user();
    await principal(u.userId);
    const x = await elevate(u.userId);
    expect(x.result.ok).toBe(true);
    expect(
      (await q("SELECT session_token_hash FROM admin_sessions")).rows[0]!
        .session_token_hash,
    ).not.toBe("A".repeat(43));
  });
  it("admin session has thirty minute expiry", async () => {
    const u = await user();
    await principal(u.userId);
    await elevate(u.userId);
    const row = (
      await q<{ created_at: Date; expires_at: Date }>(
        "SELECT created_at,expires_at FROM admin_sessions",
      )
    ).rows[0]!;
    expect(
      new Date(row.expires_at).getTime() - new Date(row.created_at).getTime(),
    ).toBe(1_800_000);
  });
  it("created session audit is exact", async () => {
    const u = await user();
    await principal(u.userId);
    await elevate(u.userId);
    expect(
      (
        await q(
          "SELECT action,actor_type,target_type FROM audit_events WHERE action='ADMIN_SESSION_CREATED'",
        )
      ).rows[0],
    ).toMatchObject({
      action: "ADMIN_SESSION_CREATED",
      actor_type: "USER",
      target_type: "ADMIN_SESSION",
    });
  });
  it("created audit omits token/hash/csrf", async () => {
    const u = await user();
    await principal(u.userId);
    await elevate(u.userId);
    expect(
      JSON.stringify((await q("SELECT safe_metadata FROM audit_events")).rows),
    ).not.toMatch(/token|hash|csrf/i);
  });
  it("authenticated admin session projects roles", async () => {
    const u = await user();
    await principal(u.userId, "ADMIN_SUPPORT");
    const x = await elevate(u.userId);
    expect(x.result.ok && x.result.value.subject.roles).toEqual([
      "ADMIN_SUPPORT",
    ]);
  });
  it("admin token replay authenticates same session", async () => {
    const u = await user();
    await principal(u.userId);
    const x = await elevate(u.userId);
    if (!x.result.ok) throw new Error("elevation failed");
    const a = await service().authenticateAdminSession(
      x.result.value.sessionToken,
    );
    const b = await service().authenticateAdminSession(
      x.result.value.sessionToken,
    );
    expect(
      a.ok && b.ok && a.value.adminSessionId === b.value.adminSessionId,
    ).toBe(true);
    expect(
      (await q("SELECT count(*) FROM admin_sessions")).rows[0]!.count,
    ).toBe("1");
  });
  it("suspended principal invalidates an existing session", async () => {
    const u = await user();
    const p = await principal(u.userId);
    const x = await elevate(u.userId);
    await q("UPDATE admin_principals SET status='SUSPENDED' WHERE id=$1", [p]);
    if (!x.result.ok) throw new Error("elevation failed");
    expect(
      (await service().authenticateAdminSession(x.result.value.sessionToken))
        .code,
    ).toBe("ADMIN_PRINCIPAL_SUSPENDED");
  });
  it("source portal revocation invalidates an existing session", async () => {
    const u = await user();
    await principal(u.userId);
    const x = await elevate(u.userId);
    if (!x.result.ok) throw new Error("elevation failed");
    await q(
      "UPDATE portal_sessions SET revoked_at=$2,revoke_reason='TEST' WHERE id=$1",
      [x.source, now],
    );
    expect(
      (await service().authenticateAdminSession(x.result.value.sessionToken))
        .code,
    ).toBe("ADMIN_SESSION_EXPIRED");
  });
  it("source portal expiry invalidates an existing session", async () => {
    const u = await user();
    await principal(u.userId);
    const x = await elevate(u.userId);
    if (!x.result.ok) throw new Error("elevation failed");
    await q("UPDATE portal_sessions SET expires_at=$2 WHERE id=$1", [
      x.source,
      new Date(now.getTime() - 1),
    ]);
    expect(
      (await service().authenticateAdminSession(x.result.value.sessionToken))
        .code,
    ).toBe("ADMIN_SESSION_EXPIRED");
  });
  it("user suspension invalidates an existing session", async () => {
    const u = await user();
    await principal(u.userId);
    const x = await elevate(u.userId);
    if (!x.result.ok) throw new Error("elevation failed");
    await q("UPDATE users SET status='SUSPENDED' WHERE id=$1", [u.userId]);
    expect(
      (await service().authenticateAdminSession(x.result.value.sessionToken))
        .code,
    ).toBe("ADMIN_PRINCIPAL_SUSPENDED");
  });
  it("expired admin session is rejected", async () => {
    const u = await user();
    await principal(u.userId);
    const x = await elevate(u.userId);
    if (!x.result.ok) throw new Error("elevation failed");
    expect(
      (
        await new AdminAuthService(
          repo(),
          keys,
          () => new Date(now.getTime() + 1_800_001),
          () => "A".repeat(43),
        ).authenticateAdminSession(x.result.value.sessionToken)
      ).code,
    ).toBe("ADMIN_SESSION_EXPIRED");
  });
  it("admin revoke is audited", async () => {
    const u = await user();
    await principal(u.userId);
    const x = await elevate(u.userId);
    if (!x.result.ok) throw new Error("elevation failed");
    expect(
      (
        await service().revokeAdminSession(
          x.result.value.sessionToken,
          x.result.value.subject.adminPrincipalId,
          "logout",
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await q(
          "SELECT action,actor_type,target_type FROM audit_events WHERE action='ADMIN_SESSION_REVOKED'",
        )
      ).rows[0],
    ).toMatchObject({
      action: "ADMIN_SESSION_REVOKED",
      actor_type: "ADMIN",
      target_type: "ADMIN_SESSION",
    });
  });
  it("admin revoke is idempotently missing after first revoke", async () => {
    const u = await user();
    await principal(u.userId);
    const x = await elevate(u.userId);
    if (!x.result.ok) throw new Error("elevation failed");
    const s = service();
    await s.revokeAdminSession(
      x.result.value.sessionToken,
      x.result.value.subject.adminPrincipalId,
      "logout",
    );
    expect(
      (
        await s.revokeAdminSession(
          x.result.value.sessionToken,
          x.result.value.subject.adminPrincipalId,
          "logout-2",
        )
      ).code,
    ).toBe("ADMIN_UNAUTHORIZED");
  });
  it("revoked session remains in history", async () => {
    const u = await user();
    await principal(u.userId);
    const x = await elevate(u.userId);
    if (!x.result.ok) throw new Error("elevation failed");
    await service().revokeAdminSession(
      x.result.value.sessionToken,
      x.result.value.subject.adminPrincipalId,
      "logout",
    );
    expect(
      (await q("SELECT revoked_at,revoke_reason FROM admin_sessions")).rows[0],
    ).toMatchObject({ revoke_reason: "LOGOUT" });
  });
  it("owner has every frozen permission in PostgreSQL-backed projection", async () => {
    const u = await user();
    await principal(u.userId, "ADMIN_OWNER");
    const x = await elevate(u.userId);
    expect(x.result.ok && x.result.value.subject.permissions).toEqual(
      permissionsForRoles(["ADMIN_OWNER"]),
    );
  });
  for (const role of [
    "ADMIN_OPS",
    "ADMIN_SUPPORT",
    "ADMIN_BILLING_READONLY",
  ] as const)
    it(`persists and authenticates ${role}`, async () => {
      const u = await user();
      await principal(u.userId, role);
      const x = await elevate(u.userId);
      expect(x.result.ok && x.result.value.subject.roles).toEqual([role]);
    });
  it("ops allows subscription grant", async () => {
    expect(permissionsForRoles(["ADMIN_OPS"])).toContain("subscription.grant");
  });
  it("ops allows subscription extend", async () => {
    expect(permissionsForRoles(["ADMIN_OPS"])).toContain("subscription.extend");
  });
  it("ops allows device revoke", async () => {
    expect(permissionsForRoles(["ADMIN_OPS"])).toContain("device.revoke");
  });
  it("ops denies plan manage", async () => {
    expect(permissionsForRoles(["ADMIN_OPS"])).not.toContain("plan.manage");
  });
  it("ops denies price manage", async () => {
    expect(permissionsForRoles(["ADMIN_OPS"])).not.toContain("price.manage");
  });
  it("ops denies entitlement override", async () => {
    expect(permissionsForRoles(["ADMIN_OPS"])).not.toContain(
      "entitlement.override",
    );
  });
  it("support denies subscription grant", async () => {
    expect(permissionsForRoles(["ADMIN_SUPPORT"])).not.toContain(
      "subscription.grant",
    );
  });
  it("support denies subscription extend", async () => {
    expect(permissionsForRoles(["ADMIN_SUPPORT"])).not.toContain(
      "subscription.extend",
    );
  });
  it("support allows device revoke", async () => {
    expect(permissionsForRoles(["ADMIN_SUPPORT"])).toContain("device.revoke");
  });
  it("billing readonly allows billing read", async () => {
    expect(permissionsForRoles(["ADMIN_BILLING_READONLY"])).toContain(
      "billing.read",
    );
  });
  it("billing readonly denies all representative mutations", async () => {
    const p = permissionsForRoles(["ADMIN_BILLING_READONLY"]);
    expect(p).not.toContain("device.revoke");
    expect(p).not.toContain("subscription.grant");
    expect(p).not.toContain("plan.manage");
  });
  it("multiple persisted roles union permissions", async () => {
    const u = await user();
    const p = await principal(u.userId, "ADMIN_SUPPORT");
    await q(
      "INSERT INTO admin_role_grants(admin_principal_id,role) VALUES($1,'ADMIN_OPS')",
      [p],
    );
    const x = await elevate(u.userId);
    expect(x.result.ok && x.result.value.subject.permissions).toContain(
      "subscription.grant",
    );
  });
  it("revoked role is excluded from permissions", async () => {
    const u = await user();
    const p = await principal(u.userId, "ADMIN_SUPPORT");
    const owner = randomUUID();
    await q(
      "INSERT INTO admin_role_grants(id,admin_principal_id,role,revoked_at,revoked_by_admin_principal_id) VALUES($1,$2,'ADMIN_OPS',$3,$2)",
      [owner, p, now],
    );
    const x = await elevate(u.userId);
    expect(x.result.ok && x.result.value.subject.roles).toEqual([
      "ADMIN_SUPPORT",
    ]);
  });
  it("unknown code permission fails closed", async () => {
    const u = await user();
    await principal(u.userId);
    const x = await elevate(u.userId);
    if (!x.result.ok) throw new Error("elevation failed");
    expect(
      service().authorize(x.result.value.subject, "admin.unknown"),
    ).toEqual({ ok: false, code: "ADMIN_FORBIDDEN" });
  });
  it("unknown database role cannot be inserted", async () => {
    const u = await user();
    const p = await principal(u.userId);
    await expect(
      q(
        "INSERT INTO admin_role_grants(admin_principal_id,role) VALUES($1,'ADMIN_UNKNOWN')",
        [p],
      ),
    ).rejects.toBeInstanceOf(Error);
  });
  it("account membership is not needed for admin elevation", async () => {
    const u = await user();
    await principal(u.userId);
    expect((await elevate(u.userId)).result.ok).toBe(true);
  });
  it("account owner membership does not grant admin elevation", async () => {
    const u = await user();
    await q("INSERT INTO accounts(id) VALUES($1)", [randomUUID()]);
    expect((await elevate(u.userId)).result.code).toBe("ADMIN_FORBIDDEN");
  });
  it("admin session source user is persisted separately", async () => {
    const u = await user();
    await principal(u.userId);
    const x = await elevate(u.userId);
    expect(
      (await q("SELECT source_portal_session_id FROM admin_sessions")).rows[0]!
        .source_portal_session_id,
    ).toBe(x.source);
  });
  it("admin principal is separate from portal session identity", async () => {
    const u = await user();
    await principal(u.userId);
    const x = await elevate(u.userId);
    expect(
      (await q("SELECT admin_principal_id FROM admin_sessions")).rows[0]!
        .admin_principal_id,
    ).toBe(x.result.ok ? x.result.value.subject.adminPrincipalId : "");
  });
  it("session revoke reason is coherent", async () => {
    const u = await user();
    await principal(u.userId);
    const x = await elevate(u.userId);
    if (!x.result.ok) throw new Error("elevation failed");
    await service().revokeAdminSession(
      x.result.value.sessionToken,
      x.result.value.subject.adminPrincipalId,
      "coherent",
    );
    expect(
      (
        await q(
          "SELECT revoked_at IS NOT NULL AS revoked,revoke_reason IS NOT NULL AS reason FROM admin_sessions",
        )
      ).rows[0],
    ).toEqual({ revoked: true, reason: true });
  });
  it("fresh portal session is required even with an active role", async () => {
    const u = await user();
    await principal(u.userId);
    expect((await elevate(u.userId, 900_001)).result.code).toBe(
      "ADMIN_REAUTH_REQUIRED",
    );
  });
  it("failed freshness does not create admin session", async () => {
    const u = await user();
    await principal(u.userId);
    await elevate(u.userId, 900_001);
    expect(
      (await q("SELECT count(*) FROM admin_sessions")).rows[0]!.count,
    ).toBe("0");
  });
  it("failed no-role elevation does not audit a created session", async () => {
    const u = await user();
    await q("INSERT INTO admin_principals(user_id) VALUES($1)", [u.userId]);
    await elevate(u.userId);
    expect(
      (
        await q(
          "SELECT count(*) FROM audit_events WHERE action='ADMIN_SESSION_CREATED'",
        )
      ).rows[0]!.count,
    ).toBe("0");
  });
  it("admin session audience uses a distinct table", async () => {
    expect(
      (await q("SELECT count(*) FROM admin_sessions")).rows[0]!.count,
    ).toBe("0");
    expect(
      (await q("SELECT to_regclass('public.portal_sessions')")).rows[0]!
        .to_regclass,
    ).toBe("portal_sessions");
  });
  it("role revocation permits historical regrant", async () => {
    const u = await user();
    const p = await principal(u.userId, "ADMIN_SUPPORT");
    await q(
      "UPDATE admin_role_grants SET revoked_at=$2,revoked_by_admin_principal_id=$1 WHERE admin_principal_id=$1",
      [p, now],
    );
    await q(
      "INSERT INTO admin_role_grants(admin_principal_id,role) VALUES($1,'ADMIN_SUPPORT')",
      [p],
    );
    expect(
      (await q("SELECT count(*) FROM admin_role_grants")).rows[0]!.count,
    ).toBe("2");
  });
  it("bootstrap reuses an existing principal", async () => {
    const u = await user("reuse@example.test");
    const p = await principal(u.userId, "ADMIN_SUPPORT");
    await q(
      "UPDATE admin_role_grants SET revoked_at=$2,revoked_by_admin_principal_id=$1 WHERE admin_principal_id=$1",
      [p, now],
    );
    const result = await service().bootstrapOwner(u.email, "reuse");
    expect(result.ok && result.value.principalId).toBe(p);
  });
  it("audit failure rolls back bootstrap", async () => {
    const u = await user("rollback-bootstrap@example.test");
    await q(
      "CREATE OR REPLACE FUNCTION p6_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END; $$",
    );
    await q(
      "CREATE TRIGGER p6_test_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION p6_test_audit_failure()",
    );
    try {
      expect(
        (await service().bootstrapOwner(u.email, "rollback-bootstrap")).code,
      ).toBe("SERVICE_UNAVAILABLE");
    } finally {
      await q("DROP TRIGGER p6_test_audit_failure ON audit_events");
      await q("DROP FUNCTION p6_test_audit_failure()");
    }
    expect(
      (await q("SELECT count(*) FROM admin_principals")).rows[0]!.count,
    ).toBe("0");
    expect(
      (await q("SELECT count(*) FROM admin_role_grants")).rows[0]!.count,
    ).toBe("0");
  });
  it("audit failure rolls back admin session creation", async () => {
    const u = await user();
    await principal(u.userId);
    const source = await portal(u.userId);
    await q(
      "CREATE OR REPLACE FUNCTION p6_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END; $$",
    );
    await q(
      "CREATE TRIGGER p6_test_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION p6_test_audit_failure()",
    );
    try {
      expect(
        (
          await service().createAdminSession(
            { sessionId: source, userId: u.userId, createdAt: now },
            "rollback-session",
          )
        ).code,
      ).toBe("SERVICE_UNAVAILABLE");
    } finally {
      await q("DROP TRIGGER p6_test_audit_failure ON audit_events");
      await q("DROP FUNCTION p6_test_audit_failure()");
    }
    expect(
      (await q("SELECT count(*) FROM admin_sessions")).rows[0]!.count,
    ).toBe("0");
  });
  it("audit failure rolls back admin session revoke", async () => {
    const u = await user();
    await principal(u.userId);
    const x = await elevate(u.userId);
    if (!x.result.ok) throw new Error("elevation failed");
    await q(
      "CREATE OR REPLACE FUNCTION p6_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END; $$",
    );
    await q(
      "CREATE TRIGGER p6_test_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION p6_test_audit_failure()",
    );
    try {
      expect(
        (
          await service().revokeAdminSession(
            x.result.value.sessionToken,
            x.result.value.subject.adminPrincipalId,
            "rollback-revoke",
          )
        ).code,
      ).toBe("SERVICE_UNAVAILABLE");
    } finally {
      await q("DROP TRIGGER p6_test_audit_failure ON audit_events");
      await q("DROP FUNCTION p6_test_audit_failure()");
    }
    expect(
      (await q("SELECT revoked_at FROM admin_sessions")).rows[0]!.revoked_at,
    ).toBeNull();
  });
});

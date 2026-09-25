import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAdminOpsRepository,
  createDatabaseRuntime,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import type { AdminRole } from "../../../packages/server/admin-auth/src/index.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for P6.2 integration tests");
let db: DatabaseRuntime;
const at = new Date("2030-01-01T00:00:00.000Z");
const actorId = "00000000-0000-4000-8000-000000000001";
const q = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => db.query<T>(text, values);
const roles: AdminRole[] = [
  "ADMIN_OWNER",
  "ADMIN_OPS",
  "ADMIN_SUPPORT",
  "ADMIN_BILLING_READONLY",
];

async function clean() {
  await q(
    "TRUNCATE admin_sessions,admin_role_grants,admin_principals,audit_events,sessions,devices,account_memberships,user_identities,portal_sessions,accounts,users CASCADE",
  );
}
async function makeUser(index = 0, status = "ACTIVE", verified = true) {
  const id = randomUUID();
  const email = `p62-${index}-${id}@example.test`;
  await q(
    "INSERT INTO users(id,status,created_at,updated_at) VALUES($1,$2,$3,$3)",
    [id, status, at],
  );
  await q(
    "INSERT INTO user_identities(user_id,provider,normalized_identifier,verified_at,created_at,updated_at) VALUES($1,'EMAIL',$2,$3,$4,$4)",
    [id, email, verified ? at : null, at],
  );
  return { id, email };
}
async function makeAccount(ownerId: string, status = "ACTIVE") {
  const id = randomUUID();
  await q(
    "INSERT INTO accounts(id,status,display_name,created_at,updated_at) VALUES($1,$2,$3,$4,$4)",
    [id, status, "Safe account", at],
  );
  await q(
    "INSERT INTO account_memberships(account_id,user_id,role,created_at) VALUES($1,$2,'OWNER',$3)",
    [id, ownerId, at],
  );
  return id;
}
async function makePrincipal(
  userId: string,
  role: AdminRole = "ADMIN_OWNER",
  id = randomUUID(),
) {
  await q(
    "INSERT INTO admin_principals(id,user_id,created_at,updated_at) VALUES($1,$2,$3,$3)",
    [id, userId, at],
  );
  await q(
    "INSERT INTO admin_role_grants(admin_principal_id,role,granted_at) VALUES($1,$2,$3)",
    [id, role, at],
  );
  return id;
}
async function makeDevice(accountId: string, userId: string) {
  const id = randomUUID();
  await q(
    "INSERT INTO devices(id,account_id,created_by_user_id,status,browser_family,extension_version_last_seen,created_at) VALUES($1,$2,$3,'ACTIVE','chrome','1.0.0',$4)",
    [id, accountId, userId, at],
  );
  const sessionId = randomUUID();
  await q(
    "INSERT INTO sessions(id,device_id,account_id,status,token_family_id,created_at) VALUES($1,$2,$3,'ACTIVE',$4,$5)",
    [sessionId, id, accountId, randomUUID(), at],
  );
  return { id, sessionId };
}
async function addEmail(
  userId: string,
  email: string,
  verifiedAt: Date | null = at,
) {
  await q(
    "INSERT INTO user_identities(user_id,provider,normalized_identifier,verified_at,created_at,updated_at) VALUES($1,'EMAIL',$2,$3,$4,$4)",
    [userId, email, verifiedAt, at],
  );
}
async function addAuditEvent(
  action: string,
  overrides: {
    targetType?: string;
    targetId?: string;
    actorType?: string;
    actorId?: string | null;
    correlationId?: string;
    reason?: string | null;
    safeMetadata?: unknown;
  } = {},
) {
  const id = randomUUID();
  await q(
    "INSERT INTO audit_events(id,actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)",
    [
      id,
      overrides.actorType ?? "ADMIN",
      overrides.actorId === undefined ? actorId : overrides.actorId,
      action,
      overrides.targetType ?? "DEVICE",
      overrides.targetId ?? id,
      overrides.correlationId ?? `corr-${id}`,
      overrides.reason === undefined ? "private reason" : overrides.reason,
      overrides.safeMetadata === undefined
        ? JSON.stringify({ private: true })
        : overrides.safeMetadata === null
          ? null
          : JSON.stringify(overrides.safeMetadata),
      at,
    ],
  );
  return id;
}

describe.sequential("P6.2 admin operations on real PostgreSQL", () => {
  beforeAll(async () => {
    db = createDatabaseRuntime(connectionString);
    await db.ready();
    await runMigrations({ connectionString });
  });
  beforeEach(clean);
  afterAll(async () => db.close());

  it.each([
    { filter: {}, expected: 2 },
    { filter: { status: "ACTIVE" }, expected: 1 },
    { filter: { status: "SUSPENDED" }, expected: 1 },
    { filter: { ownerUserId: "owner" }, expected: 2 },
    { filter: { ownerEmail: "OWNER" }, expected: 2 },
    { filter: { limit: 1 }, expected: 1 },
    { filter: { accountId: "account" }, expected: 1 },
    { filter: { ownerEmail: "missing@example.test" }, expected: 0 },
    { filter: { status: "ACTIVE", ownerEmail: "OWNER" }, expected: 1 },
    { filter: { status: "SUSPENDED", ownerEmail: "OWNER" }, expected: 1 },
    { filter: { status: "ACTIVE", accountId: "account" }, expected: 1 },
    { filter: { status: "SUSPENDED", accountId: "account" }, expected: 0 },
    {
      filter: { ownerUserId: "00000000-0000-4000-8000-000000000099" },
      expected: 0,
    },
    {
      filter: { accountId: "00000000-0000-0000-0000-000000000099" },
      expected: 0,
    },
  ])("account lookup case %#", async ({ filter, expected }) => {
    const owner = await makeUser(1);
    const account = await makeAccount(owner.id);
    const suspended = await makeAccount(owner.id, "SUSPENDED");
    const input = Object.fromEntries(
      Object.entries(filter).map(([key, value]) => [
        key,
        value === "owner"
          ? owner.id
          : value === "account"
            ? account
            : value === "OWNER"
              ? owner.email
              : value,
      ]),
    );
    const result = await createAdminOpsRepository(db).listAccounts(
      input as never,
    );
    expect("kind" in result ? result.kind : result.items.length).toBe(expected);
    expect(suspended).toBeTruthy();
  });

  it.each([
    { field: "userId" },
    { field: "email" },
    { field: "status" },
    { field: "limit" },
  ])("user exact/filter lookup case %# (%s)", async ({ field }) => {
    const user = await makeUser(2);
    await makeUser(3, "SUSPENDED", false);
    const input =
      field === "userId"
        ? { userId: user.id }
        : field === "email"
          ? { email: user.email }
          : field === "status"
            ? { status: "ACTIVE" as const }
            : { limit: 1 };
    const result = await createAdminOpsRepository(db).listUsers(input);
    expect(
      "kind" in result ? result.kind : result.items.length,
    ).toBeGreaterThanOrEqual(1);
    if (!("kind" in result))
      expect(result.items[0]!.emails[0]!.email).toMatch(/@example\.test$/);
  });

  it.each(roles)(
    "principal active-role projection is sorted for %s",
    async (role) => {
      const owner = await makeUser(4);
      const target = await makeUser(5);
      await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
      const targetId = await makePrincipal(target.id, role);
      const result = await createAdminOpsRepository(db).listPrincipals({
        principalId: targetId,
        limit: 1,
      });
      expect("kind" in result ? result.kind : result.items[0]!.roles).toEqual(
        "kind" in result ? undefined : [role],
      );
    },
  );

  it.each([
    "ADMIN_PRINCIPAL_CREATED",
    "ADMIN_ROLE_GRANTED",
    "ADMIN_ROLE_REVOKED",
    "ADMIN_PRINCIPAL_SUSPENDED",
    "ADMIN_PRINCIPAL_RESTORED",
    "ADMIN_DEVICE_REVOKED",
    "EXTENSION_SESSION_REVOKED",
    "AUTH_LOGIN_DENIED",
    "DEVICE_REVOKED",
    "PORTAL_SESSION_CREATED",
    "DEVICE_ACTIVATED",
    "REFRESH_ROTATED",
    "ADMIN_SESSION_CREATED",
    "ADMIN_SESSION_REVOKED",
    "ADMIN_OWNER_BOOTSTRAPPED",
    "AUTH_OTP_VERIFIED",
    "DEVICE_AUTH_APPROVED",
    "DEVICE_AUTH_DENIED",
    "REFRESH_REUSE",
    "BILLING_EVENT_APPLIED",
    "SUBSCRIPTION_GRANTED",
    "SUBSCRIPTION_EXTENDED",
    "SUBSCRIPTION_SUSPENDED",
    "SUBSCRIPTION_RESTORED",
    "CONFIG_RELEASE_PUBLISHED",
  ])("audit safe envelope filter %s", async (action) => {
    const id = randomUUID();
    await q(
      "INSERT INTO audit_events(id,actor_type,action,target_type,target_id,correlation_id,reason,safe_metadata,created_at) VALUES($1,'ADMIN',$2,'DEVICE',$1,'p62-correlation','private reason','{\"private\":true}'::jsonb,$3)",
      [id, action, at],
    );
    const result = await createAdminOpsRepository(db).listAuditEvents({
      action,
      limit: 1,
    });
    expect("kind" in result ? result.kind : result.items[0]!.action).toBe(
      action,
    );
    if (!("kind" in result))
      expect(result.items[0]).not.toHaveProperty("reason");
  });

  it.each(["ACTIVE", "REVOKED", undefined])(
    "device account-scoped safe list case %#",
    async (status) => {
      const owner = await makeUser(6);
      const account = await makeAccount(owner.id);
      if (status !== undefined) {
        const device = await makeDevice(account, owner.id);
        if (status === "REVOKED")
          await q(
            "UPDATE devices SET status='REVOKED',revoked_at=$2 WHERE id=$1",
            [device.id, at],
          );
      }
      const result = await createAdminOpsRepository(db).listDevices({
        accountId: account,
        status: status as "ACTIVE" | "REVOKED" | undefined,
        limit: 1,
      });
      expect("kind" in result ? result.kind : result.items).toEqual(
        "kind" in result
          ? undefined
          : status === undefined
            ? []
            : [expect.objectContaining({ status })],
      );
    },
  );

  it("projects admin device metadata as PRESENT or WITHHELD without fabricated legacy fields", async () => {
    const owner = await makeUser(72);
    const account = await makeAccount(owner.id);
    const present = await makeDevice(account, owner.id);
    const withheld = await makeDevice(account, owner.id);
    await q(
      "UPDATE devices SET browser_family=NULL,browser_version_last_seen=NULL,extension_version_last_seen=NULL WHERE id=$1",
      [withheld.id],
    );
    const result = await createAdminOpsRepository(db).listDevices({
      accountId: account,
      limit: 10,
    });
    expect("kind" in result).toBe(false);
    if ("kind" in result) return;
    const presentItem = result.items.find((item) => item.id === present.id);
    const withheldItem = result.items.find((item) => item.id === withheld.id);
    expect(presentItem).toMatchObject({
      clientMetadata: {
        state: "PRESENT",
        browserFamily: "chrome",
        browserVersion: null,
        extensionVersion: "1.0.0",
      },
      browserFamily: "chrome",
      browserVersionLastSeen: null,
      extensionVersionLastSeen: "1.0.0",
    });
    expect(withheldItem).toMatchObject({
      clientMetadata: { state: "WITHHELD" },
    });
    expect(withheldItem).not.toHaveProperty("browserFamily");
    expect(withheldItem).not.toHaveProperty("browserVersionLastSeen");
    expect(withheldItem).not.toHaveProperty("extensionVersionLastSeen");
  });

  it.each(roles)(
    "principal creation accepts exact initial role %s",
    async (initialRole) => {
      const owner = await makeUser(7);
      const target = await makeUser(8);
      await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
      const result = await createAdminOpsRepository(db).createPrincipal({
        userId: target.id,
        initialRole,
        actorId,
        correlationId: "p62-create",
        reason: "ticket",
      });
      expect(result.kind).toBe("OK");
      if (result.kind === "OK") {
        expect(result.principal.revision).toBe(1);
        expect(result.principal.roles).toEqual([initialRole]);
      }
    },
  );

  it("redacts secret-shaped reasons before admin audit persistence", async () => {
    const owner = await makeUser(70);
    const target = await makeUser(71);
    await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    const result = await createAdminOpsRepository(db).createPrincipal({
      userId: target.id,
      initialRole: "ADMIN_SUPPORT",
      actorId,
      correlationId: "p62-redacted-reason",
      reason: "token=supersecretvalue Bearer abcdefghijklmnopqrstuvwxyz123456",
    });
    expect(result.kind).toBe("OK");
    const rows = await q<{ reason: string }>(
      "SELECT reason FROM audit_events WHERE correlation_id='p62-redacted-reason' ORDER BY created_at",
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      expect(row.reason).not.toContain("supersecretvalue");
      expect(row.reason).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
      expect(row.reason).toContain("[REDACTED");
    }
  });

  it("cursor must be from the current account filter", async () => {
    const owner = await makeUser(9);
    const first = await makeAccount(owner.id);
    const second = await makeAccount(owner.id);
    const repository = createAdminOpsRepository(db);
    const page = await repository.listAccounts({ limit: 1 });
    expect("kind" in page).toBe(false);
    if (!("kind" in page)) {
      const wrong = await repository.listAccounts({
        status: "SUSPENDED",
        cursor: page.nextCursor,
      });
      expect("kind" in wrong).toBe(true);
      expect("kind" in wrong && wrong.kind).toBe("INVALID_CURSOR");
    }
    expect(first).not.toBe(second);
  });

  it.each(roles)(
    "transaction-time role grant for %s increments revision once",
    async (role) => {
      const owner = await makeUser(10);
      const target = await makeUser(11);
      await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
      const targetId = await makePrincipal(
        target.id,
        role === "ADMIN_SUPPORT" ? "ADMIN_OPS" : "ADMIN_SUPPORT",
      );
      const result = await createAdminOpsRepository(db).grantRole({
        principalId: targetId,
        role,
        expectedRevision: 1,
        actorId,
        correlationId: "p62-grant",
        reason: "ticket",
      });
      expect(result.kind).toBe("OK");
      if (result.kind === "OK") expect(result.principal.revision).toBe(2);
    },
  );
  it("stale role grant is rejected without audit", async () => {
    const owner = await makeUser(12);
    const target = await makeUser(13);
    await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    const targetId = await makePrincipal(target.id, "ADMIN_SUPPORT");
    const result = await createAdminOpsRepository(db).grantRole({
      principalId: targetId,
      role: "ADMIN_OPS",
      expectedRevision: 9,
      actorId,
      correlationId: "p62-stale",
      reason: "ticket",
    });
    expect(result).toEqual({ kind: "STALE" });
    expect(
      (await q("SELECT count(*)::text AS count FROM audit_events")).rows[0]!
        .count,
    ).toBe("0");
  });
  it("role revoke preserves history and changes revision", async () => {
    const owner = await makeUser(14);
    const target = await makeUser(15);
    await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    const targetId = await makePrincipal(target.id, "ADMIN_OPS");
    const result = await createAdminOpsRepository(db).revokeRole({
      principalId: targetId,
      role: "ADMIN_OPS",
      expectedRevision: 1,
      actorId,
      correlationId: "p62-revoke",
      reason: "ticket",
    });
    expect(result.kind).toBe("OK");
    expect(
      (
        await q(
          "SELECT count(*)::text AS count FROM admin_role_grants WHERE admin_principal_id=$1",
          [targetId],
        )
      ).rows[0]!.count,
    ).toBe("1");
  });
  it("single active owner cannot revoke its owner role", async () => {
    const owner = await makeUser(16);
    await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    const result = await createAdminOpsRepository(db).revokeRole({
      principalId: actorId,
      role: "ADMIN_OWNER",
      expectedRevision: 1,
      actorId,
      correlationId: "p62-owner",
      reason: "ticket",
    });
    expect(result).toEqual({ kind: "LAST_OWNER" });
  });
  it("two owners permit one owner role removal", async () => {
    const owner = await makeUser(17);
    const second = await makeUser(18);
    await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    const secondId = await makePrincipal(second.id, "ADMIN_OWNER");
    const result = await createAdminOpsRepository(db).revokeRole({
      principalId: actorId,
      role: "ADMIN_OWNER",
      expectedRevision: 1,
      actorId,
      correlationId: "p62-two-owner",
      reason: "ticket",
    });
    expect(result.kind).toBe("OK");
    expect(secondId).toMatch(/[0-9a-f-]{36}/);
  });
  it("suspend revokes active admin sessions and restore does not reopen them", async () => {
    const owner = await makeUser(19);
    const target = await makeUser(20);
    await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    const targetId = await makePrincipal(target.id, "ADMIN_SUPPORT");
    const portalId = randomUUID();
    await q(
      "INSERT INTO portal_sessions(id,user_id,created_at,expires_at,session_token_hash) VALUES($1,$2,$3,$4,$5)",
      [
        portalId,
        target.id,
        at,
        new Date(at.getTime() + 3600000),
        "portal-target",
      ],
    );
    await q(
      "INSERT INTO admin_sessions(id,admin_principal_id,source_portal_session_id,session_token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
      [
        randomUUID(),
        targetId,
        portalId,
        "target-session",
        at,
        new Date(at.getTime() + 3600000),
      ],
    );
    const repository = createAdminOpsRepository(db);
    const suspended = await repository.setPrincipalStatus({
      principalId: targetId,
      status: "SUSPENDED",
      expectedRevision: 1,
      actorId,
      correlationId: "p62-suspend",
      reason: "ticket",
    });
    expect(suspended.kind).toBe("OK");
    if (suspended.kind === "OK") expect(suspended.revokedSessionCount).toBe(1);
    const restored = await repository.setPrincipalStatus({
      principalId: targetId,
      status: "ACTIVE",
      expectedRevision: 2,
      actorId,
      correlationId: "p62-restore",
      reason: "ticket",
    });
    expect(restored.kind).toBe("OK");
    expect(
      (
        await q(
          "SELECT revoked_at FROM admin_sessions WHERE session_token_hash='target-session'",
        )
      ).rows[0]!.revoked_at,
    ).not.toBeNull();
  });
  it("single active owner cannot be suspended", async () => {
    const owner = await makeUser(21);
    await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    const result = await createAdminOpsRepository(db).setPrincipalStatus({
      principalId: actorId,
      status: "SUSPENDED",
      expectedRevision: 1,
      actorId,
      correlationId: "p62-suspend-owner",
      reason: "ticket",
    });
    expect(result).toEqual({ kind: "LAST_OWNER" });
  });
  it("admin device revoke is atomic, audited, and idempotent", async () => {
    const owner = await makeUser(22);
    const account = await makeAccount(owner.id);
    await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    const device = await makeDevice(account, owner.id);
    const repository = createAdminOpsRepository(db);
    expect(
      await repository.revokeDevice({
        accountId: account,
        deviceId: device.id,
        actorId,
        correlationId: "p62-device",
        reason: "support ticket",
      }),
    ).toBe("REVOKED");
    expect(
      (await q("SELECT status FROM devices WHERE id=$1", [device.id])).rows[0]!
        .status,
    ).toBe("REVOKED");
    expect(
      (await q("SELECT status FROM sessions WHERE id=$1", [device.sessionId]))
        .rows[0]!.status,
    ).toBe("REVOKED");
    expect(
      await repository.revokeDevice({
        accountId: account,
        deviceId: device.id,
        actorId,
        correlationId: "p62-device-2",
        reason: "duplicate",
      }),
    ).toBe("ALREADY_REVOKED");
    expect(
      (
        await q(
          "SELECT action,actor_type FROM audit_events WHERE target_id=$1 ORDER BY created_at",
          [device.id],
        )
      ).rows[0],
    ).toMatchObject({ action: "ADMIN_DEVICE_REVOKED", actor_type: "ADMIN" });
  });

  // A: account/user reads — each case changes the query scope or projection.
  it("account cursor is rejected when the owner scope changes", async () => {
    const firstOwner = await makeUser(30);
    const secondOwner = await makeUser(31);
    await makeAccount(firstOwner.id);
    await makeAccount(secondOwner.id);
    const repository = createAdminOpsRepository(db);
    const page = await repository.listAccounts({
      ownerUserId: firstOwner.id,
      limit: 1,
    });
    expect("kind" in page).toBe(false);
    if (!("kind" in page) && page.nextCursor) {
      expect(
        await repository.listAccounts({
          ownerUserId: secondOwner.id,
          cursor: page.nextCursor,
          limit: 1,
        }),
      ).toEqual({ kind: "INVALID_CURSOR" });
    }
  });

  it("user cursor is rejected when the status scope changes", async () => {
    await makeUser(32);
    await makeUser(33, "SUSPENDED");
    const repository = createAdminOpsRepository(db);
    const page = await repository.listUsers({ status: "ACTIVE", limit: 1 });
    expect("kind" in page).toBe(false);
    if (!("kind" in page) && page.nextCursor)
      expect(
        await repository.listUsers({
          status: "SUSPENDED",
          cursor: page.nextCursor,
          limit: 1,
        }),
      ).toEqual({ kind: "INVALID_CURSOR" });
  });

  it("user cursor continues the same filtered result set", async () => {
    await makeUser(34);
    await makeUser(35);
    const repository = createAdminOpsRepository(db);
    const page = await repository.listUsers({ limit: 1 });
    expect("kind" in page).toBe(false);
    if (!("kind" in page)) {
      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBeTruthy();
      const next = await repository.listUsers({
        cursor: page.nextCursor,
        limit: 1,
      });
      expect("kind" in next ? next.kind : next.items).not.toEqual(
        "INVALID_CURSOR",
      );
      if (!("kind" in next)) expect(next.items).toHaveLength(1);
    }
  });

  it("multiple email identities are returned in deterministic order with verification state", async () => {
    const user = await makeUser(36);
    await addEmail(user.id, "zeta@example.test", null);
    await addEmail(user.id, "alpha@example.test");
    const result = await createAdminOpsRepository(db).listUsers({
      userId: user.id,
      limit: 1,
    });
    expect("kind" in result).toBe(false);
    if (!("kind" in result)) {
      expect(result.items[0]!.emails.map((email) => email.email)).toEqual([
        "alpha@example.test",
        user.email,
        "zeta@example.test",
      ]);
      expect(result.items[0]!.emails[0]!.verifiedAt).not.toBeNull();
      expect(result.items[0]!.emails[2]!.verifiedAt).toBeNull();
    }
  });

  it("user safe projection preserves ACTIVE and SUSPENDED statuses", async () => {
    const active = await makeUser(37);
    const suspended = await makeUser(38, "SUSPENDED");
    const result = await createAdminOpsRepository(db).listUsers({ limit: 2 });
    expect("kind" in result).toBe(false);
    if (!("kind" in result)) {
      expect(result.items.find((item) => item.id === active.id)?.status).toBe(
        "ACTIVE",
      );
      expect(
        result.items.find((item) => item.id === suspended.id)?.status,
      ).toBe("SUSPENDED");
    }
  });

  // C: device reads/revoke — account scope, status state, and role boundaries.
  it("device cursor is rejected when the account changes", async () => {
    const owner = await makeUser(39);
    const first = await makeAccount(owner.id);
    const second = await makeAccount(owner.id);
    const device = await makeDevice(first, owner.id);
    const repository = createAdminOpsRepository(db);
    const page = await repository.listDevices({ accountId: first, limit: 1 });
    expect("kind" in page).toBe(false);
    if (!("kind" in page))
      expect(
        await repository.listDevices({
          accountId: second,
          cursor: device.id,
          limit: 1,
        }),
      ).toEqual({ kind: "INVALID_CURSOR" });
  });

  it("device revoke rejects a device paired with another account", async () => {
    const owner = await makeUser(40);
    const first = await makeAccount(owner.id);
    const second = await makeAccount(owner.id);
    await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    const device = await makeDevice(first, owner.id);
    expect(
      await createAdminOpsRepository(db).revokeDevice({
        accountId: second,
        deviceId: device.id,
        actorId,
        correlationId: "p62-wrong-device-account",
        reason: "ticket",
      }),
    ).toBe("NOT_FOUND");
    expect(
      (await q("SELECT status FROM devices WHERE id=$1", [device.id])).rows[0]!
        .status,
    ).toBe("ACTIVE");
  });

  it("ADMIN_OPS can revoke an active device", async () => {
    const owner = await makeUser(41);
    const account = await makeAccount(owner.id);
    const operator = await makeUser(42);
    const operatorId = await makePrincipal(operator.id, "ADMIN_OPS");
    const device = await makeDevice(account, owner.id);
    expect(
      await createAdminOpsRepository(db).revokeDevice({
        accountId: account,
        deviceId: device.id,
        actorId: operatorId,
        correlationId: "p62-ops-revoke",
        reason: "ticket",
      }),
    ).toBe("REVOKED");
  });

  it("ADMIN_SUPPORT can revoke an active device", async () => {
    const owner = await makeUser(43);
    const account = await makeAccount(owner.id);
    const support = await makeUser(44);
    const supportId = await makePrincipal(support.id, "ADMIN_SUPPORT");
    const device = await makeDevice(account, owner.id);
    expect(
      await createAdminOpsRepository(db).revokeDevice({
        accountId: account,
        deviceId: device.id,
        actorId: supportId,
        correlationId: "p62-support-revoke",
        reason: "ticket",
      }),
    ).toBe("REVOKED");
  });

  it("ADMIN_BILLING_READONLY is denied device revocation", async () => {
    const owner = await makeUser(45);
    const account = await makeAccount(owner.id);
    const billing = await makeUser(46);
    const billingId = await makePrincipal(billing.id, "ADMIN_BILLING_READONLY");
    const device = await makeDevice(account, owner.id);
    expect(
      await createAdminOpsRepository(db).revokeDevice({
        accountId: account,
        deviceId: device.id,
        actorId: billingId,
        correlationId: "p62-billing-revoke",
        reason: "ticket",
      }),
    ).toBe("FORBIDDEN");
  });

  it("device revoke rechecks actor permissions after role removal", async () => {
    const owner = await makeUser(47);
    const account = await makeAccount(owner.id);
    const operator = await makeUser(48);
    const ownerPrincipal = await makePrincipal(
      owner.id,
      "ADMIN_OWNER",
      actorId,
    );
    const operatorId = await makePrincipal(operator.id, "ADMIN_OPS");
    const device = await makeDevice(account, owner.id);
    expect(
      await createAdminOpsRepository(db).revokeRole({
        principalId: operatorId,
        role: "ADMIN_OPS",
        expectedRevision: 1,
        actorId: ownerPrincipal,
        correlationId: "p62-remove-device-permission",
        reason: "ticket",
      }),
    ).toMatchObject({ kind: "OK" });
    expect(
      await createAdminOpsRepository(db).revokeDevice({
        accountId: account,
        deviceId: device.id,
        actorId: operatorId,
        correlationId: "p62-removed-permission",
        reason: "ticket",
      }),
    ).toBe("FORBIDDEN");
  });

  it("device revoke invalidates every active session for the device", async () => {
    const owner = await makeUser(49);
    const account = await makeAccount(owner.id);
    await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    const device = await makeDevice(account, owner.id);
    await q(
      "INSERT INTO sessions(id,device_id,account_id,status,token_family_id,created_at) VALUES($1,$2,$3,'ACTIVE',$4,$5)",
      [randomUUID(), device.id, account, randomUUID(), at],
    );
    expect(
      await createAdminOpsRepository(db).revokeDevice({
        accountId: account,
        deviceId: device.id,
        actorId,
        correlationId: "p62-all-sessions",
        reason: "ticket",
      }),
    ).toBe("REVOKED");
    expect(
      (
        await q(
          "SELECT count(*)::text AS count FROM sessions WHERE device_id=$1 AND status='REVOKED'",
          [device.id],
        )
      ).rows[0]!.count,
    ).toBe("2");
  });

  // E: audit-read privacy and all supported filter dimensions.
  it("audit target type filter is applied", async () => {
    await addAuditEvent("FILTER_TARGET_TYPE", { targetType: "PRINCIPAL" });
    await addAuditEvent("FILTER_TARGET_TYPE", { targetType: "DEVICE" });
    const result = await createAdminOpsRepository(db).listAuditEvents({
      targetType: "PRINCIPAL",
      limit: 10,
    });
    expect(
      "kind" in result
        ? result.kind
        : result.items.map((item) => item.targetType),
    ).toEqual(["PRINCIPAL"]);
  });

  it("audit target id filter is applied", async () => {
    const targetId = randomUUID();
    await addAuditEvent("FILTER_TARGET_ID", { targetId });
    await addAuditEvent("FILTER_TARGET_ID", { targetId: randomUUID() });
    const result = await createAdminOpsRepository(db).listAuditEvents({
      targetId,
      limit: 10,
    });
    expect(
      "kind" in result
        ? result.kind
        : result.items.map((item) => item.targetId),
    ).toEqual([targetId]);
  });

  it("audit actor type filter is applied", async () => {
    await addAuditEvent("FILTER_ACTOR_TYPE", { actorType: "ADMIN" });
    await addAuditEvent("FILTER_ACTOR_TYPE", { actorType: "SYSTEM" });
    const result = await createAdminOpsRepository(db).listAuditEvents({
      actorType: "SYSTEM",
      limit: 10,
    });
    expect(
      "kind" in result
        ? result.kind
        : result.items.map((item) => item.actorType),
    ).toEqual(["SYSTEM"]);
  });

  it("audit actor id filter is applied", async () => {
    const otherActor = randomUUID();
    await addAuditEvent("FILTER_ACTOR_ID", { actorId: otherActor });
    await addAuditEvent("FILTER_ACTOR_ID", { actorId });
    const result = await createAdminOpsRepository(db).listAuditEvents({
      actorId: otherActor,
      limit: 10,
    });
    expect(
      "kind" in result ? result.kind : result.items.map((item) => item.actorId),
    ).toEqual([otherActor]);
  });

  it("audit correlation filter is applied", async () => {
    await addAuditEvent("FILTER_CORRELATION", {
      correlationId: "wanted-correlation",
    });
    await addAuditEvent("FILTER_CORRELATION", {
      correlationId: "other-correlation",
    });
    const result = await createAdminOpsRepository(db).listAuditEvents({
      correlationId: "wanted-correlation",
      limit: 10,
    });
    expect(
      "kind" in result
        ? result.kind
        : result.items.map((item) => item.correlationId),
    ).toEqual(["wanted-correlation"]);
  });

  it("audit cursor is scoped to the requested correlation", async () => {
    await addAuditEvent("CURSOR_SCOPE", { correlationId: "cursor-wanted" });
    await addAuditEvent("CURSOR_SCOPE", { correlationId: "cursor-wanted" });
    const repository = createAdminOpsRepository(db);
    const page = await repository.listAuditEvents({
      correlationId: "cursor-wanted",
      limit: 1,
    });
    expect("kind" in page).toBe(false);
    if (!("kind" in page) && page.nextCursor)
      expect(
        await repository.listAuditEvents({
          correlationId: "cursor-other",
          cursor: page.nextCursor,
          limit: 1,
        }),
      ).toEqual({ kind: "INVALID_CURSOR" });
  });

  it("audit safe projection omits reason and safe metadata when storage omits them", async () => {
    await addAuditEvent("NULL_PRIVATE_FIELDS", {
      reason: null,
      safeMetadata: null,
    });
    const result = await createAdminOpsRepository(db).listAuditEvents({
      action: "NULL_PRIVATE_FIELDS",
      limit: 1,
    });
    expect("kind" in result).toBe(false);
    if (!("kind" in result)) {
      expect(result.items[0]).not.toHaveProperty("reason");
      expect(result.items[0]).not.toHaveProperty("safeMetadata");
    }
  });

  // F: principal reads and filtered deterministic projections.
  it("principal user id filter returns the matching principal", async () => {
    const user = await makeUser(50);
    const principalId = await makePrincipal(user.id, "ADMIN_SUPPORT");
    const result = await createAdminOpsRepository(db).listPrincipals({
      userId: user.id,
      limit: 1,
    });
    expect("kind" in result ? result.kind : result.items[0]!.principalId).toBe(
      principalId,
    );
  });

  it("principal status filter excludes suspended principals", async () => {
    const active = await makeUser(51);
    const suspended = await makeUser(52);
    const activeId = await makePrincipal(active.id, "ADMIN_SUPPORT");
    const suspendedId = await makePrincipal(suspended.id, "ADMIN_SUPPORT");
    await q("UPDATE admin_principals SET status='SUSPENDED' WHERE id=$1", [
      suspendedId,
    ]);
    const result = await createAdminOpsRepository(db).listPrincipals({
      status: "ACTIVE",
      limit: 10,
    });
    expect(
      "kind" in result
        ? result.kind
        : result.items.map((item) => item.principalId),
    ).toEqual([activeId]);
  });

  it("principal role filter follows active grants only", async () => {
    const first = await makeUser(53);
    const second = await makeUser(54);
    const firstId = await makePrincipal(first.id, "ADMIN_OPS");
    const secondId = await makePrincipal(second.id, "ADMIN_SUPPORT");
    const result = await createAdminOpsRepository(db).listPrincipals({
      role: "ADMIN_OPS",
      limit: 10,
    });
    expect(
      "kind" in result
        ? result.kind
        : result.items.map((item) => item.principalId),
    ).toEqual([firstId]);
    expect(secondId).not.toBe(firstId);
  });

  it("principal cursor is rejected when the role scope changes", async () => {
    const first = await makeUser(55);
    const second = await makeUser(56);
    await makePrincipal(first.id, "ADMIN_OPS");
    await makePrincipal(second.id, "ADMIN_SUPPORT");
    const repository = createAdminOpsRepository(db);
    const page = await repository.listPrincipals({
      role: "ADMIN_OPS",
      limit: 1,
    });
    expect("kind" in page).toBe(false);
    if (!("kind" in page) && page.nextCursor)
      expect(
        await repository.listPrincipals({
          role: "ADMIN_SUPPORT",
          cursor: page.nextCursor,
          limit: 1,
        }),
      ).toEqual({ kind: "INVALID_CURSOR" });
  });

  it("principal read returns an empty page for a missing user", async () => {
    const result = await createAdminOpsRepository(db).listPrincipals({
      userId: randomUUID(),
      limit: 1,
    });
    expect("kind" in result ? result.kind : result.items).toEqual([]);
  });

  // F/G: creation and role mutation error boundaries.
  it("principal creation rejects an unverified user", async () => {
    const owner = await makeUser(57);
    const target = await makeUser(58, "ACTIVE", false);
    await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    expect(
      await createAdminOpsRepository(db).createPrincipal({
        userId: target.id,
        initialRole: "ADMIN_SUPPORT",
        actorId,
        correlationId: "p62-unverified",
        reason: "ticket",
      }),
    ).toEqual({ kind: "USER_UNVERIFIED" });
  });

  it("principal creation rejects a suspended user", async () => {
    const owner = await makeUser(59);
    const target = await makeUser(60, "SUSPENDED");
    await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    expect(
      await createAdminOpsRepository(db).createPrincipal({
        userId: target.id,
        initialRole: "ADMIN_SUPPORT",
        actorId,
        correlationId: "p62-suspended-user",
        reason: "ticket",
      }),
    ).toEqual({ kind: "USER_INACTIVE" });
  });

  it("principal creation reports a missing user", async () => {
    const owner = await makeUser(61);
    await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    expect(
      await createAdminOpsRepository(db).createPrincipal({
        userId: randomUUID(),
        initialRole: "ADMIN_SUPPORT",
        actorId,
        correlationId: "p62-missing-user",
        reason: "ticket",
      }),
    ).toEqual({ kind: "USER_NOT_FOUND" });
  });

  it("principal creation rejects an existing principal conflict", async () => {
    const owner = await makeUser(62);
    const target = await makeUser(63);
    await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    await makePrincipal(target.id, "ADMIN_SUPPORT");
    expect(
      await createAdminOpsRepository(db).createPrincipal({
        userId: target.id,
        initialRole: "ADMIN_OPS",
        actorId,
        correlationId: "p62-principal-conflict",
        reason: "ticket",
      }),
    ).toEqual({ kind: "CONFLICT" });
  });

  it("duplicate role grant is rejected without changing revision", async () => {
    const owner = await makeUser(64);
    const target = await makeUser(65);
    await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    const targetId = await makePrincipal(target.id, "ADMIN_SUPPORT");
    expect(
      await createAdminOpsRepository(db).grantRole({
        principalId: targetId,
        role: "ADMIN_SUPPORT",
        expectedRevision: 1,
        actorId,
        correlationId: "p62-duplicate-grant",
        reason: "ticket",
      }),
    ).toEqual({ kind: "CONFLICT" });
    expect(
      (await q("SELECT revision FROM admin_principals WHERE id=$1", [targetId]))
        .rows[0]!.revision,
    ).toBe(1);
  });

  it("role revoke on an inactive principal is a conflict", async () => {
    const owner = await makeUser(66);
    const target = await makeUser(67);
    await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    const targetId = await makePrincipal(target.id, "ADMIN_SUPPORT");
    await q("UPDATE admin_principals SET status='SUSPENDED' WHERE id=$1", [
      targetId,
    ]);
    expect(
      await createAdminOpsRepository(db).revokeRole({
        principalId: targetId,
        role: "ADMIN_SUPPORT",
        expectedRevision: 1,
        actorId,
        correlationId: "p62-inactive-revoke",
        reason: "ticket",
      }),
    ).toEqual({ kind: "CONFLICT" });
  });

  it("role regrant after historical revoke creates a new active grant", async () => {
    const owner = await makeUser(68);
    const target = await makeUser(69);
    await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    const targetId = await makePrincipal(target.id, "ADMIN_OPS");
    const repository = createAdminOpsRepository(db);
    expect(
      await repository.revokeRole({
        principalId: targetId,
        role: "ADMIN_OPS",
        expectedRevision: 1,
        actorId,
        correlationId: "p62-revoke-history",
        reason: "ticket",
      }),
    ).toMatchObject({ kind: "OK" });
    const regrant = await repository.grantRole({
      principalId: targetId,
      role: "ADMIN_OPS",
      expectedRevision: 2,
      actorId,
      correlationId: "p62-regrant-history",
      reason: "ticket",
    });
    expect(regrant).toMatchObject({
      kind: "OK",
      principal: { revision: 3, roles: ["ADMIN_OPS"] },
    });
    expect(
      (
        await q(
          "SELECT count(*)::text AS count FROM admin_role_grants WHERE admin_principal_id=$1",
          [targetId],
        )
      ).rows[0]!.count,
    ).toBe("2");
  });

  it("role revoke reports a missing target", async () => {
    const owner = await makeUser(70);
    await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    expect(
      await createAdminOpsRepository(db).revokeRole({
        principalId: randomUUID(),
        role: "ADMIN_SUPPORT",
        expectedRevision: 1,
        actorId,
        correlationId: "p62-missing-target",
        reason: "ticket",
      }),
    ).toEqual({ kind: "NOT_FOUND" });
  });

  it("billing readonly cannot mutate principal roles", async () => {
    const billing = await makeUser(71);
    const target = await makeUser(72);
    const billingId = await makePrincipal(billing.id, "ADMIN_BILLING_READONLY");
    const targetId = await makePrincipal(target.id, "ADMIN_SUPPORT");
    expect(
      await createAdminOpsRepository(db).grantRole({
        principalId: targetId,
        role: "ADMIN_OPS",
        expectedRevision: 1,
        actorId: billingId,
        correlationId: "p62-billing-role-mutation",
        reason: "ticket",
      }),
    ).toEqual({ kind: "FORBIDDEN" });
  });

  it("removing an actor role dynamically removes its mutation permission", async () => {
    const owner = await makeUser(73);
    const operator = await makeUser(74);
    const target = await makeUser(75);
    const ownerId = await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    const operatorId = await makePrincipal(operator.id, "ADMIN_OPS");
    const targetId = await makePrincipal(target.id, "ADMIN_SUPPORT");
    expect(
      await createAdminOpsRepository(db).revokeRole({
        principalId: operatorId,
        role: "ADMIN_OPS",
        expectedRevision: 1,
        actorId: ownerId,
        correlationId: "p62-dynamic-reduction",
        reason: "ticket",
      }),
    ).toMatchObject({ kind: "OK" });
    expect(
      await createAdminOpsRepository(db).grantRole({
        principalId: targetId,
        role: "ADMIN_OPS",
        expectedRevision: 1,
        actorId: operatorId,
        correlationId: "p62-removed-manage",
        reason: "ticket",
      }),
    ).toEqual({ kind: "FORBIDDEN" });
  });

  it("stale role revoke is rejected", async () => {
    const owner = await makeUser(76);
    const target = await makeUser(77);
    await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    const targetId = await makePrincipal(target.id, "ADMIN_SUPPORT");
    const repository = createAdminOpsRepository(db);
    await repository.grantRole({
      principalId: targetId,
      role: "ADMIN_OPS",
      expectedRevision: 1,
      actorId,
      correlationId: "p62-stale-revoke-prep",
      reason: "ticket",
    });
    expect(
      await repository.revokeRole({
        principalId: targetId,
        role: "ADMIN_SUPPORT",
        expectedRevision: 1,
        actorId,
        correlationId: "p62-stale-revoke",
        reason: "ticket",
      }),
    ).toEqual({ kind: "STALE" });
  });

  // L/N: status transitions, session invalidation, rollback, and concurrency.
  it("duplicate suspension is an idempotent no-op", async () => {
    const owner = await makeUser(78);
    const target = await makeUser(79);
    await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    const targetId = await makePrincipal(target.id, "ADMIN_SUPPORT");
    const repository = createAdminOpsRepository(db);
    expect(
      await repository.setPrincipalStatus({
        principalId: targetId,
        status: "SUSPENDED",
        expectedRevision: 1,
        actorId,
        correlationId: "p62-suspend-once",
        reason: "ticket",
      }),
    ).toMatchObject({ kind: "OK", changed: true, revokedSessionCount: 0 });
    expect(
      await repository.setPrincipalStatus({
        principalId: targetId,
        status: "SUSPENDED",
        expectedRevision: 2,
        actorId,
        correlationId: "p62-suspend-twice",
        reason: "ticket",
      }),
    ).toMatchObject({ kind: "OK", changed: false, revokedSessionCount: 0 });
  });

  it("duplicate restoration is an idempotent no-op", async () => {
    const owner = await makeUser(80);
    const target = await makeUser(81);
    await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    const targetId = await makePrincipal(target.id, "ADMIN_SUPPORT");
    const repository = createAdminOpsRepository(db);
    await repository.setPrincipalStatus({
      principalId: targetId,
      status: "SUSPENDED",
      expectedRevision: 1,
      actorId,
      correlationId: "p62-restore-prep",
      reason: "ticket",
    });
    await repository.setPrincipalStatus({
      principalId: targetId,
      status: "ACTIVE",
      expectedRevision: 2,
      actorId,
      correlationId: "p62-restore-once",
      reason: "ticket",
    });
    expect(
      await repository.setPrincipalStatus({
        principalId: targetId,
        status: "ACTIVE",
        expectedRevision: 3,
        actorId,
        correlationId: "p62-restore-twice",
        reason: "ticket",
      }),
    ).toMatchObject({ kind: "OK", changed: false, revokedSessionCount: 0 });
  });

  it("audit failure rolls back a role mutation and its revision", async () => {
    const owner = await makeUser(82);
    const target = await makeUser(83);
    await makePrincipal(owner.id, "ADMIN_OWNER", actorId);
    const targetId = await makePrincipal(target.id, "ADMIN_SUPPORT");
    await q(
      "CREATE OR REPLACE FUNCTION p62_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ADMIN_ROLE_GRANTED' THEN RAISE EXCEPTION 'p62 audit failure'; END IF; RETURN NEW; END; $$",
    );
    await q(
      "CREATE TRIGGER p62_fail_audit_trigger BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION p62_fail_audit()",
    );
    try {
      await expect(
        createAdminOpsRepository(db).grantRole({
          principalId: targetId,
          role: "ADMIN_OPS",
          expectedRevision: 1,
          actorId,
          correlationId: "p62-audit-rollback",
          reason: "ticket",
        }),
      ).rejects.toBeInstanceOf(Error);
      expect(
        (
          await q("SELECT revision FROM admin_principals WHERE id=$1", [
            targetId,
          ])
        ).rows[0]!.revision,
      ).toBe(1);
      expect(
        (
          await q(
            "SELECT count(*)::text AS count FROM admin_role_grants WHERE admin_principal_id=$1 AND revoked_at IS NULL",
            [targetId],
          )
        ).rows[0]!.count,
      ).toBe("1");
    } finally {
      await q("DROP TRIGGER p62_fail_audit_trigger ON audit_events");
      await q("DROP FUNCTION p62_fail_audit()");
    }
  });

  it("concurrent removal of two owners leaves exactly one owner", async () => {
    const first = await makeUser(84);
    const second = await makeUser(85);
    await makePrincipal(first.id, "ADMIN_OWNER", actorId);
    const secondId = await makePrincipal(second.id, "ADMIN_OWNER");
    const repository = createAdminOpsRepository(db);
    const results = await Promise.all([
      repository.revokeRole({
        principalId: actorId,
        role: "ADMIN_OWNER",
        expectedRevision: 1,
        actorId,
        correlationId: "p62-owner-race-a",
        reason: "ticket",
      }),
      repository.revokeRole({
        principalId: secondId,
        role: "ADMIN_OWNER",
        expectedRevision: 1,
        actorId: secondId,
        correlationId: "p62-owner-race-b",
        reason: "ticket",
      }),
    ]);
    expect(results.filter((result) => result.kind === "OK")).toHaveLength(1);
    expect(
      results.filter((result) => result.kind === "LAST_OWNER"),
    ).toHaveLength(1);
    expect(
      (
        await q(
          "SELECT count(*)::text AS count FROM admin_principals p JOIN admin_role_grants g ON g.admin_principal_id=p.id WHERE p.status='ACTIVE' AND g.role='ADMIN_OWNER' AND g.revoked_at IS NULL",
        )
      ).rows[0]!.count,
    ).toBe("1");
  });

  it("concurrent grants to one target accept exactly one stale revision", async () => {
    const first = await makeUser(86);
    const second = await makeUser(87);
    const target = await makeUser(88);
    await makePrincipal(first.id, "ADMIN_OWNER", actorId);
    const secondId = await makePrincipal(second.id, "ADMIN_OWNER");
    const targetId = await makePrincipal(target.id, "ADMIN_SUPPORT");
    const repository = createAdminOpsRepository(db);
    const results = await Promise.all([
      repository.grantRole({
        principalId: targetId,
        role: "ADMIN_OPS",
        expectedRevision: 1,
        actorId,
        correlationId: "p62-grant-race-a",
        reason: "ticket",
      }),
      repository.grantRole({
        principalId: targetId,
        role: "ADMIN_OWNER",
        expectedRevision: 1,
        actorId: secondId,
        correlationId: "p62-grant-race-b",
        reason: "ticket",
      }),
    ]);
    expect(results.filter((result) => result.kind === "OK")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "STALE")).toHaveLength(1);
    expect(
      (await q("SELECT revision FROM admin_principals WHERE id=$1", [targetId]))
        .rows[0]!.revision,
    ).toBe(2);
  });
});

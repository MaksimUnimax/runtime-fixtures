import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_ELEVATION_MAX_PORTAL_SESSION_AGE_MS,
  ADMIN_PERMISSIONS,
  ADMIN_ROLES,
  ADMIN_SESSION_TTL_MS,
  AdminAuthService,
  adminCsrfToken,
  adminSessionLookup,
  deriveAdminAuthKeys,
  generateAdminSessionToken,
  permissionsForRole,
  permissionsForRoles,
  verifyAdminCsrf,
  type AdminAuthRepository,
  type AdminRole,
  type AdminSubject,
} from "./index.js";

const root = Buffer.alloc(32, 7);
const keys = deriveAdminAuthKeys(root);
const portal = {
  sessionId: "portal-1",
  userId: "user-1",
  createdAt: new Date("2030-01-01T00:00:00.000Z"),
};
function subject(roles: readonly AdminRole[] = ["ADMIN_OWNER"]): AdminSubject {
  return {
    adminPrincipalId: "principal-1",
    userId: "user-1",
    adminSessionId: "admin-session-1",
    roles: [...roles],
    permissions: permissionsForRoles(roles),
    expiresAt: new Date("2030-01-01T00:30:00.000Z"),
  };
}
function repository(): AdminAuthRepository {
  return {
    createAdminSession: vi.fn(async (input) => ({
      kind: "created" as const,
      subject: { ...subject(), expiresAt: input.expiresAt },
    })),
    authenticateAdminSession: vi.fn(async () => ({
      kind: "authenticated" as const,
      subject: subject(),
    })),
    revokeAdminSession: vi.fn(async () => "revoked" as const),
    bootstrapOwner: vi.fn(async () => ({
      kind: "bootstrapped" as const,
      principalId: "principal-1",
      userId: "user-1",
    })),
  };
}
function service(
  repo = repository(),
  now = () => new Date("2030-01-01T00:00:00Z"),
) {
  return new AdminAuthService(repo, keys, now, () => "A".repeat(43));
}

describe("P6.1 admin crypto and RBAC foundation", () => {
  it("defines the initial roles plus the dedicated beta operator", () => {
    expect(ADMIN_ROLES).toEqual([
      "ADMIN_OWNER",
      "ADMIN_OPS",
      "ADMIN_SUPPORT",
      "ADMIN_BILLING_READONLY",
      "ADMIN_BETA_OPERATOR",
    ]);
  });
  it("defines the frozen permission vocabulary without later domains", () => {
    expect(ADMIN_PERMISSIONS).toHaveLength(30);
    expect(ADMIN_PERMISSIONS).toContain("beta.admission.read");
    expect(ADMIN_PERMISSIONS).toContain("beta.admission.manage");
    expect(ADMIN_PERMISSIONS.filter((p) => p.startsWith("ai."))).toEqual([
      "ai.registry.read",
      "ai.registry.manage",
      "ai.profile.read",
      "ai.profile.manage",
      "ai.assignment.read",
      "ai.assignment.manage",
    ]);
    expect(ADMIN_PERMISSIONS).toContain("health.read");
    expect(ADMIN_PERMISSIONS.some((p) => p.startsWith("diagnostic."))).toBe(
      false,
    );
  });
  it("generates a 32-byte base64url session token", () => {
    const token = generateAdminSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("derives deterministic keyed admin lookup artifacts", () => {
    expect(adminSessionLookup(keys, "token")).toBe(
      adminSessionLookup(keys, "token"),
    );
    expect(adminSessionLookup(keys, "token")).not.toBe(
      adminSessionLookup(keys, "other"),
    );
  });
  it("uses a distinct session crypto domain from the portal artifact", async () => {
    const { portalLookup, deriveAuthKeys } = await import("@product/auth");
    expect(adminSessionLookup(keys, "token")).not.toBe(
      portalLookup(deriveAuthKeys(root), "token"),
    );
  });
  it("derives a distinct admin CSRF domain from portal CSRF", async () => {
    const { csrfToken, deriveAuthKeys } = await import("@product/auth");
    expect(adminCsrfToken(keys, "token")).not.toBe(
      csrfToken(deriveAuthKeys(root), "token"),
    );
  });
  it("validates exact admin double-submit CSRF", () => {
    const token = adminCsrfToken(keys, "session-token");
    expect(verifyAdminCsrf(keys, "session-token", token, token)).toBe(true);
  });
  it("rejects missing admin CSRF header", () => {
    const token = adminCsrfToken(keys, "session-token");
    expect(verifyAdminCsrf(keys, "session-token", undefined, token)).toBe(
      false,
    );
  });
  it("rejects a mismatched admin CSRF cookie", () => {
    const token = adminCsrfToken(keys, "session-token");
    expect(verifyAdminCsrf(keys, "session-token", token, `${token}x`)).toBe(
      false,
    );
  });
  it("rejects admin CSRF copied from the portal domain", async () => {
    const { csrfToken, deriveAuthKeys } = await import("@product/auth");
    const portalCsrf = csrfToken(deriveAuthKeys(root), "session-token");
    expect(verifyAdminCsrf(keys, "session-token", portalCsrf, portalCsrf)).toBe(
      false,
    );
  });
  it("maps owner to every current P6 permission", () => {
    expect(permissionsForRole("ADMIN_OWNER")).toEqual(ADMIN_PERMISSIONS);
  });
  it("gives owner both beta admission permissions", () => {
    expect(permissionsForRole("ADMIN_OWNER")).toEqual(
      expect.arrayContaining(["beta.admission.read", "beta.admission.manage"]),
    );
  });
  it("maps ops to subscription operations and device revoke", () => {
    const permissions = permissionsForRole("ADMIN_OPS");
    expect(permissions).toContain("subscription.grant");
    expect(permissions).toContain("device.revoke");
  });
  it("gives owner every P7 permission", () => {
    expect(permissionsForRole("ADMIN_OWNER")).toEqual(ADMIN_PERMISSIONS);
  });
  it("gives ops every P7 permission", () => {
    expect(permissionsForRole("ADMIN_OPS")).toEqual(
      expect.arrayContaining([
        "ai.registry.read",
        "ai.registry.manage",
        "ai.profile.read",
        "ai.profile.manage",
        "ai.assignment.read",
        "ai.assignment.manage",
      ]),
    );
  });
  it("gives ops Health read without a Health mutation permission", () => {
    const permissions = permissionsForRole("ADMIN_OPS");
    expect(permissions).toContain("health.read");
    expect(permissions).not.toContain("health.manage");
  });
  it("gives support only P7 reads", () => {
    const permissions = permissionsForRole("ADMIN_SUPPORT");
    expect(permissions).toEqual(
      expect.arrayContaining([
        "ai.registry.read",
        "ai.profile.read",
        "ai.assignment.read",
      ]),
    );
    expect(permissions).not.toEqual(
      expect.arrayContaining([
        "ai.registry.manage",
        "ai.profile.manage",
        "ai.assignment.manage",
      ]),
    );
  });
  it("gives billing readonly no P7 permission", () => {
    expect(permissionsForRole("ADMIN_BILLING_READONLY")).not.toEqual(
      expect.arrayContaining(
        ADMIN_PERMISSIONS.filter((p) => p.startsWith("ai.")),
      ),
    );
  });
  it("keeps ops away from plan mutation", () => {
    expect(permissionsForRole("ADMIN_OPS")).not.toContain("plan.manage");
  });
  it("keeps ops away from price mutation", () => {
    expect(permissionsForRole("ADMIN_OPS")).not.toContain("price.manage");
  });
  it("keeps ops away from entitlement override", () => {
    expect(permissionsForRole("ADMIN_OPS")).not.toContain(
      "entitlement.override",
    );
  });
  it("keeps ops away from admin principal management", () => {
    expect(permissionsForRole("ADMIN_OPS")).not.toContain(
      "admin.principal.manage",
    );
  });
  it("allows support device revoke", () => {
    expect(permissionsForRole("ADMIN_SUPPORT")).toContain("device.revoke");
  });
  it("gives support beta read without beta management", () => {
    const permissions = permissionsForRole("ADMIN_SUPPORT");
    expect(permissions).toContain("beta.admission.read");
    expect(permissions).not.toContain("beta.admission.manage");
  });
  it("denies support subscription grant", () => {
    expect(permissionsForRole("ADMIN_SUPPORT")).not.toContain(
      "subscription.grant",
    );
  });
  it("denies support subscription extend", () => {
    expect(permissionsForRole("ADMIN_SUPPORT")).not.toContain(
      "subscription.extend",
    );
  });
  it("denies support subscription suspend", () => {
    expect(permissionsForRole("ADMIN_SUPPORT")).not.toContain(
      "subscription.suspend",
    );
  });
  it("gives billing readonly no mutation permission", () => {
    expect(
      permissionsForRole("ADMIN_BILLING_READONLY").some(
        (p) =>
          p.endsWith(".manage") ||
          p.includes("grant") ||
          p.includes("override") ||
          p.includes("revoke"),
      ),
    ).toBe(false);
  });
  it("keeps beta management exclusive to owner and beta operator", () => {
    expect(permissionsForRole("ADMIN_BETA_OPERATOR")).toEqual([
      "beta.admission.read",
      "beta.admission.manage",
    ]);
    expect(permissionsForRole("ADMIN_OPS")).not.toContain(
      "beta.admission.manage",
    );
    expect(permissionsForRole("ADMIN_BILLING_READONLY")).not.toContain(
      "beta.admission.manage",
    );
  });
  it("fails closed for an unknown role", () => {
    expect(permissionsForRole("ADMIN_UNKNOWN")).toEqual([]);
    expect(permissionsForRoles(["ADMIN_UNKNOWN"])).toEqual([]);
  });
  it("unions multiple roles and sorts permissions", () => {
    const permissions = permissionsForRoles(["ADMIN_SUPPORT", "ADMIN_OPS"]);
    expect(permissions).toContain("subscription.grant");
    expect(permissions).toEqual([...permissions].sort());
  });
  it("uses the 30-minute admin session TTL", async () => {
    const result = await service().createAdminSession(portal, "corr");
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(
        result.value.subject.expiresAt.getTime() -
          Date.parse("2030-01-01T00:00:00Z"),
      ).toBe(ADMIN_SESSION_TTL_MS);
  });
  it("accepts the exact 15-minute portal freshness boundary", async () => {
    const result = await service(
      repository(),
      () => new Date("2030-01-01T00:15:00Z"),
    ).createAdminSession(portal, "corr");
    expect(result.ok).toBe(true);
    expect(ADMIN_ELEVATION_MAX_PORTAL_SESSION_AGE_MS).toBe(900_000);
  });
  it("rejects a portal session one millisecond older than the boundary", async () => {
    const result = await service(
      repository(),
      () => new Date("2030-01-01T00:15:00.001Z"),
    ).createAdminSession(portal, "corr");
    expect(result).toEqual({ ok: false, code: "ADMIN_REAUTH_REQUIRED" });
  });
  it("rejects a portal session created in the future", async () => {
    const result = await service(
      repository(),
      () => new Date("2029-12-31T23:59:59Z"),
    ).createAdminSession(portal, "corr");
    expect(result).toEqual({ ok: false, code: "ADMIN_REAUTH_REQUIRED" });
  });
  it("projects only the safe subject and calculated permissions", async () => {
    const result = await service().authenticateAdminSession("token");
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(Object.keys(result.value).sort()).toEqual([
        "adminPrincipalId",
        "adminSessionId",
        "expiresAt",
        "permissions",
        "roles",
        "userId",
      ]);
  });
  it("maps no-role authentication to unauthorized", async () => {
    const repo = repository();
    repo.authenticateAdminSession = vi.fn(async () => ({
      kind: "unauthorized" as const,
    }));
    expect(await service(repo).authenticateAdminSession("token")).toEqual({
      ok: false,
      code: "ADMIN_UNAUTHORIZED",
    });
  });
  it("maps suspended principals to the typed failure", async () => {
    const repo = repository();
    repo.authenticateAdminSession = vi.fn(async () => ({
      kind: "suspended" as const,
    }));
    expect(await service(repo).authenticateAdminSession("token")).toEqual({
      ok: false,
      code: "ADMIN_PRINCIPAL_SUSPENDED",
    });
  });
  it("maps expired sessions to the typed failure", async () => {
    const repo = repository();
    repo.authenticateAdminSession = vi.fn(async () => ({
      kind: "expired" as const,
    }));
    expect(await service(repo).authenticateAdminSession("token")).toEqual({
      ok: false,
      code: "ADMIN_SESSION_EXPIRED",
    });
  });
  it("authorizes an exact permission only", () => {
    expect(service().authorize(subject(), "plan.manage")).toEqual({
      ok: true,
      value: true,
    });
    expect(
      service().authorize(subject(["ADMIN_SUPPORT"]), "plan.manage"),
    ).toEqual({ ok: false, code: "ADMIN_FORBIDDEN" });
  });
  it("fails closed for an unknown permission", () => {
    expect(service().authorize(subject(), "admin.*")).toEqual({
      ok: false,
      code: "ADMIN_FORBIDDEN",
    });
  });
  it("maps closed bootstrap to ADMIN_BOOTSTRAP_CLOSED", async () => {
    const repo = repository();
    repo.bootstrapOwner = vi.fn(async () => ({ kind: "closed" as const }));
    expect(
      await service(repo).bootstrapOwner("owner@example.test", "corr"),
    ).toEqual({ ok: false, code: "ADMIN_BOOTSTRAP_CLOSED" });
  });
  it("normalizes bootstrap email before repository access", async () => {
    const repo = repository();
    await service(repo).bootstrapOwner(" Owner@Example.TEST ", "corr");
    expect(repo.bootstrapOwner).toHaveBeenCalledWith({
      normalizedEmail: "owner@example.test",
      correlationId: "corr",
    });
  });
  it("rejects malformed bootstrap input", async () => {
    expect(await service().bootstrapOwner("not-an-email", "corr")).toEqual({
      ok: false,
      code: "ADMIN_BOOTSTRAP_USER_NOT_FOUND",
    });
  });
  it("creates no session when elevation is forbidden", async () => {
    const repo = repository();
    repo.createAdminSession = vi.fn(async () => ({
      kind: "forbidden" as const,
    }));
    expect(await service(repo).createAdminSession(portal, "corr")).toEqual({
      ok: false,
      code: "ADMIN_FORBIDDEN",
    });
  });
  it("revoke delegates the hashed token and principal identity", async () => {
    const repo = repository();
    await service(repo).revokeAdminSession("token", "principal-1", "corr");
    expect(repo.revokeAdminSession).toHaveBeenCalledWith({
      sessionTokenHash: adminSessionLookup(keys, "token"),
      adminPrincipalId: "principal-1",
      correlationId: "corr",
    });
  });
});

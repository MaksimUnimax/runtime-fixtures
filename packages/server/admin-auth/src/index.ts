import {
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { normalizeEmail } from "@product/auth";

export const ADMIN_SESSION_TTL_MS = 30 * 60_000;
export const ADMIN_ELEVATION_MAX_PORTAL_SESSION_AGE_MS = 15 * 60_000;
export const ADMIN_ROLES = [
  "ADMIN_OWNER",
  "ADMIN_OPS",
  "ADMIN_SUPPORT",
  "ADMIN_BILLING_READONLY",
  "ADMIN_BETA_OPERATOR",
] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_PERMISSIONS = [
  "admin.principal.read",
  "admin.principal.manage",
  "admin.audit.read",
  "account.read",
  "user.read",
  "device.read",
  "device.revoke",
  "subscription.read",
  "subscription.grant",
  "subscription.extend",
  "subscription.suspend",
  "subscription.restore",
  "billing.read",
  "plan.read",
  "plan.manage",
  "price.read",
  "price.manage",
  "entitlement.read",
  "entitlement.override",
  "compatibility.read",
  "compatibility.manage",
  "ai.registry.read",
  "ai.registry.manage",
  "ai.profile.read",
  "ai.profile.manage",
  "ai.assignment.read",
  "ai.assignment.manage",
  "beta.admission.read",
  "beta.admission.manage",
  "health.read",
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

const permissionSet = new Set<string>(ADMIN_PERMISSIONS);
const roleSet = new Set<string>(ADMIN_ROLES);
const rolePermissions: Record<AdminRole, readonly AdminPermission[]> = {
  ADMIN_OWNER: ADMIN_PERMISSIONS,
  ADMIN_OPS: [
    "account.read",
    "user.read",
    "device.read",
    "device.revoke",
    "subscription.read",
    "subscription.grant",
    "subscription.extend",
    "subscription.suspend",
    "subscription.restore",
    "billing.read",
    "admin.audit.read",
    "compatibility.read",
    "ai.registry.read",
    "ai.registry.manage",
    "ai.profile.read",
    "ai.profile.manage",
    "ai.assignment.read",
    "ai.assignment.manage",
    "health.read",
  ],
  ADMIN_SUPPORT: [
    "account.read",
    "user.read",
    "device.read",
    "device.revoke",
    "subscription.read",
    "billing.read",
    "admin.audit.read",
    "ai.registry.read",
    "ai.profile.read",
    "ai.assignment.read",
    "beta.admission.read",
  ],
  ADMIN_BILLING_READONLY: [
    "account.read",
    "subscription.read",
    "billing.read",
    "admin.audit.read",
  ],
  ADMIN_BETA_OPERATOR: ["beta.admission.read", "beta.admission.manage"],
};

export function isAdminRole(value: string): value is AdminRole {
  return roleSet.has(value);
}
export function isAdminPermission(value: string): value is AdminPermission {
  return permissionSet.has(value);
}
export function permissionsForRoles(
  roles: readonly string[],
): AdminPermission[] {
  const permissions = new Set<AdminPermission>();
  for (const role of roles) {
    if (!isAdminRole(role)) continue;
    for (const permission of rolePermissions[role]) permissions.add(permission);
  }
  return [...permissions].sort();
}
export function permissionsForRole(role: string): readonly AdminPermission[] {
  return isAdminRole(role) ? rolePermissions[role] : [];
}

export interface AdminSubject {
  adminPrincipalId: string;
  userId: string;
  adminSessionId: string;
  roles: AdminRole[];
  permissions: AdminPermission[];
  expiresAt: Date;
}
export interface PortalElevationSubject {
  sessionId: string;
  userId: string;
  createdAt: Date;
}
export type AdminAuthFailureCode =
  | "ADMIN_UNAUTHORIZED"
  | "ADMIN_FORBIDDEN"
  | "ADMIN_REAUTH_REQUIRED"
  | "ADMIN_CSRF_INVALID"
  | "ADMIN_SESSION_EXPIRED"
  | "ADMIN_PRINCIPAL_SUSPENDED"
  | "ADMIN_BOOTSTRAP_CLOSED"
  | "ADMIN_BOOTSTRAP_USER_NOT_FOUND"
  | "ADMIN_BOOTSTRAP_USER_INACTIVE"
  | "SERVICE_UNAVAILABLE";
export type AdminResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: AdminAuthFailureCode };

export interface AdminAuthRepository {
  createAdminSession(input: {
    userId: string;
    sourcePortalSessionId: string;
    sessionTokenHash: string;
    createdAt: Date;
    now: Date;
    expiresAt: Date;
    correlationId: string;
  }): Promise<
    | { kind: "created"; subject: Omit<AdminSubject, "permissions"> }
    | { kind: "forbidden" }
    | { kind: "suspended" }
  >;
  authenticateAdminSession(
    sessionTokenHash: string,
    now: Date,
  ): Promise<
    | { kind: "authenticated"; subject: Omit<AdminSubject, "permissions"> }
    | { kind: "expired" }
    | { kind: "suspended" }
    | { kind: "unauthorized" }
  >;
  revokeAdminSession(input: {
    sessionTokenHash: string;
    adminPrincipalId: string;
    correlationId: string;
  }): Promise<"revoked" | "missing">;
  bootstrapOwner(input: {
    normalizedEmail: string;
    correlationId: string;
  }): Promise<
    | { kind: "bootstrapped"; principalId: string; userId: string }
    | { kind: "closed" }
    | { kind: "user-not-found" }
    | { kind: "user-inactive" }
  >;
}

const keySalt = Buffer.from("product-control-plane/admin-auth/hkdf-salt/v1");
const sessionLabel = "product-control-plane/admin-auth/session/v1";
const csrfLabel = "product-control-plane/admin-auth/csrf/v1";
export interface AdminAuthKeys {
  session: Buffer;
  csrf: Buffer;
}
export function deriveAdminAuthKeys(root: Buffer): AdminAuthKeys {
  if (root.length !== 32)
    throw new Error("authentication root secret must be 32 bytes");
  return {
    session: Buffer.from(hkdfSync("sha256", root, keySalt, sessionLabel, 32)),
    csrf: Buffer.from(hkdfSync("sha256", root, keySalt, csrfLabel, 32)),
  };
}
function hmac(key: Buffer, parts: string[]): string {
  const h = createHmac("sha256", key);
  for (const part of parts) {
    const bytes = Buffer.from(part);
    h.update(Buffer.from(`${bytes.length}:`));
    h.update(bytes);
  }
  return `v1:${h.digest("base64url")}`;
}
export function generateAdminSessionToken(): string {
  return randomBytes(32).toString("base64url");
}
export function adminSessionLookup(keys: AdminAuthKeys, token: string): string {
  return hmac(keys.session, ["v1", token]);
}
export function adminCsrfToken(
  keys: AdminAuthKeys,
  sessionToken: string,
): string {
  return hmac(keys.csrf, ["v1", sessionToken]);
}
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function verifyAdminCsrf(
  keys: AdminAuthKeys,
  sessionToken: string,
  header: string | undefined,
  cookie: string | undefined,
): boolean {
  return (
    !!header &&
    !!cookie &&
    safeEqual(header, cookie) &&
    safeEqual(header, adminCsrfToken(keys, sessionToken))
  );
}

export class AdminAuthService {
  public constructor(
    private readonly repository: AdminAuthRepository,
    private readonly keys: AdminAuthKeys,
    private readonly now: () => Date = () => new Date(),
    private readonly tokenGenerator = generateAdminSessionToken,
  ) {}

  async createAdminSession(
    portal: PortalElevationSubject,
    correlationId: string,
  ): Promise<AdminResult<{ sessionToken: string; subject: AdminSubject }>> {
    const age = this.now().getTime() - portal.createdAt.getTime();
    if (age < 0 || age > ADMIN_ELEVATION_MAX_PORTAL_SESSION_AGE_MS)
      return { ok: false, code: "ADMIN_REAUTH_REQUIRED" };
    const sessionToken = this.tokenGenerator();
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + ADMIN_SESSION_TTL_MS);
    try {
      const result = await this.repository.createAdminSession({
        userId: portal.userId,
        sourcePortalSessionId: portal.sessionId,
        sessionTokenHash: adminSessionLookup(this.keys, sessionToken),
        createdAt,
        now: createdAt,
        expiresAt,
        correlationId,
      });
      if (result.kind === "suspended")
        return { ok: false, code: "ADMIN_PRINCIPAL_SUSPENDED" };
      if (result.kind === "forbidden")
        return { ok: false, code: "ADMIN_FORBIDDEN" };
      const subject = {
        ...result.subject,
        permissions: permissionsForRoles(result.subject.roles),
      };
      return { ok: true, value: { sessionToken, subject } };
    } catch {
      return { ok: false, code: "SERVICE_UNAVAILABLE" };
    }
  }

  async authenticateAdminSession(
    token: string,
  ): Promise<AdminResult<AdminSubject>> {
    try {
      const result = await this.repository.authenticateAdminSession(
        adminSessionLookup(this.keys, token),
        this.now(),
      );
      if (result.kind === "expired")
        return { ok: false, code: "ADMIN_SESSION_EXPIRED" };
      if (result.kind === "suspended")
        return { ok: false, code: "ADMIN_PRINCIPAL_SUSPENDED" };
      if (result.kind === "unauthorized")
        return { ok: false, code: "ADMIN_UNAUTHORIZED" };
      return {
        ok: true,
        value: {
          ...result.subject,
          permissions: permissionsForRoles(result.subject.roles),
        },
      };
    } catch {
      return { ok: false, code: "SERVICE_UNAVAILABLE" };
    }
  }

  async revokeAdminSession(
    token: string,
    adminPrincipalId: string,
    correlationId: string,
  ): Promise<AdminResult<undefined>> {
    try {
      const result = await this.repository.revokeAdminSession({
        sessionTokenHash: adminSessionLookup(this.keys, token),
        adminPrincipalId,
        correlationId,
      });
      return result === "revoked"
        ? { ok: true, value: undefined }
        : { ok: false, code: "ADMIN_UNAUTHORIZED" };
    } catch {
      return { ok: false, code: "SERVICE_UNAVAILABLE" };
    }
  }

  async bootstrapOwner(
    email: string,
    correlationId: string,
  ): Promise<AdminResult<{ principalId: string; userId: string }>> {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail)
      return { ok: false, code: "ADMIN_BOOTSTRAP_USER_NOT_FOUND" };
    try {
      const result = await this.repository.bootstrapOwner({
        normalizedEmail,
        correlationId,
      });
      if (result.kind === "closed")
        return { ok: false, code: "ADMIN_BOOTSTRAP_CLOSED" };
      if (result.kind === "user-not-found")
        return { ok: false, code: "ADMIN_BOOTSTRAP_USER_NOT_FOUND" };
      if (result.kind === "user-inactive")
        return { ok: false, code: "ADMIN_BOOTSTRAP_USER_INACTIVE" };
      return {
        ok: true,
        value: { principalId: result.principalId, userId: result.userId },
      };
    } catch {
      return { ok: false, code: "SERVICE_UNAVAILABLE" };
    }
  }

  authorize(subject: AdminSubject, permission: string): AdminResult<true> {
    if (
      !isAdminPermission(permission) ||
      !subject.permissions.includes(permission)
    )
      return { ok: false, code: "ADMIN_FORBIDDEN" };
    return { ok: true, value: true };
  }

  csrf(token: string): string {
    return adminCsrfToken(this.keys, token);
  }
  csrfValid(
    token: string,
    header: string | undefined,
    cookie: string | undefined,
  ): boolean {
    return verifyAdminCsrf(this.keys, token, header, cookie);
  }
}

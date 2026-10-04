import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { AdminPermission, AdminResult, AdminSubject } from "./index.js";

// Human administration is deliberately not a delegable maintenance permission.
export const MAINTENANCE_PERMISSIONS = [
  "compatibility.read",
  "compatibility.manage",
  "health.read",
  "ai.registry.read",
  "ai.registry.manage",
  "ai.profile.read",
  "ai.profile.manage",
  "ai.assignment.read",
  "ai.assignment.manage",
] as const satisfies readonly AdminPermission[];
export const MAINTENANCE_LEASE_MS = 30 * 24 * 60 * 60_000;
export const MAINTENANCE_ROTATION_REPLAY_MS = 2 * 60_000;
const allowed = new Set<string>(MAINTENANCE_PERMISSIONS);
const uuid =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const tokenPattern = new RegExp("^octm_(" + uuid + ")_([A-Za-z0-9_-]{43})$");
const noncePattern = /^[A-Za-z0-9_-]{32,128}$/;

export interface MaintenanceGrant {
  id: string;
  label: string;
  adminPrincipalId: string;
  userId: string;
  sourceAdminSessionId: string;
  permissions: AdminPermission[];
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}
export interface MaintenanceRepository {
  // Implementations must recheck the live human session, source portal,
  // principal revision and OWNER role atomically, not trust the supplied subject.
  issue(input: {
    id: string;
    label: string;
    issuer: AdminSubject;
    permissions: AdminPermission[];
    tokenHash: string;
    now: Date;
    expiresAt: Date;
    correlationId: string;
  }): Promise<MaintenanceGrant | null>;
  authenticate(
    id: string,
    tokenHash: string,
    now: Date,
  ): Promise<MaintenanceGrant | null>;
  rotate(input: {
    id: string;
    tokenHash: string;
    replacementHash: string;
    nonceHash: string;
    now: Date;
    expiresAt: Date;
    replayUntil: Date;
    correlationId: string;
  }): Promise<{ expiresAt: Date } | null>;
  list(issuer: AdminSubject, now: Date): Promise<MaintenanceGrant[]>;
  revoke(
    issuer: AdminSubject,
    id: string,
    now: Date,
    correlationId: string,
  ): Promise<boolean>;
}
function digest(domain: string, value: string): string {
  return createHash("sha256")
    .update(domain)
    .update("\0")
    .update(value)
    .digest("hex");
}
export function maintenanceTokenHash(token: string): string {
  return digest("octoport/maintenance/token/v1", token);
}
function replacement(token: string, nonce: string, id: string): string {
  const secret = createHmac("sha256", token)
    .update("octoport/maintenance/rotate/v1\0")
    .update(nonce)
    .digest("base64url");
  return "octm_" + id + "_" + secret;
}
function unauthorized<T>(): AdminResult<T> {
  return { ok: false, code: "ADMIN_UNAUTHORIZED" };
}
function unavailable<T>(): AdminResult<T> {
  return { ok: false, code: "SERVICE_UNAVAILABLE" };
}
function validOwner(subject: AdminSubject, now: Date): boolean {
  return (
    !subject.maintenanceGrantId &&
    subject.roles.includes("ADMIN_OWNER") &&
    subject.permissions.includes("admin.principal.manage") &&
    Number.isFinite(subject.expiresAt.getTime()) &&
    subject.expiresAt > now
  );
}

export class MaintenanceAccessService {
  constructor(
    private readonly repository: MaintenanceRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issue(
    issuer: AdminSubject,
    label: string,
    permissions: readonly string[],
    correlationId: string,
  ): Promise<AdminResult<{ grant: MaintenanceGrant; token: string }>> {
    const now = this.now();
    if (!validOwner(issuer, now)) return { ok: false, code: "ADMIN_FORBIDDEN" };
    if (
      typeof label !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(label) ||
      !Array.isArray(permissions) ||
      permissions.length === 0 ||
      permissions.length > MAINTENANCE_PERMISSIONS.length ||
      new Set(permissions).size !== permissions.length ||
      permissions.some(
        (p) =>
          !allowed.has(p) || !issuer.permissions.includes(p as AdminPermission),
      )
    ) {
      return { ok: false, code: "ADMIN_FORBIDDEN" };
    }
    const id = randomUUID();
    const token = "octm_" + id + "_" + randomBytes(32).toString("base64url");
    try {
      const grant = await this.repository.issue({
        id,
        label,
        issuer,
        permissions: [...permissions] as AdminPermission[],
        tokenHash: maintenanceTokenHash(token),
        now,
        expiresAt: new Date(now.getTime() + MAINTENANCE_LEASE_MS),
        correlationId,
      });
      return grant ? { ok: true, value: { grant, token } } : unauthorized();
    } catch {
      return unavailable();
    }
  }

  async authenticate(token: string): Promise<AdminResult<AdminSubject>> {
    const parsed = typeof token === "string" ? tokenPattern.exec(token) : null;
    if (!parsed) return unauthorized();
    const now = this.now();
    try {
      const grant = await this.repository.authenticate(
        parsed[1]!,
        maintenanceTokenHash(token),
        now,
      );
      if (
        !grant ||
        grant.revokedAt ||
        grant.expiresAt <= now ||
        !grant.permissions.length ||
        grant.permissions.some((p) => !allowed.has(p))
      )
        return unauthorized();
      return {
        ok: true,
        value: {
          adminPrincipalId: grant.adminPrincipalId,
          userId: grant.userId,
          adminSessionId: grant.sourceAdminSessionId,
          roles: [],
          permissions: [...grant.permissions],
          expiresAt: grant.expiresAt,
          maintenanceGrantId: grant.id,
        },
      };
    } catch {
      return unavailable();
    }
  }

  async rotate(
    token: string,
    nonce: string,
    correlationId: string,
  ): Promise<AdminResult<{ token: string; expiresAt: Date }>> {
    const parsed = typeof token === "string" ? tokenPattern.exec(token) : null;
    if (!parsed || typeof nonce !== "string" || !noncePattern.test(nonce))
      return unauthorized();
    const now = this.now();
    const next = replacement(token, nonce, parsed[1]!);
    try {
      const result = await this.repository.rotate({
        id: parsed[1]!,
        tokenHash: maintenanceTokenHash(token),
        replacementHash: maintenanceTokenHash(next),
        nonceHash: digest("octoport/maintenance/nonce/v1", nonce),
        now,
        expiresAt: new Date(now.getTime() + MAINTENANCE_LEASE_MS),
        replayUntil: new Date(now.getTime() + MAINTENANCE_ROTATION_REPLAY_MS),
        correlationId,
      });
      return result
        ? { ok: true, value: { token: next, expiresAt: result.expiresAt } }
        : unauthorized();
    } catch {
      return unavailable();
    }
  }

  async list(issuer: AdminSubject): Promise<AdminResult<MaintenanceGrant[]>> {
    const now = this.now();
    if (!validOwner(issuer, now)) return { ok: false, code: "ADMIN_FORBIDDEN" };
    try {
      return { ok: true, value: await this.repository.list(issuer, now) };
    } catch {
      return unavailable();
    }
  }

  async revoke(
    issuer: AdminSubject,
    id: string,
    correlationId: string,
  ): Promise<AdminResult<true>> {
    const now = this.now();
    if (!validOwner(issuer, now)) return { ok: false, code: "ADMIN_FORBIDDEN" };
    if (!new RegExp("^" + uuid + "$").test(id)) return unauthorized();
    try {
      return (await this.repository.revoke(issuer, id, now, correlationId))
        ? { ok: true, value: true }
        : unauthorized();
    } catch {
      return unavailable();
    }
  }
}

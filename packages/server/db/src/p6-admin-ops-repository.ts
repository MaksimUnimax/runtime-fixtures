import { type AdminPermission, type AdminRole } from "@product/admin-auth";
import type {
  AdminOpsRepository,
  AdminPrincipal,
  AuditEvent,
  SafeAccount,
  SafeUser,
} from "@product/admin-ops";
import type { SafeDevice } from "@product/admin-ops";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";
import { revokeDeviceInTransaction } from "./device-revocation.js";
import {
  AdminMutationAuthorizationError,
  authorizeAdminMutationInTransaction,
} from "./admin-mutation-authorization.js";
import { safeAuditReason } from "./safe-audit.js";

const manageLock = "product-control-plane/admin-auth/manage/v1";

function pageLimit(input: number): number {
  return Number.isInteger(input) && input >= 1 && input <= 100 ? input : 50;
}
function date(value: unknown): Date {
  return new Date(String(value));
}
function jsonEmails(
  value: unknown,
): { email: string; verifiedAt: Date | null }[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = item as { email: string; verifiedAt: string | null };
    return {
      email: row.email,
      verifiedAt: row.verifiedAt ? date(row.verifiedAt) : null,
    };
  });
}
function addFilter(
  clauses: string[],
  values: unknown[],
  sql: string,
  value: unknown,
  suffix = "",
) {
  values.push(value);
  clauses.push(`${sql}$${values.length}${suffix}`);
}
function buildWhere(clauses: string[]): string {
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}

async function rolesFor(
  q: DatabaseQuery,
  principalId: string,
): Promise<AdminRole[]> {
  const result = await q.query<{ role: AdminRole }>(
    "SELECT role FROM admin_role_grants WHERE admin_principal_id=$1 AND revoked_at IS NULL ORDER BY role ASC",
    [principalId],
  );
  return result.rows.map((row) => row.role);
}

async function principalSnapshot(
  q: DatabaseQuery,
  principalId: string,
): Promise<AdminPrincipal | undefined> {
  const result = await q.query<{
    id: string;
    user_id: string;
    status: "ACTIVE" | "SUSPENDED";
    revision: number | string;
    created_at: Date;
    updated_at: Date;
  }>(
    "SELECT id,user_id,status,revision,created_at,updated_at FROM admin_principals WHERE id=$1",
    [principalId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    principalId: row.id,
    userId: row.user_id,
    status: row.status,
    revision: Number(row.revision),
    roles: await rolesFor(q, row.id),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

async function lockActorAndTarget(
  tx: DatabaseQuery,
  actorId: string,
  targetId: string,
): Promise<{ actor: boolean; target: boolean }> {
  const ids = [...new Set([actorId, targetId])].sort();
  const locked = await tx.query<{ id: string }>(
    "SELECT id FROM admin_principals WHERE id=ANY($1::uuid[]) ORDER BY id ASC FOR UPDATE",
    [ids],
  );
  const found = new Set(locked.rows.map((row) => row.id));
  return { actor: found.has(actorId), target: found.has(targetId) };
}
async function actorCan(
  tx: DatabaseQuery,
  actorId: string,
  permission: AdminPermission,
): Promise<boolean> {
  try {
    await authorizeAdminMutationInTransaction(tx, actorId, permission);
    return true;
  } catch (error) {
    if (error instanceof AdminMutationAuthorizationError) return false;
    throw error;
  }
}
async function lockManage(tx: DatabaseQuery): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    manageLock,
  ]);
}
async function activeOwnerCount(tx: DatabaseQuery): Promise<number> {
  const result = await tx.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM admin_principals p
     WHERE p.status='ACTIVE' AND EXISTS (
       SELECT 1 FROM admin_role_grants g WHERE g.admin_principal_id=p.id AND g.role='ADMIN_OWNER' AND g.revoked_at IS NULL
     )`,
  );
  return Number(result.rows[0]?.count ?? 0);
}
async function mutationNow(
  tx: DatabaseQuery,
  principalId: string,
): Promise<Date> {
  const result = await tx.query<{ value: Date }>(
    "SELECT GREATEST(now(),created_at) AS value FROM admin_principals WHERE id=$1",
    [principalId],
  );
  return date(result.rows[0]?.value ?? new Date());
}
async function audit(
  tx: DatabaseQuery,
  input: {
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    correlationId: string;
    reason: string;
    metadata?: unknown;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata)
     VALUES('ADMIN',$1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      input.actorId,
      input.action,
      input.targetType,
      input.targetId,
      input.correlationId,
      safeAuditReason(input.reason),
      input.metadata === undefined ? null : JSON.stringify(input.metadata),
    ],
  );
}

export function createAdminOpsRepository(
  runtime: DatabaseRuntime,
): AdminOpsRepository {
  return {
    async listAccounts(input) {
      const limit = pageLimit(input.limit);
      const clauses = ["1=1"];
      const values: unknown[] = [];
      if (input.accountId) addFilter(clauses, values, "a.id=", input.accountId);
      if (input.ownerUserId)
        addFilter(
          clauses,
          values,
          "EXISTS (SELECT 1 FROM account_memberships m WHERE m.account_id=a.id AND m.user_id=",
          input.ownerUserId,
          ")",
        );
      if (input.ownerEmail)
        addFilter(
          clauses,
          values,
          "EXISTS (SELECT 1 FROM account_memberships m JOIN user_identities i ON i.user_id=m.user_id WHERE m.account_id=a.id AND i.provider='EMAIL' AND i.normalized_identifier=",
          input.ownerEmail,
          ")",
        );
      if (input.status) addFilter(clauses, values, "a.status=", input.status);
      let cursorRow: { created_at: Date; id: string } | undefined;
      if (input.cursor) {
        const cursor = await runtime.query<{ created_at: Date; id: string }>(
          `SELECT a.created_at,a.id FROM accounts a ${buildWhere([...clauses, `a.id=$${values.length + 1}`])}`,
          [...values, input.cursor],
        );
        cursorRow = cursor.rows[0];
        if (!cursorRow) return { kind: "INVALID_CURSOR" as const };
      }
      if (cursorRow) {
        values.push(cursorRow.created_at, cursorRow.id);
        clauses.push(
          `(a.created_at,a.id)<($${values.length - 1},$${values.length})`,
        );
      }
      const result = await runtime.query<{
        id: string;
        status: "ACTIVE" | "SUSPENDED";
        display_name: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT a.id,a.status,a.display_name,a.created_at,a.updated_at FROM accounts a ${buildWhere(clauses)} ORDER BY a.created_at DESC,a.id DESC LIMIT $${values.length + 1}`,
        [...values, limit + 1],
      );
      const items = result.rows.slice(0, limit).map(
        (row): SafeAccount => ({
          id: row.id,
          status: row.status,
          displayName: row.display_name,
          createdAt: date(row.created_at),
          updatedAt: date(row.updated_at),
        }),
      );
      return {
        items,
        ...(result.rows.length > limit && items.length
          ? { nextCursor: items.at(-1)!.id }
          : {}),
      };
    },

    async listUsers(input) {
      const limit = pageLimit(input.limit);
      const clauses = ["1=1"];
      const values: unknown[] = [];
      if (input.userId) addFilter(clauses, values, "u.id=", input.userId);
      if (input.email)
        addFilter(
          clauses,
          values,
          "EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id=u.id AND i.provider='EMAIL' AND i.normalized_identifier=",
          input.email,
          ")",
        );
      if (input.status) addFilter(clauses, values, "u.status=", input.status);
      let cursorRow: { created_at: Date; id: string } | undefined;
      if (input.cursor) {
        const cursor = await runtime.query<{ created_at: Date; id: string }>(
          `SELECT u.created_at,u.id FROM users u ${buildWhere([...clauses, `u.id=$${values.length + 1}`])}`,
          [...values, input.cursor],
        );
        cursorRow = cursor.rows[0];
        if (!cursorRow) return { kind: "INVALID_CURSOR" as const };
      }
      if (cursorRow) {
        values.push(cursorRow.created_at, cursorRow.id);
        clauses.push(
          `(u.created_at,u.id)<($${values.length - 1},$${values.length})`,
        );
      }
      const result = await runtime.query<{
        id: string;
        status: "ACTIVE" | "SUSPENDED";
        created_at: Date;
        updated_at: Date;
        emails: unknown;
      }>(
        `SELECT u.id,u.status,u.created_at,u.updated_at,COALESCE((SELECT json_agg(json_build_object('email',i.normalized_identifier,'verifiedAt',i.verified_at) ORDER BY i.normalized_identifier,i.id) FROM user_identities i WHERE i.user_id=u.id AND i.provider='EMAIL'),'[]'::json) AS emails FROM users u ${buildWhere(clauses)} ORDER BY u.created_at DESC,u.id DESC LIMIT $${values.length + 1}`,
        [...values, limit + 1],
      );
      const items = result.rows.slice(0, limit).map(
        (row): SafeUser => ({
          id: row.id,
          status: row.status,
          emails: jsonEmails(row.emails),
          createdAt: date(row.created_at),
          updatedAt: date(row.updated_at),
        }),
      );
      return {
        items,
        ...(result.rows.length > limit && items.length
          ? { nextCursor: items.at(-1)!.id }
          : {}),
      };
    },

    async listDevices(input) {
      const account = await runtime.query<{ id: string }>(
        "SELECT id FROM accounts WHERE id=$1",
        [input.accountId],
      );
      if (!account.rows[0]) return { kind: "ACCOUNT_NOT_FOUND" as const };
      const limit = pageLimit(input.limit);
      let cursorRow: { created_at: Date; id: string } | undefined;
      if (input.cursor) {
        const cursor = await runtime.query<{ created_at: Date; id: string }>(
          "SELECT created_at,id FROM devices WHERE id=$1 AND account_id=$2 AND ($3::device_status IS NULL OR status=$3)",
          [input.cursor, input.accountId, input.status ?? null],
        );
        cursorRow = cursor.rows[0];
        if (!cursorRow) return { kind: "INVALID_CURSOR" as const };
      }
      const values: unknown[] = [input.accountId];
      const clauses = ["account_id=$1"];
      if (input.status) {
        values.push(input.status);
        clauses.push(`status=$${values.length}`);
      }
      if (cursorRow) {
        values.push(cursorRow.created_at, cursorRow.id);
        clauses.push(
          `(created_at,id)<($${values.length - 1},$${values.length})`,
        );
      }
      const result = await runtime.query<Record<string, unknown>>(
        `SELECT id,status,label,browser_family,browser_version_last_seen,extension_version_last_seen,created_at,activated_at,last_seen_at,revoked_at FROM devices ${buildWhere(clauses)} ORDER BY created_at DESC,id DESC LIMIT $${values.length + 1}`,
        [...values, limit + 1],
      );
      const items = result.rows.slice(0, limit).map(
        (row): SafeDevice => ({
          id: String(row.id),
          status: String(row.status) as SafeDevice["status"],
          label: row.label as string | null,
          browserFamily: String(row.browser_family),
          browserVersionLastSeen: row.browser_version_last_seen as
            | string
            | null,
          extensionVersionLastSeen: row.extension_version_last_seen as
            | string
            | null,
          createdAt: date(row.created_at),
          activatedAt: row.activated_at ? date(row.activated_at) : null,
          lastSeenAt: row.last_seen_at ? date(row.last_seen_at) : null,
          revokedAt: row.revoked_at ? date(row.revoked_at) : null,
        }),
      );
      return {
        items,
        ...(result.rows.length > limit && items.length
          ? { nextCursor: items.at(-1)!.id }
          : {}),
      };
    },

    async listAuditEvents(input) {
      const limit = pageLimit(input.limit);
      const clauses = ["1=1"];
      const values: unknown[] = [];
      for (const [column, value] of [
        ["action", input.action],
        ["target_type", input.targetType],
        ["target_id", input.targetId],
        ["actor_type", input.actorType],
        ["actor_id", input.actorId],
        ["correlation_id", input.correlationId],
      ] as const)
        if (value !== undefined)
          addFilter(clauses, values, `a.${column}=`, value);
      let cursorRow: { created_at: Date; id: string } | undefined;
      if (input.cursor) {
        const cursor = await runtime.query<{ created_at: Date; id: string }>(
          `SELECT a.created_at,a.id FROM audit_events a ${buildWhere([...clauses, `a.id=$${values.length + 1}`])}`,
          [...values, input.cursor],
        );
        cursorRow = cursor.rows[0];
        if (!cursorRow) return { kind: "INVALID_CURSOR" as const };
      }
      if (cursorRow) {
        values.push(cursorRow.created_at, cursorRow.id);
        clauses.push(
          `(a.created_at,a.id)<($${values.length - 1},$${values.length})`,
        );
      }
      const result = await runtime.query<{
        id: string;
        actor_type: string;
        actor_id: string | null;
        action: string;
        target_type: string;
        target_id: string | null;
        correlation_id: string;
        created_at: Date;
      }>(
        `SELECT a.id,a.actor_type,a.actor_id,a.action,a.target_type,a.target_id,a.correlation_id,a.created_at FROM audit_events a ${buildWhere(clauses)} ORDER BY a.created_at DESC,a.id DESC LIMIT $${values.length + 1}`,
        [...values, limit + 1],
      );
      const items = result.rows.slice(0, limit).map(
        (row): AuditEvent => ({
          id: row.id,
          actorType: row.actor_type,
          actorId: row.actor_id,
          action: row.action,
          targetType: row.target_type,
          targetId: row.target_id,
          correlationId: row.correlation_id,
          createdAt: date(row.created_at),
        }),
      );
      return {
        items,
        ...(result.rows.length > limit && items.length
          ? { nextCursor: items.at(-1)!.id }
          : {}),
      };
    },

    async listPrincipals(input) {
      const limit = pageLimit(input.limit);
      const clauses = ["1=1"];
      const values: unknown[] = [];
      if (input.principalId)
        addFilter(clauses, values, "p.id=", input.principalId);
      if (input.userId) addFilter(clauses, values, "p.user_id=", input.userId);
      if (input.status) addFilter(clauses, values, "p.status=", input.status);
      if (input.role)
        addFilter(
          clauses,
          values,
          "EXISTS (SELECT 1 FROM admin_role_grants g WHERE g.admin_principal_id=p.id AND g.role=",
          input.role,
          " AND g.revoked_at IS NULL)",
        );
      let cursorRow: { created_at: Date; id: string } | undefined;
      if (input.cursor) {
        const cursor = await runtime.query<{ created_at: Date; id: string }>(
          `SELECT p.created_at,p.id FROM admin_principals p ${buildWhere([...clauses, `p.id=$${values.length + 1}`])}`,
          [...values, input.cursor],
        );
        cursorRow = cursor.rows[0];
        if (!cursorRow) return { kind: "INVALID_CURSOR" as const };
      }
      if (cursorRow) {
        values.push(cursorRow.created_at, cursorRow.id);
        clauses.push(
          `(p.created_at,p.id)<($${values.length - 1},$${values.length})`,
        );
      }
      const result = await runtime.query<{
        id: string;
        user_id: string;
        status: "ACTIVE" | "SUSPENDED";
        revision: number | string;
        created_at: Date;
        updated_at: Date;
        roles: unknown;
      }>(
        `SELECT p.id,p.user_id,p.status,p.revision,p.created_at,p.updated_at,COALESCE((SELECT json_agg(g.role ORDER BY g.role) FROM admin_role_grants g WHERE g.admin_principal_id=p.id AND g.revoked_at IS NULL),'[]'::json) AS roles FROM admin_principals p ${buildWhere(clauses)} ORDER BY p.created_at DESC,p.id DESC LIMIT $${values.length + 1}`,
        [...values, limit + 1],
      );
      const items = result.rows.slice(0, limit).map(
        (row): AdminPrincipal => ({
          principalId: row.id,
          userId: row.user_id,
          status: row.status,
          revision: Number(row.revision),
          roles: (Array.isArray(row.roles) ? row.roles : []) as AdminRole[],
          createdAt: date(row.created_at),
          updatedAt: date(row.updated_at),
        }),
      );
      return {
        items,
        ...(result.rows.length > limit && items.length
          ? { nextCursor: items.at(-1)!.principalId }
          : {}),
      };
    },

    async revokeDevice(input) {
      return runtime.transaction(async (tx) => {
        if (!(await actorCan(tx, input.actorId, "device.revoke")))
          return "FORBIDDEN" as const;
        const result = await revokeDeviceInTransaction(tx, {
          deviceId: input.deviceId,
          expectedAccountId: input.accountId,
          actorType: "ADMIN",
          actorId: input.actorId,
          deviceRevokeReason: "ADMIN_REVOKED",
          deviceAuditAction: "ADMIN_DEVICE_REVOKED",
          correlationId: input.correlationId,
          reason: safeAuditReason(input.reason),
        });
        return result === "revoked"
          ? ("REVOKED" as const)
          : result === "already-revoked"
            ? ("ALREADY_REVOKED" as const)
            : ("NOT_FOUND" as const);
      });
    },

    async createPrincipal(input) {
      return runtime.transaction(async (tx) => {
        await lockManage(tx);
        if (!(await actorCan(tx, input.actorId, "admin.principal.manage")))
          return { kind: "FORBIDDEN" as const };
        const user = await tx.query<{
          id: string;
          status: "ACTIVE" | "SUSPENDED";
        }>(
          `SELECT u.id,u.status FROM users u WHERE u.id=$1 AND EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id=u.id AND i.provider='EMAIL' AND i.verified_at IS NOT NULL)`,
          [input.userId],
        );
        if (!user.rows[0]) {
          const exists = await tx.query<{ status: "ACTIVE" | "SUSPENDED" }>(
            "SELECT status FROM users WHERE id=$1",
            [input.userId],
          );
          return exists.rows[0]
            ? exists.rows[0].status === "ACTIVE"
              ? { kind: "USER_UNVERIFIED" as const }
              : { kind: "USER_INACTIVE" as const }
            : { kind: "USER_NOT_FOUND" as const };
        }
        if (user.rows[0].status !== "ACTIVE")
          return { kind: "USER_INACTIVE" as const };
        const existing = await tx.query<{ id: string }>(
          "SELECT id FROM admin_principals WHERE user_id=$1",
          [input.userId],
        );
        if (existing.rows[0]) return { kind: "CONFLICT" as const };
        const principal = await tx.query<{ id: string }>(
          "INSERT INTO admin_principals(user_id,status,revision) VALUES($1,'ACTIVE',1) RETURNING id",
          [input.userId],
        );
        const principalId = principal.rows[0]!.id;
        await tx.query(
          "INSERT INTO admin_role_grants(admin_principal_id,role,granted_by_admin_principal_id) VALUES($1,$2,$3)",
          [principalId, input.initialRole, input.actorId],
        );
        await audit(tx, {
          actorId: input.actorId,
          action: "ADMIN_PRINCIPAL_CREATED",
          targetType: "ADMIN_PRINCIPAL",
          targetId: principalId,
          correlationId: input.correlationId,
          reason: input.reason,
          metadata: { initialRole: input.initialRole },
        });
        await audit(tx, {
          actorId: input.actorId,
          action: "ADMIN_ROLE_GRANTED",
          targetType: "ADMIN_PRINCIPAL",
          targetId: principalId,
          correlationId: input.correlationId,
          reason: input.reason,
          metadata: { role: input.initialRole },
        });
        return {
          kind: "OK" as const,
          principal: (await principalSnapshot(tx, principalId))!,
        };
      });
    },

    async grantRole(input) {
      return runtime.transaction(async (tx) => {
        await lockManage(tx);
        const locked = await lockActorAndTarget(
          tx,
          input.actorId,
          input.principalId,
        );
        if (!locked.actor) return { kind: "FORBIDDEN" as const };
        if (!(await actorCan(tx, input.actorId, "admin.principal.manage")))
          return { kind: "FORBIDDEN" as const };
        if (!locked.target) return { kind: "NOT_FOUND" as const };
        const principal = (await principalSnapshot(tx, input.principalId))!;
        if (principal.revision !== input.expectedRevision)
          return { kind: "STALE" as const };
        if (
          principal.status !== "ACTIVE" ||
          principal.roles.includes(input.role)
        )
          return { kind: "CONFLICT" as const };
        await tx.query(
          "INSERT INTO admin_role_grants(admin_principal_id,role,granted_by_admin_principal_id) VALUES($1,$2,$3)",
          [input.principalId, input.role, input.actorId],
        );
        const now = await mutationNow(tx, input.principalId);
        await tx.query(
          "UPDATE admin_principals SET revision=revision+1,updated_at=$2 WHERE id=$1",
          [input.principalId, now],
        );
        await audit(tx, {
          actorId: input.actorId,
          action: "ADMIN_ROLE_GRANTED",
          targetType: "ADMIN_PRINCIPAL",
          targetId: input.principalId,
          correlationId: input.correlationId,
          reason: input.reason,
          metadata: {
            role: input.role,
            oldRevision: input.expectedRevision,
            newRevision: input.expectedRevision + 1,
          },
        });
        return {
          kind: "OK" as const,
          principal: (await principalSnapshot(tx, input.principalId))!,
        };
      });
    },

    async revokeRole(input) {
      return runtime.transaction(async (tx) => {
        await lockManage(tx);
        const locked = await lockActorAndTarget(
          tx,
          input.actorId,
          input.principalId,
        );
        if (!locked.actor) return { kind: "FORBIDDEN" as const };
        if (!(await actorCan(tx, input.actorId, "admin.principal.manage")))
          return { kind: "FORBIDDEN" as const };
        if (!locked.target) return { kind: "NOT_FOUND" as const };
        const principal = (await principalSnapshot(tx, input.principalId))!;
        if (principal.revision !== input.expectedRevision)
          return { kind: "STALE" as const };
        if (
          principal.status !== "ACTIVE" ||
          !principal.roles.includes(input.role)
        )
          return { kind: "CONFLICT" as const };
        if (input.role === "ADMIN_OWNER" && (await activeOwnerCount(tx)) <= 1)
          return { kind: "LAST_OWNER" as const };
        const now = await mutationNow(tx, input.principalId);
        await tx.query(
          "UPDATE admin_role_grants SET revoked_at=$2,revoked_by_admin_principal_id=$3 WHERE admin_principal_id=$1 AND role=$4 AND revoked_at IS NULL",
          [input.principalId, now, input.actorId, input.role],
        );
        await tx.query(
          "UPDATE admin_principals SET revision=revision+1,updated_at=$2 WHERE id=$1",
          [input.principalId, now],
        );
        await audit(tx, {
          actorId: input.actorId,
          action: "ADMIN_ROLE_REVOKED",
          targetType: "ADMIN_PRINCIPAL",
          targetId: input.principalId,
          correlationId: input.correlationId,
          reason: input.reason,
          metadata: {
            role: input.role,
            oldRevision: input.expectedRevision,
            newRevision: input.expectedRevision + 1,
          },
        });
        return {
          kind: "OK" as const,
          principal: (await principalSnapshot(tx, input.principalId))!,
        };
      });
    },

    async setPrincipalStatus(input) {
      return runtime.transaction(async (tx) => {
        await lockManage(tx);
        const locked = await lockActorAndTarget(
          tx,
          input.actorId,
          input.principalId,
        );
        if (!locked.actor) return { kind: "FORBIDDEN" as const };
        if (!(await actorCan(tx, input.actorId, "admin.principal.manage")))
          return { kind: "FORBIDDEN" as const };
        if (!locked.target) return { kind: "NOT_FOUND" as const };
        const principal = (await principalSnapshot(tx, input.principalId))!;
        if (principal.revision !== input.expectedRevision)
          return { kind: "STALE" as const };
        if (principal.status === input.status)
          return {
            kind: "OK" as const,
            changed: false as const,
            principal,
            revokedSessionCount: 0 as const,
          };
        if (
          input.status === "SUSPENDED" &&
          principal.roles.includes("ADMIN_OWNER") &&
          (await activeOwnerCount(tx)) <= 1
        )
          return { kind: "LAST_OWNER" as const };
        const now = await mutationNow(tx, input.principalId);
        await tx.query(
          "UPDATE admin_principals SET status=$2,revision=revision+1,updated_at=$3 WHERE id=$1",
          [input.principalId, input.status, now],
        );
        let revokedSessionCount = 0;
        if (input.status === "SUSPENDED") {
          const sessions = await tx.query<{ id: string }>(
            "UPDATE admin_sessions SET revoked_at=$2,revoke_reason='ADMIN_PRINCIPAL_SUSPENDED' WHERE admin_principal_id=$1 AND revoked_at IS NULL RETURNING id",
            [input.principalId, now],
          );
          revokedSessionCount = sessions.rows.length;
        }
        await audit(tx, {
          actorId: input.actorId,
          action:
            input.status === "SUSPENDED"
              ? "ADMIN_PRINCIPAL_SUSPENDED"
              : "ADMIN_PRINCIPAL_RESTORED",
          targetType: "ADMIN_PRINCIPAL",
          targetId: input.principalId,
          correlationId: input.correlationId,
          reason: input.reason,
          metadata:
            input.status === "SUSPENDED"
              ? {
                  oldRevision: input.expectedRevision,
                  newRevision: input.expectedRevision + 1,
                  revokedSessionCount,
                }
              : {
                  oldRevision: input.expectedRevision,
                  newRevision: input.expectedRevision + 1,
                },
        });
        return {
          kind: "OK" as const,
          changed: true as const,
          principal: (await principalSnapshot(tx, input.principalId))!,
          revokedSessionCount,
        };
      });
    },
  };
}

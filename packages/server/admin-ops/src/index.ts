import { normalizeEmail } from "@product/auth";
import { ADMIN_ROLES, type AdminRole } from "@product/admin-auth";
import type {
  CommercialPortalService,
  PortalSubscriptionRead,
} from "@product/commercial-access";
import { z } from "zod";

export const AdminReasonV1Schema = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (value) =>
      [...value].every((character) => {
        const code = character.charCodeAt(0);
        return code > 0x1f && code !== 0x7f;
      }),
    {
      message: "reason contains a control character",
    },
  )
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(256));
export type AdminReasonV1 = z.infer<typeof AdminReasonV1Schema>;

const Uuid = z.uuid();
const Limit = z.coerce.number().int().min(1).max(100).optional();
const Cursor = Uuid.optional();
const BoundedMachineString = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);
const Status = z.enum(["ACTIVE", "SUSPENDED"]);
const DeviceStatus = z.enum(["ACTIVE", "REVOKED"]);

export const AdminAccountsQueryV1Schema = z
  .object({
    accountId: Uuid.optional(),
    ownerUserId: Uuid.optional(),
    ownerEmail: z.string().min(1).max(320).optional(),
    status: Status.optional(),
    limit: Limit,
    cursor: Cursor,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      [value.accountId, value.ownerUserId, value.ownerEmail].filter(Boolean)
        .length > 1
    )
      ctx.addIssue({
        code: "custom",
        message: "account filters are mutually exclusive",
      });
    if (value.ownerEmail !== undefined && !normalizeEmail(value.ownerEmail))
      ctx.addIssue({
        code: "custom",
        path: ["ownerEmail"],
        message: "invalid email",
      });
  });
export type AdminAccountsQueryV1 = z.infer<typeof AdminAccountsQueryV1Schema>;

export const AdminUsersQueryV1Schema = z
  .object({
    userId: Uuid.optional(),
    email: z.string().min(1).max(320).optional(),
    status: Status.optional(),
    limit: Limit,
    cursor: Cursor,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.userId !== undefined && value.email !== undefined)
      ctx.addIssue({
        code: "custom",
        message: "user filters are mutually exclusive",
      });
    if (value.email !== undefined && !normalizeEmail(value.email))
      ctx.addIssue({
        code: "custom",
        path: ["email"],
        message: "invalid email",
      });
  });
export type AdminUsersQueryV1 = z.infer<typeof AdminUsersQueryV1Schema>;

export const AdminAccountParamsV1Schema = z
  .object({ account_id: Uuid })
  .strict();
export const AdminDeviceParamsV1Schema = z
  .object({ account_id: Uuid, device_id: Uuid })
  .strict();
export const AdminDeviceQueryV1Schema = z
  .object({ status: DeviceStatus.optional(), limit: Limit, cursor: Cursor })
  .strict();

export const AdminAuditEventsQueryV1Schema = z
  .object({
    action: BoundedMachineString.optional(),
    targetType: BoundedMachineString.optional(),
    targetId: Uuid.optional(),
    actorType: BoundedMachineString.optional(),
    actorId: Uuid.optional(),
    correlationId: BoundedMachineString.optional(),
    limit: Limit,
    cursor: Cursor,
  })
  .strict();

export const AdminPrincipalsQueryV1Schema = z
  .object({
    principalId: Uuid.optional(),
    userId: Uuid.optional(),
    status: Status.optional(),
    role: z.enum(ADMIN_ROLES).optional(),
    limit: Limit,
    cursor: Cursor,
  })
  .strict();

export const AdminPrincipalCreateBodyV1Schema = z
  .object({
    userId: Uuid,
    initialRole: z.enum(ADMIN_ROLES),
    reason: AdminReasonV1Schema,
  })
  .strict();
export const AdminPrincipalRoleParamsV1Schema = z
  .object({ principal_id: Uuid, role: z.enum(ADMIN_ROLES) })
  .strict();
export const AdminPrincipalMutationParamsV1Schema = z
  .object({ principal_id: Uuid })
  .strict();
export const AdminPrincipalMutationBodyV1Schema = z
  .object({
    expectedRevision: z.number().int().positive().safe(),
    reason: AdminReasonV1Schema,
  })
  .strict();
export const AdminDeviceRevokeBodyV1Schema = z
  .object({ reason: AdminReasonV1Schema })
  .strict();

export type SafeAccount = {
  id: string;
  status: "ACTIVE" | "SUSPENDED";
  displayName: string | null;
  createdAt: Date;
  updatedAt: Date;
};
export type SafeUser = {
  id: string;
  status: "ACTIVE" | "SUSPENDED";
  emails: { email: string; verifiedAt: Date | null }[];
  createdAt: Date;
  updatedAt: Date;
};
type SafeDeviceBase = {
  id: string;
  status: "ACTIVE" | "REVOKED";
  label: string | null;
  createdAt: Date;
  activatedAt: Date | null;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
};
export type SafeDevice = SafeDeviceBase &
  (
    | {
        clientMetadata: { state: "WITHHELD" };
        browserFamily?: never;
        browserVersionLastSeen?: never;
        extensionVersionLastSeen?: never;
      }
    | {
        clientMetadata: {
          state: "PRESENT";
          browserFamily: string;
          browserVersion: string | null;
          extensionVersion: string;
        };
        browserFamily: string;
        browserVersionLastSeen: string | null;
        extensionVersionLastSeen: string;
      }
  );
export type AuditEvent = {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  correlationId: string;
  createdAt: Date;
};
export type AdminPrincipal = {
  principalId: string;
  userId: string;
  status: "ACTIVE" | "SUSPENDED";
  revision: number;
  roles: AdminRole[];
  createdAt: Date;
  updatedAt: Date;
};
export type AdminPage<T> = { items: T[]; nextCursor?: string };

export type AdminOpsResultCode =
  | "ADMIN_RESOURCE_NOT_FOUND"
  | "ADMIN_CONFLICT"
  | "ADMIN_STATE_STALE"
  | "ADMIN_LAST_OWNER_REQUIRED"
  | "ADMIN_FORBIDDEN"
  | "INVALID_REQUEST"
  | "SERVICE_UNAVAILABLE";

export type AdminOpsRepository = {
  listAccounts(input: {
    accountId?: string;
    ownerUserId?: string;
    ownerEmail?: string;
    status?: "ACTIVE" | "SUSPENDED";
    limit: number;
    cursor?: string;
  }): Promise<AdminPage<SafeAccount> | { kind: "INVALID_CURSOR" }>;
  listUsers(input: {
    userId?: string;
    email?: string;
    status?: "ACTIVE" | "SUSPENDED";
    limit: number;
    cursor?: string;
  }): Promise<AdminPage<SafeUser> | { kind: "INVALID_CURSOR" }>;
  listDevices(input: {
    accountId: string;
    status?: "ACTIVE" | "REVOKED";
    limit: number;
    cursor?: string;
  }): Promise<
    AdminPage<SafeDevice> | { kind: "ACCOUNT_NOT_FOUND" | "INVALID_CURSOR" }
  >;
  revokeDevice(input: {
    accountId: string;
    deviceId: string;
    actorId: string;
    correlationId: string;
    reason: AdminReasonV1;
  }): Promise<"REVOKED" | "ALREADY_REVOKED" | "NOT_FOUND" | "FORBIDDEN">;
  listAuditEvents(input: {
    action?: string;
    targetType?: string;
    targetId?: string;
    actorType?: string;
    actorId?: string;
    correlationId?: string;
    limit: number;
    cursor?: string;
  }): Promise<AdminPage<AuditEvent> | { kind: "INVALID_CURSOR" }>;
  listPrincipals(input: {
    principalId?: string;
    userId?: string;
    status?: "ACTIVE" | "SUSPENDED";
    role?: AdminRole;
    limit: number;
    cursor?: string;
  }): Promise<AdminPage<AdminPrincipal> | { kind: "INVALID_CURSOR" }>;
  createPrincipal(input: {
    userId: string;
    initialRole: AdminRole;
    actorId: string;
    correlationId: string;
    reason: AdminReasonV1;
  }): Promise<
    | { kind: "OK"; principal: AdminPrincipal }
    | {
        kind:
          | "USER_NOT_FOUND"
          | "USER_INACTIVE"
          | "USER_UNVERIFIED"
          | "CONFLICT"
          | "FORBIDDEN";
      }
  >;
  grantRole(input: {
    principalId: string;
    role: AdminRole;
    expectedRevision: number;
    actorId: string;
    correlationId: string;
    reason: AdminReasonV1;
  }): Promise<
    | { kind: "OK"; principal: AdminPrincipal }
    | { kind: "NOT_FOUND" | "CONFLICT" | "STALE" | "FORBIDDEN" }
  >;
  revokeRole(input: {
    principalId: string;
    role: AdminRole;
    expectedRevision: number;
    actorId: string;
    correlationId: string;
    reason: AdminReasonV1;
  }): Promise<
    | { kind: "OK"; principal: AdminPrincipal }
    | { kind: "NOT_FOUND" | "CONFLICT" | "STALE" | "LAST_OWNER" | "FORBIDDEN" }
  >;
  setPrincipalStatus(input: {
    principalId: string;
    status: "ACTIVE" | "SUSPENDED";
    expectedRevision: number;
    actorId: string;
    correlationId: string;
    reason: AdminReasonV1;
  }): Promise<
    | {
        kind: "OK";
        changed: true;
        principal: AdminPrincipal;
        revokedSessionCount: number;
      }
    | {
        kind: "OK";
        changed: false;
        principal: AdminPrincipal;
        revokedSessionCount: 0;
      }
    | { kind: "NOT_FOUND" | "STALE" | "LAST_OWNER" | "FORBIDDEN" }
  >;
};

export type AdminOpsServiceResult<T> =
  | { kind: "OK"; value: T }
  | { kind: "INVALID" }
  | { kind: "INVALID_CURSOR" }
  | { kind: "NOT_FOUND" }
  | { kind: "CONFLICT" }
  | { kind: "STALE" }
  | { kind: "LAST_OWNER" }
  | { kind: "FORBIDDEN" }
  | { kind: "USER_NOT_FOUND" | "USER_INACTIVE" | "USER_UNVERIFIED" };

export class AdminOpsService {
  public constructor(
    private readonly repository: AdminOpsRepository,
    private readonly commercialPortal: CommercialPortalService,
  ) {}

  private pageLimit(limit?: number): number | undefined {
    const value = limit ?? 50;
    return Number.isInteger(value) && value >= 1 && value <= 100
      ? value
      : undefined;
  }
  async listAccounts(
    input: Omit<Parameters<AdminOpsRepository["listAccounts"]>[0], "limit"> & {
      limit?: number;
    },
  ): Promise<AdminPage<SafeAccount> | { kind: "INVALID" | "INVALID_CURSOR" }> {
    const limit = this.pageLimit(input.limit);
    if (!limit) return { kind: "INVALID" as const };
    const ownerEmail =
      input.ownerEmail === undefined
        ? undefined
        : normalizeEmail(input.ownerEmail);
    if (input.ownerEmail !== undefined && !ownerEmail)
      return { kind: "INVALID" as const };
    if (
      [input.accountId, input.ownerUserId, ownerEmail].filter(Boolean).length >
      1
    )
      return { kind: "INVALID" as const };
    return this.repository.listAccounts({ ...input, ownerEmail, limit });
  }
  async listUsers(
    input: Omit<Parameters<AdminOpsRepository["listUsers"]>[0], "limit"> & {
      limit?: number;
    },
  ): Promise<AdminPage<SafeUser> | { kind: "INVALID" | "INVALID_CURSOR" }> {
    const limit = this.pageLimit(input.limit);
    if (!limit) return { kind: "INVALID" as const };
    const email =
      input.email === undefined ? undefined : normalizeEmail(input.email);
    if (input.email !== undefined && !email)
      return { kind: "INVALID" as const };
    if (input.userId && email) return { kind: "INVALID" as const };
    return this.repository.listUsers({ ...input, email, limit });
  }
  listDevices(
    input: Omit<Parameters<AdminOpsRepository["listDevices"]>[0], "limit"> & {
      limit?: number;
    },
  ): Promise<
    | AdminPage<SafeDevice>
    | { kind: "ACCOUNT_NOT_FOUND" | "INVALID_CURSOR" | "INVALID" }
  > {
    const limit = this.pageLimit(input.limit);
    return limit
      ? this.repository.listDevices({ ...input, limit })
      : Promise.resolve({ kind: "INVALID" as const });
  }
  listAuditEvents(
    input: Omit<
      Parameters<AdminOpsRepository["listAuditEvents"]>[0],
      "limit"
    > & { limit?: number },
  ): Promise<AdminPage<AuditEvent> | { kind: "INVALID_CURSOR" | "INVALID" }> {
    const limit = this.pageLimit(input.limit);
    return limit
      ? this.repository.listAuditEvents({ ...input, limit })
      : Promise.resolve({ kind: "INVALID" as const });
  }
  listPrincipals(
    input: Omit<
      Parameters<AdminOpsRepository["listPrincipals"]>[0],
      "limit"
    > & { limit?: number },
  ): Promise<
    AdminPage<AdminPrincipal> | { kind: "INVALID_CURSOR" | "INVALID" }
  > {
    const limit = this.pageLimit(input.limit);
    return limit
      ? this.repository.listPrincipals({ ...input, limit })
      : Promise.resolve({ kind: "INVALID" as const });
  }
  readSubscription(
    accountId: string,
  ): Promise<
    | { kind: "OK"; value: PortalSubscriptionRead }
    | { kind: "ACCOUNT_NOT_FOUND" }
    | { kind: "SERVICE_UNAVAILABLE" }
  > {
    return this.commercialPortal.readAccountSubscription(accountId);
  }
  revokeDevice(input: Parameters<AdminOpsRepository["revokeDevice"]>[0]) {
    return this.repository.revokeDevice(input);
  }
  createPrincipal(input: Parameters<AdminOpsRepository["createPrincipal"]>[0]) {
    return this.repository.createPrincipal(input);
  }
  grantRole(input: Parameters<AdminOpsRepository["grantRole"]>[0]) {
    return this.repository.grantRole(input);
  }
  revokeRole(input: Parameters<AdminOpsRepository["revokeRole"]>[0]) {
    return this.repository.revokeRole(input);
  }
  setPrincipalStatus(
    input: Parameters<AdminOpsRepository["setPrincipalStatus"]>[0],
  ) {
    return this.repository.setPrincipalStatus(input);
  }
}

export function lastActiveOwnerWouldBeRemoved(input: {
  activeOwnerCount: number;
  targetIsActiveOwner: boolean;
}): boolean {
  return input.targetIsActiveOwner && input.activeOwnerCount <= 1;
}

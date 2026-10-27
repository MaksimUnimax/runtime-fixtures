import { describe, expect, it, vi } from "vitest";
import {
  AdminAccountParamsV1Schema,
  AdminAccountsQueryV1Schema,
  AdminAuditEventsQueryV1Schema,
  AdminDeviceParamsV1Schema,
  AdminDeviceQueryV1Schema,
  AdminDeviceRevokeBodyV1Schema,
  AdminPrincipalCreateBodyV1Schema,
  AdminPrincipalMutationBodyV1Schema,
  AdminPrincipalRoleParamsV1Schema,
  AdminPrincipalsQueryV1Schema,
  AdminReasonV1Schema,
  AdminUsersQueryV1Schema,
  AdminOpsService,
  lastActiveOwnerWouldBeRemoved,
} from "./index.js";

const uuid = "00000000-0000-4000-8000-000000000001";
const uuid2 = "00000000-0000-4000-8000-000000000002";
const page = { items: [], nextCursor: undefined };
const repo = () => ({
  listAccounts: vi.fn(async () => page),
  listUsers: vi.fn(async () => page),
  listDevices: vi.fn(async () => page),
  listAuditEvents: vi.fn(async () => page),
  listPrincipals: vi.fn(async () => page),
  revokeDevice: vi.fn(async () => "ALREADY_REVOKED" as const),
  createPrincipal: vi.fn(async () => ({ kind: "CONFLICT" as const })),
  grantRole: vi.fn(async () => ({ kind: "CONFLICT" as const })),
  revokeRole: vi.fn(async () => ({ kind: "CONFLICT" as const })),
  setPrincipalStatus: vi.fn(async () => ({ kind: "NOT_FOUND" as const })),
});

describe("P6.2 admin reason contract", () => {
  it.each([
    "operator requested support action",
    "ticket-123",
    "a",
    "A reason with spaces",
    "unicode: причина",
    "reason/with:machine-code",
    "x".repeat(256),
  ])("accepts bounded reason %s", (reason) =>
    expect(AdminReasonV1Schema.safeParse(reason).success).toBe(true),
  );
  it.each([
    "",
    " ",
    "x\n",
    "x\r",
    "x\u0000",
    "x\u001f",
    "x\u007f",
    "x".repeat(257),
  ])("rejects unsafe reason %j", (reason) =>
    expect(AdminReasonV1Schema.safeParse(reason).success).toBe(false),
  );
  it.each([
    "operator\u0085ticket",
    "operator\u009fticket",
    "operator\u061cticket",
    "operator\u200eticket",
    "operator\u200fticket",
    "operator\u202aticket",
    "operator\u202eticket",
    "operator\u2066ticket",
    "operator\u2069ticket",
  ])("rejects invisible admin audit-control reason %j", (reason) =>
    expect(AdminReasonV1Schema.safeParse(reason).success).toBe(false),
  );
  it.each(["\u0085", "\u202e"])(
    "rejects invisible reason control %j across admin mutation schemas",
    (control) => {
      const reason = `ticket${control}123`;
      expect(
        AdminPrincipalCreateBodyV1Schema.safeParse({
          userId: uuid,
          initialRole: "ADMIN_OWNER",
          reason,
        }).success,
      ).toBe(false);
      expect(
        AdminPrincipalMutationBodyV1Schema.safeParse({
          expectedRevision: 1,
          reason,
        }).success,
      ).toBe(false);
      expect(AdminDeviceRevokeBodyV1Schema.safeParse({ reason }).success).toBe(
        false,
      );
    },
  );
});

describe("last active owner decision", () => {
  it.each([
    [0, true, true],
    [1, true, true],
    [2, true, false],
    [99, true, false],
    [0, false, false],
    [1, false, false],
    [2, false, false],
    [3, true, false],
    [4, true, false],
    [5, true, false],
    [6, true, false],
    [7, true, false],
    [8, true, false],
    [9, true, false],
    [10, true, false],
    [10, false, false],
    [100, true, false],
    [100, false, false],
    [1, true, true],
    [1, false, false],
    [0, true, true],
    [0, false, false],
  ])(
    "count=%d targetOwner=%s => %s",
    (activeOwnerCount, targetIsActiveOwner, expected) => {
      expect(
        lastActiveOwnerWouldBeRemoved({
          activeOwnerCount,
          targetIsActiveOwner,
        }),
      ).toBe(expected);
    },
  );
});

describe("P6.2 strict query and command schemas", () => {
  it.each([
    { accountId: uuid },
    { ownerUserId: uuid },
    { ownerEmail: " Owner@Example.TEST " },
    { status: "ACTIVE" },
    { status: "SUSPENDED", limit: "1", cursor: uuid },
    { limit: "100" },
    { limit: 1 },
  ])("accepts account query %j", (input) =>
    expect(AdminAccountsQueryV1Schema.safeParse(input).success).toBe(true),
  );
  it.each([
    { accountId: uuid, ownerUserId: uuid2 },
    { ownerEmail: "not-an-email", ownerUserId: uuid },
    { limit: "0" },
    { limit: "101" },
    { unknown: "x" },
    { cursor: "bad" },
  ])("rejects account query %j", (input) =>
    expect(AdminAccountsQueryV1Schema.safeParse(input).success).toBe(false),
  );
  it.each([
    { userId: uuid },
    { email: "a@example.test" },
    { status: "ACTIVE" },
    { limit: "50", cursor: uuid },
    {},
  ])("accepts user query %j", (input) =>
    expect(AdminUsersQueryV1Schema.safeParse(input).success).toBe(true),
  );
  it.each([
    { userId: uuid, email: "a@example.test" },
    { email: "bad" },
    { status: "NOPE" },
    { unknown: true },
  ])("rejects user query %j", (input) =>
    expect(AdminUsersQueryV1Schema.safeParse(input).success).toBe(false),
  );
  it.each([{ status: "ACTIVE" }, { status: "REVOKED" }, { limit: "100" }, {}])(
    "accepts device query %j",
    (input) =>
      expect(AdminDeviceQueryV1Schema.safeParse(input).success).toBe(true),
  );
  it.each([{ status: "PENDING" }, { limit: "0" }, { cursor: "bad" }])(
    "rejects device query %j",
    (input) =>
      expect(AdminDeviceQueryV1Schema.safeParse(input).success).toBe(false),
  );
  it.each([
    { action: "ADMIN_ROLE_GRANTED" },
    { targetId: uuid },
    { actorType: "ADMIN" },
    { limit: "1" },
    {},
  ])("accepts audit query %j", (input) =>
    expect(AdminAuditEventsQueryV1Schema.safeParse(input).success).toBe(true),
  );
  it.each([
    { action: "bad value" },
    { correlationId: "x\n" },
    { targetId: "bad" },
    { limit: "101" },
  ])("rejects audit query %j", (input) =>
    expect(AdminAuditEventsQueryV1Schema.safeParse(input).success).toBe(false),
  );
  it.each([
    { principalId: uuid },
    { userId: uuid },
    { role: "ADMIN_OWNER" },
    { status: "SUSPENDED" },
    {},
  ])("accepts principal query %j", (input) =>
    expect(AdminPrincipalsQueryV1Schema.safeParse(input).success).toBe(true),
  );
  it.each([{ role: "OWNER" }, { principalId: "bad" }, { limit: "0" }])(
    "rejects principal query %j",
    (input) =>
      expect(AdminPrincipalsQueryV1Schema.safeParse(input).success).toBe(false),
  );
  it.each([
    { userId: uuid, initialRole: "ADMIN_OWNER", reason: "create" },
    { userId: uuid, initialRole: "ADMIN_OPS", reason: "create" },
    { userId: uuid, initialRole: "ADMIN_SUPPORT", reason: "create" },
    { userId: uuid, initialRole: "ADMIN_BILLING_READONLY", reason: "create" },
  ])("accepts exact initial role %j", (input) =>
    expect(AdminPrincipalCreateBodyV1Schema.safeParse(input).success).toBe(
      true,
    ),
  );
  it.each([
    { userId: uuid, initialRole: "OWNER", reason: "create" },
    { userId: uuid, initialRole: "ADMIN_OPS" },
    { userId: "bad", initialRole: "ADMIN_OPS", reason: "x" },
  ])("rejects malformed create %j", (input) =>
    expect(AdminPrincipalCreateBodyV1Schema.safeParse(input).success).toBe(
      false,
    ),
  );
  it("requires exact account and device params", () => {
    expect(
      AdminAccountParamsV1Schema.safeParse({ account_id: uuid }).success,
    ).toBe(true);
    expect(
      AdminDeviceParamsV1Schema.safeParse({
        account_id: uuid,
        device_id: uuid2,
      }).success,
    ).toBe(true);
    expect(
      AdminDeviceParamsV1Schema.safeParse({ account_id: uuid }).success,
    ).toBe(false);
  });
  it.each([
    { principal_id: uuid, role: "ADMIN_OWNER" },
    { principal_id: uuid, role: "ADMIN_OPS" },
    { principal_id: uuid, role: "ADMIN_SUPPORT" },
    { principal_id: uuid, role: "ADMIN_BILLING_READONLY" },
  ])("accepts exact role path %j", (input) =>
    expect(AdminPrincipalRoleParamsV1Schema.safeParse(input).success).toBe(
      true,
    ),
  );
  it("requires optimistic revision and reason", () => {
    expect(
      AdminPrincipalMutationBodyV1Schema.safeParse({
        expectedRevision: 1,
        reason: "ticket",
      }).success,
    ).toBe(true);
    expect(
      AdminPrincipalMutationBodyV1Schema.safeParse({
        expectedRevision: 0,
        reason: "ticket",
      }).success,
    ).toBe(false);
    expect(
      AdminDeviceRevokeBodyV1Schema.safeParse({ reason: "ticket" }).success,
    ).toBe(true);
  });
});

describe("admin-ops service normalization and delegation", () => {
  it("normalizes exact account owner email", async () => {
    const r = repo();
    const service = new AdminOpsService(r as never, {} as never);
    await service.listAccounts({ ownerEmail: " Owner@Example.TEST " });
    expect(r.listAccounts).toHaveBeenCalledWith(
      expect.objectContaining({ ownerEmail: "owner@example.test", limit: 50 }),
    );
  });
  it("normalizes exact user email", async () => {
    const r = repo();
    const service = new AdminOpsService(r as never, {} as never);
    await service.listUsers({ email: " User@Example.TEST " });
    expect(r.listUsers).toHaveBeenCalledWith(
      expect.objectContaining({ email: "user@example.test", limit: 50 }),
    );
  });
  it.each([1, 50, 100])("passes valid page limit %d", async (limit) => {
    const r = repo();
    const service = new AdminOpsService(r as never, {} as never);
    await service.listAccounts({ limit });
    expect(r.listAccounts).toHaveBeenCalledWith(
      expect.objectContaining({ limit }),
    );
  });
  it.each([0, 101, 1.5, NaN])(
    "rejects invalid page limit %s",
    async (limit) => {
      const r = repo();
      const service = new AdminOpsService(r as never, {} as never);
      const result = await service.listAccounts({ limit });
      expect("kind" in result && result.kind).toBe("INVALID");
      expect(r.listAccounts).not.toHaveBeenCalled();
    },
  );
  it("delegates device, audit, and principal reads", async () => {
    const r = repo();
    const service = new AdminOpsService(r as never, {} as never);
    await service.listDevices({ accountId: uuid });
    await service.listAuditEvents({});
    await service.listPrincipals({});
    expect(r.listDevices).toHaveBeenCalled();
    expect(r.listAuditEvents).toHaveBeenCalled();
    expect(r.listPrincipals).toHaveBeenCalled();
  });
  it("delegates idempotent device revoke without rewriting the result", async () => {
    const r = repo();
    const service = new AdminOpsService(r as never, {} as never);
    await expect(
      service.revokeDevice({
        accountId: uuid,
        deviceId: uuid2,
        actorId: uuid,
        correlationId: "c",
        reason: "ticket",
      }),
    ).resolves.toBe("ALREADY_REVOKED");
  });
});

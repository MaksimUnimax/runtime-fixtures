import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_ROLES,
  permissionsForRole,
  type AdminPermission,
} from "@product/admin-auth";
import {
  B14_AUDIT_REASON_CATEGORIES,
  mapB14AuditSummary,
  type B14AuditSummaryProjection,
  type B14AuditWhat,
} from "./b14-audit-summary.js";

const owner = permissionsForRole("ADMIN_OWNER");
const initialGrant = {
  action: "ADMIN_ROLE_GRANTED",
  targetType: "ADMIN_PRINCIPAL",
  role: "ADMIN_SUPPORT",
};
const grant = { ...initialGrant, oldRevision: 2, newRevision: 3 };
const device = { action: "ADMIN_DEVICE_REVOKED", targetType: "DEVICE" };
const suspension = {
  action: "ADMIN_PRINCIPAL_SUSPENDED",
  targetType: "ADMIN_PRINCIPAL",
  oldRevision: 3,
  newRevision: 4,
  revokedSessionCount: 2,
};
const subscriptionGrant = {
  action: "SUBSCRIPTION_GRANTED",
  targetType: "SUBSCRIPTION",
  planRevisionId: "00000000-0000-4000-8000-0000000000a1",
  fromState: null,
  toState: "ACTIVE",
  stateRevision: 1,
  transitionRevision: 1,
};
const subscriptionExtension = {
  action: "SUBSCRIPTION_EXTENDED",
  targetType: "SUBSCRIPTION",
  oldStateRevision: 3,
  newStateRevision: 4,
  oldPeriodEnd: "2026-09-01T12:00:00.000Z",
  newPeriodEnd: "2026-10-01T12:00:00.000Z",
};
const subscriptionSuspension = {
  action: "SUBSCRIPTION_SUSPENDED",
  targetType: "SUBSCRIPTION",
  fromState: "GRACE",
  toState: "SUSPENDED",
  oldStateRevision: 4,
  newStateRevision: 5,
  transitionRevision: 3,
};
const subscriptionRestoration = {
  action: "SUBSCRIPTION_RESTORED",
  targetType: "SUBSCRIPTION",
  fromState: "SUSPENDED",
  toState: "GRACE",
  oldStateRevision: 5,
  newStateRevision: 6,
  transitionRevision: 4,
};
const overrideSet = {
  action: "ACCOUNT_ENTITLEMENT_OVERRIDE_SET",
  targetType: "ACCOUNT",
  entitlementKey: "extension.max_devices",
  overrideRevision: 1,
  operation: "SET",
  valueType: "INTEGER",
  effectiveFrom: "2026-09-01T12:00:00.000Z",
  expiresAt: null,
};
const overrideClear = {
  ...overrideSet,
  action: "ACCOUNT_ENTITLEMENT_OVERRIDE_CLEARED",
  overrideRevision: 2,
  operation: "CLEAR",
  valueType: "BOOLEAN",
  effectiveFrom: "2026-10-01T12:00:00.000Z",
  expiresAt: "2026-11-01T12:00:00.000Z",
};
const betaOpen = {
  action: "BETA_ADMISSION_CHANGED",
  targetType: "BETA_ADMISSION_STATE",
  betaAction: "OPEN",
  oldMode: "CLOSED",
  newMode: "OPEN",
  oldCapacity: 10,
  newCapacity: 10,
  oldAdmitted: 3,
  newAdmitted: 3,
  oldRevision: 6,
  newRevision: 7,
};
const invitationCreated = {
  action: "BETA_IDENTITY_INVITED",
  targetType: "BETA_IDENTITY_INVITATION",
  expiresAt: "2026-10-28T12:00:00.000Z",
};
const invitationRevoked = {
  action: "BETA_IDENTITY_INVITATION_REVOKED",
  targetType: "BETA_IDENTITY_INVITATION",
};
const additionalEvents: {
  input: B14AuditSummaryProjection;
  expected: B14AuditWhat;
  readPermission: AdminPermission;
  family: "subscription" | "entitlement" | "beta";
}[] = [
  {
    input: subscriptionGrant,
    expected: {
      kind: "SUBSCRIPTION_GRANTED",
      planRevisionId: subscriptionGrant.planRevisionId,
      fromState: null,
      toState: "ACTIVE",
      stateRevision: 1,
      transitionRevision: 1,
    },
    readPermission: "subscription.read",
    family: "subscription",
  },
  {
    input: subscriptionExtension,
    expected: {
      kind: "SUBSCRIPTION_EXTENDED",
      revision: { from: 3, to: 4 },
      periodEnd: {
        from: "2026-09-01T12:00:00.000Z",
        to: "2026-10-01T12:00:00.000Z",
      },
    },
    readPermission: "subscription.read",
    family: "subscription",
  },
  {
    input: subscriptionSuspension,
    expected: {
      kind: "SUBSCRIPTION_SUSPENDED",
      fromState: "GRACE",
      toState: "SUSPENDED",
      revision: { from: 4, to: 5 },
      transitionRevision: 3,
    },
    readPermission: "subscription.read",
    family: "subscription",
  },
  {
    input: subscriptionRestoration,
    expected: {
      kind: "SUBSCRIPTION_RESTORED",
      fromState: "SUSPENDED",
      toState: "GRACE",
      revision: { from: 5, to: 6 },
      transitionRevision: 4,
    },
    readPermission: "subscription.read",
    family: "subscription",
  },
  {
    input: overrideSet,
    expected: {
      kind: "ACCOUNT_ENTITLEMENT_OVERRIDE_SET",
      entitlementKey: "extension.max_devices",
      overrideRevision: 1,
      operation: "SET",
      valueType: "INTEGER",
      effectiveFrom: "2026-09-01T12:00:00.000Z",
      expiresAt: null,
    },
    readPermission: "entitlement.read",
    family: "entitlement",
  },
  {
    input: overrideClear,
    expected: {
      kind: "ACCOUNT_ENTITLEMENT_OVERRIDE_CLEARED",
      entitlementKey: "extension.max_devices",
      overrideRevision: 2,
      operation: "CLEAR",
      valueType: "BOOLEAN",
      effectiveFrom: "2026-10-01T12:00:00.000Z",
      expiresAt: "2026-11-01T12:00:00.000Z",
    },
    readPermission: "entitlement.read",
    family: "entitlement",
  },
  {
    input: betaOpen,
    expected: {
      kind: "BETA_ADMISSION_CHANGED",
      action: "OPEN",
      old: { mode: "CLOSED", capacity: 10, admitted: 3, revision: 6 },
      new: { mode: "OPEN", capacity: 10, admitted: 3, revision: 7 },
    },
    readPermission: "beta.admission.read",
    family: "beta",
  },
  {
    input: invitationCreated,
    expected: {
      kind: "BETA_IDENTITY_INVITED",
      expiresAt: "2026-10-28T12:00:00.000Z",
    },
    readPermission: "beta.admission.read",
    family: "beta",
  },
  {
    input: invitationRevoked,
    expected: { kind: "BETA_IDENTITY_INVITATION_REVOKED" },
    readPermission: "beta.admission.read",
    family: "beta",
  },
];

describe("B14 internal audit summary", () => {
  it("projects actual principal creation, initial grant and later changes", () => {
    expect(
      mapB14AuditSummary(
        {
          action: "ADMIN_PRINCIPAL_CREATED",
          targetType: "ADMIN_PRINCIPAL",
          initialRole: "ADMIN_SUPPORT",
        },
        owner,
      ),
    ).toEqual({
      what: {
        kind: "ADMIN_PRINCIPAL_CREATED",
        initialRole: "ADMIN_SUPPORT",
      },
    });
    expect(mapB14AuditSummary(initialGrant, owner)).toEqual({
      what: { kind: "ADMIN_ROLE_GRANTED", role: "ADMIN_SUPPORT" },
    });
    expect(mapB14AuditSummary(grant, owner)).toEqual({
      what: {
        kind: "ADMIN_ROLE_GRANTED",
        role: "ADMIN_SUPPORT",
        revision: { from: 2, to: 3 },
      },
    });
    expect(
      mapB14AuditSummary({ ...grant, action: "ADMIN_ROLE_REVOKED" }, owner),
    ).toEqual({
      what: {
        kind: "ADMIN_ROLE_REVOKED",
        role: "ADMIN_SUPPORT",
        revision: { from: 2, to: 3 },
      },
    });
    expect(mapB14AuditSummary(suspension, owner)).toEqual({
      what: {
        kind: "ADMIN_PRINCIPAL_SUSPENDED",
        revision: { from: 3, to: 4 },
        revokedSessionCount: 2,
      },
    });
    expect(
      mapB14AuditSummary(
        {
          action: "ADMIN_PRINCIPAL_RESTORED",
          targetType: "ADMIN_PRINCIPAL",
          oldRevision: 4,
          newRevision: 5,
        },
        owner,
      ),
    ).toEqual({
      what: {
        kind: "ADMIN_PRINCIPAL_RESTORED",
        revision: { from: 4, to: 5 },
      },
    });
  });

  it.each(ADMIN_ROLES)("uses the current shared role %s", (role) => {
    expect(mapB14AuditSummary({ ...initialGrant, role }, owner)).toEqual({
      what: { kind: "ADMIN_ROLE_GRANTED", role },
    });
    expect(
      mapB14AuditSummary(
        {
          action: "ADMIN_PRINCIPAL_CREATED",
          targetType: "ADMIN_PRINCIPAL",
          initialRole: role,
        },
        owner,
      ),
    ).toEqual({ what: { kind: "ADMIN_PRINCIPAL_CREATED", initialRole: role } });
  });

  it.each([
    "ADMIN_OWNER ",
    "admin_owner",
    "ADMIN_FUTURE",
    "secret-role-canary",
    "",
    undefined,
    null,
    1,
    ["ADMIN_OWNER"],
    { role: "ADMIN_OWNER" },
  ])("does not project an unknown or malformed role %j", (role) => {
    expect(mapB14AuditSummary({ ...grant, role }, owner)).toBeUndefined();
    expect(
      mapB14AuditSummary(
        {
          action: "ADMIN_PRINCIPAL_CREATED",
          targetType: "ADMIN_PRINCIPAL",
          initialRole: role,
        },
        owner,
      ),
    ).toBeUndefined();
  });

  it.each([
    ["ADMIN_OWNER", true, true],
    ["ADMIN_OPS", false, true],
    ["ADMIN_SUPPORT", false, true],
    ["ADMIN_BILLING_READONLY", false, false],
    ["ADMIN_BETA_OPERATOR", false, false],
  ] as const)(
    "%s sees only the audit details permitted by its object reads",
    (role, principalAllowed, deviceAllowed) => {
      const permissions = permissionsForRole(role);
      expect(mapB14AuditSummary(grant, permissions) !== undefined).toBe(
        principalAllowed,
      );
      expect(mapB14AuditSummary(device, permissions) !== undefined).toBe(
        deviceAllowed,
      );
    },
  );

  it.each([
    [],
    ["admin.audit.read"],
    ["admin.principal.read", "device.read"],
    ["admin.audit.read", "admin.principal.manage", "device.revoke"],
  ] satisfies AdminPermission[][])(
    "requires audit and object read permissions, not management alone: %j",
    (...permissions) => {
      expect(mapB14AuditSummary(grant, permissions)).toBeUndefined();
      expect(mapB14AuditSummary(device, permissions)).toBeUndefined();
    },
  );

  it.each(B14_AUDIT_REASON_CATEGORIES)(
    "returns an explicitly recorded category %s",
    (reasonCategory) => {
      expect(mapB14AuditSummary({ ...grant, reasonCategory }, owner)).toEqual({
        what: {
          kind: "ADMIN_ROLE_GRANTED",
          role: "ADMIN_SUPPORT",
          revision: { from: 2, to: 3 },
        },
        reasonCategory,
      });
    },
  );

  it.each([
    "ACCESS_SETUP ",
    "access_setup",
    "SECURITY_RESPONSE\u202e",
    "NEW_CATEGORY",
    "private-reason-canary",
    "",
    null,
    7,
    ["ACCESS_SETUP"],
    { category: "ACCESS_SETUP" },
  ])("fails closed on a malformed category %j", (reasonCategory) => {
    expect(
      mapB14AuditSummary({ ...grant, reasonCategory }, owner),
    ).toBeUndefined();
    expect(
      mapB14AuditSummary({ ...device, reasonCategory }, owner),
    ).toBeUndefined();
  });

  it("does not invent a reason category or revision for a legacy initial grant", () => {
    const projection = {
      ...initialGrant,
      reason: "security-response-private-reason-canary",
      safeMetadata: {
        role: "ADMIN_SUPPORT",
        reason: "private-metadata-canary",
      },
    };
    const result = mapB14AuditSummary(projection, owner);
    expect(result).toEqual({
      what: { kind: "ADMIN_ROLE_GRANTED", role: "ADMIN_SUPPORT" },
    });
    expect(result).not.toHaveProperty("reasonCategory");
    expect(result?.what).not.toHaveProperty("revision");
  });

  it.each([
    { oldRevision: 2 },
    { newRevision: 3 },
    { oldRevision: null, newRevision: null },
    { oldRevision: "2", newRevision: 3 },
    { oldRevision: 2, newRevision: "3" },
    { oldRevision: 0, newRevision: 1 },
    { oldRevision: -1, newRevision: 0 },
    { oldRevision: 2, newRevision: 2 },
    { oldRevision: 3, newRevision: 2 },
    { oldRevision: 2, newRevision: 4 },
    { oldRevision: 1.5, newRevision: 2.5 },
    { oldRevision: Number.NaN, newRevision: 3 },
    { oldRevision: 2, newRevision: Number.POSITIVE_INFINITY },
    {
      oldRevision: Number.MAX_SAFE_INTEGER,
      newRevision: Number.MAX_SAFE_INTEGER + 1,
    },
  ])(
    "rejects a partial, malformed or non-sequential revision %j",
    (revision) => {
      for (const action of [
        "ADMIN_ROLE_GRANTED",
        "ADMIN_ROLE_REVOKED",
        "ADMIN_PRINCIPAL_SUSPENDED",
        "ADMIN_PRINCIPAL_RESTORED",
      ]) {
        expect(
          mapB14AuditSummary(
            { ...initialGrant, revokedSessionCount: 0, ...revision, action },
            owner,
          ),
        ).toBeUndefined();
      }
    },
  );

  it("review regression: accepts the final valid PostgreSQL principal revision", () => {
    expect(
      mapB14AuditSummary(
        { ...grant, oldRevision: 2_147_483_646, newRevision: 2_147_483_647 },
        owner,
      ),
    ).toEqual({
      what: {
        kind: "ADMIN_ROLE_GRANTED",
        role: "ADMIN_SUPPORT",
        revision: { from: 2_147_483_646, to: 2_147_483_647 },
      },
    });
  });

  it("review regression: rejects a revision outside the actual PostgreSQL column", () => {
    expect(
      mapB14AuditSummary(
        { ...grant, oldRevision: 2_147_483_647, newRevision: 2_147_483_648 },
        owner,
      ),
    ).toBeUndefined();
  });

  it.each([
    "ADMIN_ROLE_REVOKED",
    "ADMIN_PRINCIPAL_SUSPENDED",
    "ADMIN_PRINCIPAL_RESTORED",
  ])("does not invent missing revisions for %s", (action) => {
    expect(
      mapB14AuditSummary(
        { ...initialGrant, action, revokedSessionCount: 0 },
        owner,
      ),
    ).toBeUndefined();
  });

  it("preserves an explicit zero revoked-session count", () => {
    expect(
      mapB14AuditSummary({ ...suspension, revokedSessionCount: 0 }, owner),
    ).toEqual({
      what: {
        kind: "ADMIN_PRINCIPAL_SUSPENDED",
        revision: { from: 3, to: 4 },
        revokedSessionCount: 0,
      },
    });
  });

  it.each([
    undefined,
    null,
    "2",
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("never guesses or coerces session count %j", (revokedSessionCount) => {
    expect(
      mapB14AuditSummary({ ...suspension, revokedSessionCount }, owner),
    ).toBeUndefined();
  });

  it.each([
    { action: "ADMIN_ROLE_GRANTED", targetType: "DEVICE" },
    { action: "ADMIN_DEVICE_REVOKED", targetType: "ADMIN_PRINCIPAL" },
    { action: "ADMIN_ROLE_GRANTED", targetType: "USER" },
    { action: "EXTENSION_SESSION_REVOKED", targetType: "SESSION" },
    { action: "DEVICE_REVOKED", targetType: "DEVICE" },
    { action: "ADMIN_FUTURE_ACTION", targetType: "ADMIN_PRINCIPAL" },
    { action: "ADMIN_ROLE_GRANTED ", targetType: "ADMIN_PRINCIPAL" },
    { action: "ADMIN_ROLE_GRANTED", targetType: "ADMIN_PRINCIPAL " },
    { action: null, targetType: "ADMIN_PRINCIPAL" },
    { action: "ADMIN_ROLE_GRANTED", targetType: ["ADMIN_PRINCIPAL"] },
  ])("does not summarize an unrecognized action/target pair %j", (pair) => {
    expect(mapB14AuditSummary({ ...grant, ...pair }, owner)).toBeUndefined();
  });

  it("constructs device output without private metadata or inferred session counts", () => {
    const projection = Object.freeze({
      ...device,
      reasonCategory: "SUPPORT_REQUEST",
      accountId: "private-account-canary",
      reasonCode: "private-reason-code-canary",
      reason: "private-reason-canary",
      safeMetadata: {
        accountId: "private-nested-account-canary",
        token: "private-token-canary",
      },
      sessionIds: ["private-session-canary"],
      revokedSessionCount: 42,
    });
    const result = mapB14AuditSummary(projection, owner);
    expect(result).toEqual({
      what: { kind: "ADMIN_DEVICE_REVOKED" },
      reasonCategory: "SUPPORT_REQUEST",
    });
    expect(JSON.stringify(result)).not.toContain("private-");
    expect(result?.what).not.toHaveProperty("revokedSessionCount");
    expect(projection.revokedSessionCount).toBe(42);
  });

  it("never reads raw reason, metadata or secret fields as a fallback", () => {
    const privateRead = vi.fn(() => {
      throw new Error("private audit material must not be read");
    });
    const projection: B14AuditSummaryProjection = { ...grant };
    for (const field of ["reason", "safeMetadata", "token", "session"]) {
      Object.defineProperty(projection, field, {
        get: privateRead,
        enumerable: true,
      });
    }
    expect(mapB14AuditSummary(projection, owner)).toEqual({
      what: {
        kind: "ADMIN_ROLE_GRANTED",
        role: "ADMIN_SUPPORT",
        revision: { from: 2, to: 3 },
      },
    });
    expect(privateRead).not.toHaveBeenCalled();
  });
});

describe("B14 prepared subscription, entitlement and Beta audit summaries", () => {
  it.each([subscriptionSuspension, subscriptionRestoration])(
    "review regression: $action cannot reuse the origin transition revision",
    (input) => {
      expect(
        mapB14AuditSummary({ ...input, transitionRevision: 1 }, owner),
      ).toBeUndefined();
    },
  );

  it.each(additionalEvents)(
    "projects exactly the recorded facts of $input.action",
    ({ input, expected, readPermission }) => {
      const result = mapB14AuditSummary(input, [
        "admin.audit.read",
        readPermission,
      ]);
      expect(result).toEqual({ what: expected });
      expect(result).not.toHaveProperty("reasonCategory");
    },
  );

  it.each([
    { role: "ADMIN_OWNER", subscription: true, entitlement: true, beta: true },
    { role: "ADMIN_OPS", subscription: true, entitlement: false, beta: false },
    {
      role: "ADMIN_SUPPORT",
      subscription: true,
      entitlement: false,
      beta: true,
    },
    {
      role: "ADMIN_BILLING_READONLY",
      subscription: true,
      entitlement: false,
      beta: false,
    },
    {
      role: "ADMIN_BETA_OPERATOR",
      subscription: false,
      entitlement: false,
      beta: false,
    },
  ])(
    "keeps $role within the existing audit and object read authority",
    ({ role, ...allowed }) => {
      for (const { input, family } of additionalEvents)
        expect(
          mapB14AuditSummary(input, permissionsForRole(role)) !== undefined,
        ).toBe(allowed[family]);
    },
  );

  it.each(additionalEvents)(
    "requires both audit and matching object read for $input.action",
    ({ input, readPermission }) => {
      expect(mapB14AuditSummary(input, [readPermission])).toBeUndefined();
      expect(mapB14AuditSummary(input, ["admin.audit.read"])).toBeUndefined();
      const managementOnly: AdminPermission[] = [
        "admin.audit.read",
        "subscription.grant",
        "subscription.extend",
        "subscription.suspend",
        "subscription.restore",
        "entitlement.override",
        "beta.admission.manage",
      ];
      expect(mapB14AuditSummary(input, managementOnly)).toBeUndefined();
    },
  );

  it.each(additionalEvents)(
    "rejects the wrong target for $input.action",
    ({ input }) => {
      for (const targetType of [
        "ADMIN_PRINCIPAL",
        "DEVICE",
        "ACCOUNT",
        "SUBSCRIPTION",
        "BETA_ADMISSION_STATE",
        "BETA_IDENTITY_INVITATION",
      ]) {
        if (targetType === input.targetType) continue;
        expect(
          mapB14AuditSummary({ ...input, targetType }, owner),
        ).toBeUndefined();
      }
    },
  );

  it.each(additionalEvents)(
    "does not read or leak private canaries in $input.action",
    ({ input, expected }) => {
      const privateRead = vi.fn(() => {
        throw new Error("private material must not be read");
      });
      const projection = { ...input };
      for (const field of [
        "reason",
        "safeMetadata",
        "accountId",
        "requestIdHash",
        "payloadHash",
        "normalizedIdentityTarget",
        "email",
        "token",
        "value",
        "before",
        "after",
      ])
        Object.defineProperty(projection, field, {
          get: privateRead,
          enumerable: true,
        });
      const result = mapB14AuditSummary(Object.freeze(projection), owner);
      expect(result).toEqual({ what: expected });
      expect(privateRead).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain("private");

      const withCanaries = {
        ...input,
        reason: "PRIVATE_REASON_CANARY",
        safeMetadata: { token: "PRIVATE_METADATA_CANARY" },
        requestIdHash: "PRIVATE_REQUEST_HASH_CANARY",
        payloadHash: "PRIVATE_PAYLOAD_HASH_CANARY",
        normalizedIdentityTarget: "PRIVATE_EMAIL_CANARY@example.test",
        value: "PRIVATE_VALUE_CANARY",
        before: "PRIVATE_BEFORE_CANARY",
        after: "PRIVATE_AFTER_CANARY",
      };
      const publicResult = mapB14AuditSummary(withCanaries, owner);
      expect(publicResult).toEqual({ what: expected });
      expect(JSON.stringify(publicResult)).not.toContain("PRIVATE_");
    },
  );

  it("keeps structured why optional and never derives it for new event families", () => {
    for (const { input, expected } of additionalEvents) {
      expect(
        mapB14AuditSummary(
          { ...input, reasonCategory: "ACCESS_REVIEW" },
          owner,
        ),
      ).toEqual({ what: expected, reasonCategory: "ACCESS_REVIEW" });
      expect(
        mapB14AuditSummary(
          { ...input, reasonCategory: "PRIVATE_OR_UNKNOWN_CATEGORY" },
          owner,
        ),
      ).toBeUndefined();
    }
  });

  it("does not fabricate a grant period, override values, or revocation expiry", () => {
    const granted = mapB14AuditSummary(
      {
        ...subscriptionGrant,
        oldPeriodEnd: "PRIVATE_OLD_PERIOD_CANARY",
        newPeriodEnd: "PRIVATE_NEW_PERIOD_CANARY",
        expiresAt: "PRIVATE_EXPIRY_CANARY",
      },
      owner,
    );
    expect(granted).toEqual({ what: additionalEvents[0]!.expected });
    expect(granted?.what).not.toHaveProperty("periodEnd");
    for (const input of [overrideSet, overrideClear]) {
      const result = mapB14AuditSummary(input, owner);
      expect(result).toBeDefined();
      for (const field of ["value", "before", "after"])
        expect(result?.what).not.toHaveProperty(field);
    }
    expect(
      mapB14AuditSummary(
        { ...invitationRevoked, expiresAt: "PRIVATE_EXPIRY_CANARY" },
        owner,
      ),
    ).toEqual({ what: { kind: "BETA_IDENTITY_INVITATION_REVOKED" } });
  });

  it.each([
    { planRevisionId: undefined },
    { planRevisionId: null },
    { planRevisionId: "private-plan-canary" },
    { planRevisionId: 42 },
    { fromState: undefined },
    { fromState: "ACTIVE" },
    { toState: "TRIAL" },
    { stateRevision: 2 },
    { stateRevision: "1" },
    { transitionRevision: 2 },
  ])(
    "rejects inconsistent or missing subscription grant metadata %j",
    (patch) => {
      expect(
        mapB14AuditSummary({ ...subscriptionGrant, ...patch }, owner),
      ).toBeUndefined();
    },
  );

  it.each(["TRIAL", "ACTIVE", "GRACE", "PAST_DUE", "CANCELED"])(
    "shows the actual suspend and restore state %s",
    (state) => {
      expect(
        mapB14AuditSummary(
          { ...subscriptionSuspension, fromState: state },
          owner,
        )?.what,
      ).toMatchObject({ fromState: state, toState: "SUSPENDED" });
      expect(
        mapB14AuditSummary(
          { ...subscriptionRestoration, toState: state },
          owner,
        )?.what,
      ).toMatchObject({ fromState: "SUSPENDED", toState: state });
    },
  );

  it.each([undefined, null, "EXPIRED", "SUSPENDED", "active", "FUTURE", 1])(
    "rejects an invalid suspension origin or restore destination %j",
    (state) => {
      expect(
        mapB14AuditSummary(
          { ...subscriptionSuspension, fromState: state },
          owner,
        ),
      ).toBeUndefined();
      expect(
        mapB14AuditSummary(
          { ...subscriptionRestoration, toState: state },
          owner,
        ),
      ).toBeUndefined();
    },
  );

  it("requires SUSPENDED on the corresponding end of a status change", () => {
    expect(
      mapB14AuditSummary(
        { ...subscriptionSuspension, toState: "ACTIVE" },
        owner,
      ),
    ).toBeUndefined();
    expect(
      mapB14AuditSummary(
        { ...subscriptionRestoration, fromState: "ACTIVE" },
        owner,
      ),
    ).toBeUndefined();
  });

  it.each([
    undefined,
    null,
    true,
    "2",
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    2_147_483_648,
    Number.MAX_SAFE_INTEGER,
  ])(
    "rejects invalid positive int4 revisions %j in all new families",
    (value) => {
      for (const [input, fields] of [
        [subscriptionExtension, ["oldStateRevision", "newStateRevision"]],
        [subscriptionSuspension, ["transitionRevision"]],
        [overrideSet, ["overrideRevision"]],
        [betaOpen, ["oldRevision", "newRevision"]],
      ] as const) {
        for (const field of fields)
          expect(
            mapB14AuditSummary({ ...input, [field]: value }, owner),
          ).toBeUndefined();
      }
    },
  );

  it("accepts the final representable int4 changes and recorded revisions", () => {
    expect(
      mapB14AuditSummary(
        {
          ...subscriptionExtension,
          oldStateRevision: 2_147_483_646,
          newStateRevision: 2_147_483_647,
        },
        owner,
      )?.what,
    ).toMatchObject({ revision: { from: 2_147_483_646, to: 2_147_483_647 } });
    expect(
      mapB14AuditSummary(
        { ...overrideSet, overrideRevision: 2_147_483_647 },
        owner,
      )?.what,
    ).toMatchObject({ overrideRevision: 2_147_483_647 });
    expect(
      mapB14AuditSummary(
        {
          ...subscriptionSuspension,
          oldStateRevision: 2_147_483_646,
          newStateRevision: 2_147_483_647,
          transitionRevision: 2_147_483_647,
        },
        owner,
      )?.what,
    ).toMatchObject({ transitionRevision: 2_147_483_647 });
    expect(
      mapB14AuditSummary(
        { ...betaOpen, oldRevision: 2_147_483_646, newRevision: 2_147_483_647 },
        owner,
      )?.what,
    ).toMatchObject({
      old: { revision: 2_147_483_646 },
      new: { revision: 2_147_483_647 },
    });
  });

  it.each([3, 5])(
    "rejects a non-sequential subscription revision ending at %d",
    (newStateRevision) => {
      expect(
        mapB14AuditSummary(
          { ...subscriptionExtension, newStateRevision },
          owner,
        ),
      ).toBeUndefined();
    },
  );

  it.each([
    { label: "missing", value: undefined },
    { label: "blank", value: "" },
    { label: "natural language", value: "tomorrow" },
    { label: "impossible date", value: "2026-02-30T12:00:00.000Z" },
    { label: "date only", value: "2026-10-29" },
    { label: "missing timezone", value: "2026-10-29T12:00:00.000" },
    { label: "trailing newline", value: "2026-10-29T12:00:00.000Z\n" },
    { label: "UTC year overflow", value: "9999-12-31T23:59:59.999-01:00" },
    { label: "number", value: 0 },
    { label: "nonfinite number", value: Number.NaN },
    { label: "Date object", value: new Date("2026-10-29T12:00:00.000Z") },
    { label: "invalid Date", value: new Date(Number.NaN) },
    { label: "Date-prototype impostor", value: Object.create(Date.prototype) },
    {
      label: "coercible object",
      value: { toISOString: () => "2026-10-29T12:00:00.000Z" },
    },
  ])(
    "rejects malformed audit JSON timestamps without coercion: $label",
    ({ value }) => {
      for (const [input, fields] of [
        [subscriptionExtension, ["oldPeriodEnd", "newPeriodEnd"]],
        [overrideClear, ["effectiveFrom", "expiresAt"]],
        [invitationCreated, ["expiresAt"]],
      ] as const)
        for (const field of fields)
          expect(
            mapB14AuditSummary({ ...input, [field]: value }, owner),
          ).toBeUndefined();
    },
  );

  it("uses explicit null only for an indefinite entitlement window", () => {
    expect(
      mapB14AuditSummary({ ...overrideClear, expiresAt: null }, owner)?.what,
    ).toMatchObject({ expiresAt: null });
    for (const input of [
      { ...overrideSet, effectiveFrom: null },
      { ...subscriptionExtension, oldPeriodEnd: null },
      { ...subscriptionExtension, newPeriodEnd: null },
      { ...invitationCreated, expiresAt: null },
    ])
      expect(mapB14AuditSummary(input, owner)).toBeUndefined();
  });

  it("compares instants across offsets and keeps historical events readable", () => {
    expect(
      mapB14AuditSummary(
        {
          ...subscriptionExtension,
          oldPeriodEnd: "2020-01-01T10:00:00.000+02:00",
          newPeriodEnd: "2020-01-01T09:00:00.000Z",
        },
        owner,
      )?.what,
    ).toMatchObject({
      periodEnd: {
        from: "2020-01-01T08:00:00.000Z",
        to: "2020-01-01T09:00:00.000Z",
      },
    });
    expect(mapB14AuditSummary(invitationCreated, owner)).toEqual({
      what: {
        kind: "BETA_IDENTITY_INVITED",
        expiresAt: "2026-10-28T12:00:00.000Z",
      },
    });
  });

  it.each([
    ["2026-10-01T12:00:00.000Z", "2026-10-01T12:00:00.000Z"],
    ["2026-10-01T12:00:00.000Z", "2026-09-01T12:00:00.000Z"],
    ["2026-10-01T12:00:00.000+02:00", "2026-10-01T10:00:00.000Z"],
  ])(
    "rejects a non-increasing extension or finite override window %s -> %s",
    (from, to) => {
      expect(
        mapB14AuditSummary(
          { ...subscriptionExtension, oldPeriodEnd: from, newPeriodEnd: to },
          owner,
        ),
      ).toBeUndefined();
      expect(
        mapB14AuditSummary(
          { ...overrideSet, effectiveFrom: from, expiresAt: to },
          owner,
        ),
      ).toBeUndefined();
    },
  );

  it.each([
    undefined,
    null,
    "",
    "MixedCase",
    " key",
    "key ",
    "key\n",
    "key\r",
    "key\u2028",
    "key..next",
    "key__next",
    "key/next",
    "api_key=PRIVATE_CANARY",
    "key\u202enext",
    "x".repeat(129),
  ])("rejects malformed entitlement machine keys %j", (entitlementKey) => {
    expect(
      mapB14AuditSummary({ ...overrideSet, entitlementKey }, owner),
    ).toBeUndefined();
  });

  it("preserves a valid bounded entitlement key without claiming catalog lookup", () => {
    const entitlementKey = "x".repeat(128);
    expect(
      mapB14AuditSummary({ ...overrideSet, entitlementKey }, owner)?.what,
    ).toMatchObject({ entitlementKey });
  });

  it.each([undefined, null, "STRING", "integer", "UNKNOWN", 1])(
    "does not infer a missing or invalid entitlement value type %j",
    (valueType) => {
      expect(
        mapB14AuditSummary({ ...overrideSet, valueType }, owner),
      ).toBeUndefined();
      expect(
        mapB14AuditSummary({ ...overrideClear, valueType }, owner),
      ).toBeUndefined();
    },
  );

  it("requires the override operation to match its audit action", () => {
    expect(
      mapB14AuditSummary({ ...overrideSet, operation: "CLEAR" }, owner),
    ).toBeUndefined();
    expect(
      mapB14AuditSummary({ ...overrideClear, operation: "SET" }, owner),
    ).toBeUndefined();
    expect(
      mapB14AuditSummary({ ...overrideSet, operation: undefined }, owner),
    ).toBeUndefined();
  });

  it.each([
    { betaAction: "OPEN", oldMode: "CLOSED", newMode: "OPEN", newCapacity: 10 },
    {
      betaAction: "PAUSE",
      oldMode: "OPEN",
      newMode: "PAUSED",
      newCapacity: 10,
    },
    {
      betaAction: "CLOSE",
      oldMode: "PAUSED",
      newMode: "CLOSED",
      newCapacity: 10,
    },
    {
      betaAction: "ADD_CAPACITY",
      oldMode: "PAUSED",
      newMode: "PAUSED",
      newCapacity: 15,
    },
    {
      betaAction: "SET_CAPACITY",
      oldMode: "OPEN",
      newMode: "OPEN",
      newCapacity: 7,
    },
  ])("projects the actual old/new fields for Beta $betaAction", (patch) => {
    const result = mapB14AuditSummary({ ...betaOpen, ...patch }, owner);
    expect(result).toEqual({
      what: {
        kind: "BETA_ADMISSION_CHANGED",
        action: patch.betaAction,
        old: { mode: patch.oldMode, capacity: 10, admitted: 3, revision: 6 },
        new: {
          mode: patch.newMode,
          capacity: patch.newCapacity,
          admitted: 3,
          revision: 7,
        },
      },
    });
  });

  it("retains recorded idempotent mode or SET_CAPACITY changes with a new revision", () => {
    expect(
      mapB14AuditSummary({ ...betaOpen, oldMode: "OPEN" }, owner)?.what,
    ).toMatchObject({
      old: { mode: "OPEN", revision: 6 },
      new: { mode: "OPEN", revision: 7 },
    });
    expect(
      mapB14AuditSummary(
        { ...betaOpen, betaAction: "SET_CAPACITY", oldMode: "OPEN" },
        owner,
      )?.what,
    ).toMatchObject({
      action: "SET_CAPACITY",
      old: { capacity: 10 },
      new: { capacity: 10 },
    });
  });

  it.each([
    { betaAction: undefined },
    { betaAction: "open" },
    { betaAction: "FUTURE" },
    { betaAction: ["OPEN"] },
    { oldMode: "BROKEN" },
    { newMode: "open" },
    { newMode: "CLOSED" },
    { newCapacity: 11 },
    { newAdmitted: 4 },
    { oldAdmitted: 11 },
    { oldCapacity: 2 },
    { newCapacity: 2 },
    { newRevision: 6 },
    { newRevision: 8 },
    { betaAction: "PAUSE", newMode: "OPEN" },
    { betaAction: "CLOSE", newMode: "PAUSED" },
    { betaAction: "ADD_CAPACITY", oldMode: "OPEN", newCapacity: 10 },
    { betaAction: "ADD_CAPACITY", oldMode: "OPEN", newCapacity: 9 },
    { betaAction: "ADD_CAPACITY", newCapacity: 11 },
    { betaAction: "SET_CAPACITY", newCapacity: 12 },
  ])(
    "fails closed on a malformed or action-inconsistent Beta snapshot %j",
    (patch) => {
      expect(
        mapB14AuditSummary({ ...betaOpen, ...patch }, owner),
      ).toBeUndefined();
    },
  );

  it.each([
    undefined,
    null,
    "10",
    true,
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2_147_483_648,
  ])("rejects non-int4 Beta counters %j", (value) => {
    for (const field of [
      "oldCapacity",
      "newCapacity",
      "oldAdmitted",
      "newAdmitted",
    ])
      expect(
        mapB14AuditSummary({ ...betaOpen, [field]: value }, owner),
      ).toBeUndefined();
  });

  it.each([0, 2_147_483_647])(
    "accepts Beta counter boundaries %d without inventing remaining or pending",
    (count) => {
      const result = mapB14AuditSummary(
        {
          ...betaOpen,
          oldCapacity: count,
          newCapacity: count,
          oldAdmitted: count,
          newAdmitted: count,
        },
        owner,
      );
      expect(result?.what).toMatchObject({
        old: { capacity: count, admitted: count },
        new: { capacity: count, admitted: count },
      });
      for (const field of ["remaining", "pending", "requestIdHash"])
        expect(JSON.stringify(result)).not.toContain(field);
    },
  );

  it("does not use raw Beta snapshots as a fallback for missing projected fields", () => {
    const rawOnly = {
      action: "BETA_ADMISSION_CHANGED",
      targetType: "BETA_ADMISSION_STATE",
      betaAction: "OPEN",
      old: { mode: "CLOSED", capacity: 10, admitted: 3, revision: 6 },
      new: { mode: "OPEN", capacity: 10, admitted: 3, revision: 7 },
      safeMetadata: { requestIdHash: "PRIVATE_HASH_CANARY" },
    };
    expect(mapB14AuditSummary(rawOnly, owner)).toBeUndefined();
  });

  it.each([
    {
      action: "BETA_IDENTITY_INVITATION_CONSUMED",
      targetType: "BETA_IDENTITY_INVITATION",
    },
    { action: "ADMIN_OWNER_BOOTSTRAPPED", targetType: "ADMIN_PRINCIPAL" },
    { action: "ADMIN_SESSION_CREATED", targetType: "ADMIN_SESSION" },
    { action: "SUBSCRIPTION_FUTURE_ACTION", targetType: "SUBSCRIPTION" },
    { action: "ACCOUNT_ENTITLEMENT_OVERRIDE_UNKNOWN", targetType: "ACCOUNT" },
  ])(
    "leaves non-UI or unknown event families outside this mapper: $action",
    (input) => {
      expect(mapB14AuditSummary(input, owner)).toBeUndefined();
    },
  );
});

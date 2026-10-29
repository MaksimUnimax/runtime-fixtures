import { describe, expect, it, vi } from "vitest";
import { permissionsForRole, type AdminPermission } from "@product/admin-auth";
import type { B14AuditWhat } from "@product/admin-ops";
import type { DatabaseQuery } from "./index.js";
import {
  readB14AuditSummaries,
  type B14AuditReadInput,
} from "./b14-audit-read-projection.js";

const owner = permissionsForRole("ADMIN_OWNER");
const uuid = (number: number) =>
  "aaaaaaaa-0000-4000-8000-" + number.toString(16).padStart(12, "0");
const planId = uuid(500);
const from = "2026-09-01T12:00:00.000Z";
const to = "2026-10-01T12:00:00.000Z";
type Fixture = {
  id: string;
  action: string;
  targetType: string;
  fields: Record<string, unknown>;
  expected: B14AuditWhat;
};
function fixture(
  id: number,
  action: string,
  targetType: string,
  fields: Record<string, unknown>,
  expected: B14AuditWhat,
): Fixture {
  return { id: uuid(id), action, targetType, fields, expected };
}
const fixtures: Fixture[] = [
  fixture(
    1,
    "ADMIN_PRINCIPAL_CREATED",
    "ADMIN_PRINCIPAL",
    { initialRole: "ADMIN_SUPPORT" },
    { kind: "ADMIN_PRINCIPAL_CREATED", initialRole: "ADMIN_SUPPORT" },
  ),
  fixture(
    2,
    "ADMIN_ROLE_GRANTED",
    "ADMIN_PRINCIPAL",
    { role: "ADMIN_OPS", oldRevision: 7, newRevision: 8 },
    {
      kind: "ADMIN_ROLE_GRANTED",
      role: "ADMIN_OPS",
      revision: { from: 7, to: 8 },
    },
  ),
  fixture(
    3,
    "ADMIN_ROLE_REVOKED",
    "ADMIN_PRINCIPAL",
    { role: "ADMIN_BETA_OPERATOR", oldRevision: 8, newRevision: 9 },
    {
      kind: "ADMIN_ROLE_REVOKED",
      role: "ADMIN_BETA_OPERATOR",
      revision: { from: 8, to: 9 },
    },
  ),
  fixture(
    4,
    "ADMIN_PRINCIPAL_SUSPENDED",
    "ADMIN_PRINCIPAL",
    { oldRevision: 9, newRevision: 10, revokedSessionCount: 2 },
    {
      kind: "ADMIN_PRINCIPAL_SUSPENDED",
      revision: { from: 9, to: 10 },
      revokedSessionCount: 2,
    },
  ),
  fixture(
    5,
    "ADMIN_PRINCIPAL_RESTORED",
    "ADMIN_PRINCIPAL",
    { oldRevision: 10, newRevision: 11 },
    { kind: "ADMIN_PRINCIPAL_RESTORED", revision: { from: 10, to: 11 } },
  ),
  fixture(
    6,
    "ADMIN_DEVICE_REVOKED",
    "DEVICE",
    {},
    { kind: "ADMIN_DEVICE_REVOKED" },
  ),
  fixture(
    7,
    "SUBSCRIPTION_GRANTED",
    "SUBSCRIPTION",
    {
      planRevisionId: planId,
      fromState: null,
      toState: "ACTIVE",
      stateRevision: 1,
      transitionRevision: 1,
    },
    {
      kind: "SUBSCRIPTION_GRANTED",
      planRevisionId: planId,
      fromState: null,
      toState: "ACTIVE",
      stateRevision: 1,
      transitionRevision: 1,
    },
  ),
  fixture(
    8,
    "SUBSCRIPTION_EXTENDED",
    "SUBSCRIPTION",
    {
      oldStateRevision: 2,
      newStateRevision: 3,
      oldPeriodEnd: from,
      newPeriodEnd: to,
    },
    {
      kind: "SUBSCRIPTION_EXTENDED",
      revision: { from: 2, to: 3 },
      periodEnd: { from, to },
    },
  ),
  fixture(
    9,
    "SUBSCRIPTION_SUSPENDED",
    "SUBSCRIPTION",
    {
      fromState: "ACTIVE",
      toState: "SUSPENDED",
      oldStateRevision: 3,
      newStateRevision: 4,
      transitionRevision: 3,
    },
    {
      kind: "SUBSCRIPTION_SUSPENDED",
      fromState: "ACTIVE",
      toState: "SUSPENDED",
      revision: { from: 3, to: 4 },
      transitionRevision: 3,
    },
  ),
  fixture(
    10,
    "SUBSCRIPTION_RESTORED",
    "SUBSCRIPTION",
    {
      fromState: "SUSPENDED",
      toState: "ACTIVE",
      oldStateRevision: 4,
      newStateRevision: 5,
      transitionRevision: 4,
    },
    {
      kind: "SUBSCRIPTION_RESTORED",
      fromState: "SUSPENDED",
      toState: "ACTIVE",
      revision: { from: 4, to: 5 },
      transitionRevision: 4,
    },
  ),
  fixture(
    11,
    "ACCOUNT_ENTITLEMENT_OVERRIDE_SET",
    "ACCOUNT",
    {
      entitlementKey: "extension.max_devices",
      overrideRevision: 1,
      operation: "SET",
      valueType: "INTEGER",
      effectiveFrom: from,
      expiresAt: null,
    },
    {
      kind: "ACCOUNT_ENTITLEMENT_OVERRIDE_SET",
      entitlementKey: "extension.max_devices",
      overrideRevision: 1,
      operation: "SET",
      valueType: "INTEGER",
      effectiveFrom: from,
      expiresAt: null,
    },
  ),
  fixture(
    12,
    "ACCOUNT_ENTITLEMENT_OVERRIDE_CLEARED",
    "ACCOUNT",
    {
      entitlementKey: "extension.max_devices",
      overrideRevision: 2,
      operation: "CLEAR",
      valueType: "INTEGER",
      effectiveFrom: from,
      expiresAt: to,
    },
    {
      kind: "ACCOUNT_ENTITLEMENT_OVERRIDE_CLEARED",
      entitlementKey: "extension.max_devices",
      overrideRevision: 2,
      operation: "CLEAR",
      valueType: "INTEGER",
      effectiveFrom: from,
      expiresAt: to,
    },
  ),
  fixture(
    13,
    "BETA_ADMISSION_CHANGED",
    "BETA_ADMISSION_STATE",
    {
      betaAction: "OPEN",
      oldMode: "CLOSED",
      newMode: "OPEN",
      oldCapacity: 10,
      newCapacity: 10,
      oldAdmitted: 3,
      newAdmitted: 3,
      oldRevision: 1,
      newRevision: 2,
    },
    {
      kind: "BETA_ADMISSION_CHANGED",
      action: "OPEN",
      old: { mode: "CLOSED", capacity: 10, admitted: 3, revision: 1 },
      new: { mode: "OPEN", capacity: 10, admitted: 3, revision: 2 },
    },
  ),
  fixture(
    14,
    "BETA_IDENTITY_INVITED",
    "BETA_IDENTITY_INVITATION",
    { expiresAt: to },
    { kind: "BETA_IDENTITY_INVITED", expiresAt: to },
  ),
  fixture(
    15,
    "BETA_IDENTITY_INVITATION_REVOKED",
    "BETA_IDENTITY_INVITATION",
    {},
    { kind: "BETA_IDENTITY_INVITATION_REVOKED" },
  ),
];

function row(source: Fixture, patch: Record<string, unknown> = {}) {
  return {
    id: source.id,
    action: source.action,
    target_type: source.targetType,
    projected_fields: { ...source.fields },
    ...patch,
  };
}
function fakeQuery(rows: Record<string, unknown>[] = []) {
  const execute = vi.fn(async (_sql: string, _values?: unknown[]) => ({
    rows,
  }));
  const database: Pick<DatabaseQuery, "query"> = {
    query: execute as DatabaseQuery["query"],
  };
  return { database, execute };
}
function captured(mock: ReturnType<typeof fakeQuery>) {
  expect(mock.execute).toHaveBeenCalledTimes(1);
  const [sql, values] = mock.execute.mock.calls[0]!;
  return { sql, values: values! };
}

describe("B14 prepared audit SQL projection with a fake query port", () => {
  it.each(fixtures)(
    "returns the current mapper's exact summary for $action",
    async (event) => {
      const mock = fakeQuery([row(event)]);
      const result = await readB14AuditSummaries(mock.database, {
        eventIds: [event.id],
        permissions: owner,
        filter: { action: event.action, targetType: event.targetType },
      });
      expect(result).toEqual({
        kind: "OK",
        items: [{ eventId: event.id, summary: { what: event.expected } }],
      });
      const { sql, values } = captured(mock);
      expect(sql).toContain("a.id=ANY($1::uuid[])");
      expect(sql).toContain("a.action=$2::text AND a.target_type=$3::text");
      expect(values[0]).toEqual([event.id]);
      expect(values.slice(1, 3)).toEqual([event.action, event.targetType]);
      expect(values.at(-1)).toBe(1);
      expect(sql).not.toContain(event.id);
    },
  );

  it("reads all fifteen existing event types in one bounded query", async () => {
    const mock = fakeQuery(fixtures.map((event) => row(event)));
    const result = await readB14AuditSummaries(mock.database, {
      eventIds: fixtures.map((event) => event.id),
      permissions: owner,
    });
    expect(result).toEqual({
      kind: "OK",
      items: fixtures.map((event) => ({
        eventId: event.id,
        summary: { what: event.expected },
      })),
    });
    const { sql, values } = captured(mock);
    expect(values[0]).toHaveLength(15);
    expect(values.at(-1)).toBe(15);
    expect(sql).toMatch(/LIMIT \$\d+::integer$/u);
  });

  it("uses first-seen normalized IDs and retains the original envelope order", async () => {
    const [first, second, third] = fixtures;
    const mock = fakeQuery([row(third!), row(first!), row(second!)]);
    const result = await readB14AuditSummaries(mock.database, {
      eventIds: [
        second!.id,
        first!.id.toUpperCase(),
        second!.id.toUpperCase(),
        third!.id,
      ],
      permissions: owner,
    });
    expect(result.kind).toBe("OK");
    if (result.kind === "OK")
      expect(result.items.map((item) => item.eventId)).toEqual([
        second!.id,
        first!.id,
        third!.id,
      ]);
    const { values } = captured(mock);
    expect(values[0]).toEqual([second!.id, first!.id, third!.id]);
    expect(values.at(-1)).toBe(3);
  });

  it("does not query for an empty envelope page", async () => {
    const mock = fakeQuery();
    expect(
      await readB14AuditSummaries(mock.database, {
        eventIds: [],
        permissions: owner,
      }),
    ).toEqual({ kind: "OK", items: [] });
    expect(mock.execute).not.toHaveBeenCalled();
  });

  it("bounds the raw input before de-duplication and permits at most 100 IDs", async () => {
    const accepted = fakeQuery();
    const ids = Array.from({ length: 100 }, (_, index) => uuid(index + 1000));
    expect(
      await readB14AuditSummaries(accepted.database, {
        eventIds: ids,
        permissions: owner,
      }),
    ).toEqual({ kind: "OK", items: [] });
    const { values } = captured(accepted);
    expect(values[0]).toHaveLength(100);
    expect(values.at(-1)).toBe(100);

    const rejected = fakeQuery();
    expect(
      await readB14AuditSummaries(rejected.database, {
        eventIds: Array.from({ length: 101 }, () => fixtures[0]!.id),
        permissions: owner,
      }),
    ).toEqual({ kind: "INVALID" });
    expect(rejected.execute).not.toHaveBeenCalled();
  });

  it.each([
    { label: "null input", input: null },
    { label: "array input", input: [] },
    { label: "missing IDs", input: { permissions: owner } },
    {
      label: "non-array IDs",
      input: { eventIds: uuid(1), permissions: owner },
    },
    {
      label: "malformed UUID",
      input: { eventIds: ["not-a-uuid"], permissions: owner },
    },
    { label: "number UUID", input: { eventIds: [1], permissions: owner } },
    {
      label: "SQL-injection UUID",
      input: { eventIds: ["x' OR TRUE --"], permissions: owner },
    },
    {
      label: "malformed permissions",
      input: { eventIds: [uuid(1)], permissions: "ADMIN_OWNER" },
    },
    {
      label: "unknown permission",
      input: {
        eventIds: [uuid(1)],
        permissions: ["admin.audit.read", "admin.unknown.read"],
      },
    },
    {
      label: "unrecognized top-level account scope",
      input: { eventIds: [uuid(1)], permissions: owner, accountId: uuid(2) },
    },
    {
      label: "unrecognized top-level limit",
      input: { eventIds: [uuid(1)], permissions: owner, limit: 1000 },
    },
  ])("rejects $label before querying", async ({ input }) => {
    const mock = fakeQuery();
    expect(
      await readB14AuditSummaries(mock.database, input as B14AuditReadInput),
    ).toEqual({ kind: "INVALID" });
    expect(mock.execute).not.toHaveBeenCalled();
  });

  it.each([
    { label: "null", filter: null },
    { label: "array", filter: [] },
    { label: "unknown account field", filter: { accountId: uuid(10) } },
    { label: "pagination cursor", filter: { cursor: uuid(10) } },
    { label: "pagination limit", filter: { limit: 100 } },
    { label: "wrong target UUID", filter: { targetId: "ACCOUNT_A" } },
    { label: "wrong actor UUID", filter: { actorId: 1 } },
    { label: "null target", filter: { targetId: null } },
    { label: "blank action", filter: { action: "" } },
    {
      label: "oversized correlation",
      filter: { correlationId: "x".repeat(129) },
    },
    { label: "SQL injection", filter: { actorType: "ADMIN' OR TRUE --" } },
    { label: "trailing newline", filter: { action: "ADMIN_ROLE_GRANTED\n" } },
    { label: "bidi target", filter: { targetType: "ADMIN_PRINCIPAL\u202e" } },
  ])(
    "rejects the $label filter without broadening the read",
    async ({ filter }) => {
      const mock = fakeQuery();
      const input = { eventIds: [uuid(1)], permissions: owner, filter };
      expect(
        await readB14AuditSummaries(mock.database, input as B14AuditReadInput),
      ).toEqual({ kind: "INVALID" });
      expect(mock.execute).not.toHaveBeenCalled();
    },
  );

  it("repeats all six envelope filters as parameters, including ACCOUNT target scope", async () => {
    const event = fixtures[10]!;
    const mock = fakeQuery([row(event)]);
    const filter = {
      action: event.action,
      targetType: "ACCOUNT",
      targetId: uuid(401),
      actorType: "SYNTHETIC_ACTOR",
      actorId: uuid(402),
      correlationId: "synthetic-correlation-17",
    };
    expect(
      (
        await readB14AuditSummaries(mock.database, {
          eventIds: [event.id],
          permissions: owner,
          filter,
        })
      ).kind,
    ).toBe("OK");
    const { sql, values } = captured(mock);
    expect(values.slice(-7)).toEqual([
      filter.action,
      filter.targetType,
      filter.targetId,
      filter.actorType,
      filter.actorId,
      filter.correlationId,
      1,
    ]);
    for (const field of [
      "action",
      "target_type",
      "target_id",
      "actor_type",
      "actor_id",
      "correlation_id",
    ])
      expect(sql).toMatch(
        new RegExp("a\\." + field + "=\\$\\d+::(?:text|uuid)", "u"),
      );
    for (const value of [
      filter.targetId,
      filter.actorType,
      filter.actorId,
      filter.correlationId,
    ])
      expect(sql).not.toContain(value);
    const usedParameters = new Set(
      [...sql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1])),
    );
    expect([...usedParameters].sort((a, b) => a - b)).toEqual(
      Array.from({ length: values.length }, (_, index) => index + 1),
    );
  });

  it.each([
    { action: "UNSUPPORTED_EVENT" },
    { action: "ADMIN_ROLE_GRANTED", targetType: "DEVICE" },
    { targetType: "UNSUPPORTED_TARGET" },
  ])(
    "does not query an unsupported action/target filter %j",
    async (filter) => {
      const mock = fakeQuery();
      expect(
        await readB14AuditSummaries(mock.database, {
          eventIds: [uuid(1)],
          permissions: owner,
          filter,
        }),
      ).toEqual({ kind: "OK", items: [] });
      expect(mock.execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    { label: "no permissions", permissions: [] },
    { label: "audit only", permissions: ["admin.audit.read"] },
    { label: "object only", permissions: ["admin.principal.read"] },
    {
      label: "management only",
      permissions: [
        "admin.audit.read",
        "admin.principal.manage",
        "device.revoke",
      ],
    },
    {
      label: "Beta operator",
      permissions: permissionsForRole("ADMIN_BETA_OPERATOR"),
    },
  ] satisfies { label: string; permissions: readonly AdminPermission[] }[])(
    "does not execute SQL for $label",
    async ({ permissions }) => {
      const mock = fakeQuery(fixtures.map((event) => row(event)));
      expect(
        await readB14AuditSummaries(mock.database, {
          eventIds: fixtures.map((event) => event.id),
          permissions,
        }),
      ).toEqual({ kind: "FORBIDDEN" });
      expect(mock.execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      role: "ADMIN_OWNER",
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    },
    { role: "ADMIN_OPS", numbers: [6, 7, 8, 9, 10] },
    { role: "ADMIN_SUPPORT", numbers: [6, 7, 8, 9, 10, 13, 14, 15] },
    { role: "ADMIN_BILLING_READONLY", numbers: [7, 8, 9, 10] },
  ])(
    "restricts both SQL families and returned details for $role",
    async ({ role, numbers }) => {
      // The fake deliberately returns every row even if real SQL would filter
      // it out. The adapter must also reject unauthorized or mismatched rows.
      const mock = fakeQuery(fixtures.map((event) => row(event)));
      const result = await readB14AuditSummaries(mock.database, {
        eventIds: fixtures.map((event) => event.id),
        permissions: permissionsForRole(role),
      });
      expect(result.kind).toBe("OK");
      if (result.kind === "OK")
        expect(result.items.map((item) => item.eventId)).toEqual(
          numbers.map(uuid),
        );
      const { sql, values } = captured(mock);
      for (const event of fixtures) {
        const permitted = numbers.includes(
          Number.parseInt(event.id.slice(-12), 16),
        );
        expect(values.includes(event.action)).toBe(permitted);
        expect(sql.includes("'" + event.action + "'")).toBe(permitted);
      }
    },
  );

  it("does not read an unauthorized family even when some other object read is allowed", async () => {
    const mock = fakeQuery();
    expect(
      await readB14AuditSummaries(mock.database, {
        eventIds: [fixtures[0]!.id],
        permissions: permissionsForRole("ADMIN_SUPPORT"),
        filter: {
          action: "ADMIN_PRINCIPAL_CREATED",
          targetType: "ADMIN_PRINCIPAL",
        },
      }),
    ).toEqual({ kind: "OK", items: [] });
    expect(mock.execute).not.toHaveBeenCalled();
  });

  it("queries only constructed scalar JSON, never raw audit material", async () => {
    const mock = fakeQuery();
    await readB14AuditSummaries(mock.database, {
      eventIds: fixtures.map((event) => event.id),
      permissions: owner,
    });
    const { sql } = captured(mock);
    expect(sql).toMatch(/^SELECT a\.id,a\.action,a\.target_type,/u);
    expect(sql).toContain("jsonb_object_agg");
    expect(sql).toContain("FILTER (WHERE p.v IS NOT NULL)");
    expect(sql).not.toContain("jsonb_strip_nulls");
    expect(sql).not.toContain("->>");
    expect(sql).not.toContain("#>>");
    expect(sql).not.toMatch(/a\.safe_metadata\s*(?:,|AS\b|FROM\b)/iu);
    expect(sql).not.toMatch(/\ba\.reason\b/iu);
    for (const field of [
      "reason",
      "requestIdHash",
      "payloadHash",
      "normalizedIdentityTarget",
      "email",
      "credentials",
      "token",
      "accountId",
      "boundPriceRevisionId",
      "value",
      "before",
      "after",
      "remaining",
      "pending",
    ])
      expect(sql).not.toContain("'" + field + "'");
    expect(sql).toContain("a.safe_metadata -> 'reasonCategory'");
  });

  it("extracts individual Beta members and never old/new objects", async () => {
    const event = fixtures[12]!;
    const mock = fakeQuery([row(event)]);
    await readB14AuditSummaries(mock.database, {
      eventIds: [event.id],
      permissions: owner,
      filter: { action: event.action, targetType: event.targetType },
    });
    const { sql } = captured(mock);
    expect(sql).toContain("('betaAction',a.safe_metadata -> 'action')");
    for (const side of ["old", "new"])
      for (const field of ["mode", "capacity", "admitted", "revision"])
        expect(sql).toContain(
          "a.safe_metadata #> ARRAY['" + side + "','" + field + "']::text[]",
        );
    expect(sql).not.toContain("a.safe_metadata -> 'old'");
    expect(sql).not.toContain("a.safe_metadata -> 'new'");
  });

  it("withholds nested values and unsafe numeric forms before the JSON driver", async () => {
    const mock = fakeQuery();
    await readB14AuditSummaries(mock.database, {
      eventIds: [fixtures[1]!.id],
      permissions: owner,
      filter: { action: "ADMIN_ROLE_GRANTED" },
    });
    const { sql } = captured(mock);
    expect(sql).toContain(
      "jsonb_typeof(p.v) IN ('object','array') THEN 'false'::jsonb",
    );
    expect(sql).toContain("jsonb_typeof(p.v)='number'");
    expect(sql).toContain("p.v::text !~ '^-?[0-9]+$'");
    expect(sql).toContain("p.v > '9007199254740991'::jsonb");
    expect(sql).toContain("p.v < '-9007199254740991'::jsonb");
    expect(sql).not.toMatch(/::(?:numeric|float|double|date|timestamptz)\b/iu);
  });

  it("preserves missing versus explicit JSON null for the legacy initial role grant", async () => {
    const event = fixtures[1]!;
    const legacy = fakeQuery([
      row(event, {
        projected_fields: { role: "ADMIN_OPS" },
      }),
    ]);
    expect(
      await readB14AuditSummaries(legacy.database, {
        eventIds: [event.id],
        permissions: owner,
      }),
    ).toEqual({
      kind: "OK",
      items: [
        {
          eventId: event.id,
          summary: { what: { kind: "ADMIN_ROLE_GRANTED", role: "ADMIN_OPS" } },
        },
      ],
    });
    const explicitNull = fakeQuery([
      row(event, {
        projected_fields: {
          role: "ADMIN_OPS",
          oldRevision: null,
          newRevision: null,
        },
      }),
    ]);
    expect(
      await readB14AuditSummaries(explicitNull.database, {
        eventIds: [event.id],
        permissions: owner,
      }),
    ).toEqual({ kind: "OK", items: [] });
  });

  it("keeps explicit grant fromState null and indefinite expiry distinct from missing", async () => {
    for (const [event, key] of [
      [fixtures[6]!, "fromState"],
      [fixtures[10]!, "expiresAt"],
    ] as const) {
      const missing = { ...event.fields };
      delete missing[key];
      const mock = fakeQuery([row(event, { projected_fields: missing })]);
      expect(
        await readB14AuditSummaries(mock.database, {
          eventIds: [event.id],
          permissions: owner,
        }),
      ).toEqual({ kind: "OK", items: [] });
      const explicitNull = fakeQuery([row(event)]);
      expect(
        await readB14AuditSummaries(explicitNull.database, {
          eventIds: [event.id],
          permissions: owner,
        }),
      ).toEqual({
        kind: "OK",
        items: [{ eventId: event.id, summary: { what: event.expected } }],
      });
    }
  });

  it.each([null, false, "PRIVATE_CATEGORY_CANARY", 1, {}])(
    "does not discard an explicit invalid category %j to rescue a summary",
    async (reasonCategory) => {
      const event = fixtures[5]!;
      const mock = fakeQuery([
        row(event, { projected_fields: { reasonCategory } }),
      ]);
      expect(
        await readB14AuditSummaries(mock.database, {
          eventIds: [event.id],
          permissions: owner,
        }),
      ).toEqual({ kind: "OK", items: [] });
    },
  );

  it("preserves only an explicitly recorded known reason category", async () => {
    const event = fixtures[5]!;
    const mock = fakeQuery([
      row(event, {
        projected_fields: { reasonCategory: "SUPPORT_REQUEST" },
      }),
    ]);
    expect(
      await readB14AuditSummaries(mock.database, {
        eventIds: [event.id],
        permissions: owner,
      }),
    ).toEqual({
      kind: "OK",
      items: [
        {
          eventId: event.id,
          summary: {
            what: { kind: "ADMIN_DEVICE_REVOKED" },
            reasonCategory: "SUPPORT_REQUEST",
          },
        },
      ],
    });
  });

  it.each([
    { role: "ADMIN_OPS", oldRevision: "7", newRevision: 8 },
    { role: "ADMIN_OPS", oldRevision: 7, newRevision: "8" },
    { role: "ADMIN_OPS", oldRevision: false, newRevision: 8 },
    { role: false, oldRevision: 7, newRevision: 8 },
    { role: ["ADMIN_OPS"], oldRevision: 7, newRevision: 8 },
    {
      role: { token: "PRIVATE_NESTED_CANARY" },
      oldRevision: 7,
      newRevision: 8,
    },
    { role: "ADMIN_FUTURE", oldRevision: 7, newRevision: 8 },
    { role: "ADMIN_OPS", oldRevision: 7, newRevision: 2_147_483_648 },
  ])(
    "does not coerce malformed selected scalar JSON %j",
    async (projected_fields) => {
      const event = fixtures[1]!;
      const mock = fakeQuery([row(event, { projected_fields })]);
      const result = await readB14AuditSummaries(mock.database, {
        eventIds: [event.id],
        permissions: owner,
      });
      expect(result).toEqual({ kind: "OK", items: [] });
      expect(JSON.stringify(result)).not.toContain("PRIVATE_");
    },
  );

  it.each([null, [], 1, "PRIVATE_SCALAR_CANARY", new Date(0)])(
    "rejects a malformed projected-fields container %j",
    async (projected_fields) => {
      const event = fixtures[5]!;
      const mock = fakeQuery([row(event, { projected_fields })]);
      expect(
        await readB14AuditSummaries(mock.database, {
          eventIds: [event.id],
          permissions: owner,
        }),
      ).toEqual({ kind: "OK", items: [] });
    },
  );

  it("ignores missing or out-of-page rows and rejects unsupported action/target pairs", async () => {
    const event = fixtures[0]!;
    for (const rows of [
      [],
      [row(event, { id: uuid(9999) })],
      [row(event, { action: "ADMIN_FUTURE_ACTION" })],
      [row(event, { target_type: "DEVICE" })],
      [row(event, { id: null })],
    ]) {
      const mock = fakeQuery(rows);
      expect(
        await readB14AuditSummaries(mock.database, {
          eventIds: [event.id],
          permissions: owner,
        }),
      ).toEqual({ kind: "OK", items: [] });
    }
  });

  it("never reflects or reads extra raw row fields", async () => {
    const event = fixtures[0]!;
    const data = row(event);
    const privateRead = vi.fn(() => {
      throw new Error("raw field must not be read");
    });
    for (const key of [
      "reason",
      "safe_metadata",
      "normalized_identity_target",
      "request_id_hash",
    ])
      Object.defineProperty(data, key, { get: privateRead, enumerable: true });
    const mock = fakeQuery([data]);
    expect(
      await readB14AuditSummaries(mock.database, {
        eventIds: [event.id],
        permissions: owner,
      }),
    ).toEqual({
      kind: "OK",
      items: [{ eventId: event.id, summary: { what: event.expected } }],
    });
    expect(privateRead).not.toHaveBeenCalled();
  });

  it("fails closed on unexpected projected keys without reading their private values", async () => {
    const event = fixtures[0]!;
    const fields = { ...event.fields };
    const privateRead = vi.fn(() => {
      throw new Error("private projection key");
    });
    Object.defineProperty(fields, "reason", {
      get: privateRead,
      enumerable: true,
    });
    const mock = fakeQuery([row(event, { projected_fields: fields })]);
    expect(
      await readB14AuditSummaries(mock.database, {
        eventIds: [event.id],
        permissions: owner,
      }),
    ).toEqual({ kind: "OK", items: [] });
    expect(privateRead).not.toHaveBeenCalled();
  });

  it("propagates a query failure instead of reporting a successful empty read", async () => {
    const mock = fakeQuery();
    const failure = new Error("SYNTHETIC_DATABASE_UNAVAILABLE");
    mock.execute.mockRejectedValueOnce(failure);
    await expect(
      readB14AuditSummaries(mock.database, {
        eventIds: [fixtures[0]!.id],
        permissions: owner,
      }),
    ).rejects.toBe(failure);
    expect(mock.execute).toHaveBeenCalledTimes(1);
  });
});

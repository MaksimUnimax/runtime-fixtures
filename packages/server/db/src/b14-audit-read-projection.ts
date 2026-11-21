import { isAdminPermission, type AdminPermission } from "@product/admin-auth";
import {
  AdminAuditEventsQueryV1Schema,
  mapB14AuditSummary,
  type AdminOpsRepository,
  type B14AuditSummary,
  type B14AuditSummaryProjection,
  type B14AuditWhat,
} from "@product/admin-ops";
import type { DatabaseQuery } from "./index.js";

/**
 * Prepared internal read, not wired to a repository, HTTP route, or DB export.
 * The caller supplies IDs from its already selected audit-envelope page and
 * the same filters, with permissions from the authenticated admin subject.
 * Existing permissions are global object reads; this adds no account-access
 * model. An ACCOUNT target filter is exactly the existing envelope filter.
 */
export type B14AuditReadFilter = Pick<
  Parameters<AdminOpsRepository["listAuditEvents"]>[0],
  | "action"
  | "targetType"
  | "targetId"
  | "actorType"
  | "actorId"
  | "correlationId"
>;

export type B14AuditReadInput = Readonly<{
  eventIds: readonly string[];
  permissions: readonly AdminPermission[];
  filter?: B14AuditReadFilter;
}>;

export type B14AuditReadResult =
  | { kind: "OK"; items: { eventId: string; summary: B14AuditSummary }[] }
  | { kind: "INVALID" | "FORBIDDEN" };

type ProjectionKey = Exclude<
  keyof B14AuditSummaryProjection,
  "action" | "targetType"
>;
type MetadataField = Readonly<{
  key: ProjectionKey;
  path: readonly string[];
}>;
type ObjectReadPermission =
  | "admin.principal.read"
  | "device.read"
  | "subscription.read"
  | "entitlement.read"
  | "beta.admission.read";
type ActionSpec = Readonly<{
  action: B14AuditWhat["kind"];
  targetType:
    | "ADMIN_PRINCIPAL"
    | "DEVICE"
    | "SUBSCRIPTION"
    | "ACCOUNT"
    | "BETA_ADMISSION_STATE"
    | "BETA_IDENTITY_INVITATION";
  permission: ObjectReadPermission;
  fields: readonly MetadataField[];
}>;

const scalarFields = (...keys: ProjectionKey[]): MetadataField[] =>
  keys.map((key) => ({ key, path: [key] }));
const roleChangeFields = scalarFields("role", "oldRevision", "newRevision");
const subscriptionStatusFields = scalarFields(
  "fromState",
  "toState",
  "oldStateRevision",
  "newStateRevision",
  "transitionRevision",
);
const overrideFields = scalarFields(
  "entitlementKey",
  "overrideRevision",
  "operation",
  "valueType",
  "effectiveFrom",
  "expiresAt",
);
const actionSpecs: readonly ActionSpec[] = [
  {
    action: "ADMIN_PRINCIPAL_CREATED",
    targetType: "ADMIN_PRINCIPAL",
    permission: "admin.principal.read",
    fields: scalarFields("initialRole"),
  },
  {
    action: "ADMIN_ROLE_GRANTED",
    targetType: "ADMIN_PRINCIPAL",
    permission: "admin.principal.read",
    fields: roleChangeFields,
  },
  {
    action: "ADMIN_ROLE_REVOKED",
    targetType: "ADMIN_PRINCIPAL",
    permission: "admin.principal.read",
    fields: roleChangeFields,
  },
  {
    action: "ADMIN_PRINCIPAL_SUSPENDED",
    targetType: "ADMIN_PRINCIPAL",
    permission: "admin.principal.read",
    fields: scalarFields("oldRevision", "newRevision", "revokedSessionCount"),
  },
  {
    action: "ADMIN_PRINCIPAL_RESTORED",
    targetType: "ADMIN_PRINCIPAL",
    permission: "admin.principal.read",
    fields: scalarFields("oldRevision", "newRevision"),
  },
  {
    action: "ADMIN_DEVICE_REVOKED",
    targetType: "DEVICE",
    permission: "device.read",
    fields: [],
  },
  {
    action: "SUBSCRIPTION_GRANTED",
    targetType: "SUBSCRIPTION",
    permission: "subscription.read",
    fields: scalarFields(
      "planRevisionId",
      "fromState",
      "toState",
      "stateRevision",
      "transitionRevision",
    ),
  },
  {
    action: "SUBSCRIPTION_EXTENDED",
    targetType: "SUBSCRIPTION",
    permission: "subscription.read",
    fields: scalarFields(
      "oldStateRevision",
      "newStateRevision",
      "oldPeriodEnd",
      "newPeriodEnd",
    ),
  },
  {
    action: "SUBSCRIPTION_SUSPENDED",
    targetType: "SUBSCRIPTION",
    permission: "subscription.read",
    fields: subscriptionStatusFields,
  },
  {
    action: "SUBSCRIPTION_RESTORED",
    targetType: "SUBSCRIPTION",
    permission: "subscription.read",
    fields: subscriptionStatusFields,
  },
  {
    action: "ACCOUNT_ENTITLEMENT_OVERRIDE_SET",
    targetType: "ACCOUNT",
    permission: "entitlement.read",
    fields: overrideFields,
  },
  {
    action: "ACCOUNT_ENTITLEMENT_OVERRIDE_CLEARED",
    targetType: "ACCOUNT",
    permission: "entitlement.read",
    fields: overrideFields,
  },
  {
    action: "BETA_ADMISSION_CHANGED",
    targetType: "BETA_ADMISSION_STATE",
    permission: "beta.admission.read",
    fields: [
      { key: "betaAction", path: ["action"] },
      { key: "oldMode", path: ["old", "mode"] },
      { key: "newMode", path: ["new", "mode"] },
      { key: "oldCapacity", path: ["old", "capacity"] },
      { key: "newCapacity", path: ["new", "capacity"] },
      { key: "oldAdmitted", path: ["old", "admitted"] },
      { key: "newAdmitted", path: ["new", "admitted"] },
      { key: "oldRevision", path: ["old", "revision"] },
      { key: "newRevision", path: ["new", "revision"] },
    ],
  },
  {
    action: "BETA_IDENTITY_INVITED",
    targetType: "BETA_IDENTITY_INVITATION",
    permission: "beta.admission.read",
    fields: scalarFields("expiresAt"),
  },
  {
    action: "BETA_IDENTITY_INVITATION_REVOKED",
    targetType: "BETA_IDENTITY_INVITATION",
    permission: "beta.admission.read",
    fields: [],
  },
];
const categoryField: MetadataField = {
  key: "reasonCategory",
  path: ["reasonCategory"],
};
const maxEventIds = 100;
const uuidSchema = AdminAuditEventsQueryV1Schema.shape.targetId.unwrap();
const filterSchema = AdminAuditEventsQueryV1Schema.pick({
  action: true,
  targetType: true,
  targetId: true,
  actorType: true,
  actorId: true,
  correlationId: true,
}).strict();
const filterColumns = {
  action: "action",
  targetType: "target_type",
  targetId: "target_id",
  actorType: "actor_type",
  actorId: "actor_id",
  correlationId: "correlation_id",
} as const;
const inputKeys = new Set(["eventIds", "permissions", "filter"]);

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Only closed, source-owned action names/paths use literals. Caller-supplied
// event IDs and every filter value are always query parameters.
function sqlLiteral(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'";
}

function metadataValue(path: readonly string[]): string {
  return path.length === 1
    ? "a.safe_metadata -> " + sqlLiteral(path[0]!)
    : "a.safe_metadata #> ARRAY[" +
        path.map(sqlLiteral).join(",") +
        "]::text[]";
}

function projectionSql(spec: ActionSpec): string {
  const entries = [...spec.fields, categoryField].map(
    ({ key, path }) => "(" + sqlLiteral(key) + "," + metadataValue(path) + ")",
  );
  // ->/#> preserve JSON types. Missing is SQL NULL and is omitted by FILTER;
  // explicit JSON null remains a property. Never use ->> or strip_nulls here.
  //
  // Malformed nested payloads must stay inside PostgreSQL. JSON false is
  // invalid for every current projected scalar and makes the mapper withhold
  // this summary. Do the same for numeric forms that could lose precision in
  // node-postgres JSON.parse (for example 1.0000000000000001 becoming 1).
  // Actual writers persist JSON.stringify integer values. No numeric/date
  // casts are applied to metadata, so invalid text cannot raise a cast error.
  return [
    "(SELECT COALESCE(",
    "jsonb_object_agg(p.k, CASE",
    "WHEN jsonb_typeof(p.v) IN ('object','array') THEN 'false'::jsonb",
    "WHEN jsonb_typeof(p.v)='number' AND (",
    "p.v::text !~ '^-?[0-9]+$'",
    "OR p.v > '9007199254740991'::jsonb",
    "OR p.v < '-9007199254740991'::jsonb",
    ") THEN 'false'::jsonb ELSE p.v END)",
    "FILTER (WHERE p.v IS NOT NULL), '{}'::jsonb)",
    "FROM (VALUES " + entries.join(",") + ") AS p(k,v))",
  ].join("\n");
}

type AuditProjectionRow = Record<string, unknown> & {
  id: unknown;
  action: unknown;
  target_type: unknown;
  projected_fields: unknown;
};

/**
 * Enrich at most one bounded envelope page; this never discovers more events.
 * A missing/retained event, unsupported action, unauthorized object family, or
 * invalid metadata simply has no item. Returned items follow first-seen ID
 * order; envelope pagination and ordering stay with the existing repository.
 *
 * FORBIDDEN is local to detailed summaries. A future caller must not turn an
 * otherwise authorized envelope-only audit read into an HTTP 403 because the
 * caller has no object-read permission for this optional detail.
 *
 * Query failures propagate; an outage must not masquerade as an empty result.
 */
export async function readB14AuditSummaries(
  query: Pick<DatabaseQuery, "query">,
  input: B14AuditReadInput,
): Promise<B14AuditReadResult> {
  if (
    !plainRecord(input) ||
    Object.keys(input).some((key) => !inputKeys.has(key)) ||
    !Array.isArray(input.eventIds) ||
    input.eventIds.length > maxEventIds ||
    !Array.isArray(input.permissions) ||
    !input.permissions.every(
      (value) => typeof value === "string" && isAdminPermission(value),
    )
  )
    return { kind: "INVALID" };
  const filter = filterSchema.safeParse(input.filter ?? {});
  if (
    !filter.success ||
    // The existing bounded-machine regex permits no whitespace; explicitly
    // reject a terminal line separator that a regexp $ anchor can overlook.
    Object.values(filter.data).some(
      (value) =>
        typeof value === "string" && /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value),
    )
  )
    return { kind: "INVALID" };
  if (input.filter === null) return { kind: "INVALID" };

  const eventIds: string[] = [];
  const wantedIds = new Set<string>();
  for (const rawId of input.eventIds) {
    const parsed = uuidSchema.safeParse(rawId);
    if (!parsed.success) return { kind: "INVALID" };
    const id = parsed.data.toLowerCase();
    if (!wantedIds.has(id)) {
      wantedIds.add(id);
      eventIds.push(id);
    }
  }

  const permissions = input.permissions;
  const readableSpecs = actionSpecs.filter((spec) =>
    permissions.includes(spec.permission),
  );
  if (!permissions.includes("admin.audit.read") || readableSpecs.length === 0)
    return { kind: "FORBIDDEN" };
  const selectedSpecs = readableSpecs.filter(
    (spec) =>
      (filter.data.action === undefined ||
        filter.data.action === spec.action) &&
      (filter.data.targetType === undefined ||
        filter.data.targetType === spec.targetType),
  );
  if (eventIds.length === 0 || selectedSpecs.length === 0)
    return { kind: "OK", items: [] };

  const values: unknown[] = [eventIds];
  const allowedPairs = selectedSpecs.map((spec) => {
    values.push(spec.action, spec.targetType);
    return (
      "(a.action=$" +
      (values.length - 1) +
      "::text AND a.target_type=$" +
      values.length +
      "::text)"
    );
  });
  const clauses = [
    "a.id=ANY($1::uuid[])",
    "(" + allowedPairs.join(" OR ") + ")",
  ];
  for (const key of Object.keys(
    filterColumns,
  ) as (keyof B14AuditReadFilter)[]) {
    const value = filter.data[key];
    if (value !== undefined) {
      values.push(value);
      const cast =
        key === "targetId" || key === "actorId" ? "::uuid" : "::text";
      clauses.push("a." + filterColumns[key] + "=$" + values.length + cast);
    }
  }
  const arms = selectedSpecs.map(
    (spec) =>
      "WHEN a.action=" +
      sqlLiteral(spec.action) +
      " AND a.target_type=" +
      sqlLiteral(spec.targetType) +
      " THEN " +
      projectionSql(spec),
  );
  values.push(eventIds.length);
  const result = await query.query<AuditProjectionRow>(
    "SELECT a.id,a.action,a.target_type,\nCASE " +
      arms.join("\n") +
      " ELSE NULL END AS projected_fields\nFROM audit_events a\nWHERE " +
      clauses.join(" AND ") +
      "\nORDER BY a.id\nLIMIT $" +
      values.length +
      "::integer",
    values,
  );

  const summaries = new Map<string, B14AuditSummary>();
  for (const row of result.rows) {
    if (typeof row.id !== "string") continue;
    const eventId = row.id.toLowerCase();
    if (!wantedIds.has(eventId)) continue;
    const spec = selectedSpecs.find(
      (candidate) =>
        candidate.action === row.action &&
        candidate.targetType === row.target_type,
    );
    if (!spec || !plainRecord(row.projected_fields)) continue;
    const fields = [...spec.fields, categoryField];
    const allowedKeys = new Set<string>(fields.map((field) => field.key));
    if (Object.keys(row.projected_fields).some((key) => !allowedKeys.has(key)))
      continue;
    const projection: {
      -readonly [Key in keyof B14AuditSummaryProjection]: B14AuditSummaryProjection[Key];
    } = { action: spec.action, targetType: spec.targetType };
    for (const { key } of fields)
      if (Object.hasOwn(row.projected_fields, key))
        projection[key] = row.projected_fields[key];
    const summary = mapB14AuditSummary(projection, permissions);
    if (summary) summaries.set(eventId, summary);
  }
  return {
    kind: "OK",
    items: eventIds.flatMap((eventId) => {
      const summary = summaries.get(eventId);
      return summary ? [{ eventId, summary }] : [];
    }),
  };
}

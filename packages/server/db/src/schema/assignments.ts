import { sql } from "drizzle-orm";
import {
  uniqueIndex,
  unique,
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { adminPrincipals } from "./admin";
import { aiAdapters, aiSurfaces, aiVariants } from "./adapter-registry";
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const assignmentSubjectKind = pgEnum(
  "adapter_profile_assignment_subject_kind",
  ["ACCOUNT", "DEVICE"],
);
export const assignmentMode = pgEnum("adapter_profile_assignment_mode", [
  "DIRECT",
  "ROLLOUT",
  "PAUSED",
]);
export const adapterProfileAssignments = pgTable(
  "adapter_profile_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adapterId: uuid("adapter_id").notNull(),
    surfaceId: uuid("surface_id").notNull(),
    variantId: uuid("variant_id"),
    browserFamily: varchar("browser_family", { length: 32 }).notNull(),
    subjectKind: assignmentSubjectKind("subject_kind").notNull(),
    cohortSeed: bytea("cohort_seed").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdByAdminPrincipalId: uuid("created_by_admin_principal_id"),
  },
  (table) => [
    uniqueIndex("adapter_profile_assignments_default_scope_unique")
      .on(table.adapterId, table.surfaceId, table.browserFamily)
      .where(sql`${table.variantId} IS NULL`),
    uniqueIndex("adapter_profile_assignments_exact_scope_unique")
      .on(
        table.adapterId,
        table.surfaceId,
        table.variantId,
        table.browserFamily,
      )
      .where(sql`${table.variantId} IS NOT NULL`),
    foreignKey({
      columns: [table.adapterId],
      foreignColumns: [aiAdapters.id],
      name: "adapter_profile_assignments_adapter_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.surfaceId, table.adapterId],
      foreignColumns: [aiSurfaces.id, aiSurfaces.adapterId],
      name: "adapter_profile_assignments_surface_adapter_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.variantId, table.surfaceId],
      foreignColumns: [aiVariants.id, aiVariants.surfaceId],
      name: "adapter_profile_assignments_variant_surface_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.createdByAdminPrincipalId],
      foreignColumns: [adminPrincipals.id],
      name: "adapter_profile_assignments_actor_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "adapter_profile_assignments_browser_family",
      sql`${table.browserFamily} IN ('chrome', 'opera', 'yandex_chromium', 'firefox', 'safari')`,
    ),
    check(
      "adapter_profile_assignments_seed_length",
      sql`octet_length(${table.cohortSeed}) = 32`,
    ),
  ],
);
export const adapterProfileAssignmentRevisions = pgTable(
  "adapter_profile_assignment_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assignmentId: uuid("assignment_id").notNull(),
    revision: integer("revision").notNull(),
    mode: assignmentMode("mode").notNull(),
    baselineProfileRevisionId: uuid("baseline_profile_revision_id").notNull(),
    candidateProfileRevisionId: uuid("candidate_profile_revision_id"),
    percentageBps: integer("percentage_bps").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdByAdminPrincipalId: uuid("created_by_admin_principal_id"),
    reason: varchar("reason", { length: 512 }),
  },
  (table) => [
    foreignKey({
      columns: [table.assignmentId],
      foreignColumns: [adapterProfileAssignments.id],
      name: "adapter_profile_assignment_revisions_assignment_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.createdByAdminPrincipalId],
      foreignColumns: [adminPrincipals.id],
      name: "adapter_profile_assignment_revisions_actor_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "adapter_profile_assignment_revisions_revision_positive",
      sql`${table.revision} > 0`,
    ),
    check(
      "adapter_profile_assignment_revisions_percentage_bounds",
      sql`${table.percentageBps} BETWEEN 0 AND 10000`,
    ),
    check(
      "adapter_profile_assignment_revisions_shape",
      sql`(${table.mode} = 'DIRECT' AND ${table.candidateProfileRevisionId} IS NULL AND ${table.percentageBps} = 0) OR (${table.mode} IN ('ROLLOUT', 'PAUSED') AND ${table.candidateProfileRevisionId} IS NOT NULL AND ${table.baselineProfileRevisionId} <> ${table.candidateProfileRevisionId})`,
    ),
    unique("adapter_profile_assignment_revisions_unique").on(
      table.assignmentId,
      table.revision,
    ),
    index("adapter_profile_assignment_revisions_assignment_index").on(
      table.assignmentId,
      table.revision.desc().nullsFirst(),
    ),
  ],
);

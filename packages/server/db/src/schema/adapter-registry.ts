import { sql } from "drizzle-orm";
import {
  index,
  check,
  foreignKey,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { adminPrincipals } from "./admin";

export const aiAdapterStatus = pgEnum("ai_adapter_status", [
  "ACTIVE",
  "DISABLED",
  "ARCHIVED",
]);
export const aiSurfaceStatus = pgEnum("ai_surface_status", [
  "ACTIVE",
  "DISABLED",
  "ARCHIVED",
]);
export const aiVariantStatus = pgEnum("ai_variant_status", [
  "ACTIVE",
  "DISABLED",
  "ARCHIVED",
]);
export const adapterProfileStatus = pgEnum("adapter_profile_status", [
  "ACTIVE",
  "DISABLED",
  "ARCHIVED",
]);
export const adapterProfileRevisionState = pgEnum(
  "adapter_profile_revision_state",
  ["DRAFT", "CANDIDATE", "PUBLISHED", "RETIRED"],
);

const stableMachineKey = (column: unknown) =>
  sql`${column} ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'`;

export const aiAdapters = pgTable(
  "ai_adapters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    machineKey: varchar("machine_key", { length: 64 }).notNull(),
    displayName: varchar("display_name", { length: 256 }).notNull(),
    description: varchar("description", { length: 512 }).notNull().default(""),
    status: aiAdapterStatus("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("ai_adapters_machine_key_unique").on(table.machineKey),
    check("ai_adapters_machine_key_format", stableMachineKey(table.machineKey)),
    check(
      "ai_adapters_updated_after_created",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const aiSurfaces = pgTable(
  "ai_surfaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adapterId: uuid("adapter_id").notNull(),
    machineKey: varchar("machine_key", { length: 64 }).notNull(),
    displayName: varchar("display_name", { length: 256 }).notNull(),
    status: aiSurfaceStatus("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.adapterId],
      foreignColumns: [aiAdapters.id],
      name: "ai_surfaces_adapter_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("ai_surfaces_adapter_machine_key_unique").on(
      table.adapterId,
      table.machineKey,
    ),
    unique("ai_surfaces_id_adapter_unique").on(table.id, table.adapterId),
    check("ai_surfaces_machine_key_format", stableMachineKey(table.machineKey)),
    check(
      "ai_surfaces_updated_after_created",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const aiVariants = pgTable(
  "ai_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    surfaceId: uuid("surface_id").notNull(),
    machineKey: varchar("machine_key", { length: 64 }).notNull(),
    displayName: varchar("display_name", { length: 256 }).notNull(),
    status: aiVariantStatus("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.surfaceId],
      foreignColumns: [aiSurfaces.id],
      name: "ai_variants_surface_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("ai_variants_surface_machine_key_unique").on(
      table.surfaceId,
      table.machineKey,
    ),
    unique("ai_variants_id_surface_unique").on(table.id, table.surfaceId),
    check("ai_variants_machine_key_format", stableMachineKey(table.machineKey)),
    check(
      "ai_variants_updated_after_created",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const adapterProfiles = pgTable(
  "adapter_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adapterId: uuid("adapter_id").notNull(),
    surfaceId: uuid("surface_id").notNull(),
    variantId: uuid("variant_id"),
    machineKey: varchar("machine_key", { length: 64 }).notNull(),
    displayName: varchar("display_name", { length: 256 }).notNull(),
    status: adapterProfileStatus("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.adapterId],
      foreignColumns: [aiAdapters.id],
      name: "adapter_profiles_adapter_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("adapter_profiles_surface_index").on(
      table.surfaceId,
      table.variantId,
    ),
    unique("adapter_profiles_machine_key_unique").on(table.machineKey),
    unique("adapter_profiles_identity_hierarchy_unique").on(
      table.id,
      table.adapterId,
      table.surfaceId,
    ),
    unique("adapter_profiles_id_variant_unique").on(table.id, table.variantId),
    foreignKey({
      columns: [table.surfaceId, table.adapterId],
      foreignColumns: [aiSurfaces.id, aiSurfaces.adapterId],
      name: "adapter_profiles_surface_adapter_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.variantId, table.surfaceId],
      foreignColumns: [aiVariants.id, aiVariants.surfaceId],
      name: "adapter_profiles_variant_surface_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "adapter_profiles_machine_key_format",
      stableMachineKey(table.machineKey),
    ),
    check(
      "adapter_profiles_updated_after_created",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const adapterProfileRevisions = pgTable(
  "adapter_profile_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    profileId: uuid("profile_id").notNull(),
    adapterId: uuid("adapter_id").notNull(),
    surfaceId: uuid("surface_id").notNull(),
    variantId: uuid("variant_id"),
    revision: integer("revision").notNull(),
    schemaVersion: varchar("schema_version", { length: 64 }).notNull(),
    state: adapterProfileRevisionState("state").notNull().default("DRAFT"),
    content: jsonb("content").notNull(),
    compatibilityConstraints: jsonb("compatibility_constraints").notNull(),
    contentSha256: varchar("content_sha256", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdByAdminPrincipalId: uuid("created_by_admin_principal_id"),
    publishedByAdminPrincipalId: uuid("published_by_admin_principal_id"),
  },
  (table) => [
    foreignKey({
      columns: [table.createdByAdminPrincipalId],
      foreignColumns: [adminPrincipals.id],
      name: "adapter_profile_revisions_created_by_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.publishedByAdminPrincipalId],
      foreignColumns: [adminPrincipals.id],
      name: "adapter_profile_revisions_published_by_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("adapter_profile_revisions_profile_index").on(table.profileId),
    unique("adapter_profile_revisions_profile_revision_unique").on(
      table.profileId,
      table.revision,
    ),
    unique("adapter_profile_revisions_identity_hierarchy_unique").on(
      table.id,
      table.profileId,
      table.adapterId,
      table.surfaceId,
      table.variantId,
    ),
    foreignKey({
      columns: [table.profileId, table.adapterId, table.surfaceId],
      foreignColumns: [
        adapterProfiles.id,
        adapterProfiles.adapterId,
        adapterProfiles.surfaceId,
      ],
      name: "adapter_profile_revisions_profile_hierarchy_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.profileId, table.variantId],
      foreignColumns: [adapterProfiles.id, adapterProfiles.variantId],
      name: "adapter_profile_revisions_profile_variant_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "adapter_profile_revisions_revision_positive",
      sql`${table.revision} > 0`,
    ),
    check(
      "adapter_profile_revisions_schema_version",
      sql`${table.schemaVersion} = 'adapter_profile_v1'`,
    ),
    check(
      "adapter_profile_revisions_content_object",
      sql`jsonb_typeof(${table.content}) = 'object'`,
    ),
    check(
      "adapter_profile_revisions_compatibility_object",
      sql`jsonb_typeof(${table.compatibilityConstraints}) = 'object'`,
    ),
    check(
      "adapter_profile_revisions_payload_size",
      sql`octet_length(${table.content}::text) + octet_length(${table.compatibilityConstraints}::text) <= 65536`,
    ),
    check(
      "adapter_profile_revisions_checksum_format",
      sql`${table.contentSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "adapter_profile_revisions_publication_state_time",
      sql`(${table.state} IN ('DRAFT', 'CANDIDATE') AND ${table.publishedAt} IS NULL) OR (${table.state} IN ('PUBLISHED', 'RETIRED') AND ${table.publishedAt} IS NOT NULL)`,
    ),
  ],
);

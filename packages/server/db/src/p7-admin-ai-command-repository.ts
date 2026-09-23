import { randomUUID } from "node:crypto";
import {
  AdapterProfileSchema,
  AdapterSchema,
  SurfaceSchema,
  VariantSchema,
  type Adapter,
  type AdapterProfile,
  type Surface,
  type Variant,
} from "@product/adapter-registry";
import type { AdminAiRegistryCommandRepository } from "@product/admin-ai";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";
import { safeAuditReason } from "./safe-audit.js";
import { authorizeAdminMutationInTransaction } from "./admin-mutation-authorization.js";

type Row = Record<string, unknown>;
const asDate = (value: unknown) =>
  value instanceof Date ? value : new Date(String(value));
const adapter = (row: Row): Adapter =>
  AdapterSchema.parse({
    ...row,
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt),
  });
const surface = (row: Row): Surface =>
  SurfaceSchema.parse({
    ...row,
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt),
  });
const variant = (row: Row): Variant =>
  VariantSchema.parse({
    ...row,
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt),
  });
const profile = (row: Row): AdapterProfile =>
  AdapterProfileSchema.parse({
    ...row,
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt),
  });
const identity = (table: string, withDescription: boolean) =>
  `SELECT id, machine_key AS "machineKey", display_name AS "displayName"${withDescription ? ", description" : ""}, status, created_at AS "createdAt", updated_at AS "updatedAt" FROM ${table} WHERE id=$1 FOR UPDATE`;
async function audit(
  q: DatabaseQuery,
  input: { actorId: string; correlationId: string; reason: string },
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown>,
) {
  await q.query(
    "INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata) VALUES('ADMIN',$1,$2,$3,$4,$5,$6,$7::jsonb)",
    [
      input.actorId,
      action,
      targetType,
      targetId,
      input.correlationId,
      safeAuditReason(input.reason),
      JSON.stringify(metadata),
    ],
  );
}
function stale(expected: Date, actual: Date): never {
  if (expected.getTime() !== actual.getTime())
    throw new Error("P7_ADMIN_STALE_UPDATED_AT");
  throw new Error("P7_ADMIN_UPDATE_FAILED");
}
function changedFields(input: {
  displayName?: string;
  description?: string;
  targetStatus?: "ACTIVE" | "DISABLED";
}) {
  return {
    displayName: input.displayName,
    description: input.description,
    targetStatus: input.targetStatus,
  };
}

export function createP7AdminAiCommandRepository(
  runtime: DatabaseRuntime,
): AdminAiRegistryCommandRepository {
  return {
    async createAdapter(input) {
      return runtime.transaction(async (q) => {
        await authorizeAdminMutationInTransaction(
          q,
          input.actorId,
          "ai.registry.manage",
        );
        const result = await q.query<Row>(
          `INSERT INTO ai_adapters(id,machine_key,display_name,description) VALUES($1,$2,$3,$4) RETURNING id,machine_key AS "machineKey",display_name AS "displayName",description,status,created_at AS "createdAt",updated_at AS "updatedAt"`,
          [
            randomUUID(),
            input.machineKey,
            input.displayName,
            input.description,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new Error("P7_ADMIN_INSERT_FAILED");
        await audit(
          q,
          input,
          "P7_ADMIN_ADAPTER_CREATED",
          "AI_ADAPTER",
          String(row.id),
          { machineKey: row.machineKey },
        );
        return adapter(row);
      });
    },
    async createSurface(input) {
      return runtime.transaction(async (q) => {
        await authorizeAdminMutationInTransaction(
          q,
          input.actorId,
          "ai.registry.manage",
        );
        const parent = await q.query<Row>(
          "SELECT id FROM ai_adapters WHERE id=$1",
          [input.adapterId],
        );
        if (!parent.rows[0]) throw new Error("P7_REGISTRY_PARENT_NOT_FOUND");
        const result = await q.query<Row>(
          `INSERT INTO ai_surfaces(id,adapter_id,machine_key,display_name) VALUES($1,$2,$3,$4) RETURNING id,adapter_id AS "adapterId",machine_key AS "machineKey",display_name AS "displayName",status,created_at AS "createdAt",updated_at AS "updatedAt"`,
          [randomUUID(), input.adapterId, input.machineKey, input.displayName],
        );
        const row = result.rows[0];
        if (!row) throw new Error("P7_ADMIN_INSERT_FAILED");
        await audit(
          q,
          input,
          "P7_ADMIN_SURFACE_CREATED",
          "AI_SURFACE",
          String(row.id),
          { adapterId: input.adapterId, machineKey: row.machineKey },
        );
        return surface(row);
      });
    },
    async createVariant(input) {
      return runtime.transaction(async (q) => {
        await authorizeAdminMutationInTransaction(
          q,
          input.actorId,
          "ai.registry.manage",
        );
        const parent = await q.query<Row>(
          "SELECT id FROM ai_surfaces WHERE id=$1",
          [input.surfaceId],
        );
        if (!parent.rows[0]) throw new Error("P7_REGISTRY_PARENT_NOT_FOUND");
        const result = await q.query<Row>(
          `INSERT INTO ai_variants(id,surface_id,machine_key,display_name) VALUES($1,$2,$3,$4) RETURNING id,surface_id AS "surfaceId",machine_key AS "machineKey",display_name AS "displayName",status,created_at AS "createdAt",updated_at AS "updatedAt"`,
          [randomUUID(), input.surfaceId, input.machineKey, input.displayName],
        );
        const row = result.rows[0];
        if (!row) throw new Error("P7_ADMIN_INSERT_FAILED");
        await audit(
          q,
          input,
          "P7_ADMIN_VARIANT_CREATED",
          "AI_VARIANT",
          String(row.id),
          { surfaceId: input.surfaceId, machineKey: row.machineKey },
        );
        return variant(row);
      });
    },
    async createProfile(input) {
      return runtime.transaction(async (q) => {
        await authorizeAdminMutationInTransaction(
          q,
          input.actorId,
          "ai.profile.manage",
        );
        const hierarchy = await q.query<Row>(
          `SELECT s.id AS "surfaceId", s.adapter_id AS "adapterId" FROM ai_surfaces s WHERE s.id=$1 AND s.adapter_id=$2`,
          [input.surfaceId, input.adapterId],
        );
        if (!hierarchy.rows[0]) throw new Error("P7_INVALID_HIERARCHY_BINDING");
        if (input.variantId) {
          const v = await q.query<Row>(
            "SELECT id FROM ai_variants WHERE id=$1 AND surface_id=$2",
            [input.variantId, input.surfaceId],
          );
          if (!v.rows[0]) throw new Error("P7_INVALID_HIERARCHY_BINDING");
        }
        const result = await q.query<Row>(
          `INSERT INTO adapter_profiles(id,adapter_id,surface_id,variant_id,machine_key,display_name) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,adapter_id AS "adapterId",surface_id AS "surfaceId",variant_id AS "variantId",machine_key AS "machineKey",display_name AS "displayName",status,created_at AS "createdAt",updated_at AS "updatedAt"`,
          [
            randomUUID(),
            input.adapterId,
            input.surfaceId,
            input.variantId,
            input.machineKey,
            input.displayName,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new Error("P7_ADMIN_INSERT_FAILED");
        await audit(
          q,
          input,
          "P7_ADMIN_PROFILE_CREATED",
          "ADAPTER_PROFILE",
          String(row.id),
          {
            adapterId: input.adapterId,
            surfaceId: input.surfaceId,
            variantId: input.variantId,
          },
        );
        return profile(row);
      });
    },
    async updateAdapter(input) {
      return updateIdentity(
        runtime,
        "ai_adapters",
        input,
        "ai.registry.manage",
        (row) => adapter(row),
        "AI_ADAPTER",
        "P7_ADMIN_ADAPTER_UPDATED",
        true,
      );
    },
    async updateSurface(input) {
      return updateIdentity(
        runtime,
        "ai_surfaces",
        input,
        "ai.registry.manage",
        (row) => surface(row),
        "AI_SURFACE",
        "P7_ADMIN_SURFACE_UPDATED",
        false,
      );
    },
    async updateVariant(input) {
      return updateIdentity(
        runtime,
        "ai_variants",
        input,
        "ai.registry.manage",
        (row) => variant(row),
        "AI_VARIANT",
        "P7_ADMIN_VARIANT_UPDATED",
        false,
      );
    },
    async updateProfile(input) {
      return updateIdentity(
        runtime,
        "adapter_profiles",
        input,
        "ai.profile.manage",
        (row) => profile(row),
        "ADAPTER_PROFILE",
        "P7_ADMIN_PROFILE_UPDATED",
        false,
      );
    },
  };
}

async function updateIdentity<T extends { id: string; updatedAt: Date }>(
  runtime: DatabaseRuntime,
  table: string,
  input: {
    id: string;
    expectedUpdatedAt: Date;
    displayName?: string;
    description?: string;
    targetStatus?: "ACTIVE" | "DISABLED";
    actorId: string;
    correlationId: string;
    reason: string;
  },
  permission: "ai.registry.manage" | "ai.profile.manage",
  map: (row: Row) => T,
  targetType: string,
  action: string,
  hasDescription: boolean,
): Promise<T> {
  return runtime.transaction(async (q) => {
    await authorizeAdminMutationInTransaction(q, input.actorId, permission);
    const current = await q.query<Row>(identity(table, hasDescription), [
      input.id,
    ]);
    const row = current.rows[0];
    if (!row) throw new Error("P7_REGISTRY_NOT_FOUND");
    const updatedAt = asDate(row.updatedAt);
    if (updatedAt.getTime() !== input.expectedUpdatedAt.getTime())
      stale(input.expectedUpdatedAt, updatedAt);
    const displayName = input.displayName ?? String(row.displayName);
    const existingDescription = row.description;
    if (hasDescription && typeof existingDescription !== "string")
      throw new Error("P7_ADMIN_DESCRIPTION_NOT_LOADED");
    const description = hasDescription
      ? input.description !== undefined
        ? input.description
        : (existingDescription as string)
      : null;
    const status = input.targetStatus ?? String(row.status);
    const result = hasDescription
      ? await q.query<Row>(
          `UPDATE ${table} SET display_name=$1,description=$2,status=$3,updated_at=now() WHERE id=$4 RETURNING id,machine_key AS "machineKey",display_name AS "displayName",description,status,created_at AS "createdAt",updated_at AS "updatedAt"`,
          [displayName, description, status, input.id],
        )
      : table === "ai_surfaces"
        ? await q.query<Row>(
            `UPDATE ${table} SET display_name=$1,status=$2,updated_at=now() WHERE id=$3 RETURNING id,adapter_id AS "adapterId",machine_key AS "machineKey",display_name AS "displayName",status,created_at AS "createdAt",updated_at AS "updatedAt"`,
            [displayName, status, input.id],
          )
        : table === "ai_variants"
          ? await q.query<Row>(
              `UPDATE ${table} SET display_name=$1,status=$2,updated_at=now() WHERE id=$3 RETURNING id,surface_id AS "surfaceId",machine_key AS "machineKey",display_name AS "displayName",status,created_at AS "createdAt",updated_at AS "updatedAt"`,
              [displayName, status, input.id],
            )
          : await q.query<Row>(
              `UPDATE ${table} SET display_name=$1,status=$2,updated_at=now() WHERE id=$3 RETURNING id,adapter_id AS "adapterId",surface_id AS "surfaceId",variant_id AS "variantId",machine_key AS "machineKey",display_name AS "displayName",status,created_at AS "createdAt",updated_at AS "updatedAt"`,
              [displayName, status, input.id],
            );
    const updated = result.rows[0];
    if (!updated) throw new Error("P7_ADMIN_STALE_UPDATED_AT");
    await audit(q, input, action, targetType, input.id, {
      fields: changedFields(input),
      updatedAt: asDate(updated.updatedAt).toISOString(),
    });
    return map(updated);
  });
}

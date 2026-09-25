/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  AdminCommercialReadRepository,
  AdminConfigReleaseRead,
  AdminExtensionReleaseRead,
  CompatibilityAdminRevision,
} from "@product/admin-commercial";
import type { AccountEntitlementOverride } from "@product/entitlements";
import type { DatabaseRuntime } from "./index.js";
import { createP4CommercialCatalogRepository } from "./p4-commercial-catalog-repository.js";
import { createP4EntitlementRepository } from "./p4-entitlement-repository.js";

const value = (b: boolean | null, i: number | string | null) =>
  b !== null
    ? { kind: "BOOLEAN" as const, value: b }
    : i !== null
      ? { kind: "INTEGER" as const, value: Number(i) }
      : null;
async function cursorRow(
  runtime: DatabaseRuntime,
  table: string,
  id: string,
  filters: string[],
  params: unknown[],
) {
  const result = await runtime.query<{ id: string; createdAt: Date }>(
    `SELECT id,created_at AS "createdAt" FROM ${table} WHERE id=$${params.length + 1} ${filters.length ? `AND ${filters.join(" AND ")}` : ""}`,
    [...params, id],
  );
  return result.rows[0];
}

export function createP6AdminCommercialReadRepository(
  runtime: DatabaseRuntime,
): AdminCommercialReadRepository {
  const catalog = createP4CommercialCatalogRepository(runtime);
  const resolver = createP4EntitlementRepository(runtime);
  return {
    async listPlans(input) {
      const where: string[] = [],
        args: unknown[] = [];
      if (input.planId) {
        args.push(input.planId);
        where.push(`p.id=$${args.length}`);
      }
      if (input.code) {
        args.push(input.code);
        where.push(`p.code=$${args.length}`);
      }
      if (input.status) {
        args.push(input.status);
        where.push(`p.status=$${args.length}`);
      }
      let after: { createdAt: Date; id: string } | undefined;
      if (input.cursor) {
        const row = await cursorRow(
          runtime,
          "plans p",
          input.cursor,
          where,
          args,
        );
        if (!row) return { kind: "INVALID_CURSOR" };
        after = row;
      }
      const cursorSql = after
        ? ` AND (p.created_at,p.id)<($${args.length + 1},$${args.length + 2})`
        : "";
      if (after) args.push(after.createdAt, after.id);
      args.push(input.limit + 1);
      const r = await runtime.query<any>(
        `SELECT p.id,p.code,p.status,p.created_at AS "createdAt",p.updated_at AS "updatedAt" FROM plans p ${where.length ? `WHERE ${where.join(" AND ")}` : "WHERE TRUE"}${cursorSql} ORDER BY p.created_at DESC,p.id DESC LIMIT $${args.length}`,
        args,
      );
      return {
        items: r.rows.slice(0, input.limit),
        ...(r.rows.length > input.limit
          ? { nextCursor: r.rows[input.limit - 1].id }
          : {}),
      };
    },
    getPlan: (id) => catalog.inspectPlan(id),
    async listPrices(input) {
      const where: string[] = [],
        args: unknown[] = [];
      const fields: [string, unknown][] = [
        ["p.id", input.priceId],
        ["p.plan_id", input.planId],
        ["p.code", input.code],
        ["p.market_key", input.marketKey],
        ["p.channel_key", input.channelKey],
        ["p.status", input.status],
      ];
      for (const [field, val] of fields)
        if (val !== undefined) {
          args.push(val);
          where.push(`${field}=$${args.length}`);
        }
      let after: { createdAt: Date; id: string } | undefined;
      if (input.cursor) {
        const row = await cursorRow(
          runtime,
          "prices p",
          input.cursor,
          where,
          args,
        );
        if (!row) return { kind: "INVALID_CURSOR" };
        after = row;
      }
      const cursorSql = after
        ? ` AND (p.created_at,p.id)<($${args.length + 1},$${args.length + 2})`
        : "";
      if (after) args.push(after.createdAt, after.id);
      args.push(input.limit + 1);
      const r = await runtime.query<any>(
        `SELECT p.id,p.plan_id AS "planId",p.code,p.market_key AS "marketKey",p.channel_key AS "channelKey",p.status,p.created_at AS "createdAt",p.updated_at AS "updatedAt" FROM prices p ${where.length ? `WHERE ${where.join(" AND ")}` : "WHERE TRUE"}${cursorSql} ORDER BY p.created_at DESC,p.id DESC LIMIT $${args.length}`,
        args,
      );
      return {
        items: r.rows.slice(0, input.limit),
        ...(r.rows.length > input.limit
          ? { nextCursor: r.rows[input.limit - 1].id }
          : {}),
      };
    },
    getPrice: (id) => catalog.inspectPrice(id),
    async listDefinitions(input) {
      const args: unknown[] = [],
        where: string[] = [];
      if (input.entitlementKey) {
        args.push(input.entitlementKey);
        where.push(`entitlement_key=$${args.length}`);
      }
      if (input.deprecated !== undefined)
        where.push(
          input.deprecated
            ? "deprecated_at IS NOT NULL"
            : "deprecated_at IS NULL",
        );
      let cursorSql = "";
      if (input.cursor) {
        const cursorArgs = [...args, input.cursor];
        const cursorResult = await runtime.query<{ entitlementKey: string }>(
          `SELECT entitlement_key AS "entitlementKey" FROM entitlement_definitions WHERE ${where.length ? `${where.join(" AND ")} AND ` : ""}entitlement_key=$${cursorArgs.length}`,
          cursorArgs,
        );
        if (!cursorResult.rows[0]) return { kind: "INVALID_CURSOR" };
        args.push(input.cursor);
        cursorSql = ` AND entitlement_key>$${args.length}`;
      }
      args.push(input.limit + 1);
      const r = await runtime.query<any>(
        `SELECT entitlement_key AS "entitlementKey",value_type AS "valueType",security_classification AS "securityClassification",description,deprecated_at AS "deprecatedAt",created_at AS "createdAt" FROM entitlement_definitions ${where.length ? `WHERE ${where.join(" AND ")}` : "WHERE TRUE"}${cursorSql} ORDER BY entitlement_key LIMIT $${args.length}`,
        args,
      );
      return {
        items: r.rows.slice(0, input.limit),
        ...(r.rows.length > input.limit
          ? { nextCursor: r.rows[input.limit - 1].entitlementKey }
          : {}),
      };
    },
    async listOverrides(input) {
      const exists = await runtime.query("SELECT 1 FROM accounts WHERE id=$1", [
        input.accountId,
      ]);
      if (!exists.rows[0]) return { kind: "ACCOUNT_NOT_FOUND" };
      const args: unknown[] = [input.accountId],
        where = ["account_id=$1"];
      if (input.entitlementKey) {
        args.push(input.entitlementKey);
        where.push(`entitlement_key=$${args.length}`);
      }
      let after: { createdAt: Date; id: string } | undefined;
      if (input.cursor) {
        const cursorArgs: unknown[] = [input.cursor, input.accountId];
        const cursorWhere = ["id=$1", "account_id=$2"];
        if (input.entitlementKey) {
          cursorArgs.push(input.entitlementKey);
          cursorWhere.push(`entitlement_key=$${cursorArgs.length}`);
        }
        const cursorResult = await runtime.query<{
          id: string;
          createdAt: Date;
        }>(
          `SELECT id,created_at AS "createdAt" FROM account_entitlement_overrides WHERE ${cursorWhere.join(" AND ")}`,
          cursorArgs,
        );
        if (!cursorResult.rows[0]) return { kind: "INVALID_CURSOR" };
        after = cursorResult.rows[0];
      }
      const cursorSql = after
        ? ` AND (created_at,id)<($${args.length + 1},$${args.length + 2})`
        : "";
      if (after) args.push(after.createdAt, after.id);
      args.push(input.limit + 1);
      const r = await runtime.query<any>(
        `SELECT id,account_id AS "accountId",entitlement_key AS "entitlementKey",revision,operation,boolean_value AS "booleanValue",integer_value AS "integerValue",effective_from AS "effectiveFrom",expires_at AS "expiresAt",created_at AS "createdAt" FROM account_entitlement_overrides WHERE ${where.join(" AND ")}${cursorSql} ORDER BY created_at DESC,id DESC LIMIT $${args.length}`,
        args,
      );
      const items: AccountEntitlementOverride[] = r.rows
        .slice(0, input.limit)
        .map((row: any) => ({
          id: row.id,
          accountId: row.accountId,
          entitlementKey: row.entitlementKey,
          revision: Number(row.revision),
          operation: row.operation,
          value:
            row.operation === "CLEAR"
              ? null
              : value(row.booleanValue, row.integerValue),
          effectiveFrom: row.effectiveFrom,
          expiresAt: row.expiresAt,
          reason: "REDACTED",
          createdAt: row.createdAt,
        }));
      return {
        items,
        ...(r.rows.length > input.limit
          ? { nextCursor: r.rows[input.limit - 1].id }
          : {}),
      };
    },
    async resolveEffective(input) {
      const account = await runtime.query<{ id: string }>(
        "SELECT id FROM accounts WHERE id=$1",
        [input.accountId],
      );
      if (!account.rows[0]) return { kind: "ACCOUNT_NOT_FOUND" };
      const sub = await runtime.query<{ planRevisionId: string }>(
        'SELECT current_plan_revision_id AS "planRevisionId" FROM subscriptions WHERE account_id=$1 ORDER BY updated_at DESC LIMIT 1',
        [input.accountId],
      );
      if (!sub.rows[0]) return { kind: "NO_PLAN_BINDING" };
      const result = await resolver.resolveCommercialEntitlement({
        accountId: input.accountId,
        planRevisionId: sub.rows[0].planRevisionId,
        entitlementKey: input.entitlementKey,
        at: input.at,
      });
      return result.kind === "OK" ? result.value : { kind: "NOT_FOUND" };
    },
    async getExtensionRelease(version) {
      const r = await runtime.query<any>(
        `SELECT r.id,r.version,r.release_channel AS "releaseChannel",
          r.artifact_sha256 AS "artifactSha256",r.released_at AS "releasedAt",
          r.created_at AS "createdAt",
          COALESCE((SELECT array_agg(contract_version::text ORDER BY contract_version::text)
            FROM extension_release_contracts c WHERE c.release_id=r.id),ARRAY[]::text[]) AS "supportedContracts",
          COALESCE((SELECT array_agg(browser_family::text ORDER BY browser_family::text)
            FROM extension_release_browsers b WHERE b.release_id=r.id),ARRAY[]::text[]) AS "supportedBrowsers"
         FROM extension_releases r WHERE r.version=$1`,
        [version],
      );
      return r.rows[0] ? (r.rows[0] as AdminExtensionReleaseRead) : null;
    },
    async getLatestConfigRelease(contractVersion) {
      const r = await runtime.query<any>(
        `SELECT c.config_version AS "configVersion",c.contract_version AS "contractVersion",
          c.snapshot_version AS "snapshotVersion",c.envelope_version AS "envelopeVersion",
          c.content_hash_sha256 AS "contentHashSha256",
          c.source_fingerprint_sha256 AS "sourceFingerprintSha256",
          c.signing_key_id AS "signingKeyId",c.published_at AS "publishedAt",
          c.created_at AS "createdAt",
          COALESCE((SELECT array_agg(policy_revision_id ORDER BY policy_revision_id)
            FROM config_release_compatibility_policies p
            WHERE p.config_version=c.config_version),'{}') AS "compatibilityPolicyRevisionIds"
         FROM config_releases c WHERE c.contract_version=$1
         ORDER BY c.config_version DESC LIMIT 1`,
        [contractVersion],
      );
      if (!r.rows[0]) return null;
      return {
        ...r.rows[0],
        configVersion: Number(r.rows[0].configVersion),
        compatibilityPolicyRevisionIds: [
          ...(r.rows[0].compatibilityPolicyRevisionIds ?? []),
        ].map(String),
      } as AdminConfigReleaseRead;
    },
    async listCompatibility(input) {
      const args: unknown[] = [input.contractVersion ?? "control_plane_v1"],
        where: string[] = ["p.contract_version=$1"];
      if (input.policyKey) {
        args.push(input.policyKey);
        where.push(`p.policy_key=$${args.length}`);
      }
      if (input.scope)
        where.push(
          input.scope === "GLOBAL"
            ? "p.browser_family IS NULL"
            : `p.browser_family=$${args.push(input.scope)}`,
        );
      let after: { createdAt: Date; id: string } | undefined;
      if (input.cursor) {
        const row = await cursorRow(
          runtime,
          "compatibility_policy_revisions p",
          input.cursor,
          where,
          args,
        );
        if (!row) return { kind: "INVALID_CURSOR" };
        after = row;
      }
      const cursorSql = after
        ? ` AND (p.created_at,p.id)<($${args.length + 1},$${args.length + 2})`
        : "";
      if (after) args.push(after.createdAt, after.id);
      args.push(input.limit + 1);
      const r = await runtime.query<any>(
        `SELECT p.id,p.policy_key AS "policyKey",p.revision,p.contract_version AS "contractVersion",p.browser_family AS "browserFamily",p.minimum_extension_version AS "minimumExtensionVersion",p.recommended_extension_version AS "recommendedExtensionVersion",p.minimum_browser_version AS "minimumBrowserVersion",p.maintenance_mode AS "maintenanceMode",p.maintenance_code AS "maintenanceCode",p.published_at AS "publishedAt",p.created_at AS "createdAt",COALESCE((SELECT array_agg(extension_version ORDER BY extension_version) FROM compatibility_policy_blocked_versions b WHERE b.policy_revision_id=p.id),'{}') AS "blockedVersions",COALESCE((SELECT array_agg(config_version ORDER BY config_version) FROM config_release_compatibility_policies c WHERE c.policy_revision_id=p.id),'{}') AS "linkedConfigVersions" FROM compatibility_policy_revisions p WHERE ${where.join(" AND ")}${cursorSql} ORDER BY p.created_at DESC,p.id DESC LIMIT $${args.length}`,
        args,
      );
      const items: CompatibilityAdminRevision[] = r.rows
        .slice(0, input.limit)
        .map((row: any) => ({
          ...row,
          revision: Number(row.revision),
          blockedVersions: [...(row.blockedVersions ?? [])],
          linkedConfigVersions: (row.linkedConfigVersions ?? []).map(Number),
        }));
      return {
        items,
        ...(r.rows.length > input.limit
          ? { nextCursor: r.rows[input.limit - 1].id }
          : {}),
      };
    },
  };
}

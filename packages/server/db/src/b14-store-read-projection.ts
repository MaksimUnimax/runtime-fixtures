import {
  decodeB14StoreCursor,
  encodeB14StoreCursor,
  projectB14StoreMetadata,
  type B14StoreMetadata,
  type B14StoreMetadataInput,
} from "@product/admin-ops";
import { AdminAccountsQueryV1Schema } from "@product/contracts";
import type { DatabaseQuery } from "./index.js";

export type B14StoreReadInput = Readonly<{
  accountId: unknown;
  cursor?: unknown;
  limit?: unknown;
}>;

export type B14StoreReadResult =
  | {
      kind: "OK";
      items: B14StoreMetadata[];
      nextCursor: string | null;
    }
  | {
      kind:
        | "INVALID_ACCOUNT_ID"
        | "INVALID_LIMIT"
        | "INVALID_CURSOR"
        | "ACCOUNT_NOT_FOUND"
        | "INVALID_STORE_METADATA";
    };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_STATE_BYTES = 4096;

// The unique (account_id, entity_id) index supports the account scope and
// keyset. Both comparisons and ordering use the column's same DB collation.
// Membership and the page share one statement snapshot, even on a pool: a
// cursor that is now tombstoned/absent cannot pass a separate earlier check.
// This selects scalar metadata only, never a raw state or receipt JSON value.
const STORE_PAGE_SQL = `
WITH guards AS (
  SELECT
    EXISTS(SELECT 1 FROM accounts WHERE id=$1::uuid) AS "accountExists",
    CASE WHEN $2::text IS NULL THEN TRUE ELSE EXISTS(
      SELECT 1 FROM sync_entities cursor_entity
      WHERE cursor_entity.account_id=$1::uuid
        AND cursor_entity.entity_id=$2::text
        AND cursor_entity.state->>'kind'='STORE_UPSERT'
        AND cursor_entity.state->>'lifecycleState'='ACTIVE'
    ) END AS "cursorExists"
)
SELECT
  guards."accountExists", guards."cursorExists",
  page."accountId", page."entityId", page."kind", page."lifecycleState",
  page."storeId", page."marketplace", page."name", page."providerAccountId",
  page."providerIdentityState", page."metadataRevision",
  page."serverRevision", page."updatedAt"
FROM guards
LEFT JOIN LATERAL (
  SELECT
    entity.account_id AS "accountId",
    entity.entity_id AS "entityId",
    entity.state->>'kind' AS "kind",
    entity.state->>'lifecycleState' AS "lifecycleState",
    CASE WHEN jsonb_typeof(entity.state->'storeId')='string'
      THEN entity.state->>'storeId' END AS "storeId",
    CASE WHEN jsonb_typeof(entity.state->'marketplace')='string'
      THEN entity.state->>'marketplace' END AS "marketplace",
    CASE WHEN jsonb_typeof(entity.state->'name')='string'
      THEN entity.state->>'name' END AS "name",
    CASE WHEN jsonb_typeof(entity.state->'providerAccountId')='string'
      THEN entity.state->>'providerAccountId' END AS "providerAccountId",
    CASE WHEN jsonb_typeof(entity.state->'providerIdentityState')='string'
      THEN entity.state->>'providerIdentityState' END AS "providerIdentityState",
    CASE WHEN jsonb_typeof(entity.state->'metadataRevision')='number'
      THEN entity.state->>'metadataRevision' END AS "metadataRevision",
    entity.server_revision AS "serverRevision",
    entity.updated_at AS "updatedAt"
  FROM sync_entities entity
  WHERE guards."accountExists" AND guards."cursorExists"
    AND entity.account_id=$1::uuid
    AND entity.state->>'kind'='STORE_UPSERT'
    AND entity.state->>'lifecycleState'='ACTIVE'
    AND ($2::text IS NULL OR entity.entity_id>$2::text)
  ORDER BY entity.entity_id ASC
  LIMIT $3
) page ON TRUE
ORDER BY page."entityId" ASC NULLS LAST
`;

const scalarColumns = [
  "accountId",
  "entityId",
  "kind",
  "lifecycleState",
  "storeId",
  "marketplace",
  "name",
  "providerAccountId",
  "providerIdentityState",
  "metadataRevision",
  "serverRevision",
  "updatedAt",
] as const;

function metadataRevision(value: unknown): number | undefined {
  // JSONB numeric text preserves exactness before JS parses it. In particular,
  // a fractional value near MAX_SAFE_INTEGER must not round into validity.
  // PostgreSQL may retain a decimal scale (e.g. 4.000); zero-only scale is exact.
  if (
    typeof value !== "string" ||
    value.length > MAX_STATE_BYTES ||
    !/^(0|[1-9]\d*)(?:\.0+)?$/u.test(value)
  )
    return undefined;
  const integral = value.split(".", 1)[0]!;
  if (integral.length > 16) return undefined;
  const number = Number(integral);
  return Number.isSafeInteger(number) ? number : undefined;
}

function projectionInput(row: Record<string, unknown>): B14StoreMetadataInput {
  // Do not spread a transport row: even an accidentally added private column
  // must never reach the domain mapper or be reflected in an error.
  return {
    accountId: row.accountId,
    entityId: row.entityId,
    kind: row.kind,
    lifecycleState: row.lifecycleState,
    storeId: row.storeId,
    marketplace: row.marketplace,
    name: row.name,
    providerAccountId: row.providerAccountId,
    providerIdentityState: row.providerIdentityState,
    metadataRevision: metadataRevision(row.metadataRevision),
    serverRevision: row.serverRevision,
    updatedAt: row.updatedAt,
  };
}

/**
 * Prepared internal read; not exported by @product/db and not wired to HTTP/UI.
 * The caller supplies its pool/transaction query handle and must separately
 * establish current admin authorization. An account ID/cursor is not authority.
 *
 * Reads the current accepted ACTIVE STORE_UPSERT rows. Suspended accounts and
 * revoked/unknown installations are not silently hidden: this admin read does
 * not infer current device status, credential presence or provider verification.
 * Pagination is a live keyset, not a frozen snapshot across separate requests.
 * Bad selected metadata fails the whole bounded page, including its lookahead.
 * Database failures propagate unchanged; they are never converted to an empty
 * page, retried, logged here, or reflected in the typed failure result.
 */
export async function readB14StoreMetadataPage(
  query: DatabaseQuery,
  input: B14StoreReadInput,
): Promise<B14StoreReadResult> {
  if (typeof input.accountId !== "string")
    return { kind: "INVALID_ACCOUNT_ID" };
  const parsedAccount = AdminAccountsQueryV1Schema.safeParse({
    accountId: input.accountId,
  });
  if (!parsedAccount.success || !parsedAccount.data.accountId)
    return { kind: "INVALID_ACCOUNT_ID" };
  const accountId = parsedAccount.data.accountId.toLowerCase();

  const limit = input.limit === undefined ? DEFAULT_LIMIT : input.limit;
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_LIMIT
  )
    return { kind: "INVALID_LIMIT" };

  let after: string | null = null;
  if (input.cursor !== undefined && input.cursor !== null) {
    if (typeof input.cursor !== "string") return { kind: "INVALID_CURSOR" };
    const decoded = decodeB14StoreCursor(input.cursor, accountId);
    if (!decoded) return { kind: "INVALID_CURSOR" };
    after = decoded.entityId;
  }

  const result = await query.query<Record<string, unknown>>(STORE_PAGE_SQL, [
    accountId,
    after,
    limit + 1,
  ]);
  const first = result.rows[0];
  if (
    !first ||
    result.rows.length > limit + 1 ||
    typeof first.accountExists !== "boolean" ||
    typeof first.cursorExists !== "boolean" ||
    result.rows.some(
      (row) =>
        row.accountExists !== first.accountExists ||
        row.cursorExists !== first.cursorExists,
    )
  )
    return { kind: "INVALID_STORE_METADATA" };
  if (!first.accountExists) return { kind: "ACCOUNT_NOT_FOUND" };
  if (!first.cursorExists)
    return {
      kind: after === null ? "INVALID_STORE_METADATA" : "INVALID_CURSOR",
    };

  if (
    result.rows.length === 1 &&
    scalarColumns.every((column) => first[column] === null)
  )
    return { kind: "OK", items: [], nextCursor: null };

  const seen = new Set<string>();
  const projected: B14StoreMetadata[] = [];
  for (const row of result.rows) {
    const projection = projectB14StoreMetadata(projectionInput(row), accountId);
    if (projection.kind !== "OK" || seen.has(projection.value.storeId))
      return { kind: "INVALID_STORE_METADATA" };
    seen.add(projection.value.storeId);
    projected.push(projection.value);
  }
  const items = projected.slice(0, limit);
  let nextCursor: string | null = null;
  if (projected.length > limit) {
    nextCursor = encodeB14StoreCursor(
      accountId,
      "store:" + items[items.length - 1]!.storeId,
    );
    if (!nextCursor) return { kind: "INVALID_STORE_METADATA" };
  }
  return { kind: "OK", items, nextCursor };
}

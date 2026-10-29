import { controlPlane, ControlPlaneError } from "./control-plane";

export type OverrideAuthority = {
  accountId: string;
  entitlementKey: string;
  latestRevision: number | null;
  valueType: "BOOLEAN" | "INTEGER";
  deprecated: boolean;
};

const UUID =
  /^(?:[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
const KEY = /^[A-Za-z0-9._:-]+$/;
const PAGE_LIMIT = 100;
const MAX_PAGES = 100;

function invalid(): never {
  throw new ControlPlaneError("INVALID_RESPONSE", 502);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function page(value: unknown) {
  const result = record(value);
  if (!Array.isArray(result.items) || result.items.length > PAGE_LIMIT)
    invalid();
  // The accepted commercial page writer omits an absent cursor. Both its
  // optional form and the BFF's existing nullable page form mean end-of-page.
  const cursor = result.nextCursor;
  if (cursor !== undefined && cursor !== null && typeof cursor !== "string")
    invalid();
  return { items: result.items as unknown[], nextCursor: cursor ?? null };
}

/**
 * Read the existing exact-key definition and complete bounded override history.
 * The visible history page and the currently effective override are not a CAS
 * revision: history is ordered by creation time, and future overrides may exist.
 * A later concurrent write is still rejected by the server's existing CAS.
 * Incomplete/invalid history stays unknown; it must never become revision null.
 */
export async function loadOverrideAuthority(
  path: string,
  init: { signal: AbortSignal },
): Promise<OverrideAuthority> {
  if (init.signal.aborted) throw new DOMException("Aborted", "AbortError");
  const url = new URL(path, "http://admin.invalid");
  const match = /^\/v1\/admin\/accounts\/([^/]+)\/entitlement-overrides$/.exec(
    url.pathname,
  );
  const accountId = match?.[1];
  const entitlementKey = url.searchParams.get("entitlementKey");
  if (
    !accountId ||
    !UUID.test(accountId) ||
    !entitlementKey ||
    !KEY.test(entitlementKey) ||
    url.searchParams.get("limit") !== String(PAGE_LIMIT) ||
    url.searchParams.has("cursor")
  )
    invalid();
  const definitionPath =
    "/v1/admin/commercial/entitlements/definitions?limit=100&entitlementKey=" +
    encodeURIComponent(entitlementKey);
  const [definitionResult, firstPage] = await Promise.all([
    controlPlane<unknown>(definitionPath, init),
    controlPlane<unknown>(path, init),
  ]);
  const definitions = page(definitionResult);
  if (definitions.nextCursor !== null || definitions.items.length !== 1)
    invalid();
  const definition = record(definitions.items[0]);
  if (
    definition.entitlementKey !== entitlementKey ||
    !(
      (definition.valueType === "BOOLEAN" &&
        definition.securityClassification === "CAPABILITY") ||
      (definition.valueType === "INTEGER" &&
        definition.securityClassification === "LIMIT")
    ) ||
    !(
      definition.deprecatedAt === null ||
      (typeof definition.deprecatedAt === "string" &&
        Number.isFinite(Date.parse(definition.deprecatedAt)))
    )
  )
    invalid();

  let latestRevision: number | null = null;
  let current = firstPage;
  const ids = new Set<string>();
  const cursors = new Set<string>();
  for (let index = 0; index < MAX_PAGES; index += 1) {
    if (init.signal.aborted) throw new DOMException("Aborted", "AbortError");
    const result = page(current);
    let lastId: string | undefined;
    for (const value of result.items) {
      const item = record(value);
      if (
        typeof item.id !== "string" ||
        !UUID.test(item.id) ||
        ids.has(item.id.toLowerCase()) ||
        typeof item.accountId !== "string" ||
        item.accountId.toLowerCase() !== accountId.toLowerCase() ||
        item.entitlementKey !== entitlementKey ||
        typeof item.revision !== "number" ||
        !Number.isSafeInteger(item.revision) ||
        item.revision < 1
      )
        invalid();
      lastId = item.id;
      ids.add(item.id.toLowerCase());
      latestRevision = Math.max(latestRevision ?? 0, item.revision);
    }
    if (result.nextCursor === null)
      return {
        accountId,
        entitlementKey,
        latestRevision,
        valueType: definition.valueType as "BOOLEAN" | "INTEGER",
        deprecated: definition.deprecatedAt !== null,
      };
    const cursor = result.nextCursor;
    if (
      typeof cursor !== "string" ||
      !UUID.test(cursor) ||
      lastId?.toLowerCase() !== cursor.toLowerCase() ||
      cursors.has(cursor.toLowerCase()) ||
      index + 1 === MAX_PAGES
    )
      invalid();
    cursors.add(cursor.toLowerCase());
    url.searchParams.set("cursor", cursor);
    current = await controlPlane<unknown>(url.pathname + url.search, init);
  }
  return invalid();
}

export function overrideValue(
  valueType: OverrideAuthority["valueType"] | undefined,
  input: string,
):
  | { kind: "BOOLEAN"; value: boolean }
  | { kind: "INTEGER"; value: number }
  | undefined {
  if (valueType === "BOOLEAN" && (input === "true" || input === "false"))
    return { kind: "BOOLEAN", value: input === "true" };
  if (valueType === "INTEGER" && /^-?\d+$/.test(input)) {
    const value = Number(input);
    if (Number.isSafeInteger(value)) return { kind: "INTEGER", value };
  }
  return undefined;
}

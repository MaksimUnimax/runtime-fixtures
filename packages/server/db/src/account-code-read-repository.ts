/**
 * Query adapter over a caller-supplied read snapshot store; no DB is opened.
 * No auth decision, permit issuance, writes, retry or authoritative no-grant.
 * Existing caller authentication/OWNER/session/lifecycle checks remain required.
 */
import { consumeAcw1HttpMetadataResponse } from "@product/contracts/account-code-http-response";
import type {
  AccountCodeMetadata, AccountCodeReceipt, AccountCodeReadStore,
  AccountCodeReadRepository, AccountCodeReadUnknown, AccountCodeMetadataReadResult,
  AccountCodeLookupReadResult,
} from "./account-code-read-model.js";
export type * from "./account-code-read-model.js";

const responseMetadata = Object.freeze({ headers: Object.freeze({ "cache-control": "no-store" as const }) });
function common(kind: "UNKNOWN" | "METADATA_DATA" | "LOOKUP_DATA") {
  return {
    verification: "UNVERIFIED" as const, executionOutcome: "UNKNOWN" as const,
    requiredResponseMetadata: responseMetadata, cacheEnforcement: "NOT_CHECKED" as const,
    safeLog: Object.freeze({ kind, executionOutcome: "UNKNOWN" as const }),
  };
}
function unknown(reason: AccountCodeReadUnknown["reason"]): AccountCodeReadUnknown {
  return Object.freeze({ ...common("UNKNOWN"), kind: "UNKNOWN", reason });
}
function invalid(): never { throw new Error("ACCOUNT_CODE_READ_INVALID"); }
function id(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
function integer(value: unknown, min = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min;
}
/** Driver projections must be plain own data; never evaluate row getters. */
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return invalid();
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor) || !descriptor.enumerable) return invalid();
    copy[key] = descriptor.value;
  }
  return copy;
}
function exact(row: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(row).length !== keys.length || keys.some(k => !Object.hasOwn(row, k))) invalid();
}
function metadata(value: unknown, accountId: string): AccountCodeMetadata {
  const row = record(value); exact(row, ["accountId", "state", "codeRevision", "createdAt"]);
  if (row.accountId !== accountId) return invalid();
  // These small domain checks also preserve -0/non-integers before JSON conversion.
  if (row.state === "ABSENT" && integer(row.codeRevision) && row.codeRevision === 0 && row.createdAt === null)
    return Object.freeze({ accountId, state: "ABSENT", codeRevision: 0, createdAt: null });
  if (row.state === "ACTIVE" && integer(row.codeRevision, 1) && integer(row.createdAt))
    return Object.freeze({ accountId, state: "ACTIVE", codeRevision: row.codeRevision, createdAt: row.createdAt });
  return invalid();
}
function receipt(value: unknown, accountId: string, operationId: string): AccountCodeReceipt {
  if (value === null) return Object.freeze({ operationId, outcome: "UNKNOWN" });
  const row = record(value);
  if (row.accountId !== accountId || row.operationId !== operationId) return invalid();
  if (row.outcome === "UNKNOWN_EXPIRED") {
    exact(row, ["accountId", "operationId", "outcome"]);
    return Object.freeze({ operationId, outcome: "UNKNOWN_EXPIRED" });
  }
  exact(row, ["accountId", "operationId", "outcome", "codeRevision", "createdAt"]);
  if (row.outcome !== "APPLIED_SECRET_NOT_REPLAYABLE" || !integer(row.codeRevision, 1) || !integer(row.createdAt))
    return invalid();
  // Original receipt times/revision, not the latest metadata or current clock.
  return Object.freeze({ operationId, outcome: "APPLIED_SECRET_NOT_REPLAYABLE",
    codeRevision: row.codeRevision, createdAt: row.createdAt });
}

export function createAccountCodeReadRepository(store: AccountCodeReadStore): AccountCodeReadRepository {
  async function read(accountId: unknown, operationId: unknown, lookup: boolean):
    Promise<AccountCodeMetadataReadResult | AccountCodeLookupReadResult> {
    if (!id(accountId) || (lookup && !id(operationId))) return unknown("INVALID_QUERY");
    // Strings captured before the only await; the store cannot retarget this key.
    const key = Object.freeze({ accountId, operationId: lookup ? operationId as string : null });
    let value: unknown;
    try { value = await store.readSnapshot(key); }
    catch { return unknown("READ_UNAVAILABLE"); }
    if (value === null) return unknown("SNAPSHOT_UNAVAILABLE");
    try {
      const snapshot = record(value); exact(snapshot, ["accountId", "metadata", "receipt"]);
      if (snapshot.accountId !== key.accountId) return invalid();
      // A missing current metadata projection cannot be repaired from a receipt.
      if (snapshot.metadata === null) return unknown("SNAPSHOT_UNAVAILABLE");
      const current = metadata(snapshot.metadata, key.accountId);
      if (!lookup) {
        if (snapshot.receipt !== null) return invalid();
        return Object.freeze({ ...common("METADATA_DATA"), kind: "METADATA_DATA", metadata: current });
      }
      const retained = receipt(snapshot.receipt, key.accountId, key.operationId!);
      // Validate the actual lookup wire response through the accepted codec.
      const parsed = consumeAcw1HttpMetadataResponse("lookup", 200,
        JSON.stringify({ profile: "ACW1", metadata: current, receipt: retained }),
        { accountId: key.accountId, operationId: key.operationId! });
      if (parsed.kind !== "ACW1_METADATA_DATA" || !("receipt" in parsed.data)) return invalid();
      const data = Object.freeze({ profile: "ACW1" as const,
        metadata: Object.freeze(parsed.data.metadata), receipt: Object.freeze(parsed.data.receipt) });
      return Object.freeze({ ...common("LOOKUP_DATA"), kind: "LOOKUP_DATA", data });
    } catch { return unknown("INVALID_SNAPSHOT"); }
  }
  return Object.freeze({
    readMetadata: (accountId: unknown) => read(accountId, null, false) as Promise<AccountCodeMetadataReadResult>,
    lookup: (accountId: unknown, operationId: unknown) => read(accountId, operationId, true) as Promise<AccountCodeLookupReadResult>,
  });
}

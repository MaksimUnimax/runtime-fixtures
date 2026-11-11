/**
 * Read-side persistence port for FINAL v2 §4 metadata/operation receipts.
 * These are public projections, never code/verifier/ticket/session records.
 * No physical schema, SQL, migration, writer, retention job or DB is supplied.
 */
import type { Acw1HttpResponseData } from "@product/contracts/account-code-http-response";

type MetadataWireData = Extract<Acw1HttpResponseData, { kind: "ACW1_METADATA_DATA" }>["data"];
export type AccountCodeLookupData = Extract<MetadataWireData, { receipt: unknown }>;
export type AccountCodeMetadata = AccountCodeLookupData["metadata"];
export type AccountCodeReceipt = AccountCodeLookupData["receipt"];

export interface AccountCodeReadKey {
  readonly accountId: string;
  /** null requests metadata only, not an action/permit or receipt lookup. */
  readonly operationId: string | null;
}
export type AccountCodeReceiptRecord = Readonly<{ accountId: string }> & (
  | Extract<AccountCodeReceipt, { outcome: "APPLIED_SECRET_NOT_REPLAYABLE" }>
  | { readonly operationId: string; readonly outcome: "UNKNOWN_EXPIRED" }
);
export interface AccountCodeReadSnapshot {
  readonly accountId: string;
  /** null is unavailable/unknown, NOT proof that code was never issued. */
  readonly metadata: AccountCodeMetadata | null;
  /**
   * null means no retained receipt was found; lookup projects UNKNOWN.
   * UNKNOWN_EXPIRED requires explicit scoped retained expiry/purge evidence;
   * neither a miss nor the adapter's clock can establish it.
   * Metadata-only reads must return null here.
   */
  readonly receipt: AccountCodeReceiptRecord | null;
}
export interface AccountCodeReadStore {
  /**
   * One coherent account/operation snapshot, not two independent reads.
   * Future persistence must read current metadata and the original receipt at
   * the same consistency boundary, honoring co-commit of code/revision/receipt.
   * No record/scope coverage => null, never synthesized ABSENT metadata.
   * Implementations return this public projection only, with millisecond safe
   * integers (no Date/string coercion). Runtime input is validated as unknown.
   * A single method call/fake store does not prove transactions or durability.
   */
  readSnapshot(key: AccountCodeReadKey): Promise<AccountCodeReadSnapshot | null>;
}

interface ReadCommon {
  readonly verification: "UNVERIFIED";
  readonly executionOutcome: "UNKNOWN";
  readonly requiredResponseMetadata: Readonly<{ headers: Readonly<{ "cache-control": "no-store" }> }>;
  readonly cacheEnforcement: "NOT_CHECKED";
  readonly safeLog: Readonly<{ kind: "UNKNOWN" | "METADATA_DATA" | "LOOKUP_DATA"; executionOutcome: "UNKNOWN" }>;
}
export type AccountCodeReadUnknown = ReadCommon & {
  readonly kind: "UNKNOWN";
  /** Internal read status, not a new ACW1 error enum or HTTP mapping. */
  readonly reason: "INVALID_QUERY" | "READ_UNAVAILABLE" | "SNAPSHOT_UNAVAILABLE" | "INVALID_SNAPSHOT";
};
export type AccountCodeMetadataReadResult = AccountCodeReadUnknown | (ReadCommon & {
  readonly kind: "METADATA_DATA";
  /** Internal component only; action GET still requires a real write permit. */
  readonly metadata: AccountCodeMetadata;
});
export type AccountCodeLookupReadResult = AccountCodeReadUnknown | (ReadCommon & {
  readonly kind: "LOOKUP_DATA";
  readonly data: AccountCodeLookupData;
});
export interface AccountCodeReadRepository {
  /** Caller must apply existing authentication/OWNER/account checks separately. */
  readMetadata(accountId: unknown): Promise<AccountCodeMetadataReadResult>;
  lookup(accountId: unknown, operationId: unknown): Promise<AccountCodeLookupReadResult>;
}

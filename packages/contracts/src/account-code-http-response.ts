/**
 * Pure raw HTTP response DATA consumer for reviewed FINAL v2 ACW1.
 * No HTTP extraction, Content-Type/header policy, TLS, authentication, crypto,
 * current consent, trusted state, retry, storage, ACK or credential installation.
 * Even CANCELLED/EXPIRED_NO_COMMIT is only an unverified server assertion here.
 * `data` may contain code/ticket/ciphertext/bindings: it is NOT a safe-log object.
 */
import type { Acj1Input } from "./account-code-acj1.js";
import {
  ACW1_ERROR_HTTP, parseAcw1Response, parseAcw1MetadataResponse, parseAcw1Error,
  type Acw1Operation, type Acw1Response, type Acw1MetadataResponse,
  type Acw1ErrorResponse, type Acw1WireContext,
} from "./account-code-wire.js";

export type Acw1ResponseContext = Pick<Acw1WireContext, "attemptId" | "operationId" | "accountId">;
const operations: readonly string[] = Object.freeze([
  "issue", "rotate", "allocate", "prepare", "commit", "cancel", "status", "ack",
]);
const errorStatuses: readonly number[] = Object.freeze([400, 401, 403, 409, 429, 503]);
const requiredMetadata = Object.freeze({ headers: Object.freeze({ "cache-control": "no-store" as const }) });
type Common = {
  readonly verification: "UNVERIFIED";
  readonly executionOutcome: "UNKNOWN";
  readonly downstreamDispatched: false;
  /** Requirement for a future caller, not an observed header/cache guarantee. */
  readonly requiredResponseMetadata: typeof requiredMetadata;
  readonly cacheEnforcement: "NOT_CHECKED";
  /** Only this restricted projection is intended for ordinary logging. */
  readonly safeLog: Readonly<{ expectedOperation: Acw1Operation | null; executionOutcome: "UNKNOWN" }>;
};
export type Acw1HttpResponseData = Common & (
  | { readonly kind: "UNKNOWN_TRANSPORT" }
  | { readonly kind: "ACW1_STATE_DATA"; readonly status: 200; readonly data: Acw1Response }
  | { readonly kind: "ACW1_METADATA_DATA"; readonly status: 200; readonly data: Acw1MetadataResponse }
  | { readonly kind: "ACW1_ERROR_DATA"; readonly status: number; readonly data: Acw1ErrorResponse }
);
function operation(value: unknown): Acw1Operation | null {
  return typeof value === "string" && operations.includes(value) ? value as Acw1Operation : null;
}
function common(op: Acw1Operation | null): Common {
  return {
    verification: "UNVERIFIED", executionOutcome: "UNKNOWN", downstreamDispatched: false,
    requiredResponseMetadata: requiredMetadata, cacheEnforcement: "NOT_CHECKED",
    safeLog: Object.freeze({ expectedOperation: op, executionOutcome: "UNKNOWN" }),
  };
}
function unknown(op: Acw1Operation | null): Acw1HttpResponseData {
  return Object.freeze({ ...common(op), kind: "UNKNOWN_TRANSPORT" });
}
function raw(value: unknown): value is Acj1Input {
  return typeof value === "string" || value instanceof Uint8Array;
}
/** Snapshot only explicit data properties; never evaluate caller getters. */
function context(value: unknown): Acw1ResponseContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new Error();
  const result: Acw1ResponseContext = {};
  for (const key of Reflect.ownKeys(value)) {
    if (key !== "attemptId" && key !== "operationId" && key !== "accountId") throw new Error();
    const d = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in d) || !d.enumerable) throw new Error();
    if (d.value === undefined) continue; // Optional caller context, not wire JSON.
    if (typeof d.value !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(d.value)) throw new Error();
    result[key] = d.value;
  }
  return result;
}
function errorData(op: Acw1Operation, status: unknown, body: Acj1Input): Acw1HttpResponseData {
  if (typeof status !== "number" || !errorStatuses.includes(status)) return unknown(op);
  const data = parseAcw1Error(op, body);
  if (ACW1_ERROR_HTTP[data.error.code] !== status) return unknown(op);
  return Object.freeze({ ...common(op), kind: "ACW1_ERROR_DATA", status, data });
}

/**
 * HTTP200 admits only the operation's strict state union. Non200 must be an
 * exact ACW1 error with its exact mapped status. Everything else is UNKNOWN.
 * The expected operation comes from the caller, never from the response body.
 * Optional account correlation and required attempt/write ids follow the
 * existing structural codec. This is not a complete retained-result verifier.
 */
export function consumeAcw1HttpResponse(
  expectedOperation: unknown, status: unknown, body: unknown, expected: unknown = {},
): Acw1HttpResponseData {
  const op = operation(expectedOperation);
  if (op === null) return unknown(null);
  try {
    const ctx = context(expected);
    if (!raw(body)) return unknown(op);
    if (status !== 200) return errorData(op, status, body);
    const data = parseAcw1Response(op, body, ctx);
    return Object.freeze({ ...common(op), kind: "ACW1_STATE_DATA", status: 200, data });
  } catch {
    // No exception details, raw body/status/context or sensitive DTO in errors.
    return unknown(op);
  }
}

/**
 * Pure consumer of GET metadata permits/receipts. Lookup has no defined error
 * operation literal in FINAL v2: non200 lookup remains UNKNOWN_TRANSPORT.
 * A permit, ABSENT metadata or a receipt never authorizes an action here.
 */
export function consumeAcw1HttpMetadataResponse(
  mode: unknown, status: unknown, body: unknown, expected: unknown,
): Acw1HttpResponseData {
  const op = mode === "issue" || mode === "rotate" ? mode : null;
  if (mode !== "lookup" && op === null) return unknown(null);
  try {
    const ctx = context(expected);
    if (!raw(body)) return unknown(op);
    if (status !== 200) return op === null ? unknown(null) : errorData(op, status, body);
    const data = parseAcw1MetadataResponse(mode as "issue" | "rotate" | "lookup", body, ctx);
    // If a caller already expects a permit id, preserve that extra correlation.
    if ("writePermit" in data && ctx.operationId !== undefined &&
        data.writePermit.operationId !== ctx.operationId) return unknown(op);
    return Object.freeze({ ...common(op), kind: "ACW1_METADATA_DATA", status: 200, data });
  } catch {
    return unknown(op);
  }
}

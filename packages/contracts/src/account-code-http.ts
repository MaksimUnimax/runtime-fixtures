/**
 * Pure HTTP metadata/raw-byte -> ACW1 structural boundary, FINAL v2 §§4/7/8.
 * No route registrations, framework, request dispatch, auth or persistence.
 * A parsed request/read intent remains UNVERIFIED; it is not permission to
 * commit, ACK, issue credentials or claim that a prior grant did not happen.
 * Never log raw input/headers, parsed secret-bearing requests or exceptions.
 */
import { type Acj1Input, Acj1Error } from "./account-code-acj1.js";
import {
  type Acw1Operation, type Acw1Request, type Acw1ErrorCode,
  type Acw1ErrorResponse, Acw1WireError, ACW1_ERROR_HTTP, parseAcw1Request,
} from "./account-code-wire.js";

export type Acw1HttpHeader = readonly [name: string, value: string];
export interface Acw1HttpMetadata {
  readonly headers: { readonly "cache-control": "no-store" };
}
const metadata: Acw1HttpMetadata = Object.freeze({
  headers: Object.freeze({ "cache-control": "no-store" as const }),
});
/** Applies equally to future actual success and error responses. There is no
 * fabricated status/result here; a real caller must apply these headers.
 */
export function acw1HttpResponseMetadata(): Acw1HttpMetadata { return metadata; }

interface BoundaryBase {
  readonly verification: "UNVERIFIED";
  readonly downstreamDispatched: false;
  readonly metadata: Acw1HttpMetadata;
}
export interface Acw1HttpTransportRequired extends BoundaryBase {
  readonly kind: "TRANSPORT_HANDLING_REQUIRED";
  readonly status: null;
  readonly body: null;
  readonly executionOutcome: "UNKNOWN";
}
export interface Acw1HttpErrorData extends BoundaryBase {
  readonly kind: "ACW1_ERROR";
  readonly status: (typeof ACW1_ERROR_HTTP)[Acw1ErrorCode];
  readonly body: Acw1ErrorResponse;
  readonly executionOutcome: "UNKNOWN";
}
export interface Acw1HttpParsedPost extends BoundaryBase {
  readonly kind: "PARSED_POST";
  readonly operation: Acw1Operation;
  readonly route: { readonly accountId?: string; readonly attemptId?: string };
  readonly request: Acw1Request;
}
export type Acw1HttpReadIntent =
  | { readonly accountId: string; readonly mode: "issue" | "rotate"; readonly errorOperation: "issue" | "rotate" }
  | { readonly accountId: string; readonly mode: "lookup"; readonly operationId: string; readonly errorOperation: null };
export interface Acw1HttpMetadataRead extends BoundaryBase {
  readonly kind: "METADATA_READ";
  readonly read: Acw1HttpReadIntent;
}
export type Acw1HttpBoundaryResult =
  | Acw1HttpParsedPost | Acw1HttpMetadataRead | Acw1HttpErrorData | Acw1HttpTransportRequired;

const operations: readonly string[] = ["issue", "rotate", "allocate", "prepare", "commit", "cancel", "status", "ack"];
function knownOperation(value: unknown): value is Acw1Operation {
  return typeof value === "string" && operations.includes(value);
}
function transportRequired(): Acw1HttpTransportRequired {
  return Object.freeze({ kind: "TRANSPORT_HANDLING_REQUIRED", verification: "UNVERIFIED",
    downstreamDispatched: false, metadata, status: null, body: null, executionOutcome: "UNKNOWN" });
}
/** Closed projection of an explicitly selected internal code. Arbitrary error
 * objects are not inspected/coerced; message/stack/input/status never escape.
 * Unknown codes/operations need the existing transport handler. In particular,
 * FINAL v2 has no lookup error-operation literal: do not invent one or infer it
 * from an untrusted body. 409/429/503 do not prove absence of a grant.
 */
export function acw1HttpError(
  operation: unknown, code: unknown,
): Acw1HttpErrorData | Acw1HttpTransportRequired {
  if (!knownOperation(operation) || typeof code !== "string" || !Object.hasOwn(ACW1_ERROR_HTTP, code))
    return transportRequired();
  const safeCode = code as Acw1ErrorCode;
  const body: Acw1ErrorResponse = Object.freeze({ profile: "ACW1", operation,
    error: Object.freeze({ code: safeCode }) });
  return Object.freeze({ kind: "ACW1_ERROR", verification: "UNVERIFIED", downstreamDispatched: false,
    metadata, status: ACW1_ERROR_HTTP[safeCode], body, executionOutcome: "UNKNOWN" });
}

type PostRoute = { kind: "post"; operation: Acw1Operation; accountId?: string; attemptId?: string };
type ReadRoute = { kind: "read"; read: Acw1HttpReadIntent };
const id = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const writePath = new RegExp("^/v1/accounts/(" + id + ")/connection-code(?:/(rotate))?$");
const attemptPath = new RegExp("^/v1/account-code/attempts/(" + id + ")/(prepare|commit|cancel|status|ack)$");
const metadataAction = new RegExp("^/v1/accounts/(" + id + ")/connection-code\\?action=(issue|rotate)$");
const metadataLookup = new RegExp("^/v1/accounts/(" + id + ")/connection-code\\?operationId=(" + id + ")$");
/** Caller supplies an origin-form raw request target, not an already repaired
 * URL. No percent/dot/case/trailing-slash normalization or proxy :id aliases.
 * Unknown targets/methods/query forms have no invented ACW1 status policy.
 */
function route(method: string, target: string): PostRoute | ReadRoute | null {
  if (typeof method !== "string" || typeof target !== "string") return null;
  if (method === "POST") {
    if (target === "/v1/account-code/attempts") return { kind: "post", operation: "allocate" };
    const write = writePath.exec(target);
    if (write) return { kind: "post", operation: write[2] ? "rotate" : "issue", accountId: write[1]! };
    const attempt = attemptPath.exec(target);
    if (attempt) return { kind: "post", operation: attempt[2] as Acw1Operation, attemptId: attempt[1]! };
  } else if (method === "GET") {
    const action = metadataAction.exec(target);
    if (action) {
      const mode = action[2] as "issue" | "rotate";
      return { kind: "read", read: { accountId: action[1]!, mode, errorOperation: mode } };
    }
    const lookup = metadataLookup.exec(target);
    if (lookup) return { kind: "read", read: { accountId: lookup[1]!, mode: "lookup",
      operationId: lookup[2]!, errorOperation: null } };
  }
  return null;
}
class HeaderShapeError extends Error {}
function writeIdempotencyKey(headers: readonly Acw1HttpHeader[]): string | undefined {
  if (!Array.isArray(headers)) throw new HeaderShapeError();
  let found: string | undefined;
  for (const pair of headers) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string")
      throw new HeaderShapeError();
    if (pair[0].toLowerCase() !== "idempotency-key") continue;
    if (found !== undefined) throw new HeaderShapeError();
    found = pair[1]; // No trim/coercion/value normalization.
  }
  return found;
}
function emptyBody(input: Acj1Input | undefined): boolean {
  return input === undefined || input === "" || (input instanceof Uint8Array && input.byteLength === 0);
}

/** Pure parser only. Header pairs preserve duplicate Idempotency-Key evidence;
 * upstream HTTP header/content-type parsing, auth/session/CSRF, current consent,
 * logging/redaction and actual response writing remain explicit caller work.
 * This function accepts no dispatcher/provider/server context or callback.
 */
export function acw1HttpBoundary(
  method: string, requestTarget: string, headers: readonly Acw1HttpHeader[] = [], body?: Acj1Input,
): Acw1HttpBoundaryResult {
  const match = route(method, requestTarget);
  if (!match) return transportRequired();
  if (match.kind === "read") {
    if (!emptyBody(body)) return transportRequired();
    return Object.freeze({ kind: "METADATA_READ", verification: "UNVERIFIED", downstreamDispatched: false,
      metadata, read: Object.freeze(match.read) });
  }
  if (typeof body !== "string" && !(body instanceof Uint8Array))
    return acw1HttpError(match.operation, "INVALID_REQUEST");
  try {
    const idempotencyKey = match.operation === "issue" || match.operation === "rotate"
      ? writeIdempotencyKey(headers) : undefined;
    const request = parseAcw1Request(match.operation, body, {
      accountId: match.accountId, attemptId: match.attemptId, idempotencyKey,
    });
    const context = match.accountId ? { accountId: match.accountId }
      : match.attemptId ? { attemptId: match.attemptId } : {};
    return Object.freeze({ kind: "PARSED_POST", verification: "UNVERIFIED", downstreamDispatched: false,
      metadata, operation: match.operation, route: Object.freeze(context), request });
  } catch (error) {
    if (error instanceof Acj1Error || error instanceof Acw1WireError || error instanceof HeaderShapeError)
      return acw1HttpError(match.operation, "INVALID_REQUEST");
    // Do not reinterpret an unexpected local failure as a wire/auth decision.
    return transportRequired();
  }
}

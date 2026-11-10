/**
 * ACW1 structural wire contracts, reviewed FINAL v2.
 * Dependency-free raw codecs, not Zod schemas or authentication.
 * A parsed ticket/proof/key/result is UNVERIFIED: no MAC, on-curve, ECDSA,
 * AEAD, digest, current authority, retained-state or durable-state guarantee.
 * No issuer, signing, storage, DB, routes or changes to existing contracts.
 */
import {
  type Acj1Input, parseAcj1, parseCanonicalAcj1, encodeAcj1,
  decodeBase64url, assertScalarString, utf8Bytes,
} from "./account-code-acj1.js";

export type Acw1Operation = "issue" | "rotate" | "allocate" | "prepare" | "commit" | "cancel" | "status" | "ack";
type AttemptOperation = "prepare" | "commit" | "cancel" | "status" | "ack";
export type Acw1Client = {
  clientType: "browser_extension"; browserFamily?: string; browserVersion?: string;
  extensionVersion?: string; label?: string;
};
/** Structural public key only; on-curve/non-infinity validation is external. */
export interface Acw1PublicKey { crv: "P-256"; kty: "EC"; x: string; y: string }
type RequestBase<O extends Acw1Operation> = { profile: "ACW1"; operation: O };
type AttemptRequestBase<O extends AttemptOperation> = RequestBase<O> & {
  attemptId: string; ticket: string; proof: string;
};
export type Acw1Request =
  | (RequestBase<"issue"> & { operationId: string; ticket: string; expectedRevision: 0 })
  | (RequestBase<"rotate"> & { operationId: string; ticket: string; expectedRevision: number })
  | (RequestBase<"allocate"> & { proofKey: Acw1PublicKey; recipientKey: Acw1PublicKey })
  | (AttemptRequestBase<"prepare"> & { accountCode: string; technicalDataConsent: "PRESENT" | "WITHHELD"; client: Acw1Client })
  | (AttemptRequestBase<"commit"> & { preparedBinding: string })
  | (AttemptRequestBase<"cancel" | "status"> & { preparedBinding: string | null })
  | (AttemptRequestBase<"ack"> & { preparedBinding: string; resultId: string; resultDigest: string });
export type Acw1Metadata =
  | { accountId: string; codeRevision: 0; state: "ABSENT"; createdAt: null }
  | { accountId: string; codeRevision: number; state: "ACTIVE"; createdAt: number };
export interface Acw1WritePermit { operationId: string; ticket: string; issuedAt: number; notAfter: number }
export type Acw1LookupReceipt =
  | { operationId: string; outcome: "APPLIED_SECRET_NOT_REPLAYABLE"; codeRevision: number; createdAt: number }
  | { operationId: string; outcome: "UNKNOWN" | "UNKNOWN_EXPIRED" };
export type Acw1MetadataResponse =
  | { profile: "ACW1"; metadata: Acw1Metadata; writePermit: Acw1WritePermit }
  | { profile: "ACW1"; metadata: Acw1Metadata; receipt: Acw1LookupReceipt };
export interface Acw1Allocation {
  attemptId: string; ticket: string; serverNonce: string;
  proofThumbprint: string; recipientThumbprint: string; issuedAt: number; notAfter: number;
}
export interface Acw1Prepared {
  profile: "ACW1"; attemptId: string; codeId: string; accountId: string;
  codeRevision: number; actorUserId: string; proofThumbprint: string; recipientThumbprint: string;
  technicalDataConsent: "PRESENT" | "WITHHELD"; client: Acw1Client; preparedAt: number;
}
export interface Acw1ResultRef {
  resultId: string; resultDigest: string; deviceId: string; sessionId: string;
  grantIssuedAt: number; accessExpiresAt: number; refreshExpiresAt: number;
  initialRefreshGeneration: number;
}
export interface Acw1CredentialPlaintext {
  profile: "ACW1"; resultId: string; attemptId: string; preparedBinding: string;
  accountId: string; actorUserId: string; deviceId: string; sessionId: string;
  accessBasis: "BETA" | "COMMERCIAL" | "NONE";
  deviceCreatedAt: number; sessionCreatedAt: number; grantIssuedAt: number;
  accessExpiresAt: number; refreshExpiresAt: number; initialRefreshGeneration: number;
  accessToken: string; refreshToken: string;
}
export type Acw1AdditionalData = Omit<Acw1CredentialPlaintext, "accessToken" | "refreshToken"> & {
  suite: "P256-HKDF-SHA256-A256GCM"; resultDigest: string;
  proofThumbprint: string; recipientThumbprint: string; ephemeralKey: Acw1PublicKey;
  salt: string; nonce: string;
};
export interface Acw1Envelope { aad: Acw1AdditionalData; ciphertext: string; tag: string }
type ResponseBase<O extends Acw1Operation> = { profile: "ACW1"; operation: O };
type AttemptResponseBase<O extends AttemptOperation> = ResponseBase<O> & { attemptId: string };
export type Acw1NoRecoveryReason =
  | "REFRESH_ROTATED" | "REVOKED" | "AUTHORITY_DENIED"
  | "CREDENTIAL_EXPIRED" | "WINDOW_EXPIRED" | "CIPHERTEXT_MISSING";
export type Acw1Response =
  | (ResponseBase<"issue" | "rotate"> & {
      state: "CODE_ISSUED"; operationId: string; metadata: Acw1Metadata; accountCode: string;
    })
  | (ResponseBase<"issue" | "rotate"> & {
      state: "APPLIED_SECRET_NOT_REPLAYABLE"; operationId: string; metadata: Acw1Metadata;
    })
  | (ResponseBase<"allocate"> & { state: "ALLOCATED"; allocation: Acw1Allocation })
  | (AttemptResponseBase<"status"> & { state: "ALLOCATED"; allocation: Acw1Allocation })
  | (AttemptResponseBase<"prepare" | "status" | "commit"> & {
      state: "PREPARED"; prepared: Acw1Prepared; preparedBinding: string;
    })
  | (AttemptResponseBase<"commit" | "status" | "cancel"> & {
      state: "COMMITTED"; preparedBinding: string; result: Acw1Envelope;
    })
  | (AttemptResponseBase<"commit" | "status" | "cancel" | "ack"> & {
      state: "COMMITTED_DELIVERED"; preparedBinding: string; resultRef: Acw1ResultRef;
      ackedAt: number; reason: "ACKNOWLEDGED";
    })
  | (AttemptResponseBase<"commit" | "status" | "cancel" | "ack"> & {
      state: "COMMITTED_NO_RECOVERY"; preparedBinding: string; resultRef: Acw1ResultRef;
      ackedAt: null; reason: Acw1NoRecoveryReason;
    })
  | (AttemptResponseBase<"commit" | "status" | "cancel"> & {
      state: "CANCELLED" | "EXPIRED_NO_COMMIT"; preparedBinding: string | null;
    })
  | (AttemptResponseBase<"status" | "cancel" | "commit" | "ack"> & { state: "UNKNOWN_EXPIRED" });

export const ACW1_ERROR_HTTP = Object.freeze({
  INVALID_REQUEST: 400, AUTH_REQUIRED: 401, FORBIDDEN: 403, RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503, ACCOUNT_CODE_INVALID: 400, ACCOUNT_CODE_UNAVAILABLE: 503,
  ACCOUNT_CODE_REVISION_CONFLICT: 409, ATTEMPT_EXPIRED: 409,
  ATTEMPT_CONFLICT: 409, RECOVERY_UNAVAILABLE: 409,
} as const);
export type Acw1ErrorCode = keyof typeof ACW1_ERROR_HTTP;
export interface Acw1ErrorResponse {
  profile: "ACW1"; operation: Acw1Operation; error: { code: Acw1ErrorCode };
}
export interface Acw1WireContext {
  /** Exact canonical path id, required for attempt requests/responses. */
  attemptId?: string;
  /** Required issue/rotate request header. */
  idempotencyKey?: string;
  /** Required write/lookup response correlation id. */
  operationId?: string;
  /** Required write request/metadata path id; optional expected account for other responses. */
  accountId?: string;
}
export class Acw1WireError extends Error {
  readonly code = "INVALID_REQUEST";
  constructor() { super("ACW1_WIRE_INVALID"); this.name = "Acw1WireError"; }
}
function invalid(): never { throw new Acw1WireError(); }
type Obj = Record<string, unknown>;
function object(value: unknown): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Obj;
}
function exact(value: Obj, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(value, key))) invalid();
}
function str(value: unknown): string {
  if (typeof value !== "string") return invalid();
  assertScalarString(value); return value;
}
function literal(value: unknown, expected: string): void {
  if (value !== expected) invalid();
}
function oneOf(value: unknown, allowed: readonly string[]): string {
  const s = str(value); if (!allowed.includes(s)) invalid(); return s;
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) ||
      Object.is(value, -0) || value < min || value > max) return invalid();
  return value;
}
function uuid(value: unknown): string {
  const s = str(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s))
    invalid();
  return s;
}
function b64(value: unknown, bytes: number): string {
  const s = str(value); decodeBase64url(s, bytes); return s;
}
function same(left: unknown, right: unknown): void { if (left !== right) invalid(); }
function binding(value: unknown, nullable = false): void {
  if (nullable && value === null) return;
  b64(value, 32);
}
function publicKey(value: unknown): Obj {
  const k = object(value); exact(k, ["crv", "kty", "x", "y"]);
  literal(k.crv, "P-256"); literal(k.kty, "EC"); b64(k.x, 32); b64(k.y, 32);
  return k; // Deliberately not an on-curve/verified key type.
}
function code(value: unknown): void {
  const s = str(value), parts = s.split(".");
  if (s.length !== 84 || parts.length !== 3 || parts[0] !== "ac1") invalid();
  uuid(parts[1]); b64(parts[2], 32);
}
function proof(value: unknown): void {
  const bytes = decodeBase64url(str(value), 64);
  const number = (part: Uint8Array) => BigInt("0x" +
    Array.from(part, (x) => x.toString(16).padStart(2, "0")).join(""));
  const r = number(bytes.subarray(0, 32)), s = number(bytes.subarray(32));
  const n = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
  if (r < 1n || r >= n || s < 1n || s > n / 2n) invalid();
  // Shape/range/low-S only, not ECDSA verification or signing.
}
function client(value: unknown, consent: unknown): void {
  const c = object(value);
  oneOf(consent, ["PRESENT", "WITHHELD"]);
  literal(c.clientType, "browser_extension");
  if (consent === "WITHHELD") { exact(c, ["clientType"]); return; }
  const allowed = ["clientType", "browserFamily", "browserVersion", "extensionVersion", "label"];
  if (Object.keys(c).some((key) => !allowed.includes(key))) invalid();
  for (const key of allowed.slice(1)) if (Object.hasOwn(c, key)) {
    const bytes = utf8Bytes(str(c[key])).length;
    if (bytes < 1 || bytes > 128) invalid();
  }
  // PRESENT is a wire assertion, not proof of current consent projection.
}
function ticket(value: unknown, kind: "write" | "attempt"): Obj {
  const parts = str(value).split(".");
  if (parts.length !== 2) return invalid();
  const payload = object(parseCanonicalAcj1(decodeBase64url(parts[0]!)));
  b64(parts[1], 32); literal(payload.profile, "ACW1"); literal(payload.kind, kind);
  integer(payload.keyVersion, 1, 0xffffffff);
  const issued = integer(payload.issuedAt), end = integer(payload.notAfter);
  if (end - issued !== 600000) invalid();
  if (kind === "write") {
    exact(payload, ["profile", "kind", "keyVersion", "operation", "operationId",
      "accountId", "baseRevision", "portalBinding", "issuedAt", "notAfter"]);
    oneOf(payload.operation, ["issue", "rotate"]); uuid(payload.operationId);
    uuid(payload.accountId); integer(payload.baseRevision); b64(payload.portalBinding, 32);
  } else {
    exact(payload, ["profile", "kind", "keyVersion", "attemptId", "proofThumbprint",
      "recipientThumbprint", "serverNonce", "issuedAt", "notAfter"]);
    uuid(payload.attemptId); b64(payload.proofThumbprint, 32);
    b64(payload.recipientThumbprint, 32); b64(payload.serverNonce, 32);
  }
  return payload; // MAC/current authority/deadline require the actual consumer.
}
const operations = ["issue", "rotate", "allocate", "prepare", "commit", "cancel", "status", "ack"];
function raw(input: Acj1Input, limit: number): Obj { return object(parseAcj1(input, limit)); }
function header(o: Obj, operation: Acw1Operation): void {
  oneOf(operation, operations); literal(o.profile, "ACW1"); same(o.operation, operation);
}
function attemptContext(o: Obj, ctx: Acw1WireContext): void {
  uuid(o.attemptId); uuid(ctx.attemptId); same(o.attemptId, ctx.attemptId);
}
function accountContext(o: Obj, ctx: Acw1WireContext): void {
  if (ctx.accountId !== undefined) { uuid(ctx.accountId); same(o.accountId, ctx.accountId); }
}

export function parseAcw1Request(
  operation: Acw1Operation, input: Acj1Input, ctx: Acw1WireContext = {},
): Acw1Request {
  const o = raw(input, 8192); header(o, operation);
  if (operation === "allocate") {
    exact(o, ["profile", "operation", "proofKey", "recipientKey"]);
    const p = publicKey(o.proofKey), r = publicKey(o.recipientKey);
    if (p.x === r.x && p.y === r.y) invalid();
  } else if (operation === "issue" || operation === "rotate") {
    exact(o, ["profile", "operation", "operationId", "ticket", "expectedRevision"]);
    uuid(o.operationId); same(ctx.idempotencyKey, o.operationId);
    integer(o.expectedRevision, operation === "issue" ? 0 : 1);
    if (operation === "issue") same(o.expectedRevision, 0);
    const t = ticket(o.ticket, "write");
    uuid(ctx.accountId); same(t.accountId, ctx.accountId);
    same(t.operation, operation); same(t.operationId, o.operationId);
    same(t.baseRevision, o.expectedRevision);
  } else {
    attemptContext(o, ctx); proof(o.proof);
    const t = ticket(o.ticket, "attempt"); same(t.attemptId, o.attemptId);
    const base = ["profile", "operation", "attemptId", "ticket", "proof"];
    if (operation === "prepare") {
      exact(o, [...base, "accountCode", "technicalDataConsent", "client"]);
      code(o.accountCode); client(o.client, o.technicalDataConsent);
    } else if (operation === "ack") {
      exact(o, [...base, "preparedBinding", "resultId", "resultDigest"]);
      binding(o.preparedBinding); uuid(o.resultId); b64(o.resultDigest, 32);
    } else {
      exact(o, [...base, "preparedBinding"]);
      binding(o.preparedBinding, operation !== "commit");
    }
  }
  return o as unknown as Acw1Request;
}
function metadata(value: unknown): Obj {
  const m = object(value); exact(m, ["accountId", "codeRevision", "state", "createdAt"]);
  uuid(m.accountId); const rev = integer(m.codeRevision);
  if (m.state === "ABSENT") { same(rev, 0); same(m.createdAt, null); }
  else { literal(m.state, "ACTIVE"); integer(rev, 1); integer(m.createdAt); }
  return m;
}
function allocation(value: unknown): Obj {
  const a = object(value); exact(a, ["attemptId", "ticket", "serverNonce",
    "proofThumbprint", "recipientThumbprint", "issuedAt", "notAfter"]);
  uuid(a.attemptId); b64(a.serverNonce, 32); b64(a.proofThumbprint, 32);
  b64(a.recipientThumbprint, 32); integer(a.issuedAt); integer(a.notAfter);
  const t = ticket(a.ticket, "attempt");
  for (const key of ["attemptId", "serverNonce", "proofThumbprint", "recipientThumbprint", "issuedAt", "notAfter"])
    same(a[key], t[key]);
  return a;
}
function prepared(value: unknown): Obj {
  const p = object(value); exact(p, ["profile", "attemptId", "codeId", "accountId",
    "codeRevision", "actorUserId", "proofThumbprint", "recipientThumbprint",
    "technicalDataConsent", "client", "preparedAt"]);
  literal(p.profile, "ACW1");
  for (const key of ["attemptId", "codeId", "accountId", "actorUserId"]) uuid(p[key]);
  integer(p.codeRevision, 1); b64(p.proofThumbprint, 32); b64(p.recipientThumbprint, 32);
  client(p.client, p.technicalDataConsent); integer(p.preparedAt);
  return p;
}
const refKeys = ["resultId", "resultDigest", "deviceId", "sessionId", "grantIssuedAt",
  "accessExpiresAt", "refreshExpiresAt", "initialRefreshGeneration"] as const;
function resultRef(value: unknown): void {
  const r = object(value); exact(r, refKeys);
  uuid(r.resultId); b64(r.resultDigest, 32); uuid(r.deviceId); uuid(r.sessionId);
  for (const key of refKeys.slice(4)) integer(r[key]);
}
const commonResultKeys = ["profile", "resultId", "attemptId", "preparedBinding",
  "accountId", "actorUserId", "deviceId", "sessionId", "accessBasis", "deviceCreatedAt",
  "sessionCreatedAt", "grantIssuedAt", "accessExpiresAt", "refreshExpiresAt", "initialRefreshGeneration"] as const;
function resultFields(o: Obj): void {
  literal(o.profile, "ACW1");
  for (const key of ["resultId", "attemptId", "accountId", "actorUserId", "deviceId", "sessionId"])
    uuid(o[key]);
  binding(o.preparedBinding); oneOf(o.accessBasis, ["BETA", "COMMERCIAL", "NONE"]);
  for (const key of commonResultKeys.slice(9)) integer(o[key]);
}
export function parseAcw1CredentialPlaintext(input: Acj1Input): Acw1CredentialPlaintext {
  // Decrypted C is exact ACJ1, unlike ordinary outer wire JSON.
  const c = object(parseCanonicalAcj1(input, 8192));
  exact(c, [...commonResultKeys, "accessToken", "refreshToken"]); resultFields(c);
  str(c.accessToken); str(c.refreshToken); // Existing issuer syntax/auth is external.
  return c as unknown as Acw1CredentialPlaintext;
}
/** Structural E only: a valid-width mutated tag/ciphertext is NOT authenticated. */
export function parseAcw1Envelope(value: unknown): Acw1Envelope {
  encodeAcj1(value, 16384); // Validate the object domain/cap before property reads.
  const e = object(value); exact(e, ["aad", "ciphertext", "tag"]);
  const bytes = decodeBase64url(str(e.ciphertext), undefined, 8192);
  if (bytes.length < 1) invalid();
  b64(e.tag, 16);
  const ad = object(e.aad);
  exact(ad, [...commonResultKeys, "suite", "resultDigest", "proofThumbprint",
    "recipientThumbprint", "ephemeralKey", "salt", "nonce"]);
  resultFields(ad); literal(ad.suite, "P256-HKDF-SHA256-A256GCM");
  b64(ad.resultDigest, 32); b64(ad.proofThumbprint, 32); b64(ad.recipientThumbprint, 32);
  publicKey(ad.ephemeralKey); b64(ad.salt, 32); b64(ad.nonce, 12);
  return e as unknown as Acw1Envelope;
}
export function parseAcw1MetadataResponse(
  mode: "issue" | "rotate" | "lookup", input: Acj1Input, ctx: Acw1WireContext,
): Acw1MetadataResponse {
  oneOf(mode, ["issue", "rotate", "lookup"]);
  const o = raw(input, 16384); literal(o.profile, "ACW1");
  const m = metadata(o.metadata); uuid(ctx.accountId); same(m.accountId, ctx.accountId);
  if (mode === "lookup") {
    exact(o, ["profile", "metadata", "receipt"]);
    const r = object(o.receipt); uuid(r.operationId); uuid(ctx.operationId);
    same(r.operationId, ctx.operationId);
    if (r.outcome === "APPLIED_SECRET_NOT_REPLAYABLE") {
      exact(r, ["operationId", "outcome", "codeRevision", "createdAt"]);
      integer(r.codeRevision, 1); integer(r.createdAt);
    } else {
      exact(r, ["operationId", "outcome"]); oneOf(r.outcome, ["UNKNOWN", "UNKNOWN_EXPIRED"]);
    }
  } else {
    exact(o, ["profile", "metadata", "writePermit"]);
    const w = object(o.writePermit);
    exact(w, ["operationId", "ticket", "issuedAt", "notAfter"]);
    uuid(w.operationId); integer(w.issuedAt); integer(w.notAfter);
    const t = ticket(w.ticket, "write");
    same(t.operation, mode); same(t.operationId, w.operationId);
    same(t.accountId, m.accountId); same(t.baseRevision, m.codeRevision);
    same(t.issuedAt, w.issuedAt); same(t.notAfter, w.notAfter);
  }
  return o as unknown as Acw1MetadataResponse;
}
export function parseAcw1Response(
  operation: Acw1Operation, input: Acj1Input, ctx: Acw1WireContext = {},
): Acw1Response {
  const o = raw(input, 16384); header(o, operation);
  if (operation === "issue" || operation === "rotate") {
    oneOf(o.state, ["CODE_ISSUED", "APPLIED_SECRET_NOT_REPLAYABLE"]);
    const keys = ["profile", "operation", "state", "operationId", "metadata"];
    exact(o, o.state === "CODE_ISSUED" ? [...keys, "accountCode"] : keys);
    uuid(o.operationId); uuid(ctx.operationId); same(o.operationId, ctx.operationId);
    const m = metadata(o.metadata); accountContext(m, ctx);
    if (o.state === "CODE_ISSUED") { code(o.accountCode); literal(m.state, "ACTIVE"); }
  } else if (operation === "allocate") {
    exact(o, ["profile", "operation", "state", "allocation"]);
    literal(o.state, "ALLOCATED"); allocation(o.allocation);
  } else {
    attemptContext(o, ctx);
    const base = ["profile", "operation", "state", "attemptId"];
    const allowed = (ops: readonly string[]) => { if (!ops.includes(operation)) invalid(); };
    switch (o.state) {
      case "ALLOCATED": {
        allowed(["status"]); exact(o, [...base, "allocation"]);
        same(allocation(o.allocation).attemptId, o.attemptId); break;
      }
      case "PREPARED": {
        allowed(["prepare", "status", "commit"]);
        exact(o, [...base, "prepared", "preparedBinding"]); binding(o.preparedBinding);
        const p = prepared(o.prepared); same(p.attemptId, o.attemptId); accountContext(p, ctx);
        break;
      }
      case "COMMITTED": {
        allowed(["commit", "status", "cancel"]); exact(o, [...base, "preparedBinding", "result"]);
        binding(o.preparedBinding); const e = parseAcw1Envelope(o.result);
        same(e.aad.attemptId, o.attemptId); same(e.aad.preparedBinding, o.preparedBinding);
        accountContext(e.aad as unknown as Obj, ctx); break;
      }
      case "COMMITTED_DELIVERED":
      case "COMMITTED_NO_RECOVERY": {
        allowed(["commit", "status", "cancel", "ack"]);
        exact(o, [...base, "preparedBinding", "resultRef", "ackedAt", "reason"]);
        binding(o.preparedBinding); resultRef(o.resultRef);
        if (o.state === "COMMITTED_DELIVERED") {
          integer(o.ackedAt); literal(o.reason, "ACKNOWLEDGED");
        } else {
          same(o.ackedAt, null);
          oneOf(o.reason, ["REFRESH_ROTATED", "REVOKED", "AUTHORITY_DENIED",
            "CREDENTIAL_EXPIRED", "WINDOW_EXPIRED", "CIPHERTEXT_MISSING"]);
        }
        break;
      }
      case "CANCELLED":
      case "EXPIRED_NO_COMMIT":
        allowed(["cancel", "status", "commit"]);
        exact(o, [...base, "preparedBinding"]); binding(o.preparedBinding, true); break;
      case "UNKNOWN_EXPIRED":
        allowed(["status", "cancel", "commit", "ack"]); exact(o, base); break;
      default: invalid();
    }
  }
  return o as unknown as Acw1Response;
}
export function parseAcw1Error(operation: Acw1Operation, input: Acj1Input): Acw1ErrorResponse {
  const o = raw(input, 16384); header(o, operation); exact(o, ["profile", "operation", "error"]);
  const e = object(o.error); exact(e, ["code"]);
  if (!Object.hasOwn(ACW1_ERROR_HTTP, str(e.code))) invalid();
  return o as unknown as Acw1ErrorResponse;
}

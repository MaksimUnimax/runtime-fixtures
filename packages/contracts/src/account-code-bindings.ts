/**
 * ACW1 public byte bindings, FINAL v2 §§4/7; additive to accepted b82 codecs.
 * Outputs are UNVERIFIED data, never a principal, signature or access decision.
 * No HMAC, key creation, ECDSA/ECDH/HKDF/AEAD, storage or publication is done.
 * Callers must not log inputs, transcripts or result/request digests. Real raw
 * credentials are outside this slice's execution; units use public fixtures.
 */
import {
  type Acj1Input, encodeAcj1, parseAcj1, decodeBase64url,
  encodeBase64url, frameAcw1, utf8Bytes,
} from "./account-code-acj1.js";
import {
  type Acw1CredentialPlaintext, parseAcw1Request, parseAcw1Response,
  parseAcw1CredentialPlaintext, parseAcw1Envelope,
} from "./account-code-wire.js";

export type Acw1DigestPurpose = "key-thumbprint" | "prepared-binding" | "request" | "result";
export interface Acw1UnverifiedDigest<P extends Acw1DigestPurpose = Acw1DigestPurpose> {
  readonly profile: "ACW1";
  readonly verification: "UNVERIFIED";
  readonly purpose: P;
  readonly digest: string;
}
export type Acw1AttemptBindingOperation = "prepare" | "commit" | "cancel" | "status" | "ack";
export interface Acw1PreparedExpectedContext {
  attemptId: string; codeId: string; accountId: string; codeRevision: number;
  actorUserId: string; proofThumbprint: string; recipientThumbprint: string;
}
type RequestBaseContext = { attemptId: string; serverNonce: string };
export interface Acw1RequestBindingContexts {
  prepare: RequestBaseContext;
  commit: RequestBaseContext & { preparedBinding: string };
  cancel: RequestBaseContext & { preparedBinding: string | null };
  status: RequestBaseContext & { preparedBinding: string | null };
  ack: RequestBaseContext & { preparedBinding: string; resultId: string; resultDigest: string };
}
export interface Acw1UnverifiedRequestBinding {
  readonly profile: "ACW1"; readonly verification: "UNVERIFIED";
  readonly operation: Acw1AttemptBindingOperation;
  readonly requestHash: Acw1UnverifiedDigest<"request">;
  /** Exact T, not SHA256(T): a future ECDSA implementation hashes T once. */
  readonly proofTranscript: Uint8Array;
}
export type Acw1ResultExpectedContext = Omit<Acw1CredentialPlaintext, "accessToken" | "refreshToken">;
export interface Acw1ReceiptKeyContext { proofThumbprint: string; recipientThumbprint: string }

/** Local helper error only; not a new ACW1 HTTP error alias. No input echo. */
export class Acw1BindingError extends Error {
  readonly code = "ACW1_PUBLIC_BINDING_INVALID";
  constructor() { super("ACW1_PUBLIC_BINDING_INVALID"); this.name = "Acw1BindingError"; }
}
function invalid(): never { throw new Acw1BindingError(); }
type Obj = Record<string, unknown>;
function object(value: unknown): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Obj;
}
function exact(value: Obj, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) invalid();
}
function snapshot(value: unknown): Obj {
  // No getters/coercion; own data copy also prevents async context mutation.
  return object(parseAcj1(encodeAcj1(value, 16384), 16384));
}
function str(value: unknown): string { if (typeof value !== "string") invalid(); return value; }
function int(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) ||
      Object.is(value, -0) || value < 0 || value > max) invalid();
  return value;
}
function same(a: unknown, b: unknown): void { if (a !== b) invalid(); }
function digestBytes(value: unknown): Uint8Array { return decodeBase64url(str(value), 32); }
function sameDigest(a: unknown, b: unknown): void {
  const left = digestBytes(a), right = digestBytes(b);
  let difference = 0;
  for (let i = 0; i < 32; i++) difference |= left[i]! ^ right[i]!;
  if (difference !== 0) invalid();
  // Fixed-width comparison; no claim about JIT-level constant-time execution.
}
function op(value: unknown): Acw1AttemptBindingOperation {
  if (!["prepare", "commit", "cancel", "status", "ack"].includes(str(value))) invalid();
  return value as Acw1AttemptBindingOperation;
}

export function acw1IdBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(str(value))) invalid();
  const hex = value.replace(/-/g, "");
  return Uint8Array.from({ length: 16 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}
export function acw1U32(value: number): Uint8Array {
  const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, int(value, 0xffffffff), false);
  return out;
}
/** u64 encoding of an ACW1 JSON Int. BigInt/non-safe JSON numbers are rejected. */
export function acw1U64(value: number): Uint8Array {
  const out = new Uint8Array(8); new DataView(out.buffer).setBigUint64(0, BigInt(int(value)), false);
  return out;
}
async function hash<P extends Acw1DigestPurpose>(purpose: P, ...fields: Uint8Array[]): Promise<Acw1UnverifiedDigest<P>> {
  const transcript = frameAcw1(purpose, ...fields);
  if (!globalThis.crypto?.subtle) invalid();
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(transcript).buffer));
  return Object.freeze({ profile: "ACW1", verification: "UNVERIFIED", purpose, digest: encodeBase64url(bytes) });
}

/** Candidate byte hash only. The normative on-curve/non-infinity prerequisite
 * remains unperformed and must precede use as a protocol key thumbprint.
 */
export async function acw1UnverifiedKeyThumbprint(input: Acj1Input): Promise<
  Acw1UnverifiedDigest<"key-thumbprint"> & { readonly onCurveChecked: false }
> {
  const key = object(parseAcj1(input)); exact(key, ["crv", "kty", "x", "y"]);
  same(key.crv, "P-256"); same(key.kty, "EC"); digestBytes(key.x); digestBytes(key.y);
  const result = await hash("key-thumbprint", encodeAcj1(key));
  return Object.freeze({ ...result, onCurveChecked: false });
}

const preparedContextKeys = ["attemptId", "codeId", "accountId", "codeRevision",
  "actorUserId", "proofThumbprint", "recipientThumbprint"] as const;
export async function acw1PreparedBinding(
  input: Acj1Input, expected: Acw1PreparedExpectedContext, expectedBinding?: string,
): Promise<Acw1UnverifiedDigest<"prepared-binding">> {
  const p = object(parseAcj1(input)), ctx = snapshot(expected); exact(ctx, preparedContextKeys);
  // Strict P/Client and consent consistency must precede fingerprinting. Reuse
  // the accepted validator with a fixed public shape-only binding placeholder.
  // This local envelope is never returned/published or treated as a computed
  // binding, response, or PREPARED transition; its validation result is ignored.
  parseAcw1Response("prepare", encodeAcj1({ profile: "ACW1", operation: "prepare",
    state: "PREPARED", attemptId: p.attemptId, prepared: p,
    preparedBinding: encodeBase64url(new Uint8Array(32)) }, 16384),
  { attemptId: str(ctx.attemptId), accountId: str(ctx.accountId) });
  for (const key of preparedContextKeys) {
    if (key.endsWith("Thumbprint")) sameDigest(p[key], ctx[key]); else same(p[key], ctx[key]);
  }
  if (expectedBinding !== undefined) digestBytes(expectedBinding);
  const canonical = encodeAcj1(p);
  const result = await hash("prepared-binding", canonical);
  if (expectedBinding !== undefined) sameDigest(result.digest, expectedBinding);
  return result;
}

export function acw1RequestProofTranscript(
  operation: Acw1AttemptBindingOperation, attemptId: string, serverNonce: string,
  requestHash: Acw1UnverifiedDigest<"request">,
): Uint8Array {
  op(operation); const h = snapshot(requestHash);
  exact(h, ["profile", "verification", "purpose", "digest"]);
  same(h.profile, "ACW1"); same(h.verification, "UNVERIFIED"); same(h.purpose, "request");
  return frameAcw1("request-proof", utf8Bytes(operation), acw1IdBytes(attemptId),
    digestBytes(serverNonce), digestBytes(h.digest));
}

/** Receiver-side helper over the complete raw request. Proof is structurally
 * parsed, then excluded from U. This does not verify it. A future pre-signing
 * caller must preserve the same strict raw/DTO boundary, not invent a proof.
 */
export async function acw1RequestBinding<O extends Acw1AttemptBindingOperation>(
  operation: O, input: Acj1Input, expected: Acw1RequestBindingContexts[O],
): Promise<Acw1UnverifiedRequestBinding> {
  op(operation); const ctx = snapshot(expected);
  const keys = ["attemptId", "serverNonce"];
  if (operation !== "prepare") keys.push("preparedBinding");
  if (operation === "ack") keys.push("resultId", "resultDigest");
  exact(ctx, keys); acw1IdBytes(str(ctx.attemptId)); digestBytes(ctx.serverNonce);
  const request = parseAcw1Request(operation, input, { attemptId: str(ctx.attemptId) });
  const req = request as unknown as Obj;
  const payload = object(parseAcj1(decodeBase64url(str(req.ticket).split(".")[0]!)));
  sameDigest(payload.serverNonce, ctx.serverNonce);
  if (operation !== "prepare") {
    if (ctx.preparedBinding !== null) digestBytes(ctx.preparedBinding);
    if (operation === "commit" || operation === "ack") digestBytes(ctx.preparedBinding);
    // A lost PREPARED response may legitimately leave client status/cancel null.
    if (req.preparedBinding !== null) sameDigest(req.preparedBinding, ctx.preparedBinding);
  }
  if (operation === "ack") {
    acw1IdBytes(str(ctx.resultId)); same(req.resultId, ctx.resultId);
    sameDigest(req.resultDigest, ctx.resultDigest);
  }
  const unsigned = Object.fromEntries(Object.entries(req).filter(([key]) => key !== "proof"));
  const requestHash = await hash("request", utf8Bytes(operation), acw1IdBytes(str(ctx.attemptId)), encodeAcj1(unsigned));
  const proofTranscript = acw1RequestProofTranscript(operation, str(ctx.attemptId), str(ctx.serverNonce), requestHash);
  return Object.freeze({ profile: "ACW1", verification: "UNVERIFIED", operation, requestHash, proofTranscript });
}
/** ACK has the same normative request/request-proof domains, no new ack label. */
export function acw1AckBinding(input: Acj1Input, expected: Acw1RequestBindingContexts["ack"]): Promise<Acw1UnverifiedRequestBinding> {
  return acw1RequestBinding("ack", input, expected);
}

const resultContextKeys = ["profile", "resultId", "attemptId", "preparedBinding", "accountId",
  "actorUserId", "deviceId", "sessionId", "accessBasis", "deviceCreatedAt", "sessionCreatedAt",
  "grantIssuedAt", "accessExpiresAt", "refreshExpiresAt", "initialRefreshGeneration"] as const;
function resultContext(c: Obj, ctx: Obj): void {
  exact(ctx, resultContextKeys);
  for (const key of resultContextKeys) {
    if (key === "preparedBinding") sameDigest(c[key], ctx[key]); else same(c[key], ctx[key]);
  }
}
export async function acw1ResultBinding(
  input: Acj1Input, expected: Acw1ResultExpectedContext, expectedDigest?: string,
): Promise<Acw1UnverifiedDigest<"result">> {
  const c = parseAcw1CredentialPlaintext(input), ctx = snapshot(expected);
  resultContext(c as unknown as Obj, ctx);
  const result = await hash("result", encodeAcj1(c));
  if (expectedDigest !== undefined) sameDigest(result.digest, expectedDigest);
  return result; // No C or credentials returned, logged or retained.
}
/** Public equality only. This must not be used as an AEAD/authentication gate,
 * credential save, ACK permission, or substitute for lifecycle/authority checks.
 */
export async function acw1CheckResultEnvelopeBindings(
  input: Acj1Input, envelope: unknown, expected: Acw1ResultExpectedContext,
  expectedKeys: Acw1ReceiptKeyContext,
): Promise<Acw1UnverifiedDigest<"result">> {
  const e = parseAcw1Envelope(snapshot(envelope)), keys = snapshot(expectedKeys);
  exact(keys, ["proofThumbprint", "recipientThumbprint"]);
  sameDigest(e.aad.proofThumbprint, keys.proofThumbprint);
  sameDigest(e.aad.recipientThumbprint, keys.recipientThumbprint);
  const c = parseAcw1CredentialPlaintext(input), ctx = snapshot(expected);
  resultContext(c as unknown as Obj, ctx);
  for (const key of resultContextKeys) {
    if (key === "preparedBinding") sameDigest(c[key], e.aad[key]); else same(c[key], e.aad[key]);
  }
  const result = await hash("result", encodeAcj1(c));
  sameDigest(result.digest, e.aad.resultDigest);
  return result;
}

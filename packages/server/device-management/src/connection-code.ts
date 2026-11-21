import { createHmac, hkdfSync, randomBytes } from "node:crypto";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_MS,
  deriveExtensionAuthKeys,
  issueAccessToken,
  refreshTokenHash,
  type AccessTokenSigningKey,
} from "@product/extension-auth";
import type { DeviceLimitResolver } from "./index.js";

/** A connection code authorizes enrollment, never a shared extension session. */
export const CONNECTION_CODE_PREFIX = "octo1_";
export const CONNECTION_OWNER_FRESHNESS_MS = 5 * 60_000;
export const CONNECTION_EXCHANGE_REPLAY_MS = 2 * 60_000;
export const CONNECTION_RATE_WINDOW_MS = 10 * 60_000;
export const CONNECTION_EXCHANGE_IP_LIMIT = 120;
export const CONNECTION_ISSUE_OWNER_LIMIT = 10;

const salt = Buffer.from("octoport/connection-enrollment/hkdf-salt/v1");
const labels = {
  verifier: "octoport/connection-enrollment/verifier/v1",
  operation: "octoport/connection-enrollment/operation/v1",
  fingerprint: "octoport/connection-enrollment/fingerprint/v1",
  initialRefresh: "octoport/connection-enrollment/initial-refresh/v1",
  rate: "octoport/connection-enrollment/rate/v1",
} as const;
export type ConnectionCodeKeys = Record<keyof typeof labels, Buffer>;
export function deriveConnectionCodeKeys(root: Buffer): ConnectionCodeKeys {
  if (root.length !== 32)
    throw new Error("authentication root secret must be 32 bytes");
  return Object.fromEntries(
    Object.entries(labels).map(([name, label]) => [
      name,
      Buffer.from(hkdfSync("sha256", root, salt, label, 32)),
    ]),
  ) as ConnectionCodeKeys;
}
/** Length-delimited, purpose-separated values; no raw code/IP in persistence. */
function digest(
  key: Buffer,
  purpose: string,
  parts: readonly string[],
): string {
  const hmac = createHmac("sha256", key).update("v1:" + purpose + ":");
  for (const part of parts) {
    const bytes = Buffer.from(part, "utf8");
    hmac.update(String(bytes.length) + ":").update(bytes);
  }
  return hmac.digest("base64url");
}
export function generateConnectionCode(
  bytes: Buffer = randomBytes(32),
): string {
  if (bytes.length !== 32) throw new Error("connection code needs 32 bytes");
  return CONNECTION_CODE_PREFIX + bytes.toString("base64url");
}
export function validConnectionCode(value: unknown): value is string {
  if (typeof value !== "string" || !/^octo1_[A-Za-z0-9_-]{43}$/.test(value))
    return false;
  const encoded = value.slice(CONNECTION_CODE_PREFIX.length);
  const decoded = Buffer.from(encoded, "base64url");
  return decoded.length === 32 && decoded.toString("base64url") === encoded;
}
export function connectionCodeVerifier(keys: ConnectionCodeKeys, code: string) {
  if (!validConnectionCode(code)) throw new Error("invalid connection code");
  return "v1:" + digest(keys.verifier, "code", [code]);
}
export function connectionOperationHash(
  keys: ConnectionCodeKeys,
  purpose: "issue" | "exchange",
  idempotencyKey: string,
) {
  return "v1:" + digest(keys.operation, purpose, [idempotencyKey]);
}
export function connectionRefreshToken(
  keys: ConnectionCodeKeys,
  code: string,
  idempotencyKey: string,
) {
  return digest(keys.initialRefresh, "initial-refresh", [code, idempotencyKey]);
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const validConnectionOperationKey = (key: unknown): key is string =>
  typeof key === "string" && /^[A-Za-z0-9._:-]{16,128}$/.test(key);
const validDeviceLabel = (label: unknown): label is string | undefined =>
  label === undefined ||
  (typeof label === "string" &&
    label.length >= 1 &&
    label.length <= 80 &&
    !/\p{Cc}/u.test(label));

/** Only constructed from an authenticated portal session, never a request body. */
export interface ConnectionPortalPrincipal {
  userId: string;
  sessionId: string;
  authenticatedAt: Date;
}
export type ConnectionReplacementMode =
  | "CREATE"
  | "REPLACE_KEEP_DEVICES"
  | "REPLACE_REVOKE_DEVICES";
export interface ConnectionCredentialSummary {
  credentialId: string;
  generation: number;
  createdAt: Date;
  active: boolean;
}
export interface ConnectionCodeRepository {
  listTransferDevices(input: {
    accountId: string;
    portalUserId: string;
    portalSessionId: string;
    now: Date;
  }): Promise<
    | {
        kind: "ok";
        devices: Array<{
          deviceId: string;
          label: string | null;
          createdAt: Date;
          approvedAt: Date | null;
        }>;
      }
    | { kind: "forbidden" }
  >;
  approveTransfer(input: {
    accountId: string;
    deviceId: string;
    portalUserId: string;
    portalSessionId: string;
    now: Date;
    freshAfter: Date;
    correlationId: string;
  }): Promise<
    | { kind: "approved"; deviceId: string; approvedAt: Date }
    | { kind: "forbidden" | "reauth-required" | "not-found" }
  >;

  consumeRate(input: {
    action:
      | "CONNECTION_ISSUE_OWNER"
      | "CONNECTION_EXCHANGE_IP"
      | "CONNECTION_TRANSFER_APPROVAL_OWNER";
    keyHash: string;
    now: Date;
    limit: number;
    windowMs: number;
  }): Promise<{ allowed: boolean; retryAfterSeconds?: number }>;
  /** Revalidate the current portal session, active owner and account. */
  status(input: {
    accountId: string;
    portalUserId: string;
    portalSessionId: string;
    now: Date;
  }): Promise<
    | { kind: "ok"; credential: ConnectionCredentialSummary | null }
    | { kind: "forbidden" }
  >;
  /** Account-serialized transaction; replay never reveals the code again. */
  issue(input: {
    accountId: string;
    portalUserId: string;
    portalSessionId: string;
    freshAfter: Date;
    verifierHash: string;
    operationHash: string;
    requestFingerprint: string;
    expectedGeneration: number;
    mode: ConnectionReplacementMode;
    now: Date;
    correlationId: string;
  }): Promise<
    | {
        kind: "created";
        credential: ConnectionCredentialSummary;
        revokedDevices: number;
      }
    | { kind: "already-issued"; credential: ConnectionCredentialSummary }
    | { kind: "forbidden" | "reauth-required" | "conflict" }
  >;
  /**
   * Serialize with issue/revoke; derive account/owner from the active verifier.
   * Replay requires active credential/device/session and the original unconsumed
   * refresh token. Never recreate an expired receipt.
   */
  exchange(input: {
    verifierHash: string;
    operationHash: string;
    requestFingerprint: string;
    refreshTokenHash: string;
    deviceLabel: string | null;
    now: Date;
    replayUntil: Date;
    refreshTokenExpiresAt: Date;
    correlationId: string;
    resolveLimit: DeviceLimitResolver["resolve"];
  }): Promise<
    | {
        kind: "activated" | "replay";
        accountId: string;
        deviceId: string;
        sessionId: string;
        refreshTokenExpiresAt: Date;
      }
    | {
        kind:
          | "closed"
          | "conflict"
          | "limit"
          | "subscription-required"
          | "invalid-limit";
      }
  >;
}
export class ConnectionCodeService {
  private readonly keys: ConnectionCodeKeys;
  constructor(
    private readonly repository: ConnectionCodeRepository,
    private readonly root: Buffer,
    private readonly signingKey: AccessTokenSigningKey,
    private readonly limits: DeviceLimitResolver,
    private readonly now: () => Date = () => new Date(),
    private readonly random: () => Buffer = () => randomBytes(32),
  ) {
    this.keys = deriveConnectionCodeKeys(root);
  }
  private validPrincipal(principal: ConnectionPortalPrincipal) {
    return (
      uuid.test(principal.userId) &&
      uuid.test(principal.sessionId) &&
      principal.authenticatedAt instanceof Date &&
      Number.isFinite(principal.authenticatedAt.getTime())
    );
  }
  async status(accountId: string, principal: ConnectionPortalPrincipal) {
    if (!uuid.test(accountId) || !this.validPrincipal(principal))
      return { kind: "INVALID" as const };
    return this.repository.status({
      accountId,
      portalUserId: principal.userId,
      portalSessionId: principal.sessionId,
      now: this.now(),
    });
  }

  async listTransferDevices(
    accountId: string,
    principal: ConnectionPortalPrincipal,
  ) {
    if (!uuid.test(accountId) || !this.validPrincipal(principal))
      return { kind: "INVALID" as const };
    return this.repository.listTransferDevices({
      accountId,
      portalUserId: principal.userId,
      portalSessionId: principal.sessionId,
      now: this.now(),
    });
  }
  async approveTransfer(
    input: { accountId: string; deviceId: string },
    principal: ConnectionPortalPrincipal,
    correlationId: string,
  ) {
    if (
      !uuid.test(input.accountId) ||
      !uuid.test(input.deviceId) ||
      !this.validPrincipal(principal)
    )
      return { kind: "INVALID" as const };
    const now = this.now();
    const age = now.getTime() - principal.authenticatedAt.getTime();
    if (age < 0 || age > CONNECTION_OWNER_FRESHNESS_MS)
      return { kind: "REAUTH_REQUIRED" as const };
    const rate = await this.repository.consumeRate({
      action: "CONNECTION_TRANSFER_APPROVAL_OWNER",
      keyHash:
        "v1:" + digest(this.keys.rate, "transfer-owner", [principal.userId]),
      now,
      limit: CONNECTION_ISSUE_OWNER_LIMIT,
      windowMs: CONNECTION_RATE_WINDOW_MS,
    });
    if (!rate.allowed)
      return { kind: "RATE_LIMITED" as const, ...retryAfter(rate) };
    const result = await this.repository.approveTransfer({
      ...input,
      portalUserId: principal.userId,
      portalSessionId: principal.sessionId,
      now,
      freshAfter: new Date(now.getTime() - CONNECTION_OWNER_FRESHNESS_MS),
      correlationId,
    });
    if (result.kind === "approved")
      return {
        kind: "APPROVED" as const,
        deviceId: result.deviceId,
        approvedAt: result.approvedAt,
      };
    if (result.kind === "reauth-required")
      return { kind: "REAUTH_REQUIRED" as const };
    if (result.kind === "not-found") return { kind: "NOT_FOUND" as const };
    return { kind: "FORBIDDEN" as const };
  }

  async issue(
    input: {
      accountId: string;
      expectedGeneration: number;
      mode: ConnectionReplacementMode;
      idempotencyKey: string;
    },
    principal: ConnectionPortalPrincipal,
    correlationId: string,
  ) {
    if (
      !uuid.test(input.accountId) ||
      !this.validPrincipal(principal) ||
      !validConnectionOperationKey(input.idempotencyKey) ||
      !Number.isSafeInteger(input.expectedGeneration) ||
      input.expectedGeneration < 0 ||
      !["CREATE", "REPLACE_KEEP_DEVICES", "REPLACE_REVOKE_DEVICES"].includes(
        input.mode,
      ) ||
      (input.mode === "CREATE") !== (input.expectedGeneration === 0)
    )
      return { kind: "INVALID" as const };
    const now = this.now();
    const age = now.getTime() - principal.authenticatedAt.getTime();
    if (age < 0 || age > CONNECTION_OWNER_FRESHNESS_MS)
      return { kind: "REAUTH_REQUIRED" as const };
    const rate = await this.repository.consumeRate({
      action: "CONNECTION_ISSUE_OWNER",
      keyHash:
        "v1:" + digest(this.keys.rate, "issue-owner", [principal.userId]),
      now,
      limit: CONNECTION_ISSUE_OWNER_LIMIT,
      windowMs: CONNECTION_RATE_WINDOW_MS,
    });
    if (!rate.allowed)
      return { kind: "RATE_LIMITED" as const, ...retryAfter(rate) };
    const code = generateConnectionCode(this.random());
    const result = await this.repository.issue({
      accountId: input.accountId,
      portalUserId: principal.userId,
      portalSessionId: principal.sessionId,
      freshAfter: new Date(now.getTime() - CONNECTION_OWNER_FRESHNESS_MS),
      verifierHash: connectionCodeVerifier(this.keys, code),
      operationHash: connectionOperationHash(
        this.keys,
        "issue",
        input.idempotencyKey,
      ),
      requestFingerprint:
        "v1:" +
        digest(this.keys.fingerprint, "issue", [
          input.accountId,
          String(input.expectedGeneration),
          input.mode,
        ]),
      expectedGeneration: input.expectedGeneration,
      mode: input.mode,
      now,
      correlationId,
    });
    if (result.kind === "created")
      return {
        kind: "CREATED" as const,
        code,
        credential: result.credential,
        revokedDevices: result.revokedDevices,
      };
    if (result.kind === "already-issued")
      return { kind: "ALREADY_ISSUED" as const, credential: result.credential };
    if (result.kind === "reauth-required")
      return { kind: "REAUTH_REQUIRED" as const };
    return {
      kind:
        result.kind === "forbidden"
          ? ("FORBIDDEN" as const)
          : ("CONFLICT" as const),
    };
  }
  async exchange(
    input: { code: string; idempotencyKey: string; deviceLabel?: string },
    peerIp: string,
    correlationId: string,
  ) {
    if (
      !validConnectionCode(input.code) ||
      !validConnectionOperationKey(input.idempotencyKey) ||
      !validDeviceLabel(input.deviceLabel)
    )
      return { kind: "INVALID" as const };
    const now = this.now();
    const rate = await this.repository.consumeRate({
      action: "CONNECTION_EXCHANGE_IP",
      keyHash: "v1:" + digest(this.keys.rate, "exchange-ip", [peerIp]),
      now,
      limit: CONNECTION_EXCHANGE_IP_LIMIT,
      windowMs: CONNECTION_RATE_WINDOW_MS,
    });
    if (!rate.allowed)
      return { kind: "RATE_LIMITED" as const, ...retryAfter(rate) };
    const refreshToken = connectionRefreshToken(
      this.keys,
      input.code,
      input.idempotencyKey,
    );
    const result = await this.repository.exchange({
      verifierHash: connectionCodeVerifier(this.keys, input.code),
      operationHash: connectionOperationHash(
        this.keys,
        "exchange",
        input.idempotencyKey,
      ),
      requestFingerprint:
        "v1:" +
        digest(this.keys.fingerprint, "exchange", [input.deviceLabel ?? ""]),
      refreshTokenHash: refreshTokenHash(
        deriveExtensionAuthKeys(this.root),
        refreshToken,
      ),
      deviceLabel: input.deviceLabel ?? null,
      now,
      replayUntil: new Date(now.getTime() + CONNECTION_EXCHANGE_REPLAY_MS),
      refreshTokenExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
      correlationId,
      resolveLimit: this.limits.resolve.bind(this.limits),
    });
    if (result.kind === "closed") return { kind: "CLOSED" as const };
    if (result.kind === "conflict") return { kind: "CONFLICT" as const };
    if (result.kind === "limit")
      return { kind: "DEVICE_LIMIT_REACHED" as const };
    if (result.kind === "subscription-required")
      return { kind: "SUBSCRIPTION_REQUIRED" as const };
    if (result.kind === "invalid-limit")
      return { kind: "SERVICE_UNAVAILABLE" as const };
    if (result.kind !== "activated" && result.kind !== "replay")
      return { kind: "SERVICE_UNAVAILABLE" as const };
    if (
      !uuid.test(result.accountId) ||
      !uuid.test(result.deviceId) ||
      !uuid.test(result.sessionId) ||
      !(result.refreshTokenExpiresAt instanceof Date) ||
      !Number.isFinite(result.refreshTokenExpiresAt.getTime()) ||
      result.refreshTokenExpiresAt <= now
    )
      return { kind: "SERVICE_UNAVAILABLE" as const };
    return {
      kind: "ACTIVATED" as const,
      accountId: result.accountId,
      deviceId: result.deviceId,
      sessionId: result.sessionId,
      refreshToken,
      accessToken: await issueAccessToken(
        this.signingKey,
        {
          accountId: result.accountId,
          deviceId: result.deviceId,
          sessionId: result.sessionId,
        },
        now,
      ),
      accessTokenExpiresAt: new Date(
        now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000,
      ),
      // Keep the original durable expiry on replay, never extend it by 30 days.
      refreshTokenExpiresAt: result.refreshTokenExpiresAt,
      replay: result.kind === "replay",
    };
  }
}
function retryAfter(value: { retryAfterSeconds?: number }) {
  return Number.isSafeInteger(value.retryAfterSeconds) &&
    value.retryAfterSeconds! > 0
    ? { retryAfterSeconds: value.retryAfterSeconds! }
    : {};
}

import type { BrowserFamily } from "@product/shared";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

const salt = Buffer.from("product-control-plane/device-auth/hkdf-salt/v1");
const labels = {
  deviceCode: "product-control-plane/device-auth/device-code/v1",
  userCode: "product-control-plane/device-auth/user-code/v1",
  idempotency: "product-control-plane/device-auth/idempotency/v1",
  rateLimit: "product-control-plane/device-auth/rate-limit/v1",
  envelope: "product-control-plane/device-auth/start-envelope/v1",
} as const;
export const DEVICE_AUTH_TTL_MS = 10 * 60_000;
/** Includes the initial code pair generation for one logical start operation. */
export const MAX_CODE_GENERATION_ATTEMPTS = 8;
export const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export type DeviceAuthKeys = Record<keyof typeof labels, Buffer>;
export type DeviceAuthorizationStatus =
  | "PENDING"
  | "APPROVED"
  | "DENIED"
  | "EXPIRED"
  | "EXCHANGED";
export interface StartEnvelope {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
}
export interface StartSecrets {
  deviceCode: string;
  userCode: string;
}
export type DeviceClientMetadata =
  | { state: "WITHHELD" }
  | {
      state: "PRESENT";
      browserFamily: BrowserFamily;
      browserVersion: string | null;
      extensionVersion: string;
    };
export type DeviceAuthorizationStartInput =
  | {
      clientType: "browser_extension";
      browserFamily: BrowserFamily;
      browserVersion?: string;
      extensionVersion: string;
      deviceLabel?: string;
    }
  | {
      clientType: "browser_extension";
      browserFamily?: never;
      browserVersion?: never;
      extensionVersion?: never;
      deviceLabel?: string;
    };
export interface DeviceAuthorizationRecord {
  id: string;
  status: DeviceAuthorizationStatus;
  idempotencyKeyHash: string;
  requestFingerprint: string;
  deviceCodeHash: string;
  userCodeHash: string;
  expiresAt: Date;
  approvedAccountId?: string | null;
  browserFamily?: BrowserFamily;
  browserVersion?: string;
  extensionVersion?: string;
  deviceLabel?: string | null;
  approvedUserId?: string | null;
  approvedAt?: Date | null;
  deniedAt?: Date | null;
  expiredAt?: Date | null;
  envelope?: StartEnvelope | null;
}
export type DeviceAuthFailure =
  | "SERVICE_UNAVAILABLE"
  | "DEVICE_AUTH_RATE_LIMITED"
  | "DEVICE_AUTH_INVALID"
  | "DEVICE_AUTH_FORBIDDEN"
  | "DEVICE_AUTH_STATE_CONFLICT"
  | "DEVICE_AUTH_IDEMPOTENCY_CONFLICT"
  | "DEVICE_AUTH_CLOSED";
export type DeviceAuthRepositoryFailure =
  | DeviceAuthFailure
  | "DEVICE_AUTH_COLLISION";
export type DeviceAuthResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: DeviceAuthFailure };
type DeviceAuthRepositoryResult<T> =
  | DeviceAuthResult<T>
  | { ok: false; code: "DEVICE_AUTH_COLLISION" };
export interface DeviceAuthorizationRepository {
  previewPendingAuthorization(
    id: string,
    now: Date,
  ): Promise<
    | {
        id: string;
        clientMetadata: DeviceClientMetadata;
        browserFamily?: BrowserFamily;
        browserVersion?: string | null;
        extensionVersion?: string;
        deviceLabel: string | null;
        expiresAt: Date;
      }
    | undefined
  >;
  start(input: {
    record: DeviceAuthorizationRecord;
    ipKey: string;
    correlationId: string;
  }): Promise<
    DeviceAuthRepositoryResult<{
      record: DeviceAuthorizationRecord;
      replay: boolean;
    }>
  >;
  approve(input: {
    id: string;
    userCodeHash: string;
    userId: string;
    accountId: string;
    userRateKey: string;
    ipRateKey: string;
    correlationId: string;
  }): Promise<
    DeviceAuthRepositoryResult<{ record: DeviceAuthorizationRecord }>
  >;
  deny(input: {
    id: string;
    userCodeHash: string;
    userId: string;
    userRateKey: string;
    ipRateKey: string;
    correlationId: string;
  }): Promise<
    DeviceAuthRepositoryResult<{ record: DeviceAuthorizationRecord }>
  >;
  expireDue(batchSize: number, correlationId: string): Promise<number>;
}
export function deriveDeviceAuthKeys(root: Buffer): DeviceAuthKeys {
  if (root.length !== 32)
    throw new Error("authentication root secret must be 32 bytes");
  return Object.fromEntries(
    Object.entries(labels).map(([k, v]) => [
      k,
      Buffer.from(hkdfSync("sha256", root, salt, v, 32)),
    ]),
  ) as DeviceAuthKeys;
}
function artifact(key: Buffer, purpose: string, value: string): string {
  const valueBytes = Buffer.from(value, "utf8");
  const h = createHmac("sha256", key);
  h.update(Buffer.from(`v1:${purpose}:${valueBytes.length}:`, "utf8"));
  h.update(valueBytes);
  return `v1:${h.digest("base64url")}`;
}
function validArtifact(value: string): boolean {
  return /^v1:[A-Za-z0-9_-]{43}$/.test(value);
}
export function equalArtifact(left: string, right: string): boolean {
  try {
    const a = Buffer.from(left),
      b = Buffer.from(right);
    return (
      validArtifact(left) &&
      validArtifact(right) &&
      a.length === b.length &&
      timingSafeEqual(a, b)
    );
  } catch {
    return false;
  }
}
export const deviceCodeArtifact = (keys: DeviceAuthKeys, code: string) =>
  artifact(keys.deviceCode, "device-code", code);
export const userCodeArtifact = (keys: DeviceAuthKeys, code: string) =>
  artifact(keys.userCode, "user-code", canonicalUserCode(code) ?? "");
export const idempotencyKeyArtifact = (keys: DeviceAuthKeys, value: string) =>
  artifact(keys.idempotency, "idempotency-key", value);
export const rateLimitKey = (keys: DeviceAuthKeys, value: string) =>
  artifact(keys.rateLimit, "rate-limit", value);
export function generateDeviceCode(bytes: Buffer = randomBytes(32)): string {
  if (bytes.length !== 32) throw new Error("device code needs 32 bytes");
  return bytes.toString("base64url");
}
export function canonicalUserCode(value: string): string | undefined {
  const upper = value.toUpperCase();
  if (/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(upper)) return upper;
  if (
    /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/.test(
      upper,
    )
  )
    return upper.replace("-", "");
  return undefined;
}
export function displayUserCode(value: string): string {
  const code = canonicalUserCode(value);
  if (!code) throw new Error("invalid user code");
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
export function generateUserCode(
  rng: (max: number) => number = (max) => randomInt(max),
): string {
  return Array.from(
    { length: 8 },
    () => USER_CODE_ALPHABET[rng(USER_CODE_ALPHABET.length)],
  ).join("");
}
export function validIdempotencyKey(
  value: string | undefined,
): value is string {
  return !!value && /^[A-Za-z0-9._:-]{16,128}$/.test(value);
}
export function requestFingerprint(
  body: Record<string, string | undefined>,
): string {
  const ordered = [
    "clientType",
    "browserFamily",
    "browserVersion",
    "extensionVersion",
    "deviceLabel",
  ].map((key) => [key, body[key] ?? null]);
  return createHash("sha256")
    .update(JSON.stringify(ordered))
    .digest("base64url");
}
function aad(
  id: string,
  idempotencyHash: string,
  fingerprint: string,
  expiresAt: Date,
): Buffer {
  return Buffer.from(
    JSON.stringify([
      "v1",
      id,
      idempotencyHash,
      fingerprint,
      expiresAt.toISOString(),
    ]),
  );
}
export function encryptStartSecrets(
  keys: DeviceAuthKeys,
  id: string,
  idempotencyHash: string,
  fingerprint: string,
  expiresAt: Date,
  secrets: StartSecrets,
): StartEnvelope {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys.envelope, nonce);
  cipher.setAAD(aad(id, idempotencyHash, fingerprint, expiresAt));
  return {
    ciphertext: Buffer.concat([
      cipher.update(JSON.stringify(secrets), "utf8"),
      cipher.final(),
    ]),
    nonce,
    authTag: cipher.getAuthTag(),
  };
}
export function decryptStartSecrets(
  keys: DeviceAuthKeys,
  record: DeviceAuthorizationRecord,
): StartSecrets | undefined {
  try {
    const e = record.envelope;
    if (!e || e.nonce.length !== 12 || e.authTag.length !== 16)
      return undefined;
    const decipher = createDecipheriv("aes-256-gcm", keys.envelope, e.nonce);
    decipher.setAAD(
      aad(
        record.id,
        record.idempotencyKeyHash,
        record.requestFingerprint,
        record.expiresAt,
      ),
    );
    decipher.setAuthTag(e.authTag);
    const parsed: unknown = JSON.parse(
      Buffer.concat([decipher.update(e.ciphertext), decipher.final()]).toString(
        "utf8",
      ),
    );
    if (!parsed || typeof parsed !== "object") return undefined;
    const x = parsed as StartSecrets;
    return /^[A-Za-z0-9_-]{43}$/.test(x.deviceCode) &&
      canonicalUserCode(x.userCode)
      ? { deviceCode: x.deviceCode, userCode: displayUserCode(x.userCode) }
      : undefined;
  } catch {
    return undefined;
  }
}
export function isTransitionAllowed(
  from: DeviceAuthorizationStatus,
  to: DeviceAuthorizationStatus,
): boolean {
  return (
    (from === "PENDING" &&
      (to === "APPROVED" || to === "DENIED" || to === "EXPIRED")) ||
    (from === "APPROVED" && to === "EXPIRED")
  );
}
export class DeviceAuthorizationService {
  constructor(
    private readonly repository: DeviceAuthorizationRepository,
    private readonly keys: DeviceAuthKeys,
    private readonly now: () => Date = () => new Date(),
    private readonly generateCodes: () => {
      deviceCode: string;
      rawUserCode: string;
    } = () => ({
      deviceCode: generateDeviceCode(),
      rawUserCode: generateUserCode(),
    }),
  ) {}
  async previewPendingAuthorization(id: string) {
    return this.repository.previewPendingAuthorization(id, this.now());
  }
  async start(
    body: DeviceAuthorizationStartInput,
    idempotencyKey: string,
    ip: string,
    correlationId: string,
  ): Promise<
    DeviceAuthResult<{
      status: "pending";
      authorizationId: string;
      deviceCode: string;
      userCode: string;
      expiresAt: Date;
    }>
  > {
    const idempotencyKeyHash = idempotencyKeyArtifact(
        this.keys,
        idempotencyKey,
      ),
      fingerprint = requestFingerprint(body),
      expiresAt = new Date(this.now().getTime() + DEVICE_AUTH_TTL_MS);
    for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt++) {
      const id = crypto.randomUUID(),
        { deviceCode, rawUserCode } = this.generateCodes(),
        userCode = displayUserCode(rawUserCode);
      const record: DeviceAuthorizationRecord = {
        id,
        status: "PENDING",
        idempotencyKeyHash,
        requestFingerprint: fingerprint,
        deviceCodeHash: deviceCodeArtifact(this.keys, deviceCode),
        userCodeHash: userCodeArtifact(this.keys, rawUserCode),
        expiresAt,
        ...(body.browserFamily === undefined
          ? {}
          : {
              browserFamily: body.browserFamily,
              browserVersion: body.browserVersion,
              extensionVersion: body.extensionVersion,
            }),
        deviceLabel: body.deviceLabel,
        envelope: encryptStartSecrets(
          this.keys,
          id,
          idempotencyKeyHash,
          fingerprint,
          expiresAt,
          { deviceCode, userCode: rawUserCode },
        ),
      };
      const result = await this.repository.start({
        record,
        ipKey: rateLimitKey(this.keys, ip),
        correlationId,
      });
      if (!result.ok) {
        if (result.code === "DEVICE_AUTH_COLLISION") continue;
        return result;
      }
      const secrets = result.value.replay
        ? decryptStartSecrets(this.keys, result.value.record)
        : { deviceCode, userCode };
      if (!secrets) return { ok: false, code: "DEVICE_AUTH_CLOSED" };
      return {
        ok: true,
        value: {
          status: "pending",
          authorizationId: result.value.record.id,
          ...secrets,
          expiresAt: result.value.record.expiresAt,
        },
      };
    }
    // This is intentionally an existing fail-closed internal domain result.  The
    // delivery layer maps it to 503 without disclosing collision mechanics.
    return { ok: false, code: "SERVICE_UNAVAILABLE" };
  }
  async approve(
    id: string,
    accountId: string,
    userCode: string,
    userId: string,
    ip: string,
    correlationId: string,
  ): Promise<DeviceAuthResult<{ record: DeviceAuthorizationRecord }>> {
    const canonical = canonicalUserCode(userCode);
    if (!canonical) return { ok: false, code: "DEVICE_AUTH_INVALID" };
    const result = await this.repository.approve({
      id,
      accountId,
      userId,
      userCodeHash: userCodeArtifact(this.keys, canonical),
      userRateKey: rateLimitKey(this.keys, `user:${userId}`),
      ipRateKey: rateLimitKey(this.keys, `ip:${ip}`),
      correlationId,
    });
    return result.ok || result.code !== "DEVICE_AUTH_COLLISION"
      ? result
      : { ok: false, code: "DEVICE_AUTH_INVALID" };
  }
  async deny(
    id: string,
    userCode: string,
    userId: string,
    ip: string,
    correlationId: string,
  ): Promise<DeviceAuthResult<{ record: DeviceAuthorizationRecord }>> {
    const canonical = canonicalUserCode(userCode);
    if (!canonical) return { ok: false, code: "DEVICE_AUTH_INVALID" };
    const result = await this.repository.deny({
      id,
      userId,
      userCodeHash: userCodeArtifact(this.keys, canonical),
      userRateKey: rateLimitKey(this.keys, `user:${userId}`),
      ipRateKey: rateLimitKey(this.keys, `ip:${ip}`),
      correlationId,
    });
    return result.ok || result.code !== "DEVICE_AUTH_COLLISION"
      ? result
      : { ok: false, code: "DEVICE_AUTH_INVALID" };
  }
}

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

const salt = Buffer.from("product-control-plane/auth/hkdf-salt/v1");
const labels = {
  otp: "product-control-plane/auth/otp-verification/v1",
  rate: "product-control-plane/auth/rate-limit/v1",
  session: "product-control-plane/auth/portal-session/v1",
  csrf: "product-control-plane/auth/csrf/v1",
  delivery: "product-control-plane/auth/otp-delivery/v1",
} as const;
export const OTP_TTL_MS = 10 * 60_000,
  PORTAL_SESSION_TTL_MS = 7 * 24 * 60 * 60_000,
  OTP_MAX_ATTEMPTS = 5;
export type AuthKeys = Record<keyof typeof labels, Buffer>;
export function loadAuthRootSecret(environment: NodeJS.ProcessEnv): Buffer {
  const raw = environment.AUTH_ROOT_SECRET_B64;
  if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw))
    throw new Error("AUTH_ROOT_SECRET_B64 must be standard base64");
  const value = Buffer.from(raw, "base64");
  if (value.length !== 32 || value.toString("base64") !== raw)
    throw new Error("AUTH_ROOT_SECRET_B64 must decode to exactly 32 bytes");
  return value;
}
export function deriveAuthKeys(root: Buffer): AuthKeys {
  if (root.length !== 32)
    throw new Error("authentication root secret must be 32 bytes");
  return Object.fromEntries(
    Object.entries(labels).map(([name, label]) => [
      name,
      Buffer.from(hkdfSync("sha256", root, salt, label, 32)),
    ]),
  ) as AuthKeys;
}
export function normalizeEmail(input: string): string | undefined {
  const normalized = input.trim().normalize("NFC").toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)
  )
    return undefined;
  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  if (
    domain
      .split(".")
      .some((label) => !label || label.startsWith("-") || label.endsWith("-"))
  )
    return undefined;
  return normalized;
}
function hmac(key: Buffer, parts: string[]): string {
  const h = createHmac("sha256", key);
  for (const part of parts) {
    const b = Buffer.from(part);
    h.update(Buffer.from(`${b.length}:`));
    h.update(b);
  }
  return `v1:${h.digest("base64url")}`;
}
function safelyEqual(left: string, right: string): boolean {
  try {
    const a = Buffer.from(left),
      b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
export function generateOtp(
  rng: (min: number, max: number) => number = randomInt,
): string {
  return String(rng(0, 1_000_000)).padStart(6, "0");
}
export function otpArtifact(
  keys: AuthKeys,
  challengeId: string,
  email: string,
  code: string,
): string {
  return hmac(keys.otp, ["v1", "LOGIN", challengeId, email, code]);
}
export function verifyOtpArtifact(
  keys: AuthKeys,
  challengeId: string,
  email: string,
  code: string,
  artifact: string,
): boolean {
  return (
    /^v1:[A-Za-z0-9_-]{43}$/.test(artifact) &&
    safelyEqual(artifact, otpArtifact(keys, challengeId, email, code))
  );
}
export function rateKey(keys: AuthKeys, value: string): string {
  return hmac(keys.rate, ["v1", value]);
}
export function generatePortalToken(): string {
  return randomBytes(32).toString("base64url");
}
export function portalLookup(keys: AuthKeys, token: string): string {
  return hmac(keys.session, ["v1", token]);
}
export function otpVerifyIdempotencyHash(keys: AuthKeys, key: string): string {
  return hmac(keys.session, ["v1", "otp-verify-idempotency", key]);
}
/** Reconstructs the same opaque session token for an authorized retry. */
export function deriveOtpVerifyPortalToken(
  keys: AuthKeys,
  challengeId: string,
  idempotencyKey: string,
): string {
  const value = createHmac("sha256", keys.session)
    .update(`v1:otp-verify-session:${challengeId.length}:`)
    .update(challengeId)
    .update(`:${idempotencyKey.length}:`)
    .update(idempotencyKey)
    .digest();
  return value.toString("base64url");
}
export function validOtpVerifyIdempotencyKey(
  value: string | undefined,
): value is string {
  return !!value && /^[A-Za-z0-9._:-]{16,128}$/.test(value);
}
export function csrfToken(keys: AuthKeys, token: string): string {
  return hmac(keys.csrf, ["v1", token]);
}
export function verifyCsrf(
  keys: AuthKeys,
  session: string,
  header: string | undefined,
  cookie: string | undefined,
): boolean {
  return (
    !!header &&
    !!cookie &&
    safelyEqual(header, cookie) &&
    safelyEqual(header, csrfToken(keys, session))
  );
}
export interface DeliveryEnvelope {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
}
export function encryptOtpDelivery(
  keys: AuthKeys,
  challengeId: string,
  email: string,
  otp: string,
): DeliveryEnvelope {
  const nonce = randomBytes(12),
    aad = Buffer.from(JSON.stringify(["v1", challengeId, "LOGIN", email]));
  const cipher = createCipheriv("aes-256-gcm", keys.delivery, nonce);
  cipher.setAAD(aad);
  return {
    ciphertext: Buffer.concat([cipher.update(otp, "utf8"), cipher.final()]),
    nonce,
    authTag: cipher.getAuthTag(),
  };
}
export function decryptOtpDelivery(
  keys: AuthKeys,
  challengeId: string,
  email: string,
  envelope: DeliveryEnvelope,
): string | undefined {
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keys.delivery,
      envelope.nonce,
    );
    decipher.setAAD(
      Buffer.from(JSON.stringify(["v1", challengeId, "LOGIN", email])),
    );
    decipher.setAuthTag(envelope.authTag);
    return Buffer.concat([
      decipher.update(envelope.ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return undefined;
  }
}
export interface EmailProvider {
  sendLoginOtp(input: {
    deliveryId: string;
    recipient: string;
    otpCode: string;
    expiresAt: Date;
  }): Promise<{ providerMessageId?: string }>;
}

export type AuthResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code:
        | "AUTH_RATE_LIMITED"
        | "AUTH_OTP_INVALID"
        | "AUTH_LOGIN_DENIED"
        | "AUTH_CSRF_INVALID"
        | "BETA_CLOSED"
        | "BETA_CAPACITY_REACHED";
    };
export interface AuthRepository {
  listOwnedAccounts(userId: string): Promise<
    ReadonlyArray<{
      id: string;
      displayName: string | null;
      status: "ACTIVE" | "SUSPENDED";
    }>
  >;
  requestOtp(input: {
    email: string;
    ipKey: string;
    targetKey: string;
    correlationId: string;
    challengeId: string;
    verificationHash: string;
    envelope: DeliveryEnvelope;
    expiresAt: Date;
  }): Promise<AuthResult<{ challengeId: string; expiresAt: Date }>>;
  verifyOtp(input: {
    challengeId: string;
    code: string;
    ipKey: string;
    correlationId: string;
    idempotencyHash: string;
    verify: (email: string, artifact: string) => boolean;
    sessionHash: string;
    expiresAt: Date;
  }): Promise<AuthResult<{ sessionToken: string; expiresAt: Date }>>;
  authenticate(
    sessionHash: string,
  ): Promise<
    { sessionId: string; userId: string; createdAt?: Date } | undefined
  >;
  revoke(
    sessionHash: string,
    correlationId: string,
  ): Promise<"missing" | "revoked">;
}
export class AuthService {
  public constructor(
    private readonly repository: AuthRepository,
    private readonly keys: AuthKeys,
    private readonly now: () => Date = () => new Date(),
    private readonly otpGenerator = generateOtp,
  ) {}
  listOwnedAccounts(userId: string) {
    return this.repository.listOwnedAccounts(userId);
  }
  async requestOtp(
    emailInput: string,
    ip: string,
    correlationId: string,
  ): Promise<AuthResult<{ challengeId: string; expiresAt: Date }>> {
    const email = normalizeEmail(emailInput);
    if (!email) return { ok: false, code: "AUTH_OTP_INVALID" };
    const challengeId = crypto.randomUUID();
    const code = this.otpGenerator();
    const expiresAt = new Date(this.now().getTime() + OTP_TTL_MS);
    return this.repository.requestOtp({
      email,
      ipKey: rateKey(this.keys, ip),
      targetKey: rateKey(this.keys, email),
      correlationId,
      challengeId,
      verificationHash: otpArtifact(this.keys, challengeId, email, code),
      envelope: encryptOtpDelivery(this.keys, challengeId, email, code),
      expiresAt,
    });
  }
  async verifyOtp(
    challengeId: string,
    code: string,
    ip: string,
    correlationId: string,
    idempotencyKey?: string,
  ): Promise<AuthResult<{ sessionToken: string; expiresAt: Date }>> {
    const retryKey = validOtpVerifyIdempotencyKey(idempotencyKey)
      ? idempotencyKey
      : randomBytes(24).toString("base64url");
    const token = validOtpVerifyIdempotencyKey(idempotencyKey)
      ? deriveOtpVerifyPortalToken(this.keys, challengeId, retryKey)
      : generatePortalToken();
    const result = await this.repository.verifyOtp({
      challengeId,
      code,
      ipKey: rateKey(this.keys, ip),
      correlationId,
      idempotencyHash: otpVerifyIdempotencyHash(this.keys, retryKey),
      verify: (email, artifact) =>
        verifyOtpArtifact(this.keys, challengeId, email, code, artifact),
      sessionHash: portalLookup(this.keys, token),
      expiresAt: new Date(this.now().getTime() + PORTAL_SESSION_TTL_MS),
    });
    return result.ok
      ? {
          ok: true,
          value: { sessionToken: token, expiresAt: result.value.expiresAt },
        }
      : result;
  }
  csrf(sessionToken: string): string {
    return csrfToken(this.keys, sessionToken);
  }
  csrfValid(
    sessionToken: string,
    header: string | undefined,
    cookie: string | undefined,
  ): boolean {
    return verifyCsrf(this.keys, sessionToken, header, cookie);
  }
  authenticate(sessionToken: string) {
    return this.repository.authenticate(portalLookup(this.keys, sessionToken));
  }
  revoke(sessionToken: string, correlationId: string) {
    return this.repository.revoke(
      portalLookup(this.keys, sessionToken),
      correlationId,
    );
  }
}

import pino, {
  type DestinationStream,
  type Logger,
  type LoggerOptions,
} from "pino";

export const SensitiveLogPaths = [
  "authorization",
  "cookie",
  '["set-cookie"]',
  "password",
  "token",
  "refresh_token",
  "refreshToken",
  "access_token",
  "accessToken",
  "api_key",
  "apiKey",
  "secret",
  "authRootSecret",
  "authRootSecretB64",
  "accessTokenSigningPrivateKey",
  "accessTokenSigningPrivateKeyPemB64",
  "smtpPassword",
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["set-cookie"]',
  'req.headers["idempotency-key"]',
  'req.headers["x-csrf-token"]',
  "req.remoteAddress",
  "req.ip",
  // Fail closed on nested request data; keep method/id and safe event metadata.
  "req.body",
  "req.query",
  "req.headers",
  "req.url",
  "request.body",
  "request.query",
  "request.headers",
  "request.url",
  // Raw/framework request wrappers can contain nested cookies, credentials,
  // query strings, and unrecognized future fields. Censor each as a whole.
  "req.raw",
  "request.raw",
  "ctx.request",
  "deviceCode",
  "userCode",
  "start_secret_ciphertext",
  "start_secret_nonce",
  "start_secret_auth_tag",
  "ciphertext",
  "nonce",
  "authTag",
] as const;

export function createLogger(
  level: string,
  destination?: DestinationStream,
): Logger {
  const options: LoggerOptions = {
    level,
    redact: { paths: [...SensitiveLogPaths], censor: "[REDACTED]" },
  };
  return destination ? pino(options, destination) : pino(options);
}

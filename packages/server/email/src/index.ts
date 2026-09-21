import nodemailer, { type SendMailOptions, type Transporter } from "nodemailer";
import type { EmailProvider } from "@product/auth";
import { z } from "zod";

const booleanFromEnv = (value: unknown): boolean =>
  value === true || value === "true";

const SmtpSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.preprocess(booleanFromEnv, z.boolean()),
  requireTls: z.preprocess(booleanFromEnv, z.boolean()),
  username: z.string().optional(),
  password: z.string().optional(),
  from: z.string().email(),
  fromName: z.string().min(1).max(120),
  envelopeFrom: z.string().email(),
  timeoutMs: z.number().int().min(1_000).max(15_000),
});

export type SmtpConfig = z.infer<typeof SmtpSchema>;

export function loadSmtpConfig(env: NodeJS.ProcessEnv): SmtpConfig {
  const from = env.SMTP_FROM || "no-reply@octoport.ru";
  const config = SmtpSchema.parse({
    host: env.SMTP_HOST || "127.0.0.1",
    port: env.SMTP_PORT || "25",
    secure: env.SMTP_SECURE || "false",
    requireTls: env.SMTP_REQUIRE_TLS || "false",
    username: env.SMTP_USERNAME || undefined,
    password: env.SMTP_PASSWORD || undefined,
    from,
    fromName: env.SMTP_FROM_NAME || "Seller Agents / Octoport",
    envelopeFrom: env.SMTP_ENVELOPE_FROM || from,
    timeoutMs: env.SMTP_TIMEOUT_MS ? Number(env.SMTP_TIMEOUT_MS) : 8_000,
  });
  if (
    (config.username && !config.password) ||
    (!config.username && config.password)
  )
    throw new Error("SMTP username and password must be configured together");
  if (config.requireTls && config.secure)
    throw new Error("SMTP_REQUIRE_TLS is only valid for STARTTLS transports");
  return config;
}

export type EmailProviderFailureKind =
  | "KNOWN_FAILURE"
  | "UNKNOWN_OUTCOME"
  | "PROTOCOL_FAILURE";

export class EmailProviderError extends Error {
  public constructor(
    public readonly kind: EmailProviderFailureKind,
    public readonly retryable: boolean,
    public readonly providerStatus?: number,
  ) {
    super("Transactional email delivery failed");
    this.name = "EmailProviderError";
  }
}

const OTP_SUBJECT = "login verification code";

function otpText(code: string, expiresAt: Date): string {
  return [
    "Seller Agents / Octoport",
    "",
    `Your login verification code is: ${code}`,
    `This code expires in 10 minutes, at ${expiresAt.toISOString()}.`,
    "",
    "If you did not request this code, you can ignore this email.",
  ].join("\n");
}

type SmtpSendResult = {
  messageId?: string;
  accepted?: Array<string>;
  rejected?: Array<string>;
};

type SmtpTransport = Pick<Transporter, "sendMail">;

function smtpFailure(error: unknown): EmailProviderError {
  if (!error || typeof error !== "object")
    return new EmailProviderError("UNKNOWN_OUTCOME", false);
  const candidate = error as {
    responseCode?: unknown;
    code?: unknown;
  };
  const responseCode =
    typeof candidate.responseCode === "number"
      ? candidate.responseCode
      : undefined;
  if (responseCode !== undefined) {
    return new EmailProviderError(
      "KNOWN_FAILURE",
      responseCode >= 400 && responseCode < 500,
      responseCode,
    );
  }
  // A timeout or connection failure may happen after the remote MX has
  // accepted the message. Do not retry an ambiguous SMTP outcome.
  if (
    candidate.code === "ETIMEDOUT" ||
    candidate.code === "ESOCKETTIMEDOUT" ||
    candidate.code === "ECONNECTION" ||
    candidate.code === "ECONNRESET" ||
    candidate.code === "EAI_AGAIN"
  )
    return new EmailProviderError("UNKNOWN_OUTCOME", false);
  return new EmailProviderError("PROTOCOL_FAILURE", false);
}

export class SmtpEmailProvider implements EmailProvider {
  public constructor(
    private readonly config: SmtpConfig,
    private readonly transport: SmtpTransport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: config.requireTls,
      auth: config.username
        ? { user: config.username, pass: config.password }
        : undefined,
      tls: { rejectUnauthorized: true },
      connectionTimeout: config.timeoutMs,
      greetingTimeout: config.timeoutMs,
      socketTimeout: config.timeoutMs,
    }),
  ) {}

  async sendLoginOtp(input: {
    deliveryId: string;
    recipient: string;
    otpCode: string;
    expiresAt: Date;
  }): Promise<{ providerMessageId?: string }> {
    const message: SendMailOptions = {
      envelope: {
        from: this.config.envelopeFrom,
        to: input.recipient,
      },
      from: {
        name: this.config.fromName,
        address: this.config.from,
      },
      to: input.recipient,
      subject: OTP_SUBJECT,
      text: otpText(input.otpCode, input.expiresAt),
      // Keep a stable RFC Message-ID for the one logical delivery. The
      // worker does not retry ambiguous SMTP outcomes, preventing duplicates.
      messageId: `<${input.deliveryId}@octoport.ru>`,
    };
    try {
      const response = (await this.transport.sendMail(
        message,
      )) as SmtpSendResult;
      const accepted = response.accepted ?? [];
      const rejected = response.rejected ?? [];
      if (
        rejected.includes(input.recipient) ||
        !accepted.includes(input.recipient)
      )
        throw new EmailProviderError("KNOWN_FAILURE", false);
      return { providerMessageId: response.messageId };
    } catch (error) {
      if (error instanceof EmailProviderError) throw error;
      throw smtpFailure(error);
    }
  }
}

import { describe, expect, it, vi } from "vitest";
import {
  loadSmtpConfig,
  EmailProviderError,
  SmtpEmailProvider,
} from "./index.js";

describe("Octoport-owned SMTP transactional OTP adapter", () => {
  const config = {
    host: "127.0.0.1",
    port: 25,
    secure: false,
    requireTls: false,
    from: "no-reply@octoport.ru",
    fromName: "Seller Agents / Octoport",
    envelopeFrom: "no-reply@octoport.ru",
    timeoutMs: 8_000,
  };

  it("MAIL-01/03/14 submits a minimal text OTP with explicit envelope and sender", async () => {
    const sendMail = vi.fn().mockResolvedValue({
      messageId: "<job-1@octoport.ru>",
      accepted: ["person@example.test"],
      rejected: [],
    });
    const provider = new SmtpEmailProvider(config, { sendMail } as never);
    await expect(
      provider.sendLoginOtp({
        deliveryId: "job-1",
        recipient: "person@example.test",
        otpCode: "012345",
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      }),
    ).resolves.toEqual({ providerMessageId: "<job-1@octoport.ru>" });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: { from: "no-reply@octoport.ru", to: "person@example.test" },
        from: {
          name: "Seller Agents / Octoport",
          address: "no-reply@octoport.ru",
        },
        to: "person@example.test",
        subject: "login verification code",
        messageId: "<job-1@octoport.ru>",
      }),
    );
    const mail = sendMail.mock.calls[0]?.[0] as { text: string; html?: string };
    expect(mail.text).toContain("012345");
    expect(mail.text).toContain("2030-01-01T00:00:00.000Z");
    expect(mail.text).toContain("If you did not request this code");
    expect(mail.html).toBeUndefined();
  });

  it.each([
    [{ responseCode: 421 }, "KNOWN_FAILURE", true],
    [{ responseCode: 550 }, "KNOWN_FAILURE", false],
    [{ code: "ETIMEDOUT" }, "UNKNOWN_OUTCOME", false],
    [{ code: "ECONNRESET" }, "UNKNOWN_OUTCOME", false],
    [{ code: "ERR_INVALID_ARG_VALUE" }, "PROTOCOL_FAILURE", false],
  ])(
    "MAIL-08/09 classifies SMTP failure without exposing provider details",
    async (failure, kind, retryable) => {
      const provider = new SmtpEmailProvider(config, {
        sendMail: vi.fn().mockRejectedValue(failure),
      } as never);
      await expect(
        provider.sendLoginOtp({
          deliveryId: "job-failure",
          recipient: "person@example.test",
          otpCode: "012345",
          expiresAt: new Date(),
        }),
      ).rejects.toMatchObject({
        name: "EmailProviderError",
        kind,
        retryable,
      });
      await expect(
        provider.sendLoginOtp({
          deliveryId: "job-failure-2",
          recipient: "person@example.test",
          otpCode: "012345",
          expiresAt: new Date(),
        }),
      ).rejects.not.toThrow("012345");
    },
  );

  it("MAIL-07 does not report a rejected recipient as accepted", async () => {
    const provider = new SmtpEmailProvider(config, {
      sendMail: vi.fn().mockResolvedValue({
        messageId: "safe-id",
        accepted: [],
        rejected: ["person@example.test"],
      }),
    } as never);
    await expect(
      provider.sendLoginOtp({
        deliveryId: "job-rejected",
        recipient: "person@example.test",
        otpCode: "012345",
        expiresAt: new Date(),
      }),
    ).rejects.toMatchObject({ kind: "KNOWN_FAILURE", retryable: false });
  });

  it("validates server-side SMTP configuration", () => {
    expect(
      loadSmtpConfig({
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: "25",
        SMTP_SECURE: "false",
        SMTP_REQUIRE_TLS: "false",
        SMTP_FROM: "no-reply@octoport.ru",
      }),
    ).toMatchObject({
      host: "127.0.0.1",
      port: 25,
      from: "no-reply@octoport.ru",
      envelopeFrom: "no-reply@octoport.ru",
    });
    expect(() =>
      loadSmtpConfig({
        SMTP_USERNAME: "u",
        SMTP_FROM: "no-reply@octoport.ru",
      }),
    ).toThrow();
  });

  it("keeps the generic provider error opaque", () => {
    const error = new EmailProviderError("KNOWN_FAILURE", false, 550);
    expect(error.message).not.toContain("550");
    expect(error.message).not.toContain("password");
  });
});

import { describe, expect, it } from "vitest";
import { parseTelegramOperatorConfig } from "./config.js";

const valid = {
  DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:5432/fixture",
  TELEGRAM_BOT_TOKEN: "fixture-token-never-log",
  TELEGRAM_OPERATOR_IDS: "7",
  TELEGRAM_NOTIFICATION_CHAT_IDS: "42",
};

describe("Telegram operator runtime config", () => {
  it("accepts one or more operators and one or more notification destinations", () => {
    const parsed = parseTelegramOperatorConfig({
      ...valid,
      TELEGRAM_OPERATOR_IDS: "7,8",
      TELEGRAM_NOTIFICATION_CHAT_IDS: "42,43",
    });
    expect([...parsed.operatorIds]).toEqual(["7", "8"]);
    expect(parsed.notificationChatIds).toEqual(["42", "43"]);
  });

  it.each([
    ["DATABASE_URL", undefined, "TELEGRAM_OPERATOR_CONFIGURATION_MISSING"],
    [
      "TELEGRAM_BOT_TOKEN",
      undefined,
      "TELEGRAM_OPERATOR_CONFIGURATION_MISSING",
    ],
    ["TELEGRAM_OPERATOR_IDS", undefined, "TELEGRAM_OPERATOR_IDENTITY_INVALID"],
    [
      "TELEGRAM_NOTIFICATION_CHAT_IDS",
      undefined,
      "TELEGRAM_NOTIFICATION_DESTINATION_INVALID",
    ],
  ])("fails closed for %s=%s", (key, value, code) => {
    const environment = { ...valid, [key]: value };
    expect(() => parseTelegramOperatorConfig(environment)).toThrow(code);
    try {
      parseTelegramOperatorConfig(environment);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(valid.TELEGRAM_BOT_TOKEN);
      expect(message).not.toContain(valid.DATABASE_URL);
    }
  });
});

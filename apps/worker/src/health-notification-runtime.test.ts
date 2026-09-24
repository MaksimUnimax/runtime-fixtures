import { describe, expect, it, vi } from "vitest";
import type { DatabaseRuntime } from "@product/db";
import { HealthNotificationRunner } from "./health-notification-runner.js";
import { createHealthNotificationJobRunner } from "./health-notification-runtime.js";

const database = {} as DatabaseRuntime;

describe("Health notification runtime wiring", () => {
  it("leaves durable intents untouched when Telegram delivery is not configured", () => {
    expect(createHealthNotificationJobRunner(database, {})).toBeUndefined();
  });

  it("fails closed for partial or multi-destination Telegram configuration", () => {
    expect(() =>
      createHealthNotificationJobRunner(database, {
        TELEGRAM_BOT_TOKEN: "123456:fixture_token_123456789",
      }),
    ).toThrow("HEALTH_TELEGRAM_CONFIGURATION_INCOMPLETE");
    expect(() =>
      createHealthNotificationJobRunner(database, {
        TELEGRAM_NOTIFICATION_CHAT_IDS: "123",
      }),
    ).toThrow("HEALTH_TELEGRAM_CONFIGURATION_INCOMPLETE");
    expect(() =>
      createHealthNotificationJobRunner(database, {
        TELEGRAM_BOT_TOKEN: "123456:fixture_token_123456789",
        TELEGRAM_NOTIFICATION_CHAT_IDS: "123,456",
      }),
    ).toThrow("HEALTH_TELEGRAM_CONFIGURATION_INCOMPLETE");
  });

  it("constructs the existing durable runner only for one configured owner destination", () => {
    const fetcher = vi.fn<typeof fetch>();
    const runner = createHealthNotificationJobRunner(
      database,
      {
        TELEGRAM_BOT_TOKEN: "123456:fixture_token_123456789",
        TELEGRAM_NOTIFICATION_CHAT_IDS: "-100123456",
      },
      fetcher,
    );
    expect(runner).toBeInstanceOf(HealthNotificationRunner);
  });
});

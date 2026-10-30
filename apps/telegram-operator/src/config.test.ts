import { describe, expect, it } from "vitest";
import { parseTelegramOperatorConfig } from "./config.js";
import { TelegramOperatorService } from "./telegram.js";

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

  it("sends one API-watch incident per distinct destination even with repeated configuration IDs", async () => {
    const parsed = parseTelegramOperatorConfig({
      ...valid,
      TELEGRAM_OPERATOR_IDS: "7, 7, 8,7",
      TELEGRAM_NOTIFICATION_CHAT_IDS: " 42, 43,42, , 44, 43,42 ",
    });
    expect([...parsed.operatorIds]).toEqual(["7", "8"]);
    expect(parsed.notificationChatIds).toEqual(["42", "43", "44"]);

    const deliveries: string[] = [];
    const service = new TelegramOperatorService({
      scheduler: {} as ConstructorParameters<
        typeof TelegramOperatorService
      >[0]["scheduler"],
      transport: {
        getUpdates: async () => ({ updates: [] }),
        sendMessage: async (chatId) => {
          deliveries.push(chatId);
        },
        answerCallback: async () => {},
      },
      operatorIds: parsed.operatorIds,
      notificationChatIds: parsed.notificationChatIds,
    });
    await service.notifyIncident({
      kind: "OPENED",
      incident: {
        sourceFamily: "WILDBERRIES",
        incidentType: "API_CHANGE_REVIEW_REQUIRED",
        severity: "WARNING",
        safeSummaryCode: "SAFE_FIXTURE_ONLY",
        latestReportId: "synthetic-report",
      },
    });
    expect(deliveries).toEqual(["42", "43", "44"]);
  });

  it("keeps dedicated Health session config optional and trims only its path", () => {
    const without = parseTelegramOperatorConfig(valid);
    expect(without.healthDedicatedSessionConfigPath).toBeUndefined();

    const withPath = parseTelegramOperatorConfig({
      ...valid,
      HEALTH_DEDICATED_SESSION_CONFIG_PATH:
        "  /etc/octoport-monitor/dedicated-health.json  ",
    });
    expect(withPath.healthDedicatedSessionConfigPath).toBe(
      "/etc/octoport-monitor/dedicated-health.json",
    );
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

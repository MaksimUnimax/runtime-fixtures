import type { DatabaseRuntime } from "@product/db";
import { HealthNotificationRunner } from "./health-notification-runner.js";
import { TelegramHealthNotificationDelivery } from "./telegram-health-notification-delivery.js";

export type HealthNotificationRuntimeEnvironment = Readonly<
  Record<string, string | undefined>
>;

export function createHealthNotificationJobRunner(
  database: DatabaseRuntime,
  environment: HealthNotificationRuntimeEnvironment,
  fetcher: typeof fetch = fetch,
): HealthNotificationRunner | undefined {
  const token = environment.TELEGRAM_BOT_TOKEN;
  const chatIds = (environment.TELEGRAM_NOTIFICATION_CHAT_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!token && chatIds.length === 0) return undefined;
  if (!token || chatIds.length !== 1) {
    throw new Error("HEALTH_TELEGRAM_CONFIGURATION_INCOMPLETE");
  }
  return new HealthNotificationRunner(
    database,
    new TelegramHealthNotificationDelivery(token, chatIds[0]!, fetcher),
  );
}

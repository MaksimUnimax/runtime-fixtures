import { createDatabaseRuntime } from "@product/db";
import {
  createPostgresMonitoringScheduleStore,
  IndependentMonitoringScheduler,
} from "@product/monitoring-control";
import {
  runLlmNoSessionMonitoring,
  runSwaggerApiMonitoring,
} from "./runners.js";
import { createTelegramTransport } from "./telegram-client.js";
import { TelegramOperatorService } from "./telegram.js";

const databaseUrl = process.env.DATABASE_URL;
const token = process.env.TELEGRAM_BOT_TOKEN;
const operatorIds = new Set(
  (process.env.TELEGRAM_OPERATOR_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const notificationChatIds = (process.env.TELEGRAM_NOTIFICATION_CHAT_IDS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (!databaseUrl || !token || operatorIds.size === 0)
  throw new Error("TELEGRAM_OPERATOR_CONFIGURATION_MISSING");

const database = createDatabaseRuntime(databaseUrl);
const transport = createTelegramTransport(token);
const serviceRef: { current: TelegramOperatorService | undefined } = {
  current: undefined,
};
const scheduler = new IndependentMonitoringScheduler({
  notifier: async (notification) => {
    await serviceRef.current?.notify(notification);
  },
  store: createPostgresMonitoringScheduleStore(database),
  runners: {
    LLM: runLlmNoSessionMonitoring,
    SWAGGER_API: runSwaggerApiMonitoring,
  },
});
const service = new TelegramOperatorService({
  transport,
  operatorIds,
  notificationChatIds,
  scheduler,
});
serviceRef.current = service;

process.once(
  "SIGINT",
  () => void service.stop().finally(() => database.close()),
);
process.once(
  "SIGTERM",
  () => void service.stop().finally(() => database.close()),
);
await service.start();

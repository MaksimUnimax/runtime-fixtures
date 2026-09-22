import { createDatabaseRuntime } from "@product/db";
import {
  createApiWatchRunner,
  createPostgresApiWatchStore,
  productionSourceRegistry,
} from "@product/api-watch";
import {
  createPostgresMonitoringScheduleStore,
  createPostgresSwaggerSourceStore,
  createSwaggerHandoffService,
  IndependentMonitoringScheduler,
} from "@product/monitoring-control";
import {
  runLlmNoSessionMonitoring,
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
const swaggerQuarantineDir =
  process.env.SWAGGER_QUARANTINE_DIR ??
  "/var/lib/octoport/api-watch/quarantine";
const swaggerHandoff = createSwaggerHandoffService({
  store: createPostgresSwaggerSourceStore(database),
  quarantineDir: swaggerQuarantineDir,
  maxUploadBytes: process.env.MAX_SWAGGER_UPLOAD_BYTES
    ? Number(process.env.MAX_SWAGGER_UPLOAD_BYTES)
    : undefined,
});
const serviceRef: { current: TelegramOperatorService | undefined } = {
  current: undefined,
};
const apiWatchRunner = createApiWatchRunner({
  registry: productionSourceRegistry,
  store: createPostgresApiWatchStore(database),
  pendingStore: createPostgresSwaggerSourceStore(database),
  quarantineDir: swaggerQuarantineDir,
});
const scheduler = new IndependentMonitoringScheduler({
  notifier: async (notification) => {
    await serviceRef.current?.notify(notification);
  },
  store: createPostgresMonitoringScheduleStore(database),
  runners: {
    LLM: runLlmNoSessionMonitoring,
    SWAGGER_API: apiWatchRunner,
  },
});
const service = new TelegramOperatorService({
  transport,
  operatorIds,
  notificationChatIds,
  scheduler,
  swaggerHandoff,
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

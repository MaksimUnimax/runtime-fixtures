import { createDatabaseRuntime } from "@product/db";
import {
  createApiWatchRunner,
  createPostgresApiWatchStore,
  createPostgresApiWatchReportStore,
  createPostgresApiWatchIncidentStore,
  createPostgresApiWatchRetryStore,
  productionSourceRegistry,
  validateWbBundleUpload,
} from "@product/api-watch";
import {
  createPostgresMonitoringScheduleStore,
  createPostgresSwaggerSourceStore,
  createSwaggerHandoffService,
  IndependentMonitoringScheduler,
} from "@product/monitoring-control";
import {
  createLlmMonitoringRunner,
  shouldSendMonitoringNotification,
} from "./runners.js";
import { createPostgresDurableNoSessionHealthRuntime } from "./health-runtime.js";
import { parseTelegramOperatorConfig } from "./config.js";
import { createTelegramTransport } from "./telegram-client.js";
import { TelegramOperatorService } from "./telegram.js";

const { databaseUrl, token, operatorIds, notificationChatIds } =
  parseTelegramOperatorConfig(process.env);

const database = createDatabaseRuntime(databaseUrl);
const monitoringStore = createPostgresMonitoringScheduleStore(database);
const durableLlmHealth = createPostgresDurableNoSessionHealthRuntime(database, {
  scheduleAuthority: async () => {
    const state = await monitoringStore.getState("LLM");
    return {
      intervalSeconds: state.intervalSeconds,
      nextDueAt: state.nextRunAt,
    };
  },
  onWakeFailure: () => console.error("HEALTH_DURABLE_WAKE_FAILED"),
});
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
  validateUpload: validateWbBundleUpload,
});
const serviceRef: { current: TelegramOperatorService | undefined } = {
  current: undefined,
};
const retrySchedulerRef: {
  current: IndependentMonitoringScheduler | undefined;
} = { current: undefined };
const incidentStore = createPostgresApiWatchIncidentStore(database);
const apiWatchRunner = createApiWatchRunner({
  registry: productionSourceRegistry,
  store: createPostgresApiWatchStore(database),
  pendingStore: createPostgresSwaggerSourceStore(database),
  reportStore: createPostgresApiWatchReportStore(database),
  incidentStore,
  incidentNotifier: async (event) => serviceRef.current?.notifyIncident(event),
  retryStore: createPostgresApiWatchRetryStore(database),
  scheduleEarlier: async (retryAt) => {
    await retrySchedulerRef.current?.scheduleEarlier("SWAGGER_API", retryAt);
  },
  quarantineDir: swaggerQuarantineDir,
});
const scheduler = new IndependentMonitoringScheduler({
  notifier: async (notification) => {
    if (!shouldSendMonitoringNotification(notification)) return;
    await serviceRef.current?.notify(notification);
  },
  store: monitoringStore,
  runners: {
    LLM: createLlmMonitoringRunner(() => durableLlmHealth.runScheduledCycle()),
    SWAGGER_API: apiWatchRunner,
  },
});
retrySchedulerRef.current = scheduler;
const service = new TelegramOperatorService({
  transport,
  operatorIds,
  notificationChatIds,
  scheduler,
  swaggerHandoff,
  incidentStore,
});
serviceRef.current = service;

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await durableLlmHealth.stop();
  await service.stop();
  await database.close();
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await service.start();
try {
  await durableLlmHealth.start();
} catch (error) {
  await service.stop();
  await database.close();
  throw error;
}

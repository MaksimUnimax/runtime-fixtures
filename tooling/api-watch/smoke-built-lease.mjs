import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createApiWatchRunner,
  createSourceRegistry,
  InMemoryApiWatchStore,
  createInMemoryApiWatchState,
  InMemoryApiWatchReportStore,
  InMemoryApiWatchIncidentStore,
} from "./dist/index.js";

// Consume the actual built API-watch bundle from a separately built scheduler.
// This catches module-local AsyncLocalStorage copies silently losing the fence.
const require = createRequire(import.meta.resolve("tsup"));
const { build } = require("esbuild");
const directory = await mkdtemp(join(tmpdir(), "octoport-f06-built-"));
try {
  const sourceRoot = resolve("../../packages/server/monitoring-control/src");
  const compiled = await build({
    stdin: {
      contents: `export { IndependentMonitoringScheduler } from ${JSON.stringify(join(sourceRoot, "scheduler.ts"))};\nexport { InMemoryMonitoringScheduleStore } from ${JSON.stringify(join(sourceRoot, "store.ts"))};\nexport { InMemorySwaggerSourceStore } from ${JSON.stringify(join(sourceRoot, "swagger-handoff.ts"))};\nexport { TelegramOperatorService } from ${JSON.stringify(resolve("../../apps/telegram-operator/src/telegram.ts"))};\nexport { createTelegramTransport } from ${JSON.stringify(resolve("../../apps/telegram-operator/src/telegram-client.ts"))};`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node24",
    banner: {
      js: 'import { createRequire as createFixtureRequire } from "node:module"; import { fileURLToPath as fixtureFileURLToPath } from "node:url"; import { dirname as fixtureDirname } from "node:path"; const require = createFixtureRequire(import.meta.url); const __filename = fixtureFileURLToPath(import.meta.url); const __dirname = fixtureDirname(__filename);',
    },
  });
  const schedulerPath = join(directory, "scheduler.mjs");
  await writeFile(schedulerPath, compiled.outputFiles[0].contents);
  const {
    IndependentMonitoringScheduler,
    InMemoryMonitoringScheduleStore,
    InMemorySwaggerSourceStore,
    TelegramOperatorService,
    createTelegramTransport,
  } = await import(pathToFileURL(schedulerPath).href);
  let release;
  let entered;
  const blocked = new Promise((done) => {
    release = done;
  });
  const ready = new Promise((done) => {
    entered = done;
  });
  const apiState = createInMemoryApiWatchState();
  class DelayedStore extends InMemoryApiWatchStore {
    async saveAuthorityRecord(input) {
      entered();
      await blocked;
      return super.saveAuthorityRecord(input);
    }
  }
  let time = new Date("2026-10-29T00:00:00Z");
  const clock = { now: () => new Date(time) };
  const schedule = new InMemoryMonitoringScheduleStore();
  await schedule.ensureDefaults(clock.now());
  const reports = new InMemoryApiWatchReportStore();
  const incidents = new InMemoryApiWatchIncidentStore();
  const notifications = [];
  const runner = (family, store) => {
    const registry = createSourceRegistry({
      [family]: { officialUrl: null, documents: [] },
    });
    return createApiWatchRunner({
      registry: {
        ...registry,
        list: () =>
          registry.list().filter((entry) => entry.sourceFamily === family),
      },
      store,
      pendingStore: new InMemorySwaggerSourceStore(),
      reportStore: reports,
      incidentStore: incidents,
      incidentNotifier: async (event) => {
        notifications.push(event.incident.sourceFamily);
      },
      clock: clock.now,
    });
  };
  const scheduler = (implementation) =>
    new IndependentMonitoringScheduler({
      store: schedule,
      clock,
      leaseMs: 100,
      runners: {
        LLM: async () => ({
          status: "SUCCEEDED",
          code: null,
          summary: "fixture",
        }),
        SWAGGER_API: implementation,
      },
    });
  const a = scheduler(runner("OZON_PERFORMANCE", new DelayedStore(apiState)));
  const b = scheduler(
    runner("OZON_SELLER", new InMemoryApiWatchStore(apiState)),
  );
  const terminalA = a.runNowAndWait("SWAGGER_API").catch((error) => error);
  await ready;
  time = new Date(time.valueOf() + 101);
  await b.runNowAndWait("SWAGGER_API");
  release();
  await terminalA;
  const records = await new InMemoryApiWatchStore(
    apiState,
  ).listAuthorityRecords();
  assert.deepEqual(
    records.map((record) => record.sourceFamily),
    ["OZON_SELLER"],
  );
  assert.deepEqual(notifications, ["OZON_SELLER"]);
  await a.stop();
  await b.stop();

  // API-watch is the real dist bundle; its notification crosses into the
  // separately compiled production Telegram consumer/client and scheduler.
  // Only the final HTTP fetch is replaced. No provider/network call occurs.
  for (const kind of ["result", "incident"]) {
    for (const loss of ["stop", "successor", "expiry", "none"]) {
      let now = new Date("2026-10-29T00:00:00Z");
      const localClock = { now: () => new Date(now) };
      const store = new InMemoryMonitoringScheduleStore();
      await store.ensureDefaults(localClock.now());
      let firstSend;
      let releaseSend;
      const entered = new Promise((resolve) => {
        firstSend = resolve;
      });
      const pending = new Promise((resolve) => {
        releaseSend = resolve;
      });
      const sends = [];
      const transport = createTelegramTransport(
        "SYNTHETIC_F06_NOT_A_REAL_TOKEN",
        async (_url, init) => {
          sends.push(JSON.parse(init.body).chat_id);
          if (sends.length === 1) {
            firstSend();
            await pending;
          }
          return new globalThis.Response(
            JSON.stringify({ ok: true, result: { message_id: sends.length } }),
          );
        },
      );
      let service;
      const registry = createSourceRegistry({
        OZON_SELLER: { officialUrl: null, documents: [] },
      });
      const incidentRunner = createApiWatchRunner({
        registry: {
          ...registry,
          list: () =>
            registry
              .list()
              .filter((entry) => entry.sourceFamily === "OZON_SELLER"),
        },
        store: new InMemoryApiWatchStore(),
        pendingStore: new InMemorySwaggerSourceStore(),
        reportStore: new InMemoryApiWatchReportStore(),
        incidentStore: new InMemoryApiWatchIncidentStore(),
        incidentNotifier: (event) => service.notifyIncident(event),
        clock: localClock.now,
      });
      const resultRunner = async () => ({
        status: "SUCCEEDED",
        code: null,
        summary: "synthetic result",
      });
      const previous = new IndependentMonitoringScheduler({
        store,
        clock: localClock,
        leaseMs: 1000,
        runners: {
          LLM: resultRunner,
          SWAGGER_API: kind === "incident" ? incidentRunner : resultRunner,
        },
        notifier:
          kind === "result"
            ? (notification) => service.notify(notification)
            : undefined,
        notificationRetryDelaysMs: [0],
      });
      service = new TelegramOperatorService({
        scheduler: previous,
        transport,
        operatorIds: new Set(["7"]),
        notificationChatIds: ["42", "43"],
      });
      const successor = new IndependentMonitoringScheduler({
        store,
        clock: localClock,
        leaseMs: 1000,
        runners: { LLM: resultRunner, SWAGGER_API: resultRunner },
      });
      const terminal = previous.runNowAndWait("SWAGGER_API").then(
        () => undefined,
        () => undefined,
      );
      try {
        await entered;
        if (loss === "stop") await previous.stop();
        if (loss === "expiry" || loss === "successor")
          now = new Date(now.valueOf() + 1001);
        if (loss === "successor") await successor.runNowAndWait("SWAGGER_API");
        releaseSend();
        await terminal;
        const allowed =
          loss === "none" || (kind === "result" && loss === "expiry");
        assert.deepEqual(
          sends,
          allowed ? ["42", "43"] : ["42"],
          `${kind}:${loss}`,
        );
      } finally {
        releaseSend();
        await terminal;
        await previous.stop();
        await successor.stop();
      }
    }
  }
  console.log(
    JSON.stringify({
      status: "PASS",
      boundary: "BUILT_API_WATCH_WITH_SEPARATELY_BUNDLED_SCHEDULER",
      cases: [
        "late_authority_after_takeover",
        "incident_notification",
        "eight_physical_send_cases_with_built_telegram_consumer",
      ],
      providerRequests: 0,
      databaseConnections: 0,
    }),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

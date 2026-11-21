import { describe, expect, it } from "vitest";
import {
  IndependentMonitoringScheduler,
  InMemoryMonitoringScheduleStore,
  InMemorySwaggerSourceStore,
  createPostgresMonitoringScheduleStore,
  currentMonitoringEffectAdmission,
  withMonitoringRun,
  type MonitoringRunAuthority,
  type MonitoringSqlRuntime,
} from "@product/monitoring-control";
import {
  createApiWatchRunner,
  createSourceRegistry,
  InMemoryApiWatchStore,
  InMemoryApiWatchReportStore,
  InMemoryApiWatchIncidentStore,
} from "@product/api-watch";
import { TelegramOperatorService } from "./telegram.js";
import { createTelegramTransport } from "./telegram-client.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("F06 per-physical-send ownership", () => {
  for (const kind of ["result", "incident"] as const) {
    for (const loss of ["stop", "successor", "expiry", "none"] as const) {
      it(`${kind}: ${loss} while first HTTP send is pending`, async () => {
        let now = new Date("2026-10-29T00:00:00Z");
        const clock = { now: () => new Date(now) };
        const store = new InMemoryMonitoringScheduleStore();
        await store.ensureDefaults(clock.now());
        const entered = deferred();
        const release = deferred();
        const physicalRequests: string[] = [];
        const transport = createTelegramTransport(
          "SYNTHETIC_F06_NOT_A_REAL_TOKEN",
          async (url, init) => {
            expect(String(url)).toBe(
              "https://api.telegram.org/botSYNTHETIC_F06_NOT_A_REAL_TOKEN/sendMessage",
            );
            const body = JSON.parse(String(init?.body)) as { chat_id: string };
            physicalRequests.push(body.chat_id);
            if (physicalRequests.length === 1) {
              entered.resolve();
              await release.promise;
            }
            return new Response(
              JSON.stringify({
                ok: true,
                result: { message_id: physicalRequests.length },
              }),
              { status: 200 },
            );
          },
        );
        const registry = createSourceRegistry({
          OZON_SELLER: { officialUrl: null, documents: [] },
        });
        const apiRunner = createApiWatchRunner({
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
          clock: clock.now,
        });
        const completed = async () => ({
          status: "SUCCEEDED" as const,
          code: null,
          summary: "synthetic accepted result",
        });
        const scheduler: IndependentMonitoringScheduler =
          new IndependentMonitoringScheduler({
            store,
            clock,
            leaseMs: 1000,
            runners: {
              LLM: completed,
              SWAGGER_API: kind === "incident" ? apiRunner : completed,
            },
            notifier:
              kind === "result"
                ? (notification) => service.notify(notification)
                : undefined,
            notificationRetryDelaysMs: [0],
          });
        const service: TelegramOperatorService = new TelegramOperatorService({
          scheduler,
          transport,
          operatorIds: new Set(["7"]),
          notificationChatIds: ["42", "43"],
        });
        const successor = new IndependentMonitoringScheduler({
          store,
          clock,
          leaseMs: 1000,
          runners: { LLM: completed, SWAGGER_API: completed },
        });
        const terminal = scheduler.runNowAndWait("SWAGGER_API").then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
        let acceptedSuccessor: string | undefined;
        try {
          await entered.promise;
          if (loss === "stop") await scheduler.stop();
          if (loss === "expiry" || loss === "successor")
            now = new Date(now.valueOf() + 1001);
          if (loss === "successor") {
            await successor.runNowAndWait("SWAGGER_API");
            acceptedSuccessor = (await store.getState("SWAGGER_API"))
              .lastResult!.runId;
          }
          release.resolve();
          await terminal;
          // An accepted completed result is not revoked merely by the old
          // lease's former timestamp. Incident execution still needs its lease.
          const shouldSendSecond =
            loss === "none" || (kind === "result" && loss === "expiry");
          expect(physicalRequests).toEqual(
            shouldSendSecond ? ["42", "43"] : ["42"],
          );
          if (acceptedSuccessor)
            expect(
              (await store.getState("SWAGGER_API")).lastResult?.runId,
            ).toBe(acceptedSuccessor);
        } finally {
          release.resolve();
          await terminal;
          await scheduler.stop();
          await successor.stop();
        }
      });
    }
  }
});

describe("F06 per-send PostgreSQL admission without transport lock retention", () => {
  for (const kind of ["result", "OPENED", "RESOLVED"] as const) {
    for (const loss of ["stop", "successor", "expiry", "none"] as const) {
      it(`${kind}: ${loss} between physical sends`, async () => {
        let owner = kind === "result" ? null : "A";
        let databaseTime = 0;
        let locked = false;
        let tail = Promise.resolve();
        const row = () => ({
          lane: "LLM",
          enabled: true,
          intervalSeconds: 5400,
          nextRunAt: new Date(0),
          lastRunAt: new Date(0),
          activeRunId: owner,
          activeRunSource: owner ? "FORCED" : null,
          activeRunStartedAt: owner ? new Date(0) : null,
          activeRunLeaseExpiresAt: owner ? new Date(100) : null,
          lastResult: {
            runId: "A",
            finishedAt: new Date(0).toISOString(),
            status: "SUCCEEDED",
            code: null,
            summary: "accepted",
          },
          notificationFailureCount: 0,
          lastNotificationError: null,
          updatedAt: new Date(0),
        });
        const runtime: MonitoringSqlRuntime = {
          async query<T extends Record<string, unknown>>(text: string) {
            if (!locked) throw new Error("SYNTHETIC_QUERY_WITHOUT_LOCK");
            const rows = text.includes("clock_timestamp")
              ? [{ now: new Date(databaseTime) }]
              : text.startsWith('SELECT active_run_id AS "runId"')
                ? [{ runId: owner, leaseExpiresAt: new Date(100) }]
                : [row()];
            return { rows: rows as unknown as T[] };
          },
          async transaction(operation) {
            const previous = tail;
            let unlock!: () => void;
            tail = new Promise<void>((resolve) => {
              unlock = resolve;
            });
            await previous;
            locked = true;
            try {
              return await operation(runtime);
            } finally {
              locked = false;
              unlock();
            }
          },
        };
        const store = createPostgresMonitoringScheduleStore(runtime);
        const controller = new AbortController();
        const authority: MonitoringRunAuthority = {
          lane: "LLM",
          runId: "A",
          signal: controller.signal,
          revoke: () => controller.abort(),
          assertCurrent: async () => {},
          assertCurrentSync: () => {},
          withCurrent: (operation) =>
            store.withRunLease(authority, new Date(0), operation),
        };
        const entered = deferred();
        const release = deferred();
        const sends: string[] = [];
        const transport = createTelegramTransport(
          "SYNTHETIC_F06_NOT_A_REAL_TOKEN",
          async (_url, init) => {
            // The actual fetch begins while the admission lock is held.
            expect(locked).toBe(true);
            sends.push(
              (JSON.parse(String(init?.body)) as { chat_id: string }).chat_id,
            );
            if (sends.length === 1) {
              entered.resolve();
              await release.promise;
            }
            return new Response(
              JSON.stringify({
                ok: true,
                result: { message_id: sends.length },
              }),
            );
          },
        );
        const noop = async () => ({
          status: "SUCCEEDED" as const,
          code: null,
          summary: "unused",
        });
        const service = new TelegramOperatorService({
          transport,
          operatorIds: new Set(["7"]),
          notificationChatIds: ["42", "43"],
          scheduler: new IndependentMonitoringScheduler({
            store,
            runners: { LLM: noop, SWAGGER_API: noop },
          }),
        });
        const terminal = withMonitoringRun(authority, () =>
          kind === "result"
            ? service.notify({
                lane: "LLM",
                runId: "A",
                source: "FORCED",
                result: {
                  status: "SUCCEEDED",
                  code: null,
                  summary: "accepted",
                },
                admission: {
                  signal: controller.signal,
                  dispatch: (operation) =>
                    store.withCompletedRun(authority, operation),
                },
              })
            : service.notifyIncident({
                kind,
                incident: {
                  sourceFamily: "OZON_SELLER",
                  incidentType: "SOURCE_UNAVAILABLE",
                  severity: "HIGH",
                  safeSummaryCode: "SYNTHETIC",
                  latestReportId: "synthetic",
                },
                admission: currentMonitoringEffectAdmission(),
              }),
        ).then(
          () => ({ ok: true }),
          (error: unknown) => ({ error }),
        );
        try {
          await entered.promise;
          // This must complete before releasing the first HTTP response.
          // A retained lane lock would deadlock this real transaction queue.
          await runtime.transaction(async () => {
            if (loss === "stop") controller.abort();
            if (loss === "successor") owner = "B";
            if (loss === "expiry") databaseTime = 101;
          });
          release.resolve();
          const result = await terminal;
          const allowed =
            loss === "none" || (kind === "result" && loss === "expiry");
          expect(sends).toEqual(allowed ? ["42", "43"] : ["42"]);
          expect("ok" in result).toBe(allowed);
        } finally {
          release.resolve();
          await terminal;
        }
      });
    }
  }
});

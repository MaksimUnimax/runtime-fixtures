import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabaseRuntime } from "@product/db";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import {
  IndependentMonitoringScheduler,
  createPostgresMonitoringScheduleStore,
  InMemorySwaggerSourceStore,
  createPostgresSwaggerSourceStore,
  createSwaggerHandoffService,
} from "../../../packages/server/monitoring-control/src/index.js";
import { createPostgresApiWatchRetryStore } from "../../../tooling/api-watch/src/retry.js";
import {
  InMemoryApiWatchStore,
  createPostgresApiWatchStore,
  runAuthorityPass,
} from "../../../tooling/api-watch/src/authority.js";
import { InMemoryApiWatchReportStore } from "../../../tooling/api-watch/src/report.js";
import {
  createSourceRegistry,
  productionSourceRegistry,
} from "../../../tooling/api-watch/src/source-registry.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryApiWatchRetryStore } from "../../../tooling/api-watch/src/retry.js";
import {
  createWbBundle,
  validateWbBundleUpload,
  WB_BUNDLE_DOCUMENT_KEY,
} from "../../../tooling/api-watch/src/wb-bundle.js";
import { runApiWatchReport } from "../../../tooling/api-watch/src/run.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const connection = new URL(connectionString);
const expectedDatabase = decodeURIComponent(connection.pathname.slice(1));
const allowedDatabases = new Set([
  "product_control_plane_test",
  "octoport_a_test",
  "octoport_b_test",
  "octoport_c_test",
]);
if (
  !["127.0.0.1", "localhost"].includes(connection.hostname) ||
  !allowedDatabases.has(expectedDatabase)
)
  throw new Error("REVIEW_FIX_DISPOSABLE_DATABASE_REQUIRED");
const schema = "reviewfix_" + randomUUID().replaceAll("-", "");
const admin = createDatabaseRuntime(connectionString);
const scopedUrl = new URL(connectionString);
scopedUrl.searchParams.set(
  "options",
  (scopedUrl.searchParams.get("options") ?? "") +
    " -csearch_path=" +
    schema +
    ",public",
);
const scoped = createDatabaseRuntime(scopedUrl.toString());
const schedulerUrl = new URL(
  "../../../packages/server/monitoring-control/src/scheduler.ts",
  import.meta.url,
).href;
const baselineUrl = new URL(
  "./fixtures/monitoring-scheduler-03740125.fixture.ts",
  import.meta.url,
).href;
const databaseUrl = new URL(
  "../../../packages/server/db/src/index.ts",
  import.meta.url,
).href;
const storeUrl = new URL(
  "../../../packages/server/monitoring-control/src/store.ts",
  import.meta.url,
).href;
let created = false;

function nativeChild(baseline: boolean, runnerFailure = false) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import * as schedulerModule from ${JSON.stringify(baseline ? baselineUrl : schedulerUrl)};
    const IndependentMonitoringScheduler = ${baseline ? "schedulerModule.default.IndependentMonitoringScheduler" : "schedulerModule.IndependentMonitoringScheduler"};
    if (typeof IndependentMonitoringScheduler !== "function") throw new Error("NATIVE_SCHEDULER_MODULE_UNAVAILABLE");
    import { writeSync } from "node:fs";
    const observe = value => writeSync(1, JSON.stringify(value) + "\\n");
    import { createPostgresMonitoringScheduleStore } from ${JSON.stringify(storeUrl)};
    import { createDatabaseRuntime } from ${JSON.stringify(databaseUrl)};
    const runtime = createDatabaseRuntime(process.env.REVIEW_FIX_DATABASE_URL);
    const store = createPostgresMonitoringScheduleStore(runtime);
    await runtime.ready();
    await store.ensureDefaults(new Date());
    const good = {status: "SUCCEEDED", code: null, summary: "synthetic"};
    const scheduler = new IndependentMonitoringScheduler({
      store, onError: () => {},
      runners: {LLM: async () => {if (${runnerFailure}) throw new Error("SYNTHETIC_RUNNER_FAILURE"); return good;},
        SWAGGER_API: async () => good},
    });
    let callerCaught = false, databaseError = false;
    try {await scheduler.runNowAndWait("LLM");}
    catch (error) {callerCaught = true; databaseError = error.code === "P0001";
      observe({callerCaught, databaseError});}
    await new Promise(resolve => setTimeout(resolve, 25));
    const other = await scheduler.runNowAndWait("SWAGGER_API");
    const llm = await store.getState("LLM");
    const next = llm.activeRun ? await scheduler.runNow("LLM") : {kind: "COMPLETED"};
    await scheduler.stop();
    await runtime.close();
    observe({survived: true, callerCaught, databaseError,
      resultAbsent: llm.lastResult === null, leaseRetained: llm.activeRun !== null,
      llmStatus: llm.lastResult?.status ?? null, other: other.status, restartStart: next.kind});
  `,
    ],
    {
      env: {
        PATH: process.env.PATH,
        REVIEW_FIX_DATABASE_URL: scopedUrl.toString(),
      },
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 128 * 1024,
    },
  );
}

describe.sequential(
  "review native monitoring finalization and WB retry boundaries",
  () => {
    beforeAll(async () => {
      await admin.ready();
      const identity = await admin.query<{ database: string }>(
        "SELECT current_database() AS database",
      );
      if (identity.rows[0]?.database !== expectedDatabase)
        throw new Error("REVIEW_FIX_DATABASE_IDENTITY_MISMATCH");
      await runMigrations({ connectionString });
      await admin.query('CREATE SCHEMA "' + schema + '"');
      created = true;
      await admin.query(
        'CREATE TABLE "' +
          schema +
          '".monitoring_lane_schedules (LIKE public.monitoring_lane_schedules INCLUDING ALL)',
      );
      await admin.query(
        'CREATE TABLE "' +
          schema +
          '".api_watch_retry_state (LIKE public.api_watch_retry_state INCLUDING ALL)',
      );
      await admin.query(
        'CREATE TABLE "' +
          schema +
          '".api_watch_authority_records (LIKE public.api_watch_authority_records INCLUDING ALL)',
      );
      for (const table of [
        "swagger_source_requests",
        "swagger_source_artifacts",
      ]) {
        await admin.query(
          'CREATE TABLE "' +
            schema +
            '".' +
            table +
            " (LIKE public." +
            table +
            " INCLUDING ALL)",
        );
      }
      await scoped.ready();
      const location = await scoped.query<{ schema: string }>(
        "SELECT current_schema() AS schema",
      );
      if (location.rows[0]?.schema !== schema)
        throw new Error("REVIEW_FIX_SCHEMA_ISOLATION_FAILED");
      await scoped.query(`CREATE FUNCTION ${schema}.reject_synthetic_result() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.lane = 'LLM' AND NEW.last_result IS DISTINCT FROM OLD.last_result
           AND NEW.last_result->>'status' = 'SUCCEEDED'
        THEN RAISE EXCEPTION 'SYNTHETIC_RESULT_PERSISTENCE_FAILURE'; END IF;
        RETURN NEW;
      END $$`);
      await scoped.query(`CREATE TRIGGER reject_synthetic_result BEFORE UPDATE ON ${schema}.monitoring_lane_schedules
      FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_synthetic_result()`);
    }, 120000);
    afterAll(async () => {
      await scoped.close();
      if (created) await admin.query('DROP SCHEMA "' + schema + '" CASCADE');
      await admin.close();
    });

    it.each(["CANDIDATE_READY", "CANCELLED", "EXPIRED"] as const)(
      "native PostgreSQL preserves %s generation across later full reports",
      async (terminal) => {
        await scoped.query(
          "TRUNCATE swagger_source_artifacts, swagger_source_requests",
        );
        const pendingStore = createPostgresSwaggerSourceStore(scoped);
        const now = new Date("2026-10-14T00:00:00Z");
        const dependencies = {
          registry: productionSourceRegistry,
          store: new InMemoryApiWatchStore(),
          reportStore: new InMemoryApiWatchReportStore(),
          retryStore: new InMemoryApiWatchRetryStore(),
          pendingStore,
          clock: () => now,
          fetcher: (async () =>
            new Response("synthetic403", { status: 403 })) as typeof fetch,
        };
        let index = 0;
        const pass = () =>
          runApiWatchReport({
            runId: "native-lifecycle-" + terminal + index++,
            source: "FORCED",
            dependencies,
          });
        const concurrent = await Promise.all(Array.from({ length: 4 }, pass));
        expect(concurrent.map((result) => result.status)).toEqual(
          Array(4).fill("NOT_OBSERVABLE"),
        );
        const request = (await pendingStore.listPending(now)).find(
          (row) => row.documentKey === WB_BUNDLE_DOCUMENT_KEY,
        )!;
        expect(request).toBeDefined();
        const count = async () =>
          (
            await scoped.query<{ count: string }>(
              "SELECT count(*)::text AS count FROM swagger_source_requests WHERE document_key=$1",
              [WB_BUNDLE_DOCUMENT_KEY],
            )
          ).rows[0]!.count;
        expect(await count()).toBe("1");
        const root = await mkdtemp(
          join(tmpdir(), "octoport-review-native-lifecycle-"),
        );
        try {
          if (terminal === "CANDIDATE_READY") {
            const bytes = new TextEncoder().encode(
              createWbBundle(
                productionSourceRegistry
                  .get("WILDBERRIES")
                  .documents!.map((document, i) => ({
                    documentKey: document.documentKey,
                    filename: document.officialUrl
                      .split("/")
                      .pop()!
                      .split("?")[0]!,
                    content: `openapi: 3.0.3\ninfo:\n  title: WB ${i}\n  version: '1'\npaths:\n  /document-${i}:\n    get:\n      responses:\n        '200':\n          description: ok\n`,
                  })),
                now.toISOString(),
              ),
            );
            const service = createSwaggerHandoffService({
              store: pendingStore,
              quarantineDir: root,
              validateUpload: validateWbBundleUpload,
            });
            expect(
              (
                await service.upload({
                  requestId: request.requestId,
                  operatorId: "synthetic",
                  originalFilename: "wildberries-openapi-bundle.json",
                  bytes,
                  receivedAt: now,
                })
              ).kind,
            ).toBe("CANDIDATE_READY");
            expect(
              await pendingStore.listArtifacts(request.requestId),
            ).toHaveLength(1);
          } else
            await pendingStore.setRequestStatus(request.requestId, terminal);
          expect((await pass()).status).toBe("NOT_OBSERVABLE");
          expect((await pass()).status).toBe("NOT_OBSERVABLE");
          expect(
            (await pendingStore.getRequest(request.requestId))?.status,
          ).toBe(terminal);
          expect(await count()).toBe("1");
          expect(
            (await pendingStore.listPending(now)).filter(
              (row) => row.documentKey === WB_BUNDLE_DOCUMENT_KEY,
            ),
          ).toHaveLength(0);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      },
      30000,
    );

    it("reproduces the frozen baseline failure then preserves the caller error, lease and other lane in the candidate", async () => {
      const frozen = (
        await readFile(
          new URL(
            "./fixtures/monitoring-scheduler-03740125.fixture.ts",
            import.meta.url,
          ),
          "utf8",
        )
      )
        .replaceAll("../../../../packages/server/monitoring-control/src/", "./")
        .replace(
          /import\s*\{\s*MONITORING_LANES,\s*type MonitoringScheduleStore,?\s*\}\s*from "\.\/store.js";/,
          'import { MONITORING_LANES, type MonitoringScheduleStore } from "./store.js";',
        );
      expect(createHash("sha256").update(frozen).digest("hex")).toBe(
        "fa3e060980ba9f3c5885140ff6280f8252ecde4ed635058eeb88ee19c948297f",
      );
      await scoped.query("TRUNCATE monitoring_lane_schedules");
      const red = nativeChild(true);
      expect(red.status, red.stderr).toBe(1);
      expect(red.stdout, red.stderr).toContain('"callerCaught":true');
      expect(red.stdout).toContain('"databaseError":true');
      expect(red.stdout).not.toContain('"survived":true');
      const before =
        await createPostgresMonitoringScheduleStore(scoped).getState("LLM");
      expect(before.lastResult).toBeNull();
      expect(before.activeRun).not.toBeNull();
      await scoped.query("TRUNCATE monitoring_lane_schedules");
      const green = nativeChild(false);
      expect(green.status, green.stderr).toBe(0);
      const observed = JSON.parse(green.stdout.trim().split("\n").at(-1)!);
      expect(observed).toMatchObject({
        survived: true,
        callerCaught: true,
        databaseError: true,
        resultAbsent: true,
        leaseRetained: true,
        other: "SUCCEEDED",
        restartStart: "ALREADY_RUNNING",
      });
    }, 60000);

    it("native runner failure is saved as FAILED rather than a fabricated success", async () => {
      await scoped.query("TRUNCATE monitoring_lane_schedules");
      const control = nativeChild(false, true);
      expect(control.status, control.stderr).toBe(0);
      const observed = JSON.parse(control.stdout.trim().split("\n").at(-1)!);
      expect(observed).toMatchObject({
        survived: true,
        callerCaught: false,
        llmStatus: "FAILED",
        other: "SUCCEEDED",
      });
    }, 30000);

    it.each([
      [503, 0],
      [200, 0],
      [503, -1],
      [200, -1],
    ])(
      "native PG authority order permits a scheduled fetch after explicit HTTP%i at %ims",
      async (nextStatus, elapsed) => {
        await scoped.query("TRUNCATE api_watch_authority_records");
        let calls = 0,
          status = 403;
        let now = new Date("2026-10-14T03:00:00Z");
        const initialTime = now.valueOf();
        const registry = createSourceRegistry({
          OZON_SELLER: { officialUrl: null, documents: [] },
          OZON_PERFORMANCE: { officialUrl: null, documents: [] },
          WILDBERRIES: {
            officialUrl: null,
            acceptedHosts: ["127.0.0.1"],
            requiredServerIdentity: undefined,
            titlePattern: undefined,
            documents: [
              {
                documentKey: "clock",
                officialUrl: "http://127.0.0.1/clock",
                expectedArtifactTypes: ["JSON"],
              },
            ],
          },
        });
        const store = createPostgresApiWatchStore(scoped);
        const dependencies = {
          registry,
          store,
          pendingStore: new InMemorySwaggerSourceStore(),
          now: () => new Date(now),
          fetcher: (async () => {
            calls++;
            return new Response(
              status === 200
                ? JSON.stringify({
                    openapi: "3.0.3",
                    info: { title: "Fixture", version: "1" },
                    paths: {
                      "/health": {
                        get: { responses: { "200": { description: "ok" } } },
                      },
                    },
                  })
                : "synthetic",
              { status },
            );
          }) as typeof fetch,
        };
        await runAuthorityPass(dependencies);
        status = nextStatus;
        now = new Date(now.valueOf() + elapsed);
        const explicit = await runAuthorityPass(dependencies);
        expect(
          explicit.outcomes.find((o) => o.sourceFamily === "WILDBERRIES")?.kind,
        ).toBe(
          status === 200
            ? "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE"
            : "SOURCE_TEMPORARILY_UNAVAILABLE",
        );
        const scheduled = await runAuthorityPass({
          ...dependencies,
          store: createPostgresApiWatchStore(scoped),
          skipOperatorBlocked: true,
        });
        expect(calls).toBe(3);
        expect(
          scheduled.outcomes.find((o) => o.sourceFamily === "WILDBERRIES")
            ?.kind,
        ).toBe(
          status === 200
            ? "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE"
            : "SOURCE_TEMPORARILY_UNAVAILABLE",
        );
        const rows = (
          await createPostgresApiWatchStore(scoped).listAuthorityRecords()
        ).filter((r) => r.sourceFamily === "WILDBERRIES");
        expect(rows).toHaveLength(3);
        expect(rows.map((r) => r.validatedAt.valueOf())).toEqual([
          initialTime,
          now.valueOf(),
          now.valueOf(),
        ]);
        expect(
          rows[1]!.safeProvenance.authorityRecordSequence as number,
        ).toBeGreaterThan(
          rows[0]!.safeProvenance.authorityRecordSequence as number,
        );
        expect(
          new Set(rows.map((r) => r.safeProvenance.authorityRecordSequence))
            .size,
        ).toBe(3);
      },
    );

    it.each([0, -1])(
      "native PG preserves later verified operator authority at %ims across a store restart",
      async (elapsed) => {
        await scoped.query("TRUNCATE api_watch_authority_records");
        let now = new Date("2026-10-14T03:00:00Z");
        let calls = 0,
          status = 403;
        const registry = createSourceRegistry({
          OZON_SELLER: { officialUrl: null, documents: [] },
          OZON_PERFORMANCE: { officialUrl: null, documents: [] },
          WILDBERRIES: {
            officialUrl: null,
            acceptedHosts: ["127.0.0.1"],
            requiredServerIdentity: undefined,
            titlePattern: undefined,
            documents: [
              {
                documentKey: "clock",
                officialUrl: "http://127.0.0.1/clock",
                expectedArtifactTypes: ["JSON"],
              },
            ],
          },
        });
        const store = createPostgresApiWatchStore(scoped);
        const dependencies = {
          registry,
          store,
          pendingStore: new InMemorySwaggerSourceStore(),
          now: () => new Date(now),
          fetcher: (async () => {
            calls++;
            return new Response("synthetic", { status });
          }) as typeof fetch,
        };
        await runAuthorityPass(dependencies);
        now = new Date(now.valueOf() + elapsed);
        const verified = await runAuthorityPass({
          ...dependencies,
          store: new InMemoryApiWatchStore(),
          fetcher: (async () =>
            new Response(
              JSON.stringify({
                openapi: "3.0.3",
                info: { title: "Fixture", version: "1" },
                paths: {
                  "/health": {
                    get: { responses: { "200": { description: "ok" } } },
                  },
                },
              }),
              { status: 200 },
            )) as typeof fetch,
        });
        const accepted = verified.records.find(
          (r) => r.sourceFamily === "WILDBERRIES",
        )!;
        expect(accepted.authorityStatus).toBe("AUTHORITY_ACCEPTED");
        const supplied = await store.saveAuthorityRecord({
          ...accepted,
          acquisitionMode: "OPERATOR_SUPPLIED",
          operatorRequestId: randomUUID(),
        });
        expect(supplied.validatedAt.valueOf()).toBe(now.valueOf());
        status = 503;
        const scheduled = await runAuthorityPass({
          ...dependencies,
          store: createPostgresApiWatchStore(scoped),
          skipOperatorBlocked: true,
        });
        expect(calls).toBe(2);
        expect(
          scheduled.outcomes.find((o) => o.sourceFamily === "WILDBERRIES")
            ?.kind,
        ).toBe("SOURCE_TEMPORARILY_UNAVAILABLE");
      },
    );

    it("native PG legacy equal-clock rows remain held until new explicit evidence", async () => {
      await scoped.query("TRUNCATE api_watch_authority_records");
      let status = 403,
        calls = 0;
      const dependencies = {
        registry: createSourceRegistry({
          OZON_SELLER: { officialUrl: null, documents: [] },
          OZON_PERFORMANCE: { officialUrl: null, documents: [] },
          WILDBERRIES: {
            officialUrl: null,
            acceptedHosts: ["127.0.0.1"],
            requiredServerIdentity: undefined,
            titlePattern: undefined,
            documents: [
              {
                documentKey: "clock",
                officialUrl: "http://127.0.0.1/clock",
                expectedArtifactTypes: ["JSON"],
              },
            ],
          },
        }),
        store: createPostgresApiWatchStore(scoped),
        pendingStore: new InMemorySwaggerSourceStore(),
        now: () => new Date("2026-10-14T03:00:00Z"),
        fetcher: (async () => {
          calls++;
          return new Response(
            status === 200
              ? JSON.stringify({
                  openapi: "3.0.3",
                  info: { title: "Fixture", version: "1" },
                  paths: {
                    "/health": {
                      get: { responses: { "200": { description: "ok" } } },
                    },
                  },
                })
              : "synthetic",
            { status },
          );
        }) as typeof fetch,
      };
      await runAuthorityPass(dependencies);
      status = 200;
      await runAuthorityPass(dependencies);
      await scoped.query(
        "UPDATE api_watch_authority_records SET safe_provenance = safe_provenance - 'authorityRecordSequence'",
      );
      const held = await runAuthorityPass({
        ...dependencies,
        store: createPostgresApiWatchStore(scoped),
        skipOperatorBlocked: true,
      });
      expect(calls).toBe(2);
      expect(
        held.outcomes.find((o) => o.sourceFamily === "WILDBERRIES")?.kind,
      ).toBe("OPERATOR_SOURCE_REQUIRED");
      await runAuthorityPass(dependencies);
      const released = await runAuthorityPass({
        ...dependencies,
        store: createPostgresApiWatchStore(scoped),
        skipOperatorBlocked: true,
      });
      expect(calls).toBe(4);
      expect(
        released.outcomes.find((o) => o.sourceFamily === "WILDBERRIES")?.kind,
      ).toBe("ACQUIRED_OFFICIAL_SOURCE_CANDIDATE");
    });

    it("native PG writers serialize reserved provenance order and another store reads it without caller spoofing", async () => {
      await scoped.query("TRUNCATE api_watch_authority_records");
      const now = new Date("2026-10-14T03:00:00Z");
      const input = {
        sourceFamily: "WILDBERRIES" as const,
        officialUrl: "http://127.0.0.1/clock",
        acquisitionMode: "AUTOMATIC" as const,
        authorityStatus: "AUTHORITY_BLOCKED" as const,
        sha256: null,
        sizeBytes: null,
        specVersion: null,
        acquiredAt: null,
        validatedAt: now,
        operatorRequestId: null,
        artifactExtension: null,
        failureClassification: "OPERATOR_SOURCE_REQUIRED",
        safeProvenance: {
          documentKey: "clock",
          authorityRecordSequence: Number.MAX_SAFE_INTEGER,
        },
      };
      const saved = await Promise.all(
        [1, 2, 3].map(() =>
          createPostgresApiWatchStore(scoped).saveAuthorityRecord(input),
        ),
      );
      expect(
        saved.map((r) => r.safeProvenance.authorityRecordSequence).sort(),
      ).toEqual([1, 2, 3]);
      const restored = createPostgresApiWatchStore(scoped);
      expect(
        (await restored.listAuthorityRecords()).map(
          (r) => r.safeProvenance.authorityRecordSequence,
        ),
      ).toEqual([1, 2, 3]);
      expect(
        (await restored.saveAuthorityRecord(input)).safeProvenance
          .authorityRecordSequence,
      ).toBe(4);
    });

    it("native PG preserves HTTP-date retry deadline across scheduler/store restart for all 13 WB documents", async () => {
      await scoped.query(
        "TRUNCATE monitoring_lane_schedules, api_watch_retry_state, api_watch_authority_records",
      );
      let now = new Date("2026-10-14T10:00:00Z"),
        calls = 0,
        passes = 0;
      const due = now.valueOf() + 20 * 60_000;
      const dateNow = vi
        .spyOn(Date, "now")
        .mockImplementation(() => now.valueOf());
      const registry = createSourceRegistry({
        OZON_SELLER: { officialUrl: null, documents: [] },
        OZON_PERFORMANCE: { officialUrl: null, documents: [] },
        WILDBERRIES: {
          officialUrl: null,
          acceptedHosts: ["127.0.0.1"],
          requiredServerIdentity: undefined,
          titlePattern: undefined,
          documents: productionSourceRegistry
            .get("WILDBERRIES")
            .documents!.map((doc, i) => ({
              ...doc,
              officialUrl: "http://127.0.0.1/native-http-date-" + i,
            })),
        },
      });
      const reportStore = new InMemoryApiWatchReportStore();
      const createScheduler = () => {
        const retryStore = createPostgresApiWatchRetryStore(scoped);
        const scheduleStore = createPostgresMonitoringScheduleStore(scoped);
        const authorityStore = createPostgresApiWatchStore(scoped);
        const instance = new IndependentMonitoringScheduler({
          store: scheduleStore,
          clock: { now: () => new Date(now) },
          runners: {
            LLM: async () => ({
              status: "SUCCEEDED",
              code: null,
              summary: "synthetic",
            }),
            SWAGGER_API: async (run) => {
              passes++;
              return runApiWatchReport({
                runId: run.runId,
                source: run.source,
                dependencies: {
                  registry,
                  store: authorityStore,
                  reportStore,
                  retryStore,
                  pendingStore: new InMemorySwaggerSourceStore(),
                  clock: () => new Date(now),
                  scheduleEarlier: async (at) => {
                    await instance.scheduleEarlier("SWAGGER_API", at);
                  },
                  fetcher: (async (url) => {
                    expect(String(url)).toMatch(
                      /^http:\/\/127\.0\.0\.1\/native-http-date-/,
                    );
                    calls++;
                    return new Response("synthetic rate limit", {
                      status: 429,
                      headers: {
                        "Retry-After": "Wed, 14 Oct 2026 10:20:00 GMT",
                      },
                    });
                  }) as typeof fetch,
                },
              });
            },
          },
        });
        return { instance, scheduleStore, retryStore };
      };
      let current = createScheduler();
      try {
        await current.scheduleStore.ensureDefaults(now);
        await current.instance.runNowAndWait("SWAGGER_API");
        const first = await current.retryStore.get("WILDBERRIES");
        expect(first?.nextRetryAt?.valueOf()).toBe(due);
        expect(first?.retryCount).toBe(1);
        expect(calls).toBe(13);
        await current.instance.stop();
        current = createScheduler();
        expect(
          (await current.retryStore.get("WILDBERRIES"))?.nextRetryAt?.valueOf(),
        ).toBe(due);
        now = new Date(due - 1);
        await current.instance.tick();
        expect(calls).toBe(13);
        now = new Date(due);
        await current.instance.tick();
        expect(calls).toBe(26);
        expect(passes).toBe(2);
        const exhausted = await current.retryStore.get("WILDBERRIES");
        expect(exhausted?.failureEpisodeId).toBe(first?.failureEpisodeId);
        expect(exhausted?.retryCount).toBe(1);
        expect(exhausted?.nextRetryAt).toBeNull();
        now = new Date(due + 60_000);
        await current.instance.tick();
        expect(calls).toBe(26);
      } finally {
        await current.instance.stop();
        dateNow.mockRestore();
      }
    });

    it("13 WB documents retain both scheduled retry passes on real PostgreSQL schedule/retry stores", async () => {
      await scoped.query(
        "TRUNCATE monitoring_lane_schedules, api_watch_retry_state",
      );
      let now = new Date("2026-10-14T00:00:00Z"),
        calls = 0,
        passes = 0;
      const store = createPostgresMonitoringScheduleStore(scoped);
      const retryStore = createPostgresApiWatchRetryStore(scoped);
      const registry = createSourceRegistry({
        OZON_SELLER: { officialUrl: null, documents: [] },
        OZON_PERFORMANCE: { officialUrl: null, documents: [] },
        WILDBERRIES: {
          officialUrl: null,
          acceptedHosts: ["127.0.0.1"],
          requiredServerIdentity: undefined,
          titlePattern: undefined,
          documents: productionSourceRegistry
            .get("WILDBERRIES")
            .documents!.map((doc, i) => ({
              ...doc,
              officialUrl: "http://127.0.0.1/native-review-doc-" + i,
            })),
        },
      });
      const apiStore = new InMemoryApiWatchStore(),
        reportStore = new InMemoryApiWatchReportStore();
      const scheduler = new IndependentMonitoringScheduler({
        store,
        clock: { now: () => new Date(now) },
        runners: {
          LLM: async () => ({
            status: "SUCCEEDED",
            code: null,
            summary: "synthetic",
          }),
          SWAGGER_API: async (run) => {
            passes++;
            return runApiWatchReport({
              runId: run.runId,
              source: run.source,
              dependencies: {
                registry,
                store: apiStore,
                reportStore,
                pendingStore: new InMemorySwaggerSourceStore(),
                retryStore,
                clock: () => new Date(now),
                scheduleEarlier: async (at) => {
                  await scheduler.scheduleEarlier("SWAGGER_API", at);
                },
                fetcher: (async (url) => {
                  expect(String(url)).toMatch(
                    /^http:\/\/127\.0\.0\.1\/native-review-doc-/,
                  );
                  calls++;
                  return new Response("synthetic", { status: 503 });
                }) as typeof fetch,
              },
            });
          },
        },
      });
      await store.ensureDefaults(now);
      await scheduler.runNowAndWait("SWAGGER_API");
      expect((await retryStore.get("WILDBERRIES"))?.retryCount).toBe(1);
      now = new Date(now.valueOf() + 15 * 60_000);
      await scheduler.tick();
      expect((await retryStore.get("WILDBERRIES"))?.retryCount).toBe(2);
      now = new Date(now.valueOf() + 60 * 60_000);
      await scheduler.tick();
      expect(passes).toBe(3);
      expect(calls).toBe(39);
      expect((await retryStore.get("WILDBERRIES"))?.nextRetryAt).toBeNull();
      await scheduler.stop();
    });
  },
);

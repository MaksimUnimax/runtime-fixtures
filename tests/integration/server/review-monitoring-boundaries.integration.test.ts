import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseRuntime } from "@product/db";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import {
  IndependentMonitoringScheduler,
  createPostgresMonitoringScheduleStore,
  InMemorySwaggerSourceStore,
} from "../../../packages/server/monitoring-control/src/index.js";
import { createPostgresApiWatchRetryStore } from "../../../tooling/api-watch/src/retry.js";
import { InMemoryApiWatchStore } from "../../../tooling/api-watch/src/authority.js";
import { InMemoryApiWatchReportStore } from "../../../tooling/api-watch/src/report.js";
import {
  createSourceRegistry,
  productionSourceRegistry,
} from "../../../tooling/api-watch/src/source-registry.js";
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
    import { IndependentMonitoringScheduler } from ${JSON.stringify(baseline ? baselineUrl : schedulerUrl)};
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
      console.log(JSON.stringify({callerCaught, databaseError}));}
    await new Promise(resolve => setTimeout(resolve, 25));
    const other = await scheduler.runNowAndWait("SWAGGER_API");
    const llm = await store.getState("LLM");
    const next = llm.activeRun ? await scheduler.runNow("LLM") : {kind: "COMPLETED"};
    await scheduler.stop();
    await runtime.close();
    console.log(JSON.stringify({survived: true, callerCaught, databaseError,
      resultAbsent: llm.lastResult === null, leaseRetained: llm.activeRun !== null,
      llmStatus: llm.lastResult?.status ?? null, other: other.status, restartStart: next.kind}));
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
      expect(red.status).toBe(1);
      expect(red.stdout).toContain('"callerCaught":true');
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

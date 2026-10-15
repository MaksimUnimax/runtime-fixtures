import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { createDatabaseRuntime, type DatabaseRuntime } from "./index.js";

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), 5_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Real pg pool and PostgreSQL; only selected query-promise outcomes are injected.
 * No migration, LOGIN, product data, or authentication configuration is changed.
 */
export async function proveDatabaseRuntimeRecovery(connectionString: string) {
  const url = new URL(connectionString);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (
    ![
      "octoport_a_test",
      "octoport_b_test",
      "octoport_c_test",
      "product_control_plane_test",
    ].includes(database)
  )
    throw new Error("R17_UNEXPECTED_TEST_DATABASE");
  const observer = createDatabaseRuntime(connectionString);
  const schema = "c06_r17_" + randomUUID().replaceAll("-", "");
  const checks: { name: string; passed: boolean }[] = [];
  const failures: string[] = [];
  const cleanup: Record<string, boolean> = {};
  const runtimes = new Set<DatabaseRuntime>();
  const closeAttempted = new Set<DatabaseRuntime>();
  const closeSucceeded = new Set<DatabaseRuntime>();
  let schemaAttempted = false;
  const originalConnect = Pool.prototype.connect;
  let injection:
    | {
        url: string;
        armed: boolean;
        pool?: Pool;
        client?: PoolClient;
        primary: unknown;
        rollbackFailure: boolean;
        commitFailure: boolean;
        commitCalls: number;
        rollbackCalls: number;
        releases: boolean[];
        ended: Promise<void>;
      }
    | undefined;
  function check(name: string, passed: boolean) {
    checks.push({ name, passed });
    assert.equal(passed, true, name);
  }
  function capture(error: unknown) {
    failures.push(
      error instanceof assert.AssertionError
        ? error.message
        : error instanceof Error
          ? error.name
          : typeof error,
    );
  }
  async function cleanupStep(name: string, action: () => Promise<boolean>) {
    try {
      cleanup[name] = await action();
    } catch (error) {
      cleanup[name] = false;
      capture(error);
    }
  }
  async function close(runtime: DatabaseRuntime) {
    if (closeAttempted.has(runtime)) return;
    closeAttempted.add(runtime);
    await bounded(runtime.close(), "R17_POOL_CLOSE_TIMEOUT");
    closeSucceeded.add(runtime);
  }
  // Only the first Promise-style checkout on this test's exact runtime URL is
  // instrumented. Observer and later pool.query checkouts use the real driver.
  Pool.prototype.connect = new Proxy(originalConnect, {
    apply(target, receiver: Pool, args: unknown[]) {
      const result: unknown = Reflect.apply(target, receiver, args);
      const current = injection;
      const options = receiver as unknown as {
        options: { connectionString?: string };
      };
      if (
        !current?.armed ||
        args.length !== 0 ||
        options.options.connectionString !== current.url
      )
        return result;
      current.armed = false;
      current.pool = receiver;
      return (result as Promise<PoolClient>).then((client) => {
        current.client = client;
        current.ended = new Promise<void>((resolve) =>
          client.once("end", resolve),
        );
        const originalQuery = client.query;
        const originalRelease = client.release;
        client.query = new Proxy(originalQuery, {
          apply(queryTarget, queryReceiver, queryArgs: unknown[]) {
            const sql = queryArgs[0];
            if (sql === "ROLLBACK") {
              current.rollbackCalls++;
              if (current.rollbackFailure)
                return Promise.reject(
                  new Error("R17_INJECTED_ROLLBACK_REJECTION"),
                );
            }
            if (sql === "COMMIT") {
              current.commitCalls++;
              const committed: unknown = Reflect.apply(
                queryTarget,
                queryReceiver,
                queryArgs,
              );
              return (committed as Promise<unknown>).then((value) => {
                if (current.commitFailure) throw current.primary;
                return value;
              });
            }
            return Reflect.apply(queryTarget, queryReceiver, queryArgs);
          },
        });
        client.release = (discard) => {
          current.releases.push(discard === true);
          client.query = originalQuery;
          originalRelease(discard);
        };
        return client;
      });
    },
  });
  try {
    const identity = await observer.query<{
      database: string;
      administrator: boolean;
      direct: boolean;
    }>(
      "SELECT current_database() AS database, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS administrator, current_user=session_user AS direct",
    );
    check(
      "connected_exact_disposable_administrator",
      identity.rows.length === 1 &&
        identity.rows[0]?.database === database &&
        identity.rows[0].administrator &&
        identity.rows[0].direct,
    );
    const absent = await observer.query<{ absent: boolean }>(
      "SELECT to_regnamespace($1) IS NULL AS absent",
      [schema],
    );
    check(
      "unique_scratch_schema_absent_before_creation",
      absent.rows[0]?.absent === true,
    );
    schemaAttempted = true;
    await observer.query(`CREATE SCHEMA ${schema}`);
    await observer.query(
      `CREATE TABLE ${schema}.events(label text PRIMARY KEY, value integer NOT NULL)`,
    );
    const scenarios = [
      {
        name: "success",
        businessFailure: false,
        commitFailure: false,
        rollbackFailure: false,
        statementFailure: false,
      },
      {
        name: "business_rollback_ok",
        businessFailure: true,
        commitFailure: false,
        rollbackFailure: false,
        statementFailure: false,
      },
      {
        name: "business_rollback_rejected",
        businessFailure: true,
        commitFailure: false,
        rollbackFailure: true,
        statementFailure: false,
      },
      {
        name: "commit_reply_rejected",
        businessFailure: false,
        commitFailure: true,
        rollbackFailure: false,
        statementFailure: false,
      },
      {
        name: "commit_and_rollback_rejected",
        businessFailure: false,
        commitFailure: true,
        rollbackFailure: true,
        statementFailure: false,
      },
      {
        name: "real_sql_error",
        businessFailure: false,
        commitFailure: false,
        rollbackFailure: false,
        statementFailure: true,
      },
    ];
    for (const scenario of scenarios) {
      const runtimeUrl = new URL(connectionString);
      runtimeUrl.searchParams.set(
        "application_name",
        schema + "_" + scenario.name,
      );
      const runtime = createDatabaseRuntime(runtimeUrl.toString());
      runtimes.add(runtime);
      injection = {
        url: runtimeUrl.toString(),
        armed: true,
        primary: new Error("R17_PRIMARY_" + scenario.name),
        rollbackFailure: scenario.rollbackFailure,
        commitFailure: scenario.commitFailure,
        commitCalls: 0,
        rollbackCalls: 0,
        releases: [],
        ended: Promise.resolve(),
      };
      const current = injection;
      const value = { accepted: scenario.name };
      let pid = 0,
        calls = 0;
      const result = await bounded(
        runtime
          .transaction(async (tx) => {
            calls++;
            pid = (
              await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
            ).rows[0]!.pid;
            await tx.query(`INSERT INTO ${schema}.events VALUES($1,17)`, [
              scenario.name,
            ]);
            if (scenario.statementFailure) {
              try {
                await tx.query("SELECT 1/0");
              } catch (error) {
                current.primary = error;
                throw error;
              }
            }
            if (scenario.businessFailure) throw current.primary;
            return value;
          })
          .then(
            (answer) => ({ rejected: false, answer, error: undefined }),
            (error: unknown) => ({ rejected: true, answer: undefined, error }),
          ),
        "R17_TRANSACTION_TIMEOUT",
      );
      const failed =
        scenario.businessFailure ||
        scenario.commitFailure ||
        scenario.statementFailure;
      const discarded = scenario.commitFailure || scenario.rollbackFailure;
      const committed = !scenario.businessFailure && !scenario.statementFailure;
      check(
        scenario.name + "_exact_primary_or_success",
        failed
          ? result.rejected && result.error === current.primary
          : !result.rejected && result.answer === value,
      );
      check(scenario.name + "_callback_once", calls === 1);
      check(
        scenario.name + "_commit_once_or_not_reached",
        current.commitCalls === (committed ? 1 : 0),
      );
      check(
        scenario.name + "_rollback_once_or_not_needed",
        current.rollbackCalls === (failed ? 1 : 0),
      );
      check(
        scenario.name + "_exact_single_release_policy",
        current.releases.length === 1 && current.releases[0] === discarded,
      );
      assert.ok(current.pool);
      assert.ok(current.client);
      assert.ok(pid > 0);
      if (discarded) {
        await bounded(current.ended, "R17_DISCARDED_CLIENT_END_TIMEOUT");
        check(
          scenario.name + "_real_pool_removed_connection",
          current.pool.totalCount === 0 && current.pool.idleCount === 0,
        );
        const gone = await observer.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=$1",
          [pid],
        );
        check(
          scenario.name + "_old_postgresql_backend_ended",
          gone.rows[0]?.n === 0,
        );
      } else {
        check(
          scenario.name + "_confirmed_connection_reusable",
          current.pool.totalCount === 1 && current.pool.idleCount === 1,
        );
      }
      const next = await runtime.query<{ pid: number; value: number }>(
        "SELECT pg_backend_pid() AS pid,17 AS value",
      );
      check(
        scenario.name + "_replacement_or_reused_backend_healthy",
        next.rows[0]?.value === 17 &&
          (discarded ? next.rows[0].pid !== pid : next.rows[0].pid === pid),
      );
      const rows = await observer.query<{ value: number }>(
        `SELECT value FROM ${schema}.events WHERE label=$1`,
        [scenario.name],
      );
      check(
        scenario.name + "_separate_connection_observes_exact_commit",
        committed
          ? rows.rows.length === 1 && rows.rows[0]?.value === 17
          : rows.rows.length === 0,
      );
      await close(runtime);
    }
  } catch (error) {
    capture(error);
  } finally {
    Pool.prototype.connect = originalConnect;
    cleanup.driver_prototype_restored =
      Pool.prototype.connect === originalConnect;
    for (const [index, runtime] of [...runtimes].entries()) {
      await cleanupStep("runtime_" + index + "_closed", async () => {
        // Failed/unknown pool-close outcomes are not silently retried.
        if (closeAttempted.has(runtime)) return closeSucceeded.has(runtime);
        await close(runtime);
        return true;
      });
    }
    await cleanupStep("own_scratch_schema_removed", async () => {
      if (schemaAttempted)
        await observer.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      const absent = await observer.query<{ absent: boolean }>(
        "SELECT to_regnamespace($1) IS NULL AS absent",
        [schema],
      );
      return absent.rows[0]?.absent === true;
    });
    await cleanupStep("own_backend_sessions_absent", async () => {
      const row = await observer.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name LIKE $1",
        [schema + "%"],
      );
      return row.rows[0]?.n === 0;
    });
    await cleanupStep("observer_closed", async () => {
      await observer.close();
      return true;
    });
  }
  return {
    kind: "C06_R17_REAL_PG_TRANSACTION_RECOVERY",
    verdict:
      failures.length === 0 &&
      checks.every((x) => x.passed) &&
      Object.values(cleanup).every(Boolean)
        ? "PASS_SCOPED_REAL_PG_POOL_RECOVERY"
        : "FAIL_OR_INCONCLUSIVE",
    total: checks.length,
    passed: checks.filter((x) => x.passed).length,
    checks,
    cleanup,
    failureTypes: failures,
    limits: [
      "Actual pg driver/pool and PostgreSQL with injected query-promise failures; not a TCP partition",
      "COMMIT-response failure is injected only after the real server COMMIT succeeds; durable state checked from separate connection",
      "Administrative disposable connection and own scratch schema only; no new LOGIN, migrations, roles or product data",
      "No persistent rollback hang or release-listener exception guarantee; no full old binary, pooler, restore or original four-P1 acceptance",
    ],
  };
}

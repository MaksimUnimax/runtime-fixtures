import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { Pool } from "pg";
import { AuthService, deriveAuthKeys } from "@product/auth";
import {
  DEFAULT_NO_SESSION_CADENCE,
  NoSessionObservationResultSchema,
} from "@product/health";
import { createApiApp } from "../../apps/api/src/app.js";
import { createInfrastructureReadiness } from "../../apps/api/src/infrastructure.js";
import {
  createAuthRepository,
  createDatabaseRuntime,
  createHealthAdminReadRepository,
  createHealthNoSessionCompletionAdapter,
  createHealthNoSessionPersistenceRepository,
  createHealthSchedulerRepository,
  type DatabaseRuntime,
} from "@product/db";
import { runMigrations } from "@product/db/migrations";
import type { AppConfig } from "@product/shared";
import { migrationsFolder } from "@product/db/migrations";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const executionId = randomUUID().replaceAll("-", "").slice(0, 12);
const archivePath = `/root/octoport-control/backups/B/b05-current0049-recovery-${executionId}.dump`;
const logPath = `/root/octoport-control/logs/B/b05-current0049-recovery-${executionId}.log`;
const targetReferencePath =
  "/root/octoport-control/backups/B/b05-current0049-restored-target.json";
const sourceDatabase = "octoport_b_recovery_source_current0049";
const targetDatabase = "octoport_b_recovery_restore_current0049";
const container = "octoport-b-test-pg";
const role = "octoport_test";
const databaseUrl = process.env.DATABASE_URL;

type Journal = { entries: Array<{ tag: string; when: number }> };

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function assertDisposableUrl(value: string | undefined): URL {
  assert(value, "DATABASE_URL_REQUIRED");
  const url = new URL(value);
  assert(
    url.protocol === "postgres:" || url.protocol === "postgresql:",
    "DATABASE_URL_SCHEME_INVALID",
  );
  assert(
    ["127.0.0.1", "localhost", "::1"].includes(url.hostname) &&
      url.port === "15542" &&
      decodeURIComponent(url.username) === role &&
      url.pathname === "/octoport_b_test",
    "DATABASE_URL_NOT_B_DISPOSABLE",
  );
  return url;
}

function derivedUrl(base: URL, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

function runContainerTool(
  args: string[],
  input?: NodeJS.ReadableStream,
  output?: NodeJS.WritableStream,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      "docker",
      ["exec", ...(input ? ["-i"] : []), container, ...args],
      {
        stdio: [input ? "pipe" : "ignore", output ? "pipe" : "pipe", "ignore"],
        env: { ...process.env, PGPASSWORD: undefined },
      },
    );
    let stdout = "";
    if (output) child.stdout?.pipe(output);
    else {
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });
    }
    child.once("error", () => reject(new Error("POSTGRES_TOOL_START_FAILED")));
    child.once("close", (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error("POSTGRES_TOOL_FAILED"));
    });
    if (input && child.stdin) input.pipe(child.stdin);
  });
}

async function dumpDatabase(database: string): Promise<void> {
  await mkdir(dirname(archivePath), { recursive: true, mode: 0o700 });
  const output = createWriteStream(archivePath, { mode: 0o600, flags: "w" });
  const done = once(output, "close");
  try {
    await runContainerTool(
      ["pg_dump", "-Fc", "-U", role, "-d", database],
      undefined,
      output,
    );
    output.end();
    await done;
  } catch (error) {
    output.destroy();
    throw error;
  }
  await chmod(archivePath, 0o600);
}

async function runRestore(target: string): Promise<void> {
  const { createReadStream } = await import("node:fs");
  await runContainerTool(
    ["pg_restore", "--exit-on-error", "--no-owner", "-U", role, "-d", target],
    createReadStream(archivePath),
  );
}

async function assertArchiveReadback(): Promise<{
  bytes: number;
  mode: string;
  sha256: string;
  tocEntries: number;
}> {
  const metadata = await stat(archivePath);
  const archive = await readFile(archivePath);
  const listing = await runContainerTool(
    ["pg_restore", "--list", "-"],
    (await import("node:fs")).createReadStream(archivePath),
  );
  const tocEntries = listing
    .split("\n")
    .filter((line) => /^\d+; /.test(line)).length;
  assert(metadata.isFile() && metadata.size > 0, "ARCHIVE_MISSING");
  assert((metadata.mode & 0o777).toString(8) === "600", "ARCHIVE_MODE_INVALID");
  assert(tocEntries > 0, "ARCHIVE_TOC_EMPTY");
  return {
    bytes: metadata.size,
    mode: (metadata.mode & 0o777).toString(8),
    sha256: createHash("sha256").update(archive).digest("hex"),
    tocEntries,
  };
}

function healthObservation(observedAt: Date) {
  return NoSessionObservationResultSchema.parse({
    providerId: "chatgpt",
    surfaceId: "CHATGPT_STANDARD",
    targetKey: "nosession_chatgpt_standard",
    strategyId: "b05-synthetic-public-check-v1",
    strategyRevision: 1,
    browserRuntime: {
      family: "chrome",
      browserName: "Chrome",
      browserVersion: "153.0.0.0",
      headless: true,
      sessionKind: "EPHEMERAL_CONTROLLED",
    },
    browserMode: {
      canonicalMode: "HEADLESS_DIAGNOSTIC",
      authoritativeMode: "HEADLESS_DIAGNOSTIC",
      diagnosticMode: null,
      fallbackAttempted: false,
      fallbackReason: "NOT_REQUIRED",
      headedInfrastructure: "NOT_CHECKED",
      environmentLimited: false,
      canonicalObservation: {
        mode: "HEADLESS_DIAGNOSTIC",
        identity: "PROVEN",
        blocker: "BROWSER_UNAVAILABLE",
        classification: "BROKEN",
        surfaceOutcome: "BROWSER_FAILURE",
      },
      diagnosticObservation: null,
    },
    navigation: "LOADED",
    navigationEvidence: {
      requestedStartUrl: "https://chatgpt.com",
      finalUrl: "https://chatgpt.com",
      finalOrigin: "https://chatgpt.com",
      mainDocumentHttpStatus: 200,
      redirectCount: 0,
      outcome: "LOADED",
    },
    finalOrigin: "https://chatgpt.com",
    expectedOriginValid: true,
    identity: "PROVEN",
    publicSurface: "REACHABLE",
    composer: "OBSERVED",
    editableInput: "OBSERVED",
    sendControl: "OBSERVED",
    authentication: "NOT_REQUIRED",
    blocker: "BROWSER_UNAVAILABLE",
    classification: "BROKEN",
    classificationBasis: "BROWSER_FAILURE",
    surfaceOutcome: "BROWSER_FAILURE",
    readiness: "APP_HYDRATED",
    elementMetadata: {
      composer: {
        elementCount: 1,
        visible: true,
        editable: true,
        actionable: true,
      },
      editableInput: {
        elementCount: 1,
        visible: true,
        editable: true,
        actionable: true,
      },
      sendControl: {
        elementCount: 1,
        visible: true,
        editable: false,
        actionable: true,
      },
    },
    noInteraction: true,
    observedAt: observedAt.toISOString(),
    evidence: [
      {
        evidenceId: "b0500000-0000-4000-8000-000000000501",
        ruleId: "SAFE_ELEMENT_METADATA",
        classification: "METADATA",
        sha256: "b".repeat(64),
        sizeBytes: 96,
      },
    ],
  });
}

async function migrationFacts(runtime: DatabaseRuntime, journal: Journal) {
  const result = await runtime.query<{ count: string; latest: string | null }>(
    "SELECT count(*)::text AS count, max(created_at)::text AS latest FROM drizzle.__drizzle_migrations",
  );
  const rows = await runtime.query<{ hash: string; created_at: string }>(
    "SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at,id",
  );
  const last = journal.entries.at(-1);
  assert(journal.entries.length === 39, "SOURCE_JOURNAL_COUNT_INVALID");
  assert(
    last?.tag === "0049_s2_l5_no_session_persistence",
    "SOURCE_JOURNAL_NOT_0049",
  );
  assert(result.rows[0]?.count === "39", "APPLIED_JOURNAL_COUNT_INVALID");
  assert(
    result.rows[0]?.latest === String(last.when),
    "APPLIED_JOURNAL_NOT_0049",
  );
  assert(rows.rows.length === 39, "APPLIED_JOURNAL_ROWS_INVALID");
  return {
    count: result.rows[0].count,
    latestTag: last.tag,
    latestWhen: String(last.when),
    identitySha256: createHash("sha256")
      .update(JSON.stringify(rows.rows))
      .digest("hex"),
  };
}

async function seedHealthAuthority(
  runtime: DatabaseRuntime,
  scheduledAt: Date,
) {
  const ids = {
    adapter: "b0500000-0000-4000-8000-000000000001",
    surface: "b0500000-0000-4000-8000-000000000002",
    profile: "b0500000-0000-4000-8000-000000000003",
    revision: "b0500000-0000-4000-8000-000000000004",
    schedule: "b0500000-0000-4000-8000-000000000005",
  };
  await runtime.query(
    "INSERT INTO ai_adapters(id,machine_key,display_name) VALUES($1,'chatgpt','Synthetic ChatGPT')",
    [ids.adapter],
  );
  await runtime.query(
    "INSERT INTO ai_surfaces(id,adapter_id,machine_key,display_name) VALUES($1,$2,'standard','Synthetic Standard')",
    [ids.surface, ids.adapter],
  );
  await runtime.query(
    "INSERT INTO adapter_profiles(id,adapter_id,surface_id,machine_key,display_name) VALUES($1,$2,$3,'b05-synthetic-public-check-v1','Synthetic public profile')",
    [ids.profile, ids.adapter, ids.surface],
  );
  await runtime.query(
    `INSERT INTO adapter_profile_revisions(id,profile_id,adapter_id,surface_id,revision,schema_version,state,content,compatibility_constraints,content_sha256)
     VALUES($1,$2,$3,$4,1,'adapter_profile_v1','DRAFT','{}'::jsonb,'{"browserFamilies":["chrome"]}'::jsonb,$5)`,
    [ids.revision, ids.profile, ids.adapter, ids.surface, "1".repeat(64)],
  );
  await runtime.query(
    "UPDATE adapter_profile_revisions SET state='CANDIDATE' WHERE id=$1",
    [ids.revision],
  );
  await runtime.query(
    "UPDATE adapter_profile_revisions SET state='PUBLISHED',published_at=$2 WHERE id=$1",
    [ids.revision, scheduledAt],
  );
  return ids;
}

async function seedScheduledObservation(runtime: DatabaseRuntime) {
  const scheduler = createHealthSchedulerRepository(runtime);
  const persistence = createHealthNoSessionPersistenceRepository(runtime);
  const scheduledAt = new Date(Date.now() - 10_000);
  const ids = await seedHealthAuthority(runtime, scheduledAt);
  await scheduler.createSchedule({
    scheduleId: ids.schedule,
    monitorTarget: "nosession_chatgpt_standard",
    provider: "chatgpt",
    surface: "CHATGPT_STANDARD",
    probeLayer: "NO_SESSION",
    enabled: true,
    cadence: DEFAULT_NO_SESSION_CADENCE,
    nextDueAt: scheduledAt,
    revision: 1,
  });
  const scheduled = await scheduler.materializeDueSlot(
    ids.schedule,
    scheduledAt,
  );
  assert(scheduled, "SCHEDULE_NOT_MATERIALIZED");
  const claimed = await scheduler.claimNext({
    ownerId: "b05-synthetic-recovery",
    now: new Date(scheduledAt.getTime() + 1),
    leaseMs: 300_000,
  });
  assert(
    claimed?.id === scheduled.id && claimed.leaseId,
    "SCHEDULE_NOT_CLAIMED",
  );
  await scheduler.startRun({
    runId: claimed.id,
    ownerId: claimed.ownerId!,
    leaseId: claimed.leaseId,
    now: new Date(scheduledAt.getTime() + 2),
  });
  const observedAt = new Date(scheduledAt.getTime() + 3_000);
  const observation = healthObservation(observedAt);
  const input = {
    scheduledRunId: scheduled.id,
    observation,
    classifierVersion: "b05-synthetic-current0049-v1",
    startedAt: new Date(observedAt.getTime() - 1_000),
    completedAt: new Date(observedAt.getTime() + 1_000),
  };
  const persisted = await persistence.persistCompletedNoSessionHealthRun(input);
  const admin = createHealthAdminReadRepository(runtime);
  const summary = await runtime.query<{ scope_sha256: string }>(
    "SELECT scope_sha256 FROM health_runs WHERE id=$1",
    [persisted.healthRunId],
  );
  const detail = await admin.getTarget(summary.rows[0]!.scope_sha256);
  assert(
    detail?.evidenceReferences.length === 1,
    "SOURCE_HEALTH_EVIDENCE_MISSING",
  );
  return {
    scheduleId: ids.schedule,
    scheduledRunId: scheduled.id,
    healthRunId: persisted.healthRunId,
    input,
  };
}

async function counts(runtime: DatabaseRuntime) {
  const result = await runtime.query<{
    runs: string;
    observations: string;
    incidents: string;
    notifications: string;
  }>(`SELECT
      (SELECT count(*)::text FROM health_runs) AS runs,
      (SELECT count(*)::text FROM health_no_session_observations) AS observations,
      (SELECT count(*)::text FROM health_incidents) AS incidents,
      (SELECT count(*)::text FROM health_notification_intents WHERE source_domain='LLM_HEALTH') AS notifications`);
  return result.rows[0]!;
}

async function closeRuntime(runtime: DatabaseRuntime | undefined) {
  if (runtime) await runtime.close();
}

async function main() {
  const suppliedUrl = assertDisposableUrl(databaseUrl);
  const runId = executionId;
  const source = sourceDatabase;
  const target = targetDatabase;
  const adminPool = new Pool({ connectionString: suppliedUrl.toString() });
  let sourceRuntime: DatabaseRuntime | undefined;
  let restoredRuntime: DatabaseRuntime | undefined;
  let createdSource = false;
  let createdTarget = false;
  let keepTarget = false;
  let output = "";
  try {
    await mkdir(dirname(targetReferencePath), { recursive: true, mode: 0o700 });
    await rm(targetReferencePath, { force: true });
    await adminPool.query(
      `DROP DATABASE IF EXISTS ${sourceDatabase} WITH (FORCE)`,
    );
    await adminPool.query(
      `DROP DATABASE IF EXISTS ${targetDatabase} WITH (FORCE)`,
    );
    const journalText = await readFile(
      `${migrationsFolder}/meta/_journal.json`,
      "utf8",
    );
    const journal = JSON.parse(journalText) as Journal;
    const journalSha256 = createHash("sha256")
      .update(journalText)
      .digest("hex");
    assert(
      journal.entries.length === 39 &&
        journal.entries.at(-1)?.tag === "0049_s2_l5_no_session_persistence",
      "SOURCE_JOURNAL_INVALID",
    );
    await adminPool.query(`CREATE DATABASE ${source}`);
    createdSource = true;
    await adminPool.query(`CREATE DATABASE ${target}`);
    createdTarget = true;
    const sourceUrl = derivedUrl(suppliedUrl, source);
    const targetUrl = derivedUrl(suppliedUrl, target);
    await runMigrations({ connectionString: sourceUrl });
    sourceRuntime = createDatabaseRuntime(sourceUrl);
    await sourceRuntime.ready();
    const sourceMigrations = await migrationFacts(sourceRuntime, journal);

    const authKeys = deriveAuthKeys(Buffer.alloc(32, 0x49));
    const auth = new AuthService(
      createAuthRepository(sourceRuntime),
      authKeys,
      () => new Date(),
      () => "490049",
    );
    const syntheticEmail = `b05-${runId}@example.test`;
    const requested = await auth.requestOtp(
      syntheticEmail,
      "198.51.100.49",
      `b05-${runId}-request`,
    );
    assert(requested.ok, "SYNTHETIC_OTP_REQUEST_FAILED");
    const verified = await auth.verifyOtp(
      requested.value.challengeId,
      "490049",
      "198.51.100.49",
      `b05-${runId}-verify`,
    );
    assert(verified.ok, "SYNTHETIC_OTP_VERIFY_FAILED");
    const identity = await auth.authenticate(verified.value.sessionToken);
    assert(identity, "SYNTHETIC_AUTHENTICATE_FAILED");
    const owned = await auth.listOwnedAccounts(identity.userId);
    assert(
      owned.length === 1 && owned[0]?.status === "ACTIVE",
      "SYNTHETIC_ACCOUNT_MISSING",
    );
    const health = await seedScheduledObservation(sourceRuntime);
    await dumpDatabase(source);
    const archive = await assertArchiveReadback();
    await runRestore(target);

    restoredRuntime = createDatabaseRuntime(targetUrl);
    await restoredRuntime.ready();
    const restoredMigrations = await migrationFacts(restoredRuntime, journal);
    const restoredAuth = new AuthService(
      createAuthRepository(restoredRuntime),
      authKeys,
    );
    const restoredIdentity = await restoredAuth.authenticate(
      verified.value.sessionToken,
    );
    assert(
      restoredIdentity?.userId === identity.userId,
      "RESTORED_AUTHENTICATE_FAILED",
    );
    const restoredAccounts = await restoredAuth.listOwnedAccounts(
      restoredIdentity.userId,
    );
    assert(
      restoredAccounts.length === 1 && restoredAccounts[0]?.status === "ACTIVE",
      "RESTORED_ACCOUNT_MISSING",
    );
    const restoredApplicationCounts = await restoredRuntime.query<{
      users: string;
      accounts: string;
      sessions: string;
    }>(`SELECT
        (SELECT count(*)::text FROM users) AS users,
        (SELECT count(*)::text FROM accounts) AS accounts,
        (SELECT count(*)::text FROM portal_sessions) AS sessions`);
    assert(
      restoredApplicationCounts.rows[0]?.users === "1" &&
        restoredApplicationCounts.rows[0]?.accounts === "1" &&
        restoredApplicationCounts.rows[0]?.sessions === "1",
      "RESTORED_APPLICATION_COUNTS_INVALID",
    );

    const runRow = await restoredRuntime.query<{
      run_kind: string;
      health_state: string;
      scheduled_run_id: string;
    }>(
      "SELECT run_kind,health_state,scheduled_run_id FROM health_runs WHERE id=$1",
      [health.healthRunId],
    );
    const observationRow = await restoredRuntime.query<{
      classification: string;
      target_key: string;
      blocker: string;
      strategy_id: string;
    }>(
      "SELECT classification,observation->>'targetKey' AS target_key,observation->>'blocker' AS blocker,observation->>'strategyId' AS strategy_id FROM health_no_session_observations WHERE run_id=$1",
      [health.healthRunId],
    );
    const evidenceRows = await restoredRuntime.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM health_no_session_evidence_references WHERE run_id=$1",
      [health.healthRunId],
    );
    assert(
      runRow.rows[0]?.run_kind === "NO_SESSION_OBSERVATION" &&
        runRow.rows[0]?.health_state === "BROKEN" &&
        runRow.rows[0]?.scheduled_run_id === health.scheduledRunId,
      "RESTORED_HEALTH_RUN_MISSING",
    );
    assert(
      observationRow.rows[0]?.classification === "BROKEN" &&
        observationRow.rows[0]?.target_key === "nosession_chatgpt_standard" &&
        observationRow.rows[0]?.blocker === "BROWSER_UNAVAILABLE" &&
        observationRow.rows[0]?.strategy_id === "b05-synthetic-public-check-v1",
      "RESTORED_HEALTH_DETAIL_MISSING",
    );
    assert(
      evidenceRows.rows[0]?.count === "1",
      "RESTORED_HEALTH_EVIDENCE_MISSING",
    );

    const config: AppConfig = {
      environment: "test",
      databaseUrl: targetUrl,
      logLevel: "silent",
      apiPort: 3000,
      workerReadyDelayMs: 0,
    };
    const app = createApiApp({
      config,
      isInfrastructureReady: createInfrastructureReadiness(restoredRuntime),
    });
    const readinessStatus = (await app.inject("/health/ready")).statusCode;
    await app.close();
    assert(readinessStatus === 200, "RESTORED_API_NOT_READY");

    const scheduler = createHealthSchedulerRepository(restoredRuntime);
    const completion = createHealthNoSessionCompletionAdapter(restoredRuntime);
    assert(
      (await scheduler.reconcilePersistedResults(
        new Date(Date.now() + 60_000),
      )) === 1,
      "RESTORE_RECONCILIATION_DID_NOT_RECOVER",
    );
    const firstCounts = await counts(restoredRuntime);
    const afterReplay = await completion.completeScheduledNoSessionHealthRun(
      health.input,
    );
    assert(
      afterReplay.healthRunId === health.healthRunId,
      "RESTORED_COMPLETION_CHANGED_RUN",
    );
    assert(
      (await scheduler.reconcilePersistedResults(
        new Date(Date.now() + 120_000),
      )) === 0,
      "RESTORE_RECONCILIATION_NOT_IDEMPOTENT",
    );
    const finalCounts = await counts(restoredRuntime);
    assert(
      JSON.stringify(firstCounts) === JSON.stringify(finalCounts),
      "RESTORE_REPLAY_CREATED_DUPLICATES",
    );
    assert(
      firstCounts.runs === "1" &&
        firstCounts.observations === "1" &&
        firstCounts.incidents === "1" &&
        firstCounts.notifications === "1",
      "RESTORED_COUNTS_INVALID",
    );
    const schedule = await scheduler.getScheduledRun(health.scheduledRunId);
    assert(
      schedule?.state === "SUCCEEDED" &&
        schedule.healthRunId === health.healthRunId,
      "RESTORED_SCHEDULE_NOT_RECONCILED",
    );

    assert(
      sourceMigrations.identitySha256 === restoredMigrations.identitySha256,
      "RESTORED_MIGRATION_JOURNAL_IDENTITY_MISMATCH",
    );
    const revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    await writeFile(
      targetReferencePath,
      JSON.stringify(
        {
          databaseUrl: targetUrl,
          database: target,
          container,
          sourceRevision: revision,
          sourceTree: tree,
          migrationJournalSha256: journalSha256,
          archivePath,
          archiveSha256: archive.sha256,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    await chmod(targetReferencePath, 0o600);
    keepTarget = true;
    output = [
      `source_revision=${revision}`,
      `source_tree=${tree}`,
      `database_container=${container}`,
      `migration_journal_file_sha256=${journalSha256}`,
      `migration_journal_source=${sourceMigrations.count}/${sourceMigrations.latestTag}/${sourceMigrations.latestWhen}/${sourceMigrations.identitySha256}`,
      `migration_journal_restored=${restoredMigrations.count}/${restoredMigrations.latestTag}/${restoredMigrations.latestWhen}/${restoredMigrations.identitySha256}`,
      `synthetic_auth=PASS users=${restoredApplicationCounts.rows[0]?.users} accounts=${restoredApplicationCounts.rows[0]?.accounts} sessions=${restoredApplicationCounts.rows[0]?.sessions}`,
      `health=PASS classification=${observationRow.rows[0].classification} evidence=${evidenceRows.rows[0].count} reconciled=${schedule.state}`,
      `api_health_ready=${readinessStatus}`,
      `counts=runs:${finalCounts.runs},observations:${finalCounts.observations},incidents:${finalCounts.incidents},llm_health_outbox:${finalCounts.notifications}`,
      `archive_sha256=${archive.sha256}`,
      `archive_bytes=${archive.bytes}`,
      `archive_mode=${archive.mode}`,
      `archive_toc_entries=${archive.tocEntries}`,
      `restored_target_reference=${targetReferencePath}`,
      "result=PASS",
    ].join("\n");
  } catch (error) {
    const errorCode =
      error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "B05_RECOVERY_REHEARSAL_FAILED";
    output = `result=FAIL\nerror=${errorCode}`;
    throw new Error(errorCode);
  } finally {
    await closeRuntime(restoredRuntime);
    await closeRuntime(sourceRuntime);
    if (createdTarget && !keepTarget)
      await adminPool.query(`DROP DATABASE IF EXISTS ${target} WITH (FORCE)`);
    if (createdSource)
      await adminPool.query(`DROP DATABASE IF EXISTS ${source} WITH (FORCE)`);
    await adminPool.end();
    await mkdir(dirname(logPath), { recursive: true, mode: 0o700 });
    await writeFile(
      logPath,
      `${output || "result=FAIL\nerror=B05_RECOVERY_REHEARSAL_FAILED"}\n`,
      { mode: 0o600 },
    );
    process.stdout.write(`${output}\n`);
  }
}

await main();

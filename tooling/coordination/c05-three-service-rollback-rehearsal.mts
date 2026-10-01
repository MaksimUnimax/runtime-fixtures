import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  chmod,
  chown,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openSync, closeSync } from "node:fs";
import { createServer } from "node:net";
import {
  parseServiceRuntimeIdentity,
  publicServiceRuntimeIdentity,
  verifyServiceRuntimeIdentity,
  verifyServiceRuntimeTreeReadOnly,
  type ServiceRuntimeIdentity,
} from "./c05-service-runtime-identity.mts";
import {
  FIRST_BETA_WAVE_RESOURCE_SAMPLE_EVERY_CYCLES,
  ServiceResourceEnvelopeSampler,
  parseFirstBetaWaveSequentialCycles,
  summarizeServiceResourceEnvelope,
  summarizeServiceResourceEnvelopeSeries,
  type ResourceSample,
} from "./c05-service-resource-envelope.mts";

// C05 is intentionally a source rehearsal. It restores the accepted journal-40
// seed, migrates it forward with the exact candidate, proves a post-upgrade
// backup/restore, and then changes only which exact source snapshot serves that
// restored forward schema.
const FLOOR = "d24838669c54f21dc161dc48a7e71e0e288384c2";
const NODE = "/root/.nvm/versions/node/v24.20.0/bin/node";
const PNPM = "pnpm";
const DISPOSABLE_DATABASES = [
  {
    container: "octoport-b-test-pg",
    port: "15542",
    databasePath: "/octoport_b_test",
    evidenceRoots: [
      "/root/octoport-control/logs/B/",
      "/root/octoport-control/artifacts/B/",
    ],
  },
  {
    container: "octoport-c-test-pg",
    port: "15543",
    databasePath: "/octoport_c_test",
    evidenceRoots: [
      "/root/octoport-control/logs/C/",
      "/root/octoport-control/artifacts/C/",
    ],
  },
] as const;
const RESTORE = "/root/octoport-control/backups/C/c05-final0051-state.dump";
const RESTORE_SHA256 =
  "5a95e34431baa6d64159ea5cf912a719ad0e35fe78807c15d9380ea6dc175fc9";
const PRIVATE_STATE =
  "/root/octoport-control/logs/C/c05-final0051-runtime-state.json";
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DEADLINE_MS = 30_000;
const shaRE = /^([0-9a-f]{40})$/;
type Child = ChildProcess & { exitCode: number | null };
type RuntimeDeviceState = {
  deviceId: string;
  sessionId: string;
  accessToken: string;
};
type SeedRuntimeState = {
  rootSecretB64: string;
  accessKeyId: string;
  accessPrivateB64: string;
  configKeyId: string;
  configPrivateB64: string;
  configPublicSpkiB64: string;
  accountId: string;
  present: RuntimeDeviceState;
  withheld: RuntimeDeviceState;
};
type RehearsalRuntimeState = SeedRuntimeState & {
  portalSessionId: string;
  portalToken: string;
  synthetic: RuntimeDeviceState;
  baselineMetadata: unknown;
};
type BaselineDeviceRow = {
  id: string;
  browser_family: string | null;
  browser_version_last_seen: string | null;
  extension_version_last_seen: string | null;
};
function check(v: unknown, code: string): asserts v {
  if (!v) throw new Error(code);
}
function sha(s: string) {
  check(shaRE.test(s), "INVALID_CANDIDATE_SHA");
  return s;
}
function hash(b: Buffer | string) {
  return createHash("sha256").update(b).digest("hex");
}
function mark(value: string) {
  process.stderr.write(`C05_PHASE:${value}\n`);
}
function loopback(host: string) {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);
}
function command(
  bin: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: Buffer;
    timeout?: number;
  } = {},
) {
  return new Promise<{ stdout: Buffer; stderr: Buffer }>(
    (resolvePromise, reject) => {
      const child = spawn(bin, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const out: Buffer[] = [],
        err: Buffer[] = [];
      child.stdout.on("data", (b) => out.push(Buffer.from(b)));
      child.stderr.on("data", (b) => err.push(Buffer.from(b)));
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2500).unref();
        reject(new Error(`COMMAND_TIMEOUT:${bin}`));
      }, options.timeout ?? DEADLINE_MS);
      child.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (code !== 0)
          reject(
            new Error(
              `COMMAND_FAILED:${bin}:${code}:${Buffer.concat(err).toString("utf8").slice(-1200)}`,
            ),
          );
        else
          resolvePromise({
            stdout: Buffer.concat(out),
            stderr: Buffer.concat(err),
          });
      });
      child.stdin.end(options.input);
    },
  );
}
function spawnService(
  bin: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  logPath: string,
  identity: ServiceRuntimeIdentity | null,
): Promise<Child> {
  return new Promise((resolvePromise, reject) => {
    const fd = openSync(logPath, "w", 0o600);
    const c = spawn(bin, args, {
      cwd,
      env,
      stdio: ["ignore", fd, fd],
      ...(identity ? { uid: identity.uid, gid: identity.gid } : {}),
    }) as Child;
    c.once("close", () => closeSync(fd));
    c.once("spawn", async () => {
      try {
        if (identity) {
          check(c.pid, "C05_SERVICE_PID_MISSING");
          verifyServiceRuntimeIdentity(
            await readFile(`/proc/${c.pid}/status`, "utf8"),
            identity,
          );
        }
        resolvePromise(c);
      } catch (error) {
        c.kill("SIGTERM");
        reject(error);
      }
    });
    c.once("error", reject);
  });
}
async function stop(c: Child | undefined) {
  if (!c || c.exitCode !== null) return;
  c.kill("SIGTERM");
  const kill = setTimeout(() => c.kill("SIGKILL"), 5000);
  await once(c, "close");
  clearTimeout(kill);
}
async function get(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "error",
    });
  } finally {
    clearTimeout(timer);
  }
}
async function poll(
  fn: () => Promise<boolean>,
  label: string,
  processList: Child[],
) {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    if (processList.some((p) => p.exitCode !== null))
      throw new Error(`SERVICE_EXITED:${label}`);
    try {
      if (await fn()) return;
    } catch (error) {
      void error;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`TIMEOUT:${label}`);
}
async function reserveFreePorts(count: number): Promise<number[]> {
  const servers = Array.from({ length: count }, () => createServer());
  try {
    await Promise.all(
      servers.map(
        (s) =>
          new Promise<void>((resolvePromise, reject) => {
            s.once("error", reject);
            s.listen({ host: "127.0.0.1", port: 0 }, () => resolvePromise());
          }),
      ),
    );
    return servers.map(
      (s) => (s.address() as import("node:net").AddressInfo).port,
    );
  } finally {
    await Promise.all(
      servers.map(
        (s) =>
          new Promise<void>((resolvePromise) =>
            s.close(() => resolvePromise()),
          ),
      ),
    );
  }
}
function safeEnv(
  base: NodeJS.ProcessEnv,
  overrides: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"])
    if (base[k]) env[k] = base[k];
  // Fail closed instead of inheriting any real provider destination or credential.
  for (const k of Object.keys(base))
    if (
      /^(SMTP|MAIL|EMAIL|TELEGRAM|PAYMENT|STRIPE|PROVIDER|MARKETPLACE)_/i.test(
        k,
      ) &&
      base[k]
    )
      throw new Error(`UNSAFE_OUTBOUND_ENV_PRESENT:${k}`);
  const merged = { ...env, ...overrides };
  for (const [key, value] of Object.entries(merged))
    if (value === undefined) delete merged[key];
  return merged;
}
const supplied = process.env.DATABASE_URL;
check(supplied, "DATABASE_URL_REQUIRED");
const dbBase = new URL(supplied);
const disposableDatabase = DISPOSABLE_DATABASES.find(
  (target) =>
    loopback(dbBase.hostname) &&
    dbBase.port === target.port &&
    dbBase.pathname.replace(/\/$/, "") === target.databasePath,
);
check(disposableDatabase, "NOT_OWNED_DISPOSABLE_DATABASE");
const DB_CONTAINER = disposableDatabase.container;
const candidate = sha(process.env.C05_CANDIDATE_SHA ?? "");
const evidenceDir = process.env.C05_EVIDENCE_DIR;
check(
  evidenceDir &&
    disposableDatabase.evidenceRoots.some((root) =>
      resolve(evidenceDir).startsWith(root),
    ),
  "C05_EVIDENCE_DIR_ROLE_MISMATCH",
);
const serviceRuntimeIdentity = parseServiceRuntimeIdentity(process.env);
const publicRuntimeIdentity = publicServiceRuntimeIdentity(
  serviceRuntimeIdentity,
);
const resourceEnvelopeFlag = process.env.C05_CAPTURE_SERVICE_RESOURCE_ENVELOPE;
check(
  resourceEnvelopeFlag === undefined ||
    resourceEnvelopeFlag === "" ||
    resourceEnvelopeFlag === "1",
  "C05_RESOURCE_ENVELOPE_FLAG_INVALID",
);
const captureServiceResourceEnvelope = resourceEnvelopeFlag === "1";
if (captureServiceResourceEnvelope)
  check(
    serviceRuntimeIdentity,
    "C05_RESOURCE_ENVELOPE_REQUIRES_NONROOT_IDENTITY",
  );
const firstWaveSequentialCycles = parseFirstBetaWaveSequentialCycles(
  process.env.C05_FIRST_WAVE_SEQUENTIAL_CYCLES,
);
if (firstWaveSequentialCycles > 0) {
  check(
    captureServiceResourceEnvelope,
    "C05_FIRST_WAVE_REQUIRES_RESOURCE_ENVELOPE",
  );
  check(serviceRuntimeIdentity, "C05_FIRST_WAVE_REQUIRES_NONROOT_IDENTITY");
}

const envNames = Object.keys(process.env);
for (const k of envNames)
  if (
    /^(SMTP|MAIL|EMAIL|TELEGRAM|PAYMENT|STRIPE|PROVIDER|MARKETPLACE)_/i.test(
      k,
    ) &&
    process.env[k]
  )
    throw new Error(`UNSAFE_OUTBOUND_ENV_PRESENT:${k}`);

const work = await mkdtemp(join(tmpdir(), "c05-three-service-"));
let serviceNode = NODE;
let serviceRuntimeEnv: NodeJS.ProcessEnv = {};
if (serviceRuntimeIdentity) {
  await chmod(work, 0o755);
  const serviceHome = join(work, "service-home");
  const serviceTmp = join(work, "service-tmp");
  await mkdir(serviceHome, { mode: 0o700 });
  await mkdir(serviceTmp, { mode: 0o700 });
  await chown(
    serviceHome,
    serviceRuntimeIdentity.uid,
    serviceRuntimeIdentity.gid,
  );
  await chown(
    serviceTmp,
    serviceRuntimeIdentity.uid,
    serviceRuntimeIdentity.gid,
  );
  serviceNode = join(work, "node-v24.20.0");
  await copyFile(NODE, serviceNode);
  await chmod(serviceNode, 0o755);
  serviceRuntimeEnv = { HOME: serviceHome, TMPDIR: serviceTmp };
}
const dbName = `c05_rehearsal_${randomBytes(6).toString("hex")}`;
check(/^[a-z][a-z0-9_]{4,62}$/.test(dbName), "INVALID_DB_NAME");
const dbUrl = new URL(dbBase);
dbUrl.pathname = `/${dbName}`;
const archiveDir = join(work, "archives");
await import("node:fs/promises").then((fs) =>
  fs.mkdir(archiveDir, { recursive: true }),
);
await import("node:fs/promises").then((fs) =>
  fs.mkdir(evidenceDir, { recursive: true }),
);
const phases: unknown[] = [];
const migrationEvidence: {
  sourceJournal: number;
  targetJournal: number | null;
  upgradedBackupSha256: string | null;
  upgradedBackupBytes: number | null;
  upgradedBackupFile: string | null;
} = {
  sourceJournal: 40,
  targetJournal: null,
  upgradedBackupSha256: null,
  upgradedBackupBytes: null,
  upgradedBackupFile: null,
};
const evidence = {
  schema: "c05-three-service-rollback-v2",
  candidate,
  rollbackFloor: FLOOR,
  databaseName: dbName,
  createdAt: new Date().toISOString(),
  ...(serviceRuntimeIdentity ? { runtimeIdentity: publicRuntimeIdentity } : {}),
  migration: migrationEvidence,
  phases,
};
let expectedJournalCount = migrationEvidence.sourceJournal;
const privatePath = join(evidenceDir, `.c05-private-${randomUUID()}.json`);
let privateState: RehearsalRuntimeState;
const services: Child[] = [];
let forgottenSyntheticMetadataSha256: string | undefined;
let upgradedBackup: Buffer | undefined;
let disposableDbCreated = false;
type SetupRuntime = {
  ready(): Promise<void>;
  close(): Promise<void>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
};
let setupRuntime: SetupRuntime | undefined;

async function dockerDb(
  args: string[],
  options: { input?: Buffer; timeout?: number } = {},
) {
  return command(
    "docker",
    ["exec", ...(options.input ? ["-i"] : []), DB_CONTAINER, ...args],
    { input: options.input, timeout: options.timeout ?? 15_000 },
  );
}

async function dropDisposableDatabase(): Promise<void> {
  if (!disposableDbCreated) return;
  await dockerDb(
    ["dropdb", "--if-exists", "--force", "-U", "octoport_test", dbName],
    { timeout: 30_000 },
  );
  disposableDbCreated = false;
}

async function psql(sql: string) {
  return (
    await dockerDb(
      [
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-At",
        "-U",
        "octoport_test",
        "-d",
        dbName,
        "-c",
        sql,
      ],
      { timeout: 15_000 },
    )
  ).stdout
    .toString()
    .trim();
}
async function phaseSnapshot() {
  const sql = `SELECT json_build_object('journal',(SELECT count(*) FROM drizzle.__drizzle_migrations),'journalState',(SELECT json_agg(json_build_array(id,hash,created_at) ORDER BY id) FROM drizzle.__drizzle_migrations),'present',(SELECT json_agg(json_build_array(id,account_id,created_by_user_id,status,label,browser_family,browser_version_last_seen,extension_version_last_seen,created_at,activated_at,revoked_at,revoke_reason)) FROM devices WHERE id='${privateState.present.deviceId}'),'withheld',(SELECT json_agg(json_build_array(id,account_id,created_by_user_id,status,label,browser_family,browser_version_last_seen,extension_version_last_seen,created_at,activated_at,revoked_at,revoke_reason)) FROM devices WHERE id='${privateState.withheld.deviceId}'),'synthetic',(SELECT json_agg(json_build_array(id,account_id,created_by_user_id,status,label,browser_family,browser_version_last_seen,extension_version_last_seen,created_at,activated_at,revoked_at,revoke_reason)) FROM devices WHERE id='${privateState.synthetic.deviceId}'),'sessions',(SELECT count(*) FROM sessions),'sessionAuthority',(SELECT json_agg(to_jsonb(x) ORDER BY id) FROM (SELECT id,device_id,account_id,status,token_family_id,created_at,last_refreshed_at,expires_at,revoked_at,revoke_reason FROM sessions WHERE id IN ('${privateState.present.sessionId}','${privateState.withheld.sessionId}','${privateState.synthetic.sessionId}')) x),'portalSessions',(SELECT count(*) FROM portal_sessions),'portalSessionAuthority',(SELECT json_agg(to_jsonb(x) ORDER BY id) FROM (SELECT id,user_id,session_token_hash,created_at,expires_at,revoked_at,revoke_reason FROM portal_sessions WHERE id='${privateState.portalSessionId}') x),'config',(SELECT count(*) FROM config_releases),'configState',(SELECT json_agg(to_jsonb(x) ORDER BY config_version) FROM (SELECT config_version,contract_version,snapshot_version,envelope_version,content_hash_sha256,source_fingerprint_sha256,signing_key_id FROM config_releases) x),'signing',(SELECT count(*) FROM signing_keys),'signingState',(SELECT json_agg(to_jsonb(x) ORDER BY key_id) FROM (SELECT key_id,algorithm,public_key_spki_der,public_key_sha256 FROM signing_keys) x),'signingEvents',(SELECT count(*) FROM signing_key_events),'signingEventState',(SELECT json_agg(to_jsonb(x) ORDER BY id) FROM (SELECT id,key_id,event_type,occurred_at,reason_code,created_at FROM signing_key_events) x),'devices',(SELECT count(*) FROM devices),'accounts',(SELECT count(*) FROM accounts),'sync_entities',(SELECT count(*) FROM sync_entities))`;
  const value = JSON.parse(await psql(sql));
  for (const key of [
    "journalState",
    "present",
    "withheld",
    "synthetic",
    "sessionAuthority",
    "portalSessionAuthority",
    "configState",
    "signingState",
    "signingEventState",
  ])
    value[`${key}Sha256`] = hash(JSON.stringify(value[key]));
  delete value.journalState;
  delete value.present;
  delete value.withheld;
  delete value.synthetic;
  delete value.sessionAuthority;
  delete value.portalSessionAuthority;
  delete value.configState;
  delete value.signingState;
  delete value.signingEventState;
  return value;
}
async function source(rev: string, label: string) {
  const dir = join(work, label);
  await import("node:fs/promises").then((fs) =>
    fs.mkdir(dir, { recursive: true }),
  );
  const { stdout: tree } = await command("git", [
    "-C",
    ROOT,
    "rev-parse",
    `${rev}^{tree}`,
  ]);
  const { stdout: archive } = await command("git", [
    "-C",
    ROOT,
    "archive",
    "--format=tar",
    "--output",
    join(archiveDir, `${label}.tar`),
    rev,
  ]);
  void archive;
  const tarPath = join(archiveDir, `${label}.tar`);
  const bytes = await readFile(tarPath);
  await command("tar", ["-xf", tarPath, "-C", dir]);
  const lockHash = hash(await readFile(join(dir, "pnpm-lock.yaml")));
  const install = await command(
    PNPM,
    ["install", "--frozen-lockfile", "--offline"],
    {
      cwd: dir,
      env: safeEnv(process.env, {
        CI: "1",
        NODE_ENV: "development",
        npm_config_offline: "true",
      }),
      timeout: 180000,
    },
  );
  const installHash = hash(install.stdout);
  await command(PNPM, ["--filter", "@product/portal", "build"], {
    cwd: dir,
    env: safeEnv(process.env, {
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
    }),
    timeout: 180000,
  });
  if (serviceRuntimeIdentity) {
    await command("chmod", ["-R", "a+rX", dir], { timeout: 60_000 });
    await verifyServiceRuntimeTreeReadOnly(dir, serviceRuntimeIdentity);
  }
  const pkg = JSON.parse(
    await readFile(join(dir, "apps/portal/package.json"), "utf8"),
  );
  const apiTsx = await readFile(
    join(dir, "apps/api/node_modules/tsx/package.json"),
  );
  const workerTsx = await readFile(
    join(dir, "apps/worker/node_modules/tsx/package.json"),
  );
  const nextPkg = await readFile(
    join(dir, "apps/portal/node_modules/next/package.json"),
  );
  const reactPkg = await readFile(
    join(dir, "apps/portal/node_modules/react/package.json"),
  );
  const versions = {
    node: (await command(NODE, ["--version"])).stdout.toString().trim(),
    pnpm: (await command(PNPM, ["--version"])).stdout.toString().trim(),
    tsxApi: JSON.parse(apiTsx.toString("utf8")).version,
    tsxApiPackageSha256: hash(apiTsx),
    tsxWorker: JSON.parse(workerTsx.toString("utf8")).version,
    tsxWorkerPackageSha256: hash(workerTsx),
    next: JSON.parse(nextPkg.toString("utf8")).version,
    nextPackageSha256: hash(nextPkg),
    react: JSON.parse(reactPkg.toString("utf8")).version,
    reactPackageSha256: hash(reactPkg),
    portalBuildHash: hash(
      await readFile(join(dir, "apps/portal/.next/BUILD_ID")),
    ),
    portalPackageName: pkg.name,
  };
  return {
    rev,
    tree: tree.toString().trim(),
    sourceArchiveSha256: hash(bytes),
    lockfileSha256: lockHash,
    offlineInstallLogSha256: installHash,
    versions,
    dir,
  };
}
async function runPhase(
  src: Awaited<ReturnType<typeof source>>,
  index: number,
) {
  const [apiPort, portalPort, smtpPort] = await reserveFreePorts(3);
  const origin = `http://127.0.0.1:${apiPort}`;
  const pre = await phaseSnapshot();
  if (index > 0)
    check(
      pre.syntheticSha256 === forgottenSyntheticMetadataSha256,
      "FORGOTTEN_METADATA_NOT_PRESERVED_FROM_PRIOR_PHASE",
    );
  const apiEnv = safeEnv(process.env, {
    ...serviceRuntimeEnv,
    NODE_ENV: "production",
    LOG_LEVEL: "fatal",
    DATABASE_URL: dbUrl.toString(),
    API_PORT: String(apiPort),
    AUTH_ROOT_SECRET_B64: privateState.rootSecretB64,
    ACCESS_TOKEN_SIGNING_KEY_ID: privateState.accessKeyId,
    ACCESS_TOKEN_SIGNING_PRIVATE_KEY_PEM_B64: privateState.accessPrivateB64,
    CONFIG_SIGNING_KEY_ID: privateState.configKeyId,
    CONFIG_SIGNING_PRIVATE_KEY_PEM_B64: privateState.configPrivateB64,
  });
  const workerEnv = safeEnv(process.env, {
    ...serviceRuntimeEnv,
    NODE_ENV: "production",
    LOG_LEVEL: "info",
    DATABASE_URL: dbUrl.toString(),
    AUTH_ROOT_SECRET_B64: privateState.rootSecretB64,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(smtpPort),
    SMTP_SECURE: "false",
    SMTP_REQUIRE_TLS: "false",
  });
  const portalEnv = safeEnv(process.env, {
    ...serviceRuntimeEnv,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    CONTROL_PLANE_API_ORIGIN: origin,
  });
  check(
    !("TELEGRAM_BOT_TOKEN" in workerEnv) &&
      !("TELEGRAM_NOTIFICATION_CHAT_IDS" in workerEnv),
    "WORKER_TELEGRAM_ENV_PRESENT",
  );
  check(
    workerEnv.SMTP_HOST === "127.0.0.1" &&
      workerEnv.SMTP_PORT === String(smtpPort),
    "WORKER_SMTP_NOT_LOOPBACK",
  );
  check(
    !("DATABASE_URL" in portalEnv) &&
      !("AUTH_ROOT_SECRET_B64" in portalEnv) &&
      !("ACCESS_TOKEN_SIGNING_PRIVATE_KEY_PEM_B64" in portalEnv) &&
      !("CONFIG_SIGNING_PRIVATE_KEY_PEM_B64" in portalEnv),
    "PORTAL_SECRET_ENV_PRESENT",
  );
  // The reserved SMTP port is deliberately released and left without a
  // listener so any queued disposable mail attempt fails on loopback.
  const logs = join(work, `phase-${index}`);
  await import("node:fs/promises").then((fs) => fs.mkdir(logs));
  const api = await spawnService(
    serviceNode,
    ["apps/api/node_modules/tsx/dist/cli.mjs", "apps/api/src/main.ts"],
    src.dir,
    apiEnv,
    join(logs, "api.log"),
    serviceRuntimeIdentity,
  );
  services.push(api);
  const worker = await spawnService(
    serviceNode,
    ["apps/worker/node_modules/tsx/dist/cli.mjs", "apps/worker/src/main.ts"],
    src.dir,
    workerEnv,
    join(logs, "worker.log"),
    serviceRuntimeIdentity,
  );
  services.push(worker);
  const portal = await spawnService(
    serviceNode,
    [
      join(src.dir, "apps/portal/node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "-p",
      String(portalPort),
    ],
    join(src.dir, "apps/portal"),
    portalEnv,
    join(logs, "portal.log"),
    serviceRuntimeIdentity,
  );
  services.push(portal);
  const alive = [api, worker, portal];
  const apiPid = api.pid;
  const workerPid = worker.pid;
  const portalPid = portal.pid;
  if (captureServiceResourceEnvelope) {
    check(apiPid, "C05_RESOURCE_API_PID_MISSING");
    check(workerPid, "C05_RESOURCE_WORKER_PID_MISSING");
    check(portalPid, "C05_RESOURCE_PORTAL_PID_MISSING");
  }
  const resourceSampler = captureServiceResourceEnvelope
    ? new ServiceResourceEnvelopeSampler({
        api: apiPid!,
        worker: workerPid!,
        portal: portalPid!,
      })
    : null;
  const resourceBefore = resourceSampler
    ? await resourceSampler.sample("BEFORE_SMOKE")
    : null;
  const resourceSamples: ResourceSample[] = resourceBefore
    ? [resourceBefore]
    : [];
  let stagedWorkload: {
    profile: "FIRST_BETA_WAVE_SEQUENTIAL_COUNT_V1";
    cycles: number;
    concurrency: 1;
    requestsPerCycle: 8;
    totalRequests: number;
    sampleEveryCycles: number;
    resourceSampleCount: number;
    capacityClaim: "NOT_CONCURRENCY_CAPACITY_PROOF";
  } | null = null;
  await poll(
    async () => {
      const r = await get(`${origin}/health/ready`);
      const b = (await r.json().catch(() => null)) as {
        status?: unknown;
      } | null;
      return r.status === 200 && b?.status === "ready";
    },
    "api-ready",
    alive,
  );
  await poll(
    async () => {
      const r = await get(`${origin}/health/live`);
      return r.status === 200;
    },
    "api-live",
    alive,
  );
  await poll(
    async () =>
      (await get(`http://127.0.0.1:${portalPort}/login`)).status === 200,
    "portal-login",
    alive,
  );
  const log = await readFile(join(logs, "worker.log"), "utf8");
  await poll(
    async () =>
      (await readFile(join(logs, "worker.log"), "utf8")).includes(
        "Worker ready",
      ),
    "worker-ready",
    alive,
  );
  void log;
  check(
    alive.every((p) => p.exitCode === null),
    "SERVICE_NOT_LIVE",
  );
  const authHeader = (t: string) => ({
    authorization: `Bearer ${t}`,
    "content-type": "application/json",
  });
  async function sync(which: "present" | "withheld") {
    const v = privateState[which];
    const r = await get(`${origin}/v1/sync`, {
      method: "POST",
      headers: authHeader(v.accessToken),
      body: JSON.stringify({
        syncVersion: "seller_agents_sync_v1",
        installationId: v.deviceId,
        entries: [],
        readEntityIds: [`store:c05-${which}`],
      }),
    });
    check(r.status === 200, `${which.toUpperCase()}_N2_FAILED`);
    return r.status;
  }
  await sync("present");
  await sync("withheld");
  const portalRead = await get(
    `http://127.0.0.1:${portalPort}/api/control-plane/v1/accounts`,
    { headers: { cookie: `pcp_portal_session=${privateState.portalToken}` } },
  );
  check(portalRead.status === 200, "PORTAL_AUTHENTICATED_PROXY_FAILED");
  const remoteConfig = await import(
    join(ROOT, "packages/server/remote-config/src/index.ts")
  );
  const publicKey = (await import("node:crypto")).createPublicKey({
    key: Buffer.from(privateState.configPublicSpkiB64, "base64"),
    format: "der",
    type: "spki",
  });
  const bootstrap = async (which: "present" | "withheld") => {
    const v = privateState[which];
    const identified = which === "present";
    const response = await get(`${origin}/v1/bootstrap`, {
      method: "POST",
      headers: authHeader(v.accessToken),
      body: JSON.stringify(
        identified
          ? {
              contractVersion: "control_plane_v2",
              extensionVersion: "0.2.4",
              browser: { family: "opera", version: "136.0.0.0" },
              deviceId: v.deviceId,
              lastConfigVersion: null,
            }
          : {
              contractVersion: "control_plane_v2",
              deviceId: v.deviceId,
              lastConfigVersion: null,
            },
      ),
    });
    check(response.status === 200, `${which}_BOOTSTRAP_FAILED`);
    const body: unknown = await response.json();
    const verified = remoteConfig.verifyBootstrapEnvelopeV2(
      body,
      new Map([[privateState.configKeyId, publicKey]]),
    );
    check(verified.ok, `${which}_BOOTSTRAP_SIGNATURE`);
    check(
      identified
        ? !("localClientAuthority" in verified.payload)
        : "localClientAuthority" in verified.payload,
      `${which}_BOOTSTRAP_PRIVACY_BRANCH`,
    );
    return 200;
  };
  async function runFirstWaveSequentialCycle(cycle: number) {
    const ready = await get(`${origin}/health/ready`);
    const readyBody = (await ready.json().catch(() => null)) as {
      status?: unknown;
    } | null;
    check(
      ready.status === 200 && readyBody?.status === "ready",
      `FIRST_WAVE_READY_FAILED:${cycle}`,
    );
    check(
      (await get(`${origin}/health/live`)).status === 200,
      `FIRST_WAVE_LIVE_FAILED:${cycle}`,
    );
    check(
      (await get(`http://127.0.0.1:${portalPort}/login`)).status === 200,
      `FIRST_WAVE_PORTAL_LOGIN_FAILED:${cycle}`,
    );
    const accountRead = await get(
      `http://127.0.0.1:${portalPort}/api/control-plane/v1/accounts`,
      { headers: { cookie: `pcp_portal_session=${privateState.portalToken}` } },
    );
    check(
      accountRead.status === 200,
      `FIRST_WAVE_PORTAL_PROXY_FAILED:${cycle}`,
    );
    await sync("present");
    await sync("withheld");
    await bootstrap("present");
    await bootstrap("withheld");
  }

  await bootstrap("present");
  await bootstrap("withheld");
  if (index === 0) {
    const token = privateState.synthetic.accessToken;
    const forget = await get(
      `${origin}/v1/devices/current/client-metadata/forget`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      },
    );
    if (forget.status !== 200) {
      const failure = (await forget.json().catch(() => null)) as {
        error?: { code?: unknown };
      } | null;
      throw new Error(
        `SYNTHETIC_FORGET_FAILED:${forget.status}:${
          typeof failure?.error?.code === "string"
            ? failure.error.code
            : "UNKNOWN"
        }`,
      );
    }
    const row = JSON.parse(
      await psql(
        `SELECT json_build_array(browser_family,browser_version_last_seen,extension_version_last_seen) FROM devices WHERE id='${privateState.synthetic.deviceId}'`,
      ),
    );
    check(
      row.every((x: unknown) => x === null),
      "SYNTHETIC_WITHHELD_NOT_PERSISTED",
    );
  }
  if (index === 2 && firstWaveSequentialCycles > 0) {
    check(resourceSampler, "C05_FIRST_WAVE_RESOURCE_SAMPLER_MISSING");
    for (let cycle = 1; cycle <= firstWaveSequentialCycles; cycle += 1) {
      await runFirstWaveSequentialCycle(cycle);
      if (cycle % FIRST_BETA_WAVE_RESOURCE_SAMPLE_EVERY_CYCLES === 0)
        resourceSamples.push(await resourceSampler.sample(`WORKLOAD_${cycle}`));
    }
    stagedWorkload = {
      profile: "FIRST_BETA_WAVE_SEQUENTIAL_COUNT_V1",
      cycles: firstWaveSequentialCycles,
      concurrency: 1,
      requestsPerCycle: 8,
      totalRequests: firstWaveSequentialCycles * 8,
      sampleEveryCycles: FIRST_BETA_WAVE_RESOURCE_SAMPLE_EVERY_CYCLES,
      resourceSampleCount: resourceSamples.length + 1,
      capacityClaim: "NOT_CONCURRENCY_CAPACITY_PROOF",
    };
  }
  const resourceAfter = resourceSampler
    ? await resourceSampler.sample("AFTER_SMOKE")
    : null;
  if (resourceAfter) resourceSamples.push(resourceAfter);
  const resourceEnvelope =
    resourceBefore && resourceAfter
      ? stagedWorkload
        ? summarizeServiceResourceEnvelopeSeries(resourceSamples)
        : summarizeServiceResourceEnvelope(resourceBefore, resourceAfter)
      : null;
  const post = await phaseSnapshot();
  check(
    post.journal === expectedJournalCount &&
      JSON.stringify(pre.journal) === JSON.stringify(post.journal) &&
      pre.journalStateSha256 === post.journalStateSha256,
    "MIGRATION_JOURNAL_CHANGED",
  );
  for (const key of [
    "presentSha256",
    "withheldSha256",
    "sessionAuthoritySha256",
    "portalSessionAuthoritySha256",
    "configStateSha256",
    "signingStateSha256",
    "signingEventStateSha256",
  ])
    check(pre[key] === post[key], `PROTECTED_INVARIANT_CHANGED:${key}`);
  if (stagedWorkload)
    for (const key of [
      "accounts",
      "devices",
      "sessions",
      "portalSessions",
      "config",
      "signing",
      "signingEvents",
      "sync_entities",
    ])
      check(
        pre[key] === post[key],
        `FIRST_WAVE_PROTECTED_COUNT_CHANGED:${key}`,
      );
  if (index > 0)
    check(
      pre.syntheticSha256 === post.syntheticSha256,
      "SYNTHETIC_WITHHELD_STATE_CHANGED",
    );
  if (index === 0) forgottenSyntheticMetadataSha256 = post.syntheticSha256;
  else
    check(
      post.syntheticSha256 === forgottenSyntheticMetadataSha256,
      "FORGOTTEN_METADATA_NOT_PRESERVED",
    );
  const phase = {
    revision: src.rev,
    tree: src.tree,
    sourceArchiveSha256: src.sourceArchiveSha256,
    lockfileSha256: src.lockfileSha256,
    versions: src.versions,
    ...(serviceRuntimeIdentity
      ? { runtimeIdentity: publicRuntimeIdentity }
      : {}),
    ...(resourceEnvelope ? { resourceEnvelope } : {}),
    ...(stagedWorkload ? { stagedWorkload } : {}),
    ports: { api: apiPort, portal: portalPort, smtpDisabledLoopback: smtpPort },
    checks: {
      apiLive: 200,
      apiReady: 200,
      workerReadyLog: true,
      portalLogin: 200,
      portalProxyAccounts: 200,
      presentN2: 200,
      withheldN2: 200,
      identifiedBootstrapEd25519: 200,
      privacyNeutralBootstrapEd25519: 200,
      syntheticForget: index === 0 ? 200 : "already-withheld",
    },
    before: pre,
    after: post,
  };
  phases.push(phase);
  await stop(portal);
  await stop(worker);
  await stop(api);
  services.splice(0, services.length);
}

try {
  const restoreInfo = await stat(RESTORE);
  check((restoreInfo.mode & 0o077) === 0, "RESTORE_FILE_PERMISSIONS_TOO_BROAD");
  check(
    hash(await readFile(RESTORE)) === RESTORE_SHA256,
    "RESTORE_SHA256_MISMATCH",
  );
  const privateInfo = await stat(PRIVATE_STATE);
  check(
    (privateInfo.mode & 0o077) === 0,
    "PRIVATE_STATE_PERMISSIONS_TOO_BROAD",
  );
  const state = JSON.parse(
    await readFile(PRIVATE_STATE, "utf8"),
  ) as SeedRuntimeState;
  for (const id of [state.present.deviceId, state.withheld.deviceId])
    check(/^[0-9a-f-]{36}$/i.test(id), "INVALID_SAVED_DEVICE_ID");
  check(
    state.present.deviceId !== state.withheld.deviceId,
    "BASELINE_IDS_NOT_DISTINCT",
  );
  const dbLabel = (
    await command("docker", [
      "inspect",
      "--format",
      '{{index .Config.Labels "octoport.coordination"}}',
      DB_CONTAINER,
    ])
  ).stdout
    .toString()
    .trim();
  check(dbLabel === "2p1", "TEST_DB_LABEL_MISMATCH");
  const dbPort = (
    await command("docker", ["port", DB_CONTAINER, "5432/tcp"])
  ).stdout
    .toString()
    .trim();
  check(
    dbPort === `127.0.0.1:${disposableDatabase.port}`,
    "TEST_DB_PORT_MAPPING_MISMATCH",
  );
  await dockerDb(["createdb", "-U", "octoport_test", dbName]);
  disposableDbCreated = true;
  await dockerDb(
    [
      "pg_restore",
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
      "-U",
      "octoport_test",
      "-d",
      dbName,
    ],
    { input: await readFile(RESTORE), timeout: 120_000 },
  );
  check(
    (await psql("SELECT count(*) FROM drizzle.__drizzle_migrations")) ===
      String(migrationEvidence.sourceJournal),
    "RESTORE_JOURNAL_NOT_SOURCE",
  );
  mark("RESTORE_READY");
  const candidateSource = await source(candidate, "candidate");
  mark("CANDIDATE_SOURCE_READY");
  const candidateJournal = JSON.parse(
    await readFile(
      join(
        candidateSource.dir,
        "packages/server/db/drizzle/meta/_journal.json",
      ),
      "utf8",
    ),
  ) as { entries?: unknown[] };
  const targetJournal = candidateJournal.entries?.length;
  check(
    Number.isSafeInteger(targetJournal) &&
      targetJournal! > migrationEvidence.sourceJournal,
    "CANDIDATE_JOURNAL_NOT_FORWARD",
  );
  await command(PNPM, ["--filter", "@product/db", "db:migrate"], {
    cwd: candidateSource.dir,
    env: safeEnv(process.env, {
      NODE_ENV: "test",
      DATABASE_URL: dbUrl.toString(),
    }),
    timeout: 120_000,
  });
  expectedJournalCount = targetJournal!;
  migrationEvidence.targetJournal = expectedJournalCount;
  check(
    (await psql("SELECT count(*) FROM drizzle.__drizzle_migrations")) ===
      String(expectedJournalCount),
    "FORWARD_MIGRATION_JOURNAL_MISMATCH",
  );
  mark("FORWARD_MIGRATION_PASS");
  upgradedBackup = (
    await dockerDb(
      [
        "pg_dump",
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "-U",
        "octoport_test",
        dbName,
      ],
      { timeout: 120_000 },
    )
  ).stdout;
  check(upgradedBackup.length > 0, "UPGRADED_BACKUP_EMPTY");
  migrationEvidence.upgradedBackupSha256 = hash(upgradedBackup);
  migrationEvidence.upgradedBackupBytes = upgradedBackup.length;
  await dropDisposableDatabase();
  await dockerDb(["createdb", "-U", "octoport_test", dbName]);
  disposableDbCreated = true;
  await dockerDb(
    [
      "pg_restore",
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
      "-U",
      "octoport_test",
      "-d",
      dbName,
    ],
    { input: upgradedBackup, timeout: 120_000 },
  );
  check(
    (await psql("SELECT count(*) FROM drizzle.__drizzle_migrations")) ===
      String(expectedJournalCount),
    "UPGRADED_BACKUP_RESTORE_JOURNAL_MISMATCH",
  );
  mark("UPGRADED_BACKUP_RESTORE_PASS");
  const floorSource = await source(FLOOR, "floor");
  mark("FLOOR_SOURCE_READY");
  check(
    candidateSource.versions.node === "v24.20.0" &&
      candidateSource.versions.pnpm === "10.34.5",
    "RUNTIME_VERSION_MISMATCH",
  );
  check(
    floorSource.versions.node === "v24.20.0" &&
      floorSource.versions.pnpm === "10.34.5",
    "FLOOR_RUNTIME_VERSION_MISMATCH",
  );
  const dbLib = await import(join(ROOT, "packages/server/db/src/index.ts"));
  setupRuntime = dbLib.createDatabaseRuntime(dbUrl.toString()) as SetupRuntime;
  await setupRuntime.ready();
  const runtime = setupRuntime;
  const baselineRows = await runtime.query<BaselineDeviceRow>(
    "SELECT id,browser_family,browser_version_last_seen,extension_version_last_seen FROM devices WHERE id = ANY($1::uuid[])",
    [[state.present.deviceId, state.withheld.deviceId]],
  );
  check(baselineRows.rows.length === 2, "PROTECTED_BASELINE_DEVICES_MISSING");
  const savedPresent = baselineRows.rows.find(
    (row) => row.id === state.present.deviceId,
  );
  const savedWithheld = baselineRows.rows.find(
    (row) => row.id === state.withheld.deviceId,
  );
  check(
    savedPresent?.browser_family &&
      savedPresent?.browser_version_last_seen &&
      savedPresent?.extension_version_last_seen,
    "PROTECTED_PRESENT_BASELINE_INVALID",
  );
  check(
    savedWithheld &&
      savedWithheld.browser_family === null &&
      savedWithheld.browser_version_last_seen === null &&
      savedWithheld.extension_version_last_seen === null,
    "PROTECTED_WITHHELD_BASELINE_INVALID",
  );
  const baselineMetadata = baselineRows.rows;
  // Tokens from historical state are never used. The implementation below reissues them via product auth helpers.
  const auth = await import(
    join(ROOT, "packages/server/extension-auth/src/index.ts")
  );
  const key = auth.loadAccessTokenSigningKey({
    ACCESS_TOKEN_SIGNING_KEY_ID: state.accessKeyId,
    ACCESS_TOKEN_SIGNING_PRIVATE_KEY_PEM_B64: state.accessPrivateB64,
  });
  state.present.accessToken = await auth.issueAccessToken(key, {
    sessionId: state.present.sessionId,
    deviceId: state.present.deviceId,
    accountId: state.accountId,
  });
  state.withheld.accessToken = await auth.issueAccessToken(key, {
    sessionId: state.withheld.sessionId,
    deviceId: state.withheld.deviceId,
    accountId: state.accountId,
  });
  const authLib = await import(join(ROOT, "packages/server/auth/src/index.ts"));
  const betaLib = await import(
    join(ROOT, "packages/server/beta-access/src/index.ts")
  );
  const devAuthLib = await import(
    join(ROOT, "packages/server/device-auth/src/index.ts")
  );
  const devManageLib = await import(
    join(ROOT, "packages/server/device-management/src/index.ts")
  );
  const rootSecret = Buffer.from(state.rootSecretB64, "base64");
  const userRows = await runtime.query<{ id: string }>(
    "SELECT user_id AS id FROM account_memberships WHERE account_id=$1 AND role='OWNER' ORDER BY user_id LIMIT 1",
    [state.accountId],
  );
  const userId = userRows.rows[0]?.id;
  check(userId, "SYNTHETIC_USER_NOT_FOUND");
  const { randomBytes: rb } = await import("node:crypto");
  const portalToken = rb(32).toString("base64url");
  const portalSessionId = randomUUID();
  await runtime.query(
    "INSERT INTO portal_sessions(id,user_id,session_token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [
      portalSessionId,
      userId,
      authLib.portalLookup(authLib.deriveAuthKeys(rootSecret), portalToken),
    ],
  );
  const deviceAuth = new devAuthLib.DeviceAuthorizationService(
    dbLib.createDeviceAuthorizationRepository(runtime),
    devAuthLib.deriveDeviceAuthKeys(rootSecret),
  );
  const started = await deviceAuth.start(
    {
      clientType: "browser_extension",
      browserFamily: "opera",
      browserVersion: "136.0.0.0",
      extensionVersion: "0.2.4",
      deviceLabel: "synthetic C05 rollback rehearsal",
    },
    `c05-${randomUUID()}`,
    "198.51.100.65",
    `c05-${randomUUID()}`,
  );
  check(started.ok, "SYNTHETIC_DEVICE_START_FAILED");
  const approved = await deviceAuth.approve(
    started.value.authorizationId,
    state.accountId,
    started.value.userCode,
    userId,
    "198.51.100.65",
    `c05-${randomUUID()}`,
  );
  check(approved.ok, "SYNTHETIC_DEVICE_APPROVAL_FAILED");
  const beta = new betaLib.BetaAdmissionService(
    dbLib.createBetaAdmissionRepository(runtime),
  );
  const manager = new devManageLib.DeviceManagementService(
    dbLib.createDeviceManagementRepository(runtime),
    rootSecret,
    key,
    {
      resolve: async (id: string) => {
        const a = await beta.resolve(id);
        check(a.kind === "BETA", "SYNTHETIC_ACCOUNT_NOT_BETA");
        return { kind: "BETA_UNLIMITED_FOR_COMMERCIAL_COUNT" };
      },
    },
  );
  const activated = await manager.exchange(
    started.value.deviceCode,
    `c05-${randomUUID()}`,
    "198.51.100.65",
    `c05-${randomUUID()}`,
  );
  check(activated.kind === "ACTIVATED", "SYNTHETIC_DEVICE_EXCHANGE_FAILED");
  check(
    activated.deviceId !== state.present.deviceId &&
      activated.deviceId !== state.withheld.deviceId,
    "SYNTHETIC_DEVICE_COLLIDES_WITH_PROTECTED_BASELINE",
  );
  privateState = {
    ...state,
    portalSessionId,
    portalToken,
    synthetic: {
      deviceId: activated.deviceId,
      sessionId: activated.sessionId,
      accessToken: activated.accessToken,
    },
    baselineMetadata,
  };
  await writeFile(privatePath, JSON.stringify(privateState), { mode: 0o600 });
  await chmod(privatePath, 0o600);
  await runtime.close();
  setupRuntime = undefined;
  mark("SYNTHETIC_SETUP_READY");
  // Start from exact source archives: candidate -> floor -> candidate, one forward database.
  mark("CANDIDATE_PHASE_1_START");
  await runPhase(candidateSource, 0);
  mark("CANDIDATE_PHASE_1_PASS");
  mark("FLOOR_PHASE_START");
  await runPhase(floorSource, 1);
  mark("FLOOR_PHASE_PASS");
  mark("CANDIDATE_PHASE_2_START");
  await runPhase(candidateSource, 2);
  mark("CANDIDATE_PHASE_2_PASS");
  check(phases.length === 3, "PHASE_COUNT_INVALID");
  check(upgradedBackup, "UPGRADED_BACKUP_NOT_CAPTURED");
  const upgradedBackupPath = join(
    evidenceDir,
    "c05-current-schema-backup.dump",
  );
  await writeFile(upgradedBackupPath, upgradedBackup, {
    mode: 0o600,
    flag: "wx",
  });
  await chmod(upgradedBackupPath, 0o600);
  migrationEvidence.upgradedBackupFile = upgradedBackupPath;
  const evidencePath = join(
    evidenceDir,
    "c05-three-service-rollback-evidence.json",
  );
  await dropDisposableDatabase();
  await rm(privatePath, { force: true });
  await rm(work, { recursive: true, force: true });
  await writeFile(
    evidencePath,
    JSON.stringify(
      {
        ...evidence,
        cleanup: {
          disposableDatabaseDropped: true,
          privateTransientStateRemoved: true,
          tempWorkRemoved: true,
        },
      },
      null,
      2,
    ) + "\n",
    { mode: 0o644, flag: "wx" },
  );
  await chmod(evidencePath, 0o644);
  mark("CLEANUP_PASS");
  console.log(JSON.stringify({ status: "PASS", evidencePath }));
} catch (error) {
  const cleanupErrors: string[] = [];
  const failureLogPath = join(
    evidenceDir,
    `.c05-failure-${Date.now()}-${randomUUID()}.json`,
  );
  try {
    const fs = await import("node:fs/promises");
    const phaseLogs: Record<string, string> = {};
    for (let index = 0; index < 3; index += 1) {
      for (const service of ["api", "worker", "portal"]) {
        const path = join(work, `phase-${index}`, `${service}.log`);
        try {
          const content = await readFile(path, "utf8");
          phaseLogs[`phase-${index}/${service}.log`] = content.slice(-16_384);
        } catch (readError) {
          void readError;
        }
      }
    }
    await fs.writeFile(
      failureLogPath,
      JSON.stringify(
        {
          candidate,
          rollbackFloor: FLOOR,
          error: error instanceof Error ? error.message : "UNKNOWN_FAILURE",
          phaseLogs,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    await fs.chmod(failureLogPath, 0o600);
  } catch (logError) {
    cleanupErrors.push(
      logError instanceof Error ? logError.message : "FAILURE_LOG_CAPTURE",
    );
  }
  for (const service of services.reverse())
    try {
      await stop(service);
    } catch (cleanupError) {
      cleanupErrors.push(
        cleanupError instanceof Error
          ? cleanupError.message
          : "SERVICE_CLEANUP",
      );
    }
  try {
    await setupRuntime?.close();
    setupRuntime = undefined;
  } catch (cleanupError) {
    cleanupErrors.push(
      cleanupError instanceof Error
        ? cleanupError.message
        : "DB_RUNTIME_CLEANUP",
    );
  }
  try {
    await dropDisposableDatabase();
  } catch (cleanupError) {
    cleanupErrors.push(
      cleanupError instanceof Error ? cleanupError.message : "DATABASE_CLEANUP",
    );
  }
  await rm(privatePath, { force: true }).catch((cleanupError: unknown) => {
    cleanupErrors.push(
      cleanupError instanceof Error
        ? cleanupError.message
        : "PRIVATE_STATE_CLEANUP",
    );
  });
  await rm(work, { recursive: true, force: true }).catch(
    (cleanupError: unknown) => {
      cleanupErrors.push(
        cleanupError instanceof Error ? cleanupError.message : "WORK_CLEANUP",
      );
    },
  );
  if (cleanupErrors.length)
    throw new AggregateError(
      [error, ...cleanupErrors.map((message) => new Error(message))],
      "C05_REHEARSAL_AND_CLEANUP_FAILED",
    );
  throw error;
}

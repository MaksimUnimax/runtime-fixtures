import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FIRST_BETA_WAVE_RESOURCE_SAMPLE_EVERY_CYCLES,
  FIRST_BETA_WAVE_SEQUENTIAL_CYCLES,
  ServiceResourceEnvelopeSampler,
  captureServiceTree,
  parseFirstBetaWaveSequentialCycles,
  parseProcStat,
  parseProcStatus,
  summarizeServiceResourceEnvelope,
  summarizeServiceResourceEnvelopeSeries,
  type ProcReader,
} from "./c05-service-resource-envelope.mts";

function statLine(
  pid: number,
  parentPid: number,
  userTicks: number,
  systemTicks: number,
  startTimeTicks: number,
): string {
  return `${pid} (node service) S ${parentPid} 0 0 0 0 0 0 0 0 0 ${userTicks} ${systemTicks} 0 0 0 0 1 0 ${startTimeTicks}\n`;
}

function statusLine(rssKiB: number, hwmKiB: number, threads: number): string {
  return [
    "Name:\tnode",
    `VmRSS:\t${rssKiB} kB`,
    `VmHWM:\t${hwmKiB} kB`,
    `Threads:\t${threads}`,
    "",
  ].join("\n");
}

class FakeReader implements ProcReader {
  now = 1_000;
  readonly stats = new Map<number, string>();
  readonly statuses = new Map<number, string>();

  async listPids(): Promise<number[]> {
    return [...this.stats.keys()];
  }

  async readStat(pid: number): Promise<string> {
    const value = this.stats.get(pid);
    if (!value) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return value;
  }

  async readStatus(pid: number): Promise<string> {
    const value = this.statuses.get(pid);
    if (!value) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return value;
  }

  nowMs(): number {
    return this.now;
  }
}

function fixtureReader(): FakeReader {
  const reader = new FakeReader();
  reader.stats.set(10, statLine(10, 1, 10, 5, 100));
  reader.stats.set(11, statLine(11, 10, 7, 3, 101));
  reader.stats.set(20, statLine(20, 1, 100, 100, 200));
  reader.statuses.set(10, statusLine(100, 150, 2));
  reader.statuses.set(11, statusLine(50, 70, 1));
  reader.statuses.set(20, statusLine(999, 999, 20));
  return reader;
}

test("first beta wave sequential profile accepts only the exact 100-count workload", () => {
  assert.equal(FIRST_BETA_WAVE_SEQUENTIAL_CYCLES, 100);
  assert.equal(FIRST_BETA_WAVE_RESOURCE_SAMPLE_EVERY_CYCLES, 10);
  assert.equal(parseFirstBetaWaveSequentialCycles(undefined), 0);
  assert.equal(parseFirstBetaWaveSequentialCycles(""), 0);
  assert.equal(parseFirstBetaWaveSequentialCycles("100"), 100);
  for (const value of ["1", "99", "101", "0100", "100 "])
    assert.throws(
      () => parseFirstBetaWaveSequentialCycles(value),
      /C05_FIRST_WAVE_SEQUENTIAL_CYCLES_INVALID/,
    );
});

test("resource proc parsers reject malformed fields and accept bounded values", () => {
  assert.deepEqual(parseProcStat(statLine(10, 1, 10, 5, 100)), {
    pid: 10,
    parentPid: 1,
    cpuTicks: 15n,
    startTimeTicks: 100n,
  });
  assert.deepEqual(parseProcStatus(statusLine(100, 150, 2)), {
    rssBytes: 100 * 1024,
    highWaterBytes: 150 * 1024,
    threads: 2,
  });
  assert.throws(
    () => parseProcStat("10 (node) S 1"),
    /SERVICE_RESOURCE_STAT_INVALID/,
  );
  assert.throws(
    () => parseProcStatus("VmRSS:\t1 kB\nThreads:\t1\n"),
    /SERVICE_RESOURCE_HWM_INVALID/,
  );
});

test("capture aggregates only the root process tree", async () => {
  const sample = await captureServiceTree(10, fixtureReader());
  assert.equal(sample.rssBytes, 150 * 1024);
  assert.equal(sample.highWaterBytes, 220 * 1024);
  assert.equal(sample.processCount, 2);
  assert.equal(sample.taskCount, 3);
  assert.equal(sample.cpuTicks, 25n);
  assert.deepEqual(
    sample.identities.map((item) => item.pid),
    [10, 11],
  );
});

test("sampler produces sanitized before/after functional envelope", async () => {
  const reader = fixtureReader();
  reader.stats.set(30, statLine(30, 1, 3, 2, 300));
  reader.stats.set(40, statLine(40, 1, 4, 2, 400));
  reader.statuses.set(30, statusLine(60, 80, 1));
  reader.statuses.set(40, statusLine(70, 90, 1));
  const sampler = new ServiceResourceEnvelopeSampler(
    { api: 10, worker: 30, portal: 40 },
    reader,
  );
  const before = await sampler.sample("BEFORE_SMOKE");

  reader.now = 2_500;
  reader.stats.set(10, statLine(10, 1, 20, 10, 100));
  reader.stats.set(11, statLine(11, 10, 10, 5, 101));
  reader.stats.set(30, statLine(30, 1, 8, 4, 300));
  reader.stats.set(40, statLine(40, 1, 9, 3, 400));
  reader.statuses.set(10, statusLine(120, 170, 3));
  reader.statuses.set(11, statusLine(55, 75, 1));
  const after = await sampler.sample("AFTER_SMOKE");
  const result = summarizeServiceResourceEnvelope(before, after);

  assert.equal(result.evidenceLevel, "DISPOSABLE_FUNCTIONAL_RESOURCE_ENVELOPE");
  assert.equal(result.capacityProof, "NOT_PRODUCTION_CAPACITY_PROOF");
  assert.equal(result.sampleWindowMs, 1_500);
  assert.deepEqual(result.services.api, {
    rssBytesMax: 175 * 1024,
    highWaterBytesMax: 245 * 1024,
    processCountMax: 2,
    taskCountMax: 4,
    cpuTicksDelta: 20,
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /pid|uid|gid|startTime/i);
  assert.match(serialized, /staging startup\/readiness\/auth\/bootstrap/);
});

test("series summary retains intermediate workload maxima without changing capacity claim", async () => {
  const reader = fixtureReader();
  reader.stats.set(30, statLine(30, 1, 3, 2, 300));
  reader.stats.set(40, statLine(40, 1, 4, 2, 400));
  reader.statuses.set(30, statusLine(60, 80, 1));
  reader.statuses.set(40, statusLine(70, 90, 1));
  const sampler = new ServiceResourceEnvelopeSampler(
    { api: 10, worker: 30, portal: 40 },
    reader,
  );
  const before = await sampler.sample("BEFORE_SMOKE");

  reader.now = 1_500;
  reader.stats.set(10, statLine(10, 1, 18, 7, 100));
  reader.stats.set(11, statLine(11, 10, 9, 4, 101));
  reader.statuses.set(10, statusLine(300, 350, 5));
  reader.statuses.set(11, statusLine(100, 125, 2));
  const workload = await sampler.sample("WORKLOAD_10");

  reader.now = 2_500;
  reader.stats.set(10, statLine(10, 1, 25, 10, 100));
  reader.stats.set(11, statLine(11, 10, 12, 6, 101));
  reader.statuses.set(10, statusLine(130, 180, 3));
  reader.statuses.set(11, statusLine(60, 80, 1));
  const after = await sampler.sample("AFTER_SMOKE");

  const result = summarizeServiceResourceEnvelopeSeries([
    before,
    workload,
    after,
  ]);
  assert.equal(result.services.api.rssBytesMax, 400 * 1024);
  assert.equal(result.services.api.highWaterBytesMax, 475 * 1024);
  assert.equal(result.services.api.taskCountMax, 7);
  assert.equal(result.capacityProof, "NOT_PRODUCTION_CAPACITY_PROOF");
  assert.equal(result.sampleWindowMs, 1_500);
});

test("sampler rejects unknown workload sample labels", async () => {
  const reader = fixtureReader();
  reader.stats.set(30, statLine(30, 1, 3, 2, 300));
  reader.stats.set(40, statLine(40, 1, 4, 2, 400));
  reader.statuses.set(30, statusLine(60, 80, 1));
  reader.statuses.set(40, statusLine(70, 90, 1));
  const sampler = new ServiceResourceEnvelopeSampler(
    { api: 10, worker: 30, portal: 40 },
    reader,
  );
  await assert.rejects(
    sampler.sample("FIRST_WAVE"),
    /SERVICE_RESOURCE_SAMPLE_LABEL_INVALID/,
  );
});

test("capture fails closed on PID reuse between stat and status accounting", async () => {
  class ReusedDuringCaptureReader extends FakeReader {
    childReads = 0;

    override async readStat(pid: number): Promise<string> {
      if (pid === 11) {
        this.childReads += 1;
        if (this.childReads > 1) return statLine(11, 10, 1, 1, 999);
      }
      return super.readStat(pid);
    }
  }
  const reader = new ReusedDuringCaptureReader();
  const fixture = fixtureReader();
  for (const [pid, value] of fixture.stats) reader.stats.set(pid, value);
  for (const [pid, value] of fixture.statuses) reader.statuses.set(pid, value);

  await assert.rejects(
    captureServiceTree(10, reader),
    /SERVICE_RESOURCE_PID_REUSED_DURING_CAPTURE/,
  );
});

test("sampler fails closed on root PID reuse", async () => {
  const reader = fixtureReader();
  reader.stats.set(30, statLine(30, 1, 3, 2, 300));
  reader.stats.set(40, statLine(40, 1, 4, 2, 400));
  reader.statuses.set(30, statusLine(60, 80, 1));
  reader.statuses.set(40, statusLine(70, 90, 1));
  const sampler = new ServiceResourceEnvelopeSampler(
    { api: 10, worker: 30, portal: 40 },
    reader,
  );
  await sampler.sample("BEFORE_SMOKE");
  reader.now = 2_000;
  reader.stats.set(10, statLine(10, 1, 11, 5, 999));
  await assert.rejects(
    sampler.sample("AFTER_SMOKE"),
    /SERVICE_RESOURCE_ROOT_REUSED:api/,
  );
});

test("summary fails closed on aggregate CPU regression", async () => {
  const reader = fixtureReader();
  reader.stats.set(30, statLine(30, 1, 3, 2, 300));
  reader.stats.set(40, statLine(40, 1, 4, 2, 400));
  reader.statuses.set(30, statusLine(60, 80, 1));
  reader.statuses.set(40, statusLine(70, 90, 1));
  const sampler = new ServiceResourceEnvelopeSampler(
    { api: 10, worker: 30, portal: 40 },
    reader,
  );
  const before = await sampler.sample("BEFORE_SMOKE");
  reader.now = 2_000;
  reader.stats.set(10, statLine(10, 1, 1, 1, 100));
  reader.stats.set(11, statLine(11, 10, 1, 1, 101));
  const after = await sampler.sample("AFTER_SMOKE");
  assert.throws(
    () => summarizeServiceResourceEnvelope(before, after),
    /SERVICE_RESOURCE_CPU_REGRESSED:api/,
  );
});

test("live reader source is restricted to stat/status proc files", async () => {
  const source = await readFile(
    new URL("./c05-service-resource-envelope.mts", import.meta.url),
    "utf8",
  );
  assert.match(source, /\/stat/);
  assert.match(source, /\/status/);
  assert.doesNotMatch(source, /\/environ|\/cmdline|\/fd\b|\/net\b/);
});

test("first-wave workload remains sequential, exact-count, and final-current only", async () => {
  const source = await readFile(
    new URL("./c05-three-service-rollback-rehearsal.mts", import.meta.url),
    "utf8",
  );
  assert.match(source, /C05_FIRST_WAVE_SEQUENTIAL_CYCLES/);
  assert.match(source, /index === 2 && firstWaveSequentialCycles > 0/);
  assert.match(
    source,
    /for \(let cycle = 1; cycle <= firstWaveSequentialCycles/,
  );
  assert.match(source, /concurrency: 1/);
  assert.match(source, /requestsPerCycle: 8/);
  assert.match(source, /NOT_CONCURRENCY_CAPACITY_PROOF/);
  assert.match(source, /FIRST_WAVE_PROTECTED_COUNT_CHANGED/);
  assert.doesNotMatch(
    source,
    /Promise\.all\([^\n]*runFirstWaveSequentialCycle/,
  );
});

test("rehearsal admits only exact A/B/C disposable database targets", async () => {
  const source = await readFile(
    new URL("./c05-three-service-rollback-rehearsal.mts", import.meta.url),
    "utf8",
  );
  for (const value of [
    "octoport-a-test-pg",
    "15541",
    "/octoport_a_test",
    "octoport-b-test-pg",
    "15542",
    "/octoport_b_test",
    "octoport-c-test-pg",
    "15543",
    "/octoport_c_test",
  ])
    assert.match(source, new RegExp(value.replaceAll("/", "\\/")));
  assert.match(source, /NOT_OWNED_DISPOSABLE_DATABASE/);
  assert.match(source, /C05_EVIDENCE_DIR_ROLE_MISMATCH/);
  assert.match(source, /disposableDatabase\.port/);
  assert.doesNotMatch(
    source,
    /C05_(?:TEST_)?DATABASE_(?:URL|PORT|NAME|CONTAINER)/,
  );
});

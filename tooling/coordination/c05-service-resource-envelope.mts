import { readdir, readFile } from "node:fs/promises";

export const SERVICE_RESOURCE_EVIDENCE_LEVEL =
  "DISPOSABLE_FUNCTIONAL_RESOURCE_ENVELOPE" as const;

export type ServiceResourceRole = "api" | "worker" | "portal";

type ProcStat = {
  pid: number;
  parentPid: number;
  cpuTicks: bigint;
  startTimeTicks: bigint;
};

type ProcStatus = {
  rssBytes: number;
  highWaterBytes: number;
  threads: number;
};

type ProcessIdentity = {
  pid: number;
  startTimeTicks: bigint;
};

export type ServiceTreeSample = {
  rssBytes: number;
  highWaterBytes: number;
  processCount: number;
  taskCount: number;
  cpuTicks: bigint;
  identities: ProcessIdentity[];
  rootStartTimeTicks: bigint;
};

export type ResourceSample = {
  label: "BEFORE_SMOKE" | "AFTER_SMOKE";
  capturedAtMs: number;
  services: Record<ServiceResourceRole, ServiceTreeSample>;
};

export type ServiceResourceEnvelope = {
  schema: "octoport-disposable-service-resource-envelope-v1";
  evidenceLevel: typeof SERVICE_RESOURCE_EVIDENCE_LEVEL;
  capacityProof: "NOT_PRODUCTION_CAPACITY_PROOF";
  sampleWindowMs: number;
  services: Record<
    ServiceResourceRole,
    {
      rssBytesMax: number;
      highWaterBytesMax: number;
      processCountMax: number;
      taskCountMax: number;
      cpuTicksDelta: number;
    }
  >;
  nextProofsRequired: string[];
};

export interface ProcReader {
  listPids(): Promise<number[]>;
  readStat(pid: number): Promise<string>;
  readStatus(pid: number): Promise<string>;
  nowMs(): number;
}

function positiveInteger(value: string, code: string): number {
  if (!/^\d+$/.test(value)) throw new Error(code);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(code);
  return parsed;
}

function nonNegativeBigInt(value: string, code: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(code);
  return BigInt(value);
}

export function parseProcStat(text: string): ProcStat {
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (open <= 0 || close <= open || close + 2 >= text.length)
    throw new Error("SERVICE_RESOURCE_STAT_INVALID");
  const pid = positiveInteger(
    text.slice(0, open).trim(),
    "SERVICE_RESOURCE_STAT_PID_INVALID",
  );
  const tail = text
    .slice(close + 2)
    .trim()
    .split(/\s+/);
  if (tail.length < 20) throw new Error("SERVICE_RESOURCE_STAT_INVALID");
  const parentPid = Number(tail[1]);
  if (
    !/^\d+$/.test(tail[1] ?? "") ||
    !Number.isSafeInteger(parentPid) ||
    parentPid < 0
  )
    throw new Error("SERVICE_RESOURCE_STAT_PPID_INVALID");
  const userTicks = nonNegativeBigInt(
    tail[11] ?? "",
    "SERVICE_RESOURCE_STAT_CPU_INVALID",
  );
  const systemTicks = nonNegativeBigInt(
    tail[12] ?? "",
    "SERVICE_RESOURCE_STAT_CPU_INVALID",
  );
  const startTimeTicks = nonNegativeBigInt(
    tail[19] ?? "",
    "SERVICE_RESOURCE_STAT_START_INVALID",
  );
  return {
    pid,
    parentPid,
    cpuTicks: userTicks + systemTicks,
    startTimeTicks,
  };
}

function parseKb(line: string | undefined, code: string): number {
  const match = /^\w+:\s+(\d+)\s+kB$/.exec(line ?? "");
  if (!match) throw new Error(code);
  const kib = Number(match[1]);
  if (!Number.isSafeInteger(kib) || kib < 0) throw new Error(code);
  const bytes = kib * 1024;
  if (!Number.isSafeInteger(bytes)) throw new Error(code);
  return bytes;
}

export function parseProcStatus(text: string): ProcStatus {
  const lines = text.trimEnd().split("\n");
  const byKey = new Map<string, string>();
  for (const line of lines) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index);
    if (byKey.has(key)) throw new Error("SERVICE_RESOURCE_STATUS_DUPLICATE");
    byKey.set(key, line);
  }
  const threadsLine = byKey.get("Threads");
  const threadsMatch = /^Threads:\s+(\d+)$/.exec(threadsLine ?? "");
  if (!threadsMatch) throw new Error("SERVICE_RESOURCE_THREADS_INVALID");
  const threads = Number(threadsMatch[1]);
  if (!Number.isSafeInteger(threads) || threads <= 0)
    throw new Error("SERVICE_RESOURCE_THREADS_INVALID");
  return {
    rssBytes: parseKb(byKey.get("VmRSS"), "SERVICE_RESOURCE_RSS_INVALID"),
    highWaterBytes: parseKb(byKey.get("VmHWM"), "SERVICE_RESOURCE_HWM_INVALID"),
    threads,
  };
}

export class LinuxProcReader implements ProcReader {
  constructor(private readonly root = "/proc") {}

  async listPids(): Promise<number[]> {
    const names = await readdir(this.root);
    return names
      .filter((name) => /^[1-9]\d*$/.test(name))
      .map(Number)
      .filter((pid) => Number.isSafeInteger(pid) && pid > 0);
  }

  readStat(pid: number): Promise<string> {
    return readFile(`${this.root}/${pid}/stat`, "utf8");
  }

  readStatus(pid: number): Promise<string> {
    return readFile(`${this.root}/${pid}/status`, "utf8");
  }

  nowMs(): number {
    return Date.now();
  }
}

function descendantPids(
  rootPid: number,
  stats: Map<number, ProcStat>,
): number[] {
  if (!stats.has(rootPid)) throw new Error("SERVICE_RESOURCE_ROOT_MISSING");
  const selected = new Set<number>([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const stat of stats.values()) {
      if (!selected.has(stat.pid) && selected.has(stat.parentPid)) {
        selected.add(stat.pid);
        changed = true;
      }
    }
  }
  return [...selected].sort((a, b) => a - b);
}

async function readAllStats(
  reader: ProcReader,
): Promise<Map<number, ProcStat>> {
  const stats = new Map<number, ProcStat>();
  for (const pid of await reader.listPids()) {
    let value: string;
    try {
      value = await reader.readStat(pid);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      )
        continue;
      throw error;
    }
    const stat = parseProcStat(value);
    if (stat.pid !== pid) throw new Error("SERVICE_RESOURCE_STAT_PID_MISMATCH");
    stats.set(pid, stat);
  }
  return stats;
}

export async function captureServiceTree(
  rootPid: number,
  reader: ProcReader = new LinuxProcReader(),
): Promise<ServiceTreeSample> {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0)
    throw new Error("SERVICE_RESOURCE_ROOT_PID_INVALID");
  const stats = await readAllStats(reader);
  const pids = descendantPids(rootPid, stats);
  let rssBytes = 0;
  let highWaterBytes = 0;
  let taskCount = 0;
  let cpuTicks = 0n;
  const identities: ProcessIdentity[] = [];
  for (const pid of pids) {
    const stat = stats.get(pid);
    if (!stat) throw new Error("SERVICE_RESOURCE_STAT_MISSING");
    let statusText: string;
    try {
      statusText = await reader.readStatus(pid);
    } catch {
      throw new Error("SERVICE_RESOURCE_STATUS_MISSING");
    }
    const status = parseProcStatus(statusText);
    let confirmedText: string;
    try {
      confirmedText = await reader.readStat(pid);
    } catch {
      throw new Error("SERVICE_RESOURCE_STAT_RECHECK_MISSING");
    }
    const confirmed = parseProcStat(confirmedText);
    if (
      confirmed.pid !== pid ||
      confirmed.startTimeTicks !== stat.startTimeTicks
    )
      throw new Error("SERVICE_RESOURCE_PID_REUSED_DURING_CAPTURE");
    if (confirmed.parentPid !== stat.parentPid)
      throw new Error("SERVICE_RESOURCE_PARENT_CHANGED_DURING_CAPTURE");
    if (confirmed.cpuTicks < stat.cpuTicks)
      throw new Error("SERVICE_RESOURCE_CPU_REGRESSED_DURING_CAPTURE");
    rssBytes += status.rssBytes;
    highWaterBytes += status.highWaterBytes;
    taskCount += status.threads;
    cpuTicks += confirmed.cpuTicks;
    if (
      !Number.isSafeInteger(rssBytes) ||
      !Number.isSafeInteger(highWaterBytes) ||
      !Number.isSafeInteger(taskCount)
    )
      throw new Error("SERVICE_RESOURCE_COUNTER_OVERFLOW");
    identities.push({ pid, startTimeTicks: stat.startTimeTicks });
  }
  return {
    rssBytes,
    highWaterBytes,
    processCount: pids.length,
    taskCount,
    cpuTicks,
    identities,
    rootStartTimeTicks: stats.get(rootPid)!.startTimeTicks,
  };
}

export class ServiceResourceEnvelopeSampler {
  private readonly rootStarts = new Map<ServiceResourceRole, bigint>();
  private readonly seenStarts = new Map<string, bigint>();

  constructor(
    private readonly roots: Record<ServiceResourceRole, number>,
    private readonly reader: ProcReader = new LinuxProcReader(),
  ) {}

  async sample(label: ResourceSample["label"]): Promise<ResourceSample> {
    const services = {} as Record<ServiceResourceRole, ServiceTreeSample>;
    for (const role of ["api", "worker", "portal"] as const) {
      const sample = await captureServiceTree(this.roots[role], this.reader);
      const expectedRoot = this.rootStarts.get(role);
      if (
        expectedRoot !== undefined &&
        expectedRoot !== sample.rootStartTimeTicks
      )
        throw new Error(`SERVICE_RESOURCE_ROOT_REUSED:${role}`);
      this.rootStarts.set(role, sample.rootStartTimeTicks);
      for (const identity of sample.identities) {
        const key = `${role}:${identity.pid}`;
        const prior = this.seenStarts.get(key);
        if (prior !== undefined && prior !== identity.startTimeTicks)
          throw new Error(`SERVICE_RESOURCE_PID_REUSED:${role}`);
        this.seenStarts.set(key, identity.startTimeTicks);
      }
      services[role] = sample;
    }
    return { label, capturedAtMs: this.reader.nowMs(), services };
  }
}

function safeNumber(value: bigint, code: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error(code);
  return Number(value);
}

export function summarizeServiceResourceEnvelope(
  before: ResourceSample,
  after: ResourceSample,
): ServiceResourceEnvelope {
  if (
    before.label !== "BEFORE_SMOKE" ||
    after.label !== "AFTER_SMOKE" ||
    after.capturedAtMs <= before.capturedAtMs
  )
    throw new Error("SERVICE_RESOURCE_SAMPLE_ORDER_INVALID");
  const services = {} as ServiceResourceEnvelope["services"];
  for (const role of ["api", "worker", "portal"] as const) {
    const first = before.services[role];
    const last = after.services[role];
    if (last.rootStartTimeTicks !== first.rootStartTimeTicks)
      throw new Error(`SERVICE_RESOURCE_ROOT_REUSED:${role}`);
    if (last.cpuTicks < first.cpuTicks)
      throw new Error(`SERVICE_RESOURCE_CPU_REGRESSED:${role}`);
    services[role] = {
      rssBytesMax: Math.max(first.rssBytes, last.rssBytes),
      highWaterBytesMax: Math.max(first.highWaterBytes, last.highWaterBytes),
      processCountMax: Math.max(first.processCount, last.processCount),
      taskCountMax: Math.max(first.taskCount, last.taskCount),
      cpuTicksDelta: safeNumber(
        last.cpuTicks - first.cpuTicks,
        "SERVICE_RESOURCE_CPU_OVERFLOW",
      ),
    };
  }
  return {
    schema: "octoport-disposable-service-resource-envelope-v1",
    evidenceLevel: SERVICE_RESOURCE_EVIDENCE_LEVEL,
    capacityProof: "NOT_PRODUCTION_CAPACITY_PROOF",
    sampleWindowMs: after.capturedAtMs - before.capturedAtMs,
    services,
    nextProofsRequired: [
      "representative staged load before choosing finite service resource ceilings",
      "staging startup/readiness/auth/bootstrap under proposed systemd sandbox and finite controls",
      "rollback proof for proposed controls before any live apply",
    ],
  };
}

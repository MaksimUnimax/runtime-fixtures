import { constants } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as Fs from "node:fs/promises";
import {
  IndependentMonitoringScheduler,
  InMemoryMonitoringScheduleStore,
} from "@product/monitoring-control";
import type {
  ApiWatchReportStore,
  ApiWatchStore,
  AuthorityRecord,
} from "./types.js";
import {
  completeOperatorPipeline,
  operatorPipelineConsumed,
} from "./operator-receipt.js";

const readFault = vi.hoisted(() => ({
  appendAfterStat: undefined as Buffer | undefined,
  flags: 0,
  opened: 0,
  readFileCalls: 0,
  largestRead: 0,
}));

const publicationFault = vi.hoisted(() => ({
  afterTemporaryClose: undefined as (() => Promise<void>) | undefined,
  linkCalls: 0,
  linkFailure: undefined as "before" | "after" | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof Fs>();
  return {
    ...fs,
    link: async (...args: Parameters<typeof fs.link>) => {
      publicationFault.linkCalls++;
      if (publicationFault.linkFailure === "before")
        throw Object.assign(new Error("SYNTHETIC_LINK_IO_FAILURE"), {
          code: "EIO",
        });
      await fs.link(...args);
      if (publicationFault.linkFailure === "after")
        throw Object.assign(new Error("SYNTHETIC_LINK_OUTCOME_UNKNOWN"), {
          code: "EIO",
        });
    },
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      if (
        typeof args[0] === "string" &&
        args[0].includes("wb-consumed-") &&
        args[0].endsWith(".tmp") &&
        args[1] === "wx"
      )
        return new Proxy(handle, {
          get(target, key) {
            if (key === "close")
              return async () => {
                await target.close();
                await publicationFault.afterTemporaryClose?.();
              };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      if (
        typeof args[0] !== "string" ||
        !args[0].includes("wb-consumed-") ||
        !args[0].endsWith(".json") ||
        typeof args[1] !== "number"
      )
        return handle;
      readFault.flags = args[1];
      readFault.opened++;
      return new Proxy(handle, {
        get(target, key) {
          if (key === "stat")
            return async () => {
              const stat = await target.stat();
              if (readFault.appendAfterStat) {
                const growth = readFault.appendAfterStat;
                readFault.appendAfterStat = undefined;
                await fs.appendFile(String(args[0]), growth);
              }
              return stat;
            };
          if (key === "readFile")
            return async (...params: Parameters<typeof target.readFile>) => {
              readFault.readFileCalls++;
              return target.readFile(...params);
            };
          if (key === "read")
            return async (
              buffer: Buffer,
              offset: number,
              length: number,
              position: number,
            ) => {
              readFault.largestRead = Math.max(readFault.largestRead, length);
              return target.read(buffer, offset, length, position);
            };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});

afterEach(() => {
  readFault.appendAfterStat = undefined;
  readFault.flags = 0;
  readFault.opened = 0;
  readFault.readFileCalls = 0;
  readFault.largestRead = 0;
  publicationFault.afterTemporaryClose = undefined;
  publicationFault.linkCalls = 0;
  publicationFault.linkFailure = undefined;
});

async function syntheticReceipt(publish = true) {
  const quarantineDir = await mkdtemp(
    join(tmpdir(), "octoport-c03-receipt-read-"),
  );
  const artifact = {
    artifactId: "synthetic-13-member-bundle",
    requestId: "synthetic-request",
    sha256: "f".repeat(64),
  };
  const records = Array.from({ length: 13 }, (_, i) => ({
    recordId: "synthetic-record-" + i,
    sourceFamily: "WILDBERRIES",
    documentKey: "synthetic-document-" + i,
    sha256: i.toString(16).padStart(64, "0"),
    authorityStatus: "AUTHORITY_ACCEPTED",
    acquisitionMode: "OPERATOR_SUPPLIED",
    operatorRequestId: artifact.requestId,
    safeProvenance: {
      bundleArtifactId: artifact.artifactId,
      outerBundleSha256: artifact.sha256,
      documentKey: "synthetic-document-" + i,
    },
  })) as unknown as AuthorityRecord[];
  const recordMap = new Map(records.map((record) => [record.recordId, record]));
  const store = {
    findAuthorityRecord: async (id: string) => recordMap.get(id),
  } as unknown as ApiWatchStore;
  const reportStore = {
    getReport: async () => ({
      state: "COMPLETED",
      completedAt: new Date("2026-10-26T00:00:00Z"),
      sources: records.map((record, i) => ({
        sourceFamily: "WILDBERRIES",
        documentKey: "synthetic-document-" + i,
        snapshotSha256: record.sha256,
        authorityStatus: "AUTHORITY_ACCEPTED",
        acquisitionOutcome: "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE",
        blockerCode: null,
        inventoryOperationCount: 1,
        changeMode: "FIRST_SNAPSHOT",
        errorCode: null,
      })),
    }),
  } as unknown as ApiWatchReportStore;
  const candidate = { artifact, records };
  try {
    if (publish)
      await completeOperatorPipeline({
        candidate,
        reportId: "synthetic-report",
        store,
        reportStore,
        quarantineDir,
      });
  } catch (error) {
    await rm(quarantineDir, { recursive: true, force: true });
    throw error;
  }
  return { artifact, store, reportStore, quarantineDir, candidate };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("canonical consumption marker monitoring effect admission", () => {
  it.each(["cancel", "expiry", "successor"] as const)(
    "does not publish after %s while paused after real temporary file close",
    async (loss) => {
      const fixture = await syntheticReceipt(false);
      const entered = deferred(),
        release = deferred();
      publicationFault.afterTemporaryClose = async () => {
        entered.resolve();
        await release.promise;
      };
      let time = new Date("2026-11-01T00:00:00Z");
      const clock = { now: () => new Date(time) };
      const schedule = new InMemoryMonitoringScheduleStore();
      await schedule.ensureDefaults(clock.now());
      const admission = vi.spyOn(schedule, "withRunLease");
      const result = () => ({
        status: "SUCCEEDED" as const,
        code: null,
        summary: "synthetic",
      });
      const a = new IndependentMonitoringScheduler({
        store: schedule,
        clock,
        leaseMs: 10_000,
        runners: {
          SWAGGER_API: async () => {
            await completeOperatorPipeline({
              ...fixture,
              reportId: "synthetic-report",
            });
            return result();
          },
          LLM: async () => result(),
        },
      });
      const b = new IndependentMonitoringScheduler({
        store: schedule,
        clock,
        leaseMs: 10_000,
        runners: {
          SWAGGER_API: async () => result(),
          LLM: async () => result(),
        },
      });
      const terminal = a
        .runNowAndWait("SWAGGER_API")
        .catch((error: unknown) => error);
      try {
        await Promise.race([
          entered.promise,
          terminal.then(() => {
            throw new Error("TEMPORARY_CLOSE_NOT_REACHED");
          }),
        ]);
        expect(await readdir(fixture.quarantineDir)).toHaveLength(1);
        expect(publicationFault.linkCalls).toBe(0);
        if (loss === "cancel") await a.stop();
        else {
          time = new Date(time.valueOf() + 10_001);
          if (loss === "successor")
            expect((await b.runNowAndWait("SWAGGER_API")).status).toBe(
              "SUCCEEDED",
            );
        }
        release.resolve();
        await terminal;
        expect({
          admissionAttempted: admission.mock.calls.length > 0,
          physicalLinks: publicationFault.linkCalls,
          remainingFiles: await readdir(fixture.quarantineDir),
          consumed: await operatorPipelineConsumed(fixture),
        }).toEqual({
          admissionAttempted: true,
          physicalLinks: 0,
          remainingFiles: [],
          consumed: false,
        });
      } finally {
        release.resolve();
        await terminal;
        await a.stop();
        await b.stop();
        await rm(fixture.quarantineDir, { recursive: true, force: true });
      }
    },
  );

  it("publishes once under a live scheduler authority", async () => {
    const fixture = await syntheticReceipt(false);
    const schedule = new InMemoryMonitoringScheduleStore();
    await schedule.ensureDefaults(new Date());
    const admission = vi.spyOn(schedule, "withRunLease");
    const scheduler = new IndependentMonitoringScheduler({
      store: schedule,
      leaseMs: 10_000,
      runners: {
        LLM: async () => ({
          status: "SUCCEEDED",
          code: null,
          summary: "synthetic",
        }),
        SWAGGER_API: async () => {
          await completeOperatorPipeline({
            ...fixture,
            reportId: "synthetic-report",
          });
          return { status: "SUCCEEDED", code: null, summary: "synthetic" };
        },
      },
    });
    try {
      expect((await scheduler.runNowAndWait("SWAGGER_API")).status).toBe(
        "SUCCEEDED",
      );
      expect(admission).toHaveBeenCalled();
      expect(publicationFault.linkCalls).toBe(1);
      expect(await operatorPipelineConsumed(fixture)).toBe(true);
      expect(await readdir(fixture.quarantineDir)).toHaveLength(1);
    } finally {
      await scheduler.stop();
      await rm(fixture.quarantineDir, { recursive: true, force: true });
    }
  });

  it("revalidates EEXIST and retains the first valid receipt without overwrite", async () => {
    const fixture = await syntheticReceipt();
    try {
      const [name] = await readdir(fixture.quarantineDir);
      const before = await readFile(join(fixture.quarantineDir, name!));
      await completeOperatorPipeline({
        ...fixture,
        reportId: "synthetic-second-report",
      });
      expect(await readFile(join(fixture.quarantineDir, name!))).toEqual(
        before,
      );
      expect(publicationFault.linkCalls).toBe(2);
      expect(readFault.opened).toBe(1);
      expect(await operatorPipelineConsumed(fixture)).toBe(true);
      expect(await readdir(fixture.quarantineDir)).toEqual([name]);
    } finally {
      await rm(fixture.quarantineDir, { recursive: true, force: true });
    }
  });

  it("rejects an invalid first receipt at EEXIST without replacing it", async () => {
    const fixture = await syntheticReceipt();
    try {
      const [name] = await readdir(fixture.quarantineDir);
      const path = join(fixture.quarantineDir, name!);
      const invalid = JSON.stringify({ version: 1, members: [] });
      await writeFile(path, invalid);
      await expect(
        completeOperatorPipeline({
          ...fixture,
          reportId: "synthetic-second-report",
        }),
      ).rejects.toThrow("OPERATOR_RECEIPT_INVALID");
      expect(await readFile(path, "utf8")).toBe(invalid);
      expect(publicationFault.linkCalls).toBe(2);
      expect(await readdir(fixture.quarantineDir)).toEqual([name]);
    } finally {
      await rm(fixture.quarantineDir, { recursive: true, force: true });
    }
  });

  it.each(["before", "after"] as const)(
    "does not replay a %s-dispatch link failure",
    async (phase) => {
      const fixture = await syntheticReceipt(false);
      publicationFault.linkFailure = phase;
      try {
        await expect(
          completeOperatorPipeline({
            ...fixture,
            reportId: "synthetic-report",
          }),
        ).rejects.toThrow(
          phase === "before"
            ? "SYNTHETIC_LINK_IO_FAILURE"
            : "SYNTHETIC_LINK_OUTCOME_UNKNOWN",
        );
        expect(publicationFault.linkCalls).toBe(1);
        const files = await readdir(fixture.quarantineDir);
        expect(files.every((name) => name.endsWith(".json"))).toBe(true);
        expect(files).toHaveLength(phase === "before" ? 0 : 1);
        expect(await operatorPipelineConsumed(fixture)).toBe(phase === "after");
      } finally {
        await rm(fixture.quarantineDir, { recursive: true, force: true });
      }
    },
  );
});

describe("bounded and nonblocking operator consumption receipt reads", () => {
  it("reads a valid 13-member receipt with nonblocking nofollow descriptor and no read-to-EOF", async () => {
    const fixture = await syntheticReceipt();
    try {
      expect(await operatorPipelineConsumed(fixture)).toBe(true);
      expect(readFault.opened).toBe(1);
      expect(readFault.flags & constants.O_NOFOLLOW).toBeTruthy();
      expect(readFault.flags & constants.O_NONBLOCK).toBeTruthy();
      expect(readFault.readFileCalls).toBe(0);
      expect(readFault.largestRead).toBeGreaterThan(0);
      expect(readFault.largestRead).toBeLessThanOrEqual(64 * 1024 + 1);
    } finally {
      await rm(fixture.quarantineDir, { recursive: true, force: true });
    }
  });

  it("rejects a receipt grown immediately after opened-descriptor stat, without reading to EOF", async () => {
    const fixture = await syntheticReceipt();
    try {
      readFault.appendAfterStat = Buffer.from("trailing-growth-after-stat");
      await expect(operatorPipelineConsumed(fixture)).rejects.toThrow(
        "OPERATOR_RECEIPT_INVALID",
      );
      expect(readFault.readFileCalls).toBe(0);
      expect(readFault.largestRead).toBeGreaterThan(0);
      expect(readFault.largestRead).toBeLessThanOrEqual(64 * 1024 + 1);
    } finally {
      await rm(fixture.quarantineDir, { recursive: true, force: true });
    }
  });
  it.each([
    { label: "missing", value: undefined },
    { label: "string", value: "1" },
    { label: "NaN", value: Number.NaN },
    { label: "negative", value: -1 },
    { label: "fractional", value: 0.5 },
    { label: "infinite", value: Number.POSITIVE_INFINITY },
    {
      label: "unsafe integer",
      value: Number.MAX_SAFE_INTEGER + 1,
    },
  ])(
    "rejects a terminal report source with an invalid inventory operation count ($label)",
    async ({ value }) => {
      const fixture = await syntheticReceipt();
      const originalGetReport = fixture.reportStore.getReport.bind(
        fixture.reportStore,
      );
      vi.spyOn(fixture.reportStore, "getReport").mockImplementation(
        async (reportId) => {
          const report = await originalGetReport(reportId);
          if (report?.sources[0]) {
            const source = report.sources[0] as unknown as Record<
              string,
              unknown
            >;
            if (value === undefined) delete source.inventoryOperationCount;
            else source.inventoryOperationCount = value;
          }
          return report;
        },
      );
      try {
        await expect(operatorPipelineConsumed(fixture)).rejects.toThrow(
          "OPERATOR_RECEIPT_INVALID",
        );
      } finally {
        await rm(fixture.quarantineDir, { recursive: true, force: true });
      }
    },
  );
});

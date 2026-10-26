import { constants } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as Fs from "node:fs/promises";
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

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof Fs>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
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
});

async function syntheticReceipt() {
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
  return { artifact, store, reportStore, quarantineDir };
}

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
});

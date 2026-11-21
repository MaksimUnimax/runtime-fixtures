import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SwaggerSourceStore } from "@product/monitoring-control";
import { runAuthorityPass } from "./authority.js";
import {
  completeOperatorPipeline,
  operatorPipelineConsumed,
} from "./operator-receipt.js";
import type {
  ApiWatchReportStore,
  ApiWatchStore,
  AuthorityRecord,
  SourceRegistry,
} from "./types.js";
import { WB_BUNDLE_DOCUMENT_KEY } from "./wb-bundle.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

const invalidRoots = [
  { label: "null", json: "null" },
  { label: "false", json: "false" },
  { label: "zero", json: "0" },
  { label: "negative zero", json: "-0" },
  { label: "empty string", json: '""' },
  { label: "true", json: "true" },
  { label: "positive number", json: "1" },
  { label: "negative number", json: "-1" },
  { label: "nonempty string", json: '"synthetic"' },
  { label: "array", json: "[]" },
  { label: "object without receipt fields", json: "{}" },
] as const;

async function fixture() {
  const quarantineDir = await mkdtemp(
    join(tmpdir(), "octoport-r7-receipt-state-"),
  );
  roots.push(quarantineDir);
  const artifact = {
    artifactId: "r7-synthetic-13-member-bundle",
    requestId: "r7-synthetic-request",
    sha256: "f".repeat(64),
  };
  const records = Array.from({ length: 13 }, (_, index) => ({
    recordId: "r7-synthetic-record-" + index,
    sourceFamily: "WILDBERRIES",
    sha256: index.toString(16).padStart(64, "0"),
    authorityStatus: "AUTHORITY_ACCEPTED",
    acquisitionMode: "OPERATOR_SUPPLIED",
    operatorRequestId: artifact.requestId,
    safeProvenance: {
      bundleArtifactId: artifact.artifactId,
      outerBundleSha256: artifact.sha256,
      documentKey: "r7-synthetic-document-" + index,
    },
  })) as unknown as AuthorityRecord[];
  const findAuthorityRecord = vi.fn(async (id: string) =>
    records.find((record) => record.recordId === id),
  );
  const getReport = vi.fn(async () => ({
    state: "COMPLETED",
    completedAt: new Date("2026-11-02T00:00:00Z"),
    sources: records.map((record) => ({
      sourceFamily: "WILDBERRIES",
      documentKey: record.safeProvenance.documentKey,
      snapshotSha256: record.sha256,
      authorityStatus: "AUTHORITY_ACCEPTED",
      acquisitionOutcome: "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE",
      blockerCode: null,
      inventoryOperationCount: 0,
      changeMode: "FIRST_SNAPSHOT",
      errorCode: null,
    })),
  }));
  const store = { findAuthorityRecord } as unknown as ApiWatchStore;
  const reportStore = { getReport } as unknown as ApiWatchReportStore;
  const path = join(
    quarantineDir,
    "wb-consumed-" +
      createHash("sha256").update(artifact.artifactId).digest("hex") +
      ".json",
  );
  const complete = () =>
    completeOperatorPipeline({
      candidate: { artifact, records },
      reportId: "r7-synthetic-report",
      store,
      reportStore,
      quarantineDir,
    });
  return {
    artifact,
    records,
    quarantineDir,
    store,
    reportStore,
    findAuthorityRecord,
    getReport,
    path,
    complete,
  };
}

describe("existing canonical receipt JSON state classification", () => {
  it.each(invalidRoots)(
    "rejects present $label before any receipt repository lookup",
    async ({ json }) => {
      const f = await fixture();
      await writeFile(f.path, json);
      const before = await stat(f.path);
      await expect(operatorPipelineConsumed(f)).rejects.toThrow(
        "OPERATOR_RECEIPT_INVALID",
      );
      expect(f.getReport).not.toHaveBeenCalled();
      expect(f.findAuthorityRecord).not.toHaveBeenCalled();
      expect(await readFile(f.path, "utf8")).toBe(json);
      expect((await stat(f.path)).ino).toBe(before.ino);
      expect(await readdir(f.quarantineDir)).toEqual([
        f.path.split("/").at(-1),
      ]);
    },
  );

  it.each(invalidRoots)(
    "classifies EEXIST $label as invalid while preserving the first file",
    async ({ json }) => {
      const f = await fixture();
      await writeFile(f.path, json);
      const before = await stat(f.path);
      await expect(f.complete()).rejects.toThrow("OPERATOR_RECEIPT_INVALID");
      // Only the proposed complete receipt is verified. A malformed existing
      // canonical marker must never cause repository lookup or replacement.
      expect(f.getReport).toHaveBeenCalledTimes(1);
      expect(f.findAuthorityRecord).toHaveBeenCalledTimes(13);
      expect(await readFile(f.path, "utf8")).toBe(json);
      expect((await stat(f.path)).ino).toBe(before.ino);
      expect(await readdir(f.quarantineDir)).toEqual([
        f.path.split("/").at(-1),
      ]);
    },
  );

  it.each(invalidRoots)(
    "stops authority evaluation before processing a bundle with $label",
    async ({ json }) => {
      const f = await fixture();
      await writeFile(f.path, json);
      const getRequest = vi.fn(() => {
        throw new Error("UNEXPECTED_DOWNSTREAM_OPERATOR_EVALUATION");
      });
      const fetcher = vi.fn(() => {
        throw new Error("UNEXPECTED_DOWNSTREAM_NETWORK");
      });
      const registry = {
        list: () => [{ sourceFamily: "WILDBERRIES", documents: f.records }],
      } as unknown as SourceRegistry;
      const pendingStore = {
        listReadyRequests: async () => [
          {
            requestId: f.artifact.requestId,
            sourceFamily: "WILDBERRIES",
            documentKey: WB_BUNDLE_DOCUMENT_KEY,
          },
        ],
        listArtifacts: async () => [
          { ...f.artifact, status: "CANDIDATE_READY" },
        ],
        getRequest,
      } as unknown as SwaggerSourceStore;
      await expect(
        runAuthorityPass({ ...f, registry, pendingStore, fetcher }),
      ).rejects.toThrow("OPERATOR_RECEIPT_INVALID");
      expect(getRequest).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
      expect(f.getReport).not.toHaveBeenCalled();
      expect(f.findAuthorityRecord).not.toHaveBeenCalled();
      expect(await readFile(f.path, "utf8")).toBe(json);
    },
  );
});

describe("real filesystem receipt absence and complete-consumption controls", () => {
  it("returns false for ENOENT without repository lookup or file creation", async () => {
    const f = await fixture();
    expect(await operatorPipelineConsumed(f)).toBe(false);
    expect(f.getReport).not.toHaveBeenCalled();
    expect(f.findAuthorityRecord).not.toHaveBeenCalled();
    expect(await readdir(f.quarantineDir)).toEqual([]);
  });

  it("publishes absent canonical once and revalidates all 13 members at EEXIST", async () => {
    const f = await fixture();
    await f.complete();
    const before = await readFile(f.path);
    const beforeStat = await stat(f.path);
    f.getReport.mockClear();
    f.findAuthorityRecord.mockClear();
    await f.complete();
    expect(f.getReport).toHaveBeenCalledTimes(2);
    expect(f.findAuthorityRecord).toHaveBeenCalledTimes(26);
    expect(await readFile(f.path)).toEqual(before);
    expect((await stat(f.path)).ino).toBe(beforeStat.ino);
    f.getReport.mockClear();
    f.findAuthorityRecord.mockClear();
    expect(await operatorPipelineConsumed(f)).toBe(true);
    expect(f.getReport).toHaveBeenCalledTimes(1);
    expect(f.findAuthorityRecord).toHaveBeenCalledTimes(13);
    expect(await readdir(f.quarantineDir)).toHaveLength(1);
  });

  it("preserves the optional report-store guard before any filesystem open", async () => {
    const f = await fixture();
    await mkdir(f.path);
    expect(
      await operatorPipelineConsumed({ ...f, reportStore: undefined }),
    ).toBe(false);
    expect(f.findAuthorityRecord).not.toHaveBeenCalled();
    expect((await stat(f.path)).isDirectory()).toBe(true);
  });

  it.each([
    { label: "empty", bytes: Buffer.alloc(0) },
    { label: "truncated JSON", bytes: Buffer.from('{"version":') },
    { label: "trailing data", bytes: Buffer.from("{} trailing") },
    { label: "invalid UTF8", bytes: Buffer.from([0xff]) },
  ])("rejects $label without changing real bytes", async ({ bytes }) => {
    const f = await fixture();
    await writeFile(f.path, bytes);
    await expect(operatorPipelineConsumed(f)).rejects.toThrow(
      "OPERATOR_RECEIPT_INVALID",
    );
    expect(f.getReport).not.toHaveBeenCalled();
    expect(f.findAuthorityRecord).not.toHaveBeenCalled();
    expect(await readFile(f.path)).toEqual(bytes);
  });

  it("rejects a real directory without repository lookup", async () => {
    const f = await fixture();
    await mkdir(f.path);
    await expect(operatorPipelineConsumed(f)).rejects.toThrow(
      "OPERATOR_RECEIPT_INVALID",
    );
    expect(f.getReport).not.toHaveBeenCalled();
    expect(f.findAuthorityRecord).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "rejects a real nofollow symlink (dangling=%s) and preserves its target",
    async (dangling) => {
      const f = await fixture();
      const target = join(f.quarantineDir, "synthetic-target");
      if (!dangling) {
        await f.complete();
        await writeFile(target, await readFile(f.path));
        await rm(f.path);
      }
      await symlink(target, f.path);
      const before = dangling ? undefined : await readFile(target);
      await expect(operatorPipelineConsumed(f)).rejects.toMatchObject({
        code: "ELOOP",
      });
      if (!dangling) expect(await readFile(target)).toEqual(before);
    },
  );

  it.each([65536, 65537])(
    "enforces the real regular-file byte limit at %s bytes",
    async (size) => {
      const f = await fixture();
      await f.complete();
      const receipt = await readFile(f.path);
      const bytes = Buffer.concat([
        receipt,
        Buffer.alloc(size - receipt.length, 0x20),
      ]);
      await writeFile(f.path, bytes);
      f.getReport.mockClear();
      f.findAuthorityRecord.mockClear();
      if (size === 65536) {
        expect(await operatorPipelineConsumed(f)).toBe(true);
        expect(f.getReport).toHaveBeenCalledTimes(1);
        expect(f.findAuthorityRecord).toHaveBeenCalledTimes(13);
      } else {
        await expect(operatorPipelineConsumed(f)).rejects.toThrow(
          "OPERATOR_RECEIPT_INVALID",
        );
        expect(f.getReport).not.toHaveBeenCalled();
        expect(f.findAuthorityRecord).not.toHaveBeenCalled();
      }
      expect(await readFile(f.path)).toEqual(bytes);
    },
  );

  it("keeps one real canonical receipt intact across 16 concurrent readers", async () => {
    const f = await fixture();
    await f.complete();
    const before = await readFile(f.path);
    f.getReport.mockClear();
    f.findAuthorityRecord.mockClear();
    expect(
      await Promise.all(
        Array.from({ length: 16 }, () => operatorPipelineConsumed(f)),
      ),
    ).toEqual(Array(16).fill(true));
    expect(f.getReport).toHaveBeenCalledTimes(16);
    expect(f.findAuthorityRecord).toHaveBeenCalledTimes(16 * 13);
    expect(await readFile(f.path)).toEqual(before);
    expect(await readdir(f.quarantineDir)).toHaveLength(1);
  });
});

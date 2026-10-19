import { mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as Fs from "node:fs/promises";
import {
  createSwaggerHandoffService,
  InMemorySwaggerSourceStore,
} from "@product/monitoring-control";
import {
  createSourceRegistry,
  evaluateOperatorCandidate,
  InMemoryApiWatchStore,
} from "./index.js";

const fault = vi.hoisted(() => ({
  appendAfterStat: undefined as Buffer | undefined,
  readFileCalls: 0,
  maxReadLength: 0,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof Fs>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      return new Proxy(handle, {
        get(target, key) {
          if (key === "stat")
            return async () => {
              const value = await target.stat();
              if (fault.appendAfterStat) {
                const append = fault.appendAfterStat;
                fault.appendAfterStat = undefined;
                await fs.appendFile(String(args[0]), append);
              }
              return value;
            };
          if (key === "readFile")
            return async () => {
              fault.readFileCalls += 1;
              return target.readFile();
            };
          if (key === "read")
            return async (
              buffer: Buffer,
              offset: number,
              length: number,
              position: number,
            ) => {
              fault.maxReadLength = Math.max(fault.maxReadLength, length);
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
  fault.appendAfterStat = undefined;
  fault.readFileCalls = 0;
  fault.maxReadLength = 0;
});

const OFFICIAL = "https://official.example.test/openapi.json";
const OPENAPI = Buffer.from(
  JSON.stringify({
    openapi: "3.0.3",
    info: { title: "Quarantine fixture", version: "1" },
    paths: {
      "/health": { get: { responses: { "200": { description: "ok" } } } },
    },
  }),
);

function registry() {
  return createSourceRegistry({
    OZON_SELLER: {
      sourceFamily: "OZON_SELLER",
      officialUrl: OFFICIAL,
      expectedArtifactTypes: ["JSON", "YAML", "YML"],
      maximumBytes: 25 * 1024 * 1024,
      acquisitionPolicy: "OPERATOR_ASSISTED_WHEN_AUTOMATIC_ACCESS_IS_BLOCKED",
      operatorAcceptancePolicy: "REVIEW_REQUIRED",
      acceptedHosts: ["official.example.test"],
    },
    OZON_PERFORMANCE: { officialUrl: null, documents: [] },
    WILDBERRIES: { officialUrl: null, documents: [] },
  });
}

async function uploadedCandidate() {
  const root = await mkdtemp(join(tmpdir(), "octoport-c03-quarantine-"));
  const pending = new InMemorySwaggerSourceStore();
  const request = await pending.createRequest({
    requestId: "read-identity",
    sourceFamily: "OZON_SELLER",
    officialUrl: OFFICIAL,
    expectedArtifactType: "JSON",
    blockerReason: "synthetic",
  });
  const handoff = createSwaggerHandoffService({
    store: pending,
    quarantineDir: root,
  });
  const upload = await handoff.upload({
    requestId: request.requestId,
    operatorId: "1",
    originalFilename: "source.json",
    bytes: OPENAPI,
  });
  if (upload.kind !== "CANDIDATE_READY") throw new Error("FIXTURE_NOT_READY");
  return { root, pending, request, upload };
}

describe("operator quarantine candidate file identity", () => {
  it("rejects symlink replacement even if the pointed-to bytes have the expected digest", async () => {
    const { root, pending, request, upload } = await uploadedCandidate();
    const outside = await mkdtemp(join(tmpdir(), "octoport-c03-outside-"));
    try {
      const target = join(outside, "identical.json");
      await writeFile(target, OPENAPI);
      const artifactPath = join(root, upload.artifact.quarantineFilename);
      await unlink(artifactPath);
      await symlink(target, artifactPath);
      const result = await evaluateOperatorCandidate({
        requestId: request.requestId,
        registry: registry(),
        pendingStore: pending,
        store: new InMemoryApiWatchStore(),
        quarantineDir: root,
      });
      expect(result).toEqual({
        kind: "AUTHORITY_REJECTED",
        reason: "CANDIDATE_BYTES_UNAVAILABLE",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("bounds growth after opened-file stat without reading to EOF", async () => {
    const { root, pending, request } = await uploadedCandidate();
    try {
      fault.appendAfterStat = Buffer.from("growth-after-stat");
      fault.readFileCalls = 0;
      fault.maxReadLength = 0;
      const result = await evaluateOperatorCandidate({
        requestId: request.requestId,
        registry: registry(),
        pendingStore: pending,
        store: new InMemoryApiWatchStore(),
        quarantineDir: root,
      });
      expect(result).toEqual({
        kind: "AUTHORITY_REJECTED",
        reason: "CANDIDATE_DIGEST_MISMATCH",
      });
      expect(fault.readFileCalls).toBe(0);
      expect(fault.maxReadLength).toBeLessThanOrEqual(OPENAPI.length + 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("continues accepting a normal unchanged regular candidate for review", async () => {
    const { root, pending, request } = await uploadedCandidate();
    try {
      const result = await evaluateOperatorCandidate({
        requestId: request.requestId,
        registry: registry(),
        pendingStore: pending,
        store: new InMemoryApiWatchStore(),
        quarantineDir: root,
      });
      expect(result.kind).toBe("AUTHORITY_REVIEW_REQUIRED");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

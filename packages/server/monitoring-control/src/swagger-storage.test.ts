import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as Fs from "node:fs/promises";
import {
  createInMemorySwaggerSourceState,
  createSwaggerHandoffService,
  createPostgresSwaggerSourceStore,
  type SwaggerSourceSqlRuntime,
  InMemorySwaggerSourceStore,
} from "./swagger-handoff.js";

const storageFault = vi.hoisted(() => ({
  stage: "",
  failure: undefined as Error | undefined,
  cleanup: undefined as Error | undefined,
  closeFailure: undefined as Error | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof Fs>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      return new Proxy(handle, {
        get(target, key) {
          if (key === "writeFile")
            return async (...values: Parameters<typeof handle.writeFile>) => {
              if (storageFault.stage === "write") {
                await target.writeFile(Buffer.from("partial"));
                throw storageFault.failure;
              }
              return target.writeFile(...values);
            };
          if (key === "sync")
            return async () => {
              if (storageFault.stage === "sync") throw storageFault.failure;
              return target.sync();
            };
          if (key === "close")
            return async () => {
              await target.close();
              if (storageFault.closeFailure) throw storageFault.closeFailure;
            };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
    link: async (...args: Parameters<typeof fs.link>) => {
      if (storageFault.stage === "link") throw storageFault.failure;
      return fs.link(...args);
    },
    unlink: async (...args: Parameters<typeof fs.unlink>) => {
      if (storageFault.cleanup) throw storageFault.cleanup;
      return fs.unlink(...args);
    },
  };
});

const directories: string[] = [];
afterEach(async () => {
  storageFault.stage = "";
  storageFault.failure = undefined;
  storageFault.cleanup = undefined;
  storageFault.closeFailure = undefined;
  vi.restoreAllMocks();
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function fixture(expiresAt?: Date) {
  const directory = await mkdtemp(
    join(tmpdir(), "octoport-quarantine-storage-"),
  );
  directories.push(directory);
  const store = new InMemorySwaggerSourceStore(
    createInMemorySwaggerSourceState(),
  );
  const request = await store.createRequest({
    requestId: "storage-request",
    expiresAt,
    sourceFamily: "OZON_SELLER",
    officialUrl: "https://example.test/source.json",
    expectedArtifactType: "OPENAPI_OR_SWAGGER",
    blockerReason: "test",
  });
  const service = () =>
    createSwaggerHandoffService({ store, quarantineDir: directory });
  const input = {
    requestId: request.requestId,
    operatorId: "fixture",
    originalFilename: "source.json",
    bytes: Buffer.from(
      '{"openapi":"3.0.3","info":{"title":"Fixture","version":"1"},"paths":{}}',
    ),
  };
  return { directory, store, service, input };
}
describe("quarantine retry and uncertain registration", () => {
  it.each(["CANDIDATE_READY", "VALIDATION_FAILED"] as const)(
    "does not expire concurrently registered %s from a stale request read",
    async (status) => {
      const expiry = new Date(Date.now() + 60000);
      const f = await fixture(expiry);
      const input =
        status === "CANDIDATE_READY"
          ? f.input
          : { ...f.input, bytes: Buffer.from("{}") };
      const get = f.store.getRequest.bind(f.store);
      vi.spyOn(f.store, "getRequest").mockImplementationOnce(async (id) => {
        const stale = await get(id);
        await f.service().upload(input);
        return stale;
      });
      await f
        .service()
        .upload({ ...input, receivedAt: new Date(expiry.valueOf() + 1) });
      expect((await get(input.requestId))?.status).toBe(status);
      expect(await f.store.listArtifacts(input.requestId)).toHaveLength(1);
    },
  );
  it("preserves a foreign canonical payload when terminal rejection does not own its bytes", async () => {
    const f = await fixture();
    const filename = `request-${(await import("node:crypto")).createHash("sha256").update(f.input.requestId).digest("hex")}.upload`;
    const path = join(f.directory, filename);
    await writeFile(path, "foreign canonical bytes");
    await f.store.setRequestStatus(f.input.requestId, "CANCELLED");
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await f.service().upload(f.input)).toEqual({
        kind: "REJECTED",
        code: "REQUEST_FINALIZED",
      });
      expect(await readFile(path, "utf8")).toBe("foreign canonical bytes");
      expect(await readdir(f.directory)).toEqual([filename]);
    }
  });
  it.each(["CANDIDATE_READY", "VALIDATION_FAILED"] as const)(
    "does not regress committed %s when a delayed identical upload crashes",
    async (registeredStatus) => {
      const f = await fixture();
      const input =
        registeredStatus === "CANDIDATE_READY"
          ? f.input
          : { ...f.input, bytes: Buffer.from("{}") };
      let resume!: () => void;
      let reached!: () => void;
      const pause = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const crash = new Error("CRASH_AFTER_DELAYED_STATUS_UPDATE");
      const update = f.store.setRequestStatus.bind(f.store);
      vi.spyOn(f.store, "setRequestStatus").mockImplementationOnce(
        async (requestId, status, options) => {
          reached();
          await pause;
          await update(requestId, status, options);
          throw crash;
        },
      );
      const delayed = f
        .service()
        .upload(input)
        .catch((error) => error);
      await ready;
      await f.service().upload(input);
      expect((await f.store.getRequest(input.requestId))?.status).toBe(
        registeredStatus,
      );
      resume();
      expect(await delayed).toBe(crash);
      expect((await f.store.getRequest(input.requestId))?.status).toBe(
        registeredStatus,
      );
      expect(await f.store.listArtifacts(input.requestId)).toHaveLength(1);
      expect(await readdir(f.directory)).toHaveLength(1);
      if (registeredStatus === "CANDIDATE_READY")
        expect(await f.service().listPending()).toEqual([]);
    },
  );

  it.each(["CANDIDATE_READY", "VALIDATION_FAILED"] as const)(
    "reconciles a delayed upload after competing %s without revalidation",
    async (registeredStatus) => {
      const f = await fixture();
      const input =
        registeredStatus === "CANDIDATE_READY"
          ? f.input
          : { ...f.input, bytes: Buffer.from("{}") };
      let resume!: () => void;
      let reached!: () => void;
      const pause = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const update = f.store.setRequestStatus.bind(f.store);
      vi.spyOn(f.store, "setRequestStatus").mockImplementationOnce(
        async (requestId, status, options) => {
          reached();
          await pause;
          return update(requestId, status, options);
        },
      );
      const validate = vi.fn(() => undefined);
      const service = createSwaggerHandoffService({
        store: f.store,
        quarantineDir: f.directory,
        validateUpload: validate,
      });
      const delayed = service.upload(input);
      await ready;
      await service.upload(input);
      resume();
      const duplicate = await delayed;
      expect(duplicate.kind).toBe("DUPLICATE");
      if (duplicate.kind === "DUPLICATE")
        expect(duplicate.artifact.status).toBe(registeredStatus);
      expect(validate).toHaveBeenCalledTimes(1);
      expect((await f.store.getRequest(input.requestId))?.status).toBe(
        registeredStatus,
      );
      expect(await f.store.listArtifacts(input.requestId)).toHaveLength(1);
      expect(await readdir(f.directory)).toHaveLength(1);
    },
  );

  it("atomically guards quarantine against already registered request states", async () => {
    const statements: { sql: string; values?: unknown[] }[] = [];
    const runtime: SwaggerSourceSqlRuntime = {
      async query(sql, values) {
        statements.push({ sql, values });
        return { rows: [] };
      },
      async transaction(operation) {
        return operation(runtime);
      },
    };
    const expectedStatuses = [
      "PENDING_OPERATOR_UPLOAD",
      "UPLOAD_RECEIVED",
      "QUARANTINED",
    ] as const;
    expect(
      await createPostgresSwaggerSourceStore(runtime).setRequestStatus(
        "storage-request",
        "QUARANTINED",
        { preserveTerminal: true, expectedStatuses: [...expectedStatuses] },
      ),
    ).toBe(false);
    expect(statements).toHaveLength(1);
    expect(statements[0]?.sql).toContain("AND status = ANY($3::text[])");
    expect(statements[0]?.sql).toContain("RETURNING request_id");
    expect(statements[0]?.values).toEqual([
      "storage-request",
      "QUARANTINED",
      [...expectedStatuses],
    ]);
  });

  it.each(["CANCELLED", "EXPIRED"] as const)(
    "retains one stable payload when %s wins before quarantine update",
    async (terminal) => {
      const f = await fixture();
      await writeFile(join(f.directory, "unrelated.tmp"), "keep");
      const update = f.store.setRequestStatus.bind(f.store);
      vi.spyOn(f.store, "setRequestStatus").mockImplementationOnce(
        async (requestId, status, options) => {
          await update(requestId, terminal);
          return update(requestId, status, options);
        },
      );
      expect(await f.service().upload(f.input)).toEqual({
        kind: "REJECTED",
        code: "REQUEST_FINALIZED",
      });
      expect(await readdir(f.directory)).toHaveLength(2);
      const payload = (await readdir(f.directory)).find((name) =>
        name.endsWith(".upload"),
      )!;
      expect(await readFile(join(f.directory, payload))).toEqual(f.input.bytes);
      expect(await f.store.listArtifacts(f.input.requestId)).toHaveLength(0);
    },
  );
  it.each(["CANCELLED", "EXPIRED"] as const)(
    "retains a bounded canonical payload across repeated %s retries",
    async (terminal) => {
      const f = await fixture();
      const service = createSwaggerHandoffService({
        store: f.store,
        quarantineDir: f.directory,
        validateUpload: async () => {
          await f.store.setRequestStatus(f.input.requestId, terminal);
          return undefined;
        },
      });
      expect(await service.upload(f.input)).toEqual({
        kind: "REJECTED",
        code: "REQUEST_FINALIZED",
      });
      const [filename] = await readdir(f.directory);
      expect(filename).toMatch(/^request-[a-f0-9]{64}\.upload$/);
      const getRequest = f.store.getRequest.bind(f.store);
      for (let attempt = 0; attempt < 3; attempt++) {
        expect(await f.service().upload(f.input)).toEqual({
          kind: "REJECTED",
          code: "REQUEST_FINALIZED",
        });
        expect(await readdir(f.directory)).toEqual([filename]);
        expect(await readFile(join(f.directory, filename!))).toEqual(
          f.input.bytes,
        );
        expect((await getRequest(f.input.requestId))?.status).toBe(terminal);
      }
      expect(await f.store.listArtifacts(f.input.requestId)).toHaveLength(0);
    },
  );

  it.each(["CANCELLED", "EXPIRED"] as const)(
    "checks and locks current %s in the artifact registration transaction",
    async (terminal) => {
      const statements: { sql: string; transaction: boolean }[] = [];
      let inTransaction = false;
      const runtime: SwaggerSourceSqlRuntime = {
        async query<T extends Record<string, unknown>>(sql: string) {
          statements.push({ sql, transaction: inTransaction });
          return {
            rows: (sql.startsWith("SELECT status FROM swagger_source_requests")
              ? [{ status: terminal }]
              : []) as unknown as T[],
          };
        },
        async transaction(operation) {
          inTransaction = true;
          try {
            return await operation(runtime);
          } finally {
            inTransaction = false;
          }
        },
      };
      const f = await fixture();
      await f.service().upload(f.input);
      const [artifact] = await f.store.listArtifacts(f.input.requestId);
      await expect(
        createPostgresSwaggerSourceStore(runtime).saveArtifact(artifact!),
      ).rejects.toThrow("SWAGGER_REQUEST_FINALIZED");
      expect(statements).toHaveLength(1);
      expect(statements[0]?.transaction).toBe(true);
      expect(statements[0]?.sql).toContain("FOR UPDATE");
      expect(
        statements.some((entry) =>
          entry.sql.includes("INSERT INTO swagger_source_artifacts"),
        ),
      ).toBe(false);
    },
  );

  it.each(["CANCELLED", "EXPIRED"] as const)(
    "rejects registration when %s commits during validation",
    async (terminal) => {
      const f = await fixture();
      const service = createSwaggerHandoffService({
        store: f.store,
        quarantineDir: f.directory,
        validateUpload: async () => {
          await f.store.setRequestStatus(f.input.requestId, terminal);
          return undefined;
        },
      });
      expect(await service.upload(f.input)).toEqual({
        kind: "REJECTED",
        code: "REQUEST_FINALIZED",
      });
      expect((await f.store.getRequest(f.input.requestId))?.status).toBe(
        terminal,
      );
      expect(await f.store.listArtifacts(f.input.requestId)).toHaveLength(0);
      expect(await readdir(f.directory)).toHaveLength(1);
    },
  );

  it("guards reconciliation in one database update without a stale read", async () => {
    const statements: { sql: string; values?: unknown[] }[] = [];
    const runtime: SwaggerSourceSqlRuntime = {
      async query(sql, values) {
        statements.push({ sql, values });
        return { rows: [] };
      },
      async transaction(operation) {
        return operation(runtime);
      },
    };
    await createPostgresSwaggerSourceStore(runtime).setRequestStatus(
      "storage-request",
      "CANDIDATE_READY",
      { preserveTerminal: true },
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]?.sql).toMatch(/^UPDATE swagger_source_requests SET /);
    expect(statements[0]?.sql).toContain(
      "WHERE request_id=$1 AND status NOT IN ('CANCELLED','EXPIRED')",
    );
    expect(statements[0]?.values).toEqual([
      "storage-request",
      "CANDIDATE_READY",
    ]);
  });

  it.each(["CANCELLED", "EXPIRED"] as const)(
    "preserves concurrent %s while reconciling a duplicate",
    async (terminal) => {
      const f = await fixture();
      await f.service().upload(f.input);
      await f.store.setRequestStatus(f.input.requestId, "QUARANTINED");
      const find = f.store.findArtifactByDigest.bind(f.store);
      vi.spyOn(f.store, "findArtifactByDigest").mockImplementationOnce(
        async (...args) => {
          const artifact = await find(...args);
          await f.store.setRequestStatus(f.input.requestId, terminal);
          return artifact;
        },
      );
      expect((await f.service().upload(f.input)).kind).toBe("DUPLICATE");
      expect((await f.store.getRequest(f.input.requestId))?.status).toBe(
        terminal,
      );
      expect(await readdir(f.directory)).toHaveLength(1);
    },
  );
  it.each(["CANCELLED", "EXPIRED"] as const)(
    "preserves concurrent %s after a lost commit acknowledgement",
    async (terminal) => {
      const f = await fixture();
      const save = f.store.saveArtifact.bind(f.store);
      vi.spyOn(f.store, "saveArtifact").mockImplementationOnce(
        async (artifact) => {
          await save(artifact);
          await f.store.setRequestStatus(f.input.requestId, terminal);
          throw new Error("ACK_LOST");
        },
      );
      expect(await f.service().upload(f.input)).toEqual({
        kind: "REJECTED",
        code: "REQUEST_FINALIZED",
      });
      expect((await f.store.getRequest(f.input.requestId))?.status).toBe(
        terminal,
      );
      expect(await readdir(f.directory)).toHaveLength(1);
    },
  );
  it.each(["CANCELLED", "EXPIRED"] as const)(
    "preserves concurrent %s after an acknowledged artifact save",
    async (terminal) => {
      const f = await fixture();
      const save = f.store.saveArtifact.bind(f.store);
      vi.spyOn(f.store, "saveArtifact").mockImplementationOnce(
        async (artifact) => {
          const saved = await save(artifact);
          await f.store.setRequestStatus(f.input.requestId, terminal);
          return saved;
        },
      );
      expect(await f.service().upload(f.input)).toEqual({
        kind: "REJECTED",
        code: "REQUEST_FINALIZED",
      });
      expect((await f.store.getRequest(f.input.requestId))?.status).toBe(
        terminal,
      );
      expect(await readdir(f.directory)).toHaveLength(1);
    },
  );

  it.each(["write", "sync"])(
    "preserves simultaneous %s and close failures",
    async (stage) => {
      const f = await fixture();
      const original = Object.assign(new Error("UPLOAD_STORAGE_FAILED"), {
        code: "ENOSPC",
      });
      const close = Object.assign(new Error("CLOSE_STORAGE_FAILED"), {
        code: "EIO",
      });
      storageFault.stage = stage;
      storageFault.failure = original;
      storageFault.closeFailure = close;
      const error: unknown = await f
        .service()
        .upload(f.input)
        .catch((caught) => caught);
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([original, close]);
      expect(await readdir(f.directory)).toEqual([]);
    },
  );

  it.each(["write", "sync", "link"])(
    "preserves the %s failure when temporary cleanup also fails",
    async (stage) => {
      const f = await fixture();
      await writeFile(join(f.directory, "unrelated.tmp"), "keep");
      const original = Object.assign(new Error("UPLOAD_STORAGE_FAILED"), {
        code: "ENOSPC",
      });
      const cleanup = Object.assign(new Error("TEMP_CLEANUP_DENIED"), {
        code: "EACCES",
      });
      storageFault.stage = stage;
      storageFault.failure = original;
      storageFault.cleanup = cleanup;
      const error: unknown = await f
        .service()
        .upload(f.input)
        .catch((caught) => caught);
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([original, cleanup]);
      expect(await readFile(join(f.directory, "unrelated.tmp"), "utf8")).toBe(
        "keep",
      );
      expect(await f.store.listArtifacts(f.input.requestId)).toHaveLength(0);
    },
  );

  it("retains one retry payload through three rejected saves and service recreation", async () => {
    const f = await fixture();
    const save = vi
      .spyOn(f.store, "saveArtifact")
      .mockRejectedValue(new Error("DATABASE_SAVE_FAILED"));
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(f.service().upload(f.input)).rejects.toThrow(
        "DATABASE_SAVE_FAILED",
      );
      expect(await readdir(f.directory)).toHaveLength(1);
      expect((await readdir(f.directory))[0]).toMatch(
        /^request-[0-9a-f]{64}\.upload$/,
      );
    }
    expect(await f.store.listArtifacts(f.input.requestId)).toHaveLength(0);
    save.mockRestore();
    expect((await f.service().upload(f.input)).kind).toBe("CANDIDATE_READY");
    expect(await readdir(f.directory)).toHaveLength(1);
    expect(await f.store.listArtifacts(f.input.requestId)).toHaveLength(1);
  });
  it("reconciles commit followed by lost acknowledgement without removing registered bytes", async () => {
    const f = await fixture();
    const original = f.store.saveArtifact.bind(f.store);
    vi.spyOn(f.store, "saveArtifact").mockImplementation(async (artifact) => {
      await original(artifact);
      throw new Error("ACK_LOST");
    });
    const result = await f.service().upload(f.input);
    expect(result.kind).toBe("DUPLICATE");
    const [artifact] = await f.store.listArtifacts(f.input.requestId);
    expect(
      await readFile(join(f.directory, artifact!.quarantineFilename)),
    ).toEqual(f.input.bytes);
    expect((await f.store.getRequest(f.input.requestId))?.status).toBe(
      "CANDIDATE_READY",
    );
  });
  it("keeps bytes when both commit acknowledgement and reconciliation are unavailable", async () => {
    const f = await fixture();
    const original = f.store.saveArtifact.bind(f.store);
    const save = vi
      .spyOn(f.store, "saveArtifact")
      .mockImplementation(async (artifact) => {
        await original(artifact);
        vi.spyOn(f.store, "findArtifactByDigest").mockRejectedValue(
          new Error("LOOKUP_DOWN"),
        );
        throw new Error("ACK_LOST");
      });
    await expect(f.service().upload(f.input)).rejects.toThrow("ACK_LOST");
    expect(await readdir(f.directory)).toHaveLength(1);
    save.mockRestore();
    vi.restoreAllMocks();
    expect((await f.service().upload(f.input)).kind).toBe("DUPLICATE");
    const [artifact] = await f.store.listArtifacts(f.input.requestId);
    expect(
      await readFile(join(f.directory, artifact!.quarantineFilename)),
    ).toEqual(f.input.bytes);
  });
  it.each(["QUARANTINED", "CANDIDATE_READY"] as const)(
    "recovers after failed %s status update",
    async (status) => {
      const f = await fixture();
      const original = f.store.setRequestStatus.bind(f.store);
      const update = vi
        .spyOn(f.store, "setRequestStatus")
        .mockImplementation(async (id, next, options) => {
          if (next === status) throw new Error("STATUS_FAILED");
          return original(id, next, options);
        });
      for (let attempt = 0; attempt < 3; attempt++)
        await expect(f.service().upload(f.input)).rejects.toThrow(
          "STATUS_FAILED",
        );
      expect(await readdir(f.directory)).toHaveLength(1);
      update.mockRestore();
      await f.service().upload(f.input);
      expect((await f.store.getRequest(f.input.requestId))?.status).toBe(
        "CANDIDATE_READY",
      );
      expect(await f.store.listArtifacts(f.input.requestId)).toHaveLength(1);
    },
  );
  it("does not overwrite a pending upload with different bytes", async () => {
    const f = await fixture();
    vi.spyOn(f.store, "saveArtifact").mockRejectedValue(
      new Error("DATABASE_SAVE_FAILED"),
    );
    await expect(f.service().upload(f.input)).rejects.toThrow(
      "DATABASE_SAVE_FAILED",
    );
    await expect(
      f.service().upload({ ...f.input, bytes: Buffer.from("different") }),
    ).rejects.toThrow("QUARANTINE_PENDING_UPLOAD_MISMATCH");
    const [name] = await readdir(f.directory);
    expect(await readFile(join(f.directory, name!))).toEqual(f.input.bytes);
  });
  it("concurrent identical uploads share one complete payload and one registration", async () => {
    const f = await fixture();
    const results = await Promise.all([
      f.service().upload(f.input),
      f.service().upload(f.input),
    ]);
    expect(results.map((x) => x.kind).sort()).toEqual([
      "CANDIDATE_READY",
      "DUPLICATE",
    ]);
    expect(await readdir(f.directory)).toHaveLength(1);
    expect(await f.store.listArtifacts(f.input.requestId)).toHaveLength(1);
  });
});

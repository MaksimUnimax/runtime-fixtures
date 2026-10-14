import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as Fs from "node:fs/promises";
import { InMemoryApiWatchStore } from "./authority.js";
import { promoteAcceptedSnapshot } from "./snapshot.js";
import type { AuthorityRecord } from "./types.js";

const fault = vi.hoisted(() => ({
  stage: "",
  cleanup: false,
  closeFailure: undefined as Error | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof Fs>();
  const failure = () =>
    Object.assign(new Error("INJECTED_STORAGE_FAILURE"), { code: "ENOSPC" });
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      return new Proxy(handle, {
        get(target, key) {
          if (key === "writeFile")
            return async (...values: Parameters<typeof handle.writeFile>) => {
              if (fault.stage === "write") {
                await target.writeFile(Buffer.from("partial"));
                throw failure();
              }
              return target.writeFile(...values);
            };
          if (key === "sync")
            return async () => {
              if (fault.stage === "sync") throw failure();
              return target.sync();
            };
          if (key === "close")
            return async () => {
              await target.close();
              if (fault.closeFailure) throw fault.closeFailure;
              if (fault.stage === "close") throw failure();
            };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
    rename: async (...args: Parameters<typeof fs.rename>) => {
      if (fault.stage === "rename") throw failure();
      return fs.rename(...args);
    },
    unlink: async (...args: Parameters<typeof fs.unlink>) => {
      if (fault.cleanup)
        throw Object.assign(new Error("CLEANUP_DENIED"), { code: "EACCES" });
      return fs.unlink(...args);
    },
  };
});
const realFs = await vi.importActual<typeof Fs>("node:fs/promises");
const roots: string[] = [];
afterEach(async () => {
  fault.stage = "";
  fault.closeFailure = undefined;
  fault.cleanup = false;
  for (const root of roots.splice(0))
    await realFs.rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await realFs.mkdtemp(
    join(tmpdir(), "octoport-snapshot-storage-"),
  );
  roots.push(root);
  const bytes = Buffer.from(
    '{"openapi":"3.0.3","info":{"version":"1"},"paths":{}}',
  );
  const record: AuthorityRecord = {
    recordId: "storage-fixture",
    sourceFamily: "OZON_SELLER",
    officialUrl: "https://example.test/openapi.json",
    acquisitionMode: "AUTOMATIC",
    authorityStatus: "AUTHORITY_ACCEPTED",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.length,
    specVersion: "3.0.3",
    acquiredAt: new Date(0),
    validatedAt: new Date(0),
    operatorRequestId: null,
    artifactExtension: ".json",
    safeProvenance: {},
    failureClassification: null,
  };
  return {
    record,
    bytes,
    store: new InMemoryApiWatchStore(),
    snapshotRoot: root,
  };
}
describe("snapshot filesystem failure cleanup", () => {
  it.each(["write", "sync"])(
    "preserves simultaneous %s and close failures",
    async (stage) => {
      const input = await fixture();
      const close = Object.assign(new Error("CLOSE_STORAGE_FAILED"), {
        code: "EIO",
      });
      fault.stage = stage;
      fault.closeFailure = close;
      const error: unknown = await promoteAcceptedSnapshot(input).catch(
        (caught) => caught,
      );
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors[0]).toMatchObject({
        code: "ENOSPC",
      });
      expect((error as AggregateError).errors[1]).toBe(close);
      expect(
        await realFs.readdir(join(input.snapshotRoot, "OZON_SELLER")),
      ).toEqual([]);
    },
  );

  it.each(["write", "sync", "close", "rename"])(
    "cleans three failed %s attempts and preserves another writer",
    async (stage) => {
      const input = await fixture();
      const directory = join(input.snapshotRoot, "OZON_SELLER");
      await realFs.mkdir(directory);
      await realFs.writeFile(join(directory, ".other-writer.tmp"), "retain");
      fault.stage = stage;
      for (let attempt = 0; attempt < 3; attempt++) {
        await expect(promoteAcceptedSnapshot(input)).rejects.toThrow(
          "INJECTED_STORAGE_FAILURE",
        );
        expect(await realFs.readdir(directory)).toEqual([".other-writer.tmp"]);
      }
      fault.stage = "";
      const saved = await promoteAcceptedSnapshot(input);
      expect(await realFs.readFile(saved.artifactPath)).toEqual(input.bytes);
    },
  );
  it("keeps one published file on successful retries and metadata rejection", async () => {
    const input = await fixture();
    const saved = await promoteAcceptedSnapshot(input);
    await promoteAcceptedSnapshot(input);
    vi.spyOn(input.store, "saveSnapshot").mockRejectedValue(
      new Error("DB_FAILURE"),
    );
    await expect(promoteAcceptedSnapshot(input)).rejects.toThrow("DB_FAILURE");
    expect(
      await realFs.readdir(join(input.snapshotRoot, "OZON_SELLER")),
    ).toEqual([`${input.record.sha256}.json`]);
    expect(await realFs.readFile(saved.artifactPath)).toEqual(input.bytes);
  });
  it("reports both the original failure and a cleanup failure", async () => {
    const input = await fixture();
    fault.stage = "write";
    fault.cleanup = true;
    await expect(promoteAcceptedSnapshot(input)).rejects.toMatchObject({
      message: "SNAPSHOT_TEMP_CLEANUP_FAILED",
      errors: [
        expect.objectContaining({ code: "ENOSPC" }),
        expect.objectContaining({ code: "EACCES" }),
      ],
    });
  });
});

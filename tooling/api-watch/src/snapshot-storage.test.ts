import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as Fs from "node:fs/promises";
import { InMemoryApiWatchStore } from "./authority.js";
import { promoteAcceptedSnapshot, readAcceptedSnapshot } from "./snapshot.js";
import type { AuthorityRecord } from "./types.js";

const fault = vi.hoisted(() => ({
  stage: "",
  inspectCode: "",
  racedBytes: undefined as Buffer | undefined,
  racedInode: 0,
  cleanup: false,
  closeFailure: undefined as Error | undefined,
  growAfterStat: undefined as Buffer | undefined,
  readFileCalls: 0,
  maxReadLength: 0,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof Fs>();
  const failure = () =>
    Object.assign(new Error("INJECTED_STORAGE_FAILURE"), { code: "ENOSPC" });
  return {
    ...fs,
    lstat: async (...args: Parameters<typeof fs.lstat>) => {
      if (fault.inspectCode && String(args[0]).endsWith(".json"))
        throw Object.assign(new Error("INSPECTION_FAILED"), {
          code: fault.inspectCode,
        });
      return fs.lstat(...args);
    },
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      return new Proxy(handle, {
        get(target, key) {
          if (key === "stat")
            return async () => {
              const observed = await target.stat();
              if (fault.growAfterStat) {
                const append = fault.growAfterStat;
                fault.growAfterStat = undefined;
                await fs.appendFile(String(args[0]), append);
              }
              return observed;
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
    link: async (...args: Parameters<typeof fs.link>) => {
      if (fault.stage === "publish") throw failure();
      if (fault.racedBytes) {
        await fs.writeFile(args[1], fault.racedBytes, { flag: "wx" });
        fault.racedInode = Number((await fs.lstat(args[1])).ino);
        fault.racedBytes = undefined;
      }
      return fs.link(...args);
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
  fault.inspectCode = "";
  fault.racedBytes = undefined;
  fault.racedInode = 0;
  fault.closeFailure = undefined;
  fault.growAfterStat = undefined;
  fault.readFileCalls = 0;
  fault.maxReadLength = 0;
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
describe("read accepted snapshot filesystem identity", () => {
  it("rejects a symbolic-link replacement even with identical expected bytes", async () => {
    const input = await fixture();
    const saved = await promoteAcceptedSnapshot(input);
    const outside = join(input.snapshotRoot, "same-bytes.json");
    await realFs.writeFile(outside, input.bytes);
    await realFs.unlink(saved.artifactPath);
    await realFs.symlink(outside, saved.artifactPath);
    await expect(readAcceptedSnapshot(saved)).rejects.toMatchObject({
      code: "ELOOP",
    });
  });

  it("still reads the original accepted regular file by its recorded digest", async () => {
    const input = await fixture();
    const saved = await promoteAcceptedSnapshot(input);
    expect(await readAcceptedSnapshot(saved)).toEqual(input.bytes);
  });

  it("bounds a regular-file growth race after fstat without readFile-to-EOF", async () => {
    const input = await fixture();
    const saved = await promoteAcceptedSnapshot(input);
    fault.growAfterStat = Buffer.from("extra bytes after stat");
    fault.readFileCalls = 0;
    fault.maxReadLength = 0;
    await expect(readAcceptedSnapshot(saved)).rejects.toThrow(
      "SNAPSHOT_SIZE_MISMATCH",
    );
    expect(fault.readFileCalls).toBe(0);
    expect(fault.maxReadLength).toBeLessThanOrEqual(input.bytes.length + 1);
  });

  it("rejects changed regular-file bytes even when the recorded length still matches", async () => {
    const input = await fixture();
    const saved = await promoteAcceptedSnapshot(input);
    const altered = Buffer.from(input.bytes);
    altered[0] = (altered[0] ?? 0) ^ 1;
    await realFs.writeFile(saved.artifactPath, altered);
    await expect(readAcceptedSnapshot(saved)).rejects.toThrow(
      "SNAPSHOT_DIGEST_MISMATCH",
    );
  });
});

describe("snapshot filesystem failure cleanup", () => {
  it.each(["EACCES", "EIO"])(
    "propagates %s instead of treating an unchecked destination as missing",
    async (code) => {
      const input = await fixture();
      fault.inspectCode = code;
      await expect(promoteAcceptedSnapshot(input)).rejects.toMatchObject({
        code,
      });
      expect(
        await realFs.readdir(join(input.snapshotRoot, "OZON_SELLER")),
      ).toEqual([]);
    },
  );
  it("preserves conflicting bytes published between absence check and publication", async () => {
    const input = await fixture();
    const foreign = Buffer.from("other writer");
    fault.racedBytes = foreign;
    await expect(promoteAcceptedSnapshot(input)).rejects.toThrow(
      "SNAPSHOT_CONTENT_ADDRESS_COLLISION",
    );
    const path = join(
      input.snapshotRoot,
      "OZON_SELLER",
      `${input.record.sha256}.json`,
    );
    expect(await realFs.readFile(path)).toEqual(foreign);
    expect(
      await realFs.readdir(join(input.snapshotRoot, "OZON_SELLER")),
    ).toEqual([`${input.record.sha256}.json`]);
  });
  it("reuses an identical raced publication without replacing its inode", async () => {
    const input = await fixture();
    fault.racedBytes = input.bytes;
    const saved = await promoteAcceptedSnapshot(input);
    expect(Number((await realFs.lstat(saved.artifactPath)).ino)).toBe(
      fault.racedInode,
    );
    expect(await realFs.readFile(saved.artifactPath)).toEqual(input.bytes);
    expect(
      await realFs.readdir(join(input.snapshotRoot, "OZON_SELLER")),
    ).toEqual([`${input.record.sha256}.json`]);
  });
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

  it.each(["write", "sync", "close", "publish"])(
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

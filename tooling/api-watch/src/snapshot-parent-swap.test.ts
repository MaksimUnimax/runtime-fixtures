import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type * as Fs from "node:fs/promises";
import { InMemoryApiWatchStore } from "./authority.js";
import { promoteAcceptedSnapshot, readAcceptedSnapshot } from "./snapshot.js";
import type { AuthorityRecord } from "./types.js";

const race = vi.hoisted(() => ({
  target: "" as string,
  outside: "" as string,
  moved: "" as string,
  triggered: false,
  failDirectoryClose: false,
  directoryCloseInjected: false,
  directoryHandles: [] as Array<{
    close: () => Promise<void>;
    closed: boolean;
  }>,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof Fs>();
  const { constants } = await import("node:fs");
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      if (
        !race.failDirectoryClose ||
        typeof args[1] !== "number" ||
        !(args[1] & constants.O_DIRECTORY)
      )
        return handle;
      const tracked = { close: () => handle.close(), closed: false };
      race.directoryHandles.push(tracked);
      return new Proxy(handle, {
        get(target, key) {
          if (key === "close")
            return async () => {
              if (!race.directoryCloseInjected && String(args[0]) === "/") {
                race.directoryCloseInjected = true;
                throw new Error("SYNTHETIC_PARENT_DIRECTORY_CLOSE_FAILED");
              }
              await tracked.close();
              tracked.closed = true;
            };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
    lstat: async (...args: Parameters<typeof fs.lstat>) => {
      const original = await fs.lstat(...args);
      if (race.target && String(args[0]) === race.target) {
        const target = race.target;
        race.target = "";
        await fs.rename(target, race.moved);
        await fs.symlink(race.outside, target);
        race.triggered = true;
      }
      return original;
    },
  };
});

const dirs: string[] = [];
afterEach(async () => {
  for (const tracked of race.directoryHandles.splice(0)) {
    if (!tracked.closed) await tracked.close();
  }
  race.failDirectoryClose = false;
  race.directoryCloseInjected = false;
  race.target = "";
  race.outside = "";
  race.moved = "";
  race.triggered = false;
  for (const path of dirs.splice(0).reverse()) {
    await rm(path, { recursive: true, force: true });
  }
});

it("never promotes to a path redirected through a swapped snapshot-root parent", async () => {
  const root = await mkdtemp(join(tmpdir(), "octoport-c03-snapshot-root-"));
  const outside = await mkdtemp(
    join(tmpdir(), "octoport-c03-snapshot-outside-"),
  );
  const moved = root + "-old";
  dirs.push(outside, moved, root);
  await mkdir(join(outside, "OZON_SELLER"));
  const bytes = Buffer.from(
    '{"openapi":"3.0.3","info":{"version":"1"},"paths":{}}',
  );
  const record = {
    recordId: "synthetic-snapshot-parent-test",
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
  } as AuthorityRecord;
  const store = new InMemoryApiWatchStore();
  race.target = root;
  race.outside = outside;
  race.moved = moved;
  await expect(
    promoteAcceptedSnapshot({ record, bytes, store, snapshotRoot: root }),
  ).rejects.toThrow();
  expect(race.triggered).toBe(true);
  expect(await readdir(join(outside, "OZON_SELLER"))).toEqual([]);
  expect(await store.listSnapshots()).toEqual([]);
});

it("refuses an unchanged-digest file behind a substituted snapshot-root directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "octoport-c03-snapshot-read-"));
  const outside = await mkdtemp(
    join(tmpdir(), "octoport-c03-snapshot-read-outside-"),
  );
  const moved = root + "-old";
  dirs.push(outside, moved, root);
  const bytes = Buffer.from(
    '{"openapi":"3.0.3","info":{"version":"1"},"paths":{}}',
  );
  const record = {
    recordId: "read-parent-test",
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
  } as AuthorityRecord;
  const saved = await promoteAcceptedSnapshot({
    record,
    bytes,
    store: new InMemoryApiWatchStore(),
    snapshotRoot: root,
  });
  await mkdir(join(outside, "OZON_SELLER"));
  await writeFile(join(outside, "OZON_SELLER", record.sha256 + ".json"), bytes);
  await rename(root, moved);
  await symlink(outside, root);
  await expect(readAcceptedSnapshot(saved)).rejects.toThrow();
});

it("creates missing snapshot-root ancestors through pinned directory handles", async () => {
  const parent = await mkdtemp(
    join(tmpdir(), "octoport-c03-snapshot-new-root-"),
  );
  dirs.push(parent);
  const root = join(parent, "missing", "nested");
  const bytes = Buffer.from(
    '{"openapi":"3.0.3","info":{"version":"1"},"paths":{}}',
  );
  const record = {
    recordId: "missing-root-test",
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
  } as AuthorityRecord;
  const saved = await promoteAcceptedSnapshot({
    record,
    bytes,
    store: new InMemoryApiWatchStore(),
    snapshotRoot: root,
  });
  expect(await readAcceptedSnapshot(saved)).toEqual(bytes);
});

it("closes both pinned handles when a directory handoff close rejects", async () => {
  const root = await mkdtemp(join(tmpdir(), "octoport-c03-directory-close-"));
  dirs.push(root);
  const bytes = Buffer.from(
    '{"openapi":"3.0.3","info":{"version":"1"},"paths":{}}',
  );
  const record = {
    recordId: "directory-close-test",
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
  } as AuthorityRecord;
  const store = new InMemoryApiWatchStore();
  race.failDirectoryClose = true;
  await expect(
    promoteAcceptedSnapshot({ record, bytes, store, snapshotRoot: root }),
  ).rejects.toThrow("SYNTHETIC_PARENT_DIRECTORY_CLOSE_FAILED");
  expect(race.directoryCloseInjected).toBe(true);
  expect(race.directoryHandles.length).toBeGreaterThan(1);
  expect(race.directoryHandles.every((handle) => handle.closed)).toBe(true);
  expect(await store.listSnapshots()).toEqual([]);
});

import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { SwaggerSourceFamilySchema } from "@product/monitoring-control";
import type {
  ApiWatchStore,
  AuthorityRecord,
  OperationInventory,
  SnapshotMetadata,
} from "./types.js";
import { API_WATCH_MAX_ARTIFACT_BYTES } from "./types.js";

export const DEFAULT_API_WATCH_SNAPSHOT_ROOT =
  "/var/lib/octoport/api-watch/snapshots";

function extensionFor(record: AuthorityRecord): string {
  const extension = record.artifactExtension?.toLowerCase() ?? ".json";
  if (!/^\.(?:json|yaml|yml)$/.test(extension))
    throw new Error("SNAPSHOT_EXTENSION_INVALID");
  return extension;
}

// Every path segment is resolved under a pinned directory descriptor.
function directoryFlags(): number {
  if (!constants.O_DIRECTORY || !constants.O_NOFOLLOW)
    throw new Error("SNAPSHOT_PINNED_DIRECTORY_UNAVAILABLE");
  return constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
}

function pinnedChildPath(parent: FileHandle, name: string): string {
  return join("/proc/self/fd", String(parent.fd), name);
}

async function openPinnedChildDirectory(
  parent: FileHandle,
  name: string,
  create: boolean,
): Promise<FileHandle> {
  const path = pinnedChildPath(parent, name);
  try {
    return await open(path, directoryFlags());
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOTDIR" || code === "ELOOP")
      throw new Error("SNAPSHOT_PATH_NOT_DIRECTORY", { cause: error });
    if (!create || code !== "ENOENT") throw error;
  }
  try {
    await mkdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  try {
    return await open(path, directoryFlags());
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOTDIR" || code === "ELOOP")
      throw new Error("SNAPSHOT_PATH_NOT_DIRECTORY", { cause: error });
    throw error;
  }
}

async function openPinnedDirectory(
  path: string,
  create: boolean,
): Promise<FileHandle> {
  let current = await open("/", directoryFlags());
  try {
    for (const name of resolve(path).split("/").filter(Boolean)) {
      const next = await openPinnedChildDirectory(current, name, create);
      await current.close();
      current = next;
    }
    return current;
  } catch (error) {
    await current.close();
    throw error;
  }
}

async function assertSameDirectory(
  path: string,
  pinned: FileHandle,
): Promise<void> {
  const [actual, retained] = await Promise.all([lstat(path), pinned.stat()]);
  if (
    !actual.isDirectory() ||
    actual.dev !== retained.dev ||
    actual.ino !== retained.ino
  )
    throw new Error("SNAPSHOT_DIRECTORY_IDENTITY_CHANGED");
}

// Read-only validation before pinning; a post-check swap cannot authorize an
// open through a symlink, because each later component uses O_NOFOLLOW.
async function verifyExistingRoot(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error("SNAPSHOT_PATH_NOT_DIRECTORY");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function assertExistingFile(path: string): Promise<"missing" | "file"> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error("SNAPSHOT_PATH_NOT_FILE");
    return "file";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return "missing";
  }
}

// Both accepted reads and reuse verification must have the same bounded
// descriptor semantics. The extra byte detects growth after the initial stat.
async function readExactSnapshotBytes(
  handle: FileHandle,
  expectedSize: number,
  mismatchCode: "SNAPSHOT_SIZE_MISMATCH" | "SNAPSHOT_CONTENT_ADDRESS_COLLISION",
): Promise<Buffer> {
  const buffer = Buffer.alloc(expectedSize + 1);
  let received = 0;
  while (received < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      received,
      buffer.length - received,
      received,
    );
    if (bytesRead === 0) break;
    received += bytesRead;
  }
  if (received !== expectedSize) throw new Error(mismatchCode);
  return buffer.subarray(0, received);
}

async function verifyExistingSnapshot(
  path: string,
  sizeBytes: number,
  sha256: string,
): Promise<void> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("SNAPSHOT_PATH_NOT_FILE");
    if (stat.size > API_WATCH_MAX_ARTIFACT_BYTES || stat.size !== sizeBytes)
      throw new Error("SNAPSHOT_CONTENT_ADDRESS_COLLISION");
    const bytes = await readExactSnapshotBytes(
      handle,
      sizeBytes,
      "SNAPSHOT_CONTENT_ADDRESS_COLLISION",
    );
    if (createHash("sha256").update(bytes).digest("hex") !== sha256)
      throw new Error("SNAPSHOT_CONTENT_ADDRESS_COLLISION");
  } finally {
    await handle.close();
  }
}

export async function promoteAcceptedSnapshot(input: {
  record: AuthorityRecord;
  bytes: Uint8Array;
  store: ApiWatchStore;
  inventory?: OperationInventory;
  snapshotRoot?: string;
  documentKey?: string | null;
  now?: () => Date;
}): Promise<SnapshotMetadata> {
  const { record, bytes, store } = input;
  if (record.authorityStatus !== "AUTHORITY_ACCEPTED")
    throw new Error("SNAPSHOT_AUTHORITY_NOT_ACCEPTED");
  SwaggerSourceFamilySchema.parse(record.sourceFamily);
  if (!record.officialUrl || !record.sha256 || !record.specVersion)
    throw new Error("SNAPSHOT_AUTHORITY_PROVENANCE_INCOMPLETE");
  if (bytes.byteLength > API_WATCH_MAX_ARTIFACT_BYTES)
    throw new Error("SNAPSHOT_TOO_LARGE");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== record.sha256) throw new Error("SNAPSHOT_DIGEST_MISMATCH");
  if (record.sizeBytes !== bytes.byteLength)
    throw new Error("SNAPSHOT_SIZE_MISMATCH");
  if (
    input.inventory &&
    (input.inventory.sourceFamily !== record.sourceFamily ||
      input.inventory.snapshotSha256 !== sha256)
  )
    throw new Error("API_WATCH_SNAPSHOT_INVENTORY_IDENTITY_MISMATCH");
  const root = resolve(
    input.snapshotRoot ??
      process.env.API_WATCH_SNAPSHOT_ROOT ??
      DEFAULT_API_WATCH_SNAPSHOT_ROOT,
  );
  await verifyExistingRoot(root);
  const rootDirectory = await openPinnedDirectory(root, true);
  try {
    const familyDirectoryHandle = await openPinnedChildDirectory(
      rootDirectory,
      record.sourceFamily,
      true,
    );
    try {
      const familyDirectory = resolve(root, record.sourceFamily);
      const pinnedFamilyDirectory = pinnedChildPath(familyDirectoryHandle, ".");
      const extension = extensionFor(record);
      const artifactPath = join(familyDirectory, `${sha256}${extension}`);
      if (!artifactPath.startsWith(`${familyDirectory}/`))
        throw new Error("SNAPSHOT_PATH_TRAVERSAL");
      const stableArtifactPath = join(
        pinnedFamilyDirectory,
        basename(artifactPath),
      );
      const existing = await assertExistingFile(stableArtifactPath);
      if (existing === "file") {
        await verifyExistingSnapshot(
          stableArtifactPath,
          bytes.byteLength,
          sha256,
        );
      } else {
        const temporaryPath = join(
          pinnedFamilyDirectory,
          `.${sha256}.${randomUUID()}.tmp`,
        );
        const handle = await open(temporaryPath, "wx", 0o600);
        let failed = false;
        let failure: unknown;
        try {
          let writingFailed = false;
          let writeFailure: unknown;
          try {
            await handle.writeFile(bytes);
            await handle.sync();
          } catch (error) {
            writingFailed = true;
            writeFailure = error;
          }
          try {
            await handle.close();
          } catch (closeError) {
            if (writingFailed)
              throw new AggregateError(
                [writeFailure, closeError],
                "SNAPSHOT_WRITE_AND_CLOSE_FAILED",
                { cause: writeFailure },
              );
            throw closeError;
          }
          if (writingFailed) throw writeFailure;
          try {
            // Publishing must not replace an entry created by a competing writer.
            await link(temporaryPath, stableArtifactPath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            await verifyExistingSnapshot(
              stableArtifactPath,
              bytes.byteLength,
              sha256,
            );
          }
        } catch (error) {
          failed = true;
          failure = error;
        }
        // Remove only this invocation's temporary name, even after a successful link.
        // The canonical snapshot may be referenced by another writer or DB record.
        try {
          await unlink(temporaryPath);
        } catch (cleanupError) {
          if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
            if (failed)
              throw new AggregateError(
                [failure, cleanupError],
                "SNAPSHOT_TEMP_CLEANUP_FAILED",
              );
            throw cleanupError;
          }
        }
        if (failed) throw failure;
      }
      const documentKey = input.documentKey ?? null;
      const snapshotId =
        documentKey === null
          ? `${record.sourceFamily}:${sha256}`
          : `${record.sourceFamily}:${sha256}:${createHash("sha256")
              .update(documentKey)
              .digest("hex")}`;
      const metadata: SnapshotMetadata = {
        snapshotId,
        sourceFamily: record.sourceFamily,
        sha256,
        sizeBytes: bytes.byteLength,
        specVersion: record.specVersion,
        officialUrl: record.officialUrl,
        acquisitionMode: record.acquisitionMode,
        createdAt: (input.now ?? (() => new Date()))(),
        authorityRecordId: record.recordId,
        artifactPath,
        documentKey: input.documentKey ?? null,
      };
      // Only persist a pathname still bound to the original pinned directories.
      await assertSameDirectory(root, rootDirectory);
      await assertSameDirectory(familyDirectory, familyDirectoryHandle);
      // Await the metadata transaction before releasing the pinned parent FDs.
      return await (input.inventory
        ? store.saveSnapshotWithInventory(metadata, input.inventory)
        : store.saveSnapshot(metadata));
    } finally {
      await familyDirectoryHandle.close();
    }
  } finally {
    await rootDirectory.close();
  }
}

export async function readAcceptedSnapshot(
  metadata: SnapshotMetadata,
): Promise<Uint8Array> {
  // Verify the opened descriptor, not a path that can become a symlink after
  // publication. Nonblocking open rejects named pipes without waiting for a writer.
  const parentPath = dirname(metadata.artifactPath);
  const directory = await openPinnedDirectory(parentPath, false);
  try {
    const handle = await open(
      pinnedChildPath(directory, basename(metadata.artifactPath)),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error("SNAPSHOT_PATH_NOT_FILE");
      if (stat.size > API_WATCH_MAX_ARTIFACT_BYTES)
        throw new Error("SNAPSHOT_TOO_LARGE");
      if (stat.size !== metadata.sizeBytes)
        throw new Error("SNAPSHOT_SIZE_MISMATCH");
      const bytes = await readExactSnapshotBytes(
        handle,
        metadata.sizeBytes,
        "SNAPSHOT_SIZE_MISMATCH",
      );
      if (createHash("sha256").update(bytes).digest("hex") !== metadata.sha256)
        throw new Error("SNAPSHOT_DIGEST_MISMATCH");
      await assertSameDirectory(parentPath, directory);
      return bytes;
    } finally {
      await handle.close();
    }
  } finally {
    await directory.close();
  }
}

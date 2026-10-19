import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
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

async function assertDirectory(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error("SNAPSHOT_PATH_NOT_DIRECTORY");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(path, { recursive: true });
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error("SNAPSHOT_PATH_NOT_DIRECTORY");
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

async function verifyExistingSnapshot(
  path: string,
  sizeBytes: number,
  sha256: string,
): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("SNAPSHOT_PATH_NOT_FILE");
    if (
      stat.size !== sizeBytes ||
      createHash("sha256")
        .update(await handle.readFile())
        .digest("hex") !== sha256
    )
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
  await assertDirectory(root);
  const familyDirectory = resolve(root, record.sourceFamily);
  await assertDirectory(familyDirectory);
  const extension = extensionFor(record);
  const artifactPath = join(familyDirectory, `${sha256}${extension}`);
  if (!artifactPath.startsWith(`${familyDirectory}/`))
    throw new Error("SNAPSHOT_PATH_TRAVERSAL");
  const existing = await assertExistingFile(artifactPath);
  if (existing === "file") {
    await verifyExistingSnapshot(artifactPath, bytes.byteLength, sha256);
  } else {
    const temporaryPath = join(
      familyDirectory,
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
        await link(temporaryPath, artifactPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await verifyExistingSnapshot(artifactPath, bytes.byteLength, sha256);
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
  return input.inventory
    ? store.saveSnapshotWithInventory(metadata, input.inventory)
    : store.saveSnapshot(metadata);
}

export async function readAcceptedSnapshot(
  metadata: SnapshotMetadata,
): Promise<Uint8Array> {
  // Verify the opened descriptor, not a path that can become a symlink after
  // publication. Nonblocking open rejects named pipes without waiting for a writer.
  const handle = await open(
    metadata.artifactPath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("SNAPSHOT_PATH_NOT_FILE");
    if (stat.size > API_WATCH_MAX_ARTIFACT_BYTES)
      throw new Error("SNAPSHOT_TOO_LARGE");
    if (stat.size !== metadata.sizeBytes)
      throw new Error("SNAPSHOT_SIZE_MISMATCH");
    // A writer can extend the inode after fstat. Read at most the expected
    // bytes plus one sentinel byte instead of reading to an unbounded EOF.
    const buffer = Buffer.alloc(metadata.sizeBytes + 1);
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
    if (received !== metadata.sizeBytes)
      throw new Error("SNAPSHOT_SIZE_MISMATCH");
    const bytes = buffer.subarray(0, received);
    if (createHash("sha256").update(bytes).digest("hex") !== metadata.sha256)
      throw new Error("SNAPSHOT_DIGEST_MISMATCH");
    return bytes;
  } finally {
    await handle.close();
  }
}

import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SwaggerSourceFamilySchema } from "@product/monitoring-control";
import type {
  ApiWatchStore,
  AuthorityRecord,
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
    if (
      error instanceof Error &&
      error.message === "SNAPSHOT_PATH_NOT_DIRECTORY"
    )
      throw error;
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
    if (error instanceof Error && error.message === "SNAPSHOT_PATH_NOT_FILE")
      throw error;
    return "missing";
  }
}

export async function promoteAcceptedSnapshot(input: {
  record: AuthorityRecord;
  bytes: Uint8Array;
  store: ApiWatchStore;
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
    const current = await readFile(artifactPath);
    if (createHash("sha256").update(current).digest("hex") !== sha256)
      throw new Error("SNAPSHOT_CONTENT_ADDRESS_COLLISION");
  } else {
    const temporaryPath = join(
      familyDirectory,
      `.${sha256}.${randomUUID()}.tmp`,
    );
    const handle = await open(temporaryPath, "wx", 0o600);
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
      await rename(temporaryPath, artifactPath);
    } catch (error) {
      // Only this invocation's unpublished file is eligible for cleanup.
      // Never remove artifactPath: a concurrent publication may own it.
      try {
        await unlink(temporaryPath);
      } catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT")
          throw new AggregateError(
            [error, cleanupError],
            "SNAPSHOT_TEMP_CLEANUP_FAILED",
          );
      }
      throw error;
    }
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
  return store.saveSnapshot(metadata);
}

export async function readAcceptedSnapshot(
  metadata: SnapshotMetadata,
): Promise<Uint8Array> {
  const bytes = await readFile(metadata.artifactPath);
  if (createHash("sha256").update(bytes).digest("hex") !== metadata.sha256)
    throw new Error("SNAPSHOT_DIGEST_MISMATCH");
  if (bytes.byteLength !== metadata.sizeBytes)
    throw new Error("SNAPSHOT_SIZE_MISMATCH");
  return bytes;
}

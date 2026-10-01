import { lstat, readdir, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";

export type ServiceRuntimeIdentity = Readonly<{
  uid: number;
  gid: number;
}>;

const MAX_ID = 2_147_483_647;

function parseId(value: string | undefined, code: string): number {
  if (value === undefined || !/^[0-9]+$/.test(value)) throw new Error(code);
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0 || id > MAX_ID)
    throw new Error(code);
  return id;
}

export function parseServiceRuntimeIdentity(
  env: NodeJS.ProcessEnv,
): ServiceRuntimeIdentity | null {
  const uidRaw = env.C05_SERVICE_UID;
  const gidRaw = env.C05_SERVICE_GID;
  if (uidRaw === undefined && gidRaw === undefined) return null;
  if (uidRaw === undefined || gidRaw === undefined)
    throw new Error("C05_SERVICE_IDENTITY_INCOMPLETE");
  return Object.freeze({
    uid: parseId(uidRaw, "C05_SERVICE_UID_INVALID"),
    gid: parseId(gidRaw, "C05_SERVICE_GID_INVALID"),
  });
}
function procIds(text: string, field: "Uid" | "Gid"): number[] {
  const line = text.split(/\r?\n/).find((row) => row.startsWith(field + ":"));
  if (!line) throw new Error("C05_SERVICE_PROC_IDENTITY_MISSING");
  const values = line
    .slice(field.length + 1)
    .trim()
    .split(/\s+/)
    .map((value) => Number(value));
  if (
    values.length !== 4 ||
    values.some((value) => !Number.isSafeInteger(value) || value < 0)
  )
    throw new Error("C05_SERVICE_PROC_IDENTITY_INVALID");
  return values;
}

function procGroups(text: string): number[] {
  const line = text.split(/\r?\n/).find((row) => row.startsWith("Groups:"));
  if (!line) throw new Error("C05_SERVICE_PROC_GROUPS_MISSING");
  const value = line.slice("Groups:".length).trim();
  if (!value) return [];
  const groups = value.split(/\s+/).map((item) => Number(item));
  if (groups.some((item) => !Number.isSafeInteger(item) || item < 0))
    throw new Error("C05_SERVICE_PROC_GROUPS_INVALID");
  return groups;
}

export function verifyServiceRuntimeIdentity(
  procStatus: string,
  expected: ServiceRuntimeIdentity,
): void {
  const uids = procIds(procStatus, "Uid");
  const gids = procIds(procStatus, "Gid");
  const groups = procGroups(procStatus);
  if (!uids.every((value) => value === expected.uid))
    throw new Error("C05_SERVICE_UID_MISMATCH");
  if (!gids.every((value) => value === expected.gid))
    throw new Error("C05_SERVICE_GID_MISMATCH");
  if (groups.some((value) => value !== expected.gid))
    throw new Error("C05_SERVICE_SUPPLEMENTARY_GROUP_MISMATCH");
}

function permissionBits(
  mode: number,
  uid: number,
  gid: number,
  expected: ServiceRuntimeIdentity,
): number {
  if (uid === expected.uid) return (mode >> 6) & 0o7;
  if (gid === expected.gid) return (mode >> 3) & 0o7;
  return mode & 0o7;
}

export async function verifyServiceRuntimeTreeReadOnly(
  root: string,
  expected: ServiceRuntimeIdentity,
): Promise<void> {
  const canonicalRoot = await realpath(root);
  const prefix = canonicalRoot.endsWith(sep)
    ? canonicalRoot
    : canonicalRoot + sep;

  async function walk(path: string): Promise<void> {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      let target: string;
      try {
        target = await realpath(path);
      } catch {
        throw new Error("C05_NONROOT_RUNTIME_SYMLINK_INVALID");
      }
      if (target !== canonicalRoot && !target.startsWith(prefix))
        throw new Error("C05_NONROOT_RUNTIME_SYMLINK_ESCAPE");
      return;
    }
    if (!metadata.isFile() && !metadata.isDirectory())
      throw new Error("C05_NONROOT_RUNTIME_ENTRY_TYPE_INVALID");
    const bits = permissionBits(
      metadata.mode,
      metadata.uid,
      metadata.gid,
      expected,
    );
    if ((bits & 0o2) !== 0)
      throw new Error("C05_NONROOT_RUNTIME_TREE_WRITABLE");
    if (metadata.isFile()) {
      if ((bits & 0o4) === 0)
        throw new Error("C05_NONROOT_RUNTIME_FILE_NOT_READABLE");
      return;
    }
    if ((bits & 0o5) !== 0o5)
      throw new Error("C05_NONROOT_RUNTIME_DIRECTORY_NOT_READABLE");
    for (const entry of await readdir(path)) await walk(resolve(path, entry));
  }

  await walk(canonicalRoot);
}

export function publicServiceRuntimeIdentity(
  identity: ServiceRuntimeIdentity | null,
) {
  return identity
    ? Object.freeze({
        mode: "EXPLICIT_NON_ROOT_TEST" as const,
        nonRoot: true,
      })
    : Object.freeze({
        mode: "INHERITED_PARENT" as const,
        nonRoot: false,
      });
}

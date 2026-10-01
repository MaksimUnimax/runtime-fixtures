import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parseServiceRuntimeIdentity,
  publicServiceRuntimeIdentity,
  verifyServiceRuntimeIdentity,
  verifyServiceRuntimeTreeReadOnly,
} from "./c05-service-runtime-identity.mts";

test("C05 identity mode is opt-in and requires both non-root IDs", () => {
  assert.equal(parseServiceRuntimeIdentity({}), null);
  assert.throws(
    () => parseServiceRuntimeIdentity({ C05_SERVICE_UID: "65534" }),
    /C05_SERVICE_IDENTITY_INCOMPLETE/,
  );
  assert.throws(
    () => parseServiceRuntimeIdentity({ C05_SERVICE_GID: "65534" }),
    /C05_SERVICE_IDENTITY_INCOMPLETE/,
  );
  assert.deepEqual(
    parseServiceRuntimeIdentity({
      C05_SERVICE_UID: "65534",
      C05_SERVICE_GID: "65534",
    }),
    { uid: 65534, gid: 65534 },
  );
});
test("C05 identity parser rejects root and malformed IDs", () => {
  for (const [key, value, code] of [
    ["C05_SERVICE_UID", "0", "C05_SERVICE_UID_INVALID"],
    ["C05_SERVICE_UID", "-1", "C05_SERVICE_UID_INVALID"],
    ["C05_SERVICE_UID", "root", "C05_SERVICE_UID_INVALID"],
    ["C05_SERVICE_UID", "2147483648", "C05_SERVICE_UID_INVALID"],
    ["C05_SERVICE_GID", "0", "C05_SERVICE_GID_INVALID"],
    ["C05_SERVICE_GID", "group", "C05_SERVICE_GID_INVALID"],
  ] as const) {
    const env = {
      C05_SERVICE_UID: "65534",
      C05_SERVICE_GID: "65534",
      [key]: value,
    };
    assert.throws(() => parseServiceRuntimeIdentity(env), new RegExp(code));
  }
});

test("C05 process identity verifies all Linux uid/gid columns", () => {
  const identity = { uid: 65534, gid: 65534 };
  verifyServiceRuntimeIdentity(
    "Name:\tnode\nUid:\t65534\t65534\t65534\t65534\nGid:\t65534\t65534\t65534\t65534\nGroups:\t\n",
    identity,
  );
  assert.throws(
    () =>
      verifyServiceRuntimeIdentity(
        "Uid:\t65534\t0\t65534\t65534\nGid:\t65534\t65534\t65534\t65534\nGroups:\t\n",
        identity,
      ),
    /C05_SERVICE_UID_MISMATCH/,
  );
  assert.throws(
    () =>
      verifyServiceRuntimeIdentity(
        "Uid:\t65534\t65534\t65534\t65534\nGid:\t65534\t65534\t0\t65534\nGroups:\t\n",
        identity,
      ),
    /C05_SERVICE_GID_MISMATCH/,
  );
  assert.throws(
    () =>
      verifyServiceRuntimeIdentity(
        "Uid:\t65534\t65534\t65534\t65534\nGid:\t65534\t65534\t65534\t65534\nGroups:\t0\n",
        identity,
      ),
    /C05_SERVICE_SUPPLEMENTARY_GROUP_MISMATCH/,
  );
  assert.throws(
    () =>
      verifyServiceRuntimeIdentity(
        "Uid:\t65534\t65534\t65534\t65534\nGid:\t65534\t65534\t65534\t65534\n",
        identity,
      ),
    /C05_SERVICE_PROC_GROUPS_MISSING/,
  );
  assert.throws(
    () => verifyServiceRuntimeIdentity("Name:\tnode\n", identity),
    /C05_SERVICE_PROC_IDENTITY_MISSING/,
  );
});

test("C05 runtime tree accepts readable internal symlinks without treating link mode as writable", async () => {
  const base = await mkdtemp(join(tmpdir(), "c05-runtime-tree-"));
  try {
    await chmod(base, 0o755);
    const lib = join(base, "lib");
    await mkdir(lib, { mode: 0o755 });
    await writeFile(join(lib, "module.js"), "export {};\n", { mode: 0o644 });
    await symlink("lib/module.js", join(base, "module-link.js"));
    await verifyServiceRuntimeTreeReadOnly(base, { uid: 65534, gid: 65534 });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("C05 runtime tree rejects writable real entries", async () => {
  const base = await mkdtemp(join(tmpdir(), "c05-runtime-writable-"));
  try {
    await chmod(base, 0o755);
    const file = join(base, "writable.txt");
    await writeFile(file, "x\n");
    await chmod(file, 0o666);
    await assert.rejects(
      verifyServiceRuntimeTreeReadOnly(base, { uid: 65534, gid: 65534 }),
      /C05_NONROOT_RUNTIME_TREE_WRITABLE/,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("C05 runtime tree rejects escaping and dangling symlinks", async () => {
  const base = await mkdtemp(join(tmpdir(), "c05-runtime-links-"));
  const outside = await mkdtemp(join(tmpdir(), "c05-runtime-outside-"));
  try {
    await chmod(base, 0o755);
    await chmod(outside, 0o755);
    const outsideFile = join(outside, "outside.js");
    await writeFile(outsideFile, "export {};\n", { mode: 0o644 });
    const escape = join(base, "escape.js");
    await symlink(outsideFile, escape);
    await assert.rejects(
      verifyServiceRuntimeTreeReadOnly(base, { uid: 65534, gid: 65534 }),
      /C05_NONROOT_RUNTIME_SYMLINK_ESCAPE/,
    );
    await rm(escape);
    await symlink(join(base, "missing.js"), join(base, "dangling.js"));
    await assert.rejects(
      verifyServiceRuntimeTreeReadOnly(base, { uid: 65534, gid: 65534 }),
      /C05_NONROOT_RUNTIME_SYMLINK_INVALID/,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("C05 public identity evidence never emits uid/gid values", () => {
  const publicValue = publicServiceRuntimeIdentity({ uid: 65534, gid: 65534 });
  assert.deepEqual(publicValue, {
    mode: "EXPLICIT_NON_ROOT_TEST",
    nonRoot: true,
  });
  assert.equal(JSON.stringify(publicValue).includes("65534"), false);
  assert.deepEqual(publicServiceRuntimeIdentity(null), {
    mode: "INHERITED_PARENT",
    nonRoot: false,
  });
});

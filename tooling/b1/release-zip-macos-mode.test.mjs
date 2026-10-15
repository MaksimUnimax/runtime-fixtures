import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { readZip } from "./release-lib.mjs";

// All fixtures are in-memory, small and inert; the ZIP is never extracted.
const PYTHON_ZIP = [
  "import io, sys, zipfile",
  "host, mode, name = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]",
  "output = io.BytesIO()",
  'with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:',
  "    info = zipfile.ZipInfo(name)",
  "    info.create_system = host",
  "    info.external_attr = mode << 16",
  "    archive.writestr(info, b'' if name.endswith('/') else b'synthetic inert data')",
  "sys.stdout.buffer.write(output.getvalue())",
].join("\n");

function syntheticZip(creatorHost, unixMode, name = "worker.js") {
  const run = spawnSync(
    "python3",
    ["-c", PYTHON_ZIP, String(creatorHost), String(unixMode), name],
    { maxBuffer: 256 * 1024 },
  );
  assert.equal(run.status, 0, run.stderr?.toString("utf8"));
  return run.stdout;
}

test("regular Unix and macOS ZIP file modes remain accepted", () => {
  for (const host of [3, 19]) {
    const entries = readZip(syntheticZip(host, 0o100644));
    assert.equal(entries.get("worker.js")?.toString("utf8"), "synthetic inert data");
  }
});

test("macOS ZIP with unspecified file mode remains accepted", () => {
  assert.ok(readZip(syntheticZip(19, 0)).has("worker.js"));
});

test("macOS ZIP directory type with slash-terminated name remains accepted", () => {
  assert.equal(readZip(syntheticZip(19, 0o040755, "assets/")).get("assets/")?.length, 0);
});

test("Unix and macOS ZIP symbolic links are rejected as special entries", () => {
  for (const host of [3, 19]) {
    assert.throws(
      () => readZip(syntheticZip(host, 0o120777)),
      /Unsupported special ZIP entry/,
    );
  }
});

test("macOS ZIP directory type cannot masquerade as a file", () => {
  assert.throws(
    () => readZip(syntheticZip(19, 0o040755, "worker.js")),
    /ZIP Unix type\/path mismatch/,
  );
});

test("macOS FIFO and device types are rejected as special entries", () => {
  for (const unixMode of [0o010644, 0o060600]) {
    assert.throws(
      () => readZip(syntheticZip(19, unixMode)),
      /Unsupported special ZIP entry/,
    );
  }
});

test("DOS/FAT creator regular ZIP remains accepted without Unix-mode interpretation", () => {
  assert.ok(readZip(syntheticZip(0, 0)).has("worker.js"));
});

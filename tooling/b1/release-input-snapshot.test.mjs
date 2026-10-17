import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createHash, generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  prepare,
  preflight,
  readAuthority,
  productFacts,
  sourceIdentity,
} from "./release-lib.mjs";

const WRITER = [
  "import base64,json,sys,zipfile",
  "dest,rows64=sys.argv[1:3]",
  "rows=json.loads(base64.b64decode(rows64))",
  'with zipfile.ZipFile(dest,"w",compression=zipfile.ZIP_STORED) as z:',
  "    for name,value64 in rows:",
  "        z.writestr(name,base64.b64decode(value64))",
].join("\n");

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function makeFixture(root) {
  const { publicKey } = generateKeyPairSync("ed25519");
  const key = Buffer.from(publicKey.export({ type: "spki", format: "der" }));
  const trustBundle = {
    trustBundleVersion: "bootstrap_trust_bundle_v1",
    algorithm: "Ed25519",
    publicKeyFormat: "spki_der",
    publicKeyEncoding: "base64",
    fingerprintAlgorithm: "sha256",
    fingerprintEncoding: "lowercase_hex",
    keys: [
      {
        keyId: "synthetic-c01",
        publicKey: key.toString("base64"),
        fingerprintSha256: sha(key),
        lifecycle: "ACTIVE",
        trustEligibility: "SIGNING_AND_VERIFICATION",
      },
    ],
  };
  const authority = {
    schemaVersion: "octoport_release_authority_v1",
    source: sourceIdentity(),
    ...productFacts(),
    environment: "PREPRODUCTION",
    origins: {
      controlApiOrigin: "https://api.synthetic.invalid",
      portalOrigin: "https://portal.synthetic.invalid",
    },
    trustBundle,
  };
  const authorityPath = join(root, "authority.json");
  writeFileSync(authorityPath, JSON.stringify(authority));
  const folder = join(root, "inputs");
  mkdirSync(folder);
  const packages = {};
  for (const browser of ["chromium", "firefox"]) {
    const manifest = {
      manifest_version: 3,
      version: authority.productVersion,
      host_permissions: [
        authority.origins.controlApiOrigin + "/*",
        authority.origins.portalOrigin + "/*",
      ],
      background:
        browser === "chromium"
          ? { service_worker: "worker.js" }
          : { scripts: ["worker.js"] },
      ...(browser === "firefox"
        ? {
            browser_specific_settings: {
              gecko: { id: "octoport@octoport.ru" },
            },
          }
        : {}),
    };
    const config = {
      environment: authority.environment,
      controlApiOrigin: authority.origins.controlApiOrigin,
      portalOrigin: authority.origins.portalOrigin,
      extensionVersion: authority.productVersion,
      contractVersion: authority.contractVersion,
      trustBundle,
    };
    const worker =
      "globalThis.__SELLER_AGENTS_PACKAGED_CONFIG__=" +
      JSON.stringify(JSON.stringify(config)) +
      ";\n";
    const records = [
      ["manifest.json", JSON.stringify(manifest)],
      ["worker.js", worker],
    ].map(([name, data]) => [name, Buffer.from(data).toString("base64")]);
    const dest = join(folder, browser + ".zip");
    const result = spawnSync("python3", [
      "-c",
      WRITER,
      dest,
      Buffer.from(JSON.stringify(records)).toString("base64"),
    ]);
    assert.equal(result.status, 0, result.stderr?.toString("utf8"));
    packages[browser] = dest;
  }
  return { authorityPath, packages };
}

test("authority is consumed via a bounded fd snapshot, never unbounded path reopen", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-c01-authority-fd-"));
  const originalRead = fs.readFileSync;
  let unboundedAuthorityRead = false;
  try {
    const { authorityPath } = makeFixture(root);
    fs.readFileSync = (path, ...args) => {
      if (String(path) === authorityPath) {
        unboundedAuthorityRead = true;
        throw Error("UNBOUNDED_AUTHORITY_FILE_READ");
      }
      return originalRead(path, ...args);
    };
    syncBuiltinESMExports();

    const receipt = readAuthority(authorityPath, join(root, "prepared"));
    assert.equal(receipt.value.schemaVersion, "octoport_release_authority_v1");
    assert.equal(unboundedAuthorityRead, false);
  } finally {
    fs.readFileSync = originalRead;
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

test("authority mutation during bounded fd read fails closed", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-c01-authority-mutation-"));
  const originalRead = fs.readSync;
  let mutated = false;
  try {
    const { authorityPath } = makeFixture(root);
    const identity = fs.statSync(authorityPath);
    fs.readSync = (fd, ...args) => {
      const current = fs.fstatSync(fd);
      if (
        !mutated &&
        current.dev === identity.dev &&
        current.ino === identity.ino
      ) {
        mutated = true;
        fs.appendFileSync(authorityPath, " ");
      }
      return originalRead(fd, ...args);
    };
    syncBuiltinESMExports();

    assert.throws(
      () => readAuthority(authorityPath, join(root, "prepared")),
      /Authority file changed during bounded read/,
    );
    assert.equal(mutated, true);
  } finally {
    fs.readSync = originalRead;
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});


test("authority FIFO refuses non-regular input without blocking open", { skip: process.platform === "win32" }, () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-c01-authority-fifo-"));
  try {
    const fifo = join(root, "authority.fifo");
    const created = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
    assert.equal(created.status, 0, created.stderr);

    const imported = JSON.stringify(new URL("./release-lib.mjs", import.meta.url).href);
    const script = "import { readAuthority } from " + imported +
      "; try { readAuthority(process.argv[1], process.argv[2]); process.exitCode = 2; }" +
      " catch (error) { console.error(error.message); process.exitCode = 1; }";
    const child = spawnSync(process.execPath, [
      "--input-type=module", "--eval", script, fifo, join(root, "prepared"),
    ], { timeout: 1500, encoding: "utf8" });

    assert.equal(child.error, undefined, "authority FIFO read timed out before type rejection");
    assert.equal(child.status, 1, child.stderr);
    assert.match(child.stderr, /Authority file must be a regular file/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("authority same-size concurrent rewrite fails bounded fd metadata verification", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-c01-authority-same-size-"));
  const originalRead = fs.readSync;
  let mutated = false;
  try {
    const { authorityPath } = makeFixture(root);
    const identity = fs.statSync(authorityPath);
    const originalBytes = readFileSync(authorityPath);
    const keyIdOffset = originalBytes.indexOf("synthetic-c01");
    assert.ok(keyIdOffset >= 0, "fixture authority must contain a valid key ID");
    const lastKeyIdByteOffset = keyIdOffset + "synthetic-c0".length;
    fs.readSync = (fd, ...args) => {
      const current = fs.fstatSync(fd);
      if (!mutated && current.dev === identity.dev && current.ino === identity.ino) {
        mutated = true;
        const writer = fs.openSync(authorityPath, "r+");
        try {
          fs.writeSync(writer, "2", lastKeyIdByteOffset, "utf8");
          const changed = new Date(Date.now() + 60_000);
          fs.futimesSync(writer, changed, changed);
          const changedBytes = readFileSync(authorityPath);
          assert.equal(changedBytes.byteLength, originalBytes.byteLength);
          assert.notDeepEqual(changedBytes, originalBytes);
          assert.equal(JSON.parse(changedBytes.toString()).trustBundle.keys[0].keyId, "synthetic-c02");
        } finally {
          fs.closeSync(writer);
        }
      }
      return originalRead(fd, ...args);
    };
    syncBuiltinESMExports();

    assert.throws(
      () => readAuthority(authorityPath, join(root, "prepared")),
      /Authority file changed during bounded read/,
    );
    assert.equal(mutated, true);
  } finally {
    fs.readSync = originalRead;
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});


test("manifest bounded descriptor avoids unbounded readFileSync path reopen", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-c01-manifest-fd-"));
  const originalRead = fs.readFileSync;
  let reopened = false;
  try {
    const { authorityPath, packages } = makeFixture(root);
    const candidateDir = join(root, "prepared");
    assert.equal(prepare({
      authorityPath, outputDir: candidateDir,
      chromium: packages.chromium, firefox: packages.firefox,
    }).packages.chromium.browser, "chromium");
    const manifestPath = join(candidateDir, "B1_RC_MANIFEST.json");
    fs.readFileSync = (path, ...args) => {
      if (String(path) === manifestPath) {
        reopened = true;
        return originalRead(path, ...args);
      }
      return originalRead(path, ...args);
    };
    syncBuiltinESMExports();

    assert.equal(preflight({ authorityPath, candidateDir }).status, "PASS");
    assert.equal(reopened, false);
  } finally {
    fs.readFileSync = originalRead;
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

test("manifest mutation during bounded descriptor read fails closed", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-c01-manifest-mutation-"));
  const originalRead = fs.readSync;
  let mutated = false;
  try {
    const { authorityPath, packages } = makeFixture(root);
    const candidateDir = join(root, "prepared");
    prepare({ authorityPath, outputDir: candidateDir,
      chromium: packages.chromium, firefox: packages.firefox });
    const manifestPath = join(candidateDir, "B1_RC_MANIFEST.json");
    const identity = fs.statSync(manifestPath);
    fs.readSync = (fd, ...args) => {
      const current = fs.fstatSync(fd);
      if (!mutated && current.dev === identity.dev && current.ino === identity.ino) {
        mutated = true;
        fs.appendFileSync(manifestPath, " ");
      }
      return originalRead(fd, ...args);
    };
    syncBuiltinESMExports();

    assert.throws(
      () => preflight({ authorityPath, candidateDir }),
      /Candidate manifest changed during bounded read/,
    );
    assert.equal(mutated, true);
  } finally {
    fs.readSync = originalRead;
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared package bytes always equal bytes validated before copying", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-synthetic-snapshot-"));
  const originalCopy = fs.copyFileSync;
  try {
    const { authorityPath, packages } = makeFixture(root);
    const checkedHash = sha(readFileSync(packages.chromium));
    let reopened = 0;
    fs.copyFileSync = (...args) => {
      if (args[0] === packages.chromium) {
        // Controlled synthetic modification at the source reopen boundary.
        writeFileSync(
          packages.chromium,
          Buffer.from("synthetic changed input"),
        );
        reopened += 1;
      }
      return originalCopy(...args);
    };
    syncBuiltinESMExports();
    let result;
    try {
      result = prepare({
        authorityPath,
        outputDir: join(root, "prepared"),
        chromium: packages.chromium,
        firefox: packages.firefox,
      });
    } finally {
      fs.copyFileSync = originalCopy;
      syncBuiltinESMExports();
    }
    assert.equal(result.packages.chromium.sha256, checkedHash);
    assert.equal(
      sha(readFileSync(join(root, "prepared", "chromium.zip"))),
      checkedHash,
      "copied bytes diverged from validation snapshot",
    );
    assert.equal(reopened, 0, "source was reopened after validation");
  } finally {
    fs.copyFileSync = originalCopy;
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

// Existing stable package preparation and its consumer keep the same contract.
test("unchanged synthetic packages prepare and preflight with metadata only", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-synthetic-preflight-"));
  try {
    const { authorityPath, packages } = makeFixture(root);
    const outputDir = join(root, "prepared");
    const result = prepare({
      authorityPath,
      outputDir,
      chromium: packages.chromium,
      firefox: packages.firefox,
    });
    for (const browser of ["chromium", "firefox"]) {
      assert.deepEqual(Object.keys(result.packages[browser]).sort(), [
        "browser",
        "bytes",
        "filename",
        "inventoryCount",
        "sha256",
        "version",
      ]);
      assert.equal(
        sha(readFileSync(join(outputDir, browser + ".zip"))),
        result.packages[browser].sha256,
      );
    }
    assert.equal(
      preflight({ authorityPath, candidateDir: outputDir }).status,
      "PASS",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test("simulated write failure removes only files created by prepare", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-synthetic-write-failure-"));
  const originalWrite = fs.writeFileSync;
  try {
    const { authorityPath, packages } = makeFixture(root);
    const outputDir = join(root, "prepared");
    let writes = 0;
    fs.writeFileSync = (destination, ...rest) => {
      if (typeof destination === "number" || String(destination).endsWith(".zip")) {
        writes += 1;
        if (writes === 2) {
          if (typeof destination === "number") {
            // Model a write that creates partial bytes before throwing EIO.
            originalWrite(destination, Buffer.from("partial"));
          }
          const error = new Error("synthetic ZIP write failure");
          error.code = "EIO";
          throw error;
        }
      }
      return originalWrite(destination, ...rest);
    };
    syncBuiltinESMExports();
    try {
      assert.throws(
        () => prepare({
          authorityPath,
          outputDir,
          chromium: packages.chromium,
          firefox: packages.firefox,
        }),
        { code: "EIO" },
      );
    } finally {
      fs.writeFileSync = originalWrite;
      syncBuiltinESMExports();
    }
    assert.equal(writes, 2);
    assert.equal(fs.existsSync(outputDir), false, "failed prepare left partial candidate output");
    const prepared = prepare({
      authorityPath,
      outputDir,
      chromium: packages.chromium,
      firefox: packages.firefox,
    });
    assert.equal(prepared.packages.chromium.sha256, sha(readFileSync(packages.chromium)));
    assert.equal(preflight({ authorityPath, candidateDir: outputDir }).status, "PASS");
  } finally {
    fs.writeFileSync = originalWrite;
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});


test("a failed prepare preserves external files in the output directory", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-synthetic-foreign-file-"));
  const originalWrite = fs.writeFileSync;
  try {
    const { authorityPath, packages } = makeFixture(root);
    const outputDir = join(root, "prepared");
    const foreign = join(outputDir, "not-owned.txt");
    let writes = 0;
    fs.writeFileSync = (destination, ...rest) => {
      if (typeof destination === "number" || String(destination).endsWith(".zip")) {
        writes += 1;
        if (writes === 2) {
          originalWrite(foreign, "unrelated data");
          const error = new Error("synthetic ZIP write failure");
          error.code = "EIO";
          throw error;
        }
      }
      return originalWrite(destination, ...rest);
    };
    syncBuiltinESMExports();
    try {
      assert.throws(
        () => prepare({
          authorityPath,
          outputDir,
          chromium: packages.chromium,
          firefox: packages.firefox,
        }),
        { code: "EIO" },
      );
    } finally {
      fs.writeFileSync = originalWrite;
      syncBuiltinESMExports();
    }
    assert.equal(writes, 2);
    assert.equal(readFileSync(foreign, "utf8"), "unrelated data");
    assert.equal(fs.existsSync(join(outputDir, "chromium.zip")), false);
    assert.equal(fs.existsSync(join(outputDir, "firefox.zip")), false);
    assert.equal(fs.existsSync(join(outputDir, "B1_RC_MANIFEST.json")), false);
  } finally {
    fs.writeFileSync = originalWrite;
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});


test("release package filenames differing only by case are rejected before output creation", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-synthetic-casefold-output-"));
  try {
    const { authorityPath, packages } = makeFixture(root);
    const firstDir = join(root, "first");
    const secondDir = join(root, "second");
    mkdirSync(firstDir);
    mkdirSync(secondDir);
    const chromium = join(firstDir, "Release.ZIP");
    const firefox = join(secondDir, "release.zip");
    fs.copyFileSync(packages.chromium, chromium);
    fs.copyFileSync(packages.firefox, firefox);
    const outputDir = join(root, "prepared");
    assert.throws(
      () => prepare({ authorityPath, outputDir, chromium, firefox }),
      /Package filenames .*case-insensitive collision/,
    );
    assert.equal(fs.existsSync(outputDir), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test("Win32 device-name release ZIP basenames fail before output creation", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-synthetic-win32-filename-"));
  try {
    const { authorityPath, packages } = makeFixture(root);
    for (const [index, filename] of [
      "CON.zip",
      "nul.ZIP",
      "AUX.zip",
      "Com1.zip",
      "lpt9.zip",
      "CON.suffix.zip",
    ].entries()) {
      const folder = join(root, "case-" + index);
      mkdirSync(folder);
      const reserved = join(folder, filename);
      fs.copyFileSync(packages.chromium, reserved);
      const outputDir = join(folder, "prepared");
      assert.throws(
        () => prepare({
          authorityPath,
          outputDir,
          chromium: reserved,
          firefox: packages.firefox,
        }),
        /Unsafe package filename/,
        filename + " is not portable on Windows",
      );
      assert.equal(fs.existsSync(outputDir), false, filename);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});



test("preflight refuses archives with case-insensitively colliding names", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-synthetic-casefold-preflight-"));
  try {
    const { authorityPath, packages } = makeFixture(root);
    const candidateDir = join(root, "prepared");
    prepare({ authorityPath, outputDir: candidateDir, ...packages });
    const manifestPath = join(candidateDir, "B1_RC_MANIFEST.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const chromium = "Release.ZIP";
    const firefox = "release.zip";
    fs.renameSync(join(candidateDir, manifest.packages.chromium.filename), join(candidateDir, chromium));
    fs.renameSync(join(candidateDir, manifest.packages.firefox.filename), join(candidateDir, firefox));
    manifest.packages.chromium.filename = chromium;
    manifest.packages.firefox.filename = firefox;
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(
      () => preflight({ authorityPath, candidateDir }),
      /Package filenames have a case-insensitive collision/,
    );
    assert.equal(fs.existsSync(join(candidateDir, chromium)), true);
    assert.equal(fs.existsSync(join(candidateDir, firefox)), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preflight refuses a forged Win32 device-name package manifest", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-synthetic-win32-preflight-"));
  try {
    const { authorityPath, packages } = makeFixture(root);
    const candidateDir = join(root, "prepared");
    prepare({ authorityPath, outputDir: candidateDir, ...packages });
    const manifestPath = join(candidateDir, "B1_RC_MANIFEST.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    fs.renameSync(
      join(candidateDir, manifest.packages.chromium.filename),
      join(candidateDir, "NUL.zip"),
    );
    manifest.packages.chromium.filename = "NUL.zip";
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(
      () => preflight({ authorityPath, candidateDir }),
      /Invalid package metadata/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
              gecko: {
                id: "octoport@octoport.ru",
                strict_min_version: "140.0",
                data_collection_permissions: {
                  required: ["websiteContent"],
                  optional: ["technicalAndInteraction"],
                },
              },
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

test("Chrome-only explicit B1 mode prepares and preflights only the Chromium archive", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-c01-chrome-first-"));
  try {
    const { authorityPath, packages } = makeFixture(root);
    const outputDir = join(root, "chrome-prepared");
    const result = prepare({
      authorityPath,
      outputDir,
      chromium: packages.chromium,
      chromiumOnly: true,
    });
    assert.deepEqual(Object.keys(result.packages), ["chromium"]);
    assert.equal(result.releaseScope, "CHROME_ONLY");
    assert.equal(sha(readFileSync(join(outputDir, "chromium.zip"))), result.packages.chromium.sha256);
    assert.equal(fs.existsSync(join(outputDir, "firefox.zip")), false);
    const verified = preflight({ authorityPath, candidateDir: outputDir, chromiumOnly: true });
    assert.equal(verified.status, "PASS");
    assert.equal(verified.releaseScope, "CHROME_ONLY");
    assert.throws(
      () => preflight({ authorityPath, candidateDir: outputDir }),
      /Candidate source, authority, or product facts are stale/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Chrome-only CLI explicitly selects one browser and legacy preflight stays strict", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-c01-chrome-cli-"));
  try {
    const { authorityPath, packages } = makeFixture(root);
    const outputDir = join(root, "chrome-prepared");
    const prepared = spawnSync(
      process.execPath,
      [
        join(process.cwd(), "tooling/b1/prepare-release-candidate.mjs"),
        "--authority", authorityPath, "--out", outputDir,
        "--chromium", packages.chromium, "--channel", "chrome",
      ],
      { encoding: "utf8", timeout: 15000, maxBuffer: 4096 },
    );
    assert.equal(prepared.status, 0, prepared.stderr);
    const receipt = JSON.parse(prepared.stdout);
    assert.equal(receipt.status, "PREPARED");
    assert.deepEqual(Object.keys(receipt.packages), ["chromium"]);
    assert.equal(receipt.releaseScope, "CHROME_ONLY");
    const checked = spawnSync(
      process.execPath,
      [
        join(process.cwd(), "tooling/b1/release-preflight.mjs"),
        outputDir, "--authority", authorityPath, "--channel", "chrome",
      ],
      { encoding: "utf8", timeout: 15000, maxBuffer: 4096 },
    );
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(JSON.parse(checked.stdout).status, "PASS");
    assert.equal(JSON.parse(checked.stdout).releaseScope, "CHROME_ONLY");
    const legacy = spawnSync(
      process.execPath,
      [join(process.cwd(), "tooling/b1/release-preflight.mjs"),
       outputDir, "--authority", authorityPath],
      { encoding: "utf8", timeout: 15000, maxBuffer: 4096 },
    );
    assert.equal(legacy.status, 1);
    assert.equal(JSON.parse(legacy.stderr).status, "FAIL");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Chrome-only scope rejects extra browser metadata and modified Chromium bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-c01-chrome-tamper-"));
  try {
    const { authorityPath, packages } = makeFixture(root);
    const outputDir = join(root, "chrome-prepared");
    const result = prepare({
      authorityPath, outputDir, chromium: packages.chromium,
      chromiumOnly: true,
    });
    const manifestPath = join(outputDir, "B1_RC_MANIFEST.json");
    const manifest = JSON.parse(readFileSync(manifestPath));
    manifest.packages.firefox = { ...result.packages.chromium, browser: "firefox" };
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(
      () => preflight({ authorityPath, candidateDir: outputDir, chromiumOnly: true }),
      /Candidate source, authority, or product facts are stale/,
    );
    delete manifest.packages.firefox;
    writeFileSync(manifestPath, JSON.stringify(manifest));
    writeFileSync(join(outputDir, "chromium.zip"), "tampered");
    assert.throws(
      () => preflight({ authorityPath, candidateDir: outputDir, chromiumOnly: true }),
      /Package|ZIP|archive|extension/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test("Chrome-only must fail closed on invalid ZIP, false authority, or unsupported channel", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-c01-chrome-invalid-"));
  try {
    const { authorityPath, packages } = makeFixture(root);
    assert.throws(
      () => prepare({
        authorityPath, outputDir: join(root, "ambiguous-browser-input"),
        chromium: packages.chromium, firefox: packages.firefox,
        chromiumOnly: true,
      }),
      /Chrome-only candidate cannot include Firefox input/,
    );
    assert.equal(fs.existsSync(join(root, "ambiguous-browser-input")), false);
    const invalidPackage = join(root, "not-an-extension.zip");
    writeFileSync(invalidPackage, "NOT_AN_EXTENSION");
    const rejectedOutput = join(root, "rejected-package");
    assert.throws(
      () => prepare({
        authorityPath, outputDir: rejectedOutput, chromium: invalidPackage,
        chromiumOnly: true,
      }),
      /ZIP|archive|extension|Package/i,
    );
    assert.equal(fs.existsSync(rejectedOutput), false);

    const unsupported = spawnSync(
      process.execPath,
      [
        join(process.cwd(), "tooling/b1/prepare-release-candidate.mjs"),
        "--authority", authorityPath, "--out", join(root, "unsupported"),
        "--chromium", packages.chromium, "--channel", "unknown",
      ],
      { encoding: "utf8", timeout: 15000, maxBuffer: 4096 },
    );
    assert.equal(unsupported.status, 1);
    assert.equal(JSON.parse(unsupported.stderr).status, "FAIL");

    const authority = JSON.parse(readFileSync(authorityPath));
    authority.environment = "LOCAL_DEV";
    writeFileSync(authorityPath, JSON.stringify(authority));
    assert.throws(
      () => prepare({
        authorityPath, outputDir: join(root, "bad-authority"),
        chromium: packages.chromium, chromiumOnly: true,
      }),
      /Invalid authority schema/,
    );
    assert.equal(fs.existsSync(join(root, "bad-authority")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test("Chrome-only rejects undeclared archive files even when manifest is unchanged", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-c01-chrome-unlisted-"));
  try {
    const { authorityPath, packages } = makeFixture(root);
    const outputDir = join(root, "chrome-prepared");
    const receipt = prepare({
      authorityPath, outputDir, chromium: packages.chromium, chromiumOnly: true,
    });
    assert.equal(receipt.releaseScope, "CHROME_ONLY");
    // A hidden sibling archive must never be accepted as part of a Chrome-only
    // candidate, regardless of its bytes or browser identity.
    writeFileSync(join(outputDir, "firefox.zip"), "NOT_AN_EXTENSION");
    assert.throws(
      () => preflight({ authorityPath, candidateDir: outputDir, chromiumOnly: true }),
      /Chrome-only candidate contains undeclared files/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test("Firefox-only explicit B1 mode prepares and preflights without Chromium", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-c01-firefox-first-"));
  try {
    const { authorityPath, packages } = makeFixture(root);
    const outputDir = join(root, "firefox-prepared");
    const result = prepare({
      authorityPath,
      outputDir,
      firefox: packages.firefox,
      firefoxOnly: true,
    });
    assert.deepEqual(Object.keys(result.packages), ["firefox"]);
    assert.equal(result.releaseScope, "FIREFOX_ONLY");
    assert.equal(sha(readFileSync(join(outputDir, "firefox.zip"))), result.packages.firefox.sha256);
    assert.equal(fs.existsSync(join(outputDir, "chromium.zip")), false);
    const checked = preflight({ authorityPath, candidateDir: outputDir, firefoxOnly: true });
    assert.equal(checked.status, "PASS");
    assert.equal(checked.releaseScope, "FIREFOX_ONLY");
    assert.throws(
      () => preflight({ authorityPath, candidateDir: outputDir }),
      /Candidate source, authority, or product facts are stale/,
    );
    assert.throws(
      () => preflight({ authorityPath, candidateDir: outputDir, chromiumOnly: true }),
      /Candidate source, authority, or product facts are stale/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Firefox-only CLI explicitly selects one browser and old CLI stays strict", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-c01-firefox-cli-"));
  try {
    const { authorityPath, packages } = makeFixture(root);
    const outputDir = join(root, "firefox-prepared");
    const prepareTool = join(process.cwd(), "tooling/b1/prepare-release-candidate.mjs");
    const preflightTool = join(process.cwd(), "tooling/b1/release-preflight.mjs");
    const run = (script, args) => spawnSync(
      process.execPath, [script, ...args],
      { encoding: "utf8", timeout: 15000, maxBuffer: 4096 },
    );
    const prepared = run(prepareTool, [
      "--authority", authorityPath, "--out", outputDir,
      "--firefox", packages.firefox, "--channel", "firefox",
    ]);
    assert.equal(prepared.status, 0, prepared.stderr);
    const receipt = JSON.parse(prepared.stdout);
    assert.equal(receipt.status, "PREPARED");
    assert.deepEqual(Object.keys(receipt.packages), ["firefox"]);
    assert.equal(receipt.releaseScope, "FIREFOX_ONLY");
    const checked = run(preflightTool, [
      outputDir, "--authority", authorityPath, "--channel", "firefox",
    ]);
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(JSON.parse(checked.stdout).status, "PASS");
    assert.equal(JSON.parse(checked.stdout).releaseScope, "FIREFOX_ONLY");
    const legacy = run(preflightTool, [outputDir, "--authority", authorityPath]);
    assert.equal(legacy.status, 1);
    assert.equal(JSON.parse(legacy.stderr).status, "FAIL");
    const wrong = run(preflightTool, [
      outputDir, "--authority", authorityPath, "--channel", "opera",
    ]);
    assert.equal(wrong.status, 1);
    assert.equal(JSON.parse(wrong.stderr).status, "FAIL");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Firefox-only preflight rejects undeclared Chromium ZIP and altered Firefox bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-c01-firefox-tamper-"));
  try {
    const { authorityPath, packages } = makeFixture(root);
    const outputDir = join(root, "firefox-prepared");
    const receipt = prepare({
      authorityPath, outputDir, firefox: packages.firefox, firefoxOnly: true,
    });
    const manifestPath = join(outputDir, "B1_RC_MANIFEST.json");
    writeFileSync(join(outputDir, "chromium.zip"), "NOT_AN_EXTENSION");
    assert.throws(
      () => preflight({ authorityPath, candidateDir: outputDir, firefoxOnly: true }),
      /Firefox-only candidate contains undeclared files/,
    );
    fs.unlinkSync(join(outputDir, "chromium.zip"));
    const manifest = JSON.parse(readFileSync(manifestPath));
    manifest.packages.chromium = { ...receipt.packages.firefox, browser: "chromium" };
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(
      () => preflight({ authorityPath, candidateDir: outputDir, firefoxOnly: true }),
      /Candidate source, authority, or product facts are stale/,
    );
    delete manifest.packages.chromium;
    writeFileSync(manifestPath, JSON.stringify(manifest));
    writeFileSync(join(outputDir, "firefox.zip"), "NOT_AN_EXTENSION");
    assert.throws(
      () => preflight({ authorityPath, candidateDir: outputDir, firefoxOnly: true }),
      /Package|ZIP|archive|extension/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Firefox-only fails closed on ambiguous Chromium input and malformed authority", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-c01-firefox-invalid-"));
  try {
    const { authorityPath, packages } = makeFixture(root);
    const extraDir = join(root, "ambiguous");
    assert.throws(
      () => prepare({
        authorityPath, outputDir: extraDir,
        chromium: packages.chromium, firefox: packages.firefox,
        firefoxOnly: true,
      }),
      /Firefox-only candidate cannot include Chromium input/,
    );
    assert.equal(fs.existsSync(extraDir), false);
    assert.throws(
      () => prepare({
        authorityPath, outputDir: join(root, "invalid-scope"),
        firefox: packages.firefox, chromiumOnly: true, firefoxOnly: true,
      }),
      /Candidate browser scope is invalid/,
    );
    const original = JSON.parse(readFileSync(authorityPath));
    original.environment = "LOCAL_DEV";
    writeFileSync(authorityPath, JSON.stringify(original));
    const badDir = join(root, "bad-authority");
    assert.throws(
      () => prepare({
        authorityPath, outputDir: badDir,
        firefox: packages.firefox, firefoxOnly: true,
      }),
      /Invalid authority schema/,
    );
    assert.equal(fs.existsSync(badDir), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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


// The complete delivered directory is part of every B1 candidate, including
// the default two-browser mode. All material here is synthetic test data.
for (const mode of ["combined", "chrome", "firefox"]) {
  test(`candidate directory membership: clean ${mode} output remains valid`, () => {
    const root = mkdtempSync(join(tmpdir(), "octoport-c01-directory-clean-"));
    try {
      const { authorityPath, packages } = makeFixture(root);
      const outputDir = join(root, "prepared");
      const scope =
        mode === "chrome"
          ? { chromiumOnly: true }
          : mode === "firefox"
            ? { firefoxOnly: true }
            : {};
      const inputs =
        mode === "chrome"
          ? { chromium: packages.chromium }
          : mode === "firefox"
            ? { firefox: packages.firefox }
            : packages;
      const result = prepare({ authorityPath, outputDir, ...inputs, ...scope });
      assert.equal(
        preflight({ authorityPath, candidateDir: outputDir, ...scope }).status,
        "PASS",
      );
      assert.deepEqual(
        fs.readdirSync(outputDir).sort(),
        [
          "B1_RC_MANIFEST.json",
          ...Object.values(result.packages).map((row) => row.filename),
        ].sort(),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

for (const kind of [
  "archive",
  "regular",
  "hidden",
  "directory",
  "symlink",
  "dangling-symlink",
]) {
  test(
    `candidate directory membership: combined rejects undeclared ${kind}`,
    { skip: process.platform === "win32" && kind.includes("symlink") },
    () => {
      const root = mkdtempSync(join(tmpdir(), "octoport-c01-directory-extra-"));
      try {
        const { authorityPath, packages } = makeFixture(root);
        const outputDir = join(root, "prepared");
        prepare({ authorityPath, outputDir, ...packages });
        const expectedFiles = fs.readdirSync(outputDir).sort();
        const before = expectedFiles.map((name) => [
          name,
          sha(readFileSync(join(outputDir, name))),
        ]);
        const name =
          kind === "archive"
            ? "unlisted.zip"
            : kind === "hidden"
              ? ".unlisted"
              : "unlisted";
        const extra = join(outputDir, name);
        if (kind === "directory") mkdirSync(extra);
        else if (kind === "symlink") fs.symlinkSync(packages.chromium, extra);
        else if (kind === "dangling-symlink")
          fs.symlinkSync(join(root, "absent"), extra);
        else writeFileSync(extra, "SYNTHETIC_UNDECLARED_CANDIDATE_DATA");
        assert.throws(
          () => preflight({ authorityPath, candidateDir: outputDir }),
          /Combined candidate contains undeclared files/,
        );
        // Validation must reject, not silently delete or alter the delivery.
        assert.deepEqual(
          expectedFiles.map((file) => [
            file,
            sha(readFileSync(join(outputDir, file))),
          ]),
          before,
        );
        assert.ok(fs.lstatSync(extra));
        if (kind === "symlink")
          assert.equal(fs.readlinkSync(extra), packages.chromium);
        if (kind === "dangling-symlink")
          assert.equal(fs.readlinkSync(extra), join(root, "absent"));
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
}

test("candidate directory membership: default CLI rejects an undeclared sibling", () => {
  const root = mkdtempSync(join(tmpdir(), "octoport-c01-directory-cli-"));
  try {
    const { authorityPath, packages } = makeFixture(root);
    const outputDir = join(root, "prepared");
    prepare({ authorityPath, outputDir, ...packages });
    const args = [
      "tooling/b1/release-preflight.mjs",
      outputDir,
      "--authority",
      authorityPath,
    ];
    const clean = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(clean.status, 0, clean.stderr);
    assert.equal(JSON.parse(clean.stdout).status, "PASS");
    writeFileSync(
      join(outputDir, "unlisted.zip"),
      "SYNTHETIC_UNDECLARED_CANDIDATE_DATA",
    );
    const rejected = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(rejected.status, 1, rejected.stdout);
    assert.equal(rejected.stdout, "");
    assert.equal(
      JSON.parse(rejected.stderr).reason,
      "Combined candidate contains undeclared files",
    );
    assert.equal(
      JSON.parse(rejected.stderr).productionMutation,
      "NOT_PERFORMED",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

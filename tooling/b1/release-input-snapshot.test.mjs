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

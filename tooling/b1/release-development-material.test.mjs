import { Buffer } from "node:buffer";
import { createHash, generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  prepare as prepareCandidate,
  preflight as preflightCandidate,
  productFacts,
  sourceIdentity,
} from "./release-lib.mjs";

// Isolated synthetic ZIPs; no customer data, tokens, or installed browser.
// The popup can execute imports beyond its immediate HTML src attribute.
const ZIP_WRITER = [
  "import base64, json, sys, zipfile",
  "destination, rows64 = sys.argv[1:3]",
  "rows = json.loads(base64.b64decode(rows64))",
  'with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_STORED) as z:',
  "    for name, value64 in rows:",
  "        z.writestr(name, base64.b64decode(value64))",
].join("\n");

function authorityFixture() {
  const { publicKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ type: "spki", format: "der" });
  const publicKeyBytes = Buffer.from(der);
  const trustBundle = {
    trustBundleVersion: "bootstrap_trust_bundle_v1",
    algorithm: "Ed25519",
    publicKeyFormat: "spki_der",
    publicKeyEncoding: "base64",
    fingerprintAlgorithm: "sha256",
    fingerprintEncoding: "lowercase_hex",
    keys: [
      {
        keyId: "synthetic-store-review",
        publicKey: publicKeyBytes.toString("base64"),
        fingerprintSha256: createHash("sha256")
          .update(publicKeyBytes)
          .digest("hex"),
        lifecycle: "ACTIVE",
        trustEligibility: "SIGNING_AND_VERIFICATION",
      },
    ],
  };
  return {
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
}

function writeZip(path, entries) {
  const rows = Object.entries(entries).map(([name, value]) => [
    name,
    Buffer.from(value).toString("base64"),
  ]);
  const encoded = Buffer.from(JSON.stringify(rows)).toString("base64");
  const run = spawnSync("python3", ["-c", ZIP_WRITER, path, encoded], {
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
}

function fixture(mode) {
  const root = mkdtempSync(join(tmpdir(), "octoport-c01-popup-code-"));
  try {
    const authority = authorityFixture();
    const authorityPath = join(root, "release-authority.json");
    writeFileSync(authorityPath, JSON.stringify(authority));
    const sourceDir = join(root, "source");
    mkdirSync(sourceDir);

    const config = {
      environment: authority.environment,
      controlApiOrigin: authority.origins.controlApiOrigin,
      portalOrigin: authority.origins.portalOrigin,
      extensionVersion: authority.productVersion,
      contractVersion: authority.contractVersion,
      trustBundle: authority.trustBundle,
    };
    const worker =
      "globalThis.__SELLER_AGENTS_PACKAGED_CONFIG__=" +
      JSON.stringify(JSON.stringify(config)) +
      ";\n";

    function browserEntries(browser) {
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
        action: { default_popup: "popup.html" },
        ...(browser === "firefox"
          ? {
              browser_specific_settings: {
                gecko: { id: "octoport@octoport.ru" },
              },
            }
          : {}),
      };

      let popup = 'import "./nested.js";\n';
      let nested = 'console.log("production");\n';
      let css = "/* production */";
      if (mode === "static") {
        nested = 'console.log("Локальная разработка");\n';
      } else if (mode === "dynamic") {
        popup = 'import("./nested.js");\n';
        nested = 'console.log("Локальная разработка");\n';
      } else if (mode === "loopback") {
        nested = 'const api = "http://127.0.0.1:43100";\n';
      } else if (mode === "css") {
        css = "/* LOCAL DEVELOPMENT */";
      }
      return {
        "manifest.json": JSON.stringify(manifest),
        "worker.js": worker,
        "popup.html":
          '<html><script type="module" src="popup.js"></script></html>',
        "popup.js": popup,
        "nested.js": nested,
        "theme.css": css,
        // Text-only documentation is not an executable asset.
        "readme.txt": "LOCAL DEVELOPMENT is forbidden in packaged code",
      };
    }
    writeZip(join(sourceDir, "chromium.zip"), browserEntries("chromium"));
    writeZip(join(sourceDir, "firefox.zip"), browserEntries("firefox"));
    return {
      root,
      authorityPath,
      chromium: join(sourceDir, "chromium.zip"),
      firefox: join(sourceDir, "firefox.zip"),
      candidate: join(root, "prepared"),
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function withFixture(mode, callback) {
  const item = fixture(mode);
  try {
    return callback(item);
  } finally {
    rmSync(item.root, { recursive: true, force: true });
  }
}

test("benign imported popup resources pass package preparation and preflight", () => {
  withFixture("clean", (value) => {
    prepareCandidate({
      authorityPath: value.authorityPath,
      outputDir: value.candidate,
      chromium: value.chromium,
      firefox: value.firefox,
    });
    assert.equal(
      preflightCandidate({
        authorityPath: value.authorityPath,
        candidateDir: value.candidate,
      }).status,
      "PASS",
    );
  });
});

for (const [label, mode] of [
  ["static local module", "static"],
  ["dynamic local module", "dynamic"],
  ["imported localhost endpoint module", "loopback"],
  ["packaged CSS resource", "css"],
]) {
  test("store ZIP rejects development-only material in " + label, () => {
    withFixture(mode, (value) => {
      assert.throws(
        () =>
          prepareCandidate({
            authorityPath: value.authorityPath,
            outputDir: value.candidate,
            chromium: value.chromium,
            firefox: value.firefox,
          }),
        /Package executable asset contains development-only material/,
      );
    });
  });
}

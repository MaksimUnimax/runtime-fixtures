import { Buffer } from "node:buffer";
import { createHash, generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  preflight as validateCandidate,
  prepare as prepareCandidate,
  productFacts,
  sourceIdentity,
} from "./release-lib.mjs";

const NODE = "/root/.nvm/versions/node/v24.20.0/bin/node";
const prepareTool = resolve("tooling/b1/prepare-release-candidate.mjs");
const preflightTool = resolve("tooling/b1/release-preflight.mjs");

function makeTrustBundle(keyId) {
  const { publicKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  return {
    trustBundleVersion: "bootstrap_trust_bundle_v1",
    algorithm: "Ed25519",
    publicKeyFormat: "spki_der",
    publicKeyEncoding: "base64",
    fingerprintAlgorithm: "sha256",
    fingerprintEncoding: "lowercase_hex",
    keys: [
      {
        keyId,
        publicKey: der.toString("base64"),
        fingerprintSha256: createHash("sha256").update(der).digest("hex"),
        lifecycle: "ACTIVE",
        trustEligibility: "SIGNING_AND_VERIFICATION",
      },
    ],
  };
}

const trustedBundle = makeTrustBundle("fixture-release-key");
const attackerBundle = makeTrustBundle("attacker-release-key");
const BASE_ORIGINS = {
  controlApiOrigin: "https://api.fixture.invalid",
  portalOrigin: "https://app.fixture.invalid",
};

function releaseAuthority(overrides = {}) {
  const facts = productFacts();
  const base = {
    schemaVersion: "octoport_release_authority_v1",
    source: sourceIdentity(),
    productVersion: facts.productVersion,
    contractVersion: facts.contractVersion,
    migrationLevel: facts.migrationLevel,
    environment: "PREPRODUCTION",
    origins: BASE_ORIGINS,
    trustBundle: trustedBundle,
  };
  return {
    ...base,
    ...overrides,
    source: overrides.source ?? base.source,
    origins: overrides.origins ?? base.origins,
    trustBundle: overrides.trustBundle ?? base.trustBundle,
  };
}

function packagedConfig(authority, overrides = {}) {
  return {
    environment: authority.environment,
    controlApiOrigin: authority.origins.controlApiOrigin,
    portalOrigin: authority.origins.portalOrigin,
    extensionVersion: authority.productVersion,
    contractVersion: authority.contractVersion,
    trustBundle: authority.trustBundle,
    ...overrides,
  };
}

const ZIP_WRITER = String.raw`
import base64,sys,zipfile
path,browser,mode,manifest64,worker64=sys.argv[1:6]
manifest=base64.b64decode(manifest64)
worker=base64.b64decode(worker64)
rows=[("manifest.json",manifest),("worker.js",worker)]
if mode=="no_runtime":
    rows=[row for row in rows if row[0]!="worker.js"]
if mode=="secret":
    rows.append(("private.pem",b"-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----"))
if mode=="secretfile":
    rows.append((".env",b"token=fixture"))
if mode=="path":
    rows.append(("../outside",b"bad"))
if mode=="absolute":
    rows.append(("/tmp/outside",b"bad"))
if mode=="backslash":
    rows.append(("..\\outside",b"bad"))
if mode=="duplicate":
    rows.append(("manifest.json",b"{}"))
if mode=="case_duplicate":
    rows.append(("MANIFEST.JSON",b"{}"))
if mode=="symlink":
    with zipfile.ZipFile(path,"w") as z:
        i=zipfile.ZipInfo("link")
        i.create_system=3
        i.external_attr=(0o120777<<16)
        z.writestr(i,b"target")
    raise SystemExit(0)
with zipfile.ZipFile(path,"w") as z:
    for name,value in rows:
        z.writestr(name,value)
`;

function encode(value) {
  return Buffer.from(value).toString("base64");
}

function makeZip(path, browser, options = {}) {
  const authority = options.authority ?? releaseAuthority();
  let manifest = {
    manifest_version: 3,
    version: options.version ?? authority.productVersion,
    host_permissions: [
      `${authority.origins.controlApiOrigin}/*`,
      `${authority.origins.portalOrigin}/*`,
    ],
    background:
      browser === "chromium"
        ? { service_worker: "worker.js" }
        : { scripts: ["worker.js"] },
  };

  if (options.mode === "not_extension") {
    manifest = { fake: "manifest" };
  }
  if (options.mode === "wrong_endpoint") {
    manifest.host_permissions = [
      "https://replaced.invalid/*",
      `${authority.origins.portalOrigin}/*`,
    ];
  }

  let config = packagedConfig(authority);
  if (options.mode === "attacker_key") {
    config = { ...config, trustBundle: attackerBundle };
  }
  if (options.mode === "wrong_contract") {
    config = { ...config, contractVersion: "control_plane_v1" };
  }
  if (options.mode === "wrong_environment") {
    config = { ...config, environment: "ANOTHER_ENVIRONMENT" };
  }

  const worker =
    options.mode === "missing_config"
      ? "console.log('runtime');\n"
      : `globalThis.__SELLER_AGENTS_PACKAGED_CONFIG__=${JSON.stringify(
          JSON.stringify(config),
        )};\n`;

  const result = spawnSync(
    "python3",
    [
      "-c",
      ZIP_WRITER,
      path,
      browser,
      options.mode ?? "",
      encode(JSON.stringify(manifest)),
      encode(worker),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
}

function fixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), "octoport-c01-"));
  const candidate = join(root, "source-packages");
  mkdirSync(candidate);

  const authorityValue = releaseAuthority(options.authority ?? {});
  const authority = join(root, "release-authority.json");
  writeFileSync(authority, JSON.stringify(authorityValue));

  const packageAuthority = options.packageAuthority ?? authorityValue;
  makeZip(join(candidate, "chromium.zip"), "chromium", {
    ...(options.chromium ?? {}),
    authority: packageAuthority,
  });
  makeZip(join(candidate, "firefox.zip"), "firefox", {
    ...(options.firefox ?? {}),
    authority: packageAuthority,
  });

  return {
    root,
    candidate,
    authority,
    authorityValue,
  };
}

function cleanup(value) {
  rmSync(value.root, { force: true, recursive: true });
}

function prepare(value) {
  const output = join(value.root, "prepared");
  const result = prepareCandidate({
    authorityPath: value.authority,
    outputDir: output,
    chromium: join(value.candidate, "chromium.zip"),
    firefox: join(value.candidate, "firefox.zip"),
  });
  return { output, result };
}

function preflight(value, candidateDir) {
  return validateCandidate({
    authorityPath: value.authority,
    candidateDir,
  });
}

function expectPrepareFailure(name, browserMode) {
  test(name, () => {
    const value = fixture({
      chromium: { mode: browserMode },
    });
    try {
      assert.throws(() => prepare(value));
    } finally {
      cleanup(value);
    }
  });
}

test("repository release facts use current contract/version/migration tag", () => {
  const facts = productFacts();
  assert.equal(facts.productVersion, "0.2.4");
  assert.equal(facts.contractVersion, "control_plane_v2");
  assert.equal(facts.migrationLevel, 48);
});

test("correct synthetic Chromium and Firefox candidate prepares and passes", () => {
  const value = fixture();
  try {
    const { output, result } = prepare(value);
    assert.equal(result.productVersion, productFacts().productVersion);
    const rc = JSON.parse(
      readFileSync(join(output, "B1_RC_MANIFEST.json"), "utf8"),
    );
    for (const browser of ["chromium", "firefox"]) {
      const archive = readFileSync(join(value.candidate, `${browser}.zip`));
      assert.equal(rc.packages[browser].bytes, archive.length);
      assert.equal(
        rc.packages[browser].sha256,
        createHash("sha256").update(archive).digest("hex"),
      );
      assert.equal(rc.packages[browser].inventoryCount, 2);
    }
    const result2 = preflight(value, output);
    assert.equal(result2.status, "PASS");
    assert.equal(result2.evidenceLevel, "PACKAGE");
    assert.equal(result2.productionMutation, "NOT_PERFORMED");
    assert.equal(result2.externalAcceptance, "NOT_CLAIMED");
  } finally {
    cleanup(value);
  }
});

test("CLI preparer and preflight emit machine-readable bounded success", () => {
  const value = fixture();
  try {
    const output = join(value.root, "prepared");
    const prepared = spawnSync(
      NODE,
      [
        prepareTool,
        "--authority",
        value.authority,
        "--out",
        output,
        "--chromium",
        join(value.candidate, "chromium.zip"),
        "--firefox",
        join(value.candidate, "firefox.zip"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(prepared.status, 0, prepared.stderr);
    const preparedJson = JSON.parse(prepared.stdout);
    assert.equal(preparedJson.status, "PREPARED");
    assert.equal(preparedJson.productionMutation, "NOT_PERFORMED");
    assert.equal(preparedJson.externalAcceptance, "NOT_CLAIMED");

    const checked = spawnSync(
      NODE,
      [preflightTool, output, "--authority", value.authority],
      { encoding: "utf8" },
    );
    assert.equal(checked.status, 0, checked.stderr);
    const checkedJson = JSON.parse(checked.stdout);
    assert.equal(checkedJson.status, "PASS");
    assert.equal(checkedJson.evidenceLevel, "PACKAGE");
    assert.equal(checkedJson.productionMutation, "NOT_PERFORMED");
  } finally {
    cleanup(value);
  }
});

test("NOT_AN_EXTENSION never becomes release PASS", () => {
  const value = fixture({
    chromium: { mode: "not_extension" },
  });
  try {
    assert.throws(() => prepare(value));
  } finally {
    cleanup(value);
  }
});

test("package carrying arbitrary bootstrap trust is rejected", () => {
  const value = fixture({
    chromium: { mode: "attacker_key" },
  });
  try {
    assert.throws(() => prepare(value), /trust bundle/i);
  } finally {
    cleanup(value);
  }
});

test("authority public-key fingerprint must be cryptographically consistent", () => {
  const broken = {
    ...trustedBundle,
    keys: trustedBundle.keys.map((key) => ({ ...key })),
  };
  broken.keys[0].fingerprintSha256 = "0".repeat(64);
  const value = fixture({
    authority: { trustBundle: broken },
  });
  try {
    assert.throws(() => prepare(value), /fingerprint/i);
  } finally {
    cleanup(value);
  }
});

expectPrepareFailure("ZIP traversal is rejected", "path");
expectPrepareFailure("absolute ZIP path is rejected", "absolute");
expectPrepareFailure("backslash ZIP escape is rejected", "backslash");
expectPrepareFailure("duplicate ZIP entry is rejected", "duplicate");
expectPrepareFailure(
  "case-folded duplicate ZIP entry is rejected",
  "case_duplicate",
);
expectPrepareFailure(
  "missing declared extension runtime is rejected",
  "no_runtime",
);
expectPrepareFailure("private-key material is rejected", "secret");
expectPrepareFailure("forbidden secret file is rejected", "secretfile");
expectPrepareFailure("symlink-like ZIP entry is rejected", "symlink");

test("oversized package input is rejected before archive allocation", () => {
  const value = fixture();
  try {
    const oversized = join(value.root, "oversized.zip");
    writeFileSync(oversized, "");
    truncateSync(oversized, 128 * 1024 * 1024 + 1);
    assert.throws(
      () =>
        prepareCandidate({
          authorityPath: value.authority,
          outputDir: join(value.root, "oversized-output"),
          chromium: oversized,
          firefox: join(value.candidate, "firefox.zip"),
        }),
      /size limit/i,
    );
  } finally {
    cleanup(value);
  }
});

test("non-regular package input is rejected before archive read", () => {
  const value = fixture();
  try {
    const directoryInput = join(value.root, "directory.zip");
    mkdirSync(directoryInput);
    assert.throws(
      () =>
        prepareCandidate({
          authorityPath: value.authority,
          outputDir: join(value.root, "directory-output"),
          chromium: directoryInput,
          firefox: join(value.candidate, "firefox.zip"),
        }),
      /regular file/i,
    );
  } finally {
    cleanup(value);
  }
});

expectPrepareFailure(
  "missing reachable packaged config is rejected",
  "missing_config",
);
expectPrepareFailure("stale packaged contract is rejected", "wrong_contract");
expectPrepareFailure(
  "replaced packaged endpoint is rejected",
  "wrong_endpoint",
);
expectPrepareFailure(
  "mismatched packaged environment is rejected",
  "wrong_environment",
);

for (const [name, authorityPatch] of [
  [
    "stale source HEAD fails",
    {
      source: {
        head: "0".repeat(40),
        tree: sourceIdentity().tree,
      },
    },
  ],
  [
    "stale source tree fails",
    {
      source: {
        head: sourceIdentity().head,
        tree: "0".repeat(40),
      },
    },
  ],
  ["stale product version fails", { productVersion: "0.0.0" }],
  ["stale server contract fails", { contractVersion: "old_contract" }],
  ["stale migration level fails", { migrationLevel: 999 }],
]) {
  test(name, () => {
    const value = fixture({ authority: authorityPatch });
    try {
      assert.throws(() => prepare(value), /stale/i);
    } finally {
      cleanup(value);
    }
  });
}

test("authority origins cannot be replaced without matching package evidence", () => {
  const baseline = releaseAuthority();
  const value = fixture({
    authority: {
      origins: {
        controlApiOrigin: "https://replacement-api.fixture.invalid",
        portalOrigin: "https://replacement-app.fixture.invalid",
      },
    },
    packageAuthority: baseline,
  });
  try {
    assert.throws(() => prepare(value), /endpoint|authority/i);
  } finally {
    cleanup(value);
  }
});

test("authority exact bytes are bound into the candidate manifest", () => {
  const value = fixture();
  try {
    const { output } = prepare(value);
    writeFileSync(
      value.authority,
      JSON.stringify(value.authorityValue, null, 2) + "\n",
    );
    assert.throws(() => preflight(value, output), /authority|stale/i);
  } finally {
    cleanup(value);
  }
});

test("candidate package filename cannot escape candidate directory", () => {
  const value = fixture();
  try {
    const { output } = prepare(value);
    const manifestPath = join(output, "B1_RC_MANIFEST.json");
    const rc = JSON.parse(readFileSync(manifestPath, "utf8"));
    rc.packages.chromium.filename = "../chromium.zip";
    writeFileSync(manifestPath, JSON.stringify(rc));
    assert.throws(() => preflight(value, output), /package metadata/i);
  } finally {
    cleanup(value);
  }
});

test("candidate metadata cannot replace archive hash facts", () => {
  const value = fixture();
  try {
    const { output } = prepare(value);
    const manifestPath = join(output, "B1_RC_MANIFEST.json");
    const rc = JSON.parse(readFileSync(manifestPath, "utf8"));
    rc.packages.chromium.sha256 = "0".repeat(64);
    writeFileSync(manifestPath, JSON.stringify(rc));
    assert.throws(() => preflight(value, output), /archive bytes/i);
  } finally {
    cleanup(value);
  }
});

test("authority must be external to prepared candidate directory", () => {
  const value = fixture();
  try {
    const { output } = prepare(value);
    const insideAuthority = join(output, "authority.json");
    writeFileSync(insideAuthority, readFileSync(value.authority));
    assert.throws(
      () =>
        validateCandidate({
          authorityPath: insideAuthority,
          candidateDir: output,
        }),
      /outside/i,
    );
  } finally {
    cleanup(value);
  }
});

test("preparer never claims browser/live/deployment acceptance", () => {
  const value = fixture();
  try {
    const output = join(value.root, "prepared");
    const result = spawnSync(
      NODE,
      [
        prepareTool,
        "--authority",
        value.authority,
        "--out",
        output,
        "--chromium",
        join(value.candidate, "chromium.zip"),
        "--firefox",
        join(value.candidate, "firefox.zip"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(
      result.stdout,
      /LIVE_OWNER|BROWSER_ACCEPTED|DEPLOYED|PRODUCTION_PASS/,
    );
    assert.match(result.stdout, /"productionMutation":"NOT_PERFORMED"/);
    assert.match(result.stdout, /"externalAcceptance":"NOT_CLAIMED"/);
  } finally {
    cleanup(value);
  }
});

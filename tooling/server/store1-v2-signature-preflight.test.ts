import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BootstrapIdentifiedSnapshotPayloadV2 } from "../../packages/contracts/src/index.js";
import {
  BOOTSTRAP_SIGNATURE_DOMAIN,
  signBootstrapSnapshotV2,
} from "../../packages/server/remote-config/src/index.js";
import {
  STORE1_ACCEPTED_ARTIFACT_SHA256,
  STORE1_ACCEPTED_SOURCE_HEAD,
  STORE1_ACCEPTED_SOURCE_TREE,
  STORE1_CONTRACT,
  STORE1_VERSION,
  type Store1ActivationReadback,
  type Store1PackageAuthority,
} from "./store1-opera-admin-activation.js";
import {
  createStore1PackagedBootstrapVerifier,
  extractStore1PackageSignatureEvidenceFromEntries,
  isTrustedStore1V2SignaturePreflightProof,
  readStore1PackageSignatureEvidence,
  runStore1V2SignaturePreflightWithEvidence,
  STORE1_BOOTSTRAP_PATH,
  STORE1_V2_CONFIG_READ_PATH,
  type Store1PackageSignatureEvidence,
  type Store1TrustBundle,
  type Store1V2SignaturePreflightTransport,
} from "./store1-v2-signature-preflight.js";

const ACCOUNT = "40000000-0000-4000-8000-000000000001";
const DEVICE = "40000000-0000-4000-8000-000000000002";
const OTHER_ACCOUNT = "40000000-0000-4000-8000-000000000003";
const KEY_ID = "store1-test-active";
const authority: Store1PackageAuthority = {
  sourceHead: STORE1_ACCEPTED_SOURCE_HEAD,
  sourceTree: STORE1_ACCEPTED_SOURCE_TREE,
  version: STORE1_VERSION,
  contractVersion: STORE1_CONTRACT,
  artifactSha256: STORE1_ACCEPTED_ARTIFACT_SHA256,
  filename: "OCTOPORT_v0.2.5_CHROMIUM_STORE.zip",
};
const verifierSource = readFileSync(
  new URL("../../packages/control-client/src/crypto.js", import.meta.url),
  "utf8",
);
const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const pair = generateKeyPairSync("ed25519");
  const der = pair.publicKey.export({ format: "der", type: "spki" });
  const trustBundle: Store1TrustBundle = {
    trustBundleVersion: "bootstrap_trust_bundle_v1",
    algorithm: "Ed25519",
    publicKeyFormat: "spki_der",
    publicKeyEncoding: "base64",
    fingerprintAlgorithm: "sha256",
    fingerprintEncoding: "lowercase_hex",
    keys: [
      {
        keyId: KEY_ID,
        publicKey: der.toString("base64"),
        fingerprintSha256: createHash("sha256").update(der).digest("hex"),
        lifecycle: "ACTIVE",
        trustEligibility: "SIGNING_AND_VERIFICATION",
      },
    ],
  };
  const verifier = createStore1PackagedBootstrapVerifier(verifierSource);
  verifier.validateBundle(trustBundle);
  const packageEvidence: Store1PackageSignatureEvidence = {
    authority,
    controlApiOrigin: "https://api.octoport.test",
    trustBundle,
    trustBundleSha256: createHash("sha256")
      .update(verifier.canonicalJson(trustBundle))
      .digest("hex"),
    verifier,
  };
  const config: NonNullable<Store1ActivationReadback["config"]> = {
    configVersion: 8,
    contractVersion: STORE1_CONTRACT,
    snapshotVersion: "bootstrap_snapshot_v2",
    envelopeVersion: "bootstrap_envelope_v2",
    contentHashSha256: "a".repeat(64),
    sourceFingerprintSha256: "b".repeat(64),
    signingKeyId: KEY_ID,
    signingKeyState: "ACTIVE",
    compatibilityPolicyRevisionIds: [],
  };
  const payload: BootstrapIdentifiedSnapshotPayloadV2 = {
    snapshotVersion: "bootstrap_snapshot_v2",
    contractVersion: STORE1_CONTRACT,
    configVersion: 8,
    issuedAt: "2030-01-01T00:00:00.000Z",
    expiresAt: "2030-01-01T00:15:00.000Z",
    offlineGraceUntil: "2030-01-02T00:15:00.000Z",
    serverTime: "2030-01-01T00:00:00.000Z",
    accessBasis: "BETA",
    account: { id: ACCOUNT, status: "ACTIVE" },
    subscription: { state: "NONE", planRevision: null },
    devicePolicy: { status: "ACTIVE" },
    entitlements: {},
    compatibility: {
      extension: { status: "SUPPORTED", minimumVersion: null },
      browser: { status: "SUPPORTED" },
    },
    features: {},
    ai: { status: "UNCONFIGURED" },
  };
  const envelope = signBootstrapSnapshotV2(payload, KEY_ID, pair.privateKey);
  return {
    pair,
    trustBundle,
    verifier,
    packageEvidence,
    config,
    payload,
    envelope,
  };
}
function fakeTransport(
  config: NonNullable<Store1ActivationReadback["config"]> | null,
  envelope: unknown,
  authenticatedContext?: {
    accountId: string;
    deviceId: string;
    browserFamily: "opera";
    browserVersion: string;
    controlApiOrigin: string;
  },
) {
  const calls: Array<{ kind: "config" | "bootstrap"; value: unknown }> = [];
  const transport: Store1V2SignaturePreflightTransport = {
    async readLatestConfig(path) {
      calls.push({ kind: "config", value: path });
      return config;
    },
    async issueBootstrap(path, request) {
      calls.push({ kind: "bootstrap", value: { path, request } });
      return {
        envelope,
        authenticatedContext: authenticatedContext ?? {
          accountId: ACCOUNT,
          deviceId: request.deviceId,
          browserFamily: request.browser.family,
          browserVersion: request.browser.version,
          controlApiOrigin: "https://api.octoport.test",
        },
      };
    },
  };
  return { calls, transport };
}

describe("STORE-1 v2 signature preflight", () => {
  it("binds accepted package trust, current config, key and authenticated reviewer account", async () => {
    const f = fixture();
    const fake = fakeTransport(f.config, f.envelope);
    const proof = await runStore1V2SignaturePreflightWithEvidence({
      packageEvidence: f.packageEvidence,
      expectedAccountId: ACCOUNT,
      deviceId: DEVICE,
      browserVersion: "136.0",
      transport: fake.transport,
    });
    expect(proof).toMatchObject({
      schemaVersion: "store1_v2_signature_preflight_v1",
      verified: true,
      artifactSha256: STORE1_ACCEPTED_ARTIFACT_SHA256,
      configVersion: 8,
      signingKeyId: KEY_ID,
      accountId: ACCOUNT,
      deviceId: DEVICE,
      aiStatus: "UNCONFIGURED",
    });
    expect(isTrustedStore1V2SignaturePreflightProof(proof)).toBe(false);
    expect(fake.calls[0]).toEqual({
      kind: "config",
      value: STORE1_V2_CONFIG_READ_PATH,
    });
    expect(fake.calls[1]).toMatchObject({
      kind: "bootstrap",
      value: {
        path: STORE1_BOOTSTRAP_PATH,
        request: {
          contractVersion: STORE1_CONTRACT,
          extensionVersion: STORE1_VERSION,
          browser: { family: "opera", version: "136.0" },
          deviceId: DEVICE,
          lastConfigVersion: null,
        },
      },
    });
    const request = (
      fake.calls[1]!.value as { request: Record<string, unknown> }
    ).request;
    expect(request).not.toHaveProperty("detectedAi");
  });

  it("rejects mismatched authenticated device/browser context", async () => {
    const f = fixture();
    await expect(
      runStore1V2SignaturePreflightWithEvidence({
        packageEvidence: f.packageEvidence,
        expectedAccountId: ACCOUNT,
        deviceId: DEVICE,
        browserVersion: "136",
        transport: fakeTransport(f.config, f.envelope, {
          accountId: ACCOUNT,
          deviceId: "40000000-0000-4000-8000-000000000099",
          browserFamily: "opera",
          browserVersion: "136",
          controlApiOrigin: "https://api.octoport.test",
        }).transport,
      }),
    ).rejects.toThrow("STORE1_V2_AUTHENTICATED_CONTEXT_MISMATCH");

    await expect(
      runStore1V2SignaturePreflightWithEvidence({
        packageEvidence: f.packageEvidence,
        expectedAccountId: ACCOUNT,
        deviceId: DEVICE,
        browserVersion: "136",
        transport: fakeTransport(f.config, f.envelope, {
          accountId: ACCOUNT,
          deviceId: DEVICE,
          browserFamily: "opera",
          browserVersion: "137",
          controlApiOrigin: "https://api.octoport.test",
        }).transport,
      }),
    ).rejects.toThrow("STORE1_V2_AUTHENTICATED_CONTEXT_MISMATCH");
  });

  it("rejects mismatched packaged control origin", async () => {
    const f = fixture();
    await expect(
      runStore1V2SignaturePreflightWithEvidence({
        packageEvidence: f.packageEvidence,
        expectedAccountId: ACCOUNT,
        deviceId: DEVICE,
        browserVersion: "136",
        transport: fakeTransport(f.config, f.envelope, {
          accountId: ACCOUNT,
          deviceId: DEVICE,
          browserFamily: "opera",
          browserVersion: "136",
          controlApiOrigin: "https://other.example.test",
        }).transport,
      }),
    ).rejects.toThrow("STORE1_V2_AUTHENTICATED_CONTEXT_MISMATCH");
  });

  it("rejects an expired signed bootstrap at the exact expiry boundary", async () => {
    const f = fixture();
    await expect(
      runStore1V2SignaturePreflightWithEvidence({
        packageEvidence: f.packageEvidence,
        expectedAccountId: ACCOUNT,
        deviceId: DEVICE,
        browserVersion: "136",
        transport: fakeTransport(f.config, f.envelope).transport,
        now: () => new Date("2030-01-01T00:15:00.000Z"),
      }),
    ).rejects.toThrow("STORE1_V2_SIGNATURE_EXPIRED");
  });

  it("rejects bad signatures and unknown packaged trust keys", async () => {
    const f = fixture();
    const bad = { ...f.envelope, signature: "AA" };
    await expect(
      runStore1V2SignaturePreflightWithEvidence({
        packageEvidence: f.packageEvidence,
        expectedAccountId: ACCOUNT,
        deviceId: DEVICE,
        browserVersion: "136",
        transport: fakeTransport(f.config, bad).transport,
      }),
    ).rejects.toThrow("STORE1_V2_SIGNATURE_INVALID_SIGNATURE");

    const unknown = { ...f.envelope, keyId: "unknown-key" };
    await expect(
      runStore1V2SignaturePreflightWithEvidence({
        packageEvidence: f.packageEvidence,
        expectedAccountId: ACCOUNT,
        deviceId: DEVICE,
        browserVersion: "136",
        transport: fakeTransport(f.config, unknown).transport,
      }),
    ).rejects.toThrow("STORE1_V2_SIGNATURE_UNKNOWN_SIGNING_KEY");
  });

  it("rejects config, key and account context mismatches", async () => {
    const f = fixture();
    await expect(
      runStore1V2SignaturePreflightWithEvidence({
        packageEvidence: f.packageEvidence,
        expectedAccountId: ACCOUNT,
        deviceId: DEVICE,
        browserVersion: "136",
        transport: fakeTransport({ ...f.config, configVersion: 9 }, f.envelope)
          .transport,
      }),
    ).rejects.toThrow("STORE1_V2_SIGNATURE_CONTEXT_MISMATCH");

    await expect(
      runStore1V2SignaturePreflightWithEvidence({
        packageEvidence: f.packageEvidence,
        expectedAccountId: OTHER_ACCOUNT,
        deviceId: DEVICE,
        browserVersion: "136",
        transport: fakeTransport(f.config, f.envelope, {
          accountId: OTHER_ACCOUNT,
          deviceId: DEVICE,
          browserFamily: "opera",
          browserVersion: "136",
          controlApiOrigin: "https://api.octoport.test",
        }).transport,
      }),
    ).rejects.toThrow("STORE1_V2_SIGNATURE_CONTEXT_MISMATCH");

    await expect(
      runStore1V2SignaturePreflightWithEvidence({
        packageEvidence: f.packageEvidence,
        expectedAccountId: ACCOUNT,
        deviceId: DEVICE,
        browserVersion: "136",
        transport: fakeTransport(
          { ...f.config, signingKeyId: "different-active-key" },
          f.envelope,
        ).transport,
      }),
    ).rejects.toThrow("STORE1_V2_SIGNATURE_CONTEXT_MISMATCH");
  });

  it("rejects a valid signature over noncanonical JSON bytes", async () => {
    const f = fixture();
    const noncanonical = Buffer.from(
      JSON.stringify(f.payload, null, 2),
      "utf8",
    );
    const signingBytes = Buffer.concat([
      BOOTSTRAP_SIGNATURE_DOMAIN,
      Buffer.from(KEY_ID, "utf8"),
      Buffer.from([0]),
      noncanonical,
    ]);
    const envelope = {
      envelopeVersion: "bootstrap_envelope_v2",
      algorithm: "Ed25519",
      keyId: KEY_ID,
      payload: noncanonical.toString("base64url"),
      signature: sign(null, signingBytes, f.pair.privateKey).toString(
        "base64url",
      ),
    };
    await expect(
      runStore1V2SignaturePreflightWithEvidence({
        packageEvidence: f.packageEvidence,
        expectedAccountId: ACCOUNT,
        deviceId: DEVICE,
        browserVersion: "136",
        transport: fakeTransport(f.config, envelope).transport,
      }),
    ).rejects.toThrow("STORE1_V2_SIGNATURE_NON_CANONICAL_PAYLOAD");
  });

  it("rejects development packaged config before signature verification", () => {
    const f = fixture();
    const config = {
      environment: "LOCAL DEVELOPMENT",
      controlApiOrigin: "https://api.octoport.ru",
      portalOrigin: "https://app.octoport.ru",
      extensionVersion: STORE1_VERSION,
      contractVersion: STORE1_CONTRACT,
      trustBundle: f.trustBundle,
    };
    const serviceWorker = Buffer.from(
      "globalThis.__SELLER_AGENTS_PACKAGED_CONFIG__=" +
        JSON.stringify(JSON.stringify(config)) +
        ";",
    );
    expect(() =>
      extractStore1PackageSignatureEvidenceFromEntries(
        authority,
        new Map([
          ["service_worker.js", serviceWorker],
          ["shared/bootstrap_verifier.js", Buffer.from(verifierSource)],
        ]),
      ),
    ).toThrow("STORE1_PACKAGE_RUNTIME_NOT_STORE");
  });

  it("rejects package bytes whose hash is not the accepted STORE artifact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "store1-preflight-"));
    tempDirs.push(dir);
    const zip = join(dir, "OCTOPORT_v0.2.5_CHROMIUM_STORE.zip");
    const manifest = join(dir, "B1_RC_MANIFEST.json");
    writeFileSync(zip, "not-the-accepted-zip");
    writeFileSync(
      manifest,
      JSON.stringify({
        productVersion: STORE1_VERSION,
        contractVersion: STORE1_CONTRACT,
        source: {
          head: STORE1_ACCEPTED_SOURCE_HEAD,
          tree: STORE1_ACCEPTED_SOURCE_TREE,
        },
        packages: {
          chromium: {
            version: STORE1_VERSION,
            browser: "chromium",
            sha256: STORE1_ACCEPTED_ARTIFACT_SHA256,
            filename: "OCTOPORT_v0.2.5_CHROMIUM_STORE.zip",
          },
        },
      }),
    );
    await expect(
      readStore1PackageSignatureEvidence(manifest, zip),
    ).rejects.toThrow("STORE1_PACKAGE_SHA256_MISMATCH");
  });
});

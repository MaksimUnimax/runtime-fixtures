import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import {
  STORE1_ACCEPTED_ARTIFACT_SHA256,
  STORE1_ACCEPTED_SOURCE_HEAD,
  STORE1_ACCEPTED_SOURCE_TREE,
  STORE1_BROWSER,
  STORE1_BROWSER_MINIMUM,
  STORE1_CONTRACT,
  STORE1_VERSION,
} from "./store1-operator-authority.js";
import type {
  Store1ActivationReadback,
  Store1PackageAuthority,
  Store1V2SignaturePreflightProof,
} from "./store1-opera-admin-activation.js";

export const STORE1_V2_CONFIG_READ_PATH =
  "/v1/admin/compatibility/config-releases/latest?contractVersion=control_plane_v2" as const;
export const STORE1_BOOTSTRAP_PATH = "/v1/bootstrap" as const;

type TrustKey = {
  keyId: string;
  publicKey: string;
  fingerprintSha256: string;
  lifecycle: "ACTIVE" | "RETIRED";
  trustEligibility: "SIGNING_AND_VERIFICATION" | "VERIFICATION_OVERLAP";
};
export type Store1TrustBundle = {
  trustBundleVersion: "bootstrap_trust_bundle_v1";
  algorithm: "Ed25519";
  publicKeyFormat: "spki_der";
  publicKeyEncoding: "base64";
  fingerprintAlgorithm: "sha256";
  fingerprintEncoding: "lowercase_hex";
  keys: TrustKey[];
};
type VerifiedV2 =
  | {
      ok: true;
      payload: Record<string, unknown>;
      envelope: Record<string, unknown>;
    }
  | { ok: false; error: string };
export type Store1PackagedBootstrapVerifier = {
  validateBundle(bundle: unknown): unknown;
  canonicalJson(value: unknown): string;
  verifyV2(input: unknown, bundle: unknown): Promise<VerifiedV2>;
};
export type Store1PackageSignatureEvidence = {
  authority: Store1PackageAuthority;
  controlApiOrigin: string;
  trustBundle: Store1TrustBundle;
  trustBundleSha256: string;
  verifier: Store1PackagedBootstrapVerifier;
};
export type Store1V2BootstrapPreflightRequest = {
  contractVersion: typeof STORE1_CONTRACT;
  extensionVersion: typeof STORE1_VERSION;
  browser: { family: typeof STORE1_BROWSER; version: string };
  deviceId: string;
  lastConfigVersion: null;
};
type Store1Config = NonNullable<Store1ActivationReadback["config"]>;
export type Store1V2SignaturePreflightTransport = {
  readLatestConfig(
    path: typeof STORE1_V2_CONFIG_READ_PATH,
  ): Promise<Store1Config | null>;
  issueBootstrap(
    path: typeof STORE1_BOOTSTRAP_PATH,
    request: Store1V2BootstrapPreflightRequest,
  ): Promise<{
    envelope: unknown;
    authenticatedContext: {
      accountId: string;
      deviceId: string;
      browserFamily: typeof STORE1_BROWSER;
      browserVersion: string;
      controlApiOrigin: string;
    };
  }>;
};

const PACKAGED_CONFIG_MARKER = "globalThis.__SELLER_AGENTS_PACKAGED_CONFIG__=";
const HASH = /^[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BROWSER_VERSION = /^\d+(?:\.\d+){0,3}$/;
const TRUSTED_SIGNATURE_PROOFS = new WeakSet<object>();

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function isTrustedStore1V2SignaturePreflightProof(
  value: unknown,
): value is Store1V2SignaturePreflightProof {
  return record(value) && TRUSTED_SIGNATURE_PROOFS.has(value);
}

function trustSignatureProof(
  proof: Store1V2SignaturePreflightProof,
): Store1V2SignaturePreflightProof {
  const capability = Object.freeze({ ...proof });
  TRUSTED_SIGNATURE_PROOFS.add(capability);
  return capability;
}

export function trustStore1V2SignaturePreflightProofForTest(
  proof: Store1V2SignaturePreflightProof,
): Store1V2SignaturePreflightProof {
  if (process.env.VITEST !== "true")
    throw new Error("STORE1_TEST_ONLY_SIGNATURE_PROOF");
  return trustSignatureProof(proof);
}

function parsePackagedConfig(source: string): Record<string, unknown> {
  const first = source.indexOf(PACKAGED_CONFIG_MARKER);
  if (first < 0) throw new Error("STORE1_PACKAGE_RUNTIME_CONFIG_MISSING");
  if (
    source.indexOf(
      PACKAGED_CONFIG_MARKER,
      first + PACKAGED_CONFIG_MARKER.length,
    ) >= 0
  )
    throw new Error("STORE1_PACKAGE_RUNTIME_CONFIG_CONFLICT");
  const tail = source.slice(first + PACKAGED_CONFIG_MARKER.length);
  const match = tail.match(/^(?:"(?:\\.|[^"\\])*")\s*;/);
  if (!match) throw new Error("STORE1_PACKAGE_RUNTIME_CONFIG_INVALID");
  try {
    const encoded = JSON.parse(match[0].replace(/;\s*$/, "")) as unknown;
    if (typeof encoded !== "string")
      throw new Error("STORE1_PACKAGE_RUNTIME_CONFIG_INVALID");
    const parsed = JSON.parse(encoded) as unknown;
    if (!record(parsed))
      throw new Error("STORE1_PACKAGE_RUNTIME_CONFIG_INVALID");
    return parsed;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "STORE1_PACKAGE_RUNTIME_CONFIG_INVALID"
    )
      throw error;
    throw new Error("STORE1_PACKAGE_RUNTIME_CONFIG_INVALID");
  }
}
export function createStore1PackagedBootstrapVerifier(
  source: string,
): Store1PackagedBootstrapVerifier {
  const sandbox: Record<string, unknown> = {
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    atob,
    btoa,
  };
  const context = createContext(sandbox);
  try {
    runInContext(source, context, { timeout: 1_000 });
  } catch {
    throw new Error("STORE1_PACKAGE_VERIFIER_INVALID");
  }
  const verifier = sandbox.SellerAgentsBootstrapVerifier;
  if (
    !record(verifier) ||
    typeof verifier.verifyV2 !== "function" ||
    typeof verifier.validateBundle !== "function" ||
    typeof verifier.canonicalJson !== "function"
  )
    throw new Error("STORE1_PACKAGE_VERIFIER_INVALID");
  const raw = verifier as Store1PackagedBootstrapVerifier;
  const intoPackagedRealm = (value: unknown): unknown => {
    sandbox.__octoportPreflightInput = JSON.stringify(value);
    try {
      return runInContext(
        "JSON.parse(globalThis.__octoportPreflightInput)",
        context,
        { timeout: 1_000 },
      );
    } finally {
      delete sandbox.__octoportPreflightInput;
    }
  };
  return {
    validateBundle(bundle) {
      const result = raw.validateBundle(intoPackagedRealm(bundle));
      return JSON.parse(JSON.stringify(result)) as unknown;
    },
    canonicalJson(value) {
      return raw.canonicalJson(intoPackagedRealm(value));
    },
    async verifyV2(input, bundle) {
      const result = await raw.verifyV2(
        intoPackagedRealm(input),
        intoPackagedRealm(bundle),
      );
      return JSON.parse(JSON.stringify(result)) as VerifiedV2;
    },
  };
}

export function extractStore1PackageSignatureEvidenceFromEntries(
  authority: Store1PackageAuthority,
  entries: Map<string, Buffer>,
): Store1PackageSignatureEvidence {
  const configBytes = entries.get("service_worker.js");
  const verifierBytes = entries.get("shared/bootstrap_verifier.js");
  if (!configBytes?.length)
    throw new Error("STORE1_PACKAGE_RUNTIME_CONFIG_MISSING");
  if (!verifierBytes?.length)
    throw new Error("STORE1_PACKAGE_VERIFIER_MISSING");
  const config = parsePackagedConfig(configBytes.toString("utf8"));
  if (
    config.environment !== "PREPRODUCTION" ||
    config.extensionVersion !== STORE1_VERSION ||
    config.contractVersion !== STORE1_CONTRACT ||
    typeof config.controlApiOrigin !== "string" ||
    !config.controlApiOrigin.startsWith("https://") ||
    typeof config.portalOrigin !== "string" ||
    !config.portalOrigin.startsWith("https://")
  )
    throw new Error("STORE1_PACKAGE_RUNTIME_NOT_STORE");
  const verifier = createStore1PackagedBootstrapVerifier(
    verifierBytes.toString("utf8"),
  );
  const trustBundle = config.trustBundle as Store1TrustBundle;
  try {
    verifier.validateBundle(trustBundle);
  } catch {
    throw new Error("STORE1_PACKAGE_TRUST_BUNDLE_INVALID");
  }
  const trustBundleSha256 = createHash("sha256")
    .update(verifier.canonicalJson(trustBundle))
    .digest("hex");
  return {
    authority,
    controlApiOrigin: config.controlApiOrigin,
    trustBundle,
    trustBundleSha256,
    verifier,
  };
}

export async function readStore1PackageSignatureEvidence(
  manifestPath: string,
  zipPath: string,
): Promise<Store1PackageSignatureEvidence> {
  const { readStore1PackageAuthority } = await import(
    "./store1-opera-admin-activation.js"
  );
  const authority = readStore1PackageAuthority(manifestPath, zipPath);
  const releaseLibUrl = new URL("../b1/release-lib.mjs", import.meta.url).href;
  const releaseLib = (await import(releaseLibUrl)) as {
    readZip(bytes: Buffer): Map<string, Buffer>;
  };
  const entries = releaseLib.readZip(readFileSync(zipPath));
  return extractStore1PackageSignatureEvidenceFromEntries(authority, entries);
}

function assertStore1Config(
  config: Store1Config | null,
): asserts config is Store1Config {
  if (
    !config ||
    config.contractVersion !== STORE1_CONTRACT ||
    config.snapshotVersion !== "bootstrap_snapshot_v2" ||
    config.envelopeVersion !== "bootstrap_envelope_v2" ||
    !Number.isSafeInteger(config.configVersion) ||
    config.configVersion <= 0 ||
    !HASH.test(config.contentHashSha256) ||
    !HASH.test(config.sourceFingerprintSha256) ||
    typeof config.signingKeyId !== "string" ||
    config.signingKeyId.length === 0 ||
    config.signingKeyState !== "ACTIVE"
  )
    throw new Error("STORE1_V2_CONFIG_METADATA_INVALID");
}

export function buildStore1V2BootstrapPreflightRequest(
  deviceId: string,
  browserVersion: string,
): Store1V2BootstrapPreflightRequest {
  if (!UUID.test(deviceId))
    throw new Error("STORE1_PREFLIGHT_DEVICE_ID_INVALID");
  if (
    !BROWSER_VERSION.test(browserVersion) ||
    Number(browserVersion.split(".")[0]) < Number(STORE1_BROWSER_MINIMUM)
  )
    throw new Error("STORE1_PREFLIGHT_BROWSER_VERSION_INVALID");
  return {
    contractVersion: STORE1_CONTRACT,
    extensionVersion: STORE1_VERSION,
    browser: { family: STORE1_BROWSER, version: browserVersion },
    deviceId,
    lastConfigVersion: null,
  };
}

export async function runStore1V2SignaturePreflightWithEvidence(input: {
  packageEvidence: Store1PackageSignatureEvidence;
  expectedAccountId: string;
  deviceId: string;
  browserVersion: string;
  transport: Store1V2SignaturePreflightTransport;
  now?: () => Date;
}): Promise<Store1V2SignaturePreflightProof> {
  if (!UUID.test(input.expectedAccountId))
    throw new Error("STORE1_PREFLIGHT_ACCOUNT_ID_INVALID");
  const authority = input.packageEvidence.authority;
  if (
    authority.sourceHead !== STORE1_ACCEPTED_SOURCE_HEAD ||
    authority.sourceTree !== STORE1_ACCEPTED_SOURCE_TREE ||
    authority.version !== STORE1_VERSION ||
    authority.contractVersion !== STORE1_CONTRACT ||
    authority.artifactSha256 !== STORE1_ACCEPTED_ARTIFACT_SHA256
  )
    throw new Error("STORE1_PACKAGE_AUTHORITY_CONFLICT");

  const config = await input.transport.readLatestConfig(
    STORE1_V2_CONFIG_READ_PATH,
  );
  assertStore1Config(config);
  const request = buildStore1V2BootstrapPreflightRequest(
    input.deviceId,
    input.browserVersion,
  );
  const response = await input.transport.issueBootstrap(
    STORE1_BOOTSTRAP_PATH,
    request,
  );
  if (
    response.authenticatedContext.accountId !== input.expectedAccountId ||
    response.authenticatedContext.deviceId !== input.deviceId ||
    response.authenticatedContext.browserFamily !== STORE1_BROWSER ||
    response.authenticatedContext.browserVersion !== input.browserVersion ||
    response.authenticatedContext.controlApiOrigin !==
      input.packageEvidence.controlApiOrigin
  )
    throw new Error("STORE1_V2_AUTHENTICATED_CONTEXT_MISMATCH");
  const envelope = response.envelope;

  let verified: VerifiedV2;
  try {
    verified = await input.packageEvidence.verifier.verifyV2(
      envelope,
      input.packageEvidence.trustBundle,
    );
  } catch {
    throw new Error("STORE1_V2_SIGNATURE_VERIFICATION_FAILED");
  }
  if (!verified.ok) throw new Error("STORE1_V2_SIGNATURE_" + verified.error);

  const payload = verified.payload;
  if (
    !record(envelope) ||
    envelope.envelopeVersion !== "bootstrap_envelope_v2" ||
    envelope.keyId !== config.signingKeyId ||
    payload.contractVersion !== STORE1_CONTRACT ||
    payload.snapshotVersion !== "bootstrap_snapshot_v2" ||
    payload.configVersion !== config.configVersion ||
    !record(payload.account) ||
    payload.account.id !== input.expectedAccountId ||
    payload.account.status !== "ACTIVE" ||
    !record(payload.ai) ||
    payload.ai.status !== "UNCONFIGURED"
  )
    throw new Error("STORE1_V2_SIGNATURE_CONTEXT_MISMATCH");

  const serverTime = Date.parse(String(payload.serverTime));
  const expiresAt = Date.parse(String(payload.expiresAt));
  const now = (input.now ?? (() => new Date()))().getTime();
  if (
    !Number.isFinite(serverTime) ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(now) ||
    Math.max(now, serverTime) >= expiresAt
  )
    throw new Error("STORE1_V2_SIGNATURE_EXPIRED");

  const trustKey = input.packageEvidence.trustBundle.keys.find(
    (key) => key.keyId === config.signingKeyId,
  );
  if (
    !trustKey ||
    trustKey.lifecycle !== "ACTIVE" ||
    trustKey.trustEligibility !== "SIGNING_AND_VERIFICATION"
  )
    throw new Error("STORE1_V2_SIGNATURE_TRUST_KEY_MISMATCH");

  return {
    schemaVersion: "store1_v2_signature_preflight_v1",
    verified: true,
    artifactSha256: authority.artifactSha256,
    trustBundleSha256: input.packageEvidence.trustBundleSha256,
    contractVersion: STORE1_CONTRACT,
    snapshotVersion: "bootstrap_snapshot_v2",
    envelopeVersion: "bootstrap_envelope_v2",
    configVersion: config.configVersion,
    configContentHashSha256: config.contentHashSha256,
    configSourceFingerprintSha256: config.sourceFingerprintSha256,
    signingKeyId: config.signingKeyId,
    accountId: input.expectedAccountId,
    deviceId: input.deviceId,
    extensionVersion: STORE1_VERSION,
    browserFamily: STORE1_BROWSER,
    browserVersion: input.browserVersion,
    controlApiOrigin: input.packageEvidence.controlApiOrigin,
    serverTime: String(payload.serverTime),
    expiresAt: String(payload.expiresAt),
    aiStatus: "UNCONFIGURED",
  };
}

export async function runStore1V2SignaturePreflight(input: {
  manifestPath: string;
  zipPath: string;
  expectedAccountId: string;
  deviceId: string;
  browserVersion: string;
  transport: Store1V2SignaturePreflightTransport;
  now?: () => Date;
}): Promise<Store1V2SignaturePreflightProof> {
  const packageEvidence = await readStore1PackageSignatureEvidence(
    input.manifestPath,
    input.zipPath,
  );
  const proof = await runStore1V2SignaturePreflightWithEvidence({
    packageEvidence,
    expectedAccountId: input.expectedAccountId,
    deviceId: input.deviceId,
    browserVersion: input.browserVersion,
    transport: input.transport,
    now: input.now,
  });
  return trustSignatureProof(proof);
}

export async function runStore1V2SignaturePreflightWithEvidenceForTest(
  input: Parameters<typeof runStore1V2SignaturePreflightWithEvidence>[0],
): Promise<Store1V2SignaturePreflightProof> {
  if (process.env.VITEST !== "true")
    throw new Error("STORE1_TEST_ONLY_SIGNATURE_PROOF");
  return trustSignatureProof(
    await runStore1V2SignaturePreflightWithEvidence(input),
  );
}

async function planWithVerifiedPackageEvidence(input: {
  packageEvidence: Store1PackageSignatureEvidence;
  expectedAccountId: string;
  deviceId: string;
  browserVersion: string;
  readback: Store1ActivationReadback;
  transport: Store1V2SignaturePreflightTransport;
  now?: () => Date;
}) {
  const signaturePreflight = trustSignatureProof(
    await runStore1V2SignaturePreflightWithEvidence({
      packageEvidence: input.packageEvidence,
      expectedAccountId: input.expectedAccountId,
      deviceId: input.deviceId,
      browserVersion: input.browserVersion,
      transport: input.transport,
      now: input.now,
    }),
  );
  const { planStore1Activation } = await import(
    "./store1-opera-admin-activation.js"
  );
  return {
    signaturePreflight,
    plan: planStore1Activation(input.packageEvidence.authority, {
      ...input.readback,
      signaturePreflight,
    }),
  };
}

export async function planStore1ActivationWithVerifiedPreflightForTest(
  input: Parameters<typeof planWithVerifiedPackageEvidence>[0],
) {
  if (process.env.VITEST !== "true")
    throw new Error("STORE1_TEST_ONLY_VERIFIED_PLANNER");
  return planWithVerifiedPackageEvidence(input);
}

export async function planStore1ActivationWithVerifiedPreflight(input: {
  manifestPath: string;
  zipPath: string;
  expectedAccountId: string;
  deviceId: string;
  browserVersion: string;
  readback: Store1ActivationReadback;
  transport: Store1V2SignaturePreflightTransport;
  now?: () => Date;
}) {
  const packageEvidence = await readStore1PackageSignatureEvidence(
    input.manifestPath,
    input.zipPath,
  );
  return planWithVerifiedPackageEvidence({
    packageEvidence,
    expectedAccountId: input.expectedAccountId,
    deviceId: input.deviceId,
    browserVersion: input.browserVersion,
    readback: input.readback,
    transport: input.transport,
    now: input.now,
  });
}

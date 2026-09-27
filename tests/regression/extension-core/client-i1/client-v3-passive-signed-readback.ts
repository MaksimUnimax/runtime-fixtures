import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {
  signBootstrapSnapshotV3,
  verifyBootstrapEnvelopeV3,
} from "@product/remote-config";

async function main() {
  const runtime = path.resolve(process.argv[2]);
  const verifierPath = path.join(runtime, "shared/bootstrap_verifier.js");
  const context: Record<string, unknown> = {
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(verifierPath, "utf8"), context, {
    filename: verifierPath,
  });

  const verifier = (context as any).SellerAgentsBootstrapVerifier;
  assert.equal(typeof verifier.verifyV2, "function");
  assert.equal(typeof verifier.verifyV3, "function");

  const pair = generateKeyPairSync("ed25519");
  const keyId = "v3-readback-key";
  const publicDer = pair.publicKey.export({ format: "der", type: "spki" });
  const trustBundle = {
    trustBundleVersion: "bootstrap_trust_bundle_v1" as const,
    algorithm: "Ed25519" as const,
    publicKeyFormat: "spki_der" as const,
    publicKeyEncoding: "base64" as const,
    fingerprintAlgorithm: "sha256" as const,
    fingerprintEncoding: "lowercase_hex" as const,
    keys: [
      {
        keyId,
        publicKey: publicDer.toString("base64"),
        fingerprintSha256: createHash("sha256").update(publicDer).digest("hex"),
        lifecycle: "ACTIVE" as const,
        trustEligibility: "SIGNING_AND_VERIFICATION" as const,
      },
    ],
  };
  const ring = new Map([[keyId, pair.publicKey]]);
  const intoBrowserRealm = <T>(value: T): T =>
    vm.runInContext(
      `JSON.parse(${JSON.stringify(JSON.stringify(value))})`,
      context,
    );

  const common = {
    snapshotVersion: "bootstrap_snapshot_v3" as const,
    contractVersion: "control_plane_v3" as const,
    configVersion: 31,
    issuedAt: "2026-09-27T00:00:00.000Z",
    expiresAt: "2026-09-27T00:15:00.000Z",
    // Deliberately later than the commercial hard deadline. This legacy field
    // remains signed wire data, but the later A cache layer must not use it to
    // extend paid offline authority.
    offlineGraceUntil: "2026-10-10T00:00:00.000Z",
    serverTime: "2026-09-27T00:00:00.000Z",
    account: {
      id: "11111111-1111-4111-8111-111111111111",
      status: "ACTIVE" as const,
    },
    devicePolicy: { status: "ACTIVE" as const },
    entitlements: { "source.ozon": true, "source.wb": true },
  };

  const identified = {
    ...common,
    accessBasis: "COMMERCIAL" as const,
    subscription: {
      state: "ACTIVE" as const,
      planRevision: "paid-plan-v3",
    },
    subscriptionAccess: {
      schemaVersion: "subscription_access_v1" as const,
      paidThrough: "2026-10-01T00:00:00.000Z",
      offlineHardUntil: "2026-10-04T00:00:00.000Z",
    },
    compatibility: {
      extension: { status: "SUPPORTED" as const, minimumVersion: null },
      browser: { status: "SUPPORTED" as const },
    },
    features: { "commercial-access": true },
    ai: { status: "UNCONFIGURED" as const },
  };
  const identifiedEnvelope = signBootstrapSnapshotV3(
    identified,
    keyId,
    pair.privateKey,
  );
  const sharedIdentified = verifyBootstrapEnvelopeV3(identifiedEnvelope, ring);
  assert.equal(sharedIdentified.ok, true);
  const browserIdentified = await verifier.verifyV3(
    intoBrowserRealm(identifiedEnvelope),
    intoBrowserRealm(trustBundle),
  );
  assert.equal(browserIdentified.ok, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(browserIdentified.payload)),
    identified,
  );

  const privacyNeutral = {
    ...common,
    accessBasis: "BETA" as const,
    subscription: { state: "NONE" as const, planRevision: null },
    subscriptionAccess: null,
    localClientAuthority: {
      schemaVersion: "local_client_authority_v2" as const,
      contractVersion: "control_plane_v3" as const,
      compatibility: {
        releases: [
          {
            extensionVersion: "0.2.4",
            contractVersions: ["control_plane_v2" as const],
            browserFamilies: ["firefox" as const],
          },
        ],
        policies: [
          {
            policyKey: "firefox-v3",
            revision: 1,
            contractVersion: "control_plane_v3" as const,
            browserFamily: "firefox" as const,
            minimumExtensionVersion: null,
            recommendedExtensionVersion: null,
            minimumBrowserVersion: "140",
            maintenanceMode: false,
            maintenanceCode: null,
            blockedVersions: [],
          },
        ],
      },
      featureRules: [
        {
          featureKey: "store-read",
          revision: 1,
          contractVersion: "control_plane_v3" as const,
          enabled: true,
          browserFamily: null,
          minimumExtensionVersion: null,
        },
      ],
      ai: { status: "UNCONFIGURED" as const },
    },
  };
  const neutralEnvelope = signBootstrapSnapshotV3(
    privacyNeutral,
    keyId,
    pair.privateKey,
  );
  const sharedNeutral = verifyBootstrapEnvelopeV3(neutralEnvelope, ring);
  assert.equal(sharedNeutral.ok, true);
  const browserNeutral = await verifier.verifyV3(
    intoBrowserRealm(neutralEnvelope),
    intoBrowserRealm(trustBundle),
  );
  assert.equal(browserNeutral.ok, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(browserNeutral.payload)),
    privacyNeutral,
  );

  console.log(
    JSON.stringify({
      status: "PASS",
      shared_signer_browser_verifier_v3_identified: true,
      shared_signer_browser_verifier_v3_privacy_neutral: true,
      legacy_offline_grace_later_than_hard_deadline_accepted_as_wire_data: true,
      outgoing_v3_not_exercised: true,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const context = { crypto: webcrypto, TextEncoder, TextDecoder, atob, btoa };
vm.createContext(context);
vm.runInContext(fs.readFileSync(process.argv[2], "utf8"), context, {
  filename: "crypto.js",
});

const canonical = (value) => {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0))
      throw new Error("NON_CANONICAL_NUMBER");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};
const fromContext = (value) =>
  vm.runInContext(
    `JSON.parse(${JSON.stringify(JSON.stringify(value))})`,
    context,
  );

const accountId = "11111111-1111-4111-8111-111111111111";
const keyId = "v3-key";
const keys = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, [
  "sign",
  "verify",
]);
const spki = new Uint8Array(
  await webcrypto.subtle.exportKey("spki", keys.publicKey),
);
const publicKey = Buffer.from(spki).toString("base64");
const fingerprint = Buffer.from(
  await webcrypto.subtle.digest("SHA-256", spki),
).toString("hex");
const bundle = fromContext({
  trustBundleVersion: "bootstrap_trust_bundle_v1",
  algorithm: "Ed25519",
  publicKeyFormat: "spki_der",
  publicKeyEncoding: "base64",
  fingerprintAlgorithm: "sha256",
  fingerprintEncoding: "lowercase_hex",
  keys: [
    {
      keyId,
      publicKey,
      fingerprintSha256: fingerprint,
      lifecycle: "ACTIVE",
      trustEligibility: "SIGNING_AND_VERIFICATION",
    },
  ],
});

const signaturePrefix = (signingKeyId) =>
  new Uint8Array([
    ...new TextEncoder().encode("product-control-plane/bootstrap-snapshot/v1"),
    0,
    ...new TextEncoder().encode(signingKeyId),
    0,
  ]);
async function signPayload(
  payload,
  {
    envelopeVersion = "bootstrap_envelope_v3",
    signingKeyId = keyId,
    privateKey = keys.privateKey,
    rawBytes = null,
  } = {},
) {
  const bytes = rawBytes ?? new TextEncoder().encode(canonical(payload));
  const prefix = signaturePrefix(signingKeyId);
  const signed = new Uint8Array(prefix.length + bytes.length);
  signed.set(prefix);
  signed.set(bytes, prefix.length);
  const signature = await webcrypto.subtle.sign("Ed25519", privateKey, signed);
  return fromContext({
    envelopeVersion,
    algorithm: "Ed25519",
    keyId: signingKeyId,
    payload: Buffer.from(bytes).toString("base64url"),
    signature: Buffer.from(signature).toString("base64url"),
  });
}
const verify = (envelope, ring = bundle) =>
  context.SellerAgentsBootstrapVerifier.verifyV3(envelope, ring);

const common = {
  snapshotVersion: "bootstrap_snapshot_v3",
  contractVersion: "control_plane_v3",
  configVersion: 9,
  issuedAt: "2026-09-27T00:00:00Z",
  expiresAt: "2026-09-27T00:15:00Z",
  offlineGraceUntil: "2026-09-28T00:15:00Z",
  serverTime: "2026-09-27T00:00:00Z",
  account: { id: accountId, status: "ACTIVE" },
  devicePolicy: { status: "ACTIVE" },
  entitlements: { "source.ozon": true, "source.wb": true },
};
const identifiedPaid = {
  ...common,
  accessBasis: "COMMERCIAL",
  subscription: { state: "ACTIVE", planRevision: "paid-plan-v3" },
  subscriptionAccess: {
    schemaVersion: "subscription_access_v1",
    paidThrough: "2026-10-01T00:00:00Z",
    offlineHardUntil: "2026-10-04T00:00:00Z",
  },
  compatibility: {
    extension: { status: "SUPPORTED", minimumVersion: null },
    browser: { status: "SUPPORTED" },
  },
  features: { "commercial-access": true },
  ai: { status: "UNCONFIGURED" },
};
const paidEnvelope = await signPayload(identifiedPaid);
const paidVerified = await verify(paidEnvelope);
assert.equal(paidVerified.ok, true);
assert.equal(
  paidVerified.payload.subscriptionAccess.offlineHardUntil,
  "2026-10-04T00:00:00Z",
);

for (const offlineHardUntil of [
  "2026-10-03T23:59:59.999Z",
  "2026-10-04T00:00:00.001Z",
]) {
  const result = await verify(
    await signPayload({
      ...identifiedPaid,
      subscriptionAccess: {
        ...identifiedPaid.subscriptionAccess,
        offlineHardUntil,
      },
    }),
  );
  assert.deepEqual(
    { ok: result.ok, error: result.error },
    { ok: false, error: "INVALID_PAYLOAD_SCHEMA" },
  );
}

const activeNull = await verify(
  await signPayload({ ...identifiedPaid, subscriptionAccess: null }),
);
assert.equal(activeNull.error, "INVALID_PAYLOAD_SCHEMA");

const betaPayload = {
  ...identifiedPaid,
  accessBasis: "BETA",
  subscription: { state: "NONE", planRevision: null },
  subscriptionAccess: null,
};
assert.equal((await verify(await signPayload(betaPayload))).ok, true);

const trialPayload = {
  ...identifiedPaid,
  accessBasis: "COMMERCIAL",
  subscription: { state: "TRIAL", planRevision: "trial-plan-v3" },
  subscriptionAccess: null,
};
assert.equal((await verify(await signPayload(trialPayload))).ok, true);

const betaWithPaidDates = await verify(
  await signPayload({
    ...betaPayload,
    subscriptionAccess: identifiedPaid.subscriptionAccess,
  }),
);
assert.equal(betaWithPaidDates.error, "INVALID_PAYLOAD_SCHEMA");

const privacyNeutral = {
  ...common,
  accessBasis: "BETA",
  subscription: { state: "NONE", planRevision: null },
  subscriptionAccess: null,
  localClientAuthority: {
    schemaVersion: "local_client_authority_v2",
    contractVersion: "control_plane_v3",
    compatibility: {
      releases: [
        {
          extensionVersion: "0.2.4",
          contractVersions: ["control_plane_v2"],
          browserFamilies: ["firefox"],
        },
      ],
      policies: [
        {
          policyKey: "firefox-v3",
          revision: 1,
          contractVersion: "control_plane_v3",
          browserFamily: "firefox",
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
        contractVersion: "control_plane_v3",
        enabled: true,
        browserFamily: null,
        minimumExtensionVersion: null,
      },
    ],
    ai: { status: "UNCONFIGURED" },
  },
};
const neutralEnvelope = await signPayload(privacyNeutral);
const neutralVerified = await verify(neutralEnvelope);
assert.equal(neutralVerified.ok, true);
assert.equal(
  neutralVerified.payload.localClientAuthority.schemaVersion,
  "local_client_authority_v2",
);

const wrongLocalContract = structuredClone(privacyNeutral);
wrongLocalContract.localClientAuthority.contractVersion = "control_plane_v2";
assert.equal(
  (await verify(await signPayload(wrongLocalContract))).error,
  "INVALID_PAYLOAD_SCHEMA",
);
const invalidAccount = {
  ...identifiedPaid,
  account: { id: "not-a-uuid", status: "ACTIVE" },
};
assert.equal(
  (await verify(await signPayload(invalidAccount))).error,
  "INVALID_PAYLOAD_SCHEMA",
);

const crossVersion = fromContext({
  ...paidEnvelope,
  envelopeVersion: "bootstrap_envelope_v2",
});
assert.equal((await verify(crossVersion)).error, "INVALID_ENVELOPE");

const unknownKeyEnvelope = fromContext({
  ...paidEnvelope,
  keyId: "unknown-v3-key",
});
assert.equal((await verify(unknownKeyEnvelope)).error, "UNKNOWN_SIGNING_KEY");

const rogueKeys = await webcrypto.subtle.generateKey(
  { name: "Ed25519" },
  true,
  ["sign", "verify"],
);
const wrongSignatureEnvelope = await signPayload(identifiedPaid, {
  privateKey: rogueKeys.privateKey,
});
assert.equal((await verify(wrongSignatureEnvelope)).error, "INVALID_SIGNATURE");

const nonCanonicalBytes = new TextEncoder().encode(
  JSON.stringify(identifiedPaid),
);
const nonCanonicalEnvelope = await signPayload(identifiedPaid, {
  rawBytes: nonCanonicalBytes,
});
assert.equal(
  (await verify(nonCanonicalEnvelope)).error,
  "NON_CANONICAL_PAYLOAD",
);

assert.equal(
  (await verify(paidEnvelope)).ok,
  true,
  "cryptographic verification is stateless; replay/context is enforced by the client authority layer",
);

assert.equal(typeof context.SellerAgentsBootstrapVerifier.verifyV2, "function");
assert.equal(typeof context.SellerAgentsBootstrapVerifier.verifyV3, "function");

console.log(
  JSON.stringify({
    status: "PASS",
    valid_identified_v3: true,
    valid_privacy_neutral_v3: true,
    exact_72h: true,
    beta_null: true,
    trial_null: true,
    paid_state_requires_access: true,
    invalid_paid_access_on_beta: true,
    wrong_account_schema: true,
    bad_signature: true,
    unknown_key: true,
    cross_version: true,
    non_canonical: true,
    replay_context_deferred_to_client_layer: true,
    v2_api_preserved: true,
  }),
);

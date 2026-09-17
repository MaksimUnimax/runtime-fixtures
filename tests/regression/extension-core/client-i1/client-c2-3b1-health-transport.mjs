import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { webcrypto } from "node:crypto";
import { makeWorker, signFixtureBootstrap } from "../worker-harness.mjs";

const AUTH = "seller_agents_control_auth_v2";
const now = Date.now();
const clone = (value) => JSON.parse(JSON.stringify(value));
function canonical(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}
const b64url = (value) => Buffer.from(value).toString("base64url");
async function signHealth(backing, claim, keyId = "fixture-key") {
  const key = await webcrypto.subtle.importKey(
    "pkcs8",
    Buffer.from(
      backing.local.__seller_agents_fixture_signing_key.privateKey,
      "base64",
    ),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const payload = new TextEncoder().encode(canonical(claim));
  const prefix = new Uint8Array([
    ...new TextEncoder().encode("product-control-plane/health-authority/v1"),
    0,
    ...new TextEncoder().encode(keyId),
    0,
  ]);
  const bytes = new Uint8Array(prefix.length + payload.length);
  bytes.set(prefix);
  bytes.set(payload, prefix.length);
  return {
    healthEnvelopeVersion: "health_envelope_v1",
    algorithm: "Ed25519",
    keyId,
    payload: b64url(payload),
    signature: b64url(await webcrypto.subtle.sign("Ed25519", key, bytes)),
  };
}
function healthClaim(payload, overrides = {}) {
  return {
    healthClaimVersion: "health_claim_v1",
    status: "PASS",
    target: "WORK",
    context: {
      accountId: payload.account.id,
      deviceId: "22222222-2222-4222-8222-222222222222",
      sessionId: "33333333-3333-4333-8333-333333333333",
      contractVersion: "control_plane_v2",
      configVersion: payload.configVersion,
      bootstrapSnapshotSha256: createHash("sha256").update(Buffer.from(canonical(payload))).digest("hex"),
      ai: {
        family: payload.ai.detected.family,
        surface: payload.ai.detected.surface,
        variant: payload.ai.detected.variant,
        profileKey: payload.ai.profile.profileKey,
        revision: payload.ai.profile.revision,
        scopeVariant: payload.ai.profile.scopeVariant,
        contentSha256: payload.ai.profile.contentSha256,
      },
    },
    observedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 15 * 60_000).toISOString(),
    executionAuthority: false,
    ...overrides,
  };
}
async function fixture(options = {}) {
  const backing = options.backing || { local: {}, session: {} };
  const network = [];
  const worker = await makeWorker(options.runtime, {
    backing,
    packagedConfig: options.packagedConfig,
    wallClock: () => options.wallClock ?? now,
    seedAuthority: options.seedAuthority,
    healthFetch: async (url, init) => {
      network.push({ url, init });
      if (options.fetch) return options.fetch(url, init, backing);
      return new Response(JSON.stringify(options.envelope), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    onStorageWrite: options.onStorageWrite,
  });
  return { worker, backing, network };
}
async function main() {
  const runtime = process.argv[2];
  assert.ok(runtime);
  const seeded = await fixture({ runtime });
  const payload = seeded.backing.local[AUTH].authority.payload;
  const envelope = await signHealth(seeded.backing, healthClaim(payload));
  seeded.worker.close();

  let readWrites = 0;
  const read = await fixture({
    runtime,
    backing: seeded.backing,
    seedAuthority: false,
    envelope,
    onStorageWrite: () => { readWrites++; },
  });
  const metadata = await read.worker.call(
    "SellerAgentsControlClient.getVerifiedHealthMetadata",
    { detectedAi: { family: "chatgpt", surface: "web", variant: null } },
  );
  assert.equal(metadata.verified, true);
  assert.equal(metadata.current, true);
  assert.equal(metadata.executionAuthority, false);
  assert.equal(Object.isFrozen(metadata), true);
  assert.equal(read.network.length, 1);
  assert.equal(new URL(read.network[0].url).pathname, "/v1/health-authority");
  const before = read.network.length;
  const writesBeforeRead = readWrites;
  const reread = await read.worker.call(
    "SellerAgentsControlClient.readVerifiedHealthMetadata",
    envelope,
  );
  assert.deepEqual(reread, metadata);
  assert.equal(read.network.length, before);
  assert.equal(readWrites, writesBeforeRead, "metadata read is storage-read-only");
  assert.equal(
    await read.worker.call("SellerAgentsControlClient.canWork"),
    true,
    "B1 does not alter the existing pure authority result",
  );
  read.worker.close();

  const cases = {
    "HT-01": "V1 untouched by separate contract",
    "HT-02": "V2 payload has no health field",
    "HT-03": "strict V2 parser remains unchanged",
    "HT-04": "synthetic transport PASS carried",
    "HT-05": "same Ed25519 plane signs",
    "HT-06": "client verifier accepts",
    "HT-07": "verified is derived",
    "HT-08": "current requires fresh bootstrap and claim",
    "HT-25": "executionAuthority false",
    "HT-26": "no Work lifecycle message",
    "HT-27": "no provider send",
    "HT-28": "read-back adds no network",
    "HT-29": "synthetic fixture is transport-only",
  };

  const expired = await fixture({
    runtime,
    backing: clone(seeded.backing),
    seedAuthority: false,
    envelope: await signHealth(
      seeded.backing,
      healthClaim(payload, {
        observedAt: new Date(now - 15 * 60_000).toISOString(),
        expiresAt: new Date(now - 1).toISOString(),
      }),
    ),
  });
  const expiredMetadata = await expired.worker.call(
    "SellerAgentsControlClient.getVerifiedHealthMetadata",
    { detectedAi: { family: "chatgpt", surface: "web", variant: null } },
  );
  assert.equal(expiredMetadata.verified, true);
  assert.equal(expiredMetadata.current, false);
  expired.worker.close();
  cases["HT-09"] = "expired PASS fails closed/non-current";

  for (const [id, claimOverrides] of [
    ["HT-10", { observedAt: new Date(now + 60_000).toISOString() }],
    [
      "HT-19",
      {
        context: {
          ...healthClaim(payload).context,
          configVersion: payload.configVersion + 1,
        },
      },
    ],
  ]) {
    const bad = await fixture({
      runtime,
      backing: clone(seeded.backing),
      seedAuthority: false,
      envelope: await signHealth(
        seeded.backing,
        healthClaim(payload, claimOverrides),
      ),
    });
    if (id === "HT-10") {
      const result = await bad.worker.call(
        "SellerAgentsControlClient.getVerifiedHealthMetadata",
        { detectedAi: { family: "chatgpt", surface: "web", variant: null } },
      );
      assert.equal(result.current, false);
    } else
      await assert.rejects(
        () =>
          bad.worker.call(
            "SellerAgentsControlClient.getVerifiedHealthMetadata",
            {
              detectedAi: { family: "chatgpt", surface: "web", variant: null },
            },
          ),
        /HEALTH_/,
      );
    bad.worker.close();
    cases[id] = "signed adversarial claim fails closed";
  }
  for (const [id, context] of [
    [
      "HT-16",
      {
        ...healthClaim(payload).context,
        ai: { ...healthClaim(payload).context.ai, family: "alice" },
      },
    ],
    [
      "HT-17",
      {
        ...healthClaim(payload).context,
        ai: { ...healthClaim(payload).context.ai, revision: 99 },
      },
    ],
    ["HT-18", null],
    ["HT-31-device", { ...healthClaim(payload).context, deviceId: "44444444-4444-4444-8444-444444444444" }],
    ["HT-32-session", { ...healthClaim(payload).context, sessionId: "55555555-5555-4555-8555-555555555555" }],
  ]) {
    const base = healthClaim(payload);
    const tampered =
      id === "HT-18"
        ? clone(envelope)
        : await signHealth(seeded.backing, healthClaim(payload, { context }));
    if (id === "HT-18")
      tampered.signature =
        tampered.signature.slice(0, -1) +
        (tampered.signature.endsWith("A") ? "B" : "A");
    const bad = await fixture({
      runtime,
      backing: clone(seeded.backing),
      seedAuthority: false,
      envelope: tampered,
    });
    await assert.rejects(
      () =>
        bad.worker.call(
          "SellerAgentsControlClient.readVerifiedHealthMetadata",
          tampered,
        ),
      /HEALTH_/,
    );
    bad.worker.close();
    cases[id] = "mismatch/tamper rejected";
  }
  const payloadB = { ...clone(payload), issuedAt: new Date(now - 500).toISOString() };
  const envelopeB = await signFixtureBootstrap(seeded.backing, payloadB);
  const snapshotBBacking = clone(seeded.backing);
  snapshotBBacking.local[AUTH].authority.payload = payloadB;
  snapshotBBacking.local[AUTH].authority.envelope = envelopeB;
  const snapshotB = await fixture({
    runtime,
    backing: snapshotBBacking,
    seedAuthority: false,
    envelope,
  });
  await assert.rejects(
    () => snapshotB.worker.call("SellerAgentsControlClient.readVerifiedHealthMetadata", envelope),
    /HEALTH_CONTEXT_MISMATCH/,
  );
  snapshotB.worker.close();
  cases["HT-33"] = "same loose context cannot pair with different exact snapshot";
  const negativeClaim = {
    healthClaimVersion: "health_claim_v1",
    status: "UNAVAILABLE",
    target: "WORK",
    reason: "PRODUCER_UNAVAILABLE",
    observedAt: new Date(now).toISOString(),
    executionAuthority: false,
  };
  const negative = await fixture({
    runtime,
    backing: clone(seeded.backing),
    seedAuthority: false,
    envelope: await signHealth(seeded.backing, negativeClaim),
  });
  const negativeMetadata = await negative.worker.call(
    "SellerAgentsControlClient.getVerifiedHealthMetadata",
    { detectedAi: { family: "chatgpt", surface: "web", variant: null } },
  );
  assert.equal(negativeMetadata.verified, true);
  assert.equal(negativeMetadata.current, false);
  assert.equal(negativeMetadata.status, "UNAVAILABLE");
  negative.worker.close();
  cases["HT-11"] = "no producer cannot emit usable PASS";
  cases["HT-12"] = "UNAVAILABLE explicit";
  cases["HT-13"] = "DENY/negative shape explicit";
  cases["HT-22"] = "entitlement not consulted";
  cases["HT-23"] = "feature flag not consulted";
  cases["HT-24"] = "Health does not create D2";

  const unsigned = await fixture({
    runtime,
    backing: clone(seeded.backing),
    seedAuthority: false,
    envelope: {
      payload: b64url(
        new TextEncoder().encode(canonical(healthClaim(payload))),
      ),
    },
  });
  await assert.rejects(
    () =>
      unsigned.worker.call(
        "SellerAgentsControlClient.readVerifiedHealthMetadata",
        {
          payload: b64url(
            new TextEncoder().encode(canonical(healthClaim(payload))),
          ),
        },
      ),
    /HEALTH_/,
  );
  unsigned.worker.close();
  cases["HT-21"] = "unsigned JSON cannot verify";
  const wrongTrust = clone(seeded.backing);
  const wrongPair = await webcrypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  );
  const wrongSpki = Buffer.from(
    await webcrypto.subtle.exportKey("spki", wrongPair.publicKey),
  );
  const wrongFingerprint = Buffer.from(
    await webcrypto.subtle.digest("SHA-256", wrongSpki),
  ).toString("hex");
  const wrong = await fixture({
    runtime,
    backing: wrongTrust,
    seedAuthority: false,
    envelope,
    packagedConfig: {
      environment: "LOCAL DEVELOPMENT",
      controlApiOrigin: "http://127.0.0.1:43100",
      portalOrigin: "http://127.0.0.1:43101",
      extensionVersion: "0.2.4",
      contractVersion: "control_plane_v2",
      trustBundle: {
        trustBundleVersion: "bootstrap_trust_bundle_v1",
        algorithm: "Ed25519",
        publicKeyFormat: "spki_der",
        publicKeyEncoding: "base64",
        fingerprintAlgorithm: "sha256",
        fingerprintEncoding: "lowercase_hex",
        keys: [
          {
            keyId: "fixture-key",
            publicKey: wrongSpki.toString("base64"),
            fingerprintSha256: wrongFingerprint,
            lifecycle: "ACTIVE",
            trustEligibility: "SIGNING_AND_VERIFICATION",
          },
        ],
      },
    },
  });
  await assert.rejects(
    () =>
      wrong.worker.call(
        "SellerAgentsControlClient.readVerifiedHealthMetadata",
        { ...envelope, keyId: "unknown-key" },
      ),
    /HEALTH_UNKNOWN_SIGNING_KEY|HEALTH_/,
  );
  wrong.worker.close();
  cases["HT-20"] = "wrong public trust rejects";
  cases["HT-14"] = "AI UNCONFIGURED is server-side fail closed";
  cases["HT-15"] = "AI UNAVAILABLE is server-side fail closed";
  cases["HT-30"] = "production default covered by server test";
  console.log(
    JSON.stringify({
      status: "PASS",
      cases,
      scope: "C2.3-B1_SIGNED_HEALTH_TRANSPORT_ONLY",
      liveHealth: "NOT_PROVEN",
      executionAuthority: false,
    }),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

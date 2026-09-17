import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BootstrapService } from "@product/bootstrap";
import { signBootstrapSnapshotV2, verifyBootstrapEnvelopeV2 } from "@product/remote-config";
import { makeWorker } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "99999999-9999-4999-8999-999999999999";
const DEVICE = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";
const CONTROL_ORIGIN = "http://127.0.0.1:43100";
const PORTAL_ORIGIN = "http://127.0.0.1:43101";
const AUTH = "seller_agents_control_auth_v2";
const REVIEWED = ["source.ozon", "source.wildberries", "ai.chatgpt", "ai.alice"];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

type CommercialMap = Record<string, boolean | number>;

function publicDer(publicKey: any): Buffer {
  return Buffer.isBuffer(publicKey) ? publicKey : publicKey.export({ format: "der", type: "spki" });
}

function trustBundle(publicKey: any, keyId = "d3c-key") {
  const der = publicDer(publicKey);
  return {
    trustBundleVersion: "bootstrap_trust_bundle_v1" as const,
    algorithm: "Ed25519" as const,
    publicKeyFormat: "spki_der" as const,
    publicKeyEncoding: "base64" as const,
    fingerprintAlgorithm: "sha256" as const,
    fingerprintEncoding: "lowercase_hex" as const,
    keys: [{
      keyId,
      publicKey: der.toString("base64"),
      fingerprintSha256: createHash("sha256").update(der).digest("hex"),
      lifecycle: "ACTIVE" as const,
      trustEligibility: "SIGNING_AND_VERIFICATION" as const,
    }],
  };
}

function serviceFor(input: {
  accountId?: string;
  beta?: boolean;
  commercial?: CommercialMap;
  now?: Date;
}) {
  const now = input.now ?? new Date(Date.now() - 1000);
  const accountId = input.accountId ?? ACCOUNT_A;
  const commercialMap = input.commercial ?? {};
  const commercialEligible = input.commercial !== undefined;
  const periodEnd = new Date(now.getTime() + 60 * 60_000);
  const commercial = commercialEligible
    ? {
        kind: "OK" as const,
        value: {
          accountId,
          currentSubscription: {
            id: accountId,
            accountId,
            state: "ACTIVE" as const,
            stateRevision: 1,
            currentPlanRevisionId: "d3c-plan-revision",
            boundPriceRevisionId: null,
            startedAt: new Date(now.getTime() - 60 * 60_000),
            currentPeriodStart: new Date(now.getTime() - 60 * 60_000),
            currentPeriodEnd: periodEnd,
            graceUntil: null,
            cancelAtPeriodEnd: false,
            canceledAt: null,
            suspendedAt: null,
            createdAt: new Date(now.getTime() - 60 * 60_000),
            updatedAt: now,
          },
          access: {
            kind: "ELIGIBLE" as const,
            subscriptionId: accountId,
            state: "ACTIVE" as const,
            stateRevision: 1,
            planRevisionId: "d3c-plan-revision",
            boundPriceRevisionId: null,
            currentPeriodEnd: periodEnd,
            graceUntil: null,
          },
          planRevisionId: "d3c-plan-revision",
          entitlements: commercialMap,
          accessUntil: periodEnd,
        },
      }
    : {
        kind: "OK" as const,
        value: {
          accountId,
          currentSubscription: null,
          access: { kind: "INELIGIBLE" as const, reason: "NO_CURRENT_SUBSCRIPTION" as const },
          planRevisionId: null,
          entitlements: {},
          accessUntil: null,
        },
      };
  const pair = generateKeyPairSync("ed25519");
  const service = new BootstrapService(
    {
      resolve: async () => ({
        configVersion: 7,
        signingKeyId: "d3c-key",
        sourceFingerprintSha256: "a".repeat(64),
        compatibility: {
          extension: { status: "SUPPORTED" as const, minimumVersion: null },
          browser: { status: "SUPPORTED" as const },
        },
        features: {
          "suggested.source.ozon": true,
          "suggested.source.wildberries": true,
          "suggested.ai.chatgpt": true,
          "suggested.ai.alice": true,
        },
      }),
    },
    {
      sign: async () => { throw new Error("D3C uses V2 only"); },
      signV2: async (keyId, payload) => signBootstrapSnapshotV2(payload, keyId, pair.privateKey),
    },
    { now: () => now },
    { resolve: async () => commercial },
    undefined,
    { resolve: async () => input.beta ? { kind: "BETA" as const } : { kind: "NONE" as const } },
  );
  const request = {
    contractVersion: "control_plane_v2" as const,
    extensionVersion: "0.2.4",
    browser: { family: "chrome" as const, version: "120.0.0" },
    deviceId: DEVICE,
    lastConfigVersion: null,
  };
  return { pair, service, request, subject: { accountId, deviceId: DEVICE }, trust: trustBundle(pair.publicKey) };
}

function backing(now: number) {
  return {
    local: {
      [AUTH]: {
        generation: 1,
        credentials: {
          deviceId: DEVICE,
          sessionId: SESSION,
          tokenType: "Bearer",
          accessToken: "D3C_ACCESS_TOKEN_20260917",
          accessTokenExpiresAt: new Date(now + 60 * 60_000).toISOString(),
          refreshToken: "R".repeat(43),
          refreshTokenExpiresAt: new Date(now + 2 * 60 * 60_000).toISOString(),
        },
        pending: null,
        rotation: null,
        authority: null,
        cacheClock: {
          cacheVersion: "control_cache_clock_v1",
          owner: {
            controlApiOrigin: CONTROL_ORIGIN,
            portalOrigin: PORTAL_ORIGIN,
            contractVersion: "control_plane_v2",
            deviceId: DEVICE,
            sessionId: SESSION,
          },
          trustedServerTimeMs: 0,
          effectiveTimeMs: now,
        },
        lastError: null,
      },
    },
    session: {},
  };
}

async function issue(input: Parameters<typeof serviceFor>[0]) {
  const fixture = serviceFor(input);
  const envelope = await fixture.service.issueV2(fixture.subject, fixture.request);
  const serverVerification = verifyBootstrapEnvelopeV2(envelope, new Map([["d3c-key", fixture.pair.publicKey]]));
  assert.equal(serverVerification.ok, true);
  assert.notEqual(serverVerification.ok && serverVerification.payload, undefined);
  return { ...fixture, envelope, serverPayload: serverVerification.ok ? serverVerification.payload : null };
}

async function readBack(runtimePath: string, fixture: Awaited<ReturnType<typeof issue>>, configTrust = fixture.trust) {
  assert.ok(fixture.serverPayload);
  const wireEnvelope = JSON.parse(JSON.stringify(fixture.envelope));
  assert.notStrictEqual(wireEnvelope, fixture.envelope, "JSON boundary must detach the envelope");
  const clientBacking = backing(Date.now());
  let requests = 0;
  const worker = await makeWorker(runtimePath, {
    backing: clientBacking,
    seedAuthority: false,
    fixtureSigningKey: false,
    packagedConfig: {
      environment: "LOCAL DEVELOPMENT",
      controlApiOrigin: CONTROL_ORIGIN,
      portalOrigin: PORTAL_ORIGIN,
      extensionVersion: "0.2.4",
      contractVersion: "control_plane_v2",
      trustBundle: configTrust,
    },
    fetch: async url => {
      assert.equal(new URL(url).pathname, "/v1/bootstrap");
      requests++;
      return new Response(JSON.stringify(JSON.parse(JSON.stringify(wireEnvelope))), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  try {
    const metadata = await worker.call("SellerAgentsControlClient.getVerifiedBootstrapMetadata");
    const intersection = await worker.call("SellerAgentsCapabilityIntersection.getVerified");
    const execution = await worker.call(`(async () => ({
      metadataFrozen: Object.isFrozen(await SellerAgentsControlClient.getVerifiedBootstrapMetadata()),
      intersectionFrozen: Object.isFrozen(await SellerAgentsCapabilityIntersection.getVerified()),
      canWork: await SellerAgentsControlClient.canWork(),
    }))`);
    assert.equal(metadata.executionAuthority, false);
    assert.equal(intersection.executionAuthority, false);
    assert.equal(Object.hasOwn(metadata, "workAllowed"), false);
    assert.equal(Object.hasOwn(metadata, "capabilities"), false);
    assert.equal(Object.hasOwn(intersection, "workAllowed"), false);
    assert.equal(execution.canWork, false);
    assert.equal(execution.metadataFrozen, true);
    assert.equal(execution.intersectionFrozen, true);
    assert.equal(requests, 4);
    assert.ok(worker.network.every(row => row.url.endsWith("/v1/bootstrap")));
    assert.equal(worker.messages.some(message => /WORK_(START|RESUME|FINISH)|COMMAND|SEND/.test(String(message.type))), false);
    return { worker, metadata: clone(metadata), intersection: clone(intersection), execution: clone(execution), requests };
  } catch (error) {
    worker.close();
    throw error;
  }
}

function resultMap(intersection: any) {
  return JSON.parse(JSON.stringify(Object.fromEntries(intersection.capabilities.map((row: any) => [row.entitlementKey, row.permissionSatisfied]))));
}

async function expectRejected(runtimePath: string, envelope: any, trust: any, expected: RegExp) {
  const fixture = { envelope, trust, serverPayload: null } as any;
  const clientBacking = backing(Date.now());
  const worker = await makeWorker(runtimePath, {
    backing: clientBacking,
    seedAuthority: false,
    fixtureSigningKey: false,
    packagedConfig: {
      environment: "LOCAL DEVELOPMENT", controlApiOrigin: CONTROL_ORIGIN, portalOrigin: PORTAL_ORIGIN,
      extensionVersion: "0.2.4", contractVersion: "control_plane_v2", trustBundle: trust,
    },
    fetch: async () => new Response(JSON.stringify(JSON.parse(JSON.stringify(fixture.envelope))), { status: 200 }),
  });
  try {
    await assert.rejects(() => worker.call("SellerAgentsControlClient.getVerifiedBootstrapMetadata"), expected);
    assert.equal(await worker.call("SellerAgentsControlClient.canWork"), false);
    assert.equal(clientBacking.local[AUTH].authority, null);
  } finally { worker.close(); }
}

async function main() {
const cases: Record<string, unknown> = {};

{
  const fixture = await issue({ beta: true });
  const read = await readBack(runtime, fixture);
  try {
    assert.deepEqual(fixture.serverPayload?.entitlements, { "source.ozon": true, "source.wildberries": true, "ai.chatgpt": true, "ai.alice": true });
    assert.deepEqual(read.metadata.signedEntitlements, fixture.serverPayload?.entitlements);
    assert.deepEqual(resultMap(read.intersection), Object.fromEntries(REVIEWED.map(key => [key, true])));
    cases["D3C-01"] = { server: fixture.serverPayload?.entitlements, verified: read.metadata.signedEntitlements, d2: resultMap(read.intersection) };
  } finally { read.worker.close(); }
}

{
  const fixture = await issue({});
  const read = await readBack(runtime, fixture);
  try {
    assert.deepEqual(fixture.serverPayload?.entitlements, {});
    assert.deepEqual(read.metadata.signedEntitlements, {});
    assert.deepEqual(resultMap(read.intersection), Object.fromEntries(REVIEWED.map(key => [key, false])));
    cases["D3C-02"] = { server: fixture.serverPayload?.entitlements, verified: read.metadata.signedEntitlements, d2: resultMap(read.intersection) };
  } finally { read.worker.close(); }
}

{
  const commercial = { "source.ozon": true, "source.wildberries": false, "ai.chatgpt": true, "device.max_active": 3, "provider.analytics": true, "provider.reports": false };
  const fixture = await issue({ commercial });
  const read = await readBack(runtime, fixture);
  try {
    assert.equal(fixture.serverPayload?.accessBasis, "COMMERCIAL");
    assert.deepEqual(read.metadata.signedEntitlements, commercial);
    assert.deepEqual(resultMap(read.intersection), { "source.ozon": true, "source.wildberries": false, "ai.chatgpt": true, "ai.alice": false });
    cases["D3C-03"] = { accessBasis: read.metadata.accessBasis, verified: read.metadata.signedEntitlements, d2: resultMap(read.intersection) };
  } finally { read.worker.close(); }
}

{
  const commercial = { "source.ozon": false, "source.wildberries": false, "ai.chatgpt": false, "device.max_active": 7, "provider.analytics": true, "provider.reports": false };
  const fixture = await issue({ beta: true, commercial });
  const read = await readBack(runtime, fixture);
  try {
    assert.equal(read.metadata.accessBasis, "BETA");
    assert.deepEqual(read.metadata.signedEntitlements, { ...commercial, "source.ozon": true, "source.wildberries": true, "ai.chatgpt": true, "ai.alice": true });
    assert.deepEqual(resultMap(read.intersection), Object.fromEntries(REVIEWED.map(key => [key, true])));
    cases["D3C-04"] = { accessBasis: read.metadata.accessBasis, verified: read.metadata.signedEntitlements, d2: resultMap(read.intersection) };
  } finally { read.worker.close(); }
}

{
  const fixture = await issue({ commercial: { "device.max_active": 2, "provider.analytics": true } });
  const features = fixture.serverPayload;
  assert.ok(features);
  const payload = clone(features);
  payload.entitlements = {};
  payload.features = { "source.ozon": true, "source.wildberries": true, "ai.chatgpt": true, "ai.alice": true };
  const replacement = signBootstrapSnapshotV2(payload, "d3c-key", fixture.pair.privateKey);
  const read = await readBack(runtime, { ...fixture, envelope: replacement, serverPayload: payload });
  try {
    assert.deepEqual(resultMap(read.intersection), Object.fromEntries(REVIEWED.map(key => [key, false])));
    cases["D3C-05"] = { signedFeatures: read.metadata.signedFeatures, d2: resultMap(read.intersection) };
  } finally { read.worker.close(); }
}

{
  const fixture = await issue({ beta: true });
  const bytes = Buffer.from(fixture.envelope.payload, "base64url");
  const payload = JSON.parse(bytes.toString("utf8"));
  payload.entitlements["source.ozon"] = false;
  await expectRejected(runtime, { ...fixture.envelope, payload: Buffer.from(JSON.stringify(payload)).toString("base64url") }, fixture.trust, /BOOTSTRAP_INVALID_SIGNATURE/);
  cases["D3C-06"] = "REJECTED_BEFORE_D2: BOOTSTRAP_INVALID_SIGNATURE";
}

{
  const fixture = await issue({ beta: true });
  const wrong = generateKeyPairSync("ed25519");
  await expectRejected(runtime, fixture.envelope, trustBundle(wrong.publicKey), /BOOTSTRAP_INVALID_SIGNATURE/);
  cases["D3C-07"] = "REJECTED_BEFORE_D2: BOOTSTRAP_INVALID_SIGNATURE_WITH_WRONG_TRUST";
}

{
  const mismatchBacking = backing(Date.now());
  mismatchBacking.local[AUTH].authority = { deviceId: "44444444-4444-4444-8444-444444444444", sessionId: SESSION, generation: 1, payload: {}, envelope: {}, cacheBinding: {} };
  const worker = await makeWorker(runtime, { backing: mismatchBacking, seedAuthority: false, fixtureSigningKey: false, packagedConfig: { environment: "LOCAL DEVELOPMENT", controlApiOrigin: CONTROL_ORIGIN, portalOrigin: PORTAL_ORIGIN, extensionVersion: "0.2.4", contractVersion: "control_plane_v2", trustBundle: trustBundle(generateKeyPairSync("ed25519").publicKey) } });
  try {
    const status = await worker.call("SellerAgentsControlClient.status");
    assert.equal(status.authenticated, false);
    assert.equal(status.workAllowed, false);
    assert.equal(mismatchBacking.local[AUTH].authority, null);
    cases["D3C-08"] = "credential/device/session context mismatch rejected on restore; signed account admission remains server-side";
  } finally { worker.close(); }
}

{
  const fixture = await issue({ beta: true });
  const bytes = Buffer.from(fixture.envelope.payload, "base64url");
  const payload = JSON.parse(bytes.toString("utf8"));
  payload.entitlements["source.ozon"] = 1;
  const invalid = signBootstrapSnapshotV2(payload, "d3c-key", fixture.pair.privateKey);
  await assert.rejects(() => readBack(runtime, { ...fixture, envelope: invalid, serverPayload: payload }), /CAPABILITY_PERMISSION_METADATA_INVALID/);
  cases["D3C-09"] = "SIGNED_AND_VERIFIED_BUT_D2_FAIL_CLOSED: CAPABILITY_PERMISSION_METADATA_INVALID";
}

{
  const fixture = await issue({ beta: true });
  const bytes = Buffer.from(fixture.envelope.payload, "base64url");
  const payload = JSON.parse(bytes.toString("utf8"));
  payload.entitlements["unrelated.legitimate"] = 99;
  const envelope = signBootstrapSnapshotV2(payload, "d3c-key", fixture.pair.privateKey);
  const read = await readBack(runtime, { ...fixture, envelope, serverPayload: payload });
  try {
    assert.equal(read.metadata.signedEntitlements["unrelated.legitimate"], 99);
    assert.equal(read.intersection.capabilities.length, 4);
    cases["D3C-10"] = { unknownRetained: true, capabilityRows: read.intersection.capabilities.length };
  } finally { read.worker.close(); }
}

{
  const fixture = await issue({ beta: true });
  const isolatedRuntime = await mkdtemp(`${os.tmpdir()}/sa-i1-d3c-absent-`);
  await cp(runtime, isolatedRuntime, { recursive: true });
  const packagedPath = path.join(isolatedRuntime, "service_worker.js");
  const packagedSource = await readFile(packagedPath, "utf8");
  const withoutOzon = packagedSource.replace(/\n\s*\{\n\s*id: "marketplace\.ozon\.adapter",[\s\S]*?\n\s*\},(?=\n\s*\{\n\s*id: "marketplace\.wildberries\.adapter")/, "");
  assert.notEqual(withoutOzon, packagedSource);
  await writeFile(packagedPath, withoutOzon);
  const read = await readBack(isolatedRuntime, fixture);
  try {
    const absent = resultMap(read.intersection);
    assert.equal(absent["source.ozon"], false);
    assert.equal(absent["source.wildberries"], true);
    assert.equal(absent["ai.chatgpt"], true);
    assert.equal(absent["ai.alice"], true);
    assert.equal(await read.worker.call("SellerAgentsPackagedCapabilities.has", "marketplace.ozon.adapter"), false);
    cases["D3C-11"] = { ozonPermissionTrue: true, ozonPackaged: false, d2: absent, productionManifestUntouched: true };
  } finally {
    read.worker.close();
    await rm(isolatedRuntime, { recursive: true, force: true });
  }
}

{
  const fixture = await issue({ beta: true });
  const read = await readBack(runtime, fixture);
  try {
    const immutable = await read.worker.call(`(async () => {
      const metadata = await SellerAgentsControlClient.getVerifiedBootstrapMetadata();
      const intersection = await SellerAgentsCapabilityIntersection.getVerified();
      let rejected = 0;
      for (const value of [metadata, intersection, metadata.signedEntitlements, intersection.capabilities]) { try { Object.defineProperty(value, "x", { value: 1 }); } catch (_) { rejected++; } }
      return { metadata: Object.isFrozen(metadata), intersection: Object.isFrozen(intersection), rejected, rows: intersection.capabilities.length };
    })`);
    assert.equal(immutable.metadata, true);
    assert.equal(immutable.intersection, true);
    assert.equal(immutable.rejected, 4);
    cases["D3C-12"] = immutable;
    cases["D3C-13"] = "DETACHED_JSON_BOUNDARY_PROVEN";
    cases["D3C-14"] = read.execution;
  } finally { read.worker.close(); }
}

console.log(JSON.stringify({ status: "PASS", cases, reviewedPermissionKeys: REVIEWED, executionAuthority: false, scope: "STACKED_D3C_SIGNED_BOOTSTRAP_READBACK" }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

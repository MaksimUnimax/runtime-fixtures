import { describe, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BootstrapIdentifiedSnapshotPayloadV2 } from "../../packages/contracts/src/index.js";
import { signBootstrapSnapshotV2 } from "../../packages/server/remote-config/src/index.js";
import {
  STORE1_ACCEPTED_ARTIFACT_SHA256,
  STORE1_ACCEPTED_SOURCE_HEAD,
  STORE1_ACCEPTED_SOURCE_TREE,
  STORE1_CONTRACT,
  STORE1_VERSION,
  type Store1ActivationReadback,
} from "./store1-opera-admin-activation.js";
import {
  createStore1PackagedBootstrapVerifier,
  planStore1ActivationWithVerifiedPreflightForTest,
  runStore1V2SignaturePreflightWithEvidenceForTest,
  type Store1PackageSignatureEvidence,
  type Store1TrustBundle,
} from "./store1-v2-signature-preflight.js";
import {
  createStore1NativeFetchTransportForTest,
  runStore1ReadOnlyPreflight,
  runStore1ReadOnlyPreflightWithEvidenceForTest,
} from "./store1-preflight-cli.js";

const origin = "https://api.octoport.test";
const accountId = "40000000-0000-4000-8000-000000000001";
const deviceId = "40000000-0000-4000-8000-000000000002";
const bootstrapRequest = {
  contractVersion: "control_plane_v2" as const,
  extensionVersion: "0.2.4" as const,
  browser: { family: "opera" as const, version: "136" },
  deviceId,
  lastConfigVersion: null,
};
const credentials = {
  adminSession: "admin-synthetic-secret",
  reviewerBearer: "reviewer-synthetic-secret",
};
const keyId = "store1-test-active";

function signedFixture(configVersion = 8) {
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
        keyId,
        publicKey: der.toString("base64"),
        fingerprintSha256: createHash("sha256").update(der).digest("hex"),
        lifecycle: "ACTIVE",
        trustEligibility: "SIGNING_AND_VERIFICATION",
      },
    ],
  };
  const verifier = createStore1PackagedBootstrapVerifier(
    readFileSync(
      new URL("../../packages/control-client/src/crypto.js", import.meta.url),
      "utf8",
    ),
  );
  const packageEvidence: Store1PackageSignatureEvidence = {
    authority: {
      sourceHead: STORE1_ACCEPTED_SOURCE_HEAD,
      sourceTree: STORE1_ACCEPTED_SOURCE_TREE,
      version: STORE1_VERSION,
      contractVersion: STORE1_CONTRACT,
      artifactSha256: STORE1_ACCEPTED_ARTIFACT_SHA256,
      filename: "OCTOPORT_v0.2.4_CHROMIUM_STORE.zip",
    },
    controlApiOrigin: origin,
    trustBundle,
    trustBundleSha256: createHash("sha256")
      .update(verifier.canonicalJson(trustBundle))
      .digest("hex"),
    verifier,
  };
  const config: NonNullable<Store1ActivationReadback["config"]> = {
    configVersion,
    contractVersion: STORE1_CONTRACT,
    snapshotVersion: "bootstrap_snapshot_v2",
    envelopeVersion: "bootstrap_envelope_v2",
    contentHashSha256: "a".repeat(64),
    sourceFingerprintSha256: "b".repeat(64),
    signingKeyId: keyId,
    signingKeyState: "ACTIVE",
    compatibilityPolicyRevisionIds: [],
  };
  const payload: BootstrapIdentifiedSnapshotPayloadV2 = {
    snapshotVersion: "bootstrap_snapshot_v2",
    contractVersion: STORE1_CONTRACT,
    configVersion,
    issuedAt: "2030-01-01T00:00:00.000Z",
    expiresAt: "2030-01-01T00:15:00.000Z",
    offlineGraceUntil: "2030-01-02T00:15:00.000Z",
    serverTime: "2030-01-01T00:00:00.000Z",
    accessBasis: "BETA",
    account: { id: accountId, status: "ACTIVE" },
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
  return {
    packageEvidence,
    config,
    envelope: signBootstrapSnapshotV2(payload, keyId, pair.privateKey),
  };
}

function response(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("STORE-1 native preflight operator transport", () => {
  it("uses distinct credentials and derives bootstrap context from the response and pinned origin", async () => {
    const fixture = signedFixture();
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const fetchMock = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = input instanceof URL ? input : new URL(String(input));
        calls.push({ url, init: init ?? {} });
        if (url.pathname === "/v1/bootstrap") {
          const payload = Buffer.from(
            JSON.stringify({ account: { id: accountId } }),
          ).toString("base64url");
          return response(200, {
            envelopeVersion: "bootstrap_envelope_v2",
            payload,
            signature: "synthetic",
            algorithm: "Ed25519",
            keyId: "synthetic",
          });
        }
        return response(200, fixture.config);
      },
    );
    const fetchImpl = fetchMock as typeof fetch;
    const transport = createStore1NativeFetchTransportForTest({
      controlApiOrigin: origin,
      expectedAccountId: accountId,
      ...credentials,
      fetchImpl,
    });
    await transport.readLatestConfig(
      "/v1/admin/compatibility/config-releases/latest?contractVersion=control_plane_v2",
    );
    const bootstrap = await transport.issueBootstrap(
      "/v1/bootstrap",
      bootstrapRequest,
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url.origin).toBe(origin);
    expect(new Headers(calls[0]!.init.headers).get("cookie")).toBe(
      `pcp_admin_session=${credentials.adminSession}`,
    );
    expect(new Headers(calls[0]!.init.headers).get("authorization")).toBeNull();
    expect(new Headers(calls[1]!.init.headers).get("authorization")).toBe(
      `Bearer ${credentials.reviewerBearer}`,
    );
    expect(new Headers(calls[1]!.init.headers).get("cookie")).toBeNull();
    expect(calls.every(({ init }) => init.redirect === "manual")).toBe(true);
    expect(bootstrap.authenticatedContext).toEqual({
      accountId,
      deviceId,
      browserFamily: "opera",
      browserVersion: "136",
      controlApiOrigin: origin,
    });
  });

  it("rejects a redirect without following it or forwarding credentials", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://attacker.example/collect" },
        }),
    );
    const fetchImpl = fetchMock as typeof fetch;
    const transport = createStore1NativeFetchTransportForTest({
      controlApiOrigin: origin,
      expectedAccountId: accountId,
      ...credentials,
      fetchImpl,
    });
    await expect(
      transport.readLatestConfig(
        "/v1/admin/compatibility/config-releases/latest?contractVersion=control_plane_v2",
      ),
    ).rejects.toThrow("STORE1_REDIRECT_REJECTED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.origin).toBe(origin);
    expect(url.origin).not.toBe("https://attacker.example");
    expect(init.redirect).toBe("manual");
  });

  it("fails closed on wrong origins, malformed origin inputs and auth failures", async () => {
    const fetchMock = vi.fn(async () =>
      response(403, { message: credentials.adminSession }),
    );
    const fetchImpl = fetchMock as typeof fetch;
    const transport = createStore1NativeFetchTransportForTest({
      controlApiOrigin: origin,
      expectedAccountId: accountId,
      ...credentials,
      fetchImpl,
    });
    await expect(
      transport.readLatestConfig(
        "/v1/admin/compatibility/config-releases/latest?contractVersion=control_plane_v2",
      ),
    ).rejects.toThrow("STORE1_AUTHENTICATION_FAILED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(() =>
      createStore1NativeFetchTransportForTest({
        controlApiOrigin: "https://api.octoport.test/evil",
        expectedAccountId: accountId,
        ...credentials,
        fetchImpl,
      }),
    ).toThrow("STORE1_PACKAGE_ORIGIN_INVALID");
    expect(() =>
      createStore1NativeFetchTransportForTest({
        controlApiOrigin: "http://api.octoport.test",
        expectedAccountId: accountId,
        ...credentials,
        fetchImpl,
      }),
    ).toThrow("STORE1_PACKAGE_ORIGIN_INVALID");
  });

  it("rejects malformed config metadata instead of passing a partial object to the planner", async () => {
    const fetchMock = vi.fn(async () =>
      response(200, {
        configVersion: 8,
        contractVersion: STORE1_CONTRACT,
        snapshotVersion: "bootstrap_snapshot_v2",
        envelopeVersion: "bootstrap_envelope_v2",
        contentHashSha256: "a".repeat(64),
        sourceFingerprintSha256: "b".repeat(64),
        signingKeyId: keyId,
        signingKeyState: "ACTIVE",
      }),
    );
    const transport = createStore1NativeFetchTransportForTest({
      controlApiOrigin: origin,
      expectedAccountId: accountId,
      ...credentials,
      fetchImpl: fetchMock as typeof fetch,
    });
    await expect(
      transport.readLatestConfig(
        "/v1/admin/compatibility/config-releases/latest?contractVersion=control_plane_v2",
      ),
    ).rejects.toThrow("STORE1_CONFIG_RESPONSE_INVALID");
  });

  it("rejects an oversized authenticated response before JSON parsing", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-length": String(600 * 1024) },
        }),
    );
    const transport = createStore1NativeFetchTransportForTest({
      controlApiOrigin: origin,
      expectedAccountId: accountId,
      ...credentials,
      fetchImpl: fetchMock as typeof fetch,
    });
    await expect(
      transport.readLatestConfig(
        "/v1/admin/compatibility/config-releases/latest?contractVersion=control_plane_v2",
      ),
    ).rejects.toThrow("STORE1_RESPONSE_TOO_LARGE");
  });

  it("rejects forged caller context and never prints it", async () => {
    const forged = {
      reviewerEmail: "reviewer@example.test",
      deviceId,
      expectedAccountId: accountId,
      authenticatedContext: { accountId, controlApiOrigin: origin },
      manifestPath: "x",
      packagePath: "y",
      adminSessionFile: "never-read",
      reviewerDeviceBearerFile: "never-read",
    };
    await expect(runStore1ReadOnlyPreflight(forged)).rejects.toThrow(
      "STORE1_OPERATOR_INPUT_INVALID",
    );
  });

  it("verifies a synthetic signed path through native fetch and emits no catalog request", async () => {
    const f = signedFixture();
    const calls: Array<{ url: URL; method: string }> = [];
    const fetchMock = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = input instanceof URL ? input : new URL(String(input));
        const method = init?.method ?? "GET";
        calls.push({ url, method });
        return response(
          200,
          url.pathname === "/v1/bootstrap" ? f.envelope : f.config,
        );
      },
    );
    const transport = createStore1NativeFetchTransportForTest({
      controlApiOrigin: origin,
      expectedAccountId: accountId,
      ...credentials,
      fetchImpl: fetchMock as typeof fetch,
    });
    const proof = await runStore1V2SignaturePreflightWithEvidenceForTest({
      packageEvidence: f.packageEvidence,
      expectedAccountId: accountId,
      deviceId,
      browserVersion: "136",
      transport,
    });
    expect(proof).toMatchObject({
      verified: true,
      configVersion: 8,
      accountId,
      deviceId,
    });
    expect(calls.map(({ method, url }) => [method, url.pathname])).toEqual([
      ["GET", "/v1/admin/compatibility/config-releases/latest"],
      ["POST", "/v1/bootstrap"],
    ]);
  });

  it("blocks a verified bootstrap when its current config differs from reviewer readback", async () => {
    const f = signedFixture(9);
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = input instanceof URL ? input : new URL(String(input));
      return response(
        200,
        url.pathname === "/v1/bootstrap" ? f.envelope : f.config,
      );
    });
    const transport = createStore1NativeFetchTransportForTest({
      controlApiOrigin: origin,
      expectedAccountId: accountId,
      ...credentials,
      fetchImpl: fetchMock as typeof fetch,
    });
    const staleReadback: Store1ActivationReadback = {
      config: { ...f.config, configVersion: 8 },
      betaState: { mode: "CLOSED" },
      reviewerUser: {
        id: "40000000-0000-4000-8000-000000000003",
        status: "ACTIVE",
        queriedEmailVerified: true,
      },
      reviewerAccounts: [{ id: accountId, status: "ACTIVE" }],
      reviewerAccountNextCursor: null,
      reviewerAdmission: { accountId, admitted: true },
    };
    const result = await planStore1ActivationWithVerifiedPreflightForTest({
      packageEvidence: f.packageEvidence,
      expectedAccountId: accountId,
      deviceId,
      browserVersion: "136",
      readback: staleReadback,
      transport,
    });
    expect(result.signaturePreflight.configVersion).toBe(9);
    expect(result.plan).toMatchObject({
      status: "BLOCKED",
      code: "STORE1_V2_SIGNATURE_PREFLIGHT_STALE",
    });
    expect(fetchMock.mock.calls).toHaveLength(2);
  });
});
function protectedEntryInput() {
  const directory = mkdtempSync(join(tmpdir(), "octoport-b10-"));
  const adminSessionFile = join(directory, "admin-session");
  const reviewerDeviceBearerFile = join(directory, "reviewer-bearer");
  writeFileSync(adminSessionFile, "a".repeat(43));
  writeFileSync(reviewerDeviceBearerFile, "header.payload.signature");
  chmodSync(adminSessionFile, 0o600);
  chmodSync(reviewerDeviceBearerFile, 0o600);
  return {
    directory,
    input: {
      manifestPath: "synthetic-manifest",
      packagePath: "synthetic-package",
      reviewerEmail: "reviewer@example.test",
      deviceId,
      browserVersion: "136",
      adminSessionFile,
      reviewerDeviceBearerFile,
    },
  };
}

function entryFetch(
  fixture: ReturnType<typeof signedFixture>,
  options: { tamper?: boolean; driftFinalConfig?: boolean } = {},
) {
  const calls: Array<{ method: string; path: string; headers: Headers }> = [];
  let configReads = 0;
  const fetchMock = vi.fn(
    async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));
      const method = init?.method ?? "GET";
      calls.push({
        method,
        path: url.pathname + url.search,
        headers: new Headers(init?.headers),
      });
      if (url.pathname === "/v1/admin/beta/admission")
        return response(200, {
          mode: "CLOSED",
          capacity: 1,
          admitted: 1,
          remaining: 0,
          revision: 1,
          updatedAt: "2030-01-01T00:00:00.000Z",
        });
      if (url.pathname === "/v1/admin/users")
        return response(200, {
          items: [
            {
              id: "40000000-0000-4000-8000-000000000003",
              status: "ACTIVE",
              emails: [
                {
                  email: "reviewer@example.test",
                  verifiedAt: "2030-01-01T00:00:00.000Z",
                },
              ],
              createdAt: "2030-01-01T00:00:00.000Z",
              updatedAt: "2030-01-01T00:00:00.000Z",
            },
          ],
          nextCursor: null,
        });
      if (url.pathname === "/v1/admin/accounts")
        return response(200, {
          items: [
            {
              id: accountId,
              status: "ACTIVE",
              displayName: "Reviewer",
              createdAt: "2030-01-01T00:00:00.000Z",
              updatedAt: "2030-01-01T00:00:00.000Z",
            },
          ],
          nextCursor: null,
        });
      if (url.pathname === `/v1/admin/beta/admission/accounts/${accountId}`)
        return response(200, { accountId, admitted: true });
      if (url.pathname === "/v1/admin/compatibility/config-releases/latest") {
        configReads += 1;
        return response(
          200,
          options.driftFinalConfig && configReads >= 3
            ? {
                ...fixture.config,
                configVersion: fixture.config.configVersion + 1,
              }
            : fixture.config,
        );
      }
      if (url.pathname === "/v1/bootstrap")
        return response(
          200,
          options.tamper
            ? { ...fixture.envelope, signature: "AA" }
            : fixture.envelope,
        );
      if (url.pathname === `/v1/admin/compatibility/releases/${STORE1_VERSION}`)
        return response(404, { code: "NOT_FOUND" });
      throw new Error(
        `unexpected fake HTTP path ${method} ${url.pathname}${url.search}`,
      );
    },
  );
  return { fetchImpl: fetchMock as typeof fetch, calls, fetchMock };
}

describe("STORE-1 read-only authenticated entry", () => {
  it("verifies a signed bootstrap, follows GET reads, and previews but never executes the first catalog POST", async () => {
    const fixture = signedFixture();
    const protectedInput = protectedEntryInput();
    try {
      const http = entryFetch(fixture);
      const result = await runStore1ReadOnlyPreflightWithEvidenceForTest(
        protectedInput.input,
        fixture.packageEvidence,
        {
          fetchImpl: http.fetchImpl,
          now: () => new Date("2030-01-01T00:01:00.000Z"),
        },
      );
      expect(result).toMatchObject({
        status: "POST",
        signature: { verified: true, configVersion: 8 },
        nextActionPreview: {
          method: "POST",
          path: "/v1/admin/compatibility/releases/0.2.4/publish",
          executed: false,
        },
        bootstrapMayUpdateDeviceOrAuthState: true,
        catalogMutationExecuted: false,
      });
      const serializedResult = JSON.stringify(result);
      expect(serializedResult).not.toContain("a".repeat(43));
      expect(serializedResult).not.toContain("header.payload.signature");
      expect(
        http.calls
          .filter((call) => call.method === "POST")
          .map((call) => call.path),
      ).toEqual(["/v1/bootstrap"]);
      expect(
        http.calls.some((call) => call.path.includes("reviewer@example.test")),
      ).toBe(false);
      const adminCalls = http.calls.filter((call) =>
        call.path.startsWith("/v1/admin/"),
      );
      expect(
        adminCalls.every((call) => call.headers.get("authorization") === null),
      ).toBe(true);
      const bootstrapCall = http.calls.find(
        (call) => call.path === "/v1/bootstrap",
      )!;
      expect(bootstrapCall.headers.get("cookie")).toBeNull();
      expect(bootstrapCall.headers.get("authorization")).toBe(
        "Bearer header.payload.signature",
      );
    } finally {
      rmSync(protectedInput.directory, { recursive: true, force: true });
    }
  });

  it("fails closed on a tampered signed bootstrap and executes no catalog POST", async () => {
    const fixture = signedFixture();
    const protectedInput = protectedEntryInput();
    try {
      const http = entryFetch(fixture, { tamper: true });
      await expect(
        runStore1ReadOnlyPreflightWithEvidenceForTest(
          protectedInput.input,
          fixture.packageEvidence,
          {
            fetchImpl: http.fetchImpl,
            now: () => new Date("2030-01-01T00:01:00.000Z"),
          },
        ),
      ).rejects.toThrow("STORE1_V2_SIGNATURE_INVALID_SIGNATURE");
      expect(
        http.calls
          .filter((call) => call.method === "POST")
          .map((call) => call.path),
      ).toEqual(["/v1/bootstrap"]);
    } finally {
      rmSync(protectedInput.directory, { recursive: true, force: true });
    }
  });

  it("fails closed when the signed bootstrap is expired", async () => {
    const fixture = signedFixture();
    const protectedInput = protectedEntryInput();
    try {
      const http = entryFetch(fixture);
      await expect(
        runStore1ReadOnlyPreflightWithEvidenceForTest(
          protectedInput.input,
          fixture.packageEvidence,
          {
            fetchImpl: http.fetchImpl,
            now: () => new Date("2030-01-01T00:15:00.000Z"),
          },
        ),
      ).rejects.toThrow("STORE1_V2_SIGNATURE_EXPIRED");
    } finally {
      rmSync(protectedInput.directory, { recursive: true, force: true });
    }
  });

  it("rechecks config after read-only catalog reads and blocks a drifted mutation preview", async () => {
    const fixture = signedFixture();
    const protectedInput = protectedEntryInput();
    try {
      const http = entryFetch(fixture, { driftFinalConfig: true });
      const result = await runStore1ReadOnlyPreflightWithEvidenceForTest(
        protectedInput.input,
        fixture.packageEvidence,
        {
          fetchImpl: http.fetchImpl,
          now: () => new Date("2030-01-01T00:01:00.000Z"),
        },
      );
      expect(result).toMatchObject({
        status: "BLOCKED",
        code: "STORE1_V2_SIGNATURE_PREFLIGHT_STALE",
        catalogMutationExecuted: false,
      });
      expect(
        http.calls
          .filter((call) => call.method === "POST")
          .map((call) => call.path),
      ).toEqual(["/v1/bootstrap"]);
    } finally {
      rmSync(protectedInput.directory, { recursive: true, force: true });
    }
  });

  it("rejects symlinked credential files before any HTTP request", async () => {
    const fixture = signedFixture();
    const protectedInput = protectedEntryInput();
    try {
      const link = join(protectedInput.directory, "admin-session-link");
      symlinkSync(protectedInput.input.adminSessionFile, link);
      const fetchMock = vi.fn();
      await expect(
        runStore1ReadOnlyPreflightWithEvidenceForTest(
          { ...protectedInput.input, adminSessionFile: link },
          fixture.packageEvidence,
          { fetchImpl: fetchMock as typeof fetch },
        ),
      ).rejects.toThrow("STORE1_ADMIN_INPUT_INVALID");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      rmSync(protectedInput.directory, { recursive: true, force: true });
    }
  });

  it("rejects non-private credential files before any HTTP request", async () => {
    const fixture = signedFixture();
    const protectedInput = protectedEntryInput();
    try {
      chmodSync(protectedInput.input.adminSessionFile, 0o644);
      const fetchMock = vi.fn();
      await expect(
        runStore1ReadOnlyPreflightWithEvidenceForTest(
          protectedInput.input,
          fixture.packageEvidence,
          { fetchImpl: fetchMock as typeof fetch },
        ),
      ).rejects.toThrow("STORE1_ADMIN_INPUT_INVALID");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      rmSync(protectedInput.directory, { recursive: true, force: true });
    }
  });
});

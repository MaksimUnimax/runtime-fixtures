/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it } from "vitest";
import type { AdminSubject } from "@product/admin-auth";
import type { AdminCommercialService } from "@product/admin-commercial";
import { createApiApp } from "./app.js";
import { mapAdminCommercialFailure } from "./admin-commercial-routes.js";

const actorId = "00000000-0000-4000-8000-000000000001";
const planId = "00000000-0000-4000-8000-000000000002";
const revisionId = "00000000-0000-4000-8000-000000000003";
const priceId = "00000000-0000-4000-8000-000000000004";
const accountId = "00000000-0000-4000-8000-000000000005";
const token = "admin-token";
const csrf = "csrf-token";
const fingerprint = "a".repeat(64);
const subject: AdminSubject = {
  adminPrincipalId: actorId,
  userId: "00000000-0000-4000-8000-000000000006",
  adminSessionId: "00000000-0000-4000-8000-000000000007",
  roles: ["ADMIN_OWNER"],
  permissions: [
    "plan.read",
    "plan.manage",
    "price.read",
    "price.manage",
    "entitlement.read",
    "entitlement.override",
    "compatibility.read",
    "compatibility.manage",
  ],
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
};
const plan = {
  id: planId,
  code: "starter",
  status: "DRAFT",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  revisions: [
    {
      id: revisionId,
      planId,
      revision: 1,
      state: "DRAFT",
      displayName: "Starter",
      description: "Safe description",
      entitlements: [],
    },
  ],
};
const price = {
  id: priceId,
  planId,
  code: "monthly",
  marketKey: "ru",
  channelKey: "web",
  status: "DRAFT",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  revisions: [{ id: revisionId }],
  saleAssignments: [
    {
      id: "00000000-0000-4000-8000-000000000008",
      priceId,
      assignmentRevision: 1,
      selectedPriceRevisionId: null,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      reason: "private operator reason",
    },
  ],
};
const adminCookie = `pcp_admin_session=${token}`;
const mutationHeaders = {
  cookie: `${adminCookie}; pcp_admin_csrf=${csrf}`,
  "x-csrf-token": csrf,
};
const planCreate = { code: "starter", reason: "ticket-1" };
const planRevisionBody = {
  displayName: "Starter",
  description: "Safe",
  reason: "ticket-1",
};
const updateBody = {
  expectedContentFingerprint: fingerprint,
  description: "Changed",
  reason: "ticket-1",
};
const priceUpdateBody = {
  expectedContentFingerprint: fingerprint,
  amountMinor: 101,
  reason: "ticket-1",
};
const priceBody = {
  planId,
  code: "monthly",
  marketKey: "ru",
  channelKey: "web",
  reason: "ticket-1",
};
const priceRevisionBody = {
  planRevisionId: revisionId,
  amountMinor: 100,
  currency: "RUB",
  billingIntervalUnit: "MONTH",
  billingIntervalCount: 1,
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveTo: null,
  reason: "ticket-1",
};
const overrideBody = {
  expectedLatestRevision: null,
  value: { kind: "BOOLEAN", value: true },
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  expiresAt: null,
  reason: "ticket-1",
};
const compatibilityBody = {
  contractVersion: "control_plane_v1",
  browserFamily: "chrome",
  minimumExtensionVersion: "1.0.0",
  recommendedExtensionVersion: "1.1.0",
  minimumBrowserVersion: "120",
  maintenanceMode: false,
  maintenanceCode: null,
  blockedVersions: ["0.9.0"],
  reason: "ticket-1",
};
const extensionReleaseBody = {
  version: "0.2.4",
  releaseChannel: "stable",
  artifactSha256: "c".repeat(64),
  supportedContracts: ["control_plane_v2"],
  supportedBrowsers: ["opera"],
  reason: "ticket-1",
};
const configReleaseBody = {
  contractVersion: "control_plane_v2",
  expectedLatestConfigVersion: 7,
  compatibilityPolicyRevisionIds: [revisionId],
  reason: "ticket-1",
};

type Behavior = (...args: unknown[]) => unknown;
function harness(
  options: {
    permissions?: string[];
    csrfValid?: boolean;
    planValue?: unknown;
    priceValue?: unknown;
  } = {},
) {
  const calls: string[] = [];
  const behavior = new Map<string, Behavior>();
  behavior.set("getPlan", () =>
    options.planValue === undefined ? plan : options.planValue,
  );
  behavior.set("getPrice", () =>
    options.priceValue === undefined ? price : options.priceValue,
  );
  behavior.set("listPlans", () => ({
    items: [
      {
        id: plan.id,
        code: plan.code,
        status: plan.status,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
      },
    ],
  }));
  behavior.set("listPrices", () => ({ items: [price] }));
  behavior.set("listDefinitions", () => ({
    items: [
      {
        entitlementKey: "feature.export",
        valueType: "BOOLEAN",
        securityClassification: "CAPABILITY",
        description: "Export",
        deprecatedAt: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ],
  }));
  behavior.set("listOverrides", () => ({
    items: [
      {
        id: "00000000-0000-4000-8000-000000000009",
        accountId,
        entitlementKey: "feature.export",
        revision: 1,
        operation: "SET",
        value: { kind: "BOOLEAN", value: true },
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        expiresAt: null,
        reason: "REDACTED",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ],
  }));
  behavior.set("resolveEffective", () => ({
    entitlementKey: "feature.export",
    value: { kind: "BOOLEAN", value: true },
    source: "PLAN_VALUE",
  }));
  behavior.set("listCompatibility", () => ({
    items: [
      {
        id: "00000000-0000-4000-8000-000000000010",
        policyKey: "global",
        revision: 1,
        contractVersion: "control_plane_v1",
        browserFamily: null,
        minimumExtensionVersion: null,
        recommendedExtensionVersion: null,
        minimumBrowserVersion: null,
        maintenanceMode: false,
        maintenanceCode: null,
        blockedVersions: [],
        publishedAt: new Date("2026-01-01T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        linkedConfigVersions: [],
      },
    ],
  }));
  behavior.set("getExtensionRelease", () => ({
    id: "00000000-0000-4000-8000-000000000011",
    version: "0.2.4",
    releaseChannel: "stable",
    artifactSha256: "c".repeat(64),
    releasedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    supportedContracts: ["control_plane_v2"],
    supportedBrowsers: ["opera"],
  }));
  behavior.set("getLatestConfigRelease", () => ({
    configVersion: 7,
    contractVersion: "control_plane_v2",
    snapshotVersion: "bootstrap_snapshot_v2",
    envelopeVersion: "bootstrap_envelope_v2",
    contentHashSha256: "a".repeat(64),
    sourceFingerprintSha256: "b".repeat(64),
    signingKeyId: "test-ed25519",
    compatibilityPolicyRevisionIds: [revisionId],
    publishedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  }));
  const result = { kind: "OK", changed: true, value: plan };
  const service = new Proxy({} as AdminCommercialService, {
    get:
      (_target, property: string) =>
      async (...args: unknown[]) => {
        calls.push(property);
        return behavior.has(property)
          ? behavior.get(property)!(...args)
          : result;
      },
  });
  const permissions = options.permissions ?? subject.permissions;
  const auth = {
    authenticateAdminSession: async () => ({
      ok: true as const,
      value: { ...subject, permissions },
    }),
    authorize: (_candidate: AdminSubject, permission: string) =>
      permissions.includes(permission)
        ? { ok: true as const, value: true as const }
        : { ok: false as const, code: "ADMIN_FORBIDDEN" as const },
    csrfValid: () => options.csrfValid ?? true,
  };
  const app = createApiApp({
    config: {
      environment: "test",
      databaseUrl: "postgres://unused",
      logLevel: "error",
      apiPort: 0,
      workerReadyDelayMs: 0,
    },
    isInfrastructureReady: async () => true,
    adminAuthService: auth as never,
    adminCommercialService: service,
  });
  return { app, behavior, calls };
}
const json = (response: { json: () => any }) => response.json();
const expectError = (
  response: { statusCode: number; json: () => any },
  status: number,
  code: string,
) => {
  expect(response.statusCode).toBe(status);
  expect(json(response).error.code).toBe(code);
};

describe("P6.4 admin-commercial controller", () => {
  const apps: Awaited<ReturnType<typeof harness>>["app"][] = [];
  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
  });

  it("maps every accepted domain failure code to one public classification", () => {
    const notFound = [
      "PLAN_NOT_FOUND",
      "PLAN_REVISION_NOT_FOUND",
      "ENTITLEMENT_DEFINITION_NOT_FOUND",
      "PRICE_NOT_FOUND",
      "PRICE_PLAN_NOT_FOUND",
      "PRICE_REVISION_NOT_FOUND",
      "PRICE_PLAN_REVISION_NOT_FOUND",
      "ACCOUNT_NOT_FOUND",
    ] as const;
    const stale = [
      "PLAN_STATUS_STALE",
      "PLAN_DRAFT_STALE",
      "ENTITLEMENT_DEFINITION_STALE",
      "PRICE_STATUS_STALE",
      "PRICE_DRAFT_STALE",
      "PRICE_ASSIGNMENT_STALE",
      "ACCOUNT_ENTITLEMENT_OVERRIDE_STALE",
    ] as const;
    const conflicts = [
      "PLAN_CODE_CONFLICT",
      "PLAN_ARCHIVED",
      "PLAN_STATUS_TRANSITION_INVALID",
      "PLAN_PUBLISHED_REVISION_REQUIRED",
      "PLAN_REVISION_NOT_DRAFT",
      "ENTITLEMENT_DEFINITION_CONFLICT",
      "ENTITLEMENT_DEPRECATED",
      "ENTITLEMENT_TYPE_MISMATCH",
      "PRICE_CODE_CONFLICT",
      "PRICE_ARCHIVED",
      "PRICE_PLAN_ARCHIVED",
      "PRICE_STATUS_TRANSITION_INVALID",
      "PRICE_PUBLISHED_REVISION_REQUIRED",
      "PRICE_REVISION_NOT_DRAFT",
      "PRICE_PLAN_REVISION_PLAN_MISMATCH",
      "PRICE_PLAN_REVISION_NOT_PUBLISHED",
      "PRICE_ASSIGNMENT_OUTSIDE_REVISION_WINDOW",
      "PRICE_ASSIGNMENT_REVISION_NOT_PUBLISHED",
      "PRICE_SALE_ASSIGNMENT_NOT_FOUND",
      "PRICE_SALE_CLOSED",
      "PRICE_REVISION_EXPIRED",
      "PRICE_NOT_ACTIVE",
      "PLAN_NOT_ACTIVE",
      "PLAN_REVISION_NOT_PUBLISHED",
    ] as const;
    expect(new Set([...notFound, ...stale, ...conflicts]).size).toBe(
      notFound.length + stale.length + conflicts.length,
    );
    expect(notFound.map((code) => mapAdminCommercialFailure(code))).toEqual(
      notFound.map(() =>
        expect.objectContaining({
          code: "ADMIN_RESOURCE_NOT_FOUND",
          statusCode: 404,
        }),
      ),
    );
    expect(stale.map((code) => mapAdminCommercialFailure(code))).toEqual(
      stale.map(() =>
        expect.objectContaining({ code: "ADMIN_STATE_STALE", statusCode: 409 }),
      ),
    );
    expect(conflicts.map((code) => mapAdminCommercialFailure(code))).toEqual(
      conflicts.map(() =>
        expect.objectContaining({ code: "ADMIN_CONFLICT", statusCode: 409 }),
      ),
    );
  });

  it("rejects an unauthenticated plan read", async () => {
    const { app } = harness();
    apps.push(app);
    const r = await app.inject("/v1/admin/commercial/plans");
    expectError(r, 401, "ADMIN_UNAUTHORIZED");
  });
  it("rejects a forbidden plan read", async () => {
    const { app } = harness({ permissions: [] });
    apps.push(app);
    expectError(
      await app.inject({
        url: "/v1/admin/commercial/plans",
        headers: { cookie: adminCookie },
      }),
      403,
      "ADMIN_FORBIDDEN",
    );
  });
  it("rejects a forbidden plan mutation before calling service", async () => {
    const { app, calls } = harness({ permissions: ["plan.read"] });
    apps.push(app);
    expectError(
      await app.inject({
        method: "POST",
        url: "/v1/admin/commercial/plans",
        headers: mutationHeaders,
        payload: planCreate,
      }),
      403,
      "ADMIN_FORBIDDEN",
    );
    expect(calls).toEqual([]);
  });
  it("rejects a forbidden price mutation before calling service", async () => {
    const { app, calls } = harness({ permissions: ["price.read"] });
    apps.push(app);
    expectError(
      await app.inject({
        method: "POST",
        url: "/v1/admin/commercial/prices",
        headers: mutationHeaders,
        payload: priceBody,
      }),
      403,
      "ADMIN_FORBIDDEN",
    );
    expect(calls).toEqual([]);
  });
  it("rejects a forbidden entitlement override before calling service", async () => {
    const { app, calls } = harness({ permissions: ["entitlement.read"] });
    apps.push(app);
    expectError(
      await app.inject({
        method: "POST",
        url: `/v1/admin/accounts/${accountId}/entitlement-overrides/feature.export/set`,
        headers: mutationHeaders,
        payload: overrideBody,
      }),
      403,
      "ADMIN_FORBIDDEN",
    );
    expect(calls).toEqual([]);
  });
  it("rejects a forbidden compatibility publish before calling service", async () => {
    const { app, calls } = harness({ permissions: ["compatibility.read"] });
    apps.push(app);
    expectError(
      await app.inject({
        method: "POST",
        url: "/v1/admin/compatibility/policies/global/publish",
        headers: mutationHeaders,
        payload: compatibilityBody,
      }),
      403,
      "ADMIN_FORBIDDEN",
    );
    expect(calls).toEqual([]);
  });
  it("allows an authorized GET without CSRF", async () => {
    const { app, calls } = harness({ csrfValid: false });
    apps.push(app);
    const r = await app.inject({
      url: "/v1/admin/commercial/plans",
      headers: { cookie: adminCookie },
    });
    expect(r.statusCode).toBe(200);
    expect(calls).toEqual(["listPlans"]);
    expect(r.headers["cache-control"]).toBe("no-store");
  });
  it("provides exact STORE-1 compatibility readback through ordinary admin GETs", async () => {
    const { app, behavior, calls } = harness();
    apps.push(app);
    behavior.set("listCompatibility", (input) => {
      expect(input).toMatchObject({
        contractVersion: "control_plane_v2",
        policyKey: "store1.opera.v2",
        scope: "opera",
      });
      return {
        items: [
          {
            id: revisionId,
            policyKey: "store1.opera.v2",
            revision: 2,
            contractVersion: "control_plane_v2",
            browserFamily: "opera",
            minimumExtensionVersion: "0.2.4",
            recommendedExtensionVersion: "0.2.4",
            minimumBrowserVersion: "136",
            maintenanceMode: false,
            maintenanceCode: null,
            blockedVersions: [],
            publishedAt: new Date("2026-01-01T00:00:00.000Z"),
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            linkedConfigVersions: [7],
          },
        ],
      };
    });
    const headers = { cookie: adminCookie };
    const policy = await app.inject({
      url: "/v1/admin/compatibility/policies?contractVersion=control_plane_v2&policyKey=store1.opera.v2&scope=opera",
      headers,
    });
    const release = await app.inject({
      url: "/v1/admin/compatibility/releases/0.2.4",
      headers,
    });
    const configRelease = await app.inject({
      url: "/v1/admin/compatibility/config-releases/latest?contractVersion=control_plane_v2",
      headers,
    });
    expect(policy.statusCode).toBe(200);
    expect(release.statusCode).toBe(200);
    expect(configRelease.statusCode).toBe(200);
    expect(policy.json().items[0]).toMatchObject({
      contractVersion: "control_plane_v2",
      linkedConfigVersions: [7],
    });
    expect(release.json()).toMatchObject({
      version: "0.2.4",
      artifactSha256: "c".repeat(64),
      supportedContracts: ["control_plane_v2"],
      supportedBrowsers: ["opera"],
    });
    expect(configRelease.json()).toMatchObject({
      configVersion: 7,
      contractVersion: "control_plane_v2",
      compatibilityPolicyRevisionIds: [revisionId],
    });
    expect(calls).toEqual([
      "listCompatibility",
      "getExtensionRelease",
      "getLatestConfigRelease",
    ]);
  });
  it("returns safe 404 for missing release/config readback", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("getExtensionRelease", () => null);
    behavior.set("getLatestConfigRelease", () => null);
    const headers = { cookie: adminCookie };
    for (const url of [
      "/v1/admin/compatibility/releases/0.2.4",
      "/v1/admin/compatibility/config-releases/latest?contractVersion=control_plane_v2",
    ]) {
      expectError(
        await app.inject({ url, headers }),
        404,
        "ADMIN_RESOURCE_NOT_FOUND",
      );
    }
  });
  it("rejects a malformed plan cursor before calling the service", async () => {
    const { app, calls } = harness();
    apps.push(app);
    expectError(
      await app.inject({
        url: "/v1/admin/commercial/plans?cursor=bad",
        headers: { cookie: adminCookie },
      }),
      400,
      "INVALID_REQUEST",
    );
    expect(calls).toEqual([]);
  });
  it("rejects a malformed price cursor before calling the service", async () => {
    const { app, calls } = harness();
    apps.push(app);
    expectError(
      await app.inject({
        url: "/v1/admin/commercial/prices?cursor=bad",
        headers: { cookie: adminCookie },
      }),
      400,
      "INVALID_REQUEST",
    );
    expect(calls).toEqual([]);
  });
  it("rejects a malformed definition cursor before calling the service", async () => {
    const { app, calls } = harness();
    apps.push(app);
    expectError(
      await app.inject({
        url: "/v1/admin/commercial/entitlements/definitions?cursor=Bad%20Key",
        headers: { cookie: adminCookie },
      }),
      400,
      "INVALID_REQUEST",
    );
    expect(calls).toEqual([]);
  });
  it("rejects a malformed override cursor before calling the service", async () => {
    const { app, calls } = harness();
    apps.push(app);
    expectError(
      await app.inject({
        url: `/v1/admin/accounts/${accountId}/entitlement-overrides?cursor=bad`,
        headers: { cookie: adminCookie },
      }),
      400,
      "INVALID_REQUEST",
    );
    expect(calls).toEqual([]);
  });
  it("rejects a malformed compatibility cursor before calling the service", async () => {
    const { app, calls } = harness();
    apps.push(app);
    expectError(
      await app.inject({
        url: "/v1/admin/compatibility/policies?cursor=bad",
        headers: { cookie: adminCookie },
      }),
      400,
      "INVALID_REQUEST",
    );
    expect(calls).toEqual([]);
  });
  it("passes valid canonical cursors to every paginated service", async () => {
    const { app, calls } = harness();
    apps.push(app);
    const headers = { cookie: adminCookie };
    for (const url of [
      `/v1/admin/commercial/plans?cursor=${planId}`,
      `/v1/admin/commercial/prices?cursor=${priceId}`,
      "/v1/admin/commercial/entitlements/definitions?cursor=feature.export",
      `/v1/admin/accounts/${accountId}/entitlement-overrides?cursor=${revisionId}`,
      `/v1/admin/compatibility/policies?cursor=${revisionId}`,
    ]) {
      expect((await app.inject({ url, headers })).statusCode).toBe(200);
    }
    expect(calls).toEqual([
      "listPlans",
      "listPrices",
      "listDefinitions",
      "listOverrides",
      "listCompatibility",
    ]);
  });
  it("rejects a POST without CSRF before calling service", async () => {
    const { app, calls } = harness({ csrfValid: false });
    apps.push(app);
    expectError(
      await app.inject({
        method: "POST",
        url: "/v1/admin/commercial/plans",
        headers: { cookie: adminCookie },
        payload: planCreate,
      }),
      403,
      "ADMIN_CSRF_INVALID",
    );
    expect(calls).toEqual([]);
  });
  it("rejects an unknown plan body field through the route schema", async () => {
    const { app, calls } = harness();
    apps.push(app);
    expectError(
      await app.inject({
        method: "POST",
        url: "/v1/admin/commercial/plans",
        headers: mutationHeaders,
        payload: { ...planCreate, extra: true },
      }),
      400,
      "INVALID_REQUEST",
    );
    expect(calls).toEqual([]);
  });
  it("rejects an invalid plan UUID path", async () => {
    const { app, calls } = harness();
    apps.push(app);
    expectError(
      await app.inject({
        url: "/v1/admin/commercial/plans/not-a-uuid",
        headers: { cookie: adminCookie },
      }),
      400,
      "INVALID_REQUEST",
    );
    expect(calls).toEqual([]);
  });
  it("rejects an invalid plan fingerprint through the route schema", async () => {
    const { app, calls } = harness();
    apps.push(app);
    expectError(
      await app.inject({
        method: "POST",
        url: `/v1/admin/commercial/plans/${planId}/revisions/${revisionId}/update`,
        headers: mutationHeaders,
        payload: { ...updateBody, expectedContentFingerprint: "bad" },
      }),
      400,
      "INVALID_REQUEST",
    );
    expect(calls).toEqual([]);
  });
  it("rejects an invalid price amount through the route schema", async () => {
    const { app, calls } = harness();
    apps.push(app);
    expectError(
      await app.inject({
        method: "POST",
        url: `/v1/admin/commercial/prices/${priceId}/revisions`,
        headers: mutationHeaders,
        payload: { ...priceRevisionBody, amountMinor: -1 },
      }),
      400,
      "INVALID_REQUEST",
    );
    expect(calls).toEqual([]);
  });
  it("rejects invalid timestamps through the route schema", async () => {
    const { app, calls } = harness();
    apps.push(app);
    expectError(
      await app.inject({
        method: "POST",
        url: `/v1/admin/commercial/prices/${priceId}/revisions`,
        headers: mutationHeaders,
        payload: { ...priceRevisionBody, effectiveFrom: "tomorrow-ish" },
      }),
      400,
      "INVALID_REQUEST",
    );
    expect(calls).toEqual([]);
  });
  it("rejects an invalid compatibility body", async () => {
    const { app, calls } = harness();
    apps.push(app);
    expectError(
      await app.inject({
        method: "POST",
        url: "/v1/admin/compatibility/policies/global/publish",
        headers: mutationHeaders,
        payload: { ...compatibilityBody, signingKey: "secret" },
      }),
      400,
      "INVALID_REQUEST",
    );
    expect(calls).toEqual([]);
  });
  it("rejects an invalid override body", async () => {
    const { app, calls } = harness();
    apps.push(app);
    expectError(
      await app.inject({
        method: "POST",
        url: `/v1/admin/accounts/${accountId}/entitlement-overrides/feature.export/set`,
        headers: mutationHeaders,
        payload: { ...overrideBody, expectedLatestRevision: 0 },
      }),
      400,
      "INVALID_REQUEST",
    );
    expect(calls).toEqual([]);
  });

  it("maps successful plan creation and passes actor context", async () => {
    const { app, behavior, calls } = harness();
    apps.push(app);
    let received: unknown;
    behavior.set("createPlan", (input) => {
      received = input;
      return { kind: "OK", changed: true, value: plan };
    });
    const r = await app.inject({
      method: "POST",
      url: "/v1/admin/commercial/plans",
      headers: { ...mutationHeaders, "x-request-id": "request-1" },
      payload: planCreate,
    });
    expect(r.statusCode).toBe(200);
    expect(json(r)).toMatchObject({ status: "applied", changed: true });
    expect(received).toMatchObject({
      code: "starter",
      actorId,
      reason: "ticket-1",
      correlationId: "request-1",
    });
    expect(calls).toEqual(["createPlan"]);
  });
  it("maps a missing plan resource through GET", async () => {
    const { app } = harness({ planValue: null });
    apps.push(app);
    expectError(
      await app.inject({
        url: `/v1/admin/commercial/plans/${planId}`,
        headers: { cookie: adminCookie },
      }),
      404,
      "ADMIN_RESOURCE_NOT_FOUND",
    );
  });
  it("maps a plan code conflict to the public conflict envelope", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("createPlan", () => ({
      kind: "REJECTED",
      code: "PLAN_CODE_CONFLICT",
    }));
    expectError(
      await app.inject({
        method: "POST",
        url: "/v1/admin/commercial/plans",
        headers: mutationHeaders,
        payload: planCreate,
      }),
      409,
      "ADMIN_CONFLICT",
    );
  });
  it("creates a draft plan revision through the controller", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("createPlanRevision", () => ({
      kind: "OK",
      changed: true,
      value: { id: revisionId, state: "DRAFT" },
    }));
    const r = await app.inject({
      method: "POST",
      url: `/v1/admin/commercial/plans/${planId}/revisions`,
      headers: mutationHeaders,
      payload: planRevisionBody,
    });
    expect(r.statusCode).toBe(200);
    expect(json(r).value).toMatchObject({ id: revisionId, state: "DRAFT" });
  });
  it("maps a plan path/revision mismatch without invoking mutation", async () => {
    const { app, calls } = harness({ planValue: { ...plan, revisions: [] } });
    apps.push(app);
    expectError(
      await app.inject({
        method: "POST",
        url: `/v1/admin/commercial/plans/${planId}/revisions/${revisionId}/update`,
        headers: mutationHeaders,
        payload: updateBody,
      }),
      404,
      "ADMIN_RESOURCE_NOT_FOUND",
    );
    expect(calls).toEqual(["getPlan"]);
  });
  it("maps a stale plan result to ADMIN_STATE_STALE", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("updatePlanRevision", () => ({
      kind: "REJECTED",
      code: "PLAN_DRAFT_STALE",
    }));
    expectError(
      await app.inject({
        method: "POST",
        url: `/v1/admin/commercial/plans/${planId}/revisions/${revisionId}/update`,
        headers: mutationHeaders,
        payload: updateBody,
      }),
      409,
      "ADMIN_STATE_STALE",
    );
  });
  it("maps an entitlement type conflict to ADMIN_CONFLICT", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("setPlanEntitlement", () => ({
      kind: "REJECTED",
      code: "ENTITLEMENT_TYPE_MISMATCH",
    }));
    expectError(
      await app.inject({
        method: "POST",
        url: `/v1/admin/commercial/plans/${planId}/revisions/${revisionId}/entitlements/feature.export/set`,
        headers: mutationHeaders,
        payload: {
          expectedContentFingerprint: fingerprint,
          value: { kind: "BOOLEAN", value: true },
          reason: "ticket-1",
        },
      }),
      409,
      "ADMIN_CONFLICT",
    );
  });
  it("publishes a plan revision successfully", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("publishPlanRevision", () => ({
      kind: "OK",
      changed: true,
      value: { id: revisionId, state: "PUBLISHED" },
    }));
    const r = await app.inject({
      method: "POST",
      url: `/v1/admin/commercial/plans/${planId}/revisions/${revisionId}/publish`,
      headers: mutationHeaders,
      payload: { expectedContentFingerprint: fingerprint, reason: "ticket-1" },
    });
    expect(r.statusCode).toBe(200);
    expect(json(r).value).toMatchObject({ id: revisionId, state: "PUBLISHED" });
  });
  it("maps a stale plan status result", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("changePlanStatus", () => ({
      kind: "REJECTED",
      code: "PLAN_STATUS_STALE",
    }));
    expectError(
      await app.inject({
        method: "POST",
        url: `/v1/admin/commercial/plans/${planId}/status`,
        headers: mutationHeaders,
        payload: {
          expectedStatus: "DRAFT",
          targetStatus: "ACTIVE",
          reason: "ticket-1",
        },
      }),
      409,
      "ADMIN_STATE_STALE",
    );
  });
  it("returns an exact safe non-empty plan list", async () => {
    const { app } = harness();
    apps.push(app);
    const r = await app.inject({
      url: "/v1/admin/commercial/plans",
      headers: { cookie: adminCookie },
    });
    expect(json(r)).toEqual({
      items: [
        expect.objectContaining({
          id: planId,
          code: "starter",
          status: "DRAFT",
        }),
      ],
    });
    expect(Object.keys(json(r).items[0]).sort()).toEqual(
      ["code", "createdAt", "id", "status", "updatedAt"].sort(),
    );
  });
  it("returns a plan detail with a computed safe fingerprint", async () => {
    const { app } = harness();
    apps.push(app);
    const r = await app.inject({
      url: `/v1/admin/commercial/plans/${planId}`,
      headers: { cookie: adminCookie },
    });
    const body = json(r);
    expect(body.id).toBe(planId);
    expect(body.revisions[0]).toMatchObject({
      id: revisionId,
      displayName: "Starter",
    });
    expect(body.revisions[0].contentFingerprintSha256).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it("creates a price through the controller", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("createPrice", () => ({
      kind: "OK",
      changed: true,
      value: price,
    }));
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/admin/commercial/prices",
          headers: mutationHeaders,
          payload: priceBody,
        })
      ).statusCode,
    ).toBe(200);
  });
  it("maps a missing price resource through GET", async () => {
    const { app } = harness({ priceValue: null });
    apps.push(app);
    expectError(
      await app.inject({
        url: `/v1/admin/commercial/prices/${priceId}`,
        headers: { cookie: adminCookie },
      }),
      404,
      "ADMIN_RESOURCE_NOT_FOUND",
    );
  });
  it("maps a price code conflict to ADMIN_CONFLICT", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("createPrice", () => ({
      kind: "REJECTED",
      code: "PRICE_CODE_CONFLICT",
    }));
    expectError(
      await app.inject({
        method: "POST",
        url: "/v1/admin/commercial/prices",
        headers: mutationHeaders,
        payload: priceBody,
      }),
      409,
      "ADMIN_CONFLICT",
    );
  });
  it("maps a missing price resource", async () => {
    const { app, behavior } = harness({ priceValue: null });
    apps.push(app);
    behavior.set("createPriceRevision", () => ({
      kind: "REJECTED",
      code: "PRICE_PLAN_NOT_FOUND",
    }));
    expectError(
      await app.inject({
        method: "POST",
        url: `/v1/admin/commercial/prices/${priceId}/revisions`,
        headers: mutationHeaders,
        payload: priceRevisionBody,
      }),
      404,
      "ADMIN_RESOURCE_NOT_FOUND",
    );
  });
  it("creates a draft price revision", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("createPriceRevision", () => ({
      kind: "OK",
      changed: true,
      value: { id: "00000000-0000-4000-8000-000000000011", state: "DRAFT" },
    }));
    expect(
      json(
        await app.inject({
          method: "POST",
          url: `/v1/admin/commercial/prices/${priceId}/revisions`,
          headers: mutationHeaders,
          payload: priceRevisionBody,
        }),
      ).value,
    ).toMatchObject({ state: "DRAFT" });
  });
  it("maps a price path/revision mismatch without invoking mutation", async () => {
    const { app, calls } = harness({ priceValue: { ...price, revisions: [] } });
    apps.push(app);
    expectError(
      await app.inject({
        method: "POST",
        url: `/v1/admin/commercial/prices/${priceId}/revisions/${revisionId}/update`,
        headers: mutationHeaders,
        payload: priceUpdateBody,
      }),
      404,
      "ADMIN_RESOURCE_NOT_FOUND",
    );
    expect(calls).toEqual(["getPrice"]);
  });
  it("maps a stale price fingerprint", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("updatePriceRevision", () => ({
      kind: "REJECTED",
      code: "PRICE_DRAFT_STALE",
    }));
    expectError(
      await app.inject({
        method: "POST",
        url: `/v1/admin/commercial/prices/${priceId}/revisions/${revisionId}/update`,
        headers: mutationHeaders,
        payload: priceUpdateBody,
      }),
      409,
      "ADMIN_STATE_STALE",
    );
  });
  it("publishes a price revision", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("publishPriceRevision", () => ({
      kind: "OK",
      changed: true,
      value: { id: revisionId, state: "PUBLISHED" },
    }));
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/admin/commercial/prices/${priceId}/revisions/${revisionId}/publish`,
          headers: mutationHeaders,
          payload: {
            expectedContentFingerprint: fingerprint,
            reason: "ticket-1",
          },
        })
      ).statusCode,
    ).toBe(200);
  });
  it("maps a stale price status", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("changePriceStatus", () => ({
      kind: "REJECTED",
      code: "PRICE_STATUS_STALE",
    }));
    expectError(
      await app.inject({
        method: "POST",
        url: `/v1/admin/commercial/prices/${priceId}/status`,
        headers: mutationHeaders,
        payload: {
          expectedStatus: "DRAFT",
          targetStatus: "ACTIVE",
          reason: "ticket-1",
        },
      }),
      409,
      "ADMIN_STATE_STALE",
    );
  });
  it("maps a stale sale assignment", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("assignPrice", () => ({
      kind: "REJECTED",
      code: "PRICE_ASSIGNMENT_STALE",
    }));
    expectError(
      await app.inject({
        method: "POST",
        url: `/v1/admin/commercial/prices/${priceId}/sale-assignments`,
        headers: mutationHeaders,
        payload: {
          expectedLatestAssignmentRevision: null,
          selectedPriceRevisionId: null,
          effectiveFrom: "2026-01-01T00:00:00.000Z",
          reason: "ticket-1",
        },
      }),
      409,
      "ADMIN_STATE_STALE",
    );
  });
  it("returns a safe non-empty price list", async () => {
    const { app } = harness();
    apps.push(app);
    const body = json(
      await app.inject({
        url: "/v1/admin/commercial/prices",
        headers: { cookie: adminCookie },
      }),
    );
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: priceId, code: "monthly" });
  });
  it("returns price detail without assignment reason", async () => {
    const { app } = harness();
    apps.push(app);
    const body = json(
      await app.inject({
        url: `/v1/admin/commercial/prices/${priceId}`,
        headers: { cookie: adminCookie },
      }),
    );
    expect(body.saleAssignments[0]).toMatchObject({ assignmentRevision: 1 });
    expect(body.saleAssignments[0]).not.toHaveProperty("reason");
  });

  it("maps definition conflict", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("createDefinition", () => ({
      kind: "REJECTED",
      code: "ENTITLEMENT_DEFINITION_CONFLICT",
    }));
    expectError(
      await app.inject({
        method: "POST",
        url: "/v1/admin/commercial/entitlements/definitions",
        headers: mutationHeaders,
        payload: {
          entitlementKey: "feature.export",
          valueType: "BOOLEAN",
          securityClassification: "CAPABILITY",
          description: "x",
          reason: "ticket-1",
        },
      }),
      409,
      "ADMIN_CONFLICT",
    );
  });
  it("maps definition description stale", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("updateDefinition", () => ({
      kind: "REJECTED",
      code: "ENTITLEMENT_DEFINITION_STALE",
    }));
    expectError(
      await app.inject({
        method: "POST",
        url: "/v1/admin/commercial/entitlements/definitions/feature.export/description",
        headers: mutationHeaders,
        payload: {
          expectedDescription: "old",
          newDescription: "new",
          reason: "ticket-1",
        },
      }),
      409,
      "ADMIN_STATE_STALE",
    );
  });
  it("maps definition deprecate success", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("deprecateDefinition", () => ({
      kind: "OK",
      changed: true,
      value: {
        entitlementKey: "feature.export",
        deprecatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    }));
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/admin/commercial/entitlements/definitions/feature.export/deprecate",
          headers: mutationHeaders,
          payload: { reason: "ticket-1" },
        })
      ).statusCode,
    ).toBe(200);
  });
  it("returns a safe definition page", async () => {
    const { app } = harness();
    apps.push(app);
    const body = json(
      await app.inject({
        url: "/v1/admin/commercial/entitlements/definitions",
        headers: { cookie: adminCookie },
      }),
    );
    expect(body.items).toEqual([
      expect.objectContaining({
        entitlementKey: "feature.export",
        valueType: "BOOLEAN",
      }),
    ]);
  });
  it("sets an override", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("setOverride", () => ({
      kind: "OK",
      changed: true,
      value: { revision: 1, operation: "SET" },
    }));
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/admin/accounts/${accountId}/entitlement-overrides/feature.export/set`,
          headers: mutationHeaders,
          payload: overrideBody,
        })
      ).statusCode,
    ).toBe(200);
  });
  it("clears an override", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("clearOverride", () => ({
      kind: "OK",
      changed: true,
      value: { revision: 2, operation: "CLEAR" },
    }));
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/admin/accounts/${accountId}/entitlement-overrides/feature.export/clear`,
          headers: mutationHeaders,
          payload: {
            expectedLatestRevision: 1,
            effectiveFrom: "2026-01-01T00:00:00.000Z",
            expiresAt: null,
            reason: "ticket-1",
          },
        })
      ).statusCode,
    ).toBe(200);
  });
  it("maps a stale override", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("setOverride", () => ({
      kind: "REJECTED",
      code: "ACCOUNT_ENTITLEMENT_OVERRIDE_STALE",
    }));
    expectError(
      await app.inject({
        method: "POST",
        url: `/v1/admin/accounts/${accountId}/entitlement-overrides/feature.export/set`,
        headers: mutationHeaders,
        payload: overrideBody,
      }),
      409,
      "ADMIN_STATE_STALE",
    );
  });
  it("maps a missing override account", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("listOverrides", () => ({ kind: "ACCOUNT_NOT_FOUND" }));
    expectError(
      await app.inject({
        url: `/v1/admin/accounts/${accountId}/entitlement-overrides`,
        headers: { cookie: adminCookie },
      }),
      404,
      "ADMIN_RESOURCE_NOT_FOUND",
    );
  });
  it("returns effective entitlement data", async () => {
    const { app } = harness();
    apps.push(app);
    const body = json(
      await app.inject({
        url: `/v1/admin/accounts/${accountId}/entitlements/feature.export`,
        headers: { cookie: adminCookie },
      }),
    );
    expect(body).toEqual({
      entitlementKey: "feature.export",
      value: { kind: "BOOLEAN", value: true },
      source: "PLAN_VALUE",
    });
  });
  it("maps an account with no plan binding to conflict", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("resolveEffective", () => ({ kind: "NO_PLAN_BINDING" }));
    expectError(
      await app.inject({
        url: `/v1/admin/accounts/${accountId}/entitlements/feature.export`,
        headers: { cookie: adminCookie },
      }),
      409,
      "ADMIN_CONFLICT",
    );
  });
  it("returns override history without reason", async () => {
    const { app } = harness();
    apps.push(app);
    const body = json(
      await app.inject({
        url: `/v1/admin/accounts/${accountId}/entitlement-overrides`,
        headers: { cookie: adminCookie },
      }),
    );
    expect(body.items[0]).toMatchObject({ operation: "SET", revision: 1 });
    expect(body.items[0]).not.toHaveProperty("reason");
  });
  it("returns compatibility linked versions and no key material", async () => {
    const { app } = harness();
    apps.push(app);
    const body = json(
      await app.inject({
        url: "/v1/admin/compatibility/policies",
        headers: { cookie: adminCookie },
      }),
    );
    expect(body.items[0]).toMatchObject({ linkedConfigVersions: [] });
    expect(body.items[0]).not.toHaveProperty("signingKey");
    expect(body.items[0]).not.toHaveProperty("rolloutSeed");
  });
  it("publishes compatibility with exact revision-only status", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("publishCompatibility", () => ({
      id: "00000000-0000-4000-8000-000000000012",
      revision: 2,
      policyKey: "global",
    }));
    const body = json(
      await app.inject({
        method: "POST",
        url: "/v1/admin/compatibility/policies/global/publish",
        headers: mutationHeaders,
        payload: compatibilityBody,
      }),
    );
    expect(body).toMatchObject({
      revision: 2,
      linkedConfigVersions: [],
      activationStatus: "REVISION_PUBLISHED_NOT_AUTO_ACTIVATED",
    });
  });
  it("passes explicit v2 compatibility contract and rejects missing or unknown versions", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    const seen: unknown[] = [];
    behavior.set("publishCompatibility", (...args) => {
      seen.push(args[0]);
      return {
        id: "00000000-0000-4000-8000-000000000012",
        revision: 2,
        policyKey: "global",
      };
    });
    const valid = await app.inject({
      method: "POST",
      url: "/v1/admin/compatibility/policies/global/publish",
      headers: mutationHeaders,
      payload: { ...compatibilityBody, contractVersion: "control_plane_v2" },
    });
    expect(valid.statusCode).toBe(200);
    expect(seen[0]).toMatchObject({ contractVersion: "control_plane_v2" });
    for (const payload of [
      Object.fromEntries(
        Object.entries(compatibilityBody).filter(
          ([key]) => key !== "contractVersion",
        ),
      ),
      { ...compatibilityBody, contractVersion: "control_plane_v3" },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/admin/compatibility/policies/global/publish",
        headers: mutationHeaders,
        payload,
      });
      expectError(response, 400, "INVALID_REQUEST");
    }
    expect(seen).toHaveLength(1);
  });
  it("publishes an extension release through compatibility.manage with no-store", async () => {
    const release = {
      id: "00000000-0000-4000-8000-000000000013",
      version: "0.2.4",
      releaseChannel: "stable",
      artifactSha256: "c".repeat(64),
      releasedAt: new Date("2026-09-23T10:00:00.000Z"),
      createdAt: new Date("2026-09-23T10:00:00.000Z"),
    };
    const { app, behavior, calls } = harness();
    apps.push(app);
    behavior.set("publishExtensionRelease", (...args) => {
      expect(args[0]).toMatchObject({
        ...extensionReleaseBody,
        supportedContracts: ["control_plane_v1", "control_plane_v2"],
        supportedBrowsers: ["opera", "chrome"],
        actorId,
        reason: "ticket-1",
      });
      expect(args[0]).not.toHaveProperty("releasedAt");
      return release;
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/compatibility/releases/0.2.4/publish",
      headers: mutationHeaders,
      payload: {
        ...extensionReleaseBody,
        supportedContracts: ["control_plane_v1", "control_plane_v2"],
        supportedBrowsers: ["opera", "chrome"],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(json(response)).toEqual({
      ...release,
      releasedAt: "2026-09-23T10:00:00.000Z",
      createdAt: "2026-09-23T10:00:00.000Z",
    });
    expect(calls).toContain("publishExtensionRelease");
  });
  it("publishes an add-only v2 config link through compatibility.manage with no-store", async () => {
    const configRelease = {
      configVersion: 9,
      contractVersion: "control_plane_v2",
      snapshotVersion: "bootstrap_snapshot_v2",
      envelopeVersion: "bootstrap_envelope_v2",
      contentHashSha256: "a".repeat(64),
      sourceFingerprintSha256: "b".repeat(64),
      signingKeyId: "test-ed25519",
      publishedAt: new Date("2026-09-24T10:00:00.000Z"),
      createdAt: new Date("2026-09-24T10:00:00.000Z"),
    };
    const { app, behavior, calls } = harness();
    apps.push(app);
    behavior.set("publishConfigRelease", (input) => {
      expect(input).toMatchObject({
        ...configReleaseBody,
        actorId,
        correlationId: expect.any(String),
      });
      return configRelease;
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/compatibility/config-releases/publish",
      headers: mutationHeaders,
      payload: configReleaseBody,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(json(response)).toMatchObject({
      configVersion: 9,
      contractVersion: "control_plane_v2",
      signingKeyId: "test-ed25519",
    });
    expect(json(response)).not.toHaveProperty("privateKey");
    expect(calls).toContain("publishConfigRelease");
  });
  it("rejects missing, stale-shape, duplicate, and unknown config-link fields before service", async () => {
    const { app, calls } = harness();
    apps.push(app);
    for (const payload of [
      { ...configReleaseBody, expectedLatestConfigVersion: 0 },
      Object.fromEntries(
        Object.entries(configReleaseBody).filter(
          ([key]) => key !== "expectedLatestConfigVersion",
        ),
      ),
      { ...configReleaseBody, unknown: true },
      {
        ...configReleaseBody,
        compatibilityPolicyRevisionIds: [revisionId, revisionId],
      },
      { ...configReleaseBody, compatibilityPolicyRevisionIds: [] },
    ]) {
      expectError(
        await app.inject({
          method: "POST",
          url: "/v1/admin/compatibility/config-releases/publish",
          headers: mutationHeaders,
          payload,
        }),
        400,
        "INVALID_REQUEST",
      );
    }
    expect(calls).not.toContain("publishConfigRelease");
  });
  it("forbids an admin without compatibility.manage from config release publication", async () => {
    const { app, calls } = harness({
      permissions: subject.permissions.filter(
        (permission) => permission !== "compatibility.manage",
      ),
    });
    apps.push(app);
    expectError(
      await app.inject({
        method: "POST",
        url: "/v1/admin/compatibility/config-releases/publish",
        headers: mutationHeaders,
        payload: configReleaseBody,
      }),
      403,
      "ADMIN_FORBIDDEN",
    );
    expect(calls).not.toContain("publishConfigRelease");
  });
  it("maps missing baseline/source and stale/no-op config links to safe admin errors", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    for (const message of [
      "P3_CONFIG_BASE_NOT_FOUND",
      "P3_POLICY_SOURCE_MISSING",
    ]) {
      behavior.set("publishConfigRelease", () => {
        throw new Error(message);
      });
      expectError(
        await app.inject({
          method: "POST",
          url: "/v1/admin/compatibility/config-releases/publish",
          headers: mutationHeaders,
          payload: configReleaseBody,
        }),
        404,
        "ADMIN_RESOURCE_NOT_FOUND",
      );
    }
    for (const message of [
      "P3_CONFIG_BASE_STALE",
      "P3_CONFIG_LINK_NO_CHANGE",
    ]) {
      behavior.set("publishConfigRelease", () => {
        throw new Error(message);
      });
      expectError(
        await app.inject({
          method: "POST",
          url: "/v1/admin/compatibility/config-releases/publish",
          headers: mutationHeaders,
          payload: configReleaseBody,
        }),
        409,
        "ADMIN_CONFLICT",
      );
    }
    behavior.set("publishConfigRelease", () => {
      throw Object.assign(new Error("sensitive constraint detail"), {
        code: "23505",
      });
    });
    const conflict = await app.inject({
      method: "POST",
      url: "/v1/admin/compatibility/config-releases/publish",
      headers: mutationHeaders,
      payload: configReleaseBody,
    });
    expectError(conflict, 409, "ADMIN_CONFLICT");
    expect(JSON.stringify(conflict.json())).not.toContain(
      "sensitive constraint detail",
    );
  });
  it("rejects unknown release contracts and browsers before service mutation", async () => {
    const { app, calls } = harness();
    apps.push(app);
    for (const payload of [
      { ...extensionReleaseBody, supportedContracts: ["control_plane_v3"] },
      { ...extensionReleaseBody, supportedBrowsers: ["unknown_browser"] },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/admin/compatibility/releases/0.2.4/publish",
        headers: mutationHeaders,
        payload,
      });
      expectError(response, 400, "INVALID_REQUEST");
    }
    expect(calls).not.toContain("publishExtensionRelease");
  });
  it("maps duplicate release conflicts without exposing database errors", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("publishExtensionRelease", () => {
      throw Object.assign(new Error("constraint detail"), { code: "23505" });
    });
    expectError(
      await app.inject({
        method: "POST",
        url: "/v1/admin/compatibility/releases/0.2.4/publish",
        headers: mutationHeaders,
        payload: extensionReleaseBody,
      }),
      409,
      "ADMIN_CONFLICT",
    );
    const conflict = await app.inject({
      method: "POST",
      url: "/v1/admin/compatibility/releases/0.2.4/publish",
      headers: mutationHeaders,
      payload: extensionReleaseBody,
    });
    expect(JSON.stringify(conflict.json())).not.toContain("constraint detail");
  });
  it("forbids ADMIN_OPS from extension release publication", async () => {
    const { app, calls } = harness({
      permissions: subject.permissions.filter(
        (p) => p !== "compatibility.manage",
      ),
    });
    apps.push(app);
    expectError(
      await app.inject({
        method: "POST",
        url: "/v1/admin/compatibility/releases/0.2.4/publish",
        headers: mutationHeaders,
        payload: extensionReleaseBody,
      }),
      403,
      "ADMIN_FORBIDDEN",
    );
    expect(calls).not.toContain("publishExtensionRelease");
  });
  it("maps compatibility service failure", async () => {
    const { app, behavior } = harness();
    apps.push(app);
    behavior.set("publishCompatibility", () => {
      throw new Error("database unavailable");
    });
    expectError(
      await app.inject({
        method: "POST",
        url: "/v1/admin/compatibility/policies/global/publish",
        headers: mutationHeaders,
        payload: compatibilityBody,
      }),
      503,
      "SERVICE_UNAVAILABLE",
    );
  });
  it("applies no-store to an admin detail response", async () => {
    const { app } = harness();
    apps.push(app);
    const r = await app.inject({
      url: `/v1/admin/commercial/prices/${priceId}`,
      headers: { cookie: adminCookie },
    });
    expect(r.headers["cache-control"]).toBe("no-store");
  });
  it("applies no-store to an admin mutation response", async () => {
    const { app } = harness();
    apps.push(app);
    const r = await app.inject({
      method: "POST",
      url: "/v1/admin/commercial/plans",
      headers: mutationHeaders,
      payload: planCreate,
    });
    expect(r.headers["cache-control"]).toBe("no-store");
  });
});

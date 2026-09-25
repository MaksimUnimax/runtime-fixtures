import { describe, expect, it } from "vitest";
import {
  checkOpenApiArtifact,
  compareOpenApiArtifact,
  generateOpenApiRepresentation,
} from "./openapi.js";

describe("OpenAPI foundation", () => {
  it("compares matching and modified artifacts deterministically", () => {
    const artifact = '{\n  "openapi": "3.1.0"\n}\n';
    expect(compareOpenApiArtifact(artifact, artifact)).toBe(true);
    expect(
      compareOpenApiArtifact(artifact, '{\n  "openapi": "3.0.0"\n}\n'),
    ).toBe(false);
  });

  it("generates the implemented P6.4 API surface", async () => {
    const document = JSON.parse(await generateOpenApiRepresentation()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths).sort()).toEqual(
      [
        "/health/live",
        "/health/ready",
        "/v1/accounts",
        "/v1/admin/accounts",
        "/v1/admin/accounts/{account_id}/billing/events",
        "/v1/admin/accounts/{account_id}/billing/payments",
        "/v1/admin/accounts/{account_id}/billing/reconciliation-jobs",
        "/v1/admin/accounts/{account_id}/devices",
        "/v1/admin/accounts/{account_id}/devices/{device_id}/revoke",
        "/v1/admin/accounts/{account_id}/entitlement-overrides",
        "/v1/admin/accounts/{account_id}/entitlement-overrides/{entitlement_key}/clear",
        "/v1/admin/accounts/{account_id}/entitlement-overrides/{entitlement_key}/set",
        "/v1/admin/accounts/{account_id}/entitlements/{entitlement_key}",
        "/v1/admin/accounts/{account_id}/subscription",
        "/v1/admin/accounts/{account_id}/subscription/grant",
        "/v1/admin/accounts/{account_id}/subscription/{subscription_id}/extend",
        "/v1/admin/accounts/{account_id}/subscription/{subscription_id}/restore",
        "/v1/admin/accounts/{account_id}/subscription/{subscription_id}/suspend",
        "/v1/admin/audit-events",
        "/v1/admin/beta/admission",
        "/v1/admin/commercial/entitlements/definitions",
        "/v1/admin/commercial/entitlements/definitions/{entitlement_key}/deprecate",
        "/v1/admin/commercial/entitlements/definitions/{entitlement_key}/description",
        "/v1/admin/commercial/plans",
        "/v1/admin/commercial/plans/{plan_id}",
        "/v1/admin/commercial/plans/{plan_id}/revisions",
        "/v1/admin/commercial/plans/{plan_id}/revisions/{plan_revision_id}/entitlements/{entitlement_key}/remove",
        "/v1/admin/commercial/plans/{plan_id}/revisions/{plan_revision_id}/entitlements/{entitlement_key}/set",
        "/v1/admin/commercial/plans/{plan_id}/revisions/{plan_revision_id}/publish",
        "/v1/admin/commercial/plans/{plan_id}/revisions/{plan_revision_id}/update",
        "/v1/admin/commercial/plans/{plan_id}/status",
        "/v1/admin/commercial/prices",
        "/v1/admin/commercial/prices/{price_id}",
        "/v1/admin/commercial/prices/{price_id}/revisions",
        "/v1/admin/commercial/prices/{price_id}/revisions/{price_revision_id}/publish",
        "/v1/admin/commercial/prices/{price_id}/revisions/{price_revision_id}/update",
        "/v1/admin/commercial/prices/{price_id}/sale-assignments",
        "/v1/admin/commercial/prices/{price_id}/status",
        "/v1/admin/compatibility/policies",
        "/v1/admin/compatibility/policies/{policy_key}/publish",
        "/v1/admin/compatibility/config-releases/publish",
        "/v1/admin/compatibility/releases/{version}/publish",
        "/v1/admin/health/diagnostics/breakdown",
        "/v1/admin/health/diagnostics/summary",
        "/v1/admin/health/evaluations",
        "/v1/admin/health/evaluations/{id}",
        "/v1/admin/health/incidents",
        "/v1/admin/health/incidents/{id}",
        "/v1/admin/health/notifications",
        "/v1/admin/health/notifications/{id}",
        "/v1/admin/health/recommendations",
        "/v1/admin/health/targets",
        "/v1/admin/health/targets/{target_id}",
        "/v1/admin/ai/assignments",
        "/v1/admin/ai/assignments/{assignment_id}",
        "/v1/admin/ai/assignments/{assignment_id}/complete",
        "/v1/admin/ai/assignments/{assignment_id}/direct",
        "/v1/admin/ai/assignments/{assignment_id}/pause",
        "/v1/admin/ai/assignments/{assignment_id}/percentage",
        "/v1/admin/ai/assignments/{assignment_id}/revisions",
        "/v1/admin/ai/assignments/{assignment_id}/resume",
        "/v1/admin/ai/assignments/{assignment_id}/rollback",
        "/v1/admin/ai/assignments/{assignment_id}/rollout",
        "/v1/admin/ai/profiles",
        "/v1/admin/ai/profiles/{profile_id}",
        "/v1/admin/ai/profiles/{profile_id}/metadata",
        "/v1/admin/ai/profiles/{profile_id}/revisions",
        "/v1/admin/ai/profiles/{profile_id}/revisions/{revision}",
        "/v1/admin/ai/profiles/{profile_id}/revisions/{revision}/candidate",
        "/v1/admin/ai/profiles/{profile_id}/revisions/{revision}/publish",
        "/v1/admin/ai/profiles/{profile_id}/revisions/{revision}/replace",
        "/v1/admin/ai/profiles/{profile_id}/revisions/{revision}/retire",
        "/v1/admin/ai/profiles/{profile_id}/status",
        "/v1/admin/ai/registry/adapters",
        "/v1/admin/ai/registry/adapters/{adapter_id}/metadata",
        "/v1/admin/ai/registry/adapters/{adapter_id}/status",
        "/v1/admin/ai/registry/adapters/{adapter_id}/surfaces",
        "/v1/admin/ai/registry/surfaces",
        "/v1/admin/ai/registry/surfaces/{surface_id}/variants",
        "/v1/admin/ai/registry/surfaces/{surface_id}/metadata",
        "/v1/admin/ai/registry/surfaces/{surface_id}/status",
        "/v1/admin/ai/registry/variants",
        "/v1/admin/ai/registry/variants/{variant_id}/metadata",
        "/v1/admin/ai/registry/variants/{variant_id}/status",
        "/v1/admin/me",
        "/v1/admin/principals",
        "/v1/admin/principals/{principal_id}/restore",
        "/v1/admin/principals/{principal_id}/roles/{role}/grant",
        "/v1/admin/principals/{principal_id}/roles/{role}/revoke",
        "/v1/admin/principals/{principal_id}/suspend",
        "/v1/admin/session",
        "/v1/admin/support/aggregates",
        "/v1/admin/support/cases",
        "/v1/admin/support/cases/{case_id}",
        "/v1/admin/support/cases/{case_id}/followups",
        "/v1/admin/support/cases/{case_id}/status",
        "/v1/admin/support/funnels",
        "/v1/admin/users",
        "/v1/auth/logout",
        "/v1/auth/otp/request",
        "/v1/auth/otp/verify",
        "/v1/auth/refresh",
        "/v1/billing/payments",
        "/v1/bootstrap",
        "/v1/credential-transfers",
        "/v1/credential-transfers/pending/source",
        "/v1/credential-transfers/{requestId}",
        "/v1/credential-transfers/{requestId}/ack",
        "/v1/credential-transfers/{requestId}/cancel",
        "/v1/credential-transfers/{requestId}/packet",
        "/v1/credential-transfers/{requestId}/source-seen",
        "/v1/device-authorizations",
        "/v1/device-authorizations/token",
        "/v1/device-authorizations/{id}",
        "/v1/device-authorizations/{id}/approve",
        "/v1/device-authorizations/{id}/deny",
        "/v1/devices",
        "/v1/devices/current/client-metadata/forget",
        "/v1/devices/{device_id}/revoke",
        "/v1/health-authority",
        "/v1/plans/public",
        "/v1/subscription",
        "/v1/sync",
        "/v1/support/cases",
        "/v1/support/cases/{case_id}",
        "/v1/support/cases/{case_id}/followups",
        "/v1/support/signals",
      ].sort(),
    );
    expect(document.paths).toHaveProperty("/v1/bootstrap");
    expect(document.paths).not.toHaveProperty("/v1/billing/checkouts");
    expect(document.paths).not.toHaveProperty("/test-controlled-error");
  });

  it("documents the strict config release mutation without caller timestamps", async () => {
    const document = JSON.parse(await generateOpenApiRepresentation()) as {
      paths: Record<
        string,
        {
          post: {
            requestBody: {
              content: Record<string, { schema: unknown }>;
            };
          };
        }
      >;
    };
    const operation =
      document.paths["/v1/admin/compatibility/config-releases/publish"]!.post;
    expect(
      operation.requestBody.content["application/json"]!.schema,
    ).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        contractVersion: {
          enum: ["control_plane_v1", "control_plane_v2"],
          type: "string",
        },
        expectedLatestConfigVersion: { type: "integer" },
        compatibilityPolicyRevisionIds: {
          type: "array",
          items: { type: "string", format: "uuid" },
        },
        reason: { type: "string" },
      },
      required: [
        "contractVersion",
        "expectedLatestConfigVersion",
        "compatibilityPolicyRevisionIds",
        "reason",
      ],
    });
    const schemaText = JSON.stringify(
      operation.requestBody.content["application/json"]!.schema,
    );
    for (const forbidden of [
      "publishedAt",
      "signingKeyId",
      "snapshotVersion",
      "envelopeVersion",
      "featureRuleRevisionIds",
      "featureRolloutRevisionIds",
    ])
      expect(schemaText).not.toContain(forbidden);
  });

  it("documents privacy-neutral device metadata as explicit PRESENT/WITHHELD unions", async () => {
    type JsonSchema = {
      anyOf?: JsonSchema[];
      enum?: string[];
      items?: JsonSchema;
      properties?: Record<string, JsonSchema>;
      required?: string[];
    };
    type OpenApiDocument = {
      paths: Record<
        string,
        {
          get?: {
            responses: Record<
              string,
              { content: Record<string, { schema: JsonSchema }> }
            >;
          };
          post?: {
            requestBody: {
              content: Record<string, { schema: JsonSchema }>;
            };
          };
        }
      >;
    };
    const document = JSON.parse(
      await generateOpenApiRepresentation(),
    ) as OpenApiDocument;
    const start =
      document.paths["/v1/device-authorizations"]!.post!.requestBody.content[
        "application/json"
      ]!.schema;
    const startBranches = start.anyOf ?? [];
    expect(startBranches).toHaveLength(2);
    const identifiedStart = startBranches.find((schema) =>
      schema.required?.includes("browserFamily"),
    );
    const withheldStart = startBranches.find(
      (schema) => !schema.required?.includes("browserFamily"),
    );
    if (!identifiedStart || !withheldStart)
      throw new Error("privacy-neutral start branches missing");
    expect(identifiedStart.required).toEqual(
      expect.arrayContaining([
        "clientType",
        "browserFamily",
        "extensionVersion",
      ]),
    );
    expect(withheldStart.required).toEqual(["clientType"]);
    expect(withheldStart.properties).not.toHaveProperty("browserFamily");
    expect(withheldStart.properties).not.toHaveProperty("browserVersion");
    expect(withheldStart.properties).not.toHaveProperty("extensionVersion");

    const preview =
      document.paths["/v1/device-authorizations/{id}"]!.get!.responses["200"]!
        .content["application/json"]!.schema;
    const previewBranches = preview.anyOf ?? [];
    expect(previewBranches).toHaveLength(2);
    const state = (schema: JsonSchema) =>
      schema.properties?.clientMetadata?.properties?.state?.enum?.[0];
    const withheldPreview = previewBranches.find(
      (schema) => state(schema) === "WITHHELD",
    );
    const presentPreview = previewBranches.find(
      (schema) => state(schema) === "PRESENT",
    );
    if (!withheldPreview || !presentPreview)
      throw new Error("privacy-neutral preview branches missing");
    expect(withheldPreview.required).not.toContain("browserFamily");
    expect(withheldPreview.properties).not.toHaveProperty("browserFamily");
    expect(presentPreview.required).toEqual(
      expect.arrayContaining([
        "browserFamily",
        "browserVersion",
        "extensionVersion",
      ]),
    );

    const items =
      document.paths["/v1/devices"]!.get!.responses["200"]!.content[
        "application/json"
      ]!.schema.properties?.devices?.items;
    if (!items) throw new Error("device item schema missing");
    const itemBranches = items.anyOf ?? [];
    expect(itemBranches).toHaveLength(2);
    const withheldDevice = itemBranches.find(
      (schema) => state(schema) === "WITHHELD",
    );
    const presentDevice = itemBranches.find(
      (schema) => state(schema) === "PRESENT",
    );
    if (!withheldDevice || !presentDevice)
      throw new Error("privacy-neutral device branches missing");
    expect(withheldDevice.properties).not.toHaveProperty("browserFamily");
    expect(withheldDevice.properties).not.toHaveProperty(
      "extensionVersionLastSeen",
    );
    expect(presentDevice.required).toEqual(
      expect.arrayContaining([
        "browserFamily",
        "browserVersionLastSeen",
        "extensionVersionLastSeen",
      ]),
    );

    const adminItems =
      document.paths["/v1/admin/accounts/{account_id}/devices"]!.get!.responses[
        "200"
      ]!.content["application/json"]!.schema.properties?.items?.items;
    if (!adminItems) throw new Error("admin device item schema missing");
    const adminBranches = adminItems.anyOf ?? [];
    expect(adminBranches).toHaveLength(2);
    const adminPresent = adminBranches.find((schema) =>
      schema.required?.includes("browserFamily"),
    );
    const adminWithheld = adminBranches.find(
      (schema) => !schema.required?.includes("browserFamily"),
    );
    if (!adminPresent || !adminWithheld)
      throw new Error("admin PRESENT/WITHHELD branches missing");
    expect(adminWithheld.properties).not.toHaveProperty("browserFamily");
    expect(adminWithheld.properties).not.toHaveProperty(
      "extensionVersionLastSeen",
    );
    expect(adminPresent.required).toEqual(
      expect.arrayContaining([
        "browserFamily",
        "browserVersionLastSeen",
        "extensionVersionLastSeen",
      ]),
    );
  });

  it("documents identified and privacy-neutral control_plane_v2 bootstrap variants explicitly", async () => {
    type JsonSchema = {
      anyOf?: JsonSchema[];
      enum?: string[];
      properties?: Record<string, JsonSchema>;
      required?: string[];
    };
    const document = JSON.parse(await generateOpenApiRepresentation()) as {
      paths: Record<
        string,
        {
          post: {
            requestBody: {
              content: Record<string, { schema: JsonSchema }>;
            };
          };
        }
      >;
    };
    const schema =
      document.paths["/v1/bootstrap"]!.post.requestBody.content[
        "application/json"
      ]!.schema;
    const v2 = (schema.anyOf ?? []).find((branch) =>
      branch.anyOf?.some(
        (candidate) =>
          candidate.properties?.contractVersion?.enum?.[0] ===
          "control_plane_v2",
      ),
    );
    if (!v2?.anyOf) throw new Error("control_plane_v2 bootstrap union missing");
    expect(v2.anyOf).toHaveLength(2);
    const identified = v2.anyOf.find((branch) =>
      branch.required?.includes("extensionVersion"),
    );
    const neutral = v2.anyOf.find(
      (branch) => !branch.required?.includes("extensionVersion"),
    );
    if (!identified || !neutral)
      throw new Error("identified/privacy-neutral bootstrap branches missing");
    expect(identified.required).toEqual(
      expect.arrayContaining([
        "contractVersion",
        "extensionVersion",
        "browser",
        "deviceId",
        "lastConfigVersion",
      ]),
    );
    expect(neutral.required).toEqual([
      "contractVersion",
      "deviceId",
      "lastConfigVersion",
    ]);
    expect(neutral.properties).not.toHaveProperty("extensionVersion");
    expect(neutral.properties).not.toHaveProperty("browser");
  });

  it("accepts the tracked artifact when it is generated from the current routes", async () => {
    await expect(checkOpenApiArtifact()).resolves.toBe(true);
  });
});

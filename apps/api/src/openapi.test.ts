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
        "/v1/admin/users",
        "/v1/auth/logout",
        "/v1/auth/otp/request",
        "/v1/auth/otp/verify",
        "/v1/auth/refresh",
        "/v1/billing/payments",
        "/v1/bootstrap",
        "/v1/device-authorizations",
        "/v1/device-authorizations/token",
        "/v1/device-authorizations/{id}",
        "/v1/device-authorizations/{id}/approve",
        "/v1/device-authorizations/{id}/deny",
        "/v1/devices",
        "/v1/devices/{device_id}/revoke",
        "/v1/plans/public",
        "/v1/subscription",
      ].sort(),
    );
    expect(document.paths).toHaveProperty("/v1/bootstrap");
    expect(document.paths).not.toHaveProperty("/v1/billing/checkouts");
    expect(document.paths).not.toHaveProperty("/test-controlled-error");
  });

  it("accepts the tracked artifact when it is generated from the current routes", async () => {
    await expect(checkOpenApiArtifact()).resolves.toBe(true);
  });
});

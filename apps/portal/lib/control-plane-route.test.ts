import { describe, expect, it } from "vitest";
import { allowedRoute } from "./control-plane-route";

describe("B16-03 authenticated own-case support-response proxy", () => {
  const id = "00000000-0000-4000-8000-000000000003";

  it("allows only the existing read-only user case-detail API", () => {
    expect(allowedRoute("GET", `/v1/support/cases/${id}`)).toBe(
      "/v1/support/cases/:id",
    );
    expect(allowedRoute("GET", "/v1/support/cases")).toBe("/v1/support/cases");
    expect(allowedRoute("POST", "/v1/support/cases")).toBe("/v1/support/cases");
  });

  it("does not admit admin, mutation, arbitrary identifiers or user-composer routes", () => {
    expect(allowedRoute("POST", `/v1/support/cases/${id}`)).toBeUndefined();
    expect(
      allowedRoute("POST", `/v1/support/cases/${id}/followups`),
    ).toBeUndefined();
    expect(
      allowedRoute("GET", `/v1/admin/support/cases/${id}`),
    ).toBeUndefined();
    expect(
      allowedRoute("GET", "/v1/support/cases/not-a-case-id"),
    ).toBeUndefined();
    expect(
      allowedRoute("GET", `/v1/support/cases/${id}/followups`),
    ).toBeUndefined();
  });
});

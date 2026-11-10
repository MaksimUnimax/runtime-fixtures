import { describe, expect, it } from "vitest";
import { accountCodeReadIntent, allowedRoute } from "./control-plane-route";

describe("ACW1 forwarded GET read boundary", () => {
  const account = "11112233-4455-4677-8899-aabbccddeeff";
  const operation = "77112233-4455-4677-8899-aabbccddeeff";
  const path = `/v1/accounts/${account}/connection-code`;
  it.each(["issue", "rotate"])("admits only GET action %s", (mode) => {
    expect(accountCodeReadIntent("GET", path, `?action=${mode}`)).toEqual({
      accountId: account, mode, errorOperation: mode,
    });
    expect(allowedRoute("GET", path, `?action=${mode}`)).toBe("/v1/accounts/:id/connection-code");
    expect(allowedRoute("POST", path, `?action=${mode}`)).toBeUndefined();
  });
  it("captures lookup from request and never invents its error operation", () => {
    expect(accountCodeReadIntent("GET", path, `?operationId=${operation}`)).toEqual({
      accountId: account, mode: "lookup", operationId: operation, errorOperation: null,
    });
  });
  it.each(["", "?action=connect", "?action=issue&action=rotate", "?action=issue&debug=x",
    `?action=issue&operationId=${operation}`, `?operationId=${operation}&operationId=${operation}`])(
    "rejects ambiguous/unsupported query %s", (query) => {
      expect(allowedRoute("GET", path, query)).toBeUndefined();
    },
  );
  it("does not apply legacy UUID normalization as ACW1 identity validation", () => {
    for (const id of [account.toUpperCase(), ":id", "not-an-id"])
      expect(allowedRoute("GET", `/v1/accounts/${id}/connection-code`, "?action=issue")).toBeUndefined();
    expect(allowedRoute("GET", path + "/rotate")).toBeUndefined();
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "HEAD"])
      expect(allowedRoute(method, path, "?action=issue")).toBeUndefined();
    expect(allowedRoute("POST", "/v1/account-code/attempts")).toBeUndefined();
  });
});

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

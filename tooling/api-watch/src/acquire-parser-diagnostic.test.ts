import { describe, expect, it } from "vitest";
import { acquireOfficialSource } from "./acquire.js";
import type { SourceRegistryEntry } from "./types.js";

const marker = "OCTO_C03";
const entry: SourceRegistryEntry = {
  sourceFamily: "OZON_SELLER",
  officialUrl: "https://docs.ozon.ru/spec.json",
  acceptedHosts: ["docs.ozon.ru"],
  expectedArtifactTypes: ["JSON", "YAML", "YML"],
  maximumBytes: 1024 * 1024,
  acquisitionPolicy: "OPERATOR_ASSISTED_WHEN_AUTOMATIC_ACCESS_IS_BLOCKED",
  operatorAcceptancePolicy: "DETERMINISTIC",
};

async function acquireSynthetic(
  officialUrl: string,
  body: string,
  overrides: Partial<SourceRegistryEntry> = {},
) {
  let calls = 0;
  const result = await acquireOfficialSource({
    entry: { ...entry, officialUrl, ...overrides },
    timeoutMs: 200,
    fetcher: async () => {
      calls += 1;
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      });
    },
  });
  expect(calls).toBe(1);
  return result;
}

describe("C03 official-source diagnostic privacy", () => {
  it.each([
    ["JSON", "https://docs.ozon.ru/spec.json", marker + "_NOT_JSON"],
    ["YAML", "https://docs.ozon.ru/spec.yaml", "openapi: [" + marker],
  ])(
    "never copies a malformed %s input marker into a result diagnostic",
    async (_kind, url, body) => {
      const result = await acquireSynthetic(url, body);
      expect(result.kind).toBe("INVALID_OFFICIAL_SOURCE_RESPONSE");
      if (result.kind !== "INVALID_OFFICIAL_SOURCE_RESPONSE") return;
      expect(result.blockerReason).toBe(
        "Official source document validation failed.",
      );
      expect(result.blockerReason).not.toContain(marker);
    },
  );

  it("retains the known fixed root validation code", async () => {
    const result = await acquireSynthetic(
      entry.officialUrl!,
      JSON.stringify({ openapi: "3.0.3", paths: {} }),
    );
    expect(result.kind).toBe("INVALID_OFFICIAL_SOURCE_RESPONSE");
    if (result.kind !== "INVALID_OFFICIAL_SOURCE_RESPONSE") return;
    expect(result.blockerReason).toBe("OPENAPI_INFO_MISSING");
  });

  it("retains the safe fixed official title identity code", async () => {
    const result = await acquireSynthetic(
      entry.officialUrl!,
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "synthetic", version: "1" },
        paths: {},
      }),
      { titlePattern: /^expected title$/ },
    );
    expect(result.kind).toBe("INVALID_OFFICIAL_SOURCE_RESPONSE");
    if (result.kind !== "INVALID_OFFICIAL_SOURCE_RESPONSE") return;
    expect(result.blockerReason).toBe("SOURCE_TITLE_IDENTITY_MISMATCH");
  });

  it("retains the safe fixed official server identity code", async () => {
    const result = await acquireSynthetic(
      entry.officialUrl!,
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "synthetic", version: "1" },
        paths: {},
        servers: [{ url: "https://unrelated.fixture.invalid" }],
      }),
      { requiredServerIdentity: "https://api.fixture.invalid" },
    );
    expect(result.kind).toBe("INVALID_OFFICIAL_SOURCE_RESPONSE");
    if (result.kind !== "INVALID_OFFICIAL_SOURCE_RESPONSE") return;
    expect(result.blockerReason).toBe("SOURCE_SERVER_IDENTITY_MISMATCH");
  });

  const swagger2 = (identity: Record<string, unknown>) => ({
    swagger: "2.0",
    info: { title: "Seller API", version: "1" },
    paths: {
      "/items": {
        get: { responses: { "200": { description: "ok" } } },
      },
    },
    ...identity,
  });

  it.each([
    [
      "explicit HTTPS root",
      { host: "api-seller.ozon.ru", schemes: ["https"], basePath: "/" },
      "https://api-seller.ozon.ru",
    ],
    [
      "implicit HTTPS from the official document",
      { host: "api-seller.ozon.ru" },
      "https://api-seller.ozon.ru",
    ],
    [
      "explicit matching API base path",
      { host: "api-seller.ozon.ru", schemes: ["https"], basePath: "/v2" },
      "https://api-seller.ozon.ru/v2",
    ],
  ] as const)(
    "recognizes the Swagger 2.0 server identity from %s",
    async (_name, fields, requiredServerIdentity) => {
      const result = await acquireSynthetic(
        entry.officialUrl!,
        JSON.stringify(swagger2(fields)),
        { requiredServerIdentity },
      );
      expect(result.kind).toBe("ACQUIRED_OFFICIAL_SOURCE_CANDIDATE");
    },
  );

  it.each([
    ["different API host", { host: "other.example", schemes: ["https"] }],
    ["insecure HTTP only", { host: "api-seller.ozon.ru", schemes: ["http"] }],
    [
      "different API base path",
      { host: "api-seller.ozon.ru", schemes: ["https"], basePath: "/v2" },
    ],
    ["missing host defaults to the documentation host", { schemes: ["https"] }],
    [
      "OpenAPI 3 servers cannot replace a Swagger 2 host",
      {
        host: "other.example",
        schemes: ["https"],
        servers: [{ url: "https://api-seller.ozon.ru" }],
      },
    ],
  ] as const)(
    "rejects Swagger 2.0 %s against the approved server identity",
    async (_name, fields) => {
      const result = await acquireSynthetic(
        entry.officialUrl!,
        JSON.stringify(swagger2(fields)),
        { requiredServerIdentity: "https://api-seller.ozon.ru" },
      );
      expect(result.kind).toBe("INVALID_OFFICIAL_SOURCE_RESPONSE");
      if (result.kind !== "INVALID_OFFICIAL_SOURCE_RESPONSE") return;
      expect(result.blockerReason).toBe("SOURCE_SERVER_IDENTITY_MISMATCH");
    },
  );
});

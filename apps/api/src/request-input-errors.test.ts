import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiErrorEnvelopeV1Schema } from "@product/contracts";
import type { AppConfig } from "@product/shared";
import { ControlledError, createApiApp } from "./app.js";

const captured = vi.hoisted(() => ({ lines: [] as string[] }));
vi.mock("@product/observability", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@product/observability")>();
  return {
    ...actual,
    createLogger: (level: string) =>
      actual.createLogger(level, {
        write(line: string) {
          captured.lines.push(line);
        },
      }),
  };
});

// No database, account, network listener or real credential is used by this test.
// The production Fastify parser, logger and application error handler are used.
const config: AppConfig = {
  environment: "test",
  databaseUrl: "postgresql://example.invalid/unconnected_fixture",
  logLevel: "info",
  apiPort: 0,
  workerReadyDelayMs: 0,
};
const apps: ReturnType<typeof createApiApp>[] = [];
function fixture(limit = 1024) {
  const app = createApiApp({ config, isInfrastructureReady: async () => true });
  apps.push(app);
  const handler = vi.fn(async () => ({ accepted: true }));
  app.post("/test-request-input", { bodyLimit: limit }, handler);
  return { app, handler };
}
beforeEach(() => {
  captured.lines.length = 0;
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const cases = [
  {
    name: "malformed JSON",
    payload: "B06CANARY_ONLY_SYNTHETIC",
    type: "application/json",
    status: 400,
  },
  { name: "empty JSON", payload: "", type: "application/json", status: 400 },
  {
    name: "oversized JSON",
    payload: JSON.stringify({ value: "B06CANARY".repeat(10) }),
    type: "application/json",
    status: 413,
    limit: 32,
  },
  {
    name: "unsupported media type",
    payload: "B06CANARY_ONLY_SYNTHETIC",
    type: "application/x-fixture",
    status: 415,
  },
  {
    name: "incorrect content length",
    payload: "{}",
    type: "application/json",
    status: 400,
    contentLength: "10",
  },
];

describe("native request parser errors", () => {
  it.each(cases)(
    "preserves client status for $name without logging body text",
    async (test) => {
      const { app, handler } = fixture(test.limit);
      const response = await app.inject({
        method: "POST",
        url: "/test-request-input",
        headers: {
          "content-type": test.type,
          "x-request-id": "b06-input-parser-test",
          ...(test.contentLength
            ? { "content-length": test.contentLength }
            : {}),
        },
        payload: test.payload,
      });
      expect(handler).not.toHaveBeenCalled();
      expect(response.body).not.toContain("B06CANARY");
      expect(captured.lines.join("\n")).not.toContain("B06CANARY");
      expect(response.statusCode).toBe(test.status);
      const entries = captured.lines.map(
        (line) =>
          JSON.parse(line) as {
            level: number;
            msg: string;
            statusCode?: number;
          },
      );
      expect(entries.filter((entry) => entry.level >= 50)).toEqual([]);
      expect(entries).toContainEqual(
        expect.objectContaining({
          level: 40,
          msg: "Rejected invalid request body",
          statusCode: test.status,
        }),
      );
      expect(
        ApiErrorEnvelopeV1Schema.parse(response.json()).error,
      ).toMatchObject({
        code: "INVALID_REQUEST",
        message: "Invalid request",
        correlationId: "b06-input-parser-test",
      });
    },
  );

  it("still passes valid JSON to the handler", async () => {
    const { app, handler } = fixture();
    const response = await app.inject({
      method: "POST",
      url: "/test-request-input",
      payload: { value: "synthetic" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("keeps schema validation as INVALID_REQUEST", async () => {
    const { app } = fixture();
    app.post(
      "/test-schema-input",
      { schema: { body: z.object({ count: z.number() }).strict() } },
      async () => ({ accepted: true }),
    );
    const response = await app.inject({
      method: "POST",
      url: "/test-schema-input",
      payload: { count: "not-a-number" },
    });
    expect(response.statusCode).toBe(400);
    expect(ApiErrorEnvelopeV1Schema.parse(response.json()).error.code).toBe(
      "INVALID_REQUEST",
    );
  });

  it("does not trust statusCode on an unexpected application error", async () => {
    const { app } = fixture();
    app.get("/test-unexpected-input-error", () => {
      throw Object.assign(new Error("fixture application failure"), {
        statusCode: 400,
        code: "UNKNOWN_FIXTURE_CODE",
      });
    });
    const response = await app.inject("/test-unexpected-input-error");
    expect(response.statusCode).toBe(500);
    expect(ApiErrorEnvelopeV1Schema.parse(response.json()).error.code).toBe(
      "INTERNAL_ERROR",
    );
  });

  it("does not trust a parser code with an inconsistent status", async () => {
    const { app } = fixture();
    app.get("/test-inconsistent-parser-error", () => {
      throw Object.assign(new Error("fixture application failure"), {
        statusCode: 503,
        code: "FST_ERR_CTP_INVALID_JSON_BODY",
      });
    });
    const response = await app.inject("/test-inconsistent-parser-error");
    expect(response.statusCode).toBe(500);
    expect(ApiErrorEnvelopeV1Schema.parse(response.json()).error.code).toBe(
      "INTERNAL_ERROR",
    );
  });

  it("preserves an explicit controlled service-unavailable response", async () => {
    const { app } = fixture();
    app.get("/test-controlled-input-error", () => {
      throw new ControlledError(
        "SERVICE_UNAVAILABLE",
        "Fixture unavailable",
        503,
      );
    });
    const response = await app.inject("/test-controlled-input-error");
    expect(response.statusCode).toBe(503);
    expect(ApiErrorEnvelopeV1Schema.parse(response.json()).error.code).toBe(
      "SERVICE_UNAVAILABLE",
    );
  });
});

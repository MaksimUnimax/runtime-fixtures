import { describe, expect, it } from "vitest";
import { createLogger, SensitiveLogPaths } from "./index.js";

describe("SensitiveLogPaths", () => {
  it("protects the recognized secret aliases", () => {
    expect(SensitiveLogPaths).toEqual(
      expect.arrayContaining([
        "authorization",
        "cookie",
        '["set-cookie"]',
        "password",
        "token",
        "secret",
        "refresh_token",
        "refreshToken",
        "access_token",
        "accessToken",
        "api_key",
        "apiKey",
        "req.headers.authorization",
        "req.headers.cookie",
        'req.headers["set-cookie"]',
        "req.raw",
        "request.raw",
        "ctx.request",
      ]),
    );
  });

  const nestedRequestCases: {
    label: string;
    record: Record<string, unknown>;
    marker: string;
  }[] = [
    {
      label: "req.body",
      record: {
        req: {
          method: "POST",
          body: { password: "SYNTHETIC_REQ_BODY_MARKER" },
        },
      },
      marker: "SYNTHETIC_REQ_BODY_MARKER",
    },
    {
      label: "req.query",
      record: {
        req: {
          method: "GET",
          query: { access_token: "SYNTHETIC_REQ_QUERY_MARKER" },
        },
      },
      marker: "SYNTHETIC_REQ_QUERY_MARKER",
    },
    {
      label: "req.headers",
      record: {
        req: {
          method: "GET",
          headers: { "x-api-key": "SYNTHETIC_REQ_HEADER_MARKER" },
        },
      },
      marker: "SYNTHETIC_REQ_HEADER_MARKER",
    },
    {
      label: "req.url",
      record: {
        req: { method: "GET", url: "/v1/test?code=SYNTHETIC_REQ_URL_MARKER" },
      },
      marker: "SYNTHETIC_REQ_URL_MARKER",
    },
    {
      label: "req.raw.headers",
      record: {
        req: {
          method: "GET",
          raw: { headers: { "x-private-token": "SYNTHETIC_RAW_HEADER_TOKEN" } },
        },
      },
      marker: "SYNTHETIC_RAW_HEADER_TOKEN",
    },
    {
      label: "req.raw.url",
      record: {
        req: {
          method: "GET",
          raw: { url: "/test?code=SYNTHETIC_RAW_URL_CODE" },
        },
      },
      marker: "SYNTHETIC_RAW_URL_CODE",
    },
    {
      label: "request.raw.headers",
      record: {
        request: {
          method: "GET",
          raw: {
            headers: { "x-private-token": "SYNTHETIC_REQUEST_RAW_HEADER" },
          },
        },
      },
      marker: "SYNTHETIC_REQUEST_RAW_HEADER",
    },
    {
      label: "ctx.request.headers",
      record: {
        req: { method: "GET" },
        ctx: {
          request: {
            method: "GET",
            headers: { "x-private-token": "SYNTHETIC_CTX_REQUEST_HEADER" },
          },
        },
      },
      marker: "SYNTHETIC_CTX_REQUEST_HEADER",
    },
    {
      label: "request.body",
      record: {
        request: {
          method: "POST",
          body: { password: "SYNTHETIC_REQUEST_BODY_MARKER" },
        },
      },
      marker: "SYNTHETIC_REQUEST_BODY_MARKER",
    },
    {
      label: "request.query",
      record: {
        request: {
          method: "GET",
          query: { token: "SYNTHETIC_REQUEST_QUERY_MARKER" },
        },
      },
      marker: "SYNTHETIC_REQUEST_QUERY_MARKER",
    },
    {
      label: "request.headers",
      record: {
        request: {
          method: "GET",
          headers: { "x-api-key": "SYNTHETIC_REQUEST_HEADER_MARKER" },
        },
      },
      marker: "SYNTHETIC_REQUEST_HEADER_MARKER",
    },
    {
      label: "request.url",
      record: {
        request: {
          method: "GET",
          url: "/v1/test?code=SYNTHETIC_REQUEST_URL_MARKER",
        },
      },
      marker: "SYNTHETIC_REQUEST_URL_MARKER",
    },
  ];
  it.each(nestedRequestCases)(
    "redacts nested structured request field $label without removing metadata",
    ({ record, marker }) => {
      const lines: string[] = [];
      const logger = createLogger("info", {
        write: (line: string) => {
          lines.push(line);
          return true;
        },
      });
      logger.info({ ...record, safeEvent: "synthetic-redaction-check" });
      const result = lines.join("");
      expect(result).not.toContain(marker);
      expect(result).toContain("synthetic-redaction-check");
      expect(result).toContain('"method":"');
    },
  );

  it("redacts device-authorization secrets from structured log records", () => {
    const lines: string[] = [];
    const logger = createLogger("info", {
      write: (line: string) => {
        lines.push(line);
        return true;
      },
    });
    const values = {
      deviceCode: "synthetic-device-code",
      userCode: "synthetic-user-code",
      idempotency: "synthetic-idempotency-key",
      session: "synthetic-portal-session",
      csrf: "synthetic-csrf-token",
      envelope: "synthetic-envelope-ciphertext",
    };
    logger.info({
      deviceCode: values.deviceCode,
      userCode: values.userCode,
      ciphertext: values.envelope,
      req: {
        ip: "198.51.100.25",
        remoteAddress: "198.51.100.25",
        headers: {
          "idempotency-key": values.idempotency,
          cookie: `pcp_portal_session=${values.session}; pcp_csrf=${values.csrf}`,
          "x-csrf-token": values.csrf,
        },
      },
    });
    const serialized = lines.join("");
    for (const value of Object.values(values))
      expect(serialized).not.toContain(value);
    expect(serialized).not.toContain("198.51.100.25");
  });
});

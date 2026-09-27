import { describe, expect, it, vi } from "vitest";
import type { BootstrapService } from "@product/bootstrap";
import type { ExtensionAuthService } from "@product/extension-auth";
import type { AppConfig } from "@product/shared";
import { createApiApp } from "./app.js";

const config: AppConfig = {
  environment: "test",
  databaseUrl: "postgres://test:test@localhost:5432/test",
  logLevel: "silent" as AppConfig["logLevel"],
  apiPort: 3000,
  workerReadyDelayMs: 0,
};
const principal = {
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};
const identified = {
  extensionVersion: "1.2.3",
  browser: { family: "chrome", version: "120" },
  deviceId: principal.deviceId,
  lastConfigVersion: null,
};
const envelope = (version: 1 | 2 | 3) => ({
  envelopeVersion: `bootstrap_envelope_v${version}`,
  algorithm: "Ed25519",
  keyId: "config-key",
  payload: "eA",
  signature: "c2ln",
});

describe("bootstrap version negotiation", () => {
  it("routes v1, v2, and standalone v3 to their producers and rejects unknown versions", async () => {
    const service = {
      issue: vi.fn(async () => envelope(1)),
      issueV2: vi.fn(async () => envelope(2)),
      issueV3: vi.fn(async () => envelope(3)),
    };
    const auth = {
      authenticateAccess: vi.fn(async () => ({
        ok: true as const,
        value: principal,
      })),
    };
    const app = createApiApp({
      config,
      isInfrastructureReady: async () => true,
      extensionAuthService: auth as unknown as ExtensionAuthService,
      bootstrapService: service as unknown as BootstrapService,
    });
    for (const [version, expectedStatus] of [
      ["control_plane_v1", 200],
      ["control_plane_v2", 200],
      ["control_plane_v3", 200],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/bootstrap",
        headers: { authorization: "Bearer synthetic-access-token" },
        payload: {
          ...identified,
          contractVersion: version,
        },
      });
      expect(response.statusCode).toBe(expectedStatus);
      expect(response.json().envelopeVersion).toBe(
        `bootstrap_envelope_v${version.slice(-1)}`,
      );
    }
    expect(service.issue).toHaveBeenCalledOnce();
    expect(service.issueV2).toHaveBeenCalledOnce();
    expect(service.issueV3).toHaveBeenCalledOnce();
    const unknown = await app.inject({
      method: "POST",
      url: "/v1/bootstrap",
      headers: { authorization: "Bearer synthetic-access-token" },
      payload: { ...identified, contractVersion: "control_plane_v99" },
    });
    expect(unknown.statusCode).toBe(400);
    expect(service.issueV3).toHaveBeenCalledOnce();
    await app.close();
  });
});

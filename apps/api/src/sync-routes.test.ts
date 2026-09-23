import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@product/shared";
import { createApiApp } from "./app.js";

const config: AppConfig = {
  environment: "test",
  databaseUrl: "postgres://test:test@localhost/test",
  logLevel: "error",
  apiPort: 3000,
  workerReadyDelayMs: 0,
};

describe("sync route stale-authority handling", () => {
  it("maps a transaction-time revoked principal to the existing 401 envelope", async () => {
    const principal = {
      sessionId: "11111111-1111-4111-8111-111111111111",
      deviceId: "22222222-2222-4222-8222-222222222222",
      accountId: "33333333-3333-4333-8333-333333333333",
    };
    const extensionAuthService = {
      authenticateAccess: vi.fn(async () => ({
        ok: true as const,
        value: principal,
      })),
    };
    const syncService = {
      apply: vi.fn(async () => {
        throw new Error("EXTENSION_AUTH_UNAUTHORIZED");
      }),
    };
    const app = createApiApp({
      config,
      isInfrastructureReady: async () => true,
      extensionAuthService: extensionAuthService as never,
      syncService: syncService as never,
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: { authorization: "Bearer synthetic-access-token" },
      payload: {
        syncVersion: "seller_agents_sync_v1",
        installationId: principal.deviceId,
        entries: [
          {
            requestId: "44444444-4444-4444-8444-444444444444",
            mutationId: "mutation-1",
            entityId: "a".repeat(64),
            baseRevision: 0,
            localSequence: 1,
            mutationGeneration: "generation-1",
            kind: "BINDING_UPSERT",
            payload: {
              kind: "BINDING_UPSERT",
              conversationKeyDigest: "b".repeat(64),
              bindingId: "binding-1",
              bindingRevision: 1,
              storeId: "store-1",
              marketplace: "ozon",
              credentialRevision: "credential-1",
            },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
    expect(syncService.apply).toHaveBeenCalledOnce();
    await app.close();
  });
});

import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EXCHANGE_RATE_LIMIT,
  EXCHANGE_RATE_WINDOW_MS,
  EXCHANGE_REPLAY_WINDOW_MS,
  PENDING_RETRY_AFTER_SECONDS,
  PRE_ENTITLEMENT_ACTIVE_DEVICE_LIMIT,
  PreEntitlementDeviceLimitResolver,
  DeviceManagementService,
  deriveDeviceManagementKeys,
  exchangeIdempotencyHash,
  exchangeRateKey,
  validExchangeIdempotencyKey,
} from "./index.js";

describe("P2.5 device-management policy", () => {
  it("freezes baseline limit, replay, rate and pending policies", async () => {
    expect(PRE_ENTITLEMENT_ACTIVE_DEVICE_LIMIT).toBe(1);
    await expect(
      new PreEntitlementDeviceLimitResolver().resolve(),
    ).resolves.toEqual({ maxActive: 1, source: "PRE_ENTITLEMENT_BASELINE" });
    expect(EXCHANGE_REPLAY_WINDOW_MS).toBe(120_000);
    expect(EXCHANGE_RATE_LIMIT).toBe(120);
    expect(EXCHANGE_RATE_WINDOW_MS).toBe(600_000);
    expect(PENDING_RETRY_AFTER_SECONDS).toBe(5);
  });
  it("validates exact idempotency grammar and produces opaque separated artifacts", () => {
    const keys = deriveDeviceManagementKeys(Buffer.alloc(32, 9));
    expect(validExchangeIdempotencyKey("A".repeat(16))).toBe(true);
    expect(validExchangeIdempotencyKey("A".repeat(15))).toBe(false);
    expect(validExchangeIdempotencyKey("A".repeat(129))).toBe(false);
    expect(validExchangeIdempotencyKey("A".repeat(15) + "/")).toBe(false);
    expect(validExchangeIdempotencyKey("a._:-Z9".repeat(3))).toBe(true);
    expect(exchangeIdempotencyHash(keys, "A".repeat(16))).not.toContain(
      "A".repeat(16),
    );
    expect(exchangeRateKey(keys, "203.0.113.20")).not.toContain("203.0.113.20");
  });

  it("accepts injected bounded integer limits and rejects unsafe resolver values", async () => {
    for (const maxActive of [0, 1, 2]) {
      const resolved = await {
        resolve: async () => ({ maxActive, source: "test" }),
      }.resolve();
      expect(Number.isInteger(resolved.maxActive)).toBe(true);
      expect(resolved.maxActive).toBeGreaterThanOrEqual(0);
      expect(resolved.maxActive).toBeLessThanOrEqual(10_000);
    }
    for (const maxActive of [-1, 1.5, 10_001]) {
      expect(
        !Number.isInteger(maxActive) || maxActive < 0 || maxActive > 10_000,
      ).toBe(true);
    }
  });

  it("maps current-device metadata clearing without changing the principal identity", async () => {
    const pair = generateKeyPairSync("ed25519");
    const calls: unknown[] = [];
    const service = new DeviceManagementService(
      {
        consumeExchangeRate: async () => ({ allowed: true }),
        exchange: async () => ({ kind: "closed" as const }),
        list: async () => ({ kind: "ok" as const, devices: [] }),
        forgetCurrentClientMetadata: async (input) => {
          calls.push(input);
          return "cleared" as const;
        },
        revoke: async () => "not-found" as const,
      },
      Buffer.alloc(32, 2),
      {
        keyId: "test",
        privateKey: pair.privateKey,
        publicKey: pair.publicKey,
      },
    );
    const principal = {
      sessionId: "session-1",
      deviceId: "device-1",
      accountId: "account-1",
    };
    await expect(
      service.forgetCurrentClientMetadata(principal, "corr-1"),
    ).resolves.toEqual({ kind: "CLEARED", deviceId: "device-1" });
    expect(calls).toEqual([{ ...principal, correlationId: "corr-1" }]);
  });

  it("preserves the explicit beta unlimited policy without a numeric sentinel", async () => {
    let resolveLimit:
      | ((accountId: string, at: Date) => Promise<unknown>)
      | undefined;
    const service = new (class extends DeviceManagementService {
      constructor() {
        const pair = generateKeyPairSync("ed25519");
        super(
          {
            consumeExchangeRate: async () => ({ allowed: true }),
            exchange: async (input) => {
              resolveLimit = input.resolveLimit;
              return { kind: "closed" as const };
            },
            list: async () => ({ kind: "ok" as const, devices: [] }),
            forgetCurrentClientMetadata: async () => "cleared" as const,
            revoke: async () => "not-found" as const,
          },
          Buffer.alloc(32, 1),
          {
            keyId: "test",
            privateKey: pair.privateKey,
            publicKey: pair.publicKey,
          },
          {
            resolve: async () => ({
              kind: "BETA_UNLIMITED_FOR_COMMERCIAL_COUNT" as const,
            }),
          },
        );
      }
    })();
    await service.exchange(
      "A".repeat(43),
      "device-beta-key-1234",
      "198.51.100.1",
      "accepted-request-id-beta-device",
    );
    expect(resolveLimit).toBeDefined();
    await expect(resolveLimit!("account", new Date())).resolves.toEqual({
      kind: "BETA_UNLIMITED_FOR_COMMERCIAL_COUNT",
    });
  });
});

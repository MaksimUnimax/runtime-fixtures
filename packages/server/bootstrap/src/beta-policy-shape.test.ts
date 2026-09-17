import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  signBootstrapSnapshot,
  verifyBootstrapEnvelope,
} from "@product/remote-config";

import { BootstrapService } from "./index.js";

const subject = {
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};
const request = {
  contractVersion: "control_plane_v1" as const,
  extensionVersion: "1.2.3",
  browser: { family: "chrome" as const, version: "120" },
  deviceId: subject.deviceId,
  lastConfigVersion: null,
};
const policy = {
  resolve: async () => ({
    configVersion: 7,
    signingKeyId: "config-key",
    sourceFingerprintSha256: "a".repeat(64),
    compatibility: {
      extension: { status: "SUPPORTED" as const, minimumVersion: null },
      browser: { status: "SUPPORTED" as const },
    },
    features: {},
  }),
};

describe("BootstrapService beta policy boundary", () => {
  it.each([
    ["unexpected key", { "unexpected.beta": true }],
    ["missing accepted key", { "source.ozon": true }],
    [
      "non-true value",
      {
        "source.ozon": true,
        "source.wildberries": true,
        "ai.chatgpt": true,
        "ai.alice": false,
      },
    ],
    [
      "truthy non-boolean value",
      {
        "source.ozon": 1,
        "source.wildberries": true,
        "ai.chatgpt": true,
        "ai.alice": true,
      },
    ],
    [
      "alias instead of reviewed key",
      {
        "source.ozon": true,
        "source.wb": true,
        "ai.chatgpt": true,
        "ai.alice": true,
      },
    ],
  ])("fails closed for a policy with %s", async (_label, map) => {
    const pair = generateKeyPairSync("ed25519");
    let signCalls = 0;
    const service = new BootstrapService(
      policy,
      {
        sign: async (_keyId, payload) => {
          signCalls++;
          return signBootstrapSnapshot(payload, "config-key", pair.privateKey);
        },
      },
      { now: () => new Date("2026-01-01T00:00:00.000Z") },
      undefined,
      undefined,
      { resolve: async () => ({ kind: "BETA" as const }) },
      { resolve: () => map },
    );

    await expect(service.issue(subject, request)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(signCalls).toBe(0);
    expect(
      verifyBootstrapEnvelope(
        {
          envelopeVersion: "not-issued",
        },
        new Map([["config-key", pair.publicKey]]),
      ),
    ).toMatchObject({ ok: false });
  });
});

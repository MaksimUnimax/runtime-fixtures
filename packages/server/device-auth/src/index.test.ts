import { describe, expect, it, vi } from "vitest";
import {
  DEVICE_AUTH_TTL_MS,
  MAX_CODE_GENERATION_ATTEMPTS,
  USER_CODE_ALPHABET,
  canonicalUserCode,
  decryptStartSecrets,
  deriveDeviceAuthKeys,
  deviceCodeArtifact,
  displayUserCode,
  equalArtifact,
  encryptStartSecrets,
  generateDeviceCode,
  generateUserCode,
  idempotencyKeyArtifact,
  isTransitionAllowed,
  requestFingerprint,
  DeviceAuthorizationService,
  userCodeArtifact,
  validIdempotencyKey,
} from "./index.js";

describe("device authorization crypto and policy", () => {
  const keys = deriveDeviceAuthKeys(Buffer.alloc(32, 9));
  it("generates independent canonical device and user codes", () => {
    const device = generateDeviceCode(Buffer.alloc(32, 7));
    const user = generateUserCode(() => 1);
    expect(device).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(user).toHaveLength(8);
    expect([...user].every((x) => USER_CODE_ALPHABET.includes(x))).toBe(true);
    expect(displayUserCode(user)).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(canonicalUserCode(displayUserCode(user))).toBe(user);
  });
  it("uses separated deterministic artifacts and validates idempotency keys", () => {
    expect(deviceCodeArtifact(keys, "x")).not.toBe(userCodeArtifact(keys, "x"));
    expect(idempotencyKeyArtifact(keys, "A".repeat(16))).toMatch(/^v1:/);
    expect(validIdempotencyKey("A".repeat(16))).toBe(true);
    expect(validIdempotencyKey("short")).toBe(false);
    expect(validIdempotencyKey("A".repeat(129))).toBe(false);
    expect(
      requestFingerprint({
        clientType: "browser_extension",
        browserFamily: "chrome",
        extensionVersion: "1.0",
      }),
    ).toBe(
      requestFingerprint({
        extensionVersion: "1.0",
        browserFamily: "chrome",
        clientType: "browser_extension",
      }),
    );
  });
  it("binds start secrets to authorization and request context", () => {
    const expiresAt = new Date("2026-09-03T00:10:00.000Z"),
      id = "00000000-0000-0000-0000-000000000001",
      idem = idempotencyKeyArtifact(keys, "A".repeat(16)),
      fingerprint = requestFingerprint({
        clientType: "browser_extension",
        browserFamily: "chrome",
        extensionVersion: "1",
      });
    const envelope = encryptStartSecrets(
      keys,
      id,
      idem,
      fingerprint,
      expiresAt,
      {
        deviceCode: generateDeviceCode(Buffer.alloc(32, 3)),
        userCode: "ABCDEFGH",
      },
    );
    expect(
      decryptStartSecrets(keys, {
        id,
        status: "PENDING",
        idempotencyKeyHash: idem,
        requestFingerprint: fingerprint,
        deviceCodeHash: "v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        userCodeHash: "v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        expiresAt,
        envelope,
      })?.userCode,
    ).toBe("ABCD-EFGH");
    expect(
      decryptStartSecrets(keys, {
        id: "00000000-0000-0000-0000-000000000002",
        status: "PENDING",
        idempotencyKeyHash: idem,
        requestFingerprint: fingerprint,
        deviceCodeHash: "v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        userCodeHash: "v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        expiresAt,
        envelope,
      }),
    ).toBeUndefined();
  });
  it("freezes TTL and state transitions", () => {
    expect(DEVICE_AUTH_TTL_MS).toBe(600_000);
    expect(isTransitionAllowed("PENDING", "APPROVED")).toBe(true);
    expect(isTransitionAllowed("APPROVED", "EXPIRED")).toBe(true);
    expect(isTransitionAllowed("APPROVED", "DENIED")).toBe(false);
  });
  it("T1 crypto matrix proves canonical generation, independent HMACs, and fail-closed artifacts", () => {
    const bytes = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
    expect(generateDeviceCode(bytes)).toBe(bytes.toString("base64url"));
    expect(generateDeviceCode(bytes)).toHaveLength(43);
    expect(generateDeviceCode(bytes)).not.toContain("=");
    expect(() => generateDeviceCode(Buffer.alloc(31))).toThrow("32 bytes");
    const user = generateUserCode((max) => max - 1);
    expect(user).toBe("9".repeat(8));
    expect(displayUserCode(user)).toBe("9999-9999");
    expect(canonicalUserCode("9999-9999")).toBe(user);
    expect(canonicalUserCode("99999999")).toBe(user);
    for (const bad of [
      "IIIIIIII",
      "OOOOOOOO",
      "11111111",
      "ABCD-EFG!",
      "A-BCDEFGH",
    ])
      expect(canonicalUserCode(bad)).toBeUndefined();
    expect(deviceCodeArtifact(keys, "x")).not.toBe(userCodeArtifact(keys, "x"));
    expect(
      equalArtifact(userCodeArtifact(keys, user), userCodeArtifact(keys, user)),
    ).toBe(true);
    expect(
      equalArtifact(
        userCodeArtifact(keys, user),
        userCodeArtifact(keys, "ABCDEFGH"),
      ),
    ).toBe(false);
    expect(equalArtifact("malformed", userCodeArtifact(keys, user))).toBe(
      false,
    );
    expect(
      new Set(Object.values(keys).map((key) => key.toString("hex"))).size,
    ).toBe(5);
  });
  it("T1 envelope matrix authenticates ciphertext, tag, and all AAD bindings", () => {
    const expiresAt = new Date("2026-09-03T00:10:00.000Z");
    const id = "00000000-0000-0000-0000-000000000001";
    const idem = idempotencyKeyArtifact(keys, "A".repeat(16));
    const fingerprint = requestFingerprint({
      clientType: "browser_extension",
      browserFamily: "chrome",
      extensionVersion: "1",
    });
    const secrets = {
      deviceCode: generateDeviceCode(Buffer.alloc(32, 5)),
      userCode: "ABCDEFGH",
    };
    const envelope = encryptStartSecrets(
      keys,
      id,
      idem,
      fingerprint,
      expiresAt,
      secrets,
    );
    const base = {
      id,
      status: "PENDING" as const,
      idempotencyKeyHash: idem,
      requestFingerprint: fingerprint,
      deviceCodeHash: "v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      userCodeHash: "v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      expiresAt,
      envelope,
    };
    expect(decryptStartSecrets(keys, base)).toEqual({
      deviceCode: secrets.deviceCode,
      userCode: "ABCD-EFGH",
    });
    expect(envelope.ciphertext.toString("utf8")).not.toContain(
      secrets.deviceCode,
    );
    expect(envelope.ciphertext.toString("utf8")).not.toContain(
      secrets.userCode,
    );
    expect(
      encryptStartSecrets(
        keys,
        id,
        idem,
        fingerprint,
        expiresAt,
        secrets,
      ).nonce.equals(envelope.nonce),
    ).toBe(false);
    const alteredCiphertext = Buffer.from(envelope.ciphertext);
    alteredCiphertext[0] = (alteredCiphertext.at(0) ?? 0) ^ 1;
    const alteredTag = Buffer.from(envelope.authTag);
    alteredTag[0] = (alteredTag.at(0) ?? 0) ^ 1;
    expect(
      decryptStartSecrets(keys, {
        ...base,
        envelope: { ...envelope, ciphertext: alteredCiphertext },
      }),
    ).toBeUndefined();
    expect(
      decryptStartSecrets(keys, {
        ...base,
        envelope: { ...envelope, authTag: alteredTag },
      }),
    ).toBeUndefined();
    for (const changed of [
      { id: "00000000-0000-0000-0000-000000000002" },
      { idempotencyKeyHash: idempotencyKeyArtifact(keys, "B".repeat(16)) },
      { requestFingerprint: "another-fingerprint" },
    ])
      expect(
        decryptStartSecrets(keys, { ...base, ...changed }),
      ).toBeUndefined();
  });
  it("T1 idempotency matrix freezes bounds, charset, and canonical fingerprints", () => {
    expect(validIdempotencyKey("A".repeat(16))).toBe(true);
    expect(validIdempotencyKey("A".repeat(15))).toBe(false);
    expect(validIdempotencyKey("A".repeat(128))).toBe(true);
    expect(validIdempotencyKey("A".repeat(129))).toBe(false);
    expect(validIdempotencyKey("Az09._:-Az09._:-")).toBe(true);
    for (const invalid of [
      "A".repeat(15) + " ",
      "A".repeat(15) + "/",
      "A".repeat(15) + "?",
    ])
      expect(validIdempotencyKey(invalid)).toBe(false);
    const body = {
      clientType: "browser_extension",
      browserFamily: "chrome",
      browserVersion: "1",
      extensionVersion: "2",
      deviceLabel: "laptop",
    };
    const original = requestFingerprint(body);
    const withheld = requestFingerprint({
      clientType: "browser_extension",
      deviceLabel: "laptop",
    });
    expect(withheld).not.toBe(original);
    expect(
      requestFingerprint({
        deviceLabel: "laptop",
        clientType: "browser_extension",
      }),
    ).toBe(withheld);
    expect(
      requestFingerprint({
        extensionVersion: "2",
        deviceLabel: "laptop",
        browserVersion: "1",
        browserFamily: "chrome",
        clientType: "browser_extension",
      }),
    ).toBe(original);
    for (const changed of [
      { clientType: "different" },
      { browserFamily: "yandex_chromium" },
      { browserVersion: "3" },
      { extensionVersion: "4" },
      { deviceLabel: "desktop" },
    ])
      expect(requestFingerprint({ ...body, ...changed })).not.toBe(original);
  });
  it("starts privacy-neutral authorization without fabricating client metadata", async () => {
    const start = vi.fn().mockImplementation(async ({ record }) => ({
      ok: true,
      value: { record, replay: false },
    }));
    const service = new DeviceAuthorizationService(
      { start, approve: vi.fn(), deny: vi.fn(), expireDue: vi.fn() } as never,
      keys,
      () => new Date("2026-09-03T00:00:00.000Z"),
      () => ({
        deviceCode: generateDeviceCode(Buffer.alloc(32, 6)),
        rawUserCode: "ABCDEFGH",
      }),
    );
    const result = await service.start(
      { clientType: "browser_extension", deviceLabel: "manual-label" },
      "P".repeat(16),
      "198.51.100.9",
      "privacy-neutral",
    );
    expect(result.ok).toBe(true);
    const record = start.mock.calls[0]?.[0].record;
    expect(record).toMatchObject({ deviceLabel: "manual-label" });
    expect(record).not.toHaveProperty("browserFamily");
    expect(record).not.toHaveProperty("browserVersion");
    expect(record).not.toHaveProperty("extensionVersion");
    expect(record.requestFingerprint).toBe(
      requestFingerprint({
        clientType: "browser_extension",
        deviceLabel: "manual-label",
      }),
    );
  });

  it("T1 state matrix permits only the four P2.3 transitions", () => {
    for (const [from, to, allowed] of [
      ["PENDING", "APPROVED", true],
      ["PENDING", "DENIED", true],
      ["PENDING", "EXPIRED", true],
      ["APPROVED", "EXPIRED", true],
      ["APPROVED", "DENIED", false],
      ["DENIED", "PENDING", false],
      ["EXPIRED", "PENDING", false],
      ["EXCHANGED", "PENDING", false],
    ] as const)
      expect(isTransitionAllowed(from, to)).toBe(allowed);
  });

  it("T2 collision policy makes at most eight generation attempts and fails closed", async () => {
    const start = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: "DEVICE_AUTH_COLLISION" })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          replay: false,
          record: {
            id: "00000000-0000-0000-0000-000000000001",
            status: "PENDING",
            idempotencyKeyHash:
              "v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            requestFingerprint: "fingerprint",
            deviceCodeHash: "v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            userCodeHash: "v1:ccccccccccccccccccccccccccccccccccccccccccc",
            expiresAt: new Date("2026-09-03T00:10:00.000Z"),
          },
        },
      });
    const service = new DeviceAuthorizationService(
      { start, approve: vi.fn(), deny: vi.fn(), expireDue: vi.fn() } as never,
      keys,
      () => new Date("2026-09-03T00:00:00.000Z"),
    );
    const result = await service.start(
      {
        clientType: "browser_extension",
        browserFamily: "chrome",
        extensionVersion: "1",
      },
      "A".repeat(16),
      "198.51.100.1",
      "test",
    );
    expect(result.ok).toBe(true);
    expect(start).toHaveBeenCalledTimes(2);
    expect(MAX_CODE_GENERATION_ATTEMPTS).toBe(8);

    const sevenCollisions = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: "DEVICE_AUTH_COLLISION" })
      .mockResolvedValueOnce({ ok: false, code: "DEVICE_AUTH_COLLISION" })
      .mockResolvedValueOnce({ ok: false, code: "DEVICE_AUTH_COLLISION" })
      .mockResolvedValueOnce({ ok: false, code: "DEVICE_AUTH_COLLISION" })
      .mockResolvedValueOnce({ ok: false, code: "DEVICE_AUTH_COLLISION" })
      .mockResolvedValueOnce({ ok: false, code: "DEVICE_AUTH_COLLISION" })
      .mockResolvedValueOnce({ ok: false, code: "DEVICE_AUTH_COLLISION" })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          replay: false,
          record: { ...start.mock.calls[1]?.[0].record },
        },
      });
    const eighth = new DeviceAuthorizationService(
      {
        start: sevenCollisions,
        approve: vi.fn(),
        deny: vi.fn(),
        expireDue: vi.fn(),
      } as never,
      keys,
      () => new Date("2026-09-03T00:00:00.000Z"),
    );
    expect(
      (
        await eighth.start(
          {
            clientType: "browser_extension",
            browserFamily: "chrome",
            extensionVersion: "1",
          },
          "B".repeat(16),
          "198.51.100.1",
          "test",
        )
      ).ok,
    ).toBe(true);
    expect(sevenCollisions).toHaveBeenCalledTimes(8);

    const exhausted = vi
      .fn()
      .mockResolvedValue({ ok: false, code: "DEVICE_AUTH_COLLISION" });
    const exhaustedService = new DeviceAuthorizationService(
      {
        start: exhausted,
        approve: vi.fn(),
        deny: vi.fn(),
        expireDue: vi.fn(),
      } as never,
      keys,
    );
    expect(
      await exhaustedService.start(
        {
          clientType: "browser_extension",
          browserFamily: "chrome",
          extensionVersion: "1",
        },
        "C".repeat(16),
        "198.51.100.1",
        "test",
      ),
    ).toEqual({ ok: false, code: "SERVICE_UNAVAILABLE" });
    expect(exhausted).toHaveBeenCalledTimes(8);
  });
});

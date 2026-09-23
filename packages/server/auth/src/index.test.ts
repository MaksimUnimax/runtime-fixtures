import { describe, expect, it } from "vitest";
import {
  csrfToken,
  decryptOtpDelivery,
  deriveAuthKeys,
  encryptOtpDelivery,
  generateOtp,
  generatePortalToken,
  normalizeEmail,
  otpArtifact,
  portalLookup,
  verifyCsrf,
  verifyOtpArtifact,
} from "./index.js";
const keys = deriveAuthKeys(Buffer.alloc(32, 7));
describe("P2.2 cryptographic auth primitives", () => {
  it("normalizes email and makes six digit OTPs", () => {
    expect(normalizeEmail(" User@Example.TEST ")).toBe("user@example.test");
    expect(generateOtp(() => 4)).toBe("000004");
  });
  it("binds OTP verification artifacts", () => {
    const artifact = otpArtifact(
      keys,
      "00000000-0000-0000-0000-000000000001",
      "a@example.test",
      "012345",
    );
    expect(
      verifyOtpArtifact(
        keys,
        "00000000-0000-0000-0000-000000000001",
        "a@example.test",
        "012345",
        artifact,
      ),
    ).toBe(true);
    expect(
      verifyOtpArtifact(
        keys,
        "00000000-0000-0000-0000-000000000001",
        "a@example.test",
        "012346",
        artifact,
      ),
    ).toBe(false);
  });
  it("encrypts delivery with AAD and binds CSRF to portal token", () => {
    const env = encryptOtpDelivery(
      keys,
      "00000000-0000-0000-0000-000000000001",
      "a@example.test",
      "012345",
    );
    expect(
      decryptOtpDelivery(
        keys,
        "00000000-0000-0000-0000-000000000001",
        "a@example.test",
        env,
      ),
    ).toBe("012345");
    expect(
      decryptOtpDelivery(
        keys,
        "00000000-0000-0000-0000-000000000002",
        "a@example.test",
        env,
      ),
    ).toBeUndefined();
    const token = generatePortalToken(),
      csrf = csrfToken(keys, token);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifyCsrf(keys, token, csrf, csrf)).toBe(true);
    expect(portalLookup(keys, token)).not.toBe(token);
  });
});

describe("P2.2 mandatory crypto and normalization regression matrix", () => {
  const challenge = "00000000-0000-0000-0000-000000000001";
  const email = "person+tag@example.test";
  it("CRYPTO-01/02/03 produces six digits through an injected RNG", () => {
    expect(generateOtp(() => 123)).toBe("000123");
    expect(generateOtp(() => 999999)).toMatch(/^\d{6}$/);
  });
  it("CRYPTO-04/05 rejects invalid roots and separates every purpose", async () => {
    const { loadAuthRootSecret } = await import("./index.js");
    expect(() => loadAuthRootSecret({})).toThrow();
    expect(() =>
      loadAuthRootSecret({ AUTH_ROOT_SECRET_B64: "bad!" }),
    ).toThrow();
    expect(() =>
      loadAuthRootSecret({
        AUTH_ROOT_SECRET_B64: Buffer.alloc(31).toString("base64"),
      }),
    ).toThrow();
    expect(
      new Set(Object.values(keys).map((v) => v.toString("hex"))).size,
    ).toBe(5);
  });
  it("CRYPTO-06..10 binds artifacts and malformed artifacts fail safely", () => {
    const artifact = otpArtifact(keys, challenge, email, "012345");
    expect(verifyOtpArtifact(keys, challenge, email, "012345", artifact)).toBe(
      true,
    );
    expect(verifyOtpArtifact(keys, challenge, email, "012346", artifact)).toBe(
      false,
    );
    expect(
      verifyOtpArtifact(
        keys,
        challenge.replace(/1$/, "2"),
        email,
        "012345",
        artifact,
      ),
    ).toBe(false);
    expect(
      verifyOtpArtifact(
        keys,
        challenge,
        "other@example.test",
        "012345",
        artifact,
      ),
    ).toBe(false);
    expect(() =>
      verifyOtpArtifact(keys, challenge, email, "012345", "v1:x"),
    ).not.toThrow();
    expect(verifyOtpArtifact(keys, challenge, email, "012345", "v1:x")).toBe(
      false,
    );
  });
  it("CRYPTO-11..16 authenticates delivery and randomizes encryption", () => {
    const first = encryptOtpDelivery(keys, challenge, email, "012345");
    const second = encryptOtpDelivery(keys, challenge, email, "012345");
    expect(decryptOtpDelivery(keys, challenge, email, first)).toBe("012345");
    expect(
      decryptOtpDelivery(keys, challenge, email, {
        ...first,
        ciphertext: Buffer.from(
          first.ciphertext.map((v, i) => (i ? v : v ^ 1)),
        ),
      }),
    ).toBeUndefined();
    expect(
      decryptOtpDelivery(keys, challenge, email, {
        ...first,
        authTag: Buffer.from(first.authTag.map((v, i) => (i ? v : v ^ 1))),
      }),
    ).toBeUndefined();
    expect(
      decryptOtpDelivery(keys, challenge.replace(/1$/, "2"), email, first),
    ).toBeUndefined();
    expect(
      decryptOtpDelivery(keys, challenge, "other@example.test", first),
    ).toBeUndefined();
    expect(
      Buffer.compare(first.nonce, second.nonce) === 0 &&
        Buffer.compare(first.ciphertext, second.ciphertext) === 0,
    ).toBe(false);
  });
  it("CRYPTO-17..22 uses canonical tokens and safe CSRF", () => {
    const token = generatePortalToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(portalLookup(keys, token)).toBe(portalLookup(keys, token));
    expect(portalLookup(keys, token)).not.toBe(
      portalLookup(keys, generatePortalToken()),
    );
    const csrf = csrfToken(keys, token);
    expect(csrf).toBe(csrfToken(keys, token));
    expect(csrf).not.toBe(csrfToken(keys, generatePortalToken()));
    expect(verifyCsrf(keys, token, csrf, csrf)).toBe(true);
    expect(verifyCsrf(keys, token, "tiny", csrf)).toBe(false);
  });
  it("AUTH-NORM-01..07 uses one deterministic canonical representation", () => {
    expect(normalizeEmail(" User.Name+Tag@Example.TEST ")).toBe(
      "user.name+tag@example.test",
    );
    expect(normalizeEmail("cafe\u0301@example.test")).toBe("café@example.test");
    expect(normalizeEmail("a..b@example.test")).toBe("a..b@example.test");
    expect(normalizeEmail("not-an-email")).toBeUndefined();
    expect(normalizeEmail(`${"a".repeat(315)}@x.test`)).toBeUndefined();
  });
});

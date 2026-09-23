import { describe, expect, it } from "vitest";
import { safeAuditReason } from "./safe-audit.js";

describe("safeAuditReason", () => {
  it("preserves ordinary reasons and redacts secret-shaped material", () => {
    expect(safeAuditReason("operator reason")).toBe("operator reason");
    const redacted = safeAuditReason(
      "token=supersecretvalue Bearer abcdefghijklmnopqrstuvwxyz123456",
    );
    expect(redacted).not.toContain("supersecretvalue");
    expect(redacted).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(redacted).toContain("[REDACTED");
  });

  it("redacts private key bodies and stays bounded", () => {
    const value = safeAuditReason(
      "-----BEGIN PRIVATE KEY-----\nsecretmaterial\n-----END PRIVATE KEY-----",
    );
    expect(value).not.toContain("secretmaterial");
    expect(value.length).toBeLessThanOrEqual(512);
  });
});

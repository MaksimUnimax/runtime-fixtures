import { describe, expect, it } from "vitest";
import { FEEDBACK_CATEGORIES, buildFeedbackPayload } from "./feedback-ui";

describe("B2 portal feedback form", () => {
  it("offers only the stable support categories", () => {
    expect(FEEDBACK_CATEGORIES).toHaveLength(17);
    expect(FEEDBACK_CATEGORIES).toContain("OTP");
    expect(FEEDBACK_CATEGORIES).toContain("VERSION_INCOMPATIBLE");
  });
  it("does not attach diagnostics unless the user opts in", () => {
    expect(
      buildFeedbackPayload({
        accountId: "a",
        category: "AUTH",
        description: "x",
        includeDiagnostics: false,
      }),
    ).toEqual({ accountId: "a", category: "AUTH", description: "x" });
    expect(
      buildFeedbackPayload({
        accountId: "a",
        category: "AUTH",
        description: "x",
        includeDiagnostics: true,
      }),
    ).toEqual({
      accountId: "a",
      category: "AUTH",
      description: "x",
      diagnostics: { portalVersion: "0.1.0" },
    });
  });
});

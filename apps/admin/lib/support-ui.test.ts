import { describe, expect, it } from "vitest";
import { SUPPORT_STATUSES, buildSupportFilter } from "./support-ui";

describe("B2 admin support filters", () => {
  it("keeps workflow status finite", () => {
    expect(SUPPORT_STATUSES).toEqual([
      "NEW",
      "TRIAGED",
      "NEEDS_INFO",
      "RESOLVED",
      "CLOSED",
    ]);
  });
  it("serializes only allowlisted filters", () => {
    expect(
      buildSupportFilter({ status: "NEW", category: "AUTH", secret: "drop" }),
    ).toBe("?limit=50&status=NEW&category=AUTH");
  });
});

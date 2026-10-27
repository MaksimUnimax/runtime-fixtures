import { describe, expect, it } from "vitest";
import { FEEDBACK_CATEGORIES, buildFeedbackPayload, ownSupportResponse } from "./feedback-ui";

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


describe("B16-03 own-case visible support response", () => {
  const caseId = "00000000-0000-4000-8000-000000000003";
  const staff = {
    followupId: "00000000-0000-4000-8000-000000000004",
    authorType: "SUPPORT",
    body: "Обращение проверено",
    createdAt: "2030-01-01T00:00:00.000Z",
  };
  const admin = {
    ...staff,
    followupId: "00000000-0000-4000-8000-000000000005",
    authorType: "ADMIN",
    body: "Ответ по обращению",
  };
  const user = {
    ...staff,
    authorType: "USER",
    body: "Пользовательское уточнение",
  };

  it("projects only support/admin replies and the latest same-case status", () => {
    expect(
      ownSupportResponse(
        { caseId, status: "TRIAGED", followups: [user, staff, admin] },
        caseId,
      ),
    ).toEqual({
      caseId,
      status: "TRIAGED",
      replies: [staff, admin],
    });
  });

  it("does not invent an answer when support has not replied", () => {
    expect(
      ownSupportResponse(
        { caseId, status: "NEW", followups: [user] },
        caseId,
      ),
    ).toEqual({ caseId, status: "NEW", replies: [] });
  });

  it("rejects a wrong-case reply rather than displaying another case's text", () => {
    expect(
      ownSupportResponse(
        {
          caseId: "00000000-0000-4000-8000-000000000099",
          status: "TRIAGED",
          followups: [staff],
        },
        caseId,
      ),
    ).toBeNull();
  });

  it.each([
    null,
    {},
    { caseId, status: "NEW", followups: "invalid" },
    { caseId, status: "NEW", followups: [{ ...staff, authorType: "SYSTEM" }] },
    { caseId, status: "NEW", followups: [{ ...staff, body: 13 }] },
    { caseId, status: "NEW", followups: [{ ...staff, body: "a".repeat(4001) }] },
    { caseId, status: "NEW", followups: [null] },
  ])("fails closed for malformed or unexpected own-case details", (value) => {
    expect(ownSupportResponse(value, caseId)).toBeNull();
  });

  it("keeps reply text as plain data, never markup or a user-side operation", () => {
    const body = '<img src=x onerror="synthetic-not-executed">';
    const result = ownSupportResponse(
      { caseId, status: "TRIAGED", followups: [{ ...staff, body }] },
      caseId,
    );
    expect(result?.replies[0]?.body).toBe(body);
  });
});

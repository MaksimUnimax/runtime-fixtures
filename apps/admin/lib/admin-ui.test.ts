import { describe, expect, it, vi } from "vitest";
import {
  buildBetaInvitationCreateBody,
  buildBetaInvitationRevokeBody,
  buildCompatibilityPublishBody,
  buildPriceCreateBody,
  ensureReviewedRequest,
  lookupResultIsCurrent,
  normalizeBetaInvitationEmail,
  withCursor,
} from "../app/admin-ui";

import { CompatibilityPublishBodySchema } from "../../../packages/server/admin-commercial/src/index";

describe("admin UI boundary regressions", () => {
  it("continues every paginated path with one current cursor", () => {
    expect(withCursor("/v1/admin/accounts?limit=50", "cursor-2")).toBe(
      "/v1/admin/accounts?limit=50&cursor=cursor-2",
    );
    expect(
      withCursor("/v1/admin/accounts?limit=50&cursor=cursor-2", "cursor-3"),
    ).toBe("/v1/admin/accounts?limit=50&cursor=cursor-3");
  });

  it("builds the complete strict price-create body", () => {
    expect(
      buildPriceCreateBody({
        planId: "plan-id",
        code: "price-code",
        marketKey: "global",
        channelKey: "web",
      }),
    ).toEqual({
      planId: "plan-id",
      code: "price-code",
      marketKey: "global",
      channelKey: "web",
    });
  });

  it("does not send fields outside the strict compatibility publish body", () => {
    expect(buildCompatibilityPublishBody("maintenance window")).toEqual({
      contractVersion: "control_plane_v1",
      browserFamily: null,
      minimumExtensionVersion: null,
      recommendedExtensionVersion: null,
      minimumBrowserVersion: null,
      maintenanceMode: false,
      maintenanceCode: null,
      blockedVersions: [],
      reason: "maintenance window",
    });
  });
  it("builds exact targeted invitation mutation bodies", () => {
    expect(
      buildBetaInvitationCreateBody({
        requestId: "invite-request-123456",
        expectedRevision: 7,
        email: " reviewer@example.test ",
        reason: " beta review ",
      }),
    ).toEqual({
      requestId: "invite-request-123456",
      expectedRevision: 7,
      email: "reviewer@example.test",
      reason: "beta review",
    });
    expect(
      buildBetaInvitationRevokeBody({
        requestId: "revoke-request-123456",
        reason: " review complete ",
      }),
    ).toEqual({
      requestId: "revoke-request-123456",
      reason: "review complete",
    });
  });

  it("normalizes invitation email exactly like the server contract", () => {
    expect(normalizeBetaInvitationEmail(" REVIEWER@EXAMPLE.TEST ")).toBe(
      "reviewer@example.test",
    );
    expect(
      normalizeBetaInvitationEmail("revi\u0065\u0301wer@example.test"),
    ).toBe("revi\u00e9wer@example.test");
    expect(normalizeBetaInvitationEmail("not-an-email")).toBe("");
  });

  it("applies lookup and mutation selection results only to the current generation", () => {
    const submittedSelectionGeneration = 4;
    expect(lookupResultIsCurrent(submittedSelectionGeneration, 4)).toBe(true);
    expect(lookupResultIsCurrent(submittedSelectionGeneration, 5)).toBe(false);
  });

  it("keeps one request id for one immutable reviewed payload", () => {
    const makeId = vi
      .fn()
      .mockReturnValueOnce("stable-request-1")
      .mockReturnValueOnce("changed-request-2");
    const first = ensureReviewedRequest(undefined, "payload-a", makeId);
    const same = ensureReviewedRequest(first, "payload-a", makeId);
    const changed = ensureReviewedRequest(first, "payload-b", makeId);
    expect(same).toBe(first);
    expect(changed.requestId).toBe("changed-request-2");
    expect(makeId).toHaveBeenCalledTimes(2);
  });

  it.each(["control_plane_v1", "control_plane_v2"] as const)(
    "sends a body accepted by the strict API for %s",
    (version) => {
      const body = buildCompatibilityPublishBody(
        "owner-approved policy",
        version,
      );
      expect(CompatibilityPublishBodySchema.parse(body)).toEqual(body);
      expect(body.contractVersion).toBe(version);
    },
  );
});

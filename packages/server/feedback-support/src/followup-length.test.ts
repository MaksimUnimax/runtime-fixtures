import { describe, expect, it, vi } from "vitest";
import {
  FeedbackSupportService,
  sanitizeFeedbackText,
  type FeedbackCase,
  type FeedbackRepository,
  type FeedbackRole,
} from "./index.js";

const actorId = "00000000-0000-4000-8000-000000000001";
const caseId = "00000000-0000-4000-8000-000000000002";
const accountId = "00000000-0000-4000-8000-000000000003";
const item: FeedbackCase = {
  caseId,
  accountId,
  deviceId: null,
  createdAt: "2030-01-01T00:00:00.000Z",
  updatedAt: "2030-01-01T00:00:00.000Z",
  category: "OTHER",
  severity: "LOW",
  status: "NEW",
  description: "Synthetic case",
  diagnostics: null,
  serverVersion: null,
  portalVersion: null,
  extensionVersion: null,
  browserFamily: null,
  browserVersion: null,
  marketplace: "NONE",
  supportCode: null,
  releaseIdentity: null,
  assignedAdminPrincipalId: null,
  resolutionCode: null,
  followups: [],
};
const actors: FeedbackRole[] = ["USER", "SUPPORT", "ADMIN"];
// Only a synthetic one-character credential; no actual user data is involved.
const tokenInput = "token=x";
function redactedLength(length: number): string {
  return (
    "a".repeat(length - sanitizeFeedbackText(tokenInput).length - 1) +
    " " +
    tokenInput
  );
}
function fixture(actor: FeedbackRole) {
  const getOwnCase = vi.fn<FeedbackRepository["getOwnCase"]>(async () => item);
  const addFollowup = vi.fn<FeedbackRepository["addFollowup"]>(
    async (input) => ({
      followupId: "00000000-0000-4000-8000-000000000004",
      authorType: input.actorType,
      body: input.body,
      createdAt: "2030-01-01T00:00:00.000Z",
    }),
  );
  const createCase = vi.fn<FeedbackRepository["createCase"]>(async () => item);
  const service = new FeedbackSupportService({
    getOwnCase,
    addFollowup,
    createCase,
  } as unknown as FeedbackRepository);
  const invoke = (description: string) =>
    actor === "USER"
      ? service.addUserFollowup(
          actorId,
          caseId,
          { description },
          "synthetic-correlation",
        )
      : service.addAdminFollowup(
          actor,
          actorId,
          caseId,
          { description },
          "synthetic-correlation",
        );
  return { service, invoke, getOwnCase, addFollowup, createCase };
}

describe.each(actors)(
  "feedback followup post-sanitization length for %s",
  (actor) => {
    it.each([
      ["redaction expansion", redactedLength(4001)],
      ["canonical Unicode expansion", "\u0344".repeat(2001)],
    ])("rejects %s before repository access", async (_label, description) => {
      expect(description.length).toBeLessThanOrEqual(4000);
      expect(sanitizeFeedbackText(description).length).toBeGreaterThan(4000);
      const { invoke, getOwnCase, addFollowup } = fixture(actor);
      expect(await invoke(description)).toEqual({
        ok: false,
        code: "INVALID_REQUEST",
      });
      expect(getOwnCase).not.toHaveBeenCalled();
      expect(addFollowup).not.toHaveBeenCalled();
    });
    it.each([
      ["ordinary exact boundary", "a".repeat(4000)],
      ["redacted exact boundary", redactedLength(4000)],
      ["ordinary Unicode", "Помогите с заказом 👋"],
      ["Unicode normalization remains within boundary", "\u0344".repeat(2000)],
    ])("preserves %s and sends sanitized text", async (_label, description) => {
      const expected = sanitizeFeedbackText(description);
      expect(expected.length).toBeLessThanOrEqual(4000);
      const { invoke, getOwnCase, addFollowup } = fixture(actor);
      const result = await invoke(description);
      expect(result).toMatchObject({
        ok: true,
        value: { body: expected, authorType: actor },
      });
      expect(addFollowup).toHaveBeenCalledExactlyOnceWith({
        actorType: actor,
        actorId,
        caseId,
        body: expected,
        correlationId: "synthetic-correlation",
      });
      expect(getOwnCase).toHaveBeenCalledTimes(actor === "USER" ? 1 : 0);
    });
    it.each(["a".repeat(4001), "  \u0000  "])(
      "keeps raw-length and empty-text rejection",
      async (description) => {
        const { invoke, getOwnCase, addFollowup } = fixture(actor);
        expect(await invoke(description)).toEqual({
          ok: false,
          code: "INVALID_REQUEST",
        });
        expect(getOwnCase).not.toHaveBeenCalled();
        expect(addFollowup).not.toHaveBeenCalled();
      },
    );
    it("preserves repository rate-limit rejection", async () => {
      const { invoke, addFollowup } = fixture(actor);
      addFollowup.mockResolvedValue({ kind: "RATE_LIMITED" });
      expect(await invoke("ordinary text")).toEqual({
        ok: false,
        code: "RATE_LIMITED",
      });
      expect(addFollowup).toHaveBeenCalledTimes(1);
    });
  },
);

describe("existing case and ownership boundaries", () => {
  it.each(["NOT_FOUND", "FORBIDDEN"] as const)(
    "keeps user case %s",
    async (kind) => {
      const { invoke, getOwnCase, addFollowup } = fixture("USER");
      getOwnCase.mockResolvedValue({ kind });
      expect(await invoke("ordinary text")).toEqual({ ok: false, code: kind });
      expect(addFollowup).not.toHaveBeenCalled();
    },
  );
  it("keeps the existing create-case post-sanitization limit", async () => {
    const { service, createCase } = fixture("USER");
    expect(
      await service.createCase(actorId, {
        accountId,
        category: "OTHER",
        description: redactedLength(4001),
      }),
    ).toEqual({ ok: false, code: "INVALID_REQUEST" });
    expect(createCase).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  profileRevisionFingerprint,
  selectAssignedProfileRevision,
  type AdapterProfileContentV1,
} from "@product/adapter-registry";
import {
  BootstrapAiResolutionService,
  BootstrapAiResolutionError,
  resolveBootstrapAiSnapshot,
  type BootstrapAiResolutionSnapshot,
} from "./ai-resolution.js";

const content: AdapterProfileContentV1 = {
  schemaVersion: "adapter_profile_v1",
  page: {
    identityStrategy: "page_identity",
    conversationStrategy: "conversation_root",
    composerStrategy: "composer_root",
  },
  selectors: {
    conversation: {
      strategy: "conversation_root",
      primary: {
        kind: "packaged_selector_reference",
        reference: "conversation-root",
      },
      fallbacks: [],
      timeoutMs: 1000,
      observationMode: "polling",
    },
    composer: {
      strategy: "composer_root",
      primary: {
        kind: "packaged_selector_reference",
        reference: "composer-root",
      },
      fallbacks: [],
      timeoutMs: 1000,
      observationMode: "polling",
    },
    send: {
      strategy: "send_control",
      primary: {
        kind: "packaged_selector_reference",
        reference: "send-control",
      },
      fallbacks: [],
      timeoutMs: 1000,
      observationMode: "polling",
    },
    assistantResponse: {
      strategy: "assistant_response",
      primary: {
        kind: "packaged_selector_reference",
        reference: "assistant-response",
      },
      fallbacks: [],
      timeoutMs: 1000,
      observationMode: "polling",
    },
  },
  observation: { mode: "polling", intervalMs: 100 },
  contours: [
    {
      key: "page_identity",
      required: true,
      expectedState: "PRESENT",
      strategy: "page_identity",
    },
    {
      key: "conversation_root",
      required: true,
      expectedState: "PRESENT",
      strategy: "conversation_root",
    },
    {
      key: "composer_root",
      required: true,
      expectedState: "INTERACTIVE",
      strategy: "composer_root",
    },
    {
      key: "send_control",
      required: true,
      expectedState: "INTERACTIVE",
      strategy: "send_control",
    },
  ],
};
const compatibility = {
  schemaVersion: "profile_compatibility_v1" as const,
  contractVersion: "control_plane_v1" as const,
  browserFamilies: ["chrome" as const],
  minimumBrowserVersions: [],
  minimumExtensionVersion: null,
};
const hierarchy = {
  adapterId: "adapter",
  adapterKey: "chatgpt",
  adapterStatus: "ACTIVE",
  surfaceId: "surface",
  surfaceKey: "standard",
  surfaceStatus: "ACTIVE",
  variantId: "variant",
  variantKey: "standard_composer_v1",
  variantStatus: "ACTIVE",
};
const detected = {
  family: "chatgpt",
  surface: "standard",
  variant: "standard_composer_v1",
} as const;
const profile = (
  id: string,
  key: string,
  variantId: string | null = "variant",
) => ({
  revisionId: id,
  profileId: `profile-${key}`,
  profileKey: key,
  profileStatus: "ACTIVE",
  adapterId: "adapter",
  surfaceId: "surface",
  variantId,
  revision: 1,
  schemaVersion: "adapter_profile_v1",
  state: "PUBLISHED",
  content,
  compatibility,
  contentSha256: profileRevisionFingerprint({ content, compatibility }),
});
const assignment = (
  variantId: string | null,
  latest: NonNullable<
    BootstrapAiResolutionSnapshot["exactAssignment"]
  >["latest"],
  subjectKind: "ACCOUNT" | "DEVICE" = "ACCOUNT",
) => ({
  id: `assignment-${variantId ?? "default"}`,
  variantId,
  browserFamily: "chrome",
  subjectKind,
  cohortSeed: Buffer.alloc(32, 7),
  latest,
});
const direct = (id: string) => ({
  revision: 1,
  mode: "DIRECT",
  baselineProfileRevisionId: id,
  candidateProfileRevisionId: null,
  percentageBps: 0,
});
const baseInput = {
  detected,
  contractVersion: "control_plane_v1" as const,
  extensionVersion: "1.0.0",
  browser: { family: "chrome" as const, version: "123" },
  accountId: "account",
  deviceId: "device",
};

function snapshot(
  changes: Partial<BootstrapAiResolutionSnapshot> = {},
): BootstrapAiResolutionSnapshot {
  return {
    hierarchy,
    exactAssignment: assignment("variant", direct("exact")),
    defaultAssignment: assignment(null, direct("default")),
    profiles: [
      profile("exact", "standard-profile"),
      profile("default", "default-profile", null),
    ],
    ...changes,
  };
}

describe("P7.3 server AI resolution", () => {
  it("resolves exact variant before default and keeps Work independent", () => {
    const exact = resolveBootstrapAiSnapshot(baseInput, snapshot());
    expect(exact).toMatchObject({
      status: "RESOLVED",
      profile: {
        profileKey: "standard-profile",
        scopeVariant: "standard_composer_v1",
      },
    });
    const work = resolveBootstrapAiSnapshot(
      {
        ...baseInput,
        detected: {
          family: "chatgpt",
          surface: "work",
          variant: "work_composer_v3",
        },
      },
      {
        ...snapshot(),
        hierarchy: {
          ...hierarchy,
          surfaceId: "work-surface",
          surfaceKey: "work",
          variantId: "work-variant",
          variantKey: "work_composer_v3",
        },
        exactAssignment: null,
        defaultAssignment: null,
        profiles: [],
      },
    );
    expect(work).toEqual({
      status: "UNAVAILABLE",
      detected: {
        family: "chatgpt",
        surface: "work",
        variant: "work_composer_v3",
      },
      reason: "NO_PROFILE",
    });
  });

  it("uses the surface default for a known variant when exact scope is absent or empty", () => {
    const result = resolveBootstrapAiSnapshot(
      baseInput,
      snapshot({ exactAssignment: null }),
    );
    expect(result).toMatchObject({
      status: "RESOLVED",
      profile: { profileKey: "default-profile", scopeVariant: null },
    });
    const empty = resolveBootstrapAiSnapshot(
      baseInput,
      snapshot({ exactAssignment: assignment("variant", null) }),
    );
    expect(empty).toMatchObject({
      status: "RESOLVED",
      profile: { profileKey: "default-profile" },
    });
  });

  it("does not fall back for unknown identities and reports disabled hierarchy", () => {
    expect(
      resolveBootstrapAiSnapshot(baseInput, snapshot({ hierarchy: null })),
    ).toMatchObject({ reason: "UNSUPPORTED_DETECTED_AI" });
    expect(
      resolveBootstrapAiSnapshot(
        { ...baseInput, detected: { ...detected, variant: "unknown" } },
        snapshot(),
      ),
    ).toMatchObject({ reason: "UNSUPPORTED_DETECTED_AI" });
    expect(
      resolveBootstrapAiSnapshot(
        baseInput,
        snapshot({ hierarchy: { ...hierarchy, adapterStatus: "DISABLED" } }),
      ),
    ).toMatchObject({ reason: "AI_DISABLED" });
    expect(
      resolveBootstrapAiSnapshot(
        baseInput,
        snapshot({ hierarchy: { ...hierarchy, surfaceStatus: "ARCHIVED" } }),
      ),
    ).toMatchObject({ reason: "AI_DISABLED" });
    expect(
      resolveBootstrapAiSnapshot(
        baseInput,
        snapshot({ hierarchy: { ...hierarchy, variantStatus: "DISABLED" } }),
      ),
    ).toMatchObject({ reason: "AI_DISABLED" });
    expect(
      resolveBootstrapAiSnapshot(
        baseInput,
        snapshot({ exactAssignment: null, defaultAssignment: null }),
      ),
    ).toMatchObject({ reason: "NO_PROFILE" });
  });

  it("uses baseline for DIRECT and PAUSED, and the accepted selector for ROLLOUT", () => {
    const paused = {
      ...direct("exact"),
      mode: "PAUSED",
      candidateProfileRevisionId: "candidate",
    };
    const candidateProfiles = [
      profile("exact", "standard-profile"),
      profile("candidate", "candidate-profile"),
      profile("default", "default-profile", null),
    ];
    expect(
      resolveBootstrapAiSnapshot(
        baseInput,
        snapshot({
          profiles: candidateProfiles,
          exactAssignment: assignment("variant", paused),
        }),
      ),
    ).toMatchObject({
      status: "RESOLVED",
      profile: { profileKey: "standard-profile" },
    });
    const rollout = {
      ...direct("exact"),
      mode: "ROLLOUT",
      candidateProfileRevisionId: "candidate",
      percentageBps: 10000,
    };
    const result = resolveBootstrapAiSnapshot(
      baseInput,
      snapshot({
        profiles: candidateProfiles,
        exactAssignment: assignment("variant", rollout),
      }),
    );
    expect(result).toMatchObject({
      status: "RESOLVED",
      profile: { profileKey: "candidate-profile" },
    });
    expect(
      selectAssignedProfileRevision({
        mode: "ROLLOUT",
        baselineProfileRevisionId: "default",
        candidateProfileRevisionId: "exact",
        percentageBps: 10000,
        cohortSeed: Buffer.alloc(32, 7),
        subjectKind: "ACCOUNT",
        subjectId: "account",
      }),
    ).toBe("exact");
  });

  it("selects rollout subjects from authenticated account or device identity", () => {
    const latest = {
      ...direct("default"),
      mode: "ROLLOUT",
      candidateProfileRevisionId: "exact",
      percentageBps: 10000,
    };
    const account = resolveBootstrapAiSnapshot(
      baseInput,
      snapshot({ exactAssignment: assignment("variant", latest, "ACCOUNT") }),
    );
    const device = resolveBootstrapAiSnapshot(
      { ...baseInput, accountId: "other-account" },
      snapshot({ exactAssignment: assignment("variant", latest, "DEVICE") }),
    );
    expect(account).toMatchObject({ status: "RESOLVED" });
    expect(device).toMatchObject({ status: "RESOLVED" });
  });

  it("returns profile incompatibility only after valid profile integrity checks", () => {
    const incompatible = {
      ...compatibility,
      minimumExtensionVersion: "2.0.0" as const,
    };
    expect(
      resolveBootstrapAiSnapshot(
        baseInput,
        snapshot({
          profiles: [
            {
              ...profile("exact", "standard-profile"),
              compatibility: incompatible,
              contentSha256: profileRevisionFingerprint({
                content,
                compatibility: incompatible,
              }),
            },
          ],
        }),
      ),
    ).toMatchObject({ reason: "PROFILE_INCOMPATIBLE" });
    expect(() =>
      resolveBootstrapAiSnapshot(
        baseInput,
        snapshot({
          profiles: [
            {
              ...profile("exact", "standard-profile"),
              contentSha256: "0".repeat(64),
            },
          ],
        }),
      ),
    ).toThrow(BootstrapAiResolutionError);
    expect(() =>
      resolveBootstrapAiSnapshot(
        baseInput,
        snapshot({
          profiles: [
            { ...profile("exact", "standard-profile"), state: "CANDIDATE" },
          ],
        }),
      ),
    ).toThrow(BootstrapAiResolutionError);
  });

  it("passes authenticated resolution inputs through the repository", async () => {
    let seen: unknown;
    const service = new BootstrapAiResolutionService({
      resolve: async (input) => {
        seen = input;
        return snapshot();
      },
    });
    await service.resolve(baseInput);
    expect(seen).toEqual({
      family: "chatgpt",
      surface: "standard",
      variant: "standard_composer_v1",
      browserFamily: "chrome",
    });
  });
});

describe("P7.3 detected hierarchy lookup identity", () => {
  const foreignHierarchies = [
    { label: "family", changes: { adapterKey: "alice" } },
    { label: "surface", changes: { surfaceKey: "work" } },
  ];

  for (const { label, changes } of foreignHierarchies) {
    const foreign = () => snapshot({ hierarchy: { ...hierarchy, ...changes } });

    it(`rejects a coherent foreign ${label} instead of relabelling its profile`, () => {
      expect(() => resolveBootstrapAiSnapshot(baseInput, foreign())).toThrow(
        BootstrapAiResolutionError,
      );
    });

    it(`rejects a foreign ${label} for a null-variant surface default`, () => {
      expect(() =>
        resolveBootstrapAiSnapshot(
          { ...baseInput, detected: { ...detected, variant: null } },
          snapshot({
            hierarchy: {
              ...hierarchy,
              ...changes,
              variantId: null,
              variantKey: null,
              variantStatus: null,
            },
            exactAssignment: null,
          }),
        ),
      ).toThrow(BootstrapAiResolutionError);
    });

    it(`does not disguise a foreign ${label} as disabled or missing a profile`, () => {
      for (const value of [
        snapshot({
          hierarchy: { ...hierarchy, ...changes, adapterStatus: "DISABLED" },
        }),
        snapshot({
          hierarchy: { ...hierarchy, ...changes },
          exactAssignment: null,
          defaultAssignment: null,
        }),
      ]) {
        expect(() => resolveBootstrapAiSnapshot(baseInput, value)).toThrow(
          BootstrapAiResolutionError,
        );
      }
    });

    it(`rejects a foreign ${label} through the normal resolution service`, async () => {
      const resolve = vi.fn(async () => foreign());
      const service = new BootstrapAiResolutionService({ resolve });
      await expect(service.resolve(baseInput)).rejects.toMatchObject({
        code: "AI_RESOLUTION_SOURCE_CORRUPTED",
      });
      expect(resolve).toHaveBeenCalledExactlyOnceWith({
        family: detected.family,
        surface: detected.surface,
        variant: detected.variant,
        browserFamily: baseInput.browser.family,
      });
    });

    it(`never reads a prompt tree from a foreign ${label}`, async () => {
      const promptTree = vi.fn(async () => null);
      const service = new BootstrapAiResolutionService({
        resolve: async () => foreign(),
        promptTree,
      });
      await expect(service.resolvePromptTree(baseInput)).rejects.toMatchObject({
        code: "AI_RESOLUTION_SOURCE_CORRUPTED",
      });
      expect(promptTree).not.toHaveBeenCalled();
    });

    it(`rejects a foreign ${label} through local-candidate enumeration`, async () => {
      const service = new BootstrapAiResolutionService({
        resolve: async ({ browserFamily }) =>
          browserFamily === "chrome"
            ? foreign()
            : snapshot({ exactAssignment: null, defaultAssignment: null }),
      });
      await expect(
        service.resolveLocalCandidates({
          detected,
          contractVersion: baseInput.contractVersion,
          accountId: baseInput.accountId,
          deviceId: baseInput.deviceId,
        }),
      ).rejects.toMatchObject({ code: "AI_RESOLUTION_SOURCE_CORRUPTED" });
    });
  }

  it.each([
    { family: "chatgpt", surface: "standard" },
    { family: "chatgpt", surface: "work" },
    { family: "alice", surface: "standard" },
  ])("preserves an exact $family/$surface hierarchy", ({ family, surface }) => {
    const context = { ...detected, family, surface };
    const value = snapshot({
      hierarchy: { ...hierarchy, adapterKey: family, surfaceKey: surface },
    });
    expect(
      resolveBootstrapAiSnapshot({ ...baseInput, detected: context }, value),
    ).toMatchObject({
      status: "RESOLVED",
      detected: context,
      profile: { profileKey: "standard-profile" },
    });
  });

  it("preserves a valid null-variant default", () => {
    const context = { ...detected, variant: null };
    expect(
      resolveBootstrapAiSnapshot(
        { ...baseInput, detected: context },
        snapshot({
          hierarchy: {
            ...hierarchy,
            variantId: null,
            variantKey: null,
            variantStatus: null,
          },
          exactAssignment: null,
        }),
      ),
    ).toMatchObject({
      status: "RESOLVED",
      detected: context,
      profile: { profileKey: "default-profile", scopeVariant: null },
    });
  });

  it("reads the original prompt tree only after a valid exact hierarchy", async () => {
    const promptTree = vi.fn(async () => null);
    const service = new BootstrapAiResolutionService({
      resolve: async () => snapshot(),
      promptTree,
    });
    await expect(service.resolvePromptTree(baseInput)).resolves.toEqual({
      aiId: hierarchy.adapterId,
      publication: null,
    });
    expect(promptTree).toHaveBeenCalledExactlyOnceWith(hierarchy.adapterId);
  });

  it("preserves the valid browser-specific local candidate", async () => {
    const service = new BootstrapAiResolutionService({
      resolve: async ({ browserFamily }) =>
        browserFamily === "chrome"
          ? snapshot()
          : snapshot({ exactAssignment: null, defaultAssignment: null }),
    });
    const result = await service.resolveLocalCandidates({
      detected,
      contractVersion: baseInput.contractVersion,
      accountId: baseInput.accountId,
      deviceId: baseInput.deviceId,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      browserFamily: "chrome",
      resolution: { status: "RESOLVED", detected },
    });
  });
});

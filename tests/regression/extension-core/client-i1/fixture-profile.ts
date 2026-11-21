// Shared existing installed-scenario profile; no service or DB startup on import.
import { readFileSync } from "node:fs";
import { profileRevisionFingerprint } from "../../../../packages/server/adapter-registry/src/index.js";
import type { BootstrapAiResolutionService } from "../../../../packages/server/bootstrap/src/index.js";
const r5bProfileContent = {
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
  observation: { mode: "polling", intervalMs: 500 },
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
} as const;
export const fixtureProfileContractVersion =
  process.env.SA_I1_PROFILE_CONTRACT_VERSION === "control_plane_v2"
    ? "control_plane_v2"
    : "control_plane_v1";
export const fixtureExtensionVersion =
  process.env.SA_I1_EXTENSION_VERSION?.trim() || "0.2.4";
if (!fixtureExtensionVersion.match(/^\d+\.\d+\.\d+$/))
  throw new Error("INVALID_FIXTURE_EXTENSION_VERSION");
export const fixtureProfileBrowserFamilies = (
  process.env.SA_I1_PROFILE_BROWSER_FAMILIES ?? "chrome"
)
  .split(",")
  .map((value) => value.trim())
  .filter(
    (value): value is "chrome" | "opera" | "firefox" | "yandex_chromium" =>
      ["chrome", "opera", "firefox", "yandex_chromium"].includes(value),
  );
if (!fixtureProfileBrowserFamilies.length)
  throw new Error(
    "SA_I1_PROFILE_BROWSER_FAMILIES has no supported browser family",
  );
const r5bProfileCompatibility = {
  schemaVersion: "profile_compatibility_v1",
  contractVersion: fixtureProfileContractVersion,
  browserFamilies: fixtureProfileBrowserFamilies,
  minimumBrowserVersions: [],
  minimumExtensionVersion: null,
} as const;
const fixtureProfileControlPath = process.env.SA_I1_PROFILE_CONTROL_PATH;
function resolvedFixtureProfile() {
  let revision = 1;
  let composerMode: "packaged" | "status_role" = "packaged";
  if (fixtureProfileControlPath) {
    const value = JSON.parse(
      readFileSync(fixtureProfileControlPath, "utf8"),
    ) as {
      revision?: unknown;
      composerMode?: unknown;
    };
    if (
      typeof value.revision !== "number" ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 1
    )
      throw new Error("INVALID_FIXTURE_PROFILE_REVISION");
    if (
      value.composerMode !== "packaged" &&
      value.composerMode !== "status_role"
    )
      throw new Error("INVALID_FIXTURE_PROFILE_MODE");
    revision = value.revision;
    composerMode = value.composerMode;
  }
  const content =
    composerMode === "packaged"
      ? r5bProfileContent
      : {
          ...r5bProfileContent,
          selectors: {
            ...r5bProfileContent.selectors,
            composer: {
              ...r5bProfileContent.selectors.composer,
              primary: {
                kind: "accessibility_role_name" as const,
                role: "status" as const,
                reference: "composer-root" as const,
              },
            },
          },
        };
  return {
    profileKey: "r5b-chatgpt-profile",
    revision,
    scopeVariant: null,
    schemaVersion: "adapter_profile_v1" as const,
    contentSha256: profileRevisionFingerprint({
      content,
      compatibility: r5bProfileCompatibility,
    }),
    content,
    compatibility: r5bProfileCompatibility,
  };
}
export const r5bAiResolution = {
  resolve: async (input: {
    detected: { family: string; surface: string; variant: string | null };
  }) => ({
    status: "RESOLVED" as const,
    detected: input.detected,
    profile: resolvedFixtureProfile(),
  }),
  resolveLocalCandidates: async (input: {
    detected: { family: string; surface: string; variant: string | null };
  }) =>
    fixtureProfileBrowserFamilies.map((browserFamily) => ({
      browserFamily,
      resolution: {
        status: "RESOLVED" as const,
        detected: input.detected,
        profile: resolvedFixtureProfile(),
      },
    })),
} as unknown as BootstrapAiResolutionService;

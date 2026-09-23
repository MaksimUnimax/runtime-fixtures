import {
  BootstrapSnapshotPayloadV1Schema,
  type BootstrapDetectedAiV1,
  type BootstrapSnapshotPayloadV1,
} from "@product/contracts";
import { compareBrowserVersionV1 } from "@product/compatibility";
import {
  AdapterProfileContentV1Schema,
  ProfileCompatibilityConstraintsV1Schema,
  profileRevisionFingerprint,
  validateProfileContent,
  type AdapterProfileContentV1,
  type ProfileCompatibilityConstraintsV1,
} from "@product/adapter-registry";
import { compareSemVerV1, type BrowserFamily } from "@product/shared";

export type ClientAiBindingContext = {
  detectedAi: BootstrapDetectedAiV1 | null;
  contractVersion: "control_plane_v1";
  extensionVersion: string;
  browser: { family: BrowserFamily; version: string };
};

export type SimulatedBoundAiProfile = {
  profileKey: string;
  revision: number;
  scopeVariant: string | null;
  content: AdapterProfileContentV1;
  compatibility: ProfileCompatibilityConstraintsV1;
  contentSha256: string;
};

export type SimulatedAiBinding = {
  detected: BootstrapDetectedAiV1;
  profile: SimulatedBoundAiProfile;
};

export type ClientAiBindingFailure =
  | "AI_CONTEXT_MISMATCH"
  | "INVALID_PROFILE"
  | "PROFILE_INCOMPATIBLE"
  | "INVALID_AI_STATE";

export type ClientAiBindingResult =
  | { ok: true; binding: SimulatedAiBinding | null }
  | { ok: false; error: ClientAiBindingFailure };

function sameDetected(
  left: BootstrapDetectedAiV1,
  right: BootstrapDetectedAiV1,
): boolean {
  return (
    left.family === right.family &&
    left.surface === right.surface &&
    left.variant === right.variant
  );
}

function compatible(
  profile: ProfileCompatibilityConstraintsV1,
  context: ClientAiBindingContext,
): boolean {
  if (profile.contractVersion !== context.contractVersion) return false;
  if (!profile.browserFamilies.includes(context.browser.family)) return false;
  const minimumBrowser = profile.minimumBrowserVersions.find(
    (value) => value.browserFamily === context.browser.family,
  );
  if (
    minimumBrowser &&
    (compareBrowserVersionV1(
      context.browser.version,
      minimumBrowser.minimumVersion,
    ) ?? -1) < 0
  )
    return false;
  return (
    !profile.minimumExtensionVersion ||
    compareSemVerV1(
      context.extensionVersion,
      profile.minimumExtensionVersion,
    ) >= 0
  );
}

/** Validates and binds only after the signed envelope has been verified. */
export function validateAndBindBootstrapAi(
  payload: BootstrapSnapshotPayloadV1,
  context: ClientAiBindingContext,
): ClientAiBindingResult {
  const parsed = BootstrapSnapshotPayloadV1Schema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: "INVALID_AI_STATE" };
  const ai = parsed.data.ai;
  if (!context.detectedAi)
    return ai.status === "UNCONFIGURED"
      ? { ok: true, binding: null }
      : { ok: false, error: "AI_CONTEXT_MISMATCH" };
  if (ai.status === "UNCONFIGURED")
    return { ok: false, error: "AI_CONTEXT_MISMATCH" };
  if (!sameDetected(ai.detected, context.detectedAi))
    return { ok: false, error: "AI_CONTEXT_MISMATCH" };
  if (ai.status === "UNAVAILABLE") return { ok: true, binding: null };
  if (
    ai.profile.scopeVariant !== null &&
    ai.profile.scopeVariant !== context.detectedAi.variant
  )
    return { ok: false, error: "AI_CONTEXT_MISMATCH" };
  try {
    const content = AdapterProfileContentV1Schema.parse(ai.profile.content);
    const compatibility = ProfileCompatibilityConstraintsV1Schema.parse(
      ai.profile.compatibility,
    );
    const validated = validateProfileContent({ content, compatibility });
    if (
      validated.contentSha256 !== ai.profile.contentSha256 ||
      profileRevisionFingerprint({ content, compatibility }) !==
        ai.profile.contentSha256
    )
      return { ok: false, error: "INVALID_PROFILE" };
    if (!compatible(compatibility, context))
      return { ok: false, error: "PROFILE_INCOMPATIBLE" };
    return {
      ok: true,
      binding: {
        detected: context.detectedAi,
        profile: {
          profileKey: ai.profile.profileKey,
          revision: ai.profile.revision,
          scopeVariant: ai.profile.scopeVariant,
          content,
          compatibility,
          contentSha256: ai.profile.contentSha256,
        },
      },
    };
  } catch {
    return { ok: false, error: "INVALID_PROFILE" };
  }
}

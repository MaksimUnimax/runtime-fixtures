import { createHash } from "node:crypto";
import { canonicalizeJson } from "@product/remote-config";
import type {
  BaselineContourKey,
  HealthClassificationResult,
  HealthLevel,
  HealthProductFinding,
  HealthScope,
  HealthState,
} from "./types.js";

// The order is the accepted baseline contour authority, not object or database
// order. It is used only after finding severity has selected the decisive class.
export const INCIDENT_CONTOUR_ORDER: readonly BaselineContourKey[] = [
  "C01_PAGE_IDENTITY",
  "C02_CONVERSATION_ROOT",
  "C03_COMPOSER_ROOT",
  "C04_COMPOSER_INPUT",
  "C05_SEND_CONTROL",
  "C06_BUSY_STOP_STATE",
  "C07_ASSISTANT_MESSAGE",
  "C08_MESSAGE_COMPLETION",
  "C09_COMMAND_CODE_BLOCK_SURFACE",
  "C10_NATIVE_COPY_CONTROL",
  "C11_CONVERSATION_IDENTITY",
  "C12_DELIVERY_INSERTION_PATH",
  "C13_BLOCKING_STATE",
];

const FINDING_PRIORITY: Readonly<
  Record<HealthProductFinding["finding"], number>
> = {
  BROKEN: 0,
  DEGRADED: 1,
  DRIFT: 2,
};

export type HealthIncidentIdentity = Readonly<{
  provider: string;
  surface: string;
  target: string;
  browserFamily: HealthScope["browserFamily"];
  healthLevel: HealthLevel;
  profileId: string;
  healthSuiteMachineKey: string;
  rootContourKey: BaselineContourKey | null;
}>;

export type HealthIncidentStatus =
  | "OPEN"
  | "INVESTIGATING"
  | "CANDIDATE_FIX"
  | "CANDIDATE_PASS"
  | "CANARY_ROLLOUT"
  | "ROLLOUT"
  | "RESOLVED"
  | "FALSE_POSITIVE"
  | "MAINTENANCE";

export type HealthIncidentScopeIdentity = Omit<
  HealthIncidentIdentity,
  "rootContourKey"
>;

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalizeJson(value)).digest("hex");
}

export function healthIncidentScopeIdentity(
  scope: HealthScope,
  healthLevel: HealthLevel,
): HealthIncidentScopeIdentity {
  return {
    provider: scope.adapterFamilyKey,
    surface: scope.surfaceKey,
    target: scope.variant?.machineKey ?? "default",
    browserFamily: scope.browserFamily,
    healthLevel,
    profileId: scope.profile.id,
    healthSuiteMachineKey: scope.healthSuite.machineKey,
  };
}

export function healthIncidentScopeSha256(
  scope: HealthScope,
  healthLevel: HealthLevel,
): string {
  return hash({
    version: 1,
    ...healthIncidentScopeIdentity(scope, healthLevel),
  });
}

export function healthIncidentKeySha256(
  scope: HealthScope,
  healthLevel: HealthLevel,
  rootContourKey: BaselineContourKey | null,
): string {
  return hash({
    version: 1,
    ...healthIncidentScopeIdentity(scope, healthLevel),
    rootContourKey,
  });
}

export function selectRootContour(
  classification: Pick<HealthClassificationResult, "productFindings">,
): BaselineContourKey | null {
  const contourOrder = new Map(
    INCIDENT_CONTOUR_ORDER.map((key, index) => [key, index]),
  );
  const root = [...classification.productFindings].sort((left, right) => {
    const priority =
      FINDING_PRIORITY[left.finding] - FINDING_PRIORITY[right.finding];
    if (priority !== 0) return priority;
    return (
      (contourOrder.get(left.contourKey) ?? Number.MAX_SAFE_INTEGER) -
      (contourOrder.get(right.contourKey) ?? Number.MAX_SAFE_INTEGER)
    );
  })[0];
  return root?.contourKey ?? null;
}

export function isIncidentWorthyHealthState(state: HealthState): boolean {
  return state === "DRIFT" || state === "DEGRADED" || state === "BROKEN";
}

export function isActiveIncidentStatus(status: string): boolean {
  return [
    "OPEN",
    "INVESTIGATING",
    "CANDIDATE_FIX",
    "CANDIDATE_PASS",
    "CANARY_ROLLOUT",
    "ROLLOUT",
    "MAINTENANCE",
  ].includes(status);
}

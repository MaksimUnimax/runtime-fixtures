import type { BaselineContourKey, HealthLevel, HealthState } from "./types.js";

export const LLM_HEALTH_NOTIFICATION_SOURCE = "LLM_HEALTH" as const;
export const LLM_HEALTH_NOTIFICATION_ROUTE = "OWNER_MONITORING" as const;
export const LLM_HEALTH_NOTIFICATION_COOLDOWN_MS = 15 * 60 * 1000;
export type LlmHealthNotificationPolicy = Readonly<{
  cooldownMs: number;
}>;
export const DEFAULT_LLM_HEALTH_NOTIFICATION_POLICY = {
  cooldownMs: LLM_HEALTH_NOTIFICATION_COOLDOWN_MS,
} as const satisfies LlmHealthNotificationPolicy;

export const LlmHealthNotificationEventKind = {
  INCIDENT_OPENED: "INCIDENT_OPENED",
  INCIDENT_ESCALATED: "INCIDENT_ESCALATED",
  INCIDENT_RECOVERED: "INCIDENT_RECOVERED",
  MAINTENANCE_ENTERED: "MAINTENANCE_ENTERED",
  MAINTENANCE_EXITED: "MAINTENANCE_EXITED",
} as const;
export type LlmHealthNotificationEventKind =
  (typeof LlmHealthNotificationEventKind)[keyof typeof LlmHealthNotificationEventKind];

export const LlmHealthNotificationSeverity = {
  INFO: "INFO",
  WARNING: "WARNING",
  CRITICAL: "CRITICAL",
} as const;
export type LlmHealthNotificationSeverity =
  (typeof LlmHealthNotificationSeverity)[keyof typeof LlmHealthNotificationSeverity];

export type LlmHealthNotificationInput = Readonly<{
  incidentId: string;
  healthRunId: string;
  eventKind: LlmHealthNotificationEventKind;
  healthState: HealthState;
  provider: string;
  surface: string;
  healthLevel: HealthLevel;
  rootContourKey: BaselineContourKey | null;
  observedAt: Date;
}>;

export type LlmHealthNotificationEvent = Readonly<
  LlmHealthNotificationInput & {
    sourceDomain: typeof LLM_HEALTH_NOTIFICATION_SOURCE;
    routeKey: typeof LLM_HEALTH_NOTIFICATION_ROUTE;
    severity: LlmHealthNotificationSeverity;
    dedupKey: string;
    cooldownUntil: Date;
    payload: Readonly<{
      schemaVersion: 1;
      sourceDomain: typeof LLM_HEALTH_NOTIFICATION_SOURCE;
      incidentId: string;
      healthRunId: string;
      eventKind: LlmHealthNotificationEventKind;
      provider: string;
      surface: string;
      healthLevel: HealthLevel;
      healthState: HealthState;
      severity: LlmHealthNotificationSeverity;
      rootContourKey: BaselineContourKey | null;
      routeKey: typeof LLM_HEALTH_NOTIFICATION_ROUTE;
      observedAt: string;
      safeEvidenceReference: string;
    }>;
  }
>;

const severityRank: Record<LlmHealthNotificationSeverity, number> = {
  INFO: 0,
  WARNING: 1,
  CRITICAL: 2,
};

export function notificationSeverityForHealthState(
  state: HealthState,
): LlmHealthNotificationSeverity | null {
  switch (state) {
    case "BROKEN":
      return "CRITICAL";
    case "DRIFT":
    case "DEGRADED":
      return "WARNING";
    case "HEALTHY":
    case "UNKNOWN":
    case "MAINTENANCE":
      return null;
  }
}

export function compareNotificationSeverity(
  left: LlmHealthNotificationSeverity,
  right: LlmHealthNotificationSeverity,
): number {
  return severityRank[left] - severityRank[right];
}

export function notificationDedupKey(input: {
  incidentId: string;
  eventKind: LlmHealthNotificationEventKind;
  severity: LlmHealthNotificationSeverity;
}): string {
  const suffix =
    input.eventKind === "INCIDENT_ESCALATED" ? `:${input.severity}` : "";
  return `llm-health:v1:${input.incidentId}:${input.eventKind}${suffix}`;
}

export function isRepeatedFailureWithinCooldown(input: {
  lastObservedAt: Date;
  observedAt: Date;
  lastSeverity: LlmHealthNotificationSeverity;
  severity: LlmHealthNotificationSeverity;
  cooldownMs?: number;
}): boolean {
  const cooldownMs =
    input.cooldownMs ?? DEFAULT_LLM_HEALTH_NOTIFICATION_POLICY.cooldownMs;
  return (
    compareNotificationSeverity(input.severity, input.lastSeverity) <= 0 &&
    input.observedAt.getTime() <= input.lastObservedAt.getTime() + cooldownMs
  );
}

export function deriveLlmHealthNotificationEvent(
  input: LlmHealthNotificationInput,
  policy: LlmHealthNotificationPolicy = DEFAULT_LLM_HEALTH_NOTIFICATION_POLICY,
): LlmHealthNotificationEvent | null {
  if (!Number.isFinite(policy.cooldownMs) || policy.cooldownMs < 0)
    throw new Error("LLM_HEALTH_NOTIFICATION_COOLDOWN_INVALID");
  const productSeverity = notificationSeverityForHealthState(input.healthState);
  const severity =
    input.eventKind === "INCIDENT_RECOVERED" ||
    input.eventKind === "MAINTENANCE_ENTERED" ||
    input.eventKind === "MAINTENANCE_EXITED"
      ? "INFO"
      : productSeverity;
  if (!severity) return null;

  const observedAt = new Date(input.observedAt.getTime());
  const cooldownUntil = new Date(observedAt.getTime() + policy.cooldownMs);
  const dedupKey = notificationDedupKey({
    incidentId: input.incidentId,
    eventKind: input.eventKind,
    severity,
  });
  return {
    ...input,
    sourceDomain: LLM_HEALTH_NOTIFICATION_SOURCE,
    routeKey: LLM_HEALTH_NOTIFICATION_ROUTE,
    severity,
    dedupKey,
    cooldownUntil,
    payload: {
      schemaVersion: 1,
      sourceDomain: LLM_HEALTH_NOTIFICATION_SOURCE,
      incidentId: input.incidentId,
      healthRunId: input.healthRunId,
      eventKind: input.eventKind,
      provider: input.provider,
      surface: input.surface,
      healthLevel: input.healthLevel,
      healthState: input.healthState,
      severity,
      rootContourKey: input.rootContourKey,
      routeKey: LLM_HEALTH_NOTIFICATION_ROUTE,
      observedAt: observedAt.toISOString(),
      safeEvidenceReference: `health-run:${input.healthRunId}`,
    },
  };
}

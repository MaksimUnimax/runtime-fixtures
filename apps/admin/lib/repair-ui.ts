export type RepairCaseState =
  | "PENDING_APPROVAL"
  | "REJECTED"
  | "APPROVAL_REVOKED"
  | "APPROVAL_NOT_YET_VALID"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_STALE"
  | "APPROVAL_CURRENT"
  | "APPLY_IN_PROGRESS"
  | "APPLIED";

export type RepairStaleReason =
  | "BINDING_INVALID"
  | "BINDING_HASH_INVALID"
  | "PROFILE_IDENTITY_CHANGED"
  | "OBSERVATION_PROOF_INVALID"
  | "OBSERVATION_BINDING_CHANGED"
  | "CURRENT_OBSERVATION_MISSING"
  | "CURRENT_OBSERVATION_CHANGED"
  | "INCIDENT_SCOPE_CHANGED"
  | "INCIDENT_NOT_ACTIVE"
  | "CANDIDATE_STATE_CHANGED"
  | "BASELINE_OR_ROLLBACK_NOT_PUBLISHED"
  | "SUITE_CHANGED"
  | "H4_CHANGED"
  | "ASSIGNMENT_CHANGED"
  | "APPROVAL_BINDING_CHANGED";
export type RepairCase = {
  repairCaseId: string;
  caseRevision: number;
  bindingSha256: string;
  scopeSha256: string;
  createdAt: string;
  caseState: RepairCaseState;
  staleReasons: RepairStaleReason[];
  executionAuthority: false;
  incident: {
    id: string;
    status: string;
    scopeSha256: string;
    firstSeenRunId: string;
    latestSeenRunId: string;
    lastObservedRunId: string;
    resolvedByRunId: string | null;
    resolvedAt: string | null;
  };
  observation: {
    runId: string;
    normalizedStateSha256: string;
    currentNormalizedStateSha256: string | null;
    currentHealthState: string | null;
    currentRunId: string | null;
  };
  candidate: {
    profileId: string;
    profileRevisionId: string;
    revision: number;
    contentSha256: string;
    state: string;
  };
  acceptedBaselineProfileRevisionId: string;
  rollbackProfileRevisionId: string;
  testedExtension: {
    version: string;
    browserFamily: string;
    browserVersion: string;
    sourceCommitSha: string;
    sourceTreeSha: string;
    packageSha256: string;
  };
  testEvidence: {
    suiteRevisionId: string;
    suiteMachineKey: string;
    suiteRevision: number;
    suiteDefinitionSha256: string;
    h4EvaluationId: string;
    h4EvaluationKey: string;
    h4Status: string | null;
    h4Outcome: string | null;
    installedBehaviorEvidenceSha256: string;
    matrixSha256: string;
    resultsSha256: string;
  };
  assignment: {
    id: string;
    expectedRevision: number;
    initialPercentageBps: number;
    currentRevision: number | null;
    currentRevisionId: string | null;
    currentMode: string | null;
    currentBaselineProfileRevisionId: string | null;
    currentCandidateProfileRevisionId: string | null;
    currentPercentageBps: number | null;
  };
  decision: null | {
    id: string;
    operatorPrincipalId: string;
    decision: "APPROVED" | "REJECTED";
    bindingSha256: string;
    requestSha256: string;
    manualChecklistSha256: string;
    issuedAt: string;
    expiresAt: string;
    revokedAt: string | null;
    state:
      | "NONE"
      | "REJECTED"
      | "REVOKED"
      | "NOT_YET_VALID"
      | "EXPIRED"
      | "STALE_APPROVED"
      | "CURRENT_APPROVED";
  };
  operation: null | {
    id: string;
    approvalId: string;
    kind: string;
    state: "IN_PROGRESS" | "COMMITTED";
    actorPrincipalId: string;
    admissionTxid: number;
    startedAt: string;
    committedAt: string | null;
    publishedProfileRevisionId: string | null;
    assignmentRevisionId: string | null;
  };
};

const stateLabels: Record<RepairCaseState, string> = {
  PENDING_APPROVAL: "Ожидает решения оператора",
  REJECTED: "Отклонено оператором",
  APPROVAL_REVOKED: "Разрешение отозвано",
  APPROVAL_NOT_YET_VALID: "Разрешение ещё не действует",
  APPROVAL_EXPIRED: "Срок разрешения истёк",
  APPROVAL_STALE: "Разрешение устарело после изменения доказательств",
  APPROVAL_CURRENT: "Разрешение актуально для проверки",
  APPLY_IN_PROGRESS: "Серверная операция уже выполняется",
  APPLIED: "Изменение уже применено",
};

const staleLabels: Record<RepairStaleReason, string> = {
  BINDING_INVALID: "Связка кандидата повреждена или не проходит схему.",
  BINDING_HASH_INVALID: "Отпечаток связки больше не совпадает.",
  PROFILE_IDENTITY_CHANGED:
    "Идентичность baseline/candidate/rollback изменилась.",
  OBSERVATION_PROOF_INVALID:
    "Сохранённое наблюдение больше не проходит проверку.",
  OBSERVATION_BINDING_CHANGED: "Наблюдение больше не соответствует связке.",
  CURRENT_OBSERVATION_MISSING: "Текущее контрольное наблюдение отсутствует.",
  CURRENT_OBSERVATION_CHANGED: "Текущее наблюдение отличается от проверенного.",
  INCIDENT_SCOPE_CHANGED: "Scope инцидента изменился.",
  INCIDENT_NOT_ACTIVE: "Инцидент больше не активен.",
  CANDIDATE_STATE_CHANGED: "Состояние candidate-профиля изменилось.",
  BASELINE_OR_ROLLBACK_NOT_PUBLISHED:
    "Baseline или rollback больше не опубликован.",
  SUITE_CHANGED: "Набор проверок изменился.",
  H4_CHANGED: "H4-доказательство изменилось.",
  ASSIGNMENT_CHANGED: "Текущее назначение профиля изменилось.",
  APPROVAL_BINDING_CHANGED: "Решение оператора относится к другой связке.",
};
export function repairCaseStateLabel(state: string): string {
  return (
    stateLabels[state as RepairCaseState] ?? "Неизвестное состояние случая"
  );
}

export function repairStaleReasonLabel(reason: string): string {
  return (
    staleLabels[reason as RepairStaleReason] ??
    "Неизвестная причина устаревания."
  );
}

export function repairDecisionLabel(item: RepairCase): string {
  if (!item.decision) return "Решение отсутствует";
  const labels = {
    NONE: "Решение отсутствует",
    REJECTED: "Отклонено",
    REVOKED: "Отозвано",
    NOT_YET_VALID: "Ещё не действует",
    EXPIRED: "Истекло",
    STALE_APPROVED: "Одобрение устарело",
    CURRENT_APPROVED: "Одобрение актуально",
  } as const;
  return labels[item.decision.state];
}

export function repairOperationLabel(item: RepairCase): string {
  if (!item.operation) return "Применение не запускалось";
  return item.operation.state === "COMMITTED"
    ? "Серверная операция завершена"
    : "Серверная операция выполняется";
}
export function repairChangeSummary(item: RepairCase): string {
  const current = item.observation.currentNormalizedStateSha256;
  if (!current)
    return "Текущее наблюдение отсутствует: сравнение с проверенным состоянием невозможно.";
  if (current === item.observation.normalizedStateSha256)
    return "Текущее наблюдение совпадает с состоянием, на котором собран кандидат.";
  return "Текущее наблюдение изменилось после проверки кандидата; прежнее решение нельзя считать актуальным без повторной проверки.";
}

export function repairEvidenceGaps(item: RepairCase): string[] {
  const gaps: string[] = [];
  if (!item.observation.currentRunId)
    gaps.push("Нет текущего контрольного запуска.");
  if (!item.observation.currentNormalizedStateSha256)
    gaps.push("Нет текущего отпечатка наблюдения.");
  if (!item.observation.currentHealthState)
    gaps.push("Нет текущего Health-состояния.");
  if (!item.testEvidence.h4Status) gaps.push("Нет текущего статуса H4.");
  if (!item.testEvidence.h4Outcome) gaps.push("Нет результата H4.");
  if (item.assignment.currentRevision === null)
    gaps.push("Нет текущей ревизии назначения профиля.");
  if (!item.assignment.currentMode)
    gaps.push("Нет текущего режима назначения профиля.");
  if (item.assignment.currentPercentageBps === null)
    gaps.push("Нет текущего процента назначения профиля.");
  if (!item.decision) gaps.push("Нет решения оператора.");
  return gaps;
}

export function repairApplyUnavailableReason(item: RepairCase): string {
  if (item.executionAuthority !== false)
    return "Некорректная серверная проекция: право на применение не подтверждено.";
  if (item.caseState === "APPLIED")
    return "Эта страница только показывает уже завершённую серверную операцию; повторное применение недоступно.";
  if (item.caseState === "APPLY_IN_PROGRESS")
    return "Эта страница только наблюдает текущую серверную операцию; запуск ещё одной операции недоступен.";
  return "Применение недоступно: серверная проекция имеет executionAuthority=false. Эта страница не выдаёт право публиковать профиль, запускать rollout или менять production.";
}

export function repairScopeValid(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export function shortFingerprint(value: string): string {
  if (value.length <= 24) return value;
  return value.slice(0, 12) + "…" + value.slice(-8);
}

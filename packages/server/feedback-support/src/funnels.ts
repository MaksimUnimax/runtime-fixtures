import {
  type FeedbackFunnelNameV1,
  type FeedbackFunnelQueryV1,
  type FeedbackFunnelResponseV1,
  type FeedbackFunnelStageV1,
} from "@product/contracts";

export const FUNNEL_STAGES: Readonly<
  Record<FeedbackFunnelNameV1, readonly FeedbackFunnelStageV1[]>
> = {
  ONBOARDING: [
    "registration_started",
    "account_created",
    "device_activated",
    "first_store_added",
    "first_start",
  ],
  FIRST_VALUE: [
    "account_created",
    "device_activated",
    "first_store_added",
    "first_start",
  ],
  SUPPORT: [
    "feedback_case_created",
    "feedback_case_triaged",
    "feedback_case_resolved",
    "feedback_case_closed",
  ],
};

export type FunnelSignalRecord = {
  event: FeedbackFunnelStageV1;
  accountId: string | null;
  subjectId: string | null;
  occurredAt: Date;
  productVersion: string | null;
  extensionVersion: string | null;
  releaseIdentity: string | null;
  browserFamily: string | null;
  browserVersion: string | null;
  marketplace: string | null;
  supportCode: string | null;
};

export function funnelWindow(
  query: Pick<FeedbackFunnelQueryV1, "window" | "from" | "to">,
  now = new Date(),
): { from: Date; to: Date } {
  if (query.from && query.to)
    return { from: new Date(query.from), to: new Date(query.to) };
  const days = query.window === "1D" ? 1 : query.window === "7D" ? 7 : 30;
  return { from: new Date(now.getTime() - days * 86_400_000), to: now };
}

function entityId(
  funnel: FeedbackFunnelNameV1,
  row: FunnelSignalRecord,
): string | null {
  return funnel === "SUPPORT" ? row.subjectId : row.accountId;
}

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  if (fraction === 0.5 && values.length % 2 === 0) {
    const middle = values.length / 2;
    return (values[middle - 1]! + values[middle]!) / 2;
  }
  const index = Math.max(0, Math.ceil(values.length * fraction) - 1);
  return values[index] ?? null;
}

const dimensions = [
  "productVersion",
  "extensionVersion",
  "releaseIdentity",
  "browserFamily",
  "browserVersion",
  "marketplace",
  "supportCode",
] as const;

export function calculateFunnel(input: {
  funnel: FeedbackFunnelNameV1;
  from: Date;
  to: Date;
  records: readonly FunnelSignalRecord[];
}): FeedbackFunnelResponseV1 {
  const stages = FUNNEL_STAGES[input.funnel];
  const records = input.records
    .filter((row) => row.occurredAt >= input.from && row.occurredAt < input.to)
    .slice()
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const first = stages[0]!;
  const entry = new Map<string, Date>();
  for (const row of records) {
    const id = entityId(input.funnel, row);
    if (id && row.event === first && !entry.has(id))
      entry.set(id, row.occurredAt);
  }
  const reached = stages.map((stage, stageIndex) => {
    const perEntity = new Map<string, FunnelSignalRecord>();
    for (const row of records) {
      if (row.event !== stage) continue;
      const id = entityId(input.funnel, row);
      const start = id ? entry.get(id) : undefined;
      if (!id || !start || row.occurredAt < start || perEntity.has(id))
        continue;
      perEntity.set(id, row);
    }
    const previous = stageIndex === 0 ? entry.size : 0;
    const durations = [...perEntity].map(
      ([, row]) =>
        (row.occurredAt.getTime() -
          entry.get(entityId(input.funnel, row)!)!.getTime()) /
        1000,
    );
    return {
      stage,
      eligibleCount: entry.size,
      reachedCount: perEntity.size,
      conversionFromPrevious:
        stageIndex === 0
          ? entry.size
            ? 1
            : null
          : previous === 0
            ? null
            : perEntity.size / previous,
      cumulativeConversion: entry.size ? perEntity.size / entry.size : null,
      medianSeconds: percentile(durations, 0.5),
      p90Seconds: percentile(durations, 0.9),
      rows: perEntity,
    };
  });
  // The previous-stage denominator is the previous reached count, not the cohort.
  for (let index = 1; index < reached.length; index++) {
    const previousCount = reached[index - 1]!.reachedCount;
    reached[index]!.conversionFromPrevious = previousCount
      ? reached[index]!.reachedCount / previousCount
      : null;
  }
  const breakdowns: FeedbackFunnelResponseV1["breakdowns"] = [];
  for (const stage of reached) {
    for (const dimension of dimensions) {
      const counts = new Map<string, Set<string>>();
      for (const [id, row] of stage.rows) {
        const value = row[dimension];
        if (!value) continue;
        const set = counts.get(value) ?? new Set<string>();
        set.add(id);
        counts.set(value, set);
      }
      for (const [value, ids] of counts)
        breakdowns.push({
          stage: stage.stage,
          dimension,
          value,
          count: ids.size,
        });
    }
  }
  return {
    funnel: input.funnel,
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    cohortCount: entry.size,
    stages: reached.map(({ rows: _rows, ...metric }) => metric),
    breakdowns,
  };
}

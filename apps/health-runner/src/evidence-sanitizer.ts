import { z } from "zod";
import { H3BehaviorStepSchema, H3SurfaceSchema } from "./h3-contracts.js";
import { H3ContourObservationSchema } from "./h3-strategy.js";

export const H3EvidenceOutcomeSchema = z.enum([
  "PASS",
  "FAIL",
  "UNCERTAIN",
  "NOT_RUN",
]);
export type H3EvidenceOutcome = z.infer<typeof H3EvidenceOutcomeSchema>;

export const H3SafeEvidenceEventSchema = z
  .object({
    step: H3BehaviorStepSchema,
    outcome: H3EvidenceOutcomeSchema,
    durationMs: z.number().int().min(0).max(120_000),
    markerCount: z.number().int().min(0).max(64).nullable(),
    transitionObserved: z.boolean().nullable(),
    observations: z.array(H3ContourObservationSchema).max(13).default([]),
  })
  .strict();
export type H3SafeEvidenceEvent = Readonly<
  z.infer<typeof H3SafeEvidenceEventSchema>
>;

export const H3SafeEvidenceBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.uuid(),
    surface: H3SurfaceSchema,
    startedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }),
    events: z.array(H3SafeEvidenceEventSchema).min(1).max(32),
  })
  .strict();
export type H3SafeEvidenceBundle = Readonly<
  Omit<z.infer<typeof H3SafeEvidenceBundleSchema>, "events">
> & {
  readonly events: readonly H3SafeEvidenceEvent[];
};

export function sanitizeH3EvidenceEvent(input: unknown): H3SafeEvidenceEvent {
  return Object.freeze(H3SafeEvidenceEventSchema.parse(input));
}

export function sanitizeH3EvidenceBundle(input: unknown): H3SafeEvidenceBundle {
  const parsed = H3SafeEvidenceBundleSchema.parse(input);
  return Object.freeze({
    ...parsed,
    events: Object.freeze(parsed.events.map((event) => Object.freeze(event))),
  });
}

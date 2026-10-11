import { createHash } from "node:crypto";
import {
  AiPromptTreeV1Schema,
  canonicalAiPromptTreeV1,
  type AiPromptTreeV1,
  type AiPromptTreePublicationV1,
} from "@product/contracts";
import { z } from "zod";

export const PromptTreeTargetSchema = z.union([
  z.uuid(),
  z.literal("template"),
]);
const Revision = z.number().int().nonnegative().safe();
export const PromptTreeSaveSchema = z
  .object({
    expectedDraftRevision: Revision,
    body: AiPromptTreeV1Schema,
    reason: z.string().trim().min(3).max(256),
  })
  .strict();
export const PromptTreePublishSchema = z
  .object({
    expectedDraftRevision: Revision,
    expectedPublishedVersion: Revision,
    reason: z.string().trim().min(3).max(256),
  })
  .strict();
export const PromptTreeRollbackSchema = PromptTreePublishSchema.extend({
  sourceVersion: z.number().int().positive().safe(),
});
export type PromptTreeActor = {
  actorId: string;
  correlationId: string;
  reason: string;
};
export const PromptTreeStateSchema = z
  .object({
    target: PromptTreeTargetSchema,
    draftRevision: z.number().int().positive().safe(),
    draft: AiPromptTreeV1Schema,
    templateRevision: Revision.nullable(),
    publishedVersion: Revision,
    history: z
      .array(
        z
          .object({
            version: z.number().int().positive().safe(),
            sha256: z.string().regex(/^[0-9a-f]{64}$/),
            author: z.uuid(),
            publishedAt: z.string().datetime({ offset: true }),
            sourceVersion: z.number().int().positive().nullable(),
          })
          .strict(),
      )
      .max(256),
  })
  .strict();
export type PromptTreeState = z.infer<typeof PromptTreeStateSchema>;
export interface PromptTreeRepository {
  get(target: string): Promise<PromptTreeState | null>;
  save(
    target: string,
    input: z.infer<typeof PromptTreeSaveSchema> & PromptTreeActor,
  ): Promise<PromptTreeState>;
  publish(
    target: string,
    input: z.infer<typeof PromptTreePublishSchema> &
      PromptTreeActor & { sourceVersion?: number },
  ): Promise<PromptTreeState>;
}
export function promptTreeDigest(body: unknown): string {
  return createHash("sha256")
    .update(canonicalAiPromptTreeV1(body))
    .digest("hex");
}
export function publishablePromptTree(body: unknown): AiPromptTreeV1 {
  const parsed = AiPromptTreeV1Schema.parse(body);
  if (!parsed.root || !parsed.nodes.some((node) => node.text.trim()))
    throw new Error("AI_TREE_INVALID_EMPTY");
  return parsed;
}
export type { AiPromptTreePublicationV1 };

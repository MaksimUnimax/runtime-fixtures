import { z } from "zod";

const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/);
export const AiPromptTreeV1Schema = z
  .object({
    format: z.literal("octoport_prompt_tree_v1"),
    root: Id.nullable(),
    nodes: z
      .array(
        z
          .object({
            id: Id,
            text: z.string().max(8192),
            children: z.array(Id).max(64),
          })
          .strict(),
      )
      .max(128),
  })
  .strict()
  .superRefine((tree, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (new TextEncoder().encode(JSON.stringify(tree)).byteLength > 65536)
      fail("tree exceeds 64 KiB");
    const byId = new Map(tree.nodes.map((node) => [node.id, node]));
    if (byId.size !== tree.nodes.length) fail("duplicate node ID");
    if (tree.root === null) {
      if (tree.nodes.length) fail("empty root requires empty nodes");
      return;
    }
    if (!byId.has(tree.root)) {
      fail("root does not exist");
      return;
    }
    const visited = new Set<string>();
    const visit = (id: string) => {
      if (visited.has(id)) {
        fail("cycle or multiple parents");
        return;
      }
      visited.add(id);
      const node = byId.get(id);
      if (!node) {
        fail("child does not exist");
        return;
      }
      for (const child of node.children) visit(child);
    };
    visit(tree.root);
    if (visited.size !== byId.size) fail("unreachable nodes");
  });
export type AiPromptTreeV1 = z.infer<typeof AiPromptTreeV1Schema>;
export const EmptyAiPromptTreeV1: AiPromptTreeV1 = Object.freeze({
  format: "octoport_prompt_tree_v1",
  root: null,
  nodes: [],
});

// This is data, never JavaScript, a DOM profile, an API operation catalog or a grant.
export function canonicalAiPromptTreeV1(value: unknown): string {
  const tree = AiPromptTreeV1Schema.parse(value);
  return JSON.stringify({
    format: tree.format,
    root: tree.root,
    nodes: [...tree.nodes]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((node) => ({
        id: node.id,
        text: node.text,
        children: [...node.children],
      })),
  });
}
export const AiPromptTreePublicationV1Schema = z
  .object({
    aiId: z.uuid(),
    version: z.number().int().positive().safe(),
    format: z.literal("octoport_prompt_tree_v1"),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    body: AiPromptTreeV1Schema,
    publishedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type AiPromptTreePublicationV1 = z.infer<
  typeof AiPromptTreePublicationV1Schema
>;

export const AiPromptTreeKnownV1Schema = z
  .object({
    aiId: z.uuid(),
    version: z.number().int().positive().safe(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const AiPromptTreeClaimV1Schema = z
  .object({
    claimVersion: z.literal("ai_prompt_tree_claim_v1"),
    accountId: z.uuid(),
    deviceId: z.uuid(),
    sessionId: z.uuid(),
    requestNonce: z.uuid(),
    detected: z
      .object({ family: Id, surface: Id, variant: Id.nullable() })
      .strict(),
    aiId: z.uuid(),
    issuedAt: z.string().datetime({ offset: true }),
    publication: AiPromptTreePublicationV1Schema.omit({ aiId: true })
      .extend({ body: AiPromptTreeV1Schema.nullable() })
      .nullable(),
  })
  .strict();
export type AiPromptTreeClaimV1 = z.infer<typeof AiPromptTreeClaimV1Schema>;
export const SignedAiPromptTreeEnvelopeV1Schema = z
  .object({
    treeEnvelopeVersion: z.literal("ai_prompt_tree_envelope_v1"),
    algorithm: z.literal("Ed25519"),
    keyId: Id,
    payload: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(131072),
    signature: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(256),
  })
  .strict();
export type SignedAiPromptTreeEnvelopeV1 = z.infer<
  typeof SignedAiPromptTreeEnvelopeV1Schema
>;

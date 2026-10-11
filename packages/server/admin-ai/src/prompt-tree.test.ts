import { describe, expect, it } from "vitest";
import {
  AiPromptTreeV1Schema,
  canonicalAiPromptTreeV1,
} from "@product/contracts";
import {
  promptTreeDigest,
  publishablePromptTree,
  PromptTreePublishSchema,
} from "./prompt-tree.js";

const tree = () => ({
  format: "octoport_prompt_tree_v1" as const,
  root: "start",
  nodes: [
    {
      id: "start",
      text: "Read the selected store context.",
      children: ["next"],
    },
    {
      id: "next",
      text: "Ask for an explicit choice.",
      children: [] as string[],
    },
  ],
});
describe("AI-TREE data contract (SOURCE subset; no installed acceptance)", () => {
  it("accepts an independent value and canonicalizes node storage order", () => {
    const a = tree(),
      b = tree();
    b.nodes.reverse();
    expect(promptTreeDigest(a)).toBe(promptTreeDigest(b));
    b.nodes[0]!.text = "New draft";
    expect(promptTreeDigest(a)).not.toBe(promptTreeDigest(b));
    expect(a.nodes[1]!.text).toBe("Ask for an explicit choice.");
  });
  it("preserves semantic child order and text byte identity", () => {
    const a = tree();
    a.nodes.push({ id: "third", text: "Another choice", children: [] });
    a.nodes[0]!.children.push("third");
    const b = structuredClone(a);
    b.nodes[0]!.children.reverse();
    expect(promptTreeDigest(a)).not.toBe(promptTreeDigest(b));
    expect(canonicalAiPromptTreeV1(a)).toContain("Another choice");
  });
  it("rejects cycles, multiple parents, duplicate, missing and unreachable nodes", () => {
    const values = [tree(), tree(), tree(), tree(), tree()];
    values[0]!.nodes[1]!.children.push("start");
    values[1]!.nodes[0]!.children.push("next");
    values[2]!.nodes.push({ ...values[2]!.nodes[1]! });
    values[3]!.nodes[0]!.children.push("missing");
    values[4]!.nodes.push({ id: "orphan", text: "", children: [] });
    for (const value of values)
      expect(AiPromptTreeV1Schema.safeParse(value).success).toBe(false);
  });
  it("allows an explicitly empty draft but never publishes it", () => {
    const empty = { format: "octoport_prompt_tree_v1", root: null, nodes: [] };
    expect(AiPromptTreeV1Schema.safeParse(empty).success).toBe(true);
    expect(() => publishablePromptTree(empty)).toThrow("AI_TREE_INVALID_EMPTY");
    const spaces = tree();
    spaces.nodes.forEach((n) => {
      n.text = "   ";
    });
    expect(() => publishablePromptTree(spaces)).toThrow(
      "AI_TREE_INVALID_EMPTY",
    );
  });
  it("rejects executable/DOM/grant fields, unknown formats and overlong data", () => {
    for (const key of [
      "script",
      "selector",
      "workAllowed",
      "operations",
      "profile",
    ]) {
      expect(
        AiPromptTreeV1Schema.safeParse({ ...tree(), [key]: true }).success,
      ).toBe(false);
    }
    expect(
      AiPromptTreeV1Schema.safeParse({
        ...tree(),
        format: "adapter_profile_v1",
      }).success,
    ).toBe(false);
    const large = tree();
    large.nodes[0]!.text = "x".repeat(8193);
    expect(AiPromptTreeV1Schema.safeParse(large).success).toBe(false);
  });
  it("requires both current draft and publication revisions for publication", () => {
    expect(
      PromptTreePublishSchema.safeParse({
        expectedDraftRevision: 1,
        reason: "publish",
      }).success,
    ).toBe(false);
    expect(
      PromptTreePublishSchema.safeParse({
        expectedDraftRevision: 1,
        expectedPublishedVersion: 0,
        reason: "publish",
      }).success,
    ).toBe(true);
    expect(
      PromptTreePublishSchema.safeParse({
        expectedDraftRevision: 1.5,
        expectedPublishedVersion: 0,
        reason: "publish",
      }).success,
    ).toBe(false);
  });
});

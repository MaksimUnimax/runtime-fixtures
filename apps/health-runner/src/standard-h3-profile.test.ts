import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHATGPT_STANDARD_H3_PROFILE,
  chatGPTConversationIdentity,
  resolveChatGPTConversationIdentity,
} from "./standard-h3-profile.js";

const source = (name: string) =>
  readFileSync(resolve(process.cwd(), "src", name), "utf8");

describe("packaged ChatGPT Standard H3 profile", () => {
  it("has no fixture-only selector authority in production code", () => {
    for (const name of ["standard-h3-profile.ts", "standard-h3-strategy.ts"]) {
      const contents = source(name);
      expect(contents).not.toMatch(/hf-/);
      expect(contents).not.toMatch(/data-hf-/);
      expect(contents).not.toContain("fixture-editor");
      expect(contents).not.toContain("fixture-send");
      expect(contents).not.toMatch(/NODE_ENV|localhost|127\.0\.0\.1/);
    }
  });

  it("keeps the shipped Standard semantic authority immutable and bounded", () => {
    expect(Object.isFrozen(CHATGPT_STANDARD_H3_PROFILE)).toBe(true);
    expect(Object.isFrozen(CHATGPT_STANDARD_H3_PROFILE.selectors)).toBe(true);
    expect(
      Object.isFrozen(CHATGPT_STANDARD_H3_PROFILE.selectors.messageId),
    ).toBe(true);
    expect(CHATGPT_STANDARD_H3_PROFILE.selectors.surfaceRoot).toBe("body");
    expect(CHATGPT_STANDARD_H3_PROFILE.selectors.promptInput.primary).toBe(
      "#prompt-textarea",
    );
    expect(CHATGPT_STANDARD_H3_PROFILE.selectors.sendControl.primary).toContain(
      'data-testid="send-button"',
    );
    expect(CHATGPT_STANDARD_H3_PROFILE.selectors.stopControl.primary).toBe(
      'button[data-testid="stop-button"]',
    );
    expect(CHATGPT_STANDARD_H3_PROFILE.selectors.busySignal).toBe(
      '[aria-busy="true"]',
    );
    expect(CHATGPT_STANDARD_H3_PROFILE.selectors.assistantMessage).toContain(
      'data-turn="assistant"',
    );
    expect(CHATGPT_STANDARD_H3_PROFILE.selectors.messageId.fallbacks).toEqual([
      "[data-message-author-role][data-message-id]",
      "[data-message-id]",
    ]);
  });

  it("accepts only bounded ChatGPT conversation route identity", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(
      chatGPTConversationIdentity(`https://chatgpt.com/c/${id}`, null),
    ).toBe(id);
    expect(
      chatGPTConversationIdentity(
        `https://chatgpt.com/c/${id}`,
        `https://chatgpt.com/c/00000000-0000-4000-8000-000000000002`,
      ),
    ).toBeNull();
    expect(
      chatGPTConversationIdentity("https://chatgpt.com/", null),
    ).toBeNull();
  });

  it("models fresh and bound identity states without accepting conflicts", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(
      resolveChatGPTConversationIdentity("https://chatgpt.com/", null),
    ).toEqual({ kind: "UNBOUND_FRESH" });
    expect(
      resolveChatGPTConversationIdentity(
        `https://chatgpt.com/c/${id}`,
        `https://chatgpt.com/c/${id}`,
      ),
    ).toEqual({ kind: "BOUND", id });
    expect(
      resolveChatGPTConversationIdentity(
        `https://chatgpt.com/c/${id}`,
        "https://chatgpt.com/c/00000000-0000-4000-8000-000000000002",
      ),
    ).toEqual({ kind: "CONFLICT" });
  });
});

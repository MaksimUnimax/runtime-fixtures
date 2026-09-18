import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHATGPT_WORK_H3_PROFILE,
  parseWorkRoute,
  resolveWorkRoute,
} from "./work-h3-profile.js";

const source = (name: string) =>
  readFileSync(resolve(process.cwd(), "src", name), "utf8");

describe("packaged ChatGPT Work H3 profile", () => {
  it("is immutable, Russian-locale-bound, and has no fixture authority", () => {
    expect(Object.isFrozen(CHATGPT_WORK_H3_PROFILE)).toBe(true);
    expect(Object.isFrozen(CHATGPT_WORK_H3_PROFILE.selectors)).toBe(true);
    expect(CHATGPT_WORK_H3_PROFILE.approvedOrigin).toBe("https://chatgpt.com");
    expect(CHATGPT_WORK_H3_PROFILE.locale).toBe("ru-RU");
    expect(CHATGPT_WORK_H3_PROFILE.workMarker).toBe("Работа");
    expect(CHATGPT_WORK_H3_PROFILE).not.toHaveProperty("headerSelector");
    expect(CHATGPT_WORK_H3_PROFILE.selectors.nativeCopy).toBe(
      'button[aria-label="Копировать"], button[aria-label="Copy"]',
    );
    for (const name of ["work-h3-profile.ts", "work-h3-strategy.ts"]) {
      const contents = source(name);
      expect(contents).not.toMatch(/hf-/);
      expect(contents).not.toMatch(/data-hf-/);
      expect(contents).not.toMatch(/localhost|127\.0\.0\.1/);
      expect(contents).not.toMatch(/fixture-editor|fixture-send/);
      expect(contents).not.toMatch(/headerSelector\s*:/);
    }
  });

  it("parses only the sanitized project-conversation route shape", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(
      parseWorkRoute(`https://chatgpt.com/g/g-p-test-project/c/${id}`),
    ).toEqual({ projectRouteKey: "test-project", conversationId: id });
    expect(parseWorkRoute(`https://chatgpt.com/c/${id}`)).toBeNull();
    expect(
      parseWorkRoute("https://chatgpt.com/g/g-p-test-project/c/not-id"),
    ).toBeNull();
  });

  it("treats route as supporting ownership and rejects canonical drift", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const changed = "00000000-0000-4000-8000-000000000002";
    expect(
      resolveWorkRoute(
        `https://chatgpt.com/g/g-p-test-project/c/${id}`,
        `https://chatgpt.com/g/g-p-test-project/c/${id}`,
      ),
    ).toEqual({
      kind: "BOUND",
      identity: { projectRouteKey: "test-project", conversationId: id },
    });
    expect(
      resolveWorkRoute(
        `https://chatgpt.com/g/g-p-test-project/c/${id}`,
        `https://chatgpt.com/g/g-p-other/c/${id}`,
      ),
    ).toEqual({ kind: "CONFLICT" });
    expect(
      resolveWorkRoute(
        `https://chatgpt.com/g/g-p-test-project/c/${id}`,
        `https://chatgpt.com/g/g-p-test-project/c/${changed}`,
      ),
    ).toEqual({ kind: "CONFLICT" });
  });
});

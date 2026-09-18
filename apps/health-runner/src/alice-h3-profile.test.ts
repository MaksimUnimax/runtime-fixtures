import { describe, expect, test } from "vitest";
import { ALICE_H3_PROFILE } from "./alice-h3-profile.js";

describe("Alice H3 source-owned profile", () => {
  test("is immutable and explicitly Alice-specific", () => {
    expect(Object.isFrozen(ALICE_H3_PROFILE)).toBe(true);
    expect(Object.isFrozen(ALICE_H3_PROFILE.selectors)).toBe(true);
    expect(ALICE_H3_PROFILE.surface).toBe("ALICE");
    expect(ALICE_H3_PROFILE.profileId).toBe("ALICE_H3_V1");
    expect(ALICE_H3_PROFILE.profileRevision).toBe(1);
    expect(ALICE_H3_PROFILE.approvedOrigin).toBe("https://alice.yandex.ru");
  });

  test("does not use generic success selectors", () => {
    const selectors = JSON.stringify(ALICE_H3_PROFILE.selectors);
    expect(selectors).toContain("inputbase-textarea");
    expect(selectors).toContain("oknyx");
    expect(selectors).toContain("data-message-role");
    expect(selectors).toContain("CodeBlock");
    expect(selectors).toContain("codeblock-action-copy");
    expect(ALICE_H3_PROFILE.selectors.composerInput.primary).not.toBe(
      "textarea",
    );
    expect(ALICE_H3_PROFILE.selectors.sendControl).not.toBe("button");
    expect(ALICE_H3_PROFILE.selectors.codeBlock).not.toBe("pre");
  });

  test("records Alice control state selectors separately", () => {
    expect(ALICE_H3_PROFILE.selectors.sendControl).toContain(
      'aria-label="Отправить"',
    );
    expect(ALICE_H3_PROFILE.selectors.stopControl).toContain(
      'aria-label="Алиса, стоп"',
    );
    expect(ALICE_H3_PROFILE.selectors.readyControl).toContain(
      'aria-label="Алиса, начни слушать"',
    );
  });
});

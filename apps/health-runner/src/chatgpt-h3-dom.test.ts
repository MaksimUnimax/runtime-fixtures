import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import {
  chatGPTAssistantMessages,
  chatGPTElementInsideAssistantContext,
  chatGPTOwnedNativeCopyObservation,
} from "./chatgpt-h3-dom.js";

const TOKEN = "BRIDGE_HEALTHCHECK_V1";

describe("A117-compatible ChatGPT H3 DOM ownership", () => {
  it("canonicalizes current and inferred assistant roots in document order", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`
        <article id="inferred">
          <div data-assistant-markdown><pre><code>FIRST</code></pre></div>
          <div role="group" aria-label="Response actions"></div>
        </article>
        <article id="outer">
          <li id="explicit" data-message-role="assistant"><pre><code>SECOND</code></pre></li>
          <div role="group" aria-label="Response actions"></div>
        </article>
        <li id="last" data-turn="assistant"><pre><code>THIRD</code></pre></li>
      `);
      const messages = chatGPTAssistantMessages(page.locator("body"));
      expect(
        await messages.evaluateAll((elements) =>
          elements.map((element) => element.id),
        ),
      ).toEqual(["inferred", "explicit", "last"]);

      await page.setContent(`
        <article id="ambiguous">
          <div data-assistant-markdown><code>BAD</code></div>
          <div role="group" aria-label="Response actions"></div>
          <div role="group" aria-label="Response actions"></div>
        </article>
        <li id="user" data-message-role="user">
          <div data-assistant-markdown><code>BAD</code></div>
          <div role="group" aria-label="Response actions"></div>
        </li>
      `);
      expect(await chatGPTAssistantMessages(page.locator("body")).count()).toBe(
        0,
      );
    } finally {
      await browser.close();
    }
  });

  it("rejects response-level Copy and keeps the one code-owned Copy", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`
        <li data-message-role="assistant" id="response-only">
          <div><code>${TOKEN}</code></div>
          <div data-message-actions role="group" aria-label="Response actions">
            <button data-code-copy-state="idle" aria-label="Copy">Copy</button>
          </div>
        </li>
      `);
      let message = page.locator("#response-only");
      expect(await chatGPTOwnedNativeCopyObservation(message, TOKEN)).toEqual({
        present: false,
        actionable: false,
      });

      await page.setContent(`
        <li data-message-role="assistant" id="both">
          <div id="code-root">
            <code>${TOKEN}</code>
            <button data-code-copy-state="idle" aria-label="Copy code">Copy code</button>
          </div>
          <div data-assistant-message-actions role="group" aria-label="Response actions">
            <button aria-label="Copy">Copy</button>
          </div>
        </li>
      `);
      message = page.locator("#both");
      expect(await chatGPTOwnedNativeCopyObservation(message, TOKEN)).toEqual({
        present: true,
        actionable: true,
      });

      await page.setContent(`
        <li data-message-role="assistant" id="localized">
          <div id="code-root">
            <code>${TOKEN}</code>
            <button aria-label="Копировать код">Копировать код</button>
          </div>
          <div role="group" aria-label="Действия с ответом">
            <button aria-label="Копировать">Копировать</button>
          </div>
        </li>
      `);
      expect(
        await chatGPTOwnedNativeCopyObservation(
          page.locator("#localized"),
          TOKEN,
        ),
      ).toEqual({ present: true, actionable: true });
    } finally {
      await browser.close();
    }
  });

  it("keeps composer ownership out of assistant and user contamination", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`
        <li data-message-role="assistant"><div id="inside" contenteditable="true"></div></li>
        <form><div id="composer" contenteditable="true"></div></form>
        <li data-message-role="user">
          <div data-assistant-markdown><div id="user-editor" contenteditable="true"></div></div>
          <div role="group" aria-label="Response actions"></div>
        </li>
      `);
      expect(
        await chatGPTElementInsideAssistantContext(page.locator("#inside")),
      ).toBe(true);
      expect(
        await chatGPTElementInsideAssistantContext(page.locator("#composer")),
      ).toBe(false);
      expect(
        await chatGPTElementInsideAssistantContext(
          page.locator("#user-editor"),
        ),
      ).toBe(false);
    } finally {
      await browser.close();
    }
  });
});

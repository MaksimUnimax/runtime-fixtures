import type { Locator } from "playwright";

export const CHATGPT_ASSISTANT_DIRECT_SELECTOR =
  '[data-turn="assistant"], [data-message-author-role="assistant"], [data-message-role="assistant"]';
export const CHATGPT_USER_DIRECT_SELECTOR =
  '[data-turn="user"], [data-message-author-role="user"], [data-message-role="user"]';
export const CHATGPT_ASSISTANT_CONTENT_SELECTOR =
  "[data-assistant-markdown], [data-assistant-stream-block], [data-message-content-controls], [data-assistant-content-started]";
export const CHATGPT_RESPONSE_ACTION_SELECTOR =
  '[data-assistant-message-actions], [data-message-actions][aria-label="Response actions"], [data-message-actions][aria-label="Действия с ответом"], [role="group"][aria-label="Response actions"], [role="group"][aria-label="Действия с ответом"]';

const CHATGPT_ASSISTANT_XPATH = `.//*[(
  (@data-turn="assistant" or @data-message-author-role="assistant" or @data-message-role="assistant")
  and not(ancestor::*[@data-turn="assistant" or @data-message-author-role="assistant" or @data-message-role="assistant"])
  and not(ancestor::*[@data-turn="user" or @data-message-author-role="user" or @data-message-role="user"])
) or (
  (self::article or self::li or self::section or starts-with(@data-testid, "conversation-turn"))
  and not(@data-turn="user" or @data-message-author-role="user" or @data-message-role="user")
  and count(.//*[@data-assistant-markdown or @data-assistant-stream-block or @data-message-content-controls or @data-assistant-content-started]) >= 1
  and count(.//*[@data-assistant-message-actions or (@data-message-actions and (@aria-label="Response actions" or @aria-label="Действия с ответом")) or (@role="group" and (@aria-label="Response actions" or @aria-label="Действия с ответом"))]) = 1
  and not(.//*[@data-turn="user" or @data-message-author-role="user" or @data-message-role="user"])
  and not(.//*[@data-turn="assistant" or @data-message-author-role="assistant" or @data-message-role="assistant"])
  and not(ancestor::*[@data-turn="user" or @data-message-author-role="user" or @data-message-role="user"])
)]`;

export const CHATGPT_ASSISTANT_MESSAGE_SELECTOR = `xpath=${CHATGPT_ASSISTANT_XPATH}`;

export const CHATGPT_CODE_SURFACE_SELECTOR = [
  "[data-writing-block-fullscreen-editor-region]",
  ".cm-content",
  "#code-block-viewer",
  "pre > code",
  "pre",
  "code",
].join(", ");

const CHATGPT_CODE_COPY_SELECTOR =
  'button[data-code-copy-state], button[aria-label="Копировать"], button[aria-label="Copy"], button[aria-label="Copy code"], button[aria-label="Копировать код"], button[title="Copy code"], button[title="Копировать код"], button[title="Copy"], button[title="Копировать"]';

export type ChatGPTNativeCopyObservation = Readonly<{
  present: boolean;
  actionable: boolean;
}>;

export function chatGPTAssistantMessages(root: Locator): Locator {
  return root.locator(CHATGPT_ASSISTANT_MESSAGE_SELECTOR);
}

export function chatGPTCodeSurfaces(message: Locator): Locator {
  return message.locator(CHATGPT_CODE_SURFACE_SELECTOR);
}

export async function chatGPTElementInsideAssistantContext(
  node: Locator,
): Promise<boolean> {
  return node.evaluate(
    (element, selectors) => {
      if (element.closest(selectors.direct)) return true;
      const content = element.closest(selectors.content);
      if (!(content instanceof Element)) return false;
      let root: Element | null = content;
      while (
        root &&
        root !== document.body &&
        root !== document.documentElement
      ) {
        if (root.matches(selectors.user)) return false;
        const structural = root.matches(
          'article, li, section, [data-testid^="conversation-turn"]',
        );
        if (
          structural &&
          root.querySelectorAll(selectors.actions).length === 1 &&
          !root.querySelector(selectors.user)
        ) {
          return true;
        }
        root = root.parentElement;
      }
      return false;
    },
    {
      direct: CHATGPT_ASSISTANT_DIRECT_SELECTOR,
      content: CHATGPT_ASSISTANT_CONTENT_SELECTOR,
      actions: CHATGPT_RESPONSE_ACTION_SELECTOR,
      user: CHATGPT_USER_DIRECT_SELECTOR,
    },
  );
}

export async function chatGPTOwnedNativeCopyObservation(
  message: Locator,
  expectedToken: string,
): Promise<ChatGPTNativeCopyObservation> {
  return message.evaluate(
    (messageRoot, input) => {
      const copyText = new Set([
        "copy",
        "copy code",
        "копировать",
        "копировать код",
      ]);
      const text = (node: Element) =>
        String(
          node instanceof HTMLElement
            ? node.innerText || node.textContent || ""
            : node.textContent || "",
        );
      const isCopy = (button: HTMLButtonElement) => {
        if (button.closest(input.responseActions)) return false;
        if (button.matches(input.copySelector)) return true;
        return copyText.has(
          text(button).replace(/\s+/g, " ").trim().toLowerCase(),
        );
      };
      const canonicalSurfaces = (root: Element) => {
        const raw = [...root.querySelectorAll(input.codeSurfaces)];
        return raw.filter(
          (surface) =>
            !raw.some((other) => other !== surface && other.contains(surface)),
        );
      };
      const targets = canonicalSurfaces(messageRoot).filter((surface) =>
        text(surface).includes(input.expectedToken),
      );
      if (targets.length !== 1) return { present: false, actionable: false };
      const target = targets[0]!;
      for (const candidate of messageRoot.querySelectorAll("button")) {
        if (!(candidate instanceof HTMLButtonElement) || !isCopy(candidate))
          continue;
        let node: Element | null = candidate.parentElement;
        while (node && node !== messageRoot) {
          const copies = [...node.querySelectorAll("button")].filter(
            (button): button is HTMLButtonElement =>
              button instanceof HTMLButtonElement && isCopy(button),
          );
          const surfaces = canonicalSurfaces(node);
          if (
            copies.length === 1 &&
            surfaces.length === 1 &&
            surfaces[0] === target
          ) {
            const style = getComputedStyle(candidate);
            const visible =
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              candidate.getClientRects().length > 0;
            return {
              present: true,
              actionable:
                visible &&
                !candidate.disabled &&
                candidate.getAttribute("aria-disabled") !== "true",
            };
          }
          node = node.parentElement;
        }
      }
      return { present: false, actionable: false };
    },
    {
      responseActions: CHATGPT_RESPONSE_ACTION_SELECTOR,
      copySelector: CHATGPT_CODE_COPY_SELECTOR,
      codeSurfaces: CHATGPT_CODE_SURFACE_SELECTOR,
      expectedToken,
    },
  );
}

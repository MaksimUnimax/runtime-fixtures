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
      const acceptedCopyText = [
        "copy",
        "copy code",
        "копировать",
        "копировать код",
      ];
      const buttons = messageRoot.querySelectorAll("button");
      for (
        let buttonIndex = 0;
        buttonIndex < buttons.length;
        buttonIndex += 1
      ) {
        const candidate = buttons.item(buttonIndex);
        if (!(candidate instanceof HTMLButtonElement)) continue;
        if (candidate.closest(input.responseActions)) continue;
        const candidateText = String(
          candidate.innerText || candidate.textContent || "",
        )
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        if (
          !candidate.matches(input.copySelector) &&
          !acceptedCopyText.includes(candidateText)
        )
          continue;

        let node: Element | null = candidate.parentElement;
        while (node && node !== messageRoot) {
          const nodeButtons = node.querySelectorAll("button");
          let copyCount = 0;
          for (let index = 0; index < nodeButtons.length; index += 1) {
            const button = nodeButtons.item(index);
            if (!(button instanceof HTMLButtonElement)) continue;
            if (button.closest(input.responseActions)) continue;
            const buttonText = String(
              button.innerText || button.textContent || "",
            )
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();
            if (
              button.matches(input.copySelector) ||
              acceptedCopyText.includes(buttonText)
            )
              copyCount += 1;
          }

          const rawSurfaces = node.querySelectorAll(input.codeSurfaces);
          let canonicalCount = 0;
          let canonicalSurface: Element | null = null;
          for (
            let surfaceIndex = 0;
            surfaceIndex < rawSurfaces.length;
            surfaceIndex += 1
          ) {
            const surface = rawSurfaces.item(surfaceIndex);
            let nested = false;
            for (
              let otherIndex = 0;
              otherIndex < rawSurfaces.length;
              otherIndex += 1
            ) {
              const other = rawSurfaces.item(otherIndex);
              if (other !== surface && other.contains(surface)) {
                nested = true;
                break;
              }
            }
            if (!nested) {
              canonicalCount += 1;
              canonicalSurface = surface;
            }
          }

          const surfaceText = canonicalSurface
            ? String(
                canonicalSurface instanceof HTMLElement
                  ? canonicalSurface.innerText ||
                      canonicalSurface.textContent ||
                      ""
                  : canonicalSurface.textContent || "",
              )
            : "";
          if (
            copyCount === 1 &&
            canonicalCount === 1 &&
            surfaceText.includes(input.expectedToken)
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

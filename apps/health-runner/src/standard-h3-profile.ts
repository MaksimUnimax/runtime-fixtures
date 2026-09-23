import type { Locator, Page } from "playwright";

/**
 * Versioned, code-owned knowledge of the ChatGPT Standard surface.
 * Provider-specific semantics come from the accepted imported ChatGPT adapter.
 * The document root is only a bounded traversal root, not a provider marker.
 * These definitions are not runtime configurable.
 */
export const CHATGPT_STANDARD_H3_PROFILE = Object.freeze({
  surface: "CHATGPT_STANDARD" as const,
  profileId: "CHATGPT_STANDARD_H3_V2",
  profileRevision: 2,
  hostnames: Object.freeze(["chatgpt.com", "chat.openai.com"]),
  selectors: Object.freeze({
    // The provider adapter establishes the surface from the approved host and
    // conversation route. `body` is only the bounded DOM traversal root; it is
    // not treated as a provider-specific success marker.
    surfaceRoot: "body",
    promptInput: Object.freeze({
      id: "prompt-textarea",
      testId: "prompt-textarea",
      primary: "#prompt-textarea",
      fallbacks: Object.freeze([
        '[data-testid="prompt-textarea"]',
        'textarea[id*="prompt" i]',
        'textarea[data-testid*="prompt" i]',
        '[contenteditable="true"][id*="prompt" i]',
        '[contenteditable="true"][data-testid*="prompt" i]',
      ]),
    }),
    sendControl: Object.freeze({
      testId: "send-button",
      primary:
        'button#composer-submit-button[data-testid="send-button"], button[data-testid="send-button"]',
    }),
    stopControl: Object.freeze({
      testId: "stop-button",
      primary: 'button[data-testid="stop-button"]',
    }),
    busySignal: '[aria-busy="true"]',
    assistantMessage:
      'section[data-turn="assistant"], [data-message-author-role="assistant"]',
    userMessage: 'section[data-turn="user"], [data-message-author-role="user"]',
    messageId: Object.freeze({
      primary: "data-turn-id",
      directFallback: "data-message-id",
      fallbacks: Object.freeze([
        "[data-message-author-role][data-message-id]",
        "[data-message-id]",
      ]),
    }),
    codeSurface: Object.freeze([
      "[data-writing-block-fullscreen-editor-region]",
      ".cm-content",
      "#code-block-viewer",
      "pre > code",
      "pre",
    ]),
    nativeCopy: 'button[aria-label="Copy"], button[aria-label="Копировать"]',
  }),
});

export type ChatGPTStandardH3Profile = typeof CHATGPT_STANDARD_H3_PROFILE;

const PROMPT_INPUT_SELECTOR = [
  CHATGPT_STANDARD_H3_PROFILE.selectors.promptInput.primary,
  ...CHATGPT_STANDARD_H3_PROFILE.selectors.promptInput.fallbacks,
].join(", ");
const ASSISTANT_EDITOR_ANCESTOR =
  'ancestor::*[self::section[@data-turn="assistant"] or @data-message-author-role="assistant"]';

export function standardSurfaceRoot(page: Page): Locator {
  return page.locator(CHATGPT_STANDARD_H3_PROFILE.selectors.surfaceRoot);
}

export function standardPromptInputs(root: Locator): Locator {
  return root.locator(PROMPT_INPUT_SELECTOR);
}

export function standardComposerRoots(root: Locator): Locator {
  return root.locator(`form:has(${PROMPT_INPUT_SELECTOR})`);
}

export function standardInputIsInsideAssistantEditor(
  input: Locator,
): Promise<boolean> {
  return input
    .locator(`xpath=${ASSISTANT_EDITOR_ANCESTOR}`)
    .count()
    .then((count) => count > 0);
}

export function standardAssistantMessages(root: Locator): Locator {
  return root.locator(CHATGPT_STANDARD_H3_PROFILE.selectors.assistantMessage);
}

export async function standardMessageId(
  message: Locator,
): Promise<string | null> {
  const direct = await message.getAttribute(
    CHATGPT_STANDARD_H3_PROFILE.selectors.messageId.primary,
  );
  if (direct) return direct;
  const directFallback = await message.getAttribute(
    CHATGPT_STANDARD_H3_PROFILE.selectors.messageId.directFallback,
  );
  if (directFallback) return directFallback;
  for (const selector of CHATGPT_STANDARD_H3_PROFILE.selectors.messageId
    .fallbacks) {
    const value = await message
      .locator(selector)
      .first()
      .getAttribute("data-message-id");
    if (value) return value;
  }
  return null;
}

export function standardSendControls(composer: Locator): Locator {
  return composer.locator(
    CHATGPT_STANDARD_H3_PROFILE.selectors.sendControl.primary,
  );
}

export function standardStopControls(root: Locator): Locator {
  return root.locator(
    CHATGPT_STANDARD_H3_PROFILE.selectors.stopControl.primary,
  );
}

export function standardBusySignals(root: Locator): Locator {
  return root.locator(CHATGPT_STANDARD_H3_PROFILE.selectors.busySignal);
}

export function standardCodeSurfaces(message: Locator): Locator {
  return message.locator(
    CHATGPT_STANDARD_H3_PROFILE.selectors.codeSurface.join(", "),
  );
}

export function standardCopyControls(message: Locator): Locator {
  return message.locator(CHATGPT_STANDARD_H3_PROFILE.selectors.nativeCopy);
}

const CHATGPT_CONVERSATION_PATH =
  /(?:^|\/)c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

export function chatGPTConversationIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(CHATGPT_CONVERSATION_PATH);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export function chatGPTConversationIdFromCanonical(
  origin: string,
  canonicalHref: string,
): string | null {
  try {
    const canonical = new URL(canonicalHref, origin);
    if (canonical.origin !== new URL(origin).origin) return null;
    return chatGPTConversationIdFromUrl(canonical.toString());
  } catch {
    return null;
  }
}

export function chatGPTConversationIdentity(
  pageUrl: string,
  canonicalHref: string | null,
): string | null {
  const resolution = resolveChatGPTConversationIdentity(pageUrl, canonicalHref);
  return resolution.kind === "BOUND" ? resolution.id : null;
}

export type ChatGPTConversationIdentityResolution =
  | Readonly<{ kind: "BOUND"; id: string }>
  | Readonly<{ kind: "UNBOUND_FRESH" }>
  | Readonly<{ kind: "CONFLICT" }>;

/**
 * Same-origin route/canonical identity semantics adapted from the imported
 * ChatGPT conversation authority. A root/new-chat page is a valid unbound
 * state; it is not treated as an identity failure before Send.
 */
export function resolveChatGPTConversationIdentity(
  pageUrl: string,
  canonicalHref: string | null,
): ChatGPTConversationIdentityResolution {
  try {
    const page = new URL(pageUrl);
    const fromUrl = chatGPTConversationIdFromUrl(page.toString());
    const fromCanonical = canonicalHref
      ? chatGPTConversationIdFromCanonical(page.origin, canonicalHref)
      : null;
    if (fromUrl && fromCanonical && fromUrl !== fromCanonical)
      return { kind: "CONFLICT" };
    const id = fromUrl ?? fromCanonical;
    return id ? { kind: "BOUND", id } : { kind: "UNBOUND_FRESH" };
  } catch {
    return { kind: "UNBOUND_FRESH" };
  }
}

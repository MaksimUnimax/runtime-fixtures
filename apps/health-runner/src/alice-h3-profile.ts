import type { Locator, Page } from "playwright";

/**
 * Alice H3 authority extracted from the accepted imported Alice adapter and
 * WB migration reference. This profile intentionally contains no generic
 * textarea/button/pre/code success selectors.
 */
export const ALICE_H3_PROFILE = Object.freeze({
  surface: "ALICE" as const,
  profileId: "ALICE_H3_V1",
  profileRevision: 1 as const,
  approvedOrigin: "https://alice.yandex.ru",
  conversationPath:
    /^\/chat\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i,
  freshConversationPath: /^\/chat\/?$/i,
  selectors: Object.freeze({
    surfaceRoot: "body",
    activeConversation:
      'button[data-testid="chatlist-item-active"][aria-current="page"]',
    conversationItemClass: "ChatListItem",
    composerInput: Object.freeze({
      primary: '[data-testid="inputbase-textarea"]',
      fallback: '[data-highlight-id="alice-input"] textarea',
    }),
    composerRoots: Object.freeze([
      '[data-testid="standalone-input"]',
      '[data-testid="standalone-input-field"]',
      '[data-highlight-id="alice-input"]',
    ]),
    inputControlsRoot: '[data-testid="input-controls-root"]',
    sendControl: 'button[data-testid="oknyx"][aria-label="Отправить"]',
    oknyxControl: 'button[data-testid="oknyx"]',
    stopControl: 'button[data-testid="oknyx"][aria-label="Алиса, стоп"]',
    readyControl:
      'button[data-testid="oknyx"][aria-label="Алиса, начни слушать"]',
    assistantMessage: '[data-message-role="alice"]',
    userMessage: '[data-message-role="user"]',
    codeBlock: ".CodeBlock",
    codeContent: "pre.CodeBlock-ContentPre > code, pre > code",
    nativeCopy: '[data-testid="codeblock-action-copy"]',
  }),
});

export type AliceH3Profile = typeof ALICE_H3_PROFILE;

export type AliceConversationIdentityResolution =
  | Readonly<{ kind: "BOUND"; id: string }>
  | Readonly<{ kind: "UNBOUND_FRESH" }>
  | Readonly<{ kind: "UNCONFIRMED" }>
  | Readonly<{ kind: "CONFLICT" }>;

export function aliceSurfaceRoot(page: Page): Locator {
  return page.locator(ALICE_H3_PROFILE.selectors.surfaceRoot);
}

export function aliceInputCandidates(root: Locator): Locator {
  return root.locator(
    `${ALICE_H3_PROFILE.selectors.composerInput.primary}, ${ALICE_H3_PROFILE.selectors.composerInput.fallback}`,
  );
}

export function aliceComposerRoots(root: Locator): Locator {
  return root.locator(ALICE_H3_PROFILE.selectors.composerRoots.join(", "));
}

export function aliceAssistantMessages(root: Locator): Locator {
  return root.locator(ALICE_H3_PROFILE.selectors.assistantMessage);
}

export function aliceUserMessages(root: Locator): Locator {
  return root.locator(ALICE_H3_PROFILE.selectors.userMessage);
}

export function aliceOknyxControls(root: Locator): Locator {
  return root.locator(ALICE_H3_PROFILE.selectors.oknyxControl);
}

export function aliceStopControls(root: Locator): Locator {
  return root.locator(ALICE_H3_PROFILE.selectors.stopControl);
}

export function aliceCodeBlocks(message: Locator): Locator {
  return message.locator(ALICE_H3_PROFILE.selectors.codeBlock);
}

export function aliceCodeContents(block: Locator): Locator {
  return block.locator(ALICE_H3_PROFILE.selectors.codeContent);
}

export function aliceCopyControls(block: Locator): Locator {
  return block.locator(ALICE_H3_PROFILE.selectors.nativeCopy);
}

export async function aliceMessageId(message: Locator): Promise<string | null> {
  const directId = await message.getAttribute("id");
  if (directId) return directId;
  return message.getAttribute("data-message-id");
}

function normalized(value: string | null | undefined): string | null {
  const candidate = String(value ?? "")
    .trim()
    .toLowerCase();
  return candidate || null;
}

function pathConversationId(pathname: string): string | null {
  return (
    pathname.match(ALICE_H3_PROFILE.conversationPath)?.[1]?.toLowerCase() ??
    null
  );
}

/**
 * Mirrors BB2ConversationIdentity.resolveWithEvidence for Alice. Alice's
 * canonical support is false in the WB authority; the active history item is
 * required corroboration for a path-bound conversation.
 */
export async function resolveAliceConversationIdentity(
  page: Page,
  expectedOrigin: string = ALICE_H3_PROFILE.approvedOrigin,
): Promise<AliceConversationIdentityResolution> {
  let parsed: URL;
  try {
    parsed = new URL(page.url());
  } catch {
    return { kind: "UNBOUND_FRESH" };
  }
  if (parsed.origin !== expectedOrigin) {
    return { kind: "CONFLICT" };
  }
  const pathId = pathConversationId(parsed.pathname);
  if (!pathId) return { kind: "UNBOUND_FRESH" };

  const active = page.locator(ALICE_H3_PROFILE.selectors.activeConversation);
  if ((await active.count()) !== 1) return { kind: "UNCONFIRMED" };
  const activeItem = active.locator(
    `xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " ${ALICE_H3_PROFILE.selectors.conversationItemClass} ")][@id][1]`,
  );
  if ((await activeItem.count()) !== 1) return { kind: "UNCONFIRMED" };
  const activeId = normalized(await activeItem.getAttribute("id"));
  if (!activeId) return { kind: "UNCONFIRMED" };
  return activeId === pathId
    ? { kind: "BOUND", id: pathId }
    : { kind: "CONFLICT" };
}

export function aliceConversationIdFromPath(pathname: string): string | null {
  return pathConversationId(pathname);
}

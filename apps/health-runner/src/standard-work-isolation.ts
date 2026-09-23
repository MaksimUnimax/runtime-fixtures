import type { Page } from "playwright";

/**
 * Minimal accepted Standard/Work isolation primitive.
 *
 * This deliberately does not expose a Work profile or executable strategy.
 * It only detects the positively identified Work marker so Standard fails
 * closed on a shared ChatGPT document.
 */
export async function hasPositiveWorkSurfaceMarker(
  page: Page,
): Promise<boolean> {
  const candidates = page.locator(
    'xpath=//*[normalize-space(text())="Работа"]',
  );
  const excludedAncestor =
    "ancestor-or-self::*[" +
    'self::section[@data-turn="assistant"] or ' +
    'self::section[@data-turn="user"] or ' +
    '@data-message-author-role="assistant" or ' +
    '@data-message-author-role="user" or ' +
    '@contenteditable="true" or ' +
    "self::textarea or self::input or self::pre or " +
    "@data-writing-block-fullscreen-editor-region or " +
    'contains(concat(" ", normalize-space(@class), " "), " cm-content ") or ' +
    '@id="code-block-viewer" or ' +
    '(self::form and .//*[@id="prompt-textarea"])' +
    "]";
  const count = await candidates.count();
  let eligibleVisible = 0;
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    if ((await candidate.locator(`xpath=${excludedAncestor}`).count()) > 0)
      continue;
    if (!(await candidate.isVisible({ timeout: 250 }).catch(() => false)))
      continue;
    eligibleVisible += 1;
  }
  return eligibleVisible === 1;
}

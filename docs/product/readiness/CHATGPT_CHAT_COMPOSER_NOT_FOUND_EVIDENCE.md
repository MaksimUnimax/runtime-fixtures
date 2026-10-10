# ChatGPT Chat/Standard `COMPOSER_NOT_FOUND` — evidence

This document records observations about the repeated ChatGPT Chat/Standard “Начать работу” failure. The owner reports that the defect is still not fixed. These observations do not establish a root cause, code change, or test result.

Do not add the personal screenshot or any personal details to the repository. The DOM samples are from ChatGPT pages, not the Octoport popup. Their presence alone does not explain `COMPOSER_NOT_FOUND`.

## Current owner snapshot

The fresh owner-provided JSON snapshot was generated at `2026-10-09T04:22:14.438Z`:

- Extension `0.2.14 PREPRODUCTION`; Chrome `152.0.0.0` was observed runtime metadata only. Extension and browser were `SUPPORTED`, minimum extension `0.2.13`.
- Octoport fields: `authenticated=true`, `workAllowed=true`, `lastErrorCode=null`, `aiStatus=null`. These fields do not prove ChatGPT login. The owner separately confirms ChatGPT is authenticated and reports a personal Chat homepage with an empty “Спросить ChatGPT” editor.
- Page fields: `aiFamily=chatgpt`, `identityStatus=unknown`, `runtimeStatus=ready`, `lastErrorCode=null`, `transportClass=null`.
- Work fields: `state=null`, `pending=false`, `pendingOutcome=null`, `lastStart.stage=send`, `lastStart.code=COMPOSER_NOT_FOUND`, `lastStart.outcome=failed`.
- Stores: total `1`, Ozon `1`, WB `0`.

The current failure is specifically reported for authenticated ChatGPT Chat/Standard. It must not be attributed to Work without separate evidence.

## Chat/Standard capture

Captured `2026-10-08T06:05:39Z` on an authenticated Chat page in `IDLE_EMPTY_COMPOSER`. Start was not pressed. The composer was empty; Send was not observed. The captured Chat buttons were “Добавить файлы и другое”, “Выбрать модель ChatGPT”, “Диктовать”, and “Начать голосовой разговор”; each had `disabled=false` and `data-testid=null`.

Composer excerpt as supplied:

```html
<div contenteditable="true" aria-multiline="true" dir="auto" role="textbox" spellcheck="true" tabindex="0" translate="no" class="ProseMirror ProseMirror-focused" data-composer-markdown="" aria-label="Спросить ChatGPT" data-virtualkeyboard="true"><p data-empty-paragraph="true" data-placeholder="Спросить ChatGPT" class="placeholder"><br class="ProseMirror-trailingBreak"></p></div>
```

The “Начать голосовой разговор” control is ChatGPT’s voice-mode button, not Octoport’s “Начать работу” action:

```html
<button type="button" class="cursor-interaction size-token-button-composer flex items-center justify-center rounded-full transition-opacity focus-visible:outline-2 bg-composer-primary p-0.5 focus-visible:outline-background-composer-primary relative after:absolute after:inset-0 after:-start-1" aria-label="Начать голосовой разговор" data-state="closed"><svg aria-hidden="true" class="Icon-X4VkKC icon-primary-action text-composer-primary" focusable="false" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg"><use href="/cdn/assets/icons-fac34c1b33b86f8f.svg#voice-regular-20" fill="currentColor"></use></svg></button>
```

## ChatGPT Work capture

Captured `2026-10-08T05:57:58Z` in an authenticated existing conversation while `GENERATING`. Stop was visible; Send was not observed during generation. The captured Work buttons were “Добавить файлы и другое”, “Выбрать модель ChatGPT”, “Диктовать”, and “Остановить”. This is a separate Work observation; it does not establish that Work has the Chat/Standard `COMPOSER_NOT_FOUND` failure.

Composer excerpt as supplied:

```html
<div contenteditable="true" aria-multiline="true" dir="auto" role="textbox" spellcheck="true" tabindex="0" translate="no" class="ProseMirror" data-composer-markdown="" aria-label="Работайте с ChatGPT" data-virtualkeyboard="true"><p data-empty-paragraph="true" data-placeholder="Работайте с ChatGPT" class="placeholder"><br class="ProseMirror-trailingBreak"></p></div>
```

Stop-button excerpt as supplied:

```html
<button type="button" class="cursor-interaction size-token-button-composer flex items-center justify-center rounded-full transition-opacity focus-visible:outline-2 bg-composer-primary p-0.5 focus-visible:outline-background-composer-primary" aria-label="Остановить"><svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="icon-primary-action text-composer-primary"><path d="M4.5 5.75C4.5 5.05964 5.05964 4.5 5.75 4.5H14.25C14.9404 4.5 15.5 5.05964 15.5 5.75V14.25C15.5 14.9404 14.9404 15.5 14.25 15.5H5.75C5.05964 15.5 4.5 14.9404 4.5 14.25V5.75Z"></path></svg></button>
```

Both observed composer elements were reported as `DIV`, ProseMirror, `contenteditable`, `role=textbox`, with no `id`. The accessible labels were “Спросить ChatGPT” for Chat and “Работайте с ChatGPT” for Work. Do not infer a complete selector or invent missing DOM from these excerpts.

## Follow-up boundary

Internal source record for the original task and saved Chat/Work DOM (server path, not a download link): `/root/octoport-control/operator/feedback/OWNER-0213-KEYS-IMPORT-IN-EXTENSION-20261008T052743Z.json`.

Historical handoff recorded at `2026-10-08 09:07 MSK`; confirmation that a tester applied the DOM and a Chatfix SHA have not been found. No prior patch is presumed to exist. Before any future code edit, inspect the referenced task and actual diffs, commits, and installed `0.2.14` contents to determine whether a fix existed, what it changed, and why it did not help; then establish cause from code and the available HTML. Alice `send_acknowledged` or `context mismatch` results are unrelated to this Chat defect.

The owner excluded tests for this fix, especially testing in server Chromium without ChatGPT login. Do not test this fix. If a future change is made, describe it as “изменение без проверки в авторизованной среде”, not PASS or “исправлено тестами”. If these samples do not suffice, ask the owner/dot for exact additional HTML or diagnostics. Required repository gates must not be claimed as passed or bypassed; record any unverified boundary explicitly.

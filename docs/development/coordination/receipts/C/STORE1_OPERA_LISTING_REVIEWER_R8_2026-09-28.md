# STORE-1 Opera listing + reviewer metadata R8 — 2026-09-28

Status: **PREPARED / EXACT 0.2.5 / NOT SUBMITTED**

This replaces the stale 2026-09-24 listing draft for current submission work.
It does not authorize deployment, reviewer login, catalog mutation or Submit.

## Exact package and public metadata

- product: Octoport;
- package version: `0.2.5`;
- source: `68f1621376be4d7aeeff44bc76cc326f8cc64954`;
- Chromium/Opera ZIP SHA-256:
  `33cbf1ad9ec4669abe3a65e24cfbaead4c7c3a1fa711261b2d186d107c33aea1`;
- support email: `support@octoport.ru`;
- privacy: `https://octoport.ru/privacy`;
- support: `https://octoport.ru/support`;
- install/help: `https://octoport.ru/install`.

All three public pages return HTTP 200 in the current read-only check.

Category candidate: **Productivity**. Verify the exact dashboard vocabulary before
Submit.

License/EULA: **PUBLISHER/LEGAL DECISION REQUIRED**. Opera's current publishing
guidance requires a distribution-license choice and states that, if no separate
EULA is supplied, its Terms apply the CC BY-NC-ND 4.0 default. The repository
has no declared root license or owner-approved EULA, so C records the rule but
does not make that legal choice for the publisher.

## Listing text

### Name

Octoport

### Short summary — RU

Octoport помогает продавцу получать read-only данные и отчёты Ozon и
Wildberries прямо в выбранном ИИ-диалоге.

### Description — RU

Octoport — браузерное расширение для продавцов Ozon и Wildberries. После
обычного входа в Octoport пользователь подключает свой магазин локально в
расширении, выбирает маркетплейс и магазин для конкретного ИИ-диалога и
запрашивает поддерживаемые read-only данные или отчёты. Выбранный результат по
действию пользователя может быть доставлен в поддерживаемый ИИ-диалог.

Текущая ранняя бета не редактирует цены, карточки товаров, рекламные ставки или
другие данные магазина. Octoport не является собственной языковой моделью.
Marketplace credentials не передаются на AI-страницу и не хранятся Octoport как
долговременный серверный архив. Сырые бизнес-отчёты и архив AI-разговоров также
не заявляются как серверное хранилище продукта.

Политика конфиденциальности: https://octoport.ru/privacy
Поддержка: https://octoport.ru/support
Установка и помощь: https://octoport.ru/install

### Availability statement

Early beta / limited availability.

Do not claim Safari support before its deferred post-release work. Do not infer
Chrome, Yandex or Firefox store acceptance from Opera acceptance.

## Permission explanation

`storage`
: local account/store selection and bounded extension state.

`unlimitedStorage`
: bounded local report/file and recovery state where browser quota would
  otherwise truncate legitimate user-requested output.

`alarms`
: local expiry, maintenance and scheduled bounded work.

`tabs`
: bind work to the exact active supported AI tab/dialogue and prevent
  cross-dialogue delivery.

Host permissions are restricted to the supported AI surfaces, Ozon/Wildberries
read/report API origins and Octoport API/portal origins needed for ordinary
authentication and signed bootstrap. They are not permission to mutate
marketplace business data.

Exact package checks found no remote executable `<script src="http...">` or
remote `importScripts("http...")`; the popup loads packaged local JavaScript.

## Submission assets

Signed-out exact-package Opera screenshot:
- 612×408 PNG;
- non-interlaced;
- SHA-256
  `6e8bfa3d29cf21d3451a075a6aa98266b59efb082760e6ab3f4f0bb5ef49065e`;
- real Opera 136;
- exact 0.2.5 package;
- external requests 0;
- page errors 0.

Exact package icons:
- 16×16 PNG;
- 48×48 PNG;
- 128×128 PNG.

A second in-action screenshot remains intentionally open until the normal live
reviewer flow is proved. Do not fabricate it from fixture-provider output or
owner credentials.

## Reviewer flow after deployment

1. Deploy exact accepted backend `62024d192a8572c11aafab91653330d1f996699f`
   under the separately authorized owner-test/preprod runbook.
2. Sign in with the dedicated reviewer identity using the normal portal/device
   flow.
3. Run the existing exact-0.2.5 read-only STORE1 preflight.
4. If a catalog mutation is planned, perform it only under its separate
   authorized CAS/readback boundary and rerun preflight.
5. Install/use the exact 0.2.5 Opera candidate through the legitimate reviewer
   route.
6. Configure only dedicated reviewer/test marketplace access through the normal
   product path.
7. Open one supported ChatGPT dialogue, bind one marketplace/store, Start, run
   one declared read-only scenario, verify exactly one result and no replay,
   then Finish.
8. Capture only sanitized reviewer evidence; no OTP, token, cookie, auth header,
   raw seller payload or owner session.

## Current blockers before first Submit

- bounded owner-test/preprod deployment is not yet authorized/executed;
- ordinary reviewer portal/device authentication is not yet proved;
- exact 0.2.5 live read-only preflight/catalog state is not yet proved;
- any required catalog activation remains a separate live mutation;
- exact 0.2.5 Opera reviewer useful-flow and in-action screenshot remain open;
- publisher dashboard mandatory fields, including any required license choice,
  have not yet been confirmed in the actual account;
- actual Submit has not occurred.

C04 authenticated Health H3 is independent and is not a STORE-1 blocker.

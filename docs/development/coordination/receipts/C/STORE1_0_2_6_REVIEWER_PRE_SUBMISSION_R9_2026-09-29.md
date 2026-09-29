# STORE-1 Opera reviewer / pre-submission R9 — exact 0.2.6

Status: **PREPARED / EXACT 0.2.6 / TECHNICAL OWNER-TEST + REAL INSTALLED PROVIDER CHECKS PASS / HUMAN REVIEWER + LIVE AI FLOW + DASHBOARD OPEN / NOT SUBMITTED**

Date: 2026-09-28.
This supersedes the 0.2.5 R8 packet for current STORE-1 package/listing readiness only. Historical 0.2.5 screenshots/receipts remain historical and are not reused as 0.2.6 evidence.

## Exact package authority

- source: `028d5dd56341719e2061a47b5e82e216256619f7`;
- tree: `99e12233864a592510032e30bb96668b41682204`;
- version: `0.2.6`;
- contract: `control_plane_v2`;
- frozen Chromium/Opera ZIP:
  `OCTOPORT_v0.2.6_CHROMIUM_STORE.zip`;
- ZIP SHA-256:
  `579dc15aaf692fc9e96ad650e660ac0190bb7e136c949b7ad401e5bc82a909b5`;
- frozen Firefox ZIP SHA-256:
  `b5de9b4f0773c08a705fbad050e77d382f265aa34fd2ca8d3657553bad577305`.

Read-only server check on 2026-09-28T23:11Z confirmed the frozen artifacts are still present with exactly those hashes.

## Current owner-test technical path

Owner-test backend remains exact
`62024d192a8572c11aafab91653330d1f996699f`.
Its bounded forward-recovery receipt records API live/ready=200, portal/login=200,
worker ready and canonical migration prefix 40 after the previously authorized
deployment recovery.

The frozen 0.2.6 package has subsequently passed the normal protected technical path:
- ordinary portal/session authority via the normal OTP/session API;
- normal device approval; auth state was not injected;
- signed Bootstrap HTTP 200, config v2;
- extension/browser compatibility SUPPORTED;
- detected identity `chatgpt/web/null`;
- exact profile `chatgpt-web-opera-v1` rev1;
- `authenticated=true`, `workAllowed=true`;
- beta remains CLOSED.

The owner-test catalog correction used ordinary admin APIs only. Direct SQL writes=0.
The exact frozen STORE bytes were unchanged.

This is technical owner-test evidence. It is **not** human reviewer identity/login evidence.

## Real installed read-only provider checks

Using the exact frozen 0.2.6 package and supported protected backup preview/import
path, the technical Opera profile was pre-seeded without LevelDB editing, raw secret
tool arguments or provider calls during import.

The actual installed popup credential-check controls then produced:
- Ozon Seller: `ACCESS_CONFIRMED`, HTTP 200;
- Ozon Performance: `ACCESS_CONFIRMED`, HTTP 200;
- Wildberries: `ACCESS_CONFIRMED`, HTTP 200;
- exactly one observed request to each corresponding provider host;
- business mutations=0;
- raw responses saved=false;
- credential values saved=false.

This closes the exact installed credential-check success row. It does not establish
Start -> AI delivery / useful-flow acceptance.

## Submission assets — exact 0.2.6

### Signed-out Opera screenshot

C generated a new version-bound screenshot instead of reusing the historical 0.2.5 PNG.

- path:
  `/root/octoport-control/logs/C/store026-pre-submission-r9/opera-signedout-026.png`;
- dimensions: 612x408;
- SHA-256:
  `b34b45702b91e023de3735685e848c881136e6eb94ce0faf3a4dd7ee8177194c`;
- bytes: 32,876;
- real Opera: 136.0.6008.22;
- manifest version: 0.2.6;
- external HTTP(S) requests while capturing: 0;
- page errors: 0;
- auth action executed: false;
- provider call executed: false;
- resource supervisor:
  `octoport-test-c-7797d054efc24dc2abf9fc626c8f4e63.service`,
  exit0, peak706MiB, cleanup verified.

### Exact package icons

- `icons/octoport-16.png`: SHA-256
  `1779d6780875fcdf9b152d65cfafbedf0f542af201e3968efc219d23ffc3794e`;
- `icons/octoport-48.png`: SHA-256
  `6cb988f80bd62cbbb9faab68717a36d6f7db55cf1f2e0ba150c4e14f69dc1643`;
- `icons/octoport-128.png`: SHA-256
  `c82e9037dd1c596d5402f6dfb251660ef16655296f19bcd79c8f93a2daa1d5d5`.

### Public pages

Read-only HTTP check on 2026-09-28T23:11Z:
- `https://octoport.ru/privacy` -> 200;
- `https://octoport.ru/support` -> 200;
- `https://octoport.ru/install` -> 200.

Support contact remains `support@octoport.ru`.

## Listing text

Name: **Octoport**

Short summary — RU:

Octoport помогает продавцу получать read-only данные и отчёты Ozon и
Wildberries прямо в выбранном ИИ-диалоге.

Description — RU:

Octoport — браузерное расширение для продавцов Ozon и Wildberries. После
обычного входа в Octoport пользователь подключает свой магазин локально в
расширении, выбирает маркетплейс и магазин для конкретного ИИ-диалога и
запрашивает поддерживаемые read-only данные или отчёты. Выбранный результат по
действию пользователя может быть доставлен в поддерживаемый ИИ-диалог.

Текущая ранняя бета не редактирует цены, карточки товаров, рекламные ставки или
другие данные магазина. Octoport не является собственной языковой моделью.
Marketplace credentials не передаются на AI-страницу и не заявляются как
долговременный серверный архив. Сырые бизнес-отчёты и архив AI-разговоров также
не заявляются как серверное хранилище продукта.

Политика конфиденциальности: https://octoport.ru/privacy
Поддержка: https://octoport.ru/support
Установка и помощь: https://octoport.ru/install

Availability: **Early beta / limited availability**.

Do not claim Safari support. Do not infer Chrome/Yandex/Firefox store acceptance
from Opera evidence.

## Permission explanation

`storage`: local account/store selection and bounded extension state.

`unlimitedStorage`: bounded local report/file and recovery state where browser
quota would otherwise truncate legitimate user-requested output.

`alarms`: local expiry, maintenance and scheduled bounded work.

`tabs`: bind work to the exact active supported AI tab/dialogue and prevent
cross-dialogue delivery.

Host permissions are restricted to supported AI surfaces, Ozon/WB read/report
origins and Octoport API/portal origins required for ordinary auth/signed
bootstrap. They are not permission to mutate marketplace business data.

C01/package validation found no remotely hosted executable code.

## Honest reviewer flow

Already prepared/proved technically:
1. exact backend620 owner-test runtime healthy;
2. exact 0.2.6 catalog/profile/assignment ready;
3. normal technical device auth and signed bootstrap resolve;
4. exact installed local control matrix passes;
5. exact installed Seller/Performance/WB read-only credential checks pass.

Still required for a genuine store-reviewer flow:
1. use a **separate legitimate reviewer/human identity**, not the owner technical
   automation identity;
2. reviewer completes the normal portal/email/device flow themselves;
3. install/use the exact 0.2.6 Opera candidate through the legitimate store/reviewer route;
4. use a legitimate supported AI session and run one bounded declared read-only
   Ozon or WB useful flow: Start -> one provider result -> one dialogue delivery ->
   no replay -> explicit Finish;
5. capture one sanitized in-action screenshot bound to the exact package;
6. verify actual Opera dashboard mandatory fields, category/distribution and the
   required publisher/license choice;
7. Upload/Submit under the already-authorized early-publication policy.

No owner credential, OTP, cookie, marketplace token or raw seller payload belongs
in reviewer evidence.

## Remaining blockers before first Submit

- legitimate human/store reviewer identity and normal email/portal/device UX;
- legitimate AI session for exact installed useful-flow;
- in-action screenshot from that real reviewer/useful-flow;
- actual Opera publisher dashboard field verification, including license choice;
- actual Upload/Submit and moderation state.

The old blockers “owner-test backend not deployed”, “0.2.6 catalog not ready”,
“technical auth not working” and “real installed credential-check buttons not
verified” are now closed and must not be reintroduced.

Authenticated Health H3 and the reviewer live-AI useful flow share the missing
legitimate ChatGPT session boundary, but H3 itself is not independently required
for STORE-1.

## Boundary

No store dashboard write, Upload, Submit, moderation, publication, production
deployment, live 0054 migration, human reviewer login or AI useful-flow is claimed.

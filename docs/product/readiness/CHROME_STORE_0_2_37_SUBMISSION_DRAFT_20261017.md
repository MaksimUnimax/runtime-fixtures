# Chrome Web Store — точная подготовка Octoport 0.2.37 (C06 / STORE-0)

**PREPARING — НЕ ГОТОВО К SUBMIT.** Проверено 17 октября 2026 года. Для Chrome-first теперь проверен отдельный `Chrome-only` подготовщик `main 389cde2…`, tree `3dd1b6e…`. Прежняя `main 39effb4…` — отдельная исторически принятая двухбраузерная SOURCE-база; ниже также сохранены доказательства `e8de`. Это внутренний материал для подготовки карточки и проверки издателя; не подписанный Store ZIP, не подтверждённая установка, не новая release authority и не изменение PR153/текстов сайта.

## Источник и степень доказательства

- Репозиторий `MaksimUnimax/runtime-fixtures`. **Исторический** принятый SOURCE/CI: `main e8de8435828834981755f200ec91ad6e9a17cbf1`, tree `4545cd0f7579c9217bb2fda523c36521b5b43e30` (PR190).
- Пять native push workflows exact SHA и 13/13 jobs: **COMPLETED / SUCCESS**. Server CI `38999328190`, Extension CI `38999328170`, Extension I1-C1 `38999328196`, Documentation `38999328172`, Coordination/Safety `38999328204`.
- Точный GitHub Extension CI artifact `12088142874` — внешний ZIP доказательств и пакета. Внутри: `SELLER_AGENTS_I1_C1_v0.2.37_LOCAL_DEVELOPMENT.zip`, 2 603 866 байт, 41 файл, SHA256 `fbedd0b7b648c835c7328bee4019a97ab046a64fde6007b6b193a86d44db7f89`.
- Внутренний ZIP побайтно совпадает с предыдущим `main 4fb72f89`. Различие `4fb72f89→e8de8435` — только `tests/regression/extension-core/late-start-route-continuity.mjs`; runtime и manifest расширения не менялись.
- 176 общих CI-gates и целостность исходного ZIP подтверждают **SOURCE/PACKAGE**. Они не подтверждают установленный Google Chrome, реальную авторизацию, маркетплейсы, Store signature, публикацию или проверку владельца.

### Первичные ссылки и хеши (исправление независимого P2)

Пять GitHub Actions **push** workflows на точном `e8de8435828834981755f200ec91ad6e9a17cbf1` (состояние `completed/success`) и их **13/13** завершённых `success` jobs были проверены исполнителем C по API; это внешние результаты, которые сторонний SOURCE-reviewer не должен подменять собственным тестом:

| Workflow | Прямая GitHub Actions ссылка | Завершённые jobs |
|---|---|---:|
| Server CI | [38999328190](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/38999328190) | 2/2 |
| Extension CI | [38999328170](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/38999328170) | 6/6 |
| Extension I1-C1 client | [38999328196](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/38999328196) | 3/3 |
| Documentation CI | [38999328172](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/38999328172) | 1/1 |
| Coordination/Safety | [38999328204](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/38999328204) | 1/1 |

| Источник ZIP | GitHub artifact | GitHub outer ZIP SHA256 | Внутренний development ZIP |
|---|---|---|---|
| `main e8de8435` | [12088142874](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/38999328170/artifacts/12088142874) | `f64f587c13bd5b69fb9c841fd635be86117f4b5569d98873fd010e57f8fc24ff` | 2 603 866 байт, 41 файл, SHA256 `fbedd0b7b648c835c7328bee4019a97ab046a64fde6007b6b193a86d44db7f89` |
| `main 4fb72f89` | [12084617260](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/38989381029/artifacts/12084617260) | `7c821c72f6ec24f02b0579d91c3a34bd0be0f1f234a6838199089ab53917de48` | Побайтно тот же ZIP SHA256 `fbedd0b7b648c835c7328bee4019a97ab046a64fde6007b6b193a86d44db7f89` |

Внешние ZIP различаются, поскольку содержат run-specific логи и доказательства; *одинаковы только вложенные development ZIP*. GitHub артефакты имеют ограниченный срок доступности (e8de до 31.10.2026, 03:36:58 UTC; 4fb до 31.10.2026, 01:08:11 UTC). Точное исходное API-свидетельство исполнителя C и 13 идентификаторов jobs сохранены вне Git: `/root/octoport-control/logs/C/C06_STORE0_E8DE_NATIVE5_ARTIFACT_PROVENANCE_20261017.json`, SHA256 `e6256bb9e4138af1caddfc084282408ea0d93d92559884251fc964e614adeb3b`. Это **не** самостоятельный независимый повтор CI, не Store/installed/live PASS и не основание использовать development ZIP вместо PREPRODUCTION-пакета.

## Исторически принятая защищённая двухбраузерная SOURCE-база (17.10.2026)

- **Исторический двухбраузерный checkout сборщика:** `39effb4bac621f54921545549d276592c3f22e21`, дерево `d11caedb7d811180a57524359386567df9842b33`. Здесь приняты [PR197](https://github.com/MaksimUnimax/runtime-fixtures/pull/197) (чтение release authority) и [PR198](https://github.com/MaksimUnimax/runtime-fixtures/pull/198) (чтение candidate manifest). Фиксация проверенной immutable SOURCE-базы не выдаёт полномочия для подписи, публикации или production.
- Для exact `main 39effb4…` после слияния PR198: **5/5 GitHub CI workflows и 13/13 реальных jobs SUCCESS** с первой попытки: [Server](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/39013380184), [Extension](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/39013380197), [I1-C1](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/39013380227), [Documentation](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/39013380175), [Coordination/Safety](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/39013380193). Независимое review PR198: `PASS_SOURCE_SCOPED` (0 P0/P1/P2), без претензии на установленную или магазинную приёмку.
- [GitHub Extension artifact `12093394062`](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/39013380197/artifacts/12093394062): внешний ZIP 3 117 596 байт, SHA256 `b427a15bedde03acdcfa0a97dd089d728b95d8729d2dba211c6111f4bb77d1c8`. Внутри — только development ZIP версии `0.2.37`, 41 файл, 2 603 866 байт, SHA256 `fbedd0b7b648c835c7328bee4019a97ab046a64fde6007b6b193a86d44db7f89`. CRC и 176/176 core gates PASS; одинаковые байты не подтверждают подпись, Store и ручную установку.
- `tooling/b1/release-lib.mjs` при проверке authority сверяет `authority.source.head/tree` с фактическими HEAD/tree **запущенного checkout сборщика**. Для этого исторического двухбраузерного `39effb4…` требуется отдельная реальная принятая PREPRODUCTION authority с точными `39effb4bac621f54921545549d276592c3f22e21` / `d11caedb7d811180a57524359386567df9842b33`. Историческая authority `e8de8435/tree4545` не подходит для нового защищённого checkout. Выбор другого checkout требует его собственной подлинной authority.
- Позднейший `main 68f8fb5040667b6ba25b1cc91f69f2fdfae759f9` содержит изменения B05 PR194/195. B1 и runtime расширения по проверенным blob SHA не изменились, однако полный HEAD другой. **Не подменять** замороженный исходник новым HEAD автоматически ради документационного или серверного обновления.
- **Историческая двухбраузерная зависимость:** подлинная принятая `octoport_release_authority_v1` для `39effb4/tree d11caed` отсутствует; для Chrome-only требуется другая точная authority (ниже). Для обоих путей реальные канонические HTTPS origins, публичный Ed25519 trust bundle, целевой каталог/reviewer normal login, точный Store ZIP и установленная приёмка оригинального Chrome popup остаются `UNKNOWN/NOT ACCEPTED`. Синтетические test keys I1 не подходят. B/Ops в разрешённой read-only области сообщает только первичный источник или честное `UNKNOWN`.

## Актуальный Chrome-only подготовщик — проверенная SOURCE-опция для ранней подачи (17.10.2026)

- **Новый точный GitHub SOURCE:** `main 389cde2046cc68b663830c9ea399f03d3e3cdf2b`, tree `3dd1b6efcaaed75da21b13cf3a615cdd562033d8`, [PR201](https://github.com/MaksimUnimax/runtime-fixtures/pull/201). Это **технически принятый Chrome-only режим**, а не одобренный издателем, подписанный или установленный выпуск. Исторический двухбраузерный `main39/tree d11caed` не перепривязан автоматически.
- Независимое review кандидата `a8b2def0b2ec14b4900d25e9909066771655fe0a`: `PASS_SOURCE_SCOPED`, 0 P0/P1/P2 после двух исправленных P2 — запрета лишних ZIP внутри Chrome-only candidate и запрета использования его в Opera transition. Полные B1 source-тесты 145/145 PASS, Opera consumer 13/13 PASS на проверенном предшественнике с той же логикой. Для merge `main389` **5/5 native postmerge CI и 13/13 реальных jobs SUCCESS** с первой попытки: [Server](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/39027127063), [Extension](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/39027127155), [I1-C1](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/39027127056), [Documentation](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/39027127092), [Coordination/Safety](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/39027127042).
- **Подготовка только Chrome** при наличии *подлинных* безопасных входных данных: `node tooling/b1/prepare-release-candidate.mjs --authority <accepted-real-authority.json> --out <new-candidate-dir> --chromium <real-preproduction-chrome.zip> --channel chrome`. Проверка тех же байтов: `node tooling/b1/release-preflight.mjs <candidate-dir> --authority <accepted-real-authority.json> --channel chrome`. В выходном manifest `B1_RC_MANIFEST.json` находятся только `packages.chromium` и `releaseScope: CHROME_ONLY`; успешная проверка также выдаёт `releaseScope: CHROME_ONLY`. Прежний вызов без `--channel chrome` продолжает требовать **оба** Chromium и Firefox ZIP и не принимает однобраузерную квитанцию.
- B1 `sourceIdentity()` сверяет `authority.source.head` и `authority.source.tree` с **фактическим checkout запущенного сборщика**. Если используется Chrome-only сборщик `main389`, требуется настоящая принятая PREPRODUCTION `octoport_release_authority_v1` с `source.head=389cde2046cc68b663830c9ea399f03d3e3cdf2b`, `source.tree=3dd1b6efcaaed75da21b13cf3a615cdd562033d8`, `productVersion=0.2.37`, `contractVersion=control_plane_v2`, `migrationLevel=61`, **двумя разными реальными HTTPS origins** и доверенным внешне принятым публичным Ed25519 trust bundle. Старую `main39` authority использовать нельзя. Пока всё это **UNKNOWN / NOT ACCEPTED**.
- [Extension core artifact точного `main389`](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/39027127155/artifacts/12098937980): внешний CI ZIP SHA256 `29aacfd71106a1d51246008f7296efbd738ff3ec0fe10932120f8241e873475c`; внутри **побайтно та же LOCAL DEVELOPMENT 0.2.37 сборка**, 41 файл, SHA256 `fbedd0b7b648c835c7328bee4019a97ab046a64fde6007b6b193a86d44db7f89`. Этот developer ZIP содержит два loopback разрешения и слово Development; защищённая подготовка PREPRODUCTION его отвергает. **Не переименовывать и не подписывать его как Store ZIP.** Нужен отдельный настоящий релизный архив с подтверждённым runtime, identity, endpoints и permission/consent scope.
- **Открыты без изменений:** принятый B/Ops target catalog и ordinary reviewer login, реальная установка точного Store ZIP в Google Chrome, штатные `authenticated/workAllowed`, Start → read-only Ozon/WB result ровно один раз → Finish в **оригинальном popup** у Тестера R3, privacy/permission disclosures и решение владельца о текстах [PR153](https://github.com/MaksimUnimax/runtime-fixtures/pull/153). Наличие SOURCE-кода режима не заменяет этих Store-gates.

## Статические факты точного development manifest

| Поле | Проверенное значение |
|---|---|
| `manifest_version` | `3` |
| `name` | `Seller Agents Development — Ozon + WB`, не согласованное Store-имя |
| `description` | Содержит «Development-сборка» |
| `version` | `0.2.37` |
| `action.default_popup` | `popup.html`, оригинальный popup под значком |
| `background.service_worker` | `service_worker_entry.js`; импортируемый runtime также development |
| `permissions` | `storage`, `alarms`, `tabs`, `unlimitedStorage`, `scripting` |
| `host_permissions` | 27 шаблонов, включая два loopback |
| `content_scripts.matches` | ChatGPT (2), Алиса (1), Qwen (1) |

Статическое присутствие адресов ИИ **не означает** проверенный вход, Start/Finish, передачу отчётов, поддержку каждого режима ChatGPT или коммерческую готовность. DeepSeek, Gemini и Anthropic отсутствуют в `content_scripts.matches` этого пакета; их поддержку нельзя обещать. Qwen — отдельная гостевая тестируемая граница, а не автоматически принятая Store-возможность.

### Полный набор 27 host permissions

| Область | Точные шаблоны development ZIP | Кол-во |
|---|---|---:|
| ИИ | `https://chatgpt.com/*`, `https://chat.openai.com/*`, `https://alice.yandex.ru/*`, `https://chat.qwen.ai/*` | 4 |
| Ozon | `https://api-seller.ozon.ru/*`, `https://api-performance.ozon.ru/*`, `https://docs.ozon.ru/*`, `https://ozon.ru/*`, `https://*.ozon.ru/*`, `https://ozone.ru/*`, `https://*.ozone.ru/*` | 7 |
| WB | `https://content-api.wildberries.ru/*`, `https://discounts-prices-api.wildberries.ru/*`, `https://marketplace-api.wildberries.ru/*`, `https://seller-analytics-api.wildberries.ru/*`, `https://statistics-api.wildberries.ru/*`, `https://finance-api.wildberries.ru/*`, `https://documents-api.wildberries.ru/*`, `https://common-api.wildberries.ru/*`, `https://supplies-api.wildberries.ru/*`, `https://advert-api.wildberries.ru/*`, `https://advert-media-api.wildberries.ru/*`, `https://dp-calendar-api.wildberries.ru/*`, `https://feedbacks-api.wildberries.ru/*`, `https://returns-api.wildberries.ru/*` | 14 |
| Loopback DEV | `http://127.0.0.1:43100/*`, `http://127.0.0.1:43101/*` | 2 |
| **Всего** | **4 + 7 + 14 + 2** | **27** |

Это **инвентаризация**, а не обоснование всех permissions. Для Store сверить по коду и сценарию необходимость широких доменов (`*.ozon.ru`, `ozone.ru`) и каждого API WB. Не удалять или добавлять hosts без потребительской проверки. Локальные HTTP/127.0.0.1 относятся к development и не переносятся автоматически в настоящий PREPRODUCTION.

### Пять API permissions: план проверяемого объяснения

| API | Предполагаемая цель по архитектуре | До реальной подачи проверить |
|---|---|---|
| `storage` | Локальные настройки, магазинные ключи, состояния работы | Реальные вызовы, изоляция account/store |
| `alarms` | Ограниченное истечение и восстановление временных состояний | Таймеры и отсутствие скрытого API polling |
| `tabs` | Контекст явно выбранной вкладки/диалога | Вызовы и отсутствие чтения чужих вкладок |
| `unlimitedStorage` | Временный локальный буфер доставки | Фактический максимум, TTL и необходимость разрешения |
| `scripting` | Разрешённые элементы управления в поддерживаемом диалоге | Фактические целевые вкладки и доступный пользователю click-flow |

Цели в таблице предварительные; сам manifest не доказывает законность или необходимость доступа. Нельзя объявлять `tabs`/`scripting` разрешением на произвольные сайты.

## Зафиксированная граница Privacy Practices

Из SPEC, MINIMUM_SPEC и `apps/site/public/privacy.html` следуют различимые факты, которые нужно проверить на **точных Store-байтах**:

1. Ключи Ozon/WB при обычной работе локальны в расширении и не передаются в ИИ. Разрешённый перенос между установками — отдельная ограниченная передача зашифрованного тела, не серверный бизнес-архив.
2. **Выбранный результат/отчёт может передаваться стороннему ИИ в поддерживаемом диалоге по действию пользователя.** Формула «данные вообще никуда не передаются» неверна.
3. Для временного технического результата действует локальный срок использования до одного часа. Сон браузера может отложить физическую очистку, но не разрешает читать просроченный результат.
4. Сервер содержит необходимые учётные, сессионные, магазинные и технические метаданные. Он не является хранилищем сырых бизнес-отчётов/архивов ИИ.
5. `https://octoport.ru/privacy`, `https://octoport.ru/support` и `https://octoport.ru/install` должны быть проверены по **реальному публичному HTTP**, а не только по Git-файлам. Контакт поддержки `support@octoport.ru`; не помещать личные реквизиты/токены владельца в карточку.

В Chrome Web Store dashboard заполнять Privacy Practices, обоснования разрешений и публичные ссылки только на основе подтверждённого пакета. Свойства кабинета/видимость/поля подписи **UNKNOWN**, если нет фактического dashboard readback. Общая регистрация publisher account уже была подтверждена владельцем — повторно не требовать.

Применимые официальные инструкции: [Chrome Web Store troubleshooting and disclosure](https://developer.chrome.com/docs/webstore/troubleshooting/), [publish](https://developer.chrome.com/docs/webstore/publish/), [API/dashboard prerequisites](https://developer.chrome.com/docs/webstore/using-api). Конкретные поля сверять в действующем кабинете, а не выдумывать.

**Актуальная политика Chrome Web Store (с 01.08.2026):** [обновление Google от 01.07.2026](https://developer.chrome.com/blog/cws-policy-updates-2026) отдельно требует раскрывать сбор/передачу данных и их изменения, собирать лишь необходимое для заявленного единого назначения и не обходить защитные ограничения AI-сервисов. Для Octoport это **дополнительный проверяемый выпускной gate**, а не автоматический PASS: реальный установленный пользовательский сценарий должен использовать явный click, поддерживаемую AI-поверхность и штатные ограничения, без скрытого обхода правил ИИ.

## Доказуемый минимальный путь к первой Chrome-подаче

1. **Authority.** Для **новой Chrome-only дорожки** Existing B/Ops в разрешённых read-only границах проверяет существование подлинной принятой `octoport_release_authority_v1` под точные `389cde2046cc68b663830c9ea399f03d3e3cdf2b` / tree `3dd1b6efcaaed75da21b13cf3a615cdd562033d8`; версия `0.2.37`, `control_plane_v2`, migration `61`, `PREPRODUCTION`, два разных канонических HTTPS origins и реальный публичный Ed25519 trust bundle. Для исторического **двухбраузерного** checkout `39effb4/tree d11caed` нужно своё отдельное подтверждение; эти HEAD/tree нельзя смешивать. Пока нет первичного документа — `UNKNOWN`; test keys/loopback и новые подписи не выдумывать.
2. **Store package.** C подготавливает иной ZIP, связанный с принятой authority, правильной identity и конфигурацией; проводит B1 `prepare`/`preflight`, независимое review, проверку точного исходника/составленных байтов. Изменения permissions/имени/доверия не скрывать под повторной выдачей developer ZIP.
3. **Целевой сервер.** B/Ops подтверждает реальный `target_artifact_sha256`, release/catalog/profile compatibility и обычный reviewer device/auth flow. Ни синтетический API, ни source CI не заменяет установленный сервер; live/DB требуют собственных полномочий и восстановления.
4. **Оригинальный Chrome popup.** Назначенный Тестер R3 проверяет **точный установленный ZIP** в Google Chrome: штатный NORMAL_DEVICE_FLOW и `authenticated=true`, `workAllowed`, Start для одной подтверждённой AI-поверхности, явный click на безопасный read-only запрос Ozon/WB, результат в том же диалоге ровно один раз, Finish и no-replay после UNKNOWN. Не использовать отдельные окна, sidebar или новую вкладку вместо исходного popup.
5. **Reviewer.** После такого доказательства C оформляет доступный reviewer account/test store с синтетическими данными и настоящим входом, инструкции, карточку, privacy, скриншоты и ограниченную видимость. Никакого auth bypass, универсального OTP, личных ключей продавца или имитации поведения для Store-review. Использовать уже данное разрешение раннего Submit только при выполнении минимума; факт `SUBMITTED`/`APPROVED`/`PUBLISHED` отмечать по реальному dashboard.

**Импорт через системный выбор файла внутри исходного popup** — отдельная личная B01/R3 проверка Тестера; без её результата не объявлять функцию принятой. PR153 содержит отдельный P1 спор о текстах сайта и требует конкретного решения владельца — не обходить его переименованием этого документа.

## Незакрытые результаты и возврат

| Gate | Фактическое состояние | Ответственный/следующее событие |
|---|---|---|
| Chrome-only authority `389cde2/tree 3dd1b6e` + HTTPS/trust; исторический dual-browser `39effb4/tree d11caed` отдельно | `UNKNOWN`; реального принятого документа нет, старую authority не переносить | B/Ops — read-only первоисточник; C — точная сверка checkout |
| Store ZIP | `NOT CREATED / NOT ACCEPTED` | C после authority, B1 и независимого review |
| Catalog + reviewer normal login | Не доказаны на этом ZIP | B/Ops — истинное целевое состояние; Тестер — установленный сценарий |
| Chrome original popup Start → read-only data → Finish | `NOT ACCEPTED` | Тестер R3, отдельный точный artifact и журнал |
| Реальный необходимый backup/restore/rollback | B→C сохранил `NO_GO` для установленной recovery-среды; не вся будущая C05 автоматически блокирует узкую первую подачу | B/Ops — только законное согласованное окружение |
| Текст PR153 | `DRAFT / P1 REWORK_REQUIRED` | Конкретное решение владельца по title/metadata/hero; scope отдельно |
| Реальный Store item/moderation | `NOT SUBMITTED` / dashboard `UNKNOWN` | C после всех нужных gate; отдельное требуемое действие publisher только по факту |

**Публикация: Chrome — PREPARING.** Успех 5/5 CI и 13/13 jobs не является STORE, INSTALLED, LIVE_OWNER или PRODUCTION. Opera/Firefox/Яндекс проверяются по отдельным нормам, Safari отложен. Этот документ не создаёт вторую очередь, автоматический gate, новую роль или разрешение на публикацию, и не закрывает C06; C продолжает доступный утверждённый PLAN.

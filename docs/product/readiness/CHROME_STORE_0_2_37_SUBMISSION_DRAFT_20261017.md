# Chrome Web Store — точная подготовка Octoport 0.2.37 (C06 / STORE-0)

**PREPARING — НЕ ГОТОВО К SUBMIT.** Проверено 17 октября 2026 года. Это внутренний материал для подготовки карточки и проверки издателя; не подписанный Store ZIP, не подтверждённая установка, не новая release authority и не изменение PR153/текстов сайта.

## Источник и степень доказательства

- Репозиторий `MaksimUnimax/runtime-fixtures`. Принятый SOURCE/CI: `main e8de8435828834981755f200ec91ad6e9a17cbf1`, tree `4545cd0f7579c9217bb2fda523c36521b5b43e30` (PR190).
- Пять native push workflows exact SHA и 13/13 jobs: **COMPLETED / SUCCESS**. Server CI `38999328190`, Extension CI `38999328170`, Extension I1-C1 `38999328196`, Documentation `38999328172`, Coordination/Safety `38999328204`.
- Точный GitHub Extension CI artifact `12088142874` — внешний ZIP доказательств и пакета. Внутри: `SELLER_AGENTS_I1_C1_v0.2.37_LOCAL_DEVELOPMENT.zip`, 2 603 866 байт, 41 файл, SHA256 `fbedd0b7b648c835c7328bee4019a97ab046a64fde6007b6b193a86d44db7f89`.
- Внутренний ZIP побайтно совпадает с предыдущим `main 4fb72f89`. Различие `4fb72f89→e8de8435` — только `tests/regression/extension-core/late-start-route-continuity.mjs`; runtime и manifest расширения не менялись.
- 176 общих CI-gates и целостность исходного ZIP подтверждают **SOURCE/PACKAGE**. Они не подтверждают установленный Google Chrome, реальную авторизацию, маркетплейсы, Store signature, публикацию или проверку владельца.

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

## Доказуемый минимальный путь к первой Chrome-подаче

1. **Authority.** Existing B/Ops в разрешённых read-only границах находит настоящую принятую `octoport_release_authority_v1` для точных `e8de8435` / tree `4545cd0`, `0.2.37`, `control_plane_v2`, migration `61`, среды `PREPRODUCTION`, двух разных канонических HTTPS origins и подлинного публичного Ed25519 trust bundle. Нет первичного доказательства — статус `UNKNOWN`; старую authority, loopback и новые ключи не выдумывать.
2. **Store package.** C подготавливает иной ZIP, связанный с принятой authority, правильной identity и конфигурацией; проводит B1 `prepare`/`preflight`, независимое review, проверку точного исходника/составленных байтов. Изменения permissions/имени/доверия не скрывать под повторной выдачей developer ZIP.
3. **Целевой сервер.** B/Ops подтверждает реальный `target_artifact_sha256`, release/catalog/profile compatibility и обычный reviewer device/auth flow. Ни синтетический API, ни source CI не заменяет установленный сервер; live/DB требуют собственных полномочий и восстановления.
4. **Оригинальный Chrome popup.** Назначенный Тестер R3 проверяет **точный установленный ZIP** в Google Chrome: штатный NORMAL_DEVICE_FLOW и `authenticated=true`, `workAllowed`, Start для одной подтверждённой AI-поверхности, явный click на безопасный read-only запрос Ozon/WB, результат в том же диалоге ровно один раз, Finish и no-replay после UNKNOWN. Не использовать отдельные окна, sidebar или новую вкладку вместо исходного popup.
5. **Reviewer.** После такого доказательства C оформляет доступный reviewer account/test store с синтетическими данными и настоящим входом, инструкции, карточку, privacy, скриншоты и ограниченную видимость. Никакого auth bypass, универсального OTP, личных ключей продавца или имитации поведения для Store-review. Использовать уже данное разрешение раннего Submit только при выполнении минимума; факт `SUBMITTED`/`APPROVED`/`PUBLISHED` отмечать по реальному dashboard.

**Импорт через системный выбор файла внутри исходного popup** — отдельная личная B01/R3 проверка Тестера; без её результата не объявлять функцию принятой. PR153 содержит отдельный P1 спор о текстах сайта и требует конкретного решения владельца — не обходить его переименованием этого документа.

## Незакрытые результаты и возврат

| Gate | Фактическое состояние | Ответственный/следующее событие |
|---|---|---|
| Authority `e8de/tree4545` + HTTPS/trust | `UNKNOWN`; принятого первичного файла нет | B/Ops — read-only источник; C — точная валидация |
| Store ZIP | `NOT CREATED / NOT ACCEPTED` | C после authority, B1 и независимого review |
| Catalog + reviewer normal login | Не доказаны на этом ZIP | B/Ops — истинное целевое состояние; Тестер — установленный сценарий |
| Chrome original popup Start → read-only data → Finish | `NOT ACCEPTED` | Тестер R3, отдельный точный artifact и журнал |
| Реальный необходимый backup/restore/rollback | B→C сохранил `NO_GO` для установленной recovery-среды; не вся будущая C05 автоматически блокирует узкую первую подачу | B/Ops — только законное согласованное окружение |
| Текст PR153 | `DRAFT / P1 REWORK_REQUIRED` | Конкретное решение владельца по title/metadata/hero; scope отдельно |
| Реальный Store item/moderation | `NOT SUBMITTED` / dashboard `UNKNOWN` | C после всех нужных gate; отдельное требуемое действие publisher только по факту |

**Публикация: Chrome — PREPARING.** Успех 5/5 CI и 13/13 jobs не является STORE, INSTALLED, LIVE_OWNER или PRODUCTION. Opera/Firefox/Яндекс проверяются по отдельным нормам, Safari отложен. Этот документ не создаёт вторую очередь, автоматический gate, новую роль или разрешение на публикацию, и не закрывает C06; C продолжает доступный утверждённый PLAN.

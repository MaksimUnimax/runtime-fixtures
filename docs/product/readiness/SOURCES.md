# Источники и пределы проверки

Проверка выполнена 2026-09-23. Внешние требования меняются; перед Submit сверяется реальный dashboard. Снимок проекта не является обещанием неизменности активно работающих A/B/C.

## Проект Octoport

Репозиторий: [MaksimUnimax/runtime-fixtures](https://github.com/MaksimUnimax/runtime-fixtures). Remote main исследования: `de45ce6c6b9dc99c79c4140e28043e17f10fdda5`.

Прочитаны требования SPEC/UX/ADMIN_AND_WEB/BETA_ADMISSION; DECISIONS/OPEN_ITEMS; CONTRACTS/SYNC; ACCEPTANCE_MATRIX; READ_POLICY и интеграции Ozon/WB/AI/browsers; MONITORING/RELEASE_AND_RECOVERY/domain migration; B1 publisher/install/release notes; 35-row Q1-C matrix/runbooks/SMTP closure; Stream-2 Telegram prerequisites/WB single-bundle/Health acceptance; актуальные coordination README/PROTOCOL/PLAN/OWNERSHIP/AGENTS; код Telegram env/polling, OTP/health notification runner и health-runner entry.

Ключевые канонические файлы:

- [SPEC](https://github.com/MaksimUnimax/runtime-fixtures/blob/de45ce6c6b9dc99c79c4140e28043e17f10fdda5/docs/product/SPEC.md)
- [UX](https://github.com/MaksimUnimax/runtime-fixtures/blob/de45ce6c6b9dc99c79c4140e28043e17f10fdda5/docs/product/UX.md)
- [CONTRACTS](https://github.com/MaksimUnimax/runtime-fixtures/blob/de45ce6c6b9dc99c79c4140e28043e17f10fdda5/docs/architecture/CONTRACTS.md)
- [MONITORING](https://github.com/MaksimUnimax/runtime-fixtures/blob/de45ce6c6b9dc99c79c4140e28043e17f10fdda5/docs/operations/MONITORING.md)
- [Q1-C matrix](https://github.com/MaksimUnimax/runtime-fixtures/blob/de45ce6c6b9dc99c79c4140e28043e17f10fdda5/docs/development/q1/Q1_C_OWNER_LIVE_MATRIX_2026-09-21.tsv)
- [Telegram prerequisites](https://github.com/MaksimUnimax/runtime-fixtures/blob/de45ce6c6b9dc99c79c4140e28043e17f10fdda5/docs/development/stream2/S2_TELEGRAM_PRODUCTION_PREREQUISITES_2026-09-22.md)

Сервер исследовался без раскрытия значений секретов: имена systemd units, активность, пути env/их права и наличие отдельных настроек; статусы A/B/C и owner_requests; текущие git revisions. Проверены только указанные служебные пути, а не «все секреты на всём сервере». Отсутствие конкретного env name не доказывает отсутствие другой конфигурации/учётки.

Наблюдавшиеся рабочие HEAD: A `c7301c15d837784bd5d0b966eb8089b9102b38f4`, B `dcf9800bc5a2e6c090a1768dfa3062ebd16ce557`, C в последнем чтении `26ffd648c7449cd4c7049b7cb05d694b05298b04`. Не принимаются здесь как объединённая RC.

## Эталон Ozon Bridge

Основная проверенная линия: [blood_sand, 3b102f68](https://github.com/MaksimUnimax/blood_sand/tree/3b102f68a96bee0d7d734d7e32d4fccba440e927), ветка `repair/ozon-v0.1.22-live-defects-2026-09-14`.

Каталог `tooling/llm-api-bridges/ozon-seller/research/product/`:

- [PRIMARY_GATE_INDEX](https://github.com/MaksimUnimax/blood_sand/blob/3b102f68a96bee0d7d734d7e32d4fccba440e927/tooling/llm-api-bridges/ozon-seller/research/product/OZON_AI_WORKER_PRIMARY_GATE_INDEX_2026-09-02.md): 44 основной набор и последующее reopening CAP24.
- [PRIMARY_GATE_LIVE_RESULTS_TABLE](https://github.com/MaksimUnimax/blood_sand/blob/3b102f68a96bee0d7d734d7e32d4fccba440e927/tooling/llm-api-bridges/ozon-seller/research/product/OZON_AI_WORKER_PRIMARY_GATE_LIVE_RESULTS_TABLE_2026-09-02.md): построчные исторические результаты и ограничения, не текущая приёмка.
- [STANDARD_LIVE_BENCHMARK_V2](https://github.com/MaksimUnimax/blood_sand/blob/3b102f68a96bee0d7d734d7e32d4fccba440e927/tooling/llm-api-bridges/ozon-seller/research/product/OZON_AI_WORKER_STANDARD_LIVE_BENCHMARK_V2_2026-09-02.md): исходные STD01–20 и резерв21–28.
- [CAPABILITY_AWARENESS_LAYER](https://github.com/MaksimUnimax/blood_sand/blob/3b102f68a96bee0d7d734d7e32d4fccba440e927/tooling/llm-api-bridges/ozon-seller/research/product/OZON_AI_WORKER_CAPABILITY_AWARENESS_LAYER_20_TESTS_2026-09-02.md): CAP01–24, несмотря на историческое имя 20_TESTS.
- [COMMON_REGRESSION_POOL](https://github.com/MaksimUnimax/blood_sand/blob/3b102f68a96bee0d7d734d7e32d4fccba440e927/tooling/llm-api-bridges/ozon-seller/research/product/OZON_AI_WORKER_COMMON_REGRESSION_POOL_2026-09-07.md): disabled operation/BUSY regression.
- [SOL_44_HARDENING](https://github.com/MaksimUnimax/blood_sand/blob/3b102f68a96bee0d7d734d7e32d4fccba440e927/tooling/llm-api-bridges/ozon-seller/research/product/OZON_AI_WORKER_SOL_44_HARDENING_DESIGN_AND_REGRESSION_MATRIX_2026-09-07.md): recovery/continuation/joins/recipes/entitlement/missing rows/dictionaries/XLSX.
- UNIT_ECONOMICS_CAPABILITY_REQUIREMENT_2026-09-06.md; COMMERCIAL_VALIDATION_TZ; FREE_AI_OUTPUT_CAPABILITY_MATRIX прочитаны как контекст эталона, не как разрешение возвратить монетизацию или клиентскую автоработу.

Дополнительный [CAP25](https://github.com/MaksimUnimax/blood_sand/blob/17aa08335ee3acdc80cc7a093ddfa462198872f5/tooling/llm-api-bridges/ozon-seller/validation/OZON_BUSINESS_VALUE_TEST_45_CAP25_SEO_CARD_OPTIMIZATION_2026-09-11.md) взят из main `17aa08335ee3acdc80cc7a093ddfa462198872f5`: monthly query capture, уникальность/пагинация, SEO, IN_PROGRESS. Частные исторические суммы/файлы продавца в новый комплект не перенесены.

## Официальные внешние источники

| Источник | Что он подтверждает / предел |
|---|---|
| [Telegram tutorial](https://core.telegram.org/bots/tutorial) | BotFather/token, Bot API и идентификаторы отправителя/чата. Способ хранения на нашем сервере — инженерное решение проекта, не требование Telegram |
| [Chrome registration](https://developer.chrome.com/docs/webstore/register) | Аккаунт издателя и регистрация/платёж |
| [Chrome publishing](https://developer.chrome.com/docs/webstore/publish) | Listing/privacy/distribution, инструкция тестирования, review и режим публикации |
| [Chrome privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) | Обоснование минимальных permissions, disclosures/privacy URL, MV3 remote code boundary |
| [Firefox signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/) | Signing и listed/unlisted distribution, Mozilla account |
| [Opera publishing](https://help.opera.com/en/extensions/publishing-guidelines/) | Аккаунт, upload/metadata/review |
| [Yandex extensions](https://yandex.com/support/browser/en/personalization/extension) | Использование Chrome/Opera каталогов, не выдуманный отдельный store |
| [Safari extensions](https://developer.apple.com/safari/extensions/) | Реальные Safari web extensions, App Store и web packager без локального Mac/Xcode |
| [Apple enrollment](https://developer.apple.com/programs/enroll/) | Individual/organization/2FA/identity/membership; региональные цены |
| [Safari packager detail](https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect) | Точная ссылка на маршрут; детальный JS-документ не извлечён поисковым инструментом. Ограничения нашего ZIP проверить до обещания готового пути |
| [WB token authorization](https://dev.wildberries.ru/knowledge-base/articles/019dce8b-461a-78c7-b94c-6b5ea8cc8e86/avtorizatsiia-dlia-servisov) | Найден официальный материал; прямое открытие возвращало HTTP498. Полные правила применимости к Octoport **не подтверждены**, это открытый gate |
| [WB token connection](https://dev.wildberries.ru/knowledge-base/articles/019d49a0-f9f7-79a4-b5ee-df5dabe9cff4/kak-podkliuchit-sia-po-api-cherez-token) | Аналогично: официальный URL найден, текст не получен из-за498 |

Не использованы сторонние пересказы API как нормативное основание. WB-семейства в матрице — проектная адаптация бизнес-целей, не подтверждение текущих endpoint/прав. Временные оценки участия владельца и предлагаемый смысловой scoring — планирование на основе объёма, не статистика провайдера или уже измеренная скорость.

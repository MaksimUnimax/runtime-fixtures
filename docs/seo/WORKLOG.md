# SEO worklog — Октопорт

Этот журнал append-only: новые проходы добавляются ниже. Ошибки/отклонённые гипотезы не стираются; меняется их статус и фиксируется причина.

## 2026-09-16 — SEO-S0 / старт

### Поручение владельца

Запущена отдельная SEO-линия продукта Октопорт параллельно разработке сайта и сервера.

Зафиксировано владельцем:

- продуктовое название: **Октопорт**;
- маскот: осьминог, соединяющий маркетплейсы с LLM;
- логотип планируется как минималистичный осьминог;
- семантическое ядро и SEO необходимо строить с использованием существующего Yandex bridge из репозитория `blood_sand`;
- весь ход SEO-работы должен постоянно и полно фиксироваться в документации Seller_Agents.

### Проверка актуального Seller_Agents

Перед правками прочитаны обязательные точки входа:

- `AGENTS.md`;
- `README.md`;
- `docs/STATUS.md`;
- `docs/ROADMAP.md`;
- `docs/decisions/DECISIONS.md`;
- `docs/README.md`;
- `docs/development/WORKFLOW.md`;
- ранее проверены `docs/product/SPEC.md`, `docs/product/UX.md`, `docs/architecture/OVERVIEW.md`, `apps/site/README.md`.

Актуальный `main` непосредственно перед взятием задачи:

`16c0ac9b6aa9a72aa3100eb04f14bd74e4d6593a`

Commit message: `Merge Octoport SITE-S1 deployment preparation`.

Это важно: SEO-ветка взята уже после SITE-S1 preparation, поэтому не должна перетирать параллельные site changes.

Создана короткая отдельная ветка:

`docs/seo-semantic-foundation-2026-09-16`

### Проверка Yandex Wordstat bridge

Найден канонический путь:

`MaksimUnimax/blood_sand/tooling/llm-api-bridges/yandex-wordstat/`

Зафиксированный reference:

- version `1.1.5`;
- full Node suite `283/283 PASS`;
- fresh unpacked Chromium E2E `21/21 PASS`;
- credentials local-only;
- exactly-once lifecycle/recovery доказан в reference.

Исполняемый protocol подтверждает методы:

- `getTop`;
- `getDynamics`;
- `getRegionsDistribution`;
- `getRegionsTree`.

Endpoint authority находится в `reference-1.1.5/shared/wordstat_protocol.js`. Для broad semantic discovery принят `getTop` как основной метод; остальные методы используются только по аналитической необходимости.

### Созданная SEO authority

Созданы:

- `docs/seo/README.md`;
- `docs/seo/PRODUCT_TRUTH.md`;
- `docs/seo/METHODOLOGY.md`;
- `docs/seo/SEO_ROADMAP.md`;
- `docs/seo/SEED_UNIVERSE.md`;
- этот `WORKLOG.md`.

### Первое аналитическое решение

`SEO_DECISION`: не проектировать окончательное дерево посадочных страниц по интуиции до Wordstat discovery.

Причина: продукт может быть найден рынком через несколько разных словарей — «ИИ для маркетплейсов», «нейросеть», «ChatGPT для Ozon/Wildberries», «аналитика маркетплейсов», «ИИ-помощник селлера» и task-specific запросы. До evidence неизвестно, какой словарь должен определять главную category page, какие темы достойны отдельных marketplace/use-case pages и где будет каннибализация.

### Product-safe boundary

`PRODUCT_TRUTH`: SEO может строиться вокруг read-only работы с данными Ozon/Wildberries через выбранный пользователем LLM.

Не допускается до появления новых доказанных фактов:

- обещать редактирование business state;
- выдавать Октопорт за собственную LLM;
- обещать server archive отчётов;
- публиковать исторические `199/299 ₽` как текущие цены;
- писать, что public registration уже открыта;
- объявлять все browser/LLM combinations production-accepted.

### Initial seed universe

Сформирован широкий набор seed families:

- AI × marketplaces;
- Ozon;
- Wildberries;
- ChatGPT pairings;
- другие LLM discovery;
- analytics/sales/reports;
- advertising/stock/product read-jobs;
- integration/API/extension language;
- informational problem language;
- adjacent analytics-service category;
- brand defense.

Все seeds пока имеют статус `SEARCH_HYPOTHESIS`. Частотности не записывались и не оценивались моделью.

### Текущий blocker / внешний вход

Для перевода seeds в `WORDSTAT_OBSERVED` нужен реальный provider execution через установленный Wordstat Bridge с локальным Yandex credential. GitHub reference подтверждает протокол, но не содержит secrets, и secrets не должны переноситься в репозиторий.

До provider result работа может безопасно продолжаться только в части подготовки batches, схемы хранения и product-safe taxonomy. Нельзя подменять Wordstat веб-поиском или модельной оценкой частотности.

### Следующий cursor

1. Подготовить первый bounded batch `getTop` по 15 broad seeds из `SEED_UNIVERSE.md`.
2. Выполнить provider calls через Wordstat Bridge.
3. Сохранить raw provenance без редактирования.
4. Построить первую normalized table и определить новые vocabulary families.
5. Только после этого расширять второй batch.

## 2026-09-16 — SEO-S0 / Batch 01 preparation и current-site source audit

### Batch 01

Подготовлен `docs/seo/wordstat/BATCH_01_BROAD_DISCOVERY.md`.

Состав: 15 broad `getTop` calls, РФ `225`, `DEVICE_ALL`, `numPhrases=2000`.

Выбраны не подряд первые seeds, а независимые словари: общая AI category, нейросеть, seller-assistant language, analytics, Ozon/Озон, Wildberries/Вайлдберриз, ChatGPT pairings, sales analysis, integration language, adjacent analytics SaaS и informational how-to.

Статус: `PREPARED / NOT EXECUTED`. Это важно: файл команд не считается Wordstat evidence.

### Current public-site source audit

Проверены на актуальном `main`:

- `apps/site/public/index.html`;
- `apps/site/public/robots.txt`;
- `apps/site/public/sitemap.xml`.

Создан `docs/seo/technical/CURRENT_SITE_BASELINE_2026-09-16.md`.

Факты source:

- `lang=ru`;
- canonical = `https://octoport.ru/`;
- robots разрешает crawl и указывает canonical sitemap;
- sitemap содержит только главную, что соответствует текущему one-page source;
- основной контент статический и не зависит от JS;
- текущий Title: `Octoport — ИИ-сотрудник для Ozon и Wildberries`;
- текущий H1: `Ваш ИИ получает руки для работы с маркетплейсами.`;
- public copy аккуратно говорит о готовящейся закрытой бесплатной бете и read-only scope.

### SEO findings по source

`SEO_DECISION`: текущий site source не переписывать до первых Wordstat/SERP фактов.

Причина: Title соответствует product truth, но ещё не доказано, что «ИИ-сотрудник» — основной поисковый язык. H1 хорошо работает как брендовая метафора, но не доказано, что он оптимален как primary search heading.

Отдельный `SEO_REVIEW_REQUIRED`: в visible copy используется латинский `Octoport`, тогда как владелец зафиксировал русское продуктовое имя «Октопорт». После brand/search pass нужно естественно связать оба написания на странице, не создавая keyword stuffing или дубль URL.

### Git/PR state

Создан PR `#15` — `docs(seo): establish Octoport semantic SEO authority`.

PR основан на main `16c0ac9b6aa9a72aa3100eb04f14bd74e4d6593a`. На момент повторной проверки main не сдвинулся. PR mergeable.

Documentation CI запущен автоматически; до завершения CI PR не объявляется принятым.

### Текущий cursor

1. Дождаться Documentation CI для PR #15.
2. Выполнить реальные Wordstat calls Batch 01 через локально авторизованный bridge.
3. Сохранить raw outputs и перейти к normalization.

## 21 ноября 2026 — ядро по новой концепции

Проверены 328 исходных запросов без операторов, 1 210 формулировок в кавычках и 8 рядов помесячной динамики. Из 2 725 уникальных строк отобраны 493 фразы в 20 темах. Дата сбора и предел доступности данных Яндекса зафиксированы отдельно. Направления для страниц предварительные до проверки выдачи. [Результат и исходные ответы](wordstat-2026-11-21/README.md).

## 21 ноября 2026 — выдача Яндекса и названия роли

Проверены 44 запроса из ядра и ещё 40 запросов о ролях и сервисах. Для 126 формулировок без упоминания технологии получены отдельные широкие и фразовые ответы Wordstat. Для страницы о продукте выбрана формулировка «сервис для работы с маркетплейсами». Для статьи о делегировании — «что делает менеджер маркетплейсов». Решения и исключения зафиксированы в [разборе выдачи](serp-2026-11-21/README.md).

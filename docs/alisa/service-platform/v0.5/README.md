# Алиса · полный комплект для разработки v0.5

**Дата: 04.11.2026.** Это документация для реализации, не выполненная разработка. Новая платформа/каркас не установлены; продуктовые тесты NOT_RUN. Прежний v0.4 заменён этой редакцией.

## Начать здесь

[START_HERE.md](START_HERE.md) → паспорт [ENV-00](HANDOFF_ENVIRONMENT.md) → **[AL-S00](FOUNDATION_00.md)** → [ROADMAP](ROADMAP.md) 01–24. Потом — отложенное объединение по MERGE_ROADMAP, не зависимость запуска Алисы.

В комплекте **25 поставок: технический 00 + 24 предметных**, **70 требований**, **186 продуктовых сценариев** (168 сохранены и 18 добавлены). Отдельно 20 сценариев будущего объединения и инфраструктурные проверки. Ни количество файлов, ни валидатор документации не заменяют приёмку работающего продукта.

## Карта файлов

| Файл | Содержание |
|---|---|
| [ROADMAP_GUIDE.docx](ROADMAP_GUIDE.docx) | Читаемая очередь и правила сдачи |
| [DOMAIN_SETUP_GUIDE.docx](DOMAIN_SETUP_GUIDE.docx) | Шесть доменов, безопасная подготовка, инфраструктурный паспорт |
| [EXECUTOR_BRIEF.md](EXECUTOR_BRIEF.md) | Готовое поручение исполнителю |
| [FOUNDATION_00.md](FOUNDATION_00.md) | Конечный результат каркаса и сквозной технический тест |
| [SOURCE_LAYOUT.md](SOURCE_LAYOUT.md) | Конкретное дерево исходников/серверных путей, владение и запреты |
| [BUILD_RELEASE_RUN.md](BUILD_RELEASE_RUN.md) | Команды, сборка, CI, миграции, установка и откат |
| [ARCHITECTURE_VIEWS.md](ARCHITECTURE_VIEWS.md) | Контекст, приложения, сценарии, доверие и размещение |
| [ADR_INDEX.md](ADR_INDEX.md) / [QUALITY_RISKS.md](QUALITY_RISKS.md) | Решения с причинами, критерии качества, риски |
| [SPEC.md](SPEC.md) / [ROADMAP.md](ROADMAP.md) / [TEST_PLAN.md](TEST_PLAN.md) | Требования, порядок, подробные сценарии |
| [TRACEABILITY.md](TRACEABILITY.md) / [DEPENDENCY_AUDIT.md](DEPENDENCY_AUDIT.md) | Ссылки и зависимости без будущих потребителей |
| [DOMAIN_SETUP.md](DOMAIN_SETUP.md) / [HANDOFF_ENVIRONMENT.md](HANDOFF_ENVIRONMENT.md) | DNS/TLS и что реально должно быть готово до 00 |
| [LANDING_AND_FUNNEL.md](LANDING_AND_FUNNEL.md) | Своя главная Алисы и развитие конверсионного пути |
| [IDENTITY_AND_UNIFICATION.md](IDENTITY_AND_UNIFICATION.md) / [MERGE_ROADMAP.md](MERGE_ROADMAP.md) | Отдельный запуск, совместимость и объединение позже |
| [DATA_AND_STATE_MODEL.md](DATA_AND_STATE_MODEL.md) / [API_AND_EVENTS.md](API_AND_EVENTS.md) / [API_SCHEDULE.md](API_SCHEDULE.md) | Данные, контракты и этап появления операций |
| [BILLING_AND_ENTITLEMENTS.md](BILLING_AND_ENTITLEMENTS.md) | Оплаты, календарные месяцы, подарки и возвраты |
| [QUERY_INSIGHTS_AND_CATALOG.md](QUERY_INSIGHTS_AND_CATALOG.md) | Неподошедшие запросы → спрос → проверенный шаблон |
| [UX_AND_ADMIN.md](UX_AND_ADMIN.md) / [SECURITY_PRIVACY_OPERATIONS.md](SECURITY_PRIVACY_OPERATIONS.md) | Интерфейсы, защита, хранение и эксплуатация |
| [WORK_PROTOCOL.md](WORK_PROTOCOL.md) / [ACCEPTANCE_AND_FIXTURES.md](ACCEPTANCE_AND_FIXTURES.md) | Передача, роли и доказательства |
| [METHOD_AND_SOURCES.md](METHOD_AND_SOURCES.md) | Что взято из источников и что решено для этого проекта |
| [GITHUB_PUBLICATION.md](GITHUB_PUBLICATION.md) | Честный статус публикации и готовый publisher |

## Источники истины и ограничения

`data/roadmap.json` и `data/acceptance.json` задают карточки/тесты; Markdown — читаемое представление. `sources/` хранит прежние версии без переписывания истории. Текущие решения v0.5 имеют приоритет над историческими схемами/примерами. OpenAPI — проект, его перечисленные пробелы квалифицируются в соответствующем шаге, не замалчиваются.

Новая identity обслуживает сначала только Алису. Своя главная и воронка сохраняются до отдельного объединения. Runtime матрицы используется через контракт; его очередь и секреты не копируются в платформу. Цены/юрлицо/реальные разрешения не выдуманы.

## Проверка и передача

Из корня пакета: `python tools/validate_pack.py --output /tmp/alisa-documentation-check.json`, затем `python tools/verify_manifest.py`. Проверка документов не обращается к серверам и не выполняет продуктовые тесты.

`GITHUB_PUBLICATION.md` и `data/STATUS.json` не выдают локальные файлы за опубликованный commit. Новый пакет готов к передаче целиком; записи в GitHub требуется отдельное подтверждение фактической операции.

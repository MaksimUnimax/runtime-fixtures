# Архитектура: контекст, модули, сценарии и размещение

**Проект v0.5. Не отчёт о развёрнутой платформе.** Используется структура arc42 и уровни C4 [W-F01–03], адаптированные к принятым требованиям, не механическое заполнение шаблона.

## 1. Контекст и цель

Алиса — самостоятельный голосовой сервис со своей главной, воронкой, ЛК и админкой. Может продаваться до готовности расширения. Пользователь, сотрудник, Яндекс Диалоги, Ozon/WB, email, платёжный провайдер и разрешённый LLM — внешние участники. Старый Octoport — соседний продукт, не инфраструктурная зависимость. Его B22 не входит в эту очередь.

## 2. Уровень приложений и хранилищ

| ID | Приложение/хранилище | Назначение |
|---|---|---|
| C1 | web + BFF | Публичная главная/воронка, ЛК, свои sessions |
| C2 | admin + BFF | Отдельный staff вход, product-scoped интерфейс |
| C3 | identity | Person/контакты/факторы, библиотечный OIDC |
| C4 | platform API/worker | Tenant, доступ, billing, stores, gaps, catalog, support |
| C5 | runtime adapter | Проверенный контекст и совместимость RuntimePort |
| C6 | existing matrix runtime | План, transport, ledger, TTL результатов |
| D1 | identity PostgreSQL | Отдельный owner/migrations, не продуктовые деньги |
| D2 | platform PostgreSQL | Постоянные предметные данные, не финансовый JSON-архив |
| D3 | runtime repository | Текущий owner, без второго writer платформы |

C4 container — приложение/хранилище, не обязательный Docker-контейнер. Не требуется микросервис на каждую таблицу.

## 3. Границы

Браузер → свой BFF → платформенный API. Браузерный OIDC redirect идёт к identity; code exchange выполняется сервером, cookies host-only. Admin использует другой client/session и MFA. Identity не назначает paid по совпадению email. Platform получает runtime-результат через adapter после проверки tenant/ревизий и TTL. Секреты не идут в маркетинговую статистику или frontend.

## 4. Сценарии runtime view

**Технический 00:** UUID → BFF → атомарная DB запись → platform worker → квитанция. Никаких marketplaces.

**Пользовательский 02:** главная → identity email code → authorization code callback → проверка OIDC → неизменная local mapping → защищённый ЛК. Повтор не создаёт второй tenant.

**Аналитический 07:** проверенный tenant/store/access → закреплённый catalog/runtime version → queue → bounded provider calls → complete result → text/tts + временный просмотр. Повтор read не повторяет бизнес-запрос.

**Gap 08:** один logical episode → очистка → durable outbox → inbox dedupe → журнал; P1 miss и final failure различаются. Позже кластер → кандидат → validated release.

**Деньги 20:** immutable order → provider → inbox → authenticated verification → transaction payment+grant → notification. Redirect не выдаёт доступ. Повторы имеют один эффект.

**Будущее объединение:** подтверждённое связывание person с local IDs → общий UI через продуктовые API. Нет слияния по email, переноса ключей или пересоздания grants.

## 5. Размещение

Шесть адресов из DOMAIN_SETUP: prod site/admin/id и stage site/admin/id. Первый HTTP ingress может быть на согласованной Alisa, однако старый снимок CPU/RAM не доказывает capacity. Build-host отдельный. БД и upstream не публичны. Приложения, конфиги, logs и persistent state разложены по SOURCE_LAYOUT.

Текущие `alice-lab` OAuth/webhook не меняются из-за создания нового входа. Protocol endpoints нельзя заменить обычным redirect. Старые app/api/admin Октопорта не используются для авторизации Алисы.

## 6. Сквозные правила

Единственный owner данных; versioned contracts; tenant/product scope на каждом действии; secrets outside code; precise decimals; explicit time axis; default deny; unknown outcome не повторяется слепо; bounded queues; TTL; audit; независимые deploy и rollback; несовместимое изменение через ADR и регрессию.

## 7. Где спецификация продолжается

SOURCE_LAYOUT — конкретные каталоги и связи. DATA_AND_STATE_MODEL — сущности. API_AND_EVENTS/API_SCHEDULE — операции по моменту появления. IDENTITY_AND_UNIFICATION — OIDC/сохранение IDs. BUILD_RELEASE_RUN — команды и выпуск. QUALITY_RISKS — проверяемые качества/риски. ADR_INDEX — принятые границы и открытые решения.

# Исходники, директории, владельцы данных · v0.5

**Проектная обязательная структура для реализации AL-S00. Её наличие в документе не означает создание кода.** Корень изолирован от существующих workspace Октопорта; чужие каталоги не перемещаются.

## 1. Дерево исходников

```text
runtime-fixtures/
  products/alisa/
    README.md
    package.json                   # свой packageManager/scripts
    pnpm-workspace.yaml            # только собственные apps/*, packages/*
    pnpm-lock.yaml                 # не lockfile браузерного Octoport
    .env.example                   # placeholders, не значения секретов
    .gitignore
    bin/alisa                      # будущий единый CLI build/test/deploy
    apps/
      web/                         # Next.js: своя главная, /app, BFF
        src/app/
        src/features/
        src/server/
        tests/
      admin/                       # Next.js: отдельный staff origin/session
        src/app/
        src/features/
        src/server/
        tests/
    services/
      platform/
        pyproject.toml
        requirements.lock          # либо один другой зафиксированный lock tool
        src/alisa_platform/
          config/
          foundation/              # 00: health, техническая проба, migrations
          accounts/                # 02: local user/tenant/membership
          staff/                   # 03
          entitlements/            # 04; денежные grant на 20
          stores/                  # 05
          alice_link/              # 06: совместимый фасад навыка
          queries/                 # 07: metadata и runtime refs
          query_insights/          # 08 и 12
          catalog/                 # 11 и 13
          support/                 # 14
          notifications/           # adapter/outbox с первого потребителя
          privacy/                 # минимизация рано; полный UX на 15
          operations/              # tech baseline 00, dashboard 16
          billing/                 # 20–23
          runtime_adapter/         # RuntimePort, не новая матрица
        tests/
      identity/
        pyproject.toml
        requirements.lock
        src/octoport_identity/
          config/
          accounts/                # UUID до первых auth migrations
          protocol/                # library OIDC с 02, не на 00
        tests/
    contracts/                     # единственные исходные API/events/schema
      platform.openapi.yaml
      events/
      runtime/
      fixtures/                    # только synthetic
    packages/
      ui/                          # визуальные примитивы, без прав и секретов
      contracts/                   # сгенерированные TS DTO
    tests/
      architecture/
      contracts/
      integration/
      e2e/
      recovery/
      acceptance/
    infra/
      environments/dev/
      environments/stage/
      environments/prod/
      nginx/
      systemd/
      migrations/
      backup/
    release/                       # схемы manifest, не живые build outputs
  docs/alisa/service-platform/v0.5/ # комплект документации
  .github/workflows/alisa-platform-ci.yml
```

**На 00 создаётся исполняемый минимум**, а не набор пустых папок будущих функций. Карта показывает куда добавлять функционал по 01–24. Перечень не разрешает создавать вторую реализацию transport/матрицы в `platform`.

Nested workspace не подключается к корневому release Octoport автоматически. Изменение root package/workflow требует согласованного diff. Общие UI-библиотеки закреплены версией и не обновляют чужую установку без её выпуска.

## 2. Ответственность и направления связей

| Компонент | Владеет | Разрешённые обращения | Запрещено |
|---|---|---|---|
| web/BFF | UI и своя session | OIDC code exchange; allowlisted product API | DB, marketplace secret, произвольный URL от браузера |
| admin/BFF | Staff UI/session | Staff API с product-scoped проверкой | Общие cookie/тайный superuser, доверие только скрытой кнопке |
| identity | Person ID, контакты, факторы/session/OIDC | Своя DB, email | Платежи, магазины, grants; чужая DB |
| platform | Local tenant, grants/billing, leads/gaps/catalog/support | Своя DB, согласованный RuntimePort, payment/email adapters | Запись в runtime SQLite, собственный аналитический executor |
| platform worker | Inbox/outbox, уведомления/сверки | Предметные application services | Обход прав, выполнение marketplace отчёта вместо ядра |
| runtime adapter | Сопоставление контрактов и контекстов | IPC/mTLS ядра | Импорт исходников runtime по пути, чтение его DB |
| runtime | План, marketplace HTTP, результаты и ledger | Разрешённые источники и LLM | Отдача ключей интерфейсам/identity/gap аналитике |
| ui/contracts | Визуальные и типовые контракты | Стандартные библиотеки | Побочные бизнес-эффекты и credential network calls |

В platform: API → application service → domain/repository → port/adapter. Финансовый ledger имеет одного владельца. Внешний HTTP не исполняется внутри удерживаемой DB-транзакции. Browser DTO не содержит ORM/secret объектов.

## 3. Схемы и миграции

У identity и platform отдельные истории миграций и DB роли. Выбор модели identity с UUID предшествует первой auth-migration. Email не первичный ID. OIDC `(issuer,sub)` сопоставляется явно; никакого автоматического слияния по email.

Модуль создаёт предметные таблицы при первом функциональном потребителе. Сборка не изменяет DB. Миграции: plan → совместимость → отдельный apply → readback. Нет двух writers runtime DB или двух финансовых источников истины.

## 4. Серверное размещение

| Путь | Назначение |
|---|---|
| `/opt/alisa-platform/<env>/releases/<artifact-id>/` | Неизменяемый установленный пакет |
| `/opt/alisa-platform/<env>/current` | Указатель на принятый выпуск |
| `/etc/alisa-platform/<env>/` | Закрытые конфиги и секреты, вне Git |
| `/var/lib/alisa-platform/<env>/` | Постоянное состояние собственной платформы |
| `/var/log/alisa-platform/<env>/` | Ограниченные безопасные логи либо настроенный journald |
| `/run/alisa-platform/<env>/` | Sockets/временные runtime файлы |
| согласованное private backup-хранилище | Копии/ключ восстановления отдельно от очищаемых releases |

`env=stage|prod`; данные/роли/ключи различаются. Никаких записей в `/root/octoport-*`, `/opt/alice-market/releases/*` и Business Bridge. Запреты входят в архитектурный тест AL-T00-02 и проверку diff.

## 5. Владельцы изменения

Перед стартом назначить автора каждого компонента и проверяющего. Runtime adapter меняет согласованный owner, а не несколько исполнителей параллельно. `data/STATUS.json` документации не является реальным серверным lock. Порядок захвата/передачи работы фиксируется в рабочем журнале.

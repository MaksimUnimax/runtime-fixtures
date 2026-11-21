# Сборка, установка и откат · договор AL-S00

**Следующие команды должен создать и проверить исполнитель AL-S00. Они не заявлены существующими в этом документационном архиве.** Реально приложенные `tools/validate_pack.py`, `verify_manifest.py`, `publish_docs.py` работают только с документами.

## 1. Стек и фиксация

Направление сохраняется из v0.4: Next.js/React для web/admin, Django/PostgreSQL для platform, отдельный библиотечный OIDC identity, Python matrix за RuntimePort. Совместимые версии Python/Node/менеджеров пакетов и библиотек фиксируются в lockfiles/ADR до первой сборки. «Latest» или установленная историческая версия соседнего продукта — не достаточное обоснование.

Build выполняется на выделенном runner, не рядом с матрицей на неподтверждённых 1 CPU/~1 GiB. Stage/prod допускают nginx/systemd; Kubernetes не требуется. Один пакет проходит проверку и установку без пересборки на целевом сервере. Побайтовая воспроизводимость — отдельная проверка, не обещание по одному lockfile.

## 2. Команды в products/alisa

У изменяющих команд обязательный `--env`, нет default production. Ненулевой exit code при неуспехе; секреты не выводятся.

| Команда будущего ./bin/alisa | Эффект | Проверка |
|---|---|---|
| `doctor --env stage` | Проверка prerequisites/версий/namespace | Missing inputs перечислены, никаких клиентов не создано |
| `bootstrap --locked` | Только закреплённые зависимости | Свои locks не переписаны, чужие не затронуты |
| `build` | UI + Python packages из SHA | Source/toolchain/contracts в manifest |
| `test --scope foundation` | Код, contracts, boundaries, test DB/E2E | Результаты AL-T00, без live API |
| `package --source <sha>` | Immutable artifact + manifest | SHA256 и no-secrets scan |
| `migrate --env stage --plan` | План миграций | Без изменения DB |
| `migrate --env stage --apply --release <id>` | Только свои согласованные migrations | Before/after heads и журнал |
| `deploy --env stage --artifact <path>` | Установка точных байтов и своих units | Installed readback; nginx -t перед reload |
| `verify --env stage --scope foundation` | Закрытый technical E2E | Тот же probe_id во всех слоях |
| `rollback --env stage --release <id>` | Совместимый прежний код | r1/r2/r1 и сохранённая запись |
| `evidence --env stage --step AL-S00` | Allowlisted квитанция | Схема, версия, фактические результаты |

Нельзя сдавать только название CLI: все используемые в приёмке команды должны реально работать.

## 3. CI и путь выпуска

Checkout → locked bootstrap → lint/type/unit → contracts/architecture guard → temporary PostgreSQL integration → browser technical E2E → package/scan → разрешённый stage deploy → readback/smoke → независимая приёмка.

Workflow касается только путей Алисы. PR/fork не получает live secrets и не открывает production. Автотесты не ходят к Ozon/WB/LLM/payment. Живые испытания выделены и имеют отдельный допуск/ledger. Наличие workflow-файла без наблюдаемого запуска не доказывает CI.

## 4. Manifest и конфигурация

Source SHA, artifact ID/hash, toolchain, dependency locks, component versions, contract hashes, migration heads/compatibility, required config names без значений, RuntimePort version, evidence references. Конфигурация подаётся отдельно. Release идентифицируется кодом и конфигурационным fingerprint без секретов. Редактирование установленного immutable release запрещено.

Разделение build/release/run обосновано Twelve-Factor [W-F07], но конкретные команды — контракт нашего проекта.

## 5. Миграции и возврат версии

Сначала expand, совместимый со старым и новым кодом, затем switch. Destructive contract — отдельный выпуск после доказанного отсутствия старых consumers. На 00 выполняется маленький сценарий совместимой схемы на пробе.

Rollback кода не откатывает оплаченные периоды, новые данные или tokens. При несовместимой схеме — bounded stop затронутой функции и forward fix либо отдельно согласованное recovery. Восстановление старой БД поверх новых платежей запрещено.

## 6. Readiness и ресурсы

У каждой службы собственная identity, permissions и лимиты. Web DB-role не обладает DDL. Upstream только loopback/защищённая сеть. Readiness отражает обязательную DB/schema; liveness — только процесс. Пока runtime не подключён и аналитические функции выключены, readiness каркаса не ждёт всю матрицу.

Stage/prod не разделяют secrets/DB/session. DEBUG выключен для внешнего стенда; настройки проверяются стандартными deploy-checks и собственными отрицательными сценариями. Случайная публичная probe запрещена. Memory/disk budget выбирается и измеряется до параллельного запуска с текущим ядром.

AL-S17 расширяет recovery на реальные аккаунты/отзывы/TTL, AL-S23 — на деньги. Эти будущие этапы не отменяют базовый проверенный выпуск/restart/rollback уже на 00.

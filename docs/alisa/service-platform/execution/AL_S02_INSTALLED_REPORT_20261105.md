# AL-S02 · фактическая установка и незакрытый сетевой сценарий

**INSTALLED_BLOCKED_EGRESS / AL-S02 не принят.** Выполнена установка после явного допуска владельца на точный план. Последний read-only readback05.11.2026 **05:54:22 UTC** подтвердил версии ниже; четыре собственных rollout/probe locks свободны. Матрица и обработчик не менялись.

| Объект | Фактическое состояние |
|---|---|
| Web/API/identity | `alisa-6ae348354b3db0d3`, READY |
| Source | `6ae348354b3db0d3cdcdac03c7fcc7dd3ca0eb36` |
| Пакет | `alisa-6ae348354b3db0d3.tar.gz` |
| SHA256 tar | `4848fc3e0975d4b3fb347e7b0f5634c44ad81d01a31690263a3bf31cfb83136c` |
| Admin/shared current | принятый S00 `alisa-77d0f8ee2643ef65` |
| Сайт/identity | https://alisa-stage.octoport.ru / https://id-stage.octoport.ru |
| Режим | CLOSED, только example.invalid, приватный SMTP127.0.0.1:18225 |

## Применённые изменения

[Фактическая активация](AL_S02_ACTIVATION_20261105.json), [план до apply](AL_S02_MIGRATION_PLAN_20261105.json), [применённые миграции](AL_S02_MIGRATIONS_APPLIED_20261105.json).

Platform: ровно `leads.0002_submission_created_at` и `accounts.0001_initial`, 8 добавочных таблиц и nullable timestamp старой Submission. Identity: ровно17 миграций из разрешённого плана (account9 +allauth_idp_oidc3 +mfa3 +sessions1 +своя accounts0002), 10 добавочных таблиц. Повторный план пустой; прежние миграции не переигрывались, чужие БД/roles не создавались и не менялись.

Созданы собственные новые ключи/два confidential клиента; прежние Django/DB секреты сохранены. Web не получает DB и identity keys; platform не получает identity/private BFF keys. Конфигурации600 и закрытые backup. `site-current` и новый `identity-current` указывают на S02; shared `current` остаётся S00. Работают собственные identity-mail/account-cleanup timers; инженерная проба и worker выключены, прежний foundation cleanup сохранён. Изменены только разрешённые сайт/identity vhost (16k, path-only access log); admin block сохранён побайтно.

## Установленные проверки

| Проверка | Результат | Доказательство |
|---|---|---|
| Настоящий HTTPS Chromium → email-code → OIDC → BFF/API/PG → свой кабинет; профиль/согласия/изоляция/выход/повтор/restart | 34/34 PASS | [Smoke](AL_S02_INSTALLED_SMOKE_20261105.json) |
| TTL600/пять попыток, конкурентное использование кода, безопасный повтор, шифрование session/MFA, отсутствие enumeration | 9/9 PASS | [Runtime policies](AL_S02_INSTALLED_RUNTIME_POLICIES_20261105.json) |
| Запуск policy fixture + SMTP outage/recovery с сохранением зашифрованного письма и очисткой после отправки | 3/3 PASS | [SMTP](AL_S02_INSTALLED_POLICY_SMTP_20261105.json) |
| Семь actual BFF отрицательных state/issuer/audience/nonce/expiry/signature/PKCE; API outage/recovery, expiry и cleanup | 20/20 PASS | [Отрицательные сценарии](AL_S02_INSTALLED_NEGATIVE_20261105.json) |
| Реальный S02→S01/S00→та же S02, сохранность ID/профиля/сессии/ключей; S01 insert и повтор на расширенной схеме | 11/11 PASS | [Возврат](AL_S02_RELEASE_PAIR_ROLLBACK_20261105.json) |
| Точные bytes, приватность ingress/service logs, изоляция env, неизменность lab/OAuth/admin, финальные версии | 31/31 PASS | [Финальные проверки](AL_S02_INSTALLED_FINAL_CHECKS_20261105.json) |
| Эффективный исходящий deny через собственный systemd unit | **BLOCKED**, доказательства deny нет | [Egress](AL_S02_INSTALLED_EGRESS_20261105.json) |

Не складывать wrapper «policy fixture exit» с девятью policy assertions как девять новых отдельных тестов. TTL/лимиты дополнительно проверяются через installed Django runtime с собственными stage fixtures; конкурентное применение кода идёт по настоящему HTTPS. Native MFA secret/replay проверены; полный UI повторной password/MFA reauthentication не заявлен. Доставка на контролируемую настоящую почту, публичные клиенты и production не разрешены и не проверялись.

Независимый reviewer сам read-only перечитал receipts и фактические указатели/службы/health. Его итог: **[BLOCKED_FOR_FULL_DECLARED_INSTALLED_SCOPE](AL_S02_FINAL_INSTALLED_REVIEW_20261105.json)**. Положительные функциональные результаты не заменяют отсутствующий обязательный сетевой сценарий.

## Сохранённые незавершённые исходы и исправления

Подготовка безопасно остановилась до миграций на историческом `FOUNDATION_PROBE_ENABLED=1` только migration-env: runtime оставался0. Новые сохранённые ключи переиспользованы, остаток подготовки завершён один раз: [reconciliation](AL_S02_PREPARATION_RECONCILIATION_20261105.json). Импорт installer создал единственный собственный bytecode file; immutable check отказал до DB apply, удалён только этот generated cache, проверка с отключённым bytecode прошла: [manifest reconciliation](AL_S02_MANIFEST_RECONCILIATION_20261105.json). Архив повторно не устанавливался.

Первый browser state fixture не достиг backend — [FAILED сохранён](AL_S02_INSTALLED_NEGATIVE_ATTEMPT01_20261105.json). Контролируемый собственный callback proxy применил мутацию; семь исправленных fixture/denial пар прошли. Proxy полностью убран. Первый egress witness не прочитал тестовый файл из-за700 каталога — [исход сохранён](AL_S02_INSTALLED_EGRESS_ATTEMPT01_20261105.json). После исправления прав свидетель реально исполнился, но дал timeout/errno=None, поэтому сценарий остаётся BLOCKED. Первый форматный тест логов не распознал единственную строку `- - 400` пустого malformed request; [FAILED сохранён](AL_S02_INSTALLED_FINAL_CHECKS_ATTEMPT01_20261105.json), исправлен только этот точный placeholder без ослабления запрета query/секретов.

## Точный блок и следующий шаг

Эффективный systemd per-unit deny **не доказан**; окончательная причина kernel/BPF не установлена. Временные drop-ins удалены, службы восстановлены, никакого host firewall fallback не применялось. Автоматический цикл повторов не запланирован. AL-S03 не начинается.

Подготовлено отдельное [дополнение плана](AL_S02_EGRESS_AMENDMENT_20261105.md): один временный nft объект только для трёх собственных stage UID, собственный loopback deny witness и повтор входа, затем обязательное удаление только своего объекта. Правила и их SHA256 зафиксированы; read-only syntax check PASS и таблица отсутствует. **Нового допуска пока нет, правила не применены.** Исходный план запрещал host firewall, поэтому это отдельно предъявляемое изменение границ.

**Следующий шаг:** получить конкретный допуск на дополнение, свежая предпроверка, один конечный egress smoke и независимый окончательный installed verdict точного пакета. Следующее допустимое окно — сразу после этого допуска и успешной предпроверки. Альтернатива — восстановленная и доказанная поддержка per-unit deny. Повторная установка, новые миграции, rotation и CA dry-run не требуются.

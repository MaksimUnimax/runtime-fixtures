# Карта документации для L1
Все пути ниже относительно /root/octoport-main, если не указан абсолютный. При недоступности файла вmain использовать переданную snapshot копию и отметить, что она ещё candidate. Git/main и фактический сервер проверяются заново.
Архив содержит полные тексты относящихся к программе docs/product, docs/architecture, docs/server, docs/development/coordination и верхние README/AGENTS. Это справочник, а не предписание перечитывать462 файла каждым автопромптом.

## Порядок чтения
1. START_HERE.md — полная роль/полномочия/алгоритм работы; CONTROLLER_HIERARCHY.md — новое решение владельца.
2. AUDIT_REPORT.md + CURRENT_CONTEXT.md + controller-review.json — исходная точка L2; состояние controllers/L1/state.json.
3. AGENTS.md; coordination README,PROTOCOL,PLAN,OWNERSHIP.json,WORK_METHOD,RESOURCE_POLICY,STORE_POLICY,CONTINUOUS_ROADMAP_POLICY,UNATTENDED_CONTINUATION_POLICY,CODEX.
4. docs/product/SPEC.md и docs/product/readiness/{README,MINIMUM_SPEC,GAPS_AND_HANDOFF,TEST_PLAN,PUBLICATION}. Ручная версия/store и полная бета — разные границы.
5. coordination/OWNER_TEST_AND_MONITORING_ROADMAP_2026-09-28.md и MONITORING_REPAIR_ARCHITECTURE_2026-09-28.md. Их исторические снимки не обновлять задним числом.
6. Для изменяемого subsystem: docs/architecture/**, docs/server/HEALTH_SYSTEM.md и соответствующие ADR/contracts/readiness receipts. Сначала требование, потом код и тест, потом текущий runtime.
7. Новые /root/octoport-control/controller-notices, inbox, peer-handoffs, queue-scans/queue-receipts и связанные конкретные receipts. Старое OPEN не гарантирует, что дефект ещё существует.

## Где искать действительное состояние
| Вопрос | Источник и контроль |
|---|---|
| Что сейчас делает поток | ROLE.json + Git HEAD/dirty + новые notices + фактические процессы; поля result/next могут отставать |
| Что действительно принято | exact main SHA, Git ancestry/patch equivalence, пять обязательных CI, receipt с уровнем доказательства |
| Какая версия работает | systemctl show WorkingDirectory/ExecStart/source receipt; main не равен deployment |
| Работает ли монитор | журнал конкретного unit, last-result, read-only DB projection/backlog/lastVerified, actual timer; active недостаточно |
| Работает ли расширение | точный STORE ZIP/hash/runtime/browser/installed matrix; исходник и LOCAL_DEVELOPMENT архив отдельно |
| Готова ли подача | канал/item/version, полезный сценарий, reviewer path, текущий dashboard; receipt о draft не Submit |
| Почему WAITING_INPUT | свежий полный queue-scan на actual HEAD, новые входящие и конкретные события возврата |
| Что сделал L1 | controllers/L1/state.json, audits/, decisions.jsonl, escalations/; сравнение с L2 baseline |

## Важные текущие receipts
- coordination/receipts/A/A_OWNER_TEST_EXACT_PACKAGE_CONTROL_MATRIX_R2_2026-09-29.md: реальный дефект frozen0.2.6 transfer, reset/pass и исходный fix.
- coordination/receipts/A/A_EXACT_VERSIONED_LIFECYCLE_HARNESS_2026-09-29.md.
- coordination/receipts/A/A_STORE027_TECHNICAL_BOOTSTRAP_GATE_2026-09-29.md и более свежие provenance обновления A.
- В B-копии: coordination/receipts/B/B_RETENTION_RECURRING_COMPAT_DURABLE_EVIDENCE_2026-09-29.md и tooling/server/retention-compat-c2/README.md. Пока не вmain, читать exact B candidate.
- coordination/receipts/C/STORE1_0_2_6_REVIEWER_PRE_SUBMISSION_R9_2026-09-29.md — старый конкретный пакет; готовность0.2.7 не наследуется автоматически.
- coordination/receipts/C/C04_MONITORING_USER_CLARITY_COVERAGE_2026-09-29.md — SOURCE новых сообщений, не автоматическое доказательство deployed c2.
- /root/octoport-control/logs/C/monitor-retention-periodic-fe3b4aeb/{first-apply.log,automatic-cycle.log,post-auto-cycle.json,recovery-boundary.json}: живое ограниченное обслуживание.
- /root/octoport-control/incidents/streams-audit-20260929T0233Z: предыдущий аудит, доказанное исправлениеC2ef.
- /root/octoport-control/incidents/streams-handoff-20260929T0111Z: последний A/B/C transfer, полные промпты и исходные задачи.
- /root/octoport-control/incidents/streams-audit-20260927T1301Z: исторический аудит/REPORT/controller-review/A_TASK/B_TASK/C_TASK. Читать при споре о происхождении требований, не переносить прежний STOP как текущий без дат.

## Безопасные ссылки на полномочия
- /root/octoport-control/authorizations/OWNER-AUTONOMOUS-OCTOPORT-TEST-AUTH-20260928-1244.json — техническая авторизация.
- /root/octoport-control/controller-notices/*OWNER-TEST-ADVANCE-AUTHORITY-20260928-0932.json — bounded owner-test путь.
- Действующие STORE_POLICY, monitor TASK_C/assignment и notices — пределы уже разрешённого пилота/ранней подачи.
Защищённые сессии, OTP, env-файлы, marketplace JSON, backup.dump, browser profiles и raw provider payload в архив НЕ входят. Пути в нормативных документах не разрешают выводить их значения.

## Практические замечания
На сервере rg может отсутствовать: использовать git grep/Python, не тратить цикл на установку.
Для чтения/команд указывать реальный RDC device; локальный scratch ChatGPT не является Easyscript.
Git fetch HTTPS может быть доступен, push без авторизации поHTTPS зависает; существующий deploy key работает через SSH alias согласноCODEX.md.
Любой длительный tool вызов сохраняет stdout/status в отдельный файл: сессия RDC может исчезнуть после окончания. Не считать исчезнувшую session доказательством успеха.
Нет команды control.py L1/L2. Собственные metadata хранить отдельно; A/B/C reviewed только после реальной проверки.
Архив имеет SOURCE_MANIFEST.json и CHECKSUMS.sha256: источник/ветка/HEAD каждого среза явны. Snapshot не заменяет свежие live проверки.

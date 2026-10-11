# Octoport: три исполнителя и диалог оператора

> Priority 2026-10-06 / owner clarification 08:20 +05: [Chrome первым, разработка параллельная](CHROME_FIRST_DELIVERY_POLICY_2026-10-06.md). Chrome имеет первый приоритет и первым доводится до полной приёмки. Разработка и проверки Chrome/Opera/Yandex/Firefox остаются параллельными; завершение Chrome не является условием работы остальных. Общая принятая Chrome-основа используется для их окончательной адаптации.

Канонический репозиторий: https://github.com/MaksimUnimax/runtime-fixtures . Существующий проект и принятый roadmap продолжаются.

Действующий метод — [WORK_METHOD.md](WORK_METHOD.md), команды — [PROTOCOL.md](PROTOCOL.md), задачи и критерии — [PLAN.md](PLAN.md), назначение путей — [OWNERSHIP.json](OWNERSHIP.json).
A/B/C — три обычных диалога через MCP, каждый ведёт сквозной результат. Постоянных владельцев всех DB-правок и всех выпусков больше нет. OPERATOR — отдельный диалог по запросу, включённый в общий путь тестирования по [OPERATOR_TESTING_POLICY.md](OPERATOR_TESTING_POLICY.md).

| ID | Рабочая копия | Ветка |
|---|---|---|
| A | /root/octoport-a-extension | work/a-extension |
| B | /root/octoport-b-backend | work/b-backend |
| C | /root/octoport-main | work/c-integration |

Имена каталогов и веток сохранены, чтобы не терять WIP и историю; они не задают монополию на компоненты.
Общий work-board хранит результаты/зависимости; operator/ — точные пакеты, выдачи и замечания. Контроллер не нужен для передачи каждой задачи. Повтор управляющего промпта осуществляется прежним механизмом чатов; нового серверного исполнителя нет.

При восстановлении читать AGENTS.md, SPEC, MINIMUM_SPEC, этот README, WORK_METHOD, PROTOCOL, PLAN, OWNERSHIP, CONTINUOUS_ROADMAP_POLICY, STORE_POLICY, RESOURCE_POLICY, CODEX и актуальные notices/state/receipts.
Сначала фактические HEAD/dirty/remote main, STOP, текущая задача и свежие замечания. Старые result/next и датированные отчёты не заменяют проверку.

Постоянные инструкции: PROMPT_A.md, PROMPT_B.md, PROMPT_C.md, PROMPT_OPERATOR.md, PROMPT_CONTROLLER.md.
Одноразовые старты: START_A.md, START_B.md, START_C.md, START_OPERATOR.md, START_CONTROLLER.md. Они восстанавливают факты и не сбрасывают roadmap/STOP.
Старые описания «2+1», C-only-main, B-only-DB, обязательной передачи через C и видимой иерархии контроллеров отозваны этим согласованным методом. Сохранённые датированные evidence остаются историей, не командами.
Технические quality/live/privacy/STOP ограничения не отменены. Source/package/installed/live приёмка различается.

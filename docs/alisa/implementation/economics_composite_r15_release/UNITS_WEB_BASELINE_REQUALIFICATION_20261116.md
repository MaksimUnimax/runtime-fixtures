# R15: база после установки web units — 16.11.2026

Эта отдельная SOURCE-правка привязывает сборщик R15 к наблюдённому web-релизу units. Основание — фактическое чтение Alisa **16 ноября в 04:18:44 UTC**, а не статус PREPARED в GitHub. Новый builder PLAN, пакет и активация этой правкой не выполняются.

Родитель: [PR444, `1a9053e234eeba7bfdaab908a7c6868d042f1181`](https://github.com/MaksimUnimax/runtime-fixtures/pull/444), tree `6aba795cf127f554f4f3dd4505d59c239d52d6a2`. В отдельной ветке `feat/alisa-economics-r15-units-baseline-20261116` меняются ровно три значения [baseline_20261115.json](../../runtime/v0.11/economics_composite_r15_release/baseline_20261115.json); имя файла и `observed_on: 2026-11-16` сохранены.

## Наблюдённые значения и область изменения

| Поле | Новое значение |
| --- | --- |
| `bases.web.root` | `/opt/alisa-platform/stage/releases/alisa-catalog-units-0e00c848d3a4ad58` |
| `bases.web.manifest_sha256` | `c1fcd96cedb2278d06c9e384c883d38d471e0cb8a3743ce66022bdf1f4a15fba` |
| `bases.web.venv_link` | `/opt/alisa-platform/stage/releases/alisa-catalog-period-dea0498f51980cdc/.venv` |

Прежние значения — periodDEA, manifest `f9724dfd…` и буквальная ссылка `.venv` через public-guidance e0cc. Новый JSON: **2 872 байта**, SHA256 `29bd890109a31707c189be18313c9595f608c54c0118a47ff34978586209aef7`, Git blob `42e0d709581ee65ccd7b4d2dcf77534b19d14f0f`.

Остальные поля побайтно прежние. Product R15 — `1964d60f9a7598fefa2e10a0affcda0cce0f1f34`, те же 96 входов и source index `3b6bee51f233398d46c15646b3435edf147ee19e9cdf7abe74ae8908472dc26b`. Четыре других файла сборщика, runtime, активационный контракт, helper pins, readiness, no-replay, tests и workflows не меняются. Другие три базы наследуются из родителя; это узкое наблюдение web не выдаётся за их повторную текущую проверку.

## Первичное доказательство

`WEB_BASELINE_AFTER_UNITS_ACTUAL_EXACT_R1.json`: **4 048 байт**, SHA256 `32d373501b7047dfec6ada11c6d0257655ce8af0806b618e2597d868abeae9c6`. Чтение завершилось в `2026-11-16T04:18:44.873869+00:00`, статус `OBSERVED`.

- `web-current` указывает на units; манифест размером 977 602 байта совпал с новым pin.
- `alisa-web@stage.service` active/running, PID **1569339**, start ticks **100817811**, UID **995**. Cwd процесса — новый релиз плюс `ui/web/apps/web`, executable — `/usr/local/bin/node`. Pointer, поколение процесса, файлы и `.venv` стабильны между чтениями.
- Буквальная ссылка `.venv` теперь проходит через periodDEA, но конечный путь прежний: `/opt/alisa-platform/stage/releases/alisa-store-enrollment-592cc8bb006a4991/.venv`. Промежуточные релизы этой цепочки сохраняются.
- `/root/alisa-catalog-units-install-20261116/APPLIED.json`: **317 байт**, SHA256 `fc1f6576b92a369ddd640a752868e55822b7dc322d84c8e9f653081504fbd03d`. Проверена точная схема из шести полей; квитанция называет выбранный units-релиз и текущий PID. Product источника web — `0e00c848d3a4ad58a7ee99568b91b564f338e01c` из [PR442](https://github.com/MaksimUnimax/runtime-fixtures/pull/442).
- Историческая APPLIED-квитанция периода сохранена: 318 байт, SHA256 `69fb9428592cad65c139c261aca1032d2833d658edd05c3eb5fcbd2d08035f2f`; она уже не описывает текущий web/PID.

Observer не вызывал health, браузер, БД или провайдера, не импортировал приложение и не создавал units/restarts. Полное дерево релиза и окружения им не перепроверено. Значение READY в APPLIED — сохранённое утверждение установщика; отдельного свежего health-теста этот снимок не содержит. Наблюдение не предоставляет readiness или разрешение apply.

## История и следующие измерения

[Первая переквалификация базы](WEB_BASELINE_REQUALIFICATION_20261116.md) и Phase B остаются историческими доказательствами. Phase A [PR441](https://github.com/MaksimUnimax/runtime-fixtures/pull/441), `de9abcb160f39aad0f762ce2b7d0b681fd85cea4`, дала baseline `f91345ecef7efdea485cc914dc18b9baaf1b2a6002501e0a9fcf23bae6301e3e`. На нём в 03:43:29 UTC был измерен PLAN: 22 491 байт, SHA256 `eee23a47dcb3c47a66e5bd85bbdc011deaa1a31ff09aff14b36d8050179be50d`.

PR444 связал именно этот period PLAN и baseline с tool identity `586bf05f08b97ba2bd5bab8dbd90b75ff59169f1dca6fdf362e70e4989527f4b`. Они не переносятся на units автоматически. В текущей правке активационный контракт намеренно сохраняет исторические значения: новые `PRODUCT_PLAN`, PREPARED и tool identity ещё не измерены.

Порядок дальнейшей работы:

1. Независимое review точного двухфайлового diff и публикация отдельной ветки поверх PR444; применимые существующие CI должны пройти на новом head. Изменение release baseline выбирает существующий Source workflow, включая 36 builder tests, и документационные проверки. Прежний CI не подменяет новый результат; новые workflows и обходы фильтров не добавляются.
2. После точного CI — отдельный ограниченный builder PLAN на тех же проверенных 96 входах и новой базе. Штатные проверки полного дерева, окружения, live references и состояния до/после сохраняются. Нужны свежие ресурсные проверки; старые измерения свободного места не являются допуском.
3. Только фактические байты этого PLAN могут дать следующий `PRODUCT_PLAN` и зависимую правку baseline pin в активационном контракте. Новый пакет и его PREPARED получают отдельные измеренные значения; прежние PLAN, bundle и квитанции сохраняются.

Этот этап ограничен SOURCE и read-only builder PLAN по фактически наблюдённой базе. Стабильность конечной цепочки rollout, свежая readiness и координация будущего переключения остаются отдельными условиями. Наблюдение UNKNOWN в 03:32:39 UTC зафиксировало четыре неопределённых исхода; эта правка не разрешает их и не допускает повторную отправку, отмену или смену состояния. Активационные prepare/apply сохраняют свои idle/resource gates; apply дополнительно требует действительного browser/voice окна, связанного с окончательными PLAN/tool/PREPARED.

Браузерная приёмка установленного units-релиза, физическая голосовая проверка и R15 InstalledSynthetic/LiveOwner этой правкой не подтверждаются. Следующий шаг — квалифицировать точный новый SOURCE head и измерить соответствующий ему builder PLAN.

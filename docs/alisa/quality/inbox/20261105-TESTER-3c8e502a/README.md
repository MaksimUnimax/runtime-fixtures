# Повторный сбор: отмены без выручки и себестоимости

Run 20261105-TESTER-3c8e502a. LIVE_DIALOGS, итог BLOCKED.

- [Запросы и исходы](RUN_REPORT.json).
- [Багрепорт и последняя команда владельца](BUG_REPORT.md).
- [BLOCKED intake C-UE01](TEMPLATE_CANDIDATE.json).
- [Независимый synthetic gold](SYNTHETIC_GOLD.json), [его проверка](verify_intake.py).
- [Общий процесс](../../WORKFLOW.md).

Владелец: fixed gross ordered denominator; cancelled revenue и cancelled COGS исключаются; все остальные фактически понесённые cancellation costs остаются. Mandatory ads required. Старые результаты не переименовывать в свежий пересчёт.

Свежие заказы и metadata statuses прочитаны. Абсолютный день ошибочно стал month-to-date; yesterday работает. Ads zero из legacy source отвергнут. Cancellations metric not enabled; S02 проекция не показывает денежную сумму отмен. RDC Alisa offline при работающем HTTPS.

Автор получает конкретные LIVE_DIALOGS FAIL и формулу. Общие BUGS/TEMPLATES/RUNS/BOARD тестером не менялись. Следующий шаг — восстановление канала, missing fresh reads и общий JSON binding/projection, не Python под фразу.

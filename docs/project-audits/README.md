# Аудиты Октопорта

Общее место для прежних и новых аудитов хода разработки, метода работы и сроков.

**Основной документ: [Аудиты](AUDITS.md).** В нём находятся каталог истории, исходные оценки, контрольные точки, план и факт, отклонения и записи наших совместных разборов.

- GitHub: `MaksimUnimax/runtime-fixtures`, папка `docs/project-audits`, рабочая ветка `docs/independent-reviewer-20261027`.
- Сервер Easyscript: `/root/octoport-control/project-audits`.
- [history](history/) содержит десять полных исторических текстов и одно отдельно обозначенное извлечение базовой оценки.
- Оригиналы сохранены. Сбор этих материалов не возобновляет исполнителей, тесты или расписания и не меняет их управляющие правила.

Исторические отчёты отражают состояния, решения и формулировки своих дат. Их указания о запуске, остановке, доступе или исправлениях не являются новыми командами. Основной журнал хранит новый план отдельно от старых оценок, не переписывая исходные сроки задним числом.

## Происхождение материалов

| Копия в этой папке | Первичный источник |
|---|---|
| [27.09 Контроллер](history/2026-09-27-controller-audit.md) | [GitHub исходник](https://github.com/MaksimUnimax/runtime-fixtures/blob/9ab8f998de40dbadd7d19b38a2889a26a4fe38dc/docs/development/coordination/CONTROLLER_AUDIT_2026-09-27_1201.md), blob `540fae59eafa7eb163f0b7e477912f2cff16de1e` |
| [28.09 Контроллер](history/2026-09-28-controller-audit.md) | [GitHub исходник](https://github.com/MaksimUnimax/runtime-fixtures/blob/9ab8f998de40dbadd7d19b38a2889a26a4fe38dc/docs/development/coordination/CONTROLLER_AUDIT_2026-09-28_0510.md), blob `1ce35fca50ea38160a945409100805683d57f235` |
| [29.09 Контроллер](history/2026-09-29-controller-audit.md) | [GitHub исходник](https://github.com/MaksimUnimax/runtime-fixtures/blob/9ab8f998de40dbadd7d19b38a2889a26a4fe38dc/docs/development/coordination/audits/2026-09-29_0233Z/REPORT.md), blob `e70dc82de06171972e6d866262189943e947d2b8` |
| [27.09 Roadmap и оценка](history/2026-09-27-roadmap-and-estimate.md) | Space: `OCTOPORT_ROADMAP_2026-09-27.md`, `libfile_ef06fa307ce481918f02c5e99282b954`, 19 171 байт |
| [29.09 Метод и задержка выдачи](history/2026-09-29-delivery-audit.md) | Space: `OCTOPORT_DELIVERY_AUDIT_2026-09-29.md`, `libfile_0af7d5e72fe881919a70558b17200d46`, 15 339 байт |
| [30.09 Состояние проекта](history/2026-09-30-project-audit.txt) | Space: `Octoport-audit-2026-09-30.txt`, `libfile_dbb9a9e10844819199257820549e2243`, 20 550 байт |
| [01.10 Сводка](history/2026-10-01-audit-summary.md) | Space: `Octoport_audit_2026-10-01_summary.md`, `libfile_811f55b1437c8191995d28426368fd7e`, 9 265 байт |
| [07.10 Организация](history/2026-10-07-organization-audit.md) | Easyscript: `/root/octoport-control/controllers/audits/CONTROLLER-DEVELOPMENT-AUDIT-20261007T0300Z/ORGANIZATION_REPORT_AFTER_WORK.md`, 85 847 байт, SHA256 `65c2b59b8ffce70cd547fa360fc28c8fa72d3302a4826f1af12f733cf4163c06` |
| [Baseline 08.10](history/2026-10-08-baseline-recorded-2026-10-14.md) | Факты из файла Space от 14.10 `libfile_32b6d8aa46ec81918ce7c504b94acb2b`, строки 301 и 305. Это извлечение, не полный исходный аудит |
| [11.10 Самоаудит](history/2026-10-11-dot-self-audit.md) | Easyscript: `/root/octoport-control/controllers/audits/DOT-SELF-AUDIT-20261011T1453Z/AFTER_WORK_REPORT.md`, 107 263 байта, SHA256 `f674ecf01e84a4ad17c12811562d548aa0615f0e4f48cbe0db4370f037f870f9` |
| [23.10 Готовность и срок](history/2026-10-23-readiness-estimate.md) | [Полное сообщение](https://chatgpt.com/c/6adad9ac-011c-83ea-a3db-e9c9bcd007ce?messageId=89c4e803-418c-5c0b-95ca-e119f49861e8), 23.10.2026 10:12:03 UTC+5, 34 768 байт. Скопировано тело одного отчёта, не весь диалог |

Текущий checkpoint ручной выдачи 31.10 подтверждён сообщением владельцу в 10:54 UTC+5 и сохранённой идентичностью ZIP. Файл в Space: `libfile_c984ca6b0940819182488c8dd68e2249`; сценарий: `libfile_b51cb1464f7081919c1a79dca3f01c5f`. Это доказательство передачи сборки, не полной приёмки B02.

## Граница первоначального сбора

Просмотрены документы в трёх снимках GitHub (`main` c5d0ad9, документационная ветка 9ab8f99 и ветка синхронизации правил f5e328b), каталог серверных аудитов, доступные материалы Space и найденные диалоги. Полный архив всех сообщений и всех веток не восстановлен. Два найденных диалога 15.10 и 28.10 перечислены в журнале без выдуманного полного текста.

Все полные исторические тексты сохранены без исправления их старых выводов. Новые пояснения и оценки находятся в AUDITS.md и не подменяют первоисточники.


# Поставка понятных единиц — 16.11.2026

Статус PREPARED, не INSTALLED. Рабочая версия по-прежнему catalog-period-dea0498f; обе сессии, backend/identity/R5/native/admin и прочие8 служб сохранены.

Продуктовый источник `0e00c848d3a4ad58a7ee99568b91b564f338e01c`, PR442. SourceCI43797976633 и DocsCI43797976610 SUCCESS.23 группы Next/Chromium PASS; [независимое ревью исходников](CATALOG_UNITS_REVIEW_2026-11-16.md) без блокеров.

CI artifact14195846001 получен штатным download_workflow_artifact и скачан непосредственно в файл Alisa. ZIP52 359 237 байт, SHA256 `445312b619f702aa8073190c48b76a7a657e21631657a73f32a038cc17badcb2`; CRC и обе sidecar суммы PASS. PlatformTAR `9129abbe6536fced504cf567fb132b7113eedfefb65f16175ecf335bde42d97f`,4654 файла. Временная ссылка в отчёте не сохраняется.

[Новый установщик](scripts/install_question_catalog_units_20261116.py), SHA256 `e908cbb7819dd58501b1e5cfd5e7384c5a90ae4abe8cfaf9e1ddfafa5d34747c`, использует все10 неизменённых функций принятого установщика периода. Изменены только фиксированные SOURCE/TAR/пути/BASEpin. BASE — действующий periodDEA, manifest `f9724dfdad8eb8b197863e83b658bdeeb9002a942409babd94bb05e2a6cef42f`. Контракты, locks, staff/session overlay, publisher, эффективная админка d4eb, текущие состояния восьми служб и4UNKNOWN защищены прежними проверками.

[Ревью поставки](CATALOG_UNITS_ROLLOUT_REVIEW_2026-11-16.md) без функциональных блокеров. Прежний portable-harness направлен на новый файл;22 теста PASS от root и22 от nobody. Тесты не клонировались, shared workflow не изменён.

Подготовленный APP alisa-catalog-units-0e00c848d3a4ad58: manifest `c1fcd96cedb2278d06c9e384c883d38d471e0cb8a3743ce66022bdf1f4a15fba`, новых байт298 455. PLAN SHA256 `644a546c44ab62e954371fef780622a1cae2614ce29c891c2ce27490858f09b5`. Переключение ещё не выполнено.

Квитанции Alisa: `/root/alisa-catalog-units-install-20261116/`; Easyscript: `/root/alisa-catalog-units-20261116/`. После точных CI установщика — apply с привязкой к PLAN, настоящая Cloud Browser проверка единиц/периода/переноса без отправки, повторная сверка protected8 и отсутствия новых вызовов/jobs. WB в контролируемой fixture остаётся SYNTHETIC, не LIVE_OWNER.

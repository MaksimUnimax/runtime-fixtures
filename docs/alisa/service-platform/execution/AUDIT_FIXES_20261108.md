# Исправления аудита Алисы — 8 ноября 2026

**Пакет исправлений установлен и сохранён в общей ветке.** A03 fairness, A04 admin storage, A05 lost-ACK/two-tab recovery и A06 total HTTP deadline установлены из 06f3c053e77192907821005aa4aae5cc1e8aee63. Native 1076/1076, независимый PASS_INSTALLED_SMOKE. S06/S07, числовая приёмка и физическая Станция этим статусом не закрыты.

Итоговый интеграционный head df60518a7d564a452ae92c3f6103f27fe9ee1931 прошёл полный CI 42446268819 и Documentation CI 42446268817. PR #399 слит merge 7c2c674fae5c2b07a15f48b961f7a204a65a5102. Сохранены параллельные исправления входа и их материалы; начальный неповторившийся browser-FAIL предыдущего SHA не скрыт.

Последний readback 04:25 UTC: web/identity alisa-da73a089d3125429 после отдельного обновления входа; admin/platform/core сохраняют 06f3. Все четыре HTTP-службы READY. Диск 3162.48 MiB при минимуме 3072 MiB; перед следующей поставкой снова измерять резерв. Не возвращать старые pointers и не заменять текущую авторизацию прежним снимком.

[Полный отчёт и исходные доказательства на ветке alisa](https://github.com/MaksimUnimax/runtime-fixtures/blob/alisa/docs/alisa/quality/AUDIT_FIXES_2026-11-08.md). [Инструкция для первых частных тестов Станции](https://github.com/MaksimUnimax/runtime-fixtures/blob/alisa/docs/alisa/quality/STATION_START_2026-11-08.md).

Следующая продуктовая работа: остаток S05, RuntimePort и привязка Яндекса S06, первый сквозной отчёт S07. OWNER-SOURCE-R1 уже разрабатывается отдельным кандидатом; его не считать установленным. Частный опубликованный навык можно проверять сегодня под аккаунтом его создателя; S18 — итоговая приёмка на физической Станции.

## История подготовки — не текущее состояние


Статус: IN_PROGRESS. Основание — прямое поручение владельца устранить ошибки аудита и подготовить работу с прибывающей Станцией.

Автор текущего scope: /root. База платформы 9be30db36b90be9d924cf977c76d052b91b6d8c3; действующие web/identity 7afaf646, admin73180172, platform6098b313. Изолированная ветка fix/alisa-audit-r1-20261108. Рабочие исходники/конфигурация пока не изменены.

Scope: A03 fairness существующего runtime, A04 storage админки, A05 восстановление неизвестного create магазина, A06 deadline shared_http; безопасный ресурсный план; согласование актуальных QA-записей. Не добавлять второй scheduler/HTTP client/реестр. Независимый reviewer /root/registration_review.

S05–S07 — незавершённая продуктовая интеграция, отдельный объём roadmap; исправления UI не закрывают реальные provider/pair qualification. S18 — полная приёмка на физической Станции.

8 ноября кабинет Яндекс подтвердил: «Октопорт маркет» опубликован как приватный навык 3 ноября, Станция разрешена, обязательного экрана нет. Published webhook — https://alice-lab.octoport.ru/alice/webhook. В опубликованной версии проверена «помощь» с interfaces без screen и ответом text/tts; это не проверка звука физической колонки. Владелец может начинать голосовые проверки под тем же Яндекс-аккаунтом. Токены и raw Request не сохраняются.

Следующий шаг: минимальные адресные исправления с отказными регрессиями и independent exact-source review, затем квалификация пакета и установка в пределах текущего поручения.

## Source checkpoint before CI

A03/A04/A05/A06 implemented in isolated worktree. A03 additive dispatch/queue order preserves long jobs during continuous arrivals; A04 safe storage covers both access panel and batch resume; A05 one scoped durable UUID plus Web Locks covers create and recovery; A06 total HTTP budget preserves bounded error bodies and does not replay unknown outcomes.

1074 current-runtime offline/loopback tests PASS, 0 skipped, 0 forbidden network attempts, 0 live provider calls. Local interpreter Python3.11rc1 is supplementary; release gate remains exact Python3.12/Node24.22.1 CI. The first two local failures exposed mock API drift and a lost HTTPError body, both fixed and rerun; no expected result was weakened.

Installed source ancestors 7afaf646(web/identity),73180172(admin),6098b313(platform) all belong to this base. Source preparation therefore retains the existing customer/password and staff/MFA flow. No live MFA/account mutation.

Alisa apt-get clean restored free disk from3226886144 to3546927104 bytes. Only reproducible OS package cache cleared. No release/account/DB removed.

Current status: SOURCE_TESTED, browser/backend CI pending, independent final review pending, NOT_INSTALLED.

## Concurrent source reconciliation

The current stores branch advanced to5dff6e8883e25ac464d6e8c64e4ab5a7280c70f7 during audit work. Its Seller qualification and AUTHENTICATED_UNLINKED change has been merged without discarding either branch. The new checker and its TLS tests were also incorporated into canonical products/alisa/runtime; existing security boundaries and the configured Seller qualification flag are preserved.

Publication fallback: ordinary server git push timed out, including one bounded55s HTTP/1.1 retry. Connected GitHub API published the identical tree b0e3c2c934637e394dd35e503b81cf6d6c0e9b96 as3aeb0c77; original local history retained. Draft PR #399 is the review/CI surface.

Resource follow-up: native hardlink dry-run preserving timestamps/ownership/mode/xattrs on inactive dependency trees projected only95.32KiB. No hardlinks applied. The earlier OS-cache cleanup retained every release and restored about305MiB. Installation admission must measure actual package/extraction/rollback requirements against3072MiB reserve.

# C-UE01 / COST-SELECTION-R01 — завершение проверки после обрыва

5 ноября 2026. Продолжение CUE01_SOURCE_PRODUCER_R01_PLAN, не новый независимый роадмап. Readback12:55:33UTC: установлен number-reason-r1, PID97710,46/46 hashes совпали. DS03 уже установлен12:22:29 и имеет точный temporary-worker результат FAILED/NUMBER_RANGE; повторной установки/перезапуска в этом проходе нет. Активный runtime, platform/UI/PG, credentials и квалификации не изменять.

## Восстановленный код

Git674ba11b17a888337589fd6f49b331f5f0b977bc: cost_source_selector.py, scenario_selection_adapter.py, cost_selection_catalog.json восстановлены в отдельном candidates/20261105-cue01-source-producer-r1. Получены точные public source bytes, hashes записаны в source-recovery.json. Старые S03/scenario88+66+8тестов и runtime dependencies взяты из закреплённых исходников. Упоминавшиеся119тестов завершённого producer не найдены как воспроизводимый пакет; не объявлять их подтверждёнными.

## Проверяемый контракт

Источник: tester-d391a4b1 r9, blob b1aeeacbde06860ef7f6076c0826816eb0bbc2cb. Приоритет matched actual→qualified API estimate→qualified official estimate. Пропуск записи не равен доказанному UNAVAILABLE и не даёт разрешения на замену. В расчёте сохранять по строкам основание и отдельные части смешанной суммы. Прямая сумма acquiring, явный процент commission, midpoint только из min/max, quantity и валюты не угадываются. Unknown cancellation stage не является ручным gate: предусмотрена owner-authorized return tariff estimate, отдельно от фактического списания.

## Задачи этого завершения

1. Независимый искусственный gold для двух сценариев, трёх товарных строк, смешанных actual/API/official. Сверить выбор/арифметику и затем реальную цепь selector→existing ScenarioBindings→две таблицы.
2. Негативные тесты hashes/revisions/currency/period/TTL/revoke/missing vs zero/quantity/cardinality/double-count. Подмена selection на границе adapter не должна превращаться в trusted expense; требовать проверку точного выбора по тем же evidence/policy и действующим правам.
3. Generic input contract и ограничение сложности/объёма. Никаких ветвей по названию площадки или C-UE01. Новый cost component/scenario через JSON без правок Python.
4. Сохранить исходные failure-логи, точные исправления, полный код, tests/fixtures, hash manifests и clean-extraction результат. Прежние tests не удалять ради PASS. Входной synthetic gold не выдавать за свежие рыночные суммы.
5. Живая квалификация допускается только если имеются полные нормализованные source receipts и лимиты; отсутствие producer/полноты означает конкретный блокер, а не synthetic READY на рабочем навыке. Этот слой сам не создаёт endpoint/issuer/фонового клиента и не подменяет общий ledger.

## Граница готовности

Без подключённого сбора фактов, полного expense coverage, qualified tariff/applicability evidence и существующего worker/voice adapter C-UE01 не добавлять в78активных. Три модуля/внутренние таблицы не новые голосовые шаблоны. Исполнитель тестера остаётся number-reason-r1; дальнейшая установка требует отдельного exact-release gate.

В конце:82/78/4 перепроверить, перечислить новые проверенные результаты и что ещё не установлено; следующий шаг — source normalizer/collector→тот же selector/scenario bridge; цель — две таблицы за свежий реальный период с provenance/ads/nonoverlap/omissions.

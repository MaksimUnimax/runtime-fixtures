# Общая доска тестера и автора матрицы

**Генерируется из BUGS.json, TEMPLATES.json, RUNS.json. Не редактировать статусы вручную здесь.**

Импорт: 6 кандидатов; 28 записей разных типов; 10 протоколов. Включённых импортированных кандидатов: **0**.
Текущий каталог: **82 реализовано / 78 включено**. Шесть импортированных CASE не являются размером всего каталога. [Точная версия и ограничения](CATALOG_PROGRESS_CURRENT.json).


## Кандидаты

| ID | Название | Этап | Зависимости | Блокеры |
|---|---|---|---|---|
| ozon_customer_realization_prices | Цена покупателя по товарам, дата начисления | TRIAGED | — | SRC-OZON-ACCRUAL, AXIS-ACCRUAL, MONEY-LINE-UNIT, RUNTIME-CATALOG, DIALOGS-RETEST |
| ozon_daily_customer_price_and_volume | Дневные количества и средняя цена реализации | TRIAGED | ozon_customer_realization_prices | SRC-OZON-ACCRUAL, GROUP-DAY-SKU, WEIGHTED-MEAN, DIALOGS-RETEST |
| ozon_payment_methods_v1 | Разбивка реализаций по способам оплаты | TRIAGED | ozon_customer_realization_prices | SRC-OZON-POSTINGS, QUALIFIED-JOIN, PAYMENT-UNKNOWN, DIALOGS-RETEST |
| realization_price_bands_and_thresholds | Ценовые диапазоны и исследовательские пороги | TRIAGED | ozon_daily_customer_price_and_volume | GENERAL-STATISTICS, INDEPENDENT-NUMERICAL-GOLD, NONCAUSAL-LABEL, DIALOGS-RETEST |
| ozon_daily_yoy_seasonality_v1 | Октябрь/ноябрь по дням, год к году | TRIAGED | — | SRC-OZON-POSTINGS, SIGNED-ACCRUALS, MOSCOW-BOUNDARIES, EQUAL-COMPLETED-PERIODS, DIALOGS-RETEST |
| ozon_customer_price_by_order_date_v1 | Стоимость реализации для покупателя по дате заказа | CANDIDATE | ozon_customer_realization_prices | ORDER_AXIS_QUALIFICATION, EXHAUSTIVE_SOURCE_JOIN, INDEPENDENT_SOURCE_GOLD, GENERAL_RUNTIME_BINDING, YANDEX_DIALOGS_RETEST |

## Дефекты и наблюдения

TRIAGED означает разбор материалов, не повторную проверку текущего сервиса. Исторический исход хранится отдельно.

| ID | Тип | Severity источника | Наблюдение | Исторический исход | Сейчас | Точная прежняя проверка |
|---|---|---|---|---|---|---|
| INFRA-001 | RESEARCH_TOOLING | UNSET | на сервере нет `rg`; один read-only поиск завершился FileNotFoundError. Продолжено чтением нужных файлов через Python. На результат запроса Ozon и состояние сервиса это не повлияло | RESOLVED_OR_WORKAROUND_REPORTED | TRIAGED / NOT_RUN | — / — |
| INFRA-002 | RESEARCH_TOOLING | UNSET | первый вариант полной SKU-календарной сетки был тяжёлым при создании файла. Для пользовательского товарного листа оставлены 377 наблюдений SKU-день с реализациями; все 31 календарн | RESOLVED_OR_WORKAROUND_REPORTED | TRIAGED / NOT_RUN | — / — |
| INFRA-003 | RESEARCH_TOOLING | UNSET | предварительное отображение дат показывало ISO timestamp, затем Excel serial при формате dd.mm.yyyy. Исправлено на числовые даты Excel с форматом yyyy-mm-dd; все четыре листа повто | RESOLVED_OR_WORKAROUND_REPORTED | TRIAGED / NOT_RUN | — / — |
| INFRA-004 | RESEARCH_TOOLING | UNSET | дополнительная проверка ZIP сначала предполагала xl/charts/chart1.xml и получила KeyError; фильтр того же каталога не нашёл диаграмму. После инвентаризации проверен фактический xl/ | RESOLVED_OR_WORKAROUND_REPORTED | TRIAGED / NOT_RUN | — / — |
| INFRA-YOY-001 | RESEARCH_TOOLING | UNSET | / INFRA-YOY-001 / Локальная запись проекции / Попытка удалить и добавить один путь в одном apply_patch отклонена / Выполнен обычный update существующего файла; ни одного нового биз | RESOLVED_OR_WORKAROUND_REPORTED | TRIAGED / NOT_RUN | — / — |
| OZCP-001 | BUG | P2 | Подсказка про WB для запроса цен Ozon | OPEN | READY_FOR_RETEST / NOT_RUN_CURRENT_BUILD; VERIFIED_DIALOGUE_FIXES_R1 | 20261105-v010-dialogue-fixes-r1 / PASS |
| OZCP-002 | CAPABILITY_GAP | P1 | Не подключена цена реализации по товарным строкам | OPEN | TRIAGED / NOT_RUN | — / — |
| OZCP-003 | BUG | P2 | Вместо объяснения выдан только LLM_CLARIFY | OPEN | TRIAGED / NOT_RUN | — / — |
| OZCP-004 | PROVIDER_FORMAT | P2 | commission_ratio не является денежным числом | OPEN | TRIAGED / NOT_RUN | — / — |
| OZCP-005 | PREVENTED | P1 | sale_price ошибочно можно умножить на quantity второй раз | PREVENTED | TRIAGED / NOT_RUN | — / — |
| OZCP-G001 | ACCEPTANCE_RULE | UNSET | различать дату начисления, заказа и фактического выкупа. Не выдавать смену временной оси за поддержку исходного вопроса «проданы вчера». | REQUIREMENT | TRIAGED / NOT_RUN | — / — |
| OZCP-G002 | ACCEPTANCE_RULE | UNSET | quantity>1 не проверен. Сначала выяснить line-vs-unit смысл суммы; не делить/умножать автоматически по примеру с quantity=1. | REQUIREMENT | TRIAGED / NOT_RUN | — / — |
| OZCP-G003 | ACCEPTANCE_RULE | UNSET | возвраты, нулевая цена, разные валюты, неполная/повторная пагинация требуют отрицательных тестов и отдельной живой квалификации. | REQUIREMENT | TRIAGED / NOT_RUN | — / — |
| OZCP-G004 | ACCEPTANCE_RULE | UNSET | дневная текущая цена карточки не заменяет историческую цену конкретной продажи. | REQUIREMENT | TRIAGED / NOT_RUN | — / — |
| OZCP-G005 | ACCEPTANCE_RULE | UNSET | совпадение арифметических компонентов и HTTP 200 не являются сверкой с кабинетом или чеком. | REQUIREMENT | TRIAGED / NOT_RUN | — / — |
| OZPAY-001 | CAPABILITY_GAP | UNSET | Для способа оплаты требуются метаданные отправлений | RESEARCH_ONLY | TRIAGED / NOT_RUN | — / — |
| OZPAY-002 | PREVENTED | UNSET | bank_coinvestment не определяет Ozon Карту | PREVENTED | TRIAGED / NOT_RUN | — / — |
| OZPAY-003 | ACCEPTANCE_RULE | UNSET | Неизвестная метка оплаты должна остаться unknown | REQUIREMENT | TRIAGED / NOT_RUN | — / — |
| OZPAY-004 | LIMITATION | UNSET | Разница средних не является скидкой той же покупки | LIMITATION | TRIAGED / NOT_RUN | — / — |
| OZYOY-001 | RESEARCH_FIX | UNSET | Отрицательная строка начисления отвергалась | FIXED_IN_RESEARCH_NOT_DEPLOYED | TRIAGED / NOT_RUN | — / — |
| OZYOY-002 | PROVIDER_ERROR | UNSET | Историческая аналитика вернула HTTP400, причина неизвестна | FALLBACK_RESEARCH_ONLY | TRIAGED / NOT_RUN | — / — |
| OZYOY-003 | PREVENTED | UNSET | Дата начисления не заменяет дату заказа для спроса | PREVENTED | TRIAGED / NOT_RUN | — / — |
| OZYOY-004 | PREVENTED | UNSET | Будущие даты не должны выглядеть нулевыми продажами | PREVENTED | TRIAGED / NOT_RUN | — / — |
| OZYOY-005 | RESEARCH_FIX | UNSET | Неверные служебные счётчики проекции/reused | FIXED_IN_RESEARCH | TRIAGED / NOT_RUN | — / — |
| OZYOY-006 | RESEARCH_FIX | UNSET | Подпись 01.10 превращалась в число в Excel | FIXED_IN_RESEARCH | TRIAGED / NOT_RUN | — / — |
| OZYOY-007 | PROVIDER_FORMAT | UNSET | Money и строковая цена FBO/FBS требуют разных проверок | QUALIFIED_IN_RESEARCH | TRIAGED / NOT_RUN | — / — |
| OZYOY-008 | RESEARCH_FIX | UNSET | UTC-группировка расходилась с московскими днями | FIXED_IN_RESEARCH | TRIAGED / NOT_RUN | — / — |
| DS03 | BUG | P2 | NUMBER_RANGE терялся при декодировании источника | REPRODUCED | READY_FOR_RETEST / INDEPENDENT_SOURCE_PASS_772a_RUNTIME_IDENTICAL_06f3; FULL_SAFETY_AND_LIVE_NUMERIC_NOT_RUN | — / — |

## Исходные журналы

| Журнал | Тип | Сборка | Значение |
|---|---|---|---|
| docs/alisa/browser-testing/OZON_CUSTOMER_PRICES_BUG_LOG_2026-11-04.md | RESEARCH | SEE_SOURCE | Источник; не приёмка текущего выпуска |
| docs/alisa/browser-testing/OZON_DAILY_PRICE_VOLUME_2026-10_RUN.md | RESEARCH | SEE_SOURCE | Источник; не приёмка текущего выпуска |
| docs/alisa/browser-testing/OZON_PAYMENT_METHODS_2026-10_RUN.md | RESEARCH | SEE_SOURCE | Источник; не приёмка текущего выпуска |
| docs/alisa/browser-testing/OZON_YOY_OCT_NOV_2025_2026_RUN.md | RESEARCH | SEE_SOURCE | Источник; не приёмка текущего выпуска |
| docs/alisa/browser-testing/CLOUD_CONSOLE_SEVEN_TESTS_2026-11-04.md | HISTORICAL_CONSOLE | build8 | Источник; не приёмка текущего выпуска |
| docs/alisa/browser-testing/CLOUD_CONSOLE_REQUEST_TIMINGS_2026-11-04.md | HISTORICAL_CONSOLE | build8 | Источник; не приёмка текущего выпуска |
| docs/alisa/browser-testing/BROWSER_DESKTOP_2026-11-04.md | INFRA_HISTORY | SEE_SOURCE | Источник; не приёмка текущего выпуска |
| docs/alisa/quality/inbox/20261105-TESTER-3f3405f9/OZON_CUSTOMER_PRICE_BY_ORDER_DATE.md | DOCUMENTATION_CANDIDATE | DOCUMENTATION_ONLY_NOT_INSTALLED | PASS_SCOPE_DOCUMENTATION_ONLY; не приёмка текущего выпуска |
| docs/alisa/quality/inbox/20261105-TESTER-d7a5899c/RUN_REPORT.json | HISTORICAL_LIVE_DIALOGS_RETEST | 20261105-v010-dialogue-fixes-r1 | PASS; не приёмка текущего выпуска |
| docs/alisa/quality/inbox/20261108-AUDIT-DS03/RESULT.json | INDEPENDENT_TARGETED_SOURCE_RETEST | 772a2adc2dc98cfd8642407b0821135ec6577c2e | PASS; не приёмка текущего выпуска |

## Следующий пакет

Следующий исполняемый пакет и его зависимости определяет [актуальный README](README.md). Эта доска не назначает прежний RT-CAT вместо текущей работы. READY_FOR_RETEST требует отдельной проверки указанной версии; прежние PASS не переносятся на новый выпуск. Исторические FAIL и числовые PARTIAL/SKIP сохраняются. Никаких новых HTTP ради переоформления журналов.

# WB-COVERAGE / S03-R01 — план до исполнения

05.11.2026. Поручение владельца «Делай» после включения B05/payment-join. Зона только runtime/matrix/собственные QA-документы. Не менять платформу, UI, issuer, PostgreSQL, исходные отчёты тестера и действующий релиз ради диагностики.

## Точная база

Readback 07:27:35 UTC: active `20261105-v010-matrix-join-r1`,45/45 файлов совпали, manifest27c03b86db8b0b7f7b3ba871e464971004c0fe3dba0f9e49c6abbc83dacef09d; config92702c1136ebd0d785ef2b1b76c9d7873761076478e568df739e7d4635b252b5. Active jobs0, quick_check=ok. Предыдущая точка82 определений/78 включено/4 WB выключено. Их счёт не увеличивается исследовательскими вызовами или новым общим модулем.

## WB: устранить неизвестность, не обойти полноту

Предыдущая Q01 выборка21 active/paused кампании за03–04.11 вернула18,3missing. Новые запросы: максимум5 физических read-only HTTP, один ограниченный diagnostic job через штатный transport+общий reserve/rates/ledger, не новый provider-клиент. Все raw данные только в памяти, в evidence counts/hashes/обезличенные M01…M03 и даты/статусы. Не менять source qualifications live и не выставлять0 вместо отсутствующего значения. UNKNOWN/429/401/403 не повторять автоматически.

Порядок: актуальный promotion/count → fullstats21/текущая группа9/11 за03–04ноября → details только выбранных/пропавших ID, максимум50. Если нужны различающие проверки: отдельный запрос пропавших ID за тот же период (не retry UNKNOWN) и за один предыдущий завершённый интервал<=31дня. Общая граница5, deadline180сек. До чтения ключей проверять актуальный scope и manifest. Защищённые systemd credentials под alice-market; старый web/worker не перенастраивать.

По официальной WB-документации https://dev.wildberries.kg/docs/openapi/promotion: fullstats поддерживает7/9/11, максимум50ID и31день; campaign details `/api/advert/v2/adverts` содержит timestamps. Из доступной документации НЕ следует, что отсутствующий ID означает нулевые расходы. Рабочий endpoint остаётся .ru, регион и токены не переключаются. Прямой .ru documentation fetch вернул498; .kg официальный docs доступен. Метаданные ранее использовались исследовательским сборщиком; перед новым вызовом проверить его сохранённый path/schema, а не выдумывать endpoint.

Дата создания после конца отчётного периода может обосновать «не существовала в периоде», но не нулевой полныйstats по любому иному случаю. Поздний started/updated или текущий статус не доказывает отсутствие показов в прошлом. Недостаточно данных — блокировка остаётся с точной причиной.

## S03: входные данные для C-UE01

Перечитан TEMPLATE_CANDIDATE.json TESTER-d391a4b1 revision automatic-cancellation-return-tariff-fallback-r9, blob b1aeeacbde06860ef7f6076c0826816eb0bbc2cb. Его scope и fallback не заменяются более ранними предположениями. COGS берётся у владельца, не prices.net_price; отсутствующий налог/себестоимость помечаются, не становятся0. Unknown physical stage не должно блокировать разрешённую владельцем tariff estimate, но actual/estimate различаются. Этот проход не объявляет весь C-UE01 реализованным.

Подготовить отдельный общий bounded resolver версионированных numeric owner facts: declared field/type/unit, tenant/store/product/date scope, immutable revision+hash, explicit VALUE/EXCLUDED/NOT_PROVIDED, trusted verifier и freshness. Без UI/своего issuer, без записи liveDB. Матрица задаёт виды входов и единицы. Нельзя смешивать разные магазины, валюты, per-physical-unit и per-ordered-unit; неоднозначные/перекрывающиеся версии отклоняются. Даты изменения не переинтерпретируют уже закреплённый план; неизвестное не0. Текущий manifest и проверяемый тестером навык остаются прежними.

Приёмка: негативные schema/rights/expiry/overlap/currency/units/revocation, independent synthetic values, JSON-only добавление нового вида входа без правки Python; применимость к существующему report completeness gate, без выдачи фальшивого READY. Сохранять код/тесты/manifest/first failures и точный replay в отдельном пакете. В конце — обновить текущие счётчики, отдельные source/runtime/tester статусы и обязательный мини-отчёт.

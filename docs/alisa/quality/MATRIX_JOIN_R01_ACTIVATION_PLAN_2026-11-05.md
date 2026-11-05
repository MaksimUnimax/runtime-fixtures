# MATRIX-JOIN-R01 — точное включение девяти определений

05.11.2026. Прямая команда владельца «Делай» после предложения включить проверенные B05/join и оставить неполный WB fullstats закрытым. Область: только runtime/matrix, собственная конфигурация qualifications и QA. Platform/UI/issuer/PostgreSQL/OAuth/чужие locks не менять.

## Исходная точка до изменений

Readback 06:38:57 UTC: активная `20261105-v010-dialogue-fixes-r1`, MainPID53771, active; manifest44/44 SHA совпал, SHA256 cbf16b0488801eb692b3402d117707c51819c6bf07175e6f84999ec1091e3c16. Кандидат `20261105-v010-matrix-join-r1`, manifest45/45 совпал, SHA256 27c03b86db8b0b7f7b3ba871e464971004c0fe3dba0f9e49c6abbc83dacef09d. Config SHA256116fc64c60907de9bcd372f0c4aaffc2b7a421b4c1d32281d72795de65e6c96f. Active jobs0, pending0, SQLite quick_check=ok, доступно5.1GiB. Независимые N06/N08/N09 VERIFIED, прежние PARTIAL/SKIP сохраняются.

Основание: MATRIX_JOIN_R01_ACCEPTANCE и JOIN_NUMERIC_Q01_ACCEPTANCE. Q01 выполнил16HTTP200; источники/декодеры/пять соединений проверены отдельным алгоритмом на выборке03–04ноября,29/29строк сопоставлены. WB21запрошено/18получено/3пропуска — допуск не давать. Числовая проверка того же API не называется кабинетной сверкой или независимой внешней приёмкой нового релиза.

## Точный scope

Включаются4 B05-представления: accrual_items, accrual_days, accrual_items_days, accrual_price_lines;5 payment-join: realization_payment_lines, realization_payment_totals, realization_payment_days, realization_payment_items, realization_payment_items_days.

Добавляются только4 source operations для существующего Ozon-магазина: ds_ozon_accrual_rows, ds_ozon_accrual_join_rows, ds_ozon_fbo_join_items, ds_ozon_fbs_join_items. Для трёх join bindings требуется posting_product_join_qualified=true с привязкой к Q01/точному candidate. Статус READ_ONLY_CANARY, не PRODUCTION_VERIFIED. Старые6 dataset-допусков сохраняются; их hashes обновляются лишь после побайтового сравнения соответствующих recipe/query определений. Scalar/table qualifications, account/store/access revisions, credential bindings и ключи неизменны.

WB ds_wb_campaigns и ds_wb_adstats не включать ни в qualifications, ни в dataset_capabilities. Все4 WB-кампанийных определения должны оставаться отвергнутыми. Старый рекламный расход и остальные работающие показатели не выключать.

## До и при установке

Заново выполнить полный source-manifest regression1035 + отдельные57/70 и JSON-only. Проверить config proposal через реальные Configuration/Engine на временной SQLite:9 новых query разрешены,3 прежних dataset определения сохранены,4 WB query запрещены, ошибки N06/N08/N09 неизменны, чужая площадка/неполный допуск отвергаются. Подготовить bounded проверку действующего gateway.

Для установки использовать собственный flock и проверить конкурирующий runtime flock без его перезаписи. Повторно подтвердить exact ExecStart/manifest/config/0active/0pending. Остановить только alice-market; повторить idle-check; приватная SQLite backup и hash исходного config. Атомарно записать только проверенный config, создать один отдельный последний systemd drop-in на проверенный candidate. daemon-reload/start, readback path/PID/socket/config hash. Миграций БД нет. Не менять исходники принятого candidate ради установки.

Если новый сервис не готов — удалить только свой drop-in, вернуть config только при совпадении с нашим after hash, запустить прежний hotfix. SQLite поверх новых сообщений не восстанавливать. При стороннем config/source изменении остановить собственное изменение и сохранить точную причину, не force overwrite.

## После установки

Проверить9 новых запросов через штатный web UID/gateway, полные страницы, complete/enrichment_complete/coverage, точные повторы без новых HTTP; дополнительно сохранённые N06/N08/N09 и блокировку всех4WBопределений. Период smoke04.11.2026; не запускать месяцы ради приёмки. Общая граница до64 новых физических business HTTP, не более300сек наблюдения; ledger/квоты неизменны. UNKNOWN не повторять; при лимите честный INCOMPLETE. Можно повторно отрисовать остальные представления на том же complete dataset как дополнительную offline-сверку, но не называть это отдельным новым live-заданием.

Реальные ответы/внутренние IDs не публиковать в Git. Сохранять безопасные counts/hashes/HTTP/timings. Внешние Яндекс-сценарии остаются NOT_RUN до тестера. Бизнес-полнота источника и полнота join — разные свойства; unmatched не терять и не называть «без карты».

Итог: exact release/config/manifest, сколько из9 реально прошли, неизменность платформы, счётчики82 реализовано/ожидаемо78 включено/4не включено (проверить программой, не заранее PASS), оставшиеся6функциональных направлений сверх этих4, следующий шаг и пакет тестеру с полным ответом/временем.
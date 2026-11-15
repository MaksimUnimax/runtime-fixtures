# R15: независимая проверка исправленного исходника

15 ноября 2026. Статус: **SOURCE_APPROVE в указанном объёме**. Установленная синтетическая и живая пользовательская приёмка не выполнены. Пакет на настоящих базах пока не собран; доступное место проверяется отдельно от качества исходника.

## Продукт и исправление срока RPC

Автор полного native parent и его сквозных сценариев — root; независимая проверка этих изменений и границ пакета выполнена `repo_state`. Изменения `economics_query.py`, `owner_data/service.py` и проверок Query подготовлены `repo_state`; root независимо проверил отличие от прежнего исходника и полный контракт структурной проверки. Отдельная проверка финансовых формул, источников, точности Decimal и численного oracle выполнялась `formula_sources`.

Проверенные границы:

- Размер одного private RPC сообщения уменьшен с 64 до 8 уникальных пар SKU/день. Общий размер отчёта не ограничен восемью. Проверены границы 0, 1, 7, 8, 9, 64, 65 и 129; все пары попадают ровно в один пакет.
- Каждый вызов `source.current()` сохраняет текущие проверки сессии, прав, credentials, approval, принадлежности и фактов. Двухсекундный RPC deadline не изменён, кэш полномочий не добавлен.
- Повторная полная структурная валидация одного owner payload для каждой entity заменена одним полным проходом. Проверка `_validate` рассматривает весь payload независимо от запрошенной entity; внешние проверки каждого mapping/entry и его принадлежности сохранены. Добавлены шесть отрицательных примеров для строк вне выбранного запроса.
- Сценарий 65 SKU сохранён и усилен большим допустимым набором owner data. Отдельная гонка заполнения второго пакета использует 9 SKU, чтобы сохранить ровно два пакета при новой границе 8. Ручное значение сохраняет приоритет, source/ref/cache и revision fences проверяются прежними утверждениями.
- Исправлен только прежний ошибочный тестовый oracle обработки FBS: `(0 + 5) / 2 = 2,5`. Численные итоги полного Worker сверены отдельно от статуса READY. Формула продукта ради изменения oracle не менялась.

Точные хеши шести проверенных Python-файлов и исходные квитанции содержатся в `SOURCE_QUALIFICATION.json`. Повторно прошли 683 базовые проверки и все 71 проверка compound-набора. Прежние два отказа на коммите `22c9749…` сохранены в доказательствах; зелёный статус им задним числом не присваивается.

## CI

Разделение compound-набора использует полный отсортированный inventory, непересекающиеся группы и сравнение запланированных с фактически исполненными ID. Ни одна проверка не удалена или пропущена. Новый шаг проверки сборщика использует тот же locked virtualenv, что и остальные source gates; воспроизведённый отказ системного Python без `cryptography` устранён выбором правильного интерпретатора, а не отключением native probe.

Проверенная `.github/workflows/alisa-platform-ci.yml`: `1657a92a584990ab6c1a78a31970e2a766aa7f02024a80d85fcb0a25f3233eda`. Новый коммит должен пройти собственные GitHub workflow runs. Эта source review не заменяет их.

## Сборщик неизменяемого пакета

Автор — `orders_source`, независимый reviewer — `formula_sources`. Финальная независимая проверка: **38/38 PASS** в 4,203 с, включая 32 авторских теста и 6 дополнительных проверок reviewer; ошибок и пропусков нет. Работа выполнялась на disposable файловых деревьях, без production-вызовов.

| Файл | SHA-256 |
|---|---|
| `build_candidate.py` | `5eb7edba9444eb4d14303fae9e550b24f14e30b99401d8422e21321df720d683` |
| `release_contract.py` | `2fcb1d7f31e1c9ed379438e7ca08550ee8397321fed8d01fca321c75bd49aa73` |
| `compatibility_review.json` | `2275c90841546b543f883739c76f885b9ff05224003f677ccca5517c6f164c28` |
| `tests/test_builder.py` | `e16021b53594bcc1d5adcf26a4239db855a377f335e253f1299e13b80668b300` |
| `baseline_20261115.json` | `7354bd67b561276fd3d30e9dcea5cc09dd57cfea86ca9c4d4bf398cc892c1e35` |
| `inspect_native.py` | `e310616f618ee63ca27372404e0f6639d01e4235975d0ae35f1aec5921d5a3e7` |

Первоначальный дефект проверки транзитивных зависимостей воспроизведён независимым reviewer и устранён. Теперь план фиксирует 96 source inputs; 59 сохраняемых platform-файлов сравниваются отдельно для platform и authority, ещё 5 — для native support. Проверены 118 сочетаний role/path и 5 native mismatches. `parameter_resolution.py` проверяется с учётом того, что native копирует финальный исходник, а platform/authority сохраняют базу.

Обнаруженный затем обход через `from package import module` также воспроизведён и закрыт. Шесть обычных форм импорта и wildcard не позволяют незаявленной проектной зависимости пройти проверку. Совместимость повторно проверяется после native prepare, непосредственно перед публикацией.

Root отдельно сопоставил полные отличия четырёх заменяемых файлов с реально установленными исходниками: только два выключенных по умолчанию флага, WEB-only `remember()`, маршрутизация `report_*` внутри существующего private RPC и уже рассмотренное устранение повторной структурной проверки. Голосовая ветка continuation сохранена.

Три точных role/path исключения сохраняют два уже принятых файла: более поздний `accounts/views.py` только у platform и установленный `staff/policy.py` у обеих ролей. В `compatibility_review.json` записаны обе SHA каждого сочетания; исключение не распространяется на будущие версии файла. Сохранение действующей staff policy не означает введение новой политики этим изменением. Путь R15 использует customer WebSession.

Проверены независимые копии без writable hardlinks, запрет изменения баз, публикация с `RENAME_NOREPLACE`, отказ при существующем результате, точные source/base/CAS guards, inventory/core manifests, read-only native import probe и граничное условие обязательного резерва inode. Инструмент не выполняет активацию, миграцию, рестарт, изменение флагов, доступ к БД или provider-вызовы.

## Следующие границы

Для настоящего пакета нужны достаточные ресурсы, точный опубликованный source commit и повторная свежая проверка баз. Затем отдельно проверяются пакет, установленный сценарий, текущая квалификация owner data и согласованное окно browser-приёмки. Полная композиция в этом исходнике допускается только для WEB Query. Голосовое право `reports:read` не превращено в право записи коэффициентов.

## Уточнение после проверки настоящего окружения

Коммит `888cf0aaf10b22a689fca26241beac1ae197be83` завершил Documentation CI `43702548285` и полный source workflow `43702548307` успешно. Все семь специализированных задач исполнили 998 тестов с одинаковым точным checkout, без ошибок, пропусков или внешних подключений. Квитанции находятся в `EXACT_CI_888cf0a.json`. Это доказательство указанного коммита; последующие изменения инструментов должны пройти собственный CI.

Первый настоящий read-only PLAN остановился на `LIVE_SERVICE_BASE_CHANGED:web`. Причина — ошибочное требование одинакового рабочего каталога systemd и web-процесса. Действующий service использует `web-current`, разрешающийся в корень прежнего release, а процесс работает в его `ui/web/apps/web`. Все четыре release manifest и current pointers остались прежними. Изменений работающих служб не было.

Сборщик теперь отдельно и точно проверяет `unit_cwd_suffix` и `process_cwd_suffix`; обе координаты сохраняются в PLAN/CAS. Для web это корень и `ui/web/apps/web`; для остальных ролей сохраняются подтверждённые одинаковые каталоги. Неверный соседний или вложенный каталог не принимается. Независимое review: 38/38 PASS (35 авторских и три независимых проверки с настоящими `/proc` и symlink). Исправленный builder SHA256 `68f502a20d4f869a7d6e0bd81dab37e174693cd1a673ded195331a832cf47839`, baseline `1644351c664b3f2550d0e9fec67a7a60f499b91aa530f64041cef46f82624a51`, tests `534739b9b2ee459e401754c27e62d5f296c614d24e6d9479c6e1e70b28e7d8cd`. Все 96 продуктовых source inputs неизменны. Повторный настоящий PLAN фиксируется отдельно; он не является build или install.

Метаданные владельца проверяет отдельный ограниченный helper из `economics_composite_r15_preflight`, не входящий в release overlay. Две первые попытки остановились до Django и БД: первая — на неправильной передаче нескольких EnvironmentFile одним аргументом; вторая — на потере младших цифр наносекундных timestamp при прежнем переносе JSON через JavaScript Number. Первое исправление подтверждено настоящим конечным systemd probe на двух несекретных файлах. Для второго все 32 старых timestamp точно воспроизведены через `JSON.stringify(Number(exactString))`; остальные 96 stat-полей совпали. Новая запись и сравнение используют точные десятичные строки и отвергают даже изменение на 1 нс. Изменение реальной конфигурации или ослабление её проверки не использовалось.


## Фактический PLAN и метаданные владельца на 938f708a

Исправленный read-only PLAN завершился успешно 15 ноября 2026 в 10:26:45 UTC для commit `938f708aecb1be4736274d5d5cf9cf77bfdcfc33`. Проверены 96 source inputs, пять инструментов, четыре действующие release bases/current selectors и точные каталоги systemd/процессов. SHA-256 полной квитанции: `514fa806d1647aec0ecfaff28b55c05443e7fc7a52bcef900db3aea980bac19f`. Статус — `PLAN_NOT_BUILT`, `deployed=false`. Эта квитанция относится только к названному исходнику и не переносится на последующие изменения.

Ограниченный read-only helper завершился в 10:28:51 UTC; безопасная квитанция находится в `OWNER_METADATA_938f708a.json`. Владелец, membership, магазин, идентичность, approval, security revision и catalogue metadata согласованы. Seller имеет `CONNECTED`; Performance — `CONNECTED_NATIVE_OWNER`. Поэтому проверка совместимости с обычным строгим `DjangoOwnerSource` вернула `METADATA_BLOCKED`. Факты владельца и секреты не читались, application writes не выполнялись. Полнота SKU/day данных и право исполнения остались `NOT_CHECKED`/`false`.

История принятого native-owner пути проверена отдельно: `AL_S05_NATIVE_PAIR_20261108.md` на commit `5fabadafa3b7458dc3680a3e23e83b3f52da67a8`, контракт `products/alisa/contracts/runtime/store-check-v1.md` и `docs/alisa/quality/RUNTIME_STORE_ENROLLMENT_2026-11-13.md` на `888cf0aaf10b22a689fca26241beac1ae197be83`. Уже принятая native-пара не требует нового приложения, OAuth или повторного ввода ключа только из-за этого кода. Проверка native PID/start ticks/UID/boot и source HMAC принадлежит setup/enrollment и generation refresh; `RuntimeAuthority.resolve` её заново не выполняет. Текущая authority проверяет точную действующую привязку и credential IDs/revisions, а существующие native broker/HTTP guards ограничивают фактические provider calls. Эти разные доказательства нельзя подменять одним сохранённым статусом.


## Узкая совместимость Query с принятой native-owner Performance

Автор четырёх product-файлов — `repo_state`; root и `formula_sources` независимо дали **SOURCE_APPROVE** точным версиям ниже. Обычный `DjangoOwnerSource` получил только private predicate с прежним сравнением `check_code == CONNECTED`; его текущие проверки и запросы не изменились. Единственная специализация находится в `_QueryOwnerSource` и допускает native-owner только при `kind == PERFORMANCE` и таком же kind строки. До неё `_actor_store` выполняет полный `_node`/`RuntimeAuthority.resolve`, блокирующий Store и active credential rows и сравнивающий полный набор kind/id/revision с текущей platform-привязкой в той же транзакции. Прежняя проверка после owner read сохранена. Вторая авторизация для каждого credential, кэш прав и отдельный доступ к native secrets не добавлены.

Фиксированное правило `query-runtime-native-owner-performance/v1` закреплено существующими `report_rule_hash` и principal `report_catalog_hash`. Descriptor grammar не расширена. Сырые check codes остаются в owner scope hash; новый допуск не превращает изменение provenance в неизменный checkpoint. Generic и owner-ticket потребители остаются строгими. Native generation/setup proof и provider guards не подменяются metadata или Query authority.

| Файл | SHA-256 |
|---|---|
| `owner_data/source.py` | `405996d2678ebdd9cb0eb743e0b42affb16bc4521f1b752357ffe862b5280cbf` |
| `owner_data/economics_query.py` | `8a675f9499133352400f3f38b33ead4b819343eb9dbc2618e1c6546e8e22288f` |
| `owner_data/parameter_report_catalog.json` | `bd26e0d679df0bf34cb881d1da5c9d9552114aa72665c684fde8a8500b19b015` |
| `tests/economics_cohort/test_query_current.py` | `7266ed1c00649a64c6200a15443206fc3cc5e02c13d84e163cfb3d0ed15ff597` |
| `tests/parameter_compound/test_composite_worker.py` | `5890f3e1a8cbf7f559e377239e169ece80efad1453ec34ed9224e30c2ce0c4c3` |

Автор изменения Worker-проверок — root; независимый **SOURCE_APPROVE** от `repo_state` относится к указанному `5890…`. Прежний численный пример CONNECTED сохранён. Большой 65-SKU сценарий теперь также проверяет native-owner по настоящему Query/RPC/Worker, сохраняя размер payload, девять пакетов и существующий deadline. Два новых сценария требуют отказа до provider IO для native-маркера у Seller и отказа перед model answer после отзыва Performance уже на `_answer_pending`, без повторного provider IO или записи коэффициентов.

Focused Query-файл содержит 50 проверок: scoped native positive и current/fence, строгие generic/Ticket negatives, неверный Seller/unlinked code, чужая credential identity, missing/duplicate/revoked/pending/revision drift, ALICE/tampered/old/producer references, потеря session/access/approval, fixed policy и изменение provenance. В нём остаётся реальная PostgreSQL-гонка между первой проверкой сессии и её блокировкой. Source/AST review не объявляет эти проверки исполненными: новый точный коммит должен пройти обычный GitHub PostgreSQL/native workflow. Повторный remote fixture run не запускался при недостаточном резерве `/dev/shm`; изоляция и резерв не ослаблялись.

Сборщик включает `source.py` как пятую точную замену в обе platform-роли, вместо сохранения старого файла. Набор 96 source paths не изменён; сохраняемых зависимостей теперь 58. Пятый review tuple фиксирует исходную установленную версию `717811b6…` и принятую `405996d2…` отдельно для platform и authority. Первые четыре replacement records и три preservation exceptions не менялись. Финальные SHA: contract `48a7f0ebb53213e38b188af169fab54f6101ccadf478200f1770b36a31198633`, compatibility review `a6f8eecbb603b82afa578de626df4f1e9af02250434df9a19b58efbbab3dc97a`, tests `7bb5f17d8ce2e6eefbeca0c4ed7b6c7da77db78c11528790228fc326da2b7ac9`. Авторский полный gate: **36/36 PASS**, 3,259 с. Root независимо проверил diff и исполнил три затронутые границы: обе platform-копии, exact replacement CAS и настоящую source prepare/catalog/probe цепочку — **3/3 PASS**, 1,048 с. Это подмножество авторского набора, не дополнительные уникальные тесты.

Новый исходник требует собственного реального PLAN и exact CI. Прежний успешный PLAN на `938f708a` не распространяется на эти три изменённых product input и два инструмента. Build, установка, текущая runtime-приёмка владельца и согласованное browser-окно остаются отдельными этапами.

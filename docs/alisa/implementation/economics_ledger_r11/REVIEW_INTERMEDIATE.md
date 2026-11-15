REQUEST_CHANGES

**Контрпример в routing:** [suite_routing.py](../../../../products/alisa/tests/suite_routing.py#L29) использует `Path.rglob('test_*.py')`. Рекурсивный обход `pathlib` не заходит в каталоги, являющиеся симлинками. Поэтому, например, `economics_ledger/nested_link/test_future.py`, где `nested_link` — симлинк на каталог с тестом, не попадёт в точный module inventory и не вызовет отказ. Новые проверки покрывают обычные вложенные каталоги и неизвестный непакетный каталог, но не этот случай. Для заявленной полноты routing нужно либо учитывать такие каталоги, либо явно отклонять симлинки в тестовом дереве.

Остальные изменения в просмотренном diff выглядят согласованными: `EXTERNAL` сверяет точные наборы модулей; каталог запускается отдельным существующим CI-шагом; `runtime_client` явно помечен `NOT_RUN`; нулевой результат специализированного suite теперь не даёт `PASS`. Тест дублирующего receipt теперь доходит до целевого guard с доверенным callback.

Diff затрагивает только два routing-файла, квалификатор suite и тест accruals. Production economics-accruals, source-leaf и manifest guard в этом diff не менялись; в просмотренном исходнике сохранены ограничения на provenance/privacy и отказ заявлять original economics без доказательств.

Рассмотрен точный HEAD `cb6859a3906c6117b42a2ac08447093efd02c4ad`. Тесты, full CI и live-проверки не запускались. Это source review: original nature/parent proof не подключён, нового пользовательского full-economics compile нет, full CI/live — **NOT_RUN**.

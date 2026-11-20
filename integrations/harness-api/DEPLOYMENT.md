# Harness — результат обновления 18 ноября 2026

## Рабочий выпуск

**Опубликовано и включено:** https://alisa.octoport.ru/harness/

Переключение выполнено 18 ноября 2026 в **08:22 по Asia/Qyzylorda** (03:22 UTC). Изменения закрывают замечания владельца по дизайну, плагинам, краткости ответов, счётчику разработки и многопользовательской работе.

| Компонент | Зафиксированное состояние |
| --- | --- |
| Source commit приложения | `6235d5e11707cad6de077f22660a0156a0eb5b4a` |
| Source tree | `ae1d352f31f90962d22b3f250d0783f27969089b` |
| Ветка | `feature/harness-deepseek-api-20261118` |
| Путь в репозитории | `integrations/harness-api` |
| Active release | `/opt/octoport-harness-api/releases/api-20261118-6235d5e11707` |
| Текущая ссылка | `/opt/octoport-harness-api/current` |
| Engine / gateway | Оба active/running, health HTTP 200 |
| Harness | Установленный `@deepseek-ai/dsh` **0.2.2-rc.1** |
| Default provider/model | `octoport-templates` / `alisa-matrix` |
| Матрица | **90** шаблонов исходной Алисы |
| Catalog hash | `b9352169fed63d5bd74414e6539f05f6a996f5a9e2a07303a8f6786e42c4732e` |
| Source verification | **72/72 SHA256 совпали** до и после переключения |
| Работа в момент финальной проверки | 0 активных jobs, прежняя история сохранена |

Независимый review подтвердил фактические cwd новых engine/gateway, хеши выпуска, права файлов, оба plugin entry hashes, загруженное разрешение разработчика и неизменность native Query guard. Этот отчёт завершения записан отдельным documentation commit; исполняемый commit указан в таблице.

## Дизайн по установленному Harness

В изолированном контейнере запущен установленный Harness 0.2.2-rc.1 и снят его исходный интерфейс. Новая оболочка воспроизводит его боковую панель 280 px, колонку переписки 748 px, расположение composer, нейтральную палитру, чёрную основную кнопку, светлую и тёмную темы. Используются оригинальные design-platform CSS tokens и векторный wordmark с MIT attribution.

Пользовательские функции подключены к авторизованному BFF. Общий Host-owner UI не публикуется. Удалены прежние рекламные карточки Octoport, диктовка, переключатель озвучивания, кнопки голоса и browser SpeechSynthesis/SpeechRecognition. HTTP Permissions Policy запрещает микрофон.

Проверены широкая и мобильная компоновка, страница плагинов, per-request meter, сводка расходов, тёмная тема и публичная страница входа. Assets `api-r2` опубликованы; все шесть публичных HTML/CSS/JS/SVG ресурсов дали HTTP 200, включая оригинальный wordmark.

## Матрица и лаконичный результат

Рабочая цепочка:

`чат → plugin-manager → matrix → прежний DeepSeek selector → шаблон → разрешённый API магазина → проверенный обработчик → Harness`

Управляющая команда плагина обрабатывается локально до selector. При обычном вопросе сохраняются исходные template catalog, валидация, фильтр, стабильный prompt prefix и tenant isolation. Дополнительного LLM-диспетчера нет. Финальный model answer блокируется transport этого процесса и не вызывается.

Новые ответы сохраняются как `text = presentation.summary`, отдельно `details` и защищённые `report_urls`. Простой результат в выполненной проверке:

```text
Ozon · 17.11.2026
заказано товаров: 17 шт.
```

Это тестовая величина из synthetic marketplace fixture. Голосовая пагинация, «Скажите: дальше», повторные даты и технические страницы источника не входят в короткий ответ. Подробности открываются отдельно. В табличном ответе показывается сводка либо до восьми строк; размер полной выборки и путь к полному результату явны.

Проверки сохраняют смысл величин: общий процент считается из сумм исходных величин, изменение долей — в процентных пунктах, разные валюты не складываются, неизвестные данные не принимаются за ноль, финансовый остаток не объявляется чистой прибылью. Магазины с одинаковыми названиями различаются по структурным IDs/периодам/фильтрам, а не объединяются по тексту заголовка.

## Постоянный диспетчер и расширения

| Плагин | Поведение |
| --- | --- |
| `plugin-manager` | Всегда включён; список, включение и вызов установленных возможностей |
| `matrix` | Включён по умолчанию; matrix/handler path |
| `dev-meter` | По умолчанию включён только для пользователей с server capability `developer_meter` |

Это отдельные модули настоящего Cordis: manager extends installed `Service`, установка выполняется через `ctx.plugin()`, регистрация принадлежит `ctx.effect()`. Тест подключил третий модуль только через его каталог и manifest без изменения dispatcher.

Команды:

```text
покажи плагины
включи плагин матрица
отключи плагин matrix
включи счётчик токенов
покажи расход
/plugins account enable dev-meter
/plugin dev-meter requests {"limit":20}
```

Псевдонимы и действия задаются манифестом модуля. Обычная команда переключает текущий чат; `account` — значение по умолчанию для собственного аккаунта. Явный chat override имеет приоритет. Уже принятый запрос использует сохранённый снимок возможностей.

Установка доверенного серверного кода и включение возможности разделены. Пользователь не получает npm, shell, произвольный путь модуля или управление общим profile composition. Штатный native plugin manager меняет профиль всех сессий, поэтому для аккаунтов реализован scoped manager. Полный контракт: [engine/PLUGINS.md](engine/PLUGINS.md).

## Многопользовательская схема

Вход выполняется через штатную сессию Octoport. Каждому запросу gateway назначает подтверждённые actor/tenant. Browser JSON и текст сообщения не могут выбрать чужую личность или capabilities. Чаты, jobs и настройки плагинов разделены по точной паре actor/tenant, включая пользователей одного tenant.

Доступ к магазинам, параметрам и отчётам подтверждается существующей authority. Key модели общий серверный, user session и store credentials не переходят в историю. Отзыв сессии закрывает новые обращения; original admitted session повторно проверяется перед dispatch. Polling/reload не повторяют выполнение.

Разрешение разработчика выдано ровно подтверждённой паре аккаунта и tenant в приватном root-owned allowlist. Роль владельца обычного клиентского аккаунта такого доступа не даёт. Загруженный systemd credential проверен в mount namespace gateway под его фактическим UID/GID: parser выдаёт ровно `developer_meter`.

Обычные пользователи не получают meter, цены и token usage через history/status. После отзыва developer capability скрывается также текст прежней private команды, включая сбой между native assistant commit и записью receipt. Developer dashboard показывает собственные запросы; глобальный просмотр всех клиентов не включён.

Это логическое разделение нескольких пользователей на общем сервере. Персональные коммерческие бюджеты/счета и отдельные процессы на клиента не добавлены. Подробная схема: [MULTIUSER.md](MULTIUSER.md).

## Реальная проверка токенов и рублей

На новом выпуске выполнен **один реальный DeepSeek selector API-вызов** действующим серверным ключом. Marketplace response, account scope и runtime DB в этой проверке были изолированными synthetic fixtures. Реальная пользовательская сессия и реальные магазины не использовались.

| Показатель | Результат |
| --- | ---: |
| Входные токены | 14 814 |
| Вход из кэша | 14 592 |
| Вход без кэша | 222 |
| Выходные токены | 125 |
| Всего | **14 939** |
| Вызовы selector | **1** |
| Финальные вызовы модели | **0** |
| Оценка рублей | **0,0250782144408 ₽** |
| Повтор admission | Нового dispatch нет |

98,5% входа этого контрольного запроса пришло из кэша. Это измеренная доля cache hit, не гарантия экономии для любого запроса.

Зафиксирован peak quote: USD на миллион tokens — cached input 0.006, uncached input 0.30, output 1.20; FX **82.4529 RUB/USD от 18.11.2026**. Тариф проверен по [официальной документации DeepSeek](https://api-docs.deepseek.com/quick_start/pricing/), курс — по [ЦБ РФ](https://www.cbr.ru/currency_base/daily/?UniDbQuery.Posted=True&UniDbQuery.To=18.11.2026). Историческая quote сохраняется с каждой попыткой и не переоценивается при изменении настроек.

Рублёвое значение — оценка по API-квитанции и курсу, не банковское списание. Ошибки после dispatch учитываются. Отсутствующая квитанция или цена остаётся `null`; известная часть суммы показана отдельно. Управляющие local команды имеют нулевой расход модели. В isolated helper `request_id` meter равен null; binding к настоящему job ID проверяется отдельными gateway/actual-runtime engine тестами и не подменяется synthetic login.

В первом выпуске отдельно были выполнены два реальных selector smoke calls. Их исторический отчёт доступен в commit `8e1911e7ba22f4581087c3eeea6b8b329321e3ed`. Новая проверка выше относится к текущему исходному коду. Все остальные проверки этой итерации не использовали платную модель.

## Проверки текущего выпуска

| Уровень | Результат |
| --- | --- |
| Backend | **41/41 PASS**: сессии, tenant/store boundaries, Origin, no replay, grants, credential loading, billing redaction, missing/failed receipts, pricing quotes |
| Renderer | **43/43 PASS**: scalar/event/dataset/compound, суммы/валюты/проценты, неизвестные данные, short/details, одинаковые имена магазинов и разные фильтры |
| Настоящий Harness 0.2.2-rc.1 | **21/21 PASS, 0 skipped**; финальная проверка plugin subset **7/7**, входит в тот же набор |
| Синтетический Chromium | **15 сценариев PASS**: anonymous boundary, native layout, double submit, детали/XSS/report URLs, обычный/developer пользователь, receipt merge и reload, account/chat overrides, failed unknown cost, navigation/logout races, desktop/mobile, JS errors |
| Публичный HTTP с другого сервера | **19/19 PASS**: UI/assets, me/plugins/meter401, foreign Origin403, private path404, login/return303, старые redirects303, старый POST410 |
| Живой Chromium | Публичная страница входа и original wordmark загрузились; настоящий API401; переход в `/login`, Secure/HttpOnly return marker, `/app`→303, JS errors0 |
| Реальный DeepSeek | Один успешный selector, actual usage/price quote, короткий ответ на fixture, final0, replay0 |
| Независимая проверка выпуска | **72/72 hashes**, root-owned trusted code, manifest hashes, loaded developer grant, current cwd, native guard, services |

Итого **105 Python/Node тестов** и **15 браузерных сценариев** для текущих изменений, плюс перечисленные live HTTP/browser/API checks. Ранее принятые 15 тестов platform patch/installer относятся к неизменённому guard и не пересчитываются как новые.

Фактический вход под владельцем с OTP/реальной сессией и запрос к его настоящему marketplace в этих проверках не выполнялись. Viewport 390 px проверяет компоновку, а не физическое устройство. Эти уровни не объявляются пройденными; новый сервер использует штатный пользовательский вход и его разрешённые магазины.

## Сосуществование и откат

Перезапущены только Harness engine/gateway. `alice-market`, runtime authority, native platform и web оставались active/running с прежними PID и start times. Схема БД и основной release Алисы не менялись в этом обновлении.

Native QueryService guard сохранён: SHA256 `ff7596001a538306133b5d26053c6e8e056a0278de6ea6fe039f2b62bc571f0e`. Platform live/ready отвечают200; ready содержит `status: READY` и существующее `runtime: RUNTIME_NOT_CONNECTED`, которое не используется как доказательство выполнения business запроса.

План, предыдущие units и state snapshot, activation record и live selector report сохранены на сервере в `/root/octoport-harness-plugins-deploy-20261118/`. Предыдущий release `api-20261118-5431873d9d16` сохранён. Внешний nginx и старые redirects в этой итерации не менялись.

Порядок восстановления: [deploy/OPERATIONS.md](deploy/OPERATIONS.md). При rollback сохранять native Query guard, пока есть живые Harness receipts, и новую capability/enablement projection для private developer history. Pre-plugin engine не является безопасной целью полного отката после приёма private developer-команд. Состояние не удаляется, неизвестный исход автоматически не переисполняется.

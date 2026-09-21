# Внешние проверки и отложенные детали

Архитектурная модель определена. Ниже перечислены сведения, которые нельзя честно объявить уже подтверждёнными.

| Вопрос | Текущее решение / граница | Когда закрываем |
|---|---|---|
| Точный source-коммит Ozon для переноса | Получить свежий кандидат; текущий снимок не замораживает ongoing development | D1 |
| Полнота WB provider-neutral migration | REOPENED; перенос зрелых подсистем с зависимостями и differential | До принятия WB общего runtime |
| Конкретный INVALID_CREDENTIAL_BACKUP | Не установлено без исходного файла; не приписывать причину автоматически | WB corrective work |
| WB R1–R8 и актуальность операций | Не начинать до installed provider-neutral acceptance | После соответствующего gate |
| Проверки на Mac/Safari | Архитектура предусмотрена; реальное подтверждение отсутствует | Перед объявлением Safari поддержанным |
| Другие ИИ кроме ChatGPT/Alice | Добавление по проверенным адаптерам | После текущего основного сценария |
| Провайдер реальной OTP-почты | Интерфейс есть; выбрать/настроить и проверить доставку | S1 |
| Доступ к аккаунтам издателей браузеров | Подготовить публикационные каналы; не считать имеющимися | До B1 |
| Точный дизайн двух API Ozon | UX описывает карточку магазина с двумя секциями; визуальная детализация отдельно | D2 |
| Размеры файлов/сроки API/права токенов | Факты адаптера и API; не выдумывать общий безлимит | При адаптации и живой приёмке |
| Точный порядок двух offline-доставок | Сравнимый порядок сайта ИИ при наличии; иначе детерминированный выбор по последним известным сведениям | SYNC tests по каждой поверхности |
| Мгновенный перенос из уже открытого браузера | Не обещается при редком опросе; постоянный канал ради переноса не включён | UX приёмка переноса |
| Подробные воронки сайта | Отложены владельцем; минимальный путь регистрации/установки определён | После базового портала |
| Платежи, цены, лимит устройств, договоры | После бесплатного MVP; реальные провайдеры не выбраны | M1 |
| Числовые бюджеты CPU/RAM/задержки | Нужны измерения; нельзя утверждать отсутствие регрессии заранее | Q1 |
| Политики платформ для распространения | Проверяются на выбранный канал; документ не заявляет разрешение или запрет | Подготовка соответствующего выпуска |

Технические defaults: квота беты изначально закрыта до открытия администратором; места считаются по завершённым первым регистрациям, автоматически не возвращаются при удалении. Экспорт реквизитов защищён паролем. Подробности в нормативных документах; это явные проектные решения, а не якобы уже существующая реализация.

| S2-TG1 Telegram operator service | Реализовать отдельный Stream-2 bot/control service, bot-token secret provisioning и authorized operator allowlist; initial transport — Telegram Bot API long polling | S2-TG1 |
| S2-TG2 independent scheduling | Durable LLM and Swagger/API control records; independent intervals, status, run-now buttons/commands, same-lane duplicate protection, restart recovery | S2-TG2 |
| S2-TG3 Swagger operator handoff | Official URL/request notification, reply correlation, Telegram document download, server quarantine/inbox, provenance/hash/validation, candidate handoff to S2-A1 | S2-TG3 |
| S2-TG4 operator E2E | Unauthorized denial, notification delivery, schedule persistence, forced runs, protected-source request/upload/validation/result round-trip | S2-TG4 |
| S2-A1 official source authority | Automatic acquisition remains preferred; protected sources may additionally use validated Telegram operator-assisted official-source acquisition. Full S2-A1 remains NOT_ACCEPTED until authority criteria pass | After TG3 capability and an actual bounded A1 recovery |

# S05 · недостающий стык проверки магазина

Платформенный исходник efa6a412ddc6926132cfd6fa648b71d0a155232a, tree a5c7cbff1dcc7c2b0f5c1b40776dc0e75d145eee. [Draft PR395](https://github.com/MaksimUnimax/runtime-fixtures/pull/395). Source-only review R3 принят; это не подтверждение реальных площадок.

## Свежие факты сервера

05.11.2026, чтение около 15:18 UTC: platform работает как alisa-platform-stage, effective UID 993. Ядро alice-market работает как alice-market, UID 996, из /opt/alice-market/releases/20261105-v010-number-reason-r1. /run/alice-market/gateway.sock существует, UID 996, mode 0660; его handler принимает report-submit старой формы, не проверку нового ключа. /run/alice-market/store-check.sock отсутствует. Эти UID/path — наблюдение для повторной проверки перед интеграцией, не бессрочная конфигурация.

Никакие рабочие runtime-файлы, SQLite, credentials, listener или worker текущим потоком не менялись. S05 schema/flags/vault keys на сервере ещё не включались. Пользовательский адрес остаётся https://alisa.octoport.ru/app/stores; отдельный тестовый домен не создаётся.

## Что требуется от runtime-части

1. Закрепить минимальный read-only check через существующий транспорт ядра: какие endpoint/права дают подтверждённую идентичность Ozon Seller, WB и отдельно Ozon Performance. Проверка не запускает финансовый отчёт или обычный Engine job.
2. Добавить отдельно версионированный handler [RT-CHECK](../../../../products/alisa/contracts/runtime/store-check-v1.md). Проверять SO_PEERCRED вызывающего platform UID до чтения секрета; platform проверяет UID runtime до отправки. Назначить отдельные права socket для platform; не добавлять platform в широкую группу alice-lab ради доступа и не открывать ей старый gateway/чужие credentials. Доступ к каталогу и новому socket должен быть минимальным.
3. Runtime получает секрет только на время этого запроса. Не импортировать ключи из расширения/старого alice-lab, не логировать тело, не сохранять plaintext или финансовый payload. Размер одной строки до 32768 bytes, клиентский общий deadline 3 секунды, без скрытого retry.
4. Точные pins текущего клиента: environment, product_id=alisa_market, tenant_id, store_id, provider, kind, credential_revision, store_revision, request_id. Ответ возвращает те же pins без изменений. Код и immutable source клиента — авторитетная форма для этого предложенного стыка; environment обязателен дополнительно к краткому перечню в исходном proposal.
5. CONNECTED допустим только с достоверной canonical provider identity и capabilities=[kind]. Переданный Client ID без авторизованного подтверждения, непроверенный JWT, название/email и хеш ключа не заменяют доказательство. Performance доказывает тот же кабинет Seller; если это невозможно, возвращает IDENTITY_NOT_VERIFIED.
6. Остальные результаты — отдельные безопасные коды AUTH_DENIED, SCOPE_MISSING, TIMEOUT, RATE_LIMITED, PROVIDER_UNAVAILABLE, CHECK_UNAVAILABLE, IDENTITY_NOT_VERIFIED, UNKNOWN_OUTCOME. Timeout не выдаётся за неверный ключ. Никакого произвольного upstream текста в ответе.

## Условие продолжения установки

После согласованного exact runtime source/package и disposable проверки связать platform с socket UID, создать отдельный приватный vault keyring, применить только additive stores migration и включить capability на основном сайте. Проверить согласованный набор версий, вход/сохранение/restart, чужой store ID, подмену кабинета, замену и отзыв отдельного ключа. Затем выполнить разрешённые реальные Ozon/WB/Performance checks через ввод владельцем в его кабинет, без передачи ключей в чат/отчёт.

До этого платформа отвечает CHECK_UNAVAILABLE и не обещает подключение. Исходник/тестовый peer не заменяют недостающую runtime-реализацию; общая готовность AL-S05 остаётся открытой. Граница не мешает завершить пакет и доказательства уже написанной платформенной части.

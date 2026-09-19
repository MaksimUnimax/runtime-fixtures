# Матрица приёмки целевого продукта

Все сценарии ниже — NOT_RUN_IN_SELLER_AGENTS на этапе D0. Исторические результаты источников не переносят их автоматически в PASS.
Requirement IDs соответствуют [SPEC](../product/SPEC.md). При реализации к строке добавляются commit/package/environment/evidence и наблюдаемый итог.

| Test ID | Требования | Сценарий и обязательный результат |
|---|---|---|
| A01 | SA-UX-01, SA-SHOP-01 | Переключатель Ozon/WB перерисовывает popup; несколько магазинов, переименование не меняет кабинет |
| A02 | SA-SHOP-02, SA-SHOP-03 | Seller работает без Performance; expiry/нет прав/сеть различаются; другой кабинет распознаётся либо честно unconfirmed |
| A03 | SA-SHOP-04 | Удаление активного магазина завершает локальную работу; поздний ответ не прикрепляется к другому магазину |
| A04 | SA-WORK-01, SA-AI-01 | Start в новом и историческом диалоге; старые команды не исполняются; правильный AI/account/surface |
| A05 | SA-WORK-02 | Смена Ozon→WB и магазина внутри Ozon: предупреждение, новый Start/промпт, старый callback отклонён |
| A06 | SA-WORK-03 | Finish до запроса, во время ожидания квоты, после dispatch и перед Send; остаток пакета отменён |
| A07 | SA-CMD-01 | Один блок с несколькими явными командами → один клик → строгая последовательность; autorun отсутствует |
| A08 | SA-CMD-02, SA-CMD-03 | HELP+API, неверная схема, неизвестная операция/host, business mutation: безопасный результат, запрещённая сеть 0 |
| A09 | SA-CMD-02 | Отчёт не готов/следующая страница: нет скрытого polling/pagination/retry; ИИ получает причину |
| A10 | SA-DATA-01, SA-CMD-03 | Большой JSON/XLSX/оригинальный файл доставлен целиком и в правильный диалог; размер/целостность проверены |
| A11 | SA-DATA-01, SA-DATA-02 | request success→transaction abort: не выдаётся ложная ссылка; часовой expiry всех копий, после wake очистка |
| A12 | SA-WORK-01, SA-CMD-01, SA-DATA-02 | Reload/worker restart/double click/send unknown: нет скрытого API/Send replay; состояние правдиво |
| A13 | SA-AUTH-01 | Logout retain/delete и смена аккаунта; чужие ключи/буфер недоступны, фоновые действия старого аккаунта прекращены |
| A14 | SA-BETA-01 | Два новых подтверждения на последний слот → ровно один admission; повтор не списывает второй слот |
| A15 | SA-BETA-01, SA-BETA-02 | Закрытый набор и capacity reached не мешают existing login/new device; +100 идемпотентно и auditable |
| A16 | SA-BETA-02 | Бесплатный BETA access без checkout/таймера платной пробы и без коммерческого лимита установок |
| A17 | SA-SYNC-01, SA-QUOTA-01 | Один диалог в двух вкладках локально → один executor; разные диалоги одного кабинета делят квоту без сервера |
| A18 | SA-SYNC-01, SA-SYNC-02 | Два браузера, недоступный сервер, продолжение разрешённой работы, затем bounded reconcile; допускаемый дубль не скрывается |
| A19 | SA-SYNC-02 | Ошибка/таймаут optional sync, большой pending backlog или конфликт одного диалога не блокируют обычный другой диалог |
| A20 | SA-SYNC-01, SA-WORK-02 | Поздний старый report, clock skew, out-of-order ACK: не отменяют новую привязку/Finish и не создают переключение по кругу |
| A21 | SA-QUOTA-01 | Локальный минутный лимит/429/Retry-After/другой браузер: нет скрытого retry; факт и предположение различаются |
| A22 | SA-KEY-01 | Перенос с согласием только получателя; source offline понятен; серверные DB/log/queue не содержат секретный payload |
| A23 | SA-KEY-01, SA-AUTH-01 | Recipient/account substitution, expiry, logout/revoke, повтор packet отвергаются; чужие ключи не сохраняются |
| A24 | SA-KEY-02 | Один файл все магазины; пароль/целостность/version/старый формат/конфликт проверены; импорт не запускает Work |
| A25 | SA-AI-01, SA-CMD-03 | Composer replacement, user draft, empty composer без нового turn, attachment readiness: честный send proof/UNKNOWN |
| A26 | SA-BROWSER-01 | Каждый целевой browser/OS/AI package проходит popup, lifecycle, files, update; Safari без real Mac не PASS |
| A27 | SA-ADMIN-01 | RBAC/CSRF/admin session/audit; support не меняет квоту и не получает секреты; статистика задерживается без сбоя сервиса |
| A28 | SA-OBS-01 | DOM drift vs login/CAPTCHA/UNKNOWN; API report-start vs order-create, nested privacy/shared schema; никакого auto publish |
| A29 | SA-RELEASE-01 | Preprod/prod изолированы; backup восстановлен; финальный package/contract/profile совместим; rollback предусмотрен |
| A30 | SA-AUTH-01, SA-SYNC-02 | Fresh/offlineGrace/expired/tampered/online revoked snapshot; часы назад не продлевают доступ; refresh single-flight |
| A31 | SA-SYNC-01, SA-SYNC-02 | Измерение ordinary command/delivery: 0 обязательных control API calls; retry traffic только pending installations |
| A32 | SA-SHOP-01, SA-WORK-01 | Два магазина одной площадки и Ozon/WB в отдельных диалогах параллельно: данные, ключи, квоты и результаты не смешаны |

Матрица не является исполняемым тестом. Нельзя выдавать наличие строк A01–A32 за 32 пройденных сценария.
Installed acceptance записывается отдельно по браузерам/ИИ и по точному пакету. R1–R8 WB открываются отдельным решением после положенного gate.


## D2.4 — ограниченные доказательства implementation

Development 0.2.3, code candidate `96af54f1d67c20f6eca2ade552fde20948f1e66d`; [квитанция](../migration/evidence/extension-application-d2-4-2026-09-14/README.md). Это сопоставление фактически проверенных частей требованиям, а не перевод целых A01–A32 в installed PASS. Итог remote CI указан в квитанции; source/ZIP/native результаты не заменяют I1/Q1.

| Целевые сценарии | Проверенная часть D2.4 | Оставшаяся граница |
|---|---|---|
| A01, A03, A05, A32 | APP-01/03/05: постоянные IDs, переименование, два WB магазина/две вкладки и Ozon, pinned credentials, подтверждение смены, поздний ответ после замены/удаления | Настоящий аккаунт Seller Agents, полный cross-provider installed сценарий |
| A02 | Seller-only Ozon в APP-03; отдельные поля/проверки Seller и Performance, безопасные коды проверки | Live права/expiry/provider account identity не подтверждались |
| A04, A07, A08 | APP-02 и native fixture: настоящий Start/prompt, baseline старой истории, один WB HELP/API блок, полная текстовая доставка; D2.3 adapter policy gates сохранены | Новый/fork/account/surface каждого реального ИИ, live API |
| A06 | APP-04/05 и прежние context gates: Hide сохраняет хвост, Finish/смена закрывают контекст и позднюю доставку | Полная установленная временная матрица Finish |
| A10, A11 | APP-06/07/09: expiry/readback/local-ref scope; исходный IDB abort gate; native PDF через IDB/chunks/File/attachment/Send с точными байтами | Все форматы/размеры на реальном ИИ, длительный sleep/restart и очистка после wake |
| A12, A25 | Durable text Send commit/no retry и no replay по Work/message/block; native повтор кнопки не делает второй запрос; зрелые Ozon recovery gates сохранены | Полная установленная recovery/UNKNOWN матрица и разные composer/upload UI |
| A17, A21, A31 | Shared queue/context/observed quota: APP-10 доказывает 429 → удержание хвоста и невозможность раннего resume; обычные application тесты не делают control API calls | Межбраузерное согласование/наблюдение и реальная работа signed offline access |
| A13–A16, A18–A20, A22–A24, A26–A30 | Не принимаются D2.4; account port из APP-08 не является авторизацией | I1, D3/S2, Q1 и серверная параллель |

## Current D3/S2 classification — 2026-09-18

The table above preserves the original D0/D2 historical matrix and its
boundaries. The authoritative current A01–A32 statuses are now recorded in
[D3S2-4 full coordination closure](client-i1/D3S2_4_FULL_COORDINATION_CLOSURE.md).
In particular, A22, A23, and A24 are bounded automated candidates on the
current integrated Stream-1 tree; A28 remains owned by parallel Stream 2; and
owner/live, browser/environment, Q1, provisional-review, and publication gates
remain deferred rather than being converted to PASS.

## Q1-A canonical installed matrix — 2026-09-19

The authoritative Q1-A installed matrix is maintained separately in [Q1-A
final consolidated acceptance](q1/Q1_A_FINAL_CONSOLIDATED_ACCEPTANCE_2026-09-19.md).
It reconciles Q1A-01..91 to `INSTALLED_PASS` on the exact frozen package
`93ba77f6fcac9932e991c94eded2d9638bb38c9990b8fcefd826d737aaf8d476` using
Playwright Chromium `151.0.7922.34`. This is canonical synthetic installed
acceptance pending architect decision; it is not Q1 overall completion and it
does not claim Q1-B browser-family, Q1-C owner/live, Q1-D release, or Q1-E
Stream-2 monitoring acceptance.

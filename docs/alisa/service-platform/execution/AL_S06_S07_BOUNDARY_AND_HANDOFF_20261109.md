# AL-S06 → AL-S07: действующие маршруты и следующий проход

09.11.2026. AL-S06: INSTALLED_CANONICAL_UI_VERIFIED, полный внешний проход Яндекса NOT_RUN. AL-S07: NOT_STARTED. Основания — [установленная версия и receipts](AL_S06_START_20261108.md), [roadmap](../v0.5/ROADMAP.md), [runtime RT-JOB-R01.1](../../runtime/v0.11/RT_JOB_R01_ACCEPTANCE_2026-11-04.md).

## Уже подтверждено

На основном адресе установлен source `d3cb053be14264c6bb2332708abb32d4b0c005ae`. Полная исходная CI прошла; дополнительно прошли 20 браузерных и 15 итоговых серверных проверок установленной версии. Пароль/почта, customer/tenant и действующая сессия сохранены. Client/secret/skill ID взяты из существующей локальной настройки; ключи Ozon/WB и новые приложения не требуются.

## Маршруты и authority

| Маршрут | Фактическое назначение | Граница |
| --- | --- | --- |
| `https://alisa.octoport.ru/app/alice` | Статус подключения, голосовая приватность и отзыв | Текущая WebSession сайта; владелец не объединяется с другим аккаунтом по почте или названию магазина |
| `/app/alice/connect` | Согласие конкретного вошедшего customer/tenant | Одноразовый opaque flow cookie, точная WebSession, текущие security revisions |
| `/alice/oauth/authorize` | Начало нового skill grant | Существующий client ID, `reports:read`, фиксированный `https://social.yandex.net/broker/redirect`, сохранённый state; S256 при переданном challenge |
| `/alice/oauth/token`, `/alice/oauth/refresh`, `/alice/oauth/revoke` | Отдельный OAuth навыка | Протокольный JSON, client authentication, одноразовый код/refresh/revoke; без браузерного OIDC redirect |
| `/alice/platform/webhook` | Подтверждение нового подключения | Pinned skill ID, действительный skill bearer, согласованность header/body token и текущих account revisions. Отчётное задание здесь пока не создаётся |
| Текущие лабораторные `/oauth/*`, `/alice/webhook` | Работающая native/Station-связка | Существующие grants, callbacks и tenant mappings. AL-S06 не перенаправляет и не отзывает их |

Новый account-link webhook нельзя считать готовым финансовым webhook. Успешный token endpoint сам по себе не подтверждает связь: статус CONNECTED появляется после действительного запроса навыка. Браузерный CI-проход перехватывал внешний 303 на явно обозначенной fake-broker границе; он не доказывает настройку настоящей консоли Яндекса.

## Ближайший AL-S06 проход

1. Сверить фактическую конфигурацию опубликованного навыка с новым отдельным OAuth-префиксом и callback, сохранив текущую native-связку. Не менять её по догадке и не переносить чужие активные файлы из старого пакета.
2. Зафиксировать реальный authorize → broker callback → code/token → authenticated webhook для того же customer/tenant. Сохранять только безопасные request/response статусы, время, source/config fingerprints; не коды, cookies, bearer, client secret или пользовательские идентификаторы.
3. Проверить refresh/retry, отзыв из кабинета, отказ старого доступа и повторную привязку без дубля аккаунта/потери срока доступа. Сопоставить с AL-T05-01/02/03 и AL-N06-01, AL-V04-13.
4. Отдельным receipt отметить actual console/broker acceptance. Пока его нет, AL-S06 остаётся IN_PROGRESS; текущий laboratory/native путь продолжает работать.

## Вход в AL-S07

[RT-JOB-R01.1](../../runtime/v0.11/RT_JOB_R01_ACCEPTANCE_2026-11-04.md) описывает offline runtime-поставку READY_FOR_INTEGRATION_REVIEW, а не установленный production listener. `ACTIVE_PROJECT_CONTRACT` в [API_SCHEDULE](../v0.5/API_SCHEDULE.md) обозначает проектный контракт и не является фактом развёртывания.

| Требование AL-S07 | Что нужно связать и доказать |
| --- | --- |
| Принятая версия runtime/RT-JOB | Зафиксировать текущий исполняемый source и принятый runtime port/authority; сверить capabilities и версии без установки второго ядра |
| Один полезный вопрос | Выбрать поддержанный вопрос и существующий разрешённый магазин; получить контрольный ответ с периодом, источником, единицами и временем запроса |
| Точный доступ | Передать `product_id=alisa_market`, локальный tenant/store mapping и security/grant/credential revisions. `person_id`, email и подпись магазина authority не заменяют |
| Долговечное задание | Сохранить public job ref/receipt и pins; status/result читаются по этому ref, без повторного submit и зависимости от последнего голосового указателя |
| Привязка webhook к заданию | Принятый skill grant должен разрешать только свой tenant. Повтор webhook/request_id не создаёт второй расчёт; иной payload с тем же ключом отклоняется |
| Отзыв, TTL и отмена | Чужой job ID, истёкший результат, отзыв ключа/доступа и cancel получают явные состояния; UNKNOWN не превращается в автоматический retry, ошибка не становится READY |
| Один результат в двух каналах | Алиса сообщает готовность, кабинет открывает тот же сохранённый результат. Повторное открытие не увеличивает число физических бизнес-запросов |

Следующая независимая работа — сверка существующего native account-link/RT-JOB контракта с этими маршрутами и mapping/revisions. Она не требует нового приложения Ozon, новых магазинных ключей или изменений параллельной Station-сборки. Эта записка фиксирует границы; реализацию отчётного adapter и реальный внешний проход она не заменяет.

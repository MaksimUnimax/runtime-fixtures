# S05 · возврат ко входу после удаления cookie

**Позднейшее обновление:** web теперь `alisa-9b716ba6ffe18a45`, API6098 сохранён; в форме Ozon видны сразу Seller и Performance. Исправление cookie из этого отчёта сохранено и повторно прошло регрессию. [Актуальная установленная форма](AL_S05_DUAL_OZON_20261106.md). Ниже — проверенные факты предыдущей web d991 поставки.

**INSTALLED_WEB_SESSION_FIX — полная приёмка реальных площадок остаётся открытой.** Исправление включено на https://alisa.octoport.ru/app/stores. Web `alisa-d9918bcb3695b432`; platform/API остаётся `alisa-6098b31384ae23a4`, admin/Identity `alisa-73180172646b7012`, shared current `alisa-482ed11832b666af`. Ранее установленный core/checker не менялся. [Первоначальный rollout S05](AL_S05_INSTALLED_REPORT_20261106.md) сохранён как история предыдущего включения.

На установленном 6098 публичный GET `/api/account/stores` без cookie отвечает 422 `INVALID_PAYLOAD`. BFF передаёт пустой session token платформе; schema validation отклоняет его до проверки авторизации. UI переводит на вход только при HTTP 401. Поэтому при удалении истёкшего cookie браузером открытая страница показывает ошибку списка или заполнения полей вместо нового входа.

Исправлен только stores BFF: отсутствующий, пустой, некорректный или дублированный cookie получает 401 `AUTHENTICATION_REQUIRED`, до отправки в platform API. Host/Origin и query/content-type проверки сохраняются; корректный по форме token по-прежнему полностью проверяется платформой. Cookie не выдаётся и не продлевается. Identity, общий auth module, staff, migrations, vault и checker не менялись.

В существующую интеграционную проверку добавлены анонимные GET/POST и три ошибочных cookie, а также реальные browser-сценарии refresh/create после удаления session cookie из отдельных копий своего fixture context. Проверяется переход на login и отсутствие созданного магазина. Исходный authenticated context для последующей staff регрессии сохраняется. Это source/package сценарии с synthetic RT-CHECK, не live marketplace acceptance.

## Точный кандидат и квалификация

Product source `d9918bcb3695b432f1dcc6108f91a64824e7588c`, tree `bdd5d54375b54480fa2de200c34739d33d6179b6`. Локальный сохранённый `ffaefff3965f5a4279afbb00998446671b405667` имеет тот же tree: API-публикация сохранила прежние WIP commits и не использовала force/reset. [Независимый source review](AL_S05_SESSION_EXPIRY_REVIEW_20261106.json) привязан к обоим точным hashes исходных файлов; исходное неподтвердившееся замечание о Playwright `data=dict` явно исправлено.

CI [42163427391](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/42163427391) и [42163427383](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/42163427383) завершены SUCCESS на точном d991. Проверены 182 integrated browser cases, включая 22 S05 и семь новых cookie cases; public registration 130, S05 PostgreSQL/Unix 40. Ожидание в CI было на установке Chromium; browser assertions не ослаблялись. [Полный browser receipt](s05-session-expiry-20261106/ci-s02-qualification.json), [package binding](s05-session-expiry-20261106/ci-package-binding.json).

ZIP artifact `13478806168`: SHA256 `a6287d66e7a545629b9e94a40c16234c3cdfcbbf8d5d9e85789e72d614f2f7e4`; tar `db71bb686185cc9d02545befad959ed1d7ab9b43a1f7e37cd10579511a4e9bb0`; manifest `b3fc7bb7882d6004221ca3f87b617e963d003aae4c30d8363bde08582271eb4d`. Весь archive payload — 4 451 файл / 42 ссылки — проверен до выбора компонента. Независимая [package/inactive-copy проверка](AL_S05_SESSION_PACKAGE_REVIEW_20261106.json) подтвердила эти pins, все bytes/links и compiled route guard.

## Фактическое включение

Из принятого полного архива установлены только `ui/web/`, прежний `infra/launch.py` и оригинальный manifest: 2 175 файлов / 21 ссылка. В новом отдельном release есть stdlib-only venv без pip для launcher; backend/services/admin там намеренно не установлены. Это **web component installation**, не новая полная platform installation. API продолжает использовать полный прежний 6098. SHA исходников двух собственных скриптов проверен на сервере против [независимого R4 review](AL_S05_SESSION_WEB_ROLLOUT_REVIEW_R4_20261106.json); промежуточный [R3 HOLD](AL_S05_SESSION_WEB_ROLLOUT_REVIEW_20261106.json) сохранён, все его source findings исправлены до исполнения.

Inactive install: [66 PASS](s05-session-expiry-20261106/receipts/install-web.json), invocation `449571db6dac4628a826badb43c18e7d`, 14.04 сек по journal. Root-owned files/dirs no022 и фактическое чтение всех 2 175 файлов UID995/GID987 подтверждены автором и независимо. Архив в RAM, существующие архивы/версии не удалялись и active inode не изменялись. Свободный диск/иноды остались выше прежнего резерва 3 072 MiB / 200 000.

Activation: [21 PASS](s05-session-expiry-20261106/receipts/activate-web.json), invocation `1b29a5f1eb4d4dc08eb04da9d0fe2a01`. Изменён один `web-current` и перезапущен один `alisa-web@stage.service`. Все private config hashes, inherited service profile/path/argv и остальные четыре pointers сохранены. Действующий PID/UID/cwd/cgroup/executable сверены. Публичные GET и JSON POST без cookie теперь отвечают **401 AUTHENTICATION_REQUIRED**; до исправления оба отвечали 422. Приватная страница без входа сохраняет 307 на `/login`; публичный health 200 с d991. Реальный marketplace check этими запросами не запускался.

[Независимый финальный readback](AL_S05_SESSION_INSTALLED_REVIEW_20261106.json) подтвердил фактический web process, текущие pointers и публичные GET: health 200 с d991, stores API 401, приватная страница 307 на `/login`. Ревьюер не повторял POST, принял для него авторский receipt; не читал БД, ключи, сессии или env values. Это ограниченная установленная проверка публичной границы, без утверждения о real customer/provider acceptance.

Оба конечных units завершены exit 0, inactive, пустые cgroups. Systemd затем выгрузил transient metadata: post-GC `MemoryMax=infinity` в исходном raw receipt — значение неизвестного unloaded unit, не фактический лимит выполненной установки. Установка запускалась командой с RuntimeMax180/MemoryMax512M/Tasks128; journal invocation сохранён отдельно. Для activation фактические loaded unit limits дополнительно [сняты сразу после запуска](s05-session-expiry-20261106/receipts/native-activation-start.json).

Финальный readback 06.11.2026 10:01 +05:00: четыре health READY, шесть продуктовых служб active/running, пять rollout locks свободны. Свободно 3 331 112 960 байт / 532 079 inode, MemAvailable 6 135 204 KiB, memory pressure avg10/60/300 = 0. [Полный snapshot](s05-session-expiry-20261106/receipts/final-installed-readback.json).

## Остаток и проверка вручную

Открыть [магазины](https://alisa.octoport.ru/app/stores), войти обычным способом, проверить сохранение своей карточки и отсутствие ключа в отображаемых данных. Новые browser cases доказывают source/package поведение после удаления cookie; реальный authenticated customer smoke на основном сайте всё ещё требует обычного входа, его предыдущая остановка не превращена в PASS. Настройки входа/почты и назначения администраторов этой поставкой не менялись.

Seller pair-binding/negative canary и Performance same-cabinet proof остаются незавершёнными. [Независимое исследование официальных источников](AL_S05_OZON_IDENTITY_RESEARCH_20261106.json) даёт аргументированную условную интерпретацию пары Seller headers, но live canary не выполнялся; root Seller flag оставлен false. Performance token не принят за доказательство Seller cabinet. Ключи из прежнего runtime/расширения не импортированы и не записываются в отчёты. Следующий зависимый результат — реальная проверка собственных кабинетов через обычный вход и отдельная квалификация привязки Ozon; полного LIVE_OWNER/PRODUCTION acceptance нет.

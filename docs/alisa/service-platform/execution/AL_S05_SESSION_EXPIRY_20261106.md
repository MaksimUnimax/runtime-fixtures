# S05 · возврат ко входу после удаления cookie

**SOURCE_CANDIDATE_NOT_INSTALLED.** Продолжение раздела магазинов на https://alisa.octoport.ru/app/stores. Работающий web/API пока 6098; предыдущий rollout и его ограничения сохранены в [установленном отчёте](AL_S05_INSTALLED_REPORT_20261106.md).

На установленном 6098 публичный GET `/api/account/stores` без cookie отвечает 422 `INVALID_PAYLOAD`. BFF передаёт пустой session token платформе; schema validation отклоняет его до проверки авторизации. UI переводит на вход только при HTTP 401. Поэтому при удалении истёкшего cookie браузером открытая страница показывает ошибку списка или заполнения полей вместо нового входа.

Исправляется только stores BFF: отсутствующий, пустой, некорректный или дублированный cookie получает 401 `AUTHENTICATION_REQUIRED`, до отправки в platform API. Host/Origin и query/content-type проверки сохраняются; корректный по форме token по-прежнему полностью проверяется платформой. Cookie не выдаётся и не продлевается. Identity, общий auth module, staff, migrations, vault и checker не меняются.

В существующую интеграционную проверку добавлены анонимные GET/POST и три ошибочных cookie, а также реальные browser-сценарии refresh/create после удаления session cookie из отдельных копий своего fixture context. Проверяется переход на login и отсутствие созданного магазина. Исходный authenticated context для последующей staff регрессии сохраняется. Это source/package сценарии с synthetic RT-CHECK, не live marketplace acceptance.

Перед установкой нужны независимый source review, CI с browser qualification на точном кандидате и exact package readback. Повторный перенос admin/Identity и миграции не входят в этот небольшой web-only patch. Seller pair-binding и Performance crosswalk остаются отдельными незакрытыми входами; новый cookie guard не объявляет их готовыми.

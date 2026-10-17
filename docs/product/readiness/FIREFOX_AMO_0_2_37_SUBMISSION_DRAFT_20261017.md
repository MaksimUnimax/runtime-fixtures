# Firefox / Mozilla AMO — Octoport 0.2.37: STORE-0 подготовка

**PREPARING — НЕ ГОТОВО К SUBMIT.** Доказательства на 17 октября 2026 года. Документ не является подписанным XPI, публикацией в AMO, принятой установленной проверкой или разрешением менять live-сервисы.

## Точный исходник и существующие результаты

- Репозиторий `MaksimUnimax/runtime-fixtures`. Точный `main 9ac9d33385bc68083131591147eb0b65181bb4b5`, tree `caf543359c7778de512f1f3087a8110fe7b2543f`.
- [PR203](https://github.com/MaksimUnimax/runtime-fixtures/pull/203), merge `434788a71b31b199d77994812abc023a1f2bb639`: принят явный Firefox-only B1-кандидат, отдельный от Chrome ZIP. [PR206](https://github.com/MaksimUnimax/runtime-fixtures/pull/206), merge `9ac9d33385bc68083131591147eb0b65181bb4b5`: проверка минимальной Firefox 140+ декларации передачи данных.
- На **точном main9ac**: 5/5 native CI, 13/13 реальных jobs `COMPLETED/SUCCESS` с первой попытки: [Server](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/39047195830), [Extension](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/39047195846), [I1-C1](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/39047195817), [Documentation](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/39047195826), [Safety](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/39047195819). Это **SOURCE/синтетические проверки**, а не AMO-signature, Firefox install или Store acceptance.
- [A06_INSTALL_UPDATE_SUPPORT_V0237.md](A06_INSTALL_UPDATE_SUPPORT_V0237.md) сохраняет **исторический** Firefox development carrier: временная установка в Firefox 155.0.1, гостевой popup/worker; dev Firefox ZIP 42 файла, SHA256 `16b5c946e0f545a3b36ebe98b57557edc62395f5ca533cb9c36506adde452e16`. Это исторический исходник, **не** текущая подписанная AMO-версия main9ac.
- [Extension CI artifact 12106192845](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/39047195846/artifacts/12106192845) содержит **Chromium** development ZIP 41 файл SHA256 `fbedd0b7b648c835c7328bee4019a97ab046a64fde6007b6b193a86d44db7f89`; это **не** доказательство Firefox/XPI, подписи или AMO.

## Firefox-only B1: реальный выпускной вход отсутствует

1. B1 источник `tooling/b1/release-lib.mjs` Git blob `5ff7c55c8252515038b3b2b57601b55806dbf2ef` обрабатывает **предоставленную извне** `octoport_release_authority_v1` для **фактического checkout**. Для указанного main9ac это `source.head=9ac9d33385bc68083131591147eb0b65181bb4b5` и `source.tree=caf543359c7778de512f1f3087a8110fe7b2543f`; версия `0.2.37`, `control_plane_v2`, миграция `61`, `PREPRODUCTION`, два канонических разных HTTPS origins и реально принятый публичный Ed25519 trust bundle. Chrome authority, прикреплённая к `main389/tree3dd`, **не подходит**. Реальный авторитетный источник этих входов — `UNKNOWN`. **B1 не удостоверяет, кто выдал или утвердил authority: полномочия издателя и внешнее принятие этого входа требуют отдельных первичных доказательств до реального Store-релиза.**
2. Требуется **новый реальный Firefox release ZIP** (не dev carrier и не Chromium ZIP): настоящие endpoints/config, identity, разрешения и содержимое, совместимые с этой authority и целевым runtime. Старые тестовые источники `.invalid`/localhost или синтетический Ed25519 ключ не допускаются.
3. Лишь при наличии настоящих входов CLI поддерживает явную подготовку `--authority <accepted.json> --out <empty-dir> --firefox <real-release.zip> --channel firefox`. Затем `tooling/b1/release-preflight.mjs <candidate-dir> --authority <accepted.json> --channel firefox`. Это **шаблон**; команды на реальных входах не выполнялись.
4. Manifest кандидата `B1_RC_MANIFEST.json` должен иметь `releaseScope: FIREFOX_ONLY` и только Firefox package. Preflight проверяет ZIP/metadata/actual bytes, внутреннюю согласованность переданного public trust bundle и packaged config, source identity, manifest и отсутствие посторонних файлов. Старый двухбраузерный путь и Chrome-only не принимают Firefox-only кандидат как полный комплект. `PACKAGE PASS` не доказывает Mozilla signing/installed Firefox. **B1 не доказывает издательское происхождение authority и не проверяет факт подписи Mozilla; эти доказательства независимы от внутреннего PACKAGE PASS.**
5. Если выбран новый checkout после main9ac, authority должна соответствовать **новому** точному HEAD/tree. Нельзя молча перепривязать уже проверенный пакет к latest main ради документационных коммитов.

## AMO data consent и Firefox 140+

- B1 требует постоянный `browser_specific_settings.gecko.id` (сейчас требуемый валидатором ID — `octoport@octoport.ru`), `browser_specific_settings.gecko.strict_min_version` не ниже **стабильного Firefox 140.0** и допустимый `browser_specific_settings.gecko.data_collection_permissions.required` (непустой, без ложного `none`). Неизвестные категории, дубли, конфликт `required`/`optional` и ранние версии отвергаются. Это поведение кода; точный signed manifest пока **UNKNOWN**.
- Octoport передаёт выбранный пользователем отчёт маркетплейса стороннему ИИ. Privacy-policy, карточка, встроенные disclosures и manifest должны описывать реальный объём, цели, участников, техническую диагностику, хранение/удаление. Нельзя писать «данные никогда не передаются» или рекламировать непроверенные AI как уже поддерживаемые.
- По [Mozilla Firefox 140 data collection](https://support.mozilla.org/en-US/kb/extension-data-collection) декларация показывается пользователю при установке. Поведение фактического согласия, отказ от optional данных и совместимость установленного подписанного ZIP пока **NOT TESTED**.

## Настоящая подача в Mozilla AMO

- Владелец уже подтвердил регистрацию выбранных publisher accounts, поэтому **регистрацию Mozilla заново не требовать**. По [STORE_POLICY.md](../../development/coordination/STORE_POLICY.md) ранняя публикация ограниченного среза разрешена сразу при безопасном минимуме, не ожидая Chrome/Opera/полного C06.
- Основной предложенный ранний путь — **listed AMO с честной отметкой experimental**. По [официальным правилам подписания](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/) Firefox Release/Beta требует Mozilla signature и для listed, и для self-distributed. Подписанный **unlisted/self-distributed** XPI сам по себе не равен публичной карточке AMO. Обычного beta prerelease-channel для listed AMO нет.
- По [официальной инструкции AMO](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/) при фактической подаче нужны реальный ZIP/XPI и validator, название, честное краткое/полное описание, категория, лицензия, privacy policy при передаче данных, support email/site, список платформ, notes для ревьюера. [Source code submission](https://extensionworkshop.com/documentation/publish/source-code-submission/) требуется при сложном minification/bundling, чтобы reviewer мог воспроизвести сборку. Реальные секреты владельца в notes не помещать; допустимый отдельный reviewer test account без обхода auth.
- Общедоступные [Privacy](https://octoport.ru/privacy), [Support](https://octoport.ru/support) и [Install](https://octoport.ru/install) ранее отвечали 200 HTTPS; URL-доступность **не доказывает** полноту policy/AMO dashboard или смысловую приёмку. Опубликованная главная страница ещё рекламирует DeepSeek — [PR153](https://github.com/MaksimUnimax/runtime-fixtures/pull/153) ожидает точное решение владельца, вне scope этого документа.

## Потребительские доказательства перед Submit

- **PACKAGE:** авторитетная immutable authority, Firefox-only `B1_RC_MANIFEST.json`, идентичный хеш настоящего ZIP на всех шагах, supported permissions/data categories, reviewer-readable source и настоящий Mozilla signing receipt.
- **INSTALLED:** настоящий Firefox с подписанным пакетом, устойчивый add-on ID, обычный вход Octoport, исходный toolbar popup, Ozon/WB store-context, Start → разрешённый read-only запрос → однократная доставка → Finish; импорт ключей **в исходном popup**, не в новой вкладке. Синтетические/временные guest PASS не закрывают эту проверку.
- **UPDATE:** N→N+1 у того же Mozilla item/ID с сохранением локальных ключей, store/account binding, no-replay при restart и rollback. Новый ID или подписанный другой канал не доказывают обновление существующей установки.
- **STORE:** подтверждение фактической карточки, channel listed experimental / при необходимости отдельного self-distributed route, upload SHA, Mozilla подпись/review, real submission timestamp и замечания. `PREPARING` не заменять на `SUBMITTED` по одному ZIP.

## Открытые зависимости и ответственные

| Граница | Фактический статус | Следующее разрешённое действие |
|---|---|---|
| Firefox-only SOURCE | PR203 и PR206 в main9ac; 5/5 CI и 13/13 jobs SUCCESS | C сохраняет принятые SHA и не повторяет tests без изменённой границы |
| Authority, реальные HTTPS/trust/catalog | **UNKNOWN**, нет подтверждённых signing inputs | B/Ops сообщает существующий подлинный первичный authority / catalog или точное UNKNOWN |
| Реальный Firefox Store ZIP / signing / listing | **NOT ACCEPTED**; source/старый dev ZIP не выдавать за Store | C проверяет реальные bytes с B1; издатель выполняет AMO upload в уже разрешённом объёме после готовности |
| Firefox install/auth/Start/Finish | **NOT ACCEPTED** для Store версии | Тестер и A03 проверяют реальный Firefox, не подменяя его Chromium |
| Privacy/marketing/notes | **UNKNOWN** в действительном AMO Dashboard; PR153 владелец решает отдельно | Владелец подтверждает точные PR153 формулировки; C сверяет показанное на реальном пакете/карточке |

**Публикация: Firefox AMO — PREPARING.** Эта работа не создаёт новый governance реестр, право доступа к аккаунту, подпись, production и не задерживает приоритетный Chrome Store.

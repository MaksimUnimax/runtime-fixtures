# S04 · установка доступа на основном сайте

**PACKAGE_INSTALLED_NOT_ACTIVATED.** Владелец поручил продолжать на https://alisa.octoport.ru/. Перенос админки и передача реального OWNER выполнены другим потоком; текущая работа их сохраняет.

## Exact source и пакет

Кандидат `c8666516683e7b2bedc2c1a7d939e9e3c4489d38`, tree `786126cc26dc094911b891f8600bf94a95353d1f`, поверх работающего canonical-auth `482ed11832b666af17f879ae710fd43d2c321ce7`. CI42037466701,42037466761,42037466757 SUCCESS. S04 PostgreSQL36PASS, native/canonical core92PASS, packaged96PASS, integrated HTTPS159PASS (ровно12S04), separate open-registration130 — только regression чужой области. Независимый SOURCE/PACKAGE scope принят; это не installed functional PASS.

[Exact binding](s04-installed-20261105/ci-binding.json):4433files/42links; tar `81c2bd21d8d9eec6e1a0094f8ecb384b394b1061cb3b7650497b9607ee51345e`, manifest `3287fa567545e9598a04e4ba57f7a484814e45195f6cd724bb0532c24b6606f5`, binding file SHA `253fee65c06f005e71e9acc76ecc374a251915009e7c50302f96263745353823`.

## Текущая база и ресурсы

Все5исходных pointers — `alisa-482ed11832b666af`; web запускается черезweb-current, platform черезsite-current, admin черезadmin-current, Identity черезidentity-current. Effective ExecStart/CWD проверяются до изменения. Origins: сайт alisa.octoport.ru, админка alisa-admin.octoport.ru, Identity id.octoport.ru. Проверить canonical auth flags1 и issuer id.octoport.ru у web/admin/platform.

Первая собственная maintenance unit g002 не получила lock во время чужого cutover и не запускала installer. Новый g003 invocation `0a0794815ed04aefadb673510b37498b` держит5существующих flocks максимум20мин/64MiB. Отдельные bounded install/activation512MiB,swap0,RuntimeMax300sec,KillModecontrol-group,TimeoutStop5. Никаких новых runner/queue/controller.

Inactive vendor dedup +201MiB, затем узкий runtime library-code dedup +937MiB (66563links; `.venv/lib/python3.12/site-packages` только своих inactive releases) восстановили4048MiB. SHA/size/mode/uid/gid/device equality, allaliases/targetnlink guards, embedded complete process/inode inventory сповторомкаждые500иEACCESabort, atomic per-file replacement. Архивы, данные, version paths не удалены; active inode0. У inactive dependencies меняются nlink/ctime и file/parent timestamps; исходная metadata сохранена private gzip. ctime невосстановим, раздельная timestamp restoration требует разорватьhardlink. Это поддержка ресурсов, не изменение функций.

## Выполненная normal-copy установка

Никакого reuse/hardlink payload при установке. Стандартный existing `infra/release.py` проверен по qualified source SHA и вызван только `deploy --env stage`. Полные ZIP/tar/manifest и source pinned, собственные скачанные архивы сохранены в root0700/0600. Новый изолированный payload копируется через data-filter, venv создаётся стандартно на final path; public-read code umask022 применяется только внутри создания secret-free кода, private log0600. Input/config/DB/pointers не меняются.

Installer receipt PASS20, завершён14:00:06UTC: полный4433/42совпал, все pointers прежние, диск4046→3685MiB; исходный прогноз498MiB сверх3072включалZIP/tar/payload/venv×1.15и116MiB роста/overhead. Все старые версии и архивы сохранены. Единственный новый target `alisa-c8666516683e7b2b` пока не активирован. При неизвестном/частичном исходе нельзя повторять слепо: старыйFAILEDreceipt сохраняется; отдельная boundedresumeтолько послеSHA/manifest/неактивности/фазыreadback. Down/удалениеверсийнеиспользуются.

## Активация после независимого review

1. Перепроверить binding/receipt/installed manifest, все5pointers внутри own releases и source482, effective Exec/CWD, canonical flags/issuer, exact config bytes/root modes. Сохранить private env/pointers/ingress/drop-in hashes и schema-only backup platform, без копирования клиентских строк.
2. На короткий переход удерживать существующий product staff-owner transaction advisory lock. Снять fingerprint всех staff authority rows; их ID/Subject/роль/permissions/revision/active не менять. Native identity/customer sessions не отзывать.
3. С migration-role выполнить только `migrate entitlements --plan`; parse ровноодинplanned entry entitlements.0001_initial. Применить его; проверить точный migration-ledger delta из1строки ссохранением всехстарыхзначений. На grant/adjustment/preview runtime UPDATE/DELETE/TRUNCATE=false. Grantcount0доосвобожденияadvisorylock.
4. Изменить только platform ALISA_ENTITLEMENTS_ENABLED=1. Переключить web-current/site-current/admin-current наc866 и restart толькоweb/platform/admin. Identity-current и shared current482, всеorigins/SMTP/keys/nginx/drop-ins сохраняются. Проверить4READY, publicTLS иstafffingerprint, освободитьDBlock.
5. При сбое каждыйpointer/config допускаетсятолькоbeforeORself-written; вернутьтолькосвои изменённыезначения, restart/readback. Unknown внешниеизменениянеперетирать. Additive schema/history остаются; migrationdownнеисполняется.

## Установленная приёмка

Проверить4433/42, flags/private permissions, allconfigbytesкромеодногоflag, DBACL9checks, canonicalHTTPS, readonlycustomerroute иcurrentauthority. СвойпрежнийtestOWNERутратилправапослеразрешённогоhandover; не возвращатьроль,необходитьправа. Выдачу через реальногоOWNER проверяет владелец с тем,кому передаладминку. Итог ограничивается READY_FOR_OWNER_TEST; SOURCE/packaged159непереносится в live-server functional PASS. Никакие identity canonicalization/handоverкоманды текущим потоком не исполняются.

После независимогоactualreadbackосвободитьrolloutlocks,сохранитьreceipts/proceduresвGitDraftPR393. Mainmerge/переносдоменов/оплата/реальныеписьманевходят.

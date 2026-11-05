# AL-S03 · независимый read-only обзор точного кандидата

Проверить source `d5e338acfec27fd691b68f158dd93e82cbd9a4fe`, tree `878c10dc458a466124e7e00b4b99f7efc05577f1` и пакет `alisa-d5e338acfec27fd6.tar.gz`, SHA256 `68f868ba3f43b07c094f0e79161abcdc3fb25f51a7eacba10dc990c794484450`. Предыдущий первый backend slice review не заменяет этот обзор.

Артефакт [CI41989478073 /13397661013](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/41989478073/artifacts/13397661013). [Индекс измерений](AL_S03_CI_QUALIFICATION_20261105.json), [browser117](AL_S03_FULL_BROWSER_QUALIFICATION_20261105.json), [native core44](AL_S03_CORE_CI_QUALIFICATION_20261105.json), [регрессия96](AL_S03_REGRESSION_20261105.json), [provider37](AL_S03_PROVIDER_QUALIFICATION_20261105.json). Скачанные manifest4393files/42links совпали. Provider запускал merge ref `731c1d20…`; его tree независимо совпал с exact candidate.

## Область и предмет проверки

Требования: frozen v0.5 ROADMAP AL-S03, SPEC AL-R003/R008/R046/R049/R051/R052/R053 и связанные TEST_PLAN cases. Не менять frozen docs, исходники, Git refs, сервер, БД, CI, credentials, другие потоки и матрицу. Самостоятельные тесты допустимы только в согласованной disposable среде по действующим resource/auth правилам.

1. Native `authenticator_used` → текущий authorization request → один library code в encrypted shared cache → подписанные claims → отдельный admin BFF. Проверить свежесть, user/client/issuer/nonce/challenge binding, one-use, recovery consumption, concurrency, failure/rollback transactions. Не принимать сохранённые labels/факт enrollment за MFA-свидетельство.
2. Первый MFA у passwordless account: до enrollment требуется свежий native email-code event; OTP проверяет pinned library. Просмотр recovery codes требует штатный step-up, новый вход использует новый одноразовый фактор.
3. Отдельные client/host-only cookie/key/service-token, фиксированные origins/endpoints, state/nonce/PKCE/audience/signature/expiry, callback retry с неизменным input, закрытые flags, отсутствие browser-provided authority/DB credentials.
4. Staff product scope/revision/current permissions; OWNER bootstrap и last OWNER; ADMIN allowlist; обычный клиент и другой product не получают staff. Local customer block не меняет identity person/другой продукт. Отзыв member/session закрывает ранее вошедшие контексты.
5. Command UUID receipt/fingerprint: один эффект при конкуренции и неопределённом ответе, конфликт изменённого payload, актуальная авторизация перед replay. Проверить lock order в assign/revoke/customer/session paths.
6. Append-only safe audit на ORM и PostgreSQL runtime role, predefined reasons/projections, без contacts/tokens/queries; scoped cleanup не затрагивает чужой product. Путь native/template/BFF/API/UI должен совпадать с фактически проверенным package.
7. Migration `staff.0001_initial`: additive пять таблиц, собственные audit privileges, apply/repeat и совместимость со старым S02. Для будущего rollback надо закрыть staff ingress и стереть/отозвать собственные staff secret payload до возврата к S02 cleanup. Installed S03 restart/rollback ещё не испытаны.
8. Граница заявленного результата: CI author qualification, а не S03 stage/production acceptance. Финансовых/publish/refund API нет. Не объявлять готовность по одному числу проверок.

## Текущая параллельная установка

Web уже `alisa-140150ba526b6c3d` в `web-current`; platform/identity S02, admin S00. Web auth blob совпал с S02; S03 не меняет web source. Будущий rollout должен сохранить новый дизайн и изолированно переключать platform `site-current`, identity `identity-current` и own admin pointer. Никакого S03 rollout не делали.

Результат: отдельный полный вердикт с точными source/package/tree, воспроизведёнными findings, границами source/package/installed и открытым остатком. Возможные исходы: REWORK либо ACCEPTED_FOR_DECLARED_SOURCE_PACKAGE_SCOPE; installed scope всегда отдельно. Не требовать PASS, не заменять проверку собственным числом тестов.

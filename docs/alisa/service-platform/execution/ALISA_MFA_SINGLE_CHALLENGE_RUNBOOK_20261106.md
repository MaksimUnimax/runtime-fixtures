# Исправление повторного MFA и продолжение входа · 6 ноября 2026

Владелец воспроизвёл: после подключения приложения просится ещё один TOTP, затем показываются recovery codes без продолжения в админку; общая подсказка ошибочно обещает письмо.

Причина: pinned allauth enrollment проверяет code, но не записывает native reauthentication. Recovery view немедленно требует её. Текущий общий шаблон показывал email-инструкцию даже на MFA/recovery paths.

Изменение только identity. Узкий subclass нативного ActivateTOTPView считает один подтверждённый challenge для того же живого, проверенного admin request и свежей native email authentication. После штатной activation тот же введённый code проходит native created-authenticator verifier, который ставит used-code marker; затем native post_authentication(reauthenticated=True) до сохранения session. Никаких самостоятельно подставленных authentication-record labels, новых факторов/сессий оператора или ослабления verifier.

Исходный local authorization target хранится в прежней зашифрованной session только после pinned client/callback/PKCE validation. Recovery page сохраняет native условия показа/скачивания/генерации backup codes и предлагает явное продолжение. POST+CSRF продолжает только исходный target с тем же живым proof; missing/stale/changed/user-mismatch ведёт на фиксированный admin login. bind_code остаётся one-use. MFA/recovery pages no-store; email и app инструкции разделены.

Тестировать полный native HTTP и packaged browser round trip: email → enrollment одним TOTP → recovery → продолжение → прежний admin account. Включить wrong code, replay marker, сохранение native record/proof после HTTP redirect, CSRF, чужой/изменённый target, истечение proof, отсутствие pending, старую native recovery policy и права обычного клиента.

Установить только identity-current на exact reviewed/qualified artifact; не менять более новые web/admin/platform c8666516683e7b2bedc2c1a7d939e9e3c4489d38 или их PID/pointers. Без миграций, изменения issuer/domains/clients, реальных факторов, recovery codes или принудительного logout владельца. До установки сравнить текущую identity482ed118 и зависимости/миграции; сохранить прежний pointer и проверить остальные службы. При readiness ошибке вернуть прежний identity pointer. После установки убедиться, что новый template/module загружаются, а обычные домены и более новые службы сохранены.

Личный TOTP и recovery codes владельца оператор не читает, не использует и не заменяет. Live UI acceptance его ручного входа не подменяется synthetic CI.

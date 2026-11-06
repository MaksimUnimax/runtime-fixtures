# Ordinary customer password and email-code correction

Owner scope (2026-11-06): ordinary registration/login at https://alisa.octoport.ru/app/stores uses email as login, a password, then a fresh email code. No customer authenticator challenge. Preserve native staff TOTP/recovery, installed admin fixes, account/store isolation, keys and the existing identity DB.

Source combines stores 7ad86730 with installed admin/identity 73180172. Changes are confined to native identity policy/UI, web login/claim enforcement, regression qualification and this receipt. No migration or provider change is required: existing native Person already has a password field. Existing passwordless accounts set a password through native email-confirmed reset, then perform a fresh password + login-email-code flow. Reset confirmation never becomes a product login.

Native allauth validates passwords, login/reset email codes, CSRF, rate limits, PKCE, authorization codes and signatures. Customer proof belongs to one native Login and one exact registered web callback/client/state/nonce/PKCE target. It is consumed with the encrypted authorization-code row. All authorization GETs now share the browser-session PostgreSQL lock. Staff MFA policy and its proof remain separate. Web BFF requires signed customer authentication claims.

Validation and deployment: pending. Local foundation 74 tests and UI/type build passed; native disposable SQLite flow checks are diagnostic only and do not prove PostgreSQL concurrency or installation. Independent source review in progress. No installed claim until exact CI package and server readback complete.

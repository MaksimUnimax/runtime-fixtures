# Текущее состояние

Дата проверки: 2026-09-18.
Этап: D1 COMPLETED — D1.S1/D1.E0/D1.E1 приняты. D1.E1 IMPORT_ACCEPTED: 232 файла, remote CI и readback PASS. D0 COMPLETED; D2 IN_PROGRESS, D2.1 ACCEPTED; D2.2 ACCEPTED — SOURCE/PACKAGE/REMOTE CI/READBACK PASS; D2.3 INTERNAL_ADAPTER_ACCEPTED — SOURCE/PACKAGE/REMOTE CI/READBACK PASS; D2.4 DEVELOPMENT_APPLICATION_VERIFIED — SOURCE/PACKAGE/NATIVE_FIXTURE/REMOTE_CI/READBACK PASS; S1.1 DONE / REMOTE ACCEPTED.
Product implementation: SERVER_IMPORTED_AND_VERIFIED; EXTENSION_BASELINES_IMPORTED_AND_VERIFIED; COMMON_CORE_COMPOSED_OZON_VERIFIED; BATCH_CONTEXT_VERIFIED; WB_INTERNAL_ADAPTER_VERIFIED; WB_APPLICATION_ROUTE_CONNECTED; COMBINED_OZON_WB_DEVELOPMENT_VERIFIED; REAL_ACCOUNT_AUTH_NOT_CONNECTED.
Post-C3H P2 joint offline command/result recovery is `IMPLEMENTED_CANDIDATE_WITH_ENVIRONMENT_GAP`, architect review pending; it preserves P1 no-replay, adds bounded known-result materialization and fail-closed AI delivery recovery. P3 extension-local technical scheduler integration is `IMPLEMENTED_CANDIDATE`, architect review pending. The bounded automated pre-handoff candidate is `EARLY_I1_D2_AUTOMATED_PREHANDOFF_CANDIDATE_READY`; architect acceptance is pending. This does not mark D3/S2, Q1, B1, production deployment, or all-browser support complete. Stream 2 monitoring agents remain untouched. Evidence: [P2 joint result recovery](development/client-i1/POST_C3H_P2_JOINT_OFFLINE_COMMAND_RESULT_RECOVERY_2026-09-18.md), [P3 local scheduler](development/client-i1/POST_C3H_P3_LOCAL_SCHEDULER_INTEGRATION_2026-09-18.md), and [automated pre-handoff](development/client-i1/EARLY_I1_D2_AUTOMATED_PREHANDOFF_ACCEPTANCE_2026-09-18.md).
I1-SRV.0–I1-SRV.4 are historically accepted on canonical `main` at `5d7c8853cc69dd95bc6e713cac3fb2aa0a63383c` / PR6 with their original evidence preserved. I1-SRV.5 is `ACCEPTED` at `086ae20c2858849ec13b1ab67c2f7661259022c3` only for the bounded server/reference lifecycle and fixture gates. C1 is `ACCEPTED` at `56c81a3521c02502b65fd713aec890e5a30f038d` only for its bounded source/package/native and installed-local development scope. C2.1 is accepted at `4acc5fb3336e3e38fa30d6a7ec16c80730bcd7e1`. C2.2-A is `ACCEPTED / REMOTE VERIFIED` on exact tested implementation head `5d93bccac163c8728a8d7a3b1d4b9f23ea16b680`, tree `531033ac08f001dd55427c4ae969a6c4b5d6b861`. C2.2-B is `ACCEPTED / REMOTE VERIFIED` on exact tested implementation head `8a5d9e6ca611d69512ad28fc00684c63bdc87324`, tree `1fb11a510d6dd314a0647c5348e56d1a26bc007e`. C2.2-C is `ACCEPTED / REMOTE VERIFIED` on exact tested implementation head `a1d0a9dc83daf80536f58bf56d498206da8a1eb3`, tree `1f7a54c0ac0c1c95b680071f7036f084715bac4c`. The accepted C2 base remains `integration/i1-c1-srv5-2026-09-16`; PR18 was merged there at `c6fc2363f25e02e5ff7ce548164df7a37b94bcf8`, and PR19 was merged normally at `ff55e8aaf3d473582ccce37a89c45098789fa2b3`, tree `cedba79daf0b25109c720c0976bd78deb00834db`; both preserve their exact-tested implementation commits in history. Canonical `main` is `bc718cc5c677ad0eb4598e7de3ad766473ff0847`; PR7 and PR8 remain draft/unmerged and PR9 remains the draft synchronization/integration PR. Evidence: [I1-SRV.5 acceptance](server/I1_SRV_5_REFERENCE_ACCEPTANCE_2026-09-16.md), [synchronization handoff](server/I1_SERVER_EXTENSION_SYNC_2026-09-16.md), [sync evidence](server/evidence/i1-sync-2026-09-16/README.md), [C2.2-A acceptance](migration/evidence/extension-i1-c2-2a-2026-09-16/r4/README.md), [C2.2-B acceptance](migration/evidence/extension-i1-c2-2b-2026-09-17/r1/README.md), [C2.2-C acceptance](migration/evidence/extension-i1-c2-2c-2026-09-17/r1/README.md), plus the prior [I1-SRV.2 acceptance](server/I1_SRV_2_DEVICE_AUTH_INTEGRATION_ACCEPTANCE_2026-09-15.md), [I1-SRV.3 acceptance](server/I1_SRV_3_BOOTSTRAP_TRUST_HANDOFF_ACCEPTANCE_2026-09-15.md), and [I1-SRV.4 acceptance](server/I1_SRV_4_ERROR_REVOCATION_OFFLINE_ACCEPTANCE_2026-09-15.md). S1.2 remains NOT_STARTED.
Deployment: NOT_STARTED.
Browser releases: NOT_CREATED.
Live provider tests in this stage: NOT_RUN.

D3S2-2A credential-transfer control-plane/ephemeral-relay foundation is `IMPLEMENTED_CANDIDATE / REMOTE_NOT_VERIFIED`; it does not self-accept A22/A23 and does not implement A24. Evidence: [D3S2-2A credential transfer foundation](development/client-i1/D3S2_2A_CREDENTIAL_TRANSFER_FOUNDATION.md).
A24 `SA-KEY-02` is now `IMPLEMENTED_CANDIDATE / REMOTE_NOT_VERIFIED / ARCHITECT_REVIEW_REQUIRED` on the bounded `feature/d3s2-a24-export-import-2026-09-18` branch. The local-only encrypted all-stores file, strict parser, exact historical adapters, account/conflict/tombstone safety, popup flow, focused EX-01..EX-74 matrix, and installed source/generated plus extracted/package Chromium journey are recorded in [D3S2-3 A24 evidence](development/client-i1/D3S2_3_A24_EXPORT_IMPORT.md). This does not self-accept A24 or change A22/A23, Q1, S1.2, Stream 2, deployment, browser publication, or monetization.

## Компоненты

| Компонент | Исходное состояние | Состояние в Seller_Agents |
|---|---|---|
| Ozon 0.1.22 | 3b102f68; PRE-HANDOFF PASS, LIVE CERTIFICATION PENDING POST INSTALL | 36 runtime-файлов перенесены; local/remote source и package routes PASS; live pending сохраняется |
| WB 0.3.0 | 006af272; INSTALLED FAIL; provider-neutral migration REOPENED / COMPLETENESS NOT PROVEN | 40 runtime-файлов перенесены в reference; 52 исходных suites дают 1075/0 на source и ZIP; installed FAIL сохраняется |
| Сервер | Замороженный P8.4 Foundation на 3f16bbf; H3 browser actions/P8.5/P8.6 не начаты | SERVER_IMPORT_ACCEPTED: новый полный CI PASS, 594-file readback MATCH; deployment не выполнен |
| Единое расширение | Целевая архитектура согласована | D2.4: каталог, общий popup/Work и доставка в development 0.2.3; source/ZIP/native fixture/remote CI/readback PASS; beta auth и live pending |
| Лимит регистраций беты | Новое требование владельца | S1.1 DONE / REMOTE ACCEPTED; exact authority and CI are recorded in [S1.1 remote acceptance](server/S1_1_REMOTE_ACCEPTANCE_2026-09-14.md) |
| Редкая синхронизация/перенос ключей | Приняты целевые механики | Специфицированы, не реализованы |
| Сайт/админка | Исходные приложения сервера | Перенесены и проверены вместе с сервером; S1.1 beta access/admin admission принят; real extension auth остаётся I1 |
| Мониторинг DOM/API | Есть основа Health, целевые правила API watcher | Расписания в этом этапе не создавались |

Снимки и подтверждения: [SOURCES](migration/SOURCES.md), [SOURCE_STATUS](migration/evidence/SOURCE_STATUS.md).

## Текущий результат

D2.4 DEVELOPMENT_APPLICATION_VERIFIED: каталог/общий popup и прикладная Work/delivery Ozon/WB в development 0.2.3; [описание](development/EXTENSION_APPLICATION.md), [приёмка](migration/evidence/extension-application-d2-4-2026-09-14/README.md). Code `96af54f1d67c20f6eca2ade552fde20948f1e66d`: 109 gate processes, 10 application-групп, полный CI 34846554237 SUCCESS. Native Chromium source/extracted: Start, baseline старой истории, WB HELP/API, текст/no replay, Hide/Show, PDF через IDB/File/attachment/Send, Finish. Скачанный ZIP совпал; 924 Git-файла и 84 production inputs MATCH. Это ограниченная development приёмка; I1/auth, реальные ИИ/браузеры и общий D2 остаются открыты.

D2.3: [квитанция](migration/evidence/extension-wb-adapter-d2-3-2026-09-14/README.md), [границы и зависимости](development/EXTENSION_WB_ADAPTER.md). 105 source/ZIP gate processes PASS, включая 17 групп WB. Один shared guarded queue для Ozon/WB. Сохранены WB API authority и запреты, добавлены context fences и наблюдённый Retry-After. WB выполняется во внутреннем adapter API с локальными application ports в harness; на момент D2.3 настоящие popup/Start/delivery ещё не были соединены. Это не единая установленная сборка. Remote CI 34839904748 SUCCESS; скачанный ZIP побайтово совпал, 97 Git-файлов и все 77 production inputs сверены. Внутренний adapter API принят.

D2.2: [квитанция](migration/evidence/extension-context-d2-2-2026-09-14/README.md). Общая очередь, pinned context и защита от смены реквизитов/привязки во время выполнения. Статус: ACCEPTED; 101 процесс source/ZIP PASS, полный remote CI PASS, скачанный package и 67 production inputs MATCH. Это один Ozon slot, не реализованный каталог аккаунтов/магазинов.

D2.1: [квитанция](migration/evidence/extension-core-d2-1-2026-09-14/README.md), [архитектура и команды](development/EXTENSION_CORE.md). Выделены Work/discovery/local execution/delivery modules с Ozon ports. 99 процессов source/extracted-package проверки PASS локально; включают 15 новых групп сценариев и сохранённые Ozon/attachment/transaction gates. Remote CI и readback PASS; скачанный CI package совпал с локальным, все 50 inputs сверены с Git. Это первый шаг, не завершение всего D2.

D1.E1: [квитанция](migration/evidence/extension-import-2026-09-14/README.md), [команды](development/EXTENSION_BASELINE.md). Перенесены 76 production/reference-файлов и 156 тестовых/справочных входов без изменения байтов. Ozon: 14 source + 11 package gate-вызовов, 66 syntax checks; WB Node: 35 suites, 754/0 на source и ZIP. Проверены повторная упаковка, исходные hashes и остановка runner-а по ошибке. Remote CI PASS: ещё 17 WB browser suites, 321/0 на каждом маршруте; суммарно 52 suites, 1075/0 на source и ZIP. Все три CI artifact скачаны и независимо сверены; 232 удалённых файла совпали с исходниками. Серверный код, конфигурация и lockfile не изменены.

D1.E0: [карта расширений](migration/EXTENSION_IMPORT_MAP.md), [квитанция](migration/evidence/extensions-2026-09-14/README.md), [расхождения](migration/evidence/extensions-2026-09-14/FINDINGS.md). Сверены 76/76 production-файлов с точными ZIP, 100 связей статической загрузки и 176 входов проверок/исторических документов. Локально выполнены закреплённый 514 gate Ozon и проба WB retention; последняя подтверждает 24-часовой default вместо целевого часа. Полная повторная product/installed приёмка не проводилась. Сервер в D1.E0 не изменён.

Историческая приёмка D0: [DOCUMENTATION_ACCEPTANCE](migration/evidence/DOCUMENTATION_ACCEPTANCE.md). Новый сервер прошёл полный CI: 1272 unit, 1507 integration и 85 browser E2E, плюс отдельный regression пути Playwright. Квитанция и границы — [SERVER_IMPORT_ACCEPTANCE](migration/evidence/SERVER_IMPORT_ACCEPTANCE.md). Это серверная приёмка переноса; единое расширение и owner acceptance beta-кандидата остаются отдельными решениями.

S1.1: free beta access and atomic admission приняты в canonical `main` merge-коммитом `d0b54aa5e659932d3fa2d996b572e06aadfffe62`; точная post-merge authority и exact-head CI записаны в [S1.1 remote acceptance](server/S1_1_REMOTE_ACCEPTANCE_2026-09-14.md). В принятую область входят beta access basis/admission, атомарная регистрация, OTP/admin/API/bootstrap и соответствующие PostgreSQL проверки; реальная account auth расширения по-прежнему не подключена.

I1-SRV.0–I1-SRV.4 were historically accepted at `5d7c8853cc69dd95bc6e713cac3fb2aa0a63383c` / PR6; older candidate wording remains historical evidence and does not reopen implementation. I1-SRV.5 adds only the bounded reference acceptance/handoff and is accepted only for that scope. C1 is separately accepted for its bounded development scope. C2.1 is accepted only for durable context/time/restore and fresh-only Work guards. C2.2-A is `ACCEPTED / REMOTE VERIFIED` only for online-first verified cached-bootstrap configuration acquisition, exact signed cache re-verification, durable effective-time/offline-grace classification, context binding and ownership/obsolescence fences. C2.2-B is `ACCEPTED / REMOTE VERIFIED` only for a detached read-only projection of already verified signed Bootstrap V2 metadata. It exposes signed top-level `features`, `entitlements`, configuration identity and already validated signed AI metadata, but always marks `executionAuthority: false` and does not synthesize `capabilities` or `workAllowed`. C2.2-C is `ACCEPTED / REMOTE VERIFIED` only for independent immutable packaged-local capability presence: four reviewed adapter facts (Ozon, Wildberries, ChatGPT web, Alice web), `executionAuthority: false`, zero signed permission bindings and a non-replaceable global authority slot. Runtime key download, TOFU, offline Work, signed-permission→capability mapping, effective executable capability/profile authority, joint offline command/result behavior, S1.2, D3 and Health boundaries remain out of these acceptances.

C2.2-A exact-tree evidence: implementation head `5d93bccac163c8728a8d7a3b1d4b9f23ea16b680`, tree `531033ac08f001dd55427c4ae969a6c4b5d6b861`; all seven exact-head workflows SUCCESS with zero failed workflows; source and extracted focused policy `37/37 PASS` each; Extension I1 `100/100 PASS`; native Chromium PASS; installed-local API/portal/PostgreSQL PASS; Server CI PASS through PostgreSQL integration/migrations/OpenAPI/bridge/build/browser E2E; Extension CI PASS including WB browser baseline. Deterministic ZIP: `1,834,654` bytes, SHA-256 `2c1f5765b0eb382d9387e3ea1a59e71bd549344f10c107a39069d92719f341de`, 39/39 parity with zero byte mismatches. No owner/manual test is required for this bounded step. Full receipt: [C2.2-A R4 acceptance](migration/evidence/extension-i1-c2-2a-2026-09-16/r4/README.md).

C2.2-B exact-tree evidence: implementation head `8a5d9e6ca611d69512ad28fc00684c63bdc87324`, tree `1fb11a510d6dd314a0647c5348e56d1a26bc007e`; focused signed-metadata gate `5/5 PASS` on source and `5/5 PASS` on extracted package; Extension I1 `102/102 PASS`; browser verifier PASS with signed tamper rejection; installed-local API/portal/PostgreSQL PASS; Documentation CI SUCCESS; Extension CI PR and push runs SUCCESS including WB browser baseline. Deterministic ZIP: `1,837,324` bytes, SHA-256 `5badfd1a67a824ecd160694fdb45ee25fb2dac27386e22ab93145eeaca4b6afa`, runtime/extracted/ZIP `39/39/39` with zero byte mismatches. Server CI was not re-triggered because the exact diff has no server/contracts/schema/migration/OpenAPI/server-doc path; accepted base server authority is unchanged. No owner/manual test is required for this bounded step. Full receipt: [C2.2-B R1 acceptance](migration/evidence/extension-i1-c2-2b-2026-09-17/r1/README.md).

C2.2-C exact-tree evidence: implementation head `a1d0a9dc83daf80536f58bf56d498206da8a1eb3`, tree `1f7a54c0ac0c1c95b680071f7036f084715bac4c`; focused packaged-capability gate `5/5 PASS` on source and `5/5 PASS` on extracted package; Extension I1 `104/104 PASS`; browser verifier PASS with signed tamper rejection; installed-local API/portal/PostgreSQL PASS; Documentation CI SUCCESS; Extension CI push and PR runs SUCCESS including WB browser baseline. Deterministic ZIP: `1,839,269` bytes, SHA-256 `61e992cc28323c68bb2f448d88bb2d9ecc7ce2e0f1c9ced5de82b4ac2d123057`, runtime/extracted/ZIP `39/39/39` with zero byte mismatches. Packaged authority input is `2,072` bytes with SHA-256 `17783d63479ab5282b0414fd83bfcecbb8d0ed86f272c5e2f2005a081466e927`. PR19 merged normally into the integration line at `ff55e8aaf3d473582ccce37a89c45098789fa2b3`, tree `cedba79daf0b25109c720c0976bd78deb00834db`, preserving the exact-tested implementation in history. Server CI was not re-triggered because the exact implementation diff has no server/contracts/schema/migration/OpenAPI/server-doc path; accepted base server authority is unchanged. No owner/manual test is required for this bounded step. Full receipt: [C2.2-C R1 acceptance](migration/evidence/extension-i1-c2-2c-2026-09-17/r1/README.md).

The synchronization/integration branch remains a history-preserving candidate; PR9 is not merged by these bounded client acceptances. The previous disk-exhaustion `BLOCKED`, R1 integration `FAIL`, R2 setup-interlock `BLOCKED`, and deterministic RED/GREEN history remain historical evidence and are not rewritten as PASS. S1.2 real email/preprod, D3, full D2/I1, beta and release remain open.

## Следующий этап

[D1.E1](migration/EXTENSION_IMPORT_NEXT_STEP.md) завершён. D2.1 и D2.2 приняты. D2.3 внутренний adapter принят по source/package/remote CI/readback. D2.4 соединение с каталогом/popup/Work/delivery принято в development 0.2.3. S1.1 принят в canonical `main`; [post-merge authority и CI](server/S1_1_REMOTE_ACCEPTANCE_2026-09-14.md) зафиксированы. Early I1 integration continues on the accepted C2 base. C2.2-A, C2.2-B and C2.2-C are accepted within their bounded scopes. The next capability-related C2 step must separately identify explicit reviewed signed server permission keys and define a fail-closed mapping/intersection with the accepted packaged-local authority. Unknown/missing permission cannot activate a local capability, remote allow cannot manufacture an absent packaged capability, and denial must win. Prefer a read-only/non-executing effective-capability result before any Work wiring. Offline Work, provider replay and scheduler authority remain closed. Real S1.2 email/preprod, D3, full installed/live-product acceptance, beta, deployment and release remain later gates.
WB R1–R8 остаются закрыты до установленной приёмки исправленного provider-neutral контура.

## D3/S2 whole-layer closure handoff — 2026-09-18

The integrated Stream-1 candidate has bounded automated implementation evidence
for D3/S2 store/state, rare C3E/C3F coordination, provider quota behavior,
A22/A23 transfer, and A24 local encrypted export/import. The exact crosswalk,
A01–A32 current classification, privacy/architecture audit, regression receipt,
deferred ledger, and Q1 cursor are in [D3S2-4 full coordination closure](development/client-i1/D3S2_4_FULL_COORDINATION_CLOSURE.md).

Recommended architect disposition: `D3S2_PARTIAL_OWNER_DEFERRED_BUT_IMPLEMENTATION_COMPLETE`;
Codex does not self-accept it. No real D3/S2 implementation defect was found.
Owner/live, browser/environment, provisional-review, publication, Q1, and
Stream-2 boundaries remain explicit. The first productive non-owner Q1 task is
`Q1-A-20260919-INSTALLED-UNIFIED-FUNCTIONAL-MATRIX-AND-CURRENT-PACKAGE-REPLAY`;
it is not started in this task.

## Как обновлять

Для каждого принятого изменения указывать версию/коммит, вид проверки, результат и ограничения. Нельзя одновременно оставлять текущему этапу статусы DONE и PENDING. Исторические неуспешные попытки находятся в evidence, а не в текущей строке.

## Q1-A final installed consolidation — 2026-09-19

Q1-A canonical synthetic installed automated acceptance is complete, pending
architect acceptance. See [the final consolidated receipt](development/q1/Q1_A_FINAL_CONSOLIDATED_ACCEPTANCE_2026-09-19.md).

- Recommended status: `Q1A_READY_FOR_ARCHITECT_ACCEPTANCE` (not self-accepted).
- Q1A-01..91: all `INSTALLED_PASS` on frozen package SHA
  `93ba77f6fcac9932e991c94eded2d9638bb38c9990b8fcefd826d737aaf8d476` with
  Playwright Chromium `151.0.7922.34`.
- No Q1-A production extension/server/contract/schema or Stream-2 implementation
  change was made. Zero-control, no-replay, privacy, and architecture
  uniqueness receipts remain consistent.
- The pre-existing untracked `repro/` docs-check failure is unrelated and
  non-blocking. Remote publication remains
  `ENVIRONMENT_DEFERRED_REMOTE_PUBLICATION`.
- Q1 overall, Q1-B, Q1-C, Q1-D, Q1-E, deployment, release, and publication are
  not complete.
- Next recommended independent lane after architect review:
  `Q1-B-20260919-AVAILABLE-BROWSER-FAMILY-MATRIX-AND-MV3-DIFFERENTIAL`.

## Q1-B browser-family matrix — 2026-09-19

Recommended disposition: `Q1B_PARTIAL_ENVIRONMENT_DEFERRED`; Codex does not
self-accept Q1-B. Playwright Chromium 151 remains the only accepted browser
evidence. Real Chrome 147, Opera, Yandex, Firefox runtime, and Safari remain
browser/environment deferred. A deterministic Firefox carrier was added from
the common runtime and is package-ready, not runtime-accepted. See [Q1-B
browser-family matrix](development/q1/Q1_B_BROWSER_FAMILY_MATRIX_2026-09-19.md).

The Chrome 147 differential reproduced branded Chrome refusal of
`--load-extension` and `--disable-extensions-except`; this is an environment
launch boundary, not a product-worker or manifest defect. Q1 overall, Q1-C,
Q1-D, Q1-E, deployment, publication, and monetization remain open.

## Q1-D admin/security/preprod/rollback — 2026-09-21

Bounded automated evidence is recorded in [Q1-D admin/security/preprod/rollback](development/q1/Q1_D_ADMIN_SECURITY_PREPROD_ROLLBACK_2026-09-21.md).
The candidate recommendation is `Q1D_READY_FOR_ARCHITECT_ACCEPTANCE`; Codex
does not self-accept. Admin authorization, session/CSRF/origin controls,
support restrictions, capacity/audit safety, diagnostics privacy,
preprod/production separation, secret scanning, disposable migration/deploy
failure detection, application rollback, and Bootstrap trust rotation/rollback
passed. SMTP/Exim owner actions, Q1-C owner/live testing, browser publication,
legal/paid actions, and production publication remain deferred independently.

## B1 managed free-beta release preparation — 2026-09-21

The automated candidate receipt is [B1 free-beta release preparation](development/b1/B1_FREE_BETA_RELEASE_PREPARATION_2026-09-21.md).
It recommends `B1_AUTOMATED_RELEASE_PREP_PARTIAL_EXTERNAL_GATES` and is not
self-accepted. Node 24 release parity, exact RC package manifest/hashes,
installation and publisher metadata, onboarding state machine, beta-capacity
procedure, compatibility matrix, upgrade/rollback procedure, safe diagnostics,
release notes, and privacy/security gates passed. S1.2 real mailbox delivery,
Q1-C owner/live testing, browser environment follow-up, publication/legal
actions, and production launch remain outside this automated lane.

## B2 feedback / support / iteration foundation — 2026-09-21

B2-A is an automated implementation candidate on the dedicated branch; its
evidence is [B2 feedback/support foundation](development/b2/B2_FEEDBACK_SUPPORT_FOUNDATION_2026-09-21.md).
The recommendation is `B2A_READY_FOR_ARCHITECT_ACCEPTANCE`, not a self-
acceptance. User-owned cases, support/admin workflow, safe diagnostics,
redaction, audit references, aggregates, configurable 90/180-day provisional
retention and account anonymization are covered by migration 0019, API/UI and
Node 24/PostgreSQL evidence. SMTP/Exim, Stream 2, live owner traffic and
publication were not modified.

## M1 commercial entitlement foundation — 2026-09-21

The M1-A automated candidate is recorded in [the M1 receipt](development/m1/M1_COMMERCIAL_ENTITLEMENT_FOUNDATION_2026-09-21.md).
It adds only a provider-neutral Seller Agents commercial policy/event boundary
and an explicit `DISABLED` production default. Free beta remains the active
access basis; no payment provider, checkout, real subscription, pricing or
SMTP/Exim path was enabled or modified. The candidate is not self-accepted.

## M1-B device / installation admission foundation — 2026-09-21

The bounded M1-B candidate is recorded in [the M1-B receipt](development/m1/M1_DEVICE_INSTALLATION_LIMIT_FOUNDATION_2026-09-21.md).
It adds an explicit provider-neutral `UNLIMITED | positive finite` device-limit
model and binds positive finite admission to the existing atomic P2.5 account
transaction. FREE_BETA remains unlimited, commercial enforcement remains
disabled, and ordinary Work/delivery has no device-limit call, lease or
heartbeat. No migration, payment provider, checkout, SMTP/Exim or Stream-2
change was made. The candidate recommends
`M1B_READY_FOR_ARCHITECT_ACCEPTANCE`; Codex does not self-accept.

## M1-C detailed funnel foundation — 2026-09-21

The bounded M1-C candidate is recorded in [the M1-C receipt](development/m1/M1_DETAILED_FUNNEL_FOUNDATION_2026-09-21.md).
It reuses B2-A signals rather than creating another telemetry system and adds
privacy-safe funnel definitions, cohort math, time-to-value, safe dimensions,
idempotent first milestones, support funnel stages and admin-only aggregate
views. Commercial enforcement, checkout, third-party analytics and live
measurement remain disabled. Recommendation:
`M1C_READY_FOR_ARCHITECT_ACCEPTANCE`, not self-acceptance.

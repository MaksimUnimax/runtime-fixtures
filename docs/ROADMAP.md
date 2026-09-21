# Общий roadmap

Статусы относятся к Seller_Agents, а не автоматически к исходным проектам.
D0 и D1 COMPLETED. D1.S1 (сервер), D1.E0 (карта расширений), D1.E1 (исходники/тесты/пакеты) приняты. D2 IN_PROGRESS, D2.1 ACCEPTED, D2.2 ACCEPTED; D2.3 internal adapter ACCEPTED / SOURCE-PACKAGE-REMOTE PASS; D2.4 DEVELOPMENT_APPLICATION_VERIFIED / SOURCE-PACKAGE-NATIVE-CI-READBACK PASS; перенос не означает готовность единого продукта.

| Этап | Работа | Критерий завершения |
|---|---|---|
| D0 | Каркас, ТЗ, архитектура, правила и карта миграции | Документы опубликованы, ссылки/решения проверены, отчёт владельцу |
| D1 COMPLETED | Отдельный перенос источников архитектором | Точные source-коммиты и файлы сопоставлены; сохранены проверки и ограничения; независимые исходные контуры воспроизводимы |
| D2 | Объединение расширений в общее ядро и адаптеры | Установленная единая сборка работает с Ozon/WB без смешения магазинов; проверки идут на каждом шаге |
| S1 параллельно D2 | Codex: сервер под новую бету, препрод, почта, общий доступ | Настоящая авторизация установленной сборки и бесплатный доступ |
| I1 как только готов первый общий сценарий | Раннее подключение расширения к серверу | Вход → команда → маркетплейс → результат в ИИ; автономность подтверждена |
| D3/S2 | Согласованные магазины, состояния, редкая синхронизация, перенос; эксплуатация/мониторинг | Полный функциональный кандидат беты |
| Q1 | Общая установленная и эксплуатационная приёмка | Критические сценарии, финальные пакеты, совместимые версии и восстановление приняты |
| B1 | Бесплатная бета с управляемыми регистрациями | Минимальный сайт работает; открытая владельцем квота; выпуск принятых браузерных пакетов |
| B2 | Обратная связь и улучшения | Измеряются самостоятельное подключение, полезность, ошибки и время поддержки |
| M1 позже | Монетизация, ограничения установок, подробные воронки | Отдельная продуктовая готовность и согласованная коммерческая политика |

S1.1 `DONE / REMOTE ACCEPTED`: free beta access and atomic admission are
published on canonical `main` at merge commit
`d0b54aa5e659932d3fa2d996b572e06aadfffe62`. The exact post-merge authority,
source lineage, CI runs, scope, and boundaries are recorded in
[S1.1 remote acceptance](server/S1_1_REMOTE_ACCEPTANCE_2026-09-14.md).

## D1 — границы

Подэтапы расширений: [D1.E0 — источники/карта](migration/EXTENSION_IMPORT_MAP.md) завершён; [D1.E1 — неизменённый Ozon baseline, WB reference и исходные тесты](migration/EXTENSION_IMPORT_NEXT_STEP.md) завершён; [приёмка](migration/evidence/extension-import-2026-09-14/README.md): remote CI и readback PASS. D1.E0 выявил разный TTL WB и внешний matrix input Ozon; исправление поведения относится к D2, фиксация проверочного входа — к D1.E1.

Перенос не означает автоматическое принятие WB. Его текущий FAIL и незакрытая полнота сохраняются.
При необходимости исходный WB помещается в изолированный reference-каталог по migration/PLAN.md, без подключения к production-графу.
Не выполнять WB R1–R8 до установленной provider-neutral приёмки.
Старые Ozon design forks не объединять без semantic differential и доказанной необходимости.

## D2 — внутренняя последовательность

D2.4 DEVELOPMENT_APPLICATION_VERIFIED: [каталог и общая application orchestration](development/EXTENSION_APPLICATION.md), development 0.2.3; [квитанция](migration/evidence/extension-application-d2-4-2026-09-14/README.md). Пункты 4–5 проверены на source/ZIP и native synthetic fixture в указанном объёме; полная installed приёмка D2 впереди. Следующий отдельный интеграционный участок — ранний I1.

D2.3: [адаптер WB/shared queue](development/EXTENSION_WB_ADAPTER.md), [квитанция](migration/evidence/extension-wb-adapter-d2-3-2026-09-14/README.md). Внутренний API в actual worker/package принят по source/ZIP/remote CI/readback. На момент D2.3 пользовательские WB popup/Start/delivery ещё не были подключены. D2.4 соединяет эти адаптерные порты с этапом 4.

D2.2: очередь вынесена в bridge-core, контекст пакета защищает dispatch и delivery. [Приёмка](migration/evidence/extension-context-d2-2-2026-09-14/README.md) завершена: source/package/remote CI/readback PASS. На момент D2.2 настоящий каталог и WB adapter оставались следующими шагами.

Первый шаг D2.1: общие Work/discovery/execution/delivery-модули подключены в development-сборку Ozon 0.2.0. [Описание](development/EXTENSION_CORE.md), [приёмка](migration/evidence/extension-core-d2-1-2026-09-14/README.md): source/package/remote CI/readback PASS. Это начало последовательности ниже, а не готовое единое расширение.

1. Сопоставить subsystem authority и зависимые файлы.
2. Проверить общий Work Start/Finish, capture, очередь и доставку.
3. Подключить отдельные marketplace adapters.
4. Добавить общую модель магазинов и popup.
5. Проверить Ozon/WB в разных диалогах и два магазина одной площадки.
6. Подключить I1 до окончания всех последующих функций.
7. Доводить редкие сценарии отдельными задачами без зависимости обычного выполнения от сервера.

## Серверная параллель

Старый порядок «сначала весь P8–P10, затем реальное расширение на P11» заменён ранним I1.
Сохраняются принятые домены и проверки. Codex получает задачи по новым требованиям, не переписывает принятый сервер целиком.
S1.1 free beta eligibility и quota регистраций приняты. `I1-SRV.0`–`I1-SRV.4` исторически приняты на canonical `main` at `5d7c8853cc69dd95bc6e713cac3fb2aa0a63383c` / PR6 ([I1-SRV.3 evidence](server/I1_SRV_3_BOOTSTRAP_TRUST_HANDOFF_ACCEPTANCE_2026-09-15.md), [I1-SRV.4 evidence](server/I1_SRV_4_ERROR_REVOCATION_OFFLINE_ACCEPTANCE_2026-09-15.md)). `I1-SRV.5` accepted at `086ae20c2858849ec13b1ab67c2f7661259022c3` only for server/reference lifecycle and fixture gates. C1 is separately accepted at `56c81a3521c02502b65fd713aec890e5a30f038d` only for source/package/native and installed-local development scope. The history-preserving synchronization candidate remains on `integration/i1-c1-srv5-2026-09-16`; C2.1 is accepted at `4acc5fb3336e3e38fa30d6a7ec16c80730bcd7e1`, C2.2-A is `ACCEPTED / REMOTE VERIFIED` on tested implementation head `5d93bccac163c8728a8d7a3b1d4b9f23ea16b680`, tree `531033ac08f001dd55427c4ae969a6c4b5d6b861`, C2.2-B is `ACCEPTED / REMOTE VERIFIED` on tested implementation head `8a5d9e6ca611d69512ad28fc00684c63bdc87324`, tree `1fb11a510d6dd314a0647c5348e56d1a26bc007e`, C2.2-C is `ACCEPTED / REMOTE VERIFIED` on tested implementation head `a1d0a9dc83daf80536f58bf56d498206da8a1eb3`, tree `1f7a54c0ac0c1c95b680071f7036f084715bac4c`, C2.2-D1 is accepted on exact tested server-vocabulary head `fdccf06fbdb3d67beafd0ca1759db74018f6a475`, and C2.2-D2 is accepted on exact tested implementation head `860b4799eb5bf627e14bfbc7bcfff53a241a2800`, tree `305d326add8f04a9bb28dbbaee99abefbfdbe466`. PR18 was merged into the integration line at `c6fc2363f25e02e5ff7ce548164df7a37b94bcf8`; PR19 at `ff55e8aaf3d473582ccce37a89c45098789fa2b3`; D1 PR20 at `66140093650dae057b4bb9017d49f48faeb7c5db`; D2 PR21 at `a2c9cdbd48914f6abf1e40221de4b64f1e5e76a7`. These merges preserve their exact-tested implementation commits/trees without redefining exact-tree evidence. Canonical `main` is `bc718cc5c677ad0eb4598e7de3ad766473ff0847`; PR7 and PR8 remain draft/unmerged and PR9 remains the draft synchronization/integration PR. See the [reference acceptance](server/I1_SRV_5_REFERENCE_ACCEPTANCE_2026-09-16.md), [synchronization handoff](server/I1_SERVER_EXTENSION_SYNC_2026-09-16.md), [sync evidence](server/evidence/i1-sync-2026-09-16/README.md), [C2.2-A acceptance](migration/evidence/extension-i1-c2-2a-2026-09-16/r4/README.md), [C2.2-B acceptance](migration/evidence/extension-i1-c2-2b-2026-09-17/r1/README.md), [C2.2-C acceptance](migration/evidence/extension-i1-c2-2c-2026-09-17/r1/README.md), and [C2.2-D2 acceptance](migration/evidence/extension-i1-c2-2d2-2026-09-17/r1/README.md).
The synchronization candidate is the dependency boundary before C2; it does not reorder the wider roadmap. Real OTP/email provider and preprod remain deferred to S1.2; P8.4 H3 remains separate Stream B authority. Health/P8.4 acceptance remains separate. S1.2 real email/preprod, D3, full D2/I1, beta and release remain open.

C2.2-A is closed only for online-first verified cached-bootstrap configuration acquisition with the durable effective-time floor, signed cache re-verification, context binding and ownership/obsolescence fences. C2.2-B is closed only for read-only projection of those already verified signed `features`, `entitlements`, and signed AI metadata; it always exposes `executionAuthority: false` and does not create `capabilities` or `workAllowed`. C2.2-C is closed only for the independent immutable packaged-local capability-presence authority: the current package records Ozon, Wildberries, ChatGPT web and Alice web adapter presence, with `executionAuthority: false` and zero signed permission bindings. C2.2-D1 is closed only for the explicit server-owned BOOLEAN/CAPABILITY permission vocabulary `source.ozon`, `source.wildberries`, `ai.chatgpt`, `ai.alice`; it does not seed or grant them. C2.2-D2 is closed only for the immutable read-only fail-closed mapping/intersection of those four signed entitlement keys with the four packaged capabilities. Missing/false signed permission denies, signed `features` cannot substitute, unknown keys cannot infer a binding, non-BOOLEAN reviewed values fail closed, and every D2 surface remains `executionAuthority: false`.

The next capability-related dependency is now server-side and remains **before** Work/offline wiring. Current `beta-access` resolves only `BETA | NONE` and contains no per-capability permission policy. Current Bootstrap signs commercial entitlements only when commercial access is independently eligible; beta-only snapshots therefore currently sign `entitlements: {}` and D2 correctly denies. The next bounded step must define an explicit reviewed Seller Agents capability-permission policy for the authorized access bases and emit only that reviewed policy through the existing signed entitlement map. It must not infer capability permission from beta status, signed feature names, provider-specific entitlement keys or package-local ids. `NONE` and malformed/unknown policy remain fail-closed; commercial plan entitlements remain authoritative for commercial access; beta/commercial overlap must be explicit. Only after this server result is separately accepted may a later step make D2 participate in executable Work authority while retaining account/session generation, compatibility, AI-profile, Health, freshness and state-machine gates. Offline Work, provider replay, joint offline command-result completion and scheduler integration remain closed.

Health, S1.2/D3, full I1/D2, the Octoport domain migration, beta, deployment and release remain separate open work.
C3H corrected-autonomy, post-C3H P2 joint offline command/result recovery, and P3 extension-local technical scheduler integration are `IMPLEMENTED_CANDIDATE` items with automated evidence ready for architect review; none is marked accepted. Receipts: [C3H corrected autonomy](development/client-i1/C3H_CORRECTED_AUTONOMY_FULL_ACCEPTANCE_2026-09-18.md), [P2 joint result recovery](development/client-i1/POST_C3H_P2_JOINT_OFFLINE_COMMAND_RESULT_RECOVERY_2026-09-18.md), and [P3 local scheduler](development/client-i1/POST_C3H_P3_LOCAL_SCHEDULER_INTEGRATION_2026-09-18.md). Full Early-I1/D2 pre-handoff remains the next separate dependency; Stream 2 monitoring remains separate and untouched.

`EARLY_I1_D2_AUTOMATED_PREHANDOFF_CANDIDATE_READY` is recorded locally on the bounded acceptance branch, pending architect acceptance. This is not Q1, D3/S2, B1, production deployment, or a cross-browser acceptance.
Расширенное администрирование мониторинга и платежи не предшествуют первому общему сценарию.
Минимальный сайт регистрации/установки/обратной связи обязателен до B1; продающие воронки развиваются позже.

## D3S2-2A local candidate

Credential transfer control-plane and ephemeral-relay foundation is
`IMPLEMENTED_CANDIDATE / REMOTE_NOT_VERIFIED`. It remains bounded, does not
self-accept A22/A23, and does not start A24 export/import. See
`development/client-i1/D3S2_2A_CREDENTIAL_TRANSFER_FOUNDATION.md`.

## D3S2-3 A24 local candidate

A24 `SA-KEY-02` is `IMPLEMENTED_CANDIDATE / REMOTE_NOT_VERIFIED / ARCHITECT_REVIEW_REQUIRED` on the bounded branch `feature/d3s2-a24-export-import-2026-09-18`. It adds only local encrypted all-active-store export/import, exact adapters for the real historical Ozon/WB credential backup formats, strict account/conflict/tombstone handling, and no cloud-backup route. Focused EX-01..EX-74 and actual unpacked Chromium source/generated plus extracted/package journeys are green within the recorded scope. It is not A24 acceptance, does not reopen A22/A23, and does not start Q1, S1.2, Stream 2, deployment, browser publication, or monetization. See [A24 evidence](development/client-i1/D3S2_3_A24_EXPORT_IMPORT.md).

## D3/S2 whole-layer closure handoff — 2026-09-18

The current integrated Stream-1 candidate has bounded automated implementation
evidence for store/state, rare sync/reconciliation, quota handling, A22/A23
credential transfer, and A24 local encrypted export/import. The closure receipt
is [D3S2-4 full coordination closure](development/client-i1/D3S2_4_FULL_COORDINATION_CLOSURE.md).
The recommended architect disposition is
`D3S2_PARTIAL_OWNER_DEFERRED_BUT_IMPLEMENTATION_COMPLETE`; this is not a
self-acceptance. No D3/S2 implementation defect remains in the bounded scope.

The current gates outside that scope are preserved: owner-authenticated I1
health/work, live provider rights/account proof, browser-family environments,
the A24-current installed transfer rerun blocked by host disk exhaustion,
provisional transfer/export owner decisions, remote publication, Q1 operational
acceptance, and Stream-2 monitoring. The next productive non-owner Q1 cursor is
`Q1-A-20260919-INSTALLED-UNIFIED-FUNCTIONAL-MATRIX-AND-CURRENT-PACKAGE-REPLAY`;
it is a handoff only and is not started here.

## Браузеры и ИИ

Chrome, Opera, Yandex, Firefox и Safari — архитектурные цели. Принятая поддержка фиксируется по фактическому браузеру/ОС/ИИ/пакету.
Отсутствие Mac не разрешает назвать Safari проверенным. До реальной приёмки отображается соответствующий статус.
Новые ИИ подключаются отдельными адаптерами после проверки; их число не является мерой готовности беты.

## Q1-A installed automated lane — 2026-09-19

The canonical Q1-A synthetic installed matrix is complete and pending
architect acceptance. See [the final consolidated receipt](development/q1/Q1_A_FINAL_CONSOLIDATED_ACCEPTANCE_2026-09-19.md).

- Status: `Q1A_READY_FOR_ARCHITECT_ACCEPTANCE` — recommendation only; Codex does
  not self-accept.
- Q1A-01..91 are all `INSTALLED_PASS` on frozen package SHA
  `93ba77f6fcac9932e991c94eded2d9638bb38c9990b8fcefd826d737aaf8d476`, with
  canonical Playwright Chromium `151.0.7922.34`.
- Q1-A closure changed no production extension, server, contract, schema, or
  Stream-2 implementation files. Generic C3E mismatches are pre-existing and
  non-canonical; canonical C3E remains green.
- Q1 overall, Q1-B, Q1-C, Q1-D, and Q1-E remain open. Owner, browser-family,
  publication, and environment gates remain deferred.
- Recommended next independent Stream-1 lane after architect review:
  `Q1-B-20260919-AVAILABLE-BROWSER-FAMILY-MATRIX-AND-MV3-DIFFERENTIAL`.

## Q1-D admin/security/preprod/rollback — 2026-09-21

The bounded automated Q1-D candidate is recorded in [the Q1-D receipt](development/q1/Q1_D_ADMIN_SECURITY_PREPROD_ROLLBACK_2026-09-21.md).
It recommends `Q1D_READY_FOR_ARCHITECT_ACCEPTANCE` and is not self-accepted.
Admin RBAC/session/CSRF, support restrictions, capacity mutation authority,
safe audit/diagnostics projections, environment and trust separation, secret
boundaries, migration failure detection, application rollback, and trust
rotation/rollback passed in disposable/local evidence. SMTP/Exim, Stream 2,
Q1-C owner/live testing, and production publication remain outside this lane.

## B1 managed free-beta release preparation — 2026-09-21

Automated release preparation is recorded in [the B1 receipt](development/b1/B1_FREE_BETA_RELEASE_PREPARATION_2026-09-21.md).
The candidate recommendation is `B1_AUTOMATED_RELEASE_PREP_PARTIAL_EXTERNAL_GATES`;
Codex does not self-accept B1 release. Node 24 parity, package identity,
installation/publisher preparation, compatibility, upgrade/rollback,
diagnostics/privacy, deployment checklist, and compact extension/server smoke
are complete. Real OTP mailbox delivery, Q1-C owner/live sessions, browser
environment follow-up, store publication, legal acceptance, and production
cutover remain deferred.

## B2 feedback / support / iteration foundation — 2026-09-21

The bounded B2-A feedback and support foundation is recorded in [the B2 receipt](development/b2/B2_FEEDBACK_SUPPORT_FOUNDATION_2026-09-21.md).
It recommends `B2A_READY_FOR_ARCHITECT_ACCEPTANCE` and is not self-accepted.
The additive migration 0019/API/UI surface provides authenticated own-case
feedback, Q1-D-integrated support/admin workflow, strict safe diagnostics,
redaction, bounded rate limits, privacy-safe aggregates, configurable
provisional retention, account anonymization, and release/version linkage.
It has no SMTP dependency and does not modify Stream 2. Real beta traffic,
owner/live sessions, external OTP receipt, publication and monitoring remain
separate gates.

## M1 commercial entitlement foundation — 2026-09-21

The provider-neutral commercial entitlement foundation is recorded in [the M1
receipt](development/m1/M1_COMMERCIAL_ENTITLEMENT_FOUNDATION_2026-09-21.md).
It is an automated implementation candidate only; it does not enable billing,
checkout, real subscriptions, pricing, a payment provider, or change the
free-beta experience. Seller Agents commercial mode is explicitly `DISABLED`
by default, with normalized entitlement-event idempotency and monotonic
revision semantics. Provider selection, pricing/trial policy, legal decisions,
S1.2 owner infrastructure actions, Q1-C live testing, publication and
production launch remain deferred.

## M1-B device / installation admission foundation — 2026-09-21

M1-B is an automated implementation candidate in [the M1-B receipt](development/m1/M1_DEVICE_INSTALLATION_LIMIT_FOUNDATION_2026-09-21.md).
The counted unit is the existing account-bound authenticated `devices.id`; the
existing PostgreSQL activation transaction remains the only future admission
enforcement point. The provider-neutral model supports explicit unlimited or
positive finite limits, while current FREE_BETA remains unlimited and
commercial enforcement remains disabled. No runtime lease, heartbeat,
per-command check, payment provider, checkout, migration, SMTP/Exim or
Stream-2 implementation change was made. Recommended disposition is
`M1B_READY_FOR_ARCHITECT_ACCEPTANCE`; no commercial numeric limit was chosen.

## M1-C detailed funnel foundation — 2026-09-21

The bounded M1-C candidate is recorded in [the detailed funnel receipt](development/m1/M1_DETAILED_FUNNEL_FOUNDATION_2026-09-21.md).
It reuses the B2-A signal authority and adds versioned onboarding, first-value,
and support funnels, deterministic conversion/time-to-value calculations,
safe dimensions, idempotency, deletion handling and admin-only aggregate
queries. Commercial stages are schema-compatible only; free-beta UX and
commercial enforcement remain unchanged. Recommended disposition is
`M1C_READY_FOR_ARCHITECT_ACCEPTANCE`; no live measurements or monetization
launch is claimed.

## Q1-B browser-family matrix — 2026-09-19

Recommended status: `Q1B_PARTIAL_ENVIRONMENT_DEFERRED`; architect review is
required. The exact Q1-A package passes canonical Playwright Chromium 151
reference evidence. System Google Chrome 147 was tested directly, but branded
Chrome rejects the unpacked-extension command-line flags, so Chrome is not
accepted from that run. Opera, Yandex, real Firefox, and Safari remain
deferred. A deterministic Firefox-specific package was implemented from the
unified runtime and is ready for a real Firefox environment. See [the Q1-B
receipt](development/q1/Q1_B_BROWSER_FAMILY_MATRIX_2026-09-19.md).

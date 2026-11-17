# ALISA: existing owner OAuth for the legacy Yandex Dialogs URL

This source-only continuation is stacked on the already-installed Station coefficient bridge `485a2034`. It does **not** grant, issue, refresh or migrate an owner token. The previous accepted value `delivery_mean=101.61482484 RUB/ordered_unit` remains unmodified until a real authorized voice confirmation. No coefficient calculation, running job or installed Station setting is changed by this source.

## Actual failure (17 November 2026)

Yandex called `/oauth/refresh` twice (HTTP400), then `/oauth/authorize` (HTTP200). The legacy skill webhook was invoked twice without an OAuth bearer. The lab's running SQLite `tokens` table contained0rows, and the old authorization page requires `demo-a`/`demo-b` login instead of the actual Octoport owner. The connected Station Quasar pairing and its explicit owner-write permission were valid and not the failure. There was no saved coefficient or OwnerCommand. Never fabricate/mirror tokens or issue a consent on behalf of the user.

## Minimal compatibility change

The old configured public URL remains `alice-lab.octoport.ru`. On that host, `GET /oauth/authorize` redirects to the *already-installed* Octoport website authorization handler. `POST /oauth/token` and `/oauth/refresh` proxy to its existing OAuthlib token/refresh route. The existing confidential OAuth client id, secret, skill id and `reports:read` scope match in the active lab and platform settings (secret values not copied). Authorization codes are issued only after the owner logs in through the existing Octoport WebSession and approves a browser consent.

The legacy skill keeps its old webhook and actual Station binding. For a modern `as6_` access token it obtains the verified native tenant from the already connected Station Unix socket; only the existing platform private BFF/service-token boundary can validate the signed/current OAuth access token and existing membership. A caller cannot supply a native tenant, client id or owner to claim another shop. Station matches both the existing owner and currently paired native tenant and rechecks the opaque bearer for each turn **before acquiring the Station lock**, preserving callback liveness. The raw bearer is removed from the incoming message before Station receipts/state. The old token path and default Station call signature remain unchanged. No new daemon, public authorization grant, credential, role or broad authority is created.

`compose.py` refuses if exact old source hashes or unique text anchors change. On the actual Alisa installation, the composed Station+lab files compiled and the generated Nginx config passed `nginx -t`. These snippets are not themselves a production install or authorization; activation must guard the exact baseline again, carry prior rollback source hashes and preserve running services. Yandex can legitimately request account-linking; a Quasar login is **not** a Yandex Dialogs OAuth consent. The owner must approve the genuine account link when Yandex prompts; ChatGPT cannot manufacture that step with a database update.

## Exact-source tests

Fourteen owner-token and revocation/currentness tests passed on isolated PostgreSQL with the real OAuthlib validator (including revocation, client id and cross-tenant mapping). The first run failed because of a deliberately sparse dev checkout, and the second caught a missing client-id check; both are retained as failures. The exact corrected tests pass. On Alisa, the combined old Station lab and composed new adapters passed **67 legacy+new tests** under unprivileged `alice-lab`/PrivateNetwork, with zero failures/skips/errors. The earlier isolated fixture run of 53 tests caught a modified old mock signature; that was restored. The ten focused modern-Station tests covered owner/session binding, token-hash substitution, pre-lock platform validation, no bypass of former legacy flows and timeout/revocation denials. A new Nginx candidate was verified with a standalone `nginx -t`; live Nginx was not reloaded.

The current CI voice qualifier now includes the same 10 new Django tests in its existing disposable PostgreSQL step. CI/source build, independent review and an actual installed forward/rollback gate remain separately required. The physical owner voice confirmation, cabinet readback and same-source economics are acceptance after *legitimate* OAuth reauthorization, not proof of this source-only work.

## Additional platform currentness gate

A second independent binding check is needed during `station_parameter_authority` reverse RPC: the existing `station_authority.usable` checked the legacy lab SQLite access token after it was replaced by modern Octoport OAuth. It therefore refused otherwise valid client-confirmed manual writes. The new read-only `legacy_station_token_current` under the **existing authenticated platform internal endpoint** checks only a SHA256 access hash, exact owner UUID and native tenant against the existing OAuth TokenFamily, link/client revision, expiry, revocation and owner membership. No token contents/secret or refresh response are exposed, no TTL is extended. Station persists a `'modern'` receipt marker but never the bearer; the reverse check reads a published immutable view and calls the platform **without taking the Station ingress lock**. Legacy voice receipts still call the unchanged lab DB path.

Actual platform responses contain the standard `environment` and `release` metadata in addition to `identity`/`current`; strict handlers allow only that exact known envelope (and standalone fake without it), rejecting arbitrary unknown keys. The initial expanded182-case PostgreSQL test found this mismatch, which was corrected; the final **182 tests PASS**. The final **67 Station tests PASS**; previous red runs and fixture-environment failures remain preserved, not renamed or combined as successes. All are scoped to owned disposable PostgreSQL / existing installed source copies, not LiveOwner.

This source still cannot authorize the user on Yandex's behalf. The actual owner must approve an OAuth account-link through Yandex's UI after installing this compatibility patch. The previously accepted direct Quasar scenario was not retried. No real coefficient was silently written.

## 17 November continuation: real HTTP proof before deployment

The whole first Source CI44086084936 failed before checkout because the hosted PostgreSQL host port55480 was occupied; all product steps were skipped. Documentation passed. This is retained as a failed infrastructure run, not reported as a code pass.

Fresh production metadata shows another continuation installed diagnostic lab alice_lab.py9d11c4af39cd2876b096b551cc239c146982c054ec78dab8a180d8d4eb517785; the only code delta adds safe OAuth rejection reasons. Composition now explicitly pins and preserves that version instead of silently restoring the older lab. No live file was edited here.

The author discovered that imported station_parameters.platform targets the coefficient endpoint, not account/alice. The OAuth helper now has its own fixed-path, no-redirect/no-retry, size-limited loopback client for only read-only identity/currentness actions using the already available private service credential. No credential value is in the source or evidence. A separate proposed timeout/header refinement was tool-blocked before execution and sent to its review panel; it has NOT been applied or rerouted. The currently tested client has bounded socket waits and a body deadline; no stricter whole-call deadline is claimed.

Two original report-flow integration issues were also corrected: modern jobs preserve their authorization scheme; expired access may wake an existing report only while the same current owner family is refreshable. Status text remains hidden until a fresh authenticated callback. Temporary authority failure raises a retryable error instead of falsely marking the existing report revoked. Actual revocation still denies all data.

**17 tests PASS** on the real loopback HTTP route, disposable PostgreSQL, actual native Unix gateway and Station reverse-authority socket. Tests exercise the new verified bearer -> proposal -> explicit confirmation -> shared parameter writer -> cabinet read; the saved synthetic value is0.12, one metadata-only receipt, unchanged Station pairing, no raw bearer in its state. Revoked OAuth prevents the confirmation, absent consent prevents preparation, expired access denies writes while allowing only safe report wake-up, and temporary HTTP failure does not cancel an existing report. Other tests cover exact endpoint/action, duplicate/truncated/large JSON, redirects, no issue/write action, no external target or credentials. All fixtures are synthetic and on PrivateNetwork; no live owner value was changed. The new chain is registered in the existing Source workflow as its own finite systemd/owned-PostgreSQL check, not a new daemon/workflow.

Next: independent review of this exact correction, current-source CI and guarded coordinated installation. Only after the real Yandex owner authorizes the OAuth link can the live voice write be accepted; do not repeat the old ambiguous scenario.

## Installed minimal schema, not the wider repository variant

Fresh server inspection confirmed that the installed platform intentionally excludes AliceLink parameter_write_* columns/migration0002. Its models.py/views.py/oauth.py match3f2527482db8fd7edb240258fae814d38adc0f4f byte-for-byte. Copying the full repository alice_link/views.py would reintroduce unsupported consent/projection paths. `compose.platform_sources` now verifies all three exact installed baseline hashes and adds ONLY the two read-only identity/currentness functions and three private action selectors. The old cabinet/OAuth projection and consent behavior are retained, no new model/migration/grant is included.

A15610byte two-file historical fixture reproduces that installed input in shallow CI; unchanged oauth.py is separately pinned. `qualify_owner_minimal.py` makes an owned temporary RAM copy of the existing platform source, applies only the old-schema baseline and exact minimal views change, verifies no migration drift, and runs the applicable storage, Station, currentness, real HTTP and no-new-schema cases. **163 tests PASS**, zero errors/failures/skips/external calls. Source copy/ownedPG/container/sockets cleaned; original source hashes unchanged. The new views SHA is f1e3b1138ff5c653d991a6fd1f69eb169ae21fa676299b27d3d60f262459402a. This result is source/disposable qualification, not installation.

Independent gpt-6-luna review R2 returned REQUEST_CHANGES for a conditional lock-cycle concern and a real non-total HTTP deadline. After examining the complete actual callback, R3 explicitly RETRACT_LOCK_FINDING: it uses immutable published views and never acquires the ingress locks. The reviewer did NOT approve the patch; the HTTP deadline remains OPEN. The exact pending tool-review refinement has not executed, been retried or routed through another writer. Parent source and tests above do not replace independent acceptance.

Latest previously published headcbf74fb7 CI had all job steps green by the final observation. Exact new-head CI after this minimal composition must be read separately. No production OAuth/token/speaker mutation or coefficient write was performed. Next executable source operation is the exact pending HTTP deadline refinement, then its timing regressions/review and a coordinated platform+Station+lab+Nginx install with existing source guards. No blanket repeat of accepted R15 deployment.


## Concurrent installed lab baseline (17 Nov 14:17 UTC)
A parallel authorized installation changed the legacy Yandex Lab working root to
station-auth-renewal-dfc2a54a-20261117-b0e559215333e42f. The active
alice_lab.py SHA256 is dfc2a54adba774daf22dcabacc4c5b91f26c803b5104e3bb6ef3366c9443b14a.
This adds a controlled refresh of the existing demo login form before legacy
submission. The OAuth composer pins this new accepted baseline instead of
restoring the older diagnostics-only Lab file. It must compose against the
exact freshly observed installed file and preserve all parallel changes;
it does not deploy the old form or change owner authorization. Original
Station and Nginx pins still match. Rerun combined Station tests after
composing this current lab source.


## Source follow-up: absolute HTTP boundary and current Lab compatibility
17 November 2026 (reviewed source before deployment): Independent gpt-6-luna
static review R8 returned APPROVE for exact station_oauth.py and
test_http_transport.py bytes, after R6/R7 REQUEST_CHANGES were individually
resolved; final response is checked against the monotonic deadline, real
socket reads are limited under that deadline, parse is reserved 25ms and
late authorization is denied. A test intentionally delays even a fully
buffered JSON decode to prove no late success. External scheduling preemption
cannot be forcibly interrupted, so the security guarantee is fail-closed
authorization, not real-time CPU execution.

The minimal already-installed old-schema chain passed 167/167 tests, zero
failures, skips or external connections (source-only owned PostgreSQL).
On the actual server, exact current station baseline and concurrent Lab
renewal dfc2a54a compose cleanly with preserved original OAuth and form
source; 67/67 legacy and new Station unit tests passed under alice-lab with
PrivateNetwork. A separate test_lab_session invocation found no tests and is
not counted. Existing Nginx exact source passed isolated nginx -t previously.
No service restart, real coefficient write, token issuance or owner OAuth
approval was performed by these source tests. Exact-head GitHub CI after
publication is a separate gate, as is a guarded activation and LiveOwner.

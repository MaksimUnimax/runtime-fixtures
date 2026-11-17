# Manual voice coefficient writes — source candidate, 17 November 2026

Scope: saved coefficients only. This is not AL-S16/UNKNOWN reconciliation and does not change economics formulas, historical coefficients, seller credentials or runtime jobs.

## User path implemented in source

An existing cabinet owner can explicitly enable or disable manual coefficient writes for the already connected platform AliceLink. The existing `/api/account/alice` BFF retains its origin/cookie/body guards. The page explains that people with access to the linked Alice device can invoke this permission. Existing OAuth scope remains `reports:read`; it supplies identity only. A separate current server-side consent is required for mutation. Enabling the consent does not rotate tokens or alter the AliceLink revision or require relinking.

A command such as `Установи коэффициент потерь 12 процентов` prepares a signed120second confirmation bound to actual customer, tenant, link revision, consent revision, voice session/message, chosen store/revision, parameter/value/unit and current parameter revision. Nothing is written on preparation. `Подтверждаю` writes through the SAME `_manual_for_actor` and `_write` used by the cabinet, in one transaction with the existing metadata-only OwnerCommand receipt. `Отмена` does not undo a previously committed change. An old confirmation never restores an old coefficient.

Manual0 is a value. Both supported definitions come from the parameter catalogue; utterance aliases and unit multipliers are declarative. Store choice uses an exact owned name/alias or the existing preference, never a foreign/client-provided store identity. Ambiguity requests selection, not an implicit new report. With voice privacy enabled, confirmation does not speak the number. No model/provider/API collection is invoked for a manual write.

## Authority and consistency

`ALISA_OWNER_PARAMETER_VOICE_ENABLED` defaults to0. Existing read grants remain insufficient without cabinet consent. The three additive AliceLink columns default to no permission. Consent is tied to the current link revision; an independent monotonically increasing consent revision invalidates old confirmations after disable/re-enable. Every confirmation rechecks the actual OAuth token, membership/security revision, configured OAuth client, consent and store under the same owner lock used by unlink/revoke and cabinet mutations. No WebSession is invented.

Migration0002_parameter_voice_consent was exercised only on disposable PostgreSQL. Upgrade, reverse/upgrade and an old ORM writer after upgrade preserved existing current coefficient data; the DB defaults do not grant permission. Live migration or flag activation has NOT happened. A future rollback must disable the feature before removing its schema; the current coefficient data is independent of the consent columns.

## Executed qualification

140 methods passed on actual PostgreSQL16.15 with the actual OAuthlib validator, zero failures/errors/skips/external connections.101 are existing storage/period/current-value/SKU/concurrency checks;39 are new voice/permission/migration checks. New cases include actual platform webhook dispatch before report submission, no write before confirmation, manual0, delivery amount, repeated/lost-response confirmation, two concurrent confirmations with exactly one effect, LK edit conflict, revoked token/member security/permission, rebind invalidation, store changes, session/message and signature boundaries, privacy, and additive schema/old-writer compatibility.

The initial137-case pass was before three final client-binding/late-cancel/migration regressions. Repeated runs are not added to unique coverage. The two owned finite test units, PG containers and socket directories were collected/removed. Product credentials, owner values, live database and installed services were not touched.

## Exact unfinished boundaries — do not mark full acceptance

This implementation is wired to the PLATFORM Alice OAuth webhook. The currently installed physical Station uses the earlier private Station/legacy OAuth path. Its trusted adapter and explicit mapping into the new consent/write path are NOT implemented by this source; do not demand a relink or quietly promote its read-only guard. That integration is the author's next engineering step, not a request for the tester to build it.

This first grammar uses spoken/transcribed digits with an explicit unit and changes the store-wide value. Voice SKU selection and arbitrary spoken-number normalization are not claimed; existing cabinet SKU exceptions remain untouched. Current automatic history-bound discovery remains separately unconfirmed.

The cabin form and BFF source are changed, but no connected live-browser/physical-speaker acceptance or installed feature switch is claimed. Exact-head CI (including the UI build and old OAuth regression) and independent review must be observed separately. This file does not predeclare them successful. No blocked reviewer or prior denied tool action was retried, and no new helper or daemon was launched.

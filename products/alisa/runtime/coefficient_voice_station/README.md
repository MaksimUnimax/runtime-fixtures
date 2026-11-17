# Existing Station coefficient bridge — source qualification, 17 Nov 2026

This completes the previously missing source bridge for the already paired legacy Station. It does not deploy it or authorize a live grant. No S16/UNKNOWN code is changed.

## Existing user path

The existing `/app/station/` page obtains an explicit owner choice to enable manual coefficient writes. Its current Host/Origin/session check remains in front of the action. The private platform verifies that same cabinet session again and signs narrowly bound consent containing owner, tenant, security revision, Station binding hash and consent revision. Station stores only that current grant, initially absent. No platform AliceLink or OAuth family, new key, user session, privilege group or new pairing is created.

The current Station ingress validates the legacy token and existing device binding. A manual coefficient proposal/confirmation is passed to the platform, but the service credential alone cannot authorize it. The platform uses its existing peer-checked RuntimePort socket; a read-only native proxy uses the existing Station authorization socket and existing allowed native uid. Station proves the exact current turn hash, message/conversation, binding and consent through an immutable view. No socket permissions or allowed peer lists are broadened.

The platform checks the signed consent, current owner membership/security and the existing RuntimeTenantBinding. It checks the native proof again under owner/tenant locks and again after invoking the shared manual writer. A failed final check rolls back both coefficient and metadata receipt. Reverse proof does not acquire the Station ingress lock, so this loop does not deadlock the held parent ingress. Consent changes use that same Station lock and serialize with an in-flight command.

Both the platform OAuth path and legacy Station path use parameter_voice.turn and the existing parameter writer. The temporary signed confirmation is stored encrypted with Station's existing cipher and expires through its existing tick, not a new scheduler. It is removed on completion/revocation. Lost commit replies retain the exact confirmation for explicit idempotent recovery; no automatic resend or recalculation is introduced. Completed turn receipts contain a handled marker, not a previous coefficient. A late cancellation does not claim to reverse a prior write.

## Source composition

`build_overlay.station_sources` transforms the accepted Station service and authority in memory and includes the declarative parameter voice catalogue. `ui_sources` extends the existing owner page/JavaScript. `native_sources` adds one read-only opcode after the existing RuntimePort peer check. Frozen base files remain unchanged. All replacements require one exact context; no heuristic repinning or live write occurs.

The Station baseline used by tests is byte-identical to the active release observed on Alisa at09:16UTC: service.py SHA256 ee0716ad11590c56a49be8c19a3c70b966f83358a88cfe127299a033ac1d8380; station_authority.py SHA2565a7aa0a465ebaf69d5f117a44eed3e7900dce6d1b19d0cc2b1823753df6d08c5. Actual UI and native dispatch insertion anchors were also read and each occurs once. That is compatibility evidence, not an installed package.

## Tests actually executed

168 focused tests PASS, zero failures/errors/skips/external connections:101 original coefficient tests,39 earlier platform voice/consent/migration tests,28 new Station bridge checks. Real PostgreSQL and the unchanged original Station ingress are used, with a real legacy-token SQLite fixture, two real Unix socket servers, actual native handler/client peer checks and the shared platform mutation. No live owner data is used.

The in-process RequestFactory substitutes only private HTTP carriage; it still enters the real service credential boundary. The native port exposes actual dispatch/peer/socket behavior but its unrelated job functions are a test stub. UI source composition and original site handler are tested, not a rendered/live browser. These limitations are not hidden by the word end-to-end.

New cases cover cabinet session/foreign Origin, default denial, no relinking or platform OAuth family, prepare/no write, confirm/cabinet read, zero, duplicate confirmation, lost reply after commit, same-identity recovery, current owner/legacy-token/consent/native-mapping changes, retained privacy, encrypted pending expiry, original reports, exact utterance hash, final authorization rollback and socket cleanup.

The first new-fixture run found an ambiguous Delivery/Registry tick replacement; the second lacked tracked runtime JSON dependencies. Both failures were preserved; no guard was relaxed. The fixture cleanup was corrected so setup failure cannot leave a TestCase transaction open. Later160/164/168 passes are overlapping executions, not additive coverage.

## Remaining acceptance work

Exact new-head CI, compatible assembled platform+native+Station package and independent source review remain separate requirements. Preserve the installed R15 hybrids when composing changes; do not replace them wholesale with the older R5 base. No live database migration, feature activation, owner permission, service restart or column request was made by this continuation.

After qualification, live acceptance is: owner enables the Station permission, speaks the proposal and confirmation, sees the same current value in the cabinet, and receives a recalculated report without recollecting source data. Physical audio and the owner's saved values remain untested here. Store-wide digit/unit grammar is supported; spoken-number and SKU selection extensions are not claimed. Historical API lower-bound discovery remains separately unconfirmed.

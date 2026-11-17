# Lab OAuth form renewal and private rejection reasons

Speaker requests on17November reached the OAuth webhook without a token and were stopped before Station. The token table was empty. A successful refresh exists on16November. A fixed14-day refresh lifetime is consistent with expiry, but removed historical rows cannot prove the exact original expiry.

Two observed secure-input attempts took450 and1674seconds. The existing form nonce expires after300seconds; both produced the private rejection category form_missing_or_expired before password comparison. Earlier reports claiming no webhook ingress were incomplete.

The form now obtains a fresh nonce through one same-origin GET to its existing validated authorization URL immediately before native submission. The script never reads the password or sends it in the GET. A failed GET or invalid returned form prevents submission and shows a retry message; a double submit is suppressed. The five-minute nonce validity, original broker state, fixed redirect, account validation, password comparison, single-use code and token lifetimes remain unchanged. Long delays may still exceed a broker lifetime controlled by Yandex; this change makes no claim about that external boundary.

Private rejection logging includes only a fixed category. No field values, nonce, state, account, token or credentials are logged. A logging failure preserves denial. The installer clones the current exact release and pins its hashes, changes only the web role, preserves the existing adapter and other services, and verifies process invocation and health. Its own selector is conditionally restored if activation fails. It writes no grants, credentials or database rows.

Tests use synthetic credentials and a disposable SQLite database. Real-handler checks cover expired-form rejection, a fresh nonce after a30-minute delay, unchanged password validation and broker checks, one-use codes, redirects and logging privacy. Node VM runs the emitted inline script for renewal, no-secret GET, double-click suppression and failed retrieval. These checks do not establish real account authorization or physical-speaker acceptance.

# R9 exact review correction

Base be767a6570a8a6ff258300e378571a1f59648a3f. Independent read-only gpt-6-luna review: REQUEST_CHANGES, one confirmed HIGH session revocation TOCTOU in parameter_report_rpc._load.

Reproduced before correction: actual private RPC returned normally despite a separately committed logout between principal_current and SELECT FOR UPDATE. After correction: original principal proof is validated again after the session-row lock, which is held until the same atomic RPC completes. Existing validator covers revocation, expiration, active owner, security revision and token fingerprint. No scope expansion, bypass, grants or new sessions.

Four regression tests use actual separate PostgreSQL transactions: logout/read refresh, token rotation/current, expiration/fence, logout during fill commit. All pass. Combined 229/229 tests, zero skips/externalnetwork. Financial reference replay is separately labelled source qualification, not product readiness.

The possible before_dispatch interface defect is not present: exact engine.py hash matches R8 BASELINE and the method accepts/uses that keyword. Proof in NATIVE_INTERFACE_CHECK.json; original source /root/alisa-parameter-evidence-20261114/r5/reproduced/engine.py retained, not modified.

No changes to live service, active browser, credentials, user parameters or working access. No deployment. Exact corrected product source e3968e238753d51b72a3303cbb1d9dee8a19115e received a limited SOURCE_APPROVE; the final compound/program replay passed25/25. Full GitHub CI and live acceptance remain separate open gates.

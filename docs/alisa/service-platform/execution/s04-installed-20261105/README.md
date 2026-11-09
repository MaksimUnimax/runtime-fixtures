# S04 installation evidence · 2026-11-05

Exact package source: c8666516683e7b2bedc2c1a7d939e9e3c4489d38. Status: READY_FOR_OWNER_TEST; no real-OWNER grant test was performed.

This directory preserves the actual normal-copy installer, activation, inactive-only resource procedures, customer readback, both final readback revisions, exact CI binding and safe original receipts. Private configs, identities, sessions, credentials, schema backups and metadata snapshots are excluded.

../AL_S04_ROLLOUT_REVIEWED_R2_20261105.md is the unchanged pre-activation document bound by procedure review R2, SHA256 2d430e8273ff1f64a8e407e6824a0c48f7dad8eda79341a2cd652313712cdcd9. The current rollout document records actual outcomes.

The first final readback failed before cases: systemctl stop returned nonzero for an already inactive collected window. Original receipt and script remain unchanged. R2 accepts the already released state and passed 32 read-only checks; it acquired no new lock.

These are finite operational records, not a new development runner. They contain exact dates, source, private host paths, prior-state requirements and single-execution guards. Do not rerun blindly. Additive schema remains on code rollback.

[Report](../AL_S04_INSTALLED_REPORT_20261105.md) · [Evidence](../AL_S04_INSTALLED_EVIDENCE_20261105.json) · [Independent review](../AL_S04_INSTALLED_INDEPENDENT_REVIEW_20261105.json).

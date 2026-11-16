# Retained UNKNOWN and deployment quiescence — 16 November 2026

Owner resumed repair and installation explicitly on16November. Four historical
native UNKNOWN identities are retained indefinitely by retention.py, after their
payloads and expired ingress/call records have been removed. Counting every such
identity as active work creates a permanent deployment block. Empty history and
age do not prove the original provider outcome.

This change classifies deployment quiescence only. It does not reconcile, cancel,
delete, requeue or replay any job, alter a DB permission, or report an unknown
outcome as success/failure. The total native_unknown_jobs count remains visible.
A separate native_quiescent_unknown_jobs count requires UNKNOWN, null owner,
lease, expiry and alias, an empty draft, absent plan/result/progress, a nonempty
error, valid ordered creation/update times and at least90000seconds since update.
That interval matches the retained-call policy; it is a conservative deployment
boundary, never outcome evidence. An old resume_safe flag does not make UNKNOWN
runnable: recovery operates on RUNNING, and claim selects QUEUED only.

check_idle permits retained UNKNOWN only when all UNKNOWN rows meet that exact
classification and all other existing native/PostgreSQL/delivery/outbox counters
are zero. Missing/invalid counters, fresh UNKNOWN, payload-bearing or owned rows
still refuse. Both existing samplers and post-fence checks remain fresh; there is
no saved-count override, ignore flag or new administrative permission.

Scope is the exact cafb743c R15 package and e0a10bb4 native baseline pinned by this
installer. Read-only byte comparison found repository.py differs only in the
stage_answer economics_sources parameter; claim, recovery and duplicate reuse
are unchanged. retention.py is identical (3b88035e38e52da3a313ee1802ed5a0cfcd7799c9674c468dda6578d8926718c).
Tests use a real disposable SQLite Repository, retention, restart and duplicate
enqueue to prove the UNKNOWN identity and slot survive without a dispatch.
Future releases changing those contracts require their own qualification.

This is not AL-S16 completion or resolution of four historical outcomes. Program
fencing, exact package identity, source review, current maintenance window,
installed synthetic checks and live acceptance remain separate requirements.

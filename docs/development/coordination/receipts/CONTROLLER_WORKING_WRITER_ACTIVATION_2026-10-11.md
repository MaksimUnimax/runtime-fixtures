# Working-index writer activation SOURCE

Owner explicitly approved activation on 2026-10-11 17:16:21 +05 in the
existing Controller dialogue. This supersedes the writer-off restriction
only for WORKING_INDEX_WRITES_ENABLED and its reviewed staged application.
It does not authorize parser/protected Controller-route/security changes,
cap increases, history deletion, new executors or foreign WIP takeover.

This operational successor to 21621a4c enables the new working-index writer
and retains the accepted COMPACT_RESOLVED_WRITES_ENABLED=True behavior.
RESOLVED_COLD_INDEX_WRITES_ENABLED stays False. No environment or caller
flag enables production writes. The existing reader-only guard still
rejects this writer release. It is not an installation path for it.

Legacy-format tests explicitly select legacy mode; current literal defaults
are tested in a fresh interpreter by retrying the same native ADD that
failed with WORK_QUEUE_INVALID: size. Full logical history, immutable
archives, STOP, native admission and transaction recovery remain covered.

Operational application requires all five exact-SHA CI and independent
review, fresh sole-author/inode/hash checks, durable preimages, and the
already accepted Controller manual writer-installation route. Hold the
existing role and coordination locks only for local installation/readback.
First install and verify the reviewed dual-reader release on A/B/C/ORG;
then install the separately accepted literal enabled writer on all four.
Do not resume writes between those phases or run network/tests under locks.
Do not replace any work_queue.py, role state, source WIP or protected route.

Only the existing native V2 journal writer may switch live storage. Verify
all original logical rows/ordinals, completed/history roots, old immutable
archive bytes and the event prefix. Preserve a durable start/result receipt.
If a result is unknown, inspect journal/current HOT before any retry.

Before indexed publication, rollback restores exact preimages. After an
indexed transaction, keep compatible readers and recover the journal;
never restore an old HOT snapshot that loses later work. Real native
readback and dependent progress remain separate from SOURCE/CI acceptance.

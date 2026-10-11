# Bounded working representation — SOURCE preparation, writer disabled

Owner continuation: 2026-10-11 16:28:46 Asia/Qyzylorda. Same Controller and
existing queue repair. This is not a live acceptance receipt or a permission
to activate a cold-index writer. B04, six P2, trusted-root and ORG-006 remain open.

## Exact problem and preserved acceptance

Accepted compact writer 893e45b5 already passed the original live ADD. Do not
repeat that application or claim it failed. Its installed module SHA256 is
10789cd70f6c36b399bca0c01f369d70a96f622b6c3b1b216d367d9dfd40931b.
However, 30 fixed active rows plus 1000 resolved historical blockers generate
298189 bytes in that unchanged writer, exceeding HOT_CAP_BYTES=262144.
Moving only resolved history is also insufficient: supported active rows can
collectively exceed the HOT cap. The defect is representation growth, not the
human's existing extension-driven prompt repetition.

## SOURCE changes

The existing immutable rows/nodes store receives full non-DONE rows. HOT has
working_root_hash/working_count and an empty tasks array; completed rows and
completion history keep their existing representation. Hydration restores the
entire logical board in its original ordinal order, including unresolved,
resolved and reactivated blockers and all metadata. No history is discarded.
Archive hashes, canonical JSON, no-follow reads and native capacity checks
remain. The logical version and work_queue API stay unchanged.

Generation identity, queue and migration journals, readback and crash recovery
bind both new root fields. Mixed old/new root groups and partial roots fail
closed. Missing, modified or symlinked row archives fail closed. A disabled
writer can read/recover the new format but cannot rewrite it into legacy HOT.
Existing native admission, scope, STOP and resource rules are not replaced.
Storage still permits quota-neutral repair of legacy over-cap boards; the
native semantic admission continues to enforce the 100-active-task limit.

WORKING_INDEX_WRITES_ENABLED remains False. It is explicitly a cold-index
writer subject to the existing prohibition, not a renamed bypass. Reader-only
rollout rejects this new flag when enabled, including later AST reassignment.
The SOURCE follows current main's disabled writer defaults; do not install it
as a replacement for the live enabled compact writer without a separately
reviewed staged rollout preserving that accepted behavior.

## Checks and scope of evidence

Disposable local tests exercise history growth up to 10000 resolved rows and
100 active rows with 16KiB payloads each; HOT remains below 1KiB. Native ADD and
CLAIM execute against a disposable registry with 1000 valid resolved blockers
and 99 large active rows. The 100th active task succeeds; another ADD fails
without board/history/event mutation. Repeated CLAIM creates no second event.
All six writer fault points recover to the old or complete new generation,
with at most one event. Old immutable archives survive migration, reopening
and a second completion. STOP, missing/tampered archives, mixed schemas and
journal-root tampering are checked. These are SOURCE tests, not live ADD.

Unit-test flag patches exist only in imported modules operating on
TemporaryDirectory fixtures. No live root is used; source constants remain
disabled. No RDC parser, protected Controller route, A/OPERATOR worktree,
profile, key, grant or authentication configuration is changed.

## Remaining acceptance and exact deployment boundary

1. Independent exact-source review and the five mandatory exact-SHA CI.
2. Extend/verify the existing governed reader rollout for A/B/C/ORG against
   this indexed format and real reader variants, without overwriting WIP.
3. Separate explicit permission for the currently prohibited working-index
   writer activation. The general repair order does not substitute for it.
4. Reviewed activation source preserving accepted compact behavior; short
   native coordination lock, fresh logical read, durable sidecars, atomic HOT
   publication and existing journal/event protocol. No manual board rewrite.
5. Real permitted ADD/CLAIM, all-reader readback, complete history/archive
   comparison and actual dependent progress. Do not create a dummy live task.

Rollback before activation preserves legacy bytes. After indexed writes,
never install an old writer or replace HOT with an old snapshot that loses
new operations. Retain compatible readers, recover journals, and disable new
writes if needed until a reviewed compatible correction is ready.

The unchanged node/archive/done-store/event/journal caps remain finite. This
fix removes HOT growth from history/payloads; it does not promise unlimited
disk or permit deleting history/increasing caps when another bound is reached.

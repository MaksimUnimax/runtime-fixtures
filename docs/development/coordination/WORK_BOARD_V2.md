# Work board v2

## Purpose

The v2 reader keeps the public logical board shape (`version`, `revision`, `updated_at`, and `tasks`) while storing completed-task indexes and immutable completion generations in bounded sidecars. The hot board remains the only source for active tasks. `work_queue.py` preserves the v1 API and validates candidate logical boards before creating durable artifacts.

This module is source-only until a separately authorized migration and reader rollout. Its default migration command is inspect-only. Migration requires a fresh, exact, single-use authority receipt that pins the v1 revision and bytes, candidate source revision, reader paths and hashes, helper hashes, and expiry.

## Durability model

A queue operation writes an immutable transaction journal before publishing generated sidecars. It then writes the new hot board, validates the candidate, appends the exact event, and marks the journal `COMMITTED`. Readers require the hot board's operation journal to be committed. A missing, malformed, inconsistent, or incomplete journal fails closed with recovery required.

Recovery compares the actual event suffix with the journal's exact expected event. It may append a missing event or repair a torn suffix only when the existing prefix is valid and the bytes match that one expected event. It does not discard unrelated or complete events. Transaction and event files are bounded and no-follow checked.

Completion records use the specified `completed_entry_schema_v1`; each DONE generation has a unique archive entry and generation number. Current completed entries and the complete archive history are held in content-addressed trie nodes. Archive wrappers and bytes are immutable and their hashes, sizes, task identity, generation, receipt metadata, and logical fields are cross-checked by readers.

## Migration fence

Migration preserves the exact original v1 hot bytes in a content-addressed archive. The migration record stays `PREPARED` or `SWITCHING` while the new hot generation is installed and each pinned reader validates the same pending generation internally. Public readers continue to return recovery-required during this interval. The migration record's durable `COMMITTED` transition is the global exposure point.

Failures before that point restore the exact v1 bytes and terminalize the migration transaction as rolled back. Failures after it preserve the committed v2 board and require receipt/readback reconciliation; they never restore v1 over a generation public readers may have observed.

## Reader rollout

The separate rollout utility installs the exact reviewed `work_queue.py` and `work_board_v2.py` pair for A, B, C, and ORG under ordered role and coordination locks. It records prior and installed file hashes, modes, existence, Git status, role-state hashes, and semantic reader comparisons. It rejects changed source, unexpected pre-existing helpers, a stopped or unknown executing role, and unrelated status drift. Other stopped roles remain stopped.

Semantic snapshots support both logical v1 and v2 boards. Semantic parity remains the default: without an explicit transition proof, every installed reader must return exactly the same canonical semantic view as its prior reader. An intentional semantic change uses a separate hash-bound proof under `logs/`, `controllers/`, or `artifacts/`. The proof binds the rollout ID, current board revision and raw board/event hashes, exact prior and candidate `work_queue.py`/`work_board_v2.py` hashes for each A/B/C/ORG reader, and canonical SHA-256 digests of the expected before/after semantic views. Both proof path and proof SHA-256 are required; a parity proof is rejected as unnecessary.

All source, proof, board, event and reader preconditions are rechecked after acquiring the full lock set and before the first target write. Candidate bytes are rechecked after the candidate semantic calculation as well. A stale board/proof, unexpected task-view or owner-attention result, source drift, or hash mismatch fails closed. Reader writes use an unpredictable scratch name under the control-root work-board-reader-rollouts evidence directory on the same filesystem, outside the reader Git worktrees. Successful os.replace consumes that scratch name atomically. If the write fails before replacement, cleanup deliberately does not unlink the scratch pathname after a separate identity check; the bounded residue is retained for explicit evidence-aware cleanup rather than risking deletion of a replacement inode. If a mismatch is observed after writes begin, prior-existing readers are restored to their exact prior bytes/modes. A target that was absent before rollout is removed from the target namespace only by atomically moving the current pathname into unpredictable control-root scratch; the moved inode is then compared with the exact installed inode. A replacement inode is restored with no-replace semantics when possible (otherwise preserved in scratch) and rollback reports failure/manual reconciliation instead of unlinking it. Rollback also verifies unchanged board, events and A/B/C role-state bytes before reporting success.

A, B, and C require a readable Git worktree. The operational ORG reader may live outside Git; this is recorded explicitly while its exact file hashes, modes, existence, and semantic results remain verified. Other Git errors are not treated as an absent repository. A committed transition receipt records the proof path/hash and canonical semantic digests; the proof itself is evidence for review, not permission to mutate product data or bypass role/STOP rules.

## Bounds and operational limits

Limits are enforced before journal, archive, or hot-board publication. Candidate hot bytes, journal count and bytes (including rewrite reserve), event log total and line sizes, completed current count, archive history generations, trie nodes, and done-storage bytes are bounded. New generation files must be regular, single-link files; symlinks and special files are rejected.

These limits are application-level guards, not filesystem quotas. The v2 source does not automatically clean up sidecars. Migration and rollout remain explicit, guarded operations and are not performed by tests.

A valid v1 row fits the 512 KiB archive wrapper. Its duplicated index metadata must also fit a 256 KiB trie leaf. An individual metadata entry too large to split is rejected before migration writes; inspect mode detects this limit. Such an input needs an explicit schema or source-data reconciliation and is not silently truncated.

## Verification

Focused source tests cover queue state changes, task compare-and-set, content-addressed reads, repeated completion generations, crash points around sidecar/hot/event/finalize, torn-event repair, capacity boundaries, migration failure and post-commit receipt failure, inspect-only authority behavior, reader rollout parity and rollback, and waiting-gate invalidation. Tests use isolated temporary directories and do not access the live work board.

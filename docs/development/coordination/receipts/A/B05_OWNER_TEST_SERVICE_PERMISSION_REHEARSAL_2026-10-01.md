# B05 owner-test service permission rehearsal — 2026-10-01

Status: **PARENT PASS — READ_ONLY_HOST + DISPOSABLE_PERMISSION_REHEARSAL; REVIEW/PUBLICATION PENDING**.

Task: `B05-OWNER-TEST-SERVICE-PERMISSION-REHEARSAL`.
Role: A.

## Purpose

Accepted B05 hardening evidence still left one independent boundary open before any live hardening apply: prove the exact read/write shape for pinned immutable releases, protected owner-test config and bounded writable runtime paths under a non-root service identity.

This task does not choose Memory/CPU/Tasks limits and does not create or switch the final service account.

## Source boundary

New source:
- `tooling/operations/owner_test_service_permissions.py`
  SHA-256 `82e6f0f7c05c2b5ac79551094f5b693d36ff59c0354f13bbcf3c4bb8b67bec1a`;
- `tooling/operations/test_owner_test_service_permissions.py`
  SHA-256 `d8beba9ed32c2b5db0b45859fade4fba0a54ae5cd0f5de8fe4f03f00e46e8101`.

The tool observes only the fixed owner-test API/worker/portal units and allowlisted systemd properties. It never requests or prints Environment contents.

The current intentional split-release topology is supported:
- API: `ec99b58b29f0ae51463e197a28aa784a93a45eb2`;
- worker: `62024d192a8572c11aafab91653330d1f996699f`;
- portal: `62024d192a8572c11aafab91653330d1f996699f`.

Each unique release is independently verified through the existing `verify_ops_release.py`; the verifier source SHA must equal the SHA encoded in the pinned release path.

## Permission contract

The rehearsal uses one explicit non-root test identity with supplementary groups cleared. Numeric uid/gid values are not emitted in persistent evidence.

For every pinned release:
- every real directory must be readable/traversable and not writable by the test identity;
- every real file must be readable and not writable;
- symlinks must resolve inside the same immutable release;
- actual systemd WorkingDirectory and release-backed ExecStart paths must be accessible;
- no file, mode or ownership under `/opt/octoport/ops-releases` is changed.

Protected config is checked without reading secret material:
- API/worker bind only the fixed API env label;
- portal binds only the fixed portal env label;
- both protected files are regular, root-owned and mode 0600;
- the non-root child must fail to read them;
- opening them write-only without truncation must also be denied.

The only successful writes happen inside one A-owned disposable temporary tree. Only that temporary tree is chowned to the test identity, a small probe file is written/read/deleted, and the whole tree is removed by the parent.

## Focused verification

Parent checks:
- Python unittest: **11/11 PASS**;
- `py_compile`: PASS;
- text/trailing-whitespace check: PASS;
- `git diff --check`: PASS;
- task scope guard: exactly the two source/test files before this receipt.

## Live read-only/disposable rehearsal

Sanitized result:
`/root/octoport-control/logs/A/b05-owner-test-service-permission-rehearsal-20261001/live-r2/result.json`

Result SHA-256:
`779c4ef7b8c5030820f66ca417c8a0bd8ee4d5adf34722b98832842224568545`.

Supervisor receipt:
`/root/octoport-control/resource-jobs/82536b2c76d4483cac31e47addb84d80/receipt.json`

Receipt SHA-256:
`74fc245165c8944247184ba56c570bc69dfa7dd3a336ec8872ab8baa1f1f0fd1`.

Supervisor outcome:
- command exit 0;
- OOM kill 0;
- cleanup verified;
- peak cgroup memory about 57 MiB.

Rehearsal result:
- both unique pinned releases verify PASS;
- release `62024d19…`: 4,088 directories, 25,238 files, 1,150 symlinks checked;
- release `ec99b58b…`: 4,025 directories, 25,082 files, 915 symlinks checked;
- the explicit non-root child traversed every unique pinned release root and actual OS access checks confirmed all release entries readable/traversable as applicable and not writable, closing the named-ACL gap left by the earlier mode-bit-only parent scan;
- actual WorkingDirectory and ExecStart release paths accessible under the explicit non-root child;
- protected config read denied;
- protected config write-open denied;
- disposable writes PASS;
- supplementary groups cleared;
- owner-test service state stable before/after;
- disposable cleanup PASS;
- secret material read = false;
- live mutation performed = false.

## Superseded diagnostic evidence

The earlier `live-r1` result and resource job `bebe7fad2582487cb495539c6f57d63a` remain historical diagnostics only. Independent review identified that R1 proved whole-tree permissions from parent-observed mode bits while actual non-root access was exercised only on WorkingDirectory/ExecStart paths. R2 adds actual non-root traversal/write denial for every unique pinned release tree and is the acceptance evidence for this receipt.

## Evidence boundary

Evidence level is exactly **READ_ONLY_HOST_PLUS_DISPOSABLE_PERMISSION_REHEARSAL**.

This result does not:
- create the final named service user/group;
- change User/Group, ProtectSystem, ProtectHome, ReadWritePaths or other systemd controls;
- choose MemoryHigh, MemoryMax, CPUQuota or TasksMax;
- restart or deploy owner-test services;
- mutate owner-test DB/config/release files;
- prove representative concurrency, production capacity, LIVE_OWNER or PRODUCTION operation.

Current live units remain root/unset and weakly sandboxed; this task only proves that the existing pinned release/config layout can support the tested non-root read/write boundary.

Independent review and normal exact-head publication gates remain required before this task is DONE.

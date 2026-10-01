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
  SHA-256 `0de143fc6016c310f5ed767fcb026cd4a7ed968f7e7679b0c822870b1501af40`;
- `tooling/operations/test_owner_test_service_permissions.py`
  SHA-256 `cadc9bd576e7ac2462327f1611ca4bc6b954cfe3a119a2a2d817ff5041208b69`.

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
- Python unittest: **10/10 PASS**;
- `py_compile`: PASS;
- text/trailing-whitespace check: PASS;
- `git diff --check`: PASS;
- task scope guard: exactly the two source/test files before this receipt.

## Live read-only/disposable rehearsal

Sanitized result:
`/root/octoport-control/logs/A/b05-owner-test-service-permission-rehearsal-20261001/live-r1/result.json`

Result SHA-256:
`2701547c720747ce39e9922d5a120ae4e38209aec3bb3bedd73c2a06aa4ff3df`.

Supervisor receipt:
`/root/octoport-control/resource-jobs/bebe7fad2582487cb495539c6f57d63a/receipt.json`

Receipt SHA-256:
`b075d3c9e8899e8d6a23af6d08fe72f03e13373a62b8d4d4a2e9802db5d4bf6f`.

Supervisor outcome:
- command exit 0;
- OOM kill 0;
- cleanup verified;
- peak cgroup memory about 427 MiB.

Rehearsal result:
- both unique pinned releases verify PASS;
- release `62024d19…`: 4,088 directories, 25,238 files, 1,150 symlinks checked;
- release `ec99b58b…`: 4,025 directories, 25,082 files, 915 symlinks checked;
- actual WorkingDirectory and ExecStart release paths accessible under the explicit non-root child;
- protected config read denied;
- protected config write-open denied;
- disposable writes PASS;
- supplementary groups cleared;
- owner-test service state stable before/after;
- disposable cleanup PASS;
- secret material read = false;
- live mutation performed = false.

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

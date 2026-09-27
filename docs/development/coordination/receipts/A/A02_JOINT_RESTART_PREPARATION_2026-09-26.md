# A02+B03 recipient restart regression preparation — 2026-09-26

This change extends the installed synthetic transfer harness at
`tests/regression/extension-core/client-i1/browser_d3s2_r1_transfer.py`.
The existing `D3S2_R1_RESTART_RECIPIENT=1` path already restarted the recipient
browser profile after the real HTTP request was created and before receive. The
new assertions apply only to that path; they do not repeat its existing payload
recovery assertions.

## Focused scenario

Use two actual extension workers, a disposable API/database, and the production
HTTP transfer routes. The recipient creates a transfer request, then its
persistent browser context closes and reopens on the same profile before the
source is discovered and sends the packet. The reopened worker must recover the
active request and its private ECDH key from IndexedDB; the key must remain
non-extractable and the request must retain its account, recipient device, and
single selected-store binding.

After receive/import/ack, the scenario checks that the server request is
`COMPLETED`, the local vault is `ACKED_RESULT` with the private key cleared,
only the selected store changed, and the unselected sentinel store remains
untouched. It then calls the production pending-receive message again and
requires a cached recovered result, no second packet read or ack POST, and no
change to the imported store revision. Account identities must match across
the two devices, device identities must differ, and the server-bound request
must match the recipient account/device and selected store.

These are planned assertions, not browser acceptance evidence. The child ran
only a Python syntax check; the parent must execute the focused scenario under
the A heavy supervisor and record its actual result before claiming a PASS.

## Parent execution

Run only the source-generated package variant, with the deterministic restart
enabled, an isolated disposable database, a synthetic fixture namespace, and a
fresh output directory. Keep the API and portal on A's documented test ports.
The supervisor owns and terminates the complete process group:

```bash
python3 tooling/coordination/control.py A heavy --db --profile e2e --timeout-seconds 3600 -- env \
  PRODUCT_CONTROL_PLANE_E2E=1 \
  SA_I1_FIXTURE_NAMESPACE=a02jointtransfer20260926 \
  SA_Q1A_API_PORT=18101 \
  SA_Q1A_PORTAL_PORT=18111 \
  D3S2_R1_RESTART_RECIPIENT=1 \
  D3S2_R1_ONLY_LABEL=source-generated \
  D3S2_R1_OUTPUT=/tmp/a02-joint-restart-20260926 \
  python3 /root/octoport-control/worktrees/A/resume-a02-joint-transfer-20260926/tests/regression/extension-core/client-i1/browser_d3s2_r1_transfer.py
```

Use only the fixture credentials created by `api-harness.ts`; do not substitute
owner or marketplace credentials. The scenario must use the local HTTP relay
and real browser workers, make no marketplace or AI requests, and leave no
process outside the supervisor. A blocked supervisor admission is a blocker,
not permission to run the browser or servers directly.

## Controller correction — 2026-09-27

The restarted branch sends the production RECEIVE_PENDING message directly before the popup click handler consumes the durable result. It checks cached replay, explicitly consumes through RESULT_CONSUME, then checks that the vault is absent and another pending receive produces no second packet read or ack. The non-restart branch retains its popup click. The unselected-store assertion compares against its actual pre-transfer normalized snapshot. These edits passed Python AST parsing and diff whitespace checks only; browser acceptance is still pending.

Run the supervisor from `/root/octoport-a-extension`, but execute the absolute child script above. Prepare frozen dependencies for that exact child tree first. Running the relative script from the parent would test the unchanged parent, not this candidate. Do not attribute that result to this diff.

## Parent validation — 2026-09-27

Validated child base: `6f75b75a6c0b329f827b0ccfb81f84a2476d89cc`.
Current GitHub/main was re-read as `7600f3ceb555c32ff798aac48f6c9613e8124ab2`; it was merged into A as `d29dae7f866cbed23a848ec93a8150c51f6d8146` before saving the candidate.
That main merge changed documentation only and produced zero diff lines in `browser_d3s2_r1_transfer.py`.

Exact corrected test bytes:
- patch SHA-256: `93e621de180e2ba456e0892e0e7c6a6651b39fa3d64874de37f995c2ce9693a1`
- file SHA-256: `ad6d1256fbc30cc081071ca6831731817cc32d9a5c4a4fb0b0972acc0d726040`
- Git blob: `1d42daf93db4dce73270f2ff0d3c45a9793cbd23`
- diff: 75 insertions, 11 deletions

Frozen workspace dependencies were restored in the exact child tree with Node 24.20.0 / pnpm 10.34.5 using `pnpm install --offline --frozen-lockfile --ignore-scripts` under the A supervisor; lockfile SHA-256 matched the parent and the supervised dependency job exited 0 with cleanup verified.

Focused browser validation ran from `/root/octoport-a-extension` under `A heavy --db --profile e2e`, executing the absolute child script with restart enabled and source-generated package only.
Supervisor unit `octoport-test-a-79f364f767aa441ab3743182524f8be2.service` finished `Result=success`, `ExecMainStatus=0`; process-group cleanup was supervisor-owned.
Receipt `/tmp/a02-joint-restart-20260926/result.json` reported `PASS` on Chromium `151.0.7922.34`.
Observed restart boundary: non-extractable key recovered, server `COMPLETED`, one packet read, one ack POST, cached recovered result before explicit `SA_TRANSFER_RESULT_CONSUME`, no second packet/ack after consume, selected-store revision stable on replay, unselected store unchanged.
Provider requests: 0. AI requests: 0. This is installed synthetic/local HTTP evidence, not `LIVE_OWNER`.
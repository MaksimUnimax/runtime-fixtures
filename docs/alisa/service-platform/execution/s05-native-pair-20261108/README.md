# Existing native Ozon pair — execution evidence

Installed product source: 8e1a695d71f1004b03564570b880a915efdb539e. See ../AL_S05_NATIVE_PAIR_20261108.md.

Current accepted operational sources are install-r5.py, requalify.py, alisa-native-pair-refresh.service, native-pair-refresh.conf and install-refresh-r2.py; the corresponding exact reviews and receipts are retained. install.py, install-r4.py and install-refresh.py are execution history, not instructions to rerun. Failed receipts are preserved. All writes are scoped and require fresh preconditions; no script is idempotent authorization to overwrite another deployment.

The inactive-dependencies helpers are abandoned HOLD / NOT_APPLIED. The original plan failed before any links or path removal. Do not execute R3; its extra-path inventory was not accepted. Only a redundant own CI download was relocated with exact hash/readback on Easyscript before removing the Alisa cache copy; installed source and unique archives were retained. Business Bridge was untouched.

requalify.py reads only the already qualified combined Ozon credential file, config and existing private scope; no database or report API. A finite root oneshot exposes that one file read-only in its own 0700 runtime directory. It renews only unchanged original authorization plus current process generation. It preserves fail-closed behavior on source, credentials, scope or qualification drift.

Fixture command: python3 -B docs/alisa/service-platform/execution/s05-native-pair-20261108/test_requalify.py — 21 PASS (6 new + 15 existing), no provider calls. Full product CI and exact artifacts are recorded in ci-artifact-binding.json. Owner browser transition and report acceptance are NOT_RUN; do not promote them based on these receipts.

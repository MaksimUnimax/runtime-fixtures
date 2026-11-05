# Current S03 qualification procedures · 2026-11-05

Exact copies of nine bounded procedures executed on Alisa. SHA256 values are recorded in the companion current evidence. They contain no fixture values, credentials or browser states. Private snapshots stay on the host.

- `inactive-vendor-dedup*.py`: byte-identical inactive own vendor copies only, manifest checks before/after, active inode exclusion; no archive or release paths deleted. Target mtime follows canonical, with old metadata privately preserved. Independent mtime restoration requires breaking the hardlink.
- `current-mixed-*`: earlier DD2 attempt. Smoke failed on derived bytecode, R2 passed24; rollback passed48. Final stopped on an additional unmanifested infra bytecode file before concurrent07290 replacement. These original statuses are retained.
- `current-07290-*`: exact admin3e91 + API/web/Identity07290 qualification. Synthetic pre-existing fixtures only; no signup or real recipient entry; native MFA/TOTP, limited role deny/revocation, feature rollback and re-entry. Other stream's mail/open-registration code stays fixed.
- `ci-binding-07290.json`: locally downloaded CI ZIP/tar and manifest hashes; server file hashes and links bind installed code to this manifest.

The current07290 `run()` bodies are invoked through runpy under the existing rollout locks held by a finite native systemd unit, with separate bounded step units. Their standalone main blocks are not used inside that lock window. All source imports disable bytecode generation. The lock holder is released after independent readback. Do not replay these stateful scripts without a fresh fixture/capability plan: recovery codes and authentication flows are one-use.

This qualifies S03 staff functions on the declared stage tuple. It does not accept real mail delivery, public registration, production, common identity/DB migration, main merge or S04.

# B05 — strict source commit/tree binding in ops-release preparation

Task: B05-OPS-RELEASE-PREPARER-TRUSTED-SHA-TREE-CALLER-R1-20261008.
Accepted base: 30d47dd629295d1f186d7cf84feafcf15bf7edf3.
Only these task files change: the release preparation shell script, a focused Python test, and this receipt.

## Source and threat boundary
The existing script prepares an immutable operations release from a clean Git checkout. It already obtains head_sha and tree_sha from Git before archiving and writing the release manifest. Before this change, after the target directory was moved into place it ran verify_ops_release.py in legacy positional mode. That mode correctly checks internal files, symlinks, ownership and permissions, but does not compare the release Git identity to independently known source HEAD/tree.

The final verifier invocation now passes --expected-source-sha from the clean source head_sha and --expected-source-tree from the clean source tree_sha, then the same target path. This ties the final verified release to the source checkout and fails closed if either SHA/tree in an otherwise internally valid release is wrong. No accepted release authorization is inferred solely from knowing the source checkout; actual owner/deployment approval remains separate.

## Verification and constraints
- RED_PREPARER_STRICT_CALLER_R1.json: two focused cases failed as expected before edits: missing expected-source arguments and accepting a foreign internally valid release.
- Focused synthetic unit tests exercise the actual extracted final shell invocation on matching internally valid SHA/tree, wrong-source, and wrong-tree-but-same-source targets. Release fixtures are generated only inside declared task-local temporary data, using the published verifier. The script itself is syntax-checked but is NOT run through pnpm install/build or real deployment.
- Shell syntax, Ruff check/format and Git diff check must pass on final exact source. Previous published validator had 18/18 unit and independent gpt-6-luna review and 5+5 GitHub CI. Those results apply only to original main30d and are not claimed for this new candidate.
- Tests and source make no live API/worker/portal, database, account, browser, marketplace, provider, systemd, Nginx or production deployment changes. No credentials or business data used.
- One author sparse worktree is disk-admitted at 32 MiB. Independent reviewer is separately admitted, codex2/gpt-6-luna only. Main requires fresh exact SHA review and five CI with non-force governed publication and readback.
- Prior B05 strict queue completion platform denial and prior B04 OTP publish-main platform denial remain open and cannot be retried/split/proxied by this task.

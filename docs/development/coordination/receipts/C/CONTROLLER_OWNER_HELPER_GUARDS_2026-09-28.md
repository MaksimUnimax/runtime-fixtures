# Controller manual mode — owner-test helper guards, 2026-09-28

Base: 1e5451a0e5d59244cd430d1696e8dd8fd07a68ed (includes exact A8fa44892).
Scope assigned by controller notice CONTROLLER-OWNER-HELPER-GUARD-20260928-0600.

Actual server reproduction: original pgrep invocation exits 2 because its pattern
starts with --user-data-dir and is parsed as an unsupported option. Empty stdout
was treated as proof that the dedicated browser profile was unused.

The helper now checks exact /proc argv entries, including split flags, relative
paths and symlink aliases. Inspection errors fail closed. A vanished process is
an ordinary scan race. This preflight is advisory: Chromium's own profile lock
still arbitrates concurrent launches. No running browser is stopped or adopted.

Page-error receipts contain only a fixed code/count. Unexpected browser or
transport exceptions emit a bounded FAILED/NOT_ACCEPTED receipt and exit 1;
raw exception text, tokens, URLs and tracebacks are not copied into output.

Validation: 12/12 focused source regression tests PASS; supervised job
30d4e7cd25db46b9aa0184fa4cba7dbd exited 0, peak 7 MiB, cleanup verified.
Tests cover real argv semantics using temporary process-table fixtures, inspection
failures, pre-mutation busy-profile rejection and secret-bearing exception output.
Python compilation and git diff --check PASS. No browser or login was launched.
This does not prove authenticated controls, live provider work or installed acceptance.

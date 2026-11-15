# R14 period source: independent review and continuation, 2026-11-15

## Scope and outcome

SOURCE_APPROVE for the period advertising/storage adapter and its precision/transport fixes. This does not enable a full economics template, deploy a release, or claim owner acceptance.

The original dirty worktree `/root/alisa-economics-period-r14-20261115` was preserved. Its precision fix was copied into the separate continuation branch before further changes.

## Corrected boundaries

- Source amounts and their aggregate must fit the existing 60-digit financial contract. Addition retains small nonzero terms across different magnitudes; an unrepresentable aggregate is rejected, not rounded.
- HTTPTransport JSON fractions are Decimal. The source serializes them as exact JSON numbers for protected packets and receipts; it does not convert them through binary floats or numeric strings. Nonfinite values and unexpected floats are rejected.
- Provider advertising dates in DD.MM.YYYY are normalized only in the temporary scalar-validation copy. The captured packet retains the provider representation. Invalid dates and duplicate campaign/day pairs across equivalent representations are rejected.

## Independent review

A separate read-only reviewer inspected source and regression tests and approved the resulting bytes. SHA-256:

| File | SHA-256 |
| --- | --- |
| `docs/alisa/runtime/v0.11/economics_period_r14/period_cost_source_runtime.py` | `bca01aab43b885a77ed2f39af7bf0c5c1811ea370acc328953878ef5d260760a` |
| `products/alisa/services/platform/src/alisa_platform/owner_data/economics_periods.py` | `8fcb5a9cf8a1d3eac0c95b2e7b829054b279e7e17ac1dd9608c819ba68303455` |
| `products/alisa/tests/economics_ledger/test_period_costs.py` | `9d98beafdc187ec1b793576feaf8c453eba3b186662339cdf203fc1370ab7d19` |
| `products/alisa/tests/economics_ledger/test_period_worker.py` | `35742fe248c0b6fa3a3f68d6381f46a23b43d94008e3e2194ae575c9382e2b29` |

## Isolated source checks

| Existing suite | Tests | Result |
| --- | ---: | --- |
| base | 499 | PASS |
| collection | 32 | PASS |
| compound | 51 | PASS |
| ledger | 94 | PASS |
| Total | 676 | PASS |

Every suite reported zero failures, errors, skips and external connections in its successful result. No live configuration was loaded. PostgreSQL used an owned network-none temporary container and Unix socket. Test processes used finite systemd units with bounded memory and termination.

Environmental failures were diagnosed rather than hidden: missing test-only DB roles; an empty `/usr/local/bin/node` and obsolete system Node; and a Python 3.11.0rc1 urllib HTTPError fixture failure. The DB roles were created only in the owned test DB. Node 22.22.2 was bound to the expected path only inside the test unit namespace. Base/collection/compound passed with the existing Python; ledger was then rerun under installed Python 3.12.13 and passed. Runtime source files and pins were not changed to fix these environment issues. A subsequent candidate qualification must use Python 3.12 throughout.

Successful result files are under `/root/alisa-parameter-evidence-20261114/r15-composite-20261115`: `PERIOD_base.json`, `PERIOD_NODE_collection.json`, `PERIOD_NODE_compound.json`, `PERIOD_PY312_ledger.json`. The earlier failed logs remain available there. The separate local targeted period run passed 72 tests; it is not added again to the suite total.

## Remaining full-report work

Order and tariff Worker sources, verified signed OTHER observations, Query-bound current owner inputs, composition, final model input and revision fences require separate integration and review. UNKNOWN must not become zero. An observed signed type-93 snapshot must not be labelled a qualified original debit stream or final lifetime finances. The deployed owner/browser acceptance remains a separate task; this source work does not switch it.

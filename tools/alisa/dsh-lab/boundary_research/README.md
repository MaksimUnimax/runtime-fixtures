Finite document/program boundary research, 11 November 2026.

This is operator QA, not a production executor or a user-request router.
The installed Harness worker and its isolation profile are reused unchanged.
Production API input packing v1 is used for the direct baseline.

Keep this entire operator directory outside every worker mount: deployed at
`/var/lib/alisa-dsh-lab/research_20261111`, parent mode0700, source/manifest0600.
Copy the reviewed parent `qa_gateway.py` here for the private research transport.
Do not copy fixtures, expected values, or their bytecode into the runtime prefix.
The gateway in the runtime prefix remains root0600, operator bytecode root0700.

Generators in fixtures.py:

- manifest(): initial ten cases; R1 stopped on the direct800 output cap.
- continuation_manifest(): remaining unpaid methods; reuses the already-paid
  direct800 result by matching the immutable input hash, without replay. Adds
  the rare final-review reason before that case's first paid invocation.
- boundary_manifest(): two additional size-boundary cases with another seed.

Each manifest has an independent persistent no-replay marker. Do not remove a
marker to repeat an experiment. The combined study used43 provider calls within
an initial48-call allowance: R1=15, R2=22, R3=6. No per-document two-call cap.

run_pairs.py is manually invoked with a trusted manifest and --max-calls. It
never calls a marketplace, selector, Station, or production DB. It snapshots
the existing answer settings, adds the same lab voice instruction to both
methods, alternates method order, and records each method's full cycle.
The optional methods list supports deliberate continuation of unpaid branches.

accounting.py is an offline calculator restricted to the two verified research
dates. It does not pretend to be a general tariff calendar or a billing API.
Missing/inconsistent usage is unknown, not zero; output already includes
thinking. The primary prices are USD; RUB uses the explicitly dated CBR rate.
All-input-uncached figures are counterfactual repricing, not new paid runs.

test_accounting.py performs11 offline tests, including a local synthetic HTTP
peer that raises after partial SSE data and optional raw-archive write failure.
It performs no real provider request. Run it with Python from this directory;
the test imports qa_gateway from its parent in the Git source layout.

summarize.py verifies source manifests, all raw request/response hashes, final
usage, uniqueness of provider IDs, full direct-data round-trip and immutable
Harness inputs. It emits only synthetic questions/answers and usage metadata.
The private evidence is under the existing lab evidence path with the same
one-day cleanup age threshold; that threshold is not an exact deletion SLA.
Do not publish provider IDs, raw messages, reasoning, production prompts or keys.

The published report is
`docs/alisa/quality/DOCUMENT_PROGRAM_BOUNDARY_2026-11-11.md` and matching JSON.
Research PASS is neither production readiness nor owner voice acceptance.
The proposed20000-character numerical-data threshold is not installed.

Known proof limits: one pair per size; different API protocols; high effort and
16384 output tokens per call; fresh-worker startup in Harness latency. The
direct800 method ran out of output tokens. Harness800 temporarily returned a
false zero after its generated program swallowed all548 row errors; the model
self-corrected. The handler did not automatically recognize that false zero.

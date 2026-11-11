# Isolated DeepSeek Harness laboratory

This is a manually invoked, finite QA installation for Alisa. It is not the
production model handler, a background executor, a task queue, or a Station route.

## Installed runtime

- Prefix: /opt/alisa-dsh-lab/20261110-r1.
- Official Python SDK and native runtime: 0.2.1rc2, exact dependencies in
  requirements.txt.
- Upstream tag: dsh-v0.2.1-rc.2, source
  687f282e8625c6b8d11ff58211a90524be2e4317.
- Linux x64 runtime wheel SHA256:
  0a0a4eb85a22cd9339972e6a5ced77a27ec791353a5b220e3e10b8cdbbdeca39.
- The complete npm 0.2.2-rc.1 graph was measured but not installed: its expanded
  size exceeded the server's available disk allowance. The published native
  wheel expands to 322,356,339 bytes before the small SDK dependencies.
- Model weights, GPU software, Office rendering engines, browsers
  and pandas were not installed for this calculation experiment.

The upstream native executable contains the normal Harness launcher and plugin
closure. In this version PTC is selected by tools.mode=ptc; it does not use the
later separate tool-executor-ptc package. The lab uses the shipped SDK minimal
profile plus lab.patch.yml. It exposes run_code; programs read complete data
through the standard Node filesystem API inside the isolated job filesystem.

## Isolation and accounting

The finite scripts run from the operator account. The Harness worker runs as
alisa-dsh-lab in a systemd RootDirectory containing read-only system libraries
and the runtime, one writable job directory, and a 64 MiB temporary filesystem.
The input file has its own read-only bind mount. Synthetic verification checks
that model-written code cannot append to it.
The root directory has a minimal passwd/group map; it does not bind production
code, production data, credentials, operator homes or other jobs.

The operator controllers are root-only (mode 0600): run_smoke.py, run_live.py,
qa_gateway.py and run_fixture_cases.py. README is root-only on the server too;
the operator __pycache__ directory is mode 0700. This matters because the runtime
prefix is mounted into the worker: a read-only mount alone does not hide the
test source or its oracles. Keep worker.py and lab.patch.yml readable by the
worker. Check effective readability as alisa-dsh-lab after copying an operator
script or compiling it; do not expose its bytecode as an alternate oracle path.

The worker starts with an empty inherited environment. Its local transport token
is not a DeepSeek API key. The root-only QA transport resolves the existing API
credential only for an actual upstream send, reconstructs headers, disables
ambient proxies and redirects, and permits only fixed DeepSeek endpoints.
The dedicated UID's temporary nftables table permits only 127.0.0.1:33191.
The table is removed on normal test exit; a leftover table restricts only the
dedicated UID and must be inspected before another run.

Each worker unit has CPUQuota=100%, MemoryMax=1024M, no swap, TasksMax=128 and
RuntimeMaxSec=180. Native PTC execution has a 30-second deadline and a 128 MiB
V8 heap limit. Output/message bounds are configured separately. These settings
are local QA resource limits, not business-response validation rules.

Session-log uploads, plugin-inventory submission, automatic compaction and model
retry are disabled. The transport records every admitted attempt before an
upstream send; actual dispatches have dispatched_utc. Missing receipts remain
unknown. The initial live run allowed four admissions and 16,384 output tokens
per call at high reasoning effort. A deliberate full-read repair reuses the
already paid baseline after verifying its exact request hash, carries forward
all four attempts, and permits only two additional admissions (six globally).

Messages usage is disjoint: input_tokens means uncached input, with
cache_read_input_tokens added for total input. output_tokens already includes
thinking. Use the last message_delta.usage; do not add initial usage or thinking
a second time. Chat Completions reports prompt_tokens inclusive of its cache.

## Verification commands

Run the complete synthetic provider/executor/isolation check:

    /opt/alisa-dsh-lab/20261110-r1/.venv/bin/python /opt/alisa-dsh-lab/20261110-r1/run_smoke.py

It performs no paid inference. The local synthetic provider supplies a program,
but the real Harness executor must compute the fixture and demonstrate that
production paths, another job and a different loopback service are unavailable.
Success requires Harness completion, a nonempty final answer, two successful
synthetic responses, and the verified tool result. A process exit code alone is
insufficient.

run_live.py is a one-time operator QA script for a privately prepared, complete,
hash-verified archived WB response. It compares one full-input final call with
one Harness final-answer cycle. The question, notes, model, effort and output
cap are held fixed; the input mechanism and protocol differ. It does not invoke
the selector, marketplace, Station or production database. The independent
Decimal oracle remains outside the worker's filesystem. Model-generated
calculations are not supplied by the operator.

The live output file is checked after acquiring the lab lock. Once it exists,
the script refuses to replay the paid comparison. A new experiment requires a
separate deliberately prepared case and evidence destination, not deleting the
guard to repeat a request.

The first live trial exposed an important distinction: the stock read tool is
a text preview that truncates long lines before returning its canonical value.
That preview cannot serve as a complete machine-readable JSON input. The
calculation profile disables it and directs model-written programs to read the
whole file through node:fs/promises. The updated offline fixture is an unbroken
JSON line over 210,000 characters, larger than the frozen WB input.

Keep raw test inputs and session logs private. Remove full input/session copies
after independent quality review. Publish only source code, resource and usage
measurements, and sanitized results.

Native startup also extracts about 83 MiB into each isolated job home. Completed
smoke directories are removed automatically after their evidence is saved and
the worker unit has stopped. Live directories are kept only until quality
review; remove them before starting the next case. Do not accumulate per-job
native caches on the production server's small root volume.

## Scope limits

A successful isolated trial does not establish compatibility for all templates
or production readiness. In the existing Alisa architecture an ordinary tool
cycle can add a model call: selector + program generation + final answer.
Compare the complete cycle's cost and correctness, not only the last response.
Do not enable this laboratory automatically for voice traffic.

## Short-answer instruction trial

answer_instruction.txt is a laboratory-only voice-answer instruction. It asks
for a concise answer containing every requested metric, with numbers written
out correctly. Production admin prompts and template purpose are unchanged.

run_fixture_cases.py accepts a trusted operator JSON manifest and one total
--max-calls allowance. The stock Harness owns the complete model/tool/error/
final-answer conversation. There is no two-call limit per case and no
case-specific retry path, code rewriting, import substitution, forced result
schema or business-data extraction in this controller. Program errors return
to the model with their original program and conversation context.

fixtures_short_answer.py generates only public synthetic QA data and private
expected values. Deploy the generated JSON under /var/lib/alisa-dsh-lab/cases,
outside all worker mounts, with a root-only parent and mode 0600. The generator
is not installed under the runtime prefix. Only the case data, original
question, notes and structural shape enter the job; expected values stay in
the root-side manifest and evidence.

The finite R3 check is invoked manually:

    /opt/alisa-dsh-lab/20261110-r1/.venv/bin/python /opt/alisa-dsh-lab/20261110-r1/run_fixture_cases.py /var/lib/alisa-dsh-lab/cases/short_answer_r3.json --max-calls 12

A persistent started marker prevents accidental replay. Worker time, memory,
CPU and output bounds remain the existing resource limits. Each completed job
is removed before the next case. A worker completion still requires independent
arithmetic and final-answer review; SDK completion is not a quality assertion.

The earlier R2 attempt and repair remain in their separate private evidence and
published partial report. Their per-case two-call allowance interrupted normal
model correction before the final answer. The temporary prompt restrictions
for static imports and scalar-only output were removed in R3. No new retry
engine, background service or production request path was added.

Synthetic costs do not estimate real marketplace workload. Keep this laboratory
outside automatic voice traffic until the full integration is validated.

Official references:

- https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.2
- https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/bundle/sdk-minimal/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/core/tools/README.md
- https://api-docs.deepseek.com/guides/anthropic_api/

## Document/program boundary study, 11 November

The finite synthetic study is in `boundary_research/` in the repository. Its
operator deployment is outside worker mounts at
`/var/lib/alisa-dsh-lab/research_20261111` (root0700), not under this runtime.
It used43 provider calls across12 paired scenarios, including one direct
output-limit failure. See
`docs/alisa/quality/DOCUMENT_PROGRAM_BOUNDARY_2026-11-11.md` and its JSON receipts.

Only the reviewed receipt-handling improvements in qa_gateway.py were added
to this lab runtime. Token-count completeness and response completion are now
separate; multiline/partial SSE and malformed envelopes are handled explicitly.
Optional raw captures are private QA evidence; archive failure does not erase
known billing counters. Unknown counts are not a zero-cost completion.
Eleven offline accounting tests and the native synthetic smoke passed.

No size-based production routing or automatic wrong-zero detector was added.
The model-written800-row program temporarily skipped548 rows and returned zero
without a tool error; the model then corrected it. This remains a quality risk,
not a proven runtime guarantee. Production usage accounting still requires a
per-Harness-call adapter before this lab can be integrated with voice traffic.

## Superseding full-request research — 11 November

Use `full_cost_research/` for the current study, deployed separately at
`/var/lib/alisa-dsh-lab/full_cost_20261111`. The earlier16k experiments above
are historical material, not the active cost conclusion. New160 paid calls
include50 real selections and110 answer/inspection/program/correction calls.
Answer requests use provider defaults without a QA max_tokens field. The
existing production-selector6000 remains unchanged. Native and selector mock
proofs preceded all paid runs.

New spending20.9543532315264RUB; cumulative Harness225 calls/26.7803184487788RUB.
The earlier separate formula trial is not included in this Harness subtotal.
All50 main numeric answers are correct, but whole-answer voice quality FAILS.
At about9.5k characters Harness was cheaper12/12; approximately10k is only an
engineering candidate for similar arithmetic, not a universal exact crossover.
No routing threshold was installed. Production/voice integration remains off.
See `docs/alisa/quality/DOCUMENT_PROGRAM_FULL_COST_2026-11-11.md` and
`tools/alisa/dsh-lab/full_cost_research/FULL_COST_SUMMARY.json`.

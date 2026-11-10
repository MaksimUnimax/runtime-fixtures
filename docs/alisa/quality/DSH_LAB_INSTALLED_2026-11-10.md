# DeepSeek Harness: isolated installation and first comparison

Status: **INSTALLED_ISOLATED_LAB_NOT_PRODUCTION**, 2026-11-10 UTC.

Installed on the Alisa server at `/opt/alisa-dsh-lab/20261110-r1` as a manually
invoked test runtime. It is not connected to voice traffic. No model weights,
GPU stack or permanent public service were installed.

## Installed version

Official Python SDK and native Linux x64 runtime are pinned to **0.2.1rc2**,
upstream tag `dsh-v0.2.1-rc.2`, source commit
`687f282e8625c6b8d11ff58211a90524be2e4317`. Runtime wheel SHA256:
`0a0a4eb85a22cd9339972e6a5ced77a27ec791353a5b220e3e10b8cdbbdeca39`.
The isolated prefix occupies approximately 318 MiB.

The newer npm 0.2.2-rc.1 dependency graph was inspected but not installed: its
expanded installation exceeded the available disk allowance. Rejected npm
manifests are retained only as installation evidence.

## First live comparison

One archived, complete WB response was used for one daily card-opening
calculation. The original question, full underlying source data, notes,
requested model, high reasoning effort and output cap were held fixed.
The input mechanism and API protocol differ: this measures the whole final
stage, not a controlled token-serialization benchmark.

| Final-stage measurement | Full data in model context | Successful Harness cycle |
| --- | ---: | ---: |
| Model calls | 1 | 2 |
| Total input tokens, including cached tokens | 35,993 | 11,073 |
| Cached input tokens | 128 | 2,432 |
| Output tokens, including thinking | 9,367 | 466 |
| Elapsed seconds | 37.95 | 7.312 |
| Actual model cost, RUB | 1.8206344794048 | 0.2620055109312 |
| Cost if all input were uncached, RUB | 1.82374866288 | 0.32117499696 |

Actual final-stage cost fell **85.61%** in this pair; the all-input-uncached
comparison fell **82.39%**. Independent Decimal review confirmed the requested
date, every source row, unchanged input identity and the final sum. The
operator did not supply the calculation result to the worker. The model wrote
the program and used its output to formulate the answer.

This is **one arithmetic scenario**, not evidence of the same savings across
all templates. Selector cost is excluded. In the current architecture a
successful full user request using this approach would normally require
selector + program generation + final answer, i.e. three calls rather than two.

### Failed first attempt and complete experiment cost

The first Harness trial made three paid calls and did not finish. Its stock
`read` tool returned a text preview truncated to 2,034 characters from a long
JSON line. Parsing that preview failed. The initial global budget then stopped
the run before an answer. This failure remains recorded as failed.

The calculation profile now disables that preview tool. Model-written code
reads the complete immutable input through `node:fs/promises`, then parses it
inside the isolated worker. No metric-specific production parser was added.

The repair reused the already paid baseline only after checking its exact
request hash, carried forward the earlier four dispatches, and allowed two
additional calls. The baseline was not paid for twice.

| Paid portion | Calls | RUB |
| --- | ---: | ---: |
| Baseline | 1 | 1.8206344794048 |
| Failed first Harness trial | 3 | 0.1286835030720 |
| Successful Harness repair | 2 | 0.2620055109312 |
| **Entire experiment** | **6** | **2.2113234934080** |

Costs use the applicable peak rates of USD 0.30 / 0.006 / 1.20 per million
uncached input / cached input / output tokens and CBR 82.7536 RUB/USD.
Messages receipts use disjoint uncached and cached input fields; the last
`message_delta.usage` is authoritative. Thinking is included in output, not
charged twice. Separate thinking-token counts were unavailable in the Messages
receipts. This is model inference cost, excluding server operating costs.

## Isolation, verification and cleanup

The dedicated unprivileged worker has a systemd root directory with the
read-only runtime, a read-only input file and one writable job directory.
Production files, operator homes, API credentials and other jobs are absent.
A UID-specific temporary firewall permits only the local QA transport.
The real DeepSeek key remains in the root-only transport; the worker receives
only a temporary local token. Proxies, redirects, log uploads and automatic
model retries are disabled.

Resource bounds: one CPU, 1 GiB memory, no swap, 128 tasks, a 180-second worker
deadline; individual program execution has a 30-second deadline and 128 MiB V8
heap. Local transport accepts only fixed official endpoints and bounded
requests. Every actual upstream dispatch and its receipt are accounted for.

The real executor passed an offline test using a single-line JSON file over
210,000 characters. It computed the synthetic sum and demonstrated that input
writes, production paths, credentials, a foreign job and another loopback
service were unavailable. Seven additional offline transport/accounting checks
passed. Python compilation passed. An independent reviewer checked arithmetic,
full-source identity, accounting and the initial failure classification.

Native startup extracts about 83 MiB into each job home. Earlier completed QA
jobs temporarily reduced free root space below the 3 GiB reserve. After review,
only this experiment's completed job directories and input/session copies were
removed; free space recovered to approximately 3,437 MiB. Completed smoke homes
are now removed automatically after evidence is saved and the worker stops.
The existing active tmpfiles-clean timer also ages stale job contents after one
hour and private evidence after one day; this is a cleanup schedule, not an
exact deletion deadline. No other agent's release or cache was removed.

At final inspection both production core and Station services were active,
there were no retained lab job directories and the temporary lab firewall
table was absent. A final offline executor run also verified automatic removal
of its completed job home, with zero paid calls; root free space was 3,411 MiB.
Production is concurrently maintained by other agents; this
installation did not roll back their changes.

## Remaining limit and next step

Calculation quality passed, but the generated answer is **not voice-approved**:
it contains unnecessary explanation and an incorrect Russian numeral case.
No Station playback was performed. There were zero selector, marketplace or
Station calls and zero production database writes in this comparison. Existing
production weekly model-use statistics and template fields were not changed.

Before production integration, shorten the final-answer instruction and test
other approved template types and full-request economics. Keep `purpose` for
selection; calculation guidance travels with API data in the final stage.
Raw API data, user questions, business values and private transcripts are not
published in this public repository.

Machine-readable accounting: [DSH_LAB_INSTALLED_2026-11-10.json](DSH_LAB_INSTALLED_2026-11-10.json).
Installed test source: [tools/alisa/dsh-lab](../../../tools/alisa/dsh-lab).

References: [official pinned source](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.2),
[official Messages API](https://api-docs.deepseek.com/guides/anthropic_api/),
[pricing](https://api-docs.deepseek.com/quick_start/pricing/),
[CBR rate for 10 November](https://cbr.ru/currency_base/daily/?UniDbQuery.Posted=True&UniDbQuery.To=10.11.2026).

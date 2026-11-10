# Harness: short-answer trial, 10 November 2026

Status: **PARTIAL_LAB_TRIAL_NOT_PRODUCTION**. This continues the isolated
[installation trial](DSH_LAB_INSTALLED_2026-11-10.md), using public synthetic
documents, not marketplace data. Production prompts, templates, core routing
and voice delivery were not changed.

## Instruction and observed answers

The laboratory adds [answer_instruction.txt](../../../tools/alisa/dsh-lab/answer_instruction.txt)
after the existing answer prompt. It asks for a short voice answer, all requested
metrics, numbers written out with correct inflection, and no narration of code,
file structure, row counts or verification. It preserves an explanation when
data are insufficient rather than substituting zero.

| Paid portion | Calls | Seconds | RUB | Result |
| --- | ---: | ---: | ---: | --- |
| Initial count fixture | 2 | 5.360 | 0.0848376666624 | Failed final stage |
| Thousand-inflection regression | 2 | 4.666 | 0.0368419027200 | Correct sum and concise answer |
| Compound question | 2 | 6.419 | 0.0937075285248 | Correct calculations; final answer incomplete |
| **This entire campaign** | **6** | — | **0.2153870979072** | **Partial** |

The count answer was:

> За восьмое ноября две тысячи двадцать шестого года карточки открывали тысячу шестьсот сорок два раза.

The program read the full 210,241-character document, summed all three current
values and excluded the comparison values. The numeric result matched the
separate oracle. The sentence is short and uses the correct accusative
«тысячу», addressing the same grammatical class as the earlier live trial.
This is one successful wording sample, not a guarantee for all numerals.

The compound program eventually computed logistics **140.37 RUB**, order
turnover **2500 RUB**, advertising **175 RUB**, DRR **7%**. It selected the
requested date, included the signed logistics refund and excluded storage and
other dates. All four values matched independent Decimal calculations.
However, there is **no completed final answer** for this question; it is not a
passed voice or full-request test.

## Failures, changes and accounting

1. The initial program returned long product descriptions with per-row data.
   Its output exceeded the existing 65,536-byte bound. The model received that
   error, corrected its program and computed the right total of 21. The two-call
   allowance then prevented a final model call. This remains a failed test.
2. The repair instruction explicitly requests compact aggregate output and
   excludes source rows, product arrays and descriptions. The full input is
   still read by model-written code; the handler does not extract business data.
   The repaired count uses a deliberately different synthetic value, 1642, to
   test thousand inflection. The original failed fixture definition is checked
   by hash before constructing the new fixture. This is not a same-input A/B.
3. To keep the announced six-call campaign allowance, money and ratio checks
   were combined in one compound question. There were two repair cycles, not
   three independent successful tests. The earlier two paid receipts were
   carried forward, with a global limit of six and separate repair evidence.
4. The compound program first emitted a static import. `run_code` executes an
   async-function body, where a static module import is invalid. The model
   received the syntax error and changed it to `await import(...)`; that program
   succeeded. The global allowance then prevented its final answer call.
5. An explicit dynamic-import instruction was briefly prepared after this run
   and received no paid verification. Following the owner's instruction to use
   a universal flow, that instruction and the restrictive scalar-output wording
   were removed. The successor runner leaves correction to the stock Harness
   conversation and removes the two-call allowance per case. No source-code
   rewriting, business-specific parser or output-bound increase was introduced.

All six actual DeepSeek dispatches received HTTP 200 usage receipts. The
subsequent rejected requests were local QA-budget decisions, **not provider
429 errors**. They were not sent upstream or charged as extra calls. Counts
and costs include the failed attempts; thinking is included in output tokens.

At the dated peak rates and CBR rate used in the preceding trial, this campaign
cost 0.2153870979072 RUB. Combined with the earlier installation comparison,
the total is **12 calls, 2.4267105913152 RUB**. These are inference charges, not
server operating costs. Tiny synthetic fixtures are not an economic estimate
for real marketplace reports; no new savings percentage is claimed.

## Test isolation and review

Preflight review found that the runtime's read-only prefix also contained the
operator controller source and bytecode. Read-only access alone would expose
the synthetic fixtures and oracle functions to the worker. Before any paid
call, controller files and README were made root-only (0600), and the operator
bytecode directory root-only (0700). Effective UID checks confirmed they were
unreadable; worker.py, the patch and runtime remained readable. The real
executor then passed offline smoke `smoke-095109` without paid inference.

Production answer settings are parsed and hashed from one byte snapshot,
avoiding a race with another agent changing them between two reads. Existing
production settings are read only. Per-job cleanup, immutable input, dedicated
UID network restrictions and the six-call bound remain in effect. Persistent
started markers prevent replay after private evidence is aged out.

The next validation must cover a completed compound answer with the general
execution flow before any production integration. Model recovery can
require an additional generation; two final-stage calls cannot be assumed for
every input. No Station playback or template admission occurred here.

Machine-readable results and usage: [DSH_SHORT_ANSWER_TRIAL_2026-11-10.json](DSH_SHORT_ANSWER_TRIAL_2026-11-10.json).

Follow-up: [universal flow and completed requests](UNIVERSAL_HARNESS_FLOW_2026-11-10.md).

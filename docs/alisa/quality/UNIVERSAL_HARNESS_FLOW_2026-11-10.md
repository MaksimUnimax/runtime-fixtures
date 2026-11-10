# Universal Harness flow: verified isolated QA

Status: **VERIFIED_SYNTHETIC_LAB_NOT_PRODUCTION**, 10 November 2026.

The laboratory no longer limits each question to two model calls. One
campaign-wide allowance and the existing worker resource bounds remain. The
stock Harness owns the full conversation: program generation, tool results,
errors, further model work and final answer. An extra model check or correction
is counted and can finish normally.

The controller does not rewrite generated code, substitute imports, extract
business values, infer parameter types, select business fields or force an
aggregate-output schema. Temporary instructions addressing particular import
and output failures were removed. The original question, notes, full data file
and generated structural shape enter the worker. Program result format remains
the model's choice for the question.

## Observed complete requests

These are public synthetic fixtures, not marketplace results or Station tests.

| Scenario | Calls | Seconds | Actual model cost, RUB | Arithmetic |
| --- | ---: | ---: | ---: | --- |
| Card openings | 3 | 7.534 | 0.0314223694560 | 1642, correct |
| Signed logistics amounts | 3 | 7.580 | 0.0291617066112 | 140.37, correct |
| Turnover, advertising, DRR | 2 | 6.323 | 0.0265197151776 | 2500 / 175 / 7%, correct |
| Same compound question with source currency | 2 | 6.053 | 0.0420658064736 | 2500 RUB / 175 RUB / 7%, correct |
| **New validation total** | **10** | — | **0.1291695977184** | |

The first two requests made additional inspections/checks and reached final
answers. There were no tool errors in this R3 validation. The recorded earlier
R2 trial already showed a real model correcting both an output-limit failure
and a static-import failure after receiving its program and tool error; its
two-call allowance then blocked final generation. That partial result remains
[recorded separately](DSH_SHORT_ANSWER_TRIAL_2026-11-10.md). No new correction
engine was introduced in R3; the artificial per-question interruption was
removed from the test controller.

Actual final answers:

> За восьмое ноября карточки открывали тысячу шестьсот сорок два раза.

> За восьмое ноября две тысячи двадцать шестого года расходы на логистику составили сто сорок рублей тридцать семь копеек.

The initial compound fixture contained no currency. Its answer included all
three correct numbers but no currency. The follow-up supplied `currency: RUB`
in the **source document** and used a general voice instruction to preserve
known units/currency without inventing unknown ones. It answered:

> Восьмого ноября оборот заказов составил две тысячи пятьсот рублей, расходы на рекламу — сто семьдесят пять рублей, а ДРР — семь процентов.

The tool result itself contained `currency: RUB` and all three values. The
controller does not insert rubles. This follow-up changed metadata and the
general voice instruction together; it is not a same-input A/B experiment.

## Isolation, cost and scope

The controller now accepts a private JSON test manifest. Questions and
documents are separate from expected values. The generated manifest and its
generator are under `/var/lib/alisa-dsh-lab/cases`, outside worker mounts.
Expected values never enter the worker's input or request. The manifest and
operator controller remain root-only; operator bytecode is also protected.
Immutable input, dedicated UID, network restriction, bounded worker lifetime,
CPU/memory/output limits and per-job cleanup retain the installed design.

There is one finite manual campaign allowance, not a fixed number of model
generations per question: 12 calls authorized for the main run and remaining
checks; eight were used initially and two of the remaining four for currency.
All ten sends have HTTP 200 provider usage receipts. Extra exploration and
failed historical attempts are included in accounting. No voice or marketplace
calls or production database writes occurred. Production prompts were read as
snapshots, not changed. No template admissions were made.

All new sends occurred after 10:00 UTC, at the published **off-peak** Flash
rates: USD 0.15 / 0.003 / 0.60 per million uncached input / cached input / output
tokens. Costs use CBR 82.7536 RUB/USD for 10 November. The main eight calls cost
0.0871037912448 RUB; 0.1742075824896 RUB is their **peak-normalized** cost,
not the actual tariff estimate. Time bands are derived from each dispatch
timestamp, not from the report generation time.

Including earlier installation and partial trials, the cumulative laboratory
total is **22 model calls, 2.5558801890336 RUB**. These are usage/tariff-based
inference estimates, excluding server costs and payment conversion fees.
Small synthetic documents do not predict production report economics. The
earlier one-report saving remains a separate, limited observation.

The installation is still an isolated manual laboratory. Production integration
and owner voice acceptance are separate steps; production weekly metrics and
paused voice testing were preserved.

Sources: [machine-readable results](UNIVERSAL_HARNESS_FLOW_2026-11-10.json),
[test controller](../../../tools/alisa/dsh-lab/run_fixture_cases.py),
[synthetic fixtures](../../../tools/alisa/dsh-lab/fixtures_short_answer.py),
[voice instruction](../../../tools/alisa/dsh-lab/answer_instruction.txt),
[official rates](https://api-docs.deepseek.com/quick_start/pricing/).

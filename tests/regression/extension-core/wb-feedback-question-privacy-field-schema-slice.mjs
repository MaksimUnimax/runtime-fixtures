import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const slice = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/wb-feedback-question-privacy-field-schema-slice-v1.json",
  ),
);
const coverage = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
  ),
);

function loadContract() {
  const context = {};
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    read(coverage.authorities.wildberries.registryPath),
    context,
    { filename: coverage.authorities.wildberries.registryPath },
  );
  vm.runInContext(read(slice.authority.frozenContract), context, {
    filename: slice.authority.frozenContract,
  });
  return { registry: context.WBOperations, contract: context.WBContract };
}
const { registry, contract } = loadContract();
const scenarios = new Map(coverage.scenarios.map((row) => [row.id, row]));
const clone = (value) => JSON.parse(JSON.stringify(value));

function assertOperation(source) {
  const meta = registry.OPERATIONS[source.operationAlias];
  assert.ok(meta, "missing WB operation " + source.operationAlias);
  assert.equal(meta.host, source.host, source.operationAlias + ": host drift");
  assert.equal(
    meta.method,
    source.method,
    source.operationAlias + ": method drift",
  );
  assert.equal(meta.path, source.path, source.operationAlias + ": path drift");
  assert.equal(meta.effect, "READ");
  assert.equal(meta.execution_enabled, true);
  assert.equal(meta.current, true);
  assert.equal(meta.privacy, slice.privacy.profile);
  return meta;
}

assert.equal(
  slice.schemaVersion,
  "wb_feedback_question_privacy_field_schema_slice_v1",
);
assert.deepEqual(slice.scope.scenarioIds, ["CAP-16"]);
assert.equal(
  slice.authority.mirrorCommit,
  "5057bdb9bf16dea24000e3ca79e1934f7761d7fe",
);
assert.equal(
  slice.authority.blobSha,
  "b59903fe6f5e9efef76d433b8f6430781b44c0b8",
);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);

const feedbacks = slice.sources.feedbacks;
const questions = slice.sources.questions;
const feedbackMeta = assertOperation(feedbacks);
const questionMeta = assertOperation(questions);
assert.deepEqual(
  [...feedbackMeta.required_query_keys],
  ["isAnswered", "take", "skip"],
);
assert.deepEqual(
  [...questionMeta.required_query_keys],
  ["isAnswered", "take", "skip"],
);
assert.equal(feedbacks.pagination.takeMax, 5000);
assert.equal(feedbacks.pagination.skipMax, 199990);
assert.equal(questions.pagination.takeMax, 10000);
assert.equal(questions.pagination.skipMax, 10000);
assert.equal(questions.pagination.takePlusSkipMax, 10000);
assert.equal(feedbacks.counts.countArchive, "PROCESSED_FEEDBACKS");
assert.equal(
  feedbacks.counts.processedMeaning,
  "ANSWERED_OR_RATING_ONLY_WITHOUT_TEXT_AND_PHOTO",
);
assert.equal(questions.counts.countArchive, "ANSWERED_QUESTIONS");
assert.equal(
  slice.privacy.boundary,
  "FREE_TEXT_REMAINS_AFTER_EMAIL_PHONE_REDACTION_DO_NOT_CALL_ANONYMOUS_OR_PUBLIC",
);

const cap16 = scenarios.get("CAP-16");
assert.ok(cap16, "CAP-16 missing");
assert.deepEqual(cap16.wbOperations, slice.acceptedMappingSnapshot["CAP-16"]);
assert.equal(cap16.omissionPolicy, "MISSING_NOT_ZERO");
assert.equal(cap16.continuationPolicy, "EXPLICIT_PAGINATION");
function command(operation, query) {
  return { operation, params: { query } };
}

function sanitize(operation, query, raw) {
  return clone(contract.sanitizeResult(command(operation, query), raw));
}

function validateQuery(kind, query) {
  const source = kind === "feedback" ? feedbacks : questions;
  if (
    !query ||
    typeof query.isAnswered !== "boolean" ||
    !Number.isInteger(query.take) ||
    !Number.isInteger(query.skip) ||
    query.take < 1 ||
    query.skip < 0
  )
    return { status: "INCOMPLETE", reason: "QUERY_PAGINATION_INVALID" };
  if (query.take > source.pagination.takeMax)
    return { status: "INCOMPLETE", reason: "QUERY_TAKE_LIMIT_EXCEEDED" };
  if (query.skip > source.pagination.skipMax)
    return { status: "INCOMPLETE", reason: "QUERY_SKIP_LIMIT_EXCEEDED" };
  if (
    kind === "question" &&
    query.take + query.skip > source.pagination.takePlusSkipMax
  )
    return { status: "INCOMPLETE", reason: "QUESTION_PROVIDER_WINDOW_LIMIT" };
  return { status: "PASS" };
}

function project(kind, query, raw) {
  const queryCheck = validateQuery(kind, query);
  if (queryCheck.status !== "PASS") return queryCheck;
  if (!raw || !raw.data || typeof raw.data !== "object")
    return { status: "INCOMPLETE", reason: "PROVIDER_DATA_MISSING" };
  const { countUnanswered, countArchive } = raw.data;
  if (
    !Number.isInteger(countUnanswered) ||
    countUnanswered < 0 ||
    !Number.isInteger(countArchive) ||
    countArchive < 0
  )
    return { status: "INCOMPLETE", reason: "PROVIDER_COUNTS_INVALID" };
  const rowsKey = kind === "feedback" ? "feedbacks" : "questions";
  const rows = raw.data[rowsKey];
  if (!Array.isArray(rows))
    return { status: "INCOMPLETE", reason: "PROVIDER_ROWS_MISSING" };
  const relevantCount = query.isAnswered ? countArchive : countUnanswered;

  if (
    kind === "question" &&
    relevantCount > questions.pagination.takePlusSkipMax
  )
    return { complete: false, reason: "QUESTION_PROVIDER_WINDOW_LIMIT" };

  const sanitized = sanitize(
    kind === "feedback" ? feedbacks.operationAlias : questions.operationAlias,
    query,
    raw,
  );
  const sanitizedRows = sanitized.data[rowsKey];
  const complete = query.skip === 0 && sanitizedRows.length === relevantCount;

  return {
    status: "PASS",
    relevantCount,
    rowCount: sanitizedRows.length,
    complete,
    reason: complete ? null : "PROVIDER_COUNT_NOT_FULLY_ENUMERATED",
    rows: sanitizedRows,
  };
}

const c = slice.syntheticCases;
const feedback = project("feedback", c.feedback.query, c.feedback.raw);
assert.equal(feedback.status, "PASS");
assert.equal(feedback.relevantCount, c.feedback.expected.relevantCount);
assert.equal(feedback.rowCount, c.feedback.expected.rowCount);
assert.equal(feedback.complete, c.feedback.expected.complete);
assert.equal(feedback.rows[0].userName, c.feedback.expected.firstUserName);
assert.equal(feedback.rows[0].text, c.feedback.expected.firstText);
assert.equal(feedback.rows[0].pros, c.feedback.expected.firstPros);
assert.equal(feedback.rows[0].cons, c.feedback.expected.firstCons);
assert.equal(
  JSON.stringify(feedback.rows).includes("fixture.person@example.test"),
  false,
);
assert.equal(JSON.stringify(feedback.rows).includes("Synthetic Buyer"), false);

const question = project("question", c.question.query, c.question.raw);
assert.equal(question.status, "PASS");
assert.equal(question.relevantCount, c.question.expected.relevantCount);
assert.equal(question.rowCount, c.question.expected.rowCount);
assert.equal(question.complete, c.question.expected.complete);
assert.equal(question.rows[0].text, c.question.expected.text);
assert.equal(question.rows[0].answer.text, c.question.expected.answerText);
assert.equal(
  JSON.stringify(question.rows).includes("question@example.test"),
  false,
);

const feedbackIncomplete = project(
  "feedback",
  c.feedbackIncomplete.query,
  c.feedbackIncomplete.raw,
);
assert.equal(
  feedbackIncomplete.complete,
  c.feedbackIncomplete.expected.complete,
);
assert.equal(feedbackIncomplete.reason, c.feedbackIncomplete.expected.reason);

const questionWindow = project(
  "question",
  c.questionWindowExceeded.query,
  c.questionWindowExceeded.raw,
);
assert.equal(
  questionWindow.complete,
  c.questionWindowExceeded.expected.complete,
);
assert.equal(questionWindow.reason, c.questionWindowExceeded.expected.reason);
assert.equal(
  slice.rules.count,
  "PRESERVE_COUNT_UNANSWERED_AND_COUNT_ARCHIVE_SEPARATELY",
);
assert.equal(
  slice.rules.feedbackArchive,
  "PROCESSED_IS_NOT_IDENTICAL_TO_ANSWERED_FOR_RATING_ONLY_FEEDBACK",
);
assert.equal(
  slice.rules.text,
  "USE_ACTUAL_CUSTOMER_SAFE_V1_SANITIZATION_BEFORE_REPORTING",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenario: "CAP-16",
    operations: [feedbacks.operationAlias, questions.operationAlias],
    privacyProfile: slice.privacy.profile,
    userNameRedacted: true,
    freeTextEmailPhoneRedacted: true,
    freeTextFullyRemoved: false,
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);

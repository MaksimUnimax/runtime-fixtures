import type { AuthorityRecord } from "./types.js";

// Store-owned causal order supplements wall time; legacy records have no order.
// Callers cannot choose the next order through safeProvenance.
export function authorityRecordSequence(record: AuthorityRecord): number {
  const value = record.safeProvenance.authorityRecordSequence;
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new Error("API_WATCH_AUTHORITY_SEQUENCE_INVALID");
  return value;
}

export function nextAuthorityRecordSequence(previous: number): number {
  if (
    !Number.isSafeInteger(previous) ||
    previous < 0 ||
    !Number.isSafeInteger(previous + 1)
  )
    throw new Error("API_WATCH_AUTHORITY_SEQUENCE_EXHAUSTED");
  return previous + 1;
}

export function compareAuthorityRecordOrder(
  a: AuthorityRecord,
  b: AuthorityRecord,
): number {
  return (
    a.validatedAt.valueOf() - b.validatedAt.valueOf() ||
    authorityRecordSequence(a) - authorityRecordSequence(b) ||
    // Legacy equal-clock observations cannot establish a later unblock.
    Number(a.failureClassification === "OPERATOR_SOURCE_REQUIRED") -
      Number(b.failureClassification === "OPERATOR_SOURCE_REQUIRED")
  );
}

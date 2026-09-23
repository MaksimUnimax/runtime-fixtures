import { sanitizeFeedbackText } from "@product/feedback-support";

const REDACTED_REASON = "[REDACTED]";

export function safeAuditReason(input: string): string {
  const sanitized = sanitizeFeedbackText(input).slice(0, 512);
  return sanitized || REDACTED_REASON;
}

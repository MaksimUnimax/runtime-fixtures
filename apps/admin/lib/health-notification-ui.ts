export function formatHealthNotificationSchedule(
  state: string,
  nextAttemptAt: string,
): string {
  // Retained dates are eligible for scheduling only in these two states.
  // An existing claim is governed by its lease instead of nextAttemptAt.
  switch (state) {
    case "PENDING":
      return `Attempt due ${nextAttemptAt}`;
    case "FAILED_RETRYABLE":
      return `Retry due ${nextAttemptAt}`;
    case "CLAIMED":
      return "Claimed; awaiting completion or lease expiry";
    case "DELIVERED":
      return "No next attempt (delivered)";
    case "FAILED_TERMINAL":
      return "No retry scheduled (terminal failure)";
    case "SUPPRESSED":
      return "No attempt while suppressed";
    default:
      return "Schedule unavailable";
  }
}

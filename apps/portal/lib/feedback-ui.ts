export const FEEDBACK_CATEGORIES = [
  "INSTALLATION",
  "AUTH",
  "OTP",
  "STORE",
  "OZON",
  "WILDBERRIES",
  "AI",
  "COMMAND",
  "REPORT",
  "FILE_RESULT",
  "SYNC",
  "TRANSFER",
  "BACKUP",
  "BROWSER_COMPAT",
  "SERVER_UNAVAILABLE",
  "VERSION_INCOMPATIBLE",
  "OTHER",
] as const;

export function buildFeedbackPayload(input: {
  accountId: string;
  category: string;
  description: string;
  includeDiagnostics: boolean;
}) {
  return {
    accountId: input.accountId,
    category: input.category,
    description: input.description,
    ...(input.includeDiagnostics
      ? { diagnostics: { portalVersion: "0.1.0" } }
      : {}),
  };
}

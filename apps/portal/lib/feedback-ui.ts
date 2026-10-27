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

/**
 * Project the authenticated own-case detail onto the *only* data the
 * existing Portal feedback list needs for B16-03. Never use staff/admin
 * detail APIs, and never display user notes as if support answered.
 */
export type OwnSupportReply = {
  followupId: string;
  authorType: "SUPPORT" | "ADMIN";
  body: string;
  createdAt: string;
};

export type OwnSupportResponse = {
  caseId: string;
  status: string;
  replies: OwnSupportReply[];
};

export function ownSupportResponse(
  value: unknown,
  expectedCaseId: string,
): OwnSupportResponse | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const detail = value as Record<string, unknown>;
  if (
    detail.caseId !== expectedCaseId ||
    typeof detail.status !== "string" ||
    !detail.status.trim() ||
    !Array.isArray(detail.followups)
  )
    return null;
  const replies: OwnSupportReply[] = [];
  for (const raw of detail.followups) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      return null;
    const entry = raw as Record<string, unknown>;
    if (
      typeof entry.followupId !== "string" ||
      !entry.followupId ||
      typeof entry.body !== "string" ||
      entry.body.length > 4000 ||
      typeof entry.createdAt !== "string" ||
      !entry.createdAt ||
      !["USER", "SUPPORT", "ADMIN"].includes(String(entry.authorType))
    )
      return null;
    if (entry.authorType === "SUPPORT" || entry.authorType === "ADMIN") {
      replies.push({
        followupId: entry.followupId,
        authorType: entry.authorType,
        body: entry.body,
        createdAt: entry.createdAt,
      });
    }
  }
  return { caseId: expectedCaseId, status: detail.status, replies };
}

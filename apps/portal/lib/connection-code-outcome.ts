import {
  ConnectionCodeIssueBodyV1Schema,
  ConnectionCodeIssueResponseV1Schema,
} from "@product/contracts";

export type ConnectionIssueInput = {
  accountId: string;
  expectedGeneration: number;
  mode: "CREATE" | "REPLACE_KEEP_DEVICES" | "REPLACE_REVOKE_DEVICES";
};
export type ConnectionIssueAttempt = {
  input: ConnectionIssueInput;
  key: string;
};
const operationKey = /^[A-Za-z0-9._:-]{16,128}$/;
export function parseConnectionIssueAttempt(
  raw: string | null,
  accountId: string,
): ConnectionIssueAttempt | undefined {
  try {
    const parsed = JSON.parse(raw ?? "null");
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Object.keys(parsed).sort().join(",") !== "input,key"
    )
      return;
    const input = ConnectionCodeIssueBodyV1Schema.safeParse(parsed.input);
    if (
      !input.success ||
      input.data.accountId !== accountId ||
      typeof parsed.key !== "string" ||
      !operationKey.test(parsed.key)
    )
      return;
    return { input: input.data, key: parsed.key };
  } catch {
    return;
  }
}
export function selectConnectionIssueAttempt(
  prior: ConnectionIssueAttempt | undefined,
  input: ConnectionIssueInput,
  key: () => string,
): ConnectionIssueAttempt {
  if (prior) {
    if (
      prior.input.accountId !== input.accountId ||
      prior.input.expectedGeneration !== input.expectedGeneration ||
      prior.input.mode !== input.mode
    )
      throw new Error("CONNECTION_PREVIOUS_OUTCOME_UNKNOWN");
    return prior;
  }
  const parsed = ConnectionCodeIssueBodyV1Schema.parse(input),
    next = key();
  if (!operationKey.test(next)) throw new Error("INVALID_OPERATION_KEY");
  return { input: parsed, key: next };
}
export async function requestConnectionCode(send: () => Promise<Response>) {
  let response: Response;
  try {
    response = await send();
  } catch {
    return { kind: "UNKNOWN" as const };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "UNKNOWN" as const };
  }
  if (response.ok) {
    const parsed = ConnectionCodeIssueResponseV1Schema.safeParse(body);
    return parsed.success
      ? { kind: "CONFIRMED" as const, value: parsed.data }
      : { kind: "UNKNOWN" as const };
  }
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  if (code === "CONNECTION_REAUTH_REQUIRED" || code === "AUTH_SESSION_INVALID")
    return { kind: "REAUTH_REQUIRED" as const };
  if (code === "CONNECTION_CODE_CONFLICT") return { kind: "CONFLICT" as const };
  if (code === "CONNECTION_CODE_RATE_LIMITED")
    return { kind: "RATE_LIMITED" as const };
  if (response.status >= 500) return { kind: "UNKNOWN" as const };
  return { kind: "REJECTED" as const };
}

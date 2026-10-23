export type OtpRequestResult =
  | { kind: "READY"; challengeId: string }
  | {
      kind:
        | "UNAVAILABLE"
        | "RATE_LIMITED"
        | "BETA_CLOSED"
        | "SERVER_ERROR"
        | "REJECTED"
        | "INVALID_RESPONSE";
    };

export type OtpVerifyResult =
  | { kind: "VERIFIED" }
  | {
      kind:
        | "UNAVAILABLE"
        | "RATE_LIMITED"
        | "BETA_CLOSED"
        | "SERVER_ERROR"
        | "CODE_REJECTED"
        | "INVALID_RESPONSE";
    };

export type OtpVerifyAttempt = {
  challengeId: string;
  code: string;
  key: string;
};

/** Preserve the key only when retrying the identical OTP verification input. */
export function selectOtpVerifyAttempt(
  previous: OtpVerifyAttempt | undefined,
  challengeId: string,
  code: string,
  generateKey: () => string,
): OtpVerifyAttempt {
  if (previous?.challengeId === challengeId && previous.code === code)
    return previous;
  return { challengeId, code, key: generateKey() };
}

async function responseErrorCode(
  response: Response,
): Promise<string | undefined> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return undefined;
  }
  if (!body || typeof body !== "object") return undefined;
  const error = (body as Record<string, unknown>).error;
  if (!error || typeof error !== "object") return undefined;
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
}

function betaClosed(code: string | undefined): boolean {
  return code === "BETA_CLOSED" || code === "BETA_CAPACITY_REACHED";
}

function isDocumentedExpiry(value: unknown): boolean {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value)
  )
    return false;
  const parsed = new Date(value);
  // Date.parse alone normalizes invalid calendar dates (e.g. February 30).
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 19) === value.slice(0, 19)
  );
}

function isDocumentedChallengeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

async function readResponseObject(
  response: Response,
): Promise<Record<string, unknown> | undefined> {
  try {
    const body: unknown = await response.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Only accepted server responses can advance the portal's OTP flow. */
export async function requestOtpChallenge(
  send: () => Promise<Response>,
): Promise<OtpRequestResult> {
  let response: Response;
  try {
    response = await send();
  } catch {
    return { kind: "UNAVAILABLE" };
  }
  if (!response.ok) {
    if (response.status >= 500) return { kind: "SERVER_ERROR" };
    if (response.status === 429) return { kind: "RATE_LIMITED" };
    if (betaClosed(await responseErrorCode(response)))
      return { kind: "BETA_CLOSED" };
    return { kind: "REJECTED" };
  }

  // The API defines only HTTP 202 + { status: "accepted", challengeId, expiresAt }.
  if (response.status !== 202) return { kind: "INVALID_RESPONSE" };
  const body = await readResponseObject(response);
  if (
    body?.status !== "accepted" ||
    !isDocumentedChallengeId(body.challengeId) ||
    !isDocumentedExpiry(body.expiresAt)
  )
    return { kind: "INVALID_RESPONSE" };
  return { kind: "READY", challengeId: body.challengeId };
}

/** A failed or unreachable verification must leave the current challenge intact. */
export async function verifyOtpChallenge(
  send: () => Promise<Response>,
): Promise<OtpVerifyResult> {
  let response: Response;
  try {
    response = await send();
  } catch {
    return { kind: "UNAVAILABLE" };
  }
  if (response.ok) {
    // Only the documented HTTP 200 authenticated envelope can cause navigation.
    if (response.status !== 200) return { kind: "INVALID_RESPONSE" };
    const body = await readResponseObject(response);
    return body?.status === "authenticated" &&
      isDocumentedExpiry(body.expiresAt)
      ? { kind: "VERIFIED" }
      : { kind: "INVALID_RESPONSE" };
  }
  if (response.status >= 500) return { kind: "SERVER_ERROR" };
  if (response.status === 429) return { kind: "RATE_LIMITED" };
  if (betaClosed(await responseErrorCode(response)))
    return { kind: "BETA_CLOSED" };
  return { kind: "CODE_REJECTED" };
}

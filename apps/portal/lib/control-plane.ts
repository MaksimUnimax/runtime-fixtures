import { acw1HttpBoundary } from "@product/contracts/account-code-http";
import {
  consumeAcw1HttpMetadataResponse,
  type Acw1HttpResponseData,
} from "@product/contracts/account-code-http-response";

const base = "/api/control-plane";
export function csrf(): string | undefined {
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("pcp_csrf="))
    ?.slice("pcp_csrf=".length);
}
export async function controlPlane(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.method && !["GET", "HEAD"].includes(init.method)) {
    const token = csrf();
    if (token) headers.set("x-csrf-token", token);
  }
  return fetch(`${base}${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
  });
}

export type ConnectionCodeRead = Readonly<{
  /** A local fetch attempt, not proof that the server received or applied it. */
  requestAttempted: boolean;
  /** Transient sensitive DATA; only response.safeLog is suitable for logging. */
  response: Acw1HttpResponseData;
}>;

/** A manual GET only. Never retry, issue/rotate, install credentials or infer
 * no-grant from metadata, a receipt, status, a rejected fetch or a missing body.
 */
export async function readConnectionCode(
  accountId: string,
  mode: "issue" | "rotate" | "lookup",
  operationId?: string,
): Promise<ConnectionCodeRead> {
  const unknown = (requestAttempted: boolean): ConnectionCodeRead => Object.freeze({
    requestAttempted,
    response: consumeAcw1HttpMetadataResponse(mode, 0, new Uint8Array(), {}),
  });
  // Scalars are captured before await. No URL repair/coercion or context from
  // returned metadata; lookup Id is supplied by this caller's explicit input.
  if (typeof accountId !== "string" || accountId.length !== 36 ||
      (mode !== "issue" && mode !== "rotate" && mode !== "lookup") ||
      (mode === "lookup" ? typeof operationId !== "string" || operationId.length !== 36 : operationId !== undefined))
    return unknown(false);
  const path = `/v1/accounts/${accountId}/connection-code?${mode === "lookup"
    ? `operationId=${operationId}` : `action=${mode}`}`;
  const intent = acw1HttpBoundary("GET", path);
  if (intent.kind !== "METADATA_READ") return unknown(false);
  const read = intent.read;
  try {
    const upstream = await controlPlane(path, { method: "GET", cache: "no-store" });
    const reader = upstream.body?.getReader();
    if (!reader) return unknown(true);
    // Normative success cap; the same finite local fallback bounds errors.
    // This does not select a new normative error-byte limit or timeout policy.
    const bytes = new Uint8Array(16384);
    let length = 0, complete = false;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) { complete = true; break; }
        if (part.value.byteLength > bytes.byteLength - length) return unknown(true);
        bytes.set(part.value, length);
        length += part.value.byteLength;
      }
    } finally {
      if (!complete) {
        try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
      }
      try { reader.releaseLock(); } catch {}
    }
    return Object.freeze({ requestAttempted: true,
      response: consumeAcw1HttpMetadataResponse(read.mode, upstream.status, bytes.subarray(0, length), {
        accountId: read.accountId,
        ...(read.mode === "lookup" ? { operationId: read.operationId } : {}),
      }),
    });
  } catch {
    // No exception, ticket, raw body or request input is reflected or logged.
    return unknown(true);
  }
}

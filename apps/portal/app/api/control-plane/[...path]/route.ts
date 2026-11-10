import type { NextRequest } from "next/server";
import { acw1HttpResponseMetadata } from "@product/contracts/account-code-http";
import { consumeAcw1HttpMetadataResponse } from "@product/contracts/account-code-http-response";
import {
  accountCodeReadIntent,
  allowedRoute,
  controlPlaneOrigin,
} from "../../../../lib/control-plane-route";

const responseByteLimit = 16384;

/** Own accumulator is bounded; no decoding/JSON conversion or prefix acceptance. */
async function readAccountCodeBody(response: Response): Promise<Uint8Array | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const bytes = new Uint8Array(responseByteLimit);
  let length = 0, complete = false;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) { complete = true; return bytes.subarray(0, length); }
      // Check before retaining/copying an already-returned upstream chunk.
      if (part.value.byteLength > responseByteLimit - length) return undefined;
      bytes.set(part.value, length);
      length += part.value.byteLength;
    }
  } finally {
    if (!complete) {
      // Best effort only: a hanging cancel must not hold the fixed fallback.
      try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
    }
    try { reader.releaseLock(); } catch {}
  }
}

function noStore(headers = new Headers()): Headers {
  headers.set("cache-control", acw1HttpResponseMetadata().headers["cache-control"]);
  return headers;
}

function unavailable(headers = new Headers()): Response {
  return Response.json(
    { error: { code: "SERVICE_UNAVAILABLE", message: "Service unavailable" } },
    { status: 503, headers: noStore(headers) },
  );
}

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params,
    pathname = `/${path.join("/")}`;
  const method = request.method, search = request.nextUrl.search;
  // Capture expected context before upstream await; never adopt response fields.
  const read = accountCodeReadIntent(method, pathname, search);
  const accountCodeTarget = /^\/v1\/accounts\/[^/]+\/connection-code(?:\/|$)/.test(pathname)
    || pathname.startsWith("/v1/account-code/");
  const target = controlPlaneOrigin();
  if ((!read && !allowedRoute(method, pathname)) || !target)
    return Response.json(
      { error: { code: "INVALID_REQUEST", message: "Not found" } },
      { status: 404, ...(accountCodeTarget ? { headers: noStore() } : {}) },
    );
  const headers = new Headers();
  for (const name of [
    "content-type",
    "cookie",
    "x-csrf-token",
    "idempotency-key",
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const upstream = await fetch(
      `${target}${pathname}${search}`,
      {
        method,
        headers,
        body: ["GET", "HEAD"].includes(method)
          ? undefined
          : await request.arrayBuffer(),
        cache: "no-store",
      },
    );
    const output = new Headers();
    for (const name of [
      "content-type",
      "cache-control",
      "pragma",
      "retry-after",
    ]) {
      const value = upstream.headers.get(name);
      if (value) output.set(name, value);
    }
    for (const cookie of upstream.headers.getSetCookie())
      output.append("set-cookie", cookie);
    if (read) {
      let bytes: Uint8Array | undefined;
      try { bytes = await readAccountCodeBody(upstream); }
      catch { return unavailable(output); }
      if (!bytes) return unavailable(output);
      const result = consumeAcw1HttpMetadataResponse(read.mode, upstream.status, bytes, {
        accountId: read.accountId,
        ...(read.mode === "lookup" ? { operationId: read.operationId } : {}),
      });
      if (result.kind !== "ACW1_METADATA_DATA" && result.kind !== "ACW1_ERROR_DATA")
        return unavailable(output);
      // Sensitive DATA is never a logger input or auth/ACK/state decision.
      // Stream the validated complete bytes without another owned body copy.
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(bytes); controller.close(); },
      }), { status: result.status, headers: noStore(output) });
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: output,
    });
  } catch {
    if (read) return unavailable();
    return Response.json(
      {
        error: { code: "SERVICE_UNAVAILABLE", message: "Service unavailable" },
      },
      { status: 503 },
    );
  }
}
export const GET = proxy;
export const POST = proxy;

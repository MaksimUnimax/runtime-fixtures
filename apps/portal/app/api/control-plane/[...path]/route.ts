import { NextRequest } from "next/server";
import {
  allowedRoute,
  controlPlaneOrigin,
} from "../../../../lib/control-plane-route";
async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params,
    pathname = `/${path.join("/")}`;
  const target = controlPlaneOrigin();
  if (!allowedRoute(request.method, pathname) || !target)
    return Response.json(
      { error: { code: "INVALID_REQUEST", message: "Not found" } },
      { status: 404 },
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
      `${target}${pathname}${request.nextUrl.search}`,
      {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method)
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
    return new Response(upstream.body, {
      status: upstream.status,
      headers: output,
    });
  } catch {
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

export type ApiErrorCode =
  | "ADMIN_UNAUTHORIZED"
  | "ADMIN_REAUTH_REQUIRED"
  | "ADMIN_FORBIDDEN"
  | "ADMIN_CSRF_INVALID"
  | "ADMIN_STATE_STALE"
  | "ADMIN_CONFLICT"
  | "ADMIN_RESOURCE_NOT_FOUND"
  | "SERVICE_UNAVAILABLE"
  | "INVALID_REQUEST"
  | string;
export class ControlPlaneError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: number,
    message = "Request failed",
  ) {
    super(message);
  }
}

function csrf(name: "pcp_csrf" | "pcp_admin_csrf"): string | undefined {
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function csrfFor(path: string, method: string): string | undefined {
  if (method === "GET" || method === "HEAD") return undefined;
  if (!path.startsWith("/v1/admin/")) return undefined;
  return path === "/v1/admin/session" && method === "POST"
    ? csrf("pcp_csrf")
    : csrf("pcp_admin_csrf");
}

export async function controlPlane<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!path.startsWith("/v1/"))
    throw new ControlPlaneError("INVALID_REQUEST", 400);
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  const token = csrfFor(path, method);
  if (token) headers.set("x-csrf-token", token);
  let response: Response;
  try {
    response = await fetch(
      `${process.env.NEXT_PUBLIC_ADMIN_BASE_PATH ?? ""}/api/control-plane${path}`,
      {
        ...init,
        method,
        headers,
        credentials: "same-origin",
        cache: "no-store",
      },
    );
  } catch {
    throw new ControlPlaneError(
      "SERVICE_UNAVAILABLE",
      503,
      "Service unavailable",
    );
  }
  if (!response.ok) {
    let code =
      response.status >= 500 ? "SERVICE_UNAVAILABLE" : "REQUEST_FAILED";
    let message = "Request failed";
    try {
      const body = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      code = body.error?.code ?? code;
      message =
        body.error?.message && !/[\n<>]/.test(body.error.message)
          ? body.error.message
          : message;
    } catch {
      /* safe generic message */
    }
    throw new ControlPlaneError(code, response.status, message);
  }
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    throw new ControlPlaneError("INVALID_RESPONSE", 502, "Invalid response");
  }
}

export function query(
  values: Record<string, string | number | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== "") params.set(key, String(value));
  const result = params.toString();
  return result ? `?${result}` : "";
}

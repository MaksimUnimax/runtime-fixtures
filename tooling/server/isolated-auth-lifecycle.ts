import { randomUUID } from "node:crypto";

export interface IsolatedAuthIdentity {
  readonly email: string;
  readonly disposable: true;
}

export interface IsolatedAuthLifecycleOptions {
  /** API origin used by the extension's public start/exchange calls. */
  readonly apiOrigin: string;
  /** Portal origin; authenticated portal API calls use its same-origin proxy. */
  readonly portalOrigin: string;
  /** Must name a loopback database with test, e2e, or disposable in its name. */
  readonly disposableDatabaseUrl: string;
  readonly identity: IsolatedAuthIdentity;
  /** Supplies only a generated local OTP fixture. Never read mail or logs here. */
  readonly readOtpFixture: (request: {
    readonly email: string;
    readonly challengeId: string;
    readonly expiresAt: string;
  }) => Promise<string>;
  readonly fetch?: typeof fetch;
}

export interface IsolatedDeviceStart {
  readonly status: "pending";
  readonly authorizationId: string;
  readonly deviceCode: string;
  readonly userCode: string;
  readonly expiresAt: string;
}

export interface IsolatedDeviceToken {
  readonly status: "activated";
  readonly deviceId: string;
  readonly sessionId: string;
  readonly tokenType: "Bearer";
  readonly accessToken: string;
  readonly accessTokenExpiresAt: string;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: string;
}

export type IsolatedDeviceExchange =
  | { readonly kind: "pending"; readonly retryAfter: string | null }
  | { readonly kind: "activated"; readonly token: IsolatedDeviceToken }
  | { readonly kind: "closed"; readonly code: "DEVICE_AUTH_CLOSED" }
  | { readonly kind: "failed"; readonly status: number; readonly code: string };

const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);
const otpTestIdentity = /^[^\s@]+@[^\s@]+\.test$/i;

function isLoopback(hostname: string): boolean {
  return loopbackHosts.has(hostname.toLowerCase().replace(/^\[|\]$/g, ""));
}

function assertLoopbackOrigin(raw: string, label: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} must be an absolute loopback origin`);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !isLoopback(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(`${label} must be a plain loopback origin`);
  return url.origin;
}

function assertDisposableDatabase(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("disposableDatabaseUrl must be an absolute PostgreSQL URL");
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !isLoopback(url.hostname) ||
    !/(?:test|e2e|disposable)/i.test(name)
  )
    throw new Error(
      "disposableDatabaseUrl must point to a loopback test, e2e, or disposable database",
    );
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function getErrorCode(body: unknown): string {
  const error = record(record(body).error);
  return typeof error.code === "string" ? error.code : "UNKNOWN_ERROR";
}

function cookieValue(setCookie: string, name: string): string | undefined {
  const match = setCookie.match(new RegExp(`(?:^|,\\s*)${name}=([^;,]*)`));
  return match?.[1];
}

export class IsolatedAuthLifecycleDriver {
  private readonly apiOrigin: string;
  private readonly portalOrigin: string;
  private readonly identity: IsolatedAuthIdentity;
  private readonly readOtpFixture: IsolatedAuthLifecycleOptions["readOtpFixture"];
  private readonly fetcher: typeof fetch;
  private readonly cookies = new Map<string, string>();
  private readonly exchangeKeys = new Map<string, string>();

  public constructor(options: IsolatedAuthLifecycleOptions) {
    this.apiOrigin = assertLoopbackOrigin(options.apiOrigin, "apiOrigin");
    this.portalOrigin = assertLoopbackOrigin(
      options.portalOrigin,
      "portalOrigin",
    );
    assertDisposableDatabase(options.disposableDatabaseUrl);
    if (
      options.identity.disposable !== true ||
      !otpTestIdentity.test(options.identity.email)
    )
      throw new Error("identity must be an explicit disposable *.test identity");
    this.identity = options.identity;
    this.readOtpFixture = options.readOtpFixture;
    this.fetcher = options.fetch ?? fetch;
  }

  /** Request and verify one ordinary OTP through the portal's same-origin proxy. */
  public async login(): Promise<{ readonly expiresAt: string }> {
    const requested = await this.portal("/v1/auth/otp/request", {
      method: "POST",
      body: { email: this.identity.email },
    });
    if (requested.response.status !== 202)
      throw new Error(`OTP request failed: ${requested.code}`);
    const challengeId = requested.body.challengeId;
    const expiresAt = requested.body.expiresAt;
    if (typeof challengeId !== "string" || typeof expiresAt !== "string")
      throw new Error("OTP request returned an invalid challenge response");
    const code = await this.readOtpFixture({
      email: this.identity.email,
      challengeId,
      expiresAt,
    });
    if (!/^\d{6}$/.test(code))
      throw new Error("OTP fixture callback must return a six-digit code");
    const verified = await this.portal("/v1/auth/otp/verify", {
      method: "POST",
      body: { challengeId, code },
      headers: { "idempotency-key": randomUUID() },
    });
    if (verified.response.status !== 200)
      throw new Error(`OTP verification failed: ${verified.code}`);
    return { expiresAt: String(verified.body.expiresAt) };
  }

  public async listAccounts(): Promise<readonly Record<string, unknown>[]> {
    const result = await this.portal("/v1/accounts");
    if (!result.response.ok)
      throw new Error(`Account listing failed: ${result.code}`);
    return Array.isArray(result.body.accounts)
      ? result.body.accounts.map(record)
      : [];
  }

  /** Start using the same unauthenticated API call as an extension client. */
  public async startDevice(input: {
    readonly browserFamily:
      | "chrome"
      | "opera"
      | "yandex_chromium"
      | "firefox"
      | "safari";
    readonly extensionVersion: string;
    readonly deviceLabel?: string;
  }): Promise<IsolatedDeviceStart> {
    const result = await this.api("/v1/device-authorizations", {
      method: "POST",
      body: { clientType: "browser_extension", ...input },
      headers: { "idempotency-key": randomUUID() },
    });
    if (result.response.status !== 201)
      throw new Error(`Device authorization start failed: ${result.code}`);
    return result.body as unknown as IsolatedDeviceStart;
  }

  public async previewDevice(
    authorizationId: string,
  ): Promise<Record<string, unknown>> {
    const result = await this.portal(
      `/v1/device-authorizations/${encodeURIComponent(authorizationId)}`,
    );
    if (!result.response.ok)
      throw new Error(`Device preview failed: ${result.code}`);
    return result.body;
  }

  public async approveDevice(
    authorizationId: string,
    accountId: string,
    userCode: string,
  ): Promise<void> {
    const result = await this.portal(
      `/v1/device-authorizations/${encodeURIComponent(authorizationId)}/approve`,
      { method: "POST", body: { accountId, userCode } },
    );
    if (result.response.status !== 200)
      throw new Error(`Device approval failed: ${result.code}`);
  }

  /** Denial is the product's ordinary cancellation action for a pending request. */
  public async cancelDevice(
    authorizationId: string,
    userCode: string,
  ): Promise<void> {
    const result = await this.portal(
      `/v1/device-authorizations/${encodeURIComponent(authorizationId)}/deny`,
      { method: "POST", body: { userCode } },
    );
    if (result.response.status !== 200)
      throw new Error(`Device cancellation failed: ${result.code}`);
  }

  /** A normal pending/closed/activated result; never changes product expiry. */
  public async exchangeDevice(
    deviceCode: string,
  ): Promise<IsolatedDeviceExchange> {
    let idempotencyKey = this.exchangeKeys.get(deviceCode);
    if (!idempotencyKey) {
      idempotencyKey = randomUUID();
      this.exchangeKeys.set(deviceCode, idempotencyKey);
    }
    const result = await this.api("/v1/device-authorizations/token", {
      method: "POST",
      body: { deviceCode },
      headers: { "idempotency-key": idempotencyKey },
    });
    if (result.response.status === 200)
      return {
        kind: "activated",
        token: result.body as unknown as IsolatedDeviceToken,
      };
    if (result.code === "DEVICE_AUTH_PENDING")
      return { kind: "pending", retryAfter: result.response.headers.get("retry-after") };
    if (result.code === "DEVICE_AUTH_CLOSED")
      return { kind: "closed", code: result.code };
    return { kind: "failed", status: result.response.status, code: result.code };
  }

  /** After expiry, ask the normal exchange API for its terminal outcome. */
  public async observeExpiredDevice(
    device: Pick<IsolatedDeviceStart, "deviceCode" | "expiresAt">,
    now = new Date(),
  ): Promise<IsolatedDeviceExchange> {
    const expiresAt = Date.parse(device.expiresAt);
    if (!Number.isFinite(expiresAt))
      throw new Error("Device authorization expiry must be a valid timestamp");
    if (now.getTime() < expiresAt)
      throw new Error(
        "Cannot observe expiry before the server-issued expiry boundary",
      );
    // The API intentionally has one closed response for denied, expired, and
    // otherwise terminal requests. Keep that product contract visible.
    return this.exchangeDevice(device.deviceCode);
  }

  /** Device revocation uses the normal portal endpoint and CSRF contract. */
  public async revokeDevice(deviceId: string): Promise<void> {
    const result = await this.portal(
      `/v1/devices/${encodeURIComponent(deviceId)}/revoke`,
      { method: "POST", body: {} },
    );
    if (result.response.status !== 200)
      throw new Error(`Device revocation failed: ${result.code}`);
  }

  public async logout(): Promise<void> {
    const result = await this.portal("/v1/auth/logout", {
      method: "POST",
      body: {},
    });
    if (result.response.status !== 204)
      throw new Error(`Logout failed: ${result.code}`);
    this.cookies.clear();
  }

  private async portal(
    path: string,
    input: {
      readonly method?: "GET" | "POST";
      readonly body?: unknown;
      readonly headers?: Record<string, string>;
    } = {},
  ) {
    const headers = { ...input.headers };
    const csrf = this.cookies.get("pcp_csrf");
    if (input.method === "POST" && csrf) headers["x-csrf-token"] = csrf;
    return this.request(
      `${this.portalOrigin}/api/control-plane${path}`,
      input.method ?? "GET",
      input.body,
      headers,
      true,
    );
  }

  private async api(
    path: string,
    input: {
      readonly method: "POST";
      readonly body: unknown;
      readonly headers?: Record<string, string>;
    },
  ) {
    return this.request(
      `${this.apiOrigin}${path}`,
      input.method,
      input.body,
      input.headers ?? {},
      false,
    );
  }

  private async request(
    url: string,
    method: "GET" | "POST",
    body: unknown,
    headers: Record<string, string>,
    portal: boolean,
  ) {
    const requestHeaders = new Headers(headers);
    if (body !== undefined) requestHeaders.set("content-type", "application/json");
    if (portal && this.cookies.size)
      requestHeaders.set(
        "cookie",
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    if (!requestHeaders.has("x-request-id"))
      requestHeaders.set("x-request-id", randomUUID());
    const response = await this.fetcher(url, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
      redirect: "manual",
      cache: "no-store",
    });
    if (response.status >= 300 && response.status < 400)
      throw new Error("Isolated auth lifecycle endpoints must not redirect");
    if (portal) {
      for (const value of response.headers.getSetCookie()) {
        for (const name of ["pcp_portal_session", "pcp_csrf"]) {
          const found = cookieValue(value, name);
          if (found !== undefined) {
            if (/Max-Age=0/i.test(value)) this.cookies.delete(name);
            else this.cookies.set(name, found);
          }
        }
      }
    }
    let bodyValue: unknown = {};
    if (response.status !== 204) {
      try {
        bodyValue = await response.json();
      } catch {
        bodyValue = {};
      }
    }
    return {
      response,
      body: record(bodyValue),
      code: getErrorCode(bodyValue),
    };
  }
}

export function createIsolatedAuthLifecycleDriver(
  options: IsolatedAuthLifecycleOptions,
): IsolatedAuthLifecycleDriver {
  return new IsolatedAuthLifecycleDriver(options);
}

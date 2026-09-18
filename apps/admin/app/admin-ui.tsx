"use client";

import {
  createContext,
  FormEvent,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { controlPlane, ControlPlaneError, query } from "../lib/control-plane";

type Me = {
  status: "authenticated";
  principalId: string;
  roles: string[];
  permissions: string[];
  expiresAt: string;
};
type Section =
  | "dashboard"
  | "accounts"
  | "account"
  | "users"
  | "principals"
  | "audit"
  | "plans"
  | "plan"
  | "prices"
  | "price"
  | "entitlements"
  | "compatibility"
  | "beta";
type Notice = { kind: "error" | "success" | "info"; text: string } | null;
type Page<T> = { items: T[]; nextCursor: string | null };
type Account = {
  id: string;
  status: string;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
};
type User = {
  id: string;
  status: string;
  emails: { email: string; verifiedAt: string | null }[];
  createdAt: string;
  updatedAt: string;
};
type Device = {
  id: string;
  status: string;
  label: string | null;
  browserFamily: string;
  browserVersionLastSeen: string | null;
  extensionVersionLastSeen: string | null;
  createdAt: string;
  activatedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
};
type Subscription = {
  accountId: string;
  accessBasis?: "BETA" | "COMMERCIAL" | "NONE";
  access: { status: string; reason: string | null };
  subscription: Record<string, unknown> | null;
  deviceAllowance: unknown;
};
type BetaState = {
  mode: "CLOSED" | "OPEN" | "PAUSED";
  capacity: number;
  admitted: number;
  remaining: number;
  revision: number;
  updatedAt: string;
};

const AdminContext = createContext<{
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<Me | null>;
  signOut: () => Promise<void>;
  notice: Notice;
  setNotice: (notice: Notice) => void;
  otpRequired: boolean;
}>({
  me: null,
  loading: true,
  refresh: async () => null,
  signOut: async () => undefined,
  notice: null,
  setNotice: () => undefined,
  otpRequired: false,
});

export function safeError(error: unknown): string {
  if (error instanceof ControlPlaneError) {
    if (error.code === "ADMIN_STATE_STALE")
      return "Data changed. The previous operation was not repeated. Review the refreshed data and submit a new operation.";
    if (error.code === "ADMIN_CONFLICT")
      return "The previous operation was not repeated because current server state changed. Review the refreshed data and submit a new operation.";
    if (error.code === "ADMIN_RESOURCE_NOT_FOUND")
      return "This resource is no longer available.";
    if (error.code === "SERVICE_UNAVAILABLE")
      return "The control plane is temporarily unavailable.";
    if (error.code === "ADMIN_FORBIDDEN")
      return "Your permission changed. The page has been refreshed.";
    if (
      error.code === "ADMIN_REAUTH_REQUIRED" ||
      error.code === "ADMIN_CSRF_INVALID"
    )
      return "Your elevation has expired. Re-authenticate to continue.";
    if (error.code === "ADMIN_UNAUTHORIZED")
      return "Your admin session has ended.";
    return "The administrative operation could not be completed.";
  }
  return "The control plane is temporarily unavailable.";
}

export function AdminProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [otpRequired, setOtpRequired] = useState(false);
  const refresh = async (): Promise<Me | null> => {
    try {
      const value = await controlPlane<Me>("/v1/admin/me");
      setMe(value);
      setOtpRequired(false);
      return value;
    } catch (error) {
      if (
        error instanceof ControlPlaneError &&
        error.code === "ADMIN_REAUTH_REQUIRED"
      ) {
        setOtpRequired(true);
        setNotice({ kind: "info", text: "Re-authentication is required." });
      }
      setMe(null);
      return null;
    }
  };
  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, []);
  const signOut = async () => {
    try {
      await controlPlane("/v1/admin/session", { method: "DELETE" });
    } catch (error) {
      setNotice({ kind: "error", text: safeError(error) });
      throw error;
    }
    setMe(null);
    setOtpRequired(false);
    setNotice(null);
  };
  return (
    <AdminContext.Provider
      value={{
        me,
        loading,
        refresh,
        signOut,
        notice,
        setNotice,
        otpRequired,
      }}
    >
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  return useContext(AdminContext);
}
export function has(me: Me | null, permission: string) {
  return Boolean(me?.permissions.includes(permission));
}

export function withCursor(path: string, cursor: string): string {
  const [pathname, rawQuery = ""] = path.split("?", 2);
  const params = new URLSearchParams(rawQuery);
  params.set("cursor", cursor);
  return pathname + "?" + params.toString();
}

export function buildPriceCreateBody(input: {
  planId: string;
  code: string;
  marketKey: string;
  channelKey: string;
}): Record<string, string> {
  return {
    planId: input.planId,
    code: input.code,
    marketKey: input.marketKey,
    channelKey: input.channelKey,
  };
}

export function buildCompatibilityPublishBody(reason: string) {
  return {
    browserFamily: null,
    minimumExtensionVersion: null,
    recommendedExtensionVersion: null,
    minimumBrowserVersion: null,
    maintenanceMode: false,
    maintenanceCode: null,
    blockedVersions: [],
    reason,
  };
}
function PageMessage({ notice }: { notice: Notice }) {
  return notice ? (
    <div
      className={`notice ${notice.kind === "error" ? "error" : notice.kind === "success" ? "success" : ""}`}
      role="status"
      aria-live="polite"
    >
      {notice.text}
    </div>
  ) : null;
}

const nav = [
  ["Health", "/health", "health.read"],
  ["Beta admission", "/beta", "beta.admission.read"],
  ["Accounts", "/accounts", "account.read"],
  ["Users", "/users", "user.read"],
  ["Principals", "/principals", "admin.principal.read"],
  ["Audit", "/audit", "admin.audit.read"],
  ["Plans", "/commercial/plans", "plan.read"],
  ["Prices", "/commercial/prices", "price.read"],
  ["Entitlements", "/commercial/entitlements", "entitlement.read"],
  ["Compatibility", "/compatibility", "compatibility.read"],
] as const;

const aiNav = [
  ["Registry", "/ai/registry", "ai.registry.read"],
  ["Profiles", "/ai/profiles", "ai.profile.read"],
  ["Assignments", "/ai/assignments", "ai.assignment.read"],
] as const;

export function Shell({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  const { me, loading, notice, signOut } = useAdmin();
  const pathname = usePathname();
  const router = useRouter();
  if (loading)
    return (
      <main className="login">
        <div className="card">
          <p role="status">Checking admin session…</p>
        </div>
      </main>
    );
  if (!me) return <LoginPage />;
  return (
    <div className="admin-layout">
      <aside className="sidebar">
        <p className="brand">Control Plane Admin</p>
        <nav className="nav" aria-label="Admin sections">
          <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>
            Overview
          </Link>
          {nav
            .filter(([, , permission]) => has(me, permission))
            .map(([label, href]) => (
              <Link
                key={href}
                href={href}
                aria-current={pathname.startsWith(href) ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          {aiNav.some(([, , permission]) => has(me, permission)) && (
            <div className="nav-group">
              <span className="nav-group-title">AI adapters</span>
              {aiNav
                .filter(([, , permission]) => has(me, permission))
                .map(([label, href]) => (
                  <Link
                    key={href}
                    href={href}
                    aria-current={
                      pathname.startsWith(href) ? "page" : undefined
                    }
                  >
                    {label}
                  </Link>
                ))}
            </div>
          )}
        </nav>
      </aside>
      <main className="main">
        <div className="topbar">
          <h1>{title}</h1>
          <div className="actions">
            <span className="muted">{me.roles.join(", ")}</span>
            <button
              className="secondary"
              onClick={() => {
                void signOut()
                  .then(() => router.push("/login"))
                  .catch(() => undefined);
              }}
            >
              End admin session
            </button>
          </div>
        </div>
        <div className="content">
          <PageMessage notice={notice} />
          {children}
        </div>
      </main>
    </div>
  );
}

export function LoginPage() {
  const { me, loading, refresh, setNotice, otpRequired } = useAdmin();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setLocalNotice] = useState<Notice>(null);
  const [canContinue, setCanContinue] = useState(false);
  useEffect(() => {
    if (!loading && me) router.replace("/");
  }, [loading, me, router]);
  useEffect(() => {
    setCanContinue(
      !otpRequired &&
        document.cookie
          .split(";")
          .some((part) => part.trim().startsWith("pcp_csrf=")),
    );
  }, [otpRequired]);
  const fail = (error: unknown) => {
    const value = safeError(error);
    setLocalNotice({ kind: "error", text: value });
    setNotice({ kind: "error", text: value });
  };
  const currentSession = async () => {
    setBusy(true);
    try {
      await controlPlane("/v1/admin/session", { method: "POST" });
      if (await refresh()) router.replace("/");
    } catch (error) {
      if (
        error instanceof ControlPlaneError &&
        error.code === "ADMIN_REAUTH_REQUIRED"
      )
        setCanContinue(false);
      fail(error);
    } finally {
      setBusy(false);
    }
  };
  const requestOtp = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const value = await controlPlane<{ challengeId: string }>(
        "/v1/auth/otp/request",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        },
      );
      setChallengeId(value.challengeId);
      setLocalNotice({
        kind: "info",
        text: "Enter the one-time code sent to your email.",
      });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };
  const verifyOtp = async (event: FormEvent) => {
    event.preventDefault();
    if (!challengeId) return;
    setBusy(true);
    try {
      await controlPlane("/v1/auth/otp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId, code }),
      });
      await controlPlane("/v1/admin/session", { method: "POST" });
      if (await refresh()) router.replace("/");
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };
  if (loading || me)
    return (
      <main className="login">
        <div className="card">
          <p role="status">Loading…</p>
        </div>
      </main>
    );
  return (
    <main className="login">
      <section className="card" aria-labelledby="login-title">
        <p className="eyebrow">Privileged access</p>
        <h1 id="login-title">Admin sign-in</h1>
        <p className="muted">
          Elevation is separate from the portal session and expires
          automatically.
        </p>
        <PageMessage notice={notice} />
        {!challengeId ? (
          <form onSubmit={requestOtp}>
            <label>
              Email
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
              />
            </label>
            <div className="actions">
              <button type="submit" disabled={busy}>
                {busy ? "Sending…" : "Start OTP sign-in"}
              </button>
              {canContinue && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void currentSession()}
                >
                  Continue with current sign-in
                </button>
              )}
            </div>
          </form>
        ) : (
          <form onSubmit={verifyOtp}>
            <label>
              One-time code
              <input
                required
                inputMode="numeric"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="one-time-code"
              />
            </label>
            <div className="actions">
              <button type="submit" disabled={busy}>
                {busy ? "Verifying…" : "Verify and elevate"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setChallengeId(null);
                  setCode("");
                }}
              >
                Use another email
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}

export function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [busy, setBusy] = useState(Boolean(path));
  const [error, setError] = useState<unknown>(null);
  const { refresh, setNotice } = useAdmin();
  const load = async () => {
    if (!path) return;
    setBusy(true);
    setError(null);
    try {
      setData(await controlPlane<T>(path));
    } catch (value) {
      setError(value);
      if (
        value instanceof ControlPlaneError &&
        value.code === "ADMIN_FORBIDDEN"
      ) {
        await refresh();
        setNotice({
          kind: "error",
          text: "Your permission changed. Available controls were refreshed.",
        });
      }
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, [path]);
  return { data, busy, error, load };
}

export function Mutation({
  permission,
  action,
  path,
  body,
  confirm,
  onDone,
  onSuccess,
  disabled = false,
  children,
}: {
  permission: string;
  action: string;
  path: string;
  body: Record<string, unknown>;
  confirm?: string;
  onDone?: () => Promise<void> | void;
  onSuccess?: (value: unknown) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const { me, setNotice, refresh } = useAdmin();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [reason, setReason] = useState("");
  const [review, setReview] = useState(false);
  const submit = async () => {
    if (busyRef.current) return;
    if (!has(me, permission) || !reason.trim()) {
      setNotice({
        kind: "error",
        text: "A reason is required for this administrative change.",
      });
      return;
    }
    if (
      Object.prototype.hasOwnProperty.call(body, "expectedLatestRevision") &&
      body.expectedLatestRevision === undefined
    ) {
      setReview(false);
      setReason("");
      try {
        await onDone?.();
      } catch {
        /* keep the mutation fail-closed if the authority read fails */
      }
      setNotice({
        kind: "info",
        text: "The current authoritative revision was unavailable. No mutation was submitted; review again after the data reloads.",
      });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const value = await controlPlane(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, reason: reason.trim() }),
      });
      onSuccess?.(value);
      setReason("");
      setReview(false);
      setNotice({ kind: "success", text: `${action} completed.` });
      await onDone?.();
    } catch (error) {
      const stale =
        error instanceof ControlPlaneError &&
        (error.code === "ADMIN_STATE_STALE" || error.code === "ADMIN_CONFLICT");
      if (stale) {
        setReview(false);
        setReason("");
        try {
          await onDone?.();
        } catch {
          /* retain the safe stale state if the authoritative read also fails */
        }
        setNotice({
          kind: "info",
          text: "The previous operation was not automatically repeated. Current server state was refreshed; review a new operation before submitting.",
        });
        return;
      }
      if (
        error instanceof ControlPlaneError &&
        (error.code === "ADMIN_UNAUTHORIZED" ||
          error.code === "ADMIN_REAUTH_REQUIRED" ||
          error.code === "ADMIN_CSRF_INVALID" ||
          error.code === "ADMIN_FORBIDDEN")
      ) {
        await refresh();
      }
      setNotice({ kind: "error", text: safeError(error) });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  if (!has(me, permission)) return null;
  return (
    <div className="panel">
      <div className="actions">
        {children}
        <button
          type="button"
          disabled={busy || disabled}
          onClick={() => setReview(true)}
        >
          {busy ? "Working…" : action}
        </button>
      </div>
      <label>
        Operator reason
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={256}
          required
        />
      </label>
      {review && (
        <div className="confirm" role="dialog" aria-label={`Confirm ${action}`}>
          <p>
            <strong>Review before submitting</strong>
          </p>
          <p>{confirm ?? `Confirm ${action}.`}</p>
          <p>Reason: {reason || "(required)"}</p>
          <div className="actions">
            <button
              type="button"
              disabled={busy || !reason.trim()}
              onClick={() => void submit()}
            >
              Confirm {action}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setReview(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function LoadState({ busy, error }: { busy: boolean; error: unknown }) {
  if (busy) return <p role="status">Loading…</p>;
  if (error)
    return (
      <div className="notice error" role="alert">
        {safeError(error)}
      </div>
    );
  return null;
}
export function Cursor({
  cursor,
  onNext,
}: {
  cursor: string | null;
  onNext: () => void;
}) {
  return cursor ? (
    <div className="actions">
      <button className="secondary" onClick={onNext}>
        Next page
      </button>
    </div>
  ) : null;
}

function SearchPage({ kind }: { kind: "accounts" | "users" }) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [path, setPath] = useState<string | null>(null);
  const result = useData<Page<Account | User>>(path);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setPath(`/v1/admin/${kind}${query({ ...filters, limit: 50 })}`);
  };
  const items = result.data?.items ?? [];
  return (
    <Shell title={kind === "accounts" ? "Account lookup" : "User lookup"}>
      <section className="card">
        <form onSubmit={submit}>
          <div className="form-grid">
            {kind === "accounts" ? (
              <>
                <label>
                  Account ID
                  <input
                    value={filters.accountId ?? ""}
                    onChange={(e) => setFilters({ accountId: e.target.value })}
                  />
                </label>
                <label>
                  Owner user ID
                  <input
                    value={filters.ownerUserId ?? ""}
                    onChange={(e) =>
                      setFilters({ ownerUserId: e.target.value })
                    }
                  />
                </label>
                <label>
                  Owner email
                  <input
                    type="email"
                    value={filters.ownerEmail ?? ""}
                    onChange={(e) => setFilters({ ownerEmail: e.target.value })}
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  User ID
                  <input
                    value={filters.userId ?? ""}
                    onChange={(e) => setFilters({ userId: e.target.value })}
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={filters.email ?? ""}
                    onChange={(e) => setFilters({ email: e.target.value })}
                  />
                </label>
              </>
            )}
            <label>
              Status
              <select
                value={filters.status ?? ""}
                onChange={(e) =>
                  setFilters({ ...filters, status: e.target.value })
                }
              >
                <option value="">Any</option>
                <option>ACTIVE</option>
                <option>SUSPENDED</option>
              </select>
            </label>
          </div>
          <button type="submit">Search</button>
        </form>
      </section>
      <LoadState busy={result.busy} error={result.error} />
      {result.data && (
        <section className="card">
          <Table
            headers={
              kind === "accounts"
                ? ["ID", "Name", "Status", "Open"]
                : ["ID", "Email", "Status", "Created"]
            }
            rows={items.map((item) => {
              const value = item as Account & User;
              return kind === "accounts"
                ? [
                    <code key="id">{value.id}</code>,
                    value.displayName ?? "—",
                    <span className="status" key="s">
                      {value.status}
                    </span>,
                    <Link key="open" href={`/accounts/${value.id}`}>
                      Workspace
                    </Link>,
                  ]
                : [
                    <code key="id">{value.id}</code>,
                    value.emails?.map((email) => email.email).join(", ") ?? "—",
                    <span className="status" key="s">
                      {value.status}
                    </span>,
                    value.createdAt,
                  ];
            })}
          />
          <Cursor
            cursor={result.data.nextCursor}
            onNext={() =>
              setPath(withCursor(path ?? "", result.data?.nextCursor ?? ""))
            }
          />
        </section>
      )}
      <p className="muted">
        Search uses only exact accepted API filters. Values are not persisted in
        browser storage.
      </p>
    </Shell>
  );
}

function AccountWorkspace() {
  const { me } = useAdmin();
  const pathname = usePathname();
  const accountId = pathname.split("/").filter(Boolean).pop() ?? "";
  const subscription = useData<Subscription>(
    has(me, "subscription.read")
      ? `/v1/admin/accounts/${accountId}/subscription`
      : null,
  );
  const [devicePath, setDevicePath] = useState(
    `/v1/admin/accounts/${accountId}/devices?limit=50`,
  );
  const [paymentsPath, setPaymentsPath] = useState(
    `/v1/admin/accounts/${accountId}/billing/payments?limit=50`,
  );
  const [eventsPath, setEventsPath] = useState(
    `/v1/admin/accounts/${accountId}/billing/events?limit=50`,
  );
  const [overridesPath, setOverridesPath] = useState(
    `/v1/admin/accounts/${accountId}/entitlement-overrides?limit=50`,
  );
  const devices = useData<Page<Device>>(
    has(me, "device.read") ? devicePath : null,
  );
  const payments = useData<Page<Record<string, unknown>>>(
    has(me, "billing.read") ? paymentsPath : null,
  );
  const events = useData<Page<Record<string, unknown>>>(
    has(me, "billing.read") ? eventsPath : null,
  );
  const overrides = useData<Page<Record<string, unknown>>>(
    has(me, "entitlement.read") ? overridesPath : null,
  );
  const sub = subscription.data?.subscription;
  const subId = typeof sub?.id === "string" ? sub.id : "";
  const revision =
    typeof sub?.stateRevision === "number" ? sub.stateRevision : 0;
  const [planRevisionId, setPlanRevisionId] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [entitlementKey, setEntitlementKey] = useState("");
  const effective = useData<Record<string, unknown>>(
    has(me, "entitlement.read") && entitlementKey
      ? `/v1/admin/accounts/${accountId}/entitlements/${entitlementKey}`
      : null,
  );
  const latestOverrideRevision = useMemo(() => {
    const items = overrides.data?.items;
    if (!items?.length || !entitlementKey) return undefined;
    const revisions = items
      .filter((item) => String(item.entitlementKey) === entitlementKey)
      .map((item) => Number(item.revision))
      .filter((value) => Number.isSafeInteger(value) && value > 0);
    return revisions.length ? Math.max(...revisions) : undefined;
  }, [entitlementKey, overrides.data]);
  const reloadOverrides = async () => {
    await Promise.all([overrides.load(), effective.load()]);
  };
  const reloadAll = async () => {
    await Promise.all([
      subscription.load(),
      devices.load(),
      payments.load(),
      events.load(),
      overrides.load(),
    ]);
  };
  return (
    <Shell title={`Account workspace`}>
      <p className="muted">
        <code>{accountId}</code> · all state below is read from current server
        authority.
      </p>
      {has(me, "subscription.read") && (
        <section className="card">
          <h2>Subscription</h2>
          {subscription.data?.accessBasis === "BETA" && (
            <p role="status">
              BETA access is active; commercial subscription is not required.
            </p>
          )}
          <LoadState busy={subscription.busy} error={subscription.error} />
          <div className="form-grid">
            <label>
              Published plan revision ID
              <input
                value={planRevisionId}
                onChange={(e) => setPlanRevisionId(e.target.value)}
              />
            </label>
            <label>
              New period end
              <input
                type="datetime-local"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </label>
          </div>
          <Mutation
            permission="subscription.grant"
            action="Grant subscription"
            path={`/v1/admin/accounts/${accountId}/subscription/grant`}
            body={{
              planRevisionId,
              currentPeriodEnd: periodEnd
                ? new Date(periodEnd).toISOString()
                : "",
            }}
            onDone={subscription.load}
          />
          {sub ? (
            <>
              <Table
                headers={[
                  "ID",
                  "State",
                  "Revision",
                  "Plan",
                  "Period",
                  "Access",
                ]}
                rows={[
                  [
                    String(sub.id),
                    String(sub.state),
                    String(sub.stateRevision),
                    String(sub.planRevisionId ?? sub.plan ?? "—"),
                    `${String(sub.currentPeriodStart)} → ${String(sub.currentPeriodEnd)}`,
                    subscription.data?.access.status ?? "—",
                  ],
                ]}
              />
              <Mutation
                permission="subscription.extend"
                action="Extend subscription"
                path={`/v1/admin/accounts/${accountId}/subscription/${subId}/extend`}
                body={{
                  expectedStateRevision: revision,
                  newCurrentPeriodEnd: periodEnd
                    ? new Date(periodEnd).toISOString()
                    : "",
                }}
                onDone={subscription.load}
              />
              <div className="actions">
                <Mutation
                  permission="subscription.suspend"
                  action="Suspend subscription"
                  path={`/v1/admin/accounts/${accountId}/subscription/${subId}/suspend`}
                  body={{ expectedStateRevision: revision }}
                  confirm="Suspend the current subscription?"
                  onDone={subscription.load}
                />
                <Mutation
                  permission="subscription.restore"
                  action="Restore subscription"
                  path={`/v1/admin/accounts/${accountId}/subscription/${subId}/restore`}
                  body={{ expectedStateRevision: revision }}
                  onDone={subscription.load}
                />
              </div>
            </>
          ) : (
            <p>No current subscription.</p>
          )}
        </section>
      )}
      {has(me, "device.read") && (
        <section className="card">
          <h2>Devices</h2>
          <LoadState busy={devices.busy} error={devices.error} />
          {devices.data && (
            <>
              <Table
                headers={[
                  "ID",
                  "Label",
                  "Browser",
                  "Status",
                  "Last seen",
                  "Action",
                ]}
                rows={devices.data.items.map((device) => [
                  <code key="id">{device.id}</code>,
                  device.label ?? "—",
                  `${device.browserFamily} ${device.browserVersionLastSeen ?? ""}`,
                  device.status,
                  device.lastSeenAt ?? "—",
                  <Mutation
                    key="action"
                    permission="device.revoke"
                    action="Revoke"
                    path={`/v1/admin/accounts/${accountId}/devices/${device.id}/revoke`}
                    body={{}}
                    confirm={`Revoke device ${device.id}?`}
                    onDone={devices.load}
                  >
                    <span />
                  </Mutation>,
                ])}
              />
              <Cursor
                cursor={devices.data.nextCursor}
                onNext={() =>
                  setDevicePath(
                    withCursor(devicePath, devices.data?.nextCursor ?? ""),
                  )
                }
              />
            </>
          )}
        </section>
      )}
      {has(me, "billing.read") && (
        <section className="card">
          <h2>Billing safe reads</h2>
          <p className="muted">
            Provider identities, raw payloads, hashes, event identity, and lease
            tokens are intentionally excluded.
          </p>
          <h3>Payments</h3>
          <LoadState busy={payments.busy} error={payments.error} />
          {payments.data && (
            <Table
              headers={["ID", "State", "Amount", "Currency", "Created"]}
              rows={payments.data.items.map((item) => [
                String(item.id),
                String(item.state),
                String(item.amountMinor),
                String(item.currency),
                String(item.createdAt),
              ])}
            />
          )}
          {payments.data && (
            <Cursor
              cursor={payments.data.nextCursor}
              onNext={() =>
                setPaymentsPath(
                  withCursor(paymentsPath, payments.data?.nextCursor ?? ""),
                )
              }
            />
          )}
          <h3>Billing events</h3>
          <LoadState busy={events.busy} error={events.error} />
          {events.data && (
            <Table
              headers={["ID", "Type", "Processing", "Received"]}
              rows={events.data.items.map((item) => [
                String(item.id),
                String(item.eventType),
                String(item.processingState),
                String(item.receivedAt),
              ])}
            />
          )}
          {events.data && (
            <Cursor
              cursor={events.data.nextCursor}
              onNext={() =>
                setEventsPath(
                  withCursor(eventsPath, events.data?.nextCursor ?? ""),
                )
              }
            />
          )}
        </section>
      )}
      {has(me, "entitlement.read") && (
        <section className="card">
          <h2>Entitlements</h2>
          <LoadState busy={overrides.busy} error={overrides.error} />
          <label>
            Entitlement key
            <input
              value={entitlementKey}
              onChange={(e) => {
                const value = e.target.value;
                setEntitlementKey(value);
                setOverridesPath(
                  `/v1/admin/accounts/${accountId}/entitlement-overrides?limit=50${value ? `&entitlementKey=${encodeURIComponent(value)}` : ""}`,
                );
              }}
            />
          </label>
          {overrides.data && (
            <Table
              headers={["Key", "State", "Revision"]}
              rows={overrides.data.items.map((item) => [
                String(item.entitlementKey),
                String(item.state ?? item.operation ?? "—"),
                String(item.revision ?? item.latestRevision ?? "—"),
              ])}
            />
          )}
          {overrides.data && (
            <Cursor
              cursor={overrides.data.nextCursor}
              onNext={() =>
                setOverridesPath(
                  withCursor(overridesPath, overrides.data?.nextCursor ?? ""),
                )
              }
            />
          )}
          {entitlementKey && (
            <>
              <LoadState busy={effective.busy} error={effective.error} />
              {effective.data && (
                <p role="status">
                  Effective server result: {JSON.stringify(effective.data)}
                </p>
              )}
            </>
          )}
          <div className="actions">
            <Mutation
              permission="entitlement.override"
              action="Set override"
              path={`/v1/admin/accounts/${accountId}/entitlement-overrides/${entitlementKey}/set`}
              body={{
                expectedLatestRevision: latestOverrideRevision,
                value: { kind: "BOOLEAN", value: true },
                effectiveFrom: new Date().toISOString(),
                expiresAt: null,
              }}
              onDone={reloadOverrides}
            >
              <span />
            </Mutation>
            <Mutation
              permission="entitlement.override"
              action="Clear override"
              path={`/v1/admin/accounts/${accountId}/entitlement-overrides/${entitlementKey}/clear`}
              body={{
                expectedLatestRevision: latestOverrideRevision,
                effectiveFrom: new Date().toISOString(),
                expiresAt: null,
              }}
              confirm={`Clear override ${entitlementKey}?`}
              onDone={reloadOverrides}
            >
              <span />
            </Mutation>
          </div>
          {entitlementKey && latestOverrideRevision === undefined && (
            <p className="notice" role="status">
              The current override revision is not loaded. Reload the workspace
              before reviewing this operation; no mutation will be submitted.
            </p>
          )}
          <p className="muted">
            Effective entitlement values are displayed exactly as returned by
            the server; precedence is never calculated in the browser.
          </p>
        </section>
      )}
      <button className="secondary" onClick={() => void reloadAll()}>
        Reload workspace
      </button>
    </Shell>
  );
}

function Principals() {
  const { me } = useAdmin();
  const [path, setPath] = useState("/v1/admin/principals?limit=50");
  const result = useData<Page<Record<string, unknown>>>(
    has(me, "admin.principal.read") ? path : null,
  );
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("ADMIN_SUPPORT");
  return (
    <Shell title="Admin principals">
      <section className="card">
        <p className="muted">
          Role choices are the accepted server roles. Last-owner protection
          remains server-authoritative.
        </p>
        {has(me, "admin.principal.manage") && (
          <Mutation
            permission="admin.principal.manage"
            action="Create principal"
            path="/v1/admin/principals"
            body={{ userId, initialRole: role }}
            onDone={result.load}
          >
            <div className="form-grid">
              <label>
                User ID
                <input
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                />
              </label>
              <label>
                Initial role
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  {[
                    "ADMIN_OWNER",
                    "ADMIN_OPS",
                    "ADMIN_SUPPORT",
                    "ADMIN_BILLING_READONLY",
                  ].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            </div>
          </Mutation>
        )}
      </section>
      <section className="card">
        <LoadState busy={result.busy} error={result.error} />
        {result.data && (
          <>
            <Table
              headers={[
                "Principal",
                "User",
                "Status",
                "Revision",
                "Roles",
                "Actions",
              ]}
              rows={result.data.items.map((item) => {
                const principal = item as Record<string, unknown>;
                const id = String(principal.principalId);
                const revision = Number(principal.revision);
                const selectedRole =
                  Array.isArray(principal.roles) && principal.roles.length
                    ? String(principal.roles[0])
                    : "ADMIN_SUPPORT";
                return [
                  id,
                  String(principal.userId),
                  String(principal.status),
                  String(revision),
                  Array.isArray(principal.roles)
                    ? principal.roles.join(", ")
                    : "—",
                  <div className="actions" key="a">
                    <Mutation
                      permission="admin.principal.manage"
                      action={`Grant ${selectedRole}`}
                      path={`/v1/admin/principals/${id}/roles/${selectedRole}/grant`}
                      body={{ expectedRevision: revision }}
                      onDone={result.load}
                    >
                      <span />
                    </Mutation>
                    <Mutation
                      permission="admin.principal.manage"
                      action={`Revoke ${selectedRole}`}
                      path={`/v1/admin/principals/${id}/roles/${selectedRole}/revoke`}
                      body={{ expectedRevision: revision }}
                      confirm={`Revoke ${selectedRole} from ${id}? Last-owner protection remains server-authoritative.`}
                      onDone={result.load}
                    >
                      <span />
                    </Mutation>
                    <Mutation
                      permission="admin.principal.manage"
                      action="Suspend"
                      path={`/v1/admin/principals/${id}/suspend`}
                      body={{ expectedRevision: revision }}
                      onDone={result.load}
                    >
                      <span />
                    </Mutation>
                    <Mutation
                      permission="admin.principal.manage"
                      action="Restore"
                      path={`/v1/admin/principals/${id}/restore`}
                      body={{ expectedRevision: revision }}
                      onDone={result.load}
                    >
                      <span />
                    </Mutation>
                  </div>,
                ];
              })}
            />
            <Cursor
              cursor={result.data.nextCursor}
              onNext={() =>
                setPath(withCursor(path, result.data?.nextCursor ?? ""))
              }
            />
          </>
        )}
      </section>
    </Shell>
  );
}

function Audit() {
  const [path, setPath] = useState("/v1/admin/audit-events?limit=50");
  const result = useData<Page<Record<string, unknown>>>(path);
  return (
    <Shell title="Audit log">
      <section className="card">
        <LoadState busy={result.busy} error={result.error} />
        {result.data && (
          <>
            <Table
              headers={["Time", "Action", "Actor", "Target", "Correlation"]}
              rows={result.data.items.map((item) => [
                String(item.createdAt),
                String(item.action),
                `${String(item.actorType)} ${String(item.actorId ?? "")}`,
                `${String(item.targetType)} ${String(item.targetId ?? "")}`,
                String(item.correlationId),
              ])}
            />
            <Cursor
              cursor={result.data.nextCursor}
              onNext={() =>
                setPath(withCursor(path, result.data?.nextCursor ?? ""))
              }
            />
          </>
        )}
      </section>
      <p className="muted">
        The accepted audit projection intentionally does not expose freeform
        reason or safeMetadata.
      </p>
    </Shell>
  );
}

function CatalogList({ type }: { type: "plans" | "prices" | "entitlements" }) {
  const { me } = useAdmin();
  const base =
    type === "plans"
      ? "/v1/admin/commercial/plans"
      : type === "prices"
        ? "/v1/admin/commercial/prices"
        : "/v1/admin/commercial/entitlements/definitions";
  const [path, setPath] = useState(base + "?limit=50");
  const result = useData<Page<Record<string, unknown>>>(
    has(
      me,
      type === "plans"
        ? "plan.read"
        : type === "prices"
          ? "price.read"
          : "entitlement.read",
    )
      ? path
      : null,
  );
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [pricePlanId, setPricePlanId] = useState("");
  const [marketKey, setMarketKey] = useState("");
  const [channelKey, setChannelKey] = useState("");
  const permission =
    type === "entitlements"
      ? "plan.manage"
      : `${type === "plans" ? "plan" : "price"}.manage`;
  const title =
    type === "entitlements"
      ? "Entitlement definitions"
      : type === "plans"
        ? "Plans"
        : "Prices";
  return (
    <Shell title={title}>
      <section className="card">
        {type === "entitlements" && (
          <p className="notice">
            Server entitlement does not add client capability by itself.
          </p>
        )}
        {has(me, permission) && (
          <Mutation
            permission={permission}
            action={`Create ${type === "entitlements" ? "entitlement" : type.slice(0, -1)}`}
            path={base}
            body={
              type === "plans"
                ? { code }
                : type === "prices"
                  ? buildPriceCreateBody({
                      planId: pricePlanId,
                      code,
                      marketKey,
                      channelKey,
                    })
                  : {
                      entitlementKey: code,
                      valueType: "BOOLEAN",
                      securityClassification: "CAPABILITY",
                      description,
                    }
            }
            onDone={result.load}
          >
            <div className="form-grid">
              <label>
                {type === "entitlements" ? "Entitlement key" : "Code"}
                <input value={code} onChange={(e) => setCode(e.target.value)} />
              </label>
              {type === "entitlements" && (
                <label>
                  Description
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
              )}
              {type === "prices" && (
                <>
                  <label>
                    Plan ID
                    <input
                      value={pricePlanId}
                      onChange={(e) => setPricePlanId(e.target.value)}
                    />
                  </label>
                  <label>
                    Market key
                    <input
                      value={marketKey}
                      onChange={(e) => setMarketKey(e.target.value)}
                    />
                  </label>
                  <label>
                    Channel key
                    <input
                      value={channelKey}
                      onChange={(e) => setChannelKey(e.target.value)}
                    />
                  </label>
                </>
              )}
            </div>
          </Mutation>
        )}
      </section>
      <section className="card">
        <LoadState busy={result.busy} error={result.error} />
        {result.data && (
          <>
            <Table
              headers={
                type === "entitlements"
                  ? ["Key", "Type", "Classification", "Status", "Actions"]
                  : ["ID", "Code", "Status", "Updated"]
              }
              rows={result.data.items.map((item) => {
                if (type !== "entitlements")
                  return [
                    String(item.id ?? item.entitlementKey),
                    String(item.code ?? item.description ?? "—"),
                    String(item.status ?? item.valueType ?? "—"),
                    String(
                      item.updatedAt ?? item.securityClassification ?? "—",
                    ),
                  ];
                const key = String(item.entitlementKey);
                const expected = String(item.description ?? "");
                return [
                  key,
                  String(item.valueType),
                  String(item.securityClassification),
                  String(item.deprecatedAt ? "DEPRECATED" : "ACTIVE"),
                  <div className="actions" key="actions">
                    <Mutation
                      permission="plan.manage"
                      action="Update description"
                      path={`/v1/admin/commercial/entitlements/definitions/${key}/description`}
                      body={{
                        expectedDescription: expected,
                        newDescription: newDescription || expected,
                      }}
                      onDone={result.load}
                    >
                      <span />
                    </Mutation>
                    <Mutation
                      permission="plan.manage"
                      action="Deprecate"
                      path={`/v1/admin/commercial/entitlements/definitions/${key}/deprecate`}
                      body={{}}
                      confirm={`Deprecate entitlement definition ${key}? This does not add client capability.`}
                      onDone={result.load}
                    >
                      <span />
                    </Mutation>
                  </div>,
                ];
              })}
            />
            {type === "entitlements" && has(me, "plan.manage") && (
              <label>
                New entitlement description
                <input
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                />
              </label>
            )}
            <Cursor
              cursor={result.data.nextCursor}
              onNext={() =>
                setPath(withCursor(path, result.data?.nextCursor ?? ""))
              }
            />
          </>
        )}
      </section>
    </Shell>
  );
}

function CommercialDetail({ type }: { type: "plan" | "price" }) {
  const pathname = usePathname();
  const id = pathname.split("/").filter(Boolean).pop() ?? "";
  const { me, setNotice, refresh } = useAdmin();
  const base =
    type === "plan"
      ? `/v1/admin/commercial/plans/${id}`
      : `/v1/admin/commercial/prices/${id}`;
  const result = useData<Record<string, unknown>>(
    has(me, type === "plan" ? "plan.read" : "price.read") ? base : null,
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [entitlementKey, setEntitlementKey] = useState("");
  const [draft, setDraft] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [planRevisionId, setPlanRevisionId] = useState("");
  const [amountMinor, setAmountMinor] = useState("0");
  const [currency, setCurrency] = useState("USD");
  const [intervalUnit, setIntervalUnit] = useState("MONTH");
  const [intervalCount, setIntervalCount] = useState("1");
  const [selectedPriceRevisionId, setSelectedPriceRevisionId] = useState("");
  const revision = useMemo(() => {
    const revisions = result.data?.revisions;
    return Array.isArray(revisions) && revisions.length
      ? (revisions[revisions.length - 1] as Record<string, unknown>)
      : null;
  }, [result.data]);
  const revisionId = String(revision?.id ?? revision?.revisionId ?? "");
  const currentFingerprint = String(
    revision?.contentFingerprint ?? revision?.contentFingerprintSha256 ?? "",
  );
  const latestAssignmentRevision =
    Array.isArray(result.data?.saleAssignments) &&
    result.data.saleAssignments.length
      ? Number(
          (
            result.data.saleAssignments[
              result.data.saleAssignments.length - 1
            ] as Record<string, unknown>
          ).revision ?? 0,
        )
      : null;
  const mutate = async (
    path: string,
    body: Record<string, unknown>,
    label: string,
    highImpact = false,
  ) => {
    if (busy || busyRef.current) return;
    if (!reason.trim()) {
      setNotice({
        kind: "error",
        text: "A reason is required for this administrative change.",
      });
      return;
    }
    if (
      highImpact &&
      !window.confirm(`${label}\nTarget: ${id}\nReason: ${reason}`)
    )
      return;
    busyRef.current = true;
    setBusy(true);
    try {
      await controlPlane(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, reason: reason.trim() }),
      });
      setReason("");
      setNotice({ kind: "success", text: `${label} completed.` });
      await result.load();
    } catch (error) {
      if (
        error instanceof ControlPlaneError &&
        (error.code === "ADMIN_STATE_STALE" || error.code === "ADMIN_CONFLICT")
      ) {
        await result.load();
        setNotice({
          kind: "info",
          text: "The previous operation was not automatically repeated. Current server state was refreshed; review a new operation before submitting.",
        });
      } else {
        if (
          error instanceof ControlPlaneError &&
          error.code === "ADMIN_FORBIDDEN"
        )
          await refresh();
        setNotice({ kind: "error", text: safeError(error) });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <Shell title={`${type === "plan" ? "Plan" : "Price"} detail`}>
      <section className="card">
        <LoadState busy={result.busy} error={result.error} />
        {result.data && <pre>{JSON.stringify(result.data, null, 2)}</pre>}
        <label>
          Operator reason
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {type === "plan" && (
          <div className="form-grid">
            <label>
              Draft revision ID
              <input value={revisionId} readOnly />
            </label>
            <label>
              Content fingerprint
              <input value={currentFingerprint} readOnly />
            </label>
            <label>
              Entitlement key
              <input
                value={entitlementKey}
                onChange={(e) => setEntitlementKey(e.target.value)}
              />
            </label>
            <label>
              Typed value
              <input value={draft} onChange={(e) => setDraft(e.target.value)} />
            </label>
            <label>
              Draft display name
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>
            <label>
              Draft description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
          </div>
        )}
        {type === "price" && (
          <div className="form-grid">
            <label>
              Plan revision ID
              <input
                value={planRevisionId}
                onChange={(e) => setPlanRevisionId(e.target.value)}
              />
            </label>
            <label>
              Amount minor
              <input
                type="number"
                min="0"
                value={amountMinor}
                onChange={(e) => setAmountMinor(e.target.value)}
              />
            </label>
            <label>
              Currency
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </label>
            <label>
              Billing interval
              <select
                value={intervalUnit}
                onChange={(e) => setIntervalUnit(e.target.value)}
              >
                <option>DAY</option>
                <option>MONTH</option>
                <option>YEAR</option>
              </select>
            </label>
            <label>
              Interval count
              <input
                type="number"
                min="1"
                value={intervalCount}
                onChange={(e) => setIntervalCount(e.target.value)}
              />
            </label>
            <label>
              Selected sale price revision (blank closes sale)
              <input
                value={selectedPriceRevisionId}
                onChange={(e) => setSelectedPriceRevisionId(e.target.value)}
              />
            </label>
          </div>
        )}
        {has(me, type === "plan" ? "plan.manage" : "price.manage") && (
          <div className="actions">
            {type === "plan" ? (
              <>
                <Mutation
                  permission="plan.manage"
                  action="Create draft revision"
                  path={`${base}/revisions`}
                  body={{ displayName, description }}
                  onDone={result.load}
                >
                  <span />
                </Mutation>
                <Mutation
                  permission="plan.manage"
                  action="Update draft revision"
                  path={`${base}/revisions/${revisionId}/update`}
                  body={{
                    expectedContentFingerprint: currentFingerprint,
                    displayName,
                    description,
                  }}
                  onDone={result.load}
                >
                  <span />
                </Mutation>
                <button
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      `${base}/revisions/${revisionId}/publish`,
                      { expectedContentFingerprint: currentFingerprint },
                      "Publish plan revision",
                      true,
                    )
                  }
                >
                  Publish revision
                </button>
                <Mutation
                  permission="plan.manage"
                  action="Set draft entitlement"
                  path={`${base}/revisions/${revisionId}/entitlements/${entitlementKey}/set`}
                  body={{
                    expectedContentFingerprint: currentFingerprint,
                    value: { kind: "BOOLEAN", value: draft === "true" },
                  }}
                  onDone={result.load}
                >
                  <span />
                </Mutation>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      `${base}/revisions/${revisionId}/entitlements/${entitlementKey}/remove`,
                      { expectedContentFingerprint: currentFingerprint },
                      "Remove draft entitlement",
                      true,
                    )
                  }
                >
                  Remove entitlement
                </button>
                <Mutation
                  permission="plan.manage"
                  action="Change plan status"
                  path={`${base}/status`}
                  body={{
                    expectedStatus: String(result.data?.status ?? "DRAFT"),
                    targetStatus: "HIDDEN",
                  }}
                  onDone={result.load}
                >
                  <span />
                </Mutation>
                <Mutation
                  permission="plan.manage"
                  action="Archive plan"
                  path={`${base}/status`}
                  body={{
                    expectedStatus: String(result.data?.status ?? "DRAFT"),
                    targetStatus: "ARCHIVED",
                  }}
                  confirm={`Archive plan ${id}? This is a high-impact commercial change.`}
                  onDone={result.load}
                >
                  <span />
                </Mutation>
              </>
            ) : (
              <>
                <Mutation
                  permission="price.manage"
                  action="Create draft revision"
                  path={`${base}/revisions`}
                  body={{
                    planRevisionId,
                    amountMinor: Number(amountMinor),
                    currency,
                    billingIntervalUnit: intervalUnit,
                    billingIntervalCount: Number(intervalCount),
                    effectiveFrom: new Date().toISOString(),
                    effectiveTo: null,
                  }}
                  onDone={result.load}
                >
                  <span />
                </Mutation>
                <Mutation
                  permission="price.manage"
                  action="Update draft revision"
                  path={`${base}/revisions/${revisionId}/update`}
                  body={{
                    expectedContentFingerprint: currentFingerprint,
                    amountMinor: Number(amountMinor),
                    currency,
                    billingIntervalUnit: intervalUnit,
                    billingIntervalCount: Number(intervalCount),
                  }}
                  onDone={result.load}
                >
                  <span />
                </Mutation>
                <button
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      `${base}/revisions/${revisionId}/publish`,
                      { expectedContentFingerprint: currentFingerprint },
                      "Publish price revision",
                      true,
                    )
                  }
                >
                  Publish revision
                </button>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      `${base}/status`,
                      {
                        expectedStatus: String(result.data?.status ?? "DRAFT"),
                        targetStatus: "ARCHIVED",
                      },
                      "Archive price",
                      true,
                    )
                  }
                >
                  Archive price
                </button>
                <Mutation
                  permission="price.manage"
                  action="Change price status"
                  path={`${base}/status`}
                  body={{
                    expectedStatus: String(result.data?.status ?? "DRAFT"),
                    targetStatus: "HIDDEN",
                  }}
                  onDone={result.load}
                >
                  <span />
                </Mutation>
                <Mutation
                  permission="price.manage"
                  action="Assign sale price"
                  path={`${base}/sale-assignments`}
                  body={{
                    expectedLatestAssignmentRevision: latestAssignmentRevision,
                    selectedPriceRevisionId: selectedPriceRevisionId || null,
                    effectiveFrom: new Date().toISOString(),
                  }}
                  confirm={
                    selectedPriceRevisionId
                      ? `Assign sale price revision ${selectedPriceRevisionId}?`
                      : "Close the sale assignment? This removes the selected price revision."
                  }
                  onDone={result.load}
                >
                  <span />
                </Mutation>
              </>
            )}
          </div>
        )}
      </section>
    </Shell>
  );
}

function Compatibility() {
  const { me, setNotice } = useAdmin();
  const result = useData<Page<Record<string, unknown>>>(
    has(me, "compatibility.read")
      ? "/v1/admin/compatibility/policies?limit=50"
      : null,
  );
  const [policyKey, setPolicyKey] = useState("global");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const publish = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || busyRef.current) return;
    if (!reason.trim()) {
      setNotice({
        kind: "error",
        text: "A reason is required for this administrative change.",
      });
      return;
    }
    if (
      !window.confirm(
        `Publish compatibility revision for ${policyKey}? Publishing this revision does not activate it.`,
      )
    )
      return;
    busyRef.current = true;
    setBusy(true);
    try {
      const value = await controlPlane<Record<string, unknown>>(
        `/v1/admin/compatibility/policies/${policyKey}/publish`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(buildCompatibilityPublishBody(reason.trim())),
        },
      );
      setReason("");
      setNotice({
        kind: "success",
        text: `Published. activationStatus=${String(value.activationStatus ?? "REVISION_PUBLISHED_NOT_AUTO_ACTIVATED")}; linkedConfigVersions=${JSON.stringify(value.linkedConfigVersions ?? [])}. Publishing this revision does not activate it.`,
      });
      await result.load();
    } catch (error) {
      if (
        error instanceof ControlPlaneError &&
        (error.code === "ADMIN_STATE_STALE" || error.code === "ADMIN_CONFLICT")
      ) {
        await result.load();
        setNotice({
          kind: "info",
          text: "The previous operation was not automatically repeated. Current server state was refreshed; review a new operation before submitting.",
        });
      } else {
        setNotice({ kind: "error", text: safeError(error) });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <Shell title="Compatibility policies">
      <section className="card">
        <p className="notice">Publishing this revision does not activate it.</p>
        <LoadState busy={result.busy} error={result.error} />
        {result.data && (
          <Table
            headers={["Policy", "Revision", "Published", "Activation"]}
            rows={result.data.items.map((item) => [
              String(item.policyKey),
              String(item.revision),
              String(item.publishedAt),
              "REVISION_PUBLISHED_NOT_AUTO_ACTIVATED",
            ])}
          />
        )}
        <form onSubmit={publish}>
          <div className="form-grid">
            <label>
              Policy key
              <input
                value={policyKey}
                onChange={(e) => setPolicyKey(e.target.value)}
              />
            </label>
          </div>
          <label>
            Operator reason
            <textarea
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={busy || !has(me, "compatibility.manage")}
          >
            {busy ? "Publishing…" : "Publish revision"}
          </button>
        </form>
      </section>
    </Shell>
  );
}

function Dashboard() {
  const { me } = useAdmin();
  return (
    <Shell title="Session overview">
      <div className="grid">
        <section className="card">
          <p className="eyebrow">Admin session</p>
          <h2>Active</h2>
          <p>
            Principal <code>{me?.principalId}</code>
          </p>
          <p>Expires {me?.expiresAt}</p>
        </section>
        <section className="card">
          <p className="eyebrow">Granted roles</p>
          <p>{me?.roles.join(", ")}</p>
          <p className="muted">
            Sections below are derived from server-returned permissions.
          </p>
        </section>
      </div>
      <div className="grid">
        {nav
          .filter(([, , permission]) => has(me, permission))
          .map(([label, href, permission]) => (
            <Link className="card" key={href} href={href}>
              <strong>{label}</strong>
              <p className="muted">Requires {permission}</p>
            </Link>
          ))}
      </div>
    </Shell>
  );
}

function BetaAdmissionPage() {
  const { me, setNotice } = useAdmin();
  const state = useData<BetaState>(
    has(me, "beta.admission.read") ? "/v1/admin/beta/admission" : null,
  );
  const [action, setAction] = useState<
    "OPEN" | "PAUSE" | "CLOSE" | "ADD_CAPACITY" | "SET_CAPACITY"
  >("OPEN");
  const [amount, setAmount] = useState("100");
  const [reason, setReason] = useState("");
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string | undefined>(undefined);
  const current = state.data;
  if (!has(me, "beta.admission.read")) return null;
  const capacity = current?.capacity ?? 0;
  const parsedAmount = Number(amount);
  const nextCapacity =
    action === "ADD_CAPACITY"
      ? capacity + parsedAmount
      : action === "SET_CAPACITY"
        ? parsedAmount
        : capacity;
  const change =
    action === "ADD_CAPACITY"
      ? `capacity ${capacity} → ${nextCapacity} (+${parsedAmount})`
      : action === "SET_CAPACITY"
        ? `capacity ${capacity} → ${nextCapacity}`
        : `mode ${current?.mode ?? "—"} → ${action}`;
  const submit = async () => {
    if (
      !current ||
      !reason.trim() ||
      (action === "ADD_CAPACITY" &&
        (!Number.isSafeInteger(parsedAmount) || parsedAmount < 1)) ||
      (action === "SET_CAPACITY" &&
        (!Number.isSafeInteger(parsedAmount) || parsedAmount < 0))
    )
      return;
    setBusy(true);
    requestId.current ??= crypto.randomUUID();
    try {
      await controlPlane("/v1/admin/beta/admission", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: requestId.current,
          expectedRevision: current.revision,
          action,
          ...(action === "ADD_CAPACITY" ? { amount: parsedAmount } : {}),
          ...(action === "SET_CAPACITY" ? { capacity: parsedAmount } : {}),
          reason: reason.trim(),
        }),
      });
      requestId.current = undefined;
      setReview(false);
      setReason("");
      setNotice({ kind: "success", text: "Beta admission updated." });
      await state.load();
    } catch (error) {
      if (
        error instanceof ControlPlaneError &&
        error.code === "ADMIN_STATE_STALE"
      ) {
        requestId.current = undefined;
        setReview(false);
        await state.load();
        setNotice({
          kind: "info",
          text: "The beta state changed. Review the refreshed state before submitting again.",
        });
      } else setNotice({ kind: "error", text: safeError(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Beta admission">
      <LoadState busy={state.busy} error={state.error} />
      {current && (
        <>
          <section className="card">
            <h2>Current state</h2>
            <Table
              headers={[
                "Mode",
                "Capacity",
                "Admitted",
                "Remaining",
                "Revision",
              ]}
              rows={[
                [
                  current.mode,
                  current.capacity,
                  current.admitted,
                  current.remaining,
                  current.revision,
                ],
              ]}
            />
          </section>
          {has(me, "beta.admission.manage") && (
            <section className="panel">
              <div className="form-grid">
                <label>
                  Action
                  <select
                    value={action}
                    onChange={(e) => setAction(e.target.value as typeof action)}
                  >
                    <option>OPEN</option>
                    <option>PAUSE</option>
                    <option>CLOSE</option>
                    <option>ADD_CAPACITY</option>
                    <option>SET_CAPACITY</option>
                  </select>
                </label>
                {(action === "ADD_CAPACITY" || action === "SET_CAPACITY") && (
                  <label>
                    {action === "ADD_CAPACITY" ? "Positive amount" : "Capacity"}
                    <input
                      type="number"
                      min={action === "ADD_CAPACITY" ? 1 : 0}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>
                )}
              </div>
              <label>
                Reason
                <textarea
                  value={reason}
                  maxLength={256}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </label>
              <button
                type="button"
                disabled={!reason.trim() || busy}
                onClick={() => setReview(true)}
              >
                Review change
              </button>
              {review && (
                <div
                  className="confirm"
                  role="dialog"
                  aria-label="Confirm beta admission change"
                >
                  <p>
                    <strong>Exact change</strong>
                  </p>
                  <p>{change}</p>
                  <p>Reason: {reason || "(required)"}</p>
                  <div className="actions">
                    <button
                      type="button"
                      disabled={busy || !reason.trim()}
                      onClick={() => void submit()}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setReview(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </Shell>
  );
}

export function AdminScreen({ section }: { section: Section }) {
  switch (section) {
    case "dashboard":
      return <Dashboard />;
    case "accounts":
      return <SearchPage kind="accounts" />;
    case "users":
      return <SearchPage kind="users" />;
    case "account":
      return <AccountWorkspace />;
    case "principals":
      return <Principals />;
    case "audit":
      return <Audit />;
    case "plans":
      return <CatalogList type="plans" />;
    case "plan":
      return <CommercialDetail type="plan" />;
    case "prices":
      return <CatalogList type="prices" />;
    case "price":
      return <CommercialDetail type="price" />;
    case "entitlements":
      return <CatalogList type="entitlements" />;
    case "compatibility":
      return <Compatibility />;
    case "beta":
      return <BetaAdmissionPage />;
    default:
      return <Dashboard />;
  }
}

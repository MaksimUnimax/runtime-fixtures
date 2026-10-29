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
import {
  ADMIN_PRINCIPAL_ROLES,
  AdminPrincipalRole,
  isAdminPrincipalRole,
} from "../lib/admin-principal-roles";
import {
  loadOverrideAuthority,
  overrideValue,
  type OverrideAuthority,
} from "../lib/b14-override-authority";

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
  | "beta"
  | "support";
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
  browserFamily?: string;
  browserVersionLastSeen?: string | null;
  extensionVersionLastSeen?: string;
  createdAt: string;
  activatedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
};
type Subscription = {
  accountId: string;
  accessBasis?: "BETA" | "COMMERCIAL" | "NONE";
  access: { status: string; reason: string | null };
  subscription: {
    id: string;
    state: string;
    stateRevision: number;
    plan: {
      planRevisionId: string;
      planCode: string;
      planRevision: number;
      displayName: string;
    };
    currentPeriodStart: string;
    currentPeriodEnd: string;
  } | null;
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
type BetaInvitation = {
  invitationId: string;
  status: "PENDING" | "CONSUMED" | "REVOKED" | "EXPIRED";
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
};
type BetaInvitationMutation = BetaInvitation & { replay: boolean };
type ReviewedRequest = { fingerprint: string; requestId: string };

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
    if (error.code === "ADMIN_LAST_OWNER_REQUIRED")
      return "Keep at least one active owner with an active user account. No change was made.";
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
  const authorityGeneration = useRef(0);
  const active = useRef(false);
  const pendingSignOut = useRef<Promise<void> | null>(null);
  const refresh = async (): Promise<Me | null> => {
    if (!active.current || pendingSignOut.current) return null;
    const generation = ++authorityGeneration.current;
    const isCurrent = () =>
      active.current &&
      authorityGeneration.current === generation &&
      !pendingSignOut.current;
    try {
      const value = await controlPlane<Me>("/v1/admin/me");
      if (!isCurrent()) return null;
      setMe(value);
      setOtpRequired(false);
      return value;
    } catch (error) {
      if (!isCurrent()) return null;
      if (
        error instanceof ControlPlaneError &&
        error.code === "ADMIN_REAUTH_REQUIRED"
      ) {
        setOtpRequired(true);
        setNotice({ kind: "info", text: "Re-authentication is required." });
      }
      setMe(null);
      return null;
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };
  useEffect(() => {
    active.current = true;
    void refresh();
    return () => {
      active.current = false;
      authorityGeneration.current++;
    };
  }, []);
  const signOut = (): Promise<void> => {
    if (pendingSignOut.current) return pendingSignOut.current;
    // Invalidate every read started before the logout. No refresh started
    // while DELETE is pending may restore the context being ended.
    authorityGeneration.current++;
    const operation = (async () => {
      try {
        await controlPlane("/v1/admin/session", { method: "DELETE" });
      } catch (error) {
        if (!active.current) return;
        if (
          error instanceof ControlPlaneError &&
          (error.code === "ADMIN_UNAUTHORIZED" ||
            error.code === "ADMIN_REAUTH_REQUIRED")
        ) {
          // An expired session cannot authorize its own revocation. Its stale
          // context still has to end; a transport/CSRF failure is distinct.
          setMe(null);
          setOtpRequired(error.code === "ADMIN_REAUTH_REQUIRED");
          setNotice({ kind: "info", text: safeError(error) });
          return;
        }
        setNotice({ kind: "error", text: safeError(error) });
        throw error;
      }
      if (!active.current) return;
      setMe(null);
      setOtpRequired(false);
      setNotice(null);
    })().finally(() => {
      if (pendingSignOut.current === operation) pendingSignOut.current = null;
    });
    pendingSignOut.current = operation;
    return operation;
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

export function buildCompatibilityPublishBody(
  reason: string,
  contractVersion: "control_plane_v1" | "control_plane_v2" = "control_plane_v1",
) {
  return {
    contractVersion,
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

export function normalizeBetaInvitationEmail(input: string): string {
  const normalized = input.trim().normalize("NFC").toLowerCase();
  return normalized.length > 0 &&
    normalized.length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)
    ? normalized
    : "";
}

export function buildBetaInvitationCreateBody(input: {
  requestId: string;
  expectedRevision: number;
  email: string;
  reason: string;
}) {
  return {
    requestId: input.requestId,
    expectedRevision: input.expectedRevision,
    email: normalizeBetaInvitationEmail(input.email),
    reason: input.reason.trim(),
  };
}

export function buildBetaInvitationRevokeBody(input: {
  requestId: string;
  reason: string;
}) {
  return { requestId: input.requestId, reason: input.reason.trim() };
}

export function ensureReviewedRequest(
  current: ReviewedRequest | undefined,
  fingerprint: string,
  makeId: () => string = () => crypto.randomUUID(),
): ReviewedRequest {
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, requestId: makeId() };
}

export function lookupResultIsCurrent(
  requestGeneration: number,
  currentGeneration: number,
): boolean {
  return requestGeneration === currentGeneration;
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
  ["Support cases", "/support", "support.case.read"],
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
  const [sessionUnconfirmed, setSessionUnconfirmed] = useState(false);
  const active = useRef(false);
  const pending = useRef<{ authority: string } | null>(null);
  const authority = JSON.stringify([
    me?.principalId,
    me?.expiresAt,
    me?.permissions,
    otpRequired,
  ]);
  const currentAuthority = useRef(authority);
  currentAuthority.current = authority;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      pending.current = null;
    };
  }, []);
  const begin = () => {
    if (!active.current || pending.current || loading || me) return null;
    const operation = { authority };
    pending.current = operation;
    setBusy(true);
    setLocalNotice(null);
    setNotice(null);
    return operation;
  };
  const isCurrent = (operation: { authority: string }) =>
    active.current &&
    pending.current === operation &&
    currentAuthority.current === operation.authority;
  const finish = (operation: { authority: string }) => {
    if (!active.current || pending.current !== operation) return;
    pending.current = null;
    setBusy(false);
  };
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
  const fail = (error: unknown, operation: { authority: string }) => {
    if (!isCurrent(operation)) return;
    const value = safeError(error);
    setLocalNotice({ kind: "error", text: value });
    setNotice({ kind: "error", text: value });
  };
  const currentSession = async () => {
    const operation = begin();
    if (!operation) return;
    try {
      await controlPlane("/v1/admin/session", { method: "POST" });
      if (!isCurrent(operation)) return;
      setSessionUnconfirmed(true);
      if ((await refresh()) && isCurrent(operation)) router.replace("/");
    } catch (error) {
      if (!isCurrent(operation)) return;
      if (
        error instanceof ControlPlaneError &&
        error.code === "ADMIN_REAUTH_REQUIRED"
      )
        setCanContinue(false);
      fail(error, operation);
    } finally {
      finish(operation);
    }
  };
  const requestOtp = async (event: FormEvent) => {
    event.preventDefault();
    const operation = begin();
    if (!operation) return;
    try {
      const value = await controlPlane<{ challengeId: string }>(
        "/v1/auth/otp/request",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        },
      );
      if (!isCurrent(operation)) return;
      setChallengeId(value.challengeId);
      setLocalNotice({
        kind: "info",
        text: "Enter the one-time code sent to your email.",
      });
    } catch (error) {
      fail(error, operation);
    } finally {
      finish(operation);
    }
  };
  const verifyOtp = async (event: FormEvent) => {
    event.preventDefault();
    if (!challengeId) return;
    const operation = begin();
    if (!operation) return;
    try {
      await controlPlane("/v1/auth/otp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId, code }),
      });
      if (!isCurrent(operation)) return;
      await controlPlane("/v1/admin/session", { method: "POST" });
      if (!isCurrent(operation)) return;
      setSessionUnconfirmed(true);
      if ((await refresh()) && isCurrent(operation)) router.replace("/");
    } catch (error) {
      fail(error, operation);
    } finally {
      finish(operation);
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
        {sessionUnconfirmed ? (
          <div>
            <p role="status">
              {busy
                ? "Checking the elevated admin session…"
                : "The elevation request succeeded, but the admin session could not be confirmed. Check the session again before continuing."}
            </p>
            <button disabled={busy} onClick={() => window.location.reload()}>
              Check admin session
            </button>
          </div>
        ) : !challengeId ? (
          <form onSubmit={requestOtp}>
            <label>
              Email
              <input
                required
                type="email"
                value={email}
                disabled={busy}
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
                disabled={busy}
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
                disabled={busy}
                onClick={() => {
                  if (pending.current) return;
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

export function useData<T>(
  path: string | null,
  read: (
    path: string,
    init: { signal: AbortSignal },
  ) => Promise<T> = controlPlane,
) {
  const { me, refresh, setNotice } = useAdmin();
  const authority = JSON.stringify([
    me?.principalId,
    me?.expiresAt,
    me?.permissions,
  ]);
  // A new selection or admin authority has a distinct scope. Previous data is
  // hidden in that render, before the effect starts the new authorized read.
  const scope = useMemo(
    () => ({
      active: false,
      generation: 0,
      controller: null as AbortController | null,
    }),
    [path, authority, read],
  );
  const [state, setState] = useState<{
    scope: typeof scope | null;
    data: T | null;
    busy: boolean;
    error: unknown;
  }>({ scope: null, data: null, busy: Boolean(path), error: null });
  const load = async () => {
    // An onDone callback retained by an old selection cannot reload it.
    if (!scope.active) return;
    const generation = ++scope.generation;
    scope.controller?.abort();
    if (!path) {
      setState({ scope, data: null, busy: false, error: null });
      return;
    }
    const controller = new AbortController();
    scope.controller = controller;
    const isCurrent = () =>
      scope.active &&
      scope.generation === generation &&
      !controller.signal.aborted;
    setState({ scope, data: null, busy: true, error: null });
    try {
      const data = await read(path, { signal: controller.signal });
      if (isCurrent()) setState({ scope, data, busy: true, error: null });
    } catch (value) {
      if (!isCurrent()) return;
      setState({ scope, data: null, busy: true, error: value });
      if (
        value instanceof ControlPlaneError &&
        (value.code === "ADMIN_FORBIDDEN" ||
          value.code === "ADMIN_UNAUTHORIZED" ||
          value.code === "ADMIN_REAUTH_REQUIRED")
      ) {
        await refresh();
        if (isCurrent())
          setNotice({
            kind: "error",
            text:
              value.code === "ADMIN_FORBIDDEN"
                ? "Your permission changed. Available controls were refreshed."
                : safeError(value),
          });
      }
    } finally {
      if (isCurrent()) setState((current) => ({ ...current, busy: false }));
    }
  };
  useEffect(() => {
    scope.active = true;
    void load();
    return () => {
      scope.active = false;
      ++scope.generation;
      scope.controller?.abort();
    };
  }, [scope]);
  const current = state.scope === scope ? state : null;
  return {
    data: current?.data ?? null,
    busy: current ? current.busy : Boolean(path),
    error: current?.error ?? null,
    load,
  };
}

export function Mutation({
  permission,
  action,
  path,
  body,
  confirm,
  onDone,
  onSuccess,
  onBusyChange,
  reviewScope,
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
  onBusyChange?: (busy: boolean) => void;
  // Opt in when the parent owns the target inputs and locks them while pending.
  // Other workspaces retain their existing draft/selection coordinators.
  reviewScope?: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const { me, setNotice, refresh } = useAdmin();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<{
    fingerprint: string;
    scope: string;
    path: string;
    body: Record<string, unknown>;
  } | null>(null);
  const fingerprint = JSON.stringify([
    permission,
    action,
    path,
    reviewScope === undefined ? undefined : body,
    confirm,
    reviewScope,
    me?.principalId,
    me?.expiresAt,
  ]);
  const outcomeScope = JSON.stringify([
    permission,
    path,
    reviewScope,
    me?.principalId,
    me?.expiresAt,
  ]);
  const currentOutcomeScope = useRef(outcomeScope);
  currentOutcomeScope.current = outcomeScope;
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    setReview((current) =>
      current?.fingerprint === fingerprint ? current : null,
    );
  }, [fingerprint]);
  const currentReview = review?.fingerprint === fingerprint ? review : null;
  const submit = async () => {
    if (busyRef.current || disabled) return;
    if (!currentReview) {
      setReview(null);
      setNotice({
        kind: "info",
        text: "The operation changed. Review it again before submitting.",
      });
      return;
    }
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
      setReview(null);
      setReason("");
      setNotice({
        kind: "info",
        text: "The current authoritative revision was unavailable. No mutation was submitted; review again after the data reloads.",
      });
      try {
        await onDone?.();
      } catch {
        /* keep the mutation fail-closed if the authority read fails */
      }
      return;
    }
    busyRef.current = true;
    setBusy(true);
    onBusyChange?.(true);
    const submitted = currentReview;
    const isCurrent = () =>
      reviewScope === undefined ||
      (active.current && currentOutcomeScope.current === submitted.scope);
    try {
      const value = await controlPlane(submitted.path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(reviewScope === undefined ? body : submitted.body),
          reason: reason.trim(),
        }),
      });
      // B14 opt-in parents own the whole target lifetime. Legacy workspaces
      // retain their existing outcome callbacks across shared list reloads.
      // An already sent POST is never treated as canceled by UI navigation.
      if (!isCurrent()) return;
      onSuccess?.(value);
      setReason("");
      setReview(null);
      setNotice({ kind: "success", text: `${action} completed.` });
      try {
        await onDone?.();
      } catch {
        // The mutation succeeded. The read surface owns its error state; do not
        // turn a failed reload into a failed write or overwrite a newer notice.
      }
    } catch (error) {
      if (!isCurrent()) return;
      const stale =
        error instanceof ControlPlaneError &&
        (error.code === "ADMIN_STATE_STALE" || error.code === "ADMIN_CONFLICT");
      if (stale) {
        setReview(null);
        setReason("");
        setNotice({
          kind: "info",
          text: "The previous operation was not automatically repeated. Review current server data before submitting a new operation.",
        });
        try {
          await onDone?.();
        } catch {
          // The read failed; retain the safe instruction without asserting a
          // successful refresh or replaying the original change.
          return;
        }
        return;
      }
      if (
        error instanceof ControlPlaneError &&
        (error.code === "ADMIN_UNAUTHORIZED" ||
          error.code === "ADMIN_REAUTH_REQUIRED" ||
          error.code === "ADMIN_CSRF_INVALID" ||
          error.code === "ADMIN_FORBIDDEN")
      ) {
        setNotice({ kind: "error", text: safeError(error) });
        await refresh();
        return;
      }
      if (isCurrent()) setNotice({ kind: "error", text: safeError(error) });
    } finally {
      busyRef.current = false;
      setBusy(false);
      onBusyChange?.(false);
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
          onClick={() => {
            setReview({
              fingerprint,
              scope: outcomeScope,
              path,
              body: JSON.parse(JSON.stringify(body)) as Record<string, unknown>,
            });
          }}
        >
          {busy ? "Working…" : action}
        </button>
      </div>
      <label>
        Operator reason
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={busy}
          maxLength={256}
          required
        />
      </label>
      {currentReview && (
        <div className="confirm" role="dialog" aria-label={`Confirm ${action}`}>
          <p>
            <strong>Review before submitting</strong>
          </p>
          <p>{confirm ?? `Confirm ${action}.`}</p>
          <p>Reason: {reason || "(required)"}</p>
          <div className="actions">
            <button
              type="button"
              disabled={busy || disabled || !reason.trim()}
              onClick={() => void submit()}
            >
              Confirm {action}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setReview(null)}
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
  disabled = false,
}: {
  cursor: string | null;
  onNext: () => void;
  disabled?: boolean;
}) {
  return cursor ? (
    <div className="actions">
      <button className="secondary" disabled={disabled} onClick={onNext}>
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

type SupportCase = {
  caseId: string;
  category: string;
  severity: string;
  status: string;
  description: string;
  serverVersion: string | null;
  extensionVersion: string | null;
  browserFamily: string | null;
  marketplace: string;
  createdAt: string;
  updatedAt: string;
};

function SupportPage() {
  const { me, setNotice } = useAdmin();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [path, setPath] = useState("/v1/admin/support/cases?limit=50");
  const result = useData<{ items: SupportCase[] }>(path);
  const [selected, setSelected] = useState<SupportCase | null>(null);
  const [detail, setDetail] = useState<{
    followups: {
      followupId: string;
      authorType: string;
      body: string;
      createdAt: string;
    }[];
  } | null>(null);
  const [note, setNote] = useState("");
  const [aggregateText, setAggregateText] = useState("");
  const [funnel, setFunnel] = useState("ONBOARDING");
  const [funnelText, setFunnelText] = useState("");
  const search = (event: FormEvent) => {
    event.preventDefault();
    setPath(`/v1/admin/support/cases${query({ ...filters, limit: 50 })}`);
  };
  const open = async (item: SupportCase) => {
    setSelected(item);
    try {
      const value = await controlPlane<{
        followups: {
          followupId: string;
          authorType: string;
          body: string;
          createdAt: string;
        }[];
      }>(`/v1/admin/support/cases/${item.caseId}`);
      setDetail(value);
    } catch {
      setDetail(null);
    }
  };
  const transition = async (status: string) => {
    if (!selected || !has(me, "support.case.manage")) return;
    try {
      await controlPlane(`/v1/admin/support/cases/${selected.caseId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setNotice({ kind: "success", text: "Support case updated." });
      setPath(`/v1/admin/support/cases${query({ ...filters, limit: 50 })}`);
      setSelected({ ...selected, status });
    } catch (error) {
      setNotice({ kind: "error", text: safeError(error) });
    }
  };
  const addNote = async () => {
    if (!selected || !note.trim() || !has(me, "support.case.manage")) return;
    try {
      await controlPlane(
        `/v1/admin/support/cases/${selected.caseId}/followups`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ description: note }),
        },
      );
      setNote("");
      await open(selected);
    } catch (error) {
      setNotice({ kind: "error", text: safeError(error) });
    }
  };
  const loadAggregates = async () => {
    try {
      const value = await controlPlane<{ items: unknown[] }>(
        "/v1/admin/support/aggregates",
      );
      setAggregateText(JSON.stringify(value.items));
    } catch (error) {
      setNotice({ kind: "error", text: safeError(error) });
    }
  };
  const loadFunnel = async () => {
    try {
      const value = await controlPlane<unknown>(
        `/v1/admin/support/funnels?funnel=${encodeURIComponent(funnel)}&window=30D`,
      );
      setFunnelText(JSON.stringify(value));
    } catch (error) {
      setNotice({ kind: "error", text: safeError(error) });
    }
  };
  return (
    <Shell title="Support cases">
      <section className="card">
        <form onSubmit={search}>
          <div className="form-grid">
            <label>
              Status
              <select
                value={filters.status ?? ""}
                onChange={(e) =>
                  setFilters({ ...filters, status: e.target.value })
                }
              >
                <option value="">Any</option>
                {["NEW", "TRIAGED", "NEEDS_INFO", "RESOLVED", "CLOSED"].map(
                  (value) => (
                    <option key={value}>{value}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              Category
              <input
                value={filters.category ?? ""}
                onChange={(e) =>
                  setFilters({ ...filters, category: e.target.value })
                }
              />
            </label>
            <label>
              Version
              <input
                value={filters.extensionVersion ?? ""}
                onChange={(e) =>
                  setFilters({ ...filters, extensionVersion: e.target.value })
                }
              />
            </label>
            <label>
              Browser
              <input
                value={filters.browserFamily ?? ""}
                onChange={(e) =>
                  setFilters({ ...filters, browserFamily: e.target.value })
                }
              />
            </label>
            <label>
              Marketplace
              <input
                value={filters.marketplace ?? ""}
                onChange={(e) =>
                  setFilters({ ...filters, marketplace: e.target.value })
                }
              />
            </label>
          </div>
          <button type="submit">Filter</button>
          {has(me, "support.aggregate.read") && (
            <>
              <button
                type="button"
                className="secondary"
                onClick={() => void loadAggregates()}
              >
                Load aggregates
              </button>
              <select
                value={funnel}
                onChange={(e) => setFunnel(e.target.value)}
              >
                <option value="ONBOARDING">Onboarding funnel</option>
                <option value="FIRST_VALUE">First-value funnel</option>
                <option value="SUPPORT">Support funnel</option>
              </select>
              <button
                type="button"
                className="secondary"
                onClick={() => void loadFunnel()}
              >
                Load funnel
              </button>
            </>
          )}
        </form>
        {aggregateText && <pre>{aggregateText}</pre>}
        {funnelText && <pre>{funnelText}</pre>}
      </section>
      <LoadState busy={result.busy} error={result.error} />
      {result.data && (
        <section className="card">
          <Table
            headers={[
              "Case",
              "Category",
              "Status",
              "Version",
              "Browser",
              "Open",
            ]}
            rows={result.data.items.map((item) => [
              <code key="id">{item.caseId}</code>,
              item.category,
              <span className="status" key="status">
                {item.status}
              </span>,
              item.extensionVersion ?? "—",
              item.browserFamily ?? "—",
              <button key="open" type="button" onClick={() => void open(item)}>
                Open
              </button>,
            ])}
          />
        </section>
      )}
      {selected && (
        <section className="card">
          <h2>
            {selected.category} · {selected.caseId}
          </h2>
          <p>{selected.description}</p>
          <p>
            Severity: {selected.severity} · Marketplace: {selected.marketplace}
          </p>
          <div className="actions">
            {has(me, "support.case.manage") &&
              ["TRIAGED", "NEEDS_INFO", "RESOLVED", "CLOSED"].map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => void transition(status)}
                  disabled={selected.status === status}
                >
                  {status}
                </button>
              ))}
          </div>
          <label>
            Follow-up
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={4000}
            />
          </label>
          {has(me, "support.case.manage") && (
            <button
              type="button"
              onClick={() => void addNote()}
              disabled={!note.trim()}
            >
              Add follow-up
            </button>
          )}
          {detail?.followups?.length ? (
            <ul>
              {detail.followups.map((item) => (
                <li key={item.followupId}>
                  {item.authorType}: {item.body}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      )}
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
  const [overrideDraft, setOverrideDraft] = useState({ key: "", value: "" });
  const [mutationBusy, setMutationBusy] = useState(false);
  const [overrideEffectiveFrom, setOverrideEffectiveFrom] = useState(() =>
    new Date().toISOString(),
  );
  const effective = useData<Record<string, unknown>>(
    has(me, "entitlement.read") && entitlementKey
      ? `/v1/admin/accounts/${accountId}/entitlements/${entitlementKey}`
      : null,
  );
  const overrideAuthority = useData<OverrideAuthority>(
    has(me, "entitlement.read") && entitlementKey
      ? `/v1/admin/accounts/${accountId}/entitlement-overrides?limit=100&entitlementKey=${encodeURIComponent(entitlementKey)}`
      : null,
    loadOverrideAuthority,
  );
  const latestOverrideRevision = overrideAuthority.data?.latestRevision;
  const overrideInput =
    overrideDraft.key === entitlementKey
      ? overrideDraft.value
      : overrideAuthority.data?.valueType === "BOOLEAN"
        ? "true"
        : "";
  const selectedOverrideValue = overrideValue(
    overrideAuthority.data?.valueType,
    overrideInput,
  );
  const reloadOverrides = async () => {
    await Promise.all([
      overrides.load(),
      effective.load(),
      overrideAuthority.load(),
    ]);
    setOverrideEffectiveFrom(new Date().toISOString());
  };
  const reloadAll = async () => {
    await Promise.all([
      subscription.load(),
      devices.load(),
      payments.load(),
      events.load(),
      overrides.load(),
      overrideAuthority.load(),
      effective.load(),
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
          {subscription.data && (
            <p role="status">
              Access: {subscription.data.access.status}
              {subscription.data.access.reason
                ? ` · ${subscription.data.access.reason}`
                : ""}
            </p>
          )}
          <div className="form-grid">
            <label>
              Published plan revision ID
              <input
                value={planRevisionId}
                disabled={mutationBusy}
                onChange={(e) => setPlanRevisionId(e.target.value)}
              />
            </label>
            <label>
              New period end
              <input
                type="datetime-local"
                value={periodEnd}
                disabled={mutationBusy}
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
            confirm={`Grant plan revision ${planRevisionId || "(required)"} to account ${accountId} until ${periodEnd || "(required)"}? This changes the account's commercial access.`}
            disabled={mutationBusy}
            onBusyChange={setMutationBusy}
            reviewScope={accountId}
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
                    sub.plan?.displayName ??
                      sub.plan?.planCode ??
                      sub.plan?.planRevisionId ??
                      "Not provided",
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
                confirm={`Extend subscription ${subId} for account ${accountId} until ${periodEnd || "(required)"}?`}
                disabled={mutationBusy}
                onBusyChange={setMutationBusy}
                reviewScope={accountId}
                onDone={subscription.load}
              />
              <div className="actions">
                <Mutation
                  permission="subscription.suspend"
                  action="Suspend subscription"
                  path={`/v1/admin/accounts/${accountId}/subscription/${subId}/suspend`}
                  body={{ expectedStateRevision: revision }}
                  confirm={`Suspend subscription ${subId} for account ${accountId}? This changes the account's commercial access.`}
                  disabled={mutationBusy}
                  onBusyChange={setMutationBusy}
                  reviewScope={accountId}
                  onDone={subscription.load}
                />
                <Mutation
                  permission="subscription.restore"
                  action="Restore subscription"
                  path={`/v1/admin/accounts/${accountId}/subscription/${subId}/restore`}
                  body={{ expectedStateRevision: revision }}
                  confirm={`Restore subscription ${subId} for account ${accountId}? Access will be recalculated by the server.`}
                  disabled={mutationBusy}
                  onBusyChange={setMutationBusy}
                  reviewScope={accountId}
                  onDone={subscription.load}
                />
              </div>
            </>
          ) : subscription.data?.subscription === null ? (
            <p>No current subscription.</p>
          ) : null}
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
                  device.browserFamily
                    ? `${device.browserFamily} ${device.browserVersionLastSeen ?? ""}`.trim()
                    : "Not provided",
                  device.status,
                  device.lastSeenAt ?? "—",
                  <Mutation
                    key="action"
                    permission="device.revoke"
                    action="Revoke"
                    path={`/v1/admin/accounts/${accountId}/devices/${device.id}/revoke`}
                    body={{}}
                    confirm={`Revoke device ${device.id} in account ${accountId}? Its active extension sessions will end.`}
                    disabled={mutationBusy}
                    onBusyChange={setMutationBusy}
                    reviewScope={accountId}
                    onDone={devices.load}
                  >
                    <span />
                  </Mutation>,
                ])}
              />
              <Cursor
                cursor={devices.data.nextCursor}
                disabled={mutationBusy}
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
              disabled={mutationBusy}
              onChange={(e) => {
                const value = e.target.value;
                setEntitlementKey(value);
                setOverrideEffectiveFrom(new Date().toISOString());
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
              disabled={mutationBusy}
              onNext={() =>
                setOverridesPath(
                  withCursor(overridesPath, overrides.data?.nextCursor ?? ""),
                )
              }
            />
          )}
          {entitlementKey && (
            <>
              <LoadState
                busy={overrideAuthority.busy}
                error={overrideAuthority.error}
              />
              {overrideAuthority.data && (
                <label>
                  Override value
                  {overrideAuthority.data.valueType === "BOOLEAN" ? (
                    <select
                      value={overrideInput}
                      disabled={mutationBusy || overrideAuthority.busy}
                      onChange={(event) =>
                        setOverrideDraft({
                          key: entitlementKey,
                          value: event.target.value,
                        })
                      }
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <input
                      type="number"
                      step="1"
                      value={overrideInput}
                      disabled={mutationBusy || overrideAuthority.busy}
                      onChange={(event) =>
                        setOverrideDraft({
                          key: entitlementKey,
                          value: event.target.value,
                        })
                      }
                    />
                  )}
                </label>
              )}
              {overrideAuthority.data?.deprecated && (
                <p role="status">
                  This entitlement is deprecated. An existing override can be
                  cleared, but a new value cannot be set.
                </p>
              )}
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
                value: selectedOverrideValue,
                effectiveFrom: overrideEffectiveFrom,
                expiresAt: null,
              }}
              confirm={`Set override ${entitlementKey || "(required)"} to ${selectedOverrideValue ? `${selectedOverrideValue.kind} ${String(selectedOverrideValue.value)}` : "(value required)"} for account ${accountId}? The server will recalculate effective access.`}
              disabled={
                mutationBusy ||
                overrideAuthority.busy ||
                latestOverrideRevision === undefined ||
                !selectedOverrideValue ||
                overrideAuthority.data?.deprecated
              }
              onBusyChange={setMutationBusy}
              reviewScope={accountId}
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
                effectiveFrom: overrideEffectiveFrom,
                expiresAt: null,
              }}
              confirm={`Clear override ${entitlementKey} for account ${accountId}? The server will recalculate effective access.`}
              disabled={
                mutationBusy ||
                overrideAuthority.busy ||
                latestOverrideRevision === undefined
              }
              onBusyChange={setMutationBusy}
              reviewScope={accountId}
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
      <button
        className="secondary"
        disabled={mutationBusy}
        onClick={() => void reloadAll()}
      >
        Reload workspace
      </button>
    </Shell>
  );
}

function PrincipalActions({
  id,
  revision,
  roles,
  busy,
  onBusyChange,
  onDone,
}: {
  id: string;
  revision: number;
  roles: string[];
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onDone: () => Promise<void>;
}) {
  const { me } = useAdmin();
  const [role, setRole] = useState<AdminPrincipalRole | "">("");
  if (!has(me, "admin.principal.manage")) return null;
  return (
    <div className="actions">
      <label>
        Role for {id}
        <select
          value={role}
          disabled={busy}
          onChange={(event) =>
            setRole(
              isAdminPrincipalRole(event.target.value)
                ? event.target.value
                : "",
            )
          }
        >
          <option value="">Choose role</option>
          {ADMIN_PRINCIPAL_ROLES.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      {role && (
        // Changing the target role discards its old reason and confirmation.
        // The parent is also keyed by principal and authoritative revision.
        <div className="actions" key={role}>
          <Mutation
            permission="admin.principal.manage"
            action={`Grant ${role}`}
            path={`/v1/admin/principals/${id}/roles/${role}/grant`}
            body={{ expectedRevision: revision }}
            confirm={`Grant ${role} to ${id}? This changes this principal's administrative access.`}
            disabled={busy || roles.includes(role)}
            onBusyChange={onBusyChange}
            reviewScope={id}
            onDone={onDone}
          />
          <Mutation
            permission="admin.principal.manage"
            action={`Revoke ${role}`}
            path={`/v1/admin/principals/${id}/roles/${role}/revoke`}
            body={{ expectedRevision: revision }}
            confirm={`Revoke ${role} from ${id}? This removes the role's administrative access. Last-owner protection remains server-authoritative.`}
            disabled={busy || !roles.includes(role)}
            onBusyChange={onBusyChange}
            reviewScope={id}
            onDone={onDone}
          />
        </div>
      )}
      <Mutation
        permission="admin.principal.manage"
        action="Suspend"
        path={`/v1/admin/principals/${id}/suspend`}
        body={{ expectedRevision: revision }}
        confirm={`Suspend principal ${id}? All active admin sessions for this principal will be revoked.`}
        disabled={busy}
        onBusyChange={onBusyChange}
        reviewScope={id}
        onDone={onDone}
      />
      <Mutation
        permission="admin.principal.manage"
        action="Restore"
        path={`/v1/admin/principals/${id}/restore`}
        body={{ expectedRevision: revision }}
        confirm={`Restore principal ${id}? Previously revoked admin sessions stay revoked; a new sign-in and elevation are required.`}
        disabled={busy}
        onBusyChange={onBusyChange}
        reviewScope={id}
        onDone={onDone}
      />
    </div>
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
  // Every row shares one authoritative list. Its reload unmounts the rows,
  // so serialize writes across rows, creation and pagination until reload ends.
  const [mutationBusy, setMutationBusy] = useState(false);
  return (
    <Shell title="Admin principals">
      <section className="card">
        <p className="muted">
          Role choices are the accepted server roles. Last-owner protection
          remains server-authoritative.
        </p>
        {has(me, "admin.principal.manage") && (
          <>
            <div className="form-grid">
              <label>
                User ID
                <input
                  value={userId}
                  disabled={mutationBusy}
                  onChange={(e) => setUserId(e.target.value)}
                />
              </label>
              <label>
                Initial role
                <select
                  value={role}
                  disabled={mutationBusy}
                  onChange={(e) => setRole(e.target.value)}
                >
                  {ADMIN_PRINCIPAL_ROLES.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            </div>
            <Mutation
              key={JSON.stringify([userId, role])}
              permission="admin.principal.manage"
              action="Create principal"
              path="/v1/admin/principals"
              body={{ userId, initialRole: role }}
              confirm={`Create an admin principal for user ${userId} with ${role}? This grants administrative access to that user.`}
              disabled={mutationBusy || !userId.trim()}
              onBusyChange={setMutationBusy}
              reviewScope={userId}
              onDone={result.load}
            />
          </>
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
                return [
                  id,
                  String(principal.userId),
                  String(principal.status),
                  String(revision),
                  Array.isArray(principal.roles)
                    ? principal.roles.join(", ")
                    : "—",
                  <PrincipalActions
                    key={`${id}:${revision}`}
                    id={id}
                    revision={revision}
                    busy={mutationBusy}
                    onBusyChange={setMutationBusy}
                    roles={
                      Array.isArray(principal.roles)
                        ? principal.roles.map(String)
                        : []
                    }
                    onDone={result.load}
                  />,
                ];
              })}
            />
            <Cursor
              cursor={result.data.nextCursor}
              disabled={mutationBusy}
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
  const [contractVersion, setContractVersion] = useState<
    "control_plane_v1" | "control_plane_v2"
  >("control_plane_v1");
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
          body: JSON.stringify(
            buildCompatibilityPublishBody(reason.trim(), contractVersion),
          ),
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
            <label>
              Contract version
              <select
                value={contractVersion}
                onChange={(e) =>
                  setContractVersion(e.target.value as typeof contractVersion)
                }
              >
                <option value="control_plane_v1">control_plane_v1</option>
                <option value="control_plane_v2">control_plane_v2</option>
              </select>
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
  const { me } = useAdmin();
  const authority = JSON.stringify([
    me?.principalId,
    me?.expiresAt,
    me?.permissions,
  ]);
  const currentAuthority = useRef(authority);
  currentAuthority.current = authority;
  if (!has(me, "beta.admission.read"))
    return (
      <Shell title="Beta admission">
        <p role="status">You do not have access to beta admission.</p>
      </Shell>
    );
  // Drop private drafts and reviews when the actual admin authority changes.
  // The shared ref also fences a completed old request before effect cleanup.
  return (
    <BetaAdmissionWorkspace
      key={authority}
      authority={authority}
      currentAuthority={currentAuthority}
    />
  );
}

function BetaAdmissionWorkspace({
  authority,
  currentAuthority,
}: {
  authority: string;
  currentAuthority: { current: string };
}) {
  const { me, setNotice, refresh } = useAdmin();
  const state = useData<BetaState>(
    has(me, "beta.admission.read") ? "/v1/admin/beta/admission" : null,
  );
  const [action, setAction] = useState<
    "OPEN" | "PAUSE" | "CLOSE" | "ADD_CAPACITY" | "SET_CAPACITY"
  >("OPEN");
  const [amount, setAmount] = useState("100");
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<{
    fingerprint: string;
    body: {
      requestId: string;
      expectedRevision: number;
      action: typeof action;
      amount?: number;
      capacity?: number;
      reason: string;
    };
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const quotaRequest = useRef<ReviewedRequest | undefined>(undefined);
  const pending = useRef(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const isCurrent = () =>
    active.current && currentAuthority.current === authority;

  const [lookupId, setLookupId] = useState("");
  const [invitation, setInvitation] = useState<BetaInvitation | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const lookupGeneration = useRef(0);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteReason, setInviteReason] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteReviewBody, setInviteReviewBody] = useState<ReturnType<
    typeof buildBetaInvitationCreateBody
  > | null>(null);
  const inviteRequest = useRef<ReviewedRequest | undefined>(undefined);
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeReviewBody, setRevokeReviewBody] = useState<{
    invitationId: string;
    body: ReturnType<typeof buildBetaInvitationRevokeBody>;
  } | null>(null);
  const revokeRequest = useRef<ReviewedRequest | undefined>(undefined);

  const current = state.data;
  const mutationBusy = busy || inviteBusy || revokeBusy;
  const editingDisabled = mutationBusy || state.busy;
  if (!has(me, "beta.admission.read")) return null;

  const staleOrConflict = (error: unknown) =>
    error instanceof ControlPlaneError &&
    (error.code === "ADMIN_STATE_STALE" || error.code === "ADMIN_CONFLICT");
  const refreshAdminOnAuthorityError = async (error: unknown) => {
    if (
      error instanceof ControlPlaneError &&
      [
        "ADMIN_UNAUTHORIZED",
        "ADMIN_REAUTH_REQUIRED",
        "ADMIN_CSRF_INVALID",
        "ADMIN_FORBIDDEN",
      ].includes(error.code)
    ) {
      if (!isCurrent()) return true;
      setReview(null);
      setInviteReviewBody(null);
      setRevokeReviewBody(null);
      quotaRequest.current = undefined;
      inviteRequest.current = undefined;
      revokeRequest.current = undefined;
      setNotice({ kind: "error", text: safeError(error) });
      await refresh();
      return true;
    }
    return false;
  };

  const loadInvitation = async (value = lookupId) => {
    const invitationId = value.trim();
    if (!isCurrent() || !invitationId) return null;
    const generation = ++lookupGeneration.current;
    setLookupBusy(true);
    try {
      const next = await controlPlane<BetaInvitation>(
        `/v1/admin/beta/invitations/${encodeURIComponent(invitationId)}`,
      );
      if (
        !isCurrent() ||
        !lookupResultIsCurrent(generation, lookupGeneration.current)
      )
        return null;
      setInvitation(next);
      setLookupId(next.invitationId);
      return next;
    } catch (error) {
      if (
        !isCurrent() ||
        !lookupResultIsCurrent(generation, lookupGeneration.current)
      )
        return null;
      setInvitation(null);
      if (await refreshAdminOnAuthorityError(error)) return null;
      if (
        !isCurrent() ||
        !lookupResultIsCurrent(generation, lookupGeneration.current)
      )
        return null;
      setNotice({ kind: "error", text: safeError(error) });
      return null;
    } finally {
      if (
        isCurrent() &&
        lookupResultIsCurrent(generation, lookupGeneration.current)
      )
        setLookupBusy(false);
    }
  };

  const beginInviteReview = () => {
    const normalizedEmail = normalizeBetaInvitationEmail(inviteEmail);
    if (
      pending.current ||
      !isCurrent() ||
      !has(me, "beta.admission.manage") ||
      !current ||
      state.busy ||
      lookupBusy ||
      !normalizedEmail ||
      !inviteReason.trim()
    )
      return;
    const fingerprint = JSON.stringify([
      current.revision,
      normalizedEmail,
      inviteReason.trim(),
    ]);
    inviteRequest.current = ensureReviewedRequest(
      inviteRequest.current,
      fingerprint,
    );
    setInviteReviewBody(
      buildBetaInvitationCreateBody({
        requestId: inviteRequest.current.requestId,
        expectedRevision: current.revision,
        email: normalizedEmail,
        reason: inviteReason,
      }),
    );
  };

  const submitInvitation = async () => {
    if (
      pending.current ||
      !isCurrent() ||
      !has(me, "beta.admission.manage") ||
      !inviteReviewBody ||
      !current ||
      state.busy ||
      lookupBusy ||
      inviteReviewBody.expectedRevision !== current.revision ||
      inviteReviewBody.email !== normalizeBetaInvitationEmail(inviteEmail) ||
      inviteReviewBody.reason !== inviteReason.trim()
    )
      return;
    pending.current = true;
    const selectionGeneration = lookupGeneration.current;
    setInviteBusy(true);
    try {
      const next = await controlPlane<BetaInvitationMutation>(
        "/v1/admin/beta/invitations",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(inviteReviewBody),
        },
      );
      if (!isCurrent()) return;
      inviteRequest.current = undefined;
      setInviteReviewBody(null);
      setInviteEmail("");
      setInviteReason("");
      if (
        lookupResultIsCurrent(selectionGeneration, lookupGeneration.current)
      ) {
        lookupGeneration.current += 1;
        setLookupBusy(false);
        setInvitation(next);
        setLookupId(next.invitationId);
      }
      setNotice({
        kind: "success",
        text: next.replay
          ? "Invitation request was already applied; current invitation state loaded."
          : "Targeted reviewer invitation created.",
      });
      await state.load();
    } catch (error) {
      if (!isCurrent()) return;
      if (staleOrConflict(error)) {
        inviteRequest.current = undefined;
        setInviteReviewBody(null);
        setNotice({
          kind: "info",
          text: "The invitation was not automatically retried. Review current server data before submitting a new invitation.",
        });
        await state.load();
      } else {
        if (await refreshAdminOnAuthorityError(error)) return;
        if (isCurrent()) setNotice({ kind: "error", text: safeError(error) });
      }
    } finally {
      pending.current = false;
      if (isCurrent()) setInviteBusy(false);
    }
  };

  const beginRevokeReview = () => {
    if (
      pending.current ||
      !isCurrent() ||
      !has(me, "beta.admission.manage") ||
      state.busy ||
      lookupBusy ||
      !invitation ||
      invitation.status !== "PENDING" ||
      !revokeReason.trim()
    )
      return;
    const fingerprint = JSON.stringify([
      invitation.invitationId,
      revokeReason.trim(),
    ]);
    revokeRequest.current = ensureReviewedRequest(
      revokeRequest.current,
      fingerprint,
    );
    setRevokeReviewBody({
      invitationId: invitation.invitationId,
      body: buildBetaInvitationRevokeBody({
        requestId: revokeRequest.current.requestId,
        reason: revokeReason,
      }),
    });
  };

  const submitRevoke = async () => {
    if (
      pending.current ||
      !isCurrent() ||
      !has(me, "beta.admission.manage") ||
      state.busy ||
      lookupBusy ||
      !revokeReviewBody ||
      revokeReviewBody.invitationId !== invitation?.invitationId ||
      invitation.status !== "PENDING" ||
      revokeReviewBody.body.reason !== revokeReason.trim()
    )
      return;
    pending.current = true;
    const selectionGeneration = lookupGeneration.current;
    setRevokeBusy(true);
    try {
      const next = await controlPlane<BetaInvitationMutation>(
        `/v1/admin/beta/invitations/${encodeURIComponent(revokeReviewBody.invitationId)}/revoke`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(revokeReviewBody.body),
        },
      );
      if (!isCurrent()) return;
      revokeRequest.current = undefined;
      setRevokeReviewBody(null);
      setRevokeReason("");
      if (
        lookupResultIsCurrent(selectionGeneration, lookupGeneration.current)
      ) {
        lookupGeneration.current += 1;
        setLookupBusy(false);
        setInvitation(next);
      }
      setNotice({
        kind: "success",
        text: next.replay
          ? "Invitation revoke was already applied; current state loaded."
          : "Invitation revoked.",
      });
      await state.load();
    } catch (error) {
      if (!isCurrent()) return;
      if (staleOrConflict(error)) {
        const invitationId = revokeReviewBody.invitationId;
        revokeRequest.current = undefined;
        setRevokeReviewBody(null);
        setNotice({
          kind: "info",
          text: "The revoke was not automatically retried. Review current server data before submitting a new revoke.",
        });
        await state.load();
        if (
          !isCurrent() ||
          !lookupResultIsCurrent(selectionGeneration, lookupGeneration.current)
        )
          return;
        await loadInvitation(invitationId);
      } else {
        if (await refreshAdminOnAuthorityError(error)) return;
        if (isCurrent()) setNotice({ kind: "error", text: safeError(error) });
      }
    } finally {
      pending.current = false;
      if (isCurrent()) setRevokeBusy(false);
    }
  };

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
        : `mode ${current?.mode ?? "—"} → ${action === "PAUSE" ? "PAUSED" : action === "CLOSE" ? "CLOSED" : "OPEN"}`;
  const validQuota =
    Boolean(current && reason.trim()) &&
    (action !== "ADD_CAPACITY" ||
      (amount.trim() !== "" &&
        Number.isSafeInteger(parsedAmount) &&
        parsedAmount >= 1 &&
        Number.isSafeInteger(nextCapacity))) &&
    (action !== "SET_CAPACITY" ||
      (amount.trim() !== "" &&
        Number.isSafeInteger(parsedAmount) &&
        parsedAmount >= 0));
  const quotaFingerprint = JSON.stringify([
    current?.revision,
    action,
    action === "ADD_CAPACITY" || action === "SET_CAPACITY"
      ? parsedAmount
      : null,
    reason.trim(),
  ]);
  const currentReview =
    review?.fingerprint === quotaFingerprint && validQuota ? review : null;
  const beginQuotaReview = () => {
    if (
      pending.current ||
      !isCurrent() ||
      !has(me, "beta.admission.manage") ||
      !current ||
      state.busy ||
      lookupBusy ||
      !validQuota
    )
      return;
    quotaRequest.current = ensureReviewedRequest(
      quotaRequest.current,
      quotaFingerprint,
    );
    setReview({
      fingerprint: quotaFingerprint,
      body: {
        requestId: quotaRequest.current.requestId,
        expectedRevision: current.revision,
        action,
        ...(action === "ADD_CAPACITY" ? { amount: parsedAmount } : {}),
        ...(action === "SET_CAPACITY" ? { capacity: parsedAmount } : {}),
        reason: reason.trim(),
      },
    });
  };

  const submit = async () => {
    if (
      pending.current ||
      !isCurrent() ||
      !has(me, "beta.admission.manage") ||
      state.busy ||
      lookupBusy ||
      !currentReview
    )
      return;
    pending.current = true;
    setBusy(true);
    try {
      await controlPlane("/v1/admin/beta/admission", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(currentReview.body),
      });
      if (!isCurrent()) return;
      quotaRequest.current = undefined;
      setReview(null);
      setReason("");
      setNotice({ kind: "success", text: "Beta admission updated." });
      await state.load();
    } catch (error) {
      if (!isCurrent()) return;
      if (staleOrConflict(error)) {
        quotaRequest.current = undefined;
        setReview(null);
        setNotice({
          kind: "info",
          text: "The beta change was not automatically repeated. Review current server data before submitting a new operation.",
        });
        await state.load();
      } else {
        if (await refreshAdminOnAuthorityError(error)) return;
        if (isCurrent()) setNotice({ kind: "error", text: safeError(error) });
      }
    } finally {
      pending.current = false;
      if (isCurrent()) setBusy(false);
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
                    disabled={editingDisabled}
                    onChange={(e) => {
                      setAction(e.target.value as typeof action);
                      setReview(null);
                    }}
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
                      disabled={editingDisabled}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        setReview(null);
                      }}
                    />
                  </label>
                )}
              </div>
              <label>
                Reason
                <textarea
                  value={reason}
                  maxLength={256}
                  disabled={editingDisabled}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setReview(null);
                  }}
                  required
                />
              </label>
              <button
                type="button"
                disabled={editingDisabled || lookupBusy || !validQuota}
                onClick={beginQuotaReview}
              >
                Review change
              </button>
              {currentReview && (
                <div
                  className="confirm"
                  role="dialog"
                  aria-label="Confirm beta admission change"
                >
                  <p>
                    <strong>Exact change</strong>
                  </p>
                  <p>{change}</p>
                  <p>Reason: {currentReview.body.reason}</p>
                  <div className="actions">
                    <button
                      type="button"
                      disabled={editingDisabled || lookupBusy || !validQuota}
                      onClick={() => void submit()}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={editingDisabled}
                      onClick={() => setReview(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="card">
            <h2>Targeted reviewer invitation</h2>
            <p className="muted">
              An invitation admits one email identity to the closed beta. The
              reviewer still completes the ordinary email OTP sign-in; an
              invitation does not create a session or device.
            </p>
            <label>
              Invitation ID
              <input
                value={lookupId}
                disabled={editingDisabled}
                onChange={(event) => {
                  lookupGeneration.current += 1;
                  setLookupBusy(false);
                  setLookupId(event.target.value);
                  setInvitation(null);
                  setRevokeReviewBody(null);
                }}
                autoComplete="off"
              />
            </label>
            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={editingDisabled || lookupBusy || !lookupId.trim()}
                onClick={() => void loadInvitation()}
              >
                {lookupBusy ? "Loading…" : "Inspect invitation"}
              </button>
            </div>
            {invitation && (
              <Table
                headers={[
                  "Invitation",
                  "Status",
                  "Created",
                  "Expires",
                  "Consumed",
                  "Revoked",
                ]}
                rows={[
                  [
                    invitation.invitationId,
                    invitation.status,
                    invitation.createdAt,
                    invitation.expiresAt,
                    invitation.consumedAt ?? "—",
                    invitation.revokedAt ?? "—",
                  ],
                ]}
              />
            )}
          </section>

          {has(me, "beta.admission.manage") && (
            <section className="panel">
              <h2>Create targeted invitation</h2>
              <p className="muted">
                The target email is sent only in the reviewed create request. It
                is cleared after success and is not returned by the server.
              </p>
              <label>
                Reviewer email
                <input
                  type="email"
                  value={inviteEmail}
                  disabled={editingDisabled}
                  onChange={(event) => {
                    setInviteEmail(event.target.value);
                    setInviteReviewBody(null);
                  }}
                  autoComplete="off"
                />
              </label>
              <label>
                Reason
                <textarea
                  value={inviteReason}
                  disabled={editingDisabled}
                  maxLength={512}
                  onChange={(event) => {
                    setInviteReason(event.target.value);
                    setInviteReviewBody(null);
                  }}
                />
              </label>
              <button
                type="button"
                disabled={
                  editingDisabled ||
                  lookupBusy ||
                  !inviteEmail.trim() ||
                  !inviteReason.trim() ||
                  !current
                }
                onClick={beginInviteReview}
              >
                Review invitation
              </button>
              {inviteReviewBody &&
                inviteReviewBody.expectedRevision === current.revision && (
                  <div
                    className="confirm"
                    role="dialog"
                    aria-label="Confirm targeted invitation"
                  >
                    <p>
                      <strong>Exact invitation</strong>
                    </p>
                    <p>Target: {inviteReviewBody.email}</p>
                    <p>Beta revision: {inviteReviewBody.expectedRevision}</p>
                    <p>Reason: {inviteReviewBody.reason}</p>
                    <div className="actions">
                      <button
                        type="button"
                        disabled={editingDisabled || lookupBusy}
                        onClick={() => void submitInvitation()}
                      >
                        {inviteBusy ? "Working…" : "Confirm invitation"}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={editingDisabled}
                        onClick={() => setInviteReviewBody(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
            </section>
          )}

          {has(me, "beta.admission.manage") &&
            invitation?.status === "PENDING" && (
              <section className="panel">
                <h2>Revoke pending invitation</h2>
                <p>
                  Invitation <code>{invitation.invitationId}</code>
                </p>
                <label>
                  Reason
                  <textarea
                    value={revokeReason}
                    disabled={editingDisabled}
                    maxLength={512}
                    onChange={(event) => {
                      setRevokeReason(event.target.value);
                      setRevokeReviewBody(null);
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={
                    editingDisabled || lookupBusy || !revokeReason.trim()
                  }
                  onClick={beginRevokeReview}
                >
                  Review revoke
                </button>
                {revokeReviewBody && (
                  <div
                    className="confirm"
                    role="dialog"
                    aria-label="Confirm invitation revoke"
                  >
                    <p>
                      Revoke invitation{" "}
                      <code>{revokeReviewBody.invitationId}</code>
                    </p>
                    <p>Reason: {revokeReviewBody.body.reason}</p>
                    <div className="actions">
                      <button
                        type="button"
                        disabled={editingDisabled || lookupBusy}
                        onClick={() => void submitRevoke()}
                      >
                        {revokeBusy ? "Working…" : "Confirm revoke"}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={editingDisabled}
                        onClick={() => setRevokeReviewBody(null)}
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
    case "support":
      return <SupportPage />;
    default:
      return <Dashboard />;
  }
}

"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { controlPlane } from "../../lib/control-plane";
import {
  deviceClientMetadataDisplay,
  type DeviceClientMetadata,
} from "../../lib/device-client-metadata";
type Account = {
  id: string;
  displayName: string | null;
  status: "ACTIVE" | "SUSPENDED";
};
type Preview = {
  status: "pending";
  authorizationId: string;
  clientMetadata: DeviceClientMetadata;
  deviceLabel: string | null;
  expiresAt: string;
};
function ActivationRequest({ id }: { id: string | null }) {
  const router = useRouter(),
    [accounts, setAccounts] = useState<Account[]>([]),
    [preview, setPreview] = useState<Preview>(),
    [accountId, setAccountId] = useState(""),
    [userCode, setUserCode] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [closed, setClosed] = useState(false),
    lifecycle = useRef<{
      active: boolean;
      busy: boolean;
      closed: boolean;
    } | null>(null);
  useEffect(() => {
    const current = { active: true, busy: false, closed: false };
    lifecycle.current = current;
    const isCurrent = () => current.active && lifecycle.current === current;
    setAccounts([]);
    setPreview(undefined);
    setAccountId("");
    setUserCode("");
    setMessage("");
    setBusy(false);
    setClosed(false);
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      setMessage("Invalid activation request.");
    } else {
      void (async () => {
        try {
          const [a, p] = await Promise.all([
            controlPlane("/v1/accounts"),
            controlPlane(`/v1/device-authorizations/${id}`),
          ]);
          if (!isCurrent()) return;
          if (a.status === 401 || p.status === 401) {
            router.replace(
              `/login?returnTo=${encodeURIComponent(`/activate?authorizationId=${id}`)}`,
            );
            return;
          }
          if (!a.ok || !p.ok) throw new Error("Unavailable preview");
          const accountData: { accounts: Account[] } = await a.json(),
            previewData: Preview = await p.json();
          if (!isCurrent()) return;
          if (
            !Array.isArray(accountData.accounts) ||
            !accountData.accounts.every(
              (account) =>
                account &&
                typeof account.id === "string" &&
                (account.displayName === null ||
                  typeof account.displayName === "string") &&
                ["ACTIVE", "SUSPENDED"].includes(account.status),
            ) ||
            !previewData ||
            previewData.status !== "pending" ||
            previewData.authorizationId !== id ||
            !previewData.clientMetadata
          )
            throw new Error("Invalid preview");
          setAccounts(accountData.accounts);
          setPreview(previewData);
          const only = accountData.accounts.filter((x) => x.status === "ACTIVE");
          if (only.length === 1) setAccountId(only[0].id);
        } catch {
          if (isCurrent()) setMessage("Activation request is unavailable.");
        }
      })();
    }
    return () => {
      current.active = false;
      if (lifecycle.current === current) lifecycle.current = null;
    };
  }, [id, router]);
  const act = async (kind: "approve" | "deny") => {
    const current = lifecycle.current;
    if (
      !current?.active ||
      current.busy ||
      current.closed ||
      !id ||
      !preview ||
      preview.authorizationId !== id ||
      !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-?[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/i.test(
        userCode,
      ) ||
      (kind === "approve" &&
        !accounts.some((a) => a.id === accountId && a.status === "ACTIVE"))
    )
      return;
    const isCurrent = () => current.active && lifecycle.current === current;
    current.busy = true;
    setBusy(true);
    setMessage("");
    const body = kind === "approve" ? { accountId, userCode } : { userCode };
    try {
      const r = await controlPlane(`/v1/device-authorizations/${id}/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!isCurrent()) return;
      if (r.status !== 200) {
        if (r.status >= 200 && r.status < 300)
          throw new Error("Unconfirmed receipt");
        setMessage("Request could not be completed.");
        return;
      }
      const result = await r.json();
      if (!isCurrent()) return;
      if (
        !result ||
        result.authorizationId !== id ||
        result.status !== (kind === "approve" ? "approved" : "denied") ||
        (kind === "approve" && typeof result.expiresAt !== "string")
      )
        throw new Error("Unconfirmed receipt");
      current.closed = true;
      setClosed(true);
      setMessage(
        kind === "approve"
          ? "Device approved. Return to the extension to finish activation."
          : "Device request denied.",
      );
    } catch {
      if (isCurrent()) {
        current.closed = true;
        setClosed(true);
        setMessage(
          "The request result could not be confirmed. Reload this request before trying again.",
        );
      }
    } finally {
      if (isCurrent()) {
        current.busy = false;
        setBusy(false);
      }
    }
  };
  const ready = Boolean(preview) && !busy && !closed;
  const metadata = preview
    ? deviceClientMetadataDisplay(preview.clientMetadata)
    : undefined;
  return (
    <main>
      <h1>Activate device</h1>
      {preview && (
        <dl>
          <dt>Device</dt>
          <dd>{preview.deviceLabel ?? "Unnamed device"}</dd>
          <dt>Browser</dt>
          <dd>{metadata?.browser}</dd>
          <dt>Extension</dt>
          <dd>{metadata?.extension}</dd>
          <dt>Expires</dt>
          <dd>{preview.expiresAt}</dd>
        </dl>
      )}
      <label>
        Account{" "}
        <select
          disabled={!ready}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">Choose account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id} disabled={a.status !== "ACTIVE"}>
              {a.displayName ?? `Account ${a.id.slice(0, 8)}`} {a.status}
            </option>
          ))}
        </select>
      </label>
      <label>
        User code{" "}
        <input
          disabled={!ready}
          value={userCode}
          onChange={(e) => setUserCode(e.target.value)}
        />
      </label>
      <button
        disabled={!ready || !accountId || !userCode}
        onClick={() => void act("approve")}
      >
        Approve
      </button>
      <button disabled={!ready || !userCode} onClick={() => void act("deny")}>
        Deny
      </button>
      {message && <p role="status">{message}</p>}
    </main>
  );
}

function ActivateContent() {
  const id = useSearchParams().get("authorizationId");
  return <ActivationRequest key={id ?? ""} id={id} />;
}

export default function Activate() {
  return (
    <Suspense fallback={null}>
      <ActivateContent />
    </Suspense>
  );
}

"use client";
import { Suspense, useEffect, useState } from "react";
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
  clientMetadata: DeviceClientMetadata;
  deviceLabel: string | null;
  expiresAt: string;
};
function ActivateContent() {
  const query = useSearchParams(),
    router = useRouter(),
    id = query.get("authorizationId"),
    [accounts, setAccounts] = useState<Account[]>([]),
    [preview, setPreview] = useState<Preview>(),
    [accountId, setAccountId] = useState(""),
    [userCode, setUserCode] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      setMessage("Invalid activation request.");
      return;
    }
    void Promise.all([
      controlPlane("/v1/accounts"),
      controlPlane(`/v1/device-authorizations/${id}`),
    ]).then(async ([a, p]) => {
      if (a.status === 401 || p.status === 401)
        return router.replace(
          `/login?returnTo=${encodeURIComponent(`/activate?authorizationId=${id}`)}`,
        );
      if (!a.ok || !p.ok)
        return setMessage("Activation request is unavailable.");
      const accountData = await a.json(),
        previewData = await p.json();
      setAccounts(accountData.accounts);
      setPreview(previewData);
      const only = accountData.accounts.filter(
        (x: Account) => x.status === "ACTIVE",
      );
      if (only.length === 1) setAccountId(only[0].id);
    });
  }, [id, router]);
  const act = async (kind: "approve" | "deny") => {
    if (!id) return;
    const body = kind === "approve" ? { accountId, userCode } : { userCode };
    const r = await controlPlane(`/v1/device-authorizations/${id}/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setMessage(
      r.ok
        ? kind === "approve"
          ? "Device approved. Return to the extension to finish activation."
          : "Device request denied."
        : "Request could not be completed.",
    );
  };
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
        <input value={userCode} onChange={(e) => setUserCode(e.target.value)} />
      </label>
      <button
        disabled={!accountId || !userCode}
        onClick={() => void act("approve")}
      >
        Approve
      </button>
      <button disabled={!userCode} onClick={() => void act("deny")}>
        Deny
      </button>
      {message && <p role="status">{message}</p>}
    </main>
  );
}

export default function Activate() {
  return (
    <Suspense fallback={null}>
      <ActivateContent />
    </Suspense>
  );
}

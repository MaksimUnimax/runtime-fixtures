"use client";
import { useEffect, useRef, useState } from "react";
import { controlPlane, readConnectionCode } from "../../lib/control-plane";
import {
  deviceClientMetadataDisplay,
  type DeviceClientMetadata,
} from "../../lib/device-client-metadata";
type Account = { id: string; displayName: string | null; status: string };
type Device = {
  id: string;
  status: string;
  label: string | null;
  clientMetadata: DeviceClientMetadata;
  activatedAt: string | null;
  lastSeenAt: string | null;
};
export default function Devices() {
  const [accounts, setAccounts] = useState<Account[]>([]),
    [account, setAccount] = useState(""),
    [devices, setDevices] = useState<Device[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [codeMode, setCodeMode] = useState<"issue" | "rotate" | "lookup">("issue"),
    [operationId, setOperationId] = useState(""),
    [codeMessage, setCodeMessage] = useState(""),
    [codeLoading, setCodeLoading] = useState(false),
    view = useRef({ active: false, accountId: "", selection: 0, read: 0, codeRead: 0, codeBusy: false });
  const clearCodeRead = () => {
    view.current.codeRead += 1;
    view.current.codeBusy = false;
    setCodeMessage("");
    setCodeLoading(false);
  };
  const selectAccount = (id: string) => {
    const current = view.current;
    if (!current.active || current.accountId === id) return;
    current.accountId = id;
    current.selection += 1;
    current.read += 1;
    clearCodeRead();
    setOperationId("");
    setDevices([]);
    setError("");
    setLoading(Boolean(id));
    setAccount(id);
  };
  const load = async (id = account) => {
    const current = view.current;
    if (!current.active || !id || current.accountId !== id) return;
    const selection = current.selection,
      read = ++current.read,
      isCurrent = () =>
        current.active &&
        current.accountId === id &&
        current.selection === selection &&
        current.read === read;
    setDevices([]);
    setError("");
    setLoading(true);
    try {
      const r = await controlPlane(`/v1/devices?accountId=${id}`);
      if (!isCurrent()) return;
      if (r.status === 401) {
        location.assign("/login?returnTo=%2Fdevices");
        return;
      }
      if (!r.ok) throw new Error("Device list unavailable");
      const body = await r.json();
      if (!isCurrent()) return;
      if (!Array.isArray(body.devices)) throw new Error("Invalid device list");
      setDevices(body.devices);
    } catch {
      if (isCurrent()) setError("Could not load devices. Refresh to retry.");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };
  useEffect(() => {
    const current = view.current;
    current.active = true;
    let active = true;
    void (async () => {
      try {
        const r = await controlPlane("/v1/accounts");
        if (!active) return;
        if (r.status === 401) {
          location.assign("/login?returnTo=%2Fdevices");
          return;
        }
        if (!r.ok) throw new Error("Account list unavailable");
        const a = (await r.json()).accounts;
        if (!active) return;
        if (!Array.isArray(a)) throw new Error("Invalid account list");
        setAccounts(a);
        if (a[0]) selectAccount(a[0].id);
        else setLoading(false);
      } catch {
        if (active) {
          setError("Could not load accounts. Reload this page to retry.");
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
      current.active = false;
      current.selection += 1;
      current.read += 1;
      current.codeRead += 1;
      current.codeBusy = false;
    };
  }, []);
  useEffect(() => {
    void load();
  }, [account]);
  const revoke = async (id: string) => {
    const current = view.current,
      selection = current.selection,
      isCurrent = () =>
        current.active &&
        current.accountId === account &&
        current.selection === selection;
    if (!isCurrent()) return;
    try {
      const r = await controlPlane(`/v1/devices/${id}/revoke`, {
        method: "POST",
      });
      if (!isCurrent()) return;
      if (!r.ok) {
        setError("Device could not be revoked. Refresh to check its state.");
        return;
      }
      await load();
    } catch {
      if (isCurrent())
        setError("Revoke result is unknown. Refresh to check its state.");
    }
  };
  const readCode = async () => {
    const current = view.current, id = account, mode = codeMode,
      lookupId = mode === "lookup" ? operationId : undefined;
    if (!current.active || !id || current.accountId !== id || current.codeBusy) return;
    const selection = current.selection, read = ++current.codeRead;
    current.codeBusy = true;
    const isCurrent = () => current.active && current.accountId === id &&
      current.selection === selection && current.codeRead === read;
    setCodeLoading(true);
    setCodeMessage("");
    try {
      const result = await readConnectionCode(id, mode, lookupId);
      if (!isCurrent()) return;
      const response = result.response;
      if (response.kind === "ACW1_METADATA_DATA") {
        const data = response.data;
        // Project display fields only. Do not retain/display/log a write ticket.
        setCodeMessage(`Server reports code status ${data.metadata.state}, revision ${data.metadata.codeRevision}. ` +
          ("receipt" in data ? `Reported operation outcome: ${data.receipt.outcome}. ` : "") +
          "This read does not create or replace a code or confirm an earlier request.");
      } else if (response.kind === "ACW1_ERROR_DATA" && response.status === 401) {
        setCodeMessage("Sign in to check connection-code information. Earlier request outcomes remain unknown.");
      } else {
        setCodeMessage("Connection-code information could not be confirmed. No action will be retried automatically.");
      }
    } catch {
      if (isCurrent()) setCodeMessage("Connection-code information could not be confirmed. No action will be retried automatically.");
    } finally {
      if (isCurrent()) {
        current.codeBusy = false;
        setCodeLoading(false);
      }
    }
  };
  return (
    <main>
      <h1>Devices</h1>
      <label>
        Account{" "}
        <select value={account} onChange={(e) => selectAccount(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName ?? `Account ${a.id.slice(0, 8)}`} {a.status}
            </option>
          ))}
        </select>
      </label>
      <button disabled={!account || loading} onClick={() => void load()}>
        Refresh devices
      </button>
      {loading && <p role="status">Loading devices…</p>}
      {error && <p role="alert">{error}</p>}
      <ul>
        {devices.map((d) => {
          const metadata = deviceClientMetadataDisplay(d.clientMetadata);
          return (
            <li key={d.id}>
              {d.label ?? "Unnamed device"} — {d.status}, {metadata.browser},
              extension {metadata.extension}; activated {d.activatedAt ?? "—"},
              last seen {d.lastSeenAt ?? "—"}{" "}
              {d.status === "ACTIVE" && (
                <button onClick={() => void revoke(d.id)}>Revoke</button>
              )}
            </li>
          );
        })}
      </ul>
      <section aria-label="Connection-code information">
        <h2>Connection-code information</h2>
        <p>Read information for the selected account. These controls do not create, replace or reveal a connection code.</p>
        <form onSubmit={(event) => { event.preventDefault(); void readCode(); }}>
          <label>
            Information{" "}
            <select value={codeMode} onChange={(event) => {
              clearCodeRead();
              setCodeMode(event.target.value as "issue" | "rotate" | "lookup");
            }}>
              <option value="issue">Before creating a code</option>
              <option value="rotate">Before replacing a code</option>
              <option value="lookup">Previous operation</option>
            </select>
          </label>
          {codeMode === "lookup" && <label>
            Operation ID{" "}
            <input value={operationId} onChange={(event) => {
              clearCodeRead();
              setOperationId(event.target.value);
            }} required />
          </label>}
          <button type="submit" disabled={!account || codeLoading || (codeMode === "lookup" && !operationId)}>
            Read information
          </button>
        </form>
        {codeLoading && <p role="status">Reading connection-code information…</p>}
        {codeMessage && <p role="status">{codeMessage}</p>}
      </section>
    </main>
  );
}

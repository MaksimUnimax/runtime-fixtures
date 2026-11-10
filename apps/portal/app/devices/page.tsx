"use client";
import { useEffect, useRef, useState } from "react";
import { controlPlane } from "../../lib/control-plane";
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
    view = useRef({ active: false, accountId: "", selection: 0, read: 0 });
  const selectAccount = (id: string) => {
    const current = view.current;
    if (!current.active || current.accountId === id) return;
    current.accountId = id;
    current.selection += 1;
    current.read += 1;
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
    </main>
  );
}

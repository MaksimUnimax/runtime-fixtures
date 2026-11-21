"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
type Selection = { accountId: string };
type Problem = "accounts" | "devices" | "revoke";
export default function Devices() {
  const [accounts, setAccounts] = useState<Account[]>([]),
    [account, setAccount] = useState(""),
    [devices, setDevices] = useState<Device[]>([]),
    [loading, setLoading] = useState(true),
    [revoking, setRevoking] = useState(false),
    [problem, setProblem] = useState<Problem>();
  const mounted = useRef(false),
    selection = useRef<Selection>({ accountId: "" }),
    loadSequence = useRef(0),
    loaded = useRef<{ selection: Selection; devices: Device[] } | null>(null),
    mutation = useRef<object | null>(null);

  const selectAccount = useCallback((id: string) => {
    // A new identity also fences an old A request after an A → B → A switch.
    selection.current = { accountId: id };
    loadSequence.current++;
    loaded.current = null;
    setAccount(id);
    setDevices([]);
    setProblem(undefined);
    setLoading(Boolean(id));
  }, []);

  const load = useCallback(async (id: string) => {
    const selected = selection.current;
    if (!id || selected.accountId !== id || !mounted.current) return;
    const sequence = ++loadSequence.current;
    const current = () =>
      mounted.current &&
      selection.current === selected &&
      loadSequence.current === sequence;
    loaded.current = null;
    setDevices([]);
    setProblem(undefined);
    setLoading(true);
    try {
      const response = await controlPlane(
        `/v1/devices?accountId=${encodeURIComponent(id)}`,
      );
      if (!current()) return;
      if (!response.ok) throw new Error("device list unavailable");
      const data = (await response.json()) as { devices: Device[] };
      if (!current()) return;
      if (!Array.isArray(data?.devices)) throw new Error("invalid device list");
      loaded.current = { selection: selected, devices: data.devices };
      setDevices(data.devices);
    } catch {
      if (current()) setProblem("devices");
    } finally {
      if (current()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const response = await controlPlane("/v1/accounts");
        if (cancelled) return;
        if (response.status === 401) {
          location.assign("/login?returnTo=%2Fdevices");
          return;
        }
        if (!response.ok) throw new Error("account list unavailable");
        const data = (await response.json()) as { accounts: Account[] };
        if (cancelled) return;
        if (!Array.isArray(data?.accounts))
          throw new Error("invalid account list");
        setAccounts(data.accounts);
        selectAccount(data.accounts[0]?.id ?? "");
      } catch {
        if (!cancelled) {
          setProblem("accounts");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      mounted.current = false;
      loaded.current = null;
      loadSequence.current++;
    };
  }, [selectAccount]);
  useEffect(() => {
    void load(account);
  }, [account, load]);

  const revoke = async (id: string) => {
    const selected = selection.current;
    if (
      selected.accountId !== account ||
      !mounted.current ||
      mutation.current ||
      loaded.current?.selection !== selected ||
      !loaded.current.devices.some((d) => d.id === id && d.status === "ACTIVE")
    )
      return;
    // Synchronous guard covers a second click before React renders disabled.
    const operation = {};
    mutation.current = operation;
    setRevoking(true);
    setProblem(undefined);
    const current = () =>
      mounted.current &&
      selection.current === selected &&
      mutation.current === operation;
    try {
      const response = await controlPlane(`/v1/devices/${id}/revoke`, {
        method: "POST",
      });
      if (!current()) return;
      if (!response.ok) {
        setProblem("revoke");
        return;
      }
      await load(account);
    } catch {
      if (current()) setProblem("revoke");
    } finally {
      if (mutation.current === operation) {
        mutation.current = null;
        if (mounted.current) setRevoking(false);
      }
    }
  };
  return (
    <main>
      <h1>Devices</h1>
      <label>
        Account{" "}
        <select
          value={account}
          disabled={accounts.length === 0}
          onChange={(e) => selectAccount(e.target.value)}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName ?? `Account ${a.id.slice(0, 8)}`} {a.status}
            </option>
          ))}
        </select>
      </label>
      {loading && <p role="status">Loading devices…</p>}
      {revoking && <p role="status">Device revocation is pending.</p>}
      {problem && (
        <div role="alert">
          <p>
            {problem === "accounts"
              ? "Could not load accounts. Reload the page to try again."
              : problem === "devices"
                ? "Could not load devices. Retry when the connection is available."
                : "Device revocation was not confirmed. Refresh the list to check its status."}
          </p>
          {problem === "accounts" ? (
            <button onClick={() => location.reload()}>Reload page</button>
          ) : (
            <button onClick={() => void load(account)}>
              {problem === "devices" ? "Retry" : "Refresh devices"}
            </button>
          )}
        </div>
      )}
      {!loading && !problem && !account && <p>No accounts available.</p>}
      {!loading && !problem && account && devices.length === 0 && (
        <p>No devices for this account.</p>
      )}
      <ul>
        {devices.map((d) => {
          const metadata = deviceClientMetadataDisplay(d.clientMetadata);
          return (
            <li key={d.id}>
              {d.label ?? "Unnamed device"} — {d.status}, {metadata.browser},
              extension {metadata.extension}; activated {d.activatedAt ?? "—"},
              last seen {d.lastSeenAt ?? "—"}{" "}
              {d.status === "ACTIVE" && (
                <button disabled={revoking} onClick={() => void revoke(d.id)}>
                  Revoke
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}

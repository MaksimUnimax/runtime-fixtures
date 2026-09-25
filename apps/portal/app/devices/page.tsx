"use client";
import { useEffect, useState } from "react";
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
    [devices, setDevices] = useState<Device[]>([]);
  const load = async (id = account) => {
    if (!id) return;
    const r = await controlPlane(`/v1/devices?accountId=${id}`);
    if (r.ok) setDevices((await r.json()).devices);
  };
  useEffect(() => {
    void controlPlane("/v1/accounts").then(async (r) => {
      if (!r.ok) {
        location.assign("/login?returnTo=%2Fdevices");
        return;
      }
      const a = (await r.json()).accounts;
      setAccounts(a);
      if (a[0]) setAccount(a[0].id);
    });
  }, []);
  useEffect(() => {
    void load();
  }, [account]);
  const revoke = async (id: string) => {
    await controlPlane(`/v1/devices/${id}/revoke`, { method: "POST" });
    await load();
  };
  return (
    <main>
      <h1>Devices</h1>
      <label>
        Account{" "}
        <select value={account} onChange={(e) => setAccount(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName ?? `Account ${a.id.slice(0, 8)}`} {a.status}
            </option>
          ))}
        </select>
      </label>
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

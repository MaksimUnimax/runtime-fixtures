"use client";
import { useEffect, useRef, useState } from "react";
import { controlPlane } from "../../lib/control-plane";

export default function Logout() {
  const [state, setState] = useState<
      "ready" | "pending" | "unconfirmed" | "done"
    >("ready"),
    lifecycle = useRef<{
      active: boolean;
      pending: boolean;
      confirmed: boolean;
    } | null>(null);

  useEffect(() => {
    const current = { active: true, pending: false, confirmed: false };
    lifecycle.current = current;
    setState("ready");
    return () => {
      current.active = false;
      if (lifecycle.current === current) lifecycle.current = null;
    };
  }, []);

  const logout = async () => {
    const current = lifecycle.current;
    if (!current?.active || current.pending || current.confirmed) return;
    const isCurrent = () => current.active && lifecycle.current === current;
    current.pending = true;
    setState("pending");
    try {
      const response = await controlPlane("/v1/auth/logout", { method: "POST" });
      if (!isCurrent()) return;
      if (response.status !== 204) {
        setState("unconfirmed");
        return;
      }
      current.confirmed = true;
      setState("done");
      // A full navigation also discards the portal's in-memory page state.
      location.replace("/login");
    } catch {
      if (isCurrent() && !current.confirmed) setState("unconfirmed");
    } finally {
      if (isCurrent()) current.pending = false;
    }
  };

  return (
    <main>
      <h1>Sign out of the portal</h1>
      <p>
        This signs out of the portal. It does not revoke devices or delete locally saved marketplace keys.
      </p>
      <button
        type="button"
        disabled={state === "pending" || state === "done"}
        onClick={() => void logout()}
      >
        {state === "pending"
          ? "Signing out…"
          : state === "unconfirmed"
            ? "Try sign out again"
            : "Sign out"}
      </button>
      {state === "unconfirmed" && (
        <p role="status">
          Sign out was not confirmed. The portal session may still be active.
          You can try again or reload this page.
        </p>
      )}
      {state === "done" && <p role="status">You are signed out of the portal.</p>}
      <p>
        <a href="/">Back to portal</a> · <a href="/login">Sign in</a>
      </p>
    </main>
  );
}

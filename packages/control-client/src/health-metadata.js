/* Read-only projection of an already acquired, signed Health envelope. */
(() => {
  "use strict";
  const client = globalThis.SellerAgentsControlClient;
  const verifier = globalThis.SellerAgentsBootstrapVerifier;
  const config = globalThis.SellerAgentsControlConfig;
  if (
    !client ||
    typeof client.acquireSignedHealthAuthority !== "function" ||
    typeof client.getHealthAuthorityContext !== "function" ||
    typeof client.getVerifiedAuthorityTime !== "function" ||
    !verifier?.verifyHealthV1
  )
    throw new Error("SIGNED_HEALTH_CLIENT_MISSING");
  function fail(code = "HEALTH_METADATA_INVALID") {
    return Object.assign(new Error(code), { code });
  }
  function freezeCopy(value) {
    const copy = JSON.parse(JSON.stringify(value));
    const freeze = (current) => {
      if (!current || typeof current !== "object" || Object.isFrozen(current))
        return current;
      for (const nested of Object.values(current)) freeze(nested);
      return Object.freeze(current);
    };
    return freeze(copy);
  }
  async function context(payload, authority) {
    if (
      payload?.contractVersion !== "control_plane_v2" ||
      payload?.ai?.status !== "RESOLVED" ||
      !payload.account?.id
    )
      return null;
    const bytes = (() => {
      try {
        const value = authority?.envelope?.payload;
        if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
        const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
        const decoded = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
        return btoa(String.fromCharCode(...decoded)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "") === value ? decoded : null;
      } catch (_) { return null; }
    })();
    if (!bytes) return null;
    const digest = bytes ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("") : null;
    if (!digest || !authority.deviceId || !authority.sessionId) return null;
    return {
      accountId: payload.account.id,
      deviceId: authority.deviceId,
      sessionId: authority.sessionId,
      contractVersion: payload.contractVersion,
      configVersion: payload.configVersion,
      bootstrapSnapshotSha256: digest,
      ai: {
        family: payload.ai.detected.family,
        surface: payload.ai.detected.surface,
        variant: payload.ai.detected.variant,
        profileKey: payload.ai.profile.profileKey,
        revision: payload.ai.profile.revision,
        scopeVariant: payload.ai.profile.scopeVariant,
        contentSha256: payload.ai.profile.contentSha256,
      },
    };
  }
  async function project(envelope, authority) {
    const verified = await verifier.verifyHealthV1(
      envelope,
      config.trustBundle,
    );
    if (!verified.ok) throw fail(`HEALTH_${verified.error}`);
    const payload = authority?.payload,
      expected = await context(payload, authority);
    if (
      verified.payload.status === "PASS" &&
      (!expected ||
        verifier.canonicalJson(expected) !==
          verifier.canonicalJson(verified.payload.context))
    )
      throw fail("HEALTH_CONTEXT_MISMATCH");
    const now = await client.getVerifiedAuthorityTime();
    const claimObserved = Date.parse(verified.payload.observedAt);
    const bootstrapExpires = Date.parse(payload?.expiresAt);
    const claimExpires =
      verified.payload.status === "PASS"
        ? Date.parse(verified.payload.expiresAt)
        : null;
    const current =
      verified.payload.status === "PASS" &&
      Number.isFinite(claimExpires) &&
      claimObserved <= now &&
      now < Math.min(claimExpires, bootstrapExpires);
    const result = {
      metadataVersion: "signed_health_metadata_v1",
      verified: true,
      current,
      status: verified.payload.status,
      target: verified.payload.target,
      observedAt: verified.payload.observedAt,
      executionAuthority: false,
    };
    if (verified.payload.status === "PASS") {
      result.expiresAt = verified.payload.expiresAt;
      result.context = verified.payload.context;
    } else result.reason = verified.payload.reason;
    return freezeCopy(result);
  }
  async function getVerifiedHealthMetadata(options = {}) {
    const acquired = await client.acquireSignedHealthAuthority(options);
    return project(acquired.envelope, await client.getHealthAuthorityContext());
  }
  async function readVerifiedHealthMetadata(envelope) {
    return project(envelope, await client.getHealthAuthorityContext());
  }
  globalThis.SellerAgentsControlClient = Object.freeze({
    ...client,
    getVerifiedHealthMetadata,
    readVerifiedHealthMetadata,
  });
})();

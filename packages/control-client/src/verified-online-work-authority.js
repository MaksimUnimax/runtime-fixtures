/* Passive verified-Health adapter for the pure online Work authority. It
 * consumes an already acquired envelope and never acquires Health itself. */
(() => {
  "use strict";

  const client = globalThis.SellerAgentsControlClient;
  const core = globalThis.SellerAgentsOnlineWorkAuthority;
  if (!client || typeof client.readVerifiedHealthMetadata !== "function" || !core || typeof core.evaluate !== "function")
    throw new Error("VERIFIED_ONLINE_WORK_AUTHORITY_MISSING");

  function plainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function deniedHealth() {
    return { status: "UNAVAILABLE", current: false, verified: false };
  }

  function trustedHealth(metadata) {
    return Boolean(
      metadata &&
      metadata.verified === true &&
      metadata.current === true &&
      metadata.status === "PASS" &&
      metadata.target === "WORK" &&
      metadata.executionAuthority === false,
    );
  }

  function sameHealthContext(value, context) {
    const account = value.account;
    const session = value.session;
    const compatibility = value.compatibility;
    const bootstrap = value.bootstrap;
    const ai = value.ai;
    const profile = ai?.profile;
    const expected = context?.ai;
    return plainObject(context) &&
      plainObject(account) && plainObject(session) && plainObject(compatibility) && plainObject(bootstrap) &&
      plainObject(ai) && plainObject(profile) && plainObject(expected) &&
      account.accountId === context.accountId &&
      session.generation === value.currentAuthorityGeneration &&
      session.deviceId === context.deviceId &&
      session.sessionId === context.sessionId &&
      compatibility.contractVersion === context.contractVersion &&
      bootstrap.accountId === context.accountId &&
      bootstrap.generation === session.generation &&
      bootstrap.deviceId === context.deviceId &&
      bootstrap.sessionId === context.sessionId &&
      bootstrap.contractVersion === context.contractVersion &&
      bootstrap.configVersion === context.configVersion &&
      bootstrap.bootstrapSnapshotSha256 === context.bootstrapSnapshotSha256 &&
      bootstrap.aiProvider === expected.family &&
      ai.provider === expected.family &&
      profile.provider === expected.family &&
      ai.surface === expected.surface &&
      ai.variant === expected.variant &&
      profile.profileKey === expected.profileKey &&
      profile.revision === expected.revision &&
      profile.scopeVariant === expected.scopeVariant &&
      profile.contentSha256 === expected.contentSha256 &&
      value.capabilityIntersection?.configVersion === context.configVersion;
  }

  async function evaluate(input, healthEnvelope) {
    const value = plainObject(input) ? input : {};
    let health = deniedHealth();
    if (plainObject(healthEnvelope)) {
      try {
        const metadata = await client.readVerifiedHealthMetadata(healthEnvelope);
        const currentAuthorityGeneration = typeof client.generation === "function" ? await client.generation() : null;
        if (trustedHealth(metadata) && sameHealthContext({ ...value, currentAuthorityGeneration }, metadata.context)) health = { status: "PASS", current: true, verified: true };
      } catch (_) {
        // Verification, context, freshness, and time failures are denials.
      }
    }
    return core.evaluate({ ...value, health });
  }

  const api = Object.freeze({ evaluate });
  Object.defineProperty(globalThis, "SellerAgentsVerifiedOnlineWorkAuthority", {
    value: api,
    writable: false,
    configurable: false,
    enumerable: true,
  });
})();

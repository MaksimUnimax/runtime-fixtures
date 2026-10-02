import {
  STORE1_BOOTSTRAP_PATH,
  type Store1V2SignaturePreflightTransport,
} from "./store1-v2-signature-preflight.js";

type WorkerHandle = {
  evaluate(expression: string, argument: unknown): Promise<unknown>;
};
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invoke = String.raw`async (input) => {
  const client = globalThis.SellerAgentsControlClient;
  if (typeof client?.acquireBootstrapPreflight !== "function")
    throw new Error("STORE1_INSTALLED_PREFLIGHT_UNAVAILABLE");
  return client.acquireBootstrapPreflight(input);
}`;

/**
 * Compose with planStore1ActivationWithVerifiedPreflight. The caller must bind
 * this handle to the already-authorized exact installed candidate. No profile
 * discovery, activation, credential export, authority creation or HTTP fallback.
 * Admin config reads keep their existing independent authorization.
 */
export function createStore1InstalledClientTransport(input: {
  controlApiOrigin: string;
  expectedAccountId: string;
  worker: WorkerHandle;
  readLatestConfig: Store1V2SignaturePreflightTransport["readLatestConfig"];
}): Store1V2SignaturePreflightTransport {
  const { controlApiOrigin, expectedAccountId, worker, readLatestConfig } =
    input;
  let origin: URL;
  try {
    origin = new URL(controlApiOrigin);
  } catch {
    throw new Error("STORE1_INSTALLED_ORIGIN_INVALID");
  }
  if (
    origin.protocol !== "https:" ||
    origin.origin !== controlApiOrigin ||
    !UUID.test(expectedAccountId)
  )
    throw new Error("STORE1_INSTALLED_CONTEXT_INVALID");
  return {
    readLatestConfig,
    async issueBootstrap(path, requestInput) {
      const request = structuredClone(requestInput);
      if (path !== STORE1_BOOTSTRAP_PATH)
        throw new Error("STORE1_BOOTSTRAP_PATH_INVALID");
      let value: unknown;
      try {
        value = await worker.evaluate(invoke, {
          expectedAccountId: expectedAccountId,
          request,
        });
      } catch {
        // Browser errors may include privileged script/transport details.
        throw new Error("STORE1_INSTALLED_PREFLIGHT_FAILED");
      }
      if (
        !record(value) ||
        !record(value.envelope) ||
        !record(value.authenticatedContext) ||
        Object.keys(value).sort().join(",") !== "authenticatedContext,envelope"
      )
        throw new Error("STORE1_INSTALLED_PREFLIGHT_RESPONSE_INVALID");
      const context = value.authenticatedContext;
      if (
        Object.keys(context).sort().join(",") !==
          "accountId,browserFamily,browserVersion,controlApiOrigin,deviceId" ||
        context.accountId !== expectedAccountId ||
        context.deviceId !== request.deviceId ||
        context.browserFamily !== request.browser.family ||
        context.browserVersion !== request.browser.version ||
        context.controlApiOrigin !== controlApiOrigin
      )
        throw new Error("STORE1_INSTALLED_PREFLIGHT_CONTEXT_MISMATCH");
      // This transport does not brand a proof or report readiness. The existing
      // packaged verifier must still check signature, current config and expiry.
      return {
        envelope: value.envelope,
        authenticatedContext: {
          accountId: expectedAccountId,
          deviceId: request.deviceId,
          browserFamily: request.browser.family,
          browserVersion: request.browser.version,
          controlApiOrigin: controlApiOrigin,
        },
      };
    },
  };
}

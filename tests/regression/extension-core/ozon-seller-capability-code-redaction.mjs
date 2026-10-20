import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

// A04 Seller capability code privacy: direct source and composed ZIP use the
// same real first-party contract, credentials and transport, with inert HTTP.
const root = path.resolve(process.argv[4] || process.cwd());
const providerPath = path.resolve(process.argv[2] || path.join(root, "packages/marketplaces/ozon/src/provider-runtime.js"));
const transportPath = path.resolve(process.argv[3] || path.join(root, "apps/extension/src/imported/ozon-v0.1.22/shared/provider_transport_core.js"));
const contractPath = path.join(root, "apps/extension/src/imported/ozon-v0.1.22/shared/ozon_contract.js");
const credentialsPath = path.join(root, "apps/extension/src/imported/ozon-v0.1.22/shared/ozon_credentials.js");
const marker = "INERTPRIVATE1234";
const sensitiveMessage = "INERT_PRIVATE_ERROR_MESSAGE_NOT_FOR_REPORT";
const commandSource = '({operation:"inert_roles",params:{}})';

function fixture(mode) {
  const context = vm.createContext({ TextDecoder, TextEncoder, Response, Date });
  context.OzonEntitlements = {
    requirementFor: () => ({
      known: true, required: true, allowed_subscription_types: ["PREMIUM"],
      reasons: ["INERT_PREMIUM_REQUIRED"],
    }),
    humanTierList: () => "PREMIUM",
  };
  vm.runInContext(readFileSync(contractPath, "utf8"), context, { filename: "ozon-contract.js" });
  const operations = vm.runInContext(
    '({inert_roles:{effect:"READ",method:"POST",path:"/v1/roles",provider:"seller_api",execution_enabled:false,response_style:"json"}})',
    context,
  );
  const contract = context.OzonContractFactory.createOzonContract({ operations });
  context.OzonContract = contract;
  vm.runInContext(readFileSync(credentialsPath, "utf8"), context, { filename: "ozon-credentials.js" });
  if ([
    "unknown_validator", "mutating_validator", "throwing_validator",
    "invalid_status_validator", "throwing_status_validator",
  ].includes(mode)) {
    const credentials = context.OzonCredentials;
    context.OzonCredentials = {
      ...credentials,
      normalizeSellerCredentials: () => {
        const error = new Error(sensitiveMessage);
        if (mode === "mutating_validator") {
          Object.defineProperty(error, "code", { get() {
            calls.codeReads++;
            return calls.codeReads === 1 ? "MISSING_API_KEY" : marker;
          } });
        } else if (mode === "throwing_validator") {
          Object.defineProperty(error, "code", { get() {
            calls.codeReads++;
            throw new Error(sensitiveMessage);
          } });
        } else if (mode === "invalid_status_validator") {
          error.code = "PROVIDER_FETCH_FAILED";
          Object.defineProperty(error, "http_status", { get() {
            calls.statusReads++;
            return 700;
          } });
        } else if (mode === "throwing_status_validator") {
          error.code = "PROVIDER_FETCH_FAILED";
          Object.defineProperty(error, "http_status", { get() {
            calls.statusReads++;
            throw new Error(sensitiveMessage);
          } });
        } else {
          error.code = marker;
        }
        throw error;
      },
    };
  }
  vm.runInContext(readFileSync(transportPath, "utf8"), context, { filename: "ozon-transport.js" });
  vm.runInContext(readFileSync(providerPath, "utf8"), context, { filename: "ozon-provider.js" });
  const calls = { fetch: 0, codeReads: 0, statusReads: 0 };
  const provider = context.OzonProviderFactory.createOzonProvider({
    contract,
    now: () => 1000,
    uuid: () => "INERT_REQUEST_ONLY",
    fetchImpl: async () => {
      calls.fetch++;
      if (mode === "network") throw new Error(sensitiveMessage);
      if (mode === "http_error") {
        return new Response(JSON.stringify({ code: marker, message: sensitiveMessage }), {
          status: 403, headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ subscription: { type: "PREMIUM", is_premium: true } }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    },
  });
  return { context, contract, provider, calls };
}

async function check(mode, expected) {
  const f = fixture(mode);
  const credentials = mode === "missing_api_key"
    ? { clientId: "INERT_LOCAL_ID" }
    : { clientId: "INERT_LOCAL_ID", apiKey: "INERT_LOCAL_KEY" };
  const profile = await f.provider.resolveSellerCapability(credentials);
  assert.equal(profile.probe_error_code, expected.code, mode + ": public code");
  assert.equal(profile.status, expected.status, mode + ": capability");
  assert.equal(f.calls.fetch, expected.fetch, mode + ": actual fetch callback count");
  assert.equal(profile.probe_http_status, expected.http, mode + ": status");
  assert.equal(f.calls.codeReads, expected.codeReads || 0, mode + ": code getter read once");
  assert.equal(f.calls.statusReads, expected.statusReads || 0, mode + ": status getter read once");
  const command = vm.runInContext(commandSource, f.context);
  const plan = f.contract.planCommandForSellerCapability(command, profile, 0, {});
  assert.equal(plan.action, expected.action, mode + ": fail-closed entitlement");
  const requestMeta = vm.runInContext(
    '({host_alias:"seller_api",http_method:"POST",path_alias:"inert_roles",external_request_executed:false})',
    f.context,
  );
  // Use the *actual* plan/error, not a fixed report payload: the public
  // planning.capability fields must carry exactly the sanitized probe code.
  const result = vm.runInContext("({})", f.context);
  if (plan.action === "reject") result.error = plan.error;
  else result.result = { inert_planning_only: true };
  const report = f.contract.formatResultReport({
    requestId: "INERT_REQUEST_ONLY", command, requestMeta,
    httpStatus: 0, result, elapsedMs: 0, planning: plan.planning,
  });
  const reportPayload = JSON.parse(report.slice(report.indexOf("\n") + 1));
  assert.equal(
    reportPayload.planning?.capability?.probe_error_code,
    profile.probe_error_code,
    mode + ": actual profile diagnostic flows into public report planning",
  );
  if (plan.action === "reject")
    assert.equal(reportPayload.result.error.code, plan.error.code);
  const publicSurface = JSON.stringify(profile) + report;
  assert.equal(publicSurface.includes(marker), false, mode + ": no unknown error code");
  assert.equal(publicSurface.includes(sensitiveMessage), false, mode + ": no raw message");
  assert.equal(publicSurface.includes("INERT_LOCAL_KEY"), false, mode + ": no credentials");
}

await check("unknown_validator", {
  code: "SELLER_CAPABILITY_PROBE_FAILED", status: "unknown", fetch: 0,
  http: 0, action: "reject",
});
await check("http_error", {
  code: "SELLER_CAPABILITY_PROBE_HTTP_ERROR", status: "unknown", fetch: 1,
  http: 403, action: "reject",
});
await check("missing_api_key", {
  code: "MISSING_API_KEY", status: "unknown", fetch: 0,
  http: 0, action: "reject",
});
await check("network", {
  code: "PROVIDER_FETCH_FAILED", status: "unknown", fetch: 1,
  http: 0, action: "reject",
});
await check("success", {
  code: null, status: "known", fetch: 1, http: 200, action: "execute",
});
await check("mutating_validator", {
  code: "MISSING_API_KEY", status: "unknown", fetch: 0,
  http: 0, action: "reject", codeReads: 1,
});
await check("throwing_validator", {
  code: "SELLER_CAPABILITY_PROBE_FAILED", status: "unknown", fetch: 0,
  http: 0, action: "reject", codeReads: 1,
});
await check("invalid_status_validator", {
  code: "PROVIDER_FETCH_FAILED", status: "unknown", fetch: 0,
  http: 0, action: "reject", statusReads: 1,
});
await check("throwing_status_validator", {
  code: "PROVIDER_FETCH_FAILED", status: "unknown", fetch: 0,
  http: 0, action: "reject", statusReads: 1,
});
console.log("OZON_SELLER_CAPABILITY_PUBLIC_CODES_9_CASES_PASS");

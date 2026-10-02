import { describe, expect, it } from "vitest";
import { createContext, runInContext } from "node:vm";
import { createStore1InstalledClientTransport } from "./store1-installed-client-transport.js";
import {
  buildStore1V2BootstrapPreflightRequest,
  STORE1_BOOTSTRAP_PATH,
  STORE1_V2_CONFIG_READ_PATH,
} from "./store1-v2-signature-preflight.js";

const account = "11111111-1111-4111-8111-111111111111";
const device = "22222222-2222-4222-8222-222222222222";
const origin = "https://control.example.test";
const request = buildStore1V2BootstrapPreflightRequest(device, "136.0.0.0");
type FixtureValue = {
  envelope: Record<string, unknown>;
  authenticatedContext: Record<string, string>;
  accessToken?: string;
};
function setup(change?: (value: FixtureValue) => void) {
  const calls: unknown[] = [];
  const value: FixtureValue = {
    envelope: { envelopeVersion: "bootstrap_envelope_v2" },
    authenticatedContext: {
      accountId: account,
      deviceId: device,
      browserFamily: request.browser.family,
      browserVersion: request.browser.version,
      controlApiOrigin: origin,
    },
  };
  change?.(value);
  const box = createContext({
    SellerAgentsControlClient: {
      acquireBootstrapPreflight: async (input: unknown) => {
        calls.push(input);
        return value;
      },
    },
  });
  const transport = createStore1InstalledClientTransport({
    controlApiOrigin: origin,
    expectedAccountId: account,
    worker: {
      evaluate: async (expression, input) =>
        runInContext(expression, box)(input),
    },
    readLatestConfig: async (path) => {
      calls.push(path);
      return null;
    },
  });
  return { transport, calls, value };
}
describe("installed-client release transport", () => {
  it("calls the existing installed client and preserves separate admin config read", async () => {
    const f = setup();
    await expect(
      f.transport.readLatestConfig(STORE1_V2_CONFIG_READ_PATH),
    ).resolves.toBeNull();
    const result = await f.transport.issueBootstrap(
      STORE1_BOOTSTRAP_PATH,
      request,
    );
    expect(f.calls).toEqual([
      STORE1_V2_CONFIG_READ_PATH,
      { expectedAccountId: account, request },
    ]);
    expect(result).toEqual(f.value);
    expect(result).not.toHaveProperty("verified");
  });
  it.each([
    "accountId",
    "deviceId",
    "browserFamily",
    "browserVersion",
    "controlApiOrigin",
  ])("rejects mismatched %s", async (key) => {
    const f = setup((value) => {
      value.authenticatedContext[key] = "wrong";
    });
    await expect(
      f.transport.issueBootstrap(STORE1_BOOTSTRAP_PATH, request),
    ).rejects.toThrow("STORE1_INSTALLED_PREFLIGHT_CONTEXT_MISMATCH");
  });
  it("rejects unexpected credential fields rather than forwarding them", async () => {
    const f = setup((value) => {
      value.accessToken = "must-not-escape";
    });
    await expect(
      f.transport.issueBootstrap(STORE1_BOOTSTRAP_PATH, request),
    ).rejects.toThrow("STORE1_INSTALLED_PREFLIGHT_RESPONSE_INVALID");
  });
  it("has no token-file or registration fallback when installed API is absent", async () => {
    let evaluated = 0;
    const transport = createStore1InstalledClientTransport({
      controlApiOrigin: origin,
      expectedAccountId: account,
      worker: {
        evaluate: async (expression) => {
          evaluated++;
          return runInContext(expression, createContext({}))({});
        },
      },
      readLatestConfig: async () => null,
    });
    await expect(
      transport.issueBootstrap(STORE1_BOOTSTRAP_PATH, request),
    ).rejects.toThrow("STORE1_INSTALLED_PREFLIGHT_FAILED");
    expect(evaluated).toBe(1);
  });
  it("redacts worker exceptions", async () => {
    const transport = createStore1InstalledClientTransport({
      controlApiOrigin: origin,
      expectedAccountId: account,
      worker: {
        evaluate: async () => {
          throw new Error("secret-session-value");
        },
      },
      readLatestConfig: async () => null,
    });
    await expect(
      transport.issueBootstrap(STORE1_BOOTSTRAP_PATH, request),
    ).rejects.toThrow(/^STORE1_INSTALLED_PREFLIGHT_FAILED$/);
  });
  it.each([
    "http://control.example.test",
    "https://control.example.test/path",
    "https://u:p@control.example.test",
  ])("rejects unsafe origin %s", (controlApiOrigin) => {
    expect(() =>
      createStore1InstalledClientTransport({
        controlApiOrigin,
        expectedAccountId: account,
        worker: { evaluate: async () => null },
        readLatestConfig: async () => null,
      }),
    ).toThrow();
  });
});

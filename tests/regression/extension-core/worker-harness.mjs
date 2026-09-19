import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const AUTH_STORAGE_KEY = "seller_agents_control_auth_v2";
function canonical(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}
const b64url = (value) => Buffer.from(value).toString("base64url");

export async function signFixtureBootstrap(
  backing,
  payload,
  keyId = backing.local?.[AUTH_STORAGE_KEY]?.authority?.envelope?.keyId ||
    "fixture-key",
) {
  const stored = backing.local.__seller_agents_fixture_signing_key;
  assert.ok(stored, "fixture signing key is worker-local backing state");
  const privateKey = await webcrypto.subtle.importKey(
    "pkcs8",
    Buffer.from(stored.privateKey, "base64"),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const payloadBytes = new TextEncoder().encode(canonical(payload));
  const domain = new Uint8Array([
    ...new TextEncoder().encode("product-control-plane/bootstrap-snapshot/v1"),
    0,
    ...new TextEncoder().encode(keyId),
    0,
  ]);
  const signed = new Uint8Array(domain.length + payloadBytes.length);
  signed.set(domain);
  signed.set(payloadBytes, domain.length);
  const signature = await webcrypto.subtle.sign("Ed25519", privateKey, signed);
  return {
    envelopeVersion: "bootstrap_envelope_v2",
    algorithm: "Ed25519",
    keyId,
    payload: b64url(payloadBytes),
    signature: b64url(Buffer.from(signature)),
  };
}

export async function until(fn, description) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("Timed out: " + description);
}
export async function makeWorker(directory, options = {}) {
  const network = [],
    controlNetwork = [],
    messages = [],
    listeners = [],
    connectListeners = [],
    storageChangedListeners = [],
    timers = new Set();
  const backing = options.backing || { local: {}, session: {} };
  const wallClock = () =>
    typeof options.wallClock === "function"
      ? options.wallClock()
      : (options.wallClock ?? Date.now());
  const monotonicClock = () =>
    typeof options.monotonicClock === "function"
      ? options.monotonicClock()
      : (options.monotonicClock ??
        (typeof performance === "object" &&
        typeof performance.now === "function"
          ? performance.now()
          : 0));
  const accountId = options.accountId || "11111111-1111-4111-8111-111111111111";
  const deviceId = options.deviceId || "22222222-2222-4222-8222-222222222222";
  const sessionId = options.sessionId || "33333333-3333-4333-8333-333333333333";
  const fixtureKey = backing.local.__seller_agents_fixture_signing_key;
  const useFixtureSigningKey = options.fixtureSigningKey !== false;
  let signing;
  if (fixtureKey && useFixtureSigningKey) {
    signing = {
      privateKey: await webcrypto.subtle.importKey(
        "pkcs8",
        Buffer.from(fixtureKey.privateKey, "base64"),
        { name: "Ed25519" },
        false,
        ["sign"],
      ),
      publicKey: await webcrypto.subtle.importKey(
        "spki",
        Buffer.from(fixtureKey.publicKey, "base64"),
        { name: "Ed25519" },
        false,
        ["verify"],
      ),
    };
  } else if (useFixtureSigningKey) {
    signing = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ]);
    backing.local.__seller_agents_fixture_signing_key = {
      privateKey: Buffer.from(
        await webcrypto.subtle.exportKey("pkcs8", signing.privateKey),
      ).toString("base64"),
      publicKey: Buffer.from(
        await webcrypto.subtle.exportKey("spki", signing.publicKey),
      ).toString("base64"),
    };
  }
  const configuredPublicKey =
    options.packagedConfig?.trustBundle?.keys?.[0]?.publicKey;
  const spki =
    fixtureKey && useFixtureSigningKey
      ? new Uint8Array(Buffer.from(fixtureKey.publicKey, "base64"))
      : configuredPublicKey
        ? new Uint8Array(Buffer.from(configuredPublicKey, "base64"))
        : signing
          ? new Uint8Array(
              await webcrypto.subtle.exportKey("spki", signing.publicKey),
            )
          : null;
  if (!spki) throw new Error("fixture signing public key unavailable");
  const fingerprint = Buffer.from(
    await webcrypto.subtle.digest("SHA-256", spki),
  ).toString("hex");
  const defaultKeyId = "fixture-key";
  const fixtureConfig = options.packagedConfig || {
    environment: "LOCAL DEVELOPMENT",
    controlApiOrigin: "http://127.0.0.1:43100",
    portalOrigin: "http://127.0.0.1:43101",
    extensionVersion: "0.2.4",
    contractVersion: "control_plane_v2",
    trustBundle: {
      trustBundleVersion: "bootstrap_trust_bundle_v1",
      algorithm: "Ed25519",
      publicKeyFormat: "spki_der",
      publicKeyEncoding: "base64",
      fingerprintAlgorithm: "sha256",
      fingerprintEncoding: "lowercase_hex",
      keys: [
        {
          keyId: defaultKeyId,
          publicKey: Buffer.from(spki).toString("base64"),
          fingerprintSha256: fingerprint,
          lifecycle: "ACTIVE",
          trustEligibility: "SIGNING_AND_VERIFICATION",
        },
      ],
    },
  };
  const keyId = fixtureConfig.trustBundle.keys[0]?.keyId || defaultKeyId;
  if (options.seedAuthority !== false && !backing.local[AUTH_STORAGE_KEY]) {
    if (!signing) throw new Error("seedAuthority requires fixture signing key");
    const issued = new Date(wallClock() - 1000).toISOString();
    const serverTime = new Date(wallClock()).toISOString();
    const expires = new Date(wallClock() + 3600000).toISOString();
    const grace = new Date(wallClock() + 7200000).toISOString();
    const content = {
      schemaVersion: "adapter_profile_v1",
      page: {
        identityStrategy: "page_identity",
        conversationStrategy: "conversation_root",
        composerStrategy: "composer_root",
      },
      selectors: {
        conversation: {
          strategy: "conversation_root",
          primary: {
            kind: "packaged_selector_reference",
            reference: "conversation-root",
          },
          fallbacks: [],
          timeoutMs: 1000,
          observationMode: "polling",
        },
        composer: {
          strategy: "composer_root",
          primary: {
            kind: "packaged_selector_reference",
            reference: "composer-root",
          },
          fallbacks: [],
          timeoutMs: 1000,
          observationMode: "polling",
        },
        send: {
          strategy: "send_control",
          primary: {
            kind: "packaged_selector_reference",
            reference: "send-control",
          },
          fallbacks: [],
          timeoutMs: 1000,
          observationMode: "polling",
        },
        assistantResponse: {
          strategy: "assistant_response",
          primary: {
            kind: "packaged_selector_reference",
            reference: "assistant-response",
          },
          fallbacks: [],
          timeoutMs: 1000,
          observationMode: "polling",
        },
      },
      observation: { mode: "polling", intervalMs: 100 },
      contours: [
        {
          key: "page_identity",
          required: true,
          expectedState: "PRESENT",
          strategy: "page_identity",
        },
        {
          key: "conversation_root",
          required: true,
          expectedState: "PRESENT",
          strategy: "conversation_root",
        },
        {
          key: "composer_root",
          required: true,
          expectedState: "INTERACTIVE",
          strategy: "composer_root",
        },
        {
          key: "send_control",
          required: true,
          expectedState: "INTERACTIVE",
          strategy: "send_control",
        },
      ],
    };
    const compatibility = {
      schemaVersion: "profile_compatibility_v1",
      contractVersion: "control_plane_v1",
      browserFamilies: ["chrome"],
      minimumBrowserVersions: [],
      minimumExtensionVersion: null,
    };
    const contentSha256 = Buffer.from(
      await webcrypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical({ content, compatibility })),
      ),
    ).toString("hex");
    const payload = {
      snapshotVersion: "bootstrap_snapshot_v2",
      contractVersion: "control_plane_v2",
      configVersion: 1,
      issuedAt: issued,
      expiresAt: expires,
      offlineGraceUntil: grace,
      serverTime,
      accessBasis: "BETA",
      account: { id: accountId, status: "ACTIVE" },
      subscription: { state: "NONE", planRevision: null },
      devicePolicy: { status: "ACTIVE" },
      compatibility: {
        extension: { status: "SUPPORTED", minimumVersion: null },
        browser: { status: "SUPPORTED" },
      },
      entitlements: {
        "source.ozon": true,
        "source.wildberries": true,
        "ai.chatgpt": true,
        "ai.alice": true,
      },
      features: {},
      ai: {
        status: "RESOLVED",
        detected: { family: "chatgpt", surface: "web", variant: null },
        profile: {
          profileKey: "fixture-profile",
          revision: 1,
          scopeVariant: null,
          schemaVersion: "adapter_profile_v1",
          contentSha256,
          content,
          compatibility,
        },
      },
    };
    const payloadBytes = new TextEncoder().encode(canonical(payload));
    const domain = new Uint8Array([
      ...new TextEncoder().encode(
        "product-control-plane/bootstrap-snapshot/v1",
      ),
      0,
      ...new TextEncoder().encode(keyId),
      0,
    ]);
    const signed = new Uint8Array(domain.length + payloadBytes.length);
    signed.set(domain);
    signed.set(payloadBytes, domain.length);
    const signature = await webcrypto.subtle.sign(
      "Ed25519",
      signing.privateKey,
      signed,
    );
    const trustBundleSha256 = Buffer.from(
      await webcrypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical(fixtureConfig.trustBundle)),
      ),
    ).toString("hex");
    const cacheBinding = {
      cacheVersion: "control_cache_binding_v1",
      controlApiOrigin: fixtureConfig.controlApiOrigin,
      portalOrigin: fixtureConfig.portalOrigin,
      contractVersion: fixtureConfig.contractVersion,
      extensionVersion: fixtureConfig.extensionVersion,
      browser: {
        family: String(options.userAgent || "")
          .toLowerCase()
          .includes("yabrowser")
          ? "yandex_chromium"
          : "chrome",
        version: (String(options.userAgent || "").match(
          /(?:Chrome|YaBrowser)\/(\d+(?:\.\d+){0,3})/i,
        ) || [null, "0.0.0"])[1],
      },
      detectedAi: { family: "chatgpt", surface: "web", variant: null },
      trustBundleSha256,
    };
    const cacheClock = {
      cacheVersion: "control_cache_clock_v1",
      owner: {
        controlApiOrigin: fixtureConfig.controlApiOrigin,
        portalOrigin: fixtureConfig.portalOrigin,
        contractVersion: fixtureConfig.contractVersion,
        deviceId,
        sessionId,
      },
      trustedServerTimeMs: Date.parse(serverTime),
      effectiveTimeMs: Date.parse(serverTime),
    };
    backing.local[AUTH_STORAGE_KEY] = {
      generation: 1,
      credentials: {
        deviceId,
        sessionId,
        tokenType: "Bearer",
        accessToken: "fixture_access_token",
        accessTokenExpiresAt: expires,
        refreshToken: "A".repeat(43),
        refreshTokenExpiresAt: grace,
      },
      pending: null,
      rotation: null,
      authority: {
        verified: true,
        workAllowed: true,
        requestedAi: "chatgpt",
        generation: 1,
        payload,
        envelope: {
          envelopeVersion: "bootstrap_envelope_v2",
          algorithm: "Ed25519",
          keyId,
          payload: b64url(payloadBytes),
          signature: b64url(signature),
        },
        deviceId,
        sessionId,
        cacheBinding,
      },
      cacheClock,
      lastError: null,
    };
  }
  let context,
    request,
    promptOutcome = options.promptOutcome ?? "sent";
  const identity = {
    origin: "https://chatgpt.com",
    ai_id: "chatgpt",
    conversation_id: "core-fixture-dialogue",
    status: "confirmed",
  };
  const tabId = 77;
  const clone = (value) =>
    value === undefined
      ? undefined
      : vm.runInContext("JSON.parse", context)(JSON.stringify(value));
  function area(kind) {
    return {
      async get(keys) {
        options.onStorageRead?.(kind, keys);
        const data = backing[kind];
        if (keys == null) return clone(data);
        if (typeof keys === "string") return clone({ [keys]: data[keys] });
        if (Array.isArray(keys))
          return clone(Object.fromEntries(keys.map((key) => [key, data[key]])));
        return clone(
          Object.fromEntries(
            Object.entries(keys).map(([key, fallback]) => [
              key,
              data[key] ?? fallback,
            ]),
          ),
        );
      },
      async set(values) {
        await options.onStorageWrite?.(kind, values);
        Object.assign(backing[kind], structuredClone(values));
      },
      async remove(keys) {
        await options.onStorageRemove?.(kind, keys);
        for (const key of Array.isArray(keys) ? keys : [keys])
          delete backing[kind][key];
      },
    };
  }
  const tab = {
    id: tabId,
    url: identity.origin + "/c/" + identity.conversation_id,
  };
  const portalTabs = [];
  const tabs = new Map([[tabId, tab]]);
  const identities = new Map([[tabId, identity]]);
  const chrome = {
    storage: {
      local: area("local"),
      session: area("session"),
      onChanged: {
        addListener(fn) {
          if (typeof fn === "function") storageChangedListeners.push(fn);
        },
      },
    },
    runtime: {
      lastError: null,
      getURL: (name) => "chrome-extension://core-fixture/" + name,
      onMessage: {
        addListener(fn) {
          listeners.push(fn);
        },
      },
      onConnect: {
        addListener(fn) {
          connectListeners.push(fn);
        },
      },
    },
    tabs: {
      async create(value) {
        portalTabs.push({ ...value });
        return { id: 1000 + portalTabs.length, ...value };
      },
      async get(id) {
        return tabs.get(id) || null;
      },
      async query() {
        return [];
      },
      async reload() {},
      onRemoved: { addListener() {} },
      sendMessage(id, message, callback) {
        messages.push(structuredClone(message));
        if (message.type === "OZ_WORK_SEND_INITIAL_PROMPT") {
          void (async () => {
            const fields = {
              intent_id: message.intent_id,
              revision: message.revision,
              identity: identities.get(id),
              actor_id: "fixture-actor",
              runtime_generation: "fixture-content",
            };
            const committed = await request(
              {
                type: "OZ_WORK_START_COMMIT_REQUEST",
                ...fields,
              },
              { tab: tabs.get(id) },
            );
            assert.equal(committed.click_allowed, true);
            const ack = await request(
              {
                type: "OZ_WORK_START_SEND_OUTCOME",
                ...fields,
                click_event_observed: true,
                composer_empty: promptOutcome === "sent",
                assistant_baseline_ids: ["existing-assistant-turn"],
              },
              { tab: tabs.get(id) },
            );
            assert.equal(ack.ok, true);
            callback({
              ok: true,
              sent: promptOutcome === "sent",
              intent_id: message.intent_id,
              revision: message.revision,
            });
          })().catch((error) => {
            callback({ ok: false, error: error.message });
          });
          return;
        }
        const response =
          message.type === "OZ_GET_IDENTITY"
            ? { ok: true, identity: identities.get(id) }
            : {
                ok: true,
                applied: true,
                received: true,
                adapter_id: "chatgpt",
              };
        queueMicrotask(() => callback?.(response));
      },
    },
    alarms: {
      create() {},
      async clear() {
        return true;
      },
      onAlarm: { addListener() {} },
    },
    downloads: {
      async download() {
        return 1;
      },
    },
  };
  const sandbox = {
    console,
    chrome,
    crypto: options.beforeCryptoVerify
      ? {
          ...webcrypto,
          randomUUID: webcrypto.randomUUID.bind(webcrypto),
          getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
          subtle: new Proxy(webcrypto.subtle, {
            get(target, property) {
              const method = Reflect.get(target, property, target);
              if (property === "verify")
                return (...args) =>
                  Promise.resolve(options.beforeCryptoVerify(...args)).then(
                    () => Reflect.apply(method, target, args),
                  );
              return typeof method === "function"
                ? method.bind(target)
                : method;
            },
          }),
        }
      : webcrypto,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    Response,
    Request,
    Headers,
    AbortController,
    Blob,
    navigator: { userAgent: options.userAgent || "" },
    performance: { now: monotonicClock },
    indexedDB: options.indexedDB,
    __SELLER_AGENTS_PACKAGED_CONFIG__: JSON.stringify(fixtureConfig),
    __SELLER_AGENTS_TEST_HOOKS__: options.testHooks || Object.freeze({}),
    structuredClone,
    queueMicrotask,
    atob,
    btoa,
    fetch: async (url, init = {}) => {
      const record = {
        url: String(url),
        method: init.method || "GET",
        body: init.body,
      };
      (record.url.includes("127.0.0.1:43100") ||
      record.url.includes("127.0.0.1:43101")
        ? controlNetwork
        : network
      ).push(record);
      const healthEndpoint = record.url.endsWith("/v1/health-authority");
      const syncEndpoint = record.url.endsWith("/v1/sync");
      if (syncEndpoint && options.syncFetch)
        return options.syncFetch(String(url), init, controlNetwork.length);
      if (syncEndpoint) {
        const body = JSON.parse(init.body || "{}");
        return new Response(
          JSON.stringify({
            syncVersion: "seller_agents_sync_v1",
            results: (body.entries || []).map((entry) => ({
              requestId: entry.requestId,
              mutationId: entry.mutationId,
              entityId: entry.entityId,
              outcome: "ACK",
              serverRevision: Number(entry.baseRevision || 0) + 1,
              serverState: entry.payload,
              code: null,
            })),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (healthEndpoint && options.healthFetch)
        return options.healthFetch(String(url), init, controlNetwork.length);
      if (!healthEndpoint && options.fetch)
        return options.fetch(String(url), init, network.length);
      if (healthEndpoint) {
        const authority = backing.local[AUTH_STORAGE_KEY]?.authority;
        const payload = authority?.payload;
        const claim = {
          healthClaimVersion: "health_claim_v1",
          status: "PASS",
          target: "WORK",
          context: {
            accountId: payload.account.id,
            deviceId: authority.deviceId,
            sessionId: authority.sessionId,
            contractVersion: payload.contractVersion,
            configVersion: payload.configVersion,
            bootstrapSnapshotSha256: Buffer.from(
              authority.envelope.payload,
              "base64url",
            ).toString("hex").length
              ? Buffer.from(
                  await webcrypto.subtle.digest(
                    "SHA-256",
                    Buffer.from(authority.envelope.payload, "base64url"),
                  ),
                ).toString("hex")
              : null,
            ai: {
              family: payload.ai.detected.family,
              surface: payload.ai.detected.surface,
              variant: payload.ai.detected.variant,
              profileKey: payload.ai.profile.profileKey,
              revision: payload.ai.profile.revision,
              scopeVariant: payload.ai.profile.scopeVariant,
              contentSha256: payload.ai.profile.contentSha256,
            },
          },
          observedAt: new Date(wallClock() - 1000).toISOString(),
          expiresAt: new Date(wallClock() + 14 * 60_000).toISOString(),
          executionAuthority: false,
        };
        const bytes = new TextEncoder().encode(canonical(claim));
        const prefix = new TextEncoder().encode(
          `product-control-plane/health-authority/v1\0${keyId}\0`,
        );
        const signed = new Uint8Array(prefix.length + bytes.length);
        signed.set(prefix);
        signed.set(bytes, prefix.length);
        const signature = await webcrypto.subtle.sign(
          "Ed25519",
          signing.privateKey,
          signed,
        );
        const envelope = {
          healthEnvelopeVersion: "health_envelope_v1",
          algorithm: "Ed25519",
          keyId,
          payload: b64url(bytes),
          signature: b64url(Buffer.from(signature)),
        };
        return new Response(JSON.stringify(envelope), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      assert.ok(
        String(url).startsWith("https://api-seller.ozon.ru/"),
        "No unexpected network target",
      );
      return new Response(JSON.stringify({ result: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    setTimeout(fn, ms, ...args) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        fn(...args);
      }, ms);
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer) {
      timers.delete(timer);
      clearTimeout(timer);
    },
    setInterval(fn, ms, ...args) {
      const timer = setInterval(fn, ms, ...args);
      timers.add(timer);
      return timer;
    },
    clearInterval(timer) {
      timers.delete(timer);
      clearInterval(timer);
    },
  };
  if (options.wallClock !== undefined) {
    const RealDate = Date;
    sandbox.Date = class extends RealDate {
      static now() {
        return wallClock();
      }
    };
  }
  context = vm.createContext(sandbox);
  sandbox.importScripts = (...files) => {
    for (const name of files) {
      let source = fs.readFileSync(path.join(directory, name), "utf8");
      // The frozen installed package carries its production trust bundle in
      // the first worker line.  The canonical in-process regression harness
      // must replace that build-time value with its own synthetic signer so
      // source and extracted worker assertions exercise the same runtime.
      if (
        name === "service_worker.js" &&
        source.startsWith("globalThis.__SELLER_AGENTS_PACKAGED_CONFIG__=")
      ) {
        const firstLineEnd = source.indexOf("\n");
        source = `globalThis.__SELLER_AGENTS_PACKAGED_CONFIG__=${JSON.stringify(fixtureConfig)};\n${source.slice(firstLineEnd + 1)}`;
      }
      // Test-only seam: the R2 race matrix can pause after the runtime has
      // built its rebind plan and before saAdmitWork reads its first
      // admission snapshot. Production packages never receive this option.
      if (
        name === "shared/application.js" &&
        options.testHooks?.afterRebindPlanCreated
      ) {
        const marker =
          '    const admission = await saAdmitWork({ operation: "start"';
        const hook =
          "    await globalThis.__SELLER_AGENTS_TEST_HOOKS__.afterRebindPlanCreated();\n";
        if (!source.includes(marker))
          throw new Error("R2 test seam marker missing");
        source = source.replace(marker, hook + marker);
      }
      vm.runInContext(source, context, { filename: name });
    }
  };
  vm.runInContext(
    fs.readFileSync(path.join(directory, "service_worker_entry.js"), "utf8"),
    context,
    { filename: "service_worker_entry.js" },
  );
  // Default sender reflects the mature popup/content ownership of each message.
  let fixtureStoreId = null;
  const adaptFixtureMessage = (message) => {
    if (message.type === "OZ_SAVE_GLOBAL_SETTINGS")
      return {
        type: "SA_STORE_SAVE",
        store: {
          id: fixtureStoreId,
          marketplace: "ozon",
          name: "Ozon fixture",
          personalDataEnabled: message.personal_data_enabled === true,
          credentials: {
            seller: {
              clientId: message.seller_client_id || "FIXTURE_CLIENT",
              apiKey: message.seller_api_key || "FIXTURE_KEY",
            },
            performance: {
              clientId: message.performance_client_id || "",
              clientSecret: message.performance_client_secret || "",
            },
          },
        },
      };
    if (message.type === "OZ_WORK_START")
      return {
        type: "SA_WORK_START",
        store_id: fixtureStoreId,
        tab_id: message.tab_id,
        confirm_change: true,
        start_intent_id: message.start_intent_id || crypto.randomUUID(),
      };
    return message;
  };
  request = (
    message,
    sender = /^OZ_(?:SAVE_|RESET_|CLEAR_|SET_|GET_SETTINGS_STATE|GET_GLOBAL_SETTINGS_STATE|GET_DIAGNOSTICS|BIND_CONVERSATION|TEST_CONNECTION|REFRESH_SELLER_API_METADATA|WORK_START$|WORK_SHOW$|WORK_HIDE$|WORK_FINISH$|WORK_REFRESH$|WORK_RESUME$)/.test(
      message.type,
    )
      ? { url: chrome.runtime.getURL("popup.html") }
      : { tab },
  ) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Message timed out: " + message.type)),
        4000,
      );
      try {
        const wireMessage = adaptFixtureMessage(message);
        listeners.at(-1)(clone(wireMessage), clone(sender), (response) => {
          clearTimeout(timeout);
          if (wireMessage.type === "SA_STORE_SAVE" && response?.ok)
            fixtureStoreId = response.store.id;
          resolve(response);
        });
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  const call = (name, ...args) =>
    vm.runInContext(`${name}(...${JSON.stringify(args)})`, context);
  await new Promise((r) => setTimeout(r, 5));
  // Wait for the real worker's startup restore before returning the fixture;
  // this keeps close/reopen barriers deterministic when restore persists a
  // cache floor asynchronously.
  await call("SellerAgentsControlClient.restore");
  return {
    network,
    controlNetwork,
    messages,
    idb: options.indexedDB,
    backing,
    identity,
    accountId,
    tabId,
    portalTabs,
    request,
    popup: (message) =>
      request(message, { url: chrome.runtime.getURL("popup.html") }),
    addTab(id, conversationId) {
      const value = { ...identity, conversation_id: conversationId };
      identities.set(id, value);
      tabs.set(id, { id, url: value.origin + "/c/" + conversationId });
      return { identity: value, sender: { tab: tabs.get(id) } };
    },
    setIdentity(value) {
      const next = { ...identities.get(tabId), ...value };
      identities.set(tabId, next);
      tab.url =
        next.origin +
        (next.ai_id === "alice" ? "/chat/" : "/c/") +
        (next.conversation_id || "");
      return next;
    },
    setDialogue(id) {
      identity.conversation_id = id;
      tab.url = identity.origin + "/c/" + id;
    },
    portRequest(message) {
      return new Promise((resolve) => {
        const handlers = [];
        const port = {
          name: "ozon-attachment-delivery-v1",
          sender: { tab, url: tab.url },
          onMessage: {
            addListener(fn) {
              handlers.push(fn);
            },
          },
          postMessage: (response) => resolve(response.response),
        };
        for (const fn of connectListeners) fn(port);
        for (const fn of handlers)
          fn(
            clone({
              ...message,
              request_id: "fixture-port",
              live_owner: identity,
            }),
          );
      });
    },
    listenerCounts() {
      return {
        attachmentPorts: connectListeners.length,
        storageWake: storageChangedListeners.length,
        runtime: listeners.length,
      };
    },
    call,
    async settings() {
      const response = await request(
        {
          type: "SA_STORE_SAVE",
          store: {
            id: fixtureStoreId,
            marketplace: "ozon",
            name: "Ozon fixture",
            personalDataEnabled: true,
            credentials: {
              seller: { clientId: "FIXTURE_CLIENT", apiKey: "FIXTURE_KEY" },
              performance: {},
            },
          },
        },
        { url: chrome.runtime.getURL("popup.html") },
      );
      if (response?.ok) fixtureStoreId = response.store.id;
      assert.equal(response.ok, true, JSON.stringify(response));
    },
    async start() {
      const response = await request(
        {
          type: "SA_WORK_START",
          store_id: fixtureStoreId,
          tab_id: tabId,
          confirm_change: true,
          start_intent_id: crypto.randomUUID(),
        },
        { url: chrome.runtime.getURL("popup.html") },
      );
      assert.equal(response.ok, true, JSON.stringify(response));
      const pending = await until(async () => {
        const row = (await call("getPendingWorkStarts"))[tabId];
        return row?.send_outcome === "sent_acknowledged" ? row : null;
      }, "start prompt acknowledgement");
      const active = await request({
        type: "OZ_WORK_PENDING_IDENTITY",
        intent_id: pending.intent_id,
        revision: pending.revision,
        identity,
        first_response_complete: true,
      });
      assert.equal(active.ok, true, JSON.stringify(active));
      return active.binding.conversation_key;
    },
    close() {
      for (const timer of timers) {
        clearTimeout(timer);
        clearInterval(timer);
      }
      timers.clear();
    },
  };
}

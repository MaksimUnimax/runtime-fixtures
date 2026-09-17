/* Pure online Work-eligibility composition. It consumes already trusted,
 * current authority facts and never performs I/O, transitions Work, or grants
 * provider/marketplace execution authority. */
(() => {
  "use strict";

  const SOURCE_PERMISSION = Object.freeze({ ozon: "source.ozon", wildberries: "source.wildberries" });
  const AI_PERMISSION = Object.freeze({ chatgpt: "ai.chatgpt", alice: "ai.alice" });
  const AI_PROVIDERS = new Set(Object.keys(AI_PERMISSION));
  const ALLOWED_WORK_STATES = Object.freeze({
    start: new Set(["inactive", "error"]),
    resume: new Set(["inactive"]),
  });
  const CAPABILITY_IDS = Object.freeze({
    "source.ozon": "marketplace.ozon.adapter",
    "source.wildberries": "marketplace.wildberries.adapter",
    "ai.chatgpt": "ai.chatgpt.web.adapter",
    "ai.alice": "ai.alice.web.adapter",
  });

  function plainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const nested of Object.values(value)) deepFreeze(nested);
    return Object.freeze(value);
  }

  function text(value) {
    return typeof value === "string" && value.length > 0;
  }

  function same(left, right) {
    return text(left) && left === right;
  }

  function semver(value) {
    if (typeof value !== "string") return null;
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
    return match ? match.slice(1).map(Number) : null;
  }

  function versionAtLeast(actual, minimum) {
    const left = semver(actual), right = semver(minimum);
    if (!left || !right) return false;
    for (let index = 0; index < 3; index += 1) {
      if (left[index] !== right[index]) return left[index] > right[index];
    }
    return true;
  }

  function exactIdentity(identity) {
    return plainObject(identity) &&
      text(identity.key) &&
      text(identity.origin) &&
      text(identity.conversationId) &&
      AI_PROVIDERS.has(identity.provider) &&
      identity.key === `${identity.origin}|${identity.conversationId}` &&
      ((identity.provider === "chatgpt" && ["https://chatgpt.com", "https://chat.openai.com"].includes(identity.origin)) ||
        (identity.provider === "alice" && identity.origin === "https://alice.yandex.ru"));
  }

  function pendingIdentity(identity) {
    return plainObject(identity) &&
      !text(identity.key) &&
      !text(identity.conversationId) &&
      [undefined, null, "unknown"].includes(identity.status) &&
      AI_PROVIDERS.has(identity.provider) &&
      ((identity.provider === "chatgpt" && ["https://chatgpt.com", "https://chat.openai.com"].includes(identity.origin)) ||
        (identity.provider === "alice" && identity.origin === "https://alice.yandex.ru"));
  }

  function capability(intersection, permission) {
    if (!plainObject(intersection) || intersection.schemaVersion !== "verified_capability_intersection_v1" || intersection.executionAuthority !== false || intersection.source !== "ONLINE" || intersection.freshness !== "FRESH" || !Array.isArray(intersection.capabilities)) return null;
    const row = intersection.capabilities.find(value => value?.entitlementKey === permission && value?.capabilityId === CAPABILITY_IDS[permission]);
    if (!row || row.executionAuthority !== false || row.packaged !== true || row.signedPermissionPresent !== true || row.signedPermissionAllowed !== true || row.permissionSatisfied !== true) return null;
    return row;
  }

  function evaluate(input) {
    const value = plainObject(input) ? input : {};
    const account = plainObject(value.account) ? value.account : {};
    const session = plainObject(value.session) ? value.session : {};
    const compatibility = plainObject(value.compatibility) ? value.compatibility : {};
    const extension = plainObject(compatibility.extension) ? compatibility.extension : {};
    const browser = plainObject(compatibility.browser) ? compatibility.browser : {};
    const bootstrap = plainObject(value.bootstrap) ? value.bootstrap : {};
    const ai = plainObject(value.ai) ? value.ai : {};
    const profile = plainObject(ai.profile) ? ai.profile : {};
    const health = plainObject(value.health) ? value.health : {};
    const dialogue = plainObject(value.dialogue) ? value.dialogue : {};
    const identity = plainObject(dialogue.identity) ? dialogue.identity : {};
    const binding = plainObject(dialogue.binding) ? dialogue.binding : {};
    const store = plainObject(value.store) ? value.store : {};
    const work = plainObject(value.work) ? value.work : {};
    const operation = typeof work.operation === "string" ? work.operation : null;
    const isStart = operation === "start";
    const isResume = operation === "resume";
    const boundRecord = binding.bound === true;
    const startIntent = work.startIntentId ?? work.start_intent_id ?? null;
    const expectedStartIntent = work.expectedStartIntentId ?? work.expected_start_intent_id ?? null;
    const sourcePermission = SOURCE_PERMISSION[store.marketplace] || null;
    const aiPermission = AI_PERMISSION[ai.provider] || null;
    const sourceCapability = capability(value.capabilityIntersection, sourcePermission);
    const aiCapability = capability(value.capabilityIntersection, aiPermission);

    const gates = {
      account: account.authenticated === true && same(account.accountId, account.expectedAccountId),
      sessionIdentity: Number.isSafeInteger(session.generation) && session.generation >= 0 && session.generation === session.expectedGeneration && same(session.deviceId, session.expectedDeviceId) && same(session.sessionId, session.expectedSessionId),
      revocation: session.revoked === false && session.obsolete === false,
      compatibility: ["SUPPORTED", "UPDATE_RECOMMENDED"].includes(extension.status) && text(extension.version) && (extension.minimumVersion === null || versionAtLeast(extension.version, extension.minimumVersion)) && browser.status === "SUPPORTED" && same(compatibility.contractVersion, compatibility.expectedContractVersion),
      bootstrapVerified: bootstrap.verified === true,
      bootstrapFreshness: bootstrap.source === "ONLINE" && bootstrap.freshness === "FRESH",
      bootstrapIdentity: same(bootstrap.accountId, account.accountId) && bootstrap.generation === session.generation && same(bootstrap.deviceId, session.deviceId) && same(bootstrap.sessionId, session.sessionId),
      aiProfile: AI_PROVIDERS.has(ai.provider) && identity.provider === ai.provider && bootstrap.aiProvider === ai.provider && profile.verified === true && profile.provider === ai.provider && Number.isSafeInteger(profile.revision) && profile.revision > 0,
      health: health.status === "PASS" && health.current === true && health.verified === true,
      pageIdentity: dialogue.trusted !== false && ((exactIdentity(identity) && dialogue.key === identity.key) || (isStart && pendingIdentity(identity) && (dialogue.key === null || dialogue.key === undefined))),
      dialogueBinding: !isResume && isStart && !boundRecord || exactIdentity(identity) && dialogue.key === identity.key && boundRecord && text(binding.bindingId) && Number.isSafeInteger(binding.revision) && binding.revision > 0 && binding.revision === binding.expectedRevision && binding.conversationKey === identity.key && binding.origin === identity.origin && binding.conversationId === identity.conversationId && binding.provider === identity.provider,
      marketplaceBinding: !isResume && isStart && !boundRecord || Boolean(sourcePermission) && binding.marketplace === store.marketplace && binding.storeId === store.storeId,
      storeBinding: !isResume && isStart && !boundRecord || text(store.accountId) && store.accountId === account.accountId && text(store.storeId) && text(store.credentialRevision) && binding.accountId === store.accountId && binding.storeId === store.storeId && binding.credentialRevision === store.credentialRevision && (binding.authGeneration === null || binding.authGeneration === undefined || binding.authGeneration === session.generation) && (binding.auth_generation === null || binding.auth_generation === undefined || binding.auth_generation === session.generation),
      storeOwnership: text(store.accountId) && store.accountId === account.accountId && text(store.storeId) && (store.selectedStoreId === null || store.selectedStoreId === undefined || store.selectedStoreId === store.storeId) && (store.expectedStoreId === null || store.expectedStoreId === undefined || store.expectedStoreId === store.storeId) && text(store.credentialRevision) && (store.expectedCredentialRevision === null || store.expectedCredentialRevision === undefined || store.expectedCredentialRevision === store.credentialRevision) && (store.authGeneration === null || store.authGeneration === undefined || store.authGeneration === session.generation) && (store.accountGeneration === null || store.accountGeneration === undefined || store.accountGeneration === session.generation),
      startIntent: startIntent === null && expectedStartIntent === null || text(startIntent) && text(expectedStartIntent) && same(startIntent, expectedStartIntent),
      tabIdentity: (dialogue.tabId === null || dialogue.tabId === undefined) && (dialogue.tab_id === null || dialogue.tab_id === undefined) || same(String(dialogue.tabId ?? dialogue.tab_id), String(dialogue.expectedTabId ?? dialogue.expected_tab_id)),
      workState: ALLOWED_WORK_STATES[operation]?.has(work.state) === true,
      sourceCapability: Boolean(sourceCapability),
      aiCapability: Boolean(aiCapability),
    };

    const requiredPermissions = Object.freeze({ source: sourcePermission, ai: aiPermission });
    const capabilityEvidence = {
      source: value.capabilityIntersection?.source || null,
      freshness: value.capabilityIntersection?.freshness || null,
      executionAuthority: value.capabilityIntersection?.executionAuthority === false ? false : null,
      sourceCapability: sourceCapability ? { ...sourceCapability } : null,
      aiCapability: aiCapability ? { ...aiCapability } : null,
    };
    const allowed = Object.values(gates).every(Boolean);
    return deepFreeze({
      schemaVersion: "online_work_authority_decision_v1",
      allowed,
      executionAuthority: false,
      operation,
      requiredPermissions,
      gates,
      deniedGates: Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name),
      capabilityEvidence,
    });
  }

  const api = Object.freeze({ evaluate });
  Object.defineProperty(globalThis, "SellerAgentsOnlineWorkAuthority", {
    value: api,
    writable: false,
    configurable: false,
    enumerable: true,
  });
})();

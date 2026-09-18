(() => {
  "use strict";
  // Privileged local catalog. The account port is supplied by the application;
  // this module neither authenticates a user nor invents a server account.
  function create({
    read,
    write,
    currentAccount,
    normalizeCredentials,
    revision,
    uuid,
  }) {
    const lock = globalThis.SellerAgentsLocalOperations.createWriteQueue();
    const key = "seller_agents_stores_v1";
    const fail = (code) => {
      throw Object.assign(new Error(code), { code });
    };
    const canonicalJson = (value) => {
      if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
      if (value && typeof value === "object")
        return `{${Object.keys(value)
          .sort()
          .map(
            (name) => `${JSON.stringify(name)}:${canonicalJson(value[name])}`,
          )
          .join(",")}}`;
      return JSON.stringify(value);
    };
    async function account() {
      const id = await currentAccount();
      if (!id || typeof id !== "string") fail("AUTH_REQUIRED");
      return id;
    }
    async function state() {
      const id = await account(),
        data = await read(key);
      if (id !== (await account())) fail("ACCOUNT_CHANGED");
      return { id, all: data[key] || { version: 1, accounts: {} } };
    }
    function publicStore(store) {
      const c = store.credentials || {};
      return {
        id: store.id,
        accountId: store.accountId,
        name: store.name,
        marketplace: store.marketplace,
        credentialRevision: store.credentialRevision,
        metadataRevision: store.metadataRevision || 0,
        lifecycleState: store.lifecycleState || "ACTIVE",
        providerAccountId: store.providerAccountId || null,
        providerIdentityState: store.providerIdentityState || "UNCONFIRMED",
        credentialsStale: store.credentialsStale === true,
        personalDataEnabled: store.personalDataEnabled,
        sellerPresent: Boolean(c.seller?.clientId && c.seller?.apiKey),
        performancePresent: Boolean(
          c.performance?.clientId && c.performance?.clientSecret,
        ),
        tokenPresent: Boolean(c.token),
        sellerClientId: c.seller?.clientId || "",
        performanceClientId: c.performance?.clientId || "",
        verification: store.verification || {},
      };
    }
    async function list() {
      const { id, all } = await state();
      return Object.values(all.accounts[id]?.stores || {})
        .filter(store => (store.lifecycleState || "ACTIVE") !== "TOMBSTONED")
        .map(publicStore);
    }
    async function get(storeId) {
      const { id, all } = await state();
      const store = all.accounts[id]?.stores?.[storeId];
      if (!store || store.accountId !== id || store.lifecycleState === "TOMBSTONED") fail("STORE_NOT_FOUND");
      return structuredClone(store);
    }
    async function mutate(fn) {
      return lock.run(async () => {
        const { id, all } = await state();
        const scope = structuredClone(
          all.accounts[id] || { stores: {}, next: { ozon: 1, wildberries: 1 } },
        );
        const result = await fn(scope, id);
        if (id !== (await account())) fail("ACCOUNT_CHANGED");
        const next = { ...all, accounts: { ...all.accounts, [id]: scope } };
        await write({ [key]: next });
        const saved = (await read(key))[key];
        if (canonicalJson(saved) !== canonicalJson(next))
          fail("STORE_WRITE_NOT_CONFIRMED");
        if (id !== (await account())) fail("ACCOUNT_CHANGED");
        return result;
      });
    }
    async function save(input) {
      if (!input || typeof input !== "object" || Array.isArray(input))
        fail("INVALID_STORE");
      return mutate(async (scope, id) => {
        const previous =
          input.id && Object.hasOwn(scope.stores, input.id)
            ? scope.stores[input.id]
            : null;
        if (input.id && !previous) fail("STORE_NOT_FOUND");
        if (previous?.lifecycleState === "TOMBSTONED") fail("STORE_TOMBSTONED");
        if (input.providerAccountId && input.providerAccountId !== previous?.providerAccountId) fail("PROVIDER_IDENTITY_CONFIRMATION_REQUIRED");
        const marketplace = previous?.marketplace || input.marketplace;
        if (
          !["ozon", "wildberries"].includes(marketplace) ||
          (input.marketplace && input.marketplace !== marketplace)
        )
          fail("INVALID_MARKETPLACE");
        const credentials = normalizeCredentials(
          marketplace,
          input.credentials || {},
          previous?.credentials,
        );
        const credentialsUnchanged = Boolean(
          previous && canonicalJson(previous.credentials || {}) === canonicalJson(credentials),
        );
        // A credential revision is an opaque fencing value. It is deliberately
        // not a digest or fingerprint of secret material.
        const credentialRevision = credentialsUnchanged
          ? previous.credentialRevision
          : await revision(marketplace, credentials);
        const serial = scope.next[marketplace] || 1;
        const name =
          String(input.name ?? previous?.name ?? "").trim() ||
          `${marketplace === "ozon" ? "Ozon" : "WB"} ${serial}`;
        if (name.length > 80 || /[\u0000-\u001f\u007f]/.test(name))
          fail("INVALID_STORE_NAME");
        const store = {
          id: previous?.id || `store-${uuid()}`,
          accountId: id,
          marketplace,
          name,
          credentials,
          credentialRevision,
          metadataRevision: (previous?.metadataRevision || 0) + 1,
          lifecycleState: "ACTIVE",
          providerAccountId: previous?.providerAccountId || null,
          providerIdentityState: previous?.providerIdentityState || "UNCONFIRMED",
          credentialsStale: false,
          personalDataEnabled:
            input.personalDataEnabled === undefined
              ? previous?.personalDataEnabled === true
              : input.personalDataEnabled === true,
          verification:
            previous?.credentialRevision === credentialRevision
              ? previous.verification
              : {},
          createdAt: previous?.createdAt || Date.now(),
        };
        scope.stores[store.id] = store;
        if (!previous) scope.next[marketplace] = serial + 1;
        return publicStore(store);
      });
    }
    async function importCredential(input) {
      if (!input || typeof input !== "object" || typeof input.id !== "string" || typeof input.credentialRevision !== "string") fail("TRANSFER_CONFLICT");
      return mutate(async (scope, id) => {
        const previous = scope.stores[input.id];
        if (previous?.lifecycleState === "TOMBSTONED" || previous && previous.marketplace !== input.marketplace) fail("TRANSFER_CONFLICT");
        if (previous?.providerIdentityState === "CONFIRMED" && input.providerIdentityState === "CONFIRMED" && previous.providerAccountId !== input.providerAccountId) fail("TRANSFER_CONFLICT");
        if (previous?.credentialRevision === input.credentialRevision) return { kind: "SAME_CURRENT", store: publicStore(previous) };
        if (previous?.credentialRevision) return { kind: "CONFLICT", store: publicStore(previous) };
        const credentials = normalizeCredentials(input.marketplace, input.credentials, {});
        const store = { id: input.id, accountId: id, marketplace: input.marketplace, name: String(input.name || input.id).slice(0, 80), credentials, credentialRevision: input.credentialRevision, metadataRevision: Number(input.metadataRevision || 0), lifecycleState: "ACTIVE", providerAccountId: input.providerIdentityState === "CONFIRMED" ? input.providerAccountId || null : null, providerIdentityState: input.providerIdentityState === "CONFIRMED" ? "CONFIRMED" : "UNCONFIRMED", credentialsStale: false, personalDataEnabled: false, verification: {}, createdAt: Date.now() };
        scope.stores[store.id] = store;
        return { kind: "IMPORTED", store: publicStore(store) };
      });
    }
    async function backupSnapshot() {
      const { id, all } = await state();
      return Object.values(all.accounts[id]?.stores || {})
        .filter((store) => (store.lifecycleState || "ACTIVE") === "ACTIVE")
        .map((store) => structuredClone(store));
    }
    async function planBackupImport(payload) {
      if (!payload?.accountBinding?.accountId) fail("BACKUP_ACCOUNT_MISMATCH");
      const { id, all } = await state();
      if (payload.accountBinding.accountId !== id) fail("BACKUP_ACCOUNT_MISMATCH");
      const current = all.accounts[id]?.stores || {};
      const classifications = payload.stores.map((incoming) => {
        const previous = current[incoming.storeId];
        if (!previous) return { storeId: incoming.storeId, kind: "IMPORT_NEW" };
        if (previous.lifecycleState === "TOMBSTONED") return { storeId: incoming.storeId, kind: "LOCAL_TOMBSTONED" };
        if (previous.marketplace !== incoming.marketplace) return { storeId: incoming.storeId, kind: "MARKETPLACE_MISMATCH" };
        if (previous.providerIdentityState === "CONFIRMED" && incoming.providerIdentityState === "CONFIRMED" && previous.providerAccountId !== incoming.providerAccountId) return { storeId: incoming.storeId, kind: "PROVIDER_ACCOUNT_MISMATCH" };
        const localCredentials = previous.credentials || {};
        const incomingCredentials = incoming.credentials.type === "ozon" ? { seller: incoming.credentials.seller, performance: incoming.credentials.performance || {} } : { token: incoming.credentials.token };
        if (previous.credentialRevision === incoming.credentialRevision && canonicalJson(localCredentials) === canonicalJson(incomingCredentials)) return { storeId: incoming.storeId, kind: "SAME_CURRENT" };
        return { storeId: incoming.storeId, kind: "LOCAL_NEWER" };
      });
      return { accountId: id, classifications, safeStoreIds: classifications.filter((row) => row.kind === "IMPORT_NEW").map((row) => row.storeId) };
    }
    async function applyBackupImport(payload, expectedPlan) {
      return mutate(async (scope, id) => {
        if (payload?.accountBinding?.accountId !== id || expectedPlan?.accountId !== id) fail("ACCOUNT_CHANGED");
        const current = scope.stores || {};
        const actual = payload.stores.map((incoming) => {
          const previous = current[incoming.storeId];
          if (!previous) return { storeId: incoming.storeId, kind: "IMPORT_NEW" };
          if (previous.lifecycleState === "TOMBSTONED") return { storeId: incoming.storeId, kind: "LOCAL_TOMBSTONED" };
          if (previous.marketplace !== incoming.marketplace) return { storeId: incoming.storeId, kind: "MARKETPLACE_MISMATCH" };
          if (previous.providerIdentityState === "CONFIRMED" && incoming.providerIdentityState === "CONFIRMED" && previous.providerAccountId !== incoming.providerAccountId) return { storeId: incoming.storeId, kind: "PROVIDER_ACCOUNT_MISMATCH" };
          const localCredentials = previous.credentials || {};
          const incomingCredentials = incoming.credentials.type === "ozon" ? { seller: incoming.credentials.seller, performance: incoming.credentials.performance || {} } : { token: incoming.credentials.token };
          if (previous.credentialRevision === incoming.credentialRevision && canonicalJson(localCredentials) === canonicalJson(incomingCredentials)) return { storeId: incoming.storeId, kind: "SAME_CURRENT" };
          return { storeId: incoming.storeId, kind: "LOCAL_NEWER" };
        });
        if (canonicalJson(actual) !== canonicalJson(expectedPlan.classifications || [])) fail("IMPORT_PLAN_STALE");
        const safe = new Set((expectedPlan.safeStoreIds || []).filter((storeId) => actual.find((row) => row.storeId === storeId)?.kind === "IMPORT_NEW"));
        const imported = [];
        for (const incoming of payload.stores) {
          if (!safe.has(incoming.storeId)) continue;
          const credentials = incoming.credentials.type === "ozon"
            ? normalizeCredentials("ozon", { seller: incoming.credentials.seller, performance: incoming.credentials.performance || {} })
            : normalizeCredentials("wildberries", { token: incoming.credentials.token });
          const store = {
            id: incoming.storeId, accountId: id, marketplace: incoming.marketplace, name: incoming.label,
            credentials, credentialRevision: incoming.credentialRevision, metadataRevision: incoming.metadataRevision,
            lifecycleState: "ACTIVE", providerAccountId: incoming.providerIdentityState === "CONFIRMED" ? incoming.providerAccountId : null,
            providerIdentityState: incoming.providerIdentityState, credentialsStale: false, personalDataEnabled: false,
            verification: {}, createdAt: Date.now(),
          };
          scope.stores[store.id] = store;
          imported.push(publicStore(store));
        }
        return { imported, classifications: actual };
      });
    }
    async function remove(id) {
      return mutate((scope) => {
        if (!scope.stores[id]) fail("STORE_NOT_FOUND");
        const store = scope.stores[id];
        if (!store) fail("STORE_NOT_FOUND");
        store.lifecycleState = "TOMBSTONED";
        store.credentials = {};
        store.credentialsStale = true;
        store.verification = {};
        store.metadataRevision = (store.metadataRevision || 0) + 1;
        return { deleted: true, store: publicStore(store) };
      });
    }
    async function noteVerification(id, expectedRevision, part, result) {
      return mutate((scope) => {
        const store = scope.stores[id];
        if (!store || store.lifecycleState === "TOMBSTONED" || store.credentialRevision !== expectedRevision)
          fail("STORE_CHANGED");
        store.verification = {
          ...store.verification,
          [part]: {
            code: result.code,
            httpStatus: Number(result.httpStatus || 0),
            checkedAt: Date.now(),
          },
        };
        return publicStore(store);
      });
    }
    async function confirmProviderIdentity(id, expectedRevision, providerAccountId) {
      if (typeof providerAccountId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(providerAccountId)) fail("PROVIDER_IDENTITY_UNCONFIRMED");
      return mutate(scope => {
        const store = scope.stores[id];
        if (!store || store.lifecycleState === "TOMBSTONED" || store.credentialRevision !== expectedRevision) fail("STORE_CHANGED");
        if (store.providerIdentityState === "CONFIRMED" && store.providerAccountId !== providerAccountId) fail("STORE_PROVIDER_IDENTITY_MISMATCH");
        store.providerAccountId = providerAccountId;
        store.providerIdentityState = "CONFIRMED";
        store.metadataRevision = (store.metadataRevision || 0) + 1;
        return publicStore(store);
      });
    }
    async function metadataForSync(id) {
      const store = await get(id);
      return {
        kind: "STORE_UPSERT",
        storeId: store.id,
        marketplace: store.marketplace,
        name: store.name,
        providerAccountId: store.providerIdentityState === "CONFIRMED" ? store.providerAccountId : null,
        providerIdentityState: store.providerIdentityState,
        credentialRevision: store.credentialRevision,
        metadataRevision: store.metadataRevision || 0,
        lifecycleState: "ACTIVE",
      };
    }
    async function applyRemoteMetadata(input) {
      if (!input || !input.storeId || !["STORE_UPSERT", "STORE_TOMBSTONE"].includes(input.kind)) fail("INVALID_STORE_METADATA");
      return mutate((scope, accountId) => {
        const previous = scope.stores[input.storeId];
        if (previous && previous.accountId !== accountId) fail("STORE_NOT_FOUND");
        const incomingRevision = Number.isSafeInteger(Number(input.metadataRevision)) && Number(input.metadataRevision) >= 0 ? Number(input.metadataRevision) : 0;
        if (previous?.lifecycleState === "TOMBSTONED") {
          if (input.kind === "STORE_TOMBSTONE" && incomingRevision > (previous.metadataRevision || 0)) previous.metadataRevision = incomingRevision;
          return publicStore(previous);
        }
        if (previous && incomingRevision < (previous.metadataRevision || 0)) return publicStore(previous);
        if (previous?.providerIdentityState === "CONFIRMED" && input.providerIdentityState === "CONFIRMED" && previous.providerAccountId !== input.providerAccountId) fail("STORE_PROVIDER_IDENTITY_MISMATCH");
        const store = previous || {
          id: input.storeId,
          accountId,
          marketplace: input.marketplace,
          credentials: {},
          personalDataEnabled: false,
          verification: {},
          createdAt: Date.now(),
        };
        const previousCredentialRevision = previous?.credentialRevision || null;
        store.name = String(input.name || "").trim();
        store.marketplace = input.marketplace;
        store.providerIdentityState = previous?.providerIdentityState === "CONFIRMED" ? "CONFIRMED" : input.providerIdentityState === "CONFIRMED" ? "CONFIRMED" : "UNCONFIRMED";
        store.providerAccountId = store.providerIdentityState === "CONFIRMED" ? (previous?.providerAccountId || input.providerAccountId || null) : null;
        store.credentialRevision = input.credentialRevision || previous?.credentialRevision || null;
        store.metadataRevision = incomingRevision;
        store.lifecycleState = input.kind === "STORE_TOMBSTONE" ? "TOMBSTONED" : "ACTIVE";
        store.credentials = input.kind === "STORE_TOMBSTONE" ? {} : (previous?.credentials || {});
        store.credentialsStale = input.kind === "STORE_TOMBSTONE" || !Object.keys(store.credentials || {}).length || Boolean(previous?.credentials && previousCredentialRevision !== store.credentialRevision);
        if (store.lifecycleState === "TOMBSTONED") store.verification = {};
        scope.stores[store.id] = store;
        return publicStore(store);
      });
    }
    return Object.freeze({ key, list, get, save, importCredential, backupSnapshot, planBackupImport, applyBackupImport, remove, noteVerification, confirmProviderIdentity, metadataForSync, applyRemoteMetadata });
  }
  globalThis.SellerAgentsStoreCatalog = Object.freeze({ create });
})();

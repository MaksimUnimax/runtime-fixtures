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
      const c = store.credentials;
      return {
        id: store.id,
        accountId: store.accountId,
        name: store.name,
        marketplace: store.marketplace,
        credentialRevision: store.credentialRevision,
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
      return Object.values(all.accounts[id]?.stores || {}).map(publicStore);
    }
    async function get(storeId) {
      const { id, all } = await state();
      const store = all.accounts[id]?.stores?.[storeId];
      if (!store || store.accountId !== id) fail("STORE_NOT_FOUND");
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
        const credentialRevision = await revision(marketplace, credentials);
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
    async function remove(id) {
      return mutate((scope) => {
        if (!scope.stores[id]) fail("STORE_NOT_FOUND");
        delete scope.stores[id];
        return { deleted: true };
      });
    }
    async function noteVerification(id, expectedRevision, part, result) {
      return mutate((scope) => {
        const store = scope.stores[id];
        if (!store || store.credentialRevision !== expectedRevision)
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
    return Object.freeze({ key, list, get, save, remove, noteVerification });
  }
  globalThis.SellerAgentsStoreCatalog = Object.freeze({ create });
})();

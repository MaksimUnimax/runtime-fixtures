const manualOperationRecords =
  globalThis.SellerAgentsLocalOperations.createRecordStore({
    read: (keys) => storageGet(keys),
    write: async (values) => {
      await storageSet(values);
      rememberManualContextOwners(values[KEYS.MANUAL_OPERATIONS]);
    },
    namespace: KEYS.MANUAL_OPERATIONS,
    writerKey: KEYS.MANUAL_OPERATIONS,
  });
